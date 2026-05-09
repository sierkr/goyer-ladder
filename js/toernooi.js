// ============================================================
//  toernooi.js — v3.0.0-11.45
//  Meerdaags toernooi: scores/flights/baan per dag
//  Datastructuur: t.dagen[dagNr-1].{datum,baan,holes,flights,scores,afgerond}
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, esc, escAttr } from './config.js';
import { store, alleLadders, activeLadderId, alleSpelersData, huidigeBruiker, archiefData, toernooiData, alleToernooien, actieveToernooiId, _vasteListeners, _toernooiListeners, _tGeselecteerdeSpelers, _tSpelersLadderIds, _tRankingLadderIds, _flights } from './store.js';
import { slaActievePartijenOp, getLadderData, getLadderConfig, getUsers, saveUsers, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { renderHcpBlok, alleBANEN, renderHandmatigHoles } from './partij.js';
import { renderLadder } from './ladder.js';
import { slaSnapshotOp } from './beheer.js';
import { toggleAdminKaart } from './knockout.js';
import { getLadderSpelers } from './ladder-view.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';

// ============================================================
//  HELPERS — dag-abstractie
// ============================================================

// Geeft de actieve dag terug (object uit t.dagen[])
function actieveDag(t) {
  t = t || toernooiData;
  if (!t) return null;
  const dagNr = t.actiefDagNr || 1;
  return (t.dagen || [])[dagNr - 1] || null;
}

// Geeft dag op basis van dagNr (1-based)
function getDag(t, dagNr) {
  return (t.dagen || [])[dagNr - 1] || null;
}

// Sla de actieve toernooiData op in Firestore (debounced via optionele delay)
async function slaToernooiOp(delay) {
  if (!actieveToernooiId) return;
  if (delay) {
    clearTimeout(window._tSaveTimer);
    window._tSaveTimer = setTimeout(async () => {
      try { await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData))); }
      catch(e) { console.error('Score opslaan mislukt:', e); }
    }, delay);
  } else {
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
  }
}

// ============================================================
//  RENDER TOERNOOI (hoofd)
// ============================================================
function renderToernooi() {
  const isBeheerder = isCoordinatorRol();
  const uid = huidigeBruiker?.uid;

  const mijnToernooien = isBeheerder
    ? alleToernooien
    : alleToernooien.filter(t =>
        uid && (t.spelers || []).some(s => s.uid === uid)
      );

  const wrap = document.getElementById('toernooi-actief-wrap');
  const setup = document.getElementById('toernooi-setup-wrap');

  if (isBeheerder) {
    setup.style.display = 'block';
    initToernooiSetup();
  } else {
    setup.style.display = 'none';
  }

  if (mijnToernooien.length > 0) {
    wrap.style.display = 'block';

    let html = '';
    if (isBeheerder && mijnToernooien.length > 1) {
      html += `<div style="display:flex;gap:8px;overflow-x:auto;padding:12px 16px;border-bottom:1px solid var(--border);scrollbar-width:none">`;
      mijnToernooien.forEach(t => {
        const actief = t.id === actieveToernooiId;
        html += `<button onclick="selecteerToernooi('${escAttr(t.id)}')" style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1.5px solid ${actief ? 'var(--green)' : 'var(--border)'};background:${actief ? 'var(--green)' : 'white'};color:${actief ? 'white' : 'var(--dark)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">${esc(t.naam)}</button>`;
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

// ============================================================
//  SPELER LIVE SCORE OPSLAAN — v3.0.0-11.68
// ============================================================
// Spelers mogen het hoofddocument (toernooien/{id}) niet schrijven.
// Ze schrijven hun eigen scores naar de subcollectie toernooien/{id}/live/{uid}.
// De coordinator-onSnapshot listener pikt dit op en mergt de scores
// in het hoofddocument.
async function slaSpelerScoreOp(uid, dagNr, scores) {
  if (!actieveToernooiId || !uid) return;
  clearTimeout(window._tSpelerSaveTimer);
  window._tSpelerSaveTimer = setTimeout(async () => {
    try {
      await setDoc(
        doc(db, 'toernooien', actieveToernooiId, 'live', uid),
        { dagNr, scores, timestamp: Date.now() }
      );
    } catch(e) {
      console.error('Speler score opslaan mislukt:', e);
    }
  }, 800);
}

// ============================================================
//  BAAN SELECTOR IN TOERNOOI SETUP
// ============================================================

// Per dag-blok: onchange handler voor de baan-select
function onTDagBaanSelect(sel, dagNr) {
  const hw = document.getElementById(`t-baan-handmatig-${dagNr}`);
  if (!hw) return;
  if (sel.value === 'Handmatig invoeren') {
    hw.style.display = 'block';
    // Tijdelijk actieve dag-context opslaan zodat slaAangepasteBaanOp het juiste blok weet
    window._activeTDagNr = dagNr;
    renderHandmatigHoles(`toernooi-${dagNr}`);
  } else {
    hw.style.display = 'none';
  }
}
window.onTDagBaanSelect = onTDagBaanSelect;

window.addEventListener('baanToegevoegd', (e) => {
  const naam = e.detail?.naam;
  // Verberg alle open handmatig-containers
  document.querySelectorAll('[id^="t-baan-handmatig-"]').forEach(el => { el.style.display = 'none'; });
  // Herlaad dag-blokken (vernieuwt baan-opties)
  renderDagBlokken();
  // Selecteer de nieuwe baan in alle dag-blokken (het blok dat de baan heeft aangemaakt)
  if (naam) {
    const dagNr = window._activeTDagNr;
    const container = document.getElementById('t-dag-blokken');
    if (container && dagNr) {
      const blokken = container.querySelectorAll('.dag-blok');
      const blok = blokken[dagNr - 1];
      if (blok) {
        const sel = blok.querySelector('.t-dag-baan');
        if (sel && [...sel.options].some(o => o.value === naam)) sel.value = naam;
      }
    }
    window._activeTDagNr = null;
  }
});

// ============================================================
//  HERLAAD TOERNOOIEN
// ============================================================
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
    if (toernooiData) store.actieveToernooiId = toernooiData.id;

    _toernooiListeners.forEach(unsub => unsub());
    store._toernooiListeners = [];

    // v3.0.0-11.68: als coordinator — luister naar live/{uid} subcollecties per toernooi.
    // Elke keer dat een speler een score opslaat, mergen we die in het hoofddocument.
    if (isCoordinatorRol()) {
      alleToernooien.forEach(t => {
        const liveUnsub = onSnapshot(
          collection(db, 'toernooien', t.id, 'live'),
          (liveSnap) => {
            if (!toernooiData || actieveToernooiId !== t.id) return;
            const dag = actieveDag(toernooiData);
            if (!dag || dag.afgerond) return;
            let gewijzigd = false;
            liveSnap.docs.forEach(liveDoc => {
              const { dagNr, scores } = liveDoc.data();
              if (dagNr !== toernooiData.actiefDagNr) return;
              const uid = liveDoc.id;
              if (!dag.scores) dag.scores = {};
              const huidig = JSON.stringify(dag.scores[uid] || []);
              const nieuw  = JSON.stringify(scores || []);
              if (huidig !== nieuw) {
                dag.scores[uid] = scores;
                gewijzigd = true;
              }
            });
            if (gewijzigd) {
              updateTTotaalRijInline();
              renderTMatrix();
              const btn = document.getElementById('t-refresh-btn');
              if (btn) btn.style.display = '';
              // Debounced wegschrijven naar hoofddocument
              clearTimeout(window._tLiveMergeTimer);
              window._tLiveMergeTimer = setTimeout(async () => {
                try {
                  await setDoc(doc(db, 'toernooien', actieveToernooiId),
                    JSON.parse(JSON.stringify(toernooiData)));
                } catch(e) { console.error('Live merge opslaan mislukt:', e); }
              }, 2000);
            }
          },
          (err) => { console.warn('live/ listener error:', err.code); }
        );
        store._toernooiListeners.push(liveUnsub);
      });
    }

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
            const dag = actieveDag(nieuweData);
            if (isBeheerder) {
              const oudScores = JSON.stringify(actieveDag(toernooiData)?.scores || {});
              const nieuwScores = JSON.stringify(dag?.scores || {});
              store.toernooiData = nieuweData;
              if (oudScores !== nieuwScores) {
                const btn = document.getElementById('t-refresh-btn');
                if (btn) btn.style.display = '';
                renderTMatrix();
              }
              const dagUitslag = dag?.afgerond || nieuweData.uitslagZichtbaar;
              if (dagUitslag || nieuweData.modus === 'strokeplay') renderTRanglijst();
            } else {
              const oudeMatrixIngeklapt = toernooiData?.matrixIngeklapt;
              const oudeUitslagZichtbaar = toernooiData?.uitslagZichtbaar;
              const oudeScoresVerborgen = toernooiData?.scoresVerborgen;
              store.toernooiData = nieuweData;

              // v3.0.0-11.68: herrender scorekaart als scoresVerborgen verandert
              if (nieuweData.scoresVerborgen !== oudeScoresVerborgen) {
                renderTScorecard();
              }

              if (nieuweData.matrixIngeklapt !== oudeMatrixIngeklapt) {
                const collapse = document.getElementById('t-matrix-collapse');
                const header = collapse?.previousElementSibling;
                if (collapse) collapse.classList.toggle('ingeklapt', !!nieuweData.matrixIngeklapt);
                if (header) header.classList.toggle('ingeklapt', !!nieuweData.matrixIngeklapt);
              }

              clearTimeout(window._matrixUpdateTimer);
              window._matrixUpdateTimer = setTimeout(() => renderTMatrix(), 2000);

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

// ============================================================
//  SETUP FORMULIER
// ============================================================
function initToernooiSetup() {
  // v3.0.0-11.39: dag-blokken initialiseren
  renderDagBlokken();

  const spelersLaddersEl = document.getElementById('t-spelers-ladders');
  if (spelersLaddersEl) {
    spelersLaddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;min-width:56px;text-align:center">
        <span>${esc(l.naam)}</span>
        <input type="checkbox" value="${escAttr(l.id)}" ${_tSpelersLadderIds.has(l.id) ? 'checked' : ''} onchange="toggleTSpelersLadder('${escAttr(l.id)}', this.checked)" style="accent-color:var(--green);width:18px;height:18px">
      </label>
    `).join('');
  }

  const rankingLaddersEl = document.getElementById('t-ranking-ladders');
  if (rankingLaddersEl) {
    rankingLaddersEl.innerHTML = alleLadders.map(l => `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;user-select:none;min-width:56px;text-align:center">
        <span>${esc(l.naam)}</span>
        <input type="checkbox" value="${escAttr(l.id)}" ${_tRankingLadderIds.has(l.id) ? 'checked' : ''} onchange="toggleTRankingLadder('${escAttr(l.id)}', this.checked)" style="accent-color:var(--green);width:18px;height:18px">
      </label>
    `).join('');
  }

  renderTGeselecteerdeSpelers();
}

// Rendert één dag-configuratie blok per dag
function renderDagBlokken() {
  const aantalDagen = parseInt(document.getElementById('t-aantal-dagen')?.value) || 1;
  const container   = document.getElementById('t-dag-blokken');
  if (!container) return;

  const banen = alleBANEN();
  const baanOpties = Object.keys(banen)
    .filter(n => n !== 'Handmatig invoeren')
    .map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`)
    .join('');

  // Bewaar bestaande waarden zodat wisselen van aantal dagen de invoer niet wist
  const bestaand = Array.from(container.querySelectorAll('.dag-blok')).map(blok => ({
    datum:  blok.querySelector('.t-dag-datum')?.value  || '',
    baan:   blok.querySelector('.t-dag-baan')?.value   || '',
    holes:  blok.querySelector('.t-dag-holes')?.value  || '18',
    hcust:  blok.querySelector('.t-dag-holes-custom')?.value || ''
  }));

  let html = '';
  for (let d = 1; d <= aantalDagen; d++) {
    const prev      = bestaand[d - 1] || {};
    const label     = aantalDagen > 1 ? `Dag ${d}` : 'Speeldag';
    const dagDatum  = prev.datum || '';
    const dagBaan   = prev.baan  || '';
    const dagHoles  = prev.holes || '18';
    const dagHcust  = prev.hcust || '';
    const showCust  = dagHoles === 'custom' ? '' : 'display:none';

    html += `
    <div class="dag-blok" style="border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
      ${aantalDagen > 1 ? `<div style="font-weight:700;font-size:13px;color:var(--green);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">${label}</div>` : ''}
      <div class="form-group" style="margin-bottom:10px">
        <label>Datum</label>
        <input type="date" class="t-dag-datum" value="${esc(dagDatum)}"
          ${d === 1 && !dagDatum ? `placeholder="${new Date().toISOString().split('T')[0]}"` : ''}>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Baan</label>
        <select class="t-dag-baan" onchange="onTDagBaanSelect(this, ${d})">
          ${baanOpties}
          <option value="Handmatig invoeren">+ Nieuwe baan toevoegen</option>
        </select>
        <div id="t-baan-handmatig-${d}" style="display:none;margin-top:10px">
          <div id="t-holes-handmatig-${d}"></div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label>Aantal holes</label>
        <select class="t-dag-holes" onchange="this.closest('.dag-blok').querySelector('.t-dag-holes-custom-wrap').style.display=this.value==='custom'?'block':'none'">
          <option value="18" ${dagHoles==='18'?'selected':''}>18 holes</option>
          <option value="9"  ${dagHoles==='9' ?'selected':''}>9 holes</option>
          <option value="custom" ${dagHoles==='custom'?'selected':''}>Aangepast...</option>
        </select>
        <div class="t-dag-holes-custom-wrap" style="${showCust};margin-top:6px">
          <input type="number" class="t-dag-holes-custom" min="1" max="18"
            placeholder="bijv. 12" style="text-align:center;width:80px" value="${esc(dagHcust)}">
        </div>
      </div>
    </div>`;
  }
  container.innerHTML = html;

  // Herstel baan-selectie (na innerHTML vervangen)
  const blokken = container.querySelectorAll('.dag-blok');
  blokken.forEach((blok, i) => {
    const prev = bestaand[i];
    if (prev?.baan) {
      const sel = blok.querySelector('.t-dag-baan');
      if (sel && [...sel.options].some(o => o.value === prev.baan)) {
        sel.value = prev.baan;
      }
    } else {
      // Default: De Goyer op dag 1, zelfde baan als dag 1 op volgende dagen
      const sel = blok.querySelector('.t-dag-baan');
      if (sel) {
        const deGoyer = [...sel.options].find(o => o.value === 'De Goyer');
        if (i === 0 && deGoyer) sel.value = 'De Goyer';
        else if (i > 0) {
          const dag1Baan = container.querySelector('.dag-blok .t-dag-baan')?.value;
          if (dag1Baan && [...sel.options].some(o => o.value === dag1Baan)) sel.value = dag1Baan;
        }
      }
    }
  });
}
window.renderDagBlokken = renderDagBlokken;

function toggleTSpelersLadder(ladderId, checked) {
  if (checked) _tSpelersLadderIds.add(ladderId);
  else _tSpelersLadderIds.delete(ladderId);
  if (_tSpelersLadderIds.size > 0) {
    const geldigeUids = new Set(
      alleLadders.filter(l => _tSpelersLadderIds.has(l.id))
        .flatMap(l => l.spelerIds || [])
    );
    store._tGeselecteerdeSpelers = _tGeselecteerdeSpelers.filter(s => s.gast || geldigeUids.has(s.uid));
  }
  renderTGeselecteerdeSpelers();
}

function toggleTRankingLadder(ladderId, checked) {
  if (checked) _tRankingLadderIds.add(ladderId);
  else _tRankingLadderIds.delete(ladderId);
}

function getToernooiSpelersPool() {
  // Gebruik alleSpelersData (uid-based) als bron, gefilterd op geselecteerde ladders
  const gezien = new Set();
  const spelers = [];
  const ladders = _tSpelersLadderIds.size > 0
    ? alleLadders.filter(l => _tSpelersLadderIds.has(l.id))
    : alleLadders;
  // Verzamel uids die in de geselecteerde ladders zitten
  const toegestaneUids = new Set(ladders.flatMap(l => l.spelerIds || []));
  alleSpelersData.forEach(s => {
    if (!s.uid || gezien.has(s.uid)) return;
    if (toegestaneUids.size > 0 && !toegestaneUids.has(s.uid)) return;
    gezien.add(s.uid);
    spelers.push({ uid: s.uid, naam: s.naam, hcp: s.hcp ?? 0 });
  });
  return spelers.sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));
}

function zoekToernooiSpeler(zoek) {
  const lijst = document.getElementById('t-speler-zoek-lijst');
  if (!lijst) return;
  const term = zoek.toLowerCase().trim();
  const geselecteerdeUids = new Set(store._tGeselecteerdeSpelers.map(s => s.uid));
  const pool = getToernooiSpelersPool().filter(s => !geselecteerdeUids.has(s.uid));
  const gefilterd = term ? pool.filter(s => s.naam.toLowerCase().includes(term)) : pool;

  if (gefilterd.length === 0) {
    lijst.innerHTML = `<div style="padding:10px 14px;font-size:13px;color:var(--light)">Geen spelers gevonden</div>`;
  } else {
    lijst.innerHTML = gefilterd.map(s => `
      <div onpointerdown="event.preventDefault()" onclick="selecteerToernooiSpeler('${escAttr(s.uid)}','${escAttr(s.naam)}',${s.hcp})"
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;color:var(--dark);background:var(--card-bg)"
        onmouseenter="this.style.background='var(--green-pale)'" onmouseleave="this.style.background='var(--card-bg)'">
        <span>${esc(s.naam)}</span>
        <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>
    `).join('');
  }
  lijst.style.display = 'block';
}

function selecteerToernooiSpeler(uid, naam, hcp) {
  if (!store._tGeselecteerdeSpelers.find(s => s.uid === uid)) {
    store._tGeselecteerdeSpelers.push({ uid, naam, hcp, gast: false });
  }
  const zoek = document.getElementById('t-speler-zoek');
  if (zoek) { zoek.value = ''; zoekToernooiSpeler(''); zoek.focus(); }
  renderTGeselecteerdeSpelers();
}

function sluitToernooiSpelerLijst() {
  const lijst = document.getElementById('t-speler-zoek-lijst');
  if (lijst) lijst.style.display = 'none';
}

function verwijderToernooiSpelerSelectie(uid) {
  store._tGeselecteerdeSpelers = store._tGeselecteerdeSpelers.filter(s => s.uid !== uid);
  renderTGeselecteerdeSpelers();
  zoekToernooiSpeler(document.getElementById('t-speler-zoek')?.value || '');
}

function voegGastspelerToe() {
  const naam = prompt('Naam gastspeler:');
  if (!naam?.trim()) return;
  const hcpStr = prompt(`Handicap voor ${naam.trim()}:`, '10');
  if (hcpStr === null) return;
  const hcp = parseFloat(hcpStr) || 0;
  const gastId = 'gast_' + Math.random().toString(36).slice(2, 10);
  store._tGeselecteerdeSpelers.push({ uid: gastId, naam: naam.trim(), hcp, gast: true });
  renderTGeselecteerdeSpelers();
}

function renderTGeselecteerdeSpelers() {
  const _tGeselecteerdeSpelers = store._tGeselecteerdeSpelers;
  const el = document.getElementById('t-geselecteerde-spelers');
  if (!el) return;
  if (_tGeselecteerdeSpelers.length === 0) {
    el.innerHTML = '<span style="font-size:13px;color:var(--light)">Nog geen deelnemers geselecteerd</span>';
    return;
  }
  el.innerHTML = _tGeselecteerdeSpelers.map(s => `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:var(--green-pale);color:var(--green);border:1.5px solid var(--green);border-radius:20px;font-size:13px">
      ${esc(s.naam)}${s.gast ? ' <em style="font-size:11px;opacity:0.7">(gast)</em>' : ''}
      <button onclick="verwijderToernooiSpelerSelectie('${escAttr(s.uid)}')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:14px;padding:0;line-height:1">×</button>
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
    store._flights = [{ id: 1, naam: 'Flight 1', spelers: geselecteerd.map(s => ({ uid: s.uid, naam: s.naam, hcp: s.hcp })), starthole: 1, starttijd }];
  } else {
    _flights.forEach((f, fi) => {
      if (!f.starttijd) f.starttijd = berekenFlightTijd(starttijd, interval, fi);
      if (!f.starthole) f.starthole = 1;
      f.spelers = f.spelers.filter(s => geselecteerd.some(g => g.uid === s.uid));
    });
    const ingedeeld = new Set(_flights.flatMap(f => f.spelers.map(s => s.uid)));
    const nieuw = geselecteerd.filter(s => !ingedeeld.has(s.uid)).map(s => ({ uid: s.uid, naam: s.naam, hcp: s.hcp }));
    if (nieuw.length > 0 && _flights.length > 0) _flights[0].spelers.push(...nieuw);
  }

  window._toernooiStarttijd = starttijd;
  window._toernooiInterval = interval;
  window._flightDagModus = false;

  const startBtn = document.getElementById('flight-modal-start-btn');
  if (startBtn) { startBtn.textContent = 'Toernooi starten →'; startBtn.onclick = startToernooi; }

  renderFlightLijst();
  document.getElementById('modal-flight-indeling').classList.add('open');
}

function renderFlightLijst() {
  const container = document.getElementById('flight-lijst');
  if (!container) return;

  const ingedeeld = new Set(_flights.flatMap(f => f.spelers.map(s => s.uid)));

  container.innerHTML = _flights.map((f, fi) => `
    <div style="border:1.5px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="background:var(--green);padding:8px 12px;display:flex;align-items:center;gap:8px">
        <input type="text" value="${esc(f.naam)}" onchange="wijzigFlightNaam(${fi}, this.value)"
          style="background:transparent;border:none;color:white;font-family:'Bebas Neue';font-size:18px;flex:1;outline:none">
        ${_flights.length > 1 ? `<button onclick="verwijderFlight(${fi})" style="background:rgba(255,255,255,0.2);border:none;border-radius:4px;color:white;cursor:pointer;padding:2px 8px;font-size:13px">✕</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 12px;background:var(--soft-bg);border-bottom:1px solid var(--border)">
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--mid);text-transform:uppercase;display:block;margin-bottom:3px">Starttijd</label>
          <input type="time" value="${esc(f.starttijd || '')}" onchange="wijzigFlightStarttijd(${fi}, this.value)"
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
            <span style="flex:1;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.naam)}</span>
            <input type="number" value="${Math.round(s.hcp)}" min="-10" max="54"
              onchange="wijzigFlightHcp(${fi}, ${si}, this.value)"
              style="width:48px;padding:3px 6px;text-align:center;font-family:'DM Mono',monospace;border:1.5px solid var(--border);border-radius:5px;font-size:13px;flex-shrink:0">
            ${_flights.length > 1 ? `
            <select onchange="verplaatsSpelerFlight(${fi}, ${si}, this.value)" style="font-size:12px;border:1.5px solid var(--border);border-radius:5px;padding:3px 5px;background:var(--card-bg);color:var(--dark);flex-shrink:0;max-width:80px">
              ${_flights.map((lf, lfi) => `<option value="${lfi}" ${lfi === fi ? 'selected' : ''}>${esc(lf.naam)}</option>`).join('')}
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
  _flights.push({ id: fi + 1, naam: `Flight ${fi + 1}`, spelers: [], starthole: vorigeHole, starttijd: berekenFlightTijd(basis, interval, fi) });
  renderFlightLijst();
}

function wijzigFlightStarttijd(fi, val) { if (_flights[fi]) _flights[fi].starttijd = val; }
function wijzigFlightStarthole(fi, val) { if (_flights[fi]) _flights[fi].starthole = parseInt(val) || 1; }

function verwijderFlight(fi) {
  if (_flights.length <= 1) return;
  const spelers = _flights[fi].spelers;
  _flights.splice(fi, 1);
  if (spelers.length > 0) _flights[0].spelers.push(...spelers);
  renderFlightLijst();
}

function wijzigFlightNaam(fi, naam) { if (_flights[fi]) _flights[fi].naam = naam; }
function wijzigFlightHcp(fi, si, val) { if (_flights[fi]?.spelers[si]) _flights[fi].spelers[si].hcp = parseFloat(val) || 0; }

function verplaatsSpelerFlight(vanFi, si, naarFi) {
  naarFi = parseInt(naarFi);
  if (vanFi === naarFi) return;
  const speler = _flights[vanFi].spelers.splice(si, 1)[0];
  _flights[naarFi].spelers.push(speler);
  renderFlightLijst();
}

// ============================================================
//  START TOERNOOI — leest alle dag-blokken in
// ============================================================
async function startToernooi() {
  try {
    const naam     = document.getElementById('t-naam').value.trim();
    const ptWin    = parseFloat(document.getElementById('t-pt-win').value);
    const ptTie    = parseFloat(document.getElementById('t-pt-tie').value);
    const ptLoss   = parseFloat(document.getElementById('t-pt-loss').value);
    const hcpPct   = parseFloat(document.getElementById('t-hcp-pct').value) / 100;
    const ladderId = [..._tRankingLadderIds][0] || null;
    const rankingLadderIds = [..._tRankingLadderIds];
    const modus    = document.querySelector('input[name="t-modus"]:checked')?.value || 'matchplay';
    const starttijd = document.getElementById('t-starttijd')?.value || '09:00';
    const interval  = parseInt(document.getElementById('t-interval')?.value) || 0;

    if (!naam) { toast('Voer een naam in'); return; }

    // Lees alle dag-blokken
    const dagBlokken = Array.from(document.querySelectorAll('#t-dag-blokken .dag-blok'));
    if (dagBlokken.length === 0) { toast('Configureer minimaal één dag'); return; }

    const banen = alleBANEN();
    const dagenConfig = [];
    for (let i = 0; i < dagBlokken.length; i++) {
      const blok    = dagBlokken[i];
      const datum   = blok.querySelector('.t-dag-datum')?.value;
      const baanNaam = blok.querySelector('.t-dag-baan')?.value;
      const holesVal = blok.querySelector('.t-dag-holes')?.value || '18';
      const holesCount = holesVal === 'custom'
        ? parseInt(blok.querySelector('.t-dag-holes-custom')?.value) || 18
        : parseInt(holesVal);

      if (!datum)    { toast(`Voer een datum in voor dag ${i+1}`); return; }
      if (!baanNaam || baanNaam === 'Handmatig invoeren') { toast(`Selecteer een baan voor dag ${i+1}`); return; }

      let holes = [];
      if (banen[baanNaam]?.holes) holes = banen[baanNaam].holes.slice(0, holesCount);
      if (!holes.length) { toast(`Baan heeft geen holes geconfigureerd (dag ${i+1})`); return; }

      dagenConfig.push({ dagNr: i + 1, datum, baan: baanNaam, holes, starttijd, interval });
    }

    // Spelers uit flights
    const geselecteerd = _flights.flatMap(f => f.spelers);
    if (geselecteerd.length < 2) { toast('Voeg minimaal 2 spelers toe aan flights'); return; }
    if (_flights.every(f => f.spelers.length === 0)) { toast('Verdeel spelers over flights'); return; }

    const spelers = geselecteerd.map(s => ({
      uid: s.uid, naam: s.naam, hcp: s.hcp, gast: s.gast || false
    }));

    // Bouw dagen[] — scores en flights leeg, worden per dag ingevuld
    const dagen = dagenConfig.map(cfg => {
      const scores = {};
      spelers.forEach(s => { scores[s.uid] = Array(cfg.holes.length).fill(null); });

      // Dag 1 flights vanuit de flight indeling; overige dagen starten leeg
      const flights = cfg.dagNr === 1
        ? _flights.map(f => ({
            id: f.id, naam: f.naam,
            spelerIds: f.spelers.map(s => s.uid),
            starthole: f.starthole || 1,
            starttijd: f.starttijd || cfg.starttijd
          }))
        : [];

      return {
        dagNr:    cfg.dagNr,
        datum:    cfg.datum,
        baan:     cfg.baan,
        holes:    cfg.holes,
        starttijd: cfg.starttijd,
        interval:  cfg.interval,
        flights,
        scores,
        afgerond: false
      };
    });

    const nieuweToernooi = {
      status: 'actief',
      naam, modus,
      ptWin, ptTie, ptLoss, hcpPct,
      ladderId: ladderId || null,
      rankingLadderIds,
      spelers,
      dagen,
      actiefDagNr: 1,
      timestamp: Date.now()
    };

    const newRef = await addDoc(TOERNOOIEN_COL, nieuweToernooi);
    nieuweToernooi.id = newRef.id;
    alleToernooien.push(nieuweToernooi);
    store.toernooiData = nieuweToernooi;
    store.actieveToernooiId = newRef.id;

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
    document.getElementById('t-naam').value = '';
    document.getElementById('t-aantal-dagen').value = '1';
    document.querySelectorAll('#t-spelers-ladders input, #t-ranking-ladders input').forEach(cb => cb.checked = false);
    renderTGeselecteerdeSpelers();
    renderDagBlokken();
    const setupHeader = document.querySelector('#toernooi-setup-wrap .card-header.inklapbaar');
    if (setupHeader && !setupHeader.classList.contains('ingeklapt')) {
      setupHeader.classList.add('ingeklapt');
      const collapse = setupHeader.nextElementSibling;
      if (collapse) collapse.classList.add('ingeklapt');
    }
    document.getElementById('toernooi-actief-wrap').style.display = 'block';
    renderToernooi();
  } catch(e) { console.error('startToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  DAG BEHEER
// ============================================================

// Selecteer actieve dag en herrender
function selecteerDag(dagNr) {
  if (!toernooiData) return;
  store.toernooiData.actiefDagNr = dagNr;
  const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
  if (idx >= 0) alleToernooien[idx].actiefDagNr = dagNr;
  setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData))).catch(console.error);
  renderToernooiActief();
}

// Open modal om nieuwe dag te configureren
function openNieuweDagModal() {
  const t = toernooiData;
  if (!t) return;
  const vorigeDag = (t.dagen || []).slice(-1)[0];
  // Vul datum default: dag eerder + 1
  const datumEl = document.getElementById('t-dag-datum');
  if (datumEl) {
    if (vorigeDag?.datum) {
      const d = new Date(vorigeDag.datum);
      d.setDate(d.getDate() + 1);
      datumEl.value = d.toISOString().split('T')[0];
    } else {
      datumEl.value = new Date().toISOString().split('T')[0];
    }
  }
  // Vul baan default: zelfde als vorige dag
  const baanEl = document.getElementById('t-dag-baan');
  if (baanEl) {
    const banen = alleBANEN();
    baanEl.innerHTML = Object.keys(banen)
      .filter(n => n !== 'Handmatig invoeren')
      .map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`)
      .join('');
    if (vorigeDag?.baan && banen[vorigeDag.baan]) baanEl.value = vorigeDag.baan;
  }
  document.getElementById('modal-nieuwe-dag').classList.add('open');
}

// Voeg nieuwe dag toe aan bestaand toernooi
async function voegDagToe() {
  try {
    const t = toernooiData;
    if (!t) return;

    const datum    = document.getElementById('t-dag-datum')?.value;
    const baanNaam = document.getElementById('t-dag-baan')?.value;
    const holesVal = document.getElementById('t-dag-holes')?.value || '18';
    const holesCount = holesVal === 'custom'
      ? parseInt(document.getElementById('t-dag-holes-custom')?.value) || 18
      : parseInt(holesVal);

    if (!datum)    { toast('Voer een datum in'); return; }
    if (!baanNaam) { toast('Selecteer een baan'); return; }

    const banen = alleBANEN();
    let holes = [];
    if (banen[baanNaam]?.holes) holes = banen[baanNaam].holes.slice(0, holesCount);
    if (!holes.length) { toast('Baan heeft geen holes geconfigureerd'); return; }

    // Nieuwe scores voor alle huidige spelers
    const scores = {};
    t.spelers.forEach(s => { scores[s.uid] = Array(holes.length).fill(null); });

    // Flight indeling: start leeg (beheerder stelt in via flight modal)
    const starttijd = document.getElementById('t-dag-starttijd')?.value || '09:00';
    const interval  = parseInt(document.getElementById('t-dag-interval')?.value) || 0;

    const nieuweDag = {
      dagNr:    (t.dagen || []).length + 1,
      datum,
      baan:     baanNaam,
      holes,
      starttijd,
      interval,
      flights:  [],  // leeg — beheerder deelt in via flight modal
      scores,
      afgerond: false
    };

    if (!t.dagen) t.dagen = [];
    t.dagen.push(nieuweDag);
    t.actiefDagNr = nieuweDag.dagNr;

    await slaToernooiOp();
    closeModal('modal-nieuwe-dag');
    toast(`Dag ${nieuweDag.dagNr} toegevoegd`);
    renderToernooiActief();
  } catch(e) { console.error('voegDagToe mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// Open flight modal voor de actieve dag (niet voor dag 1 aanmaken maar voor herindeling)
function openFlightIndelingDag() {
  const t = toernooiData;
  const dag = actieveDag(t);
  if (!dag) return;

  const starttijd = dag.starttijd || '09:00';
  const interval  = dag.interval  || 0;

  // Laad bestaande flights van deze dag in _flights
  if (dag.flights && dag.flights.length > 0) {
    store._flights = dag.flights.map(f => ({
      id: f.id, naam: f.naam,
      spelers: (f.spelerIds || []).map(sid => t.spelers.find(s => s.uid === sid)).filter(Boolean),
      starthole: f.starthole || 1,
      starttijd: f.starttijd || starttijd
    }));
  } else {
    // Nieuwe indeling — zet alle spelers in flight 1
    store._flights = [{ id: 1, naam: 'Flight 1', spelers: [...t.spelers], starthole: 1, starttijd }];
  }

  window._toernooiStarttijd = starttijd;
  window._toernooiInterval  = interval;
  window._flightDagModus = true; // signaal: sla op in dag ipv nieuw toernooi

  const startBtn = document.getElementById('flight-modal-start-btn');
  if (startBtn) { startBtn.textContent = 'Indeling opslaan →'; startBtn.onclick = slaFlightIndelingDagOp; }

  renderFlightLijst();
  document.getElementById('modal-flight-indeling').classList.add('open');
}

// Sla flight indeling op in de actieve dag (vanuit modal)
async function slaFlightIndelingDagOp() {
  try {
    const t = toernooiData;
    const dag = actieveDag(t);
    if (!dag) return;

    dag.flights = _flights.map(f => ({
      id: f.id, naam: f.naam,
      spelerIds: f.spelers.map(s => s.uid),
      starthole: f.starthole || 1,
      starttijd: f.starttijd || ''
    }));

    store._flights = [];
    window._flightDagModus = false;
    await slaToernooiOp();
    closeModal('modal-flight-indeling');
    toast('Flight indeling opgeslagen');
    renderToernooiActief();
  } catch(e) { console.error('slaFlightIndelingDagOp mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// Sluit dag af — zet afgerond=true, toont samenvatting
async function sluitDagAf() {
  try {
    const t   = toernooiData;
    const dag = actieveDag(t);
    if (!dag) return;

    if (!confirm(`Dag ${dag.dagNr} afsluiten? Scores zijn daarna niet meer aanpasbaar.`)) return;

    dag.afgerond = true;
    dag.uitslagZichtbaar = true;

    await slaToernooiOp();
    toast(`Dag ${dag.dagNr} afgesloten`);
    renderToernooiActief();
  } catch(e) { console.error('sluitDagAf mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  MATRIX / UITSLAG TOGGLE
// ============================================================
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
    const dag = actieveDag();
    if (dag) dag.uitslagZichtbaar = true;
    toernooiData.uitslagZichtbaar = true;
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx].uitslagZichtbaar = true;
    await setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
    renderToernooiActief();
    toast('Uitslag zichtbaar! 🏆');
  } catch(e) { console.error('toonToernooiUitslag mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  SPELERSBEHEER IN ACTIEF TOERNOOI
// ============================================================
let _toernooiSpelerToevoegen = null;

function openToernooiSpelersBeheer() {
  const t = toernooiData;
  if (!t) return;

  const verwijderLijst = document.getElementById('toernooi-speler-verwijder-lijst');
  verwijderLijst.innerHTML = t.spelers.map(s => `
    <div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:14px">${esc(s.naam)}${s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}</span>
      <button class="btn btn-sm" style="background:var(--alert-bg);color:var(--alert-text);border:none;cursor:pointer;padding:5px 10px;border-radius:6px;font-size:12px"
        onclick="verwijderToernooiSpelerNieuw('${escAttr(s.uid)}')">✕</button>
    </div>
  `).join('');

  // Flight opties van actieve dag
  const dag = actieveDag(t);
  const flightOpties = ((dag?.flights) || (t.dagen?.[0]?.flights) || [{ naam: 'Flight 1' }]).map((f, i) =>
    `<option value="${i}">${esc(f.naam)}</option>`).join('');
  document.getElementById('toernooi-speler-flight-sel').innerHTML = flightOpties;
  document.getElementById('toernooi-gast-flight-sel').innerHTML = flightOpties;

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
  const huidigeIds = new Set(t.spelers.map(s => s.uid));
  const term = zoek.toLowerCase().trim();
  const pool = alleSpelersData.filter(s => !huidigeIds.has(s.uid))
    .filter(s => !term || s.naam.toLowerCase().includes(term))
    .sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));

  lijst.innerHTML = pool.length === 0
    ? '<div style="padding:10px 14px;font-size:13px;color:var(--light)">Geen spelers gevonden</div>'
    : pool.map(s => `
      <div onpointerdown="event.preventDefault()" onclick="selecteerToernooiSpelerModal('${escAttr(s.uid)}','${escAttr(s.naam)}',${s.hcp})"
        style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;color:var(--dark);background:var(--card-bg)"
        onmouseenter="this.style.background='var(--green-pale)'" onmouseleave="this.style.background='var(--card-bg)'">
        <span>${esc(s.naam)}</span>
        <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>`).join('');
  lijst.style.display = 'block';
}

function selecteerToernooiSpelerModal(uid, naam, hcp) {
  _toernooiSpelerToevoegen = { uid, naam, hcp };
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
    const speler = { uid: _toernooiSpelerToevoegen.uid, naam: _toernooiSpelerToevoegen.naam, hcp: _toernooiSpelerToevoegen.hcp, gast: false };

    t.spelers.push(speler);
    // Voeg scores toe aan ALLE dagen
    (t.dagen || []).forEach(dag => {
      dag.scores[speler.uid] = Array(dag.holes.length).fill(null);
      if (dag.flights?.[fi]) {
        dag.flights[fi].spelerIds = [...(dag.flights[fi].spelerIds || []), speler.uid];
      }
    });

    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(t)));
    closeModal('modal-toernooi-spelers');
    renderToernooiActief();
    toast(`${speler.naam.split(' ')[0]} toegevoegd ✓`);
  } catch(e) { console.error('voegBestaandeSpelerToeAanToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function voegGastspelerToeAanToernooi() {
  try {
    const naam = document.getElementById('toernooi-gast-naam').value.trim();
    const hcp  = parseFloat(document.getElementById('toernooi-gast-hcp').value) || 0;
    if (!naam) { toast('Voer een naam in'); return; }
    const t = toernooiData;
    const fi = parseInt(document.getElementById('toernooi-gast-flight-sel').value) || 0;
    const gastId = 'gast_' + Math.random().toString(36).slice(2, 10);
    const speler = { uid: gastId, naam, hcp, gast: true };

    t.spelers.push(speler);
    (t.dagen || []).forEach(dag => {
      dag.scores[gastId] = Array(dag.holes.length).fill(null);
      if (dag.flights?.[fi]) {
        dag.flights[fi].spelerIds = [...(dag.flights[fi].spelerIds || []), gastId];
      }
    });

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
    toernooiData.spelers = toernooiData.spelers.filter(s => s.uid !== spelerId);
    (toernooiData.dagen || []).forEach(dag => {
      delete dag.scores[spelerId];
      if (dag.flights) {
        dag.flights.forEach(f => { f.spelerIds = (f.spelerIds || []).filter(sid => sid !== spelerId); });
      }
    });
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
    closeModal('modal-toernooi-spelers');
    renderToernooiActief();
    toast('Speler verwijderd ✓');
  } catch(e) { console.error('verwijderToernooiSpelerNieuw mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

function openVerwijderToernooiSpeler() { openToernooiSpelersBeheer(); }

async function verwijderToernooiSpeler(spelerId) {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    if (!confirm('Speler verwijderen uit dit toernooi?')) return;
    toernooiData.spelers = toernooiData.spelers.filter(s => s.uid !== spelerId);
    (toernooiData.dagen || []).forEach(dag => {
      delete dag.scores[spelerId];
      delete dag.scores[String(spelerId)];
    });
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx] = { ...toernooiData };
    await setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
    closeModal('modal-archief-detail');
    renderToernooiActief();
    toast('Speler verwijderd uit toernooi');
  } catch(e) { console.error('verwijderToernooiSpeler mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  SCORES VOLLEDIG CHECK
// ============================================================
// v3.0.0-11.68: Geeft true als het toernooi nog geen enkele score heeft
// en geen dag is afgerond. Gebruikt om "terug naar aanmaakscherm" toe te staan.
function heeftGeenScores(t) {
  if (!t || !t.dagen) return true;
  return t.dagen.every(dag => {
    if (dag.afgerond) return false;
    if (!dag.scores) return true;
    return Object.values(dag.scores).every(arr =>
      (arr || []).every(v => v === null || v === undefined)
    );
  });
}

function alleScoresIngevuld(t, dag) {
  dag = dag || actieveDag(t);
  if (!dag || !t || !t.spelers || t.spelers.length === 0) return false;
  return t.spelers.every(s =>
    (dag.holes || []).every((_, i) => {
      const val = dag.scores?.[s.uid]?.[i];
      return val !== null && val !== undefined && val !== '';
    })
  );
}

// ============================================================
//  NAVIGATIE HELPERS
// ============================================================
function gaNaarLadderTab() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-ladder').classList.add('active');
  document.querySelector('nav button').classList.add('active');
  renderLadder();
}

function gaNaarToernooiOverzicht() {
  store.actieveToernooiId = null;
  store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
  renderToernooi();
}

// ============================================================
//  RENDER ACTIEF TOERNOOI
// ============================================================
function renderToernooiActief() {
  const t = toernooiData;
  if (!t) return;

  const isBeheerder   = isCoordinatorRol();
  const dag           = actieveDag(t);
  const dagNr         = t.actiefDagNr || 1;
  const aantalDagen   = (t.dagen || []).length;
  const dagAfgerond   = dag?.afgerond === true;
  const uitslag       = dag?.uitslagZichtbaar === true;
  const allesIngevuld = alleScoresIngevuld(t, dag);
  const detail        = document.getElementById('toernooi-detail');
  if (!detail || !dag) return;

  const flights  = dag.flights || [];
  const mijnUid  = huidigeBruiker?.uid || null;
  const mijnFlight = flights.find(f =>
    (f.spelerIds || []).some(sid => {
      const sp = t.spelers.find(s => s.uid === sid);
      return sp && mijnUid && sp.uid === mijnUid;
    })
  );

  // Dag-tabs (altijd tonen als > 1 dag)
  let dagTabsHtml = '';
  if (aantalDagen > 1 || (isBeheerder && !dagAfgerond)) {
    dagTabsHtml = `<div style="display:flex;gap:6px;overflow-x:auto;padding:10px 16px 0;scrollbar-width:none;border-bottom:1px solid var(--border)">`;
    (t.dagen || []).forEach(d => {
      const actief = d.dagNr === dagNr;
      const kleur = d.afgerond ? 'var(--mid)' : 'var(--green)';
      dagTabsHtml += `<button onclick="selecteerDag(${d.dagNr})"
        style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px solid ${actief ? kleur : 'var(--border)'};border-bottom:none;background:${actief ? kleur : 'transparent'};color:${actief ? 'white' : 'var(--mid)'};font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
        Dag ${d.dagNr}${d.afgerond ? ' ✓' : ''}
      </button>`;
    });
    // Knop: nieuwe dag toevoegen (alleen als laatste dag afgerond is)
    const laasteAfgerond = (t.dagen || []).every(d => d.afgerond);
    if (isBeheerder && laasteAfgerond) {
      dagTabsHtml += `<button onclick="openNieuweDagModal()"
        style="flex-shrink:0;padding:6px 14px;border-radius:20px 20px 0 0;border:1.5px dashed var(--border);border-bottom:none;background:transparent;color:var(--green);font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif">
        + Dag toevoegen
      </button>`;
    }
    dagTabsHtml += '</div>';
  }

  detail.innerHTML = `
    ${dagTabsHtml}
    <div class="card">
      <div class="card-header">
        <h2>${esc(t.naam)}</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge badge-gold">${dagAfgerond ? 'Dag afgesloten' : uitslag ? 'Uitslag' : 'Bezig'}</span>
          <button class="btn btn-sm btn-ghost" onclick="gaNaarLadderTab()" style="font-size:12px">← Ladder</button>
        </div>
      </div>
      <div class="card-body" style="padding:10px 16px;font-size:13px;color:var(--mid)">
        Dag ${dagNr} · ${esc(dag.datum)} · ${esc(dag.baan)} · ${dag.holes.length} holes · ${t.spelers.length} spelers
        ${flights.length > 1 ? ` · ${flights.length} flights` : ''}
        ${!isBeheerder && mijnFlight ? ` · <strong style="color:var(--green)">${esc(mijnFlight.naam)}</strong>` : ''}
      </div>
    </div>

    ${uitslag || dagAfgerond || t.modus === 'strokeplay' ? `
    <div class="card">
      <div style="display:flex;gap:6px;overflow-x:auto;padding:10px 12px 0;scrollbar-width:none;border-bottom:1px solid var(--border)">
        ${(t.dagen || []).map(d => `
          <button onclick="selecteerRanglijstDag(${d.dagNr})"
            id="t-rl-tab-${d.dagNr}"
            style="flex-shrink:0;padding:5px 12px;border-radius:16px 16px 0 0;border:1.5px solid var(--border);border-bottom:none;background:transparent;color:var(--mid);font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">
            Dag ${d.dagNr}
          </button>`).join('')}
        ${aantalDagen > 1 ? `
          <button onclick="selecteerRanglijstDag(0)"
            id="t-rl-tab-0"
            style="flex-shrink:0;padding:5px 12px;border-radius:16px 16px 0 0;border:1.5px solid var(--border);border-bottom:none;background:transparent;color:var(--mid);font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">
            Totaal
          </button>` : ''}
      </div>
      <div id="t-ranglijst"></div>
    </div>
    ` : ''}

    ${t.modus !== 'strokeplay' ? `
    <div class="card">
      <div class="card-header ${isBeheerder ? 'inklapbaar' : ''} ${t.matrixIngeklapt && !uitslag ? 'ingeklapt' : ''}"
        ${isBeheerder ? 'onclick="toggleToernooiMatrix()"' : ''}>
        <h2>Onderlinge stand</h2>
      </div>
      <div class="card-collapse ${t.matrixIngeklapt && !uitslag ? 'ingeklapt' : ''}" id="t-matrix-collapse">
        <div id="t-matrix" style="overflow-x:auto;padding:8px"></div>
      </div>
    </div>
    ` : ''}

    <div class="card">
      <div class="card-header inklapbaar ${dagAfgerond ? 'ingeklapt' : ''}" onclick="toggleAdminKaart(this)">
        <h2>${isBeheerder ? 'Scores dag ' + dagNr : 'Mijn scorekaart'}</h2>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          ${isBeheerder ? `
            <button id="t-refresh-btn" class="btn btn-sm btn-ghost" onclick="refreshToernooiScorekaart()" style="display:none;background:var(--gold);color:white;border-color:var(--gold)">↺ Nieuw</button>
            ${!dagAfgerond ? `<button class="btn btn-sm btn-ghost" onclick="openFlightIndelingDag()">✈ Flights</button>` : ''}
            <button class="btn btn-sm btn-ghost" onclick="openToernooiSpelersBeheer()">👥 Spelers</button>
          ` : ''}
        </div>
      </div>
      <div class="card-collapse ${dagAfgerond ? 'ingeklapt' : ''}">
        <div id="t-scorecard-wrap" style="overflow-x:auto"></div>
      </div>
    </div>

    <div style="padding:0 0 12px">
      <button onclick="kopieerLiveLink()" class="btn btn-ghost btn-block" style="font-size:13px">
        🔗 Live meekijklink kopiëren
      </button>
    </div>

    ${isBeheerder ? `
    <div style="padding:0 0 16px">
      ${!dagAfgerond && !uitslag ? `
      <button id="t-uitslag-btn" class="btn btn-primary btn-block"
        style="margin-bottom:8px;${!allesIngevuld ? 'opacity:0.5;cursor:not-allowed' : ''}"
        ${!allesIngevuld ? 'disabled' : ''}>
        📊 Uitslag dag ${dagNr} ${!allesIngevuld ? '(scores onvolledig)' : ''}
      </button>
      ` : ''}
      ${uitslag && !dagAfgerond ? `
      <button class="btn btn-gold btn-block" onclick="sluitDagAf()" style="margin-bottom:8px">
        ✓ Dag ${dagNr} afsluiten
      </button>
      ` : ''}
      ${dagAfgerond && (t.dagen || []).every(d => d.afgerond) ? `
      <button class="btn btn-gold btn-block" onclick="openToernooiAfsluiten()" style="margin-bottom:8px">
        🏅 Toernooi afsluiten${t.modus !== 'strokeplay' && (t.rankingLadderIds?.length > 0 || t.ladderId) ? ' & ladder bijwerken' : ''}
      </button>
      ` : ''}
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;font-size:13px;color:var(--dark)">
          <input type="checkbox" id="t-toernooi-modus-chk"
            ${t.toernooiModus ? 'checked' : ''}
            onchange="toggleToernooiModus(this.checked)"
            style="accent-color:var(--green);width:18px;height:18px;flex-shrink:0">
          <span><strong>Toernooi-modus</strong><br><span style="font-size:11px;color:var(--mid)">Deelnemers zien alleen de Toernooi-tab. Titelbalk toont toernooinaam.</span></span>
        </label>
      </div>
      ${heeftGeenScores(t) ? `
      <button class="btn btn-secondary btn-block" onclick="bewerkToernooi()" style="margin-bottom:8px">
        ✏️ Terug naar aanmaakscherm
      </button>
      ` : ''}
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;font-size:13px;color:var(--dark)">
          <input type="checkbox" id="t-scores-verborgen-chk"
            ${t.scoresVerborgen ? 'checked' : ''}
            onchange="toggleScoresVerborgen(this.checked)"
            style="accent-color:var(--green);width:18px;height:18px;flex-shrink:0">
          <span><strong>Scores verbergen</strong><br><span style="font-size:11px;color:var(--mid)">Deelnemers zien alleen hun eigen invoerkolom, niet die van anderen.</span></span>
        </label>
      </div>
      <button class="btn btn-ghost btn-block" onclick="annuleerToernooi()" style="margin-bottom:8px;color:var(--red)">
        Toernooi annuleren
      </button>
    </div>
    ` : ''}
  `;

  renderTScorecard();

  // Toon ranglijst op actieve dag als dag afgerond of uitslag zichtbaar
  if (uitslag || dagAfgerond || t.modus === 'strokeplay') {
    selecteerRanglijstDag(dagNr);
  }
  renderTMatrix();

  const uitslagBtn = document.getElementById('t-uitslag-btn');
  if (uitslagBtn) uitslagBtn.onclick = toonToernooiUitslag;
}

// ============================================================
//  RANGLIJST DAG SELECTOR
// ============================================================
// dagNr: 0 = totaal, 1..N = dag
function selecteerRanglijstDag(dagNr) {
  window._ranglijstDagNr = dagNr;
  // Update tab styling
  const t = toernooiData;
  if (!t) return;
  (t.dagen || []).forEach(d => {
    const tab = document.getElementById(`t-rl-tab-${d.dagNr}`);
    const actief = d.dagNr === dagNr;
    if (tab) {
      tab.style.background = actief ? 'var(--green)' : 'transparent';
      tab.style.color = actief ? 'white' : 'var(--mid)';
      tab.style.borderColor = actief ? 'var(--green)' : 'var(--border)';
    }
  });
  const totaalTab = document.getElementById('t-rl-tab-0');
  if (totaalTab) {
    const actief = dagNr === 0;
    totaalTab.style.background = actief ? 'var(--gold)' : 'transparent';
    totaalTab.style.color = actief ? 'white' : 'var(--mid)';
    totaalTab.style.borderColor = actief ? 'var(--gold)' : 'var(--border)';
  }
  renderTRanglijst();
}
window.selecteerRanglijstDag = selecteerRanglijstDag;

// ============================================================
//  SCORECARD
// ============================================================
function renderTScorecard() {
  const t = toernooiData;
  if (!t) return;
  const dag = actieveDag(t);
  if (!dag) return;

  const isBeheerder = isCoordinatorRol();
  const flights = dag.flights || [];
  const mijnUid2 = huidigeBruiker?.uid || null;

  let teTonenFlights = [];
  if (isBeheerder || flights.length === 0) {
    teTonenFlights = flights.length > 0
      ? flights.map(f => ({ naam: f.naam, spelers: (f.spelerIds || []).map(sid => t.spelers.find(s => s.uid === sid)).filter(Boolean) }))
      : [{ naam: null, spelers: t.spelers }];
  } else {
    const mijnFlight = flights.find(f =>
      (f.spelerIds || []).some(sid => {
        const sp = t.spelers.find(s => s.uid === sid);
        return sp && mijnUid2 && sp.uid === mijnUid2;
      })
    );
    if (mijnFlight) {
      teTonenFlights = [{ naam: mijnFlight.naam, spelers: (mijnFlight.spelerIds || []).map(sid => t.spelers.find(s => s.uid === sid)).filter(Boolean) }];
    } else {
      teTonenFlights = [{ naam: null, spelers: t.spelers }];
    }
  }

  const scorecardWrap = document.getElementById('t-scorecard-wrap');
  if (!scorecardWrap) return;

  const activeFi = scorecardWrap._activeFlight != null
    ? Math.min(scorecardWrap._activeFlight, teTonenFlights.length - 1)
    : 0;

  let html = '';

  if (isBeheerder && teTonenFlights.length > 1) {
    html += `<div style="display:flex;gap:0;border-bottom:2px solid var(--border);overflow-x:auto;scrollbar-width:none;padding:0 4px">`;
    teTonenFlights.forEach(({ naam }, ti) => {
      const actief = ti === activeFi;
      html += `<button onclick="selecteerFlightTab(${ti})"
        style="flex-shrink:0;padding:8px 14px;border:none;background:transparent;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:${actief?'700':'500'};color:${actief?'var(--green)':'var(--mid)'};border-bottom:2px solid ${actief?'var(--green)':'transparent'};margin-bottom:-2px;cursor:pointer">
        ${esc(naam || 'Scores')}
      </button>`;
    });
    html += '</div>';
  }

  const { naam, spelers } = teTonenFlights[activeFi];
  const tabOffset = activeFi * spelers.length * dag.holes.length;

  const flightData = (dag.flights || []).find(f => f.naam === naam);
  const starthole = (flightData?.starthole || 1) - 1;
  const holesInVolgorde = dag.holes.map((_, i) => (starthole + i) % dag.holes.length);
  const dagAfgerond = dag.afgerond === true;

  if (naam) {
    const info = [
      flightData?.starttijd ? `🕐 ${esc(flightData.starttijd)}` : null,
      flightData?.starthole ? `Hole ${flightData.starthole}` : null
    ].filter(Boolean).join(' · ');
    html += `<div style="display:flex;align-items:baseline;gap:12px;padding:8px 12px 6px">
      <span style="font-family:'Bebas Neue';font-size:16px;color:var(--green)">${esc(naam)}</span>
      ${info ? `<span style="font-size:13px;color:var(--mid)">${info}</span>` : ''}
    </div>`;
  }

  html += `<div style="overflow-x:auto"><table class="scorecard" style="width:100%"><thead><tr><th class="player-col">Hole</th>`;
  spelers.forEach(s => {
    const delen = s.naam.split(' ');
    html += `<th class="player-col" style="max-width:70px">
      <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px" title="${esc(s.naam)}">${esc(delen[0])}</span>
      <span class="hole-par" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65px;${isBeheerder&&!dagAfgerond?'cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.4)':''}" ${isBeheerder&&!dagAfgerond?`onclick="editToernooiHcp('${escAttr(s.uid)}')"`:''}>
        ${esc(delen.slice(1).join(' ') || 'hcp '+Math.round(s.hcp))}
      </span>
    </th>`;
  });
  html += '</tr></thead><tbody>';

  holesInVolgorde.forEach((holeIdx, spelRij) => {
    const h = dag.holes[holeIdx];
    html += `<tr><td class="player-col" style="font-weight:600">${holeIdx+1}<span class="hole-par">p${h.par} SI${h.si}</span></td>`;
    spelers.forEach((s, si) => {
      const val = dag.scores?.[s.uid]?.[holeIdx];
      const tabIdx = tabOffset + si * dag.holes.length + spelRij + 1;
      if (dagAfgerond) {
        html += `<td style="text-align:center;font-family:'DM Mono',monospace;font-size:14px">${val !== null && val !== undefined ? val : '—'}</td>`;
      } else if (!isBeheerder && t.scoresVerborgen && s.uid !== mijnUid2) {
        // v3.0.0-11.68: scores van andere spelers verbergen als beheerder dit heeft ingesteld
        html += `<td style="text-align:center;color:var(--light);font-size:14px">•</td>`;
      } else {
        html += `<td><input type="number" min="1" max="12" inputmode="numeric" value="${val !== null && val !== undefined ? val : ''}"
          tabindex="${tabIdx}" onfocus="this.select()"
          oninput="updateTScoreAndAdvance('${escAttr(s.uid)}',${holeIdx},${tabIdx},this.value)"
          style="width:42px;padding:4px;text-align:center;font-size:14px;font-family:'DM Mono',monospace;border:1.5px solid var(--border);border-radius:5px;background:var(--input-bg);color:var(--dark)"></td>`;
      }
    });
    html += '</tr>';
  });

  html += '<tr class="t-totaal-rij" style="background:var(--green-pale)"><td class="player-col" style="font-weight:700">Tot</td>';
  spelers.forEach(s => {
    // v3.0.0-11.68: verberg totaal van anderen als scoresVerborgen aan staat
    if (!isBeheerder && t.scoresVerborgen && s.uid !== mijnUid2) {
      html += `<td data-speler-id="${s.uid}" style="text-align:center;color:var(--light)">•</td>`;
    } else {
      const scores = dag.scores?.[s.uid] || [];
      const filled = scores.filter(v => v !== null && v !== undefined);
      const tot = filled.length ? filled.reduce((a,b) => a+Number(b), 0) : null;
      html += `<td data-speler-id="${s.uid}" style="font-family:'DM Mono',monospace;font-weight:700;text-align:center">${tot !== null ? tot : '—'}</td>`;
    }
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
  if (actieveDag()?.uitslagZichtbaar || toernooiData?.modus === 'strokeplay') renderTRanglijst();
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

// ============================================================
//  SCORE BIJWERKEN
// ============================================================
function updateTScoreAndAdvance(spelerId, holeIdx, tabIdx, val) {
  updateTScore(spelerId, holeIdx, val);
  // v3.0.0-11.68: auto-advance voor zowel coordinator als speler
  if (val.length > 0) {
    setTimeout(() => {
      const next = document.querySelector(`input[tabindex="${tabIdx + 1}"]`);
      if (next) { next.focus(); next.select(); }
    }, 50);
  }
}

function updateTScore(spelerId, holeIdx, val) {
  if (!toernooiData || !actieveToernooiId) return;
  const dag = actieveDag();
  if (!dag || dag.afgerond) return;

  const key = String(spelerId);
  if (!dag.scores[key]) dag.scores[key] = Array(dag.holes.length).fill(null);
  dag.scores[key][holeIdx] = val === '' ? null : parseInt(val);

  const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
  if (idx >= 0) alleToernooien[idx] = JSON.parse(JSON.stringify(toernooiData));

  updateTTotaalRijInline();

  const isBeheerder = isCoordinatorRol();
  if (isBeheerder) {
    renderTMatrix();
  } else {
    clearTimeout(window._matrixUpdateTimer);
    window._matrixUpdateTimer = setTimeout(() => renderTMatrix(), 2000);
  }

  if (dag.uitslagZichtbaar) renderTRanglijst();

  const alles = alleScoresIngevuld(toernooiData);
  const btn = document.getElementById('t-uitslag-btn');
  if (btn) {
    btn.disabled = !alles;
    btn.style.opacity = alles ? '1' : '0.5';
    btn.style.cursor = alles ? 'pointer' : 'not-allowed';
    const dagNr = toernooiData.actiefDagNr || 1;
    btn.textContent = `📊 Uitslag dag ${dagNr}${alles ? '' : ' (scores onvolledig)'}`;
    btn.onclick = alles ? toonToernooiUitslag : null;
  }

  // v3.0.0-11.68: coordinator schrijft het hoofddocument, speler schrijft
  // alleen zijn eigen scores naar de live/{uid} subcollectie.
  if (isBeheerder) {
    slaToernooiOp(800);
  } else {
    const dagNr = toernooiData.actiefDagNr || 1;
    slaSpelerScoreOp(spelerId, dagNr, dag.scores[String(spelerId)] || []);
  }
}

function updateTTotaalRijInline() {
  const t   = toernooiData;
  const dag = actieveDag(t);
  if (!t || !dag) return;
  const totaalRijen = document.querySelectorAll('#t-scorecard-wrap tr.t-totaal-rij');
  totaalRijen.forEach(rij => {
    const cellen = rij.querySelectorAll('td[data-speler-id]');
    cellen.forEach(cel => {
      const sid = cel.dataset.spelerId;
      const scores = dag.scores?.[sid] || [];
      const filled = scores.filter(v => v !== null && v !== undefined);
      cel.textContent = filled.length ? filled.reduce((a,b) => a + Number(b), 0) : '—';
    });
  });
}

function editToernooiHcp(spelerId) {
  const t = toernooiData;
  if (!t) return;
  const speler = t.spelers.find(s => s.uid === spelerId);
  if (!speler) return;
  const nieuw = prompt(`Playing handicap voor ${speler.naam.split(' ')[0]}:`, Math.round(speler.hcp));
  if (nieuw === null) return;
  const val = parseFloat(nieuw);
  if (isNaN(val)) { toast('Ongeldige handicap'); return; }
  speler.hcp = val;
  if (actieveToernooiId) setDoc(doc(db, 'toernooien', actieveToernooiId), toernooiData);
  renderTScorecard();
  renderTRanglijst();
  renderTMatrix();
  const dag = actieveDag(t);
  const flights = dag?.flights || [];
  let hcpSpelers = t.spelers;
  if (!isCoordinatorRol() && flights.length > 0) {
    const voornaam = (huidigeBruiker?.gebruikersnaam || '').toLowerCase().split(' ')[0];
    const mijnFlight = flights.find(f => (f.spelerIds || []).some(sid => {
      const sp = t.spelers.find(s => s.uid === sid);
      return sp && sp.naam.toLowerCase().includes(voornaam);
    }));
    if (mijnFlight) hcpSpelers = (mijnFlight.spelerIds || []).map(sid =>
      t.spelers.find(s => s.uid === sid)).filter(Boolean);
  }
  renderHcpBlok(hcpSpelers, dag?.holes || [], t.hcpPct ?? 0.75, 'toernooi-hcp-blok');
  toast(`Handicap ${speler.naam.split(' ')[0]} bijgewerkt ✓`);
}

function updateTTotalen() { updateTTotaalRijInline(); }
function toggleTScorecard() {
  const w = document.getElementById('t-scorecard-wrap');
  w.style.display = w.style.display === 'none' ? '' : 'none';
}

// ============================================================
//  HCP SLAGEN
// ============================================================
function getTHcpSlagen(spelerA, spelerB, hole, hcpPct) {
  const diff = Math.round(Math.abs(spelerA.hcp - spelerB.hcp) * hcpPct);
  const ontvanger = spelerA.hcp < spelerB.hcp ? spelerB : spelerA;
  const aantalHoles = 18;
  const basisSlagen = Math.min(diff, aantalHoles);
  const extraSlagen = Math.max(0, diff - aantalHoles);
  const slagOpHole = (hole.si <= basisSlagen ? 1 : 0) + (hole.si <= extraSlagen ? 1 : 0);
  return { diff, ontvanger, slagOpHole };
}

// ============================================================
//  BEREKENING — per dag en totaal
// ============================================================

// Bereken matchplay punten voor één dag
function berekenTPuntenVoorDag(t, dag) {
  if (!dag) return { punten: [], won: [], tied: [], lost: [], matrix: [] };
  const n = t.spelers.length;
  const punten = new Array(n).fill(0);
  const won    = new Array(n).fill(0);
  const tied   = new Array(n).fill(0);
  const lost   = new Array(n).fill(0);
  const matrix = Array.from({length: n}, () => new Array(n).fill(null));

  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      const sA = t.spelers[i];
      const sB = t.spelers[j];
      let standA = 0;
      let gespeeld = false;

      for (let h = 0; h < dag.holes.length; h++) {
        const scoreA = dag.scores?.[sA.uid]?.[h];
        const scoreB = dag.scores?.[sB.uid]?.[h];
        if (scoreA == null || scoreB == null) continue;
        gespeeld = true;
        const hole = dag.holes[h];
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

// berekenTPunten: voor matrix/ranglijst — gebruikt actieve dag of totaal
function berekenTPunten(dagNrOverride) {
  const t = toernooiData;
  const rlDag = dagNrOverride !== undefined ? dagNrOverride : (window._ranglijstDagNr ?? (t.actiefDagNr || 1));

  if (rlDag === 0) {
    // Totaal: optel over alle dagen
    const n = t.spelers.length;
    const totPunten = new Array(n).fill(0);
    const totWon    = new Array(n).fill(0);
    const totTied   = new Array(n).fill(0);
    const totLost   = new Array(n).fill(0);
    const totMatrix = Array.from({length: n}, () => new Array(n).fill(null));

    (t.dagen || []).forEach(dag => {
      const res = berekenTPuntenVoorDag(t, dag);
      for (let i = 0; i < n; i++) {
        totPunten[i] += res.punten[i];
        totWon[i]    += res.won[i];
        totTied[i]   += res.tied[i];
        totLost[i]   += res.lost[i];
      }
      // Matrix totaal: tel W/L/T op als strings is lastig — sla combinatie op
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (res.matrix[i][j]) {
            totMatrix[i][j] = totMatrix[i][j]
              ? (totMatrix[i][j] === res.matrix[i][j] ? totMatrix[i][j] : 'M')
              : res.matrix[i][j];
          }
        }
      }
    });
    return { punten: totPunten, won: totWon, tied: totTied, lost: totLost, matrix: totMatrix };
  } else {
    const dag = getDag(t, rlDag) || actieveDag(t);
    return berekenTPuntenVoorDag(t, dag);
  }
}

// Strokeplay ranglijst voor één dag
function berekenStrokeplayRanglijstVoorDag(t, dag) {
  if (!dag) return [];
  return t.spelers.map(s => {
    const scores = dag.scores?.[s.uid] || [];
    const hcp = Math.round(s.hcp);
    const aantalHoles = dag.holes.length;

    let bruttoTotaal = 0, nettoSlagen = 0, stableford = 0, holesGespeeld = 0;
    const holeScores = [];

    dag.holes.forEach((hole, i) => {
      const val = scores[i];
      if (val === null || val === undefined) { holeScores.push(null); return; }
      holesGespeeld++;
      const v = Number(val);
      bruttoTotaal += v;
      const slag = (hole.si <= Math.min(hcp, aantalHoles) ? 1 : 0) +
                   (hole.si <= Math.max(0, hcp - aantalHoles) ? 1 : 0);
      nettoSlagen += slag;
      const nettoVal = v - slag;
      const diff = hole.par - nettoVal;
      stableford += Math.max(0, diff + 2);
      holeScores.push({ brutto: v, netto: nettoVal, stableford: Math.max(0, diff + 2) });
    });

    return {
      s,
      holes:      holesGespeeld,
      brutto:     holesGespeeld > 0 ? bruttoTotaal : null,
      netto:      holesGespeeld > 0 ? bruttoTotaal - nettoSlagen : null,
      stableford: holesGespeeld > 0 ? stableford : null,
      holeScores
    };
  });
}

// Strokeplay totaalstand over alle dagen
function berekenStrokeplayTotaal(t) {
  return t.spelers.map((s, si) => {
    let bruttoTot = 0, nettoTot = 0, stablefordTot = 0, holesTot = 0;
    (t.dagen || []).forEach(dag => {
      const dagRes = berekenStrokeplayRanglijstVoorDag(t, dag);
      const r = dagRes[si];
      if (r && r.holes > 0) {
        bruttoTot     += r.brutto     ?? 0;
        nettoTot      += r.netto      ?? 0;
        stablefordTot += r.stableford ?? 0;
        holesTot      += r.holes;
      }
    });
    return { s, holes: holesTot, brutto: holesTot > 0 ? bruttoTot : null, netto: holesTot > 0 ? nettoTot : null, stableford: holesTot > 0 ? stablefordTot : null, holeScores: [] };
  });
}

function countback(a, b, sorteerOp) {
  const n = Math.max(
    (a.holeScores || []).filter(h => h !== null).length,
    (b.holeScores || []).filter(h => h !== null).length
  );
  if (n === 0) return 0;

  const segmenten = [Math.ceil(n/2), Math.ceil(n/3), Math.ceil(n/4), 1]
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const getScore = (speler, aantalVanachter) => {
    const gevuld = (speler.holeScores || []).filter(h => h !== null);
    const segment = gevuld.slice(-aantalVanachter);
    if (sorteerOp === 'stableford') return segment.reduce((sum, h) => sum + h.stableford, 0);
    else if (sorteerOp === 'netto')  return segment.reduce((sum, h) => sum + h.netto, 0);
    else                              return segment.reduce((sum, h) => sum + h.brutto, 0);
  };

  for (const seg of segmenten) {
    const sA = getScore(a, seg), sB = getScore(b, seg);
    if (sorteerOp === 'stableford') { if (sA !== sB) return sB - sA; }
    else                             { if (sA !== sB) return sA - sB; }
  }
  return 0;
}

// ============================================================
//  RANGLIJST RENDER
// ============================================================
function renderTRanglijst() {
  const el = document.getElementById('t-ranglijst');
  if (!el) return;
  const t = toernooiData;
  if (!t) return;

  const rlDag = window._ranglijstDagNr ?? (t.actiefDagNr || 1);
  const modusBar = document.getElementById('t-ranglijst-modus');
  if (modusBar) modusBar.style.display = t.modus === 'strokeplay' ? '' : 'none';

  if (t.modus === 'strokeplay') {
    const sorteerOp = t._ranglijstModus || 'brutto';
    const dagNaam = rlDag === 0 ? 'Totaal' : `Dag ${rlDag}`;
    let resultaten;
    if (rlDag === 0) {
      resultaten = berekenStrokeplayTotaal(t).filter(r => r.holes > 0);
    } else {
      const dag = getDag(t, rlDag) || actieveDag(t);
      resultaten = berekenStrokeplayRanglijstVoorDag(t, dag).filter(r => r.holes > 0);
    }

    resultaten.sort((a, b) => {
      const valA = sorteerOp === 'stableford' ? -(a.stableford ?? -999) : (a[sorteerOp] ?? 999);
      const valB = sorteerOp === 'stableford' ? -(b.stableford ?? -999) : (b[sorteerOp] ?? 999);
      if (valA !== valB) return valA - valB;
      return countback(a, b, sorteerOp);
    });

    const cbSpelers = new Set();
    for (let i = 0; i < resultaten.length - 1; i++) {
      const a = resultaten[i], b = resultaten[i+1];
      const va = sorteerOp === 'stableford' ? a.stableford : a[sorteerOp];
      const vb = sorteerOp === 'stableford' ? b.stableford : b[sorteerOp];
      if (va === vb) { cbSpelers.add(i); cbSpelers.add(i+1); }
    }

    document.querySelectorAll('.t-sort-pijl').forEach(el => el.textContent = '↕');
    const actief = document.querySelector(`.t-sort-pijl[data-col="${sorteerOp}"]`);
    if (actief) actief.textContent = sorteerOp === 'stableford' ? '↓' : '↑';

    const sorteerLabel = { brutto: 'Brutto (laag wint)', netto: 'Netto (laag wint)', stableford: 'Stableford (hoog wint)' }[sorteerOp];

    if (resultaten.length === 0) { el.innerHTML = '<div class="empty"><p>Nog geen scores ingevoerd.</p></div>'; return; }

    const thStyle = 'padding:6px 4px;background:var(--green);color:white;text-align:center;font-size:11px;cursor:pointer;white-space:nowrap;user-select:none';
    const tdStyle = 'padding:6px 4px;text-align:center;font-size:12px;font-family:"DM Mono",monospace;border-bottom:1px solid var(--border)';
    const tdNaamStyle = 'padding:6px 8px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    let html = `<div style="font-size:11px;color:var(--light);padding:6px 10px;border-bottom:1px solid var(--border)">
      <strong>${dagNaam}</strong> · Gesorteerd op: <strong style="color:var(--green)">${sorteerLabel}</strong>
      ${cbSpelers.size > 0 ? ' · <span title="Gelijke stand — volgorde bepaald door countback">CB = countback</span>' : ''}
    </div>`;
    html += '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr>';
    html += `<th style="${thStyle};text-align:left;width:24px">#</th>`;
    html += `<th style="${thStyle};text-align:left">Naam</th>`;
    html += `<th style="${thStyle}" title="Gespeelde holes">Holes</th>`;
    html += `<th style="${thStyle}" onclick="wisselRanglijstModus('brutto')">Brutto<br><span class="t-sort-pijl" data-col="brutto">↕</span></th>`;
    html += `<th style="${thStyle}" onclick="wisselRanglijstModus('netto')">Netto<br><span class="t-sort-pijl" data-col="netto">↕</span></th>`;
    html += `<th style="${thStyle}" onclick="wisselRanglijstModus('stableford')">Stableford<br><span class="t-sort-pijl" data-col="stableford">↕</span></th>`;
    html += '</tr></thead><tbody>';

    const totaalHoles = rlDag === 0
      ? (t.dagen || []).reduce((s, d) => s + d.holes.length, 0)
      : (getDag(t, rlDag) || actieveDag(t))?.holes.length || 0;

    resultaten.forEach((r, rank) => {
      const isGast = r.s.gast;
      const trStyle = rank % 2 === 0 ? '' : 'background:var(--subtle-bg)';
      const actBrutto    = sorteerOp === 'brutto'     ? 'font-weight:700;color:var(--green)' : '';
      const actNetto     = sorteerOp === 'netto'      ? 'font-weight:700;color:var(--green)' : '';
      const actStableford= sorteerOp === 'stableford' ? 'font-weight:700;color:var(--green)' : '';
      const cbBadge = cbSpelers.has(rank) ? ' <span style="font-size:9px;background:var(--warning-bg);color:var(--warning-text);border-radius:4px;padding:1px 4px;font-weight:700">CB</span>' : '';
      html += `<tr style="${trStyle}">
        <td style="${tdStyle};font-weight:700;color:${rank < 3 ? 'var(--gold)' : 'var(--light)'}">${rank+1}</td>
        <td style="${tdNaamStyle}">${esc(r.s.naam)}${isGast ? ' <em style="font-size:10px;color:var(--light)">(gast)</em>' : ''}${cbBadge}</td>
        <td style="${tdStyle};color:var(--light);font-size:11px">${r.holes}/${totaalHoles}</td>
        <td style="${tdStyle};${actBrutto}">${r.brutto ?? '—'}</td>
        <td style="${tdStyle};${actNetto}">${r.netto ?? '—'}</td>
        <td style="${tdStyle};${actStableford}">${r.stableford !== null ? r.stableford + ' pt' : '—'}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
    return;
  }

  // ── Matchplay ranglijst ──
  const dagNaam = rlDag === 0 ? 'Totaal' : `Dag ${rlDag}`;
  const { punten, won, tied, lost } = berekenTPunten(rlDag);
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  el.innerHTML = `<div style="font-size:11px;color:var(--light);padding:6px 10px;border-bottom:1px solid var(--border)"><strong>${dagNaam}</strong></div>` +
    volgorde.map((entry, rank) => `
    <div class="ladder-item">
      <div class="rank-badge ${rank < 3 ? 'top3' : ''}">${rank+1}</div>
      <div class="player-name">${esc(entry.s.naam)}${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}</div>
      <div style="font-size:12px;color:var(--light);text-align:right;line-height:1.6">
        ${entry.w}W ${entry.ti}T ${entry.l}L<br>
        <strong style="color:var(--dark)">${entry.pt > 0 ? '+' : ''}${entry.pt} pt</strong>
        ${entry.s.gast ? '<br><span style="font-size:10px;color:var(--light)">telt niet mee</span>' : ''}
      </div>
    </div>
  `).join('');
}

// ============================================================
//  MATRIX
// ============================================================
function renderTMatrix() {
  if (toernooiData?.modus && toernooiData.modus !== 'matchplay') {
    const el = document.getElementById('t-matrix');
    if (el) el.innerHTML = '';
    return;
  }
  const actief = document.activeElement;
  const tabIdx = actief?.getAttribute?.('tabindex');
  const selStart = actief?.selectionStart;

  const t = toernooiData;
  if (!t) return;
  const n = t.spelers.length;
  const rlDag = window._ranglijstDagNr ?? (t.actiefDagNr || 1);
  const { matrix } = berekenTPunten(rlDag);

  const kleur = { W: '#d4edda', L: '#f8d7da', T: '#fff3cd' };
  const dag = actieveDag(t);
  const uitslag = dag?.uitslagZichtbaar === true;
  const tekst = uitslag ? { W: 'W', L: 'L', T: 'T' } : { W: 'UP', L: 'DOWN', T: 'TIED' };

  let html = `<table style="border-collapse:collapse;font-size:11px;width:100%">`;
  html += `<tr><th style="padding:4px;background:var(--green);color:white"></th>`;
  t.spelers.forEach(s => {
    html += `<th style="padding:4px 6px;background:var(--green);color:white;text-align:center">${esc(s.naam.split(' ')[0])}</th>`;
  });
  html += '</tr>';

  t.spelers.forEach((sA, i) => {
    html += `<tr><td style="padding:4px 8px;font-weight:600;font-size:12px;white-space:nowrap">${esc(sA.naam.split(' ')[0])}</td>`;
    t.spelers.forEach((sB, j) => {
      if (i === j) {
        html += `<td style="background:var(--border);text-align:center;padding:4px">—</td>`;
      } else {
        const res = matrix[i][j];
        const bg = res ? (kleur[res] || 'var(--subtle-bg)') : 'transparent';
        const tx = res ? (tekst[res] || res) : '';
        html += `<td style="background:${bg};text-align:center;padding:4px;font-weight:700">${tx}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</table>';

  const matrixEl = document.getElementById('t-matrix');
  if (matrixEl) matrixEl.innerHTML = html;

  if (tabIdx) {
    const herstel = document.querySelector(`input[tabindex="${tabIdx}"]`);
    if (herstel) { herstel.focus(); try { herstel.setSelectionRange(selStart, selStart); } catch(e) {} }
  }
}

// ============================================================
//  AFSLUITEN TOERNOOI
// ============================================================
function openToernooiAfsluiten() {
  const t = toernooiData;
  if (!t) return;
  const isStrokeplay = t.modus === 'strokeplay';

  if (isStrokeplay) {
    if (confirm('Toernooi afsluiten? De ladderstand wordt niet aangepast.')) {
      bevestigToernooiAfsluiten();
    }
    return;
  }

  // Gebruik totaalstand als meerdere dagen
  const { punten, won, tied, lost } = berekenTPunten(0);
  const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
    .sort((a,b) => b.pt - a.pt || b.w - a.w);

  const rankingLadderIds = t.rankingLadderIds?.length > 0 ? t.rankingLadderIds : (t.ladderId ? [t.ladderId] : []);
  const heeftRankingLadders = rankingLadderIds.length > 0;
  const rankingLadderNamen = alleLadders.filter(l => rankingLadderIds.includes(l.id)).map(l => l.naam).join(', ');

  let html = '<div style="margin-bottom:12px">';
  volgorde.forEach((entry, rank) => {
    const score = `<span style="font-family:'DM Mono',monospace;color:var(--green);font-weight:700">${entry.pt > 0 ? '+' : ''}${entry.pt} pt</span>`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-family:'Bebas Neue';font-size:18px;color:${rank===0?'var(--gold)':'var(--light)'};margin-right:8px">${rank+1}</span>
        <strong>${esc(entry.s.naam)}</strong>${entry.s.gast ? ' <em style="font-size:11px;color:var(--light)">(gast)</em>' : ''}
      </div>
      ${score}
    </div>`;
  });
  html += `</div><p style="font-size:12px;color:var(--light)">${
    heeftRankingLadders
      ? `Rankingposities worden bijgewerkt in: ${rankingLadderNamen}. Alleen spelers met 5+ ladderwedstrijden.`
      : 'Er zijn geen ranking ladders gekoppeld. Ladders worden niet aangepast.'
  }</p>`;

  document.getElementById('t-eindstand').innerHTML = html;
  document.getElementById('modal-toernooi-afsluiten').classList.add('open');
}

async function bevestigToernooiAfsluiten() {
  try {
    const t = toernooiData;
    if (!t) return;

    if (t.modus === 'strokeplay') {
      t.status = 'afgerond';
      const idx = alleToernooien.findIndex(x => x.id === actieveToernooiId);
      if (idx >= 0) alleToernooien[idx].status = 'afgerond';
      await setDoc(doc(db, 'toernooien', actieveToernooiId), t);

      // v3.0.0-11.68: reset toernooiSpeler-vlag voor batch-import deelnemers
      const spelerUids = (t.spelers || []).filter(s => !s.gast).map(s => s.uid);
      await Promise.all(spelerUids.map(uid =>
        getDoc(doc(db, 'spelers', uid)).then(snap => {
          if (snap.exists() && snap.data().toernooiSpeler === true) {
            return setDoc(doc(db, 'spelers', uid),
              { ...snap.data(), toernooiSpeler: false, toernooiNaam: null });
          }
        }).catch(e => console.warn('toernooiSpeler reset mislukt voor', uid, e.code))
      ));

      store.alleToernooien = alleToernooien.filter(x => x.id !== actieveToernooiId);
      store.toernooiData = store.alleToernooien.length > 0 ? store.alleToernooien[0] : null;
      store.actieveToernooiId = store.toernooiData?.id || null;
      renderToernooi();
      toast('Toernooi afgesloten ✓');
      return;
    }

    // Totaalstand over alle dagen
    const { punten, won, tied, lost, matrix } = berekenTPunten(0);
    const volgorde = t.spelers.map((s,i) => ({s, i, pt: punten[i], w: won[i], ti: tied[i], l: lost[i]}))
      .sort((a,b) => b.pt - a.pt || b.w - a.w);

    const rankingLadderIds = t.rankingLadderIds?.length > 0
      ? t.rankingLadderIds
      : (t.ladderId ? [t.ladderId] : []);

    for (const ladderId of rankingLadderIds) {
      const { exists: snapExists, data: snapData } = await getLadderData(ladderId);
      if (snapExists) {
        const ladderData = snapData;
        // Lees huidige standen uit standen/{uid} — niet uit ladderData.spelers[]
        const standenSnap = await getDocs(collection(db, 'ladders', ladderId, 'standen'));
        const standenMap = {};
        standenSnap.docs.forEach(d => { standenMap[d.id] = { uid: d.id, ...d.data() }; });

        const spelerIds = new Set(ladderData.spelerIds || []);
        const deelnemers = volgorde.filter(e =>
          !e.s.gast && e.s.uid && spelerIds.has(e.s.uid) && standenMap[e.s.uid]
        ).filter(e => (standenMap[e.s.uid]?.partijen || 0) >= 5);

        if (deelnemers.length > 0) {
          // Sla prevRank op
          Object.values(standenMap).forEach(s => { s.prevRank = s.rank; });
          const gesorteerd = [...deelnemers].sort((a, b) => b.pt - a.pt);

          gesorteerd.forEach(e => {
            const sp = standenMap[e.s.uid];
            if (!sp) return;
            const pt = e.pt || 0;
            if (pt === 0) return;
            const oudeRank  = sp.rank;
            const maxRank   = Object.keys(standenMap).length;
            const nieuweRank = Math.max(1, Math.min(maxRank, oudeRank - pt));
            if (nieuweRank === oudeRank) return;
            if (nieuweRank < oudeRank) {
              Object.values(standenMap).forEach(s => {
                if (s.uid !== sp.uid && s.rank >= nieuweRank && s.rank < oudeRank) s.rank++;
              });
            } else {
              Object.values(standenMap).forEach(s => {
                if (s.uid !== sp.uid && s.rank > oudeRank && s.rank <= nieuweRank) s.rank--;
              });
            }
            sp.rank = nieuweRank;
          });

          deelnemers.forEach(e => {
            const sp = standenMap[e.s.uid];
            if (sp) {
              sp.partijen = (sp.partijen || 0) + (deelnemers.length - 1);
              sp.gewonnen = (sp.gewonnen || 0) + (e.w || 0);
            }
          });

          // Hernummer ranks 1..N
          Object.values(standenMap).sort((a, b) => a.rank - b.rank).forEach((s, i) => { s.rank = i + 1; });

          // Schrijf alle standen terug naar standen/{uid}
          const standenWrites = Object.values(standenMap).map(sp => {
            const payload = { rank: sp.rank || 0, partijen: sp.partijen || 0, gewonnen: sp.gewonnen || 0 };
            if (sp.prevRank != null) payload.prevRank = sp.prevRank;
            return setDoc(doc(db, 'ladders', ladderId, 'standen', sp.uid), payload)
              .catch(err => console.warn('standen sync mislukt voor', sp.uid, err.code));
          });
          await Promise.all(standenWrites);

          await slaSnapshotOp(`🏅 Na toernooi: ${t.naam}`, ladderId);
        }
      }
    }

    // Archief — sla alle dagen op
    const archief = { seizoenen: archiefData, toernooien: window._archiefToernooienCache || [] };
    if (!archief.toernooien) archief.toernooien = [];

    const matrixArchief = {};
    t.spelers.forEach((sA, i) => {
      t.spelers.forEach((sB, j) => {
        matrixArchief[`${i}_${j}`] = i === j ? 'X' : (matrix[i][j] || '-');
      });
    });

    archief.toernooien.unshift({
      naam:  t.naam,
      dagen: (t.dagen || []).map(d => ({ dagNr: d.dagNr, datum: d.datum, baan: d.baan, holes: d.holes.length })),
      ptWin: t.ptWin, ptTie: t.ptTie, ptLoss: t.ptLoss,
      ranglijst: volgorde.map(e => ({ naam: e.s.naam, hcp: Math.round(e.s.hcp), punten: e.pt, won: e.w, tied: e.ti, lost: e.l })),
      spelerNamen: t.spelers.map(s => s.naam.split(' ')[0]),
      matrix: matrixArchief,
      timestamp: Date.now()
    });
    await setDoc(ARCHIEF_DOC, archief);

    if (actieveToernooiId) await setDoc(doc(db, 'toernooien', actieveToernooiId), { ...toernooiData, status: 'afgerond' });

    // v3.0.0-11.68: reset toernooiSpeler-vlag voor alle deelnemers die via batch-import
    // zijn aangemaakt. Ze kunnen de app daarna als gewone speler gebruiken.
    const toernooiSpelerUids = (t.spelers || [])
      .filter(s => !s.gast)
      .map(s => s.uid);
    if (toernooiSpelerUids.length > 0) {
      await Promise.all(toernooiSpelerUids.map(uid =>
        getDoc(doc(db, 'spelers', uid)).then(snap => {
          if (snap.exists() && snap.data().toernooiSpeler === true) {
            return setDoc(doc(db, 'spelers', uid),
              { ...snap.data(), toernooiSpeler: false, toernooiNaam: null });
          }
        }).catch(e => console.warn('toernooiSpeler reset mislukt voor', uid, e.code))
      ));
    }

    store.alleToernooien = alleToernooien.filter(t => t.id !== actieveToernooiId);
    store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
    store.actieveToernooiId = toernooiData?.id || null;

    closeModal('modal-toernooi-afsluiten');
    toast('Toernooi afgerond! 🏅 Ladder bijgewerkt.');
    renderToernooi();
    renderLadder();
  } catch(e) { console.error('bevestigToernooiAfsluiten mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  BEWERK TOERNOOI — v3.0.0-11.68
// ============================================================
// Verwijdert het actieve toernooi uit Firestore (alleen als er geen scores zijn
// en geen dag is afgerond) en herlaadt het aanmaakscherm met alle instellingen
// vooringevuld zodat de beheerder kan aanpassen en opnieuw opstarten.
async function bewerkToernooi() {
  const t = toernooiData;
  if (!t || !actieveToernooiId) return;
  if (!heeftGeenScores(t)) {
    toast('Scores al ingevuld — bewerken niet meer mogelijk');
    return;
  }
  if (!confirm('Terug naar het aanmaakscherm? Het toernooi wordt verwijderd zodat je het opnieuw kunt instellen. Alle instellingen blijven bewaard.')) return;

  try {
    // Verwijder uit Firestore
    await deleteDoc(doc(db, 'toernooien', actieveToernooiId));

    // Verwijder ook eventuele live/{uid} score-docs (opruimen)
    try {
      const liveDocs = await getDocs(collection(db, 'toernooien', actieveToernooiId, 'live'));
      await Promise.all(liveDocs.docs.map(d => deleteDoc(d.ref)));
    } catch(e) { /* live docs bestaan mogelijk niet — geen probleem */ }

    // Update lokale state
    store.alleToernooien = alleToernooien.filter(x => x.id !== actieveToernooiId);
    store.toernooiData   = alleToernooien.length > 0 ? alleToernooien[0] : null;
    store.actieveToernooiId = store.toernooiData?.id || null;

    // Herlaad setup-state vanuit het verwijderde document
    _herstelSetupVanuitToernooi(t);

    // Toon het aanmaakscherm
    renderToernooi();

    // Klap de setup-kaart open
    const setupHeader = document.querySelector('#toernooi-setup-wrap .card-header.inklapbaar');
    if (setupHeader && setupHeader.classList.contains('ingeklapt')) {
      setupHeader.classList.remove('ingeklapt');
      const collapse = setupHeader.nextElementSibling;
      if (collapse) collapse.classList.remove('ingeklapt');
    }

    toast('Instellingen hersteld — pas aan en start opnieuw');
  } catch(e) {
    console.error('bewerkToernooi mislukt:', e);
    toast('Er is iets misgegaan, probeer opnieuw');
  }
}
window.bewerkToernooi = bewerkToernooi;

// Herlaad de aanmaak-state (formuliervelden + spelers + flights) vanuit een bestaand toernooi-object
function _herstelSetupVanuitToernooi(t) {
  // Naam
  const naamEl = document.getElementById('t-naam');
  if (naamEl) naamEl.value = t.naam || '';

  // Modus
  const modusRadio = document.querySelector(`input[name="t-modus"][value="${t.modus || 'matchplay'}"]`);
  if (modusRadio) { modusRadio.checked = true; toernooiModusWissel(t.modus || 'matchplay'); }

  // Punt-instellingen
  if (t.ptWin  !== undefined) { const el = document.getElementById('t-pt-win');  if (el) el.value = t.ptWin; }
  if (t.ptTie  !== undefined) { const el = document.getElementById('t-pt-tie');  if (el) el.value = t.ptTie; }
  if (t.ptLoss !== undefined) { const el = document.getElementById('t-pt-loss'); if (el) el.value = t.ptLoss; }
  if (t.hcpPct !== undefined) { const el = document.getElementById('t-hcp-pct'); if (el) el.value = Math.round(t.hcpPct * 100); }

  // Dag 1 starttijd + interval (van eerste dag)
  const dag1 = (t.dagen || [])[0];
  if (dag1?.starttijd) { const el = document.getElementById('t-starttijd'); if (el) el.value = dag1.starttijd; }
  if (dag1?.interval  !== undefined) { const el = document.getElementById('t-interval');  if (el) el.value = dag1.interval; }

  // Aantal dagen + dag-blokken
  const aantalEl = document.getElementById('t-aantal-dagen');
  const aantalDagen = (t.dagen || []).length;
  if (aantalEl) aantalEl.value = aantalDagen;
  renderDagBlokken();

  // Vul datum en baan in per dag (na renderDagBlokken zodat de blokken bestaan)
  const dagBlokken = document.querySelectorAll('#t-dag-blokken .dag-blok');
  (t.dagen || []).forEach((dag, i) => {
    const blok = dagBlokken[i];
    if (!blok) return;
    const datumEl = blok.querySelector('.t-dag-datum');
    if (datumEl && dag.datum) datumEl.value = dag.datum;
    const baanEl = blok.querySelector('.t-dag-baan');
    if (baanEl && dag.baan) {
      if ([...baanEl.options].some(o => o.value === dag.baan)) baanEl.value = dag.baan;
    }
    const holesEl = blok.querySelector('.t-dag-holes');
    if (holesEl && dag.holes) {
      const n = dag.holes.length;
      if (n === 18 || n === 9) holesEl.value = String(n);
      else {
        holesEl.value = 'custom';
        const custEl = blok.querySelector('.t-dag-holes-custom');
        const custWrap = blok.querySelector('.t-dag-holes-custom-wrap');
        if (custEl) custEl.value = n;
        if (custWrap) custWrap.style.display = 'block';
      }
    }
  });

  // Spelers — herstel uit t.spelers
  store._tGeselecteerdeSpelers = (t.spelers || []).map(s => ({
    uid: s.uid, naam: s.naam, hcp: s.hcp, gast: s.gast || false
  }));
  renderTGeselecteerdeSpelers();

  // Ladder-checkboxes (spelers + ranking) — herstel via rankingLadderIds
  store._tRankingLadderIds = new Set(t.rankingLadderIds || (t.ladderId ? [t.ladderId] : []));
  store._tSpelersLadderIds = new Set(t.rankingLadderIds || (t.ladderId ? [t.ladderId] : []));
  initToernooiSetup(); // herlaadt checkbox-states

  // Flights — herstel uit dag 1 flights
  const dag1Flights = (t.dagen?.[0]?.flights || []);
  if (dag1Flights.length > 0) {
    store._flights = dag1Flights.map(f => ({
      id:       f.id,
      naam:     f.naam,
      starthole: f.starthole || 1,
      starttijd: f.starttijd || dag1?.starttijd || '09:00',
      spelers:  (f.spelerIds || []).map(uid => {
        const sp = (t.spelers || []).find(s => s.uid === uid);
        return sp ? { uid: sp.uid, naam: sp.naam, hcp: sp.hcp } : null;
      }).filter(Boolean)
    }));
  } else {
    store._flights = [];
  }
}

async function annuleerToernooi() {
  try {
    if (!confirm('Toernooi annuleren? Alle scores gaan verloren.')) return;
    if (actieveToernooiId) await setDoc(doc(db, 'toernooien', actieveToernooiId), { ...toernooiData, status: 'geannuleerd' });
    store.alleToernooien = alleToernooien.filter(t => t.id !== actieveToernooiId);
    store.toernooiData = alleToernooien.length > 0 ? alleToernooien[0] : null;
    store.actieveToernooiId = toernooiData?.id || null;
    renderToernooi();
    toast('Toernooi geannuleerd');
  } catch(e) { console.error('annuleerToernooi mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  MODUS / RANGLIJST WISSEL
// ============================================================
function toernooiModusWissel(modus) {
  const matchplay  = document.getElementById('t-matchplay-instellingen');
  const strokeplay = document.getElementById('t-strokeplay-instellingen');
  const rankingWrap = document.getElementById('t-ranking-ladders-wrap');
  if (matchplay)   matchplay.style.display   = modus === 'matchplay'  ? '' : 'none';
  if (strokeplay)  strokeplay.style.display  = modus === 'strokeplay' ? '' : 'none';
  if (rankingWrap) rankingWrap.style.display = modus === 'matchplay'  ? '' : 'none';
}

async function wisselRanglijstModus(modus) {
  if (toernooiData) {
    toernooiData._ranglijstModus = modus;
    renderTRanglijst();
    try {
      if (actieveToernooiId) await setDoc(doc(db, 'toernooien', actieveToernooiId), { ...toernooiData });
    } catch(e) { console.error('wisselRanglijstModus opslaan mislukt:', e); }
  }
}
window.wisselRanglijstModus = wisselRanglijstModus;
window.toernooiModusWissel = toernooiModusWissel;

// ============================================================
//  LIVE LINK
// ============================================================
function kopieerLiveLink() {
  if (!actieveToernooiId) { toast('Geen actief toernooi'); return; }
  const base = window.location.href.split('/').slice(0, -1).join('/');
  const url = `${base}/toernooi-live.html?t=${actieveToernooiId}`;
  navigator.clipboard.writeText(url).then(() => {
    toast('Link gekopieerd! Deel deze in WhatsApp om mee te laten kijken ✓');
  }).catch(() => {
    prompt('Kopieer deze link:', url);
  });
}
window.kopieerLiveLink = kopieerLiveLink;

// ============================================================
//  TOERNOOI-MODUS
// ============================================================
async function toggleToernooiModus(aan) {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    toernooiData.toernooiModus = !!aan;
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx].toernooiModus = !!aan;
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
    // Laat auth.js de nav + header bijwerken
    window.dispatchEvent(new CustomEvent('toernooiModusGewijzigd'));
    toast(aan ? 'Toernooi-modus aan ✓' : 'Toernooi-modus uit');
  } catch(e) { console.error('toggleToernooiModus mislukt:', e); toast('Er is iets misgegaan'); }
}
window.toggleToernooiModus = toggleToernooiModus;

async function toggleScoresVerborgen(aan) {
  try {
    if (!toernooiData || !actieveToernooiId) return;
    toernooiData.scoresVerborgen = !!aan;
    const idx = alleToernooien.findIndex(t => t.id === actieveToernooiId);
    if (idx >= 0) alleToernooien[idx].scoresVerborgen = !!aan;
    await setDoc(doc(db, 'toernooien', actieveToernooiId), JSON.parse(JSON.stringify(toernooiData)));
    renderTScorecard();
    toast(aan ? 'Scores verborgen voor deelnemers ✓' : 'Scores zichtbaar voor deelnemers ✓');
  } catch(e) { console.error('toggleScoresVerborgen mislukt:', e); toast('Er is iets misgegaan'); }
}
window.toggleScoresVerborgen = toggleScoresVerborgen;

export function getActiefToernooiMetModus() {
  return alleToernooien.find(t => t.toernooiModus && t.status === 'actief') || null;
}


export { alleScoresIngevuld, annuleerToernooi, berekenFlightTijd, berekenTPunten, bevestigToernooiAfsluiten, editToernooiHcp, gaNaarLadderTab, gaNaarToernooiOverzicht, getTHcpSlagen, getToernooiSpelersPool, herlaadToernooien, initToernooiSetup, openFlightIndeling, openFlightIndelingDag, openNieuweDagModal, openToernooiAfsluiten, openToernooiSpelersBeheer, openVerwijderToernooiSpeler, refreshToernooiScorekaart, renderDagBlokken, renderFlightLijst, renderTGeselecteerdeSpelers, renderTMatrix, renderTRanglijst, renderTScorecard, renderToernooi, renderToernooiActief, selecteerDag, selecteerFlightTab, selecteerToernooi, selecteerToernooiSpeler, selecteerToernooiSpelerModal, sluitDagAf, sluitToernooiSpelerLijst, sluitToernooiSpelerModal, slaFlightIndelingDagOp, startToernooi, toggleHolesCustom, toggleTRankingLadder, toggleTScorecard, toggleTSpeler, toggleTSpelersLadder, toggleToernooiMatrix, toonToernooiUitslag, updateTScore, updateTScoreAndAdvance, updateTTotaalRijInline, updateTTotalen, verplaatsSpelerFlight, verwijderFlight, verwijderToernooiSpeler, verwijderToernooiSpelerNieuw, verwijderToernooiSpelerSelectie, voegBestaandeSpelerToeAanToernooi, voegDagToe, voegFlightToe, voegGastspelerToe, voegGastspelerToeAanToernooi, wijzigFlightHcp, wijzigFlightNaam, wijzigFlightStarthole, wijzigFlightStarttijd, zoekToernooiSpeler, zoekToernooiSpelerModal };
