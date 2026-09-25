#!/usr/bin/env node
// ============================================================
//  Alle tests draaien:  node tests/run.cjs
// ============================================================
const suites = [
  ['Puntensysteem & matchstand', './punten.test.cjs'],
  ['Handicapverrekening',        './hcp.test.cjs'],
  ['Activiteitssysteem',         './activiteit.test.cjs'],
  ['Partijverwerking (ladder)',  './partij.test.cjs'],
  ['Toernooi',                   './toernooi.test.cjs'],
  ['Weergavestijl',               './stijl.test.cjs'],
  ['Knockout',                   './knockout.test.cjs'],
  ['Korte unieke namen',         './namen.test.cjs'],
  ['Twee paar ogen & scorelagen', './marker.test.cjs'],
  ['Gastlogins',                 './gastlogin.test.cjs'],
  ['QR-code',                    './qr.test.cjs'],
];

let totOk = 0, totFout = 0;
const stil = process.argv.includes('--stil');
const echteLog = console.log;
const resultaten = [];

// v5.38.0: een suite mag ook een BELOFTE teruggeven. Nodig sinds er een test
// is die crypto.subtle gebruikt — die is per se asynchroon.
//
// ⚠ WAT ER MIS WAS. De afdruk-tests van de toernooi-pincode werden maar half
// meegeteld: require() kwam terug voordat ze klaar waren, en de teller stond
// dan op een willekeurig getal. Een test die soms telt is erger dan geen test,
// want hij wekt vertrouwen zonder iets vast te houden.
async function draaiAlles() {
for (const [naam, pad] of suites) {
  if (stil) console.log = () => {};
  let staat;
  try {
    staat = require(pad);
    if (staat && typeof staat.then === 'function') staat = await staat;
  } catch (e) {
    console.log = echteLog;
    console.log(`\n✗ ${naam}: suite kon niet draaien\n  ${e.message}`);
    totFout++;
    resultaten.push({ naam, ok: 0, fout: 1, crash: e.message });
    continue;
  }
  console.log = echteLog;
  totOk += staat.ok; totFout += staat.fout;
  resultaten.push({ naam, ...staat });
}

console.log('\n' + '─'.repeat(58));
console.log(' RESULTAAT');
console.log('─'.repeat(58));
for (const r of resultaten) {
  const merk = r.fout === 0 ? '✓' : '✗';
  console.log(` ${merk} ${r.naam.padEnd(30)} ${String(r.ok).padStart(3)} ok  ${String(r.fout).padStart(2)} fout`);
  (r.bevindingen || []).forEach((b, i) => console.log(`     ${i + 1}. ${b}`));
}
console.log('─'.repeat(58));
console.log(` TOTAAL: ${totOk} geslaagd, ${totFout} mislukt`);
console.log('─'.repeat(58) + '\n');
process.exit(totFout ? 1 : 0);
}

draaiAlles();
