// ============================================================
//  Knockout — automatische tests
// ============================================================
const { laadToernooiKern, laadKnockoutScoreKern, laadScoreKern, laadHcpKern, maakChecker } = require('./harnas.cjs');
const K = laadToernooiKern();
const KS = laadKnockoutScoreKern();
const S  = laadScoreKern();
const H  = laadHcpKern().app;
const { staat, check } = maakChecker();

const p = (a,b,winnaar='') => ({a,b,winnaar});
const bouwR1 = namen => {
  const r=[];
  for(let i=0;i<namen.length;i+=2){
    const a=namen[i]||'', b=namen[i+1]||'';
    const m={a,b,winnaar:''};
    if(!b) m.winnaar=a;
    if(!a) m.winnaar=b;
    r.push(m);
  }
  return r;
};

console.log('\n══ KNOCKOUT — BRACKET OPBOUW ══');
let r = K.verwerkKnockoutVoortgang([bouwR1(['A','B','C','D','E','F','G','H'])], 8);
check('8 spelers -> ronde 1 heeft 4 partijen', r[0].length, 4);
check('8 spelers -> geen ronde 2 zolang er niets gespeeld is', r.length, 1);

let rondes = [bouwR1(['A','B','C','D','E','F','G','H'])];
rondes[0][0].winnaar='A'; rondes[0][1].winnaar='C';
r = K.verwerkKnockoutVoortgang(rondes, 8);
check('half gespeeld -> nog steeds geen volgende ronde', r.length, 1);

rondes[0][2].winnaar='E'; rondes[0][3].winnaar='G';
r = K.verwerkKnockoutVoortgang(rondes, 8);
check('ronde 1 compleet -> ronde 2 met 2 partijen', r[1].length, 2);
check('ronde 2 paart winnaars op volgorde', [r[1][0].a, r[1][0].b, r[1][1].a, r[1][1].b], ['A','C','E','G']);
check('ronde 2 nog niet gespeeld', r[1].map(m=>m.winnaar), ['','']);

r[1][0].winnaar='A'; r[1][1].winnaar='E';
r = K.verwerkKnockoutVoortgang(r, 8);
check('ronde 2 compleet -> finale', r[2].length, 1);
check('finale paart de twee winnaars', [r[2][0].a, r[2][0].b], ['A','E']);
r[2][0].winnaar='A';
r = K.verwerkKnockoutVoortgang(r, 8);
check('na de finale komt er geen ronde bij', r.length, 3);

console.log('\n══ KNOCKOUT — BYES ══');
r = K.verwerkKnockoutVoortgang([bouwR1(['A','B','C','D','E'])], 5);
check('5 spelers -> 3 partijen in ronde 1', r[0].length, 3);
check('oneven speler krijgt een bye', r[0][2], {a:'E', b:'', winnaar:'E'});
check('bye telt niet als "nog te spelen"', r.length, 1);
r[0][0].winnaar='A'; r[0][1].winnaar='C';
r = K.verwerkKnockoutVoortgang(r, 5);
check('5 spelers -> ronde 2 met 2 partijen', r[1].length, 2);
check('ronde 2: A-C en E met bye', [r[1][0].a, r[1][0].b, r[1][1].a, r[1][1].b], ['A','C','E','']);
check('bye in ronde 2 wint automatisch', r[1][1].winnaar, 'E');

r = K.verwerkKnockoutVoortgang([bouwR1(['A','B','C','D','E','F'])], 6);
check('6 spelers -> 3 partijen', r[0].length, 3);
r[0][0].winnaar='A'; r[0][1].winnaar='C'; r[0][2].winnaar='E';
r = K.verwerkKnockoutVoortgang(r, 6);
check('6 spelers -> ronde 2 met 2 partijen (een bye)', r[1].length, 2);
check('6 spelers: E krijgt de bye', r[1][1].winnaar, 'E');

console.log('\n══ KNOCKOUT — UITSLAGEN BEWAREN EN WISSEN ══');
rondes = [bouwR1(['A','B','C','D'])];
rondes[0][0].winnaar='A'; rondes[0][1].winnaar='C';
rondes = K.verwerkKnockoutVoortgang(rondes, 4);
rondes[1][0].winnaar='A'; rondes[1][0].resultaat='3&2';
rondes = K.verwerkKnockoutVoortgang(rondes, 4);
check('finale-uitslag blijft staan bij herberekenen',
  [rondes[1][0].winnaar, rondes[1][0].resultaat], ['A','3&2']);

rondes[0][0].winnaar='B'; // uitslag ronde 1 gecorrigeerd
rondes = K.verwerkKnockoutVoortgang(rondes, 4);
check('gewijzigde deelnemer -> finale-uitslag gewist', rondes[1][0].winnaar, '');
check('gewijzigde deelnemer -> resultaat gewist', rondes[1][0].resultaat, '');
check('finale heeft nieuwe deelnemer', [rondes[1][0].a, rondes[1][0].b], ['B','C']);

rondes = [bouwR1(['A','B','C','D'])];
rondes[0][0].winnaar='A'; rondes[0][1].winnaar='C';
rondes = K.verwerkKnockoutVoortgang(rondes, 4);
rondes[0][1].winnaar=''; // uitslag teruggedraaid
rondes = K.verwerkKnockoutVoortgang(rondes, 4);
check('uitslag teruggedraaid -> volgende ronde verdwijnt', rondes.length, 1);

console.log('\n══ KNOCKOUT — RANDGEVALLEN ══');
r = K.verwerkKnockoutVoortgang([bouwR1(['A','B'])], 2);
check('2 spelers -> 1 partij', r[0].length, 1);
check('2 spelers -> geen extra ronde', r.length, 1);
r[0][0].winnaar='A';
r = K.verwerkKnockoutVoortgang(r, 2);
check('2 spelers, gespeeld -> nog steeds 1 ronde', r.length, 1);

r = K.verwerkKnockoutVoortgang([bouwR1(['A'])], 1);
check('1 speler loopt niet vast', Array.isArray(r), true);
r = K.verwerkKnockoutVoortgang([], 0);
check('leeg loopt niet vast', r, []);

console.log('\n══ KNOCKOUT — OPSLAGFORMAAT ══');
const orig = [[p('A','B','A')], [p('A','C')]];
const obj = K.rondesNaarObj(orig);
check('rondesNaarObj maakt een object', typeof obj, 'object');
check('heen en terug levert hetzelfde op', K.objNaarRondes(obj), orig);
check('objNaarRondes van leeg -> lege lijst', K.objNaarRondes(null), []);
check('objNaarRondes van array blijft array', K.objNaarRondes(orig), orig);

// ============================================================
//  v5.12.6 — DE SCORE IN HET SCHEMA VOLGT DE INSTELLING VAN DE PARTIJ
// ------------------------------------------------------------
//  Tot v5.12.5 had het knockoutscherm zijn eigen, ingetikte slagentoekenning:
//      si <= Math.min(hcpSlagen, holes.length)
//  Dat is de formule voor 'slagen op de laagste SI'. Een partij kan ook op
//  'slagen vanaf SI' staan (js/partij.js), en dan verdeelde het schema de
//  slagen anders dan de scorekaart die de spelers voor zich zagen.
//
//  Deze tests doen twee dingen:
//    1. aantonen dat er voor 'laag' NIETS verandert — dat is de standaard en
//       vrijwel elke partij, dus daar mag geen enkele uitslag verschuiven;
//    2. aantonen dat 'vanaf' wel verandert, en nu gelijkloopt met het
//       rondescherm (js/ronde.js) in plaats van ervan af te wijken.
// ============================================================
console.log('\n══ KNOCKOUT — SCORE IN HET SCHEMA ══');

// 9 holes, stroke index 1 t/m 9 op volgorde.
const koHoles = Array.from({ length: 9 }, (_, i) => ({ nr: i + 1, si: i + 1, par: 4 }));
// Allebei precies even goed op elke hole; alleen de handicapslagen beslissen.
const gelijk9 = [5, 5, 5, 5, 5, 5, 5, 5, 5];

const koPartij = (plaatsing) => ({
  holes: koHoles,
  hcpPlaatsing: plaatsing,
  scores: { A: [...gelijk9], B: [...gelijk9] },
});
const koMatchup = { spelerA: { uid: 'A' }, spelerB: { uid: 'B' },
                    hcpSlagen: 4, hcpOntvanger: 'A' };

// De oude, ingetikte formule — letterlijk zoals hij tot v5.12.5 in
// js/knockout.js stond. Alleen hier, als ijkpunt.
function oudeFormule(hcpSlagen, holes, holeIdx) {
  const si = holes[holeIdx].si;
  return (si <= Math.min(hcpSlagen, holes.length) ? 1 : 0)
       + (si <= Math.max(0, hcpSlagen - holes.length) ? 1 : 0);
}

// ── 1. Bij 'laag' verandert er niets ────────────────────────────────────────
let zelfde = true;
for (let i = 0; i < koHoles.length; i++) {
  if (H.slagenOpHole(4, koHoles, i, 'laag') !== oudeFormule(4, koHoles, i)) zelfde = false;
}
check("bij 'laag' geeft hcp.js exact de oude formule", zelfde, true);
check("bij 'laag' blijft de score in het schema 4&3",
      KS.knockoutMatchScore(koPartij('laag'), koMatchup), '4&3');

// ── 2. Bij 'vanaf' verschuiven de slagen wél ────────────────────────────────
let anders = false;
for (let i = 0; i < koHoles.length; i++) {
  if (H.slagenOpHole(4, koHoles, i, 'vanaf') !== oudeFormule(4, koHoles, i)) anders = true;
}
check("bij 'vanaf' wijkt de verdeling af van de oude formule", anders, true);
check("bij 'vanaf' staat er nu 3&2 in het schema",
      KS.knockoutMatchScore(koPartij('vanaf'), koMatchup), '3&2');

// ── 3. Het schema zegt hetzelfde als het rondescherm ────────────────────────
//  Dit is waar het om begonnen was: dezelfde partij mag niet twee antwoorden
//  geven, afhankelijk van welk scherm je toevallig opent.
for (const plaatsing of ['laag', 'vanaf']) {
  const partij = koPartij(plaatsing);
  const viaRonde = S.matchScoreTekst(S.berekenMatchStand(koMatchup, partij));
  check(`schema en rondescherm zeggen hetzelfde bij '${plaatsing}'`,
        KS.knockoutMatchScore(partij, koMatchup), viaRonde);
}

// ── 4. De stand blijft bevroren op het moment van beslissen ─────────────────
//  Wie op hole 15 met 4 voor en 3 te gaan wint, wint 4&3 — ook als er wordt
//  doorgeteld tot 18. Dat was de melding van Sierk bij v5.8.9 ('7&0').
const holes18 = Array.from({ length: 18 }, (_, i) => ({ nr: i + 1, si: i + 1, par: 4 }));
const bevroren = {
  holes: holes18, hcpPlaatsing: 'laag',
  scores: {
    A: Array.from({ length: 18 }, (_, i) => (i < 4 ? 4 : 5)),   // A wint hole 1-4
    B: Array.from({ length: 18 }, () => 5),
  },
};
const geenSlagen = { spelerA: { uid: 'A' }, spelerB: { uid: 'B' },
                     hcpSlagen: 0, hcpOntvanger: null };
//  A staat na hole 4 vier voor en houdt dat vast. Beslist is het pas op hole
//  15: daar zijn er nog 3 te gaan en 4 > 3. Er wordt doorgeteld tot 18, maar de
//  stand blijft bevroren op dat moment.
check('4 voor, doorgeteld tot 18 -> 4&3, niet 4&0',
      KS.knockoutMatchScore(bevroren, geenSlagen), '4&3');

// ── 5. '&0' bestaat niet in golftaal ────────────────────────────────────────
//  Gelijk tot en met hole 8, A wint de negende. Dan pas is er niets meer te
//  gaan en is de match beslist — dat is '1 up' en niet '1&0'.
const opDeLaatste = {
  holes: koHoles, hcpPlaatsing: 'laag',
  scores: { A: [5, 5, 5, 5, 5, 5, 5, 5, 4], B: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
};
check('beslist op de laatste hole -> 1 up, niet 1&0',
      KS.knockoutMatchScore(opDeLaatste, geenSlagen), '1 up');

// ── 6. Gelijk, en nog niet uit ──────────────────────────────────────────────
check('alles gelijk en uitgespeeld -> gelijkspel',
      KS.knockoutMatchScore({ holes: koHoles, hcpPlaatsing: 'laag',
        scores: { A: [...gelijk9], B: [...gelijk9] } }, geenSlagen), 'gelijkspel');
check('nog niet uitgespeeld -> geen score',
      KS.knockoutMatchScore({ holes: koHoles, hcpPlaatsing: 'laag',
        scores: { A: [5, 4, null, null, null, null, null, null, null],
                  B: [5, 5, null, null, null, null, null, null, null] } }, geenSlagen), '');
check('geen holes -> geen score',
      KS.knockoutMatchScore({ holes: [], scores: {} }, geenSlagen), '');

module.exports = staat;
