# HANDOVER — Goyer Golf MP Ladder, v5.4.5

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
   plekken plus `_project.md` — zie de tabel bovenin `_project.md`.
3. **Altijd foutcontrole na een wijziging** (syntaxcheck + `node tests/run.cjs`).
4. **Lever altijd een volledige downloadbare zip** van het hele project.

Uitleggen in gewone taal, kort, zonder jargon. Instructies die hij moet
uitvoeren: genummerde stappen, geen extra tekst ertussen.

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
account — daarom is de bulk-import in test geblokkeerd.

---

## 3. Waar we nu staan

Versie in de zip: **v5.4.5**.

### Wat af en gedeployed is
v5.0.0 t/m v5.3.1 zitten in productie. Kort samengevat: het watch-PIN-lek is
gedicht, uitslagen worden server-side gecontroleerd (maar **scores blijven
uitdrukkelijk optioneel** — dat is een harde eis van de gebruiker), de
ladderstand is niet meer door spelers schrijfbaar, scores staan per speler in
een eigen document zodat ze elkaar niet meer overschrijven, het
activiteitssysteem is losgekoppeld van de partijverwerking en draait
maandagochtend, en snapshots/backups zijn compleet gemaakt.

### Wat gebouwd maar NIET goedgekeurd is
**v5.4.1 heeft nooit een `JA BOUWEN` gekregen.** Ik heb het toch gebouwd; dat
was een fout en de gebruiker heeft me daarop aangesproken. Het staat wél op
GitHub maar is niet naar productie. Inhoud: een wachthond die controleert of de
ladderstanden binnenkomen en de listeners zelf herstart, een knop
"↻ Opnieuw proberen" in plaats van de tekst "ververs de pagina", en een extra
browsertest daarop. **Vraag hier alsnog expliciet toestemming voor.**

### Waar we middenin zitten
De testopzet in vier lagen (v5.4.0, wél goedgekeurd) draait op GitHub Actions.
Stand van zaken bij de laatste run:

| Job | Status |
|---|---|
| Rekenkern (unit) — 164 tests | **groen** |
| Regels en Cloud Functions — ±50 + ±65 controles | **groen** |
| Browser (end-to-end) — 8 Playwright-tests | **rood, oorzaak nu gevonden en gefixt in v5.4.2** |

---

## 4. De eerstvolgende actie

De gebruiker heeft de fix van v5.4.2 **nog niet uitgevoerd**. Er is precies één
bestand gewijzigd: `playwright.config.cjs` in de hoofdmap. Het moet integraal
vervangen worden door de versie uit de zip, via de GitHub-webeditor
(potloodje → alles selecteren → plakken → Commit changes). Daarna tabblad
**Actions** en de nieuwe run afwachten.

**Wat er dan gebeurt:** Playwright start wel en drukt acht testnamen af. Reken
erop dat een deel daarvan rood is. Deze acht tests hebben nog nooit tegen de
echte app gedraaid; de selectors (`#ladder-list-mp`, `#nav-partij-btn`,
`#scorecard-body`) zijn afgeleid uit de broncode, niet uit een draaiende
browser. Werk ze daarna één voor één weg aan de hand van de foutmeldingen.
Rood in Actions raakt geen enkele speler — er staat niets in productie.

---

## 5. Fouten die ik al gemaakt heb — niet herhalen

| Fout | Wat je moet weten |
|---|---|
| "npm install hoeft niet voor een deploy" | Onjuist. De Firebase CLI laadt `functions/index.js` eerst lokaal om te ontdekken welke functies erin zitten. `cd functions && npm install` is **altijd** nodig. |
| `firebase deploy --only firestore:rules --database test` | `--database` bestaat niet als optie van `deploy`. Gebruik het commando zonder; `firebase.json` bevat beide databases al. |
| Striktere Firestore-regel eronder gezet | Meerdere `allow read`-regels worden met **OR** gecombineerd. Een strengere regel verderop overschrijft een ruimere regel erboven **niet**. Sluit expliciet uit. |
| Activiteitscorrectie in `verwerkPartijUitslag` | Die stapelde op — een verliezer steeg 6 plekken per partij. Activiteit hoort daar **helemaal niet** meer thuis; die draait uitsluitend periodiek. |
| `data.localId` uit `signInWithCustomToken` | Bestaat niet in dat antwoord (wel bij `signInWithPassword`). |
| `npx --prefix tests firebase-tools ...` | Het programma heet `firebase`, niet `firebase-tools`. Gebruik in CI het directe pad `./tests/node_modules/.bin/firebase`. |
| `require()` in `playwright.config.cjs` | Zie v5.4.2 — hoofdmap kan niet bij `tests/node_modules`. |
| v5.4.1 gebouwd zonder toestemming | Zie regel 1 hierboven. |

---

## 6. Praktische aandachtspunten

- **`functions/` hoort wél in de repo** (`index.js` + `package.json`), want de
  CI-jobs draaien `npm install --prefix functions`. De gebruiker gooide die map
  vroeger na elke deploy weg; dat brak de tests. `functions/node_modules` mag
  nooit mee — staat in `.gitignore`.
- **De Anthropic API-sleutel** (voor de scorekaart-scan) staat uitsluitend in
  de Firebase-secret `ANTHROPIC_API_KEY`. Nooit in `js/config.js` of enig
  bestand dat naar GitHub Pages gaat.
- **Eenmalige IAM-stap** die al gedaan is: het serviceaccount
  `<projectnummer>-compute@developer.gserviceaccount.com` heeft de rol
  *Service Account Token Creator* nodig, anders kan geen enkele watch-login
  een token krijgen.
- **`js/config.js` verbindt met de emulator** zodra de app op `localhost` of
  `127.0.0.1` draait, en slaat App Check dan over. In productie en test wordt
  de app altijd vanaf `sierkr.github.io` geserveerd, dus die voorwaarde is daar
  nooit waar.

---

## 7. Nog openstaand

1. **v5.4.1 alsnog laten goedkeuren** (of terugdraaien).
2. **De browsertests groen krijgen** — zie punt 4.
3. **De productiemap `goyer-ladder\` (zonder `\test`) loopt achter.** Daar
   staat geen `functions`-map en de app-bestanden zijn niet meegegroeid met
   test. Afgesproken: oppakken zodra de tests groen zijn.
4. **`firebase.json` bevat twee databases**, waardoor de emulator waarschuwt
   dat hij de regels niet kan laden ("does not support multiple databases
   yet"). De regelstests draaien nu zonder de echte regels in de
   functions-job — controleer of dat klopt zodra er tijd voor is.
5. **`functions/package.json` noemt een verouderde `firebase-functions`.** De
   emulator waarschuwt erover. Bijwerken vraagt een deploy en dus toestemming.

---

## 8. Commando's die je nodig hebt

```
node tests/run.cjs                 # 164 rekentests, 2 seconden, geen installatie
node --check <bestand>             # syntaxcontrole
```

Deployen naar Firebase staat volledig uitgeschreven in `DEPLOYEN.md`.
Testomgeving en emulator staan in `TESTOMGEVING.md`.
