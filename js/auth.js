// ============================================================
//  auth.js — v3.0.0 — uid-architectuur volledig
//  Primaire identifier: Firebase Auth uid
//  Bron van waarheid:   spelers/{uid} (profiel), standen/{uid} (ranking)
// ============================================================
import { db, auth, googleProvider, STATE_DOC, USERS_DOC,
  BANEN_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, TOERNOOI_DOC, TOERNOOIEN_COL,
  INVITE_DOC, SNAPSHOTS_COL, LADDERS_COL, DEFAULT_STATE, BANEN_DB_MIGRATIE, esc, escAttr,
  EMAIL_SUFFIX, DEFAULT_HCP, CONFIG_DOC, IS_TEST, laadInitieelWachtwoord,
  laadUiStijl, pasUiStijlToe, laadBanen, effectieveStijl, normaliseerClubStijl,
  genereerEmail, loginNaamVan, functions, httpsCallable,
  isVerbindingGesloten } from './config.js';
import { store, DEFAULT_LADDER_CONFIG,
  alleLadders, activeLadderId, alleSpelersData, huidigeBruiker,
  _usersCache, archiefData, uitdagingenData, toernooiData, alleToernooien,
  actieveToernooiId, _firestoreReady, _vasteListeners, _toernooiListeners,
  _bezigMetRegistratie, playerSlotCount, _verwijderdePartijIds } from './store.js';
import { renderLadder } from './ladder.js';
import { toonUitdagingBadge } from './archief.js';
import { closeModal, renderAdmin, renderProfiel } from './admin.js';
import { renderRonde } from './ronde.js';
import { renderToernooi, getActiefToernooiMetModus, herlaadToernooiListeners, behoudLiveScores, toernooiLoopt } from './toernooi.js';
import { renderUitslagen } from './uitslagen.js';
import { leesScores } from './scores.js';
import { startAlleStandenListeners, stopAlleStandenListeners,
         startStandenWachthond } from './ladder-view.js';

import * as S from './store.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword,
  signInWithCustomToken }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc,
  deleteDoc, getDocs, addDoc, query, where, orderBy, writeBatch, enableNetwork }
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
    h1Second.textContent = huidigeBruiker.toernooiNaam;
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
      h1Second.textContent = actiefToernooi.naam;
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
    ? `${mijnLadders[0].naam} Ladder`
    : 'Matchplay Ladder';
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
    // v5.5.0: isTest meesturen, net als de zestien andere functie-aanroepen.
    // Zonder deze vlag schreef de Cloud Function altijd naar de
    // productiedatabase — ook vanuit /test/. Gevolg: het eerste-loginscherm
    // bleef in test elke keer terugkomen, terwijl de echte handicap van die
    // speler werd overschreven.
    await voltooiFn({ nieuwWachtwoord: pass1, hcp: hcpInt, isTest: IS_TEST });

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
  // v5.38.0: wie met de toernooi-pincode binnenkwam ziet ALLEEN het toernooi.
  // Hij heeft zijn eigen wachtwoord niet gebruikt, dus de rest van de app is
  // niet van hem.
  //
  // ⚠ Dit is het SCHERM. Het slot zit in firestore.rules en in de
  // serverfuncties; tabbladen verbergen is geen beveiliging.
  //
  // ⚠ En het is met opzet geen eigen tak met een `return`. Zo'n tak had ik
  // eerst, en toen sloeg hij het staartstuk hieronder over — dat de
  // toernooipagina actief zet en tekent. De deelnemer keek daardoor tegen het
  // lege "Nieuw Toernooi"-scherm aan in plaats van tegen zijn scorekaart.
  // Gevonden door de browsertest, niet door nadenken.
  // v5.40.0: wie met de QR van een ronde binnenkwam ziet ALLEEN die ronde.
  // ⚠ Hier mag wél een eigen tak met `return` staan, anders dan bij de
  // pincode-sessie hieronder: deze tak doet zelf wat het staartstuk doet —
  // de pagina activeren én tekenen. Dat was daar juist de fout.
  if (rondeVanSessie()) {
    beperkNavTotRonde();   // v5.40.1: één plek, ook gebruikt vóór het inloggen
    const rondeBtn = document.getElementById('nav-ronde-btn');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.getElementById('page-ronde')?.classList.add('active');
    rondeBtn?.classList.add('active');
    renderRonde();
    return;
  }

  const isPin = isPinSessie();
  if (!isPin && (isBeheerderRol() || isCoordinatorRol())) return; // beheerders altijd volledig zicht

  // v3.0.0-11.74: twee paden — toernooiSpeler-vlag op profiel (batch-import)
  // of deelnemer van een actief toernooi met toernooiModus aan.
  const isToernooiSpeler = huidigeBruiker.toernooiSpeler === true;
  const actief = getActiefToernooiMetModus();
  const isDeelnemerViaToernooiModus = actief &&
    (actief.spelers || []).some(s => s.uid === huidigeBruiker.uid);

  if (!isPin && !isToernooiSpeler && !isDeelnemerViaToernooiModus) {
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

// v5.38.0: async geworden. Vóór de schermopbouw moet vaststaan of deze sessie
// met de toernooi-pincode binnenkwam; dat is één vraag aan het inlogtoken.
async function vervolgIngelogd() {
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

  // v5.38.0: eerst vaststellen of deze sessie via de pincode binnenkwam. Dat
  // stuurt hieronder de tabbladen én het eerste-login-scherm.
  await sessieViaPin();

  // v3.0.0-11.74: herstart per-doc toernooi-listeners na login zodat ze
  // huidigeBruiker correct hebben voor toernooiModus etc.
  herlaadToernooiListeners();

  // Pas toernooi-modus nav toe (verbergt tabs voor deelnemers indien actief)
  pasToernooiModusNavToe();

  renderLadder();
  registreerNotificatieToken();
  laadUitdagingen();
  updateSiteTitel();

  // v3.0.0-11: als eerste login, dwing speler naar verplicht profiel-scherm
  //
  // ⚠ v5.38.0: niet bij een pincode-sessie. Dat scherm laat je een handicap en
  // een nieuw wachtwoord kiezen voor een ACCOUNT dat niet van jou is — je bent
  // binnen op een gedeeld getal van vier cijfers. De serverfunctie
  // voltooiEersteLogin weigert zo'n sessie trouwens ook, dus zonder deze regel
  // zou de speler vastlopen op een scherm dat niet af te maken is.
  if (huidigeBruiker.eersteLogin && !isPinSessie()) {
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
    return;
  } catch(e) {
    // ⚠ v5.44.0 — DE OUDE GASTLOGIN IS ERUIT. Hier stond een tweede kans voor
    // een toernooigast: die tikte zijn NAAM in plus een wachtwoord, en de app
    // zocht in de lopende toernooien welk account daarbij hoorde.
    //
    // Die weg is sinds v5.38.0 dood hout: nieuwe gastaccounts krijgen een
    // WILLEKEURIG wachtwoord dat niemand kent. Een gast kiest nu zijn naam uit
    // de lijst en tikt vier cijfers — zie "MEEDOEN AAN HET TOERNOOI" hieronder.
    // Hij werkte dus alleen nog voor toernooien van vóór 19 september 2026.
    // Besloten door Sierk, 25 september 2026: weg.
    //
    // ⚠ De prijs, bewust betaald: een gast van een toernooi van vóór v5.38.0 kan
    // niet meer inloggen. De uitslag van zo'n toernooi blijft wel zichtbaar via
    // de meekijklink, waarvoor je niets nodig hebt.

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

// ⚠ v5.44.0: hier stonden gastKernVan(), gastLoginUitToernooi() en
// _probeerGastLogin() — de oude gastlogin met naam en wachtwoord. Weg; de uitleg
// staat bij de inloghandler hierboven. De kant die het gastACCOUNT aanmaakt
// (gastLoginVan() in js/toernooi.js) blijft bestaan: die inlognaam staat nog op
// het briefje en in het beheerscherm.

// ============================================================
//  MEEDOEN AAN HET TOERNOOI — v5.38.0
// ------------------------------------------------------------
//  Sierk, 19 september 2026: "Je kunt alleen maar meedoen met een toernooi als
//  je naam voorkomt en het toernooi gestart is. Om die reden wil ik het
//  inloggen vereenvoudigen. Is het mogelijk om een dropdown te maken waaruit
//  je je naam kunt selecteren en een vier cijferige pin als wachtwoord?"
//
//  De namen mogen hier staan zonder dat iemand is ingelogd: toernooidocumenten
//  zijn openbaar leesbaar voor het live meekijken (firestore.rules), en de
//  oude gastlogin las ze al net zo op. Het geheim is de pincode, niet de lijst.
//
//  ⚠ De pincode wordt hier NIET gecontroleerd. Dat gebeurt in de serverfunctie
//  wisselToernooiPin — daar zit de foutteller, en daar wordt een coordinator
//  geweigerd. Een controle in de app is geen controle: die slaat iedereen over
//  die de app niet gebruikt.
// ============================================================

let _toernooiInlog = null;   // { id, naam } van het toernooi dat nu loopt

async function vulToernooiInlog() {
  const blok = document.getElementById('toernooi-inlog');
  if (!blok) return;
  blok.style.display = 'none';
  _toernooiInlog = null;
  try {
    const snap = await getDocs(query(TOERNOOIEN_COL, where('status', '==', 'actief')));
    // `toernooiLoopt` is dezelfde toets die het toernooischerm gebruikt: niet
    // meer in concept, nog niet afgerond. Een toernooi dat klaarstaat voor
    // volgende week hoort hier niet te staan — daar kun je nog niet aan meedoen.
    const lopend = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => toernooiLoopt(t) && (t.spelers || []).length > 0);
    if (lopend.length !== 1) return;   // geen, of meerdere: dan geen gok doen

    const t = lopend[0];
    const keuze = document.getElementById('toernooi-inlog-speler');
    const naam  = document.getElementById('toernooi-inlog-naam');
    if (!keuze || !naam) return;

    naam.textContent = t.naam || 'het toernooi';
    keuze.innerHTML = '<option value="">— kies je naam —</option>'
      + (t.spelers || [])
          .slice()
          .sort((a, b) => String(a.naam || '').localeCompare(String(b.naam || ''), 'nl'))
          .map(sp => `<option value="${escAttr(sp.uid)}">${esc(sp.naam || '')}</option>`)
          .join('');
    _toernooiInlog = { id: t.id, naam: t.naam || '' };
    blok.style.display = '';
  } catch (e) {
    // Lukt het niet, dan blijft het gewone inlogscherm staan. Dat is de veilige
    // afloop: niemand raakt buitengesloten doordat dit blok niet kon laden.
    console.warn('toernooi-inlog vullen mislukt:', e?.code || e?.message);
  }
}

async function toernooiPinInloggen() {
  const keuze = document.getElementById('toernooi-inlog-speler');
  const pinEl = document.getElementById('toernooi-inlog-pin');
  const spelerUid = keuze?.value || '';
  const pin = (pinEl?.value || '').trim();

  if (!_toernooiInlog)      { toonLoginFout('Er loopt op dit moment geen toernooi'); return; }
  if (!spelerUid)           { toonLoginFout('Kies eerst je naam uit de lijst'); return; }
  if (!/^\d{4}$/.test(pin)) { toonLoginFout('De pincode bestaat uit 4 cijfers'); return; }

  document.getElementById('login-fout').style.display = 'none';
  try {
    const fn = httpsCallable(functions, 'wisselToernooiPin');
    const uit = await fn({ toernooiId: _toernooiInlog.id, spelerUid, pin, isTest: IS_TEST });
    const token = uit?.data?.customToken;
    if (!token) throw new Error('geen token ontvangen');
    if (pinEl) pinEl.value = '';
    await signInWithCustomToken(auth, token);
  } catch (e) {
    // De serverfunctie schrijft zelf een leesbare reden ("Die pincode klopt
    // niet", "Te veel mislukte pogingen"). Die tonen we letterlijk; alleen als
    // hij ontbreekt vallen we terug op een algemene regel.
    const reden = e?.message && !/internal/i.test(e.message)
      ? e.message
      : 'Inloggen mislukt, probeer het opnieuw';
    toonLoginFout(reden);
    console.warn('toernooi-pincode mislukt:', e?.code || e?.message);
  }
}
window.toernooiPinInloggen = toernooiPinInloggen;

// v5.38.0: is DEZE sessie met de toernooi-pincode binnengekomen? De stempel
// zit in het inlogtoken en is door de app niet te vervalsen — firestore.rules
// en de serverfuncties kijken naar dezelfde stempel.
let _viaPinSessie = false;
let _viaRondePartij = null;   // v5.40.0: partijnummer uit de ronde-QR

async function sessieViaPin() {
  try {
    const res = await auth.currentUser?.getIdTokenResult();
    _viaPinSessie   = res?.claims?.viaPin === true;
    _viaRondePartij = res?.claims?.viaRonde || null;
  } catch (_) { _viaPinSessie = false; _viaRondePartij = null; }
  return _viaPinSessie;
}

// Synchroon op te vragen nadat sessieViaPin() één keer is gedraaid. De
// schermopbouw kan niet wachten op een belofte.
function isPinSessie() { return _viaPinSessie === true; }

// v5.40.0: in welke ronde zit deze sessie, als hij met een QR binnenkwam?
// Geeft het partijnummer of null. De ronde-tab zoekt normaal de partij waar je
// ZELF in speelt; een gast staat daar niet in en zou een leeg scherm zien.
function rondeVanSessie() { return _viaRondePartij; }

// ============================================================
//  BINNENKOMEN MET DE QR VAN EEN RONDE — v5.40.0
// ------------------------------------------------------------
//  De gescande link ziet eruit als  ...?r=<partij>&l=<ladder>&k=<sleutel>.
//  De sleutel wordt hier NIET beoordeeld — dat doet wisselRondeSleutel op de
//  server, die als enige het geheim kent waaruit hij is uitgerekend.
//
//  ⚠ De adresbalk wordt daarna schoongeveegd. Anders staat de sleutel in de
//  geschiedenis van de telefoon en in elke schermafdruk die iemand deelt, en
//  blijft hij daar staan tot de partij verwerkt is.
// ============================================================
// ⚠ v5.40.1 — HET SCHERM MOET METEEN KLOPPEN, NIET NA TIEN SECONDEN.
//
//  WAT ER MIS WAS. Sierk, 20 september 2026: "in eerste instantie ziet de gast
//  alle tabs die een ladder speler ook ziet, na ong 10 sec blijft alleen de
//  ronde tab zichtbaar." Nagemeten in de browsertest: het laddertabblad stond
//  van 971 ms tot 4321 ms in beeld — op een telefoon via mobiel netwerk zijn
//  dat de tien seconden die hij zag.
//
//  De oorzaak: `onAuthStateChanged` haalt het laadscherm meteen weg, en de
//  beperking werd pas aan het eind van het inloggen toegepast. Daartussen zie
//  je de hele app.
//
//  De oplossing zit NIET in het inlogtoken maar in het ADRES: staat er een
//  ronde-code in, dan weten we al vóór het inloggen dat dit een gast is. De
//  echte grendel blijft de stempel in het token plus firestore.rules; dit is
//  alleen het moment waarop het scherm zich aanpast.
let _rondeQrBezig = false;

function beperkNavTotRonde() {
  ['ladder', 'partij', 'uitslagen', 'help', 'archief', 'profiel', 'admin', 'toernooi']
    .forEach(tab => {
      const b = document.getElementById(`nav-${tab}-btn`);
      if (b) b.style.display = 'none';
    });
  const rondeBtn = document.getElementById('nav-ronde-btn');
  if (rondeBtn) rondeBtn.style.display = '';
  // De uitlogknop blijft staan: een gast moet weg kunnen. vervolgIngelogd()
  // zet hem verderop toch weer aan, dus hem hier verbergen zou alleen maar
  // knipperen.
}

// Het laadscherm blijft staan tot de scorekaart er is. Zo ziet de gast één keer
// "Verbinden met database…" en daarna zijn kaart, in plaats van een half
// scherm dat onder zijn handen verandert.
//
// ⚠ Met een harde bovengrens van 30 seconden. Blijft het hangen — slecht
// bereik op de baan, trage server — dan gaat het laadscherm weg en ziet hij
// wat er wél is. Een scherm dat nooit opengaat is erger dan een leeg scherm.
const RONDE_QR_GEDULD_MS = 30000;

function wachtOpRondeScherm() {
  const begin = Date.now();
  const kijk = () => {
    const klaar = !!document.querySelector('#scorecard-body input');
    if (klaar || Date.now() - begin > RONDE_QR_GEDULD_MS) {
      _rondeQrBezig = false;
      toonLaadOverlay(false);
      return;
    }
    setTimeout(kijk, 200);
  };
  setTimeout(kijk, 200);
}

function rondeQrUitAdres() {
  const q = new URLSearchParams(location.search);
  const partijId = q.get('r'), ladderId = q.get('l'), sleutel = q.get('k');
  return (partijId && ladderId && sleutel) ? { partijId, ladderId, sleutel } : null;
}

async function checkRondeQrLink() {
  const gegevens = rondeQrUitAdres();
  if (!gegevens) return false;
  _rondeQrBezig = true;
  beperkNavTotRonde();
  wachtOpRondeScherm();
  try {
    const fn = httpsCallable(functions, 'wisselRondeSleutel');
    const uit = await fn({ ...gegevens, isTest: IS_TEST });
    const token = uit?.data?.customToken;
    if (!token) throw new Error('geen token ontvangen');
    await signInWithCustomToken(auth, token);
    history.replaceState(null, '', location.pathname);
    return true;
  } catch (e) {
    history.replaceState(null, '', location.pathname);
    _rondeQrBezig = false;
    toonLaadOverlay(false);
    document.getElementById('login-scherm').classList.add('actief');
    vulToernooiInlog();
    // De server schrijft zelf een leesbare reden ("Deze ronde is afgelopen").
    toonLoginFout(e?.message && !/internal/i.test(e.message)
      ? e.message
      : 'Deze QR-code werkt niet (meer)');
    console.warn('ronde-QR mislukt:', e?.code || e?.message);
    return false;
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
      vulToernooiInlog();
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
  // v5.12.5: hier stond het initiele wachtwoord letterlijk in de tekst.
  // Voor een gewone speler las dat als 'null' — hij mag ladder/config niet
  // lezen, dus store.initieelWachtwoord is bij hem leeg. En bij een beheerder
  // kwam het gedeelde wachtwoord wel echt in beeld. Geen van beide hoort hier.
  alert('Wachtwoord vergeten?\n\nNeem contact op met de beheerder. Die kan je wachtwoord terugzetten, waarna je bij de eerstvolgende inlog zelf een nieuw wachtwoord kiest.');
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
  const huidig   = document.getElementById('huidig-wachtwoord').value;
  const nieuw    = document.getElementById('nieuw-wachtwoord').value;
  const bevestig = document.getElementById('bevestig-wachtwoord').value;
  if (!huidig)            { toast('Voer je huidige wachtwoord in'); return; }
  // v5.12.5: was 4. Firebase weigert alles onder de 6, dus de app beloofde
  // iets wat daarna alsnog werd geweigerd met een onbegrijpelijke foutcode.
  if (nieuw.length < 6)   { toast('Nieuw wachtwoord minimaal 6 tekens'); return; }
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
  // v5.40.0: een gescande ronde-QR. De laadoverlay blijft staan tot het
  // inloggen klaar is — je hebt net gescand en hoort geen inlogscherm te zien.
  const heeftRondeQr = !!rondeQrUitAdres();
  if (heeftRondeQr) checkRondeQrLink();

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
    if (!heeftInvite && !heeftRondeQr && !hersteldeSessie && !huidigeBruiker) {
      toonLaadOverlay(false);
      document.getElementById('login-scherm').classList.add('actief');
      vulToernooiInlog();
    }
  }, 3000);

  try {
    // v3.0.0-11.74: laad initieel wachtwoord parallel met overige docs
    // v5.4.4: Promise.allSettled in plaats van Promise.all.
    //
    // WAT ER MIS WAS: Promise.all breekt af zodra ÉÉN van de vijf reads
    // mislukt, en levert dan geen enkel resultaat. Eén geweigerd of onbereikbaar
    // document sleepte zo de andere vier mee. allSettled wacht op alle vijf en
    // geeft per stuk terug of het gelukt is; een mislukte read levert nu null op
    // en de rest komt gewoon binnen.
    // v5.4.5: de banen lopen niet meer mee in deze verzamel-read maar via
    // laadBanen(), omdat daar het onderscheid server / eigen kopie wordt
    // gemaakt. laadBanen() gooit nooit een fout, dus Promise.all is hier veilig.
    const [banenUitkomst, uitkomsten] = await Promise.all([
      laadBanen(store),
      Promise.allSettled([
        getDoc(ARCHIEF_DOC),
        getDoc(UITDAGINGEN_DOC),
        getDoc(TOERNOOI_DOC),
        getDoc(doc(db, 'ladder', 'ladderVolgorde'))
      ])
    ]);
    const _namen = ['archief', 'uitdagingen', 'toernooi', 'ladderVolgorde'];
    const [archiefSnap, uitdSnap, toernooiSnap, volgordeSnap] =
      uitkomsten.map((u, i) => {
        if (u.status === 'fulfilled') return u.value;
        console.warn(`[init] ladder/${_namen[i]} niet geladen:`,
          u.reason?.code || u.reason?.message || u.reason);
        return null;
      });

    // v5.4.4: laadInitieelWachtwoord() heeft nu eigen foutopvang.
    //
    // WAT ER MIS WAS: dit was de enige stap in het hele opstarten zonder eigen
    // try/catch. Hij gooit een echte fout als ladder/config ontbreekt of, voor
    // iedereen die geen beheerder is, niet gelezen mag worden — en dat mag
    // volgens firestore.rules alleen een beheerder. Die fout werd pas helemaal
    // onderaan opgevangen (catch met alleen een console.error), waardoor ALLES
    // hierna werd overgeslagen: de UI-stijl, het archief, de uitdagingen, de
    // banen én de ladders. De browsertest van v5.4.3 liet dat zwart op wit zien:
    // "ladder/config ontbreekt" in de console, en daarna een app zonder ladder.
    //
    // Het initiële wachtwoord is alleen nodig in het beheerscherm. Ontbreekt het
    // hier, dan wordt het na het inloggen alsnog opgehaald (zie
    // onAuthStateChanged verderop, v3.0.4). Het mag het opstarten niet blokkeren.
    try {
      await laadInitieelWachtwoord(store);
    } catch(e) {
      console.warn('[init] initieel wachtwoord nog niet beschikbaar:',
        e.code || e.message);
    }

    // v4.1.0: globale UI-stijl laden en meteen toepassen (voor eerste render van
    // login/app-scherm). Faalt nooit hard — valt terug op 'club' bij problemen.
    await laadUiStijl(store);
    // v5.6.0: de eigen keuze van dit apparaat gaat voor op die van de club.
    pasUiStijlToe(effectieveStijl(store.uiStijl));

    // v5.4.4: ?. omdat een mislukte read nu null oplevert in plaats van te knallen.
    store.archiefData     = archiefSnap?.exists() ? (archiefSnap.data().seizoenen || []) : [];
    store.uitdagingenData = uitdSnap?.exists()    ? (uitdSnap.data().lijst        || []) : [];
    // v3.0.0-11.34: laad alle banen uit Firestore — geen hardcoded BANEN_DB meer.
    // migratieVasteBanen() schrijft de vijf vaste banen eenmalig naar Firestore
    // als ze er nog niet in staan, zodat de overgang naadloos verloopt.
    //
    // v5.4.4/v5.4.5 — BELANGRIJK: de migratie draait ALLEEN op een echt
    // serverantwoord. Bij een mislukte read, of een antwoord uit de eigen kopie
    // op het toestel, zou migratieVasteBanen uit de lege lijst concluderen dat
    // alle vijf vaste banen ontbreken en het banendocument overschrijven met
    // alleen die vijf — waarmee elke zelf toegevoegde baan van iedereen
    // verdwijnt. Een leeg of onzeker antwoord is geen bewijs dat er niets is.
    if (banenUitkomst.gelukt && !banenUitkomst.uitEigenKopie) {
      store.aangepasteBanen = await migratieVasteBanen(banenUitkomst.lijst);
    } else if (!banenUitkomst.gelukt) {
      console.warn('[init] banen nog niet betrouwbaar geladen — ' +
        'wordt na het inloggen opnieuw geprobeerd');
    }
    // v3.0.0-9c: alleSpelersData wordt niet meer uit ladder/spelers geladen.
    // Het is nu een afgeleide view van _usersCache (zie store.js) en wordt
    // gevuld zodra de spelers/ listener start na login.
    const ladderVolgorde  = volgordeSnap?.exists() ? (volgordeSnap.data().volgorde || []) : [];

    // v3.0.0-11.74: legacy migratie (eenmalig, alleen als nodig)
    if (toernooiSnap?.exists() && toernooiSnap.data().status === 'actief') {
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
    // v5.6.0: de clubinstelling mag een eigen keuze niet overrulen. Zonder deze
    // omweg sprong het scherm van een speler terug zodra de beheerder de
    // standaard wijzigde — hij had dan wel gekozen, maar merkte er niets van.
    // ⚠ v5.34.1: hier stond `(uiStijl === 'club') ? 'club' : 'matchcheck'` —
    // een eigen kopie die maar twee stijlen kende. Papier (v5.27.0) werd
    // daardoor meteen weer teruggezet naar Helder. Nu via dezelfde functie als
    // laadUiStijl(); zie de toelichting bij normaliseerClubStijl in js/config.js.
    const nieuweStijl = normaliseerClubStijl(snap.data().uiStijl);
    if (nieuweStijl !== store.uiStijl) {
      store.uiStijl = nieuweStijl;
      pasUiStijlToe(effectieveStijl(nieuweStijl));
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
        // v5.11.0: ⚠ hier ging het mis. De serverversie bevat de scores van een
        // LOPENDE dag niet — die staan in de live/-submap tot de dag wordt
        // afgesloten. Zonder deze regel werden de invoervakjes leeg getekend
        // zodra de coordinator ergens een vinkje omzette. Zie behoudLiveScores()
        // in js/toernooi.js; de meeluisteraar daar gebruikt dezelfde functie.
        if (bijgewerkt) store.toernooiData = behoudLiveScores(bijgewerkt);
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

    // v5.4.4: ook deze losse read mag het laden van de ladders niet meeslepen.
    // ladder/state is een legacy-document dat alleen nog in de migratietak
    // hieronder wordt gebruikt; is het onbereikbaar, dan gaan we gewoon door.
    const stateSnap = await getDoc(STATE_DOC).catch(e => {
      console.warn('[init] ladder/state niet geladen:', e.code || e.message);
      return null;
    });
    const mpDoc     = laddersSnap.docs.find(d => d.id === 'mp');

    if (!mpDoc) {
      const bestaandeState = stateSnap?.exists()
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
  // v5.40.1: het vangnet van 10 seconden geldt niet terwijl een gescande
  // ronde-code wordt afgehandeld; die heeft zijn eigen grens van 30 seconden.
  setTimeout(() => { if (!_rondeQrBezig) toonLaadOverlay(false); }, 10000);

  onAuthStateChanged(auth, async (user) => {
    if (store._bezigMetRegistratie) return;
    if (!_rondeQrBezig) toonLaadOverlay(false);
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
            // ────────────────────────────────────────────────────────
            // v5.4.8: OOK de ladder opnieuw tekenen zodra de namen binnen zijn.
            //
            // WAT ER MIS WAS. De ladderlijst heeft twee bronnen nodig: de
            // standen (wie staat waar) en de spelers (de namen en handicaps).
            // Daar hangen twee aparte listeners aan. De standen-listener geeft
            // het scherm een seintje om opnieuw te tekenen; deze spelers-
            // listener vulde alleen stilletjes _usersCache en zei niets.
            //
            // Zonder namen geeft getLadderSpelers() een lege lijst terug en zet
            // renderLadder() "Nog geen spelers." neer. Kwamen de namen daarna
            // alsnog binnen, dan tekende niemand het scherm opnieuw en bleef
            // die tekst staan.
            //
            // Dat is precies de volgorde die zich voordoet als de standen
            // sneller binnen zijn dan de login: het seintje van de standen komt
            // dan langs terwijl huidigeBruiker nog null is en wordt bewust
            // genegeerd, en daarna komt het niet meer. In de emulator gebeurt
            // dat altijd (alles is lokaal en instant); bij een snelle
            // verbinding met een herstelde sessie kan het ook een speler raken.
            //
            // De wachthond uit v5.4.1 dekt dit niet af: die controleert of de
            // STANDEN binnen zijn, en die zijn hier gewoon binnen.
            // ────────────────────────────────────────────────────────
            if (ap === 'ladder') renderLadder();
          },
          (err) => { console.warn('spelers/ listener error:', err.code); }
        ));
      }
      // Start standen/ listeners voor alle ladders (fase 9a view-laag)
      startAlleStandenListeners();

      // v5.4.5: banen alsnog ophalen als ze bij het opstarten niet betrouwbaar
      // binnenkwamen. initFirestore() draait bij een koude start voordat
      // Firebase de sessie heeft hersteld, en wordt na het inloggen niet
      // opnieuw uitgevoerd — zonder deze tweede poging bleef de banenlijst leeg
      // tot de app volledig opnieuw startte. Nadrukkelijk van de server, zodat
      // een lege eigen kopie niet opnieuw voor een leeg antwoord zorgt.
      //
      // LET OP — bewust NA startAlleStandenListeners() en bewust ZONDER await.
      // getDocFromServer() wacht op de server. Juist bij slecht bereik op de
      // baan — precies wanneer de banenlijst leeg is — kan dat lang duren. Zou
      // deze regel het opstarten ophouden, dan startten de ladder-listeners pas
      // daarna en bleef de ladderstand leeg. De banen komen binnen wanneer ze
      // binnenkomen; niets anders wacht erop.
      if (!S.aangepasteBanen || S.aangepasteBanen.length === 0) {
        laadBanen(store, { vanServer: true })
          .then(r => { if (r.gelukt) console.info(`[banen] alsnog geladen na inloggen: ${r.lijst.length}`); })
          .catch(e => console.warn('[banen] tweede poging mislukt:', e.code || e.message));
      }
      // v5.4.1: controleer of de standen ook echt binnenkomen en herstel
      // vanzelf als dat niet zo is. Zie de toelichting in ladder-view.js.
      startStandenWachthond();
    } else {
      store.huidigeBruiker = null;
      const heeftInvite = new URLSearchParams(location.search).has('invite');
      if (heeftInvite) { await checkInviteLink(); }
      else if (rondeQrUitAdres()) { /* v5.40.0: het omwisselen loopt nog */ }
      else { document.getElementById('login-scherm').classList.add('actief');
      vulToernooiInlog(); }
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
  } catch(e) { meldFout('Uitnodigingslink maken', e); }
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
    // v5.12.8: gastaccounts van toernooien moeten uit de spelerslijst te houden
    // zijn. Tot nu toe deed het ladderfilter dat toevallig — een gast zit in
    // geen enkele ladder — maar dat filter verdwijnt. Zonder dit veld zou elke
    // gast van elk vorig toernooi in de keuzelijst opduiken.
    toernooiGast:   data.toernooiGast === true,
    // v5.40.3: het tijdelijke profiel van een ronde-QR. Sierk: "Spelers die
    // zijn aangemaakt zijn te zien in beheer, spelers. Dat is niet de
    // bedoeling." Zelfde behandeling als een toernooigast.
    rondeGast:      data.rondeGast === true,
    toernooiNaam:   data.toernooiNaam   || '',
    partijId:       data.partijId       || '',
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
    // ⚠ v5.44.0 — HIER STOND EEN HARDE FOUT. Er stond:
    //   if (ladderId === activeLadderId) return { exists:true, data: state, … };
    // `state` bestaat hier niet: niet geïmporteerd, niet gedeclareerd, en
    // store.js exporteert hem niet. Die regel wierp dus een fout op het moment
    // dat hij werd bereikt, en dat kon echt gebeuren: elke plek die
    // `alleLadders` uit de database vult zet `.data` erbij, behalve het aanmaken
    // van een NIEUWE ladder (js/beheer.js). Maakte je er een aan en sloot je in
    // dezelfde sessie een toernooidag af die op die ladder rangschikt, dan liep
    // het stuk. Gevonden met een linter op 25 september 2026.
    // De regel is eruit: zonder gegevens in de cache hoort hij ze gewoon op te
    // halen, en dat doet de code hieronder al.
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

// v5.9.0: `ms` is optioneel en verandert niets aan de bestaande aanroepen.
// Een foutmelding die de echte oorzaak noemt is langer dan "Opgeslagen ✓" en
// moet lang genoeg blijven staan om aan de telefoon voorgelezen te worden.
let _toastTimer = null;
function toast(msg, ms) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  // v5.11.2: wegtikken. Een foutmelding blijft negen seconden staan, en zo lang
  // wil je er niet tegenaan kijken als je hem gelezen hebt. Eén keer koppelen,
  // niet bij elke melding opnieuw.
  if (!t._klikGekoppeld) {
    t.addEventListener('click', () => {
      t.classList.remove('show');
      if (_toastTimer) clearTimeout(_toastTimer);
    });
    t._klikGekoppeld = true;
  }
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2500);
}
// v5.11.2: ook op window, zodat de browsertest de ECHTE meldingfunctie kan
// aanroepen in plaats van een nagemaakte — inclusief het wegtikken.
window.toast = toast;

// ============================================================
//  FOUTMELDINGEN DIE IETS ZEGGEN  (v5.12.6)
// ============================================================
//  In v5.9.0 is dit voor de toernooitab gebouwd, omdat dertien verschillende
//  oorzaken daar allemaal "Er is iets misgegaan, probeer opnieuw" opleverden en
//  de echte reden alleen in het verborgen logboek van de browser stond — op een
//  telefoon onbereikbaar.
//
//  Diezelfde tekst stond nog op vijftien plekken in zes andere bestanden, onder
//  andere bij ladder aanmaken, ladder verwijderen en spelers opslaan. Die staan
//  hier nu op dezelfde bron. `toernooiFout()` in js/toernooi.js is een alias
//  hierop geworden, zodat er er maar één regel bestaat.
//
//  Dit staat bewust in auth.js: het is het enige bestand dat alle zes al
//  importeren (voor toast), dus er komt geen enkele nieuwe kring bij.
//
//  ⚠ Deze twee functies mogen zelf nooit omvallen — ze draaien per definitie op
//  het moment dat er al iets stuk is (BOUWNORMEN, regel 3).
function foutTekst(e) {
  try {
    if (!e) return 'onbekende oorzaak';
    if (typeof e === 'string') return e.slice(0, 160);
    const code = e.code ? String(e.code) : '';
    const melding = e.message ? String(e.message) : '';
    const tekst = [code, melding].filter(Boolean).join(' \u2014 ') || String(e);
    return tekst.slice(0, 160);
  } catch (_) { return 'onbekende oorzaak'; }
}

// `waar` is wat de gebruiker probeerde te doen, in gewone woorden:
// meldFout('Ladder verwijderen', e)  ->  "Ladder verwijderen mislukt: ..."
function meldFout(waar, e) {
  try { console.error(waar + ' mislukt:', e); } catch (_) {}
  // v5.41.3: is de databaseverbinding gesloten, dan zegt de oorzaak van DEZE
  // handeling niets — élke handeling zou stuk zijn gegaan. Herstellen dus, in
  // plaats van een Engelse zin tonen waar niemand iets mee kan.
  if (isVerbindingGesloten(e)) { herstelVerbinding(waar); return; }
  try { toast(waar + ' mislukt: ' + foutTekst(e), 9000); }
  catch (_) { /* zelfs de melding mag de app niet omver trekken */ }
}

// ============================================================
//  v5.41.3 — DE VERBINDING HERSTELLEN
// ------------------------------------------------------------
//  Een gesloten Firestore-verbinding is niet te heropenen: de enige weg terug
//  is de app opnieuw laden. Dat is hier geen noodgreep maar de reparatie.
//
//  ⚠ Er gaat niets verloren. Wat al is ingevuld staat in de offline-opslag op
//  de telefoon (persistentLocalCache, zie js/config.js) en wordt na het
//  herladen alsnog verstuurd; een half ingevuld partijformulier wordt net als
//  altijd uit sessionStorage hersteld.
//
//  ⚠ Hooguit één keer per halve minuut. Zonder die grendel zou een storing die
//  meteen terugkomt de app in een kringetje kunnen sturen — en dan is hij niet
//  eens meer lang genoeg open om de melding te lezen.
// ============================================================
const HERSTEL_SLEUTEL = 'goyer_verbindingsherstel';
const HERSTEL_PAUZE_MS = 30000;

// Puur: mag er op dit moment hersteld worden? Los van het scherm en van de
// klok, zodat de rekentest hem kan natellen.
function magHerstellen(vorigeTs, nu) {
  if (!vorigeTs) return true;
  return (nu - vorigeTs) > HERSTEL_PAUZE_MS;
}

// Het spoor. De oorzaak is niet vastgesteld (zie js/config.js), en op een
// iPhone is het logboek van de browser onbereikbaar. Daarom blijft er één
// regel achter op het toestel zelf, zichtbaar onderaan Beheer.
function leesHerstelSpoor() {
  try {
    const rauw = localStorage.getItem(HERSTEL_SLEUTEL);
    if (!rauw) return null;
    const spoor = JSON.parse(rauw);
    return (spoor && typeof spoor.ts === 'number') ? spoor : null;
  } catch (_) { return null; }
}

function schrijfHerstelSpoor(waar, ts) {
  try {
    localStorage.setItem(HERSTEL_SLEUTEL, JSON.stringify({
      ts, waar: String(waar || 'onbekend').slice(0, 60),
    }));
  } catch (_) { /* privémodus: dan maar zonder spoor */ }
}

let _herstelBezig = false;

function herstelVerbinding(waar) {
  if (_herstelBezig) return;
  const vorige = leesHerstelSpoor();
  const nu = Date.now();
  schrijfHerstelSpoor(waar, nu);

  if (!magHerstellen(vorige && vorige.ts, nu)) {
    // Kort geleden al herteld — niet opnieuw, anders blijft hij rondjes draaien.
    try { toast('Verbinding met de database verbroken. Sluit de app en open hem opnieuw.', 9000); } catch (_) {}
    return;
  }

  _herstelBezig = true;
  try { console.error('[verbinding] gesloten tijdens:', waar, '— app wordt opnieuw geladen'); } catch (_) {}
  try { toast('Verbinding met de database verbroken — de app wordt opnieuw geladen…', 9000); } catch (_) {}
  setTimeout(() => { try { location.reload(); } catch (_) {} }, 1200);
}

// v5.41.3: de goedkoopste manier om te weten of de verbinding nog leeft.
// enableNetwork() doet geen enkele leesactie op de database, maar loopt wél
// langs dezelfde controle die de fout gooit als de verbinding gesloten is.
async function controleerVerbinding(waar) {
  try {
    await enableNetwork(db);
    return true;
  } catch (e) {
    if (isVerbindingGesloten(e)) { herstelVerbinding(waar || 'terugkomen uit de achtergrond'); return false; }
    console.warn('verbindingscontrole mislukt:', e?.code || e?.message || e);
    return true;   // iets anders aan de hand — daar gaat deze reparatie niet over
  }
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

      // ────────────────────────────────────────────────────────
      // v5.5.4 — de scores erbij halen uit de subcollectie.
      //
      // De regel hierboven vervangt de partij-objecten door de kopie uit het
      // ladderdocument. Die kopie bevat een VEROUDERDE scores-array: sinds
      // v5.0.0 staan de echte scores in ladders/{id}/partijen/{pid}/scores/{uid}
      // en loopt de array in het ladderdocument bewust achter.
      //
      // Zonder deze aanvulling toonde de telefoon na elke terugkeer uit de
      // achtergrond de oude scores — precies het scherm waar je op dat moment
      // naar kijkt. Dat de listener daarna opnieuw koppelt (zie ronde.js)
      // repareert het uiteindelijk, maar dit voorkomt dat er ook maar één
      // moment een verkeerde score in beeld staat.
      // ────────────────────────────────────────────────────────
      for (const p of alleLadders[idx].actievePartijen) {
        if (!p?.partijId) continue;
        try {
          const verse = await leesScores(ladder.id, p.partijId, (p.holes || []).length);
          if (verse) p.scores = { ...(p.scores || {}), ...verse };
        } catch (e) {
          console.warn('[resume] scores verversen mislukt voor', p.partijId, e?.code || e);
        }
      }
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
  isCoordinatorRol, isBeheerderRol, rondeVanSessie, isPinSessie,
  toast, foutTekst, meldFout, registreerNotificatieToken, laadUitdagingen,
  herstelVerbinding, controleerVerbinding, leesHerstelSpoor, magHerstellen,
  slaEersteLoginOp,
};
