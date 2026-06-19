# Testomgeving — Goyer Golf MP Ladder

Vanaf v3.0.0-11.103 heeft de app een gescheiden testomgeving, in dezelfde
opzet als Rooster-test: één Firebase-project, twee Firestore-databases.

- **Productie** draait op `https://sierkr.github.io/goyer-ladder/` →
  database `(default)`.
- **Test** draait op `https://sierkr.github.io/goyer-ladder/test/` →
  named database `test`.

De app kiest de database automatisch: zodra `/test/` in het URL-pad zit,
gebruikt hij de named database `test`. De twee databases staan volledig los —
wat je in test doet (partijen, ladderaanpassingen, instellingen) raakt
productie nooit.

Auth en App Check zijn **gedeeld** (zelfde project, zelfde
`sierkr.github.io`-domein): je logt in test in met dezelfde accounts, en
reCAPTCHA blijft werken.

---

## Eenmalige opzet (in de Firebase console — dit moet jij doen)

1. **Named database `test` aanmaken**
   Firebase console → Firestore Database → bovenaan op de database-kiezer →
   **Add database**. Geef als Database ID exact `test` op (kleine letters).
   Kies dezelfde regio als je productiedatabase. Productiemodus.

2. **Rules publiceren op de `test`-database**
   Named databases hebben hun **eigen** rules; de rules van `(default)`
   gelden er niet automatisch. Publiceer dezelfde rules ook op `test`:
   - Eenvoudigst via de CLI in je projectmap:
     ```
     firebase deploy --only firestore:rules --database test
     ```
     (of voeg de `test`-database toe in `firebase.json` onder `firestore`
     met hetzelfde `rules`-bestand en deploy beide).
   - Of via de console: Firestore → kies de `test`-database → tab **Rules** →
     plak de inhoud van `firestore.rules` → Publish.

3. **De build naar de `/test/`-submap zetten**
   Kopieer de volledige build óók naar een submap `test/` in je
   `goyer-ladder` repo (dus naast `index.html` komt `test/index.html` enz.).
   Daarmee is de testomgeving bereikbaar op `…/goyer-ladder/test/`.

---

## Testdata vullen (backup → restore)

1. Open **productie** (`…/goyer-ladder/`), log in als beheerder.
2. Beheer → **Data backup** → *Backup maken*. Er wordt een JSON gedownload.
3. Open **test** (`…/goyer-ladder/test/`), log in als beheerder. Je ziet de
   oranje **TEST**-balk.
4. Beheer → **Data backup** → *Backup terugzetten…* → kies het JSON-bestand.
   Bevestig de waarschuwing (doel = TEST). De testdatabase wordt gevuld met
   een momentopname van productie.
5. Herlaad de pagina. Je kunt nu vrij testen.

Wil je later met verse data testen? Maak opnieuw een productie-backup en zet
die terug op test (dat overschrijft je testwijzigingen — meestal precies wat
je wilt).

---

## Belangrijk om te weten

- **De richting bepaalt het risico.** Backup *maken* is een leesactie en kan
  nooit een database wijzigen. Backup *terugzetten* schrijft naar de database
  van de omgeving waar je op dat moment bent — op `/test/` dus uitsluitend
  naar `test`. De enige manier om productie te overschrijven is bewust een
  restore uitvoeren terwijl je op de productie-URL bent ingelogd.
- **Gebruikersbeheer is geblokkeerd in test.** Speler/gebruiker aanmaken,
  bulk-import en wachtwoord resetten lopen via de gedeelde Auth en zouden de
  live accounts raken. In test krijg je daarom een melding en gebeurt er
  niets. Voor je testscenario's (ladder, partijen, toernooien, instellingen)
  is dat niet nodig.
- **De backup omvat:** alle ladders + standen, spelers, toernooien,
  uitslagen, snapshots en de `ladder/*`-documenten (state, users, banen,
  archief, uitdagingen, toernooi, config, invite, ladderVolgorde).
- **Herken de omgeving** aan de oranje TEST-balk en het `-TEST`-label in de
  versie. Zie je dat niet, dan zit je in productie.
