// ============================================================
//  toernooi.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, state, alleLadders, activeLadderId, alleSpelersData, huidigeBruiker, archiefData, toernooiData, alleToernooien, actieveToernooiId, _vasteListeners, _toernooiListeners, _tGeselecteerdeSpelers, _tSpelersLadderIds, _tRankingLadderIds, _flights, aangepasteBanen } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { renderHcpBlok } from './partij.js';
import { renderLadder } from './ladder.js';
import { slaSnapshotOp } from './beheer.js';
import { toggleAdminKaart } from './knockout.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

//  TOERNOOI
// ============================================================
function renderToernooi() {
  const isBeheerder = isCoordinatorRol();
  const gebruikersnaam = (huidigeBruiker?.gebruikersnaam || '').toLowerCase();
  const voornaam = gebruikersnaam.split(' ')[0];
  // Zoek ook op basis van speler ID in master lijst
  const mijnSpelerIds = new Set(
    alleSpelersData.filter(s => s.naam.toLowerCase() === gebruikersnaam ||
      s.naam.toLowerCase().startsWith(voornaam)).map(s => String(s.id))
  );

  const mijnToernooien = isBeheerder
    ? alleToernooien
    : alleToernooien.filter(t =>
        (t.spelers || []).some(s =>
          s.naam.toLowerCase().includes(voornaam) ||
          mijnSpelerIds.has(String(s.id))
        )
      );

  const wrap = document.getElementById('toernooi-actief-wrap');
  const setup = document.getElementById('toernooi-setup-wrap');

  // Beheerder ziet altijd de setup om nieuwe toernooien aan te maken
  if (isBeheerder) {
    setup.style.display = 'block';
    initToernooiSetup();
  } else {
    setup.style.display = 'none';
  }

  if (mijnToernooien.length > 0) {
    wrap.style.display = 'block';

    // Beheerder ziet tabs bij meerdere toernooien, speler ziet alleen zijn eigen toernooi
    let html = '';
    if (isBeheerder && mijnToernooien.length > 1) {
      html += `<div style="display:flex;gap:8px;overflow-x:auto;padding:12px 16px;border-bottom:1px solid var(--border);scrollbar-width:none">`;
      mijnToernooien.forEach(t => {
        const actief = t.id === actieveToernooiId;
        html += `<button onclick="selecteerToernooi('${t.id}')" style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1.5px solid ${actief ? 'var(--green)' : 'var(--border)'};background:${actief ? 'var(--green)' : 'white'};color:${actief ? 'white' : 'var(--dark)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">${t.naam}</button>`;
      });
      html += '</div>';
    }
    wrap.innerHTML = html + '<div id="toernooi-detail"></div>';

    if (!actieveToernooiId || !mijnToernooien.find(t => t.id === actieveToernooiId)) {
      store.actieveToernooiId = mijnToernooien[0].id;
      store.toernooiData = mijnToernooien[0];
    }
    renderToernooiActief();
  } else {
    wrap.style.display = 'none';
    if (!isBeheerder) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'card';
      emptyDiv.innerHTML = '<div class="empty"><div class="empty-icon">🏅</div><p>Geen actief toernooi.</p></div>';
      setup.innerHTML = '';
      setup.appendChild(emptyDiv);
      setup.style.display = 'block';
    }
  }
}

async function herlaadToernooien() {
  try {
    const snap = await getDocs(query(TOERNOOIEN_COL, where('status', '==', 'actief')));
    store.alleToernooien = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (actieveToernooiId) {
      const gevonden = alleToernooien.find(t => t.id === actieveToernooiId);
      store.toernooiData = gevonden || (alleToernooien.length > 0 ? alleToernooien[0] : null);
    }
    if (!toernooiData && alleToernooien.length > 0) {
      store.toernooiData = alleToernooien[0];
      store.actieveToernooiId = alleToernooien[0].id;
    }
    if (toernooiData) actieveToernooiId = toernooiData.id;

    // Start realtime listeners voor alle actieve toernooien
    _toernooiListeners.forEach(unsub => unsub());
    store._toernooiListeners = [];
    alleToernooien.forEach(t => {
      const unsub = onSnapshot(doc(db, 'toernooien', t.id), (snap) => {
        if (!snap.exists()) return;
        const nieuweData = { id: snap.id, ...snap.data() };
        const idx = alleToernooien.findIndex(x => x.id === snap.id);
        if (idx >= 0) alleToernooien[idx] = nieuweData;
        if (actieveToernooiId === snap.id) {
          const isBeheerder = isCoordinatorRol();
          const detail = document.getElementById('toernooi-detail');
          if (detail) {
            if (isBeheerder) {
              // Voor beheerder: update data maar toon refresh knop
              const oudScores = JSON.stringify(toernooiData?.scores || {});
              const nieuwScores = JSON.stringify(nieuweData.scores || {});
              store.toernooiData = nieuweData;
              if (oudScores !== nieuwScores) {
                const btn = document.getElementById('t-refresh-btn');
                if (btn) btn.style.display = '';
                renderTMatrix();
              }
              if (nieuweData.uitslagZichtbaar) renderTRanglijst();
            } else {
              // Voor spelers: update data maar render scorekaart niet opnieuw (toetsenbord blijft open)
              const oudeMatrixIngeklapt = toernooiData?.matrixIngeklapt;
              const oudeUitslagZichtbaar = toernooiData?.uitslagZichtbaar;
              store.toernooiData = nieuweData;

              // Matrix inklapstatus direct volgen (verstoort toetsenbord niet)
              if (nieuweData.matrixIngeklapt !== oudeMatrixIngeklapt) {
                const collapse = document.getElementById('t-matrix-collapse');
                const header = collapse?.previousElementSibling;
                if (collapse) collapse.classList.toggle('ingeklapt', !!nieuweData.matrixIngeklapt);
                if (header) header.classList.toggle('ingeklapt', !!nieuweData.matrixIngeklapt);
              }

              // Scores updaten zonder scorekaart te herrenderen
              clearTimeout(window._matrixUpdateTimer);
              window._matrixUpdateTimer = setTimeout(() => renderTMatrix(), 2000);

              // Uitslag zichtbaar geworden
              if (nieuweData.uitslagZichtbaar && !oudeUitslagZichtbaar) {
                renderTScorecard();
                renderTMatrix();
                renderTRanglijst();
              } else if (nieuweData.uitslagZichtbaar) {
                renderTRanglijst();
              }
            }
          }
        }
      });
      _toernooiListeners.push(unsub);
    });
  } catch(e) { console.error('Toernooien laden mislukt:', e); }
}

function selecteerToernooi(id) {
  store.actieveToernooiId = id;
  store.toernooiData = alleToernooien.find(t => t.id === id) || null;
  renderToernooi();
}

function initToernooiSetup() {
  // Baan select
  const baanSel = document.getElementById('t-baan');
  if (baanSel) {
    baanSel.innerHTML = Object.keys(BANEN_DB).filter(n => n !== 'Handmatig invoeren').map(n =>
      `<option value="${n}">${n}</option>`
    ).join('');
    aangepasteBanen.forEach(b => {
      baanSel.innerHTML += `<option value="${b.naam}">⭐ ${b.naam}</option>`;
    });
  }

  // Datum vandaag als default
  if (!document.getElementById('t-datum')?.value) {
    document.getElementById('t-datum').value = new Date().toISOString().split('T')[0];
  }

  // Ladder checkboxes — spelers ladders
  const spelersLaddersEl = document.getElementById('t-spelers-ladders');
  if (spelersLaddersEl) {
    spelersLaddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;min-width:56px;text-align:center">
        <span>${l.naam}</span>
        <input type="checkbox" value="${l.id}" ${_tSpelersLadderIds.has(l.id) ? 'checked' : ''} onchange="toggleTSpelersLadder('${l.id}', this.checked)" style="accent-color:var(--green);width:18px;height:18px">
      </label>
    `).join('');
  }

  // Ladder checkboxes — ranking ladders
  const rankingLaddersEl = document.getElementById('t-ranking-ladders');
  if (rankingLaddersEl) {
    rankingLaddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;min-width:56px;text-align:center">
        <span>${l.naam}</span>
        <input type="checkbox" value="${l.id}" ${_tRankingLadderIds.has(l.id) ? 'checked' : ''} onchange="toggleTRankingLadder('${l.id}', this.checked)" style="accent-color:var(--green);width:18px;height:18px">
      </label>
    `).join('');
  }

  renderTGeselecteerdeSpelers();
}

function toggleTSpelersLadder(ladderId, checked) {
  if (checked) _tSpelersLadderIds.add(ladderId);
  else _tSpelersLadderIds.delete(ladderId);
  // Verwijder geselecteerde spelers die niet meer in een geselecteerde ladder zitten
  if (_tSpelersLadderIds.size > 0) {
    const geldigeIds = new Set(
      alleLadders.filter(l => _tSpelersLadderIds.has(l.id))
        .flatMap(l => (l.spelers || []).map(s => String(s.id)))
    );
    store._tGeselecteerdeSpelers = _tGeselecteerdeSpelers.filter(s => s.gast || geldigeIds.has(String(s.id)));
  }
  renderTGeselecteerdeSpelers();
}

function toggleTRankingLadder(ladderId, checked) {
  if (checked) _tRankingLadderIds.add(ladderId);
  else _tRankingLadderIds.delete(ladderId);
}

function getToernooiSpelersPool() {
  // Spelers uit geselecteerde ladders, geen duplicaten
  const gezien = new Set();
  const spelers = [];
  const ladders = _tSpelersLadderIds.size > 0
    ? alleLadders.filter(l => _tSpelersLadderIds.has(l.id))
    : alleLadders;
  ladders.forEach(l => {
    (l.spelers || []).forEach(s => {
      if (!gezien.has(s.id)) {
        gezien.add(s.id);
        spelers.push(s);
      }
    });
  });
  return spelers.sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));
}

function zoekToernooiSpeler(zoek) {
  const lijst = document.getElementById('t-speler-zoek-lijst');
  if (!lijst) return;
  const term = zoek.toLowerCase().trim();
  const geselecteerdeIds = new Set(_tGeselecteerdeSpelers.map(s => String(s.id)));
  const pool = getToernooiSpelersPool().filter(s => !geselecteerdeIds.has(String(s.id)));
  const gefilterd = term ? pool.filter(s => s.naam.toLowerCase().includes(term)) : pool;

  if (gefilterd.length === 0) {
    lijst.innerHTML = `<div style="padding:10px 14px;font-size:13px;color:var(--light)">Geen spelers gevonden</div>`;
  } else {
    lijst.innerHTML = gefilterd.map(s => `
      <div onclick="selecteerToernooiSpeler(${s.id},'${s.naam.replace(/'/g,"\\'")}',${s.hcp})"
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between"
        onmouseenter="this.style.background='var(--green-pale)'" onmouseleave="this.style.background=''">
        <span>${s.naam}</span>
        <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>
    `).join('');
  }
  lijst.style.display = 'block';
}

function selecteerToernooiSpeler(id, naam, hcp) {
  if (!_tGeselecteerdeSpelers.find(s => s.id === id)) {
    _tGeselecteerdeSpelers.push({ id, naam, hcp, gast: false });
  }
  sluitToernooiSpelerLijst();
  const zoek = document.getElementById('t-speler-zoek');
  if (zoek) zoek.value = '';
  renderTGeselecteerdeSpelers();
}

function sluitToernooiSpelerLijst() {
  const lijst = document.getElementById('t-speler-zoek-lijst');
  if (lijst) lijst.style.display = 'none';
}

function verwijderToernooiSpelerSelectie(id) {
  store._tGeselecteerdeSpelers = _tGeselecteerdeSpelers.filter(s => s.id !== id);
  renderTGeselecteerdeSpelers();
}

function voegGastspelerToe() {
  const naam = prompt('Naam gastspeler:');
  if (!naam?.trim()) return;
  const hcpStr = prompt(`Handicap voor ${naam.trim()}:`, '10');
  if (hcpStr === null) return;
  const hcp = parseFloat(hcpStr) || 0;
  const gastId = 90000 + Math.floor(Math.random() * 9999); // hoog getal om conflict te vermijden
  _tGeselecteerdeSpelers.push({ id: gastId, naam: naam.trim(), hcp, gast: true });
  renderTGeselecteerdeSpelers();
}

function renderTGeselecteerdeSpelers() {
  const el = document.getElementById('t-geselecteerde-spelers');
  if (!el) return;
  if (_tGeselecteerdeSpelers.length === 0) {
    el.innerHTML = '<span style="font-size:13px;color:var(--light)">Nog geen deelnemers geselecteerd</span>';
    return;
  }
  el.innerHTML = _tGeselecteerdeSpelers.map(s => `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:var(--green-pale);color:var(--green);border:1.5px solid var(--green);border-radius:20px;font-size:13px">
      ${s.naam}${s.gast ? ' <em style="font-size:11px;opacity:0.7">(gast)</em>' : ''}
      <button onclick="verwijderToernooiSpelerSelectie('${s.id}')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:14px;padding:0;line-height:1">×</button>
    </span>
  `).join('');
}

function toggleTSpeler(id) {
  const tag = document.getElementById('ttag-' + id);
  if (!tag) return;
  tag.classList.toggle('selected');
  const isSelected = tag.classList.contains('selected');
  tag.style.outline = isSelected ? '3px solid var(--dark)' : 'none';
  tag.style.fontWeight = isSelected ? '700' : '500';
}
// ============================================================
//  FLIGHT INDELING
// ============================================================

function toggleHolesCustom() {
  const sel = document.getElementById('t-holes');
  const wrap = document.getElementById('t-holes-custom-wrap');
  if (wrap) wrap.style.display = sel.value === 'custom' ? 'block' : 'none';
}

function openFlightIndeling() {
  const geselecteerd = _tGeselecteerdeSpelers;
  if (geselecteerd.length < 2) { toast('Selecteer minimaal 2 spelers'); return; }

  const starttijd = document.getElementById('t-starttijd')?.value || '09:00';
  const interval = parseInt(document.getElementById('t-interval')?.value) || 0;

  if (_flights.length === 0) {
    store._flights = [{ id: 1, naam: 'Flight 1', spelers: geselecteerd.map(s => ({ id: s.id, naam: s.naam, hcp: s.hcp })), starthole: 1, starttijd }];
  } else {
    _flights.forEach((f, fi) => {
      if (!f.starttijd) f.starttijd = berekenFlightTijd(starttijd, interval, fi);
      if (!f.starthole) f.starthole = 1;
      f.spelers = f.spelers.filter(s => geselecteerd.some(g => g.id === s.id));
    });
    const ingedeeld = new Set(_flights.flatMap(f => f.spelers.map(s => s.id)));
    const nieuw = geselecteerd.filter(s => !ingedeeld.has(s.id)).map(s => ({ id: s.id, naam: s.naam, hcp: s.hcp }));
    if (nieuw.length > 0 && _flights.length > 0) _flights[0].spelers.push(...nieuw);
  }

  // Sla starttijd/interval op voor gebruik bij nieuwe flights
  window._toernooiStarttijd = starttijd;
  window._toernooiInterval = interval;

  renderFlightLijst();
  document.getElementById('modal-flight-indeling').classList.add('open');
}

function renderFlightLijst() {
  const container = document.getElementById('flight-lijst');
  if (!container) return;

  // Alle ingedeelde speler IDs
  const ingedeeld = new Set(_flights.flatMap(f => f.spelers.map(s => s.id)));

  container.innerHTML = _flights.map((f, fi) => `
    <div style="border:1.5px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="background:var(--green);padding:8px 12px;display:flex;align-items:center;gap:8px">
        <input type="text" value="${f.naam}" onchange="wijzigFlightNaam(${fi}, this.value)"
          style="background:transparent;border:none;color:white;font-family:'Bebas Neue';font-size:18px;flex:1;outline:none">
        ${_flights.length > 1 ? `<button onclick="verwijderFlight(${fi})" style="background:rgba(255,255,255,0.2);border:none;border-radius:4px;color:white;cursor:pointer;padding:2px 8px;font-size:13px">✕</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 12px;background:#f9f7f2;border-bottom:1px solid var(--border)">
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--mid);text-transform:uppercase;display:block;margin-bottom:3px">Starttijd</label>
          <input type="time" value="${f.starttijd || ''}" onchange="wijzigFlightStarttijd(${fi}, this.value)"
            style="font-family:'DM Mono',monospace;font-size:13px;border:1.5px solid var(--border);border-radius:5px;padding:3px 6px;width:100%">
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--mid);text-transform:uppercase;display:block;margin-bottom:3px">Starthole</label>
          <input type="number" value="${f.starthole || 1}" min="1" max="18" onchange="wijzigFlightStarthole(${fi}, this.value)"
            style="font-family:'DM Mono',monospace;font-size:13px;border:1.5px solid var(--border);border-radius:5px;padding:3px 6px;width:100%;text-align:center">
        </div>
      </div>
      <div style="padding:8px">
        ${f.spelers.map((s, si) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.naam}</span>
            <input type="number" value="${Math.round(s.hcp)}" min="-10" max="54"
              onchange="wijzigFlightHcp(${fi}, ${si}, this.value)"
              style="width:48px;padding:3px 6px;text-align:center;font-family:'DM Mono',monospace;border:1.5px solid var(--border);border-radius:5px;font-size:13px;flex-shrink:0">
            ${_flights.length > 1 ? `
            <select onchange="verplaatsSpelerFlight(${fi}, ${si}, this.value)" style="font-size:12px;border:1.5px solid var(--border);border-radius:5px;padding:3px 5px;background:white;flex-shrink:0;max-width:80px">
              ${_flights.map((lf, lfi) => `<option value="${lfi}" ${lfi === fi ? 'selected' : ''}>${lf.naam}</option>`).join('')}
            </select>` : ''}
          </div>
        `).join('')}
        ${f.spelers.length === 0 ? '<p style="font-size:12px;color:var(--light);padding:8px 0">Geen spelers — voeg toe via dropdown hierboven</p>' : ''}
      </div>
    </div>
  `).join('');
}

function berekenFlightTijd(basis, interval, fi) {
  if (!basis || !interval) return basis || '';
  const [h, m] = basis.split(':').map(Number);
  const totMin = h * 60 + m + fi * interval;
  return `${String(Math.floor(totMin / 60) % 24).padStart(2,'0')}:${String(totMin % 60).padStart(2,'0')}`;
}

function voegFlightToe() {
  const fi = _flights.length;
  const vorigeHole = _flights[fi - 1]?.starthole || 1;
  const basis = window._toernooiStarttijd || '09:00';
  const interval = window._toernooiInterval || 0;
  _flights.push({
    id: fi + 1,
    naam: `Flight ${fi + 1}`,
    spelers: [],
    starthole: vorigeHole,
    starttijd: berekenFlightTijd(basis, interval, fi)
  });
  renderFlightLijst();
}

function wijzigFlightStarttijd(fi, val) { if (_flights[fi]) _flights[fi].starttijd = val; }
function wijzigFlightStarthole(fi, val) { if (_flights[fi]) _flights[fi].starthole = parseInt(val) || 1; }

function verwijderFlight(fi) {
  if (_flights.length <= 1) return;
  // Verplaats spelers naar eerste flight
  const spelers = _flights[fi].spelers;
  _flights.splice(fi, 1);
  if (spelers.length > 0) _flights[0].spelers.push(...spelers);
  renderFlightLijst();
}

function wijzigFlightNaam(fi, naam) {
  if (_flights[fi]) _flights[fi].naam = naam;
}

function wijzigFlightHcp(fi, si, val) {
  if (_flights[fi]?.spelers[si]) _flights[fi].spelers[si].hcp = parseFloat(val) || 0;
}

function verplaatsSpelerFlight(vanFi, si, naarFi) {
  naarFi = parseInt(naarFi);
  if (vanFi === naarFi) return;
  const speler = _flights[vanFi].spelers.splice(si, 1)[0];
  _flights[naarFi].spelers.push(speler);
  renderFlightLijst();
}

async function startToernooi() {

  try {
  const naam = document.getElementById('t-naam').value.trim();
  const datum = document.getElementById('t-datum').value;
  const baanNaam = document.getElementById('t-baan').value;
  const holesVal = document.getElementById('t-holes').value;
  const holesCount = holesVal === 'custom'
    ? parseInt(document.getElementById('t-holes-custom').value) || 18
    : parseInt(holesVal);
  const ptWin = parseFloat(document.getElementById('t-pt-win').value);
  const ptTie = parseFloat(document.getElementById('t-pt-tie').value);
  const ptLoss = parseFloat(document.getElementById('t-pt-loss').value);
  const hcpPct = parseFloat(document.getElementById('t-hcp-pct').value) / 100;
  const ladderId = [..._tRankingLadderIds][0] || null; // eerste ranking ladder (legacy compat)
  const rankingLadderIds = [..._tRankingLadderIds];

  if (!naam) { toast('Voer een naam in'); return; }
  if (!datum) { toast('Voer een datum in'); return; }

  // Gebruik spelers uit flights
  const geselecteerd = _flights.flatMap(f => f.spelers);
  if (geselecteerd.length < 2) { toast('Voeg minimaal 2 spelers toe aan flights'); return; }
  if (_flights.every(f => f.spelers.length === 0)) { toast('Verdeel spelers over flights'); return; }

  // Holes ophalen — ingebouwd of aangepast
  let holes = [];
  if (BANEN_DB[baanNaam]?.holes) {
    holes = BANEN_DB[baanNaam].holes.slice(0, holesCount);
  } else {
    const aangepast = aangepasteBanen.find(b => b.naam === baanNaam);
    if (aangepast) holes = aangepast.holes.slice(0, holesCount);
  }
  if (!holes.length) { toast('Baan heeft geen holes geconfigureerd'); return; }

  // Init scores
  const scores = {};
  geselecteerd.forEach(s => { scores[s.id] = Array(holes.length).fill(null); });

  const nieuweToernooi = {
    status: 'actief',
    naam, datum, baan: baanNaam, holes,
    ptWin, ptTie, ptLoss, hcpPct,
    ladderId: ladderId || null,
    rankingLadderIds,
    starttijd: document.getElementById('t-starttijd')?.value || '',
    interval: parseInt(document.getElementById('t-interval')?.value) || 0,
    spelers: geselecteerd.map(s => ({ id: s.id, naam: s.naam, hcp: s.hcp, gast: s.gast || false })),
    flights: _flights.map(f => ({
      id: f.id, naam: f.naam,
      spelerIds: f.spelers.map(s => s.id),
      starthole: f.starthole || 1,
      starttijd: f.starttijd || ''
    })),
    scores,
    timestamp: Date.now()
  };

  const newRef = await addDoc(TOERNOOIEN_COL, nieuweToernooi);
  nieuweToernooi.id = newRef.id;
  alleToernooien.push(nieuweToernooi);
  store.toernooiData = nieuweToernooi;
  store.actieveToernooiId = newRef.id;

  // Start realtime listener voor nieuw toernooi
  const unsub = onSnapshot(doc(db, 'toernooien', newRef.id), (snap) => {
    if (!snap.exists()) return;
    const nieuweData = { id: snap.id, ...snap.data() };
    const idx = alleToernooien.findIndex(x => x.id === snap.id);
    if (idx >= 0) alleToernooien[idx] = nieuweData;
    if (actieveToernooiId === snap.id) {
      store.toernooiData = nieuweData;
      const detail = document.getElementById('toernooi-detail');
      if (detail) { renderTScorecard(); renderTMatrix(); if (nieuweData.uitslagZichtbaar) renderTRanglijst(); }
    }
  });
  _toernooiListeners.push(unsub);

  toast('Toernooi gestart! 🏅');
  closeModal('modal-flight-indeling');
  store._flights = [];
  store._tGeselecteerdeSpelers = [];
  store._tSpelersLadderIds = new Set();
  store._tRankingLadderIds = new Set();
  // Reset formulier
  document.getElementById('t-naam').value = '';
  document.getElementById('t-datum').value = '';
  // Reset ladder checkboxes
  document.querySelectorAll('#t-spelers-ladders input, #t-ranking-ladders input').forEach(cb => cb.checked = false);
  renderTGeselecteerdeSpelers();
  // Klap setup kaart in
  const setupHeader = document.querySelector('#toernooi-setup-wrap .card-header.inklapbaar');
  if (setupHeader && !setupHeader.classList.contains('ingeklapt')) {
    setupHeader.classList.add('ingeklapt');
    const collapse = setupHeader.nextElementSibling;
    if (collapse) collapse.classList.add('ingeklapt');
  }
  // Toon actief toernooi
  document.getElementById('toernooi-actief-wrap').style.display = 'block';
  renderToernooi();
  } catch(e) { console.error('startToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function toggleToernooiMatrix() {

  try {
  if (!toernooiData || !actieveToernooiId) return;
  toernooiData.matrixIngeklapt = !toernooiData.matrixIngeklapt;
  await setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
  renderToernooiActief();
  } catch(e) { console.error('toggleToernooiMatrix mislukt:', e); }
}

async function toonToernooiUitslag() {

  try {
  if (!toernooiData || !actieveToernooiId) return;
  toernooiData.uitslagZichtbaar = true;
  const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
  if (idx >= 0) alleToernooien[idx].uitslagZichtbaar = true;
  await setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
  renderToernooiActief();
  toast('Uitslag zichtbaar! 🏆');
  } catch(e) { console.error('toonToernooiUitslag mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function openToernooiSpelersBeheer() {
  const t = toernooiData;
  if (!t) return;

  // Vul verwijder lijst
  const verwijderLijst = document.getElementById('toernooi-speler-verwijder-lijst');
  verwijderLijst.innerHTML = t.spelers.map(s => `
    <div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:14px">${s.naam}${s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}</span>
      <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:5px 10px;border-radius:6px;font-size:12px"
        onclick="verwijderToernooiSpelerNieuw('${s.id}')">✕</button>
    </div>
  `).join('');

  // Vul flight selects
  const flightOpties = (t.flights || [{ naam: 'Flight 1' }]).map((f, i) =>
    `<option value="${i}">${f.naam}</option>`).join('');
  document.getElementById('toernooi-speler-flight-sel').innerHTML = flightOpties;
  document.getElementById('toernooi-gast-flight-sel').innerHTML = flightOpties;

  // Reset zoek
  document.getElementById('toernooi-speler-zoek').value = '';
  document.getElementById('toernooi-gast-naam').value = '';
  document.getElementById('toernooi-gast-hcp').value = '';
  _toernooiSpelerToevoegen = null;

  document.getElementById('modal-toernooi-spelers').classList.add('open');
}

function zoekToernooiSpelerModal(zoek) {
  const lijst = document.getElementById('toernooi-speler-zoek-lijst');
  if (!lijst) return;
  const t = toernooiData;
  const huidigeIds = new Set(t.spelers.map(s => String(s.id)));
  const term = zoek.toLowerCase().trim();
  const pool = alleSpelersData.filter(s => !huidigeIds.has(String(s.id)))
    .filter(s => !term || s.naam.toLowerCase().includes(term))
    .sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));

  lijst.innerHTML = pool.length === 0
    ? '<div style="padding:10px 14px;font-size:13px;color:var(--light)">Geen spelers gevonden</div>'
    : pool.map(s => `
      <div onclick="selecteerToernooiSpelerModal(${s.id},'${s.naam.replace(/'/g,"\\'")}',${s.hcp})"
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between"
        onmouseenter="this.style.background='var(--green-pale)'" onmouseleave="this.style.background=''">
        <span>${s.naam}</span>
        <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>`).join('');
  lijst.style.display = 'block';
}

function selecteerToernooiSpelerModal(id, naam, hcp) {
  _toernooiSpelerToevoegen = { id, naam, hcp };
  document.getElementById('toernooi-speler-zoek').value = naam;
  sluitToernooiSpelerModal();
}

function sluitToernooiSpelerModal() {
  const l = document.getElementById('toernooi-speler-zoek-lijst');
  if (l) l.style.display = 'none';
}

async function voegBestaandeSpelerToeAanToernooi() {

  try {
  if (!_toernooiSpelerToevoegen) { toast('Selecteer eerst een speler'); return; }
  const t = toernooiData;
  const fi = parseInt(document.getElementById('toernooi-speler-flight-sel').value) || 0;
  const speler = { id: _toernooiSpelerToevoegen.id, naam: _toernooiSpelerToevoegen.naam, hcp: _toernooiSpelerToevoegen.hcp, gast: false };

  t.spelers.push(speler);
  t.scores[String(speler.id)] = Array(t.holes.length).fill(null);
  if (t.flights?.[fi]) {
    t.flights[fi].spelerIds = [...(t.flights[fi].spelerIds || []), speler.id];
  }
  await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
  closeModal('modal-toernooi-spelers');
  renderToernooiActief();
  toast(`${speler.naam.split(' ')[0]} toegevoegd ✓`);
  } catch(e) { console.error('voegBestaandeSpelerToeAanToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function voegGastspelerToeAanToernooi() {

  try {
  const naam = document.getElementById('toernooi-gast-naam').value.trim();
  const hcp = parseFloat(document.getElementById('toernooi-gast-hcp').value) || 0;
  if (!naam) { toast('Voer een naam in'); return; }
  const t = toernooiData;
  const fi = parseInt(document.getElementById('toernooi-gast-flight-sel').value) || 0;
  const gastId = 90000 + Math.floor(Math.random() * 9999);
  const speler = { id: gastId, naam, hcp, gast: true };

  t.spelers.push(speler);
  t.scores[String(gastId)] = Array(t.holes.length).fill(null);
  if (t.flights?.[fi]) {
    t.flights[fi].spelerIds = [...(t.flights[fi].spelerIds || []), gastId];
  }
  await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
  closeModal('modal-toernooi-spelers');
  renderToernooiActief();
  toast(`${naam} toegevoegd als gastspeler ✓`);
  } catch(e) { console.error('voegGastspelerToeAanToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function verwijderToernooiSpelerNieuw(spelerId) {

  try {
  if (!toernooiData || !actieveToernooiId) return;
  if (!confirm('Speler verwijderen uit dit toernooi?')) return;
  const id = String(spelerId);
  toernooiData.spelers = toernooiData.spelers.filter(s => String(s.id) !== id);
  delete toernooiData.scores[spelerId];
  delete toernooiData.scores[id];
  if (toernooiData.flights) {
    toernooiData.flights.forEach(f => {
      f.spelerIds = (f.spelerIds || []).filter(sid => String(sid) !== id);
    });
  }
  await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
  closeModal('modal-toernooi-spelers');
  renderToernooiActief();
  toast('Speler verwijderd ✓');
  } catch(e) { console.error('verwijderToernooiSpelerNieuw mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function openVerwijderToernooiSpeler() {
  openToernooiSpelersBeheer();
}

async function verwijderToernooiSpeler(spelerId) {

  try {
  if (!toernooiData || !actieveToernooiId) return;
  if (!confirm('Speler verwijderen uit dit toernooi?')) return;
  toernooiData.spelers = toernooiData.spelers.filter(s => String(s.id) !== String(spelerId));
  delete toernooiData.scores[spelerId];
  delete toernooiData.scores[String(spelerId)];
  const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
  if (idx >= 0) alleToernooien[idx] = { ...toernooiData };
  await setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
  closeModal('modal-archief-detail');
  renderToernooiActief();
  toast('Speler verwijderd uit toernooi');
  } catch(e) { console.error('verwijderToernooiSpeler mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function alleScoresIngevuld(t) {
  if (!t || !t.spelers || t.spelers.length === 0) return false;
  return t.spelers.every(s =>
    t.holes.every((_, i) => {
      const val = t.scores[String(s.id)]?.[i] ?? t.scores[s.id]?.[i];
      return val !== null && val !== undefined && val !== '';
    })
  );
}

function renderToernooiActief() {
  const t = toernooiData;
  if (!t) return;

  const isBeheerder = isCoordinatorRol();
  const uitslag = t.uitslagZichtbaar === true;
  const allesIngevuld = alleScoresIngevuld(t);
  const detail = document.getElementById('toernooi-detail');
  if (!detail) return;

  const flights = t.flights || [];
  const gebruikersnaam = huidigeBruiker?.gebruikersnaam?.toLowerCase() || '';
  const voornaam = gebruikersnaam.split(' ')[0];
  const mijnSpelerIdsInToernooi = new Set(
    alleSpelersData.filter(s => s.naam.toLowerCase() === gebruikersnaam ||
      s.naam.toLowerCase().startsWith(voornaam)).map(s => String(s.id))
  );
  const mijnFlight = flights.find(f =>
    (f.spelerIds || []).some(sid => {
      const sp = t.spelers.find(s => String(s.id) === String(sid));
      return sp && (sp.naam.toLowerCase().includes(voornaam) || mijnSpelerIdsInToernooi.has(String(sp.id)));
    })
  );

  detail.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>${t.naam}</h2>
        <span class="badge badge-gold">${uitslag ? 'Uitslag' : 'Bezig'}</span>
      </div>
      <div class="card-body" style="padding:10px 16px;font-size:13px;color:var(--mid)">
        ${t.datum} · ${t.baan} · ${t.holes.length} holes · ${t.spelers.length} spelers
        ${flights.length > 1 ? ` · ${flights.length} flights` : ''}
        ${!isBeheerder && mijnFlight ? ` · <strong style="color:var(--green)">${mijnFlight.naam}</strong>` : ''}
      </div>
    </div>

    ${uitslag ? `
    <div class="card">
      <div class="card-header"><h2>Ranglijst</h2></div>
      <div id="t-ranglijst"></div>
    </div>
    ` : ''}

    <div class="card">
      <div class="card-header ${isBeheerder ? 'inklapbaar' : ''} ${t.matrixIngeklapt && !uitslag ? 'ingeklapt' : ''}"
        ${isBeheerder ? `onclick="toggleToernooiMatrix()"` : ''}>
        <h2>Onderlinge stand</h2>
      </div>
      <div class="card-collapse ${t.matrixIngeklapt && !uitslag ? 'ingeklapt' : ''}" id="t-matrix-collapse">
        <div id="t-matrix" style="overflow-x:auto;padding:8px"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header inklapbaar ${uitslag ? 'ingeklapt' : ''}" onclick="toggleAdminKaart(this)">
        <h2>${isBeheerder ? 'Scores' : 'Mijn scorekaart'}</h2>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          ${isBeheerder ? `
            <button id="t-refresh-btn" class="btn btn-sm btn-ghost" onclick="refreshToernooiScorekaart()" style="display:none;background:var(--gold);color:white;border-color:var(--gold)">↺ Nieuw</button>
            <button class="btn btn-sm btn-ghost" onclick="openToernooiSpelersBeheer()">👥 Spelers</button>
          ` : ''}
        </div>
      </div>
      <div class="card-collapse ${uitslag ? 'ingeklapt' : ''}">
        <div id="t-scorecard-wrap" style="overflow-x:auto"></div>
      </div>
    </div>

    ${isBeheerder ? `
    <div style="padding:0 0 16px">
      ${!uitslag ? `
      <button id="t-uitslag-btn" class="btn btn-primary btn-block"
        style="margin-bottom:8px;${!allesIngevuld ? 'opacity:0.5;cursor:not-allowed' : ''}"
        ${!allesIngevuld ? 'disabled' : ''}>
        📊 Naar de uitslag ${!allesIngevuld ? '(scores onvolledig)' : ''}
      </button>
      ` : `
      <button class="btn btn-gold btn-block" onclick="openToernooiAfsluiten()" style="margin-bottom:8px">
        ✓ Toernooi afsluiten${(toernooiData?.rankingLadderIds?.length > 0 || toernooiData?.ladderId) ? ' & ladder bijwerken' : ''}
      </button>
      `}
      <button class="btn btn-ghost btn-block" onclick="annuleerToernooi()" style="margin-bottom:8px;color:var(--red)">
        Toernooi annuleren
      </button>
    </div>
    ` : ''}
  `;

  renderTScorecard();
  if (uitslag) renderTRanglijst();
  renderTMatrix();

  // Koppel uitslag knop
  const uitslagBtn = document.getElementById('t-uitslag-btn');
  if (uitslagBtn) uitslagBtn.onclick = toonToernooiUitslag;
}

function renderTScorecard() {
  const t = toernooiData;
  const isBeheerder = isCoordinatorRol();
  const flights = t.flights || [];
  const gebruikersnaam = huidigeBruiker?.gebruikersnaam?.toLowerCase() || '';

  // Bepaal welke flights te tonen
  let teTonenFlights = [];
  const voornaam = gebruikersnaam.split(' ')[0];
  const mijnIds = new Set(
    alleSpelersData.filter(s => s.naam.toLowerCase() === gebruikersnaam ||
      s.naam.toLowerCase().startsWith(voornaam)).map(s => String(s.id))
  );

  if (isBeheerder || flights.length === 0) {
    teTonenFlights = flights.length > 0
      ? flights.map(f => ({ naam: f.naam, spelers: (f.spelerIds || []).map(sid => t.spelers.find(s => String(s.id) === String(sid))).filter(Boolean) }))
      : [{ naam: null, spelers: t.spelers }];
  } else {
    const mijnFlight = flights.find(f =>
      (f.spelerIds || []).some(sid => {
        const sp = t.spelers.find(s => String(s.id) === String(sid));
        return sp && (sp.naam.toLowerCase().includes(voornaam) || mijnIds.has(String(sp.id)));
      })
    );
    if (mijnFlight) {
      teTonenFlights = [{ naam: mijnFlight.naam, spelers: (mijnFlight.spelerIds || []).map(sid => t.spelers.find(s => String(s.id) === String(sid))).filter(Boolean) }];
    } else {
      teTonenFlights = [{ naam: null, spelers: t.spelers }];
    }
  }

  const scorecardWrap = document.getElementById('t-scorecard-wrap');
  if (!scorecardWrap) return;

  // Bewaar actieve tab (of gebruik 0 als default)
  const activeFi = scorecardWrap._activeFlight != null
    ? Math.min(scorecardWrap._activeFlight, teTonenFlights.length - 1)
    : 0;

  let html = '';

  // Tabs bovenaan als beheerder meerdere flights heeft
  if (isBeheerder && teTonenFlights.length > 1) {
    html += `<div style="display:flex;gap:0;border-bottom:2px solid var(--border);overflow-x:auto;scrollbar-width:none;padding:0 4px">`;
    teTonenFlights.forEach(({ naam }, ti) => {
      const actief = ti === activeFi;
      html += `<button onclick="selecteerFlightTab(${ti})"
        style="flex-shrink:0;padding:8px 14px;border:none;background:transparent;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:${actief?'700':'500'};color:${actief?'var(--green)':'var(--mid)'};border-bottom:2px solid ${actief?'var(--green)':'transparent'};margin-bottom:-2px;cursor:pointer">
        ${naam || 'Scores'}
      </button>`;
    });
    html += '</div>';
  }

  // Render alleen de actieve flight
  const { naam, spelers } = teTonenFlights[activeFi];
  const tabOffset = isBeheerder
    ? activeFi * spelers.length * t.holes.length
    : activeFi * t.holes.length * spelers.length;

  const flightData = (t.flights || []).find(f => f.naam === naam);
  const starthole = (flightData?.starthole || 1) - 1;
  const holesInVolgorde = t.holes.map((_, i) => (starthole + i) % t.holes.length);

  if (naam) {
    const info = [
      flightData?.starttijd ? `🕐 ${flightData.starttijd}` : null,
      flightData?.starthole ? `Hole ${flightData.starthole}` : null
    ].filter(Boolean).join(' · ');
    html += `<div style="display:flex;align-items:baseline;gap:12px;padding:8px 12px 6px">
      <span style="font-family:'Bebas Neue';font-size:16px;color:var(--green)">${naam}</span>
      ${info ? `<span style="font-size:13px;color:var(--mid)">${info}</span>` : ''}
    </div>`;
  }

  html += `<div style="overflow-x:auto"><table class="scorecard" style="width:100%"><thead><tr><th class="player-col">Hole</th>`;
  spelers.forEach(s => {
    const delen = s.naam.split(' ');
    html += `<th class="player-col" style="max-width:70px">
      <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px" title="${s.naam}">${delen[0]}</span>
      <span class="hole-par" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px;${isBeheerder?'cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)':''}" ${isBeheerder?`onclick="editToernooiHcp('${s.id}')"`:''}>${delen.slice(1).join(' ') || 'hcp '+Math.round(s.hcp)}</span>
    </th>`;
  });
  html += '</tr></thead><tbody>';
  holesInVolgorde.forEach((holeIdx, spelRij) => {
    const h = t.holes[holeIdx];
    html += `<tr><td class="player-col" style="font-weight:600">${holeIdx+1}<span class="hole-par">p${h.par} SI${h.si}</span></td>`;
    spelers.forEach((s, si) => {
      const val = t.scores[s.id]?.[holeIdx] ?? t.scores[String(s.id)]?.[holeIdx];
      const tabIdx = isBeheerder
        ? tabOffset + si * t.holes.length + spelRij + 1
        : tabOffset + spelRij * spelers.length + si + 1;
      html += `<td><input type="number" min="1" max="12" inputmode="numeric" value="${val !== null && val !== undefined ? val : ''}"
        tabindex="${tabIdx}" onfocus="this.select()"
        oninput="updateTScoreAndAdvance(${s.id},${holeIdx},${tabIdx},this.value)"
        style="width:42px;padding:4px;text-align:center;font-size:14px;font-family:'DM Mono',monospace;border:1.5px solid var(--border);border-radius:5px;background:var(--input-bg);color:var(--dark)"></td>`;
    });
    html += '</tr>';
  });
  html += '<tr class="t-totaal-rij" style="background:var(--green-pale)"><td class="player-col" style="font-weight:700">Tot</td>';
  spelers.forEach(s => {
    const scores = t.scores[s.id] || t.scores[String(s.id)] || [];
    const filled = scores.filter(v => v !== null && v !== undefined);
    const tot = filled.length ? filled.reduce((a,b) => a+Number(b), 0) : null;
    html += `<td data-speler-id="${s.id}" style="font-family:'DM Mono',monospace;font-weight:700;text-align:center">${tot !== null ? tot : '—'}</td>`;
  });
  html += '</tr></tbody></table></div>';

  scorecardWrap.innerHTML = html;
  scorecardWrap._activeFlight = activeFi;
}

function refreshToernooiScorekaart() {
  const btn = document.getElementById('t-refresh-btn');
  if (btn) btn.style.display = 'none';
  renderTScorecard();
  renderTMatrix();
  if (toernooiData?.uitslagZichtbaar) renderTRanglijst();
  // Check uitslag knop na refresh
  const alles = alleScoresIngevuld(toernooiData);
  const uitslagBtn = document.getElementById('t-uitslag-btn');
  if (uitslagBtn) {
    uitslagBtn.disabled = !alles;
    uitslagBtn.style.opacity = alles ? '1' : '0.5';
    uitslagBtn.style.cursor = alles ? 'pointer' : 'not-allowed';
    uitslagBtn.textContent = `📊 Naar de uitslag${alles ? '' : ' (scores onvolledig)'}`;
    uitslagBtn.onclick = alles ? toonToernooiUitslag : null;
  }
}

function selecteerFlightTab(fi) {
  const wrap = document.getElementById('t-scorecard-wrap');
  if (wrap) { wrap._activeFlight = fi; renderTScorecard(); }
}

function updateTScoreAndAdvance(spelerId, holeIdx, tabIdx, val) {
  updateTScore(spelerId, holeIdx, val);
  // Auto-advance alleen voor beheerder
  if (val.length > 0 && isCoordinatorRol()) {
    setTimeout(() => {
      const next = document.querySelector(`input[tabindex="${tabIdx + 1}"]`);
      if (next) { next.focus(); next.select(); }
    }, 50);
  }
}

function updateTScore(spelerId, holeIdx, val) {
  if (!toernooiData || !actieveToernooiId) return;
  const key = String(spelerId);
  if (!toernooiData.scores[key]) toernooiData.scores[key] = Array(toernooiData.holes.length).fill(null);
  toernooiData.scores[key][holeIdx] = val === '' ? null : parseInt(val);
  // Update cache
  const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
  if (idx >= 0) alleToernooien[idx] = JSON.parse(JSON.stringify(toernooiData));
  // Update totaalrij inline (zonder scorecard te herrenderen)
  updateTTotaalRijInline();
  const isBeheerder = isCoordinatorRol();
  if (isBeheerder) {
    renderTMatrix();
  } else {
    // Voor spelers: matrix pas updaten bij inactiviteit (toetsenbord blijft open)
    clearTimeout(window._matrixUpdateTimer);
    window._matrixUpdateTimer = setTimeout(() => renderTMatrix(), 2000);
  }
  if (toernooiData.uitslagZichtbaar) renderTRanglijst();
  // Update uitslag knop status voor iedereen
  const alles = alleScoresIngevuld(toernooiData);
  const btn = document.getElementById('t-uitslag-btn');
  if (btn) {
    btn.disabled = !alles;
    btn.style.opacity = alles ? '1' : '0.5';
    btn.style.cursor = alles ? 'pointer' : 'not-allowed';
    btn.textContent = `📊 Naar de uitslag${alles ? '' : ' (scores onvolledig)'}`;
    btn.onclick = alles ? toonToernooiUitslag : null;
  }
  clearTimeout(window._tSaveTimer);
  window._tSaveTimer = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
    } catch(e) { console.error('Score opslaan mislukt:', e); }
  }, 800);
}

function updateTTotaalRijInline() {
  const t = toernooiData;
  if (!t) return;
  // Zoek alle totaalrijen in de scorecard en update ze
  const totaalRijen = document.querySelectorAll('#t-scorecard-wrap tr.t-totaal-rij');
  if (totaalRijen.length === 0) return; // fallback als niet gevonden
  totaalRijen.forEach(rij => {
    const cellen = rij.querySelectorAll('td[data-speler-id]');
    cellen.forEach(cel => {
      const sid = cel.dataset.spelerId;
      const scores = t.scores[sid] || t.scores[String(sid)] || [];
      const filled = scores.filter(v => v !== null && v !== undefined);
      cel.textContent = filled.length ? filled.reduce((a,b) => a + Number(b), 0) : '—';
    });
  });
}

function editToernooiHcp(spelerId) {
  const t = toernooiData;
  if (!t) return;
  const speler = t.spelers.find(s => String(s.id) === String(spelerId));
  if (!speler) return;
  const nieuw = prompt(`Playing handicap voor ${speler.naam.split(' ')[0]}:`, Math.round(speler.hcp));
  if (nieuw === null) return;
  const val = parseFloat(nieuw);
  if (isNaN(val)) { toast('Ongeldige handicap'); return; }
  speler.hcp = val;
  if (actieveToernooiId) setDoc(doc(db, "toernooien", actieveToernooiId), toernooiData);
  renderTScorecard();
  renderTRanglijst();
  renderTMatrix();
  // HCP blok verversen met actieve flight spelers
  const isBeheerder = huidigeBruiker?.rol === 'beheerder';
  const flights = toernooiData.flights || [];
  let hcpSpelers = toernooiData.spelers;
  if (!isBeheerder && flights.length > 0) {
    const voornaam = (huidigeBruiker?.gebruikersnaam || '').toLowerCase().split(' ')[0];
    const mijnFlight = flights.find(f => (f.spelerIds || []).some(sid => {
      const sp = toernooiData.spelers.find(s => String(s.id) === String(sid));
      return sp && sp.naam.toLowerCase().includes(voornaam);
    }));
    if (mijnFlight) hcpSpelers = (mijnFlight.spelerIds || []).map(sid =>
      toernooiData.spelers.find(s => String(s.id) === String(sid))).filter(Boolean);
  }
  renderHcpBlok(hcpSpelers, toernooiData.holes, toernooiData.hcpPct ?? 0.75, 'toernooi-hcp-blok');
  toast(`Handicap ${speler.naam.split(' ')[0]} bijgewerkt ✓`);
}

function updateTTotalen() {
  updateTTotaalRijInline();
}

function toggleTScorecard() {
  const w = document.getElementById('t-scorecard-wrap');
  w.style.display = w.style.display === 'none' ? '' : 'none';
}

// Bereken netto HCP slagen die speler B krijgt tov A op een hole
function getTHcpSlagen(spelerA, spelerB, hole, hcpPct) {
  const diff = Math.round(Math.abs(spelerA.hcp - spelerB.hcp) * hcpPct);
  const ontvanger = spelerA.hcp < spelerB.hcp ? spelerB : spelerA;
  // Meer dan 18 slagen: extra slag op holes met SI <= (diff - 18)
  const aantalHoles = 18;
  const basisSlagen = Math.min(diff, aantalHoles);
  const extraSlagen = Math.max(0, diff - aantalHoles);
  const slagOpHole = (hole.si <= basisSlagen ? 1 : 0) + (hole.si <= extraSlagen ? 1 : 0);
  return { diff, ontvanger, slagOpHole };
}

// Bereken punten voor alle onderlinge matchups
function berekenTPunten() {
  const t = toernooiData;
  const n = t.spelers.length;

  // punten[i] = totale punten speler i
  const punten = new Array(n).fill(0);
  const won = new Array(n).fill(0);
  const tied = new Array(n).fill(0);
  const lost = new Array(n).fill(0);
  // matrix[i][j] = resultaat van i vs j: 'W','L','T',null
  const matrix = Array.from({length: n}, () => new Array(n).fill(null));

  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      const sA = t.spelers[i];
      const sB = t.spelers[j];
      let standA = 0;
      let gespeeld = false;

      for (let h = 0; h < t.holes.length; h++) {
        const scoreA = t.scores[sA.id]?.[h] ?? t.scores[String(sA.id)]?.[h];
        const scoreB = t.scores[sB.id]?.[h] ?? t.scores[String(sB.id)]?.[h];
        if (scoreA == null || scoreB == null) continue;
        gespeeld = true;
        const hole = t.holes[h];
        // HCP slagen
        const diffRaw = Math.abs(sA.hcp - sB.hcp) * t.hcpPct;
        const diff = Math.round(diffRaw);
        const aKrijgtSlag = sA.hcp > sB.hcp && hole.si <= diff ? 1 : 0;
        const bKrijgtSlag = sB.hcp > sA.hcp && hole.si <= diff ? 1 : 0;
        const nettoA = scoreA - aKrijgtSlag;
        const nettoB = scoreB - bKrijgtSlag;
        if (nettoA < nettoB) standA++;
        else if (nettoB < nettoA) standA--;
      }

      if (!gespeeld) continue;

      // Bepaal winnaar
      if (standA > 0) {
        punten[i] += t.ptWin; punten[j] += t.ptLoss;
        won[i]++; lost[j]++;
        matrix[i][j] = 'W'; matrix[j][i] = 'L';
      } else if (standA < 0) {
        punten[j] += t.ptWin; punten[i] += t.ptLoss;
        won[j]++; lost[i]++;
        matrix[i][j] = 'L'; matrix[j][i] = 'W';
      } else {
        punten[i] += t.ptTie; punten[j] += t.ptTie;
        tied[i]++; tied[j]++;
        matrix[i][j] = 'T'; matrix[j][i] = 'T';
      }
    }
  }

  return { punten, won, tied, lost, matrix };
}

function renderTRanglijst() {
  const el = document.getElementById('t-ranglijst');
  if (!el) return; // Ranglijst niet zichtbaar tijdens spelen
  const t = toernooiData;
  const { punten, won, tied, lost } = berekenTPunten();

  // Sorteer op punten desc
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  document.getElementById('t-ranglijst').innerHTML = volgorde.map((entry, rank) => `
    <div class="ladder-item">
      <div class="rank-badge ${rank < 3 ? 'top3' : ''}">${rank+1}</div>
      <div class="player-name">${entry.s.naam}</div>
      <div style="font-size:12px;color:var(--light);text-align:right;line-height:1.6">
        ${entry.w}W ${entry.ti}T ${entry.l}L<br>
        <strong style="color:var(--dark)">${entry.pt > 0 ? '+' : ''}${entry.pt} pt</strong>
      </div>
    </div>
  `).join('');
}

function renderTMatrix() {
  // Bewaar focus en cursor positie voor matrix render
  const actief = document.activeElement;
  const tabIdx = actief?.getAttribute?.('tabindex');
  const selStart = actief?.selectionStart;

  const t = toernooiData;
  const n = t.spelers.length;
  const { matrix } = berekenTPunten();

  const kleur = { W: '#d4edda', L: '#f8d7da', T: '#fff3cd' };
  const uitslag = toernooiData?.uitslagZichtbaar === true;
  const tekst = uitslag ? { W: 'W', L: 'L', T: 'T' } : { W: 'UP', L: 'DOWN', T: 'TIED' };

  let html = `<table style="border-collapse:collapse;font-size:11px;width:100%">`;
  // Header
  html += `<tr><th style="padding:4px;background:var(--green);color:white"></th>`;
  t.spelers.forEach(s => {
    html += `<th style="padding:4px 6px;background:var(--green);color:white;text-align:center">${s.naam.split(' ')[0]}</th>`;
  });
  html += '</tr>';

  // Rijen
  t.spelers.forEach((sA, i) => {
    html += `<tr><td style="padding:4px 8px;font-weight:600;font-size:12px;white-space:nowrap">${sA.naam.split(' ')[0]}</td>`;
    t.spelers.forEach((sB, j) => {
      if (i === j) {
        html += `<td style="background:#f0ede4;text-align:center;padding:4px">—</td>`;
      } else {
        const res = matrix[i][j];
        const bg = res ? kleur[res] : 'transparent';
        const tx = res ? tekst[res] : '';
        html += `<td style="background:${bg};text-align:center;padding:4px;font-weight:700">${tx}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</table>';
  const matrixEl = document.getElementById('t-matrix');
  matrixEl.innerHTML = html;

  // Herstel focus na matrix render
  if (tabIdx) {
    const herstel = document.querySelector(`input[tabindex="${tabIdx}"]`);
    if (herstel) {
      herstel.focus();
      try { herstel.setSelectionRange(selStart, selStart); } catch(e) {}
    }
  }
}

function openToernooiAfsluiten() {
  const t = toernooiData;
  const { punten, won, tied, lost } = berekenTPunten();
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  const rankingLadderIds = t.rankingLadderIds?.length > 0
    ? t.rankingLadderIds
    : (t.ladderId ? [t.ladderId] : []);
  const heeftRankingLadders = rankingLadderIds.length > 0;
  const rankingLadderNamen = alleLadders
    .filter(l => rankingLadderIds.includes(l.id))
    .map(l => l.naam).join(', ');

  let html = '<div style="margin-bottom:12px">';
  volgorde.forEach((entry, rank) => {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-family:'Bebas Neue';font-size:18px;color:${rank===0?'var(--gold)':'var(--light)'};margin-right:8px">${rank+1}</span>
        <strong>${entry.s.naam}</strong>${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}
      </div>
      <span style="font-family:'DM Mono',monospace;color:var(--green);font-weight:700">${entry.pt > 0 ? '+' : ''}${entry.pt} pt</span>
    </div>`;
  });
  html += `</div><p style="font-size:12px;color:var(--light)">${
    heeftRankingLadders
      ? `Rankingposities worden bijgewerkt voor de betreffende spelers in: ${rankingLadderNamen}. Alleen spelers met 5+ ladderwedstrijden. Gastspelers tellen niet mee.`
      : 'Er zijn geen ranking ladders gekoppeld aan dit toernooi. Ladders worden niet aangepast.'
  }</p>`;

  document.getElementById('t-eindstand').innerHTML = html;
  document.getElementById('modal-toernooi-afsluiten').classList.add('open');
}

async function bevestigToernooiAfsluiten() {

  try {
  const t = toernooiData;
  const { punten, won, tied, lost, matrix } = berekenTPunten();
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  // Haal alle gekoppelde ranking ladders op — optioneel
  const rankingLadderIds = t.rankingLadderIds?.length > 0
    ? t.rankingLadderIds
    : (t.ladderId ? [t.ladderId] : []);

  for (const ladderId of rankingLadderIds) {
    const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
    if (snapExists) {
      const ladderData = snapData;
      const ladderSpelerIds = new Set((ladderData.spelers || []).map(s => String(s.id)));
      const ladderSpelersOpNaam = new Map((ladderData.spelers || []).map(s => [s.naam.toLowerCase(), s]));
      const deelnemers = volgorde.filter(e =>
        !e.s.gast && (ladderSpelerIds.has(String(e.s.id)) || ladderSpelersOpNaam.has(e.s.naam.toLowerCase()))
      ).filter(e => {
        // Alleen spelers met 5+ ladderwedstrijden doen mee voor ranking
        const ladderSpeler = ladderData.spelers.find(s => String(s.id) === String(e.s.id) || s.naam.toLowerCase() === e.s.naam.toLowerCase());
        return (ladderSpeler?.partijen || 0) >= 5;
      });
      if (deelnemers.length > 0) {
        // Sla huidige ranks op als prevRank voor delta weergave
        ladderData.spelers.forEach(s => { s.prevRank = s.rank; });

        // Sorteer van hoogste naar laagste punten zodat winnaars eerst profiteren
        const gesorteerd = [...deelnemers].sort((a,b) => b.pt - a.pt);

        gesorteerd.forEach(e => {
          const sp = ladderData.spelers.find(s => String(s.id) === String(e.s.id) || s.naam.toLowerCase() === e.s.naam.toLowerCase());
          if (!sp) return;
          const pt = e.pt || 0;
          if (pt === 0) return; // geen aanpassing bij 0 punten

          const oudeRank = sp.rank;
          const nieuweRank = Math.max(1, Math.min(ladderData.spelers.length, oudeRank - pt));

          if (nieuweRank === oudeRank) return;

          // Verschuif tussenliggende spelers
          if (nieuweRank < oudeRank) {
            // Stijgen: spelers tussen nieuweRank en oudeRank zakken één plek
            ladderData.spelers.forEach(s => {
              if (s.id !== sp.id && s.rank >= nieuweRank && s.rank < oudeRank) s.rank++;
            });
          } else {
            // Zakken: spelers tussen oudeRank en nieuweRank stijgen één plek
            ladderData.spelers.forEach(s => {
              if (s.id !== sp.id && s.rank > oudeRank && s.rank <= nieuweRank) s.rank--;
            });
          }
          sp.rank = nieuweRank;
        });

        // Update partijen en gewonnen stats
        deelnemers.forEach(e => {
          const sp = ladderData.spelers.find(s => String(s.id) === String(e.s.id) || s.naam.toLowerCase() === e.s.naam.toLowerCase());
          if (sp) {
            sp.partijen = (sp.partijen || 0) + (deelnemers.length - 1);
            sp.gewonnen = (sp.gewonnen || 0) + (e.w || 0);
          }
        });

        // Normaliseer ranks
        [...ladderData.spelers].sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);
        [...ladderData.spelers].sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);
        await setDoc(doc(db, 'ladders', ladderId), ladderData);
        const ladderIdx = alleLadders.findIndex(l => l.id === ladderId);
        if (ladderIdx >= 0) alleLadders[ladderIdx].spelers = ladderData.spelers;
        if (ladderId === activeLadderId) {
          state.spelers = ladderData.spelers;
          // Snapshot na toernooi ranking update
          await slaSnapshotOp(`🏅 Na toernooi: ${t.naam}`);
        }
      }
    }
  }

  // Sla toernooi op in archief — gebruik archiefData cache
  const archief = { seizoenen: archiefData, toernooien: window._archiefToernooienCache || [] };
  if (!archief.toernooien) archief.toernooien = [];

  // Firestore ondersteunt geen nested arrays — sla matrix op als object
  const matrixArchief = {};
  t.spelers.forEach((sA, i) => {
    t.spelers.forEach((sB, j) => {
      matrixArchief[`${i}_${j}`] = i === j ? 'X' : (matrix[i][j] || '-');
    });
  });

  archief.toernooien.unshift({
    naam: t.naam, datum: t.datum, baan: t.baan, holes: t.holes.length,
    ptWin: t.ptWin, ptTie: t.ptTie, ptLoss: t.ptLoss,
    ranglijst: volgorde.map(e => ({ naam: e.s.naam, hcp: Math.round(e.s.hcp), punten: e.pt, won: e.w, tied: e.ti, lost: e.l })),
    spelerNamen: t.spelers.map(s => s.naam.split(' ')[0]),
    matrix: matrixArchief,
    timestamp: Date.now()
  });
  await setDoc(ARCHIEF_DOC, archief);

  // Sluit toernooi af
  if (actieveToernooiId) await setDoc(doc(db, 'toernooien', actieveToernooiId), { ...toernooiData, status: 'afgerond' });
  store.alleToernooien = alleToernooien.filter(t => t.id !== actieveToernooiId);
  store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
  store.actieveToernooiId = toernooiData?.id || null;

  closeModal('modal-toernooi-afsluiten');
  toast('Toernooi afgerond! 🏅 Ladder bijgewerkt.');
  renderToernooi();
  renderLadder();
  } catch(e) { console.error('bevestigToernooiAfsluiten mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function annuleerToernooi() {

  try {
  if (!confirm('Toernooi annuleren? Alle scores gaan verloren.')) return;
  if (actieveToernooiId) await setDoc(doc(db, "toernooien", actieveToernooiId), { ...toernooiData, status: "geannuleerd" });
  store.alleToernooien = alleToernooien.filter(t => t.id !== actieveToernooiId);
  store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
  store.actieveToernooiId = toernooiData?.id || null;
  renderToernooi();
  toast('Toernooi geannuleerd');
  } catch(e) { console.error('annuleerToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================

export { renderToernooi, herlaadToernooien, selecteerToernooi, initToernooiSetup, toggleTSpelersLadder, toggleTRankingLadder, getToernooiSpelersPool, zoekToernooiSpeler, selecteerToernooiSpeler, sluitToernooiSpelerLijst, verwijderToernooiSpelerSelectie, voegGastspelerToe, renderTGeselecteerdeSpelers, toggleTSpeler, toggleHolesCustom, openFlightIndeling, renderFlightLijst, berekenFlightTijd, voegFlightToe, wijzigFlightStarttijd, wijzigFlightStarthole, verwijderFlight, wijzigFlightNaam, wijzigFlightHcp, verplaatsSpelerFlight, startToernooi, toggleToernooiMatrix, toonToernooiUitslag, openToernooiSpelersBeheer, zoekToernooiSpelerModal, selecteerToernooiSpelerModal, sluitToernooiSpelerModal, voegBestaandeSpelerToeAanToernooi, voegGastspelerToeAanToernooi, verwijderToernooiSpelerNieuw, openVerwijderToernooiSpeler, verwijderToernooiSpeler, alleScoresIngevuld, renderToernooiActief, renderTScorecard, refreshToernooiScorekaart, selecteerFlightTab, updateTScoreAndAdvance, updateTScore, updateTTotaalRijInline, editToernooiHcp, updateTTotalen, toggleTScorecard, getTHcpSlagen, berekenTPunten, renderTRanglijst, renderTMatrix, openToernooiAfsluiten, bevestigToernooiAfsluiten, annuleerToernooi };
