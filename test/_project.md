# Goyer Golf MP Ladder — Projectstructuur
> Dit bestand is bedoeld voor Claude. Lees dit als eerste bij een nieuwe upload.

## Versienummer — verhoog ALTIJD bij elke wijziging, ook kleine

| Bestand | Locatie | Formaat |
|---|---|---|
| `version.json` | root | `{"version": "v3.0.0-11.XX"}` |
| `sw.js` | regel 2 | `const CACHE_VERSION = 'v2XX';` |
| `js/app.js` | ~regel 221 | `const VERSION = 'v3.0.0-11.XX';` |
| `js/app.js` | ~regel 262 | `const LOKALE_VERSIE = 'v3.0.0-11.XX';` |
| `watch.html` | bij de constanten | `const WATCH_VERSIE = 'v3.0.0-11.XX';` — v5.5.2, anders herlaadt de watch-pagina zichzelf eindeloos |

Huidige versie: **v5.7.1**

### Changelog
- **v5.7.1** — High-Low kon niet gestart worden. Raakt `js/partij.js`,
  `js/ronde.js`, `js/scores.js` en `functions/index.js`. **Vraagt dezelfde
  Cloud Functions-deploy als v5.7.0** — nog niet uitgerold, dus dit gaat mee.

  - **DE FOUT.** Bij het starten werd `teams: [[a,b],[c,d]]` weggeschreven: een
    lijst met daarin twee lijsten. Firestore accepteert dat niet — een array mag
    geen array als element bevatten. Het partij-document werd geweigerd en de
    app meldde "controleer je verbinding of rechten", wat de verkeerde kant op
    wees. Dit zat er sinds v5.0.0 in en viel pas op toen High-Low in v5.6.0 voor
    iedereen open ging: daarvóór had niemand het ooit gestart.

  - **De oorzaak was duplicatie.** De teamindeling stond in het document én
    volgde al uit de spelersvolgorde (slot 1+2 tegen 3+4). Van die twee had er
    één een vorm die de database weigert. Het veld is nu weg; `teamsVan()` in
    `js/ronde.js` leidt de indeling af, en dat is de enige plek waar die regel
    staat.

  - **De server gelooft de app niet meer over de teams.** Voorheen stuurde de
    client de teamindeling mee en werd die voor waar aangenomen — een
    gemanipuleerde app kon zichzelf in het winnende team zetten. Nu leidt de
    server de teams zelf af uit het partij-document en stuurt de client alleen
    nog wie er won. Strenger dan het was, en het kwam gratis mee met het
    weghalen van het veld.

  - **De hele categorie afgedekt.** `zoekGenesteLijsten()` controleert een
    partij vóór het schrijven en weigert met een melding die het veld bij naam
    noemt. Dat vangt niet alleen `teams`, maar ook het volgende veld dat iemand
    ooit toevoegt.

  - **De foutmelding bij het starten** noemt nu de echte reden in plaats van
    altijd "verbinding of rechten".

  - **Zes nieuwe rekentests** (194 totaal): de teamindeling, en dat een lijst
    binnen een lijst wordt herkend terwijl een lijst van objecten gewoon
    doorgaat.
- **v5.7.0** — Deel 2: Amerikaantje en High-Low tellen mee voor de ladder.
  Raakt `functions/index.js`, `js/ronde.js`, `js/uitslagen.js`, `js/app.js`,
  `js/partij.js`, `index.html`, `handleiding-partij-ronde.html` en de tests.
  **Vraagt een Cloud Functions-deploy** — zie de uitrolvolgorde in
  `HANDOVER.md`.

  - **De verschuiving staat los van de ladderpositie.** Winnaar van een
    Amerikaantje +2, verliezer −2; High-Low winnaars +1, verliezers −1. Bewust
    anders dan matchplay: het zijn groepsspelvormen, geen duel tussen twee
    mensen met een ranglijstverschil. De tabel staat op de SERVER; de client
    stuurt alleen wie er eerste, tweede en derde werd, zodat een gemanipuleerde
    app geen eigen aantallen plekken kan opgeven.

  - **Geen tweede Cloud Function.** `verwerkPartijUitslag` kreeg een tweede
    invoervorm (`eindstand` naast `matchups`). Daarmee zijn de deelnemer-
    controle, het één keer verwerken, `prevRank`, de momentopname voor
    terugdraaien en het hernummeren gedeeld in plaats van nagebouwd.

  - **Alle verschuivers worden TEGELIJK geplaatst.** Eén voor één verwerken
    bleek volgorde-afhankelijk: bij een gedeelde eerste plaats kregen beide
    winnaars in de ene volgorde hun plek en in de andere volgorde niets —
    zonder melding. Nagerekend en vastgelegd in de rekentests.

  - **Aanwijsstap in beide afsluitmodals**, zoals matchplay die al had. Met een
    ingevulde kaart staat de eindstand voorgevuld; **zonder volledig ingevulde
    holes wordt er bewust NIETS voorgevuld.** Anders zou "alle drie gelijk" de
    standaard zijn en leverde één tik op bevestigen drie overwinningen op
    zonder dat er iets gespeeld was.

  - **Bestaande fout hersteld: dubbel bevestigen telde dubbel.** De server was
    al beschermd tegen dubbel verwerken, maar de client schreef daarna alsnog
    een uitslagvermelding naar het ladderdocument — goed voor een extra
    gespeelde partij en extra ontmoetingen in de activiteitsbonus. Geldt ook
    voor matchplay en is daar meteen meegenomen.

  - **Gasten tellen niet mee** voor de verschuiving en staan niet in de
    ontmoetingen; anders zou dezelfde gast elke keer als nieuwe unieke
    tegenstander de diversiteitsbonus opblazen. De verschuiving van de overige
    spelers gaat wel gewoon door.

  - **Volgorde van afronden omgedraaid:** eerst laten verwerken, pas bij succes
    de partij opruimen. Voorheen werd de partij eerst verwijderd, en dan was
    bij een mislukking zowel de partij als de uitslag weg.

  - **Uitslagenscherm** kreeg een eigen weergave. Er stond `u.matchups.map(...)`
    zonder controle; bij een uitslag zonder onderlinge partijen viel het hele
    scherm om.

  - **24 nieuwe rekentests** (188 totaal), waaronder alle vier de
    Amerikaantje-uitkomsten, dat elke rij optelt tot nul, dat de uitkomst niet
    afhangt van de verwerkingsvolgorde, de begrenzing boven- en onderaan, en
    dat er geen gaten in de ladder ontstaan.
- **v5.6.2** — Herstel van een fout uit v5.6.0 die de app volledig blokkeerde.
  Alleen `js/admin.js`, één regel.

  - **`pasUiStijlToe` werd twee keer geïmporteerd.** Hij stond er al voor de
    beheerdersknop; bij het toevoegen van de weergavekeuze kwam hij er nog een
    keer bij. Een dubbele import is een SyntaxError: `admin.js` laadt niet,
    `app.js` hangt daarvan af, en daarmee valt de hele keten om. Het gevolg is
    niet "een knop doet het niet" maar **de app start helemaal niet** — het
    inlogscherm blijft verborgen en er gebeurt niets meer.

    De browsertests lieten dit onmiddellijk zien: 10 van de 11 rood, allemaal
    op `#login-scherm` dat verborgen bleef. Dat is precies waar die testopzet
    voor bedoeld is.

  - **Waarom de controles het misten.** `node --check` keurde het bestand goed;
    die controle vangt een dubbele importbinding niet. En de import-controle die
    ik draai keek of elke geïmporteerde naam bestaat als export — niet of een
    naam twee keer wordt geïmporteerd.

    Toegevoegd aan het vaste controlelijstje, en scherper: elk bestand wordt nu
    ook echt als ES-module geparseerd, niet alleen als los script.

### Vaste controles na elke wijziging

```
node --check <bestand>          # syntax
node tests/run.cjs              # 164 rekentests
```
plus, bij wijzigingen in `js/`:
- **geen dubbele imports** binnen één bestand (SyntaxError, `node --check` vangt het niet)
- **elke geïmporteerde naam bestaat als export** in het bronbestand
- **elk bestand parseert als ES-module** (`new vm.SourceTextModule(bron)`)
- `version.json`, `watch.html` (`WATCH_VERSIE`) en `js/app.js` staan op hetzelfde nummer
- **v5.6.1** — Het scherm "Ladderwijzigingen" vertelde een ander verhaal dan het
  rekenwerk. Alleen `js/ronde.js`. **Geen deploy.**

  - **Wat er mis was.** Er werd één blok per match getekend met de verandering
    van winnaar en verliezer erin. Maar die getallen komen uit `voorRankMap` en
    `naRankMap` van de Cloud Function, en dat zijn de posities vóór en ná ALLE
    matches samen — niet het effect van die ene match.

    Bij een flight van drie leverde dat dit op: Sierk verslaat Qruun én Pieter,
    Pieter verslaat Qruun. Op het scherm stond twee keer "Sierk ↑2 (24 → 22)",
    wat leest als vier plekken. En Pieter kreeg bij allebei zijn partijen
    "— (35)", alsof winnen en verliezen niets deden.

  - **Het rekenwerk klopte wél**, en dat is nagerekend: Sierk wint twee keer als
    hogergeplaatste (+1 en +1), Qruun verliest twee keer (−1 en −1), Pieter
    verliest van Sierk en wint van Qruun (−1 en +1, dus per saldo nul). Zelfde
    eindstand als wanneer je de drie matches met de hand na elkaar uitrekent.

  - **Nu:** bovenaan één regel per speler met wat er werkelijk veranderd is,
    grootste stijger eerst, en daaronder de uitslagen zonder cijfers. Dan is
    zichtbaar dat Pieter er één won en één verloor, en waarom hij blijft staan.

  - De tussenstappen (24 → 23 → 22) worden bewust niet getoond. Ze zijn niet
    onjuist, maar het is procesinformatie; een speler wil weten wat déze partij
    met zijn positie deed.
- **v5.6.0** — Deel 1 van twee: de weergave kiest de speler zelf, en de
  spelvormen staan voor iedereen open. Raakt `index.html`, `js/config.js`,
  `js/auth.js`, `js/admin.js`, `js/app.js` en `js/partij.js`. **Geen deploy en
  geen databasewijziging.**

  - **Weergave per speler, in het Profiel-tabblad.** Drie standen: Standaard
    (volgt de club), Helder (was "matchcheck") en Klassiek (was "club"). De
    toevoeging "(huidige stijl)" is weg.

    Die eerste stand is er met opzet: zonder hem kon een speler die eenmaal koos
    nooit meer terug naar de clubinstelling, en bereikte een latere wijziging
    van de beheerder hem nooit meer.

    De keuze staat in de opslag van het apparaat, niet in Firestore. Een speler
    mag volgens de beveiligingsregels alleen zijn handicap op zijn eigen
    document wijzigen; dit in de database zetten zou een regelwijziging plus een
    deploy vragen voor iets wat in de praktijk toch per apparaat is.

  - **De clubinstelling overschrijft een eigen keuze niet meer.** Er stond een
    live-luisteraar op `ladder/config` die de stijl bij iedereen omzette zodra
    de beheerder hem wijzigde. Die zou een persoonlijke keuze midden in een
    sessie hebben teruggedraaid. Hij respecteert die keuze nu.

  - **De clubstandaard is Helder geworden.** Voor iedereen die zelf niets kiest
    — dus op dag één iedereen — verandert het uiterlijk in één keer. De
    beheerdersknop blijft, maar zet nu de standaard voor wie niets koos; de
    melding zei "actief voor iedereen" en dat klopte niet meer.

  - **Amerikaantje en High-Low voor iedereen.** De keuze stond sinds
    v3.0.0-11.97 alleen open voor beheerder en coördinator.

  - **De hinttekst is eerlijk gemaakt:** "telt nóg niet mee voor de
    ladderstand". Tot deel 2 er is, tellen deze partijen niet voor de ladder, en
    dat moet een speler kunnen zien voordat hij begint.

  Deel 2 — het ladder-effect, de aanwijsstap in de afsluitmodals en de
  handleiding — is volledig gespecificeerd en volgt apart, met een
  Cloud Functions-deploy.
- **v5.5.5** — Alleen documentatie: `HANDOVER.md` bijgewerkt. **Raakt de app
  niet aan.**

  Het bestand liep vijf punten achter, allemaal van de laatste avond:

  - het overzicht "wat er in productie draait" stopte bij v5.5.1; v5.5.2 t/m
    v5.5.4 ontbraken, en juist v5.5.4 — de fout waar de gebruiker het langst
    last van had — kwam er helemaal niet in voor
  - de versieafspraak noemde `WATCH_VERSIE` in `watch.html` niet, terwijl die
    sinds v5.5.2 mee moet veranderen
  - de fouten-tabel miste vier lessen: het REST-veldpad met accenttekens, een
    listener die moet herkoppelen als het object vervangen is, het wegschrijven
    van fouten naar een console die op een horloge niemand ziet, en het testen
    van `watch.html` met een muis in plaats van de aanraakstand
  - "drie echte fouten" klopte niet meer — het zijn er zes
  - de eerstvolgende acties waren verouderd; bovenaan staat nu het bevestigen
    van v5.5.4 op de telefoon

  Ook vastgelegd: de conflictregel van de watch (nooit stilletjes een nieuwere
  invoer overschrijven) is een bewuste keuze van de gebruiker en mag niet
  vereenvoudigd worden zonder overleg.
- **v5.5.4** — Scores kwamen wél op elk PC-scherm en op de watch, maar niet op
  de telefoon. Raakt `js/ronde.js` en `js/auth.js`.

  - **DE FOUT.** `koppelScoreListener()` besloot of hij opnieuw moest koppelen
    op basis van het partijId alleen. De listener schrijft binnenkomende scores
    echter rechtstreeks in het partij-OBJECT dat hij bij het koppelen meekreeg,
    en dat object wordt op twee plekken vervangen terwijl het partijId
    hetzelfde blijft: in `herlaadNaResume()` en in de onSnapshot op het
    ladderdocument. Beide zetten `actievePartijen` op de verse kopie uit het
    ladderdocument — met de VEROUDERDE scores-array, want de echte scores staan
    sinds v5.0.0 in de subcollectie.

    Gevolg: de listener bleef hangen aan het weggegooide object en het nieuwe
    object, dat op het scherm stond, kreeg nooit meer een score binnen.

  - **Waarom uitsluitend op de telefoon.** `herlaadNaResume()` gaat af zodra de
    app terugkomt uit de achtergrond. Op een PC-tabblad dat gewoon openstaat
    gebeurt dat nooit; op een telefoon voortdurend. De watch heeft eigen code en
    haalt de scores zelf op. Vandaar het beeld: alle PC-schermen synchroon, de
    watch synchroon, alleen de telefoon niet.

    Pijnlijk detail: het commentaar bij die resume-functie zegt dat hij is
    toegevoegd zodat scores die via de watch zijn ingevuld meteen zichtbaar
    zijn. Hij deed precies het omgekeerde.

  - **De reparatie.** De listener onthoudt nu ook op welk object hij luistert en
    koppelt opnieuw zodra dat object vervangen is. Dat dicht meteen hetzelfde
    gat bij de live-verversing van het ladderdocument. Daarnaast haalt
    `herlaadNaResume()` de scores vers uit de subcollectie voordat het scherm
    wordt getekend, zodat er geen moment is waarop een verouderde score in beeld
    staat.
- **v5.5.3** — De watch schreef nooit één score weg. Alleen `watch.html`.

  - **DE FOUT.** Het horloge praat rechtstreeks met de Firestore-API en stelde
    zelf het veldpad samen: `updateMask.fieldPaths=holes.3`. Firestore eist dat
    een pad-onderdeel dat met een cijfer begint tussen accenttekens staat:
    ``holes.`3` ``. Zonder die tekens antwoordt de server met **400 Bad
    Request** — en omdat elke hole een cijfer is, faalde **elk** verzoek vanaf
    een horloge. Er is dus nooit één watch-score in de database beland. In het
    log van de browser bevestigd, drie keer achter elkaar.

    De telefoon-app had er nooit last van: die gebruikt de
    Firebase-bibliotheek, en die plaatst de accenttekens zelf.

    Waarom dit jaren onopgemerkt bleef: de mislukking werd opgevangen en naar
    `console.error` geschreven — een logboek dat op een horloge niemand ooit
    ziet. Op het scherm bleef het cijfer gewoon staan.

  - **Zichtbare opslagstatus.** Onder de holenavigatie staat nu of alles
    bewaard is, hoeveel scores nog niet verstuurd zijn, of dat er een conflict
    is. Stil verliezen kan niet meer.

  - **Wachtrij met conflictcontrole (variant A, door de gebruiker gekozen).**
    Elke tik gaat eerst naar de opslag van het toestel zelf, pas na bevestiging
    van de server eruit. Bij het versturen wordt eerst gelezen wat er nú op de
    server staat:

    | Op de server | Wat er gebeurt |
    |---|---|
    | leeg, of nog de waarde die het horloge zag | versturen |
    | al gelijk aan wat we wilden schrijven | niets doen |
    | iets anders (iemand anders was er) | **conflict** — niet overschrijven, tonen, gebruiker kiest |

    Die laatste regel is de kern van de keuze: een oude score van het horloge
    mag nooit stilletjes een nieuwere invoer vanaf een telefoon wegdrukken. Bij
    een conflict staat er "hole 4: jij 5 · elders 6" en zet één tik alsnog de
    eigen score door.

  - **Alsnog versturen** zodra het toestel weer online of zichtbaar is, en bij
    het openen van een partij wordt een openstaande wachtrij van een vorige
    sessie opgepakt.
- **v5.5.2** — De watch-pagina ververst zichzelf. Alleen `watch.html`.

  - **Het probleem in het kort:** de reparatie van v5.5.1 werkte in een browser
    wel en op het horloge niet. Niet omdat er iets stuk was, maar omdat daar een
    oude kopie van de pagina stond. De gewone app controleert al of er een
    nieuwe versie is en herlaadt zichzelf; `watch.html` had dat nooit gekregen.
    En juist op een horloge is er geen adresbalk en geen verversknop, dus er was
    ook geen manier om het te zien of op te lossen.

  - **Nu:** de pagina haalt `version.json` op (buiten elke cache om) en
    vergelijkt dat met zijn eigen ingebakken nummer. Verschilt het, dan herlaadt
    hij zichzelf één keer met een uniek adres, zodat het toestel wel móet
    ophalen. Twee sloten tegen een herlaadlus: per sessie één poging per
    versienummer, en bij geen verbinding gebeurt er niets — dan werkt de pagina
    gewoon door, wat op de baan het belangrijkst is.

  - **Het versienummer staat nu op het PIN-scherm**, samen met de omgeving. Je
    kunt op een horloge zonder adresbalk dus zien wat er draait.

  - **LET OP bij een volgende versie:** `WATCH_VERSIE` in `watch.html` moet
    meeveranderen. Staat daar een oud nummer, dan denkt de pagina dat hij
    verouderd is en herlaadt hij bij elk bezoek. Toegevoegd aan de versietabel
    bovenin dit bestand.
- **v5.5.1** — Meldingen die vertellen wat er aan de hand is. Raakt
  `watch.html`, `js/ronde.js` en `js/uitslagen.js`. **Geen functions-deploy
  nodig** (die van v5.5.0 staat mogelijk nog wél open).

  - **De watch verzweeg elke oorzaak.** `controleerPin()` perste iedere
    mislukking samen tot "Ongeldige of verlopen PIN", terwijl de server een
    precieze reden meestuurt in `body.error.message`. Onder die ene zin gingen
    minstens vijf situaties schuil: code uit de verkeerde omgeving, verlopen
    code, al gebruikte code, een server die nog geen inlogtokens mag maken, en
    een adres dat niet bestaat. Dat kostte een avond zoeken in logboeken naar
    iets wat het apparaat gewoon had kunnen zeggen. De echte reden wordt nu
    getoond, met de HTTP-statuscode klein eronder.

  - **De omgeving staat er nu bij.** Watch-codes worden per database bewaard:
    een code die in de test-app is aangevraagd bestaat niet in productie en
    andersom. Dat verschil was nergens zichtbaar. Het PIN-scherm toont onder
    `/test/` nu "⚠ testomgeving", de foutmelding noemt waar de watch kijkt, en
    de app zet bij een code uit de testomgeving "LET OP: alleen voor de
    test-watch" in de melding.

  - **De ingetikte code blijft staan** na een fout. Voorheen werd hij gewist en
    moest je zes cijfers opnieuw intikken op een horlogescherm, terwijl de code
    meestal prima was.

  - **De app vertelt waaróm het aanvragen van een code mislukte.** "Probeer het
    opnieuw" hielp niemand als de oorzaak was dat de server geen inlogtokens mag
    maken — dan helpt opnieuw proberen juist niet.

  - **De scorekaart meldde het verkeerde.** Er was maar één tekst: "ouder dan 30
    dagen". Maar een uitslag die via het BEHEERSCHERM is bevestigd krijgt wel
    een tijdstempel en géén scorekaart-document — dat wordt alleen vanuit het
    rondescherm weggeschreven. De app zocht ernaar, vond niets, en concludeerde
    dat hij verlopen was. Hij was niet verlopen; hij heeft nooit bestaan. Nu
    worden drie situaties onderscheiden: echt ouder dan 30 dagen, nooit een
    scorekaart gemaakt, en een bewaarde kaart zonder ingevulde holes (scores
    zijn uitdrukkelijk optioneel, dus dat is een normale situatie die een
    normale uitleg verdient in plaats van een leeg raster).
- **v5.5.0** — Test en productie schreven op twee punten door elkaar heen. Plus
  drie openstaande punten afgehecht. **Vraagt een Cloud Functions-deploy**, niet
  alleen een GitHub-upload.

  - **Testen beschadigde productiedata.** `voltooiEersteLogin` en
    `resetSpelerWachtwoord` gebruikten `admin.firestore()`, en dat is altijd de
    `(default)`-database — dus productie, ook als de aanroep uit `/test/` kwam.
    De helper `fsVoor(isTest)` bestond al en werd door zestien andere functies
    gewoon gebruikt; deze twee waren overgeslagen, net als
    `getInitieelWachtwoord()`.

    Wat dat opleverde: een speler die in `/test/` het eerste-loginscherm
    invulde, kreeg `eersteLogin:false` én zijn nieuwe handicap weggeschreven
    naar de **echte** database. De testdatabase bleef op `true` staan, dus het
    scherm kwam bij elke login terug — het zichtbare symptoom. Onzichtbaar, en
    erger: zijn handicap in de live-omgeving was overschreven. En een reset
    vanuit het testbeheerscherm zette `eersteLogin:true` op het echte
    spelersdocument, waarna die speler bij zijn volgende bezoek aan de gewone
    app ongevraagd het verplichte profielscherm kreeg.

    De client stuurt nu `isTest` mee bij beide aanroepen, zoals overal elders al
    gebeurde. **Let op:** `js/auth.js` importeerde `IS_TEST` nog niet — dat is
    meegenomen, anders zou de reparatie zelf een fout opleveren op het moment
    dat een speler het scherm invulde.

  - **Browsertest voor het zelfherstel.** De wachthond uit v5.4.1 draaide al in
    productie maar was nooit in een browser beproefd. De nieuwe test haalt de
    standen weg, controleert dat de app het eerlijk meldt met een werkende knop
    en nérgens "ververs de pagina" zegt, zet de gegevens terug en controleert
    dat de ladder zichzelf vult zónder herladen. Eerlijk gezegd: dit test de
    belofte die de speler merkt, niet de binnenkant van de wachthond — die is
    van buiten de app niet aan te spreken.

  - **`firebase-functions` van `^5` naar `^6`.** De emulator waarschuwde erover.
    `index.js` gebruikt al de v2-API, dus dit is één major en laag risico. De
    nieuwste is `^7`, maar twee majors tegelijk springen midden in een testronde
    is vragen om problemen. `firebase-admin` blijft bewust op `^12`. Werkt de
    deploy niet, zet `firebase-functions` dan terug op `^5.0.0` en deploy
    opnieuw.

  - **`HANDOVER.md` herschreven** naar de werkelijke stand. Beschreef nog rode
    browsertests en een niet-goedgekeurde v5.4.1, en had een volgende sessie op
    een verkeerd spoor gezet. Bevat nu ook de bestandslijst voor het bijwerken
    van de achterlopende productiemap.
- **v5.4.9** — Alleen `tests/e2e/app.spec.cjs`. **Raakt de app niet aan.**
  v5.4.8 bracht de browsertests van 4 rood naar 1 rood; dit is die laatste.

  - **De fout zat in de test, en wiste zijn eigen spoor.** Bij het kiezen van
    een tegenstander stond er
    `page.locator('text=Bram Speler').first().click().catch(() => {})`.
    "Bram Speler" staat óók in de ladderlijst, en die pagina zit gewoon in de
    DOM — alleen zonder de klasse `active`, dus onzichtbaar. Playwright pakte
    met `.first()` die verborgen regel, wachtte tot hij klikbaar werd en liep na
    15 seconden dood. Dat mislukken werd door de `.catch(() => {})` stilletjes
    opgeslikt. Slot 2 bleef leeg, `startPartij()` ketste af op "Selecteer
    minimaal 2 spelers", en de test faalde vervolgens op een heel andere regel —
    wat het spoor uitwiste en de fout er wisselvallig deed uitzien.

    Nu wordt er gezocht binnen de zoeklijst van slot 2 zelf, en daarna hard
    gecontroleerd dat de speler ook echt gekozen is. Een stille mislukking kan
    niet meer.

  - **Wachten tot de app klaar is met opstarten.** Na het herladen werd meteen
    op de ronde-tab geklikt, waarna die getekend werd met data die er nog niet
    was. Er wordt nu eerst gewacht tot de ladderlijst gevuld is — het bewijs dat
    zowel de standen als de namen binnen zijn.

  - **Diagnose-aanroepen eruit.** De schermdumps uit v5.4.7 hebben hun werk
    gedaan. De hulpfuncties `toonSchermstatus()` en `volgConsole()` blijven in
    het bestand staan: zet er een aanroep van vlak vóór een falende assertie en
    het CI-log vertelt meteen wat er op het scherm stond. Dat scheelde bij deze
    zoektocht meerdere ronden.
- **v5.4.8** — Eén regel in `js/auth.js`, en het is een echte fout in de app —
  geen testkwestie. Dit is de oorzaak achter de vier hardnekkig rode
  browsertests.

  - **De ladderlijst heeft twee bronnen nodig:** de standen (wie staat waar) en
    de spelers (de namen en handicaps). Daar hangen twee aparte listeners aan.
    De standen-listener geeft het scherm een seintje om opnieuw te tekenen; de
    spelers-listener vulde alleen stilletjes `_usersCache` en zei niets.

  - **Zonder namen** geeft `getLadderSpelers()` een lege lijst terug en zet
    `renderLadder()` "Nog geen spelers." neer. Kwamen de namen daarna alsnog
    binnen, dan tekende niemand het scherm opnieuw en bleef die tekst staan.
    Het commentaar in `ladder-view.js` gaat er expliciet van uit dat er "opnieuw
    gerenderd wordt zodra de listener gefired heeft" — maar dat gold alleen voor
    de standen, niet voor de namen.

  - **Wanneer het toeslaat:** als de standen sneller binnen zijn dan de login.
    Het seintje van de standen komt dan langs terwijl `huidigeBruiker` nog null
    is en wordt bewust genegeerd; daarna komt het niet meer. In de emulator
    gebeurt dat altijd — alles is lokaal en instant — en dat is precies waarom
    de browsertests dit blootlegden. Bij een snelle verbinding met een herstelde
    sessie kan dezelfde volgorde een speler raken. Zelfde familie als de fout
    van v5.3.0, waar iedereen op rang 0 verscheen.

  - **De wachthond uit v5.4.1 dekt dit niet af.** Die controleert of de STANDEN
    binnen zijn, en die zijn hier gewoon binnen. Het ontbraken de namen.

  - **De reparatie:** de spelers-listener tekent nu ook de ladder opnieuw, net
    zoals de standen-listener dat al deed.

  De diagnoseregels uit v5.4.7 blijven nog één run staan, zodat in het log te
  zien is dat het klopt. Daarna gaan ze eruit.
- **v5.4.7** — Alleen `tests/e2e/app.spec.cjs`. **Raakt de app niet aan.**

  Vier browsertests blijven omvallen op `#ladder-list-mp` met "element(s) not
  found". Die melding zegt niet waarom. `renderLadder()` in `ladder.js` kent
  vier uitkomsten en elk wijst een andere kant op:

  | Wat er op het scherm staat | Wat dat betekent |
  |---|---|
  | "Laden…" | `alleLadders` nog leeg, de app probeert het opnieuw |
  | "Je bent nog niet toegevoegd aan een ladder." | `mijnLadders` leeg — `isInLadder()` zegt nee, dus de uid staat niet in `spelerIds` of `huidigeBruiker.uid` ontbreekt |
  | "Ladderstand wordt opgehaald…" | de kaart bestaat wél, maar de standen-listener levert niets |
  | rijen met namen | alles goed |

  De test drukt nu na het inloggen af welke van de vier het is, plus alles wat
  de app naar de console schreef. Eén run is daarmee genoeg om de oorzaak vast
  te stellen, in plaats van opnieuw te moeten raden.

  Reden dat dit niet in één keer kon: lokaal reproduceren lukt niet, de
  ontwikkelomgeving mag Chromium en de Firebase-emulator niet downloaden.
- **v5.4.6** — Eén regel verzet in `js/auth.js`, maar een belangrijke. Bevat
  verder alles uit v5.4.5.

  - **Wat er mis was aan v5.4.5.** De tweede poging om de banen op te halen
    stond mét `await` vóór `startAlleStandenListeners()`. `getDocFromServer()`
    wacht op de server, en juist bij slecht bereik op de baan — precies de
    situatie waarin de banenlijst leeg is — kan dat lang duren. Zolang die
    regel wachtte, startten de ladder-listeners niet en bleef de ladderstand
    leeg. Dat is dezelfde soort fout als die we net hadden gerepareerd: één
    trage stap die alles erna ophoudt.

    Nu staat het ophalen ná het starten van de listeners en zonder `await`. De
    banen komen binnen wanneer ze binnenkomen; niets anders wacht erop.

- **v5.4.5** — De banenlijst die leeg bleef, en de wisbeveiliging. Raakt
  `js/config.js`, `js/auth.js` en `js/partij.js`.

  - **De oorzaak: de app kon "er is niets" niet onderscheiden van "ik kon er
    niet bij".** Sinds v5.0.0 houdt de app een kopie van de database op het
    toestel bij, zodat scores bij slecht bereik op de baan niet verloren gaan.
    Daar zit een valkuil in: vraagt de app een document op dat niet in die kopie
    zit terwijl de server onbereikbaar is, dan komt er géén foutmelding terug
    maar het antwoord "dit document bestaat niet". De app geloofde dat en zette
    de banenlijst op leeg. Omdat de lijst maar één keer werd opgehaald, bij het
    opstarten, bleef dat zo tot de app volledig opnieuw startte — precies wat er
    in de praktijk gebeurde, en precies waarom de versiesprong van v5.4.3 het
    "oploste".

    Firestore vertelt zelf of een antwoord van de server komt of uit de eigen
    kopie (`snap.metadata.fromCache`). Daar keek de app nooit naar. De nieuwe
    functie `laadBanen()` in `config.js` doet dat wel en geeft drie mogelijke
    uitkomsten: gelukt, gelukt-maar-uit-de-eigen-kopie, of onbekend. Een lege
    lijst uit de eigen kopie wordt niet geloofd.

  - **Tweede poging na het inloggen.** `initFirestore()` draait bij een koude
    start vóórdat Firebase de sessie heeft hersteld, en wordt na het inloggen
    niet opnieuw uitgevoerd. Kwamen de banen daar niet betrouwbaar binnen, dan
    worden ze nu alsnog van de server gehaald zodra bekend is wie er is
    ingelogd.

  - **Zelfherstel in het partijformulier.** Is de lijst tóch leeg op het moment
    dat je een partij aanmaakt, dan haalt het formulier hem alsnog op en meldt
    het wat er gebeurt. Lukt het niet, dan verschijnt "↻ Opnieuw proberen" —
    bewust een knop en geen tekst als "ververs de pagina", want in de app op het
    beginscherm van een telefoon is er geen adresbalk.

  - **De wisbeveiliging (dit was de gevaarlijkste).** `slaAangepasteBaanOp()` en
    `verwijderAangepasteBaan()` deden `setDoc(BANEN_DOC, { lijst:
    aangepasteBanen })`. Dat schrijft de volledige lijst uit het geheugen van
    dat ene toestel over het document heen. Was die lijst leeg of onvolledig,
    dan wiste één klik op "opslaan" of "verwijderen" alle banen van alle
    spelers, permanent, zonder waarschuwing. Beide functies halen nu eerst de
    actuele lijst van de server, passen daar die ene baan op aan, en schrijven
    dat terug. Lukt het ophalen niet, dan wordt er niets geschreven en krijgt de
    gebruiker te horen dat er geen verbinding is. Liever niets opgeslagen dan
    andermans banen gewist.

  - **De vaste-banen-migratie draait alleen nog op een echt serverantwoord.**
    Bij een leeg of onzeker antwoord concludeerde die uit de lege lijst dat alle
    vijf vaste banen ontbraken, en overschreef het document met alleen die vijf.
    Dat kon dus vanzelf gebeuren, zonder dat iemand ergens op klikte.
- **v5.4.4** — Drie oorzaken achter de rode browsertests, waarvan er één een
  echte fout in de app bleek. **Raakt de app wél aan** (`js/auth.js`,
  `js/config.js`), maar geen enkele wijziging die een speler ziet.

  - **1. Het opstarten kon in zijn geheel omvallen op één document.**
    `initFirestore()` in `auth.js` laadde vijf documenten met `Promise.all` en
    riep daarna `laadInitieelWachtwoord()` aan — de enige stap zonder eigen
    foutopvang. Mislukte er iets, dan werd ALLES daarna overgeslagen: de
    UI-stijl, het archief, de uitdagingen, de banen én de ladders. De fout werd
    pas onderaan opgevangen met een `console.error` en verder stil weggegooid,
    en na inloggen wordt `initFirestore()` niet opnieuw gedraaid — dus het
    herstelde zich nooit binnen die sessie.

    `ladder/config` is de meest waarschijnlijke struikelaar: dat document mag
    volgens `firestore.rules` alleen een beheerder lezen. Voor elke gewone
    speler gooit die stap dus een fout. De browsertest liet het letterlijk zien:
    `Firestore init error: ladder/config ontbreekt`, gevolgd door een app zonder
    ladder.

    Nu: `Promise.allSettled`, zodat elke read op zichzelf staat, en eigen
    foutopvang rond `laadInitieelWachtwoord()`. Het wachtwoord is alleen nodig
    in het beheerscherm en wordt na het inloggen alsnog opgehaald.

  - **1b. Datalek-risico meteen dichtgezet.** Mislukte de banen-read, dan
    concludeerde `migratieVasteBanen()` uit de lege lijst dat alle vijf vaste
    banen ontbraken en overschreef het banendocument met alleen die vijf — dus
    alle zelf toegevoegde banen van iedereen weg. De migratie draait nu alleen
    nog als de read echt gelukt is. Een mislukte read is geen bewijs dat er
    niets is.

  - **2. Verkeerde projectnaam in de testopstelling.** De emulator draait onder
    `demo-goyer` en de testdata gaat daarheen, maar de app vroeg altijd naar
    `goyer-golf-mp-ladder`. Inloggen lukte wel (de inlog-emulator bedient maar
    één project en let niet op de naam), de database was leeg. Op localhost
    gebruikt de app nu `demo-goyer`. De `demo-`naam blijft bewust staan: dat is
    de grendel waardoor een test nooit bij de echte Firebase-diensten kan. Op
    `sierkr.github.io` is `IS_EMULATOR` altijd onwaar, dus in productie
    verandert er niets.

  - **3. De beheertest logde niet uit.** Hij wiste `localStorage`, maar de
    inlogsessie staat bewust in IndexedDB (`setPersistence`, zodat de PWA op een
    telefoon ingelogd blijft). Anna bleef dus ingelogd, het inlogscherm kwam
    nooit en de test wachtte zich dood — vandaar die 32 seconden. Nu twee
    gescheiden browsersessies, wat meteen eerlijker is: het test echt twee
    verschillende gebruikers.

  - **Nieuwe regressietest.** `ontbrekende ladder/config sloopt ladder en banen
    niet` verwijdert dat document, controleert dat de ladder én het banenmenu
    gewoon gevuld zijn, en zet het daarna terug. Punt 1 kan hierdoor niet
    ongemerkt terugkeren.

  - **Nog open:** de banenlijst die leeg kan blijven doordat de app geen
    verschil ziet tussen "er zijn geen banen" en "ik kon de server niet
    bereiken" — bij een lege eigen kopie geeft Firestore geen fout maar
    "bestaat niet". Plus de wisbeveiliging bij handmatig opslaan/verwijderen
    van een baan. Beide staan gepland voor v5.4.5.
- **v5.4.3** — Alleen testbestanden. **Raakt de app niet aan**: geen deploy
  nodig, niets wat een speler kan merken. Twee rode CI-jobs opgelost, en in
  beide gevallen lag de fout in de test, niet in de app.

  - **Cloud Functions-job: "verliezer Anna is gezakt — kreeg 3, verwacht 2".**
    De test verwachtte dat Anna van plek 1 naar plek 2 zou zakken. Met
    `laagZak: 2` zakt de verliezer echter twee plekken: 1 + 2 = 3, waarna Cees
    opschuift naar 2. De Cloud Function deed dit dus goed, en het klopt met de
    164 groene rekentests (`tests/partij.test.cjs`, "verliezer zakt laagZak").
    De verwachting is gecorrigeerd naar 3 en er is een tweede controle
    bijgekomen die vastlegt dat Cees naar 2 gaat — anders zou een fout in het
    opschuiven van de tussenliggende spelers onopgemerkt blijven.

  - **Browser-job: 7 van de 8 tests vielen om op één regel.** De inlogstap
    klikte op `button:has-text("Inloggen")` binnen `#login-scherm`. Daar staan
    twee knoppen met dat woord erin: "Inloggen met Google" (verborgen) en
    "Inloggen →". Playwright werkt in strict mode en weigert dan te klikken
    ("resolved to 2 elements"), dus viel elke test die inlogt om nog vóórdat er
    iets getest werd. Alleen de watch-PIN-test logt niet in en die kwam door —
    dat verklaart precies "1 passed" en zeven rood. Er wordt nu geklikt op
    `#login-scherm button.btn-primary`, dat exact één keer voorkomt.

    Dezelfde soort fout zat een tweede keer in het bestand:
    `page.locator('#page-ronde, #page-ladder')` past ook op twee elementen.
    Daar staat nu `.first()` achter.

  - **Verwachting voor de volgende run.** Dit haalt de blokkade weg; het maakt
    de acht tests niet in één keer groen. Ze draaien nu voor het eerst écht
    tegen de app, en de selectors zijn destijds uit de broncode afgeleid en
    nooit in een draaiende browser gecontroleerd. Reken op nieuwe fouten en
    werk ze per foutmelding af.

  - **Nog open (niet in deze versie):** de banenlijst die leeg blijft bij het
    aanmaken van een nieuwe partij. Analyse staat klaar: `initFirestore()` in
    `auth.js` breekt af bij `laadInitieelWachtwoord()` — de enige stap zonder
    eigen foutopvang — waardoor alles erna wordt overgeslagen, inclusief de
    banen. Daarnaast schrijven `slaAangepasteBaanOp()` en
    `verwijderAangepasteBaan()` de volledige lijst uit het geheugen over het
    document heen, zodat één klik met een lege lijst alle banen voor alle
    spelers kan wissen. Dat laatste is de gevaarlijkste openstaande post.
- **v5.4.2** — Alleen `playwright.config.cjs`. **Raakt de app niet aan**: geen
  deploy, geen wijziging die een speler kan merken. Uitsluitend nodig om de
  browsertests op GitHub te laten starten.

  - **De fout.** Playwright staat geïnstalleerd in `tests/node_modules`, maar
    `playwright.config.cjs` staat in de hoofdmap. Node zoekt onderdelen altijd
    vanaf de map van het bestand zelf en loopt daarbij naar bóven, nooit een
    submap in — dus vanuit de hoofdmap werd `tests/node_modules` nooit
    bekeken. Resultaat op GitHub: `Cannot find module '@playwright/test'`,
    afkomstig uit regel 8 van de configuratie. Playwright stierf op zijn eigen
    instellingenbestand, vóór de eerste test. Dat verklaarde waarom er geen
    enkele testnaam in het log stond en de stap maar 17 seconden duurde.
    Het seeden van de testdata was wél gelukt (het log toont de vijf
    aangemaakte spelers).

  - **De oplossing.** De configuratie vraagt niets meer op. `defineConfig()`
    en `devices[]` zijn gemaksfuncties zonder eigen werking; een gewoon
    `module.exports = { ... }` doet exact hetzelfde. Nul afhankelijkheden,
    dus niets meer te vinden.

  - **Tweede struikelblok meteen weggenomen.** `devices['Desktop Chrome']`
    vraagt in nieuwere Playwright-versies om de échte Google Chrome, terwijl
    de workflow alleen Chromium installeert. Dat was na de eerste fix direct
    de volgende geweest. Nu staat er rechtstreeks
    `browserName: 'chromium'` met een vast venster van 1280×900.

- **v5.4.1** — De app herstelt zichzelf in plaats van om een verversing te
  vragen. Alleen app-bestanden; geen deploy nodig.

  - **Wat er mis was met de melding.** v5.3.1 toonde "Ladderstand wordt
    geladen… Blijft dit staan? Ververs de pagina." Maar de app draait bij de
    meeste spelers als pictogram op het beginscherm van hun telefoon, en daar
    is geen adresbalk en geen verversknop. De instructie was dus onuitvoerbaar
    voor precies de groep die hem het vaakst te zien krijgt.

  - **Wachthond op de standen.** Na het inloggen controleert de app of de
    ladderstanden ook daadwerkelijk binnenkomen. Zo niet, dan herstart hij de
    listeners zelf — vijf keer, met oplopende tussenpozen (3, 6, 9, 12 en 15
    seconden) en telkens gevolgd door een hertekening. In verreweg de meeste
    gevallen merkt de speler er niets van.

  - **Werkende knop in plaats van een instructie.** Lukt het daarna nog niet,
    dan staat er "↻ Opnieuw proberen". Die herstart de verbinding en tekent de
    ladder opnieuw, zónder de pagina te herladen — dus ook bruikbaar in de app
    op het beginscherm. De tekst is nu "Ladderstand wordt opgehaald… Dit gaat
    meestal vanzelf."

  - **Zelfde behandeling bij een mislukte start.** Kwam de app helemaal niet
    door de opstartfase, dan stond er ook "ververs de pagina". Nu verschijnt
    er een knop die het opnieuw probeert.

  - **Melding na een backupherstel** vroeg eveneens om herladen; die haalt de
    nieuwe gegevens nu vanzelf op.

  - **Extra browsertest** die controleert dat de tekst "ververs de pagina"
    nergens meer in de app voorkomt.

- **v5.4.0** — Volledige testopzet in vier lagen, plus twee bevindingen die
  daarbij aan het licht kwamen. Geen deploy van Cloud Functions of rules nodig;
  wel nieuwe bestanden die mee moeten naar GitHub.

  - **Laag 1 — rekenkern (bestond al).** 164 tests, `node tests/run.cjs`,
    twee seconden. Draait zonder enige installatie.

  - **Laag 2 — Firestore-regels.** `tests/emulator/rules.test.cjs`, ruim 50
    controles tegen de emulator. Van elke regel wordt beide kanten getoetst:
    wie het wél mag en wie niet. Dekt onder meer dat `watchPins` voor niemand
    leesbaar is, dat `config` alleen voor de beheerder is, dat een speler zijn
    eigen rang niet kan wijzigen maar zijn handicap wel, en dat `punten` en
    `verwerkt` voor geen enkele client schrijfbaar zijn.

  - **Laag 3 — Cloud Functions.** `tests/emulator/functions.test.cjs`, ruim 50
    controles tegen een echte Firestore. Onder meer: een partij afsluiten
    zónder scores lukt (de uitdrukkelijke eis), een winnaar die de ingevulde
    scores tegenspreekt wordt geweigerd, een tweede aanroep telt niet dubbel,
    een tweede activiteitsrun verschuift niets meer, snapshots bevatten de
    punten en herstellen ze ook, de backup is compleet, en een PIN werkt maar
    één keer.

  - **Laag 4 — browsertests.** `tests/e2e/app.spec.cjs` met Playwright, een
    echte browser tegen de emulator. De eerste test is letterlijk de fout van
    v5.3.0: een speler die voor het eerst inlogt moet de echte ladderstand
    zien, niet iedereen op rang 0. Verder: twee spelers die tegelijk scoren
    zonder elkaar te overschrijven, scores die een herlaad overleven, en de
    controle dat er geen enkele JavaScript-fout in de console verschijnt.

  - **GitHub Actions.** `.github/workflows/tests.yml` draait alle vier de
    lagen bij elke push. Je ziet een groen vinkje of rood kruis bij je commit
    en krijgt een mail als er iets stuk is. Je hoeft lokaal niets te
    installeren.

  - **Gevonden tijdens het schrijven van de tests:**
    - `toggleScorecard()` in `js/ronde.js` verwees naar `#scorecard-wrap`, een
      element dat nergens in index.html bestaat. De functie stond op `window`
      en zou bij aanroep meteen een TypeError geven. Nu wijst hij naar de
      echte scorekaart en is hij null-veilig.
    - `js/config.js` verbindt met de emulator als de app op localhost draait,
      en slaat App Check dan over (reCAPTCHA kan daar geen token ophalen).
      Beide uitsluitend op `localhost`/`127.0.0.1` — in productie en test
      wordt de app altijd vanaf sierkr.github.io geserveerd, dus die
      voorwaarde is daar nooit waar.

  - **Eerlijk over de status:** de rekentests zijn hier gedraaid en groen. De
    lagen 2, 3 en 4 zijn geschreven maar niet uitgevoerd — de omgeving waarin
    ze gebouwd zijn kan de emulator en de Playwright-browsers niet downloaden.
    De eerste keer dat GitHub ze draait zullen er waarschijnlijk nog een of
    twee correcties nodig zijn. Dat gebeurt in GitHub, niet in productie:
    rood betekent dat er niets is geüpload en dat geen speler er iets van
    merkt.

- **v5.3.1** — Lege ladder bij eerste login. Alleen app-bestanden; geen deploy
  van Cloud Functions of rules nodig. **Er is geen data verloren gegaan** — de
  standen stonden gewoon in Firestore en waren voor andere gebruikers normaal
  zichtbaar.

  - **Wat er gebeurde.** Een speler die voor het eerst inlogde zag alle 70
    spelers op rang 0, alfabetisch gesorteerd, met 0P · 0W · 0%.

  - **De oorzaak.** `startAlleStandenListeners()` werd uitsluitend aangeroepen
    vanuit `onAuthStateChanged`. Die handler kan vuren VOORDAT
    `getDocs(LADDERS_COL)` in `initFirestore()` klaar is. Loopt hij dan over
    een nog lege `alleLadders`, dan wordt er geen enkele standen-listener
    gestart — en er was geen tweede poging. De standen-cache bleef daardoor
    de hele sessie leeg, `getLadderSpelers()` gaf voor iedereen rang 0 terug
    en de lijst viel terug op de volgorde van `spelerIds`.
    Bij een eerste login is die volgorde het waarschijnlijkst omgedraaid,
    doordat de verplichte profielflow (handicap + wachtwoord kiezen) de timing
    verschuift. De persistente Firestore-cache uit v5.0.0 maakt het
    IndexedDB-opstarten bovendien iets trager, wat de race waarschijnlijker
    maakt dan voorheen.

  - **De reparatie.**
    - `startAlleStandenListeners()` wordt nu óók aangeroepen zodra de ladders
      geladen zijn in `initFirestore()`. `startStandenListener()` is
      idempotent, dus beide volgordes zijn nu gedekt.
    - Een listener die met een fout stopt ruimt zichzelf op en probeert het na
      vier seconden opnieuw, in plaats van stilzwijgend een lege cache achter
      te laten.
    - De ladder toont "Ladderstand wordt geladen…" zolang de standen niet
      binnen zijn, in plaats van een lijst met rang 0 die er echt uitziet maar
      nergens op slaat. Hetzelfde geldt voor "deel als afbeelding": die
      weigert nu een stand te exporteren die nog niet geladen is.

  - **Waarom de tests dit niet vingen:** dit zit in de opstartvolgorde van
    listeners en de renderlaag, niet in de rekenkern. De suite dekt berekening,
    geen browser- en Firestore-timing. Dat blijft zo tot er een testopzet met
    een draaiende emulator komt.

- **v5.3.0** — Toernooi en knockout doorgelicht met een nieuwe, permanente
  testsuite. Vijf bevindingen in de toernooimodule, waarvan twee die een
  toernooi daadwerkelijk kunnen laten mislukken. Knockout bleek schoon.
  Alleen app-bestanden gewijzigd; **geen deploy van Cloud Functions of rules
  nodig.**

  - **T1. Handicapslagen weken af van wat op het scherm stond.**
    `berekenTPuntenVoorDag()` had een eigen slagberekening (`hole.si <= diff`)
    die maximaal EEN slag per hole gaf. Het handicapoverzicht gebruikt
    `getTHcpSlagen()`, die bij een verschil van meer dan 18 slagen wel een
    tweede slag toekent op de laagste stroke-indexen. Bij grote
    handicapverschillen kwam de uitgerekende uitslag dus niet overeen met de
    slagen die de spelers voor zich zagen. Er is nu nog één implementatie.
    Tevens is de vaste 18 in `getTHcpSlagen()` een parameter geworden: bij een
    9-holes dag rekende de toernooimodule anders dan de ladder, die altijd het
    werkelijke aantal holes gebruikt.

  - **T2. Scores van een niet-afgesloten dag konden verdwijnen.** `live/{uid}`
    bevatte precies één dag (`{ dagNr, scores }`) en werd bij elke
    schrijfactie volledig overschreven. Zodra dag 2 begon, verdween de
    live-invoer van dag 1 voor die speler. Was dag 1 nog niet afgesloten, dan
    bestonden die scores alleen nog in het geheugen van het apparaat van de
    coördinator. Het document bewaart de scores nu per dag onder `dagen`, met
    `merge: true`; het oude formaat blijft leesbaar. Ook `toernooi-live.html`
    aangepast.

  - **T3. Live-scores verouderden bij het terugkijken van een afgesloten dag.**
    De listener stopte volledig zodra de bekeken dag was afgerond, waardoor
    `_liveScores` niet meer werd bijgewerkt — terwijl `heeftGeenScores()`
    daarop vertrouwt om "terug naar setup" te blokkeren tijdens een lopende
    speeldag (de situatie die fix 7.3 moest afdekken). `_liveScores` wordt nu
    altijd bijgewerkt.

  - **T4. Nieuwe dag toevoegen waarschuwt nu.** `voegDagToe()` controleerde
    niet of de vorige dag was afgesloten. In combinatie met T2 was dat de
    directe route naar verloren scores. Doorgaan mag, maar met een expliciete
    bevestiging.

  - **T5. Countback werkte niet in de totaalstand.**
    `berekenStrokeplayTotaal()` gaf `holeScores: []` terug, waardoor
    `countback()` altijd 0 opleverde. Een gedeelde eerste plaats in het
    eindklassement werd dus nooit beslist. De holescores van alle dagen gaan
    nu mee.

  - **Nieuwe testsuite: `tests/`, te draaien met `node tests/run.cjs`.**
    164 tests over vijf suites: puntensysteem en matchstand (24),
    activiteitssysteem (19), partijverwerking (22), toernooi (67) en
    knockout (32). Het harnas (`tests/harnas.cjs`) knipt de functies
    rechtstreeks uit `js/toernooi.js`, `js/knockout.js` en
    `functions/index.js` — er wordt dus geen namaakversie getest maar de
    echte code. Wordt een functie hernoemd of verwijderd, dan valt de suite
    om met een duidelijke melding.
    Gedekt: handicapslagen (incl. >18 en 9 holes), matchplaypunten, matrix en
    marges, meerdaagse totalen, strokeplay brutto/netto/stableford, countback,
    dagselectie, scorestatus, flighttijden, live-scores per dag, en voor
    knockout de volledige bracketopbouw, byes bij oneven aantallen, het
    bewaren en wissen van uitslagen en het opslagformaat.

  - **Wat de tests niet dekken:** alles wat het scherm of Firestore raakt —
    renderfuncties, listeners en de schrijfacties zelf. Dat vraagt een
    draaiende browser en database.

- **v5.2.1** — Vijf punten uit een code-audit op v5.2.0. Vier daarvan gaan over
  beheerhandelingen die `standen` wel bijwerkten maar niet de collecties die er
  sinds v4.2.0 bij horen. **Nieuwe deploy van de Cloud Functions vereist**
  (vier functies erbij, achttien in totaal). Rules ongewijzigd.

  - **1. Automatische snapshots bevatten nu ook punten.** v5.2.0 zette alleen
    de handmatige knop en het herstel om naar de server. `slaSnapshotOp` —
    die na élke bevestigde partij en na elk toernooi draait en dus verreweg de
    meeste snapshots maakt — bleef de client-versie gebruiken en legde alleen
    `standen` vast. Precies de half-consistente toestand die v5.2.0 moest
    voorkomen. Loopt nu via `maakLadderSnapshot`, met terugval op de oude
    client-versie als de server onbereikbaar is; die terugval schrijft
    `bevatPunten: false` en zet "(zonder punten)" in het label.

  - **2. Toernooi-uitslag werkt de punten bij.** `js/toernooi.js` schreef
    rechtstreeks nieuwe rangen naar `standen` maar raakte `punten` niet aan.
    De ladderpositie klopte daarna wel (die komt uit `standen`), maar
    `punten.score` liep achter — en `pasPuntenAan` sorteert daarop, dus een
    handmatige puntenaanpassing na een toernooi kon de ladder verkeerd
    herschikken. Nieuwe function `verwerkToernooiStanden` schrijft beide samen
    weg. `activiteitVerschuiving` blijft daarbij ongemoeid: een toernooi is een
    sportieve verschuiving, geen activiteitscorrectie.

  - **3. Nieuw seizoen ruimt het vorige seizoen op.** `nieuwSeizoen` resette
    alleen `standen`; `punten`, `partijen` (incl. scores), `verwerkt` en
    `teruggedraaid` bleven staan. Het vervelendst was dat
    `activiteitVerschuiving` de reset overleefde: de posities begonnen
    opnieuw, maar het systeem dacht nog dat er al correcties waren toegepast,
    waardoor de eerste periodieke run van het nieuwe seizoen met een verkeerd
    verschil rekende. Nieuwe function `resetLadderSeizoen`.

  - **4. Ladder verwijderen ruimt de subcollecties op.** `verwijderLadder`
    wiste alleen het ladderdocument; Firestore verwijdert subcollecties niet
    mee. Nieuwe function `verwijderLadderVolledig`, met terugval op het oude
    gedrag als die niet bereikbaar is.

  - **5. Bulk import: geen accounts zonder profiel meer.** Mislukte het
    schrijven van `spelers/{uid}` nadat het Auth-account was aangemaakt, dan
    bleef dat account bestaan met alleen een consoleregel "handmatig
    verwijderen" — iemand kon dan inloggen zonder profiel. Nieuwe function
    `verwijderWeesAccount` ruimt het op; die weigert bewust als er wél een
    profiel bestaat. Daarnaast werd de volledige spelerslijst per speler
    opnieuw opgehaald (vijftig imports = vijftig leesacties); dat gebeurt nu
    één keer vooraf, met een lokale lijst die meegroeit zodat een dubbele naam
    binnen dezelfde import ook wordt opgemerkt.
    De pauze van twee seconden per speler is bewust ongewijzigd gelaten — die
    voorkomt rate limiting bij Firebase Auth en dat is niet te testen zonder
    echte accounts aan te maken.

  - **Niet opgelost, bewust:** de bulk-import blijft uitgeschakeld in de
    testomgeving (`_blokkeerInTest`), omdat hij echte Auth-accounts maakt en
    die tussen test en productie gedeeld zijn.

- **v5.2.0** — Vangnet gerepareerd. Snapshots en backup waren blijven staan op
  het datamodel van v3 en misten alles wat er sinds v4.2.0 bij is gekomen.

  - **Wat er ontbrak.** De snapshot bewaarde alleen `standen`; de backup
    alleen ladders/spelers/toernooien/uitslagen/snapshots plus de
    ladder-documenten. Niet meegenomen werden:
    - `punten` — score en `activiteitVerschuiving`. Na een herstel klopten de
      posities wel, maar dacht het systeem nog dat de activiteitscorrectie al
      was toegepast; de eerstvolgende periodieke run rekende dan met een
      verkeerd verschil.
    - `partijen` + `scores` — een lopende ronde overleefde een herstel niet.
    - `verwerkt` — de stempels tegen dubbel verwerken verdwenen, waardoor een
      al afgesloten partij nogmaals kon meetellen.
    - `teruggedraaid` — archief van teruggedraaide uitslagen.

  - **Vier nieuwe Cloud Functions.** Nodig omdat `punten` en `verwerkt` in
    firestore.rules afgeschermd zijn: alleen leesbaar voor het
    puntenBeheerder-account respectievelijk niet schrijfbaar door welke client
    dan ook. Een snapshot of backup vanuit de browser kan die dus niet
    meenemen. Alle vier alleen voor coordinator/beheerder:
    `maakLadderSnapshot`, `herstelLadderSnapshot`, `exporteerBackupExtra`,
    `importeerBackupExtra`.

  - **Knop "📸 Snapshot maken"** in het Beheer-scherm, met een eigen
    omschrijving. Tot nu toe werden snapshots alleen automatisch gemaakt (na
    een partij, na een toernooi, vóór een herstel) — er was geen manier om er
    zelf een te maken vlak voordat je iets ingrijpends deed.

  - **Herstellen zet nu standen én punten terug**, en legt eerst automatisch
    de huidige staat vast. De score wordt daarbij opnieuw afgeleid uit de
    herstelde positie, zodat score en rank per definitie bij elkaar horen.

  - **Backup uitgebreid** met dezelfde vier collecties. Mislukt het ophalen
    van de afgeschermde delen, dan stopt de backup met een foutmelding in
    plaats van stilletjes een onvolledig bestand te downloaden — een backup
    waarvan je denkt dat hij compleet is, is gevaarlijker dan geen backup.
    Het bestand draagt nu `_meta.formaat: 'v5.2.0'`.

  - **Oude snapshots en backups blijven bruikbaar.** Die bevatten geen punten;
    dan worden alleen de posities hersteld, met een waarschuwing vooraf zodat
    duidelijk is wat je krijgt.

- **v5.1.2** — Watch vond nooit een partij. Alleen `watch.html` gewijzigd;
  geen nieuwe deploy van de Cloud Functions of rules nodig.

  - **De fout.** `inloggenMetCustomToken()` deed `uid = data.localId`, maar het
    antwoord van `accounts:signInWithCustomToken` bevat dat veld niet — dat
    geeft alleen `idToken`, `refreshToken` en `expiresIn` terug. (`localId`
    komt wél terug bij `signInWithPassword`, wat de verwarring verklaart: de
    oude watch-login gebruikte een andere endpoint.) `uid` bleef dus leeg, en
    omdat de partij wordt gezocht met `p.spelers.some(s => s.uid === uid)`
    matchte er nooit iets. Resultaat: je was correct ingelogd, het scorescherm
    verscheen, maar er stond altijd "Je hebt geen actieve partij" — ook in een
    verse incognitosessie met een nieuwe PIN. Geïntroduceerd in v5.0.0 bij het
    omzetten naar custom tokens.

  - **De oplossing.** De uid komt nu uit het antwoord van `wisselWatchPin`,
    die precies weet bij welke speler de PIN hoorde. Nieuwe hulpfunctie
    `uidUitToken()` leest hem anders alsnog uit het idToken (JWT-payload,
    veld `user_id` of `sub`). Lukt geen van beide, dan mislukt de login met
    een duidelijke melding in plaats van stil door te gaan met een lege uid.
    Getest met 7 controles op `uidUitToken()`, inclusief lege en misvormde
    tokens.

- **v5.1.1** — Drie punten, gevonden tijdens het testen van v5.1.0.

  - **Watch las de verkeerde database.** `watch.html` had de productiedatabase
    hardgecodeerd (`databases/(default)`), ook als hij onder `/test/` draaide.
    Auth is gedeeld tussen test en productie, dus inloggen lukte wél — maar de
    partij stond in de named database `test` en werd nooit gevonden
    ("Je hebt geen actieve partij"). Zat al in eerdere versies; viel niet op
    omdat de watch nooit in test was gebruikt. Nu kiest hij de database op
    dezelfde manier als de app: `test` onder `/test/`, anders `(default)`.

  - **Een mislukte watch-login kostte je je PIN.** `wisselWatchPin` schreef de
    PIN af in de transactie en maakte pas daarna het inlogtoken. Ging dat mis,
    dan was de PIN weg zonder dat de gebruiker iets had. Dat gebeurde ook
    daadwerkelijk: het serviceaccount miste `iam.serviceAccounts.signBlob`.
    Nu wordt eerst het token gemaakt en pas daarna de PIN verbruikt. Mislukt
    het token, dan blijft de PIN gewoon geldig. De foutmelding noemt bovendien
    expliciet de ontbrekende IAM-rol, zodat die niet meer uit de logs hoeft te
    worden opgediept.
    **Eenmalige handmatige stap (Google Cloud IAM):** geef
    `<projectnummer>-compute@developer.gserviceaccount.com` de rol
    **Service Account Token Creator**. Zonder die rol kan geen enkele
    watch-login een token krijgen.

  - **Runtime naar Node.js 22.** Node 20 is per 2026-04-30 afgeschreven en
    wordt op 2026-10-30 uitgezet; daarna kun je niet meer deployen. Alleen
    `functions/package.json` gewijzigd (`engines.node`). Geen codewijziging
    nodig — `firebase-admin` 12 en `firebase-functions` 5 ondersteunen Node 22.

- **v5.1.0** — Activiteitssysteem losgekoppeld van de partijverwerking.
  Aanleiding: een verliezer steeg 5 plekken op de ladder.

  - **De fout.** Bij elke partij werd de activiteitscorrectie opnieuw op de
    score toegepast, terwijl de score waaruit die werd afgeleid
    (`standen/{uid}.rank`, de publieke positie) die correctie al bevatte. De
    correctie stapelde daardoor op: een actieve speler steeg elke partij een
    paar plekken extra — ook als hij verloor — en een inactieve speler zakte
    weg bij élke partij in de ladder, ook bij partijen waar hij niet aan
    meedeed. In een simulatie met 50 spelers steeg de verliezer 6 plekken per
    partij, zes partijen achter elkaar, zonder te stoppen.
    Bewijs dat het een fout was en geen ontwerp: `herbereikenActiviteitDagelijks`
    rekende wél met de opgeslagen `basisScore`, `verwerkPartijUitslag` niet.
    Die twee werkten elkaar dus tegen. Zat al in v4.2.0.

  - **Nieuwe opzet.** `verwerkPartijUitslag` past uitsluitend de
    win/verlies-regels toe op de huidige volgorde. Geen activiteit, in geen
    enkele vorm. Een verliezer zakt, altijd.

  - **`verwerkActiviteitPeriodiek`** (nieuw, vervangt
    `herbereikenActiviteitDagelijks`) draait maandagochtend 04:00. Per ladder
    instelbaar via `activiteitPeriode`: `'maand'` (standaard, eerste maandag
    van de maand) of `'week'` (elke maandag).

  - **Geen opstapeling meer.** Nieuw veld `punten/{uid}.activiteitVerschuiving`
    houdt bij hoeveel PLEKKEN de correctie al heeft toegepast. Elke run wordt
    het DOEL berekend volgens de ladderinstellingen en alleen het VERSCHIL
    doorgevoerd. Daardoor blijven alle bestaande instellingen exact werken,
    inclusief de maxima van 6 (zacht) en 14 (middel): een stilzitter zakt tot
    zijn maximum en niet verder, en klimt bij terugkeer in één keer terug.
    Bij `'fors'` is het doel "onderaan", uitgedrukt als het aantal plekken tot
    de laatste plaats — zo klimt de speler bij terugkeer exact even ver terug.

  - **`verwerkActiviteitNu`** (nieuw, callable): coördinator/beheerder kan de
    verwerking meteen draaien via de knop "⏱ Activiteit nu verwerken" in de
    ladderinstellingen, zonder tot maandag te wachten.

  - **Diversiteitsbonus telt nu per maand** in plaats van sinds de
    referentiedatum, zodat hij hetzelfde tijdvak meet als de frequentiebonus.
    Server-side en in `bepaalActiviteitsIconen()` (`js/ladder.js`).

  - **Regressie die hierbij aan het licht kwam en is verholpen:** de verliezer
    kon op positie N+1 belanden in een ladder van N spelers (`svRank + zak`
    werd niet begrensd). Dat viel niet op zolang er daarna toch op score werd
    hersorteerd en hernummerd. Nu een partij alleen nog posities verschuift,
    zou daar een spookplek ontstaan. Nieuwe positie wordt begrensd op 1..N,
    met een botsingscontrole zodat de winnaar nooit onder de verliezer eindigt.

  - **`activiteitDelta` in `punten/{uid}` vervalt** ten gunste van
    `activiteitVerschuiving`. `pasPuntenAan` zet die op 0: een handmatige
    aanpassing is een bewuste keuze van de beheerder, geen gevolg van
    (in)activiteit.

  - Getest: 22 controles op de partijverwerking (inclusief randgevallen als
    een ladder van 2 spelers en een ingestelde stijging van 0) en 19 op de
    activiteitslogica. **Deploy vereist**: `firebase deploy --only functions`
    — de dagelijkse scheduled function verdwijnt en er komen twee functies bij.
    De rules zijn ongewijzigd.

- **v5.0.1** — Deploy-configuratie toegevoegd. De zip bevatte geen
  `firebase.json` en geen `.firebaserc`, waardoor `firebase deploy` niet wist
  wat er gedeployd moest worden. Nieuw:
  - `firebase.json` — koppelt `firestore.rules` aan **beide** databases
    (`(default)` en `test`; een named database heeft eigen regels) en wijst
    `functions/` aan als functiesmap.
  - `.firebaserc` — legt vast dat het om project `goyer-golf-mp-ladder` gaat,
    zodat de CLI daar niet meer naar vraagt.
  - `functions/.gitignore` — houdt `node_modules/` uit de repo.
  - `DEPLOYEN.md` — stap-voor-stap commando's, inclusief de volgorde
    (secret zetten vóór de eerste deploy, anders mislukt die) en de twee
    handmatige stappen die alleen in de Firebase console kunnen.
  Geen functionele wijzigingen aan de app zelf.

- **v5.0.0** — Beveiligings- en datamodelherziening naar aanleiding van een
  code-review. Zeven punten; de eerste vier waren echte fouten, de rest is
  opruimen. **Let op: `firestore.rules` moet handmatig worden gepubliceerd en
  de Cloud Functions moeten opnieuw worden gedeployed.**

  - **1. Watch-PIN lekte alle accounts (kritiek).** `ladder/watchPins` stond op
    `allow read: if true` en bevatte per PIN een Firebase *refreshToken* —
    een permanente sleutel waarmee je onbeperkt nieuwe inlogtokens maakt. Het
    project-ID staat in de broncode, dus iedereen kon dat document met één
    ongeauthenticeerde request ophalen en inloggen als élke speler die ooit het
    rondescherm had geopend, beheerder inbegrepen. De PIN was geen drempel: de
    tokens waren direct leesbaar.
    Nu: `maakWatchPin` (server-side, 6 cijfers, alleen een SHA-256 hash
    opgeslagen, 15 minuten geldig, eenmalig) en `wisselWatchPin` (ruilt de PIN
    om voor een custom token, met foutteller tegen brute force). Het horloge
    regelt daarmee zijn eigen sessie; er staan geen tokens meer in Firestore.
    `watchPins` is volledig dichtgezet. De PIN wordt niet meer automatisch
    aangemaakt maar op verzoek, via de gele badge in de Ronde-tab.

  - **2. Uitslag werd niet gecontroleerd.** `verwerkPartijUitslag` checkte
    alleen "zit je in deze ladder" en geloofde verder klakkeloos welke winnaar
    de client meestuurde — geen partij, geen deelnemerscheck, geen bescherming
    tegen dubbel verwerken. Met de browserconsole kon je jezelf in een paar
    aanroepen op plek 1 zetten.
    Nu wordt gecontroleerd: (a) de partij bestaat op `partijId`, (b) de
    matchups komen overeen met wat bij het starten is vastgelegd, (c) de
    aanroeper speelde zelf mee (of is coördinator), (d) de partij is niet al
    verwerkt (`ladders/{id}/verwerkt/{partijId}` — lost ook dubbeltelling na
    een netwerkhapering op), en (e) áls er scores staan die de match
    onmiskenbaar beslissen, moet de opgegeven winnaar daarmee kloppen.
    **Scores blijven expliciet optioneel**: geen scores of gelijkspel betekent
    dat de keuze van de speler gewoon telt, precies zoals voorheen. Wie de
    uitslag indiende wordt vastgelegd, en de coördinator kan een uitslag
    terugdraaien (`draaiPartijTerug`, knop bij Uitslagen).

  - **3. Zichtbare stand was vrij schrijfbaar.** `standen/{uid}` mocht door elk
    ladderlid worden aangepast, voor élke speler — terwijl de afgeschermde
    punten wel op slot zaten. Het slot zat dus op een getal dat niemand ziet.
    Nu: `standen` is read-only voor spelers, op de eigen handicap na
    (`onlyHcp()`); coördinator/beheerder houden hun beheerschermen. De dode
    functie `syncStandenNaBevestigUitslag()` is verwijderd — die hield die
    schrijfroute open.

  - **4. Scores overschreven elkaar.** Alle scores stonden in één array
    (`actievePartijen[]`) in het ladderdocument. Firestore ziet een array als
    één ondeelbare waarde, dus elke toetsaanslag schreef de complete array van
    de hele ladder terug. Twee flights op dezelfde ladder wisten elkaars holes;
    het horloge deed hetzelfde met een fire-and-forget PATCH.
    Nieuw datamodel: `ladders/{id}/partijen/{partijId}` met subcollectie
    `scores/{uid}`, waarin per hole één veld wordt geschreven. Botsen kan
    structureel niet meer, en flightgenoten die elkaars kaart bijhouden worden
    samengevoegd in plaats van overschreven. Nieuw bestand: `js/scores.js`.
    Bijvangst: alleen nog de scoredocumenten van je eigen partij worden
    gedownload in plaats van het hele ladderdocument bij elke toetsaanslag van
    elke speler (scheelt data en accu op de baan), en de 1MB-documentlimiet is
    voor `actievePartijen` van de baan.
    **Overgang:** deze versie schrijft nog steeds naar de oude array, maar als
    afgeleide, vertraagde kopie (max 1× per 5 s). Bij lezen heeft de
    subcollectie altijd voorrang. In v5.1.0 verdwijnt de array.
    Ook aan: Firestore offline-cache (`persistentLocalCache`) — kon pas veilig
    ná deze omzetting, want een uitgestelde schrijfactie van de hele array
    wiste alles wat er intussen gebeurd was. En debounce van 400 ms op het
    opslaan.

  - **5. Migratietools uit de zip.** `migratie-uid.html` en
    `migratie-standen.html` (destructieve bulk-schrijftools met fuzzy
    naam-matching) stonden in de productiebundel. Ook `watch_backup_v11_86.html`
    is eruit.

  - **6. Activiteit op uid in plaats van naam.** De activiteitsstatistiek
    (inactiviteit/frequentie/diversiteit) werd per spelersnaam bijgehouden.
    Twee spelers met dezelfde naam smolten samen en een naamswijziging wiste
    iemands historie — terwijl die statistiek meebepaalt waar je staat.
    Uitslagen krijgen nu `spelerUids` en `matchupUids` naast de namen.
    Historische uitslagen bevatten alleen namen; die worden vertaald via een
    naam→uid-map, en alleen als de naam éénduidig is. Bij dubbele namen valt
    het terug op het oude gedrag — nooit slechter, maar met terugwerkende
    kracht niet te repareren.

  - **7. Dubbele rekenregels weg.** `verrijkMetActiviteit()` +
    `sorteerOpActiviteit()` in `js/ladder.js` waren een tweede volledige
    implementatie van de ranking-regels naast die in `functions/index.js`, en
    het Ladderverloop had er nog een derde (`_lvReconstrueer`, `_lvMetRang`).
    Vervangen door `bepaalActiviteitsIconen()`, dat alleen nog de gegevens voor
    de iconen (🔥🌟⬇️⏳) berekent — geen positie, geen sortering.
    `berekenWeergaveRangen()` gebruikt nu simpelweg de serverpositie, waarmee
    het verschil tussen uitslagbericht en ladderlijst per definitie weg is.
    Ladderverloop toont voortaan de daadwerkelijk vastgelegde standen
    (snapshots + archief) in plaats van het verleden na te bootsen; de tweede
    lijn "met activiteit" is vervallen omdat de opgeslagen rank die correctie
    al bevat.

  - **Extra vondst tijdens het bouwen:** in `firestore.rules` worden meerdere
    `allow read`-regels met OR gecombineerd. De algemene regel
    `allow read: if isIngelogd()` op `ladder/{doc}` maakte daardoor ook
    `ladder/config` leesbaar voor élke ingelogde speler, ondanks de striktere
    beheerder-only regel verderop. Elke speler kon dus het initiële wachtwoord
    van nieuwe accounts opvragen. Nu expliciet uitgezonderd.

  - **Nog te doen (bewust niet in deze versie):** geen tests/build/linting, en
    de oude `actievePartijen`-array bestaat nog tot v5.1.0.

- **v4.2.0** — Puntensysteem: het rangnummer-herverdeel-algoritme is vervangen
  door een score per speler, berekend en opgeslagen server-side.
  - **Nieuw datamodel**: `ladders/{id}/punten/{uid}` (nieuwe, afgeschermde
    subcollectie) bevat `score` (= `basisScore + activiteitDelta`),
    `basisScore` en `activiteitDelta`. De publieke positie 1..N blijft in
    `ladders/{id}/standen/{uid}.rank` staan — voor spelers verandert er
    zichtbaar niets.
  - **Cloud Functions** (`functions/index.js`): `verwerkPartijUitslag`
    (vervangt de client-side berekening in `bevestigUitslag()` van
    `js/ronde.js` én `bevestigBeheerUitslag()` van `js/uitslagen.js`),
    `pasPuntenAan` (handmatige puntenaanpassing) en
    `herbereikenActiviteitDagelijks` (dagelijkse scheduled function om
    posities ook zonder nieuwe partijen actueel te houden). Alle drie
    respecteren `isTest` en schrijven naar de juiste Firestore-database
    (productie of de named database `test`), zodat een sessie in de
    testomgeving nooit productiedata raakt en andersom.
  - **Identieke uitkomst als voorheen**: de win/verlies-regels (laagStijg,
    hoogStijg, laagZak, hoogZak, drempel, verliezerNaarWinnaar) zijn
    ongewijzigd. In plaats van na elke partij alle andere spelers over
    "beschikbare plekken" te herverdelen (de bron van meerdere eerdere bugs,
    zie v3.0.0-11.23 hieronder), krijgt na verwerking gewoon IEDEREEN een
    schone score volgens zijn nieuwe positie — een simpele volledige
    hersortering die niet meer fout kan gaan.
  - **Inactiviteit/frequentie/diversiteit blijvend i.p.v. tijdelijk**: dezelfde
    wiskunde als `verrijkMetActiviteit()` (`js/ladder.js`), maar nu verwerkt
    in de echte, opgeslagen score in plaats van een tijdelijke
    weergavecorrectie. Voorkomt de terugkerende discrepantie tussen
    "uitslagbericht" en "ladderlijst" structureel, omdat er nu nog maar één
    getal per speler bestaat.
  - **Zichtbaarheid**: alleen het account met `puntenBeheerder:true` op zijn
    `spelers/{uid}`-document kan de ruwe punten lezen — technisch afgedwongen
    via `firestore.rules` (niet alleen verborgen in het scherm). Niemand kan
    er rechtstreeks in schrijven; dat loopt uitsluitend via de Cloud
    Functions. **Handmatige stap vereist**: zet dit vlag zelf via de Firebase
    console op jouw eigen account — er is bewust geen schermpje dat dit kan
    instellen.
  - **Beheerscherm**: de "↕ Stand"-knop met pijltjes-omhoog/omlaag
    (`openStandAanpassen`) is verwijderd. In de bestaande "👥 Spelers"-modal
    (`openLadderSpelersModal`, `js/beheer.js`) staat voor de puntenbeheerder
    nu een extra kolom: puntenaantal + potlood, met live herberekende positie
    terwijl je typt (puur client-side, geen extra reads). Voor ieder ander
    account is dit scherm ongewijzigd. Een speler uitvinken verwijdert hem
    alleen uit de ladderlijst — zijn punten/stand-document blijft bestaan en
    komt terug zodra hij opnieuw wordt aangevinkt.
  - **Migratie**: geen aparte migratieknop nodig — alle drie de Cloud
    Functions bootstrappen ontbrekende punten automatisch uit de huidige
    `rank` (zelfde volgorde blijft behouden) zodra een ladder voor het eerst
    wordt aangeraakt (eerste partij, eerste handmatige aanpassing, of de
    eerste nachtelijke herberekening).
  - **Bekende beperking**: de historische grafiek in "Ladderverloop"
    (`openLadderverloop` in `js/ladder.js`) reconstrueert het verleden nog
    met het oude plek-algoritme, puur voor de weergave — dit heeft geen
    invloed op de actuele stand.
  - Zie `puntensysteem-plan.md` (los aangeleverd) voor de volledige
    ontwerpgeschiedenis van dit besluit.
- **v4.0.2** — Twee UX-verbeteringen toernooimodus (`js/toernooi.js`):
  - **Matrix toont marge**: de onderlinge stand toont nu het aantal holes
    voorsprong/achterstand als getal (kleur = richting: groen voor, rood
    achter); bij gelijke stand blijft TIED staan. Implementatie:
    `berekenTPuntenVoorDag()` retourneert extra `standen[i][j]`-matrix
    (positief = i staat voor), `berekenTPunten()` telt marges op voor de
    totaalstand, `renderTMatrix()` rendert het getal.
  - **Cursor-richting per rol**: in de toernooiscorekaart springt de cursor
    voor de beheerder per speler (kolom omlaag, zoals voorheen) en voor
    spelers per hole (rij naar rechts: alle flightgenoten van hole 1, dan
    hole 2). Alleen de tabindex-berekening in `renderTScorecard()` gewijzigd.
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
  .standen/{uid}              # Stand per speler: rank (publiek, 1..N), partijen, gewonnen, prevRank
  .partijen/{partijId}        # v5.0.0 — metadata van een lopende partij (baan, holes,
                              # spelers, matchups, speltype). Vervangt actievePartijen[]
                              # als bron van waarheid; die array bestaat nog tot v5.1.0
                              # als vertraagde, alleen-lezen kopie.
    .scores/{uid}             # v5.0.0 — { holes: {"0":4,"1":5,...} } per speler.
                              # Per hole één veld geschreven, zodat twee spelers
                              # elkaar niet kunnen overschrijven. Zie js/scores.js.
  .verwerkt/{partijId}        # v5.0.0 — idempotency-stempel van verwerkPartijUitslag
                              # + momentopname voor draaiPartijTerug. Server-only.
  .teruggedraaid/{partijId}   # v5.0.0 — archief van teruggedraaide uitslagen
  .punten/{uid}                # v4.2.0 — AFGESCHERMD: score, basisScore.
                              # v5.1.0: activiteitDelta vervangen door
                              # activiteitVerschuiving (aantal PLEKKEN dat de
                              # periodieke activiteitsverwerking al heeft
                              # toegepast) — voorkomt opstapelen.
                              # Read alleen puntenBeheerder-account (firestore.rules). Write
                              # alleen via Cloud Functions (verwerkPartijUitslag, pasPuntenAan,
                              # herbereikenActiviteitDagelijks) — geen enkele client schrijft hier direct.

spelers/{uid}
  .naam, .email, .hcp, .rol, .eersteLogin
  .puntenBeheerder            # v4.2.0 — true op precies ÉÉN account: handmatig gezet via de
                              # Firebase console (spelers/{jouw-uid}), niet via de app zelf.

ladder/watchPins              # v5.0.0 — { [sha256(PIN)]: { uid, expires, gebruikt, gemaakt } }
                              # GEEN tokens meer. Volledig dichtgezet in firestore.rules:
                              # alleen de Cloud Functions maakWatchPin / wisselWatchPin
                              # komen hier nog bij (Admin SDK).
ladder/watchPinPogingen       # v5.0.0 — { fouten, venster } foutteller tegen brute force
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
