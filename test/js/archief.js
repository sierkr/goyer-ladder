// ============================================================
//  archief.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr, functions, httpsCallable, IS_TEST } from './config.js';
// v5.2.1: seizoensreset ruimt ook punten, partijen en verwerkt op (server-side).
const _resetSeizoenFn = httpsCallable(functions, 'resetLadderSeizoen');
import { store, huidigeBruiker, archiefData, uitdagingenData, alleLadders, activeLadderId } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { renderAdmin, renderProfiel } from './admin.js';
import { renderLadder } from './ladder.js';
import { slaSnapshotOp } from './beheer.js';   // v6.5.0: terugzetpunt vóór een nieuw seizoen
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, deleteField, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';


//  SEIZOENEN & ARCHIEF
// ============================================================
// ============================================================
//  NIEUW SEIZOEN — PER LADDER, MET EEN KEUZE VOOR DE BEGINSTAND  (v6.5.0)
// ------------------------------------------------------------
//  Sierk, 27 november 2026: "Ik wil binnenkort een nieuw seizoen starten maar
//  deze tab staat apart van de ladders. Dit moet per ladder kunnen en ik wil
//  een aantal opties om de beginstand vast te stellen bv huidige stand, ahv
//  gewonnen partijen, ahv winstpercentage, en welke nog meer?"
//
//  Tot v6.4.3: een losse kaart "Seizoen" in Beheer, ladders aanvinken, en één
//  keuze (volgorde omdraaien). Nu: een knop "Nieuw seizoen" bij elke ladder in
//  Beheer › Ladders (renderAdminLadders in js/beheer.js), een keuze uit negen
//  beginstanden, en de nieuwe beginstand meteen als lijst in het venster. Wat
//  je ziet is wat er komt: bevestigen gebruikt precies die lijst
//  (_seizoen.volgorde), ook bij loting.
//
//  ⚠ Terugzetpunt. Vroeger werden alle snapshots van de ladder gewist en was
//  er geen weg terug. Nu maakt de app EERST een snapshot "Eindstand <naam>",
//  en die blijft staan. Lukt die snapshot niet, dan gebeurt er niets
//  (BOUWNORMEN F5). Terugzetten herstelt plek, partijen en gewonnen; de
//  gewiste scorekaarten en uitslagen komen niet terug.
//
//  De server (resetLadderSeizoen) is ongewijzigd: hij zet de standen op de
//  volgorde die de app meegeeft, met de tellers op 0.
// ============================================================

// De beginstanden, in de volgorde van de keuzelijst.
const SEIZOEN_METHODES = [
  ['huidig',          'Huidige stand'],
  ['omgedraaid',      'Omgedraaid (de laatste wordt eerste)'],
  ['gewonnen',        'Meeste gewonnen partijen'],
  ['winstpercentage', 'Winstpercentage'],
  ['gespeeld',        'Meeste partijen gespeeld'],
  ['saldo',           'Saldo (gewonnen min verloren)'],
  ['handicap',        'Handicap, laagste eerst'],
  ['loting',          'Loting'],
  ['zonderOnder',     'Huidige stand, zonder partijen onderaan'],
];

// Rekent de nieuwe beginstand uit. `lijst` staat in de huidige volgorde (plek 1
// eerst) en heeft per speler { uid, rank, partijen, gewonnen, hcp }. De lijst
// zelf wordt niet veranderd. Bij gelijke uitkomst beslist steeds de huidige
// stand. `opties.minPartijen` (winstpercentage, standaard 3): wie minder
// speelde komt onder de anderen, in de huidige volgorde — anders staat iemand
// met 1 uit 1 bovenaan. Wie 0 partijen speelde heeft geen percentage en staat
// daar dus altijd. `opties.random` alleen voor de tests (loting).
function seizoenBeginstand(lijst, methode, opties) {
  const o = opties || {};
  const nu = (lijst || []).slice().sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
  const plek = new Map(nu.map((s, i) => [s, i]));
  const opStand = (a, b) => plek.get(a) - plek.get(b);
  const getal = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const gespeeld = (s) => Math.max(0, getal(s.partijen));
  const gewonnen = (s) => Math.max(0, getal(s.gewonnen));
  const aflopend = (waarde) => (a, b) => (waarde(b) - waarde(a)) || opStand(a, b);
  switch (methode) {
    case 'omgedraaid':
      return nu.reverse();
    case 'gewonnen':
      return nu.sort(aflopend(gewonnen));
    case 'gespeeld':
      return nu.sort(aflopend(gespeeld));
    case 'saldo':
      return nu.sort(aflopend(s => gewonnen(s) - (gespeeld(s) - gewonnen(s))));
    case 'winstpercentage': {
      const min = Math.max(1, Math.floor(getal(o.minPartijen === undefined ? 3 : o.minPartijen)));
      const telt = nu.filter(s => gespeeld(s) >= min);
      const rest = nu.filter(s => gespeeld(s) < min);
      telt.sort((a, b) => (gewonnen(b) / gespeeld(b) - gewonnen(a) / gespeeld(a))
        || (gespeeld(b) - gespeeld(a)) || opStand(a, b));
      return telt.concat(rest);
    }
    case 'handicap': {
      const hcp = (s) => (s.hcp === null || s.hcp === undefined || s.hcp === '' || !Number.isFinite(Number(s.hcp)))
        ? Infinity : Number(s.hcp);
      return nu.sort((a, b) => (hcp(a) - hcp(b)) || opStand(a, b));
    }
    case 'loting': {
      const r = typeof o.random === 'function' ? o.random : Math.random;
      for (let i = nu.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = nu[i]; nu[i] = nu[j]; nu[j] = t;
      }
      return nu;
    }
    case 'zonderOnder':
      return nu.filter(s => gespeeld(s) > 0).concat(nu.filter(s => !(gespeeld(s) > 0)));
    default:
      return nu;
  }
}

let _seizoen = null;        // { ladderId, ladderNaam, stand, volgorde, methode }
let _seizoenBezig = false;

// Leest de stand van één ladder: wie erin staat, op welke plek, met tellers.
async function _leesSeizoenStand(ladderId) {
  const ladderSnap = await getDoc(doc(db, 'ladders', ladderId));
  if (!ladderSnap.exists()) return null;
  const data = ladderSnap.data();
  const spelerIds = data.spelerIds || [];
  const users = (await getUsers()) || [];
  const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
  const stand = standenSnap.docs
    .filter(d => spelerIds.includes(d.id))
    .map(d => {
      const profiel = users.find(u => u.uid === d.id) || {};
      const s = d.data();
      return {
        uid:      d.id,
        naam:     profiel.naam || d.id,
        hcp:      (typeof profiel.hcp === 'number' && Number.isFinite(profiel.hcp)) ? profiel.hcp : null,
        rank:     s.rank     || 0,
        partijen: s.partijen || 0,
        gewonnen: s.gewonnen || 0,
      };
    })
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));
  return { naam: data.naam || ladderId, stand };
}

async function openNieuwSeizoenModal(ladderId) {
  const ladder = alleLadders.find(l => l.id === ladderId);
  if (!ladder) { toast('Ladder niet gevonden'); return; }
  _seizoen = null;
  const jaar = new Date().getFullYear();
  document.getElementById('seizoen-titel').textContent = `Nieuw seizoen — ${ladder.naam || ladderId}`;
  document.getElementById('seizoen-naam').value = `Seizoen ${jaar}`;
  const keuze = document.getElementById('seizoen-methode');
  keuze.innerHTML = SEIZOEN_METHODES.map(([id, tekst]) => `<option value="${id}">${esc(tekst)}</option>`).join('');
  keuze.value = 'huidig';
  document.getElementById('seizoen-min-partijen').value = '3';
  document.getElementById('seizoen-voorbeeld').innerHTML =
    '<p style="font-size:13px;color:var(--light)">Stand laden…</p>';
  document.getElementById('modal-nieuw-seizoen').classList.add('open');
  tekenSeizoenGevolg();
  try {
    const gelezen = await _leesSeizoenStand(ladderId);
    if (!gelezen) { toast('Ladder niet gevonden'); closeModal('modal-nieuw-seizoen'); return; }
    _seizoen = { ladderId, ladderNaam: gelezen.naam, stand: gelezen.stand, volgorde: gelezen.stand.slice(), methode: 'huidig' };
    tekenSeizoenVoorbeeld();
  } catch (e) {
    console.error('Stand voor nieuw seizoen laden mislukt:', e);
    document.getElementById('seizoen-voorbeeld').innerHTML =
      '<p style="font-size:13px;color:var(--alert-text)">De stand kon niet geladen worden. Sluit het venster en probeer het opnieuw.</p>';
  }
}

// Tekent de nieuwe beginstand onder de keuze. Wordt ook aangeroepen als de
// keuze of het minimum verandert; bij loting wordt er dan opnieuw geloot.
function tekenSeizoenVoorbeeld() {
  const vak = document.getElementById('seizoen-voorbeeld');
  if (!_seizoen || !vak) return;
  const methode = document.getElementById('seizoen-methode').value || 'huidig';
  const minRuw = parseInt(document.getElementById('seizoen-min-partijen').value, 10);
  const minPartijen = Number.isFinite(minRuw) && minRuw >= 1 ? minRuw : 3;
  document.getElementById('seizoen-min-wrap').style.display = methode === 'winstpercentage' ? '' : 'none';
  _seizoen.methode = methode;
  _seizoen.volgorde = seizoenBeginstand(_seizoen.stand, methode, { minPartijen });
  if (_seizoen.volgorde.length === 0) {
    vak.innerHTML = '<p style="font-size:13px;color:var(--light)">Deze ladder heeft geen spelers.</p>';
    return;
  }
  const extra = methode === 'winstpercentage' ? 'Winst' : (methode === 'handicap' ? 'Hcp' : '');
  const extraWaarde = (s) => {
    if (methode === 'winstpercentage') {
      return (s.partijen >= minPartijen && s.partijen > 0) ? Math.round(100 * s.gewonnen / s.partijen) + '%' : '–';
    }
    if (methode === 'handicap') return s.hcp === null ? '–' : esc(String(s.hcp).replace('.', ','));
    return '';
  };
  const th = 'style="text-align:left;padding:4px 6px;font-size:11px;color:var(--mid);font-weight:600"';
  const td = 'style="padding:4px 6px;border-top:1px solid var(--border)"';
  vak.innerHTML = `
    <table id="seizoen-voorbeeld-tabel" style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><th ${th}>Nieuw</th><th ${th}>Naam</th><th ${th}>Was</th><th ${th}>Gesp.</th><th ${th}>Gew.</th>${extra ? `<th ${th}>${extra}</th>` : ''}</tr>
      ${_seizoen.volgorde.map((s, i) => `
        <tr data-uid="${escAttr(s.uid)}">
          <td ${td}><strong>${i + 1}</strong></td>
          <td ${td}>${esc(s.naam)}</td>
          <td ${td}>${s.rank || '–'}</td>
          <td ${td}>${s.partijen}</td>
          <td ${td}>${s.gewonnen}</td>
          ${extra ? `<td ${td}>${extraWaarde(s)}</td>` : ''}
        </tr>`).join('')}
    </table>`;
  tekenSeizoenGevolg();
}

// De zin boven de knop: wat er gebeurt als je bevestigt.
function tekenSeizoenGevolg() {
  const el = document.getElementById('seizoen-gevolg');
  if (!el) return;
  const naam = (document.getElementById('seizoen-naam')?.value || '').trim() || 'het seizoen';
  const ladder = _seizoen?.ladderNaam || 'deze ladder';
  el.innerHTML = `<strong>Bij bevestigen:</strong> de eindstand van ${esc(ladder)} gaat naar het archief en er
    blijft een snapshot "Eindstand ${esc(naam)}" staan om terug te kunnen. Daarna wordt de lijst hierboven de
    nieuwe stand, gaan gespeeld en gewonnen op 0, worden de scorekaarten, uitslagen en andere snapshots van
    deze ladder gewist en gaan de betaald-vinkjes uit. De andere ladders blijven zoals ze zijn.`;
}

const _seizoenSleutel = (lijst) => JSON.stringify((lijst || [])
  .map(s => [s.uid, s.rank, s.partijen, s.gewonnen]));

async function bevestigNieuwSeizoen() {
  if (!_seizoen || _seizoenBezig) return;
  const naam = document.getElementById('seizoen-naam').value.trim();
  if (!naam) { toast('Geef het seizoen een naam'); return; }
  const { ladderId, ladderNaam } = _seizoen;
  const volgordeUids = _seizoen.volgorde.map(s => s.uid).filter(Boolean);
  if (volgordeUids.length === 0) { toast('Deze ladder heeft geen spelers'); return; }

  const knop = document.getElementById('seizoen-start-knop');
  const knopTekst = knop?.textContent;
  _seizoenBezig = true;
  let terugzetpunt = false;
  if (knop) { knop.disabled = true; knop.textContent = 'Bezig…'; }
  try {
    // 0) Is de stand intussen veranderd (een partij verwerkt terwijl het
    //    venster openstond)? Dan klopt de lijst niet meer met wat er komt.
    const vers = await _leesSeizoenStand(ladderId);
    if (!vers || _seizoenSleutel(vers.stand) !== _seizoenSleutel(_seizoen.stand)) {
      toast('De stand is intussen veranderd — er is niets veranderd. Open het venster opnieuw.', 9000);
      return;
    }

    // 1) Terugzetpunt. Lukt het niet, dan gebeurt er niets (BOUWNORMEN F5).
    const snapLabel = `Eindstand ${naam}`;
    const snapGelukt = await slaSnapshotOp(snapLabel, ladderId);
    if (!snapGelukt) {
      toast('Snapshot maken mislukt — er is niets veranderd', 9000);
      return;
    }
    terugzetpunt = true;

    // 2) Eindstand naar het archief.
    const seizoen = {
      naam,
      ladderId,
      ladderNaam,
      datum: new Date().toLocaleDateString('nl-NL'),
      timestamp: Date.now(),
      eindstand: vers.stand.map(s => ({
        rank: s.rank, naam: s.naam,
        partijen: s.partijen, gewonnen: s.gewonnen,
        hcp: Math.round(s.hcp ?? 0),
      })),
    };
    archiefData.unshift(seizoen);
    await setDoc(ARCHIEF_DOC, { seizoenen: archiefData }, { merge: true }); // v3.1.0: merge zodat het toernooien-veld niet gewist wordt

    // 3) Ladder-doc: uitslagen, lopende partijen en betaald-vinkjes leeg.
    // v6.3.0: deleteField() is nodig — een lege kaart {} met merge laat de
    // oude vinkjes staan.
    await setDoc(doc(db, 'ladders', ladderId), {
      uitslagen: [],
      actievePartijen: [],
      betaald: deleteField(),
    }, { merge: true });

    // 4) v5.2.1: standen op de nieuwe volgorde en het vorige seizoen opruimen
    //    (punten, partijen, verwerkt, teruggedraaid), via de server.
    await _resetSeizoenFn({ ladderId, isTest: IS_TEST, volgorde: volgordeUids });

    // 5) Uitslagen van deze ladder weg.
    try {
      const uSnap = await getDocs(query(UITSLAGEN_COL, where('ladderId', '==', ladderId)));
      await Promise.all(uSnap.docs.map(d => deleteDoc(d.ref)));
    } catch(e) { console.warn('uitslagen ladderId-filter mislukt:', e.message); }

    // 6) Snapshots van deze ladder weg — behalve het terugzetpunt van stap 1.
    try {
      const snSnap = await getDocs(query(SNAPSHOTS_COL, where('ladderId', '==', ladderId)));
      await Promise.all(snSnap.docs.filter(d => d.data().label !== snapLabel).map(d => deleteDoc(d.ref)));
    } catch(e) { console.warn('snapshots ladderId-filter mislukt:', e.message); }

    // 7) Lokale kopie bijwerken.
    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) {
      alleLadders[idx].actievePartijen = [];
      if (alleLadders[idx].data) {
        alleLadders[idx].data.uitslagen = [];
        alleLadders[idx].data.actievePartijen = [];
      }
    }

    // 10) Eenmalige legacy cleanup: docs zonder ladderId
    // (bestaande uitslagen van vóór v11.11 — testdata die bij geen specifieke ladder hoort)
    {
      try {
        const alleUitslagenSnap = await getDocs(UITSLAGEN_COL);
        const legacyDocs = alleUitslagenSnap.docs.filter(d => !d.data().ladderId);
        if (legacyDocs.length > 0) {
          await Promise.all(legacyDocs.map(d => deleteDoc(d.ref)));
          console.log(`Legacy cleanup: ${legacyDocs.length} uitslagen/ docs zonder ladderId verwijderd`);
        }
      } catch(e) { console.warn('Legacy uitslagen cleanup mislukt:', e.message); }
      try {
        const alleSnapshotsSnap = await getDocs(SNAPSHOTS_COL);
        const legacyDocs = alleSnapshotsSnap.docs.filter(d => !d.data().ladderId);
        if (legacyDocs.length > 0) {
          await Promise.all(legacyDocs.map(d => deleteDoc(d.ref)));
          console.log(`Legacy cleanup: ${legacyDocs.length} snapshots/ docs zonder ladderId verwijderd`);
        }
      } catch(e) { console.warn('Legacy snapshots cleanup mislukt:', e.message); }
    }

    closeModal('modal-nieuw-seizoen');
    renderAdmin();
    if (typeof renderLadder === 'function') renderLadder();
    toast(`${naam} gestart voor ${ladderNaam} ✓`, 7000);
  } catch(e) {
    console.error('bevestigNieuwSeizoen mislukt:', e);
    toast(terugzetpunt
      ? 'Nieuw seizoen starten mislukt halverwege. Zet de snapshot "Eindstand ' + naam + '" terug in Beheer › Snapshots.'
      : 'Nieuw seizoen starten mislukt — er is niets veranderd.', 12000);
  } finally {
    _seizoenBezig = false;
    if (knop) { knop.disabled = false; knop.textContent = knopTekst; }
  }
}

async function renderArchief() {

  try {
  const list = document.getElementById('archief-list');
  document.getElementById('archief-count').textContent = archiefData.length;

  // Gebruik gecachede archiefData — toernooien apart ophalen indien nodig
  let toernooien = [];
  if (!window._archiefToernooienCache) {
    const archiefSnap = await getDoc(ARCHIEF_DOC);
    window._archiefToernooienCache = archiefSnap.exists() ? (archiefSnap.data().toernooien || []) : [];
  }
  toernooien = window._archiefToernooienCache;

  let html = '';

  // Toernooien
  if (toernooien.length > 0) {
    html += `<div style="padding:10px 16px 6px"><p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;letter-spacing:.5px">Toernooien</p></div>`;
    html += toernooien.map((t, idx) => `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:600">🏅 ${esc(t.naam)}</span>
          <span style="font-size:12px;color:var(--light)">${esc(t.datum)}</span>
        </div>
        <div style="font-size:12px;color:var(--mid);margin-bottom:8px">${esc(t.baan)} · ${t.holes} holes · W=${t.ptWin} T=${t.ptTie} L=${t.ptLoss}</div>
        <div style="margin-bottom:8px">
          ${t.ranglijst?.slice(0,3).map((r,i) => `
            <span style="font-size:13px;margin-right:12px">${i===0?'🥇':i===1?'🥈':'🥉'} ${esc(r.naam)} <span style="color:var(--light)">${r.punten>0?'+':''}${r.punten}pt</span></span>
          `).join('')}
        </div>
        <button class="btn btn-sm btn-ghost" onclick="openToernooiDetail(${idx})">Bekijk uitslag →</button>
      </div>
    `).join('');
  }

  // Seizoenen
  if (archiefData.length > 0) {
    const isBeh = isBeheerderRol();
    html += `<div style="padding:10px 16px 6px;margin-top:8px"><p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;letter-spacing:.5px">Seizoenen</p></div>`;
    html += archiefData.map((s, idx) => {
      const winnaar = s.eindstand?.[0];
      const ladderLabel = s.ladderNaam ? ` · ${esc(s.ladderNaam)}` : '';
      const delBtn = isBeh
        ? `<button class="btn btn-sm" style="background:var(--alert-bg);color:var(--red);border:none;cursor:pointer;padding:4px 8px;border-radius:6px;font-size:12px;margin-left:6px" onclick="verwijderArchiefSeizoen(${idx})" title="Seizoen verwijderen uit archief">✕</button>`
        : '';
      return `
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:600;font-size:16px">${esc(s.naam)}${ladderLabel}</span>
          <span style="font-size:12px;color:var(--light)">${esc(s.datum)}</span>
        </div>
        ${winnaar ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-family:'Bebas Neue';font-size:18px;color:var(--gold)">🏆</span>
          <span style="font-weight:600">${esc(winnaar.naam)}</span>
        </div>` : ''}
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge badge-grey">${s.eindstand?.length || 0} spelers</span>
          <button class="btn btn-sm btn-ghost" onclick="openArchiefDetail(${idx})" style="margin-left:auto">Bekijk →</button>
          ${delBtn}
        </div>
      </div>`;
    }).join('');
  }

  if (!html) {
    html = '<div class="empty"><div class="empty-icon">📁</div><p>Nog geen afgesloten seizoenen of toernooien.</p></div>';
  }

  list.innerHTML = html;
  } catch(e) { console.error('renderArchief mislukt:', e); }
}

// v3.0.0-11.12: beheerder kan seizoen-entry uit archief verwijderen
async function verwijderArchiefSeizoen(idx) {
  if (!isBeheerderRol()) { toast('Alleen beheerder'); return; }
  const seizoen = archiefData[idx];
  if (!seizoen) return;
  const label = `${seizoen.naam}${seizoen.ladderNaam ? ' · ' + seizoen.ladderNaam : ''}`;
  if (!confirm(`Seizoen "${label}" permanent uit archief verwijderen?`)) return;
  try {
    const verwijderd = archiefData.splice(idx, 1)[0];
    await setDoc(ARCHIEF_DOC, { seizoenen: archiefData }, { merge: true }); // v3.1.0: merge zodat het toernooien-veld niet gewist wordt
    renderArchief();
    toast('Seizoen verwijderd ✓');
  } catch(e) {
    console.error('verwijderArchiefSeizoen mislukt:', e);
    toast('Fout bij verwijderen');
    // Re-laad om lokale state te herstellen
    try {
      const snap = await getDoc(ARCHIEF_DOC);
      store.archiefData = snap.exists() ? (snap.data().seizoenen || []) : [];
      renderArchief();
    } catch(_) {}
  }
}

async function openToernooiDetail(idx) {

  try {
  const toernooien = window._archiefToernooienCache || [];
  const t = toernooien[idx];
  if (!t) {
    // Cache nog niet gevuld — haal op
    const archiefSnap = await getDoc(ARCHIEF_DOC);
    window._archiefToernooienCache = archiefSnap.exists() ? (archiefSnap.data().toernooien || []) : [];
    const tFresh = window._archiefToernooienCache[idx];
    if (!tFresh) return;
    return openToernooiDetail(idx); // retry met cache gevuld
  }

  document.getElementById('archief-detail-titel').textContent = `🏅 ${t.naam}`;

  // v3.1.0: datum/baan/holes staan per dag in dagen[]; top-level velden bestaan niet
  // (waren daarom 'undefined'). Val terug op de eerste dag.
  const eersteDag = (t.dagen && t.dagen[0]) || {};
  const aDatum = t.datum || eersteDag.datum || '?';
  const aBaan  = t.baan  || eersteDag.baan  || '?';
  const aHoles = (t.holes ?? eersteDag.holes ?? '?');
  let html = `<p style="font-size:13px;color:var(--light);margin-bottom:16px">${aDatum} · ${aBaan} · ${aHoles} holes</p>`;

  // Ranglijst
  html += `<p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:8px">Eindranglijst</p>`;
  html += `<div style="margin-bottom:16px">`;
  t.ranglijst?.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:16px;min-width:28px">${medal}</span>
      <span style="flex:1;font-weight:500">${esc(r.naam)}</span>
      <span style="font-size:12px;color:var(--light)">${r.won}W ${r.tied}T ${r.lost}L</span>
      <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--green);min-width:40px;text-align:right">${r.punten>0?'+':''}${r.punten}pt</span>
    </div>`;
  });
  html += '</div>';

  // Matrix
  if (t.matrix && t.spelerNamen) {
    html += `<p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:8px">Onderlinge stand</p>`;
    html += `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;width:100%">`;
    html += `<tr><th style="padding:4px;background:var(--green);color:white"></th>`;
    t.spelerNamen.forEach(n => {
      html += `<th style="padding:4px 6px;background:var(--green);color:white;text-align:center">${esc(n)}</th>`;
    });
    html += '</tr>';
    t.spelerNamen.forEach((naam, i) => {
      html += `<tr><td style="padding:4px 8px;font-weight:600">${esc(naam)}</td>`;
      t.spelerNamen.forEach((_, j) => {
        // Ondersteun zowel oud array formaat als nieuw object formaat
        const cel = Array.isArray(t.matrix) ? (t.matrix[i]?.[j] || '-') : (t.matrix[`${i}_${j}`] || '-');
        const bg = cel === 'W' ? '#d4edda' : cel === 'L' ? '#f8d7da' : cel === 'T' ? '#fff3cd' : 'var(--border)';
        const tx = cel === 'W' ? 'UP' : cel === 'L' ? 'DOWN' : cel === 'T' ? 'TIED' : (cel === 'X' ? '—' : '—');
        const txtCol = (cel === 'W' || cel === 'L' || cel === 'T') ? '#1a1a1a' : 'var(--dark)';
        html += `<td style="background:${bg};color:${txtCol};text-align:center;padding:4px;font-weight:700">${tx}</td>`;
      });
      html += '</tr>';
    });
    html += '</table></div>';
  }

  document.getElementById('archief-detail-inhoud').innerHTML = html;
  document.getElementById('modal-archief-detail').classList.add('open');
  } catch(e) { console.error('openToernooiDetail mislukt:', e); }
}

function openArchiefDetail(idx) {
  const s = archiefData[idx];
  if (!s) return;
  document.getElementById('archief-detail-titel').textContent = s.naam;

  // Seizoensoverzicht statistieken
  const eindstand = s.eindstand || [];
  const totalPartijen = eindstand.reduce((t, sp) => t + (sp.partijen || 0), 0);
  const actief = eindstand.filter(sp => (sp.partijen || 0) > 0);
  const inactief = eindstand.filter(sp => (sp.partijen || 0) === 0);

  // Gespeelde banen samenvatting
  const baanTeller = {};
  (s.uitslagen || []).forEach(u => {
    if (u.baan) baanTeller[u.baan] = (baanTeller[u.baan] || 0) + 1;
  });
  const baanSamenvatting = Object.entries(baanTeller)
    .sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${b} ${n}x`)
    .join(' · ');

  let html = '';

  // Header statistieken
  html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
    <div style="text-align:center;background:var(--green-pale);border-radius:10px;padding:10px">
      <div style="font-family:'Bebas Neue';font-size:26px;color:var(--green)">${eindstand.length}</div>
      <div style="font-size:10px;color:var(--light);text-transform:uppercase">Spelers</div>
    </div>
    <div style="text-align:center;background:#fef3cd;border-radius:10px;padding:10px">
      <div style="font-family:'Bebas Neue';font-size:26px;color:var(--gold)">${totalPartijen}</div>
      <div style="font-size:10px;color:var(--light);text-transform:uppercase">Partijen</div>
    </div>
    <div style="text-align:center;background:#f0ede4;border-radius:10px;padding:10px">
      <div style="font-family:'Bebas Neue';font-size:26px;color:var(--mid)">${actief.length}</div>
      <div style="font-size:10px;color:var(--light);text-transform:uppercase">Actief</div>
    </div>
  </div>`;

  // Gespeelde banen
  if (baanSamenvatting) {
    html += `<div style="font-size:12px;color:var(--mid);margin-bottom:16px;padding:8px 10px;background:var(--soft-bg);border-radius:8px">
      ⛳ ${baanSamenvatting}
    </div>`;
  }

  // Eindstand — actieve spelers
  html += `<div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Eindstand</div>`;
  actief.forEach(sp => {
    const winpct = sp.partijen > 0 ? Math.round(sp.gewonnen / sp.partijen * 100) : 0;
    const verloren = (sp.partijen || 0) - (sp.gewonnen || 0);
    html += `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-family:'Bebas Neue';font-size:20px;color:${sp.rank<=3?'var(--gold)':'var(--light)'};min-width:28px">${sp.rank}</span>
      <span style="flex:1;font-weight:500;font-size:14px">${esc(sp.naam)}</span>
      <span style="font-size:11px;color:var(--mid);font-family:'DM Mono',monospace">${sp.partijen}G ${sp.gewonnen}W ${verloren}V ${winpct}%</span>
      <span style="font-size:11px;color:var(--light)">hcp ${sp.hcp}</span>
    </div>`;
  });

  // Niet gespeeld
  if (inactief.length > 0) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Niet gespeeld</div>`;
    inactief.forEach(sp => {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:'Bebas Neue';font-size:20px;color:var(--light);min-width:28px">${sp.rank}</span>
        <span style="flex:1;font-size:13px;color:var(--light)">${esc(sp.naam)}</span>
        <span style="font-size:11px;color:#ccc">hcp ${sp.hcp}</span>
      </div>`;
    });
  }

  document.getElementById('archief-detail-inhoud').innerHTML = html;
  document.getElementById('modal-archief-detail').classList.add('open');
}

// ============================================================
//  NOTIFICATIES (in-app only — push uitgeschakeld)
// ============================================================

async function stuurNotificatie(naarUid, titel, bericht) {

  try {
  // Geen push — notificatie wordt zichtbaar via Firestore live update
  } catch(e) { console.error('stuurNotificatie mislukt:', e); }
}

// ============================================================
//  UITDAGINGEN
// ============================================================

// v6.3.0: uitdagen staat niet meer in het scherm (Sierk, 5 november 2026).
// De knop heet dus altijd gewoon "Profiel", zonder teller van open
// uitdagingen. De functies hieronder blijven bestaan, maar niets roept ze nog
// aan vanuit het scherm; de oude lijst in ladder/uitdagingen blijft staan.
function toonUitdagingBadge() {
  const profielBtn = document.getElementById('nav-profiel-btn');
  if (profielBtn) profielBtn.textContent = '👤 Profiel';
}

async function stuurUitdaging(naarUid) {
  try {
  // Zoek speler via uid in de actieve ladder (standen/{uid} via getLadderSpelers)
  const users = await getUsers();
  const naarUser = users.find(u => u.uid === naarUid);
  if (!naarUser) { toast('Kan gebruiker niet vinden voor uitdaging'); return; }

  // Check of er al een open uitdaging is
  const bestaand = uitdagingenData.find(u =>
    ((u.vanEmail === huidigeBruiker.email && u.naarEmail === naarUser.email) ||
     (u.vanEmail === naarUser.email && u.naarEmail === huidigeBruiker.email)) &&
    u.status === 'open'
  );
  if (bestaand) { toast('Er is al een openstaande uitdaging'); return; }

  const uitdaging = {
    id: `u_${Date.now()}`,
    vanEmail: huidigeBruiker.email,
    vanNaam: huidigeBruiker.gebruikersnaam,
    naarEmail: naarUser.email,
    naarNaam: naarUser.naam || naarUser.gebruikersnaam || '',
    naarUid: naarUser.uid || null,
    status: 'open',
    timestamp: Date.now()
  };

  uitdagingenData.push(uitdaging);
  await setDoc(UITDAGINGEN_DOC, { lijst: uitdagingenData });

  // Stuur notificatie
  if (naarUser.uid) {
    await stuurNotificatie(naarUser.uid, '⚔️ Nieuwe uitdaging!', `${huidigeBruiker.gebruikersnaam} daagt je uit voor een matchplay partij`);
  }

  toast(`Uitdaging verstuurd naar ${(naarUser.naam || naarUser.gebruikersnaam || '').split(' ')[0]} ✓`);
  renderLadder(); // refresh voor uitdagingsknop
  } catch(e) { console.error('stuurUitdaging mislukt:', e); }
}

async function reageerUitdaging(uitdagingId, accepteer) {
  try {
  const idx = uitdagingenData.findIndex(u => u.id === uitdagingId);
  if (idx === -1) return;
  uitdagingenData[idx].status = accepteer ? 'geaccepteerd' : 'geweigerd';
  await setDoc(UITDAGINGEN_DOC, { lijst: uitdagingenData });

  if (accepteer) {
    toast('Uitdaging geaccepteerd! Plan de partij in via het Partij-tabblad.');
    const vanUser = (await getUsers())?.find(u => u.email === uitdagingenData[idx].vanEmail);
    if (vanUser?.uid) {
      await stuurNotificatie(vanUser.uid, '✅ Uitdaging geaccepteerd!', `${huidigeBruiker.gebruikersnaam} heeft je uitdaging geaccepteerd`);
    }
  } else {
    toast('Uitdaging geweigerd.');
  }

  toonUitdagingBadge();
  renderProfiel();
  } catch(e) { console.error('reageerUitdaging mislukt:', e); toast('Actie mislukt, probeer opnieuw'); }
}

async function verwijderUitdaging(uitdagingId) {

  try {
  store.uitdagingenData = uitdagingenData.filter(u => u.id !== uitdagingId);
  await setDoc(UITDAGINGEN_DOC, { lijst: uitdagingenData });
  toonUitdagingBadge();
  renderProfiel();
  } catch(e) { console.error('verwijderUitdaging mislukt:', e); }
}

// ============================================================

async function verwijderOudeUitslagen() {
  // Verwijder scorekaarten ouder dan 30 dagen
  const dertigDagenGelden = Date.now() - (30 * 24 * 60 * 60 * 1000);
  try {
    const q = query(UITSLAGEN_COL, where('timestamp', '<', dertigDagenGelden));
    const snap = await getDocs(q);
    snap.forEach(async d => await deleteDoc(d.ref));
    // oude scorekaarten opgeschoond
  } catch(e) { console.error('Opschonen mislukt:', e); }
}

export { bevestigNieuwSeizoen, tekenSeizoenVoorbeeld, tekenSeizoenGevolg, seizoenBeginstand, openArchiefDetail, openNieuwSeizoenModal, openToernooiDetail, reageerUitdaging, renderArchief, stuurNotificatie, stuurUitdaging, toonUitdagingBadge, verwijderOudeUitslagen, verwijderUitdaging, verwijderArchiefSeizoen };
