# Goyer Golf MP Ladder — Projectstructuur
> Dit bestand is bedoeld voor Claude. Lees dit als eerste bij een nieuwe upload.

## Versienummer — verhoog ALTIJD bij elke wijziging, ook kleine

| Bestand | Locatie | Formaat |
|---|---|---|
| `version.json` | root | `{"version": "v3.0.0-11.XX"}` |
| `sw.js` | regel 2 | `const CACHE_VERSION = 'v2XX';` |
| `js/app.js` | ~regel 221 | `const VERSION = 'v3.0.0-11.XX';` |
| `js/app.js` | ~regel 262 | `const LOKALE_VERSIE = 'v3.0.0-11.XX';` |

Huidige versie: **v5.2.0**

### Changelog
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
