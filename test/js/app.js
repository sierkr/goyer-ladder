// ============================================================
//  app.js — Entry point v2.5.4
// ============================================================
import { initApp, uitloggen, loginSubmit, loginMetGoogle, autoAdvance,
  openWachtwoordVergeten, sluitResetWrap, stuurResetEmail,
  openWachtwoordWijzigen, wijzigWachtwoord, toonLoginFout,
  genereerInviteLink, kopieerInviteLink, registreerSpeler,
  laadInviteStatus, registreerNotificatieToken,
  wisselLadder, toonLaadOverlay, checkInviteLink,
  slaEersteLoginOp } from './auth.js';

import { showPage } from './nav.js';
import { renderLadder, toggleLadderKaart } from './ladder.js';
import { initPartijForm, addPlayerSlot, voegGastSpelerToeAanPartij, removeSlot, onBaanSelect,
  startPartij, zoekPartijSpeler, selecteerPartijSpelerEl,
  sluitSpelerLijst, slaAangepasteBaanOp, verwijderAangepasteBaan,
  refreshPlayerSlotOptions } from './partij.js';
import { renderRonde, renderScorecard, updateScore, toggleScorecard,
  openUitslagModal, bevestigUitslag, setWinnaar, skipMatchup,
  editPartijHcp, verwijderSpelerUitRonde, openToevoegenModal,
  bevestigToevoegenRonde, sluitUitslagEnGaNaarLadder, showLadderChanges,
  annuleerEigenPartij, verwijderActievePartij } from './ronde.js';
import { renderUitslagen, openScorekaartDetail, bevestigBeheerUitslag } from './uitslagen.js';
import { renderAdmin, renderAdminSpelersEnAccounts, openAddPlayer,
  toggleHandmatigToevoegen, voegAccountToeAlsSpeler, saveNewPlayer,
  openEditPlayer, saveEditPlayer, removePlayer, renderProfiel,
  slaProfielHcpOp, renderAdminUsers, openEditUser, saveEditUser,
  openAddUser, saveNewUser, removeUser, verschuifRank, resetData,
  closeModal, koppelSpelerIds, kopieerCredentials } from './admin.js';
import { renderArchief, openArchiefDetail, openNieuwSeizoenModal,
  bevestigNieuwSeizoen, stuurUitdaging, reageerUitdaging,
  verwijderUitdaging, openToernooiDetail, toonUitdagingBadge,
  verwijderOudeUitslagen } from './archief.js';
import { renderToernooi, herlaadToernooien, selecteerToernooi, gaNaarToernooiOverzicht, gaNaarLadderTab,
  initToernooiSetup, zoekToernooiSpeler, selecteerToernooiSpeler,
  sluitToernooiSpelerLijst, verwijderToernooiSpelerSelectie,
  voegGastspelerToe, toggleTSpeler, toggleHolesCustom,
  openFlightIndeling, voegFlightToe, wijzigFlightStarttijd,
  wijzigFlightStarthole, verwijderFlight, wijzigFlightNaam,
  wijzigFlightHcp, verplaatsSpelerFlight, startToernooi,
  toggleToernooiMatrix, openToernooiSpelersBeheer,
  zoekToernooiSpelerModal, selecteerToernooiSpelerModal,
  sluitToernooiSpelerModal, voegBestaandeSpelerToeAanToernooi,
  voegGastspelerToeAanToernooi, verwijderToernooiSpelerNieuw,
  openVerwijderToernooiSpeler, verwijderToernooiSpeler,
  refreshToernooiScorekaart, selecteerFlightTab,
  updateTScoreAndAdvance, updateTScore, editToernooiHcp,
  toggleTScorecard, openToernooiAfsluiten, bevestigToernooiAfsluiten,
  annuleerToernooi , toggleTSpelersLadder, toggleTRankingLadder } from './toernooi.js';
import { openStandAanpassen, verschuifStand, slaStandOp,
  openLadderInstellingen, slaLadderInstellingenOp,
  openNieuweLadderModal, maakNieuweLadder, verschuifLadder,
  verwijderLadder, openLadderSpelersModal, slaLadderSpelersOp,
  renderAdminLadders, openSnapshotsModal, slaSnapshotOp,
  herstelSnapshot } from './beheer.js';
import { renderKnockoutLadderKaart, openKnockoutIndeling,
  renderKnockoutIndelingModal, bevestigKnockoutIndeling,
  verwerkKnockoutVoortgang, verwerkKnockoutUitslag,
  slaKnockoutWinnaarOp, nieuwKnockoutSeizoen,
  toggleAdminKaart, koDragStart, koDragOver, koDrop, koDragEnd,
  koTouchStart, koTouchMove, koTouchEnd, verschuifKoSpeler } from './knockout.js';

// ─── Window exports ───────────────────────────────────────────
window.showPage = showPage;
window.autoAdvance = autoAdvance;
window.wisselLadder = wisselLadder;
window.uitloggen = uitloggen;
window.loginSubmit = loginSubmit;
window.loginMetGoogle = loginMetGoogle;
window.openWachtwoordVergeten = openWachtwoordVergeten;
window.sluitResetWrap = sluitResetWrap;
window.stuurResetEmail = stuurResetEmail;
window.openWachtwoordWijzigen = openWachtwoordWijzigen;
window.wijzigWachtwoord = wijzigWachtwoord;
window.registreerSpeler = registreerSpeler;
window.genereerInviteLink = genereerInviteLink;
window.kopieerInviteLink = kopieerInviteLink;
window.laadInviteStatus = laadInviteStatus;
window.toggleLadderKaart = toggleLadderKaart;
window.addPlayerSlot = addPlayerSlot;
window.voegGastSpelerToeAanPartij = voegGastSpelerToeAanPartij;
window.removeSlot = removeSlot;
window.onBaanSelect = onBaanSelect;
window.startPartij = startPartij;
window.zoekPartijSpeler = zoekPartijSpeler;
window.selecteerPartijSpelerEl = selecteerPartijSpelerEl;
window.sluitSpelerLijst = sluitSpelerLijst;
window.slaAangepasteBaanOp = slaAangepasteBaanOp;
window.verwijderAangepasteBaan = verwijderAangepasteBaan;
window.refreshPlayerSlotOptions = refreshPlayerSlotOptions;
window.updateScore = updateScore;
window.toggleScorecard = toggleScorecard;
window.openUitslagModal = openUitslagModal;
window.bevestigUitslag = bevestigUitslag;
window.setWinnaar = setWinnaar;
window.skipMatchup = skipMatchup;
window.editPartijHcp = editPartijHcp;
window.verwijderSpelerUitRonde = verwijderSpelerUitRonde;
window.openToevoegenModal = openToevoegenModal;
window.bevestigToevoegenRonde = bevestigToevoegenRonde;
window.sluitUitslagEnGaNaarLadder = sluitUitslagEnGaNaarLadder;
window.showLadderChanges = showLadderChanges;
window.openAddPlayer = openAddPlayer;
window.toggleHandmatigToevoegen = toggleHandmatigToevoegen;
window.voegAccountToeAlsSpeler = voegAccountToeAlsSpeler;
window.saveNewPlayer = saveNewPlayer;
window.kopieerCredentials = kopieerCredentials;
window.slaEersteLoginOp = slaEersteLoginOp;
window.openEditPlayer = openEditPlayer;
window.saveEditPlayer = saveEditPlayer;
window.removePlayer = removePlayer;
window.slaProfielHcpOp = slaProfielHcpOp;
window.openEditUser = openEditUser;
window.saveEditUser = saveEditUser;
window.openAddUser = openAddUser;
window.saveNewUser = saveNewUser;
window.removeUser = removeUser;
window.verschuifRank = verschuifRank;
window.resetData = resetData;
window.koppelSpelerIds = koppelSpelerIds;
window.closeModal = closeModal;
window.openNieuwSeizoenModal = openNieuwSeizoenModal;
window.bevestigNieuwSeizoen = bevestigNieuwSeizoen;
window.openArchiefDetail = openArchiefDetail;
window.stuurUitdaging = stuurUitdaging;
window.reageerUitdaging = reageerUitdaging;
window.verwijderUitdaging = verwijderUitdaging;
window.selecteerToernooi = selecteerToernooi;
window.zoekToernooiSpeler = zoekToernooiSpeler;
window.selecteerToernooiSpeler = selecteerToernooiSpeler;
window.sluitToernooiSpelerLijst = sluitToernooiSpelerLijst;
window.verwijderToernooiSpelerSelectie = verwijderToernooiSpelerSelectie;
window.voegGastspelerToe = voegGastspelerToe;
window.toggleTSpeler = toggleTSpeler;
window.toggleHolesCustom = toggleHolesCustom;
window.openFlightIndeling = openFlightIndeling;
window.voegFlightToe = voegFlightToe;
window.wijzigFlightStarttijd = wijzigFlightStarttijd;
window.wijzigFlightStarthole = wijzigFlightStarthole;
window.verwijderFlight = verwijderFlight;
window.wijzigFlightNaam = wijzigFlightNaam;
window.wijzigFlightHcp = wijzigFlightHcp;
window.verplaatsSpelerFlight = verplaatsSpelerFlight;
window.startToernooi = startToernooi;
window.toggleToernooiMatrix = toggleToernooiMatrix;
window.openToernooiSpelersBeheer = openToernooiSpelersBeheer;
window.zoekToernooiSpelerModal = zoekToernooiSpelerModal;
window.selecteerToernooiSpelerModal = selecteerToernooiSpelerModal;
window.sluitToernooiSpelerModal = sluitToernooiSpelerModal;
window.voegBestaandeSpelerToeAanToernooi = voegBestaandeSpelerToeAanToernooi;
window.voegGastspelerToeAanToernooi = voegGastspelerToeAanToernooi;
window.verwijderToernooiSpelerNieuw = verwijderToernooiSpelerNieuw;
window.openVerwijderToernooiSpeler = openVerwijderToernooiSpeler;
window.verwijderToernooiSpeler = verwijderToernooiSpeler;
window.refreshToernooiScorekaart = refreshToernooiScorekaart;
window.selecteerFlightTab = selecteerFlightTab;
window.updateTScoreAndAdvance = updateTScoreAndAdvance;
window.updateTScore = updateTScore;
window.editToernooiHcp = editToernooiHcp;
window.toggleTScorecard = toggleTScorecard;
window.openToernooiAfsluiten = openToernooiAfsluiten;
window.bevestigToernooiAfsluiten = bevestigToernooiAfsluiten;
window.annuleerToernooi = annuleerToernooi;
window.gaNaarToernooiOverzicht = gaNaarToernooiOverzicht;
window.gaNaarLadderTab = gaNaarLadderTab;
window.openStandAanpassen = openStandAanpassen;
window.verschuifStand = verschuifStand;
window.slaStandOp = slaStandOp;
window.openLadderInstellingen = openLadderInstellingen;
window.slaLadderInstellingenOp = slaLadderInstellingenOp;
window.openNieuweLadderModal = openNieuweLadderModal;
window.maakNieuweLadder = maakNieuweLadder;
window.verschuifLadder = verschuifLadder;
window.verwijderLadder = verwijderLadder;
window.openLadderSpelersModal = openLadderSpelersModal;
window.slaLadderSpelersOp = slaLadderSpelersOp;
window.renderAdminLadders = renderAdminLadders;
window.openSnapshotsModal = openSnapshotsModal;
window.slaSnapshotOp = slaSnapshotOp;
window.herstelSnapshot = herstelSnapshot;
window.renderKnockoutLadderKaart = renderKnockoutLadderKaart;
window.koDragStart = koDragStart;
window.koDragOver = koDragOver;
window.koDrop = koDrop;
window.koDragEnd = koDragEnd;
window.koTouchStart = koTouchStart;
window.koTouchMove = koTouchMove;
window.koTouchEnd = koTouchEnd;
window.verschuifKoSpeler = verschuifKoSpeler;
window.openKnockoutIndeling = openKnockoutIndeling;
window.bevestigKnockoutIndeling = bevestigKnockoutIndeling;
window.verwerkKnockoutVoortgang = verwerkKnockoutVoortgang;
window.verwerkKnockoutUitslag = verwerkKnockoutUitslag;
window.slaKnockoutWinnaarOp = slaKnockoutWinnaarOp;
window.nieuwKnockoutSeizoen = nieuwKnockoutSeizoen;
window.toggleAdminKaart = toggleAdminKaart;

// ─── Versienummer — direct zetten zodat zichtbaar is dat app.js laadt ────────
document.addEventListener('DOMContentLoaded', () => {
  const VERSION = 'v3.0.0-11';
  const badge = document.getElementById('versie-badge');
  if (badge) { badge.textContent = VERSION; badge.style.display = ''; }
  document.querySelectorAll('.login-versie').forEach(el => el.textContent = VERSION);
});

window.openScorekaartDetail = openScorekaartDetail;
window.openToernooiDetail = openToernooiDetail;
window.bevestigBeheerUitslag = bevestigBeheerUitslag;

window.annuleerEigenPartij = annuleerEigenPartij;
window.verwijderActievePartij = verwijderActievePartij;



window.toggleTSpelersLadder = toggleTSpelersLadder;
window.toggleTRankingLadder = toggleTRankingLadder;

// ─── Start ────────────────────────────────────────────────────
try {
  initApp();
} catch(e) {
  console.error('initApp mislukt:', e);
}
