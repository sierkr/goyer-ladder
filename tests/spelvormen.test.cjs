// ============================================================
//  Spelvormen — automatische tests (v5.51.0)
// ============================================================
//  Taliban, Skins, Stableford, Nassau, Sixes, Wolf, Bingo Bango Bongo en de
//  ladderverschuiving die erbij hoort. js/spelvormen.js is een ES-module
//  zonder afhankelijkheden, dus hij wordt hier rechtstreeks geladen — de
//  tests rekenen met de ECHTE regels.
//
//  De verschuiving staat ook op de server (functions/index.js); die kopie
//  wordt hier uitgeknipt en tegen de app-versie gelegd. Lopen ze uit elkaar,
//  dan toont het scherm iets anders dan de ladder doet.
// ============================================================
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { maakChecker } = require('./harnas.cjs');

module.exports = (async () => {
  const { staat, check } = maakChecker();
  const S = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'spelvormen.js')).href);
  const holes = (pars) => pars.map((par, i) => ({ par, si: i + 1 }));

  console.log('\n══ TALIBAN (bovenop het Amerikaantje) ══');
  const tal = (netto, par = 4, basis = netto) => S.amerikaantjeHole(netto, { taliban: true, basis, par });
  check('birdie tegen bogey en dubbel: 6-0-0',        tal([3, 5, 6]), [6, 0, 0]);
  check('birdie tegen bogey en bogey: 6-0-0',         tal([5, 3, 5]), [0, 6, 0]);
  check('eagle tegen par: 6-0-0',                     tal([4, 4, 2]), [0, 0, 6]);
  check('birdie tegen par: gewone telling',           tal([3, 5, 4]), [4, 0, 2]);
  check('par tegen dubbele bogeys: gewone telling',   tal([4, 6, 6]), [4, 1, 1]);
  check('twee birdies: gewone telling',               tal([3, 3, 6]), [3, 3, 0]);
  check('zonder vinkje: gewone telling',              S.amerikaantjeHole([3, 5, 6], {}), [4, 2, 0]);
  check('vinkje maar onvolledig: niets',              tal([3, null, 6]), null);
  // Bruto: netto is iedereen gelijk, bruto maakt speler 1 birdie tegen bogeys.
  check('bruto birdie telt bij keuze bruto',          tal([4, 4, 4], 4, [3, 5, 5]), [6, 0, 0]);
  check('bruto par telt niet, ook al is netto birdie', tal([3, 5, 5], 4, [4, 5, 6]), [4, 1, 1]);
  // De gewone telling moet gelijk blijven aan de oude regel van v5.8.0.
  for (const [rij, verwacht] of [[[3, 4, 5], [4, 2, 0]], [[4, 4, 5], [3, 3, 0]], [[3, 5, 5], [4, 1, 1]], [[4, 4, 4], [2, 2, 2]]]) {
    check(`gewoon ${rij.join('-')}`, S.amerikaantjeHole(rij, {}), verwacht);
  }

  console.log('\n══ LADDERVERSCHUIVING ══');
  const v = S.verschuivingPosities;
  check('2: winnaar +1, verliezer −1', v([1, 2]), [1, -1]);
  check('2: gelijk 0 0',               v([1, 1]), [0, 0]);
  check('3: 1-2-3',                    v([1, 2, 3]), [2, 0, -2]);
  check('3: 1-1-3 (zoals Amerikaantje)', v([1, 1, 3]), [1, 1, -2]);
  check('3: 1-2-2 (zoals Amerikaantje)', v([1, 2, 2]), [2, -1, -1]);
  check('3: 1-1-1',                    v([1, 1, 1]), [0, 0, 0]);
  check('4: 1-2-3-4',                  v([1, 2, 3, 4]), [2, 1, -1, -2]);
  check('4: 1-1-3-4',                  v([1, 1, 3, 4]), [1, 1, -1, -2]);
  check('4: 1-2-2-4',                  v([1, 2, 2, 4]), [2, 0, 0, -2]);
  check('4: volgorde maakt niet uit',  v([3, 1, 4, 2]), [-1, 2, -2, 1]);
  check('ongeldig: 1-1-2',             v([1, 1, 2]), null);
  check('ongeldig: geen eerste',       v([2, 3]), null);
  check('ongeldig: 5 spelers',         v([1, 2, 3, 4, 5]), null);
  check('geen −0',                     Object.is(v([1, 1])[0], -0), false);

  // De serverkopie, uitgeknipt.
  const srv = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  const knip = naam => srv.match(new RegExp('^function ' + naam + '\\([\\s\\S]*?\\n\\}', 'm'))[0];
  const basisRegel = srv.match(/^const BASIS_VERSCHUIVING = .*;$/m)[0];
  const server = new Function(basisRegel + '\n' + knip('geldigePosities') + '\n' + knip('verschuivingPosities')
    + '\nreturn verschuivingPosities;')();
  const proeven = [[1, 2], [1, 1], [1, 2, 3], [1, 1, 3], [1, 2, 2], [1, 1, 1], [1, 2, 3, 4], [1, 1, 3, 4],
    [1, 2, 2, 4], [1, 1, 1, 4], [1, 1, 1, 1], [2, 1, 4, 3], [1, 1, 2], [2, 3], [1, 2, 3, 4, 5]];
  check('server en app geven dezelfde verschuiving',
    proeven.map(p => JSON.stringify(server(p))), proeven.map(p => JSON.stringify(v(p))));
  const srvLijst = JSON.parse(srv.match(/^const NIEUWE_SPELVORMEN = (\[.*\]);$/m)[1].replace(/'/g, '"'));
  check('server kent dezelfde nieuwe spelvormen', srvLijst, [...S.NIEUWE_SPELVORMEN]);
  const store = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
  const storeLijst = JSON.parse(store.match(/const NIEUW = (\[.*\]);/)[1].replace(/'/g, '"'));
  check('store.js (telt mee) kent dezelfde nieuwe spelvormen', storeLijst, [...S.NIEUWE_SPELVORMEN]);

  console.log('\n══ ZICHTBAAR ══');
  check('matchplay altijd',                 S.spelvormZichtbaar({ spelvormenZichtbaar: { matchplay: false } }, 'matchplay'), true);
  check('oude ladder: amerikaantje zichtbaar', S.spelvormZichtbaar({}, 'amerikaantje'), true);
  check('oude ladder: skins niet zichtbaar',   S.spelvormZichtbaar({}, 'skins'), false);
  check('geen config: wolf niet zichtbaar',    S.spelvormZichtbaar(undefined, 'wolf'), false);
  check('aangezet: wolf zichtbaar',            S.spelvormZichtbaar({ spelvormenZichtbaar: { wolf: true } }, 'wolf'), true);
  check('uitgezet: high-low niet zichtbaar',   S.spelvormZichtbaar({ spelvormenZichtbaar: { highlow: false } }, 'highlow'), false);
  check('onbekende spelvorm nooit',            S.spelvormZichtbaar({ spelvormenZichtbaar: { kul: true } }, 'kul'), false);

  console.log('\n══ SKINS ══');
  {
    const r = S.berekenSpelvorm('skins', { n: 3, holes: holes([4, 4, 4, 4]), netto: [
      [4, 5, 5],      // speler 1 wint 1
      [4, 4, 5],      // gelijk: schuift door
      [5, 5, 5],      // gelijk: schuift door
      [5, 3, 6],      // speler 2 wint 3
    ] });
    check('skins per hole', r.perHole.map(h => h && h.tekst), ['1-0-0', '→ 2', '→ 3', '0-3-0']);
    check('skins totalen', r.totalen, [1, 3, 0]);
    check('skins eindstand', r.posities, [2, 1, 3]);
    check('niets blijft liggen', r.info.blijftLiggen, 0);
    const open = S.berekenSpelvorm('skins', { n: 2, holes: holes([4, 4, 4]), netto: [[4, 4], [4, null], [3, 5]] });
    check('na een open hole wordt niets meer beslist', open.perHole.map(h => h && h.tekst), ['→ 2', null, null]);
    const laatste = S.berekenSpelvorm('skins', { n: 2, holes: holes([4, 4]), netto: [[4, 5], [4, 4]] });
    check('laatste hole gelijk: één skin blijft liggen', laatste.info.blijftLiggen, 1);
  }

  console.log('\n══ STABLEFORD ══');
  {
    const r = S.berekenSpelvorm('stableford', { n: 2, holes: holes([4, 3, 5]), netto: [
      [4, 5],   // par 2, bogey 1
      [2, 6],   // birdie 3, triple 0
      [3, 5],   // eagle 4, par 2
    ] });
    check('stableford per hole', r.perHole.map(h => h.punten), [[2, 1], [3, 0], [4, 2]]);
    check('stableford totalen', r.totalen, [9, 3]);
    check('stableford eindstand', r.posities, [1, 2]);
  }

  console.log('\n══ NASSAU ══');
  {
    check('18 holes: 9 + 9', S.nassauHelften(18), { voor: 9, achter: 9 });
    check('9 holes: 5 + 4',  S.nassauHelften(9), { voor: 5, achter: 4 });
    // 4 holes: voor = 1-2, achter = 3-4. A wint hole 1 en 2, B wint 3, 4 gelijk.
    const r = S.berekenSpelvorm('nassau', { n: 2, holes: holes([4, 4, 4, 4]), netto: [[3, 4], [4, 5], [5, 4], [4, 4]] });
    check('nassau per hole', r.perHole.map(h => h.tekst), ['1-0', '1-0', '0-1', '½-½']);
    check('nassau wedstrijden', r.info.wedstrijden.map(w => w.verschil), [2, -1, 1]);
    check('nassau totaal: A wint voor en totaal, B achter', r.totalen, [2, 1]);
    check('nassau eindstand', r.posities, [1, 2]);
    const gelijk = S.berekenSpelvorm('nassau', { n: 2, holes: holes([4, 4]), netto: [[3, 4], [5, 4]] });
    check('nassau alles gelijk geeft 1½-1½', gelijk.totalen, [1.5, 1.5]);
    check('nassau gelijk: gedeelde eerste plek', gelijk.posities, [1, 1]);
  }

  console.log('\n══ SIXES ══');
  {
    check('18 holes: stukken van 6', [0, 5, 6, 11, 12, 17].map(h => S.sixesStuk(h, 18)), [0, 0, 1, 1, 2, 2]);
    check('9 holes: stukken van 3',  [0, 2, 3, 5, 6, 8].map(h => S.sixesStuk(h, 9)), [0, 0, 1, 1, 2, 2]);
    // 3 holes, dus elk stuk één hole.
    const r = S.berekenSpelvorm('sixes', { n: 4, holes: holes([4, 4, 4]), netto: [
      [4, 5, 5, 5],   // stuk 1: 1+2 (4) tegen 3+4 (5): 1 en 2 een punt
      [5, 4, 5, 5],   // stuk 2: 1+3 (5) tegen 2+4 (4): 2 en 4 een punt
      [5, 5, 5, 5],   // stuk 3: gelijk
    ] });
    check('sixes per hole', r.perHole.map(h => h.tekst), ['1-1-0-0', '0-1-0-1', '0-0-0-0']);
    check('sixes totalen', r.totalen, [1, 2, 0, 1]);
    check('sixes eindstand', r.posities, [2, 1, 4, 2]);
  }

  console.log('\n══ WOLF ══');
  {
    check('wolf wisselt per hole', [0, 1, 2, 3, 4, 5].map(S.wolfVan), [0, 1, 2, 3, 0, 1]);
    const r = S.berekenSpelvorm('wolf', { n: 4, holes: holes([4, 4, 4, 4, 4]), netto: [
      [4, 5, 5, 6],   // wolf 1 met 3: beste 4 tegen 5 → 1 en 3 elk 2
      [5, 4, 4, 4],   // wolf 2 alleen: 4 tegen 4 → gelijk
      [5, 4, 3, 4],   // wolf 3 alleen: 3 tegen 4 → wolf 4
      [5, 4, 4, 4],   // wolf 4 met 1: beste 4 tegen 4 → gelijk
      [5, 4, 4, 4],   // wolf 1 met 2: beste 4 tegen 4 → gelijk; geen keuze? zie hieronder
    ], extra: { wolf: [2, 'alleen', 'alleen', 0, null] } });
    check('wolf met partner wint: 2 elk', r.perHole[0].punten, [2, 0, 2, 0]);
    check('wolf alleen gelijk: niemand', r.perHole[1].punten, [0, 0, 0, 0]);
    check('wolf alleen wint: 4', r.perHole[2].punten, [0, 0, 4, 0]);
    check('nog geen keuze: open', r.perHole[4].open, true);
    const verlies = S.berekenSpelvorm('wolf', { n: 4, holes: holes([4, 4]), netto: [[6, 6, 4, 5], [5, 5, 5, 4]],
      extra: { wolf: [1, 'alleen'] } });
    check('wolf met partner verliest: de anderen 3 elk', verlies.perHole[0].punten, [0, 0, 3, 3]);
    const tegen = S.berekenSpelvorm('wolf', { n: 4, holes: holes([4]), netto: [[6, 5, 4, 4]], extra: { wolf: [1] } });
    check('wolf + partner (1+2) verliezen: 3 en 4 krijgen 3', tegen.perHole[0].punten, [0, 0, 3, 3]);
    check('wolf alleen verliest: de anderen 1 elk', verlies.perHole[1].punten, [1, 0, 1, 1]);
    // v5.51.1: "niets gekozen" (null, zoals het na de eerste keuze in de lijst
    // staat) mag NOOIT als speler 1 tellen — op een hole van elke wolf.
    const leeg = S.berekenSpelvorm('wolf', { n: 4, holes: holes([4, 4, 4, 4]),
      netto: [[3, 4, 4, 3], [3, 4, 4, 3], [3, 4, 4, 3], [3, 4, 4, 3]], extra: { wolf: [null, null, null, null] } });
    check('niets gekozen = kies, op de hole van elke wolf', leeg.perHole.map(h => h.tekst), ['kies', 'kies', 'kies', 'kies']);
    check('niets gekozen = geen punten', leeg.totalen, [0, 0, 0, 0]);
    const leegTekst = S.berekenSpelvorm('wolf', { n: 4, holes: holes([4, 4, 4]),
      netto: [[3, 4, 4, 3], [3, 4, 4, 3], [3, 4, 4, 3]], extra: { wolf: ['', undefined, null] } });
    check('lege tekst en undefined ook kies', leegTekst.perHole.map(h => h.tekst), ['kies', 'kies', 'kies']);
    const fout = S.berekenSpelvorm('wolf', { n: 4, holes: holes([4]), netto: [[4, 4, 4, 4]], extra: { wolf: [0] } });
    check('wolf kan zichzelf niet kiezen', fout.perHole[0].open, true);
  }

  console.log('\n══ BINGO BANGO BONGO ══');
  {
    const r = S.berekenSpelvorm('bbb', { n: 3, holes: holes([4, 4, 4]), netto: [[null, null, null], [4, 4, 4], [4, 4, 4]],
      extra: { bingo: [0, 1, null], bango: [0, 2, null], bongo: [2, 2, null] } });
    check('bbb per hole', r.perHole.map(h => h && h.tekst), ['2-0-1', '0-1-2', null]);
    check('bbb telt ook zonder slagen', r.totalen, [2, 1, 3]);
    check('bbb eindstand', r.posities, [2, 3, 1]);
    check('besliste holes', S.besliste(r.perHole), 2);
  }

  console.log('\n══ BONUSSEN BIJ SKINS (v5.52.0) ══');
  {
    // Drie spelers, drie holes: par 4, par 3, par 4.
    const h3 = [{ par: 4, si: 1 }, { par: 3, si: 2 }, { par: 4, si: 3 }];
    const basis = (bonus, extra, bruto) => ({
      n: 3, holes: h3,
      netto: [[4, 5, 5], [3, 3, 4], [4, 4, 4]],      // hole 1: speler 1 wint · hole 2 en 3: doorschuiven
      bruto: bruto || [[4, 4, 5], [3, 2, 4], [3, 4, 5]],
      bonus, extra: { bonus: extra || {} } });
    const zonder = S.berekenSpelvorm('skins', basis(null));
    check('zonder bonussen: gewone skins', zonder.totalen, [1, 0, 0]);
    check('zonder bonussen: geen bonusinfo', zonder.info.bonus, undefined);

    // Sandy: speler 2 par (4 bruto op par 4) telt, speler 3 bogey (5) niet.
    const sandy = S.berekenSpelvorm('skins', basis({ aan: ['sandy'], waarde: 'skin', doorschuiven: true },
      { sandy: [[1, 2], [], []] }));
    check('sandy alleen bij par of beter', sandy.info.bonus.perHole[0], [0, 1, 0]);
    check('sandy als skin telt mee', sandy.totalen, [1, 1, 0]);
    check('gelijk op 1: gedeelde eerste plek', sandy.posities, [1, 1, 3]);

    const punt = S.berekenSpelvorm('skins', basis({ aan: ['sandy'], waarde: 'punt', doorschuiven: true },
      { sandy: [[1], [], []] }));
    check('bonus als punt telt niet mee in de uitslag', punt.totalen, [1, 0, 0]);
    check('maar staat wel in de bonusstand', punt.info.bonus.totalen, [0, 1, 0]);

    // Birdie volgt uit de score (echte slagen): hole 2 par 3, speler 2 bruto 2; hole 3 speler 1 bruto 3.
    const birdie = S.berekenSpelvorm('skins', basis({ aan: ['birdie'], waarde: 'skin', doorschuiven: true }));
    check('birdie uit de score', birdie.info.bonus.totalen, [1, 1, 0]);
    // Doorschuiven nee: hole 2 en 3 schuiven door → hun bonussen vervallen.
    const nee = S.berekenSpelvorm('skins', basis({ aan: ['birdie'], waarde: 'skin', doorschuiven: false }));
    check('doorschuiven nee: bonus vervalt op een doorgeschoven hole', nee.info.bonus.totalen, [0, 0, 0]);
    const neeSandy = S.berekenSpelvorm('skins', basis({ aan: ['sandy'], waarde: 'skin', doorschuiven: false },
      { sandy: [[1], [], []] }));
    check('doorschuiven nee: bonus telt op een gewonnen hole', neeSandy.info.bonus.totalen, [0, 1, 0]);

    // Greenie: alleen par 3, maar één speler, en alleen bij par of beter.
    const green = S.berekenSpelvorm('skins', basis({ aan: ['greenie'], waarde: 'skin', doorschuiven: true },
      { greenie: [[0], [1, 0], []] }));
    check('greenie niet op een par 4', green.info.bonus.perHole[0], null);
    check('greenie: alleen de eerste', green.info.bonus.perHole[1], [0, 1, 0]);
    const greenBogey = S.berekenSpelvorm('skins', basis({ aan: ['greenie'], waarde: 'skin', doorschuiven: true },
      { greenie: [[], [2], []] }));
    check('greenie zonder par telt niet', greenBogey.info.bonus.perHole[1], null);

    // Chippie en polie: geen voorwaarde; meerdere spelers per hole.
    const chip = S.berekenSpelvorm('skins', basis({ aan: ['chippie', 'polie'], waarde: 'skin', doorschuiven: true },
      { chippie: [[2], [], []], polie: [[0, 2], [], []] }));
    check('chippie en polie zonder voorwaarde, samen op één hole', chip.info.bonus.perHole[0], [1, 0, 2]);

    // Een bonus is nooit de pot waard: altijd 1.
    check('een bonus is één waard, ook als er skins liggen', birdie.info.bonus.perHole[2], [1, 0, 0]);
    check('onbekende bonus valt weg', S.bonusInstellingen({ aan: ['kul', 'sandy'] }).aan, ['sandy']);
    check('standaard: skin en doorschuiven ja', S.bonusInstellingen({}), { aan: [], waarde: 'skin', doorschuiven: true });
  }

  console.log('\n══ EINDSTAND ══');
  check('rangschik met gedeelde plek', S.rangschik([5, 7, 5, 1]), [2, 1, 2, 4]);
  check('geldig 1-1-3',  S.geldigePosities([1, 1, 3], 3), true);
  check('ongeldig 1-2-2-2 bij 3', S.geldigePosities([1, 2, 2, 2], 3), false);
  check('onbekende spelvorm: null', S.berekenSpelvorm('kul', { n: 2, holes: [], netto: [] }), null);

  return staat;
})();
