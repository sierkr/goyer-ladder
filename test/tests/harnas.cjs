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

function knip(bestand, namen) {
  const src = fs.readFileSync(path.join(wortel, bestand), 'utf8');
  const stukken = [];
  for (const n of namen) {
    const re = new RegExp('^function ' + n.replace(/[$]/g, '\\$') + '\\([\\s\\S]*?\\n\\}', 'm');
    const m = src.match(re);
    if (!m) throw new Error(`Functie '${n}' niet gevonden in ${bestand} — is hij hernoemd of verwijderd?`);
    stukken.push(m.group ? m.group(0) : m[0]);
  }
  return stukken.join('\n');
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
    '_hcpSlagenOpHole', '_berekenStand', 'berekenActiviteitsStats', 'bouwNaamNaarUid',
    'doelVerschuivingVoorSpeler', '_straf', 'scoreVoorPositie', '_uitslagTs', 'hashPin',
  ]);
  const bron = `
    const crypto = require('crypto');
    const PUNTEN_BASE = 1000000, PUNTEN_STAP = 100, FORS_STRAF = 50000000;
    const WEEK_MS = 7 * 24 * 3600 * 1000;
    ${f}
    return { _hcpSlagenOpHole, _berekenStand, berekenActiviteitsStats, bouwNaamNaarUid,
             doelVerschuivingVoorSpeler, _straf, scoreVoorPositie, _uitslagTs, hashPin };
  `;
  return new Function('require', bron)(require);
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

module.exports = { laadToernooiKern, laadLadderKern, maakChecker };
