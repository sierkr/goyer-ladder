# Bouwvolgorde — Goyer Golf MP Ladder

Geordend op afhankelijkheid, risico en waarde. Elke stap: bevestigde oorzaak/ontwerp → **"JA BOUWEN"** → syntax check → jij verifieert in test → productie. Nooit meer dan één stap tegelijk live.

---

## Fase 0 — Huidige branden doven (geen nieuwe bouw)

0.1 v3.0.8 t/m v3.1.1 in test verifiëren → naar productie pushen.
0.2 Loenen-ladderherstel draaien met het hersteltool (Productie).

*Doel: alles wat al gebouwd is landt, ladder klopt weer. Daarna schone start.*

---

## Fase 1 — Toernooi-setup herbouwen (Blauwdruk Deel A)

Vervangt de geplande pleister v3.1.2 — we lossen de wortel op i.p.v. het symptoom.

1.1 **Het blad definiëren.** Eén toernooi-object met alle velden (naam, status, modus, dagen, spelers, flights, punten, ranking-ladder, datum). Concept-opslag zodat een toernooi in opbouw niet verloren gaat.
1.2 **Setup leest/schrijft alleen het blad.** Spelers toevoegen/verwijderen, handicaps, flights, punten, ranking-ladder — elke handeling direct in het object. Losse geheugen-variabelen (`_tRankingLadderIds` e.d.) verdwijnen.
1.3 **Datum als startvoorwaarde.** 'Start' geblokkeerd vóór de datum, met melding.
1.4 **Niet-destructief annuleren + terughalen** (punt 8). Status op het blad (`geannuleerd`), met UI om terug te halen.

*Lost op: verdwijnend ranking-vinkje, sync-fouten, concept dat verloren gaat, ranking-ladder niet bewaard. Hoogste gevoelde pijn.*

**Beslispunt na Fase 1:** voelt "gericht herbouwen" voldoende, of wil je alsnog volledig opnieuw? Neem die beslissing hier — op basis van hoe de herbouwde setup aanvoelt, niet op gevoel vooraf.

---

## Fase 2 — Ladder-weergave zuiveren (Blauwdruk Deel B)

2.1 **Modifiers naar wekelijkse job.** Inactiviteit, frequentie-bonus, diversiteitsbonus als echte rangwijziging, elke maandag één keer.
2.2 **Live-omrekening verwijderen.** Getoonde rang = opgeslagen rang. Geen `getoonde = opgeslagen + straf − bonus` meer.
2.3 **Eén uitslagenbron.** De dubbele opslag (ladder-array + losse collectie) samenvoegen tot één bron.

*Lost op: onnavolgbare puntenbewegingen (punt 6), reconstructie-verwarring, "de stand klopt niet met de uitslag".*

---

## Fase 3 — Opruimen (optioneel)

3.1 Oude, eerder gewiste archief-toernooien terughalen (indien gewenst).
3.2 Overige leesbaarheids-/opschoonpunten.

---

## Alternatief — Volledige herbouw

Kies je na Fase 1 voor volledig opnieuw: dezelfde volgorde geldt, maar dan als nieuwe app met de blauwdruk als specificatie. Fase 1 en 2 zijn dan de eerste twee bouwblokken van de nieuwe app; de bewezen-correcte kern (standen-rekenregels, score-opslag) neem je één-op-één mee als spec.

---

## Wat we NIET meer doen

- Meerdere plekken voor dezelfde data die gesynchroniseerd moeten worden.
- Volledige-overschrijf writes die velden droppen.
- Weergave die afwijkt van de opgeslagen waarheid.
- Bouwen zonder bevestigde oorzaak en zonder verificatie in test.
