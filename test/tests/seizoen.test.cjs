// ============================================================
//  Nieuw seizoen: de beginstand — automatische tests (v6.5.0)
// ============================================================
//  Sierk, 27 november 2026: "per ladder ... een aantal opties om de
//  beginstand vast te stellen bv huidige stand, ahv gewonnen partijen, ahv
//  winstpercentage, en welke nog meer?" Negen beginstanden; bij gelijke
//  uitkomst beslist steeds de huidige stand.
//
//  seizoenBeginstand() is ECHT uit js/archief.js geknipt (laadSeizoenKern).
// ============================================================
const { laadSeizoenKern, maakChecker } = require('./harnas.cjs');
const { staat, check } = maakChecker();
const { seizoenBeginstand } = laadSeizoenKern();

// Huidige stand: A1 … F6. Bewust door elkaar aangeleverd.
const STAND = [
  { uid: 'C', rank: 3, partijen: 10, gewonnen: 5, hcp: 20 },
  { uid: 'A', rank: 1, partijen: 4,  gewonnen: 3, hcp: 12.4 },
  { uid: 'F', rank: 6, partijen: 0,  gewonnen: 0, hcp: null },
  { uid: 'B', rank: 2, partijen: 2,  gewonnen: 2, hcp: 8 },
  { uid: 'E', rank: 5, partijen: 10, gewonnen: 7, hcp: 8 },
  { uid: 'D', rank: 4, partijen: 6,  gewonnen: 3, hcp: 30 },
];
const uids = (l) => l.map(s => s.uid);
const kopie = () => JSON.parse(JSON.stringify(STAND));

module.exports = (async () => {
  console.log('\n══ HUIDIG EN OMGEDRAAID ══\n');
  check('huidige stand: op plek', uids(seizoenBeginstand(kopie(), 'huidig')), ['A', 'B', 'C', 'D', 'E', 'F']);
  check('onbekende keuze = huidige stand', uids(seizoenBeginstand(kopie(), 'iets')), ['A', 'B', 'C', 'D', 'E', 'F']);
  check('omgedraaid: laatste wordt eerste', uids(seizoenBeginstand(kopie(), 'omgedraaid')), ['F', 'E', 'D', 'C', 'B', 'A']);

  console.log('\n══ GEWONNEN, GESPEELD, SALDO ══\n');
  // gewonnen: E7, C5, A3, D3, B2, F0 — A en D gelijk: A stond hoger.
  check('meeste gewonnen, gelijk → huidige stand', uids(seizoenBeginstand(kopie(), 'gewonnen')), ['E', 'C', 'A', 'D', 'B', 'F']);
  // gespeeld: C10, E10, D6, A4, B2, F0 — C en E gelijk: C stond hoger.
  check('meeste gespeeld, gelijk → huidige stand', uids(seizoenBeginstand(kopie(), 'gespeeld')), ['C', 'E', 'D', 'A', 'B', 'F']);
  // saldo (gewonnen − verloren): A 3−1=2, B 2−0=2, C 5−5=0, D 3−3=0, E 7−3=4, F 0.
  check('saldo, gelijk → huidige stand', uids(seizoenBeginstand(kopie(), 'saldo')), ['E', 'A', 'B', 'C', 'D', 'F']);

  console.log('\n══ WINSTPERCENTAGE ══\n');
  // Minimum 3: B (2 partijen) en F (0) tellen niet mee en komen onder, in de
  // huidige volgorde. A 75%, E 70%, C 50%, D 50% (C meer partijen → hoger).
  check('minimum 3 (standaard)', uids(seizoenBeginstand(kopie(), 'winstpercentage')), ['A', 'E', 'C', 'D', 'B', 'F']);
  check('minimum 3 uitdrukkelijk', uids(seizoenBeginstand(kopie(), 'winstpercentage', { minPartijen: 3 })), ['A', 'E', 'C', 'D', 'B', 'F']);
  // Minimum 1: B 100% staat bovenaan; F (0 partijen) heeft geen percentage.
  check('minimum 1: 2 uit 2 bovenaan', uids(seizoenBeginstand(kopie(), 'winstpercentage', { minPartijen: 1 })), ['B', 'A', 'E', 'C', 'D', 'F']);
  check('minimum 0 telt als 1: 0 partijen blijft onder', uids(seizoenBeginstand(kopie(), 'winstpercentage', { minPartijen: 0 })), ['B', 'A', 'E', 'C', 'D', 'F']);
  check('minimum 7: alleen C en E tellen', uids(seizoenBeginstand(kopie(), 'winstpercentage', { minPartijen: 7 })), ['E', 'C', 'A', 'B', 'D', 'F']);

  console.log('\n══ HANDICAP ══\n');
  // B 8 en E 8 gelijk → B stond hoger; F zonder handicap onderaan.
  check('laagste eerst, zonder handicap onderaan', uids(seizoenBeginstand(kopie(), 'handicap')), ['B', 'E', 'A', 'C', 'D', 'F']);

  console.log('\n══ ZONDER PARTIJEN ONDERAAN ══\n');
  check('wie speelde boven, verder huidige stand', uids(seizoenBeginstand(kopie(), 'zonderOnder')), ['A', 'B', 'C', 'D', 'E', 'F']);
  const metNul = kopie(); metNul[1].partijen = 0;   // A speelde niet
  check('A zonder partijen zakt onder de rest', uids(seizoenBeginstand(metNul, 'zonderOnder')), ['B', 'C', 'D', 'E', 'A', 'F']);

  console.log('\n══ LOTING ══\n');
  const reeks = (getallen) => { let i = 0; return () => getallen[i++ % getallen.length]; };
  const l1 = uids(seizoenBeginstand(kopie(), 'loting', { random: reeks([0.1, 0.7, 0.3, 0.9, 0.5]) }));
  const l2 = uids(seizoenBeginstand(kopie(), 'loting', { random: reeks([0.1, 0.7, 0.3, 0.9, 0.5]) }));
  check('zelfde worp → zelfde volgorde', l1, l2);
  check('iedereen precies één keer', l1.slice().sort(), ['A', 'B', 'C', 'D', 'E', 'F']);
  check('met deze worp een andere volgorde dan nu', l1.join('') !== 'ABCDEF', true);
  const echt = uids(seizoenBeginstand(kopie(), 'loting'));
  check('echte loting: iedereen precies één keer', echt.slice().sort(), ['A', 'B', 'C', 'D', 'E', 'F']);

  console.log('\n══ DE INVOER BLIJFT ONGEMOEID ══\n');
  for (const m of ['huidig', 'omgedraaid', 'gewonnen', 'winstpercentage', 'gespeeld', 'saldo', 'handicap', 'loting', 'zonderOnder']) {
    const invoer = kopie();
    const voor = JSON.stringify(invoer);
    const uit = seizoenBeginstand(invoer, m);
    check(`${m}: invoer niet veranderd`, JSON.stringify(invoer), voor);
    check(`${m}: zes spelers terug`, uit.length, 6);
  }
  check('lege ladder', seizoenBeginstand([], 'gewonnen'), []);
  check('geen lijst', seizoenBeginstand(null, 'huidig'), []);

  return staat;
})();
