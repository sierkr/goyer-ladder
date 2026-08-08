// ============================================================
//  auth.js — v3.0.0 — uid-architectuur volledig
//  Primaire identifier: Firebase Auth uid
//  Bron van waarheid:   spelers/{uid} (profiel), standen/{uid} (ranking)
// ============================================================
import { db, auth, googleProvider, STATE_DOC, USERS_DOC,
  BANEN_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, TOERNOOI_DOC, TOERNOOIEN_COL,
  INVITE_DOC, SNAPSHOTS_COL, LADDERS_COL, DEFAULT_STATE, BANEN_DB_MIGRATIE, esc, escAttr,
  EMAIL_SUFFIX, DEFAULT_HCP, CONFIG_DOC, laadInitieelWachtwoord,
  laadUiStijl, pasUiStijlToe,
  genereerEmail, loginNaamVan, functions, httpsCallable } from './config.js';
import { store, DEFAULT_LADDER_CONFIG,
  alleLadders, activeLadderId, alleSpelersData, huidigeBruiker,
  _usersCache, archiefData, uitdagingenData, toernooiData, alleToernooien,
  actieveToernooiId, _firestoreReady, _vasteListeners, _toernooiListeners,
  _bezigMetRegistratie, playerSlotCount, _verwijderdePartijIds } from './store.js';
import { renderLadder } from './ladder.js';
import { toonUitdagingBadge } from './archief.js';
import { closeModal, renderAdmin, renderProfiel } from './admin.js';
import { renderRonde } from './ronde.js';
import { renderToernooi, getActiefToernooiMetModus, herlaadToernooiListeners } from './toernooi.js';
import { renderUitslagen } from './uitslagen.js';
import { startAlleStandenListeners, stopAlleStandenListeners,
         startStandenWachthond } from './ladder-view.js';

import * as S from './store.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc,
  deleteDoc, getDocs, addDoc, query, where, orderBy, writeBatch }
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
    toernooiSpeler: profiel.toernooiSpeler === true, // v3.0.0-11.74
    toernooiNaam:   profiel.toernooiNaam   || null,  // v3.0.0-11.74
    // v4.2.0: puntensysteem — alleen dit account ziet/wijzigt de ruwe punten.
    // Wordt uitsluitend handmatig gezet in de Firebase console (spelers/{uid}),
    // nooit via de app zelf. Ook technisch afgedwongen in firestore.rules.
    puntenBeheerder: profiel.puntenBeheerder === true,
  };

  vervolgIngelogd();
}

function updateSiteTitel() {
  if (!huidigeBruiker) return;
  const h1First  = document.getElementById('h1-first');
  const h1Second = document.getElementById('h1-second');
  if (!h1Second) return;

  // v3.0.0-11.74: toernooiSpeler-vlag op profiel heeft prioriteit — toont de toernooijnaam
  // die bij aanmaken is meegegeven. Onafhankelijk van de globale toernooi-modus checkbox,
  // zodat andere ladder-spelers de normale titelbalk zien.
  if (huidigeBruiker.toernooiSpeler && huidigeBruiker.toernooiNaam) {
    if (h1First) h1First.style.display = 'none';
    h1Second.textContent = `🏌️ ${huidigeBruiker.toernooiNaam}`;
    h1Second.style.paddingLeft = '0';
    return;
  }

  // Coordinator/beheerder of gewone deelnemer in toernooi-modus: toon toernooinaam
  // v3.0.0-11.74: ook gewone spelers die deelnemen aan toernooi met toernooiModus aan
  const actiefToernooi = getActiefToernooiMetModus();
  if (actiefToernooi) {
    const isDeelnemer = isCoordinatorRol() ||
      (actiefToernooi.spelers || []).some(s => s.uid === huidigeBruiker.uid);
    if (isDeelnemer) {
      if (h1First) h1First.style.display = 'none';
      h1Second.textContent = '🏌️ ' + actiefToernooi.naam;
      h1Second.style.paddingLeft = '0';
      return;
    }
  }

  // Herstel normale staat
  if (h1First) { h1First.style.display = ''; }
  h1Second.style.paddingLeft = '';

  const uid = huidigeBruiker.uid;
  const mijnLadders = isCoordinatorRol()
    ? alleLadders
    : alleLadders.filter(l => uid && (l.spelerIds || []).includes(uid));
  const alleenHeerendag = mijnLadders.length === 1 &&
    mijnLadders[0].naam.toLowerCase().includes('heerendag');
  h1Second.textContent = alleenHeerendag
    ? ` ${mijnLadders[0].naam} Ladder`
    : ' MP Ladder';
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
  const btnEl   = document.querySelector('#modal-eerste-login .btn-primary');
  foutEl.style.display = 'none';

  const hcp   = parseFloat(hcpEl.value);
  const pass1 = pass1El.value;
  const pass2 = pass2El.value;

  if (isNaN(hcp))       { foutEl.textContent = 'Voer een geldige handicap in'; foutEl.style.display = 'block'; return; }
  if (pass1.length < 6) { foutEl.textContent = 'Wachtwoord moet minimaal 6 tekens zijn'; foutEl.style.display = 'block'; return; }
  if (pass1 !== pass2)  { foutEl.textContent = 'De wachtwoorden komen niet overeen'; foutEl.style.display = 'block'; return; }
  // v3.0.4: alleen waarschuwen als het initiële wachtwoord daadwerkelijk bekend is.
  // store.initieelWachtwoord kan leeg zijn wanneer de config-read bij koude start
  // (ongeauthenticeerd) werd geweigerd; dan slaan we deze vriendelijke hint over.
  if (store.initieelWachtwoord && pass1 === store.initieelWachtwoord) {
    foutEl.textContent = 'Kies een ander wachtwoord dan het initiële';
    foutEl.style.display = 'block'; return;
  }

  const hcpInt = Math.round(hcp);
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Bezig...'; }

  try {
    // v3.0.4: wachtwoordwijziging + profiel-update gebeurt server-side via de
    // Cloud Function voltooiEersteLogin (Admin SDK). Dit omzeilt volledig de
    // auth/requires-recent-login-fout die de oude client-side updatePassword-flow
    // trof bij een herstelde sessie (PWA-heropening / reload), en is niet
    // afhankelijk van store.initieelWachtwoord voor reauthenticatie.
    const voltooiFn = httpsCallable(functions, 'voltooiEersteLogin');
    await voltooiFn({ nieuwWachtwoord: pass1, hcp: hcpInt });

    // hcp-sync naar standen/{uid} in alle ladders waar speler in zit. Niet-kritisch:
    // fouten hier blokkeren het voltooien van de eerste-login niet meer (wachtwoord
    // en profiel zijn op dit punt al server-side vastgelegd).
    for (const ladder of alleLadders) {
      if (!(ladder.spelerIds || []).includes(huidigeBruiker.uid)) continue;
      try {
        const standenRef  = doc(db, 'ladders', ladder.id, 'standen', huidigeBruiker.uid);
        const standenSnap = await getDoc(standenRef);
        if (standenSnap.exists()) {
          await setDoc(standenRef, { ...standenSnap.data(), hcp: hcpInt });
        }
      } catch(e) {
        console.warn('hcp sync naar standen/', ladder.id, 'mislukt:', e.code);
      }
    }

    // Lokale state bijwerken en modal sluiten
    store.huidigeBruiker.eersteLogin = false;
    document.getElementById('modal-eerste-login')?.remove();
    toast('Profiel compleet ✓');
  } catch(e) {
    console.error('slaEersteLoginOp (server) mislukt:', e);
    const code = e.code || '';
    if (code === 'functions/failed-precondition') {
      foutEl.textContent = e.message || 'Configuratie ontbreekt — neem contact op met de beheerder';
    } else if (code === 'functions/invalid-argument') {
      foutEl.textContent = e.message || 'Ongeldige invoer — controleer je wachtwoord en handicap';
    } else if (code === 'functions/unauthenticated') {
      foutEl.textContent = 'Je sessie is verlopen — log opnieuw in en probeer opnieuw';
    } else if (code === 'functions/not-found') {
      foutEl.textContent = 'Je profiel is niet gevonden — neem contact op met de beheerder';
    } else {
      foutEl.textContent = 'Er is iets misgegaan: ' + (e.message || code || 'onbekende fout');
    }
    foutEl.style.display = 'block';
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Opslaan en verder'; }
  }
}

// ============================================================
//  TOERNOOI-MODUS NAV
// ============================================================
function pasToernooiModusNavToe() {
  if (!huidigeBruiker) return;
  if (isBeheerderRol() || isCoordinatorRol()) return; // beheerders altijd volledig zicht

  // v3.0.0-11.74: twee paden — toernooiSpeler-vlag op profiel (batch-import)
  // of deelnemer van een actief toernooi met toernooiModus aan.
  const isToernooiSpeler = huidigeBruiker.toernooiSpeler === true;
  const actief = getActiefToernooiMetModus();
  const isDeelnemerViaToernooiModus = actief &&
    (actief.spelers || []).some(s => s.uid === huidigeBruiker.uid);

  if (!isToernooiSpeler && !isDeelnemerViaToernooiModus) {
    // v3.0.9: geen actieve toernooi-modus (meer) → herstel de normale tabs.
    // Voorheen een early-return, waardoor eerder verborgen tabs verborgen bleven
    // en de deelnemer na einde/annulering met alleen 'Profiel' achterbleef (app onbruikbaar).
    ['ladder', 'partij', 'ronde', 'uitslagen', 'help', 'profiel'].forEach(tab => {
      const b = document.getElementById(`nav-${tab}-btn`);
      if (b) b.style.display = '';
    });
    return;
  }

  // Verberg alle tabs behalve Toernooi en Uitslag
  // v3.0.0-11.74: uitslagen verborgen — ladder-partijen zijn niet relevant voor toernooi-deelnemers
  const verbergTabs = ['ladder', 'partij', 'ronde', 'uitslagen', 'help', 'archief', 'profiel', 'admin'];
  verbergTabs.forEach(tab => {
    const idBtn = document.getElementById(`nav-${tab}-btn`);
    if (idBtn) idBtn.style.display = 'none';
  });

  // Zorg dat Toernooi actief is als huidige pagina verborgen wordt
  const actievePagina = document.querySelector('.page.active');
  const actieveId = actievePagina?.id?.replace('page-', '');
  if (actieveId && verbergTabs.includes(actieveId)) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.getElementById('page-toernooi')?.classList.add('active');
    document.getElementById('nav-toernooi-btn')?.classList.add('active');
  }

  // v3.0.9: render de toernooipagina meteen, zodat de deelnemer zijn scorekaart
  // ziet i.p.v. de standaard-HTML ("NIEUW TOERNOOI"). Voorheen werd de pagina wel
  // geactiveerd maar niet gerenderd, waardoor pas na een modus-toggle iets verscheen.
  renderToernooi();
}

// Luister naar toernooiModusGewijzigd event vanuit toernooi.js
window.addEventListener('toernooiModusGewijzigd', () => {
  updateSiteTitel();
  pasToernooiModusNavToe();
});

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
    // v3.0.0-11.74: toernooiSpeler-vlag toont ook de toernooi-tab, ook als nog
    // niet in een toernooispelers-lijst staat (toernooi nog niet aangemaakt).
    if (mijnToernooien.length > 0 || huidigeBruiker.toernooiSpeler) {
      document.getElementById('nav-toernooi-btn').style.display = '';
    }
  }
  profielBtn.style.display = '';
  logoutBtn.style.display  = '';
  logoutBtn.textContent    = huidigeBruiker.gebruikersnaam.split(' ')[0] + ' ↩';

  const versieBadge = document.getElementById('versie-badge');
  if (versieBadge) versieBadge.style.display = isBeheerderRol() ? '' : 'none';

  // v3.0.0-11.74: herstart per-doc toernooi-listeners na login zodat ze
  // huidigeBruiker correct hebben voor scoresVerborgen, toernooiModus etc.
  herlaadToernooiListeners();

  // Pas toernooi-modus nav toe (verbergt tabs voor deelnemers indien actief)
  pasToernooiModusNavToe();

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
  alert('Wachtwoord vergeten? Neem contact op met de beheerder.\n\nDe beheerder kan je wachtwoord resetten naar ' + store.initieelWachtwoord + ', waarna je bij eerstvolgende inlog een nieuw wachtwoord kiest.');
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

// ============================================================
//  slaActievePartijdnOp — schrijft actievePartijen van één ladder naar Firestore.
//  Vervangt de oude slaState() singleton. Elke caller geeft het ladderId mee.
//  v3.0.0-11.75: gooit de fout door zodat startPartij() weet dat de write
//  mislukt is en geen lege navigatie naar de ronde-pagina uitvoert.
// ============================================================
export async function slaActievePartijenOp(ladderId) {
  if (!ladderId) return;
  const ladder = alleLadders.find(l => l.id === ladderId);
  const actievePartijen = ladder?.actievePartijen || [];
  try {
    await setDoc(doc(db, 'ladders', ladderId), { actievePartijen }, { merge: true });
  } catch(e) {
    console.error('[slaActievePartijenOp] mislukt voor', ladderId, e);
    throw e; // laat de aanroeper (startPartij) de fout afhandelen
  }
}

// ============================================================
//  slaUitslagenOp — schrijft uitslagen van één ladder naar Firestore.
// ============================================================
export async function slaUitslagenOp(ladderId) {
  if (!ladderId) return;
  try {
    const ladder = alleLadders.find(l => l.id === ladderId);
    const uitslagen = ladder?.data?.uitslagen || ladder?.uitslagen || [];
    await setDoc(doc(db, 'ladders', ladderId), { uitslagen }, { merge: true });
  } catch(e) { console.error('[slaUitslagenOp] mislukt voor', ladderId, e); }
}

// ============================================================
//  MIGRATIE — vaste banen naar Firestore (v3.0.0-11.34)
// ============================================================
// Eenmalige migratie: schrijft de vijf hardcoded banen naar ladder/banen
// als ze er nog niet in staan (check op naam). Na de migratie doet deze
// functie niets meer. BANEN_DB_MIGRATIE mag daarna ook uit config.js.
async function migratieVasteBanen(huidigeLijst) {
  try {
    const bestaandeNamen = new Set((huidigeLijst || []).map(b => b.naam.toLowerCase()));
    const teToevoegen = BANEN_DB_MIGRATIE.filter(b => !bestaandeNamen.has(b.naam.toLowerCase()));
    if (teToevoegen.length === 0) return huidigeLijst; // niets te doen

    // Vaste banen vooraan zetten (vóór eventueel al aanwezige banen)
    const nieuweLijst = [...teToevoegen, ...huidigeLijst];
    await setDoc(BANEN_DOC, { lijst: nieuweLijst });
    console.log(`[migratie] ${teToevoegen.length} vaste baan/banen naar Firestore geschreven:`,
      teToevoegen.map(b => b.naam).join(', '));
    return nieuweLijst;
  } catch(e) {
    console.warn('[migratie] migratieVasteBanen mislukt (niet fataal):', e.code || e.message);
    return huidigeLijst; // gebruik wat er al was, app werkt gewoon door
  }
}

async function initFirestore() {
  toonLaadOverlay(true);

  const heeftInvite = new URLSearchParams(location.search).has('invite');
  if (heeftInvite) {
    toonLaadOverlay(false);
    checkInviteLink();
  }

  // v3.0.6: bepaal de auth-status VÓÓR de zware Firestore-init. authStateReady()
  // wacht tot Firebase de persistente sessie lokaal heeft ingelezen (snelle,
  // netwerkloze read). Zo weten we meteen of er een geldige (herstelde) sessie is
  // en tonen we nooit ten onrechte het loginscherm terwijl de gebruiker in feite
  // gewoon ingelogd is. Dit is het patroon van de matchcheck-app: eerst lokaal
  // beslissen, dan pas laden.
  let hersteldeSessie = false;
  try {
    await auth.authStateReady();
    hersteldeSessie = !!auth.currentUser;
  } catch(e) { console.warn('authStateReady mislukt (niet fataal):', e); }

  // v3.0.6: fallback toont het loginscherm ALLEEN als er geen invite is én
  // Firebase bevestigd heeft dat er geen gebruiker is. Bij een herstelde sessie
  // blijft de laad-overlay staan tot vervolgIngelogd() hem weghaalt — geen
  // flikkering meer. De onAuthStateChanged-handler (verderop) haalt de overlay
  // sowieso weg zodra de auth-status definitief is; de 10s-veiligheidstimer vangt
  // extreme gevallen op.
  const loginFallback = setTimeout(() => {
    if (!heeftInvite && !hersteldeSessie && !huidigeBruiker) {
      toonLaadOverlay(false);
      document.getElementById('login-scherm').classList.add('actief');
    }
  }, 3000);

  try {
    // v3.0.0-11.74: laad initieel wachtwoord parallel met overige docs
    const [baanSnap, archiefSnap, uitdSnap, toernooiSnap, volgordeSnap] =
      await Promise.all([
        getDoc(BANEN_DOC),
        getDoc(ARCHIEF_DOC),
        getDoc(UITDAGINGEN_DOC),
        getDoc(TOERNOOI_DOC),
        getDoc(doc(db, 'ladder', 'ladderVolgorde'))
      ]);
    // Geen fallback — gooit een Error als ladder/config ontbreekt of leeg is.
    // De fout bubbelt naar initApp() → toonLoginFout() zodat de beheerder actie kan ondernemen.
    await laadInitieelWachtwoord(store);

    // v4.1.0: globale UI-stijl laden en meteen toepassen (voor eerste render van
    // login/app-scherm). Faalt nooit hard — valt terug op 'club' bij problemen.
    await laadUiStijl(store);
    pasUiStijlToe(store.uiStijl);

    store.archiefData     = archiefSnap.exists()  ? (archiefSnap.data().seizoenen  || []) : [];
    store.uitdagingenData = uitdSnap.exists()      ? (uitdSnap.data().lijst         || []) : [];
    // v3.0.0-11.34: laad alle banen uit Firestore — geen hardcoded BANEN_DB meer.
    // migratieVasteBanen() schrijft de vijf vaste banen eenmalig naar Firestore
    // als ze er nog niet in staan, zodat de overgang naadloos verloopt.
    let baanLijst = baanSnap.exists() ? (baanSnap.data().lijst || []) : [];
    baanLijst = await migratieVasteBanen(baanLijst);
    store.aangepasteBanen = baanLijst;
    // v3.0.0-9c: alleSpelersData wordt niet meer uit ladder/spelers geladen.
    // Het is nu een afgeleide view van _usersCache (zie store.js) en wordt
    // gevuld zodra de spelers/ listener start na login.
    const ladderVolgorde  = volgordeSnap.exists()  ? (volgordeSnap.data().volgorde  || []) : [];

    // v3.0.0-11.74: legacy migratie (eenmalig, alleen als nodig)
    if (toernooiSnap.exists() && toernooiSnap.data().status === 'actief') {
      const migSnap = await getDocs(query(TOERNOOIEN_COL, where('status', '==', 'actief')));
      if (migSnap.empty) {
        const legacyData = { ...toernooiSnap.data() };
        const newRef = await addDoc(TOERNOOIEN_COL, legacyData);
        store.alleToernooien = [{ id: newRef.id, ...legacyData }];
        await setDoc(TOERNOOI_DOC, { status: 'gemigreerd' });
      }
    }

    // v3.0.0-11.74: vaste collectie-onSnapshot vervangt eenmalige getDocs.
    // Reageert direct bij ophalen én bij elke wijziging voor alle clients.
// v3.0.0-11.74: vaste onSnapshot op toernooien-collectie (status==actief).
  // Vervangt de eenmalige getDocs — reageert direct bij ophalen én bij elke
  // wijziging (toernooi gestart, modus aan/uit, scores verborgen, status gewijzigd).
  // Hierdoor zijn tabs, titelbalk en scorekaart altijd actueel zonder navigatie.
  // v4.1.0: live meeschakelen als de beheerder de UI-stijl wijzigt terwijl
  // deze gebruiker de app al open heeft staan (geen herlaad nodig).
  _vasteListeners.push(onSnapshot(CONFIG_DOC, (snap) => {
    if (!snap.exists()) return;
    const nieuweStijl = (snap.data().uiStijl === 'matchcheck') ? 'matchcheck' : 'club';
    if (nieuweStijl !== store.uiStijl) {
      store.uiStijl = nieuweStijl;
      pasUiStijlToe(nieuweStijl);
    }
  }));

  _vasteListeners.push(onSnapshot(
    query(TOERNOOIEN_COL, where('status', '==', 'actief')),
    (snap) => {
      store.alleToernooien = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Actief toernooi bijhouden
      if (!toernooiData && alleToernooien.length > 0) {
        store.toernooiData      = alleToernooien[0];
        store.actieveToernooiId = alleToernooien[0].id;
      } else if (toernooiData) {
        const bijgewerkt = alleToernooien.find(t => t.id === actieveToernooiId);
        if (bijgewerkt) store.toernooiData = bijgewerkt;
        else if (alleToernooien.length > 0) {
          store.toernooiData      = alleToernooien[0];
          store.actieveToernooiId = alleToernooien[0].id;
        } else {
          store.toernooiData      = null;
          store.actieveToernooiId = null;
        }
      }

      // Altijd: nav-tabs en titelbalk bijwerken op basis van actuele toestand
      if (huidigeBruiker) {
        pasToernooiModusNavToe();
        // v3.0.8: toon de Toernooi-tab alsnog zodra de toernooidata is geladen,
        // ook voor deelnemers die al ingelogd waren voordat het toernooi bestond.
        // Voorheen werd de tab alleen bij inloggen bepaald (race met deze listener),
        // waardoor de tab verborgen bleef en niets hem daarna alsnog toonde.
        const tBtn = document.getElementById('nav-toernooi-btn');
        if (tBtn && !isBeheerderRol() && !isCoordinatorRol()) {
          const uid = huidigeBruiker.uid;
          const isDeelnemer = (alleToernooien || []).some(t =>
            (t.spelers || []).some(s => uid && s.uid === uid)
          );
          if (isDeelnemer || huidigeBruiker.toernooiSpeler) tBtn.style.display = '';
        }
        updateSiteTitel();
      }

      // Herlaad toernooi-listeners (per-doc onSnapshots voor scores etc.)
      // maar alleen als de collectie daadwerkelijk veranderd is
      herlaadToernooiListeners();

      // Als de Toernooi-tab actief is én gebruiker ingelogd: herrender
      // v3.0.0-11.74: geen render zonder huidigeBruiker — isCoordinatorRol() geeft
      // dan false terug waardoor setup ten onrechte zichtbaar of verborgen kan worden
      const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
      if (ap === 'toernooi' && huidigeBruiker) renderToernooi();
    },
    (err) => { console.warn('toernooien collectie listener error:', err.code); }
  ));

    const laddersSnap = await getDocs(LADDERS_COL);

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
      // v3.0.0-11.51: spelers[] niet meer leidend — standen/{uid} is de bron
      const mpRef = doc(db, 'ladders', 'mp');
      await setDoc(mpRef, {
        ...bestaandeState,
        naam: 'MP',
        spelerIds: bestaandeState.spelerIds || (bestaandeState.spelers || []).map(s => s.uid || s.id).filter(Boolean),
      });
      store.alleLadders    = [{ id: 'mp', naam: 'MP',
        spelerIds: bestaandeState.spelerIds || [],
        actievePartijen: bestaandeState.actievePartijen,
        data: bestaandeState }];
      laddersSnap.docs.filter(d => d.id !== 'mp').forEach(d => {
        alleLadders.push({ id: d.id, naam: d.data().naam,
          spelerIds: d.data().spelerIds || [],
          actievePartijen: d.data().actievePartijen || [],
          data: d.data() });
      });
      store.activeLadderId = 'mp';
    } else {
      store.alleLadders = laddersSnap.docs.map(d => ({
        id: d.id, naam: d.data().naam,
        type:            d.data().type            || 'ranking',
        spelerIds:       d.data().spelerIds       || [],
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
      store.activeLadderId = actief.id;

      // v3.0.0-9c: tweede migratieblok (ladders→alleSpelersData→SPELERS_DOC) verwijderd.
      // alleSpelersData wordt nu rechtstreeks afgeleid van _usersCache.
    }
  } catch(e) { console.error('Firestore init error:', e); }

  clearTimeout(loginFallback);

  // ── v5.3.1: standen-listeners starten zodra de ladders bekend zijn ──
  // WAT ER MIS WAS: startAlleStandenListeners() werd alleen aangeroepen vanuit
  // onAuthStateChanged. Die handler kan vuren VOORDAT getDocs(LADDERS_COL)
  // klaar is — en dan loopt `alleLadders.forEach(...)` over een lege lijst,
  // start er geen enkele listener, en wordt dat nooit opnieuw geprobeerd.
  // Het gevolg: de standen-cache blijft leeg, getLadderSpelers() geeft voor
  // iedereen rang 0 terug en de ladder verschijnt alfabetisch met 0P/0W.
  // Bij een eerste login is die race het waarschijnlijkst, omdat de
  // profielflow de volgorde verschuift.
  // startStandenListener() is idempotent, dus dit tweede aanroeppunt is
  // veilig en dekt beide volgordes af.
  startAlleStandenListeners();

  // ── Live listeners: alle ladders gelijkwaardig ─────────────
  // Elke ladder heeft zijn eigen onSnapshot die alleLadders[idx] bijhoudt.
  // Er is geen "primaire" of "actieve" ladder-listener meer.
  alleLadders.forEach(ladder => {
    _vasteListeners.push(onSnapshot(doc(db, 'ladders', ladder.id), (snap) => {
      if (!snap.exists() || !huidigeBruiker) return;
      const data = snap.data();
      const idx  = alleLadders.findIndex(l => l.id === ladder.id);
      if (idx < 0) return;

      const actieveInSnap = data.actievePartijen || [];
      // v3.0.0-11.75: Guard beschermt ook als snapshot leeg is maar lokaal
      // nog niet-verwijderde partijen aanwezig zijn (bijv. optimistische
      // write die server nog niet bevestigd heeft, of Firestore-revert na
      // rechten-fout). Eerder faalde de guard bij actieveInSnap.length===0
      // waardoor lokale staat altijd werd overschreven — ook direct na
      // startPartij() — waarna de partij niet in de ronde verscheen.
      const lokaalNietVerwijderd = (alleLadders[idx].actievePartijen || [])
        .some(p => !_verwijderdePartijIds.has(p.partijId));
      const snapAllesVerwijderd = actieveInSnap.length === 0 ||
        actieveInSnap.every(p => _verwijderdePartijIds.has(p.partijId));
      if (lokaalNietVerwijderd && snapAllesVerwijderd) return;

      alleLadders[idx].spelerIds       = data.spelerIds       || [];
      alleLadders[idx].actievePartijen = actieveInSnap;
      alleLadders[idx].data            = data;

      const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
      if (ap === 'ladder')   renderLadder();
      if (ap === 'uitslagen') renderUitslagen();
      if (ap === 'admin')    renderAdmin();
      if (ap === 'ronde')    renderRonde();
      if (ap === 'profiel')  renderProfiel();
      if (ap === 'toernooi' && huidigeBruiker) renderToernooi(); // v3.0.0-11.74
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
      // v3.0.4: (her)laad het initiële wachtwoord nu de gebruiker ingelogd is.
      // Bij een koude start draait initFirestore() ongeauthenticeerd, waardoor de
      // config-read wordt geweigerd en store.initieelWachtwoord leeg blijft. Dat
      // veroorzaakte o.a. de "reset naar null"-weergave in het beheerscherm en de
      // lege eerste-login-hint. Fout is niet fataal (config is beheerder-context).
      if (!store.initieelWachtwoord) {
        try { await laadInitieelWachtwoord(store); }
        catch(e) { console.warn('herladen initieelWachtwoord na login mislukt:', e.code || e.message); }
      }
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
      // v5.4.1: controleer of de standen ook echt binnenkomen en herstel
      // vanzelf als dat niet zo is. Zie de toelichting in ladder-view.js.
      startStandenWachthond();
    } else {
      store.huidigeBruiker = null;
      const heeftInvite = new URLSearchParams(location.search).has('invite');
      if (heeftInvite) { await checkInviteLink(); }
      else { document.getElementById('login-scherm').classList.add('actief'); }
    }
  });
}

function wisselLadder(ladderId) {
  // activeLadderId is nu een puur UI-hint — beïnvloedt geen data.
  // Alle ladder-data zit in alleLadders[] en wordt live bijgehouden via onSnapshot.
  if (ladderId === activeLadderId) return;
  store.activeLadderId = ladderId;
  renderLadder();
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
// Auto-genereert email uit voornaam+achternaam, gebruikt store.initieelWachtwoord.
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
  const pass  = store.initieelWachtwoord;
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
    const ladderData = ladderSnap.exists() ? ladderSnap.data() : {};
    ladderData.spelerIds = ladderData.spelerIds || [];

    // Rank = huidige aantal standen + 1
    const standenSnap = await getDocs(collection(db, 'ladders', targetLadderId, 'standen'));
    const newRank = standenSnap.size + 1;

    // Stap 4-7: ladder toewijzen — vereist actieve invite of coordinator rechten
    try {
      // Stap 4: standen/{uid} aanmaken
      await setDoc(doc(db, 'ladders', targetLadderId, 'standen', uid),
        { rank: newRank, partijen: 0, gewonnen: 0 });

      // Stap 5: spelerIds bijwerken via merge — nooit heel document herschrijven
      if (!ladderData.spelerIds.includes(uid)) {
        ladderData.spelerIds = [...ladderData.spelerIds, uid];
      }
      await setDoc(doc(db, 'ladders', targetLadderId), { spelerIds: ladderData.spelerIds }, { merge: true });
    } catch(ladderErr) {
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
          wachtwoord: <strong>${esc(store.initieelWachtwoord)}</strong>
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
  const tabIdx = parseInt(input.getAttribute('tabindex'));
  if (!tabIdx) {
    const inputs = Array.from(document.querySelectorAll('input[type=number]'));
    const idx    = inputs.indexOf(input);
    if (idx >= 0 && idx < inputs.length - 1) { inputs[idx + 1].focus(); inputs[idx + 1].select(); }
    return;
  }
  const next = document.querySelector(`input[tabindex="${tabIdx + 1}"]`);
  if (next) { next.focus(); next.select(); }
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

function getLadderConfig(ladderId) {
  const id = ladderId || activeLadderId;
  return alleLadders.find(l => l.id === id)?.config || DEFAULT_LADDER_CONFIG;
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
        // v5.4.1: geen "ververs de pagina" meer. In de app op het beginscherm
        // van een telefoon is er geen adresbalk en geen verversknop. We bieden
        // een knop die het opnieuw probeert; die werkt overal.
        toonLoginFout('Geen verbinding met de server.');
        const fout = document.getElementById('login-fout');
        if (fout && !document.getElementById('opnieuw-verbinden-btn')) {
          const knop = document.createElement('button');
          knop.id = 'opnieuw-verbinden-btn';
          knop.className = 'btn btn-sm btn-ghost';
          knop.style.cssText = 'margin-top:10px';
          knop.textContent = '↻ Opnieuw proberen';
          knop.onclick = () => {
            knop.disabled = true;
            knop.textContent = '↻ Bezig…';
            retries = 0;
            toonLaadOverlay(true);
            tryInit().finally(() => { try { knop.remove(); } catch(_) {} });
          };
          fout.appendChild(knop);
        }
      }
    }
  }
  tryInit();
}

// ============================================================
//  EXPORTS — identiek aan v2.5.x voor volledige backward compat
// ============================================================
// ============================================================
//  LADDER-INTEGRITEIT — v3.0.0-11.105
//  Houdt spelerIds[] (wie doet mee) en de standen/{uid}-subcollectie
//  (wie heeft een rang) consistent, en garandeert dat rangen een schone
//  permutatie 1..N zijn (geen gaten, geen duplicaten, geen wees-standen).
// ============================================================

// Hercompacteer de rangen van een ladder naar 1..N op volgorde van de huidige
// rang. Schrijft uitsluitend gewijzigde rank-velden (merge). Kan een bestaande
// batch meekrijgen; anders wordt er zelf een batch gecommit.
// Returnt het aantal gewijzigde standen.
export async function normaliseerLadderRangen(ladderId, externeBatch = null) {
  const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
  const rijen = standenSnap.docs.map(d => ({ uid: d.id, rank: (d.data().rank || 0) }));
  // Sorteer op huidige rang; rang 0 / ontbrekend gaat achteraan, stabiel op uid.
  rijen.sort((a, b) => {
    const ra = a.rank > 0 ? a.rank : Infinity;
    const rb = b.rank > 0 ? b.rank : Infinity;
    return ra - rb || (a.uid < b.uid ? -1 : 1);
  });
  const batch = externeBatch || writeBatch(db);
  let gewijzigd = 0;
  rijen.forEach((r, i) => {
    const nieuw = i + 1;
    if (r.rank !== nieuw) {
      batch.set(doc(db, 'ladders', ladderId, 'standen', r.uid), { rank: nieuw }, { merge: true });
      gewijzigd++;
    }
  });
  if (!externeBatch) await batch.commit();
  return gewijzigd;
}

// Read-only integriteitsrapport voor één ladder.
// Returnt { weesStanden, ontbrekendeStanden, spelerIdsZonderProfiel, rangGaten,
//           rangDuplicaten, aantalSpelerIds, aantalStanden }.
export async function ladderIntegriteitsRapport(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  const spelerIds = (ladder?.data?.spelerIds || ladder?.spelerIds || [])
    .filter(id => typeof id === 'string' && id.length > 10);
  const spelerIdSet = new Set(spelerIds);

  const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
  const standUids = standenSnap.docs.map(d => d.id);
  const standUidSet = new Set(standUids);
  const rangen = standenSnap.docs
    .filter(d => spelerIdSet.has(d.id))           // alleen geldige leden tellen voor rang-checks
    .map(d => d.data().rank || 0);

  // Wees-standen: stand-document waarvan de uid niet (meer) in spelerIds zit.
  const weesStanden = standUids.filter(uid => !spelerIdSet.has(uid));
  // Ontbrekende standen: speler die meedoet maar geen stand-document heeft.
  const ontbrekendeStanden = spelerIds.filter(uid => !standUidSet.has(uid));
  // spelerIds zonder profiel in _usersCache.
  const profielUids = new Set((_usersCache || []).map(u => u.uid));
  const spelerIdsZonderProfiel = spelerIds.filter(uid => !profielUids.has(uid));

  // Rang-gaten / duplicaten: voor de geldige leden moeten de rangen 1..M zijn.
  const M = spelerIds.length;
  const gezien = {};
  let rangDuplicaten = [];
  for (const r of rangen) gezien[r] = (gezien[r] || 0) + 1;
  rangDuplicaten = Object.entries(gezien).filter(([r, n]) => n > 1).map(([r]) => Number(r));
  let rangGaten = false;
  for (let i = 1; i <= M; i++) { if (!gezien[i]) { rangGaten = true; break; } }
  // Ook standen met rang 0 of buiten 1..M tellen als probleem.
  const rangBuitenBereik = rangen.some(r => r < 1 || r > M);

  return {
    weesStanden, ontbrekendeStanden, spelerIdsZonderProfiel,
    rangGaten: rangGaten || rangBuitenBereik, rangDuplicaten,
    aantalSpelerIds: spelerIds.length, aantalStanden: standUids.length,
    schoon: weesStanden.length === 0 && ontbrekendeStanden.length === 0 &&
            spelerIdsZonderProfiel.length === 0 && !rangGaten && !rangBuitenBereik &&
            rangDuplicaten.length === 0,
  };
}

// Herstel de integriteit van één ladder atomair: verwijder wees-standen, maak
// ontbrekende standen aan (achteraan), en normaliseer daarna de rangen.
// Returnt een korte samenvatting van wat er is gedaan.
export async function herstelLadderIntegriteit(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  const spelerIds = (ladder?.data?.spelerIds || ladder?.spelerIds || [])
    .filter(id => typeof id === 'string' && id.length > 10);
  const spelerIdSet = new Set(spelerIds);

  const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
  const standUidSet = new Set(standenSnap.docs.map(d => d.id));

  const batch = writeBatch(db);
  let weesVerwijderd = 0, standenAangemaakt = 0;

  // 1) Wees-standen verwijderen.
  for (const d of standenSnap.docs) {
    if (!spelerIdSet.has(d.id)) { batch.delete(doc(db, 'ladders', ladderId, 'standen', d.id)); weesVerwijderd++; }
  }
  // 2) Ontbrekende standen aanmaken (rang krijgen ze bij de normalisatie hieronder).
  let volg = standenSnap.size + 1;
  for (const uid of spelerIds) {
    if (!standUidSet.has(uid)) {
      batch.set(doc(db, 'ladders', ladderId, 'standen', uid), { rank: volg++, partijen: 0, gewonnen: 0 });
      standenAangemaakt++;
    }
  }
  await batch.commit();

  // 3) Rangen hercompacteren naar 1..N (eigen batch).
  const rangenGewijzigd = await normaliseerLadderRangen(ladderId);

  return { weesVerwijderd, standenAangemaakt, rangenGewijzigd };
}

// ============================================================
//  RESUME-REFRESH — v3.0.6
//  Op iOS bevriest de Firestore-realtimeverbinding zodra de app naar de
//  achtergrond gaat (bv. terwijl je op je watch een score invult). Bij
//  terugkeer kan een via de watch ingevulde score nog niet gepusht zijn en
//  duurt het onregelmatig lang voordat de listener herverbindt. Deze functie
//  forceert een verse read van de ladder-docs en hertekent de actieve pagina,
//  zodat de laatste scores meteen zichtbaar zijn — hetzelfde effect als het
//  (voorheen nodige) opnieuw inloggen, maar zonder inloggen.
// ============================================================
export async function herlaadNaResume() {
  if (!huidigeBruiker) return;
  try {
    await Promise.all(alleLadders.map(async (ladder) => {
      const snap = await getDoc(doc(db, 'ladders', ladder.id));
      if (!snap.exists()) return;
      const data = snap.data();
      const idx  = alleLadders.findIndex(l => l.id === ladder.id);
      if (idx < 0) return;
      alleLadders[idx].spelerIds       = data.spelerIds       || [];
      alleLadders[idx].actievePartijen = data.actievePartijen || [];
      alleLadders[idx].data            = data;
    }));
  } catch(e) { console.warn('herlaadNaResume mislukt (niet fataal):', e); }

  const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (ap === 'ladder')    renderLadder();
  if (ap === 'uitslagen') renderUitslagen();
  if (ap === 'ronde')     renderRonde();
  if (ap === 'admin')     renderAdmin();
  if (ap === 'profiel')   renderProfiel();
  if (ap === 'toernooi' && huidigeBruiker) renderToernooi();
  updateSiteTitel();
}

export {
  initApp, initFirestore, setIngelogd, vervolgIngelogd, uitloggen,
  loginSubmit, loginMetGoogle,
  openWachtwoordVergeten, sluitResetWrap, stuurResetEmail,
  openWachtwoordWijzigen, wijzigWachtwoord,
  wisselLadder, toonLaadOverlay,
  getUsers, saveUsers, getLadderData, getLadderConfig,
  updateSiteTitel, toonLoginFout,
  genereerInviteLink, kopieerInviteLink, checkInviteLink,
  registreerSpeler, laadInviteStatus, autoAdvance,
  isCoordinatorRol, isBeheerderRol,
  toast, registreerNotificatieToken, laadUitdagingen,
  slaEersteLoginOp,
};
