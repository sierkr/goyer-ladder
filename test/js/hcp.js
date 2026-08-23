// ============================================================
//  hcp.js — Handicapverrekening (v5.8.0)
// ============================================================
//  WAAROM DIT BESTAND BESTAAT
//
//  Tot v5.7.3 stond de slagentoekenning op zes plekken los van elkaar:
//  het partijformulier, de ronde, speler-toevoegen, handicap-wijzigen, de
//  live-volgpagina en de server. Elk met een eigen kopie van dezelfde regel,
//  inclusief een hard ingetikte 0.75. Toen de spelvormen Amerikaantje en
//  High-Low erbij kwamen is een deel van die kopieen wel aangepast en een
//  deel niet — waardoor het blok "Handicap slagen" iets anders liet zien dan
//  de app uitrekende.
//
//  Vanaf v5.8.0 is dit de enige plek waar bepaald wordt hoeveel slagen wie
//  krijgt en op welke hole. Verandert de regel, dan verandert hij overal
//  tegelijk. De server (functions/index.js) en de volgpagina (watch.html)
//  hebben om technische redenen een eigen kopie van slagenPerHole(); die twee
//  staan met naam en al gemarkeerd zodat ze meebewegen.
// ============================================================

// ─── Instellingen van een partij ────────────────────────────
//  hcpPct        0..1   deel van de handicap dat verrekend wordt (0.75 = 75%)
//  hcpVerdeling  'volledig' | 'relatief'
//                volledig  = iedereen krijgt zijn eigen handicap x percentage
//                relatief  = de laagste handicap krijgt 0, de rest het
//                            verschil met hem x percentage
//                (alleen van belang bij Amerikaantje en High-Low; matchplay
//                 is per definitie relatief)
//  hcpPlaatsing  'laag' | 'vanaf'
//                laag   = slagen op de zwaarste holes, SI 1 t/m n
//                vanaf  = slagen op SI n+1 t/m 2n; bij 4 slagen dus SI 5 t/m 8
export const HCP_STANDAARD = Object.freeze({
  hcpPct: 0.75,
  hcpVerdeling: 'volledig',
  hcpPlaatsing: 'laag',
});

// Leest de instellingen van een partij (of toernooi) met terugval op de
// standaard. Partijen van voor v5.8.0 hebben deze velden niet en gedragen
// zich daardoor exact zoals ze deden.
export function hcpInstellingen(p) {
  const pct = Number(p?.hcpPct);
  return {
    pct: Number.isFinite(pct) && pct >= 0 && pct <= 1 ? pct : HCP_STANDAARD.hcpPct,
    verdeling: p?.hcpVerdeling === 'relatief' ? 'relatief' : 'volledig',
    plaatsing: p?.hcpPlaatsing === 'vanaf' ? 'vanaf' : 'laag',
  };
}

// Korte omschrijving voor op het scherm, bijv. "75% · relatief · vanaf SI"
export function hcpOmschrijving(p, speltype) {
  const i = hcpInstellingen(p);
  const delen = [Math.round(i.pct * 100) + '%'];
  // Bij matchplay zegt "volledig/relatief" niets: daar is het altijd het
  // onderlinge verschil. Alleen tonen waar het betekenis heeft.
  if (speltype === 'amerikaantje' || speltype === 'highlow') {
    delen.push(i.verdeling === 'relatief' ? 'relatief' : 'volledig');
  }
  delen.push(i.plaatsing === 'vanaf' ? 'slagen vanaf SI' : 'laagste SI');
  return delen.join(' · ');
}

// ─── Kern: waar vallen de slagen? ───────────────────────────
//  Geeft een lijst terug even lang als `holes`, met per hole het aantal
//  slagen. De volgorde wordt bepaald door de stroke index van de holes die
//  daadwerkelijk gespeeld worden — niet door de SI-nummers zelf.
//
//  v5.8.0 — WAT ER MIS WAS BIJ MINDER DAN 18 HOLES.
//  De oude regel was `hole.si <= aantalSlagen`. Bij een volle ronde klopt
//  dat, want dan liggen de SI's 1 t/m 18 allemaal op de kaart. Speelde je
//  negen holes met bijvoorbeeld de even SI's (2,4,6...18), dan kreeg iemand
//  met vier slagen er maar twee — de holes met SI 1 en 3 lagen immers niet
//  op zijn kaart. Vier afgesproken slagen werden er stilletjes twee. Nu
//  worden de gespeelde holes op SI gesorteerd en krijgen de n zwaarste een
//  slag, zodat n slagen ook echt n slagen zijn.
export function slagenPerHole(totaalSlagen, holes, plaatsing = 'laag') {
  const H = Array.isArray(holes) ? holes.length : 0;
  const uit = new Array(H).fill(0);
  const n = Math.max(0, Math.round(Number(totaalSlagen) || 0));
  if (H === 0 || n === 0) return uit;

  // Holes op zwaarte: laagste stroke index eerst. Bij een gelijke of
  // ontbrekende SI beslist de speelvolgorde, zodat de uitkomst altijd
  // dezelfde is — ook op de server.
  const opZwaarte = holes
    .map((h, i) => ({ i, si: Number(h?.si) > 0 ? Number(h.si) : (i + 1) }))
    .sort((a, b) => a.si - b.si || a.i - b.i);

  if (plaatsing === 'vanaf' && n < H) {
    // Sla de n zwaarste holes over en begin daarna. Bij 4 slagen dus de
    // 5e t/m 8e hole op zwaarte. Passen ze niet allemaal achter elkaar,
    // dan loopt hij door bij de zwaarste hole.
    for (let k = 0; k < n; k++) uit[opZwaarte[(n + k) % H].i]++;
  } else {
    // Zwaarste holes eerst. Meer slagen dan holes: iedere hole krijgt er
    // een, en de zwaarste holes krijgen er nog een.
    for (let k = 0; k < n; k++) uit[opZwaarte[k % H].i]++;
  }
  return uit;
}

// Aantal slagen op een enkele hole.
export function slagenOpHole(totaalSlagen, holes, holeIdx, plaatsing = 'laag') {
  return slagenPerHole(totaalSlagen, holes, plaatsing)[holeIdx] || 0;
}

// De holes waarop een slag valt, voor de weergave op het scherm.
// Geeft [{ nr, si, slagen }] met nr = volgnummer op de kaart (1-based).
export function slagHoleLijst(totaalSlagen, holes, plaatsing = 'laag') {
  const perHole = slagenPerHole(totaalSlagen, holes, plaatsing);
  const uit = [];
  perHole.forEach((slagen, i) => {
    if (slagen > 0) uit.push({ nr: i + 1, si: Number(holes[i]?.si) || (i + 1), slagen });
  });
  return uit;
}

// ─── Hoeveel slagen krijgt wie? ─────────────────────────────
// De handicap waarmee gerekend wordt: de per partij ingestelde handicap gaat
// voor op de handicap uit het profiel.
export function partijHcpVan(speler) {
  const h = Number(speler?.partijHcp ?? speler?.hcp ?? 0);
  return Number.isFinite(h) ? h : 0;
}

// MATCHPLAY — onderling verschil. De hoogste handicap krijgt de slagen.
export function koppelSlagen(a, b, pct = HCP_STANDAARD.hcpPct) {
  const hA = partijHcpVan(a);
  const hB = partijHcpVan(b);
  const slagen = Math.round(Math.abs(hA - hB) * pct);
  const ontvanger = hA > hB ? a : b;
  return { slagen, ontvangerUid: ontvanger?.uid, ontvanger };
}

// AMERIKAANTJE / HIGH-LOW — per speler, want er zijn geen koppels.
// Geeft { uid: aantalSlagen }.
export function spelerSlagen(spelers, inst) {
  const lijst = Array.isArray(spelers) ? spelers : [];
  const i = inst && typeof inst === 'object' && 'pct' in inst ? inst : hcpInstellingen(inst);
  const uit = {};
  if (lijst.length === 0) return uit;
  const laagste = Math.min(...lijst.map(partijHcpVan));
  lijst.forEach(s => {
    const eigen = partijHcpVan(s);
    const basis = i.verdeling === 'relatief' ? (eigen - laagste) : eigen;
    uit[s.uid] = Math.max(0, Math.round(basis * i.pct));
  });
  return uit;
}

// Netto score van een speler op een hole bij Amerikaantje/High-Low.
// `slagenMap` komt uit spelerSlagen().
export function nettoScore(ruweScore, speler, holes, holeIdx, slagenMap, plaatsing) {
  if (ruweScore === null || ruweScore === undefined || ruweScore === '') return null;
  const totaal = slagenMap?.[speler?.uid] ?? 0;
  return Number(ruweScore) - slagenOpHole(totaal, holes, holeIdx, plaatsing);
}
