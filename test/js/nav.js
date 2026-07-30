// ============================================================
//  nav.js — Navigatie, showPage, wisselLadder
// ============================================================
import { db, auth } from './config.js';
import { store, alleLadders } from './store.js';
import { herlaadToernooien, renderToernooi } from './toernooi.js';
import { renderToernooi2, laadLaatsteConcept } from './toernooi2.js'; // v3.2.0: nieuwbouw toernooi-setup
import { initPartijForm } from './partij.js';
import { laadInviteStatus } from './auth.js';
import { renderAdmin, renderProfiel } from './admin.js';
import { renderAdminLadders } from './beheer.js';
import { renderArchief, verwijderOudeUitslagen } from './archief.js';
import { renderLadder } from './ladder.js';
import { renderRonde } from './ronde.js';
import { renderUitslagen } from './uitslagen.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

//  NAVIGATION
// ============================================================
function showPage(name, evt) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const btn = (evt && evt.currentTarget) || event.currentTarget;
  btn.classList.add('active');

  if (name === 'ladder') renderLadder();
  if (name === 'partij') initPartijForm();
  if (name === 'ronde') renderRonde();
  if (name === 'uitslagen') {
    // Herlaad verse data van alle ladders zodat actieve partijen van anderen zichtbaar zijn
    Promise.all(alleLadders.map(async l => {
      const snap = await getDoc(doc(db, 'ladders', l.id));
      if (snap.exists()) { l.data = snap.data(); l.actievePartijen = snap.data().actievePartijen || []; }
    })).then(() => renderUitslagen()).catch(() => renderUitslagen());
  }
  if (name === 'admin') {
    renderAdmin();
    renderAdminLadders();
    laadInviteStatus();
  }
  if (name === 'toernooi') {
    // v3.2.0: schakelaar oud/nieuw. Zet op false om terug te vallen op de oude setup.
    const GEBRUIK_TOERNOOI2 = false;
    if (GEBRUIK_TOERNOOI2) {
      herlaadToernooien()
        .then(() => laadLaatsteConcept())
        .catch(() => {})
        .then(() => renderToernooi2());
    } else {
      herlaadToernooien().then(() => renderToernooi()).catch(() => renderToernooi());
    }
  }
  if (name === 'profiel') renderProfiel();
  if (name === 'archief') { renderArchief(); verwijderOudeUitslagen(); }
}

// ============================================================

export { showPage };
