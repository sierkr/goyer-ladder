// ============================================================
//  ronde.js
// ============================================================
import { db, auth, functions, httpsCallable, IS_TEST, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, _usersCache, _verwijderdePartijIds } from './store.js';
import { slaActievePartijenOp, slaUitslagenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { closeModal } from './admin.js';
import { kortNaamMap, mijnPartij, renderHcpBlok } from './partij.js';
import { getLadderSpelers, ladderStandenGeladen } from './ladder-view.js';
import { renderLadder, berekenWeergaveRangen } from './ladder.js';

// v4.2.0: puntensysteem — de partij-uitslag wordt niet meer client-side
// verwerkt maar via een Cloud Function (verwerkPartijUitslag), zodat de
// afgeschermde punten (ladders/{id}/punten/{uid}) correct berekend kunnen
// worden zonder dat een gewone speler ze hoeft te kunnen lezen. isTest gaat
// mee zodat de functie gegarandeerd in dezelfde database schrijft als waar
// de speler op dat moment zit (productie of test — nooit de verkeerde).
const _verwerkPartijUitslagFn = httpsCallable(functions, 'verwerkPartijUitslag');
// v5.0.0 (punt 1): watch-PIN wordt server-side gemaakt; er staan geen
// refreshTokens meer in Firestore.
const _maakWatchPinFn = httpsCallable(functions, 'maakWatchPin');
// v5.0.0 (punt 4): scores per speler in een eigen document.
import {
  schrijfScore, luisterOpScores, leesScores, maakPartijDocument,
  voegSpelerToeAanPartij, verwijderSpelerUitPartijDoc, verwijderPartijDocument,
  arrayNaarHolesMap
} from './scores.js';
import { slaSnapshotOp } from './beheer.js';
import { verwerkKnockoutUitslag } from './knockout.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { autoAdvance } from './auth.js';
import { renderUitslagen } from './uitslagen.js';


//  RONDE (live scorekaart)
// ============================================================

//  RONDE (live scorekaart)
// ============================================================
// ============================================================
//  v5.7.1 — TEAMINDELING BIJ HIGH-LOW
// ============================================================
//  Eén plek waar bepaald wordt wie met wie speelt: slot 1+2 tegen 3+4. De
//  indeling wordt afgeleid uit de spelersvolgorde en niet opgeslagen — zie de
//  toelichting in js/partij.js. Verandert die regel ooit, dan verandert hij
//  hier, en nergens anders.
function teamsVan(p) {
  const uids = (p?.spelers || []).map(s => s.uid);
  if (p?.speltype !== 'highlow' || uids.length !== 4) return null;
  return [[uids[0], uids[1]], [uids[2], uids[3]]];
}

// ─── Live scores van de eigen partij ─────────────────────────
// v5.0.0 (punt 4): we luisteren op de scoredocumenten van de partij waar de
// speler zelf in zit — een handvol kleine documenten in plaats van het
// complete ladderdocument bij elke toetsaanslag van elke speler. Scheelt
// merkbaar dataverbruik en accu op de baan.
let _scoreUnsub = null;
let _scoreUnsubPartijId = null;
// v5.5.4: ook onthouden op WELK object we luisteren, niet alleen welk partijId.
let _scoreUnsubObj = null;

function koppelScoreListener(p) {
  if (!p || !p.ladderId || !p.partijId) return;

  // ────────────────────────────────────────────────────────────
  // v5.5.4 — WAT ER MIS WAS, EN WAAROM ALLEEN OP DE TELEFOON.
  //
  // Hier stond alleen een vergelijking op partijId:
  //     if (_scoreUnsubPartijId === p.partijId && _scoreUnsub) return;
  //
  // De listener schrijft binnenkomende scores rechtstreeks in het partij-object
  // dat hij bij het koppelen meekreeg. Maar dat object wordt op twee plekken
  // VERVANGEN terwijl het partijId hetzelfde blijft:
  //   - herlaadNaResume() in auth.js, zodra de app terugkomt uit de achtergrond
  //   - de onSnapshot op het ladderdocument
  // Beide zetten alleLadders[idx].actievePartijen op de verse kopie uit het
  // ladderdocument — een oude kopie van de scores, want de echte scores staan
  // sinds v5.0.0 in de subcollectie.
  //
  // Omdat het partijId niet veranderde, dacht deze functie "ik luister al" en
  // bleef hij hangen aan het weggegooide object. Het nieuwe object, dat op het
  // scherm stond, kreeg nooit meer een score binnen.
  //
  // Op een PC valt dat niet op: het tabblad blijft zichtbaar, dus die
  // resume-functie gaat nooit af. Op een telefoon gaat de app voortdurend naar
  // de achtergrond en terug — vandaar dat het uitsluitend daar misging.
  // ────────────────────────────────────────────────────────────
  if (_scoreUnsubPartijId === p.partijId && _scoreUnsub && _scoreUnsubObj === p) {
    return; // al gekoppeld aan precies dit object
  }
  ontkoppelScoreListener();
  _scoreUnsubPartijId = p.partijId;
  _scoreUnsubObj = p;
  _scoreUnsub = luisterOpScores(p.ladderId, p.partijId, p, () => {
    // Scores van (bijvoorbeeld) een flightgenoot binnengekomen: kaart en
    // matchstand verversen. renderScorecard() alleen aanroepen als het
    // scherm daadwerkelijk zichtbaar is, om typen niet te onderbreken.
    try {
      const zichtbaar = document.getElementById('page-ronde')?.classList.contains('active');
      if (zichtbaar) renderScorecard();
      renderMatchOverview();
    } catch (e) { console.warn('score-update renderen mislukt:', e); }
  });
}

function ontkoppelScoreListener() {
  if (_scoreUnsub) { try { _scoreUnsub(); } catch(_) {} }
  _scoreUnsub = null;
  _scoreUnsubPartijId = null;
  _scoreUnsubObj = null;
}

function renderRonde() {
  const p = mijnPartij();
  if (!p) {
    ontkoppelScoreListener();
    document.getElementById('ronde-empty').style.display = 'block';
    document.getElementById('ronde-content').style.display = 'none';
    return;
  }
  koppelScoreListener(p);
  document.getElementById('ronde-empty').style.display = 'none';
  document.getElementById('ronde-content').style.display = 'block';
  document.getElementById('ronde-baan-naam').textContent = p.baan;
  const ladderNaam = alleLadders.find(l => l.id === p.ladderId)?.naam || '';
  document.getElementById('ronde-holes-badge').textContent = p.holes.length + ' holes' + (ladderNaam ? ' · ' + ladderNaam : '');
  renderScorecard();
  renderMatchOverview();
  renderWatchPin(); // v3.0.0-11.79: auto PIN in gele badge
  // HCP slagen blok — gebruik partijHcp als die beschikbaar is
  if (p.spelers && p.holes) {
    const hcpSpelers = p.spelers.map(s => ({ ...s, hcp: s.partijHcp ?? s.hcp }));
    renderHcpBlok(hcpSpelers, p.holes, 0.75, 'ronde-hcp-blok');
  }
}

function renderScorecard() {
  const p = mijnPartij();
  if (!p) return;

  const naamMap = kortNaamMap(p.spelers);

  // v3.0.3: team-labels voor High-Low (uid → team-index)
  const teamLabel = {};
  const _teams133 = teamsVan(p);
  if (_teams133) {
    _teams133.forEach((team, ti) => team.forEach(uid => { teamLabel[uid] = ti; }));
  }

  // HEAD
  let headHtml = '<tr><th class="player-col" style="text-align:left">Hole</th>';
  p.spelers.forEach(s => {
    headHtml += `<th style="text-align:center;font-family:'DM Sans',sans-serif;font-size:12px">
      ${p.speltype === 'highlow' && teamLabel[s.uid] !== undefined ? `<span style="display:inline-block;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px;margin-bottom:2px;background:rgba(255,255,255,0.22);color:#fff">T${teamLabel[s.uid] + 1}</span><br>` : ''}${esc(naamMap[s.uid])}<br>
      <span onclick="editPartijHcp('${escAttr(s.uid)}')" style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.7);cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)" title="Klik om aan te passen">hcp ${Math.round(s.partijHcp)}</span><br>
      <button onclick="verwijderSpelerUitRonde('${escAttr(s.uid)}')" style="background:rgba(255,255,255,0.15);border:none;border-radius:4px;color:rgba(255,255,255,0.8);font-size:10px;cursor:pointer;padding:2px 5px;margin-top:2px">✕ verwijder</button>
    </th>`;
  });
  // v3.0.0-11.97: extra kolom voor Amerikaantje punten
  if (p.speltype === 'amerikaantje') {
    headHtml += `<th style="text-align:center;font-family:'DM Sans',sans-serif;font-size:12px;color:rgba(255,255,255,0.8)">Punten</th>`;
  } else if (p.speltype === 'highlow') {
    // v3.0.3: team-punten kolom
    headHtml += `<th style="text-align:center;font-family:'DM Sans',sans-serif;font-size:12px;color:rgba(255,255,255,0.8)">T1–T2</th>`;
  }
  headHtml += '</tr>';
  document.getElementById('scorecard-head').innerHTML = headHtml;

  // BODY — rijen = holes, kolommen = spelers
  // DOM-volgorde: hole1/speler1, hole1/speler2, hole2/speler1 ...
  // Zodat iOS pijltjes per hole langs alle spelers gaan
  let bodyHtml = '';
  const totalen = {};
  p.spelers.forEach(s => { totalen[s.uid] = 0; });

  p.holes.forEach((h, holeIdx) => {
    bodyHtml += `<tr>
      <td style="padding:4px 8px 4px 8px;font-family:'DM Mono',monospace;white-space:nowrap;min-width:44px">
        <div style="display:flex;align-items:center;gap:3px">
          <span style="font-weight:700;font-size:15px;line-height:1">${((p.startHole - 1 + holeIdx) % 18) + 1}</span>
          <div style="display:flex;flex-direction:column;line-height:1.2">
            <span class="hole-par">p${h.par}</span>
            <span class="hole-si">SI ${h.si}</span>
          </div>
        </div>
      </td>`;
    p.spelers.forEach((s, si) => {
      const scoreArr = Array.isArray(p.scores?.[s.uid]) ? p.scores[s.uid] : [];
      const val = scoreArr[holeIdx] ?? null;
      if (val !== null) totalen[s.uid] = (totalen[s.uid] || 0) + val;
      const inputId = `score-${s.uid}-${holeIdx}`;
      const tabIdx = holeIdx * p.spelers.length + si + 1;
      bodyHtml += `<td style="text-align:center"><input
        id="${escAttr(inputId)}"
        type="number"
        inputmode="numeric"
        pattern="[0-9]*"
        min="1" max="12"
        tabindex="${tabIdx}"
        value="${val !== null ? val : ''}"
        onfocus="this.select();setTimeout(()=>this.scrollIntoView({behavior:'smooth',block:'center'}),300)" oninput="updateScore('${escAttr(s.uid)}',${holeIdx},this.value);if(this.value.length>0)autoAdvance(this)"
        style="width:38px;padding:3px;text-align:center;font-size:13px;font-family:'DM Mono',monospace;border:1.5px solid #e0ddd4;border-radius:5px"
      ></td>`;
    });
    // v3.0.0-11.97: Amerikaantje punten-kolom
    if (p.speltype === 'amerikaantje') {
      const punten = berekenAmerikaaanjeHole(holeIdx);
      if (punten) {
        bodyHtml += `<td style="text-align:center;font-family:'DM Mono',monospace;font-size:12px;color:var(--mid);white-space:nowrap">${esc(punten.join('-'))}</td>`;
      } else {
        bodyHtml += `<td style="text-align:center;color:var(--light);font-size:11px">—</td>`;
      }
    } else if (p.speltype === 'highlow') {
      // v3.0.3: team-punten deze hole (T1–T2)
      const hl = berekenHighlowHole(holeIdx);
      if (hl) {
        bodyHtml += `<td style="text-align:center;font-family:'DM Mono',monospace;font-size:12px;color:var(--mid);white-space:nowrap">${hl.teamPunten[0]}–${hl.teamPunten[1]}</td>`;
      } else {
        bodyHtml += `<td style="text-align:center;color:var(--light);font-size:11px">—</td>`;
      }
    }
    bodyHtml += '</tr>';
  });

  // Totaalrij
  bodyHtml += '<tr style="border-top:2px solid #e0ddd4">';
  bodyHtml += `<td style="padding:6px 8px;font-size:12px;font-weight:600;color:var(--mid)">Totaal</td>`;
  p.spelers.forEach(s => {
    const scoreArr2 = Array.isArray(p.scores?.[s.uid]) ? p.scores[s.uid] : [];
    const filled = scoreArr2.filter(v => v !== null).length;
    bodyHtml += `<td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700;font-size:14px">${filled > 0 ? totalen[s.uid] : '—'}</td>`;
  });
  // v3.0.0-11.97: totaal punten kolom
  if (p.speltype === 'amerikaantje') {
    const totaalPunten = p.spelers.map((s, si) => {
      let som = 0;
      p.holes.forEach((_, hi) => {
        const pt = berekenAmerikaaanjeHole(hi);
        if (pt) som += pt[si];
      });
      return som;
    });
    bodyHtml += `<td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700;font-size:13px;color:var(--green)">${esc(totaalPunten.join('-'))}</td>`;
  } else if (p.speltype === 'highlow') {
    // v3.0.3: team-totalen
    let tA = 0, tB = 0;
    p.holes.forEach((_, hi) => {
      const hl = berekenHighlowHole(hi);
      if (hl) { tA += hl.teamPunten[0]; tB += hl.teamPunten[1]; }
    });
    bodyHtml += `<td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700;font-size:13px;color:var(--green)">${tA}–${tB}</td>`;
  }
  bodyHtml += '</tr>';

  // v3.0.0-11.21: onthoud waar focus stond vóór innerHTML vervanging,
  // zodat na re-render (bv. door Firestore listener) het toetsenbord open blijft.
  const focusedId = document.activeElement?.id || null;
  const scorecardBody = document.getElementById('scorecard-body');
  const focusIsBinnenScorecard = focusedId && scorecardBody.contains(document.activeElement);

  scorecardBody.innerHTML = bodyHtml;

  // Herstel focus als die binnen de scorecard stond
  if (focusIsBinnenScorecard && focusedId) {
    const herstel = document.getElementById(focusedId);
    if (herstel) {
      herstel.focus({ preventScroll: true });
    }
  }
}

// ============================================================
//  SCORE OPSLAAN — v5.0.0 (punt 4)
// ------------------------------------------------------------
//  Tot v4.2.0 schreef elke toetsaanslag via slaActievePartijenOp() de
//  COMPLETE actievePartijen-array van de hele ladder terug. Twee flights op
//  dezelfde ladder wisten daarmee elkaars holes, en het horloge deed hetzelfde
//  op datzelfde veld. Zie js/scores.js voor de volledige uitleg.
//
//  Nu: één veld van één speler (`holes.7` in
//  ladders/{id}/partijen/{partijId}/scores/{uid}). Botsen kan niet meer.
//
//  De oude array wordt nog wel bijgewerkt, maar vertraagd en als afgeleide
//  kopie — zie _planLegacySync() hieronder.
// ============================================================

// Verzamelt schrijfacties per (partij, speler, hole) en stuurt ze na een korte
// stilte weg. Voorkomt drie schrijfacties als iemand een score twee keer
// corrigeert, zonder dat een score ooit langer dan een halve seconde blijft
// hangen. Bij het afsluiten van de partij wordt de buffer eerst geleegd.
const _scoreDebounce = new Map(); // sleutel -> timeoutId
const _scoreInVlucht = new Set(); // sleutels die nog wachten op wegschrijven
const SCORE_DEBOUNCE_MS = 400;

function _scoreSleutel(ladderId, partijId, uid, holeIdx) {
  return `${ladderId}|${partijId}|${uid}|${holeIdx}`;
}

async function _flushScore(ladderId, partijId, uid, holeIdx, waarde) {
  const sleutel = _scoreSleutel(ladderId, partijId, uid, holeIdx);
  try {
    await schrijfScore(ladderId, partijId, uid, holeIdx, waarde);
  } catch (e) {
    // Niet stil laten mislukken: de speler denkt anders dat de score staat.
    console.error('[updateScore] opslaan mislukt:', e?.code || e);
    toast('Score kon niet worden opgeslagen — controleer je verbinding');
  } finally {
    _scoreInVlucht.delete(sleutel);
    _scoreDebounce.delete(sleutel);
  }
  _planLegacySync(ladderId);
}

/**
 * Wacht tot alle openstaande scores zijn weggeschreven. Wordt aangeroepen
 * vóór het afsluiten van een partij, zodat de laatste hole gegarandeerd
 * meetelt in de uitslagcontrole van de Cloud Function.
 */
async function wachtOpScoreOpslag() {
  // Alle lopende debounces meteen uitvoeren.
  for (const [sleutel, info] of Array.from(_scoreDebounce.entries())) {
    clearTimeout(info.timeoutId);
    _scoreDebounce.delete(sleutel);
    await _flushScore(info.ladderId, info.partijId, info.uid, info.holeIdx, info.waarde);
  }
  // Kort wachten tot eventueel nog vliegende writes klaar zijn.
  for (let i = 0; i < 20 && _scoreInVlucht.size > 0; i++) {
    await new Promise(r => setTimeout(r, 50));
  }
}

async function updateScore(spelerId, holeIdx, val) {
  try {
    const p = mijnPartij();
    if (!p) return;

    const waarde = (val === '' || val === null || val === undefined) ? null : parseInt(val);
    if (waarde !== null && !Number.isFinite(waarde)) return;

    // Lokaal meteen bijwerken zodat het scherm direct reageert; de listener
    // in luisterOpScores() bevestigt dit zo meteen vanuit Firestore.
    if (!p.scores) p.scores = {};
    if (!Array.isArray(p.scores[spelerId])) {
      p.scores[spelerId] = new Array(p.holes.length).fill(null);
    }
    p.scores[spelerId][holeIdx] = waarde;
    renderMatchOverview();

    const sleutel = _scoreSleutel(p.ladderId, p.partijId, spelerId, holeIdx);
    const bestaand = _scoreDebounce.get(sleutel);
    if (bestaand) clearTimeout(bestaand.timeoutId);
    _scoreInVlucht.add(sleutel);
    const info = {
      ladderId: p.ladderId, partijId: p.partijId, uid: spelerId, holeIdx, waarde,
      timeoutId: setTimeout(() => {
        _scoreDebounce.delete(sleutel);
        _flushScore(p.ladderId, p.partijId, spelerId, holeIdx, waarde);
      }, SCORE_DEBOUNCE_MS),
    };
    _scoreDebounce.set(sleutel, info);
  } catch(e) { console.error('updateScore mislukt:', e); }
}

// ─── Overgangskopie naar de oude array ───────────────────────
// Tijdens de dubbel-schrijven-periode blijft actievePartijen[].scores gevuld,
// zodat een speler die de update nog niet binnen heeft de kaart blijft zien.
// Dit gebeurt vertraagd (max één keer per 5 seconden) en op basis van de
// lokale cache — die wordt gevoed door de scores-listener en bevat dus de
// samengevoegde waarheid van alle spelers in de partij. Raakt deze kopie een
// keer achter doordat twee flights tegelijk schrijven, dan is dat onschadelijk:
// de echte scores staan in de subcollectie en die heeft bij lezen voorrang.
const _legacyTimers = new Map();
const LEGACY_SYNC_MS = 5000;

function _planLegacySync(ladderId) {
  if (_legacyTimers.has(ladderId)) return;
  _legacyTimers.set(ladderId, setTimeout(async () => {
    _legacyTimers.delete(ladderId);
    try { await slaActievePartijenOp(ladderId); }
    catch (e) { console.warn('[legacy-sync] actievePartijen bijwerken mislukt:', e?.code || e); }
  }, LEGACY_SYNC_MS));
}

// v5.4.0: dit verwees naar '#scorecard-wrap', een element dat nergens in
// index.html bestaat. De functie stond wel op window en zou bij aanroep
// meteen een TypeError gooien op `w.style`. Gevonden bij het schrijven van de
// browsertests. Nu wijst hij naar de echte scorekaart en is hij null-veilig.
function toggleScorecard() {
  const w = document.getElementById('scorecard-table')?.closest('.card-collapse')
         || document.getElementById('scorecard-table');
  if (!w) { console.warn('toggleScorecard: scorekaart niet gevonden'); return; }
  w.style.display = w.style.display === 'none' ? '' : 'none';
}

function getHcpSlagenOpHole(matchup, holeIdx) {
  const p = mijnPartij();
  const hole = p.holes[holeIdx];
  const aantalHoles = p.holes.length;
  const diff = matchup.hcpSlagen;
  return (hole.si <= Math.min(diff, aantalHoles) ? 1 : 0) +
         (hole.si <= Math.max(0, diff - aantalHoles) ? 1 : 0);
}

function berekenMatchStand(matchup) {
  const p = mijnPartij();
  if (!p || !p.holes || !p.scores) return { standA: 0, gespeeld: 0, resterend: 0, resultatenPerHole: [], status: 'lopend', beslissingsGespeeld: null };
  let standA = 0;
  let gespeeld = 0;
  let resultatenPerHole = [];
  let beslissingsStand = null;
  let beslissingsGespeeld = null;

  for (let i = 0; i < p.holes.length; i++) {
    const sA = p.scores[matchup.spelerA.uid][i];
    const sB = p.scores[matchup.spelerB.uid][i];
    if (sA === null || sB === null) { resultatenPerHole.push(null); continue; }
    gespeeld++;
    const slagA = matchup.hcpOntvanger === matchup.spelerA.uid ? getHcpSlagenOpHole(matchup, i) : 0;
    const slagB = matchup.hcpOntvanger === matchup.spelerB.uid ? getHcpSlagenOpHole(matchup, i) : 0;
    const nettoA = sA - slagA;
    const nettoB = sB - slagB;
    if (nettoA < nettoB) { standA++; resultatenPerHole.push('A'); }
    else if (nettoB < nettoA) { standA--; resultatenPerHole.push('B'); }
    else { resultatenPerHole.push('T'); }

    // Controleer of matchup op dit moment beslist is
    const resterendNa = p.holes.length - gespeeld;
    if (beslissingsStand === null && Math.abs(standA) > resterendNa) {
      beslissingsStand = standA;
      beslissingsGespeeld = gespeeld;
    }
  }

  const resterend = p.holes.length - gespeeld;
  const klaar = gespeeld === p.holes.length;
  const beslist = beslissingsStand !== null;

  // Als beslist: gebruik de stand op moment van beslissing (bevroren)
  const effectieveStand = beslist ? beslissingsStand : standA;
  const resterendOpBeslissing = beslist ? (p.holes.length - beslissingsGespeeld) : resterend;

  return { standA: effectieveStand, gespeeld, resterend: resterendOpBeslissing, resultatenPerHole, status: klaar && !beslist ? 'klaar' : beslist ? 'beslist' : 'lopend', beslissingsGespeeld };
}

// ============================================================
//  AMERIKAANTJE — puntberekening per hole (v3.0.0-11.97)
// ============================================================
// Geeft per speler het aantal punten op een hole terug.
// Volgorde: zelfde als p.spelers. Netto scores na HCP slagen.
// Punten: 4 voor laagste, 2 voor tweede, 0 voor hoogste.
// Gelijke scores delen de punten:
//   4-2-0 (alle verschillend)
//   3-3-0 (twee gelijk laagst)
//   4-1-1 (twee gelijk hoogst)
//   2-2-2 (alle gelijk)
function berekenAmerikaaanjeHole(holeIdx) {
  const p = mijnPartij();
  if (!p || p.speltype !== 'amerikaantje') return null;
  const netto = p.spelers.map(s => {
    const scoreArr = Array.isArray(p.scores?.[s.uid]) ? p.scores[s.uid] : [];
    const raw = scoreArr[holeIdx];
    if (raw === null || raw === undefined) return null;
    // HCP slagen: bereken via SI van de hole
    const hole = p.holes[holeIdx];
    const aantalHoles = p.holes.length;
    // Zoek de HCP voor deze speler — gebruik partijHcp
    const hcp = s.partijHcp ?? s.hcp ?? 0;
    // Alloceer slagen op basis van SI (zelfde methode als matchplay)
    const slagen = (hole.si <= Math.min(hcp, aantalHoles) ? 1 : 0) +
                   (hole.si <= Math.max(0, hcp - aantalHoles) ? 1 : 0);
    return raw - slagen;
  });

  // Als iemand geen score heeft: return null array
  if (netto.some(v => v === null)) return null;

  const gesorteerd = [...netto].sort((a, b) => a - b);
  const laagste = gesorteerd[0];
  const tweede  = gesorteerd[1];
  const hoogste = gesorteerd[2];

  return netto.map(n => {
    if (n === laagste && n === tweede && n === hoogste) return 2; // 2-2-2
    if (n === laagste && n === tweede) return 3;                  // 3-3-0
    if (n === tweede  && n === hoogste) return 1;                 // 4-1-1
    if (n === laagste) return 4;
    if (n === tweede)  return 2;
    return 0;
  });
}

// ============================================================
//  HIGH-LOW (v3.0.3)
//  2 teams van 2. Per hole: laagste net-bal per team (low) en
//  hoogste net-bal per team (high). Team met de lagere low krijgt
//  het low-punt; team met de lagere high krijgt het high-punt.
//  Gelijk = push (geen punt). Netto-slagen identiek aan Amerikaantje
//  (SI-allocatie op partijHcp). Geen ladder-effect.
// ============================================================
function netScoreHighlow(p, s, holeIdx) {
  const scoreArr = Array.isArray(p.scores?.[s.uid]) ? p.scores[s.uid] : [];
  const raw = scoreArr[holeIdx];
  if (raw === null || raw === undefined) return null;
  const hole = p.holes[holeIdx];
  const aantalHoles = p.holes.length;
  const hcp = s.partijHcp ?? s.hcp ?? 0;
  // Zelfde slag-allocatie als Amerikaantje/matchplay
  const slagen = (hole.si <= Math.min(hcp, aantalHoles) ? 1 : 0) +
                 (hole.si <= Math.max(0, hcp - aantalHoles) ? 1 : 0);
  return raw - slagen;
}

function berekenHighlowHole(holeIdx) {
  const p = mijnPartij();
  const _teams502 = teamsVan(p);
  if (!_teams502) return null;
  const teamNet = _teams502.map(team =>
    team.map(uid => {
      const s = p.spelers.find(sp => sp.uid === uid);
      if (!s) return null;
      return netScoreHighlow(p, s, holeIdx);
    })
  );
  // Alle 4 spelers moeten een score hebben op deze hole
  if (teamNet.some(t => t.some(v => v === null || v === undefined))) return null;
  const low  = teamNet.map(t => Math.min(...t));
  const high = teamNet.map(t => Math.max(...t));
  const punten = [0, 0];
  // Low-punt: laagste low wint; gelijk = push
  if (low[0] < low[1]) punten[0] += 1;
  else if (low[1] < low[0]) punten[1] += 1;
  // High-punt: laagste high wint; gelijk = push
  if (high[0] < high[1]) punten[0] += 1;
  else if (high[1] < high[0]) punten[1] += 1;
  return { teamPunten: punten, low, high };
}

function renderHighlowOverview() {
  const p = mijnPartij();
  const _t = teamsVan(p);
  if (!_t) return;
  const naamMap = kortNaamMap(p.spelers);
  let tA = 0, tB = 0;
  p.holes.forEach((_, hi) => {
    const hl = berekenHighlowHole(hi);
    if (hl) { tA += hl.teamPunten[0]; tB += hl.teamPunten[1]; }
  });
  const totals = [tA, tB];
  const maxPunten = p.holes.length * 2;
  const teamNamen = _t.map(team => team.map(uid => naamMap[uid] || '?').join(' & '));
  let html = '<div style="padding:12px 12px 4px">';
  [0, 1].forEach(ti => {
    const pts = totals[ti];
    const leidt = totals[0] !== totals[1] && totals[ti] > totals[1 - ti];
    const breedte = maxPunten > 0 ? Math.round((pts / maxPunten) * 100) : 0;
    const kleur = leidt ? 'var(--green)' : 'var(--mid)';
    html += `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-weight:${leidt ? '700' : '400'};color:${leidt ? 'var(--green)' : 'inherit'}">Team ${ti + 1} · ${esc(teamNamen[ti])}</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:16px;color:${kleur}">${pts} <span style="font-size:11px;font-weight:400;color:var(--light)">pt</span></span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px">
        <div style="height:6px;background:${kleur};border-radius:3px;width:${breedte}%;transition:width 0.4s"></div>
      </div>
    </div>`;
  });
  html += '</div>';
  document.getElementById('match-overview').innerHTML = html;
}

function renderAmerikaaanjeOverview() {
  const p = mijnPartij();
  if (!p) return;
  const naamMap = kortNaamMap(p.spelers);
  // Bereken totalen per speler
  const totalen = {};
  p.spelers.forEach(s => { totalen[s.uid] = 0; });
  p.holes.forEach((_, holeIdx) => {
    const punten = berekenAmerikaaanjeHole(holeIdx);
    if (!punten) return;
    p.spelers.forEach((s, si) => { totalen[s.uid] += punten[si]; });
  });

  // Sorteer op punten aflopend
  const gesorteerd = [...p.spelers].sort((a, b) => totalen[b.uid] - totalen[a.uid]);

  const maxPunten = p.holes.length * 6;
  let html = '<div style="padding:12px 12px 4px">';
  gesorteerd.forEach((s, pos) => {
    const pts = totalen[s.uid];
    const breedte = maxPunten > 0 ? Math.round((pts / maxPunten) * 100) : 0;
    const kleur = pos === 0 ? 'var(--green)' : pos === 1 ? 'var(--gold)' : 'var(--mid)';
    html += `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-weight:${pos === 0 ? '700' : '400'};color:${pos === 0 ? 'var(--green)' : 'inherit'}">${esc(naamMap[s.uid])}</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:16px;color:${kleur}">${pts} <span style="font-size:11px;font-weight:400;color:var(--light)">pt</span></span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px">
        <div style="height:6px;background:${kleur};border-radius:3px;width:${breedte}%;transition:width 0.4s"></div>
      </div>
    </div>`;
  });
  html += '</div>';
  document.getElementById('match-overview').innerHTML = html;
}

function renderMatchOverview() {
  const p = mijnPartij();
  if (!p) return;
  // v3.0.0-11.97: Amerikaantje heeft eigen overzicht
  if (p.speltype === 'amerikaantje') { renderAmerikaaanjeOverview(); return; }
  // v3.0.3: High-Low eigen team-overzicht
  if (p.speltype === 'highlow') { renderHighlowOverview(); return; }
  const naamMap = kortNaamMap(p.spelers);
  let html = '';
  p.matchups.forEach(m => {
    const { standA, resterend, status } = berekenMatchStand(m);
    const nA = naamMap[m.spelerA.uid];
    const nB = naamMap[m.spelerB.uid];

    let scoreText, scoreLeadA, scoreLeadB;
    if (status === 'beslist' || status === 'klaar') {
      const up = Math.abs(standA);
      if (status === 'beslist') {
        scoreText = `${up}&${resterend}`;
      } else {
        scoreText = standA === 0 ? 'TIED' : `${up}&0`;
      }
      scoreLeadA = standA > 0;
      scoreLeadB = standA < 0;
    } else if (standA === 0) {
      scoreText = 'TIED'; scoreLeadA = false; scoreLeadB = false;
    } else if (standA > 0) {
      scoreText = `${standA} UP`; scoreLeadA = true; scoreLeadB = false;
    } else {
      scoreText = `${Math.abs(standA)} DOWN`; scoreLeadA = false; scoreLeadB = true;
    }

    // Statusregel
    let statusLabel;
    if (status === 'klaar' && standA === 0) statusLabel = 'Gelijkspel';
    else if (status === 'klaar') statusLabel = `${standA > 0 ? nA : nB} wint`;
    else if (status === 'beslist') {
      statusLabel = `${standA > 0 ? nA : nB} wint`;
    } else {
      statusLabel = resterend + ' te gaan';
    }

    const naamA_style = scoreLeadA ? 'font-weight:700;color:var(--green)' : '';
    const naamB_style = scoreLeadB ? 'font-weight:700;color:var(--green)' : '';
    const scoreStyle = scoreLeadA ? 'background:var(--green-pale);color:var(--green)' : scoreLeadB ? 'background:var(--green-pale);color:var(--green)' : '';
    const matchIdx = p.matchups.indexOf(m);
    const hcpInfo = `<span style="font-size:10px;color:var(--light)">${m.hcpSlagen > 0 ? esc((m.hcpOntvanger === m.spelerA.uid ? nA : nB)) + ' +' + m.hcpSlagen + ' slag' + (m.hcpSlagen > 1 ? 'en' : '') : 'Gelijke handicap'} <span onclick="editMatchupSlagen(${matchIdx})" style="cursor:pointer;opacity:0.6" title="Slagen aanpassen">✏️</span></span>`;

    html += `<div class="match-card">
      <div style="flex:1;min-width:0">
        <div class="match-player" style="${naamA_style};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nA)}</div>
        ${hcpInfo}
      </div>
      <div style="text-align:center;flex:0 0 90px">
        <div class="match-score" style="${scoreStyle};font-size:13px;padding:4px 6px">${esc(scoreText)}</div>
        <div style="font-size:10px;color:${status === 'beslist' ? 'var(--green)' : 'var(--light)'};margin-top:2px;font-weight:${status === 'beslist' ? '600' : '400'};white-space:nowrap">${esc(statusLabel)}</div>
      </div>
      <div class="match-player right" style="${naamB_style};flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right">${esc(nB)}</div>
    </div>`;
  });
  document.getElementById('match-overview').innerHTML = html || '<div class="empty"><p>Voer scores in om de stand te zien.</p></div>';
}

// ============================================================
//  SPELER TOEVOEGEN / VERWIJDEREN TIJDENS RONDE
// ============================================================
function openToevoegenModal() {
  const p = mijnPartij();
  if (!p) return;
  const bezig = new Set(p.spelers.map(s => s.uid));
  const ladderSpelers = getLadderSpelers(p.ladderId);
  const beschikbaar = ladderSpelers
    .filter(s => !bezig.has(s.uid))
    .sort((a,b) => a.rank - b.rank);

  if (beschikbaar.length === 0) { toast('Alle spelers zijn al in de partij'); return; }

  const sel = document.getElementById('toevoegen-speler-select');
  sel.innerHTML = '<option value="">— Kies speler —</option>' +
    beschikbaar.map(s => `<option value="${s.uid}">${s.naam} (hcp ${Math.round(s.hcp)})</option>`).join('');
  document.getElementById('toevoegen-speler-hcp').value = '';

  sel.onchange = function() {
    const s = ladderSpelers.find(x => x.uid === this.value);
    if (s) document.getElementById('toevoegen-speler-hcp').value = Math.round(s.hcp);
  };

  document.getElementById('modal-toevoegen-ronde').classList.add('open');
}

async function bevestigToevoegenRonde() {

  try {
  const p = mijnPartij();
  if (!p) return;
  const sel = document.getElementById('toevoegen-speler-select');
  const hcpVal = Math.round(parseFloat(document.getElementById('toevoegen-speler-hcp').value));
  const ladderSpelersT = getLadderSpelers(p.ladderId);
  const speler = ladderSpelersT.find(s => s.uid === sel.value);
  if (!speler) { toast('Kies een speler'); return; }
  if (isNaN(hcpVal)) { toast('Voer een handicap in'); return; }

  const nieuweSpeler = { uid: speler.uid, naam: speler.naam, hcp: hcpVal, partijHcp: hcpVal };

  // Nieuwe matchups aanmaken met alle huidige spelers
  p.spelers.forEach(bestaande => {
    const hcpDiff = Math.round(Math.abs(bestaande.partijHcp - hcpVal) * 0.75);
    const hoger = bestaande.partijHcp > hcpVal ? bestaande : nieuweSpeler;
    p.matchups.push({
      id: `${bestaande.uid}-${speler.uid}`,
      spelerA: bestaande, spelerB: nieuweSpeler,
      hcpOntvanger: hoger.uid,
      hcpSlagen: hcpDiff
    });
  });

  // Speler en lege scores toevoegen
  p.spelers.push(nieuweSpeler);
  p.scores[speler.uid] = Array(p.holes.length).fill(null);

  // v5.0.0 (punt 4): ook een leeg scoredocument voor de nieuwe speler, en de
  // gewijzigde matchups in het partij-document bijwerken (de server gebruikt
  // die om de uitslag te controleren).
  try {
    await voegSpelerToeAanPartij(p.ladderId, p.partijId, nieuweSpeler, p.holes.length);
    await maakPartijDocument(p.ladderId, p);
  } catch(e) { console.warn('partij-document bijwerken mislukt:', e?.code || e); }

  await slaActievePartijenOp(p.ladderId);
  closeModal('modal-toevoegen-ronde');
  renderRonde();
  toast(`${speler.naam.split(' ')[0]} toegevoegd ✓`);
  } catch(e) { console.error('bevestigToevoegenRonde mislukt:', e); }
}

async function editPartijHcp(spelerId) {

  try {
  const p = mijnPartij();
  if (!p) return;
  const speler = p.spelers.find(s => s.uid === spelerId);
  if (!speler) return;
  const nieuw = prompt(`Playing handicap voor ${speler.naam}:`, Math.round(speler.partijHcp));
  if (nieuw === null) return;
  const val = parseFloat(nieuw);
  if (isNaN(val)) { toast('Ongeldige handicap'); return; }
  speler.partijHcp = val;
  // Herbereken matchup slagen
  p.matchups.forEach(m => {
    const a = p.spelers.find(s => s.uid === m.spelerA.uid);
    const b = p.spelers.find(s => s.uid === m.spelerB.uid);
    if (!a || !b) return;
    const hcpDiff = Math.round(Math.abs(a.partijHcp - b.partijHcp) * 0.75);
    const hoger = a.partijHcp > b.partijHcp ? a : b;
    m.hcpOntvanger = hoger.uid;
    m.hcpSlagen = hcpDiff;
  });
  // v5.0.0: de server controleert de uitslag tegen de matchups in het
  // partij-document, dus die moet mee als de slagen wijzigen.
  await synchroniseerPartijDoc(p);
  await slaActievePartijenOp(p.ladderId);
  renderRonde();
  toast(`Handicap ${speler.naam.split(' ')[0]} bijgewerkt ✓`);
  } catch(e) { console.error('editPartijHcp mislukt:', e); }
}

// ============================================================
//  Partij-document bijwerken (v5.0.0, punt 4)
//  Aanroepen zodra de METADATA van een lopende partij verandert: spelers,
//  matchups, handicapslagen, speltype. De scores zelf gaan niet via deze weg —
//  die staan per speler in de scores-subcollectie.
// ============================================================
async function synchroniseerPartijDoc(p) {
  if (!p?.ladderId || !p?.partijId) return;
  try { await maakPartijDocument(p.ladderId, p); }
  catch (e) { console.warn('[synchroniseerPartijDoc] mislukt:', e?.code || e); }
}

async function verwijderSpelerUitRonde(spelerId) {

  try {
  const p = mijnPartij();
  if (!p) return;
  // v3.0.0-11.22: String-vergelijking consistent met bevestigToevoegenRonde
  // (later toegevoegde spelers kunnen een numeric id hebben, knop geeft string)
  const speler = p.spelers.find(s => s.uid === spelerId);
  if (!speler) return;
  // v3.0.3: High-Low vereist exact 4 spelers (2 teams van 2) — verwijderen niet mogelijk
  if (p.speltype === 'highlow') { toast('High-Low vereist 4 spelers — verwijderen niet mogelijk'); return; }
  if (p.spelers.length <= 2) { toast('Minimaal 2 spelers nodig'); return; }

  // v3.0.0-11.98: Amerikaantje 3→2: omzetten naar matchplay
  const wordtMatchplay = p.speltype === 'amerikaantje' && p.spelers.length === 3;
  if (wordtMatchplay) {
    if (!confirm(`${speler.naam.split(' ')[0]} verwijderen? De partij wordt omgezet naar matchplay en telt mee voor de ladder.`)) return;
  } else {
    if (!confirm(`${speler.naam.split(' ')[0]} verwijderen uit de partij?`)) return;
  }

  p.spelers = p.spelers.filter(s => s.uid !== spelerId);
  p.matchups = p.matchups.filter(m =>
    m.spelerA.uid !== spelerId &&
    m.spelerB.uid !== spelerId
  );
  delete p.scores[spelerId];
  delete p.scores[speler.uid]; // veiligheid

  // v5.0.0 (punt 4): scoredocument van deze speler opruimen.
  try { await verwijderSpelerUitPartijDoc(p.ladderId, p.partijId, spelerId); }
  catch(e) { console.warn('scoredocument verwijderen mislukt:', e?.code || e); }

  if (wordtMatchplay) {
    // Zet speltype om naar matchplay
    p.speltype = 'matchplay';
    // Maak matchup aan voor de twee overgebleven spelers
    const [a, b] = p.spelers;
    const hcpDiff = Math.round(Math.abs(a.partijHcp - b.partijHcp) * 0.75);
    const hoger = a.partijHcp > b.partijHcp ? a : b;
    p.matchups = [{
      id: `${a.uid}-${b.uid}`,
      spelerA: a,
      spelerB: b,
      hcpOntvanger: hoger.uid,
      hcpSlagen: hcpDiff
    }];
    // Reconstrueer match-stand over reeds gespeelde holes via berekenMatchStand()
    // — dat werkt automatisch zodra matchup aanwezig is en scores bestaan.
    await synchroniseerPartijDoc(p);
    await slaActievePartijenOp(p.ladderId);
    renderRonde();
    toast(`${speler.naam.split(' ')[0]} verwijderd · Omgezet naar matchplay ⚡`);
  } else {
    await synchroniseerPartijDoc(p);
    await slaActievePartijenOp(p.ladderId);
    renderRonde();
    toast(`${speler.naam.split(' ')[0]} verwijderd uit partij`);
  }
  } catch(e) { console.error('verwijderSpelerUitRonde mislukt:', e); }
}

// ============================================================
//  UITSLAG MODAL
// ============================================================
// ============================================================
//  AMERIKAANTJE — uitslag (v3.0.0-11.97)
//  Geen ranking-effect. Toon eindstand en sla archief op.
// ============================================================
// v5.7.0: de eindstand die bevestigd gaat worden. Wordt voorgevuld uit de
// punten als er volledig ingevulde holes zijn, en anders bewust LEEG gelaten —
// zonder scorekaart moet iemand de uitslag aanwijzen. Zou hij "alle drie
// gelijk" voorinvullen, dan levert één tik op bevestigen drie overwinningen op
// zonder dat er iets gespeeld is.
let _eindstandKeuze = null;

function _volledigeHoles(p) {
  if (!p || !Array.isArray(p.holes)) return 0;
  const uids = (p.spelers || []).map(s => s.uid);
  let n = 0;
  p.holes.forEach((_, hi) => {
    const vol = uids.every(u => {
      const a = p.scores?.[u];
      return Array.isArray(a) && a[hi] !== null && a[hi] !== undefined && a[hi] !== '';
    });
    if (vol) n++;
  });
  return n;
}

// Punten -> posities met gedeelde plekken volgens sportgebruik (1,1,3 / 1,2,2).
function _positiesUitPunten(uids, punten) {
  const gesorteerd = [...uids].sort((a, b) => punten[b] - punten[a]);
  const pos = {};
  gesorteerd.forEach((u, i) => {
    const gelijkAanVorige = i > 0 && punten[u] === punten[gesorteerd[i - 1]];
    pos[u] = gelijkAanVorige ? pos[gesorteerd[i - 1]] : i + 1;
  });
  return pos;
}

function zetAmerikaaanjePositie(uid, positie) {
  if (!_eindstandKeuze) _eindstandKeuze = {};
  _eindstandKeuze[uid] = positie;
  renderAmerikaaanjeKeuze();
}

// v5.7.2: staat de eindstand al vast uit de scorekaart, dan zijn de knoppen
// alleen ruis — je bevestigt dan, je vult niets in. Ze zitten daarom verstopt
// achter "Eindstand aanpassen". Zonder scorekaart staan ze meteen open, want
// dan MOET er iemand aanwijzen.
let _keuzeOpen = false;

function toonEindstandKeuze() {
  _keuzeOpen = true;
  renderAmerikaaanjeKeuze();
  renderHighlowKeuze();
}

function renderAmerikaaanjeKeuze() {
  const p = mijnPartij();
  if (!p) return;
  const el0 = document.getElementById('amerikaantje-keuze');
  if (!el0) return;
  const naamMap = kortNaamMap(p.spelers);
  const keuze = _eindstandKeuze || {};
  if (!_keuzeOpen && _amerikaaantjeStandGeldig()) {
    el0.innerHTML = `
      <p style="font-size:12px;color:var(--light);margin:0 0 4px">
        Eindstand volgens de scorekaart. Winnaar +2 · tweede 0 · derde −2.</p>
      <button type="button" class="aanpas-link" onclick="toonEindstandKeuze()">Eindstand aanpassen</button>`;
    return;
  }
  let html = '<div style="font-size:12px;color:var(--light);margin-bottom:8px">Eindstand — tik de plek aan. Gedeelde plekken mogen.</div>';
  p.spelers.forEach(s => {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0ede4">
      <span style="font-weight:600">${esc(naamMap[s.uid])}</span>
      <span style="display:flex;gap:6px">
        ${[1,2,3].map(n => `<button type="button" class="btn btn-sm keuze-knop${keuze[s.uid]===n ? ' keuze-actief' : ''}"
            style="min-width:36px"
            onclick="zetAmerikaaanjePositie('${escAttr(s.uid)}',${n})">${n}e</button>`).join('')}
      </span>
    </div>`;
  });
  const geldig = _amerikaaantjeStandGeldig();
  html += `<p style="font-size:12px;margin-top:10px;color:${geldig ? 'var(--light)' : 'var(--red)'}">
    ${geldig ? 'Winnaar +2 · tweede 0 · derde −2. Gedeelde plekken hebben eigen waarden — zie Help.'
             : 'Kies een geldige eindstand: 1-2-3, of een gedeelde plek (1-1-3, 1-2-2, 1-1-1).'}</p>`;
  el0.innerHTML = html;
}

function _amerikaaantjeStandGeldig() {
  const p = mijnPartij();
  if (!p || !_eindstandKeuze) return false;
  const rij = p.spelers.map(s => _eindstandKeuze[s.uid]);
  if (rij.some(x => !x)) return false;
  const sleutel = rij.slice().sort((a, b) => a - b).join(',');
  return ['1,2,3', '1,1,3', '1,2,2', '1,1,1'].includes(sleutel);
}

function openAmerikaaanjeUitslagModal() {
  const p = mijnPartij();
  if (!p) return;
  const naamMap = kortNaamMap(p.spelers);

  // Bereken eindpunten
  const totaalPunten = {};
  p.spelers.forEach(s => { totaalPunten[s.uid] = 0; });
  p.holes.forEach((_, hi) => {
    const pt = berekenAmerikaaanjeHole(hi);
    if (!pt) return;
    p.spelers.forEach((s, si) => { totaalPunten[s.uid] += pt[si]; });
  });

  const metScores = _volledigeHoles(p) > 0;
  _eindstandKeuze = metScores
    ? _positiesUitPunten(p.spelers.map(s => s.uid), totaalPunten)
    : null;

  const gesorteerd = [...p.spelers].sort((a, b) => totaalPunten[b.uid] - totaalPunten[a.uid]);

  let html = '<div style="margin-bottom:16px">';
  gesorteerd.forEach((s) => {
    const pos = _eindstandKeuze ? _eindstandKeuze[s.uid] : null;
    const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : '·';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0ede4">
      <span style="font-weight:${pos===1?'700':'400'}">${medal} ${esc(naamMap[s.uid])}</span>
      <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:18px">${totaalPunten[s.uid]} <span style="font-size:12px;font-weight:400;color:var(--light)">pt</span></span>
    </div>`;
  });
  html += '</div>';
  if (!metScores) {
    html += `<p style="font-size:12px;color:var(--red);margin-bottom:8px">
      Geen volledig ingevulde holes — wijs de eindstand zelf aan.</p>`;
  }
  html += '<div id="amerikaantje-keuze"></div>';

  document.getElementById('modal-matches').innerHTML = html;
  document.getElementById('modal-uitslag').classList.add('open');
  _keuzeOpen = !metScores;   // v5.7.2: zonder kaart meteen open
  renderAmerikaaanjeKeuze();
  p._isAmerikaaantje = true;
}

// ============================================================
//  HIGH-LOW — uitslag (v3.0.3)
//  Geen ranking-effect. Toon team-eindstand en sla archief op.
// ============================================================
function openHighlowUitslagModal() {
  const p = mijnPartij();
  const _t2 = teamsVan(p);
  if (!_t2) return;
  const naamMap = kortNaamMap(p.spelers);
  let tA = 0, tB = 0;
  p.holes.forEach((_, hi) => {
    const hl = berekenHighlowHole(hi);
    if (hl) { tA += hl.teamPunten[0]; tB += hl.teamPunten[1]; }
  });
  const totals = [tA, tB];
  const teamNamen = _t2.map(team => team.map(uid => naamMap[uid] || '?').join(' & '));
  const volgorde = totals[0] >= totals[1] ? [0, 1] : [1, 0];
  const gelijk = totals[0] === totals[1];

  let html = '<div style="margin-bottom:16px">';
  volgorde.forEach((ti, pos) => {
    const medal = gelijk ? '🤝' : (pos === 0 ? '🥇' : '🥈');
    const winnend = !gelijk && pos === 0;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0ede4">
      <span style="font-weight:${winnend ? '700' : '400'}">${medal} Team ${ti + 1} · ${esc(teamNamen[ti])}</span>
      <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:18px">${totals[ti]} <span style="font-size:12px;font-weight:400;color:var(--light)">pt</span></span>
    </div>`;
  });
  html += '</div>';
  // v5.7.0: aanwijsstap, net als bij matchplay. Met een ingevulde kaart staat
  // het winnende team al goed; zonder kaart moet je het zelf aanwijzen.
  const metScores = _volledigeHoles(p) > 0;
  _eindstandKeuze = metScores ? { winnendTeam: gelijk ? null : volgorde[0] } : null;
  if (!metScores) {
    html += `<p style="font-size:12px;color:var(--red);margin-bottom:8px">
      Geen volledig ingevulde holes — wijs zelf aan wie er won.</p>`;
  }
  html += '<div id="highlow-keuze"></div>';

  document.getElementById('modal-matches').innerHTML = html;
  document.getElementById('modal-uitslag').classList.add('open');
  _keuzeOpen = !metScores;   // v5.7.2: zonder kaart meteen open
  renderHighlowKeuze();
}

function zetHighlowWinnaar(waarde) {
  _eindstandKeuze = { winnendTeam: waarde };
  renderHighlowKeuze();
}

function renderHighlowKeuze() {
  const el = document.getElementById('highlow-keuze');
  if (!el) return;
  const p = mijnPartij();
  const teams = teamsVan(p);
  if (!teams) { el.innerHTML = ''; return; }

  const gekozen = _eindstandKeuze ? _eindstandKeuze.winnendTeam : undefined;
  const gekend = gekozen === 0 || gekozen === 1 || gekozen === null;

  // v5.7.2: de teams bij naam, in dezelfde volgorde als de standenlijst
  // erboven. Stond daar "Team 2" bovenaan en op de knoppen "Team 1" eerst,
  // dan moest je zelf omrekenen wie ook alweer welk team was.
  const naamMap = kortNaamMap(p.spelers);
  const teamNaam = ti => teams[ti].map(uid => naamMap[uid] || '?').join(' & ');

  if (!_keuzeOpen && gekend) {
    const tekst = gekozen === null
      ? 'Gelijkspel volgens de scorekaart. Er verandert niets aan de ladder.'
      : `${esc(teamNaam(gekozen))} wint volgens de scorekaart. Winnaars +1 plek, verliezers −1.`;
    el.innerHTML = `
      <p style="font-size:12px;color:var(--light);margin:0 0 4px">${tekst}</p>
      <button type="button" class="aanpas-link" onclick="toonEindstandKeuze()">Uitslag aanpassen</button>`;
    return;
  }

  const knop = (waarde, tekst) => `<button type="button" class="btn btn-sm keuze-knop${gekozen === waarde ? ' keuze-actief' : ''}"
      onclick="zetHighlowWinnaar(${waarde === null ? 'null' : waarde})">${tekst}</button>`;
  // Winnend team eerst, net als in de lijst erboven.
  const eerst = (gekozen === 0 || gekozen === 1) ? gekozen : 0;
  const tweede = eerst === 0 ? 1 : 0;
  el.innerHTML = `
    <div style="font-size:12px;color:var(--light);margin-bottom:8px">Wie won?</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${knop(eerst, esc(teamNaam(eerst)))}${knop(tweede, esc(teamNaam(tweede)))}${knop(null, 'Gelijkspel')}
    </div>
    <p style="font-size:12px;color:var(--light);margin-top:10px">
      Winnaars +1 plek, verliezers −1. Bij gelijkspel verandert er niets.</p>`;
}

function openUitslagModal() {
  const p = mijnPartij();
  if (!p) return;
  // v3.0.0-11.97: Amerikaantje heeft vereenvoudigde afsluit-modal
  if (p.speltype === 'amerikaantje') { openAmerikaaanjeUitslagModal(); return; }
  // v3.0.3: High-Low eigen afsluit-modal
  if (p.speltype === 'highlow') { openHighlowUitslagModal(); return; }
  const naamMap = kortNaamMap(p.spelers);
  let html = '';
  p.matchups.forEach((m, idx) => {
    const { standA, gespeeld } = berekenMatchStand(m);
    const nA = naamMap[m.spelerA.uid];
    const nB = naamMap[m.spelerB.uid];
    let winnaar = standA > 0 ? 'A' : standA < 0 ? 'B' : null;

    const heeftGast = m.spelerA.uid?.startsWith('gast_') || m.spelerB.uid?.startsWith('gast_');
    html += `<div id="matchup-row-${idx}" style="padding:12px 0;border-bottom:1px solid #f0ede4">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600">${esc(m.spelerA.naam)} vs ${esc(m.spelerB.naam)}</span>
        <button onclick="skipMatchup(${idx})" id="skip-${idx}" class="btn btn-sm btn-ghost" style="color:var(--red);border-color:#f5c6cb;font-size:11px;padding:4px 8px" title="Matchup overslaan">✕ overslaan</button>
      </div>
      ${heeftGast ? `<p style="font-size:11px;color:var(--light);font-style:italic;margin-bottom:6px">⚠️ Gastspeler — telt niet mee voor ladderstand</p>` : ''}`;

    if (gespeeld === 0 || standA === 0) {
      const label = gespeeld === 0 ? 'Geen scores — kies de winnaar of sla over' : `⚡ Gelijkspel (${gespeeld} holes) — kies de winnaar`;
      html += `<p style="font-size:12px;color:var(--gold);margin-bottom:6px">${label}</p>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${winnaar === 'A' ? 'btn-primary' : 'btn-ghost'}"
            onclick="setWinnaar(${idx},'A')" id="win-${idx}-A">${esc(nA)} wint</button>
          <button class="btn btn-sm ${winnaar === 'B' ? 'btn-primary' : 'btn-ghost'}"
            onclick="setWinnaar(${idx},'B')" id="win-${idx}-B">${esc(nB)} wint</button>
        </div>`;
    } else {
      const winnaarNaam = standA > 0 ? m.spelerA.naam : m.spelerB.naam;
      const marge = Math.abs(standA);
      html += `<span class="badge badge-green">✓ ${esc(winnaarNaam)} wint (${gespeeld} holes, ${marge} up)</span>`;
    }
    html += `</div>`;
  });

  document.getElementById('modal-matches').innerHTML = html;
  document.getElementById('modal-uitslag').classList.add('open');

  // Bepaal winnaars en timestamps — automatisch bepaalde winnaars krijgen
  // timestamp op basis van wanneer de beslissende hole gespeeld werd
  p._modalWinnaars = p.matchups.map(m => {
    const { standA } = berekenMatchStand(m);
    if (standA > 0) return 'A';
    if (standA < 0) return 'B';
    return null;
  });
  // Timestamp per matchup — bepaalt verwerkingsvolgorde
  p._modalTimestamps = p.matchups.map((m, idx) => {
    const winnaar = p._modalWinnaars[idx];
    if (!winnaar) return Infinity; // handmatig, nog niet bepaald
    // Zoek de laatste ingevulde hole van de winnaar of verliezer
    const spelerA = m.spelerA, spelerB = m.spelerB;
    const scoresA = p.scores[spelerA.uid] || [];
    const scoresB = p.scores[spelerB.uid] || [];
    // Gebruik het aantal ingevulde holes als proxy voor tijdvolgorde
    const ingevuld = scoresA.filter(v => v !== null).length + scoresB.filter(v => v !== null).length;
    return ingevuld > 0 ? -ingevuld : Infinity; // meer holes = eerder klaar
  });
  p._modalSkipped = new Array(p.matchups.length).fill(false);
}

function setWinnaar(idx, kant) {
  const p = mijnPartij();
  p._modalWinnaars[idx] = kant;
  // Sla tijdstip op voor verwerkingsvolgorde
  if (!p._modalTimestamps) p._modalTimestamps = new Array(p.matchups.length).fill(Infinity);
  p._modalTimestamps[idx] = Date.now();
  const naamMap = kortNaamMap(p.spelers);
  const nA = naamMap[p.matchups[idx].spelerA.uid];
  const nB = naamMap[p.matchups[idx].spelerB.uid];
  document.getElementById('win-'+idx+'-A').textContent = nA + ' wint';
  document.getElementById('win-'+idx+'-B').textContent = nB + ' wint';
  document.getElementById('win-'+idx+'-A').className = `btn btn-sm ${kant === 'A' ? 'btn-primary' : 'btn-ghost'}`;
  document.getElementById('win-'+idx+'-B').className = `btn btn-sm ${kant === 'B' ? 'btn-primary' : 'btn-ghost'}`;
}

function skipMatchup(idx) {
  const p = mijnPartij();
  if (!p) return;
  p._modalSkipped[idx] = !p._modalSkipped[idx];
  const row = document.getElementById(`matchup-row-${idx}`);
  const btn = document.getElementById(`skip-${idx}`);
  if (p._modalSkipped[idx]) {
    row.style.opacity = '0.4';
    row.style.textDecoration = 'line-through';
    btn.textContent = '↩ herstellen';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'var(--green-pale)';
  } else {
    row.style.opacity = '';
    row.style.textDecoration = '';
    btn.textContent = '✕ overslaan';
    btn.style.color = 'var(--red)';
    btn.style.borderColor = '#f5c6cb';
  }
}

// ============================================================
//  v5.7.0 — AFRONDEN VAN AMERIKAANTJE EN HIGH-LOW
// ============================================================
//  Volgorde is hier wezenlijk: EERST de ladder laten verwerken, pas daarna de
//  partij opruimen. Tot v5.6.x werd de partij eerst verwijderd; ging het
//  verwerken dan mis, dan was zowel de partij als de uitslag weg.
// ============================================================
async function _rondSpelvormAf(p, eindstand, archief, meldingKlaar) {
  let spelerRegels = [];
  try {
    const res = await _verwerkPartijUitslagFn({
      ladderId: p.ladderId,
      partijId: p.partijId,
      isTest: IS_TEST,
      eindstand,
    });
    spelerRegels = res?.data?.spelerRegels || [];

    // v5.7.0: alleen een uitslag wegschrijven als de server hem ECHT verwerkt
    // heeft. Bevestigen twee spelers uit dezelfde flight, dan meldt de server
    // "al verwerkt" en bleef de ladder terecht ongemoeid — maar de client
    // schreef daarna alsnog een uitslagvermelding weg, en die telde mee als
    // extra gespeelde partij en extra ontmoetingen voor de activiteitsbonus.
    if (!res?.data?.alVerwerkt) {
      _schrijfSpelvormUitslag(p, archief);
    }
  } catch (e) {
    console.error('verwerkPartijUitslag (spelvorm) mislukt:', e);
    toast(e?.message && e.code !== 'internal'
      ? e.message
      : 'Ladderstand bijwerken mislukt — de partij blijft staan. Probeer opnieuw.');
    return false;
  }

  // Scorekaart bewaren (30 dagen) — niet kritisch voor de ladder.
  try { await addDoc(UITSLAGEN_COL, archief.scorekaart); }
  catch (e) { console.error('Scorekaart bewaren mislukt:', e); }

  // Pas nu opruimen.
  const lIdx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (lIdx >= 0) {
    alleLadders[lIdx].actievePartijen = (alleLadders[lIdx].actievePartijen || [])
      .filter(ap => ap.partijId !== p.partijId);
  }
  _verwijderdePartijIds.add(p.partijId);
  await verwijderPartijMetRetry(p.ladderId, p.partijId);

  closeModal('modal-uitslag');
  renderRonde();
  if (spelerRegels.length) {
    showLadderChanges([], spelerRegels);
  } else {
    document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.getElementById('page-ladder').classList.add('active');
    document.querySelector('nav button').classList.add('active');
    renderLadder();
  }
  toast(meldingKlaar);
  return true;
}

// De samenvatting in het ladderdocument. Hier vandaan haalt het
// activiteitssysteem "gespeelde partij" (spelerUids) en "ontmoetingen"
// (matchupUids). Gasten blijven eruit: die zouden anders als telkens nieuwe
// unieke tegenstander tellen en de diversiteitsbonus opblazen.
function _schrijfSpelvormUitslag(p, archief) {
  const echteUids = (p.spelers || []).map(s => s.uid)
    .filter(u => u && !String(u).startsWith('gast_'));
  const paren = [];
  for (let i = 0; i < echteUids.length; i++)
    for (let j = i + 1; j < echteUids.length; j++)
      paren.push({ a: echteUids[i], b: echteUids[j] });

  const uitslag = {
    datum: new Date().toLocaleDateString('nl-NL'),
    scoreTs: Date.now(),
    baan: p.baan,
    ladderId: p.ladderId,   // nodig om vanaf het uitslagenscherm terug te draaien
    partijId: p.partijId,
    speltype: p.speltype,
    spelers: (p.spelers || []).map(s => s.naam),
    spelerUids: echteUids,
    matchups: [],           // geen verzonnen partijtjes op het uitslagenscherm
    matchupUids: paren,     // wel de ontmoetingen voor de diversiteitsbonus
    eindstand: archief.eindstandRegels || [],
  };
  const idx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (idx >= 0) {
    if (!alleLadders[idx].data) alleLadders[idx].data = {};
    if (!alleLadders[idx].data.uitslagen) alleLadders[idx].data.uitslagen = [];
    alleLadders[idx].data.uitslagen.unshift(uitslag);
    slaUitslagenOp(p.ladderId).catch(e => console.error('uitslag bewaren mislukt:', e));
  }
}

async function bevestigUitslag() {
  let _alVerwerkt = false;
  console.log('[bevestig] bevestigUitslag gestart');
  const p = mijnPartij();
  if (!p) { console.warn('[bevestig] geen mijnPartij — abort'); return; }

  // v5.7.0: Amerikaantje telt nu mee voor de ladder.
  if (p.speltype === 'amerikaantje') {
    if (!_amerikaaantjeStandGeldig()) {
      toast('Wijs eerst de eindstand aan (1-2-3, of een gedeelde plek)');
      return;
    }
    const totaalPunten = {};
    p.spelers.forEach(s2 => { totaalPunten[s2.uid] = 0; });
    p.holes.forEach((_, hi) => {
      const pt = berekenAmerikaaanjeHole(hi);
      if (!pt) return;
      p.spelers.forEach((s2, si) => { totaalPunten[s2.uid] += pt[si]; });
    });
    const posities = p.spelers.map(s2 => ({ uid: s2.uid, positie: _eindstandKeuze[s2.uid] }));
    await _rondSpelvormAf(p,
      { speltype: 'amerikaantje', posities },
      {
        eindstandRegels: posities.map(x => ({ uid: x.uid, positie: x.positie })),
        scorekaart: {
          type: 'amerikaantje',
          ladderId: p.ladderId,
          datum: new Date().toISOString(),
          timestamp: Date.now(),
          baan: p.baan,
          holes: p.holes,
          spelers: p.spelers.map(s2 => ({ naam: s2.naam, hcp: s2.partijHcp, punten: totaalPunten[s2.uid] })),
          spelerIds: p.spelers.map(s2 => s2.uid),
          scores: p.scores,
        },
      },
      'Amerikaantje afgerond! 🏌️');
    return;
  }

  // v5.7.0: High-Low telt nu mee voor de ladder.
  if (p.speltype === 'highlow') {
    if (!_eindstandKeuze || _eindstandKeuze.winnendTeam === undefined) {
      toast('Wijs eerst aan wie er won, of kies gelijkspel');
      return;
    }
    let tA = 0, tB = 0;
    p.holes.forEach((_, hi) => {
      const hl = berekenHighlowHole(hi);
      if (hl) { tA += hl.teamPunten[0]; tB += hl.teamPunten[1]; }
    });
    const naamMap = kortNaamMap(p.spelers);
    const _teams = teamsVan(p) || [[], []];
    const teamVan = {};
    _teams.forEach((team, ti) => team.forEach(uid => { teamVan[uid] = ti; }));

    // v5.7.1: alleen WIE er won gaat naar de server. De teamindeling leidt hij
    // zelf af uit de spelersvolgorde in het partij-document, zodat een
    // gemanipuleerde app zichzelf niet in het winnende team kan zetten.
    await _rondSpelvormAf(p,
      { speltype: 'highlow', winnendTeam: _eindstandKeuze.winnendTeam },
      {
        eindstandRegels: p.spelers.map(s2 => ({ uid: s2.uid, team: teamVan[s2.uid] ?? 0 })),
        scorekaart: {
          type: 'highlow',
          ladderId: p.ladderId,
          datum: new Date().toISOString(),
          timestamp: Date.now(),
          baan: p.baan,
          holes: p.holes,
          teams: _teams.map((team, ti) => ({
            team: ti + 1,
            spelerIds: team,
            namen: team.map(uid => naamMap[uid] || '?'),
            punten: [tA, tB][ti],
          })),
          spelers: p.spelers.map(s2 => ({ naam: s2.naam, hcp: s2.partijHcp })),
          spelerIds: p.spelers.map(s2 => s2.uid),
          scores: p.scores,
        },
      },
      'High-Low afgerond! 🏌️');
    return;
  }


  // p.ladderId is de bron van waarheid — geen ladder-wissel nodig

  // Check: niet-overgeslagen matchups zonder winnaar bij gelijkspel
  const probleem = p.matchups.find((m, idx) => {
    if (p._modalSkipped?.[idx]) return false;
    return p._modalWinnaars[idx] === null;
  });
  if (probleem) { toast('Kies bij gelijkspel een winnaar of sla de matchup over'); return; }

  // v3.0.5: guard — nooit rangen herschrijven op basis van een nog niet geladen
  // standen-cache. Zonder deze check levert getLadderSpelers() rang 0 voor iedereen
  // en hernummert de bevestiging de hele ladder alfabetisch (spelerIds-volgorde).
  if (!ladderStandenGeladen(p.ladderId)) {
    toast('Ladder is nog aan het laden — probeer over een paar seconden opnieuw');
    return;
  }

  closeModal('modal-uitslag');

  // Sorteer matchups op volgorde van afronding (timestamp) — bepaalt alleen de
  // verwerkingsvolgorde bij meerdere matchups in dezelfde partij.
  const timestamps = p._modalTimestamps || p.matchups.map(() => 0);
  const volgorde = p.matchups
    .map((m, idx) => ({ m, idx, ts: timestamps[idx] ?? Infinity }))
    .sort((a, b) => a.ts - b.ts);

  // v4.2.0: geen lokale rang/puntenberekening meer — dat gebeurt server-side
  // in de Cloud Function verwerkPartijUitslag, zodat de afgeschermde punten
  // (ladders/{id}/punten/{uid}) nooit door een gewone speler gelezen hoeven
  // te worden om zijn eigen nieuwe positie te kunnen bepalen.
  const matchupsPayload = volgorde
    .filter(({ idx }) => !p._modalSkipped?.[idx])
    .map(({ m, idx }) => ({
      spelerAUid: m.spelerA.uid,
      spelerBUid: m.spelerB.uid,
      winnaarUid: p._modalWinnaars[idx] === 'A' ? m.spelerA.uid : m.spelerB.uid,
    }));

  let changes = [];
  if (matchupsPayload.length > 0) {
    // v5.0.0 (punt 4): eerst zeker weten dat elke ingevulde hole is
    // weggeschreven. Anders zou de server de laatste hole nog niet zien bij
    // de uitslagcontrole hieronder.
    await wachtOpScoreOpslag();
    try {
      // v5.0.0 (punt 2): partijId gaat mee. De server controleert daarmee dat
      // de partij bestaat, dat deze matchups erbij horen, dat jij meespeelde,
      // en dat de partij niet al eerder is verwerkt. Scores blijven optioneel:
      // alleen als ze de match onmiskenbaar beslissen wordt de winnaar getoetst.
      const resultaat = await _verwerkPartijUitslagFn({
        ladderId: p.ladderId,
        partijId: p.partijId,
        isTest: IS_TEST,
        matchups: matchupsPayload,
      });
      changes = resultaat?.data?.changes || [];
      if (resultaat?.data?.alVerwerkt) {
        // v5.7.0 — BESTAANDE FOUT, hier gerepareerd. De ladder was al
        // beschermd tegen dubbel verwerken, maar de client schreef daarna
        // alsnog een uitslagvermelding naar het ladderdocument. Die telt mee
        // als extra gespeelde partij en extra ontmoetingen, dus twee spelers
        // uit dezelfde flight die allebei bevestigden bliezen de frequentie-
        // en diversiteitsbonus op.
        console.info('[bevestig] partij was al verwerkt — geen dubbeltelling');
        _alVerwerkt = true;
      }
    } catch(e) {
      console.error('verwerkPartijUitslag mislukt:', e);
      // De server geeft nu begrijpelijke redenen terug (verkeerde winnaar bij
      // ingevulde scores, geen deelnemer, partij niet gevonden). Die tonen we
      // letterlijk, want ze zijn voor de speler oplosbaar.
      const melding = e?.message && e.code !== 'internal'
        ? e.message
        : 'Ladderstand bijwerken mislukt — scores zijn niet verwerkt. Probeer opnieuw.';
      toast(melding);
      return;
    }
  }

  // Save uitslag in state (samenvatting) — blijft client-side, telt mee voor
  // de activiteitsberekening (inactiviteit/frequentie/diversiteit) van volgende partijen.
  // v5.0.0 (punt 6): uids gaan mee naast de namen. De activiteitsberekening
  // (inactiviteit/frequentie/diversiteit) werkte op spelersnaam, waardoor twee
  // spelers met dezelfde naam samensmolten en een naamswijziging iemands
  // historie wiste — terwijl die statistiek meebepaalt waar je op de ladder
  // staat. De namen blijven staan zodat oude schermen blijven werken.
  const uitslag = {
    datum: new Date().toLocaleDateString('nl-NL'),
    scoreTs: Date.now(),
    baan: p.baan,
    spelers: p.spelers.map(s => s.naam),
    spelerUids: p.spelers.map(s => s.uid),
    partijId: p.partijId,
    matchups: p.matchups
      .filter((m, i) => !p._modalSkipped?.[i])
      .map((m, i) => {
        const origIdx = p.matchups.indexOf(m);
        return {
          a: m.spelerA.naam, b: m.spelerB.naam,
          winnaar: p._modalWinnaars[origIdx] === 'A' ? m.spelerA.naam : m.spelerB.naam
        };
      }),
    matchupUids: p.matchups
      .filter((m, i) => !p._modalSkipped?.[i])
      .map((m) => {
        const origIdx = p.matchups.indexOf(m);
        return {
          a: m.spelerA.uid, b: m.spelerB.uid,
          winnaar: p._modalWinnaars[origIdx] === 'A' ? m.spelerA.uid : m.spelerB.uid
        };
      })
  };

  // Sla uitslag op in alleLadders[idx] en naar Firestore
  const ladderIdx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (ladderIdx >= 0 && !_alVerwerkt) {
    if (!alleLadders[ladderIdx].data) alleLadders[ladderIdx].data = {};
    if (!alleLadders[ladderIdx].data.uitslagen) alleLadders[ladderIdx].data.uitslagen = [];
    alleLadders[ladderIdx].data.uitslagen.unshift(uitslag);
    await slaUitslagenOp(p.ladderId);
  }

  // Sla volledige scorekaart op als los Firestore document (30 dagen bewaren)
  try {
    await addDoc(UITSLAGEN_COL, {
      type: 'partij',
      ladderId: p.ladderId,
      datum: new Date().toISOString(),
      timestamp: Date.now(),
      baan: p.baan,
      holes: p.holes,
      spelers: p.spelers.map(s => ({ naam: s.naam, hcp: s.partijHcp })),
      spelerIds: p.spelers.map(s => s.uid),
      scores: p.scores,
      matchups: p.matchups.map((m, i) => ({
        a: m.spelerA.naam, b: m.spelerB.naam,
        hcpSlagen: m.hcpSlagen, hcpOntvanger: m.hcpOntvanger,
        winnaar: p._modalWinnaars[i] === 'A' ? m.spelerA.naam : m.spelerB.naam
      }))
    });
  } catch(e) { console.error('Scorekaart opslaan mislukt:', e); }

  // Verwijder partij uit alleLadders en Firestore — op p.ladderId, niet activeLadderId
  const lIdx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (lIdx >= 0) {
    alleLadders[lIdx].actievePartijen = (alleLadders[lIdx].actievePartijen || [])
      .filter(ap => ap.partijId !== p.partijId);
  }
  _verwijderdePartijIds.add(p.partijId);

  // Verifieer dat de partij echt weg is (race-conditie protection)
  await verwijderPartijMetRetry(p.ladderId, p.partijId);
  // v4.2.0: standen/{uid} (rank/partijen/gewonnen) is al bijgewerkt door de
  // Cloud Function hierboven — syncStandenNaBevestigUitslag() is hier niet
  // meer nodig (en zou anders de server-berekening overschrijven met stale
  // client-data, aangezien rankSpelers niet meer lokaal wordt bijgehouden).
  slaSnapshotOp(`Partij: ${p.spelers.map(s => s.naam).join(' vs ')}`, p.ladderId);

  // Update knockout bracket als dit een knockout ladder is
  await verwerkKnockoutUitslag(p);

  showLadderChanges(changes);
}

// v3.0.0-11.24: helper die garandeert dat een actieve partij uit Firestore is.
// Lost race-condities op waar slaState() de hele actievePartijen-array overschrijft
// terwijl andere instances tegelijk wijzigen.
async function verwijderPartijMetRetry(ladderId, partijId, maxPogingen = 3) {
  if (!ladderId || !partijId) return;

  // v5.0.0 (punt 4): dit is het enige punt waar een partij wordt opgeruimd,
  // dus ook de plek om het partij-document en de scoredocumenten weg te halen.
  // Eerst de listener loskoppelen: anders luistert die nog op documenten die
  // we net verwijderen.
  if (_scoreUnsubPartijId === partijId) ontkoppelScoreListener();
  await verwijderPartijDocument(ladderId, partijId);

  for (let poging = 1; poging <= maxPogingen; poging++) {
    try {
      const ladderRef = doc(db, 'ladders', ladderId);
      const snap = await getDoc(ladderRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const huidige = data.actievePartijen || [];
      const filtered = huidige.filter(ap => ap.partijId !== partijId);
      if (filtered.length === huidige.length) {
        // Partij is al weg, klaar
        return;
      }
      await setDoc(ladderRef, { actievePartijen: filtered }, { merge: true });
      // v3.0.0-11.32: markeer als verwijderd zodat onSnapshot-guard hem herkent
      _verwijderdePartijIds.add(partijId);
      // Verifieer
      const checkSnap = await getDoc(ladderRef);
      const nogSteeds = (checkSnap.data().actievePartijen || []).some(ap => ap.partijId === partijId);
      if (!nogSteeds) return; // success
    } catch(e) {
      console.warn('[verwijderPartijMetRetry] poging', poging, 'faalde:', e.code || e.message);
    }
  }
  console.error('[verwijderPartijMetRetry] kon partij niet verwijderen na', maxPogingen, 'pogingen');
}

function sluitUitslagEnGaNaarLadder() {
  closeModal('modal-ladder-result');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-ladder').classList.add('active');
  document.querySelector('nav button').classList.add('active');
  renderLadder();
  // Na 4 seconden highlight weer wissen
  setTimeout(() => {
    
    renderLadder();
  }, 4000);
}

// v3.0.2: posities zijn nu WEERGAVERANG (zelfde nummers als de ladderlijst).
// Een lager nummer = hoger op de ladder. De pijlrichting wordt afgeleid uit het
// verschil i.p.v. hardgecodeerd, omdat de weergaverang van een winnaar door het
// activiteitssysteem soms gelijk kan blijven (of zelfs zakken) — dan mag er geen
// misleidende ↑ getoond worden.
function _deltaBadge(oud, nieuw) {
  const d = (oud ?? 0) - (nieuw ?? 0); // positief = omhoog
  if (d > 0)  return `<span class="delta-up">↑${d} (${oud} → ${nieuw})</span>`;
  if (d < 0)  return `<span class="delta-down">↓${Math.abs(d)} (${oud} → ${nieuw})</span>`;
  return `<span style="color:var(--mid)">— (${oud})</span>`;
}

function showLadderChanges(changes, spelerRegels) {
  // ────────────────────────────────────────────────────────────
  // v5.6.1 — WAT ER MIS WAS AAN DIT SCHERM.
  //
  // Er werd één blok per match getekend, met daarin de verandering van de
  // winnaar en de verliezer. Maar die getallen komen uit `voorRankMap` en
  // `naRankMap` van de Cloud Function, en dat zijn de posities VOOR en NA alle
  // matches samen — niet het effect van die ene match.
  //
  // Bij een flight van drie leverde dat dit op: Sierk verslaat Qruun én Pieter,
  // Pieter verslaat Qruun. Op het scherm stond twee keer "Sierk ↑2 (24 → 22)",
  // wat leest als vier plekken. En Pieter kreeg "— (35)" bij allebei zijn
  // partijen, alsof winnen en verliezen niets deden. Het rekenwerk klopte
  // steeds; de weergave vertelde een ander verhaal.
  //
  // Nu: bovenaan één regel per speler met wat er werkelijk veranderd is, en
  // daaronder de uitslagen zonder cijfers. Dan zie je dat Pieter er één won en
  // één verloor, en waarom hij per saldo blijft staan.
  //
  // De tussenstappen (24 → 23 → 22) tonen we bewust niet. Ze zijn niet onjuist,
  // maar het is procesinformatie; een speler wil weten wat deze partij met zijn
  // positie deed.
  // ────────────────────────────────────────────────────────────
  const lijst = Array.isArray(changes) ? changes : [];

  // v5.7.0: bij Amerikaantje en High-Low zijn er geen winnaar/verliezer-paren.
  // De server levert dan één regel per speler; die tonen we rechtstreeks.
  if (Array.isArray(spelerRegels) && spelerRegels.length) {
    const gesorteerd = [...spelerRegels].sort((a, b) => {
      const da = (a.oud ?? 0) - (a.nieuw ?? 0);
      const db = (b.oud ?? 0) - (b.nieuw ?? 0);
      return db - da || (a.nieuw ?? 0) - (b.nieuw ?? 0);
    });
    let h = '<div style="margin-bottom:14px;padding:12px;background:var(--green-pale);border-radius:10px">';
    gesorteerd.forEach((r, i) => {
      const label = r.positie ? `${r.positie}e` : (r.team != null ? `Team ${r.team + 1}` : '');
      h += `
        <div style="display:flex;justify-content:space-between;align-items:center${i ? ';margin-top:6px' : ''}">
          <span style="font-weight:600">${esc(r.naam)}${label ? ` <span style="font-weight:400;color:var(--light);font-size:12px">${label}</span>` : ''}</span>
          ${_deltaBadge(r.oud, r.nieuw)}
        </div>`;
    });
    h += '</div>';
    document.getElementById('ladder-changes').innerHTML = h;
    document.getElementById('modal-ladder-result').classList.add('open');
    return;
  }

  // Elke speler één keer, in de volgorde waarin hij voorkomt.
  const perSpeler = new Map();
  const onthoud = (naam, oud, nieuw) => {
    if (!naam || perSpeler.has(naam)) return;
    perSpeler.set(naam, { naam, oud, nieuw });
  };
  lijst.forEach(c => {
    onthoud(c.winnaar,   c.wOud, c.wNieuw);
    onthoud(c.verliezer, c.vOud, c.vNieuw);
  });

  // Grootste stijger eerst, dan de rest op nieuwe positie.
  const spelers = [...perSpeler.values()].sort((a, b) => {
    const da = (a.oud ?? 0) - (a.nieuw ?? 0);
    const db = (b.oud ?? 0) - (b.nieuw ?? 0);
    return db - da || (a.nieuw ?? 0) - (b.nieuw ?? 0);
  });

  let html = '';
  if (spelers.length) {
    html += '<div style="margin-bottom:14px;padding:12px;background:var(--green-pale);border-radius:10px">';
    spelers.forEach((s2, i) => {
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center${i ? ';margin-top:6px' : ''}">
          <span style="font-weight:600">${esc(s2.naam)}</span>
          ${_deltaBadge(s2.oud, s2.nieuw)}
        </div>`;
    });
    html += '</div>';
  }

  if (lijst.length) {
    html += '<div style="font-size:12px;color:var(--light);margin-bottom:4px">Uitslagen</div>';
    lijst.forEach(c => {
      html += `
        <div style="font-size:13px;padding:6px 0;border-top:1px solid var(--border)">
          🏆 <strong>${esc(c.winnaar)}</strong> won van ${esc(c.verliezer)}
        </div>`;
    });
  }

  document.getElementById('ladder-changes').innerHTML = html;
  document.getElementById('modal-ladder-result').classList.add('open');
}

// ============================================================

async function annuleerEigenPartij() {

  try {
  if (!confirm('Partij annuleren? De scores worden niet opgeslagen en de ladder wordt niet aangepast.')) return;
  const p = mijnPartij();
  if (!p) return;

  // Verwijder altijd op p.ladderId — geen activeLadderId conditie nodig
  await verwijderPartijMetRetry(p.ladderId, p.partijId);
  const idx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (idx >= 0) {
    alleLadders[idx].actievePartijen = (alleLadders[idx].actievePartijen || [])
      .filter(ap => ap.partijId !== p.partijId);
  }

  closeModal('modal-uitslag');
  renderRonde();
  // Ga terug naar ladder tab
  document.querySelectorAll('.page').forEach(pg => pg.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-ladder').classList.add('active');
  document.querySelector('nav button').classList.add('active');
  renderLadder();
  toast('Partij geannuleerd');
  } catch(e) { console.error('annuleerEigenPartij mislukt:', e); }
}

async function verwijderActievePartij() {

  try {
  if (!confirm('Partij verwijderen? Dit kan niet ongedaan worden.')) return;
  const partijId = store._beheerPartijId;
  if (!partijId) return;
  // Zoek welke ladder deze partij heeft
  const ladderMetPartij = alleLadders.find(l =>
    (l.actievePartijen || []).some(ap => ap.partijId === partijId)
  );
  const ladderId = ladderMetPartij?.id;
  if (ladderId) {
    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) {
      alleLadders[idx].actievePartijen = (alleLadders[idx].actievePartijen || [])
        .filter(ap => ap.partijId !== partijId);
    }
    await verwijderPartijMetRetry(ladderId, partijId);
  }
  closeModal('modal-beheer-partij');
  renderUitslagen();
  toast('Partij verwijderd');
  } catch(e) { console.error('verwijderActievePartij mislukt:', e); }
}

async function editMatchupSlagen(matchIdx) {
  try {
  const p = mijnPartij();
  if (!p) return;
  const m = p.matchups[matchIdx];
  if (!m) return;
  const huidig = m.hcpSlagen;
  const ontvanger = m.hcpOntvanger === m.spelerA.uid ? m.spelerA.naam : m.spelerB.naam;
  const nieuw = prompt(`Aantal slagen voor ${ontvanger.split(' ')[0]}:
(huidig: ${huidig})`, huidig);
  if (nieuw === null) return;
  const val = parseInt(nieuw);
  if (isNaN(val) || val < 0) { toast('Ongeldig aantal slagen'); return; }
  m.hcpSlagen = val;
  await slaActievePartijenOp(p.ladderId);
  renderMatchOverview();
  toast(`Slagen bijgewerkt: ${ontvanger.split(' ')[0]} +${val}`);
  } catch(e) { console.error('editMatchupSlagen mislukt:', e); toast('Aanpassen mislukt'); }
}
window.editMatchupSlagen = editMatchupSlagen;

// ============================================================
//  syncStandenNaBevestigUitslag — VERWIJDERD in v5.0.0 (punt 3)
// ------------------------------------------------------------
//  Deze functie schreef standen/{uid} rechtstreeks vanuit de client. Sinds
//  v4.2.0 werd hij al niet meer aangeroepen (de Cloud Function
//  verwerkPartijUitslag doet dit werk), maar hij stond nog wel geexporteerd —
//  en zolang die schrijfroute bestond, moest firestore.rules elk ladderlid
//  schrijfrechten op de stand van elke speler geven.
//
//  Nu de functie weg is, kunnen die rechten dicht: standen is read-only voor
//  clients, op de eigen handicap na. Zie firestore.rules.
// ============================================================


// ============================================================
//  WATCH PIN — v5.0.0 (punt 1)
// ------------------------------------------------------------
//  WAT ER MIS WAS: deze functie schreef de Firebase *refreshToken* van de
//  ingelogde speler naar ladder/watchPins, een document dat in firestore.rules
//  op `allow read: if true` stond. Een refreshToken is geen tijdelijk
//  sleuteltje maar een permanente loper: daarmee maak je onbeperkt nieuwe
//  inlogtokens. Omdat het project-ID gewoon in de broncode staat, kon iedereen
//  ter wereld dat document met één ongeauthenticeerde request ophalen en
//  inloggen als élke speler die ooit dit scherm had geopend. De 4-cijferige
//  PIN was daarbij niet eens een drempel — je had hem niet nodig.
//
//  HOE HET NU WERKT: de PIN wordt server-side gemaakt (Cloud Function
//  maakWatchPin). Firestore bewaart alleen een hash, 15 minuten geldig en
//  eenmalig bruikbaar. Het horloge wisselt de PIN via wisselWatchPin om voor
//  een custom token en regelt zijn eigen sessie. Er staan geen tokens meer in
//  Firestore, en de client leest dat document niet meer.
//
//  Gevolg voor de gebruiker: de PIN is 6 cijfers en 15 minuten geldig (was
//  4 cijfers en 24 uur). Hij wordt gemaakt op het moment dat je hem nodig
//  hebt, via de knop bij de gele badge.
// ============================================================
let _watchPinBezig = false;
let _watchPinVerlooptOp = 0;

async function renderWatchPin() {
  // De PIN wordt niet meer automatisch aangemaakt: hij is kortlevend en
  // eenmalig, dus alleen zinvol op het moment dat je het horloge koppelt.
  // Deze functie zet nu alleen de badge klaar als knop.
  const badge = document.getElementById('ronde-watch-pin');
  if (!badge) return;
  if (!store.huidigeBruiker?.uid) { badge.style.display = 'none'; return; }

  const nu = Date.now();
  if (_watchPinVerlooptOp > nu && badge.dataset.pin) {
    const resterend = Math.max(0, Math.ceil((_watchPinVerlooptOp - nu) / 60000));
    badge.textContent = `⌚ ${badge.dataset.pin} (${resterend} min)`;
  } else {
    badge.dataset.pin = '';
    badge.textContent = '⌚ Koppel horloge';
  }
  badge.style.display = '';
  badge.style.cursor = 'pointer';
  badge.onclick = vraagWatchPin;
}

/**
 * Vraag een nieuwe watch-PIN op bij de server en toon hem in de badge.
 * Aangeroepen door op de gele badge te tikken.
 */
async function vraagWatchPin() {
  if (_watchPinBezig) return;
  const badge = document.getElementById('ronde-watch-pin');
  if (!badge || !store.huidigeBruiker?.uid) return;

  _watchPinBezig = true;
  const vorigeTekst = badge.textContent;
  badge.textContent = '⌚ …';
  try {
    const res = await _maakWatchPinFn({ isTest: IS_TEST });
    const pin = res?.data?.pin;
    const geldig = (res?.data?.verlooptOver || 900) * 1000;
    if (!pin) throw new Error('geen PIN ontvangen');

    _watchPinVerlooptOp = Date.now() + geldig;
    badge.dataset.pin = pin;
    renderWatchPin();
    // v5.5.1: erbij zetten voor welke omgeving deze code geldt. De codes worden
    // per database bewaard, dus een code uit de testomgeving werkt niet op de
    // gewone watch-pagina en andersom. Dat verschil was nergens zichtbaar.
    const waar = IS_TEST ? ' — LET OP: alleen voor de test-watch' : '';
    toast(`PIN ${pin} — ${Math.round(geldig / 60000)} minuten geldig, eenmalig bruikbaar${waar}`);
  } catch (e) {
    console.error('watch-PIN aanvragen mislukt:', e);
    badge.textContent = vorigeTekst;
    // v5.5.1: de reden meesturen. "Probeer het opnieuw" hielp niemand verder
    // als de oorzaak was dat de server geen inlogtokens mag maken of dat je
    // niet meer ingelogd bent — dan helpt opnieuw proberen namelijk niets.
    const reden = e?.message || e?.code || '';
    toast(reden ? `PIN aanvragen mislukt: ${reden}` : 'PIN aanvragen mislukt — probeer het opnieuw');
  } finally {
    _watchPinBezig = false;
  }
}

export { zetAmerikaaanjePositie, zetHighlowWinnaar, toonEindstandKeuze, renderRonde, renderScorecard, updateScore, toggleScorecard, getHcpSlagenOpHole, berekenMatchStand, renderMatchOverview, openToevoegenModal, bevestigToevoegenRonde, editPartijHcp, verwijderSpelerUitRonde, openUitslagModal, setWinnaar, skipMatchup, bevestigUitslag, sluitUitslagEnGaNaarLadder, showLadderChanges, annuleerEigenPartij, verwijderActievePartij, verwijderPartijMetRetry, wachtOpScoreOpslag, vraagWatchPin, synchroniseerPartijDoc };
// v3.0.2
