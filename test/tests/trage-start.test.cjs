// ============================================================
//  Trage start — automatische tests  (v5.48.0)
// ============================================================
//  Sierk, 7 oktober 2026, met een schermafdruk: bij een trage verbinding zie
//  je "alleen maar de vier tabs en een leeg scherm (…) Graag bericht op scherm
//  en/of zelf een progressie balk?" — en daarna "Nog geen spelers." Na een
//  update duurde het "zeker een halve minuut".
//
//  Nagemeten op een afgeknepen lijn: het logo ging weg vóór het eigen profiel
//  binnen was (2,4 s leeg scherm), en met een gewiste kopie op het toestel
//  stond er 4,6 s een ladder met één naam.
//
//  De pure stukken worden uit de ECHTE code geknipt; daarnaast legt deze suite
//  vast dat de app ze gebruikt waar het om gaat. Het scherm zelf toetst de
//  browserproef 'TRAGE START: …' in tests/e2e/app.spec.cjs.
// ============================================================
const fs = require('fs');
const path = require('path');
const { maakChecker } = require('./harnas.cjs');
const { staat, check } = maakChecker();

const lees = (bestand) => fs.readFileSync(path.join(__dirname, '..', bestand), 'utf8');
const authBron   = lees('js/auth.js');
const viewBron   = lees('js/ladder-view.js');
const ladderBron = lees('js/ladder.js');
const appBron    = lees('js/app.js');
const adminBron  = lees('js/admin.js');
const html       = lees('index.html');

const functieUit = (bron, naam) => {
  const m = bron.match(new RegExp('^(?:export )?(?:async )?function ' + naam + '\\([\\s\\S]*?\\n\\}', 'm'));
  if (!m) throw new Error(`Functie '${naam}' niet gevonden — is hij hernoemd of verwijderd?`);
  return m[0].replace(/^export /, '');
};
const constUit = (bron, naam) => {
  const m = bron.match(new RegExp('^const ' + naam + ' = [\\s\\S]*?;\\s*$', 'm'));
  if (!m) throw new Error(`Constante '${naam}' niet gevonden.`);
  return m[0];
};

console.log('\n══ ZIJN DE NAMEN AL BINNEN ══');

const compleet = new Function(functieUit(viewBron, 'namenCompleet') + 'return namenCompleet;')();
const A = 'uid_anna_00000000', B = 'uid_bram_00000000', C = 'uid_coen_00000000';
const naam = (uid) => ({ uid, naam: uid });
check('ladder zonder leden → klaar',                compleet([], [], false), true);
check('alle namen op het toestel → klaar',          compleet([A, B, C], [naam(A), naam(B), naam(C)], false), true);
//  ⚠ Dit is de gemeten fout: alleen het eigen profiel stond in de kopie.
check('alleen de eigen naam op het toestel → NIET klaar', compleet([A, B, C], [naam(C)], false), false);
check('nog helemaal geen namen → niet klaar',       compleet([A, B], [], false), false);
check('namenlijst nog niet gevuld (null) → niet klaar', compleet([A, B], null, false), false);
//  Heeft de server geantwoord, dan ontbreekt een naam echt (een verwijderd
//  profiel). Dan tekenen — anders bleef zo'n ladder eeuwig "opgehaald" worden.
check('server heeft geantwoord, naam ontbreekt echt → klaar', compleet([A, B], [naam(A)], true), true);
check('korte (oude) ids tellen niet mee',           compleet(['oud', A], [naam(A)], false), true);
check('geen ledenlijst (undefined) → klaar',        compleet(undefined, [], false), true);

console.log('\n══ HET LOGO-SCHERM ══');

const stap = new Function(constUit(authBron, 'LAAD_STAPPEN') + '\n' +
  functieUit(authBron, 'laadStapTekst') + 'return laadStapTekst;')();
check('stap 1', stap(1), 'Stap 1 van 3 — App laden…');
check('stap 2', stap(2), 'Stap 2 van 3 — Verbinden met de database…');
check('stap 3', stap(3), 'Stap 3 van 3 — Jouw gegevens ophalen…');
check('onzin wordt stap 1', stap(undefined), 'Stap 1 van 3 — App laden…');
check('te hoog wordt stap 3', stap(9), 'Stap 3 van 3 — Jouw gegevens ophalen…');
//  Stap 1 staat vast in index.html (de code draait dan nog niet). Die tekst
//  moet dezelfde zijn als wat de code zou zetten — één tekst, geen twee.
check('stap 1 in index.html = stap 1 uit de code',
  html.includes(`<div id="laad-stap" class="laad-stap">${stap(1)}</div>`), true);
check('de balk begint op een derde', /<div id="laad-balk-vulling" style="width:33%"><\/div>/.test(html), true);
check('na 5 seconden de uitleg — met opmaak, zonder code',
  /\.laad-traag \{[\s\S]*?animation: laad-traag-in 0\.3s ease 5s forwards;/.test(html), true);
check('de uitleg noemt de update',
  /<div class="laad-traag">Dit duurt langer dan normaal\. Vlak na een update is dat gewoon/.test(html), true);
check('de oude vaste tekst is weg', html.includes('Verbinden met database…</div>'), false);
check('het ladderscherm is nooit leeg: er staat een kaart tot de ladder er is',
  /<div id="ladder-kaarten"><div class="card"><div class="empty"><div class="empty-icon">⏳<\/div><p>Je gegevens worden opgehaald…<\/p>/.test(html), true);

console.log('\n══ HET LOGO WACHT OP JE GEGEVENS ══');

const opstart = functieUit(authBron, 'initFirestore');
check('stap 2 zodra de code draait', /toonLaadOverlay\(true\);\s*\n\s*\/\/[^\n]*\n\s*zetLaadStap\(2\);/.test(opstart), true);
//  ⚠ De kern van deze versie. Tot v5.47.0 stond hier een onvoorwaardelijke
//  toonLaadOverlay(false) vóór setIngelogd.
const meeluisteraar = opstart.slice(opstart.indexOf('onAuthStateChanged(auth, async (user) => {'));
const voorProfiel = meeluisteraar.slice(0, meeluisteraar.indexOf('await setIngelogd(user)'));
check('vóór het profiel gaat het logo alleen weg zonder (nieuwe) gebruiker',
  /if \(!_rondeQrBezig && !nieuweGebruiker\) toonLaadOverlay\(false\);/.test(voorProfiel) &&
  !/^\s*if \(!_rondeQrBezig\) toonLaadOverlay\(false\);/m.test(voorProfiel), true);
check('stap 3 vlak voor het ophalen van het profiel', /zetLaadStap\(3\);[\s\S]{0,120}await setIngelogd\(user\)/.test(meeluisteraar), true);
check('na het profiel gaat het logo weg — ook als er iets misgaat',
  /await setIngelogd\(user\);\s*\n\s*\} finally \{[\s\S]*?if \(!_rondeQrBezig\) toonLaadOverlay\(false\);/.test(meeluisteraar), true);
check('het vangnet van 10 seconden is er nog',
  /setTimeout\(\(\) => \{ if \(!_rondeQrBezig\) toonLaadOverlay\(false\); \}, 10000\);/.test(opstart), true);

console.log('\n══ DE LADDER WACHT OP ALLE NAMEN ══');

check('de namenlijst meldt ook een andere herkomst',
  /collection\(db, 'spelers'\),[\s\S]{0,700}?\{ includeMetadataChanges: true \},/.test(opstart), true);
check('een antwoord van de server wordt onthouden',
  /if \(!snap\.metadata\.fromCache\) store\._namenVanServer = true;/.test(opstart), true);
check('de ladder kijkt naar standen ÉN namen',
  /const standenKlaar = ladderStandenGeladen\(l\.id\) && ladderNamenCompleet\(l\.id\);/.test(functieUit(ladderBron, 'renderLadder')), true);
check('ladderNamenCompleet gebruikt de pure regel',
  /return namenCompleet\(ladder\?\.data\?\.spelerIds \|\| ladder\?\.spelerIds,\s*_usersCache, store\._namenVanServer === true\);/
    .test(functieUit(viewBron, 'ladderNamenCompleet')), true);

console.log('\n══ DE MEETREGEL ══');

const ops = new Function(
  functieUit(authBron, 'opstartSeconden') + functieUit(authBron, 'opstartTekst') +
  'return { opstartSeconden, opstartTekst };')();
//  Een spoor van vóór v5.48.0 geeft precies het oude regeltje.
check('oud spoor: ongewijzigd', ops.opstartTekst({ bestanden: 900, database: 3100, totaal: 4200 }),
  '4,2 s tot beeld (bestanden 0,9 s, database 3,1 s)');
check('nieuw spoor: met gegevens en ladder',
  ops.opstartTekst({ bestanden: 900, database: 3100, profiel: 400, totaal: 4600, ladder: 6000 }),
  '4,6 s tot beeld (bestanden 0,9 s, database 3,1 s, gegevens 0,4 s); ladder met namen na 6,0 s');
check('na een update staat dat erbij',
  ops.opstartTekst({ bestanden: 12000, database: 9000, profiel: 8000, totaal: 31000, ladder: 36000, naUpdate: true }),
  '31 s tot beeld (bestanden 12 s, database 9,0 s, gegevens 8,0 s); ladder met namen na 36 s — eerste start na een update');
check('nog niet klaar met de ladder: dan staat die er niet', ops.opstartTekst({ bestanden: 900, database: 3100, profiel: 400, totaal: 4600, ladder: null }),
  '4,6 s tot beeld (bestanden 0,9 s, database 3,1 s, gegevens 0,4 s)');

// Het echte bewaren, met een nagemaakte opslag en klok.
const laadMeting = (klok, opslag) => new Function('localStorage', 'performance',
  constUit(authBron, 'OPSTART_SLEUTEL') + '\n' +
  constUit(authBron, 'OPSTART_UPDATE_SLEUTEL') + '\n' +
  constUit(authBron, '_opstart') + '\n' +
  'const _opstartTs = 1000;\n' +
  functieUit(authBron, 'bewaarOpstart') + functieUit(authBron, 'markeerOpstartLadder') +
  functieUit(authBron, 'markeerOpstartNaUpdate') + functieUit(authBron, 'leesOpstartSpoor') +
  'return { _opstart, markeerOpstartLadder, markeerOpstartNaUpdate, leesOpstartSpoor };')(
    opslag, { now: () => klok.t });
const maakOpslag = () => { const d = {}; return { d, getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };
{
  // Inloggen via het inlogscherm: geen profieltijd, dus ook geen laddertijd —
  // anders zou het typen als wachttijd meetellen.
  const klok = { t: 5000 }, o = maakOpslag(), m = laadMeting(klok, o);
  m._opstart.bestanden = 800;
  m.markeerOpstartLadder();
  check('handmatig inloggen: geen laddertijd', m._opstart.ladder, null);
}
{
  const klok = { t: 6000 }, o = maakOpslag(), m = laadMeting(klok, o);
  Object.assign(m._opstart, { bestanden: 800, database: 2000, profiel: 500, totaal: 3300 });
  m.markeerOpstartLadder();
  check('bewaarde inlog: laddertijd gemeten', m._opstart.ladder, 6000);
  klok.t = 9000; m.markeerOpstartLadder();
  check('alleen de eerste keer telt', m._opstart.ladder, 6000);
  check('het spoor is bewaard', m.leesOpstartSpoor().ladder, 6000);
  check('geen update → geen apart spoor', m.leesOpstartSpoor('update'), null);
  klok.t = 9500; m.markeerOpstartNaUpdate();
  check('na een update: apart bewaard', m.leesOpstartSpoor('update')?.naUpdate, true);
  check('en met dezelfde tijden', m.leesOpstartSpoor('update')?.ladder, 6000);
}
{
  // Wordt een nieuwe versie pas actief als de app al lang openstaat, dan
  // hoort dat niet bij deze start.
  const klok = { t: 200000 }, o = maakOpslag(), m = laadMeting(klok, o);
  m._opstart.bestanden = 800;
  m.markeerOpstartNaUpdate();
  check('na drie minuten telt een update niet meer', m._opstart.naUpdate, false);
}
//  ⚠ De gegevenstijd hangt aan "geopend met een bewaarde inlog", NIET aan "het
//  logo staat nog": haalt het vangnet het logo eerder weg, dan is dat juist de
//  trage start die gemeten moet worden.
check('de start onthoudt of er een bewaarde inlog was',
  /hersteldeSessie = !!auth\.currentUser;[\s\S]{0,300}_opstart\.hersteld = hersteldeSessie;/.test(opstart), true);
check('gegevenstijd alleen bij een bewaarde inlog, ook na het vangnet',
  /if \(_opstart\.hersteld === true && _opstart\.profiel === null\) \{\s*\n\s*_opstart\.profiel = /.test(meeluisteraar) &&
  !/_opstart\.totaal === null && _opstart\.profiel === null/.test(meeluisteraar), true);
check('de app geeft de melding van de service worker door',
  /SW_ACTIVATED[\s\S]{0,400}markeerOpstartNaUpdate\(\)/.test(appBron), true);
check('de ladder geeft het meetpunt door',
  /if \(allesKlaar\) markeerOpstartLadder\(\);/.test(functieUit(ladderBron, 'renderLadder')), true);
check('Beheer toont ook de laatste start na een update',
  /leesOpstartSpoor\('update'\)[\s\S]*?Laatste start na een update/.test(functieUit(adminBron, 'toonOpstartSpoor')), true);

module.exports = staat;
