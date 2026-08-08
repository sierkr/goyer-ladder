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
  const tokenC   = await tokenVoor(SPELER_C);
  const tokenBui = await tokenVoor(BUITEN);
  const tokenBeh = await tokenVoor(BEHEERDER);

  const matchup = [{ spelerAUid: SPELER_A, spelerBUid: SPELER_B, winnaarUid: SPELER_B }];

  // ══ verwerkPartijUitslag — de kern ═════════════════════════
  await zetLadderKlaar();
  await R.magWel('partij afsluiten zonder scores lukt (uitdrukkelijke eis)',
    () => roepAan('verwerkPartijUitslag', { ladderId: 'mp', partijId: 'p1', matchups: matchup }, tokenA));
  R.check('winnaar Bram staat nu eerste', await rang(SPELER_B), 1);
 // laagZak = 2, dus Anna zakt van plek 1 naar plek 3 en Cees schuift op.
  R.check('verliezer Anna zakt twee plekken', await rang(SPELER_A), 3);
  R.check('Cees schuift op naar plek 2', await rang(SPELER_C), 2);
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

  return toonRapport(R);
}

main()
  .then(fouten => process.exit(fouten ? 1 : 0))
  .catch(e => { console.error('\n Functietests konden niet draaien:\n', e); process.exit(1); });
