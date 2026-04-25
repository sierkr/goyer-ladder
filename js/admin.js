// ============================================================
//  admin.js — v2.7.0 — fase 3 refactor
//  Primaire identifier: uid (Firebase Auth uid)
//  Bron van waarheid:   spelers/{uid}
//  Backward compat:     dual-write naar ladders.spelers[] en ladder/spelers
//                       voor fase 4-5 modules
// ============================================================
import { db, auth, firebaseConfig, LADDERS_COL, TOERNOOIEN_COL, UITSLAGEN_COL,
  SNAPSHOTS_COL, ARCHIEF_DOC, UITDAGINGEN_DOC, USERS_DOC,
  INVITE_DOC, BANEN_DOC, DEFAULT_STATE, BANEN_DB, esc, escAttr,
  EMAIL_SUFFIX, INITIEEL_WACHTWOORD, DEFAULT_HCP,
  genereerEmail, loginNaamVan,
  functions, httpsCallable } from './config.js';
import { store, state, alleLadders, activeLadderId,
  huidigeBruiker, uitdagingenData } from './store.js';
import { slaState, getLadderData, getLadderConfig, getUsers, saveUsers,
  getNextId, isBeheerderRol, isCoordinatorRol, toast, laadUitdagingen } from './auth.js';
import { openNieuweLadderModal, renderAdminLadders } from './beheer.js';
import { reageerUitdaging, verwijderUitdaging } from './archief.js';
import { renderLadder } from './ladder.js';
import { getLadderSpelers } from './ladder-view.js';
import { syncStandenNaBevestigUitslag } from './ronde.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc,
  deleteDoc, getDocs, addDoc, query, where, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initApp } from './auth.js';

// ============================================================
//  ADMIN — HOOFD RENDER
// ============================================================

function renderAdmin() {
  const isBeheerder = isBeheerderRol();
  const isCoord     = isCoordinatorRol();

  ['admin-sectie-spelers','admin-sectie-seizoen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isBeheerder ? '' : 'none';
  });
  const ladderSectie = document.getElementById('admin-sectie-ladders');
  if (ladderSectie) ladderSectie.style.display = isCoord ? '' : 'none';
  const nieuweLadderBtn = ladderSectie?.querySelector('button[onclick="openNieuweLadderModal()"]');
  if (nieuweLadderBtn) nieuweLadderBtn.style.display = isBeheerder ? '' : 'none';

  if (!isCoord) return;
  if (isBeheerder) renderAdminSpelersEnAccounts();
  renderAdminLadders();
}

// Render spelerslijst — gebruikt spelers/ collectie als primaire bron
async function renderAdminSpelersEnAccounts() {
  const list = document.getElementById('admin-player-list');
  if (!list) return;

  // getUsers() leest nu uit spelers/ collectie (fase 2)
  let users = [];
  try { users = await getUsers(); } catch(e) {}

  const gesorteerd = [...users].sort((a, b) =>
    (a.naam || a.gebruikersnaam || '').localeCompare(b.naam || b.gebruikersnaam || '', 'nl')
  );

  const rijen = gesorteerd.map(u => {
    const uid  = u.uid;
    const naam = u.naam || u.gebruikersnaam || '—';
    const hcp  = u.hcp != null ? u.hcp : null;

    // Ladder-lidmaatschap: controleer via spelerIds[] (uid-based, fase 1)
    // Fallback op naam-match voor ladders die nog niet gemigreerd zijn
    const mijnLadders = alleLadders.filter(l =>
      (l.spelerIds || []).includes(uid) ||
      (l.spelers   || []).some(s => s.naam?.toLowerCase() === naam.toLowerCase())
    );
    const ladderBadges = mijnLadders.map(l =>
      `<span class="badge badge-grey" style="font-size:10px">${esc(l.naam)}</span>`
    ).join(' ');

    const rolBadge = u.rol && u.rol !== 'speler'
      ? `<span class="badge" style="font-size:10px;background:var(--green-pale);color:var(--green)">${esc(u.rol)}</span>`
      : '';

    // v3.0.0-11: toon login + initieel wachtwoord i.p.v. volledig email
    // Als eersteLogin=true → wachtwoord is nog steeds MP2026
    // Als eersteLogin=false of undefined → speler heeft eigen wachtwoord
    const loginTxt = loginNaamVan(u.email || '');
    const eersteLogin = u.eersteLogin === true;
    const credRegel = u.email
      ? `<span style="font-size:11px;color:var(--light);font-family:'DM Mono',monospace">${esc(loginTxt)}${eersteLogin ? ` · ${INITIEEL_WACHTWOORD}` : ''}</span>${eersteLogin ? '' : '<span style="font-size:10px;color:var(--light);margin-left:4px">· wachtwoord gewijzigd</span>'}`
      : `<span style="font-size:11px;color:#ccc">geen account</span>`;
    const hcpTekst = hcp != null
      ? `hcp ${Math.round(hcp)}`
      : 'hcp —';

    // v3.0.0-11.2: reset-wachtwoord knop, alleen voor beheerder
    // Toont alleen als speler al eersteLogin heeft voltooid (anders is reset overbodig)
    const isBeheerder = isBeheerderRol();
    const heeftEigenWachtwoord = u.eersteLogin === false;
    const resetBtn = (isBeheerder && heeftEigenWachtwoord)
      ? `<button class="btn btn-sm btn-ghost" onclick="vraagResetWachtwoord('${escAttr(uid)}','${escAttr(naam)}')" title="Wachtwoord resetten">🔄</button>`
      : '';

    // Buttons gebruiken uid (string) als identifier
    return `<div class="admin-row" style="flex-wrap:nowrap;gap:6px;align-items:center">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(naam)}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:2px">
          ${credRegel} ${rolBadge}
        </div>
        ${mijnLadders.length ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px">${ladderBadges}</div>` : ''}
      </div>
      <span style="font-size:12px;color:var(--mid);font-family:'DM Mono',monospace;flex-shrink:0;white-space:nowrap">${hcpTekst}</span>
      ${resetBtn}
      <button class="btn btn-sm btn-ghost" onclick="openEditPlayer('${escAttr(uid)}')" title="Bewerken">✏️</button>
      <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removePlayer('${escAttr(uid)}')" title="Verwijderen">✕</button>
    </div>`;
  });

  list.innerHTML = rijen.length === 0
    ? '<div class="empty"><div class="empty-icon">👤</div><p>Geen spelers.</p></div>'
    : rijen.join('');
}

// ============================================================
//  LADDER HELPERS
// ============================================================

function renderLadderCheckboxes(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (alleLadders.length === 0) {
    wrap.innerHTML = '<span style="font-size:13px;color:var(--light)">Geen ladders beschikbaar</span>';
    return;
  }
  wrap.innerHTML = alleLadders
    .filter(l => (l.data?.type || l.type) !== 'knockout')
    .map(l => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
      <input type="checkbox" value="${escAttr(l.id)}" style="width:16px;height:16px;cursor:pointer">
      ${esc(l.naam)}
    </label>`).join('');
}

function getGeselecteerdeLadders(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

// Voeg speler toe aan ladders — dual-write: spelers[] (legacy) + spelerIds[] + standen/{uid}
async function voegSpelerToeAanLadders(ladderIds, speler, uid = null) {
  for (const ladderId of ladderIds) {
    try {
      const snap = await getDoc(doc(db, 'ladders', ladderId));
      if (!snap.exists()) continue;
      const data     = snap.data();
      const spelers  = data.spelers  || [];
      const spelerIds = data.spelerIds || [];
      const maxRank  = spelers.length > 0 ? Math.max(...spelers.map(s => s.rank)) : 0;
      const newRank  = maxRank + 1;

      // Legacy spelers[] — backward compat fase 4-5
      if (!spelers.find(s => String(s.id) === String(speler.id))) {
        spelers.push({ ...speler, rank: newRank, partijen: 0, gewonnen: 0 });
      }

      // Nieuwe spelerIds[] — uid-based
      if (uid && !spelerIds.includes(uid)) {
        spelerIds.push(uid);
      }

      await setDoc(doc(db, 'ladders', ladderId), { ...data, spelers, spelerIds });

      // standen/{uid} aanmaken
      if (uid) {
        await setDoc(doc(db, 'ladders', ladderId, 'standen', uid),
          { rank: newRank, partijen: 0, gewonnen: 0 });
      }

      const idx = alleLadders.findIndex(l => l.id === ladderId);
      if (idx >= 0) {
        alleLadders[idx].spelers   = spelers;
        alleLadders[idx].spelerIds = spelerIds;
        if (alleLadders[idx].data) {
          alleLadders[idx].data.spelers   = spelers;
          alleLadders[idx].data.spelerIds = spelerIds;
        }
      }
    } catch(e) {
      console.error('voegSpelerToeAanLadders mislukt voor ladder', ladderId, e);
      toast('Fout bij toevoegen aan ladder, probeer opnieuw');
    }
  }
}

// ============================================================
//  SPELER TOEVOEGEN
// ============================================================

async function openAddPlayer() {
  document.getElementById('new-player-voornaam').value   = '';
  document.getElementById('new-player-achternaam').value = '';
  // v3.0.0-11: hcp default 10, email + wachtwoord velden bestaan niet meer
  document.getElementById('new-player-hcp').value        = '10';
  document.getElementById('add-player-handmatig').style.display      = 'none';
  document.getElementById('add-player-accounts-wrap').style.display  = 'block';
  document.getElementById('add-player-save-btn').style.display       = 'none';

  // Accounts die al in spelers/ staan zijn al speler — sectie is nu informatief
  try {
    const users = await getUsers();
    const lijst = document.getElementById('add-player-accounts-lijst');
    // Accounts zonder ladder-lidmaatschap
    const zonderLadder = users.filter(u =>
      !alleLadders.some(l =>
        (l.spelerIds || []).includes(u.uid) ||
        (l.spelers   || []).some(s => s.naam?.toLowerCase() === (u.naam || '').toLowerCase())
      )
    );
    if (zonderLadder.length === 0) {
      lijst.innerHTML = '<p style="font-size:13px;color:var(--light);padding:8px 0">Alle geregistreerde accounts zijn al in een ladder ingedeeld.</p>';
    } else {
      lijst.innerHTML = zonderLadder.map(u => `
        <div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:10px">
          <div style="flex:1">
            <div style="font-weight:500">${esc(u.naam || u.gebruikersnaam)}</div>
            <div style="font-size:11px;color:var(--light)">${esc(u.email)}</div>
          </div>
          <button class="btn btn-sm btn-primary"
            onclick="voegAccountToeAlsSpeler('${escAttr(u.uid)}','${escAttr(u.naam||u.gebruikersnaam||'')}')">
            + Toevoegen aan ladder
          </button>
        </div>
      `).join('');
    }
  } catch(e) {
    document.getElementById('add-player-accounts-lijst').innerHTML =
      '<p style="font-size:13px;color:var(--red)">Fout bij laden accounts.</p>';
  }

  renderLadderCheckboxes('new-player-ladders');
  document.getElementById('modal-add-player').classList.add('open');
}

function toggleHandmatigToevoegen() {
  const wrap = document.getElementById('add-player-handmatig');
  const btn  = document.getElementById('add-player-save-btn');
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
  btn.style.display  = wrap.style.display === 'none' ? 'none' : 'inline-flex';
}

// Voeg bestaand account (al in spelers/) toe aan een ladder
async function voegAccountToeAlsSpeler(uid, naam) {
  try {
    const hcpStr = prompt(`Playing handicap voor ${naam}:`, '10');
    if (hcpStr === null) return;
    const hcp = Math.round(parseFloat(hcpStr));
    if (isNaN(hcp)) { toast('Ongeldige handicap'); return; }

    // Update hcp in spelers/{uid}
    const spelersSnap = await getDoc(doc(db, 'spelers', uid));
    if (spelersSnap.exists()) {
      await setDoc(doc(db, 'spelers', uid), { ...spelersSnap.data(), hcp });
    }

    // Numeric id voor backward compat
    const newId = getNextId();

    // v3.0.0-9c: legacy master lijst (ladder/spelers) write verwijderd.
    // spelers/{uid} is de enige bron; alleSpelersData wordt automatisch afgeleid.

    // Voeg toe aan geselecteerde ladders
    const geselecteerdeLadders = getGeselecteerdeLadders('new-player-ladders');
    if (geselecteerdeLadders.length > 0) {
      const nieuweSpeler = { id: newId, naam, hcp };
      await voegSpelerToeAanLadders(geselecteerdeLadders, nieuweSpeler, uid);
      toast(`${naam} toegevoegd aan ladder(s) ✓`);
    } else {
      toast(`${naam} bijgewerkt in spelersbeheer ✓`);
    }

    closeModal('modal-add-player');
    renderAdmin();
  } catch(e) { console.error('voegAccountToeAlsSpeler mislukt:', e); toast('Er is iets misgegaan'); }
}

// Maak volledig nieuw account + speler aan (beheerder flow)
// v3.0.0-11: email + wachtwoord worden auto-gegenereerd.
async function saveNewPlayer() {
  const voornaam   = document.getElementById('new-player-voornaam').value.trim();
  const achternaam = document.getElementById('new-player-achternaam').value.trim();
  const naam       = [voornaam, achternaam].filter(Boolean).join(' ');
  let hcp          = parseFloat(document.getElementById('new-player-hcp').value);
  if (isNaN(hcp)) hcp = DEFAULT_HCP;
  hcp = Math.round(hcp);

  if (!voornaam)   { toast('Voer een voornaam in');   return; }
  if (!achternaam) { toast('Voer een achternaam in'); return; }

  // v3.0.0-11: auto-genereer email + wachtwoord
  const email = genereerEmail(voornaam, achternaam);
  const pass  = INITIEEL_WACHTWOORD;

  try {
    const users = await getUsers();
    if (users.find(u => u.email === email)) { toast('Deze naam (email) is al in gebruik'); return; }

    // Auth account aanmaken via secundaire app (logt beheerder niet uit)
    let uid = null;
    try {
      const { initializeApp: init2, deleteApp } =
        await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser } =
        await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      const tijdApp  = init2(firebaseConfig, `tmp_${Date.now()}`);
      const tijdAuth = getAuth2(tijdApp);
      const cred     = await createUser(tijdAuth, email, pass);
      uid = cred.user.uid;
      try { await deleteApp(tijdApp); } catch(e) {}
    } catch(authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        toast('Account bestaat al. Verwijder eerst via Firebase Console → Authentication.');
        return;
      }
      throw authErr;
    }

    // spelers/{uid} aanmaken — eersteLogin:true zodat speler verplicht profiel invult
    await setDoc(doc(db, 'spelers', uid),
      { uid, naam, email, rol: 'speler', hcp, eersteLogin: true });

    // Numeric id + legacy master lijst (backward compat fase 4-5)
    const newId = getNextId();
    const nieuweSpeler = { id: newId, naam, hcp };
    await slaState();

    // Voeg toe aan geselecteerde ladders
    const geselecteerdeLadders = getGeselecteerdeLadders('new-player-ladders');
    if (geselecteerdeLadders.length > 0) {
      await voegSpelerToeAanLadders(geselecteerdeLadders, nieuweSpeler, uid);
    }

    closeModal('modal-add-player');
    renderAdmin();

    // v3.0.0-11: toon credentials met copy-knop voor WhatsApp doorgeven
    const loginTxt = loginNaamVan(email);
    toonCredentialsModal(naam, loginTxt, pass);
  } catch(e) {
    console.error('saveNewPlayer error:', e);
    toast('Fout bij opslaan: ' + e.message);
  }
}

/**
 * v3.0.0-11: Toont modal met credentials + copy-knop.
 * Gebruikt voor zowel nieuwe-speler als reset-wachtwoord.
 */
function toonCredentialsModal(naam, loginTxt, pass) {
  const bestaand = document.getElementById('modal-credentials');
  if (bestaand) bestaand.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-credentials';
  overlay.className = 'modal-overlay open';
  // Deze modal moet centraal staan, niet als bottom-sheet
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '400';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;border-radius:16px;max-height:90vh">
      <h3>✓ ${esc(naam)}</h3>
      <p style="font-size:13px;color:var(--mid);margin-bottom:12px">
        Geef deze gegevens door aan de speler (bv. via WhatsApp):
      </p>
      <div style="background:#f9f7f2;border:1.5px solid var(--border);border-radius:8px;padding:12px;font-family:'DM Mono',monospace;font-size:13px;margin-bottom:12px">
        <div><strong>login:</strong> ${esc(loginTxt)}</div>
        <div><strong>wachtwoord:</strong> ${esc(pass)}</div>
      </div>
      <button class="btn btn-primary btn-block" onclick="kopieerCredentials('${escAttr(loginTxt)}','${escAttr(pass)}')">
        📋 Kopieer naar klembord
      </button>
      <p style="font-size:11px;color:var(--light);margin-top:10px;text-align:center">
        Bij eerste login kiest de speler een eigen wachtwoord en stelt zijn handicap in.
      </p>
      <button class="btn btn-ghost btn-block" onclick="document.getElementById('modal-credentials').remove()" style="margin-top:10px">
        Sluiten
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

function kopieerCredentials(loginTxt, pass) {
  const tekst = `login: ${loginTxt}\nwachtwoord: ${pass}`;
  navigator.clipboard.writeText(tekst)
    .then(() => toast('Gegevens gekopieerd ✓'))
    .catch(() => toast('Kopiëren mislukt — selecteer handmatig'));
}

// ============================================================
//  WACHTWOORD RESET via Cloud Function — v3.0.0-11.2
// ============================================================
async function vraagResetWachtwoord(uid, naam) {
  const bevestig = confirm(
    `Wachtwoord van ${naam} resetten naar ${INITIEEL_WACHTWOORD}?\n\n` +
    `De speler moet bij eerstvolgende inlog een nieuw wachtwoord kiezen en zijn handicap opnieuw instellen.`
  );
  if (!bevestig) return;

  try {
    toast('Bezig met resetten...');
    const resetFn = httpsCallable(functions, 'resetSpelerWachtwoord');
    const result = await resetFn({ targetUid: uid });
    if (result.data?.success) {
      renderAdmin();
      // Toon credentials modal zodat beheerder ze kan kopiëren voor de speler
      const loginTxt = loginNaamVan((await getDoc(doc(db, 'spelers', uid))).data()?.email || '');
      toonCredentialsModal(naam, loginTxt, INITIEEL_WACHTWOORD);
    } else {
      toast('Reset mislukt: onverwachte respons');
    }
  } catch(e) {
    console.error('Reset wachtwoord mislukt:', e);
    const msg = e.code === 'functions/permission-denied'
      ? 'Geen rechten — alleen beheerder kan resetten'
      : e.code === 'functions/unauthenticated'
      ? 'Niet ingelogd'
      : e.code === 'functions/not-found'
      ? 'Cloud Function niet gedeployed — run firebase deploy'
      : 'Fout: ' + (e.message || e.code);
    toast(msg);
  }
}

// ============================================================
//  SPELER BEWERKEN — op basis van uid
// ============================================================

async function openEditPlayer(uid) {
  try {
    // Laad direct uit spelers/{uid}
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Speler niet gevonden'); return; }
    const profiel = snap.data();

    document.getElementById('edit-player-id').value   = uid;    // slaat uid op, niet numeric id
    document.getElementById('edit-player-name').value = profiel.naam || '';
    document.getElementById('edit-player-hcp').value  = profiel.hcp != null ? Math.round(profiel.hcp) : '';

    const rolEl   = document.getElementById('edit-player-rol');
    const emailEl = document.getElementById('edit-player-email-info');
    if (rolEl)   rolEl.value       = profiel.rol   || 'speler';
    if (emailEl) emailEl.textContent = profiel.email ? `📧 ${profiel.email}` : 'Geen email';

    document.getElementById('modal-edit-player').classList.add('open');
  } catch(e) { console.error('openEditPlayer mislukt:', e); toast('Fout bij laden speler'); }
}

async function saveEditPlayer() {
  const uid  = document.getElementById('edit-player-id').value;   // uid (string)
  const naam = document.getElementById('edit-player-name').value.trim();
  const hcp  = Math.round(parseFloat(document.getElementById('edit-player-hcp').value));
  const rol  = document.getElementById('edit-player-rol')?.value || 'speler';

  if (!uid)       { toast('Geen speler geselecteerd'); return; }
  if (!naam)      { toast('Voer een naam in'); return; }
  if (isNaN(hcp)) { toast('Voer een handicap in'); return; }

  try {
    // Lees huidig profiel voor naam-vergelijking
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Speler niet gevonden in spelers/ collectie'); return; }
    const oudeNaam = snap.data().naam;

    // Schrijf naar spelers/{uid}
    await setDoc(doc(db, 'spelers', uid), { ...snap.data(), naam, hcp, rol });

    // v3.0.0-9c: sync naar legacy master lijst (ladder/spelers) verwijderd.
    // spelers/{uid} write hierboven is de enige bron voor naam/hcp/rol.

    // Dual-write: sync naam/hcp naar alle ladders (backward compat)
    for (const ladder of alleLadders) {
      const ladderSnap = await getDoc(doc(db, 'ladders', ladder.id));
      if (!ladderSnap.exists()) continue;
      const data = ladderSnap.data();

      // Zoek speler via uid in spelerIds OF via naam in spelers[]
      const inLadder = (data.spelerIds || []).includes(uid) ||
        (data.spelers || []).some(s => s.naam?.toLowerCase() === oudeNaam?.toLowerCase());
      if (!inLadder) continue;

      let gewijzigd = false;
      (data.spelers || []).forEach(s => {
        if (s.naam?.toLowerCase() === oudeNaam?.toLowerCase()) {
          s.naam = naam; s.hcp = hcp; gewijzigd = true;
        }
      });
      if (ladder.id === activeLadderId) {
        const sp = state.spelers?.find(s => s.naam?.toLowerCase() === oudeNaam?.toLowerCase());
        if (sp) { sp.naam = naam; sp.hcp = hcp; }
      }
      if (gewijzigd) {
        await setDoc(doc(db, 'ladders', ladder.id), data);
        ladder.spelers = data.spelers;
      }
    }

    closeModal('modal-edit-player');
    renderAdmin();
    toast('Speler bijgewerkt ✓');
  } catch(e) { console.error('saveEditPlayer mislukt:', e); toast('Fout bij opslaan: ' + e.message); }
}

// ============================================================
//  SPELER VERWIJDEREN — op basis van uid
// ============================================================

async function removePlayer(uid) {
  try {
    // Laad naam voor bevestigingsdialog
    const snap = await getDoc(doc(db, 'spelers', uid));
    const naam = snap.exists() ? snap.data().naam : uid;

    if (!confirm(`${naam} verwijderen uit alle ladders?\n\nHet Firebase inlogaccount moet je nog handmatig verwijderen in de Firebase Console.`)) return;

    // 1. Verwijder spelers/{uid}
    await deleteDoc(doc(db, 'spelers', uid));

    // v3.0.0-9c: stap 2 (legacy ladder/spelers master lijst) verwijderd.
    // spelers/ listener werkt alleSpelersData automatisch bij na de deleteDoc hierboven.

    // 3. Verwijder uit alle ladders
    for (const ladder of alleLadders) {
      const ladderSnap = await getDoc(doc(db, 'ladders', ladder.id));
      if (!ladderSnap.exists()) continue;
      const data = ladderSnap.data();

      const inSpelerIds = (data.spelerIds || []).includes(uid);
      const inSpelers   = (data.spelers   || []).some(s => s.naam?.toLowerCase() === naam?.toLowerCase());
      if (!inSpelerIds && !inSpelers) continue;

      data.spelerIds = (data.spelerIds || []).filter(id => id !== uid);
      data.spelers   = (data.spelers   || []).filter(s => s.naam?.toLowerCase() !== naam?.toLowerCase());
      data.spelers.sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i + 1);
      data.actievePartijen = (data.actievePartijen || []).filter(p =>
        !p.spelers?.some(s => s.naam?.toLowerCase() === naam?.toLowerCase())
      );
      await setDoc(doc(db, 'ladders', ladder.id), data);

      // Verwijder standen/{uid}
      try { await deleteDoc(doc(db, 'ladders', ladder.id, 'standen', uid)); } catch(e) {}

      ladder.spelers   = data.spelers;
      ladder.spelerIds = data.spelerIds;
      if (ladder.id === activeLadderId) {
        state.spelers         = data.spelers;
        state.actievePartijen = data.actievePartijen;
      }
    }

    renderAdmin();
    renderLadder();
    toast(`${naam} verwijderd ✓ — verwijder het Firebase inlogaccount nog handmatig`);
  } catch(e) { console.error('removePlayer mislukt:', e); toast('Er is iets misgegaan'); }
}

// ============================================================
//  PROFIEL
// ============================================================

function renderProfiel() {
  if (!huidigeBruiker) return;

  // v3.0.0-9c: uid-gebaseerde speler lookup via view-laag
  const uid = huidigeBruiker.uid;
  const speler = uid
    ? (state.spelers?.find(s => s.uid === uid)
       || getLadderSpelers(activeLadderId).find(s => s.uid === uid))
    : null;

  document.getElementById('profiel-info').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:4px">
      <div style="width:52px;height:52px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:24px;color:var(--gold-light)">
        ${esc((huidigeBruiker.gebruikersnaam || '')[0]?.toUpperCase() || '?')}
      </div>
      <div>
        <div style="font-weight:600;font-size:17px">${esc(huidigeBruiker.gebruikersnaam)}</div>
        <div style="font-size:13px;color:var(--light)">${esc(huidigeBruiker.email)}</div>
        <span class="badge ${huidigeBruiker.rol === 'beheerder' ? 'badge-gold' : huidigeBruiker.rol === 'coordinator' ? 'badge-green' : 'badge-grey'}" style="margin-top:4px">${esc(huidigeBruiker.rol)}</span>
      </div>
    </div>`;

  if (!speler) {
    document.getElementById('profiel-stats').innerHTML =
      '<p style="color:var(--light);font-size:13px">Nog geen spelersprofiel gekoppeld aan dit account.</p>';
    return;
  }

  const ladderStats = alleLadders.map(l => {
    // v3.0.0-9c: uid-match via view-laag (valt terug op legacy l.spelers via view)
    const sp = getLadderSpelers(l.id).find(s => s.uid === uid);
    if (!sp) return null;
    const winpct  = sp.partijen > 0 ? Math.round(sp.gewonnen / sp.partijen * 100) : 0;
    const verloren = (sp.partijen || 0) - (sp.gewonnen || 0);
    return { ladder: l, sp, winpct, verloren };
  }).filter(Boolean);

  const totaalPartijen = ladderStats.reduce((s, l) => s + (l.sp.partijen || 0), 0);
  const totaalGewonnen = ladderStats.reduce((s, l) => s + (l.sp.gewonnen || 0), 0);
  const totaalPct      = totaalPartijen > 0 ? Math.round(totaalGewonnen / totaalPartijen * 100) : 0;
  const totaalVerloren = totaalPartijen - totaalGewonnen;

  let html = '';
  ladderStats.forEach(({ ladder, sp, winpct, verloren }) => {
    html += `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${esc(ladder.naam)}</div>
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
  const openVerstuurd = mijnUitdagingen.filter(u => u.vanEmail  === huidigeBruiker.email && u.status === 'open');

  if (mijnUitdagingen.length > 0) {
    let uitdHtml = '<div style="margin-top:16px;padding-top:16px;border-top:1px solid #f0ede4">';
    uitdHtml += '<div style="font-size:12px;font-weight:600;color:var(--mid);text-transform:uppercase;margin-bottom:10px">Uitdagingen</div>';
    openOntvangen.forEach(u => {
      uitdHtml += `<div style="background:#fef3cd;border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="font-weight:600;margin-bottom:6px">⚔️ ${esc(u.vanNaam)} daagt je uit!</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" onclick="reageerUitdaging('${escAttr(u.id)}',true)">✓ Accepteer</button>
          <button class="btn btn-sm btn-ghost" onclick="reageerUitdaging('${escAttr(u.id)}',false)" style="color:var(--red)">✗ Weiger</button>
        </div>
      </div>`;
    });
    openVerstuurd.forEach(u => {
      uitdHtml += `<div style="background:#f0ede4;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px">⏳ Wacht op <strong>${esc(u.naarNaam)}</strong></div>
        <button onclick="verwijderUitdaging('${escAttr(u.id)}')" style="background:none;border:none;color:var(--light);cursor:pointer;font-size:18px">✕</button>
      </div>`;
    });
    const afgerond = mijnUitdagingen.filter(u => u.status !== 'open');
    afgerond.slice(0, 3).forEach(u => {
      const isVan  = u.vanEmail === huidigeBruiker.email;
      const ander  = isVan ? u.naarNaam : u.vanNaam;
      const icoon  = u.status === 'geaccepteerd' ? '✅' : '❌';
      uitdHtml += `<div style="font-size:12px;color:var(--light);padding:4px 0">${icoon} ${isVan ? 'Uitdaging aan' : 'Uitdaging van'} ${esc(ander)} — ${esc(u.status)}</div>`;
    });
    uitdHtml += '</div>';
    document.getElementById('profiel-stats').innerHTML += uitdHtml;
  }

  const hcpInput = document.getElementById('profiel-hcp-input');
  if (hcpInput && speler) hcpInput.value = Math.round(speler.hcp);
}

async function slaProfielHcpOp() {
  try {
    const val = parseFloat(document.getElementById('profiel-hcp-input').value);
    if (isNaN(val)) { toast('Voer een geldige handicap in'); return; }

    const gebruiker = huidigeBruiker.gebruikersnaam.toLowerCase().trim();
    const voornaam  = gebruiker.split(' ')[0];
    const matchNaam = (naam) => {
      const n = naam.toLowerCase().trim();
      return n === gebruiker || n.split(' ')[0] === voornaam ||
             n.includes(voornaam) || gebruiker.includes(n.split(' ')[0]);
    };

    // Schrijf naar spelers/{uid} (nieuw v2.7)
    if (huidigeBruiker.uid) {
      try {
        const spelersSnap = await getDoc(doc(db, 'spelers', huidigeBruiker.uid));
        if (spelersSnap.exists()) {
          await setDoc(doc(db, 'spelers', huidigeBruiker.uid), { ...spelersSnap.data(), hcp: val });
        }
      } catch(e) { console.error('hcp update spelers/ mislukt:', e); }
    }

    // v3.0.0-9c: sync naar legacy ladder/spelers master lijst verwijderd.
    // spelers/{uid} write hierboven is de bron; alleSpelersData volgt via listener.

    // Sync naar alle ladders
    let gevonden = false;
    for (const ladder of alleLadders) {
      const snap = await getDoc(doc(db, 'ladders', ladder.id));
      if (!snap.exists()) continue;
      const data   = snap.data();
      const speler = (data.spelers || []).find(s => matchNaam(s.naam));
      if (speler) {
        speler.hcp = val;
        await setDoc(doc(db, 'ladders', ladder.id), data);
        gevonden = true;
        if (ladder.id === activeLadderId) {
          const sp = state.spelers?.find(s => matchNaam(s.naam));
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
//  GEBRUIKERSBEHEER — nu uid-gebaseerd
// ============================================================

function sorteerUsers(users) {
  return [...users].sort((a, b) => {
    const naamA = (a.naam || a.gebruikersnaam || a.email || '').trim();
    const naamB = (b.naam || b.gebruikersnaam || b.email || '').trim();
    return naamA.split(' ').pop().localeCompare(naamB.split(' ').pop(), 'nl');
  });
}

async function renderAdminUsers() {
  const list = document.getElementById('admin-user-list');
  list.innerHTML = '<div style="padding:12px 16px;color:var(--light);font-size:13px">Laden…</div>';
  try {
    const users = await getUsers();
    if (users.length === 0) {
      list.innerHTML = '<div class="empty"><p>Nog geen accounts.</p></div>';
      return;
    }
    const gesorteerd = sorteerUsers(users);
    list.innerHTML = gesorteerd.map(u => {
      const naam = u.naam || u.gebruikersnaam || u.email?.split('@')[0] || '—';
      return `
      <div class="admin-row">
        <div style="flex:1">
          <div class="name">${esc(naam)}</div>
          <div style="font-size:11px;color:var(--light)">${esc(u.email || '')}</div>
        </div>
        <span class="badge ${u.rol === 'beheerder' ? 'badge-gold' : u.rol === 'coordinator' ? 'badge-green' : 'badge-grey'}">${esc(u.rol)}</span>
        <button class="btn btn-sm btn-ghost" onclick="openEditUser('${escAttr(u.uid)}')">✏️</button>
        <button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:12px" onclick="removeUser('${escAttr(u.uid)}')">✕</button>
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:13px">Fout bij laden</div>';
  }
}

async function openEditUser(uid) {
  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Account niet gevonden'); return; }
    const u = snap.data();
    document.getElementById('edit-user-name').value = u.naam || '';
    document.getElementById('edit-user-pass').value = '';
    document.getElementById('edit-user-rol').value  = u.rol || 'speler';
    document.getElementById('edit-user-idx').value  = uid;   // idx-veld hergebruikt voor uid
    document.getElementById('modal-edit-user').classList.add('open');
  } catch(e) { toast('Fout bij laden'); }
}

async function saveEditUser() {
  const uid  = document.getElementById('edit-user-idx').value;   // bevat uid
  const naam = document.getElementById('edit-user-name').value.trim();
  const pass = document.getElementById('edit-user-pass').value;
  const rol  = document.getElementById('edit-user-rol').value;

  if (!naam)                   { toast('Voer een naam in'); return; }
  if (pass && pass.length < 6) { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    if (!snap.exists()) { toast('Account niet gevonden'); return; }
    await setDoc(doc(db, 'spelers', uid), { ...snap.data(), naam, rol });
    closeModal('modal-edit-user');
    renderAdmin();
    toast('Account bijgewerkt ✓');
  } catch(e) { toast('Fout bij opslaan'); }
}

function openAddUser() {
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-pass').value = '';
  document.getElementById('new-user-rol').value  = 'speler';
  renderLadderCheckboxes('new-user-ladders');
  document.getElementById('modal-add-user').classList.add('open');
}

async function saveNewUser() {
  const email = document.getElementById('new-user-name').value.trim().toLowerCase();
  const pass  = document.getElementById('new-user-pass').value;
  const rol   = document.getElementById('new-user-rol').value;

  if (!email || !email.includes('@')) { toast('Voer een geldig e-mailadres in'); return; }
  if (pass.length < 6)               { toast('Wachtwoord minimaal 6 tekens'); return; }

  try {
    const { initializeApp: init2, deleteApp: del2 } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser2 } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const tijdApp  = init2(firebaseConfig, `tmp_user_${Date.now()}`);
    const tijdAuth = getAuth2(tijdApp);

    let uid;
    try {
      const cred = await createUser2(tijdAuth, email, pass);
      uid = cred.user.uid;
      try { await del2(tijdApp); } catch(e) {}
    } catch(authErr) {
      try { await del2(tijdApp); } catch(e) {}
      if (authErr.code === 'auth/email-already-in-use') { toast('Dit e-mailadres is al in gebruik'); return; }
      if (authErr.code === 'auth/invalid-email')         { toast('Ongeldig e-mailadres'); return; }
      toast('Fout bij aanmaken: ' + authErr.message); return;
    }

    const naam = email.split('@')[0].replace(/[^a-z0-9 ]/g, '');

    // Schrijf naar spelers/{uid}
    await setDoc(doc(db, 'spelers', uid), { uid, naam, email, rol, hcp: 0 });

    // Voeg toe aan ladders als dat gewenst is
    const geselecteerdeLadders = getGeselecteerdeLadders('new-user-ladders');
    if (geselecteerdeLadders.length > 0) {
      const newId        = getNextId();
      const nieuweSpeler = { id: newId, naam, hcp: 0 };
      // v3.0.0-9c: legacy ladder/spelers dual-write verwijderd
      await slaState();
      await voegSpelerToeAanLadders(geselecteerdeLadders, nieuweSpeler, uid);
    }

    closeModal('modal-add-user');
    renderAdmin();
    toast('Account aangemaakt ✓');
  } catch(e) { toast('Fout bij opslaan: ' + e.message); }
}

async function removeUser(uid) {
  try {
    const snap = await getDoc(doc(db, 'spelers', uid));
    const naam = snap.exists() ? snap.data().naam : uid;

    if (!confirm(`Account van ${naam} verwijderen? De speler wordt ook uit alle ladders verwijderd.`)) return;

    // Verwijder spelers/{uid}
    await deleteDoc(doc(db, 'spelers', uid));

    // v3.0.0-9c: legacy ladder/spelers master lijst sync verwijderd.
    // We zoeken de legacy numeric spelerId via de huidige ladder.spelers[] entries
    // (voor zolang die nog bestaan), zodat we ook de legacy spelers[] arrays
    // kunnen opschonen naast de nieuwe spelerIds[] uid-lijst.
    let legacySpelerId = null;
    for (const ladder of alleLadders) {
      const match = (ladder.spelers || []).find(s => s.naam?.toLowerCase() === naam?.toLowerCase());
      if (match) { legacySpelerId = match.id; break; }
    }

    // Verwijder uit alle ladders
    for (const ladder of alleLadders) {
      const ladderSnap = await getDoc(doc(db, 'ladders', ladder.id));
      if (!ladderSnap.exists()) continue;
      const data      = ladderSnap.data();
      const inSpelerIds = (data.spelerIds || []).includes(uid);
      const inSpelers   = legacySpelerId != null &&
                          (data.spelers || []).some(s => s.id === legacySpelerId);
      if (!inSpelerIds && !inSpelers) continue;
      data.spelers    = (data.spelers || []).filter(s => s.id !== legacySpelerId);
      data.spelerIds  = (data.spelerIds || []).filter(id => id !== uid);
      data.spelers.sort((a,b) => a.rank - b.rank).forEach((s,i) => s.rank = i + 1);
      await setDoc(doc(db, 'ladders', ladder.id), data);
      try { await deleteDoc(doc(db, 'ladders', ladder.id, 'standen', uid)); } catch(e) {}
      ladder.spelers   = data.spelers;
      ladder.spelerIds = data.spelerIds;
      if (ladder.id === activeLadderId) state.spelers = data.spelers;
    }

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
    const ander = state.spelers.find(s => s.rank === nieuwRank);
    if (ander) ander.rank = speler.rank;
    speler.rank = nieuwRank;
    await slaState();

    // v3.0.0-11.26: schrijf direct alle standen/{uid} docs vanuit state.spelers
    // (geen omweg via syncStandenNaBevestigUitslag-cache; die kan stale zijn).
    const writes = [];
    let geschreven = 0, overgeslagen = 0;
    for (const s of state.spelers) {
      // Alleen als id een uid is (string >10 chars)
      if (typeof s.id !== 'string' || s.id.length <= 10) {
        overgeslagen++;
        continue;
      }
      const payload = {
        rank:     s.rank     || 0,
        partijen: s.partijen || 0,
        gewonnen: s.gewonnen || 0,
      };
      if (s.prevRank != null) payload.prevRank = s.prevRank;
      writes.push(
        setDoc(doc(db, 'ladders', activeLadderId, 'standen', s.id), payload)
          .then(() => geschreven++)
          .catch(err => console.warn('[verschuifRank] standen sync mislukt voor', s.naam, err.code))
      );
    }
    await Promise.all(writes);
    console.log(`[verschuifRank] standen-sync klaar: ${geschreven} geschreven, ${overgeslagen} overgeslagen (geen uid)`);

    renderAdmin();
    if (typeof renderLadder === 'function') renderLadder();
  } catch(e) { console.error('verschuifRank mislukt:', e); }
}

function resetData() { toast('Reset is momenteel uitgeschakeld'); }

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) o.classList.remove('open');
  });
});

// koppelSpelerIds — no-op in v2.7.0 (vervangen door migratie fase 1)
async function koppelSpelerIds() {
  toast('Speler-ID koppeling is vervangen door de nieuwe architectuur (v3). Geen actie nodig.');
}

// ============================================================
//  EXPORTS — identiek aan v2.5.x
// ============================================================
export {
  renderAdmin, renderAdminSpelersEnAccounts,
  openAddPlayer, toggleHandmatigToevoegen, voegAccountToeAlsSpeler,
  saveNewPlayer, openEditPlayer, saveEditPlayer, removePlayer,
  renderProfiel, slaProfielHcpOp,
  sorteerUsers, renderAdminUsers, openEditUser, saveEditUser,
  openAddUser, saveNewUser, removeUser,
  verschuifRank, resetData, closeModal, koppelSpelerIds,
  kopieerCredentials, vraagResetWachtwoord,
};
