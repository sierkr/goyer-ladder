// ============================================================
//  admin.js — v3.0.0 — uid-architectuur volledig
//  Primaire identifier: uid (Firebase Auth uid)
//  Bron van waarheid:   spelers/{uid} (profiel), standen/{uid} (ranking)
// ============================================================
import { db, auth, firebaseConfig, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL,
  SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC,
  INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr,
  EMAIL_SUFFIX, DEFAULT_HCP,
  genereerEmail, loginNaamVan,
  functions, httpsCallable } from './config.js';
import { store, alleLadders, activeLadderId,
  huidigeBruiker, uitdagingenData, store } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers,
  isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { openNieuweLadderModal, renderAdminLadders } from './beheer.js';
import { reageerUitdaging, verwijderUitdaging } from './archief.js';
import { renderLadder } from './ladder.js';
import { getLadderSpelers } from './ladder-view.js';
import { syncStandenNaBevestigUitslag } from './ronde.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc,
  deleteDoc, getDocs, addDoc, query, where, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initApp } from './auth.js';

// ============================================================
//  ADMIN — HOOFD RENDER
// ============================================================

function renderAdmin() {
  const isBeheerder = isBeheerderRol();
  const isCoord     = isCoordinatorRol();

  ['admin-sectie-spelers','admin-sectie-seizoen','admin-sectie-wachtwoord'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isBeheerder ? '' : 'none';
  });
  const ladderSectie = document.getElementById('admin-sectie-ladders');
  if (ladderSectie) ladderSectie.style.display = isCoord ? '' : 'none';
  const nieuweLadderBtn = ladderSectie?.querySelector('button[onclick="openNieuweLadderModal()"]');
  if (nieuweLadderBtn) nieuweLadderBtn.style.display = isBeheerder ? '' : 'none';

  if (!isCoord) return;
  if (isBeheerder) renderAdminSpelersEnAccounts();
  renderAdminLadders();
}

// Render spelerslijst — gebruikt spelers/ collectie als primaire bron
async function renderAdminSpelersEnAccounts() {
  const list = document.getElementById('admin-player-list');
  if (!list) return;

  // getUsers() leest nu uit spelers/ collectie (fase 2)
  let users = [];
  try { users = await getUsers(); } catch(e) {}

  const gesorteerd = [...users].sort((a, b) =>
    (a.naam || a.gebruikersnaam || '').localeCompare(b.naam || b.gebruikersnaam || '', 'nl')
  );

  const rijen = gesorteerd.map(u => {
    const uid  = u.uid;
    const naam = u.naam || u.gebruikersnaam || '—';
    const hcp  = u.hcp != null ? u.hcp : null;

    // Ladder-lidmaatschap: uitsluitend via spelerIds[] (uid)
    const mijnLadders = alleLadders.filter(l =>
      (l.spelerIds || []).includes(uid)
    );
    const ladderBadges = mijnLadders.map(l =>
      `<span class="badge badge-grey" style="font-size:10px">${esc(l.naam)}</span>`
    ).join(' ');

    const rolBadge = u.rol && u.rol !== 'speler'
      ? `<span class="badge" style="font-size:10px;background:var(--green-pale);color:var(--green)">${esc(u.rol)}</span>`
      : '';

    // v3.0.0-11: toon login + initieel wachtwoord i.p.v. volledig email
    // Als eersteLogin=true → wachtwoord is nog steeds MP2026
    // Als eersteLogin=false of undefined → speler heeft eigen wachtwoord
    const loginTxt = loginNaamVan(u.email || '');
    const eersteLogin = u.eersteLogin === true;
    const credRegel = u.email
      ? `<span style="font-size:11px;color:var(--light);font-family:'DM Mono',monospace">${esc(loginTxt)}${eersteLogin ? ` · ${store.initieelWachtwoord}` : ''}</span>${eersteLogin ? '' : '<span style="font-size:10px;color:var(--light);margin-left:4px">· wachtwoord gewijzigd</span>'}`
      : `<span style="font-size:11px;color:#ccc">geen account</span>`;
    const hcpTekst = hcp != null
      ? `hcp ${Math.round(hcp)}`
      : 'hcp —';

    // v3.0.0-11.2: reset-wachtwoord knop, alleen voor beheerder
    // Toont alleen als speler al eersteLogin heeft voltooid (anders is reset overbodig)
    const isBeheerder = isBeheerderRol();
    const heeftEigenWachtwoord = u.eersteLogin === false;
    const resetBtn = (isBeheerder && heeftEigenWachtwoord)
      ? `<button class="btn btn-sm btn-ghost" onclick="vraagResetWachtwoord('${escAttr(uid)}','${escAttr(naam)}')" title="Wachtwoord resetten">🔄</button>`
      : '';

    // Buttons gebruiken uid (string) als identifier
    return `<div class="admin-row" style="flex-wrap:nowrap;gap:6px;align-items:center">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(naam)}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          ${credRegel} ${rolBadge}
        </div>
        ${mijnLadders.length ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px">${ladderBadges}</div>` : ''}
      </div>
      <span style="font-size:12px;color:var(--mid);font-family:'DM Mono',monospace;flex-shrink:0;white-space:nowrap">${hcpTekst}</span>
      ${resetBtn}
      <button class="btn btn-sm btn-ghost" onclick="openEditPlayer('${escAttr(uid)}')" title="Bewerken">✏️</button>
      <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removePlayer('${escAttr(uid)}')" title="Verwijderen">✕</button>
    </div>`;
  });

  list.innerHTML = rijen.length === 0
    ? '<div class="empty"><div class="empty-icon">👤</div><p>Geen spelers.</p></div>'
    : rijen.join('');
}

// ============================================================
//  LADDER HELPERS
// ============================================================

function renderLadderCheckboxes(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (alleLadders.length === 0) {
    wrap.innerHTML = '<span style="font-size:13px;color:var(--light)">Geen ladders beschikbaar</span>';
    return;
  }
  wrap.innerHTML = alleLadders
    .filter(l => (l.data?.type || l.type) !== 'knockout')
    .map(l => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
      <input type="checkbox" value="${escAttr(l.id)}" style="width:16px;height:16px;cursor:pointer">
      ${esc(l.naam)}
    </label>`).join('');
}

function getGeselecteerdeLadders(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

// Voeg speler toe aan ladders — uid als primaire sleutel
async function voegSpelerToeAanLadders(ladderIds, speler, uid) {
  if (!uid) { console.error('voegSpelerToeAanLadders: uid verplicht'); return; }
  for (const ladderId of ladderIds) {
    try {
      const snap = await getDoc(doc(db, 'ladders', ladderId));
      if (!snap.exists()) continue;
      const data      = snap.data();
      const spelerIds = data.spelerIds || [];

      if (spelerIds.includes(uid)) continue; // al lid

      // Bepaal rank op basis van huidige standen/{uid} count
      const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
      const newRank = standenSnap.size + 1;

      // Voeg uid toe aan spelerIds
      spelerIds.push(uid);
      await setDoc(doc(db, 'ladders', ladderId), { ...data, spelerIds });

      // Maak standen/{uid} aan
      await setDoc(doc(db, 'ladders', ladderId, 'standen', uid),
        { rank: newRank, partijen: 0, gewonnen: 0 });

      const idx = alleLadders.findIndex(l => l.id === ladderId);
      if (idx >= 0) {
        alleLadders[idx].spelerIds = spelerIds;
        if (alleLadders[idx].data) alleLadders[idx].data.spelerIds = spelerIds;
      }
    } catch(e) {
      console.error('voegSpelerToeAanLadders mislukt voor ladder', ladderId, e);
      toast('Fout bij toevoegen aan ladder, probeer opnieuw');
    }
  }
}

// ============================================================
//  SPELER TOEVOEGEN
// ============================================================

async function openAddPlayer() {
  document.getElementById('new-player-voornaam').value   = '';
  document.getElementById('new-player-achternaam').value = '';
  // v3.0.0-11: hcp default 10, email + wachtwoord velden bestaan niet meer
  document.getElementById('new-player-hcp').value        = '10';
  document.getElementById('add-player-handmatig').style.display      = 'none';
  document.getElementById('add-player-accounts-wrap').style.display  = 'block';
  document.getElementById('add-player-save-btn').style.display       = 'none';

  // Accounts die al in spelers/ staan zijn al speler — sectie is nu informatief
  try {
    const users = await getUsers();
    const lijst = document.getElementById('add-player-accounts-lijst');
    // Accounts zonder ladder-lidmaatschap — uitsluitend via spelerIds[] (uid)
    const zonderLadder = users.filter(u =>
      !alleLadders.some(l =>
        (l.spelerIds || []).includes(u.uid)
      )
    );
    if (zonderLadder.length === 0) {
      lijst.innerHTML = '<p style="font-size:13px;color:var(--light);padding:8px 0">Alle geregistreerde accounts zijn al in een ladder ingedeeld.</p>';
    } else {
      lijst.innerHTML = zonderLadder.map(u => `
        <div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:10px">
          <div style="flex:1">
            <div style="font-weight:500">${esc(u.naam || u.gebruikersnaam)}</div>
            <div style="font-size:11px;color:var(--light)">${esc(u.email)}</div>
          </div>
          <button class="btn btn-sm btn-primary"
            onclick="voegAccountToeAlsSpeler('${escAttr(u.uid)}','${escAttr(u.naam||u.gebruikersnaam||'')}')">
            + Toevoegen aan ladder
          </button>
        </div>
      `).join('');
    }
  } catch(e) {
    document.getElementById('add-player-accounts-lijst').innerHTML =
      '<p style="font-size:13px;color:var(--red)">Fout bij laden accounts.</p>';
  }

  renderLadderCheckboxes('new-player-ladders');
  document.getElementById('modal-add-player').classList.add('open');
}

function toggleHandmatigToevoegen() {
  const wrap = document.getElementById('add-player-handmatig');
  const btn  = document.getElementById('add-player-save-btn');
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  btn.style.display  = wrap.style.display === 'none' ? 'none' : 'inline-flex';
}

// Voeg bestaand account (al in spelers/) toe aan een ladder
async function voegAccountToeAlsSpeler(uid, naam) {
  try {
    const hcpStr = prompt(`Playing handicap voor ${naam}:`, '10');
    if (hcpStr === null) return;
    const hcp = Math.round(parseFloat(hcpStr));
    if (isNaN(hcp)) { toast('Ongeldige handicap'); return; }

    // Update hcp in spelers/{uid}
    const spelersSnap = await getDoc(doc(db, 'spelers', uid));
    if (spelersSnap.exists()) {
      await setDoc(doc(db, 'spelers', uid), { ...spelersSnap.data(), hcp });
    }

    // Voeg toe aan geselecteerde ladders
    const geselecteerdeLadders = getGeselecteerdeLadders('new-player-ladders');
    if (geselecteerdeLadders.length > 0) {
      await voegSpelerToeAanLadders(geselecteerdeLadders, { naam, hcp }, uid);
      toast(`${naam} toegevoegd aan ladder(s) ✓`);
    } else {
      toast(`${naam} bijgewerkt in spelersbeheer ✓`);
    }

    closeModal('modal-add-player');
    renderAdmin();
  } catch(e) { console.error('voegAccountToeAlsSpeler mislukt:', e); toast('Er is iets misgegaan'); }
}

// Maak volledig nieuw account + speler aan (beheerder flow)
// v3.0.0-11: email + wachtwoord worden auto-gegenereerd.
async function saveNewPlayer() {
  const voornaam   = document.getElementById('new-player-voornaam').value.trim();
  const achternaam = document.getElementById('new-player-achternaam').value.trim();
  const naam       = [voornaam, achternaam].filter(Boolean).join(' ');
  let hcp          = parseFloat(document.getElementById('new-player-hcp').value);
  if (isNaN(hcp)) hcp = DEFAULT_HCP;
  hcp = Math.round(hcp);

  if (!voornaam)   { toast('Voer een voornaam in');   return; }
  if (!achternaam) { toast('Voer een achternaam in'); return; }

  // v3.0.0-11: auto-genereer email + wachtwoord
  const email = genereerEmail(voornaam, achternaam);
  const pass  = store.initieelWachtwoord;

  try {
    const users = await getUsers();
    if (users.find(u => u.email === email)) { toast('Deze naam (email) is al in gebruik'); return; }

    // Auth account aanmaken via secundaire app (logt beheerder niet uit)
    let uid = null;
    try {
      const { initializeApp: init2, deleteApp } =
        await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser } =
        await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      const tijdApp  = init2(firebaseConfig, `tmp_${Date.now()}`);
      const tijdAuth = getAuth2(tijdApp);
      const cred     = await createUser(tijdAuth, email, pass);
      uid = cred.user.uid;
      try { await deleteApp(tijdApp); } catch(e) {}
    } catch(authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        toast('Account bestaat al. Verwijder eerst via Firebase Console → Authentication.');
        return;
      }
      throw authErr;
    }

    // spelers/{uid} aanmaken — eersteLogin:true zodat speler verplicht profiel invult
    await setDoc(doc(db, 'spelers', uid),
      { uid, naam, email, rol: 'speler', hcp, eersteLogin: true });

    // Voeg toe aan geselecteerde ladders
    const geselecteerdeLadders = getGeselecteerdeLadders('new-player-ladders');
    if (geselecteerdeLadders.length > 0) {
      await voegSpelerToeAanLadders(geselecteerdeLadders, { naam, hcp }, uid);
    }

    closeModal('modal-add-player');
    renderAdmin();

    // v3.0.0-11: toon credentials met copy-knop voor WhatsApp doorgeven
    const loginTxt = loginNaamVan(email);
    toonCredentialsModal(naam, loginTxt, pass);
  } catch(e) {
    console.error('saveNewPlayer error:', e);
    toast('Fout bij opslaan: ' + e.message);
  }
}

/**
 * v3.0.0-11: Toont modal met credentials + copy-knop.
 * Gebruikt voor zowel nieuwe-speler als reset-wachtwoord.
 */
function toonCredentialsModal(naam, loginTxt, pass) {
  const bestaand = document.getElementById('modal-credentials');
  if (bestaand) bestaand.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-credentials';
  overlay.className = 'modal-overlay open';
  // Deze modal moet centraal staan, niet als bottom-sheet
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '400';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;border-radius:16px;max-height:90vh">
      <h3>✓ ${esc(naam)}</h3>
      <p style="font-size:13px;color:var(--mid);margin-bottom:12px">
        Geef deze gegevens door aan de speler (bv. via WhatsApp):
      </p>
      <div style="background:#f9f7f2;border:1.5px solid var(--border);border-radius:8px;padding:12px;font-family:'DM Mono',monospace;font-size:13px;margin-bottom:12px">
        <div><strong>login:</strong> ${esc(loginTxt)}</div>
        <div><strong>wachtwoord:</strong> ${esc(pass)}</div>
      </div>
      <button class="btn btn-primary btn-block" onclick="kopieerCredentials('${escAttr(loginTxt)}','${escAttr(pass)}')">
        📋 Kopieer naar klembord
      </button>
      <p style="font-size:11px;color:var(--light);margin-top:10px;text-align:center">
        Bij eerste login kiest de speler een eigen wachtwoord en stelt zijn handicap in.
      </p>
      <button class="btn btn-ghost btn-block" onclick="document.getElementById('modal-credentials').remove()" style="margin-top:10px">
        Sluiten
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

function kopieerCredentials(loginTxt, pass) {
  const tekst = `login: ${loginTxt}\nwachtwoord: ${pass}`;
  navigator.clipboard.writeText(tekst)
    .then(() => toast('Gegevens gekopieerd ✓'))
    .catch(() => toast('Kopiëren mislukt — selecteer handmatig'));
}

// ============================================================
//  WACHTWOORD RESET via Cloud Function — v3.0.0-11.2
// ============================================================
async function vraagResetWachtwoord(uid, naam) {
  const bevestig = confirm(
    `Wachtwoord van ${naam} resetten naar ${store.initieelWachtwoord}?\n\n` +
    `De speler moet bij eerstvolgende inlog een nieuw wachtwoord kiezen en zijn handicap opnieuw instellen.`
  );
  if (!bevestig) return;

  try {
    toast('Bezig met resetten...');
    const resetFn = httpsCallable(functions, 'resetSpelerWachtwoord');
    const result = await resetFn({ targetUid: uid });
    if (result.data?.success) {
      renderAdmin();
      // Toon credentials modal zodat beheerder ze kan kopiëren voor de speler
      const loginTxt = loginNaamVan((await getDoc(doc(db, 'spelers', uid))).data()?.email || '');
      toonCredentialsModal(naam, loginTxt, store.initieelWachtwoord);
    } else {
      toast('Reset mislukt: onverwachte respons');
    }
  } catch(e) {
    console.error('Reset wachtwoord mislukt:', e);
    const msg = e.code === 'functions/permission-denied'
      ? 'Geen rechten — alleen beheerder kan resetten'
      : e.code === 'functions/unauthenticated'
      ? 'Niet ingelogd'
      : e.code === 'functions/not-found'
      ? 'Cloud Function niet gedeployed — run firebase deploy'
      : 'Fout: ' + (e.message || e.code);
    toast(msg);
  }
}

// ============================================================
//  SPELER BEWERKEN — op basis van uid
// ============================================================

async function openEditPlayer(uid) {
  try {
    // Laad direct uit spelers/{uid}
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Speler niet gevonden'); return; }
    const profiel = snap.data();

    document.getElementById('edit-player-id').value   = uid;    // slaat uid op, niet numeric id
    document.getElementById('edit-player-name').value = profiel.naam || '';
    document.getElementById('edit-player-hcp').value  = profiel.hcp != null ? Math.round(profiel.hcp) : '';

    const rolEl   = document.getElementById('edit-player-rol');
    const emailEl = document.getElementById('edit-player-email-info');
    if (rolEl)   rolEl.value       = profiel.rol   || 'speler';
    if (emailEl) emailEl.textContent = profiel.email ? `📧 ${profiel.email}` : 'Geen email';

    document.getElementById('modal-edit-player').classList.add('open');
  } catch(e) { console.error('openEditPlayer mislukt:', e); toast('Fout bij laden speler'); }
}

async function saveEditPlayer() {
  const uid  = document.getElementById('edit-player-id').value;   // uid (string)
  const naam = document.getElementById('edit-player-name').value.trim();
  const hcp  = Math.round(parseFloat(document.getElementById('edit-player-hcp').value));
  const rol  = document.getElementById('edit-player-rol')?.value || 'speler';

  if (!uid)       { toast('Geen speler geselecteerd'); return; }
  if (!naam)      { toast('Voer een naam in'); return; }
  if (isNaN(hcp)) { toast('Voer een handicap in'); return; }

  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Speler niet gevonden in spelers/ collectie'); return; }

    // Schrijf naar spelers/{uid} — enige bron voor naam/hcp/rol
    await setDoc(doc(db, 'spelers', uid), { ...snap.data(), naam, hcp, rol });

    // Sync hcp naar standen/{uid} in alle ladders waar speler in zit
    for (const ladder of alleLadders) {
      if (!(ladder.spelerIds || []).includes(uid)) continue;
      try {
        const standenRef  = doc(db, 'ladders', ladder.id, 'standen', uid);
        const standenSnap = await getDoc(standenRef);
        if (standenSnap.exists()) {
          await setDoc(standenRef, { ...standenSnap.data(), hcp });
        }
      } catch(e) { console.warn('hcp sync standen/', ladder.id, 'mislukt:', e.code); }
    }

    closeModal('modal-edit-player');
    renderAdmin();
    toast('Speler bijgewerkt ✓');
  } catch(e) { console.error('saveEditPlayer mislukt:', e); toast('Fout bij opslaan: ' + e.message); }
}

// ============================================================
//  SPELER VERWIJDEREN — op basis van uid
// ============================================================

async function removePlayer(uid) {
  try {
    // Laad naam voor bevestigingsdialog
    const snap = await getDoc(doc(db, 'spelers', uid));
    const naam = snap.exists() ? snap.data().naam : uid;

    if (!confirm(`${naam} verwijderen uit alle ladders?\n\nHet Firebase inlogaccount moet je nog handmatig verwijderen in de Firebase Console.`)) return;

    // 1. Verwijder spelers/{uid}
    await deleteDoc(doc(db, 'spelers', uid));

    // v3.0.0-9c: stap 2 (legacy ladder/spelers master lijst) verwijderd.
    // spelers/ listener werkt alleSpelersData automatisch bij na de deleteDoc hierboven.

    // 3. Verwijder uit alle ladders
    for (const ladder of alleLadders) {
      const ladderSnap = await getDoc(doc(db, 'ladders', ladder.id));
      if (!ladderSnap.exists()) continue;
      const data = ladderSnap.data();

      if (!(data.spelerIds || []).includes(uid)) continue;

      const nieuweSpelerIds    = (data.spelerIds       || []).filter(id => id !== uid);
      const nieuweActievePartijen = (data.actievePartijen || []).filter(p =>
        !p.spelers?.some(s => s.uid === uid)
      );
      await setDoc(doc(db, 'ladders', ladder.id), {
        spelerIds: nieuweSpelerIds,
        actievePartijen: nieuweActievePartijen,
      }, { merge: true });

      // Verwijder standen/{uid}
      try { await deleteDoc(doc(db, 'ladders', ladder.id, 'standen', uid)); } catch(e) {}

      ladder.spelerIds = nieuweSpelerIds;
    }

    renderAdmin();
    renderLadder();
    toast(`${naam} verwijderd ✓ — verwijder het Firebase inlogaccount nog handmatig`);
  } catch(e) { console.error('removePlayer mislukt:', e); toast('Er is iets misgegaan'); }
}

// ============================================================
//  PROFIEL
// ============================================================

function renderProfiel() {
  if (!huidigeBruiker) return;

  // v3.0.0-9c: uid-gebaseerde speler lookup via view-laag
  const uid = huidigeBruiker.uid;
  // Zoek spelerprofiel via view-laag (standen/{uid})
  const speler = uid
    ? alleLadders.flatMap(l => getLadderSpelers(l.id)).find(s => s.uid === uid)
    : null;

  document.getElementById('profiel-info').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:4px">
      <div style="width:52px;height:52px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:24px;color:var(--gold-light)">
        ${esc((huidigeBruiker.gebruikersnaam || '')[0]?.toUpperCase() || '?')}
      </div>
      <div>
        <div style="font-weight:600;font-size:17px">${esc(huidigeBruiker.gebruikersnaam)}</div>
        <div style="font-size:13px;color:var(--light)">${esc(huidigeBruiker.email)}</div>
        <span class="badge ${huidigeBruiker.rol === 'beheerder' ? 'badge-gold' : huidigeBruiker.rol === 'coordinator' ? 'badge-green' : 'badge-grey'}" style="margin-top:4px">${esc(huidigeBruiker.rol)}</span>
      </div>
    </div>`;

  if (!speler) {
    document.getElementById('profiel-stats').innerHTML =
      '<p style="color:var(--light);font-size:13px">Nog geen spelersprofiel gekoppeld aan dit account.</p>';
    return;
  }

  const ladderStats = alleLadders.map(l => {
    // v3.0.0-9c: uid-match via view-laag (valt terug op legacy l.spelers via view)
    const sp = getLadderSpelers(l.id).find(s => s.uid === uid);
    if (!sp) return null;
    const winpct  = sp.partijen > 0 ? Math.round(sp.gewonnen / sp.partijen * 100) : 0;
    const verloren = (sp.partijen || 0) - (sp.gewonnen || 0);
    return { ladder: l, sp, winpct, verloren };
  }).filter(Boolean);

  const totaalPartijen = ladderStats.reduce((s, l) => s + (l.sp.partijen || 0), 0);
  const totaalGewonnen = ladderStats.reduce((s, l) => s + (l.sp.gewonnen || 0), 0);
  const totaalPct      = totaalPartijen > 0 ? Math.round(totaalGewonnen / totaalPartijen * 100) : 0;
  const totaalVerloren = totaalPartijen - totaalGewonnen;

  let html = '';
  ladderStats.forEach(({ ladder, sp, winpct, verloren }) => {
    html += `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${esc(ladder.naam)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <div style="text-align:center;background:var(--green-pale);border-radius:10px;padding:10px">
          <div style="font-family:'Bebas Neue';font-size:28px;color:var(--green)">${sp.rank}</div>
          <div style="font-size:10px;color:var(--light);text-transform:uppercase">Ranking</div>
        </div>
        <div style="text-align:center;background:#fef3cd;border-radius:10px;padding:10px">
          <div style="font-family:'Bebas Neue';font-size:28px;color:var(--gold)">${winpct}%</div>
          <div style="font-size:10px;color:var(--light);text-transform:uppercase">Winpct</div>
        </div>
        <div style="text-align:center;background:#f0ede4;border-radius:10px;padding:10px">
          <div style="font-family:'Bebas Neue';font-size:28px;color:var(--mid)">${sp.partijen || 0}</div>
          <div style="font-size:10px;color:var(--light);text-transform:uppercase">Gespeeld</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--mid)">✓ ${sp.gewonnen || 0} gewonnen &nbsp; ✗ ${verloren} verloren &nbsp; 🏒 hcp ${Math.round(sp.hcp)}</div>
    </div>`;
  });

  if (ladderStats.length > 1) {
    html += `
    <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
      <div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Totaal</div>
      <div style="font-size:13px;color:var(--mid)">✓ ${totaalGewonnen} gewonnen &nbsp; ✗ ${totaalVerloren} verloren &nbsp; ${totaalPct}% winpercentage</div>
    </div>`;
  }
  if (ladderStats.length === 0) {
    html = '<p style="color:var(--light);font-size:13px">Niet ingedeeld in een ladder.</p>';
  }

  document.getElementById('profiel-stats').innerHTML = html;

  const mijnUitdagingen = uitdagingenData.filter(u =>
    u.vanEmail === huidigeBruiker.email || u.naarEmail === huidigeBruiker.email
  );
  const openOntvangen = mijnUitdagingen.filter(u => u.naarEmail === huidigeBruiker.email && u.status === 'open');
  const openVerstuurd = mijnUitdagingen.filter(u => u.vanEmail  === huidigeBruiker.email && u.status === 'open');

  if (mijnUitdagingen.length > 0) {
    let uitdHtml = '<div style="margin-top:16px;padding-top:16px;border-top:1px solid #f0ede4">';
    uitdHtml += '<div style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:10px">Uitdagingen</div>';
    openOntvangen.forEach(u => {
      uitdHtml += `<div style="background:#fef3cd;border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="font-weight:600;margin-bottom:6px">⚔️ ${esc(u.vanNaam)} daagt je uit!</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" onclick="reageerUitdaging('${escAttr(u.id)}',true)">✓ Accepteer</button>
          <button class="btn btn-sm btn-ghost" onclick="reageerUitdaging('${escAttr(u.id)}',false)" style="color:var(--red)">✗ Weiger</button>
        </div>
      </div>`;
    });
    openVerstuurd.forEach(u => {
      uitdHtml += `<div style="background:#f0ede4;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px">⏳ Wacht op <strong>${esc(u.naarNaam)}</strong></div>
        <button onclick="verwijderUitdaging('${escAttr(u.id)}')" style="background:none;border:none;color:var(--light);cursor:pointer;font-size:18px">✕</button>
      </div>`;
    });
    const afgerond = mijnUitdagingen.filter(u => u.status !== 'open');
    afgerond.slice(0, 3).forEach(u => {
      const isVan  = u.vanEmail === huidigeBruiker.email;
      const ander  = isVan ? u.naarNaam : u.vanNaam;
      const icoon  = u.status === 'geaccepteerd' ? '✅' : '❌';
      uitdHtml += `<div style="font-size:12px;color:var(--light);padding:4px 0">${icoon} ${isVan ? 'Uitdaging aan' : 'Uitdaging van'} ${esc(ander)} — ${esc(u.status)}</div>`;
    });
    uitdHtml += '</div>';
    document.getElementById('profiel-stats').innerHTML += uitdHtml;
  }

  const hcpInput = document.getElementById('profiel-hcp-input');
  if (hcpInput && speler) hcpInput.value = Math.round(speler.hcp);
}

async function slaProfielHcpOp() {
  try {
    const val = parseFloat(document.getElementById('profiel-hcp-input').value);
    if (isNaN(val)) { toast('Voer een geldige handicap in'); return; }
    if (!huidigeBruiker.uid) { toast('Niet ingelogd'); return; }

    // Schrijf naar spelers/{uid} — enige bron voor hcp
    const spelersSnap = await getDoc(doc(db, 'spelers', huidigeBruiker.uid));
    if (!spelersSnap.exists()) { toast('Spelersprofiel niet gevonden'); return; }
    await setDoc(doc(db, 'spelers', huidigeBruiker.uid), { ...spelersSnap.data(), hcp: val });

    // Sync hcp naar standen/{uid} in alle ladders waar speler in zit
    for (const ladder of alleLadders) {
      if (!(ladder.spelerIds || []).includes(huidigeBruiker.uid)) continue;
      try {
        const standenRef  = doc(db, 'ladders', ladder.id, 'standen', huidigeBruiker.uid);
        const standenSnap = await getDoc(standenRef);
        if (standenSnap.exists()) {
          await setDoc(standenRef, { ...standenSnap.data(), hcp: val });
        }
      } catch(e) { console.warn('hcp sync standen/', ladder.id, 'mislukt:', e.code); }
    }

    toast('Playing Handicap bijgewerkt ✓');
    renderProfiel();
  } catch(e) { console.error('slaProfielHcpOp mislukt:', e); }
}

// ============================================================
//  GEBRUIKERSBEHEER — nu uid-gebaseerd
// ============================================================

function sorteerUsers(users) {
  return [...users].sort((a, b) => {
    const naamA = (a.naam || a.gebruikersnaam || a.email || '').trim();
    const naamB = (b.naam || b.gebruikersnaam || b.email || '').trim();
    return naamA.split(' ').pop().localeCompare(naamB.split(' ').pop(), 'nl');
  });
}

async function renderAdminUsers() {
  const list = document.getElementById('admin-user-list');
  list.innerHTML = '<div style="padding:12px 16px;color:var(--light);font-size:13px">Laden…</div>';
  try {
    const users = await getUsers();
    if (users.length === 0) {
      list.innerHTML = '<div class="empty"><p>Nog geen accounts.</p></div>';
      return;
    }
    const gesorteerd = sorteerUsers(users);
    list.innerHTML = gesorteerd.map(u => {
      const naam = u.naam || u.gebruikersnaam || u.email?.split('@')[0] || '—';
      return `
      <div class="admin-row">
        <div style="flex:1">
          <div class="name">${esc(naam)}</div>
          <div style="font-size:11px;color:var(--light)">${esc(u.email || '')}</div>
        </div>
        <span class="badge ${u.rol === 'beheerder' ? 'badge-gold' : u.rol === 'coordinator' ? 'badge-green' : 'badge-grey'}">${esc(u.rol)}</span>
        <button class="btn btn-sm btn-ghost" onclick="openEditUser('${escAttr(u.uid)}')">✏️</button>
        <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removeUser('${escAttr(u.uid)}')">✕</button>
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:13px">Fout bij laden</div>';
  }
}

async function openEditUser(uid) {
  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Account niet gevonden'); return; }
    const u = snap.data();
    document.getElementById('edit-user-name').value = u.naam || '';
    document.getElementById('edit-user-pass').value = '';
    document.getElementById('edit-user-rol').value  = u.rol || 'speler';
    document.getElementById('edit-user-idx').value  = uid;   // idx-veld hergebruikt voor uid
    document.getElementById('modal-edit-user').classList.add('open');
  } catch(e) { toast('Fout bij laden'); }
}

async function saveEditUser() {
  const uid  = document.getElementById('edit-user-idx').value;   // bevat uid
  const naam = document.getElementById('edit-user-name').value.trim();
  const pass = document.getElementById('edit-user-pass').value;
  const rol  = document.getElementById('edit-user-rol').value;

  if (!naam)                   { toast('Voer een naam in'); return; }
  if (pass && pass.length < 6) { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Account niet gevonden'); return; }
    await setDoc(doc(db, 'spelers', uid), { ...snap.data(), naam, rol });
    closeModal('modal-edit-user');
    renderAdmin();
    toast('Account bijgewerkt ✓');
  } catch(e) { toast('Fout bij opslaan'); }
}

function openAddUser() {
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-pass').value = '';
  document.getElementById('new-user-rol').value  = 'speler';
  renderLadderCheckboxes('new-user-ladders');
  document.getElementById('modal-add-user').classList.add('open');
}

async function saveNewUser() {
  const email = document.getElementById('new-user-name').value.trim().toLowerCase();
  const pass  = document.getElementById('new-user-pass').value;
  const rol   = document.getElementById('new-user-rol').value;

  if (!email || !email.includes('@')) { toast('Voer een geldig e-mailadres in'); return; }
  if (pass.length < 6)               { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    const { initializeApp: init2, deleteApp: del2 } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser2 } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const tijdApp  = init2(firebaseConfig, `tmp_user_${Date.now()}`);
    const tijdAuth = getAuth2(tijdApp);

    let uid;
    try {
      const cred = await createUser2(tijdAuth, email, pass);
      uid = cred.user.uid;
      try { await del2(tijdApp); } catch(e) {}
    } catch(authErr) {
      try { await del2(tijdApp); } catch(e) {}
      if (authErr.code === 'auth/email-already-in-use') { toast('Dit e-mailadres is al in gebruik'); return; }
      if (authErr.code === 'auth/invalid-email')         { toast('Ongeldig e-mailadres'); return; }
      toast('Fout bij aanmaken: ' + authErr.message); return;
    }

    const naam = email.split('@')[0].replace(/[^a-z0-9 ]/g, '');

    // Schrijf naar spelers/{uid}
    await setDoc(doc(db, 'spelers', uid), { uid, naam, email, rol, hcp: 0 });

    // Voeg toe aan ladders als dat gewenst is
    const geselecteerdeLadders = getGeselecteerdeLadders('new-user-ladders');
    if (geselecteerdeLadders.length > 0) {
      await voegSpelerToeAanLadders(geselecteerdeLadders, { naam, hcp: 0 }, uid);
    }

    closeModal('modal-add-user');
    renderAdmin();
    toast('Account aangemaakt ✓');
  } catch(e) { toast('Fout bij opslaan: ' + e.message); }
}

async function removeUser(uid) {
  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    const naam = snap.exists() ? snap.data().naam : uid;

    if (!confirm(`Account van ${naam} verwijderen? De speler wordt ook uit alle ladders verwijderd.`)) return;

    // Verwijder spelers/{uid}
    await deleteDoc(doc(db, 'spelers', uid));

    // Verwijder uit alle ladders op uid
    for (const ladder of alleLadders) {
      if (!(ladder.spelerIds || []).includes(uid)) continue;
      const nieuweSpelerIds = (ladder.spelerIds || []).filter(id => id !== uid);
      await setDoc(doc(db, 'ladders', ladder.id), { spelerIds: nieuweSpelerIds }, { merge: true });
      try { await deleteDoc(doc(db, 'ladders', ladder.id, 'standen', uid)); } catch(e) {}
      ladder.spelerIds = nieuweSpelerIds;
    }

    renderAdmin();
    renderLadder();
    toast('Account en speler verwijderd ✓');
  } catch(e) { console.error(e); toast('Fout bij verwijderen: ' + e.message); }
}

// ============================================================
//  HELPERS
// ============================================================

async function verschuifRank(uid, delta) {
  try {
    if (!activeLadderId) return;
    // Lees huidige standen uit standen/{uid}
    const standenSnap = await getDocs(collection(db, 'ladders', activeLadderId, 'standen'));
    const standen = standenSnap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (a.rank || 0) - (b.rank || 0));

    const idx = standen.findIndex(s => s.uid === uid);
    if (idx === -1) return;
    const nieuwIdx = idx + delta;
    if (nieuwIdx < 0 || nieuwIdx >= standen.length) return;

    // Wissel de twee ranks
    const oudeRank  = standen[idx].rank;
    const nieuweRank = standen[nieuwIdx].rank;
    await Promise.all([
      setDoc(doc(db, 'ladders', activeLadderId, 'standen', standen[idx].uid),
        { ...standen[idx], rank: nieuweRank }),
      setDoc(doc(db, 'ladders', activeLadderId, 'standen', standen[nieuwIdx].uid),
        { ...standen[nieuwIdx], rank: oudeRank }),
    ]);
    renderAdmin();
  } catch(e) { console.error('verschuifRank mislukt:', e); }
}

function resetData() { toast('Reset is momenteel uitgeschakeld'); }

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) o.classList.remove('open');
  });
});



// ============================================================
//  INITIEEL WACHTWOORD BEHEER — v3.0.0-11.60
// ============================================================
// Toon/verberg het invoerveld om het initiële wachtwoord te wijzigen.
function toggleWachtwoordBeheer() {
  const el = document.getElementById('admin-wachtwoord-wrap');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
  if (!open) {
    const inp = document.getElementById('admin-nieuw-wachtwoord');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

// Sla het nieuwe initiële wachtwoord op in Firestore (ladder/config).
async function slaInitieelWachtwoordOp() {
  const inp = document.getElementById('admin-nieuw-wachtwoord');
  if (!inp) return;
  const nieuw = inp.value.trim();
  if (nieuw.length < 4) { toast('Wachtwoord moet minimaal 4 tekens zijn'); return; }

  try {
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await setDoc(doc(db, 'ladder', 'config'), { initieelWachtwoord: nieuw }, { merge: true });
    store.initieelWachtwoord = nieuw;
    inp.value = '';
    document.getElementById('admin-wachtwoord-wrap').style.display = 'none';
    toast('Initieel wachtwoord bijgewerkt ✓');
  } catch(e) {
    console.error('slaInitieelWachtwoordOp mislukt:', e);
    toast('Opslaan mislukt: ' + (e.message || e.code));
  }
}

// ============================================================
//  EXPORTS
// ============================================================
export {
  renderAdmin, renderAdminSpelersEnAccounts,
  openAddPlayer, toggleHandmatigToevoegen, voegAccountToeAlsSpeler,
  saveNewPlayer, openEditPlayer, saveEditPlayer, removePlayer,
  renderProfiel, slaProfielHcpOp,
  sorteerUsers, renderAdminUsers, openEditUser, saveEditUser,
  openAddUser, saveNewUser, removeUser,
  verschuifRank, resetData, closeModal,
  kopieerCredentials, vraagResetWachtwoord,
  toggleWachtwoordBeheer, slaInitieelWachtwoordOp,
};
