// ============================================================
//  Gastlogins — automatische tests (v5.11.7)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  Een gast van buiten de club tikt zijn naam in plus het toernooiwachtwoord.
//  De app maakt daar `<naam>.<toernooicode>` van. Dat gebeurt op TWEE plekken:
//  js/toernooi.js maakt het account aan, js/auth.js herkent de invoer. Lopen
//  die uit de pas, dan bestaat het account wel maar komt de gast er niet in —
//  en dat merk je pas op de eerste tee.
//
//  Dat is precies wat er gebeurde. Een gast met ALLEEN een voornaam kon worden
//  toegevoegd en kreeg een account, maar het inlogscherm eiste twee woorden en
//  weigerde hem. En twee gasten met dezelfde naam kregen `karel.<code>2` — met
//  het cijfer achter de code, dus onvindbaar voor wie het intikt.
// ============================================================
const { laadGastloginKern, maakChecker } = require('./harnas.cjs');
const G = laadGastloginKern();
const { staat, check } = maakChecker();

const CODE = G.toernooiCodeVan('Gastentoernooi');

// De kern van de zaak: wat de app aanmaakt moet zijn wat de app herkent.
const komtUit = (ingetikt, aangemaaktVoor) =>
  `${G.gastKernVan(ingetikt)}.${CODE}` === G.gastLoginVan(aangemaaktVoor, CODE);

console.log('══ WAT DE GAST INTIKT VINDT ZIJN EIGEN ACCOUNT ══\n');

check('voor- en achternaam',            komtUit('Karel Gast', 'Karel Gast'), true);
check('met een punt ertussen',          komtUit('Karel.Gast', 'Karel Gast'), true);
check('hoofdletters maken niet uit',    komtUit('karel gast', 'Karel Gast'), true);
check('extra spaties ook niet',         komtUit('  Karel   Gast ', 'Karel Gast'), true);
check('ALLEEN een voornaam',            komtUit('Karel', 'Karel'), true);
check('alleen een voornaam met punt',   komtUit('.Karel.', 'Karel'), true);
check('een tussenvoegsel telt gewoon mee',
  komtUit('Jan de Vries', 'Jan de Vries'), true);

check('een andere naam vindt het account NIET',
  komtUit('Karel Gast', 'Karel Ander'), false);
check('niets ingetikt levert geen kern op', G.gastKernVan('   '), '');

console.log('\n══ DE INLOGNAAM ZELF ══\n');

check('voor- en achternaam',   G.gastLoginVan('Karel Gast', CODE), 'karel.gast.gastentoernooi');
check('alleen een voornaam',   G.gastLoginVan('Karel', CODE),      'karel.gastentoernooi');
check('de code staat altijd achteraan',
  G.gastLoginVan('Karel Gast', CODE).endsWith('.' + CODE), true);

// ⚠ Twee keer dezelfde naam: het cijfer hoort IN de naam, niet achter de code.
// Anders kan die tweede gast zijn eigen inlog niet intikken.
console.log('\n══ TWEE GASTEN MET DEZELFDE NAAM ══\n');

const tweede = G.gastLoginVan('Karel2', CODE);
check('de tweede krijgt een cijfer in de naam', tweede, 'karel2.gastentoernooi');
check('en de code staat nog steeds achteraan', tweede.endsWith('.' + CODE), true);
check('en hij kan zijn eigen inlog intikken', komtUit('karel2', 'Karel2'), true);
check('het cijfer staat NIET achter de code', /gastentoernooi\d/.test(tweede), false);

const tweedeVol = G.gastLoginVan('Karel Gast2', CODE);
check('ook met een achternaam', tweedeVol, 'karel.gast2.gastentoernooi');
check('en ook die is in te tikken', komtUit('karel.gast2', 'Karel Gast2'), true);

// ============================================================
//  v5.12.3 — DE INLOGNAAM WORDT OPGEZOCHT, NIET UITGEREKEND
// ------------------------------------------------------------
//  Sierk, 13 september 2026: "en waarom maakt de app van sierk loginnaam
//  sierk2? er was maar 1 speler in het toernooi die zo heet."
//
//  Omdat er nog een account van een eerdere ronde stond. Het toernooi bewaart
//  de ECHTE inlognaam bij de speler; tot v5.12.2 rekende het inlogscherm hem
//  zelf uit en kwam daarmee op het oude account uit — met het goede wachtwoord
//  erbij kwam de speler dus binnen in een toernooi dat niet meer liep.
// ============================================================
console.log('\n══ DE INLOGNAAM WORDT OPGEZOCHT ══\n');

const toernooiMetHarry2 = {
  gastCode: 'clubkampioenscha',
  spelers: [
    { uid: 'u1', naam: 'Anna Speler' },                                  // clublid, geen login
    { uid: 'u2', naam: 'Harry', gast: true, login: 'harry2.clubkampioenscha' },
  ],
};

check('"Harry" vindt zijn ECHTE inlog, met cijfer en al',
  G.gastLoginUitToernooi(toernooiMetHarry2, 'Harry'), 'harry2.clubkampioenscha');
check('en niet de uitgerekende naam zonder cijfer',
  G.gastLoginUitToernooi(toernooiMetHarry2, 'Harry') === 'harry.clubkampioenscha', false);
check('hij mag ook intikken wat op zijn briefje staat',
  G.gastLoginUitToernooi(toernooiMetHarry2, 'harry2'), 'harry2.clubkampioenscha');
check('hoofdletters en punten maken niet uit',
  G.gastLoginUitToernooi(toernooiMetHarry2, 'HARRY'), 'harry2.clubkampioenscha');
check('iemand die niet meedoet vindt niets',
  G.gastLoginUitToernooi(toernooiMetHarry2, 'Piet'), null);
check('een clublid zonder eigen gastinlog ook niet',
  G.gastLoginUitToernooi(toernooiMetHarry2, 'Anna Speler'), null);
check('een leeg toernooi valt niet om',
  G.gastLoginUitToernooi({}, 'Harry'), null);

// De gewone gang van zaken: wat gastLoginVan schrijft, moet hier terugkomen.
const gewoon = {
  gastCode: 'zomercup',
  spelers: ['Karel Gast', 'Bep'].map((naam, i) => ({
    uid: 'g' + i, naam, gast: true, login: G.gastLoginVan(naam, 'zomercup'),
  })),
};
check('wat de ene kant schrijft, vindt de andere kant terug',
  ['Karel Gast', 'Karel.Gast', 'Bep'].map(n => G.gastLoginUitToernooi(gewoon, n)),
  ['karel.gast.zomercup', 'karel.gast.zomercup', 'bep.zomercup']);

// ── De gastcode moet uniek zijn ──────────────────────────────
//  De code wordt afgekapt op 16 letters, dus twee toernooien die pas daarna
//  verschillen kwamen op dezelfde code uit — en deelden daarmee hun inlognamen.
console.log('\n══ DE GASTCODE IS UNIEK ══\n');

check('twee lange namen kwamen op dezelfde code uit',
  [G.toernooiCodeVan('Clubkampioenschap heren'), G.toernooiCodeVan('Clubkampioenschap dames')],
  ['clubkampioenscha', 'clubkampioenscha']);
check('een vrije code blijft gewoon zoals hij was',
  G.uniekeGastCode('Zomercup', ['herfstcup']), 'zomercup');
check('een bezette code krijgt een cijfer',
  G.uniekeGastCode('Clubkampioenschap dames', ['clubkampioenscha']), 'clubkampioensch2');
check('en blijft doortellen',
  G.uniekeGastCode('Clubkampioenschap junioren',
    ['clubkampioenscha', 'clubkampioensch2']), 'clubkampioensch3');
check('nooit langer dan 16 tekens',
  G.uniekeGastCode('Clubkampioenschap dames', ['clubkampioenscha']).length <= 16, true);
check('een lege lijst is geen probleem', G.uniekeGastCode('Zomercup', []), 'zomercup');
check('een naamloos toernooi houdt zijn terugval',
  G.uniekeGastCode('', []), 'toernooi');

// ── Het briefje voor de spelers ──────────────────────────────
console.log('\n══ HET BRIEFJE ══\n');

const briefje = G.gastloginTekst({
  adres: 'https://sierkr.github.io/goyer-ladder/',
  wachtwoord: 'goyer2026',
  regels: [{ naam: 'Harry Jansen', inlog: 'harry' }, { naam: 'Karel Gast', inlog: 'karel.gast' }],
});

check('het wachtwoord staat er precies ÉÉN keer in',
  (briefje.match(/goyer2026/g) || []).length, 1);
check('en niet meer achter elke naam',
  briefje.includes('wachtwoord: goyer2026'), false);
check('beide spelers staan erop',
  ['Harry Jansen', 'Karel Gast'].every(n => briefje.includes(n)), true);
check('met hun inlognaam',
  ['inlog: harry', 'inlog: karel.gast'].every(t => briefje.includes(t)), true);
check('de tip spreekt over de SPELER, niet over de gast',
  briefje.includes('de speler tikt'), true);
check('het woord "gast" staat niet meer in de tip',
  briefje.includes('de gast tikt'), false);
check('een lijst zonder spelers valt niet om',
  typeof G.gastloginTekst({ adres: 'x', wachtwoord: 'y', regels: [] }), 'string');

module.exports = staat;
