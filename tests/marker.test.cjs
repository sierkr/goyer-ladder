// ============================================================
//  Markers en de drie scorekaarten — automatische tests (v5.11.0)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  In een toernooi houdt een MARKER de kaart bij van één medespeler. Pas als
//  speler en marker hetzelfde getal hebben staan, is een hole betrouwbaar.
//  Daarvoor staan er drie lagen naast elkaar: de speler zelf, zijn marker, en
//  de wedstrijdleiding — en die laatste heeft het laatste woord.
//
//  scoreOordeel() is de enige plek waar wordt bepaald welke score telt en
//  welke kleur erbij hoort. De scorekaart, de onderlinge stand, de ranglijst,
//  het afsluiten van een dag en de meekijkpagina leunen er allemaal op. Gaat
//  hier iets mis, dan gaat het overal mis — vandaar deze suite.
//
//  De kleuren: zwart = klopt, oranje = wacht op de ander, rood = ze
//  verschillen.
// ============================================================
const { laadMarkerKern, maakChecker } = require('./harnas.cjs');
const M = laadMarkerKern();
const { staat, check } = maakChecker();

const kleurVan = (sp, mk, bh) => M.scoreOordeel(sp, mk, bh).kleur;

// ── Blok 1: de markerkring ───────────────────────────────────
console.log('══ WIE MARKEERT WIE ══\n');

check('drie spelers vormen een kring',
  M.markerKring(['a', 'b', 'c']), { a: 'c', b: 'a', c: 'b' });
check('bij twee spelers markeren ze elkaar',
  M.markerKring(['a', 'b']), { a: 'b', b: 'a' });
check('bij één speler valt er niets te markeren',
  M.markerKring(['a']), {});
check('een lege flight valt niet om', M.markerKring([]), {});
check('niemand markeert zichzelf',
  Object.entries(M.markerKring(['a', 'b', 'c', 'd'])).filter(([s, m]) => s === m).length, 0);
check('iedereen heeft precies één marker',
  Object.keys(M.markerKring(['a', 'b', 'c', 'd'])).length, 4);
check('en iedereen markeert precies één ander',
  new Set(Object.values(M.markerKring(['a', 'b', 'c', 'd']))).size, 4);

// ── Blok 2: de kleur van één hole ────────────────────────────
console.log('\n══ DE KLEUR VAN EEN HOLE ══\n');

check('niemand heeft ingevuld → leeg',        kleurVan(null, null, null), 'leeg');
check('alleen de speler → oranje',            kleurVan(5, null, null),    'oranje');
check('alleen de marker → oranje',            kleurVan(null, 5, null),    'oranje');
check('allebei hetzelfde → zwart',            kleurVan(5, 5, null),       'zwart');
check('allebei verschillend → rood',          kleurVan(5, 6, null),       'rood');
check('wedstrijdleiding vastgesteld → zwart', kleurVan(5, 6, 4),          'zwart');

check('een lege tekst telt als niet ingevuld', kleurVan('', '', null), 'leeg');
check('tekst en getal zijn hetzelfde getal',   kleurVan('5', 5, null),  'zwart');

// ── Blok 3: welke score telt er mee ──────────────────────────
console.log('\n══ WELKE SCORE TELT ══\n');

check('zonder vaststelling telt de speler',
  M.scoreOordeel(5, 6, null).tel, 5);
check('de wedstrijdleiding overrulet allebei',
  M.scoreOordeel(5, 6, 4).tel, 4);
check('heeft alleen de marker ingevuld, dan is dat het enige getal dat er is',
  M.scoreOordeel(null, 6, null).tel, 6);
check('nog niets ingevuld telt als niets',
  M.scoreOordeel(null, null, null).tel, null);

// `vast` is wat de hole op slot zet voor speler en marker. Zonder dat slot kan
// een gecontroleerde score weer opengetrokken worden.
check('vast staat alleen aan na de wedstrijdleiding',
  [M.scoreOordeel(5, 5, null).vast, M.scoreOordeel(5, 6, 4).vast], [false, true]);
check('een vastgestelde 0 telt ook echt als vastgesteld',
  M.scoreOordeel(5, 5, 0).vast, true);

// Wat ieder te zien krijgt. Niemand ziet het getal van de ander: speler en
// marker moeten het er onderling over eens worden.
const o = M.scoreOordeel(5, 6, null);
check('de speler ziet zijn eigen 5', o.speler, 5);
check('de marker ziet zijn eigen 6', o.marker, 6);
check('en na vaststelling zien ze allebei hetzelfde',
  (x => [x.speler, x.marker, x.beheer])(M.scoreOordeel(5, 6, 4)), [4, 4, 4]);

// ── Blok 4: de waarschuwingsregel boven de kaart ─────────────
console.log('\n══ DE WAARSCHUWINGSREGEL ══\n');

const k = (holeNr, kleur) => ({ holeNr, kleur });

check('alles zwart → geen regel',
  M.kaartOordeel([k(1, 'zwart'), k(2, 'zwart')]).tekst, '');
check('één verschil wordt bij naam genoemd',
  M.kaartOordeel([k(7, 'rood')]).tekst, '1 verschil (hole 7)');
check('meer verschillen ook',
  M.kaartOordeel([k(3, 'rood'), k(7, 'rood')]).tekst, '2 verschillen (holes 3, 7)');
check('wachten op de marker staat er los achter',
  M.kaartOordeel([k(1, 'oranje'), k(2, 'oranje')]).tekst,
  '2 holes wachten op bevestiging');
check('verschillen staan vóór het wachten',
  M.kaartOordeel([k(2, 'oranje'), k(7, 'rood')]).tekst,
  '1 verschil (hole 7) · 1 hole wacht op bevestiging');
check('lege holes tellen niet mee in de regel',
  M.kaartOordeel([k(1, 'leeg'), k(2, 'leeg')]).tekst, '');
check('de holes komen ook los terug, voor het slot op de uitslagknop',
  M.kaartOordeel([k(3, 'rood'), k(7, 'rood')]).verschillen, [3, 7]);

// ── Blok 5: opnieuw verdelen als de flight verandert ─────────
console.log('\n══ DE KRING NA EEN SPELER ERBIJ OF ERAF ══\n');

// ⚠ Toevoegen en verwijderen raakten `markers` niet aan. De nieuwe speler viel
// dan terug op de kring terwijl de anderen hun opgeslagen marker hielden: één
// speler markeerde er twee, de nieuwe niemand.
const maakToernooi = () => ({
  dagen: [
    { dagNr: 1, afgerond: false, flights: [{ naam: 'Flight 1', spelerIds: ['a','b','c'],
                                             markers: M.markerKring(['a','b','c']) }] },
    { dagNr: 2, afgerond: true,  flights: [{ naam: 'Flight 1', spelerIds: ['a','b','c'],
                                             markers: M.markerKring(['a','b','c']) }] },
  ],
});

const netToegevoegd = maakToernooi();
netToegevoegd.dagen[0].flights[0].spelerIds.push('d');
netToegevoegd.dagen[1].flights[0].spelerIds.push('d');
M.herschikMarkers(netToegevoegd);

const kring1 = netToegevoegd.dagen[0].flights[0].markers;
check('de nieuwe speler zit in de kring', Object.keys(kring1).sort(), ['a','b','c','d']);
check('iedereen markeert precies één ander', new Set(Object.values(kring1)).size, 4);
check('en niemand zichzelf',
  Object.entries(kring1).filter(([s, m]) => s === m).length, 0);
check('een AFGESLOTEN dag blijft met rust',
  netToegevoegd.dagen[1].flights[0].markers, M.markerKring(['a','b','c']));

const netVerwijderd = maakToernooi();
netVerwijderd.dagen[0].flights[0].spelerIds =
  netVerwijderd.dagen[0].flights[0].spelerIds.filter(x => x !== 'b');
M.herschikMarkers(netVerwijderd);
const kring2 = netVerwijderd.dagen[0].flights[0].markers;
check('na verwijderen blijven de twee anderen over',
  Object.keys(kring2).sort(), ['a','c']);
check('en die markeren elkaar', kring2, { a: 'c', c: 'a' });
check('de verwijderde speler komt nergens meer voor',
  JSON.stringify(kring2).includes('b'), false);

check('een flight van één overhoudt geen marker',
  (() => { const t = maakToernooi();
           t.dagen[0].flights[0].spelerIds = ['a'];
           M.herschikMarkers(t);
           return t.dagen[0].flights[0].markers; })(), {});

check('een toernooi zonder dagen valt niet om',
  (() => { M.herschikMarkers(null); M.herschikMarkers({}); return 'ok'; })(), 'ok');

module.exports = staat;
