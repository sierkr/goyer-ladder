// ============================================================
//  uitslagen.js
// ============================================================
import { db, auth, functions, httpsCallable, IS_TEST, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, _beheerPartijId, _beheerWinnaars } from './store.js';

// v4.2.0: zelfde Cloud Function als in ronde.js — zie de toelichting daar.
const _verwerkPartijUitslagFnBeheer = httpsCallable(functions, 'verwerkPartijUitslag');
import { slaActievePartijenOp, slaUitslagenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { mijnPartij } from './partij.js';
import { getLadderSpelers, ladderStandenGeladen } from './ladder-view.js';
import { renderLadder } from './ladder.js';
import { renderRonde, showLadderChanges, verwijderPartijMetRetry, wachtOpScoreOpslag } from './ronde.js';
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

// v5.7.0: de regels onder een uitslag.
//
// WAT HIER MIS KON GAAN. Er stond `u.matchups.map(...)` zonder controle.
// Amerikaantje en High-Low leveren geen onderlinge partijen op, dus die lijst
// is daar leeg — en ontbreekt het veld helemaal (oudere vermeldingen), dan is
// het geen leeg blokje maar een echte fout, waarmee het hele uitslagenscherm
// omvalt.
function _uitslagRegels(u) {
  const regel = (links, rechts) => `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:4px">
      <span>${links}</span>${rechts}
    </div>`;

  if (u.speltype === 'amerikaantje' || u.speltype === 'highlow') {
    const naam = i => esc((u.spelers || [])[i] || '?');
    const stand = Array.isArray(u.eindstand) ? u.eindstand : [];
    if (!stand.length) {
      return regel(`<span style="color:var(--light)">${u.speltype === 'highlow' ? 'High-Low' : 'Amerikaantje'}</span>`, '');
    }
    if (u.speltype === 'highlow') {
      const teams = [[], []];
      stand.forEach((r, i) => { teams[r.team === 1 ? 1 : 0].push(naam(i)); });
      return regel('High-Low',
        `<span style="font-size:12px;color:var(--mid)">${teams[0].join(' + ')} vs ${teams[1].join(' + ')}</span>`);
    }
    const opPositie = [...stand.keys()].sort((a, b) => stand[a].positie - stand[b].positie);
    const tekst = opPositie.map(i => `${stand[i].positie}. ${naam(i)}`).join(' · ');
    return regel('Amerikaantje', `<span style="font-size:12px;color:var(--mid)">${tekst}</span>`);
  }

  return (Array.isArray(u.matchups) ? u.matchups : []).map(m =>
    regel(`${esc(m.a)} vs ${esc(m.b)}`, `<span class="badge badge-green">⛳ ${esc(m.winnaar)}</span>`)
  ).join('');
}

async function openScorekaartDetail(uitslag) {
  // Zoek scorekaart in Firestore op basis van timestamp
  try {
    const q = query(UITSLAGEN_COL,
      where('timestamp', '>', uitslag.scoreTs - 60000),
      where('timestamp', '<', uitslag.scoreTs + 60000)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      // v5.5.1 — WAT HIER MIS WAS. Er was maar één melding: "ouder dan 30
      // dagen". Maar een uitslag die via het BEHEERSCHERM is bevestigd krijgt
      // wel een tijdstempel en géén scorekaart-document — dat wordt alleen
      // vanuit het rondescherm weggeschreven. De app zocht er dan naar, vond
      // niets, en concludeerde dat hij verlopen was. Hij was niet verlopen; hij
      // heeft nooit bestaan.
      const dagen = (Date.now() - (uitslag.scoreTs || 0)) / (24 * 60 * 60 * 1000);
      toast(dagen > 30
        ? 'Scorekaart niet meer beschikbaar — ouder dan 30 dagen'
        : 'Voor deze partij is geen scorekaart bewaard. De uitslag is destijds ' +
          'via het beheerscherm ingevoerd, zonder scores per hole.');
      return;
    }
    const data = snap.docs[0].data();

    // v5.5.1: een bewaarde kaart zonder ingevulde holes is óók geen scorekaart.
    // Scores zijn uitdrukkelijk optioneel, dus dit is een normale situatie —
    // dan hoort er een normale uitleg bij, geen leeg raster.
    const scores = data.scores || {};
    const ietsIngevuld = Object.values(scores).some(rij =>
      rij && typeof rij === 'object' && Object.values(rij).some(v => v != null && v !== ''));
    if (!ietsIngevuld) {
      toast('Bij deze partij zijn geen scores per hole ingevuld — alleen de uitslag is vastgelegd.');
      return;
    }

    toonScorekaartModal(data);
  } catch(e) {
    console.error('openScorekaartDetail mislukt:', e);
    toast('Scorekaart laden mislukt: ' + (e?.code || e?.message || 'onbekende fout'));
  }
}

function toonScorekaartModal(data) {
  const spelers = data.spelers || [];
  const holes = data.holes || [];

  let html = `<p style="font-size:13px;color:var(--light);margin-bottom:12px">${esc(data.baan)} · ${new Date(data.datum).toLocaleDateString('nl-NL')}</p>`;
  html += '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;width:100%">';

  // Header
  html += '<tr><th style="background:var(--green);color:white;padding:6px;text-align:left">Hole</th>';
  spelers.forEach(s => {
    html += `<th style="background:var(--green);color:white;padding:6px;text-align:center">${esc(s.naam)}<br><span style="font-size:10px;font-weight:400">hcp ${Math.round(s.hcp)}</span></th>`;
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
      const txtCol = kleur ? '#1a1a1a' : 'var(--dark)';
      html += `<td style="text-align:center;padding:5px;background:${kleur};color:${txtCol}">${val || '—'}</td>`;
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
        <span>${esc(m.a)} vs ${esc(m.b)}</span>
        <span class="badge badge-green">⛳ ${esc(m.winnaar)}</span>
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
  // Aggregeer actieve partijen van alle ladders
  const actief = alleLadders.flatMap(l => l.actievePartijen || []);

  // Actieve partijen
  document.getElementById('actief-count').textContent = actief.length;
  const actiefList = document.getElementById('actieve-partijen-list');

  if (actief.length === 0) {
    actiefList.innerHTML = '<div class="empty"><div class="empty-icon">🏌️</div><p>Geen actieve partijen.</p></div>';
  } else {
    actiefList.innerHTML = actief.map(p => {
      const aangemaakt = new Date(p.timestamp).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      const namen = p.spelers.map(s => esc(s.naam)).join(', ');
      // Hoeveel holes ingevuld?
      const ingevuld = p.spelers.length > 0
        ? p.scores[p.spelers[0].uid]?.filter(v => v !== null).length || 0
        : 0;
      return `
        <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-weight:600">${esc(p.baan)}</span>
            <span style="font-size:11px;color:var(--light)">gestart ${aangemaakt}</span>
          </div>
          <div style="font-size:13px;color:var(--mid);margin-bottom:8px">${namen}</div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="badge badge-gold">hole ${ingevuld}/${p.holes.length}</span>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-ghost" onclick="openLiveScoreBord('${escAttr(p.partijId)}')">📊 Live</button>
              ${isBeheerder ? `<button class="btn btn-sm btn-ghost" onclick="openBeheerPartij('${escAttr(p.partijId)}')">⚙️ Beheren</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // Gespeelde partijen
  const list = document.getElementById('uitslagen-list');
  // v5.0.0: ladderId meenemen zodat de coordinator een uitslag kan terugdraaien.
  const alleUitslagen = alleLadders
    .flatMap(l => (l.data?.uitslagen || []).map(u => ({ ...u, ladderId: u.ladderId || l.id })))
    .sort((a, b) => (b.scoreTs || 0) - (a.scoreTs || 0));
  document.getElementById('uitslagen-count').textContent = alleUitslagen.length;
  if (alleUitslagen.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>Nog geen uitslagen.</p></div>';
    return;
  }
  list.innerHTML = alleUitslagen.map((u, idx) => {
    const heeftScorekaart = !!u.scoreTs;
    const ouderDan30Dagen = u.scoreTs && (Date.now() - u.scoreTs > 30 * 24 * 60 * 60 * 1000);
    return `
    <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:600">${esc(u.baan)}</span>
        <span style="font-size:12px;color:var(--light)">${esc(u.datum)}</span>
      </div>
      <div style="font-size:12px;color:var(--mid);margin-bottom:8px">${u.spelers.map(n => esc(n)).join(' · ')}</div>
      ${_uitslagRegels(u)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        ${heeftScorekaart && !ouderDan30Dagen ? `<button class="btn btn-sm btn-ghost" onclick="openScorekaartDetail(${JSON.stringify(u).replace(/"/g,'&quot;')})">📋 Scorekaart</button>` : ''}
        ${isBeheerder && u.partijId ? `<button class="btn btn-sm btn-ghost" style="color:var(--red);border-color:#f5c6cb" onclick="draaiUitslagTerug('${escAttr(u.ladderId || '')}','${escAttr(u.partijId)}')" title="Zet de ladderstand terug naar vóór deze partij">↩ Terugdraaien</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ============================================================
//  UITSLAG TERUGDRAAIEN — v5.0.0 (punt 2)
//  Scores blijven optioneel, dus de server kan een verkeerd gerapporteerde
//  uitslag niet tegenhouden. Daarom moet hij herstelbaar zijn: deze knop zet
//  standen en punten terug naar de momentopname van vóór het verwerken.
//  Alleen zichtbaar en toegestaan voor coordinator/beheerder.
// ============================================================
const _draaiPartijTerugFn = httpsCallable(functions, 'draaiPartijTerug');

async function draaiUitslagTerug(ladderId, partijId) {
  if (!ladderId || !partijId) { toast('Deze uitslag kan niet worden teruggedraaid (geen partij-id)'); return; }
  if (!confirm('Deze uitslag terugdraaien? De ladderstand gaat terug naar de situatie vóór deze partij.')) return;
  try {
    await _draaiPartijTerugFn({ ladderId, partijId, isTest: IS_TEST });
    toast('Uitslag teruggedraaid — de ladderstand is hersteld');
    renderUitslagen();
  } catch(e) {
    console.error('draaiPartijTerug mislukt:', e);
    toast(e?.message || 'Terugdraaien mislukt');
  }
}

function openBeheerPartij(partijId) {
  const p = alleLadders.flatMap(l => l.actievePartijen || []).find(ap => ap.partijId === partijId);
  if (!p) return;
  store._beheerPartijId = partijId;

  document.getElementById('beheer-partij-titel').textContent = p.baan;

  // Bouw winnaar-keuze per matchup
  let html = '';
  p.matchups.forEach((m, idx) => {
    const nA = m.spelerA.naam;
    const nB = m.spelerB.naam;
    // Bereken stand op basis van ingevulde scores
    let standA = 0;
    p.holes.forEach((hole, i) => {
      const sA = p.scores[m.spelerA.uid]?.[i];
      const sB = p.scores[m.spelerB.uid]?.[i];
      if (sA == null || sB == null) return;
      const slagA = m.hcpOntvanger === m.spelerA.uid && hole.si <= m.hcpSlagen ? 1 : 0;
      const slagB = m.hcpOntvanger === m.spelerB.uid && hole.si <= m.hcpSlagen ? 1 : 0;
      if ((sA - slagA) < (sB - slagB)) standA++;
      else if ((sA - slagA) > (sB - slagB)) standA--;
    });
    const voorlopig = standA > 0 ? `${nA} leidt (${standA} UP)` : standA < 0 ? `${nB} leidt (${Math.abs(standA)} UP)` : 'Gelijk';

    html += `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="font-weight:600;margin-bottom:4px">${esc(m.spelerA.naam)} vs ${esc(m.spelerB.naam)}</div>
      <div style="font-size:11px;color:var(--light);margin-bottom:8px">${esc(voorlopig)}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-sm btn-ghost" id="bwin-${idx}-A" onclick="setBeheerWinnaar(${idx},'A')">${esc(nA)} wint</button>
        <button class="btn btn-sm btn-ghost" id="bwin-${idx}-B" onclick="setBeheerWinnaar(${idx},'B')">${esc(nB)} wint</button>
        <button class="btn btn-sm btn-ghost" id="bwin-${idx}-N" onclick="setBeheerWinnaar(${idx},'SKIP')" style="color:var(--red);border-color:var(--alert-text);font-size:11px;margin-left:auto" title="Matchup overslaan — telt niet mee">✕ overslaan</button>
      </div>
    </div>`;
  });

  store._beheerWinnaars = p.matchups.map(() => null);
  document.getElementById('beheer-partij-matches').innerHTML = html;
  document.getElementById('modal-beheer-partij').classList.add('open');
}

function setBeheerWinnaar(idx, kant) {
  // v3.0.0-11.5: kant kan 'A', 'B' of 'SKIP' zijn (voor overslaan)
  _beheerWinnaars[idx] = kant;
  ['A','B','N'].forEach(k => {
    const btn = document.getElementById(`bwin-${idx}-${k}`);
    if (!btn) return;
    // 'N' knop is SKIP in nieuwe flow
    const isActief = (k === 'N' && kant === 'SKIP') || k === kant;
    btn.classList.toggle('btn-primary', isActief);
    btn.classList.toggle('btn-ghost', !isActief);
  });
}

async function bevestigBeheerUitslag() {

  try {
  const p = alleLadders.flatMap(l => l.actievePartijen || []).find(ap => ap.partijId === _beheerPartijId);
  if (!p) return;
  // v3.0.0-11.5: null = geen keuze gemaakt (blokkeert). 'SKIP' = bewust overgeslagen (ok).
  if (_beheerWinnaars.some(w => w === null)) {
    toast('Kies voor elke match een winnaar of sla de match over');
    return;
  }

  // v3.0.5: guard — nooit rangen herschrijven op basis van een nog niet geladen
  // standen-cache (zie audit). Anders hernummert de bevestiging de hele ladder
  // alfabetisch omdat getLadderSpelers() dan rang 0 voor iedereen teruggeeft.
  if (!ladderStandenGeladen(p.ladderId)) {
    toast('Ladder is nog aan het laden — probeer over een paar seconden opnieuw');
    return;
  }

  closeModal('modal-beheer-partij');

  // v4.2.0: net als in ronde.js — de rang/puntenberekening loopt via de
  // Cloud Function, niet meer lokaal.
  const matchupsPayload = p.matchups
    .map((m, idx) => ({ m, kant: _beheerWinnaars[idx] }))
    .filter(x => x.kant !== 'SKIP')
    .map(({ m, kant }) => ({
      spelerAUid: m.spelerA.uid,
      spelerBUid: m.spelerB.uid,
      winnaarUid: kant === 'A' ? m.spelerA.uid : m.spelerB.uid,
    }));

  let changes = [];
  if (matchupsPayload.length > 0) {
    // v5.0.0 (punt 4): wachten tot openstaande scores zijn weggeschreven.
    await wachtOpScoreOpslag();
    try {
      // v5.0.0 (punt 2): partijId gaat mee zodat de server kan controleren dat
      // de partij bestaat, de matchups erbij horen en hij niet al verwerkt is.
      const resultaat = await _verwerkPartijUitslagFnBeheer({
        ladderId: p.ladderId,
        partijId: _beheerPartijId,
        isTest: IS_TEST,
        matchups: matchupsPayload,
      });
      changes = resultaat?.data?.changes || [];
    } catch(e) {
      console.error('verwerkPartijUitslag (beheer) mislukt:', e);
      const melding = e?.message && e.code !== 'internal'
        ? e.message
        : 'Ladderstand bijwerken mislukt — probeer opnieuw.';
      toast(melding);
      return;
    }
  }

  // v5.0.0 (punt 6): uids naast de namen, zodat de activiteitsberekening
  // niet meer op spelersnaam hoeft te werken.
  const uitslag = {
    datum: new Date().toLocaleDateString('nl-NL'),
    scoreTs: Date.now(),
    baan: p.baan,
    partijId: _beheerPartijId,
    spelers: p.spelers.map(s => s.naam),
    spelerUids: p.spelers.map(s => s.uid),
    matchups: p.matchups
      .map((m, i) => ({ m, kant: _beheerWinnaars[i] }))
      .filter(x => x.kant !== 'SKIP')
      .map(({ m, kant }) => ({
        a: m.spelerA.naam, b: m.spelerB.naam,
        winnaar: kant === 'A' ? m.spelerA.naam : m.spelerB.naam
      })),
    matchupUids: p.matchups
      .map((m, i) => ({ m, kant: _beheerWinnaars[i] }))
      .filter(x => x.kant !== 'SKIP')
      .map(({ m, kant }) => ({
        a: m.spelerA.uid, b: m.spelerB.uid,
        winnaar: kant === 'A' ? m.spelerA.uid : m.spelerB.uid
      }))
  };
  const lIdx = alleLadders.findIndex(l => l.id === p.ladderId);
  if (lIdx >= 0) {
    if (!alleLadders[lIdx].data) alleLadders[lIdx].data = {};
    if (!alleLadders[lIdx].data.uitslagen) alleLadders[lIdx].data.uitslagen = [];
    alleLadders[lIdx].data.uitslagen.unshift(uitslag);
    await slaUitslagenOp(p.ladderId);
    alleLadders[lIdx].actievePartijen = (alleLadders[lIdx].actievePartijen || [])
      .filter(ap => ap.partijId !== _beheerPartijId);
  }
  await verwijderPartijMetRetry(p.ladderId, _beheerPartijId);
  // v4.2.0: standen/{uid} is al bijgewerkt door de Cloud Function hierboven.
  slaSnapshotOp(`Partij: ${p.spelers.map(s => s.naam.split(' ')[0]).join(' vs ')}`, p.ladderId);
  showLadderChanges(changes);
  } catch(e) { console.error('bevestigBeheerUitslag mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function annuleerEigenPartij() {

  try {
  if (!confirm('Partij annuleren? De scores worden niet opgeslagen en de ladder wordt niet aangepast.')) return;
  const p = mijnPartij();
  if (!p) return;

  // Verwijder altijd op p.ladderId — geen activeLadderId conditie nodig
  const ladderId = p.ladderId;
  const idx = alleLadders.findIndex(l => l.id === ladderId);
  if (idx >= 0) {
    alleLadders[idx].actievePartijen = (alleLadders[idx].actievePartijen || [])
      .filter(ap => ap.partijId !== p.partijId);
  }
  await setDoc(doc(db, 'ladders', ladderId), { actievePartijen: alleLadders[idx >= 0 ? idx : 0]?.actievePartijen || [] }, { merge: true });

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
  const ladderMetPartij = alleLadders.find(l =>
    (l.actievePartijen || []).some(ap => ap.partijId === _beheerPartijId)
  );
  if (ladderMetPartij) {
    const i2 = alleLadders.indexOf(ladderMetPartij);
    alleLadders[i2].actievePartijen = alleLadders[i2].actievePartijen
      .filter(ap => ap.partijId !== _beheerPartijId);
    await setDoc(doc(db, 'ladders', ladderMetPartij.id), { actievePartijen: alleLadders[i2].actievePartijen }, { merge: true });
  }
  closeModal('modal-beheer-partij');
  renderUitslagen();
  toast('Partij verwijderd');
  } catch(e) { console.error('verwijderActievePartij mislukt:', e); }
}

// ============================================================
//  LIVE SCOREBORD
// ============================================================

let _livePartijId = null;

function openLiveScoreBord(partijId) {
  _livePartijId = partijId;
  renderLiveScoreBord();
  document.getElementById('modal-live-scorebord').classList.add('open');
}

async function verversLiveScoreBord() {
  if (!_livePartijId) return;
  const btn = document.querySelector('#modal-live-scorebord button[onclick="verversLiveScoreBord()"]');
  if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
  try {
    const { getLadderData } = await import('./auth.js');
    for (const l of alleLadders) {
      const snap = await getDoc(doc(db, 'ladders', l.id));
      if (snap.exists()) { l.data = snap.data(); l.actievePartijen = snap.data().actievePartijen || []; }
    }
    renderLiveScoreBord();
  } catch(e) {
    console.error('Verversen mislukt:', e);
    toast('Verversen mislukt, probeer opnieuw');
  } finally {
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

function renderLiveScoreBord() {
  // Zoek de partij in alle ladders
  let p = null;
  for (const l of alleLadders) {
    p = (l.actievePartijen || []).find(ap => ap.partijId === _livePartijId);
    if (p) break;
  }

  const tijdEl = document.getElementById('live-scorebord-tijd');
  tijdEl.textContent = 'Bijgewerkt: ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (!p) {
    document.getElementById('live-scorebord-titel').textContent = 'Live scorebord';
    document.getElementById('live-scorebord-inhoud').innerHTML = '<div class="empty"><p>Partij niet gevonden.</p></div>';
    return;
  }

  document.getElementById('live-scorebord-titel').textContent = p.baan;

  const naamMap = {};
  p.spelers.forEach(s => { naamMap[s.uid] = s.naam; });

  // Matchstand per koppel
  let matchHtml = '<div style="margin-bottom:16px">';
  p.matchups.forEach(m => {
    const nA = m.spelerA.naam;
    const nB = m.spelerB.naam;
    // Bereken stand
    let standA = 0, gespeeld = 0;
    p.holes.forEach((hole, i) => {
      const sA = p.scores[m.spelerA.uid]?.[i];
      const sB = p.scores[m.spelerB.uid]?.[i];
      if (sA == null || sB == null) return;
      gespeeld++;
      const aantalHoles = p.holes.length;
      const diff = m.hcpSlagen;
      const slagA = m.hcpOntvanger === m.spelerA.uid
        ? ((hole.si <= Math.min(diff, aantalHoles) ? 1 : 0) + (hole.si <= Math.max(0, diff - aantalHoles) ? 1 : 0)) : 0;
      const slagB = m.hcpOntvanger === m.spelerB.uid
        ? ((hole.si <= Math.min(diff, aantalHoles) ? 1 : 0) + (hole.si <= Math.max(0, diff - aantalHoles) ? 1 : 0)) : 0;
      if ((sA - slagA) < (sB - slagB)) standA++;
      else if ((sA - slagA) > (sB - slagB)) standA--;
    });
    const resterend = p.holes.length - gespeeld;
    const beslist = Math.abs(standA) > resterend;
    let scoreText, kleur;
    if (gespeeld === 0) { scoreText = 'nog niet begonnen'; kleur = 'var(--light)'; }
    else if (standA === 0) { scoreText = 'TIED'; kleur = 'var(--mid)'; }
    else if (beslist) {
      scoreText = `${standA > 0 ? nA : nB} wint ${Math.abs(standA)}&${resterend}`;
      kleur = 'var(--green)';
    } else {
      scoreText = standA > 0 ? `${nA} ${standA} UP` : `${nB} ${Math.abs(standA)} UP`;
      kleur = 'var(--green)';
    }
    const scoreTextEsc = gespeeld === 0 ? esc(scoreText)
                        : standA === 0 ? esc(scoreText)
                        : beslist ? `${esc(standA > 0 ? nA : nB)} wint ${Math.abs(standA)}&${resterend}`
                        : (standA > 0 ? `${esc(nA)} ${standA} UP` : `${esc(nB)} ${Math.abs(standA)} UP`);
    const hcpTekst = m.hcpSlagen > 0
      ? `<span style="font-size:11px;color:var(--light)">${esc(m.hcpOntvanger === m.spelerA.uid ? nA : nB)} +${m.hcpSlagen}</span>`
      : '';
    matchHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-weight:600;font-size:14px">${esc(nA)} vs ${esc(nB)}</span><br>
        ${hcpTekst}
      </div>
      <div style="text-align:right">
        <span style="font-weight:700;color:${kleur};font-size:13px">${scoreTextEsc}</span><br>
        <span style="font-size:11px;color:var(--light)">${gespeeld}/${p.holes.length} holes</span>
      </div>
    </div>`;
  });
  matchHtml += '</div>';

  // Scorekaart (read-only)
  const totalen = {};
  p.spelers.forEach(s => { totalen[s.uid] = 0; });
  let tabelHtml = '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;width:100%">';
  tabelHtml += '<tr><th style="background:var(--green);color:white;padding:6px 8px;text-align:left">Hole</th>';
  p.spelers.forEach(s => {
    tabelHtml += `<th style="background:var(--green);color:white;padding:6px 8px;text-align:center">${esc(naamMap[s.uid])}</th>`;
  });
  tabelHtml += '</tr>';
  p.holes.forEach((h, i) => {
    const holeNr = ((p.startHole - 1 + i) % 18) + 1;
    tabelHtml += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;font-weight:600">${holeNr}<span style="font-size:10px;color:var(--light);margin-left:3px">p${h.par}</span></td>`;
    p.spelers.forEach(s => {
      const val = p.scores[s.uid]?.[i];
      if (val != null) totalen[s.uid] += Number(val);
      const kleur = val == null ? '' : val <= h.par - 2 ? '#d4edda' : val === h.par - 1 ? '#d8f3dc' : val === h.par + 1 ? '#fff3cd' : val >= h.par + 2 ? '#f8d7da' : '';
      const txtCol = kleur ? '#1a1a1a' : 'var(--dark)';
      tabelHtml += `<td style="text-align:center;padding:5px;background:${kleur};color:${txtCol}">${val != null ? val : '—'}</td>`;
    });
    tabelHtml += '</tr>';
  });
  tabelHtml += '<tr style="background:var(--green-pale);font-weight:700"><td style="padding:5px 8px">Totaal</td>';
  p.spelers.forEach(s => {
    const filled = p.scores[s.uid]?.filter(v => v != null).length || 0;
    tabelHtml += `<td style="text-align:center;font-family:'DM Mono',monospace">${filled > 0 ? totalen[s.uid] : '—'}</td>`;
  });
  tabelHtml += '</tr></table></div>';

  document.getElementById('live-scorebord-inhoud').innerHTML = matchHtml + tabelHtml;
}

window.openLiveScoreBord = openLiveScoreBord;
window.openBeheerPartij = openBeheerPartij;
window.setBeheerWinnaar = setBeheerWinnaar;
window.verversLiveScoreBord = verversLiveScoreBord;

// ============================================================

export { bevestigBeheerUitslag, openScorekaartDetail, renderUitslagen , draaiUitslagTerug };
