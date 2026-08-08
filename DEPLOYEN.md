# Deployen — Goyer Golf MP Ladder

Wat waar draait:

- **De app zelf** (index.html, js/, watch.html) staat op GitHub Pages
  (`sierkr.github.io/goyer-ladder/`). Die zet je daar neer zoals je gewend
  bent — Firebase doet daar niets mee.
- **De Cloud Functions en de Firestore-regels** gaan naar Firebase. Dat is
  waar dit bestand over gaat.

---

## Eenmalig

```
npm install -g firebase-tools
firebase login
```

`firebase login` opent je browser. Log in met het Google-account waaronder het
project `goyer-golf-mp-ladder` valt.

---

## Elke keer dat je deployt

Ga naar de map waar je de zip hebt uitgepakt (de map met `firebase.json` erin).

### 1. Dependencies — ALTIJD doen

```
cd functions
npm install
cd ..
```

Dit is niet optioneel. De Firebase CLI laadt je `index.js` eerst op je eigen
computer om te ontdekken welke functies erin zitten, en daarvoor moet
`firebase-functions` lokaal geinstalleerd zijn. Ontbreekt het, dan krijg je
"Couldn't find firebase-functions package in your source code".

### 2. De API-sleutel — VÓÓR de eerste deploy

De functie `scanScorekaart` (foto van een scorekaart uitlezen) verwacht een
Anthropic API-sleutel. Staat die er niet, dan mislukt de hele deploy — ook de
functies die er niets mee te maken hebben.

```
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Hij vraagt om de waarde; plakken en enter. Zie `README-API-SLEUTEL` hieronder.

Gebruik je de scorekaart-scan niet? Zet dan gewoon een willekeurige tekst als
waarde. De andere functies werken dan normaal; alleen de scanknop geeft een
foutmelding.

### 3. Functies deployen

```
firebase deploy --only functions
```

Duurt een paar minuten. De eerste keer vraagt Google mogelijk om een paar
API's aan te zetten (Cloud Build, Artifact Registry) — bevestigen.

### 4. Firestore-regels deployen

Je hebt twee databases en een named database heeft zijn **eigen** regels. Dus
twee keer:

```
firebase deploy --only firestore:rules --database "(default)"
firebase deploy --only firestore:rules --database test
```

Of allebei in één keer (`firebase.json` heeft ze allebei staan):

```
firebase deploy --only firestore:rules
```

### 5. Controleren

```
firebase functions:list
```

Je hoort veertien functies te zien:

| Functie | Waarvoor |
|---|---|
| `maakWatchPin` | v5.0.0 — PIN aanmaken voor het horloge |
| `wisselWatchPin` | v5.0.0 — PIN omruilen voor een inlogtoken |
| `verwerkPartijUitslag` | Partij-uitslag verwerken + controleren |
| `draaiPartijTerug` | v5.0.0 — uitslag terugdraaien (coördinator) |
| `pasPuntenAan` | Handmatige puntenaanpassing |
| `verwerkActiviteitPeriodiek` | Activiteitscorrectie, maandag 04:00 |
| `verwerkActiviteitNu` | Activiteitscorrectie handmatig draaien |
| `draaiPartijTerug` | Uitslag terugdraaien (coordinator) |
| `resetSpelerWachtwoord` | Wachtwoord resetten (beheerder) |
| `voltooiEersteLogin` | Eerste login afronden |
| `scanScorekaart` | Scorekaart uitlezen uit een foto |
| `maakLadderSnapshot` | v5.2.0 - snapshot maken (incl. punten) |
| `herstelLadderSnapshot` | v5.2.0 - snapshot terugzetten (incl. punten) |
| `exporteerBackupExtra` | v5.2.0 - afgeschermde delen voor de backup |
| `importeerBackupExtra` | v5.2.0 - afgeschermde delen terugzetten |

---

## Als de deploy vastloopt

**"Couldn't find firebase-functions package"** -> `npm install` in `functions/`
(stap 1 hierboven).

**"Timeout after 10000"** -> de CLI krijgt je code niet binnen 10 seconden
ingelezen. Zet de limiet hoger en probeer opnieuw:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT=120
firebase deploy --only functions
```

Blijft het misgaan, dan is de meest voorkomende oorzaak dat het project in een
OneDrive-map staat: rechtsklik op `functions` -> "Altijd behouden op dit
apparaat", of zet het project buiten OneDrive.

---

## Drie dingen die alleen in de console kunnen

Deze staan bewust niet in de app, om te voorkomen dat iemand ze voor zichzelf
kan aanzetten.

1. **`ladder/config` → veld `initieelWachtwoord`** (tekst). Zonder dit kan er
   geen nieuwe speler worden aangemaakt.
2. **`spelers/{jouw-uid}` → veld `puntenBeheerder: true`** als je de ruwe
   punten wilt kunnen inzien. Op precies één account.

---

## README-API-SLEUTEL

1. Ga naar `console.anthropic.com` en log in (of maak een account aan).
2. Linksonder in de zijbalk: **Settings** → **API keys**.
   Rechtstreeks: `console.anthropic.com/settings/keys`
3. Klik **Create Key**, geef hem een naam (bijvoorbeeld `goyer-ladder`).
4. **Kopieer de sleutel meteen** — hij wordt maar één keer getoond en Anthropic
   bewaart hem niet. Kwijt? Dan maak je een nieuwe aan en zet je die opnieuw
   met het commando hierboven.

De sleutel begint met `sk-ant-`. Je hebt een account met tegoed nodig; dit is
een aparte betaalde dienst, los van een Claude-abonnement.

De sleutel wordt alleen server-side gebruikt (in de Cloud Function) en staat
niet in de app-code. Zet hem nooit in `js/config.js` of een ander bestand dat
naar GitHub Pages gaat — dan is hij voor iedereen leesbaar.

---

## Volgorde bij een nieuwe versie

1. App-bestanden naar GitHub Pages
2. `firebase deploy --only functions` (als er iets in `functions/` wijzigde)
3. `firebase deploy --only firestore:rules` (als `firestore.rules` wijzigde)

Bij v5.0.0/v5.0.1 zijn alle drie nodig — vooral de regels, want zonder die
stap blijft het watch-PIN-lek open staan.
