// ============================================================
//  ladder-view.js — v3.0.0 fase 9a
//  View-laag die ladders.spelers[] oude shape reconstrueert uit:
//    - spelers/{uid}           (naam, hcp, email, rol)
//    - ladders/{id}/standen/{uid}  (rank, partijen, gewonnen, prevRank)
//    - ladder.spelerIds[]      (wie doet mee)
//
//  Gebruik: const spelers = getLadderSpelers(ladderId);
//  Shape:   [{ id (numeric legacy), uid, naam, hcp, rank, partijen, gewonnen, prevRank }]
// ============================================================
import { db } from './config.js';
import { store, alleLadders, _usersCache, alleSpelersData, _vasteListeners,
  huidigeBruiker } from './store.js';
import { collection, onSnapshot, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Cache ───────────────────────────────────────────────────
// Map<ladderId, Map<uid, {rank, partijen, gewonnen, prevRank}>>
if (!store._standenCache) store._standenCache = {};
// Map<ladderId, unsubscribe>
if (!store._standenUnsubs) store._standenUnsubs = {};

// ─── Helpers ─────────────────────────────────────────────────

// Zoek speler-profiel uit _usersCache OF alleSpelersData (fallback).
// Returnt { uid, naam, hcp, email, id } of null
function zoekSpeler(uidOfNaam) {
  // 1. Probeer _usersCache (uit spelers/ collectie)
  const users = _usersCache || [];
  let u = users.find(x => x.uid === uidOfNaam);
  if (u) {
    // Koppel ook numeric id uit alleSpelersData via naam (backward compat)
    const master = alleSpelersData.find(s => s.naam?.toLowerCase() === (u.naam || '').toLowerCase());
    return { uid: u.uid, naam: u.naam, hcp: u.hcp, email: u.email, id: master?.id };
  }
  // 2. Fallback op naam match (als uidOfNaam eigenlijk een naam is)
  const byName = users.find(x => x.naam?.toLowerCase() === (uidOfNaam || '').toLowerCase());
  if (byName) {
    const master = alleSpelersData.find(s => s.naam?.toLowerCase() === (byName.naam || '').toLowerCase());
    return { uid: byName.uid, naam: byName.naam, hcp: byName.hcp, email: byName.email, id: master?.id };
  }
  return null;
}

// ─── Publieke API ────────────────────────────────────────────

/**
 * Haal spelers uit een ladder in oude shape.
 * Als spelerIds[] bestaat EN standen/ cache gevuld is, gebruik die combinatie.
 * Anders fallback op ladder.spelers[] (backward compat — fase 9a is additief).
 */
export function getLadderSpelers(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) return [];

  const spelerIds = (ladder.data?.spelerIds || ladder.spelerIds || [])
    .filter(id => typeof id === 'string' && id.length > 10); // alleen uids
  const standenMap = store._standenCache[ladderId] || {};

  // Gebruik nieuwe view als er spelerIds EN standen gevuld zijn
  if (spelerIds.length > 0 && Object.keys(standenMap).length > 0) {
    const resultaat = [];
    for (const uid of spelerIds) {
      const profiel = zoekSpeler(uid);
      if (!profiel) continue;
      const stand = standenMap[uid] || { rank: 0, partijen: 0, gewonnen: 0 };
      resultaat.push({
        id:       profiel.id ?? uid,      // numeric fallback naar uid
        uid:      uid,
        naam:     profiel.naam,
        hcp:      profiel.hcp ?? 0,
        rank:     stand.rank     || 0,
        partijen: stand.partijen || 0,
        gewonnen: stand.gewonnen || 0,
        prevRank: stand.prevRank,
      });
    }
    return resultaat.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  }

  // Fallback: oude ladder.spelers[] (wordt in fase 9b uitgefaseerd)
  return [...(ladder.data?.spelers || ladder.spelers || [])]
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));
}

/**
 * Haal één speler uit een ladder op basis van uid.
 */
export function getLadderSpeler(ladderId, uid) {
  return getLadderSpelers(ladderId).find(s => s.uid === uid) || null;
}

/**
 * Check of een speler (uid) in een ladder zit.
 */
export function isInLadder(ladderId, uid) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder || !uid) return false;
  const spelerIds = ladder.data?.spelerIds || ladder.spelerIds || [];
  return spelerIds.includes(uid);
}

/**
 * Start live listener op standen/ subcollectie voor een ladder.
 * Idempotent: veilig om meermaals op te roepen.
 */
export function startStandenListener(ladderId) {
  if (store._standenUnsubs[ladderId]) return; // al actief
  if (!store._standenCache[ladderId]) store._standenCache[ladderId] = {};

  const unsub = onSnapshot(
    collection(db, 'ladders', ladderId, 'standen'),
    (snap) => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      store._standenCache[ladderId] = map;
      // Trigger re-render van actieve pagina
      const ap = document.querySelector('.page.active')?.id?.replace('page-', '');
      if (ap && huidigeBruiker) {
        // Import dynamisch om circulaire imports te vermijden
        import('./ladder.js').then(m => { if (ap === 'ladder') m.renderLadder(); });
      }
    },
    (err) => { console.warn('standen/ listener voor', ladderId, ':', err.code); }
  );

  store._standenUnsubs[ladderId] = unsub;
  _vasteListeners.push(unsub);
}

/**
 * Start listeners voor alle bekende ladders.
 * Roep op vanuit initFirestore na ladder-laad.
 */
export function startAlleStandenListeners() {
  alleLadders.forEach(l => startStandenListener(l.id));
}

/**
 * Stop alle standen listeners (bij uitloggen).
 */
export function stopAlleStandenListeners() {
  Object.values(store._standenUnsubs).forEach(unsub => {
    try { unsub(); } catch(e) {}
  });
  store._standenUnsubs = {};
  store._standenCache  = {};
}
