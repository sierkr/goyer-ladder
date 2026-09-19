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
// v5.17.0: de tip onderaan is weg. Hij zei "tik je voor- en achternaam in" en
// dat is onwaar voor een gast met alleen een voornaam — die logt in met `karel`.
// Deze twee controles bewaken dat hij niet terugkomt.
check('er staat geen tip meer onder de lijst',
  /voor- en achternaam/.test(briefje), false);
check('en het briefje eindigt met de laatste speler',
  briefje.trim().endsWith('inlog: karel.gast'), true);
check('een lijst zonder spelers valt niet om',
  typeof G.gastloginTekst({ adres: 'x', wachtwoord: 'y', regels: [] }), 'string');

// ── v5.18.0: een geplakte gastenlijst uitlezen ───────────────
//  De vervanger van de bulk-import. Wat Sierk plakt komt uit Excel, en Excel
//  levert per land en per kolomindeling iets anders op. Alles wat hij redelijk
//  kan tegenkomen staat hier vast.
console.log('\n══ EEN GEPLAKTE GASTENLIJST ══\n');

const namen = (t, bestaand) => G.gastenUitTekst(t, bestaand).spelers;

check('twee kolommen met een tab',
  namen('Karel Jansen\t12'), [{ naam: 'Karel Jansen', hcp: 12 }]);
check('drie kolommen (voornaam, achternaam, hcp)',
  namen('Karel;Jansen;12'), [{ naam: 'Karel Jansen', hcp: 12 }]);
check('komma als scheidingsteken',
  namen('Karel Jansen,12'), [{ naam: 'Karel Jansen', hcp: 12 }]);
check('gewoon een regel met de handicap erachter',
  namen('Karel Jansen 12'), [{ naam: 'Karel Jansen', hcp: 12 }]);
// ⚠ Dit ging de eerste keer mis: de komma was óók een scheidingsteken, dus
// "8,4" werd twee velden en de naam werd "Anna de Wit 8".
check('een Nederlandse komma in de handicap',
  namen('Anna de Wit\t8,4'), [{ naam: 'Anna de Wit', hcp: 8.4 }]);
check('en dezelfde regel met een komma als scheiding',
  namen('Anna de Wit,8,4'), [{ naam: 'Anna de Wit', hcp: 8.4 }]);
check('een plusnul-handicap',
  namen('Bram Best\t+2'), [{ naam: 'Bram Best', hcp: 2 }]);
check('een negatieve handicap blijft negatief',
  namen('Bram Best\t-2'), [{ naam: 'Bram Best', hcp: -2 }]);

// ⚠ Dit is waar v5.17.0 over ging: alleen een voornaam is geldig.
check('alleen een voornaam mag',
  namen('Karel'), [{ naam: 'Karel', hcp: 0 }]);
check('alleen een voornaam met handicap',
  namen('Karel 18'), [{ naam: 'Karel', hcp: 18 }]);
check('geen handicap wordt 0',
  namen('Karel Jansen'), [{ naam: 'Karel Jansen', hcp: 0 }]);

check('lege regels en losse spaties tellen niet mee',
  namen('Karel\n\n   \nAnna\n'), [{ naam: 'Karel', hcp: 0 }, { naam: 'Anna', hcp: 0 }]);
check('dubbele spaties in een naam worden er één',
  namen('Jan   de   Vries\t9'), [{ naam: 'Jan de Vries', hcp: 9 }]);

check('een naam die al meedoet wordt overgeslagen',
  namen('Karel Jansen\t12\nAnna de Wit\t8', ['karel jansen']),
  [{ naam: 'Anna de Wit', hcp: 8 }]);
check('en dezelfde naam twee keer in je eigen lijst ook',
  namen('Karel\nkarel'), [{ naam: 'Karel', hcp: 0 }]);
check('de overgeslagen namen worden teruggemeld',
  G.gastenUitTekst('Karel\nKarel').dubbel, ['Karel']);

check('lege invoer valt niet om',
  G.gastenUitTekst(''), { spelers: [], dubbel: [], leeg: 1 });
check('niets doorgeven valt ook niet om',
  G.gastenUitTekst(null).spelers, []);

// ============================================================
//  v5.38.0 — DE PINCODE VAN HET TOERNOOI
// ------------------------------------------------------------
//  Sierk wilde inloggen met een naam uit een lijst en vier cijfers. Twee
//  dingen zijn hier na te meten, en ze zijn allebei eerder misgegaan in dit
//  soort koppelingen:
//
//   1. Het briefje dat de wedstrijdleiding uitdeelt moet over de PINCODE gaan,
//      niet meer over inlognamen — die staan nu in een lijst op het scherm.
//   2. De app en de server moeten dezelfde afdruk van de pincode uitrekenen.
//      Lopen ze uit de pas, dan komt niemand binnen en zegt het scherm alleen
//      "die pincode klopt niet". Dat is een fout die je uren zoekt.
// ============================================================
console.log('\n══ HET BRIEFJE MET DE PINCODE ══\n');

const briefjeMetPin = G.gastloginTekst({
  adres: 'https://sierkr.github.io/goyer-ladder/',
  wachtwoord: 'x7q2m9vb4t',
  pincode: '1234',
  regels: [{ naam: 'Karel Jansen', inlog: 'karel.jansen' }],
});
check('het briefje noemt de pincode',
  briefjeMetPin.includes('pincode: 1234'), true);
check('en verwijst naar de lijst met namen',
  /kies je naam uit de lijst/i.test(briefjeMetPin), true);
// Het accountwachtwoord is sinds v5.38.0 willekeurig en hoeft niemand te
// kennen. Staat het toch op het briefje, dan deelt de wedstrijdleiding een
// geheim uit dat ze niet hoeft te delen.
check('het willekeurige accountwachtwoord staat er NIET op',
  briefjeMetPin.includes('x7q2m9vb4t'), false);
check('en de inlognamen ook niet meer',
  briefjeMetPin.includes('karel.jansen'), false);

// Zonder pincode — een toernooi van vóór v5.38.0 — blijft het briefje precies
// zoals het was. Daar draaien toernooien op.
const briefjeOud = G.gastloginTekst({
  adres: 'https://sierkr.github.io/goyer-ladder/',
  wachtwoord: 'geheim123',
  regels: [{ naam: 'Karel Jansen', inlog: 'karel.jansen' }],
});
check('een ouder toernooi houdt het oude briefje',
  briefjeOud.includes('Wachtwoord: geheim123') && briefjeOud.includes('karel.jansen'), true);

console.log('\n══ APP EN SERVER REKENEN DEZELFDE AFDRUK UIT ══\n');

// Zo doet de server het, letterlijk zoals in functions/index.js:
const crypto = require('crypto');
const serverHash = (pin) =>
  crypto.createHash('sha256').update(String(pin), 'utf8').digest('hex');

// De app rekent met crypto.subtle. Dit is de ECHTE functie uit js/toernooi.js.
// crypto.subtle is per se asynchroon, dus deze suite geeft een BELOFTE terug.
// run.cjs wacht daarop; zonder dat werden deze proeven maar half meegeteld.
module.exports = (async () => {
  for (const pin of ['1234', '0000', '9999', '0042']) {
    check(`pincode ${pin}: app en server komen op dezelfde afdruk uit`,
      await G.hashPinTekst(pin), serverHash(pin));
  }
  check('een andere pincode geeft een andere afdruk',
    (await G.hashPinTekst('1234')) === (await G.hashPinTekst('1235')), false);
  check('de afdruk is 64 tekens hex',
    /^[0-9a-f]{64}$/.test(await G.hashPinTekst('1234')), true);
  return staat;
})();
