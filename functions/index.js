// ============================================================
//  Goyer Golf MP Ladder — Cloud Functions
//  v5.1.1 — watch leest juiste database, PIN blijft geldig bij storing,
//  runtime Node.js 22
// ============================================================
//  Deployen vanuit de root folder van je project:
//    firebase deploy --only functions
//
//  Anthropic API key instellen (eenmalig):
//    firebase functions:secrets:set ANTHROPIC_API_KEY
// ============================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');
// v5.40.0: de QR-code van een ronde wordt HIER getekend, niet in de app. Zo
// komt er geen code van buiten in de browser terecht, en hoeft de app niets te
// kunnen wat ze nu niet al kan.
const QRCode = require('qrcode');

admin.initializeApp();

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

// ============================================================
//  WATCH-LOGIN — v5.0.0  (vervangt de onveilige PIN-opzet)
// ------------------------------------------------------------
//  WAT ER MIS WAS (t/m v4.2.0):
//  ladder/watchPins stond in firestore.rules op `allow read: if true` en
//  bevatte per PIN een Firebase *refreshToken*. Een refreshToken is geen
//  tijdelijk sleuteltje maar een permanente loper: daarmee maak je onbeperkt
//  nieuwe idTokens aan. Omdat het project-ID gewoon in de broncode staat, kon
//  iedereen ter wereld dat document met één ongeauthenticeerde HTTP-request
//  ophalen en inloggen als elke speler die ooit het rondescherm had geopend.
//
//  HOE HET NU WERKT:
//   1. De app roept `maakWatchPin` aan (ingelogd). De server genereert een
//      6-cijferige PIN, slaat alleen een SHA-256 hash daarvan op, en geeft de
//      PIN één keer terug voor weergave in de gele badge.
//   2. Het horloge roept `wisselWatchPin` aan met die PIN. De server
//      controleert hash, geldigheid en eenmalig gebruik, markeert de PIN als
//      verbruikt en geeft een *custom token* terug.
//   3. Het horloge wisselt dat custom token zelf om bij Google voor een
//      idToken + refreshToken. Die tokens staan dus alleen op het horloge,
//      nooit in Firestore.
//
//  ladder/watchPins is in firestore.rules volledig dichtgezet (read én write
//  op false) — alleen deze functies komen er nog bij via de Admin SDK.
// ============================================================

const WATCH_PIN_TTL_MS   = 15 * 60 * 1000; // PIN 15 minuten geldig
const WATCH_MAX_FOUT     = 20;             // max mislukte pogingen per venster
const WATCH_FOUT_VENSTER = 10 * 60 * 1000; // venster voor de foutteller

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin), 'utf8').digest('hex');
}

// ============================================================
//  v5.38.0 — EEN PINCODE-SESSIE MAG GEEN SERVERFUNCTIE AANROEPEN
// ------------------------------------------------------------
//  Wie via de toernooi-pincode binnenkwam draagt de stempel `viaPin`. Zo
//  iemand heeft zijn eigen wachtwoord niet gebruikt en hoort dus alleen aan
//  het toernooi te komen. firestore.rules houdt hem weg bij de ladder; deze
//  wacht doet hetzelfde voor de serverfuncties, want die werken met de Admin
//  SDK en gaan dwars door die regels heen.
//
//  Nagemeten op 19 september 2026: het toernooi roept zelf geen enkele van
//  deze functies aan (alle scores gaan rechtstreeks naar Firestore). De wacht
//  kan dus overal staan zonder iets in de weg te zitten. `wisselToernooiPin`
//  en `wisselWatchPin` zijn de uitzonderingen — dat ZIJN de inlogfuncties.
// ============================================================
// v5.40.0: hetzelfde voor wie met een ronde-QR binnenkwam. Zo'n sessie hoort
// alleen scores in zijn eigen partij te schrijven — niet de uitslag indienen,
// niet de ladder aanraken. Nagemeten: de ronde zelf roept geen enkele
// serverfunctie aan, dus deze wacht zit niemand in de weg.
function weigerRondeSessie(request) {
  if (request?.auth?.token?.viaRonde) {
    throw new HttpsError('permission-denied',
      'Je bent met de QR-code van een ronde binnengekomen. Daarmee kun je alleen '
      + 'de scores van die ronde bijhouden.');
  }
}

function weigerPinSessie(request) {
  if (request?.auth?.token?.viaPin === true) {
    throw new HttpsError('permission-denied',
      'Je bent ingelogd met de toernooi-pincode. Daarmee kun je alleen het '
      + 'toernooi bijhouden. Log in met je eigen wachtwoord voor de rest.');
  }
}

// Cryptografisch veilige 6-cijferige PIN (100000..999999).
function genereerPin() {
  return String(100000 + (crypto.randomInt(0, 900000)));
}

/**
 * Genereer een nieuwe watch-PIN voor de ingelogde speler.
 * Oude/verlopen PIN's van dezelfde speler worden opgeruimd.
 *
 * Input:  { isTest?: boolean }
 * Output: { pin: "123456", verlooptOver: 900 }  (seconden)
 */
exports.maakWatchPin = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');

    const isTest = data?.isTest === true;
    const fs = fsVoor(isTest);
    const ref = fs.collection('ladder').doc('watchPins');

    const pin = genereerPin();
    const hash = hashPin(pin);
    const nu = Date.now();

    await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const bestaand = snap.exists ? (snap.data() || {}) : {};
      const schoon = {};
      // Behoud alleen nog-geldige PIN's van ANDERE spelers. Verlopen PIN's en
      // eerdere PIN's van deze speler vallen af (één actieve PIN per speler).
      for (const [k, v] of Object.entries(bestaand)) {
        if (!v || typeof v !== 'object') continue;
        if (v.uid === auth.uid) continue;
        if (!(v.expires > nu)) continue;
        schoon[k] = v;
      }
      schoon[hash] = { uid: auth.uid, expires: nu + WATCH_PIN_TTL_MS, gebruikt: false, gemaakt: nu };
      tx.set(ref, schoon);
    });

    return { pin, verlooptOver: Math.floor(WATCH_PIN_TTL_MS / 1000) };
  }
);

/**
 * Wissel een watch-PIN om voor een custom token. Bewust NIET
 * authenticatie-plichtig: dit ís de login van het horloge.
 *
 * Beveiliging: 1.000.000 mogelijke PIN's, 15 minuten geldig, eenmalig
 * bruikbaar, plus een globale foutteller die na WATCH_MAX_FOUT mislukte
 * pogingen binnen WATCH_FOUT_VENSTER alles tijdelijk blokkeert.
 *
 * Input:  { pin: "123456", isTest?: boolean }
 * Output: { customToken, uid, naam }
 */
exports.wisselWatchPin = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const data = request.data || {};
    const pin = String(data.pin ?? '').trim();
    const isTest = data.isTest === true;

    if (!/^\d{6}$/.test(pin)) {
      throw new HttpsError('invalid-argument', 'PIN moet uit 6 cijfers bestaan.');
    }

    const fs = fsVoor(isTest);
    const pinRef  = fs.collection('ladder').doc('watchPins');
    const foutRef = fs.collection('ladder').doc('watchPinPogingen');
    const hash = hashPin(pin);
    const nu = Date.now();

    // Transactie: foutteller checken/bijwerken én PIN verbruiken in één keer,
    // zodat twee gelijktijdige pogingen dezelfde PIN niet allebei kunnen gebruiken.
    const uid = await fs.runTransaction(async (tx) => {
      const [foutSnap, pinSnap] = await Promise.all([tx.get(foutRef), tx.get(pinRef)]);

      const fout = foutSnap.exists ? (foutSnap.data() || {}) : {};
      const vensterStart = typeof fout.venster === 'number' ? fout.venster : 0;
      const binnenVenster = (nu - vensterStart) < WATCH_FOUT_VENSTER;
      const fouten = binnenVenster ? (fout.fouten || 0) : 0;
      if (fouten >= WATCH_MAX_FOUT) {
        throw new HttpsError('resource-exhausted', 'Te veel mislukte pogingen. Probeer het over 10 minuten opnieuw.');
      }

      const pins = pinSnap.exists ? (pinSnap.data() || {}) : {};
      const sessie = pins[hash];
      const geldig = sessie && sessie.gebruikt !== true && sessie.expires > nu;

      if (!geldig) {
        tx.set(foutRef, {
          fouten: fouten + 1,
          venster: binnenVenster ? vensterStart : nu,
        });
        throw new HttpsError('permission-denied', 'Ongeldige of verlopen PIN.');
      }

      // v5.1.1: de PIN wordt hier NIET meer verbruikt. Alleen de foutteller
      // resetten. Zie de toelichting onder deze transactie.
      tx.set(foutRef, { fouten: 0, venster: nu });
      return sessie.uid;
    });

    // ────────────────────────────────────────────────────────
    //  v5.1.1: eerst het token maken, dan pas de PIN verbruiken.
    //
    //  In v5.0.0 gebeurde dat andersom: de PIN werd in de transactie
    //  afgeschreven en pas daarna werd het token aangemaakt. Ging dat mis —
    //  bijvoorbeeld omdat het serviceaccount het recht
    //  'iam.serviceAccounts.signBlob' miste — dan was de PIN weg terwijl de
    //  gebruiker niets had. Elke storing kostte dus een PIN, en die moest
    //  handmatig opnieuw worden aangevraagd.
    //
    //  Nu: mislukt het token, dan blijft de PIN geldig en kan hij het gewoon
    //  nog een keer proberen. Pas als er echt een token is, wordt de PIN
    //  onbruikbaar gemaakt.
    // ────────────────────────────────────────────────────────
    let customToken;
    try {
      // De claim `watch:true` maakt in de toekomst een beperkter rechtenmodel
      // mogelijk zonder dat de watch-login opnieuw op de schop hoeft.
      customToken = await admin.auth().createCustomToken(uid, { watch: true });
    } catch (e) {
      console.error('createCustomToken mislukt:', e);
      if (String(e?.errorInfo?.code || '').includes('insufficient-permission')
          || String(e?.message || '').includes('signBlob')) {
        throw new HttpsError('failed-precondition',
          'De server mag nog geen inlogtokens maken. Geef het serviceaccount de rol ' +
          '"Service Account Token Creator" in Google Cloud IAM. Je PIN blijft geldig.');
      }
      throw new HttpsError('internal', 'Inloggen mislukt. Je PIN blijft geldig, probeer het opnieuw.');
    }

    // Token staat — nu pas de PIN verbruiken (eenmalig gebruik).
    try {
      await fs.runTransaction(async (tx) => {
        const snap = await tx.get(pinRef);
        const pins2 = snap.exists ? (snap.data() || {}) : {};
        const nieuw = { ...pins2 };
        delete nieuw[hash];
        // Verlopen PIN's van anderen meteen opruimen.
        const nu2 = Date.now();
        for (const [k, v] of Object.entries(nieuw)) {
          if (!v || typeof v !== 'object' || !(v.expires > nu2)) delete nieuw[k];
        }
        tx.set(pinRef, nieuw);
      });
    } catch (e) {
      // Niet fataal: de gebruiker is ingelogd. De PIN verloopt vanzelf.
      console.warn('PIN opruimen mislukt (niet fataal):', e);
    }

    const spelerSnap = await fs.collection('spelers').doc(uid).get();
    const naam = spelerSnap.exists ? (spelerSnap.data().naam || '') : '';

    return { customToken, uid, naam };
  }
);

// ============================================================
//  PUNTENSYSTEEM — v4.2.0
//  Vervangt het client-side rang-herverdeel-algoritme door een server-side
//  score per speler. Zie puntensysteem-plan.md voor de volledige achtergrond.
//
//  Kern: elke speler heeft een `score` (getal) per ladder, opgeslagen in de
//  NIEUWE, afgeschermde subcollectie ladders/{id}/punten/{uid}. De publieke
//  positie (1..N, zichtbaar voor iedereen zoals altijd) wordt hieruit afgeleid
//  en blijft gewoon in ladders/{id}/standen/{uid}.rank staan — daar verandert
//  voor spelers niets aan.
//
//  score = basisScore + activiteitDelta
//   - basisScore: puur bepaald door partij-uitslagen. Bij elke partij wordt
//     eerst — EXACT dezelfde formules als het oude systeem (laagStijg,
//     hoogStijg, laagZak, hoogZak, drempel, verliezerNaarWinnaar) — de nieuwe
//     integer-positie van winnaar/verliezer bepaald, en de rest van de ladder
//     verschuift mee (identieke uitkomst als vroeger). Daarna krijgt IEDEREEN
//     een schone score volgens die positie (scoreVoorPositie) — dit vervangt
//     het kwetsbare "herverdeel de rest"-stapje volledig door een simpele,
//     altijd-correcte volledige hersortering.
//   - activiteitDelta: directe Node-port van verrijkMetActiviteit() uit
//     js/ladder.js — zelfde wiskunde (inactiviteitsstraf, frequentiebonus,
//     diversiteitsbonus), maar nu BLIJVEND verwerkt in de echte score i.p.v.
//     tijdelijk bij het weergeven. Wordt herberekend bij elke partij én
//     dagelijks via een scheduled function, zodat de positie ook zonder
//     nieuwe partijen actueel blijft (zoals voorheen bij elke pagina-load).
//
//  Beveiliging: ladders/{id}/punten/{uid} is in firestore.rules alleen
//  leesbaar voor het account met puntenBeheerder:true op spelers/{uid}, en
//  helemaal niet rechtstreeks schrijfbaar door clients — alle schrijfacties
//  lopen via deze Cloud Functions (Admin SDK, omzeilt de rules bewust).
// ============================================================

const PUNTEN_BASE = 1000000;
const PUNTEN_STAP = 100;
const FORS_STRAF  = 50000000; // ruim boven het bereik van basisScore -> altijd onderaan bij 'fors' + inactief
const WEEK_MS = 7 * 24 * 3600 * 1000;

const DEFAULT_LADDER_CONFIG = {
  laagStijg: 4, laagZak: 2, hoogStijg: 1, hoogZak: 1,
  verliezerNaarWinnaar: false, drempel: 4,
  inactiviteitAan: true,
  inactiviteitReferentiedatum: '2026-04-01',
  inactiviteitDrempelWeken: 4,
  inactiviteitModel: 'zacht',
  frequentieBonusAan: true,
  frequentieBonusPartijen: 3,
  frequentieBonusPlekken: 1,
  diversiteitsBonusAan: true,
  diversiteitsBonusDrempel: 6,
  diversiteitsBonusPlekken: 2,
  icoonAan: true,
  // v5.1.0: hoe vaak de activiteitscorrectie wordt verwerkt (maandag 04:00).
  // 'maand' = eerste maandag van de maand · 'week' = elke maandag.
  activiteitPeriode: 'maand',
};

// Kiest de juiste Firestore-database — (default) voor productie, named
// database 'test' voor de testomgeving. De client stuurt `isTest` mee, dezelfde
// vlag als IS_TEST in js/config.js.
//
// ⚠ v5.12.7 — WAT HIER STOND EN NIET KLOPTE. De opmerking beloofde dat een
// aanroep vanuit /test/ "nooit per ongeluk productiedata raakt". Dat is de
// bedoeling, niet wat de code afdwingt: de vlag komt van de browser en wordt
// hier niet gecontroleerd. Wie hem omzet, kiest de andere database.
//
// Wat de schade wél beperkt: elke functie leest zijn rollen en zijn
// deelnemerslijst uit DEZELFDE database. Iemand die niet in de live-ladder
// staat, krijgt daar dus permission-denied. Let op de uitzondering: een
// coordinator of beheerder is van de deelnemerscontrole vrijgesteld, dus voor
// die twee rollen is de vlag het enige dat de omgevingen scheidt.
//
// Dit is bewust niet gerepareerd: een echte scheiding vraagt twee Firebase-
// projecten, en dat raakt ook de inlogaccounts. Zie OPENSTAAND.md.
// ============================================================
//  DE TOERNOOI-PINCODE — v5.38.0
// ------------------------------------------------------------
//  Sierk, 19 september 2026: "Je kunt alleen maar meedoen met een toernooi als
//  je naam voorkomt en het toernooi gestart is. Om die reden wil ik het
//  inloggen vereenvoudigen." Een uitklaplijst met namen en vier cijfers.
//
//  WAAROM DIT NIET GEWOON EEN WACHTWOORD IS. Firebase eist minstens zes tekens
//  voor een wachtwoord, en een wachtwoord van vier cijfers zou bovendien
//  rechtstreeks bij Google te proberen zijn — buiten deze app om, zonder enige
//  rem. Daarom werkt het als de horloge-PIN die hier al jaren draait: de app
//  stuurt de pincode hierheen, de server kijkt hem na en geeft bij goedkeuring
//  een custom token terug. Alleen hier zit de rem, en de rem kan niet omzeild
//  worden omdat de pincode nergens anders geldig is.
//
//  DRIE GRENDELS, en ze zijn geen van drieën optioneel:
//
//   1. De pincode staat NERGENS. Alleen een SHA-256-afdruk, in
//      toernooien/{id}/beheer/gastlogin — een map waar alleen de coordinator
//      bij kan (firestore.rules).
//   2. Een COORDINATOR of BEHEERDER komt hier NOOIT doorheen. Anders is dat
//      ene getal, dat op de eerste tee wordt rondverteld, de sleutel tot het
//      hele beheerscherm. Zij gebruiken hun eigen wachtwoord.
//   3. Het token draagt de stempel `viaPin`. firestore.rules laat zo'n sessie
//      alleen aan het toernooi komen en nergens anders aan. Knoppen verbergen
//      in de app is géén vervanging daarvan.
//
//  ⚠ DE FOUTTELLER IS EEN AFWEGING, GEEN GRATIS BEVEILIGING. Vier cijfers zijn
//  10.000 mogelijkheden. Met TOERNOOI_PIN_MAX_FOUT pogingen per venster duurt
//  raden bij elkaar opgeteld dagen, en een toernooi duurt een dag. De prijs:
//  wie moedwillig fout tikt, zet de pincode voor iedereen even op slot. Dat is
//  bewust zo gekozen — een dichte deur is beter dan een deur die opengaat voor
//  wie lang genoeg rammelt. De coordinator kan altijd zelf inloggen en een
//  nieuwe pincode instellen.
// ============================================================

const TOERNOOI_PIN_MAX_FOUT     = 15;             // mislukte pogingen per venster
const TOERNOOI_PIN_FOUT_VENSTER = 10 * 60 * 1000; // en dat venster is 10 minuten

/**
 * Wissel de pincode van een lopend toernooi om voor een inlog.
 * Bewust NIET authenticatie-plichtig: dit ÍS de login.
 *
 * Input:  { toernooiId, spelerUid, pin: "1234", isTest?: boolean }
 * Output: { customToken, uid, naam }
 */
exports.wisselToernooiPin = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const data       = request.data || {};
    const pin        = String(data.pin ?? '').trim();
    const toernooiId = String(data.toernooiId ?? '').trim();
    const spelerUid  = String(data.spelerUid ?? '').trim();
    const isTest     = data.isTest === true;

    if (!/^\d{4}$/.test(pin)) {
      throw new HttpsError('invalid-argument', 'De pincode bestaat uit 4 cijfers.');
    }
    if (!toernooiId || !spelerUid) {
      throw new HttpsError('invalid-argument', 'Kies eerst je naam uit de lijst.');
    }

    const fs    = fsVoor(isTest);
    const tRef  = fs.collection('toernooien').doc(toernooiId);
    const tSnap = await tRef.get();
    if (!tSnap.exists) {
      throw new HttpsError('not-found', 'Dit toernooi bestaat niet meer.');
    }
    const toernooi = tSnap.data() || {};

    // Alleen een LOPEND toernooi. Is het afgesloten of geannuleerd, dan is de
    // pincode niets meer waard — precies wat Sierk bedoelde met "en het
    // toernooi gestart is".
    if (toernooi.status !== 'actief') {
      throw new HttpsError('failed-precondition', 'Dit toernooi loopt op dit moment niet.');
    }

    const speler = (toernooi.spelers || []).find(sp => sp && sp.uid === spelerUid);
    if (!speler) {
      throw new HttpsError('permission-denied', 'Deze naam doet niet mee aan dit toernooi.');
    }

    // Grendel 2. Let op de volgorde: dit gebeurt VÓÓR de foutteller, zodat een
    // poging op een coordinator niet de pincode voor de hele flight op slot zet.
    const spelerSnap = await fs.collection('spelers').doc(spelerUid).get();
    const rol = spelerSnap.exists ? (spelerSnap.data() || {}).rol : null;
    if (rol === 'coordinator' || rol === 'beheerder') {
      throw new HttpsError('permission-denied',
        'Wedstrijdleiding logt in met het eigen wachtwoord, niet met de pincode.');
    }

    const pinRef  = tRef.collection('beheer').doc('gastlogin');
    const foutRef = tRef.collection('beheer').doc('pinPogingen');
    const hash    = hashPin(pin);
    const nu      = Date.now();

    // Foutteller nakijken en de afdruk vergelijken in één transactie, zodat
    // twintig pogingen tegelijk de teller niet kunnen omzeilen.
    await fs.runTransaction(async (tx) => {
      const [foutSnap, pinSnap] = await Promise.all([tx.get(foutRef), tx.get(pinRef)]);

      const fout          = foutSnap.exists ? (foutSnap.data() || {}) : {};
      const vensterStart  = typeof fout.venster === 'number' ? fout.venster : 0;
      const binnenVenster = (nu - vensterStart) < TOERNOOI_PIN_FOUT_VENSTER;
      const fouten        = binnenVenster ? (fout.fouten || 0) : 0;
      if (fouten >= TOERNOOI_PIN_MAX_FOUT) {
        throw new HttpsError('resource-exhausted',
          'Te veel mislukte pogingen. Probeer het over 10 minuten opnieuw.');
      }

      const opgeslagen = pinSnap.exists ? (pinSnap.data() || {}).pinHash : null;
      if (!opgeslagen) {
        throw new HttpsError('failed-precondition',
          'Voor dit toernooi is nog geen pincode ingesteld. Vraag de wedstrijdleiding.');
      }
      if (opgeslagen !== hash) {
        tx.set(foutRef, { fouten: fouten + 1, venster: binnenVenster ? vensterStart : nu },
               { merge: true });
        throw new HttpsError('permission-denied', 'Die pincode klopt niet.');
      }

      tx.set(foutRef, { fouten: 0, venster: nu }, { merge: true });
    });

    // Grendel 3. `viaPin` is waar firestore.rules op kijkt; `toernooiId` staat
    // erbij zodat een volgende versie de sessie ook aan DIT toernooi kan binden
    // zonder dat de inlog opnieuw op de schop hoeft.
    let customToken;
    try {
      customToken = await admin.auth().createCustomToken(spelerUid, { viaPin: true, toernooiId });
    } catch (e) {
      console.error('createCustomToken mislukt:', e);
      if (String(e?.errorInfo?.code || '').includes('insufficient-permission')
          || String(e?.message || '').includes('signBlob')) {
        throw new HttpsError('failed-precondition',
          'De server mag nog geen inlogtokens maken. Geef het serviceaccount de rol ' +
          '"Service Account Token Creator" in Google Cloud IAM.');
      }
      throw new HttpsError('internal', 'Inloggen mislukt, probeer het opnieuw.');
    }

    return { customToken, uid: spelerUid, naam: speler.naam || '' };
  }
);

// ============================================================
//  DE QR-CODE VAN EEN RONDE — v5.40.0
// ------------------------------------------------------------
//  Sierk, 20 september 2026: "Het maakt volgens mij niet uit wie je bent,
//  iedereen in de ronde kan de score van iedereen invullen. Dus een unieke QR
//  per ronde en scan je die dan zit je in die ronde."
//
//  Nagemeten en hij heeft gelijk: firestore.rules staat elke speler in de
//  ladder toe om ELK scoredocument van een partij te schrijven, en de
//  scorekaart tekent alle kolommen zonder slot. Er valt dus niets te kiezen na
//  het scannen — je bent gewoon "iemand in deze ronde".
//
//  ⚠ DE SLEUTEL WORDT NERGENS BEWAARD, OOK NIET ALS AFDRUK.
//  Hij wordt elke keer opnieuw UITGEREKEND uit één serverlijk geheim plus het
//  partijnummer:  sleutel = HMAC(geheim, partijId).
//
//  Waarom niet gewoon opslaan? Omdat de lopende partijen in het LADDERDOCUMENT
//  staan (`ladders/{id}.actievePartijen`), en dat document mag elke ingelogde
//  speler lezen — ook een gast die net met een QR is binnengekomen. Sla je de
//  sleutel daar op, dan kan die gast de sleutel van een ANDERE partij lezen en
//  zich daar ook naar binnen scannen. Door hem uit te rekenen bestaat hij
//  nergens: niet in de database, alleen in de QR-code zelf.
//
//  Het geheim staat in ladder/qrGeheim, een document dat in firestore.rules
//  volledig dicht staat (read én write op false) — net als ladder/watchPins.
//  Alleen deze functies komen er via de Admin SDK bij.
// ============================================================

const QR_SLEUTEL_LENGTE = 22;

// Het serverlijke geheim. Wordt bij het eerste gebruik aangemaakt en daarna
// nooit meer gewijzigd: een nieuw geheim zou elke QR die al is uitgedeeld in
// één klap ongeldig maken, midden in een ronde.
async function _qrGeheim(fs) {
  const ref = fs.collection('ladder').doc('qrGeheim');
  const snap = await ref.get();
  const bestaand = snap.exists ? (snap.data() || {}).geheim : null;
  if (typeof bestaand === 'string' && bestaand.length >= 32) return bestaand;
  const nieuw = crypto.randomBytes(32).toString('hex');
  await ref.set({ geheim: nieuw, gemaakt: Date.now() }, { merge: true });
  return nieuw;
}

function _qrSleutel(geheim, partijId) {
  return crypto.createHmac('sha256', geheim)
    .update(String(partijId), 'utf8')
    .digest('base64url')
    .slice(0, QR_SLEUTEL_LENGTE);
}

// Loopt deze partij nog? Een afgeronde of verdwenen partij geeft geen toegang.
function _lopendePartij(ladderDoc, partijId) {
  const partijen = (ladderDoc || {}).actievePartijen || [];
  return partijen.find(p => p && p.partijId === partijId) || null;
}

/**
 * De QR-code van een ronde. Alleen voor wie al is ingelogd — je moet de ronde
 * kunnen zien om hem te kunnen laten zien.
 *
 * Input:  { ladderId, partijId, basis, isTest? }
 * Output: { url, svg }
 */
exports.maakRondeQr = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');

    const ladderId = String(data?.ladderId ?? '').trim();
    const partijId = String(data?.partijId ?? '').trim();
    const basis    = String(data?.basis ?? '').trim();
    if (!ladderId || !partijId) {
      throw new HttpsError('invalid-argument', 'Onbekende ronde.');
    }
    // Alleen een http(s)-adres van de app zelf. Zonder deze toets zou iemand
    // een QR laten maken die ergens anders heen wijst.
    if (!/^https?:\/\/[^\s"']+$/.test(basis)) {
      throw new HttpsError('invalid-argument', 'Ongeldig webadres.');
    }

    const fs = fsVoor(data?.isTest === true);
    const ladderSnap = await fs.collection('ladders').doc(ladderId).get();
    if (!ladderSnap.exists) throw new HttpsError('not-found', 'Deze ladder bestaat niet.');
    if (!_lopendePartij(ladderSnap.data(), partijId)) {
      throw new HttpsError('failed-precondition', 'Deze ronde loopt niet meer.');
    }

    const sleutel = _qrSleutel(await _qrGeheim(fs), partijId);
    const scheiding = basis.includes('?') ? '&' : '?';
    const url = `${basis}${scheiding}r=${encodeURIComponent(partijId)}`
              + `&l=${encodeURIComponent(ladderId)}&k=${encodeURIComponent(sleutel)}`;

    // Foutcorrectie M en een rustrand van 4 vakjes: dezelfde keuzes als bij de
    // vaste QR uit v5.37.0, en om dezelfde reden.
    const svg = await QRCode.toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { url, svg };
  }
);

/**
 * Wissel een gescande sleutel om voor een inlog in die ronde.
 * Bewust NIET authenticatie-plichtig: dit ÍS de login.
 *
 * Input:  { ladderId, partijId, sleutel, isTest? }
 * Output: { customToken, partijId }
 */
exports.wisselRondeSleutel = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const data     = request.data || {};
    const ladderId = String(data.ladderId ?? '').trim();
    const partijId = String(data.partijId ?? '').trim();
    const sleutel  = String(data.sleutel ?? '').trim();
    if (!ladderId || !partijId || !sleutel) {
      throw new HttpsError('invalid-argument', 'Deze link is niet compleet.');
    }

    const fs = fsVoor(data.isTest === true);
    const ladderSnap = await fs.collection('ladders').doc(ladderId).get();
    if (!ladderSnap.exists) throw new HttpsError('not-found', 'Deze ronde bestaat niet meer.');
    const partij = _lopendePartij(ladderSnap.data(), partijId);
    if (!partij) {
      throw new HttpsError('failed-precondition',
        'Deze ronde is afgelopen. De code werkt niet meer.');
    }

    // Geen foutteller nodig: de sleutel is 22 tekens uit een HMAC. Raden kost
    // meer tijd dan er ronden gespeeld worden. Wel in vaste tijd vergelijken,
    // zodat de duur van het antwoord niets verraadt.
    const verwacht = _qrSleutel(await _qrGeheim(fs), partijId);
    const a = Buffer.from(sleutel);
    const b = Buffer.from(verwacht);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new HttpsError('permission-denied', 'Deze code hoort niet bij deze ronde.');
    }

    // ⚠ EÉN TIJDELIJK PROFIEL PER RONDE, niet per gast.
    // Zonder profiel gooit de app je meteen weer uit ("Je hebt geen toegang") —
    // dat zit in setIngelogd() en geldt voor iedereen. Het profiel draagt
    // `rondeGast: true` zodat het opruimen het herkent, en het staat NIET in
    // een ladder, dus het duikt nergens in een spelerslijst op.
    const uid = 'rondegast_' + partijId;
    await fs.collection('spelers').doc(uid).set({
      uid,
      naam: 'Gast',
      rol: 'speler',
      hcp: 0,
      eersteLogin: false,
      rondeGast: true,
      partijId,
      ladderId,
      gemaakt: Date.now(),
    }, { merge: true });

    let customToken;
    try {
      customToken = await admin.auth().createCustomToken(uid, { viaRonde: partijId, ladderId });
    } catch (e) {
      console.error('createCustomToken mislukt:', e);
      throw new HttpsError('internal', 'Inloggen mislukt, probeer het opnieuw.');
    }
    return { customToken, partijId };
  }
);

function fsVoor(isTest) {
  return getFirestore(admin.app(), isTest ? 'test' : '(default)');
}

// ============================================================
//  v5.7.0 — VERSCHUIVINGEN BIJ AMERIKAANTJE EN HIGH-LOW
// ============================================================
//  Anders dan matchplay staat de verschuiving hier LOS van de ladderpositie.
//  Wie het Amerikaantje wint stijgt twee plekken, of hij nu eerste of vijftigste
//  stond. Dat is een bewuste keuze: het zijn groepsspelvormen, geen duel tussen
//  twee mensen met een ranglijstverschil.
//
//  De client stuurt alleen de eindstand — wie eerste, tweede en derde werd.
//  De tabel staat hier, op de server, zodat een gemanipuleerde app geen eigen
//  aantallen plekken kan opgeven.
// ============================================================

// Posities zijn 1-gebaseerd met gedeelde plekken volgens sportgebruik:
//   [1,2,3] alle verschillend · [1,1,3] gedeeld eerste · [1,2,2] gedeeld tweede
//   [1,1,1] alle drie gelijk
function verschuivingAmerikaantje(posities) {
  const p = Array.isArray(posities) ? posities.map(Number) : [];
  if (p.length !== 3 || p.some(x => !Number.isInteger(x))) return null;
  const sleutel = p.slice().sort((a, b) => a - b).join(',');
  const tabel = {
    '1,2,3': { 1: 2, 2: 0, 3: -2 },   // eerste +2, tweede 0, derde -2
    '1,1,3': { 1: 1, 3: -2 },         // gedeeld eerste: beiden +1, derde -2
    '1,2,2': { 1: 2, 2: -1 },         // gedeeld tweede: eerste +2, beiden -1
    '1,1,1': { 1: 0 },                // alle drie gelijk: niemand beweegt
  };
  const map = tabel[sleutel];
  if (!map) return null;              // ongeldige eindstand -> weigeren
  return p.map(x => map[x]);
}

// Wie op de eerste plek eindigt (ook gedeeld) boekt een winst.
function winstAmerikaantje(posities) {
  const p = Array.isArray(posities) ? posities.map(Number) : [];
  return p.map(x => x === 1);
}

// teams: 0 of 1 per speler. winnend: 0, 1, of null bij gelijkspel.
function verschuivingHighlow(teams, winnend) {
  const t = Array.isArray(teams) ? teams.map(Number) : [];
  if (t.length !== 4 || t.some(x => x !== 0 && x !== 1)) return null;
  if (t.filter(x => x === 0).length !== 2) return null;
  if (winnend !== 0 && winnend !== 1 && winnend !== null) return null;
  if (winnend === null) return t.map(() => 0);
  return t.map(x => (x === winnend ? 1 : -1));
}

// ------------------------------------------------------------
//  Alle verschuivers TEGELIJK plaatsen.
//
//  WAAROM NIET EEN VOOR EEN. Bij een gedeelde eerste plaats krijgen twee
//  spelers dezelfde verschuiving, en dan bestaat er geen "eerste om te
//  verwerken". Nagerekend op een ladder waarin A tiende en B elfde staat en
//  beiden +1 krijgen:
//      A eerst verwerkt -> 9=A  10=B  11=p9    beiden stijgen
//      B eerst verwerkt -> 9=p9 10=A  11=B     er gebeurt niets
//  Dezelfde uitslag, twee verschillende ladders, puur door de volgorde waarin
//  de code de spelers toevallig aflooopt. Twee winnaars kregen dan zonder
//  enige melding allebei niets.
//
//  Nu krijgt iedereen zijn doelplek in één keer toegewezen. Botsingen worden
//  opgelost met een vaste regel (grootste verschuiving eerst, dan wie al hoger
//  stond) en de rest van de ladder schuift op met behoud van onderlinge
//  volgorde. Uitkomst is daarmee onafhankelijk van de verwerkingsvolgorde.
// ------------------------------------------------------------
function verschuifAllemaal(werklijst, zetten) {
  const n = werklijst.length;
  if (!n) return werklijst;
  const doelen = (zetten || [])
    .map(z => {
      const s = werklijst.find(x => x.uid === z.uid);
      if (!s) return null;                       // geen ladderlid (meer) -> overslaan
      return { uid: z.uid, delta: z.delta, oud: s.rank,
               doel: Math.min(n, Math.max(1, s.rank - z.delta)) };
    })
    .filter(Boolean)
    .sort((a, b) => (b.delta - a.delta) || (a.oud - b.oud));

  const bezet = new Set(); const plaats = {};
  for (const d of doelen) {
    let r = d.doel;
    while (bezet.has(r) && r < n) r++;
    while (bezet.has(r) && r > 1) r--;
    bezet.add(r); plaats[d.uid] = r;
  }
  const vrij = []; for (let r = 1; r <= n; r++) if (!bezet.has(r)) vrij.push(r);
  werklijst.filter(s => plaats[s.uid] === undefined)
    .sort((a, b) => a.rank - b.rank)
    .forEach((s, i) => { s.rank = vrij[i]; });
  werklijst.forEach(s => { if (plaats[s.uid] !== undefined) s.rank = plaats[s.uid]; });
  return werklijst;
}

// v5.7.1: Firestore accepteert geen lijst binnen een lijst. Zo'n document
// wordt geweigerd met een melding die niets zegt over de oorzaak — bij High-Low
// leverde dat "controleer je verbinding of rechten" op terwijl er niets mis was
// met de verbinding. Deze controle wijst het veld aan.
function zoekGenesteLijsten(waarde, pad) {
  pad = pad || '';
  const uit = [];
  if (Array.isArray(waarde)) {
    waarde.forEach((x, i) => {
      if (Array.isArray(x)) uit.push(pad + '[' + i + ']');
      else uit.push(...zoekGenesteLijsten(x, pad + '[' + i + ']'));
    });
  } else if (waarde && typeof waarde === 'object') {
    for (const k of Object.keys(waarde)) {
      uit.push(...zoekGenesteLijsten(waarde[k], pad ? pad + '.' + k : k));
    }
  }
  return uit;
}

// Score die bij een schone integer-positie hoort (1 = hoogste score).
function scoreVoorPositie(positie) {
  return PUNTEN_BASE - (Math.max(1, positie) - 1) * PUNTEN_STAP;
}

function _uitslagTs(u) {
  if (u && u.scoreTs) return u.scoreTs;
  if (u && u.datum) {
    const p = String(u.datum).split('-').map(Number);
    if (p.length === 3 && p.every(n => !isNaN(n))) {
      return new Date(p[2], p[1] - 1, p[0]).getTime();
    }
  }
  return null;
}

// v5.0.0 (punt 6): activiteit wordt op UID bijgehouden in plaats van op naam.
//
// WAAROM: tot v4.2.0 was de spelersnaam de sleutel. Twee spelers met dezelfde
// naam smolten daardoor samen tot één statistiek, en een naamswijziging wiste
// iemands historie — terwijl die statistiek wél meebepaalt waar je op de
// ladder staat. De rest van de app werkt consequent op uid; dit was de enige
// plek waar dat werd losgelaten.
//
// TERUGVAL VOOR OUDE DATA: uitslagen die vóór v5.0.0 zijn weggeschreven
// bevatten alleen namen (`spelers: [naam]`, `matchups: [{a,b,winnaar}]`).
// Voor die records vertalen we naam -> uid via `naamNaarUid`. Is een naam niet
// of niet uniek te herleiden, dan valt die entry terug op de naam als sleutel
// (zoals vroeger) — dan is de uitkomst hooguit gelijk aan het oude gedrag,
// nooit slechter. Nieuwe uitslagen bevatten `spelerUids` + `matchupUids` en
// hebben die vertaalslag niet nodig.
function bouwNaamNaarUid(spelersDocs) {
  const perNaam = {};
  for (const [uid, naam] of Object.entries(spelersDocs || {})) {
    const sleutel = String(naam || '').trim().toLowerCase();
    if (!sleutel) continue;
    (perNaam[sleutel] || (perNaam[sleutel] = [])).push(uid);
  }
  const map = {};
  // Alleen éénduidige namen vertalen. Bij dubbele namen laten we de vertaling
  // bewust achterwege — dan is terugvallen op de naam eerlijker dan gokken.
  for (const [naam, uids] of Object.entries(perNaam)) {
    if (uids.length === 1) map[naam] = uids[0];
  }
  return map;
}

function berekenActiviteitsStats(uitslagen, toernooien, cfg, nu, naamNaarUid = {}) {
  const refTs = new Date(cfg.inactiviteitReferentiedatum || '2026-04-01').getTime();
  const nuD = new Date(nu);
  const huidigeMaand = nuD.getFullYear() * 12 + nuD.getMonth();
  const stat = {};
  const ensure = k => (stat[k] || (stat[k] = { laatst: null, maand: 0, opp: new Set() }));
  // Sleutel bepalen: uid als we die hebben, anders de naam (legacy-terugval).
  const sleutel = (uid, naam) => {
    if (uid) return uid;
    const n = String(naam || '').trim();
    if (!n) return null;
    return naamNaarUid[n.toLowerCase()] || n;
  };

  for (const u of (uitslagen || [])) {
    // v5.41.0: een spelvorm die voor deze ladder niet meetelt, telt ook niet
    // mee voor de frequentie- en diversiteitsbonus. Anders verschuift zo'n
    // partij de speler alsnog — langs de achterdeur van de activiteitscorrectie.
    // Ontbreekt het veld (alles van vóór v5.41.0), dan telt de uitslag gewoon.
    if (u && u.teltMee === false) continue;
    const ts = _uitslagTs(u);
    if (ts == null) continue;
    const d = new Date(ts);
    const maandKey = d.getFullYear() * 12 + d.getMonth();

    // v5.0.0 schrijft spelerUids mee; oudere records hebben alleen namen.
    const uids  = Array.isArray(u.spelerUids) ? u.spelerUids : null;
    const namen = Array.isArray(u.spelers) ? u.spelers : [];
    const deelnemers = uids
      ? uids.map(uid => sleutel(uid, null))
      : namen.map(n => sleutel(null, n));

    for (const k of deelnemers) {
      if (!k) continue;
      const s = ensure(k);
      if (s.laatst == null || ts > s.laatst) s.laatst = ts;
      if (maandKey === huidigeMaand) s.maand++;
    }

    // v5.1.0: de diversiteitsbonus telt unieke tegenstanders van DEZE MAAND,
    // niet meer sinds de referentiedatum. Zo meet hij hetzelfde tijdvak als de
    // frequentiebonus, en telt hij niet een heel seizoen door.
    if (maandKey === huidigeMaand) {
      const mus = Array.isArray(u.matchupUids) && u.matchupUids.length
        ? u.matchupUids.map(m => ({ a: sleutel(m.a, null), b: sleutel(m.b, null) }))
        : (u.matchups || []).map(m => ({ a: sleutel(null, m.a), b: sleutel(null, m.b) }));
      for (const m of mus) {
        if (m.a && m.b && m.a !== m.b) { ensure(m.a).opp.add(m.b); ensure(m.b).opp.add(m.a); }
      }
    }
  }

  for (const t of (toernooien || [])) {
    for (const dag of (t.dagen || [])) {
      const gespeeld = dag.afgerond === true || (dag.datum && new Date(dag.datum).getTime() <= nu);
      if (!gespeeld || !dag.datum) continue;
      const ts = new Date(dag.datum).getTime();
      if (isNaN(ts)) continue;
      const dd = new Date(ts);
      const maandKey = dd.getFullYear() * 12 + dd.getMonth();
      const flights = Array.isArray(dag.flights) ? dag.flights : [];
      // Toernooispelers hebben altijd een uid (gasten krijgen een gast_-id).
      const dagDeelnemers = flights.length
        ? flights.flatMap(f => (f.spelers || []).map(s => sleutel(s.uid, s.naam)))
        : (t.spelers || []).map(s => sleutel(s.uid, s.naam));
      for (const k of dagDeelnemers) {
        if (!k) continue;
        const s = ensure(k);
        if (s.laatst == null || ts > s.laatst) s.laatst = ts;
        if (maandKey === huidigeMaand) s.maand++;
      }
      // v5.1.0: ook hier alleen deze maand — zie hierboven.
      if (maandKey === huidigeMaand) {
        for (const f of flights) {
          const inFlight = (f.spelers || []).map(s => sleutel(s.uid, s.naam)).filter(Boolean);
          for (const a of inFlight) for (const b of inFlight) {
            if (a !== b) ensure(a).opp.add(b);
          }
        }
      }
    }
  }
  return stat; // uid (of naam als terugval) -> { laatst, maand, opp:Set (deze maand) }
}

function _straf(weken, cfg) {
  const drempel = cfg.inactiviteitDrempelWeken ?? 4;
  const model = cfg.inactiviteitModel || 'zacht';
  if (cfg.inactiviteitAan === false || weken < drempel) return 0;
  const over = weken - drempel + 1;
  if (model === 'zacht') return Math.min(6, over);
  if (model === 'middel') return Math.min(14, over * 2);
  return 9999; // 'fors' -> aparte behandeling in doelVerschuivingVoorSpeler
}

// ============================================================
//  DOELVERSCHUIVING — v5.1.0
// ------------------------------------------------------------
//  WAT ER MIS WAS (v4.2.0 t/m v5.0.1): de activiteitscorrectie werd bij ELKE
//  partij opnieuw op de score toegepast, terwijl de score waarop hij werd
//  toegepast die correctie al bevatte. Daardoor stapelde hij op: een actieve
//  speler steeg elke partij een paar plekken extra — ook als hij verloor — en
//  een inactieve speler zakte bij elke partij in de ladder verder weg, ook bij
//  partijen waar hij niets mee te maken had.
//
//  HOE HET NU WERKT:
//   - Een partij verschuift alleen volgens de win/verlies-regels. Geen
//     activiteit. Zie verwerkPartijUitslag.
//   - De activiteitscorrectie draait apart, periodiek (maandag 04:00; per
//     ladder maandelijks of wekelijks). Zie verwerkActiviteitPeriodiek.
//   - Deze functie geeft de DOELverschuiving in PLEKKEN: waar de speler hoort
//     te staan ten opzichte van zijn competitiepositie. Bij elke run wordt
//     alleen het VERSCHIL met de al toegepaste verschuiving doorgevoerd
//     (opgeslagen in punten/{uid}.activiteitVerschuiving). Daarmee blijven
//     alle bestaande instellingen — inclusief de maxima van 6 en 14 — precies
//     werken zoals ze bedoeld zijn, zonder ooit op te stapelen.
//
//  Positief = omhoog (bonus), negatief = omlaag (straf).
//
//  `sleutel` is de uid (v5.0.0); `terugvalNaam` dekt spelers wier historie
//  volledig uit uitslagen van vóór v5.0.0 bestaat.
//  `positie` en `aantalSpelers` zijn alleen nodig voor het model 'fors': daar
//  is het doel "onderaan", en dat is een verschuiving die van de huidige
//  positie afhangt. Door het zo uit te rekenen kan de speler bij terugkeer
//  exact even ver terugklimmen.
// ============================================================
function doelVerschuivingVoorSpeler(sleutel, stat, cfg, terugvalNaam = null, positie = 1, aantalSpelers = 1, nu = Date.now()) {
  const refTs = new Date(cfg.inactiviteitReferentiedatum || '2026-04-01').getTime();
  const st = stat[sleutel]
    || (terugvalNaam ? stat[terugvalNaam] : null)
    || { laatst: null, maand: 0, opp: new Set() };

  const model    = cfg.inactiviteitModel || 'zacht';
  const inactAan = cfg.inactiviteitAan !== false;
  const freqAan  = cfg.frequentieBonusAan !== false;
  const divAan   = cfg.diversiteitsBonusAan !== false;
  const freqMin  = cfg.frequentieBonusPartijen ?? 3;
  const freqPlek = cfg.frequentieBonusPlekken ?? 1;
  const divMin   = cfg.diversiteitsBonusDrempel ?? 6;
  const divPlek  = cfg.diversiteitsBonusPlekken ?? 2;

  const fb = (freqAan && st.maand > freqMin) ? freqPlek : 0;
  const db = (divAan && st.opp.size > divMin) ? divPlek : 0;

  if (model === 'fors' && inactAan) {
    const actief = st.laatst != null && st.laatst >= refTs;
    // Inactief bij 'fors' = onderaan. De verschuiving is dus precies het
    // aantal plekken tot de laatste plaats; staat hij er al, dan is het 0.
    if (!actief) return -(Math.max(0, aantalSpelers - positie));
    return fb + db;
  }

  const inactiefSinds = st.laatst ? Math.max(st.laatst, refTs) : refTs;
  const weken = refTs ? Math.max(0, Math.floor((nu - inactiefSinds) / WEEK_MS)) : 0;
  const strafPlekken = _straf(weken, cfg);
  return fb + db - strafPlekken;
}

// v3.0.0-11.63: wachtwoord wordt geladen uit Firestore (ladder/config).
// Geen fallback — gooit een HttpsError als het document of veld ontbreekt.
// v5.5.0: leest uit de database die bij de omgeving hoort. Stond op
// admin.firestore(), en dat is altijd (default) — dus productie, ook als de
// aanroep uit /test/ kwam.
async function getInitieelWachtwoord(isTest) {
  const snap = await fsVoor(isTest).doc('ladder/config').get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'ladder/config ontbreekt in Firestore — stel initieelWachtwoord in via het beheerscherm');
  }
  const w = snap.data().initieelWachtwoord;
  if (typeof w !== 'string' || w.length === 0) {
    throw new HttpsError('failed-precondition', 'initieelWachtwoord is leeg in ladder/config — stel het in via het beheerscherm');
  }
  return w;
}

/**
 * Reset een speler-wachtwoord naar het initiële wachtwoord.
 * Alleen aanroepbaar door een beheerder.
 *
 * Input:  { targetUid: "<uid_van_te_resetten_speler>" }
 * Output: { success: true } of throws HttpsError
 */
exports.resetSpelerWachtwoord = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;

    // Stap 1: ingelogd?
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    }

    // Stap 2: target-uid meegestuurd?
    const targetUid = data?.targetUid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid ontbreekt of ongeldig.');
    }

    // v5.5.0 — WAT HIER MIS WAS. Deze functie las en schreef via
    // admin.firestore(), en dat is altijd de (default)-database. Een reset
    // vanuit het testbeheerscherm zette dus eersteLogin:true op het ECHTE
    // spelersdocument, waarna die speler bij zijn volgende bezoek aan de
    // gewone app ongevraagd het verplichte profielscherm kreeg. Testen
    // beschadigde zo productiedata. De helper fsVoor() bestond al en werd door
    // zestien andere functies gewoon gebruikt; hier was hij overgeslagen.
    const isTest = data?.isTest === true;
    const fs = fsVoor(isTest);

    // Stap 3: aanroeper is beheerder?
    const caller = await fs.doc(`spelers/${auth.uid}`).get();
    if (!caller.exists || caller.data().rol !== 'beheerder') {
      throw new HttpsError('permission-denied', 'Alleen een beheerder mag wachtwoorden resetten.');
    }

    // Stap 4: target-account bestaat?
    const target = await fs.doc(`spelers/${targetUid}`).get();
    if (!target.exists) {
      throw new HttpsError('not-found', 'Speler niet gevonden in database.');
    }

    // Stap 5: wachtwoord ophalen — gooit HttpsError('failed-precondition') als config ontbreekt.
    // Staat buiten de inner try/catch zodat die specifieke fout ongehinderd omhoog bubbelt.
    const initieelWachtwoord = await getInitieelWachtwoord(isTest);

    try {
      // Stap 6: Auth wachtwoord overschrijven
      await admin.auth().updateUser(targetUid, { password: initieelWachtwoord });

      // Stap 7: eersteLogin:true zodat speler verplicht profielflow krijgt
      await fs.doc(`spelers/${targetUid}`).update({
        eersteLogin: true
      });

      return {
        success: true,
        nieuwWachtwoord: initieelWachtwoord,
        message: `Wachtwoord van ${target.data().naam} gereset`
      };
    } catch (err) {
      console.error('resetSpelerWachtwoord fout:', err);
      throw new HttpsError('internal', 'Reset mislukt: ' + err.message);
    }
  }
);

/**
 * Voltooi de eerste-login. Zet het door de speler zelf gekozen wachtwoord en
 * handicap en markeert eersteLogin:false. Server-side via de Admin SDK, zodat er
 * GEEN auth/requires-recent-login kan optreden en er geen client-side reauth of
 * store.initieelWachtwoord nodig is (v3.0.4).
 *
 * Input:  { nieuwWachtwoord: string (>=6), hcp: number }
 * Output: { success: true } of throws HttpsError
 */
exports.voltooiEersteLogin = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;

    // Stap 1: ingelogd?
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    }

    // Stap 2: invoer valideren
    const nieuwWachtwoord = data?.nieuwWachtwoord;
    if (typeof nieuwWachtwoord !== 'string' || nieuwWachtwoord.length < 6) {
      throw new HttpsError('invalid-argument', 'Wachtwoord moet minimaal 6 tekens zijn.');
    }
    const hcp = Math.round(Number(data?.hcp));
    if (!Number.isFinite(hcp) || hcp < -10 || hcp > 54) {
      throw new HttpsError('invalid-argument', 'Ongeldige handicap.');
    }

    // v5.5.0 — WAT HIER MIS WAS. Ook deze functie schreef via
    // admin.firestore() en dus altijd naar productie. Een speler die in /test/
    // het eerste-loginscherm invulde, kreeg eersteLogin:false én zijn nieuwe
    // handicap weggeschreven naar de ECHTE database. De testdatabase bleef op
    // eersteLogin:true staan, dus het scherm kwam elke keer terug — precies
    // het gedrag dat in de testomgeving werd gezien en in productie niet.
    const isTest = data?.isTest === true;

    // Stap 3: profiel bestaat en is daadwerkelijk een eerste-login?
    const spelerRef  = fsVoor(isTest).doc(`spelers/${auth.uid}`);
    const spelerSnap = await spelerRef.get();
    if (!spelerSnap.exists) {
      throw new HttpsError('not-found', 'Speler niet gevonden in database.');
    }
    if (spelerSnap.data().eersteLogin !== true) {
      // Idempotent: al voltooid. Geen fout — voorkomt vastlopen bij dubbele tik
      // of een herhaalde aanroep na een netwerk-hapering.
      return { success: true, alVoltooid: true };
    }

    try {
      // Stap 4: Auth-wachtwoord zetten (Admin SDK — geen recentheidseis)
      await admin.auth().updateUser(auth.uid, { password: nieuwWachtwoord });

      // Stap 5: profiel bijwerken — hcp + eersteLogin:false
      await spelerRef.update({ hcp, eersteLogin: false });

      return { success: true };
    } catch (err) {
      console.error('voltooiEersteLogin fout:', err);
      throw new HttpsError('internal', 'Voltooien mislukt: ' + err.message);
    }
  }
);

// ============================================================
//  UITSLAGVALIDATIE — v5.0.0 (punt 2)
// ------------------------------------------------------------
//  WAT ER MIS WAS (v4.2.0): verwerkPartijUitslag controleerde alleen "zit je
//  in deze ladder" en geloofde daarna klakkeloos welke winnaar de client
//  meestuurde. Er werd geen partij opgezocht, niet gecontroleerd of de
//  aanroeper meespeelde, en niets tegen dubbel verwerken gedaan. Iemand met de
//  browserconsole kon zichzelf daarmee in een paar aanroepen op plek 1 zetten.
//
//  WAT ER BEWUST NIET VERANDERT: scores invullen blijft optioneel. Je kunt nog
//  steeds een partij starten en meteen naar het uitslagscherm om de winnaar
//  aan te wijzen. De server rekent de uitslag dus NIET dwingend na.
//
//  WAT ER WEL WORDT GECONTROLEERD:
//   a. De partij bestaat (op partijId, in de nieuwe partijen-subcollectie of
//      in de oude actievePartijen-array). Verzinnen kan niet meer.
//   b. De doorgegeven matchups komen overeen met de matchups zoals ze bij het
//      starten zijn vastgelegd. Een andere tegenstander opgeven kan niet meer.
//   c. De aanroeper speelde zelf mee (of is coordinator/beheerder). Andermans
//      partij afsluiten kan niet meer.
//   d. De partij is nog niet eerder verwerkt (ladders/{id}/verwerkt/{partijId}).
//      Een netwerkhapering + retry telt de partij niet meer dubbel.
//   e. Staan er scores die de match onmiskenbaar beslissen, dan moet de
//      opgegeven winnaar daarmee overeenkomen. Zijn er geen scores, of is het
//      gelijkspel, dan telt gewoon de keuze van de speler — precies zoals nu.
//
//  Wat overblijft is een speler die een écht gespeelde partij verkeerd
//  rapporteert. Dat is geen technisch probleem meer maar een sociaal, en
//  hoort bij de bewuste keuze dat scores optioneel zijn. Daarom leggen we
//  vast wie de uitslag indiende (`gerapporteerdDoor`) en kan de coordinator
//  hem terugdraaien met `draaiPartijTerug`.
// ============================================================

// Haal de partij op: eerst uit de nieuwe subcollectie (v5.0.0), anders uit de
// oude actievePartijen-array in het ladderdocument. Tijdens de dubbel-schrijven
// -periode bestaan beide; daarna alleen nog de subcollectie.
async function _zoekPartij(fs, ladderRef, ladderData, partijId) {
  try {
    const snap = await ladderRef.collection('partijen').doc(partijId).get();
    if (snap.exists) return { partij: snap.data(), bron: 'subcollectie' };
  } catch (e) { /* val terug op de array */ }
  const arr = Array.isArray(ladderData.actievePartijen) ? ladderData.actievePartijen : [];
  const p = arr.find(x => x && x.partijId === partijId);
  return p ? { partij: p, bron: 'array' } : { partij: null, bron: null };
}

// Scores van een partij ophalen als { uid: [hole0, hole1, ...] }.
// v5.0.0 schrijft per speler een document met een holes-map; oudere partijen
// hebben de scores nog als array in het partij-object zelf.
async function _leesPartijScores(ladderRef, partijId, partij) {
  const uit = {};
  try {
    const snap = await ladderRef.collection('partijen').doc(partijId).collection('scores').get();
    snap.forEach(d => {
      const holes = (d.data() || {}).holes || {};
      const arr = [];
      for (const [k, v] of Object.entries(holes)) {
        const i = parseInt(k, 10);
        if (Number.isInteger(i) && i >= 0) arr[i] = (v === undefined ? null : v);
      }
      uit[d.id] = arr;
    });
  } catch (e) { /* val terug op de oude structuur */ }
  if (Object.keys(uit).length === 0 && partij && partij.scores) {
    for (const [uid, arr] of Object.entries(partij.scores)) {
      if (Array.isArray(arr)) uit[uid] = arr;
    }
  }
  return uit;
}

// ────────────────────────────────────────────────────────────
//  v5.8.0 — Node-port van slagenPerHole() uit js/hcp.js.
//  LET OP: deze functie MOET gelijk blijven aan die in js/hcp.js. Wijkt hij
//  af, dan weigert de server een winnaar die de app wel als winnaar toont.
//  Sinds v5.8.0 kan een partij afspreken dat de slagen niet op de laagste
//  stroke-indexen vallen maar daar net achter (hcpPlaatsing = 'vanaf').
//  De slagen horen bij stroke-indexnummers, niet bij "de zwaarste gespeelde
//  holes": speel je negen holes, dan liggen niet alle stroke-indexen op de
//  kaart en vang je maar een deel van de slagen op.
// ────────────────────────────────────────────────────────────
function _slagenPerHole(totaalSlagen, holes, plaatsing) {
  const lijst = Array.isArray(holes) ? holes : [];
  const H = lijst.length;
  const uit = new Array(H).fill(0);
  const n = Math.max(0, Math.round(Number(totaalSlagen) || 0));
  if (H === 0 || n === 0) return uit;
  if (plaatsing === 'vanaf') {
    const perSi = new Array(H + 1).fill(0);
    for (let k = 0; k < n; k++) perSi[((n + k) % H) + 1]++;
    for (let i = 0; i < H; i++) {
      const si = Number(lijst[i] && lijst[i].si);
      if (Number.isFinite(si) && si >= 1 && si <= H) uit[i] = perSi[si];
    }
    return uit;
  }
  const eerste = Math.min(n, H);
  const tweede = Math.max(0, n - H);
  for (let i = 0; i < H; i++) {
    const si = Number(lijst[i] && lijst[i].si);
    if (!Number.isFinite(si)) continue;
    uit[i] = (si <= eerste ? 1 : 0) + (si <= tweede ? 1 : 0);
  }
  return uit;
}

function _hcpPlaatsingVan(partij) {
  return partij && partij.hcpPlaatsing === 'vanaf' ? 'vanaf' : 'laag';
}

// Node-port van getHcpSlagenOpHole() uit js/ronde.js — identieke formule.
function _hcpSlagenOpHole(matchup, holes, holeIdx, plaatsing) {
  if (!holes[holeIdx]) return 0;
  return _slagenPerHole(matchup.hcpSlagen || 0, holes, plaatsing)[holeIdx] || 0;
}

// Node-port van berekenMatchStand() uit js/ronde.js — identieke formule,
// inclusief het "bevriezen" van de stand zodra de match beslist is.
// Retourneert { standA, gespeeld }: standA > 0 = speler A staat voor.
function _berekenStand(matchup, holes, scoresA, scoresB, plaatsing) {
  let standA = 0, gespeeld = 0, beslissingsStand = null;
  const aUid = matchup.spelerA?.uid, bUid = matchup.spelerB?.uid;
  // Eenmalig uitrekenen: de verdeling is voor alle holes dezelfde.
  const slagenLijst = _slagenPerHole(matchup.hcpSlagen || 0, holes, plaatsing);
  for (let i = 0; i < holes.length; i++) {
    const sA = scoresA?.[i], sB = scoresB?.[i];
    if (sA === null || sA === undefined || sB === null || sB === undefined) continue;
    gespeeld++;
    const slagA = matchup.hcpOntvanger === aUid ? (slagenLijst[i] || 0) : 0;
    const slagB = matchup.hcpOntvanger === bUid ? (slagenLijst[i] || 0) : 0;
    const nettoA = sA - slagA, nettoB = sB - slagB;
    if (nettoA < nettoB) standA++;
    else if (nettoB < nettoA) standA--;
    const resterendNa = holes.length - gespeeld;
    if (beslissingsStand === null && Math.abs(standA) > resterendNa) beslissingsStand = standA;
  }
  return { standA: beslissingsStand !== null ? beslissingsStand : standA, gespeeld };
}

//  Input:  { ladderId, partijId, isTest, matchups: [{ spelerAUid, spelerBUid, winnaarUid }] }
//  Output: { success: true, changes: [...], alVerwerkt?: true }
exports.verwerkPartijUitslag = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');

    const ladderId  = data?.ladderId;
    const partijId  = data?.partijId;
    const matchups  = Array.isArray(data?.matchups) ? data.matchups : [];
    // v5.7.0: tweede invoervorm. Amerikaantje/High-Low leveren geen onderlinge
    // partijen op maar een eindstand. Bewust in DEZELFDE functie: alles
    // eromheen — deelnemer-controle, één keer verwerken, prevRank, de
    // momentopname voor terugdraaien, het hernummeren — is dan gedeeld en
    // hoeft niet nagebouwd te worden.
    //   { speltype: 'amerikaantje', posities: [{uid, positie}] }
    //   { speltype: 'highlow', teams: [{uid, team}], winnendTeam: 0|1|null }
    const eindstand = data?.eindstand && typeof data.eindstand === 'object'
      ? data.eindstand : null;
    const isTest    = data?.isTest === true;
    if (!ladderId || typeof ladderId !== 'string') {
      throw new HttpsError('invalid-argument', 'ladderId ontbreekt.');
    }
    if (!partijId || typeof partijId !== 'string') {
      throw new HttpsError('invalid-argument', 'partijId ontbreekt.');
    }
    if (matchups.length === 0 && !eindstand) return { success: true, changes: [] };

    const fs = fsVoor(isTest);
    const ladderRef = fs.collection('ladders').doc(ladderId);
    const verwerktRef = ladderRef.collection('verwerkt').doc(partijId);

    const [ladderSnap, callerSnap, verwerktSnap] = await Promise.all([
      ladderRef.get(),
      fs.collection('spelers').doc(auth.uid).get(),
      verwerktRef.get(),
    ]);
    if (!ladderSnap.exists) throw new HttpsError('not-found', 'Ladder niet gevonden.');

    // (d) Idempotent — al verwerkt? Geef hetzelfde antwoord terug in plaats van
    // de partij nog een keer te laten meetellen.
    if (verwerktSnap.exists) {
      return { success: true, alVerwerkt: true,
               changes: verwerktSnap.data().changes || [],
               spelerRegels: verwerktSnap.data().spelerRegels || [] };
    }

    const ladderData = ladderSnap.data() || {};
    const callerRol  = callerSnap.exists ? callerSnap.data().rol : null;
    const isCoord    = callerRol === 'coordinator' || callerRol === 'beheerder';
    const spelerIds  = (ladderData.spelerIds || []).filter(id => typeof id === 'string' && id.length > 10);
    if (!spelerIds.includes(auth.uid) && !isCoord) {
      throw new HttpsError('permission-denied', 'Je zit niet in deze ladder.');
    }
    if (spelerIds.length === 0) throw new HttpsError('failed-precondition', 'Ladder heeft geen spelers.');

    // (a) Bestaat de partij?
    const { partij } = await _zoekPartij(fs, ladderRef, ladderData, partijId);
    if (!partij) {
      throw new HttpsError('not-found', 'Partij niet gevonden — mogelijk al afgesloten.');
    }

    // (c) Speelde de aanroeper zelf mee?
    const deelnemerUids = (partij.spelers || []).map(s => s && s.uid).filter(Boolean);
    if (!deelnemerUids.includes(auth.uid) && !isCoord) {
      throw new HttpsError('permission-denied', 'Alleen deelnemers kunnen deze partij afsluiten.');
    }

    // (b) Komen de doorgegeven matchups overeen met de vastgelegde matchups?
    const partijMatchups = Array.isArray(partij.matchups) ? partij.matchups : [];
    const paarSleutel = (x, y) => [x, y].sort().join('|');
    const bekendeParen = new Map();
    partijMatchups.forEach(m => {
      const a = m.spelerA?.uid, b = m.spelerB?.uid;
      if (a && b) bekendeParen.set(paarSleutel(a, b), m);
    });
    const holes = Array.isArray(partij.holes) ? partij.holes : [];
    const partijScores = await _leesPartijScores(ladderRef, partijId, partij);

    for (const mu of matchups) {
      const { spelerAUid, spelerBUid, winnaarUid } = mu || {};
      if (!spelerAUid || !spelerBUid || !winnaarUid) {
        throw new HttpsError('invalid-argument', 'Onvolledige matchup meegestuurd.');
      }
      const bron = bekendeParen.get(paarSleutel(spelerAUid, spelerBUid));
      if (!bron) {
        throw new HttpsError('failed-precondition', 'Deze matchup hoort niet bij deze partij.');
      }
      if (winnaarUid !== spelerAUid && winnaarUid !== spelerBUid) {
        throw new HttpsError('invalid-argument', 'De winnaar speelde niet in deze matchup.');
      }
      // (e) Alleen controleren als de scores de match onmiskenbaar beslissen.
      // Geen scores of gelijkspel -> de keuze van de speler telt, zoals bedoeld.
      const { standA, gespeeld } = _berekenStand(
        bron, holes,
        partijScores[bron.spelerA?.uid], partijScores[bron.spelerB?.uid],
        // v5.8.0: de partij bepaalt zelf waar de slagen vallen.
        _hcpPlaatsingVan(partij)
      );
      if (gespeeld > 0 && standA !== 0) {
        const uitScores = standA > 0 ? bron.spelerA?.uid : bron.spelerB?.uid;
        if (uitScores && uitScores !== winnaarUid) {
          throw new HttpsError(
            'failed-precondition',
            'De opgegeven winnaar klopt niet met de ingevulde scores. Pas de scorekaart aan of verwijder de scores.'
          );
        }
      }
    }

    const cfg = { ...DEFAULT_LADDER_CONFIG, ...(ladderData.config || {}) };
    const standenCol = ladderRef.collection('standen');
    const puntenCol  = ladderRef.collection('punten');

    const [standenSnap, spelersSnap] = await Promise.all([
      standenCol.get(),
      Promise.all(spelerIds.map(uid => fs.collection('spelers').doc(uid).get())),
    ]);
    const standenMap = {}; standenSnap.forEach(d => { standenMap[d.id] = d.data(); });
    const naamVanUid = {};
    spelersSnap.forEach((s, i) => { naamVanUid[spelerIds[i]] = s.exists ? (s.data().naam || spelerIds[i]) : spelerIds[i]; });

    // Werklijst: huidige (publieke, dus al activiteits-gecorrigeerde) positie
    // per speler, schoongetrokken naar 1..N.
    let werklijst = spelerIds.map(uid => {
      const st = standenMap[uid] || {};
      return { uid, rank: st.rank || 0, partijen: st.partijen || 0, gewonnen: st.gewonnen || 0 };
    });
    werklijst.sort((a, b) => {
      const ra = a.rank > 0 ? a.rank : Infinity;
      const rb = b.rank > 0 ? b.rank : Infinity;
      return ra - rb || (a.uid < b.uid ? -1 : 1);
    });
    werklijst.forEach((s, i) => { s.rank = i + 1; });
    const voorRankMap = {}; werklijst.forEach(s => { voorRankMap[s.uid] = s.rank; });

    // ────────────────────────────────────────────────────────
    //  v5.7.0 — TAK 2: eindstand (Amerikaantje / High-Low)
    // ────────────────────────────────────────────────────────
    const eindstandRegels = [];
    if (eindstand) {
      // v5.7.1: bij High-Low leidt de SERVER de teams af uit de spelersvolgorde
      // in het partij-document (slot 1+2 tegen 3+4). De client stuurt alleen
      // nog wie er won. Voorheen kwam de teamindeling van de client en werd die
      // voor waar aangenomen — een gemanipuleerde app kon zichzelf dan in het
      // winnende team zetten.
      let deelnemers;
      if (eindstand.speltype === 'highlow') {
        const uids = (partij.spelers || []).map(sp => sp && sp.uid).filter(Boolean);
        if (uids.length !== 4) {
          throw new HttpsError('failed-precondition', 'High-Low vereist precies vier spelers.');
        }
        deelnemers = uids.map((uid, i) => ({ uid, team: i < 2 ? 0 : 1 }));
      } else {
        deelnemers = Array.isArray(eindstand.posities) ? eindstand.posities : [];
      }

      // Gasten tellen niet mee voor de ladder; ze houden wel hun plek in de
      // uitslag, zodat de verschuiving van de anderen klopt.
      const isGast = u => typeof u === 'string' && u.startsWith('gast_');

      let deltas;
      if (eindstand.speltype === 'amerikaantje') {
        deltas = verschuivingAmerikaantje(deelnemers.map(d => d.positie));
      } else if (eindstand.speltype === 'highlow') {
        const w = (eindstand.winnendTeam === 0 || eindstand.winnendTeam === 1)
          ? eindstand.winnendTeam : null;
        deltas = verschuivingHighlow(deelnemers.map(d => d.team), w);
      } else {
        throw new HttpsError('invalid-argument', 'Onbekend speltype.');
      }
      if (!deltas) {
        throw new HttpsError('invalid-argument', 'Ongeldige eindstand voor dit speltype.');
      }

      // De opgegeven spelers moeten overeenkomen met het partij-document.
      const uitPartij = new Set((partij.spelers || []).map(sp => sp.uid));
      for (const d of deelnemers) {
        if (!d?.uid || !uitPartij.has(d.uid)) {
          throw new HttpsError('invalid-argument', 'Eindstand hoort niet bij deze partij.');
        }
      }

      const zetten = [];
      deelnemers.forEach((d, i) => {
        if (isGast(d.uid)) return;
        const s = werklijst.find(x => x.uid === d.uid);
        if (!s) return;                       // geen ladderlid (meer) -> overslaan
        s.partijen++;
        if (eindstand.speltype === 'amerikaantje') {
          if (winstAmerikaantje(deelnemers.map(x => x.positie))[i]) s.gewonnen++;
        } else if (deltas[i] > 0) {
          s.gewonnen++;
        }
        if (deltas[i] !== 0) zetten.push({ uid: d.uid, delta: deltas[i] });
        eindstandRegels.push({
          uid: d.uid,
          naam: naamVanUid[d.uid] || d.uid,
          positie: d.positie ?? null,
          team: d.team ?? null,
          delta: deltas[i],
        });
      });

      verschuifAllemaal(werklijst, zetten);
    }

    // Verwerk elke matchup — EXACT dezelfde formules als het oude systeem.
    const verwerkt = [];
    for (const mu of matchups) {
      const { spelerAUid, spelerBUid, winnaarUid } = mu || {};
      if (!spelerAUid || !spelerBUid || !winnaarUid) continue;
      const verliezerUid = winnaarUid === spelerAUid ? spelerBUid : spelerAUid;
      const isGast = u => typeof u === 'string' && u.startsWith('gast_');
      if (isGast(spelerAUid) || isGast(spelerBUid)) continue;
      const sw = werklijst.find(s => s.uid === winnaarUid);
      const sv = werklijst.find(s => s.uid === verliezerUid);
      if (!sw || !sv) continue;

      sw.partijen++; sv.partijen++; sw.gewonnen++;
      const swRank = sw.rank, svRank = sv.rank;
      const n = werklijst.length;
      let newWrank, newVrank;
      if (swRank > svRank) {
        newWrank = Math.max(1, swRank - cfg.laagStijg);
        const verschil = swRank - svRank;
        newVrank = (cfg.verliezerNaarWinnaar && verschil <= cfg.drempel) ? swRank : svRank + cfg.laagZak;
      } else {
        newWrank = Math.max(1, swRank - cfg.hoogStijg);
        newVrank = svRank + cfg.hoogZak;
      }

      // v5.1.0: begrenzen op de ladderlengte. De verliezer kon tot nu toe op
      // positie N+1 belanden als hij al onderaan stond (svRank + zak > N).
      // Dat viel niet op zolang er daarna toch op score werd hersorteerd en
      // hernummerd; nu een partij alleen nog de posities verschuift, zou er
      // een spookplek ontstaan en zou een speler zonder positie achterblijven.
      newWrank = Math.min(n, Math.max(1, newWrank));
      newVrank = Math.min(n, Math.max(1, newVrank));
      // Botsen ze na het begrenzen (mogelijk bij een ladder van 2 spelers of
      // een stijging van 0), dan wijkt de verliezer een plek: de winnaar mag
      // nooit onder de verliezer eindigen.
      if (newWrank === newVrank) {
        if (newVrank < n) newVrank += 1;
        else if (newWrank > 1) newWrank -= 1;
      }
      const gereserveerd = new Set([newWrank, newVrank]);
      const beschikbaar = [];
      for (let r = 1; r <= n; r++) if (!gereserveerd.has(r)) beschikbaar.push(r);
      werklijst.filter(s => s.uid !== sw.uid && s.uid !== sv.uid)
        .sort((a, b) => a.rank - b.rank)
        .forEach((s, i) => { s.rank = beschikbaar[i]; });
      sw.rank = newWrank; sv.rank = newVrank;

      verwerkt.push({ winnaarUid, verliezerUid, spelerAUid, spelerBUid });
    }
    if (verwerkt.length === 0 && eindstandRegels.length === 0) return { success: true, changes: [] };

    // ────────────────────────────────────────────────────────
    //  v5.1.0: HIER GEBEURT GEEN ACTIVITEITSBEREKENING MEER.
    //
    //  Tot v5.0.1 werd na elke partij de activiteitscorrectie opnieuw op de
    //  score toegepast — terwijl de score waarop dat gebeurde die correctie al
    //  bevatte. Daardoor stapelde hij op: een actieve speler steeg elke partij
    //  een paar plekken extra, ook als hij verloor, en een inactieve speler
    //  zakte weg bij partijen waar hij niet eens aan meedeed.
    //
    //  Een partij verschuift nu uitsluitend volgens de win/verlies-regels.
    //  De activiteitscorrectie draait apart en periodiek — zie
    //  verwerkActiviteitPeriodiek. Zo staan de twee volledig los van elkaar.
    // ────────────────────────────────────────────────────────

    // Huidige punten inlezen — nodig om de partij later te kunnen terugdraaien
    // en om activiteitVerschuiving ongemoeid door te kunnen zetten.
    const puntenVoorSnap = await puntenCol.get();
    const puntenVoor = {}; puntenVoorSnap.forEach(d => { puntenVoor[d.id] = d.data(); });

    // De positie na de matchups IS de nieuwe positie. Geen hersortering op
    // score meer nodig, want er komt niets meer bovenop.
    const scores = werklijst.map(s => ({
      uid: s.uid,
      score: scoreVoorPositie(s.rank),
      partijen: s.partijen,
      gewonnen: s.gewonnen,
      // Boekhouding van de activiteitscorrectie blijft staan zoals hij was;
      // alleen verwerkActiviteitPeriodiek wijzigt die.
      verschuiving: puntenVoor[s.uid]?.activiteitVerschuiving ?? 0,
    }));
    const naRankMap = {}; werklijst.forEach(s => { naRankMap[s.uid] = s.rank; });

    const changes = verwerkt.map(m => ({
      winnaar: naamVanUid[m.winnaarUid], verliezer: naamVanUid[m.verliezerUid],
      wOud: voorRankMap[m.winnaarUid], wNieuw: naRankMap[m.winnaarUid],
      vOud: voorRankMap[m.verliezerUid], vNieuw: naRankMap[m.verliezerUid],
    }));

    // v5.7.0: bij een eindstand zijn er geen winnaar/verliezer-paren. Het
    // scherm krijgt dan één regel per speler met wat er werkelijk veranderde.
    const spelerRegels = eindstandRegels.map(r => ({
      naam: r.naam,
      positie: r.positie,
      team: r.team,
      oud: voorRankMap[r.uid] ?? null,
      nieuw: naRankMap[r.uid] ?? null,
    }));

    const batch = fs.batch();
    scores.forEach(s => {
      const publiekeRank = naRankMap[s.uid];
      batch.set(standenCol.doc(s.uid), {
        rank: publiekeRank, partijen: s.partijen, gewonnen: s.gewonnen,
        prevRank: voorRankMap[s.uid] ?? publiekeRank,
      }, { merge: true });
      batch.set(puntenCol.doc(s.uid), {
        score: s.score,
        basisScore: s.score,
        // v5.1.0: activiteitDelta bestaat niet meer als los getal in de score.
        // activiteitVerschuiving houdt bij hoeveel PLEKKEN de periodieke
        // verwerking al heeft toegepast, zodat die nooit opstapelt.
        activiteitVerschuiving: s.verschuiving,
        bijgewerkt: Date.now(),
      }, { merge: true });
    });

    // (d) Verwerkings-stempel. Dit document is tegelijk de idempotency-sleutel
    // (een tweede aanroep met hetzelfde partijId doet niets meer) én de
    // momentopname waarmee de coordinator de partij kan terugdraaien.
    //
    // ⚠ v5.12.7 — WAAROM `create` EN NIET `set`.
    // De controle bovenaan (d) leest het stempel aan het BEGIN, en dit schrijft
    // het pas honderden regels later weg. Daartussen zit al het echte werk:
    // partij zoeken, scores lezen, standen en punten lezen. Dat duurt.
    // Bevestigen twee spelers uit dezelfde flight in diezelfde seconde, dan zien
    // beide aanroepen "nog niet verwerkt" en verschoof de ladder TWEE keer —
    // `set` overschrijft het stempel immers zonder klagen. Het geval "na elkaar"
    // was in v5.7.0 al afgevangen; "tegelijk" niet.
    //
    // `create` weigert als het document er al is, en dan mislukt de HELE batch
    // — dus ook de standen- en puntenschrijfacties hierboven. Dat is precies de
    // bedoeling: de tweede aanroep schrijft niets. De opvang bij commit() zet
    // die weigering om in hetzelfde "al verwerkt"-antwoord als de tak bovenaan.
    batch.create(verwerktRef, {
      partijId,
      verwerktOp: Date.now(),
      gerapporteerdDoor: auth.uid,
      gerapporteerdDoorNaam: naamVanUid[auth.uid] || (callerSnap.exists ? callerSnap.data().naam : '') || auth.uid,
      matchups: verwerkt,
      changes,
      spelerRegels,
      // Momentopname vóór verwerking — voor draaiPartijTerug()
      voorStanden: Object.fromEntries(werklijst.map(s => [s.uid, {
        rank: voorRankMap[s.uid] ?? null,
        partijen: (standenMap[s.uid] || {}).partijen ?? 0,
        gewonnen: (standenMap[s.uid] || {}).gewonnen ?? 0,
        prevRank: (standenMap[s.uid] || {}).prevRank ?? null,
      }])),
      voorPunten: Object.fromEntries(Object.entries(puntenVoor).map(([uid, p]) => [uid, {
        score: p.score ?? null, basisScore: p.basisScore ?? null,
        activiteitVerschuiving: p.activiteitVerschuiving ?? null,
      }])),
      teruggedraaid: false,
    });

    try {
      await batch.commit();
    } catch (e) {
      // Firestore geeft ALREADY_EXISTS (grpc-code 6) als create() een bestaand
      // document tegenkomt. Dan was een gelijktijdige aanroep ons voor; die
      // heeft de ladder al verschoven en zijn antwoord staat in het stempel.
      // Geef hetzelfde terug als de controle bovenaan zou hebben gedaan.
      const alBezet = e && (e.code === 6 || e.code === 'already-exists'
                        || /ALREADY_EXISTS/i.test(String(e.message || '')));
      if (!alBezet) throw e;
      const bestaand = await verwerktRef.get();
      const d = bestaand.exists ? bestaand.data() : {};
      return { success: true, alVerwerkt: true,
               changes: d.changes || [], spelerRegels: d.spelerRegels || [] };
    }

    // v5.40.0: het tijdelijke gastprofiel van deze ronde opruimen. De partij is
    // verwerkt, dus de QR-code hoort niets meer te openen — en een profiel dat
    // blijft slingeren is precies hoe die dingen zich opstapelen.
    // Mislukt het, dan is dat geen reden om de uitslag te laten mislukken: de
    // QR werkt sowieso niet meer, want wisselRondeSleutel kijkt of de partij
    // nog LOOPT.
    try { await fs.collection('spelers').doc('rondegast_' + partijId).delete(); }
    catch (e) { console.warn('gastprofiel opruimen mislukt:', e?.message); }

    return { success: true, changes, spelerRegels };
  }
);

// ============================================================
//  draaiPartijTerug — v5.0.0 (punt 2)
//  Zet standen en punten terug naar de momentopname van vóór het verwerken
//  van een partij. Alleen voor coordinator/beheerder.
//
//  Nodig omdat scores optioneel blijven: de server kan een verkeerd
//  gerapporteerde uitslag niet tegenhouden, dus moet hij herstelbaar zijn.
//  Wie de uitslag indiende staat in het verwerkt-document
//  (`gerapporteerdDoor`), zodat het ook navolgbaar is.
//
//  Input:  { ladderId, partijId, isTest }
//  Output: { success: true }
// ============================================================
exports.draaiPartijTerug = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');

    const ladderId = data?.ladderId;
    const partijId = data?.partijId;
    const isTest   = data?.isTest === true;
    if (!ladderId || !partijId) {
      throw new HttpsError('invalid-argument', 'ladderId en partijId zijn verplicht.');
    }

    const fs = fsVoor(isTest);
    const callerSnap = await fs.collection('spelers').doc(auth.uid).get();
    const rol = callerSnap.exists ? callerSnap.data().rol : null;
    if (rol !== 'coordinator' && rol !== 'beheerder') {
      throw new HttpsError('permission-denied', 'Alleen een coordinator of beheerder mag een uitslag terugdraaien.');
    }

    const ladderRef   = fs.collection('ladders').doc(ladderId);
    const verwerktRef = ladderRef.collection('verwerkt').doc(partijId);
    const teruggedraaidRef = ladderRef.collection('teruggedraaid').doc(partijId);
    const snap = await verwerktRef.get();
    // ⚠ v5.12.7 — HIER STOND EEN GRENDEL DIE NOOIT AANGING.
    // De controle keek naar `rec.teruggedraaid === true` op het verwerkt-
    // document, maar dat document wordt hieronder juist VERWIJDERD bij het
    // terugdraaien. Het veld kon dus nooit gelezen worden. Twee keer
    // terugdraaien gaf daardoor "niet als verwerkt geregistreerd" — een
    // foutmelding op de plek waar een geruststelling hoort.
    // Nu wordt gekeken waar het stempel na een terugdraaiing wél ligt.
    if (!snap.exists) {
      const eerder = await teruggedraaidRef.get();
      if (eerder.exists) return { success: true, alTeruggedraaid: true };
      throw new HttpsError('not-found', 'Deze partij is niet als verwerkt geregistreerd.');
    }
    const rec = snap.data() || {};

    const batch = fs.batch();
    for (const [uid, st] of Object.entries(rec.voorStanden || {})) {
      const payload = {};
      if (st.rank != null)     payload.rank = st.rank;
      if (st.partijen != null) payload.partijen = st.partijen;
      if (st.gewonnen != null) payload.gewonnen = st.gewonnen;
      if (st.prevRank != null) payload.prevRank = st.prevRank;
      if (Object.keys(payload).length) {
        batch.set(ladderRef.collection('standen').doc(uid), payload, { merge: true });
      }
    }
    for (const [uid, pt] of Object.entries(rec.voorPunten || {})) {
      const payload = { bijgewerkt: Date.now() };
      if (pt.score != null)                 payload.score = pt.score;
      if (pt.basisScore != null)            payload.basisScore = pt.basisScore;
      if (pt.activiteitVerschuiving != null) payload.activiteitVerschuiving = pt.activiteitVerschuiving;
      batch.set(ladderRef.collection('punten').doc(uid), payload, { merge: true });
    }
    // v5.12.7: de opmerking hier sprak zichzelf tegen — hij zei "stempel
    // bewaren" terwijl de regel eronder hem weggooit. Wat er echt gebeurt: het
    // stempel VERHUIST naar de collectie `teruggedraaid`. Zo blijft zichtbaar
    // dát er iets is teruggedraaid, én kan dezelfde partij opnieuw worden
    // verwerkt — de idempotency-grendel in verwerkPartijUitslag kijkt of
    // `verwerkt/{partijId}` bestaat, en die is er dan niet meer.
    batch.delete(verwerktRef);
    batch.set(teruggedraaidRef, {
      ...rec, teruggedraaid: true,
      teruggedraaidOp: Date.now(), teruggedraaidDoor: auth.uid,
    });
    await batch.commit();

    return { success: true };
  }
);

// ============================================================
//  pasPuntenAan — v4.2.0
//  Handmatige puntenaanpassing door de puntenbeheerder (potloodje in de
//  "Spelers"-modal, js/beheer.js). Alleen aanroepbaar door het account met
//  puntenBeheerder:true op spelers/{uid} — zie firestore.rules.
//
//  Input:  { ladderId, isTest, uid, score }
//  Output: { success: true, nieuwePositie }
// ============================================================
exports.pasPuntenAan = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');

    const ladderId    = data?.ladderId;
    const targetUid   = data?.uid;
    const nieuweScore = Number(data?.score);
    const isTest      = data?.isTest === true;
    if (!ladderId || !targetUid || !Number.isFinite(nieuweScore)) {
      throw new HttpsError('invalid-argument', 'ladderId, uid en score zijn verplicht.');
    }

    const fs = fsVoor(isTest);
    const callerSnap = await fs.collection('spelers').doc(auth.uid).get();
    if (!callerSnap.exists || callerSnap.data().puntenBeheerder !== true) {
      throw new HttpsError('permission-denied', 'Alleen de puntenbeheerder mag dit aanpassen.');
    }

    const ladderRef  = fs.collection('ladders').doc(ladderId);
    const ladderSnap = await ladderRef.get();
    if (!ladderSnap.exists) throw new HttpsError('not-found', 'Ladder niet gevonden.');
    const spelerIds = (ladderSnap.data().spelerIds || []).filter(id => typeof id === 'string' && id.length > 10);
    if (!spelerIds.includes(targetUid)) {
      throw new HttpsError('failed-precondition', 'Speler zit niet in deze ladder.');
    }

    const standenCol = ladderRef.collection('standen');
    const puntenCol  = ladderRef.collection('punten');
    const [standenSnap, puntenSnap] = await Promise.all([standenCol.get(), puntenCol.get()]);
    const rankMap  = {}; standenSnap.forEach(d => { rankMap[d.id]  = d.data().rank || 0; });
    const scoreMap = {}; puntenSnap.forEach(d => { scoreMap[d.id] = d.data().score; });

    // Leden zonder punten-document bootstrappen uit hun huidige rang, zodat
    // de hersortering meteen klopt (eerste keer dat dit voor deze ladder gebeurt).
    spelerIds.forEach(uid => {
      if (scoreMap[uid] == null) scoreMap[uid] = scoreVoorPositie(rankMap[uid] || spelerIds.length);
    });
    scoreMap[targetUid] = nieuweScore;

    const volgorde = spelerIds.slice()
      .sort((a, b) => (scoreMap[b] ?? -Infinity) - (scoreMap[a] ?? -Infinity));

    const batch = fs.batch();
    volgorde.forEach((uid, i) => {
      batch.set(standenCol.doc(uid), { rank: i + 1 }, { merge: true });
      const payload = { score: scoreMap[uid] };
      if (uid === targetUid) {
        payload.basisScore = nieuweScore;
        // v5.1.0: handmatig ingrijpen zet de activiteitsboekhouding op nul —
        // de nieuwe positie is dan een bewuste keuze van de beheerder, geen
        // gevolg van (in)activiteit.
        payload.activiteitVerschuiving = 0;
        payload.bijgewerkt = Date.now();
      }
      batch.set(puntenCol.doc(uid), payload, { merge: true });
    });
    await batch.commit();

    return { success: true, nieuwePositie: volgorde.indexOf(targetUid) + 1 };
  }
);

// ============================================================
//  verwerkActiviteitPeriodiek — v5.1.0
//  (vervangt herbereikenActiviteitDagelijks)
// ------------------------------------------------------------
//  Draait elke maandag 04:00. Per ladder bepaalt `activiteitPeriode` of hij
//  die dag daadwerkelijk verwerkt wordt:
//    'maand' (standaard) -> alleen op de EERSTE maandag van de maand
//    'week'              -> elke maandag
//
//  WAAROM APART VAN DE PARTIJEN: tot v5.0.1 werd de activiteitscorrectie bij
//  elke partij opnieuw toegepast op een score die hem al bevatte, waardoor hij
//  opstapelde (een verliezer kon daardoor stijgen). Nu verschuift een partij
//  alleen volgens de win/verlies-regels, en verzorgt deze functie als enige de
//  activiteitscorrectie.
//
//  HOE HET OPSTAPELEN WORDT VOORKOMEN: per speler staat in
//  punten/{uid}.activiteitVerschuiving hoeveel PLEKKEN de activiteitscorrectie
//  al heeft toegepast. Elke run wordt het DOEL berekend volgens de
//  ladderinstellingen (ongewijzigd, inclusief de maxima van 6 en 14), en
//  alleen het VERSCHIL met wat er al staat wordt doorgevoerd. Een stilzitter
//  zakt daardoor netjes tot zijn ingestelde maximum en niet verder; speelt hij
//  weer, dan klimt hij in één keer terug.
// ============================================================
exports.verwerkActiviteitPeriodiek = onSchedule(
  { region: 'europe-west1', schedule: 'every monday 04:00', timeZone: 'Europe/Amsterdam' },
  async () => {
    const nu = new Date();
    // Eerste maandag van de maand = een maandag met een datum van 1 t/m 7.
    const eersteMaandagVanMaand = nu.getDate() <= 7;

    for (const isTest of [false, true]) {
      const fs = fsVoor(isTest);
      let laddersSnap;
      try { laddersSnap = await fs.collection('ladders').get(); }
      catch (e) { console.error('verwerkActiviteitPeriodiek: ladders ophalen mislukt', isTest ? '(test)' : '', e); continue; }
      for (const ladderDoc of laddersSnap.docs) {
        try {
          const cfg = { ...DEFAULT_LADDER_CONFIG, ...((ladderDoc.data() || {}).config || {}) };
          const periode = cfg.activiteitPeriode === 'week' ? 'week' : 'maand';
          if (periode === 'maand' && !eersteMaandagVanMaand) continue;
          await _verwerkActiviteitEenLadder(fs, ladderDoc, Date.now());
        } catch (e) {
          console.error('verwerkActiviteitPeriodiek mislukt voor', ladderDoc.id, isTest ? '(test)' : '', e);
        }
      }
    }
  }
);

/**
 * Handmatig de activiteitsverwerking draaien voor één ladder.
 * Alleen coordinator/beheerder. Handig om te testen zonder tot maandag te
 * wachten, en om na een instellingswijziging meteen het effect te zien.
 *
 * Input:  { ladderId, isTest }
 * Output: { success: true, verschoven: [{ uid, van, naar }] }
 */
exports.verwerkActiviteitNu = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const ladderId = data?.ladderId;
    const isTest   = data?.isTest === true;
    if (!ladderId) throw new HttpsError('invalid-argument', 'ladderId ontbreekt.');

    const fs = fsVoor(isTest);
    const callerSnap = await fs.collection('spelers').doc(auth.uid).get();
    const rol = callerSnap.exists ? callerSnap.data().rol : null;
    if (rol !== 'coordinator' && rol !== 'beheerder') {
      throw new HttpsError('permission-denied', 'Alleen een coordinator of beheerder mag dit draaien.');
    }
    const ladderDoc = await fs.collection('ladders').doc(ladderId).get();
    if (!ladderDoc.exists) throw new HttpsError('not-found', 'Ladder niet gevonden.');

    const resultaat = await _verwerkActiviteitEenLadder(fs, ladderDoc, Date.now());
    return { success: true, ...resultaat };
  }
);

async function _verwerkActiviteitEenLadder(fs, ladderDoc, nu) {
  const ladderData = ladderDoc.data() || {};
  const cfg = { ...DEFAULT_LADDER_CONFIG, ...(ladderData.config || {}) };
  const spelerIds = (ladderData.spelerIds || []).filter(id => typeof id === 'string' && id.length > 10);
  if (spelerIds.length === 0) return { verschoven: [] };

  const ladderRef  = ladderDoc.ref;
  const standenCol = ladderRef.collection('standen');
  const puntenCol  = ladderRef.collection('punten');

  const [standenSnap, puntenSnap, spelersSnap, toernooienSnap] = await Promise.all([
    standenCol.get(), puntenCol.get(),
    Promise.all(spelerIds.map(uid => fs.collection('spelers').doc(uid).get())),
    fs.collection('toernooien').get(),
  ]);
  const standenMap = {}; standenSnap.forEach(d => { standenMap[d.id] = d.data(); });
  const puntenMap  = {}; puntenSnap.forEach(d => { puntenMap[d.id] = d.data(); });
  const naamVanUid = {};
  spelersSnap.forEach((s, i) => { naamVanUid[spelerIds[i]] = s.exists ? (s.data().naam || spelerIds[i]) : spelerIds[i]; });

  const uitslagen  = ladderData.uitslagen || [];
  const toernooien = toernooienSnap.docs.map(d => d.data());
  const naamNaarUid = bouwNaamNaarUid(naamVanUid);
  const stat = berekenActiviteitsStats(uitslagen, toernooien, cfg, nu, naamNaarUid);

  // Huidige volgorde, schoongetrokken naar 1..N.
  const rijen = spelerIds.map(uid => ({
    uid,
    positie: standenMap[uid]?.rank || 0,
    verschuiving: puntenMap[uid]?.activiteitVerschuiving ?? 0,
  }));
  rijen.sort((a, b) => {
    const ra = a.positie > 0 ? a.positie : Infinity;
    const rb = b.positie > 0 ? b.positie : Infinity;
    return ra - rb || (a.uid < b.uid ? -1 : 1);
  });
  rijen.forEach((r, i) => { r.positie = i + 1; });
  const N = rijen.length;

  // Doel bepalen en ALLEEN het verschil toepassen.
  for (const r of rijen) {
    const naam = naamVanUid[r.uid] || r.uid;
    const doel = doelVerschuivingVoorSpeler(r.uid, stat, cfg, naam, r.positie, N, nu);
    r.doel = doel;
    r.stap = doel - r.verschuiving;          // positief = omhoog
    r.sorteer = r.positie - r.stap;          // nieuwe gewenste plek
  }

  // Hernummeren: gewenste plek bepaalt de volgorde, bij gelijkspel wint wie
  // er al hoger stond. Zo blijft de onderlinge volgorde stabiel.
  const nieuweVolgorde = [...rijen].sort((a, b) => (a.sorteer - b.sorteer) || (a.positie - b.positie));

  const batch = fs.batch();
  const verschoven = [];
  nieuweVolgorde.forEach((r, i) => {
    const nieuwePositie = i + 1;
    if (nieuwePositie !== r.positie) {
      verschoven.push({ uid: r.uid, naam: naamVanUid[r.uid] || r.uid, van: r.positie, naar: nieuwePositie });
      batch.set(standenCol.doc(r.uid), { rank: nieuwePositie, prevRank: r.positie }, { merge: true });
    }
    const nieuweScore = scoreVoorPositie(nieuwePositie);
    batch.set(puntenCol.doc(r.uid), {
      score: nieuweScore,
      basisScore: nieuweScore,
      activiteitVerschuiving: r.doel,
      bijgewerkt: nu,
    }, { merge: true });
  });
  batch.set(ladderRef, { laatsteActiviteitRun: nu }, { merge: true });
  await batch.commit();

  return { verschoven };
}

// ============================================================
//  SNAPSHOTS EN BACKUP — v5.2.0
// ------------------------------------------------------------
//  WAAROM SERVER-SIDE: sinds v4.2.0 is ladders/{id}/punten/{uid} alleen
//  leesbaar voor het puntenBeheerder-account en voor niemand schrijfbaar
//  (firestore.rules). Sinds v5.0.0 geldt hetzelfde voor
//  ladders/{id}/verwerkt/{partijId}. Een snapshot of backup die vanuit de
//  browser wordt gemaakt kan die dus niet meenemen, en een herstel kan ze niet
//  terugzetten.
//
//  WAT ER MIS WAS: de bestaande snapshot bewaarde alleen `standen`, en de
//  backup alleen ladders/spelers/toernooien/uitslagen/snapshots plus de
//  ladder-documenten. Alles wat er sinds v4.2.0 bij is gekomen ontbrak:
//   - punten          -> na een herstel kloppen de posities wel, maar denkt
//                        het systeem nog dat de activiteitscorrectie al is
//                        toegepast. De eerstvolgende periodieke run rekent
//                        dan met een verkeerd verschil.
//   - partijen/scores -> een lopende ronde overleefde een herstel niet.
//   - verwerkt        -> de stempels tegen dubbel verwerken verdwenen, dus
//                        een al verwerkte partij kon nogmaals meetellen.
//
//  Deze vier functies draaien met de Admin SDK en omzeilen de rules bewust,
//  precies zoals verwerkPartijUitslag dat doet. Ze zijn beperkt tot
//  coordinator/beheerder.
// ============================================================

// Gedeelde rechtencontrole voor alle beheerfuncties hieronder.
async function _eisCoordinator(fs, uid) {
  const snap = await fs.collection('spelers').doc(uid).get();
  const rol = snap.exists ? snap.data().rol : null;
  if (rol !== 'coordinator' && rol !== 'beheerder') {
    throw new HttpsError('permission-denied', 'Alleen een coordinator of beheerder mag dit doen.');
  }
  return rol;
}

// Leest standen + punten van één ladder. Gebruikt door snapshot en backup.
async function _leesLadderStaat(fs, ladderId) {
  const ladderRef = fs.collection('ladders').doc(ladderId);
  const [standenSnap, puntenSnap, spelersSnap] = await Promise.all([
    ladderRef.collection('standen').get(),
    ladderRef.collection('punten').get(),
    fs.collection('spelers').get(),
  ]);
  const profielen = {};
  spelersSnap.forEach(d => { profielen[d.id] = d.data(); });

  const punten = {};
  puntenSnap.forEach(d => {
    const p = d.data() || {};
    punten[d.id] = {
      score: p.score ?? null,
      basisScore: p.basisScore ?? null,
      activiteitVerschuiving: p.activiteitVerschuiving ?? 0,
    };
  });

  const spelers = standenSnap.docs.map(d => {
    const data = d.data() || {};
    const prof = profielen[d.id] || {};
    return {
      uid: d.id,
      naam: prof.naam || d.id,
      hcp: prof.hcp ?? 0,
      rank: data.rank || 0,
      partijen: data.partijen || 0,
      gewonnen: data.gewonnen || 0,
      // v5.2.0: punten horen bij de stand. Zonder deze twee is een herstel
      // onvolledig — zie de toelichting bovenaan dit blok.
      score: punten[d.id]?.score ?? null,
      activiteitVerschuiving: punten[d.id]?.activiteitVerschuiving ?? 0,
    };
  });
  return { spelers };
}

/**
 * Maak een snapshot van één ladder — standen én punten.
 * Input:  { ladderId, isTest, label }
 * Output: { success: true, snapshotId, aantal }
 */
exports.maakLadderSnapshot = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const ladderId = data?.ladderId;
    const isTest   = data?.isTest === true;
    const label    = String(data?.label || '').trim() || 'Handmatige snapshot';
    if (!ladderId) throw new HttpsError('invalid-argument', 'ladderId ontbreekt.');

    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const ladderSnap = await fs.collection('ladders').doc(ladderId).get();
    if (!ladderSnap.exists) throw new HttpsError('not-found', 'Ladder niet gevonden.');

    const { spelers } = await _leesLadderStaat(fs, ladderId);
    const doc = await fs.collection('snapshots').add({
      label,
      ladderId,
      ladderNaam: (ladderSnap.data() || {}).naam || ladderId,
      timestamp: Date.now(),
      datum: new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }),
      spelers,
      // Vlag zodat het herstel weet dat er punten in zitten. Snapshots van
      // vóór v5.2.0 hebben die niet en worden anders behandeld.
      bevatPunten: true,
      gemaaktDoor: auth.uid,
    });
    return { success: true, snapshotId: doc.id, aantal: spelers.length };
  }
);

/**
 * Zet een snapshot terug — standen én punten.
 * Maakt eerst automatisch een snapshot van de huidige staat.
 *
 * Input:  { ladderId, isTest, snapshotId }
 * Output: { success: true, hersteld, bevattePunten }
 */
exports.herstelLadderSnapshot = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const snapshotId = data?.snapshotId;
    const isTest     = data?.isTest === true;
    if (!snapshotId) throw new HttpsError('invalid-argument', 'snapshotId ontbreekt.');

    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const snapDoc = await fs.collection('snapshots').doc(snapshotId).get();
    if (!snapDoc.exists) throw new HttpsError('not-found', 'Snapshot niet gevonden.');
    const snap = snapDoc.data() || {};
    const ladderId = snap.ladderId;
    if (!ladderId) throw new HttpsError('failed-precondition', 'Snapshot heeft geen ladderId.');

    const ladderRef  = fs.collection('ladders').doc(ladderId);
    const ladderSnap = await ladderRef.get();
    if (!ladderSnap.exists) throw new HttpsError('not-found', 'Ladder niet gevonden.');

    // Vangnet: huidige staat eerst vastleggen.
    const huidig = await _leesLadderStaat(fs, ladderId);
    await fs.collection('snapshots').add({
      label: 'Voor herstel op ' + new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }),
      ladderId,
      ladderNaam: (ladderSnap.data() || {}).naam || ladderId,
      timestamp: Date.now(),
      datum: new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }),
      spelers: huidig.spelers,
      bevatPunten: true,
      gemaaktDoor: auth.uid,
    });

    const standenCol = ladderRef.collection('standen');
    const puntenCol  = ladderRef.collection('punten');
    const bewaard = (snap.spelers || []).filter(s => s && s.uid);
    const bevattePunten = snap.bevatPunten === true;

    // Bestaande standen wissen zodat spelers die ná de snapshot zijn
    // toegevoegd geen dubbele posities opleveren.
    const huidigeStanden = await standenCol.get();
    const wisBatch = fs.batch();
    huidigeStanden.forEach(d => wisBatch.delete(d.ref));
    await wisBatch.commit();

    // Terugzetten en meteen hernummeren op 1..N.
    const volgorde = [...bewaard].sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
    const batch = fs.batch();
    volgorde.forEach((s, i) => {
      const rank = i + 1;
      batch.set(standenCol.doc(s.uid), {
        rank, partijen: s.partijen ?? 0, gewonnen: s.gewonnen ?? 0, prevRank: null,
      });
      if (bevattePunten) {
        // Score opnieuw afleiden uit de herstelde positie; de opgeslagen score
        // kan bij een oudere snapshot bij een andere volgorde horen.
        batch.set(puntenCol.doc(s.uid), {
          score: scoreVoorPositie(rank),
          basisScore: scoreVoorPositie(rank),
          activiteitVerschuiving: s.activiteitVerschuiving ?? 0,
          bijgewerkt: Date.now(),
        }, { merge: true });
      }
    });
    await batch.commit();

    return { success: true, hersteld: volgorde.length, bevattePunten };
  }
);

/**
 * Leest de afgeschermde delen van de database voor de backup:
 * per ladder de punten, partijen (incl. scores), verwerkt en teruggedraaid.
 * De rest haalt de app zelf op — die is gewoon leesbaar.
 *
 * Input:  { isTest }
 * Output: { success: true, ladders: { [ladderId]: {...} } }
 */
exports.exporteerBackupExtra = onCall(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const isTest = data?.isTest === true;
    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const laddersSnap = await fs.collection('ladders').get();
    const uit = {};
    for (const ladderDoc of laddersSnap.docs) {
      const ref = ladderDoc.ref;
      const [puntenSnap, partijenSnap, verwerktSnap, teruggedraaidSnap] = await Promise.all([
        ref.collection('punten').get(),
        ref.collection('partijen').get(),
        ref.collection('verwerkt').get(),
        ref.collection('teruggedraaid').get(),
      ]);

      const punten = {};        puntenSnap.forEach(d => { punten[d.id] = d.data(); });
      const verwerkt = {};      verwerktSnap.forEach(d => { verwerkt[d.id] = d.data(); });
      const teruggedraaid = {}; teruggedraaidSnap.forEach(d => { teruggedraaid[d.id] = d.data(); });

      // Partijen inclusief de scores-subcollectie, anders is een lopende
      // ronde na een herstel alsnog weg.
      const partijen = {};
      for (const p of partijenSnap.docs) {
        const scoresSnap = await p.ref.collection('scores').get();
        const scores = {};
        scoresSnap.forEach(sc => { scores[sc.id] = sc.data(); });
        partijen[p.id] = { ...p.data(), _scores: scores };
      }

      uit[ladderDoc.id] = { punten, partijen, verwerkt, teruggedraaid };
    }
    return { success: true, ladders: uit };
  }
);

/**
 * Schrijft de afgeschermde delen terug bij een backup-herstel.
 *
 * Input:  { isTest, ladders: { [ladderId]: { punten, partijen, verwerkt, teruggedraaid } } }
 * Output: { success: true, geschreven }
 */
exports.importeerBackupExtra = onCall(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const isTest = data?.isTest === true;
    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const ladders = data?.ladders || {};
    let geschreven = 0;
    let batch = fs.batch();
    let inBatch = 0;
    const commitAlsNodig = async (force = false) => {
      // Firestore staat maximaal 500 schrijfacties per batch toe.
      if (force || inBatch >= 400) { await batch.commit(); batch = fs.batch(); inBatch = 0; }
    };

    for (const [ladderId, blok] of Object.entries(ladders)) {
      const ref = fs.collection('ladders').doc(ladderId);

      for (const [uid, d] of Object.entries(blok.punten || {})) {
        batch.set(ref.collection('punten').doc(uid), d); inBatch++; geschreven++;
        await commitAlsNodig();
      }
      for (const [pid, d] of Object.entries(blok.verwerkt || {})) {
        batch.set(ref.collection('verwerkt').doc(pid), d); inBatch++; geschreven++;
        await commitAlsNodig();
      }
      for (const [pid, d] of Object.entries(blok.teruggedraaid || {})) {
        batch.set(ref.collection('teruggedraaid').doc(pid), d); inBatch++; geschreven++;
        await commitAlsNodig();
      }
      for (const [pid, d] of Object.entries(blok.partijen || {})) {
        const { _scores, ...meta } = d || {};
        batch.set(ref.collection('partijen').doc(pid), meta); inBatch++; geschreven++;
        await commitAlsNodig();
        for (const [uid, sc] of Object.entries(_scores || {})) {
          batch.set(ref.collection('partijen').doc(pid).collection('scores').doc(uid), sc);
          inBatch++; geschreven++;
          await commitAlsNodig();
        }
      }
    }
    await commitAlsNodig(true);
    return { success: true, geschreven };
  }
);

// ============================================================
//  ONDERHOUDSFUNCTIES — v5.2.1
// ------------------------------------------------------------
//  Uit de audit kwam dat drie beheerhandelingen wél `standen` bijwerkten maar
//  niet de collecties die er sinds v4.2.0 bij horen. Dat liet telkens een
//  half-consistente ladder achter:
//   - toernooi-uitslag  -> standen kregen nieuwe rangen, punten bleven op de
//                          oude waarde staan. De volgorde klopte (die komt uit
//                          standen), maar pasPuntenAan sorteert op punten en
//                          kon de ladder daarna verkeerd herschikken.
//   - nieuw seizoen     -> standen werden gereset, maar punten (en daarmee
//                          activiteitVerschuiving), partijen, verwerkt en
//                          teruggedraaid bleven staan. Het nieuwe seizoen
//                          begon dus met de activiteitsboekhouding van het
//                          vorige.
//   - ladder verwijderen-> alleen het ladderdocument ging weg; Firestore
//                          verwijdert subcollecties niet mee.
//
//  Alle drie lopen nu via de Admin SDK, zodat de afgeschermde collecties
//  meegenomen kunnen worden. Coordinator/beheerder-only.
// ============================================================

// Verwijdert een (sub)collectie in blokken. Firestore kent geen cascade-delete
// en een batch mag maximaal 500 schrijfacties bevatten.
async function _wisCollectie(colRef, perKeer = 300) {
  let totaal = 0;
  for (;;) {
    const snap = await colRef.limit(perKeer).get();
    if (snap.empty) break;
    const batch = colRef.firestore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    totaal += snap.size;
    if (snap.size < perKeer) break;
  }
  return totaal;
}

// Verwijdert alle partijen van een ladder, inclusief hun scores-subcollectie.
async function _wisPartijen(ladderRef) {
  const partijen = await ladderRef.collection('partijen').get();
  let totaal = 0;
  for (const p of partijen.docs) {
    totaal += await _wisCollectie(p.ref.collection('scores'));
    await p.ref.delete();
    totaal++;
  }
  return totaal;
}

/**
 * v5.2.1 — Schrijf de standen na een toernooi weg, mét punten.
 *
 * Input:  { ladderId, isTest, standen: [{ uid, rank, partijen, gewonnen, prevRank? }] }
 * Output: { success: true, aantal }
 */
exports.verwerkToernooiStanden = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const ladderId = data?.ladderId;
    const isTest   = data?.isTest === true;
    const rijen    = Array.isArray(data?.standen) ? data.standen : [];
    if (!ladderId) throw new HttpsError('invalid-argument', 'ladderId ontbreekt.');
    if (rijen.length === 0) return { success: true, aantal: 0 };

    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const ladderRef  = fs.collection('ladders').doc(ladderId);
    const standenCol = ladderRef.collection('standen');
    const puntenCol  = ladderRef.collection('punten');
    const puntenSnap = await puntenCol.get();
    const bestaand = {}; puntenSnap.forEach(d => { bestaand[d.id] = d.data() || {}; });

    // Hernummer op de doorgegeven rangorde, zodat rank en score per definitie
    // bij elkaar horen.
    const volgorde = rijen.filter(r => r && r.uid).sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
    const batch = fs.batch();
    volgorde.forEach((r, i) => {
      const rank = i + 1;
      batch.set(standenCol.doc(r.uid), {
        rank,
        partijen: r.partijen ?? 0,
        gewonnen: r.gewonnen ?? 0,
        prevRank: r.prevRank ?? null,
      }, { merge: true });
      batch.set(puntenCol.doc(r.uid), {
        score: scoreVoorPositie(rank),
        basisScore: scoreVoorPositie(rank),
        // De activiteitsboekhouding blijft ongemoeid: een toernooi is een
        // sportieve verschuiving, geen activiteitscorrectie.
        activiteitVerschuiving: bestaand[r.uid]?.activiteitVerschuiving ?? 0,
        bijgewerkt: Date.now(),
      }, { merge: true });
    });
    await batch.commit();
    return { success: true, aantal: volgorde.length };
  }
);

/**
 * v5.2.1 — Reset een ladder voor een nieuw seizoen.
 * Zet standen terug op de meegegeven volgorde en ruimt alles op wat bij het
 * vorige seizoen hoorde: punten (incl. activiteitVerschuiving), partijen,
 * verwerkt en teruggedraaid.
 *
 * Input:  { ladderId, isTest, volgorde: [uid, ...] }
 * Output: { success: true, spelers, opgeruimd }
 */
exports.resetLadderSeizoen = onCall(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const ladderId = data?.ladderId;
    const isTest   = data?.isTest === true;
    const volgorde = Array.isArray(data?.volgorde) ? data.volgorde.filter(u => typeof u === 'string') : [];
    if (!ladderId) throw new HttpsError('invalid-argument', 'ladderId ontbreekt.');

    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const ladderRef = fs.collection('ladders').doc(ladderId);
    if (!(await ladderRef.get()).exists) throw new HttpsError('not-found', 'Ladder niet gevonden.');

    let opgeruimd = 0;
    opgeruimd += await _wisCollectie(ladderRef.collection('punten'));
    opgeruimd += await _wisPartijen(ladderRef);
    opgeruimd += await _wisCollectie(ladderRef.collection('verwerkt'));
    opgeruimd += await _wisCollectie(ladderRef.collection('teruggedraaid'));

    // Standen resetten op de nieuwe volgorde, tellers op nul.
    const batch = fs.batch();
    volgorde.forEach((uid, i) => {
      batch.set(ladderRef.collection('standen').doc(uid), {
        rank: i + 1, partijen: 0, gewonnen: 0, prevRank: null,
      });
    });
    await batch.commit();

    return { success: true, spelers: volgorde.length, opgeruimd };
  }
);

/**
 * v5.2.1 — Verwijder een ladder inclusief al zijn subcollecties.
 * Firestore verwijdert subcollecties niet mee met het bovenliggende document;
 * zonder dit bleven standen, punten, partijen en verwerkt onzichtbaar achter.
 *
 * Input:  { ladderId, isTest }
 * Output: { success: true, opgeruimd }
 */
exports.verwijderLadderVolledig = onCall(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const ladderId = data?.ladderId;
    const isTest   = data?.isTest === true;
    if (!ladderId) throw new HttpsError('invalid-argument', 'ladderId ontbreekt.');

    const fs = fsVoor(isTest);
    await _eisCoordinator(fs, auth.uid);

    const ladderRef = fs.collection('ladders').doc(ladderId);
    let opgeruimd = 0;
    opgeruimd += await _wisCollectie(ladderRef.collection('standen'));
    opgeruimd += await _wisCollectie(ladderRef.collection('punten'));
    opgeruimd += await _wisPartijen(ladderRef);
    opgeruimd += await _wisCollectie(ladderRef.collection('verwerkt'));
    opgeruimd += await _wisCollectie(ladderRef.collection('teruggedraaid'));
    await ladderRef.delete();

    return { success: true, opgeruimd };
  }
);

/**
 * v5.2.1 — Ruim een Auth-account op waarvan het profiel niet kon worden
 * aangemaakt tijdens de bulk-import.
 *
 * Bleef zo'n account staan, dan kon iemand wel inloggen maar had de app geen
 * profiel: een half account dat alleen handmatig in de Firebase console op te
 * ruimen was. De functie weigert bewust als er wél een profiel bestaat.
 *
 * Input:  { targetUid, isTest }
 * Output: { success: true }
 */
exports.verwijderWeesAccount = onCall(
  { region: 'europe-west1' },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    // v5.12.3 — TWEE WIJZIGINGEN, allebei omdat het opruimen half bleef steken.
    //
    // 1. Ook een COORDINATOR mag dit. Gemeten op 13 september 2026: de
    //    coordinator ruimt de gastlogins op, het PROFIEL verdwijnt (dat doet de
    //    app zelf), maar deze functie weigerde en het Auth-account bleef staan.
    //    Daarmee bleef de inlognaam bezet, en kreeg dezelfde speler bij het
    //    volgende toernooi `sierk2`. Een coordinator maakt die gastaccounts ook
    //    zelf aan; ze weer kunnen weghalen hoort daarbij.
    //
    // 2. `targetEmail` mag in plaats van `targetUid`. Een account waarvan het
    //    profiel al weg is, is vanaf de app niet meer te vinden — je kent zijn
    //    uid niet. Via het e-mailadres wel. Zo zijn ook de wezen op te ruimen
    //    die er al stonden.
    //
    // ⚠ De veiligheidsklep blijft ongewijzigd en is de echte grendel: alleen
    // accounts ZONDER profiel mogen weg. Een clublid heeft altijd een profiel.
    const { auth, data } = request;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    const targetEmail = typeof data?.targetEmail === 'string' ? data.targetEmail.trim() : '';
    let targetUid = data?.targetUid;
    const isTest    = data?.isTest === true;
    if ((!targetUid || typeof targetUid !== 'string') && !targetEmail) {
      throw new HttpsError('invalid-argument', 'targetUid of targetEmail ontbreekt.');
    }

    const fs = fsVoor(isTest);
    const callerSnap = await fs.collection('spelers').doc(auth.uid).get();
    const rol = callerSnap.exists ? callerSnap.data().rol : null;
    if (rol !== 'beheerder' && rol !== 'coordinator') {
      throw new HttpsError('permission-denied', 'Alleen een beheerder of coordinator mag dit.');
    }

    if (!targetUid) {
      try {
        const viaMail = await admin.auth().getUserByEmail(targetEmail);
        targetUid = viaMail.uid;
      } catch (e) {
        if (e?.errorInfo?.code === 'auth/user-not-found') return { success: true, alWeg: true };
        throw new HttpsError('internal', 'Opzoeken mislukt: ' + e.message);
      }
    }

    // Veiligheidsklep: alleen accounts zonder profiel mogen weg.
    const target = await fs.collection('spelers').doc(targetUid).get();
    if (target.exists) {
      throw new HttpsError('failed-precondition',
        'Dit account heeft een profiel — verwijder de speler via het spelersbeheer.');
    }

    try { await admin.auth().deleteUser(targetUid); }
    catch (e) {
      if (e?.errorInfo?.code === 'auth/user-not-found') return { success: true, alWeg: true };
      throw new HttpsError('internal', 'Verwijderen mislukt: ' + e.message);
    }
    return { success: true, uid: targetUid };
  }
);

// ============================================================
//  Scorekaart scannen — v3.0.0-11.108
//  Analyseert een foto van een golfscorekaart en extraheert
//  par en stroke index (SI) per hole via Claude Vision.
//
//  Setup (eenmalig):
//    firebase functions:secrets:set ANTHROPIC_API_KEY
//    → plak je Anthropic API key
//
//  Input:  { imageBase64: "...", mediaType: "image/jpeg" }
//  Output: { holes: [{ hole: 1, par: 4, si: 10 }, ...] }
// ============================================================
exports.scanScorekaart = onCall(
  { region: 'europe-west1', secrets: [anthropicKey], timeoutSeconds: 30 },
  async (request) => {
    weigerPinSessie(request);
    weigerRondeSessie(request);
    const { auth, data } = request;

    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    }

    const { imageBase64, mediaType } = data || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'imageBase64 ontbreekt.');
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const mType = validTypes.includes(mediaType) ? mediaType : 'image/jpeg';

    // Max 4MB base64 (~3MB afbeelding)
    if (imageBase64.length > 4 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Afbeelding te groot (max ~3MB).');
    }

    const apiKey = anthropicKey.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition',
        'ANTHROPIC_API_KEY is niet ingesteld. Draai: firebase functions:secrets:set ANTHROPIC_API_KEY');
    }

    const prompt = `Analyseer deze foto van een golf-scorekaart. Lees de PAR en Stroke Index (SI) voor elke hole.

Belangrijke instructies:
- Zoek de rij met "PAR" en de rij met "SI" of "HCP" of "Stroke Index"
- Geef het resultaat als een JSON array
- Gebruik ALLEEN de getallen die je op de kaart ziet, verzin niets
- Als je 9 holes ziet, geef 9 objecten. Als je 18 holes ziet, geef 18 objecten.
- Als je een waarde niet kunt lezen, gebruik null

Antwoord ALLEEN met de JSON array, geen uitleg, geen markdown:
[{"hole":1,"par":4,"si":10},{"hole":2,"par":3,"si":18}]`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mType, data: imageBase64 } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error('Anthropic API fout:', response.status, errBody);
        throw new HttpsError('internal', `API fout (${response.status})`);
      }

      const result = await response.json();
      const text = result.content?.[0]?.text || '';

      // Parse JSON uit het antwoord
      let holes;
      try {
        // Strip eventuele markdown code fences
        const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        holes = JSON.parse(clean);
      } catch(e) {
        console.error('JSON parse mislukt:', text);
        throw new HttpsError('internal', 'Kon de scorekaart niet lezen. Probeer een duidelijkere foto.');
      }

      // Validatie
      if (!Array.isArray(holes) || holes.length === 0) {
        throw new HttpsError('internal', 'Geen holes herkend. Probeer een duidelijkere foto.');
      }

      return { holes };
    } catch(e) {
      if (e instanceof HttpsError) throw e;
      console.error('scanScorekaart fout:', e);
      throw new HttpsError('internal', 'Scan mislukt: ' + e.message);
    }
  }
);
