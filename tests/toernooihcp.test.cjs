// ============================================================
//  Exact & playing handicap per dag — automatische tests (v6.1.0)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  Sierk, 14 oktober 2026: in een toernooi staat de EXACT handicap op het
//  tabblad Spelers en geldt die voor alle dagen; de PLAYING handicap verschilt
//  per baan en dus per dag. De speler bevestigt hem zelf op zijn scorekaart.
//  Drie spelregels:
//    1. wijzigen kan tot de eerste score van die dag op zijn kaart staat;
//    2. de wedstrijdleiding ziet wie nog niet bevestigd heeft;
//    3. een exact handicap die meer dan 2 punten afwijkt geeft een ⚠ tot de
//       indeler "akkoord" geeft.
//  En: de slagen en netto scores van een dag rekenen met de playing handicap
//  van DIE dag. Gaat dat mis, dan klopt de uitslag niet — vandaar deze suite.
//
//  Alles wordt uit de ECHTE code geknipt (tests/harnas.cjs).
// ============================================================
const { laadToernooiKern, laadMarkerKern, maakChecker } = require('./harnas.cjs');
const K = laadToernooiKern();
const L = laadMarkerKern().meekijk;
const { staat, check } = maakChecker();

const holes18 = Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 }));
const dag = (extra = {}) => ({ dagNr: 1, holes: holes18, scores: {}, afgerond: false, ...extra });

// ── Getallen ────────────────────────────────────────────────
console.log('\n══ EEN HANDICAP INTIKKEN ══\n');
check('een komma mag (zo tikt een Nederlandse telefoon)', K._hcpGetal('18,4'), 18.4);
check('een punt ook', K._hcpGetal('18.4'), 18.4);
check('leeg is niets', [K._hcpGetal(''), K._hcpGetal(null), K._hcpGetal(undefined)], [null, null, null]);
check('onzin is niets', K._hcpGetal('abc'), null);
check('een plus-handicap mag', K._hcpGetal('-2,1'), -2.1);
check('op het scherm met een komma', K.hcpTekst(18.4), '18,4');
check('een heel getal zonder ,0', K.hcpTekst(18), '18');
check('afgerond op tienden', K.hcpTekst(18.44), '18,4');

// ── Welke exact handicap geldt ─────────────────────────────
console.log('\n══ WELKE EXACT HANDICAP GELDT ══\n');
const roy = { uid: 'roy', naam: 'Roy', hcp: 16.4, hcpOp: 1000 };
check('zonder bevestiging: wat de indeler heeft staan',
  K.spelerExactHcp(roy, null), { waarde: 16.4, door: 'indeler', indeler: 16.4 });
check('de speler bevestigde later: zijn waarde geldt, voor alle dagen',
  K.spelerExactHcp(roy, { hcpDagen: { '2': { exact: 17.2, playing: 20, op: 2000 } } }).waarde, 17.2);
check('… en dat staat erbij',
  K.spelerExactHcp(roy, { hcpDagen: { '2': { exact: 17.2, playing: 20, op: 2000 } } }).door, 'speler');
check('de indeler paste hem daarna aan: dan geldt de indeler weer',
  K.spelerExactHcp({ ...roy, hcpOp: 3000 }, { hcpDagen: { '2': { exact: 17.2, playing: 20, op: 2000 } } }).waarde, 16.4);
check('meer bevestigingen: de laatste telt, welke dag ook',
  K.spelerExactHcp(roy, { hcpDagen: {
    '1': { exact: 17.0, playing: 20, op: 2000 },
    '2': { exact: 15.9, playing: 18, op: 5000 },
    '3': { exact: 18.8, playing: 22, op: 4000 } } }).waarde, 15.9);
check('een speler zonder handicap valt niet om',
  K.spelerExactHcp({ uid: 'x', naam: 'X' }, null).waarde, null);

// ── Spelregel 3: de ⚠ ──────────────────────────────────────
console.log('\n══ SPELREGEL 3 — MEER DAN 2 PUNTEN ══\n');
const bev = (exact, op = 2000) => ({ hcpDagen: { '1': { exact, playing: 20, op } } });
check('precies 2 punten is GEEN waarschuwing (18,4 − 16,4 is in een computer 2,0000000000000018)',
  K.hcpWaarschuwing(roy, bev(18.4)), null);
check('2,1 punten wel',
  K.hcpWaarschuwing(roy, bev(18.5)), { oud: 16.4, nieuw: 18.5, verschil: 2.1 });
check('naar beneden telt ook',
  K.hcpWaarschuwing(roy, bev(14.0)), { oud: 16.4, nieuw: 14, verschil: 2.4 });
check('binnen de 2: geen waarschuwing, de waarde geldt gewoon',
  [K.hcpWaarschuwing(roy, bev(17.5)), K.spelerExactHcp(roy, bev(17.5)).waarde], [null, 17.5]);
check('na "akkoord" (de indeler nam hem over) is hij weg',
  K.hcpWaarschuwing({ ...roy, hcp: 18.5, hcpOp: 3000 }, bev(18.5)), null);
check('vulde de indeler na de speler zelf iets in, dan ook geen waarschuwing',
  K.hcpWaarschuwing({ ...roy, hcpOp: 3000 }, bev(25)), null);

// ── Welke playing handicap geldt ───────────────────────────
console.log('\n══ WELKE PLAYING HANDICAP GELDT ══\n');
check('niemand vulde iets in: de exact handicap, en niet bevestigd (spelregel 2)',
  K.spelerPlayingHcp(roy, dag(), null), { waarde: 16.4, door: 'exact', bevestigd: false });
check('de speler bevestigde voor deze dag',
  K.spelerPlayingHcp(roy, dag(), bev(17.0)), { waarde: 20, door: 'speler', bevestigd: true });
check('een bevestiging voor een ANDERE dag telt niet als playing voor vandaag',
  K.spelerPlayingHcp(roy, dag({ dagNr: 2 }), bev(17.0)).door, 'exact');
check('… maar zijn exact handicap van die dag wel',
  K.spelerPlayingHcp(roy, dag({ dagNr: 2 }), bev(17.0)).waarde, 17);
check('de indeler vulde hem in de flightindeling in',
  K.spelerPlayingHcp(roy, dag({ playingHcp: { roy: { waarde: 19, op: 3000, door: 'indeler' } } }), null),
  { waarde: 19, door: 'indeler', bevestigd: true });
check('allebei: het nieuwste wint — hier de indeler',
  K.spelerPlayingHcp(roy, dag({ playingHcp: { roy: { waarde: 19, op: 3000, door: 'indeler' } } }), bev(17)).waarde, 19);
check('allebei: het nieuwste wint — hier de speler',
  K.spelerPlayingHcp(roy, dag({ playingHcp: { roy: { waarde: 19, op: 1500, door: 'indeler' } } }), bev(17)).waarde, 20);

// Een afgesloten dag is bevroren.
const vast = dag({ afgerond: true, playingHcp: { roy: { waarde: 21, op: 9000, door: 'speler' } } });
check('afgesloten: de vastgelegde waarde, ook als de speler daarna iets anders opgaf',
  K.spelerPlayingHcp(roy, vast, { hcpDagen: { '1': { exact: 30, playing: 35, op: 99999 } } }).waarde, 21);
check('afgesloten vóór v6.1.0 (niets vastgelegd): precies zoals het toen rekende',
  K.spelerPlayingHcp(roy, dag({ afgerond: true }), { hcpDagen: { '2': { exact: 30, playing: 35, op: 99999 } } }).waarde, 16.4);
// Afgesloten en weer heropend: een bevroren "exact" is geen keuze van de indeler.
check('heropend: een bevroren "exact" telt niet als ingevuld',
  K.spelerPlayingHcp(roy, dag({ playingHcp: { roy: { waarde: 16.4, op: 9000, door: 'exact' } } }),
    { hcpDagen: { '2': { exact: 15, playing: 18, op: 5000 } } }), { waarde: 15, door: 'exact', bevestigd: false });

// ── Spelregel 1: tot de eerste score ───────────────────────
console.log('\n══ SPELREGEL 1 — TOT DE EERSTE SCORE ══\n');
check('nog geen score: mag wijzigen', K.hcpWijzigbaar(dag(), 'roy', null), true);
check('alleen een bevestigde handicap is geen score', K.hcpWijzigbaar(dag(), 'roy', bev(17)), true);
check('zelf een score ingetikt: niet meer',
  K.hcpWijzigbaar(dag(), 'roy', { dagen: { '1': [5, null] } }), false);
check('een flightgenoot tikte zijn eerste score in (eigen kaart): ook niet meer',
  K.hcpWijzigbaar(dag(), 'roy', { kaartDagen: { '1': { ton: [null, 4] } } }), false);
check('de wedstrijdleiding tikte iets in: ook niet meer',
  K.hcpWijzigbaar(dag(), 'roy', { beheerDagen: { '1': [5] } }), false);
check('een score van een ANDERE dag telt niet',
  K.hcpWijzigbaar(dag(), 'roy', { dagen: { '2': [5] } }), true);
check('een afgesloten dag: niet meer', K.hcpWijzigbaar(dag({ afgerond: true }), 'roy', null), false);
check('scores in het toernooidocument (heropende dag) tellen ook',
  K.hcpWijzigbaar(dag({ scores: { roy: [null, 6] } }), 'roy', null), false);
check('een bevestigde handicap maakt het toernooi niet "met scores"',
  (() => { K._zetLive({ roy: bev(17) }); const r = K.heeftGeenScores({ spelers: [roy], dagen: [dag()] }); K._zetLive({}); return r; })(), true);

// ── De slagen rekenen met de playing handicap van de dag ───
console.log('\n══ DE SLAGEN GAAN OP DE PLAYING HANDICAP ══\n');
//  Roy exact 10, Ton exact 20, 100%. Op hole 11 (SI 11) maken ze allebei 4.
//  Met de exact handicaps krijgt Ton 10 slagen (SI 1-10): hole 11 is gelijk.
//  Met playing 12 en 25 krijgt Ton 13 slagen (SI 1-13): Ton wint hole 11.
const R = { uid: 'roy', naam: 'Roy', hcp: 10 };
const T = { uid: 'ton', naam: 'Ton', hcp: 20 };
const tMP = { spelers: [R, T], hcpPct: 1, ptWin: 2, ptTie: 1, ptLoss: 0, dagen: [] };
const scores = { roy: Array(18).fill(null), ton: Array(18).fill(null) };
scores.roy[10] = 4; scores.ton[10] = 4;
K._zetLive({});
check('zonder bevestiging: de exact handicaps (zoals altijd) → gelijk',
  K.berekenTPuntenVoorDag(tMP, dag({ scores })).matrix[0][1], 'T');
K._zetLive({ roy: { hcpDagen: { '1': { exact: 10, playing: 12, op: 5 } } },
             ton: { hcpDagen: { '1': { exact: 20, playing: 25, op: 5 } } } });
check('met de bevestigde playing handicaps → Ton wint de hole',
  K.berekenTPuntenVoorDag(tMP, dag({ scores })).matrix[0][1], 'L');
check('de spelers van het toernooi zelf blijven onaangeroerd',
  [R.hcp, T.hcp], [10, 20]);
check('spelersVoorDag houdt de volgorde van het toernooi aan',
  K.spelersVoorDag(tMP, dag()).map(s => [s.uid, s.hcp]), [['roy', 12], ['ton', 25]]);
check('een andere dag rekent met zijn eigen playing handicap (hier niets → exact)',
  K.spelersVoorDag(tMP, dag({ dagNr: 2 })).map(s => s.hcp), [10, 20]);
check('de indeler vulde het in de flightindeling in: ook dat telt',
  (() => { K._zetLive({}); return K.berekenTPuntenVoorDag(tMP,
    dag({ scores, playingHcp: { roy: { waarde: 12, op: 5, door: 'indeler' }, ton: { waarde: 25, op: 5, door: 'indeler' } } })).matrix[0][1]; })(),
  'L');

// Strokeplay: netto met de playing handicap.
K._zetLive({ roy: { hcpDagen: { '1': { exact: 10, playing: 18, op: 5 } } } });
const spScores = { roy: Array(18).fill(5), ton: Array(18).fill(null) };
const sp1 = K.berekenStrokeplayRanglijstVoorDag(tMP, dag({ scores: spScores }));
check('strokeplay: 90 bruto met playing 18 is 72 netto (niet 80 met exact 10)', sp1[0].netto, 72);
check('… en de rij hoort nog bij dezelfde speler', sp1[0].s.uid, 'roy');

// Indelen op handicap kijkt naar de exact handicap die NU geldt.
K._zetLive({ ton: { hcpDagen: { '1': { exact: 4.5, playing: 6, op: 5 } } } });
check('indelen op handicap gebruikt de bijgewerkte exact handicap van de speler',
  K.verdeelOpHandicapBanden([R, T], 2).map(f => f.map(s => s.uid)), [['ton'], ['roy']]);
K._zetLive({});

// ── De meekijkpagina rekent dezelfde playing handicap uit ──
console.log('\n══ DE MEEKIJKPAGINA NAAST DE APP ══\n');
const spelersProef = [
  { uid: 'a', hcp: 16.4, hcpOp: 1000 }, { uid: 'b', hcp: '12,3' }, { uid: 'c' }, { uid: 'd', hcp: 30, hcpOp: 99999 },
];
const livesProef = [
  null, {}, bev(17.2), bev(14, 500), { hcpDagen: { '1': { exact: 20, playing: '', op: 3000 } } },
  { hcpDagen: { '2': { exact: 22, playing: 25, op: 4000 } } },
];
const dagenProef = [
  dag(), dag({ dagNr: 2 }), dag({ afgerond: true }),
  dag({ playingHcp: { a: { waarde: 19, op: 2500, door: 'indeler' }, b: { waarde: 15, op: 1, door: 'indeler' } } }),
  dag({ playingHcp: { a: { waarde: 18, op: 9000, door: 'exact' } } }),
  dag({ afgerond: true, playingHcp: { a: { waarde: 21, op: 9000, door: 'speler' } } }),
];
let anders = 0;
for (const s of spelersProef) for (const live of livesProef) for (const d of dagenProef) {
  if (K.spelerPlayingHcp(s, d, live).waarde !== L.playingHcpLive(s, d, live)) anders++;
}
check(`alle ${spelersProef.length * livesProef.length * dagenProef.length} combinaties geven dezelfde playing handicap`, anders, 0);

module.exports = staat;
