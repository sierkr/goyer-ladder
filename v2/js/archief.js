// ============================================================
//  archief.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store, state, huidigeBruiker, archiefData, uitdagingenData } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { renderAdmin, renderProfiel } from './admin.js';
import { renderLadder } from './ladder.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { closeModal } from './admin.js';


//  SEIZOENEN & ARCHIEF
// ============================================================
function openNieuwSeizoenModal() {
  const jaar = new Date().getFullYear();
  document.getElementById('seizoen-naam').value = `Seizoen ${jaar}`;
  document.getElementById('modal-nieuw-seizoen').classList.add('open');
}

async function bevestigNieuwSeizoen() {
  const naam = document.getElementById('seizoen-naam').value.trim();
  if (!naam) { toast('Geef het seizoen een naam'); return; }

  // Archiveer huidig seizoen — inclusief spelers met 0 partijen
  const alleSpelersInLadder = [...state.spelers].sort((a,b) => a.rank - b.rank);
  const seizoen = {
    naam,
    datum: new Date().toLocaleDateString('nl-NL'),
    timestamp: Date.now(),
    eindstand: alleSpelersInLadder.map(s => ({
      rank: s.rank,
      naam: s.naam,
      partijen: s.partijen || 0,
      gewonnen: s.gewonnen || 0,
      hcp: Math.round(s.hcp)
    })),
    uitslagen: [...state.uitslagen].map(u => ({
      baan: u.baan || '',
      datum: u.datum || '',
      spelers: u.spelers || []
    }))
  };

  

  archiefData.unshift(seizoen);

  try {
    await setDoc(ARCHIEF_DOC, { seizoenen: archiefData });

    // Reset de state — rankings opnieuw op volgorde, statistieken nul
    const gesorteerd = [...state.spelers].sort((a,b) => a.rank - b.rank);
    gesorteerd.forEach((s, i) => {
      s.rank = i + 1;
      s.partijen = 0;
      s.gewonnen = 0;
      s.prevRank = null;
    });
    state.uitslagen = [];
    state.actievePartijen = [];

    await slaState();
    closeModal('modal-nieuw-seizoen');
    renderAdmin();
    toast(`${naam} gearchiveerd ✓`);
  } catch(e) {
    archiefData.shift();
    toast('Fout bij archiveren');
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
          <span style="font-weight:600">🏅 ${t.naam}</span>
          <span style="font-size:12px;color:var(--light)">${t.datum}</span>
        </div>
        <div style="font-size:12px;color:var(--mid);margin-bottom:8px">${t.baan} · ${t.holes} holes · W=${t.ptWin} T=${t.ptTie} L=${t.ptLoss}</div>
        <div style="margin-bottom:8px">
          ${t.ranglijst?.slice(0,3).map((r,i) => `
            <span style="font-size:13px;margin-right:12px">${i===0?'🥇':i===1?'🥈':'🥉'} ${r.naam} <span style="color:var(--light)">${r.punten>0?'+':''}${r.punten}pt</span></span>
          `).join('')}
        </div>
        <button class="btn btn-sm btn-ghost" onclick="openToernooiDetail(${idx})">Bekijk uitslag →</button>
      </div>
    `).join('');
  }

  // Seizoenen
  if (archiefData.length > 0) {
    html += `<div style="padding:10px 16px 6px;margin-top:8px"><p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;letter-spacing:.5px">Seizoenen</p></div>`;
    html += archiefData.map((s, idx) => {
      const winnaar = s.eindstand?.[0];
      return `
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:600;font-size:16px">${s.naam}</span>
          <span style="font-size:12px;color:var(--light)">${s.datum}</span>
        </div>
        ${winnaar ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-family:'Bebas Neue';font-size:18px;color:var(--gold)">🏆</span>
          <span style="font-weight:600">${winnaar.naam}</span>
        </div>` : ''}
        <div style="display:flex;gap:8px">
          <span class="badge badge-grey">${s.eindstand?.length || 0} spelers</span>
          <button class="btn btn-sm btn-ghost" onclick="openArchiefDetail(${idx})" style="margin-left:auto">Bekijk →</button>
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

  let html = `<p style="font-size:13px;color:var(--light);margin-bottom:16px">${t.datum} · ${t.baan} · ${t.holes} holes</p>`;

  // Ranglijst
  html += `<p style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:8px">Eindranglijst</p>`;
  html += `<div style="margin-bottom:16px">`;
  t.ranglijst?.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:16px;min-width:28px">${medal}</span>
      <span style="flex:1;font-weight:500">${r.naam}</span>
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
      html += `<th style="padding:4px 6px;background:var(--green);color:white;text-align:center">${n}</th>`;
    });
    html += '</tr>';
    t.spelerNamen.forEach((naam, i) => {
      html += `<tr><td style="padding:4px 8px;font-weight:600">${naam}</td>`;
      t.spelerNamen.forEach((_, j) => {
        // Ondersteun zowel oud array formaat als nieuw object formaat
        const cel = Array.isArray(t.matrix) ? (t.matrix[i]?.[j] || '-') : (t.matrix[`${i}_${j}`] || '-');
        const bg = cel === 'W' ? '#d4edda' : cel === 'L' ? '#f8d7da' : cel === 'T' ? '#fff3cd' : '#f0ede4';
        const tx = cel === 'W' ? 'UP' : cel === 'L' ? 'DOWN' : cel === 'T' ? 'TIED' : (cel === 'X' ? '—' : '—');
        html += `<td style="background:${bg};text-align:center;padding:4px;font-weight:700">${tx}</td>`;
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
    html += `<div style="font-size:12px;color:var(--mid);margin-bottom:16px;padding:8px 10px;background:#f9f7f2;border-radius:8px">
      ⛳ ${baanSamenvatting}
    </div>`;
  }

  // Eindstand — actieve spelers
  html += `<div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Eindstand</div>`;
  actief.forEach(sp => {
    const winpct = sp.partijen > 0 ? Math.round(sp.gewonnen / sp.partijen * 100) : 0;
    const verloren = (sp.partijen || 0) - (sp.gewonnen || 0);
    html += `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f0ede4">
      <span style="font-family:'Bebas Neue';font-size:20px;color:${sp.rank<=3?'var(--gold)':'var(--light)'};min-width:28px">${sp.rank}</span>
      <span style="flex:1;font-weight:500;font-size:14px">${sp.naam}</span>
      <span style="font-size:11px;color:var(--mid);font-family:'DM Mono',monospace">${sp.partijen}G ${sp.gewonnen}W ${verloren}V ${winpct}%</span>
      <span style="font-size:11px;color:var(--light)">hcp ${sp.hcp}</span>
    </div>`;
  });

  // Niet gespeeld
  if (inactief.length > 0) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Niet gespeeld</div>`;
    inactief.forEach(sp => {
      html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f0ede4">
        <span style="font-family:'Bebas Neue';font-size:20px;color:var(--light);min-width:28px">${sp.rank}</span>
        <span style="flex:1;font-size:13px;color:var(--light)">${sp.naam}</span>
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

function toonUitdagingBadge() {
  const open = uitdagingenData.filter(u =>
    u.naarEmail === huidigeBruiker?.email && u.status === 'open'
  );
  const profielBtn = document.getElementById('nav-profiel-btn');
  if (open.length > 0) {
    profielBtn.textContent = `👤 Profiel (${open.length})`;
  } else {
    profielBtn.textContent = '👤 Profiel';
  }
}

async function stuurUitdaging(naarSpelerId) {

  try {
  const naarSpeler = state.spelers.find(s => s.id === naarSpelerId);
  if (!naarSpeler) return;

  // Zoek e-mail van ontvanger in users lijst
  const users = await getUsers();
  const naarUser = users.find(u => {
    const naam = (u.gebruikersnaam || '').toLowerCase();
    const spelernaam = naarSpeler.naam.toLowerCase();
    return naam === spelernaam || spelernaam.includes(naam) || naam.includes(spelernaam.split(' ')[0]);
  });

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
    naarNaam: naarUser.gebruikersnaam || naarSpeler.naam,
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

  toast(`Uitdaging verstuurd naar ${naarSpeler.naam.split(' ')[0]} ✓`);
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
    // Notificeer uitdager
    const vanUser = (await getUsers())?.find(u => u.email === uitdagingenData[idx].vanEmail);
    if (vanUser?.uid) {
      await stuurNotificatie(vanUser.uid, '✅ Uitdaging geaccepteerd!', `${huidigeBruiker.gebruikersnaam} heeft je uitdaging geaccepteerd`);
    }
  } else {
    toast('Uitdaging geweigerd.');
  }

  toonUitdagingBadge();
  renderProfiel();
  } catch(e) { console.error('reageerUitdaging mislukt:', e); }
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

export { bevestigNieuwSeizoen, openArchiefDetail, openNieuwSeizoenModal, openToernooiDetail, reageerUitdaging, renderArchief, stuurNotificatie, stuurUitdaging, toonUitdagingBadge, verwijderOudeUitslagen, verwijderUitdaging };;;
