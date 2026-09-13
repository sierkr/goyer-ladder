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

module.exports = staat;
