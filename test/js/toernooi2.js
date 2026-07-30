// ============================================================
//  toernooi2.js — NIEUWBOUW toernooi-setup ("één blad"-model)
//  Principe: één toernooi-object is de enige waarheid.
//  - Elk invoerelement schrijft direct in dat object (het blad).
//  - Het scherm leest alleen het blad; een re-render kan niets wissen.
//  - Concept wordt doorlopend opgeslagen → gaat niet verloren.
//  - Datum is startvoorwaarde: starten kan niet vóór de datum.
//  Schrijft in het bestaande toernooien-documentformaat, zodat de
//  actieve fase (scorekaart/scoring/ranglijst/afsluiten) door de
//  bestaande, bewezen code (renderToernooiActief) wordt afgehandeld.
// ============================================================

import { db, esc, escAttr } from './config.js';
import { alleLadders, huidigeBruiker, alleToernooien } from './store.js';
import { isBeheerderRol, isCoordinatorRol, toast } from './auth.js';
import { getLadderSpelers } from './ladder-view.js';
import { renderToernooiActief, herlaadToernooien } from './toernooi.js';
import { doc, setDoc, getDoc, getDocs, collection, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- Blad-state (in opbouw) ----
let blad = null;
let bewaarTimer = null;

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
    if (!blad.id) {
      // eerste opslag: bepaal een id en schrijf met dat id als documentnaam
      const ref = doc(collection(db, 'toernooien'));
      blad.id = ref.id;
    }
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

// ---- Startvoorwaarde: datum ----
function eersteDatum() { return blad?.dagen?.[0]?.datum || ''; }
function magStarten() {
  const d = eersteDatum();
  if (!d) return false;
  const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  return !isNaN(dd.getTime()) && dd <= vandaag;
}

// ---- Flights automatisch indelen bij start (indien leeg) ----
function autoFlights(spelers) {
  const groepGrootte = 4;
  const flights = [];
  const ids = spelers.map(s => s.uid);
  for (let i = 0; i < ids.length; i += groepGrootte) {
    flights.push({
      id: flights.length + 1,
      naam: 'Flight ' + (flights.length + 1),
      spelerIds: ids.slice(i, i + groepGrootte),
      starttijd: '09:00', starthole: 1
    });
  }
  if (!flights.length) flights.push({ id: 1, naam: 'Flight 1', spelerIds: [], starttijd: '09:00', starthole: 1 });
  return flights;
}

// ============================================================
//  ENTRY: renderToernooi2 — vervangt de Toernooi-tab
// ============================================================
export function renderToernooi2() {
  const page = document.getElementById('page-toernooi');
  if (!page) return;

  // Actief toernooi (door mij gespeeld of beheerd) → bestaande, bewezen weergave
  const uid = huidigeBruiker?.uid;
  const actief = (alleToernooien || []).find(t => t.status === 'actief' &&
    ((t.spelers || []).some(s => s.uid === uid) || isCoordinatorRol() || isBeheerderRol()));
  if (actief) {
    renderToernooiActief();
    return;
  }

  // Geen actief toernooi
  if (!isBeheerderRol() && !isCoordinatorRol()) {
    page.innerHTML = `<div class="card"><p style="color:var(--mid)">Geen actief toernooi.</p></div>`;
    return;
  }

  // Beheerder/coördinator zonder actief toernooi → nieuwbouw-setup
  if (!blad) blad = leegBlad();
  page.innerHTML = setupHtml();
}

// ============================================================
//  SETUP-SCHERM — leest uitsluitend het blad
// ============================================================
function setupHtml() {
  const b = blad;
  const startBlok = magStarten()
    ? `<button class="btn-primary" onclick="t2Start()">Toernooi starten</button>`
    : `<button class="btn-primary" disabled title="Kan pas starten op de toernooidatum">Toernooi starten</button>
       <p style="font-size:12px;color:var(--gold);margin-top:6px">Starten kan pas op ${eersteDatum() ? esc(eersteDatum()) : 'de ingevulde datum'}.</p>`;

  return `
  <style>
    #page-toernooi .veld-label{display:block;font-size:12px;color:var(--mid);text-transform:uppercase;letter-spacing:.03em;margin:10px 0 4px}
    #page-toernooi .veld-rij{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start}
    #page-toernooi .veld-rij>div{flex:1;min-width:120px}
    #page-toernooi .checkbox-rij{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:15px}
    #page-toernooi .dag-blok{border:1px solid var(--border,#d8ddd8);border-radius:8px;padding:10px;margin-bottom:10px}
    #page-toernooi .speler-rij{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border,#eee)}
    #page-toernooi .speler-rij span{flex:1}
    #page-toernooi .btn-secondary{padding:8px 14px;border-radius:8px;border:1.5px solid var(--green,#1f5c3a);background:#fff;color:var(--green,#1f5c3a);font-weight:600;cursor:pointer;font-family:inherit}
    #page-toernooi .btn-mini{border:none;background:#f0efe8;color:#b23b3b;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:16px}
    #page-toernooi input,#page-toernooi select{padding:9px 11px;border:1.5px solid var(--border,#d8ddd8);border-radius:8px;font-size:15px;font-family:inherit;width:100%}
  </style>
  <div class="card">
    <div class="card-header"><h2>Nieuw toernooi</h2></div>
    <p style="font-size:12px;color:var(--mid);margin-bottom:12px">Alles wat je invult hoort bij dit toernooi en wordt doorlopend bewaard.</p>

    <label class="veld-label">Naam</label>
    <input type="text" value="${escAttr(b.naam)}" oninput="t2Set('naam', this.value)" placeholder="Toernooinaam">

    <label class="veld-label">Modus</label>
    <select onchange="t2Set('modus', this.value)">
      ${['matchplay', 'amerikaantje', 'high-low'].map(m =>
        `<option value="${m}" ${b.modus === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select>

    <div class="veld-rij">
      <div><label class="veld-label">Punt winst</label><input type="number" value="${b.ptWin}" onchange="t2Set('ptWin', +this.value)"></div>
      <div><label class="veld-label">Punt gelijk</label><input type="number" value="${b.ptTie}" onchange="t2Set('ptTie', +this.value)"></div>
      <div><label class="veld-label">Punt verlies</label><input type="number" value="${b.ptLoss}" onchange="t2Set('ptLoss', +this.value)"></div>
      <div><label class="veld-label">HCP %</label><input type="number" value="${b.hcpPct}" onchange="t2Set('hcpPct', +this.value)"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h2>Telt voor ladder</h2></div>
    ${(alleLadders || []).map(l => `
      <label class="checkbox-rij">
        <input type="checkbox" ${b.rankingLadderIds.includes(l.id) ? 'checked' : ''}
               onchange="t2RankingLadder('${escAttr(l.id)}', this.checked)">
        ${esc(l.naam || l.id)}
      </label>`).join('') || '<p style="color:var(--mid)">Geen ladders beschikbaar.</p>'}
  </div>

  <div class="card">
    <div class="card-header"><h2>Dagen</h2></div>
    ${b.dagen.map((dg, i) => dagBlokHtml(dg, i)).join('')}
    <button class="btn-secondary" onclick="t2VoegDagToe()">+ Dag toevoegen</button>
  </div>

  <div class="card">
    <div class="card-header"><h2>Spelers (${b.spelers.length})</h2></div>
    <div class="veld-rij">
      <select id="t2-ladder-keuze">
        <option value="">— kies ladder om spelers te laden —</option>
        ${(alleLadders || []).map(l => `<option value="${escAttr(l.id)}">${esc(l.naam || l.id)}</option>`).join('')}
      </select>
      <button class="btn-secondary" onclick="t2LaadSpelersUitLadder()">Laden</button>
    </div>
    <div class="veld-rij" style="margin-top:8px">
      <input type="text" id="t2-gast-naam" placeholder="Gastspeler naam">
      <input type="number" id="t2-gast-hcp" placeholder="HCP" style="max-width:90px">
      <button class="btn-secondary" onclick="t2VoegGastToe()">+ Gast</button>
    </div>
    <div style="margin-top:10px">
      ${b.spelers.map((s, i) => `
        <div class="speler-rij">
          <span>${esc(s.naam)}${s.gast ? ' <em style="color:var(--mid)">(gast)</em>' : ''}</span>
          <input type="number" value="${s.hcp ?? ''}" style="max-width:80px" onchange="t2SpelerHcp(${i}, +this.value)" title="HCP">
          <button class="btn-mini" onclick="t2VerwijderSpeler(${i})">×</button>
        </div>`).join('') || '<p style="color:var(--mid)">Nog geen spelers.</p>'}
    </div>
  </div>

  <div class="card">
    ${startBlok}
    <button class="btn-secondary" onclick="t2Annuleer()" style="margin-left:8px">Annuleren</button>
    <p style="font-size:11px;color:var(--mid);margin-top:8px">Status: ${esc(blad.status)}${blad.id ? ' · opgeslagen' : ''}</p>
  </div>`;
}

function dagBlokHtml(dg, i) {
  return `
  <div class="dag-blok">
    <div class="veld-rij">
      <div><label class="veld-label">Datum dag ${dg.dagNr}</label>
        <input type="date" value="${escAttr(dg.datum)}" onchange="t2DagSet(${i}, 'datum', this.value)"></div>
      <div><label class="veld-label">Baan</label>
        <input type="text" value="${escAttr(dg.baan)}" onchange="t2DagSet(${i}, 'baan', this.value)"></div>
      ${blad.dagen.length > 1 ? `<button class="btn-mini" onclick="t2VerwijderDag(${i})" style="align-self:end">×</button>` : ''}
    </div>
  </div>`;
}

// ============================================================
//  HANDLERS (window) — elk schrijft in het blad + bewaart
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
  if (veld === 'datum') renderToernooi2(); // startknop hangt van datum af
};

window.t2VoegDagToe = function () {
  blad.dagen.push(nieuweDag(blad.dagen.length + 1));
  bewaarBlad(true);
};
window.t2VerwijderDag = function (i) {
  blad.dagen.splice(i, 1);
  blad.dagen.forEach((d, idx) => d.dagNr = idx + 1);
  bewaarBlad(true);
};

window.t2LaadSpelersUitLadder = async function () {
  const lid = document.getElementById('t2-ladder-keuze')?.value;
  if (!lid) { toast('Kies eerst een ladder'); return; }
  try {
    const spelers = await getLadderSpelers(lid); // [{uid,naam,hcp,...}]
    const bestaand = new Set(blad.spelers.map(s => s.uid));
    (spelers || []).forEach(s => {
      if (s.uid && !bestaand.has(s.uid)) {
        blad.spelers.push({ uid: s.uid, naam: s.naam || s.uid, hcp: s.hcp ?? 0, gast: false });
      }
    });
    await bewaarBlad(true);
  } catch (e) {
    console.error(e); toast('Spelers laden mislukt: ' + (e.code || e.message));
  }
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
  renderToernooi2();
};

window.t2Annuleer = async function () {
  if (!confirm('Dit concept annuleren?')) return;
  if (blad.id) {
    blad.status = 'geannuleerd';
    await bewaarBlad();
  }
  blad = null;
  renderToernooi2();
};

// ---- Concept terugladen (optioneel: laatste concept van deze gebruiker) ----
export async function laadLaatsteConcept() {
  try {
    const snap = await getDocs(query(collection(db, 'toernooien'), where('status', '==', 'concept')));
    if (!snap.empty) {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      blad = docs[0];
    }
  } catch (e) { console.warn('Concept laden mislukt:', e); }
}
