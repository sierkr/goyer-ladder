// ============================================================
//  Laag 3 — Cloud Functions tegen de emulator
// ============================================================
//  Deze tests draaien tegen een echte Firestore en echte functies. Ze dekken
//  precies de fouten die in v5.0.0 t/m v5.2.1 zijn gevonden: uitslagen die
//  niet werden gecontroleerd, een activiteitscorrectie die opstapelde,
//  snapshots en backups die de punten misten, en beheerhandelingen die
//  collecties lieten slingeren.
//
//  Draaien:
//    firebase emulators:exec --only firestore,auth,functions \
//      "node tests/emulator/functions.test.cjs"
// ============================================================
process.env.FIRESTORE_EMULATOR_HOST      = process.env.FIRESTORE_EMULATOR_HOST      || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST  = process.env.FIREBASE_AUTH_EMULATOR_HOST  || '127.0.0.1:9099';

const admin = require('firebase-admin');
const { maakRapport, toonRapport, wachtOpPoort } = require('./helpers.cjs');

const PROJECT  = process.env.GCLOUD_PROJECT || 'demo-goyer';
const REGIO    = 'europe-west1';
const FN_POORT = 5001;
const R = maakRapport('Cloud Functions');

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

// ─── Aanroepen van een callable function ─────────────────────
async function roepAan(naam, data, idToken) {
  const url = `http://127.0.0.1:${FN_POORT}/${PROJECT}/${REGIO}/${naam}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    const e = new Error(body?.error?.message || `status ${resp.status}`);
    e.status = body?.error?.status || resp.status;
    throw e;
  }
  return body.result;
}

// ─── Inlogtoken voor een uid (via de auth-emulator) ──────────
async function tokenVoor(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const url = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const d = await resp.json();
  if (!d.idToken) throw new Error('Kon geen inlogtoken maken: ' + JSON.stringify(d));
  return d.idToken;
}

const BEHEERDER = 'uid_beheerder_0000000000';
const SPELER_A  = 'uid_speler_a_00000000000';
const SPELER_B  = 'uid_speler_b_00000000000';
const SPELER_C  = 'uid_speler_c_00000000000';
const BUITEN    = 'uid_buiten_000000000000';

const HOLES = Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 }));

async function wisAlles() {
  for (const pad of ['ladders', 'spelers', 'snapshots', 'toernooien', 'uitslagen', 'ladder']) {
    const snap = await db.collection(pad).get();
    for (const d of snap.docs) await db.recursiveDelete(d.ref);
  }
}

async function zetLadderKlaar({ metScores = false } = {}) {
  await wisAlles();
  await db.doc(`spelers/${BEHEERDER}`).set({ naam: 'Bea', rol: 'beheerder', hcp: 10 });
  await db.doc(`spelers/${SPELER_A}`).set({ naam: 'Anna', rol: 'speler', hcp: 10 });
  await db.doc(`spelers/${SPELER_B}`).set({ naam: 'Bram', rol: 'speler', hcp: 10 });
  await db.doc(`spelers/${SPELER_C}`).set({ naam: 'Cees', rol: 'speler', hcp: 10 });
  await db.doc(`spelers/${BUITEN}`).set({ naam: 'Bas', rol: 'speler', hcp: 10 });

  await db.doc('ladders/mp').set({
    naam: 'MP',
    spelerIds: [SPELER_A, SPELER_B, SPELER_C],
    uitslagen: [],
    config: { laagStijg: 4, laagZak: 2, hoogStijg: 1, hoogZak: 1, inactiviteitAan: false,
              frequentieBonusAan: false, diversiteitsBonusAan: false },
  });
  await db.doc(`ladders/mp/standen/${SPELER_A}`).set({ rank: 1, partijen: 0, gewonnen: 0 });
  await db.doc(`ladders/mp/standen/${SPELER_B}`).set({ rank: 2, partijen: 0, gewonnen: 0 });
  await db.doc(`ladders/mp/standen/${SPELER_C}`).set({ rank: 3, partijen: 0, gewonnen: 0 });

  await db.doc('ladders/mp/partijen/p1').set({
    partijId: 'p1', ladderId: 'mp', holes: HOLES, status: 'actief',
    spelers: [{ uid: SPELER_A, naam: 'Anna', hcp: 10, partijHcp: 10 },
              { uid: SPELER_B, naam: 'Bram', hcp: 10, partijHcp: 10 }],
    matchups: [{ id: 'm1', spelerA: { uid: SPELER_A, naam: 'Anna' },
                 spelerB: { uid: SPELER_B, naam: 'Bram' },
                 hcpOntvanger: SPELER_B, hcpSlagen: 0 }],
  });
  if (metScores) {
    // Anna wint hole 1 overtuigend; verder niets ingevuld.
    await db.doc(`ladders/mp/partijen/p1/scores/${SPELER_A}`).set({ holes: { '0': 3 } });
    await db.doc(`ladders/mp/partijen/p1/scores/${SPELER_B}`).set({ holes: { '0': 5 } });
  }
}

const rang = async (uid) => (await db.doc(`ladders/mp/standen/${uid}`).get()).data()?.rank;
const punt = async (uid) => (await db.doc(`ladders/mp/punten/${uid}`).get()).data();

async function main() {
  await wachtOpPoort(8080);
  await wachtOpPoort(9099);
  await wachtOpPoort(FN_POORT);

  const tokenA   = await tokenVoor(SPELER_A);
  const tokenB   = await tokenVoor(SPELER_B);
  const tokenC   = await tokenVoor(SPELER_C);
  const tokenBui = await tokenVoor(BUITEN);
  const tokenBeh = await tokenVoor(BEHEERDER);

  const matchup = [{ spelerAUid: SPELER_A, spelerBUid: SPELER_B, winnaarUid: SPELER_B }];

  // ══ verwerkPartijUitslag — de kern ═════════════════════════
  await zetLadderKlaar();
  await R.magWel('partij afsluiten zonder scores lukt (uitdrukkelijke eis)',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA));
  R.check('winnaar Bram staat nu eerste', await rang(SPELER_B), 1);
  // v5.4.3: verwachting was 2, dat was fout. Met laagZak = 2 zakt de
  // verliezer twee plekken: Anna stond 1e, dus 1 + 2 = 3. Cees schuift
  // daardoor op naar 2. Dit is exact wat de rekenkern voorschrijft (zie
  // tests/partij.test.cjs, 'verliezer zakt laagZak') en wat de Cloud
  // Function ook deed — de test lag ernaast, niet de app.
  R.check('verliezer Anna is twee plekken gezakt', await rang(SPELER_A), 3);
  R.check('Cees is opgeschoven naar de tweede plek', await rang(SPELER_C), 2);

  // Idempotentie: een tweede aanroep (netwerkhapering, dubbele tik) mag de
  // partij niet nog een keer laten meetellen.
  const voorTweede = { b: await rang(SPELER_B), a: await rang(SPELER_A) };
  const tweede = await roepAan('verwerkPartijUitslag',
    { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA);
  R.check('tweede aanroep meldt "al verwerkt"', tweede.alVerwerkt, true);
  R.check('tweede aanroep verschuift de stand niet',
    { b: await rang(SPELER_B), a: await rang(SPELER_A) }, voorTweede);

  await zetLadderKlaar();
  await R.magNiet('onbekend partijId wordt geweigerd',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'bestaat_niet', matchups: matchup }, tokenA));
  await R.magNiet('partijId ontbreekt wordt geweigerd',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', matchups: matchup }, tokenA));
  await R.magNiet('niet-deelnemer kan de partij niet afsluiten',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenC));
  await R.magNiet('buitenstaander kan de partij niet afsluiten',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenBui));
  await R.magNiet('zonder inloggen kan het niet',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, null));
  await R.magNiet('matchup met een speler die niet meedeed wordt geweigerd',
    () => roepAan('verwerkPartijUitslag',
      { ladderId: 'mp', partijId: 'p1',
        matchups: [{ spelerAUid: SPELER_A, spelerBUid: SPELER_C, winnaarUid: SPELER_A }] }, tokenA));
  await R.magNiet('winnaar die niet in de matchup zat wordt geweigerd',
    () => roepAan('verwerkPartijUitslag',
      { ladderId: 'mp', partijId: 'p1',
        matchups: [{ spelerAUid: SPELER_A, spelerBUid: SPELER_B, winnaarUid: SPELER_C }] }, tokenA));

  // Scores die de match beslissen moeten kloppen met de opgegeven winnaar
  await zetLadderKlaar({ metScores: true });
  await R.magNiet('winnaar die de scores tegenspreekt wordt geweigerd',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA));
  await R.magWel('winnaar die klopt met de scores wordt geaccepteerd',
    () => roepAan('verwerkPartijUitslag',
      { ladderId: 'mp', partijId: 'p1',
        matchups: [{ spelerAUid: SPELER_A, spelerBUid: SPELER_B, winnaarUid: SPELER_A }] }, tokenA));

  // ══ v5.12.7 — TWEE SPELERS DIE TEGELIJK BEVESTIGEN ═════════
  //  De controle op "al verwerkt" leest het stempel aan het BEGIN van de
  //  functie en schrijft het pas aan het EIND weg. Daartussen zit al het echte
  //  werk. Bevestigen twee spelers uit dezelfde flight in diezelfde seconde,
  //  dan kwamen ze er allebei doorheen en verschoof de ladder twee keer.
  //  Sinds v5.12.7 gaat het stempel met `create` de deur uit: dat weigert een
  //  bestaand document en laat de hele batch mislukken.
  //
  //  ⚠ GEMETEN OP 13 SEPTEMBER 2026, en het viel anders uit dan gedacht.
  //  Tien rondes tegen de OUDE server, met de responstijden erbij:
  //      ronde 2  VERWERKT@194ms   VERWERKT@160ms
  //      ronde 3  VERWERKT@153ms   VERWERKT@161ms
  //  Beide aanroepen verwerkten de partij dus echt. Tegen de NIEUWE server:
  //      ronde 2  alVerwerkt@255ms VERWERKT@222ms
  //      ronde 3  alVerwerkt@148ms VERWERKT@135ms
  //
  //  Maar de LADDERSTAND was in beide gevallen gelijk: 10 van de 10 rondes
  //  precies een verschuiving. Dat is geen toeval en het betekent niet dat de
  //  fout onschuldig was. De rangen worden als absolute waarde weggeschreven
  //  (`rank: publiekeRank`), niet opgeteld — beide aanroepen lezen dezelfde
  //  begintoestand en schrijven daarna hetzelfde getal. De laatste wint, en dat
  //  is hetzelfde getal.
  //
  //  ⚠ DE SCHADE ZIT DUS NIET IN DE RANG MAAR IN HET ANTWOORD. Kreeg de tweede
  //  speler `alVerwerkt: false`, dan schreef zijn browser er alsnog een
  //  uitslagvermelding bij (js/ronde.js, de v5.7.0-opmerking): een extra
  //  gespeelde partij en een extra ontmoeting, waarmee de frequentie- en
  //  diversiteitsbonus worden opgeblazen.
  //
  //  De controle hieronder die er echt toe doet is daarom "precies een heeft
  //  verwerkt" — die valt op de oude server om. De rangcontroles zijn een
  //  vangnet; die slaagden ook vóór de reparatie.
  await zetLadderKlaar();
  const tegelijk = await Promise.allSettled([
    roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA),
    roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenB),
  ]);
  const gelukt = tegelijk.filter(r => r.status === 'fulfilled');
  R.check('beide gelijktijdige aanroepen geven een net antwoord', gelukt.length, 2);
  // ↓ DIT is de controle met tanden: op de oude server meldden er twee VERWERKT.
  R.check('precies één ervan heeft de partij echt verwerkt',
    gelukt.filter(r => !r.value.alVerwerkt).length, 1);
  R.check('de ander meldt "al verwerkt"',
    gelukt.filter(r => r.value.alVerwerkt === true).length, 1);
  //  Vangnet: de stand hoort te zijn alsof er een keer verschoven is. Bram
  //  stond 2e en wint (hoogStijg 1 -> 1e), Anna stond 1e en zakt twee plekken
  //  (laagZak 2 -> 3e). Zie de uitleg hierboven: dit slaagde ook vóór de
  //  reparatie, want de rangen zijn absolute waarden.
  R.check('winnaar Bram staat eerste, precies één verschuiving', await rang(SPELER_B), 1);
  R.check('verliezer Anna is twee plekken gezakt, niet vier', await rang(SPELER_A), 3);
  R.check('Cees is één plek opgeschoven', await rang(SPELER_C), 2);
  const stempels = await db.collection('ladders/mp/verwerkt').get();
  R.check('er staat precies één verwerkt-stempel', stempels.size, 1);

  // ══ draaiPartijTerug ═══════════════════════════════════════
  await zetLadderKlaar();
  await roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA);
  R.check('vóór terugdraaien staat Bram eerste', await rang(SPELER_B), 1);
  await R.magNiet('speler kan een uitslag niet terugdraaien',
    () => roepAan('draaiPartijTerug', { ladderId: 'mp', partijId: 'p1' }, tokenA));
  await R.magWel('beheerder kan een uitslag terugdraaien',
    () => roepAan('draaiPartijTerug', { ladderId: 'mp', partijId: 'p1' }, tokenBeh));
  R.check('na terugdraaien staat Anna weer eerste', await rang(SPELER_A), 1);
  R.check('na terugdraaien staat Bram weer tweede', await rang(SPELER_B), 2);

  //  v5.12.7: twee keer terugdraaien hoort een geruststelling te geven, geen
  //  fout. De grendel keek naar een veld op het verwerkt-document, terwijl dat
  //  document bij het terugdraaien juist wordt weggehaald — hij kon dus nooit
  //  aangaan, en de tweede poging viel om op "niet als verwerkt geregistreerd".
  const nogmaals = await roepAan('draaiPartijTerug', { ladderId: 'mp', partijId: 'p1' }, tokenBeh);
  R.check('tweede keer terugdraaien meldt "al teruggedraaid"', nogmaals.alTeruggedraaid, true);
  R.check('tweede keer terugdraaien verschuift niets', await rang(SPELER_A), 1);
  await R.magNiet('een partij die nooit verwerkt is, blijft "niet gevonden"',
    () => roepAan('draaiPartijTerug', { ladderId: 'mp', partijId: 'nooit_verwerkt' }, tokenBeh));

  // ══ Activiteit — mag NIET opstapelen ═══════════════════════
  await zetLadderKlaar();
  await db.doc('ladders/mp').set({
    config: { laagStijg: 4, laagZak: 2, hoogStijg: 1, hoogZak: 1,
              inactiviteitAan: true, inactiviteitDrempelWeken: 4, inactiviteitModel: 'zacht',
              inactiviteitReferentiedatum: '2020-01-01',
              frequentieBonusAan: false, diversiteitsBonusAan: false },
  }, { merge: true });

  await R.magWel('activiteit handmatig verwerken lukt voor de beheerder',
    () => roepAan('verwerkActiviteitNu', { ladderId: 'mp' }, tokenBeh));
  const naEerste = { a: await rang(SPELER_A), b: await rang(SPELER_B), c: await rang(SPELER_C) };
  const verschuivingA = (await punt(SPELER_A))?.activiteitVerschuiving;

  await roepAan('verwerkActiviteitNu', { ladderId: 'mp' }, tokenBeh);
  const naTweede = { a: await rang(SPELER_A), b: await rang(SPELER_B), c: await rang(SPELER_C) };
  R.check('tweede activiteitsrun verandert niets meer (geen opstapeling)', naTweede, naEerste);
  R.check('de boekhouding blijft gelijk', (await punt(SPELER_A))?.activiteitVerschuiving, verschuivingA);
  await R.magNiet('speler kan de activiteitsrun niet starten',
    () => roepAan('verwerkActiviteitNu', { ladderId: 'mp' }, tokenA));

  // ══ Snapshots — moeten de punten bevatten ══════════════════
  await zetLadderKlaar();
  await roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA);
  const snapRes = await roepAan('maakLadderSnapshot', { ladderId: 'mp', label: 'Test' }, tokenBeh);
  R.check('snapshot bevat alle spelers', snapRes.aantal, 3);
  const snapDoc = await db.doc(`snapshots/${snapRes.snapshotId}`).get();
  R.check('snapshot is gemarkeerd als "bevat punten"', snapDoc.data().bevatPunten, true);
  R.check('snapshot bewaart de activiteitsboekhouding',
    typeof snapDoc.data().spelers[0].activiteitVerschuiving, 'number');
  R.check('snapshot bewaart de score', typeof snapDoc.data().spelers[0].score, 'number');

  // Stand verzetten en daarna herstellen
  await db.doc(`ladders/mp/standen/${SPELER_A}`).set({ rank: 3 }, { merge: true });
  await db.doc(`ladders/mp/standen/${SPELER_C}`).set({ rank: 1 }, { merge: true });
  await R.magNiet('speler kan geen snapshot terugzetten',
    () => roepAan('herstelLadderSnapshot', { ladderId: 'mp', snapshotId: snapRes.snapshotId }, tokenA));
  await R.magWel('beheerder kan de snapshot terugzetten',
    () => roepAan('herstelLadderSnapshot', { ladderId: 'mp', snapshotId: snapRes.snapshotId }, tokenBeh));
  R.check('stand is hersteld', await rang(SPELER_B), 1);
  R.check('punten horen weer bij de positie',
    (await punt(SPELER_B))?.score, (await punt(SPELER_B))?.basisScore);

  // ══ Backup — moet alles meenemen ═══════════════════════════
  const backup = await roepAan('exporteerBackupExtra', {}, tokenBeh);
  R.check('backup bevat de ladder', Object.keys(backup.ladders).includes('mp'), true);
  R.check('backup bevat punten', Object.keys(backup.ladders.mp.punten).length > 0, true);
  R.check('backup bevat het verwerkt-stempel', Object.keys(backup.ladders.mp.verwerkt).length, 1);
  await R.magNiet('speler kan geen backup maken',
    () => roepAan('exporteerBackupExtra', {}, tokenA));

  await db.recursiveDelete(db.collection('ladders/mp/punten'));
  R.check('punten zijn gewist', (await db.collection('ladders/mp/punten').get()).size, 0);
  await R.magWel('backup terugzetten lukt',
    () => roepAan('importeerBackupExtra', { ladders: backup.ladders }, tokenBeh));
  R.check('punten staan er weer', (await db.collection('ladders/mp/punten').get()).size > 0, true);

  // ══ Seizoensreset ══════════════════════════════════════════
  await R.magWel('seizoen resetten lukt voor de beheerder',
    () => roepAan('resetLadderSeizoen', { ladderId: 'mp', volgorde: [SPELER_A, SPELER_B, SPELER_C] }, tokenBeh));
  R.check('punten zijn opgeruimd', (await db.collection('ladders/mp/punten').get()).size, 0);
  R.check('partijen zijn opgeruimd', (await db.collection('ladders/mp/partijen').get()).size, 0);
  R.check('verwerkt-stempels zijn opgeruimd', (await db.collection('ladders/mp/verwerkt').get()).size, 0);
  R.check('standen zijn opnieuw genummerd', await rang(SPELER_A), 1);
  await R.magNiet('speler kan geen seizoen resetten',
    () => roepAan('resetLadderSeizoen', { ladderId: 'mp', volgorde: [] }, tokenA));

  // ══ Toernooistanden — standen én punten ════════════════════
  await zetLadderKlaar();
  await R.magWel('toernooistanden wegschrijven lukt',
    () => roepAan('verwerkToernooiStanden', { ladderId: 'mp', standen: [
      { uid: SPELER_C, rank: 1, partijen: 2, gewonnen: 2 },
      { uid: SPELER_A, rank: 2, partijen: 2, gewonnen: 1 },
      { uid: SPELER_B, rank: 3, partijen: 2, gewonnen: 0 },
    ] }, tokenBeh));
  R.check('toernooiwinnaar staat eerste', await rang(SPELER_C), 1);
  R.check('punten zijn meegeschreven', typeof (await punt(SPELER_C))?.score, 'number');
  R.check('score hoort bij de positie',
    (await punt(SPELER_C)).score > (await punt(SPELER_A)).score, true);

  // ══ Ladder verwijderen ═════════════════════════════════════
  await R.magWel('beheerder kan een ladder volledig verwijderen',
    () => roepAan('verwijderLadderVolledig', { ladderId: 'mp' }, tokenBeh));
  R.check('ladderdocument is weg', (await db.doc('ladders/mp').get()).exists, false);
  R.check('standen zijn mee opgeruimd', (await db.collection('ladders/mp/standen').get()).size, 0);
  R.check('punten zijn mee opgeruimd', (await db.collection('ladders/mp/punten').get()).size, 0);

  // ══ Watch-PIN ══════════════════════════════════════════════
  await zetLadderKlaar();
  const pinRes = await roepAan('maakWatchPin', {}, tokenA);
  R.check('PIN is zes cijfers', /^\d{6}$/.test(pinRes.pin), true);
  const bewaard = (await db.doc('ladder/watchPins').get()).data();
  R.check('de PIN zelf staat NIET in Firestore', JSON.stringify(bewaard).includes(pinRes.pin), false);
  R.check('er staat geen refreshToken in Firestore', JSON.stringify(bewaard).includes('refreshToken'), false);
  await R.magNiet('zonder inloggen kun je geen PIN maken',
    () => roepAan('maakWatchPin', {}, null));

  const wissel = await roepAan('wisselWatchPin', { pin: pinRes.pin }, null);
  R.check('inwisselen geeft een token', typeof wissel.customToken, 'string');
  R.check('inwisselen geeft de juiste speler', wissel.uid, SPELER_A);
  await R.magNiet('dezelfde PIN werkt geen tweede keer',
    () => roepAan('wisselWatchPin', { pin: pinRes.pin }, null));
  await R.magNiet('een verzonnen PIN werkt niet',
    () => roepAan('wisselWatchPin', { pin: '000000' }, null));
  await R.magNiet('een PIN van vier cijfers wordt geweigerd',
    () => roepAan('wisselWatchPin', { pin: '1234' }, null));

  // ══ Wees-account opruimen ══════════════════════════════════
  await R.magNiet('account MET profiel wordt niet verwijderd',
    () => roepAan('verwijderWeesAccount', { targetUid: SPELER_A }, tokenBeh));
  await R.magNiet('speler kan geen accounts opruimen',
    () => roepAan('verwijderWeesAccount', { targetUid: 'uid_zonder_profiel_000' }, tokenA));

  // ══ pasPuntenAan ═══════════════════════════════════════════
  await R.magNiet('gewone speler kan de punten niet aanpassen',
    () => roepAan('pasPuntenAan', { ladderId: 'mp', uid: SPELER_A, score: 9999999 }, tokenA));
  await R.magNiet('zelfs de beheerder niet zonder puntenBeheerder-vlag',
    () => roepAan('pasPuntenAan', { ladderId: 'mp', uid: SPELER_A, score: 9999999 }, tokenBeh));

  // ══ v5.38.0 — DE TOERNOOI-PINCODE ══════════════════════════
  //  Dit IS de inlog van een deelnemer. Gaat hier iets mis, dan staat er
  //  iemand voor een dichte deur op de eerste tee — of staat er juist iemand
  //  binnen die er niet hoort.
  const crypto = require('crypto');
  const afdruk = (pin) => crypto.createHash('sha256').update(String(pin), 'utf8').digest('hex');

  await db.doc('toernooien/t_pin').set({
    naam: 'Pincode Cup', status: 'actief',
    dagen: [{ dagNr: 1, gestart: true, afgerond: false, holes: HOLES, flights: [], scores: {} }],
    spelers: [
      { uid: SPELER_A,  naam: 'Anna', hcp: 10, gast: false },
      { uid: BEHEERDER, naam: 'Bea',  hcp: 10, gast: false },
    ],
  });
  await db.doc('toernooien/t_pin/beheer/gastlogin').set({
    wachtwoord: 'willekeurig-en-lang', code: 'pincodecup', pinHash: afdruk('1234'), pin: '1234',
  });

  await R.magNiet('een pincode van drie cijfers wordt geweigerd',
    () => roepAan('wisselToernooiPin', { toernooiId: 't_pin', spelerUid: SPELER_A, pin: '123' }, null));
  await R.magNiet('zonder naam kom je er niet in',
    () => roepAan('wisselToernooiPin', { toernooiId: 't_pin', spelerUid: '', pin: '1234' }, null));
  await R.magNiet('een naam die niet meedoet komt er niet in',
    () => roepAan('wisselToernooiPin', { toernooiId: 't_pin', spelerUid: BUITEN, pin: '1234' }, null));
  await R.magNiet('een verkeerde pincode komt er niet in',
    () => roepAan('wisselToernooiPin', { toernooiId: 't_pin', spelerUid: SPELER_A, pin: '9999' }, null));

  // ⚠ De belangrijkste van allemaal. Zou dit lukken, dan is dat ene getal dat
  // op de eerste tee wordt rondverteld de sleutel tot het hele beheerscherm.
  await R.magNiet('de WEDSTRIJDLEIDING komt er niet in met de pincode',
    () => roepAan('wisselToernooiPin', { toernooiId: 't_pin', spelerUid: BEHEERDER, pin: '1234' }, null));

  // En dan de goede afloop: een deelnemer met de juiste pincode.
  const pinUit = await roepAan('wisselToernooiPin',
    { toernooiId: 't_pin', spelerUid: SPELER_A, pin: '1234' }, null);
  R.check('een deelnemer krijgt een inlogtoken', typeof pinUit?.customToken, 'string');
  R.check('en het gaat om de juiste speler', pinUit?.uid, SPELER_A);
  R.check('met zijn naam erbij', pinUit?.naam, 'Anna');

  // Het token moet de stempel dragen waar firestore.rules op kijkt. Ontbreekt
  // die, dan staat de deelnemer binnen MET alle rechten van een clublid.
  const ontcijferd = JSON.parse(
    Buffer.from(String(pinUit.customToken).split('.')[1], 'base64').toString('utf8'));
  R.check('het token draagt de stempel viaPin', ontcijferd?.claims?.viaPin, true);
  R.check('en weet bij welk toernooi het hoort', ontcijferd?.claims?.toernooiId, 't_pin');

  // Een pincode-sessie mag geen enkele serverfunctie aanroepen.
  const pinCustom = await admin.auth().createCustomToken(SPELER_A, { viaPin: true, toernooiId: 't_pin' });
  const pinAanmeld = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pinCustom, returnSecureToken: true }) });
  const pinToken = (await pinAanmeld.json()).idToken;
  await R.magNiet('een pincode-sessie kan GEEN partijuitslag verwerken',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1' }, pinToken));
  await R.magNiet('een pincode-sessie kan GEEN horloge-pincode maken',
    () => roepAan('maakWatchPin', {}, pinToken));
  await R.magNiet('een pincode-sessie kan de eerste login niet voltooien',
    () => roepAan('voltooiEersteLogin', { hcp: 1 }, pinToken));

  // Een toernooi dat niet meer loopt, geeft geen toegang meer.
  await db.doc('toernooien/t_pin').update({ status: 'afgerond' });
  await R.magNiet('een afgesloten toernooi laat niemand meer binnen',
    () => roepAan('wisselToernooiPin', { toernooiId: 't_pin', spelerUid: SPELER_A, pin: '1234' }, null));

  return toonRapport(R);
}

main()
  .then(fouten => process.exit(fouten ? 1 : 0))
  .catch(e => { console.error('\n Functietests konden niet draaien:\n', e); process.exit(1); });
