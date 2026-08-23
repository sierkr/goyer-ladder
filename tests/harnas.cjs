// ============================================================
//  Testharnas — laadt de ECHTE functies uit de app
// ============================================================
//  De tests draaien niet op een namaakversie van de logica: dit harnas knipt
//  de functies rechtstreeks uit js/toernooi.js, js/knockout.js en
//  functions/index.js en voert ze uit met gestubde module-afhankelijkheden.
//  Wijzigt de app, dan wijzigen de tests mee — en breekt er iets, dan valt
//  een test om in plaats van een toernooi.
// ============================================================
const fs = require('fs');
const path = require('path');
const wortel = path.join(__dirname, '..');

// v5.8.5: `voorvoegsel` maakt het mogelijk ook uit een ES-module te knippen,
// waar de functies met `export function` beginnen. Het voorvoegsel wordt uit
// het geknipte stuk gehaald, zodat het als gewone functie uitvoerbaar blijft.
function knip(bestand, namen, voorvoegsel = '') {
  const src = fs.readFileSync(path.join(wortel, bestand), 'utf8');
  const stukken = [];
  for (const n of namen) {
    const re = new RegExp('^' + voorvoegsel + 'function ' + n.replace(/[$]/g, '\\$') + '\\([\\s\\S]*?\\n\\}', 'm');
    const m = src.match(re);
    if (!m) throw new Error(`Functie '${n}' niet gevonden in ${bestand} — is hij hernoemd of verwijderd?`);
    stukken.push((m.group ? m.group(0) : m[0]).replace(/^export /, ''));
  }
  return stukken.join('\n');
}

// Knipt een `export const NAAM = Object.freeze({ ... });` uit een module, zodat
// de test met de ECHTE standaardwaarden rekent en niet met een kopie die
// stilletjes achterloopt.
function knipConstante(bestand, naam) {
  const src = fs.readFileSync(path.join(wortel, bestand), 'utf8');
  const re = new RegExp('^export const ' + naam + '[\\s\\S]*?\\n\\}\\);', 'm');
  const m = src.match(re);
  if (!m) throw new Error(`Constante '${naam}' niet gevonden in ${bestand}.`);
  return m[0].replace(/^export /, '');
}

function laadToernooiKern() {
  const t = knip('js/toernooi.js', [
    'getTHcpSlagen', 'berekenTPuntenVoorDag', 'berekenStrokeplayRanglijstVoorDag',
    'berekenStrokeplayTotaal', 'countback', 'getDag', 'actieveDag',
    'heeftGeenScores', 'alleScoresIngevuld', 'berekenFlightTijd',
    'berekenTPunten', '_liveScoresVanDag',
  ]);
  const k = knip('js/knockout.js', ['rondesNaarObj', 'objNaarRondes', 'verwerkKnockoutVoortgang']);
  const bron = `
    let toernooiData = null;
    let _liveScores = {};
    const window = { _bekijkDagNr: undefined, _ranglijstDagNr: undefined };
    ${t}
    ${k}
    return {
      getTHcpSlagen, berekenTPuntenVoorDag, berekenStrokeplayRanglijstVoorDag,
      berekenStrokeplayTotaal, countback, getDag, actieveDag, heeftGeenScores,
      alleScoresIngevuld, berekenFlightTijd, berekenTPunten, _liveScoresVanDag,
      rondesNaarObj, objNaarRondes, verwerkKnockoutVoortgang,
      _zetToernooi: (v) => { toernooiData = v; },
      _zetLive:     (v) => { _liveScores = v || {}; },
      _zetWindow:   (k, v) => { window[k] = v; },
    };
  `;
  return new Function(bron)();
}

function laadLadderKern() {
  const f = knip('functions/index.js', [
    // v5.8.3: _slagenPerHole en _hcpPlaatsingVan zijn in v5.8.0 toegevoegd als
    // hulpfuncties van _hcpSlagenOpHole en _berekenStand. Stonden ze hier niet
    // bij, dan knipte het harnas alleen de aanroepers eruit en viel de hele
    // suite om met "_slagenPerHole is not defined" — precies wat er in CI
    // gebeurde. Voegt iemand later opnieuw een hulpfunctie toe, dan moet die
    // hier ook bij.
    '_slagenPerHole', '_hcpPlaatsingVan',
    '_hcpSlagenOpHole', '_berekenStand', 'berekenActiviteitsStats', 'bouwNaamNaarUid',
    'doelVerschuivingVoorSpeler', '_straf', 'scoreVoorPositie', '_uitslagTs', 'hashPin',
  ]);
  const bron = `
    const crypto = require('crypto');
    const PUNTEN_BASE = 1000000, PUNTEN_STAP = 100, FORS_STRAF = 50000000;
    const WEEK_MS = 7 * 24 * 3600 * 1000;
    ${f}
    return { _slagenPerHole, _hcpPlaatsingVan,
             _hcpSlagenOpHole, _berekenStand, berekenActiviteitsStats, bouwNaamNaarUid,
             doelVerschuivingVoorSpeler, _straf, scoreVoorPositie, _uitslagTs, hashPin };
  `;
  return new Function('require', bron)(require);
}

// ============================================================
//  v5.8.5 — HANDICAPVERREKENING
// ------------------------------------------------------------
//  De regel die bepaalt hoeveel slagen iemand krijgt en op welke hole, staat
//  op DRIE plekken die noodgedwongen los van elkaar leven:
//    - js/hcp.js            de app (ES-module)
//    - functions/index.js   de server, die de winnaar natelt (Node)
//    - watch.html           de volgpagina, die zonder modules draait
//  Lopen ze uit de pas, dan weigert de server een winnaar die de app wel als
//  winnaar toont. Daarom laadt dit harnas ze alle drie apart, elk in een eigen
//  scope zodat de gelijknamige functies elkaar niet overschrijven.
// ============================================================
function laadHcpKern() {
  const namen = ['hcpInstellingen', 'hcpOmschrijving', 'slagenPerHole',
                 'slagenOpHole', 'slagHoleLijst', 'partijHcpVan',
                 'koppelSlagen', 'spelerSlagen'];
  const app = new Function(`
    ${knipConstante('js/hcp.js', 'HCP_STANDAARD')}
    ${knip('js/hcp.js', namen, 'export ')}
    return { ${namen.join(', ')} };
  `)();
  const server = new Function(`
    ${knip('functions/index.js', ['_slagenPerHole', '_hcpPlaatsingVan'])}
    return { slagenPerHole: _slagenPerHole, hcpPlaatsingVan: _hcpPlaatsingVan };
  `)();
  const watch = new Function(`
    ${knip('watch.html', ['slagenPerHole'])}
    return { slagenPerHole };
  `)();
  return { app, server, watch };
}

// ─── Kleine assertie-helper ──────────────────────────────────
function maakChecker() {
  const staat = { ok: 0, fout: 0, bevindingen: [] };
  const check = (naam, werkelijk, verwacht) => {
    const a = JSON.stringify(werkelijk), b = JSON.stringify(verwacht);
    if (a === b) staat.ok++;
    else { staat.fout++; staat.bevindingen.push(`${naam}\n     kreeg:    ${a}\n     verwacht: ${b}`); }
  };
  return { staat, check };
}

module.exports = { laadToernooiKern, laadLadderKern, laadHcpKern, maakChecker };
