// ============================================================
//  auth.js — v2.6.0 — fase 2 refactor
//  Primaire identifier: Firebase Auth uid
//  Bron van waarheid:   spelers/{uid}
//  Backward compat:     getUsers() / saveUsers() / getNextId()
//                       blijven beschikbaar voor fase 3-5
// ============================================================
import { db, auth, googleProvider, STATE_DOC, USERS_DOC,
  BANEN_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, TOERNOOI_DOC, TOERNOOIEN_COL,
  INVITE_DOC, SNAPSHOTS_COL, LADDERS_COL, DEFAULT_STATE, BANEN_DB, esc, escAttr,
  EMAIL_SUFFIX, INITIEEL_WACHTWOORD, DEFAULT_HCP,
  genereerEmail, loginNaamVan } from './config.js';
import { store, DEFAULT_LADDER_CONFIG,
  state, alleLadders, activeLadderId, alleSpelersData, huidigeBruiker,
  _usersCache, archiefData, uitdagingenData, toernooiData, alleToernooien,
  actieveToernooiId, _firestoreReady, _vasteListeners, _toernooiListeners,
  _bezigMetRegistratie, playerSlotCount } from './store.js';
import { renderLadder } from './ladder.js';
import { toonUitdagingBadge } from './archief.js';
import { closeModal, renderAdmin, renderProfiel } from './admin.js';
import { renderRonde } from './ronde.js';
import { renderToernooi } from './toernooi.js';
import { renderUitslagen } from './uitslagen.js';
import { startAlleStandenListeners, stopAlleStandenListeners } from './ladder-view.js';

import * as S from './store.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc,
  deleteDoc, getDocs, addDoc, query, where, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================================
//  AUTH / LOGIN
// ============================================================

// Zet UI in ingelogde staat — leest nu rechtstreeks uit spelers/{uid}
async function setIngelogd(firebaseUser) {
  try {
    const spelersSnap = await getDoc(doc(db, 'spelers', firebaseUser.uid));

    if (!spelersSnap.exists()) {
      // Niet in spelers/ — fallback naar oude users lijst (tijdelijk tijdens migratie)
      const users = await getUsers();
      const oudProfiel = users.find(u =>
        u.uid === firebaseUser.uid ||
        u.email?.toLowerCase() === firebaseUser.email?.toLowerCase()
      );
      if (!oudProfiel) {
        await signOut(auth);
        toonLoginFout('Je hebt geen toegang. Neem contact op met de beheerder.');
        return;
      }
      // Migreer dit account alsnog naar spelers/{uid}
      const naamRuw = oudProfiel.gebruikersnaam || oudProfiel.naam || firebaseUser.email.split('@')[0];
      const spelersDocData = { uid: firebaseUser.uid, naam: naamRuw,
        email: firebaseUser.email, rol: oudProfiel.rol || 'speler' };
      if (oudProfiel.hcp != null) spelersDocData.hcp = oudProfiel.hcp;
      try { await setDoc(doc(db, 'spelers', firebaseUser.uid), spelersDocData); } catch(e) {}
      return setIngelogdVanafProfiel(firebaseUser, spelersDocData);
    }

    return setIngelogdVanafProfiel(firebaseUser, spelersSnap.data());
  } catch(e) {
    console.error('setIngelogd error:', e);
    toonLoginFout('Verbindingsfout, probeer opnieuw');
  }
}

// Zet huidigeBruiker op basis van profiel uit spelers/{uid}
function setIngelogdVanafProfiel(firebaseUser, profiel) {
  // v3.0.0-9c: spelerId = uid. Geen naam-lookup meer in alleSpelersData.
  // Legacy code die 'spelerId' verwacht blijft werken omdat alleSpelersData
  // en de ladder-view nu ook id=uid teruggeven.
  store.huidigeBruiker = {
    uid:            firebaseUser.uid,
    email:          firebaseUser.email,
    gebruikersnaam: profiel.naam || firebaseUser.email.split('@')[0],
    rol:            profiel.rol  || 'speler',
    spelerId:       firebaseUser.uid,
    eersteLogin:    profiel.eersteLogin === true, // v3.0.0-11
  };

  vervolgIngelogd();
}

function updateSiteTitel() {
  if (!huidigeBruiker) return;
  const uid = huidigeBruiker.uid;
  const mijnLadders = isCoordinatorRol()
    ? alleLadders
    : alleLadders.filter(l => uid && (l.spelerIds || []).includes(uid));
  const h1Second = document.getElementById('h1-second');
  if (h1Second) {
    const alleenHeerendag = mijnLadders.length === 1 &&
      mijnLadders[0].naam.toLowerCase().includes('heerendag');
    h1Second.textContent = alleenHeerendag
      ? ` ${mijnLadders[0].naam} Ladder`
      : ' MP Ladder';
  }
}

// ============================================================
//  EERSTE-LOGIN FLOW — v3.0.0-11
//  Bij eerste login moet speler handicap en wachtwoord kiezen
//  voordat hij de app kan gebruiken. Modal is niet dismissible.
// ============================================================
function toonEersteLoginScherm() {
  const bestaand = document.getElementById('modal-eerste-login');
  if (bestaand) bestaand.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-eerste-login';
  overlay.className = 'modal-overlay open';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';
  // Niet-dismissible: geen close-button, klik buiten werkt niet
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;border-radius:16px;max-height:90vh">
      <h3>Welkom ${esc(huidigeBruiker.gebruikersnaam.split(' ')[0])}! 👋</h3>
      <p style="font-size:13px;color:var(--mid);margin-bottom:16px">
        Stel je handicap in en kies een eigen wachtwoord om door te gaan.
      </p>
      <div class="form-group">
        <label>Playing handicap (18 holes)</label>
        <input type="number" id="el-hcp" step="1" min="-10" max="54" value="10" inputmode="numeric" style="width:100%">
      </div>
      <div class="form-group">
        <label>Nieuw wachtwoord (minimaal 6 tekens)</label>
        <input type="password" id="el-pass-1" autocomplete="new-password" style="width:100%" placeholder="Kies een wachtwoord">
      </div>
      <div class="form-group">
        <label>Wachtwoord nogmaals</label>
        <input type="password" id="el-pass-2" autocomplete="new-password" style="width:100%" placeholder="Herhaal wachtwoord">
      </div>
      <div id="el-fout" style="display:none;color:var(--red);font-size:13px;margin-bottom:10px"></div>
      <button class="btn btn-primary btn-block" onclick="slaEersteLoginOp()" style="margin-top:8px">
        Opslaan en verder
      </button>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('el-hcp')?.focus(), 100);
}

async function slaEersteLoginOp() {
  const hcpEl   = document.getElementById('el-hcp');
  const pass1El = document.getElementById('el-pass-1');
  const pass2El = document.getElementById('el-pass-2');
  const foutEl  = document.getElementById('el-fout');
  foutEl.style.display = 'none';

  const hcp   = parseFloat(hcpEl.value);
  const pass1 = pass1El.value;
  const pass2 = pass2El.value;

  if (isNaN(hcp))            { foutEl.textContent = 'Voer een geldige handicap in'; foutEl.style.display = 'block'; return; }
  if (pass1.length < 6)       { foutEl.textContent = 'Wachtwoord moet minimaal 6 tekens zijn'; foutEl.style.display = 'block'; return; }
  if (pass1 !== pass2)        { foutEl.textContent = 'De wachtwoorden komen niet overeen'; foutEl.style.display = 'block'; return; }
  if (pass1 === INITIEEL_WACHTWOORD) { foutEl.textContent = 'Kies een ander wachtwoord dan het initiële'; foutEl.style.display = 'block'; return; }

  try {
    const hcpInt = Math.round(hcp);
    // Stap 1: wachtwoord wijzigen in Firebase Auth
    await updatePassword(auth.currentUser, pass1);

    // Stap 2: spelers/{uid} bijwerken — hcp + eersteLogin:false
    const snap = await getDoc(doc(db, 'spelers', huidigeBruiker.uid));
    const data = snap.exists() ? snap.data() : {};
    await setDoc(doc(db, 'spelers', huidigeBruiker.uid),
      { ...data, hcp: hcpInt, eersteLogin: false });

    // Stap 3: sync hcp naar alle ladders waar speler in zit
    // v3.0.0-11: gewone speler heeft geen write-rechten op ladder-doc (alleen coord
    // of via geldige invite). Wordt daarom best-effort: bij permission-denied loopt
    // het door — de hcp in spelers/{uid} is de bron van waarheid, en de ladder.spelers[]
    // hcp wordt straks in elke partij-bevestig gesynct.
    for (const ladder of alleLadders) {
      if (!(ladder.spelerIds || []).includes(huidigeBruiker.uid)) continue;
      try {
        const ladderSnap = await getDoc(doc(db, 'ladders', ladder.id));
        if (!ladderSnap.exists()) continue;
        const ladderData = ladderSnap.data();
        const spelers = (ladderData.spelers || []).map(s =>
          s.naam?.toLowerCase() === huidigeBruiker.gebruikersnaam.toLowerCase()
            ? { ...s, hcp: hcpInt } : s
        );
        await setDoc(doc(db, 'ladders', ladder.id), { ...ladderData, spelers });
      } catch(e) {
        // Verwacht bij gewone spelers — geen write-rechten op ladder-doc.
        // Niet blokkerend: hcp staat al in spelers/{uid}.
        console.warn('hcp sync naar ladder', ladder.id, 'mislukt:', e.code);
      }
    }

    // Stap 4: lokale state bijwerken en modal sluiten
    store.huidigeBruiker.eersteLogin = false;
    document.getElementById('modal-eerste-login')?.remove();
    toast('Profiel compleet ✓');
  } catch(e) {
    console.error('slaEersteLoginOp mislukt:', e);
    if (e.code === 'auth/requires-recent-login') {
      foutEl.textContent = 'Log opnieuw in en probeer het nog eens';
    } else if (e.code === 'auth/weak-password') {
      foutEl.textContent = 'Wachtwoord is te zwak — kies een sterker wachtwoord';
    } else {
      foutEl.textContent = 'Er is iets misgegaan: ' + (e.message || e.code);
    }
    foutEl.style.display = 'block';
  }
}

function vervolgIngelogd() {
  document.getElementById('login-scherm').classList.remove('actief');
  document.getElementById('login-fout').style.display = 'none';
  document.getElementById('login-pass').value = '';

  const adminBtn   = document.getElementById('nav-admin-btn');
  const profielBtn = document.getElementById('nav-profiel-btn');
  const logoutBtn  = document.getElementById('logout-btn');

  if (huidigeBruiker.rol === 'beheerder' || huidigeBruiker.rol === 'coordinator') {
    adminBtn.style.display = '';
    document.getElementById('nav-archief-btn').style.display  = '';
    document.getElementById('nav-toernooi-btn').style.display = '';
  } else {
    const uid = huidigeBruiker?.uid;
    const mijnToernooien = alleToernooien.filter(t =>
      (t.spelers || []).some(s => uid && s.uid === uid)
    );
    if (mijnToernooien.length > 0) {
      document.getElementById('nav-toernooi-btn').style.display = '';
    }
  }
  profielBtn.style.display = '';
  logoutBtn.style.display  = '';
  logoutBtn.textContent    = huidigeBruiker.gebruikersnaam.split(' ')[0] + ' ↩';

  const versieBadge = document.getElementById('versie-badge');
  if (versieBadge) versieBadge.style.display = isBeheerderRol() ? '' : 'none';

  renderLadder();
  registreerNotificatieToken();
  laadUitdagingen();
  updateSiteTitel();

  // v3.0.0-11: als eerste login, dwing speler naar verplicht profiel-scherm
  if (huidigeBruiker.eersteLogin) {
    toonEersteLoginScherm();
  }

  setTimeout(() => {
    const wrap = document.getElementById('ladder-kaarten');
    if (wrap && wrap.querySelector('.empty-icon')) renderLadder();
    updateSiteTitel();
  }, 2000);
}

function toonLoginFout(msg) {
  const fout = document.getElementById('login-fout');
  fout.textContent = msg;
  fout.style.display = 'block';
}

async function loginSubmit() {
  const invoer    = document.getElementById('login-email').value.trim();
  const wachtwoord = document.getElementById('login-pass').value;
  document.getElementById('login-fout').style.display = 'none';
  if (!invoer || !wachtwoord) { toonLoginFout('Vul login en wachtwoord in'); return; }

  // v3.0.0-11: als invoer geen '@' bevat, behandel als login-naam en voeg suffix toe.
  // Anders behandel als volledig emailadres (backward compat voor legacy accounts).
  const email = invoer.includes('@') ? invoer.toLowerCase() : (invoer.toLowerCase() + EMAIL_SUFFIX);
  try {
    await signInWithEmailAndPassword(auth, email, wachtwoord);
  } catch(e) {
    const berichten = {
      'auth/user-not-found':    'Geen account gevonden',
      'auth/wrong-password':    'Onjuist wachtwoord',
      'auth/invalid-email':     'Ongeldige login',
      'auth/too-many-requests': 'Te veel pogingen, probeer later opnieuw',
      'auth/invalid-credential':'Login of wachtwoord onjuist',
    };
    toonLoginFout(berichten[e.code] || 'Inloggen mislukt, probeer opnieuw');
  }
}

async function loginMetGoogle() {
  document.getElementById('login-fout').style.display = 'none';
  try {
    await signInWithPopup(auth, googleProvider);
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      toonLoginFout('Google inloggen mislukt, probeer opnieuw');
    }
  }
}

function uitloggen() {
  _vasteListeners.forEach(unsub => unsub());
  store._vasteListeners = [];
  _toernooiListeners.forEach(unsub => unsub());
  store._toernooiListeners = [];
  stopAlleStandenListeners();
  signOut(auth);
  store.huidigeBruiker = null;
  store._usersCache    = null;
  document.getElementById('login-scherm').classList.add('actief');
  document.getElementById('nav-admin-btn').style.display    = 'none';
  document.getElementById('nav-archief-btn').style.display  = 'none';
  document.getElementById('nav-toernooi-btn').style.display = 'none';
  document.getElementById('nav-profiel-btn').style.display  = 'none';
  document.getElementById('logout-btn').style.display       = 'none';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-ladder').classList.add('active');
  document.querySelector('nav button').classList.add('active');
}

function openWachtwoordVergeten() {
  // v3.0.0-11: geen reset-email meer, speler moet contact opnemen met beheerder.
  alert('Wachtwoord vergeten? Neem contact op met de beheerder.\n\nDe beheerder kan je wachtwoord resetten naar ' + INITIEEL_WACHTWOORD + ', waarna je bij eerstvolgende inlog een nieuw wachtwoord kiest.');
}
function sluitResetWrap() {
  // v3.0.0-11: placeholder — reset-UI wordt niet meer gebruikt
  const wrap = document.getElementById('reset-wrap');
  if (wrap) wrap.style.display = 'none';
}
async function stuurResetEmail() {
  // v3.0.0-11: reset-email flow is uitgeschakeld. Functie blijft bestaan voor
  // backward compat met window.* bindings in app.js.
  alert('Reset-email is uitgeschakeld. Neem contact op met de beheerder.');
}
function openWachtwoordWijzigen() {
  document.getElementById('huidig-wachtwoord').value   = '';
  document.getElementById('nieuw-wachtwoord').value    = '';
  document.getElementById('bevestig-wachtwoord').value = '';
  document.getElementById('modal-wachtwoord-wijzigen').classList.add('open');
}
async function wijzigWachtwoord() {
  alert('wijzigWachtwoord aangeroepen');
  const huidig   = document.getElementById('huidig-wachtwoord').value;
  const nieuw    = document.getElementById('nieuw-wachtwoord').value;
  const bevestig = document.getElementById('bevestig-wachtwoord').value;
  if (!huidig)            { toast('Voer je huidige wachtwoord in'); return; }
  if (nieuw.length < 4)   { toast('Nieuw wachtwoord minimaal 4 tekens'); return; }
  if (nieuw !== bevestig) { toast('Wachtwoorden komen niet overeen'); return; }
  if (nieuw === huidig)   { toast('Nieuw wachtwoord moet anders zijn'); return; }
  toast('Bezig...');
  try {
    const user = auth.currentUser;
    if (!user) { toast('Niet ingelogd'); return; }
    try {
      const credential = EmailAuthProvider.credential(user.email, huidig);
      await reauthenticateWithCredential(user, credential);
    } catch(reAuthErr) {
      toast('Huidig wachtwoord onjuist (' + reAuthErr.code + ')'); return;
    }
    await updatePassword(user, nieuw);
    document.getElementById('huidig-wachtwoord').value   = '';
    document.getElementById('nieuw-wachtwoord').value    = '';
    document.getElementById('bevestig-wachtwoord').value = '';
    closeModal('modal-wachtwoord-wijzigen');
    toast('Wachtwoord gewijzigd ✓');
  } catch(e) { toast('Wijzigen mislukt: ' + e.code); }
}

// ============================================================
//  FIRESTORE — opslaan & initialisatie
// ============================================================

async function slaState() {
  try {
    if (activeLadderId) {
      await setDoc(doc(db, 'ladders', activeLadderId), JSON.parse(JSON.stringify(state)));
    } else {
      await setDoc(STATE_DOC, JSON.parse(JSON.stringify(state)));
    }
  } catch(e) { console.error('Firestore save error:', e); }
}

async function initFirestore() {
  toonLaadOverlay(true);

  const heeftInvite = new URLSearchParams(location.search).has('invite');
  if (heeftInvite) {
    toonLaadOverlay(false);
    checkInviteLink();
  }

  const loginFallback = setTimeout(() => {
    toonLaadOverlay(false);
    if (!heeftInvite && !huidigeBruiker) {
      document.getElementById('login-scherm').classList.add('actief');
    }
  }, 3000);

  try {
    const [baanSnap, archiefSnap, uitdSnap, toernooiSnap, volgordeSnap] =
      await Promise.all([
        getDoc(BANEN_DOC),
        getDoc(ARCHIEF_DOC),
        getDoc(UITDAGINGEN_DOC),
        getDoc(TOERNOOI_DOC),
        getDoc(doc(db, 'ladder', 'ladderVolgorde'))
      ]);

    store.archiefData     = archiefSnap.exists()  ? (archiefSnap.data().seizoenen  || []) : [];
    store.uitdagingenData = uitdSnap.exists()      ? (uitdSnap.data().lijst         || []) : [];
    // v3.0.0-11.17: laad aangepaste banen uit Firestore
    store.aangepasteBanen = baanSnap.exists()      ? (baanSnap.data().lijst         || []) : [];
    // v3.0.0-9c: alleSpelersData wordt niet meer uit ladder/spelers geladen.
    // Het is nu een afgeleide view van _usersCache (zie store.js) en wordt
    // gevuld zodra de spelers/ listener start na login.
    const ladderVolgorde  = volgordeSnap.exists()  ? (volgordeSnap.data().volgorde  || []) : [];

    const toernooienSnap = await getDocs(query(TOERNOOIEN_COL, where('status', '==', 'actief')));
    store.alleToernooien = toernooienSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (toernooiSnap.exists() && toernooiSnap.data().status === 'actief' && store.alleToernooien.length === 0) {
      const legacyData = { ...toernooiSnap.data() };
      const newRef = await addDoc(TOERNOOIEN_COL, legacyData);
      store.alleToernooien = [{ id: newRef.id, ...legacyData }];
      await setDoc(TOERNOOI_DOC, { status: 'gemigreerd' });
    }
    if (alleToernooien.length > 0) {
      store.toernooiData      = alleToernooien[0];
      store.actieveToernooiId = alleToernooien[0].id;
    }

    const laddersSnap = await getDocs(LADDERS_COL);
    console.log('v2.6 debug: ladders geladen:', laddersSnap.docs.length);

    const stateSnap = await getDoc(STATE_DOC);
    const mpDoc     = laddersSnap.docs.find(d => d.id === 'mp');

    if (!mpDoc) {
      const bestaandeState = stateSnap.exists()
        ? stateSnap.data()
        : JSON.parse(JSON.stringify(DEFAULT_STATE));
      if (!bestaandeState.actievePartijen) {
        bestaandeState.actievePartijen = bestaandeState.actievePartij
          ? [{ ...bestaandeState.actievePartij, partijId: `p_${Date.now()}` }] : [];
        delete bestaandeState.actievePartij;
      }
      if (!bestaandeState.spelers) bestaandeState.spelers = [];
      // v3.0.0-9c: migratie naar ladder/spelers verwijderd — _usersCache is bron van waarheid
      const mpRef = doc(db, 'ladders', 'mp');
      await setDoc(mpRef, { ...bestaandeState, naam: 'MP',
        spelerIds: bestaandeState.spelers.map(s => s.id) });
      store.alleLadders    = [{ id: 'mp', naam: 'MP',
        spelerIds: bestaandeState.spelers.map(s => s.id),
        spelers: bestaandeState.spelers, actievePartijen: bestaandeState.actievePartijen }];
      laddersSnap.docs.filter(d => d.id !== 'mp').forEach(d => {
        alleLadders.push({ id: d.id, naam: d.data().naam,
          spelerIds: d.data().spelerIds || [],
          spelers: d.data().spelers || [], actievePartijen: d.data().actievePartijen || [] });
      });
      store.state          = bestaandeState;
      store.activeLadderId = 'mp';
    } else {
      store.alleLadders = laddersSnap.docs.map(d => ({
        id: d.id, naam: d.data().naam,
        type:            d.data().type            || 'ranking',
        spelerIds:       d.data().spelerIds       || [],
        spelers:         d.data().spelers         || [],
        actievePartijen: d.data().actievePartijen || [],
        config: d.data().config || null,
        data:   d.data()
      }));
      if (ladderVolgorde.length > 0) {
        alleLadders.sort((a, b) => {
          const ai = ladderVolgorde.indexOf(a.id);
          const bi = ladderVolgorde.indexOf(b.id);
          if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi;
        });
      }
      const actief = laddersSnap.docs.find(d => d.id === 'mp') || laddersSnap.docs[0];
      if (!actief) { console.warn('Geen ladders gevonden'); toonLaadOverlay(false); return; }
      const actiefData = actief.data();
      if (!actiefData) { console.error('Ladder data undefined'); toonLaadOverlay(false); return; }
      store.state          = actiefData;
      if (!store.state.actievePartijen) store.state.actievePartijen = [];
      store.activeLadderId = actief.id;

      // v3.0.0-9c: tweede migratieblok (ladders→alleSpelersData→SPELERS_DOC) verwijderd.
      // alleSpelersData wordt nu rechtstreeks afgeleid van _usersCache.
    }
  } catch(e) { console.error('Firestore init error:', e); }

  clearTimeout(loginFallback);

  // ── Live listener: actieve ladder ──────────────────────────
  if (store.activeLadderId) {
    _vasteListeners.push(onSnapshot(doc(db, 'ladders', store.activeLadderId), (snap) => {
      if (!snap.exists() || !huidigeBruiker) return;
      store.state = snap.data();
      if (!store.state.actievePartijen) store.state.actievePartijen = [];
      const idx = store.alleLadders.findIndex(l => l.id === activeLadderId);
      if (idx >= 0) {
        store.alleLadders[idx].spelers         = store.state.spelers        || [];
        store.alleLadders[idx].spelerIds       = store.state.spelerIds       || [];
        store.alleLadders[idx].actievePartijen = store.state.actievePartijen;
        store.alleLadders[idx].data            = snap.data();
      }
      const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
      if (ap === 'ladder')   renderLadder();
      if (ap === 'uitslagen') renderUitslagen();
      if (ap === 'admin')    renderAdmin();
      if (ap === 'ronde')    renderRonde();
      if (ap === 'profiel')  renderProfiel();
      if (ap === 'toernooi') renderToernooi();
      updateSiteTitel();
    }));
  }

  // ── Live listener: overige ladders ─────────────────────────
  alleLadders.filter(l => l.id !== activeLadderId).forEach(ladder => {
    _vasteListeners.push(onSnapshot(doc(db, 'ladders', ladder.id), (snap) => {
      if (!snap.exists() || !huidigeBruiker) return;
      const idx = alleLadders.findIndex(l => l.id === ladder.id);
      if (idx >= 0) {
        alleLadders[idx].spelers   = snap.data().spelers   || [];
        alleLadders[idx].spelerIds = snap.data().spelerIds || [];
        alleLadders[idx].data      = snap.data();
      }
      const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
      if (ap === 'ladder')  renderLadder();
      if (ap === 'admin')   renderAdmin();
      if (ap === 'profiel') renderProfiel();
      updateSiteTitel();
    }));
  });

  // v3.0.0-9c: legacy listener op ladder/spelers verwijderd.
  // De spelers/ collectie-listener (na login, zie onAuthStateChanged) is nu de enige bron.

  // spelers/ listener wordt gestart in onAuthStateChanged (na login)
  // zodat er geen permission-denied optreedt voor inloggen

  store._firestoreReady = true;
  setTimeout(() => toonLaadOverlay(false), 10000);

  onAuthStateChanged(auth, async (user) => {
    if (store._bezigMetRegistratie) return;
    toonLaadOverlay(false);
    if (user) {
      if (huidigeBruiker && huidigeBruiker.uid === user.uid) return;
      await setIngelogd(user);
      // Start spelers/ listener nu de gebruiker ingelogd is
      if (!_vasteListeners._spelersListenerActief) {
        _vasteListeners._spelersListenerActief = true;
        _vasteListeners.push(onSnapshot(
          collection(db, 'spelers'),
          (snap) => {
            if (!huidigeBruiker) return;
            store._usersCache = snap.docs.map(d => spelersDocNaarUserFormaat(d.data()));
            const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
            if (ap === 'admin') renderAdmin();
          },
          (err) => { console.warn('spelers/ listener error:', err.code); }
        ));
      }
      // Start standen/ listeners voor alle ladders (fase 9a view-laag)
      startAlleStandenListeners();
    } else {
      store.huidigeBruiker = null;
      const heeftInvite = new URLSearchParams(location.search).has('invite');
      if (heeftInvite) { await checkInviteLink(); }
      else { document.getElementById('login-scherm').classList.add('actief'); }
    }
  });
}

async function wisselLadder(ladderId) {
  try {
    if (ladderId === activeLadderId) return;
    const snap = await getDoc(doc(db, 'ladders', ladderId));
    if (!snap.exists()) return;
    store.activeLadderId = ladderId;
    store.state          = snap.data();
    if (!state.actievePartijen) state.actievePartijen = [];
    renderLadder();
    renderUitslagen();
  } catch(e) { console.error('wisselLadder mislukt:', e); }
}

function toonLaadOverlay(toon) {
  document.getElementById('laad-overlay').style.display = toon ? 'flex' : 'none';
}

// ============================================================
//  UITNODIGINGSLINK & REGISTRATIE
// ============================================================

async function genereerInviteLink() {
  try {
    const ladderId = document.getElementById('invite-ladder-select')?.value || activeLadderId;
    const ladder   = alleLadders.find(l => l.id === ladderId);
    const token    = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const verloopt = Date.now() + 14 * 24 * 60 * 60 * 1000;
    // v3.0.0-10 fase 10 V-4: expliciete gebruik-limiet. Default 10; kan later via UI aangepast.
    const maxGebruik = 10;
    await setDoc(doc(db, 'ladder', `invite_${ladderId}`),
      { token, verloopt, ladderId, ladderNaam: ladder?.naam || ladderId,
        aangemaakt: Date.now(), gebruik: 0, maxGebruik });
    const url = `${location.origin}${location.pathname}?invite=${token}&ladder=${ladderId}`;
    document.getElementById('invite-link-text').textContent   = url;
    document.getElementById('invite-link-wrap').style.display = 'block';
    document.getElementById('invite-status').textContent =
      `Geldig tot ${new Date(verloopt).toLocaleDateString('nl-NL')} · Ladder: ${ladder?.naam || ladderId} · Max ${maxGebruik} registraties`;
    toast('Uitnodigingslink aangemaakt ✓');
  } catch(e) { console.error('genereerInviteLink mislukt:', e); toast('Er is iets misgegaan'); }
}

function kopieerInviteLink() {
  navigator.clipboard.writeText(document.getElementById('invite-link-text').textContent)
    .then(() => toast('Link gekopieerd! ✓'));
}

async function checkInviteLink() {
  const params   = new URLSearchParams(location.search);
  const token    = params.get('invite');
  const ladderId = params.get('ladder') || 'mp';
  if (!token) return;

  document.getElementById('login-scherm').classList.remove('actief');
  document.getElementById('registratie-scherm').style.display = 'block';
  window._inviteLadderId = ladderId;

  let geldig = false;
  let opgebruikt = false;
  try {
    const snapLadder = await getDoc(doc(db, 'ladder', `invite_${ladderId}`));
    if (snapLadder.exists() && snapLadder.data().token === token && snapLadder.data().verloopt > Date.now()) {
      const d = snapLadder.data();
      // v3.0.0-10 fase 10 V-4: check gebruik-teller
      if (d.maxGebruik != null && (d.gebruik || 0) >= d.maxGebruik) {
        opgebruikt = true;
      } else {
        geldig = true;
      }
    } else {
      const snapGlobal = await getDoc(INVITE_DOC);
      if (snapGlobal.exists() && snapGlobal.data().token === token && snapGlobal.data().verloopt > Date.now()) {
        const d = snapGlobal.data();
        if (d.maxGebruik != null && (d.gebruik || 0) >= d.maxGebruik) {
          opgebruikt = true;
        } else {
          geldig = true;
        }
      }
    }
  } catch(e) { console.error('Invite check fout:', e); }

  if (!geldig) {
    document.getElementById('reg-formulier').style.display = 'none';
    const fout = document.getElementById('reg-fout');
    fout.textContent = opgebruikt
      ? 'Deze uitnodigingslink heeft het maximum aantal registraties bereikt. Vraag de beheerder om een nieuwe link.'
      : 'Deze uitnodigingslink is verlopen of ongeldig. Vraag de beheerder om een nieuwe link.';
    fout.style.display = 'block';
  }
}

// Registreer nieuwe speler — v3.0.0-11: uniforme flow met admin-create.
// Auto-genereert email uit voornaam+achternaam, gebruikt INITIEEL_WACHTWOORD.
// Speler wordt bij eerste inlog gedwongen eigen wachtwoord + handicap te kiezen.
async function registreerSpeler() {
  const voornaam   = document.getElementById('reg-voornaam').value.trim();
  const achternaam = document.getElementById('reg-achternaam').value.trim();
  const fout       = document.getElementById('reg-fout');
  const succes     = document.getElementById('reg-succes');

  fout.style.display   = 'none';
  succes.style.display = 'none';

  if (!voornaam)   { fout.textContent = 'Vul je voornaam in';   fout.style.display = 'block'; return; }
  if (!achternaam) { fout.textContent = 'Vul je achternaam in'; fout.style.display = 'block'; return; }
  if (!document.getElementById('reg-akkoord')?.checked) {
    fout.textContent = 'Ga akkoord met de voorwaarden om verder te gaan';
    fout.style.display = 'block'; return;
  }

  // v3.0.0-11: auto-genereer email + wachtwoord, default hcp
  const email = genereerEmail(voornaam, achternaam);
  const pass  = INITIEEL_WACHTWOORD;
  const hcp   = DEFAULT_HCP;
  const naam  = `${voornaam} ${achternaam}`;
  const targetLadderId = window._inviteLadderId || 'mp';

  try {
    store._bezigMetRegistratie = true;

    // v3.0.0-10 fase 10 V-4: opnieuw checken of invite niet inmiddels opgebruikt is
    try {
      const inviteSnap0 = await getDoc(doc(db, 'ladder', `invite_${targetLadderId}`));
      if (inviteSnap0.exists()) {
        const d0 = inviteSnap0.data();
        if (d0.maxGebruik != null && (d0.gebruik || 0) >= d0.maxGebruik) {
          store._bezigMetRegistratie = false;
          fout.textContent = 'Deze uitnodigingslink heeft het maximum aantal registraties bereikt. Vraag de beheerder om een nieuwe link.';
          fout.style.display = 'block';
          return;
        }
      }
    } catch(e) { /* read mislukt — door met registratie, teller-write verderop vangt op */ }

    // Stap 1: Firebase Auth account aanmaken
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;

    // Stap 2: spelers/{uid} aanmaken — eersteLogin:true forceert profielflow
    await setDoc(doc(db, 'spelers', uid),
      { uid, naam, email, rol: 'speler', hcp, eersteLogin: true });

    // Stap 3: Ladder data laden
    const ladderSnap = await getDoc(doc(db, 'ladders', targetLadderId));
    const ladderData = ladderSnap.exists() ? ladderSnap.data() : { spelers: [], nextId: 1 };
    ladderData.spelers   = ladderData.spelers   || [];
    ladderData.spelerIds = ladderData.spelerIds || [];

    const maxRank = ladderData.spelers.length > 0
      ? Math.max(...ladderData.spelers.map(s => s.rank || 0)) : 0;
    const newRank = maxRank + 1;
    const newId   = getNextId();

    // Stap 4-7: ladder toewijzen — vereist actieve invite of coordinator rechten
    // Bij mislukken (permissions) toch doorgaan: account + spelers/{uid} zijn aangemaakt
    try {
      // Stap 4: standen/{uid} aanmaken
      await setDoc(doc(db, 'ladders', targetLadderId, 'standen', uid),
        { rank: newRank, partijen: 0, gewonnen: 0 });

      // Stap 5: spelerIds bijwerken
      if (!ladderData.spelerIds.includes(uid)) {
        ladderData.spelerIds = [...ladderData.spelerIds, uid];
      }

      // Stap 6: dual-write naar ladders.spelers[] (backward compat)
      const bestaatAl = ladderData.spelers.some(s =>
        s.naam?.toLowerCase() === naam.toLowerCase() || s.email === email
      );
      if (!bestaatAl) {
        ladderData.spelers.push({ id: newId, naam, hcp, rank: newRank, partijen: 0, gewonnen: 0 });
        ladderData.nextId = newId + 1;
      }
      await setDoc(doc(db, 'ladders', targetLadderId), ladderData);

      // v3.0.0-9c: stap 7 (legacy ladder/spelers master lijst bijwerken) verwijderd.
      // spelers/{uid} werd al in stap 1 geschreven, wat de enige bron is.
    } catch(ladderErr) {
      // Ladder-schrijven mislukt (bijv. invite verlopen) — account is wel aangemaakt
      console.warn('Ladder toewijzing mislukt, account is aangemaakt:', ladderErr.code);
    }

    const ladderNaam = ladderData.naam || alleLadders.find(l => l.id === targetLadderId)?.naam || targetLadderId;

    store._bezigMetRegistratie = false;
    document.getElementById('reg-formulier').style.display = 'none';
    const loginTxt = loginNaamVan(email);
    succes.innerHTML = `
      <strong style="font-size:18px">Welkom ${esc(voornaam)}! 🎉</strong><br><br>
      Je account is aangemaakt en je staat in de <strong>${esc(ladderNaam)}</strong> ladder.<br><br>
      <div style="background:var(--info-bg);color:var(--info-text);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px">
        <strong>Je eerste inloggegevens:</strong><br><br>
        <div style="font-family:'DM Mono',monospace;background:var(--card-bg);color:var(--dark);padding:8px 10px;border-radius:6px;border:1px solid var(--border);margin-bottom:6px">
          login: <strong>${esc(loginTxt)}</strong><br>
          wachtwoord: <strong>${esc(INITIEEL_WACHTWOORD)}</strong>
        </div>
        <em style="font-size:12px;color:var(--mid)">Bij eerste inlog kies je een eigen wachtwoord en stel je je handicap in.</em>
      </div>
      <div style="background:var(--soft-bg);color:var(--mid);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px">
        <strong>📱 App op je homescreen zetten (aanbevolen)</strong><br><br>
        <strong>iPhone/iPad (Safari):</strong><br>
        Tik op het deel-icoon <span style="font-size:15px">⎙</span> onderin → "Zet op beginscherm" → "Voeg toe"<br><br>
        <strong>Android (Chrome):</strong><br>
        Tik op de drie puntjes ⋮ rechtsboven → "Toevoegen aan startscherm"
      </div>
      <a href="${location.origin}${location.pathname}"
        style="display:block;text-align:center;background:var(--green);color:var(--on-primary);
          padding:12px;border-radius:8px;font-weight:600;text-decoration:none">
        Inloggen →
      </a>`;
    succes.style.display = 'block';

    try {
      const inviteRef  = doc(db, 'ladder', `invite_${targetLadderId}`);
      const inviteSnap = await getDoc(inviteRef);
      if (inviteSnap.exists()) {
        const d = inviteSnap.data();
        await setDoc(inviteRef, { ...d, gebruik: (d.gebruik || 0) + 1 });
      }
    } catch(e) { console.error('Invite teller mislukt:', e); }

  } catch(e) {
    store._bezigMetRegistratie = false;
    if (e.code === 'auth/email-already-in-use') {
      fout.innerHTML = `Er is al een account met deze naam. Neem contact op met de beheerder.`;
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
      sel.innerHTML = alleLadders.map(l => `<option value="${escAttr(l.id)}">${esc(l.naam)}</option>`).join('');
      if (huidigeWaarde && alleLadders.find(l => l.id === huidigeWaarde)) sel.value = huidigeWaarde;
      sel.onchange = () => laadInviteStatus();
    }
    const ladderId = sel?.value || activeLadderId;
    const snap     = await getDoc(doc(db, 'ladder', `invite_${ladderId}`));
    const el       = document.getElementById('invite-status');
    if (!el) return;
    if (snap.exists() && snap.data().verloopt > Date.now()) {
      const d       = snap.data();
      const url     = `${location.origin}${location.pathname}?invite=${d.token}&ladder=${ladderId}`;
      const gebruik = d.gebruik || 0;
      const maxStr  = d.maxGebruik != null ? ` van max ${d.maxGebruik}` : '';
      const opgebruikt = d.maxGebruik != null && gebruik >= d.maxGebruik;
      el.textContent = opgebruikt
        ? `Opgebruikt — ${gebruik}${maxStr} registraties gebruikt`
        : `Actief — geldig tot ${new Date(d.verloopt).toLocaleDateString('nl-NL')} · ${gebruik}${maxStr} keer gebruikt`;
      document.getElementById('invite-link-text').textContent   = url;
      document.getElementById('invite-link-wrap').style.display = 'block';
    } else {
      el.textContent = 'Geen actieve uitnodiging voor deze ladder.';
      document.getElementById('invite-link-wrap').style.display = 'none';
    }
  } catch(e) {}
}

function autoAdvance(input) {
  // v3.0.0-11.21: spring alleen naar een input die LATER in de DOM-order staat.
  // DOM-order is stabiel — geen last van scroll, keyboard, re-render etc.
  // Gebruikt geen tabindex (die kan gaten hebben) en geen getBoundingClientRect
  // (die verandert door scroll/keyboard en geeft onbetrouwbare resultaten).
  const alle = Array.from(document.querySelectorAll('input[type=number]'));
  const huidigeIdx = alle.indexOf(input);
  if (huidigeIdx < 0 || huidigeIdx >= alle.length - 1) return;
  const volgend = alle[huidigeIdx + 1];
  volgend.focus();
  volgend.select();
}

// ============================================================
//  HELPER FUNCTIES
// ============================================================

// Zet spelers/{uid} document om naar oud users-formaat
// zodat fase 3-5 modules ongewijzigd blijven werken
function spelersDocNaarUserFormaat(data) {
  return {
    uid:            data.uid,
    email:          data.email          || '',
    gebruikersnaam: data.naam           || '',
    naam:           data.naam           || '',
    rol:            data.rol            || 'speler',
    hcp:            data.hcp            ?? null,
    eersteLogin:    data.eersteLogin,   // v3.0.0-11.11: nodig voor admin-weergave
    spelerId:       null,   // verdwijnt in fase 3
  };
}

// getUsers — leest nu uit spelers/ collectie
// Geeft array in oud formaat terug voor backward compat
async function getUsers(forceFresh = false) {
  if (!forceFresh && _usersCache !== null) return _usersCache;
  try {
    const snap = await getDocs(collection(db, 'spelers'));
    store._usersCache = snap.docs.map(d => spelersDocNaarUserFormaat(d.data()));
  } catch(e) {
    console.error('getUsers mislukt:', e);
    store._usersCache = store._usersCache || [];
  }
  return _usersCache;
}

// saveUsers — no-op stub
// Directe writes naar users-lijst zijn vervangen door setDoc op spelers/{uid}
async function saveUsers(lijst) {
  console.warn('saveUsers() no-op in v2.6.0 — schrijven loopt via spelers/{uid} (fase 3)');
  store._usersCache = lijst;
}

async function getLadderData(ladderId, forceFresh = false) {
  if (!forceFresh) {
    const cached = alleLadders.find(l => l.id === ladderId);
    if (cached?.data) return { exists: true, data: cached.data, _cached: true };
    if (ladderId === activeLadderId) return { exists: true, data: state, _cached: true };
  }
  try {
    const snap = await getDoc(doc(db, 'ladders', ladderId));
    if (snap.exists()) {
      const idx = alleLadders.findIndex(l => l.id === ladderId);
      if (idx >= 0) alleLadders[idx].data = snap.data();
    }
    return { exists: snap.exists(), data: snap.exists() ? snap.data() : null };
  } catch(e) { console.error('getLadderData mislukt:', e); return { exists: false, data: null }; }
}

function getLadderConfig() {
  return state.config || alleLadders.find(l => l.id === activeLadderId)?.config || DEFAULT_LADDER_CONFIG;
}

// getNextId — werkt nog op numeric ladder ids
// Verdwijnt in fase 3
function getNextId() {
  const maxAlleSpelers = alleSpelersData.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
  const maxAlleLadders = alleLadders.reduce((m, l) =>
    Math.max(m, ...(l.spelers || []).map(s => Number(s.id) || 0)), 0);
  return Math.max(maxAlleSpelers, maxAlleLadders) + 1;
}

function isCoordinatorRol() {
  return huidigeBruiker?.rol === 'coordinator' || huidigeBruiker?.rol === 'beheerder';
}
function isBeheerderRol() {
  return huidigeBruiker?.rol === 'beheerder';
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function registreerNotificatieToken() {}

function vraagNotificatieToestemming() {
  toast('Notificaties worden ondersteund in een toekomstige versie');
}

async function laadUitdagingen() {
  try {
    if (!huidigeBruiker) return;
    const snap = await getDoc(UITDAGINGEN_DOC);
    store.uitdagingenData = snap.exists() ? (snap.data().lijst || []) : [];
    toonUitdagingBadge();
  } catch(e) { console.error('laadUitdagingen mislukt:', e); }
}

// ============================================================
//  INIT
// ============================================================

function initApp() {
  let retries = 0;
  async function tryInit() {
    try {
      await initFirestore();
    } catch(e) {
      retries++;
      console.warn(`initFirestore poging ${retries} mislukt:`, e);
      if (retries < 3) {
        setTimeout(tryInit, retries * 2000);
      } else {
        console.error('initFirestore definitief mislukt na 3 pogingen');
        toonLaadOverlay(false);
        toonLoginFout('Verbindingsfout — ververs de pagina om opnieuw te proberen');
      }
    }
  }
  tryInit();
}

// ============================================================
//  EXPORTS — identiek aan v2.5.x voor volledige backward compat
// ============================================================
export {
  initApp, initFirestore, setIngelogd, vervolgIngelogd, uitloggen,
  loginSubmit, loginMetGoogle,
  openWachtwoordVergeten, sluitResetWrap, stuurResetEmail,
  openWachtwoordWijzigen, wijzigWachtwoord,
  slaState, wisselLadder, toonLaadOverlay,
  getUsers, saveUsers, getLadderData, getLadderConfig,
  updateSiteTitel, toonLoginFout,
  genereerInviteLink, kopieerInviteLink, checkInviteLink,
  registreerSpeler, laadInviteStatus, autoAdvance,
  getNextId, isCoordinatorRol, isBeheerderRol,
  toast, registreerNotificatieToken, laadUitdagingen,
  slaEersteLoginOp,
};
