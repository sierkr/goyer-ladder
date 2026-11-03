// ============================================================
//  Snapshot vóór "Activiteit nu verwerken" — automatische tests (v6.2.1)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  Sierk, 1 november 2026: "bij klikken activiteit nu verwerken moet
//  automatisch een snapshot gemaakt worden". Met "Spelers zonder partijen
//  onderaan" (v6.2.0) kan die knop de halve ladder omgooien, en de schakelaar
//  weer uitzetten zet niemand terug. Er werd geen snapshot gemaakt; de enige
//  weg terug was een oudere snapshot, met alles wat daarna kwam erbij weg.
//
//  Deze suite legt vast:
//   - na OK komt EERST de snapshot, DAN pas de activiteitscorrectie;
//   - bij Annuleren gebeurt er niets;
//   - lukt de server niet, dan telt de terugval-snapshot (zonder punten);
//   - lukt geen van beide, dan wordt er NIETS verwerkt (BOUWNORMEN F5).
//
//  draaiActiviteitNu(), slaSnapshotOp() en _slaSnapshotClientOp() zijn ECHT
//  uit js/beheer.js geknipt (laadSnapshotKern in harnas.cjs).
// ============================================================
const { laadSnapshotKern, maakChecker } = require('./harnas.cjs');
const { staat, check } = maakChecker();

module.exports = (async () => {
  console.log('\n══ OK GEKLIKT ══\n');
  {
    const K = laadSnapshotKern();
    await K.draaiActiviteitNu();
    check('eerst de vraag, dan de snapshot, dan de correctie, dan tekenen',
      K._log, ['vraag', 'snapshot-server:Vóór activiteitscorrectie:mp', 'activiteit:mp', 'tekenen']);
    check('de melding zegt dat het klaar is',
      K._meldingen, ['Klaar — geen enkele speler verschoof']);
  }

  console.log('\n══ ANNULEREN ══\n');
  {
    const K = laadSnapshotKern();
    K._zetAntwoord(false);
    await K.draaiActiviteitNu();
    check('na Annuleren geen snapshot en geen correctie', K._log, ['vraag']);
  }

  console.log('\n══ SERVER NIET BEREIKBAAR ══\n');
  {
    const K = laadSnapshotKern();
    K._zetServerSnapshotFout(true);
    await K.draaiActiviteitNu();
    check('de terugval-snapshot wordt gemaakt en daarna pas de correctie',
      K._log, ['vraag', 'snapshot-client:Vóór activiteitscorrectie (zonder punten):mp', 'activiteit:mp', 'tekenen']);
  }

  console.log('\n══ GEEN SNAPSHOT MOGELIJK ══\n');
  {
    const K = laadSnapshotKern();
    K._zetServerSnapshotFout(true);
    K._zetClientSnapshotFout(true);
    await K.draaiActiviteitNu();
    //  ⚠ Dit is de kern: zonder snapshot niet verwerken.
    check('zonder snapshot wordt er niets verwerkt', K._log, ['vraag']);
    check('en dat wordt gezegd', K._meldingen, ['Snapshot maken mislukt — er is niets verwerkt']);
  }

  console.log('\n══ WAT slaSnapshotOp TERUGGEEFT ══\n');
  {
    const K = laadSnapshotKern();
    check('server gelukt → true', await K.slaSnapshotOp('x', 'mp'), true);
    K._zetServerSnapshotFout(true);
    check('server mislukt, terugval gelukt → true', await K.slaSnapshotOp('x', 'mp'), true);
    K._zetClientSnapshotFout(true);
    check('beide mislukt → false', await K.slaSnapshotOp('x', 'mp'), false);
    const L = laadSnapshotKern();
    L._zetLadders(null, null);
    check('geen ladder → false', await L.slaSnapshotOp('x', null), false);
  }

  return staat;
})();
