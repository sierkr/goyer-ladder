// ============================================================
//  ladder.js — Ladder rendering, ranking weergave
// ============================================================
import { db, LADDERS_COL } from './config.js';
import { store, state, alleLadders, activeLadderId, huidigeBruiker, uitdagingenData, DEFAULT_LADDER_CONFIG } from './store.js';
import { slaState, getLadderConfig, getLadderData, getNextId, isBeheerderRol, isCoordinatorRol, toast } from './auth.js';
import { stuurUitdaging } from './archief.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { renderKnockoutLadderKaart } from './knockout.js';
import { getLadderSpelers, isInLadder } from './ladder-view.js';



//  LADDER
// ============================================================
async function renderLadder() {

  try {
  const wrap = document.getElementById('ladder-kaarten');
  if (!wrap) return;

  // Bepaal welke ladders de gebruiker ziet
  // Primary: uid in spelerIds[] (fase 1 migratie)
  // Fallback: spelerId of naam in spelers[] (backward compat)
  const mijnLadders = isCoordinatorRol()
    ? alleLadders
    : alleLadders.filter(l => {
        const uid = huidigeBruiker?.uid;
        // v3.0.0-9c: alleen uid-check via view-laag
        return uid && isInLadder(l.id, uid);
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
          store.alleLadders = laddersSnap.docs.map(d => ({
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

    // Gebruik view-laag (fase 9a) — haalt spelers uit spelers/{uid} + standen/{uid}
    // Valt terug op l.data.spelers als standen/ nog leeg is
    const spelers = getLadderSpelers(l.id);
    const lijstHtml = spelers.length === 0
      ? '<div class="empty"><p>Nog geen spelers.</p></div>'
      : spelers.map(s => renderLadderRij(s, l.id)).join('');

    return `<div class="card" style="margin-bottom:16px">
      <div class="card-header inklapbaar" onclick="toggleLadderKaart(this,'${l.id}')">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <button onclick="event.stopPropagation();deelLadderAlsAfbeelding('${l.id}')" style="background:none;border:none;cursor:pointer;font-size:20px;padding:0;flex-shrink:0" title="Deel als afbeelding">📤</button>
          <h2 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Ladderstand ${l.naam}</h2>
        </div>
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

  const uid = huidigeBruiker?.uid;
  // v3.0.0-9c: isZelf alleen via uid. Entries uit view-laag hebben s.uid.
  const isZelf = huidigeBruiker && uid && s.uid === uid;
  const openUitdaging = uitdagingenData?.find(u =>
    u.status === 'open' && (
      (u.vanEmail === huidigeBruiker?.email && u.naarNaam?.toLowerCase() === s.naam.toLowerCase()) ||
      (u.naarEmail === huidigeBruiker?.email && u.vanNaam?.toLowerCase() === s.naam.toLowerCase())
    )
  );
  const uitdagingBtnHtml = huidigeBruiker && !isZelf
    ? `<button onclick="stuurUitdaging('${s.id}')" style="background:none;border:1px solid #e0ddd4;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:${openUitdaging ? 'var(--gold)' : 'var(--light)'}" title="${openUitdaging ? 'Uitdaging loopt' : 'Uitdagen'}">⚔️</button>`
    : '';

  return `<div class="ladder-item" style="${isZelf ? 'background:var(--green-pale);border-left:3px solid var(--green);margin-left:-3px;' : ''}">
    <div class="rank-badge ${s.rank <= 3 ? 'top3' : isZelf ? 'zelf' : ''}">${s.rank}</div>
    <div class="player-name" style="${isZelf ? 'font-weight:700;color:var(--green);' : ''}">${s.naam}</div>
    <div style="min-width:30px;text-align:center">${deltaHtml}</div>
    <div class="player-stats" style="text-align:right;min-width:52px">${s.partijen}P ${s.gewonnen}W<br>${winpct}%</div>
    <div style="width:42px;text-align:center;flex-shrink:0">${uitdagingBtnHtml}</div>
  </div>`;
}

// ============================================================

export { renderLadder, toggleLadderKaart, renderLadderRij };

// ============================================================
//  DEEL ALS AFBEELDING — WhatsApp stijl
// ============================================================
async function deelLadderAlsAfbeelding(ladderId) {
  try {
  const ladder = alleLadders.find(l => l.id === ladderId);
  const spelers = getLadderSpelers(ladderId);
  if (spelers.length === 0) { toast('Geen spelers om te delen'); return; }

  const naam = ladder?.naam || 'Ladder';
  const datum = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });

  // Canvas instellingen
  const colW = 190;          // ~2/3 van 280
  const rowH = 20;           // compact
  const headerH = 46;
  const padding = 8;
  const helft = Math.ceil(spelers.length / 2);
  const rows = helft;
  const canvasW = colW * 2 + padding * 3;
  const canvasH = headerH + rows * rowH + padding;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW * 2; // retina
  canvas.height = canvasH * 2;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // retina

  // Achtergrond geel
  ctx.fillStyle = '#FFE600';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header — titel en datum op gelijke hoogte
  const headerY = headerH - 10;
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 15px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('LADDERSTAND ' + naam.toUpperCase(), padding, headerY);
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(datum, canvasW - padding, headerY);

  // Scheidingslijn onder header
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding, headerH);
  ctx.lineTo(canvasW - padding, headerH);
  ctx.stroke();

  // Verticale scheidingslijn midden
  ctx.beginPath();
  ctx.moveTo(canvasW / 2, headerH);
  ctx.lineTo(canvasW / 2, canvasH - padding);
  ctx.stroke();

  // Spelers renderen
  const renderKolom = (startIdx, xOffset) => {
    for (let i = startIdx; i < startIdx + helft && i < spelers.length; i++) {
      const s = spelers[i];
      const y = headerH + (i - startIdx) * rowH;

      // Zebra achtergrond
      ctx.fillStyle = (i - startIdx) % 2 === 0 ? '#FFE600' : '#FFF176';
      ctx.fillRect(xOffset, y, colW, rowH);

      // Ranknummer
      ctx.fillStyle = '#000';
      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(String(s.rank), xOffset + 28, y + rowH - 5);

      // Naam
      ctx.font = '13px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(s.naam, xOffset + 34, y + rowH - 5);

      // Horizontale lijn
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(xOffset, y + rowH);
      ctx.lineTo(xOffset + colW, y + rowH);
      ctx.stroke();
    }
  };

  renderKolom(0, padding);
  renderKolom(helft, canvasW / 2 + padding / 2);

  // Exporteren
  canvas.toBlob(async blob => {
    // Probeer Web Share API (mobiel)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'ladder.png', { type: 'image/png' })] })) {
      try {
        await navigator.share({
          files: [new File([blob], `goyer-${naam.toLowerCase().replace(/\s+/g,'-')}.png`, { type: 'image/png' })],
          title: `Goyer ${naam} Ladder`
        });
        return;
      } catch(e) { /* gebruiker annuleerde of share mislukt, val terug op download */ }
    }
    // Fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goyer-${naam.toLowerCase().replace(/\s+/g,'-')}-${datum.replace(' ','-')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
  } catch(e) { console.error('deelLadderAlsAfbeelding mislukt:', e); toast('Afbeelding maken mislukt'); }
}

window.deelLadderAlsAfbeelding = deelLadderAlsAfbeelding;
