// ============================================================
//  config.js — Firebase setup, Firestore refs, constanten
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup,
  sendPasswordResetEmail, updatePassword, EmailAuthProvider,
  reauthenticateWithCredential, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC6V0NOSgAtX_bDWezca-_F7gb3RANSens",
  authDomain: "goyer-golf-mp-ladder.firebaseapp.com",
  projectId: "goyer-golf-mp-ladder",
  storageBucket: "goyer-golf-mp-ladder.firebasestorage.app",
  messagingSenderId: "124116031878",
  appId: "1:124116031878:web:10d9b113b1afcd1dc73407"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
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
export const SPELERS_DOC = doc(db, 'ladder', 'spelers'); // master spelerslijst
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
export let aangepasteBanen = []; // { naam, aangemaakt_door, holes: [{par, si}] }

// ============================================================
//  DATA
// ============================================================

// Banen database (NL selectie, PAR + SI per hole)
export const BANEN_DB = {
  "De Goyer (thuisbaan)": {
    holes: [
      {par:4,si:16},{par:3,si:10},{par:4,si:6},{par:5,si:2},{par:3,si:18},
      {par:4,si:14},{par:5,si:4},{par:4,si:8},{par:4,si:12},
      {par:4,si:17},{par:3,si:13},{par:4,si:5},{par:5,si:1},{par:3,si:15},
      {par:4,si:11},{par:4,si:7},{par:5,si:3},{par:4,si:9}
    ]
  },
  "Hilversumsche Golf Club": {
    holes: [
      {par:4,si:7},{par:4,si:3},{par:3,si:15},{par:5,si:11},{par:4,si:1},
      {par:3,si:17},{par:4,si:5},{par:4,si:9},{par:5,si:13},
      {par:4,si:8},{par:4,si:2},{par:3,si:16},{par:5,si:12},{par:4,si:4},
      {par:3,si:18},{par:4,si:6},{par:4,si:10},{par:5,si:14}
    ]
  },
  "Kennemer Golf & Country Club": {
    holes: [
      {par:4,si:9},{par:4,si:5},{par:3,si:17},{par:5,si:1},{par:4,si:13},
      {par:4,si:3},{par:3,si:15},{par:5,si:7},{par:4,si:11},
      {par:4,si:10},{par:4,si:6},{par:3,si:18},{par:5,si:2},{par:4,si:14},
      {par:4,si:4},{par:3,si:16},{par:5,si:8},{par:4,si:12}
    ]
  },
  "Haagsche Golf & Country Club": {
    holes: [
      {par:5,si:3},{par:4,si:9},{par:3,si:15},{par:4,si:1},{par:4,si:11},
      {par:3,si:17},{par:4,si:7},{par:5,si:5},{par:4,si:13},
      {par:4,si:4},{par:4,si:10},{par:3,si:16},{par:5,si:2},{par:4,si:12},
      {par:4,si:8},{par:3,si:18},{par:4,si:6},{par:5,si:14}
    ]
  },
  "Amsterdamsche Golf Club": {
    holes: [
      {par:4,si:11},{par:3,si:17},{par:4,si:5},{par:5,si:1},{par:4,si:9},
      {par:3,si:15},{par:4,si:7},{par:5,si:3},{par:4,si:13},
      {par:4,si:12},{par:3,si:18},{par:4,si:6},{par:5,si:2},{par:4,si:10},
      {par:3,si:16},{par:4,si:8},{par:5,si:4},{par:4,si:14}
    ]
  },
  "Handmatig invoeren": { holes: null }
};

export const DEFAULT_STATE = {
  spelers: [],
  nextId: 1,
  actievePartijen: [],
  uitslagen: []
};
