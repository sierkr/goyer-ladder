// ============================================================
//  Twee paar ogen en de drie scorekaarten — automatische tests
//  (v5.11.0, herschreven in v5.43.0)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  In een toernooi wordt elke score twee keer ingetikt: door de speler zelf, en
//  door iemand anders uit zijn flight. Pas als die twee hetzelfde getal hebben
//  staan, is een hole betrouwbaar. Daarvoor staan er drie lagen naast elkaar:
//  de speler zelf, zijn flight, en de wedstrijdleiding — en die laatste heeft
//  het laatste woord.
//
//  scoreOordeel() is de enige plek waar wordt bepaald welke score telt en
//  welke kleur erbij hoort. De scorekaart, de onderlinge stand, de ranglijst,
//  het afsluiten van een dag en de meekijkpagina leunen er allemaal op. Gaat
//  hier iets mis, dan gaat het overal mis — vandaar deze suite.
//
//  De kleuren: zwart = klopt, oranje = wacht op de ander, rood = ze
//  verschillen.
//
//  ⚠ v5.43.0 — DE VASTE MARKER IS WEG. Tot v5.42.0 deelde de app binnen elke
//  flight een kring uit: je mocht in precies één kolom van een medespeler
//  typen. Sierk, 25 september 2026: in de praktijk pakt iemand de kaart op en
//  vult hij hem voor de hele flight in. De kringtests zijn daarom vervangen
//  door de twee vragen die er nu wel toe doen: mag ik in deze kolom typen
//  (blok 1), en kunnen twee mensen in dezelfde kolom elkaars holes wissen
//  (blok 5)?
// ============================================================
const { laadMarkerKern, maakChecker } = require('./harnas.cjs');
const M = laadMarkerKern();
const { staat, check } = maakChecker();

const kleurVan = (sp, mk, bh) => M.scoreOordeel(sp, mk, bh).kleur;

// ── Blok 1: in wiens kolom mag ik typen ─────────────────────
console.log('══ IN WIENS KOLOM MAG IK TYPEN ══\n');

// Sinds v5.43.0 is dit de enige vraag: zitten we in dezelfde flight?
const dagMetFlights = {
  flights: [
    { naam: 'Flight 1', spelerIds: ['a', 'b', 'c'] },
    { naam: 'Flight 2', spelerIds: ['d', 'e'] },
  ],
};

check('een flightgenoot mag in mijn kolom',
  M.zelfdeFlight('a', 'b', dagMetFlights), true);
check('ook de derde in de flight — er is geen toegewezen speler meer',
  M.zelfdeFlight('a', 'c', dagMetFlights), true);
check('iemand uit een andere flight niet',
  M.zelfdeFlight('a', 'd', dagMetFlights), false);
check('de andere kant op geldt hetzelfde',
  [M.zelfdeFlight('c', 'a', dagMetFlights), M.zelfdeFlight('d', 'a', dagMetFlights)],
  [true, false]);
check('wie in de spelerspool staat hoort bij niemand',
  [M.zelfdeFlight('x', 'a', dagMetFlights), M.zelfdeFlight('a', 'x', dagMetFlights)],
  [false, false]);

// ⚠ Een dag zonder flights komt echt voor: dag 2 en verder krijgen hun indeling
// pas bij het starten van die dag. Zonder deze drie valt de scorekaart daar om.
check('een dag zonder flights valt niet om',
  [M.zelfdeFlight('a', 'b', { flights: [] }), M.zelfdeFlight('a', 'b', {}),
   M.zelfdeFlight('a', 'b', null)], [false, false, false]);
check('zonder speler is het antwoord nee',
  [M.zelfdeFlight(null, 'a', dagMetFlights), M.zelfdeFlight('a', null, dagMetFlights)],
  [false, false]);
// ── Blok 2: de kleur van één hole ────────────────────────────
console.log('\n══ DE KLEUR VAN EEN HOLE ══\n');

check('niemand heeft ingevuld → leeg',        kleurVan(null, null, null), 'leeg');
check('alleen de speler → oranje',            kleurVan(5, null, null),    'oranje');
check('alleen een medespeler → oranje',       kleurVan(null, 5, null),    'oranje');
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
check('heeft alleen een medespeler ingevuld, dan is dat het enige getal dat er is',
  M.scoreOordeel(null, 6, null).tel, 6);
check('nog niets ingevuld telt als niets',
  M.scoreOordeel(null, null, null).tel, null);

// `vast` is wat de hole op slot zet voor de speler en zijn flight. Zonder dat
// slot kan een gecontroleerde score weer opengetrokken worden.
check('vast staat alleen aan na de wedstrijdleiding',
  [M.scoreOordeel(5, 5, null).vast, M.scoreOordeel(5, 6, 4).vast], [false, true]);
check('een vastgestelde 0 telt ook echt als vastgesteld',
  M.scoreOordeel(5, 5, 0).vast, true);

// Wat ieder te zien krijgt. Niemand ziet het getal van de ander: speler en
// medespeler moeten het er onderling over eens worden.
const o = M.scoreOordeel(5, 6, null);
check('de speler ziet zijn eigen 5', o.speler, 5);
check('de medespeler ziet zijn eigen 6', o.marker, 6);
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
check('wachten op bevestiging staat er los achter',
  M.kaartOordeel([k(1, 'oranje'), k(2, 'oranje')]).tekst,
  '2 holes wachten op bevestiging');
check('verschillen staan vóór het wachten',
  M.kaartOordeel([k(2, 'oranje'), k(7, 'rood')]).tekst,
  '1 verschil (hole 7) · 1 hole wacht op bevestiging');
check('lege holes tellen niet mee in de regel',
  M.kaartOordeel([k(1, 'leeg'), k(2, 'leeg')]).tekst, '');
check('de holes komen ook los terug, voor het slot op de uitslagknop',
  M.kaartOordeel([k(3, 'rood'), k(7, 'rood')]).verschillen, [3, 7]);

// ⚠ v5.43.1 — BIJ WIE ZIT HET VERSCHIL. Sierk, 25 september 2026: "er is nog een
// hole met alle scores hetzelfde en toch rood." De regel noemde alleen het
// holenummer, en sinds v5.43.0 kijkt hij naar ÉLKE kolom van de flight in plaats
// van naar twee. "Hole 7" kon dus over de kaart van een medespeler gaan terwijl
// er op je eigen regel bij hole 7 niets aan de hand was. Een waarschuwing die je
// niet kunt terugvinden is een vals alarm.
const kw = (holeNr, kleur, wie) => ({ holeNr, kleur, wie });

check('bij één verschil staat de naam erbij',
  M.kaartOordeel([kw(7, 'rood', 'Bram')]).tekst, '1 verschil (hole 7 bij Bram)');
check('bij meer verschillen bij allemaal',
  M.kaartOordeel([kw(3, 'rood', 'Anna'), kw(7, 'rood', 'Bram')]).tekst,
  '2 verschillen (hole 3 bij Anna, hole 7 bij Bram)');
check('twee verschillen bij dezelfde speler staan er ook los',
  M.kaartOordeel([kw(3, 'rood', 'Anna'), kw(7, 'rood', 'Anna')]).tekst,
  '2 verschillen (hole 3 bij Anna, hole 7 bij Anna)');
check('het wachten blijft een aantal, zonder namen',
  M.kaartOordeel([kw(1, 'oranje', 'Anna'), kw(2, 'oranje', 'Bram')]).tekst,
  '2 holes wachten op bevestiging');
check('zonder naam blijft de tekst precies zoals hij was',
  [M.kaartOordeel([k(7, 'rood')]).tekst, M.kaartOordeel([k(3, 'rood'), k(7, 'rood')]).tekst],
  ['1 verschil (hole 7)', '2 verschillen (holes 3, 7)']);
check('en de holes komen los nog steeds terug',
  M.kaartOordeel([kw(3, 'rood', 'Anna'), kw(7, 'rood', 'Bram')]).verschillen, [3, 7]);

// ── Blok 5: niemand wist de holes van een ander ──────────────
console.log('\n══ TWEE MENSEN IN DEZELFDE KOLOM ══\n');

//  ⚠ WAAROM DIT BLOK BESTAAT. Een kaart gaat als HELE RIJ van 18 getallen naar
//  de server. Tot v5.42.0 kon dat geen kwaad: per kolom typte precies één
//  medespeler, de toegewezen marker. Sinds v5.43.0 mag de hele flight in
//  dezelfde kolom typen, en dan wordt zo'n hele rij gevaarlijk — wie een rij
//  wegstuurt waarin de holes van een ander nog leeg staan, wist die.
//
//  _rijVoorOpslag() bouwt de rij daarom pas op het moment van versturen op: de
//  laatst bekende stand als ondergrond, met alleen MIJN eigen getallen
//  eroverheen.

// Anne heeft net hole 1 t/m 3 ingevuld bij speler 'a'; dat staat al op de
// server en is dus in _liveScores terechtgekomen.
M._leegEigen();
M._zetLive({ a: { markerDagen: { '1': [4, 5, 3, null, null, null] } } });

// Bram tikt op zijn eigen telefoon hole 4 in bij dezelfde speler.
M._onthoudEigenInvoer('a', 'markerDagen', 1, 3, 6);

check('mijn hole komt erbij zonder die van de ander te wissen',
  M._rijVoorOpslag('a', 'markerDagen', 1, 6), [4, 5, 3, 6, null, null]);

// En als Anne ondertussen ook hole 5 heeft ingevuld: die melding komt binnen,
// _liveScores wordt bijgewerkt, en Brams volgende toetsaanslag mag hole 5 niet
// weer leegmaken.
M._zetLive({ a: { markerDagen: { '1': [4, 5, 3, null, 4, null] } } });
M._onthoudEigenInvoer('a', 'markerDagen', 1, 5, 5);
check('een hole die er tussendoor bijkwam blijft staan',
  M._rijVoorOpslag('a', 'markerDagen', 1, 6), [4, 5, 3, 6, 4, 5]);

// Wat IK leegmaakte moet wél echt weg — anders kun je een typefout niet meer
// herstellen.
M._onthoudEigenInvoer('a', 'markerDagen', 1, 3, null);
check('wat ik zelf leegmaak gaat echt weg',
  M._rijVoorOpslag('a', 'markerDagen', 1, 6), [4, 5, 3, null, 4, 5]);

// De rij wordt altijd op de volle lengte van de dag gebracht: schermen verderop
// rekenen op 18 vakjes, ook als er nog maar drie zijn ingevuld.
M._leegEigen();
M._zetLive({ a: { markerDagen: { '1': [4, 5] } } });
check('de rij wordt aangevuld tot het aantal holes van de dag',
  M._rijVoorOpslag('a', 'markerDagen', 1, 6), [4, 5, null, null, null, null]);

// Niets bekend, niets ingetikt: een lege rij, geen fout.
M._leegEigen();
M._zetLive({});
check('een speler waarvan nog niets bekend is levert een lege rij',
  M._rijVoorOpslag('a', 'markerDagen', 1, 4), [null, null, null, null]);

// De lagen mogen elkaar niet raken. Wat de speler zelf intikte staat in een
// andere laag en heeft niets te maken met wat zijn flight intikt.
M._leegEigen();
M._zetLive({ a: { dagen: { '1': [7, 7] }, markerDagen: { '1': [4, 5] } } });
M._onthoudEigenInvoer('a', 'markerDagen', 1, 0, 3);
check('de laag van de speler blijft buiten de rij van de flight',
  M._rijVoorOpslag('a', 'markerDagen', 1, 2), [3, 5]);
check('en omgekeerd',
  M._rijVoorOpslag('a', 'dagen', 1, 2), [7, 7]);

// Twee dagen door elkaar: dag 2 mag niet met de getallen van dag 1 vullen.
M._leegEigen();
M._zetLive({ a: { markerDagen: { '1': [4, 5], '2': [3, 3] } } });
M._onthoudEigenInvoer('a', 'markerDagen', 2, 0, 6);
check('dag 2 pakt alleen zijn eigen dag',
  M._rijVoorOpslag('a', 'markerDagen', 2, 2), [6, 3]);
check('en dag 1 blijft ongemoeid',
  M._rijVoorOpslag('a', 'markerDagen', 1, 2), [4, 5]);

// ── Blok 6: de meekijkpagina kiest hetzelfde getal als de app ──
console.log('\n══ DE MEEKIJKPAGINA NAAST DE APP ══\n');

//  ⚠ WAAROM DIT BLOK BESTAAT. `toernooi-live.html` staat los van de app en heeft
//  zijn eigen kopie van "welk getal telt". Tot v5.43.1 las die pagina alleen de
//  laag `dagen` — wat een speler ZELF intikte — en negeerde `markerDagen` en
//  `beheerDagen`. Houdt één iemand de kaart van de hele flight bij, en dat is
//  sinds v5.43.0 de gewone gang van zaken, dan bleef die pagina dus leeg tot
//  "dag afsluiten". Sierk vroeg op 25 september 2026 waarom de meekijklink niet
//  dezelfde kaart laat zien als de coordinator.
//
//  ⚠ Er is GEEN browserproef voor die pagina en die kan er ook niet zijn: hij
//  praat altijd met de live-database en draait niet in de emulator. Dit is dus
//  de enige meting die er is — de twee kanten uit de bron knippen en naast
//  elkaar leggen, net als de suite "Korte unieke namen" doet.

const L = M.meekijk;
const waarden = [null, undefined, '', 0, 3, 4, 5, '5'];
let afwijkingen = 0;
for (const sp of waarden) for (const mk of waarden) for (const bh of waarden) {
  const app  = M.scoreOordeel(sp, mk, bh).tel;
  const live = L.tellendGetal(sp, mk, bh);
  // Allebei null/undefined telt als gelijk; anders moet het getal hetzelfde zijn.
  const gelijk = (app === null || app === undefined)
    ? (live === null || live === undefined)
    : app === live;
  if (!gelijk) afwijkingen++;
}
check(`alle ${waarden.length ** 3} combinaties geven hetzelfde getal`, afwijkingen, 0);

// En de losse gevallen met naam, zodat een afwijking meteen te lezen is.
check('alleen de speler',                 L.tellendGetal(5, null, null), 5);
check('alleen een medespeler',            L.tellendGetal(null, 5, null), 5);
check('alleen de wedstrijdleiding',       L.tellendGetal(null, null, 5), 5);
check('speler en medespeler oneens: de speler telt',
  L.tellendGetal(5, 6, null), 5);
check('de wedstrijdleiding overrulet allebei',
  L.tellendGetal(5, 6, 4), 4);
check('een vastgestelde 0 telt ook echt',  L.tellendGetal(5, 5, 0), 0);
check('niemand vulde in',                  L.tellendGetal(null, null, null), null);

// ── De hele rij, zoals de pagina hem tekent ─────────────────
//  Dit is het geval uit de melding: één medespeler hield de kaart bij, de speler
//  zelf tikte niets in. Tot v5.43.1 kwam hier een leeg scherm uit.
L._zetLiveMap({
  a: { markerDagen: { '1': [4, 5] } },              // alleen door de flight
  b: { dagen: { '1': [6, 7] }, dagNr: 1, scores: [6, 7] },  // door zichzelf
  c: { beheerDagen: { '1': [3, 3] } },              // door de wedstrijdleiding
});
const dag = { dagNr: 1, holes: [{}, {}], scores: {} };
check('de kaart van een medespeler komt door',
  L.getLiveScoresVoorDag(dag).a, [4, 5]);
check('de eigen kaart ook nog steeds',
  L.getLiveScoresVoorDag(dag).b, [6, 7]);
check('en wat de wedstrijdleiding vaststelde ook',
  L.getLiveScoresVoorDag(dag).c, [3, 3]);

// De pagina mag niet omvallen op een speler zonder scores, en valt terug op wat
// er in het toernooidocument staat — dat is de bron voor een afgesloten dag.
L._zetLiveMap({});
check('zonder live-scores blijft de dag zelf de bron',
  L.getLiveScoresVoorDag({ dagNr: 1, holes: [{}], scores: { a: [4] } }).a, [4]);
check('een lege dag valt niet om', L.getLiveScoresVoorDag(null), {});

// En het moet hetzelfde zijn als wat de APP voor dezelfde gegevens uitrekent.
const zelfdeBron = { markerDagen: { '1': [4, 5] }, dagen: { '1': [null, 6] } };
L._zetLiveMap({ a: zelfdeBron });
check('app en meekijkpagina komen op dezelfde rij uit',
  L.getLiveScoresVoorDag(dag).a, M._liveScoresVanDag(zelfdeBron, 1));

// ── Blok 7: doortikken terwijl de server nog niet heeft geantwoord ──
console.log('\n══ DOORTIKKEN TIJDENS HET OPSLAAN ══\n');

//  ⚠ WAAROM DIT BLOK BESTAAT. Sierk, 25 september 2026, na v5.43.0 op live:
//  "het lijkt nu toch alsof de beheerder niet meer bepaalt welke score er
//  klopt." Hij had het goed gezien, en het was een NIEUWE fout van v5.43.0.
//
//  Tussen het versturen van een kaart en de bevestiging van de server zit een
//  netwerkreis. v5.43.0 gooide de lijst "wat tikte ik zelf in" bij die
//  bevestiging in één keer leeg — óók de holes die je in die tussentijd had
//  ingetikt. De melding die op de bevestiging volgt bevat alleen wat er
//  verstuurd was, dus verdween dat getal daarna ook uit de lokale kopie, en de
//  volgende schrijfactie stuurde de rij zónder hem weg. Wie een kolom snel naar
//  beneden tikt — en dat doet de wedstrijdleiding — verliest zo getallen.
//
//  Deze test doet dat na met een schrijver die de test zelf ophoudt.

const tik = (uid, laag, dagNr, hole, waarde, holes = 2) => {
  // Wat updateTScore lokaal doet bij één toetsaanslag.
  const live = M._leesLive();
  const rij = [...((live[uid] || {})[laag]?.[String(dagNr)] || Array(holes).fill(null))];
  rij[hole] = waarde;
  M._zetLive({ ...live, [uid]: { ...(live[uid] || {}), [laag]: { [String(dagNr)]: rij } } });
  M._onthoudEigenInvoer(uid, laag, dagNr, hole, waarde);
  M.slaSpelerScoreOp(uid, dagNr, holes, laag);
};
const wacht = (ms) => new Promise(r => setTimeout(r, ms));

async function blokDoortikken() {
  M._leegEigen();
  M._zetLive({});
  const verstuurd = [];
  let losEerste;
  let nr = 0;
  M._zetSchrijver((velden) => {
    nr++;
    verstuurd.push([...velden.beheerDagen['1']]);
    // De eerste schrijfactie blijft hangen tot de test hem losmaakt.
    if (nr === 1) return new Promise(r => { losEerste = r; });
    return Promise.resolve();
  });

  tik('a', 'beheerDagen', 1, 0, 6);   // hole 1 = 6
  await wacht(850);                   // verstuurd, nog niet bevestigd
  tik('a', 'beheerDagen', 1, 1, 5);   // hole 2 = 5, tijdens het wachten
  losEerste();                        // en nu antwoordt de server op de eerste
  await wacht(30);
  // De melding die op die bevestiging volgt bevat alleen wat er verstuurd was.
  // Zo kwam de 5 uit de lokale kopie te verdwijnen.
  M._zetLive({ a: M._metEigenInvoer('a', { beheerDagen: { '1': [6, null] } }) });
  await wacht(1100);                  // de tweede schrijfactie loopt af

  check('de 5 die tijdens het opslaan werd ingetikt gaat mee',
    verstuurd[verstuurd.length - 1], [6, 5]);
  check('en de 6 van daarvoor blijft ook staan',
    verstuurd[verstuurd.length - 1][0], 6);

  // ── En op het scherm. De meeluisteraar mag een net ingetikt getal niet
  //    terugzetten naar de oude waarde; bij de wedstrijdleiding ziet dat eruit
  //    alsof haar getal niet geldt.
  M._leegEigen();
  M._onthoudEigenInvoer('a', 'beheerDagen', 1, 1, 5);
  check('een verse serverkopie houdt mijn nog niet bevestigde getal',
    M._metEigenInvoer('a', { beheerDagen: { '1': [6, null] } }).beheerDagen['1'],
    [6, 5]);
  check('een andere speler in dezelfde melding blijft ongemoeid',
    M._metEigenInvoer('b', { beheerDagen: { '1': [3, 3] } }).beheerDagen['1'],
    [3, 3]);
  check('en een andere dag ook',
    M._metEigenInvoer('a', { beheerDagen: { '2': [4, 4] } }).beheerDagen['2'],
    [4, 4]);

  // ── De lijst zelf: alleen wat écht verstuurd is gaat eraf.
  M._leegEigen();
  M._onthoudEigenInvoer('a', 'markerDagen', 1, 0, 4);
  M._onthoudEigenInvoer('a', 'markerDagen', 1, 1, 5);
  M._vergeetVerstuurdeInvoer('a|markerDagen|1', { 0: 4 });
  check('de verstuurde hole gaat eraf, de andere blijft',
    M._leesEigen()['a|markerDagen|1'], { 1: 5 });

  M._leegEigen();
  M._onthoudEigenInvoer('a', 'markerDagen', 1, 0, 4);
  M._vergeetVerstuurdeInvoer('a|markerDagen|1', { 0: 4 });
  check('een lege lijst wordt helemaal opgeruimd',
    M._leesEigen()['a|markerDagen|1'], undefined);

  // ⚠ Overtikken tijdens het wachten: de 4 is verstuurd, maar er staat nu een 5.
  // Die mag NIET van de lijst af, anders verdwijnt de correctie.
  M._leegEigen();
  M._onthoudEigenInvoer('a', 'markerDagen', 1, 0, 5);
  M._vergeetVerstuurdeInvoer('a|markerDagen|1', { 0: 4 });
  check('een hole die intussen is overgetikt blijft beschermd',
    M._leesEigen()['a|markerDagen|1'], { 0: 5 });

  // Leegmaken is ook een waarde: verstuurd als null, dus mag eraf.
  M._leegEigen();
  M._onthoudEigenInvoer('a', 'markerDagen', 1, 0, null);
  M._vergeetVerstuurdeInvoer('a|markerDagen|1', { 0: null });
  check('een verstuurde leegmaking gaat ook van de lijst',
    M._leesEigen()['a|markerDagen|1'], undefined);

  M._leegEigen();
  M._zetLive({});
  M._zetSchrijver(async () => {});
  return staat;
}

// ════════════════════════════════════════════════════════════
//  v6.0.2 — EEN EIGEN KAART PER INVULLER
// ════════════════════════════════════════════════════════════
//  ⚠ WAAROM DIT BLOK BESTAAT. Sierk, 14 oktober 2026, flight Roy, Ton en
//  Sierk: "als Roy een score voor alle drie invult dan ziet Sierk op zijn kaart
//  de ingevulde score staan bij Ton en Ton ziet op zijn kaart de score van Roy."
//  En: "de wedstrijdleiding ziet niet alle ingevulde scores."
//
//  Oorzaak: sinds v5.43.0 schreef de hele flight in ÉÉN gedeelde laag per
//  speler (`markerDagen`). Wat Roy bij Ton intikte stond dus op het scherm van
//  Sierk; tikte Sierk daar iets anders, dan overschreef hij Roy zonder rood; en
//  een telefoon die achterliep wiste de holes van een ander.
//
//  Dit blok speelt dat na met de ECHTE invoer (updateTScore) en de ECHTE
//  weergave (rolVoorKolom, celOordeel, celWaarde). Alleen de database is
//  nagemaakt — met de regel van Firestore voor `merge: true`: losse velden in
//  een map worden samengevoegd, een rij (array) wordt in zijn geheel vervangen.
//
//  ⚠ Bouwnorm A3a: dit blok is eerst tegen v6.0.1 gedraaid en gaf daar rode
//  regels — zie CLAUDE.md, v6.0.2.

// De database zoals Firestore hem bij setDoc(..., { merge: true }) samenvoegt.
function voegSamen(doel, bron) {
  const uit = { ...(doel || {}) };
  for (const [sleutel, waarde] of Object.entries(bron || {})) {
    const isMap = (x) => x && typeof x === 'object' && !Array.isArray(x);
    uit[sleutel] = (isMap(waarde) && isMap(uit[sleutel])) ? voegSamen(uit[sleutel], waarde)
      : JSON.parse(JSON.stringify(waarde));
  }
  return uit;
}
const kopie = (x) => JSON.parse(JSON.stringify(x));

async function blokEigenKaart() {
  // ── De kleur met meer dan twee getallen ─────────────────────
  console.log('\n══ DE KLEUR MET EEN KAART PER MEDESPELER ══\n');

  check('twee medespelers hetzelfde, speler niets → zwart (twee paar ogen)',
    kleurVan(null, [5, 5], null), 'zwart');
  check('twee medespelers oneens → rood',
    kleurVan(null, [5, 6], null), 'rood');
  check('speler en twee medespelers gelijk → zwart',
    kleurVan(5, [5, 5], null), 'zwart');
  check('één van de drie wijkt af → rood',
    kleurVan(5, [5, 6], null), 'rood');
  check('maar één getal in de hele flight → oranje (stippellijn)',
    kleurVan(null, [null, 5, ''], null), 'oranje');
  check('niemand → leeg', kleurVan(null, [null, undefined, ''], null), 'leeg');
  check('de wedstrijdleiding beslist, hoe oneens de flight ook is',
    M.scoreOordeel(5, [6, 7], 4).tel, 4);
  check('zonder de speler telt het eerste getal van de flight',
    M.scoreOordeel(null, [null, 6, 6], null).tel, 6);

  // ── Roy, Ton en Sierk ───────────────────────────────────────
  console.log('\n══ ROY, TON EN SIERK ══\n');

  const dag = { dagNr: 1, holes: Array.from({ length: 9 }, () => ({ par: 4 })), scores: {},
    afgerond: false, flights: [{ naam: 'Flight 1', spelerIds: ['roy', 'ton', 'sierk'] }] };
  M._zetDag(dag);
  let server = {};
  M._zetSchrijver(async (velden, uid) => { server[uid] = voegSamen(server[uid], velden); });

  // Iemand pakt zijn telefoon en tikt in. `stand` is wat zijn telefoon van de
  // server weet; zonder stand is dat de actuele stand.
  const alsSpeler = async (wie, invoer, stand) => {
    M._zetMij(wie);
    M._leegEigen();
    M._zetLive(kopie(stand || server));
    dag.scores = {};
    for (const [kolom, hole, waarde] of invoer) M.updateTScore(kolom, hole, String(waarde));
    await wacht(850);   // de app wacht 800 ms en verstuurt dan per kolom één rij
  };
  // Wat ziet `wie` in het vakje van `kolom` op `hole`, en welke kleur heeft het?
  const zietBij = (wie, kolom, hole, leiding = false) => {
    M._zetMij(wie, leiding);
    M._leegEigen();
    M._zetLive(kopie(server));
    dag.scores = {};
    const o = M.celOordeel(kolom, hole, dag);
    return { getal: M.celWaarde(o, M.rolVoorKolom(kolom, dag)), kleur: o.kleur };
  };

  // Roy vult hole 1 in voor de hele flight: zichzelf 4, Ton 5, Sierk 6.
  await alsSpeler('roy', [['roy', 0, 4], ['ton', 0, 5], ['sierk', 0, 6]]);

  check('Sierk ziet bij Ton NIET het getal van Roy',
    zietBij('sierk', 'ton', 0).getal, null);
  check('Ton ziet bij Sierk NIET het getal van Roy',
    zietBij('ton', 'sierk', 0).getal, null);
  check('Roy ziet zijn eigen getallen wel',
    ['roy', 'ton', 'sierk'].map(k => zietBij('roy', k, 0).getal), [4, 5, 6]);
  check('Ton en Sierk zien hun eigen kolom leeg — ze kunnen zelf invullen',
    [zietBij('ton', 'ton', 0).getal, zietBij('sierk', 'sierk', 0).getal], [null, null]);
  check('de wedstrijdleiding ziet alles wat Roy invulde',
    ['roy', 'ton', 'sierk'].map(k => zietBij('leiding', k, 0, true).getal), [4, 5, 6]);
  check('en het staat nog op een stippellijn: niemand heeft het bevestigd',
    ['roy', 'ton', 'sierk'].map(k => zietBij('leiding', k, 0, true).kleur),
    ['oranje', 'oranje', 'oranje']);

  // Sierk houdt ook de kaart bij en tikt bij Ton een 7 in.
  await alsSpeler('sierk', [['ton', 0, 7]]);
  check('Sierk ziet bij Ton zijn eigen 7',
    zietBij('sierk', 'ton', 0).getal, 7);
  check('Roy ziet bij Ton nog steeds zijn eigen 5 — niet overschreven',
    zietBij('roy', 'ton', 0).getal, 5);
  check('en het vakje van Ton wordt ROOD: Roy en Sierk zijn het oneens',
    zietBij('leiding', 'ton', 0, true).kleur, 'rood');

  // Ze praten het uit: het was een 5.
  await alsSpeler('sierk', [['ton', 0, 5]]);
  check('Roy en Sierk allebei 5 → zwart, ook zonder Ton zelf',
    zietBij('leiding', 'ton', 0, true).kleur, 'zwart');

  // Ton vult zelf ook in, en tikt per ongeluk een 6.
  await alsSpeler('ton', [['ton', 0, 6]]);
  check('Ton ziet zijn eigen 6', zietBij('ton', 'ton', 0).getal, 6);
  check('Ton tegen Roy en Sierk → rood',
    zietBij('leiding', 'ton', 0, true).kleur, 'rood');
  check('de wedstrijdleiding ziet het getal van de speler zelf',
    zietBij('leiding', 'ton', 0, true).getal, 6);

  // Hoe het in de database staat: elke invuller een eigen rij.
  check('wat Roy en Sierk bij Ton intikten staat in twee eigen rijen',
    Object.keys(server.ton?.kaartDagen?.['1'] || {}).sort(), ['roy', 'sierk']);
  check('in de oude gedeelde laag wordt niet meer geschreven',
    server.ton?.markerDagen, undefined);

  // ── Een telefoon die achterloopt ────────────────────────────
  console.log('\n══ EEN TELEFOON DIE ACHTERLOOPT ══\n');

  // Roy vult bij Ton holes 2 t/m 5 in. Sierk heeft slecht bereik: zijn telefoon
  // kreeg alleen holes 2 en 3 binnen. Dan tikt Sierk hole 9 in bij Ton.
  await alsSpeler('roy', [['ton', 1, 4], ['ton', 2, 3]]);
  const oudeStand = kopie(server);
  await alsSpeler('roy', [['ton', 3, 5], ['ton', 4, 4]]);
  await alsSpeler('sierk', [['ton', 8, 4]], oudeStand);

  check('de holes die Roy intikte terwijl Sierk achterliep staan er nog',
    [3, 4].map(h => zietBij('leiding', 'ton', h, true).getal), [5, 4]);
  check('en die van daarvoor ook',
    [1, 2].map(h => zietBij('leiding', 'ton', h, true).getal), [4, 3]);
  check('de hole van Sierk is er ook bijgekomen',
    zietBij('leiding', 'ton', 8, true).getal, 4);

  // ── Een melding als opslaan mislukt ─────────────────────────
  console.log('\n══ OPSLAAN MISLUKT ══\n');

  M._meldingen.length = 0;
  M._zetSchrijver(async () => { throw { code: 'permission-denied' }; });
  await alsSpeler('sierk', [['sierk', 0, 5]]);
  check('de speler krijgt te horen dat zijn score niet is opgeslagen',
    M._meldingen.some(t => /niet opgeslagen/.test(t)), true);
  check('met de reden erbij',
    M._meldingen.some(t => /permission-denied/.test(t)), true);
  check('en zijn getal blijft beschermd voor de volgende poging',
    M._leesEigen()['sierk|dagen|1'], { 0: 5 });

  // ── De rij die de deur uitgaat, voor een kaart ──────────────
  console.log('\n══ DE RIJ VAN EEN KAART ══\n');

  M._leegEigen();
  M._zetLive({ a: { kaartDagen: { '1': { b: [4, 5, null], c: [9, 9, 9] } } } });
  M._onthoudEigenInvoer('a', 'kaart:b', 1, 2, 3);
  check('mijn kaart: mijn rij met mijn nieuwe hole erbij',
    M._rijVoorOpslag('a', 'kaart:b', 1, 3), [4, 5, 3]);
  check('de kaart van een ander komt er niet in',
    M._rijVoorOpslag('a', 'kaart:c', 1, 3), [9, 9, 9]);
  check('een verse serverkopie houdt mijn nog niet bevestigde getal, op mijn kaart',
    M._metEigenInvoer('a', { kaartDagen: { '1': { b: [4, 5, null], c: [1, 1, 1] } } }).kaartDagen?.['1'],
    { b: [4, 5, 3], c: [1, 1, 1] });
  check('de lagen lezen de kaarten per invuller, op volgorde',
    Object.keys(M.lagenVanDag({ kaartDagen: { '1': { z: [1], b: [2] } } }, 1).kaarten || {}), ['b', 'z']);
  check('een kaart telt mee in wat er telt',
    M._liveScoresVanDag({ kaartDagen: { '1': { b: [4, 5] } }, dagen: { '1': [null, 6] } }, 1), [4, 6]);
  check('de oude gedeelde laag telt nog mee — een lopend toernooi verliest niets',
    M._liveScoresVanDag({ markerDagen: { '1': [4, 5] } }, 1), [4, 5]);

  // ── De meekijkpagina, met kaarten ───────────────────────────
  console.log('\n══ DE MEEKIJKPAGINA MET KAARTEN ══\n');

  const L = M.meekijk;
  const w = [null, '', 0, 4, 5, '5'];
  let anders = 0;
  for (const sp of w) for (const k1 of w) for (const k2 of w) for (const oud of w) for (const bh of w) {
    const app  = M.scoreOordeel(sp, [k1, k2, oud], bh).tel;
    const live = L.tellendGetal(sp, [k1, k2, oud], bh);
    const gelijk = (app === null || app === undefined) ? (live === null || live === undefined) : app === live;
    if (!gelijk) anders++;
  }
  check(`alle ${w.length ** 5} combinaties met twee kaarten geven hetzelfde getal`, anders, 0);

  const bronMetKaarten = {
    kaartDagen: { '1': { sierk: [null, 7, null], roy: [5, null, null] } },
    markerDagen: { '1': [null, null, 3] },
    dagen: { '1': [null, null, null] },
  };
  L._zetLiveMap({ ton: bronMetKaarten });
  const dagL = { dagNr: 1, holes: [{}, {}, {}], scores: {} };
  check('de meekijkpagina leest de kaarten',
    L.getLiveScoresVoorDag(dagL).ton, [5, 7, 3]);
  check('en komt op dezelfde rij uit als de app',
    L.getLiveScoresVoorDag(dagL).ton, M._liveScoresVanDag(bronMetKaarten, 1));

  M._zetMij(null);
  M._leegEigen();
  M._zetLive({});
  M._zetSchrijver(async () => {});
  return staat;
}

module.exports = blokDoortikken().then(() => blokEigenKaart());
