// ============================================================
//  beheer.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL,
  SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC,
  USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store } from './store.js';
import * as S from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers,
  getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { getDoc, setDoc, doc, addDoc, deleteDoc, getDocs, collection,
  query, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


//  LADDER INSTELLINGEN
// ============================================================
const DEFAULT_LADDER_CONFIG = {
  laagStijg: 4, laagZak: 2,
  hoogStijg: 1, hoogZak: 1,
  verliezerNaarWinnaar: false, drempel: 4
};

let _instellingenLadderId = null;

let _standAanpassenLadderId = null;
let _standAanpassenSpelers = [];

async function openStandAanpassen(ladderId) {

  try {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) return;
  _standAanpassenLadderId = ladderId;

  const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
  if (!snapExists) return;
  _standAanpassenSpelers = [...(snapData.spelers || [])].sort((a,b) => a.rank - b.rank);

  document.getElementById('stand-aanpassen-titel').textContent = `Stand — ${ladder.naam}`;
  renderStandAanpassenLijst();
  document.getElementById('modal-stand-aanpassen').classList.add('open');
  } catch(e) { console.error('openStandAanpassen mislukt:', e); }
}

function renderStandAanpassenLijst() {
  const lijst = document.getElementById('stand-aanpassen-lijst');
  lijst.innerHTML = _standAanpassenSpelers.map((s, idx) => `
    <div class="admin-row" style="padding:8px 0">
      <span style="font-family:'Bebas Neue';font-size:20px;color:var(--light);min-width:28px">${idx + 1}</span>
      <span style="flex:1;font-weight:500">${s.naam}</span>
      <span style="font-size:12px;color:var(--light);margin-right:8px">hcp ${Math.round(s.hcp)}</span>
      <div style="display:flex;flex-direction:column;gap:2px">
        <button onclick="verschuifStand(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}
          style="background:${idx===0?'#f0ede4':'var(--green-pale)'};border:none;border-radius:4px;width:26px;height:26px;cursor:${idx===0?'default':'pointer'};font-size:13px;color:${idx===0?'var(--light)':'var(--green)'}">↑</button>
        <button onclick="verschuifStand(${idx}, 1)" ${idx === _standAanpassenSpelers.length-1 ? 'disabled' : ''}
          style="background:${idx===_standAanpassenSpelers.length-1?'#f0ede4':'#fde8e8'};border:none;border-radius:4px;width:26px;height:26px;cursor:${idx===_standAanpassenSpelers.length-1?'default':'pointer'};font-size:13px;color:${idx===_standAanpassenSpelers.length-1?'var(--light)':'var(--red)'}">↓</button>
      </div>
    </div>
  `).join('');
}

function verschuifStand(idx, delta) {
  const nieuwIdx = idx + delta;
  if (nieuwIdx < 0 || nieuwIdx >= _standAanpassenSpelers.length) return;
  [_standAanpassenSpelers[idx], _standAanpassenSpelers[nieuwIdx]] = [_standAanpassenSpelers[nieuwIdx], _standAanpassenSpelers[idx]];
  renderStandAanpassenLijst();
}

async function slaStandOp() {

  try {
  const ladderId = _standAanpassenLadderId;
  if (!ladderId) return;
  _standAanpassenSpelers.forEach((s, idx) => s.rank = idx + 1);
  const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
  if (!snapExists) return;
  const data = snapData;
  data.spelers = _standAanpassenSpelers;
  await setDoc(doc(db, 'ladders', ladderId), data);
  const idx = alleLadders.findIndex(l => l.id === ladderId);
  if (idx >= 0) alleLadders[idx].spelers = _standAanpassenSpelers;
  if (ladderId === activeLadderId) state.spelers = _standAanpassenSpelers;
  closeModal('modal-stand-aanpassen');
  renderLadder();
  toast('Stand bijgewerkt ✓');
  } catch(e) { console.error('slaStandOp mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function openLadderInstellingen(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) return;
  _instellingenLadderId = ladderId;
  const cfg = ladder.config || DEFAULT_LADDER_CONFIG;

  document.getElementById('ladder-instellingen-titel').textContent = `Instellingen — ${ladder.naam}`;
  document.getElementById('cfg-laag-stijg').value = cfg.laagStijg ?? 4;
  document.getElementById('cfg-laag-zak').value = cfg.laagZak ?? 2;
  document.getElementById('cfg-hoog-stijg').value = cfg.hoogStijg ?? 1;
  document.getElementById('cfg-hoog-zak').value = cfg.hoogZak ?? 1;
  document.getElementById('cfg-verliezer-naar-winnaar').checked = cfg.verliezerNaarWinnaar ?? false;
  document.getElementById('cfg-drempel').value = cfg.drempel ?? 4;
  document.getElementById('cfg-drempel-wrap').style.display = cfg.verliezerNaarWinnaar ? 'block' : 'none';

  document.getElementById('cfg-verliezer-naar-winnaar').onchange = function() {
    document.getElementById('cfg-drempel-wrap').style.display = this.checked ? 'block' : 'none';
  };

  document.getElementById('modal-ladder-instellingen').classList.add('open');
}

async function slaLadderInstellingenOp() {

  try {
  const ladderId = _instellingenLadderId;
  if (!ladderId) return;

  const config = {
    laagStijg: parseInt(document.getElementById('cfg-laag-stijg').value) || 4,
    laagZak: parseInt(document.getElementById('cfg-laag-zak').value) || 2,
    hoogStijg: parseInt(document.getElementById('cfg-hoog-stijg').value) || 1,
    hoogZak: parseInt(document.getElementById('cfg-hoog-zak').value) || 1,
    verliezerNaarWinnaar: document.getElementById('cfg-verliezer-naar-winnaar').checked,
    drempel: parseInt(document.getElementById('cfg-drempel').value) || 4
  };

  // Sla op in Firestore
  const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
  if (snapExists) {
    data.config = config;
    await setDoc(doc(db, 'ladders', ladderId), data);
  }

  // Update cache
  const idx = alleLadders.findIndex(l => l.id === ladderId);
  if (idx >= 0) alleLadders[idx].config = config;
  if (ladderId === activeLadderId) state.config = config;

  closeModal('modal-ladder-instellingen');
  toast('Instellingen opgeslagen ✓');
  } catch(e) { console.error('slaLadderInstellingenOp mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function getNextId() {
  // Centrale ID teller — altijd hoger dan hoogste bekende ID
  const maxAlleSpelers = alleSpelersData.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
  const maxAlleLadders = alleLadders.reduce((m, l) =>
    Math.max(m, ...(l.spelers || []).map(s => Number(s.id) || 0)), 0);
  return Math.max(maxAlleSpelers, maxAlleLadders) + 1;
}

// Helper: haal ladder data op — gebruik cache als beschikbaar, anders Firestore
async function getLadderData(ladderId) {
  const cached = alleLadders.find(l => l.id === ladderId);
  if (cached?.data) return { exists: true, data: cached.data, _cached: true };
  if (ladderId === activeLadderId) return { exists: true, data: state, _cached: true };
  try {
    const snap = await getDoc(doc(db, 'ladders', ladderId));
    if (snap.exists()) {
      const idx = alleLadders.findIndex(l => l.id === ladderId);
      if (idx >= 0) alleLadders[idx].data = snap.data();
    }
    return { exists: snap.exists(), data: snap.exists() ? snap.data() : null };
  } catch(e) {
    console.error('getLadderData mislukt:', e);
    return { exists: false, data: null };
  }
}

function getLadderConfig() {
  return state.config || alleLadders.find(l => l.id === activeLadderId)?.config || DEFAULT_LADDER_CONFIG;
}

// ============================================================
//  LADDERS BEHEREN
// ============================================================
function openNieuweLadderModal() {
  document.getElementById('nieuwe-ladder-naam').value = '';
  document.getElementById('modal-nieuwe-ladder').classList.add('open');
}

async function maakNieuweLadder() {

  try {
  const naam = document.getElementById('nieuwe-ladder-naam').value.trim();
  const type = document.getElementById('nieuwe-ladder-type')?.value || 'ranking';
  if (!naam) { toast('Voer een naam in'); return; }
  if (alleLadders.find(l => l.naam.toLowerCase() === naam.toLowerCase())) {
    toast('Een ladder met deze naam bestaat al'); return;
  }
  const id = naam.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  const nieuweData = { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), naam, spelerIds: [], type };
  await setDoc(doc(db, 'ladders', id), nieuweData);
  alleLadders.push({ id, naam, spelerIds: [], spelers: [], type });
  closeModal('modal-nieuwe-ladder');
  renderAdminLadders();
  toast(`Ladder "${naam}" aangemaakt ✓`);
  } catch(e) { console.error('maakNieuweLadder mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function verschuifLadder(idx, delta) {

  try {
  const nieuwIdx = idx + delta;
  if (nieuwIdx < 0 || nieuwIdx >= alleLadders.length) return;
  // Wissel posities
  [alleLadders[idx], alleLadders[nieuwIdx]] = [alleLadders[nieuwIdx], alleLadders[idx]];
  // Sla volgorde op in Firestore
  const volgorde = alleLadders.map(l => l.id);
  await setDoc(doc(db, 'ladder', 'ladderVolgorde'), { volgorde });
  renderAdminLadders();
  laadInviteStatus();
  } catch(e) { console.error('verschuifLadder mislukt:', e); }
}

async function verwijderLadder(ladderId) {

  try {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) return;
  if (ladderId === 'mp') { toast('De MP ladder kan niet verwijderd worden'); return; }
  if (!confirm(`Ladder "${ladder.naam}" verwijderen? Dit kan niet ongedaan worden.`)) return;
  await deleteDoc(doc(db, 'ladders', ladderId));
  alleLadders = alleLadders.filter(l => l.id !== ladderId);
  if (ladderId === activeLadderId) {
    activeLadderId = alleLadders[0]?.id || null;
    state = alleLadders[0] || state;
  }
  renderAdminLadders();
  toast('Ladder verwijderd');
  } catch(e) { console.error('verwijderLadder mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

let _ladderSpelersId = null;

async function openLadderSpelersModal(ladderId) {

  try {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) return;
  _ladderSpelersId = ladderId;
  document.getElementById('ladder-spelers-titel').textContent = `Spelers in "${ladder.naam}"`;

  // Gebruik master spelerslijst zodat ook niet-ingedeelde spelers zichtbaar zijn
  const alleSpelers = [...alleSpelersData].sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));

  // Gebruik cache voor meest actuele spelerIds
  const { exists: ladderExists, data: ladderDataVers } = await getLadderData(ladderId);
  const versSpelers = ladderDataVers?.spelers || [];
  const huidigeIds = new Set(versSpelers.map(s => Number(s.id)));

  document.getElementById('ladder-spelers-lijst').innerHTML = alleSpelers.length === 0
    ? '<p style="font-size:13px;color:var(--light);padding:12px 0">Geen spelers gevonden. Voeg eerst spelers toe via Spelers beheren.</p>'
    : alleSpelers.map(s => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" value="${s.id}" ${huidigeIds.has(Number(s.id)) ? 'checked' : ''}
        style="width:18px;height:18px;accent-color:var(--green);cursor:pointer">
      <span style="flex:1">${s.naam}</span>
      <span style="font-size:12px;color:var(--light)">hcp ${s.hcp}</span>
    </label>
  `).join('');

  document.getElementById('modal-ladder-spelers').classList.add('open');
  } catch(e) { console.error('openLadderSpelersModal mislukt:', e); }
}

async function slaLadderSpelersOp() {

  try {
  const ladderId = _ladderSpelersId;
  if (!ladderId) return;
  const checkboxes = document.querySelectorAll('#ladder-spelers-lijst input[type=checkbox]');
  const geselecteerdeIds = [...checkboxes].filter(c => c.checked).map(c => parseInt(c.value));

  const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
  const ladderData = snapExists ? snapData : { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), naam: alleLadders.find(l=>l.id===ladderId)?.naam };

  const huidigeSpelers = ladderData.spelers || [];
  const nieuweSpelers = [];

  geselecteerdeIds.forEach(id => {
    const bestaand = huidigeSpelers.find(s => Number(s.id) === id);
    if (bestaand) {
      nieuweSpelers.push(bestaand);
    } else {
      let gevonden = null;
      for (const l of alleLadders) {
        gevonden = (l.spelers || []).find(s => Number(s.id) === id);
        if (gevonden) break;
      }
      if (!gevonden) gevonden = alleSpelersData.find(s => Number(s.id) === id);
      nieuweSpelers.push({
        id, naam: gevonden?.naam || 'Onbekend', hcp: gevonden?.hcp || 0,
        rank: nieuweSpelers.length + 1, partijen: 0, gewonnen: 0
      });
    }
  });

  nieuweSpelers.sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);

  const updatedData = { ...ladderData, spelers: nieuweSpelers, spelerIds: geselecteerdeIds };
  await setDoc(doc(db, 'ladders', ladderId), updatedData);

  const idx = alleLadders.findIndex(l => l.id === ladderId);
  if (idx >= 0) { alleLadders[idx].spelerIds = geselecteerdeIds; alleLadders[idx].spelers = nieuweSpelers; }
  if (ladderId === activeLadderId) { state.spelers = nieuweSpelers; state.spelerIds = geselecteerdeIds; }

  closeModal('modal-ladder-spelers');
  renderAdminLadders();
  toast('Spelers bijgewerkt ✓');
  } catch(e) { console.error('slaLadderSpelersOp mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function renderAdminLadders() {

  try {
  const list = document.getElementById('admin-ladders-list');
  if (!list) return;
  const isBeheerder = isBeheerderRol();
  // Gebruik cache — listeners houden alleLadders al up to date

  list.innerHTML = alleLadders.map((l, idx) => `
    <div class="admin-row">
      ${isBeheerder ? `
      <div style="display:flex;flex-direction:column;gap:2px;margin-right:4px">
        <button onclick="verschuifLadder(${idx},-1)" ${idx === 0 ? 'disabled' : ''}
          style="background:${idx===0?'#f0ede4':'var(--green-pale)'};border:none;border-radius:4px;width:22px;height:22px;cursor:${idx===0?'default':'pointer'};font-size:11px;color:${idx===0?'var(--light)':'var(--green)'}">↑</button>
        <button onclick="verschuifLadder(${idx},1)" ${idx === alleLadders.length-1 ? 'disabled' : ''}
          style="background:${idx===alleLadders.length-1?'#f0ede4':'#fde8e8'};border:none;border-radius:4px;width:22px;height:22px;cursor:${idx===alleLadders.length-1?'default':'pointer'};font-size:11px;color:${idx===alleLadders.length-1?'var(--light)':'var(--red)'}">↓</button>
      </div>` : ''}
      <div style="flex:1">
        <div style="font-weight:600">${l.naam}</div>
        <div style="font-size:11px;color:var(--light)">${(l.spelers||[]).length} spelers${(l.data?.type || l.type) === 'knockout' ? ' · knock-out' : ''}</div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="openLadderSpelersModal('${l.id}')">👥 Spelers</button>
      <button class="btn btn-sm btn-ghost" onclick="openStandAanpassen('${l.id}')">↕ Stand</button>
      ${isBeheerder ? `
        <button class="btn btn-sm btn-ghost" onclick="openLadderInstellingen('${l.id}')">⚙️</button>
        ${l.id !== 'mp' ? `<button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="verwijderLadder('${l.id}')">✕</button>` : '<div style="width:38px"></div>'}
      ` : ''}
    </div>
  `).join('');
  } catch(e) { console.error('renderAdminLadders mislukt:', e); }
}

// ============================================================
//  LADDER SNAPSHOTS
// ============================================================
function openSnapshotsModal() {
  document.getElementById('modal-snapshots').classList.add('open');
  laadSnapshots();
}

async function slaSnapshotOp(label) {
  try {
    // Verwijder snapshots ouder dan 30 dagen
    const dertig = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oudeSnaps = await getDocs(query(SNAPSHOTS_COL, where('timestamp', '<', dertig)));
    oudeSnaps.forEach(d => deleteDoc(d.ref));

    // Sla nieuwe snapshot op
    await addDoc(SNAPSHOTS_COL, {
      label,
      ladderId: activeLadderId,
      ladderNaam: alleLadders.find(l => l.id === activeLadderId)?.naam || activeLadderId,
      timestamp: Date.now(),
      datum: new Date().toLocaleString('nl-NL'),
      spelers: JSON.parse(JSON.stringify(state.spelers))
    });
  } catch(e) { console.error('Snapshot mislukt:', e); }
}

async function laadSnapshots() {
  const wrap = document.getElementById('snapshots-list');
  if (!wrap) return;
  try {
    const snaps = await getDocs(query(SNAPSHOTS_COL, orderBy('timestamp', 'desc')));
    const relevant = snaps.docs.filter(d => !d.data().ladderId || d.data().ladderId === activeLadderId);
    if (relevant.length === 0) {
      wrap.innerHTML = '<p style="font-size:13px;color:var(--light);padding:12px 16px">Nog geen snapshots voor deze ladder.</p>';
      return;
    }
    wrap.innerHTML = relevant.map(d => {
      const data = d.data();
      return `<div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:10px">
        <div style="flex:1">
          <div style="font-weight:500;font-size:13px">${data.label}</div>
          <div style="font-size:11px;color:var(--light)">${data.datum}${data.ladderNaam ? ' · ' + data.ladderNaam : ''}</div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="herstelSnapshot('${d.id}')">↩ Herstel</button>
      </div>`;
    }).join('');
  } catch(e) {
    wrap.innerHTML = '<p style="font-size:13px;color:var(--light);padding:12px 16px">Snapshots laden mislukt.</p>';
  }
}

async function herstelSnapshot(snapId) {
  try {
    const snapDoc = await getDoc(doc(db, 'snapshots', snapId));
    if (!snapDoc.exists()) { toast('Snapshot niet gevonden'); return; }
    const data = snapDoc.data();
    const ladderId = data.ladderId || activeLadderId;
    const ladderNaam = data.ladderNaam || ladderId;

    if (!confirm(`Ladderstand van "${ladderNaam}" herstellen naar:\n${data.label} (${data.datum})?\n\nDe huidige stand wordt eerst opgeslagen.`)) return;

    // Sla huidige stand op voordat we herstellen
    await slaSnapshotOp('⚠️ Voor herstel op ' + new Date().toLocaleString('nl-NL'));

    // Laad de juiste ladder uit Firestore
    const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
    if (!snapExists) { toast('Ladder niet gevonden'); return; }
    const ladderData = snapData;

    // Herstel spelers inclusief alle statistieken
    ladderData.spelers = data.spelers.map(s => ({
      ...s,
      partijen: s.partijen ?? 0,
      gewonnen: s.gewonnen ?? 0,
      prevRank: null
    }));

    // Schrijf naar de juiste ladder
    await setDoc(doc(db, 'ladders', ladderId), ladderData);

    // Update lokale state als het de actieve ladder is
    if (ladderId === activeLadderId) {
      state.spelers = ladderData.spelers;
    }

    // Update alleLadders cache
    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) {
      alleLadders[idx].spelers = ladderData.spelers;
      alleLadders[idx].data = ladderData;
    }

    renderLadder();
    toast(`Ladderstand "${ladderNaam}" hersteld ✓`);
    closeModal('modal-snapshots');
  } catch(e) { toast('Herstel mislukt: ' + e.message); }
}

// ============================================================
//  UITNODIGINGSLINK
// ============================================================
async function genereerInviteLink() {

  try {
  const ladderId = document.getElementById('invite-ladder-select')?.value || activeLadderId;
  const ladder = alleLadders.find(l => l.id === ladderId);
  const token = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  const verloopt = Date.now() + 14 * 24 * 60 * 60 * 1000;
  // Sla per ladder een invite op
  await setDoc(doc(db, 'ladder', `invite_${ladderId}`), { token, verloopt, ladderId, ladderNaam: ladder?.naam || ladderId, aangemaakt: Date.now() });
  const url = `${location.origin}${location.pathname}?invite=${token}&ladder=${ladderId}`;
  document.getElementById('invite-link-text').textContent = url;
  document.getElementById('invite-link-wrap').style.display = 'block';
  document.getElementById('invite-status').textContent = `Geldig tot ${new Date(verloopt).toLocaleDateString('nl-NL')} · Ladder: ${ladder?.naam || ladderId}`;
  toast('Uitnodigingslink aangemaakt ✓');
  } catch(e) { console.error('genereerInviteLink mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function kopieerInviteLink() {
  const tekst = document.getElementById('invite-link-text').textContent;
  navigator.clipboard.writeText(tekst).then(() => toast('Link gekopieerd! ✓'));
}

async function checkInviteLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get('invite');
  const ladderId = params.get('ladder') || 'mp';
  if (!token) return;
  document.getElementById('login-scherm').classList.remove('actief');
  document.getElementById('registratie-scherm').style.display = 'block';
  // Sla ladderId op voor gebruik bij registratie
  window._inviteLadderId = ladderId;
  // Valideer token — probeer per-ladder invite en fallback naar globale invite
  let geldig = false;
  try {
    const snapLadder = await getDoc(doc(db, 'ladder', `invite_${ladderId}`));
    if (snapLadder.exists()) {
      const data = snapLadder.data();
    }
    if (snapLadder.exists() && snapLadder.data().token === token && snapLadder.data().verloopt > Date.now()) {
      geldig = true;
    } else {
      const snapGlobal = await getDoc(INVITE_DOC);
      if (snapGlobal.exists() && snapGlobal.data().token === token && snapGlobal.data().verloopt > Date.now()) {
        geldig = true;
      }
    }
  } catch(e) { console.error('Invite check fout:', e); }
  if (!geldig) {
    document.getElementById('reg-formulier').style.display = 'none';
    const fout = document.getElementById('reg-fout');
    fout.textContent = 'Deze uitnodigingslink is verlopen of ongeldig. Vraag de beheerder om een nieuwe link.';
    fout.style.display = 'block';
  }
}

let _bezigMetRegistratie = false;

async function registreerSpeler() {
  const voornaam = document.getElementById('reg-voornaam').value.trim();
  const achternaam = document.getElementById('reg-achternaam').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const pass = document.getElementById('reg-pass').value;
  const hcp = parseInt(document.getElementById('reg-hcp').value);
  const fout = document.getElementById('reg-fout');
  const succes = document.getElementById('reg-succes');

  fout.style.display = 'none';
  succes.style.display = 'none';

  if (!voornaam) { fout.textContent = 'Vul je voornaam in'; fout.style.display = 'block'; return; }
  if (!achternaam) { fout.textContent = 'Vul je achternaam in'; fout.style.display = 'block'; return; }
  if (!email || !email.includes('@')) { fout.textContent = 'Vul een geldig e-mailadres in'; fout.style.display = 'block'; return; }
  if (pass.length < 6) { fout.textContent = 'Wachtwoord moet minimaal 6 tekens zijn'; fout.style.display = 'block'; return; }
  if (isNaN(hcp)) { fout.textContent = 'Vul je playing handicap in'; fout.style.display = 'block'; return; }
  if (!document.getElementById('reg-akkoord')?.checked) { fout.textContent = 'Ga akkoord met de voorwaarden om verder te gaan'; fout.style.display = 'block'; return; }

  const naam = `${voornaam} ${achternaam}`;

  try {
    _bezigMetRegistratie = true;
    // Stap 1: Maak Auth account aan en log direct in
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;

    // Stap 2: Nu ingelogd — schrijf naar Firestore
    const users = await getUsers(true); // forceFresh bij registratie
    if (!users.some(u => u.email?.toLowerCase() === email.toLowerCase())) {
      users.push({ naam, gebruikersnaam: naam, email, uid, rol: 'speler' });
      await saveUsers(users);
    }

    // Haal ID op uit de gekoppelde ladder
    const targetLadderId = window._inviteLadderId || 'mp';
    const ladderSnap = await getDoc(doc(db, 'ladders', targetLadderId));
    const ladderData = ladderSnap.exists() ? ladderSnap.data() : { spelers: [], nextId: 1 };
    ladderData.spelers = ladderData.spelers || [];
    const newId = getNextId();
    const newRank = ladderData.spelers.length + 1;

    // Voeg toe aan ladder — controleer eerst op duplicaten
    const bestaatAl = ladderData.spelers.some(s => 
      s.naam.toLowerCase() === naam.toLowerCase() || s.email === email
    );
    if (!bestaatAl) {
      ladderData.spelers.push({ id: newId, naam, hcp, rank: newRank, partijen: 0, gewonnen: 0 });
      ladderData.spelerIds = (ladderData.spelerIds || []).concat([newId]);
      ladderData.nextId = newId + 1;
      await setDoc(doc(db, 'ladders', targetLadderId), ladderData);
    }

    // Voeg toe aan master spelerslijst — controleer op duplicaten
    const spelersSnap2 = await getDoc(SPELERS_DOC);
    const masterLijst = spelersSnap2.exists() ? (spelersSnap2.data().lijst || []) : [];
    if (!masterLijst.some(s => s.naam.toLowerCase() === naam.toLowerCase())) {
      masterLijst.push({ id: newId, naam, hcp });
      await setDoc(SPELERS_DOC, { lijst: masterLijst });
    }

    const ladderNaam = ladderData.naam || alleLadders.find(l => l.id === targetLadderId)?.naam || targetLadderId;

    _bezigMetRegistratie = false;
    document.getElementById('reg-formulier').style.display = 'none';
    succes.innerHTML = `<strong>Welkom ${voornaam}!</strong> Je bent succesvol geregistreerd en staat nu in de <strong>${ladderNaam}</strong> ladder.<br><br>
      <a href="${location.origin}${location.pathname}" style="color:var(--green);font-weight:600">Klik hier om in te loggen →</a>`;
    succes.style.display = 'block';

    // Tel gebruik van uitnodigingslink
    try {
      const inviteRef = doc(db, 'ladder', `invite_${targetLadderId}`);
      const inviteSnap = await getDoc(inviteRef);
      if (inviteSnap.exists()) {
        const data = inviteSnap.data();
        await setDoc(inviteRef, { ...data, gebruik: (data.gebruik || 0) + 1 });
      }
    } catch(e) { console.error('Invite teller mislukt:', e); }

  } catch(e) {
    _bezigMetRegistratie = false;
    if (e.code === 'auth/email-already-in-use') {
      fout.innerHTML = `Dit e-mailadres is al geregistreerd.<br><br>
        <strong>Wachtwoord vergeten?</strong> Ga naar de <a href="${location.origin}${location.pathname}" style="color:var(--green)">inlogpagina</a> 
        en klik op "Wachtwoord vergeten?". Je ontvangt een reset-link per e-mail. 
        <em>Controleer ook je spambox.</em>`;
    } else {
      fout.textContent = 'Registratie mislukt: ' + e.message;
    }
    fout.style.display = 'block';
  }
}

async function laadInviteStatus() {
  try {
    const sel = document.getElementById('invite-ladder-select');
    if (sel) {
      const huidigeWaarde = sel.value;
      sel.innerHTML = alleLadders.map(l => `<option value="${l.id}">${l.naam}</option>`).join('');
      if (huidigeWaarde && alleLadders.find(l => l.id === huidigeWaarde)) {
        sel.value = huidigeWaarde;
      }
      sel.onchange = () => laadInviteStatus();
    }
    const ladderId = sel?.value || activeLadderId;
    const snap = await getDoc(doc(db, 'ladder', `invite_${ladderId}`));
    const el = document.getElementById('invite-status');
    if (!el) return;
    if (snap.exists() && snap.data().verloopt > Date.now()) {
      const url = `${location.origin}${location.pathname}?invite=${snap.data().token}&ladder=${ladderId}`;
      const gebruik = snap.data().gebruik || 0;
      el.textContent = `Actief — geldig tot ${new Date(snap.data().verloopt).toLocaleDateString('nl-NL')} · ${gebruik} keer gebruikt`;
      document.getElementById('invite-link-text').textContent = url;
      document.getElementById('invite-link-wrap').style.display = 'block';
    } else {
      el.textContent = 'Geen actieve uitnodiging voor deze ladder.';
      document.getElementById('invite-link-wrap').style.display = 'none';
    }
  } catch(e) {}
}

function autoAdvance(input) {
  const tabIdx = parseInt(input.getAttribute('tabindex'));
  if (!tabIdx) {
    const inputs = Array.from(document.querySelectorAll('input[type=number]'));
    const idx = inputs.indexOf(input);
    if (idx >= 0 && idx < inputs.length - 1) {
      inputs[idx + 1].focus();
      inputs[idx + 1].select();
    }
    return;
  }
  const next = document.querySelector(`input[tabindex="${tabIdx + 1}"]`);
  if (next) { next.focus(); next.select(); }
}

// ============================================================
//  WINDOW EXPORTS
// ============================================================

// Expose functions to global scope (needed because script is type=module)
window.showPage = showPage;
window.addPlayerSlot = addPlayerSlot;
window.removeSlot = removeSlot;
window.onBaanSelect = onBaanSelect;
window.startPartij = startPartij;
window.updateScore = updateScore;
window.toggleScorecard = toggleScorecard;
window.openUitslagModal = openUitslagModal;
window.setWinnaar = setWinnaar;
window.bevestigUitslag = bevestigUitslag;
window.openAddPlayer = openAddPlayer;
window.saveNewPlayer = saveNewPlayer;
window.openEditPlayer = openEditPlayer;
window.saveEditPlayer = saveEditPlayer;
window.removePlayer = removePlayer;
window.closeModal = closeModal;
window.resetData = resetData;
window.sluitUitslagEnGaNaarLadder = sluitUitslagEnGaNaarLadder;
window.slaAangepasteBaanOp = slaAangepasteBaanOp;
window.verwijderAangepasteBaan = verwijderAangepasteBaan;
window.openToevoegenModal = openToevoegenModal;
window.bevestigToevoegenRonde = bevestigToevoegenRonde;
window.verwijderSpelerUitRonde = verwijderSpelerUitRonde;
window.skipMatchup = skipMatchup;
window.annuleerEigenPartij = annuleerEigenPartij;
window.openBeheerPartij = openBeheerPartij;
window.setBeheerWinnaar = setBeheerWinnaar;
window.bevestigBeheerUitslag = bevestigBeheerUitslag;
window.verwijderActievePartij = verwijderActievePartij;
window.verschuifRank = verschuifRank;
// ============================================================

export { openStandAanpassen, renderStandAanpassenLijst, verschuifStand, slaStandOp, openLadderInstellingen, slaLadderInstellingenOp, openNieuweLadderModal, maakNieuweLadder, verschuifLadder, verwijderLadder, openLadderSpelersModal, slaLadderSpelersOp, renderAdminLadders, openSnapshotsModal, slaSnapshotOp, laadSnapshots, herstelSnapshot };
