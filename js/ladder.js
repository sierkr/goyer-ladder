// ============================================================
//  ladder.js — Ladder rendering, ranking weergave
// ============================================================
import { db, LADDERS_COL, SNAPSHOTS_COL, ARCHIEF_DOC, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, huidigeBruiker, uitdagingenData, alleToernooien, archiefData, DEFAULT_LADDER_CONFIG } from './store.js';
import { getLadderConfig, getLadderData, isBeheerderRol, isCoordinatorRol, toast } from './auth.js';
import { stuurUitdaging } from './archief.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { renderKnockoutLadderKaart } from './knockout.js';
import { getLadderSpelers, isInLadder } from './ladder-view.js';

// ============================================================
//  ACTIVITEITSSYSTEEM — deterministisch berekend uit partijhistorie
//  (ladder.data.uitslagen[]). Geen Cloud Function, geen opgeslagen
//  velden nodig; werkt terugwerkend vanaf de referentiedatum.
// ============================================================
const _WEEK_MS = 7 * 24 * 3600 * 1000;

// Timestamp van een uitslag: scoreTs indien aanwezig, anders de
// 'd-m-yyyy' datumstring parsen.
function _uitslagTs(u) {
  if (u && u.scoreTs) return u.scoreTs;
  if (u && u.datum) {
    const p = String(u.datum).split('-').map(Number);
    if (p.length === 3 && p.every(n => !isNaN(n))) {
      return new Date(p[2], p[1] - 1, p[0]).getTime();
    }
  }
  return null;
}

// ============================================================
//  ACTIVITEITSICONEN — v5.0.0 (punt 7)
// ------------------------------------------------------------
//  WAT ER MIS WAS: hier stond een tweede, volledige implementatie van de
//  ranking-regels (verrijkMetActiviteit + sorteerOpActiviteit), naast de
//  implementatie in functions/index.js. v4.2.0 verplaatste de berekening naar
//  de server maar liet deze kopie staan "alleen voor de iconen" — met een
//  sorteerfunctie er nog naast die een eigen weergaverang uitrekende. Twee
//  implementaties van dezelfde regels lopen altijd een keer uiteen; dat is
//  precies wat v3.0.2 en v4.2.0 al eerder hebben moeten repareren.
//
//  WAT ER NU STAAT: alleen nog de gegevens die nodig zijn om de iconen
//  (🔥 frequent · 🌟 divers · ⏳/⬇️ inactief) te kunnen tonen. Geen effectieve
//  positie, geen groepering, geen sortering. De positie komt uitsluitend uit
//  standen/{uid}.rank, die de server schrijft.
//
//  Net als server-side (punt 6) wordt hier op uid geteld waar dat kan, met
//  terugval op de naam voor uitslagen van vóór v5.0.0.
// ============================================================
function bepaalActiviteitsIconen(spelers, ladder, cfg, nu = Date.now(), toernooien = []) {
  const uitslagen = (ladder && (ladder.data?.uitslagen || ladder.uitslagen)) || [];
  const refTs = new Date(cfg.inactiviteitReferentiedatum || '2026-04-01').getTime();
  const drempel  = cfg.inactiviteitDrempelWeken ?? 4;
  const model    = cfg.inactiviteitModel || 'zacht';
  const inactAan = cfg.inactiviteitAan !== false;
  const freqAan  = cfg.frequentieBonusAan !== false;
  const divAan   = cfg.diversiteitsBonusAan !== false;
  const freqMin  = cfg.frequentieBonusPartijen ?? 3;
  const freqPlek = cfg.frequentieBonusPlekken ?? 1;
  const divMin   = cfg.diversiteitsBonusDrempel ?? 6;
  const divPlek  = cfg.diversiteitsBonusPlekken ?? 2;

  const nuD = new Date(nu);
  const huidigeMaand = nuD.getFullYear() * 12 + nuD.getMonth();

  // naam -> uid, alleen voor eenduidige namen (zie functions/index.js).
  const perNaam = {};
  for (const sp of spelers) {
    const k = String(sp.naam || '').trim().toLowerCase();
    if (k) (perNaam[k] || (perNaam[k] = [])).push(sp.uid);
  }
  const naamNaarUid = {};
  for (const [n, uids] of Object.entries(perNaam)) if (uids.length === 1) naamNaarUid[n] = uids[0];
  const sleutel = (uid, naam) => {
    if (uid) return uid;
    const n = String(naam || '').trim();
    if (!n) return null;
    return naamNaarUid[n.toLowerCase()] || n;
  };

  const stat = {};
  const ensure = k => (stat[k] || (stat[k] = { laatst: null, maand: 0, opp: new Set() }));

  for (const u of uitslagen) {
    const ts = _uitslagTs(u);
    if (ts == null) continue;
    const d = new Date(ts);
    const maandKey = d.getFullYear() * 12 + d.getMonth();
    const deelnemers = Array.isArray(u.spelerUids)
      ? u.spelerUids.map(uid => sleutel(uid, null))
      : (u.spelers || []).map(n => sleutel(null, n));
    for (const k of deelnemers) {
      if (!k) continue;
      const st = ensure(k);
      if (st.laatst == null || ts > st.laatst) st.laatst = ts;
      if (maandKey === huidigeMaand) st.maand++;
    }
    if (ts >= refTs) {
      const mus = (Array.isArray(u.matchupUids) && u.matchupUids.length)
        ? u.matchupUids.map(m => ({ a: sleutel(m.a, null), b: sleutel(m.b, null) }))
        : (u.matchups || []).map(m => ({ a: sleutel(null, m.a), b: sleutel(null, m.b) }));
      for (const m of mus) {
        if (m.a && m.b && m.a !== m.b) { ensure(m.a).opp.add(m.b); ensure(m.b).opp.add(m.a); }
      }
    }
  }

  // Toernooidagen tellen ook als activiteit (v3.0.0-11.104). Toernooispelers
  // hebben altijd een uid, dus daar is geen naam-terugval nodig.
  for (const t of (toernooien || [])) {
    for (const dag of (t.dagen || [])) {
      const gespeeld = dag.afgerond === true || (dag.datum && new Date(dag.datum).getTime() <= nu);
      if (!gespeeld || !dag.datum) continue;
      const ts = new Date(dag.datum).getTime();
      if (isNaN(ts)) continue;
      const dd = new Date(ts);
      const maandKey = dd.getFullYear() * 12 + dd.getMonth();
      const flights = Array.isArray(dag.flights) ? dag.flights : [];
      const dagDeelnemers = flights.length
        ? flights.flatMap(f => (f.spelers || []).map(x => sleutel(x.uid, x.naam)))
        : (t.spelers || []).map(x => sleutel(x.uid, x.naam));
      for (const k of dagDeelnemers) {
        if (!k) continue;
        const st = ensure(k);
        if (st.laatst == null || ts > st.laatst) st.laatst = ts;
        if (maandKey === huidigeMaand) st.maand++;
      }
      if (ts >= refTs) {
        for (const f of flights) {
          const inFlight = (f.spelers || []).map(x => sleutel(x.uid, x.naam)).filter(Boolean);
          for (const a of inFlight) for (const b of inFlight) {
            if (a !== b) ensure(a).opp.add(b);
          }
        }
      }
    }
  }

  function strafWeken(weken) {
    if (!inactAan || weken < drempel) return 0;
    const over = weken - drempel + 1;
    if (model === 'zacht') return Math.min(6, over);
    if (model === 'middel') return Math.min(14, over * 2);
    return 9999; // 'fors' -> harde scheiding, alleen als icoon relevant
  }

  return spelers.map(sp => {
    const st = stat[sp.uid] || stat[sp.naam] || { laatst: null, maand: 0, opp: new Set() };
    const actief = st.laatst != null && st.laatst >= refTs;
    const inactiefSinds = st.laatst ? Math.max(st.laatst, refTs) : refTs;
    const weken = refTs ? Math.max(0, Math.floor((nu - inactiefSinds) / _WEEK_MS)) : 0;
    const uniek = st.opp.size;
    const fb = (freqAan && st.maand > freqMin) ? freqPlek : 0;
    const db = (divAan && uniek > divMin) ? divPlek : 0;
    // Let op: hier staat bewust GEEN effectieve positie of sortering meer.
    // Deze waarden zijn uitsluitend voor de iconen en de tooltip.
    return { ...sp, _act: { weken, straf: strafWeken(weken), maand: st.maand, uniek, fb, db, actief } };
  });
}

// Geef de spelers in weergavevolgorde voor een ladder.
// De volgorde komt uitsluitend uit standen/{uid}.rank, die de server schrijft.
// bepaalActiviteitsIconen() voegt alleen de iconen (🔥🌟⬇️⏳) toe en raakt de
// volgorde niet aan — zie punt 7 hierboven.
function getLadderSpelersWeergave(ladderId) {
  const spelers = getLadderSpelers(ladderId); // al gesorteerd op rank (volledige positie)
  if (spelers.length === 0) return spelers;
  const ladder = alleLadders.find(l => l.id === ladderId);
  const cfg = getLadderConfig(ladderId) || DEFAULT_LADDER_CONFIG;
  const verrijkt = bepaalActiviteitsIconen(spelers, ladder, cfg, Date.now(), alleToernooien);
  return spelers.map((s, i) => ({ ...s, _act: verrijkt[i]?._act }));
}

// berekenWeergaveRangen — v5.0.0 (punt 7)
//
// Was: een tweede berekening van de weergavepositie, met een eigen kopie van
// de activiteitsregels, zodat het uitslagbericht dezelfde nummers toonde als
// de ladderlijst (fix v3.0.2). Sinds v4.2.0 IS standen/{uid}.rank al de
// volledige, activiteits-gecorrigeerde weergavepositie — die door de server
// wordt berekend. Nog een keer client-side rekenen kon alleen maar afwijken.
//
// Nu: gewoon de serverpositie, oplopend genummerd. Daarmee is er per definitie
// geen verschil meer tussen het uitslagbericht en de ladderlijst.
function berekenWeergaveRangen(ladderId, spelers) {
  const map = {};
  if (!Array.isArray(spelers) || spelers.length === 0) return map;
  [...spelers]
    .sort((a, b) => (a.rank || 999) - (b.rank || 999))
    .forEach((s, i) => { if (s.uid) map[s.uid] = i + 1; });
  return map;
}

// ============================================================
//  SPELERMATRIX (beheer) — v3.0.0-11.104
//  Onderlinge partijen (uit ladderuitslagen) + activiteit op de diagonaal.
// ============================================================
function openSpelermatrix(ladderId) {
  const id = ladderId || activeLadderId;
  const wrap = document.getElementById('spelermatrix-inhoud');
  const titel = document.getElementById('spelermatrix-titel');
  const ladder = alleLadders.find(l => l.id === id);
  if (wrap) wrap.innerHTML = renderSpelermatrixHtml(id);
  if (titel) titel.textContent = 'Spelermatrix' + (ladder?.naam ? ' — ' + ladder.naam : '');
  const modal = document.getElementById('modal-spelermatrix');
  if (modal) modal.classList.add('open');
}

function renderSpelermatrixHtml(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  const cfg = getLadderConfig(ladderId) || DEFAULT_LADDER_CONFIG;
  // Spelers op competitierank (vaste volgorde voor de matrix), verrijkt met activiteit.
  const basis = getLadderSpelers(ladderId).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const spelers = bepaalActiviteitsIconen(basis, ladder, cfg, Date.now(), alleToernooien);
  if (spelers.length === 0) return '<p style="padding:16px;color:var(--mid)">Geen spelers in deze ladder.</p>';

  // Onderlinge telling uit ladderuitslagen (matchups a vs b, op naam).
  const uitslagen = (ladder && (ladder.data?.uitslagen || ladder.uitslagen)) || [];
  const paren = {};
  const sleutel = (a, b) => (a < b ? a + '||' + b : b + '||' + a);
  for (const u of uitslagen) {
    for (const m of (u.matchups || [])) {
      if (m.a && m.b) { const k = sleutel(m.a, m.b); paren[k] = (paren[k] || 0) + 1; }
    }
  }

  const namen = spelers.map(s => s.naam);
  const kort = s => { const d = (s.naam || '').trim().split(/\s+/); return d[d.length - 1] || s.naam; };

  // Kolomkoppen = rangnummers (compact). Rijlabels = "rang. naam".
  let html = '<div style="overflow:auto;max-height:70vh;border:1px solid var(--soft-bg);border-radius:8px">';
  html += '<table style="border-collapse:collapse;font-size:11px;white-space:nowrap">';
  // Header
  html += '<thead><tr>';
  html += '<th style="position:sticky;left:0;top:0;z-index:3;background:var(--soft-bg);padding:4px 8px;text-align:left;border-bottom:2px solid var(--mid)">Speler</th>';
  spelers.forEach((s, j) => {
    html += `<th title="${escAttr(s.naam)}" style="position:sticky;top:0;z-index:2;background:var(--soft-bg);padding:4px 6px;border-bottom:2px solid var(--mid);min-width:26px;text-align:center">${j + 1}</th>`;
  });
  html += '</tr></thead><tbody>';

  spelers.forEach((rij, i) => {
    html += '<tr>';
    const _lvKlik = rij.uid ? `onclick="openLadderverloop('${escAttr(ladderId)}','${escAttr(rij.uid)}')" style="cursor:pointer;text-decoration:underline dotted" title="Bekijk ladderverloop van ${escAttr(rij.naam)}"` : '';
    html += `<td style="position:sticky;left:0;z-index:1;background:var(--card-bg,#fff);padding:4px 8px;border-bottom:1px solid var(--soft-bg);border-right:2px solid var(--mid);font-weight:500"><span ${_lvKlik}>${i + 1}. ${esc(kort(rij))}</span></td>`;
    spelers.forEach((kol, j) => {
      if (i === j) {
        // Diagonaal: groen + partijen deze maand als actief, anders rood + weken inactief.
        const a = rij._act;
        const actiefMaand = a.maand > 0;
        const bg = actiefMaand ? '#1d7a3d' : '#c0392b';
        const getal = actiefMaand ? a.maand : a.weken;
        const tip = actiefMaand ? `${a.maand} partij(en) deze maand` : `${a.weken} weken inactief`;
        html += `<td title="${escAttr(rij.naam + ' — ' + tip)}" style="padding:4px 6px;text-align:center;background:${bg};color:#fff;font-weight:700;border-bottom:1px solid var(--soft-bg)">${getal}</td>`;
      } else {
        const n = paren[sleutel(rij.naam, kol.naam)] || 0;
        const bg = n > 0 ? 'rgba(45,90,61,0.10)' : 'transparent';
        html += `<td title="${escAttr(rij.naam + ' vs ' + kol.naam + ': ' + n)}" style="padding:4px 6px;text-align:center;background:${bg};border-bottom:1px solid var(--soft-bg);color:${n > 0 ? 'var(--dark)' : 'var(--light)'}">${n > 0 ? n : ''}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  // Legenda
  html += '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--mid);margin-top:12px">' +
    '<span><span style="display:inline-block;width:12px;height:12px;background:#1d7a3d;border-radius:2px;vertical-align:middle"></span> diagonaal groen = partijen deze maand</span>' +
    '<span><span style="display:inline-block;width:12px;height:12px;background:#c0392b;border-radius:2px;vertical-align:middle"></span> diagonaal rood = weken inactief</span>' +
    '<span>cel = aantal onderlinge ladderpartijen</span>' +
    '</div>';
  return html;
}

// ============================================================
//  LADDERVERLOOP PER SPELER — v3.0.7
//  Klik op een speler in de spelermatrix -> grafiek van de rang over de
//  tijd binnen het HUIDIGE seizoen. Twee lijnen: 'zonder activiteit'
//  (competitierang) en 'met activiteit' (activiteits-gecorrigeerde positie).
//  Databron (hybride):
//   - Recent (laatste ~30 dagen): exacte snapshots (snapshots-collectie).
//   - Ouder deel van dit seizoen: eenmalig gereconstrueerd uit uitslagen[],
//     startend vanaf de gearchiveerde eindstand van het vorige seizoen, met
//     exact hetzelfde rang-verschuif-algoritme als bevestigUitslag().
//  Veiligheid: de reconstructie wordt gevalideerd tegen overlappende
//  snapshots. Klopt ze niet -> alleen snapshotdata tonen (nooit foute data).
// ============================================================

let _lvState = null;

function _lvTs(u) {
  if (u && u.scoreTs) return u.scoreTs;
  if (u && u.datum) {
    const p = String(u.datum).split('-').map(Number);
    if (p.length === 3 && p.every(n => !isNaN(n))) return new Date(p[2], p[1] - 1, p[0]).getTime();
  }
  return null;
}

// ============================================================
//  LADDERVERLOOP — v5.0.0 (punt 7)
// ------------------------------------------------------------
//  WAT ER MIS WAS: de grafiek reconstrueerde het verleden door het OUDE
//  plek-herverdeel-algoritme opnieuw af te spelen over de uitslagen
//  (_lvReconstrueer/_lvPasMatchupToe), en berekende daar bovenop nog een
//  tweede lijn "met activiteit" via _lvMetRang(). Dat was een derde kopie van
//  de ranking-regels, bovenop die in functions/index.js en die in dit bestand.
//  Sinds v4.2.0 klopte die reconstructie bovendien niet meer met de werkelijke
//  berekening (v4.2.0 noemde dat zelf al een "bekende beperking").
//
//  WAT ER NU GEBEURT: de grafiek toont de standen zoals ze DAADWERKELIJK zijn
//  vastgelegd, uit de snapshots (die na elke bevestigde partij worden gemaakt)
//  plus de eindstand uit het seizoensarchief. Geen reconstructie, geen tweede
//  algoritme. De getoonde positie is de echte, activiteits-gecorrigeerde
//  positie van dat moment - want dat is precies wat er in de snapshot staat.
// ============================================================

// Detailtekst voor een punt: datum + tegenstander(s) + uitslag.
function _lvDetail(uitslagen, ts, naam) {
  let best = null;
  for (const u of uitslagen) {
    const t = _lvTs(u);
    if (t != null && t <= ts && (u.spelers || []).includes(naam)) {
      if (!best || t > _lvTs(best)) best = u;
    }
  }
  if (!best) return '';
  const datum = best.datum || new Date(_lvTs(best)).toLocaleDateString('nl-NL');
  const mine = (best.matchups || []).filter(m => m.a === naam || m.b === naam);
  const parts = mine.map(m => {
    const tegen = m.a === naam ? m.b : m.a;
    const res = m.winnaar === naam ? 'gewonnen' : (m.winnaar ? 'verloren' : '-');
    return `vs ${tegen} (${res})`;
  });
  return datum + (parts.length ? ' - ' + parts.join(', ') : '');
}

function _lvBouwPunten(ctx) {
  const { uid, spelerNaam, snaps, uitslagen, archBaseline, startTs } = ctx;
  const punten = [];

  // Startpunt uit het seizoensarchief, als dat er is: de vastgelegde eindstand
  // van vorig seizoen is de eerste echte, gemeten positie.
  if (archBaseline && archBaseline.rank != null && startTs) {
    punten.push({
      ts: startTs, zonder: archBaseline.rank, met: archBaseline.rank,
      bron: 'archief', detail: 'Startstand seizoen',
    });
  }

  for (const snap of snaps) {
    const mij = (snap.spelers || []).find(s => s.uid === uid);
    if (!mij || mij.rank == null) continue;
    // `zonder` en `met` zijn sinds v4.2.0 hetzelfde getal: de opgeslagen rank
    // is al de activiteits-gecorrigeerde positie. De tweede lijn is daarmee
    // vervallen (zie de toelichting hierboven).
    punten.push({
      ts: snap.timestamp, zonder: mij.rank, met: mij.rank,
      bron: 'snap', detail: _lvDetail(uitslagen, snap.timestamp, spelerNaam),
    });
  }
  punten.sort((a, b) => a.ts - b.ts);
  return punten;
}

function _lvVeldData(snaps, excludeUid) {
  const map = {};
  for (const snap of snaps) {
    for (const s of (snap.spelers || [])) {
      if (s.uid === excludeUid) continue;
      (map[s.uid] || (map[s.uid] = { naam: s.naam, punten: [] })).punten.push({ ts: snap.timestamp, rank: s.rank });
    }
  }
  Object.values(map).forEach(v => v.punten.sort((a, b) => a.ts - b.ts));
  return map;
}

function _lvStepPath(pts, xf, yf) {
  if (!pts.length) return '';
  let d = `M${xf(pts[0].ts).toFixed(1)},${yf(pts[0].val).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const x = xf(pts[i].ts).toFixed(1);
    d += ` L${x},${yf(pts[i - 1].val).toFixed(1)} L${x},${yf(pts[i].val).toFixed(1)}`;
  }
  return d;
}

async function openLadderverloop(ladderId, uid) {
  const modal = document.getElementById('modal-ladderverloop');
  const inhoud = document.getElementById('ladderverloop-inhoud');
  const titel = document.getElementById('ladderverloop-titel');
  if (!modal || !inhoud) return;
  modal.classList.add('open');
  inhoud.innerHTML = '<p style="padding:20px;color:var(--mid)">Laden...</p>';

  try {
    const ladder = alleLadders.find(l => l.id === ladderId);
    const cfg = getLadderConfig(ladderId) || DEFAULT_LADDER_CONFIG;
    const roster = getLadderSpelers(ladderId);
    const speler = roster.find(s => s.uid === uid);
    const spelerNaam = speler ? speler.naam : uid;
    if (titel) titel.textContent = 'Ladderverloop - ' + spelerNaam + (ladder?.naam ? ' \u00b7 ' + ladder.naam : '');

    const archMatches = (archiefData || []).filter(a => a.ladderId === ladderId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const arch = archMatches[0] || null;
    const startTs = arch ? (arch.timestamp || 0) : 0;

    let snaps = [];
    try {
      const snapSnap = await getDocs(query(SNAPSHOTS_COL, where('ladderId', '==', ladderId)));
      snaps = snapSnap.docs.map(d => d.data())
        .filter(s => s && typeof s.timestamp === 'number' && s.timestamp >= startTs)
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (e) { console.warn('snapshots laden mislukt:', e); }

    const uitslagen = ((ladder && (ladder.data?.uitslagen || ladder.uitslagen)) || [])
      .filter(u => { const t = _lvTs(u); return t != null && t >= startTs; })
      .sort((a, b) => (_lvTs(a) || 0) - (_lvTs(b) || 0));

    // v5.0.0 (punt 7): geen reconstructie meer met het oude algoritme.
    // De grafiek toont uitsluitend vastgelegde standen: de eindstand uit het
    // seizoensarchief als startpunt, plus elke snapshot daarna.
    let reconMelding = '';
    if (!snaps.length) {
      reconMelding = 'Nog geen snapshots dit seizoen - het verloop verschijnt zodra er partijen zijn gespeeld.';
    }
    const archBaseline = arch && Array.isArray(arch.eindstand)
      ? arch.eindstand.find(e => e.uid === uid || e.naam === spelerNaam) || null
      : null;

    const punten = _lvBouwPunten({ uid, spelerNaam, snaps, uitslagen, archBaseline, startTs });
    if (punten.length === 0) {
      inhoud.innerHTML = '<p style="padding:20px;color:var(--mid)">Nog geen verloop-data voor deze speler dit seizoen.</p>';
      return;
    }

    _lvState = {
      punten, spelerNaam,
      toon: { zonder: true, met: false, veld: false },
      veldData: _lvVeldData(snaps, uid),
      reconMelding
    };
    _lvRender();
  } catch (e) {
    console.error('openLadderverloop mislukt:', e);
    inhoud.innerHTML = '<p style="padding:20px;color:#c0392b">Kon het ladderverloop niet laden.</p>';
  }
}

function _lvToggle(welk) {
  if (!_lvState) return;
  _lvState.toon[welk] = !_lvState.toon[welk];
  _lvRender();
}

function _lvToonPunt(i) {
  const el = document.getElementById('ladderverloop-detail');
  if (!el || !_lvState) return;
  const p = _lvState.punten[i];
  if (!p) return;
  const bron = p.bron === 'snap' ? 'exact (snapshot)' : 'gereconstrueerd';
  el.innerHTML = `<strong>${esc(p.detail || new Date(p.ts).toLocaleDateString('nl-NL'))}</strong>` +
    ` &nbsp;-&nbsp; rang ${p.zonder} (zonder) / ${p.met} (met) &nbsp;<span style="color:var(--light)">\u00b7 ${bron}</span>`;
}

function _lvRender() {
  const st = _lvState; if (!st) return;
  const inhoud = document.getElementById('ladderverloop-inhoud'); if (!inhoud) return;
  const P = st.punten;
  const W = 360, H = 236, x0 = 40, x1 = 350, y0 = 16, yB = 190;
  const tsMin = P[0].ts;
  const tsMax = Math.max(P[P.length - 1].ts, Date.now());
  const tsSpan = Math.max(1, tsMax - tsMin);
  let maxRank = 1;
  P.forEach(p => { maxRank = Math.max(maxRank, p.zonder || 1, st.toon.met ? (p.met || 1) : 1); });
  if (st.toon.veld) Object.values(st.veldData).forEach(v => v.punten.forEach(pt => { maxRank = Math.max(maxRank, pt.rank); }));
  const xf = ts => x0 + ((ts - tsMin) / tsSpan) * (x1 - x0);
  const yf = r => y0 + ((r - 1) / Math.max(1, maxRank - 1)) * (yB - y0);

  const recon = P.filter(p => p.bron === 'recon');
  const snap = P.filter(p => p.bron === 'snap');
  const eersteSnap = snap.length ? snap[0] : null;

  const mkRecon = veld => { const a = recon.map(veld); if (eersteSnap) a.push(veld(eersteSnap)); return a; };
  const zReconPts = mkRecon(p => ({ ts: p.ts, val: p.zonder }));
  const zSnapPts = snap.map(p => ({ ts: p.ts, val: p.zonder }));
  const mReconPts = mkRecon(p => ({ ts: p.ts, val: p.met }));
  const mSnapPts = snap.map(p => ({ ts: p.ts, val: p.met }));

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ladderverloop van ${escAttr(st.spelerNaam)} over de tijd">`;
  // as-lijnen
  svg += `<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${yB}" stroke="var(--soft-bg)" stroke-width="1"/>`;
  svg += `<line x1="${x0}" y1="${yB}" x2="${x1}" y2="${yB}" stroke="var(--soft-bg)" stroke-width="1"/>`;
  // y-labels: 1, midden, maxRank
  const yLabels = maxRank <= 2 ? [1, maxRank] : [1, Math.round((1 + maxRank) / 2), maxRank];
  yLabels.forEach(r => {
    svg += `<text x="${x0 - 6}" y="${(yf(r) + 4).toFixed(1)}" font-size="11" fill="var(--mid)" text-anchor="end">${r}</text>`;
    svg += `<line x1="${x0}" y1="${yf(r).toFixed(1)}" x2="${x1}" y2="${yf(r).toFixed(1)}" stroke="var(--soft-bg)" stroke-width="0.5"/>`;
  });
  // x-labels: start, midden, nu
  const fmt = ts => new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  [[tsMin, x0, 'start'], [(tsMin + tsMax) / 2, (x0 + x1) / 2, 'mid'], [tsMax, x1, 'nu']].forEach(([ts, x, k]) => {
    const label = k === 'nu' ? 'nu' : fmt(ts);
    const anchor = k === 'start' ? 'start' : (k === 'nu' ? 'end' : 'middle');
    svg += `<text x="${x}" y="${yB + 16}" font-size="11" fill="var(--mid)" text-anchor="${anchor}">${label}</text>`;
  });
  // grens gereconstrueerd
  if (recon.length && eersteSnap) {
    const gx = xf(eersteSnap.ts).toFixed(1);
    svg += `<rect x="${x0}" y="${y0}" width="${(gx - x0).toFixed(1)}" height="${yB - y0}" fill="var(--dark)" opacity="0.04"/>`;
    svg += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${yB}" stroke="var(--mid)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>`;
  }
  // veld-context
  if (st.toon.veld) {
    Object.values(st.veldData).forEach(v => {
      const pts = v.punten.map(pt => ({ ts: pt.ts, val: pt.rank }));
      svg += `<path d="${_lvStepPath(pts, xf, yf)}" fill="none" stroke="var(--mid)" stroke-width="1" opacity="0.22"/>`;
    });
  }
  // met activiteit (oranje, gestippeld)
  if (st.toon.met) {
    svg += `<path d="${_lvStepPath(mReconPts, xf, yf)}" fill="none" stroke="#eb6834" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" opacity="0.45"/>`;
    svg += `<path d="${_lvStepPath(mSnapPts, xf, yf)}" fill="none" stroke="#eb6834" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
  }
  // zonder activiteit (blauw, vol)
  if (st.toon.zonder) {
    svg += `<path d="${_lvStepPath(zReconPts, xf, yf)}" fill="none" stroke="#2a78d6" stroke-width="2.5" stroke-linejoin="round" opacity="0.45"/>`;
    svg += `<path d="${_lvStepPath(zSnapPts, xf, yf)}" fill="none" stroke="#2a78d6" stroke-width="2.5" stroke-linejoin="round"/>`;
    P.forEach((p, i) => {
      const solid = p.bron === 'snap';
      svg += `<circle cx="${xf(p.ts).toFixed(1)}" cy="${yf(p.zonder).toFixed(1)}" r="4" fill="#2a78d6" stroke="var(--card-bg,#fff)" stroke-width="2" opacity="${solid ? 1 : 0.5}" style="cursor:pointer" onclick="_lvToonPunt(${i})"><title>${escAttr(p.detail || fmt(p.ts))}</title></circle>`;
    });
  }
  svg += '</svg>';

  // mini-stats
  const zAlle = P.map(p => p.zonder);
  const huidig = zAlle[zAlle.length - 1];
  const hoogste = Math.min(...zAlle);
  const laagste = Math.max(...zAlle);
  const netto = zAlle[0] - huidig; // + = gestegen
  const nettoTxt = netto === 0 ? '\u00b10' : (netto > 0 ? '\u25b2 ' + netto : '\u25bc ' + Math.abs(netto));
  const nettoKleur = netto > 0 ? '#1d7a3d' : (netto < 0 ? '#c0392b' : 'var(--mid)');

  const knop = (welk, kleur, label) => {
    const aan = st.toon[welk];
    return `<button onclick="_lvToggle('${welk}')" style="border:1px solid ${aan ? kleur : 'var(--soft-bg)'};background:${aan ? kleur + '18' : 'transparent'};color:${aan ? kleur : 'var(--mid)'};border-radius:14px;padding:3px 10px;font-size:12px;cursor:pointer">${aan ? '\u25cf' : '\u25cb'} ${label}</button>`;
  };

  let html = '';
  html += '<div style="display:flex;gap:8px;margin-bottom:8px">' +
    `<div style="flex:1;background:var(--soft-bg);border-radius:8px;padding:8px;text-align:center"><div style="font-size:11px;color:var(--mid)">huidig</div><div style="font-size:20px;font-weight:600">${huidig}</div></div>` +
    `<div style="flex:1;background:var(--soft-bg);border-radius:8px;padding:8px;text-align:center"><div style="font-size:11px;color:var(--mid)">hoogste</div><div style="font-size:20px;font-weight:600">${hoogste}</div></div>` +
    `<div style="flex:1;background:var(--soft-bg);border-radius:8px;padding:8px;text-align:center"><div style="font-size:11px;color:var(--mid)">laagste</div><div style="font-size:20px;font-weight:600">${laagste}</div></div>` +
    `<div style="flex:1;background:var(--soft-bg);border-radius:8px;padding:8px;text-align:center"><div style="font-size:11px;color:var(--mid)">seizoen</div><div style="font-size:20px;font-weight:600;color:${nettoKleur}">${nettoTxt}</div></div>` +
    '</div>';
  html += svg;
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
    knop('zonder', '#2a78d6', 'ladderpositie') +
    knop('veld', '#888780', 'veld tonen') +
    '</div>';
  html += '<div id="ladderverloop-detail" style="margin-top:10px;font-size:12px;color:var(--dark);min-height:18px">Tik op een punt voor details.</div>';
  if (st.reconMelding) {
    html += `<div style="margin-top:8px;font-size:11px;color:var(--mid);font-style:italic">${esc(st.reconMelding)}</div>`;
  } else if (recon.length) {
    html += '<div style="margin-top:8px;font-size:11px;color:var(--mid);font-style:italic">Vager gedeelte links = gereconstrueerd; vol = exacte snapshots.</div>';
  }

  inhoud.innerHTML = html;
}

window.openSpelermatrix = openSpelermatrix;
window.openLadderverloop = openLadderverloop;
window._lvToggle = _lvToggle;
window._lvToonPunt = _lvToonPunt;

// Vult de ladder-keuze in de Spelermatrix-beheerkaart (zelfde patroon als invite).
function vulMatrixSelect() {
  const sel = document.getElementById('matrix-ladder-select');
  if (!sel) return;
  const huidige = sel.value;
  sel.innerHTML = alleLadders.map(l => `<option value="${escAttr(l.id)}">${esc(l.naam)}</option>`).join('');
  if (huidige && alleLadders.find(l => l.id === huidige)) sel.value = huidige;
  else if (activeLadderId) sel.value = activeLadderId;
}
window.vulMatrixSelect = vulMatrixSelect;



//  LADDER
// ============================================================
async function renderLadder() {

  try {
  const wrap = document.getElementById('ladder-kaarten');
  if (!wrap) return;

  // Bepaal welke ladders de gebruiker ziet
  // Primary: uid in spelerIds[] (fase 1 migratie)
  // Fallback: spelerId of naam in spelers[] (backward compat)
  const mijnLadders = isCoordinatorRol()
    ? alleLadders
    : alleLadders.filter(l => {
        const uid = huidigeBruiker?.uid;
        // v3.0.0-9c: alleen uid-check via view-laag
        return uid && isInLadder(l.id, uid);
      });

  if (mijnLadders.length === 0) {
    if (!window._ladderRetryCount) window._ladderRetryCount = 0;
    if (window._ladderRetryCount < 3) {
      window._ladderRetryCount++;
      wrap.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">⏳</div><p>Laden…</p></div></div>';
      setTimeout(async () => {
        // Herlaad alleLadders vers uit Firestore
        try {
          const [laddersSnap, volgordeSnap] = await Promise.all([
            getDocs(LADDERS_COL),
            getDoc(doc(db, 'ladder', 'ladderVolgorde'))
          ]);
          const volgorde = volgordeSnap.exists() ? (volgordeSnap.data().volgorde || []) : [];
          store.alleLadders = laddersSnap.docs.map(d => ({
            id: d.id, naam: d.data().naam, type: d.data().type || 'ranking',
            spelerIds: d.data().spelerIds || [],
            actievePartijen: d.data().actievePartijen || [], config: d.data().config || null,
            data: d.data()
          }));
          if (volgorde.length > 0) {
            alleLadders.sort((a, b) => {
              const ai = volgorde.indexOf(a.id), bi = volgorde.indexOf(b.id);
              if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi;
            });
          }
        } catch(e) { console.error('Herlaad ladders mislukt:', e); }
        renderLadder();
      }, 1500);
    } else {
      window._ladderRetryCount = 0;
      wrap.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">🏆</div><p>Je bent nog niet toegevoegd aan een ladder.</p></div></div>';
    }
    return;
  }
  window._ladderRetryCount = 0;

  // Render elke ladder als inklapbare kaart
  // Gebruik gecachede data waar mogelijk, anders getDoc
  const ladderData = await Promise.all(mijnLadders.map(async l => {
    if (l.data) return l; // gebruik cache (gevuld via onSnapshot)
    const snap = await getDoc(doc(db, 'ladders', l.id));
    const data = snap.exists() ? snap.data() : {};
    l.data = data;
    return { ...l, data };
  }));

  wrap.innerHTML = ladderData.map(l => {
    const isKnockout = (l.data.type || l.type) === 'knockout';

    if (isKnockout) {
      return renderKnockoutLadderKaart(l);
    }

    // Gebruik view-laag (fase 9a) — haalt spelers uit spelers/{uid} + standen/{uid}
    // v3.0.0-11.102: weergavevolgorde via activiteitssysteem (inactiviteit/bonussen)
    const spelers = getLadderSpelersWeergave(l.id);
    const lijstHtml = spelers.length === 0
      ? '<div class="empty"><p>Nog geen spelers.</p></div>'
      : spelers.map(s => renderLadderRij(s, l.id)).join('');

    return `<div class="card" style="margin-bottom:16px">
      <div class="card-header inklapbaar" onclick="toggleLadderKaart(this,'${escAttr(l.id)}')">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <button onclick="event.stopPropagation();deelLadderAlsAfbeelding('${escAttr(l.id)}')" style="background:none;border:none;cursor:pointer;font-size:20px;padding:0;flex-shrink:0" title="Deel als afbeelding">📤</button>
          <h2 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Ladderstand ${esc(l.naam)}</h2>
        </div>
        <span class="badge badge-green">${spelers.length} spelers</span>
      </div>
      <div class="card-collapse" id="ladder-collapse-${escAttr(l.id)}">
        <div id="ladder-list-${escAttr(l.id)}">${lijstHtml}</div>
      </div>
    </div>`;
  }).join('');
  } catch(e) { console.error('renderLadder mislukt:', e); }
}

function toggleLadderKaart(header, ladderId) {
  header.classList.toggle('ingeklapt');
  const collapse = document.getElementById('ladder-collapse-' + ladderId);
  if (collapse) collapse.classList.toggle('ingeklapt');
}

function renderLadderRij(s, ladderId) {
  const winpct = s.partijen > 0 ? Math.round(s.gewonnen/s.partijen*100) : 0;
  
  let deltaHtml = '';
  // v4.2.0: rank en prevRank zijn nu allebei server-side volledige (activiteits-
  // gecorrigeerde) posities uit hetzelfde puntensysteem — geen aparte "ruwe
  // competitierank" meer die zou kunnen misleiden. De delta klopt dus altijd.
  if (s.prevRank != null && s.prevRank !== s.rank) {
    const d = s.prevRank - s.rank;
    deltaHtml = d > 0
      ? `<span class="delta-up" style="font-size:12px">▲${d}</span>`
      : `<span class="delta-down" style="font-size:12px">▼${Math.abs(d)}</span>`;
  } else if (s.prevRank != null) {
    deltaHtml = `<span style="font-size:11px;color:var(--light)">—</span>`;
  }

  // Activiteitsicoontje — gebaseerd op berekende activiteit (s._act)
  const cfg = getLadderConfig(ladderId);
  let icoonHtml = '';
  if (cfg.icoonAan !== false && s._act) {
    const a = s._act;
    const drempel = cfg.inactiviteitDrempelWeken ?? 4;
    const iconen = [];
    if (a.fb) iconen.push(`<span title="Frequent — ${a.maand} partijen deze maand" style="font-size:15px;line-height:1">🔥</span>`);
    if (a.db) iconen.push(`<span title="Divers — ${a.uniek} verschillende tegenstanders" style="font-size:15px;line-height:1">⭐</span>`);
    if (a.straf > 0 || (cfg.inactiviteitModel === 'fors' && cfg.inactiviteitAan !== false && !a.actief)) {
      iconen.push(`<span title="Inactief — ${a.weken} weken zonder partij" style="font-size:15px;line-height:1">⬇️</span>`);
    } else if (drempel > 1 && a.weken >= drempel - 1 && a.weken < drempel) {
      iconen.push(`<span title="Let op — bijna inactiviteitszone" style="font-size:15px;line-height:1">⏳</span>`);
    }
    icoonHtml = iconen.join('');
  }

  const uid = huidigeBruiker?.uid;
  // v3.0.0-9c: isZelf alleen via uid. Entries uit view-laag hebben s.uid.
  const isZelf = huidigeBruiker && uid && s.uid === uid;
  const openUitdaging = uitdagingenData?.find(u =>
    u.status === 'open' && (
      (u.vanEmail === huidigeBruiker?.email && u.naarNaam?.toLowerCase() === s.naam.toLowerCase()) ||
      (u.naarEmail === huidigeBruiker?.email && u.vanNaam?.toLowerCase() === s.naam.toLowerCase())
    )
  );
  const uitdagingBtnHtml = huidigeBruiker && !isZelf
    ? `<button onclick="stuurUitdaging('${escAttr(s.uid)}')" style="background:none;border:1px solid #e0ddd4;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:${openUitdaging ? 'var(--gold)' : 'var(--light)'}" title="${openUitdaging ? 'Uitdaging loopt' : 'Uitdagen'}">⚔️</button>`
    : '';

  const rang = s._weergaveRang ?? s.rank;
  return `<div class="ladder-item" style="${isZelf ? 'background:var(--green-pale);border-left:3px solid var(--green);margin-left:-3px;' : ''}">
    <div class="rank-badge ${rang <= 3 ? 'top3' : isZelf ? 'zelf' : ''}">${rang}</div>
    <div class="player-name" style="${isZelf ? 'font-weight:700;color:var(--green);' : ''}">${esc(s.naam)}${icoonHtml ? '&nbsp;' + icoonHtml : ''}</div>
    <div style="min-width:30px;text-align:center">${deltaHtml}</div>
    <div class="player-stats" style="text-align:right;min-width:52px">${s.partijen}P · ${s.gewonnen}W · ${winpct}%</div>
    <div style="width:42px;text-align:center;flex-shrink:0">${uitdagingBtnHtml}</div>
  </div>`;
}

// ============================================================

export { renderLadder, toggleLadderKaart, renderLadderRij, getLadderSpelersWeergave, berekenWeergaveRangen };

// ============================================================
//  DEEL ALS AFBEELDING — WhatsApp stijl
// ============================================================
async function deelLadderAlsAfbeelding(ladderId) {
  try {
  const ladder = alleLadders.find(l => l.id === ladderId);
  const spelers = getLadderSpelersWeergave(ladderId);
  if (spelers.length === 0) { toast('Geen spelers om te delen'); return; }

  const naam = ladder?.naam || 'Ladder';
  const datum = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });

  // Canvas instellingen
  const colW = 190;          // ~2/3 van 280
  const rowH = 20;           // compact
  const headerH = 46;
  const padding = 8;
  const helft = Math.ceil(spelers.length / 2);
  const rows = helft;
  const canvasW = colW * 2 + padding * 3;
  const canvasH = headerH + rows * rowH + padding;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW * 2; // retina
  canvas.height = canvasH * 2;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // retina

  // Achtergrond geel
  ctx.fillStyle = '#FFE600';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header — titel en datum op gelijke hoogte
  const headerY = headerH - 10;
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 15px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('LADDERSTAND ' + naam.toUpperCase(), padding, headerY);
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(datum, canvasW - padding, headerY);

  // Scheidingslijn onder header
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding, headerH);
  ctx.lineTo(canvasW - padding, headerH);
  ctx.stroke();

  // Verticale scheidingslijn midden
  ctx.beginPath();
  ctx.moveTo(canvasW / 2, headerH);
  ctx.lineTo(canvasW / 2, canvasH - padding);
  ctx.stroke();

  // Spelers renderen
  const renderKolom = (startIdx, xOffset) => {
    for (let i = startIdx; i < startIdx + helft && i < spelers.length; i++) {
      const s = spelers[i];
      const y = headerH + (i - startIdx) * rowH;

      // Zebra achtergrond
      ctx.fillStyle = (i - startIdx) % 2 === 0 ? '#FFE600' : '#FFF176';
      ctx.fillRect(xOffset, y, colW, rowH);

      // Ranknummer
      ctx.fillStyle = '#000';
      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(String(s._weergaveRang ?? s.rank), xOffset + 28, y + rowH - 5);

      // Naam
      ctx.font = '13px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(s.naam, xOffset + 34, y + rowH - 5);

      // Horizontale lijn
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(xOffset, y + rowH);
      ctx.lineTo(xOffset + colW, y + rowH);
      ctx.stroke();
    }
  };

  renderKolom(0, padding);
  renderKolom(helft, canvasW / 2 + padding / 2);

  // Exporteren
  canvas.toBlob(async blob => {
    // Probeer Web Share API (mobiel)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'ladder.png', { type: 'image/png' })] })) {
      try {
        await navigator.share({
          files: [new File([blob], `goyer-${naam.toLowerCase().replace(/\s+/g,'-')}.png`, { type: 'image/png' })],
          title: `Goyer ${naam} Ladder`
        });
        return;
      } catch(e) { /* gebruiker annuleerde of share mislukt, val terug op download */ }
    }
    // Fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goyer-${naam.toLowerCase().replace(/\s+/g,'-')}-${datum.replace(' ','-')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
  } catch(e) { console.error('deelLadderAlsAfbeelding mislukt:', e); toast('Afbeelding maken mislukt'); }
}

window.deelLadderAlsAfbeelding = deelLadderAlsAfbeelding;
// v3.0.2
