// ============================================================
//  config.js — Firebase setup, Firestore refs, constanten
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc,
  query, where, orderBy, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup,
  sendPasswordResetEmail, updatePassword, EmailAuthProvider,
  reauthenticateWithCredential, createUserWithEmailAndPassword,
  setPersistence, indexedDBLocalPersistence, browserLocalPersistence,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC6V0NOSgAtX_bDWezca-_F7gb3RANSens",
  authDomain: "goyer-golf-mp-ladder.firebaseapp.com",
  projectId: "goyer-golf-mp-ladder",
  storageBucket: "goyer-golf-mp-ladder.firebasestorage.app",
  messagingSenderId: "124116031878",
  appId: "1:124116031878:web:10d9b113b1afcd1dc73407"
};

export const app = initializeApp(firebaseConfig);

// v5.4.0: draait de app lokaal (browsertests tegen de emulator)? Dan geen
// App Check en geen emulator-verbindingen in productie. De app wordt in
// productie en test altijd vanaf sierkr.github.io geserveerd, dus deze
// voorwaarde is nooit waar voor een echte gebruiker.
export const IS_EMULATOR =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

// v3.0.0-11.100: App Check — reCAPTCHA v3. Beschermt Firestore/Auth tegen
// requests van buiten de echte app. Moet vóór getFirestore/getAuth gebeuren.
// Overgeslagen op localhost: reCAPTCHA kan daar geen token ophalen en zou de
// geautomatiseerde tests laten vastlopen.
export const appCheck = IS_EMULATOR ? null : initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6LfOyhAtAAAAACKwXb70iOl_Pdrez2QQ_ktGhFSj'),
  isTokenAutoRefreshEnabled: true
});

// v3.0.0-11.103: testomgeving — als de app onder /test/ draait, gebruik de
// named Firestore database 'test' (los van productie). Auth en App Check zijn
// gedeeld (zelfde project + zelfde sierkr.github.io-domein).
export const IS_TEST = typeof location !== 'undefined' && location.pathname.includes('/test/');

// v5.0.0: Firestore offline-cache aanzetten.
//
// WAAROM DIT NODIG IS: op de baan is het bereik vaak slecht. Zonder offline-
// cache houdt de SDK schrijfacties alleen in het geheugen vast; sluit de app
// (of iOS de PWA) af, dan is de score weg. Met de persistente cache overleven
// wachtende schrijfacties het afsluiten en worden ze bij verbinding alsnog
// verstuurd.
//
// Dit kon pas veilig aan ná de omzetting naar scores-per-speler (punt 4). In
// de oude opzet schreef elke wijziging de complete actievePartijen-array van
// de hele ladder; een schrijfactie die tien minuten later alsnog binnenkwam,
// overschreef dan alles wat er intussen was gebeurd. Nu raakt zo'n uitgestelde
// schrijfactie alleen het document van één speler.
//
// persistentMultipleTabManager: nodig omdat de app in meerdere tabs of naast
// de PWA open kan staan. Valt stil terug op de geheugencache als IndexedDB
// niet beschikbaar is (privémodus, oudere browsers) — dan werkt de app als
// voorheen, alleen zonder offline-bescherming.
function _maakDb() {
  const instellingen = {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  };
  try {
    return IS_TEST
      ? initializeFirestore(app, instellingen, 'test')
      : initializeFirestore(app, instellingen);
  } catch (e) {
    console.warn('Firestore offline-cache niet beschikbaar, val terug op standaard:', e);
    return IS_TEST ? getFirestore(app, 'test') : getFirestore(app);
  }
}

export const db = _maakDb();
export const auth = getAuth(app);

// v5.4.0: verbind met de lokale Firebase-emulator (zie IS_EMULATOR hierboven).
if (IS_EMULATOR) {
  try {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    console.info('[test] verbonden met de lokale Firebase-emulator');
  } catch (e) {
    console.error('[test] verbinden met de emulator mislukt:', e);
  }
}

// v3.0.6: pin de auth-persistentie expliciet op IndexedDB (robuust op iOS,
// ook als PWA op het beginscherm). Valt terug op localStorage als IndexedDB
// niet beschikbaar is (bv. privémodus). Fouten zijn niet fataal — Firebase
// gebruikt dan zijn eigen standaard-hiërarchie. Dit garandeert dat de sessie
// bewaard blijft tot de gebruiker zelf uitlogt.
setPersistence(auth, indexedDBLocalPersistence).catch(() =>
  setPersistence(auth, browserLocalPersistence).catch(() => {})
);

export const googleProvider = new GoogleAuthProvider();

// v3.0.0-11.2: Cloud Functions in europe-west1 voor reset-wachtwoord
export const functions = getFunctions(app, 'europe-west1');
if (IS_EMULATOR) {
  try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); }
  catch (e) { console.error('[test] functions-emulator koppelen mislukt:', e); }
}
export { httpsCallable };
// Firestore refs
export const STATE_DOC = doc(db, 'ladder', 'state'); // legacy — voor migratie
export const USERS_DOC = doc(db, 'ladder', 'users');

// Users cache helpers — voorkomt herhaalde Firestore reads
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
export const SPELERS_DOC = null; // v3.0.0-9c: legacy ladder/spelers is verwijderd, export behouden als null voor compat
export const BANEN_DOC = doc(db, 'ladder', 'banen');
export const ARCHIEF_DOC = doc(db, 'ladder', 'archief');
export const UITDAGINGEN_DOC = doc(db, 'ladder', 'uitdagingen');
export const TOERNOOI_DOC = doc(db, 'ladder', 'toernooi'); // legacy
export const TOERNOOIEN_COL = collection(db, 'toernooien');
export const UITSLAGEN_COL = collection(db, 'uitslagen');
export const INVITE_DOC = doc(db, 'ladder', 'invite');
export const SNAPSHOTS_COL = collection(db, 'snapshots');
export const LADDERS_COL = collection(db, 'ladders');

// Ingelogde gebruiker (alleen in geheugen, niet in Firestore)
export let huidigeBruiker = null; // { gebruikersnaam, rol }

// ============================================================
//  DATA
// ============================================================

// v3.0.0-11.34: BANEN_DB verwijderd — alle banen komen uit Firestore (ladder/banen).
// BANEN_DB_MIGRATIE wordt eenmalig gebruikt in migratieVasteBanen() in auth.js
// om de vijf vaste banen naar Firestore te schrijven als ze er nog niet in staan.
// Na de migratie is deze lijst verder niet meer actief in de app.
export const BANEN_DB_MIGRATIE = [
  {
    naam: "De Goyer",
    aangemaakt_door: "systeem",
    holes: [
      {par:4,si:16},{par:3,si:10},{par:4,si:6},{par:5,si:2},{par:3,si:18},
      {par:4,si:14},{par:5,si:4},{par:4,si:8},{par:4,si:12},
      {par:4,si:17},{par:3,si:13},{par:4,si:5},{par:5,si:1},{par:3,si:15},
      {par:4,si:11},{par:4,si:7},{par:5,si:3},{par:4,si:9}
    ]
  },
  {
    naam: "Hilversumsche Golf Club",
    aangemaakt_door: "systeem",
    holes: [
      {par:4,si:7},{par:4,si:3},{par:3,si:15},{par:5,si:11},{par:4,si:1},
      {par:3,si:17},{par:4,si:5},{par:4,si:9},{par:5,si:13},
      {par:4,si:8},{par:4,si:2},{par:3,si:16},{par:5,si:12},{par:4,si:4},
      {par:3,si:18},{par:4,si:6},{par:4,si:10},{par:5,si:14}
    ]
  },
  {
    naam: "Kennemer Golf & Country Club",
    aangemaakt_door: "systeem",
    holes: [
      {par:4,si:9},{par:4,si:5},{par:3,si:17},{par:5,si:1},{par:4,si:13},
      {par:4,si:3},{par:3,si:15},{par:5,si:7},{par:4,si:11},
      {par:4,si:10},{par:4,si:6},{par:3,si:18},{par:5,si:2},{par:4,si:14},
      {par:4,si:4},{par:3,si:16},{par:5,si:8},{par:4,si:12}
    ]
  },
  {
    naam: "Haagsche Golf & Country Club",
    aangemaakt_door: "systeem",
    holes: [
      {par:5,si:3},{par:4,si:9},{par:3,si:15},{par:4,si:1},{par:4,si:11},
      {par:3,si:17},{par:4,si:7},{par:5,si:5},{par:4,si:13},
      {par:4,si:4},{par:4,si:10},{par:3,si:16},{par:5,si:2},{par:4,si:12},
      {par:4,si:8},{par:3,si:18},{par:4,si:6},{par:5,si:14}
    ]
  },
  {
    naam: "Amsterdamsche Golf Club",
    aangemaakt_door: "systeem",
    holes: [
      {par:4,si:11},{par:3,si:17},{par:4,si:5},{par:5,si:1},{par:4,si:9},
      {par:3,si:15},{par:4,si:7},{par:5,si:3},{par:4,si:13},
      {par:4,si:12},{par:3,si:18},{par:4,si:6},{par:5,si:2},{par:4,si:10},
      {par:3,si:16},{par:4,si:8},{par:5,si:4},{par:4,si:14}
    ]
  }
];

export const DEFAULT_STATE = {
  spelers: [],
  actievePartijen: [],
  uitslagen: []
};

// ============================================================
//  MP LADDER ACCOUNT CONSTANTS — v3.0.0-11
// ============================================================
// Alle nieuwe spelers krijgen auto-gegenereerd email en wachtwoord.
// Bij eerste login worden ze verplicht om hcp en wachtwoord te kiezen.
export const EMAIL_SUFFIX = '@MPladder.stb';
export const DEFAULT_HCP  = 10;

// v3.0.0-11.62: ladder/config — bron van waarheid voor het initiële wachtwoord.
// Geen fallback — als het document of veld ontbreekt gooit de functie een fout.
export const CONFIG_DOC = doc(db, 'ladder', 'config');

/**
 * Laad het initiële wachtwoord uit Firestore (ladder/config).
 * Schrijft het resultaat naar store.initieelWachtwoord.
 * Gooit een Error als het document ontbreekt, het veld leeg is, of de read mislukt.
 */
export async function laadInitieelWachtwoord(storeRef) {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    throw new Error('ladder/config ontbreekt in Firestore — stel initieelWachtwoord in via het beheerscherm');
  }
  const w = snap.data().initieelWachtwoord;
  if (typeof w !== 'string' || w.length === 0) {
    throw new Error('initieelWachtwoord is leeg in ladder/config — stel het in via het beheerscherm');
  }
  storeRef.initieelWachtwoord = w;
}

// v4.1.0: ladder/config — veld uiStijl bepaalt de globale weergavestijl.
// Anders dan laadInitieelWachtwoord() gooit dit GEEN fout als het veld of
// document ontbreekt: valt dan gewoon stil terug op 'club' (huidige stijl).
// Zo blijft de app werken ook als deze functionaliteit nooit is ingesteld.
export async function laadUiStijl(storeRef) {
  try {
    const snap = await getDoc(CONFIG_DOC);
    const waarde = snap.exists() ? snap.data().uiStijl : null;
    storeRef.uiStijl = (waarde === 'matchcheck') ? 'matchcheck' : 'club';
  } catch(e) {
    console.warn('laadUiStijl mislukt, val terug op club-stijl:', e);
    storeRef.uiStijl = 'club';
  }
}

/**
 * Past de gegeven UI-stijl toe op de pagina door het data-theme attribuut op
 * <html> te zetten. De bijbehorende CSS (in index.html, [data-theme="matchcheck"])
 * verandert alleen kleuren/typografie/randen — nooit de HTML-structuur.
 */
export function pasUiStijlToe(waarde) {
  const stijl = (waarde === 'matchcheck') ? 'matchcheck' : 'club';
  if (stijl === 'club') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', stijl);
  }
}

/**
 * Genereer emailadres uit voornaam + achternaam.
 * Spaties weg, lowercase, gescheiden door punt.
 * "Jan" + "de Vries" → "jan.devries@MPladder.stb"
 * "Jean-Pierre" + "van der Berg" → "jean-pierre.vanderberg@MPladder.stb"
 */
export function genereerEmail(voornaam, achternaam) {
  const clean = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
  return `${clean(voornaam)}.${clean(achternaam)}${EMAIL_SUFFIX}`;
}

/**
 * Extract het 'login'-deel uit een email (voor @), alleen voor @MPladder.stb emails.
 * Voor weergave in admin-UI: "jan.devries" i.p.v. volledige email.
 * Bij externe emails (legacy accounts) returnt hij gewoon het volledige adres.
 */
export function loginNaamVan(email) {
  if (!email) return '';
  if (email.toLowerCase().endsWith(EMAIL_SUFFIX.toLowerCase())) {
    return email.slice(0, -EMAIL_SUFFIX.length);
  }
  return email;
}

// ============================================================
//  SECURITY HELPERS — v3.0.0-10 fase 10
// ============================================================

/**
 * Escape HTML special characters voor veilige injectie in innerHTML.
 * Gebruik rond ELKE user-input (spelersnamen, email, baan-namen, notities).
 * Voorbeeld: `<div>${esc(s.naam)}</div>`
 */
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape voor gebruik binnen een JS-string-literal in een inline HTML attribute,
 * bijv. onclick="foo('${escAttr(naam)}')". Dekt zowel HTML- als JS-escapes.
 */
export function escAttr(str) {
  return esc(String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}
