// ============================================================
//  Laag 2 — Firestore-beveiligingsregels
// ============================================================
//  Elke regel uit firestore.rules wordt hier van twee kanten getoetst: wie het
//  wél mag, en wie het níét mag. Zo kan een beveiligingsgat als het
//  watchPins-lek of de vrij schrijfbare standen niet stilzwijgend terugkomen.
//
//  Draaien:  firebase emulators:exec --only firestore "node tests/emulator/rules.test.cjs"
// ============================================================
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { maakRapport, toonRapport, wachtOpPoort } = require('./helpers.cjs');

const WORTEL = path.join(__dirname, '..', '..');
const R = maakRapport('Firestore-regels');

// Vaste uid's voor de verschillende rollen
const BEHEERDER   = 'uid_beheerder_0000000000';
const COORDINATOR = 'uid_coordinator_00000000';
const SPELER      = 'uid_speler_aaaaaaaaaaaaa';
const SPELER2     = 'uid_speler_bbbbbbbbbbbbb';
const BUITEN      = 'uid_buitenstaander_00000';
const PUNTENBAAS  = 'uid_puntenbeheerder_0000';

async function main() {
  await wachtOpPoort(8080);

  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-goyer-regels',
    firestore: {
      rules: fs.readFileSync(path.join(WORTEL, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await testEnv.clearFirestore();

  // ── Testdata klaarzetten (regels tijdelijk uit) ────────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`spelers/${BEHEERDER}`).set({ naam: 'Bea Beheerder', rol: 'beheerder', hcp: 10 });
    await db.doc(`spelers/${COORDINATOR}`).set({ naam: 'Coen Coordinator', rol: 'coordinator', hcp: 12 });
    await db.doc(`spelers/${SPELER}`).set({ naam: 'Sam Speler', rol: 'speler', hcp: 18 });
    await db.doc(`spelers/${SPELER2}`).set({ naam: 'Sil Speler', rol: 'speler', hcp: 20 });
    await db.doc(`spelers/${BUITEN}`).set({ naam: 'Bas Buiten', rol: 'speler', hcp: 24 });
    await db.doc(`spelers/${PUNTENBAAS}`).set({ naam: 'Piet Punten', rol: 'speler', hcp: 8, puntenBeheerder: true });

    await db.doc('ladders/mp').set({ naam: 'MP', spelerIds: [SPELER, SPELER2, COORDINATOR, PUNTENBAAS] });
    await db.doc(`ladders/mp/standen/${SPELER}`).set({ rank: 1, partijen: 3, gewonnen: 2, hcp: 18 });
    await db.doc(`ladders/mp/standen/${SPELER2}`).set({ rank: 2, partijen: 3, gewonnen: 1, hcp: 20 });
    await db.doc(`ladders/mp/punten/${SPELER}`).set({ score: 1000000, basisScore: 1000000, activiteitVerschuiving: 0 });
    await db.doc('ladders/mp/partijen/p_test').set({ partijId: 'p_test', spelers: [{ uid: SPELER }] });
    // v5.40.0: een TWEEDE partij, om te toetsen dat een ronde-gast daar niet bij kan.
    await db.doc('ladders/mp/partijen/p_ander').set({ partijId: 'p_ander', spelers: [{ uid: SPELER2 }] });
    await db.doc('ladder/qrGeheim').set({ geheim: 'x'.repeat(64), gemaakt: Date.now() });
    await db.doc(`ladders/mp/partijen/p_test/scores/${SPELER}`).set({ holes: { '0': 4 } });
    await db.doc('ladders/mp/verwerkt/p_test').set({ partijId: 'p_test' });
    await db.doc('ladders/mp/teruggedraaid/p_oud').set({ partijId: 'p_oud' });

    await db.doc('ladder/config').set({ initieelWachtwoord: 'geheim123' });
    await db.doc('ladder/watchPins').set({ abc123hash: { uid: SPELER, expires: Date.now() + 60000 } });
    await db.doc('ladder/watchPinPogingen').set({ fouten: 0, venster: Date.now() });
    await db.doc('ladder/banen').set({ lijst: [] });
    await db.doc('ladder/archief').set({ lijst: [] });
    await db.doc('snapshots/s1').set({ ladderId: 'mp', spelers: [] });
    await db.doc('toernooien/t1').set({ naam: 'Zomer', status: 'actief' });
    // v5.10.0: twee afgeronde toernooien — een met de uitslag nog openbaar,
    // een waarvan de coordinator de link heeft dichtgezet.
    await db.doc('toernooien/t_open').set({ naam: 'Open', status: 'afgerond' });
    await db.doc('toernooien/t_dicht').set({ naam: 'Dicht', status: 'afgerond', publiek: false });
    await db.doc('toernooien/t1/beheer/gastlogin').set({ wachtwoord: 'geheim123' });
    await db.doc('toernooien/t1/live/' + SPELER).set({ dagNr: 1, scores: [4] });
    await db.doc('uitslagen/u1').set({ ladderId: 'mp', datum: '2026-08-01' });
  });

  const anon    = testEnv.unauthenticatedContext().firestore();
  const speler  = testEnv.authenticatedContext(SPELER).firestore();
  const speler2 = testEnv.authenticatedContext(SPELER2).firestore();
  const buiten  = testEnv.authenticatedContext(BUITEN).firestore();
  const coord   = testEnv.authenticatedContext(COORDINATOR).firestore();
  const beheer  = testEnv.authenticatedContext(BEHEERDER).firestore();
  const punten  = testEnv.authenticatedContext(PUNTENBAAS).firestore();
  // v5.38.0: dezelfde speler, maar binnengekomen met de toernooi-pincode. De
  // stempel `viaPin` komt van de server (createCustomToken) en zit in het
  // inlogtoken — een client kan hem niet zelf zetten.
  const pinSessie = testEnv.authenticatedContext(SPELER, { viaPin: true }).firestore();
  // v5.40.0: een gast die de QR van ronde p_test scande. Uid is het tijdelijke
  // profiel dat de serverfunctie aanmaakt; de stempel draagt het partijnummer.
  const rondeGast = testEnv.authenticatedContext('rondegast_p_test',
    { viaRonde: 'p_test', ladderId: 'mp' }).firestore();

  // ══ watchPins — het lek van v5.0.0 ═════════════════════════
  await R.magNiet('anoniem kan watchPins NIET lezen',
    () => anon.doc('ladder/watchPins').get());
  await R.magNiet('ingelogde speler kan watchPins NIET lezen',
    () => speler.doc('ladder/watchPins').get());
  await R.magNiet('beheerder kan watchPins NIET lezen',
    () => beheer.doc('ladder/watchPins').get());
  await R.magNiet('niemand kan naar watchPins schrijven',
    () => speler.doc('ladder/watchPins').set({ hack: true }));
  await R.magNiet('watchPinPogingen is niet leesbaar',
    () => speler.doc('ladder/watchPinPogingen').get());

  // ══ config — bevat het initiële wachtwoord ═════════════════
  await R.magNiet('speler kan config NIET lezen',
    () => speler.doc('ladder/config').get());
  await R.magNiet('coordinator kan config NIET lezen',
    () => coord.doc('ladder/config').get());
  await R.magWel('beheerder kan config wel lezen',
    () => beheer.doc('ladder/config').get());
  await R.magNiet('speler kan config niet wijzigen',
    () => speler.doc('ladder/config').set({ initieelWachtwoord: 'gehackt' }));
  await R.magWel('beheerder kan config wijzigen',
    () => beheer.doc('ladder/config').set({ initieelWachtwoord: 'nieuw123' }));

  // ══ standen — de zichtbare ladderpositie ═══════════════════
  await R.magWel('speler kan standen lezen',
    () => speler.doc(`ladders/mp/standen/${SPELER}`).get());
  await R.magWel('speler kan de standen-collectie uitlezen (listener)',
    () => speler.collection('ladders/mp/standen').get());
  await R.magNiet('anoniem kan standen NIET lezen',
    () => anon.doc(`ladders/mp/standen/${SPELER}`).get());
  // LET OP: hier moet een ANDERE waarde staan dan de huidige. Een update die
  // niets verandert levert een lege `affectedKeys()` op, en `hasOnly(['hcp'])`
  // is dan waar — de regel zou de schrijfactie dus toestaan en de test zou
  // ten onrechte slagen. Rang is 1, dus we proberen 5.
  await R.magNiet('speler kan zijn EIGEN rang niet wijzigen',
    () => speler.doc(`ladders/mp/standen/${SPELER}`).update({ rank: 5 }));
  await R.magNiet('speler kan andermans rang niet wijzigen',
    () => speler.doc(`ladders/mp/standen/${SPELER2}`).update({ rank: 99 }));
  await R.magNiet('speler kan geen partijen/gewonnen ophogen',
    () => speler.doc(`ladders/mp/standen/${SPELER}`).update({ gewonnen: 99 }));
  await R.magWel('speler mag wel zijn eigen handicap bijwerken',
    () => speler.doc(`ladders/mp/standen/${SPELER}`).update({ hcp: 17 }));
  await R.magNiet('speler mag niet de handicap van een ander bijwerken',
    () => speler.doc(`ladders/mp/standen/${SPELER2}`).update({ hcp: 5 }));
  await R.magWel('coordinator mag standen wel wijzigen',
    () => coord.doc(`ladders/mp/standen/${SPELER}`).update({ rank: 1 }));
  await R.magNiet('speler kan geen stand verwijderen',
    () => speler.doc(`ladders/mp/standen/${SPELER2}`).delete());

  // ══ punten — afgeschermd ═══════════════════════════════════
  await R.magNiet('speler kan punten NIET lezen',
    () => speler.doc(`ladders/mp/punten/${SPELER}`).get());
  await R.magNiet('coordinator kan punten NIET lezen',
    () => coord.doc(`ladders/mp/punten/${SPELER}`).get());
  await R.magWel('puntenbeheerder kan punten wel lezen',
    () => punten.doc(`ladders/mp/punten/${SPELER}`).get());
  await R.magNiet('zelfs de puntenbeheerder kan punten niet schrijven',
    () => punten.doc(`ladders/mp/punten/${SPELER}`).set({ score: 9999999 }));
  await R.magNiet('beheerder kan punten niet schrijven',
    () => beheer.doc(`ladders/mp/punten/${SPELER}`).set({ score: 9999999 }));

  // ══ partijen en scores — het nieuwe datamodel ══════════════
  await R.magWel('ladderlid kan een partij lezen',
    () => speler.doc('ladders/mp/partijen/p_test').get());
  await R.magWel('ladderlid kan scores schrijven (ook van een flightgenoot)',
    () => speler.doc(`ladders/mp/partijen/p_test/scores/${SPELER2}`).set({ holes: { '0': 5 } }));
  await R.magWel('ladderlid kan een partij starten',
    () => speler.doc('ladders/mp/partijen/p_nieuw').set({ partijId: 'p_nieuw', spelers: [] }));
  await R.magNiet('buitenstaander kan geen scores schrijven',
    () => buiten.doc(`ladders/mp/partijen/p_test/scores/${SPELER}`).set({ holes: { '0': 9 } }));
  await R.magNiet('anoniem kan geen scores lezen',
    () => anon.doc(`ladders/mp/partijen/p_test/scores/${SPELER}`).get());

  // ══ verwerkt / teruggedraaid — alleen de server ════════════
  await R.magWel('speler kan het verwerkt-stempel lezen',
    () => speler.doc('ladders/mp/verwerkt/p_test').get());
  await R.magNiet('niemand kan het verwerkt-stempel schrijven',
    () => coord.doc('ladders/mp/verwerkt/p_test').set({ vervalst: true }));
  await R.magNiet('niemand kan het verwerkt-stempel verwijderen',
    () => beheer.doc('ladders/mp/verwerkt/p_test').delete());
  await R.magWel('coordinator kan teruggedraaide uitslagen inzien',
    () => coord.doc('ladders/mp/teruggedraaid/p_oud').get());
  await R.magNiet('speler kan teruggedraaide uitslagen niet inzien',
    () => speler.doc('ladders/mp/teruggedraaid/p_oud').get());

  // ══ spelers — profielen ════════════════════════════════════
  await R.magWel('ingelogde speler kan profielen lezen',
    () => speler.doc(`spelers/${SPELER2}`).get());
  await R.magNiet('anoniem kan profielen niet lezen',
    () => anon.doc(`spelers/${SPELER}`).get());
  await R.magWel('speler kan zijn eigen handicap aanpassen',
    () => speler.doc(`spelers/${SPELER}`).update({ hcp: 16 }));
  await R.magNiet('speler kan zijn eigen rol niet veranderen',
    () => speler.doc(`spelers/${SPELER}`).update({ rol: 'beheerder' }));
  await R.magNiet('speler kan zichzelf niet tot puntenbeheerder maken',
    () => speler.doc(`spelers/${SPELER}`).update({ puntenBeheerder: true }));
  await R.magNiet('speler kan andermans profiel niet wijzigen',
    () => speler.doc(`spelers/${SPELER2}`).update({ hcp: 1 }));
  await R.magWel('beheerder kan profielen wijzigen',
    () => beheer.doc(`spelers/${SPELER2}`).update({ hcp: 19 }));
  await R.magNiet('speler kan een profiel niet verwijderen',
    () => speler.doc(`spelers/${SPELER2}`).delete());

  // ══ snapshots ══════════════════════════════════════════════
  await R.magNiet('speler kan snapshots NIET lezen (bevat alle spelersdata)',
    () => speler.doc('snapshots/s1').get());
  await R.magWel('coordinator kan snapshots lezen',
    () => coord.doc('snapshots/s1').get());
  await R.magWel('speler kan een snapshot aanmaken (na een partij)',
    () => speler.collection('snapshots').add({ ladderId: 'mp', spelers: [] }));
  await R.magNiet('speler kan een bestaande snapshot niet wijzigen',
    () => speler.doc('snapshots/s1').update({ spelers: [] }));

  // ══ toernooien ═════════════════════════════════════════════
  await R.magWel('toernooi is publiek leesbaar (live meekijken)',
    () => anon.doc('toernooien/t1').get());

  // ── v5.10.0: de uitslaglink dichtzetten ──────────────────
  // De link moet ECHT dicht kunnen, niet alleen in het scherm. Wie hem
  // rechtstreeks opvraagt hoort ook nul te krijgen.
  await R.magWel('afgerond toernooi blijft openbaar zolang het niet is dichtgezet',
    () => anon.doc('toernooien/t_open').get());
  await R.magNiet('dichtgezet toernooi is NIET meer openbaar leesbaar',
    () => anon.doc('toernooien/t_dicht').get());
  await R.magWel('een ingelogd clublid ziet een dichtgezet toernooi wel',
    () => speler.doc('toernooien/t_dicht').get());
  await R.magWel('de coordinator ziet een dichtgezet toernooi ook',
    () => coord.doc('toernooien/t_dicht').get());

  // ── v5.10.0: het gastwachtwoord blijft geheim ────────────
  // Het toernooi zelf is openbaar leesbaar; de onderliggende map mag dat
  // uitdrukkelijk NIET zijn, anders staat het wachtwoord op straat.
  await R.magNiet('gastwachtwoord is niet openbaar leesbaar',
    () => anon.doc('toernooien/t1/beheer/gastlogin').get());
  await R.magNiet('een gewone speler mag het gastwachtwoord niet lezen',
    () => speler.doc('toernooien/t1/beheer/gastlogin').get());
  await R.magWel('de coordinator mag het gastwachtwoord lezen',
    () => coord.doc('toernooien/t1/beheer/gastlogin').get());
  await R.magNiet('een gewone speler mag geen gastwachtwoord zetten',
    () => speler.doc('toernooien/t1/beheer/gastlogin').set({ wachtwoord: 'kaping' }));
  await R.magWel('de coordinator mag het gastwachtwoord zetten',
    () => coord.doc('toernooien/t1/beheer/gastlogin').set({ wachtwoord: 'nieuw123' }));
  await R.magNiet('speler kan een toernooi niet wijzigen',
    () => speler.doc('toernooien/t1').update({ naam: 'gehackt' }));
  await R.magWel('coordinator kan een toernooi wijzigen',
    () => coord.doc('toernooien/t1').update({ naam: 'Zomer 2026' }));
  await R.magWel('speler kan live-scores schrijven (ook voor flightgenoten)',
    () => speler.doc(`toernooien/t1/live/${SPELER2}`).set({ dagNr: 1, scores: [5] }));
  await R.magNiet('anoniem kan geen live-scores schrijven',
    () => anon.doc(`toernooien/t1/live/${SPELER}`).set({ dagNr: 1, scores: [9] }));

  // ══ v5.11.0: de drie scorelagen ════════════════════════════
  // De laag `beheerDagen` zet een hole definitief op slot voor de speler en
  // zijn flight. Wie hem kan schrijven kan dus een uitslag bepalen — daarom is
  // alleen die laag afgeschermd, en de andere twee niet.
  //
  // v5.43.0: de vaste marker is vervallen; elke speler uit de flight mag deze
  // laag schrijven. Deze regels hoefden daarvoor niet te veranderen — ze lieten
  // elke ingelogde speler hem al schrijven, en dat is hier het bewijs.
  await R.magWel('een speler kan de bevestigingslaag van een ander schrijven',
    () => speler.doc(`toernooien/t1/live/${SPELER2}`).set({ markerDagen: { '1': [5] } }, { merge: true }));
  await R.magNiet('speler kan de vastgestelde laag NIET schrijven',
    () => speler.doc(`toernooien/t1/live/${SPELER2}`).set({ beheerDagen: { '1': [3] } }, { merge: true }));
  await R.magNiet('speler kan de vastgestelde laag ook niet in een nieuw document zetten',
    () => speler.doc('toernooien/t1/live/uid_nieuw_cccccccccccc').set({ beheerDagen: { '1': [3] } }));
  await R.magWel('coordinator kan de vastgestelde laag wel schrijven',
    () => coord.doc(`toernooien/t1/live/${SPELER2}`).set({ beheerDagen: { '1': [4] } }, { merge: true }));
  await R.magNiet('speler kan een live-document niet verwijderen',
    () => speler.doc(`toernooien/t1/live/${SPELER2}`).delete());

  // ══ v5.38.0 — DE TOERNOOI-PINCODE ══════════════════════════
  //  Wie met de pincode binnenkwam heeft zijn EIGEN wachtwoord niet gebruikt:
  //  één getal van vier cijfers, gedeeld met de hele flight, was genoeg. Zo
  //  iemand mag daarom precies één ding — het toernooi bijhouden.
  //
  //  ⚠ Dit is de grendel die dat gedeelde getal draaglijk maakt. In de app
  //  worden de andere tabbladen ook verborgen, maar dat is geen slot: het
  //  houdt niemand tegen die de database rechtstreeks aanroept. Deze proeven
  //  doen dat wél rechtstreeks.
  await R.magWel('pincode-sessie mag het toernooi lezen',
    () => pinSessie.doc('toernooien/t1').get());
  await R.magWel('pincode-sessie mag scores in het toernooi schrijven',
    () => pinSessie.doc(`toernooien/t1/live/${SPELER}`).set({ dagen: { '1': [4] } }, { merge: true }));
  await R.magWel('pincode-sessie mag ook de kaart van zijn flightgenoot bijhouden',
    () => pinSessie.doc(`toernooien/t1/live/${SPELER2}`).set({ markerDagen: { '1': [5] } }, { merge: true }));
  await R.magNiet('pincode-sessie kan de wedstrijdleidingslaag niet schrijven',
    () => pinSessie.doc(`toernooien/t1/live/${SPELER2}`).set({ beheerDagen: { '1': [3] } }, { merge: true }));

  //  En nu de andere kant: alles buiten het toernooi is dicht.
  await R.magNiet('pincode-sessie kan NIET aan de ladder schrijven',
    () => pinSessie.doc('ladders/mp').set({ naam: 'gehackt' }, { merge: true }));
  await R.magNiet('pincode-sessie kan GEEN partij starten of wijzigen',
    () => pinSessie.doc('ladders/mp/partijen/p_test').set({ spelers: [] }, { merge: true }));
  await R.magNiet('pincode-sessie kan GEEN partijscores schrijven',
    () => pinSessie.doc(`ladders/mp/partijen/p_test/scores/${SPELER}`).set({ holes: { '0': 2 } }));
  await R.magNiet('pincode-sessie kan zijn EIGEN handicap niet wijzigen',
    () => pinSessie.doc(`spelers/${SPELER}`).update({ hcp: 1 }));
  await R.magNiet('pincode-sessie kan zijn stand in de ladder niet aanraken',
    () => pinSessie.doc(`ladders/mp/standen/${SPELER}`).update({ hcp: 1 }));
  await R.magNiet('pincode-sessie kan GEEN uitslag aanmaken',
    () => pinSessie.collection('uitslagen').add({ ladderId: 'mp', datum: '2026-09-19' }));
  await R.magNiet('pincode-sessie kan GEEN momentopname maken',
    () => pinSessie.collection('snapshots').add({ ladderId: 'mp', spelers: [] }));
  await R.magNiet('pincode-sessie komt niet bij het geheim van het toernooi',
    () => pinSessie.doc('toernooien/t1/beheer/gastlogin').get());

  //  De gewone speler mag dit allemaal nog steeds — anders is de grendel te
  //  ruim afgesteld en breekt hij de app voor iedereen.
  await R.magWel('een gewone speler kan nog wel aan de ladder schrijven',
    () => speler.doc('ladders/mp').set({ naam: 'MP' }, { merge: true }));
  await R.magWel('een gewone speler kan nog wel zijn handicap wijzigen',
    () => speler.doc(`spelers/${SPELER}`).update({ hcp: 17 }));

  // ══ v5.40.0 — DE QR-CODE VAN EEN RONDE ═════════════════════
  //  Een gast die een ronde-QR scande mag precies één ding: de scores van díé
  //  ronde bijhouden, van álle spelers — zo wordt er op de baan geteld. Al het
  //  andere is dicht. Zonder deze proeven is die code een sleutel tot de hele
  //  app in plaats van tot één partij.
  await R.magWel('ronde-gast mag de scores van ZIJN partij schrijven',
    () => rondeGast.doc(`ladders/mp/partijen/p_test/scores/${SPELER}`).set({ holes: { '0': 5 } }));
  await R.magWel('ook die van een medespeler in dezelfde partij',
    () => rondeGast.doc(`ladders/mp/partijen/p_test/scores/${SPELER2}`).set({ holes: { '0': 4 } }));
  await R.magWel('en hij mag de partij lezen',
    () => rondeGast.doc('ladders/mp/partijen/p_test').get());
  await R.magWel('en het ladderdocument, anders vindt hij zijn eigen ronde niet',
    () => rondeGast.doc('ladders/mp').get());

  //  En nu alles wat NIET mag.
  await R.magNiet('ronde-gast kan GEEN scores in een andere partij schrijven',
    () => rondeGast.doc(`ladders/mp/partijen/p_ander/scores/${SPELER}`).set({ holes: { '0': 9 } }));
  await R.magNiet('ronde-gast kan de partij zelf niet wijzigen',
    () => rondeGast.doc('ladders/mp/partijen/p_test').set({ status: 'klaar' }, { merge: true }));
  await R.magNiet('ronde-gast kan NIET aan de ladder schrijven',
    () => rondeGast.doc('ladders/mp').set({ naam: 'gehackt' }, { merge: true }));
  await R.magNiet('ronde-gast kan geen stand wijzigen',
    () => rondeGast.doc(`ladders/mp/standen/${SPELER}`).update({ rank: 1 }));
  await R.magNiet('ronde-gast kan geen profiel wijzigen',
    () => rondeGast.doc(`spelers/${SPELER}`).update({ hcp: 1 }));
  await R.magNiet('ronde-gast kan GEEN uitslag aanmaken',
    () => rondeGast.collection('uitslagen').add({ ladderId: 'mp', datum: '2026-09-20' }));
  await R.magNiet('ronde-gast kan geen uitdaging wegschrijven',
    () => rondeGast.doc('ladder/uitdagingen').set({ lijst: [] }));
  await R.magNiet('ronde-gast kan geen baan toevoegen',
    () => rondeGast.doc('ladder/banen').set({ lijst: ['gehackt'] }));

  //  ⚠ En hij hoort niet bij een TOERNOOI te kunnen. Hij is wel "ingelogd", en
  //  die regel stond daar tot v5.40.0 alleen op.
  await R.magNiet('ronde-gast kan GEEN toernooiscores schrijven',
    () => rondeGast.doc(`toernooien/t1/live/${SPELER}`).set({ dagen: { '1': [3] } }, { merge: true }));

  //  Het geheim waaruit alle ronde-sleutels worden uitgerekend is voor niemand.
  await R.magNiet('niemand kan het QR-geheim lezen',
    () => speler.doc('ladder/qrGeheim').get());
  await R.magNiet('ook de beheerder niet',
    () => beheer.doc('ladder/qrGeheim').get());
  await R.magNiet('en niemand kan het overschrijven',
    () => coord.doc('ladder/qrGeheim').set({ geheim: 'van mij' }));

  //  De gewone speler mag dit allemaal nog steeds.
  await R.magWel('een gewone speler kan nog scores in een partij schrijven',
    () => speler.doc(`ladders/mp/partijen/p_test/scores/${SPELER}`).set({ holes: { '0': 4 } }));
  await R.magWel('en nog steeds een baan toevoegen',
    () => speler.doc('ladder/banen').set({ lijst: [] }));

  // ══ uitslagen ══════════════════════════════════════════════
  await R.magWel('speler kan uitslagen lezen',
    () => speler.doc('uitslagen/u1').get());
  await R.magWel('speler kan een uitslag aanmaken',
    () => speler.collection('uitslagen').add({ ladderId: 'mp', datum: '2026-08-08' }));
  await R.magNiet('speler kan andermans uitslag niet overschrijven',
    () => speler.doc('uitslagen/u1').update({ datum: 'vervalst' }));
  await R.magWel('coordinator kan een uitslag corrigeren',
    () => coord.doc('uitslagen/u1').update({ datum: '2026-08-02' }));

  // ══ alles wat niet expliciet is toegestaan ═════════════════
  await R.magNiet('onbekende collectie is dicht',
    () => speler.doc('geheimen/x').get());
  await R.magNiet('onbekende collectie is niet schrijfbaar',
    () => beheer.doc('geheimen/x').set({ a: 1 }));

  await testEnv.cleanup();
  return toonRapport(R);
}

main()
  .then(fouten => process.exit(fouten ? 1 : 0))
  .catch(e => { console.error('\n Regelstests konden niet draaien:\n', e); process.exit(1); });
