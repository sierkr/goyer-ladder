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
//                Bepaalt WAAROVER gerekend wordt. Het percentage gaat er in
//                beide gevallen overheen — dat is geen verschil tussen de twee.
//                volledig  = eigen handicap x percentage
//                            (in het scherm: "Eigen handicap")
//                relatief  = verschil met de laagste handicap x percentage,
//                            zodat de laagste er nul krijgt
//                            (in het scherm: "Onderling verschil")
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
    // v5.8.2: "volledig" las alsof het percentage er dan niet overheen ging.
    // Nu benoemt de tekst waarover gerekend wordt, niet hoe veel.
    delen.push(i.verdeling === 'relatief' ? 'onderling verschil' : 'eigen hcp');
  }
  delen.push(i.plaatsing === 'vanaf' ? 'slagen vanaf SI' : 'laagste SI');
  return delen.join(' · ');
}

// ─── Kern: waar vallen de slagen? ───────────────────────────
//  Geeft een lijst terug even lang als `holes`, met per hole het aantal
//  slagen.
//
//  De slagen worden toegekend aan STROKE-INDEXNUMMERS, niet aan "de zwaarste
//  gespeelde holes". Dat is wezenlijk: de stroke index hoort bij de volledige
//  kaart. Wie vier slagen krijgt, krijgt ze op SI 1 t/m 4 — en speel je maar
//  negen holes, dan liggen niet al die stroke-indexen op je kaart en vang je
//  er dus maar een deel van op. Bij een halve ronde krijg je ongeveer de helft
//  van de slagen, en zo hoort het ook.
//
//  De keuze 'vanaf' verschuift het venster: bij vier slagen niet SI 1 t/m 4
//  maar SI 5 t/m 8. Passen de slagen niet meer binnen de kaart, dan loopt het
//  venster door bij SI 1 — dezelfde doorloop die 'laag' al kende bij meer
//  slagen dan holes.
export function slagenPerHole(totaalSlagen, holes, plaatsing = 'laag') {
  const lijst = Array.isArray(holes) ? holes : [];
  const H = lijst.length;
  const uit = new Array(H).fill(0);
  const n = Math.max(0, Math.round(Number(totaalSlagen) || 0));
  if (H === 0 || n === 0) return uit;

  if (plaatsing === 'vanaf') {
    // Venster van n stroke-indexen dat begint bij SI n+1: bij vier slagen dus
    // SI 5 t/m 8. Loopt het venster voorbij de kaart, dan gaat het verder bij
    // SI 1 — dezelfde doorloop die 'laag' kent bij meer slagen dan holes.
    const perSi = new Array(H + 1).fill(0);
    for (let k = 0; k < n; k++) perSi[((n + k) % H) + 1]++;
    for (let i = 0; i < H; i++) {
      const si = Number(lijst[i]?.si);
      if (Number.isFinite(si) && si >= 1 && si <= H) uit[i] = perSi[si];
    }
    return uit;
  }

  // 'laag' — letterlijk de formule zoals de app hem altijd al gebruikt:
  // een slag op SI 1 t/m n, en bij meer slagen dan holes een tweede slag op
  // de zwaarste stroke-indexen. Hier mag niets aan veranderen, anders pakt
  // een lopende partij ineens anders uit dan hij begonnen is.
  const eerste = Math.min(n, H);
  const tweede = Math.max(0, n - H);
  for (let i = 0; i < H; i++) {
    const si = Number(lijst[i]?.si);
    if (!Number.isFinite(si)) continue;
    uit[i] = (si <= eerste ? 1 : 0) + (si <= tweede ? 1 : 0);
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
