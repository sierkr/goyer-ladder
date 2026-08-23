// ============================================================
//  Handicapverrekening — automatische tests (v5.8.5)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  In v5.8.0 is de slagentoekenning samengetrokken tot een module. Bij die
//  verhuizing is er per ongeluk ook iets aan de REGEL veranderd: de slagen
//  werden verdeeld over de zwaarste GESPEELDE holes, in plaats van toegekend
//  aan stroke-indexnummers. Op een volle ronde valt dat niet op; op negen
//  holes kreeg iemand ineens twee keer zoveel slagen als afgesproken.
//
//  De regel is dat de stroke index bij de VOLLEDIGE kaart van 18 holes hoort.
//  Speel je er negen, dan liggen niet al je stroke-indexen op de kaart en vang
//  je maar een deel van je slagen op — grofweg de helft. Dat is geen
//  tekortkoming maar de bedoeling.
//
//  Blok 1 hieronder legt dat vast door de uitkomst voor elk aantal slagen te
//  vergelijken met de formule zoals de app hem altijd gebruikte. Wie de regel
//  opnieuw "verbetert", krijgt hier meteen een rode test.
// ============================================================
const { laadHcpKern, maakChecker } = require('./harnas.cjs');
const H = laadHcpKern();
const { staat, check } = maakChecker();

const app = H.app;

// Drie kaarten: een volle ronde, negen holes met de even stroke-indexen, en
// een echte voorkant waarop de SI's door elkaar lopen.
const holes18    = Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 }));
const holes9even = [2, 4, 6, 8, 10, 12, 14, 16, 18].map(si => ({ par: 4, si }));
const holes9voor = [10, 4, 16, 2, 12, 8, 18, 6, 14].map(si => ({ par: 4, si }));
const totaal = lijst => lijst.reduce((a, b) => a + b, 0);
const sis    = lijst => app.slagHoleLijst(lijst.n, lijst.holes, lijst.plaatsing).map(h => h.si);

// ── 1. De regel mag niet veranderen ───────────────────────
//  De formule zoals hij vóór v5.8.0 in de app stond, hier als ijkpunt.
function oudeFormule(n, holes) {
  return holes.map(h =>
    (h.si <= Math.min(n, holes.length) ? 1 : 0) +
    (h.si <= Math.max(0, n - holes.length) ? 1 : 0));
}
console.log('\n══ HCP — GELIJK AAN DE OUDE FORMULE ══\n');
let afwijkingen = 0;
for (const holes of [holes18, holes9even, holes9voor]) {
  for (let n = 0; n <= 40; n++) {
    const nieuw = JSON.stringify(app.slagenPerHole(n, holes, 'laag'));
    if (nieuw !== JSON.stringify(oudeFormule(n, holes))) afwijkingen++;
  }
}
check('laagste SI: 123 gevallen identiek aan de oude formule', afwijkingen, 0);

// ── 2. Minder dan 18 holes geeft minder slagen ────────────
console.log('══ HCP — MINDER DAN 18 HOLES ══\n');
check('9 holes (even SI), 4 slagen -> er vallen er 2',
  totaal(app.slagenPerHole(4, holes9even, 'laag')), 2);
check('9 holes (even SI), 4 slagen op SI 2 en 4',
  sis({ n: 4, holes: holes9even, plaatsing: 'laag' }), [2, 4]);
check('9 holes (voorkant), 8 slagen -> er vallen er 4',
  totaal(app.slagenPerHole(8, holes9voor, 'laag')), 4);
check('hole met SI boven het aantal holes krijgt niets',
  app.slagenPerHole(4, holes9even, 'laag')[8], 0);

// ── 3. Volle ronde ongewijzigd ────────────────────────────
console.log('══ HCP — VOLLE RONDE ══\n');
check('18 holes, 4 slagen op SI 1 t/m 4', sis({ n: 4, holes: holes18, plaatsing: 'laag' }), [1, 2, 3, 4]);
check('18 holes, 18 slagen -> 18 slagen', totaal(app.slagenPerHole(18, holes18, 'laag')), 18);
check('18 holes, 22 slagen -> 22 slagen', totaal(app.slagenPerHole(22, holes18, 'laag')), 22);
check('18 holes, 22 slagen -> 4 holes met een dubbele slag',
  app.slagenPerHole(22, holes18, 'laag').filter(v => v === 2).length, 4);
check('0 slagen', totaal(app.slagenPerHole(0, holes18, 'laag')), 0);
check('lege kaart', app.slagenPerHole(5, [], 'laag'), []);

// ── 4. Slagen vanaf de volgende SI ────────────────────────
console.log('══ HCP — VANAF DE VOLGENDE SI ══\n');
check('4 slagen -> SI 5 t/m 8', sis({ n: 4, holes: holes18, plaatsing: 'vanaf' }), [5, 6, 7, 8]);
check('1 slag -> SI 2', sis({ n: 1, holes: holes18, plaatsing: 'vanaf' }), [2]);
check('12 slagen -> nog steeds 12 slagen', totaal(app.slagenPerHole(12, holes18, 'vanaf')), 12);
check('12 slagen -> loopt door bij SI 1',
  sis({ n: 12, holes: holes18, plaatsing: 'vanaf' }).sort((a, b) => a - b),
  [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18]);
check('vanaf op 9 holes vangt ook maar een deel op',
  sis({ n: 4, holes: holes9even, plaatsing: 'vanaf' }), [6, 8]);

// ── 5. Hoeveel slagen krijgt wie ──────────────────────────
console.log('══ HCP — SLAGEN PER SPELER ══\n');
const drie = [{ uid: 'a', partijHcp: 8 }, { uid: 'b', partijHcp: 16 }, { uid: 'c', partijHcp: 24 }];
check('eigen handicap, 75%',
  app.spelerSlagen(drie, { pct: 0.75, verdeling: 'volledig', plaatsing: 'laag' }), { a: 6, b: 12, c: 18 });
check('onderling verschil, 75%',
  app.spelerSlagen(drie, { pct: 0.75, verdeling: 'relatief', plaatsing: 'laag' }), { a: 0, b: 6, c: 12 });
check('eigen handicap, 100%',
  app.spelerSlagen(drie, { pct: 1, verdeling: 'volledig', plaatsing: 'laag' }), { a: 8, b: 16, c: 24 });
check('onderling verschil, 60%',
  app.spelerSlagen(drie, { pct: 0.6, verdeling: 'relatief', plaatsing: 'laag' }), { a: 0, b: 5, c: 10 });
check('percentage telt in BEIDE verdelingen mee',
  app.spelerSlagen(drie, { pct: 0.5, verdeling: 'volledig', plaatsing: 'laag' }).c !==
  app.spelerSlagen(drie, { pct: 1.0, verdeling: 'volledig', plaatsing: 'laag' }).c, true);
check('negatieve uitkomst wordt nul', app.spelerSlagen(
  [{ uid: 'a', partijHcp: -4 }, { uid: 'b', partijHcp: 2 }],
  { pct: 0.75, verdeling: 'relatief', plaatsing: 'laag' }), { a: 0, b: 5 });

// ── 6. Matchplay: het onderlinge verschil ─────────────────
console.log('══ HCP — MATCHPLAY KOPPELS ══\n');
check('hcp 8 vs 24 bij 75% -> 12 slagen', app.koppelSlagen(drie[0], drie[2], 0.75).slagen, 12);
check('de hoogste handicap ontvangt', app.koppelSlagen(drie[0], drie[2], 0.75).ontvangerUid, 'c');
check('hcp 8 vs 16 bij 100% -> 8 slagen', app.koppelSlagen(drie[0], drie[1], 1).slagen, 8);
check('gelijke handicap -> 0 slagen',
  app.koppelSlagen({ uid: 'x', partijHcp: 12 }, { uid: 'y', partijHcp: 12 }, 0.75).slagen, 0);
check('partijHcp gaat voor op de profielhandicap',
  app.partijHcpVan({ hcp: 30, partijHcp: 12 }), 12);

// ── 7. Partijen van voor v5.8.0 ───────────────────────────
console.log('══ HCP — OUDE PARTIJEN ══\n');
check('partij zonder instellingen valt terug op de standaard',
  app.hcpInstellingen({}), { pct: 0.75, verdeling: 'volledig', plaatsing: 'laag' });
check('null valt terug op de standaard',
  app.hcpInstellingen(null), { pct: 0.75, verdeling: 'volledig', plaatsing: 'laag' });
check('onzinnig percentage wordt genegeerd', app.hcpInstellingen({ hcpPct: 5 }).pct, 0.75);
check('onbekende verdeling wordt volledig', app.hcpInstellingen({ hcpVerdeling: 'xyz' }).verdeling, 'volledig');
check('0% is een geldige keuze', app.hcpInstellingen({ hcpPct: 0 }).pct, 0);

// ── 8. De omschrijving op het scherm ──────────────────────
console.log('══ HCP — OMSCHRIJVING ══\n');
check('amerikaantje, relatief, vanaf',
  app.hcpOmschrijving({ hcpPct: 0.75, hcpVerdeling: 'relatief', hcpPlaatsing: 'vanaf' }, 'amerikaantje'),
  '75% · onderling verschil · slagen vanaf SI');
check('matchplay noemt de verdeling niet',
  app.hcpOmschrijving({ hcpPct: 0.5 }, 'matchplay'), '50% · laagste SI');
check('amerikaantje, eigen handicap',
  app.hcpOmschrijving({ hcpPct: 0.6, hcpVerdeling: 'volledig' }, 'amerikaantje'),
  '60% · eigen hcp · laagste SI');

// ── 9. App, server en volgpagina moeten gelijk rekenen ────
//  Dit is de belangrijkste test van deze suite. Wijkt de server af van de app,
//  dan weigert hij bij het afsluiten een winnaar die op het scherm wel wint —
//  en dat is precies het soort verschil dat een ronde laat ontsporen.
console.log('══ HCP — APP, SERVER EN VOLGPAGINA GELIJK ══\n');
let verschilServer = 0, verschilWatch = 0, vergelijkingen = 0;
for (const holes of [holes18, holes9even, holes9voor]) {
  for (const plaatsing of ['laag', 'vanaf']) {
    for (let n = 0; n <= 40; n++) {
      const a = JSON.stringify(app.slagenPerHole(n, holes, plaatsing));
      if (a !== JSON.stringify(H.server.slagenPerHole(n, holes, plaatsing))) verschilServer++;
      if (a !== JSON.stringify(H.watch.slagenPerHole(n, holes, plaatsing)))  verschilWatch++;
      vergelijkingen++;
    }
  }
}
check('er is daadwerkelijk vergeleken', vergelijkingen, 246);
check('server rekent gelijk aan de app', verschilServer, 0);
check('volgpagina rekent gelijk aan de app', verschilWatch, 0);
check('server leest de plaatsing uit de partij', H.server.hcpPlaatsingVan({ hcpPlaatsing: 'vanaf' }), 'vanaf');
check('server valt terug op laag', H.server.hcpPlaatsingVan({}), 'laag');
check('server valt terug op laag bij een oude partij', H.server.hcpPlaatsingVan(null), 'laag');

module.exports = staat;
