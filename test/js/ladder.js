// ============================================================
//  ladder.js — Ladder rendering, ranking weergave
// ============================================================
import { db, LADDERS_COL, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, huidigeBruiker, uitdagingenData, alleToernooien, DEFAULT_LADDER_CONFIG } from './store.js';
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

// Verrijk een spelerslijst met activiteitsstatus (_act) op basis van de
// ladderconfig en de partijhistorie. Muteert niet; geeft nieuwe objecten terug.
function verrijkMetActiviteit(spelers, ladder, cfg, nu = Date.now(), toernooien = []) {
  const uitslagen = (ladder && (ladder.data?.uitslagen || ladder.uitslagen)) || [];
  const refTs = new Date(cfg.inactiviteitReferentiedatum || '2026-04-01').getTime();
  const drempel    = cfg.inactiviteitDrempelWeken ?? 4;
  const model      = cfg.inactiviteitModel || 'zacht';
  const inactAan   = cfg.inactiviteitAan !== false;
  const freqAan    = cfg.frequentieBonusAan !== false;
  const divAan     = cfg.diversiteitsBonusAan !== false;
  const freqMin    = cfg.frequentieBonusPartijen ?? 3;
  const freqPlek   = cfg.frequentieBonusPlekken ?? 1;
  const divMin     = cfg.diversiteitsBonusDrempel ?? 6;
  const divPlek    = cfg.diversiteitsBonusPlekken ?? 2;

  const nuD = new Date(nu);
  const huidigeMaand = nuD.getFullYear() * 12 + nuD.getMonth();

  // Reconstrueer per spelernaam: laatste speeldatum, partijen deze maand,
  // unieke tegenstanders sinds de referentiedatum.
  const stat = {};
  const ensure = n => (stat[n] || (stat[n] = { laatst: null, maand: 0, opp: new Set() }));
  for (const u of uitslagen) {
    const ts = _uitslagTs(u);
    if (ts == null) continue;
    const d = new Date(ts);
    const maandKey = d.getFullYear() * 12 + d.getMonth();
    for (const n of (u.spelers || [])) {
      const s = ensure(n);
      if (s.laatst == null || ts > s.laatst) s.laatst = ts;
      if (maandKey === huidigeMaand) s.maand++;
    }
    if (ts >= refTs) {
      for (const m of (u.matchups || [])) {
        if (m.a && m.b) { ensure(m.a).opp.add(m.b); ensure(m.b).opp.add(m.a); }
      }
    }
  }

  // v3.0.0-11.104: toernooipartijen tellen ook mee als activiteit. Een
  // toernooidag geldt als 'gespeeld' zodra hij is afgerond (of, als dat veld
  // ontbreekt, zodra de dagdatum in het verleden ligt). Elke gespeelde dag
  // telt als één partij; flight-genoten van die dag tellen als tegenstanders
  // voor de diversiteit. Toernooien en ladderuitslagen zijn gescheiden
  // datastromen, dus er is geen dubbeltelling.
  for (const t of (toernooien || [])) {
    for (const dag of (t.dagen || [])) {
      const gespeeld = dag.afgerond === true || (dag.datum && new Date(dag.datum).getTime() <= nu);
      if (!gespeeld || !dag.datum) continue;
      const ts = new Date(dag.datum).getTime();
      if (isNaN(ts)) continue;
      const dd = new Date(ts);
      const maandKey = dd.getFullYear() * 12 + dd.getMonth();
      const flights = Array.isArray(dag.flights) ? dag.flights : [];
      // Deelnemers van de dag: uit de flights, anders de hele toernooilijst.
      const dagDeelnemers = flights.length
        ? flights.flatMap(f => (f.spelers || []).map(s => s.naam))
        : (t.spelers || []).map(s => s.naam);
      for (const naam of dagDeelnemers) {
        if (!naam) continue;
        const s = ensure(naam);
        if (s.laatst == null || ts > s.laatst) s.laatst = ts;
        if (maandKey === huidigeMaand) s.maand++;
      }
      // Diversiteit: flight-genoten als tegenstanders (sinds referentiedatum).
      if (ts >= refTs) {
        for (const f of flights) {
          const namen = (f.spelers || []).map(s => s.naam).filter(Boolean);
          for (const a of namen) for (const b of namen) {
            if (a !== b) ensure(a).opp.add(b);
          }
        }
      }
    }
  }

  function straf(weken) {
    if (!inactAan || weken < drempel) return 0;
    const over = weken - drempel + 1;
    if (model === 'zacht') return Math.min(6, over);
    if (model === 'middel') return Math.min(14, over * 2);
    return 9999; // 'fors' → harde scheiding via groep
  }

  return spelers.map(sp => {
    const st = stat[sp.naam] || { laatst: null, maand: 0, opp: new Set() };
    const actief = st.laatst != null && st.laatst >= refTs;
    const inactiefSinds = st.laatst ? Math.max(st.laatst, refTs) : refTs;
    const weken = refTs ? Math.max(0, Math.floor((nu - inactiefSinds) / _WEEK_MS)) : 0;
    const strafPlek = straf(weken);
    const uniek = st.opp.size;
    const fb = (freqAan && st.maand > freqMin) ? freqPlek : 0;
    const db = (divAan && uniek > divMin) ? divPlek : 0;
    const baseRank = sp.rank || 999;
    let groep = 0, eff;
    if (model === 'fors' && inactAan) { groep = actief ? 0 : 1; eff = baseRank - fb - db; }
    else { eff = baseRank + strafPlek - fb - db; }
    return { ...sp, _act: { weken, straf: strafPlek, maand: st.maand, uniek, fb, db, actief, groep, eff } };
  });
}

// Sorteer verrijkte spelers op effectieve positie en ken weergaverang toe.
function sorteerOpActiviteit(verrijkt) {
  const arr = [...verrijkt].sort((a, b) =>
    (a._act.groep - b._act.groep) ||
    (a._act.eff - b._act.eff) ||
    ((a.rank || 999) - (b.rank || 999)));
  arr.forEach((s, i) => { s._weergaveRang = i + 1; });
  return arr;
}

// Geef de spelers in weergavevolgorde voor een ladder. Als het
// activiteitssysteem uit staat, gewoon op competitierank.
function getLadderSpelersWeergave(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  const spelers = getLadderSpelers(ladderId);
  const cfg = getLadderConfig(ladderId) || DEFAULT_LADDER_CONFIG;
  const actiefSysteem = cfg.inactiviteitAan !== false || cfg.frequentieBonusAan !== false || cfg.diversiteitsBonusAan !== false;
  if (!actiefSysteem || spelers.length === 0) return spelers;
  return sorteerOpActiviteit(verrijkMetActiviteit(spelers, ladder, cfg, Date.now(), alleToernooien));
}

// v3.0.2: Bereken de weergaverang (activiteits-gecorrigeerde ladderpositie)
// voor een MEEGEGEVEN spelerslijst, zonder de standen-cache te raadplegen.
// Geeft een map uid -> weergaverang terug. Zo kan ronde.js het uitslagbericht
// in exact dezelfde nummers tonen als de ladderlijst (fix discrepantie).
// extraUitslag (optioneel) telt een zojuist gespeelde partij mee voor de
// activiteitsberekening, zodat de "na"-stand overeenkomt met de ladder direct
// na afsluiten.
function berekenWeergaveRangen(ladderId, spelers, extraUitslag = null) {
  const map = {};
  if (!Array.isArray(spelers) || spelers.length === 0) return map;
  const cfg = getLadderConfig(ladderId) || DEFAULT_LADDER_CONFIG;
  const actiefSysteem = cfg.inactiviteitAan !== false || cfg.frequentieBonusAan !== false || cfg.diversiteitsBonusAan !== false;
  if (!actiefSysteem) {
    // Zonder activiteitssysteem is de weergaverang gewoon de competitierank-volgorde.
    [...spelers].sort((a, b) => (a.rank || 999) - (b.rank || 999))
      .forEach((s, i) => { if (s.uid) map[s.uid] = i + 1; });
    return map;
  }
  const ladder = alleLadders.find(l => l.id === ladderId);
  let ladderVoorCalc = ladder;
  if (extraUitslag && ladder) {
    const bestaande = (ladder.data?.uitslagen || ladder.uitslagen) || [];
    // data-veld leegzetten zodat verrijkMetActiviteit onze uitgebreide lijst pakt.
    ladderVoorCalc = { ...ladder, data: undefined, uitslagen: [...bestaande, extraUitslag] };
  }
  const gesorteerd = sorteerOpActiviteit(
    verrijkMetActiviteit(spelers, ladderVoorCalc, cfg, Date.now(), alleToernooien)
  );
  gesorteerd.forEach(s => { if (s.uid) map[s.uid] = s._weergaveRang; });
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
  const spelers = verrijkMetActiviteit(basis, ladder, cfg, Date.now(), alleToernooien);
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
    html += `<td style="position:sticky;left:0;z-index:1;background:var(--card-bg,#fff);padding:4px 8px;border-bottom:1px solid var(--soft-bg);border-right:2px solid var(--mid);font-weight:500">${i + 1}. ${esc(kort(rij))}</td>`;
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

window.openSpelermatrix = openSpelermatrix;

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
  // Bij actief activiteitssysteem is de getoonde rang de effectieve positie;
  // de prevRank-delta (competitierank) zou dan misleiden, dus verbergen.
  if (!s._act && s.prevRank != null && s.prevRank !== s.rank) {
    const d = s.prevRank - s.rank;
    deltaHtml = d > 0
      ? `<span class="delta-up" style="font-size:12px">▲${d}</span>`
      : `<span class="delta-down" style="font-size:12px">▼${Math.abs(d)}</span>`;
  } else if (!s._act && s.prevRank != null) {
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
    <div class="player-stats" style="text-align:right;min-width:52px">${s.partijen}P ${s.gewonnen}W<br>${winpct}%</div>
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
