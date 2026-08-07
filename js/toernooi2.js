// ============================================================
//  toernooi2.js — VOLLEDIGE nieuwe toernooimodule (zelfstandig)
//  Principe: het toernooi-DOCUMENT is de enige waarheid.
//   - 't' is een spiegel van het Firestore-document en wordt NOOIT geleegd.
//   - Elk veld schrijft direct door naar toernooien/{id} (write-through).
//   - Bij terugkeer wordt het document opnieuw geladen → niets gaat verloren.
//   - Setup én actieve fase (scorekaart, scoring, ranglijst, afsluiten +
//     ladder-update) zitten HIER. De oude code wordt nergens aangeroepen,
//     behalve als de beheerder bewust de schakelaar op 'Oud' zet.
//  Formaten identiek aan bestaande app: hcpPct = fractie; holes {si,par};
//   scores per uid = 18 ints; live/{uid} = {dagNr, scores, timestamp}.
// ============================================================

import { db, esc, escAttr } from './config.js';
import { alleLadders, huidigeBruiker, alleToernooien } from './store.js';
import { isBeheerderRol, isCoordinatorRol, toast } from './auth.js';
import { getLadderSpelers } from './ladder-view.js';
import { slaSnapshotOp } from './beheer.js';
import { alleBANEN } from './partij.js';
import { herlaadToernooien, renderToernooi } from './toernooi.js'; // renderToernooi enkel voor 'Oud'-stand van de schakelaar
import { doc, setDoc, getDoc, getDocs, collection, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================================
//  STATE — document als waarheid
// ============================================================
let t = null;             // huidig toernooi-document (spiegel)
let bronLadderId = '';    // ladder waaruit spelers gekozen worden
let bewaarTimer = null;
let liveCache = {};        // uid -> {dagNr, scores} (ingelezen live-scores)
const SETUP_KEY = 'toernooiSetupNieuw';

function gebruikNieuw() { try { return localStorage.getItem(SETUP_KEY) === 'true'; } catch (e) { return false; } }

function standaardHoles() { return Array.from({ length: 18 }, (_, i) => ({ si: i + 1, par: 4 })); }
function nieuweDag(nr) {
  return { dagNr: nr, datum: '', baan: '', interval: 8, starttijd: '09:00',
    holes: standaardHoles(), flights: [], scores: {}, afgerond: false, uitslagZichtbaar: false };
}
function leegToernooi() {
  return { naam: '', modus: 'matchplay', status: 'concept',
    ptWin: 2, ptTie: 1, ptLoss: 0, hcpPct: 1,
    rankingLadderIds: [], ladderId: null,
    spelers: [], dagen: [nieuweDag(1)], actiefDagNr: 1,
    toernooiModus: false, uitslagZichtbaar: false, scoresVerborgen: false,
    timestamp: Date.now() };
}

// ============================================================
//  OPSLAG — write-through naar het document
// ============================================================
async function opslaan(directRender = false) {
  if (!t) return;
  try {
    if (!t.id) t.id = doc(collection(db, 'toernooien')).id;
    await setDoc(doc(db, 'toernooien', t.id), t);
    if (directRender) render();
  } catch (e) { console.error('Opslaan mislukt:', e); toast('Opslaan mislukt: ' + (e.code || e.message)); }
}
function opslaanDebounced() { clearTimeout(bewaarTimer); bewaarTimer = setTimeout(() => opslaan(), 500); }

// Laad het bewerkbare toernooi: actief (van mij) > laatste concept > vers
async function laadHuidig() {
  const uid = huidigeBruiker?.uid;
  // actief toernooi waar ik in zit of dat ik beheer
  let gevonden = (alleToernooien || []).find(x => x.status === 'actief' &&
    ((x.spelers || []).some(s => s.uid === uid) || isCoordinatorRol() || isBeheerderRol()));
  if (!gevonden && (isBeheerderRol() || isCoordinatorRol())) {
    try {
      const snap = await getDocs(query(collection(db, 'toernooien'), where('status', '==', 'concept')));
      if (!snap.empty) {
        const cs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        gevonden = cs[0];
      }
    } catch (e) { console.warn('Concept laden mislukt:', e); }
  }
  t = gevonden ? JSON.parse(JSON.stringify(gevonden)) : ((isBeheerderRol() || isCoordinatorRol()) ? leegToernooi() : null);
  if (t && !bronLadderId) bronLadderId = t.rankingLadderIds[0] || (alleLadders[0] && alleLadders[0].id) || '';
  await laadLive();
}

// Live-scores van het huidige toernooi inlezen
async function laadLive() {
  liveCache = {};
  if (!t || !t.id) return;
  try {
    const snap = await getDocs(collection(db, 'toernooien', t.id, 'live'));
    snap.docs.forEach(d => { liveCache[d.id] = d.data(); });
  } catch (e) { /* stil */ }
}

// Voor nav.js (compat): laadt niets extra's, laadHuidig doet het werk
export async function laadLaatsteConcept() { /* no-op: laadHuidig regelt dit */ }

// ============================================================
//  SCORING — exact als de bestaande app
// ============================================================
function scoresVoorDag(dag) {
  // merge opgeslagen dag.scores met live-scores van dezelfde dag
  const out = Object.assign({}, dag.scores || {});
  Object.keys(liveCache).forEach(uid => {
    const l = liveCache[uid];
    if (l && l.dagNr === dag.dagNr && Array.isArray(l.scores)) out[uid] = l.scores;
  });
  return out;
}
function berekenDagPunten(tt, dag) {
  const n = tt.spelers.length;
  const punten = new Array(n).fill(0), won = new Array(n).fill(0), tied = new Array(n).fill(0), lost = new Array(n).fill(0);
  const matrix = Array.from({ length: n }, () => new Array(n).fill(null));
  const sc = scoresVoorDag(dag);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sA = tt.spelers[i], sB = tt.spelers[j];
      let standA = 0, gespeeld = false;
      for (let h = 0; h < dag.holes.length; h++) {
        const scoreA = sc[sA.uid]?.[h], scoreB = sc[sB.uid]?.[h];
        if (scoreA == null || scoreB == null) continue;
        gespeeld = true;
        const hole = dag.holes[h];
        const diff = Math.round(Math.abs(sA.hcp - sB.hcp) * tt.hcpPct);
        const aSlag = (sA.hcp > sB.hcp && hole.si <= diff) ? 1 : 0;
        const bSlag = (sB.hcp > sA.hcp && hole.si <= diff) ? 1 : 0;
        const nettoA = scoreA - aSlag, nettoB = scoreB - bSlag;
        if (nettoA < nettoB) standA++; else if (nettoB < nettoA) standA--;
      }
      if (!gespeeld) continue;
      if (standA > 0) { punten[i] += tt.ptWin; punten[j] += tt.ptLoss; won[i]++; lost[j]++; matrix[i][j] = 'W'; matrix[j][i] = 'L'; }
      else if (standA < 0) { punten[j] += tt.ptWin; punten[i] += tt.ptLoss; won[j]++; lost[i]++; matrix[i][j] = 'L'; matrix[j][i] = 'W'; }
      else { punten[i] += tt.ptTie; punten[j] += tt.ptTie; tied[i]++; tied[j]++; matrix[i][j] = 'T'; matrix[j][i] = 'T'; }
    }
  }
  return { punten, won, tied, lost, matrix };
}
function berekenTotaal(tt) {
  const n = tt.spelers.length;
  const punten = new Array(n).fill(0), won = new Array(n).fill(0), tied = new Array(n).fill(0), lost = new Array(n).fill(0);
  (tt.dagen || []).forEach(dag => {
    const r = berekenDagPunten(tt, dag);
    for (let i = 0; i < n; i++) { punten[i] += r.punten[i]; won[i] += r.won[i]; tied[i] += r.tied[i]; lost[i] += r.lost[i]; }
  });
  return { punten, won, tied, lost };
}

// ============================================================
//  ROUTING + in-app schakelaar (harde wissel, geen vermenging)
// ============================================================
export async function routeToernooiTab() {
  const page = document.getElementById('page-toernooi');
  if (!page) return;
  renderSchakelaar(page);

  // eigen root-container, los van de oude statische structuur
  let root = document.getElementById('t2-root');
  if (!root) { root = document.createElement('div'); root.id = 't2-root'; page.appendChild(root); }
  const oud = [...page.children].filter(el => el.id !== 't2-root' && el.id !== 't2-schakelaar');

  if (gebruikNieuw()) {
    oud.forEach(el => el.style.display = 'none');
    root.style.display = '';
    await laadHuidig();
    render();
  } else {
    root.style.display = 'none';
    oud.forEach(el => el.style.display = '');
    renderToernooi(); // Oud-stand: de oude module tekent, ongewijzigd
  }
}

function renderSchakelaar(page) {
  const bestaat = document.getElementById('t2-schakelaar');
  if (!isBeheerderRol()) { if (bestaat) bestaat.remove(); return; }
  let bar = bestaat;
  if (!bar) { bar = document.createElement('div'); bar.id = 't2-schakelaar'; page.insertBefore(bar, page.firstChild); }
  const nieuw = gebruikNieuw();
  const knop = (aan, label, act) =>
    `<button onclick="t2Wissel(${aan})" style="padding:5px 14px;border-radius:20px;border:1.5px solid var(--green,#1f5c3a);cursor:pointer;font-weight:600;font-family:inherit;font-size:13px;${act ? 'background:var(--green,#1f5c3a);color:#fff' : 'background:#fff;color:var(--green,#1f5c3a)'}">${label}</button>`;
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 4px;font-size:12px;color:var(--mid)"><span style="text-transform:uppercase;letter-spacing:.04em">Toernooi-setup:</span>${knop(false, 'Oud', !nieuw)} ${knop(true, 'Nieuw', nieuw)}</div>`;
}
window.t2Wissel = function (nieuw) { try { localStorage.setItem(SETUP_KEY, nieuw ? 'true' : 'false'); } catch (e) {} routeToernooiTab(); };

// Enige render-entry voor de nieuwe module
function render() {
  const root = document.getElementById('t2-root');
  if (!root) return;
  if (!t) { root.innerHTML = `<div class="card"><p style="color:var(--mid)">Geen actief toernooi.</p></div>`; return; }
  root.innerHTML = stijl() + (t.status === 'actief' ? actiefHtml() : setupHtml());
}
export { render as renderToernooi2 };

function stijl() {
  return `<style>
    #t2-root .lab{display:block;font-size:12px;color:var(--mid);text-transform:uppercase;letter-spacing:.03em;margin:12px 0 5px}
    #t2-root .rij{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
    #t2-root .rij>div{flex:1;min-width:110px}
    #t2-root .check{display:flex;align-items:center;gap:12px;padding:10px 2px;font-size:15px;border-bottom:1px solid var(--border,#eee)}
    #t2-root .check input{width:20px;height:20px;flex:0 0 auto;margin:0}
    #t2-root .dag{border:1px solid var(--border,#d8ddd8);border-radius:8px;padding:14px;margin-bottom:12px}
    #t2-root .sp{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--border,#eee)}
    #t2-root .sp .nm{flex:1}
    #t2-root .in{padding:10px 12px;border:1.5px solid var(--border,#d8ddd8);border-radius:8px;font-size:15px;font-family:inherit;width:100%;box-sizing:border-box}
    #t2-root .btn{padding:10px 16px;border-radius:8px;border:1.5px solid var(--green,#1f5c3a);background:#fff;color:var(--green,#1f5c3a);font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
    #t2-root .btn-p{padding:13px 24px;border-radius:10px;border:none;background:var(--green,#1f5c3a);color:#fff;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit}
    #t2-root .x{border:none;background:#f4eaea;color:#b23b3b;border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:17px;flex:0 0 auto}
    #t2-root .card{padding:16px 18px}
    #t2-root table{width:100%;border-collapse:collapse;font-size:14px}
    #t2-root th,#t2-root td{padding:8px;border-bottom:1px solid var(--border,#eee);text-align:left}
    #t2-root td.n{text-align:right;font-variant-numeric:tabular-nums}
    #t2-root .score-in{width:46px;text-align:center;padding:8px 4px;border:1.5px solid var(--border,#d8ddd8);border-radius:8px;font-size:16px}
  </style>`;
}

// ============================================================
//  SETUP-VIEW
// ============================================================
function setupHtml() {
  const banen = Object.keys(alleBANEN());
  const magStart = magStarten();
  const startBtn = magStart
    ? `<button class="btn-p" onclick="t2Start()">Toernooi starten</button>`
    : `<button class="btn-p" disabled style="opacity:.5;cursor:not-allowed">Toernooi starten</button>
       <p style="font-size:12px;color:var(--gold);margin-top:8px">Starten kan pas op ${eersteDatum() ? esc(eersteDatum()) : 'de ingevulde datum'}.</p>`;
  return `
  <div class="card"><div class="card-header"><h2>Nieuw toernooi</h2></div>
    <p style="font-size:12px;color:var(--mid);margin-bottom:4px">Alles hoort bij dit toernooi en wordt doorlopend bewaard.</p>
    <label class="lab">Naam</label>
    <input class="in" type="text" value="${escAttr(t.naam)}" oninput="t2Set('naam', this.value)" placeholder="Toernooinaam">
    <label class="lab">Modus</label>
    <select class="in" onchange="t2Set('modus', this.value)">
      ${['matchplay', 'amerikaantje', 'high-low'].map(m => `<option value="${m}" ${t.modus === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select>
    <div class="rij" style="margin-top:8px">
      <div><label class="lab">Punt winst</label><input class="in" type="number" value="${t.ptWin}" onchange="t2Set('ptWin', +this.value)"></div>
      <div><label class="lab">Punt gelijk</label><input class="in" type="number" value="${t.ptTie}" onchange="t2Set('ptTie', +this.value)"></div>
      <div><label class="lab">Punt verlies</label><input class="in" type="number" value="${t.ptLoss}" onchange="t2Set('ptLoss', +this.value)"></div>
      <div><label class="lab">HCP %</label><input class="in" type="number" value="${Math.round((t.hcpPct || 0) * 100)}" onchange="t2SetHcpPct(this.value)"></div>
    </div>
  </div>

  <div class="card"><div class="card-header"><h2>Telt voor ladder</h2></div>
    ${(alleLadders || []).map(l => `<div class="check"><input type="checkbox" ${t.rankingLadderIds.includes(l.id) ? 'checked' : ''} onchange="t2Ranking('${escAttr(l.id)}', this.checked)"><span>${esc(l.naam || l.id)}</span></div>`).join('') || '<p style="color:var(--mid)">Geen ladders.</p>'}
  </div>

  <div class="card"><div class="card-header"><h2>Dagen</h2></div>
    ${t.dagen.map((dg, i) => dagBlok(dg, i, banen)).join('')}
    <button class="btn" onclick="t2VoegDag()">+ Dag toevoegen</button>
  </div>

  <div class="card"><div class="card-header"><h2>Spelers (${t.spelers.length})</h2></div>
    <label class="lab">Kies uit ladder</label>
    <div class="rij">
      <div><select class="in" onchange="t2Bron(this.value)">${(alleLadders || []).map(l => `<option value="${escAttr(l.id)}" ${l.id === bronLadderId ? 'selected' : ''}>${esc(l.naam || l.id)}</option>`).join('')}</select></div>
      <div><select class="in" onchange="t2VoegSpeler(this.value); this.value='';"><option value="">— kies speler —</option>${beschikbaar().map(s => `<option value="${escAttr(s.uid)}">${esc(s.naam)}${s.hcp != null ? ' (hcp ' + s.hcp + ')' : ''}</option>`).join('')}</select></div>
    </div>
    <label class="lab">Of gastspeler</label>
    <div class="rij">
      <div><input class="in" id="t2-gnaam" type="text" placeholder="Naam gast"></div>
      <div style="max-width:110px"><input class="in" id="t2-ghcp" type="number" placeholder="HCP"></div>
      <div style="flex:0 0 auto"><button class="btn" onclick="t2VoegGast()">+ Gast</button></div>
    </div>
    <div style="margin-top:14px">
      ${t.spelers.map((s, i) => `<div class="sp"><span class="nm">${esc(s.naam)}${s.gast ? ' <em style="color:var(--mid)">(gast)</em>' : ''}</span><input class="in" style="max-width:90px" type="number" value="${s.hcp ?? ''}" onchange="t2SpelerHcp(${i}, +this.value)"><button class="x" onclick="t2VerwijderSpeler(${i})">×</button></div>`).join('') || '<p style="color:var(--mid)">Nog geen spelers.</p>'}
    </div>
  </div>

  <div class="card">${startBtn}
    <button class="btn" onclick="t2Annuleer()" style="margin-left:10px">Annuleren</button>
    <p style="font-size:11px;color:var(--mid);margin-top:10px">Status: ${esc(t.status)}${t.id ? ' · opgeslagen' : ''}</p>
  </div>`;
}
function dagBlok(dg, i, banen) {
  const handmatig = dg.baan && !banen.includes(dg.baan);
  return `<div class="dag"><div class="rij">
    <div><label class="lab">Datum dag ${dg.dagNr}</label><input class="in" type="date" value="${escAttr(dg.datum)}" onchange="t2Dag(${i},'datum',this.value)"></div>
    <div><label class="lab">Baan</label><select class="in" onchange="t2DagBaan(${i}, this.value)"><option value="">— kies baan —</option>${banen.map(bn => `<option value="${escAttr(bn)}" ${dg.baan === bn ? 'selected' : ''}>${esc(bn)}</option>`).join('')}<option value="__hm__" ${handmatig ? 'selected' : ''}>+ Handmatig</option></select></div>
    ${t.dagen.length > 1 ? `<div style="flex:0 0 auto"><button class="x" onclick="t2VerwijderDag(${i})">×</button></div>` : ''}
  </div>${handmatig ? `<input class="in" style="margin-top:10px" type="text" value="${escAttr(dg.baan)}" placeholder="Baannaam" onchange="t2Dag(${i},'baan',this.value)">` : ''}</div>`;
}

// ============================================================
//  ACTIEVE VIEW — scorekaart + ranglijst + afsluiten
// ============================================================
function actiefHtml() {
  const dagNr = t.actiefDagNr || 1;
  const dag = t.dagen[dagNr - 1] || t.dagen[0];
  const coord = isBeheerderRol() || isCoordinatorRol();
  const mijnUid = huidigeBruiker?.uid;
  const mijnSpeler = (t.spelers || []).find(s => s.uid === mijnUid);

  let html = `<div class="card"><div class="card-header"><h2>${esc(t.naam)}</h2></div>
    <p style="font-size:13px;color:var(--mid)">${esc(dag?.datum || '')} · ${esc(dag?.baan || '')} · dag ${dagNr}/${t.dagen.length}</p></div>`;

  // Scorekaart voor een deelnemer (eigen scores invoeren)
  if (mijnSpeler && dag && !dag.afgerond) {
    const sc = scoresVoorDag(dag);
    const mijn = sc[mijnUid] || [];
    html += `<div class="card"><div class="card-header"><h2>⛳ Jouw scorekaart</h2></div>
      <table><thead><tr><th>Hole</th><th>Par</th><th>Score</th></tr></thead><tbody>
      ${dag.holes.map((h, i) => `<tr><td>${i + 1}</td><td>${h.par}</td><td><input class="score-in" type="number" inputmode="numeric" value="${mijn[i] != null ? mijn[i] : ''}" onchange="t2Score(${i}, this.value)"></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // Ranglijst (iedereen)
  const tot = berekenTotaal(t);
  const rij = t.spelers.map((s, i) => ({ s, pt: tot.punten[i], w: tot.won[i], ti: tot.tied[i], l: tot.lost[i] }))
    .sort((a, b) => b.pt - a.pt || b.w - a.w);
  html += `<div class="card"><div class="card-header"><h2>Ranglijst</h2></div>
    <table><thead><tr><th>#</th><th>Speler</th><th class="n">W-T-V</th><th class="n">Punten</th></tr></thead><tbody>
    ${rij.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.s.naam)}</td><td class="n">${r.w}-${r.ti}-${r.l}</td><td class="n"><strong>${r.pt}</strong></td></tr>`).join('')}
    </tbody></table></div>`;

  // Coördinator-acties
  if (coord) {
    html += `<div class="card">
      ${!dag.afgerond ? `<button class="btn" onclick="t2DagAfsluiten(${dagNr})">Dag ${dagNr} afsluiten</button>` : `<span style="color:var(--mid)">Dag ${dagNr} afgerond.</span>`}
      ${dagNr < t.dagen.length ? `<button class="btn" onclick="t2SelecteerDag(${dagNr + 1})" style="margin-left:8px">Naar dag ${dagNr + 1}</button>` : ''}
      <button class="btn-p" onclick="t2ToernooiAfsluiten()" style="margin-left:8px">Toernooi afsluiten${(t.rankingLadderIds && t.rankingLadderIds.length) ? ' & ladder bijwerken' : ''}</button>
    </div>`;
  }
  return html;
}

// ============================================================
//  HELPERS setup
// ============================================================
function eersteDatum() { return t?.dagen?.[0]?.datum || ''; }
function magStarten() {
  const d = eersteDatum(); if (!d) return false;
  const v = new Date(); v.setHours(0, 0, 0, 0); const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  return !isNaN(dd.getTime()) && dd <= v;
}
function beschikbaar() {
  if (!bronLadderId) return [];
  let pool = []; try { pool = getLadderSpelers(bronLadderId) || []; } catch (e) {}
  const g = new Set(t.spelers.map(s => s.uid));
  return pool.filter(s => s.uid && !g.has(s.uid));
}
function autoFlights(spelers) {
  const per = 4, f = [], ids = spelers.map(s => s.uid);
  for (let i = 0; i < ids.length; i += per) f.push({ id: f.length + 1, naam: 'Flight ' + (f.length + 1), spelerIds: ids.slice(i, i + per), starttijd: '09:00', starthole: 1 });
  if (!f.length) f.push({ id: 1, naam: 'Flight 1', spelerIds: [], starttijd: '09:00', starthole: 1 });
  return f;
}

// ============================================================
//  HANDLERS
// ============================================================
window.t2Set = function (v, w) { t[v] = w; opslaanDebounced(); };
window.t2SetHcpPct = function (v) { t.hcpPct = (parseFloat(v) || 0) / 100; opslaanDebounced(); };
window.t2Ranking = function (id, aan) {
  const set = new Set(t.rankingLadderIds); if (aan) set.add(id); else set.delete(id);
  t.rankingLadderIds = [...set]; t.ladderId = t.rankingLadderIds[0] || null; opslaanDebounced();
};
window.t2Dag = function (i, v, w) { if (t.dagen[i]) { t.dagen[i][v] = w; opslaanDebounced(); if (v === 'datum') render(); } };
window.t2DagBaan = function (i, v) {
  if (!t.dagen[i]) return; const B = alleBANEN();
  if (v === '__hm__') { t.dagen[i].baan = (t.dagen[i].baan && !B[t.dagen[i].baan]) ? t.dagen[i].baan : 'Nieuwe baan'; }
  else { t.dagen[i].baan = v; const h = B[v] && B[v].holes; if (Array.isArray(h) && h.length) t.dagen[i].holes = h; }
  opslaan(true);
};
window.t2VoegDag = function () { t.dagen.push(nieuweDag(t.dagen.length + 1)); opslaan(true); };
window.t2VerwijderDag = function (i) { t.dagen.splice(i, 1); t.dagen.forEach((d, x) => d.dagNr = x + 1); opslaan(true); };
window.t2Bron = function (id) { bronLadderId = id; render(); };
window.t2VoegSpeler = function (uid) {
  if (!uid || t.spelers.some(s => s.uid === uid)) return;
  const s = beschikbaar().find(p => p.uid === uid); if (!s) return;
  t.spelers.push({ uid: s.uid, naam: s.naam || s.uid, hcp: s.hcp ?? 0, gast: false }); opslaan(true);
};
window.t2VoegGast = function () {
  const naam = document.getElementById('t2-gnaam')?.value.trim(); const hcp = +(document.getElementById('t2-ghcp')?.value || 0);
  if (!naam) { toast('Vul een naam in'); return; }
  t.spelers.push({ uid: 'gast_' + Math.random().toString(36).slice(2, 10), naam, hcp, gast: true }); opslaan(true);
};
window.t2SpelerHcp = function (i, h) { if (t.spelers[i]) { t.spelers[i].hcp = h; opslaanDebounced(); } };
window.t2VerwijderSpeler = function (i) { t.spelers.splice(i, 1); opslaan(true); };

window.t2Start = async function () {
  if (!t.naam.trim()) { toast('Geef het toernooi een naam'); return; }
  if (!magStarten()) { toast('Kan pas starten op ' + (eersteDatum() || 'de datum')); return; }
  if (t.spelers.length < 2) { toast('Minimaal 2 spelers nodig'); return; }
  t.dagen.forEach(dg => { if (!dg.flights || !dg.flights.length) dg.flights = autoFlights(t.spelers); });
  t.status = 'actief'; t.toernooiModus = true; t.timestamp = Date.now();
  await opslaan(); await herlaadToernooien(); toast('Toernooi gestart'); render();
};
window.t2Annuleer = async function () {
  if (!confirm('Dit toernooi annuleren?')) return;
  if (t.id) { t.status = 'geannuleerd'; await opslaan(); }
  await herlaadToernooien(); await laadHuidig(); render();
};

// --- Score-invoer deelnemer: schrijft eigen live/{uid} ---
window.t2Score = async function (holeIdx, waarde) {
  const uid = huidigeBruiker?.uid; if (!uid || !t?.id) return;
  const dagNr = t.actiefDagNr || 1;
  const huidig = (liveCache[uid] && liveCache[uid].dagNr === dagNr && Array.isArray(liveCache[uid].scores))
    ? liveCache[uid].scores.slice() : new Array((t.dagen[dagNr - 1]?.holes.length) || 18).fill(null);
  const val = waarde === '' ? null : parseInt(waarde, 10);
  huidig[holeIdx] = (val != null && !isNaN(val)) ? val : null;
  liveCache[uid] = { dagNr, scores: huidig, timestamp: Date.now() };
  try { await setDoc(doc(db, 'toernooien', t.id, 'live', uid), liveCache[uid]); }
  catch (e) { console.error('Score opslaan mislukt:', e); toast('Score opslaan mislukt'); }
};

window.t2SelecteerDag = function (nr) { t.actiefDagNr = nr; opslaan(true); };

window.t2DagAfsluiten = async function (dagNr) {
  if (!confirm(`Dag ${dagNr} afsluiten? Scores worden vastgezet.`)) return;
  const dag = t.dagen[dagNr - 1]; if (!dag) return;
  // consolideer live → dag.scores
  dag.scores = scoresVoorDag(dag);
  dag.afgerond = true; dag.uitslagZichtbaar = true;
  await opslaan(); toast(`Dag ${dagNr} afgesloten`); render();
};

window.t2ToernooiAfsluiten = async function () {
  if (!confirm('Toernooi afsluiten' + ((t.rankingLadderIds && t.rankingLadderIds.length) ? ' en de ladder bijwerken?' : '?'))) return;
  // zorg dat alle dagscores geconsolideerd zijn
  t.dagen.forEach(dag => { dag.scores = scoresVoorDag(dag); });
  const tot = berekenTotaal(t);
  const deeln = t.spelers.map((s, i) => ({ s, pt: tot.punten[i], w: tot.won[i] }));

  const rankingLadderIds = (t.rankingLadderIds && t.rankingLadderIds.length) ? t.rankingLadderIds : (t.ladderId ? [t.ladderId] : []);
  for (const ladderId of rankingLadderIds) {
    try { await updateLadder(ladderId, deeln); }
    catch (e) { console.error('Ladder-update mislukt voor', ladderId, e); toast('Ladder-update mislukt: ' + (e.code || e.message)); }
  }

  // archiveren (voegt toe, wist niet — merge)
  try {
    const archRef = doc(db, 'ladder', 'archief');
    const snap = await getDoc(archRef);
    const bestaand = snap.exists() ? (snap.data().toernooien || []) : [];
    const n = t.spelers.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(null));
    (t.dagen || []).forEach(dag => { const r = berekenDagPunten(t, dag); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (r.matrix[i][j]) matrix[i][j] = r.matrix[i][j]; });
    bestaand.unshift({ naam: t.naam, dagen: t.dagen, ranglijst: deeln.sort((a, b) => b.pt - a.pt).map(e => ({ naam: e.s.naam, punten: e.pt, won: e.w })), spelerNamen: t.spelers.map(s => s.naam), matrix, ptWin: t.ptWin, ptTie: t.ptTie, ptLoss: t.ptLoss, timestamp: Date.now() });
    await setDoc(archRef, { toernooien: bestaand }, { merge: true });
  } catch (e) { console.warn('Archiveren mislukt:', e); }

  t.status = 'afgerond'; t.uitslagZichtbaar = true;
  await opslaan(); await herlaadToernooien();
  toast('Toernooi afgesloten'); await laadHuidig(); render();
};

// Ladder-update: exact als de bestaande app
async function updateLadder(ladderId, deelnemersRaw) {
  const ladderSnap = await getDoc(doc(db, 'ladders', ladderId));
  if (!ladderSnap.exists()) return;
  const spelerIds = new Set(ladderSnap.data().spelerIds || []);
  const stSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
  const standenMap = {}; stSnap.docs.forEach(d => { standenMap[d.id] = { uid: d.id, ...d.data() }; });

  const deelnemers = deelnemersRaw.filter(e => !e.s.gast && e.s.uid && spelerIds.has(e.s.uid) && standenMap[e.s.uid]);
  if (!deelnemers.length) return;

  Object.values(standenMap).forEach(s => { s.prevRank = s.rank; });
  const maxRank = Object.keys(standenMap).length;
  [...deelnemers].sort((a, b) => b.pt - a.pt).forEach(e => {
    const sp = standenMap[e.s.uid]; if (!sp) return; const pt = e.pt || 0; if (pt === 0) return;
    const oud = sp.rank, nieuw = Math.max(1, Math.min(maxRank, oud - pt));
    if (nieuw === oud) return;
    if (nieuw < oud) Object.values(standenMap).forEach(s => { if (s.uid !== sp.uid && s.rank >= nieuw && s.rank < oud) s.rank++; });
    else Object.values(standenMap).forEach(s => { if (s.uid !== sp.uid && s.rank > oud && s.rank <= nieuw) s.rank--; });
    sp.rank = nieuw;
  });
  deelnemers.forEach(e => { const sp = standenMap[e.s.uid]; if (sp) { sp.partijen = (sp.partijen || 0) + (deelnemers.length - 1); sp.gewonnen = (sp.gewonnen || 0) + (e.w || 0); } });
  Object.values(standenMap).sort((a, b) => a.rank - b.rank).forEach((s, i) => { s.rank = i + 1; });

  await Promise.all(Object.values(standenMap).map(sp => {
    const payload = { rank: sp.rank || 0, partijen: sp.partijen || 0, gewonnen: sp.gewonnen || 0 };
    if (sp.prevRank != null) payload.prevRank = sp.prevRank;
    return setDoc(doc(db, 'ladders', ladderId, 'standen', sp.uid), payload).catch(err => console.warn('standen sync mislukt', sp.uid, err.code));
  }));
  try { await slaSnapshotOp(`🏅 Na toernooi: ${t.naam}`, ladderId); } catch (e) { console.warn('Snapshot mislukt:', e); }
}
