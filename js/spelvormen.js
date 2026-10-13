// ============================================================
//  spelvormen.js — de rekenregels van de spelvormen (v5.51.0)
// ============================================================
//  Sierk, 12–13 oktober 2026: "De app kent nu drie spelvormen, welke andere
//  zijn nog leuk?" — en daarna: Taliban erbij, en "Voeg de andere voorgestelde
//  spelvormen ook toe", met per ladder in Beheer "zichtbaar ja/nee" en "telt
//  mee ja/nee". Matchplay is altijd zichtbaar en telt altijd mee.
//
//  WAAROM EEN EIGEN BESTAND. Alles hier is puur rekenwerk: scores erin,
//  punten en een eindstand eruit. Geen scherm, geen database. Daardoor is het
//  los te testen (tests/spelvormen.test.cjs laadt dit bestand rechtstreeks),
//  en staat elke regel op één plek. js/ronde.js tekent het, js/partij.js laat
//  kiezen, functions/index.js verschuift de ladder.
//
//  ⚠ Matchplay en High-Low staan hier NIET in: die hebben hun eigen, oudere
//  code in js/ronde.js en die is met opzet niet aangeraakt. Het Amerikaantje
//  staat er wel in, omdat de Taliban-regel erbovenop komt; de gewone telling
//  is letterlijk overgenomen uit berekenAmerikaaanjeHole() van v5.8.0.
//
//  Invoer per spelvorm is steeds per HOLE een rij met per speler een getal
//  (netto of bruto slagen) of null als die nog niet is ingevuld. Spelers
//  worden aangeduid met hun plek in de partij (0, 1, 2, 3), niet met een uid:
//  de omzetting gebeurt in js/ronde.js.
// ============================================================

// ─── Welke spelvormen er zijn ───────────────────────────────
//  min/max  aantal spelers
//  nieuw    sinds v5.51.0: staat op een bestaande ladder standaard op
//           "niet zichtbaar" en "telt niet mee", tot de beheerder hem aanzet.
//  extra    er hoort per hole meer bij dan de slagen ('wolf' of 'bbb')
export const SPELVORMEN = Object.freeze({
  matchplay:    { naam: 'Matchplay',         min: 2, max: 4, vast: true },
  amerikaantje: { naam: 'Amerikaantje',      min: 3, max: 3 },
  highlow:      { naam: 'High-Low',          min: 4, max: 4 },
  skins:        { naam: 'Skins',             min: 2, max: 4, nieuw: true,
    uitleg: 'Laagste nettoscore wint de hole. Gelijk = de hole schuift door naar de volgende.' },
  stableford:   { naam: 'Stableford',        min: 2, max: 4, nieuw: true,
    uitleg: 'Punten per hole: netto par 2, birdie 3, bogey 1, slechter 0. Meeste punten wint.' },
  nassau:       { naam: 'Nassau',            min: 2, max: 2, nieuw: true,
    uitleg: 'Drie wedstrijden: voorste helft, achterste helft en totaal. Wie er de meeste wint, wint.' },
  sixes:        { naam: 'Sixes',             min: 4, max: 4, nieuw: true,
    uitleg: 'Elk derde van de ronde andere koppels (1+2, dan 1+3, dan 1+4). Beste bal per koppel; elk gewonnen hole is een punt voor beide.' },
  wolf:         { naam: 'Wolf',              min: 4, max: 4, nieuw: true, extra: 'wolf',
    uitleg: 'Per hole een andere wolf. Die kiest een partner of speelt alleen. Met partner: winst 2 punten elk, wint de andere kant 3 punten elk. Alleen: winst 4 punten, verlies 1 punt voor elk van de anderen.' },
  bbb:          { naam: 'Bingo Bango Bongo', min: 2, max: 4, nieuw: true, extra: 'bbb',
    uitleg: 'Drie punten per hole: eerst op de green (bingo), dichtst bij de vlag als iedereen op de green ligt (bango), eerst in de hole (bongo).' },
});

export const SPELVORM_VOLGORDE = Object.freeze(
  ['matchplay', 'amerikaantje', 'highlow', 'skins', 'stableford', 'nassau', 'sixes', 'wolf', 'bbb']);

export const NIEUWE_SPELVORMEN = Object.freeze(
  SPELVORM_VOLGORDE.filter(t => SPELVORMEN[t].nieuw === true));

// ─── Bonussen bij Skins (v5.52.0) ───────────────────────────
//  Sierk, 13 oktober 2026: "Bij skins kan je toch ook punten halen bij up en
//  down vanuit een bunker?" — "Ook andere bonussen en maak de keuze
//  selecteerbaar." Besluiten: alle bonussen los aan te vinken bij het
//  aanmaken; waarde "skin" (telt mee in de uitslag en dus de ladder) of "punt"
//  (aparte stand, telt niet mee); kiezen of een bonus ook telt op een hole die
//  doorschuift; alleen bij Skins. Een bonus wint nooit de pot van een hole:
//  hij is één eenheid waard ("wat gebruikelijk is").
//
//  invoer      wie het haalde wordt per hole aangetikt
//  auto        volgt uit de score (birdie)
//  parOfBeter  telt alleen als die speler op die hole par of beter maakte
//              (echte slagen) — dat controleert de app zelf
//  alleenPar3  alleen op een par 3 (greenie)
//  eenSpeler   maar één speler per hole (greenie: wie het dichtst lag)
export const BONUSSEN = Object.freeze({
  sandy:   { naam: 'Sandy',   uitleg: 'par of beter na een bunker',           invoer: true, parOfBeter: true },
  greenie: { naam: 'Greenie', uitleg: 'par 3: dichtst bij de vlag én par',    invoer: true, parOfBeter: true, alleenPar3: true, eenSpeler: true },
  chippie: { naam: 'Chippie', uitleg: 'chip in één keer in',                  invoer: true },
  birdie:  { naam: 'Birdie',  uitleg: 'echte birdie of beter — volgt uit de score', auto: true },
  barkie:  { naam: 'Barkie',  uitleg: 'par of beter na een boom',             invoer: true, parOfBeter: true },
  polie:   { naam: 'Polie',   uitleg: 'lange putt — de lengte spreken jullie af', invoer: true },
});
export const BONUS_VOLGORDE = Object.freeze(['sandy', 'greenie', 'chippie', 'birdie', 'barkie', 'polie']);

// De instellingen van een partij, schoongemaakt. Onbekende bonussen vallen weg.
export function bonusInstellingen(b) {
  const aan = Array.isArray(b?.aan) ? b.aan.filter(k => BONUS_VOLGORDE.includes(k)) : [];
  return {
    aan: BONUS_VOLGORDE.filter(k => aan.includes(k)),
    waarde: b?.waarde === 'punt' ? 'punt' : 'skin',
    doorschuiven: b?.doorschuiven !== false,
  };
}

export function isNieuweSpelvorm(speltype) {
  return NIEUWE_SPELVORMEN.includes(String(speltype || ''));
}

export function spelvormNaam(speltype) {
  return SPELVORMEN[speltype]?.naam || 'Matchplay';
}

// ─── Zichtbaar in het partijformulier? ──────────────────────
//  Matchplay altijd. Staat er voor deze ladder niets ingesteld, dan zijn de
//  drie oude spelvormen zichtbaar (zoals altijd) en de nieuwe niet.
//  ⚠ Dit gaat alleen over KIEZEN. Een lopende partij met een spelvorm die
//  intussen is uitgezet, wordt gewoon afgemaakt.
export function spelvormZichtbaar(cfg, speltype) {
  const t = String(speltype || 'matchplay');
  if (t === 'matchplay') return true;
  if (!SPELVORMEN[t]) return false;
  const zicht = cfg && cfg.spelvormenZichtbaar;
  if (zicht && typeof zicht === 'object' && t in zicht) return zicht[t] !== false;
  return !isNieuweSpelvorm(t);
}

// ─── Eindstand uit totalen ──────────────────────────────────
//  Wie het hoogst scoort is 1e. Gelijke totalen delen de plek, en de plek
//  daarna wordt overgeslagen: 1, 1, 3 — zoals het Amerikaantje al deed.
export function rangschik(totalen) {
  const n = totalen.length;
  const idx = [...Array(n).keys()].sort((a, b) => totalen[b] - totalen[a]);
  const pos = new Array(n);
  idx.forEach((i, k) => {
    pos[i] = (k > 0 && totalen[i] === totalen[idx[k - 1]]) ? pos[idx[k - 1]] : k + 1;
  });
  return pos;
}

// Is dit een geldige eindstand voor n spelers? Elke plek is ofwel gelijk aan
// de vorige (gedeeld), ofwel precies het rangnummer.
export function geldigePosities(posities, n) {
  if (!Array.isArray(posities) || posities.length !== n || n < 2) return false;
  const p = posities.map(Number);
  if (p.some(x => !Number.isInteger(x) || x < 1 || x > n)) return false;
  const s = p.slice().sort((a, b) => a - b);
  if (s[0] !== 1) return false;
  for (let k = 1; k < n; k++) {
    if (s[k] !== s[k - 1] && s[k] !== k + 1) return false;
  }
  return true;
}

// ─── Ladderverschuiving voor de nieuwe spelvormen ───────────
//  Goedgekeurd door Sierk op 13 oktober 2026:
//    2 spelers  +1 / −1
//    3 spelers  +2 / 0 / −2          (gelijk aan het Amerikaantje)
//    4 spelers  +2 / +1 / −1 / −2
//  Gedeelde plek: het gemiddelde van de gedeelde plekken, afgerond naar 0.
//  Voor 3 spelers geeft dat precies de tabel van het Amerikaantje
//  (1-1-3 → +1 +1 −2, 1-2-2 → +2 −1 −1, 1-1-1 → 0 0 0).
//
//  ⚠ KOPIE OP DE SERVER: functions/index.js, verschuivingPosities(). Die is
//  het die de ladder echt verschuift; deze hier is alleen voor de tekst op
//  het scherm. Verandert de regel, dan BEIDE aanpassen — de rekentest
//  vergelijkt ze.
export const BASIS_VERSCHUIVING = Object.freeze({
  2: [1, -1],
  3: [2, 0, -2],
  4: [2, 1, -1, -2],
});

export function verschuivingPosities(posities) {
  const p = Array.isArray(posities) ? posities.map(Number) : [];
  const basis = BASIS_VERSCHUIVING[p.length];
  if (!basis || !geldigePosities(p, p.length)) return null;
  return p.map(pos => {
    const k = p.filter(x => x === pos).length;            // zoveel delen deze plek
    let som = 0;
    for (let r = pos; r < pos + k; r++) som += basis[r - 1];
    const gem = som / k;
    return Math.trunc(gem) + 0;                            // + 0: geen −0
  });
}

export function uitlegVerschuiving(n) {
  const b = BASIS_VERSCHUIVING[n];
  if (!b) return '';
  const t = x => (x > 0 ? '+' + x : x < 0 ? '−' + Math.abs(x) : '0');
  const plek = ['Winnaar', 'tweede', 'derde', 'vierde'];
  if (n === 2) return `Winnaar ${t(b[0])} · verliezer ${t(b[1])}`;
  return b.map((x, i) => `${plek[i]} ${t(x)}`).join(' · ');
}

// ─── Hulp ───────────────────────────────────────────────────
const compleet = rij => Array.isArray(rij) && rij.length > 0 && rij.every(v => v !== null && v !== undefined);
const nullen   = n => new Array(n).fill(0);
const somPer   = (perHole, n) => {
  const t = nullen(n);
  perHole.forEach(h => { if (h && h.punten) h.punten.forEach((v, i) => { t[i] += v; }); });
  return t;
};
const tekstVan = punten => punten.map(v => (v === 0.5 ? '½' : String(v))).join('-');

// ─── Amerikaantje, met of zonder Taliban ────────────────────
//  netto  rij van 3
//  opties { taliban: bool, basis: rij van 3 (netto of bruto), par }
//
//  Taliban (Sierk, 13 oktober 2026): maakt één speler birdie of beter en zijn
//  BEIDE anderen minstens 2 slagen slechter, dan krijgt hij alle 6 punten.
//  Dus birdie tegen bogey, eagle tegen par, albatros tegen birdie. Par tegen
//  dubbele bogey telt NIET: "birdie of beter nodig". Of birdie en bogey netto
//  of bruto gelden, kies je bij het starten van de partij; de gewone telling
//  blijft altijd netto.
export function amerikaantjeHole(netto, opties = {}) {
  if (!compleet(netto) || netto.length !== 3) return null;
  if (opties.taliban && compleet(opties.basis) && Number.isFinite(Number(opties.par))) {
    const b = opties.basis.map(Number), par = Number(opties.par);
    for (let i = 0; i < 3; i++) {
      const anderen = b.filter((_, j) => j !== i);
      if (b[i] <= par - 1 && anderen.every(x => x >= b[i] + 2)) {
        return b.map((_, j) => (j === i ? 6 : 0));
      }
    }
  }
  const gesorteerd = [...netto].sort((a, b) => a - b);
  const [laagste, tweede, hoogste] = gesorteerd;
  return netto.map(n => {
    if (n === laagste && n === tweede && n === hoogste) return 2; // 2-2-2
    if (n === laagste && n === tweede) return 3;                  // 3-3-0
    if (n === tweede  && n === hoogste) return 1;                 // 4-1-1
    if (n === laagste) return 4;
    if (n === tweede)  return 2;
    return 0;
  });
}

// ─── Skins ──────────────────────────────────────────────────
//  Elke hole is een skin waard. Eén laagste nettoscore: hij pakt de skin plus
//  wat er was blijven liggen. Gelijk: de skin schuift door.
//  ⚠ De holes worden op volgorde afgewerkt. Staat er een hole nog open, dan
//  wordt daarna niets meer beslist — wat er doorschuift hangt van die hole af.
function skins(inv) {
  const { netto, n } = inv;
  const perHole = [];
  let pot = 1, open = false;
  netto.forEach(rij => {
    if (open || !compleet(rij)) { open = true; perHole.push(null); return; }
    const min = Math.min(...rij);
    const winnaars = rij.map((v, i) => (v === min ? i : -1)).filter(i => i >= 0);
    if (winnaars.length === 1) {
      const punten = nullen(n); punten[winnaars[0]] = pot;
      perHole.push({ punten, tekst: tekstVan(punten) });
      pot = 1;
    } else {
      perHole.push({ punten: nullen(n), tekst: `→ ${pot + 1}`, doorgeschoven: true });
      pot += 1;
    }
  });
  const skinsTotalen = somPer(perHole, n);
  const info = { blijftLiggen: open ? 0 : pot - 1 };

  // v5.52.0: bonussen. Zonder aangevinkte bonussen verandert er niets.
  const b = bonusInstellingen(inv.bonus);
  if (!b.aan.length) return { perHole, totalen: skinsTotalen, info };
  const bonusPerHole = netto.map((_, h) => bonusOpHole(inv, b, h, perHole[h]));
  const bonusTotalen = nullen(n);
  bonusPerHole.forEach(r => { if (r) r.forEach((v, i) => { bonusTotalen[i] += v; }); });
  info.bonus = { instellingen: b, perHole: bonusPerHole, totalen: bonusTotalen };
  info.skinsTotalen = skinsTotalen;
  // "skin": de bonus telt mee in de uitslag. "punt": aparte stand.
  const totalen = b.waarde === 'skin' ? skinsTotalen.map((v, i) => v + bonusTotalen[i]) : skinsTotalen;
  return { perHole, totalen, info };
}

// De bonussen van één hole, per speler, of null als er (nog) niets te tellen
// valt. `skinHole` is wat Skins van die hole maakte: null = nog open.
//  doorschuiven = ja  → een bonus telt altijd, ook op een hole die doorschuift
//                       of nog open staat (de bonus hangt niet aan de skin).
//  doorschuiven = nee → alleen op een hole waar iemand de skin won.
function bonusOpHole(inv, b, h, skinHole) {
  const { n, holes, bruto } = inv;
  if (!b.doorschuiven && (!skinHole || skinHole.doorgeschoven)) return null;
  const par = Number(holes?.[h]?.par) || 4;
  const echte = i => {
    const v = bruto?.[h]?.[i];
    return v === null || v === undefined || v === '' ? null : Number(v);
  };
  const extra = inv.extra?.bonus || {};
  const punten = nullen(n);
  let iets = false;
  b.aan.forEach(k => {
    const def = BONUSSEN[k];
    if (def.auto) {                                   // birdie
      for (let i = 0; i < n; i++) {
        const v = echte(i);
        if (v !== null && v <= par - 1) { punten[i] += 1; iets = true; }
      }
      return;
    }
    if (def.alleenPar3 && par !== 3) return;
    let wie = (extra[k] || [])[h];
    wie = Array.isArray(wie) ? wie.filter(i => Number.isInteger(i) && i >= 0 && i < n) : [];
    if (def.eenSpeler) wie = wie.slice(0, 1);
    wie.forEach(i => {
      if (def.parOfBeter) {
        const v = echte(i);
        if (v === null || v > par) return;            // geen par: telt niet
      }
      punten[i] += 1; iets = true;
    });
  });
  return iets ? punten : null;
}

// ─── Stableford ─────────────────────────────────────────────
function stableford(inv) {
  const { netto, holes, n } = inv;
  const perHole = netto.map((rij, h) => {
    if (!compleet(rij)) return null;
    const par = Number(holes[h]?.par) || 4;
    const punten = rij.map(v => Math.max(0, 2 + par - v));
    return { punten, tekst: tekstVan(punten) };
  });
  return { perHole, totalen: somPer(perHole, n) };
}

// ─── Nassau (2 spelers) ─────────────────────────────────────
//  Per hole: laagste netto wint de hole. Drie wedstrijden: de voorste helft
//  van de gespeelde holes, de achterste helft, en alles. Bij 18 holes 9 + 9;
//  bij een oneven aantal heeft de voorste helft er één meer.
//  Eindtotaal: per gewonnen wedstrijd 1 punt, gelijk ½.
export function nassauHelften(aantalHoles) {
  const voor = Math.ceil(aantalHoles / 2);
  return { voor, achter: aantalHoles - voor };
}
function nassau(inv) {
  const { netto, n } = inv;
  if (n !== 2) return { perHole: netto.map(() => null), totalen: nullen(n) };
  const perHole = netto.map(rij => {
    if (!compleet(rij)) return null;
    const punten = rij[0] < rij[1] ? [1, 0] : rij[0] > rij[1] ? [0, 1] : [0.5, 0.5];
    return { punten, tekst: tekstVan(punten) };
  });
  const { voor } = nassauHelften(netto.length);
  const stand = (van, tot) => {
    let a = 0, b = 0, gespeeld = 0;
    for (let h = van; h < tot; h++) {
      const x = perHole[h]; if (!x) continue;
      gespeeld++;
      if (x.punten[0] === 1) a++; else if (x.punten[1] === 1) b++;
    }
    return { verschil: a - b, gespeeld, holes: tot - van };
  };
  const wedstrijden = [
    { naam: 'Voor',   ...stand(0, voor) },
    { naam: 'Achter', ...stand(voor, netto.length) },
    { naam: 'Totaal', ...stand(0, netto.length) },
  ];
  const totalen = [0, 0];
  wedstrijden.forEach(w => {
    if (!w.gespeeld) return;
    if (w.verschil > 0) totalen[0] += 1;
    else if (w.verschil < 0) totalen[1] += 1;
    else { totalen[0] += 0.5; totalen[1] += 0.5; }
  });
  return { perHole, totalen, info: { wedstrijden } };
}

// ─── Sixes (4 spelers) ──────────────────────────────────────
//  De ronde in drie stukken, steeds andere koppels:
//    stuk 1: 1+2 tegen 3+4 · stuk 2: 1+3 tegen 2+4 · stuk 3: 1+4 tegen 2+3
//  Per hole telt de beste nettobal van elk koppel. Het lagere koppel wint de
//  hole: beide spelers een punt. Gelijk: niemand.
export const SIXES_KOPPELS = Object.freeze([
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]);
export function sixesStuk(holeIdx, aantalHoles) {
  const lengte = Math.ceil(aantalHoles / 3) || 1;
  return Math.min(2, Math.floor(holeIdx / lengte));
}
function sixes(inv) {
  const { netto, n } = inv;
  if (n !== 4) return { perHole: netto.map(() => null), totalen: nullen(n) };
  const perHole = netto.map((rij, h) => {
    if (!compleet(rij)) return null;
    const [k1, k2] = SIXES_KOPPELS[sixesStuk(h, netto.length)];
    const b1 = Math.min(...k1.map(i => rij[i]));
    const b2 = Math.min(...k2.map(i => rij[i]));
    const punten = nullen(4);
    if (b1 < b2) k1.forEach(i => { punten[i] = 1; });
    else if (b2 < b1) k2.forEach(i => { punten[i] = 1; });
    return { punten, tekst: tekstVan(punten) };
  });
  return { perHole, totalen: somPer(perHole, n) };
}

// ─── Wolf (4 spelers) ───────────────────────────────────────
//  De wolf wisselt per hole: hole 1 speler 1, hole 2 speler 2, enz. Na de
//  afslagen kiest de wolf een partner of speelt alleen; dat wordt per hole
//  ingevuld (keuze = plek van de partner, of 'alleen').
//  Telling (een veelgebruikte variant, vastgelegd 13 oktober 2026):
//    met partner — wolf + partner winnen: 2 punten elk
//                  de andere twee winnen: 3 punten elk
//    alleen      — wolf wint: 4 punten · wolf verliest: 1 punt voor elk van de anderen
//    gelijk      — niemand
//  Gewonnen = de beste nettobal van de kant is lager.
export function wolfVan(holeIdx) { return holeIdx % 4; }
function wolf(inv) {
  const { netto, n, extra } = inv;
  const keuzes = (extra && extra.wolf) || [];
  if (n !== 4) return { perHole: netto.map(() => null), totalen: nullen(n) };
  const perHole = netto.map((rij, h) => {
    if (!compleet(rij)) return null;
    const w = wolfVan(h);
    const k = keuzes[h];
    const punten = nullen(4);
    if (k === 'alleen') {
      const anderen = [0, 1, 2, 3].filter(i => i !== w);
      const best = Math.min(...anderen.map(i => rij[i]));
      if (rij[w] < best) punten[w] = 4;
      else if (best < rij[w]) anderen.forEach(i => { punten[i] = 1; });
      return { punten, tekst: tekstVan(punten) };
    }
    // ⚠ v5.51.1 — "NIETS GEKOZEN" IS GEEN SPELER 1.
    //  Zodra er op één hole een keuze is gemaakt, staat er voor alle andere
    //  holes null in de lijst. Number(null) is 0, en 0 is speler 1: een hole
    //  waar de wolf nog niets koos, telde daardoor alsof hij speler 1 als
    //  partner nam. Sierk zag het op test (13 oktober 2026): bij hole 3 stond
    //  0-3-0-3 terwijl Roy nog "kies…" had staan. De test had het gemist
    //  omdat "niets gekozen" alleen op een hole van speler 1 zelf werd getest.
    if (k === null || k === undefined || k === '') {
      return { punten: null, tekst: 'kies', open: true };
    }
    const partner = Number(k);
    if (!Number.isInteger(partner) || partner < 0 || partner > 3 || partner === w) {
      return { punten: null, tekst: 'kies', open: true };
    }
    const team = [w, partner];
    const tegen = [0, 1, 2, 3].filter(i => !team.includes(i));
    const bt = Math.min(...team.map(i => rij[i]));
    const bo = Math.min(...tegen.map(i => rij[i]));
    if (bt < bo) team.forEach(i => { punten[i] = 2; });
    else if (bo < bt) tegen.forEach(i => { punten[i] = 3; });
    return { punten, tekst: tekstVan(punten) };
  });
  return { perHole, totalen: somPer(perHole, n) };
}

// ─── Bingo Bango Bongo (2–4 spelers) ────────────────────────
//  Drie punten per hole, los van de slagen: bingo (eerst op de green), bango
//  (dichtst bij de vlag als iedereen op de green ligt), bongo (eerst in de
//  hole). Per hole worden die drie aangewezen; wat nog niet is aangewezen
//  telt nog niet.
function bbb(inv) {
  const { netto, n, extra } = inv;
  const e = extra || {};
  const perHole = netto.map((_, h) => {
    const toegekend = ['bingo', 'bango', 'bongo']
      .map(s => (e[s] || [])[h])
      .filter(v => Number.isInteger(v) && v >= 0 && v < n);
    if (!toegekend.length) return null;
    const punten = nullen(n);
    toegekend.forEach(i => { punten[i] += 1; });
    return { punten, tekst: tekstVan(punten) };
  });
  return { perHole, totalen: somPer(perHole, n) };
}

// ─── De ingang ──────────────────────────────────────────────
//  inv = { n, holes: [{par, si}], netto: [hole][speler], extra }
//  Geeft { perHole, totalen, posities, info } of null bij een onbekende vorm.
const REKEN = { skins, stableford, nassau, sixes, wolf, bbb };

export function berekenSpelvorm(speltype, inv) {
  const f = REKEN[speltype];
  if (!f) return null;
  const n = inv?.n || 0;
  const uit = f({ ...inv, n });
  return { ...uit, posities: rangschik(uit.totalen), info: uit.info || {} };
}

// Hoeveel holes zijn helemaal beslist? (Voor "is er een kaart om de eindstand
// uit af te leiden".)
export function besliste(perHole) {
  return (perHole || []).filter(h => h && Array.isArray(h.punten)).length;
}
