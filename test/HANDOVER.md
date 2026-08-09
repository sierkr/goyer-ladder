# HANDOVER — Goyer Golf MP Ladder, v5.7.0

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
   tabel bovenin `_project.md`. **Vergeet `WATCH_VERSIE` in `watch.html` niet**:
   die pagina vergelijkt zichzelf met `version.json` en herlaadt bij elk bezoek
   als het nummer achterloopt.
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

Versie in de zip: **v5.7.0**.

### De testopzet is groen

Alle vier de CI-jobs op GitHub Actions slagen:

| Job | Inhoud |
|---|---|
| Rekenkern (unit) | 164 tests, geen emulator nodig |
| Regels en Cloud Functions | ±50 + ±65 controles tegen de emulator |
| Browser (end-to-end) | 11 Playwright-tests |

Dat was een traject van 1 geslaagde test naar alles groen. Onderweg zijn er
**zes echte fouten in de app** uit gekomen die spelers raakten — drie via de
testopzet en drie via Sierks toernooitest. Zie hieronder.

### Wat er in productie draait (v5.4.4 t/m v5.5.4)

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
- **v5.5.2: de watch-pagina ververst zichzelf** en toont zijn versienummer.
- **v5.5.3: de watch schreef nooit één score weg.** Een fout veldpad gaf bij elk
  verzoek 400. Plus een zichtbare opslagstatus en een wachtrij met
  conflictcontrole.
- **v5.5.4: de telefoon toonde verouderde scores** terwijl PC en watch wel
  klopten. De score-luisteraar bleef hangen aan een weggegooid partij-object.

### v5.5.4 — waarom uitsluitend de telefoon achterliep

De score-luisteraar schrijft binnenkomende scores rechtstreeks in het
partij-OBJECT dat hij bij het koppelen meekreeg. Dat object wordt op twee
plekken vervangen terwijl het partijId hetzelfde blijft: in `herlaadNaResume()`
en in de onSnapshot op het ladderdocument. Beide zetten `actievePartijen` op de
kopie uit het ladderdocument — met de verouderde scores-array, want de echte
scores staan sinds v5.0.0 in de subcollectie.

`koppelScoreListener()` vergeleek alleen het partijId, dacht "ik luister al", en
bleef aan het weggegooide object hangen. Het nieuwe object op het scherm kreeg
nooit meer een score binnen.

`herlaadNaResume()` gaat af zodra de app uit de achtergrond terugkomt. Op een
PC-tabblad dat openstaat gebeurt dat nooit, op een telefoon voortdurend. Vandaar
het beeld: alle PC-schermen synchroon, de watch synchroon, alleen de telefoon
niet. **Vuistregel: test dit soort dingen altijd óók door de app op een telefoon
weg te schakelen en terug te halen.**

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

**v5.5.3 — de watch schreef nooit één score weg.** Het veldpad `holes.3` moet
``holes.`3` `` zijn (accenttekens om een onderdeel dat met een cijfer begint),
anders geeft Firestore 400. Elke hole is een cijfer, dus elk verzoek faalde, en
de melding ging naar een console die op een horloge niemand ziet. Sinds v5.5.3
staat de opslagstatus op het scherm en gaat elke score eerst naar de opslag van
het toestel zelf. Bij het versturen wordt eerst gecontroleerd of iemand anders
die hole intussen heeft gewijzigd — zo ja, dan wordt er niet overschreven maar
gevraagd. **Les:** bouw je met de kale REST-API, dan doet de
Firebase-bibliotheek een hoop stilzwijgend goed wat je zelf moet regelen.

**De watch-pagina ververst zichzelf sinds v5.5.2** en toont zijn versienummer
op het PIN-scherm. Dat was nodig omdat een horloge geen adresbalk en geen
verversknop heeft: een reparatie kon in de browser werken en op het horloge
tegelijk niets doen, zonder dat je kon zien dat daar een oude kopie stond.
**Bij het bouwen moet `WATCH_VERSIE` in `watch.html` meeveranderen** met het
versienummer — anders herlaadt de pagina zichzelf bij elk bezoek.

Werkt een horloge toch niet mee: open het adres met `?v=iets` erachter, dat is
voor het toestel een nieuwe pagina. Vervang daarna ook de opgeslagen
snelkoppeling — een oude snelkoppeling kan naar een oud adres blijven wijzen.

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
op GitHub zetten is niet genoeg. (Voor v5.5.0 is dat bevestigd gedaan.)

### v5.7.0 — uitrolvolgorde, in deze volgorde

1. Cloud Functions deployen.
2. Een gewone matchplay-partij afronden — controleren dat er niets stuk is.
3. De app-bestanden **alleen in `/test/`** zetten en daar alle vier de
   Amerikaantje-uitkomsten spelen, plus een High-Low en een matchplay.
   De functies zijn gedeeld, de databases niet — dit raakt geen productiedata.
4. Vooraf een ladder-momentopname maken (`maakLadderSnapshot`). Terugdraaien
   werkt per partij; blijkt een verschuiving structureel verkeerd, dan wil je
   één knop voor de hele ladder.
5. Pas daarna naar productie.

Andersom werkt niet: een nieuwe app die een oude functie aanroept, kan een
Amerikaantje niet afronden.

---

## 4. De eerstvolgende acties

1. **Bevestigen dat v5.5.4 het telefoonprobleem oplost.** Dit is de laatste
   openstaande melding. Test zo: corrigeer een hole op de watch, schakel op de
   telefoon naar een andere app en weer terug, en kijk of de correctie er staat.
   Dat weg-en-terug schakelen is de kern — zonder dat stap je over de fout heen.
2. **Cloud Functions deployen voor v5.7.0.** Die van v5.5.0 is bevestigd
   gedaan. Zie `DEPLOYEN.md`; `cd functions && npm install` is altijd nodig.
   Uitrolvolgorde staat hieronder — eerst de functies, dan pas de app.
3. **Controleren of er productiedata is beschadigd.** Spelers die in `/test/`
   het eerste-loginscherm hebben ingevuld, hebben mogelijk een verkeerde
   handicap in de live-database. Bekend geval: Ewout.
4. **De productiemap bijwerken.** `goyer-ladder/` (zonder `/test/`) loopt fors
   achter — er zijn sinds v5.4.3 tien versies uitgekomen. Zie punt 6 voor de
   bestandslijst.

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
| `updateMask.fieldPaths=holes.3` in de kale REST-API | Een pad-onderdeel dat met een cijfer begint moet tussen accenttekens: ``holes.`3` ``. Zonder die tekens antwoordt Firestore met 400. De Firebase-bibliotheek doet dat automatisch, dus de app had er nooit last van en de watch faalde altijd. Kostte jaren aan wisselvallig gedrag. |
| Een listener die in een object schrijft | Herkoppel ook als het OBJECT vervangen is, niet alleen als het id verandert. Anders schrijft hij in een weggegooide kopie en blijft het scherm op oude waarden staan. Zie v5.5.4. |
| Een naam twee keer importeren in hetzelfde bestand | Dat is een SyntaxError: het bestand laadt niet, en alles wat ervan afhangt evenmin. De hele app start dan niet en het inlogscherm blijft verborgen. `node --check` vangt dit NIET. Controleer het apart — zie het controlelijstje in `_project.md`. Gebeurd in v5.6.0 met `pasUiStijlToe` in `js/admin.js`. |
| Een fout wegschrijven naar `console.error` op een horloge | Daar kijkt niemand ooit. Elke mislukking die de gebruiker raakt moet op het scherm komen. Dit is dit traject drie keer de oorzaak geweest van uren zoeken. |
| Testen op een computer met de muis | `watch.html` luistert uitsluitend naar aanrakingen. Zet in het ontwikkelaarsvenster de aanraakstand aan (Ctrl+Shift+M), anders reageert er niets en lijkt het scherm stuk. |

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
5. **Sierk test het toernooi uitgebreid.** Dat testen heeft tot nu toe drie
   echte fouten opgeleverd (watch-PIN, scorekaartmelding, watch-scores), geen
   ervan in de toernooicode zelf. Het toernooi is in dit traject niet
   aangeraakt, dus meldingen daarover zijn waarschijnlijk nieuw terrein.
6. **De watch bewaart onverstuurde scores in de opslag van het toestel**
   (`goyer-watch-scores-{partijId}` in localStorage). Bij het versturen wordt
   eerst gelezen wat er nú op de server staat; is dat door iemand anders
   gewijzigd, dan wordt er NIET overschreven maar een conflict getoond. Die
   keuze is bewust door de gebruiker gemaakt — een oude watch-score mag nooit
   stilletjes een nieuwere telefoon-invoer wegdrukken. Niet vereenvoudigen
   zonder dat opnieuw te bespreken.

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
