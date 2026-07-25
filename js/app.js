// ============================================================
//  app.js — Entry point v3.0.0
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
import { initPartijForm, addPlayerSlot, voegGastSpelerToeAanPartij, removeSlot, onBaanSelect, onSpeltypeChange,
  startPartij, zoekPartijSpeler, selecteerPartijSpelerEl,
  sluitSpelerLijst, slaAangepasteBaanOp, verwijderAangepasteBaan,
  refreshPlayerSlotOptions, slaPartijFormulierOp, scanScorekaartFoto } from './partij.js';
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
  closeModal, kopieerCredentials,
  vraagResetWachtwoord,
  toggleWachtwoordBeheer, slaInitieelWachtwoordOp,
  openBulkImport, sluitBulkImport, voegBulkRijToe, startBulkImport, kopieerBulkCredentials } from './admin.js';
import { renderArchief, openArchiefDetail, openNieuwSeizoenModal,
  bevestigNieuwSeizoen, stuurUitdaging, reageerUitdaging,
  verwijderUitdaging, openToernooiDetail, toonUitdagingBadge,
  verwijderOudeUitslagen, verwijderArchiefSeizoen } from './archief.js';
import { renderToernooi, herlaadToernooien, selecteerToernooi, gaNaarToernooiOverzicht, gaNaarLadderTab,
  initToernooiSetup, zoekToernooiSpeler, selecteerToernooiSpeler,
  sluitToernooiSpelerLijst, verwijderToernooiSpelerSelectie,
  voegGastspelerToe, toggleTSpeler, toggleHolesCustom,
  openFlightIndeling, openFlightIndelingDag, slaFlightIndelingDagOp,
  voegFlightToe, wijzigFlightStarttijd,
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
  annuleerToernooi, toggleTSpelersLadder, toggleTRankingLadder,
  selecteerDag, openNieuweDagModal, voegDagToe, sluitDagAf, renderDagBlokken } from './toernooi.js';
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
window.onSpeltypeChange = onSpeltypeChange;
window.startPartij = startPartij;
window.zoekPartijSpeler = zoekPartijSpeler;
window.selecteerPartijSpelerEl = selecteerPartijSpelerEl;
window.sluitSpelerLijst = sluitSpelerLijst;
window.slaAangepasteBaanOp = slaAangepasteBaanOp;
window.scanScorekaartFoto = scanScorekaartFoto;
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
window.vraagResetWachtwoord = vraagResetWachtwoord;
window.toggleWachtwoordBeheer = toggleWachtwoordBeheer;
window.slaInitieelWachtwoordOp = slaInitieelWachtwoordOp;
window.openBulkImport = openBulkImport;
window.sluitBulkImport = sluitBulkImport;
window.voegBulkRijToe = voegBulkRijToe;
window.startBulkImport = startBulkImport;
window.kopieerBulkCredentials = kopieerBulkCredentials;
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
window.closeModal = closeModal;
window.openNieuwSeizoenModal = openNieuwSeizoenModal;
window.bevestigNieuwSeizoen = bevestigNieuwSeizoen;
window.verwijderArchiefSeizoen = verwijderArchiefSeizoen;
window.openArchiefDetail = openArchiefDetail;
window.openToernooiDetail = openToernooiDetail;
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
window.selecteerDag = selecteerDag;
window.openNieuweDagModal = openNieuweDagModal;
window.voegDagToe = voegDagToe;
window.sluitDagAf = sluitDagAf;
window.renderDagBlokken = renderDagBlokken;
window.openFlightIndelingDag = openFlightIndelingDag;
window.slaFlightIndelingDagOp = slaFlightIndelingDagOp;
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
// v3.0.0-11.3: TEST-suffix als app draait onder /test/ (maakt productie vs test zichtbaar)
document.addEventListener('DOMContentLoaded', () => {
  const VERSION = 'v3.0.5';
  const IS_TEST = location.pathname.includes('/test/');
  const label = VERSION + (IS_TEST ? ' TEST' : '');
  const badge = document.getElementById('versie-badge');
  if (badge) {
    badge.textContent = label;
    badge.style.display = '';
    if (IS_TEST) {
      // Maak badge opvallend in test (rood-oranje achtergrond)
      badge.style.background = '#ff6b35';
      badge.style.color = 'white';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '4px';
      badge.style.fontWeight = '600';
    }
  }
  document.querySelectorAll('.login-versie').forEach(el => {
    el.textContent = label;
    if (IS_TEST) {
      el.style.color = '#ff6b35';
      el.style.fontWeight = '600';
    }
  });
});

window.openScorekaartDetail = openScorekaartDetail;
window.bevestigBeheerUitslag = bevestigBeheerUitslag;

window.annuleerEigenPartij = annuleerEigenPartij;
window.verwijderActievePartij = verwijderActievePartij;


window.toggleTSpelersLadder = toggleTSpelersLadder;
window.toggleTRankingLadder = toggleTRankingLadder;

// ─── Versie-check & auto-update ──────────────────────────────
// v3.0.0-11.33: Vergelijk periodiek de ingebakken versie met version.json op de server.
// v3.0.0-11.107: GEEN hard reload meer bij versie-mismatch.
// In plaats daarvan een niet-storende banner met "Update beschikbaar" knop.
// Zo wordt scoring nooit onderbroken door een automatische reload.
(function initVersieCheck() {
  const LOKALE_VERSIE = 'v3.0.5';
  let _versieCheckBezig = false;
  let _updateBannerZichtbaar = false;

  function toonUpdateBanner(nieuweVersie) {
    if (_updateBannerZichtbaar) return;
    _updateBannerZichtbaar = true;

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;' +
      'background:#2d6a4f;color:white;padding:10px 16px;display:flex;' +
      'align-items:center;justify-content:space-between;gap:10px;' +
      'font-family:"DM Sans",sans-serif;font-size:13px;box-shadow:0 -2px 8px rgba(0,0,0,0.15)';

    banner.innerHTML = `
      <span>🔄 Update beschikbaar: ${LOKALE_VERSIE} → ${nieuweVersie}</span>
      <div style="display:flex;gap:6px">
        <button onclick="document.getElementById('update-banner').remove();window._updateBannerGesloten=true"
          style="padding:6px 12px;border-radius:6px;border:1.5px solid rgba(255,255,255,0.5);background:transparent;color:white;cursor:pointer;font-family:inherit;font-size:12px">
          Later
        </button>
        <button onclick="(function(){try{slaPartijFormulierOp()}catch(e){}setTimeout(function(){location.reload()},200)})()"
          style="padding:6px 12px;border-radius:6px;border:none;background:white;color:#2d6a4f;cursor:pointer;font-weight:700;font-family:inherit;font-size:12px">
          Nu updaten
        </button>
      </div>`;

    document.body.appendChild(banner);
  }

  async function checkVersie() {
    if (_versieCheckBezig || _updateBannerZichtbaar) return;
    // Als gebruiker banner heeft weggeklikt, niet opnieuw tonen in deze sessie
    if (window._updateBannerGesloten) return;
    _versieCheckBezig = true;
    try {
      const resp = await fetch('./version.json', { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      const serverVersie = data && data.version ? String(data.version).trim() : null;
      if (!serverVersie || serverVersie === LOKALE_VERSIE) return;

      console.log(`[versieCheck] update gevonden: ${LOKALE_VERSIE} → ${serverVersie}`);
      toonUpdateBanner(serverVersie);
    } catch(e) {
      // Offline of netwerk fout — stil falen
    } finally {
      _versieCheckBezig = false;
    }
  }

  // a) Check 10s na app-start (geeft Firestore tijd om te laden)
  setTimeout(checkVersie, 10000);

  // b) Check elke 5 minuten
  setInterval(checkVersie, 5 * 60 * 1000);

  // c) Check zodra app vanuit achtergrond terugkomt (tab focus / PWA resume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkVersie();
  });

  // d) Check na SW_ACTIVATED bericht van nieuwe service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && event.data.type === 'SW_ACTIVATED') {
        console.log('[versieCheck] SW_ACTIVATED ontvangen, check versie...');
        checkVersie();
      }
    });
  }
})();

// ─── Start ────────────────────────────────────────────────────
try {
  initApp();
} catch(e) {
  console.error('initApp mislukt:', e);
}
