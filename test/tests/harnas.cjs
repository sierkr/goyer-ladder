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
    // v5.13.0: dagInstelling() is de terugval per dag -> toernooi -> standaard.
    // berekenTPuntenVoorDag() roept hem aan; staat hij hier niet, dan knipt het
    // harnas alleen de aanroeper eruit en valt de hele toernooisuite om met
    // 'dagInstelling is not defined'. Zie dezelfde waarschuwing bij
    // laadLadderKern() hieronder.
    'dagInstelling',
    // v5.14.0: de toestand van een dag (concept / gestart / afgesloten).
    'dagIsGestart',
    // v5.15.0: dagPuntenUitSleutels() leunt nu op deze twee. Derde keer dat dit
    // misging — knip een nieuwe hulpfunctie ALTIJD mee, anders valt de hele
    // toernooisuite om op 'x is not defined'.
    'plaatsPuntenUitTekst', 'puntenVoorPlaats',
    // v5.16.0: de vijf indelingen. Pure functies, dus prima te knippen.
    'flightGroottes', 'knipInBanden', 'verdeelOmBeurten', 'verdeelWillekeurig',
    'verdeelOpStand', 'verdeelOpHandicapBanden', 'verdeelOpFlightHandicap',
    'verdeelNieuweTegenstanders',
    'getTHcpSlagen', 'berekenTPuntenVoorDag', 'berekenStrokeplayRanglijstVoorDag',
    'berekenStrokeplayTotaal', 'countback', 'getDag', 'actieveDag',
    'heeftGeenScores', 'alleScoresIngevuld', 'berekenFlightTijd',
    'berekenTPunten', '_liveScoresVanDag',
    // v5.11.0: _liveScoresVanDag lost nu de drie scorelagen op en heeft deze
    // drie nodig. Ze worden ECHT uit de app geknipt, net als de rest.
    '_laagVanDag', 'lagenVanDag', 'scoreOordeel',
    // v5.36.0: celWaarde bepaalt WELK getal ieder in zijn vakje ziet. De
    // wedstrijdleiding hoort het getal te zien dat meetelt, ook als alleen de
    // marker heeft ingevuld — anders tikt zij een leeg vakje over.
    'celWaarde',
    // v5.11.8: de volgorde bij een gelijke stand in matchplay.
    'matchplayVolgorde', 'hcpVan',
    // v5.12.0: speelwijze per dag en de dagpunten die twee speelwijzen
    // vergelijkbaar maken.
    'dagModus', 'heeftStrokeplayDag', 'gemengdeSpeelwijzen',
    'dagPuntenUitSleutels', 'dagPunten', 'dagPuntenTotaal',
    // v5.12.1: de toernooibrede keuze Matchplay/Strokeplay is uit het
    // aanmaakformulier verdwenen. Deze twee nemen die beslissing nu over uit
    // de dagblokken.
    'toernooiModusVanSpeelwijzen', 'zichtbaarheidVanSpeelwijzen',
    // v5.22.0: wacht dit toernooi nog, of loopt het? Die twee bepalen welk
    // toernooi een speler te zien krijgt.
    'toernooiIsConcept', 'toernooiLoopt',
    // v5.39.0: de balk onderaan het aanmaakscherm en de handmatige prijzen.
    'setupVolgendeStap',
    'prijsRegels', 'prijsRegelToe', 'prijsRegelWeg', 'prijsRegelWijzig', 'prijsSpelers',
    // v5.42.0: teams. teamScoresPerDag leunt op dagPunten en
    // berekenStrokeplayRanglijstVoorDag, die hierboven al meegeknipt worden —
    // ⚠ knip een nieuwe hulpfunctie ALTIJD mee, anders valt de hele
    // toernooisuite om op "x is not defined". Dat is nu vijf keer gebeurd.
    'teamStand', 'teamsVan', 'teamTellingVan', 'heeftAlleenStrokeplay',
    'teamHoogWint', 'teamScoresPerDag',
  ]);
  const k = knip('js/knockout.js', ['rondesNaarObj', 'objNaarRondes', 'verwerkKnockoutVoortgang']);
  const bron = `
    let toernooiData = null;
    let _liveScores = {};
    const window = { _bekijkDagNr: undefined, _ranglijstDagNr: undefined };
    ${t}
    ${k}
    return {
      dagInstelling, dagIsGestart, plaatsPuntenUitTekst, puntenVoorPlaats,
      flightGroottes, knipInBanden, verdeelOmBeurten, verdeelWillekeurig,
      verdeelOpStand, verdeelOpHandicapBanden, verdeelOpFlightHandicap,
      verdeelNieuweTegenstanders, getTHcpSlagen, berekenTPuntenVoorDag, berekenStrokeplayRanglijstVoorDag,
      berekenStrokeplayTotaal, countback, getDag, actieveDag, heeftGeenScores,
      alleScoresIngevuld, berekenFlightTijd, berekenTPunten, _liveScoresVanDag,
      matchplayVolgorde, hcpVan, celWaarde, scoreOordeel,
      teamStand, teamsVan, teamTellingVan, heeftAlleenStrokeplay,
      teamHoogWint, teamScoresPerDag,
      dagModus, heeftStrokeplayDag, gemengdeSpeelwijzen,
      dagPuntenUitSleutels, dagPunten, dagPuntenTotaal,
      toernooiModusVanSpeelwijzen, zichtbaarheidVanSpeelwijzen,
      toernooiIsConcept, toernooiLoopt,
      setupVolgendeStap,
      prijsRegels, prijsRegelToe, prijsRegelWeg, prijsRegelWijzig, prijsSpelers,
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

// ============================================================
//  v5.12.6 — DE SCORE IN HET KNOCKOUTSCHEMA
// ------------------------------------------------------------
//  knockoutMatchScore() was tot v5.12.5 geen functie maar een blok midden in
//  verwerkKnockoutUitslag(), en daardoor het enige stuk standberekening zonder
//  test — het harnas knipt losse functies uit. Hij had bovendien zijn eigen,
//  ingetikte slagentoekenning die alleen 'laagste SI' kende.
//
//  Nu leent hij slagenPerHole() en hcpInstellingen() van js/hcp.js, net als de
//  rest van de app. Ze worden hier ingespoten in plaats van meegeknipt, zodat
//  de test aantoont dat het ECHT dezelfde bron is en niet een tweede kopie.
// ============================================================
function laadKnockoutScoreKern() {
  const hcp = laadHcpKern().app;
  const bron = `
    ${knip('js/knockout.js', ['knockoutMatchScore'])}
    return { knockoutMatchScore };
  `;
  return new Function('slagenPerHole', 'hcpInstellingen', bron)(
    hcp.slagenPerHole, hcp.hcpInstellingen);
}

// ============================================================
//  v5.8.9 — DE MATCHPLAY-SCORE ('4&3')
// ------------------------------------------------------------
//  berekenMatchStand() bevriest de stand op het moment dat een partij beslist
//  is, matchScoreTekst() zet dat om in tekst. Alle schermen (rondescherm, live
//  scorebord, beheerscherm) gebruiken sinds v5.8.9 deze twee. Ze worden hier
//  ECHT uit js/ronde.js geknipt; wijzigt iemand ze, dan wijzigen de tests mee.
//  De handicapfuncties komen uit js/hcp.js, dus het is dezelfde verdeling van
//  slagen als in de app.
// ============================================================
function laadScoreKern() {
  const hcp = laadHcpKern().app;
  const bron = `
    const mijnPartij = () => null;
    ${knip('js/ronde.js', ['getHcpSlagenOpHole', 'berekenMatchStand',
                           'matchScoreTekst', 'matchWinnaarUitScores'])}
    return { berekenMatchStand, matchScoreTekst, matchWinnaarUitScores };
  `;
  return new Function('slagenOpHole', 'hcpInstellingen', bron)(hcp.slagenOpHole, hcp.hcpInstellingen);
}

// ============================================================
//  v5.11.0 — KORTE, UNIEKE NAMEN
// ------------------------------------------------------------
//  kortNaam() maakt van "Arjan van Venrooij" een "Arjan V" zodra er meer
//  Arjans meedoen. Het wordt gebruikt in de scorekaart, de onderlinge stand,
//  het archief en de groene pill van het uitslagenscherm. De functies worden
//  ECHT uit js/partij.js geknipt.
// ============================================================
function laadNaamKern() {
  const app = new Function(`
    ${knip('js/partij.js', ['splitsNaam', 'kortNaam', 'kortNaamMap'])}
    return { splitsNaam, kortNaam, kortNaamMap };
  `)();
  // v5.11.9: de meekijkpagina staat los van de app en heeft een eigen kopie.
  // Die wordt hier ook geknipt, zodat de test kan bewijzen dat beide kanten
  // hetzelfde doen. Lopen ze uit de pas, dan staan er twee namen voor dezelfde
  // speler op twee schermen.
  const meekijk = new Function(`
    ${knip('toernooi-live.html', ['splitsNaam', 'kortNaam', 'kortNaamMap'])}
    return { splitsNaam, kortNaam, kortNaamMap };
  `)();
  return { ...app, app, meekijk };
}

// ============================================================
//  v5.11.0 — MARKERS: wie markeert wie, en welke kleur hoort erbij
// ------------------------------------------------------------
//  markerKring() verdeelt de markers over een flight, scoreOordeel() bepaalt
//  per hole welke score telt en welke kleur hij krijgt. Beide uit
//  js/toernooi.js geknipt, zodat de tests met de app meebewegen.
// ============================================================
function laadMarkerKern() {
  const bron = `
    ${knip('js/toernooi.js', ['markerKring', 'scoreOordeel', 'kaartOordeel', 'herschikMarkers'])}
    return { markerKring, scoreOordeel, kaartOordeel, herschikMarkers };
  `;
  return new Function(bron)();
}

// ============================================================
//  v5.11.7 — DE GASTLOGIN, VAN BEIDE KANTEN
// ------------------------------------------------------------
//  Twee bestanden moeten hier precies hetzelfde doen:
//    js/toernooi.js  gastLoginVan()  maakt het account aan
//    js/auth.js      gastKernVan()   herkent wat de gast intikt
//  Lopen ze uit de pas, dan bestaat het account wel maar komt de gast er niet
//  in — en dat merk je pas op de eerste tee. Beide worden hier ECHT uit de app
//  geknipt en in de test tegen elkaar gelegd.
// ============================================================
function laadGastloginKern() {
  const maak = new Function(`
    ${knip('js/toernooi.js', ['splitsNaam', 'gastLoginVan', 'toernooiCodeVan',
      // v5.12.3: de gastcode moet uniek zijn, en het briefje dat de spelers
      // krijgen wordt hier opgemaakt.
      'uniekeGastCode', 'gastloginTekst',
      // v5.18.0: het uitlezen van een geplakte gastenlijst.
      'gastenUitTekst'])}
    // v5.38.0: hashPinTekst is async. Het voorvoegsel moet dus mee, anders
    // vindt knip() hem niet.
    // LET OP: geen accolade-aanhalingstekens in dit commentaar — het staat
    // binnen een sjabloontekst en breekt die af.
    ${knip('js/toernooi.js', ['hashPinTekst'], 'async ')}
    return { splitsNaam, gastLoginVan, toernooiCodeVan, uniekeGastCode, gastloginTekst,
             gastenUitTekst, hashPinTekst };
  `)();
  // v5.12.3: gastLoginUitToernooi zoekt de ECHTE inlognaam op in het toernooi,
  // in plaats van hem uit te rekenen. Het is de tegenhanger van gastLoginVan:
  // wat de ene schrijft, moet de andere terugvinden.
  const herken = new Function(`
    ${knip('js/auth.js', ['gastKernVan', 'gastLoginUitToernooi'])}
    return { gastKernVan, gastLoginUitToernooi };
  `)();
  return { ...maak, ...herken };
}

// ============================================================
//  v5.37.0 — DE QR-CODE
// ------------------------------------------------------------
//  Het patroon van zwarte vakjes staat uitgeschreven in js/toernooi.js. Een
//  telefoon die hem niet leest is hier niet na te meten — daar is geen QR-lezer
//  op de machine, en de browser van de tests heeft er ook geen. Wat wél na te
//  meten is: of het patroon de vorm HEEFT van een geldige QR-code (vierkant,
//  drie zoekblokken) en of het tekenwerk eromheen klopt. Gaat daar iets stuk,
//  dan is er ook niets meer te scannen.
// ============================================================
function laadQrKern() {
  const src = fs.readFileSync(path.join(wortel, 'js/toernooi.js'), 'utf8');
  const patroon = (naam) => {
    const m = src.match(new RegExp('^const ' + naam + ' = `([\\s\\S]*?)`;', 'm'));
    if (!m) throw new Error(`Patroon '${naam}' niet gevonden in js/toernooi.js.`);
    return m[1];
  };
  const url = (naam) => {
    const m = src.match(new RegExp("^const " + naam + " = '([^']*)';", 'm'));
    if (!m) throw new Error(`Adres '${naam}' niet gevonden in js/toernooi.js.`);
    return m[1];
  };
  const f = new Function(`${knip('js/toernooi.js', ['qrSvg'])}\nreturn { qrSvg };`)();
  return { ...f, QR_LIVE: patroon('QR_LIVE'), QR_TEST: patroon('QR_TEST'),
           QR_LIVE_URL: url('QR_LIVE_URL'), QR_TEST_URL: url('QR_TEST_URL') };
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

// ============================================================
//  v5.34.1 — WELKE CLUBSTIJL IS DIT?
// ------------------------------------------------------------
//  Deze regel stond op twee plekken en liep uit de pas: de meeluisteraar op
//  ladder/config kende Papier niet en zette het scherm terug op Helder. Nu één
//  bron, en die wordt hier uit de ECHTE code geknipt — samen met de lijst
//  stijlen, zodat een vierde stijl de test meteen meeneemt.
function laadStijlKern() {
  const bron = `
    ${knipConstanteRegel('js/config.js', 'STIJLEN')}
    ${knip('js/config.js', ['normaliseerClubStijl'], 'export ')}
    return { STIJLEN, normaliseerClubStijl };
  `;
  return new Function(bron)();
}

// Knipt een eenregelige `const NAAM = ...;` uit een module.
function knipConstanteRegel(bestand, naam) {
  const src = fs.readFileSync(path.join(wortel, bestand), 'utf8');
  const re = new RegExp('^(?:export )?const ' + naam + ' = .*;$', 'm');
  const m = src.match(re);
  if (!m) throw new Error(`Constante '${naam}' niet gevonden in ${bestand}.`);
  return m[0].replace(/^export /, '');
}

module.exports = { laadStijlKern, laadToernooiKern, laadLadderKern, laadHcpKern, laadScoreKern,
                   laadKnockoutScoreKern,
                   laadNaamKern, laadMarkerKern, laadGastloginKern, laadQrKern, maakChecker };
