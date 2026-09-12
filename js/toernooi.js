// ============================================================
//  toernooi.js — v3.0.0-11.106
//  Meerdaags toernooi: scores/flights/baan per dag
//  v11.106: live/-subcollectie als bron van waarheid; scorekaart bovenaan voor spelers
//  Datastructuur: t.dagen[dagNr-1].{datum,baan,holes,flights,scores,afgerond}
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr, functions, httpsCallable, IS_TEST, IS_EMULATOR, EMAIL_SUFFIX, firebaseConfig, loginNaamVan } from './config.js';
// v5.2.1: toernooi-uitslag schrijft standen en punten samen weg (server-side).
const _verwerkToernooiStandenFn = httpsCallable(functions, 'verwerkToernooiStanden');
// v5.10.0: verwijdert een Auth-account waarvan het profiel al weg is. Bestond
// al voor wees-accounts uit de bulk-import; hier hergebruikt voor gastlogins.
const _verwijderGastAccountFn = httpsCallable(functions, 'verwijderWeesAccount');
import { store, alleLadders, activeLadderId, alleSpelersData, huidigeBruiker, archiefData, toernooiData, alleToernooien, actieveToernooiId, _vasteListeners, _toernooiListeners, _tGeselecteerdeSpelers, _tSpelersLadderIds, _tRankingLadderIds, _flights, _liveScores } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { renderHcpBlok, alleBANEN, renderHandmatigHoles, kortNaamMap } from './partij.js';
import { renderLadder } from './ladder.js';
import { slaSnapshotOp } from './beheer.js';
import { toggleAdminKaart } from './knockout.js';
import { getLadderSpelers } from './ladder-view.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';

// ============================================================
//  HELPERS — dag-abstractie
// ============================================================

// Geeft de actieve dag terug (object uit t.dagen[])
// v4.0.0: respecteert een lokale bekijk-dag (window._bekijkDagNr) zodat het
// bekijken van een andere dag NIET meer naar Firestore wordt geschreven en
// dus geen invloed heeft op andere gebruikers (fix 7.4).
// ============================================================
//  FOUTMELDINGEN DIE IETS ZEGGEN  (v5.9.0)
// ============================================================
//  WAT ER MIS WAS. Elke `catch` in dit bestand meldde "Er is iets misgegaan,
//  probeer opnieuw". Toen Sierk op 11 september 2026 een toernooi niet kon
//  starten, was dat het enige wat hij te zien kreeg: dertien verschillende
//  oorzaken, één tekst. De echte fout stond in het verborgen logboek van de
//  browser — op een telefoon onbereikbaar. Dat heeft een avond gekost.
//
//  `toernooiFout()` zet de echte oorzaak in de melding, mét de plek waar het
//  misging. Dat is genoeg om het aan de telefoon voor te lezen.
//
//  ⚠ Deze functie mag zelf nooit omvallen — hij draait per definitie op het
//  moment dat er al iets stuk is (BOUWNORMEN, regel 3).
function toernooiFoutTekst(e) {
  try {
    if (!e) return 'onbekende oorzaak';
    if (typeof e === 'string') return e.slice(0, 160);
    const code = e.code ? String(e.code) : '';
    const melding = e.message ? String(e.message) : '';
    const tekst = [code, melding].filter(Boolean).join(' — ') || String(e);
    return tekst.slice(0, 160);
  } catch (_) { return 'onbekende oorzaak'; }
}

function toernooiFout(waar, e) {
  try { console.error(waar + ' mislukt:', e); } catch (_) {}
  try { toast(waar + ' mislukt: ' + toernooiFoutTekst(e), 9000); }
  catch (_) { /* zelfs de melding mag de app niet omver trekken */ }
}

function actieveDag(t) {
  t = t || toernooiData;
  if (!t) return null;
  const dagNr = window._bekijkDagNr ?? t.actiefDagNr ?? 1;
  return (t.dagen || [])[dagNr - 1]
      || (t.dagen || [])[(t.actiefDagNr || 1) - 1]
      || null;
}

// Geeft dag op basis van dagNr (1-based)
function getDag(t, dagNr) {
  return (t.dagen || [])[dagNr - 1] || null;
}

// Sla de actieve toernooiData op in Firestore (debounced via optionele delay)
async function slaToernooiOp(delay) {
  if (!actieveToernooiId) return;
  if (delay) {
    clearTimeout(window._tSaveTimer);
    window._tSaveTimer = setTimeout(async () => {
      try { await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData))); }
      catch(e) { console.error('Score opslaan mislukt:', e); }
    }, delay);
  } else {
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
  }
}

// ============================================================
//  RENDER TOERNOOI (hoofd)
// ============================================================
function renderToernooi() {
  const isBeheerder = isCoordinatorRol();
  const uid = huidigeBruiker?.uid;

  const mijnToernooien = isBeheerder
    ? alleToernooien
    : alleToernooien.filter(t =>
        uid && (t.spelers || []).some(s => s.uid === uid)
      );

  const wrap = document.getElementById('toernooi-actief-wrap');
  const setup = document.getElementById('toernooi-setup-wrap');

  // v5.9.0: het aanmaakformulier verdwijnt zodra er een toernooi loopt.
  //
  // WAT ER MIS WAS: hier stond `setup.style.display = isBeheerder ? 'block' : 'none'`
  // zonder te kijken of er al een toernooi draait. Boven een vol lopend toernooi
  // stond dus "Nog geen deelnemers geselecteerd" — Sierk las dat als een leeg
  // toernooi terwijl er eronder negen spelers in vier flights zaten. Erger: je
  // kon er een TWEEDE actief toernooi mee starten, en herlaadToernooien() pakte
  // dan `alleToernooien[0]` uit een query zonder sorteervolgorde. Welk toernooi
  // je te zien kreeg was dan willekeurig.
  //
  // Het formulier is niet weg, alleen opgeborgen achter één knop.
  const heeftLopendToernooi = mijnToernooien.length > 0;
  const toonFormulier = isBeheerder && (!heeftLopendToernooi || window._toonNieuwToernooiFormulier === true);
  setup.style.display = toonFormulier ? 'block' : 'none';
  if (toonFormulier) initToernooiSetup();
  renderGeannuleerdeKnop(isBeheerder && toonFormulier); // v4.0.0 (fix 7.2)
  renderNieuwToernooiKnop(isBeheerder && heeftLopendToernooi && !toonFormulier); // v5.9.0

  if (mijnToernooien.length > 0) {
    wrap.style.display = 'block';

    let html = '';
    if (isBeheerder && mijnToernooien.length > 1) {
      html += `<div style="display:flex;gap:8px;overflow-x:auto;padding:12px 16px;border-bottom:1px solid var(--border);scrollbar-width:none">`;
      mijnToernooien.forEach(t => {
        const actief = t.id === actieveToernooiId;
        html += `<button onclick="selecteerToernooi('${escAttr(t.id)}')" style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1.5px solid ${actief ? 'var(--green)' : 'var(--border)'};background:${actief ? 'var(--green)' : 'white'};color:${actief ? 'white' : 'var(--dark)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">${esc(t.naam)}</button>`;
      });
      html += '</div>';
    }
    wrap.innerHTML = html + '<div id="toernooi-detail"></div>';

    if (!actieveToernooiId || !mijnToernooien.find(t => t.id === actieveToernooiId)) {
      store.actieveToernooiId = mijnToernooien[0].id;
      store.toernooiData = mijnToernooien[0];
    }
    renderToernooiActief();
  } else {
    wrap.style.display = 'none';
    // Setup formulier alleen voor beheerder — gewone spelers zien nooit het aanmaakscherm
    setup.style.display = isBeheerder ? 'block' : 'none';
    if (isBeheerder) {
      window._toonNieuwToernooiFormulier = false;
      initToernooiSetup();
    } else {
      // v3.0.0-11.73: wachtmelding voor spelers zonder actief toernooi
      const bestaand = document.getElementById('toernooi-leeg-melding');
      if (bestaand) bestaand.remove();
      const emptyDiv = document.createElement('div');
      emptyDiv.id = 'toernooi-leeg-melding';
      emptyDiv.className = 'card';
      emptyDiv.innerHTML = '<div class="empty" style="padding:32px 20px">' +
        '<div class="empty-icon">🏌️</div>' +
        '<p style="font-size:15px;font-weight:600;margin-bottom:8px">Geen actief toernooi</p>' +
        '<p style="font-size:13px;color:var(--mid)">Op dit moment is er geen toernooi actief, wacht hier totdat het toernooi begint.</p>' +
        '</div>';
      const pageEl = document.getElementById('page-toernooi');
      if (pageEl) pageEl.appendChild(emptyDiv);
    }
  }
}

// ============================================================
//  SPELER LIVE SCORE OPSLAAN — v3.0.0-11.73
// ============================================================
// Spelers mogen het hoofddocument (toernooien/{id}) niet schrijven.
// Ze schrijven hun eigen scores naar de subcollectie toernooien/{id}/live/{uid}.
// De coordinator-onSnapshot listener pikt dit op en mergt de scores
// in het hoofddocument.
// v3.0.0-11.106: Per-uid debounce timers zodat gelijktijdige score-invoer
// voor meerdere spelers (door coordinator) niet elkaars timer overschrijft.
// v5.3.0 — WAT ER MIS WAS: live/{uid} bevatte precies EEN dag
// (`{ dagNr, scores }`) en werd bij elke schrijfactie volledig overschreven.
// Zodra dag 2 begon, verdween daarmee de live-invoer van dag 1 voor die
// speler. Was dag 1 nog niet afgesloten, dan bestonden die scores alleen nog
// in het geheugen van het apparaat van de coordinator — en werden ze
// definitief gewist zodra iemand een score voor dag 2 invoerde. Voor een
// meerdaags toernooi is dat stil dataverlies.
//
// Nu bewaart het document de scores per dag onder `dagen`, met merge:true
// zodat andere dagen ongemoeid blijven. `dagNr` en `scores` blijven ernaast
// staan voor schermen die nog het oude formaat lezen.
//
// v5.11.0: `laag` zegt WIE dit intikte — 'dagen' (de speler zelf),
// 'markerDagen' (zijn marker) of 'beheerDagen' (de wedstrijdleiding). De drie
// lagen staan in hetzelfde document maar raken elkaar niet, dus ze kunnen
// elkaar ook niet meer overschrijven. De wachttijd loopt per laag apart:
// anders wist de timer van de marker die van de speler.
async function slaSpelerScoreOp(uid, dagNr, scores, laag = 'dagen') {
  if (!actieveToernooiId || !uid) return;
  if (!window._tSpelerSaveTimers) window._tSpelerSaveTimers = {};
  const sleutel = uid + '|' + laag;
  clearTimeout(window._tSpelerSaveTimers[sleutel]);
  window._tSpelerSaveTimers[sleutel] = setTimeout(async () => {
    try {
      const velden = { [laag]: { [String(dagNr)]: scores }, timestamp: Date.now() };
      // Het oude formaat (`dagNr` + `scores` los ernaast) blijft alleen voor de
      // speler meelopen, zodat schermen die het nog lezen niet omvallen.
      if (laag === 'dagen') { velden.dagNr = dagNr; velden.scores = scores; }
      await setDoc(doc(db, 'toernooien', actieveToernooiId, 'live', uid), velden, { merge: true });
    } catch(e) {
      console.error('Speler score opslaan mislukt:', e);
    }
  }, 800);
}

// ============================================================
//  SCORES OP HET SCHERM HOUDEN — v5.11.0
// ============================================================
//  WAT ER MIS WAS (gemeten op test, 12 september 2026). Zet de coordinator
//  een vinkje om — "Scores verbergen", "Toernooi-modus" — dan schrijft dat
//  naar het toernooidocument. Twee meeluisteraars reageren daarop: die in dit
//  bestand hield de ingevoerde scores vast, die in js/auth.js (de lijst met
//  actieve toernooien) niet. Die tweede verving de gegevens door de kale
//  serverversie, en op de server staan de scores van een LOPENDE dag nog niet:
//  die staan tot "dag afsluiten" in de live/-submap.
//
//  Gevolg op het scherm: de invoervakjes werden leeg getekend terwijl de
//  regel "Tot" gewoon het juiste totaal bleef tonen. Er ging niets verloren —
//  maar wie over zo'n leeg ogend vakje heen typt, overschrijft wél een goede
//  score. Sierk zag precies dat.
//
//  ⚠ Kijk naar de dag die op het SCHERM staat, niet naar de dag die "actief"
//  heet: met `_bekijkDagNr` kun je naar een andere dag kijken, en zoek de dag
//  op dagNr op — sinds een dag verwijderd kan worden, is de plek in de rij
//  niet meer hetzelfde als het dagnummer.
// ============================================================
function behoudLiveScores(nieuweData) {
  if (!nieuweData || !toernooiData) return nieuweData;
  if (nieuweData.id && actieveToernooiId && nieuweData.id !== actieveToernooiId) return nieuweData;
  const nieuweDagen = nieuweData.dagen || [];
  (toernooiData.dagen || []).forEach(oud => {
    if (!oud || oud.afgerond || !oud.scores) return;
    const nw = nieuweDagen.find(d => d && d.dagNr === oud.dagNr);
    if (!nw || nw.afgerond) return;
    nw.scores = oud.scores;
  });
  return nieuweData;
}

// ============================================================
//  MARKERS EN DE DRIE SCOREKAARTEN — v5.11.0
// ============================================================
//  In een toernooi houdt een MARKER de kaart bij van één medespeler. Pas als
//  speler en marker hetzelfde getal hebben staan, is een hole betrouwbaar.
//
//  Daarom staan er per speler DRIE lagen in `toernooien/{id}/live/{spelerUid}`:
//
//      dagen        wat de speler zelf intikte      (bestond al)
//      markerDagen  wat zijn marker intikte         (nieuw)
//      beheerDagen  wat de wedstrijdleiding vaststelde (nieuw, beslissend)
//
//  ⚠ WAT ER MIS WAS. Tot v5.10.0 schreven de speler EN de coordinator in
//  precies hetzelfde veld. Wie het laatst typte won, zonder spoor en zonder
//  melding. Door de lagen uit elkaar te halen kan dat niet meer, en kunnen we
//  bovendien laten zien of een score al gecontroleerd is.
//
//  Wie wat ziet: ieder ziet het getal dat hij ZELF heeft ingetikt, de
//  wedstrijdleiding ziet dat van de speler. Niemand ziet het getal van de
//  ander — speler en marker moeten het er onderling over eens worden, en dat
//  gaat niet als je elkaars antwoord kunt overschrijven.
// ============================================================

// Verdeelt de markers in een kring over een flight: de eerste markeert de
// tweede, de tweede de derde, de laatste weer de eerste. Bij twee spelers
// markeren ze elkaar; bij één speler is er niets te markeren.
// Geeft terug: { spelerUid: uid van degene die ZIJN kaart bijhoudt }.
function markerKring(spelerIds) {
  const ids = (spelerIds || []).filter(Boolean);
  const kring = {};
  if (ids.length < 2) return kring;
  ids.forEach((uid, i) => { kring[uid] = ids[(i - 1 + ids.length) % ids.length]; });
  return kring;
}

// Wie markeert deze speler op deze dag? Een vaste indeling in de flight gaat
// voor; staat die er niet (oudere toernooien), dan wordt de kring afgeleid uit
// de volgorde van de flight. Buiten een flight is er geen marker.
function markerVan(spelerUid, dag) {
  for (const f of (dag?.flights || [])) {
    const ids = f.spelerIds || [];
    if (!ids.includes(spelerUid)) continue;
    // Een vastgelegde marker die intussen uit de flight is gehaald telt niet
    // meer mee — anders wacht die kaart voor eeuwig op iemand die er niet is.
    const vast = f.markers && f.markers[spelerUid];
    if (vast && ids.includes(vast)) return vast;
    return markerKring(ids)[spelerUid] || null;
  }
  return null;
}

// Haalt één laag van één dag uit een live-document.
// `laag` is 'dagen', 'markerDagen' of 'beheerDagen'.
function _laagVanDag(data, laag, dagNr) {
  if (!data) return null;
  const perDag = data[laag]?.[String(dagNr)];
  if (Array.isArray(perDag)) return perDag;
  // v5.3.0-formaat: één losse dag naast `dagen`. Gold alleen voor de speler.
  if (laag === 'dagen' && data.dagNr === dagNr && Array.isArray(data.scores)) return data.scores;
  return null;
}

// De drie lagen van één speler op één dag, altijd als array (leeg mag).
function lagenVanDag(data, dagNr) {
  return {
    speler: _laagVanDag(data, 'dagen',       dagNr) || [],
    marker: _laagVanDag(data, 'markerDagen', dagNr) || [],
    beheer: _laagVanDag(data, 'beheerDagen', dagNr) || [],
  };
}

// Het oordeel over ÉÉN hole. Dit is de enige plek waar wordt bepaald welke
// score telt en welke kleur erbij hoort; scorekaart, onderlinge stand,
// ranglijst, dag afsluiten en de meekijkpagina leunen er allemaal op.
//
//   zwart   vastgesteld door de wedstrijdleiding, OF speler en marker gelijk
//   oranje  één van de twee heeft ingevuld, de ander nog niet
//   rood    allebei ingevuld, verschillend
//   leeg    nog niemand
//
// `vast` betekent: de wedstrijdleiding heeft het laatste woord gesproken.
// Speler en marker kunnen die hole dan niet meer wijzigen — anders kan een
// gecontroleerde score weer opengetrokken worden.
function scoreOordeel(spelerWaarde, markerWaarde, beheerWaarde) {
  const leeg = (v) => v === null || v === undefined || v === '';
  const sp = leeg(spelerWaarde) ? null : Number(spelerWaarde);
  const mk = leeg(markerWaarde) ? null : Number(markerWaarde);
  const bh = leeg(beheerWaarde) ? null : Number(beheerWaarde);

  if (bh !== null) {
    return { kleur: 'zwart', vast: true, tel: bh, speler: bh, marker: bh, beheer: bh };
  }
  // Wat meetelt zolang er niets is vastgesteld: het getal van de speler zelf.
  // Heeft alleen de marker ingevuld, dan is dat het enige getal dat er is.
  const tel = sp !== null ? sp : mk;
  let kleur = 'leeg';
  if (sp !== null && mk !== null) kleur = (sp === mk) ? 'zwart' : 'rood';
  else if (sp !== null || mk !== null) kleur = 'oranje';

  return { kleur, vast: false, tel, speler: sp, marker: mk, beheer: null };
}

// v5.3.0 / v5.11.0: de scores van één speler op één dag, zoals ze MEETELLEN.
// Geeft null als deze speler voor deze dag in geen enkele laag iets heeft —
// daar rekenen de meeluisteraar en het afsluiten van een dag op.
function _liveScoresVanDag(data, dagNr) {
  if (!data) return null;
  const l = lagenVanDag(data, dagNr);
  const lengte = Math.max(l.speler.length, l.marker.length, l.beheer.length);
  if (lengte === 0) return null;
  const uit = [];
  for (let i = 0; i < lengte; i++) {
    uit.push(scoreOordeel(l.speler[i], l.marker[i], l.beheer[i]).tel);
  }
  return uit;
}

// Vat een scorekaart samen voor de waarschuwingsregel erboven. `kleuren` is
// een lijst van { holeNr, kleur }. Die regel staat bij speler, marker EN
// wedstrijdleiding — een rood vakje halverwege een kaart van 18 holes zie je
// op een telefoon anders niet.
function kaartOordeel(kleuren) {
  const verschillen = (kleuren || []).filter(k => k.kleur === 'rood').map(k => k.holeNr);
  const wachtend    = (kleuren || []).filter(k => k.kleur === 'oranje').map(k => k.holeNr);
  const delen = [];
  if (verschillen.length > 0) {
    delen.push(verschillen.length === 1
      ? `1 verschil (hole ${verschillen[0]})`
      : `${verschillen.length} verschillen (holes ${verschillen.join(', ')})`);
  }
  if (wachtend.length > 0) {
    delen.push(wachtend.length === 1
      ? '1 hole wacht op bevestiging'
      : `${wachtend.length} holes wachten op bevestiging`);
  }
  return { verschillen, wachtend, tekst: delen.join(' · ') };
}

// ============================================================
//  BAAN SELECTOR IN TOERNOOI SETUP
// ============================================================

// Per dag-blok: onchange handler voor de baan-select
function onTDagBaanSelect(sel, dagNr) {
  const hw = document.getElementById(`t-baan-handmatig-${dagNr}`);
  if (!hw) return;
  if (sel.value === 'Handmatig invoeren') {
    hw.style.display = 'block';
    // Tijdelijk actieve dag-context opslaan zodat slaAangepasteBaanOp het juiste blok weet
    window._activeTDagNr = dagNr;
    renderHandmatigHoles(`toernooi-${dagNr}`);
  } else {
    hw.style.display = 'none';
  }
}
window.onTDagBaanSelect = onTDagBaanSelect;

window.addEventListener('baanToegevoegd', (e) => {
  const naam = e.detail?.naam;
  // Verberg alle open handmatig-containers
  document.querySelectorAll('[id^="t-baan-handmatig-"]').forEach(el => { el.style.display = 'none'; });
  // Herlaad dag-blokken (vernieuwt baan-opties)
  renderDagBlokken();
  // Selecteer de nieuwe baan in alle dag-blokken (het blok dat de baan heeft aangemaakt)
  if (naam) {
    const dagNr = window._activeTDagNr;
    const container = document.getElementById('t-dag-blokken');
    if (container && dagNr) {
      const blokken = container.querySelectorAll('.dag-blok');
      const blok = blokken[dagNr - 1];
      if (blok) {
        const sel = blok.querySelector('.t-dag-baan');
        if (sel && [...sel.options].some(o => o.value === naam)) sel.value = naam;
      }
    }
    window._activeTDagNr = null;
  }
});

// ============================================================
//  HERLAAD TOERNOOIEN
// ============================================================
async function herlaadToernooien() {
  try {
    const snap = await getDocs(query(TOERNOOIEN_COL, where('status', '==', 'actief')));
    // v5.9.0: nieuwste eerst. Een Firestore-query zonder orderBy heeft geen
    // vaste volgorde, en op meerdere plekken wordt `alleToernooien[0]` gebruikt
    // als "het" toernooi. Zijn er door een eerdere fout twee actief, dan kreeg
    // je willekeurig het ene of het andere te zien. Nu is het voorspelbaar de
    // laatst aangemaakte.
    store.alleToernooien = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (actieveToernooiId) {
      const gevonden = alleToernooien.find(t => t.id === actieveToernooiId);
      store.toernooiData = gevonden || (alleToernooien.length > 0 ? alleToernooien[0] : null);
    }
    if (!toernooiData && alleToernooien.length > 0) {
      store.toernooiData = alleToernooien[0];
      store.actieveToernooiId = alleToernooien[0].id;
    }
    if (toernooiData) store.actieveToernooiId = toernooiData.id;

    herlaadToernooiListeners();
  } catch(e) { console.error('Toernooien laden mislukt:', e); }
}

// v3.0.0-11.106: Per-document onSnapshot listeners voor actieve toernooien.
// Wordt aangeroepen vanuit herlaadToernooien() en vanuit de collectie-onSnapshot
// in auth.js zodat listeners altijd actueel zijn.
function herlaadToernooiListeners() {
  _toernooiListeners.forEach(unsub => unsub());
  store._toernooiListeners = [];

  // v5.11.0: ⚠ NIET zomaar leeggooien. Deze functie draait bij ELKE wijziging
  // in de toernooien-collectie, en de scorelagen (wie tikte wat in) staan in
  // _liveScores. Werd die leeggegooid, dan viel de scorekaart tot de volgende
  // meeluister-melding terug op het toernooidocument — en daar staat alleen
  // wat MEETELT, niet wie het invulde. Gevolg: een net ingevulde oranje score
  // sprong een tel lang op zwart, alsof hij al gecontroleerd was. Precies het
  // signaal waar de marker op zit te wachten.
  // Bij het wisselen van toernooi moet hij er wél uit: die lagen horen bij een
  // ander toernooi.
  if (window._liveScoresVanToernooi !== actieveToernooiId) {
    store._liveScores = {};
    window._liveScoresVanToernooi = actieveToernooiId;
  }

  // v3.0.0-11.106: ALLE gebruikers luisteren op live/ subcollectie
  // zodat scores real-time zichtbaar zijn zonder de coördinator als tussenschakel.
  alleToernooien.forEach(t => {
    const liveUnsub = onSnapshot(
      collection(db, 'toernooien', t.id, 'live'),
      (liveSnap) => {
        if (!toernooiData || actieveToernooiId !== t.id) return;
        const dag = actieveDag(toernooiData);
        // v5.3.0: _liveScores wordt ALTIJD bijgewerkt, ook als de bekeken dag
        // is afgesloten. Voorheen stopte de handler hier volledig, waardoor
        // _liveScores verouderde zodra iemand naar een afgesloten dag keek —
        // en heeftGeenScores() daarop vertrouwt om "terug naar setup" te
        // blokkeren tijdens een lopende speeldag.
        liveSnap.docs.forEach(liveDoc => { store._liveScores[liveDoc.id] = liveDoc.data(); });
        if (!dag || dag.afgerond) return;
        let gewijzigd = false;
        liveSnap.docs.forEach(liveDoc => {
          const data = liveDoc.data();
          const uid = liveDoc.id;
          const scores = _liveScoresVanDag(data, dag.dagNr);
          if (scores === null) return; // deze speler heeft niets voor deze dag
          if (!dag.scores) dag.scores = {};
          const huidig = JSON.stringify(dag.scores[uid] || []);
          const nieuw  = JSON.stringify(scores || []);
          if (huidig !== nieuw) {
            dag.scores[uid] = scores;
            gewijzigd = true;
          }
        });
        // v5.11.0: de kleuren ALTIJD bijwerken, ook als er niets aan het
        // meetellende getal verandert. Tikt de marker hetzelfde getal in als
        // de speler, dan blijft de score gelijk maar springt het vakje van
        // oranje naar zwart — en dat is juist het signaal waar iedereen op zit
        // te wachten. Hertekenen doen we niet: dan raak je de cursor kwijt van
        // wie op dat moment aan het typen is.
        verversScoreKleuren();
        verversUitslagKnop();

        if (gewijzigd) {
          updateTTotaalRijInline();
          renderTMatrix();
          if (isCoordinatorRol()) {
            const btn = document.getElementById('t-refresh-btn');
            if (btn) btn.style.display = '';
          }
          // v3.0.0-11.106: NIET meer debounced wegschrijven naar hoofddocument.
          // Consolidatie gebeurt eenmalig bij "dag afsluiten" (sluitDagAf).
        }
      },
      (err) => { console.warn('live/ listener error:', err.code); }
    );
    store._toernooiListeners.push(liveUnsub);
  });

alleToernooien.forEach(t => {
  const unsub = onSnapshot(doc(db, 'toernooien', t.id), (snap) => {
    if (!snap.exists()) return;
    const nieuweData = { id: snap.id, ...snap.data() };
    const idx = alleToernooien.findIndex(x => x.id === snap.id);
    if (idx >= 0) alleToernooien[idx] = nieuweData;
    if (actieveToernooiId === snap.id) {
      const isBeheerder = isCoordinatorRol();
      const detail = document.getElementById('toernooi-detail');

      // v3.0.0-11.106 / v5.11.0: behoud de lokaal ingevoerde scores van elke
      // nog lopende dag. Eén bron voor die regel — zie behoudLiveScores()
      // hierboven; js/auth.js gebruikt dezelfde functie.
      behoudLiveScores(nieuweData);

      if (detail) {
        const dag = actieveDag(nieuweData);
        if (isBeheerder) {
          store.toernooiData = nieuweData;
          const dagUitslag = dag?.afgerond || nieuweData.uitslagZichtbaar;
          if (dagUitslag || nieuweData.modus === 'strokeplay') renderTRanglijst();
        } else {
          const oudeMatrixVerborgen  = toernooiData?.matrixVerborgen;
          const oudeUitslagZichtbaar = toernooiData?.uitslagZichtbaar;
          const oudeStatus           = toernooiData?.status;
          const oudeToernooiModus    = toernooiData?.toernooiModus;
          store.toernooiData = nieuweData;

          // v3.0.0-11.73: reageer op status- en toernooiModus-wijzigingen real-time
          // zodat spelers niet hoeven te navigeren om de nieuwe toestand te zien.

          // Toernooi afgesloten of geannuleerd — verwijder uit lokale lijst en herrender
          if (nieuweData.status !== 'actief' && oudeStatus === 'actief') {
            store.alleToernooien = alleToernooien.filter(x => x.id !== snap.id);
            store.toernooiData   = alleToernooien.length > 0 ? alleToernooien[0] : null;
            store.actieveToernooiId = store.toernooiData?.id || null;
            renderToernooi();
            window.dispatchEvent(new CustomEvent('toernooiModusGewijzigd'));
            return;
          }

          // Toernooi-modus aan/uit gezet door beheerder
          if (nieuweData.toernooiModus !== oudeToernooiModus) {
            window.dispatchEvent(new CustomEvent('toernooiModusGewijzigd'));
          }

          // v5.11.1: zet de coordinator de onderlinge stand aan of uit, dan moet
          // het blok bij de deelnemer verschijnen of verdwijnen — inklappen is
          // niet genoeg, want dan staan de gegevens er nog gewoon.
          if (nieuweData.matrixVerborgen !== oudeMatrixVerborgen) {
            renderToernooiActief();
          }

          clearTimeout(window._matrixUpdateTimer);
          window._matrixUpdateTimer = setTimeout(() => renderTMatrix(), 2000);

          if (nieuweData.uitslagZichtbaar && !oudeUitslagZichtbaar) {
            renderTScorecard();
            renderTMatrix();
            renderTRanglijst();
          } else if (nieuweData.uitslagZichtbaar) {
            renderTRanglijst();
          }
        }
      } else {
        // Geen detail-element zichtbaar (bijv. op ander scherm) — gewoon data bijwerken
        store.toernooiData = nieuweData;
      }
    }
  });
  _toernooiListeners.push(unsub);
});
}

function selecteerToernooi(id) {
  store.actieveToernooiId = id;
  store.toernooiData = alleToernooien.find(t => t.id === id) || null;
  window._bekijkDagNr = null; // v4.0.0: bekijk-dag hoort bij één toernooi (fix 7.4)
  renderToernooi();
}

// ============================================================
//  CONCEPT-OPSLAG SETUP — v4.0.0 (fix 7.1)
// ============================================================
// Alles wat in het setup-formulier wordt ingesteld gaat als concept naar
// localStorage, zodat een refresh/crash tijdens het instellen niets kost.
const TOERNOOI_CONCEPT_KEY = 'toernooiConcept_v1';

function slaToernooiConceptOp() {
  clearTimeout(window._tConceptSaveTimer);
  window._tConceptSaveTimer = setTimeout(() => {
    try {
      const dagen = Array.from(document.querySelectorAll('#t-dag-blokken .dag-blok')).map(b => ({
        datum:       b.querySelector('.t-dag-datum')?.value || '',
        baan:        b.querySelector('.t-dag-baan')?.value || '',
        holes:       b.querySelector('.t-dag-holes')?.value || '18',
        holesCustom: b.querySelector('.t-dag-holes-custom')?.value || ''
      }));
      const concept = {
        naam:        document.getElementById('t-naam')?.value || '',
        aantalDagen: document.getElementById('t-aantal-dagen')?.value || '1',
        starttijd:   document.getElementById('t-starttijd')?.value || '09:00',
        interval:    document.getElementById('t-interval')?.value || '',
        ptWin:       document.getElementById('t-pt-win')?.value || '',
        ptTie:       document.getElementById('t-pt-tie')?.value || '',
        ptLoss:      document.getElementById('t-pt-loss')?.value || '',
        hcpPct:      document.getElementById('t-hcp-pct')?.value || '',
        modus:       document.querySelector('input[name="t-modus"]:checked')?.value || 'matchplay',
        dagen,
        spelers:        store._tGeselecteerdeSpelers || [],
        spelersLadders: [...(_tSpelersLadderIds || [])],
        rankingLadders: [...(_tRankingLadderIds || [])],
        // v5.11.3: ⚠ de flightindeling hoorde hier vanaf het begin in te staan.
        // Alles van het aanmaakformulier werd bewaard behalve dít, en juist dit
        // kost de meeste moeite: bij een herlaad begon je weer bij één flight
        // met iedereen erin. Sierk: "een niet gestart toernooi moest ik steeds
        // opnieuw indelen."
        flights: (_flights || []).map(f => ({
          id: f.id, naam: f.naam, starthole: f.starthole, starttijd: f.starttijd,
          spelers: (f.spelers || []).map(sp => ({ ...sp })),
        })),
        timestamp: Date.now()
      };
      localStorage.setItem(TOERNOOI_CONCEPT_KEY, JSON.stringify(concept));
    } catch(e) { console.warn('Concept opslaan mislukt:', e); }
  }, 500);
}

function wisToernooiConcept() {
  try { localStorage.removeItem(TOERNOOI_CONCEPT_KEY); } catch(e) { /* ok */ }
  window._tConceptDagen = null;
  // v5.11.3: de flightindeling hoort bij dit concept. Blijft hij staan, dan erf
  // je hem bij het volgende toernooi — met spelers die daar niet meedoen.
  store._flights = [];
}

// Herstelt state + simpele velden; dag-blok-waarden worden na renderDagBlokken
// toegepast via pasConceptDagenToe().
function herstelToernooiConcept() {
  try {
    const raw = localStorage.getItem(TOERNOOI_CONCEPT_KEY);
    if (!raw) return false;
    const c = JSON.parse(raw);
    if (!c) return false;

    const zet = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== '') el.value = val; };
    zet('t-naam', c.naam);
    zet('t-aantal-dagen', c.aantalDagen);
    zet('t-starttijd', c.starttijd);
    zet('t-interval', c.interval);
    zet('t-pt-win', c.ptWin);
    zet('t-pt-tie', c.ptTie);
    zet('t-pt-loss', c.ptLoss);
    zet('t-hcp-pct', c.hcpPct);
    const modusRadio = document.querySelector(`input[name="t-modus"][value="${c.modus}"]`);
    if (modusRadio) { modusRadio.checked = true; toernooiModusWissel(c.modus); }

    store._tGeselecteerdeSpelers = c.spelers || [];
    store._tSpelersLadderIds = new Set(c.spelersLadders || []);
    store._tRankingLadderIds = new Set(c.rankingLadders || []);
    store._flights = (c.flights || []).map(f => ({
      id: f.id, naam: f.naam, starthole: f.starthole, starttijd: f.starttijd,
      spelers: (f.spelers || []).map(sp => ({ ...sp })),
    }));
    window._tConceptDagen = c.dagen || null;

    const isBetekenisvol = (c.naam || '').trim() !== '' || (c.spelers || []).length > 0;
    if (isBetekenisvol) {
      toast('Concept-toernooi hersteld 📝');
      // v5.11.3: en klap het aanmaakscherm dan ook open. Een hersteld concept
      // achter een dichtgeklapte kop is niet hersteld voor wie ernaar kijkt —
      // je ziet "Nieuw Toernooi" en begint gewoon opnieuw.
      const kop = document.querySelector('#toernooi-setup-wrap .card-header.inklapbaar');
      const vak = kop?.nextElementSibling;
      kop?.classList.remove('ingeklapt');
      if (vak?.classList.contains('card-collapse')) vak.classList.remove('ingeklapt');
    }
    return true;
  } catch(e) { console.warn('Concept herstellen mislukt:', e); return false; }
}

// Vult de dag-blok-velden vanuit het herstelde concept (eenmalig)
function pasConceptDagenToe() {
  const dagen = window._tConceptDagen;
  if (!dagen || !dagen.length) return;
  window._tConceptDagen = null;
  const blokken = document.querySelectorAll('#t-dag-blokken .dag-blok');
  blokken.forEach((blok, i) => {
    const c = dagen[i];
    if (!c) return;
    const datumEl = blok.querySelector('.t-dag-datum');
    const baanEl  = blok.querySelector('.t-dag-baan');
    const holesEl = blok.querySelector('.t-dag-holes');
    const custEl  = blok.querySelector('.t-dag-holes-custom');
    if (datumEl && c.datum) datumEl.value = c.datum;
    if (baanEl && c.baan)   baanEl.value = c.baan;
    if (holesEl && c.holes) holesEl.value = c.holes;
    if (custEl && c.holesCustom) custEl.value = c.holesCustom;
  });
}

// Autosave: één gedelegeerde listener op het hele setup-formulier
function koppelConceptAutosave() {
  if (window._tConceptListenerGezet) return;
  const wrap = document.getElementById('toernooi-setup-wrap');
  if (!wrap) return;
  window._tConceptListenerGezet = true;
  wrap.addEventListener('input', slaToernooiConceptOp);
  wrap.addEventListener('change', slaToernooiConceptOp);
}

// ============================================================
//  SETUP FORMULIER
// ============================================================
function initToernooiSetup() {
  // v4.0.0 (fix 7.1): concept eenmalig herstellen vóór het renderen
  if (!window._tConceptHersteld) {
    window._tConceptHersteld = true;
    herstelToernooiConcept();
  }
  // v3.0.0-11.39: dag-blokken initialiseren
  renderDagBlokken();
  pasConceptDagenToe();     // v4.0.0 (fix 7.1)
  koppelConceptAutosave();  // v4.0.0 (fix 7.1)

  const spelersLaddersEl = document.getElementById('t-spelers-ladders');
  if (spelersLaddersEl) {
    spelersLaddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;min-width:56px;text-align:center">
        <span>${esc(l.naam)}</span>
        <input type="checkbox" value="${escAttr(l.id)}" ${_tSpelersLadderIds.has(l.id) ? 'checked' : ''} onchange="toggleTSpelersLadder('${escAttr(l.id)}', this.checked)" style="accent-color:var(--green);width:18px;height:18px">
      </label>
    `).join('');
  }

  const rankingLaddersEl = document.getElementById('t-ranking-ladders');
  if (rankingLaddersEl) {
    rankingLaddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;min-width:56px;text-align:center">
        <span>${esc(l.naam)}</span>
        <input type="checkbox" value="${escAttr(l.id)}" ${_tRankingLadderIds.has(l.id) ? 'checked' : ''} onchange="toggleTRankingLadder('${escAttr(l.id)}', this.checked)" style="accent-color:var(--green);width:18px;height:18px">
      </label>
    `).join('');
  }

  renderTGeselecteerdeSpelers();
}

// Rendert één dag-configuratie blok per dag
function renderDagBlokken() {
  const aantalDagen = parseInt(document.getElementById('t-aantal-dagen')?.value) || 1;
  const container   = document.getElementById('t-dag-blokken');
  if (!container) return;

  const banen = alleBANEN();
  const baanOpties = Object.keys(banen)
    .filter(n => n !== 'Handmatig invoeren')
    .map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`)
    .join('');

  // Bewaar bestaande waarden zodat wisselen van aantal dagen de invoer niet wist
  const bestaand = Array.from(container.querySelectorAll('.dag-blok')).map(blok => ({
    datum:  blok.querySelector('.t-dag-datum')?.value  || '',
    baan:   blok.querySelector('.t-dag-baan')?.value   || '',
    holes:  blok.querySelector('.t-dag-holes')?.value  || '18',
    hcust:  blok.querySelector('.t-dag-holes-custom')?.value || ''
  }));

  let html = '';
  for (let d = 1; d <= aantalDagen; d++) {
    const prev      = bestaand[d - 1] || {};
    const label     = aantalDagen > 1 ? `Dag ${d}` : 'Speeldag';
    const dagDatum  = prev.datum || '';
    const dagBaan   = prev.baan  || '';
    const dagHoles  = prev.holes || '18';
    const dagHcust  = prev.hcust || '';
    const showCust  = dagHoles === 'custom' ? '' : 'display:none';

    html += `
    <div class="dag-blok" style="border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
      ${aantalDagen > 1 ? `<div style="font-weight:700;font-size:13px;color:var(--green);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">${label}</div>` : ''}
      <div class="form-group" style="margin-bottom:10px">
        <label>Datum</label>
        <input type="date" class="t-dag-datum" value="${esc(dagDatum)}"
          ${d === 1 && !dagDatum ? `placeholder="${new Date().toISOString().split('T')[0]}"` : ''}>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Baan</label>
        <select class="t-dag-baan" onchange="onTDagBaanSelect(this, ${d})">
          ${baanOpties}
          <option value="Handmatig invoeren">+ Nieuwe baan toevoegen</option>
        </select>
        <div id="t-baan-handmatig-${d}" style="display:none;margin-top:10px">
          <div id="t-holes-handmatig-${d}"></div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Aantal holes</label>
        <select class="t-dag-holes" onchange="this.closest('.dag-blok').querySelector('.t-dag-holes-custom-wrap').style.display=this.value==='custom'?'block':'none'">
          <option value="18" ${dagHoles==='18'?'selected':''}>18 holes</option>
          <option value="9"  ${dagHoles==='9' ?'selected':''}>9 holes</option>
          <option value="custom" ${dagHoles==='custom'?'selected':''}>Aangepast...</option>
        </select>
        <div class="t-dag-holes-custom-wrap" style="${showCust};margin-top:6px">
          <input type="number" class="t-dag-holes-custom" min="1" max="18"
            placeholder="bijv. 12" style="text-align:center;width:80px" value="${esc(dagHcust)}">
        </div>
      </div>
    </div>`;
  }
  container.innerHTML = html;

  // Herstel baan-selectie (na innerHTML vervangen)
  const blokken = container.querySelectorAll('.dag-blok');
  blokken.forEach((blok, i) => {
    const prev = bestaand[i];
    if (prev?.baan) {
      const sel = blok.querySelector('.t-dag-baan');
      if (sel && [...sel.options].some(o => o.value === prev.baan)) {
        sel.value = prev.baan;
      }
    } else {
      // Default: De Goyer op dag 1, zelfde baan als dag 1 op volgende dagen
      const sel = blok.querySelector('.t-dag-baan');
      if (sel) {
        const deGoyer = [...sel.options].find(o => o.value === 'De Goyer');
        if (i === 0 && deGoyer) sel.value = 'De Goyer';
        else if (i > 0) {
          const dag1Baan = container.querySelector('.dag-blok .t-dag-baan')?.value;
          if (dag1Baan && [...sel.options].some(o => o.value === dag1Baan)) sel.value = dag1Baan;
        }
      }
    }
  });
}
window.renderDagBlokken = renderDagBlokken;

function toggleTSpelersLadder(ladderId, checked) {
  if (checked) _tSpelersLadderIds.add(ladderId);
  else _tSpelersLadderIds.delete(ladderId);
  if (_tSpelersLadderIds.size > 0) {
    const geldigeUids = new Set(
      alleLadders.filter(l => _tSpelersLadderIds.has(l.id))
        .flatMap(l => l.spelerIds || [])
    );
    store._tGeselecteerdeSpelers = _tGeselecteerdeSpelers.filter(s => s.gast || geldigeUids.has(s.uid));
  }
  renderTGeselecteerdeSpelers();
}

function toggleTRankingLadder(ladderId, checked) {
  if (checked) _tRankingLadderIds.add(ladderId);
  else _tRankingLadderIds.delete(ladderId);
}

function getToernooiSpelersPool() {
  // Gebruik alleSpelersData (uid-based) als bron, gefilterd op geselecteerde ladders
  const gezien = new Set();
  const spelers = [];
  const ladders = _tSpelersLadderIds.size > 0
    ? alleLadders.filter(l => _tSpelersLadderIds.has(l.id))
    : alleLadders;
  // Verzamel uids die in de geselecteerde ladders zitten
  const toegestaneUids = new Set(ladders.flatMap(l => l.spelerIds || []));
  alleSpelersData.forEach(s => {
    if (!s.uid || gezien.has(s.uid)) return;
    if (toegestaneUids.size > 0 && !toegestaneUids.has(s.uid)) return;
    gezien.add(s.uid);
    spelers.push({ uid: s.uid, naam: s.naam, hcp: s.hcp ?? 0 });
  });
  return spelers.sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));
}

function zoekToernooiSpeler(zoek) {
  const lijst = document.getElementById('t-speler-zoek-lijst');
  if (!lijst) return;
  const term = zoek.toLowerCase().trim();
  const geselecteerdeUids = new Set(store._tGeselecteerdeSpelers.map(s => s.uid));
  const pool = getToernooiSpelersPool().filter(s => !geselecteerdeUids.has(s.uid));
  const gefilterd = term ? pool.filter(s => s.naam.toLowerCase().includes(term)) : pool;

  if (gefilterd.length === 0) {
    lijst.innerHTML = `<div style="padding:10px 14px;font-size:13px;color:var(--light)">Geen spelers gevonden</div>`;
  } else {
    lijst.innerHTML = gefilterd.map(s => `
      <div onpointerdown="event.preventDefault()" onclick="selecteerToernooiSpeler('${escAttr(s.uid)}','${escAttr(s.naam)}',${s.hcp})"
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;color:var(--dark);background:var(--card-bg)"
        onmouseenter="this.style.background='var(--green-pale)'" onmouseleave="this.style.background='var(--card-bg)'">
        <span>${esc(s.naam)}</span>
        <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>
    `).join('');
  }
  lijst.style.display = 'block';
}

function selecteerToernooiSpeler(uid, naam, hcp) {
  if (!store._tGeselecteerdeSpelers.find(s => s.uid === uid)) {
    store._tGeselecteerdeSpelers.push({ uid, naam, hcp, gast: false });
  }
  slaToernooiConceptOp(); // v4.0.0 (fix 7.1)
  const zoek = document.getElementById('t-speler-zoek');
  if (zoek) { zoek.value = ''; zoekToernooiSpeler(''); zoek.focus(); }
  renderTGeselecteerdeSpelers();
}

function sluitToernooiSpelerLijst() {
  const lijst = document.getElementById('t-speler-zoek-lijst');
  if (lijst) lijst.style.display = 'none';
}

function verwijderToernooiSpelerSelectie(uid) {
  store._tGeselecteerdeSpelers = store._tGeselecteerdeSpelers.filter(s => s.uid !== uid);
  slaToernooiConceptOp(); // v4.0.0 (fix 7.1)
  renderTGeselecteerdeSpelers();
  zoekToernooiSpeler(document.getElementById('t-speler-zoek')?.value || '');
}

function voegGastspelerToe() {
  const naam = prompt('Naam gastspeler:');
  if (!naam?.trim()) return;
  const hcpStr = prompt(`Handicap voor ${naam.trim()}:`, '10');
  if (hcpStr === null) return;
  const hcp = parseFloat(hcpStr) || 0;
  const gastId = 'gast_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); // v4.0.0 (fix 7.7)
  store._tGeselecteerdeSpelers.push({ uid: gastId, naam: naam.trim(), hcp, gast: true });
  slaToernooiConceptOp(); // v4.0.0 (fix 7.1)
  renderTGeselecteerdeSpelers();
}

function renderTGeselecteerdeSpelers() {
  const _tGeselecteerdeSpelers = store._tGeselecteerdeSpelers;
  const el = document.getElementById('t-geselecteerde-spelers');
  if (!el) return;
  if (_tGeselecteerdeSpelers.length === 0) {
    el.innerHTML = '<span style="font-size:13px;color:var(--light)">Nog geen deelnemers geselecteerd</span>';
    return;
  }
  el.innerHTML = _tGeselecteerdeSpelers.map(s => `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:var(--green-pale);color:var(--green);border:1.5px solid var(--green);border-radius:20px;font-size:13px">
      ${esc(s.naam)}${s.gast ? ' <em style="font-size:11px;opacity:0.7">(gast)</em>' : ''}
      <button onclick="verwijderToernooiSpelerSelectie('${escAttr(s.uid)}')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:14px;padding:0;line-height:1">×</button>
    </span>
  `).join('');
}

function toggleTSpeler(id) {
  const tag = document.getElementById('ttag-' + id);
  if (!tag) return;
  tag.classList.toggle('selected');
  const isSelected = tag.classList.contains('selected');
  tag.style.outline = isSelected ? '3px solid var(--dark)' : 'none';
  tag.style.fontWeight = isSelected ? '700' : '500';
}

// ============================================================
//  FLIGHT INDELING
// ============================================================
function toggleHolesCustom() {
  const sel = document.getElementById('t-holes');
  const wrap = document.getElementById('t-holes-custom-wrap');
  if (wrap) wrap.style.display = sel.value === 'custom' ? 'block' : 'none';
}

function openFlightIndeling() {
  const geselecteerd = _tGeselecteerdeSpelers;
  if (geselecteerd.length < 2) { toast('Selecteer minimaal 2 spelers'); return; }

  const starttijd = document.getElementById('t-starttijd')?.value || '09:00';
  const interval = parseInt(document.getElementById('t-interval')?.value) || 0;

  if (_flights.length === 0) {
    // v5.10.0: `gast` en `login` MOETEN mee.
    //
    // WAT HIER MIS WAS, en dat is ernstig. Hier stond `{ uid, naam, hcp }`.
    // startToernooi() haalt de deelnemers uit _flights, dus een gastspeler die
    // je vóór de start toevoegde verloor precies hier zijn gast-status — en
    // telde daarna gewoon MEE VOOR DE LADDER. Op het scherm stond nog "(gast)",
    // in het opgeslagen toernooi niet meer. Gevonden door de repetitie van
    // v5.10.0, niet door iemand die het zag gebeuren.
    store._flights = [{ id: 1, naam: 'Flight 1', spelers: geselecteerd.map(s => ({ ...s })), starthole: 1, starttijd }];
  } else {
    _flights.forEach((f, fi) => {
      if (!f.starttijd) f.starttijd = berekenFlightTijd(starttijd, interval, fi);
      if (!f.starthole) f.starthole = 1;
      f.spelers = f.spelers.filter(s => geselecteerd.some(g => g.uid === s.uid));
    });
    const ingedeeld = new Set(_flights.flatMap(f => f.spelers.map(s => s.uid)));
    const nieuw = geselecteerd.filter(s => !ingedeeld.has(s.uid)).map(s => ({ ...s }));  // v5.10.0: gast-vlag mee
    if (nieuw.length > 0 && _flights.length > 0) _flights[0].spelers.push(...nieuw);
  }

  window._toernooiStarttijd = starttijd;
  window._toernooiInterval = interval;
  window._flightDagModus = false;

  const startBtn = document.getElementById('flight-modal-start-btn');
  if (startBtn) { startBtn.textContent = 'Toernooi starten →'; startBtn.onclick = startToernooi; }

  renderFlightLijst();
  document.getElementById('modal-flight-indeling').classList.add('open');
}

// v5.9.0: verdeelt alle ingedeelde spelers gelijkmatig over de bestaande
// flights. Voorheen kwam een nieuwe flight leeg binnen en moest elke speler
// met de hand worden verplaatst — bij negen spelers over vier flights is dat
// negen keuzemenu's, en wie flight 1 helemaal leegmaakt houdt een lege flight
// over die de app gewoon opsloeg. Zie de toelichting in CLAUDE.md.
function verdeelSpelersOverFlights() {
  const alle = _flights.flatMap(f => f.spelers);
  if (alle.length === 0 || _flights.length === 0) return;
  _flights.forEach(f => { f.spelers = []; });
  alle.forEach((sp, i) => { _flights[i % _flights.length].spelers.push(sp); });
  renderFlightLijst();
}
window.verdeelSpelersOverFlights = verdeelSpelersOverFlights;

// v5.9.0: welke flights leeg zijn (0 spelers). Een lege flight geeft een
// scorekaart met alleen holes en geen spelerskolommen.
function _legeFlights() {
  return _flights.map((f, i) => ({ f, i })).filter(x => x.f.spelers.length === 0);
}

// v5.9.0: laatste grendel vóór opslaan. Een lege flight werd tot en met
// v5.8.9 gewoon weggeschreven — startToernooi() keek alleen of ALLE flights
// leeg waren. Gevolg: een scorekaart met holes en geen spelerskolommen, en de
// indruk dat het toernooi stuk is. Geeft true als er doorgegaan mag worden.
function _verwerkLegeFlights() {
  const leeg = _legeFlights();
  if (leeg.length === 0) return true;
  if (leeg.length === _flights.length) {
    toast('Verdeel de spelers eerst over de flights');
    return false;
  }
  const namen = leeg.map(x => x.f.naam).join(', ');
  const enkel = leeg.length === 1;
  if (!confirm(`${namen} ${enkel ? 'heeft' : 'hebben'} geen spelers.\n\n` +
               `Een lege flight geeft een scorekaart zonder spelers. ` +
               `${enkel ? 'Hem' : 'Ze'} weghalen en doorgaan?`)) return false;
  store._flights = _flights.filter(f => f.spelers.length > 0);
  _flights.forEach((f, i) => {
    f.id = i + 1;
    if (/^Flight \d+$/.test(f.naam)) f.naam = `Flight ${i + 1}`;
  });
  return true;
}

// v5.11.3: één plek die de indeling in het concept bewaart. Het flightvenster
// van een LOPEND toernooi (de dag-modus) hoort hier niet bij: die indeling
// staat al in het toernooi zelf, en zou het concept van een volgend toernooi
// vervuilen.
function bewaarFlightsInConcept() {
  if (window._flightDagModus) return;
  slaToernooiConceptOp();
}

function renderFlightLijst() {
  const container = document.getElementById('flight-lijst');
  if (!container) return;
  bewaarFlightsInConcept();

  const ingedeeld = new Set(_flights.flatMap(f => f.spelers.map(s => s.uid)));
  const leeg = _legeFlights();

  // v5.9.0: kop met het aantal spelers, een knop om gelijk te verdelen en een
  // waarschuwing als er een flight leeg is.
  const kop = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:13px;color:var(--mid)">${ingedeeld.size} speler(s) · ${_flights.length} flight(s)</span>
      <button class="btn btn-sm btn-ghost" onclick="verdeelSpelersOverFlights()" style="margin-left:auto">⇄ Gelijk verdelen</button>
    </div>
    ${leeg.length > 0 ? `
    <div style="background:var(--gold-pale);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--gold)">
      ⚠️ ${leeg.map(x => esc(x.f.naam)).join(', ')} ${leeg.length === 1 ? 'is' : 'zijn'} leeg.
      Een lege flight geeft een scorekaart zonder spelers. Verdeel de spelers of haal hem weg met ✕.
    </div>` : ''}`;

  container.innerHTML = kop + _flights.map((f, fi) => `
    <div style="border:1.5px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="background:var(--green);padding:8px 12px;display:flex;align-items:center;gap:8px">
        <input type="text" value="${esc(f.naam)}" onchange="wijzigFlightNaam(${fi}, this.value)"
          style="background:transparent;border:none;color:white;font-family:'Bebas Neue';font-size:18px;flex:1;outline:none">
        ${_flights.length > 1 ? `<button onclick="verwijderFlight(${fi})" style="background:rgba(255,255,255,0.2);border:none;border-radius:4px;color:white;cursor:pointer;padding:2px 8px;font-size:13px">✕</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 12px;background:var(--soft-bg);border-bottom:1px solid var(--border)">
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--mid);text-transform:uppercase;display:block;margin-bottom:3px">Starttijd</label>
          <input type="time" value="${esc(f.starttijd || '')}" onchange="wijzigFlightStarttijd(${fi}, this.value)"
            style="font-family:'DM Mono',monospace;font-size:13px;border:1.5px solid var(--border);border-radius:5px;padding:3px 6px;width:100%">
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--mid);text-transform:uppercase;display:block;margin-bottom:3px">Starthole</label>
          <input type="number" value="${f.starthole || 1}" min="1" max="18" onchange="wijzigFlightStarthole(${fi}, this.value)"
            style="font-family:'DM Mono',monospace;font-size:13px;border:1.5px solid var(--border);border-radius:5px;padding:3px 6px;width:100%;text-align:center">
        </div>
      </div>
      <div style="padding:8px">
        ${f.spelers.map((s, si) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.naam)}</span>
            <input type="number" value="${Math.round(s.hcp)}" min="-10" max="54"
              onchange="wijzigFlightHcp(${fi}, ${si}, this.value)"
              style="width:48px;padding:3px 6px;text-align:center;font-family:'DM Mono',monospace;border:1.5px solid var(--border);border-radius:5px;font-size:13px;flex-shrink:0">
            ${_flights.length > 1 ? `
            <select onchange="verplaatsSpelerFlight(${fi}, ${si}, this.value)" title="Verplaats naar een andere flight" style="font-size:12px;border:1.5px solid var(--border);border-radius:5px;padding:3px 5px;background:var(--card-bg);color:var(--dark);flex-shrink:0;min-width:104px;max-width:150px">
              ${_flights.map((lf, lfi) => `<option value="${lfi}" ${lfi === fi ? 'selected' : ''}>${esc(lf.naam)}</option>`).join('')}
            </select>` : ''}
          </div>
        `).join('')}
        ${f.spelers.length === 0 ? '<p style="font-size:12px;color:var(--gold);padding:8px 0">Nog geen spelers. Gebruik ⇄ Gelijk verdelen, of verplaats iemand hierheen met het keuzemenu achter zijn naam.</p>' : ''}
      </div>
    </div>
  `).join('');
}

function berekenFlightTijd(basis, interval, fi) {
  if (!basis || !interval) return basis || '';
  const [h, m] = basis.split(':').map(Number);
  const totMin = h * 60 + m + fi * interval;
  return `${String(Math.floor(totMin / 60) % 24).padStart(2,'0')}:${String(totMin % 60).padStart(2,'0')}`;
}

function voegFlightToe() {
  const fi = _flights.length;
  const vorigeHole = _flights[fi - 1]?.starthole || 1;
  const basis = window._toernooiStarttijd || '09:00';
  const interval = window._toernooiInterval || 0;
  _flights.push({ id: fi + 1, naam: `Flight ${fi + 1}`, spelers: [], starthole: vorigeHole, starttijd: berekenFlightTijd(basis, interval, fi) });
  renderFlightLijst();
}

function wijzigFlightStarttijd(fi, val) { if (_flights[fi]) _flights[fi].starttijd = val; bewaarFlightsInConcept(); }
function wijzigFlightStarthole(fi, val) { if (_flights[fi]) _flights[fi].starthole = parseInt(val) || 1; bewaarFlightsInConcept(); }

function verwijderFlight(fi) {
  if (_flights.length <= 1) return;
  const spelers = _flights[fi].spelers;
  _flights.splice(fi, 1);
  if (spelers.length > 0) _flights[0].spelers.push(...spelers);
  renderFlightLijst();
}

function wijzigFlightNaam(fi, naam) { if (_flights[fi]) _flights[fi].naam = naam; bewaarFlightsInConcept(); }
function wijzigFlightHcp(fi, si, val) { if (_flights[fi]?.spelers[si]) _flights[fi].spelers[si].hcp = parseFloat(val) || 0; bewaarFlightsInConcept(); }

function verplaatsSpelerFlight(vanFi, si, naarFi) {
  naarFi = parseInt(naarFi);
  if (vanFi === naarFi) return;
  const speler = _flights[vanFi].spelers.splice(si, 1)[0];
  _flights[naarFi].spelers.push(speler);
  renderFlightLijst();
}

// ============================================================
//  START TOERNOOI — leest alle dag-blokken in
// ============================================================
async function startToernooi() {
  try {
    const naam     = document.getElementById('t-naam').value.trim();
    const ptWin    = parseFloat(document.getElementById('t-pt-win').value);
    const ptTie    = parseFloat(document.getElementById('t-pt-tie').value);
    const ptLoss   = parseFloat(document.getElementById('t-pt-loss').value);
    const hcpPct   = parseFloat(document.getElementById('t-hcp-pct').value) / 100;
    // v3.1.1: als er geen ranking-ladder is aangevinkt, val terug op de spelers-ladder(s),
    // zodat een toernooi altijd de ladder bijwerkt waar de deelnemers vandaan komen.
    // Voorkomt dat de ranking leeg blijft (o.a. na het per ongeluk uitzetten van het vinkje
    // of de reset na 'start'), waardoor de ladder-update niet draaide.
    const _rankingSet = _tRankingLadderIds.size > 0 ? _tRankingLadderIds : _tSpelersLadderIds;
    const rankingLadderIds = [..._rankingSet];
    const ladderId = rankingLadderIds[0] || null;
    const modus    = document.querySelector('input[name="t-modus"]:checked')?.value || 'matchplay';
    const starttijd = document.getElementById('t-starttijd')?.value || '09:00';
    const interval  = parseInt(document.getElementById('t-interval')?.value) || 0;
    // v5.10.0: leeg laten mag — dan krijgen gastspelers geen inlog.
    const gastWachtwoord = document.getElementById('t-gast-wachtwoord')?.value.trim() || '';

    if (!naam) { toast('Voer een naam in'); return; }
    if (gastWachtwoord && gastWachtwoord.length < 6) {
      toast('Het gastwachtwoord moet minstens 6 tekens hebben');
      return;
    }
    if (gastWachtwoord && _gastBeheerGeblokkeerdInTest()) return;
    const gastCode = toernooiCodeVan(naam);

    // v5.9.0: nooit twee actieve toernooien naast elkaar. Dat kon tot en met
    // v5.8.9 omdat het aanmaakformulier boven een lopend toernooi bleef staan.
    if (alleToernooien.length > 0) {
      const lopend = alleToernooien[0];
      toast(`"${lopend?.naam || 'Een toernooi'}" loopt nog. Sluit dat eerst af of annuleer het.`);
      return;
    }

    // Lees alle dag-blokken
    const dagBlokken = Array.from(document.querySelectorAll('#t-dag-blokken .dag-blok'));
    if (dagBlokken.length === 0) { toast('Configureer minimaal één dag'); return; }

    const banen = alleBANEN();
    const dagenConfig = [];
    for (let i = 0; i < dagBlokken.length; i++) {
      const blok    = dagBlokken[i];
      const datum   = blok.querySelector('.t-dag-datum')?.value;
      const baanNaam = blok.querySelector('.t-dag-baan')?.value;
      const holesVal = blok.querySelector('.t-dag-holes')?.value || '18';
      const holesCount = holesVal === 'custom'
        ? parseInt(blok.querySelector('.t-dag-holes-custom')?.value) || 18
        : parseInt(holesVal);

      if (!datum)    { toast(`Voer een datum in voor dag ${i+1}`); return; }
      if (!baanNaam || baanNaam === 'Handmatig invoeren') { toast(`Selecteer een baan voor dag ${i+1}`); return; }

      let holes = [];
      if (banen[baanNaam]?.holes) holes = banen[baanNaam].holes.slice(0, holesCount);
      if (!holes.length) { toast(`Baan heeft geen holes geconfigureerd (dag ${i+1})`); return; }

      dagenConfig.push({ dagNr: i + 1, datum, baan: baanNaam, holes, starttijd, interval });
    }

    // Spelers uit flights
    if (_flights.every(f => f.spelers.length === 0)) { toast('Verdeel spelers over flights'); return; }
    if (!_verwerkLegeFlights()) return;   // v5.9.0
    const geselecteerd = _flights.flatMap(f => f.spelers);
    if (geselecteerd.length < 2) { toast('Voeg minimaal 2 spelers toe aan flights'); return; }

    const spelers = geselecteerd.map(s => ({
      uid: s.uid, naam: s.naam, hcp: s.hcp, gast: s.gast || false
    }));

    // Bouw dagen[] — scores en flights leeg, worden per dag ingevuld
    const dagen = dagenConfig.map(cfg => {
      const scores = {};
      spelers.forEach(s => { scores[s.uid] = Array(cfg.holes.length).fill(null); });

      // Alleen dag 1 krijgt hier een indeling. De volgende dagen beginnen leeg.
      //
      // v5.9.0 deed dit even anders — daar werd de indeling van dag 1 naar élke
      // dag gekopieerd. Dat was een verkeerde reparatie van een echt probleem.
      // Sierk, 12 september 2026: "Dag 2 wordt ingedeeld ahv de prestaties van
      // dag 1. Dus het is fijner om de volgende dag niet al automatisch in te
      // delen." Een voorgekauwde indeling is daar niet behulpzaam maar
      // misleidend: hij ziet er af als een besluit dat al genomen is.
      //
      // Het echte probleem was dat een niet-ingedeelde dag er KAPOT uitzag: een
      // scorekaart met holes en geen spelers, zonder één woord uitleg. Dat is
      // opgelost in renderTScorecard(), niet hier. Zie v5.9.1.
      const flights = cfg.dagNr === 1
        ? _flights.map(f => ({
            id: f.id, naam: f.naam,
            spelerIds: f.spelers.map(s => s.uid),
            // v5.11.0: de markerindeling wordt meteen meegeschreven, zodat hij
            // vastligt en de coordinator hem kan omzetten.
            markers: markerKring(f.spelers.map(s => s.uid)),
            starthole: f.starthole || 1,
            starttijd: f.starttijd || cfg.starttijd
          }))
        : [];

      return {
        dagNr:    cfg.dagNr,
        datum:    cfg.datum,
        baan:     cfg.baan,
        holes:    cfg.holes,
        starttijd: cfg.starttijd,
        interval:  cfg.interval,
        flights,
        scores,
        afgerond: false
      };
    });

    const nieuweToernooi = {
      status: 'actief',
      naam, modus,
      // v5.10.0: openbaar, en dat mag — hiermee kan het inlogscherm de
      // inlognaam van een gast afleiden. Het wachtwoord staat in de
      // afgeschermde submap, niet hier.
      ...(gastWachtwoord ? { gastCode } : {}),
      ptWin, ptTie, ptLoss, hcpPct,
      ladderId: ladderId || null,
      rankingLadderIds,
      spelers,
      dagen,
      actiefDagNr: 1,
      timestamp: Date.now()
    };

    const newRef = await addDoc(TOERNOOIEN_COL, nieuweToernooi);
    nieuweToernooi.id = newRef.id;

    // v5.10.0: gastlogins. Pas HIER, nadat het toernooi echt bestaat — zo
    // blijven er geen accounts achter van een aanmaakscherm dat je halverwege
    // verlaat. Mislukt er één, dan gaat het toernooi gewoon door en zegt de
    // app welke gast geen inlog kreeg: een toernooi zonder één inlog is
    // beter dan geen toernooi.
    if (gastWachtwoord) {
      try {
        await setDoc(doc(db, 'toernooien', newRef.id, 'beheer', 'gastlogin'),
          { wachtwoord: gastWachtwoord, code: gastCode });
      } catch (e) {
        console.error('gastwachtwoord opslaan mislukt:', e);
        toast('Let op: het gastwachtwoord kon niet worden bewaard — ' + toernooiFoutTekst(e), 9000);
      }
      const mislukt = [];
      for (const sp of nieuweToernooi.spelers.filter(x => x.gast)) {
        try {
          const { uid, login } = await maakGastAccount(sp.naam, gastCode, gastWachtwoord, naam);
          _vervangSpelerUid(nieuweToernooi, sp.uid, uid);
          sp.uid = uid;
          sp.login = login;
        } catch (e) {
          console.error('gastlogin mislukt voor', sp.naam, e);
          mislukt.push(sp.naam);
        }
      }
      await setDoc(doc(db, 'toernooien', newRef.id), nieuweToernooi);
      if (mislukt.length > 0) {
        toast(`Geen inlog gelukt voor: ${mislukt.join(', ')} — de rest staat klaar`, 9000);
      }
    }
    alleToernooien.push(nieuweToernooi);
    store.toernooiData = nieuweToernooi;
    store.actieveToernooiId = newRef.id;

    const unsub = onSnapshot(doc(db, 'toernooien', newRef.id), (snap) => {
      if (!snap.exists()) return;
      const nieuweData = { id: snap.id, ...snap.data() };
      const idx = alleToernooien.findIndex(x => x.id === snap.id);
      if (idx >= 0) alleToernooien[idx] = nieuweData;
      if (actieveToernooiId === snap.id) {
        store.toernooiData = nieuweData;
        const detail = document.getElementById('toernooi-detail');
        if (detail) { renderTScorecard(); renderTMatrix(); if (nieuweData.uitslagZichtbaar) renderTRanglijst(); }
      }
    });
    _toernooiListeners.push(unsub);

    toast('Toernooi gestart! 🏅');
    wisToernooiConcept(); // v4.0.0 (fix 7.1)
    closeModal('modal-flight-indeling');
    store._flights = [];
    store._tGeselecteerdeSpelers = [];
    store._tSpelersLadderIds = new Set();
    store._tRankingLadderIds = new Set();
    document.getElementById('t-naam').value = '';
    document.getElementById('t-aantal-dagen').value = '1';
    document.querySelectorAll('#t-spelers-ladders input, #t-ranking-ladders input').forEach(cb => cb.checked = false);
    renderTGeselecteerdeSpelers();
    renderDagBlokken();
    const setupHeader = document.querySelector('#toernooi-setup-wrap .card-header.inklapbaar');
    if (setupHeader && !setupHeader.classList.contains('ingeklapt')) {
      setupHeader.classList.add('ingeklapt');
      const collapse = setupHeader.nextElementSibling;
      if (collapse) collapse.classList.add('ingeklapt');
    }
    document.getElementById('toernooi-actief-wrap').style.display = 'block';
    renderToernooi();
    // v3.0.0-11.106: start live/ listeners direct na aanmaken
    herlaadToernooiListeners();
  } catch(e) { toernooiFout('Toernooi starten', e); }
}

// ============================================================
//  DAG BEHEER
// ============================================================

// Selecteer actieve dag en herrender
function selecteerDag(dagNr) {
  if (!toernooiData) return;
  // v4.0.0: alleen lokale weergave — schrijft NIET meer naar Firestore.
  // Voorheen werd actiefDagNr voor het hele toernooi (alle gebruikers)
  // overschreven zodra iemand een oude dag bekeek (fix 7.4).
  window._bekijkDagNr = dagNr;
  renderToernooiActief();
}

// Open modal om nieuwe dag te configureren
function openNieuweDagModal() {
  const t = toernooiData;
  if (!t) return;
  const vorigeDag = (t.dagen || []).slice(-1)[0];
  // Vul datum default: dag eerder + 1
  const datumEl = document.getElementById('t-dag-datum');
  if (datumEl) {
    if (vorigeDag?.datum) {
      const d = new Date(vorigeDag.datum);
      d.setDate(d.getDate() + 1);
      datumEl.value = d.toISOString().split('T')[0];
    } else {
      datumEl.value = new Date().toISOString().split('T')[0];
    }
  }
  // Vul baan default: zelfde als vorige dag
  const baanEl = document.getElementById('t-dag-baan');
  if (baanEl) {
    const banen = alleBANEN();
    baanEl.innerHTML = Object.keys(banen)
      .filter(n => n !== 'Handmatig invoeren')
      .map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`)
      .join('');
    if (vorigeDag?.baan && banen[vorigeDag.baan]) baanEl.value = vorigeDag.baan;
  }
  // v5.9.1: het venster doet nu twee dingen. Hier expliciet in de stand
  // "toevoegen" zetten, zodat een eerdere wijzig-sessie niet blijft hangen.
  _zetDagModalStand(null);
  document.getElementById('modal-nieuwe-dag').classList.add('open');
}

// ============================================================
//  GASTLOGINS  (v5.10.0)
// ============================================================
//  WAT DIT IS. Spelers van buiten de club doen één toernooi mee. Ze krijgen
//  een inlog die alleen voor dat toernooi werkt, en die ze niet hoeven te
//  wijzigen. Sierk, 12 september 2026: "Ik wil voor de login dat de gebruiker
//  alleen voor en achternaam hoeft in te tikken."
//
//  HOE DE INLOG WERKT. De gast typt zijn naam plus het toernooiwachtwoord. De
//  app maakt daar zelf de inlognaam van:
//
//      naam "Jan Jansen" + toernooicode "standrews2026"
//         -> jan.jansen.standrews2026@MPladder.stb
//
//  De code staat openbaar op het toernooi — dat mag, want het WACHTWOORD is
//  het geheim. Dat staat in toernooien/{id}/beheer/gastlogin, waar alleen de
//  coordinator bij kan (zie firestore.rules).
//
//  ⚠ WAAROM DE CODE ACHTER DE NAAM STAAT. Zonder die toevoeging zou een gast
//  die toevallig ook clublid is (Jan Jansen) botsen met zijn eigen account, en
//  dan mislukt het aanmaken. Nu zijn het twee gescheiden accounts. Gevolg, en
//  dat is met opzet: als gast telt hij NIET mee voor de ladder (`gast: true`).
//
//  ⚠ EEN GEDEELD WACHTWOORD. Wie het toernooiwachtwoord heeft kan inloggen
//  onder de naam van elke deelnemer van dat toernooi. Hij ziet dan alleen dat
//  ene toernooi. Dat is de prijs van "alleen je naam intikken"; daarom is het
//  wachtwoord per toernooi en worden de accounts na afloop opgeruimd.
// ============================================================

// Toernooinaam -> code die in de inlognaam past. Alleen kleine letters en
// cijfers; accenten eraf, zodat "Café 2026" niet op een raar teken stukloopt.
function toernooiCodeVan(naam) {
  const kaal = String(naam || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return kaal.slice(0, 16) || 'toernooi';
}

// Splitst "Jan de Vries" op dezelfde manier als genereerEmail() verwacht:
// eerste woord is de voornaam, de rest de achternaam. Aan beide kanten van de
// inlog moet dit gelijk gebeuren, anders vindt de gast zijn eigen account niet.
function splitsNaam(volleNaam) {
  const delen = String(volleNaam || '').trim().split(/\s+/).filter(Boolean);
  if (delen.length === 0) return { voornaam: '', achternaam: '' };
  if (delen.length === 1) return { voornaam: delen[0], achternaam: '' };
  return { voornaam: delen[0], achternaam: delen.slice(1).join(' ') };
}

// De inlog (zonder @-deel) voor een gast in een toernooi.
function gastLoginVan(volleNaam, code) {
  const { voornaam, achternaam } = splitsNaam(volleNaam);
  const schoon = t => String(t || '').toLowerCase().replace(/\s+/g, '');
  const kern = achternaam ? `${schoon(voornaam)}.${schoon(achternaam)}` : schoon(voornaam);
  return `${kern}.${code}`;
}

// v3.0.0-11.103, overgenomen uit admin.js: gebruikersbeheer loopt via de
// gedeelde Firebase Auth, die voor test én productie hetzelfde project is.
// Een gastaccount aanmaken vanuit /test/ zou dus een ECHT account maken.
function _gastBeheerGeblokkeerdInTest() {
  if (IS_TEST) {
    toast('Gastlogins aanmaken is uitgeschakeld in de testomgeving — inloggen is gedeeld met de echte app.');
    return true;
  }
  return false;
}

// Leest het gastwachtwoord van een toernooi. Staat in een afgeschermde submap
// waar alleen de coordinator bij kan; een gewone speler krijgt hier niets.
async function _leesGastWachtwoord(toernooiId) {
  if (!toernooiId) return null;
  try {
    const snap = await getDoc(doc(db, 'toernooien', toernooiId, 'beheer', 'gastlogin'));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('gastwachtwoord lezen mislukt:', e.code || e.message);
    return null;
  }
}

// Een gast krijgt pas bij het starten een echt account, en dus een echte uid.
// Tot dat moment loopt hij mee onder een tijdelijke `gast_...`-sleutel. Die
// sleutel staat óók in de flights en in de scorerijen van elke dag; blijft daar
// de oude staan, dan hoort de speler bij niemand meer en toont zijn scorekaart
// niets. Deze functie zet hem overal tegelijk om.
function _vervangSpelerUid(toernooi, oudeUid, nieuweUid) {
  if (!toernooi || oudeUid === nieuweUid) return;
  (toernooi.spelers || []).forEach(sp => { if (sp.uid === oudeUid) sp.uid = nieuweUid; });
  (toernooi.dagen || []).forEach(dag => {
    (dag.flights || []).forEach(f => {
      f.spelerIds = (f.spelerIds || []).map(sid => sid === oudeUid ? nieuweUid : sid);
    });
    if (dag.scores && Object.prototype.hasOwnProperty.call(dag.scores, oudeUid)) {
      dag.scores[nieuweUid] = dag.scores[oudeUid];
      delete dag.scores[oudeUid];
    }
  });
}

// Maakt één Auth-account plus het profiel. Geeft { uid, login } terug.
//
// Het account wordt aangemaakt in een APART Firebase-venster. Anders logt
// createUser de coordinator uit en zit hij ineens als gast in zijn eigen app.
async function maakGastAccount(volleNaam, code, wachtwoord, toernooiNaam) {
  const { initializeApp: init2, deleteApp } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser, connectAuthEmulator: verbindEmulator } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

  let login = gastLoginVan(volleNaam, code);
  let tijdApp = null;
  let uid = null;
  let poging = 0;

  while (uid === null && poging < 5) {
    poging++;
    const email = `${login}${EMAIL_SUFFIX}`;
    try {
      tijdApp = init2(firebaseConfig, `gast_${Date.now()}_${poging}`);
      const tijdAuth = getAuth2(tijdApp);
      // Draait de app tegen de nagemaakte database (de repetitie), dan moet dit
      // tweede venster daar óók heen. Anders klopt het aan bij de echte
      // Firebase — en dat is precies wat een repetitie nooit mag doen.
      if (IS_EMULATOR) {
        try { verbindEmulator(tijdAuth, 'http://127.0.0.1:9099', { disableWarnings: true }); }
        catch (_) { /* al verbonden */ }
      }
      const cred = await createUser(tijdAuth, email, wachtwoord);
      uid = cred.user.uid;
    } catch (e) {
      if (e?.code === 'auth/email-already-in-use') {
        // Zelfde naam twee keer in hetzelfde toernooi: er een cijfer achter.
        login = `${gastLoginVan(volleNaam, code)}${poging + 1}`;
      } else {
        throw e;
      }
    } finally {
      if (tijdApp) { try { await deleteApp(tijdApp); } catch (_) {} tijdApp = null; }
    }
  }
  if (!uid) throw new Error(`Inlognaam voor ${volleNaam} is niet vrij te krijgen`);

  // Profiel erbij. eersteLogin BEWUST op false: een gast hoeft geen handicap
  // en geen nieuw wachtwoord te kiezen, dat is juist het punt.
  await setDoc(doc(db, 'spelers', uid), {
    uid,
    naam: volleNaam,
    email: `${login}${EMAIL_SUFFIX}`,
    rol: 'speler',
    hcp: 0,
    eersteLogin: false,
    toernooiSpeler: true,
    toernooiNaam: toernooiNaam || '',
    toernooiGast: true,          // waaraan het opruimen ze herkent
    toernooiCode: code
  });

  return { uid, login };
}

// ============================================================
//  EEN BESTAANDE DAG WIJZIGEN OF VERWIJDEREN  (v5.9.1)
// ============================================================
//  WAAROM. Sierk, 12 september 2026: "ik maak een toernooi aan voor 1 dag op
//  baan A maar het toernooi blijkt 2 dagen te zijn met dag 2 op baan B". Tot
//  v5.9.0 was daar maar één uitweg voor: het hele toernooi weggooien met
//  "Terug naar aanmaakscherm" en opnieuw instellen.
//
//  ⚠ De grendel: wijzigen en verwijderen kan alleen zolang er voor die dag
//  GEEN scores zijn. Een dag met scores aanpassen zou stilletjes andermans
//  ronde veranderen — en bij een ander aantal holes zelfs scores afknippen.
function dagHeeftScores(dag) {
  if (!dag) return false;
  if (dag.afgerond) return true;
  return Object.values(dag.scores || {}).some(arr =>
    (arr || []).some(v => v !== null && v !== undefined && v !== ''));
}

// Zet het venster in de stand "toevoegen" (dagNr null) of "wijzigen".
function _zetDagModalStand(dagNr) {
  window._dagBewerkenNr = dagNr;
  const titel   = document.getElementById('modal-dag-titel');
  const knop    = document.getElementById('modal-dag-opslaan-btn');
  const wis     = document.getElementById('modal-dag-verwijder-btn');
  const uitleg  = document.getElementById('modal-dag-uitleg');
  const bewerkt = dagNr != null;
  if (titel) titel.textContent = bewerkt ? `Dag ${dagNr} wijzigen` : 'Nieuwe dag toevoegen';
  if (knop) {
    knop.textContent = bewerkt ? 'Wijziging opslaan →' : 'Dag toevoegen →';
    knop.onclick = bewerkt ? slaDagWijzigingOp : voegDagToe;
  }
  if (wis) wis.style.display = bewerkt && (toernooiData?.dagen || []).length > 1 ? 'block' : 'none';
  if (uitleg) {
    uitleg.textContent = bewerkt
      ? 'Alleen mogelijk zolang er voor deze dag nog geen scores zijn ingevuld.'
      : 'De flight indeling voor deze dag stel je in na het toevoegen via de Flights knop in de scorekaart.';
  }
}

function openDagBewerkenModal() {
  const t = toernooiData;
  const dag = actieveDag(t);
  if (!dag) { toast('Geen dag gevonden'); return; }
  if (dagHeeftScores(dag)) {
    toast(`Dag ${dag.dagNr} heeft al scores — wijzigen kan niet meer`);
    return;
  }
  const datumEl = document.getElementById('t-dag-datum');
  if (datumEl) datumEl.value = dag.datum || '';

  const baanEl = document.getElementById('t-dag-baan');
  if (baanEl) {
    const banen = alleBANEN();
    baanEl.innerHTML = Object.keys(banen)
      .filter(n => n !== 'Handmatig invoeren')
      .map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`)
      .join('');
    if (dag.baan && banen[dag.baan]) baanEl.value = dag.baan;
  }

  const aantal = (dag.holes || []).length;
  const holesEl = document.getElementById('t-dag-holes');
  const custEl  = document.getElementById('t-dag-holes-custom');
  const custWrap = document.getElementById('t-dag-holes-custom-wrap');
  if (holesEl) {
    if (aantal === 18 || aantal === 9) {
      holesEl.value = String(aantal);
      if (custWrap) custWrap.style.display = 'none';
    } else {
      holesEl.value = 'custom';
      if (custEl) custEl.value = aantal;
      if (custWrap) custWrap.style.display = 'block';
    }
  }
  const tijdEl = document.getElementById('t-dag-starttijd');
  if (tijdEl) tijdEl.value = dag.starttijd || '09:00';
  const intEl = document.getElementById('t-dag-interval');
  if (intEl) intEl.value = dag.interval != null ? dag.interval : 10;

  _zetDagModalStand(dag.dagNr);
  document.getElementById('modal-nieuwe-dag').classList.add('open');
}
window.openDagBewerkenModal = openDagBewerkenModal;

async function slaDagWijzigingOp() {
  try {
    const t = toernooiData;
    const dagNr = window._dagBewerkenNr;
    const dag = (t?.dagen || []).find(d => d.dagNr === dagNr);
    if (!dag) { toast('Geen dag gevonden'); return; }
    if (dagHeeftScores(dag)) { toast(`Dag ${dagNr} heeft al scores — wijzigen kan niet meer`); return; }

    const datum    = document.getElementById('t-dag-datum')?.value;
    const baanNaam = document.getElementById('t-dag-baan')?.value;
    const holesVal = document.getElementById('t-dag-holes')?.value || '18';
    const holesCount = holesVal === 'custom'
      ? parseInt(document.getElementById('t-dag-holes-custom')?.value) || 18
      : parseInt(holesVal);

    if (!datum)    { toast('Voer een datum in'); return; }
    if (!baanNaam) { toast('Selecteer een baan'); return; }

    const banen = alleBANEN();
    const holes = (banen[baanNaam]?.holes || []).slice(0, holesCount);
    if (!holes.length) { toast('Baan heeft geen holes geconfigureerd'); return; }

    const anderAantal = holes.length !== (dag.holes || []).length;
    dag.datum     = datum;
    dag.baan      = baanNaam;
    dag.holes     = holes;
    dag.starttijd = document.getElementById('t-dag-starttijd')?.value || dag.starttijd || '09:00';
    const intVal  = parseInt(document.getElementById('t-dag-interval')?.value);
    dag.interval  = Number.isFinite(intVal) ? intVal : (dag.interval || 0);

    // Bij een ander aantal holes moeten de (lege) scorerijen mee. Er zijn hier
    // per definitie geen ingevulde scores, dus er gaat niets verloren.
    if (anderAantal) {
      dag.scores = {};
      (t.spelers || []).forEach(sp => { dag.scores[sp.uid] = Array(holes.length).fill(null); });
    }

    await slaToernooiOp();
    closeModal('modal-nieuwe-dag');
    toast(`Dag ${dagNr} gewijzigd`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag wijzigen', e); }
}
window.slaDagWijzigingOp = slaDagWijzigingOp;

async function verwijderDag() {
  try {
    const t = toernooiData;
    const dagNr = window._dagBewerkenNr;
    const dagen = t?.dagen || [];
    const dag = dagen.find(d => d.dagNr === dagNr);
    if (!dag) { toast('Geen dag gevonden'); return; }
    if (dagen.length <= 1) { toast('Een toernooi moet minstens één dag houden'); return; }
    if (dagHeeftScores(dag)) { toast(`Dag ${dagNr} heeft al scores — verwijderen kan niet meer`); return; }
    if (!confirm(`Dag ${dagNr} verwijderen?\n\nDe overige dagen worden opnieuw genummerd.`)) return;

    t.dagen = dagen.filter(d => d.dagNr !== dagNr);
    t.dagen.forEach((d, i) => { d.dagNr = i + 1; });
    t.actiefDagNr = Math.min(t.actiefDagNr || 1, t.dagen.length);
    window._bekijkDagNr = null;

    await slaToernooiOp();
    closeModal('modal-nieuwe-dag');
    toast(`Dag ${dagNr} verwijderd`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag verwijderen', e); }
}
window.verwijderDag = verwijderDag;

// Voeg nieuwe dag toe aan bestaand toernooi
async function voegDagToe() {
  try {
    const t = toernooiData;
    if (!t) return;

    const datum    = document.getElementById('t-dag-datum')?.value;
    const baanNaam = document.getElementById('t-dag-baan')?.value;
    const holesVal = document.getElementById('t-dag-holes')?.value || '18';
    const holesCount = holesVal === 'custom'
      ? parseInt(document.getElementById('t-dag-holes-custom')?.value) || 18
      : parseInt(holesVal);

    if (!datum)    { toast('Voer een datum in'); return; }
    if (!baanNaam) { toast('Selecteer een baan'); return; }

    const banen = alleBANEN();
    let holes = [];
    if (banen[baanNaam]?.holes) holes = banen[baanNaam].holes.slice(0, holesCount);
    if (!holes.length) { toast('Baan heeft geen holes geconfigureerd'); return; }

    // Nieuwe scores voor alle huidige spelers
    const scores = {};
    t.spelers.forEach(s => { scores[s.uid] = Array(holes.length).fill(null); });

    // Flight indeling: start leeg (beheerder stelt in via flight modal)
    const starttijd = document.getElementById('t-dag-starttijd')?.value || '09:00';
    const interval  = parseInt(document.getElementById('t-dag-interval')?.value) || 0;

    const nieuweDag = {
      dagNr:    (t.dagen || []).length + 1,
      datum,
      baan:     baanNaam,
      holes,
      starttijd,
      interval,
      flights:  [],  // leeg — beheerder deelt in via flight modal
      scores,
      afgerond: false
    };

    // v5.3.0: waarschuwen als de vorige dag nog niet is afgesloten. De scores
    // van een niet-afgesloten dag staan alleen in de live-subcollectie en in
    // het geheugen van dit apparaat; ze worden pas vastgelegd bij "dag
    // afsluiten". Doorgaan mag, maar niet zonder het te weten.
    const vorige = (t.dagen || [])[(t.dagen || []).length - 1];
    if (vorige && !vorige.afgerond) {
      if (!confirm(
        `Dag ${vorige.dagNr} is nog niet afgesloten.\n\n` +
        `Sluit die eerst af, anders worden de scores van die dag pas vastgelegd ` +
        `op het moment dat jij hem afsluit.\n\nToch een nieuwe dag toevoegen?`
      )) return;
    }

    if (!t.dagen) t.dagen = [];
    t.dagen.push(nieuweDag);
    t.actiefDagNr = nieuweDag.dagNr;
    window._bekijkDagNr = null; // v4.0.0: spring naar de nieuwe (echte) actieve dag (fix 7.4)

    await slaToernooiOp();
    closeModal('modal-nieuwe-dag');
    toast(`Dag ${nieuweDag.dagNr} toegevoegd`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag toevoegen', e); }
}

// Open flight modal voor de actieve dag (niet voor dag 1 aanmaken maar voor herindeling)
function openFlightIndelingDag() {
  const t = toernooiData;
  const dag = actieveDag(t);
  if (!dag) return;

  const starttijd = dag.starttijd || '09:00';
  const interval  = dag.interval  || 0;

  // Laad bestaande flights van deze dag in _flights
  if (dag.flights && dag.flights.length > 0) {
    store._flights = dag.flights.map(f => ({
      id: f.id, naam: f.naam,
      spelers: (f.spelerIds || []).map(sid => t.spelers.find(s => s.uid === sid)).filter(Boolean),
      starthole: f.starthole || 1,
      starttijd: f.starttijd || starttijd
    }));
  } else {
    // Nieuwe indeling — zet alle spelers in flight 1
    store._flights = [{ id: 1, naam: 'Flight 1', spelers: [...t.spelers], starthole: 1, starttijd }];
  }

  window._toernooiStarttijd = starttijd;
  window._toernooiInterval  = interval;
  window._flightDagModus = true; // signaal: sla op in dag ipv nieuw toernooi

  const startBtn = document.getElementById('flight-modal-start-btn');
  if (startBtn) { startBtn.textContent = 'Indeling opslaan →'; startBtn.onclick = slaFlightIndelingDagOp; }

  renderFlightLijst();
  document.getElementById('modal-flight-indeling').classList.add('open');
}

// Sla flight indeling op in de actieve dag (vanuit modal)
async function slaFlightIndelingDagOp() {
  try {
    const t = toernooiData;
    const dag = actieveDag(t);
    if (!dag) return;
    if (!_verwerkLegeFlights()) return;   // v5.9.0

    dag.flights = _flights.map(f => ({
      id: f.id, naam: f.naam,
      spelerIds: f.spelers.map(s => s.uid),
      // v5.11.0: markers in een kring — de eerste houdt de kaart bij van de
      // tweede, enzovoort, de laatste die van de eerste.
      markers: markerKring(f.spelers.map(s => s.uid)),
      starthole: f.starthole || 1,
      starttijd: f.starttijd || ''
    }));

    store._flights = [];
    window._flightDagModus = false;
    await slaToernooiOp();
    closeModal('modal-flight-indeling');
    toast('Flight indeling opgeslagen');
    renderToernooiActief();
  } catch(e) { toernooiFout('Flightindeling opslaan', e); }
}

// Sluit dag af — consolideer live-scores naar hoofddoc, zet afgerond=true
async function sluitDagAf() {
  try {
    const t   = toernooiData;
    const dag = actieveDag(t);
    if (!dag) return;

    if (!confirm(`Dag ${dag.dagNr} afsluiten? Scores zijn daarna niet meer aanpasbaar.`)) return;

    // v3.0.0-11.106: consolideer live/-subcollectie → dag.scores voordat we afsluiten.
    // Haal verse data op uit Firestore (niet alleen de lokale _liveScores cache).
    try {
      const liveSnap = await getDocs(collection(db, 'toernooien', actieveToernooiId, 'live'));
      if (!dag.scores) dag.scores = {};
      liveSnap.docs.forEach(liveDoc => {
        const scores = _liveScoresVanDag(liveDoc.data(), dag.dagNr);
        if (scores && scores.length > 0) dag.scores[liveDoc.id] = scores;
      });
    } catch(e) {
      console.warn('Live scores ophalen bij afsluiten mislukt, val terug op lokale data:', e);
      // Gebruik _liveScores als fallback
      if (!dag.scores) dag.scores = {};
      Object.keys(_liveScores).forEach(uid => {
        const scores = _liveScoresVanDag(_liveScores[uid], dag.dagNr);
        if (scores && scores.length > 0) dag.scores[uid] = scores;
      });
    }

    dag.afgerond = true;
    dag.uitslagZichtbaar = true;

    await slaToernooiOp();
    toast(`Dag ${dag.dagNr} afgesloten`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag afsluiten', e); }
}

// v5.9.0: een afgesloten dag weer openzetten.
//
// WAT ER MIS WAS: `dag.afgerond = true` werd nergens teruggezet. Eén verkeerde
// klik op "Dag afsluiten" en de scores van die dag stonden voorgoed op slot —
// ook de flightindeling was dan niet meer te wijzigen. Een toernooi opnieuw
// activeren hielp niet: dat zet alleen de status van het toernooi om, niet die
// van de dagen. Er was letterlijk geen weg terug.
//
// De uitslag blijft zichtbaar; alleen het slot gaat eraf.
async function heropenDag() {
  try {
    const t   = toernooiData;
    const dag = actieveDag(t);
    if (!dag) { toast('Geen dag gevonden om te heropenen'); return; }
    if (!dag.afgerond) { toast(`Dag ${dag.dagNr} is niet afgesloten`); return; }
    if (!confirm(`Dag ${dag.dagNr} weer openzetten?\n\n` +
                 `De scores worden weer aanpasbaar. De al berekende uitslag blijft staan ` +
                 `en wordt opnieuw bepaald zodra je de dag opnieuw afsluit.`)) return;

    dag.afgerond = false;
    await slaToernooiOp();
    toast(`Dag ${dag.dagNr} is weer open`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag heropenen', e); }
}
window.heropenDag = heropenDag;

// ============================================================
//  MATRIX / UITSLAG TOGGLE
// ============================================================
// v5.11.1: in- en uitklappen is voortaan iets van je EIGEN scherm. Het wordt
// niet meer bewaard en niet meer naar de deelnemers gestuurd; daar is de
// schakelaar "Onderlinge stand tonen aan deelnemers" voor.
function toggleToernooiMatrix() {
  window._matrixIngeklapt = !window._matrixIngeklapt;
  const collapse = document.getElementById('t-matrix-collapse');
  const kop = collapse?.previousElementSibling;
  if (collapse) collapse.classList.toggle('ingeklapt', !!window._matrixIngeklapt);
  if (kop)      kop.classList.toggle('ingeklapt', !!window._matrixIngeklapt);
}

// De schakelaar zelf: zetten de deelnemers de onderlinge stand te zien?
async function toggleMatrixVoorDeelnemers(aan) {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    toernooiData.matrixVerborgen = !aan;
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx].matrixVerborgen = !aan;
    await updateDoc(doc(db, 'toernooien', actieveToernooiId), { matrixVerborgen: !aan });
    renderToernooiActief();
    toast(aan ? 'Onderlinge stand zichtbaar voor deelnemers ✓' : 'Onderlinge stand verborgen voor deelnemers');
  } catch(e) { toernooiFout('Onderlinge stand aan/uit zetten', e); }
}
window.toggleMatrixVoorDeelnemers = toggleMatrixVoorDeelnemers;

async function toonToernooiUitslag() {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    const dag = actieveDag();
    if (dag) dag.uitslagZichtbaar = true;
    toernooiData.uitslagZichtbaar = true;
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx].uitslagZichtbaar = true;
    await setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
    renderToernooiActief();
    toast('Uitslag zichtbaar! 🏆');
  } catch(e) { toernooiFout('Uitslag tonen', e); }
}

// ============================================================
//  SPELERSBEHEER IN ACTIEF TOERNOOI
// ============================================================
let _toernooiSpelerToevoegen = null;

function openToernooiSpelersBeheer() {
  const t = toernooiData;
  if (!t) return;

  // v5.10.0: "met eigen inlog" alleen aanbieden als dit toernooi een
  // gastwachtwoord heeft. Anders is het een vinkje dat niets kan doen.
  const inlogWrap = document.getElementById('toernooi-gast-inlog-wrap');
  const inlogVink = document.getElementById('toernooi-gast-inlog');
  if (inlogVink) inlogVink.checked = false;
  if (inlogWrap) {
    inlogWrap.style.display = 'none';
    if (t.gastCode && !IS_TEST) {
      _leesGastWachtwoord(actieveToernooiId).then(geheim => {
        if (geheim?.wachtwoord) inlogWrap.style.display = 'flex';
      });
    }
  }

  const verwijderLijst = document.getElementById('toernooi-speler-verwijder-lijst');
  verwijderLijst.innerHTML = t.spelers.map(s => `
    <div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:14px">${esc(s.naam)}${s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}<br>${inlogRegel(s)}</span>
      <button class="btn btn-sm" style="background:var(--alert-bg);color:var(--alert-text);border:none;cursor:pointer;padding:5px 10px;border-radius:6px;font-size:12px"
        onclick="verwijderToernooiSpelerNieuw('${escAttr(s.uid)}')">✕</button>
    </div>
  `).join('');

  // Flight opties van actieve dag
  const dag = actieveDag(t);
  const flightOpties = ((dag?.flights) || (t.dagen?.[0]?.flights) || [{ naam: 'Flight 1' }]).map((f, i) =>
    `<option value="${i}">${esc(f.naam)}</option>`).join('');
  document.getElementById('toernooi-speler-flight-sel').innerHTML = flightOpties;
  document.getElementById('toernooi-gast-flight-sel').innerHTML = flightOpties;

  document.getElementById('toernooi-speler-zoek').value = '';
  document.getElementById('toernooi-gast-naam').value = '';
  document.getElementById('toernooi-gast-hcp').value = '';
  _toernooiSpelerToevoegen = null;

  document.getElementById('modal-toernooi-spelers').classList.add('open');
}

// v5.11.3: de inlognaam in "Spelers beheren".
//
// ⚠ WAT ER MIS WAS. Dit scherm toonde `s.login`, en dat veld wordt alleen
// gevuld voor een GAST die bij het starten een eigen inlog kreeg. Bij een
// clublid stond er dus niets, terwijl zijn inlognaam gewoon bekend is — hij
// staat in zijn eigen account (`spelers/{uid}.email`), niet in het toernooi.
//
// ⚠ En op de TESTOMGEVING krijgen gasten helemaal geen inlog: dat is sinds
// v5.10.0 bewust geblokkeerd, want het inloggen is gedeeld met de echte app.
// Dan is een lege regel misleidend — je gaat zoeken naar een fout die er niet
// is. Daarom zegt het scherm nu wat er aan de hand is.
// v5.11.4: de toernooicode hoort NIET op het scherm. In de database heet een
// gast `test.1.test1` — de code erachter zorgt dat twee toernooien allebei een
// "Test 1" kunnen hebben en dat een gast nooit op het account van een clublid
// botst. Maar intikken doet hij `test.1`, en dat is wat hier hoort te staan.
// Sierk, 12 september 2026: "wat jij er op de achtergrond van maakt voor je
// eigen database maakt mij niet uit."
function zonderToernooiCode(login, code) {
  if (!login || !code) return login || '';
  const staart = '.' + String(code).toLowerCase();
  return login.toLowerCase().endsWith(staart) ? login.slice(0, -staart.length) : login;
}

function inlogRegel(speler) {
  const stijl = "font-size:11px;color:var(--light);font-family:'DM Mono',monospace";
  const eigen = zonderToernooiCode(speler.login, toernooiData?.gastCode)
    || loginNaamVan(alleSpelersData.find(x => x.uid === speler.uid)?.email || '');
  if (eigen) return `<span style="${stijl}">⌨ ${esc(eigen)}</span>`;
  if (speler.gast && IS_TEST) {
    return `<span style="${stijl}">geen inlog — gastlogins staan uit in test</span>`;
  }
  return `<span style="${stijl}">geen eigen inlog</span>`;
}

function zoekToernooiSpelerModal(zoek) {
  const lijst = document.getElementById('toernooi-speler-zoek-lijst');
  if (!lijst) return;
  const t = toernooiData;
  const huidigeIds = new Set(t.spelers.map(s => s.uid));
  const term = zoek.toLowerCase().trim();
  const pool = alleSpelersData.filter(s => !huidigeIds.has(s.uid))
    .filter(s => !term || s.naam.toLowerCase().includes(term))
    .sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));

  lijst.innerHTML = pool.length === 0
    ? '<div style="padding:10px 14px;font-size:13px;color:var(--light)">Geen spelers gevonden</div>'
    : pool.map(s => `
      <div onpointerdown="event.preventDefault()" onclick="selecteerToernooiSpelerModal('${escAttr(s.uid)}','${escAttr(s.naam)}',${s.hcp})"
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;color:var(--dark);background:var(--card-bg)"
        onmouseenter="this.style.background='var(--green-pale)'" onmouseleave="this.style.background='var(--card-bg)'">
        <span>${esc(s.naam)}</span>
        <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>`).join('');
  lijst.style.display = 'block';
}

function selecteerToernooiSpelerModal(uid, naam, hcp) {
  _toernooiSpelerToevoegen = { uid, naam, hcp };
  document.getElementById('toernooi-speler-zoek').value = naam;
  sluitToernooiSpelerModal();
}

function sluitToernooiSpelerModal() {
  const l = document.getElementById('toernooi-speler-zoek-lijst');
  if (l) l.style.display = 'none';
}

async function voegBestaandeSpelerToeAanToernooi() {
  try {
    if (!_toernooiSpelerToevoegen) { toast('Selecteer eerst een speler'); return; }
    const t = toernooiData;
    const fi = parseInt(document.getElementById('toernooi-speler-flight-sel').value) || 0;
    const speler = { uid: _toernooiSpelerToevoegen.uid, naam: _toernooiSpelerToevoegen.naam, hcp: _toernooiSpelerToevoegen.hcp, gast: false };

    t.spelers.push(speler);
    // Voeg scores toe aan ALLE dagen
    (t.dagen || []).forEach(dag => {
      dag.scores[speler.uid] = Array(dag.holes.length).fill(null);
      if (dag.flights?.[fi]) {
        dag.flights[fi].spelerIds = [...(dag.flights[fi].spelerIds || []), speler.uid];
      }
    });

    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
    closeModal('modal-toernooi-spelers');
    renderToernooiActief();
    toast(`${speler.naam.split(' ')[0]} toegevoegd ✓`);
  } catch(e) { toernooiFout('Speler toevoegen', e); }
}

async function voegGastspelerToeAanToernooi() {
  try {
    const naam = document.getElementById('toernooi-gast-naam').value.trim();
    const hcp  = parseFloat(document.getElementById('toernooi-gast-hcp').value) || 0;
    if (!naam) { toast('Voer een naam in'); return; }
    const t = toernooiData;
    const fi = parseInt(document.getElementById('toernooi-gast-flight-sel').value) || 0;
    // v5.10.0: waarschuwen als deze naam al een clublid is. Als gast telt hij
    // NIET mee voor de ladderstand — dat is met opzet, maar het moet een keuze
    // zijn en geen ongeluk.
    const gelijkeNaam = (alleSpelersData || []).find(sp =>
      String(sp.naam || '').trim().toLowerCase() === naam.toLowerCase());
    if (gelijkeNaam) {
      const inLadder = (alleLadders || []).filter(l => (l.spelerIds || []).includes(gelijkeNaam.uid));
      if (inLadder.length > 0 && !confirm(
        `${naam} staat al in ${inLadder.map(l => l.naam).join(', ')}.\n\n` +
        `Als gastspeler telt hij NIET mee voor de ladderstand en krijgt hij een ` +
        `losse inlog. Wil je hem als gast toevoegen?`)) return;
    }

    // v5.10.0: gastlogin, als dit toernooi er een wachtwoord voor heeft.
    const gastLogin = document.getElementById('toernooi-gast-inlog')?.checked === true;
    let gastId = 'gast_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); // v4.0.0 (fix 7.7)
    let login = null;
    if (gastLogin) {
      if (_gastBeheerGeblokkeerdInTest()) return;
      const geheim = await _leesGastWachtwoord(actieveToernooiId);
      if (!geheim?.wachtwoord) {
        toast('Dit toernooi heeft geen gastwachtwoord — zet er eerst een bij het toernooi');
        return;
      }
      const gemaakt = await maakGastAccount(naam, geheim.code || toernooiCodeVan(t.naam), geheim.wachtwoord, t.naam);
      gastId = gemaakt.uid;
      login = gemaakt.login;
    }
    const speler = { uid: gastId, naam, hcp, gast: true, ...(login ? { login } : {}) };

    t.spelers.push(speler);
    (t.dagen || []).forEach(dag => {
      dag.scores[gastId] = Array(dag.holes.length).fill(null);
      if (dag.flights?.[fi]) {
        dag.flights[fi].spelerIds = [...(dag.flights[fi].spelerIds || []), gastId];
      }
    });

    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
    closeModal('modal-toernooi-spelers');
    renderToernooiActief();
    toast(login
      ? `${naam} toegevoegd — inloggen met de eigen naam en het toernooiwachtwoord ✓`
      : `${naam} toegevoegd als gastspeler ✓`, login ? 7000 : 2500);
  } catch(e) { toernooiFout('Gastspeler toevoegen', e); }
}

async function verwijderToernooiSpelerNieuw(spelerId) {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    // v4.0.0 (fix 7.5): scores op een afgesloten dag zijn gepubliceerde
    // resultaten — verwijderen zou de uitslag met terugwerkende kracht
    // wijzigen. In dat geval blokkeren we het verwijderen.
    const heeftAfgeslotenScores = (toernooiData.dagen || []).some(dag =>
      dag.afgerond === true &&
      (dag.scores?.[spelerId] || []).some(v => v !== null && v !== undefined)
    );
    if (heeftAfgeslotenScores) {
      toast('Deze speler heeft scores op een afgesloten dag — verwijderen zou de gepubliceerde uitslag wijzigen en is daarom geblokkeerd');
      return;
    }
    if (!confirm('Speler verwijderen uit dit toernooi?\n\nLet op: eventuele scores van de lopende dag en de flight-indeling van deze speler verdwijnen definitief.')) return;
    toernooiData.spelers = toernooiData.spelers.filter(s => s.uid !== spelerId);
    (toernooiData.dagen || []).forEach(dag => {
      delete dag.scores[spelerId];
      if (dag.flights) {
        dag.flights.forEach(f => { f.spelerIds = (f.spelerIds || []).filter(sid => sid !== spelerId); });
      }
    });
    // v4.0.0: ruim ook het live-scoredocument van deze speler op
    try { await deleteDoc(doc(db, 'toernooien', actieveToernooiId, 'live', spelerId)); } catch(e) { /* bestond mogelijk niet */ }
    delete store._liveScores[spelerId];
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
    closeModal('modal-toernooi-spelers');
    renderToernooiActief();
    toast('Speler verwijderd ✓');
  } catch(e) { toernooiFout('Speler verwijderen', e); }
}

function openVerwijderToernooiSpeler() { openToernooiSpelersBeheer(); }

// v4.0.0 (fix 7.7): de verouderde dubbele functie verwijderToernooiSpeler()
// is verwijderd — verwijderToernooiSpelerNieuw() is de enige route.

// ============================================================
//  SCORES VOLLEDIG CHECK
// ============================================================
// v3.0.0-11.73: Geeft true als het toernooi nog geen enkele score heeft
// en geen dag is afgerond. Gebruikt om "terug naar aanmaakscherm" toe te staan.
function heeftGeenScores(t) {
  if (!t || !t.dagen) return true;
  // v4.0.0 (fix 7.3): kijk óók naar de live-subcollectie-cache. Voorheen werd
  // alleen dag.scores gecontroleerd, maar dat veld blijft leeg totdat een dag
  // wordt afgesloten — waardoor "terug naar aanmaakscherm" tijdens een lopende
  // speeldag beschikbaar bleef terwijl er al volop live-scores waren.
  // v5.3.0: ook het nieuwe per-dag formaat meenemen, anders zou een lopende
  // speeldag onopgemerkt blijven zodra de scores alleen onder `dagen` staan.
  const liveBezet = Object.values(_liveScores || {}).some(e => {
    if ((e?.scores || []).some(v => v !== null && v !== undefined)) return true;
    return Object.values(e?.dagen || {}).some(arr =>
      (arr || []).some(v => v !== null && v !== undefined));
  });
  if (liveBezet) return false;
  return t.dagen.every(dag => {
    if (dag.afgerond) return false;
    if (!dag.scores) return true;
    return Object.values(dag.scores).every(arr =>
      (arr || []).every(v => v === null || v === undefined)
    );
  });
}

function alleScoresIngevuld(t, dag) {
  dag = dag || actieveDag(t);
  if (!dag || !t || !t.spelers || t.spelers.length === 0) return false;
  return t.spelers.every(s =>
    (dag.holes || []).every((_, i) => {
      const val = dag.scores?.[s.uid]?.[i];
      return val !== null && val !== undefined && val !== '';
    })
  );
}

// ============================================================
//  NAVIGATIE HELPERS
// ============================================================
function gaNaarLadderTab() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-ladder').classList.add('active');
  document.querySelector('nav button').classList.add('active');
  renderLadder();
}

function gaNaarToernooiOverzicht() {
  store.actieveToernooiId = null;
  store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
  renderToernooi();
}

// ============================================================
//  RENDER ACTIEF TOERNOOI
// ============================================================
function renderToernooiActief() {
  const t = toernooiData;
  if (!t) return;

  const isBeheerder   = isCoordinatorRol();
  const dag           = actieveDag(t);
  const dagNr         = dag?.dagNr || t.actiefDagNr || 1; // v4.0.0: bekeken dag (fix 7.4)
  const aantalDagen   = (t.dagen || []).length;
  const dagAfgerond   = dag?.afgerond === true;
  const uitslag       = dag?.uitslagZichtbaar === true;
  const allesIngevuld = alleScoresIngevuld(t, dag);
  const detail        = document.getElementById('toernooi-detail');
  if (!detail || !dag) return;

  const flights  = dag.flights || [];
  const mijnUid  = huidigeBruiker?.uid || null;
  const mijnFlight = flights.find(f =>
    (f.spelerIds || []).some(sid => {
      const sp = t.spelers.find(s => s.uid === sid);
      return sp && mijnUid && sp.uid === mijnUid;
    })
  );

  // Dag-tabs (altijd tonen als > 1 dag)
  let dagTabsHtml = '';
  if (aantalDagen > 1 || (isBeheerder && !dagAfgerond)) {
    dagTabsHtml = `<div style="display:flex;gap:6px;overflow-x:auto;padding:10px 16px 0;scrollbar-width:none;border-bottom:1px solid var(--border)">`;
    (t.dagen || []).forEach(d => {
      const actief = d.dagNr === dagNr;
      const kleur = d.afgerond ? 'var(--mid)' : 'var(--green)';
      dagTabsHtml += `<button onclick="selecteerDag(${d.dagNr})"
        style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px solid ${actief ? kleur : 'var(--border)'};border-bottom:none;background:${actief ? kleur : 'transparent'};color:${actief ? 'white' : 'var(--mid)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
        Dag ${d.dagNr}${d.afgerond ? ' ✓' : ''}
      </button>`;
    });
    // v5.9.1: "+ Dag toevoegen" is er voor de coordinator altijd.
    //
    // WAT ER MIS WAS: de knop verscheen alleen als ALLE dagen al afgesloten
    // waren. Merk je bij het aanmaken dat het toernooi twee dagen duurt in
    // plaats van één, dan was de enige uitweg het hele toernooi weggooien en
    // opnieuw instellen. Terwijl voegDagToe() er al klaar voor was: die
    // waarschuwt zelf netjes als de vorige dag nog niet is afgesloten. De
    // functie kon het dus wel, het scherm liet het niet toe.
    if (isBeheerder) {
      dagTabsHtml += `<button onclick="openNieuweDagModal()"
        style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px dashed var(--border);border-bottom:none;background:transparent;color:var(--green);font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif">
        + Dag toevoegen
      </button>`;
    }
    dagTabsHtml += '</div>';
  }

  // v3.0.0-11.106: bouw secties als variabelen op, zodat de volgorde
  // verschilt voor beheerder (scores onderaan) vs speler (scores bovenaan).

  // v5.11.4: voor een DEELNEMER is dit blok alleen ruis. De toernooinaam staat
  // in toernooi-modus al in de titelbalk, "Bezig" zegt hem niets, en "← Ladder"
  // werkt daar niet eens omdat die tab dan verborgen is. Sierk, 12 september
  // 2026: "dat hele blok waar test 1 bezig staat moet weg." Zijn flightnaam en
  // starttijd staan in de scorekaart zelf, dus die raakt hij niet kwijt.
  // De coordinator houdt het blok ongewijzigd.
  const titelKaart = !isBeheerder ? '' : `
    <div class="card">
      <div class="card-header">
        <h2>${esc(t.naam)}</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-gold">${dagAfgerond ? 'Dag afgesloten' : uitslag ? 'Uitslag' : 'Bezig'}</span>
          <button class="btn btn-sm btn-ghost" onclick="gaNaarLadderTab()" style="font-size:12px">← Ladder</button>
        </div>
      </div>
      <div class="card-body" style="padding:10px 16px;font-size:13px;color:var(--mid)">
        Dag ${dagNr} · ${esc(dag.datum)} · ${esc(dag.baan)} · ${dag.holes.length} holes · ${t.spelers.length} spelers
        ${flights.length > 1 ? ` · ${flights.length} flights` : ''}
        ${!isBeheerder && mijnFlight ? ` · <strong style="color:var(--green)">${esc(mijnFlight.naam)}</strong>` : ''}
      </div>
    </div>`;

  const ranglijstKaart = (uitslag || dagAfgerond || t.modus === 'strokeplay') ? `
    <div class="card">
      <div style="display:flex;gap:6px;overflow-x:auto;padding:10px 12px 0;scrollbar-width:none;border-bottom:1px solid var(--border)">
        ${(t.dagen || []).map(d => `
          <button onclick="selecteerRanglijstDag(${d.dagNr})"
            id="t-rl-tab-${d.dagNr}"
            style="flex-shrink:0;padding:5px 12px;border-radius:16px 16px 0 0;border:1.5px solid var(--border);border-bottom:none;background:transparent;color:var(--mid);font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">
            Dag ${d.dagNr}
          </button>`).join('')}
        ${aantalDagen > 1 ? `
          <button onclick="selecteerRanglijstDag(0)"
            id="t-rl-tab-0"
            style="flex-shrink:0;padding:5px 12px;border-radius:16px 16px 0 0;border:1.5px solid var(--border);border-bottom:none;background:transparent;color:var(--mid);font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">
            Totaal
          </button>` : ''}
      </div>
      <div id="t-ranglijst"></div>
    </div>` : '';

  // v5.11.1: de onderlinge stand kan voor DEELNEMERS worden uitgezet. Dan wordt
  // het blok bij hen niet getekend — niet ingeklapt maar weg. De coordinator
  // ziet hem altijd; die kan hem voor zichzelf inklappen met het pijltje.
  //
  // ⚠ WAT ER MIS WAS. Er bestond al een schakelaar, maar verstopt ALS dat
  // pijltje: `matrixIngeklapt` werd naar het toernooidocument geschreven en de
  // deelnemers kregen hem ingeklapt te zien, zonder dat iets de coordinator
  // vertelde dat hij daarmee iets voor anderen omzette. En hij hield op te
  // werken zodra de uitslag was vrijgegeven (`&& !uitslag`), want dan klapte
  // het blok bij iedereen weer open. Sierk, 12 september 2026: het gaat om
  // "het onderlinge stand blokje dat aan/uit gezet moet worden".
  //
  // Nu: één schakelaar met een naam (matrixVerborgen), en het pijltje is weer
  // gewoon een pijltje — alleen voor het eigen scherm, niets wordt bewaard.
  const matrixZichtbaar = isBeheerder || !t.matrixVerborgen;
  const matrixKaart = (t.modus !== 'strokeplay' && matrixZichtbaar) ? `
    <div class="card">
      <div class="card-header ${isBeheerder ? 'inklapbaar' : ''} ${isBeheerder && window._matrixIngeklapt ? 'ingeklapt' : ''}"
        ${isBeheerder ? 'onclick="toggleToernooiMatrix()"' : ''}>
        <h2>Onderlinge stand</h2>
        ${isBeheerder && t.matrixVerborgen ? '<span style="font-size:11px;color:var(--mid)">· niet zichtbaar voor deelnemers</span>' : ''}
      </div>
      <div class="card-collapse ${isBeheerder && window._matrixIngeklapt ? 'ingeklapt' : ''}" id="t-matrix-collapse">
        <div id="t-matrix" style="overflow-x:auto;padding:8px"></div>
      </div>
    </div>` : '';

  // v3.0.0-11.106: voor spelers een duidelijke kop met flightnaam en instructie
  const scorecardTitel = isBeheerder
    ? 'Scores dag ' + dagNr
    : mijnFlight
      ? `⛳ Jouw scorekaart · ${esc(mijnFlight.naam)}`
      : '⛳ Jouw scorekaart';

  const scorecardKaart = `
    <div class="card">
      <div class="card-header inklapbaar ${dagAfgerond ? 'ingeklapt' : ''}" onclick="toggleAdminKaart(this)">
        <h2>${scorecardTitel}</h2>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          ${isBeheerder ? `
            <button id="t-refresh-btn" class="btn btn-sm btn-ghost" onclick="refreshToernooiScorekaart()" style="display:none;background:var(--gold);color:white;border-color:var(--gold)">↺ Nieuw</button>
            ${!dagAfgerond ? `<button class="btn btn-sm btn-ghost" onclick="openFlightIndelingDag()">✈ Flights</button>` : ''}
            <button class="btn btn-sm btn-ghost" onclick="openToernooiSpelersBeheer()">👥 Spelers</button>
          ` : ''}
        </div>
      </div>
      ${!isBeheerder && !dagAfgerond && mijnFlight ? `
      <div style="padding:8px 16px 0;font-size:12px;color:var(--mid)">
        Vul hieronder je scores in per hole. Scores worden automatisch gedeeld met je flight.
      </div>` : ''}
      <div class="card-collapse ${dagAfgerond ? 'ingeklapt' : ''}">
        <div id="t-scorecard-wrap" style="overflow-x:auto"></div>
      </div>
    </div>`;

  const liveLinkKnop = `
    <div style="padding:0 0 12px">
      <button onclick="kopieerLiveLink()" class="btn btn-ghost btn-block" style="font-size:13px">
        🔗 Live meekijklink kopiëren
      </button>
    </div>`;

  const beheerderKnoppen = isBeheerder ? `
    <div style="padding:0 0 16px">
      ${!dagHeeftScores(dag) ? `
      <button class="btn btn-ghost btn-block" onclick="openDagBewerkenModal()" style="margin-bottom:8px">
        ✏️ Dag ${dagNr} wijzigen (datum, baan, holes)
      </button>
      ` : ''}
      ${(t.spelers || []).some(sp => sp.login) ? `
      <button class="btn btn-ghost btn-block" onclick="toonGastlogins()" style="margin-bottom:8px">
        ⌨ Gastlogins tonen (${(t.spelers || []).filter(sp => sp.login).length})
      </button>
      ` : ''}
      ${heeftGeenScores(t) ? `
      <button class="btn btn-secondary btn-block" onclick="bewerkToernooi()" style="margin-bottom:8px">
        ↺ Toernooi opnieuw instellen
      </button>
      <p style="font-size:11px;color:var(--light);margin:-4px 0 10px">
        Het huidige toernooi wordt verwijderd en alle instellingen komen terug in het
        aanmaakscherm. Voor alleen een dag erbij of een andere baan: gebruik de knoppen hierboven.
      </p>
      ` : ''}
      ${!dagAfgerond && !uitslag ? `
      <button id="t-uitslag-btn" class="btn btn-primary btn-block"
        style="margin-bottom:8px;${!allesIngevuld ? 'opacity:0.5;cursor:not-allowed' : ''}"
        ${!allesIngevuld ? 'disabled' : ''}>
        📊 Uitslag dag ${dagNr} ${!allesIngevuld ? '(scores onvolledig)' : ''}
      </button>
      ` : ''}
      ${uitslag && !dagAfgerond ? `
      <button class="btn btn-gold btn-block" onclick="sluitDagAf()" style="margin-bottom:8px">
        ✓ Dag ${dagNr} afsluiten
      </button>
      ` : ''}
      ${dagAfgerond ? `
      <button class="btn btn-ghost btn-block" onclick="heropenDag()" style="margin-bottom:8px">
        ↩ Dag ${dagNr} heropenen
      </button>
      ` : ''}
      ${dagAfgerond && (t.dagen || []).every(d => d.afgerond) ? `
      <button class="btn btn-gold btn-block" onclick="openToernooiAfsluiten()" style="margin-bottom:8px">
        🏅 Toernooi afsluiten${t.modus !== 'strokeplay' && (t.rankingLadderIds?.length > 0 || t.ladderId) ? ' & ladder bijwerken' : ''}
      </button>
      ` : ''}
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;font-size:13px;color:var(--dark)">
          <input type="checkbox" id="t-toernooi-modus-chk"
            ${t.toernooiModus ? 'checked' : ''}
            onchange="toggleToernooiModus(this.checked)"
            style="accent-color:var(--green);width:18px;height:18px;flex-shrink:0">
          <span><strong>Toernooi-modus</strong><br><span style="font-size:11px;color:var(--mid)">Deelnemers zien alleen de Toernooi-tab. Titelbalk toont toernooinaam.</span></span>
        </label>
      </div>
      ${!t.toernooiModus && !dagAfgerond ? `
      <div style="padding:6px 16px 10px;background:var(--gold-pale);border-radius:8px;margin-bottom:8px;font-size:12px;color:var(--gold)">
        💡 <strong>Tip:</strong> Zet toernooi-modus aan zodat deelnemers direct hun scorekaart zien en niet per ongeluk een ladderpartij starten.
      </div>
      ` : ''}
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;font-size:13px;color:var(--dark)">
          <input type="checkbox" id="t-matrix-zichtbaar-chk"
            ${t.matrixVerborgen ? '' : 'checked'}
            onchange="toggleMatrixVoorDeelnemers(this.checked)"
            style="accent-color:var(--green);width:18px;height:18px;flex-shrink:0">
          <span><strong>Onderlinge stand tonen aan deelnemers</strong><br><span style="font-size:11px;color:var(--mid)">Uit: het blok staat alleen bij jou. Jij ziet hem altijd.</span></span>
        </label>
      </div>
      <div style="padding:8px 12px;background:var(--green-pale);border-radius:8px;margin-bottom:8px;font-size:12px;color:var(--mid);border-top:1px solid var(--border)">
        👀 <strong>Markers</strong> — binnen elke flight houdt iedereen de kaart bij van één medespeler.
        Deelnemers zien hun eigen kolom en die van hun marker-speler; de rest staat op punten.
        Het oude vinkje "Scores verbergen" is daarmee vervallen.
      </div>
      <button class="btn btn-ghost btn-block" onclick="annuleerToernooi()" style="margin-bottom:8px;color:var(--red)">
        Toernooi annuleren
      </button>
    </div>
    ` : '';

  // v3.0.0-11.106: volgorde verschilt per rol
  // Speler: titel → scorekaart → ranglijst → matrix → livelink
  // Beheerder: titel → ranglijst → matrix → scorekaart → livelink → knoppen
  if (isBeheerder) {
    detail.innerHTML = dagTabsHtml + titelKaart + ranglijstKaart + matrixKaart + scorecardKaart + liveLinkKnop + beheerderKnoppen;
  } else {
    detail.innerHTML = dagTabsHtml + titelKaart + scorecardKaart + ranglijstKaart + matrixKaart + liveLinkKnop;
  }

  renderTScorecard();

  // Toon ranglijst op actieve dag als dag afgerond of uitslag zichtbaar
  if (uitslag || dagAfgerond || t.modus === 'strokeplay') {
    selecteerRanglijstDag(dagNr);
  }
  renderTMatrix();

  const uitslagBtn = document.getElementById('t-uitslag-btn');
  if (uitslagBtn) uitslagBtn.onclick = toonToernooiUitslag;
}

// ============================================================
//  RANGLIJST DAG SELECTOR
// ============================================================
// dagNr: 0 = totaal, 1..N = dag
function selecteerRanglijstDag(dagNr) {
  window._ranglijstDagNr = dagNr;
  // Update tab styling
  const t = toernooiData;
  if (!t) return;
  (t.dagen || []).forEach(d => {
    const tab = document.getElementById(`t-rl-tab-${d.dagNr}`);
    const actief = d.dagNr === dagNr;
    if (tab) {
      tab.style.background = actief ? 'var(--green)' : 'transparent';
      tab.style.color = actief ? 'white' : 'var(--mid)';
      tab.style.borderColor = actief ? 'var(--green)' : 'var(--border)';
    }
  });
  const totaalTab = document.getElementById('t-rl-tab-0');
  if (totaalTab) {
    const actief = dagNr === 0;
    totaalTab.style.background = actief ? 'var(--gold)' : 'transparent';
    totaalTab.style.color = actief ? 'white' : 'var(--mid)';
    totaalTab.style.borderColor = actief ? 'var(--gold)' : 'var(--border)';
  }
  renderTRanglijst();
}
window.selecteerRanglijstDag = selecteerRanglijstDag;

// ============================================================
//  SCORECARD
// ============================================================
// ============================================================
//  DE SCOREKAART: rollen, kleuren en meldingen — v5.11.0
// ============================================================

// Welke rol heeft de ingelogde gebruiker in de kolom van deze speler?
function rolVoorKolom(spelerUid, dag) {
  if (isCoordinatorRol()) return 'beheer';
  const mij = huidigeBruiker?.uid || null;
  if (!mij) return 'kijker';
  if (mij === spelerUid) return 'speler';
  if (markerVan(spelerUid, dag) === mij) return 'marker';
  return 'kijker';
}

// Het oordeel over één vakje. Tijdens het spelen is de live/-submap de bron;
// staat daar voor deze hole niets, dan valt hij terug op het toernooidocument
// (geconsolideerde scores van een afgesloten dag, of oudere toernooien).
function celOordeel(spelerUid, holeIdx, dag) {
  const l = lagenVanDag(_liveScores[spelerUid], dag.dagNr);
  const o = scoreOordeel(l.speler[holeIdx], l.marker[holeIdx], l.beheer[holeIdx]);
  if (o.kleur !== 'leeg') return o;
  const uitDoc = dag.scores?.[spelerUid]?.[holeIdx];
  if (uitDoc === null || uitDoc === undefined || uitDoc === '') return o;
  const v = Number(uitDoc);
  return { kleur: 'zwart', vast: false, tel: v, speler: v, marker: v, beheer: null };
}

// Welk getal krijgt DEZE kijker te zien? Ieder ziet wat hij zelf intikte; de
// wedstrijdleiding ziet dat van de speler. Zodra zij iets vaststelt, ziet
// iedereen hetzelfde getal.
function celWaarde(oordeel, rol) {
  if (oordeel.vast) return oordeel.beheer;
  return rol === 'marker' ? oordeel.marker : oordeel.speler;
}

// De opmaak van één vakje zit in CSS-klassen, niet in een stijl hier. Dat moet
// ook: de clubstijl geeft elk invoerveld op een scorekaart een eigen rand mét
// !important, en die wint van een losse stijl op het element. Zie het blok
// "DE KLEUREN VAN DE TOERNOOIKAART" onderaan de opmaak in index.html.
//   zwart = gewone rand, oranje = stippellijn, rood = dubbele rand
function celKlasse(kleur, vast) {
  const stand = kleur === 'rood' ? 't-cel-rood' : (kleur === 'oranje' ? 't-cel-oranje' : 't-cel-zwart');
  return 't-cel ' + stand + (vast ? ' t-cel-vast' : '');
}

// De regel boven de kaart. Is er niets aan de hand, dan valt hij weg.
function waarschuwingStijl(oordeel) {
  if (!oordeel.tekst) return 'display:none';
  const rood = oordeel.verschillen.length > 0;
  return 'display:block;margin:6px 12px;padding:8px 10px;border-radius:8px;font-size:12px;'
       + (rood ? 'background:#fdecea;color:#c0392b;font-weight:600;'
               : 'background:var(--gold-pale);color:var(--gold);');
}

// Uitleg bij het aantikken van een vakje. Zonder het getal van de ander:
// speler en marker moeten het er onderling over eens worden.
function meldCelStatus(spelerUid, holeIdx) {
  const dag = actieveDag();
  if (!dag) return;
  const o   = celOordeel(spelerUid, holeIdx, dag);
  const rol = rolVoorKolom(spelerUid, dag);
  if (o.kleur === 'rood') {
    toast(rol === 'beheer'
      ? `Hole ${holeIdx+1}: speler en marker hebben hier iets anders staan.`
      : `Hole ${holeIdx+1}: jij en je marker hebben hier iets anders staan — overleg even en pas aan.`, 6000);
  } else if (o.kleur === 'oranje' && rol !== 'beheer') {
    toast(`Hole ${holeIdx+1}: wacht nog op je marker.`, 4000);
  }
}
window.meldCelStatus = meldCelStatus;

// Werkt de kleuren, de getallen en de waarschuwingsregel bij ZONDER de kaart
// opnieuw op te bouwen. Nodig omdat de marker en de wedstrijdleiding tijdens
// het invullen meetypen: een volledige hertekening zou de cursor uit het
// vakje halen waar je net in staat. Het vakje dat de focus heeft blijft
// daarom met rust.
function verversScoreKleuren() {
  const wrap = document.getElementById('t-scorecard-wrap');
  const dag  = actieveDag();
  if (!wrap || !dag) return;
  const kleuren = [];
  let herbouwNodig = false;
  wrap.querySelectorAll('[data-uid]').forEach(el => {
    const uid     = el.getAttribute('data-uid');
    const holeIdx = Number(el.getAttribute('data-hole'));
    const o       = celOordeel(uid, holeIdx, dag);
    const rol     = rolVoorKolom(uid, dag);
    kleuren.push({ holeNr: holeIdx + 1, kleur: o.kleur });
    el.className = celKlasse(o.kleur, o.vast);

    // Heeft de wedstrijdleiding deze hole zojuist vastgesteld, dan hoort er
    // geen invoerveld meer te staan. Het veld gaat hier meteen op slot (zodat
    // er niets meer doorheen glipt) en de kaart wordt opnieuw getekend zodra
    // niemand in deze kaart aan het typen is.
    const moetInvoer = !dag.afgerond && rol !== 'kijker' && !(o.vast && rol !== 'beheer');
    if (moetInvoer !== (el.tagName === 'INPUT')) herbouwNodig = true;
    if (el.tagName === 'INPUT' && !moetInvoer) el.readOnly = true;

    if (el === document.activeElement) return;   // niet in andermans typewerk snijden
    const val = celWaarde(o, rol);
    const tekst = (val === null || val === undefined) ? '' : String(val);
    if (el.tagName === 'INPUT') { if (el.value !== tekst) el.value = tekst; }
    else el.textContent = tekst === '' ? '—' : tekst;
  });
  const regel = document.getElementById('t-kaart-waarschuwing');
  if (regel) {
    const o = kaartOordeel(kleuren);
    regel.textContent = o.tekst;
    regel.setAttribute('style', dag.afgerond ? 'display:none' : waarschuwingStijl(o));
  }
  if (herbouwNodig && !wrap.contains(document.activeElement)) renderTScorecard();
}

function renderTScorecard() {
  const t = toernooiData;
  if (!t) return;
  const dag = actieveDag(t);
  if (!dag) return;

  const isBeheerder = isCoordinatorRol();
  const flights = dag.flights || [];
  const mijnUid2 = huidigeBruiker?.uid || null;

  let teTonenFlights = [];
  if (isBeheerder || flights.length === 0) {
    teTonenFlights = flights.length > 0
      ? flights.map(f => ({ naam: f.naam, spelers: (f.spelerIds || []).map(sid => t.spelers.find(s => s.uid === sid)).filter(Boolean) }))
      : [{ naam: null, spelers: t.spelers }];
  } else {
    const mijnFlight = flights.find(f =>
      (f.spelerIds || []).some(sid => {
        const sp = t.spelers.find(s => s.uid === sid);
        return sp && mijnUid2 && sp.uid === mijnUid2;
      })
    );
    if (mijnFlight) {
      teTonenFlights = [{ naam: mijnFlight.naam, spelers: (mijnFlight.spelerIds || []).map(sid => t.spelers.find(s => s.uid === sid)).filter(Boolean) }];
    } else {
      teTonenFlights = [{ naam: null, spelers: t.spelers }];
    }
  }

  const scorecardWrap = document.getElementById('t-scorecard-wrap');
  if (!scorecardWrap) return;

  const activeFi = scorecardWrap._activeFlight != null
    ? Math.min(scorecardWrap._activeFlight, teTonenFlights.length - 1)
    : 0;

  let html = '';

  // v5.9.1: melden dat deze dag nog niet is ingedeeld.
  //
  // Een dag zonder flights is NIET stuk: hierboven valt hij terug op één kaart
  // met alle spelers erop, en daar kan gewoon op gescoord worden. Maar je kunt
  // niet zien of dat een bewuste keuze is of dat de indeling nog moet komen —
  // en bij een meerdaags toernooi moet hij nog komen, want dag 2 wordt
  // ingedeeld op de prestaties van dag 1.
  //
  // (In v5.9.0 stond hier een verkeerde reparatie: toen kreeg elke dag de
  // indeling van dag 1 gekopieerd. Wat Sierk op 11 september zag was iets
  // anders — een flight MET een naam en ZONDER spelers. Dat is de lege flight,
  // en die wordt sinds v5.9.0 tegengehouden bij het opslaan.)
  if (isBeheerder && flights.length === 0 && !dag.afgerond) {
    html += `<div style="background:var(--gold-pale);border-radius:8px;padding:10px 12px;margin:8px 12px;font-size:12px;color:var(--gold);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="flex:1;min-width:180px">⚑ Dag ${dag.dagNr} is nog niet in flights ingedeeld. Iedereen staat nu op één kaart.</span>
      <button class="btn btn-sm btn-ghost" onclick="openFlightIndelingDag()">✈ Nu indelen</button>
    </div>`;
  }

  if (isBeheerder && teTonenFlights.length > 1) {
    html += `<div style="display:flex;gap:0;border-bottom:2px solid var(--border);overflow-x:auto;scrollbar-width:none;padding:0 4px">`;
    teTonenFlights.forEach(({ naam }, ti) => {
      const actief = ti === activeFi;
      html += `<button onclick="selecteerFlightTab(${ti})"
        style="flex-shrink:0;padding:8px 14px;border:none;background:transparent;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:${actief?'700':'500'};color:${actief?'var(--green)':'var(--mid)'};border-bottom:2px solid ${actief?'var(--green)':'transparent'};margin-bottom:-2px;cursor:pointer">
        ${esc(naam || 'Scores')}
      </button>`;
    });
    html += '</div>';
  }

  const { naam, spelers } = teTonenFlights[activeFi];
  const tabOffset = activeFi * spelers.length * dag.holes.length;

  const flightData = (dag.flights || []).find(f => f.naam === naam);
  const starthole = (flightData?.starthole || 1) - 1;
  const holesInVolgorde = dag.holes.map((_, i) => (starthole + i) % dag.holes.length);
  const dagAfgerond = dag.afgerond === true;

  if (naam) {
    const info = [
      flightData?.starttijd ? `🕐 ${esc(flightData.starttijd)}` : null,
      flightData?.starthole ? `Hole ${flightData.starthole}` : null
    ].filter(Boolean).join(' · ');
    html += `<div style="display:flex;align-items:baseline;gap:12px;padding:8px 12px 6px">
      <span style="font-family:'Bebas Neue';font-size:16px;color:var(--green)">${esc(naam)}</span>
      ${info ? `<span style="font-size:13px;color:var(--mid)">${info}</span>` : ''}
    </div>`;
  }

  // v5.11.0: wie mag in welke kolom typen, en wat ziet hij daar?
  //   beheer  de wedstrijdleiding — overal, en haar getal is beslissend
  //   speler  zijn eigen kolom
  //   marker  de kolom van de speler wiens kaart hij bijhoudt
  //   kijker  alleen kijken, en dan zonder getal (een • zoals vroeger)
  // Hiermee vervalt het vinkje "Scores verbergen": wie wat ziet volgt nu
  // vanzelf uit de markerindeling, zonder knop om te vergeten.
  const rollen = {};
  spelers.forEach(s => { rollen[s.uid] = rolVoorKolom(s.uid, dag); });

  // De waarschuwingsregel. Staat bij speler, marker EN wedstrijdleiding: een
  // rood vakje op hole 7 van 18 zie je op een telefoon anders pas als je scrolt.
  const kleuren = [];
  spelers.forEach(s => {
    if (rollen[s.uid] === 'kijker') return;
    holesInVolgorde.forEach(holeIdx => {
      kleuren.push({ holeNr: holeIdx + 1, kleur: celOordeel(s.uid, holeIdx, dag).kleur });
    });
  });
  html += `<div id="t-kaart-waarschuwing" style="${dagAfgerond ? 'display:none' : waarschuwingStijl(kaartOordeel(kleuren))}">${esc(kaartOordeel(kleuren).tekst)}</div>`;

  html += `<div style="overflow-x:auto"><table class="scorecard" style="width:100%"><thead><tr><th class="player-col">Hole</th>`;
  // v5.11.0: unieke korte namen binnen DEZE kaart. Drie spelers die Arjan
  // heten stonden hier alle drie als "Arjan"; nu Arjan V, Arjan R, Arjan P.
  const korteNamen = kortNaamMap(spelers);
  spelers.forEach(s => {
    const delen = s.naam.split(' ');
    const rol = rollen[s.uid];
    const merk = rol === 'marker' ? ' <span title="Jij markeert deze speler" style="color:var(--green)">✔</span>' : '';
    html += `<th class="player-col" style="max-width:70px">
      <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px" title="${esc(s.naam)}">${esc(korteNamen[s.uid] || delen[0])}${merk}</span>
      <span class="hole-par" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px;${isBeheerder&&!dagAfgerond?'cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)':''}" ${isBeheerder&&!dagAfgerond?`onclick="editToernooiHcp('${escAttr(s.uid)}')"`:''}>
        ${esc(delen.slice(1).join(' ') || 'hcp '+Math.round(s.hcp))}
      </span>
    </th>`;
  });
  html += '</tr></thead><tbody>';

  holesInVolgorde.forEach((holeIdx, spelRij) => {
    const h = dag.holes[holeIdx];
    html += `<tr><td class="player-col" style="font-weight:600">${holeIdx+1}<span class="hole-par">p${h.par} SI${h.si}</span></td>`;
    spelers.forEach((s, si) => {
      const rol = rollen[s.uid];
      const o   = celOordeel(s.uid, holeIdx, dag);
      const val = celWaarde(o, rol);
      // v4.0.2: cursor-richting per rol. Beheerder vult per speler in
      // (kolom omlaag), spelers vullen per hole in (rij naar rechts:
      // hole 1 speler 1 → hole 1 speler 2 → ... → hole 2 speler 1).
      const tabIdx = isBeheerder
        ? tabOffset + si * dag.holes.length + spelRij + 1
        : tabOffset + spelRij * spelers.length + si + 1;
      // Vastgesteld door de wedstrijdleiding? Dan kunnen speler en marker die
      // hole niet meer wijzigen. Anders kan een gecontroleerde score weer
      // opengetrokken worden en ben je terug bij af.
      const opSlot = dagAfgerond || (o.vast && rol !== 'beheer');
      if (rol === 'kijker' && !dagAfgerond) {
        html += `<td style="text-align:center;color:var(--light);font-size:14px">•</td>`;
      } else if (opSlot) {
        html += `<td style="text-align:center"><span data-uid="${escAttr(s.uid)}" data-hole="${holeIdx}"
          class="${celKlasse(o.kleur, o.vast)}"
          title="${o.vast ? 'Vastgesteld door de wedstrijdleiding' : ''}">${val !== null && val !== undefined ? val : '—'}</span></td>`;
      } else {
        html += `<td><input type="number" min="1" max="12" inputmode="numeric" value="${val !== null && val !== undefined ? val : ''}"
          data-uid="${escAttr(s.uid)}" data-hole="${holeIdx}"
          tabindex="${tabIdx}" onfocus="this.select();meldCelStatus('${escAttr(s.uid)}',${holeIdx})"
          oninput="updateTScoreAndAdvance('${escAttr(s.uid)}',${holeIdx},${tabIdx},this.value)"
          class="${celKlasse(o.kleur, o.vast)}"></td>`;
      }
    });
    html += '</tr>';
  });

  html += '<tr class="t-totaal-rij" style="background:var(--green-pale)"><td class="player-col" style="font-weight:700">Tot</td>';
  spelers.forEach(s => {
    if (rollen[s.uid] === 'kijker' && !dagAfgerond) {
      html += `<td data-speler-id="${s.uid}" style="text-align:center;color:var(--light)">•</td>`;
    } else {
      const scores = dag.scores?.[s.uid] || [];
      const filled = scores.filter(v => v !== null && v !== undefined);
      const tot = filled.length ? filled.reduce((a,b) => a+Number(b), 0) : null;
      html += `<td data-speler-id="${s.uid}" style="font-family:'DM Mono',monospace;font-weight:700;text-align:center">${tot !== null ? tot : '—'}</td>`;
    }
  });
  html += '</tr></tbody></table></div>';

  scorecardWrap.innerHTML = html;
  scorecardWrap._activeFlight = activeFi;
}

function refreshToernooiScorekaart() {
  const btn = document.getElementById('t-refresh-btn');
  if (btn) btn.style.display = 'none';
  renderTScorecard();
  renderTMatrix();
  if (actieveDag()?.uitslagZichtbaar || toernooiData?.modus === 'strokeplay') renderTRanglijst();
  // v5.11.0: één plek voor de uitslagknop — zie verversUitslagKnop().
  verversUitslagKnop();
}

function selecteerFlightTab(fi) {
  const wrap = document.getElementById('t-scorecard-wrap');
  if (wrap) { wrap._activeFlight = fi; renderTScorecard(); }
}

// ============================================================
//  SCORE BIJWERKEN
// ============================================================
function updateTScoreAndAdvance(spelerId, holeIdx, tabIdx, val) {
  updateTScore(spelerId, holeIdx, val);
  // v3.0.0-11.73: auto-advance voor zowel coordinator als speler
  if (val.length > 0) {
    setTimeout(() => {
      const next = document.querySelector(`input[tabindex="${tabIdx + 1}"]`);
      if (next) { next.focus(); next.select(); }
    }, 50);
  }
}

// v5.11.0: elke invoer gaat naar de laag van degene die hem intikt.
// Zie "MARKERS EN DE DRIE SCOREKAARTEN" bovenin dit bestand.
function updateTScore(spelerId, holeIdx, val) {
  if (!toernooiData || !actieveToernooiId) return;
  const dag = actieveDag();
  if (!dag || dag.afgerond) return;

  const key = String(spelerId);
  const rol = rolVoorKolom(key, dag);
  if (rol === 'kijker') return;                 // mag hier niet typen

  const bestaand = celOordeel(key, holeIdx, dag);
  if (bestaand.vast && rol !== 'beheer') return; // wedstrijdleiding heeft het laatste woord

  const laag  = rol === 'beheer' ? 'beheerDagen' : (rol === 'marker' ? 'markerDagen' : 'dagen');
  const dagNr = dag.dagNr || toernooiData.actiefDagNr || 1;   // v4.0.0 (fix 7.4)

  // 1. de eigen laag bijwerken (lokaal, zodat de kleur meteen klopt)
  const live   = _liveScores[key] || {};
  const perDag = { ...(live[laag] || {}) };
  const rij    = Array.isArray(perDag[String(dagNr)]) ? [...perDag[String(dagNr)]] : [];
  while (rij.length < dag.holes.length) rij.push(null);
  rij[holeIdx] = val === '' ? null : parseInt(val);
  perDag[String(dagNr)] = rij;
  store._liveScores[key] = { ...live, [laag]: perDag, timestamp: Date.now() };
  if (laag === 'dagen') {
    store._liveScores[key].dagNr  = dagNr;
    store._liveScores[key].scores = rij;
  }

  // 2. opnieuw bepalen wat er MEETELT (zwart, of bij twijfel het getal van de
  //    speler). Alles wat verderop rekent — totaal, matrix, ranglijst,
  //    dag afsluiten — leest dag.scores en hoeft van de lagen niets te weten.
  if (!dag.scores) dag.scores = {};
  dag.scores[key] = _liveScoresVanDag(store._liveScores[key], dagNr) || [];

  const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
  if (idx >= 0) alleToernooien[idx] = JSON.parse(JSON.stringify(toernooiData));

  updateTTotaalRijInline();
  verversScoreKleuren();

  const isBeheerder = isCoordinatorRol();
  if (isBeheerder) {
    renderTMatrix();
  } else {
    clearTimeout(window._matrixUpdateTimer);
    window._matrixUpdateTimer = setTimeout(() => renderTMatrix(), 2000);
  }

  if (dag.uitslagZichtbaar) renderTRanglijst();

  verversUitslagKnop();

  // v3.0.0-11.106: ALLE score-invoer gaat naar live/{spelerId}.
  // Het hoofddocument wordt pas bij "dag afsluiten" bijgewerkt.
  slaSpelerScoreOp(key, dagNr, rij, laag);
}

// Holes waar speler en marker het niet eens zijn. Een uitslag op ruzie-scores
// is erger dan een uitslag die vijf minuten later komt, dus hierop gaat de
// knop "Naar de uitslag" op slot.
function openVerschillen(t, dag) {
  t = t || toernooiData;
  dag = dag || actieveDag(t);
  if (!t || !dag) return [];
  const uit = [];
  (t.spelers || []).forEach(s => {
    const l = lagenVanDag(_liveScores[s.uid], dag.dagNr);
    (dag.holes || []).forEach((_, i) => {
      if (scoreOordeel(l.speler[i], l.marker[i], l.beheer[i]).kleur === 'rood') {
        uit.push({ uid: s.uid, holeNr: i + 1 });
      }
    });
  });
  return uit;
}

// Eén plek waar de uitslagknop wordt bijgewerkt. Stond eerder op twee plekken
// met bijna dezelfde tekst; bij een wijziging bleef er steevast een achter.
function verversUitslagKnop() {
  const btn = document.getElementById('t-uitslag-btn');
  if (!btn) return;
  const t    = toernooiData;
  const dag  = actieveDag(t);
  const alles = alleScoresIngevuld(t, dag);
  const rood  = openVerschillen(t, dag);
  const mag   = alles && rood.length === 0;
  const dagNr = dag?.dagNr || t?.actiefDagNr || 1;

  btn.disabled = !mag;
  btn.style.opacity = mag ? '1' : '0.5';
  btn.style.cursor  = mag ? 'pointer' : 'not-allowed';
  // Een verschil gaat vóór een gat: een gat vult zichzelf terwijl er gespeeld
  // wordt, een verschil niet — daar moeten twee mensen iets voor doen, en hoe
  // eerder ze het horen hoe beter ze het zich nog herinneren.
  let staart = '';
  if (rood.length > 0) {
    const holes = [...new Set(rood.map(r => r.holeNr))].sort((a, b) => a - b);
    staart = ` (eerst ${holes.length === 1 ? 'hole ' + holes[0] : 'holes ' + holes.join(', ')} uitpraten)`;
  } else if (!alles) staart = ' (scores onvolledig)';
  btn.textContent = `📊 Uitslag dag ${dagNr}${staart}`;
  btn.onclick = mag ? toonToernooiUitslag : null;
}

function updateTTotaalRijInline() {
  const t   = toernooiData;
  const dag = actieveDag(t);
  if (!t || !dag) return;
  const totaalRijen = document.querySelectorAll('#t-scorecard-wrap tr.t-totaal-rij');
  totaalRijen.forEach(rij => {
    const cellen = rij.querySelectorAll('td[data-speler-id]');
    cellen.forEach(cel => {
      const sid = cel.dataset.spelerId;
      const scores = dag.scores?.[sid] || [];
      const filled = scores.filter(v => v !== null && v !== undefined);
      cel.textContent = filled.length ? filled.reduce((a,b) => a + Number(b), 0) : '—';
    });
  });
}

function editToernooiHcp(spelerId) {
  const t = toernooiData;
  if (!t) return;
  const speler = t.spelers.find(s => s.uid === spelerId);
  if (!speler) return;
  const nieuw = prompt(`Playing handicap voor ${speler.naam.split(' ')[0]}:`, Math.round(speler.hcp));
  if (nieuw === null) return;
  const val = parseFloat(nieuw);
  if (isNaN(val)) { toast('Ongeldige handicap'); return; }
  speler.hcp = val;
  if (actieveToernooiId) setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
  renderTScorecard();
  renderTRanglijst();
  renderTMatrix();
  const dag = actieveDag(t);
  const flights = dag?.flights || [];
  let hcpSpelers = t.spelers;
  if (!isCoordinatorRol() && flights.length > 0) {
    const voornaam = (huidigeBruiker?.gebruikersnaam || '').toLowerCase().split(' ')[0];
    const mijnFlight = flights.find(f => (f.spelerIds || []).some(sid => {
      const sp = t.spelers.find(s => s.uid === sid);
      return sp && sp.naam.toLowerCase().includes(voornaam);
    }));
    if (mijnFlight) hcpSpelers = (mijnFlight.spelerIds || []).map(sid =>
      t.spelers.find(s => s.uid === sid)).filter(Boolean);
  }
  // v5.8.0: renderHcpBlok krijgt nu de instellingen als object mee in plaats
  // van alleen een percentage. Toernooien spelen altijd matchplay met de
  // slagen op de laagste stroke-indexen, dus dat staat hier vast.
  renderHcpBlok(hcpSpelers, dag?.holes || [],
    { hcpPct: t.hcpPct ?? 0.75, hcpVerdeling: 'volledig', hcpPlaatsing: 'laag' },
    'toernooi-hcp-blok', 'matchplay');
  toast(`Handicap ${speler.naam.split(' ')[0]} bijgewerkt ✓`);
}

function updateTTotalen() { updateTTotaalRijInline(); }
function toggleTScorecard() {
  const w = document.getElementById('t-scorecard-wrap');
  w.style.display = w.style.display === 'none' ? '' : 'none';
}

// ============================================================
//  HCP SLAGEN
// ============================================================
// v5.3.0: `aantalHoles` is een parameter geworden in plaats van een vaste 18.
// Bij een 9-holes toernooidag rekende dit anders dan de ladder, die altijd
// het werkelijke aantal holes gebruikt (getHcpSlagenOpHole in js/ronde.js).
// Aanroepers geven nu dag.holes.length mee; 18 blijft de standaard, dus voor
// 18-holes dagen verandert er niets.
function getTHcpSlagen(spelerA, spelerB, hole, hcpPct, aantalHoles = 18) {
  const diff = Math.round(Math.abs(spelerA.hcp - spelerB.hcp) * hcpPct);
  const ontvanger = spelerA.hcp < spelerB.hcp ? spelerB : spelerA;
  const basisSlagen = Math.min(diff, aantalHoles);
  const extraSlagen = Math.max(0, diff - aantalHoles);
  const slagOpHole = (hole.si <= basisSlagen ? 1 : 0) + (hole.si <= extraSlagen ? 1 : 0);
  return { diff, ontvanger, slagOpHole };
}

// ============================================================
//  BEREKENING — per dag en totaal
// ============================================================

// Bereken matchplay punten voor één dag
function berekenTPuntenVoorDag(t, dag) {
  if (!dag) return { punten: [], won: [], tied: [], lost: [], matrix: [], standen: [] };
  const n = t.spelers.length;
  const punten = new Array(n).fill(0);
  const won    = new Array(n).fill(0);
  const tied   = new Array(n).fill(0);
  const lost   = new Array(n).fill(0);
  const matrix = Array.from({length: n}, () => new Array(n).fill(null));
  // v4.0.2: standen[i][j] = met hoeveel holes speler i voorstaat op speler j
  const standen = Array.from({length: n}, () => new Array(n).fill(null));

  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      const sA = t.spelers[i];
      const sB = t.spelers[j];
      let standA = 0;
      let gespeeld = false;

      for (let h = 0; h < dag.holes.length; h++) {
        const scoreA = dag.scores?.[sA.uid]?.[h];
        const scoreB = dag.scores?.[sB.uid]?.[h];
        if (scoreA == null || scoreB == null) continue;
        gespeeld = true;
        const hole = dag.holes[h];
        // v5.3.0 — WAT ER MIS WAS: hier stond een eigen slagberekening
        // (`hole.si <= diff`) die maximaal EEN slag per hole gaf. Het
        // handicapoverzicht op het scherm gebruikt getTHcpSlagen(), die bij een
        // verschil van meer dan 18 slagen wel een tweede slag toekent op de
        // laagste stroke-indexen. Bij grote handicapverschillen week de
        // uitgerekende uitslag dus af van wat de spelers voor zich zagen — en
        // dat is precies het soort verschil dat een toernooi laat ontsporen.
        // Nu is er nog maar een implementatie: die van getTHcpSlagen().
        const { ontvanger, slagOpHole } = getTHcpSlagen(sA, sB, hole, t.hcpPct, dag.holes.length);
        const aKrijgtSlag = (slagOpHole > 0 && ontvanger.uid === sA.uid) ? slagOpHole : 0;
        const bKrijgtSlag = (slagOpHole > 0 && ontvanger.uid === sB.uid) ? slagOpHole : 0;
        const nettoA = scoreA - aKrijgtSlag;
        const nettoB = scoreB - bKrijgtSlag;
        if (nettoA < nettoB) standA++;
        else if (nettoB < nettoA) standA--;
      }

      if (!gespeeld) continue;

      standen[i][j] = standA;   // v4.0.2: marge (positief = i staat voor)
      standen[j][i] = -standA;

      if (standA > 0) {
        punten[i] += t.ptWin; punten[j] += t.ptLoss;
        won[i]++; lost[j]++;
        matrix[i][j] = 'W'; matrix[j][i] = 'L';
      } else if (standA < 0) {
        punten[j] += t.ptWin; punten[i] += t.ptLoss;
        won[j]++; lost[i]++;
        matrix[i][j] = 'L'; matrix[j][i] = 'W';
      } else {
        punten[i] += t.ptTie; punten[j] += t.ptTie;
        tied[i]++; tied[j]++;
        matrix[i][j] = 'T'; matrix[j][i] = 'T';
      }
    }
  }
  return { punten, won, tied, lost, matrix, standen };
}

// berekenTPunten: voor matrix/ranglijst — gebruikt actieve dag of totaal
function berekenTPunten(dagNrOverride) {
  const t = toernooiData;
  const rlDag = dagNrOverride !== undefined ? dagNrOverride : (window._ranglijstDagNr ?? (t.actiefDagNr || 1));

  if (rlDag === 0) {
    // Totaal: optel over alle dagen
    const n = t.spelers.length;
    const totPunten = new Array(n).fill(0);
    const totWon    = new Array(n).fill(0);
    const totTied   = new Array(n).fill(0);
    const totLost   = new Array(n).fill(0);
    const totMatrix = Array.from({length: n}, () => new Array(n).fill(null));
    const totStanden = Array.from({length: n}, () => new Array(n).fill(null)); // v4.0.2

    (t.dagen || []).forEach(dag => {
      const res = berekenTPuntenVoorDag(t, dag);
      for (let i = 0; i < n; i++) {
        totPunten[i] += res.punten[i];
        totWon[i]    += res.won[i];
        totTied[i]   += res.tied[i];
        totLost[i]   += res.lost[i];
      }
      // Matrix totaal: tel W/L/T op als strings is lastig — sla combinatie op
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (res.matrix[i][j]) {
            totMatrix[i][j] = totMatrix[i][j]
              ? (totMatrix[i][j] === res.matrix[i][j] ? totMatrix[i][j] : 'M')
              : res.matrix[i][j];
          }
          // v4.0.2: marges optellen over dagen
          if (res.standen?.[i]?.[j] !== null && res.standen?.[i]?.[j] !== undefined) {
            totStanden[i][j] = (totStanden[i][j] ?? 0) + res.standen[i][j];
          }
        }
      }
    });
    return { punten: totPunten, won: totWon, tied: totTied, lost: totLost, matrix: totMatrix, standen: totStanden };
  } else {
    const dag = getDag(t, rlDag) || actieveDag(t);
    return berekenTPuntenVoorDag(t, dag);
  }
}

// Strokeplay ranglijst voor één dag
function berekenStrokeplayRanglijstVoorDag(t, dag) {
  if (!dag) return [];
  return t.spelers.map(s => {
    const scores = dag.scores?.[s.uid] || [];
    const hcp = Math.round(s.hcp);
    const aantalHoles = dag.holes.length;

    let bruttoTotaal = 0, nettoSlagen = 0, stableford = 0, holesGespeeld = 0;
    const holeScores = [];

    dag.holes.forEach((hole, i) => {
      const val = scores[i];
      if (val === null || val === undefined) { holeScores.push(null); return; }
      holesGespeeld++;
      const v = Number(val);
      bruttoTotaal += v;
      const slag = (hole.si <= Math.min(hcp, aantalHoles) ? 1 : 0) +
                   (hole.si <= Math.max(0, hcp - aantalHoles) ? 1 : 0);
      nettoSlagen += slag;
      const nettoVal = v - slag;
      const diff = hole.par - nettoVal;
      stableford += Math.max(0, diff + 2);
      holeScores.push({ brutto: v, netto: nettoVal, stableford: Math.max(0, diff + 2) });
    });

    return {
      s,
      holes:      holesGespeeld,
      brutto:     holesGespeeld > 0 ? bruttoTotaal : null,
      netto:      holesGespeeld > 0 ? bruttoTotaal - nettoSlagen : null,
      stableford: holesGespeeld > 0 ? stableford : null,
      holeScores
    };
  });
}

// Strokeplay totaalstand over alle dagen
function berekenStrokeplayTotaal(t) {
  return t.spelers.map((s, si) => {
    let bruttoTot = 0, nettoTot = 0, stablefordTot = 0, holesTot = 0;
    const alleHoleScores = [];
    (t.dagen || []).forEach(dag => {
      const dagRes = berekenStrokeplayRanglijstVoorDag(t, dag);
      const r = dagRes[si];
      if (r && r.holes > 0) {
        bruttoTot     += r.brutto     ?? 0;
        nettoTot      += r.netto      ?? 0;
        stablefordTot += r.stableford ?? 0;
        holesTot      += r.holes;
        alleHoleScores.push(...(r.holeScores || []));
      }
    });
    // v5.3.0: holeScores van alle dagen achter elkaar, zodat countback() ook
    // in de TOTAALstand een gelijke stand kan breken. Voorheen stond hier een
    // lege lijst en gaf countback altijd 0 terug — een gedeelde eerste plaats
    // in het eindklassement werd dus nooit beslist.
    return { s, holes: holesTot,
      brutto: holesTot > 0 ? bruttoTot : null,
      netto: holesTot > 0 ? nettoTot : null,
      stableford: holesTot > 0 ? stablefordTot : null,
      holeScores: alleHoleScores };
  });
}

function countback(a, b, sorteerOp) {
  const n = Math.max(
    (a.holeScores || []).filter(h => h !== null).length,
    (b.holeScores || []).filter(h => h !== null).length
  );
  if (n === 0) return 0;

  const segmenten = [Math.ceil(n/2), Math.ceil(n/3), Math.ceil(n/4), 1]
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const getScore = (speler, aantalVanachter) => {
    const gevuld = (speler.holeScores || []).filter(h => h !== null);
    const segment = gevuld.slice(-aantalVanachter);
    if (sorteerOp === 'stableford') return segment.reduce((sum, h) => sum + h.stableford, 0);
    else if (sorteerOp === 'netto')  return segment.reduce((sum, h) => sum + h.netto, 0);
    else                              return segment.reduce((sum, h) => sum + h.brutto, 0);
  };

  for (const seg of segmenten) {
    const sA = getScore(a, seg), sB = getScore(b, seg);
    if (sorteerOp === 'stableford') { if (sA !== sB) return sB - sA; }
    else                             { if (sA !== sB) return sA - sB; }
  }
  return 0;
}

// ============================================================
//  RANGLIJST RENDER
// ============================================================
function renderTRanglijst() {
  const el = document.getElementById('t-ranglijst');
  if (!el) return;
  const t = toernooiData;
  if (!t) return;

  const rlDag = window._ranglijstDagNr ?? (t.actiefDagNr || 1);
  const modusBar = document.getElementById('t-ranglijst-modus');
  if (modusBar) modusBar.style.display = t.modus === 'strokeplay' ? '' : 'none';

  if (t.modus === 'strokeplay') {
    const sorteerOp = t._ranglijstModus || 'brutto';
    const dagNaam = rlDag === 0 ? 'Totaal' : `Dag ${rlDag}`;
    let resultaten;
    if (rlDag === 0) {
      resultaten = berekenStrokeplayTotaal(t).filter(r => r.holes > 0);
    } else {
      const dag = getDag(t, rlDag) || actieveDag(t);
      resultaten = berekenStrokeplayRanglijstVoorDag(t, dag).filter(r => r.holes > 0);
    }

    resultaten.sort((a, b) => {
      const valA = sorteerOp === 'stableford' ? -(a.stableford ?? -999) : (a[sorteerOp] ?? 999);
      const valB = sorteerOp === 'stableford' ? -(b.stableford ?? -999) : (b[sorteerOp] ?? 999);
      if (valA !== valB) return valA - valB;
      return countback(a, b, sorteerOp);
    });

    const cbSpelers = new Set();
    for (let i = 0; i < resultaten.length - 1; i++) {
      const a = resultaten[i], b = resultaten[i+1];
      const va = sorteerOp === 'stableford' ? a.stableford : a[sorteerOp];
      const vb = sorteerOp === 'stableford' ? b.stableford : b[sorteerOp];
      if (va === vb) { cbSpelers.add(i); cbSpelers.add(i+1); }
    }

    document.querySelectorAll('.t-sort-pijl').forEach(el => el.textContent = '↕');
    const actief = document.querySelector(`.t-sort-pijl[data-col="${sorteerOp}"]`);
    if (actief) actief.textContent = sorteerOp === 'stableford' ? '↓' : '↑';

    const sorteerLabel = { brutto: 'Brutto (laag wint)', netto: 'Netto (laag wint)', stableford: 'Stableford (hoog wint)' }[sorteerOp];

    if (resultaten.length === 0) { el.innerHTML = '<div class="empty"><p>Nog geen scores ingevoerd.</p></div>'; return; }

    const thStyle = 'padding:6px 4px;background:var(--green);color:white;text-align:center;font-size:11px;cursor:pointer;white-space:nowrap;user-select:none';
    const tdStyle = 'padding:6px 4px;text-align:center;font-size:12px;font-family:"DM Mono",monospace;border-bottom:1px solid var(--border)';
    const tdNaamStyle = 'padding:6px 8px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    let html = `<div style="font-size:11px;color:var(--light);padding:6px 10px;border-bottom:1px solid var(--border)">
      <strong>${dagNaam}</strong> · Gesorteerd op: <strong style="color:var(--green)">${sorteerLabel}</strong>
      ${cbSpelers.size > 0 ? ' · <span title="Gelijke stand — volgorde bepaald door countback">CB = countback</span>' : ''}
    </div>`;
    html += '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr>';
    html += `<th style="${thStyle};text-align:left;width:24px">#</th>`;
    html += `<th style="${thStyle};text-align:left">Naam</th>`;
    html += `<th style="${thStyle}" title="Gespeelde holes">Holes</th>`;
    html += `<th style="${thStyle}" onclick="wisselRanglijstModus('brutto')">Brutto<br><span class="t-sort-pijl" data-col="brutto">↕</span></th>`;
    html += `<th style="${thStyle}" onclick="wisselRanglijstModus('netto')">Netto<br><span class="t-sort-pijl" data-col="netto">↕</span></th>`;
    html += `<th style="${thStyle}" onclick="wisselRanglijstModus('stableford')">Stableford<br><span class="t-sort-pijl" data-col="stableford">↕</span></th>`;
    html += '</tr></thead><tbody>';

    const totaalHoles = rlDag === 0
      ? (t.dagen || []).reduce((s, d) => s + d.holes.length, 0)
      : (getDag(t, rlDag) || actieveDag(t))?.holes.length || 0;

    resultaten.forEach((r, rank) => {
      const isGast = r.s.gast;
      const trStyle = rank % 2 === 0 ? '' : 'background:var(--subtle-bg)';
      const actBrutto    = sorteerOp === 'brutto'     ? 'font-weight:700;color:var(--green)' : '';
      const actNetto     = sorteerOp === 'netto'      ? 'font-weight:700;color:var(--green)' : '';
      const actStableford= sorteerOp === 'stableford' ? 'font-weight:700;color:var(--green)' : '';
      const cbBadge = cbSpelers.has(rank) ? ' <span style="font-size:9px;background:var(--warning-bg);color:var(--warning-text);border-radius:4px;padding:1px 4px;font-weight:700">CB</span>' : '';
      html += `<tr style="${trStyle}">
        <td style="${tdStyle};font-weight:700;color:${rank < 3 ? 'var(--gold)' : 'var(--light)'}">${rank+1}</td>
        <td style="${tdNaamStyle}">${esc(r.s.naam)}${isGast ? ' <em style="font-size:10px;color:var(--light)">(gast)</em>' : ''}${cbBadge}</td>
        <td style="${tdStyle};color:var(--light);font-size:11px">${r.holes}/${totaalHoles}</td>
        <td style="${tdStyle};${actBrutto}">${r.brutto ?? '—'}</td>
        <td style="${tdStyle};${actNetto}">${r.netto ?? '—'}</td>
        <td style="${tdStyle};${actStableford}">${r.stableford !== null ? r.stableford + ' pt' : '—'}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
    return;
  }

  // ── Matchplay ranglijst ──
  const dagNaam = rlDag === 0 ? 'Totaal' : `Dag ${rlDag}`;
  const { punten, won, tied, lost } = berekenTPunten(rlDag);
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  el.innerHTML = `<div style="font-size:11px;color:var(--light);padding:6px 10px;border-bottom:1px solid var(--border)"><strong>${dagNaam}</strong></div>` +
    volgorde.map((entry, rank) => `
    <div class="ladder-item">
      <div class="rank-badge ${rank < 3 ? 'top3' : ''}">${rank+1}</div>
      <div class="player-name">${esc(entry.s.naam)}${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}</div>
      <div style="font-size:12px;color:var(--light);text-align:right;line-height:1.6">
        ${entry.w}W ${entry.ti}T ${entry.l}L<br>
        <strong style="color:var(--dark)">${entry.pt > 0 ? '+' : ''}${entry.pt} pt</strong>
        ${entry.s.gast ? '<br><span style="font-size:10px;color:var(--light)">telt niet mee</span>' : ''}
      </div>
    </div>
  `).join('');
}

// ============================================================
//  MATRIX
// ============================================================
function renderTMatrix() {
  if (toernooiData?.modus && toernooiData.modus !== 'matchplay') {
    const el = document.getElementById('t-matrix');
    if (el) el.innerHTML = '';
    return;
  }
  const actief = document.activeElement;
  const tabIdx = actief?.getAttribute?.('tabindex');
  const selStart = actief?.selectionStart;

  const t = toernooiData;
  if (!t) return;
  const n = t.spelers.length;
  const rlDag = window._ranglijstDagNr ?? (t.actiefDagNr || 1);
  const { matrix, standen } = berekenTPunten(rlDag);

  const kleur = { W: '#d4edda', L: '#f8d7da', T: '#fff3cd' };

  // v5.11.0: unieke korte namen over het hele toernooi. In de onderlinge stand
  // stonden drie kolommen én drie rijen met alleen "Arjan" — niet te lezen.
  const korteNamen = kortNaamMap(t.spelers);

  let html = `<table style="border-collapse:collapse;font-size:11px;width:100%">`;
  html += `<tr><th style="padding:4px;background:var(--green);color:white"></th>`;
  t.spelers.forEach(s => {
    html += `<th style="padding:4px 6px;background:var(--green);color:white;text-align:center" title="${escAttr(s.naam)}">${esc(korteNamen[s.uid])}</th>`;
  });
  html += '</tr>';

  t.spelers.forEach((sA, i) => {
    html += `<tr><td style="padding:4px 8px;font-weight:600;font-size:12px;white-space:nowrap" title="${escAttr(sA.naam)}">${esc(korteNamen[sA.uid])}</td>`;
    t.spelers.forEach((sB, j) => {
      if (i === j) {
        html += `<td style="background:var(--border);text-align:center;padding:4px">—</td>`;
      } else {
        const res = matrix[i][j];
        // v4.0.2: toon de marge (met hoeveel holes voor/achter) i.p.v. UP/DOWN.
        // Kleur = richting (groen voor, rood achter, geel gelijk); TIED bij 0.
        const stand = standen?.[i]?.[j];
        let bg = 'transparent', tx = '';
        if (stand !== null && stand !== undefined) {
          if (stand > 0)      { bg = kleur.W; tx = String(stand); }
          else if (stand < 0) { bg = kleur.L; tx = String(Math.abs(stand)); }
          else                { bg = kleur.T; tx = 'TIED'; }
        } else if (res) {
          bg = kleur[res] || 'var(--subtle-bg)';
          tx = res;
        }
        html += `<td style="background:${bg};text-align:center;padding:4px;font-weight:700">${tx}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</table>';

  const matrixEl = document.getElementById('t-matrix');
  if (matrixEl) matrixEl.innerHTML = html;

  if (tabIdx) {
    const herstel = document.querySelector(`input[tabindex="${tabIdx}"]`);
    if (herstel) { herstel.focus(); try { herstel.setSelectionRange(selStart, selStart); } catch(e) {} }
  }
}

// ============================================================
//  AFSLUITEN TOERNOOI
// ============================================================
function openToernooiAfsluiten() {
  const t = toernooiData;
  if (!t) return;
  const isStrokeplay = t.modus === 'strokeplay';

  if (isStrokeplay) {
    if (confirm('Toernooi afsluiten? De ladderstand wordt niet aangepast.')) {
      bevestigToernooiAfsluiten();
    }
    return;
  }

  // Gebruik totaalstand als meerdere dagen
  const { punten, won, tied, lost } = berekenTPunten(0);
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  const rankingLadderIds = t.rankingLadderIds?.length > 0 ? t.rankingLadderIds : (t.ladderId ? [t.ladderId] : []);
  const heeftRankingLadders = rankingLadderIds.length > 0;
  const rankingLadderNamen = alleLadders.filter(l => rankingLadderIds.includes(l.id)).map(l => l.naam).join(', ');

  let html = '<div style="margin-bottom:12px">';
  volgorde.forEach((entry, rank) => {
    const score = `<span style="font-family:'DM Mono',monospace;color:var(--green);font-weight:700">${entry.pt > 0 ? '+' : ''}${entry.pt} pt</span>`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-family:'Bebas Neue';font-size:18px;color:${rank===0?'var(--gold)':'var(--light)'};margin-right:8px">${rank+1}</span>
        <strong>${esc(entry.s.naam)}</strong>${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}
      </div>
      ${score}
    </div>`;
  });
  html += `</div><p style="font-size:12px;color:var(--light)">${
    heeftRankingLadders
      ? `Rankingposities worden bijgewerkt in: ${rankingLadderNamen}. Alleen spelers met 5+ ladderwedstrijden.`
      : 'Er zijn geen ranking ladders gekoppeld. Ladders worden niet aangepast.'
  }</p>`;

  document.getElementById('t-eindstand').innerHTML = html;
  document.getElementById('modal-toernooi-afsluiten').classList.add('open');
}

async function bevestigToernooiAfsluiten() {
  try {
    const t = toernooiData;
    if (!t) return;

    // v5.10.0: gastlogins mogen na afloop weg.
    try { await ruimGastloginsOp(t); } catch(e) { console.warn('gastlogins opruimen:', e); }

    if (t.modus === 'strokeplay') {
      t.status = 'afgerond';
      const idx = alleToernooien.findIndex(x => x.id === actieveToernooiId);
      if (idx >= 0) alleToernooien[idx].status = 'afgerond';
      await setDoc(doc(db, 'toernooien', actieveToernooiId), t);

      // v3.0.0-11.73: reset toernooiSpeler-vlag voor batch-import deelnemers
      // v5.10.0: NIET meer `.filter(s => !s.gast)`. Sinds gasten een eigen inlog
      // kunnen hebben, zijn juist zij degenen bij wie de toernooi-vlag uit moet.
      // Een tijdelijke gast zonder account heeft geen profiel; die valt hier
      // vanzelf af omdat het document niet bestaat.
      const spelerUids = (t.spelers || []).map(s => s.uid).filter(u => u && !String(u).startsWith('gast_'));
      await Promise.all(spelerUids.map(uid =>
        getDoc(doc(db, 'spelers', uid)).then(snap => {
          if (snap.exists() && snap.data().toernooiSpeler === true) {
            return setDoc(doc(db, 'spelers', uid),
              { ...snap.data(), toernooiSpeler: false, toernooiNaam: null });
          }
        }).catch(e => console.warn('toernooiSpeler reset mislukt voor', uid, e.code))
      ));

      store.alleToernooien = alleToernooien.filter(x => x.id !== actieveToernooiId);
      store.toernooiData = store.alleToernooien.length > 0 ? store.alleToernooien[0] : null;
      store.actieveToernooiId = store.toernooiData?.id || null;
      renderToernooi();
      toast('Toernooi afgesloten ✓');
      return;
    }

    // Totaalstand over alle dagen
    const { punten, won, tied, lost, matrix } = berekenTPunten(0);
    const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
      .sort((a,b) => b.pt - a.pt || b.w - a.w);

    const rankingLadderIds = t.rankingLadderIds?.length > 0
      ? t.rankingLadderIds
      : (t.ladderId ? [t.ladderId] : []);

    for (const ladderId of rankingLadderIds) {
      const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
      if (snapExists) {
        const ladderData = snapData;
        // Lees huidige standen uit standen/{uid} — niet uit ladderData.spelers[]
        const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
        const standenMap = {};
        standenSnap.docs.forEach(d => { standenMap[d.id] = { uid: d.id, ...d.data() }; });

        const spelerIds = new Set(ladderData.spelerIds || []);
        const deelnemers = volgorde.filter(e =>
          !e.s.gast && e.s.uid && spelerIds.has(e.s.uid) && standenMap[e.s.uid]
        ); // v3.1.1: ≥5-partijen-filter verwijderd — iedere deelnemer in de uitslag telt mee op de ladder

        if (deelnemers.length > 0) {
          // Sla prevRank op
          Object.values(standenMap).forEach(s => { s.prevRank = s.rank; });
          const gesorteerd = [...deelnemers].sort((a, b) => b.pt - a.pt);

          gesorteerd.forEach(e => {
            const sp = standenMap[e.s.uid];
            if (!sp) return;
            const pt = e.pt || 0;
            if (pt === 0) return;
            const oudeRank  = sp.rank;
            const maxRank   = Object.keys(standenMap).length;
            const nieuweRank = Math.max(1, Math.min(maxRank, oudeRank - pt));
            if (nieuweRank === oudeRank) return;
            if (nieuweRank < oudeRank) {
              Object.values(standenMap).forEach(s => {
                if (s.uid !== sp.uid && s.rank >= nieuweRank && s.rank < oudeRank) s.rank++;
              });
            } else {
              Object.values(standenMap).forEach(s => {
                if (s.uid !== sp.uid && s.rank > oudeRank && s.rank <= nieuweRank) s.rank--;
              });
            }
            sp.rank = nieuweRank;
          });

          deelnemers.forEach(e => {
            const sp = standenMap[e.s.uid];
            if (sp) {
              sp.partijen = (sp.partijen || 0) + (deelnemers.length - 1);
              sp.gewonnen = (sp.gewonnen || 0) + (e.w || 0);
            }
          });

          // Hernummer ranks 1..N
          Object.values(standenMap).sort((a, b) => a.rank - b.rank).forEach((s, i) => { s.rank = i + 1; });

          // v5.2.1: standen EN punten samen wegschrijven via de server.
          // Voorheen werden alleen de standen bijgewerkt; punten.score bleef op
          // de oude waarde staan. De ladderpositie klopte daarna wel (die komt
          // uit standen), maar pasPuntenAan sorteert op punten en kon de ladder
          // daardoor verkeerd herschikken bij een handmatige aanpassing.
          const standenPayload = Object.values(standenMap).map(sp => ({
            uid: sp.uid,
            rank: sp.rank || 0,
            partijen: sp.partijen || 0,
            gewonnen: sp.gewonnen || 0,
            prevRank: sp.prevRank ?? null,
          }));
          try {
            await _verwerkToernooiStandenFn({ ladderId, isTest: IS_TEST, standen: standenPayload });
          } catch (err) {
            console.error('Toernooistanden wegschrijven mislukt:', err);
            toast('Ladderstand bijwerken na toernooi mislukt — probeer opnieuw');
          }

          await slaSnapshotOp(`🏅 Na toernooi: ${t.naam}`, ladderId);
        }
      }
    }

    // Archief — sla alle dagen op
    // v3.1.0: lees de bestaande archieftoernooien VERS uit het document i.p.v. een
    // mogelijk lege in-memory cache. Voorheen werd, als de archiefpagina nog niet
    // was geopend, op een lege lijst geunshift → alle eerdere toernooien gewist.
    let bestaandeToernooien = [];
    try {
      const _archiefSnap = await getDoc(ARCHIEF_DOC);
      if (_archiefSnap.exists()) bestaandeToernooien = _archiefSnap.data().toernooien || [];
    } catch (e) {
      console.warn('Archief vers lezen mislukt, terugval op cache:', e);
      bestaandeToernooien = window._archiefToernooienCache || [];
    }
    const archief = { seizoenen: archiefData, toernooien: bestaandeToernooien };
    if (!archief.toernooien) archief.toernooien = [];

    const matrixArchief = {};
    t.spelers.forEach((sA, i) => {
      t.spelers.forEach((sB, j) => {
        matrixArchief[`${i}_${j}`] = i === j ? 'X' : (matrix[i][j] || '-');
      });
    });

    archief.toernooien.unshift({
      naam:  t.naam,
      dagen: (t.dagen || []).map(d => ({ dagNr: d.dagNr, datum: d.datum, baan: d.baan, holes: d.holes.length })),
      ptWin: t.ptWin, ptTie: t.ptTie, ptLoss: t.ptLoss,
      ranglijst: volgorde.map(e => ({ naam: e.s.naam, hcp: Math.round(e.s.hcp), punten: e.pt, won: e.w, tied: e.ti, lost: e.l })),
      // v5.11.0: ook in het archief unieke korte namen — anders staan er in de
      // bewaarde matrix drie kolommen "Arjan" en is hij achteraf onleesbaar.
      spelerNamen: (nm => t.spelers.map(s => nm[s.uid]))(kortNaamMap(t.spelers)),
      matrix: matrixArchief,
      timestamp: Date.now()
    });
    await setDoc(ARCHIEF_DOC, archief);
    window._archiefToernooienCache = archief.toernooien; // v3.1.0: cache synchroon houden

    if (actieveToernooiId) await setDoc(doc(db, 'toernooien', actieveToernooiId), { ...toernooiData, status: 'afgerond' });

    // v3.0.0-11.73: reset toernooiSpeler-vlag voor alle deelnemers die via batch-import
    // zijn aangemaakt. Ze kunnen de app daarna als gewone speler gebruiken.
    // v5.10.0: gasten met een eigen inlog horen hier juist WEL bij — zie de
    // toelichting bij de andere afsluitroute.
    const toernooiSpelerUids = (t.spelers || [])
      .map(s => s.uid)
      .filter(u => u && !String(u).startsWith('gast_'));
    if (toernooiSpelerUids.length > 0) {
      await Promise.all(toernooiSpelerUids.map(uid =>
        getDoc(doc(db, 'spelers', uid)).then(snap => {
          if (snap.exists() && snap.data().toernooiSpeler === true) {
            return setDoc(doc(db, 'spelers', uid),
              { ...snap.data(), toernooiSpeler: false, toernooiNaam: null });
          }
        }).catch(e => console.warn('toernooiSpeler reset mislukt voor', uid, e.code))
      ));
    }

    store.alleToernooien = alleToernooien.filter(t => t.id !== actieveToernooiId);
    store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
    store.actieveToernooiId = toernooiData?.id || null;

    closeModal('modal-toernooi-afsluiten');
    toast('Toernooi afgerond! 🏅 Ladder bijgewerkt.');
    renderToernooi();
    renderLadder();
  } catch(e) { toernooiFout('Toernooi afsluiten', e); }
}

// ============================================================
//  BEWERK TOERNOOI — v3.0.0-11.73
// ============================================================
// Verwijdert het actieve toernooi uit Firestore (alleen als er geen scores zijn
// en geen dag is afgerond) en herlaadt het aanmaakscherm met alle instellingen
// vooringevuld zodat de beheerder kan aanpassen en opnieuw opstarten.
async function bewerkToernooi() {
  const t = toernooiData;
  if (!t || !actieveToernooiId) return;
  if (!heeftGeenScores(t)) {
    toast('Scores al ingevuld — bewerken niet meer mogelijk');
    return;
  }
  if (!confirm('Terug naar het aanmaakscherm? Het toernooi wordt verwijderd zodat je het opnieuw kunt instellen. Alle instellingen blijven bewaard.')) return;

  try {
    // v4.0.0 (fix 7.3): lees de live-subcollectie VERS uit Firestore vóór het
    // verwijderen. Staat daar ook maar één score, dan blokkeren we — de lokale
    // cache kan achterlopen (bijv. beheerder op een tweede apparaat).
    let liveDocs = null;
    try {
      liveDocs = await getDocs(collection(db, 'toernooien', actieveToernooiId, 'live'));
      const liveHeeftScores = liveDocs.docs.some(d =>
        ((d.data().scores) || []).some(v => v !== null && v !== undefined)
      );
      if (liveHeeftScores) {
        toast('Er zijn al live-scores ingevoerd — teruggaan naar het aanmaakscherm kan niet meer');
        return;
      }
    } catch(e) { console.warn('Live-scores verifiëren mislukt:', e); }

    // Verwijder uit Firestore
    await deleteDoc(doc(db, 'toernooien', actieveToernooiId));

    // Verwijder ook eventuele live/{uid} score-docs (opruimen)
    try {
      if (!liveDocs) liveDocs = await getDocs(collection(db, 'toernooien', actieveToernooiId, 'live'));
      await Promise.all(liveDocs.docs.map(d => deleteDoc(d.ref)));
    } catch(e) { /* live docs bestaan mogelijk niet — geen probleem */ }

    // Update lokale state
    store.alleToernooien = alleToernooien.filter(x => x.id !== actieveToernooiId);
    store.toernooiData   = alleToernooien.length > 0 ? alleToernooien[0] : null;
    store.actieveToernooiId = store.toernooiData?.id || null;

    // Herlaad setup-state vanuit het verwijderde document
    _herstelSetupVanuitToernooi(t);

    // Toon het aanmaakscherm
    renderToernooi();

    // Klap de setup-kaart open
    const setupHeader = document.querySelector('#toernooi-setup-wrap .card-header.inklapbaar');
    if (setupHeader && setupHeader.classList.contains('ingeklapt')) {
      setupHeader.classList.remove('ingeklapt');
      const collapse = setupHeader.nextElementSibling;
      if (collapse) collapse.classList.remove('ingeklapt');
    }

    toast('Instellingen hersteld — pas aan en start opnieuw');
  } catch(e) { toernooiFout('bewerkToernooi', e); }
}
window.bewerkToernooi = bewerkToernooi;

// Herlaad de aanmaak-state (formuliervelden + spelers + flights) vanuit een bestaand toernooi-object
function _herstelSetupVanuitToernooi(t) {
  // Naam
  const naamEl = document.getElementById('t-naam');
  if (naamEl) naamEl.value = t.naam || '';

  // Modus
  const modusRadio = document.querySelector(`input[name="t-modus"][value="${t.modus || 'matchplay'}"]`);
  if (modusRadio) { modusRadio.checked = true; toernooiModusWissel(t.modus || 'matchplay'); }

  // Punt-instellingen
  if (t.ptWin  !== undefined) { const el = document.getElementById('t-pt-win');  if (el) el.value = t.ptWin; }
  if (t.ptTie  !== undefined) { const el = document.getElementById('t-pt-tie');  if (el) el.value = t.ptTie; }
  if (t.ptLoss !== undefined) { const el = document.getElementById('t-pt-loss'); if (el) el.value = t.ptLoss; }
  if (t.hcpPct !== undefined) { const el = document.getElementById('t-hcp-pct'); if (el) el.value = Math.round(t.hcpPct * 100); }

  // Dag 1 starttijd + interval (van eerste dag)
  const dag1 = (t.dagen || [])[0];
  if (dag1?.starttijd) { const el = document.getElementById('t-starttijd'); if (el) el.value = dag1.starttijd; }
  if (dag1?.interval  !== undefined) { const el = document.getElementById('t-interval');  if (el) el.value = dag1.interval; }

  // Aantal dagen + dag-blokken
  const aantalEl = document.getElementById('t-aantal-dagen');
  const aantalDagen = (t.dagen || []).length;
  if (aantalEl) aantalEl.value = aantalDagen;
  renderDagBlokken();

  // Vul datum en baan in per dag (na renderDagBlokken zodat de blokken bestaan)
  const dagBlokken = document.querySelectorAll('#t-dag-blokken .dag-blok');
  (t.dagen || []).forEach((dag, i) => {
    const blok = dagBlokken[i];
    if (!blok) return;
    const datumEl = blok.querySelector('.t-dag-datum');
    if (datumEl && dag.datum) datumEl.value = dag.datum;
    const baanEl = blok.querySelector('.t-dag-baan');
    if (baanEl && dag.baan) {
      if ([...baanEl.options].some(o => o.value === dag.baan)) baanEl.value = dag.baan;
    }
    const holesEl = blok.querySelector('.t-dag-holes');
    if (holesEl && dag.holes) {
      const n = dag.holes.length;
      if (n === 18 || n === 9) holesEl.value = String(n);
      else {
        holesEl.value = 'custom';
        const custEl = blok.querySelector('.t-dag-holes-custom');
        const custWrap = blok.querySelector('.t-dag-holes-custom-wrap');
        if (custEl) custEl.value = n;
        if (custWrap) custWrap.style.display = 'block';
      }
    }
  });

  // Spelers — herstel uit t.spelers
  store._tGeselecteerdeSpelers = (t.spelers || []).map(s => ({
    uid: s.uid, naam: s.naam, hcp: s.hcp, gast: s.gast || false
  }));
  renderTGeselecteerdeSpelers();

  // Ladder-checkboxes (spelers + ranking) — herstel via rankingLadderIds
  store._tRankingLadderIds = new Set(t.rankingLadderIds || (t.ladderId ? [t.ladderId] : []));
  store._tSpelersLadderIds = new Set(t.rankingLadderIds || (t.ladderId ? [t.ladderId] : []));
  initToernooiSetup(); // herlaadt checkbox-states

  // Flights — herstel uit dag 1 flights
  const dag1Flights = (t.dagen?.[0]?.flights || []);
  if (dag1Flights.length > 0) {
    store._flights = dag1Flights.map(f => ({
      id:       f.id,
      naam:     f.naam,
      starthole: f.starthole || 1,
      starttijd: f.starttijd || dag1?.starttijd || '09:00',
      spelers:  (f.spelerIds || []).map(uid => {
        const sp = (t.spelers || []).find(s => s.uid === uid);
        return sp ? { ...sp } : null;   // v5.10.0: gast-vlag mee
      }).filter(Boolean)
    }));
  } else {
    store._flights = [];
  }
}

async function annuleerToernooi() {
  try {
    // v4.0.0 (fix 7.2): eerlijke tekst — annuleren is herstelbaar via de
    // sectie "Geannuleerde toernooien" onderaan de toernooipagina.
    if (!confirm("Toernooi annuleren?\n\nHet toernooi verdwijnt uit beeld, maar kan via 'Geannuleerde toernooien' worden hersteld of definitief verwijderd.")) return;
    // v5.10.0: eerst de gastlogins aanbieden om op te ruimen, zolang het
    // toernooi-object nog compleet in beeld is.
    try { await ruimGastloginsOp(toernooiData); } catch(e) { console.warn('gastlogins opruimen:', e); }
    if (actieveToernooiId) await setDoc(doc(db, 'toernooien', actieveToernooiId), { ...toernooiData, status: 'geannuleerd' });
    store.alleToernooien = alleToernooien.filter(t => t.id !== actieveToernooiId);
    store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
    store.actieveToernooiId = toernooiData?.id || null;
    window._bekijkDagNr = null;
    renderToernooi();
    toast('Toernooi geannuleerd — herstelbaar via Geannuleerde toernooien');
  } catch(e) { toernooiFout('Toernooi annuleren', e); }
}

// ============================================================
//  GEANNULEERDE TOERNOOIEN — v4.0.0 (fix 7.2)
// ============================================================
// Geannuleerde toernooien bleven voorheen onzichtbaar in Firestore staan.
// Deze sectie maakt ze zichtbaar voor de beheerder, met de keuze om te
// herstellen (status terug naar actief) of definitief te verwijderen.

// v5.9.0: zolang er een toernooi loopt is het aanmaakformulier opgeborgen.
// Deze knop haalt het terug — bewust één extra handeling, zodat niemand per
// ongeluk een tweede toernooi naast het lopende begint.
function renderNieuwToernooiKnop(toon) {
  let sectie = document.getElementById('toernooi-nieuw-sectie');
  if (!toon) { if (sectie) sectie.remove(); return; }
  if (sectie) return;
  sectie = document.createElement('div');
  sectie.id = 'toernooi-nieuw-sectie';
  sectie.innerHTML = `
    <button class="btn btn-ghost btn-block" style="font-size:13px;color:var(--mid);margin-top:4px" onclick="toonNieuwToernooiFormulier()">
      ➕ Nieuw toernooi aanmaken
    </button>`;
  const pageEl = document.getElementById('page-toernooi');
  if (pageEl) pageEl.appendChild(sectie);
}

function toonNieuwToernooiFormulier() {
  window._toonNieuwToernooiFormulier = true;
  renderToernooi();
  const setup = document.getElementById('toernooi-setup-wrap');
  if (setup) setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.toonNieuwToernooiFormulier = toonNieuwToernooiFormulier;

function renderGeannuleerdeKnop(isBeheerder) {
  let sectie = document.getElementById('toernooi-geannuleerd-sectie');
  if (!isBeheerder) { if (sectie) sectie.remove(); return; }
  if (sectie) return;
  sectie = document.createElement('div');
  sectie.id = 'toernooi-geannuleerd-sectie';
  sectie.innerHTML = `
    <button class="btn btn-ghost btn-block" style="font-size:13px;color:var(--mid);margin-top:4px" onclick="laadGeannuleerdeToernooien()">
      🗂 Eerdere toernooien tonen
    </button>
    <div id="toernooi-geannuleerd-lijst"></div>`;
  const pageEl = document.getElementById('page-toernooi');
  if (pageEl) pageEl.appendChild(sectie);
}

async function laadGeannuleerdeToernooien() {
  const lijst = document.getElementById('toernooi-geannuleerd-lijst');
  if (!lijst) return;
  lijst.innerHTML = '<p style="font-size:13px;color:var(--light);padding:8px 4px">Laden…</p>';
  try {
    // v5.10.0: ook AFGERONDE toernooien staan hier.
    //
    // WAAROM DIT MOEST. De app haalt alleen toernooien op met status 'actief'.
    // Sloot je een toernooi af, dan was het daarna nergens meer te bereiken —
    // en dus ook de uitslaglink niet meer te beheren. Deze lijst was het enige
    // venster op oude toernooien en liet alleen geannuleerde zien.
    const snap = await getDocs(query(TOERNOOIEN_COL, where('status', 'in',
      ['geannuleerd', 'afgerond', 'afgelopen'])));
    if (snap.empty) {
      lijst.innerHTML = '<p style="font-size:13px;color:var(--light);padding:8px 4px">Geen eerdere toernooien.</p>';
      return;
    }
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    lijst.innerHTML = '<div class="card" style="margin-top:8px">' + items.map(t => {
      const geannuleerd = t.status === 'geannuleerd';
      const openbaar = t.publiek !== false;
      return `
      <div style="padding:10px 14px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.naam || 'Naamloos')}</div>
            <div style="font-size:11px;color:var(--light)">
              ${geannuleerd ? 'geannuleerd' : 'afgerond'} · ${(t.dagen || []).length} dag(en) · ${(t.spelers || []).length} spelers${t.timestamp ? ' · ' + new Date(t.timestamp).toLocaleDateString('nl-NL') : ''}
            </div>
          </div>
          ${geannuleerd ? `<button class="btn btn-sm btn-ghost" style="color:var(--green)" onclick="herstelGeannuleerdToernooi('${escAttr(t.id)}')">↩ Herstellen</button>` : ''}
          <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="verwijderGeannuleerdToernooi('${escAttr(t.id)}','${escAttr(t.naam || '')}')">🗑</button>
        </div>
        ${!geannuleerd ? `
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--mid);flex:1;min-width:190px">
            <input type="checkbox" ${openbaar ? 'checked' : ''}
              onchange="zetToernooiOpenbaar('${escAttr(t.id)}', this.checked)"
              style="accent-color:var(--green);width:16px;height:16px;flex-shrink:0">
            <span>Uitslag openbaar via de link</span>
          </label>
          ${openbaar ? `<button class="btn btn-sm btn-ghost" onclick="kopieerUitslagLink('${escAttr(t.id)}')">🔗 Link kopiëren</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('') + '</div>';
  } catch(e) {
    console.error('Geannuleerde toernooien laden mislukt:', e);
    lijst.innerHTML = '<p style="font-size:13px;color:var(--red);padding:8px 4px">Laden mislukt, probeer opnieuw.</p>';
  }
}

async function herstelGeannuleerdToernooi(id) {
  try {
    if (!confirm('Dit toernooi herstellen? Het wordt weer actief, inclusief alle eerder ingevoerde scores.')) return;
    await updateDoc(doc(db, 'toernooien', id), { status: 'actief' });
    await herlaadToernooien();
    store.actieveToernooiId = id;
    store.toernooiData = alleToernooien.find(t => t.id === id) || null;
    window._bekijkDagNr = null;
    const lijst = document.getElementById('toernooi-geannuleerd-lijst');
    if (lijst) lijst.innerHTML = '';
    renderToernooi();
    toast('Toernooi hersteld ✓');
  } catch(e) { console.error('herstelGeannuleerdToernooi mislukt:', e); toast('Herstellen mislukt, probeer opnieuw'); }
}

async function verwijderGeannuleerdToernooi(id, naam) {
  try {
    if (!confirm(`"${naam || 'Dit toernooi'}" DEFINITIEF verwijderen?\n\nDit kan niet ongedaan worden gemaakt — alle scores verdwijnen voorgoed.`)) return;
    try {
      const liveDocs = await getDocs(collection(db, 'toernooien', id, 'live'));
      await Promise.all(liveDocs.docs.map(d => deleteDoc(d.ref)));
    } catch(e) { /* live docs bestaan mogelijk niet */ }
    await deleteDoc(doc(db, 'toernooien', id));
    laadGeannuleerdeToernooien();
    toast('Toernooi definitief verwijderd');
  } catch(e) { console.error('verwijderGeannuleerdToernooi mislukt:', e); toast('Verwijderen mislukt, probeer opnieuw'); }
}
window.laadGeannuleerdeToernooien = laadGeannuleerdeToernooien;
window.herstelGeannuleerdToernooi = herstelGeannuleerdToernooi;
window.verwijderGeannuleerdToernooi = verwijderGeannuleerdToernooi;

// ============================================================
//  MODUS / RANGLIJST WISSEL
// ============================================================
function toernooiModusWissel(modus) {
  const matchplay  = document.getElementById('t-matchplay-instellingen');
  const strokeplay = document.getElementById('t-strokeplay-instellingen');
  const rankingWrap = document.getElementById('t-ranking-ladders-wrap');
  if (matchplay)   matchplay.style.display   = modus === 'matchplay'  ? '' : 'none';
  if (strokeplay)  strokeplay.style.display  = modus === 'strokeplay' ? '' : 'none';
  if (rankingWrap) rankingWrap.style.display = modus === 'matchplay'  ? '' : 'none';
}

async function wisselRanglijstModus(modus) {
  if (toernooiData) {
    toernooiData._ranglijstModus = modus;
    renderTRanglijst();
    try {
      // v4.0.0 (fix 7.6): alleen het gewijzigde veld schrijven
      if (actieveToernooiId) await updateDoc(doc(db, 'toernooien', actieveToernooiId), { _ranglijstModus: modus });
    } catch(e) { console.error('wisselRanglijstModus opslaan mislukt:', e); }
  }
}
window.wisselRanglijstModus = wisselRanglijstModus;
window.toernooiModusWissel = toernooiModusWissel;

// ============================================================
//  LIVE LINK
// ============================================================
function kopieerLiveLink() {
  if (!actieveToernooiId) { toast('Geen actief toernooi'); return; }
  const base = window.location.href.split('/').slice(0, -1).join('/');
  const url = `${base}/toernooi-live.html?t=${actieveToernooiId}`;
  navigator.clipboard.writeText(url).then(() => {
    toast('Link gekopieerd! Deel deze in WhatsApp om mee te laten kijken ✓');
  }).catch(() => {
    prompt('Kopieer deze link:', url);
  });
}
window.kopieerLiveLink = kopieerLiveLink;

// v5.10.0: dezelfde link, maar voor een toernooi dat al is afgesloten. Die
// staat in de lijst "Eerdere toernooien", want een afgerond toernooi is
// nergens anders meer te bereiken.
function kopieerUitslagLink(id) {
  const base = window.location.href.split('/').slice(0, -1).join('/');
  const url = `${base}/toernooi-live.html?t=${id}`;
  navigator.clipboard.writeText(url).then(() => {
    toast('Link gekopieerd — hier blijft de uitslag staan ✓');
  }).catch(() => {
    prompt('Kopieer deze link:', url);
  });
}
window.kopieerUitslagLink = kopieerUitslagLink;

// v5.10.0: de uitslaglink achteraf dichtzetten of weer openen.
//
// ⚠ ALLEEN BIJ EEN NIET-ACTIEF TOERNOOI. Dat is geen willekeur: de
// meekijkpagina zoekt zonder link-parameter zelf het actieve toernooi op, en
// Firestore laat een hele zoekopdracht vallen zodra er ook maar één document
// bij zit dat niet gelezen mag worden. Een dichtgezet ACTIEF toernooi zou het
// meekijken dus voor alle toernooien tegelijk slopen. Zie ook de toelichting
// in firestore.rules.
async function zetToernooiOpenbaar(id, openbaar) {
  try {
    const snap = await getDoc(doc(db, 'toernooien', id));
    if (!snap.exists()) { toast('Toernooi niet gevonden'); return; }
    if (snap.data().status === 'actief') {
      toast('Kan pas na afloop: een lopend toernooi blijft zichtbaar');
      laadGeannuleerdeToernooien();
      return;
    }
    await updateDoc(doc(db, 'toernooien', id), { publiek: !!openbaar });
    toast(openbaar
      ? 'Uitslag is weer openbaar via de link ✓'
      : 'Uitslag is niet meer openbaar — de link geeft nu niets meer');
    laadGeannuleerdeToernooien();
  } catch(e) { toernooiFout('Uitslag openbaar wijzigen', e); }
}
window.zetToernooiOpenbaar = zetToernooiOpenbaar;

// v5.10.0: alle gastlogins van dit toernooi bij elkaar, met het wachtwoord,
// zodat de coordinator ze in één keer kan uitdelen.
//
// ⚠ Dit toont een wachtwoord op het scherm. Dat is precies de bedoeling — het
// is een weggooiwachtwoord voor één toernooi — maar het is bewust een aparte
// handeling en het staat nergens standaard in beeld.
async function toonGastlogins() {
  try {
    const t = toernooiData;
    if (!t) return;
    const gasten = (t.spelers || []).filter(sp => sp.login);
    if (gasten.length === 0) { toast('Geen gastlogins in dit toernooi'); return; }

    const geheim = await _leesGastWachtwoord(actieveToernooiId);
    const ww = geheim?.wachtwoord || '(wachtwoord niet gevonden)';
    const regels = gasten.map(g => `${g.naam}  —  inlog: ${g.naam}  ·  wachtwoord: ${ww}`);
    const tekst = `Inloggen op ${window.location.origin}${window.location.pathname}\n\n`
      + regels.join('\n')
      + `\n\nTip: de gast tikt zijn eigen voor- en achternaam in, plus dit wachtwoord.`;

    const html = `
      <p style="font-size:13px;color:var(--mid);margin-bottom:10px">
        Deze spelers loggen in met hun <strong>voor- en achternaam</strong> en het
        wachtwoord hieronder. Na afloop van het toernooi werkt de inlog niet meer.
      </p>
      <div style="background:var(--soft-bg);border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--mid);text-transform:uppercase;font-weight:600">Wachtwoord</div>
        <div style="font-family:'DM Mono',monospace;font-size:16px">${esc(ww)}</div>
      </div>
      ${gasten.map(g => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span>${esc(g.naam)}</span>
          <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--light)">${esc(g.login)}</span>
        </div>`).join('')}
      <button class="btn btn-primary btn-block" style="margin-top:12px"
        onclick="kopieerGastlogins()">📋 Lijst kopiëren</button>`;

    window._gastloginTekst = tekst;
    document.getElementById('archief-detail-titel').textContent = 'Gastlogins';
    document.getElementById('archief-detail-inhoud').innerHTML = html;
    document.getElementById('modal-archief-detail').classList.add('open');
  } catch(e) { toernooiFout('Gastlogins tonen', e); }
}
window.toonGastlogins = toonGastlogins;

function kopieerGastlogins() {
  const tekst = window._gastloginTekst || '';
  navigator.clipboard.writeText(tekst)
    .then(() => toast('Lijst gekopieerd ✓'))
    .catch(() => prompt('Kopieer deze lijst:', tekst));
}
window.kopieerGastlogins = kopieerGastlogins;

// ============================================================
//  GASTLOGINS OPRUIMEN  (v5.10.0)
// ============================================================
//  Na afloop mogen de accounts weg. Sierk ruimt liever zelf op, maar dan moeten
//  ze wel als groep herkenbaar zijn — vandaar de toernooicode in de inlognaam
//  en het veld `toernooiGast` op het profiel.
//
//  ⚠ DRIE GRENDELS, want dit verwijdert accounts van mensen:
//    1. alleen spelers met `gast: true` in DIT toernooi die een `login` hebben;
//    2. het profiel moet `toernooiGast: true` dragen — een clublid heeft dat
//       nooit, ook niet als hij toevallig als gast meedeed;
//    3. de uid mag in GEEN ENKELE ladder voorkomen.
//  Valt er ook maar één controle om, dan wordt die speler overgeslagen en
//  gemeld. Liever een account te veel blijven staan dan een clublid kwijt.
async function ruimGastloginsOp(toernooi) {
  const t = toernooi || toernooiData;
  const gasten = (t?.spelers || []).filter(sp => sp.gast && sp.login && sp.uid);
  if (gasten.length === 0) return { verwijderd: 0, overgeslagen: [] };

  if (!confirm(
    `Er horen ${gasten.length} gastlogin(s) bij dit toernooi.\n\n` +
    `Verwijderen? De spelers blijven in de uitslag staan; alleen hun inlog verdwijnt.`
  )) return { verwijderd: 0, overgeslagen: [], afgezien: true };

  const ladderUids = new Set((alleLadders || []).flatMap(l => l.spelerIds || []));
  let verwijderd = 0;
  const overgeslagen = [];

  for (const g of gasten) {
    try {
      if (ladderUids.has(g.uid)) { overgeslagen.push(`${g.naam} (staat in een ladder)`); continue; }
      const snap = await getDoc(doc(db, 'spelers', g.uid));
      if (!snap.exists()) { overgeslagen.push(`${g.naam} (geen profiel)`); continue; }
      if (snap.data().toernooiGast !== true) { overgeslagen.push(`${g.naam} (geen gastaccount)`); continue; }
      // Eerst het profiel weg, dan het account. De Cloud Function verwijdert
      // uitsluitend accounts ZONDER profiel — die veiligheidsklep blijft zo heel.
      await deleteDoc(doc(db, 'spelers', g.uid));
      await _verwijderGastAccountFn({ targetUid: g.uid, isTest: IS_TEST });
      verwijderd++;
    } catch (e) {
      console.error('gastlogin opruimen mislukt voor', g.naam, e);
      overgeslagen.push(`${g.naam} (${e?.code || e?.message || 'onbekende fout'})`);
    }
  }

  if (overgeslagen.length > 0) {
    toast(`${verwijderd} inlog(s) weg. Overgeslagen: ${overgeslagen.join(', ')}`, 9000);
  } else {
    toast(`${verwijderd} gastlogin(s) verwijderd ✓`);
  }
  return { verwijderd, overgeslagen };
}
window.ruimGastloginsOp = ruimGastloginsOp;

// ============================================================
//  TOERNOOI-MODUS
// ============================================================
async function toggleToernooiModus(aan) {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    toernooiData.toernooiModus = !!aan;
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx].toernooiModus = !!aan;
    // v4.0.0 (fix 7.6): alleen het gewijzigde veld schrijven
    await updateDoc(doc(db, 'toernooien', actieveToernooiId), { toernooiModus: !!aan });
    // Laat auth.js de nav + header bijwerken
    window.dispatchEvent(new CustomEvent('toernooiModusGewijzigd'));
    toast(aan ? 'Toernooi-modus aan ✓' : 'Toernooi-modus uit');
  } catch(e) { toernooiFout('Toernooi-modus wijzigen', e); }
}
window.toggleToernooiModus = toggleToernooiModus;


export function getActiefToernooiMetModus() {
  return alleToernooien.find(t => t.toernooiModus && t.status === 'actief') || null;
}


export { alleScoresIngevuld, annuleerToernooi, behoudLiveScores, berekenFlightTijd, berekenTPunten, bevestigToernooiAfsluiten, editToernooiHcp, gaNaarLadderTab, gaNaarToernooiOverzicht, getTHcpSlagen, getToernooiSpelersPool, herlaadToernooien, herlaadToernooiListeners, initToernooiSetup, openFlightIndeling, openFlightIndelingDag, openNieuweDagModal, openToernooiAfsluiten, openToernooiSpelersBeheer, openVerwijderToernooiSpeler, refreshToernooiScorekaart, renderDagBlokken, renderFlightLijst, renderTGeselecteerdeSpelers, renderTMatrix, renderTRanglijst, renderTScorecard, renderToernooi, renderToernooiActief, selecteerDag, selecteerFlightTab, selecteerToernooi, selecteerToernooiSpeler, selecteerToernooiSpelerModal, sluitDagAf, sluitToernooiSpelerLijst, sluitToernooiSpelerModal, slaFlightIndelingDagOp, startToernooi, toggleHolesCustom, toggleTRankingLadder, toggleTScorecard, toggleTSpeler, toggleTSpelersLadder, toggleToernooiMatrix, toonToernooiUitslag, updateTScore, updateTScoreAndAdvance, updateTTotaalRijInline, updateTTotalen, verplaatsSpelerFlight, verwijderFlight, verwijderToernooiSpelerNieuw, verwijderToernooiSpelerSelectie, voegBestaandeSpelerToeAanToernooi, voegDagToe, voegFlightToe, voegGastspelerToe, voegGastspelerToeAanToernooi, wijzigFlightHcp, wijzigFlightNaam, wijzigFlightStarthole, wijzigFlightStarttijd, zoekToernooiSpeler, zoekToernooiSpelerModal };
