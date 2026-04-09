// ============================================================
//  ronde.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, state, alleLadders, activeLadderId } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { closeModal } from './admin.js';
import { kortNaamMap, mijnPartij, renderHcpBlok } from './partij.js';
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
      ${naamMap[s.id]}<br>
      <span onclick="editPartijHcp(${s.id})" style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.7);cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)" title="Klik om aan te passen">hcp ${Math.round(s.partijHcp)}</span><br>
      <button onclick="verwijderSpelerUitRonde(${s.id})" style="background:rgba(255,255,255,0.15);border:none;border-radius:4px;color:rgba(255,255,255,0.8);font-size:10px;cursor:pointer;padding:2px 5px;margin-top:2px">✕ verwijder</button>
    </th>`;
  });
  headHtml += '</tr>';
  document.getElementById('scorecard-head').innerHTML = headHtml;

  // BODY — rijen = holes, kolommen = spelers
  // DOM-volgorde: hole1/speler1, hole1/speler2, hole2/speler1 ...
  // Zodat iOS pijltjes per hole langs alle spelers gaan
  let bodyHtml = '';
  let firstEmptyId = null;
  const totalen = {};
  p.spelers.forEach(s => { totalen[s.id] = 0; });

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
      const val = p.scores[s.id][holeIdx];
      if (val !== null) totalen[s.id] += val;
      const inputId = `score-${s.id}-${holeIdx}`;
      if (val === null && firstEmptyId === null) firstEmptyId = inputId;
      const tabIdx = holeIdx * p.spelers.length + si + 1;
      bodyHtml += `<td style="text-align:center"><input
        id="${inputId}"
        type="number"
        inputmode="numeric"
        pattern="[0-9]*"
        min="1" max="12"
        tabindex="${tabIdx}"
        value="${val !== null ? val : ''}"
        onfocus="this.select();setTimeout(()=>this.scrollIntoView({behavior:'smooth',block:'center'}),300)" oninput="updateScore(${s.id},${holeIdx},this.value);if(this.value.length>0)autoAdvance(this)"
        style="width:38px;padding:3px;text-align:center;font-size:13px;font-family:'DM Mono',monospace;border:1.5px solid #e0ddd4;border-radius:5px"
      ></td>`;
    });
    bodyHtml += '</tr>';
  });

  // Totaalrij
  bodyHtml += '<tr style="border-top:2px solid #e0ddd4">';
  bodyHtml += `<td style="padding:6px 8px;font-size:12px;font-weight:600;color:var(--mid)">Totaal</td>`;
  p.spelers.forEach(s => {
    const filled = p.scores[s.id].filter(v => v !== null).length;
    bodyHtml += `<td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700;font-size:14px">${filled > 0 ? totalen[s.id] : '—'}</td>`;
  });
  bodyHtml += '</tr>';

  document.getElementById('scorecard-body').innerHTML = bodyHtml;

  // Autofocus eerste lege veld
  if (firstEmptyId) {
    const el = document.getElementById(firstEmptyId);
    if (el) el.focus({ preventScroll: true });
  }
}

async function updateScore(spelerId, holeIdx, val) {

  try {
  const p = mijnPartij();
  if (!p) return;
  p.scores[spelerId][holeIdx] = val === '' ? null : parseInt(val);
  await slaState();
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
    const sA = p.scores[matchup.spelerA.id][i];
    const sB = p.scores[matchup.spelerB.id][i];
    if (sA === null || sB === null) { resultatenPerHole.push(null); continue; }
    gespeeld++;
    const slagA = matchup.hcpOntvanger === matchup.spelerA.id ? getHcpSlagenOpHole(matchup, i) : 0;
    const slagB = matchup.hcpOntvanger === matchup.spelerB.id ? getHcpSlagenOpHole(matchup, i) : 0;
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
    const nA = naamMap[m.spelerA.id];
    const nB = naamMap[m.spelerB.id];

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
    const hcpInfo = `<span style="font-size:10px;color:var(--light)">${m.hcpSlagen > 0 ? (m.hcpOntvanger === m.spelerA.id ? nA : nB) + ' +' + m.hcpSlagen + ' slag' + (m.hcpSlagen > 1 ? 'en' : '') : 'Gelijke handicap'} <span onclick="editMatchupSlagen(${matchIdx})" style="cursor:pointer;opacity:0.6" title="Slagen aanpassen">✏️</span></span>`;

    html += `<div class="match-card">
      <div style="flex:1;min-width:0">
        <div class="match-player" style="${naamA_style};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nA}</div>
        ${hcpInfo}
      </div>
      <div style="text-align:center;flex:0 0 90px">
        <div class="match-score" style="${scoreStyle};font-size:13px;padding:4px 6px">${scoreText}</div>
        <div style="font-size:10px;color:${status === 'beslist' ? 'var(--green)' : 'var(--light)'};margin-top:2px;font-weight:${status === 'beslist' ? '600' : '400'};white-space:nowrap">${statusLabel}</div>
      </div>
      <div class="match-player right" style="${naamB_style};flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right">${nB}</div>
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
  const bezig = new Set(p.spelers.map(s => s.id));
  const beschikbaar = state.spelers
    .filter(s => !bezig.has(s.id))
    .sort((a,b) => a.rank - b.rank);

  if (beschikbaar.length === 0) { toast('Alle spelers zijn al in de partij'); return; }

  const sel = document.getElementById('toevoegen-speler-select');
  sel.innerHTML = '<option value="">— Kies speler —</option>' +
    beschikbaar.map(s => `<option value="${s.id}">${s.naam} (hcp ${Math.round(s.hcp)})</option>`).join('');
  document.getElementById('toevoegen-speler-hcp').value = '';

  sel.onchange = function() {
    const s = state.spelers.find(x => x.id == this.value);
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
  const speler = state.spelers.find(s => String(s.id) === String(sel.value));
  if (!speler) { toast('Kies een speler'); return; }
  if (isNaN(hcpVal)) { toast('Voer een handicap in'); return; }

  const nieuweSpeler = { ...speler, hcp: hcpVal, partijHcp: hcpVal };

  // Sla hcp op
  const sv = state.spelers.find(s => String(s.id) === String(speler.id));
  if (sv && hcpVal !== sv.hcp) sv.hcp = hcpVal;

  // Nieuwe matchups aanmaken met alle huidige spelers
  p.spelers.forEach(bestaande => {
    const hcpDiff = Math.round(Math.abs(bestaande.partijHcp - hcpVal) * 0.75);
    const hoger = bestaande.partijHcp > hcpVal ? bestaande : nieuweSpeler;
    p.matchups.push({
      id: `${bestaande.id}-${speler.id}`,
      spelerA: bestaande, spelerB: nieuweSpeler,
      hcpOntvanger: hoger.id,
      hcpSlagen: hcpDiff
    });
  });

  // Speler en lege scores toevoegen
  p.spelers.push(nieuweSpeler);
  p.scores[speler.id] = Array(p.holes.length).fill(null);

  await slaState();
  closeModal('modal-toevoegen-ronde');
  renderRonde();
  toast(`${speler.naam.split(' ')[0]} toegevoegd ✓`);
  } catch(e) { console.error('bevestigToevoegenRonde mislukt:', e); }
}

async function editPartijHcp(spelerId) {

  try {
  const p = mijnPartij();
  if (!p) return;
  const speler = p.spelers.find(s => String(s.id) === String(spelerId));
  if (!speler) return;
  const nieuw = prompt(`Playing handicap voor ${speler.naam}:`, Math.round(speler.partijHcp));
  if (nieuw === null) return;
  const val = parseFloat(nieuw);
  if (isNaN(val)) { toast('Ongeldige handicap'); return; }
  speler.partijHcp = val;
  // Herbereken matchup slagen
  p.matchups.forEach(m => {
    const a = p.spelers.find(s => s.id === m.spelerA.id);
    const b = p.spelers.find(s => s.id === m.spelerB.id);
    if (!a || !b) return;
    const hcpDiff = Math.round(Math.abs(a.partijHcp - b.partijHcp) * 0.75);
    const hoger = a.partijHcp > b.partijHcp ? a : b;
    m.hcpOntvanger = hoger.id;
    m.hcpSlagen = hcpDiff;
  });
  await slaState();
  renderRonde();
  toast(`Handicap ${speler.naam.split(' ')[0]} bijgewerkt ✓`);
  } catch(e) { console.error('editPartijHcp mislukt:', e); }
}

async function verwijderSpelerUitRonde(spelerId) {

  try {
  const p = mijnPartij();
  if (!p) return;
  const speler = p.spelers.find(s => s.id === spelerId);
  if (!speler) return;
  if (p.spelers.length <= 2) { toast('Minimaal 2 spelers nodig'); return; }
  if (!confirm(`${speler.naam.split(' ')[0]} verwijderen uit de partij?`)) return;

  p.spelers = p.spelers.filter(s => s.id !== spelerId);
  p.matchups = p.matchups.filter(m => m.spelerA.id !== spelerId && m.spelerB.id !== spelerId);
  delete p.scores[spelerId];

  await slaState();
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
    const nA = naamMap[m.spelerA.id];
    const nB = naamMap[m.spelerB.id];
    let winnaar = standA > 0 ? 'A' : standA < 0 ? 'B' : null;

    const heeftGast = m.spelerA.id >= 90000 || m.spelerB.id >= 90000;
    html += `<div id="matchup-row-${idx}" style="padding:12px 0;border-bottom:1px solid #f0ede4">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600">${m.spelerA.naam} vs ${m.spelerB.naam}</span>
        <button onclick="skipMatchup(${idx})" id="skip-${idx}" class="btn btn-sm btn-ghost" style="color:var(--red);border-color:#f5c6cb;font-size:11px;padding:4px 8px" title="Matchup overslaan">✕ overslaan</button>
      </div>
      ${heeftGast ? `<p style="font-size:11px;color:var(--light);font-style:italic;margin-bottom:6px">⚠️ Gastspeler — telt niet mee voor ladderstand</p>` : ''}`;

    if (gespeeld === 0 || standA === 0) {
      const label = gespeeld === 0 ? 'Geen scores — kies de winnaar of sla over' : `⚡ Gelijkspel (${gespeeld} holes) — kies de winnaar`;
      html += `<p style="font-size:12px;color:var(--gold);margin-bottom:6px">${label}</p>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${winnaar === 'A' ? 'btn-primary' : 'btn-ghost'}"
            onclick="setWinnaar(${idx},'A')" id="win-${idx}-A">${nA} wint</button>
          <button class="btn btn-sm ${winnaar === 'B' ? 'btn-primary' : 'btn-ghost'}"
            onclick="setWinnaar(${idx},'B')" id="win-${idx}-B">${nB} wint</button>
        </div>`;
    } else {
      const winnaarNaam = standA > 0 ? m.spelerA.naam : m.spelerB.naam;
      const marge = Math.abs(standA);
      html += `<span class="badge badge-green">✓ ${winnaarNaam} wint (${gespeeld} holes, ${marge} up)</span>`;
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
    const scoresA = p.scores[spelerA.id] || [];
    const scoresB = p.scores[spelerB.id] || [];
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
  const nA = naamMap[p.matchups[idx].spelerA.id];
  const nB = naamMap[p.matchups[idx].spelerB.id];
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
  const p = mijnPartij();
  if (!p) return;

  // Zorg dat we in de juiste ladder zitten
  if (p.ladderId && p.ladderId !== activeLadderId) {
    const snap = await getDoc(doc(db, 'ladders', p.ladderId));
    if (snap.exists()) {
      store.activeLadderId = p.ladderId;
      store.state = snap.data();
      if (!state.actievePartijen) state.actievePartijen = [];
    }
  }

  // Check: niet-overgeslagen matchups zonder winnaar bij gelijkspel
  const probleem = p.matchups.find((m, idx) => {
    if (p._modalSkipped?.[idx]) return false;
    return p._modalWinnaars[idx] === null;
  });
  if (probleem) { toast('Kies bij gelijkspel een winnaar of sla de matchup over'); return; }

  closeModal('modal-uitslag');

  const changes = [];
  // Sla huidige ranks op als prevRank voor alle spelers
  state.spelers.forEach(s => { s.prevRank = s.rank; });

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

    const sw = state.spelers.find(s => s.id === winnaar.id);
    const sv = state.spelers.find(s => s.id === verliezer.id);

    // Gastspelers of spelers niet in ladder — niet verwerken in ladderstand
    const heeftGast = winnaar.id >= 90000 || verliezer.id >= 90000 ||
                      !state.spelers.find(s => s.id === winnaar.id) ||
                      !state.spelers.find(s => s.id === verliezer.id);
    if (heeftGast || !sw || !sv) return;
    const oldWrank = sw.rank;
    const oldVrank = sv.rank;

    sw.partijen++; sv.partijen++; sw.gewonnen++;

    let newWrank, newVrank;
    const swRank = sw.rank;
    const svRank = sv.rank;
    const cfg = getLadderConfig();

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
      if (newWrank >= newVrank) newVrank = newWrank + 1;
    } else {
      // Hoger gerankte wint
      newWrank = Math.max(1, swRank - cfg.hoogStijg);
      newVrank = svRank + cfg.hoogZak;
    }

    // Wijs beschikbare ranks toe aan andere spelers in relatieve volgorde
    const n = state.spelers.length;
    const gereserveerd = new Set([newWrank, newVrank]);
    const beschikbaar = [];
    for (let r = 1; r <= n; r++) { if (!gereserveerd.has(r)) beschikbaar.push(r); }
    const anderen = state.spelers
      .filter(s => s.id !== sw.id && s.id !== sv.id)
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
  state.uitslagen.unshift(uitslag);

  // Sla volledige scorekaart op als los Firestore document (30 dagen bewaren)
  try {
    await addDoc(UITSLAGEN_COL, {
      type: 'partij',
      datum: new Date().toISOString(),
      timestamp: Date.now(),
      baan: p.baan,
      holes: p.holes,
      spelers: p.spelers.map(s => ({ naam: s.naam, hcp: s.partijHcp })),
      spelerIds: p.spelers.map(s => s.id),
      scores: p.scores,
      matchups: p.matchups.map((m, i) => ({
        a: m.spelerA.naam, b: m.spelerB.naam,
        hcpSlagen: m.hcpSlagen, hcpOntvanger: m.hcpOntvanger,
        winnaar: p._modalWinnaars[i] === 'A' ? m.spelerA.naam : m.spelerB.naam
      }))
    });
  } catch(e) { console.error('Scorekaart opslaan mislukt:', e); }

  // Verwijder deze partij uit actievePartijen
  state.actievePartijen = state.actievePartijen.filter(ap => ap.partijId !== p.partijId);

  // Onthoud welke spelers zojuist gespeeld hebben voor highlight in ladder
  

  await slaState();
  slaSnapshotOp(`Partij: ${p.spelers.map(s => s.naam).join(' vs ')}`);

  // Update knockout bracket als dit een knockout ladder is
  await verwerkKnockoutUitslag(p);

  showLadderChanges(changes);
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

  // Verwijder uit de juiste ladder (kan afwijken van activeLadderId)
  const ladderId = p.ladderId || activeLadderId;
  if (ladderId !== activeLadderId) {
    const snap = await getDoc(doc(db, 'ladders', ladderId));
    if (snap.exists()) {
      const data = snap.data();
      data.actievePartijen = (data.actievePartijen || []).filter(ap => ap.partijId !== p.partijId);
      await setDoc(doc(db, 'ladders', ladderId), data);
      const idx = alleLadders.findIndex(l => l.id === ladderId);
      if (idx >= 0) { alleLadders[idx].actievePartijen = data.actievePartijen; if (alleLadders[idx].data) alleLadders[idx].data.actievePartijen = data.actievePartijen; }
    }
  } else {
    state.actievePartijen = state.actievePartijen.filter(ap => ap.partijId !== p.partijId);
    await slaState();
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
  state.actievePartijen = (state.actievePartijen || []).filter(ap => ap.partijId !== _beheerPartijId);
  await slaState();
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
  const ontvanger = m.hcpOntvanger === m.spelerA.id ? m.spelerA.naam : m.spelerB.naam;
  const nieuw = prompt(`Aantal slagen voor ${ontvanger.split(' ')[0]}:
(huidig: ${huidig})`, huidig);
  if (nieuw === null) return;
  const val = parseInt(nieuw);
  if (isNaN(val) || val < 0) { toast('Ongeldig aantal slagen'); return; }
  m.hcpSlagen = val;
  await slaState();
  renderMatchOverview();
  toast(`Slagen bijgewerkt: ${ontvanger.split(' ')[0]} +${val}`);
  } catch(e) { console.error('editMatchupSlagen mislukt:', e); toast('Aanpassen mislukt'); }
}
window.editMatchupSlagen = editMatchupSlagen;

export { renderRonde, renderScorecard, updateScore, toggleScorecard, getHcpSlagenOpHole, berekenMatchStand, renderMatchOverview, openToevoegenModal, bevestigToevoegenRonde, editPartijHcp, verwijderSpelerUitRonde, openUitslagModal, setWinnaar, skipMatchup, bevestigUitslag, sluitUitslagEnGaNaarLadder, showLadderChanges, annuleerEigenPartij, verwijderActievePartij };
