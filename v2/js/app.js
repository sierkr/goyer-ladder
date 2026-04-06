// ============================================================
//  app.js — Entry point, importeert alle modules
//  v2.0.1
// ============================================================
import { initApp, uitloggen, loginSubmit, loginMetGoogle,
  openWachtwoordVergeten, sluitResetWrap, stuurResetEmail,
  openWachtwoordWijzigen, wijzigWachtwoord, toonLoginFout,
  genereerInviteLink, kopieerInviteLink, registreerSpeler,
  laadInviteStatus, registreerNotificatieToken } from './auth.js';

import { showPage, wisselLadder } from './nav.js';

import { renderLadder, toggleLadderKaart } from './ladder.js';

import { initPartijForm, addPlayerSlot, removeSlot, onBaanSelect,
  startPartij, zoekPartijSpeler, selecteerPartijSpelerEl,
  sluitSpelerLijst, slaAangepasteBaanOp, verwijderAangepasteBaan,
  refreshPlayerSlotOptions } from './partij.js';

import { renderRonde, renderScorecard, updateScore, openUitslagModal,
  bevestigUitslag, annuleerEigenPartij, verwijderActievePartij,
  editPartijHcp, verwijderSpelerUitRonde } from './ronde.js';

import { renderUitslagen } from './uitslagen.js';

import { renderAdmin, renderAdminLadders, renderAdminUsers,
  openEditPlayer, saveEditPlayer, removePlayer, addPlayer,
  renderProfiel, openEditUser, saveEditUser, verwijderUser,
  toggleAdminKaart } from './admin.js';

import { renderArchief, stuurUitdaging, accepteerUitdaging,
  weigerUitdaging } from './archief.js';

import { renderToernooi, herlaadToernooien, openToernooiDetail,
  openNieuwToernooi, maakNieuwToernooi, openToernooiSpelers,
  bevestigToernooiAfsluiten } from './toernooi.js';

import { renderLadderInstellingen, slaLadderInstellingenOp,
  renderLadderBeheer, renderLadderSpelers, renderSnapshots,
  herstelSnapshot, maakSnapshot, openKnockoutIndeling } from './beheer.js';

import { renderKnockoutLadderKaart, renderKnockoutIndelingModal,
  slaKnockoutIndelingOp, verwerkKnockoutWinnaar,
  nieuwKnockoutSeizoen } from './knockout.js';

// ─── Window exports voor onclick handlers in HTML ─────────────
window.showPage = showPage;
window.addPlayerSlot = addPlayerSlot;
window.removeSlot = removeSlot;
window.onBaanSelect = onBaanSelect;
window.startPartij = startPartij;
window.updateScore = updateScore;
window.toggleScorecard = toggleScorecard;
window.openUitslagModal = openUitslagModal;
window.setWinnaar = setWinnaar;
window.bevestigUitslag = bevestigUitslag;
window.openAddPlayer = openAddPlayer;
window.saveNewPlayer = saveNewPlayer;
window.openEditPlayer = openEditPlayer;
window.saveEditPlayer = saveEditPlayer;
window.removePlayer = removePlayer;
window.closeModal = closeModal;
window.resetData = resetData;
window.sluitUitslagEnGaNaarLadder = sluitUitslagEnGaNaarLadder;
window.slaAangepasteBaanOp = slaAangepasteBaanOp;
window.verwijderAangepasteBaan = verwijderAangepasteBaan;
window.openToevoegenModal = openToevoegenModal;
window.bevestigToevoegenRonde = bevestigToevoegenRonde;
window.verwijderSpelerUitRonde = verwijderSpelerUitRonde;
window.skipMatchup = skipMatchup;
window.annuleerEigenPartij = annuleerEigenPartij;
window.openBeheerPartij = openBeheerPartij;
window.setBeheerWinnaar = setBeheerWinnaar;
window.bevestigBeheerUitslag = bevestigBeheerUitslag;
window.verwijderActievePartij = verwijderActievePartij;
window.verschuifRank = verschuifRank;

// Extra exports die in HTML gebruikt worden
window.herlaadToernooien = herlaadToernooien;
window.openToernooiDetail = openToernooiDetail;
window.openNieuwToernooi = openNieuwToernooi;
window.maakNieuwToernooi = maakNieuwToernooi;
window.openToernooiSpelers = openToernooiSpelers;
window.bevestigToernooiAfsluiten = bevestigToernooiAfsluiten;
window.renderLadderInstellingen = renderLadderInstellingen;
window.slaLadderInstellingenOp = slaLadderInstellingenOp;
window.renderLadderBeheer = renderLadderBeheer;
window.renderLadderSpelers = renderLadderSpelers;
window.renderSnapshots = renderSnapshots;
window.herstelSnapshot = herstelSnapshot;
window.maakSnapshot = maakSnapshot;
window.openKnockoutIndeling = openKnockoutIndeling;
window.renderKnockoutLadderKaart = renderKnockoutLadderKaart;
window.slaKnockoutIndelingOp = slaKnockoutIndelingOp;
window.verwerkKnockoutWinnaar = verwerkKnockoutWinnaar;
window.nieuwKnockoutSeizoen = nieuwKnockoutSeizoen;
window.renderKnockoutIndelingModal = renderKnockoutIndelingModal;
window.registreerSpeler = registreerSpeler;
window.genereerInviteLink = genereerInviteLink;
window.kopieerInviteLink = kopieerInviteLink;
window.laadInviteStatus = laadInviteStatus;
window.zoekPartijSpeler = zoekPartijSpeler;
window.selecteerPartijSpelerEl = selecteerPartijSpelerEl;
window.sluitSpelerLijst = sluitSpelerLijst;
window.editPartijHcp = editPartijHcp;
window.verwijderSpelerUitRonde = verwijderSpelerUitRonde;
window.annuleerEigenPartij = annuleerEigenPartij;
window.verwijderActievePartij = verwijderActievePartij;
window.openEditPlayer = openEditPlayer;
window.saveEditPlayer = saveEditPlayer;
window.removePlayer = removePlayer;
window.addPlayer = addPlayer;
window.openEditUser = openEditUser;
window.saveEditUser = saveEditUser;
window.verwijderUser = verwijderUser;
window.stuurUitdaging = stuurUitdaging;
window.accepteerUitdaging = accepteerUitdaging;
window.weigerUitdaging = weigerUitdaging;
window.toggleAdminKaart = toggleAdminKaart;
window.wisselLadder = wisselLadder;

// ─── Start de app ─────────────────────────────────────────────
console.log('app.js: alle modules geladen, initApp starten');
try {
  initApp();
  console.log('initApp: aangeroepen');
} catch(e) {
  console.error('initApp mislukt:', e);
}

// ─── Versienummer rechtsboven ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('versie-badge');
  if (badge) badge.textContent = 'v2.0.1';
  // Debug: toon v2 altijd zichtbaar
  if (badge) badge.style.display = '';
});
