// ============================================================
//  Korte, unieke namen — automatische tests (v5.11.0)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  Op de ladder van De Goyer staan drie leden die Arjan heten: Arjan van
//  Venrooij, Arjan Ribbe en Arjan Paulussen. In de onderlinge stand van een
//  toernooi stonden daardoor drie kolommen én drie rijen met alleen het woord
//  "Arjan" — niet te lezen, en niet te controleren.
//
//  kortNaam() plakt er letters van de achternaam achter tot het uniek is. Tot
//  v5.10.0 telde het TUSSENVOEGSEL daarin mee, en dan werd "Arjan van
//  Venrooij" onderscheiden met de v van "van" in plaats van de V van
//  "Venrooij". Sierk, 12 september 2026: "Arjan van Venrooij moet worden
//  Arjan V, de V van Venrooij en niet Arjan v, de v van van."
//
//  Blok 1 legt die regel vast. Blok 2 bewaakt dat er niet méér letters worden
//  getoond dan nodig, en blok 3 de randgevallen.
// ============================================================
const { laadNaamKern, maakChecker } = require('./harnas.cjs');
const N = laadNaamKern();
const { staat, check } = maakChecker();

const sp = (uid, naam) => ({ uid, naam });

// ── Blok 1: het tussenvoegsel telt niet mee ──────────────────
console.log('══ HET TUSSENVOEGSEL TELT NIET MEE ══\n');

check('van Venrooij → achternaam Venrooij',
  N.splitsNaam('Arjan van Venrooij'), { voornaam: 'Arjan', achternaam: 'Venrooij' });
check('van der Veen → achternaam Veen',
  N.splitsNaam('Arjan van der Veen'), { voornaam: 'Arjan', achternaam: 'Veen' });
check('dubbele voornaam hoort bij de achternaam-kant',
  N.splitsNaam('Bart Jan van Genderen'), { voornaam: 'Bart', achternaam: 'Jan van Genderen' });
check('zonder tussenvoegsel',
  N.splitsNaam('Arjan Ribbe'), { voornaam: 'Arjan', achternaam: 'Ribbe' });
check('iemand die alleen "Jan de" heet houdt "de" als achternaam',
  N.splitsNaam('Jan de'), { voornaam: 'Jan', achternaam: 'de' });

// De echte drie Arjans van de ladder.
const drieArjans = [
  sp('a1', 'Arjan van Venrooij'),
  sp('a2', 'Arjan Ribbe'),
  sp('a3', 'Arjan Paulussen'),
];
check('de drie Arjans worden V, R en P',
  drieArjans.map(s => N.kortNaam(s, drieArjans)),
  ['Arjan V', 'Arjan R', 'Arjan P']);
check('en niet de kleine v van "van"',
  N.kortNaam(drieArjans[0], drieArjans).includes(' v '), false);

// ── Blok 2: niet meer letters dan nodig ──────────────────────
console.log('\n══ ZO KORT ALS HET KAN, ZO LANG ALS HET MOET ══\n');

const alleen = [sp('x', 'Arjan van Venrooij'), sp('y', 'Bart Jan van Genderen')];
check('zonder naamgenoot alleen de voornaam',
  alleen.map(s => N.kortNaam(s, alleen)), ['Arjan', 'Bart']);

const lijkendeAchternamen = [sp('a', 'Arjan van Venrooij'), sp('b', 'Arjan van der Veen')];
check('Venrooij en Veen groeien door tot Ven en Vee',
  lijkendeAchternamen.map(s => N.kortNaam(s, lijkendeAchternamen)),
  ['Arjan Ven', 'Arjan Vee']);

const pieters = [sp('a', 'Erik Pietersen'), sp('b', 'Erik Pietersma'), sp('c', 'Erik Hulst')];
check('Hulst is met één letter klaar, de Pieters niet',
  pieters.map(s => N.kortNaam(s, pieters)),
  ['Erik Pieterse', 'Erik Pietersm', 'Erik H']);

// ── Blok 3: randgevallen ─────────────────────────────────────
console.log('\n══ RANDGEVALLEN ══\n');

const zelfdeNaam = [sp('a', 'Jan Jansen'), sp('b', 'Jan Jansen')];
check('twee keer precies dezelfde naam valt terug op de hele naam',
  zelfdeNaam.map(s => N.kortNaam(s, zelfdeNaam)), ['Jan Jansen', 'Jan Jansen']);

const eenWoord = [sp('a', 'Arjan'), sp('b', 'Arjan Ribbe')];
check('iemand zonder achternaam houdt zijn voornaam',
  eenWoord.map(s => N.kortNaam(s, eenWoord)), ['Arjan', 'Arjan R']);

check('hoofdletters tellen niet mee bij het vergelijken van voornamen',
  N.kortNaam(sp('a', 'ARJAN Ribbe'), [sp('a', 'ARJAN Ribbe'), sp('b', 'arjan Paulussen')]),
  'ARJAN R');

check('kortNaamMap geeft een map op uid',
  N.kortNaamMap(drieArjans), { a1: 'Arjan V', a2: 'Arjan R', a3: 'Arjan P' });

check('een lege lijst valt niet om', N.kortNaamMap([]), {});

// ── Blok 4: de app en de meekijkpagina doen hetzelfde ────────
// ⚠ `toernooi-live.html` staat bewust los van de app en heeft een eigen kopie
// van deze regel — importeren zou de halve app meeslepen op een scherm dat
// zonder inloggen open moet kunnen. Deze test is de enige bewaking dat die
// twee gelijk blijven: anders staat dezelfde speler op het ene scherm als
// "Arjan V" en op het andere als "Arjan".
console.log('\n══ APP EN MEEKIJKPAGINA GELIJK ══\n');

const proeven = [
  ['Arjan van Venrooij', 'Arjan Ribbe', 'Arjan Paulussen'],
  ['Arjan van Venrooij', 'Arjan van der Veen'],
  ['Erik Pietersen', 'Erik Pietersma', 'Erik Hulst'],
  ['Bart Jan van Genderen', 'Sierk Roosma'],
  ['Jan Jansen', 'Jan Jansen'],
  ['Test 1', 'Test 2', 'Test 3'],
  ['Karel'],
];

let verschillen = 0, vergeleken = 0;
proeven.forEach(namen => {
  const lijst = namen.map((naam, i) => ({ uid: 'u' + i, naam }));
  const a = JSON.stringify(N.app.kortNaamMap(lijst));
  const b = JSON.stringify(N.meekijk.kortNaamMap(lijst));
  vergeleken++;
  if (a !== b) { verschillen++; console.log('   verschil bij', namen.join(' / '), a, b); }
});
check('er is daadwerkelijk vergeleken', vergeleken, proeven.length);
check('de meekijkpagina rekent gelijk aan de app', verschillen, 0);

check('en ook de naamsplitsing zelf',
  JSON.stringify(N.meekijk.splitsNaam('Bart Jan van Genderen')),
  JSON.stringify(N.app.splitsNaam('Bart Jan van Genderen')));

module.exports = staat;
