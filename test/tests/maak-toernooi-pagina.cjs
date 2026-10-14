#!/usr/bin/env node
// ============================================================
//  v6.0.0 — maakt toernooi/index.html uit index.html
// ------------------------------------------------------------
//  Het toernooi heeft een eigen adres (…/toernooi), maar GEEN eigen app:
//  dezelfde pagina, dezelfde code. Dit script maakt de kopie en past er
//  alleen dit aan:
//    1. <base href="../"> direct na <head>: alle verwijzingen (js/, sw.js,
//       plaatjes, handleidingen, version.json) wijzen dan naar de hoofdmap;
//    2. een eigen manifest (manifest-toernooi.json) en titel, zodat het
//       toernooi als eigen app op een beginscherm kan;
//    3. een kopregel dat de kopie niet met de hand gewijzigd mag worden.
//  Welke ingang het is, ziet js/config.js aan het adres (IS_TOERNOOI_APP).
//
//  ⚠ Na elke wijziging aan index.html dit script draaien:
//       node tests/maak-toernooi-pagina.cjs
//  tests/toernooipagina.test.cjs faalt anders — en rood is niet uitrollen.
// ============================================================
const fs = require('fs');
const path = require('path');
const wortel = path.join(__dirname, '..');

function maakToernooiPagina(bron) {
  let s = bron;
  const kop = '<head>';
  if (!s.includes(kop)) throw new Error('index.html heeft geen <head>');
  s = s.replace(kop, kop + '\n<base href="../">\n<!-- GEMAAKT DOOR tests/maak-toernooi-pagina.cjs UIT index.html — NIET MET DE HAND WIJZIGEN -->');
  const vervang = (oud, nieuw) => {
    if (!s.includes(oud)) throw new Error('niet gevonden in index.html: ' + oud);
    s = s.replace(oud, nieuw);
  };
  vervang('<link rel="manifest" href="manifest.json">', '<link rel="manifest" href="manifest-toernooi.json">');
  vervang('<meta name="apple-mobile-web-app-title" content="MP Ladder">', '<meta name="apple-mobile-web-app-title" content="Toernooi">');
  vervang('<title>Goyer Golf MP Ladder</title>', '<title>Goyer Toernooi</title>');
  return s;
}

if (require.main === module) {
  const bron = fs.readFileSync(path.join(wortel, 'index.html'), 'utf8');
  fs.mkdirSync(path.join(wortel, 'toernooi'), { recursive: true });
  fs.writeFileSync(path.join(wortel, 'toernooi', 'index.html'), maakToernooiPagina(bron));
  console.log('✓ toernooi/index.html gemaakt uit index.html');
}

module.exports = { maakToernooiPagina };
