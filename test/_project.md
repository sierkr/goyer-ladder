# Goyer Golf MP Ladder — Projectstructuur
> Dit bestand is bedoeld voor Claude. Lees dit als eerste bij een nieuwe upload.

## Versienummer — verhoog ALTIJD bij elke wijziging, ook kleine

| Bestand | Locatie | Formaat |
|---|---|---|
| `version.json` | root | `{"version": "v3.0.0-11.XX"}` |
| `sw.js` | regel 2 | `const CACHE_VERSION = 'v1XX';` |
| `js/app.js` | ~regel 221 | `const VERSION = 'v3.0.0-11.XX';` |
| `js/app.js` | ~regel 262 | `const LOKALE_VERSIE = 'v3.0.0-11.XX';` |

Huidige versie: **v3.0.0-11.89**

## Firebase
- Project: `goyer-golf-mp-ladder`
- Auth: email/wachtwoord (fake `@MPladder.stb` adressen) + Google
- Config staat in: `js/config.js`
- Region Cloud Functions: `europe-west1`

## Bestandsstructuur

```
ladder_v4/
├── index.html          # Hoofd-app (alle schermen in één pagina)
├── watch.html          # Standalone watch-scorekaart (PIN-login, +/- scores)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (caching + versie-check)
├── version.json        # Versienummer (server-side, voor auto-update detectie)
├── firestore.rules     # Firestore beveiligingsregels
├── _project.md         # Dit bestand
├── functions/
│   ├── index.js        # Cloud Functions (o.a. wachtwoord-reset)
│   └── package.json
└── js/
    ├── app.js          # Globals, imports, window.* exports, versie-check
    ├── config.js       # Firebase init, Firestore refs, helpers (esc, escAttr)
    ├── auth.js         # Firebase auth, huidigeBruiker, slaActievePartijenOp()
    ├── ronde.js        # Scorekaart, matchups, berekenMatchStand(), genereerWatchPin()
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

ladder/watchPins              # { [4-digit PIN]: { uid, naam, email, expires } }
ladder/config                 # { initieelWachtwoord }
ladder/banen                  # Alle beschikbare banen
ladder/uitdagingen            # Lopende uitdagingen
ladder/archief                # Seizoenshistorie
```

## Sleutelpatronen

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

### huidigeBruiker object
```js
{ uid, email, gebruikersnaam, rol, spelerId, eersteLogin }
```

### Versie-update detectie
- App vergelijkt `LOKALE_VERSIE` met `version.json` op server
- Bij mismatch: hard reload (zodat spelers altijd de nieuwste versie hebben)

## Buildregels (voor Claude)
- Bouw alleen na exact: **ja je mag bouwen**
- Verhoog versienummer bij elke wijziging (alle 4 plekken)
- Foutcontrole na elke wijziging
- Lever altijd een volledige downloadbare zip op
