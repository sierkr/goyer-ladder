// ============================================================
//  uitslagen.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, state, alleLadders, activeLadderId, _beheerPartijId, _beheerWinnaars } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { mijnPartij } from './partij.js';
import { renderLadder } from './ladder.js';
import { renderRonde, showLadderChanges } from './ronde.js';
import { slaSnapshotOp } from './beheer.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';


//  UITSLAGEN
// ============================================================

async function verwijderOudeUitslagen() {
  // Verwijder scorekaarten ouder dan 30 dagen
  const dertigDagenGelden = Date.now() - (30 * 24 * 60 * 60 * 1000);
  try {
    const q = query(UITSLAGEN_COL, where('timestamp', '<', dertigDagenGelden));
    const snap = await getDocs(q);
    snap.forEach(async d => await deleteDoc(d.ref));
    // oude scorekaarten opgeschoond
  } catch(e) { console.error('Opschonen mislukt:', e); }
}

async function openScorekaartDetail(uitslag) {
  // Zoek scorekaart in Firestore op basis van timestamp
  try {
    const q = query(UITSLAGEN_COL,
      where('timestamp', '>', uitslag._timestamp - 60000),
      where('timestamp', '<', uitslag._timestamp + 60000)
    );
    const snap = await getDocs(q);
    if (snap.empty) { toast('Scorekaart niet meer beschikbaar (ouder dan 30 dagen)'); return; }
    const data = snap.docs[0].data();
    toonScorekaartModal(data);
  } catch(e) { toast('Scorekaart laden mislukt'); }
}

function toonScorekaartModal(data) {
  const spelers = data.spelers || [];
  const holes = data.holes || [];

  let html = `<p style="font-size:13px;color:var(--light);margin-bottom:12px">${data.baan} · ${new Date(data.datum).toLocaleDateString('nl-NL')}</p>`;
  html += '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;width:100%">';

  // Header
  html += '<tr><th style="background:var(--green);color:white;padding:6px;text-align:left">Hole</th>';
  spelers.forEach(s => {
    html += `<th style="background:var(--green);color:white;padding:6px;text-align:center">${s.naam.split(' ')[0]}<br><span style="font-size:10px;font-weight:400">hcp ${Math.round(s.hcp)}</span></th>`;
  });
  html += '</tr>';

  // Holes
  let totalen = spelers.map(() => 0);
  holes.forEach((h, i) => {
    html += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;font-weight:600">${i+1}<span style="font-size:10px;color:var(--light);margin-left:4px">p${h.par} SI${h.si}</span></td>`;
    spelers.forEach((s, si) => {
      // Scores zijn opgeslagen met speler-ID als string key
      const spelerId = String(data.spelerIds?.[si] ?? si);
      const val = data.scores?.[spelerId]?.[i] ?? null;
      if (val) totalen[si] += Number(val);
      const kleur = val && val <= h.par - 2 ? '#d4edda' : val && val === h.par - 1 ? '#d8f3dc' : val && val === h.par + 1 ? '#fff3cd' : val && val >= h.par + 2 ? '#f8d7da' : '';
      html += `<td style="text-align:center;padding:5px;background:${kleur}">${val || '—'}</td>`;
    });
    html += '</tr>';
  });

  // Totaal
  html += '<tr style="background:var(--green-pale);font-weight:700"><td style="padding:5px 8px">Totaal</td>';
  totalen.forEach(t => { html += `<td style="text-align:center;padding:5px;font-family:\'DM Mono\',monospace">${t || '—'}</td>`; });
  html += '</tr></table></div>';

  // Matchups
  if (data.matchups?.length) {
    html += `<div style="margin-top:16px"><p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:8px">Matchplay uitslag</p>`;
    data.matchups.forEach(m => {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span>${m.a} vs ${m.b}</span>
        <span class="badge badge-green">⛳ ${m.winnaar.split(' ')[0]}</span>
      </div>`;
    });
    html += '</div>';
  }

  document.getElementById('archief-detail-titel').textContent = 'Scorekaart';
  document.getElementById('archief-detail-inhoud').innerHTML = html;
  document.getElementById('modal-archief-detail').classList.add('open');
}

function renderUitslagen() {
  const isBeheerder = isCoordinatorRol();
  const actief = state.actievePartijen || [];

  // Actieve partijen
  document.getElementById('actief-count').textContent = actief.length;
  const actiefList = document.getElementById('actieve-partijen-list');

  if (actief.length === 0) {
    actiefList.innerHTML = '<div class="empty"><div class="empty-icon">🏌️</div><p>Geen actieve partijen.</p></div>';
  } else {
    actiefList.innerHTML = actief.map(p => {
      const aangemaakt = new Date(p.timestamp).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const namen = p.spelers.map(s => s.naam.split(' ')[0]).join(', ');
      // Hoeveel holes ingevuld?
      const ingevuld = p.spelers.length > 0
        ? p.scores[p.spelers[0].id]?.filter(v => v !== null).length || 0
        : 0;
      return `
        <div style="padding:14px 16px;border-bottom:1px solid #f0ede4">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-weight:600">${p.baan}</span>
            <span style="font-size:11px;color:var(--light)">gestart ${aangemaakt}</span>
          </div>
          <div style="font-size:13px;color:var(--mid);margin-bottom:8px">${namen}</div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="badge badge-gold">hole ${ingevuld}/${p.holes.length}</span>
            ${isBeheerder ? `<button class="btn btn-sm btn-ghost" onclick="openBeheerPartij('${p.partijId}')">⚙️ Beheren</button>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // Gespeelde partijen
  const list = document.getElementById('uitslagen-list');
  document.getElementById('uitslagen-count').textContent = state.uitslagen.length;
  if (state.uitslagen.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>Nog geen uitslagen.</p></div>';
    return;
  }
  list.innerHTML = state.uitslagen.map((u, idx) => {
    const heeftScorekaart = !!u._timestamp;
    const ouderDan30Dagen = u._timestamp && (Date.now() - u._timestamp > 30 * 24 * 60 * 60 * 1000);
    return `
    <div style="padding:14px 16px;border-bottom:1px solid #f0ede4">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:600">${u.baan}</span>
        <span style="font-size:12px;color:var(--light)">${u.datum}</span>
      </div>
      <div style="font-size:12px;color:var(--mid);margin-bottom:8px">${u.spelers.join(' · ')}</div>
      ${u.matchups.map(m => `
        <div style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:4px">
          <span>${m.a} vs ${m.b}</span>
          <span class="badge badge-green">⛳ ${m.winnaar.split(' ')[0]}</span>
        </div>`).join('')}
      ${heeftScorekaart && !ouderDan30Dagen ? `<button class="btn btn-sm btn-ghost" onclick="openScorekaartDetail(${JSON.stringify(u).replace(/"/g,'&quot;')})" style="margin-top:8px">📋 Scorekaart</button>` : ''}
    </div>`;
  }).join('');
}

function openBeheerPartij(partijId) {
  const p = (state.actievePartijen || []).find(ap => ap.partijId === partijId);
  if (!p) return;
  store._beheerPartijId = partijId;

  document.getElementById('beheer-partij-titel').textContent = p.baan;

  // Bouw winnaar-keuze per matchup
  let html = '';
  p.matchups.forEach((m, idx) => {
    const nA = m.spelerA.naam.split(' ')[0];
    const nB = m.spelerB.naam.split(' ')[0];
    // Bereken stand op basis van ingevulde scores
    let standA = 0;
    p.holes.forEach((hole, i) => {
      const sA = p.scores[m.spelerA.id]?.[i];
      const sB = p.scores[m.spelerB.id]?.[i];
      if (sA == null || sB == null) return;
      const slagA = m.hcpOntvanger === m.spelerA.id && hole.si <= m.hcpSlagen ? 1 : 0;
      const slagB = m.hcpOntvanger === m.spelerB.id && hole.si <= m.hcpSlagen ? 1 : 0;
      if ((sA - slagA) < (sB - slagB)) standA++;
      else if ((sA - slagA) > (sB - slagB)) standA--;
    });
    const voorlopig = standA > 0 ? `${nA} leidt (${standA} UP)` : standA < 0 ? `${nB} leidt (${Math.abs(standA)} UP)` : 'Gelijk';

    html += `<div style="padding:12px 0;border-bottom:1px solid #f0ede4">
      <div style="font-weight:600;margin-bottom:4px">${m.spelerA.naam} vs ${m.spelerB.naam}</div>
      <div style="font-size:11px;color:var(--light);margin-bottom:8px">${voorlopig}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-ghost" id="bwin-${idx}-A" onclick="setBeheerWinnaar(${idx},'A')">${nA} wint</button>
        <button class="btn btn-sm btn-ghost" id="bwin-${idx}-B" onclick="setBeheerWinnaar(${idx},'B')">${nB} wint</button>
        <button class="btn btn-sm btn-ghost" id="bwin-${idx}-N" onclick="setBeheerWinnaar(${idx},null)" style="color:var(--light)">Geen</button>
      </div>
    </div>`;
  });

  store._beheerWinnaars = p.matchups.map(() => null);
  document.getElementById('beheer-partij-matches').innerHTML = html;
  document.getElementById('modal-beheer-partij').classList.add('open');
}

function setBeheerWinnaar(idx, kant) {
  _beheerWinnaars[idx] = kant;
  const p = (state.actievePartijen || []).find(ap => ap.partijId === _beheerPartijId);
  if (!p) return;
  ['A','B','N'].forEach(k => {
    const btn = document.getElementById(`bwin-${idx}-${k}`);
    if (btn) btn.className = `btn btn-sm ${k === String(kant ?? 'N') ? 'btn-primary' : 'btn-ghost'}`;
  });
}

async function bevestigBeheerUitslag() {

  try {
  const p = (state.actievePartijen || []).find(ap => ap.partijId === _beheerPartijId);
  if (!p) return;
  if (_beheerWinnaars.some(w => w === null)) { toast('Wijs voor elke match een winnaar aan'); return; }

  closeModal('modal-beheer-partij');

  const changes = [];
  state.spelers.forEach(s => { s.prevRank = s.rank; });

  p.matchups.forEach((m, idx) => {
    const kant = _beheerWinnaars[idx];
    const winnaar = kant === 'A' ? m.spelerA : m.spelerB;
    const verliezer = kant === 'A' ? m.spelerB : m.spelerA;
    const sw = state.spelers.find(s => s.id === winnaar.id);
    const sv = state.spelers.find(s => s.id === verliezer.id);
    const oldWrank = sw.rank, oldVrank = sv.rank;
    sw.partijen++; sv.partijen++; sw.gewonnen++;
    let newWrank, newVrank;
    const swRank = sw.rank;
    const svRank = sv.rank;
    const cfg2 = getLadderConfig();
    if (swRank > svRank) {
      newWrank = Math.max(1, swRank - cfg2.laagStijg);
      const verschil2 = swRank - svRank;
      if (cfg2.verliezerNaarWinnaar && verschil2 <= cfg2.drempel) {
        newVrank = swRank;
      } else {
        newVrank = svRank + cfg2.laagZak;
      }
      if (newWrank >= newVrank) newVrank = newWrank + 1;
    } else {
      newWrank = Math.max(1, swRank - cfg2.hoogStijg);
      newVrank = svRank + cfg2.hoogZak;
    }
    const n2 = state.spelers.length;
    const gereserveerd2 = new Set([newWrank, newVrank]);
    const beschikbaar2 = [];
    for (let r = 1; r <= n2; r++) { if (!gereserveerd2.has(r)) beschikbaar2.push(r); }
    const anderen2 = state.spelers
      .filter(s => s.id !== sw.id && s.id !== sv.id)
      .sort((a, b) => a.rank - b.rank);
    anderen2.forEach((s, i) => { s.rank = beschikbaar2[i]; });
    changes.push({ winnaar: sw.naam, verliezer: sv.naam, wOud: oldWrank, wNieuw: newWrank, vOud: oldVrank, vNieuw: newVrank });
    sw.rank = newWrank; sv.rank = newVrank;
  });

  [...state.spelers].sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);

  state.uitslagen.unshift({
    datum: new Date().toLocaleDateString('nl-NL'),
    baan: p.baan,
    spelers: p.spelers.map(s => s.naam),
    matchups: p.matchups.map((m, i) => ({
      a: m.spelerA.naam, b: m.spelerB.naam,
      winnaar: _beheerWinnaars[i] === 'A' ? m.spelerA.naam : m.spelerB.naam
    }))
  });

  state.actievePartijen = state.actievePartijen.filter(ap => ap.partijId !== _beheerPartijId);
  
  await slaState();
  slaSnapshotOp(`Partij: ${p.spelers.map(s => s.naam.split(' ')[0]).join(' vs ')}`);
  showLadderChanges(changes);
  } catch(e) { console.error('bevestigBeheerUitslag mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

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

// ============================================================

export { renderUitslagen };;
