#!/usr/bin/env node
// ============================================================
//  Alle tests draaien:  node tests/run.cjs
// ============================================================
const suites = [
  ['Puntensysteem & matchstand', './punten.test.cjs'],
  ['Activiteitssysteem',         './activiteit.test.cjs'],
  ['Partijverwerking (ladder)',  './partij.test.cjs'],
  ['Toernooi',                   './toernooi.test.cjs'],
  ['Knockout',                   './knockout.test.cjs'],
];

let totOk = 0, totFout = 0;
const stil = process.argv.includes('--stil');
const echteLog = console.log;
const resultaten = [];

for (const [naam, pad] of suites) {
  if (stil) console.log = () => {};
  let staat;
  try {
    staat = require(pad);
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
