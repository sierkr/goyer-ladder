// ============================================================
//  beheer.js
// ============================================================
import { db, auth, IS_TEST, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, _bezigMetRegistratie, _standAanpassenSpelers, _standAanpassenLadderId, _instellingenLadderId, _ladderSpelersId, DEFAULT_LADDER_CONFIG } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
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
  // Laad ranking uit spelerIds + standen/{uid} — geen ladder.spelers[] meer
  const spelerIds = snapData.spelerIds || [];
  const standenSnaps = await Promise.all(
    spelerIds.map(uid => getDoc(doc(db, 'ladders', ladderId, 'standen', uid)).catch(() => null))
  );
  const spelersUitStanden = spelerIds.map((uid, i) => {
    const d = standenSnaps[i]?.exists() ? standenSnaps[i].data() : {};
    const profiel = (store._usersCache || []).find(u => u.uid === uid) || {};
    return {
      uid,
      naam:     profiel.naam     || uid,
      hcp:      profiel.hcp      ?? 0,
      rank:     d.rank           || 0,
      partijen: d.partijen       || 0,
      gewonnen: d.gewonnen       || 0,
      prevRank: d.prevRank       ?? null,
    };
  });
  store._standAanpassenSpelers = spelersUitStanden.sort((a, b) => (a.rank || 999) - (b.rank || 999));

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
      <span style="flex:1;font-weight:500">${esc(s.naam)}</span>
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

    // Schrijf uitsluitend naar standen/{uid} — ladder.spelers[] is niet meer de bron
    const writes = _standAanpassenSpelers
      .filter(s => s.uid)
      .map(s => {
        const payload = { rank: s.rank || 0, partijen: s.partijen || 0, gewonnen: s.gewonnen || 0 };
        if (s.prevRank != null) payload.prevRank = s.prevRank;
        return setDoc(doc(db, 'ladders', ladderId, 'standen', s.uid), payload);
      });
    await Promise.all(writes);

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

  // Activiteitssysteem
  document.getElementById('cfg-inactiviteit-referentiedatum').value = cfg.inactiviteitReferentiedatum ?? '2026-04-01';
  const inactiviteitAan = cfg.inactiviteitAan ?? true;
  document.getElementById('cfg-inactiviteit-aan').checked = inactiviteitAan;
  document.getElementById('cfg-inactiviteit-wrap').style.display = inactiviteitAan ? 'block' : 'none';
  document.getElementById('cfg-inactiviteit-drempel').value = cfg.inactiviteitDrempelWeken ?? 4;
  document.getElementById('cfg-inactiviteit-model').value = cfg.inactiviteitModel ?? 'zacht';
  document.getElementById('cfg-inactiviteit-aan').onchange = function() {
    document.getElementById('cfg-inactiviteit-wrap').style.display = this.checked ? 'block' : 'none';
  };

  const frequentieAan = cfg.frequentieBonusAan ?? true;
  document.getElementById('cfg-frequentie-aan').checked = frequentieAan;
  document.getElementById('cfg-frequentie-wrap').style.display = frequentieAan ? 'block' : 'none';
  document.getElementById('cfg-frequentie-partijen').value = cfg.frequentieBonusPartijen ?? 3;
  document.getElementById('cfg-frequentie-plekken').value = cfg.frequentieBonusPlekken ?? 1;
  document.getElementById('cfg-frequentie-aan').onchange = function() {
    document.getElementById('cfg-frequentie-wrap').style.display = this.checked ? 'block' : 'none';
  };

  const diversiteitAan = cfg.diversiteitsBonusAan ?? true;
  document.getElementById('cfg-diversiteit-aan').checked = diversiteitAan;
  document.getElementById('cfg-diversiteit-wrap').style.display = diversiteitAan ? 'block' : 'none';
  document.getElementById('cfg-diversiteit-drempel').value = cfg.diversiteitsBonusDrempel ?? 6;
  document.getElementById('cfg-diversiteit-plekken').value = cfg.diversiteitsBonusPlekken ?? 2;
  document.getElementById('cfg-diversiteit-aan').onchange = function() {
    document.getElementById('cfg-diversiteit-wrap').style.display = this.checked ? 'block' : 'none';
  };

  document.getElementById('cfg-icoon-aan').checked = cfg.icoonAan ?? true;

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
    drempel: parseInt(document.getElementById('cfg-drempel').value) || 4,
    // Activiteitssysteem
    inactiviteitAan: document.getElementById('cfg-inactiviteit-aan').checked,
    inactiviteitReferentiedatum: document.getElementById('cfg-inactiviteit-referentiedatum').value || '2026-04-01',
    inactiviteitDrempelWeken: parseInt(document.getElementById('cfg-inactiviteit-drempel').value) || 4,
    inactiviteitModel: document.getElementById('cfg-inactiviteit-model').value || 'zacht',
    frequentieBonusAan: document.getElementById('cfg-frequentie-aan').checked,
    frequentieBonusPartijen: parseInt(document.getElementById('cfg-frequentie-partijen').value) || 3,
    frequentieBonusPlekken: parseInt(document.getElementById('cfg-frequentie-plekken').value) || 1,
    diversiteitsBonusAan: document.getElementById('cfg-diversiteit-aan').checked,
    diversiteitsBonusDrempel: parseInt(document.getElementById('cfg-diversiteit-drempel').value) || 6,
    diversiteitsBonusPlekken: parseInt(document.getElementById('cfg-diversiteit-plekken').value) || 2,
    icoonAan: document.getElementById('cfg-icoon-aan').checked,
  };

  
  // Sla op in Firestore — alleen config aanraken via merge
  await setDoc(doc(db, 'ladders', ladderId), { config }, { merge: true });

  // Update cache
  const idx = alleLadders.findIndex(l => l.id === ladderId);
  if (idx >= 0) alleLadders[idx].config = config;
  // config zit in alleLadders[idx].config — geen state singleton meer

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
  const nieuweData = {
    naam,
    type,
    spelerIds: [],
    config: { ...DEFAULT_LADDER_CONFIG },
    actievePartijen: [],
    uitslagen: [],
  };

    await setDoc(doc(db, 'ladders', id), nieuweData);
  alleLadders.push({ id, naam, spelerIds: [], type });
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
          const inLadder = huidigeUids.has(u.uid);
          const hcp = u.hcp != null ? u.hcp : '—';
          return `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
            <input type="checkbox" value="${escAttr(u.uid)}" ${inLadder ? 'checked' : ''}
              data-naam="${esc(u.naam || '')}"
              data-hcp="${escAttr(u.hcp ?? 0)}"
              style="width:18px;height:18px;accent-color:var(--green);cursor:pointer">
            <span style="flex:1">${esc(u.naam || u.email)}</span>
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
    const geselecteerdeUids = [...checkboxes].filter(c => c.checked).map(c => c.value);

    const { exists: snapExists, data: snapData } = await getLadderData(ladderId, true);
    const ladderData = snapExists ? snapData
      : { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), naam: alleLadders.find(l => l.id === ladderId)?.naam };

    // Schrijf standen/{uid} voor nieuwe spelers (bestaande blijven ongewijzigd)
    const huidigeUids = new Set(ladderData.spelerIds || []);
    const nieuweUids  = geselecteerdeUids.filter(uid => !huidigeUids.has(uid));
    const nieuweRankBase = geselecteerdeUids.length - nieuweUids.length;
    await Promise.all(nieuweUids.map((uid, i) =>
      setDoc(doc(db, 'ladders', ladderId, 'standen', uid), {
        rank: nieuweRankBase + i + 1, partijen: 0, gewonnen: 0
      }).catch(e => console.warn('standen write mislukt voor', uid, e.code))
    ));

    // Verwijder standen/{uid} voor spelers die uit de ladder zijn gehaald
    const verwijderdeUids = [...huidigeUids].filter(uid => !geselecteerdeUids.includes(uid));
    await Promise.all(verwijderdeUids.map(uid =>
      deleteDoc(doc(db, 'ladders', ladderId, 'standen', uid))
        .catch(e => console.warn('standen delete mislukt voor', uid, e.code))
    ));

    // Sla alleen spelerIds op via merge — nooit het hele document herschrijven
    await setDoc(doc(db, 'ladders', ladderId), { spelerIds: geselecteerdeUids }, { merge: true });

    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) {
      alleLadders[idx].spelerIds = geselecteerdeUids;
      if (alleLadders[idx].data) alleLadders[idx].data.spelerIds = geselecteerdeUids;
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
        <div style="font-weight:600">${esc(l.naam)}</div>
        <div style="font-size:11px;color:var(--light)">${(l.spelerIds||[]).length} spelers${(l.data?.type || l.type) === 'knockout' ? ' · knock-out' : ''}</div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="openLadderSpelersModal('${escAttr(l.id)}')">👥 Spelers</button>
      <button class="btn btn-sm btn-ghost" onclick="openStandAanpassen('${escAttr(l.id)}')">↕ Stand</button>
      ${isBeheerder ? `
        <button class="btn btn-sm btn-ghost" onclick="openLadderInstellingen('${escAttr(l.id)}')">⚙️</button>
        ${l.id !== 'mp' ? `<button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="verwijderLadder('${escAttr(l.id)}')">✕</button>` : '<div style="width:38px"></div>'}
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

async function slaSnapshotOp(label, ladderId) {
  try {
    if (!ladderId) ladderId = activeLadderId;
    if (!ladderId) return;
    // Verwijder snapshots ouder dan 30 dagen
    const dertig = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oudeSnaps = await getDocs(query(SNAPSHOTS_COL, where('timestamp', '<', dertig)));
    oudeSnaps.forEach(d => deleteDoc(d.ref));

    // Lees actuele standen uit standen/{uid}
    const ladder = alleLadders.find(l => l.id === ladderId);
    const spelerIds = ladder?.spelerIds || ladder?.data?.spelerIds || [];
    const standenSnaps = await Promise.all(
      spelerIds.map(uid => getDoc(doc(db, 'ladders', ladderId, 'standen', uid)).catch(() => null))
    );
    const spelersSnapshot = spelerIds.map((uid, i) => {
      const d = standenSnaps[i]?.exists() ? standenSnaps[i].data() : {};
      const profiel = (store._usersCache || []).find(u => u.uid === uid) || {};
      return { uid, naam: profiel.naam || uid, hcp: profiel.hcp ?? 0,
               rank: d.rank || 0, partijen: d.partijen || 0, gewonnen: d.gewonnen || 0 };
    });

    await addDoc(SNAPSHOTS_COL, {
      label,
      ladderId: ladderId,
      ladderNaam: ladder?.naam || ladderId,
      timestamp: Date.now(),
      datum: new Date().toLocaleString('nl-NL'),
      spelers: spelersSnapshot
    });
  } catch(e) { console.error('Snapshot mislukt:', e); }
}

async function laadSnapshots() {
  const wrap = document.getElementById('snapshots-list');
  if (!wrap) return;
  try {
    const snaps = await getDocs(query(SNAPSHOTS_COL, orderBy('timestamp', 'desc')));
    const snapLadderId = _standAanpassenLadderId || activeLadderId;
    const relevant = snaps.docs.filter(d => !d.data().ladderId || d.data().ladderId === snapLadderId);
    if (relevant.length === 0) {
      wrap.innerHTML = '<p style="font-size:13px;color:var(--light);padding:12px 16px">Nog geen snapshots voor deze ladder.</p>';
      return;
    }
    wrap.innerHTML = relevant.map(d => {
      const data = d.data();
      return `<div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:10px">
        <div style="flex:1">
          <div style="font-weight:500;font-size:13px">${esc(data.label)}</div>
          <div style="font-size:11px;color:var(--light)">${esc(data.datum)}${data.ladderNaam ? ' · ' + esc(data.ladderNaam) : ''}</div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="herstelSnapshot('${escAttr(d.id)}')">↩ Herstel</button>
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
    const ladderId   = data.ladderId;
    if (!ladderId) { toast('Snapshot heeft geen ladderId'); return; }
    const ladderNaam = data.ladderNaam || ladderId;

    if (!confirm(`Ladderstand van "${ladderNaam}" herstellen naar:\n${data.label} (${data.datum})?\n\nDe huidige stand wordt eerst opgeslagen.`)) return;

    // Sla huidige stand op voordat we herstellen
    await slaSnapshotOp('⚠️ Voor herstel op ' + new Date().toLocaleString('nl-NL'), ladderId);

    // Schrijf elke speler terug naar standen/{uid}
    const writes = (data.spelers || [])
      .filter(s => s.uid)
      .map(s => setDoc(doc(db, 'ladders', ladderId, 'standen', s.uid), {
        rank:     s.rank     ?? 0,
        partijen: s.partijen ?? 0,
        gewonnen: s.gewonnen ?? 0,
        prevRank: null,
      }));
    await Promise.all(writes);

    renderLadder();
    toast(`Ladderstand "${ladderNaam}" hersteld ✓`);
    closeModal('modal-snapshots');
  } catch(e) { toast('Herstel mislukt: ' + e.message); }
}

// ============================================================
//  UITNODIGINGSLINK
// ============================================================


// ============================================================
//  DATA BACKUP & HERSTEL (volledige database) — v3.0.0-11.103
// ============================================================
// Top-level collecties die meegaan in de backup. 'ladders' krijgt zijn
// standen-subcollectie mee onder de sleutel _standen per ladderdocument.
const _BACKUP_COLLECTIES = ['ladders', 'spelers', 'toernooien', 'uitslagen', 'snapshots'];
const _BACKUP_DOCUMENTEN = ['state', 'users', 'banen', 'archief', 'uitdagingen', 'toernooi', 'config', 'invite', 'ladderVolgorde'];

function _omgevingLabel() { return IS_TEST ? 'TEST' : 'PRODUCTIE (live)'; }

// Zet het omgeving-label in de beheerkaart zodra het DOM klaar is.
if (typeof document !== 'undefined') {
  const _zet = () => { const el = document.getElementById('backup-omgeving-label'); if (el) el.textContent = _omgevingLabel(); };
  if (document.readyState !== 'loading') _zet();
  else document.addEventListener('DOMContentLoaded', _zet);
}

async function maakBackup() {
  const status = document.getElementById('backup-status');
  try {
    if (status) status.textContent = 'Backup wordt gemaakt…';
    const data = {
      _meta: {
        app: 'goyer-golf-mp-ladder',
        omgeving: IS_TEST ? 'test' : 'productie',
        datum: new Date().toISOString(),
      },
      collecties: {},
      documenten: {},
    };

    for (const c of _BACKUP_COLLECTIES) {
      const snap = await getDocs(collection(db, c));
      data.collecties[c] = {};
      for (const d of snap.docs) {
        const docData = d.data();
        if (c === 'ladders') {
          const st = await getDocs(collection(db, 'ladders', d.id, 'standen'));
          const standen = {};
          st.docs.forEach(s => { standen[s.id] = s.data(); });
          docData._standen = standen;
        }
        data.collecties[c][d.id] = docData;
      }
    }

    for (const id of _BACKUP_DOCUMENTEN) {
      const snap = await getDoc(doc(db, 'ladder', id));
      if (snap.exists()) data.documenten[id] = snap.data();
    }

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const naam = `goyer-ladder-backup-${IS_TEST ? 'test-' : ''}${stamp}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = naam; a.click();
    URL.revokeObjectURL(url);

    const nL = Object.values(data.collecties.ladders || {}).length;
    const nS = Object.values(data.collecties.spelers || {}).length;
    if (status) status.textContent = `✓ Backup gedownload (${nL} ladders, ${nS} spelers) — omgeving: ${_omgevingLabel()}`;
  } catch (e) {
    console.error('maakBackup mislukt:', e);
    if (status) status.textContent = 'Backup mislukt — zie console.';
    toast('Backup mislukt');
  }
}

function kiesBackupBestand(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // reset zodat hetzelfde bestand opnieuw gekozen kan worden
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { toast('Ongeldig backup-bestand (geen JSON)'); return; }
    if (!data || !data.collecties || !data.documenten) {
      toast('Dit lijkt geen Goyer-ladder backup');
      return;
    }
    const herkomst = data._meta?.omgeving || 'onbekend';
    const aantalLadders = Object.keys(data.collecties.ladders || {}).length;
    const waarschuwing =
      `BACKUP TERUGZETTEN\n\n` +
      `Bron: ${herkomst} (${data._meta?.datum || 'onbekende datum'})\n` +
      `Doel: ${_omgevingLabel()}\n\n` +
      `Dit OVERSCHRIJFT de huidige data (${aantalLadders} ladders in de backup).\n` +
      (IS_TEST ? '' : '⚠️ Je staat in PRODUCTIE — dit raakt de live database!\n') +
      `\nDoorgaan?`;
    if (!confirm(waarschuwing)) return;
    zetBackupTerug(data);
  };
  reader.onerror = () => toast('Kon bestand niet lezen');
  reader.readAsText(file);
}

async function zetBackupTerug(data) {
  const status = document.getElementById('backup-status');
  try {
    if (status) status.textContent = 'Backup wordt teruggezet…';
    let geschreven = 0;

    for (const [c, docs] of Object.entries(data.collecties || {})) {
      for (const [id, docData] of Object.entries(docs)) {
        const kopie = { ...docData };
        const standen = kopie._standen; delete kopie._standen;
        await setDoc(doc(db, c, id), kopie);
        geschreven++;
        if (standen && typeof standen === 'object') {
          for (const [uid, s] of Object.entries(standen)) {
            await setDoc(doc(db, c, id, 'standen', uid), s);
            geschreven++;
          }
        }
      }
    }

    for (const [id, docData] of Object.entries(data.documenten || {})) {
      await setDoc(doc(db, 'ladder', id), docData);
      geschreven++;
    }

    if (status) status.textContent = `✓ Backup teruggezet in ${_omgevingLabel()} (${geschreven} documenten). Herlaad de pagina om de nieuwe data te zien.`;
    toast('Backup teruggezet ✓');
  } catch (e) {
    console.error('zetBackupTerug mislukt:', e);
    if (status) status.textContent = 'Terugzetten mislukt — zie console. Mogelijk ontbreken rechten op deze database.';
    toast('Terugzetten mislukt');
  }
}

window.maakBackup = maakBackup;
window.kiesBackupBestand = kiesBackupBestand;

// ============================================================
//  WINDOW EXPORTS
// ============================================================

// Expose functions to global scope (needed because script is type=module)
// ============================================================

export { openStandAanpassen, renderStandAanpassenLijst, verschuifStand, slaStandOp, openLadderInstellingen, slaLadderInstellingenOp, openNieuweLadderModal, maakNieuweLadder, verschuifLadder, verwijderLadder, openLadderSpelersModal, slaLadderSpelersOp, renderAdminLadders, openSnapshotsModal, slaSnapshotOp, laadSnapshots, herstelSnapshot };
