// ============================================================
//  nav.js — Navigatie, showPage, wisselLadder
// ============================================================
import { db, auth } from './config.js';
import { store } from './store.js';
import * as S from './store.js';
import { getDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
      if (spelersSnap.exists()) alleSpelersData = spelersSnap.data().lijst || [];
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
