// ============================================================
//  Knockout — automatische tests
// ============================================================
const { laadToernooiKern, maakChecker } = require('./harnas.cjs');
const K = laadToernooiKern();
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

module.exports = staat;
