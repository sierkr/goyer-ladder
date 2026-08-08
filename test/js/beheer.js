// ============================================================
//  beheer.js
// ============================================================
import { db, auth, IS_TEST, functions, httpsCallable, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, huidigeBruiker, _bezigMetRegistratie, _standAanpassenSpelers, _standAanpassenLadderId, _instellingenLadderId, _ladderSpelersId, DEFAULT_LADDER_CONFIG } from './store.js';

// v4.2.0: puntensysteem — handmatige aanpassing door de puntenbeheerder.
const _pasPuntenAanFn = httpsCallable(functions, 'pasPuntenAan');
// v5.2.0: snapshots en backup lopen via Cloud Functions, omdat punten/ en
// verwerkt/ voor clients afgeschermd zijn (firestore.rules). Zonder deze
// route zou een snapshot of backup die delen missen en een herstel dus een
// half-consistente database opleveren.
const _maakSnapshotFn        = httpsCallable(functions, 'maakLadderSnapshot');
const _herstelSnapshotFn     = httpsCallable(functions, 'herstelLadderSnapshot');
const _exporteerExtraFn      = httpsCallable(functions, 'exporteerBackupExtra');
const _importeerExtraFn      = httpsCallable(functions, 'importeerBackupExtra');
// v5.2.1 — onderhoudsfuncties die ook de afgeschermde collecties opruimen.
const _resetSeizoenFn        = httpsCallable(functions, 'resetLadderSeizoen');
const _verwijderLadderFn     = httpsCallable(functions, 'verwijderLadderVolledig');
// Lokale cache van de zojuist geladen punten voor de open Spelers-modal,
// gebruikt voor de live positie-preview terwijl je typt (geen extra reads).
let _puntenModalScores = {}; // uid -> score
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen, normaliseerLadderRangen, herstelLadderIntegriteit } from './auth.js';
import { laadInviteStatus } from './auth.js';
import { renderLadder } from './ladder.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';


//  LADDER INSTELLINGEN
// ============================================================
// v4.2.0: de "Stand aanpassen"-modal met pijltjes-omhoog/omlaag
// (openStandAanpassen/renderStandAanpassenLijst/verschuifStand/slaStandOp)
// is verwijderd. Handmatig een speler verplaatsen bestaat niet meer — in
// plaats daarvan past de puntenbeheerder in de "Spelers"-modal hieronder
// direct het puntenaantal aan (zie openLadderSpelersModal), waaruit de
// positie 1..N wordt afgeleid.

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
  // v5.1.0: periode waarop de activiteitscorrectie wordt verwerkt.
  document.getElementById('cfg-activiteit-periode').value = cfg.activiteitPeriode ?? 'maand';
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

// ============================================================
//  Activiteit nu verwerken — v5.1.0
//  Draait de periodieke activiteitscorrectie meteen voor deze ladder, in
//  plaats van te wachten tot maandagochtend. Alleen coordinator/beheerder;
//  de Cloud Function controleert dat ook zelf.
// ============================================================
const _verwerkActiviteitNuFn = httpsCallable(functions, 'verwerkActiviteitNu');

async function draaiActiviteitNu() {
  const ladderId = _instellingenLadderId;
  if (!ladderId) return;
  if (!confirm('Activiteitscorrectie nu verwerken? Spelers kunnen hierdoor van plek veranderen.')) return;
  try {
    const res = await _verwerkActiviteitNuFn({ ladderId, isTest: IS_TEST });
    const verschoven = res?.data?.verschoven || [];
    if (verschoven.length === 0) {
      toast('Klaar — geen enkele speler verschoof');
    } else {
      toast(`Klaar — ${verschoven.length} speler${verschoven.length === 1 ? '' : 's'} verschoven`);
      console.table(verschoven);
    }
    renderLadder();
  } catch (e) {
    console.error('verwerkActiviteitNu mislukt:', e);
    toast(e?.message || 'Verwerken mislukt');
  }
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
    // v5.1.0: 'maand' = eerste maandag van de maand · 'week' = elke maandag
    activiteitPeriode: document.getElementById('cfg-activiteit-periode').value === 'week' ? 'week' : 'maand',
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
  // v5.2.1: via de server, zodat standen/punten/partijen/verwerkt mee worden
  // opgeruimd. Firestore verwijdert subcollecties niet mee met het document,
  // dus die bleven voorheen onzichtbaar achter.
  try {
    const res = await _verwijderLadderFn({ ladderId, isTest: IS_TEST });
    console.info('Ladder verwijderd, opgeruimde documenten:', res?.data?.opgeruimd ?? 0);
  } catch (e) {
    console.warn('Volledig verwijderen mislukt, val terug op alleen het ladderdocument:', e?.message || e);
    await deleteDoc(doc(db, 'ladders', ladderId));
  }
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

    // v4.2.0: puntensysteem — alleen het puntenBeheerder-account leest de
    // afgeschermde punten-subcollectie (firestore.rules staat dat voor
    // niemand anders toe, dus voor ieder ander account blijft dit scherm
    // ongewijzigd: geen puntenkolom).
    const magPunten = huidigeBruiker?.puntenBeheerder === true;
    _puntenModalScores = {};
    if (magPunten) {
      try {
        const puntenSnap = await getDocs(collection(db, 'ladders', ladderId, 'punten'));
        puntenSnap.forEach(d => { _puntenModalScores[d.id] = d.data().score; });
      } catch(e) { console.warn('Punten laden mislukt (mogelijk geen rechten):', e.code || e); }
    }

    // Toon alle bekende spelers — uit spelers/ collectie (uid-based)
    const gesorteerd = [...users].sort((a, b) =>
      (a.naam || '').localeCompare(b.naam || '', 'nl')
    );

    document.getElementById('ladder-spelers-lijst').innerHTML = gesorteerd.length === 0
      ? '<p style="font-size:13px;color:var(--light);padding:12px 0">Geen spelers gevonden. Voeg eerst spelers toe via Spelers beheren.</p>'
      : gesorteerd.map(u => {
          const inLadder = huidigeUids.has(u.uid);
          const hcp = u.hcp != null ? u.hcp : '—';
          const puntenHtml = (magPunten && inLadder) ? `
            <span style="display:flex;align-items:center;gap:6px;margin-left:8px">
              <input type="number" step="1" value="${_puntenModalScores[u.uid] ?? ''}"
                data-punten-uid="${escAttr(u.uid)}"
                oninput="puntenVeldGewijzigd('${escAttr(u.uid)}', this.value)"
                placeholder="punten"
                style="width:82px;padding:3px 6px;font-size:12px;font-family:'DM Mono',monospace;border:1.5px solid #e0ddd4;border-radius:5px">
              <span id="punten-positie-${escAttr(u.uid)}" style="font-size:11px;color:var(--light);min-width:34px">
                ${_puntenModalScores[u.uid] != null ? '#' + _puntenPositieVan(u.uid) : ''}
              </span>
            </span>` : '';
          return `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
            <input type="checkbox" value="${escAttr(u.uid)}" ${inLadder ? 'checked' : ''}
              data-naam="${esc(u.naam || '')}"
              data-hcp="${escAttr(u.hcp ?? 0)}"
              style="width:18px;height:18px;accent-color:var(--green);cursor:pointer">
            <span style="flex:1">${esc(u.naam || u.email)}</span>
            <span style="font-size:12px;color:var(--light)">hcp ${hcp}</span>
            ${puntenHtml}
          </label>`;
        }).join('');

    document.getElementById('modal-ladder-spelers').classList.add('open');
  } catch(e) { console.error('openLadderSpelersModal mislukt:', e); }
}

// Positie (1-gebaseerd) die uid zou krijgen bij de huidige _puntenModalScores,
// puur lokaal berekend (geen netwerk) — voor de live preview terwijl je typt.
function _puntenPositieVan(uid) {
  const volgorde = Object.entries(_puntenModalScores)
    .filter(([, score]) => score != null)
    .sort((a, b) => b[1] - a[1]);
  const idx = volgorde.findIndex(([u]) => u === uid);
  return idx === -1 ? '?' : idx + 1;
}

// Live preview: bijgewerkt bij elke toetsaanslag in een punten-invoerveld.
// Schrijft niets naar Firestore — dat gebeurt pas bij "Opslaan" in slaLadderSpelersOp().
function puntenVeldGewijzigd(uid, waarde) {
  const getal = waarde === '' ? null : Number(waarde);
  _puntenModalScores[uid] = (getal != null && Number.isFinite(getal)) ? getal : null;
  const label = document.getElementById(`punten-positie-${uid}`);
  if (label) label.textContent = _puntenModalScores[uid] != null ? '#' + _puntenPositieVan(uid) : '';
}
window.puntenVeldGewijzigd = puntenVeldGewijzigd;

async function slaLadderSpelersOp() {
  try {
    const ladderId = _ladderSpelersId;
    if (!ladderId) return;

    const checkboxes = document.querySelectorAll('#ladder-spelers-lijst input[type=checkbox]');
    const geselecteerdeUids = [...checkboxes].filter(c => c.checked).map(c => c.value);

    const { exists: snapExists, data: snapData } = await getLadderData(ladderId, true);
    const ladderData = snapExists ? snapData
      : { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), naam: alleLadders.find(l => l.id === ladderId)?.naam };

    const huidigeUids = new Set(ladderData.spelerIds || []);
    const nieuweUids  = geselecteerdeUids.filter(uid => !huidigeUids.has(uid));

    // v4.2.0: uitvinken verwijdert een speler alleen uit de ladderlijst.
    // Het stand-document (en de punten) blijven bestaan — vink je iemand
    // later weer aan, dan staat hij gewoon weer op zijn oude punten/positie.
    const batch = writeBatch(db);
    nieuweUids.forEach((uid, i) => {
      batch.set(doc(db, 'ladders', ladderId, 'standen', uid), { rank: 9000 + i, partijen: 0, gewonnen: 0 }, { merge: true });
    });
    batch.set(doc(db, 'ladders', ladderId), { spelerIds: geselecteerdeUids }, { merge: true });
    await batch.commit();

    // Rangen naar een schone permutatie 1..N voor de huidige leden (nieuwe
    // spelers komen achteraan; wie eruit gevinkt is telt niet meer mee).
    await normaliseerLadderRangen(ladderId);

    // v4.2.0: handmatige puntenaanpassingen opslaan (alleen als dit scherm
    // voor de puntenbeheerder geopend was — anders is _puntenModalScores leeg).
    if (huidigeBruiker?.puntenBeheerder === true) {
      const puntenInputs = document.querySelectorAll('#ladder-spelers-lijst input[data-punten-uid]');
      for (const input of puntenInputs) {
        const uid = input.dataset.puntenUid;
        const nieuw = input.value === '' ? null : Number(input.value);
        if (nieuw == null || !Number.isFinite(nieuw)) continue;
        try {
          await _pasPuntenAanFn({ ladderId, isTest: IS_TEST, uid, score: nieuw });
        } catch(e) { console.error('pasPuntenAan mislukt voor', uid, e); toast('Puntenaanpassing voor één speler mislukt'); }
      }
    }

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

// ============================================================
//  slaSnapshotOp — v5.2.1: nu ook mét punten
// ------------------------------------------------------------
//  v5.2.0 zette alleen de HANDMATIGE snapshot om naar de server. Deze functie
//  — die na élke bevestigde partij en na elk toernooi draait, en dus verreweg
//  de meeste snapshots maakt — bleef de client-versie gebruiken en legde
//  alleen `standen` vast. Herstel je zo'n snapshot, dan kloppen de posities
//  wel maar blijft de puntenadministratie staan zoals hij was: precies de
//  half-consistente toestand die v5.2.0 moest voorkomen.
//
//  Nu loopt alles via maakLadderSnapshot. Lukt dat niet (offline, functie nog
//  niet gedeployed), dan valt hij terug op de oude client-versie — een
//  onvolledige snapshot is nog altijd beter dan géén snapshot, en die wordt
//  bij herstel herkend aan het ontbreken van `bevatPunten`.
// ============================================================
async function slaSnapshotOp(label, ladderId) {
  if (!ladderId) ladderId = activeLadderId;
  if (!ladderId) return;
  try {
    await _maakSnapshotFn({ ladderId, isTest: IS_TEST, label });
    return;
  } catch (e) {
    console.warn('Snapshot via server mislukt, val terug op client-versie:', e?.message || e);
  }
  await _slaSnapshotClientOp(label, ladderId);
}

// Terugval: legt alleen standen vast (geen punten). Zie hierboven.
async function _slaSnapshotClientOp(label, ladderId) {
  try {
    // v3.0.7: retentie 730 dagen, zodat het ladderverloop een heel seizoen kan tonen.
    const retentieGrens = Date.now() - 730 * 24 * 60 * 60 * 1000;
    const oudeSnaps = await getDocs(query(SNAPSHOTS_COL, where('timestamp', '<', retentieGrens)));
    for (const d of oudeSnaps.docs) {
      try { await deleteDoc(d.ref); } catch(e) { /* stil */ }
    }

    const ladder = alleLadders.find(l => l.id === ladderId);
    const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
    const spelersSnapshot = standenSnap.docs.map(d => {
      const data = d.data();
      const profiel = (store._usersCache || []).find(u => u.uid === d.id) || {};
      return {
        uid: d.id,
        naam: profiel.naam || d.id,
        hcp: profiel.hcp ?? 0,
        rank: data.rank || 0,
        partijen: data.partijen || 0,
        gewonnen: data.gewonnen || 0,
      };
    });

    await addDoc(SNAPSHOTS_COL, {
      label: label + ' (zonder punten)',
      ladderId,
      ladderNaam: ladder?.naam || ladderId,
      timestamp: Date.now(),
      datum: new Date().toLocaleString('nl-NL'),
      spelers: spelersSnapshot,
      bevatPunten: false,
    });
  } catch(e) { console.error('Snapshot mislukt:', e); }
}

// ============================================================
//  Handmatige snapshot — v5.2.0
//  Tot nu toe werd er alleen automatisch een snapshot gemaakt (na een partij,
//  na een toernooi, vóór een herstel). Er was geen manier om er zelf een te
//  maken vlak voordat je iets ingrijpends doet.
// ============================================================
async function maakSnapshotNu() {
  const ladderId = _standAanpassenLadderId || _instellingenLadderId || activeLadderId;
  if (!ladderId) { toast('Kies eerst een ladder'); return; }
  const ladder = alleLadders.find(l => l.id === ladderId);
  const standaard = 'Handmatig — ' + new Date().toLocaleString('nl-NL');
  const label = prompt(`Snapshot maken van "${ladder?.naam || ladderId}".\n\nGeef een omschrijving:`, standaard);
  if (label === null) return;
  try {
    const res = await _maakSnapshotFn({ ladderId, isTest: IS_TEST, label: label.trim() || standaard });
    toast(`Snapshot gemaakt — ${res?.data?.aantal ?? 0} spelers vastgelegd ✓`);
    laadSnapshots();
  } catch (e) {
    console.error('maakSnapshotNu mislukt:', e);
    toast(e?.message || 'Snapshot maken mislukt');
  }
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

// ============================================================
//  Snapshot herstellen — v5.2.0 via Cloud Function
//  Was client-side en zette alleen `standen` terug. De punten (score en de
//  activiteitsboekhouding) bleven staan zoals ze waren, waardoor de posities
//  wel klopten maar het systeem dacht dat de activiteitscorrectie al was
//  toegepast — de eerstvolgende periodieke run rekende dan met een verkeerd
//  verschil. De server zet nu beide terug, en maakt eerst automatisch een
//  snapshot van de huidige staat.
// ============================================================
async function herstelSnapshot(snapId) {
  try {
    const snapDoc = await getDoc(doc(db, 'snapshots', snapId));
    if (!snapDoc.exists()) { toast('Snapshot niet gevonden'); return; }
    const data = snapDoc.data();
    const ladderId = data.ladderId;
    if (!ladderId) { toast('Snapshot heeft geen ladderId'); return; }
    const ladderNaam = data.ladderNaam || ladderId;
    const aantalSpelers = (data.spelers || []).length;
    const heeftPunten = data.bevatPunten === true;

    const waarschuwing = heeftPunten
      ? ''
      : '\n\nLET OP: deze snapshot is gemaakt vóór v5.2.0 en bevat geen punten. ' +
        'Alleen de posities worden hersteld; de puntenadministratie blijft staan zoals hij nu is.';

    if (!confirm(
      `Ladderstand van "${ladderNaam}" herstellen naar:\n${data.label} (${data.datum})?\n\n` +
      `${aantalSpelers} spelers worden teruggezet.\n` +
      `De huidige stand wordt eerst opgeslagen als snapshot.${waarschuwing}`
    )) return;

    const res = await _herstelSnapshotFn({ ladderId, isTest: IS_TEST, snapshotId: snapId });
    const n = res?.data?.hersteld ?? aantalSpelers;
    renderLadder();
    toast(`Ladderstand "${ladderNaam}" hersteld — ${n} spelers ✓`);
    closeModal('modal-snapshots');
  } catch(e) {
    console.error('herstelSnapshot mislukt:', e);
    toast(e?.message || 'Herstel mislukt');
  }
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
        // v5.2.0: vanaf deze versie zitten punten, partijen, verwerkt en
        // teruggedraaid in de backup. Oudere backups missen die.
        formaat: 'v5.2.0',
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

    // v5.2.0: de afgeschermde delen erbij. punten/ en verwerkt/ zijn voor
    // clients niet leesbaar (firestore.rules), dus die haalt een Cloud
    // Function op met beheerdersrechten. Zonder dit blok mist de backup:
    //  - punten          -> na herstel klopt de activiteitsboekhouding niet
    //  - partijen+scores -> een lopende ronde is na herstel weg
    //  - verwerkt        -> een al verwerkte partij kan nogmaals meetellen
    if (status) status.textContent = 'Backup wordt gemaakt… (punten en partijen)';
    try {
      const extra = await _exporteerExtraFn({ isTest: IS_TEST });
      data.ladderExtra = extra?.data?.ladders || {};
    } catch (e) {
      console.error('Extra backupdata ophalen mislukt:', e);
      // Bewust hard stoppen: een backup die stilletjes onvolledig is, is
      // gevaarlijker dan geen backup.
      if (status) status.textContent = 'Backup mislukt — punten/partijen konden niet worden opgehaald.';
      toast('Backup mislukt: ' + (e?.message || 'punten niet opgehaald'));
      return;
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
    const nP = Object.values(data.ladderExtra || {}).reduce((t, l) => t + Object.keys(l.partijen || {}).length, 0);
    if (status) status.textContent = `✓ Backup gedownload (${nL} ladders, ${nS} spelers, ${nP} lopende partijen) — omgeving: ${_omgevingLabel()}`;
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
      (data._meta?.formaat === 'v5.2.0'
        ? 'Inclusief punten, lopende partijen en verwerkingsstempels.\n'
        : '⚠️ Oude backup: bevat GEEN punten en GEEN lopende partijen.\n') +
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

    // v5.2.0: de afgeschermde delen terugschrijven via de Cloud Function.
    // punten/ en verwerkt/ staan in firestore.rules op `allow write: if false`,
    // dus geen enkele client kan daar rechtstreeks in schrijven.
    if (data.ladderExtra && Object.keys(data.ladderExtra).length) {
      if (status) status.textContent = 'Backup wordt teruggezet… (punten en partijen)';
      try {
        const res = await _importeerExtraFn({ isTest: IS_TEST, ladders: data.ladderExtra });
        geschreven += res?.data?.geschreven || 0;
      } catch (e) {
        console.error('Extra backupdata terugzetten mislukt:', e);
        if (status) status.textContent = 'Let op: standen zijn teruggezet, maar punten/partijen niet — zie console.';
        toast('Punten en partijen konden niet worden teruggezet');
        return;
      }
    } else {
      // Backup van vóór v5.2.0: die bevat geen punten. De posities staan goed,
      // maar de puntenadministratie hoort daar dan niet meer bij.
      toast('Let op: deze backup bevat geen punten (gemaakt vóór v5.2.0)');
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

export { openLadderInstellingen, slaLadderInstellingenOp, openNieuweLadderModal, maakNieuweLadder, verschuifLadder, verwijderLadder, openLadderSpelersModal, slaLadderSpelersOp, puntenVeldGewijzigd, renderAdminLadders, openSnapshotsModal, slaSnapshotOp, laadSnapshots, herstelSnapshot , draaiActiviteitNu , maakSnapshotNu };
