# HANDOVER — Goyer Golf MP Ladder, v5.5.1

> Plak dit bestand als eerste bericht in een nieuwe chat, samen met de zip.
> Lees daarna `_project.md` voor de volledige structuur en changelog.

---

## 1. Wie is de gebruiker en hoe wil hij werken

Sierk, niet-technisch. Vier harde regels die altijd gelden:

1. **Bouw alleen na exact `JA BOUWEN`** (hoofdletters, twee woorden, alleen dat
   in het bericht). Stel na elke analyse zélf expliciet de vraag: *"Wil je dat
   ik dit bouw? Antwoord alleen met JA BOUWEN."* Niet bouwen zonder die vraag
   te hebben gesteld.
2. **Verhoog altijd het versienummer**, hoe klein de wijziging ook is. Vier
   plekken plus `tests/package.json`, `_project.md` en dit bestand — zie de
   tabel bovenin `_project.md`.
3. **Altijd foutcontrole na een wijziging** (syntaxcheck + `node tests/run.cjs`).
4. **Lever altijd een volledige downloadbare zip** van het hele project.

Uitleggen in gewone taal, kort, zonder jargon. Instructies die hij moet
uitvoeren: genummerde stappen, geen extra tekst ertussen.

**Vertel er altijd bij welke bestanden hij moet vervangen en waar** — GitHub-
upload (app en tests) of een Firebase-deploy (Cloud Functions). Dat onderscheid
is een keer misgegaan.

---

## 2. Wat de app is

Een match-play ladder voor golfclub Het Goyer, als PWA (spelers hebben hem als
pictogram op hun telefoon — **er is dus geen adresbalk en geen verversknop**;
schrijf nooit "ververs de pagina" in een melding).

| Onderdeel | Waar |
|---|---|
| App (index.html, js/, watch.html) | GitHub Pages, `sierkr.github.io/goyer-ladder/` |
| Testomgeving | dezelfde repo, submap `/test/` |
| Cloud Functions + Firestore-regels | Firebase project `goyer-golf-mp-ladder`, regio `europe-west1` |
| Databases | twee: `(default)` = productie, named database `test` |

Auth is **gedeeld** tussen test en productie. Een testaccount is dus een echt
account — daarom is de bulk-import in test geblokkeerd, en daarom verandert een
wachtwoordwijziging in test ook het echte wachtwoord.

---

## 3. Waar we nu staan

Versie in de zip: **v5.5.1**.

### De testopzet is groen

Alle vier de CI-jobs op GitHub Actions slagen:

| Job | Inhoud |
|---|---|
| Rekenkern (unit) | 164 tests, geen emulator nodig |
| Regels en Cloud Functions | ±50 + ±65 controles tegen de emulator |
| Browser (end-to-end) | 11 Playwright-tests |

Dat was een traject van 1 geslaagde test naar alles groen. Onderweg zijn er
**drie echte fouten in de app** uit gekomen die spelers raakten — zie hieronder.

### Wat er in productie draait (v5.4.4 t/m v5.5.1)

- **Het opstarten kan niet meer in zijn geheel omvallen.** `initFirestore()`
  laadde documenten in één blok; ging er één mis, dan werd alles daarna
  overgeslagen, inclusief de banen en de ladders. Elke stap heeft nu eigen
  foutopvang.
- **De banenlijst herstelt zichzelf.** De app kon niet zien of een leeg antwoord
  betekende "er zijn geen banen" of "ik kon de server niet bereiken" — bij een
  lege eigen kopie geeft Firestore geen fout maar "bestaat niet". Dat wordt nu
  onderscheiden, na het inloggen opnieuw geprobeerd, en het partijformulier
  haalt de lijst alsnog op met een "↻ Opnieuw proberen"-knop.
- **Een lege lijst kan geen banen meer wissen.** Opslaan en verwijderen schreven
  de volledige lijst uit het geheugen over het document heen; één klik met een
  lege lijst wiste alle banen van alle spelers. Nu wordt de serverlijst
  opgehaald en met precies één wijziging teruggeschreven.
- **De ladder tekent opnieuw zodra de namen binnen zijn.** De ladderlijst heeft
  twee bronnen nodig (standen en namen), maar alleen de standen-listener gaf een
  seintje om te hertekenen. Kwamen de namen later, dan bleef "Nog geen spelers."
  staan. Dit heeft vermoedelijk langer meegespeeld dan we dachten.
- **De wachthond uit v5.4.1 draait mee.** Die controleert na het inloggen of de
  standen binnenkomen en zet de listeners anders opnieuw op (vijf pogingen,
  daarna stopt hij). Hij is met v5.4.6 meegegaan naar productie.
- **v5.5.0: test en productie schrijven niet meer door elkaar.** Zie hieronder.
- **v5.5.1: meldingen die iets zeggen.** De watch perste elke mislukte
  inlogpoging samen tot "Ongeldige of verlopen PIN" en gooide de precieze reden
  van de server weg; de scorekaart meldde altijd "ouder dan 30 dagen", ook als er
  simpelweg nooit een scorekaart is gemaakt.

### Watch-PIN — wat je moet weten

De codes worden **per database** bewaard in `ladder/watchPins`. Een code die in
de test-app is aangevraagd bestaat niet in productie en andersom. Het adres van
de watch-pagina bepaalt waar hij zoekt:
`…/goyer-ladder/watch.html` = productie, `…/goyer-ladder/test/watch.html` = test.
Dit was de oorzaak van een lange zoektocht: de server gaf keurig 403
("Ongeldige of verlopen PIN") omdat de code in de andere la lag, maar dat was op
het scherm niet te zien. Sinds v5.5.1 toont het PIN-scherm de omgeving.

Een code is 15 minuten geldig en werkt precies één keer. De foutteller is
**globaal**: twintig mislukte pogingen binnen tien minuten blokkeert het voor
iedereen.

Logs bekijken gaat het makkelijkst via de Firebase-console → Functions →
tabblad Logs. In de Logs Explorer van Google Cloud loggen deze functies onder
`cloud_run_revision`, niet onder `cloud_function` — filteren op het oude type
geeft altijd nul resultaten.

### v5.5.0 vraagt een Cloud Functions-deploy

`voltooiEersteLogin` en `resetSpelerWachtwoord` gebruikten `admin.firestore()`
en schreven dus **altijd naar de productiedatabase**, ook vanuit `/test/`.
Gevolgen: het eerste-loginscherm bleef in test elke keer terugkomen (de vlag
werd in productie omgezet), de echte handicap van die speler werd overschreven,
en een wachtwoordreset vanuit het testbeheerscherm zette `eersteLogin: true` op
het échte spelersdocument. De helper `fsVoor(isTest)` bestond al en werd door
zestien andere functies gewoon gebruikt; deze twee waren overgeslagen.

**Deze versie is pas af als de functions gedeployed zijn.** Alleen de bestanden
op GitHub zetten is niet genoeg.

---

## 4. De eerstvolgende acties

1. **Cloud Functions deployen** (v5.5.0). Zie `DEPLOYEN.md`. `cd functions &&
   npm install` is altijd nodig — de Firebase CLI laadt `index.js` eerst lokaal.
2. **Controleren of er productiedata is beschadigd.** Spelers die in `/test/`
   het eerste-loginscherm hebben ingevuld, hebben mogelijk een verkeerde
   handicap in de live-database. Bekend geval: Ewout.
3. **De productiemap bijwerken.** `goyer-ladder/` (zonder `/test/`) loopt achter
   op `/test/`. Zie punt 6.

---

## 5. Fouten die al gemaakt zijn — niet herhalen

| Fout | Wat je moet weten |
|---|---|
| "npm install hoeft niet voor een deploy" | Onjuist. De Firebase CLI laadt `functions/index.js` eerst lokaal om te ontdekken welke functies erin zitten. `cd functions && npm install` is **altijd** nodig. |
| `firebase deploy --only firestore:rules --database test` | `--database` bestaat niet als optie van `deploy`. Gebruik het commando zonder; `firebase.json` bevat beide databases al. |
| Striktere Firestore-regel eronder gezet | Meerdere `allow read`-regels worden met **OR** gecombineerd. Een strengere regel verderop overschrijft een ruimere regel erboven **niet**. Sluit expliciet uit. |
| Activiteitscorrectie in `verwerkPartijUitslag` | Die stapelde op. Activiteit hoort daar niet thuis; die draait uitsluitend periodiek. |
| `data.localId` uit `signInWithCustomToken` | Bestaat niet in dat antwoord (wel bij `signInWithPassword`). |
| `npx --prefix tests firebase-tools ...` | Het programma heet `firebase`. Gebruik in CI het directe pad `./tests/node_modules/.bin/firebase`. |
| `require()` in `playwright.config.cjs` | De hoofdmap kan niet bij `tests/node_modules`. De config vraagt daarom niets meer op. |
| v5.4.1 gebouwd zonder toestemming | Zie regel 1. Die code draait inmiddels wél in productie (meegegaan met v5.4.6) — dat is destijds niet expliciet gemeld toen om vervanging van `js/auth.js` werd gevraagd. |
| Twee keer geraden bij de browsertests | Kostte twee ronden. Bij een onduidelijke testfout: eerst laten afdrukken wát er op het scherm staat (`toonSchermstatus()` staat klaar in `tests/e2e/app.spec.cjs`), dan pas repareren. |
| `.catch(() => {})` achter een klik in een test | Slikt een mislukking op, waarna de test veel later op een andere regel faalt en het spoor weg is. Nooit doen. |
| `page.locator('text=Naam')` in een test | Onzichtbare pagina's staan gewoon in de DOM. Scope altijd op het element waar het om gaat. |

---

## 6. Praktische aandachtspunten

- **De productiemap loopt achter.** Deze bestanden verschillen en moeten mee
  naar `goyer-ladder/` (zonder `/test/`) zodra je de nieuwe versie uitrolt:
  `index.html`, `js/*.js` (alle), `sw.js`, `version.json`, `manifest.json`,
  `watch.html`. De map `functions/` hoort in de repo maar wordt niet door
  GitHub Pages geserveerd — die gaat via een Firebase-deploy.
- **`functions/` hoort wél in de repo** (`index.js` + `package.json`), want de
  CI-jobs draaien `npm install --prefix functions`. `functions/node_modules`
  mag nooit mee — staat in `.gitignore`.
- **De Anthropic API-sleutel** staat uitsluitend in de Firebase-secret
  `ANTHROPIC_API_KEY`. Nooit in `js/config.js` of enig bestand dat naar GitHub
  Pages gaat.
- **Eenmalige IAM-stap** die al gedaan is: het serviceaccount
  `<projectnummer>-compute@developer.gserviceaccount.com` heeft de rol
  *Service Account Token Creator*, anders kan geen enkele watch-login een token
  krijgen.
- **`js/config.js` verbindt met de emulator** zodra de app op `localhost` of
  `127.0.0.1` draait, gebruikt dan projectnaam `demo-goyer` en slaat App Check
  over. In productie en test wordt de app altijd vanaf `sierkr.github.io`
  geserveerd, dus die voorwaarde is daar nooit waar.
- **`firebase.json` bevat twee databases**, waardoor de emulator meldt dat hij
  de regels niet kan laden en alles toestaat. De regeltests laden hun regels
  daarom zelf; de browsertests draaien dus zonder rechtencontrole.

---

## 7. Nog openstaand

1. **Cloud Functions deployen voor v5.5.0** — zonder deze stap is de fix niet
   actief. Zie punt 4.
2. **`firebase-admin` staat op `^12`, de nieuwste is `14`.** Bewust niet
   meegenomen: twee majors tegelijk, midden in het testen.
   `firebase-functions` is in v5.5.0 wél naar `^6` gegaan (de code gebruikt al
   de v2-API, dus dat is één stap en laag risico). Werkt de deploy niet, zet
   hem dan terug op `^5.0.0` en deploy opnieuw.
3. **Het zelfherstel van de banenlijst zit alleen in het partijformulier.** De
   toernooi-schermen bouwen hun baankeuze op dezelfde lijst, maar zonder tweede
   poging. Kleine ingreep als het daar ook opduikt.
4. **De wachthond is nu wél getest**, maar op zijn zichtbare gedrag (knop, geen
   "ververs de pagina", vult zichzelf zonder herladen), niet op zijn binnenkant
   — die is van buiten de app niet aan te spreken.
5. **Sierk test op dit moment het toernooi uitgebreid.** Meldingen daarover zijn
   waarschijnlijk nieuw terrein; het toernooi is in dit traject niet aangeraakt.

---

## 8. Commando's die je nodig hebt

```
node tests/run.cjs                 # 164 rekentests, 2 seconden, geen installatie
node --check <bestand>             # syntaxcontrole
cd functions && npm install        # ALTIJD vóór een functions-deploy
firebase deploy --only functions   # vanuit de projectmap
```

Deployen naar Firebase staat volledig uitgeschreven in `DEPLOYEN.md`.
Testomgeving en emulator staan in `TESTOMGEVING.md`.
