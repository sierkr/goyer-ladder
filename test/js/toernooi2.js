// ============================================================
//  toernooi2.js — NIEUWBOUW toernooi-setup ("één blad"-model)
//  Principe: één toernooi-object is de enige waarheid.
//  - Elk invoerelement schrijft direct in dat object (het blad).
//  - Het scherm leest alleen het blad; een re-render kan niets wissen.
//  - Concept wordt doorlopend opgeslagen → gaat niet verloren.
//  - Datum is startvoorwaarde: starten kan niet vóór de datum.
//  Herbruikt bestaande data: alleBANEN() (banen) en getLadderSpelers().
//  Actieve fase (scorekaart/scoring/ranglijst/afsluiten) → renderToernooiActief.
// ============================================================

import { db, esc, escAttr } from './config.js';
import { alleLadders, huidigeBruiker, alleToernooien } from './store.js';
import { isBeheerderRol, isCoordinatorRol, toast } from './auth.js';
import { getLadderSpelers } from './ladder-view.js';
import { renderToernooiActief, herlaadToernooien, renderToernooi, selecteerToernooi } from './toernooi.js';
import { alleBANEN } from './partij.js';
import { doc, setDoc, getDocs, collection, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- State ----
let blad = null;
let bewaarTimer = null;
let bronLadderId = '';   // ladder waaruit spelers gekozen worden

function standaardHoles() {
  return Array.from({ length: 18 }, (_, i) => ({ si: i + 1, par: 4 }));
}
function nieuweDag(nr) {
  return {
    dagNr: nr, datum: '', baan: '', interval: 8, starttijd: '09:00',
    holes: standaardHoles(), flights: [], scores: {},
    afgerond: false, uitslagZichtbaar: false
  };
}
function leegBlad() {
  return {
    naam: '', modus: 'matchplay', status: 'concept',
    ptWin: 2, ptTie: 1, ptLoss: 0, hcpPct: 100,
    rankingLadderIds: [], ladderId: null,
    spelers: [], dagen: [nieuweDag(1)],
    actiefDagNr: 1, toernooiModus: false,
    uitslagZichtbaar: false, scoresVerborgen: false,
    timestamp: Date.now()
  };
}

// ---- Opslag: het blad IS het document ----
async function bewaarBlad(directRender = false) {
  if (!blad) return;
  try {
    if (!blad.id) blad.id = doc(collection(db, 'toernooien')).id;
    await setDoc(doc(db, 'toernooien', blad.id), blad);
    if (directRender) renderToernooi2();
  } catch (e) {
    console.error('Blad opslaan mislukt:', e);
    toast('Opslaan mislukt: ' + (e.code || e.message));
  }
}
function bewaarBladDebounced() {
  clearTimeout(bewaarTimer);
  bewaarTimer = setTimeout(() => bewaarBlad(), 500);
}

// ---- Startvoorwaarde ----
function eersteDatum() { return blad?.dagen?.[0]?.datum || ''; }
function magStarten() {
  const d = eersteDatum();
  if (!d) return false;
  const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  return !isNaN(dd.getTime()) && dd <= vandaag;
}

// ---- Flights automatisch bij start ----
function autoFlights(spelers) {
  const per = 4, flights = [], ids = spelers.map(s => s.uid);
  for (let i = 0; i < ids.length; i += per) {
    flights.push({ id: flights.length + 1, naam: 'Flight ' + (flights.length + 1),
      spelerIds: ids.slice(i, i + per), starttijd: '09:00', starthole: 1 });
  }
  if (!flights.length) flights.push({ id: 1, naam: 'Flight 1', spelerIds: [], starttijd: '09:00', starthole: 1 });
  return flights;
}

// ---- Beschikbare spelers uit bronladder (minus reeds toegevoegd) ----
function beschikbareSpelers() {
  if (!bronLadderId) return [];
  let pool = [];
  try { pool = getLadderSpelers(bronLadderId) || []; } catch (e) { pool = []; }
  const gekozen = new Set(blad.spelers.map(s => s.uid));
  return pool.filter(s => s.uid && !gekozen.has(s.uid));
}

// ============================================================
//  ENTRY / ROUTING + in-app schakelaar oud/nieuw
// ============================================================
const SETUP_KEY = 'toernooiSetupNieuw';

function gebruikNieuw() {
  try { return localStorage.getItem(SETUP_KEY) === 'true'; } catch (e) { return false; }
}

function renderSchakelaar(page) {
  const bestaat = document.getElementById('t2-schakelaar');
  if (!isBeheerderRol()) { if (bestaat) bestaat.remove(); return; }
  let bar = bestaat;
  if (!bar) { bar = document.createElement('div'); bar.id = 't2-schakelaar'; page.insertBefore(bar, page.firstChild); }
  const nieuw = gebruikNieuw();
  const knop = (aan, label, actief) =>
    `<button onclick="t2WisselSetup(${aan})" style="padding:5px 14px;border-radius:20px;border:1.5px solid var(--green,#1f5c3a);cursor:pointer;font-weight:600;font-family:inherit;font-size:13px;${actief ? 'background:var(--green,#1f5c3a);color:#fff' : 'background:#fff;color:var(--green,#1f5c3a)'}">${label}</button>`;
  bar.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;padding:10px 4px;font-size:12px;color:var(--mid)">
       <span style="text-transform:uppercase;letter-spacing:.04em">Toernooi-setup:</span>
       ${knop(false, 'Oud', !nieuw)} ${knop(true, 'Nieuw', nieuw)}
     </div>`;
}

window.t2WisselSetup = function (nieuw) {
  try { localStorage.setItem(SETUP_KEY, nieuw ? 'true' : 'false'); } catch (e) {}
  routeToernooiTab();
};

// Enige tab-entry: schakelaar + kies oud/nieuw
export function routeToernooiTab() {
  const page = document.getElementById('page-toernooi');
  if (!page) return;
  renderSchakelaar(page);

  let c = document.getElementById('t2-container');
  if (!c) { c = document.createElement('div'); c.id = 't2-container'; page.appendChild(c); }
  const oudeKinderen = [...page.children].filter(el => el.id !== 't2-container' && el.id !== 't2-schakelaar');

  const uid = huidigeBruiker?.uid;
  const actief = (alleToernooien || []).find(t => t.status === 'actief' &&
    ((t.spelers || []).some(s => s.uid === uid) || isCoordinatorRol() || isBeheerderRol()));

  // Nieuwbouw alleen voor de SETUP-fase (geen actief toernooi) en alleen voor beheerder/coordinator.
  if (gebruikNieuw() && !actief && (isBeheerderRol() || isCoordinatorRol())) {
    oudeKinderen.forEach(el => el.style.display = 'none');
    c.style.display = '';
    renderSetup(c);
  } else {
    // Oude, bewezen flow (ook voor de actieve fase in nieuw-modus)
    c.style.display = 'none';
    oudeKinderen.forEach(el => el.style.display = '');
    if (actief) selecteerToernooi(actief.id); else renderToernooi();
  }
}

function renderSetup(c) {
  if (!blad) blad = leegBlad();
  if (!bronLadderId) bronLadderId = blad.rankingLadderIds[0] || (alleLadders[0] && alleLadders[0].id) || '';
  c.innerHTML = setupHtml();
}

// In-place her-render van de setup (gebruikt door de handlers)
export function renderToernooi2() {
  const c = document.getElementById('t2-container');
  if (c && c.style.display !== 'none') renderSetup(c);
  else routeToernooiTab();
}

// ============================================================
//  SETUP-SCHERM
// ============================================================
function setupHtml() {
  const b = blad;
  const banen = Object.keys(alleBANEN());
  const startBtn = magStarten()
    ? `<button class="t2-start" onclick="t2Start()">Toernooi starten</button>`
    : `<button class="btn-primary" disabled style="opacity:.5">Toernooi starten</button>
       <p style="font-size:12px;color:var(--gold);margin-top:6px">Starten kan pas op ${eersteDatum() ? esc(eersteDatum()) : 'de ingevulde datum'}.</p>`;

  return `
  <style>
    #page-toernooi .t2-lab{display:block;font-size:12px;color:var(--mid);text-transform:uppercase;letter-spacing:.03em;margin:12px 0 4px}
    #page-toernooi .t2-rij{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
    #page-toernooi .t2-rij>div{flex:1;min-width:110px}
    #page-toernooi .t2-check{display:flex;align-items:center;gap:10px;justify-content:flex-start;padding:8px 0;font-size:15px;border-bottom:1px solid var(--border,#eee)}
    #page-toernooi .t2-check input{width:20px;height:20px;flex:0 0 auto;margin:0}
    #page-toernooi .t2-dag{border:1px solid var(--border,#d8ddd8);border-radius:8px;padding:12px;margin-bottom:10px}
    #page-toernooi .t2-speler{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#eee)}
    #page-toernooi .t2-speler .nm{flex:1}
    #page-toernooi .t2-btn2{padding:9px 14px;border-radius:8px;border:1.5px solid var(--green,#1f5c3a);background:#fff;color:var(--green,#1f5c3a);font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
    #page-toernooi .t2-x{border:none;background:#f4eaea;color:#b23b3b;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:17px;flex:0 0 auto}
    #page-toernooi .t2-in{padding:9px 11px;border:1.5px solid var(--border,#d8ddd8);border-radius:8px;font-size:15px;font-family:inherit;width:100%;box-sizing:border-box}
    #page-toernooi .t2-start{padding:12px 22px;border-radius:10px;border:none;background:var(--green,#1f5c3a);color:#fff;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit}
    #page-toernooi .card{padding:16px 18px}
  </style>

  <div class="card">
    <div class="card-header"><h2>Nieuw toernooi</h2></div>
    <p style="font-size:12px;color:var(--mid);margin-bottom:6px">Alles hoort bij dit toernooi en wordt doorlopend bewaard.</p>

    <label class="t2-lab">Naam</label>
    <input class="t2-in" type="text" value="${escAttr(b.naam)}" oninput="t2Set('naam', this.value)" placeholder="Toernooinaam">

    <label class="t2-lab">Modus</label>
    <select class="t2-in" onchange="t2Set('modus', this.value)">
      ${['matchplay', 'amerikaantje', 'high-low'].map(m => `<option value="${m}" ${b.modus === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select>

    <div class="t2-rij" style="margin-top:6px">
      <div><label class="t2-lab">Punt winst</label><input class="t2-in" type="number" value="${b.ptWin}" onchange="t2Set('ptWin', +this.value)"></div>
      <div><label class="t2-lab">Punt gelijk</label><input class="t2-in" type="number" value="${b.ptTie}" onchange="t2Set('ptTie', +this.value)"></div>
      <div><label class="t2-lab">Punt verlies</label><input class="t2-in" type="number" value="${b.ptLoss}" onchange="t2Set('ptLoss', +this.value)"></div>
      <div><label class="t2-lab">HCP %</label><input class="t2-in" type="number" value="${b.hcpPct}" onchange="t2Set('hcpPct', +this.value)"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h2>Telt voor ladder</h2></div>
    ${(alleLadders || []).map(l => `
      <div class="t2-check">
        <input type="checkbox" ${b.rankingLadderIds.includes(l.id) ? 'checked' : ''}
               onchange="t2RankingLadder('${escAttr(l.id)}', this.checked)">
        <span>${esc(l.naam || l.id)}</span>
      </div>`).join('') || '<p style="color:var(--mid)">Geen ladders beschikbaar.</p>'}
  </div>

  <div class="card">
    <div class="card-header"><h2>Dagen</h2></div>
    ${b.dagen.map((dg, i) => dagBlokHtml(dg, i, banen)).join('')}
    <button class="t2-btn2" onclick="t2VoegDagToe()">+ Dag toevoegen</button>
  </div>

  <div class="card">
    <div class="card-header"><h2>Spelers (${b.spelers.length})</h2></div>

    <label class="t2-lab">Spelers kiezen uit ladder</label>
    <div class="t2-rij">
      <div>
        <select class="t2-in" onchange="t2BronLadder(this.value)">
          ${(alleLadders || []).map(l => `<option value="${escAttr(l.id)}" ${l.id === bronLadderId ? 'selected' : ''}>${esc(l.naam || l.id)}</option>`).join('')}
        </select>
      </div>
      <div>
        <select class="t2-in" id="t2-picker" onchange="t2VoegSpelerToe(this.value); this.value='';">
          <option value="">— kies speler om toe te voegen —</option>
          ${beschikbareSpelers().map(s => `<option value="${escAttr(s.uid)}">${esc(s.naam)}${s.hcp != null ? ' (hcp ' + s.hcp + ')' : ''}</option>`).join('')}
        </select>
      </div>
    </div>

    <label class="t2-lab">Of gastspeler toevoegen</label>
    <div class="t2-rij">
      <div><input class="t2-in" type="text" id="t2-gast-naam" placeholder="Naam gast"></div>
      <div style="max-width:100px"><input class="t2-in" type="number" id="t2-gast-hcp" placeholder="HCP"></div>
      <div style="flex:0 0 auto"><button class="t2-btn2" onclick="t2VoegGastToe()">+ Gast</button></div>
    </div>

    <div style="margin-top:12px">
      ${b.spelers.map((s, i) => `
        <div class="t2-speler">
          <span class="nm">${esc(s.naam)}${s.gast ? ' <em style="color:var(--mid)">(gast)</em>' : ''}</span>
          <input class="t2-in" style="max-width:80px" type="number" value="${s.hcp ?? ''}" onchange="t2SpelerHcp(${i}, +this.value)" title="HCP">
          <button class="t2-x" onclick="t2VerwijderSpeler(${i})">×</button>
        </div>`).join('') || '<p style="color:var(--mid)">Nog geen spelers gekozen.</p>'}
    </div>
  </div>

  <div class="card">
    ${startBtn}
    <button class="t2-btn2" onclick="t2Annuleer()" style="margin-left:8px">Annuleren</button>
    <p style="font-size:11px;color:var(--mid);margin-top:8px">Status: ${esc(blad.status)}${blad.id ? ' · opgeslagen' : ''}</p>
  </div>`;
}

function dagBlokHtml(dg, i, banen) {
  const handmatig = dg.baan && !banen.includes(dg.baan);
  return `
  <div class="t2-dag">
    <div class="t2-rij">
      <div><label class="t2-lab">Datum dag ${dg.dagNr}</label>
        <input class="t2-in" type="date" value="${escAttr(dg.datum)}" onchange="t2DagSet(${i}, 'datum', this.value)"></div>
      <div><label class="t2-lab">Baan</label>
        <select class="t2-in" onchange="t2DagBaan(${i}, this.value)">
          <option value="">— kies baan —</option>
          ${banen.map(bn => `<option value="${escAttr(bn)}" ${dg.baan === bn ? 'selected' : ''}>${esc(bn)}</option>`).join('')}
          <option value="__handmatig__" ${handmatig ? 'selected' : ''}>+ Handmatig invoeren</option>
        </select></div>
      ${blad.dagen.length > 1 ? `<div style="flex:0 0 auto"><button class="t2-x" onclick="t2VerwijderDag(${i})">×</button></div>` : ''}
    </div>
    ${handmatig ? `<input class="t2-in" style="margin-top:8px" type="text" value="${escAttr(dg.baan)}" placeholder="Baannaam" onchange="t2DagSet(${i}, 'baan', this.value)">` : ''}
  </div>`;
}

// ============================================================
//  HANDLERS
// ============================================================
window.t2Set = function (veld, waarde) { blad[veld] = waarde; bewaarBladDebounced(); };

window.t2RankingLadder = function (id, aan) {
  const set = new Set(blad.rankingLadderIds);
  if (aan) set.add(id); else set.delete(id);
  blad.rankingLadderIds = [...set];
  blad.ladderId = blad.rankingLadderIds[0] || null;
  bewaarBladDebounced();
};

window.t2DagSet = function (i, veld, waarde) {
  if (!blad.dagen[i]) return;
  blad.dagen[i][veld] = waarde;
  bewaarBladDebounced();
  if (veld === 'datum') renderToernooi2();
};

window.t2DagBaan = function (i, waarde) {
  if (!blad.dagen[i]) return;
  const banenObj = alleBANEN();
  if (waarde === '__handmatig__') {
    blad.dagen[i].baan = blad.dagen[i].baan && !banenObj[blad.dagen[i].baan] ? blad.dagen[i].baan : 'Nieuwe baan';
  } else {
    blad.dagen[i].baan = waarde;
    const holes = banenObj[waarde] && banenObj[waarde].holes;
    if (Array.isArray(holes) && holes.length) blad.dagen[i].holes = holes;
  }
  bewaarBlad(true);
};

window.t2VoegDagToe = function () { blad.dagen.push(nieuweDag(blad.dagen.length + 1)); bewaarBlad(true); };
window.t2VerwijderDag = function (i) {
  blad.dagen.splice(i, 1);
  blad.dagen.forEach((d, idx) => d.dagNr = idx + 1);
  bewaarBlad(true);
};

window.t2BronLadder = function (id) { bronLadderId = id; renderToernooi2(); };

window.t2VoegSpelerToe = function (uid) {
  if (!uid) return;
  if (blad.spelers.some(s => s.uid === uid)) return;
  const pool = beschikbareSpelers();
  const s = pool.find(p => p.uid === uid);
  if (!s) return;
  blad.spelers.push({ uid: s.uid, naam: s.naam || s.uid, hcp: s.hcp ?? 0, gast: false });
  bewaarBlad(true);
};

window.t2VoegGastToe = function () {
  const naam = document.getElementById('t2-gast-naam')?.value.trim();
  const hcp = +(document.getElementById('t2-gast-hcp')?.value || 0);
  if (!naam) { toast('Vul een naam in'); return; }
  blad.spelers.push({ uid: 'gast_' + Math.random().toString(36).slice(2, 10), naam, hcp, gast: true });
  bewaarBlad(true);
};

window.t2SpelerHcp = function (i, hcp) { if (blad.spelers[i]) { blad.spelers[i].hcp = hcp; bewaarBladDebounced(); } };
window.t2VerwijderSpeler = function (i) { blad.spelers.splice(i, 1); bewaarBlad(true); };

window.t2Start = async function () {
  if (!blad.naam.trim()) { toast('Geef het toernooi een naam'); return; }
  if (!magStarten()) { toast('Kan pas starten op ' + (eersteDatum() || 'de datum')); return; }
  if (blad.spelers.length < 2) { toast('Minimaal 2 spelers nodig'); return; }
  blad.dagen.forEach(dg => { if (!dg.flights || !dg.flights.length) dg.flights = autoFlights(blad.spelers); });
  blad.status = 'actief';
  blad.toernooiModus = true;
  blad.timestamp = Date.now();
  await bewaarBlad();
  await herlaadToernooien();
  toast('Toernooi gestart');
  blad = null;
  routeToernooiTab();
};

window.t2Annuleer = async function () {
  if (!confirm('Dit concept annuleren?')) return;
  if (blad.id) { blad.status = 'geannuleerd'; await bewaarBlad(); }
  blad = null;
  renderToernooi2();
};

// ---- Laatste concept terugladen bij binnenkomst op de tab ----
export async function laadLaatsteConcept() {
  try {
    const snap = await getDocs(query(collection(db, 'toernooien'), where('status', '==', 'concept')));
    if (!snap.empty) {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      blad = docs[0];
      bronLadderId = blad.rankingLadderIds?.[0] || bronLadderId;
    }
  } catch (e) { console.warn('Concept laden mislukt:', e); }
}
