// ============================================================
//  nav.js — Navigatie, showPage, wisselLadder
// ============================================================
import { db, auth, SPELERS_DOC } from './config.js';
import { store, alleSpelersData } from './store.js';
import { herlaadToernooien, renderToernooi } from './toernooi.js';
import { initPartijForm } from './partij.js';
import { laadInviteStatus } from './auth.js';
import { renderAdmin, renderProfiel } from './admin.js';
import { renderAdminLadders } from './beheer.js';
import { renderArchief, verwijderOudeUitslagen } from './archief.js';
import { renderLadder } from './ladder.js';
import { renderRonde } from './ronde.js';
import { renderUitslagen } from './uitslagen.js';
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

//  NAVIGATION
// ============================================================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  event.currentTarget.classList.add('active');

  if (name === 'ladder') renderLadder();
  if (name === 'partij') initPartijForm();
  if (name === 'ronde') renderRonde();
  if (name === 'uitslagen') renderUitslagen();
  if (name === 'admin') {
    // Alleen spelerslijst vers ophalen — ladders worden bijgehouden via listeners
    getDoc(SPELERS_DOC).then(spelersSnap => {
      if (spelersSnap.exists()) store.alleSpelersData = spelersSnap.data().lijst || [];
      renderAdmin();
      renderAdminLadders();
      laadInviteStatus();
    });
  }
  if (name === 'toernooi') { herlaadToernooien().then(() => renderToernooi()); }
  if (name === 'profiel') renderProfiel();
  if (name === 'archief') { renderArchief(); verwijderOudeUitslagen(); }
}

// ============================================================

export { showPage };
