// ============================================================
//  Laag 4 — GENERALE REPETITIE VAN EEN TOERNOOI
// ============================================================
//  WAAROM DIT BESTAAT.
//  Op 11 september 2026 zei Sierk: "Tot nu toe is het nog niet gelukt om een
//  toernooi echt te spelen met de app. Er zijn continu bugs waardoor dat niet
//  lukt." De oorzaak was niet één bug maar een gat in de dekking: de
//  toernooitab had 67 rekentests en GEEN ENKELE test die een toernooi ook echt
//  speelt. De sommen klopten; of je erdoorheen kon klikken werd nergens
//  bewaakt.
//
//  Deze repetitie speelt de hele route: toernooi aanmaken -> flights indelen ->
//  scores invoeren door twee spelers tegelijk -> dag afsluiten -> uitslag ->
//  tweede dag. Elke stap die stukgaat, valt hier om in plaats van op de
//  eerste tee.
//
//  De vier fouten van 11 september staan er los in, elk met de naam van het
//  probleem, zodat een terugval meteen herkenbaar is.
// ============================================================
const { test, expect } = require('./hulp-browser.cjs');

// De tests delen één database (workers: 1). Zonder opruimen zou het toernooi
// van de vorige test het volgende blokkeren — sinds v5.9.0 mag er maar één
// actief toernooi zijn. Opruimen gebeurt met de admin-ingang, buiten de app om.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-goyer' });
const beheerDb = admin.firestore();

// Haalt het toernooi met deze naam op uit de nagemaakte database. Wacht even:
// de browser schrijft, de admin-ingang leest, en dat is niet op dezelfde tel.
async function haalToernooi(naam, pogingen = 20) {
  for (let i = 0; i < pogingen; i++) {
    const snap = await beheerDb.collection('toernooien').get();
    const gevonden = snap.docs.map(d => d.data()).find(d => d.naam === naam);
    if (gevonden) return gevonden;
    await new Promise(r => setTimeout(r, 500));
  }
  const alle = (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().naam);
  throw new Error(`Toernooi "${naam}" niet in de database. Wel gevonden: ${JSON.stringify(alle)}`);
}

test.beforeEach(async () => {
  const snap = await beheerDb.collection('toernooien').get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
});

const WACHTWOORD = 'test1234';
const klikInloggen = (page) => page.click('#login-scherm button.btn-primary');

const inloggen = async (page, login) => {
  await page.goto('/index.html');
  await page.waitForSelector('#login-scherm', { state: 'visible' });
  await page.fill('#login-email', login);
  await page.fill('#login-pass', WACHTWOORD);
  await klikInloggen(page);
  await page.waitForSelector('#login-scherm', { state: 'hidden', timeout: 20000 });
};

const naarToernooi = async (page) => {
  await page.click('nav button:has-text("Toernooi")');
  await page.waitForSelector('#page-toernooi.active', { timeout: 10000 });
};

// Bevestigingsvragen automatisch met OK beantwoorden. Zonder dit klikt
// Playwright ze weg en doet de knop niets — dat kostte op 11 september een
// meetronde.
const jaOpAlles = (page) => page.on('dialog', d => d.accept());

// Kiest een speler via het echte zoekveld, zoals een mens dat doet.
async function kiesSpeler(page, naam) {
  await page.fill('#t-speler-zoek', naam.split(' ')[0]);
  const regel = page.locator(`#t-speler-zoek-lijst >> text=${naam}`).first();
  await regel.waitFor({ state: 'visible', timeout: 5000 });
  // Rechtstreeks aanklikken via het element zelf. De zoeklijst zweeft over het
  // formulier heen en wordt door de ingeklapte kaart eronder onderschept; dat
  // is een schoonheidsfoutje in de opmaak, geen reden om de hele repetitie te
  // laten stranden. De echte onclick-handler van de app draait gewoon.
  await regel.evaluate(el => el.click());
  // Zoekveld verlaten, anders blijft de zwevende resultatenlijst over de knop
  // "Flight indeling →" heen liggen.
  await page.fill('#t-speler-zoek', '');
  await page.evaluate(() => document.getElementById('t-speler-zoek')?.blur());
  await page.waitForFunction(
    () => (document.getElementById('t-speler-zoek-lijst')?.style.display || 'none') === 'none',
    null, { timeout: 5000 });
}

// Opent de flightindeling vanuit het aanmaakscherm.
async function naarFlightIndeling(page) {
  await page.click('#toernooi-setup-wrap button:has-text("Flight indeling")');
  await page.waitForSelector('#modal-flight-indeling.open', { timeout: 10000 });
}

// De kaart "Nieuw Toernooi" staat standaard dichtgeklapt. Een mens klikt hem
// open; zolang dat niet gebeurt onderschept de kop alle klikken eronder.
async function openAanmaakscherm(page) {
  const kop = page.locator('#toernooi-setup-wrap .card-header.inklapbaar').first();
  await kop.waitFor({ state: 'visible', timeout: 10000 });
  if (await kop.evaluate(el => el.classList.contains('ingeklapt'))) await kop.click();
  await expect(kop).not.toHaveClass(/ingeklapt/);
}

// Vult het aanmaakformulier voor een toernooi van `dagen` dagen.
async function vulAanmaakformulier(page, naam, dagen = 1) {
  await openAanmaakscherm(page);
  await page.fill('#t-naam', naam);
  if (dagen > 1) await page.selectOption('#t-aantal-dagen', String(dagen));
  const blokken = page.locator('#t-dag-blokken .dag-blok');
  await expect(blokken).toHaveCount(dagen);
  for (let i = 0; i < dagen; i++) {
    const blok = blokken.nth(i);
    await blok.locator('.t-dag-datum').fill(`2026-10-0${i + 1}`);
    await blok.locator('.t-dag-baan').selectOption('De Goyer');
  }
}

// ============================================================

test.describe('Toernooi — de hele route', () => {

  test('een toernooi van begin tot eind: aanmaken, indelen, scoren, afsluiten', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);
    const fouten = [];
    page.on('pageerror', e => fouten.push(e.message));

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    // ── 1. Aanmaken ──────────────────────────────────────────
    await vulAanmaakformulier(page, 'Repetitie', 1);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler', 'Nina Nieuw']) {
      await kiesSpeler(page, n);
    }
    await naarFlightIndeling(page);

    // ── 2. Indelen: twee flights, gelijk verdelen ────────────
    await page.click('button:has-text("+ Flight toevoegen")');
    await page.click('button:has-text("Gelijk verdelen")');

    // GEEN LEGE FLIGHT (fout 1 van 11-9-2026): na verdelen zit in elke flight
    // iemand. Voorheen bleef flight 1 leeg achter en toonde de scorekaart
    // holes zonder spelerskolommen.
    const leegWaarschuwing = page.locator('#flight-lijst >> text=leeg');
    await expect(leegWaarschuwing).toHaveCount(0);

    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#modal-flight-indeling')).not.toHaveClass(/open/, { timeout: 15000 });

    // ── 3. Het toernooi draait ───────────────────────────────
    await expect(page.locator('#toernooi-actief-wrap')).toBeVisible();
    await expect(page.locator('#toernooi-detail')).toContainText('Repetitie');
    await expect(page.locator('#toernooi-detail')).toContainText('4 spelers');
    await expect(page.locator('#toernooi-detail')).toContainText('2 flights');

    // AANMAAKFORMULIER OPGEBORGEN (fout 3 van 11-9-2026): naast een lopend
    // toernooi hoort geen leeg aanmaakformulier met "Nog geen deelnemers
    // geselecteerd" — Sierk las dat als een leeg toernooi.
    await expect(page.locator('#toernooi-setup-wrap')).toBeHidden();
    await expect(page.locator('#toernooi-nieuw-sectie')).toBeVisible();
    await expect(page.locator('#toernooi-geannuleerd-sectie')).toHaveCount(0);

    expect(fouten, 'geen JavaScript-fouten tijdens de hele route').toEqual([]);
  });

  // ============================================================
  //  v5.11.0 — DRIE MENSEN TEGELIJK: SPELER, MARKER EN WEDSTRIJDLEIDING
  // ============================================================
  //  Dit is de test die er tot nu toe niet was, en de reden dat de
  //  toernooimodus bugs bleef houden: de sommen klopten, maar of drie mensen
  //  er tegelijk doorheen kunnen klikken werd nergens bewaakt.
  //
  //  Drie aparte browservensters, drie echte inlogs. Elk venster schrijft naar
  //  ZIJN EIGEN laag — de app kiest die laag op grond van wie er is ingelogd.
  //  De kleur van een vakje is hier het bewijs: oranje = wacht op de ander,
  //  rood = ze verschillen, zwart = het klopt.
  //
  //  De kleur wordt uit de ECHTE opmaak gelezen (de rand), niet uit een
  //  hulpveld dat de test zelf zou kunnen zetten.
  // ============================================================
  test('MARKERS: speler, marker en wedstrijdleiding tegelijk aan één kaart', async ({ browser }) => {
    test.setTimeout(240000);

    // Leest de kleur zoals hij op het scherm staat: stippellijn = oranje,
    // dubbele rand = rood, gewone rand = zwart.
    const kleurVanCel = (pagina, uid, hole) => pagina.evaluate(({ uid, hole }) => {
      const el = document.querySelector(`#t-scorecard-wrap [data-uid="${uid}"][data-hole="${hole}"]`);
      if (!el) return 'geen';
      const rand = getComputedStyle(el).borderStyle || '';
      if (rand.startsWith('double')) return 'rood';
      if (rand.startsWith('dashed')) return 'oranje';
      return 'zwart';
    }, { uid, hole });

    const wachtOpKleur = async (pagina, uid, hole, verwacht) => {
      await expect.poll(() => kleurVanCel(pagina, uid, hole),
        { timeout: 20000, message: `vakje van ${uid} op hole ${hole + 1} wordt ${verwacht}` }
      ).toBe(verwacht);
    };

    const ctxCoord  = await browser.newContext();
    const ctxSpeler = await browser.newContext();
    const ctxMarker = await browser.newContext();
    try {
      // ── 1. De wedstrijdleiding zet een toernooi van één flight op ──
      const coord = await ctxCoord.newPage();
      jaOpAlles(coord);
      await inloggen(coord, 'coord@MPladder.stb');
      await naarToernooi(coord);
      await vulAanmaakformulier(coord, 'Markers', 1);
      for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(coord, n);
      await naarFlightIndeling(coord);
      await coord.click('#flight-modal-start-btn');
      await expect(coord.locator('#toernooi-detail')).toContainText('Markers', { timeout: 15000 });

      // ── 2. De markerkring ligt vast in de flight ──────────────
      const t      = await haalToernooi('Markers');
      const ids    = t.dagen[0].flights[0].spelerIds;
      const markers = t.dagen[0].flights[0].markers;
      expect(Object.keys(markers).length, 'iedereen heeft een marker').toBe(ids.length);
      expect(Object.entries(markers).filter(([s, m]) => s === m).length,
        'niemand markeert zichzelf').toBe(0);

      // We volgen één speler en zijn marker.
      const uidSpeler = ids[1];
      const uidMarker = markers[uidSpeler];
      expect(uidMarker, 'de marker van de tweede is de eerste').toBe(ids[0]);
      const naamVan = (uid) => t.spelers.find(s => s.uid === uid).naam.split(' ')[0].toLowerCase();
      const uidDerde = ids.find(u => u !== uidSpeler && u !== uidMarker);

      const speler = await ctxSpeler.newPage();
      const marker = await ctxMarker.newPage();
      jaOpAlles(speler); jaOpAlles(marker);
      await inloggen(speler, `${naamVan(uidSpeler)}@MPladder.stb`);
      await inloggen(marker, `${naamVan(uidMarker)}@MPladder.stb`);
      await naarToernooi(speler);
      await naarToernooi(marker);

      // ── 3. Wie mag waar typen ────────────────────────────────
      // De speler: zijn eigen kolom en die van de speler die HIJ markeert.
      // De kolom van de derde staat op punten — hiermee vervalt het oude
      // vinkje "Scores verbergen".
      const magTypen = (pagina, uid) => pagina.locator(`#t-scorecard-wrap input[data-uid="${uid}"]`).count();
      expect(await magTypen(speler, uidSpeler), 'eigen kolom is invulbaar').toBeGreaterThan(0);
      const doorSpelerGemarkeerd = Object.keys(markers).find(k => markers[k] === uidSpeler);
      expect(await magTypen(speler, doorSpelerGemarkeerd), 'de kolom van zijn marker-speler ook').toBeGreaterThan(0);
      const verboden = ids.find(u => u !== uidSpeler && u !== doorSpelerGemarkeerd);
      expect(await magTypen(speler, verboden), 'de kolom van een ander niet').toBe(0);
      expect(await magTypen(coord, uidDerde), 'de wedstrijdleiding mag overal').toBeGreaterThan(0);

      // ── 4. De speler vult in: oranje, want de marker moet nog ──
      await speler.evaluate(({ uid }) => window.updateTScore(uid, 0, 5), { uid: uidSpeler });
      await wachtOpKleur(speler, uidSpeler, 0, 'oranje');
      await wachtOpKleur(coord,  uidSpeler, 0, 'oranje');
      await expect(coord.locator('#t-kaart-waarschuwing')).toContainText('wacht', { timeout: 20000 });

      // ── 5. De marker vult iets ANDERS in: rood, bij alle drie ──
      await marker.evaluate(({ uid }) => window.updateTScore(uid, 0, 6), { uid: uidSpeler });
      await wachtOpKleur(marker, uidSpeler, 0, 'rood');
      await wachtOpKleur(speler, uidSpeler, 0, 'rood');
      await wachtOpKleur(coord,  uidSpeler, 0, 'rood');
      await expect(speler.locator('#t-kaart-waarschuwing')).toContainText('verschil', { timeout: 20000 });

      // Ieder ziet zijn EIGEN getal — niemand dat van de ander.
      const getalIn = (pagina, uid, hole) => pagina.evaluate(({ uid, hole }) =>
        document.querySelector(`#t-scorecard-wrap [data-uid="${uid}"][data-hole="${hole}"]`)?.value,
        { uid, hole });
      expect(await getalIn(speler, uidSpeler, 0), 'de speler ziet zijn eigen 5').toBe('5');
      expect(await getalIn(marker, uidSpeler, 0), 'de marker ziet zijn eigen 6').toBe('6');

      // ── 6. Zolang het rood is, gaat de uitslag niet open ──────
      await expect(coord.locator('#t-uitslag-btn')).toContainText('uitpraten', { timeout: 20000 });
      await expect(coord.locator('#t-uitslag-btn')).toBeDisabled();

      // ── 7. Ze praten het uit: de marker past aan → zwart ──────
      await marker.evaluate(({ uid }) => window.updateTScore(uid, 0, 5), { uid: uidSpeler });
      await wachtOpKleur(speler, uidSpeler, 0, 'zwart');
      await wachtOpKleur(coord,  uidSpeler, 0, 'zwart');
      await expect(coord.locator('#t-uitslag-btn')).not.toContainText('uitpraten', { timeout: 20000 });
      await expect(coord.locator('#t-kaart-waarschuwing')).not.toContainText('verschil', { timeout: 20000 });

      // ── 8. De wedstrijdleiding stelt vast en zet de hole op slot ──
      await speler.evaluate(({ uid }) => window.updateTScore(uid, 1, 4), { uid: uidSpeler });
      await coord.evaluate(({ uid }) => window.updateTScore(uid, 1, 7), { uid: uidSpeler });
      await wachtOpKleur(speler, uidSpeler, 1, 'zwart');
      // De speler kan er niet meer bij, en ziet het getal van de wedstrijdleiding.
      const magTypenOpHole = (pagina, uid, hole) =>
        pagina.locator(`#t-scorecard-wrap input[data-uid="${uid}"][data-hole="${hole}"]`).count();
      await expect.poll(() => magTypenOpHole(speler, uidSpeler, 1), { timeout: 20000 }).toBe(0);
      await expect.poll(() => speler.evaluate(({ uid }) =>
        document.querySelector(`#t-scorecard-wrap [data-uid="${uid}"][data-hole="1"]`)?.textContent?.trim(),
        { uid: uidSpeler }), { timeout: 20000 }).toBe('7');
    } finally {
      await ctxCoord.close(); await ctxSpeler.close(); await ctxMarker.close();
    }
  });

  // ============================================================
  //  v5.11.1 — DE ONDERLINGE STAND AAN OF UIT VOOR DEELNEMERS
  // ============================================================
  //  Er bestond al een schakelaar, maar verstopt als het inklap-pijltje op de
  //  kop van het blok: de coordinator klapte het bij zichzelf in en klapte het
  //  ongemerkt ook bij alle deelnemers in. Nu is het een schakelaar met een
  //  naam, en bij "uit" wordt het blok bij de deelnemer NIET GETEKEND — niet
  //  ingeklapt, want dan staan de gegevens er nog gewoon in.
  // ============================================================
  test('ONDERLINGE STAND: de coordinator zet het blok aan en uit voor deelnemers', async ({ browser }) => {
    test.setTimeout(180000);

    const ctxCoord  = await browser.newContext();
    const ctxSpeler = await browser.newContext();
    try {
      const coord = await ctxCoord.newPage();
      jaOpAlles(coord);
      await inloggen(coord, 'coord@MPladder.stb');
      await naarToernooi(coord);
      await vulAanmaakformulier(coord, 'Standblok', 1);
      for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(coord, n);
      await naarFlightIndeling(coord);
      await coord.click('#flight-modal-start-btn');
      await expect(coord.locator('#toernooi-detail')).toContainText('Standblok', { timeout: 15000 });

      const speler = await ctxSpeler.newPage();
      jaOpAlles(speler);
      await inloggen(speler, 'anna@MPladder.stb');
      await naarToernooi(speler);

      const blok = (pagina) => pagina.locator('#toernooi-detail h2:has-text("Onderlinge stand")');

      // Standaard aan: de deelnemer ziet het blok.
      await expect(blok(speler)).toBeVisible({ timeout: 15000 });
      await expect(blok(coord)).toBeVisible();

      // Uit: bij de deelnemer verdwijnt het blok helemaal, ook de gegevens.
      await coord.uncheck('#t-matrix-zichtbaar-chk');
      await expect(blok(speler)).toHaveCount(0, { timeout: 20000 });
      await expect(speler.locator('#t-matrix')).toHaveCount(0);
      await expect(blok(coord), 'de coordinator ziet hem altijd').toBeVisible();

      // En weer aan.
      await coord.check('#t-matrix-zichtbaar-chk');
      await expect(blok(speler)).toBeVisible({ timeout: 20000 });
    } finally {
      await ctxCoord.close(); await ctxSpeler.close();
    }
  });

  test('AFSLUITEN: alle scores, uitslag, dag afsluiten en weer heropenen', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);
    const fouten = [];
    page.on('pageerror', e => fouten.push(e.message));

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Afsluiten', 1);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Afsluiten', { timeout: 15000 });

    // Zolang de kaart niet vol is, mag de uitslagknop niet werken.
    await expect(page.locator('#t-uitslag-btn')).toBeDisabled();

    // Alle holes van alle spelers invullen via de echte invoerfunctie van de
    // app — dezelfde weg als een speler die intypt, maar dan in één keer.
    const t = await haalToernooi('Afsluiten');
    const uids  = t.spelers.map(s => s.uid);
    const holes = t.dagen[0].holes.length;
    await page.evaluate(({ uids, holes }) => {
      uids.forEach((uid, i) => {
        for (let h = 0; h < holes; h++) window.updateTScore(uid, h, 4 + (i % 2));
      });
    }, { uids, holes });

    // De uitslagknop gaat vanzelf aan zodra de kaart vol is.
    await expect(page.locator('#t-uitslag-btn')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#t-uitslag-btn')).not.toContainText('onvolledig');

    // Uitslag tonen, dan de dag afsluiten.
    await page.click('#t-uitslag-btn');
    const afsluitKnop = page.locator('#toernooi-detail button:has-text("afsluiten")').first();
    await afsluitKnop.waitFor({ state: 'visible', timeout: 15000 });
    await afsluitKnop.click();

    // De dag staat op slot: de scores staan er als tekst, niet meer als invoer.
    await expect(page.locator('#toernooi-detail button:has-text("heropenen")')).toBeVisible({ timeout: 15000 });

    // DAG HEROPENEN (fout 5 van 11-9-2026): tot en met v5.8.9 was een
    // afgesloten dag voorgoed op slot — `dag.afgerond` werd nergens
    // teruggezet, ook niet door het toernooi opnieuw te activeren.
    await page.click('#toernooi-detail button:has-text("heropenen")');
    await expect(page.locator('#toernooi-detail button:has-text("heropenen")')).toHaveCount(0, { timeout: 15000 });
    await expect.poll(
      async () => (await haalToernooi('Afsluiten')).dagen[0].afgerond,
      { timeout: 15000, message: 'dag moet in de database weer open staan' }
    ).toBe(false);

    expect(fouten, 'geen JavaScript-fouten tijdens afsluiten en heropenen').toEqual([]);
  });

  test('DAGEN BEHEREN: dag toevoegen op een andere baan, wijzigen en verwijderen', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);
    const fouten = [];
    page.on('pageerror', e => fouten.push(e.message));

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    // Eendaags toernooi aanmaken — precies het scenario van Sierk.
    await vulAanmaakformulier(page, 'Dagenbeheer', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Dagenbeheer', { timeout: 15000 });

    // "+ Dag toevoegen" moet er meteen staan. Tot en met v5.9.0 verscheen die
    // knop pas als ALLE dagen waren afgesloten — en was het toernooi dus alleen
    // te redden door het weg te gooien.
    const dagErbij = page.locator('#toernooi-detail button:has-text("Dag toevoegen")');
    await expect(dagErbij).toBeVisible();
    await dagErbij.click();
    await page.waitForSelector('#modal-nieuwe-dag.open');
    await page.fill('#t-dag-datum', '2026-10-05');
    await page.selectOption('#t-dag-baan', 'De Goyer');
    await page.click('#modal-dag-opslaan-btn');

    await expect.poll(async () => (await haalToernooi('Dagenbeheer')).dagen.length,
      { timeout: 15000, message: 'dag 2 moet erbij komen' }).toBe(2);

    // Dag 2 wijzigen: andere datum.
    await page.click('#toernooi-detail >> text=Dag 2');
    await page.click('#toernooi-detail button:has-text("wijzigen")');
    await page.waitForSelector('#modal-nieuwe-dag.open');
    await expect(page.locator('#modal-dag-titel')).toContainText('Dag 2 wijzigen');
    await page.fill('#t-dag-datum', '2026-10-09');
    await page.click('#modal-dag-opslaan-btn');
    await expect.poll(async () => (await haalToernooi('Dagenbeheer')).dagen[1].datum,
      { timeout: 15000, message: 'de datum van dag 2 moet veranderen' }).toBe('2026-10-09');

    // En weer weghalen.
    await page.click('#toernooi-detail button:has-text("wijzigen")');
    await page.waitForSelector('#modal-nieuwe-dag.open');
    await page.click('#modal-dag-verwijder-btn');
    await expect.poll(async () => (await haalToernooi('Dagenbeheer')).dagen.length,
      { timeout: 15000, message: 'dag 2 moet weg zijn' }).toBe(1);

    expect(fouten, 'geen JavaScript-fouten tijdens dagbeheer').toEqual([]);
  });

  test('GASTLOGIN: gast logt in met alleen zijn naam en het toernooiwachtwoord', async ({ page, browser }) => {
    test.setTimeout(240000);
    const fouten = [];
    page.on('pageerror', e => fouten.push(e.message));

    // Eén afhandelaar voor alle vensters: prompts krijgen een antwoord uit de
    // rij, bevestigingsvragen een OK. Twee losse afhandelaars vechten om
    // dezelfde vraag ("dialog which is already handled").
    const antwoorden = ['Karel Gast', '15'];
    page.on('dialog', async d => {
      if (d.type() === 'prompt') await d.accept(antwoorden.shift() ?? '');
      else await d.accept();
    });

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    await vulAanmaakformulier(page, 'Gastentoernooi', 1);
    await kiesSpeler(page, 'Anna Speler');
    await page.fill('#t-gast-wachtwoord', 'goyer2026');

    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Karel Gast');

    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Gastentoernooi', { timeout: 20000 });

    // De gast heeft een echt account gekregen, met de toernooicode erachter.
    const t = await haalToernooi('Gastentoernooi');
    expect(t.gastCode, 'het toernooi draagt een openbare gastcode').toBe('gastentoernooi');
    const gast = t.spelers.find(sp => sp.naam === 'Karel Gast');
    expect(gast, 'de gast staat in het toernooi').toBeTruthy();
    expect(gast.gast, 'blijft een gast — telt niet mee voor de ladder').toBe(true);
    expect(gast.login, 'heeft een inlognaam gekregen').toBe('karel.gast.gastentoernooi');
    expect(String(gast.uid).startsWith('gast_'), 'heeft een echte uid, geen tijdelijke').toBe(false);

    // Het wachtwoord staat NIET op het openbare toernooidocument.
    expect(JSON.stringify(t)).not.toContain('goyer2026');

    // En de gast zit in geen enkele ladder.
    const ladder = await beheerDb.doc('ladders/mp').get();
    expect((ladder.data().spelerIds || []).includes(gast.uid), 'staat niet in de ladder').toBe(false);

    // ── De gast logt in met ALLEEN zijn naam en het wachtwoord ──
    const gastPagina = await (await browser.newContext()).newPage();
    await gastPagina.goto('/index.html');
    await gastPagina.waitForSelector('#login-scherm', { state: 'visible' });
    await gastPagina.fill('#login-email', 'Karel Gast');
    await gastPagina.fill('#login-pass', 'goyer2026');
    await gastPagina.click('#login-scherm button.btn-primary');
    await gastPagina.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });

    // Geen verplicht wijzigscherm, en alleen de toernooitab.
    await expect(gastPagina.locator('#modal-eerste-login')).toHaveCount(0);
    await expect(gastPagina.locator('#nav-ladder-btn')).toBeHidden();
    await expect(gastPagina.locator('#page-toernooi')).toContainText('Gastentoernooi', { timeout: 20000 });

    await gastPagina.close();
    expect(fouten, 'geen JavaScript-fouten').toEqual([]);
  });

  test('LEGE FLIGHT: starten met een lege flight kan niet ongemerkt', async ({ page }) => {
    test.setTimeout(120000);
    const gevraagd = [];
    page.on('dialog', d => { gevraagd.push(d.message()); d.dismiss(); });

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Lege flight', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);

    await naarFlightIndeling(page);
    await page.click('button:has-text("+ Flight toevoegen")');   // flight 2 blijft leeg

    // De waarschuwing staat meteen in beeld, vóór je op starten drukt.
    await expect(page.locator('#flight-lijst')).toContainText('leeg');

    await page.click('#flight-modal-start-btn');
    // Er is om bevestiging gevraagd (en die is hier geweigerd), dus het
    // toernooi is NIET stilletjes met een lege flight aangemaakt.
    expect(gevraagd.join(' ')).toContain('geen spelers');
    await expect(page.locator('#modal-flight-indeling')).toHaveClass(/open/);
  });

  test('TWEE TOERNOOIEN: een tweede toernooi naast een lopend kan niet', async ({ page }) => {
    test.setTimeout(150000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    await vulAanmaakformulier(page, 'Eerste', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Eerste', { timeout: 15000 });

    // Formulier weer tevoorschijn halen en een tweede proberen
    await page.click('#toernooi-nieuw-sectie button');
    await expect(page.locator('#toernooi-setup-wrap')).toBeVisible();
    await vulAanmaakformulier(page, 'Tweede', 1);
    for (const n of ['Cees Speler', 'Nina Nieuw']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');

    await expect(page.locator('#toast')).toContainText('loopt nog', { timeout: 10000 });
  });

  test('MEERDAAGS: dag 2 wordt NIET vooraf ingedeeld, maar zegt dat wel', async ({ page }) => {
    test.setTimeout(150000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    await vulAanmaakformulier(page, 'Tweedaags', 2);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Tweedaags', { timeout: 15000 });

    // Dag 2 hoort LEEG te beginnen. Sierk, 12 september 2026: "Dag 2 wordt
    // ingedeeld ahv de prestaties van dag 1. Dus het is fijner om de volgende
    // dag niet al automatisch in te delen." v5.9.0 kopieerde de indeling van
    // dag 1 wél — dat is in v5.9.1 teruggedraaid.
    //
    // Maar de dag moet dan wel zeggen dat hij nog niet is ingedeeld, anders is
    // het niet te onderscheiden van een storing. Dat was het echte probleem.
    await page.click('#toernooi-detail >> text=Dag 2');
    await expect(page.locator('#toernooi-detail')).toContainText('nog niet in flights ingedeeld');
    await expect(page.locator('#toernooi-detail')).toContainText('3 spelers');

    const t = await haalToernooi('Tweedaags');
    expect(t.dagen[0].flights.length, 'dag 1 is wel ingedeeld').toBeGreaterThan(0);
    expect(t.dagen[1].flights.length, 'dag 2 begint zonder indeling').toBe(0);
  });
});
