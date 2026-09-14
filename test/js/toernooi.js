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
import { store, alleLadders, activeLadderId, alleSpelersData, huidigeBruiker, archiefData, toernooiData, alleToernooien, actieveToernooiId, _vasteListeners, _toernooiListeners, _tGeselecteerdeSpelers, _tRankingLadderIds, _flights, _flightPool, _liveScores } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen, foutTekst, meldFout } from './auth.js';
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
// v5.12.6: deze twee stonden hier, maar dezelfde tekst was op vijftien plekken
// in zes andere bestanden nodig. De regel staat nu in js/auth.js — het enige
// bestand dat ze allemaal al importeren. Dit blijven aliassen, zodat de 26
// aanroepen hieronder ongewijzigd blijven en er toch een bron is.
const toernooiFoutTekst = foutTekst;
const toernooiFout = meldFout;

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

  // v5.12.1: de melding "Geen actief toernooi" ALTIJD eerst weghalen.
  //
  // WAT ER MIS WAS. Dat blok wordt onderaan deze functie aan de toernooipagina
  // geplakt voor een speler zonder lopend toernooi — maar het werd alleen
  // opgeruimd in diezelfde tak, vlak voordat het opnieuw werd neergezet. Kwam
  // er daarna wél weer een toernooi, dan keek niemand meer naar dat blok.
  //
  // Gemeten met een browsertest op 13 september 2026: annuleert de coordinator
  // terwijl een speler is ingelogd, dan krijgt die speler de melding. Herstelt
  // de coordinator het toernooi, dan komt de scorekaart er wel bij, maar de
  // melding blijft eronder staan tot de speler de app opnieuw opent. Sierk:
  // "ik heb een geannuleerd toernooi opnieuw gestart maar een speler die inlogt
  // krijgt scherm, geen actief toernooi."
  document.getElementById('toernooi-leeg-melding')?.remove();

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
      // v5.22.0: de toestand erachter. Twee toernooien met dezelfde naam waren
      // op deze knoppen niet uit elkaar te houden — en die komen voor, zoals de
      // dubbele "Cie on tour 2026" op live liet zien.
      mijnToernooien.forEach(t => {
        const actief = t.id === actieveToernooiId;
        const staat = toernooiWacht(t) ? 'wacht' : 'bezig';
        html += `<button onclick="selecteerToernooi('${escAttr(t.id)}')" style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1.5px solid ${actief ? 'var(--green)' : 'var(--border)'};background:${actief ? 'var(--green)' : 'white'};color:${actief ? 'white' : 'var(--dark)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">${esc(t.naam)} <span style="opacity:.75;font-size:11px">· ${staat}</span></button>`;
      });
      html += '</div>';
    }
    wrap.innerHTML = html + '<div id="toernooi-detail"></div>';

    // ============================================================
    //  WELK TOERNOOI KRIJG JE TE ZIEN  (v5.22.0)
    // ------------------------------------------------------------
    //  ⚠ WAT ER MIS WAS, gemeten op live. Hier stond `mijnToernooien[0]` —
    //  het eerste uit een zoekopdracht ZONDER sorteervolgorde. Zolang er maar
    //  één toernooi kon bestaan was dat onschuldig. Sinds v5.21.0 kun je een
    //  volgend toernooi vooruit klaarzetten, en toen werd het willekeur: een
    //  speler die inlogde kreeg "Dag 1 is nog niet gestart" te zien terwijl het
    //  toernooi waar hij in meespeelt gewoon liep. Sierk: "een speler die
    //  inlogt krijgt bericht dat dag 1 nog niet is gestart terwijl dat wel zo
    //  is."
    //
    //  Nu: het toernooi dat LOOPT wint. Wacht er niets en loopt er niets, dan
    //  valt hij terug op de eerste — er moet iets op het scherm staan.
    if (!actieveToernooiId || !mijnToernooien.find(t => t.id === actieveToernooiId)) {
      const kies = mijnToernooien.find(toernooiLoopt) || mijnToernooien[0];
      store.actieveToernooiId = kies.id;
      store.toernooiData = kies;
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
      // v3.0.0-11.73: wachtmelding voor spelers zonder actief toernooi.
      // v5.12.1: het weghalen staat nu bovenaan deze functie, zodat het ook
      // gebeurt als er wél weer een toernooi is.
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

// v5.11.6: verdeelt de markerkring opnieuw over een flight. Nodig zodra de
// samenstelling verandert.
//
// ⚠ WAT ER MIS WAS. Een speler toevoegen of verwijderen raakte `markers` niet
// aan. De nieuwe speler had dan geen vermelding en viel terug op de kring,
// terwijl de anderen hun opgeslagen marker hielden: één speler markeerde er
// ineens twee en de nieuwe markeerde niemand. Niemand bleef zónder marker —
// dat vangnet werkt — maar "ieder markeert er één" klopte niet meer, en dat is
// juist de afspraak. Sierk vroeg ernaar voordat het in het echt misging.
//
// Afgesloten dagen blijven met rust: daar is de uitslag al vastgesteld, en de
// indeling achteraf omgooien zou die geschiedenis veranderen.
//
// Er is (nog) geen scherm om een marker met de hand om te zetten, dus de
// opgeslagen indeling bevat nooit iets wat de kring niet ook weet. Opnieuw
// verdelen kan dus niets wegvagen.
function herschikMarkers(toernooi) {
  (toernooi?.dagen || []).forEach(dag => {
    if (dag.afgerond) return;
    (dag.flights || []).forEach(f => { f.markers = markerKring(f.spelerIds || []); });
  });
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
          if (dagUitslag || dagModus(nieuweData, dag) === 'strokeplay') renderTRanglijst();
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
  window._tTabblad = null;    // v5.13.1: begin op de actieve dag, niet op het overzicht
  window._ranglijstDagNr = null;
  renderToernooi();
}

// ============================================================
//  CONCEPT-OPSLAG SETUP — v4.0.0 (fix 7.1)
// ============================================================
// Alles wat in het setup-formulier wordt ingesteld gaat als concept naar
// localStorage, zodat een refresh/crash tijdens het instellen niets kost.
const TOERNOOI_CONCEPT_KEY = 'toernooiConcept_v1';

// v5.13.0: de toernooibrede velden voor tijd, punten en handicap zijn van het
// aanmaakscherm verdwenen — ze staan nu per dag. Waar de code nog één waarde
// voor het hele toernooi nodig heeft (de standaard voor een dag die er later
// bij komt), geldt dag 1 als die standaard.
function setupDag1() {
  const blok = document.querySelector('#t-dag-blokken .dag-blok');
  return blok ? dagUitFormulier(blok) : null;
}

function slaToernooiConceptOp() {
  clearTimeout(window._tConceptSaveTimer);
  window._tConceptSaveTimer = setTimeout(() => {
    try {
      // v5.13.0: het hele dagformulier gaat mee in het concept, dus ook
      // starttijd, interval, punten en handicap. Voorheen stonden die vier
      // buiten de dagen en gingen ze bij een herlaad verloren zodra het aantal
      // dagen wijzigde.
      const dagen = Array.from(document.querySelectorAll('#t-dag-blokken .dag-blok')).map(b => {
        const d = dagUitFormulier(b);
        return { datum: d.datum, baan: d.baan, holes: d.holesKeuze,
                 holesCustom: d.holesKeuze === 'custom' ? String(d.holes) : '',
                 modus: d.modus, starttijd: d.starttijd, interval: d.interval,
                 ptWin: d.ptWin, ptTie: d.ptTie, ptLoss: d.ptLoss, hcpPct: d.hcpPctHeel,
                 plaatsPunten: d.plaatsPunten };
      });
      const concept = {
        naam:        document.getElementById('t-naam')?.value || '',
        aantalDagen: document.getElementById('t-aantal-dagen')?.value || '1',
        modus:       toernooiModusUitFormulier(),   // v5.12.1: afgeleid uit de dagen
        dagen,
        spelers:        store._tGeselecteerdeSpelers || [],
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
  store._flightPool = [];   // v5.19.0
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
    // v5.12.1: de speelwijze staat in de dagblokken, niet meer in een radio
    // hier. pasConceptDagenToe() zet ze terug; daarna beslist pasSpeelwijzeToe()
    // wat er zichtbaar is.

    store._tGeselecteerdeSpelers = c.spelers || [];
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
    const modusEl = blok.querySelector('.t-dag-modus');            // v5.12.0
    if (modusEl && c.modus) modusEl.value = c.modus;
    // v5.13.0: tijd, punten en handicap staan nu ook per dag in het concept.
    const zetVeld = (klasse, waarde) => {
      if (waarde === undefined || waarde === null || waarde === '') return;
      const el = blok.querySelector('.t-dag-' + klasse);
      if (el) el.value = waarde;
    };
    zetVeld('starttijd', c.starttijd); zetVeld('interval', c.interval);
    zetVeld('ptwin', c.ptWin); zetVeld('pttie', c.ptTie);
    zetVeld('ptloss', c.ptLoss); zetVeld('hcppct', c.hcpPct);
    zetVeld('plaatspunten', c.plaatsPunten);   // v5.15.0
    if (modusEl) onDagModusWissel(modusEl);
    if (holesEl) onDagHolesWissel(holesEl);
  });
  pasSpeelwijzeToe();   // v5.12.1
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
  pasSpeelwijzeToe();       // v5.12.1

  // v5.12.8: het blok "Spelers ladder(s)" stond hier. Weg — de spelerslijst is
  // nu iedereen uit de app; zie getToernooiSpelersPool().
  //
  // De ranking-ladder is een keuzelijst geworden in plaats van een rij vakjes.
  // Sierk: "ranking ladder sowieso slechts 1 keuze". Intern blijft het een
  // verzameling met nul of één ladder, zodat het opslaan, "Toernooi opnieuw
  // instellen" en het afsluiten ongewijzigd blijven werken.
  const rankingLaddersEl = document.getElementById('t-ranking-ladders');
  if (rankingLaddersEl) {
    const gekozen = [..._tRankingLadderIds][0] || '';
    rankingLaddersEl.innerHTML = `
      <select class="input" onchange="kiesTRankingLadder(this.value)" style="width:100%">
        <option value=""${gekozen ? '' : ' selected'}>Geen — telt niet voor een ladder</option>
        ${alleLadders.map(l => `
          <option value="${escAttr(l.id)}"${l.id === gekozen ? ' selected' : ''}>${esc(l.naam)}</option>
        `).join('')}
      </select>`;
  }

  renderTGeselecteerdeSpelers();
}

// Rendert één dag-configuratie blok per dag
// ============================================================
//  HET DAGFORMULIER — ÉÉN BRON  (v5.13.0)
// ============================================================
//  Sierk, 13 september 2026: "Dat A4tje was beeldspraak om alles op een blad te
//  hebben en niet verspreid over de hele app. Single source."
//
//  WAT ER MIS WAS. Een dag werd op TWEE plekken ingesteld en die waren niet
//  gelijk. Het aanmaakscherm kende Datum, Baan, Aantal holes en Speelwijze; het
//  venster "Dag toevoegen / Dag wijzigen" kende diezelfde vier PLUS Starttijd en
//  Interval. Gevolg: bij het aanmaken van een meerdaags toernooi kreeg elke dag
//  dezelfde starttijd, en dat was daar niet te corrigeren.
//
//  Vanaf nu bouwt dagFormulierHtml() het formulier en leest dagUitFormulier()
//  het terug — op BEIDE plekken. Komt er een veld bij, dan staat het meteen
//  overal.
//
//  ⚠ WAAROM ER ID'S ÉN KLASSEN UITKOMEN. Het aanmaakscherm leest de velden op
//  KLASSE (startToernooi() doet `querySelectorAll('.dag-blok')` en zoekt daarin
//  `.t-dag-datum`), het venster leest ze op ID (`getElementById('t-dag-datum')`).
//  De browsertests hangen aan allebei. Eén element mag beide dragen, dus geeft
//  deze functie in het venster id én klasse uit. Zo hoefde er geen enkele
//  bestaande aanroep of test te wijzigen.
//
//  ⚠ Het venster mag maar ÉÉN keer tegelijk open staan, anders zouden er twee
//  elementen met hetzelfde id zijn. Dat is nu ook al zo.
function dagFormulierHtml(w, opt) {
  w = w || {}; opt = opt || {};
  const metIds  = opt.metIds === true;
  const dagNr   = opt.dagNr || 1;
  const banen   = alleBANEN();
  const baanOpties = Object.keys(banen)
    .filter(n => n !== 'Handmatig invoeren')
    .map(n => `<option value="${escAttr(n)}"${n === w.baan ? ' selected' : ''}>${esc(n)}</option>`)
    .join('');
  // id="" is ongeldig; laat het attribuut dan helemaal weg.
  const idv = (naam) => metIds ? ` id="t-dag-${naam}"` : '';
  const holes   = w.holes || '18';
  const modus   = w.modus === 'strokeplay' ? 'strokeplay' : 'matchplay';
  const toonCust = holes === 'custom' ? '' : 'display:none';
  const toonPunten = modus === 'matchplay' ? '' : 'display:none';

  return `
    <div class="form-group" style="margin-bottom:10px">
      <label>Datum</label>
      <input type="date"${idv('datum')} class="t-dag-datum" value="${escAttr(w.datum || '')}">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label>Baan</label>
      <select${idv('baan')} class="t-dag-baan"${opt.metNieuweBaan ? ` onchange="onTDagBaanSelect(this, ${dagNr})"` : ''}>
        ${baanOpties}
        ${opt.metNieuweBaan ? '<option value="Handmatig invoeren">+ Nieuwe baan toevoegen</option>' : ''}
      </select>
      ${opt.metNieuweBaan ? `
      <div id="t-baan-handmatig-${dagNr}" style="display:none;margin-top:10px">
        <div id="t-holes-handmatig-${dagNr}"></div>
      </div>` : ''}
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label>Aantal holes</label>
      <select${idv('holes')} class="t-dag-holes" onchange="onDagHolesWissel(this)">
        <option value="18"${holes === '18' ? ' selected' : ''}>18 holes</option>
        <option value="9"${holes === '9' ? ' selected' : ''}>9 holes</option>
        <option value="custom"${holes === 'custom' ? ' selected' : ''}>Aangepast...</option>
      </select>
      <div${idv('holes-custom-wrap')} class="t-dag-holes-custom-wrap" style="${toonCust};margin-top:6px">
        <input type="number"${idv('holes-custom')} class="t-dag-holes-custom" min="1" max="18"
          placeholder="bijv. 12" style="text-align:center;width:80px" value="${escAttr(w.holesCustom || '')}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label>Speelwijze</label>
      <select${idv('modus')} class="t-dag-modus" onchange="onDagModusWissel(this)">
        <option value="matchplay"${modus === 'matchplay' ? ' selected' : ''}>Matchplay</option>
        <option value="strokeplay"${modus === 'strokeplay' ? ' selected' : ''}>Strokeplay</option>
      </select>
      <p style="font-size:11px;color:var(--light);margin:4px 0 0">
        ⚠ Zit er een strokeplay-dag in het toernooi, dan telt het niet mee voor de ladder.
      </p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group" style="margin-bottom:10px">
        <label>Starttijd</label>
        <input type="time"${idv('starttijd')} class="t-dag-starttijd" value="${escAttr(w.starttijd || '09:00')}">
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Interval (min)</label>
        <input type="number"${idv('interval')} class="t-dag-interval" min="0" max="60"
          style="text-align:center" value="${escAttr(w.interval ?? 10)}">
      </div>
    </div>
    <div class="t-dag-strokeplay-blok" style="${modus === 'strokeplay' ? '' : 'display:none'}">
      <div class="form-group" style="margin-bottom:0">
        <label>Punten per plaats <span style="font-weight:400;color:var(--light)">(leeg = zoals nu)</span></label>
        <input type="text"${idv('plaatspunten')} class="t-dag-plaatspunten"
          placeholder="bijv. 10, 7, 5, 3, 1" value="${escAttr(w.plaatsPunten || '')}"
          oninput="toonPlaatsPuntenVoorbeeld(this)">
        <p class="t-dag-plaatspunten-voorbeeld" style="font-size:11px;color:var(--light);margin:4px 0 0"></p>
      </div>
    </div>
    <div class="t-dag-matchplay-blok" style="${toonPunten}">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="form-group" style="margin-bottom:10px">
          <label>Winst</label>
          <input type="number"${idv('ptwin')} class="t-dag-ptwin" style="text-align:center" value="${escAttr(w.ptWin ?? 2)}">
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Gelijk</label>
          <input type="number"${idv('pttie')} class="t-dag-pttie" style="text-align:center" value="${escAttr(w.ptTie ?? 0)}">
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Verlies</label>
          <input type="number"${idv('ptloss')} class="t-dag-ptloss" style="text-align:center" value="${escAttr(w.ptLoss ?? -2)}">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>HCP verrekening %</label>
        <input type="number"${idv('hcppct')} class="t-dag-hcppct" min="0" max="100"
          style="width:90px" value="${escAttr(w.hcpPct ?? 75)}">
      </div>
    </div>`;
}

// Leest hetzelfde formulier weer uit. `root` is het omhullende element:
// het dagblok op het aanmaakscherm, of het venster.
//  ⚠ Percentages komen hier als HELE getallen uit (75), net als op het scherm.
//  De omrekening naar 0.75 gebeurt bij het opslaan, op één plek.
function dagUitFormulier(root) {
  if (!root) return null;
  const v = (k) => root.querySelector('.t-dag-' + k);
  const getal = (k, standaard) => {
    const el = v(k); const n = parseFloat(el?.value);
    return Number.isFinite(n) ? n : standaard;
  };
  const holesKeuze = v('holes')?.value || '18';
  return {
    datum:      v('datum')?.value || '',
    baan:       v('baan')?.value || '',
    holesKeuze,
    holes:      holesKeuze === 'custom' ? getal('holes-custom', 18) : parseInt(holesKeuze, 10),
    modus:      v('modus')?.value === 'strokeplay' ? 'strokeplay' : 'matchplay',
    starttijd:  v('starttijd')?.value || '09:00',
    interval:   getal('interval', 10),
    ptWin:      getal('ptwin', 2),
    ptTie:      getal('pttie', 0),
    ptLoss:     getal('ptloss', -2),
    hcpPctHeel: getal('hcppct', 75),
    plaatsPunten: v('plaatspunten')?.value?.trim() || '',   // v5.15.0, leeg = standaard
  };
}

// Aangepast aantal holes tonen of verbergen — werkt in beide schermen doordat
// hij het omhullende formulier opzoekt in plaats van een vast id.
function onDagHolesWissel(el) {
  const root = el.closest('.dag-formulier') || el.closest('.dag-blok') || document;
  const wrap = root.querySelector('.t-dag-holes-custom-wrap');
  if (wrap) wrap.style.display = el.value === 'custom' ? 'block' : 'none';
}
window.onDagHolesWissel = onDagHolesWissel;

// De puntenvelden horen alleen bij matchplay.
// v5.15.0: laat onder het veld zien wat de ingetikte rij betekent. Zonder dit
// is "wat gebeurt er met plek 6?" niet te zien, en dat is precies de regel die
// een coordinator moet kennen: voorbij de tabel levert een plek 0 op.
function toonPlaatsPuntenVoorbeeld(el) {
  const root = el.closest('.dag-formulier') || el.closest('.dag-blok') || document;
  const uit  = root.querySelector('.t-dag-plaatspunten-voorbeeld');
  if (!uit) return;
  const tabel = plaatsPuntenUitTekst(el.value);
  if (!tabel) { uit.textContent = 'Leeg: de hoogste plek krijgt evenveel punten als er spelers zijn, daarna aflopend.'; return; }
  uit.textContent = tabel.map((p, i) => `Plek ${i + 1} → ${p}`).join(' · ')
    + ` · plek ${tabel.length + 1} en verder → 0`;
}
window.toonPlaatsPuntenVoorbeeld = toonPlaatsPuntenVoorbeeld;

function onDagModusWissel(el) {
  const root = el.closest('.dag-formulier') || el.closest('.dag-blok') || document;
  const blok = root.querySelector('.t-dag-matchplay-blok');
  if (blok) blok.style.display = el.value === 'strokeplay' ? 'none' : '';
  // v5.15.0: en omgekeerd voor het strokeplay-blok met de puntentabel.
  const sBlok = root.querySelector('.t-dag-strokeplay-blok');
  if (sBlok) sBlok.style.display = el.value === 'strokeplay' ? '' : 'none';
  const ppVeld = root.querySelector('.t-dag-plaatspunten');
  if (ppVeld) toonPlaatsPuntenVoorbeeld(ppVeld);
  // Op het aanmaakscherm hangt er meer aan de speelwijze (de ranking-ladder).
  if (document.getElementById('t-dag-blokken')?.contains(el)) pasSpeelwijzeToe();
}
window.onDagModusWissel = onDagModusWissel;

function renderDagBlokken() {
  const aantalDagen = parseInt(document.getElementById('t-aantal-dagen')?.value) || 1;
  const container   = document.getElementById('t-dag-blokken');
  if (!container) return;

  // Bewaar wat er staat, zodat een dag erbij of eraf de invoer niet wist.
  // v5.13.0: dit liep achter — starttijd, interval en de punten stonden er niet
  // in, dus die zouden bij elke wijziging van het aantal dagen wegvallen.
  const bestaand = Array.from(container.querySelectorAll('.dag-blok'))
    .map(blok => dagUitFormulier(blok));

  // Een nieuwe dag volgt dag 1 (v5.12.1); is die er nog niet, dan matchplay.
  const dag1 = bestaand[0] || {};

  // v5.21.0: hier werd een EIGEN rij dagtabbladen gebouwd, halverwege de pagina.
  // Die rij is opgegaan in de ene rij bovenaan het aanmaakscherm — dezelfde rij
  // die een opgeslagen toernooi heeft. Zie renderSetupTabs(). Deze functie
  // tekent nu alleen nog de dagblokken zelf.
  let html = '';
  for (let d = 1; d <= aantalDagen; d++) {
    const prev = bestaand[d - 1] || {};
    const actief = d === (window._tSetupDagNr || 1);

    const w = {
      datum:  prev.datum || '',
      baan:   prev.baan  || (d > 1 ? (dag1.baan || '') : ''),
      holes:  prev.holesKeuze || (d > 1 ? (dag1.holesKeuze || '18') : '18'),
      holesCustom: prev.holesKeuze === 'custom' ? prev.holes : '',
      modus:  prev.modus || dag1.modus || 'matchplay',
      // v5.13.0: een volgende dag neemt tijd en punten van de vorige over als
      // voorzet. Dat scheelt overtypen en houdt een toernooi meestal consistent.
      starttijd: prev.starttijd ?? (d > 1 ? (bestaand[d - 2]?.starttijd ?? '09:00') : '09:00'),
      interval:  prev.interval  ?? (d > 1 ? (bestaand[d - 2]?.interval  ?? 10) : 10),
      ptWin:     prev.ptWin     ?? dag1.ptWin  ?? 2,
      ptTie:     prev.ptTie     ?? dag1.ptTie  ?? 0,
      ptLoss:    prev.ptLoss    ?? dag1.ptLoss ?? -2,
      hcpPct:    prev.hcpPctHeel ?? dag1.hcpPctHeel ?? 75,
    };

    html += `
    <div class="dag-blok dag-formulier" data-dagnr="${d}"
         style="${actief ? '' : 'display:none;'}border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
      ${dagFormulierHtml(w, { dagNr: d, metNieuweBaan: true })}
    </div>`;
  }
  container.innerHTML = html;
  renderSetupTabs();

  // Baan-selectie herstellen: De Goyer op dag 1, en volgende dagen volgen dag 1.
  container.querySelectorAll('.dag-blok').forEach((blok, i) => {
    const sel = blok.querySelector('.t-dag-baan');
    if (!sel) return;
    const gewenst = bestaand[i]?.baan
      || (i === 0 ? 'De Goyer' : (container.querySelector('.dag-blok .t-dag-baan')?.value || ''));
    if (gewenst && [...sel.options].some(o => o.value === gewenst)) sel.value = gewenst;
  });

  pasSpeelwijzeToe();
}

// v5.13.0: welk dagtabblad staat open. Alle dagblokken blijven in het scherm
// staan en worden alleen verborgen — zo blijft startToernooi() ze onveranderd
// uitlezen met querySelectorAll('.dag-blok') en hoefde daar niets aan.
function selecteerSetupDag(dagNr) {
  window._tSetupDagNr = dagNr;
  window._tSetupTab = dagNr;          // v5.21.0
  renderDagBlokken();
}
window.selecteerSetupDag = selecteerSetupDag;

// ============================================================
//  ÉÉN RIJ TABBLADEN OP HET AANMAAKSCHERM  (v5.21.0)
// ------------------------------------------------------------
//  [Toernooi] [Spelers] [Dag 1] [Dag 2] [+ Dag toevoegen]
//
//  Precies de rij die een opgeslagen toernooi heeft. Sierk, 14 september 2026:
//  "als ik op nieuw toernooi aanmaken klik dan wil ik daar toernooi/spelers/
//  dagen tabs. het volledige toernooi kunnen aanmaken."
//
//  ⚠ De dagblokken blijven ALLEMAAL in het scherm staan en worden alleen
//  verborgen — startToernooi() leest ze uit met querySelectorAll('.dag-blok').
//  Een blok echt weghalen zou die uitlezing stukmaken.
function selecteerSetupTab(tab) {
  window._tSetupTab = tab;
  if (typeof tab === 'number') window._tSetupDagNr = tab;
  renderDagBlokken();
}
window.selecteerSetupTab = selecteerSetupTab;

function renderSetupTabs() {
  const rij = document.getElementById('t-setup-tabs');
  if (!rij) return;
  const aantalDagen = parseInt(document.getElementById('t-aantal-dagen')?.value) || 1;
  const huidig = window._tSetupTab ?? 'toernooi';
  const dagNr = window._tSetupDagNr || 1;

  const knop = (actief, klik, label, stippel) => `<button type="button" onclick="${klik}"
      style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px ${stippel ? 'dashed' : 'solid'} ${actief ? 'var(--green)' : 'var(--border)'};border-bottom:none;background:${actief ? 'var(--green)' : 'transparent'};color:${actief ? 'white' : (stippel ? 'var(--green)' : 'var(--mid)')};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">${label}</button>`;

  let html = `<div style="display:flex;gap:6px;overflow-x:auto;padding:0;scrollbar-width:none;border-bottom:1px solid var(--border);margin-bottom:12px">`;
  html += knop(huidig === 'toernooi', "selecteerSetupTab('toernooi')", 'Toernooi');
  html += knop(huidig === 'spelers', "selecteerSetupTab('spelers')", 'Spelers');
  for (let d = 1; d <= aantalDagen; d++) {
    const actief = huidig === d;
    // Het ✕ staat alleen op de dag die je bekijkt, en alleen als er meer dan
    // één dag is — anders houd je geen toernooi over.
    const label = `Dag ${d}${aantalDagen > 1 && actief ? ` <span onclick="event.stopPropagation();verwijderSetupDag(${d})" title="Deze dag weghalen" style="margin-left:4px;opacity:.8">&#10005;</span>` : ''}`;
    html += knop(actief, `selecteerSetupDag(${d})`, label);
  }
  html += knop(false, 'voegSetupDagToe()', '+ Dag toevoegen', true);
  html += '</div>';
  rij.innerHTML = html;

  const toon = (id, aan) => {
    const el = document.getElementById(id);
    if (el) el.style.display = aan ? '' : 'none';
  };
  toon('t-setup-paneel-toernooi', huidig === 'toernooi');
  toon('t-setup-paneel-spelers',  huidig === 'spelers');
  toon('t-setup-paneel-dagen',    typeof huidig === 'number');
}
window.renderSetupTabs = renderSetupTabs;

function voegSetupDagToe() {
  const el = document.getElementById('t-aantal-dagen');
  if (!el) return;
  const nu = parseInt(el.value) || 1;
  if (nu >= 10) { toast('Meer dan tien dagen is niet mogelijk'); return; }
  el.value = nu + 1;
  window._tSetupDagNr = nu + 1;
  window._tSetupTab = nu + 1;   // v5.21.0: spring meteen naar de nieuwe dag
  renderDagBlokken();
}
window.voegSetupDagToe = voegSetupDagToe;

function verwijderSetupDag(dagNr) {
  const el = document.getElementById('t-aantal-dagen');
  if (!el) return;
  const nu = parseInt(el.value) || 1;
  if (nu <= 1) { toast('Een toernooi heeft minstens één dag'); return; }
  if (!confirm(`Dag ${dagNr} weghalen uit dit toernooi?`)) return;
  // De blokken worden opnieuw opgebouwd uit wat er staat; haal deze eruit.
  const blok = document.querySelector(`#t-dag-blokken .dag-blok[data-dagnr="${dagNr}"]`);
  if (blok) blok.remove();
  el.value = nu - 1;
  window._tSetupDagNr = Math.min(dagNr, nu - 1);
  window._tSetupTab = window._tSetupDagNr;   // v5.21.0
  renderDagBlokken();
}
window.verwijderSetupDag = verwijderSetupDag;

window.renderDagBlokken = renderDagBlokken;

// v5.12.8: toggleTSpelersLadder() is vervallen met het blok "Spelers
// ladder(s)". Hij snoeide ook de al gekozen spelers weg die niet in de
// aangevinkte ladder zaten; dat hoeft niet meer, want er wordt niet meer
// voorgefilterd.
//
// toggleTRankingLadder(id, checked) is kiesTRankingLadder(id) geworden: één
// keuze in plaats van vakjes. Een lege waarde betekent "telt niet voor een
// ladder" — precies wat er vóór v5.12.8 gebeurde als je niets aanvinkte.
function kiesTRankingLadder(ladderId) {
  store._tRankingLadderIds = new Set(ladderId ? [ladderId] : []);
}

// ============================================================
//  WIE KUN JE IN EEN TOERNOOI ZETTEN?  (v5.12.8)
// ============================================================
//  Alle vaste spelers uit de app, behalve de gastaccounts van toernooien.
//
//  WAT ER WAS. Hierboven stond het blok "Spelers ladder(s)": een rij vakjes
//  waarmee je de lijst kon voorfilteren op een of meer ladders. Sierk,
//  13 september 2026: "het kiezen van meerdere ladders komt nooit voor" en
//  "kan weg en standaard kan je alle spelers die in de goyer-ladder app zitten
//  selecteren". Dat blok is weg; je zoekt spelers op naam in het zoekveld.
//
//  ⚠ EEN VASTE SPELER ZONDER LADDER STAAT ER NU OOK IN. Dat kon eerder niet:
//  het ladderfilter bouwde de lijst uit `spelerIds` van de ladders, dus wie in
//  geen enkele ladder zat viel buiten de boot. Dat is nu met opzet anders.
//
//  ⚠ EN DAAROM MOETEN DE GASTEN ER EXPLICIET UIT. Datzelfde ladderfilter hield
//  ze toevallig buiten de deur — een toernooigast zit in geen enkele ladder.
//  Zonder de controle hieronder zou elke gast van elk vorig toernooi in de
//  lijst opduiken, inclusief de genummerde (`sierk2`). Het veld komt uit
//  spelersDocNaarUserFormaat() in js/auth.js.
function getToernooiSpelersPool() {
  const gezien = new Set();
  const spelers = [];
  alleSpelersData.forEach(s => {
    if (!s.uid || gezien.has(s.uid)) return;
    if (s.toernooiGast === true) return;
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
  if (!_dubbeleGastnaamOk(naam.trim(),
        (store._tGeselecteerdeSpelers || []).map(sp => sp.naam))) return;   // v5.11.7
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
// v5.13.0: toggleDagHolesCustom() stond hier als tegenhanger van een inline
// regel op het aanmaakscherm — twee keer dezelfde handeling. Beide zijn
// vervangen door onDagHolesWissel(), dat bij het gedeelde dagformulier hoort en
// het omhullende blok opzoekt in plaats van een vast id.

// Leest het aantal holes uit het dagvenster. Geeft null als de coordinator
// "Aangepast" koos maar geen bruikbaar getal invulde — dan hoort het opslaan te
// stoppen met een melding, niet stilletjes 18 te pakken.
function dagHolesUitVenster() {
  const keuze = document.getElementById('t-dag-holes')?.value || '18';
  if (keuze !== 'custom') return parseInt(keuze) || 18;
  const ruw = document.getElementById('t-dag-holes-custom')?.value;
  const n = parseInt(ruw);
  return (Number.isFinite(n) && n >= 1 && n <= 18) ? n : null;
}

function toggleHolesCustom() {
  const sel = document.getElementById('t-holes');
  const wrap = document.getElementById('t-holes-custom-wrap');
  if (wrap) wrap.style.display = sel.value === 'custom' ? 'block' : 'none';
}

function openFlightIndeling() {
  const geselecteerd = _tGeselecteerdeSpelers;
  if (geselecteerd.length < 2) { toast('Selecteer minimaal 2 spelers'); return; }

  // v5.13.0: de flightindeling op het aanmaakscherm gaat over dag 1.
  const _d1 = setupDag1();
  const starttijd = _d1?.starttijd || '09:00';
  const interval  = _d1?.interval ?? 0;

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
  // v5.19.0: op het AANMAAKSCHERM bestaat de pool niet — daar staat iedereen
  // die je selecteert meteen in een flight. Wel leegmaken, anders blijft er een
  // pool van een vorig toernooi staan.
  store._flightPool = [];

  const startBtn = document.getElementById('flight-modal-start-btn');
  if (startBtn) { startBtn.textContent = 'Toernooi opslaan →'; startBtn.onclick = startToernooi; }

  renderFlightLijst();
  document.getElementById('modal-flight-indeling').classList.add('open');
}

// v5.9.0: verdeelt alle ingedeelde spelers gelijkmatig over de bestaande
// flights. Voorheen kwam een nieuwe flight leeg binnen en moest elke speler
// met de hand worden verplaatst — bij negen spelers over vier flights is dat
// negen keuzemenu's, en wie flight 1 helemaal leegmaakt houdt een lege flight
// over die de app gewoon opsloeg. Zie de toelichting in CLAUDE.md.
// ============================================================
//  VIJF MANIEREN OM IN TE DELEN  (v5.16.0)
// ============================================================
//  Tot v5.15.0 deed de knop één ding: de spelers om de beurt over de flights,
//  in de volgorde waarin ze toevallig stonden. Sierk, 14 september 2026 vroeg om
//  vier manieren erbij.
//
//  ⚠ Het zijn met opzet PURE functies: spelerslijst en aantal flights erin, een
//  indeling eruit. Geen scherm, geen database. Daardoor zijn ze volledig te
//  testen, en dat is nodig — een verkeerde indeling merk je pas op de baan.
//
//  Alle vijf verdelen zo gelijk mogelijk: flights schelen hooguit één speler en
//  iedereen komt precies één keer voor. Dat is per manier getest.

// Hoeveel spelers krijgt elke flight? De eerste flights krijgen er één extra
// als het niet gelijk opgaat.
function flightGroottes(aantalSpelers, aantalFlights) {
  if (aantalFlights <= 0) return [];
  const basis = Math.floor(aantalSpelers / aantalFlights);
  const rest  = aantalSpelers % aantalFlights;
  return Array.from({ length: aantalFlights }, (_, i) => basis + (i < rest ? 1 : 0));
}

// Knipt een gesorteerde lijst in opeenvolgende blokken — "banden".
function knipInBanden(lijst, aantalFlights) {
  const groottes = flightGroottes(lijst.length, aantalFlights);
  const uit = []; let k = 0;
  groottes.forEach(g => { uit.push(lijst.slice(k, k + g)); k += g; });
  return uit;
}

// 1. OM DE BEURT — wat de knop altijd al deed. Blijft de standaard.
function verdeelOmBeurten(spelers, aantalFlights) {
  const uit = Array.from({ length: aantalFlights }, () => []);
  (spelers || []).forEach((sp, i) => uit[i % aantalFlights].push(sp));
  return uit;
}

// 2. WILLEKEURIG — ook de terugval voor de twee manieren die op dag 1 geen
//    gegevens hebben. `rnd` is injecteerbaar zodat een test hem kan vastzetten.
function verdeelWillekeurig(spelers, aantalFlights, rnd) {
  const kans = typeof rnd === 'function' ? rnd : Math.random;
  const lijst = [...(spelers || [])];
  for (let i = lijst.length - 1; i > 0; i--) {
    const j = Math.floor(kans() * (i + 1));
    [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
  }
  return verdeelOmBeurten(lijst, aantalFlights);
}

// 3. OP PLEK, BESTE LAATST — `volgorde` is een lijst uid's van BEST naar
//    slechtst. De besten komen in de LAATSTE flight, die het laatst weggaat.
//    Sierk, 14 september 2026: "Altijd toernooi, eerste dag random indelen" —
//    die keuze zit in de aanroeper, niet hier.
function verdeelOpStand(spelers, aantalFlights, volgorde) {
  const rang = new Map((volgorde || []).map((uid, i) => [uid, i]));
  // Wie niet in de stand voorkomt (een gast, een nieuwe speler) telt als
  // slechtste en start dus vooraan. Stabiel bij gelijke rang.
  const gesorteerd = [...(spelers || [])]
    .map((sp, i) => ({ sp, i, r: rang.has(sp.uid) ? rang.get(sp.uid) : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (b.r - a.r) || (a.i - b.i))
    .map(x => x.sp);
  return knipInBanden(gesorteerd, aantalFlights);
}

// 4. OP INDIVIDUELE HANDICAP — laagste handicaps bij elkaar, in banden.
function verdeelOpHandicapBanden(spelers, aantalFlights) {
  const gesorteerd = [...(spelers || [])]
    .map((sp, i) => ({ sp, i, h: Number(sp?.hcp) }))
    .sort((a, b) => {
      const ah = Number.isFinite(a.h) ? a.h : Number.MAX_SAFE_INTEGER;
      const bh = Number.isFinite(b.h) ? b.h : Number.MAX_SAFE_INTEGER;
      return (ah - bh) || (a.i - b.i);
    })
    .map(x => x.sp);
  return knipInBanden(gesorteerd, aantalFlights);
}

// 5. OP FLIGHT HANDICAP — juist spreiden, zodat elke flight ongeveer even sterk
//    is. Slangsgewijs: 1-2-3-4, dan 4-3-2-1, enzovoort.
function verdeelOpFlightHandicap(spelers, aantalFlights) {
  const gesorteerd = [...(spelers || [])]
    .map((sp, i) => ({ sp, i, h: Number(sp?.hcp) }))
    .sort((a, b) => {
      const ah = Number.isFinite(a.h) ? a.h : Number.MAX_SAFE_INTEGER;
      const bh = Number.isFinite(b.h) ? b.h : Number.MAX_SAFE_INTEGER;
      return (ah - bh) || (a.i - b.i);
    })
    .map(x => x.sp);
  const uit = Array.from({ length: aantalFlights }, () => []);
  const groottes = flightGroottes(gesorteerd.length, aantalFlights);
  let idx = 0, heen = true;
  while (idx < gesorteerd.length) {
    const volgorde = heen
      ? [...Array(aantalFlights).keys()]
      : [...Array(aantalFlights).keys()].reverse();
    let gezet = false;
    for (const f of volgorde) {
      if (idx >= gesorteerd.length) break;
      if (uit[f].length >= groottes[f]) continue;
      uit[f].push(gesorteerd[idx++]); gezet = true;
    }
    if (!gezet) break;   // alles vol — kan niet, maar nooit oneindig draaien
    heen = !heen;
  }
  return uit;
}

// 6. NOG NIET MET ELKAAR GESPEELD — zoveel mogelijk nieuwe tegenstanders.
//    `eerdereFlights` is een lijst indelingen van eerdere dagen, elk een lijst
//    flights met uid's.
//
//    ⚠ Dit kan niet toveren. Bij weinig flights en veel dagen is een herhaling
//    onvermijdelijk; dan kiest hij de indeling met de minste herhalingen. De
//    test legt dat verschil ook vast.
function verdeelNieuweTegenstanders(spelers, aantalFlights, eerdereFlights) {
  const lijst = [...(spelers || [])];
  if (lijst.length === 0 || aantalFlights <= 0) {
    return Array.from({ length: Math.max(0, aantalFlights) }, () => []);
  }
  // Hoe vaak zat dit paar al samen?
  const samen = new Map();
  const sleutel = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  (eerdereFlights || []).forEach(dag => {
    (dag || []).forEach(flight => {
      const ids = (flight || []).filter(Boolean);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const k = sleutel(ids[i], ids[j]);
          samen.set(k, (samen.get(k) || 0) + 1);
        }
      }
    });
  });

  const groottes = flightGroottes(lijst.length, aantalFlights);
  const uit = Array.from({ length: aantalFlights }, () => []);
  // Wie het meest "vastzit" (de meeste eerdere ontmoetingen) eerst plaatsen:
  // die heeft de minste ruimte en moet de eerste keus hebben.
  const drukte = (sp) => lijst.reduce((n, ander) =>
    ander === sp ? n : n + (samen.get(sleutel(sp.uid, ander.uid)) || 0), 0);
  const volgorde = lijst
    .map((sp, i) => ({ sp, i, d: drukte(sp) }))
    .sort((a, b) => (b.d - a.d) || (a.i - b.i))
    .map(x => x.sp);

  volgorde.forEach(sp => {
    let besteF = -1, besteScore = Infinity;
    for (let f = 0; f < aantalFlights; f++) {
      if (uit[f].length >= groottes[f]) continue;
      const botsingen = uit[f].reduce((n, ander) =>
        n + (samen.get(sleutel(sp.uid, ander.uid)) || 0), 0);
      // Bij gelijke botsingen: de leegste flight, daarna de laagste index.
      // Zo is de uitkomst voorspelbaar en dus te testen.
      const score = botsingen * 1000 + uit[f].length;
      if (score < besteScore) { besteScore = score; besteF = f; }
    }
    if (besteF < 0) besteF = uit.findIndex((f, i) => f.length < groottes[i]);
    if (besteF < 0) besteF = 0;
    uit[besteF].push(sp);
  });
  return uit;
}

function verdeelSpelersOverFlights(soort) {
  // v5.19.0: de pool telt mee en loopt hiermee leeg. Dat is de knop voor een
  // geplakte lijst van veertig gasten: die staan allemaal in de pool en zijn in
  // één klap verdeeld.
  const alle = [..._flights.flatMap(f => f.spelers), ..._flightPool];
  if (alle.length === 0 || _flights.length === 0) return;
  store._flightPool = [];
  const keuze = soort || document.getElementById('t-verdeel-soort')?.value || 'beurt';
  const n = _flights.length;
  let indeling, melding = '';

  if (keuze === 'stand') {
    const volgorde = _standVolgordeVoorIndeling();
    if (volgorde && volgorde.length > 0) {
      indeling = verdeelOpStand(alle, n, volgorde);
      melding = 'Ingedeeld op de toernooistand — de besten starten als laatste';
    } else {
      // Sierk: "eerste dag random indelen".
      indeling = verdeelWillekeurig(alle, n);
      melding = 'Nog geen toernooistand — willekeurig ingedeeld';
    }
  } else if (keuze === 'nieuw') {
    const eerder = _eerdereIndelingen();
    indeling = eerder.length > 0
      ? verdeelNieuweTegenstanders(alle, n, eerder)
      : verdeelWillekeurig(alle, n);
    melding = eerder.length > 0
      ? 'Ingedeeld op zo min mogelijk herhaalde tegenstanders'
      : 'Nog geen eerdere dagen — willekeurig ingedeeld';
  } else if (keuze === 'hcp') {
    indeling = verdeelOpHandicapBanden(alle, n);
    melding = 'Ingedeeld op handicap — gelijke spelers bij elkaar';
  } else if (keuze === 'flighthcp') {
    indeling = verdeelOpFlightHandicap(alle, n);
    melding = 'Ingedeeld zodat elke flight ongeveer even sterk is';
  } else {
    indeling = verdeelOmBeurten(alle, n);
    melding = 'Gelijk verdeeld over de flights';
  }

  _flights.forEach((f, i) => { f.spelers = indeling[i] || []; });
  renderFlightLijst();
  if (melding) toast(melding, 4000);
}

// De toernooistand tot nu toe, van best naar slechtst. Leeg als er nog geen
// toernooi of nog geen gespeelde dag is — dan deelt de aanroeper willekeurig in.
function _standVolgordeVoorIndeling() {
  const t = toernooiData;
  if (!t || !(t.dagen || []).length) return [];
  const heeftGespeeld = (t.dagen || []).some(d => dagHeeftScores(d));
  if (!heeftGespeeld) return [];
  const { totaal } = dagPuntenTotaal(t);
  return (t.spelers || [])
    .map((sp, i) => ({ uid: sp.uid, p: totaal[i] ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .map(x => x.uid);
}

// De flightindelingen van de dagen die al gespeeld zijn.
function _eerdereIndelingen() {
  const t = toernooiData;
  if (!t) return [];
  return (t.dagen || [])
    .filter(d => dagHeeftScores(d))
    .map(d => (d.flights || []).map(f => [...(f.spelerIds || [])]));
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

  // ============================================================
  //  DE SPELERSPOOL  (v5.19.0)
  // ------------------------------------------------------------
  //  Sierk, 14 september 2026: "ik wil op de dag zelf een spelers pool zien.
  //  met de knop verdelen of handmatig bepaal ik waar de spelers geplaatst
  //  worden. en ik zie dan zelf of de pool op een gegeven moment leeg is."
  //
  //  In de pool staat wie meedoet maar nog in geen enkele flight staat. Dat
  //  gebeurt sinds v5.19.0 bij iedereen die je op het tabblad Spelers toevoegt:
  //  daar kies je geen flight meer, want indelen hoort bij de dag.
  //
  //  ⚠ Daarom gaat er geen waarschuwing bij. De pool ís de waarschuwing: staat
  //  er nog iemand in, dan staat hij ook niet op de scorekaart. Een lege pool
  //  zegt dat je klaar bent.
  const poolHtml = `
    <div style="border:1.5px dashed ${_flightPool.length ? 'var(--gold)' : 'var(--border)'};border-radius:10px;padding:8px 12px;margin-bottom:12px;background:${_flightPool.length ? 'var(--gold-pale)' : 'transparent'}">
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:${_flightPool.length ? 'var(--gold)' : 'var(--mid)'};margin-bottom:${_flightPool.length ? '6px' : '0'}">
        Spelerspool${_flightPool.length ? ` (${_flightPool.length})` : ''}
      </div>
      ${_flightPool.length === 0
        // ⚠ v5.21.2: hier stond "Leeg — iedereen is ingedeeld ✓". Het woord
        // "leeg" botste met de browsertest die controleert dat er GEEN
        // lege-flight-waarschuwing in dit venster staat ("Flight 2 is leeg").
        // Playwright zoekt daar hoofdletterloos op "leeg" en vond deze regel.
        // De waarschuwing is echt; mijn tekst zat ernaast. Zonder dat woord
        // zegt hij hetzelfde, korter.
        ? '<div style="font-size:12px;color:var(--light)">Iedereen is ingedeeld ✓</div>'
        : _flightPool.map((s, pi) => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.naam)}</span>
            <span style="font-size:12px;color:var(--mid);flex-shrink:0">hcp ${Math.round(s.hcp)}</span>
            <select onchange="plaatsUitPool(${pi}, this.value)" style="font-size:12px;border:1.5px solid var(--border);border-radius:5px;padding:3px 5px;background:var(--card-bg);color:var(--dark);flex-shrink:0;min-width:104px;max-width:150px">
              <option value="">→ flight…</option>
              ${_flights.map((lf, lfi) => `<option value="${lfi}">${esc(lf.naam)}</option>`).join('')}
            </select>
          </div>`).join('')}
    </div>`;

  // v5.9.0: kop met het aantal spelers, een knop om gelijk te verdelen en een
  // waarschuwing als er een flight leeg is.
  const kop = poolHtml + `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:13px;color:var(--mid)">${ingedeeld.size} speler(s) · ${_flights.length} flight(s)</span>
      <select id="t-verdeel-soort" class="input" style="margin-left:auto;width:auto;font-size:12px;padding:4px 8px">
        <option value="beurt">Om de beurt</option>
        <option value="stand">Op plek, beste laatst</option>
        <option value="nieuw">Nog niet met elkaar gespeeld</option>
        <option value="hcp">Op individuele handicap</option>
        <option value="flighthcp">Op flight handicap</option>
      </select>
      <button class="btn btn-sm btn-ghost" onclick="verdeelSpelersOverFlights()">⇄ Verdelen</button>
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
            <!-- v5.19.0: dit menu stond er alleen bij twee of meer flights. Nu
                 altijd, want ook met één flight kun je iemand terug in de pool
                 zetten. -->
            <select onchange="verplaatsSpelerFlight(${fi}, ${si}, this.value)" title="Verplaats naar een andere flight of terug naar de pool" style="font-size:12px;border:1.5px solid var(--border);border-radius:5px;padding:3px 5px;background:var(--card-bg);color:var(--dark);flex-shrink:0;min-width:104px;max-width:150px">
              ${_flights.map((lf, lfi) => `<option value="${lfi}" ${lfi === fi ? 'selected' : ''}>${esc(lf.naam)}</option>`).join('')}
              <option value="pool">→ Pool</option>
            </select>
          </div>
        `).join('')}
        ${f.spelers.length === 0 ? '<p style="font-size:12px;color:var(--gold);padding:8px 0">Nog geen spelers. Gebruik ⇄ Verdelen, of verplaats iemand hierheen met het keuzemenu achter zijn naam.</p>' : ''}
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
  // v5.19.0: "pool" is een geldige bestemming — iemand uit de indeling halen
  // zonder hem uit het toernooi te gooien.
  if (naarFi === 'pool') {
    const speler = _flights[vanFi].spelers.splice(si, 1)[0];
    if (speler) _flightPool.push(speler);
    renderFlightLijst();
    return;
  }
  naarFi = parseInt(naarFi);
  if (vanFi === naarFi) return;
  const speler = _flights[vanFi].spelers.splice(si, 1)[0];
  _flights[naarFi].spelers.push(speler);
  renderFlightLijst();
}

// v5.19.0: uit de pool in een flight. De keuzelijst begint op "→ flight…", dus
// een lege waarde betekent: nog niets gekozen.
function plaatsUitPool(pi, naarFi) {
  if (naarFi === '' || naarFi === null) return;
  const fi = parseInt(naarFi);
  if (!_flights[fi]) return;
  const speler = _flightPool.splice(pi, 1)[0];
  if (speler) _flights[fi].spelers.push(speler);
  renderFlightLijst();
}
window.plaatsUitPool = plaatsUitPool;

// ============================================================
//  START TOERNOOI — leest alle dag-blokken in
// ============================================================
// ============================================================
//  ⚠ HET SLOT OP HET OPSLAAN  (v5.22.0)
// ------------------------------------------------------------
//  WAT ER MIS WAS, gemeten op live op 14 september 2026. In de database stonden
//  TWEE toernooien "Cie on tour 2026", aangemaakt om 14:46:50 en 14:46:55 —
//  vijf seconden na elkaar, met dezelfde acht spelers. Het tweede kreeg
//  gastcode `cieontour20262`, want de app zag de eerste code al staan. Eén keer
//  opslaan, twee keer uitgevoerd.
//
//  Sierk: "ik heb maar 1 toernooi aangemaakt met deze naam." Klopt. Deze functie
//  maakt ook alle gastaccounts aan, één voor één; bij acht gasten duurt dat
//  seconden. In die tijd gebeurt er op het scherm niets en blijft de knop
//  indrukbaar. Een tweede druk begon het hele verhaal opnieuw.
//
//  ⚠ Dat dit vóór v5.21.0 niet gebeurde was toeval: de regel "X loopt nog"
//  weigerde toen een tweede toernooi. Die is verhuisd naar starten, en toen lag
//  dit gat open. Een vangnet dat per ongeluk iets anders afvangt is geen slot.
//
//  Het slot staat op de FUNCTIE, niet alleen op de knop: ook een dubbele
//  toetsaanslag of een tweede aanroep van buitenaf komt er niet doorheen.
let _bezigMetOpslaan = false;

async function startToernooi() {
  if (_bezigMetOpslaan) { toast('Bezig met opslaan — even geduld'); return; }
  _bezigMetOpslaan = true;
  const _opslaanKnop = document.getElementById('flight-modal-start-btn');
  const _knopTekst = _opslaanKnop?.textContent;
  if (_opslaanKnop) {
    _opslaanKnop.disabled = true;
    _opslaanKnop.style.opacity = '0.6';
    _opslaanKnop.textContent = 'Bezig met opslaan…';
  }
  try {
    const naam     = document.getElementById('t-naam').value.trim();
    // v5.13.0: punten en handicap staan per dag. Dag 1 is tegelijk de
    // toernooistandaard — die geldt voor een dag die er later bij komt en zonder
    // eigen waarden wordt aangemaakt.
    const _d1      = setupDag1() || {};
    const ptWin    = _d1.ptWin  ?? 2;
    const ptTie    = _d1.ptTie  ?? 0;
    const ptLoss   = _d1.ptLoss ?? -2;
    const hcpPct   = (_d1.hcpPctHeel ?? 75) / 100;
    // v3.1.1: als er geen ranking-ladder is aangevinkt, val terug op de spelers-ladder(s),
    // zodat een toernooi altijd de ladder bijwerkt waar de deelnemers vandaan komen.
    // Voorkomt dat de ranking leeg blijft (o.a. na het per ongeluk uitzetten van het vinkje
    // of de reset na 'start'), waardoor de ladder-update niet draaide.
    // v5.12.8: hier stond een terugval op de spelers-ladders — koos je geen
    // ranking-ladder maar vinkte je er wel een aan bij "Spelers ladder(s)", dan
    // werd die stilzwijgend de ranking-ladder. Dat blok bestaat niet meer, en
    // die achterdeur dus ook niet. Een toernooi telt voortaan alleen mee voor
    // de ladder die je expliciet in de keuzelijst kiest.
    const _rankingSet = _tRankingLadderIds;
    const rankingLadderIds = [..._rankingSet];
    const ladderId = rankingLadderIds[0] || null;
    const modus    = toernooiModusUitFormulier();   // v5.12.1
    const starttijd = _d1.starttijd || '09:00';   // v5.13.0: alleen nog terugval
    const interval  = _d1.interval ?? 0;
    // v5.10.0: leeg laten mag — dan krijgen gastspelers geen inlog.
    const gastWachtwoord = document.getElementById('t-gast-wachtwoord')?.value.trim() || '';

    if (!naam) { toast('Voer een naam in'); return; }

    // v5.12.4: ⚠ NOOIT STIL STARTEN ZONDER WACHTWOORD.
    //
    // WAT ER MIS WAS. Het gastwachtwoord staat alleen in dit ene invulveld en
    // wordt nergens onthouden. Was het leeg — na een herlaad, of na "Toernooi
    // opnieuw instellen" — dan sloeg de app het aanmaken van inlogs gewoon
    // over. Geen melding, geen inlognamen, geen knop "Gastlogins tonen", en de
    // gasten konden niet inloggen. Sierk, 13 september 2026: "omdat er geen
    // inlognamen zijn kunnen spelers ook niet inloggen."
    const gastenZonderWw = _tGeselecteerdeSpelers.filter(sp => sp.gast).length;
    if (!gastWachtwoord && gastenZonderWw > 0 && !IS_TEST) {
      if (!confirm(
        `Er ${gastenZonderWw === 1 ? 'zit 1 gastspeler' : `zitten ${gastenZonderWw} gastspelers`} in dit ` +
        `toernooi, maar er is geen wachtwoord ingevuld.\n\n` +
        `Zonder wachtwoord krijgen zij GEEN inlog en kunnen ze niet meedoen op hun eigen telefoon.\n\n` +
        `Toch opslaan?`)) return;
    }
    if (gastWachtwoord && gastWachtwoord.length < 6) {
      toast('Het gastwachtwoord moet minstens 6 tekens hebben');
      return;
    }
    if (gastWachtwoord && _gastBeheerGeblokkeerdInTest()) return;
    // v5.12.3: de code moet uniek zijn onder ALLE toernooien die er nog zijn,
    // niet alleen de actieve — ook een afgerond toernooi heeft zijn gastaccounts
    // nog, en die bezetten de inlognamen.
    let gastCode = toernooiCodeVan(naam);
    if (gastWachtwoord) {
      try {
        const alle = await getDocs(TOERNOOIEN_COL);
        gastCode = uniekeGastCode(naam, alle.docs.map(d => d.data().gastCode));
      } catch (e) {
        console.warn('gastcodes lezen mislukt, val terug op de naam:', e?.code);
      }
    }

    // ⚠ v5.21.0: hier stond "nooit twee toernooien naast elkaar" — en die
    // blokkade zat op AANMAKEN. Dat kon toen niet anders, want aanmaken was
    // starten. Nu je een toernooi kunt aanmaken dat blijft wachten, zou die
    // regel je verbieden het volgende alvast klaar te zetten.
    //
    // De grens is verhuisd naar STARTEN, in startDag(): zoveel wachtende
    // toernooien als je wilt, maar één tegelijk gestart. Keuze van Sierk,
    // 14 september 2026.

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

      // v5.12.0: de speelwijze van DEZE dag. Staat er niets, dan die van het
      // toernooi — zo blijft een bestaand toernooi zich gedragen als altijd.
      const dagModusKeuze = blok.querySelector('.t-dag-modus')?.value || modus;
      // v5.13.0: tijd, punten en handicap komen per dag uit hetzelfde
      // dagformulier. Elke dag krijgt dus zijn eigen waarden in plaats van
      // allemaal dezelfde toernooibrede.
      const dv = dagUitFormulier(blok) || {};
      dagenConfig.push({ dagNr: i + 1, datum, baan: baanNaam, holes,
                         starttijd: dv.starttijd || starttijd,
                         interval:  dv.interval ?? interval,
                         ptWin: dv.ptWin, ptTie: dv.ptTie, ptLoss: dv.ptLoss,
                         hcpPct: (dv.hcpPctHeel ?? 75) / 100,
                         plaatsPunten: dv.plaatsPunten || '',   // v5.15.0
                         modus: dagModusKeuze });
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
        modus:     cfg.modus,      // v5.12.0
        // v5.13.0: per dag. dagInstelling() valt terug op de toernooibrede
        // waarde als deze velden ontbreken, dus oude toernooien blijven gelijk.
        ptWin:     cfg.ptWin,
        ptTie:     cfg.ptTie,
        ptLoss:    cfg.ptLoss,
        hcpPct:    cfg.hcpPct,
        plaatsPunten: cfg.plaatsPunten || '',   // v5.15.0, leeg = de standaardreeks
        flights,
        scores,
        // ⚠ v5.21.0: dag 1 startte hier meteen mee. Dat maakte aanmaken en
        // starten één handeling, en dat is precies wat eruit moest. Sierk,
        // 14 september 2026: "op een veel later tijdstip start ik het toernooi.
        // dus dat aangemaakte toernooi staat onder nieuw toernooi en eerder
        // toernooi netjes te wachten tot het gestart wordt."
        //
        // Alle dagen beginnen nu als concept. Het toernooi staat klaar en wacht;
        // starten doe je met ▶ Dag 1 starten, dat sinds v5.14.0 al bestaat.
        gestart:  false,
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

    toast('Toernooi opgeslagen — het staat klaar. Start dag 1 wanneer je zover bent.', 7000);
    wisToernooiConcept(); // v4.0.0 (fix 7.1)
    closeModal('modal-flight-indeling');
    store._flights = [];
    store._flightPool = [];   // v5.19.0
    store._tGeselecteerdeSpelers = [];
    store._tRankingLadderIds = new Set();
    document.getElementById('t-naam').value = '';
    document.getElementById('t-aantal-dagen').value = '1';
    window._tSetupTab = 'toernooi';   // v5.21.0
    window._tSetupDagNr = 1;
    // v5.12.8: waren vakjes, is nu een keuzelijst. Terug naar "Geen".
    const _rankKeuze = document.querySelector('#t-ranking-ladders select');
    if (_rankKeuze) _rankKeuze.value = '';
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
  } catch(e) {
    toernooiFout('Toernooi opslaan', e);
  } finally {
    // ⚠ In `finally`, niet aan het eind van de `try`: gaat er onderweg iets mis,
    // dan moet de knop weer werken — anders is het scherm op slot en ben je je
    // hele formulier kwijt.
    _bezigMetOpslaan = false;
    if (_opslaanKnop) {
      _opslaanKnop.disabled = false;
      _opslaanKnop.style.opacity = '';
      if (_knopTekst) _opslaanKnop.textContent = _knopTekst;
    }
  }
}

// ============================================================
//  DAG BEHEER
// ============================================================

// Selecteer actieve dag en herrender
function selecteerDag(dagNr) {
  if (!toernooiData) return;
  // v5.13.1: 0 is het tabblad "Toernooi" — het geheel, niet één dag. De
  // bekeken dag blijft dan staan waar hij stond, zodat je bij terugkeren op
  // dezelfde dag uitkomt.
  window._tTabblad = dagNr === 0 ? 0 : null;
  // v5.17.0: het tabblad Spelers is een derde stand van dezelfde schakelaar.
  // Klik je op Toernooi of een dag, dan gaat die stand dus vanzelf uit.
  // v4.0.0: alleen lokale weergave — schrijft NIET meer naar Firestore.
  // Voorheen werd actiefDagNr voor het hele toernooi (alle gebruikers)
  // overschreven zodra iemand een oude dag bekeek (fix 7.4).
  if (dagNr !== 0) window._bekijkDagNr = dagNr;
  // Het klassement volgt het tabblad: op "Toernooi" het totaal (0), op een
  // dagtabblad die dag. Voorheen had het klassement een eigen keuze.
  window._ranglijstDagNr = dagNr;
  renderToernooiActief();
}

// ============================================================
//  HET TABBLAD SPELERS  (v5.17.0)
// ------------------------------------------------------------
//  Sierk, 14 september 2026: "ik denk erover om een aparte spelers tab te maken
//  bij een toernooi."
//
//  ⚠ WAT ER MIS WAS. De knop "👥 Spelers" zat in de KOP VAN DE SCOREKAART. Die
//  kop bestaat alleen op een dagtabblad, en alleen als die dag gestart is. Op
//  het tabblad Toernooi, en op een dag die nog concept is, kon je dus niet bij
//  je eigen spelerslijst. Terwijl je juist dán iemand toevoegt.
//
//  Nu staat het waar het hoort: een eigen tabblad, naast Toernooi en de dagen.
//  Alleen voor de coordinator — een deelnemer heeft er niets te zoeken.
//
//  `_tTabblad` had twee standen (0 = Toernooi, null = een dag) en heeft er nu
//  drie. 'spelers' is de derde; selecteerDag() zet hem vanzelf weer uit.
function selecteerSpelersTab() {
  if (!toernooiData) return;
  window._tTabblad = 'spelers';
  renderToernooiActief();
}
window.selecteerSpelersTab = selecteerSpelersTab;

// Open modal om nieuwe dag te configureren
// v5.13.0: het venster wordt gevuld door dagFormulierHtml() — dezelfde bron als
// het aanmaakscherm. Hiervoor stond het formulier hier een tweede keer,
// uitgetikt in index.html, en kende het net andere velden.
//
// `metIds: true` zorgt dat de velden hun vaste namen (t-dag-datum, ...) houden
// naast hun klasse. Alle bestaande code en alle browsertests die op die namen
// zoeken blijven daardoor werken.
function vulDagVenster(w, dagNr) {
  const doel = document.getElementById('modal-dag-formulier');
  if (!doel) return;
  doel.innerHTML = dagFormulierHtml(w, { metIds: true, dagNr: dagNr || 1 });
}

function openNieuweDagModal() {
  const t = toernooiData;
  if (!t) return;
  const vorigeDag = (t.dagen || []).slice(-1)[0];
  // Datum: die van de vorige dag plus één.
  let datum;
  if (vorigeDag?.datum) {
    const d = new Date(vorigeDag.datum);
    d.setDate(d.getDate() + 1);
    datum = d.toISOString().split('T')[0];
  } else {
    datum = new Date().toISOString().split('T')[0];
  }
  // De rest volgt de vorige dag; ontbreekt die waarde daar, dan de
  // toernooibrede — dezelfde volgorde als dagInstelling() bij het rekenen.
  vulDagVenster({
    datum,
    baan:      vorigeDag?.baan || '',
    holes:     String(vorigeDag?.holes?.length || 18) === '9' ? '9' : '18',
    modus:     dagModus(t, vorigeDag),
    starttijd: vorigeDag?.starttijd || '09:00',
    interval:  vorigeDag?.interval ?? 10,
    ptWin:     dagInstelling(vorigeDag, t, 'ptWin', 2),
    ptTie:     dagInstelling(vorigeDag, t, 'ptTie', 0),
    ptLoss:    dagInstelling(vorigeDag, t, 'ptLoss', -2),
    hcpPct:    Math.round(dagInstelling(vorigeDag, t, 'hcpPct', 0.75) * 100),
  }, (t.dagen || []).length + 1);
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

// ============================================================
//  v5.12.3 — DE GASTCODE MOET UNIEK ZIJN
// ------------------------------------------------------------
//  De code hierboven kapt af op 16 letters. Twee toernooien die pas ná die 16
//  letters verschillen komen dus op dezelfde code uit — gemeten op 13 september
//  2026:
//
//      Clubkampioenschap heren  ->  clubkampioenscha
//      Clubkampioenschap dames  ->  clubkampioenscha
//
//  En dan delen ze hun inlognamen. Harry bij de dames wordt `harry2`, en het
//  inlogscherm stuurt hem naar `harry` — bij de heren. Dat is niet te zien: de
//  namen van de toernooien verschillen immers wél.
//
//  Deze functie zet er een cijfer achter zolang de code al bezet is. `bezet` is
//  de lijst codes van toernooien die er al zijn; een toernooi dat definitief is
//  verwijderd telt niet meer mee, want dan zijn zijn accounts ook weg.
function uniekeGastCode(naam, bezet) {
  const basis = toernooiCodeVan(naam);
  const gebruikt = new Set((bezet || []).filter(Boolean));
  if (!gebruikt.has(basis)) return basis;
  for (let n = 2; n < 100; n++) {
    // Afkappen op 16 gebeurt vóór het cijfer, zodat het cijfer nooit wegvalt.
    const poging = `${basis.slice(0, 15)}${n}`;
    if (!gebruikt.has(poging)) return poging;
  }
  return `${basis.slice(0, 10)}${Date.now().toString(36).slice(-5)}`;
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

// v5.11.7: twee gasten met precies dezelfde naam krijgen allebei een eigen
// inlog (`karel` en `karel2`) — die zijn op het scherm niet uit elkaar te
// houden, want de namen zijn gelijk. Dan moet je het wél weten, anders geef je
// twee mensen hetzelfde briefje. Geeft false als de coordinator afziet.
function _dubbeleGastnaamOk(naam, bestaandeNamen) {
  const gelijk = (bestaandeNamen || []).filter(n =>
    String(n || '').trim().toLowerCase() === String(naam).trim().toLowerCase()).length;
  if (gelijk === 0) return true;
  return confirm(
    `Er doet al iemand mee die "${naam}" heet.\n\n` +
    `Ze krijgen allebei een eigen inlog — de tweede krijgt een cijfer erbij. ` +
    `Op het scherm staan ze onder dezelfde naam, dus je moet zelf doorgeven ` +
    `wie welke inlog heeft.\n\nToch toevoegen?`);
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
      // v5.11.5: ⚠ de markerindeling stond hier niet in. Die is in v5.11.0
      // bijgekomen en werd dus niet meegenomen: in een gestart toernooi stonden
      // de markers nog met de TIJDELIJKE gast-sleutels erin. Het viel niet op
      // omdat markerVan() een marker die niet meer in de flight zit negeert en
      // terugvalt op de kring — maar een marker die de coordinator met de hand
      // omzet ging daarmee bij de eerstvolgende keer verloren.
      if (f.markers) {
        const nieuw = {};
        Object.entries(f.markers).forEach(([speler, marker]) => {
          nieuw[speler === oudeUid ? nieuweUid : speler] = marker === oudeUid ? nieuweUid : marker;
        });
        f.markers = nieuw;
      }
    });
    if (dag.scores && Object.prototype.hasOwnProperty.call(dag.scores, oudeUid)) {
      dag.scores[nieuweUid] = dag.scores[oudeUid];
      delete dag.scores[oudeUid];
    }
  });
}

// ============================================================
//  v5.12.3 — IS DIT EEN WEESACCOUNT?
// ------------------------------------------------------------
//  Firebase weigert een tweede account met dezelfde inlog, en dan zette de app
//  er een cijfer bij: `sierk` werd `sierk2`. Sierk, 13 september 2026: "waarom
//  maakt de app van sierk loginnaam sierk2? er was maar 1 speler in het
//  toernooi die zo heet."
//
//  Er stond dan nog een account van een eerdere ronde met dezelfde
//  toernooinaam. De knop "Toernooi opnieuw instellen" laat die staan (gemeten:
//  eerste keer `sierk`, tweede keer `sierk2`, derde keer `sierk3`).
//
//  Deze controle kijkt of het bezette account een WEES is en dus mag wijken.
//  ⚠ DRIE GRENDELS, net als bij het opruimen na afloop — dit verwijdert
//  accounts van mensen:
//    1. het profiel moet `toernooiGast: true` dragen (een clublid nooit);
//    2. de uid mag in GEEN ENKEL toernooi meer voorkomen dat er nog is;
//    3. de uid mag in geen enkele ladder staan.
//  Valt er één om, dan blijft het account staan en komt het cijfer terug.
async function _gastAccountIsWees(email) {
  try {
    const gevonden = await getDocs(query(collection(db, 'spelers'), where('email', '==', email)));
    // Géén profiel = al een wees. Dat gebeurt bij een opruiming die halverwege
    // is blijven steken: het profiel weg, het Auth-account nog niet. De uid is
    // dan vanaf hier niet te vinden — de Cloud Function zoekt hem op adres op.
    if (gevonden.empty) return { opAdres: true };
    const d = gevonden.docs[0];
    const data = d.data();
    if (data.toernooiGast !== true) return null;           // grendel 1
    const alle = await getDocs(TOERNOOIEN_COL);
    const inGebruik = alle.docs.some(t =>
      (t.data().spelers || []).some(sp => sp.uid === d.id));
    if (inGebruik) return null;                            // grendel 2
    const ladderUids = new Set((alleLadders || []).flatMap(l => l.spelerIds || []));
    if (ladderUids.has(d.id)) return null;                 // grendel 3
    return { uid: d.id };
  } catch (e) {
    console.warn('weescontrole mislukt voor', email, e?.code || e?.message);
    return null;
  }
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
  // v5.12.3: per inlognaam hooguit ÉÉN weespoging. Zonder deze rem zou een
  // opruiming die wel lukt maar niet doorwerkt de lus eindeloos laten draaien.
  const weesGeprobeerd = new Set();

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
        // v5.12.3: eerst kijken of het bezette account een wees is van een
        // eerdere ronde. Zo ja, dan ruimen we hem op en houdt deze speler
        // gewoon zijn eigen naam — geen cijfer voor iets waar hij niets mee
        // te maken heeft.
        const wees = weesGeprobeerd.has(email) ? null : await _gastAccountIsWees(email);
        if (wees) {
          weesGeprobeerd.add(email);
          try {
            if (wees.opAdres) {
              await _verwijderGastAccountFn({ targetEmail: email, isTest: IS_TEST });
            } else {
              await deleteDoc(doc(db, 'spelers', wees.uid));
              await _verwijderGastAccountFn({ targetUid: wees.uid, isTest: IS_TEST });
            }
            poging--;              // dezelfde inlognaam opnieuw proberen
            continue;
          } catch (opruimFout) {
            console.warn('weesaccount opruimen mislukt, val terug op een cijfer:',
              opruimFout?.code || opruimFout?.message);
          }
        }
        // Zelfde naam twee keer in hetzelfde toernooi: er een cijfer bij.
        //
        // ⚠ v5.11.7: het cijfer hoort IN de naam, niet achter de toernooicode.
        // Hier stond `karel.<code>2`. Daar klopte niets van: het scherm kon de
        // code er niet meer afhalen (je zag de hele sleutel), en intikken kon
        // die gast hem al helemaal niet — de app plakt de code er zelf achter
        // en komt dan op `karel2.<code>` uit. Nu is dát ook wat er staat.
        login = gastLoginVan(`${volleNaam}${poging + 1}`, code);
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
// ============================================================
//  DE LEVENSLOOP VAN EEN DAG  (v5.14.0)
// ============================================================
//  Drie toestanden: CONCEPT -> GESTART -> AFGESLOTEN, en terug kan altijd.
//
//    concept     alles aanpasbaar, dag verwijderbaar, nog geen scorekaart
//    gestart     scorekaart open, instellingen op slot
//    afgesloten  scores vast, uitslag geteld
//
//  WAAROM. Tot v5.13.1 was de grens "de dag heeft scores" — een BIJWERKING.
//  Zodra iemand één cijfer intikte kon de coordinator de baan of het aantal
//  holes niet meer wijzigen, zonder dat daar een handeling aan vooraf ging.
//  Sierk, 14 september 2026: *"Totdat de dag gestart is kan ik dan de dag
//  aanpassen. En dan als de dag gestart is een dag annuleren om aanpassingen te
//  doen. Ik wil maximale vrijheid."* Nu is de grens een knop.
//
//  ⚠ Een afgesloten dag geldt altijd als gestart. Anders zou een dag die al is
//  afgerekend als "concept" op het scherm komen, en dat is een onzintoestand.
//
//  ⚠ GEEN TERUGVAL VOOR OUDE TOERNOOIEN — dat is een bewuste keuze van Sierk op
//  14 september 2026 ("je hoeft geen rekening te houden met oude toernooien").
//  Gevolg: een toernooi dat al liep toen v5.14.0 kwam heeft geen `gestart` op
//  zijn dagen staan en toont die als concept. Eén keer op "Dag starten" drukken
//  zet dat recht; er gaat geen score verloren.
// ============================================================
//  WACHT DIT TOERNOOI NOG?  (v5.21.0)
// ------------------------------------------------------------
//  Een toernooi dat is aangemaakt maar waarvan nog geen enkele dag is gestart,
//  staat te wachten. Geen nieuw veld in de database, en dat is met opzet: het
//  is af te leiden uit de dagen die er al staan, dus er valt niets te bewaren
//  en niets uit de pas te lopen. Oude toernooien hoeven niet omgezet.
function toernooiWacht(t) {
  const dagen = t?.dagen || [];
  if (dagen.length === 0) return false;
  return dagen.every(d => !dagIsGestart(d));
}

// Loopt dit toernooi? Dat is er één dat NIET meer wacht en nog niet klaar is.
// Sierk, 14 september 2026: zoveel wachtende toernooien als je wilt, maar één
// tegelijk gestart.
//
// v5.22.0: als losse functie eruit gehaald, want renderToernooi() heeft dezelfde
// vraag — welk toernooi krijgt een speler te zien. Dezelfde regel twee keer
// uitschrijven is twee keer kunnen afwijken.
function toernooiLoopt(t) {
  return !!t &&
    t.status !== 'afgerond' &&
    !toernooiWacht(t) &&
    !(t.dagen || []).every(d => d.afgerond);
}

function lopendToernooi(behalveId) {
  return (alleToernooien || []).find(t => t.id !== behalveId && toernooiLoopt(t));
}

function dagIsGestart(dag) {
  if (!dag) return false;
  return dag.gestart === true || dag.afgerond === true;
}

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
  if (dagIsGestart(dag)) {
    toast(`Dag ${dag.dagNr} is gestart — zet hem eerst terug naar concept om te wijzigen`);
    return;
  }
  // v5.13.0: uit dezelfde bron als het aanmaakscherm. Hiervoor werd elk veld
  // hier met de hand gevuld, en misten de nieuwe velden dus vanzelf.
  const aantal = (dag.holes || []).length;
  vulDagVenster({
    datum:       dag.datum || '',
    baan:        dag.baan || '',
    holes:       (aantal === 18 || aantal === 9) ? String(aantal) : 'custom',
    holesCustom: (aantal === 18 || aantal === 9) ? '' : String(aantal),
    modus:       dagModus(t, dag),
    starttijd:   dag.starttijd || '09:00',
    interval:    dag.interval ?? 10,
    ptWin:       dagInstelling(dag, t, 'ptWin', 2),
    ptTie:       dagInstelling(dag, t, 'ptTie', 0),
    ptLoss:      dagInstelling(dag, t, 'ptLoss', -2),
    hcpPct:      Math.round(dagInstelling(dag, t, 'hcpPct', 0.75) * 100),
  }, dag.dagNr);

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
    // v5.14.0: de grens is nu de startknop, niet het eerste cijfer.
    if (dagIsGestart(dag)) { toast(`Dag ${dagNr} is gestart — zet hem eerst terug naar concept`); return; }

    const datum    = document.getElementById('t-dag-datum')?.value;
    const baanNaam = document.getElementById('t-dag-baan')?.value;
    const aantalHoles = dagHolesUitVenster();   // v5.12.4
    if (aantalHoles === null) {
      toast('Vul een aangepast aantal holes in tussen 1 en 18');
      return;
    }
    const holesCount = aantalHoles;

    if (!datum)    { toast('Voer een datum in'); return; }
    if (!baanNaam) { toast('Selecteer een baan'); return; }

    const banen = alleBANEN();
    const holes = (banen[baanNaam]?.holes || []).slice(0, holesCount);
    if (!holes.length) { toast('Baan heeft geen holes geconfigureerd'); return; }

    const anderAantal = holes.length !== (dag.holes || []).length;
    dag.datum     = datum;
    dag.baan      = baanNaam;
    dag.holes     = holes;
    // v5.13.0: uit hetzelfde gedeelde formulier, dus ook de punten en de
    // handicapverrekening van deze dag.
    const dv      = dagUitFormulier(document.getElementById('modal-dag-formulier')) || {};
    dag.modus     = dv.modus || dagModus(t, dag);  // v5.12.0
    dag.starttijd = dv.starttijd || dag.starttijd || '09:00';
    dag.interval  = dv.interval ?? (dag.interval || 0);
    dag.ptWin     = dv.ptWin;
    dag.ptTie     = dv.ptTie;
    dag.ptLoss    = dv.ptLoss;
    dag.hcpPct    = (dv.hcpPctHeel ?? 75) / 100;
    dag.plaatsPunten = dv.plaatsPunten || '';   // v5.15.0

    // Bij een ander aantal holes moeten de scorerijen mee.
    //
    // ⚠ v5.14.0 — DEZE AANNAME KLOPT NIET MEER. Hier stond "er zijn hier per
    // definitie geen ingevulde scores, dus er gaat niets verloren". Dat gold
    // toen de grens `dagHeeftScores()` was: met scores kwam je hier nooit. Sinds
    // een dag terug naar concept kan mét zijn scores erin, kan dat wél. Zonder
    // deze waarschuwing raak je een halve speeldag kwijt met één keuzelijst.
    if (anderAantal) {
      const aantalScores = Object.values(dag.scores || {})
        .reduce((n, rij) => n + (rij || []).filter(v => v !== null && v !== undefined && v !== '').length, 0);
      if (aantalScores > 0 && !confirm(
            `Je wijzigt dag ${dagNr} van ${(dag.holes || []).length} naar ${holes.length} holes.\n\n` +
            `⚠ De ${aantalScores} al ingevulde scores van deze dag gaan daarbij VERLOREN. ` +
            `Dit is niet terug te draaien.\n\nDoorgaan?`)) return;
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
    if (dagIsGestart(dag)) { toast(`Dag ${dagNr} is gestart — zet hem eerst terug naar concept`); return; }
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
    const aantalHoles = dagHolesUitVenster();   // v5.12.4
    if (aantalHoles === null) {
      toast('Vul een aangepast aantal holes in tussen 1 en 18');
      return;
    }
    const holesCount = aantalHoles;

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
    // v5.13.0: het hele dagformulier in één keer uitlezen, met dezelfde functie
    // als het aanmaakscherm. Zo krijgt een dag die je ONDERWEG toevoegt precies
    // dezelfde instellingen als een dag die je bij het aanmaken invult —
    // inclusief eigen punten en eigen handicapverrekening.
    const dv = dagUitFormulier(document.getElementById('modal-dag-formulier')) || {};

    const nieuweDag = {
      dagNr:    (t.dagen || []).length + 1,
      datum,
      baan:     baanNaam,
      holes,
      starttijd: dv.starttijd || '09:00',
      interval:  dv.interval ?? 0,
      modus:     dv.modus || dagModus(t, null),  // v5.12.0
      ptWin:     dv.ptWin,
      ptTie:     dv.ptTie,
      ptLoss:    dv.ptLoss,
      hcpPct:    (dv.hcpPctHeel ?? 75) / 100,
      plaatsPunten: dv.plaatsPunten || '',   // v5.15.0
      flights:  [],  // leeg — beheerder deelt in via flight modal
      scores,
      gestart:  false,   // v5.14.0: eerst indelen en instellen, dan starten
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
    // ⚠ v5.19.0: hier ging het voorheen mis, en stil. Dit scherm laadde alleen
    // spelers die IN een flight zaten. Wie er niet in zat — sinds v5.19.0
    // iedereen die je op het tabblad Spelers toevoegt — bestond hier niet en
    // kwam nooit op een scorekaart. Nu staat hij in de pool, in beeld.
    const ingedeeld = new Set(store._flights.flatMap(f => f.spelers.map(s => s.uid)));
    store._flightPool = (t.spelers || []).filter(s => !ingedeeld.has(s.uid));
  } else {
    // Nieuwe indeling — zet alle spelers in flight 1. Ongewijzigd: bij een
    // nieuwe dag deel je meteen in, daar hoort geen pool bij.
    store._flights = [{ id: 1, naam: 'Flight 1', spelers: [...t.spelers], starthole: 1, starttijd }];
    store._flightPool = [];
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
    store._flightPool = [];   // v5.19.0
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
// ▶ De dag openzetten voor scores. Vanaf dat moment liggen de instellingen
// vast — datum, baan, holes, speelwijze, tijd, punten en handicap.
async function startDag() {
  try {
    const t   = toernooiData;
    const dag = actieveDag(t);
    if (!dag) { toast('Geen dag gevonden om te starten'); return; }
    if (dagIsGestart(dag)) { toast(`Dag ${dag.dagNr} is al gestart`); return; }
    // v5.21.0: de grens die tot v5.20.0 op AANMAKEN zat, zit nu hier. Twee
    // toernooien tegelijk laten lopen maakt het willekeurig welk toernooi een
    // speler te zien krijgt — op meerdere plekken wordt alleToernooien[0]
    // gebruikt uit een zoekopdracht zonder sorteervolgorde.
    const alLopend = lopendToernooi(actieveToernooiId);
    if (alLopend) {
      toast(`"${alLopend.naam || 'Een toernooi'}" loopt nog. Sluit dat eerst af of annuleer het — `
          + `daarna kun je deze starten.`, 9000);
      return;
    }
    if (!(dag.flights || []).some(f => (f.spelerIds || []).length > 0)) {
      // Zonder indeling toont de scorekaart holes zonder spelerskolommen —
      // precies het beeld "er is geen indeling" uit de meting van 11 september.
      if (!confirm(`Dag ${dag.dagNr} heeft nog geen flightindeling.\n\n` +
                   `De scorekaart blijft dan leeg. Toch starten?`)) return;
    }
    // ⚠ v5.15.0 — PAK DE DAG OPNIEUW, NA DE VRAAG.
    // Hierboven staat een confirm(), en zolang die openstaat kan de
    // meeluisteraar `toernooiData` vervangen door een verse serverkopie. De
    // `dag` van vóór de vraag wijst dan in het WEGGEGOOIDE object: je wijzigt
    // de oude kopie en slaToernooiOp() schrijft de nieuwe weg, met de oude
    // waarde erin. De wijziging verdwijnt dan geruisloos.
    // Dezelfde fout als bij de sleutelwissel in v5.12.4. Gevonden doordat de
    // levenslooptest in de volle reeks omviel en los slaagde.
    const dagNu = (toernooiData?.dagen || []).find(d => d.dagNr === dag.dagNr);
    if (!dagNu) { toast('De dag is ondertussen verdwenen — ververs het scherm'); return; }
    dagNu.gestart = true;
    await slaToernooiOp();
    toast(`Dag ${dagNu.dagNr} gestart — de scorekaart staat open`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag starten', e); }
}
window.startDag = startDag;

// ↩ Terug naar concept, zodat de dag weer aanpasbaar wordt. Dit is wat Sierk
// "dag annuleren" noemt: niet weggooien, maar op slot af.
//
// ⚠ De scores blijven staan. Ze verdwijnen pas als je daarna het AANTAL HOLES
// wijzigt — daar waarschuwt slaDagWijzigingOp() apart voor.
async function zetDagTerugNaarConcept() {
  try {
    const t   = toernooiData;
    const dag = actieveDag(t);
    if (!dag) { toast('Geen dag gevonden'); return; }
    if (dag.afgerond) { toast(`Dag ${dag.dagNr} is afgesloten — heropen hem eerst`); return; }
    if (!dagIsGestart(dag)) { toast(`Dag ${dag.dagNr} staat al op concept`); return; }

    const aantalScores = Object.values(dag.scores || {})
      .reduce((n, rij) => n + (rij || []).filter(v => v !== null && v !== undefined && v !== '').length, 0);
    const waarschuwing = aantalScores > 0
      ? `\n\n⚠ Er staan al ${aantalScores} ingevulde scores. Die blijven bewaard, ` +
        `maar als je daarna het AANTAL HOLES wijzigt gaan ze verloren.`
      : '';
    if (!confirm(`Dag ${dag.dagNr} terugzetten naar concept?\n\n` +
                 `De instellingen worden weer aanpasbaar en de scorekaart gaat dicht.` +
                 waarschuwing)) return;

    // ⚠ v5.15.0 — PAK DE DAG OPNIEUW, NA DE VRAAG.
    // Hierboven staat een confirm(), en zolang die openstaat kan de
    // meeluisteraar `toernooiData` vervangen door een verse serverkopie. De
    // `dag` van vóór de vraag wijst dan in het WEGGEGOOIDE object: je wijzigt
    // de oude kopie en slaToernooiOp() schrijft de nieuwe weg, met de oude
    // waarde erin. De wijziging verdwijnt dan geruisloos.
    // Dezelfde fout als bij de sleutelwissel in v5.12.4. Gevonden doordat de
    // levenslooptest in de volle reeks omviel en los slaagde.
    const dagNu = (toernooiData?.dagen || []).find(d => d.dagNr === dag.dagNr);
    if (!dagNu) { toast('De dag is ondertussen verdwenen — ververs het scherm'); return; }
    dagNu.gestart = false;
    await slaToernooiOp();
    toast(`Dag ${dagNu.dagNr} staat weer op concept`);
    renderToernooiActief();
  } catch(e) { toernooiFout('Dag terugzetten', e); }
}
window.zetDagTerugNaarConcept = zetDagTerugNaarConcept;

async function heropenDag() {
  try {
    const t   = toernooiData;
    const dag = actieveDag(t);
    if (!dag) { toast('Geen dag gevonden om te heropenen'); return; }
    if (!dag.afgerond) { toast(`Dag ${dag.dagNr} is niet afgesloten`); return; }
    if (!confirm(`Dag ${dag.dagNr} weer openzetten?\n\n` +
                 `De scores worden weer aanpasbaar. De al berekende uitslag blijft staan ` +
                 `en wordt opnieuw bepaald zodra je de dag opnieuw afsluit.`)) return;

    // ⚠ v5.15.0, ook hier — PAK DE DAG OPNIEUW, NA DE VRAAG.
    // Hierboven staat een confirm(), en zolang die openstaat kan de
    // meeluisteraar `toernooiData` vervangen door een verse serverkopie. De
    // `dag` van vóór de vraag wijst dan in het WEGGEGOOIDE object: je wijzigt
    // de oude kopie en slaToernooiOp() schrijft de nieuwe weg, met de oude
    // waarde erin. De wijziging verdwijnt dan geruisloos.
    // Dezelfde fout als bij de sleutelwissel in v5.12.4. Gevonden doordat de
    // levenslooptest in de volle reeks omviel en los slaagde.
    const dagNu = (toernooiData?.dagen || []).find(d => d.dagNr === dag.dagNr);
    if (!dagNu) { toast('De dag is ondertussen verdwenen — ververs het scherm'); return; }
    dagNu.afgerond = false;
    await slaToernooiOp();
    toast(`Dag ${dagNu.dagNr} is weer open`);
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
    toast(aan ? 'Klassement en onderlinge stand zichtbaar voor deelnemers ✓'
              : 'Klassement en onderlinge stand verborgen voor deelnemers');
  } catch(e) { toernooiFout('Stand aan/uit zetten', e); }
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

// v5.17.0: de spelerslijst staat op twee plekken op het scherm — op het tabblad
// Spelers en in het venster "Spelers beheren". Eén bron, zodat ze niet uit
// elkaar kunnen gaan lopen: verandert de inlogregel, dan verandert hij op
// allebei. De rij is LETTERLIJK overgenomen uit het venster.
function spelerRijenHtml(t) {
  if (!t || !(t.spelers || []).length) {
    return '<div style="padding:10px 0;font-size:13px;color:var(--light)">Nog geen spelers in dit toernooi</div>';
  }
  return t.spelers.map(s => `
    <div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:14px">${esc(s.naam)}${s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}<br>${inlogRegel(s)}</span>
      <button class="btn btn-sm" style="background:var(--alert-bg);color:var(--alert-text);border:none;cursor:pointer;padding:5px 10px;border-radius:6px;font-size:12px"
        onclick="verwijderToernooiSpelerNieuw('${escAttr(s.uid)}')">✕</button>
    </div>
  `).join('');
}

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
  verwijderLijst.innerHTML = spelerRijenHtml(t);

  // v5.19.0: hier werden twee flightkeuzelijsten gevuld. Weg — dit venster gaat
  // over wie meedoet, niet over waar hij staat.

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
  // v5.12.8: hier stond geen gastfilter, en deze lijst is nooit door het
  // ladderfilter gegaan — de gasten van vorige toernooien stonden er dus al
  // tussen. In dezelfde moeite recht gezet.
  const pool = alleSpelersData.filter(s => !huidigeIds.has(s.uid) && s.toernooiGast !== true)
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
    const speler = { uid: _toernooiSpelerToevoegen.uid, naam: _toernooiSpelerToevoegen.naam, hcp: _toernooiSpelerToevoegen.hcp, gast: false };

    t.spelers.push(speler);
    // v5.19.0: hier stond een flightkeuze en werd de speler meteen in die
    // flight gezet. Sierk, 14 september 2026: "de spelers tab is spelers
    // beheer." Indelen hoort bij de dag, dus hij komt in de SPELERSPOOL — dat
    // is simpelweg: wel in t.spelers, nog in geen enkele flight. Het
    // flightvenster van elke dag toont hem daar.
    (t.dagen || []).forEach(dag => {
      dag.scores[speler.uid] = Array(dag.holes.length).fill(null);
    });

    herschikMarkers(t);   // v5.11.6
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

    if (!_dubbeleGastnaamOk(naam, (t.spelers || []).map(sp => sp.naam))) return;   // v5.11.7

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
    // v5.19.0: geen flightkeuze meer — hij komt in de spelerspool. Zie
    // voegBestaandeSpelerToeAanToernooi() hierboven.
    (t.dagen || []).forEach(dag => {
      dag.scores[gastId] = Array(dag.holes.length).fill(null);
    });

    herschikMarkers(t);   // v5.11.6
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
    closeModal('modal-toernooi-spelers');
    renderToernooiActief();
    toast(login
      ? `${naam} toegevoegd — inloggen met de eigen naam en het toernooiwachtwoord ✓`
      : `${naam} toegevoegd als gastspeler ✓`, login ? 7000 : 2500);
  } catch(e) { toernooiFout('Gastspeler toevoegen', e); }
}

// ============================================================
//  GASTEN PLAKKEN  (v5.18.0)
// ------------------------------------------------------------
//  De vervanger van de bulk-import uit js/admin.js. Sierk, 14 september 2026:
//  "het gaat er om om uitsluitend gast spelers te importeren en dat mag per
//  toernooi en ze hoeven niet bewaard te blijven buiten het toernooi."
//
//  Dat is precies wat een gastspeler al is: een regel in het toernooidocument
//  met een naam, een handicap en `gast: true`. Geen account, geen profiel,
//  niets daarbuiten. Deze functie is dus niets anders dan
//  voegGastspelerToeAanToernooi() in één keer voor een hele lijst.
//
//  ⚠ Dit venster maakt GEEN inlogs aan. Dat blijft de knop "Gastlogins
//  aanmaken" op hetzelfde tabblad: die meldt per speler wat er misging, en dat
//  hoeft niet op twee plekken te bestaan.
// ============================================================

// Leest de geplakte tekst. Pure functie — geen scherm, geen database — zodat de
// rekentest hem kan natellen. Eén speler per regel, in wat Excel ervan maakt:
//
//    Karel Jansen<TAB>12        Karel<TAB>12        Karel Jansen 12
//    Karel;Jansen;12            Karel Jansen        Karel Jansen,12
//
// ⚠ Een gast met ALLEEN een voornaam is geldig — daar ging v5.17.0 over. En de
// handicap mag met een komma ("12,4"), want dat is wat een Nederlandse Excel
// oplevert.
function gastenUitTekst(tekst, bestaandeNamen = []) {
  const bekend = new Set((bestaandeNamen || [])
    .map(n => String(n || '').trim().toLowerCase()).filter(Boolean));
  const spelers = [];
  const dubbel = [];
  let leeg = 0;

  const alsGetal = (v) => {
    const s = String(v ?? '').trim().replace(',', '.');
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  };

  String(tekst || '').split(/\r?\n/).forEach(regel => {
    const r = regel.trim();
    if (!r) { leeg++; return; }

    // Eerst op tab of puntkomma — dat is wat Excel maakt. Levert dat één veld
    // op, dan is het een gewone regel en kan een getal aan het eind de handicap
    // zijn, met of zonder komma ervoor.
    //
    // ⚠ De KOMMA is met opzet geen scheidingsteken hier. Een Nederlandse Excel
    // schrijft "8,4" en dan werd "Anna de Wit<TAB>8,4" drie velden: de naam
    // werd "Anna de Wit 8" en de handicap 4. Een komma tussen naam en handicap
    // vangt de regel hieronder op.
    let velden = r.split(/[\t;]/).map(v => v.trim()).filter(v => v !== '');
    let hcp = null;
    if (velden.length > 1) {
      const laatste = alsGetal(velden[velden.length - 1]);
      if (laatste !== null) { hcp = laatste; velden = velden.slice(0, -1); }
    } else {
      const m = r.match(/^(.*?)[\s,]*([+-]?\d+(?:[.,]\d+)?)$/);
      if (m) { velden = [m[1]]; hcp = alsGetal(m[2]); }
    }

    const naam = velden.join(' ').replace(/\s+/g, ' ').trim();
    if (!naam) { leeg++; return; }

    const sleutel = naam.toLowerCase();
    if (bekend.has(sleutel)) { dubbel.push(naam); return; }
    bekend.add(sleutel);
    spelers.push({ naam, hcp: hcp === null ? 0 : hcp });
  });

  return { spelers, dubbel, leeg };
}

// v5.21.0: dit venster doet nu twee dingen. Bij een OPGESLAGEN toernooi schrijft
// het de gasten weg naar de database; op het AANMAAKSCHERM zet het ze in je
// selectie, want daar bestaat het toernooi nog niet. Het uitlezen van je
// geplakte lijst (gastenUitTekst) is in beide gevallen hetzelfde.
function openGastenPlakken(modus) {
  window._gastenPlakModus = modus === 'setup' ? 'setup' : 'toernooi';
  if (window._gastenPlakModus !== 'setup' && !toernooiData) return;
  const vak = document.getElementById('gasten-plak-tekst');
  if (vak) vak.value = '';
  toonGastenPlakTelling();
  document.getElementById('modal-gasten-plakken').classList.add('open');
}
window.openGastenPlakken = openGastenPlakken;

// Wat hij van je lijst maakt, terwijl je plakt. Zonder deze regel weet je pas
// ná het toevoegen dat er vier namen niet meetelden.
function toonGastenPlakTelling() {
  const uit = document.getElementById('gasten-plak-telling');
  if (!uit) return;
  const tekst = document.getElementById('gasten-plak-tekst')?.value || '';
  const { spelers, dubbel } = gastenUitTekst(tekst, _gastenPlakBestaandeNamen());
  if (!tekst.trim()) { uit.textContent = 'Plak hierboven je lijst.'; return; }
  const delen = [`${spelers.length} speler${spelers.length === 1 ? '' : 's'}`];
  if (dubbel.length) delen.push(`${dubbel.length} dubbel, wordt overgeslagen (${dubbel.join(', ')})`);
  uit.textContent = delen.join(' · ');
}
window.toonGastenPlakTelling = toonGastenPlakTelling;

// Wie doet er al mee? Op het aanmaakscherm is dat je selectie, bij een
// opgeslagen toernooi de deelnemerslijst.
function _gastenPlakBestaandeNamen() {
  return window._gastenPlakModus === 'setup'
    ? (_tGeselecteerdeSpelers || []).map(sp => sp.naam)
    : (toernooiData?.spelers || []).map(sp => sp.naam);
}

async function startGastenPlakken() {
  try {
    const tekstSetup = document.getElementById('gasten-plak-tekst')?.value || '';
    if (window._gastenPlakModus === 'setup') {
      const { spelers, dubbel } = gastenUitTekst(tekstSetup, _gastenPlakBestaandeNamen());
      if (spelers.length === 0) {
        toast(dubbel.length ? 'Deze namen staan al in je selectie' : 'Geen spelers herkend in wat je plakte');
        return;
      }
      spelers.forEach(({ naam, hcp }) => {
        const gastId = 'gast_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        store._tGeselecteerdeSpelers.push({ uid: gastId, naam, hcp, gast: true });
      });
      slaToernooiConceptOp();
      renderTGeselecteerdeSpelers();
      closeModal('modal-gasten-plakken');
      toast(`${spelers.length} gastspeler(s) toegevoegd aan je selectie ✓`
        + (dubbel.length ? ` — ${dubbel.length} dubbele naam overgeslagen` : ''), 6000);
      return;
    }

    const t = toernooiData;
    if (!t || !actieveToernooiId) return;
    const tekst = tekstSetup;
    const { spelers, dubbel } = gastenUitTekst(tekst, (t.spelers || []).map(sp => sp.naam));
    if (spelers.length === 0) {
      toast(dubbel.length ? 'Deze namen doen al mee' : 'Geen spelers herkend in wat je plakte');
      return;
    }
    // ⚠ Eén schrijfactie voor de hele lijst. Per speler wegschrijven zou bij
    // veertig gasten veertig keer het hele toernooidocument overschrijven, en
    // dan wint de laatste die klaar is — precies de fout uit v5.12.4.
    spelers.forEach(({ naam, hcp }) => {
      const gastId = 'gast_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      t.spelers.push({ uid: gastId, naam, hcp, gast: true });
      // v5.19.0: ze komen in de spelerspool, niet in een flight. Veertig gasten
      // in één keer indelen doe je op de dag met ⇄ Verdelen.
      (t.dagen || []).forEach(dag => {
        dag.scores[gastId] = Array(dag.holes.length).fill(null);
      });
    });

    herschikMarkers(t);
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
    closeModal('modal-gasten-plakken');
    renderToernooiActief();
    toast(`${spelers.length} gastspeler(s) toegevoegd ✓`
      + (dubbel.length ? ` — ${dubbel.length} dubbele naam overgeslagen` : '')
      + ' — geef ze een inlog met "Gastlogins aanmaken"', 8000);
  } catch(e) { toernooiFout('Gasten plakken', e); }
}
window.startGastenPlakken = startGastenPlakken;

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
    herschikMarkers(toernooiData);   // v5.11.6
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

// ⚠ v5.19.0: dit keek naar ALLE deelnemers van het toernooi. Sinds de
// spelerspool bestaat kan iemand meedoen zonder op deze dag ingedeeld te zijn —
// en die heeft dus lege scores. Daarmee bleef de knop "Uitslag dag N" voor
// altijd op "(scores onvolledig)" staan, zonder dat iets vertelde waarom. Nu
// telt wie op DEZE dag in een flight staat. Heeft de dag geen flights, dan
// gelden alle spelers, zoals voorheen.
function alleScoresIngevuld(t, dag) {
  dag = dag || actieveDag(t);
  if (!dag || !t || !t.spelers || t.spelers.length === 0) return false;
  const ingedeeld = new Set((dag.flights || []).flatMap(f => f.spelerIds || []));
  const meedoen = ingedeeld.size > 0 ? t.spelers.filter(s => ingedeeld.has(s.uid)) : t.spelers;
  if (meedoen.length === 0) return false;
  return meedoen.every(s =>
    (dag.holes || []).every((_, i) => {
      const val = dag.scores?.[s.uid]?.[i];
      return val !== null && val !== undefined && val !== '';
    })
  );
}

// ============================================================
//  NAVIGATIE HELPERS
// ============================================================

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

  // ============================================================
  //  ÉÉN RIJ TABBLADEN  (v5.13.1)
  // ------------------------------------------------------------
  //  WAT ER MIS WAS. Er stonden TWEE rijen dagtabbladen op dit scherm: hier
  //  `Dag 1 · Dag 2 · + Dag toevoegen`, en verderop binnen het klassement nog
  //  een rij `Dag 1 · Dag 2 · Totaal`. Twee keer dezelfde vraag, en het
  //  klassement kon een andere dag tonen dan de rest van het scherm.
  //
  //  Nu één rij: [Toernooi] [Dag 1] [Dag 2] [+ Dag]. Tabblad 0 is het toernooi
  //  als geheel — klassement over alle dagen, gastlogins, afsluiten. Een
  //  dagtabblad toont alles van díe dag. Zie ONTWERP-TOERNOOISCHERM.md.
  //
  //  ⚠ Je landt op de ACTIEVE DAG, niet op het overzicht. De scorekaart staat
  //  daarmee nog steeds meteen in beeld, zoals altijd.
  const toonToernooiTab = window._tTabblad === 0;
  // v5.17.0: het derde tabblad. Alleen de coordinator ziet hem; een deelnemer
  // kan geen spelers toevoegen of verwijderen, dus bij hem bestaat hij niet.
  const toonSpelersTab = isBeheerder && window._tTabblad === 'spelers';
  let dagTabsHtml = `<div style="display:flex;gap:6px;overflow-x:auto;padding:10px 16px 0;scrollbar-width:none;border-bottom:1px solid var(--border)">
    <button onclick="selecteerDag(0)"
      style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px solid ${toonToernooiTab ? 'var(--gold)' : 'var(--border)'};border-bottom:none;background:${toonToernooiTab ? 'var(--gold)' : 'transparent'};color:${toonToernooiTab ? 'white' : 'var(--mid)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
      Toernooi
    </button>`;
  if (isBeheerder) {
    dagTabsHtml += `<button onclick="selecteerSpelersTab()"
      style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px solid ${toonSpelersTab ? 'var(--gold)' : 'var(--border)'};border-bottom:none;background:${toonSpelersTab ? 'var(--gold)' : 'transparent'};color:${toonSpelersTab ? 'white' : 'var(--mid)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
      Spelers
    </button>`;
  }
  (t.dagen || []).forEach(d => {
    const actief = !toonToernooiTab && !toonSpelersTab && d.dagNr === dagNr;
    const kleur = d.afgerond ? 'var(--mid)' : 'var(--green)';
    dagTabsHtml += `<button onclick="selecteerDag(${d.dagNr})"
      style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px solid ${actief ? kleur : 'var(--border)'};border-bottom:none;background:${actief ? kleur : 'transparent'};color:${actief ? 'white' : 'var(--mid)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
      Dag ${d.dagNr}${d.afgerond ? ' ✓' : ''}
    </button>`;
  });
  // v5.9.1: "+ Dag toevoegen" is er voor de coordinator altijd. Merk je bij het
  // aanmaken dat het toernooi twee dagen duurt in plaats van één, dan was de
  // enige uitweg anders het hele toernooi weggooien en opnieuw instellen.
  if (isBeheerder) {
    dagTabsHtml += `<button onclick="openNieuweDagModal()"
      style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px dashed var(--border);border-bottom:none;background:transparent;color:var(--green);font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif">
      + Dag toevoegen
    </button>`;
  }
  dagTabsHtml += '</div>';

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
          <span class="badge badge-gold">${toernooiWacht(t) ? 'Wacht' : dagAfgerond ? 'Dag afgesloten' : uitslag ? 'Uitslag' : 'Bezig'}</span>
        </div>
      </div>
      <div class="card-body" style="padding:10px 16px;font-size:13px;color:var(--mid)">
        Dag ${dagNr} · ${esc(dag.datum)} · ${esc(dag.baan)} · ${dag.holes.length} holes · ${t.spelers.length} spelers
        ${flights.length > 1 ? ` · ${flights.length} flights` : ''}
        ${!isBeheerder && mijnFlight ? ` · <strong style="color:var(--green)">${esc(mijnFlight.naam)}</strong>` : ''}
      </div>
    </div>`;

  // v5.12.2: het KLASSEMENT volgt dezelfde schakelaar als de onderlinge stand,
  // en krijgt eindelijk een kop.
  //
  // ⚠ WAT ER MIS WAS, en waarom het zo lang duurde voor we het doorhadden.
  // Dit blok had geen naam op het scherm. Het enige blok met een kop in de
  // buurt heet "Onderlinge stand" — het namenrooster. Sierk vroeg in v5.11.1
  // om "het onderlinge stand blokje dat aan/uit gezet moet worden" en bedoelde
  // dít blok; de schakelaar is toen op het rooster ernaast gebouwd. Beiden
  // dachten hetzelfde te bedoelen. Sierk, 13 september 2026: "met onderlinge
  // stand heb ik steeds het klassement bedoeld."
  //
  // Daarom staat er nu een kop boven. Een blok zonder naam is een blok waar je
  // niet over kunt praten.
  const standZichtbaar = isBeheerder || !t.matrixVerborgen;
  // v5.13.1: op het tabblad "Toernooi" is het klassement de hoofdzaak, dus daar
  // staat het er altijd. Op een dagtabblad geldt de oude regel: pas als de
  // uitslag vrij is, de dag is afgesloten, of het strokeplay is.
  const ranglijstKaart = (standZichtbaar && (toonToernooiTab || uitslag || dagAfgerond || dagModus(t, dag) === 'strokeplay')) ? `
    <div class="card">
      <div class="card-header">
        <h2>Klassement</h2>
        ${isBeheerder && t.matrixVerborgen ? '<span style="font-size:11px;color:var(--mid)">· niet zichtbaar voor deelnemers</span>' : ''}
      </div>
      <!-- v5.13.1: hier stond een TWEEDE rij dagtabbladen. Het klassement volgt
           nu het tabblad bovenaan: op "Toernooi" het totaal over alle dagen, op
           een dagtabblad de stand van die dag. -->
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
  //
  // v5.12.2: diezelfde schakelaar dekt sindsdien ook het klassement hierboven.
  // Het veld heet nog `matrixVerborgen` en dat blijft zo: hernoemen zou elk
  // lopend toernooi de instelling kosten. Lees het als "de stand is verborgen".
  const matrixKaart = (dagModus(t, dag) !== 'strokeplay' && standZichtbaar) ? `
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

  // ============================================================
  //  GEEN SCOREKAART ZOLANG DE DAG CONCEPT IS  (v5.14.0)
  // ------------------------------------------------------------
  //  ⚠ De afscherming zit HIER, in het samenstellen — niet in de scorekaart
  //  zelf. renderTScorecard() heeft een eigen uitgang als zijn container
  //  ontbreekt (`if (!scorecardWrap) return;`), dus die functie en de negen
  //  andere van de speler/marker/coordinator-logica blijven onaangeraakt.
  //  Zie ONTWERP-TOERNOOISCHERM.md, hoofdstuk 5.
  const gestart = dagIsGestart(dag);
  const nogNietGestartKaart = `
    <div class="card">
      <div class="card-header"><h2>Dag ${dagNr} is nog niet gestart</h2></div>
      <div class="card-body" style="font-size:13px;color:var(--mid)">
        ${esc(dag.datum)} · ${esc(dag.baan)} · ${dag.holes.length} holes · ${t.spelers.length} spelers
        <br><br>
        De scorekaart gaat open zodra je de dag start. Tot dat moment kun je
        datum, baan, holes, speelwijze, tijd, punten en handicap nog wijzigen.
        ${isBeheerder ? '' : '<br><br>De wedstrijdleiding start de dag.'}
      </div>
      ${isBeheerder && flights.length === 0 ? `
      <!-- v5.9.1: een dag zonder indeling moet dat ZEGGEN, anders is het niet te
           onderscheiden van een storing. v5.14.0: die melding hoort nu ook hier,
           want een concept-dag toont geen scorekaart waar hij eerst in stond. -->
      <div style="background:var(--gold-pale);border-radius:8px;padding:10px 12px;margin:0 16px 12px;font-size:12px;color:var(--gold);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="flex:1;min-width:180px">⚑ Dag ${dagNr} is nog niet in flights ingedeeld.</span>
        <button class="btn btn-sm btn-ghost" onclick="openFlightIndelingDag()">✈ Nu indelen</button>
      </div>` : ''}
      ${isBeheerder ? `
      <div style="padding:0 16px 16px">
        <button class="btn btn-primary btn-block" onclick="startDag()">
          ▶ Dag ${dagNr} starten
        </button>
      </div>` : ''}
    </div>`;

  const echteScorecardKaart = `
    <div class="card">
      <div class="card-header inklapbaar ${dagAfgerond ? 'ingeklapt' : ''}" onclick="toggleAdminKaart(this)">
        <h2>${scorecardTitel}</h2>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          ${isBeheerder ? `
            <button id="t-refresh-btn" class="btn btn-sm btn-ghost" onclick="refreshToernooiScorekaart()" style="display:none;background:var(--gold);color:white;border-color:var(--gold)">↺ Nieuw</button>
            <!-- v5.20.0: hier zat "✈ Flights". Deze kop bestaat alleen als de
                 dag GESTART is, dus op een conceptdag was de knop er niet en
                 kon je niet indelen. Sierk, 14 september 2026: "maak het
                 eenduidig." Hij staat nu bij de dagknoppen, op elke dag op
                 dezelfde plek. -->
            <!-- v5.17.0: hier zat "👥 Spelers". Die knop is verhuisd naar het
                 tabblad Spelers — zie selecteerSpelersTab(). Hier was hij pas
                 bereikbaar zodra de dag gestart was, en dat is precies te laat. -->
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

  // ============================================================
  //  DE KNOPPEN, GESPLITST  (v5.13.1)
  // ------------------------------------------------------------
  //  Ze stonden in één lijst door elkaar: "Dag 2 wijzigen" naast "Toernooi
  //  afsluiten". Nu staat elke knop op het tabblad waar hij hoort. De inhoud
  //  van elke knop is LETTERLIJK overgenomen — alleen de groepering is nieuw.
  // v5.14.0: zolang de dag concept is staat de startknop in het blok hierboven;
  // de scorekaart komt daarvoor in de plaats.
  const scorecardKaart = gestart ? echteScorecardKaart : nogNietGestartKaart;

  const dagKnoppen = isBeheerder ? `
    <div style="padding:0 0 16px">
      <!-- ============================================================
           ✈ FLIGHTS — ÉÉN PLEK  (v5.20.0)
           ------------------------------------------------------------
           Eén regel: indelen hoort bij de dag en de knop staat er altijd,
           concept of gestart. Daarvoor zat hij in de kop van de scorekaart —
           die bestaat alleen bij een gestarte dag, dus op een dag die je later
           toevoegde kwam je er niet bij.

           ⚠ De enige uitzondering is een AFGESLOTEN dag. De uitslag is dan
           gepubliceerd; de indeling omgooien zou die met terugwerkende kracht
           veranderen. Diezelfde grens gold al.
           ============================================================ -->
      ${!dagAfgerond ? `
      <button id="t-flights-btn" class="btn btn-ghost btn-block" onclick="openFlightIndelingDag()" style="margin-bottom:8px">
        ✈ Flights van dag ${dagNr} indelen
      </button>
      ` : ''}
      ${gestart && !dagAfgerond ? `
      <button class="btn btn-ghost btn-block" onclick="zetDagTerugNaarConcept()" style="margin-bottom:8px">
        ↩ Dag ${dagNr} terugzetten naar concept
      </button>
      <p style="font-size:11px;color:var(--light);margin:-4px 0 10px">
        De instellingen worden weer aanpasbaar en de scorekaart gaat dicht.
        Ingevulde scores blijven bewaard.
      </p>
      ` : ''}
      ${!dagIsGestart(dag) ? `
      <button class="btn btn-ghost btn-block" onclick="openDagBewerkenModal()" style="margin-bottom:8px">
        ✏️ Dag ${dagNr} wijzigen (datum, baan, holes)
      </button>
      ` : ''}
      ${gestart && !dagAfgerond && !uitslag ? `
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
    </div>
    ` : '';

  // v5.17.0: het tabblad SPELERS. De lijst, de knop naar "Spelers beheren" en de
  // twee gastloginknoppen — die laatste stonden op het tabblad Toernooi, maar
  // gaan over mensen, niet over het toernooi als geheel. Elk blok is letterlijk
  // overgenomen; alleen de plek is nieuw.
  const spelersKaart = isBeheerder ? `
    <div class="card">
      <div class="card-header">
        <h2>Spelers</h2>
        <span style="font-size:12px;color:var(--mid)">${(t.spelers || []).length}</span>
      </div>
      <div class="card-body" style="padding:4px 16px 14px">
        <div id="t-spelers-lijst">${spelerRijenHtml(t)}</div>
        <button class="btn btn-primary btn-block" style="margin-top:12px"
          onclick="openToernooiSpelersBeheer()">+ Speler toevoegen of verwijderen</button>
        <button class="btn btn-ghost btn-block" style="margin-top:8px"
          onclick="openGastenPlakken()">⬆ Gasten plakken (lijst uit Excel)</button>
      </div>
    </div>
    <div style="padding:0 0 16px">
      ${(t.spelers || []).some(sp => sp.gast && !sp.login) && !IS_TEST ? `
      <button class="btn btn-secondary btn-block" onclick="maakOntbrekendeGastlogins()" style="margin-bottom:8px">
        ⌨ Gastlogins aanmaken (${(t.spelers || []).filter(sp => sp.gast && !sp.login).length} zonder inlog)
      </button>
      ` : ''}
      ${(t.spelers || []).some(sp => sp.login) ? `
      <button class="btn btn-ghost btn-block" onclick="toonGastlogins()" style="margin-bottom:8px">
        ⌨ Gastlogins tonen (${(t.spelers || []).filter(sp => sp.login).length})
      </button>
      ` : ''}
    </div>
    ` : '';

  const toernooiKnoppen = isBeheerder ? `
    <div style="padding:0 0 16px">
      ${heeftGeenScores(t) ? `
      <button class="btn btn-secondary btn-block" onclick="bewerkToernooi()" style="margin-bottom:8px">
        ↺ Toernooi opnieuw instellen
      </button>
      <p style="font-size:11px;color:var(--light);margin:-4px 0 10px">
        Het huidige toernooi wordt verwijderd en alle instellingen komen terug in het
        aanmaakscherm. Voor alleen een dag erbij of een andere baan: gebruik de knoppen hierboven.
      </p>
      ` : ''}
      ${heeftStrokeplayDag(t) && (t.rankingLadderIds?.length > 0 || t.ladderId) ? `
      <div style="padding:8px 12px;background:var(--gold-pale);border-radius:8px;margin-bottom:8px;font-size:12px;color:var(--gold)">
        ⚠ Er zit een <strong>strokeplay-dag</strong> in dit toernooi. De ladderstand
        wordt daarom niet bijgewerkt bij het afsluiten.
      </div>
      ` : ''}
      ${dagAfgerond && (t.dagen || []).every(d => d.afgerond) ? `
      <button class="btn btn-gold btn-block" onclick="openToernooiAfsluiten()" style="margin-bottom:8px">
        🏅 Toernooi afsluiten${!heeftStrokeplayDag(t) && (t.rankingLadderIds?.length > 0 || t.ladderId) ? ' & ladder bijwerken' : ''}
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
          <span><strong>Stand tonen aan deelnemers</strong><br><span style="font-size:11px;color:var(--mid)">Uit: het klassement én de onderlinge stand staan alleen bij jou. Jij ziet ze altijd.</span></span>
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

  // ============================================================
  //  WAT STAAT ER OP WELK TABBLAD  (v5.13.1)
  // ------------------------------------------------------------
  //  Toernooi : naam, klassement over alle dagen, meekijklink,
  //             opnieuw instellen, afsluiten, annuleren.
  //  Spelers  : de spelerslijst met inlognamen, toevoegen/verwijderen,
  //             gastlogins aanmaken en tonen.            (v5.17.0)
  //  Dag N    : dagstand, onderlinge stand, scorekaart, en de dagknoppen.
  //
  //  ⚠ Elk blok is ONGEWIJZIGD; alleen de volgorde en de groepering zijn nieuw.
  //  De scorekaart is verplaatst, niet herschreven — zie
  //  ONTWERP-TOERNOOISCHERM.md, hoofdstuk 5.
  //
  //  v3.0.0-11.106: binnen een dagtabblad verschilt de volgorde per rol. De
  //  speler ziet zijn scorekaart bovenaan, de coordinator eerst de standen.
  if (toonSpelersTab) {
    // v5.17.0: geen scorekaart en geen klassement op dit tabblad. De renderaars
    // hieronder zoeken hun eigen element op en doen niets als het er niet is —
    // precies zoals op het tabblad Toernooi.
    detail.innerHTML = dagTabsHtml + titelKaart + spelersKaart;
  } else if (toonToernooiTab) {
    detail.innerHTML = dagTabsHtml + titelKaart + ranglijstKaart + liveLinkKnop + toernooiKnoppen;
  } else if (isBeheerder) {
    detail.innerHTML = dagTabsHtml + titelKaart + ranglijstKaart + matrixKaart + scorecardKaart + dagKnoppen;
  } else {
    detail.innerHTML = dagTabsHtml + titelKaart + scorecardKaart + ranglijstKaart + matrixKaart;
  }

  renderTScorecard();

  // v5.13.1: het klassement volgt het tabblad — 0 is het totaal over alle dagen.
  if (toonToernooiTab || uitslag || dagAfgerond || dagModus(t, dag) === 'strokeplay') {
    selecteerRanglijstDag(toonToernooiTab ? 0 : dagNr);
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
  // v5.13.1: het klassement had een eigen rij tabbladen; die is weg en het
  // volgt nu de rij bovenaan. Wat hier stond om die knoppen te kleuren is
  // daarmee vervallen. De functie blijft bestaan omdat hij op window staat en
  // de keuze van welke dag getoond wordt nog wél nodig is.
  window._ranglijstDagNr = dagNr;
  if (!toernooiData) return;
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
  //   kijker  alleen kijken — de score staat er wel, invullen kan niet
  // Wie waar mag TYPEN volgt zo uit de markerindeling; zien doet iedereen
  // alles binnen zijn eigen flight (v5.11.8).
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
    const rol = rollen[s.uid];
    const merk = rol === 'marker' ? ' <span title="Jij markeert deze speler" style="color:var(--green)">✔</span>' : '';
    // v5.11.9: op de tweede regel stond de ACHTERNAAM, en bij iemand zonder
    // achternaam de handicap. Sierk, 13 september 2026: "de naam van een niet
    // gast staat voluit op de scorekaart. moet zijn alleen voornaam zoals bij
    // de gastspelers." Nu staat daar altijd de handicap — die stond er bij een
    // gast toch al, en het is de enige plek waar de coordinator hem kan
    // wijzigen (aantikken). Boven staat de korte unieke naam: Arjan V, Arjan R.
    html += `<th class="player-col" style="max-width:70px">
      <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px" title="${esc(s.naam)}">${esc(korteNamen[s.uid] || s.naam.split(' ')[0])}${merk}</span>
      <span class="hole-par" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px;${isBeheerder&&!dagAfgerond?'cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)':''}" ${isBeheerder&&!dagAfgerond?`onclick="editToernooiHcp('${escAttr(s.uid)}')"`:''}>
        hcp ${Math.round(Number(s.hcp) || 0)}
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
      //
      // v5.11.8: de kolom van een flightgenoot die je NIET markeert stond op
      // puntjes. Sierk, 13 september 2026: "de scores van je flightgenoten moet
      // je wel kunnen zien." Op de baan wil je weten hoe de anderen ervoor
      // staan. Invullen blijft je eigen kolom en die van je marker-speler; die
      // van de rest lees je alleen, mét kleur, zodat je ook ziet of hij al
      // gecontroleerd is.
      const opSlot = dagAfgerond || rol === 'kijker' || (o.vast && rol !== 'beheer');
      if (opSlot) {
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
    // v5.11.8: ook hier geen puntjes meer — iedereen ziet ieders totaal.
    const scores = dag.scores?.[s.uid] || [];
    const filled = scores.filter(v => v !== null && v !== undefined);
    const tot = filled.length ? filled.reduce((a,b) => a+Number(b), 0) : null;
    html += `<td data-speler-id="${s.uid}" style="font-family:'DM Mono',monospace;font-weight:700;text-align:center">${tot !== null ? tot : '—'}</td>`;
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
  if (actieveDag()?.uitslagZichtbaar || dagModus(toernooiData, actieveDag()) === 'strokeplay') renderTRanglijst();
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
// v5.13.0 — DE INSTELLINGEN STAAN PER DAG.
//  Tot v5.12.8 gold één puntentelling en één handicappercentage voor het hele
//  toernooi. Sierk wilde per dag kunnen kiezen: een dag met 2/0/-2 en een dag
//  met 3/1/0 in hetzelfde toernooi.
//
//  ⚠ Altijd met terugval op de toernooibrede waarde. Een toernooi van vóór
//  v5.13.0 heeft deze velden niet op de dag staan en rekent daardoor EXACT
//  zoals het altijd deed. Dat is met opzet: er draaien toernooien.
//
//  `?? ` en niet `||`: een puntenwaarde van 0 (gelijkspel levert vaak 0 op) is
//  een geldige keuze en mag niet als "niet ingevuld" gelezen worden.
function dagInstelling(dag, t, veld, standaard) {
  const opDag = dag && dag[veld];
  if (opDag !== undefined && opDag !== null && opDag !== '') return Number(opDag);
  const opToernooi = t && t[veld];
  if (opToernooi !== undefined && opToernooi !== null && opToernooi !== '') return Number(opToernooi);
  return standaard;
}

function berekenTPuntenVoorDag(t, dag) {
  if (!dag) return { punten: [], won: [], tied: [], lost: [], matrix: [], standen: [] };
  const dagPtWin  = dagInstelling(dag, t, 'ptWin',  2);
  const dagPtTie  = dagInstelling(dag, t, 'ptTie',  0);
  const dagPtLoss = dagInstelling(dag, t, 'ptLoss', -2);
  const dagHcpPct = dagInstelling(dag, t, 'hcpPct', 0.75);
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
        // v5.13.0: de handicapverrekening staat per DAG. Ontbreekt hij op de
        // dag — elk toernooi van vóór v5.13.0 — dan geldt de toernooibrede
        // waarde en verandert er dus niets aan een bestaand toernooi.
        const { ontvanger, slagOpHole } = getTHcpSlagen(sA, sB, hole, dagHcpPct, dag.holes.length);
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
        punten[i] += dagPtWin; punten[j] += dagPtLoss;
        won[i]++; lost[j]++;
        matrix[i][j] = 'W'; matrix[j][i] = 'L';
      } else if (standA < 0) {
        punten[j] += dagPtWin; punten[i] += dagPtLoss;
        won[j]++; lost[i]++;
        matrix[i][j] = 'L'; matrix[j][i] = 'W';
      } else {
        punten[i] += dagPtTie; punten[j] += dagPtTie;
        tied[i]++; tied[j]++;
        matrix[i][j] = 'T'; matrix[j][i] = 'T';
      }
    }
  }
  return { punten, won, tied, lost, matrix, standen };
}

// berekenTPunten: voor matrix/ranglijst — gebruikt actieve dag of totaal
// ============================================================
//  SPEELWIJZE PER DAG EN DAGPUNTEN — v5.12.0
// ============================================================
//  Tot v5.11.9 stond de speelwijze op het TOERNOOI: één keuze matchplay of
//  strokeplay voor alle dagen. Sierk wilde dag 1 strokeplay en dag 2 matchplay.
//  Nu staat `modus` op de DAG; staat hij daar niet (elk bestaand toernooi), dan
//  geldt die van het toernooi. Zo verandert er aan lopende toernooien niets.
//
//  ⚠ Twee speelwijzen zijn niet zomaar op te tellen. Een dag stableford levert
//  ~36 punten op, een dag matchplay ~2. De gemeenschappelijke munt is de PLAATS
//  van die dag:
//
//      punten = aantal spelers dat die dag meedeed − plaats + 1
//
//  Bij 9 spelers krijgt de winnaar er 9 en de laatste 1. Wie gelijk eindigt
//  deelt het gemiddelde van die plaatsen. De prijs: binnen een dag verdwijnt de
//  marge — vijf partijen winnen of drie geeft allebei "eerste plaats". Dat is
//  wat vergelijkbaar maken bétekent; elke andere keuze laat één speelwijze
//  zwaarder wegen.
// ============================================================
function dagModus(t, dag) {
  return (dag && dag.modus) || t?.modus || 'matchplay';
}

function heeftStrokeplayDag(t) {
  return (t?.dagen || []).some(d => dagModus(t, d) === 'strokeplay');
}

function gemengdeSpeelwijzen(t) {
  return new Set((t?.dagen || []).map(d => dagModus(t, d))).size > 1;
}

// Zet één dagklassement om in dagpunten. `sleutels` is per speler een getal
// waarbij LAGER beter is, of null voor wie die dag niet meedeed.
// v5.15.0 — PUNTEN PER PLAATS, OPTIONEEL PER DAG
//  Leest "10, 7, 5, 3, 1" uit en geeft [10,7,5,3,1]. Puntkomma's, spaties en
//  nieuwe regels mogen ook; wat geen getal is valt weg. Levert dat niets op,
//  dan null — en dan geldt de standaardreeks.
//
//  ⚠ Negatieve punten mogen: een laatste plek die punten kost is een geldige
//  wedstrijdkeuze, net als de -2 bij matchplay.
function plaatsPuntenUitTekst(tekst) {
  if (Array.isArray(tekst)) {
    const lijst = tekst.map(Number).filter(Number.isFinite);
    return lijst.length > 0 ? lijst : null;
  }
  if (typeof tekst !== 'string') return null;
  const lijst = tekst.split(/[^0-9.,\-]+|,(?=\s)|;/)
    .join(' ').split(/[\s,;]+/)
    .map(d => d.trim()).filter(Boolean)
    .map(Number).filter(Number.isFinite);
  return lijst.length > 0 ? lijst : null;
}

// Wat is plek `plaats` waard? Zonder tabel de aflopende reeks (bij n spelers
// krijgt plek 1 er n, plek 2 er n-1, ...). Mét tabel wat er in de tabel staat;
// voorbij de tabel is het 0.
//
// ⚠ Voorbij de tabel 0 en niet "doortellen": een coordinator die 10,7,5 invult
// bedoelt dat plek 4 en verder niets opleveren. Doortellen zou daar stilletjes
// punten van maken. Het scherm toont deze regel ook letterlijk.
function puntenVoorPlaats(plaats, n, tabel) {
  if (Array.isArray(tabel) && tabel.length > 0) {
    return plaats >= 1 && plaats <= tabel.length ? tabel[plaats - 1] : 0;
  }
  return n - plaats + 1;
}

function dagPuntenUitSleutels(sleutels, tabel) {
  const uit = new Array((sleutels || []).length).fill(0);
  const mee = (sleutels || []).map((sl, i) => ({ i, sl }))
    .filter(x => x.sl !== null && x.sl !== undefined && Number.isFinite(x.sl));
  const n = mee.length;
  if (n === 0) return uit;

  mee.sort((a, b) => a.sl - b.sl);
  let plaats = 1;
  for (let k = 0; k < mee.length; ) {
    let m = k;
    while (m + 1 < mee.length && mee[m + 1].sl === mee[k].sl) m++;
    const groep = mee.slice(k, m + 1);
    let som = 0;
    // Gedeelde plekken delen de som van de plekken die ze samen bezetten —
    // ongewijzigd sinds v5.12.0, nu alleen met een instelbare waarde per plek.
    for (let p = plaats; p < plaats + groep.length; p++) som += puntenVoorPlaats(p, n, tabel);
    const gedeeld = som / groep.length;
    groep.forEach(x => { uit[x.i] = gedeeld; });
    plaats += groep.length;
    k = m + 1;
  }
  return uit;
}

// De dagpunten van één dag, volgens de speelwijze van díé dag.
//
// ⚠ Bij strokeplay telt STABLEFORD, ook als het scherm op bruto of netto staat.
// Anders zou het eindklassement veranderen zodra iemand een knop omzet, en
// stableford is de enige telling die handicaps eerlijk meeweegt.
function dagPunten(t, dag) {
  if (!t || !dag) return new Array((t?.spelers || []).length).fill(0);
  if (dagModus(t, dag) === 'strokeplay') {
    const res = berekenStrokeplayRanglijstVoorDag(t, dag);
    // v5.15.0: alleen een STROKEPLAY-dag kan een eigen puntentabel hebben.
    // Sierk, 14 september 2026: "Matchplay kan ik al per dag instellen. Optie
    // tabel voor strokeplay." Bij matchplay bepaalt winst/gelijk/verlies de
    // volgorde binnen de dag; de plaatspunten blijven daar de standaardreeks.
    return dagPuntenUitSleutels((t.spelers || []).map((s, i) => {
      const r = res[i];
      return (r && r.holes > 0) ? -(r.stableford ?? 0) : null;
    }), plaatsPuntenUitTekst(dag.plaatsPunten));
  }
  const res = berekenTPuntenVoorDag(t, dag);
  return dagPuntenUitSleutels((t.spelers || []).map((s, i) =>
    (res.won[i] + res.tied[i] + res.lost[i]) > 0 ? -res.punten[i] : null));
}

// Dagpunten van alle dagen, plus het totaal per speler.
function dagPuntenTotaal(t) {
  const n = (t?.spelers || []).length;
  const totaal = new Array(n).fill(0);
  const perDag = [];
  (t?.dagen || []).forEach(dag => {
    const p = dagPunten(t, dag);
    perDag.push(p);
    for (let i = 0; i < n; i++) totaal[i] += p[i];
  });
  return { totaal, perDag };
}

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

// ============================================================
//  MATCHPLAY — WIE STAAT BOVEN BIJ EEN GELIJKE STAND?  (v5.11.8)
// ============================================================
//  ⚠ WAT ER MIS WAS. De volgorde was `punten, dan aantal winsten` en daarna
//  NIETS: bij gelijke punten én winsten besliste de volgorde waarin de spelers
//  aan het toernooi waren toegevoegd. Dat is niet uit te leggen aan de nummer
//  twee. Erger: de ladderstand na afloop werd nog eens apart op alleen punten
//  gesorteerd, dus die kon een ándere volgorde krijgen dan het scherm toonde.
//
//  De regel nu, in deze vololgorde:
//    1. punten
//    2. het ONDERLINGE resultaat — heeft de een de ander verslagen, dan staat
//       die boven. Alleen bij precies TWEE gelijk geëindigde spelers: bij drie
//       of meer kan A van B winnen, B van C en C van A, en dan bestaat er geen
//       volgorde die klopt. Dan meteen door naar 3.
//    3. aantal gewonnen partijen
//    4. de laagste handicap — Sierk, 13 september 2026
//  Blijft het daarna nog gelijk (zelfde handicap), dan is het ECHT gelijk; die
//  spelers worden gemerkt in plaats van willekeurig op volgorde gezet.
//
//  `matrix[i][j]` is het resultaat van speler i tegen speler j: W, L of T.
// ============================================================
function matchplayVolgorde(entries, matrix) {
  const perPunten = new Map();
  (entries || []).forEach(e => {
    if (!perPunten.has(e.pt)) perPunten.set(e.pt, []);
    perPunten.get(e.pt).push(e);
  });

  const uit = [];
  [...perPunten.keys()].sort((a, b) => b - a).forEach(pt => {
    const groep = perPunten.get(pt);

    // Precies twee gelijk: het onderlinge resultaat beslist, als dat er is.
    if (groep.length === 2) {
      const res = matrix?.[groep[0].i]?.[groep[1].i];
      if (res === 'W') { uit.push(groep[0], groep[1]); return; }
      if (res === 'L') { uit.push(groep[1], groep[0]); return; }
    }

    const gesorteerd = [...groep].sort((a, b) =>
      (b.w - a.w) || (hcpVan(a) - hcpVan(b)));
    // Wie op ALLES gelijk eindigt staat echt gelijk; dat hoort zichtbaar te zijn.
    gesorteerd.forEach(e => {
      e.gelijk = gesorteerd.some(x => x !== e && x.w === e.w && hcpVan(x) === hcpVan(e));
    });
    uit.push(...gesorteerd);
  });
  return uit;
}

// De handicap waarmee in dit toernooi gespeeld wordt. Ontbreekt hij, dan achteraan.
function hcpVan(entry) {
  const h = Number(entry?.s?.hcp);
  return Number.isFinite(h) ? h : 999;
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

// v5.12.0: het eindklassement als de dagen niet dezelfde speelwijze hebben.
// Per dag de dagpunten, en het totaal daarvan — zie de uitleg bij dagPunten().
// De dagkolommen staan erbij zodat de uitslag na te rekenen is; een totaal dat
// je niet kunt narekenen wordt niet vertrouwd, en terecht.
function renderTDagpuntenRanglijst(t, el) {
  const { totaal, perDag } = dagPuntenTotaal(t);
  const dagen = t.dagen || [];
  const volgorde = (t.spelers || [])
    .map((s, i) => ({ s, i, pt: totaal[i] }))
    .sort((a, b) => b.pt - a.pt || hcpVan(a) - hcpVan(b));

  const getal = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');

  el.innerHTML =
    `<div style="font-size:11px;color:var(--light);padding:6px 10px;border-bottom:1px solid var(--border)">
       <strong>Totaal · dagpunten</strong> — per dag: aantal spelers − plaats + 1
     </div>` +
    volgorde.map((entry, rank) => `
      <div class="ladder-item">
        <div class="rank-badge ${rank < 3 ? 'top3' : ''}">${rank + 1}</div>
        <div class="player-name">${esc(entry.s.naam)}${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}
          <br><span style="font-size:11px;color:var(--light)">${
            dagen.map((d, di) => `d${d.dagNr} ${getal(perDag[di][entry.i])}`).join(' · ')
          }</span>
        </div>
        <div style="font-size:12px;color:var(--light);text-align:right;line-height:1.6">
          <strong style="color:var(--dark);font-size:14px">${getal(entry.pt)}</strong><br>punten
        </div>
      </div>`).join('');
}

function renderTRanglijst() {
  const el = document.getElementById('t-ranglijst');
  if (!el) return;
  const t = toernooiData;
  if (!t) return;

  const rlDag = window._ranglijstDagNr ?? (t.actiefDagNr || 1);

  // v5.12.0: de ranglijst volgt de speelwijze van de DAG die je bekijkt. Bij
  // "Totaal" met verschillende speelwijzen is geen van beide tellingen bruikbaar
  // — dan de dagpunten.
  const rlModus = rlDag === 0
    ? (gemengdeSpeelwijzen(t) ? 'gemengd' : dagModus(t, (t.dagen || [])[0]))
    : dagModus(t, getDag(t, rlDag) || actieveDag(t));

  const modusBar = document.getElementById('t-ranglijst-modus');
  if (modusBar) modusBar.style.display = rlModus === 'strokeplay' ? '' : 'none';

  if (rlModus === 'gemengd') { renderTDagpuntenRanglijst(t, el); return; }

  if (rlModus === 'strokeplay') {
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
  const { punten, won, tied, lost, matrix } = berekenTPunten(rlDag);
  const volgorde = matchplayVolgorde(
    t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]})), matrix);

  el.innerHTML = `<div style="font-size:11px;color:var(--light);padding:6px 10px;border-bottom:1px solid var(--border)"><strong>${dagNaam}</strong></div>` +
    volgorde.map((entry, rank) => `
    <div class="ladder-item">
      <div class="rank-badge ${rank < 3 ? 'top3' : ''}">${rank+1}</div>
      <div class="player-name">${esc(entry.s.naam)}${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}${entry.gelijk ? ' <span title="Gelijk geëindigd: zelfde punten, zelfde winsten, zelfde handicap" style="font-size:10px;color:var(--gold);font-weight:700">= gelijk</span>' : ''}</div>
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
  if (dagModus(toernooiData, actieveDag()) !== 'matchplay') {
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
  // v5.12.0: één strokeplay-dag is genoeg — dan blijft de ladder eraf.
  const isStrokeplay = heeftStrokeplayDag(t);

  if (isStrokeplay) {
    if (confirm('Toernooi afsluiten? De ladderstand wordt niet aangepast.')) {
      bevestigToernooiAfsluiten();
    }
    return;
  }

  // Gebruik totaalstand als meerdere dagen
  const { punten, won, tied, lost, matrix } = berekenTPunten(0);
  const volgorde = matchplayVolgorde(
    t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]})), matrix);

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

    // v5.12.0: één strokeplay-dag is genoeg om de ladder eraf te houden.
    if (heeftStrokeplayDag(t)) {
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
    const volgorde = matchplayVolgorde(
      t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]})), matrix);

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
          // v5.11.8: NIET opnieuw sorteren. `volgorde` is al gesorteerd met de
          // volledige regel (punten, onderling, winsten, handicap); een tweede
          // sortering op alleen punten gooide die weer om, en dan kreeg de
          // ladder een andere volgorde dan het scherm liet zien.
          const gesorteerd = deelnemers;

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

    // v5.12.3: de gastaccounts horen hier mee weg, zodat de inlognamen vrij
    // komen en niemand onnodig een cijfer krijgt (`sierk2`, `sierk3`). Er zijn
    // per definitie nog geen scores — dat is hierboven al gecontroleerd.
    //
    // v5.12.4: ⚠ maar ALLEEN als we het wachtwoord in handen hebben.
    //
    // WAT ER MIS GING. Het wachtwoord staat alleen in het invulveld en wordt
    // nergens onthouden; na een herlaad is het leeg. Dan werden hier de oude
    // accounts weggegooid, startte de coordinator opnieuw zonder wachtwoord, en
    // kregen de gasten dus GEEN nieuwe inlog. Ze konden nergens meer in.
    // Liever een oud account te veel dan een speler die buiten staat.
    //
    // Het wachtwoord komt uit het toernooi zelf en gaat terug in het formulier,
    // zodat opnieuw starten vanzelf weer werkt.
    const geheim = await _leesGastWachtwoord(actieveToernooiId);
    const wwVeld = document.getElementById('t-gast-wachtwoord');
    if (geheim?.wachtwoord && wwVeld && !wwVeld.value.trim()) {
      wwVeld.value = geheim.wachtwoord;
    }
    const wwInHanden = (wwVeld?.value || '').trim() || geheim?.wachtwoord || '';
    if (wwInHanden) {
      try { await ruimGastloginsOp(t, { stil: true }); }
      catch (e) { console.warn('gastlogins opruimen bij opnieuw instellen:', e); }
    } else if ((t.spelers || []).some(sp => sp.gast && sp.login)) {
      console.warn('gastwachtwoord onbekend — de oude gastaccounts blijven staan');
    }

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
  // v5.12.1: de speelwijze komt uit de dagblokken. Die worden even verderop
  // gevuld vanuit t.dagen; pasSpeelwijzeToe() draait daarna.

  // Punt-instellingen
  // v5.13.0: punten, handicap, starttijd en interval staan per dag. Ze worden
  // hieronder in de dagblokken teruggezet, niet meer in toernooibrede velden.

  // Dag 1 starttijd + interval (van eerste dag)
  const dag1 = (t.dagen || [])[0];
  // v5.13.0: starttijd en interval staan per dag en worden hieronder in de
  // dagblokken teruggezet, samen met de punten en de handicap.

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
    // v5.13.0: alles wat per dag is opgeslagen ook per dag terugzetten.
    // Ontbreekt het op de dag — een toernooi van vóór v5.13.0 — dan valt het
    // terug op de toernooibrede waarde, dezelfde volgorde als dagInstelling().
    const zetD = (klasse, waarde) => {
      if (waarde === undefined || waarde === null || waarde === '') return;
      const el = blok.querySelector('.t-dag-' + klasse);
      if (el) el.value = waarde;
    };
    zetD('starttijd', dag.starttijd);
    zetD('interval',  dag.interval);
    zetD('ptwin',  dag.ptWin  ?? t.ptWin);
    zetD('pttie',  dag.ptTie  ?? t.ptTie);
    zetD('ptloss', dag.ptLoss ?? t.ptLoss);
    zetD('plaatspunten', dag.plaatsPunten);   // v5.15.0
    zetD('hcppct', dag.hcpPct !== undefined ? Math.round(dag.hcpPct * 100)
                 : (t.hcpPct !== undefined ? Math.round(t.hcpPct * 100) : undefined));
    const modusEl = blok.querySelector('.t-dag-modus');            // v5.12.0
    if (modusEl) { modusEl.value = dagModus(t, dag); onDagModusWissel(modusEl); }
  });

  // Spelers — herstel uit t.spelers
  store._tGeselecteerdeSpelers = (t.spelers || []).map(s => ({
    uid: s.uid, naam: s.naam, hcp: s.hcp, gast: s.gast || false
  }));
  renderTGeselecteerdeSpelers();

  // De ranking-ladder terugzetten. v5.12.8: er is nog maar één keuze, dus als
  // een ouder toernooi er meer had, wint de eerste.
  const _herstelRanking = t.rankingLadderIds || (t.ladderId ? [t.ladderId] : []);
  store._tRankingLadderIds = new Set(_herstelRanking.slice(0, 1));
  initToernooiSetup(); // herlaadt de keuzelijst

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
    if (!confirm("Toernooi annuleren?\n\nHet toernooi verdwijnt uit beeld, maar kan via 'Geannuleerde toernooien' worden hersteld of definitief verwijderd.\n\nDe gastlogins blijven werken.")) return;
    // v5.12.1: annuleren raakt de gastlogins NIET meer aan.
    //
    // WAT ER MIS WAS. Tot v5.12.0 bood deze functie hier aan de gastaccounts te
    // verwijderen (ruimGastloginsOp). Zei je daar ja, dan was het account écht
    // weg — en herstellen bracht het niet terug. De gast kreeg bij inloggen
    // "Je hebt geen toegang", terwijl zijn inlognaam nog gewoon in het toernooi
    // stond. Gemeten op 13 september 2026 met een browsertest. Er was ook geen
    // weg terug: opnieuw toevoegen geeft een nieuwe uid, waardoor zijn eerder
    // ingevoerde scores in live/{uid} losraken van de speler.
    //
    // Het was bovendien innerlijk tegenstrijdig: het venster hierboven belooft
    // dat annuleren herstelbaar is, en vroeg meteen daarna of de logins
    // definitief weg mochten. Opruimen hoort bij handelingen die NIET
    // herstelbaar zijn — definitief verwijderen en toernooi afsluiten — en daar
    // gebeurt het ook.
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
    // v5.12.3: ⚠ dezelfde grendel als bij het aanmaken.
    //
    // WAT ER MIS WAS. Bij het AANMAKEN weigert de app sinds v5.9.0 een tweede
    // actief toernooi. Bij het HERSTELLEN controleerde niets dat. Gemeten op
    // 13 september 2026: na herstellen stonden er twee actieve toernooien
    // naast elkaar. Daarna is het willekeurig welk toernooi een speler te zien
    // krijgt — op meerdere plekken wordt `alleToernooien[0]` gebruikt uit een
    // zoekopdracht zonder sorteervolgorde. Dit is de derde manier om op
    // "Geen actief toernooi" uit te komen.
    // v5.21.0: alleen een toernooi dat ECHT loopt blokkeert; wachtende
    // toernooien mogen naast elkaar staan.
    const lopend = lopendToernooi(id);
    if (lopend) {
      toast(`"${lopend.naam || 'Een toernooi'}" loopt nog. Sluit dat eerst af of annuleer het.`, 9000);
      return;
    }
    if (!confirm('Dit toernooi herstellen? Het wordt weer actief, inclusief alle eerder ingevoerde scores.')) return;
    await updateDoc(doc(db, 'toernooien', id), { status: 'actief' });
    await herlaadToernooien();
    await meldGastenZonderAccount(id);   // v5.12.1
    store.actieveToernooiId = id;
    store.toernooiData = alleToernooien.find(t => t.id === id) || null;
    window._bekijkDagNr = null;
    const lijst = document.getElementById('toernooi-geannuleerd-lijst');
    if (lijst) lijst.innerHTML = '';
    renderToernooi();
    toast('Toernooi hersteld ✓');
  } catch(e) { console.error('herstelGeannuleerdToernooi mislukt:', e); toast('Herstellen mislukt, probeer opnieuw'); }
}

// ============================================================
//  v5.12.1 — STAAT ER EEN GAST IN ZONDER WERKEND ACCOUNT?
// ------------------------------------------------------------
//  Een toernooi bewaart van elke gast zijn inlognaam en zijn uid. Het account
//  zelf staat ergens anders: het profiel in spelers/{uid} en de inlog in
//  Firebase Auth. Die kunnen los van elkaar verdwijnen — door een opruiming
//  bij een eerder afgesloten toernooi, of doordat iemand het profiel weghaalt.
//  Dan staat de inlognaam nog keurig op het briefje, maar komt de gast er niet
//  in. Dat merk je anders pas op de eerste tee.
//
//  Deze controle draait na het herstellen van een geannuleerd toernooi en zegt
//  het meteen, met de naam erbij.
async function meldGastenZonderAccount(id) {
  try {
    const t = alleToernooien.find(x => x.id === id);
    const gasten = (t?.spelers || []).filter(sp => sp.gast && sp.login && sp.uid);
    if (gasten.length === 0) return [];
    const ontbreekt = [];
    for (const g of gasten) {
      try {
        const snap = await getDoc(doc(db, 'spelers', g.uid));
        if (!snap.exists()) ontbreekt.push(g.naam);
      } catch (e) { console.warn('gastprofiel lezen mislukt voor', g.naam, e?.code); }
    }
    if (ontbreekt.length > 0) {
      toast(`⚠ Geen werkende inlog meer voor: ${ontbreekt.join(', ')}. ` +
            `Verwijder die speler en voeg hem opnieuw toe om hem weer een login te geven.`, 12000);
    }
    return ontbreekt;
  } catch (e) { console.warn('gastcontrole mislukt:', e); return []; }
}
window.meldGastenZonderAccount = meldGastenZonderAccount;

async function verwijderGeannuleerdToernooi(id, naam) {
  try {
    if (!confirm(`"${naam || 'Dit toernooi'}" DEFINITIEF verwijderen?\n\nDit kan niet ongedaan worden gemaakt — alle scores verdwijnen voorgoed.`)) return;
    // v5.12.1: hier hoort de gastopruiming thuis, niet bij annuleren. Dit is de
    // handeling die niet meer terug te draaien is, dus mogen de accounts mee.
    try {
      const snap = await getDoc(doc(db, 'toernooien', id));
      if (snap.exists()) await ruimGastloginsOp({ id, ...snap.data() });
    } catch(e) { console.warn('gastlogins opruimen:', e); }
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
// ============================================================
//  v5.12.1 — DE SPEELWIJZE KOMT UIT DE DAGBLOKKEN
// ------------------------------------------------------------
//  Tot v5.12.0 stond er onder de dagblokken nóg een keuze Matchplay/Strokeplay
//  voor het hele toernooi. Die stuurde drie dingen aan: de puntenvelden met het
//  HCP-percentage, het uitlegblok bij strokeplay, en de ranking-ladders. Sinds
//  v5.12.0 kiest elke dag zijn eigen speelwijze, en dan is een tweede keuze
//  erboven niet alleen dubbel maar ook misleidend — kies je daar strokeplay
//  terwijl dag 2 matchplay is, dan verdwenen de puntenvelden die dag 2 nodig
//  heeft.
//
//  Daarom leest deze functie de dagblokken en beslist daaruit:
//    - minstens één matchplay-dag  -> punten en HCP-percentage zichtbaar
//    - minstens één strokeplay-dag -> de uitleg brutto/netto/stableford
//    - minstens één strokeplay-dag -> GEEN ranking-ladders. Sierk,
//      13 september 2026: "als er strokeplay gespeeld wordt dan kan het
//      toernooi niet meetellen voor de ladder." Dan hoef je hem ook niet te
//      kunnen kiezen.
//  Bij een gemengd toernooi staan de puntenvelden en de uitleg dus samen in
//  beeld — allebei terecht, want allebei worden ze gebruikt.

// De gekozen speelwijzen van alle dagblokken in het aanmaakformulier.
function speelwijzenUitFormulier() {
  return Array.from(document.querySelectorAll('#t-dag-blokken .t-dag-modus'))
    .map(sel => sel.value || 'matchplay');
}

// De speelwijze die als toernooibreed veld (`t.modus`) wordt opgeslagen. Die
// blijft bestaan als terugval voor oude toernooien waarvan de dagen nog geen
// eigen `modus` dragen — zie dagModus().
//
// Deze twee rekenen alleen met een lijstje speelwijzen en raken het scherm
// niet aan, zodat de tests de regel rechtstreeks kunnen natellen.
function toernooiModusVanSpeelwijzen(w) {
  return (w.length > 0 && w.every(m => m === 'strokeplay')) ? 'strokeplay' : 'matchplay';
}

// Wat er onderin het aanmaakformulier zichtbaar hoort te zijn.
// Een leeg lijstje (nog geen dagblokken) telt als matchplay, anders klapt het
// hele onderste deel van het formulier dicht.
function zichtbaarheidVanSpeelwijzen(w) {
  return {
    punten:  w.length === 0 || w.some(m => m === 'matchplay'),
    uitleg:  w.some(m => m === 'strokeplay'),
    ranking: !w.some(m => m === 'strokeplay'),
  };
}

function toernooiModusUitFormulier() {
  return toernooiModusVanSpeelwijzen(speelwijzenUitFormulier());
}

function pasSpeelwijzeToe() {
  const zicht = zichtbaarheidVanSpeelwijzen(speelwijzenUitFormulier());
  const matchplay   = document.getElementById('t-matchplay-instellingen');
  const strokeplay  = document.getElementById('t-strokeplay-instellingen');
  const rankingWrap = document.getElementById('t-ranking-ladders-wrap');
  if (matchplay)   matchplay.style.display   = zicht.punten  ? '' : 'none';
  if (strokeplay)  strokeplay.style.display  = zicht.uitleg  ? '' : 'none';
  if (rankingWrap) rankingWrap.style.display = zicht.ranking ? '' : 'none';
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
window.pasSpeelwijzeToe = pasSpeelwijzeToe;

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
// ============================================================
//  v5.12.4 — ALSNOG EEN INLOG VOOR GASTEN DIE ER GEEN HEBBEN
// ------------------------------------------------------------
//  WAAROM DIT BESTAAT. Tot v5.12.3 kon een toernooi beginnen met gastspelers
//  zonder inlog, zonder dat iets dat zei: het wachtwoordveld was leeg en de app
//  sloeg het aanmaken stil over. Sierk stond op 13 september 2026 met een
//  lopend toernooi waarin niemand kon inloggen, en de enige uitweg was elke
//  gast verwijderen en opnieuw toevoegen — en dan raakt hij zijn scores kwijt,
//  want die hangen aan zijn sleutel.
//
//  Deze knop geeft ze alsnog een account. De sleutelwissel loopt via
//  _vervangSpelerUid(), dezelfde weg als bij het starten: flights, markers en
//  ingevulde scores verhuizen mee. Een eventueel live-scoredocument gaat er
//  achteraan, want dat staat buiten het toernooidocument.
async function maakOntbrekendeGastlogins() {
  try {
    const t = toernooiData;
    if (!t || !actieveToernooiId) return;
    // v5.12.5: het toernooinummer EEN keer vastpakken en daarna niet meer uit
    // het geheugen lezen. Accounts aanmaken duurt seconden, en `actieveToernooiId`
    // is een levende verwijzing die daar tussendoor door een meeluisteraar of
    // door "terug naar overzicht" op null gezet kan worden. Elke doc()-aanroep
    // hieronder gebruikte hem opnieuw; eentje met null erin laat Firestore
    // struikelen op iets dat niets met deze knop te maken heeft.
    const toernooiId = actieveToernooiId;
    if (_gastBeheerGeblokkeerdInTest()) return;

    const zonder = (t.spelers || []).filter(sp => sp.gast && !sp.login);
    if (zonder.length === 0) { toast('Alle gastspelers hebben al een inlog'); return; }

    const geheim = await _leesGastWachtwoord(toernooiId);
    let wachtwoord = geheim?.wachtwoord || '';
    if (!wachtwoord) {
      wachtwoord = (prompt(
        `Wachtwoord voor de gastspelers (minstens 6 tekens).\n\n` +
        `Dit is één wachtwoord voor iedereen; ze loggen in met hun eigen naam.`) || '').trim();
      if (!wachtwoord) return;
      if (wachtwoord.length < 6) { toast('Het gastwachtwoord moet minstens 6 tekens hebben'); return; }
    }

    // Zonder gastcode is er nog nooit een inlog uitgegeven voor dit toernooi.
    let code = t.gastCode;
    if (!code) {
      try {
        const alle = await getDocs(TOERNOOIEN_COL);
        code = uniekeGastCode(t.naam, alle.docs.map(d => d.data().gastCode));
      } catch (e) {
        code = toernooiCodeVan(t.naam);
      }
    }

    if (!confirm(
      `${zonder.length} gastspeler(s) krijgen nu een inlog:\n\n` +
      zonder.map(sp => '• ' + sp.naam).join('\n') +
      `\n\nHun ingevulde scores blijven staan. Doorgaan?`)) return;

    try {
      await setDoc(doc(db, 'toernooien', toernooiId, 'beheer', 'gastlogin'),
        { wachtwoord, code });
    } catch (e) {
      console.error('gastwachtwoord opslaan mislukt:', e);
      toast('Let op: het wachtwoord kon niet worden bewaard — ' + toernooiFoutTekst(e), 9000);
    }

    // ⚠ EERST alle accounts aanmaken, PAS DAARNA het toernooi omschrijven.
    //
    // Een account aanmaken duurt seconden, en ondertussen kan de meeluisteraar
    // `toernooiData` vervangen door een verse serverkopie. Schreven we de
    // sleutels onderweg om, dan deden we dat in een object dat daarna werd
    // weggegooid — en dook de oude sleutel weer op in `dagen[].scores`. Gemeten
    // met de browsertest hieronder.
    const mislukt = [];
    const wissels = [];
    const scoresNietVerhuisd = [];
    for (const sp of zonder) {
      try {
        const { uid, login } = await maakGastAccount(sp.naam, code, wachtwoord, t.naam);
        wissels.push({ oudeUid: sp.uid, uid, login, naam: sp.naam });
      } catch (e) {
        console.error('gastlogin alsnog aanmaken mislukt voor', sp.naam, e);
        // v5.12.5: de reden erbij. Stond alleen in het verborgen logboek, en
        // daar kom je op een telefoon niet bij.
        mislukt.push({ naam: sp.naam, reden: toernooiFoutTekst(e) });
      }
    }

    // Het live-scoredocument staat BUITEN het toernooi en verhuist niet vanzelf
    // mee. Heeft de wedstrijdleiding al scores ingevoerd, dan zouden die zonder
    // dit stuk aan de oude sleutel blijven hangen. Dit eerst, want het kost
    // netwerktijd — en daarna mag er niets meer tussenkomen.
    for (const w of wissels) {
      try {
        const oudLive = await getDoc(doc(db, 'toernooien', toernooiId, 'live', w.oudeUid));
        if (oudLive.exists()) {
          await setDoc(doc(db, 'toernooien', toernooiId, 'live', w.uid), oudLive.data());
          await deleteDoc(doc(db, 'toernooien', toernooiId, 'live', w.oudeUid));
        }
      } catch (e) {
        // v5.12.5: dit ging alleen naar het verborgen logboek. Verhuizen de
        // scores niet mee, dan lijken ze verdwenen — dat moet je op het scherm
        // te zien krijgen, niet pas achteraf.
        console.warn('live-scores verhuizen mislukt voor', w.naam, e?.code);
        scoresNietVerhuisd.push(w.naam);
      }
    }

    // ⚠ En nu pas omschrijven, op de kopie die op DIT moment de actieve is, in
    // één ruk zonder tussenliggend wachten. Deed je dit ertussendoor, dan kon
    // de meeluisteraar `toernooiData` vervangen door een verse serverkopie en
    // zette behoudLiveScores() de oude sleutel gewoon weer terug in
    // `dagen[].scores`. Dat is precies wat de browsertest hieronder ving.
    const doelwit = toernooiData || t;
    for (const w of wissels) {
      _vervangSpelerUid(doelwit, w.oudeUid, w.uid);
      const speler = (doelwit.spelers || []).find(sp => sp.uid === w.uid);
      if (speler) speler.login = w.login;
      // De ingevoerde scores van deze ronde staan ook in het geheugen, op de
      // oude sleutel. Blijven die staan, dan komen ze bij de eerstvolgende
      // verversing gewoon weer terug.
      if (store._liveScores && store._liveScores[w.oudeUid]) {
        store._liveScores[w.uid] = store._liveScores[w.oudeUid];
        delete store._liveScores[w.oudeUid];
      }
    }
    const gelukt = wissels.length;

    doelwit.gastCode = code;
    store.toernooiData = doelwit;
    const idx = alleToernooien.findIndex(x => x.id === toernooiId);
    if (idx >= 0) alleToernooien[idx] = doelwit;
    await setDoc(doc(db, 'toernooien', toernooiId), JSON.parse(JSON.stringify(doelwit)));
    renderToernooiActief();

    // v5.12.5: zes verschillende mislukkingen gingen hier stil naar het
    // verborgen logboek en de melding zei alleen dat er iets klaar was. Nu
    // staat er wat er niet lukte en waarom.
    if (mislukt.length > 0) {
      const uitleg = mislukt.map(m => `${m.naam} (${m.reden})`).join('; ');
      toast(`${gelukt} inlog(s) klaar. Niet gelukt voor: ${uitleg}`, 12000);
    } else {
      toast(`${gelukt} gastlogin(s) aangemaakt ✓ — bekijk ze met "Gastlogins tonen"`, 7000);
    }
    if (scoresNietVerhuisd.length > 0) {
      toast(`Let op: de al ingevulde scores van ${scoresNietVerhuisd.join(', ')} zijn `
          + `niet meeverhuisd naar de nieuwe inlog. Controleer hun scorekaart.`, 12000);
    }
  } catch(e) { toernooiFout('Gastlogins aanmaken', e); }
}
window.maakOntbrekendeGastlogins = maakOntbrekendeGastlogins;

// v5.12.3: de tekst die je doorstuurt. Los van het scherm, zodat de rekentest
// hem kan natellen — dit is het briefje dat de spelers in handen krijgen.
//
// ⚠ v5.17.0: hier stond een tip onderaan: "de speler tikt zijn eigen voor- en
// achternaam in". Die is weg, en niet alleen omdat hij overbodig was. Hij was
// FOUT voor een gast die met alleen een voornaam is aangemaakt: `gastLoginVan()`
// maakt daar `karel` van, niet `karel.jansen`. Zo iemand zat naar een tip te
// kijken die hem uit de app hield. Elke regel noemt de inlognaam al letterlijk
// ("Karel  —  inlog: karel"), dus de tip vertelde de naam ook nog eens na.
// Sierk, 14 september 2026: "die tekst klopt niet omdat je ook spelers met
// alleen een voornaam aanmaakt."
function gastloginTekst({ adres, wachtwoord, regels }) {
  const breedte = Math.max(0, ...(regels || []).map(r => String(r.naam || '').length));
  const lijst = (regels || [])
    .map(r => `${String(r.naam).padEnd(breedte)}  —  inlog: ${r.inlog}`)
    .join('\n');
  return `Inloggen op ${adres}\n`
    + `Wachtwoord: ${wachtwoord}\n\n`
    + lijst;
}

async function toonGastlogins() {
  try {
    const t = toernooiData;
    if (!t) return;
    const gasten = (t.spelers || []).filter(sp => sp.login);
    if (gasten.length === 0) { toast('Geen gastlogins in dit toernooi'); return; }

    const geheim = await _leesGastWachtwoord(actieveToernooiId);
    const ww = geheim?.wachtwoord || '(wachtwoord niet gevonden)';
    // v5.11.5: één inlognaam, en overal dezelfde — op het scherm én in de
    // lijst die je doorstuurt. Zonder toernooicode: die hoort in de database,
    // niet op papier.
    const inlogVan = (g) => zonderToernooiCode(g.login, t.gastCode) || g.naam;
    // v5.12.3: het wachtwoord één keer bovenaan in plaats van achter elke naam.
    // Sierk, 13 september 2026: "als ik het plak zie ik bij iedere speler
    // hetzelfde wachtwoord. zet dat wachtwoord er een keer in." En "gast" werd
    // "speler" — het briefje gaat naar de mensen zelf, en die noemen zich geen
    // gast. Het blok hierboven wordt door `gastloginTekst()` gemaakt, zodat de
    // rekentest de opmaak kan natellen.
    const tekst = gastloginTekst({
      adres: `${window.location.origin}${window.location.pathname}`,
      wachtwoord: ww,
      regels: gasten.map(g => ({ naam: g.naam, inlog: inlogVan(g) })),
    });

    const html = `
      <p style="font-size:13px;color:var(--mid);margin-bottom:10px">
        Deze spelers loggen in met de <strong>inlognaam</strong> die achter hun naam
        staat, plus het wachtwoord hieronder. Na afloop van het toernooi werkt de
        inlog niet meer.
      </p>
      <div style="background:var(--soft-bg);border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--mid);text-transform:uppercase;font-weight:600">Wachtwoord</div>
        <div style="font-family:'DM Mono',monospace;font-size:16px">${esc(ww)}</div>
      </div>
      ${gasten.map(g => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:15px;color:var(--dark)">${esc(g.naam)}</span>
          <span style="font-family:'DM Mono',monospace;font-size:15px;color:var(--dark)">${esc(inlogVan(g))}</span>
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
// v5.12.3: `opties.stil` slaat de bevestigingsvraag over. Dat is alleen voor
// "Toernooi opnieuw instellen": daar heeft de coordinator al bevestigd dat het
// toernooi weggaat, en de accounts worden een tel later opnieuw aangemaakt.
// Overal anders blijft de vraag staan — dit verwijdert accounts van mensen.
async function ruimGastloginsOp(toernooi, opties) {
  const t = toernooi || toernooiData;
  const gasten = (t?.spelers || []).filter(sp => sp.gast && sp.login && sp.uid);
  if (gasten.length === 0) return { verwijderd: 0, overgeslagen: [] };

  if (!opties?.stil && !confirm(
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

  // v5.12.3: in de stille variant geen melding als alles goed ging — de
  // coordinator is dan bezig met "opnieuw instellen" en krijgt daar zijn eigen
  // bevestiging. Gaat er iets MIS, dan hoort hij dat altijd.
  if (overgeslagen.length > 0) {
    toast(`${verwijderd} inlog(s) weg. Overgeslagen: ${overgeslagen.join(', ')}`, 9000);
  } else if (!opties?.stil) {
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


export { alleScoresIngevuld, annuleerToernooi, behoudLiveScores, berekenFlightTijd, berekenTPunten, bevestigToernooiAfsluiten, editToernooiHcp, gaNaarToernooiOverzicht, getTHcpSlagen, getToernooiSpelersPool, herlaadToernooien, herlaadToernooiListeners, initToernooiSetup, openFlightIndeling, openFlightIndelingDag, openNieuweDagModal, openToernooiAfsluiten, openToernooiSpelersBeheer, openVerwijderToernooiSpeler, refreshToernooiScorekaart, renderDagBlokken, renderFlightLijst, renderTGeselecteerdeSpelers, renderTMatrix, renderTRanglijst, renderTScorecard, renderToernooi, renderToernooiActief, selecteerDag, selecteerSpelersTab, selecteerFlightTab, selecteerToernooi, selecteerToernooiSpeler, selecteerToernooiSpelerModal, sluitDagAf, sluitToernooiSpelerLijst, sluitToernooiSpelerModal, slaFlightIndelingDagOp, startToernooi, toggleHolesCustom, kiesTRankingLadder, toggleTScorecard, toggleTSpeler, toggleToernooiMatrix, toonToernooiUitslag, updateTScore, updateTScoreAndAdvance, updateTTotaalRijInline, updateTTotalen, verplaatsSpelerFlight, verwijderFlight, verwijderToernooiSpelerNieuw, verwijderToernooiSpelerSelectie, voegBestaandeSpelerToeAanToernooi, voegDagToe, voegFlightToe, voegGastspelerToe, voegGastspelerToeAanToernooi, wijzigFlightHcp, wijzigFlightNaam, wijzigFlightStarthole, wijzigFlightStarttijd, zoekToernooiSpeler, zoekToernooiSpelerModal };
