// ============================================================
//  Toernooi — automatische tests
// ============================================================
const { laadToernooiKern, maakChecker } = require('./harnas.cjs');
const K = laadToernooiKern();
const { staat, check } = maakChecker();
const holes18 = Array.from({length:18},(_,i)=>({par:4, si:i+1}));
const sp = (uid,hcp)=>({uid, naam:uid, hcp});
const maakT = (spelers, extra={}) => ({
  spelers, hcpPct:1, ptWin:2, ptTie:1, ptLoss:0, actiefDagNr:1, dagen:[], ...extra
});
const maakDag = (dagNr, scores, holes=holes18) => ({dagNr, holes, scores, afgerond:false});

console.log('\n══ TOERNOOI — HANDICAPSLAGEN ══');
check('gelijke hcp -> 0 slagen',
  K.getTHcpSlagen(sp('a',10), sp('b',10), {si:1}, 1).slagOpHole, 0);
check('diff 5, SI 1 -> 1 slag',
  K.getTHcpSlagen(sp('a',5), sp('b',10), {si:1}, 1).slagOpHole, 1);
check('diff 5, SI 6 -> 0 slagen',
  K.getTHcpSlagen(sp('a',5), sp('b',10), {si:6}, 1).slagOpHole, 0);
check('diff 24, SI 1 -> 2 slagen',
  K.getTHcpSlagen(sp('a',0), sp('b',24), {si:1}, 1).slagOpHole, 2);
check('diff 24, SI 10 -> 1 slag',
  K.getTHcpSlagen(sp('a',0), sp('b',24), {si:10}, 1).slagOpHole, 1);
check('ontvanger is de hoogste hcp',
  K.getTHcpSlagen(sp('a',5), sp('b',20), {si:1}, 1).ontvanger.uid, 'b');
check('hcpPct 0.75 halveert het verschil',
  K.getTHcpSlagen(sp('a',0), sp('b',8), {si:6}, 0.75).diff, 6);

console.log('\n══ TOERNOOI — MATCHPLAY PUNTEN ══');
const A=sp('a',10), B=sp('b',10);
let t = maakT([A,B]);
check('geen scores -> geen punten',
  K.berekenTPuntenVoorDag(t, maakDag(1,{})).punten, [0,0]);
check('geen scores -> matrix leeg',
  K.berekenTPuntenVoorDag(t, maakDag(1,{})).matrix[0][1], null);

let d = maakDag(1,{a:[3,...Array(17).fill(null)], b:[5,...Array(17).fill(null)]});
let r = K.berekenTPuntenVoorDag(t, d);
check('a wint 1 hole -> 2-0 punten', r.punten, [2,0]);
check('a wint -> W/L in matrix', [r.matrix[0][1], r.matrix[1][0]], ['W','L']);
check('a wint -> marge +1 / -1', [r.standen[0][1], r.standen[1][0]], [1,-1]);
check('gewonnen/verloren geteld', [r.won, r.lost], [[1,0],[0,1]]);

d = maakDag(1,{a:[4,4,...Array(16).fill(null)], b:[5,3,...Array(16).fill(null)]});
r = K.berekenTPuntenVoorDag(t, d);
check('gelijkspel -> 1-1 punten', r.punten, [1,1]);
check('gelijkspel -> T in matrix', r.matrix[0][1], 'T');
check('gelijkspel -> marge 0', r.standen[0][1], 0);
check('tied geteld', r.tied, [1,1]);

// ============================================================
//  v5.13.0 — DE INSTELLINGEN STAAN PER DAG
// ------------------------------------------------------------
//  Sierk wilde per dag kunnen kiezen: een dag met 2/0/-2 en een dag met 3/1/0
//  in hetzelfde toernooi. Waar het om gaat is de TERUGVAL: een toernooi van
//  vóór v5.13.0 heeft die velden niet op de dag staan en moet daardoor exact
//  blijven rekenen zoals het altijd deed. Er draaien toernooien.
// ============================================================
console.log('\n══ TOERNOOI — INSTELLINGEN PER DAG ══');

const P = sp('p', 10), Q = sp('q', 10);
// Toernooibreed: 2 voor winst, 1 gelijk, 0 verlies.
const tPd = maakT([P, Q]);
const pWint = { p: [3, ...Array(17).fill(null)], q: [5, ...Array(17).fill(null)] };
const gelijk = { p: [4, 4, ...Array(16).fill(null)], q: [5, 3, ...Array(16).fill(null)] };

// ── 1. Zonder dagvelden: precies als vroeger ────────────────────────────────
check('geen dagvelden -> toernooibrede punten (winst)',
  K.berekenTPuntenVoorDag(tPd, maakDag(1, pWint)).punten, [2, 0]);
check('geen dagvelden -> toernooibrede punten (gelijk)',
  K.berekenTPuntenVoorDag(tPd, maakDag(1, gelijk)).punten, [1, 1]);

// ── 2. Mét dagvelden: de dag wint van het toernooi ──────────────────────────
const dagAnders = { ...maakDag(1, pWint), ptWin: 3, ptTie: 1, ptLoss: -1 };
check('dagpunten gaan voor op de toernooipunten',
  K.berekenTPuntenVoorDag(tPd, dagAnders).punten, [3, -1]);
const dagGelijk = { ...maakDag(1, gelijk), ptWin: 3, ptTie: 5, ptLoss: -1 };
check('dagpunten gelden ook bij gelijkspel',
  K.berekenTPuntenVoorDag(tPd, dagGelijk).punten, [5, 5]);

// ── 3. Twee dagen, verschillende punten, één toernooi ───────────────────────
//  Dit is wat Sierk vroeg. Dag 1 op de toernooistandaard, dag 2 met een eigen
//  telling — dezelfde spelers, dezelfde scores, een andere uitkomst.
const dag1 = maakDag(1, pWint);
const dag2 = { ...maakDag(2, pWint), ptWin: 10, ptLoss: -10 };
check('dag 1 telt op de toernooistandaard',
  K.berekenTPuntenVoorDag(tPd, dag1).punten, [2, 0]);
check('dag 2 telt op zijn eigen standaard',
  K.berekenTPuntenVoorDag(tPd, dag2).punten, [10, -10]);

// ── 4. Nul is een geldige keuze, geen "niet ingevuld" ───────────────────────
//  ⚠ Hierom staat er `??`-achtige logica in dagInstelling() en geen `||`:
//  met `||` zou 0 als leeg gelezen worden en zou de toernooiwaarde terugkomen.
const dagNul = { ...maakDag(1, pWint), ptWin: 0, ptLoss: 0 };
check('0 punten voor winst is een echte keuze, geen terugval',
  K.berekenTPuntenVoorDag(tPd, dagNul).punten, [0, 0]);
const dagTieNul = { ...maakDag(1, gelijk), ptTie: 0 };
check('0 punten voor gelijkspel is een echte keuze',
  K.berekenTPuntenVoorDag(tPd, dagTieNul).punten, [0, 0]);

// ── 5. De handicapverrekening per dag ───────────────────────────────────────
//  R en S schelen 8 slagen. Op SI 6 krijgt S bij 100% wél een slag (8 >= 6) en
//  bij 50% niet (afgerond 4 < 6). Zelfde scores, andere winnaar.
const R = sp('r', 0), S2 = sp('s', 8);
const tHcp = maakT([R, S2], { hcpPct: 1 });
const holesSi6 = [{ par: 4, si: 6 }, ...holes18.slice(1)];
const scoresGelijk = { r: [4, ...Array(17).fill(null)], s: [5, ...Array(17).fill(null)] };

check('100% toernooibreed: s krijgt een slag en het is gelijk',
  K.berekenTPuntenVoorDag(tHcp, maakDag(1, scoresGelijk, holesSi6)).punten, [1, 1]);
const dagHalf = { ...maakDag(1, scoresGelijk, holesSi6), hcpPct: 0.5 };
check('50% op de dag: geen slag, dus r wint',
  K.berekenTPuntenVoorDag(tHcp, dagHalf).punten, [2, 0]);

// ── 6. Een dag zonder velden naast een dag mét velden ───────────────────────
check('de ene dag beïnvloedt de andere niet',
  [K.berekenTPuntenVoorDag(tHcp, maakDag(1, scoresGelijk, holesSi6)).punten,
   K.berekenTPuntenVoorDag(tHcp, dagHalf).punten], [[1, 1], [2, 0]]);

// ============================================================
//  v5.14.0 — DE LEVENSLOOP VAN EEN DAG
// ------------------------------------------------------------
//  concept -> gestart -> afgesloten, en terug kan altijd. De grens voor
//  wijzigen en verwijderen is nu een KNOP en niet meer de bijwerking "er staat
//  een score".
// ============================================================
// ============================================================
//  v5.15.0 — PUNTEN PER PLAATS BIJ EEN STROKEPLAY-DAG
// ------------------------------------------------------------
//  Sierk: "Optie tabel voor strokeplay. Standaard zoals nu met optie om elke
//  plek in te stellen." De negen tests hierboven op dagPuntenUitSleutels()
//  roepen hem ZONDER tabel aan; die bewijzen dus dat de standaard niet wijzigt.
// ============================================================
// ============================================================
//  v5.16.0 — VIJF MANIEREN OM IN TE DELEN
// ------------------------------------------------------------
//  Elke manier moet aan twee dingen voldoen, wat hij verder ook doet:
//  iedereen precies één keer ingedeeld, en flights schelen hooguit één speler.
//  Dat wordt hieronder voor alle vijf apart gecontroleerd — een indeling die
//  iemand kwijtraakt of een flight van zes tegenover twee maakt, is stuk.
// ============================================================
console.log('\n══ TOERNOOI — INDELEN OVER FLIGHTS ══');

const spelersMet = (paren) => paren.map(([uid, hcp]) => ({ uid, naam: uid, hcp }));
const negen = spelersMet([['a',1],['b',2],['c',3],['d',4],['e',5],['f',6],['g',7],['h',8],['i',9]]);

// ── de maatverdeling ────────────────────────────────────────────────────────
check('9 over 4 flights -> 3,2,2,2', K.flightGroottes(9, 4), [3, 2, 2, 2]);
check('8 over 4 flights -> 2,2,2,2', K.flightGroottes(8, 4), [2, 2, 2, 2]);
check('2 over 4 flights -> 1,1,0,0', K.flightGroottes(2, 4), [1, 1, 0, 0]);
check('geen flights -> niets', K.flightGroottes(9, 0), []);

// ── de eis die voor alle vijf geldt ─────────────────────────────────────────
const alleManieren = {
  'om de beurt':        (sp, n) => K.verdeelOmBeurten(sp, n),
  'willekeurig':        (sp, n) => K.verdeelWillekeurig(sp, n, () => 0.42),
  'op stand':           (sp, n) => K.verdeelOpStand(sp, n, ['e','c','a','g','i','b','d','f','h']),
  'handicapbanden':     (sp, n) => K.verdeelOpHandicapBanden(sp, n),
  'flighthandicap':     (sp, n) => K.verdeelOpFlightHandicap(sp, n),
  'nieuwe tegenstanders': (sp, n) => K.verdeelNieuweTegenstanders(sp, n, [[['a','b','c'],['d','e','f'],['g','h','i']]]),
};
for (const [naam, fn] of Object.entries(alleManieren)) {
  const uit = fn(negen, 4);
  const platgeslagen = uit.flat().map(x => x.uid).sort();
  check(`${naam}: iedereen precies één keer`, platgeslagen,
    ['a','b','c','d','e','f','g','h','i']);
  const maten = uit.map(f => f.length).sort((x, y) => x - y);
  check(`${naam}: flights schelen hooguit één speler`,
    maten[maten.length - 1] - maten[0] <= 1, true);
}

// ── het eigen kenmerk van elke manier ───────────────────────────────────────
check('om de beurt: a,e,i in flight 1',
  K.verdeelOmBeurten(negen, 4)[0].map(x => x.uid), ['a', 'e', 'i']);

//  Op stand met volgorde best->slecht: de BESTEN horen in de LAATSTE flight,
//  want die gaat het laatst weg. Volgorde hier: e is de beste, h de slechtste.
const opStand = K.verdeelOpStand(negen, 3, ['e','c','a','g','i','b','d','f','h']);
check('op stand: de beste zit in de laatste flight',
  opStand[opStand.length - 1].some(x => x.uid === 'e'), true);
check('op stand: de slechtste zit in de eerste flight',
  opStand[0].some(x => x.uid === 'h'), true);

//  Handicapbanden: de drie laagste handicaps bij elkaar in flight 1.
check('handicapbanden: de laagste handicaps samen',
  K.verdeelOpHandicapBanden(negen, 3)[0].map(x => x.uid), ['a', 'b', 'c']);

//  Flighthandicap: juist spreiden. Met 9 spelers (hcp 1..9) over 3 flights
//  liggen de gemiddelden dicht bij elkaar; bij banden is het verschil 3.
const gem = (f) => f.reduce((n, x) => n + x.hcp, 0) / f.length;
const gespreid = K.verdeelOpFlightHandicap(negen, 3).map(gem);
const gebandeerd = K.verdeelOpHandicapBanden(negen, 3).map(gem);
check('flighthandicap: de gemiddelden liggen dicht bij elkaar',
  Math.max(...gespreid) - Math.min(...gespreid) <= 1, true);
check('en dat is aantoonbaar beter gespreid dan banden',
  (Math.max(...gespreid) - Math.min(...gespreid)) < (Math.max(...gebandeerd) - Math.min(...gebandeerd)), true);

// ── nog niet met elkaar gespeeld ────────────────────────────────────────────
//  Zes spelers, drie flights van twee. Dag 1 was a-b, c-d, e-f. Er is ruimte
//  genoeg voor een indeling zonder herhaling, dus die hoort eruit te komen.
const zes = spelersMet([['a',1],['b',2],['c',3],['d',4],['e',5],['f',6]]);
const indelingDag1 = [[['a','b'], ['c','d'], ['e','f']]];
const nieuw2 = K.verdeelNieuweTegenstanders(zes, 3, indelingDag1);
const paren = nieuw2.map(f => f.map(x => x.uid).sort().join('-'));
check('geen enkel paar van dag 1 komt terug',
  paren.some(p => ['a-b', 'c-d', 'e-f'].includes(p)), false);

//  ⚠ En als het NIET kan: twee flights van drie, terwijl dag 1 dezelfde twee
//  drietallen had. Elke indeling levert herhalingen op. De functie moet dan
//  niet omvallen en zo min mogelijk herhalen — niet toveren.
const dag1Zelfde = [[['a','b','c'], ['d','e','f']]];
const krap = K.verdeelNieuweTegenstanders(zes, 2, dag1Zelfde);
check('bij een onmogelijke opgave valt hij niet om',
  krap.flat().map(x => x.uid).sort(), ['a','b','c','d','e','f']);
check('en houdt hij de flights netjes op maat',
  krap.map(f => f.length), [3, 3]);

// ── randgevallen ────────────────────────────────────────────────────────────
check('geen spelers levert lege flights', K.verdeelOmBeurten([], 3).map(f => f.length), [0, 0, 0]);
check('meer flights dan spelers laat flights leeg',
  K.verdeelOpHandicapBanden(spelersMet([['a',1],['b',2]]), 4).map(f => f.length), [1, 1, 0, 0]);
check('zonder eerdere dagen deelt "nieuw" gewoon in',
  K.verdeelNieuweTegenstanders(zes, 3, []).flat().length, 6);

console.log('\n══ TOERNOOI — PUNTEN PER PLAATS ══');

// ── de tekst uitlezen ───────────────────────────────────────────────────────
check('"10, 7, 5, 3, 1" wordt een lijst',
  K.plaatsPuntenUitTekst('10, 7, 5, 3, 1'), [10, 7, 5, 3, 1]);
check('spaties en puntkomma mogen ook',
  K.plaatsPuntenUitTekst('10 7;5'), [10, 7, 5]);
check('negatieve punten mogen — een laatste plek mag punten kosten',
  K.plaatsPuntenUitTekst('5, 2, 0, -2'), [5, 2, 0, -2]);
check('leeg levert niets op (en dus de standaard)', K.plaatsPuntenUitTekst(''), null);
check('onzin levert niets op', K.plaatsPuntenUitTekst('abc'), null);
check('niets levert niets op', K.plaatsPuntenUitTekst(null), null);
check('een lijst mag er ook zo in', K.plaatsPuntenUitTekst([9, 6, 3]), [9, 6, 3]);

// ── de telling met tabel ────────────────────────────────────────────────────
//  Vier spelers, sleutels -10..-4 (lager = beter na het omdraaien in dagPunten).
const vier = [-10, -8, -6, -4];
check('zonder tabel: de aflopende reeks, ongewijzigd',
  K.dagPuntenUitSleutels(vier), [4, 3, 2, 1]);
check('met tabel: precies wat er in de tabel staat',
  K.dagPuntenUitSleutels(vier, [10, 7, 5, 3]), [10, 7, 5, 3]);

//  ⚠ Voorbij de tabel is het 0 en niet "doortellen". Wie 10,7,5 invult bedoelt
//  dat plek 4 niets oplevert; doortellen zou daar stilletjes punten van maken.
check('voorbij de tabel levert een plek 0 op',
  K.dagPuntenUitSleutels(vier, [10, 7, 5]), [10, 7, 5, 0]);
check('een tabel langer dan het veld stoort niet',
  K.dagPuntenUitSleutels(vier, [10, 7, 5, 3, 1, 0]), [10, 7, 5, 3]);

// ── gedeelde plekken ────────────────────────────────────────────────────────
//  Twee gedeelde eersten krijgen het gemiddelde van plek 1 en 2: (10+6)/2 = 8.
check('gedeelde eerste plek deelt plek 1 en 2',
  K.dagPuntenUitSleutels([-10, -10, -6, -4], [10, 6, 4, 2]), [8, 8, 4, 2]);
//  En op de rand van de tabel: plek 3 is 4, plek 4 bestaat niet meer -> 0.
check('gedeelde plek op de rand van de tabel middelt met 0',
  K.dagPuntenUitSleutels([-10, -6, -6], [9, 5, 3]), [9, 4, 4]);

// ── wie krijgt de tabel wel en niet ─────────────────────────────────────────
const R1 = sp('r1', 10), R2 = sp('r2', 10);
const scoresR = { r1: [3, ...Array(17).fill(null)], r2: [5, ...Array(17).fill(null)] };
const tTab = maakT([R1, R2]);

//  Een MATCHPLAY-dag negeert de tabel: daar bepalen winst/gelijk/verlies de
//  volgorde, en de plaatspunten blijven de standaardreeks (2 spelers -> 2 en 1).
check('een matchplay-dag negeert de puntentabel',
  K.dagPunten(tTab, { ...maakDag(1, scoresR), plaatsPunten: '50, 40' }), [2, 1]);

//  Een STROKEPLAY-dag volgt hem wel.
const dagStroke = { ...maakDag(1, scoresR), modus: 'strokeplay', plaatsPunten: '50, 40' };
check('een strokeplay-dag volgt de puntentabel',
  K.dagPunten(tTab, dagStroke), [50, 40]);
check('een strokeplay-dag zonder tabel blijft de standaardreeks',
  K.dagPunten(tTab, { ...maakDag(1, scoresR), modus: 'strokeplay' }), [2, 1]);

console.log('\n══ TOERNOOI — DE TOESTAND VAN EEN DAG ══');

check('een verse dag is concept',
  K.dagIsGestart({ dagNr: 1 }), false);
check('gestart:true is gestart',
  K.dagIsGestart({ dagNr: 1, gestart: true }), true);
check('gestart:false is concept',
  K.dagIsGestart({ dagNr: 1, gestart: false }), false);

//  ⚠ Een afgesloten dag geldt ALTIJD als gestart. Zonder deze regel zou een dag
//  die al is afgerekend als "concept" op het scherm komen — een onzintoestand
//  waarin de coordinator de baan van een uitgespeelde dag kan wijzigen.
check('een afgesloten dag geldt als gestart',
  K.dagIsGestart({ dagNr: 1, afgerond: true }), true);
check('afgesloten wint van gestart:false',
  K.dagIsGestart({ dagNr: 1, gestart: false, afgerond: true }), true);

//  ⚠ Scores maken een dag NIET gestart. Dat is precies het verschil met
//  v5.13.1: daar was `dagHeeftScores()` de grens. Nu kun je een dag met scores
//  terugzetten naar concept en hem alsnog wijzigen.
check('scores alleen maken een dag niet gestart',
  K.dagIsGestart({ dagNr: 1, scores: { a: [4, 5, 3] } }), false);
check('scores plus gestart:false blijft concept',
  K.dagIsGestart({ dagNr: 1, gestart: false, scores: { a: [4, 5, 3] } }), false);

check('geen dag -> niet gestart', K.dagIsGestart(null), false);
check('undefined -> niet gestart', K.dagIsGestart(undefined), false);

console.log('\n══ TOERNOOI — HANDICAP IN DE UITSLAG ══');
const C=sp('c',0), D=sp('d',5);
t = maakT([C,D]);
// SI 18 ligt buiten het slagbereik bij verschil 5 -> geen slag
d = maakDag(1,{c:[4,...Array(17).fill(null)], d:[5,...Array(17).fill(null)]}, [{par:4,si:18},...holes18.slice(1)]);
check('zonder slag (SI 18, verschil 5) wint c',
  K.berekenTPuntenVoorDag(t, d).punten, [2,0]);
// SI 5 ligt er net binnen -> wel een slag, dus gelijkspel
d = maakDag(1,{c:[4,...Array(17).fill(null)], d:[5,...Array(17).fill(null)]}, [{par:4,si:5},...holes18.slice(1)]);
check('met slag (SI 5, verschil 5) is het gelijk',
  K.berekenTPuntenVoorDag(t, d).punten, [1,1]);
d = maakDag(1,{c:[4,...Array(17).fill(null)], d:[5,...Array(17).fill(null)]}, [{par:4,si:1},...holes18.slice(1)]);
check('met slag op SI 1 is het gelijk',
  K.berekenTPuntenVoorDag(t, d).punten, [1,1]);

// KERNCONTROLE: uitslag moet dezelfde slagen gebruiken als het scherm toont
console.log('\n══ TOERNOOI — GROOT HCP-VERSCHIL (>18) ══');
const E=sp('e',0), F=sp('f',24);
t = maakT([E,F]);
const holeSI1 = [{par:4,si:1}, ...holes18.slice(1)];
d = maakDag(1,{e:[4,...Array(17).fill(null)], f:[6,...Array(17).fill(null)]}, holeSI1);
const slagenVolgensScherm = K.getTHcpSlagen(E, F, {si:1}, 1).slagOpHole;
const uitslag = K.berekenTPuntenVoorDag(t, d);
// f krijgt volgens het scherm 2 slagen op SI 1: netto 6-2=4 = gelijkspel
check(`SI 1 bij verschil 24: scherm geeft ${slagenVolgensScherm} slagen, uitslag moet gelijkspel zijn`,
  uitslag.punten, [1,1]);

console.log('\n══ TOERNOOI — TOTAAL OVER MEERDERE DAGEN ══');
t = maakT([A,B]);
t.dagen = [
  maakDag(1,{a:[3,...Array(17).fill(null)], b:[5,...Array(17).fill(null)]}),
  maakDag(2,{a:[5,...Array(17).fill(null)], b:[3,...Array(17).fill(null)]}),
];
K._zetToernooi(t); K._zetWindow('_ranglijstDagNr', 0);
r = K.berekenTPunten(0);
check('twee dagen, elk een winst -> 2-2', r.punten, [2,2]);
check('totaal matrix: wisselend -> M', r.matrix[0][1], 'M');
check('totaal marge saldeert naar 0', r.standen[0][1], 0);
r = K.berekenTPunten(1);
check('dag 1 apart -> 2-0', r.punten, [2,0]);
r = K.berekenTPunten(2);
check('dag 2 apart -> 0-2', r.punten, [0,2]);

console.log('\n══ TOERNOOI — STROKEPLAY ══');
const G=sp('g',0);
t = maakT([G]);
d = maakDag(1,{g:[4,5,3,...Array(15).fill(null)]});
let s = K.berekenStrokeplayRanglijstVoorDag(t, d)[0];
check('3 holes gespeeld', s.holes, 3);
check('brutto 4+5+3', s.brutto, 12);
check('hcp 0 -> netto = brutto', s.netto, 12);
check('stableford par/bogey/birdie = 2+1+3', s.stableford, 6);
t = maakT([sp('h',18)]);
d = maakDag(1,{h:[5,...Array(17).fill(null)]}, [{par:4,si:1},...holes18.slice(1)]);
s = K.berekenStrokeplayRanglijstVoorDag(t, d)[0];
check('hcp 18 op SI 1 -> 1 slag, netto 4', s.netto, 4);
check('hcp 18 op SI 1 -> stableford 2', s.stableford, 2);

console.log('\n══ TOERNOOI — DAGSELECTIE ══');
t = maakT([A], {dagen:[maakDag(1,{}), maakDag(2,{})], actiefDagNr:2});
K._zetToernooi(t);
K._zetWindow('_bekijkDagNr', undefined);
check('actieveDag volgt actiefDagNr', K.actieveDag(t).dagNr, 2);
K._zetWindow('_bekijkDagNr', 1);
check('bekijkDagNr heeft voorrang', K.actieveDag(t).dagNr, 1);
K._zetWindow('_bekijkDagNr', 99);
check('onbestaande dag valt terug op actiefDagNr', K.actieveDag(t).dagNr, 2);
K._zetWindow('_bekijkDagNr', undefined);
check('getDag 1-based', K.getDag(t,1).dagNr, 1);
check('getDag buiten bereik -> null', K.getDag(t,5), null);

console.log('\n══ TOERNOOI — SCORESTATUS ══');
K._zetLive({});
t = maakT([A,B], {dagen:[maakDag(1,{a:[null,null], b:[null,null]})]});
check('geen scores -> true', K.heeftGeenScores(t), true);
t = maakT([A,B], {dagen:[maakDag(1,{a:[3,null], b:[null,null]})]});
check('een score -> false', K.heeftGeenScores(t), false);
K._zetLive({a:{dagNr:1, scores:[4,null]}});
t = maakT([A,B], {dagen:[maakDag(1,{a:[null,null], b:[null,null]})]});
check('alleen live-scores -> false', K.heeftGeenScores(t), false);
K._zetLive({});
t = maakT([A,B], {dagen:[{dagNr:1, holes:holes18, scores:{}, afgerond:true}]});
check('afgeronde dag -> false', K.heeftGeenScores(t), false);

const holes2 = [{par:4,si:1},{par:4,si:2}];
t = maakT([A,B], {dagen:[maakDag(1,{a:[3,4], b:[4,4]}, holes2)]});
K._zetToernooi(t); K._zetWindow('_bekijkDagNr', undefined);
check('alle scores ingevuld', K.alleScoresIngevuld(t, t.dagen[0]), true);
t = maakT([A,B], {dagen:[maakDag(1,{a:[3,null], b:[4,4]}, holes2)]});
check('een gat -> niet ingevuld', K.alleScoresIngevuld(t, t.dagen[0]), false);
t = maakT([A,B], {dagen:[maakDag(1,{a:[3,4]}, holes2)]});
check('speler zonder scores -> niet ingevuld', K.alleScoresIngevuld(t, t.dagen[0]), false);

// v5.19.0: de spelerspool. Wie op deze dag in geen enkele flight staat, speelt
// niet mee en mag de uitslag dus niet tegenhouden.
const metFlights = (dag, spelerIds) => ({ ...dag, flights: [{ id:1, naam:'Flight 1', spelerIds }] });
t = maakT([A,B], {dagen:[metFlights(maakDag(1,{a:[3,4]}, holes2), ['a'])]});
check('een speler in de pool houdt de uitslag niet tegen',
  K.alleScoresIngevuld(t, t.dagen[0]), true);
t = maakT([A,B], {dagen:[metFlights(maakDag(1,{a:[3,null]}, holes2), ['a'])]});
check('maar een gat bij wie WEL speelt nog steeds wel',
  K.alleScoresIngevuld(t, t.dagen[0]), false);
t = maakT([A,B], {dagen:[metFlights(maakDag(1,{a:[3,4], b:[4,4]}, holes2), [])]});
check('staat er niemand in een flight, dan tellen alle spelers (zoals voorheen)',
  K.alleScoresIngevuld(t, t.dagen[0]), true);

// ============================================================
//  v5.22.0 — WACHT HET, OF LOOPT HET?
// ------------------------------------------------------------
//  Deze twee bepalen welk toernooi een speler te zien krijgt en of je er nog
//  een mag starten. Op live stonden twee toernooien met dezelfde naam naast
//  elkaar en kreeg een speler de verkeerde: "Dag 1 is nog niet gestart" terwijl
//  zijn toernooi gewoon liep.
// ============================================================
console.log('\n══ TOERNOOI — WACHT OF LOOPT ══');

const dagT = (extra) => ({ dagNr: 1, holes: holes18, scores: {}, afgerond: false, ...extra });

check('geen enkele dag gestart -> wacht',
  K.toernooiWacht({ dagen: [dagT({ gestart: false })] }), true);
check('dag 1 gestart -> wacht niet meer',
  K.toernooiWacht({ dagen: [dagT({ gestart: true })] }), false);
check('dag 2 gestart telt ook',
  K.toernooiWacht({ dagen: [dagT({ gestart: false }), dagT({ dagNr: 2, gestart: true })] }), false);
check('een afgesloten dag geldt als gestart',
  K.toernooiWacht({ dagen: [dagT({ afgerond: true })] }), false);
check('een toernooi zonder dagen wacht niet',
  K.toernooiWacht({ dagen: [] }), false);

check('een wachtend toernooi loopt niet',
  K.toernooiLoopt({ status: 'actief', dagen: [dagT({ gestart: false })] }), false);
check('een gestart toernooi loopt',
  K.toernooiLoopt({ status: 'actief', dagen: [dagT({ gestart: true })] }), true);
check('alle dagen afgerond -> loopt niet meer',
  K.toernooiLoopt({ status: 'actief', dagen: [dagT({ gestart: true, afgerond: true })] }), false);
check('status afgerond -> loopt niet',
  K.toernooiLoopt({ status: 'afgerond', dagen: [dagT({ gestart: true })] }), false);
check('niets doorgeven valt niet om', K.toernooiLoopt(null), false);

// ⚠ Dit is de situatie van live: twee toernooien, dezelfde naam, één wacht.
// De speler hoort bij het lopende uit te komen, ongeacht de volgorde.
const tweeToernooien = [
  { id: 'a', naam: 'Cie on tour 2026', status: 'actief', dagen: [dagT({ gestart: false })] },
  { id: 'b', naam: 'Cie on tour 2026', status: 'actief', dagen: [dagT({ gestart: true })] },
];
check('de speler krijgt het toernooi dat loopt',
  (tweeToernooien.find(K.toernooiLoopt) || tweeToernooien[0]).id, 'b');
check('ook als het lopende vooraan staat',
  ([...tweeToernooien].reverse().find(K.toernooiLoopt) || tweeToernooien[0]).id, 'b');
check('loopt er niets, dan valt hij terug op het eerste',
  ([tweeToernooien[0]].find(K.toernooiLoopt) || tweeToernooien[0]).id, 'a');

console.log('\n══ TOERNOOI — FLIGHTTIJDEN ══');
check('flight 0 = basistijd', K.berekenFlightTijd('09:00', 10, 0), '09:00');
check('flight 2 bij 10 min', K.berekenFlightTijd('09:00', 10, 2), '09:20');
check('over het uur heen', K.berekenFlightTijd('09:50', 15, 1), '10:05');

console.log('\n══ TOERNOOI — COUNTBACK ══');
const mk = arr => ({holeScores: arr.map(v => v===null?null:({brutto:v, netto:v, stableford:v}))});
check('laagste brutto op laatste helft wint',
  Math.sign(K.countback(mk([4,4,4,4]), mk([4,4,5,5]), 'brutto')), -1);
check('gelijk -> 0', K.countback(mk([4,4]), mk([4,4]), 'brutto'), 0);
check('stableford: hoogste wint',
  Math.sign(K.countback(mk([2,2,4,4]), mk([2,2,2,2]), 'stableford')), -1);
check('lege kaarten -> 0', K.countback(mk([]), mk([]), 'brutto'), 0);


console.log('\n══ TOERNOOI — LIVE SCORES PER DAG (v5.3.0) ══');
check('nieuw formaat: dag 1 uit dagen',
  K._liveScoresVanDag({dagNr:2, scores:[9,9], dagen:{'1':[3,4],'2':[9,9]}}, 1), [3,4]);
check('nieuw formaat: dag 2 uit dagen',
  K._liveScoresVanDag({dagNr:2, scores:[9,9], dagen:{'1':[3,4],'2':[9,9]}}, 2), [9,9]);
check('nieuw formaat: onbekende dag -> null',
  K._liveScoresVanDag({dagNr:2, dagen:{'1':[3,4]}}, 3), null);
check('oud formaat blijft werken',
  K._liveScoresVanDag({dagNr:1, scores:[5,6]}, 1), [5,6]);
check('oud formaat, andere dag -> null',
  K._liveScoresVanDag({dagNr:1, scores:[5,6]}, 2), null);
check('leeg document -> null', K._liveScoresVanDag(null, 1), null);
// De kern van de bug: dag 1 mag niet verdwijnen als dag 2 wordt ingevoerd
const naDag2 = {dagNr:2, scores:[7,7], dagen:{'1':[3,4], '2':[7,7]}};
check('dag 1 overleeft het invoeren van dag 2',
  K._liveScoresVanDag(naDag2, 1), [3,4]);

console.log('\n══ TOERNOOI — LOPENDE DAG HERKENNEN ══');
K._zetLive({a:{dagNr:2, dagen:{'2':[4,null]}}});
let tl = maakT([A,B], {dagen:[maakDag(1,{a:[null,null], b:[null,null]})]});
check('live-scores in nieuw formaat worden herkend', K.heeftGeenScores(tl), false);
K._zetLive({a:{dagNr:2, dagen:{'2':[null,null]}}});
check('lege live-scores tellen niet mee', K.heeftGeenScores(tl), true);
K._zetLive({});

console.log('\n══ TOERNOOI — COUNTBACK IN DE TOTAALSTAND (v5.3.0) ══');
const holes2b = [{par:4,si:1},{par:4,si:2}];
let tc = maakT([sp('x',0), sp('y',0)]);
tc.dagen = [
  maakDag(1,{x:[4,4], y:[4,4]}, holes2b),
  maakDag(2,{x:[4,3], y:[3,4]}, holes2b),
];
const tot = K.berekenStrokeplayTotaal(tc);
check('totaal brutto gelijk', [tot[0].brutto, tot[1].brutto], [15,15]);
check('totaal bewaart de holescores', tot[0].holeScores.length, 4);
// x eindigt op 3, y op 4 -> bij brutto sorteert de laagste vooraan (negatief)
check('countback breekt de gelijke stand op de laatste hole',
  Math.sign(K.countback(tot[0], tot[1], 'brutto')), -1);
check('omgekeerde volgorde geeft het spiegelbeeld',
  Math.sign(K.countback(tot[1], tot[0], 'brutto')), 1);
check('zonder holescores zou countback 0 geven (de oude situatie)',
  K.countback({holeScores:[]}, {holeScores:[]}, 'brutto'), 0);

console.log('\n══ TOERNOOI — 9 HOLES ══');
const holes9 = Array.from({length:9},(_,i)=>({par:4, si:i+1}));
let t9 = maakT([sp('p',0), sp('q',12)]);
let d9 = maakDag(1,{p:[4,...Array(8).fill(null)], q:[6,...Array(8).fill(null)]}, holes9);
// verschil 12 op 9 holes: SI 1 krijgt 1 basisslag + 1 extra (12-9=3) = 2
check('9 holes, verschil 12, SI 1 -> 2 slagen',
  K.getTHcpSlagen(sp('p',0), sp('q',12), {si:1}, 1, 9).slagOpHole, 2);
check('9 holes: uitslag gebruikt dezelfde slagen -> gelijkspel',
  K.berekenTPuntenVoorDag(t9, d9).punten, [1,1]);

// ============================================================
//  v5.11.8 — WIE STAAT BOVEN BIJ EEN GELIJKE STAND (MATCHPLAY)
// ============================================================
//  ⚠ De volgorde was `punten, dan winsten` en daarna niets: bij gelijke punten
//  én winsten besliste de volgorde waarin de spelers waren toegevoegd. Niet uit
//  te leggen aan de nummer twee.
//
//  De regel nu: punten → onderling resultaat (alleen bij precies twee gelijk)
//  → winsten → laagste handicap. Blijft het dan gelijk, dan is het ook ECHT
//  gelijk en wordt dat gemerkt in plaats van willekeurig geordend.
// ============================================================
console.log('\n══ GELIJKE STAND BIJ MATCHPLAY ══\n');

// e(i, punten, winsten, handicap)
const e = (i, pt, w, hcp) => ({ i, pt, w, s: { naam: 'S' + i, hcp } });
const namenVan = (lijst) => lijst.map(x => x.s.naam);

// Een matrix waarin speler i van j wint: zet ['i_j'] = 'W'.
const matrixVan = (paren) => {
  const m = [[], [], [], []].map(() => []);
  Object.entries(paren).forEach(([sleutel, res]) => {
    const [i, j] = sleutel.split('_').map(Number);
    m[i][j] = res;
    m[j][i] = res === 'W' ? 'L' : (res === 'L' ? 'W' : res);
  });
  return m;
};

check('punten gaan voor alles',
  namenVan(K.matchplayVolgorde([e(0, 2, 1, 10), e(1, 6, 3, 30), e(2, 4, 2, 5)], [])),
  ['S1', 'S2', 'S0']);

// Twee gelijk op punten: het onderlinge resultaat beslist, ook als de ander
// meer partijen won.
check('de winnaar van het onderlinge duel staat boven',
  namenVan(K.matchplayVolgorde([e(0, 4, 2, 20), e(1, 4, 2, 10)], matrixVan({ '0_1': 'W' }))),
  ['S0', 'S1']);
check('en andersom ook',
  namenVan(K.matchplayVolgorde([e(0, 4, 2, 10), e(1, 4, 2, 20)], matrixVan({ '0_1': 'L' }))),
  ['S1', 'S0']);
check('het onderlinge resultaat gaat vóór het aantal winsten',
  namenVan(K.matchplayVolgorde([e(0, 4, 1, 20), e(1, 4, 3, 10)], matrixVan({ '0_1': 'W' }))),
  ['S0', 'S1']);

check('gelijkspel onderling: dan telt het aantal winsten',
  namenVan(K.matchplayVolgorde([e(0, 4, 1, 5), e(1, 4, 3, 30)], matrixVan({ '0_1': 'T' }))),
  ['S1', 'S0']);
check('speelden ze niet tegen elkaar: ook winsten',
  namenVan(K.matchplayVolgorde([e(0, 4, 1, 5), e(1, 4, 3, 30)], [])),
  ['S1', 'S0']);

// ⚠ Bij DRIE gelijk kan A van B winnen, B van C en C van A. Dan bestaat er geen
// volgorde die klopt, dus gaat het onderlinge resultaat niet mee.
check('drie gelijk: geen onderling resultaat, maar winsten en handicap',
  namenVan(K.matchplayVolgorde(
    [e(0, 4, 2, 30), e(1, 4, 2, 10), e(2, 4, 3, 20)],
    matrixVan({ '0_1': 'W', '1_2': 'W', '2_0': 'W' }))),
  ['S2', 'S1', 'S0']);

check('alles gelijk: de laagste handicap staat boven',
  namenVan(K.matchplayVolgorde([e(0, 4, 2, 22.4), e(1, 4, 2, 8.1)], [])),
  ['S1', 'S0']);
check('ontbrekende handicap staat achteraan',
  namenVan(K.matchplayVolgorde([e(0, 4, 2, undefined), e(1, 4, 2, 30)], [])),
  ['S1', 'S0']);

// Echt gelijk: zelfde punten, winsten én handicap. Dat hoort zichtbaar te zijn.
const echtGelijk = K.matchplayVolgorde([e(0, 4, 2, 12), e(1, 4, 2, 12), e(2, 9, 4, 20)], []);
check('wie op alles gelijk eindigt wordt gemerkt',
  echtGelijk.filter(x => x.gelijk).map(x => x.s.naam), ['S0', 'S1']);
check('en wie alleen staat niet',
  echtGelijk.find(x => x.s.naam === 'S2').gelijk, false);

check('iedereen komt precies één keer terug',
  K.matchplayVolgorde([e(0, 4, 2, 10), e(1, 4, 2, 10), e(2, 4, 1, 10)], []).length, 3);
check('een lege lijst valt niet om', K.matchplayVolgorde([], []), []);

// ============================================================
//  v5.12.0 — SPEELWIJZE PER DAG EN DAGPUNTEN
// ============================================================
//  Dag 1 strokeplay en dag 2 matchplay moet kunnen. Optellen kan dan niet:
//  een dag stableford levert ~36 punten op, een dag matchplay ~2. De
//  gemeenschappelijke munt is de PLAATS van die dag:
//      punten = aantal spelers dat meedeed − plaats + 1
//  Gelijk geëindigd? Dan delen ze het gemiddelde van die plaatsen.
// ============================================================
console.log('\n══ SPEELWIJZE PER DAG ══\n');

check('de dag wint van het toernooi',
  K.dagModus({ modus: 'matchplay' }, { modus: 'strokeplay' }), 'strokeplay');
check('staat er niets op de dag, dan die van het toernooi',
  K.dagModus({ modus: 'strokeplay' }, { dagNr: 1 }), 'strokeplay');
check('en anders matchplay',
  K.dagModus({}, {}), 'matchplay');

const gemengd  = { modus: 'matchplay', dagen: [{ modus: 'strokeplay' }, { modus: 'matchplay' }] };
const zuiverMP = { modus: 'matchplay', dagen: [{}, {}] };
check('één strokeplay-dag is genoeg om de ladder eraf te houden',
  K.heeftStrokeplayDag(gemengd), true);
check('een toernooi zonder strokeplay-dag houdt de ladder',
  K.heeftStrokeplayDag(zuiverMP), false);
check('gemengd wordt herkend', K.gemengdeSpeelwijzen(gemengd), true);
check('en één speelwijze niet',   K.gemengdeSpeelwijzen(zuiverMP), false);

console.log('\n══ DAGPUNTEN ══\n');

// Vier spelers, geen gelijke standen: 4, 3, 2, 1.
check('de winnaar krijgt er zoveel als er spelers meededen',
  K.dagPuntenUitSleutels([-10, -8, -6, -4]), [4, 3, 2, 1]);
check('de volgorde van de lijst doet er niet toe',
  K.dagPuntenUitSleutels([-4, -10, -6, -8]), [1, 4, 2, 3]);

// ⚠ Wie niet meedeed (null) krijgt 0 en telt NIET mee voor het aantal spelers.
check('wie niet meedeed krijgt niets en telt niet mee',
  K.dagPuntenUitSleutels([-10, null, -6]), [2, 0, 1]);
check('een dag waarop niemand speelde geeft nul',
  K.dagPuntenUitSleutels([null, null]), [0, 0]);
check('een lege lijst valt niet om', K.dagPuntenUitSleutels([]), []);

// Gelijk geëindigd: samen de plaatsen 1 en 2, dus allebei (3+2)/2 = 2,5.
check('twee gelijk bovenaan delen de punten van plaats 1 en 2',
  K.dagPuntenUitSleutels([-10, -10, -6]), [2.5, 2.5, 1]);
check('drie gelijk delen alles',
  K.dagPuntenUitSleutels([-5, -5, -5]), [2, 2, 2]);
check('gelijk onderaan',
  K.dagPuntenUitSleutels([-10, -6, -6]), [3, 1.5, 1.5]);

// De som blijft gelijk, hoe de plaatsen ook gedeeld worden: 4+3+2+1 = 10.
const som = (a) => a.reduce((x, y) => x + y, 0);
check('delen verandert het totaal niet',
  [som(K.dagPuntenUitSleutels([-4,-3,-2,-1])), som(K.dagPuntenUitSleutels([-4,-4,-2,-2]))],
  [10, 10]);

// ============================================================
//  v5.12.1 — DE SPEELWIJZE KOMT UIT DE DAGBLOKKEN
// ------------------------------------------------------------
//  Tot v5.12.0 stond er in het aanmaakformulier onder de dagblokken nog een
//  tweede keuze Matchplay/Strokeplay voor het hele toernooi. Sierk,
//  13 september 2026: "bij aanmaken toernooi staat nu 2x speelwijze selectie.
//  de onderste moet weg. als er voor stroke play gekozen wordt verberg dan de
//  ranking ladder mogelijkheid."
//
//  Die onderste keuze was geen doublure: hij bepaalde ook wat eronder zichtbaar
//  was. Deze twee functies nemen dat over uit de dagblokken. Het gemengde geval
//  is waar het misging: met de oude keuze verdwenen de puntenvelden zodra je
//  strokeplay koos, ook als dag 2 gewoon matchplay was.
// ============================================================
console.log('\n══ SPEELWIJZE UIT DE DAGBLOKKEN ══\n');

check('alleen matchplay-dagen -> matchplay',
  K.toernooiModusVanSpeelwijzen(['matchplay', 'matchplay']), 'matchplay');
check('alleen strokeplay-dagen -> strokeplay',
  K.toernooiModusVanSpeelwijzen(['strokeplay', 'strokeplay']), 'strokeplay');
check('gemengd telt als matchplay — de punten worden dan gebruikt',
  K.toernooiModusVanSpeelwijzen(['strokeplay', 'matchplay']), 'matchplay');
check('geen dagen -> matchplay',
  K.toernooiModusVanSpeelwijzen([]), 'matchplay');

check('matchplay: punten zichtbaar, geen uitleg, ranking-ladder mag',
  K.zichtbaarheidVanSpeelwijzen(['matchplay']),
  { punten: true, uitleg: false, ranking: true });
check('strokeplay: geen punten, wel uitleg, GEEN ranking-ladder',
  K.zichtbaarheidVanSpeelwijzen(['strokeplay']),
  { punten: false, uitleg: true, ranking: false });
check('gemengd: punten en uitleg samen, en nog steeds geen ranking-ladder',
  K.zichtbaarheidVanSpeelwijzen(['strokeplay', 'matchplay']),
  { punten: true, uitleg: true, ranking: false });
check('een leeg formulier klapt niet dicht',
  K.zichtbaarheidVanSpeelwijzen([]),
  { punten: true, uitleg: false, ranking: true });

// De regel achter het verbergen: één strokeplay-dag en het toernooi telt niet
// meer mee voor de ladder. Dat is dezelfde regel als heeftStrokeplayDag().
const gemengdToernooi = { dagen: [{ modus: 'strokeplay' }, { modus: 'matchplay' }] };
check('zichtbaarheid en heeftStrokeplayDag zijn het eens',
  K.zichtbaarheidVanSpeelwijzen(['strokeplay', 'matchplay']).ranking,
  !K.heeftStrokeplayDag(gemengdToernooi));

module.exports = staat;
