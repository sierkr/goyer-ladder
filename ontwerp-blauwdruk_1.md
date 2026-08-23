# Blauwdruk — Goyer Golf MP Ladder

Ontwerpprincipes voor (her)bouw. Geen code, alleen de regels.
Kernidee: **elke gegevensbron heeft precies één eigenaar. Niets houdt kopieën in sync.**

---

## Deel A — Toernooi = één blad

**Principe:** een toernooi is één object. Dat object is de enige waarheid. Het scherm toont het object; invoer schrijft in het object; niets anders raakt het.

**Het blad (één object):**

- naam
- status: `concept` → `actief` → `afgerond` (of `geannuleerd`)
- modus: matchplay / amerikaantje / high-low
- dagen[]: per dag → datum, baan, holes, flights[], scores{}
- spelers[]: per speler → uid, naam, hcp, gast (ja/nee)
- punten: ptWin, ptTie, ptLoss, hcpPct
- rankingLadder: welke ladder(s) dit toernooi bijwerkt

**Regels:**

1. **Nieuw toernooi** = één leeg blad aanmaken (status `concept`).
2. **Alles hoort op het blad — geen uitzonderingen.** Naam, dagen, spelers toevoegen/verwijderen, handicaps aanpassen, flights indelen, punten instellen, ranking-ladder, datum: elke handeling schrijft direct in dit ene object. Er is geen enkele actie die ergens anders leeft. Toets: *is het onderdeel van het toernooi? Dan staat het op het blad.*
3. **Het scherm leest alleen het blad.** Opnieuw tekenen = blad opnieuw lezen. Een re-render kan niets wissen, want er is geen aparte geheugen-variabele meer.
4. **Alleen de gebruiker wijzigt het blad.** Geen reset bij render, geen reset bij 'start', geen losse `_tRankingLadderIds` / `_tSpelersLadderIds` / `_flights` ernaast.
5. **Levensloop:** concept (bewerkbaar, opgeslagen → gaat niet verloren) → 'start' zet status op `actief` → bewerken past hetzelfde blad aan → 'afsluiten' zet op `afgerond`. Nooit wordt iets gewist of opnieuw opgebouwd uit een tussenlaag.

**Wat dit oplost:** verdwijnend ranking-vinkje, concept dat verloren gaat (annuleren = niet meer nodig), sync-fouten tussen scherm/geheugen/database.

**Datum = startvoorwaarde.** De datum staat per dag (`dagen[].datum`); één top-level toernooidatum bestaat niet. De datum is niet alleen een label maar een regel: **een toernooi kan niet starten vóór zijn datum.**
- Vóór de datum: blad blijft `concept`, 'start' is geblokkeerd, met melding "kan pas starten op [datum]".
- Vanaf de datum: 'start' is toegestaan.
- Bij meerdere dagen geldt de datum van de eerste dag als startvoorwaarde.

**Scores = op het blad, doorlopend bewaard.** Scores horen bij het toernooi, dus staan in `dagen[].scores` — deel van hetzelfde blad.
- Elke deelnemer schrijft zijn eigen scores continu weg (per-uid; veilig en al werkend).
- Wat ingevoerd is, staat op het blad en is daarmee bewaard — er is geen apart "nog niet opgeslagen" moment.
- Bij herladen of telefoon-uitval leest het scherm de scores gewoon terug van het blad. Niemand raakt scores kwijt.

---

## Deel B — Ladder = twee losse processen

**Principe:** de ladder heeft één opgeslagen rang per speler. Twee onafhankelijke processen schrijven daarin. Ze worden **niet** geïntegreerd.

**Proces 1 — per partij (bij elke uitslag):**

- Winnaar en verliezer verschuiven volgens de vaste config:
  - lager gerankte wint (verrassing): winnaar +4, verliezer −2
  - hoger gerankte wint (verwacht): winnaar +1, verliezer −1
  - swap-regel: verliezer naar plek winnaar als rangverschil ≤ 4
- De rest schuift in de vrijgekomen plekken. Ranks blijven 1..N.
- Eén keer, op het moment van de uitslag. Klaar.

**Proces 2 — elke maandag (wekelijkse job):**

- Inactiviteitsval: na 3 weken zonder partij → zakken (zacht: +1 plek/week, max 6).
- Frequentie-bonus: >3 partijen deze maand → +1 plek.
- Diversiteitsbonus: >6 unieke tegenstanders sinds referentiedatum → +2 plekken.
- Toegepast als **echte** rangwijziging in de opgeslagen rang. Eén keer per week. Klaar.

**Cruciale regel:** de opgeslagen rang is altijd de waarheid. Er is **geen** live-omrekening bij het tonen (`getoonde = opgeslagen + straf − bonus`). Dat was de bron van de brei: getoonde stand week af van opgeslagen stand, waardoor partij-bewegingen onnavolgbaar werden.

**Toernooi → ladder:** bij afsluiten schuift elke deelnemer omhoog met zijn toernooipunten (zelfde rang-mechaniek als proces 1). Iedere deelnemer in de uitslag telt mee.

---

## Deel C — Algemene regels tegen "de brei"

1. **Eén eigenaar per gegeven.** Geen kopieën die gesynchroniseerd moeten worden.
2. **Eén bron voor uitslagen.** Niet twee losse opslagplaatsen (was de oorzaak van reconstructie-verwarring).
3. **Schrijfacties nooit met volledige-overschrijf die velden dropt.** Altijd gericht/merge (was de oorzaak van gewist archief en gewiste ranking-ladder).
4. **Opgeslagen waarde = waarheid.** Weergave is een pure lezing, nooit een herberekening die afwijkt.
5. **Server is autoriteit voor afgeleide data** (standen). Client toont, schrijft niet blind.

---

## Wat behouden blijft (bewezen correct deze sessie)

- Standen-rekenkern (per-partij + reconstructie identiek, 60/70 exact).
- Score-opslag bij gelijktijdige invoer (per-uid docs, veilig).
- Meekijk-weergave (na de `uid`-fix).
- De volledige, exacte regelset hierboven — dit document is de blauwdruk.

## Herbouw-scope (opties)

- **Gericht:** alleen toernooi-setup herbouwen volgens Deel A + ladder-weergave volgens Deel B (modifiers naar wekelijkse job, geen live-omrekening). Rest blijft.
- **Volledig:** hele app opnieuw, met dit document als specificatie. Meer werk, maar een codebase die navolgbaar is.

Beide starten vanaf dezelfde regels. Het moeilijke deel — weten wát de app precies moet doen — is hiermee vastgelegd.
