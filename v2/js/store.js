// ============================================================
//  store.js — Centrale gedeelde state voor alle modules
// ============================================================
import { DEFAULT_STATE } from './config.js';

// ─── Actieve ladder state ────────────────────────────────────
export let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
export let alleLadders = [];
export let activeLadderId = null;
export let alleSpelersData = [];

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
  set alleLadders(v) { alleLadders = v; },
  set activeLadderId(v) { activeLadderId = v; },
  set alleSpelersData(v) { alleSpelersData = v; },
  set huidigeBruiker(v) { huidigeBruiker = v; },
  set _usersCache(v) { _usersCache = v; },
  set _bezigMetRegistratie(v) { _bezigMetRegistratie = v; },
  set _firestoreReady(v) { _firestoreReady = v; },
  set archiefData(v) { archiefData = v; },
  set uitdagingenData(v) { uitdagingenData = v; },
  set toernooiData(v) { toernooiData = v; },
  set alleToernooien(v) { alleToernooien = v; },
  set actieveToernooiId(v) { actieveToernooiId = v; },
  set _tGeselecteerdeSpelers(v) { _tGeselecteerdeSpelers = v; },
  set _tSpelersLadderIds(v) { _tSpelersLadderIds = v; },
  set _tRankingLadderIds(v) { _tRankingLadderIds = v; },
  set _flights(v) { _flights = v; },
  set playerSlotCount(v) { playerSlotCount = v; },
  set _beheerPartijId(v) { _beheerPartijId = v; },
  set _beheerWinnaars(v) { _beheerWinnaars = v; },
  set _highlights(v) { _highlights = v; },
  set _vasteListeners(v) { _vasteListeners = v; },
  set _toernooiListeners(v) { _toernooiListeners = v; },
  set _koLadderId(v) { _koLadderId = v; },
  set _koIndelingVolgorde(v) { _koIndelingVolgorde = v; },
  set _koDragIdx(v) { _koDragIdx = v; },
  set _koTouchClone(v) { _koTouchClone = v; },
  set _koTouchStartY(v) { _koTouchStartY = v; },
  set _standAanpassenSpelers(v) { _standAanpassenSpelers = v; },
  set _ladderSpelersId(v) { _ladderSpelersId = v; },
  set _standAanpassenLadderId(v) { _standAanpassenLadderId = v; },
  set _instellingenLadderId(v) { _instellingenLadderId = v; },
  set _toernooiSpelerToevoegen(v) { _toernooiSpelerToevoegen = v; },
  set aangepasteBanen(v) { aangepasteBanen = v; },
  set _beheerPartijId(v) { _beheerPartijId = v; },
};
