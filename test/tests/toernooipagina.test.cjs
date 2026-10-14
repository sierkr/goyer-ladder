// ============================================================
//  v6.0.0 — loopt toernooi/index.html gelijk met index.html?
// ------------------------------------------------------------
//  De toernooipagina is een GEMAAKTE kopie (tests/maak-toernooi-pagina.cjs).
//  Wijzigt iemand index.html en vergeet hij het script, dan draait het
//  toernooi op een oude pagina — zonder foutmelding. Deze test vangt dat.
// ============================================================
const fs = require('fs');
const path = require('path');
const { maakChecker } = require('./harnas.cjs');
const { maakToernooiPagina } = require('./maak-toernooi-pagina.cjs');
const { staat, check } = maakChecker();
const wortel = path.join(__dirname, '..');
const bron = fs.readFileSync(path.join(wortel, 'index.html'), 'utf8');
const kopiePad = path.join(wortel, 'toernooi', 'index.html');

console.log('\n══ TOERNOOIPAGINA (v6.0.0) ══');
check('toernooi/index.html bestaat', fs.existsSync(kopiePad), true);
if (fs.existsSync(kopiePad)) {
  const kopie = fs.readFileSync(kopiePad, 'utf8');
  check('toernooi/index.html is gelijk aan wat het script maakt (draai: node tests/maak-toernooi-pagina.cjs)',
    kopie === maakToernooiPagina(bron), true);
  check('de kopie verwijst naar de hoofdmap', kopie.includes('<base href="../">'), true);
  check('en heeft een eigen manifest', kopie.includes('manifest-toernooi.json'), true);
}
const man = JSON.parse(fs.readFileSync(path.join(wortel, 'manifest-toernooi.json'), 'utf8'));
check('het toernooi-manifest start in toernooi/', man.start_url, './toernooi/');
check('en heeft een eigen naam', man.short_name, 'Toernooi');
const sw = fs.readFileSync(path.join(wortel, 'sw.js'), 'utf8');
check('de service worker kent de toernooipagina', sw.includes("'./toernooi/'"), true);
check('en het toernooi-manifest', sw.includes("'./manifest-toernooi.json'"), true);

module.exports = staat;
