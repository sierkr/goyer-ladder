// ============================================================
//  admin.js
// ============================================================
import { db, auth, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL, SNAPSHOTS_COL, SPELERS_DOC, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC, INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB } from './config.js';
import { store } from './store.js';
import * as S from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers, getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { openNieuweLadderModal, renderAdminLadders } from './beheer.js';
import { reageerUitdaging, verwijderUitdaging } from './archief.js';
import { renderLadder } from './ladder.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

//  ADMIN
// ============================================================
function renderAdmin() {
  const isBeheerder = isBeheerderRol();
  const isCoord = isCoordinatorRol();

  // Verberg beheerder-only secties voor coordinator
  ['admin-sectie-spelers','admin-sectie-seizoen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isBeheerder ? '' : 'none';
  });

  // Ladders sectie altijd zichtbaar voor coordinator en beheerder
  const ladderSectie = document.getElementById('admin-sectie-ladders');
  if (ladderSectie) ladderSectie.style.display = isCoord ? '' : 'none';

  // + Ladder knop alleen voor beheerder
  const nieuweLadderBtn = ladderSectie?.querySelector('button[onclick="openNieuweLadderModal()"]');
  if (nieuweLadderBtn) nieuweLadderBtn.style.display = isBeheerder ? '' : 'none';

  if (!isCoord) return;

  if (isBeheerder) {
    renderAdminSpelersEnAccounts();
  }

  renderAdminLadders();
}

async function renderAdminSpelersEnAccounts() {
  const list = document.getElementById('admin-player-list');
  if (!list) return;

  // Laad accounts
  let users = [];
  try {
    users = await getUsers();
  } catch(e) {}

  // Combineer spelers met accounts
  const sorted = [...alleSpelersData].sort((a,b) => a.naam.localeCompare(b.naam, 'nl'));

  // Spelers met of zonder account
  const rijen = sorted.map(s => {
    const account = users.find(u =>
      u.gebruikersnaam?.toLowerCase() === s.naam.toLowerCase() ||
      (u.uid && u.uid === s.uid)
    );
    const ladders = alleLadders.filter(l => (l.spelers || []).some(sp => sp.id === s.id));
    const ladderBadges = ladders.map(l => `<span class="badge badge-grey" style="font-size:10px">${l.naam}</span>`).join(' ');
    const rolBadge = account?.rol && account.rol !== 'speler'
      ? `<span class="badge" style="font-size:10px;background:var(--green-pale);color:var(--green)">${account.rol}</span>`
      : '';
    const emailTekst = account?.email
      ? `<span style="font-size:11px;color:var(--light)">${account.email}</span>`
      : `<span style="font-size:11px;color:#ccc">geen account</span>`;

    return `<div class="admin-row" style="flex-wrap:nowrap;gap:6px;align-items:center">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.naam}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          ${emailTekst}
          ${rolBadge}
        </div>
        ${ladderBadges ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px">${ladderBadges}</div>` : ''}
      </div>
      <span style="font-size:12px;color:var(--mid);font-family:'DM Mono',monospace;flex-shrink:0;white-space:nowrap">hcp ${Math.round(s.hcp)}</span>
      <button class="btn btn-sm btn-ghost" onclick="openEditPlayer(${s.id})">✏️</button>
      <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removePlayer(${s.id})">✕</button>
    </div>`;
  });

  // Accounts zonder speler
  const accountsZonderSpeler = users.filter(u =>
    !alleSpelersData.some(s => s.naam.toLowerCase() === u.gebruikersnaam?.toLowerCase())
  );
  const extraRijen = accountsZonderSpeler.map(u => {
    const rolBadge = u.rol && u.rol !== 'speler'
      ? `<span class="badge" style="font-size:10px;background:var(--green-pale);color:var(--green)">${u.rol}</span>`
      : '';
    return `<div class="admin-row" style="flex-wrap:wrap;gap:4px">
      <div style="flex:1;min-width:120px">
        <div style="font-weight:600;font-size:14px">${u.gebruikersnaam || u.naam || '—'}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          <span style="font-size:11px;color:var(--light)">${u.email}</span>
          ${rolBadge}
          <span class="badge badge-grey" style="font-size:10px">geen ladder</span>
        </div>
      </div>
      <span style="font-size:12px;color:var(--mid);font-family:'DM Mono',monospace;flex-shrink:0">hcp —</span>
      <button class="btn btn-sm btn-ghost" onclick="openEditUser(${users.indexOf(u)})">✏️</button>
      <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removeUser(${users.indexOf(u)})">✕</button>
    </div>`;
  });

  list.innerHTML = rijen.length + extraRijen.length === 0
    ? '<div class="empty"><div class="empty-icon">👤</div><p>Geen spelers.</p></div>'
    : [...rijen, ...extraRijen].join('');
}

async function openAddPlayer() {
  // Reset
  document.getElementById('new-player-name').value = '';
  document.getElementById('new-player-hcp').value = '';
  document.getElementById('new-player-account').value = '';
  document.getElementById('new-player-pass').value = '';
  document.getElementById('add-player-handmatig').style.display = 'none';
  document.getElementById('add-player-accounts-wrap').style.display = 'block';
  document.getElementById('add-player-save-btn').style.display = 'none';

  // Laad accounts die nog geen speler zijn
  try {
    const users = await getUsers();
    const spelersIds = alleSpelersData.map(s => s.id);
    const nogGeen = users.filter(u =>
      !alleSpelersData.some(s => s.naam.toLowerCase() === (u.gebruikersnaam || u.naam || '').toLowerCase()) &&
      !spelersIds.includes(u.uid)
    );

    const lijst = document.getElementById('add-player-accounts-lijst');
    if (nogGeen.length === 0) {
      lijst.innerHTML = '<p style="font-size:13px;color:var(--light);padding:8px 0">Alle geregistreerde accounts zijn al speler.</p>';
    } else {
      lijst.innerHTML = nogGeen.map(u => `
        <div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:10px">
          <div style="flex:1">
            <div style="font-weight:500">${u.gebruikersnaam || u.naam}</div>
            <div style="font-size:11px;color:var(--light)">${u.email}</div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="voegAccountToeAlsSpeler('${u.email}','${(u.gebruikersnaam||u.naam).replace(/'/g,"\\'")}')">+ Toevoegen</button>
        </div>
      `).join('');
    }
  } catch(e) {
    document.getElementById('add-player-accounts-lijst').innerHTML = '<p style="font-size:13px;color:var(--red)">Fout bij laden accounts.</p>';
  }

  document.getElementById('modal-add-player').classList.add('open');
}

function toggleHandmatigToevoegen() {
  const wrap = document.getElementById('add-player-handmatig');
  const btn = document.getElementById('add-player-save-btn');
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  btn.style.display = wrap.style.display === 'none' ? 'none' : 'inline-flex';
}

async function voegAccountToeAlsSpeler(email, naam) {

  try {
  const hcpStr = prompt(`Playing handicap voor ${naam}:`, '10');
  if (hcpStr === null) return;
  const hcp = Math.round(parseFloat(hcpStr));
  if (isNaN(hcp)) { toast('Ongeldige handicap'); return; }

  // Gebruik centrale ID teller
  const newId = getNextId();
  alleSpelersData.push({ id: newId, naam, hcp });
  await setDoc(SPELERS_DOC, { lijst: alleSpelersData });

  closeModal('modal-add-player');
  renderAdmin();
  toast(`${naam} toegevoegd aan spelersbeheer ✓ — voeg hem toe aan een ladder via Ladders beheren`);
  } catch(e) { console.error('voegAccountToeAlsSpeler mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

async function saveNewPlayer() {
  const naam = document.getElementById('new-player-name').value.trim();
  const hcp = Math.round(parseFloat(document.getElementById('new-player-hcp').value));
  const email = document.getElementById('new-player-account').value.trim().toLowerCase();
  const pass = document.getElementById('new-player-pass').value;

  if (!naam) { toast('Voer een naam in'); return; }
  if (isNaN(hcp)) { toast('Voer een handicap in'); return; }
  if (!email || !email.includes('@')) { toast('Voer een geldig e-mailadres in'); return; }
  if (pass.length < 6) { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    const users = await getUsers();

    if (users.find(u => u.email === email)) {
      toast('Dit e-mailadres is al in gebruik'); return;
    }

    // Maak Firebase Auth account aan via secundaire app
    let uid = null;
    try {
      const { initializeApp: initApp, deleteApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getAuth: getSecAuth, createUserWithEmailAndPassword: createUser } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      const tijdApp = initApp(firebaseConfig, `tmp_${Date.now()}`);
      const tijdAuth = getSecAuth(tijdApp);
      const cred = await createUser(tijdAuth, email, pass);
      uid = cred.user.uid;
      try { await deleteApp(tijdApp); } catch(e) {}
    } catch(authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        toast('E-mailadres al in gebruik in Firebase. Verwijder het eerst via Firebase Console → Authentication.'); return;
      }
      throw authErr;
    }

    // Voeg alleen toe aan master spelerslijst, niet aan een specifieke ladder
    const newId = getNextId();
    alleSpelersData.push({ id: newId, naam, hcp });
    await setDoc(SPELERS_DOC, { lijst: alleSpelersData });
    // Sla nextId op
    await slaState();

    // Voeg account toe aan users lijst
    users.push({ uid, email, gebruikersnaam: naam, rol: 'speler' });
    await saveUsers(sorteerUsers(users));

    closeModal('modal-add-player');
    renderAdmin();
    toast(`${naam} toegevoegd aan spelersbeheer ✓ — voeg hem toe aan een ladder via Ladders beheren`);
  } catch(e) {
    console.error('saveNewPlayer error:', e);
    toast('Fout bij opslaan: ' + e.message);
  }
}

async function openEditPlayer(id) {
  let s = alleSpelersData.find(p => p.id === id);
  if (!s) s = state.spelers.find(p => p.id === id);
  if (!s) {
    for (const l of alleLadders) {
      s = (l.spelers || []).find(p => p.id === id);
      if (s) break;
    }
  }
  if (!s) { toast('Speler niet gevonden'); return; }

  document.getElementById('edit-player-id').value = id;
  document.getElementById('edit-player-name').value = s.naam;
  document.getElementById('edit-player-hcp').value = Math.round(s.hcp);

  // Laad rol en email uit accounts
  try {
    const users = await getUsers();
    const account = users.find(u => u.gebruikersnaam?.toLowerCase() === s.naam.toLowerCase());
    const rolEl = document.getElementById('edit-player-rol');
    const emailEl = document.getElementById('edit-player-email-info');
    if (account) {
      rolEl.value = account.rol || 'speler';
      emailEl.textContent = `📧 ${account.email}`;
    } else {
      rolEl.value = 'speler';
      emailEl.textContent = 'Geen account gekoppeld';
    }
  } catch(e) {
    document.getElementById('edit-player-rol').value = 'speler';
  }

  document.getElementById('modal-edit-player').classList.add('open');
}

async function saveEditPlayer() {
  const id = parseInt(document.getElementById('edit-player-id').value);
  const naam = document.getElementById('edit-player-name').value.trim();
  const hcp = Math.round(parseFloat(document.getElementById('edit-player-hcp').value));
  if (!naam) { toast('Voer een naam in'); return; }
  if (isNaN(hcp)) { toast('Voer een handicap in'); return; }
  let s = state.spelers.find(p => p.id === id);
  if (!s) {
    for (const l of alleLadders) {
      s = (l.spelers || []).find(p => p.id === id);
      if (s) break;
    }
  }
  if (!s) { toast('Speler niet gevonden'); return; }
  const oudeNaam = s.naam;
  s.naam = naam;
  s.hcp = hcp;
  // Update master spelerslijst
  const masterSpeler = alleSpelersData.find(ms => ms.id === id);
  if (masterSpeler) { masterSpeler.naam = naam; masterSpeler.hcp = hcp; }
  await setDoc(SPELERS_DOC, { lijst: alleSpelersData });
  await slaState();

  // Sync naam/hcp naar alle andere ladders
  for (const ladder of alleLadders) {
    if (ladder.id === activeLadderId) continue;
    const snap = await getDoc(doc(db, 'ladders', ladder.id));
    if (!snap.exists()) continue;
    const data = snap.data();
    const spelerInLadder = (data.spelers || []).find(sp => sp.id === id);
    if (spelerInLadder) {
      spelerInLadder.naam = naam;
      spelerInLadder.hcp = hcp;
      await setDoc(doc(db, 'ladders', ladder.id), data);
      ladder.spelers = data.spelers;
    }
  }

  // Update gebruikersnaam en rol in accounts lijst
  try {
    const users = await getUsers();
    const rol = document.getElementById('edit-player-rol').value;
    const user = users.find(u =>
      u.gebruikersnaam?.toLowerCase() === oudeNaam.toLowerCase() ||
      u.gebruikersnaam?.toLowerCase() === oudeNaam.split(' ')[0].toLowerCase()
    );
    if (user) {
      user.gebruikersnaam = naam;
      user.rol = rol;
      await saveUsers(users);
    }
  } catch(e) { console.error('Naam/rol update account mislukt:', e); }

  closeModal('modal-edit-player');
  renderAdmin();
  toast('Speler bijgewerkt ✓');
}

async function removePlayer(id) {

  try {
  if (!confirm('Speler verwijderen uit alle ladders?')) return;
  // Verwijder uit master spelerslijst
  alleSpelersData = alleSpelersData.filter(s => s.id !== id);
  await setDoc(SPELERS_DOC, { lijst: alleSpelersData });
  // Verwijder uit actieve ladder
  state.spelers = state.spelers.filter(s => s.id !== id);
  state.spelers.sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);
  await slaState();
  // Verwijder ook uit andere ladders
  for (const ladder of alleLadders) {
    if (ladder.id === activeLadderId) continue;
    const snap = await getDoc(doc(db, 'ladders', ladder.id));
    if (!snap.exists()) continue;
    const data = snap.data();
    if ((data.spelers || []).find(s => s.id === id)) {
      data.spelers = data.spelers.filter(s => s.id !== id);
      data.spelers.sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);
      data.spelerIds = (data.spelerIds || []).filter(sid => sid !== id);
      await setDoc(doc(db, 'ladders', ladder.id), data);
      ladder.spelers = data.spelers;
    }
  }
  renderAdmin();
  toast('Speler verwijderd uit alle ladders');
  } catch(e) { console.error('removePlayer mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  PROFIEL
// ============================================================
function renderProfiel() {
  if (!huidigeBruiker) return;

  // Zoek gekoppelde speler
  const gebruiker = huidigeBruiker.gebruikersnaam.toLowerCase();
  const speler = state.spelers.find(s => {
    const naam = s.naam.toLowerCase();
    const voornaam = naam.split(' ')[0];
    return naam === gebruiker || voornaam === gebruiker ||
           naam.replace(/\s/g,'') === gebruiker.replace(/\./g,'').replace(/\s/g,'') ||
           naam.replace(/\s/g,' ') === gebruiker;
  });

  // Profiel info
  document.getElementById('profiel-info').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:4px">
      <div style="width:52px;height:52px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:24px;color:var(--gold-light)">
        ${huidigeBruiker.gebruikersnaam[0].toUpperCase()}
      </div>
      <div>
        <div style="font-weight:600;font-size:17px">${huidigeBruiker.gebruikersnaam}</div>
        <div style="font-size:13px;color:var(--light)">${huidigeBruiker.email}</div>
        <span class="badge ${huidigeBruiker.rol === 'beheerder' ? 'badge-gold' : huidigeBruiker.rol === 'coordinator' ? 'badge-green' : 'badge-grey'}" style="margin-top:4px">${huidigeBruiker.rol}</span>
      </div>
    </div>`;

  // Statistieken per ladder
  if (!speler) {
    document.getElementById('profiel-stats').innerHTML = '<p style="color:var(--light);font-size:13px">Nog geen spelersprofiel gekoppeld aan dit account.</p>';
    return;
  }

  // Zoek speler in alle ladders
  const ladderStats = alleLadders.map(l => {
    const sp = (l.spelers || []).find(s =>
      s.id === speler.id ||
      s.naam.toLowerCase() === speler.naam.toLowerCase()
    );
    if (!sp) return null;
    const winpct = sp.partijen > 0 ? Math.round(sp.gewonnen / sp.partijen * 100) : 0;
    const verloren = (sp.partijen || 0) - (sp.gewonnen || 0);
    return { ladder: l, sp, winpct, verloren };
  }).filter(Boolean);

  // Totaal over alle ladders
  const totaalPartijen = ladderStats.reduce((s, l) => s + (l.sp.partijen || 0), 0);
  const totaalGewonnen = ladderStats.reduce((s, l) => s + (l.sp.gewonnen || 0), 0);
  const totaalPct = totaalPartijen > 0 ? Math.round(totaalGewonnen / totaalPartijen * 100) : 0;
  const totaalVerloren = totaalPartijen - totaalGewonnen;

  let html = '';

  // Per ladder stats
  ladderStats.forEach(({ ladder, sp, winpct, verloren }) => {
    html += `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${ladder.naam}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <div style="text-align:center;background:var(--green-pale);border-radius:10px;padding:10px">
          <div style="font-family:'Bebas Neue';font-size:28px;color:var(--green)">${sp.rank}</div>
          <div style="font-size:10px;color:var(--light);text-transform:uppercase">Ranking</div>
        </div>
        <div style="text-align:center;background:#fef3cd;border-radius:10px;padding:10px">
          <div style="font-family:'Bebas Neue';font-size:28px;color:var(--gold)">${winpct}%</div>
          <div style="font-size:10px;color:var(--light);text-transform:uppercase">Winpct</div>
        </div>
        <div style="text-align:center;background:#f0ede4;border-radius:10px;padding:10px">
          <div style="font-family:'Bebas Neue';font-size:28px;color:var(--mid)">${sp.partijen || 0}</div>
          <div style="font-size:10px;color:var(--light);text-transform:uppercase">Gespeeld</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--mid)">✓ ${sp.gewonnen || 0} gewonnen &nbsp; ✗ ${verloren} verloren &nbsp; 🏒 hcp ${Math.round(sp.hcp)}</div>
    </div>`;
  });

  // Totaal als er meerdere ladders zijn
  if (ladderStats.length > 1) {
    html += `
    <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
      <div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Totaal</div>
      <div style="font-size:13px;color:var(--mid)">✓ ${totaalGewonnen} gewonnen &nbsp; ✗ ${totaalVerloren} verloren &nbsp; ${totaalPct}% winpercentage</div>
    </div>`;
  }

  if (ladderStats.length === 0) {
    html = '<p style="color:var(--light);font-size:13px">Niet ingedeeld in een ladder.</p>';
  }

  document.getElementById('profiel-stats').innerHTML = html;

  const mijnUitdagingen = uitdagingenData.filter(u =>
    u.vanEmail === huidigeBruiker.email || u.naarEmail === huidigeBruiker.email
  );

  const openOntvangen = mijnUitdagingen.filter(u => u.naarEmail === huidigeBruiker.email && u.status === 'open');
  const openVerstuurd = mijnUitdagingen.filter(u => u.vanEmail === huidigeBruiker.email && u.status === 'open');

  if (mijnUitdagingen.length > 0) {
    let uitdHtml = '<div style="margin-top:16px;padding-top:16px;border-top:1px solid #f0ede4">';
    uitdHtml += '<div style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:10px">Uitdagingen</div>';

    if (openOntvangen.length > 0) {
      openOntvangen.forEach(u => {
        uitdHtml += `<div style="background:#fef3cd;border-radius:10px;padding:12px;margin-bottom:8px">
          <div style="font-weight:600;margin-bottom:6px">⚔️ ${u.vanNaam} daagt je uit!</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-primary" onclick="reageerUitdaging('${u.id}',true)">✓ Accepteer</button>
            <button class="btn btn-sm btn-ghost" onclick="reageerUitdaging('${u.id}',false)" style="color:var(--red)">✗ Weiger</button>
          </div>
        </div>`;
      });
    }

    if (openVerstuurd.length > 0) {
      openVerstuurd.forEach(u => {
        uitdHtml += `<div style="background:#f0ede4;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px">⏳ Wacht op <strong>${u.naarNaam}</strong></div>
          <button onclick="verwijderUitdaging('${u.id}')" style="background:none;border:none;color:var(--light);cursor:pointer;font-size:18px">✕</button>
        </div>`;
      });
    }

    const afgerond = mijnUitdagingen.filter(u => u.status !== 'open');
    afgerond.slice(0, 3).forEach(u => {
      const isVan = u.vanEmail === huidigeBruiker.email;
      const ander = isVan ? u.naarNaam : u.vanNaam;
      const kleur = u.status === 'geaccepteerd' ? 'var(--green)' : 'var(--light)';
      const icoon = u.status === 'geaccepteerd' ? '✅' : '❌';
      uitdHtml += `<div style="font-size:12px;color:var(--light);padding:4px 0">${icoon} ${isVan ? 'Uitdaging aan' : 'Uitdaging van'} ${ander} — ${u.status}</div>`;
    });

    uitdHtml += '</div>';
    document.getElementById('profiel-stats').innerHTML += uitdHtml;
  }

  // Vul huidige handicap in
  const hcpInput = document.getElementById('profiel-hcp-input');
  if (hcpInput && speler) hcpInput.value = Math.round(speler.hcp);
}

async function slaProfielHcpOp() {

  try {
  const val = parseFloat(document.getElementById('profiel-hcp-input').value);
  if (isNaN(val)) { toast('Voer een geldige handicap in'); return; }

  const gebruiker = huidigeBruiker.gebruikersnaam.toLowerCase().trim();
  const voornaam = gebruiker.split(' ')[0];

  const matchNaam = (naam) => {
    const n = naam.toLowerCase().trim();
    return n === gebruiker || n.split(' ')[0] === voornaam || n.includes(voornaam) || gebruiker.includes(n.split(' ')[0]);
  };

  // Update in master spelerslijst — alleen beheerder mag ladder/spelers schrijven
  const masterSpeler = alleSpelersData.find(s => matchNaam(s.naam));
  if (masterSpeler && isCoordinatorRol()) {
    masterSpeler.hcp = val;
    await setDoc(SPELERS_DOC, { lijst: alleSpelersData });
  } else if (masterSpeler) {
    masterSpeler.hcp = val; // update lokaal voor renderProfiel
  }

  // Update in alle ladders
  let gevonden = false;
  for (const ladder of alleLadders) {
    const snap = await getDoc(doc(db, 'ladders', ladder.id));
    if (!snap.exists()) continue;
    const data = snap.data();
    const speler = (data.spelers || []).find(s => matchNaam(s.naam));
    if (speler) {
      speler.hcp = val;
      await setDoc(doc(db, 'ladders', ladder.id), data);
      gevonden = true;
      // Update actieve state ook
      if (ladder.id === activeLadderId) {
        const sp = state.spelers.find(s => matchNaam(s.naam));
        if (sp) sp.hcp = val;
      }
    }
  }

  if (!gevonden && !masterSpeler) { toast('Geen gekoppeld spelersprofiel gevonden'); return; }
  toast('Playing Handicap bijgewerkt ✓');
  renderProfiel();
  } catch(e) { console.error('slaProfielHcpOp mislukt:', e); }
}

// ============================================================
//  ADMIN — GEBRUIKERS (Firebase Auth versie)
// ============================================================

// Sorteer gebruikers op achternaam (laatste woord van gebruikersnaam)
function sorteerUsers(users) {
  return [...users].sort((a, b) => {
    const naamA = (a.gebruikersnaam || a.naam || a.email || '').trim();
    const naamB = (b.gebruikersnaam || b.naam || b.email || '').trim();
    const achternaamA = naamA.split(' ').pop();
    const achternaamB = naamB.split(' ').pop();
    return achternaamA.localeCompare(achternaamB, 'nl');
  });
}

async function renderAdminUsers() {
  const list = document.getElementById('admin-user-list');
  list.innerHTML = '<div style="padding:12px 16px;color:var(--light);font-size:13px">Laden…</div>';
  try {
    const users = await getUsers();
    if (users.length === 0) {
      list.innerHTML = '<div class="empty"><p>Nog geen accounts.<br><small style="color:var(--light)">Standaard: beheerder / golf2025</small></p></div>';
      return;
    }
    const gesorteerd = sorteerUsers(users);
    list.innerHTML = gesorteerd.map((u) => {
      const origIdx = users.findIndex(x => x.email === u.email || x.gebruikersnaam === u.gebruikersnaam);
      return `
      <div class="admin-row">
        <div style="flex:1">
          <div class="name">${u.gebruikersnaam || u.naam || u.email?.split('@')[0]}</div>
          <div style="font-size:11px;color:var(--light)">${u.email || ''}</div>
        </div>
        <span class="badge ${u.rol === 'beheerder' ? 'badge-gold' : u.rol === 'coordinator' ? 'badge-green' : 'badge-grey'}">${u.rol}</span>
        <button class="btn btn-sm btn-ghost" onclick="openEditUser(${origIdx})">✏️</button>
        <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removeUser(${origIdx})">✕</button>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('renderAdminUsers fout:', e);
    list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:13px">Fout bij laden: ' + e.message + '</div>';
  }
}

async function openEditUser(idx) {
  try {
    const users = await getUsers();
    const u = users[idx];
    if (!u) return;
    document.getElementById('edit-user-name').value = u.gebruikersnaam;
    document.getElementById('edit-user-pass').value = '';
    document.getElementById('edit-user-rol').value = u.rol;
    document.getElementById('edit-user-idx').value = idx;
    document.getElementById('modal-edit-user').classList.add('open');
  } catch(e) { toast('Fout bij laden'); }
}

async function saveEditUser() {
  const idx = parseInt(document.getElementById('edit-user-idx').value);
  const naam = document.getElementById('edit-user-name').value.trim();
  const pass = document.getElementById('edit-user-pass').value;
  const rol = document.getElementById('edit-user-rol').value;
  if (!naam) { toast('Voer een gebruikersnaam in'); return; }
  if (pass && pass.length < 6) { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    const users = await getUsers();
    // Check duplicate name (ignore self)
    if (users.find((u, i) => u.gebruikersnaam === naam && i !== idx)) {
      toast('Gebruikersnaam al in gebruik'); return;
    }
    users[idx].gebruikersnaam = naam;
    users[idx].rol = rol;
    if (pass) users[idx].wachtwoord = pass;
    await saveUsers(sorteerUsers(users));
    closeModal('modal-edit-user');
    renderAdmin();
    toast('Account bijgewerkt ✓');
  } catch(e) { toast('Fout bij opslaan'); }
}

function openAddUser() {
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-pass').value = '';
  document.getElementById('new-user-rol').value = 'speler';
  document.getElementById('modal-add-user').classList.add('open');
}

async function saveNewUser() {
  const email = document.getElementById('new-user-name').value.trim().toLowerCase();
  const pass = document.getElementById('new-user-pass').value;
  const rol = document.getElementById('new-user-rol').value;
  if (!email || !email.includes('@')) { toast('Voer een geldig e-mailadres in'); return; }
  if (pass.length < 6) { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    // Maak Firebase Auth account aan via secundaire app-instantie
    const { initializeApp: initApp2, deleteApp: deleteApp2 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getAuth: getSecAuth2, createUserWithEmailAndPassword: createUser2 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

    const tijdelijkeApp2 = initApp2(firebaseConfig, `temp_user_${Date.now()}`);
    const tijdelijkeAuth2 = getSecAuth2(tijdelijkeApp2);

    let uid;
    try {
      const userCred = await createUser2(tijdelijkeAuth2, email, pass);
      uid = userCred.user.uid;
      try { await deleteApp2(tijdelijkeApp2); } catch(e) {}
    } catch(authErr) {
      try { await deleteApp2(tijdelijkeApp2); } catch(e) {}
      if (authErr.code === 'auth/email-already-in-use') { toast('Dit e-mailadres is al in gebruik'); return; }
      else if (authErr.code === 'auth/invalid-email') { toast('Ongeldig e-mailadres'); return; }
      else { toast('Fout bij aanmaken: ' + authErr.message); return; }
    }

    const users = await getUsers();
    const gebruikersnaam = email.split('@')[0].replace(/[^a-z0-9 ]/g, '');
    users.push({ uid, email, gebruikersnaam, rol });
    await saveUsers(sorteerUsers(users));
    closeModal('modal-add-user');
    renderAdmin();
    toast('Account aangemaakt ✓');
  } catch(e) {
    toast('Fout bij opslaan: ' + e.message);
  }
}

async function removeUser(idx) {
  try {
    const users = await getUsers();
    const user = users[idx];
    if (!user) return;

    if (!confirm(`Account van ${user.gebruikersnaam || user.naam} verwijderen? De speler wordt ook uit alle ladders en spelers beheer verwijderd.`)) return;

    const gebruikersnaam = (user.gebruikersnaam || user.naam || '').toLowerCase();

    // Verwijder uit users lijst
    users.splice(idx, 1);
    await saveUsers(users);

    // Zoek speler ID op naam in master lijst
    const masterSpeler = alleSpelersData.find(s => s.naam.toLowerCase() === gebruikersnaam);
    if (masterSpeler) {
      const spelerId = masterSpeler.id;

      // Verwijder uit master spelerslijst
      alleSpelersData = alleSpelersData.filter(s => s.id !== spelerId);
      await setDoc(SPELERS_DOC, { lijst: alleSpelersData });

      // Verwijder uit alle ladders
      for (const ladder of alleLadders) {
        const ladderSnap = await getDoc(doc(db, 'ladders', ladder.id));
        if (!ladderSnap.exists()) continue;
        const data = ladderSnap.data();
        const hadSpeler = (data.spelers || []).some(s => s.id === spelerId);
        if (!hadSpeler) continue;
        data.spelers = (data.spelers || []).filter(s => s.id !== spelerId);
        data.spelerIds = (data.spelerIds || []).filter(id => id !== spelerId);
        // Herbereken ranks
        data.spelers.sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i+1);
        await setDoc(doc(db, 'ladders', ladder.id), data);
        ladder.spelers = data.spelers;
        if (ladder.id === activeLadderId) state.spelers = data.spelers;
      }
    }

    renderAdmin();
    renderAdmin();
    renderLadder();
    toast('Account en speler verwijderd ✓');
  } catch(e) { console.error(e); toast('Fout bij verwijderen: ' + e.message); }
}

// ============================================================
//  HELPERS
// ============================================================

async function verschuifRank(id, delta) {

  try {
  const speler = state.spelers.find(s => s.id === id);
  if (!speler) return;

  const nieuwRank = speler.rank + delta;
  if (nieuwRank < 1 || nieuwRank > state.spelers.length) return;

  // Wissel van positie met de speler die momenteel die rank heeft
  const ander = state.spelers.find(s => s.rank === nieuwRank);
  if (ander) ander.rank = speler.rank;
  speler.rank = nieuwRank;

  await slaState();
  renderAdmin();
  } catch(e) { console.error('verschuifRank mislukt:', e); }
}

function resetData() {
  toast('Reset is momenteel uitgeschakeld');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) o.classList.remove('open');
  });
});

// ============================================================

export { renderAdmin, renderAdminSpelersEnAccounts, openAddPlayer, toggleHandmatigToevoegen, voegAccountToeAlsSpeler, saveNewPlayer, openEditPlayer, saveEditPlayer, removePlayer, renderProfiel, slaProfielHcpOp, sorteerUsers, renderAdminUsers, openEditUser, saveEditUser, openAddUser, saveNewUser, removeUser, verschuifRank, resetData, closeModal };
