# Goyer Golf MP Ladder — Projectstructuur
> Dit bestand is bedoeld voor Claude. Lees dit als eerste bij een nieuwe upload.

## Versienummer — verhoog ALTIJD bij elke wijziging, ook kleine

| Bestand | Locatie | Formaat |
|---|---|---|
| `version.json` | root | `{"version": "v3.0.0-11.XX"}` |
| `sw.js` | regel 2 | `const CACHE_VERSION = 'v1XX';` |
| `js/app.js` | ~regel 221 | `const VERSION = 'v3.0.0-11.XX';` |
| `js/app.js` | ~regel 262 | `const LOKALE_VERSIE = 'v3.0.0-11.XX';` |

Huidige versie: **v4.0.1**

### Changelog
- **v4.0.1** — Fix 7.8: flightgenoten konden elkaars toernooiscores niet
  invoeren. De Firestore-regel voor `toernooien/{id}/live/{uid}` stond alleen
  schrijven op de eigen uid toe (of coordinator), waardoor bij invoer voor de
  hele flight alleen de eigen score doorkwam. Nieuw: `allow write: if
  isIngelogd();` — elke ingelogde speler mag live-scores schrijven (de app
  toont andere flights toch niet; coordinator/beheerder vallen hier automatisch
  onder). LET OP: `firestore.rules` moet handmatig in de Firebase console
  worden gepubliceerd, de zip deployt geen rules.
- **v4.0.0** — Zeven robuustheidsfixes in de toernooimodus (`js/toernooi.js`):
  - **7.1 Concept-opslag setup**: het setup-formulier (naam, dagen, spelers,
    flights-instellingen, ladder-selecties) wordt debounced als concept in
    localStorage bewaard (`toernooiConcept_v1`) en bij eerste laden hersteld;
    gewist na succesvol starten. Functies: `slaToernooiConceptOp()`,
    `herstelToernooiConcept()`, `pasConceptDagenToe()`, `koppelConceptAutosave()`,
    `wisToernooiConcept()`.
  - **7.2 Geannuleerde toernooien**: nieuw beheerdersblok "Geannuleerde
    toernooien" onderaan de toernooipagina met Herstellen (status → actief) en
    Definitief verwijderen (incl. live/-subdocs). Confirm-tekst bij annuleren
    eerlijk gemaakt (was: "alle scores gaan verloren").
  - **7.3 Terug-naar-setup vangnet**: `heeftGeenScores()` checkt nu ook de
    live-cache; `bewerkToernooi()` leest de live/-subcollectie vers uit
    Firestore en blokkeert bij aanwezige scores.
  - **7.4 Dag bekijken is lokaal**: `selecteerDag()` schrijft niet meer naar
    Firestore; `window._bekijkDagNr` bepaalt lokaal de getoonde dag en
    `actieveDag()` respecteert die. Score-invoer/live-writes gebruiken
    `dag.dagNr`. Reset bij toernooi-wissel, nieuwe dag en herstel.
  - **7.5 Speler verwijderen**: geblokkeerd als de speler scores heeft op een
    afgesloten dag; anders uitgebreidere confirm. Live-doc van de speler wordt
    mee opgeruimd.
  - **7.6 Gerichte updates**: toggles (toernooiModus, scoresVerborgen,
    matrixIngeklapt, _ranglijstModus) via `updateDoc` met één veld i.p.v.
    `setDoc` van het hele document — geen stille overschrijvingen meer bij
    gelijktijdig beheer.
  - **7.7 Opschonen**: verouderde `verwijderToernooiSpeler()` verwijderd
    (incl. export + `app.js`-bindings); gast-ID's bevatten nu een timestamp
    (`gast_<tijd>_<random>`).
- **v3.0.2** — Fix discrepantie uitslagbericht vs. ladderpositie. Het
  LADDERWIJZIGINGEN-bericht (`showLadderChanges` in `js/ronde.js`) toonde de
  rauwe *competitierank* (`rank` uit `standen/{uid}`), terwijl de ladderlijst en
  de gedeelde afbeelding de *weergaverang* tonen (activiteits-gecorrigeerd via
  inactiviteit/frequentie/diversiteit). Daardoor weken de getallen elke partij
  af. Nieuw: `berekenWeergaveRangen()` in `js/ladder.js` (geëxporteerd) berekent
  de weergaverang voor een meegegeven spelerslijst; `ronde.js` maakt een
  snapshot vóór en ná de partij en rapporteert die nummers. Pijlrichting wordt
  nu afgeleid uit het verschil i.p.v. hardgecodeerd.

## Firebase
- Project: `goyer-golf-mp-ladder`
- Auth: email/wachtwoord (fake `@MPladder.stb` adressen) + Google
- Config staat in: `js/config.js`
- Region Cloud Functions: `europe-west1`

## Bestandsstructuur

```
ladder_v4/
├── index.html                  # Hoofd-app (alle schermen in één pagina)
├── watch.html                  # Watch Score — standalone scorekaart voor Apple Watch
│                               # Geen Firebase SDK — werkt via REST API (fetch)
│                               # PIN-login (4 cijfers) → auto-inloggen via refresh token
│                               # 2×2 score grid, tap links=−1 rechts=+1, eerste tik=par
│                               # Donker Watch-thema, real-time stand + totaal
├── watch_backup_v11_86.html    # Backup van watch.html vóór grid/tap redesign
├── handleiding-partij-ronde.html # Handleiding incl. Apple Watch sectie
├── manifest.json               # PWA manifest
├── sw.js                       # Service Worker (caching + versie-check)
├── version.json                # Versienummer (server-side, voor auto-update detectie)
├── firestore.rules             # Firestore beveiligingsregels
├── _project.md                 # Dit bestand
├── functions/
│   ├── index.js                # Cloud Functions (o.a. wachtwoord-reset)
│   └── package.json
└── js/
    ├── app.js          # Globals, imports, window.* exports, versie-check
    ├── config.js       # Firebase init, Firestore refs, helpers (esc, escAttr)
    ├── auth.js         # Firebase auth, huidigeBruiker, slaActievePartijenOp()
    ├── ronde.js        # Scorekaart, matchups, berekenMatchStand(), renderWatchPin()
    ├── partij.js       # mijnPartij(), startPartij(), renderHcpBlok()
    ├── ladder.js       # Ladder rendering
    ├── ladder-view.js  # getLadderSpelers()
    ├── admin.js        # Beheerfuncties
    ├── beheer.js       # Snapshots, backup
    ├── knockout.js     # Knockout-toernooi logica
    ├── toernooi.js     # Toernooi-beheer
    ├── uitslagen.js    # Uitslagen en scorekaart-detail
    ├── archief.js      # Seizoensarchief
    ├── nav.js          # Navigatie (showPage)
    └── store.js        # Gedeelde state (alleLadders, huidigeBruiker, etc.)
```

## Datamodel Firestore

```
ladders/{ladderId}
  .actievePartijen[]          # Actieve rondes
    .spelers[]                # { uid, naam, hcp, partijHcp }
    .scores[uid][holeIdx]     # Ruwe scores (null = niet ingevuld)
    .matchups[]               # { spelerA, spelerB, hcpSlagen, hcpOntvanger }
    .holes[]                  # { par, si }
    .baan                     # Naam van de baan
    .ladderId                 # Verwijzing naar eigen ladder
    .startHole                # 1-gebaseerd (bijv. 1 of 10)
  .uitslagen[]
  .spelerIds[]                # UIDs van leden
  .standen/{uid}              # Stand per speler

spelers/{uid}
  .naam, .email, .hcp, .rol, .eersteLogin

ladder/watchPins              # { [4-digit PIN]: { uid, naam, email, refreshToken, expires } }
                              # refreshToken wordt gebruikt door watch.html om in te loggen
                              # zonder wachtwoord. Aangemaakt door renderWatchPin() in ronde.js.
                              # Publieke read-regel in firestore.rules (watch.html is niet auth'd)
ladder/config                 # { initieelWachtwoord }
ladder/banen                  # Alle beschikbare banen
ladder/uitdagingen            # Lopende uitdagingen
ladder/archief                # Seizoenshistorie
```

## Watch Score — REST API aanpak

watch.html gebruikt geen Firebase SDK maar directe fetch() aanroepen:

```js
const FS        = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH_URL  = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;

// PIN ophalen (publiek, geen auth)
fetch(`${FS}/ladder/watchPins?key=${API_KEY}`)

// Inloggen via refresh token (geen wachtwoord)
fetch(TOKEN_URL, { body: `grant_type=refresh_token&refresh_token=${rToken}` })

// Partijen ophalen (met idToken)
fetch(`${FS}/ladders?pageSize=50&key=${API_KEY}`, { headers: { Authorization: `Bearer ${idToken}` } })

// Scores opslaan (PATCH, fire-and-forget)
fetch(`${FS}/ladders/${ladderId}?updateMask.fieldPaths=actievePartijen&key=${API_KEY}`, { method: 'PATCH', ... })
```

Token vernieuwen elke 55 minuten via setInterval (token verloopt na 60 min).
Polling elke 10 seconden voor live updates van andere spelers.

## Sleutelpatronen hoofdapp

### Actieve partij ophalen
```js
// mijnPartij() in partij.js — zoekt op uid in alle ladders
const p = mijnPartij(); // geeft partij-object of null
```

### Score opslaan
```js
// slaActievePartijenOp(ladderId) in auth.js
// schrijft hele actievePartijen[] array terug naar Firestore
await slaActievePartijenOp(p.ladderId);
```

### Watch PIN genereren
```js
// renderWatchPin() in ronde.js — aangeroepen vanuit renderRonde()
// Genereert of hergebruikt PIN, slaat refreshToken op, toont in gele badge
```

### huidigeBruiker object
```js
{ uid, email, gebruikersnaam, rol, spelerId, eersteLogin }
// In ronde.js altijd via store.huidigeBruiker (niet direct importeren)
```

### Versie-update detectie
- App vergelijkt `LOKALE_VERSIE` met `version.json` op server
- Bij mismatch: hard reload (zodat spelers altijd de nieuwste versie hebben)

## Buildregels (voor Claude)
- Bouw alleen na exact: **JA BOUWEN** (hoofdletters, twee woorden, alleen dit in het bericht)
- Verhoog versienummer bij elke wijziging (alle 4 plekken + _project.md)
- Foutcontrole na elke wijziging
- Lever altijd een volledige downloadbare zip op
