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

module.exports = staat;
