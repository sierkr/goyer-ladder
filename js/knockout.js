// ============================================================
//  knockout.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, state, alleLadders, activeLadderId, _koLadderId, _koIndelingVolgorde, _koDragIdx, _koTouchClone, _koTouchStartY } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { initFirestore } from './auth.js';
import { renderLadder, toggleLadderKaart } from './ladder.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';


//  KNOCKOUT LADDER
// ============================================================

// Helpers voor rondes opslag (Firestore ondersteunt geen geneste arrays)
function rondesNaarObj(arr) {
  const obj = { _count: arr.length };

    arr.forEach((r, i) => { obj[`r${i}`] = r; });
  return obj;
}
function objNaarRondes(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj; // legacy
  const count = obj._count || 0;
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(obj[`r${i}`] || []);
  return arr;
}

function renderKnockoutLadderKaart(l) {
  const data = l.data;
  const rondes = objNaarRondes(data.rondes);
  const spelers = data.spelers || [];
  const isBeheerder = isCoordinatorRol();
  const huidigRonde = rondes.length;
  const seizoenActief = spelers.length > 0;

  let badgeTekst = seizoenActief ? `Ronde ${huidigRonde || 1}` : 'Geen seizoen';
  let inhoud = '';

  if (!seizoenActief) {
    inhoud = `<div class="empty"><p>Nog geen seizoen gestart.</p></div>`;
  } else {
    inhoud = renderKnockoutBracket(data, l.id);
  }

  const beheerderKnoppen = isBeheerder ? `
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">
      ${rondes.length === 0 && seizoenActief ? `<button class="btn btn-sm btn-primary" onclick="openKnockoutIndeling('${l.id}')">⚙️ Ronde 1 indeling</button>` : ''}
      ${rondes.length > 0 ? `<button class="btn btn-sm btn-ghost" onclick="openKnockoutIndeling('${l.id}')">✏️ Indeling aanpassen</button>` : ''}
      <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="nieuwKnockoutSeizoen('${l.id}')">🔄 Nieuw seizoen</button>
    </div>` : '';

  return `<div class="card" style="margin-bottom:16px">
    <div class="card-header inklapbaar" onclick="toggleLadderKaart(this,'${l.id}')">
      <h2>${l.naam} <span style="font-size:12px;color:var(--light);font-family:'DM Sans'">knock-out</span></h2>
      <span class="badge badge-gold">${badgeTekst}</span>
    </div>
    <div class="card-collapse" id="ladder-collapse-${l.id}">
      <div id="ladder-list-${l.id}">${inhoud}</div>
      ${beheerderKnoppen}
    </div>
  </div>`;
}

function renderKnockoutBracket(data, ladderId) {
  const rondes = objNaarRondes(data.rondes);
  const spelers = data.spelers || [];
  const isBeheerder = isCoordinatorRol();
  if (spelers.length === 0) return '<div class="empty"><p>Geen spelers.</p></div>';
  if (rondes.length === 0) return '<div style="padding:12px 16px;font-size:13px;color:var(--light)">Ronde 1 is nog niet ingedeeld.</div>';

  const aantalSpelers = spelers.length;
  const bracketGrootte = Math.pow(2, Math.ceil(Math.log2(aantalSpelers)));
  const totaalRondes = Math.log2(bracketGrootte);

  let html = '<div style="overflow-x:auto;padding:12px 16px">';

  // Finale winnaar bovenaan
  const finaleRonde = rondes[rondes.length - 1];
  if (finaleRonde?.length === 1 && finaleRonde[0].winnaar && finaleRonde[0].winnaar !== '' && rondes.length === totaalRondes) {
    html += `<div style="text-align:center;padding:16px;background:var(--green-pale);border-radius:10px;margin-bottom:16px">
      <div style="font-family:'Bebas Neue';font-size:24px;color:var(--gold)">🏆 ${finaleRonde[0].winnaar}</div>
      <div style="font-size:12px;color:var(--mid)">Winnaar knock-out ladder</div>
    </div>`;
  }

  rondes.slice().reverse().forEach((ronde, ri) => {
    const riOrig = rondes.length - 1 - ri; // originele index voor namen
    const rondeNaam = riOrig === totaalRondes - 1 ? 'Finale' :
                      riOrig === totaalRondes - 2 ? 'Halve finale' :
                      riOrig === totaalRondes - 3 ? 'Kwartfinale' :
                      `Ronde ${riOrig + 1}`;

    html += `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${rondeNaam}</div>`;

    ronde.forEach((partij, pi) => {
      const nA = partij.a || 'BYE';
      const nB = partij.b || 'BYE';
      const winnaar = partij.winnaar || '';
      const isBye = !partij.b || !partij.a;

      const stijlA = winnaar === partij.a ? 'font-weight:700;color:var(--green)' : winnaar && winnaar !== partij.a ? 'color:var(--light);text-decoration:line-through' : '';
      const stijlB = winnaar === partij.b ? 'font-weight:700;color:var(--green)' : winnaar && winnaar !== partij.b ? 'color:var(--light);text-decoration:line-through' : '';

      // Beheerder knoppen om winnaar aan te wijzen
      const beheerderBtns = isBeheerder && !isBye && !winnaar ? `
        <div style="display:flex;flex-direction:column;gap:3px">
          <button onclick="slaKnockoutWinnaarOp('${ladderId}',${riOrig},${pi},'${partij.a}')" class="btn btn-sm btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--green)">✓ ${nA.split(' ')[0]}</button>
          <button onclick="slaKnockoutWinnaarOp('${ladderId}',${riOrig},${pi},'${partij.b}')" class="btn btn-sm btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--green)">✓ ${nB.split(' ')[0]}</button>
        </div>` :
        isBeheerder && winnaar && !isBye ? `<button onclick="slaKnockoutWinnaarOp('${ladderId}',${riOrig},${pi},'')" class="btn btn-sm btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--light)">↩</button>` : '';

      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;font-size:13px">
          <div style="${stijlA}">${nA}</div>
          <div style="color:var(--light);font-size:10px;margin:2px 0">vs</div>
          <div style="${stijlB}">${isBye ? '<em style="color:var(--light)">BYE</em>' : nB}</div>
        </div>
        ${isBye ? `<span class="badge badge-green" style="font-size:10px">✓ ${winnaar} →</span>` :
          winnaar ? `<span class="badge badge-green" style="font-size:10px">✓ ${winnaar}${partij.resultaat ? ` (${partij.resultaat})` : ''}</span>` :
          `<span style="font-size:11px;color:var(--light)">Nog te spelen</span>`}
        ${beheerderBtns}
      </div>`;
    });

    html += '</div>';
  });

  html += '</div>';
  return html;
}

async function openKnockoutIndeling(ladderId) {
  try {
  store._koLadderId = ladderId;
  const ladder = alleLadders.find(l => l.id === ladderId);
  const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
  const data = snapExists ? snapData : {};
  const spelers = data.spelers || [];
  const rondes = objNaarRondes(data.rondes);

  // Als ronde 1 al bestaat, toon die indeling
  // Anders: random indeling genereren
  let indeling;
  if (rondes.length > 0) {
    indeling = rondes[0].map(p => ({ a: p.a, b: p.b }));
    // Zet speler namen in volgorde
    store._koIndelingVolgorde = rondes[0].flatMap(p => [p.a, p.b].filter(Boolean));
  } else {
    // Random shuffle
    const namen = spelers.map(s => s.naam);
    for (let i = namen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [namen[i], namen[j]] = [namen[j], namen[i]];
    }
    // Aanvullen met byes tot macht van 2
    const bracketGrootte = Math.pow(2, Math.ceil(Math.log2(namen.length)));
    while (namen.length < bracketGrootte) namen.push(null);
    store._koIndelingVolgorde = namen;
  }

  renderKnockoutIndelingModal();
  document.getElementById('modal-knockout-indeling').classList.add('open');
  } catch(e) { console.error('openKnockoutIndeling mislukt:', e); toast('Er is iets misgegaan'); }
}

function renderKnockoutIndelingModal() {
  const lijst = document.getElementById('knockout-indeling-lijst');
  if (!lijst) return;
  const namen = _koIndelingVolgorde;

  let html = '<div style="margin-bottom:8px;font-size:12px;color:var(--light)">Sleep spelers om te wisselen. Koppels worden per twee gevormd.</div>';

  namen.forEach((naam, idx) => {
    const koppelNr = Math.floor(idx / 2) + 1;
    const isEerste = idx % 2 === 0;
    const isBye = !naam;
    html += `
      <div draggable="true"
        ondragstart="koDragStart(event,${idx})"
        ondragover="koDragOver(event)"
        ondrop="koDrop(event,${idx})"
        ondragend="koDragEnd(event)"
        data-idx="${idx}"
        style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);user-select:none">
        ${isEerste
          ? `<span style="font-size:10px;color:var(--light);width:20px;text-align:right;flex-shrink:0">${koppelNr}</span>`
          : `<span style="width:20px;flex-shrink:0"></span>`}
        <div style="flex:1;background:${isBye ? '#f0ede4' : 'var(--green-pale)'};border-radius:8px;padding:8px 12px;font-size:13px;font-weight:${isBye ? '400' : '600'};color:${isBye ? 'var(--light)' : 'inherit'}">
          ${isBye ? 'BYE' : naam}
        </div>
        <div style="padding:8px;cursor:grab;touch-action:none;flex-shrink:0;font-size:18px;color:var(--light)"
          ontouchstart="koTouchStart(event,${idx})">⠿</div>
      </div>
      ${idx % 2 === 1 ? '<div style="height:6px"></div>' : ''}`;
  });

  lijst.innerHTML = html;

  // Stel scrollhoogte correct in op basis van beschikbare ruimte
  requestAnimationFrame(() => {
    const modal = lijst.closest('.modal');
    if (!modal) return;
    const modalRect = modal.getBoundingClientRect();
    const lijstTop = lijst.getBoundingClientRect().top;
    const actions = modal.querySelector('.modal-actions');
    const actionsH = actions ? actions.offsetHeight + 16 : 80;
    const maxH = modalRect.bottom - lijstTop - actionsH - 16;
    lijst.style.maxHeight = Math.max(200, maxH) + 'px';
  });
}


function koDragStart(event, idx) {
  store._koDragIdx = idx;
  event.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { if (event.target) event.target.style.opacity = '0.4'; }, 0);
}
function koDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#knockout-indeling-lijst [data-idx]').forEach(el => el.style.background = '');
  const doel = event.currentTarget;
  if (doel && _koDragIdx !== null && parseInt(doel.dataset.idx) !== _koDragIdx) {
    doel.style.background = 'rgba(74,124,89,0.1)';
  }
}
function koDrop(event, doelIdx) {
  event.preventDefault();
  if (_koDragIdx === null || _koDragIdx === doelIdx) return;
  const n = _koIndelingVolgorde;
  if (!n[_koDragIdx]) return;
  [n[_koDragIdx], n[doelIdx]] = [n[doelIdx], n[_koDragIdx]];
  store._koDragIdx = null;
  renderKnockoutIndelingModal();
}
function koDragEnd(event) {
  store._koDragIdx = null;
  document.querySelectorAll('#knockout-indeling-lijst [data-idx]').forEach(el => {
    el.style.opacity = ''; el.style.background = '';
  });
}

// Touch support voor mobiel
function koTouchStart(event, idx) {
  if (!_koIndelingVolgorde[idx]) return;
  event.preventDefault();
  store._koDragIdx = idx;
  store._koTouchStartY = event.touches[0].clientY;

  const rij = event.currentTarget.closest('[data-idx]');
  if (rij) rij.style.opacity = '0.4';

  const cloneSource = rij || event.currentTarget;
  store._koTouchClone = cloneSource.cloneNode(true);
  _koTouchClone.style.position = 'fixed';
  _koTouchClone.style.zIndex = '9999';
  _koTouchClone.style.width = cloneSource.offsetWidth + 'px';
  _koTouchClone.style.pointerEvents = 'none';
  _koTouchClone.style.opacity = '0.85';
  _koTouchClone.style.transform = 'scale(1.02)';
  _koTouchClone.style.background = 'var(--green-pale)';
  _koTouchClone.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
  _koTouchClone.style.borderRadius = '8px';
  _koTouchClone.style.top = cloneSource.getBoundingClientRect().top + 'px';
  _koTouchClone.style.left = cloneSource.getBoundingClientRect().left + 'px';
  document.body.appendChild(_koTouchClone);

  // Registreer move en end op document zodat ze altijd gevangen worden
  document.addEventListener('touchmove', koTouchMove, { passive: false });
  document.addEventListener('touchend', _koTouchEndHandler);
}

function _koTouchEndHandler(event) {
  document.removeEventListener('touchmove', koTouchMove);
  document.removeEventListener('touchend', _koTouchEndHandler);
  koTouchEnd(event);
}

function koTouchMove(event) {
  event.preventDefault();
  if (!_koTouchClone) return;
  const touch = event.touches[0];
  _koTouchClone.style.top = (touch.clientY - 30) + 'px';

  // Highlight element onder vinger
  document.querySelectorAll('#knockout-indeling-lijst [data-idx]').forEach(el => el.style.background = '');
  const elOnder = document.elementFromPoint(touch.clientX, touch.clientY);
  const rij = elOnder?.closest('[data-idx]');
  if (rij && parseInt(rij.dataset.idx) !== _koDragIdx) {
    rij.style.background = 'rgba(74,124,89,0.1)';
  }
}

function koTouchEnd(event) {
  if (_koTouchClone) { _koTouchClone.remove(); store._koTouchClone = null; }
  document.querySelectorAll('#knockout-indeling-lijst [data-idx]').forEach(el => {
    el.style.opacity = ''; el.style.background = '';
  });

  if (_koDragIdx === null) return;

  const touch = event.changedTouches[0];
  const elOnder = document.elementFromPoint(touch.clientX, touch.clientY);
  const rij = elOnder?.closest('[data-idx]');
  if (rij) {
    const doelIdx = parseInt(rij.dataset.idx);
    if (doelIdx !== _koDragIdx) {
      const n = _koIndelingVolgorde;
      [n[_koDragIdx], n[doelIdx]] = [n[doelIdx], n[_koDragIdx]];
      renderKnockoutIndelingModal();
    }
  }
  store._koDragIdx = null;
}

function verschuifKoSpeler(idx, delta) {
  const n = _koIndelingVolgorde;
  const doel = idx + delta;
  if (doel < 0 || doel >= n.length) return;
  [n[idx], n[doel]] = [n[doel], n[idx]];
  renderKnockoutIndelingModal();
}

async function bevestigKnockoutIndeling() {
  try {
    const { exists: snapExists, data: snapData } = await getLadderData(_koLadderId);
    if (!snapExists) return;
    const data = snapData;
    const namen = _koIndelingVolgorde;

    // Bouw ronde 1 — Firestore accepteert geen null in arrays, gebruik lege string voor bye
    const ronde1 = [];
    for (let i = 0; i < namen.length; i += 2) {
      const a = namen[i] || '';
      const b = namen[i + 1] || '';
      const partij = { a, b, winnaar: '' };
      // Automatisch bye verwerken
      if (!b) partij.winnaar = a;
      if (!a) partij.winnaar = b;
      ronde1.push(partij);
    }

    // Als er al rondes zijn, vervang alleen ronde 1
    const rondes = objNaarRondes(data.rondes);
    rondes[0] = ronde1;

    // Verwerk byes en genereer volgende rondes indien nodig
    const bijgewerkt = verwerkKnockoutVoortgang(rondes, namen.length);

    await setDoc(doc(db, 'ladders', _koLadderId), { ...data, rondes: rondesNaarObj(bijgewerkt) });
    closeModal('modal-knockout-indeling');
    renderLadder();
    toast('Indeling opgeslagen ✓');
  } catch(e) { console.error('bevestigKnockoutIndeling mislukt:', e); toast('Er is iets misgegaan'); }
}

function verwerkKnockoutVoortgang(rondes, aantalSpelers) {
  const bracketGrootte = Math.pow(2, Math.ceil(Math.log2(aantalSpelers)));
  const totaalRondes = Math.log2(bracketGrootte);

  for (let ri = 0; ri < rondes.length; ri++) {
    const ronde = rondes[ri];
    const volgendeRi = ri + 1;

    // Alle winnaars — lege string = nog niet gespeeld, echte naam = winnaar
    const alleWinnaars = ronde.map(p => p.winnaar);
    const nogTeSpelen = alleWinnaars.filter(w => !w).length;
    if (nogTeSpelen > 0) break; // Nog niet alle partijen gespeeld

    if (volgendeRi >= totaalRondes) break; // Finale klaar

    const winnaars = alleWinnaars; // alle winnaars inclusief byes

    // Maak volgende ronde als die nog niet bestaat
    if (!rondes[volgendeRi]) {
      const volgendeRonde = [];
      for (let i = 0; i < winnaars.length; i += 2) {
        const partij = { a: winnaars[i] || '', b: winnaars[i+1] || '', winnaar: '' };
        if (!partij.b) partij.winnaar = partij.a;
        if (!partij.a) partij.winnaar = partij.b;
        volgendeRonde.push(partij);
      }
      rondes[volgendeRi] = volgendeRonde;
    }
  }

  return rondes;
}

async function verwerkKnockoutUitslag(partij) {
  try {
    const ladderId = partij.ladderId;
    if (!ladderId) return;
    const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
    if (!snapExists) return;
    const data = snapData;
    if ((data.type || '') !== 'knockout') return;

    // Bepaal winnaar — bij knockout altijd 2 spelers, 1 matchup
    const matchup = partij.matchups?.[0];
    if (!matchup) return;
    const winnaarKant = partij._modalWinnaars?.[0];
    if (!winnaarKant) return;
    const winnaar = winnaarKant === 'A' ? matchup.spelerA.naam : matchup.spelerB.naam;

    // Zoek de partij in de huidige ronde van de bracket
    const rondes = objNaarRondes(data.rondes);
    const rondeIdx = rondes.length - 1;
    const ronde = rondes[rondeIdx] || [];
    const partijIdx = ronde.findIndex(p =>
      (p.a === matchup.spelerA.naam && p.b === matchup.spelerB.naam) ||
      (p.a === matchup.spelerB.naam && p.b === matchup.spelerA.naam)
    );
    if (partijIdx === -1) return;

    // Bepaal matchplay resultaat direct uit partij scores
    let resultaat = '';
    try {
      const holes = partij.holes || [];
      const scoresA = partij.scores[matchup.spelerA.id] || [];
      const scoresB = partij.scores[matchup.spelerB.id] || [];
      let standA = 0, gespeeld = 0;
      let beslissingsStand = null, beslissingsGespeeld = null;
      for (let i = 0; i < holes.length; i++) {
        const sA = scoresA[i]; const sB = scoresB[i];
        if (sA == null || sB == null) continue;
        gespeeld++;
        const slagA = matchup.hcpOntvanger === matchup.spelerA.id
          ? ((holes[i].si <= Math.min(matchup.hcpSlagen, holes.length) ? 1 : 0) + (holes[i].si <= Math.max(0, matchup.hcpSlagen - holes.length) ? 1 : 0)) : 0;
        const slagB = matchup.hcpOntvanger === matchup.spelerB.id
          ? ((holes[i].si <= Math.min(matchup.hcpSlagen, holes.length) ? 1 : 0) + (holes[i].si <= Math.max(0, matchup.hcpSlagen - holes.length) ? 1 : 0)) : 0;
        const nettoA = sA - slagA; const nettoB = sB - slagB;
        if (nettoA < nettoB) standA++;
        else if (nettoB < nettoA) standA--;
        const resterendNa = holes.length - gespeeld;
        if (beslissingsStand === null && Math.abs(standA) > resterendNa) {
          beslissingsStand = standA; beslissingsGespeeld = gespeeld;
        }
      }
      const resterend = holes.length - gespeeld;
      const klaar = gespeeld === holes.length;
      const beslist = beslissingsStand !== null;
      const effectieveStand = beslist ? beslissingsStand : standA;
      const resterendEff = beslist ? (holes.length - beslissingsGespeeld) : resterend;
      if (beslist) resultaat = `${Math.abs(effectieveStand)}&${resterendEff}`;
      else if (klaar) resultaat = effectieveStand === 0 ? 'gelijkspel' : `${Math.abs(effectieveStand)}&0`;
    } catch(e) { console.error('Resultaat berekening mislukt:', e); }

    await slaKnockoutWinnaarOp(ladderId, rondeIdx, partijIdx, winnaar, resultaat);
    toast(`${winnaar.split(' ')[0]} door naar volgende ronde ✓`);
  } catch(e) { console.error('verwerkKnockoutUitslag mislukt:', e); }
}


async function slaKnockoutWinnaarOp(ladderId, rondeIdx, partijIdx, winnaar, resultaat) {
  try {
    const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
    if (!snapExists) return;
    const data = snapData;
    const rondes = objNaarRondes(data.rondes);
    if (!rondes[rondeIdx] || !rondes[rondeIdx][partijIdx]) return;

    rondes[rondeIdx][partijIdx].winnaar = winnaar || '';
    if (resultaat !== undefined) rondes[rondeIdx][partijIdx].resultaat = resultaat || '';

    // Verwerk voortgang
    const bijgewerkt = verwerkKnockoutVoortgang(rondes, (data.spelers || []).length);
    await setDoc(doc(db, 'ladders', ladderId), { ...data, rondes: rondesNaarObj(bijgewerkt) });

    // Update cache
    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) alleLadders[idx].data = { ...data, rondes: bijgewerkt };
    if (ladderId === activeLadderId) state.rondes = bijgewerkt;

    renderLadder();
    toast(`${winnaar} door naar volgende ronde ✓`);
  } catch(e) { console.error('slaKnockoutWinnaarOp mislukt:', e); toast('Er is iets misgegaan'); }
}

async function nieuwKnockoutSeizoen(ladderId) {
  if (!confirm('Nieuw seizoen starten? De huidige bracket wordt gewist.')) return;
  try {
    const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
    if (!snapExists) return;
    const data = snapData;
    await setDoc(doc(db, 'ladders', ladderId), { ...data, rondes: rondesNaarObj([]) });
    const idx = alleLadders.findIndex(l => l.id === ladderId);
    if (idx >= 0) alleLadders[idx].data = { ...data, rondes: [] };
    await openKnockoutIndeling(ladderId);
    renderLadder();
    toast('Nieuw seizoen gestart — stel ronde 1 in ✓');
  } catch(e) { console.error('nieuwKnockoutSeizoen mislukt:', e); toast('Er is iets misgegaan'); }
}

function toggleAdminKaart(header) {
  header.classList.toggle('ingeklapt');
  const collapse = header.nextElementSibling;
  if (collapse) collapse.classList.toggle('ingeklapt');
}


export { rondesNaarObj, objNaarRondes, renderKnockoutLadderKaart, renderKnockoutBracket, openKnockoutIndeling, renderKnockoutIndelingModal, koDragStart, koDragOver, koDrop, koDragEnd, koTouchStart, koTouchMove, koTouchEnd, verschuifKoSpeler, bevestigKnockoutIndeling, verwerkKnockoutVoortgang, verwerkKnockoutUitslag, slaKnockoutWinnaarOp, nieuwKnockoutSeizoen, toggleAdminKaart };
