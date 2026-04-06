// ============================================================
//  ladder.js — Ladder rendering, ranking weergave
// ============================================================
import { db, LADDERS_COL } from './config.js';;
import { store, DEFAULT_LADDER_CONFIG } from './store.js';;
import * as S from './store.js';
;
import { stuurUitdaging } from './archief.js';;
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

  isBeheerderRol, isCoordinatorRol, toast } from './auth.js';

//  LADDER
// ============================================================
async function renderLadder() {

  try {
  const wrap = document.getElementById('ladder-kaarten');
  if (!wrap) return;

  // Bepaal welke ladders de gebruiker ziet
  const mijnLadders = isCoordinatorRol()
    ? alleLadders
    : alleLadders.filter(l => {
        const spelerData = (l.spelers || []);
        return spelerData.some(s =>
          s.naam.toLowerCase().includes((huidigeBruiker?.gebruikersnaam || '').split(' ')[0].toLowerCase()) ||
          (huidigeBruiker?.gebruikersnaam || '').toLowerCase().includes(s.naam.split(' ')[0].toLowerCase())
        );
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
          alleLadders = laddersSnap.docs.map(d => ({
            id: d.id, naam: d.data().naam, type: d.data().type || 'ranking',
            spelerIds: d.data().spelerIds || [], spelers: d.data().spelers || [],
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
    if (l.id === activeLadderId) return { ...l, data: state };
    if (l.data) return l; // gebruik cache
    const snap = await getDoc(doc(db, 'ladders', l.id));
    const data = snap.exists() ? snap.data() : { spelers: [] };
    l.data = data; // cache voor volgende keer
    return { ...l, data };
  }));

  wrap.innerHTML = ladderData.map(l => {
    const isKnockout = (l.data.type || l.type) === 'knockout';

    if (isKnockout) {
      return renderKnockoutLadderKaart(l);
    }

    const spelers = [...(l.data.spelers || [])].sort((a,b) => a.rank - b.rank);
    const lijstHtml = spelers.length === 0
      ? '<div class="empty"><p>Nog geen spelers.</p></div>'
      : spelers.map(s => renderLadderRij(s, l.id)).join('');

    return `<div class="card" style="margin-bottom:16px">
      <div class="card-header inklapbaar" onclick="toggleLadderKaart(this,'${l.id}')">
        <h2>Ladderstand ${l.naam}</h2>
        <span class="badge badge-green">${spelers.length} spelers</span>
      </div>
      <div class="card-collapse" id="ladder-collapse-${l.id}">
        <div id="ladder-list-${l.id}">${lijstHtml}</div>
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
  if (s.prevRank != null && s.prevRank !== s.rank) {
    const d = s.prevRank - s.rank;
    deltaHtml = d > 0
      ? `<span class="delta-up" style="font-size:12px">▲${d}</span>`
      : `<span class="delta-down" style="font-size:12px">▼${Math.abs(d)}</span>`;
  } else if (s.prevRank != null) {
    deltaHtml = `<span style="font-size:11px;color:var(--light)">—</span>`;
  }

  const isZelf = huidigeBruiker && (
    s.naam.toLowerCase().includes(huidigeBruiker.gebruikersnaam.toLowerCase()) ||
    huidigeBruiker.gebruikersnaam.toLowerCase().includes(s.naam.split(' ')[0].toLowerCase())
  );
  const openUitdaging = uitdagingenData?.find(u =>
    u.status === 'open' && (
      (u.vanEmail === huidigeBruiker?.email && u.naarNaam?.toLowerCase().includes(s.naam.split(' ')[0].toLowerCase())) ||
      (u.naarEmail === huidigeBruiker?.email && u.vanNaam?.toLowerCase().includes(s.naam.split(' ')[0].toLowerCase()))
    )
  );
  const uitdagingBtnHtml = huidigeBruiker && !isZelf
    ? `<button onclick="stuurUitdaging(${s.id})" style="background:none;border:1px solid #e0ddd4;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:${openUitdaging ? 'var(--gold)' : 'var(--light)'}" title="${openUitdaging ? 'Uitdaging loopt' : 'Uitdagen'}">⚔️</button>`
    : '';

  return `<div class="ladder-item" style="">
    <div class="rank-badge ${s.rank <= 3 ? 'top3' : ''}">${s.rank}</div>
    <div class="player-name" style="">${s.naam}</div>
    <div style="min-width:30px;text-align:center">${deltaHtml}</div>
    <div class="player-stats" style="text-align:right;min-width:52px">${s.partijen}P ${s.gewonnen}W<br>${winpct}%</div>
    <div style="width:42px;text-align:center;flex-shrink:0">${uitdagingBtnHtml}</div>
  </div>`;
}

// ============================================================

export { renderLadder, toggleLadderKaart, renderLadderRij };
