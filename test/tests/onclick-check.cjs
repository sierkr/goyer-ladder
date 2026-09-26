#!/usr/bin/env node
// ============================================================
//  Controle op de knopkoppelingen — laag 0, zonder installatie
// ============================================================
//  WAAROM DIT BESTAAT
//
//  De app roept functies aan vanuit de HTML: `onclick="startPartij()"`. Voor
//  elke code-controleur is dat gewone tekst, dus een kapotte koppeling wordt
//  door niets gezien — niet door de rekentests en niet door een linter. En een
//  `onclick` draait in de GLOBALE ruimte, niet in die van de module: staat de
//  naam niet op `window`, dan doet de knop niets.
//
//  ⚠ WAT DE VORIGE CONTROLE MISTE. Op 16 september 2026 is dit met de hand
//  gemeten: "204 functies, alle 204 bestaan". Toch bleek op 25 september de knop
//  "Nu updaten" te hangen aan een naam die niet op window stond. Die aanroep zat
//  verstopt in een inline functie:
//      onclick="(function(){try{slaPartijFormulierOp()}catch(e){}…})()"
//  Een controle die zoekt naar `onclick="naam("` ziet daar `function` staan en
//  loopt er langs. Deze versie kijkt daarom naar ÉLKE naam met een `(` erachter
//  binnen de hele handler, en laat alleen weg wat een methode is (iets met een
//  punt ervoor) of een ingebouwde naam.
//
//  Draait zonder npm install, zodat uitrollen.sh hem altijd kan doen.
// ============================================================
const fs = require('fs');
const path = require('path');
const wortel = path.join(__dirname, '..');

// De HTML-bestanden die de app werkelijk gebruikt. De losse hulpschermen
// (migratie-*, ophaal-*, toernooi-sim) staan er bewust niet bij: die worden met
// de hand geopend en zijn geen onderdeel van de app.
const HTML = ['index.html', 'toernooi-live.html', 'watch.html'];

// Ingebouwde namen en taalwoorden. Wat hier niet in staat en niet op window
// gezet wordt, is een fout — dus deze lijst mag alleen groeien met dingen die
// de browser zelf meebrengt.
const INGEBOUWD = new Set([
  'function', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
  'new', 'await', 'async', 'void', 'delete', 'in', 'of', 'do', 'else', 'try',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'alert',
  'confirm', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'Number', 'String',
  'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'RegExp', 'Promise',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'requestAnimationFrame', 'fetch', 'URL', 'Blob', 'FormData', 'Image',
]);

function lees(bestand) {
  return fs.readFileSync(path.join(wortel, bestand), 'utf8');
}

// ⚠ Commentaarregels eruit vóór het zoeken. Deze controle vond zichzelf: het
// commentaar bij de reparatie van 26 september 2026 citeert de KAPOTTE oude
// handler als voorbeeld, en dat las hij als een echte knop. Alleen hele regels
// die met // beginnen gaan eruit — een `//` midden in een regel kan een adres
// zijn (https://…) en daar mag niets van wegvallen.
function zonderCommentaar(src) {
  return src.split('\n').map(r => /^\s*\/\//.test(r) ? '' : r).join('\n');
}

// Alles wat op window wordt gezet, in de modules EN in de inline scripts.
function namenOpWindow(bronnen) {
  const namen = new Set();
  for (const src of bronnen) {
    // window.naam = ...   en   window['naam'] = ...
    for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) namen.add(m[1]);
    for (const m of src.matchAll(/window\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*=/g)) namen.add(m[1]);
    // Object.assign(window, { a, b, c })
    for (const m of src.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
      for (const stuk of m[1].split(',')) {
        const n = stuk.trim().split(':')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(n)) namen.add(n);
      }
    }
  }
  return namen;
}

// Functies die in een inline <script> van een HTML-bestand staan: die zijn daar
// gewoon globaal, ook zonder window.
function globalenInHtml(src) {
  const namen = new Set();
  for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/gm)) namen.add(m[1]);
  return namen;
}

// De namen die binnen één handler worden aangeroepen. Een methode (`this.foo()`,
// `a.b()`) hoort er niet bij: die bestaat op het object, niet op window.
function aangeroepenIn(handler) {
  const uit = [];
  for (const m of handler.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) uit.push(m[2]);
  return uit;
}

const EVENTS = 'click|change|input|submit|focus|blur|keyup|keydown|keypress|dblclick|paste';
// Handlers in gewone HTML: onclick="..." of onclick='...'
const RE_HTML = new RegExp('\\son(?:' + EVENTS + ')\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'g');
// Handlers die de app zelf in elkaar zet, binnen een sjabloontekst. Daar staan
// ze vaak met een ontsnapt aanhalingsteken: onclick=\"...\"
const RE_JS = new RegExp('on(?:' + EVENTS + ')=\\\\?(["\'])((?:[^"\'\\\\]|\\\\.)*?)\\\\?\\1', 'g');

const jsFiles = fs.readdirSync(path.join(wortel, 'js'))
  .filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const alleBronnen = [...jsFiles, ...HTML].map(lees);
const opWindow = namenOpWindow(alleBronnen);

let gekeken = 0;
const gemist = new Map();

function controleer(bestand, src, re, extraGlobalen) {
  for (const m of src.matchAll(re)) {
    for (const naam of aangeroepenIn(m[2])) {
      gekeken++;
      if (INGEBOUWD.has(naam) || opWindow.has(naam) || extraGlobalen.has(naam)) continue;
      const regel = src.slice(0, m.index).split('\n').length;
      if (!gemist.has(naam)) gemist.set(naam, []);
      gemist.get(naam).push(`${bestand}:${regel}`);
    }
  }
}

for (const h of HTML) {
  const src = lees(h);
  controleer(h, src, RE_HTML, globalenInHtml(src));
}
for (const f of jsFiles) {
  controleer(f, zonderCommentaar(lees(f)), RE_JS, new Set());
}

const unieke = new Set();
for (const h of HTML) for (const m of lees(h).matchAll(RE_HTML)) aangeroepenIn(m[2]).forEach(n => unieke.add(n));
for (const f of jsFiles) for (const m of zonderCommentaar(lees(f)).matchAll(RE_JS)) aangeroepenIn(m[2]).forEach(n => unieke.add(n));

if (gemist.size === 0) {
  console.log(`✓ Knopkoppelingen: ${gekeken} aanroepen, ${unieke.size} verschillende namen, alle gevonden`);
  process.exit(0);
}
console.log(`✗ Knopkoppelingen: ${gemist.size} naam/namen bestaan niet op window:\n`);
for (const [naam, plekken] of gemist) {
  console.log(`   ${naam}`);
  plekken.slice(0, 4).forEach(p => console.log(`      ${p}`));
}
console.log('\n   Een onclick draait in de globale ruimte. Zet de naam op window,');
console.log('   of zet hem in de lijst INGEBOUWD als het een browsernaam is.');
process.exit(1);
