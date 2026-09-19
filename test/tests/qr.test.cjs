// ============================================================
//  De QR-code naar de site — automatische tests (v5.37.0)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  Sierk wilde een QR-code in de Toernooi-tab die spelers kunnen scannen. Het
//  patroon van zwarte vakjes is hier één keer uitgerekend en staat
//  uitgeschreven in js/toernooi.js — geen internetdienst, geen extra
//  bibliotheek, dus ook niets dat stukgaat zodra er geen bereik is.
//
//  ⚠ WAT DEZE TESTS NIET KUNNEN. Of een telefoon de code werkelijk leest.
//  Er staat geen QR-lezer op deze machine en de browser van de browsertests
//  heeft er ook geen (BarcodeDetector is er niet). Dat moet iemand één keer
//  met een echte telefoon doen. Wat hieronder staat controleert de VORM: een
//  QR-code is vierkant, heeft drie zoekblokken van 7x7 in de hoeken, en de
//  rustrand van vier lege vakjes eromheen hoort in de tekening te zitten.
//  Gaat daar iets stuk — een regel die wegvalt, een tekenfout in het patroon —
//  dan valt hier een test om in plaats van dat er op de baan niets scant.
// ============================================================
const { laadQrKern, maakChecker } = require('./harnas.cjs');
const Q = laadQrKern();
const { staat, check } = maakChecker();

const rijenVan = (p) => p.trim().split('\n');

console.log('══ HET PATROON HEEFT DE VORM VAN EEN QR-CODE ══\n');

for (const [naam, patroon] of [['live', Q.QR_LIVE], ['test', Q.QR_TEST]]) {
  const rijen = rijenVan(patroon);
  const n = rijen.length;

  check(`${naam}: even veel rijen als kolommen`,
    rijen.every(r => r.length === n), true);
  check(`${naam}: alleen # en .`,
    rijen.every(r => /^[#.]+$/.test(r)), true);
  // Een QR-code is altijd 21 + 4k vakjes breed (versie 1 = 21, versie 2 = 25, ...).
  check(`${naam}: een geldige QR-maat (21 + 4x)`,
    n >= 21 && (n - 21) % 4 === 0, true);

  // De drie zoekblokken: 7x7, zwarte rand, witte ring, 3x3 zwart hart. Dit is
  // waar een telefoon de code aan HERKENT. Staan ze er niet, dan is er niets
  // te scannen, hoe goed de rest ook is.
  const blokKlopt = (r0, c0) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const rand  = (x === 0 || x === 6 || y === 0 || y === 6);
      const hart  = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
      const zwart = rijen[r0 + y][c0 + x] === '#';
      if (zwart !== (rand || hart)) return false;
    }
    return true;
  };
  check(`${naam}: zoekblok linksboven`,  blokKlopt(0, 0),         true);
  check(`${naam}: zoekblok rechtsboven`, blokKlopt(0, n - 7),     true);
  check(`${naam}: zoekblok linksonder`,  blokKlopt(n - 7, 0),     true);

  // Het liniaal: rij 6 en kolom 6 zijn om en om zwart en wit. Daarmee meet een
  // telefoon uit hoe groot één vakje op de foto is. Klopt dat niet, dan leest
  // hij de rest scheef.
  const liniaalRij = [...Array(n - 16)].every((_, i) =>
    (rijen[6][8 + i] === '#') === (i % 2 === 0));
  const liniaalKolom = [...Array(n - 16)].every((_, i) =>
    (rijen[8 + i][6] === '#') === (i % 2 === 0));
  check(`${naam}: liniaal in rij 6`,    liniaalRij,   true);
  check(`${naam}: liniaal in kolom 6`,  liniaalKolom, true);
}

console.log('\n══ DE ADRESSEN ══\n');

check('live wijst naar de site zelf',
  Q.QR_LIVE_URL, 'https://sierkr.github.io/goyer-ladder/');
check('test wijst naar de testomgeving',
  Q.QR_TEST_URL, 'https://sierkr.github.io/goyer-ladder/test/');
check('de twee adressen zijn niet hetzelfde',
  Q.QR_LIVE_URL !== Q.QR_TEST_URL, true);
// De code moet de omgeving volgen; wijzen ze naar hetzelfde patroon, dan stuurt
// het testscherm spelers naar de echte site zonder dat iemand het ziet.
check('de twee patronen zijn niet hetzelfde',
  Q.QR_LIVE !== Q.QR_TEST, true);

console.log('\n══ HET TEKENWERK ══\n');

const svg = Q.qrSvg(Q.QR_LIVE);
const rijen = rijenVan(Q.QR_LIVE);
const zwart = rijen.join('').split('').filter(c => c === '#').length;

check('het is een svg', svg.startsWith('<svg') && svg.endsWith('</svg>'), true);
check('één vierkantje per zwart vakje',
  (svg.match(/<rect x="\d+" y="\d+" width="1" height="1"\/>/g) || []).length, zwart);
// De rustrand: vier lege vakjes rondom. Zonder die rand vindt een telefoon de
// code niet, ook al is het patroon zelf foutloos.
check('de rustrand van vier vakjes zit in de viewBox',
  svg.includes(`viewBox="-4 -4 ${rijen.length + 8} ${rijen.length + 8}"`), true);
check('witte ondergrond, zwarte vakjes',
  svg.includes('fill="#ffffff"') && svg.includes('fill="#000000"'), true);
check('harde randen, anders vervaagt de camera de vakjes',
  svg.includes('shape-rendering="crispEdges"'), true);

// Een leeg of kapot patroon mag geen half getekende code opleveren.
check('een patroon zonder zwarte vakjes geeft ook geen vierkantjes',
  (Q.qrSvg('...\n...\n...').match(/<rect x=/g) || []).length, 1);  // alleen de ondergrond

module.exports = staat;
