// ============================================================
//  store.js — Centrale gedeelde state voor alle modules
// ============================================================
import { DEFAULT_STATE } from './config.js';

// ─── Actieve ladder state ────────────────────────────────────
export let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
export let alleLadders = [];
export let activeLadderId = null;

// alleSpelersData is in v3.0.0-9c een AFGELEIDE view van _usersCache.
// Legacy-code die {id, naam, hcp} verwacht werkt door, maar id = uid (string).
// Directe writes zijn no-ops — het veld wordt automatisch gesynchroniseerd
// telkens _usersCache verandert.
export let alleSpelersData = [];

function _syncAlleSpelersDataFromUsers() {
  alleSpelersData.length = 0;  // mutate in place zodat import-bindings geldig blijven
  if (Array.isArray(_usersCache)) {
    for (const u of _usersCache) {
      if (!u || !u.uid) continue;
      alleSpelersData.push({
        id:    u.uid,           // uid als id (string) — vervangt numeric id
        uid:   u.uid,
        naam:  u.naam  || '',
        hcp:   u.hcp   ?? 0,
        email: u.email || '',
        rol:   u.rol   || 'speler',
      });
    }
  }
}

// ─── Auth ────────────────────────────────────────────────────
export let huidigeBruiker = null;
export let _usersCache = null;
export let _bezigMetRegistratie = false;
export let _firestoreReady = false;

// ─── Archief & toernooi ──────────────────────────────────────
export let archiefData = [];
export let uitdagingenData = [];
export let toernooiData = null;
export let alleToernooien = [];
export let actieveToernooiId = null;

// ─── Toernooi setup ──────────────────────────────────────────
export let _tGeselecteerdeSpelers = [];
export let _tSpelersLadderIds = new Set();
export let _tRankingLadderIds = new Set();
export let _flights = [];
export let _toernooiSpelerToevoegen = null;

// ─── Partij ──────────────────────────────────────────────────
export let playerSlotCount = 0;
export let _beheerPartijId = null;
export let _beheerWinnaars = [];
export let _highlights = new Set();

// ─── Ladder beheer ───────────────────────────────────────────
export let _instellingenLadderId = null;
export let _standAanpassenLadderId = null;
export let _standAanpassenSpelers = [];
export let _ladderSpelersId = null;

// ─── Knockout ────────────────────────────────────────────────
export let _koLadderId = null;
export let _koIndelingVolgorde = [];
export let _koDragIdx = null;
export let _koTouchClone = null;
export let _koTouchStartY = 0;

// ─── Listeners ───────────────────────────────────────────────
export let _vasteListeners = [];
export let _toernooiListeners = [];

// ─── Ladder config ───────────────────────────────────────────
export const DEFAULT_LADDER_CONFIG = {
  laagStijg: 4, laagZak: 2, hoogStijg: 1, hoogZak: 1,
  verliezerNaarWinnaar: false, drempel: 4
};

// ─── Aangepaste banen ───────────────────────────────────────
export let aangepasteBanen = [];

// ─── Setters (voor modules die state moeten updaten) ─────────
// Omdat ES modules geen directe reassignment van geïmporteerde
// let variabelen ondersteunen, gebruiken we setters.
export const store = {
  set state(v) { state = v; },
  get state() { return state; },
  set alleLadders(v) { alleLadders = v; },
  get alleLadders() { return alleLadders; },
  set activeLadderId(v) { activeLadderId = v; },
  get activeLadderId() { return activeLadderId; },
  set alleSpelersData(v) {
    // No-op in v3.0.0-9c — alleSpelersData is afgeleid van _usersCache.
    // Oude code die direct assigned werkt nog, maar de write heeft geen effect.
    // (Blijft stil om console-spam te vermijden; kan later helemaal weg.)
  },
  get alleSpelersData() { return alleSpelersData; },
  set huidigeBruiker(v) { huidigeBruiker = v; },
  get huidigeBruiker() { return huidigeBruiker; },
  set _usersCache(v) {
    _usersCache = v;
    _syncAlleSpelersDataFromUsers();
  },
  get _usersCache() { return _usersCache; },
  set _bezigMetRegistratie(v) { _bezigMetRegistratie = v; },
  get _bezigMetRegistratie() { return _bezigMetRegistratie; },
  set _firestoreReady(v) { _firestoreReady = v; },
  get _firestoreReady() { return _firestoreReady; },
  set archiefData(v) { archiefData = v; },
  get archiefData() { return archiefData; },
  set uitdagingenData(v) { uitdagingenData = v; },
  get uitdagingenData() { return uitdagingenData; },
  set toernooiData(v) { toernooiData = v; },
  get toernooiData() { return toernooiData; },
  set alleToernooien(v) { alleToernooien = v; },
  get alleToernooien() { return alleToernooien; },
  set actieveToernooiId(v) { actieveToernooiId = v; },
  get actieveToernooiId() { return actieveToernooiId; },
  set _tGeselecteerdeSpelers(v) { _tGeselecteerdeSpelers = v; },
  get _tGeselecteerdeSpelers() { return _tGeselecteerdeSpelers; },
  set _tSpelersLadderIds(v) { _tSpelersLadderIds = v; },
  get _tSpelersLadderIds() { return _tSpelersLadderIds; },
  set _tRankingLadderIds(v) { _tRankingLadderIds = v; },
  get _tRankingLadderIds() { return _tRankingLadderIds; },
  set _flights(v) { _flights = v; },
  get _flights() { return _flights; },
  set playerSlotCount(v) { playerSlotCount = v; },
  get playerSlotCount() { return playerSlotCount; },
  set _beheerPartijId(v) { _beheerPartijId = v; },
  get _beheerPartijId() { return _beheerPartijId; },
  set _beheerWinnaars(v) { _beheerWinnaars = v; },
  get _beheerWinnaars() { return _beheerWinnaars; },
  set _highlights(v) { _highlights = v; },
  get _highlights() { return _highlights; },
  set _vasteListeners(v) { _vasteListeners = v; },
  get _vasteListeners() { return _vasteListeners; },
  set _toernooiListeners(v) { _toernooiListeners = v; },
  get _toernooiListeners() { return _toernooiListeners; },
  set _koLadderId(v) { _koLadderId = v; },
  get _koLadderId() { return _koLadderId; },
  set _koIndelingVolgorde(v) { _koIndelingVolgorde = v; },
  get _koIndelingVolgorde() { return _koIndelingVolgorde; },
  set _koDragIdx(v) { _koDragIdx = v; },
  get _koDragIdx() { return _koDragIdx; },
  set _koTouchClone(v) { _koTouchClone = v; },
  get _koTouchClone() { return _koTouchClone; },
  set _koTouchStartY(v) { _koTouchStartY = v; },
  get _koTouchStartY() { return _koTouchStartY; },
  set _standAanpassenSpelers(v) { _standAanpassenSpelers = v; },
  get _standAanpassenSpelers() { return _standAanpassenSpelers; },
  set _ladderSpelersId(v) { _ladderSpelersId = v; },
  get _ladderSpelersId() { return _ladderSpelersId; },
  set _standAanpassenLadderId(v) { _standAanpassenLadderId = v; },
  get _standAanpassenLadderId() { return _standAanpassenLadderId; },
  set _instellingenLadderId(v) { _instellingenLadderId = v; },
  get _instellingenLadderId() { return _instellingenLadderId; },
  set _toernooiSpelerToevoegen(v) { _toernooiSpelerToevoegen = v; },
  get _toernooiSpelerToevoegen() { return _toernooiSpelerToevoegen; },
  set aangepasteBanen(v) { aangepasteBanen = v; },
  get aangepasteBanen() { return aangepasteBanen; },
  set _beheerPartijId(v) { _beheerPartijId = v; },
  get _beheerPartijId() { return _beheerPartijId; },
};
