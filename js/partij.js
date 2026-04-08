// ============================================================
//  partij.js — Partij aanmaken, banen, naam helpers
// ============================================================
import { db, BANEN_DB, LADDERS_COL, SPELERS_DOC, DEFAULT_STATE } from './config.js';
import { store, state, alleLadders, activeLadderId, alleSpelersData, huidigeBruiker, playerSlotCount, aangepasteBanen } from './store.js';
import { slaState, getLadderData, getNextId, isBeheerderRol, isCoordinatorRol, toast } from './auth.js';
import { objNaarRondes } from './knockout.js';
import { getFirestore, doc, collection, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, getDocs, addDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

//  PARTIJ SETUP
// ============================================================

//  PARTIJ SETUP
// ============================================================
function alleBANEN() {
  const result = {};
  Object.entries(BANEN_DB).filter(([n]) => n !== 'Handmatig invoeren').forEach(([n,v]) => { result[n] = v; });
  aangepasteBanen.forEach(b => { result[b.naam] = { holes: b.holes, custom: true, aangemaakt_door: b.aangemaakt_door }; });
  result['Handmatig invoeren'] = { holes: null };
  return result;
}

function initPartijForm() {
  // Vul ladder selector — alleen ladders waar de huidige speler in zit
  const ladderSel = document.getElementById('partij-ladder-select');
  const isBeheerder = isCoordinatorRol();
  const gebruikersnaam = huidigeBruiker?.gebruikersnaam?.toLowerCase() || '';

  const mijnLadders = isBeheerder
    ? alleLadders
    : alleLadders.filter(l =>
        (l.spelers || []).some(s => s.naam.toLowerCase() === gebruikersnaam)
      );

  ladderSel.innerHTML = mijnLadders.map(l =>
    `<option value="${l.id}" ${l.id === activeLadderId ? 'selected' : ''}>${l.naam}</option>`
  ).join('');

  // Verberg selector als er maar één ladder beschikbaar is
  document.getElementById('partij-ladder-wrap').style.display = mijnLadders.length <= 1 ? 'none' : 'block';
  ladderSel.onchange = () => herlaadPartijSpelers();

  const sel = document.getElementById('baan-select');
  sel.innerHTML = '<option value="">— Selecteer baan —</option>';

  // Ingebouwde banen
  Object.keys(BANEN_DB).filter(n => n !== 'Handmatig invoeren').forEach(naam => {
    sel.innerHTML += `<option value="${naam}">${naam}</option>`;
  });

  // Aangepaste banen
  if (aangepasteBanen.length > 0) {
    sel.innerHTML += `<optgroup label="Opgeslagen banen">`;
    aangepasteBanen.forEach(b => {
      sel.innerHTML += `<option value="${b.naam}">⭐ ${b.naam}</option>`;
    });
    sel.innerHTML += `</optgroup>`;
  }
  sel.innerHTML += `<option value="Handmatig invoeren">+ Handmatig invoeren / nieuwe baan</option>`;

  // Selecteer thuisbaan als default
  sel.value = Object.keys(BANEN_DB)[0];

  // Player slots
  store.playerSlotCount = 0;
  document.getElementById('player-slots').innerHTML = '';
  addPlayerSlot();
  addPlayerSlot();

  // Auto-selecteer ingelogde speler in slot 1
  if (huidigeBruiker) {
    const gebruiker = huidigeBruiker.gebruikersnaam.toLowerCase().trim();
    const emailPrefix = huidigeBruiker.email?.split('@')[0]?.toLowerCase() || '';
    const ladderSpelers = getPartijLadderSpelers();
    const gekoppeld = ladderSpelers.find(s => {
      const naam = s.naam.toLowerCase().trim();
      const voornaam = naam.split(' ')[0];
      return naam === gebruiker ||
             voornaam === gebruiker.split(' ')[0] ||
             voornaam === emailPrefix ||
             naam.includes(emailPrefix) ||
             emailPrefix.includes(voornaam);
    });
    if (gekoppeld) {
      selecteerPartijSpeler(1, gekoppeld.id, gekoppeld.naam, gekoppeld.hcp);
      vulKnockoutTegenstander(gekoppeld.naam);
    }
  }

  document.getElementById('holes-count').addEventListener('change', function() {
    document.getElementById('custom-holes-wrap').style.display = this.value === 'custom' ? 'block' : 'none';
  });
}

function vulKnockoutTegenstander(spelersNaam) {
  const ladderId = document.getElementById('partij-ladder-select')?.value || activeLadderId;
  getDoc(doc(db, 'ladders', ladderId)).then(snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    if ((data.type || '') !== 'knockout') return;
    const rondes = objNaarRondes(data.rondes);
    const huidigeRonde = rondes[rondes.length - 1] || [];
    const mijnPartij = huidigeRonde.find(p =>
      (p.a === spelersNaam || p.b === spelersNaam) && !p.winnaar
    );
    if (mijnPartij) {
      const tegenstander = mijnPartij.a === spelersNaam ? mijnPartij.b : mijnPartij.a;
      if (tegenstander) {
        const tegenspeler = getPartijLadderSpelers().find(s => s.naam === tegenstander);
        if (tegenspeler) selecteerPartijSpeler(2, tegenspeler.id, tegenspeler.naam, tegenspeler.hcp);
      }
    }
  }).catch(e => console.error('vulKnockoutTegenstander mislukt:', e));
}

function getPartijLadderSpelers() {
  const ladderId = document.getElementById('partij-ladder-select')?.value || activeLadderId;
  const ladder = alleLadders.find(l => l.id === ladderId);
  const ladderSpelers = ladder?.spelers || state.spelers;
  return [...ladderSpelers].sort((a,b) => a.rank - b.rank);
}

function herlaadPartijSpelers() {
  // Reset zoekbalk
  const zoek = document.getElementById('partij-speler-zoek');
  if (zoek) zoek.value = '';
  // Herlaad spelerslots bij wisselen van ladder
  store.playerSlotCount = 0;
  document.getElementById('player-slots').innerHTML = '';
  document.getElementById('add-player-btn').style.display = ''; const gb = document.getElementById('add-guest-btn'); if(gb) gb.style.display = '';
  addPlayerSlot();
  addPlayerSlot();
  // Pre-select eigen naam in slot 1
  if (huidigeBruiker) {
    const spelers = getPartijLadderSpelers();
    const gebruikersnaam = huidigeBruiker.gebruikersnaam?.toLowerCase() || '';
    // Gebruik spelerId als dat bekend is, anders val terug op exacte naam
    const zelf = (huidigeBruiker.spelerId
      ? spelers.find(s => String(s.id) === String(huidigeBruiker.spelerId))
      : null)
      || spelers.find(s => s.naam.toLowerCase() === gebruikersnaam);
    if (zelf) {
      selecteerPartijSpeler(1, zelf.id, zelf.naam, zelf.hcp);
      vulKnockoutTegenstander(zelf.naam);
    }
  }
}

function filterPartijSpelers(zoek) {
  // Filter alle speler dropdowns op zoekterm
  const term = zoek.toLowerCase().trim();
  document.querySelectorAll('.player-select').forEach(sel => {
    const huidigeWaarde = sel.value;
    const reedsSel = Array.from(document.querySelectorAll('.player-select'))
      .filter(s => s !== sel).map(s => s.value).filter(v => v !== '');
    const spelers = getPartijLadderSpelers();
    sel.innerHTML = '<option value="">— Kies speler —</option>' +
      spelers.filter(s => !reedsSel.includes(String(s.id)))
        .filter(s => !term || s.naam.toLowerCase().includes(term))
        .map(s => `<option value="${s.id}" ${String(s.id) === huidigeWaarde ? 'selected' : ''}>${s.naam} (hcp ${Math.round(s.hcp)})</option>`)
        .join('');
  });
}

function voegGastSpelerToeAanPartij() {
  if (store.playerSlotCount >= 4) { toast('Maximaal 4 spelers'); return; }
  const naam = prompt('Naam gastspeler:');
  if (!naam?.trim()) return;
  const hcpStr = prompt(`Handicap voor ${naam.trim()}:`, '10');
  if (hcpStr === null) return;
  const hcp = parseFloat(hcpStr) || 0;
  const gastId = 90000 + Math.floor(Math.random() * 9999);

  // Zoek eerst een leeg slot op
  let leegSlot = null;
  for (let i = 1; i <= store.playerSlotCount; i++) {
    const slot = document.getElementById('slot-' + i);
    if (slot && !slot.dataset.spelerId) { leegSlot = i; break; }
  }

  if (leegSlot) {
    selecteerPartijSpeler(leegSlot, gastId, naam.trim(), hcp);
  } else {
    addPlayerSlot();
    selecteerPartijSpeler(store.playerSlotCount, gastId, naam.trim(), hcp);
  }
}

function addPlayerSlot() {
  if (playerSlotCount >= 4) return;
  store.playerSlotCount = store.playerSlotCount + 1;
  const n = playerSlotCount;

  const div = document.createElement('div');
  div.className = 'player-slot';
  div.id = 'slot-' + n;
  div.dataset.spelerId = '';
  div.innerHTML = `
    <div class="speler-zoek-wrap">
      <input type="text" class="speler-zoek-input player-select" id="player-${n}" placeholder="Zoek speler..." autocomplete="off"
        oninput="zoekPartijSpeler(${n}, this.value)"
        onfocus="zoekPartijSpeler(${n}, this.value)"
        onblur="setTimeout(() => sluitSpelerLijst(${n}), 150)">
      <div class="speler-zoek-lijst" id="speler-lijst-${n}"></div>
    </div>
    <input type="number" class="hcp-input" id="hcp-${n}" placeholder="hcp" step="1" min="-10" max="54">
    ${n > 2 ? `<button class="btn btn-sm" style="background:#fde8e8;color:var(--red);border:none;padding:8px;border-radius:6px;cursor:pointer" onclick="removeSlot(${n})">✕</button>` : ''}
  `;
  document.getElementById('player-slots').appendChild(div);
  if (store.playerSlotCount >= 4) { document.getElementById('add-player-btn').style.display = 'none'; const gb = document.getElementById('add-guest-btn'); if(gb) gb.style.display = 'none'; }
}

function zoekPartijSpeler(n, zoek) {
  const lijst = document.getElementById('speler-lijst-' + n);
  if (!lijst) return;
  const spelers = getPartijLadderSpelers();
  const reedsSel = Array.from(document.querySelectorAll('.player-slot'))
    .filter(s => s.id !== 'slot-' + n)
    .map(s => s.dataset.spelerId).filter(v => v);
  const term = zoek.toLowerCase().trim();
  const gefilterd = spelers
    .filter(s => !reedsSel.includes(String(s.id)))
    .filter(s => !term || s.naam.toLowerCase().includes(term));

  if (gefilterd.length === 0) {
    lijst.innerHTML = '<div class="speler-zoek-item geselecteerd">Geen spelers gevonden</div>';
  } else {
    lijst.innerHTML = gefilterd.map(s => `
      <div class="speler-zoek-item"
        data-id="${s.id}"
        data-naam="${s.naam.replace(/"/g,'&quot;')}"
        data-hcp="${s.hcp}"
        onpointerdown="event.preventDefault()"
        onclick="selecteerPartijSpelerEl(${n}, this)">
        ${s.naam} <span style="color:var(--light);font-size:12px">hcp ${Math.round(s.hcp)}</span>
      </div>
    `).join('');
  }
  lijst.style.display = 'block';
}

function selecteerPartijSpelerEl(n, el) {
  const id = parseInt(el.dataset.id);
  const naam = el.dataset.naam;
  const hcp = parseFloat(el.dataset.hcp);
  selecteerPartijSpeler(n, id, naam, hcp);
}

function selecteerPartijSpeler(n, id, naam, hcp) {
  const slot = document.getElementById('slot-' + n);
  const input = document.getElementById('player-' + n);
  const hcpEl = document.getElementById('hcp-' + n);
  if (slot) slot.dataset.spelerId = String(id);
  if (input) input.value = naam;
  if (hcpEl) hcpEl.value = Math.round(hcp);
  sluitSpelerLijst(n);
}

function sluitSpelerLijst(n) {
  const lijst = document.getElementById('speler-lijst-' + n);
  if (lijst) lijst.style.display = 'none';
}

function refreshPlayerSlotOptions() {
  // Niet meer nodig met zoekbare inputs — lege functie voor compatibiliteit
}

function removeSlot(n) {
  document.getElementById('slot-' + n).remove();
  store.playerSlotCount = store.playerSlotCount - 1;
  document.getElementById('add-player-btn').style.display = ''; const gb = document.getElementById('add-guest-btn'); if(gb) gb.style.display = '';
}

function onBaanSelect() {
  const val = document.getElementById('baan-select').value;
  const hw = document.getElementById('baan-handmatig');
  const beheerWrap = document.getElementById('baan-beheer-wrap');
  const banen = alleBANEN();
  beheerWrap.style.display = 'none';
  if (val === 'Handmatig invoeren') {
    hw.style.display = 'block';
    renderHandmatigHoles();
  } else if (banen[val]?.custom) {
    hw.style.display = 'none';
    const kanBeheren = isCoordinatorRol() || banen[val].aangemaakt_door === huidigeBruiker?.gebruikersnaam;
    if (kanBeheren) beheerWrap.style.display = 'block';
  } else {
    hw.style.display = 'none';
  }
}

function renderHandmatigHoles() {
  let html = `<div class="form-group" style="margin-bottom:10px">
    <label>Naam van de baan</label>
    <input type="text" id="baan-naam-nieuw" placeholder="bijv. Golfbaan de Poel" style="font-size:16px">
  </div>`;
  html += '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px;width:100%">';
  html += '<tr><th style="padding:6px 4px;text-align:left">Hole</th><th style="padding:6px 4px">PAR</th><th style="padding:6px 4px">SI</th></tr>';
  for (let i = 1; i <= 18; i++) {
    html += `<tr>
      <td style="padding:4px;font-weight:600">${i}</td>
      <td><input type="number" id="mpar-${i}" min="3" max="6" value="4" inputmode="numeric" style="width:54px;padding:6px;border:1.5px solid #ddd;border-radius:6px;text-align:center;font-size:15px"></td>
      <td><input type="number" id="msi-${i}" min="1" max="18" value="${i}" inputmode="numeric" style="width:54px;padding:6px;border:1.5px solid #ddd;border-radius:6px;text-align:center;font-size:15px"></td>
    </tr>`;
  }
  html += '</table></div>';
  html += `<button class="btn btn-ghost btn-block" onclick="slaAangepasteBaanOp()" style="margin-top:12px;color:var(--green);border-color:var(--green-pale)">
    ⭐ Baan opslaan voor iedereen
  </button>`;
  document.getElementById('holes-handmatig').innerHTML = html;
}

// ============================================================
//  AANGEPASTE BANEN
// ============================================================
async function slaAangepasteBaanOp() {
  const naam = document.getElementById('baan-naam-nieuw')?.value?.trim();
  if (!naam) { toast('Geef de baan eerst een naam'); return; }

  // Lees holes
  const holes = [];
  for (let i = 1; i <= 18; i++) {
    const par = parseInt(document.getElementById('mpar-'+i)?.value || 4);
    const si = parseInt(document.getElementById('msi-'+i)?.value || i);
    holes.push({ par, si });
  }

  // Check dubbele naam
  if (aangepasteBanen.find(b => b.naam.toLowerCase() === naam.toLowerCase())) {
    toast('Er bestaat al een baan met deze naam'); return;
  }

  const nieuweBaan = { naam, holes, aangemaakt_door: huidigeBruiker.gebruikersnaam };
  aangepasteBanen.push(nieuweBaan);

  try {
    await setDoc(BANEN_DOC, { lijst: aangepasteBanen });
    toast(`${naam} opgeslagen ⭐`);
    // Update de select en selecteer de nieuwe baan
    initPartijForm();
    document.getElementById('baan-select').value = naam;
    document.getElementById('baan-handmatig').style.display = 'none';
  } catch(e) { toast('Fout bij opslaan'); aangepasteBanen.pop(); }
}

async function verwijderAangepasteBaan() {
  const baanNaam = document.getElementById('baan-select').value;
  const baan = aangepasteBanen.find(b => b.naam === baanNaam);
  if (!baan) return;
  if (!confirm(`"${baanNaam}" verwijderen?`)) return;

  store.aangepasteBanen = aangepasteBanen.filter(b => b.naam !== baanNaam);
  try {
    await setDoc(BANEN_DOC, { lijst: aangepasteBanen });
    toast('Baan verwijderd');
    initPartijForm();
  } catch(e) { toast('Fout bij verwijderen'); }
}

// Geeft de actieve partij terug waar de ingelogde speler in zit
function mijnPartij() {
  if (!huidigeBruiker) return null;
  const gebruiker = huidigeBruiker.gebruikersnaam.toLowerCase();

  const zoekInPartijen = (partijen) => (partijen || []).find(p =>
    p.spelers.some(s => {
      const naam = s.naam.toLowerCase();
      const voornaam = naam.split(' ')[0];
      return naam === gebruiker || voornaam === gebruiker ||
             naam.replace(/\s/g,' ') === gebruiker ||
             naam.replace(/\s/g,'.') === gebruiker;
    })
  ) || null;

  // Zoek eerst in actieve ladder
  const inActief = zoekInPartijen(state.actievePartijen);
  if (inActief) return inActief;

  // Zoek in andere ladders (via alleLadders cache)
  for (const l of alleLadders) {
    if (l.id === activeLadderId) continue;
    const gevonden = zoekInPartijen(l.actievePartijen);
    if (gevonden) return gevonden;
  }
  return null;
}

async function startPartij() {

  try {
  const baanNaam = document.getElementById('baan-select').value;
  if (!baanNaam) { toast('Selecteer eerst een baan'); return; }

  // Bepaal ladder voor deze partij
  const partijLadderId = document.getElementById('partij-ladder-select')?.value || activeLadderId;
  const partijLadderSpelers = getPartijLadderSpelers();

  // Collect players
  const spelers = [];
  for (let i = 1; i <= 4; i++) {
    const slot = document.getElementById('slot-' + i);
    const hcpEl = document.getElementById('hcp-' + i);
    if (!slot) continue;
    const spelerId = slot.dataset.spelerId;
    if (!spelerId) continue;
    const speler = partijLadderSpelers.find(s => String(s.id) === String(spelerId))
      || alleSpelersData.find(s => String(s.id) === String(spelerId))
      || (parseInt(spelerId) >= 90000 ? { id: parseInt(spelerId), naam: document.getElementById('player-' + i)?.value || 'Gast', hcp: parseFloat(hcpEl?.value) || 0, gast: true } : null);
    if (!speler) continue;
    const partijHcp = Math.round(parseFloat(hcpEl?.value));
    if (!isNaN(partijHcp) && partijHcp !== speler.hcp) {
      const sv = partijLadderSpelers.find(s => s.id === speler.id);
      if (sv) sv.hcp = partijHcp;
    }
    spelers.push({ ...speler, hcp: isNaN(partijHcp) ? speler.hcp : partijHcp, partijHcp: isNaN(partijHcp) ? speler.hcp : partijHcp });
  }

  if (spelers.length < 2) { toast('Minimaal 2 spelers nodig'); return; }

  // Check: zit een van deze spelers al in een actieve partij in dezelfde ladder?
  if (!state.actievePartijen) state.actievePartijen = [];
  const bezet = spelers.find(s =>
    state.actievePartijen.some(p => p.ladderId === partijLadderId && p.spelers.some(ps => ps.id === s.id))
  );
  if (bezet) { toast(`${bezet.naam.split(' ')[0]} speelt al een actieve partij in deze ladder`); return; }

  // Baan holes
  let holes = [];
  const banen = alleBANEN();
  if (baanNaam === 'Handmatig invoeren') {
    for (let i = 1; i <= 18; i++) {
      holes.push({ par: parseInt(document.getElementById('mpar-'+i)?.value||4), si: parseInt(document.getElementById('msi-'+i)?.value||i) });
    }
  } else {
    holes = banen[baanNaam].holes;
  }

  // Holes range met wrap-around (zoals toernooi module)
  const holesCount = document.getElementById('holes-count').value;
  let startH = 0, aantalHoles = 18;
  if (holesCount === '9') { startH = 0; aantalHoles = 9; }
  else if (holesCount === 'custom') {
    startH = (parseInt(document.getElementById('start-hole').value) || 1) - 1;
    aantalHoles = parseInt(document.getElementById('custom-hole-count').value) || 9;
  }
  // Wrap-around: na hole 18 door naar hole 1
  const activeHoles = Array.from({ length: aantalHoles }, (_, i) => holes[(startH + i) % holes.length]);

  // Generate matchups
  const matchups = [];
  for (let i = 0; i < spelers.length; i++) {
    for (let j = i + 1; j < spelers.length; j++) {
      const a = spelers[i], b = spelers[j];
      const hcpDiff = Math.round(Math.abs(a.partijHcp - b.partijHcp) * 0.75);
      const hoger = a.partijHcp > b.partijHcp ? a : b;
      matchups.push({
        id: `${a.id}-${b.id}`,
        spelerA: a, spelerB: b,
        hcpOntvanger: hoger.id,
        hcpSlagen: hcpDiff
      });
    }
  }

  const nieuwePartij = {
    partijId: `p_${Date.now()}`,
    ladderId: partijLadderId,
    baan: baanNaam,
    holes: activeHoles,
    startHole: startH + 1,
    spelers,
    matchups,
    scores: {},
    timestamp: Date.now()
  };

  spelers.forEach(s => { nieuwePartij.scores[s.id] = Array(activeHoles.length).fill(null); });

  // Voeg toe aan de juiste ladder
  if (partijLadderId !== activeLadderId) {
    // Laad andere ladder en voeg partij toe
    const snap = await getDoc(doc(db, 'ladders', partijLadderId));
    const ladderData = snap.exists() ? snap.data() : { ...JSON.parse(JSON.stringify(DEFAULT_STATE)) };
    if (!ladderData.actievePartijen) ladderData.actievePartijen = [];
    ladderData.actievePartijen.push(nieuwePartij);
    await setDoc(doc(db, 'ladders', partijLadderId), ladderData);
    // Wissel naar die ladder zodat de ronde zichtbaar is
    store.activeLadderId = partijLadderId;
    store.state = ladderData;
  } else {
    state.actievePartijen.push(nieuwePartij);
    await slaState();
  }

  toast('Partij gestart! ⛳');
  document.querySelectorAll('nav button')[2].click();
  } catch(e) { console.error('startPartij mislukt:', e); toast('Er is iets misgegaan, probeer opnieuw'); }
}

// ============================================================
//  NAAM HELPER — unieke korte namen binnen een groep spelers
// ============================================================
// Geeft de voornaam terug, maar voegt letters van de achternaam toe
// totdat alle namen binnen de gegeven lijst uniek zijn.
// Voorbeeld: ["Jan de Vries", "Jan Jansen"] → ["Jan d", "Jan J"]
function kortNaam(speler, alleSpelers) {
  const delen = speler.naam.trim().split(/\s+/);
  const voornaam = delen[0];

  // Splits naam in voornaam, tussenvoegsel (voorvoegsel), achternaam
  // Voorvoegsels: van, de, den, der, het, te, ter, ten, 'van der' etc.
  const voorvoegsels = new Set(['van','de','den','der','het','te','ter','ten','op','in','aan','bij']);
  let vi = 1;
  while (vi < delen.length - 1 && voorvoegsels.has(delen[vi].toLowerCase())) vi++;
  const tussenvoegsel = delen.slice(1, vi).join(' '); // bijv. "van der"
  const achternaam = delen.slice(vi).join(' ');       // bijv. "Veen"
  const naamZonderVoornaam = [tussenvoegsel, achternaam].filter(Boolean).join(' '); // "van der Veen"

  // Geen duplicaten: alleen voornaam
  const duplicaten = alleSpelers.filter(s => s.id !== speler.id && s.naam.trim().split(/\s+/)[0] === voornaam);
  if (duplicaten.length === 0) return voornaam;

  // Bouw vergelijkbare naamZonderVoornaam voor duplicaten
  const anderenRest = duplicaten.map(s => {
    const d = s.naam.trim().split(/\s+/);
    let di = 1;
    while (di < d.length - 1 && voorvoegsels.has(d[di].toLowerCase())) di++;
    return d.slice(1).join(' '); // tussenvoegsel + achternaam volledig
  });

  // Voeg steeds één letter toe aan achternaam (inclusief volledig tussenvoegsel)
  const prefix = tussenvoegsel ? voornaam + ' ' + tussenvoegsel + ' ' : voornaam + ' ';
  for (let i = 1; i <= achternaam.length; i++) {
    const kandidaat = prefix + achternaam.slice(0, i);
    const nogSteeds = anderenRest.filter(a => {
      const ad = a.trim().split(/\s+/);
      let ai = 0;
      while (ai < ad.length - 1 && voorvoegsels.has(ad[ai].toLowerCase())) ai++;
      const aAchternaam = ad.slice(ai).join(' ');
      const aPrefix = ad.slice(0, ai).join(' ');
      const aKandidaat = (aPrefix ? voornaam + ' ' + aPrefix + ' ' : voornaam + ' ') + aAchternaam.slice(0, i);
      return aKandidaat === kandidaat;
    });
    if (nogSteeds.length === 0) return kandidaat;
  }
  return speler.naam;
}

// Bouw een map van spelerId → korte unieke naam voor een lijst spelers
function kortNaamMap(spelers) {
  const map = {};
  spelers.forEach(s => { map[s.id] = kortNaam(s, spelers); });
  return map;
}

function renderHcpBlok(spelers, holes, hcpPct, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const naamMap = kortNaamMap(spelers);
  const pct = hcpPct != null ? hcpPct : 0.75;

  let html = '';
  // Alle unieke koppels
  for (let i = 0; i < spelers.length; i++) {
    for (let j = i + 1; j < spelers.length; j++) {
      const a = spelers[i], b = spelers[j];
      const verschil = Math.round(Math.abs(a.hcp - b.hcp) * pct);
      const mindereHcp = a.hcp > b.hcp ? a : b;
      const meerdereHcp = a.hcp > b.hcp ? b : a;

      // Holes waarop mindereHcp slagen krijgt — ook bij meer dan 18 slagen
      const aantalHoles = holes.length;
      const slagHoles = holes
        .map((h, idx) => {
          const slagen = (h.si <= Math.min(verschil, aantalHoles) ? 1 : 0) +
                         (h.si <= Math.max(0, verschil - aantalHoles) ? 1 : 0);
          return { nr: idx + 1, si: h.si, slagen };
        })
        .filter(h => h.slagen > 0)
        .sort((a, b) => a.nr - b.nr);

      html += `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-weight:600;font-size:14px">${naamMap[a.id]} vs ${naamMap[b.id]}</span>
          <span style="font-size:12px;color:var(--mid);font-family:'DM Mono',monospace">${verschil === 0 ? 'Gelijke handicap' : `${naamMap[mindereHcp.id]} krijgt ${verschil} slag${verschil !== 1 ? 'en' : ''}`}</span>
        </div>
      </div>`;
    }
  }
  el.innerHTML = html || '<p style="font-size:13px;color:var(--light)">Geen koppels</p>';
}

// ============================================================

export { addPlayerSlot, alleBANEN, filterPartijSpelers, getPartijLadderSpelers, herlaadPartijSpelers, initPartijForm, kortNaam, kortNaamMap, mijnPartij, onBaanSelect, refreshPlayerSlotOptions, removeSlot, renderHandmatigHoles, renderHcpBlok, selecteerPartijSpeler, selecteerPartijSpelerEl, slaAangepasteBaanOp, sluitSpelerLijst, startPartij, verwijderAangepasteBaan, voegGastSpelerToeAanPartij, vulKnockoutTegenstander, zoekPartijSpeler };;
