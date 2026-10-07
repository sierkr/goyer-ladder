// ============================================================
//  Bekijk als gewone speler — automatische tests  (v5.47.0)
// ============================================================
//  Sierk, 6 oktober 2026: "ik wil als beheerder een knop zoals bij matchcheck
//  zodat ik kan zien wat een gewone speler ziet en kan."
//
//  De beslissing staat in één pure functie in js/auth.js (kijktAlsSpeler);
//  die wordt hier uit de ECHTE code geknipt, net als het bewaren van de stand.
//  Daarnaast legt deze suite vast dat de app ze ook echt gebruikt op de
//  plekken waar het om gaat — een losse functie die nergens wordt aangeroepen
//  bewijst niets. Het scherm zelf toetst de browserproef
//  'BEHEER: bekijk als gewone speler, en weer terug'.
// ============================================================
const fs = require('fs');
const path = require('path');
const { maakChecker } = require('./harnas.cjs');
const { staat, check } = maakChecker();

const lees = (bestand) => fs.readFileSync(path.join(__dirname, '..', bestand), 'utf8');
const authBron  = lees('js/auth.js');
const adminBron = lees('js/admin.js');
const appBron   = lees('js/app.js');
const html      = lees('index.html');

const functieUit = (bron, naam) => {
  const m = bron.match(new RegExp('^(?:async )?function ' + naam + '\\([\\s\\S]*?\\n\\}', 'm'));
  if (!m) throw new Error(`Functie '${naam}' niet gevonden — is hij hernoemd of verwijderd?`);
  return m[0];
};

console.log('\n══ WIE KIJKT ER ALS GEWONE SPELER ══');

const kijkt = new Function(functieUit(authBron, 'kijktAlsSpeler') + 'return kijktAlsSpeler;')();
check('beheerder met de stand aan → als speler',   kijkt('beheerder', 'uidA', 'uidA'), true);
check('beheerder zonder stand → beheerder',        kijkt('beheerder', null, 'uidA'), false);
//  Twee mensen op één toestel: de stand van de één geldt niet voor de ander.
check('stand van een ánder account → beheerder',   kijkt('beheerder', 'uidB', 'uidA'), false);
//  Alleen de beheerder heeft de knop. Een stand die er tóch staat (met de
//  hand gezet, of van een beheerder die intussen coordinator is) doet niets.
check('coordinator met de stand → blijft coordinator', kijkt('coordinator', 'uidA', 'uidA'), false);
check('speler met de stand → blijft speler',       kijkt('speler', 'uidA', 'uidA'), false);
check('geen rol → nee',                            kijkt(undefined, 'uidA', 'uidA'), false);
check('geen account → nee',                        kijkt('beheerder', '', ''), false);
check('niets bekend → nee',                        kijkt('beheerder', undefined, undefined), false);

console.log('\n══ DE STAND BEWAREN ══');

// Het echte bewaren en teruglezen, met een nagemaakte sessionStorage.
const sleutelRegel = (authBron.match(/^const KIJK_SLEUTEL = '[^']+';/m) || [])[0];
check('de sleutel staat op één plek in js/auth.js', !!sleutelRegel, true);
const maakOpslag = (kapot) => {
  const data = {};
  return {
    data,
    getItem:    (k) => { if (kapot) throw new Error('privémodus'); return k in data ? data[k] : null; },
    setItem:    (k, v) => { if (kapot) throw new Error('privémodus'); data[k] = String(v); },
    removeItem: (k) => { if (kapot) throw new Error('privémodus'); delete data[k]; },
  };
};
const laadBewaren = (opslag, bruiker) => new Function('sessionStorage', 'huidigeBruiker',
  sleutelRegel + '\n' +
  functieUit(authBron, 'leesKijkVlag') + '\n' +
  functieUit(authBron, 'zetKijkAlsSpeler') + '\n' +
  'return { leesKijkVlag, zetKijkAlsSpeler };')(opslag, bruiker);

{
  const opslag = maakOpslag(false);
  const k = laadBewaren(opslag, { uid: 'uidA' });
  check('aanzetten lukt',                     k.zetKijkAlsSpeler(true), true);
  check('de stand hoort bij dit account',     k.leesKijkVlag(), 'uidA');
  check('uitzetten lukt',                     k.zetKijkAlsSpeler(false), true);
  check('daarna is er geen stand meer',       k.leesKijkVlag(), null);
  check('uitzetten zonder stand mag ook',     k.zetKijkAlsSpeler(false), true);
}
{
  // Zonder ingelogd account valt er niets aan te zetten: herladen zou je
  // gewoon als beheerder terugbrengen, dus dan liever een melding.
  const opslag = maakOpslag(false);
  const k = laadBewaren(opslag, null);
  check('aanzetten zonder account → nee',     k.zetKijkAlsSpeler(true), false);
  check('en er wordt niets bewaard',          Object.keys(opslag.data).length, 0);
}
{
  // Privémodus: de browser weigert te bewaren. Dan niet herladen (de knop
  // meldt het), en bij het opstarten gewoon beheerder.
  const k = laadBewaren(maakOpslag(true), { uid: 'uidA' });
  check('privémodus: aanzetten → nee',        k.zetKijkAlsSpeler(true), false);
  check('privémodus: uitzetten → nee',        k.zetKijkAlsSpeler(false), false);
  check('privémodus: geen stand → beheerder', k.leesKijkVlag(), null);
}

console.log('\n══ DE APP GEBRUIKT HET OOK ══');

const profiel = functieUit(authBron, 'setIngelogdVanafProfiel');
check('het inloggen vraagt het na',
  /kijktAlsSpeler\(profiel\.rol, leesKijkVlag\(\), firebaseUser\.uid\)/.test(profiel), true);
check('als speler wordt de rol "speler"',
  /rol: +alsSpeler \? 'speler' : \(profiel\.rol \|\| 'speler'\)/.test(profiel), true);
check('als speler geen ruwe punten',
  /puntenBeheerder: !alsSpeler && profiel\.puntenBeheerder === true/.test(profiel), true);

//  ⚠ Dit is waarom één plek genoeg is: de rest van de app leest de rol via
//  deze twee. Gaat een van beide ooit ergens anders kijken, dan ziet de
//  beheerder als "speler" tóch beheerknoppen — en dan valt dit om.
check('isCoordinatorRol leest de rol van de ingelogde',
  /huidigeBruiker\?\.rol === 'coordinator' \|\| huidigeBruiker\?\.rol === 'beheerder'/
    .test(functieUit(authBron, 'isCoordinatorRol')), true);
check('isBeheerderRol leest de rol van de ingelogde',
  /huidigeBruiker\?\.rol === 'beheerder'/.test(functieUit(authBron, 'isBeheerderRol')), true);

check('de gele balk volgt de stand bij het inloggen',
  /toonKijkBalk\(huidigeBruiker\.kijktAlsSpeler === true\)/.test(functieUit(authBron, 'vervolgIngelogd')), true);
check('uitloggen zet het uit',
  /zetKijkAlsSpeler\(false\)/.test(functieUit(authBron, 'uitloggen')), true);
//  Ook een inlog die verloren gaat zonder op uitloggen te drukken: opnieuw
//  inloggen is altijd weer beheerder.
//  (De meeluisteraar op de inlog staat in initFirestore.)
const opstart = functieUit(authBron, 'initFirestore');
const nietIngelogd = opstart.slice(opstart.indexOf('startStandenWachthond();'));
check('een verloren inlog zet het ook uit',
  /\} else \{[\s\S]*?zetKijkAlsSpeler\(false\)[\s\S]*?store\.huidigeBruiker = null;/.test(nietIngelogd), true);

check('de knop staat op window (js/app.js)',
  /^window\.kijkAlsSpeler = function kijkAlsSpeler\(aan\)/m.test(appBron), true);
check('omschakelen bewaart een half partijformulier (via "Nu updaten")',
  /window\.kijkAlsSpeler = [\s\S]*?window\.updateNuEnHerlaad\(\);/.test(appBron), true);

console.log('\n══ HET SCHERM ══');

check('het blok in Beheer bestaat en begint verborgen',
  /<div class="card" id="admin-sectie-kijkalsspeler" style="display:none">/.test(html), true);
check('het blok staat bovenaan Beheer',
  /<div id="page-admin" class="page">\s*<!--[\s\S]*?-->\s*<div class="card" id="admin-sectie-kijkalsspeler"/.test(html), true);
check('de knop in Beheer zet het aan', /onclick="kijkAlsSpeler\(true\)"/.test(html), true);
check('de gele balk begint verborgen', /<div id="kijk-balk" style="display:none">/.test(html), true);
check('de balk heeft "Terug naar beheerder"',
  /onclick="kijkAlsSpeler\(false\)">Terug naar beheerder</.test(html), true);
//  Alleen de beheerder ziet het blok — een coordinator niet.
const beheerderLijst = (functieUit(adminBron, 'renderAdmin').match(/\[([^\]]*)\]\.forEach/) || [])[1] || '';
check('het blok hoort bij de blokken die alleen de beheerder ziet',
  beheerderLijst.includes("'admin-sectie-kijkalsspeler'"), true);

module.exports = staat;
