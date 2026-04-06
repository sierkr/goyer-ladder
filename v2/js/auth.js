// ============================================================
//  auth.js — Authenticatie, initialisatie, registratie, uitnodiging
// ============================================================
import { db, auth, googleProvider, STATE_DOC, USERS_DOC, SPELERS_DOC,
  BANEN_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, TOERNOOI_DOC, TOERNOOIEN_COL,
  INVITE_DOC, SNAPSHOTS_COL, LADDERS_COL, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, DEFAULT_LADDER_CONFIG } from './store.js';

// Toegang tot gedeelde state via store
import * as S from './store.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

//  AUTH / LOGIN — Firebase Authentication
// ============================================================

// Zet UI in ingelogde staat
async function setIngelogd(firebaseUser) {
  try {
    const users = await getUsers();

    // Whitelist check — alleen bekende e-mailadressen mogen inloggen
    const profiel = users.find(u => u.uid === firebaseUser.uid || u.email?.toLowerCase() === firebaseUser.email?.toLowerCase());

    if (!profiel) {
      // Niet in de whitelist — uitloggen en melding tonen
      await signOut(auth);
      toonLoginFout('Je hebt geen toegang. Neem contact op met de beheerder.');
      return;
    }

    // Koppel uid automatisch als die nog niet ingevuld is
    if (!profiel.uid && firebaseUser.uid) {
      profiel.uid = firebaseUser.uid;
      await saveUsers(users);
    }

    const displayNaam = profiel.gebruikersnaam || firebaseUser.displayName || firebaseUser.email.split('@')[0];

    // Als gebruikersnaam een e-mailadres of prefix lijkt, probeer de echte naam te herstellen
    let besteNaam = displayNaam;
    if (displayNaam.includes('@') || !displayNaam.includes(' ')) {
      const emailPfx = firebaseUser.email.split('@')[0].toLowerCase();
      const gekoppeldeSpeler = (state.spelers || []).find(s => {
        const voornaam = s.naam.toLowerCase().split(' ')[0];
        return emailPfx.startsWith(voornaam) || voornaam.startsWith(emailPfx.substring(0, 4));
      });
      if (gekoppeldeSpeler) besteNaam = gekoppeldeSpeler.naam;
    }

    store.huidigeBruiker = { uid: firebaseUser.uid, email: firebaseUser.email, gebruikersnaam: besteNaam, rol: profiel.rol };

  } catch(e) {
    console.error('setIngelogd error:', e);
    toonLoginFout('Verbindingsfout, probeer opnieuw');
    return;
  }

  vervolgIngelogd();
}

function updateSiteTitel() {
  if (!huidigeBruiker) return;
  const voornaam = (huidigeBruiker.gebruikersnaam || '').toLowerCase().split(' ')[0];
  const mijnLadders = isCoordinatorRol()
    ? alleLadders
    : alleLadders.filter(l => (l.spelers || []).some(s => s.naam.toLowerCase().includes(voornaam)));
  const h1Second = document.getElementById('h1-second');
  if (h1Second) {
    const alleenHeerendag = mijnLadders.length === 1 &&
      mijnLadders[0].naam.toLowerCase().includes('heerendag');
    h1Second.textContent = alleenHeerendag
      ? ` ${mijnLadders[0].naam} Ladder`
      : ' MP Ladder';
  }
}

function vervolgIngelogd() {
  document.getElementById('login-scherm').classList.remove('actief');
  document.getElementById('login-fout').style.display = 'none';
  document.getElementById('login-pass').value = '';

  const adminBtn = document.getElementById('nav-admin-btn');
  const profielBtn = document.getElementById('nav-profiel-btn');
  const logoutBtn = document.getElementById('logout-btn');
  if (huidigeBruiker.rol === 'beheerder' || huidigeBruiker.rol === 'coordinator') {
    adminBtn.style.display = '';
    document.getElementById('nav-archief-btn').style.display = '';
    document.getElementById('nav-toernooi-btn').style.display = '';
  } else {
    // Toon toernooi tab ook voor spelers als ze deelnemen aan een actief toernooi
    const gebruikersnaam = (huidigeBruiker.gebruikersnaam || '').toLowerCase();
    const voornaam = gebruikersnaam.split(' ')[0];
    const mijnToernooien = alleToernooien.filter(t =>
      (t.spelers || []).some(s => s.naam.toLowerCase().includes(voornaam))
    );
    if (mijnToernooien.length > 0) {
      document.getElementById('nav-toernooi-btn').style.display = '';
    }
  }
  profielBtn.style.display = '';
  logoutBtn.style.display = '';
  logoutBtn.textContent = huidigeBruiker.gebruikersnaam.split(' ')[0] + ' ↩';

  // Versienummer alleen voor beheerder
  const versieBadge = document.getElementById('versie-badge');
  if (versieBadge) versieBadge.style.display = isBeheerderRol() ? '' : 'none';

  renderLadder();
  registreerNotificatieToken();
  laadUitdagingen();

  // Pas sitetitel aan — alleen als speler uitsluitend in de Heerendag ladder zit
  updateSiteTitel();

  // Extra refresh na 2 seconden als ladder nog leeg is (race condition bij inloggen)
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
  const email = document.getElementById('login-email').value.trim();
  const wachtwoord = document.getElementById('login-pass').value;
  document.getElementById('login-fout').style.display = 'none';
  if (!email || !wachtwoord) { toonLoginFout('Vul e-mail en wachtwoord in'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, wachtwoord);
    // onAuthStateChanged handelt de rest af
  } catch(e) {
    const berichten = {
      'auth/user-not-found': 'Geen account gevonden met dit e-mailadres',
      'auth/wrong-password': 'Onjuist wachtwoord',
      'auth/invalid-email': 'Ongeldig e-mailadres',
      'auth/too-many-requests': 'Te veel pogingen, probeer later opnieuw',
      'auth/invalid-credential': 'E-mail of wachtwoord onjuist',
    };
    toonLoginFout(berichten[e.code] || 'Inloggen mislukt, probeer opnieuw');
  }
}

async function loginMetGoogle() {
  document.getElementById('login-fout').style.display = 'none';
  try {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged handelt de rest af
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      toonLoginFout('Google inloggen mislukt, probeer opnieuw');
    }
  }
}

function uitloggen() {
  // Stop alle Firestore listeners voor uitloggen
  _vasteListeners.forEach(unsub => unsub());
  store._vasteListeners = [];
  _toernooiListeners.forEach(unsub => unsub());
  store._toernooiListeners = [];
  signOut(auth);
  store.huidigeBruiker = null;
  document.getElementById('login-scherm').classList.add('actief');
  document.getElementById('nav-admin-btn').style.display = 'none';
  document.getElementById('nav-archief-btn').style.display = 'none';
  document.getElementById('nav-toernooi-btn').style.display = 'none';
  document.getElementById('nav-profiel-btn').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'none';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-ladder').classList.add('active');
  document.querySelector('nav button').classList.add('active');
}

function openWachtwoordVergeten() {
  const email = document.getElementById('login-email').value || '';
  document.getElementById('reset-email').value = email;
  document.getElementById('reset-wrap').style.display = 'block';
}

function sluitResetWrap() {
  document.getElementById('reset-wrap').style.display = 'none';
}

async function stuurResetEmail() {
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { toast('Voer een e-mailadres in'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    sluitResetWrap();
    toast('Reset-link verstuurd! Check je e-mail ✓');
  } catch(e) {
    toast('Kon e-mail niet versturen — controleer het adres');
  }
}

function openWachtwoordWijzigen() {
  document.getElementById('huidig-wachtwoord').value = '';
  document.getElementById('nieuw-wachtwoord').value = '';
  document.getElementById('bevestig-wachtwoord').value = '';
  document.getElementById('modal-wachtwoord-wijzigen').classList.add('open');
}

async function wijzigWachtwoord() {
  alert('wijzigWachtwoord aangeroepen');
  const huidig = document.getElementById('huidig-wachtwoord').value;
  const nieuw = document.getElementById('nieuw-wachtwoord').value;
  const bevestig = document.getElementById('bevestig-wachtwoord').value;
  if (!huidig) { toast('Voer je huidige wachtwoord in'); return; }
  if (nieuw.length < 4) { toast('Nieuw wachtwoord minimaal 4 tekens'); return; }
  if (nieuw !== bevestig) { toast('Wachtwoorden komen niet overeen'); return; }
  if (nieuw === huidig) { toast('Nieuw wachtwoord moet anders zijn'); return; }
  toast('Bezig...');
  try {
    const user = auth.currentUser;
    if (!user) { toast('Niet ingelogd'); return; }
    // Eerst reauth proberen
    try {
      const credential = EmailAuthProvider.credential(user.email, huidig);
      await reauthenticateWithCredential(user, credential);
    } catch(reAuthErr) {
      toast('Huidig wachtwoord onjuist (' + reAuthErr.code + ')');
      return;
    }
    // Dan wachtwoord updaten
    await updatePassword(user, nieuw);
    document.getElementById('huidig-wachtwoord').value = '';
    document.getElementById('nieuw-wachtwoord').value = '';
    document.getElementById('bevestig-wachtwoord').value = '';
    closeModal('modal-wachtwoord-wijzigen');
    toast('Wachtwoord gewijzigd ✓');
  } catch(e) {
    toast('Wijzigen mislukt: ' + e.code);
  }
}

// Sla actieve ladder op naar Firestore
async function slaState() {
  try {
    if (activeLadderId) {
      await setDoc(doc(db, 'ladders', activeLadderId), JSON.parse(JSON.stringify(state)));
    } else {
      await setDoc(STATE_DOC, JSON.parse(JSON.stringify(state)));
    }
  } catch(e) { console.error('Firestore save error:', e); }
}

// Initieel laden + live listener instellen
async function initFirestore() {
  toonLaadOverlay(true);
  try {
    const [baanSnap, archiefSnap, uitdSnap, toernooiSnap, spelersSnap, volgordeSnap] = await Promise.all([
      getDoc(BANEN_DOC),
      getDoc(ARCHIEF_DOC),
      getDoc(UITDAGINGEN_DOC),
      getDoc(TOERNOOI_DOC), // legacy
      getDoc(SPELERS_DOC),
      getDoc(doc(db, 'ladder', 'ladderVolgorde'))
    ]);

    aangepasteBanen = baanSnap.exists() ? (baanSnap.data().lijst || []) : [];
    store.archiefData = archiefSnap.exists() ? (archiefSnap.data().seizoenen || []) : [];
    store.uitdagingenData = uitdSnap.exists() ? (uitdSnap.data().lijst || []) : [];
    store.alleSpelersData = spelersSnap.exists() ? (spelersSnap.data().lijst || []) : [];
    const ladderVolgorde = volgordeSnap.exists() ? (volgordeSnap.data().volgorde || []) : [];

    // Laad alle actieve toernooien
    const toernooienSnap = await getDocs(query(TOERNOOIEN_COL, where('status', '==', 'actief')));
    store.alleToernooien = toernooienSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Legacy migratie: als er een oud toernooi is, migreer naar collectie
    if (toernooiSnap.exists() && toernooiSnap.data().status === 'actief' && alleToernooien.length === 0) {
      const legacyData = { ...toernooiSnap.data() };
      const newRef = await addDoc(TOERNOOIEN_COL, legacyData);
      store.alleToernooien = [{ id: newRef.id, ...legacyData }];
      await setDoc(TOERNOOI_DOC, { status: 'gemigreerd' });
    }
    // Zet eerste toernooi actief als er één is
    if (alleToernooien.length > 0) {
      store.toernooiData = alleToernooien[0];
      store.actieveToernooiId = alleToernooien[0].id;
    }

    // Laad ladders
    const laddersSnap = await getDocs(LADDERS_COL);

    const stateSnap = await getDoc(STATE_DOC);

    // Controleer of de MP ladder al bestaat met spelers
    const mpDoc = laddersSnap.docs.find(d => d.id === 'mp');
    const mpHeeftSpelers = mpDoc && (mpDoc.data().spelers || []).length > 0;

    if (!mpHeeftSpelers) {
      // Migreer bestaande state naar ladder "MP"
      const bestaandeState = stateSnap.exists() ? stateSnap.data() : JSON.parse(JSON.stringify(DEFAULT_STATE));
      if (!bestaandeState.actievePartijen) {
        bestaandeState.actievePartijen = bestaandeState.actievePartij
          ? [{ ...bestaandeState.actievePartij, partijId: `p_${Date.now()}` }] : [];
        delete bestaandeState.actievePartij;
      }
      if (!bestaandeState.spelers) bestaandeState.spelers = [];
      // Sla master spelerslijst op
      if (alleSpelersData.length === 0 && bestaandeState.spelers.length > 0) {
        store.alleSpelersData = bestaandeState.spelers.map(s => ({ id: s.id, naam: s.naam, hcp: s.hcp }));
        await setDoc(SPELERS_DOC, { lijst: alleSpelersData });
      }
      const mpRef = doc(db, 'ladders', 'mp');
      await setDoc(mpRef, { ...bestaandeState, naam: 'MP', spelerIds: bestaandeState.spelers.map(s => s.id) });
      store.alleLadders = [{ id: 'mp', naam: 'MP', spelerIds: bestaandeState.spelers.map(s => s.id), spelers: bestaandeState.spelers, actievePartijen: bestaandeState.actievePartijen }];
      // Voeg eventuele andere bestaande ladders toe
      laddersSnap.docs.filter(d => d.id !== 'mp').forEach(d => {
        alleLadders.push({ id: d.id, naam: d.data().naam, spelerIds: d.data().spelerIds || [], spelers: d.data().spelers || [], actievePartijen: d.data().actievePartijen || [] });
      });
      store.state = bestaandeState;
      store.activeLadderId = 'mp';
    } else {
      // Laad alle ladders inclusief spelers en type
      store.alleLadders = laddersSnap.docs.map(d => ({ 
        id: d.id, 
        naam: d.data().naam,
        type: d.data().type || 'ranking',
        spelerIds: d.data().spelerIds || [],
        spelers: d.data().spelers || [],
        actievePartijen: d.data().actievePartijen || [],
        config: d.data().config || null,
        data: d.data()
      }));
      // Sorteer op opgeslagen volgorde
      if (ladderVolgorde.length > 0) {
        alleLadders.sort((a, b) => {
          const ai = ladderVolgorde.indexOf(a.id);
          const bi = ladderVolgorde.indexOf(b.id);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
      // Zet MP als actief, anders de eerste
      const mpDoc = laddersSnap.docs.find(d => d.id === 'mp');
      const actief = mpDoc || laddersSnap.docs[0];
      store.state = actief.data();
      if (!state.actievePartijen) state.actievePartijen = [];
      store.activeLadderId = actief.id;
    // Als master spelerslijst leeg is, opbouwen vanuit alle ladders
    if (alleSpelersData.length === 0) {
      const gezien = new Set();
      alleLadders.forEach(l => {
        (l.spelers || []).forEach(s => {
          if (!gezien.has(s.id)) {
            gezien.add(s.id);
            alleSpelersData.push({ id: s.id, naam: s.naam, hcp: s.hcp });
          }
        });
      });
      if (alleSpelersData.length > 0) {
        await setDoc(SPELERS_DOC, { lijst: alleSpelersData });
      }
    }
    }

  } catch(e) {
    console.error('Firestore init error:', e);
  }

  // Live listener op actieve ladder
  if (activeLadderId) {
    _vasteListeners.push(onSnapshot(doc(db, 'ladders', activeLadderId), (snap) => {
      if (!snap.exists() || !huidigeBruiker) return;
      store.state = snap.data();
      if (!state.actievePartijen) state.actievePartijen = [];
      const idx = alleLadders.findIndex(l => l.id === activeLadderId);
      if (idx >= 0) { alleLadders[idx].spelers = state.spelers || []; alleLadders[idx].actievePartijen = state.actievePartijen; }
      const activePage = document.querySelector('.page.active')?.id?.replace('page-','');
      if (activePage === 'ladder') renderLadder();
      if (activePage === 'uitslagen') renderUitslagen();
      if (activePage === 'admin') renderAdmin();
      if (activePage === 'ronde') renderRonde();
      if (activePage === 'profiel') renderProfiel();
      if (activePage === 'toernooi') renderToernooi();
      updateSiteTitel();
    }));
  }

  // Live listeners op alle andere ladders
  alleLadders.filter(l => l.id !== activeLadderId).forEach(ladder => {
    _vasteListeners.push(onSnapshot(doc(db, 'ladders', ladder.id), (snap) => {
      if (!snap.exists() || !huidigeBruiker) return;
      const idx = alleLadders.findIndex(l => l.id === ladder.id);
      if (idx >= 0) {
        alleLadders[idx].spelers = snap.data().spelers || [];
        alleLadders[idx].data = snap.data(); // volledige data cachen voor knockout bracket
      }
      const activePage = document.querySelector('.page.active')?.id?.replace('page-','');
      if (activePage === 'ladder') renderLadder();
      if (activePage === 'admin') renderAdmin();
      if (activePage === 'profiel') renderProfiel();
      updateSiteTitel();
    }));
  });

  // Live listener op master spelerslijst
  _vasteListeners.push(onSnapshot(SPELERS_DOC, (snap) => {
    if (!snap.exists() || !huidigeBruiker) return;
    store.alleSpelersData = snap.data().lijst || [];
    const activePage = document.querySelector('.page.active')?.id?.replace('page-','');
    if (activePage === 'admin') renderAdmin();
  }));

  store._firestoreReady = true;

  // Start Auth listener nu Firestore data klaar is
  onAuthStateChanged(auth, async (user) => {
    if (_bezigMetRegistratie) return;
    toonLaadOverlay(false);
    if (user) {
      // Niet opnieuw inloggen als al ingelogd (bijv. bij token refresh)
      if (huidigeBruiker && huidigeBruiker.uid === user.uid) return;
      await setIngelogd(user);
    } else {
      store.huidigeBruiker = null;
      const heeftInvite = new URLSearchParams(location.search).has('invite');
      if (heeftInvite) {
        await checkInviteLink();
      } else {
        document.getElementById('login-scherm').classList.add('actief');
      }
    }
  });
}

// Wissel naar een andere ladder
async function wisselLadder(ladderId) {

  try {
  if (ladderId === activeLadderId) return;
  const snap = await getDoc(doc(db, 'ladders', ladderId));
  if (!snap.exists()) return;
  store.activeLadderId = ladderId;
  store.state = snap.data();
  if (!state.actievePartijen) state.actievePartijen = [];
  renderLadder();
  renderUitslagen();
  } catch(e) { console.error('wisselLadder mislukt:', e); }
}

function toonLaadOverlay(toon) {
  document.getElementById('laad-overlay').style.display = toon ? 'flex' : 'none';
}

let playerSlotCount = 0;

// ============================================================

// ============================================================
//  UITNODIGINGSLINK & REGISTRATIE
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
    store._bezigMetRegistratie = true;
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

    store._bezigMetRegistratie = false;
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
    store._bezigMetRegistratie = false;
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

// ============================================================
//  HELPER FUNCTIES (gedeeld tussen modules)
// ============================================================

async function getUsers(forceFresh = false) {
  if (!forceFresh && _usersCache !== null) return _usersCache;
  try {
    const snap = await getDoc(USERS_DOC);
    _usersCache = snap.exists() ? (snap.data().lijst || []) : [];
  } catch(e) { console.error('getUsers mislukt:', e); _usersCache = _usersCache || []; }
  return _usersCache;
}
async function saveUsers(lijst) {
  _usersCache = lijst;
  try { await setDoc(USERS_DOC, { lijst }); }
  catch(e) { console.error('saveUsers mislukt:', e); }
}
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
function getNextId() {
  // Centrale ID teller — altijd hoger dan hoogste bekende ID
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
function registreerNotificatieToken() {}  // uitgeschakeld

function vraagNotificatieToestemming() {
  toast('Notificaties worden ondersteund in een toekomstige versie');
}
async function laadUitdagingen() {

  try {
  if (!huidigeBruiker) return;
  const snap = await getDoc(UITDAGINGEN_DOC);
  uitdagingenData = snap.exists() ? (snap.data().lijst || []) : [];
  toonUitdagingBadge();
  } catch(e) { console.error('laadUitdagingen mislukt:', e); }
}

// ============================================================
//  EXPORTS
// ============================================================
// initApp = entry point voor app.js
function initApp() { initFirestore(); }

export {
  initApp, initFirestore, setIngelogd, vervolgIngelogd,
  uitloggen, loginSubmit, loginMetGoogle,
  openWachtwoordVergeten, sluitResetWrap, stuurResetEmail,
  openWachtwoordWijzigen, wijzigWachtwoord,
  slaState, wisselLadder, toonLaadOverlay,
  getUsers, saveUsers, getLadderData, getLadderConfig,
  updateSiteTitel, toonLoginFout,
  genereerInviteLink, kopieerInviteLink, checkInviteLink,
  registreerSpeler, laadInviteStatus, autoAdvance,
  getNextId, isCoordinatorRol, isBeheerderRol,
  toast, registreerNotificatieToken, laadUitdagingen
};
