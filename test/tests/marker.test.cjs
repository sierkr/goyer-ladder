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

// ── Blok 6: doortikken terwijl de server nog niet heeft geantwoord ──
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

module.exports = blokDoortikken();
