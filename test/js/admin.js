// ============================================================
//  admin.js — v3.0.0 — uid-architectuur volledig
//  Primaire identifier: uid (Firebase Auth uid)
//  Bron van waarheid:   spelers/{uid} (profiel), standen/{uid} (ranking)
// ============================================================
import { db, auth, firebaseConfig, IS_TEST, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL,
  SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC,
  INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr,
  EMAIL_SUFFIX, DEFAULT_HCP,
  genereerEmail, loginNaamVan, pasUiStijlToe,
  functions, httpsCallable } from './config.js';
// v5.2.1: ruimt een Auth-account op waarvan het profiel niet kon worden
// aangemaakt tijdens de bulk-import (voorkomt accounts zonder profiel).
const _verwijderWeesAccountFn = httpsCallable(functions, 'verwijderWeesAccount');
import { store, alleLadders, activeLadderId,
  huidigeBruiker, uitdagingenData } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers,
  isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen,
  normaliseerLadderRangen, ladderIntegriteitsRapport, herstelLadderIntegriteit } from './auth.js';

// v3.0.0-11.103: gebruikersbeheer (aanmaken/verwijderen/wachtwoord-reset) loopt
// via de gedeelde Firebase Auth — die is voor test én productie hetzelfde project.
// In de testomgeving blokkeren we deze acties zodat je niet per ongeluk echte
// accounts aanmaakt of wachtwoorden reset vanuit test.
function _blokkeerInTest(actie) {
  if (IS_TEST) {
    toast(`${actie} is uitgeschakeld in de testomgeving — dit zou de live database raken.`);
    return true;
  }
  return false;
}
import { openNieuweLadderModal, renderAdminLadders } from './beheer.js';
import { reageerUitdaging, verwijderUitdaging } from './archief.js';
import { renderLadder } from './ladder.js';
import { getLadderSpelers } from './ladder-view.js';
// v5.0.0 (punt 3): syncStandenNaBevestigUitslag is verwijderd — standen
// worden uitsluitend nog server-side geschreven (Cloud Functions).
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc,
  deleteDoc, getDocs, addDoc, query, where, orderBy, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initApp } from './auth.js';

// ============================================================
//  ADMIN — HOOFD RENDER
// ============================================================

function renderAdmin() {
  const isBeheerder = isBeheerderRol();
  const isCoord     = isCoordinatorRol();

  ['admin-sectie-spelers','admin-sectie-seizoen','admin-sectie-wachtwoord','admin-sectie-uistijl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isBeheerder ? '' : 'none';
  });
  if (isBeheerder) renderUiStijlKaart();
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
    // Als eersteLogin=true → wachtwoord is nog steeds het initiële wachtwoord
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

      // v3.0.0-11.105: spelerIds + standen in één atomaire batch, daarna normaliseren.
      spelerIds.push(uid);
      const batch = writeBatch(db);
      batch.set(doc(db, 'ladders', ladderId), { spelerIds }, { merge: true });
      batch.set(doc(db, 'ladders', ladderId, 'standen', uid),
        { rank: 9000, partijen: 0, gewonnen: 0 }); // voorlopige rang; normalisatie zet 'm achteraan
      await batch.commit();
      await normaliseerLadderRangen(ladderId);

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
  if (_blokkeerInTest('Speler aanmaken')) return;
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
  if (_blokkeerInTest('Wachtwoord resetten')) return;
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
      // Gebruik het wachtwoord dat de Cloud Function daadwerkelijk heeft ingesteld —
      // niet store.initieelWachtwoord, dat mogelijk verouderd is als een andere beheerder
      // het wachtwoord in de tussentijd heeft gewijzigd.
      // v3.0.0-11.111: fallback-keten zodat nooit 'null' getoond wordt. Als de
      // (mogelijk oudere) gedeployede Cloud Function geen nieuwWachtwoord teruggeeft
      // én store.initieelWachtwoord leeg is, lees dan ladder/config vers uit Firestore.
      // De Cloud Function zet het wachtwoord op exact díe waarde, dus dit klopt altijd.
      let gebruiktWachtwoord = result.data.nieuwWachtwoord || store.initieelWachtwoord;
      if (!gebruiktWachtwoord) {
        try {
          const cfgSnap = await getDoc(doc(db, 'ladder', 'config'));
          const cfgPass = cfgSnap.exists() ? cfgSnap.data().initieelWachtwoord : null;
          if (typeof cfgPass === 'string' && cfgPass.length > 0) {
            gebruiktWachtwoord = cfgPass;
            store.initieelWachtwoord = cfgPass; // lokale state alsnog bijwerken
          }
        } catch(cfgErr) {
          console.warn('ladder/config vers lezen mislukt:', cfgErr.code || cfgErr.message);
        }
      }
      const loginTxt = loginNaamVan((await getDoc(doc(db, 'spelers', uid))).data()?.email || '');
      if (!gebruiktWachtwoord) {
        toast('Wachtwoord gereset, maar kon het wachtwoord niet ophalen — controleer ladder/config');
      }
      toonCredentialsModal(naam, loginTxt, gebruiktWachtwoord || '—');
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
      // v3.0.0-11.105: spelerIds-update + standen-delete in één atomaire batch.
      const batch = writeBatch(db);
      batch.set(doc(db, 'ladders', ladder.id), {
        spelerIds: nieuweSpelerIds,
        actievePartijen: nieuweActievePartijen,
      }, { merge: true });
      batch.delete(doc(db, 'ladders', ladder.id, 'standen', uid));
      await batch.commit();
      await normaliseerLadderRangen(ladder.id);

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
  if (_blokkeerInTest('Gebruiker aanmaken')) return;
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
      // v3.0.0-11.105: spelerIds-update + standen-delete atomair, daarna normaliseren.
      const batch = writeBatch(db);
      batch.set(doc(db, 'ladders', ladder.id), { spelerIds: nieuweSpelerIds }, { merge: true });
      batch.delete(doc(db, 'ladders', ladder.id, 'standen', uid));
      await batch.commit();
      await normaliseerLadderRangen(ladder.id);
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
//  INITIEEL WACHTWOORD BEHEER — v3.0.0-11.63
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
//  UI-STIJL BEHEER — v4.1.0
// ============================================================
// Globale weergavestijl van de app ('club' = huidige stijl, 'matchcheck' =
// MatchCheck-stijl). Geldt voor alle gebruikers; alleen de beheerder mag dit
// wijzigen. Verandert uitsluitend het uiterlijk (kleuren/typografie/randen) —
// de opbouw en werking van elk scherm blijven ongewijzigd.
function renderUiStijlKaart() {
  const huidige = store.uiStijl || 'club';
  document.querySelectorAll('#uistijl-keuze .uistijl-optie').forEach(btn => {
    btn.classList.toggle('uistijl-actief', btn.getAttribute('data-stijl') === huidige);
  });
}

async function kiesUiStijl(waarde) {
  if (waarde !== 'club' && waarde !== 'matchcheck') return;
  try {
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await setDoc(doc(db, 'ladder', 'config'), { uiStijl: waarde }, { merge: true });
    store.uiStijl = waarde;
    pasUiStijlToe(waarde);
    renderUiStijlKaart();
    toast(waarde === 'matchcheck' ? 'MatchCheck-stijl actief voor iedereen ✓' : 'Standaardstijl actief voor iedereen ✓');
  } catch(e) {
    console.error('kiesUiStijl mislukt:', e);
    toast('Opslaan mislukt: ' + (e.message || e.code));
  }
}


// ============================================================
//  BULK IMPORT TOERNOOI-SPELERS — v3.0.0-11.67
// ============================================================

function openBulkImport() {
  document.getElementById('bulk-toernooi-naam').value = '';
  document.getElementById('bulk-import-voortgang').style.display = 'none';
  document.getElementById('bulk-import-resultaat').style.display = 'none';
  document.getElementById('bulk-import-start-btn').style.display = '';

  const laddersEl = document.getElementById('bulk-import-ladders');
  if (laddersEl) {
    laddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" value="${escAttr(l.id)}" style="accent-color:var(--green);width:16px;height:16px">
        <span>${esc(l.naam)}</span>
      </label>
    `).join('');
  }

  const tbody = document.getElementById('bulk-import-rijen');
  tbody.innerHTML = '';
  for (let i = 0; i < 5; i++) _voegBulkRijAanToe(tbody);

  document.getElementById('modal-bulk-import').classList.add('open');
  tbody.addEventListener('paste', _handleBulkPaste);
}

function sluitBulkImport() {
  const tbody = document.getElementById('bulk-import-rijen');
  if (tbody) tbody.removeEventListener('paste', _handleBulkPaste);
  document.getElementById('modal-bulk-import').classList.remove('open');
}

function _voegBulkRijAanToe(tbody) {
  const nr = tbody.querySelectorAll('tr').length + 1;
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `
    <td style="padding:6px 10px;color:var(--light);font-size:12px;width:28px">${nr}</td>
    <td style="padding:4px 6px"><input type="text" placeholder="Jan" autocomplete="off"
      style="width:100%;border:1.5px solid var(--border);border-radius:6px;padding:5px 8px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--input-bg);color:var(--dark)"
      data-col="voornaam"></td>
    <td style="padding:4px 6px"><input type="text" placeholder="de Vries" autocomplete="off"
      style="width:100%;border:1.5px solid var(--border);border-radius:6px;padding:5px 8px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--input-bg);color:var(--dark)"
      data-col="achternaam"></td>
    <td style="padding:4px 6px;width:70px"><input type="number" placeholder="10" min="-10" max="54" inputmode="numeric"
      style="width:100%;border:1.5px solid var(--border);border-radius:6px;padding:5px 8px;font-size:13px;text-align:center;font-family:'DM Mono',monospace;background:var(--input-bg);color:var(--dark)"
      data-col="hcp"></td>
    <td style="padding:4px 6px;width:28px">
      <button onclick="this.closest('tr').remove();_herNummerBulkRijen()" title="Verwijder"
        style="background:none;border:none;color:var(--light);cursor:pointer;font-size:16px;padding:0;line-height:1">×</button>
    </td>
  `;
  tbody.appendChild(tr);
}

window._herNummerBulkRijen = function _herNummerBulkRijen() {
  const tbody = document.getElementById('bulk-import-rijen');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach((tr, i) => {
    const nrTd = tr.querySelector('td:first-child');
    if (nrTd) nrTd.textContent = i + 1;
  });
};

function voegBulkRijToe() {
  const tbody = document.getElementById('bulk-import-rijen');
  if (tbody) { _voegBulkRijAanToe(tbody); _herNummerBulkRijen(); }
}

function _handleBulkPaste(e) {
  const active = document.activeElement;
  if (!active || !active.closest('#bulk-import-rijen')) return;
  const tekst = e.clipboardData?.getData('text') || '';
  if (!tekst.includes('\t') && !tekst.includes('\n')) return;
  e.preventDefault();

  const tbody = document.getElementById('bulk-import-rijen');
  const regels = tekst.trim().split(/\r?\n/).filter(r => r.trim());
  const startRij = active.closest('tr');
  const rijen = Array.from(tbody.querySelectorAll('tr'));
  let rijIdx = rijen.indexOf(startRij);
  if (rijIdx < 0) rijIdx = 0;

  regels.forEach((regel, i) => {
    const cellen = regel.split('\t');
    const voornaam   = (cellen[0] || '').trim();
    const achternaam = (cellen[1] || '').trim();
    const hcp        = (cellen[2] || '').trim();

    while (tbody.querySelectorAll('tr').length <= rijIdx + i) {
      _voegBulkRijAanToe(tbody);
    }
    const tr = tbody.querySelectorAll('tr')[rijIdx + i];
    if (!tr) return;
    const fnEl = tr.querySelector('[data-col="voornaam"]');
    const anEl = tr.querySelector('[data-col="achternaam"]');
    const hcEl = tr.querySelector('[data-col="hcp"]');
    if (fnEl) fnEl.value = voornaam;
    if (anEl) anEl.value = achternaam;
    if (hcEl && hcp !== '') hcEl.value = hcp;
  });
  _herNummerBulkRijen();
}

async function startBulkImport() {
  if (_blokkeerInTest('Bulk-import van spelers')) return;
  const toernooiNaam = document.getElementById('bulk-toernooi-naam').value.trim();
  if (!toernooiNaam) { toast('Voer een toernooijnaam in'); return; }

  const geselecteerdeLadders = Array.from(
    document.querySelectorAll('#bulk-import-ladders input[type=checkbox]:checked')
  ).map(cb => cb.value);

  const tbody = document.getElementById('bulk-import-rijen');
  const rijen = Array.from(tbody.querySelectorAll('tr')).map(tr => ({
    voornaam:   tr.querySelector('[data-col="voornaam"]')?.value.trim() || '',
    achternaam: tr.querySelector('[data-col="achternaam"]')?.value.trim() || '',
    hcp:        parseFloat(tr.querySelector('[data-col="hcp"]')?.value) || 0,
    tr
  })).filter(r => r.voornaam && r.achternaam);

  if (rijen.length === 0) { toast('Voer minimaal één speler in'); return; }

  // UI: start-knop weg, sluiten geblokkeerd, voortgang zichtbaar
  document.getElementById('bulk-import-start-btn').style.display = 'none';
  document.getElementById('bulk-import-sluit-btn').disabled = true;
  document.getElementById('bulk-import-sluit-btn').style.opacity = '0.4';
  document.getElementById('bulk-import-voortgang').style.display = '';
  document.getElementById('bulk-import-resultaat').style.display = 'none';
  document.getElementById('bulk-import-balk').style.width = '0%';
  document.getElementById('bulk-import-teller').textContent = '0 / ' + rijen.length + ' verwerkt';

  const pass = store.initieelWachtwoord;
  if (!pass) {
    toast('Initieel wachtwoord niet geladen — stel dit in via het beheerscherm');
    document.getElementById('bulk-import-start-btn').style.display = '';
    document.getElementById('bulk-import-sluit-btn').disabled = false;
    document.getElementById('bulk-import-sluit-btn').style.opacity = '';
    document.getElementById('bulk-import-voortgang').style.display = 'none';
    return;
  }

  const credentials = [];
  const mislukt = [];
  let succes = 0;
  const startTijd = Date.now();

  // v5.2.1: eenmalig de bestaande e-mailadressen ophalen (zie duplicaatcheck
  // in de lus). Nieuw aangemaakte spelers worden er hieronder aan toegevoegd,
  // zodat een dubbele naam binnen dezelfde import ook wordt opgemerkt.
  let _bekendeEmails;
  try {
    const bestaandeUsers = await getUsers(true);
    _bekendeEmails = new Set((bestaandeUsers || []).map(u => String(u.email || '').toLowerCase()));
  } catch (e) {
    console.error('Spelerslijst ophalen mislukt:', e);
    toast('Kon de bestaande spelers niet ophalen — import afgebroken');
    document.getElementById('bulk-import-start-btn').style.display = '';
    document.getElementById('bulk-import-sluit-btn').disabled = false;
    document.getElementById('bulk-import-sluit-btn').style.opacity = '';
    document.getElementById('bulk-import-voortgang').style.display = 'none';
    return;
  }

  // Laad imports eenmalig buiten de loop
  let init2, deleteApp, getAuth2, createUser;
  try {
    const appMod  = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    init2      = appMod.initializeApp;
    deleteApp  = appMod.deleteApp;
    getAuth2   = authMod.getAuth;
    createUser = authMod.createUserWithEmailAndPassword;
  } catch(e) {
    toast('Firebase modules laden mislukt: ' + e.message);
    document.getElementById('bulk-import-start-btn').style.display = '';
    document.getElementById('bulk-import-sluit-btn').disabled = false;
    document.getElementById('bulk-import-sluit-btn').style.opacity = '';
    return;
  }

  const setStatus = (tekst) => {
    document.getElementById('bulk-import-status').textContent = tekst;
  };
  const setTijd = () => {
    const secs = Math.round((Date.now() - startTijd) / 1000);
    const min  = Math.floor(secs / 60);
    const sec  = secs % 60;
    document.getElementById('bulk-import-tijd').textContent =
      min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  };
  const tijdInterval = setInterval(setTijd, 1000);

  const markeerRij = (tr, ok, tekst) => {
    tr.style.background = ok ? 'var(--green-pale)' : '#fde8e8';
    const nrTd = tr.querySelector('td:first-child');
    if (nrTd) nrTd.textContent = ok ? '✓' : '✗';
    if (!ok && tekst) {
      // Verwijder eventuele eerdere foutmelding
      tr.querySelectorAll('.bulk-err').forEach(el => el.remove());
      const errSpan = document.createElement('span');
      errSpan.className = 'bulk-err';
      errSpan.style.cssText = 'font-size:11px;color:var(--red);display:block;padding:2px 6px';
      errSpan.textContent = tekst;
      const td = tr.querySelector('td:nth-child(3)');
      if (td) td.appendChild(errSpan);
    }
  };

  for (let i = 0; i < rijen.length; i++) {
    const { voornaam, achternaam, hcp, tr } = rijen[i];
    const naam     = voornaam + ' ' + achternaam;
    const email    = genereerEmail(voornaam, achternaam);
    const loginTxt = loginNaamVan(email);

    // Voortgang bijwerken
    const pct = Math.round((i / rijen.length) * 100);
    document.getElementById('bulk-import-balk').style.width = pct + '%';
    document.getElementById('bulk-import-teller').textContent =
      i + ' / ' + rijen.length + ' verwerkt';
    setStatus('Bezig met ' + (i + 1) + ' van ' + rijen.length + ': ' + naam + '\u2026');

    // Markeer rij als actief
    tr.style.background = '#fff9e6';
    const nrTd = tr.querySelector('td:first-child');
    if (nrTd) nrTd.textContent = '\u23f3';

    try {
      // Check duplicaat — v5.2.1: de lijst wordt nog EENMAAL vers opgehaald,
      // vóór de lus, en daarna lokaal bijgehouden. Voorheen deed elke ronde
      // een volledige verse read van het users-document; bij vijftig spelers
      // waren dat vijftig onnodige leesacties.
      if (_bekendeEmails.has(email.toLowerCase())) {
        markeerRij(tr, false, 'Naam al in gebruik — overgeslagen');
        mislukt.push(naam + ' (naam al in gebruik)');
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // Maak Auth-account — met retry bij rate limiting
      let uid = null;
      let authPogingen = 0;
      while (uid === null && authPogingen < 3) {
        authPogingen++;
        let tijdApp = null;
        try {
          tijdApp = init2(firebaseConfig, 'bulk_' + Date.now() + '_' + i + '_' + authPogingen);
          const tijdAuth = getAuth2(tijdApp);
          const cred = await createUser(tijdAuth, email, pass);
          uid = cred.user.uid;
        } catch(authErr) {
          if (tijdApp) { try { await deleteApp(tijdApp); } catch(e) {} }
          if (authErr.code === 'auth/email-already-in-use') {
            markeerRij(tr, false, 'Account bestaat al in Firebase Auth');
            mislukt.push(naam + ' (account bestaat al)');
            uid = null;
            break;
          } else if (authErr.code === 'auth/too-many-requests' || authErr.message?.includes('QUOTA')) {
            if (authPogingen < 3) {
              setStatus('Rate limit bereikt — even wachten (' + authPogingen + '/3)\u2026');
              await new Promise(r => setTimeout(r, 8000 * authPogingen));
            } else {
              markeerRij(tr, false, 'Rate limit — probeer later opnieuw');
              mislukt.push(naam + ' (rate limit)');
              uid = null;
            }
          } else {
            markeerRij(tr, false, authErr.message || 'Auth mislukt');
            mislukt.push(naam + ' (' + (authErr.code || authErr.message) + ')');
            uid = null;
            break;
          }
        }
        if (tijdApp && uid !== null) {
          try { await deleteApp(tijdApp); } catch(e) {}
        }
      }

      if (!uid) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // Schrijf spelers/{uid} — apart try/catch zodat een Auth-account nooit
      // zonder Firestore-profiel blijft (ghost account)
      try {
        await setDoc(doc(db, 'spelers', uid), {
          uid, naam, email, rol: 'speler', hcp: Math.round(hcp),
          eersteLogin: true,
          toernooiSpeler: true,
          toernooiNaam
        });
      } catch(fsErr) {
        // v5.2.1: het Auth-account wordt nu daadwerkelijk opgeruimd.
        // Voorheen bleef het staan met alleen een consoleregel "handmatig
        // verwijderen": een account dat kon inloggen maar geen profiel had.
        console.error('Firestore profiel mislukt voor', naam, fsErr);
        let opgeruimd = false;
        try {
          await _verwijderWeesAccountFn({ targetUid: uid, isTest: IS_TEST });
          opgeruimd = true;
        } catch (delErr) {
          console.error('Wees-account opruimen mislukt voor', email, delErr);
        }
        markeerRij(tr, false, opgeruimd
          ? 'Profiel opslaan mislukt — account verwijderd'
          : 'Profiel opslaan mislukt — verwijder ' + email + ' handmatig in Firebase Auth');
        mislukt.push(naam + (opgeruimd ? ' (Firestore mislukt, account opgeruimd)' : ' (Firestore mislukt, account blijft staan)'));
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // Toevoegen aan ladder(s)
      if (geselecteerdeLadders.length > 0) {
        try {
          await voegSpelerToeAanLadders(geselecteerdeLadders, { naam, hcp: Math.round(hcp) }, uid);
        } catch(ladderErr) {
          // Niet fataal — speler is aangemaakt, ladder-koppeling kan later
          console.warn('Ladder koppeling mislukt voor', naam, ladderErr);
        }
      }

      markeerRij(tr, true);
      _bekendeEmails.add(email.toLowerCase());
      credentials.push(naam.padEnd(25) + ' ' + loginTxt.padEnd(25) + ' ' + pass);
      succes++;

    } catch(e) {
      console.error('Onverwachte fout voor', naam, e);
      markeerRij(tr, false, e.message || 'Onbekende fout');
      mislukt.push(naam + ' (onbekende fout)');
    }

    // Verplichte pauze: 2 seconden per speler — voorkomt rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  clearInterval(tijdInterval);
  setTijd();

  // Afronden
  document.getElementById('bulk-import-balk').style.width = '100%';
  document.getElementById('bulk-import-teller').textContent =
    rijen.length + ' / ' + rijen.length + ' verwerkt';
  document.getElementById('bulk-import-spinner').style.borderTopColor = 'transparent';
  document.getElementById('bulk-import-spinner').style.animation = 'none';
  document.getElementById('bulk-import-spinner').style.borderColor = 'var(--green)';
  document.getElementById('bulk-import-spinner').textContent = '\u2713';
  document.getElementById('bulk-import-spinner').style.cssText =
    'width:18px;height:18px;display:flex;align-items:center;justify-content:center;' +
    'background:var(--green);color:white;border-radius:50%;font-size:12px;font-weight:700;flex-shrink:0';

  const allesOk = mislukt.length === 0;
  setStatus(
    allesOk
      ? '\u2713 Alle ' + succes + ' spelers aangemaakt!'
      : succes + ' van ' + rijen.length + ' aangemaakt — ' + mislukt.length + ' mislukt (zie rode rijen)'
  );

  // Sluitknop weer inschakelen
  document.getElementById('bulk-import-sluit-btn').disabled = false;
  document.getElementById('bulk-import-sluit-btn').style.opacity = '';

  // Resultaten tonen
  document.getElementById('bulk-import-resultaat').style.display = '';
  const samenvattingEl = document.getElementById('bulk-import-samenvatting');

  if (credentials.length > 0) {
    samenvattingEl.style.color = 'var(--green)';
    samenvattingEl.textContent = '\u2713 Aangemaakt — kopieer voor WhatsApp:';
    document.getElementById('bulk-import-credentials').value =
      'Toernooi: ' + toernooiNaam + '\n' +
      'Wachtwoord (tijdelijk): ' + pass + '\n\n' +
      credentials.join('\n') +
      (mislukt.length > 0 ? '\n\nNIET aangemaakt:\n' + mislukt.join('\n') : '');
  } else {
    samenvattingEl.style.color = 'var(--red)';
    samenvattingEl.textContent = '\u2717 Geen spelers aangemaakt — controleer de rode rijen';
    document.getElementById('bulk-import-credentials').style.display = 'none';
  }

  renderAdmin();
}


function kopieerBulkCredentials() {
  const el = document.getElementById('bulk-import-credentials');
  if (!el) return;
  navigator.clipboard.writeText(el.value)
    .then(() => toast('Gekopieerd ✓'))
    .catch(() => { el.select(); document.execCommand('copy'); toast('Gekopieerd ✓'); });
}



// ============================================================
//  LADDER-INTEGRITEIT — beheer-UI (v3.0.0-11.105)
// ============================================================
function vulIntegriteitSelect() {
  const sel = document.getElementById('integriteit-ladder-select');
  if (!sel) return;
  const huidige = sel.value;
  sel.innerHTML = alleLadders.map(l => `<option value="${escAttr(l.id)}">${esc(l.naam)}</option>`).join('');
  if (huidige && alleLadders.find(l => l.id === huidige)) sel.value = huidige;
  else if (activeLadderId) sel.value = activeLadderId;
}

async function controleerLadderIntegriteit() {
  const sel = document.getElementById('integriteit-ladder-select');
  const uit = document.getElementById('integriteit-resultaat');
  const ladderId = sel?.value;
  if (!ladderId || !uit) return;
  uit.innerHTML = '<span style="color:var(--mid)">Bezig met controleren…</span>';
  try {
    const r = await ladderIntegriteitsRapport(ladderId);
    if (r.schoon) {
      uit.innerHTML = `<div style="padding:10px 12px;background:rgba(29,122,61,0.12);border-radius:8px;color:#1d7a3d">
        ✓ Geen problemen. ${r.aantalSpelerIds} spelers, ${r.aantalStanden} standen, rangen sluitend 1–${r.aantalSpelerIds}.</div>`;
      return;
    }
    const regels = [];
    if (r.weesStanden.length)            regels.push(`${r.weesStanden.length} wees-stand(en) — stand zonder lidmaatschap`);
    if (r.ontbrekendeStanden.length)     regels.push(`${r.ontbrekendeStanden.length} ontbrekende stand(en) — lid zonder rang`);
    if (r.spelerIdsZonderProfiel.length) regels.push(`${r.spelerIdsZonderProfiel.length} lid/leden zonder spelerprofiel`);
    if (r.rangGaten)                     regels.push('rang-gaten of rangen buiten 1–N');
    if (r.rangDuplicaten.length)         regels.push(`dubbele rang(en): ${r.rangDuplicaten.join(', ')}`);
    uit.innerHTML = `<div style="padding:10px 12px;background:rgba(192,57,43,0.10);border-radius:8px;color:var(--dark)">
      <strong style="color:#c0392b">Problemen gevonden:</strong>
      <ul style="margin:6px 0 0;padding-left:18px">${regels.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p style="margin:8px 0 0;font-size:12px;color:var(--mid)">Klik op "Herstellen" om wezen op te ruimen, ontbrekende standen aan te maken en de rangen te normaliseren.</p>
    </div>`;
  } catch (e) {
    console.error('integriteitscheck mislukt:', e);
    uit.innerHTML = '<span style="color:#c0392b">Controle mislukt — zie console.</span>';
  }
}

async function herstelLadderIntegriteitUI() {
  const sel = document.getElementById('integriteit-ladder-select');
  const uit = document.getElementById('integriteit-resultaat');
  const ladderId = sel?.value;
  if (!ladderId || !uit) return;
  const naam = alleLadders.find(l => l.id === ladderId)?.naam || ladderId;
  if (!confirm(`Integriteit herstellen voor "${naam}"?\n\nDit verwijdert wees-standen, maakt ontbrekende standen aan en hernummert de rangen naar 1–N. De onderlinge volgorde blijft behouden.`)) return;
  uit.innerHTML = '<span style="color:var(--mid)">Bezig met herstellen…</span>';
  try {
    const res = await herstelLadderIntegriteit(ladderId);
    uit.innerHTML = `<div style="padding:10px 12px;background:rgba(29,122,61,0.12);border-radius:8px;color:#1d7a3d">
      ✓ Hersteld — ${res.weesVerwijderd} wees-stand(en) verwijderd, ${res.standenAangemaakt} stand(en) aangemaakt, ${res.rangenGewijzigd} rang(en) genormaliseerd.</div>`;
    if (typeof renderLadder === 'function') renderLadder();
    if (typeof renderAdminLadders === 'function') renderAdminLadders();
  } catch (e) {
    console.error('herstel mislukt:', e);
    uit.innerHTML = '<span style="color:#c0392b">Herstel mislukt — zie console.</span>';
  }
}

window.vulIntegriteitSelect = vulIntegriteitSelect;
window.controleerLadderIntegriteit = controleerLadderIntegriteit;
window.herstelLadderIntegriteitUI = herstelLadderIntegriteitUI;

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
  renderUiStijlKaart, kiesUiStijl,
  openBulkImport, sluitBulkImport, voegBulkRijToe, startBulkImport, kopieerBulkCredentials,
};
