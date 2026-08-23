// ============================================================
//  scores.js — scores per speler in een eigen document (v5.0.0, punt 4)
// ============================================================
//
//  WAT ER MIS WAS (t/m v4.2.0)
//  Alle scores van alle lopende partijen stonden in één array
//  (`ladders/{id}.actievePartijen[]`) in het ladderdocument. Firestore
//  behandelt een array als één ondeelbare waarde: je kunt er niet met een
//  veldpad in prikken. Elke toetsaanslag in de scorekaart schreef dus de
//  COMPLETE array van de hele ladder terug via slaActievePartijenOp().
//
//  Gevolgen:
//   - Twee flights die tegelijk op dezelfde ladder speelden overschreven
//     elkaars holes: wie het laatst opsloeg, won.
//   - Het horloge deed hetzelfde met een fire-and-forget PATCH op datzelfde
//     veld, dus horloge en telefoon van dezelfde speler konden elkaar wissen.
//   - Iedereen met dat scherm open downloadde het complete ladderdocument
//     opnieuw bij elke toetsaanslag van elke speler.
//
//  HOE HET NU WERKT
//    ladders/{ladderId}/partijen/{partijId}              -> metadata
//    ladders/{ladderId}/partijen/{partijId}/scores/{uid} -> { holes: {"0":4,...} }
//
//  Elke speler heeft een eigen scoredocument en er wordt per hole één veld
//  geschreven (`holes.7`). Twee spelers kunnen elkaar structureel niet meer
//  overschrijven, en als jij op het horloge de kaart van je flightgenoot
//  bijhoudt terwijl hij zelf een andere hole invult, worden die samengevoegd
//  in plaats van dat er één verdwijnt.
//
//  OVERGANG (dubbel schrijven)
//  Deze versie schrijft nog steeds ook naar de oude actievePartijen-array,
//  zodat een speler die de update nog niet heeft binnengehaald blijft werken.
//  De array is vanaf nu echter een AFGELEIDE, alleen-lezen kopie: hij wordt
//  vertraagd bijgewerkt vanuit de live cache (die zelf uit deze documenten
//  komt), en bij het lezen heeft de subcollectie altijd voorrang. Raakt die
//  kopie een keer achter door twee flights tegelijk, dan is dat onschadelijk —
//  de echte scores staan hier. In v5.1.0 verdwijnt de array.
// ============================================================

import { db } from './config.js';
import {
  doc, collection, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Refs ────────────────────────────────────────────────────
export function partijRef(ladderId, partijId) {
  return doc(db, 'ladders', ladderId, 'partijen', partijId);
}
export function scoresCol(ladderId, partijId) {
  return collection(db, 'ladders', ladderId, 'partijen', partijId, 'scores');
}
export function scoreRef(ladderId, partijId, uid) {
  return doc(db, 'ladders', ladderId, 'partijen', partijId, 'scores', uid);
}

// ─── Conversie tussen holes-map en de array-vorm die de app gebruikt ────────
// De rest van de app werkt met `p.scores[uid][holeIdx]` (array met null-gaten).
// Dat blijft zo — deze module vertaalt alleen bij lezen en schrijven, zodat
// bestaande code als berekenMatchStand() ongewijzigd blijft werken.
export function holesMapNaarArray(map, lengte) {
  const arr = new Array(lengte).fill(null);
  for (const [k, v] of Object.entries(map || {})) {
    const i = parseInt(k, 10);
    if (Number.isInteger(i) && i >= 0 && i < lengte) {
      arr[i] = (v === undefined ? null : v);
    }
  }
  return arr;
}
export function arrayNaarHolesMap(arr) {
  const map = {};
  (arr || []).forEach((v, i) => { map[String(i)] = (v === undefined ? null : v); });
  return map;
}

// ─── Partij aanmaken ─────────────────────────────────────────
/**
 * Schrijft het partij-document plus een leeg scoredocument per speler.
 * Gasten krijgen ook een document — die tellen niet mee voor de ladder,
 * maar hun scores horen wel op de kaart.
 */
// v5.7.1: Firestore accepteert geen lijst binnen een lijst. Gebeurde dat toch,
// dan mislukte het schrijven met een melding die de verkeerde kant op wees —
// bij High-Low las je "controleer je verbinding of rechten" terwijl er niets
// mis was met de verbinding. Deze controle noemt het veld bij naam.
export function zoekGenesteLijsten(waarde, pad = '') {
  const uit = [];
  if (Array.isArray(waarde)) {
    waarde.forEach((x, i) => {
      if (Array.isArray(x)) uit.push(`${pad}[${i}]`);
      else uit.push(...zoekGenesteLijsten(x, `${pad}[${i}]`));
    });
  } else if (waarde && typeof waarde === 'object') {
    for (const k of Object.keys(waarde)) {
      uit.push(...zoekGenesteLijsten(waarde[k], pad ? `${pad}.${k}` : k));
    }
  }
  return uit;
}

export async function maakPartijDocument(ladderId, partij) {
  const genest = zoekGenesteLijsten(partij);
  if (genest.length) {
    throw new Error('Partij bevat een lijst binnen een lijst (' + genest.join(', ')
      + '). Firestore accepteert dat niet.');
  }
  const batch = writeBatch(db);

  // Metadata zonder de scores — die horen vanaf nu in de subcollectie.
  const { scores, ...meta } = partij;
  batch.set(partijRef(ladderId, partij.partijId), {
    ...meta,
    ladderId,
    status: 'actief',
    aangemaakt: Date.now(),
  });

  const aantalHoles = (partij.holes || []).length;
  (partij.spelers || []).forEach(s => {
    if (!s || !s.uid) return;
    const bestaand = partij.scores?.[s.uid];
    batch.set(scoreRef(ladderId, partij.partijId, s.uid), {
      uid: s.uid,
      naam: s.naam || '',
      holes: Array.isArray(bestaand)
        ? arrayNaarHolesMap(bestaand)
        : arrayNaarHolesMap(new Array(aantalHoles).fill(null)),
      bijgewerkt: Date.now(),
    });
  });

  await batch.commit();
}

/**
 * Voegt een scoredocument toe voor een speler die later bij een lopende
 * partij komt (v5.8.0: via 'Partij-instellingen aanpassen').
 */
export async function voegSpelerToeAanPartij(ladderId, partijId, speler, aantalHoles) {
  if (!speler?.uid) return;
  await setDoc(scoreRef(ladderId, partijId, speler.uid), {
    uid: speler.uid,
    naam: speler.naam || '',
    holes: arrayNaarHolesMap(new Array(aantalHoles).fill(null)),
    bijgewerkt: Date.now(),
  }, { merge: true });
}

export async function verwijderSpelerUitPartijDoc(ladderId, partijId, uid) {
  try { await deleteDoc(scoreRef(ladderId, partijId, uid)); }
  catch (e) { console.warn('[scores] speler verwijderen mislukt:', e?.code || e); }
}

// ─── Score schrijven ─────────────────────────────────────────
/**
 * Schrijft één hole van één speler. Dit is de enige plek waar een score
 * naar Firestore gaat.
 *
 * Merge op veldniveau: `holes.7` raakt alleen hole 8 van deze speler. Andere
 * holes en andere spelers blijven ongemoeid, ook als er tegelijk iemand
 * anders schrijft.
 */
export async function schrijfScore(ladderId, partijId, uid, holeIdx, waarde) {
  const payload = {
    holes: { [String(holeIdx)]: (waarde === undefined ? null : waarde) },
    bijgewerkt: Date.now(),
  };
  await setDoc(scoreRef(ladderId, partijId, uid), payload, { merge: true });
}

// ─── Score lezen ─────────────────────────────────────────────
/**
 * Eenmalig alle scores van een partij ophalen als { uid: [.. per hole ..] }.
 * Geeft null terug als er (nog) geen scoredocumenten zijn — dan moet de
 * aanroeper terugvallen op de oude array-structuur.
 */
export async function leesScores(ladderId, partijId, aantalHoles) {
  try {
    const snap = await getDocs(scoresCol(ladderId, partijId));
    if (snap.empty) return null;
    const uit = {};
    snap.forEach(d => { uit[d.id] = holesMapNaarArray((d.data() || {}).holes, aantalHoles); });
    return uit;
  } catch (e) {
    console.warn('[scores] leesScores mislukt:', e?.code || e);
    return null;
  }
}

export async function leesPartijDocument(ladderId, partijId) {
  try {
    const snap = await getDoc(partijRef(ladderId, partijId));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

/**
 * Live meeluisteren op de scores van één partij.
 *
 * Schrijft binnenkomende scores rechtstreeks in het meegegeven partij-object
 * (`partijObj.scores[uid][holeIdx]`), zodat alle bestaande renderfuncties en
 * berekeningen ongewijzigd blijven werken. Roept daarna `onWijziging()` aan.
 *
 * Retourneert de unsubscribe-functie.
 */
export function luisterOpScores(ladderId, partijId, partijObj, onWijziging) {
  const aantalHoles = (partijObj?.holes || []).length;
  return onSnapshot(
    scoresCol(ladderId, partijId),
    (snap) => {
      if (!partijObj) return;
      if (!partijObj.scores) partijObj.scores = {};
      let gewijzigd = false;
      snap.forEach(d => {
        const nieuw = holesMapNaarArray((d.data() || {}).holes, aantalHoles);
        const oud = partijObj.scores[d.id];
        if (!Array.isArray(oud) || oud.length !== nieuw.length ||
            nieuw.some((v, i) => v !== oud[i])) {
          partijObj.scores[d.id] = nieuw;
          gewijzigd = true;
        }
      });
      if (gewijzigd && typeof onWijziging === 'function') onWijziging();
    },
    (err) => console.warn('[scores] listener mislukt:', err?.code || err)
  );
}

// ─── Opruimen ────────────────────────────────────────────────
/**
 * Verwijdert het partij-document inclusief alle scoredocumenten.
 * Wordt aangeroepen als een partij wordt afgesloten of geannuleerd.
 */
export async function verwijderPartijDocument(ladderId, partijId) {
  try {
    const snap = await getDocs(scoresCol(ladderId, partijId));
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    batch.delete(partijRef(ladderId, partijId));
    await batch.commit();
  } catch (e) {
    console.warn('[scores] verwijderPartijDocument mislukt:', e?.code || e);
  }
}
