// ============================================================
//  ronde.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, _usersCache, _verwijderdePartijIds } from './store.js';
import { slaActievePartijenOp, slaUitslagenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { closeModal } from './admin.js';
import { kortNaamMap, mijnPartij, renderHcpBlok } from './partij.js';
import { getLadderSpelers } from './ladder-view.js';
import { renderLadder } from './ladder.js';
import { slaSnapshotOp } from './beheer.js';
import { verwerkKnockoutUitslag } from './knockout.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { autoAdvance } from './auth.js';
import { renderUitslagen } from './uitslagen.js';


//  RONDE (live scorekaart)
// ============================================================

//  RONDE (live scorekaart)
// ============================================================
function renderRonde() {
  const p = mijnPartij();
  if (!p) {
    document.getElementById('ronde-empty').style.display = 'block';
    document.getElementById('ronde-content').style.display = 'none';
    return;
  }
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

  // HEAD
  let headHtml = '<tr><th class="player-col" style="text-align:left">Hole</th>';
  p.spelers.forEach(s => {
    headHtml += `<th style="text-align:center;font-family:'DM Sans',sans-serif;font-size:12px">
      ${esc(naamMap[s.uid])}<br>
      <span onclick="editPartijHcp('${escAttr(s.uid)}')" style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.7);cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)" title="Klik om aan te passen">hcp ${Math.round(s.partijHcp)}</span><br>
      <button onclick="verwijderSpelerUitRonde('${escAttr(s.uid)}')" style="background:rgba(255,255,255,0.15);border:none;border-radius:4px;color:rgba(255,255,255,0.8);font-size:10px;cursor:pointer;padding:2px 5px;margin-top:2px">✕ verwijder</button>
    </th>`;
  });
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

async function updateScore(spelerId, holeIdx, val) {

  try {
  const p = mijnPartij();
  if (!p) return;
  p.scores[spelerId][holeIdx] = val === '' ? null : parseInt(val);
  await slaActievePartijenOp(p.ladderId);
  renderMatchOverview();
  } catch(e) { console.error('updateScore mislukt:', e); }
}

function toggleScorecard() {
  const w = document.getElementById('scorecard-wrap');
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

function renderMatchOverview() {
  const p = mijnPartij();
  if (!p) return;
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
  await slaActievePartijenOp(p.ladderId);
  renderRonde();
  toast(`Handicap ${speler.naam.split(' ')[0]} bijgewerkt ✓`);
  } catch(e) { console.error('editPartijHcp mislukt:', e); }
}

async function verwijderSpelerUitRonde(spelerId) {

  try {
  const p = mijnPartij();
  if (!p) return;
  // v3.0.0-11.22: String-vergelijking consistent met bevestigToevoegenRonde
  // (later toegevoegde spelers kunnen een numeric id hebben, knop geeft string)
  const speler = p.spelers.find(s => s.uid === spelerId);
  if (!speler) return;
  if (p.spelers.length <= 2) { toast('Minimaal 2 spelers nodig'); return; }
  if (!confirm(`${speler.naam.split(' ')[0]} verwijderen uit de partij?`)) return;

  p.spelers = p.spelers.filter(s => s.uid !== spelerId);
  p.matchups = p.matchups.filter(m =>
    m.spelerA.uid !== spelerId &&
    m.spelerB.uid !== spelerId
  );
  delete p.scores[spelerId];
  delete p.scores[speler.uid]; // veiligheid: ruim onder beide mogelijke keys op

  await slaActievePartijenOp(p.ladderId);
  renderRonde();
  toast(`${speler.naam.split(' ')[0]} verwijderd uit partij`);
  } catch(e) { console.error('verwijderSpelerUitRonde mislukt:', e); }
}

// ============================================================
//  UITSLAG MODAL
// ============================================================
function openUitslagModal() {
  const p = mijnPartij();
  if (!p) return;
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

async function bevestigUitslag() {
  console.log('[bevestig] bevestigUitslag gestart');
  const p = mijnPartij();
  if (!p) { console.warn('[bevestig] geen mijnPartij — abort'); return; }

  // p.ladderId is de bron van waarheid — geen ladder-wissel nodig

  // Check: niet-overgeslagen matchups zonder winnaar bij gelijkspel
  const probleem = p.matchups.find((m, idx) => {
    if (p._modalSkipped?.[idx]) return false;
    return p._modalWinnaars[idx] === null;
  });
  if (probleem) { toast('Kies bij gelijkspel een winnaar of sla de matchup over'); return; }

  closeModal('modal-uitslag');

  const changes = [];
  // Laad actuele ranking uit standen/{uid} via getLadderSpelers — niet uit singleton state
  // Maak een mutable lokale kopie voor de rank-berekening
  const rankSpelers = getLadderSpelers(p.ladderId).map(s => ({ ...s }));
  rankSpelers.forEach(s => { s.prevRank = s.rank; });

  // Sorteer matchups op volgorde van afronding (timestamp)
  const timestamps = p._modalTimestamps || p.matchups.map(() => 0);
  const volgorde = p.matchups
    .map((m, idx) => ({ m, idx, ts: timestamps[idx] ?? Infinity }))
    .sort((a, b) => a.ts - b.ts);

  volgorde.forEach(({ m, idx }) => {
    // Overgeslagen matchups tellen niet mee voor de ladder
    if (p._modalSkipped?.[idx]) return;
    const winnaarKant = p._modalWinnaars[idx];
    const winnaar = winnaarKant === 'A' ? m.spelerA : m.spelerB;
    const verliezer = winnaarKant === 'A' ? m.spelerB : m.spelerA;

    // Zoek speler in lokale rankSpelers kopie op uid
    const sw = rankSpelers.find(s => s.uid === winnaar.uid) || null;
    const sv = rankSpelers.find(s => s.uid === verliezer.uid) || null;

    // Gastspelers of spelers niet in ladder — niet verwerken in ladderstand
    const heeftGast = winnaar.uid?.startsWith('gast_') || verliezer.uid?.startsWith('gast_') ||
                      !sw || !sv;
    if (heeftGast) {
      return;
    }
    const oldWrank = sw.rank;
    const oldVrank = sv.rank;

    sw.partijen++; sv.partijen++; sw.gewonnen++;

    let newWrank, newVrank;
    const swRank = sw.rank;
    const svRank = sv.rank;
    const cfg = getLadderConfig(p.ladderId);

    if (swRank > svRank) {
      // Lager gerankte wint
      newWrank = Math.max(1, swRank - cfg.laagStijg);
      // Verliezer naar plek van winnaar als verschil <= drempel?
      const verschil = swRank - svRank;
      if (cfg.verliezerNaarWinnaar && verschil <= cfg.drempel) {
        newVrank = swRank; // verliezer naar oorspronkelijke plek winnaar
      } else {
        newVrank = svRank + cfg.laagZak;
      }
      // v3.0.0-11.23: oude regel `if (newWrank >= newVrank) newVrank = newWrank + 1`
      // verwijderd — die gooide bij grote rank-verschillen de verliezer onterecht
      // naar de plek van de (gestegen) winnaar (bv. ▼58 plekken na 1 verlies).
      // In de "lager-gerankte wint" tak geldt altijd newWrank < newVrank, dus
      // de check is daar ook overbodig.
    } else {
      // Hoger gerankte wint
      newWrank = Math.max(1, swRank - cfg.hoogStijg);
      newVrank = svRank + cfg.hoogZak;
    }

    // Wijs beschikbare ranks toe aan andere spelers in relatieve volgorde
    const n = rankSpelers.length;
    const gereserveerd = new Set([newWrank, newVrank]);
    const beschikbaar = [];
    for (let r = 1; r <= n; r++) { if (!gereserveerd.has(r)) beschikbaar.push(r); }
    const anderen = rankSpelers
      .filter(s => s.uid !== sw.uid && s.uid !== sv.uid)
      .sort((a, b) => a.rank - b.rank);
    anderen.forEach((s, i) => { s.rank = beschikbaar[i]; });

    changes.push({ winnaar: sw.naam, verliezer: sv.naam, wOud: oldWrank, wNieuw: newWrank, vOud: oldVrank, vNieuw: newVrank });
    sw.rank = newWrank;
    sv.rank = newVrank;
  });

  // Ranks zijn al correct toegewezen per matchup — geen extra normalisatie nodig

  // Save uitslag in state (samenvatting)
  const uitslag = {
    datum: new Date().toLocaleDateString('nl-NL'),
    scoreTs: Date.now(),
    baan: p.baan,
    spelers: p.spelers.map(s => s.naam),
    matchups: p.matchups
      .filter((m, i) => !p._modalSkipped?.[i])
      .map((m, i) => {
        const origIdx = p.matchups.indexOf(m);
        return {
          a: m.spelerA.naam, b: m.spelerB.naam,
          winnaar: p._modalWinnaars[origIdx] === 'A' ? m.spelerA.naam : m.spelerB.naam
        };
      })
  };
  // Sla uitslag op in alleLadders[idx] en naar Firestore
  const ladderIdx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (ladderIdx >= 0) {
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
  // Sync rankSpelers naar standen/{uid}
  await syncStandenNaBevestigUitslag(p.ladderId, rankSpelers, {
    matchups: p.matchups,
    winnaars: p._modalWinnaars,
    skipped: p._modalSkipped,
    spelers: p.spelers,
  });
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

function showLadderChanges(changes) {
  let html = '';
  changes.forEach(c => {
    const wDelta = c.wOud - c.wNieuw;
    const vDelta = c.vOud - c.vNieuw;
    html += `
      <div style="margin-bottom:12px;padding:12px;background:var(--green-pale);border-radius:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-weight:600">🏆 ${c.winnaar}</span>
          <span class="delta-up">↑${wDelta} (${c.wOud} → ${c.wNieuw})</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--mid)">${c.verliezer}</span>
          <span class="delta-down">↓${Math.abs(vDelta)} (${c.vOud} → ${c.vNieuw})</span>
        </div>
      </div>`;
  });
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
//  FASE 9B: Sync state.spelers ranks/stats naar standen/{uid}
// ============================================================
// Na elke bevestigUitslag schrijven we naast ladders.spelers[] ook
// naar de standen/{uid} subcollectie zodat de view-laag up-to-date is.
// Sync standen/{uid} na bevestigUitslag — uid staat nu direct op speler
async function syncStandenNaBevestigUitslag(ladderId, rankSpelers, partijInfo = null) {
  try {
    const ladder = alleLadders.find(l => l.id === ladderId);
    if (!ladder) return;
    const spelerIdSet = new Set(
      (ladder.spelerIds || ladder.data?.spelerIds || []).filter(id => typeof id === 'string' && id.length > 10)
    );
    if (spelerIdSet.size === 0) return;

    const now = Date.now();
    const maandKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;

    // Bouw map: uid → set van unieke tegenstanders in deze partij
    const tegenstandersInPartij = {};
    if (partijInfo?.matchups) {
      partijInfo.matchups.forEach((m, idx) => {
        if (partijInfo.skipped?.[idx]) return;
        const uidA = m.spelerA.uid;
        const uidB = m.spelerB.uid;
        if (!tegenstandersInPartij[uidA]) tegenstandersInPartij[uidA] = new Set();
        if (!tegenstandersInPartij[uidB]) tegenstandersInPartij[uidB] = new Set();
        tegenstandersInPartij[uidA].add(uidB);
        tegenstandersInPartij[uidB].add(uidA);
      });
    }

    // Spelers die actief waren in deze partij
    const actieveUids = new Set(Object.keys(tegenstandersInPartij));

    const writes = [];
    (rankSpelers || []).forEach(s => {
      const uid = s.uid;
      if (!uid || !spelerIdSet.has(uid)) return;
      const payload = {
        rank:     s.rank     || 0,
        partijen: s.partijen || 0,
        gewonnen: s.gewonnen || 0,
      };
      if (s.prevRank != null) payload.prevRank = s.prevRank;

      // Activiteitsvelden alleen bijwerken voor spelers die in deze partij speelden
      if (actieveUids.has(uid)) {
        payload.laatstGespeeld = now;
        payload.inactieveWeken = 0;
        // maandPartijen: gebruik Firestore FieldValue.increment via een aparte write
        // (hier doen we het simpel: ophogen via huidige cache)
        const huidigStand = store._standenCache?.[ladderId]?.[uid] || {};
        const huidigMaandKey = huidigStand.maandKey;
        const huidigPartijen = huidigMaandKey === maandKey ? (huidigStand.maandPartijen || 0) : 0;
        payload.maandPartijen = huidigPartijen + 1;
        payload.maandKey = maandKey;

        // Unieke tegenstanders dit seizoen samenvoegen
        const bestaand = huidigStand.uniekeTegenstanderIds || [];
        const nieuw = Array.from(tegenstandersInPartij[uid] || []);
        const samengevoegd = Array.from(new Set([...bestaand, ...nieuw]));
        payload.uniekeTegenstanderIds = samengevoegd;
      }

      writes.push(
        setDoc(doc(db, 'ladders', ladderId, 'standen', uid), payload)
          .catch(err => console.warn('standen sync mislukt voor', uid, err.code))
      );
    });
    await Promise.all(writes);
  } catch(e) { console.warn('syncStandenNaBevestigUitslag:', e); }
}

// ============================================================
//  WATCH PIN — v3.0.0-11.79
//  Auto: wordt aangeroepen vanuit renderRonde().
//  Hergebruikt bestaande geldige PIN; genereert alleen nieuw
//  als er geen of verlopen PIN is. Toont PIN in gele badge.
// ============================================================
let _watchPinBezig = false; // debounce — voorkom dubbele Firestore writes

async function renderWatchPin() {
  if (!store.huidigeBruiker?.uid) return;
  if (_watchPinBezig) return;

  const badge = document.getElementById('ronde-watch-pin');
  if (!badge) return;

  _watchPinBezig = true;
  try {
    const pinsRef = doc(db, 'ladder', 'watchPins');
    const pinsSnap = await getDoc(pinsRef);
    const pins = pinsSnap.exists() ? { ...pinsSnap.data() } : {};
    const nu = Date.now();

    // Zoek bestaande geldige PIN voor deze gebruiker
    let bestaandePIN = null;
    Object.entries(pins).forEach(([k, v]) => {
      if (v.uid === store.huidigeBruiker.uid && v.expires > nu) bestaandePIN = k;
    });

    if (bestaandePIN) {
      // Bestaande PIN tonen — update token als dat nog ontbreekt (v3.0.0-11.84)
      if (!pins[bestaandePIN].refreshToken) {
        pins[bestaandePIN].refreshToken = auth.currentUser?.refreshToken || '';
        await setDoc(pinsRef, pins);
      }
      badge.textContent = '⌚ ' + bestaandePIN;
      badge.style.display = '';
      return;
    }

    // Geen geldige PIN — verwijder verlopen en genereer nieuw
    Object.keys(pins).forEach(k => {
      if (pins[k].expires < nu || pins[k].uid === store.huidigeBruiker.uid) delete pins[k];
    });

    let nieuwePIN;
    let pogingen = 0;
    do {
      nieuwePIN = String(Math.floor(1000 + Math.random() * 9000));
      pogingen++;
    } while (pins[nieuwePIN] && pogingen < 20);

    pins[nieuwePIN] = {
      uid:          store.huidigeBruiker.uid,
      naam:         store.huidigeBruiker.gebruikersnaam,
      email:        store.huidigeBruiker.email,
      refreshToken: auth.currentUser?.refreshToken || '',
      expires:      nu + 24 * 60 * 60 * 1000
    };

    await setDoc(pinsRef, pins);

    badge.textContent = '⌚ ' + nieuwePIN;
    badge.style.display = '';

  } catch (e) {
    console.error('renderWatchPin mislukt:', e);
    // Badge verbergen bij fout — geen toast, want renderRonde wordt vaker aangeroepen
  } finally {
    _watchPinBezig = false;
  }
}

export { renderRonde, renderScorecard, updateScore, toggleScorecard, getHcpSlagenOpHole, berekenMatchStand, renderMatchOverview, openToevoegenModal, bevestigToevoegenRonde, editPartijHcp, verwijderSpelerUitRonde, openUitslagModal, setWinnaar, skipMatchup, bevestigUitslag, sluitUitslagEnGaNaarLadder, showLadderChanges, annuleerEigenPartij, verwijderActievePartij, syncStandenNaBevestigUitslag, verwijderPartijMetRetry };
