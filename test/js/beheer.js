// ============================================================
//  beheer.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, state, alleLadders, activeLadderId, _bezigMetRegistratie, _standAanpassenSpelers, _standAanpassenLadderId, _instellingenLadderId, _ladderSpelersId, DEFAULT_LADDER_CONFIG } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { laadInviteStatus } from './auth.js';
import { renderLadder } from './ladder.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';


//  LADDER INSTELLINGEN
// ============================================================
async function openStandAanpassen(ladderId) {

  try {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) return;
  store._standAanpassenLadderId = ladderId;

  const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
  if (!snapExists) return;
  store._standAanpassenSpelers = [...(snapData.spelers || [])].sort((a,b) => a.rank - b.rank);

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
  store._instellingenLadderId = ladderId;
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

// Helper: haal ladder data op — gebruik cache als beschikbaar, anders Firestore

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
  const nieuweData = { id: snap.id, ...snap.data() };

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
  store.alleLadders = alleLadders.filter(l => l.id !== ladderId);
  if (ladderId === activeLadderId) {
    store.activeLadderId = alleLadders[0]?.id || null;
    store.state = alleLadders[0] || state;
  }
  renderAdminLadders();
  toast('Ladder verwijderd');
  } catch(e) { console.error('verwijderLadder mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}


async function openLadderSpelersModal(ladderId) {
  try {
    const ladder = alleLadders.find(l => l.id === ladderId);
    if (!ladder) return;
    store._ladderSpelersId = ladderId;
    document.getElementById('ladder-spelers-titel').textContent = `Spelers in "${ladder.naam}"`;

    // Laad actuele ladder data en spelers/ collectie
    const [ladderResult, users] = await Promise.all([
      getLadderData(ladderId, true),
      getUsers()
    ]);
    const ladderDataVers = ladderResult.data || {};

    // Huidige leden — primary check op uid
    const huidigeUids = new Set(ladderDataVers.spelerIds?.filter(id => typeof id === 'string' && id.length > 10) || []);

    // Toon alle bekende spelers — uit spelers/ collectie (uid-based)
    const gesorteerd = [...users].sort((a, b) =>
      (a.naam || '').localeCompare(b.naam || '', 'nl')
    );

    document.getElementById('ladder-spelers-lijst').innerHTML = gesorteerd.length === 0
      ? '<p style="font-size:13px;color:var(--light);padding:12px 0">Geen spelers gevonden. Voeg eerst spelers toe via Spelers beheren.</p>'
      : gesorteerd.map(u => {
          const inLadder = huidigeUids.has(u.uid) ||
            (u.naam && (ladderDataVers.spelers || []).some(s => s.naam?.toLowerCase() === u.naam.toLowerCase()));
          const hcp = u.hcp != null ? u.hcp : '—';
          return `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
            <input type="checkbox" value="${u.uid}" ${inLadder ? 'checked' : ''}
              data-naam="${(u.naam || '').replace(/"/g, '&quot;')}"
              data-hcp="${u.hcp ?? 0}"
              style="width:18px;height:18px;accent-color:var(--green);cursor:pointer">
            <span style="flex:1">${u.naam || u.email}</span>
            <span style="font-size:12px;color:var(--light)">hcp ${hcp}</span>
          </label>`;
        }).join('');

    document.getElementById('modal-ladder-spelers').classList.add('open');
  } catch(e) { console.error('openLadderSpelersModal mislukt:', e); }
}

async function slaLadderSpelersOp() {
  try {
    const ladderId = _ladderSpelersId;
    if (!ladderId) return;

    const checkboxes = document.querySelectorAll('#ladder-spelers-lijst input[type=checkbox]');
    // Geselecteerde UIDs (strings) uit de checkboxes
    const geselecteerdeUids = [...checkboxes]
      .filter(c => c.checked)
      .map(c => c.value);  // uid strings

    const { exists: snapExists, data: snapData } = await getLadderData(ladderId, true);
    const ladderData = snapExists ? snapData
      : { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), naam: alleLadders.find(l => l.id === ladderId)?.naam };

    const huidigeSpelers = ladderData.spelers || [];

    // Bouw spelers[] opnieuw op — backward compat voor partij/ronde modules
    // Match uid → bestaande speler via naam of maak nieuw entry
    const nieuweSpelers = [];
    for (const cb of [...checkboxes].filter(c => c.checked)) {
      const uid  = cb.value;
      const naam = cb.dataset.naam || '';
      const hcp  = parseFloat(cb.dataset.hcp) || 0;

      // Zoek bestaand entry op naam
      const bestaand = huidigeSpelers.find(s => s.naam?.toLowerCase() === naam.toLowerCase());
      if (bestaand) {
        nieuweSpelers.push({ ...bestaand });
      } else {
        // v3.0.0-9c: alleen nog getNextId(), geen alleSpelersData-lookup.
        // Numeric ids verdwijnen in een volgende fase.
        const numericId = getNextId() + nieuweSpelers.length;
        nieuweSpelers.push({
          id: numericId, naam, hcp,
          rank: nieuweSpelers.length + 1, partijen: 0, gewonnen: 0
        });
      }

      // Schrijf ook standen/{uid} als die nog niet bestaat
      try {
        const standenRef = doc(db, 'ladders', ladderId, 'standen', uid);
        const standenSnap = await getDoc(standenRef);
        if (!standenSnap.exists()) {
          const nieuweRank = nieuweSpelers.length;
          await setDoc(standenRef, { rank: nieuweRank, partijen: 0, gewonnen: 0 });
        }
      } catch(e) { console.warn('standen write mislukt voor', uid, e.code); }
    }

    nieuweSpelers.sort((a, b) => a.rank - b.rank).forEach((s, i) => s.rank = i + 1);

    // Sla op: spelerIds als UIDs (primary), spelers[] als numeric (backward compat)
    const updatedData = { ...ladderData, spelers: nieuweSpelers, spelerIds: geselecteerdeUids };
    await setDoc(doc(db, 'ladders', ladderId), updatedData);

    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) {
      alleLadders[idx].spelerIds = geselecteerdeUids;
      alleLadders[idx].spelers   = nieuweSpelers;
      if (alleLadders[idx].data) {
        alleLadders[idx].data.spelerIds = geselecteerdeUids;
        alleLadders[idx].data.spelers   = nieuweSpelers;
      }
    }
    if (ladderId === activeLadderId) {
      state.spelers   = nieuweSpelers;
      state.spelerIds = geselecteerdeUids;
    }

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


// ============================================================
//  WINDOW EXPORTS
// ============================================================

// Expose functions to global scope (needed because script is type=module)
// ============================================================

export { openStandAanpassen, renderStandAanpassenLijst, verschuifStand, slaStandOp, openLadderInstellingen, slaLadderInstellingenOp, openNieuweLadderModal, maakNieuweLadder, verschuifLadder, verwijderLadder, openLadderSpelersModal, slaLadderSpelersOp, renderAdminLadders, openSnapshotsModal, slaSnapshotOp, laadSnapshots, herstelSnapshot };
