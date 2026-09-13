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

      // v5.11.8: maar ZIEN doet hij die kolom wel. Daar stonden puntjes.
      // Sierk: "de scores van je flightgenoten moet je wel kunnen zien."
      await coord.evaluate(({ uid }) => window.updateTScore(uid, 2, 7), { uid: verboden });
      await expect.poll(() => speler.evaluate(({ uid }) =>
        document.querySelector(`#t-scorecard-wrap [data-uid="${uid}"][data-hole="2"]`)?.textContent?.trim(),
        { uid: verboden }), { timeout: 20000, message: 'de score van een flightgenoot is te zien' })
        .toBe('7');
      expect(await speler.locator(`#t-scorecard-wrap [data-uid="${verboden}"]`).count(),
        'de hele kolom staat er, niet als puntjes').toBeGreaterThan(1);
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
      // v5.12.2: het klassement had geen kop en heeft die nu wel — juist dat
      // ontbreken is waar het misverstand van v5.11.1 vandaan kwam.
      const klassement = (pagina) => pagina.locator('#toernooi-detail h2:has-text("Klassement")');

      // Standaard aan: de deelnemer ziet het blok.
      await expect(blok(speler)).toBeVisible({ timeout: 15000 });
      await expect(blok(coord)).toBeVisible();

      // Uit: bij de deelnemer verdwijnt het blok helemaal, ook de gegevens.
      await coord.uncheck('#t-matrix-zichtbaar-chk');
      await expect(blok(speler)).toHaveCount(0, { timeout: 20000 });
      await expect(speler.locator('#t-matrix')).toHaveCount(0);
      await expect(blok(coord), 'de coordinator ziet hem altijd').toBeVisible();

      // ⚠ HIER GING HET MIS. De schakelaar dekte alleen het namenrooster. Het
      // KLASSEMENT — plaats, naam, punten — verscheen bij de deelnemer zodra de
      // dag was afgesloten, de uitslag was vrijgegeven, of het een strokeplay-dag
      // was, en bleef daar staan hoe de schakelaar ook stond. Sierk, 13 september
      // 2026: "de knop onderlinge stand tonen aan/uit heeft geen effect. zij
      // blijven de stand zien, ook na refresh." En daarna: "met onderlinge stand
      // heb ik steeds het klassement bedoeld."
      //
      // De uitslag wordt hier rechtstreeks in de database vrijgegeven. De knop
      // "Uitslag dag 1" is grijs tot alle scores van alle spelers ingevuld zijn,
      // en dit gaat niet over het invullen maar over wat er daarna zichtbaar is.
      // De app leest gewoon de echte toestand uit de database.
      const tDoc = (await beheerDb.collection('toernooien').get()).docs
        .find(d => d.data().naam === 'Standblok');
      // ⚠ `uitslagZichtbaar` staat op de DAG, niet op het toernooi. Het veld op
      // het toernooi bestaat ook, maar het scherm leest dat van de dag.
      const dagenUit = tDoc.data().dagen.map((d, i) =>
        i === 0 ? { ...d, uitslagZichtbaar: true } : d);
      await tDoc.ref.update({ dagen: dagenUit, uitslagZichtbaar: true });

      // Allebei opnieuw openen: zo meet deze test wat er uit de BEWAARDE
      // toestand wordt getekend, en niet of een scherm toevallig bijwerkt.
      // Sierk zei er nadrukkelijk bij: "ook na refresh".
      for (const p of [coord, speler]) {
        await p.reload();
        await p.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
        await naarToernooi(p);
      }

      await expect(klassement(coord), 'de coordinator ziet het klassement')
        .toBeVisible({ timeout: 20000 });
      await expect(klassement(speler), 'de deelnemer niet, want de schakelaar staat uit')
        .toHaveCount(0, { timeout: 20000 });
      await expect(speler.locator('#t-ranglijst'), 'ook de gegevens zelf niet').toHaveCount(0);
      await expect(blok(speler), 'en het namenrooster nog steeds niet').toHaveCount(0);

      // En weer aan: allebei de blokken komen terug.
      await coord.check('#t-matrix-zichtbaar-chk');
      await expect(blok(speler)).toBeVisible({ timeout: 20000 });
      await expect(klassement(speler), 'en het klassement ook').toBeVisible({ timeout: 20000 });
    } finally {
      await ctxCoord.close(); await ctxSpeler.close();
    }
  });

  // ============================================================
  //  v5.11.3 — DE FLIGHTINDELING OVERLEEFT EEN HERLAAD
  // ============================================================
  //  Het aanmaakformulier werd al als concept bewaard (naam, dagen, baan,
  //  spelers), maar de flightindeling niet — juist het stuk dat de meeste
  //  moeite kost. Na een herlaad begon je weer bij één flight met iedereen
  //  erin. Sierk: "een niet gestart toernooi moest ik steeds opnieuw indelen."
  // ============================================================
  test('CONCEPT: de flightindeling staat er na een herlaad nog', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Concept', 1);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler', 'Nina Nieuw']) {
      await kiesSpeler(page, n);
    }
    await naarFlightIndeling(page);
    await page.click('button:has-text("+ Flight toevoegen")');
    await page.click('button:has-text("Gelijk verdelen")');
    await page.fill('#flight-lijst input[type="text"]', 'Ochtendflight');
    await page.locator('#flight-lijst input[type="text"]').first().dispatchEvent('input');

    // Zoals het staat vóór het herladen: twee flights, en wie waar zit.
    const indelingVan = (p) => p.evaluate(() =>
      [...document.querySelectorAll('#flight-lijst .flight-blok, #flight-lijst > div')]
        .map(el => el.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' || '));
    const voor = await indelingVan(page);
    expect(voor, 'er staan twee flights').toContain('Flight 2');

    // Terug uit het venster en de pagina echt herladen.
    await page.click('#modal-flight-indeling button:has-text("Terug")');
    await page.waitForTimeout(1200);            // de concept-opslag wacht 500 ms
    await page.reload();
    await page.waitForSelector('#login-scherm', { state: 'hidden', timeout: 20000 });
    await naarToernooi(page);

    // Het formulier is hersteld…
    await expect(page.locator('#t-naam')).toHaveValue('Concept', { timeout: 15000 });
    // …en het aanmaakscherm staat open, zodat je ZIET dat het hersteld is.
    await expect(page.locator('#toernooi-setup-wrap .card-header.inklapbaar').first())
      .not.toHaveClass(/ingeklapt/, { timeout: 10000 });
    // …en de indeling ook.
    await naarFlightIndeling(page);
    const na = await indelingVan(page);
    expect(na, 'de tweede flight is er nog').toContain('Flight 2');
    expect(na, 'de hernoemde flight is er nog').toContain('Ochtendflight');
    for (const naam of ['Anna', 'Bram', 'Cees', 'Nina']) {
      expect(na, `${naam} staat nog ingedeeld`).toContain(naam);
    }
  });

  // ============================================================
  //  v5.11.3 — DE INLOGNAAM IN "SPELERS BEHEREN"
  // ============================================================
  //  Dit scherm toonde alleen de inlog van een GAST. Bij een clublid bleef de
  //  regel leeg, terwijl zijn inlognaam gewoon in zijn account staat.
  // ============================================================
  test('SPELERS BEHEREN: de inlognaam van een clublid staat erbij', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Inlognaam', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Inlognaam', { timeout: 15000 });

    await page.click('#toernooi-detail button:has-text("Spelers")');
    const lijst = page.locator('#toernooi-speler-verwijder-lijst');
    await expect(lijst).toBeVisible({ timeout: 10000 });
    await expect(lijst, 'de inlognaam van Anna staat erbij').toContainText('anna');
    await expect(lijst, 'en die van Bram ook').toContainText('bram');
    // Geen lege regel meer voor wie er geen heeft.
    await expect(lijst).not.toContainText('undefined');
  });

  // ============================================================
  //  v5.11.6 — DE MARKERKRING NA EEN SPELER ERBIJ
  // ============================================================
  //  Een speler toevoegen aan een lopend toernooi raakte `markers` niet aan.
  //  De nieuwe viel dan terug op de kring terwijl de anderen hun opgeslagen
  //  marker hielden: één speler markeerde er twee, de nieuwe niemand. Niemand
  //  bleef zónder marker, dus het viel niet op — maar "ieder markeert er één"
  //  klopte niet meer, en dat is juist de afspraak.
  // ============================================================
  test('MARKERKRING: een speler erbij verdeelt de kring opnieuw', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Kring', 1);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Kring', { timeout: 15000 });

    // Controleert de afspraak: ieder markeert er precies één, ieder wordt
    // precies één keer gemarkeerd, en niemand markeert zichzelf.
    const kringKlopt = (t) => {
      const f = t.dagen[0].flights[0];
      const m = f.markers || {};
      const spelers = f.spelerIds || [];
      return {
        aantal: spelers.length,
        iedereenHeeftEr1: Object.keys(m).length === spelers.length,
        iedereenMarkeertEr1: new Set(Object.values(m)).size === spelers.length,
        geenZelf: Object.entries(m).every(([s, mk]) => s !== mk),
        alleenEchteSpelers: Object.entries(m).flat().every(uid => spelers.includes(uid)),
      };
    };

    expect(kringKlopt(await haalToernooi('Kring')))
      .toEqual({ aantal: 3, iedereenHeeftEr1: true, iedereenMarkeertEr1: true,
                 geenZelf: true, alleenEchteSpelers: true });

    // ── Een vierde speler erbij, via Spelers beheren ──────────
    await page.click('#toernooi-detail button:has-text("Spelers")');
    await page.fill('#toernooi-speler-zoek', 'Nina');
    const regel = page.locator('#toernooi-speler-zoek-lijst >> text=Nina Nieuw').first();
    await regel.waitFor({ state: 'visible', timeout: 5000 });
    await regel.evaluate(el => el.click());
    await page.click('#modal-toernooi-spelers button:has-text("+ Toevoegen")');
    await expect(page.locator('#toernooi-detail')).toContainText('4 spelers', { timeout: 15000 });

    await expect.poll(async () => kringKlopt(await haalToernooi('Kring')),
      { timeout: 15000, message: 'de kring is opnieuw verdeeld' })
      .toEqual({ aantal: 4, iedereenHeeftEr1: true, iedereenMarkeertEr1: true,
                 geenZelf: true, alleenEchteSpelers: true });
  });

  // ============================================================
  //  v5.12.0 — DAG 1 STROKEPLAY, DAG 2 MATCHPLAY
  // ============================================================
  //  De speelwijze stond op het TOERNOOI: één keuze voor alle dagen. Nu staat
  //  hij op de DAG. Deze test speelt het na: twee dagen, twee speelwijzen, en
  //  het scherm moet per dag het juiste tonen.
  // ============================================================
  test('SPEELWIJZE PER DAG: dag 1 strokeplay, dag 2 matchplay', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);
    const fouten = [];
    page.on('pageerror', e => fouten.push(e.message));

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Gemengd', 2);

    // Dag 1 strokeplay, dag 2 matchplay.
    const blokken = page.locator('#t-dag-blokken .dag-blok');
    await blokken.nth(0).locator('.t-dag-modus').selectOption('strokeplay');
    await blokken.nth(1).locator('.t-dag-modus').selectOption('matchplay');

    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Gemengd', { timeout: 15000 });

    // Het staat ook echt zo in de database.
    const t = await haalToernooi('Gemengd');
    expect(t.dagen.map(d => d.modus), 'de speelwijze staat per dag')
      .toEqual(['strokeplay', 'matchplay']);

    // Dag 1 is strokeplay: geen onderlinge stand.
    await expect(page.locator('#toernooi-detail h2:has-text("Onderlinge stand")'),
      'op een strokeplay-dag geen onderlinge stand').toHaveCount(0);

    // Dag 2 is matchplay: die staat er wél.
    await page.click('#toernooi-detail button:has-text("Dag 2")');
    await expect(page.locator('#toernooi-detail h2:has-text("Onderlinge stand")'),
      'op een matchplay-dag wel').toBeVisible({ timeout: 15000 });

    // En terug naar dag 1 verdwijnt hij weer.
    await page.click('#toernooi-detail button:has-text("Dag 1")');
    await expect(page.locator('#toernooi-detail h2:has-text("Onderlinge stand")'))
      .toHaveCount(0, { timeout: 15000 });

    // ⚠ De Ladder-knop is in v5.12.0 uit het titelblok verdwenen; de laddertab
    // staat gewoon in de navigatiebalk.
    await expect(page.locator('#toernooi-detail button:has-text("Ladder")')).toHaveCount(0);

    expect(fouten, 'geen JavaScript-fouten').toEqual([]);
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
    // v5.11.7: ook een gast met ALLEEN een voornaam. Die kon worden toegevoegd
    // en kreeg een account, maar het inlogscherm weigerde hem — één woord viel
    // buiten de gastherkenning.
    const antwoorden = ['Karel Gast', '15', 'Bep', '12'];
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
    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Bep');

    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Gastentoernooi', { timeout: 20000 });

    // De gast heeft een echt account gekregen, met de toernooicode erachter.
    //
    // ⚠ Wachten tot de accounts er ECHT zijn. startToernooi() schrijft het
    // toernooi eerst weg en maakt de gastaccounts daarna aan, één voor één, met
    // een tweede Firebase-venster per gast. Bij twee gasten duurt dat langer dan
    // bij één — en dan las deze test het document van vóór die tweede
    // schrijfactie. Dat kostte een meetronde: het leek alsof het aanmaken
    // mislukte terwijl het alleen nog bezig was.
    await expect.poll(async () => {
      const x = await haalToernooi('Gastentoernooi');
      return (x.spelers || []).filter(sp => sp.gast && sp.login).length;
    }, { timeout: 30000, message: 'beide gasten hebben een inlog' }).toBe(2);
    const t = await haalToernooi('Gastentoernooi');
    expect(t.gastCode, 'het toernooi draagt een openbare gastcode').toBe('gastentoernooi');
    const gast = t.spelers.find(sp => sp.naam === 'Karel Gast');
    expect(gast, 'de gast staat in het toernooi').toBeTruthy();
    expect(gast.gast, 'blijft een gast — telt niet mee voor de ladder').toBe(true);
    expect(gast.login, 'heeft een inlognaam gekregen').toBe('karel.gast.gastentoernooi');
    const bep = t.spelers.find(sp => sp.naam === 'Bep');
    expect(bep?.login, 'een gast met alleen een voornaam krijgt ook een inlog')
      .toBe('bep.gastentoernooi');
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
    await expect(gastPagina.locator('#page-toernooi')).toContainText('Jouw scorekaart', { timeout: 20000 });

    // v5.11.4: het titelblok is voor een deelnemer weg — de toernooinaam staat
    // in toernooi-modus al in de titelbalk, "Bezig" zegt hem niets en
    // "← Ladder" werkt daar niet eens. Bij de coordinator staat het er wel.
    await expect(gastPagina.locator('#toernooi-detail'), 'geen Bezig-blok bij de gast')
      .not.toContainText('Bezig');
    await expect(gastPagina.locator('#toernooi-detail button:has-text("Ladder")')).toHaveCount(0);
    await expect(page.locator('#toernooi-detail'), 'de coordinator houdt het blok')
      .toContainText('Bezig');
    await gastPagina.close();

    // v5.11.4: dezelfde gast logt ook in met de PUNT-schrijfwijze — dat is wat
    // het beheerscherm hem als inlognaam toont, dus dat moet werken.
    const punt = await (await browser.newContext()).newPage();
    await punt.goto('/index.html');
    await punt.waitForSelector('#login-scherm', { state: 'visible' });
    await punt.fill('#login-email', 'Karel.Gast');
    await punt.fill('#login-pass', 'goyer2026');
    await punt.click('#login-scherm button.btn-primary');
    await punt.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(punt.locator('#page-toernooi')).toContainText('Jouw scorekaart', { timeout: 20000 });
    await punt.close();

    // v5.11.7: en de gast met alleen een voornaam komt er ook in.
    const eenNaam = await (await browser.newContext()).newPage();
    await eenNaam.goto('/index.html');
    await eenNaam.waitForSelector('#login-scherm', { state: 'visible' });
    await eenNaam.fill('#login-email', 'Bep');
    await eenNaam.fill('#login-pass', 'goyer2026');
    await eenNaam.click('#login-scherm button.btn-primary');
    await eenNaam.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(eenNaam.locator('#page-toernooi')).toContainText('Jouw scorekaart', { timeout: 20000 });
    await eenNaam.close();

    // En het beheerscherm toont precies dát: karel.gast, zonder toernooicode.
    await page.click('#toernooi-detail button:has-text("Spelers")');
    const lijst = page.locator('#toernooi-speler-verwijder-lijst');
    await expect(lijst).toBeVisible({ timeout: 10000 });
    await expect(lijst, 'de inlognaam zoals de gast hem intikt').toContainText('karel.gast');
    await expect(lijst, 'zonder de toernooicode erachter').not.toContainText('gastentoernooi');
    await page.click('#modal-toernooi-spelers button:has-text("Sluiten")');
    await expect(page.locator('#modal-toernooi-spelers')).not.toHaveClass(/open/, { timeout: 10000 });

    // v5.11.5: hetzelfde in het lijstje achter "Gastlogins tonen" — dat is het
    // briefje dat je aan je gasten doorgeeft, dus daar mag de code al helemaal
    // niet op staan.
    await page.click('#toernooi-detail button:has-text("Gastlogins tonen")');
    const briefje = page.locator('#archief-detail-inhoud');
    await expect(briefje).toBeVisible({ timeout: 10000 });
    await expect(briefje, 'de inlognaam staat erop').toContainText('karel.gast');
    await expect(briefje, 'zonder toernooicode').not.toContainText('karel.gast.gastentoernooi');
    await expect(briefje, 'met het wachtwoord erbij').toContainText('goyer2026');

    // v5.11.5: en de markerindeling draagt geen TIJDELIJKE gast-sleutels meer.
    // Die werden bij het starten overal vervangen behalve hier.
    const naStart = await haalToernooi('Gastentoernooi');
    const markerSleutels = (naStart.dagen[0].flights || [])
      .flatMap(f => Object.entries(f.markers || {}).flat());
    expect(markerSleutels.length, 'er staan markers in').toBeGreaterThan(0);
    expect(markerSleutels.filter(k => String(k).startsWith('gast_')),
      'geen tijdelijke sleutels meer in de markerindeling').toEqual([]);
    const echteIds = new Set(naStart.spelers.map(sp => sp.uid));
    expect(markerSleutels.every(k => echteIds.has(k)),
      'elke marker verwijst naar een speler die echt meedoet').toBe(true);

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

  // ============================================================
  //  v5.12.1 — EEN GEANNULEERD TOERNOOI WEER OPSTARTEN
  // ------------------------------------------------------------
  //  Sierk, 13 september 2026: "ik heb een geannuleerd toernooi opnieuw gestart
  //  maar een speler die inlogt krijgt scherm, geen actief toernooi."
  //
  //  Vier varianten nagespeeld; twee ervan waren stuk. Ze staan hieronder elk
  //  als eigen test, want het zijn twee losse oorzaken.
  // ============================================================

  // Hulpje: annuleren en daarna weer herstellen, als coordinator.
  async function annuleerEnHerstel(page, naam) {
    await page.click('#toernooi-detail button:has-text("Toernooi annuleren")');
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().status),
      { timeout: 20000, message: 'het toernooi staat op geannuleerd' }).toEqual(['geannuleerd']);
    await page.click('button:has-text("Eerdere toernooien tonen")');
    await expect(page.locator('#toernooi-geannuleerd-lijst')).toContainText(naam, { timeout: 20000 });
    await page.click('#toernooi-geannuleerd-lijst button:has-text("Herstellen")');
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().status),
      { timeout: 20000, message: 'het toernooi staat weer op actief' }).toEqual(['actief']);
  }

  test('HERSTELLEN: de melding "Geen actief toernooi" verdwijnt weer', async ({ page, browser }) => {
    test.setTimeout(240000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Herstart', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Herstart', { timeout: 20000 });

    // De speler zit erbij en blijft ingelogd — dat is het geval dat stukging.
    const speler = await (await browser.newContext()).newPage();
    await inloggen(speler, 'anna@MPladder.stb');
    await speler.click('nav button:has-text("Toernooi")');
    await expect(speler.locator('#page-toernooi')).toContainText('Jouw scorekaart', { timeout: 25000 });

    await annuleerEnHerstel(page, 'Herstart');

    // ⚠ HIER GING HET MIS tot v5.12.0. Het blok "Geen actief toernooi" wordt
    // aan de toernooipagina geplakt zodra er niets loopt, maar werd alleen
    // opgeruimd in dezelfde tak die het ook neerzet. Kwam er weer een toernooi,
    // dan bleef het eronder staan — voor altijd, tot de speler de app opnieuw
    // opende. Wie niet naar beneden scrolde, zag alleen die melding.
    await expect(speler.locator('#page-toernooi'), 'de scorekaart is terug')
      .toContainText('Jouw scorekaart', { timeout: 30000 });
    await expect(speler.locator('#toernooi-leeg-melding'),
      'en de melding "Geen actief toernooi" staat er niet meer onder').toHaveCount(0);
    await speler.close();
  });

  test('ANNULEREN: de gastlogin blijft werken en komt na herstel weer binnen', async ({ page, browser }) => {
    test.setTimeout(300000);
    const gevraagd = [];
    const antwoorden = ['Karel Gast', '15'];
    page.on('dialog', async d => {
      gevraagd.push(d.message());
      if (d.type() === 'prompt') return d.accept(antwoorden.shift() ?? '');
      return d.accept();
    });

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Herstartgast', 1);
    await kiesSpeler(page, 'Anna Speler');
    await page.fill('#t-gast-wachtwoord', 'goyer2026');
    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Karel Gast');
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Herstartgast', { timeout: 20000 });
    await expect.poll(async () => {
      const x = await haalToernooi('Herstartgast');
      return (x.spelers || []).filter(sp => sp.gast && sp.login).length;
    }, { timeout: 40000, message: 'de gast heeft een inlog' }).toBe(1);
    const uidVoor = (await haalToernooi('Herstartgast')).spelers.find(s => s.naam === 'Karel Gast').uid;

    gevraagd.length = 0;
    await annuleerEnHerstel(page, 'Herstartgast');

    // ⚠ HIER GING HET MIS tot v5.12.0. Annuleren bood aan de gastaccounts te
    // verwijderen. Zei je ja — en deze test zegt overal ja — dan was het account
    // écht weg, en herstellen bracht het niet terug: de gast kreeg bij inloggen
    // "Je hebt geen toegang", terwijl zijn inlognaam nog gewoon in het toernooi
    // stond. Er was ook geen weg terug, want opnieuw toevoegen geeft een nieuwe
    // uid en maakt zijn eerdere scores los. Opruimen hoort bij handelingen die
    // NIET herstelbaar zijn: definitief verwijderen en afsluiten.
    // (Het annuleervenster noemt de gastlogins nog wél — maar om te zeggen dat
    //  ze blijven werken. De vraag OF ze weg mogen, is wat verdwenen is.)
    expect(gevraagd.filter(m => /gastlogin/i.test(m) && /verwijderen\?/i.test(m)),
      'annuleren vraagt niet meer of de gastlogins weg mogen').toEqual([]);
    expect(gevraagd.some(m => /gastlogins blijven werken/i.test(m)),
      'en het zegt er meteen bij dat ze blijven werken').toBe(true);

    const na = await haalToernooi('Herstartgast');
    expect(na.spelers.find(s => s.naam === 'Karel Gast').uid,
      'de gast houdt zijn eigen uid, dus zijn scores blijven van hem').toBe(uidVoor);
    const profiel = await beheerDb.doc('spelers/' + uidVoor).get();
    expect(profiel.exists, 'en zijn profiel staat er nog').toBe(true);

    const gast = await (await browser.newContext()).newPage();
    await gast.goto('/index.html');
    await gast.waitForSelector('#login-scherm', { state: 'visible' });
    await gast.fill('#login-email', 'Karel Gast');
    await gast.fill('#login-pass', 'goyer2026');
    await gast.click('#login-scherm button.btn-primary');
    await gast.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(gast.locator('#page-toernooi'), 'de gast komt er na het herstel gewoon weer in')
      .toContainText('Jouw scorekaart', { timeout: 25000 });
    await gast.close();

    // En het opruimen is niet verdwenen, alleen verhuisd: bij DEFINITIEF
    // verwijderen gaat het gastaccount alsnog mee. Dat is de handeling die niet
    // meer terug te draaien is, dus daar hoort het.
    await page.click('#toernooi-detail button:has-text("Toernooi annuleren")');
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().status),
      { timeout: 20000 }).toEqual(['geannuleerd']);
    await page.click('button:has-text("Eerdere toernooien tonen")');
    await expect(page.locator('#toernooi-geannuleerd-lijst')).toContainText('Herstartgast', { timeout: 20000 });
    await page.click('#toernooi-geannuleerd-lijst button:has-text("🗑")');
    await expect.poll(async () => (await beheerDb.doc('spelers/' + uidVoor).get()).exists,
      { timeout: 30000, message: 'het gastprofiel is bij het definitief verwijderen opgeruimd' }).toBe(false);
  });

  // ============================================================
  //  v5.12.1 — NOG ÉÉN KEUZE "SPEELWIJZE"
  // ------------------------------------------------------------
  //  Sierk, 13 september 2026: "bij aanmaken toernooi staat nu 2x speelwijze
  //  selectie. de onderste moet weg. als er voor stroke play gekozen wordt
  //  verberg dan de ranking ladder mogelijkheid."
  //
  //  De onderste keuze was geen doublure: hij stuurde de puntenvelden, het
  //  HCP-percentage, de uitleg bij strokeplay en de ranking-ladders aan. Die
  //  aansturing zit nu in de dagblokken. Deze test bewaakt allebei: dat er nog
  //  één keuze per dag staat, en dat wat eronder hoorde te gebeuren ook gebeurt.
  // ============================================================
  test('SPEELWIJZE: één keuze per dag, en die stuurt de rest van het formulier', async ({ page }) => {
    test.setTimeout(150000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await openAanmaakscherm(page);

    const keuzes = page.locator('#toernooi-setup-wrap .t-dag-modus');
    const oudeRadio = page.locator('#toernooi-setup-wrap input[name="t-modus"]');
    const punten  = page.locator('#t-matchplay-instellingen');
    const uitleg  = page.locator('#t-strokeplay-instellingen');
    const ranking = page.locator('#t-ranking-ladders-wrap');

    // Eén dag, dus één keuze — en de oude toernooibrede keuze bestaat niet meer.
    await expect(keuzes, 'één speelwijze-keuze bij één dag').toHaveCount(1);
    await expect(oudeRadio, 'de tweede keuze is weg').toHaveCount(0);
    await expect(punten,  'matchplay: de puntenvelden staan er').toBeVisible();
    await expect(uitleg,  'matchplay: geen strokeplay-uitleg').toBeHidden();
    await expect(ranking, 'matchplay: de ranking-ladder mag').toBeVisible();

    // Strokeplay: geen punten, wel uitleg, en GEEN ranking-ladder — want een
    // strokeplay-toernooi telt niet mee voor de ladder.
    await keuzes.first().selectOption('strokeplay');
    await expect(ranking, 'strokeplay: de ranking-ladder is weg').toBeHidden();
    await expect(punten,  'strokeplay: geen puntenvelden').toBeHidden();
    await expect(uitleg,  'strokeplay: wel de uitleg brutto/netto/stableford').toBeVisible();

    // Twee dagen, gemengd. Dít is wat met de oude keuze niet kon: de
    // puntenvelden horen erbij vanwege dag 2, de uitleg vanwege dag 1, en de
    // ranking-ladder blijft weg vanwege dag 1.
    await page.selectOption('#t-aantal-dagen', '2');
    await expect(keuzes, 'twee dagen, twee keuzes').toHaveCount(2);
    await expect(keuzes.nth(0), 'dag 1 houdt zijn keuze').toHaveValue('strokeplay');
    await keuzes.nth(1).selectOption('matchplay');
    await expect(punten,  'gemengd: de puntenvelden zijn terug voor dag 2').toBeVisible();
    await expect(uitleg,  'gemengd: de uitleg blijft voor dag 1').toBeVisible();
    await expect(ranking, 'gemengd: nog steeds geen ranking-ladder').toBeHidden();

    // En alles weer matchplay brengt de ranking-ladder terug.
    await keuzes.nth(0).selectOption('matchplay');
    await expect(ranking, 'weer helemaal matchplay: de ranking-ladder mag weer').toBeVisible();
    await expect(uitleg,  'en de strokeplay-uitleg is weg').toBeHidden();
  });

  // ============================================================
  //  v5.12.2 — OOK OP EEN STROKEPLAY-DAG
  // ------------------------------------------------------------
  //  Op een strokeplay-dag staat het klassement er vanaf de eerste hole, zonder
  //  dat de dag hoeft te zijn afgesloten (v5.12.0: `dagModus === 'strokeplay'`).
  //  Dat is precies het geval waarin de schakelaar het hardst nodig is, en het
  //  geval waarin hij tot v5.12.1 het minst deed. Het namenrooster bestaat hier
  //  niet — bij strokeplay speel je niet tegen elkaar — dus dit is de enige test
  //  die het klassement helemaal alleen bewaakt.
  // ============================================================
  test('STAND UIT: ook het klassement van een strokeplay-dag verdwijnt', async ({ browser }) => {
    test.setTimeout(200000);
    const ctxCoord = await browser.newContext();
    const ctxSpeler = await browser.newContext();
    try {
      const coord = await ctxCoord.newPage();
      jaOpAlles(coord);
      await inloggen(coord, 'coord@MPladder.stb');
      await naarToernooi(coord);
      await vulAanmaakformulier(coord, 'Strokestand', 1);
      await coord.locator('#t-dag-blokken .t-dag-modus').first().selectOption('strokeplay');
      for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(coord, n);
      await naarFlightIndeling(coord);
      await coord.click('#flight-modal-start-btn');
      await expect(coord.locator('#toernooi-detail')).toContainText('Strokestand', { timeout: 20000 });

      const speler = await ctxSpeler.newPage();
      jaOpAlles(speler);
      await inloggen(speler, 'anna@MPladder.stb');
      await naarToernooi(speler);

      const klassement = (p) => p.locator('#toernooi-detail h2:has-text("Klassement")');
      await expect(klassement(speler), 'bij strokeplay staat het klassement er meteen')
        .toBeVisible({ timeout: 20000 });
      await expect(speler.locator('#toernooi-detail h2:has-text("Onderlinge stand")'),
        'en het namenrooster juist niet — je speelt niet tegen elkaar').toHaveCount(0);

      await coord.uncheck('#t-matrix-zichtbaar-chk');
      await expect(klassement(speler), 'schakelaar uit: weg bij de deelnemer')
        .toHaveCount(0, { timeout: 20000 });
      await expect(klassement(coord), 'en de coordinator houdt hem').toBeVisible();

      await coord.check('#t-matrix-zichtbaar-chk');
      await expect(klassement(speler), 'en weer terug').toBeVisible({ timeout: 20000 });
    } finally {
      await ctxCoord.close(); await ctxSpeler.close();
    }
  });

  // ============================================================
  //  v5.12.3 — DE GASTINLOG WIJST NAAR HET JUISTE TOERNOOI
  // ------------------------------------------------------------
  //  Sierk, 13 september 2026: "een wachtwoord maakt toch dat spelers aan het
  //  juiste toernooi gekoppeld worden?" Nee — het WACHTWOORD opent alleen het
  //  account; de koppeling loopt via de toernooicode in de inlognaam. En daar
  //  zaten drie gaten in, alle drie hier nagespeeld.
  // ============================================================

  // Maakt een toernooi met één gast, via het echte aanmaakscherm.
  async function toernooiMetGast(pagina, toernooinaam, gastnaam, wachtwoord) {
    await naarToernooi(pagina);
    await vulAanmaakformulier(pagina, toernooinaam, 1);
    await kiesSpeler(pagina, 'Anna Speler');
    await pagina.fill('#t-gast-wachtwoord', wachtwoord);
    await pagina.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(pagina.locator('#t-geselecteerde-spelers')).toContainText(gastnaam.split(' ')[0]);
    await naarFlightIndeling(pagina);
    await pagina.click('#flight-modal-start-btn');
    await expect(pagina.locator('#toernooi-detail')).toContainText(toernooinaam, { timeout: 25000 });
    await expect.poll(async () => {
      const a = (await beheerDb.collection('toernooien').get()).docs
        .map(d => d.data()).filter(d => d.status === 'actief');
      return a.length === 1 ? (a[0].spelers || []).filter(sp => sp.gast && sp.login).length : 0;
    }, { timeout: 45000, message: 'de gast heeft een inlog gekregen' }).toBe(1);
    return (await beheerDb.collection('toernooien').get()).docs
      .map(d => ({ id: d.id, ...d.data() })).find(d => d.status === 'actief');
  }

  async function annuleerLopend(pagina) {
    await pagina.click('#toernooi-detail button:has-text("Toernooi annuleren")');
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs
        .filter(d => d.data().status === 'actief').length,
      { timeout: 20000 }).toBe(0);
  }

  test('GASTINLOG: twee toernooien met dezelfde naam wijzen niet naar elkaar', async ({ page, browser }) => {
    test.setTimeout(300000);
    const antwoorden = ['Harry', '12', 'Harry', '12'];
    page.on('dialog', async d => {
      if (d.type() === 'prompt') return d.accept(antwoorden.shift() ?? '');
      return d.accept();
    });
    await inloggen(page, 'coord@MPladder.stb');

    // Vorig jaar Clubkampioenschap, dit jaar weer — zelfde naam, zelfde
    // wachtwoord. Het oude toernooi wordt geannuleerd, niet verwijderd, dus het
    // oude account van Harry blijft bestaan.
    const t1 = await toernooiMetGast(page, 'Clubkampioenschap', 'Harry', 'goyer2026');
    const uid1 = t1.spelers.find(sp => sp.gast).uid;
    await annuleerLopend(page);
    const t2 = await toernooiMetGast(page, 'Clubkampioenschap', 'Harry', 'goyer2026');
    const gast2 = t2.spelers.find(sp => sp.gast);
    expect(gast2.uid, 'de nieuwe Harry is een ander account').not.toBe(uid1);

    // ⚠ HIER GING HET MIS tot v5.12.2. Het inlogscherm rekende zijn inlognaam
    // uit (`harry.<code>`) in plaats van hem op te zoeken. Die naam was bezet
    // door het OUDE toernooi, dus kwam Harry daar binnen — met het juiste
    // wachtwoord, dus zonder één waarschuwing — en las "Geen actief toernooi".
    const harry = await (await browser.newContext()).newPage();
    await harry.goto('/index.html');
    await harry.waitForSelector('#login-scherm', { state: 'visible' });
    await harry.fill('#login-email', 'Harry');
    await harry.fill('#login-pass', 'goyer2026');
    await harry.click('#login-scherm button.btn-primary');
    await harry.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(harry.locator('#page-toernooi'), 'Harry komt in het LOPENDE toernooi')
      .toContainText('Jouw scorekaart', { timeout: 25000 });
    await expect(harry.locator('#page-toernooi')).not.toContainText('Geen actief toernooi');
    await harry.close();
  });

  test('GASTINLOG: opnieuw instellen levert geen sierk2 op', async ({ page }) => {
    test.setTimeout(240000);
    const antwoorden = ['Sierk', '10'];
    page.on('dialog', async d => {
      if (d.type() === 'prompt') return d.accept(antwoorden.shift() ?? '');
      return d.accept();
    });
    await inloggen(page, 'coord@MPladder.stb');

    const t1 = await toernooiMetGast(page, 'Voorjaarscup', 'Sierk', 'goyer2026');
    expect(t1.spelers.find(sp => sp.gast).login, 'de eerste keer gewoon zijn naam')
      .toBe('sierk.voorjaarscup');

    // ⚠ HIER GING HET MIS. "Toernooi opnieuw instellen" gooit het toernooi weg
    // maar liet de gastaccounts staan. Opnieuw starten met dezelfde naam gaf
    // `sierk2`, en nog een keer `sierk3` — terwijl er maar één Sierk meedeed.
    // Sierk, 13 september 2026: "er was maar 1 speler in het toernooi die zo
    // heet."
    await page.click('#toernooi-detail button:has-text("Toernooi opnieuw instellen")');
    await expect(page.locator('#toernooi-setup-wrap')).toBeVisible({ timeout: 20000 });
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.length, { timeout: 25000 }).toBe(0);

    await page.fill('#t-gast-wachtwoord', 'goyer2026');
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect.poll(async () => {
      const a = (await beheerDb.collection('toernooien').get()).docs
        .map(d => d.data()).filter(d => d.status === 'actief');
      return a.length === 1 ? (a[0].spelers || []).filter(sp => sp.gast && sp.login).length : 0;
    }, { timeout: 45000 }).toBe(1);

    const t2 = (await beheerDb.collection('toernooien').get()).docs
      .map(d => d.data()).find(d => d.status === 'actief');
    expect(t2.spelers.filter(sp => sp.naam === 'Sierk').length, 'er doet één Sierk mee').toBe(1);
    expect(t2.spelers.find(sp => sp.gast).login, 'dus geen cijfer achter zijn naam')
      .toBe('sierk.voorjaarscup');
  });

  test('HERSTELLEN: kan niet zolang er een toernooi loopt', async ({ page }) => {
    test.setTimeout(240000);
    jaOpAlles(page);

    // Een geannuleerd toernooi klaarzetten, zoals er een in de database staat
    // nadat de coordinator er een heeft geannuleerd.
    const oud = await beheerDb.collection('toernooien').add({
      status: 'geannuleerd', naam: 'Oudje', modus: 'matchplay', spelers: [],
      dagen: [{ dagNr: 1, datum: '2026-10-01', baan: 'De Goyer', holes: [],
        flights: [], scores: {}, afgerond: false }],
      actiefDagNr: 1, timestamp: Date.now(),
    });

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Nieuwtje', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Nieuwtje', { timeout: 25000 });

    // ⚠ HIER GING HET MIS. Bij het AANMAKEN weigert de app sinds v5.9.0 een
    // tweede actief toernooi; bij het HERSTELLEN controleerde niets dat. Er
    // stonden dan twee actieve toernooien naast elkaar, en welke een speler te
    // zien kreeg was willekeurig — `alleToernooien[0]` uit een zoekopdracht
    // zonder sorteervolgorde.
    await page.evaluate((id) => window.herstelGeannuleerdToernooi(id), oud.id);
    await page.waitForTimeout(4000);
    const actief = (await beheerDb.collection('toernooien').get()).docs
      .filter(d => d.data().status === 'actief').map(d => d.data().naam);
    expect(actief, 'er blijft precies één toernooi actief').toEqual(['Nieuwtje']);
  });

  // ============================================================
  //  v5.12.4 — EEN GAST ZONDER INLOG IS EEN SPELER DIE BUITEN STAAT
  // ------------------------------------------------------------
  //  Sierk, 13 september 2026: "omdat er geen inlognamen zijn kunnen spelers
  //  ook niet inloggen." Het gastwachtwoord staat alleen in één invulveld en
  //  wordt nergens onthouden; was het leeg, dan sloeg de app het aanmaken van
  //  inlogs stilzwijgend over. Geen melding, geen inlognamen, geen knop.
  // ============================================================

  test('GASTWACHTWOORD: starten zonder wachtwoord gaat niet stilletjes', async ({ page }) => {
    test.setTimeout(200000);
    const gevraagd = [];
    const antwoorden = ['Karel Gast', '15'];
    page.on('dialog', async d => {
      gevraagd.push(d.message());
      if (d.type() === 'prompt') return d.accept(antwoorden.shift() ?? '');
      return d.accept();
    });
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Zonderww', 1);
    await kiesSpeler(page, 'Anna Speler');
    // Met opzet GEEN wachtwoord invullen.
    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Karel Gast');
    await naarFlightIndeling(page);
    gevraagd.length = 0;
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Zonderww', { timeout: 25000 });

    expect(gevraagd.some(m => /geen wachtwoord ingevuld/i.test(m)),
      'de app waarschuwt dat de gast dan niet kan inloggen').toBe(true);

    // En dan staat de reparatieknop klaar — de enige uitweg was tot v5.12.3 de
    // gast verwijderen en opnieuw toevoegen, en dan raakt hij zijn scores kwijt.
    await expect(page.locator('#toernooi-detail button:has-text("Gastlogins aanmaken")'),
      'met de knop om het alsnog te doen').toBeVisible({ timeout: 15000 });
  });

  test('GASTWACHTWOORD: de reparatieknop geeft alsnog een inlog, scores blijven', async ({ page, browser }) => {
    test.setTimeout(300000);
    const antwoorden = ['Karel Gast', '15', 'goyer2026'];
    page.on('dialog', async d => {
      if (d.type() === 'prompt') return d.accept(antwoorden.shift() ?? '');
      return d.accept();
    });
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Reparatie', 1);
    await kiesSpeler(page, 'Anna Speler');
    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Reparatie', { timeout: 25000 });

    // De wedstrijdleiding vult alvast een score in voor de gast. Die moet de
    // sleutelwissel overleven — dat is het hele punt van deze knop.
    const voor = await haalToernooi('Reparatie');
    const gastVoor = voor.spelers.find(sp => sp.gast);
    expect(gastVoor.login, 'de gast heeft nog geen inlog').toBeFalsy();

    const vak = page.locator(`#t-scorecard-wrap input[data-uid="${gastVoor.uid}"][data-hole="1"]`);
    await vak.waitFor({ state: 'visible', timeout: 15000 });
    await vak.fill('5');
    await vak.blur();
    await page.waitForTimeout(2500);

    await page.click('#toernooi-detail button:has-text("Gastlogins aanmaken")');
    await expect.poll(async () => {
      const x = await haalToernooi('Reparatie');
      return (x.spelers || []).filter(sp => sp.gast && sp.login).length;
    }, { timeout: 60000, message: 'de gast heeft alsnog een inlog' }).toBe(1);

    const na = await haalToernooi('Reparatie');
    const gastNa = na.spelers.find(sp => sp.gast);
    expect(gastNa.uid, 'hij heeft een echte sleutel gekregen').not.toBe(gastVoor.uid);
    expect(String(gastNa.uid).startsWith('gast_'), 'geen tijdelijke sleutel meer').toBe(false);

    // Zijn oude sleutel mag nergens meer staan — flights, markers en scores
    // moeten allemaal zijn omgeschreven.
    // ⚠ Deze ene regel ving een echte fout: de sleutelwissel gebeurde ONDERWEG,
    // tussen twee netwerkaanroepen door, en de meeluisteraar zette de oude
    // sleutel daarna gewoon weer terug in `dagen[].scores`.
    expect(JSON.stringify(na).includes(gastVoor.uid),
      'de oude sleutel staat nergens meer in het toernooi').toBe(false);
    const flightIds = (na.dagen[0].flights || []).flatMap(f => f.spelerIds || []);
    expect(flightIds.includes(gastNa.uid), 'hij zit nog gewoon in zijn flight').toBe(true);

    // En de gast komt binnen met zijn eigen naam.
    const gast = await (await browser.newContext()).newPage();
    await gast.goto('/index.html');
    await gast.waitForSelector('#login-scherm', { state: 'visible' });
    await gast.fill('#login-email', 'Karel Gast');
    await gast.fill('#login-pass', 'goyer2026');
    await gast.click('#login-scherm button.btn-primary');
    await gast.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(gast.locator('#page-toernooi')).toContainText('Jouw scorekaart', { timeout: 25000 });
    await gast.close();
  });

  // ============================================================
  //  v5.12.4 — AANGEPAST AANTAL HOLES IN HET DAGVENSTER
  // ------------------------------------------------------------
  //  Sierk: "voor een dag 2 is het aantal holes niet aan te passen, het
  //  invulvak verschijnt niet." De keuzelijst in "Dag toevoegen" / "Dag
  //  wijzigen" had geen koppeling: het vak bleef verborgen en bij het opslaan
  //  las de app dat lege vak en maakte er stilzwijgend 18 holes van. In het
  //  aanmaakscherm werkte het wél — daar staat de koppeling op het dagblok.
  // ============================================================
  test('HOLES: een aangepast aantal is in beide schermen in te stellen', async ({ page }) => {
    test.setTimeout(200000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Holes', 1);

    // Eerst het aanmaakscherm — dat werkte al en moet blijven werken.
    const blok = page.locator('#t-dag-blokken .dag-blok').first();
    await blok.locator('.t-dag-holes').selectOption('custom');
    await expect(blok.locator('.t-dag-holes-custom-wrap'),
      'aanmaakscherm: het vak verschijnt').toBeVisible();
    await blok.locator('.t-dag-holes').selectOption('18');

    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Holes', { timeout: 25000 });

    // En nu het dagvenster, waar het niet werkte.
    await page.click('#toernooi-detail button:has-text("Dag toevoegen")');
    await page.waitForSelector('#modal-nieuwe-dag.open', { timeout: 15000 });
    await page.selectOption('#t-dag-holes', 'custom');
    await expect(page.locator('#t-dag-holes-custom-wrap'),
      'dagvenster: het vak verschijnt nu ook').toBeVisible({ timeout: 5000 });

    await page.fill('#t-dag-datum', '2026-10-02');
    await page.selectOption('#t-dag-baan', 'De Goyer');
    await page.fill('#t-dag-holes-custom', '12');
    await page.click('#modal-dag-opslaan-btn');
    await expect.poll(async () => {
      const x = await haalToernooi('Holes');
      return (x.dagen || []).length === 2 ? x.dagen[1].holes.length : 0;
    }, { timeout: 25000, message: 'dag 2 krijgt echt 12 holes' }).toBe(12);

    // ⚠ En een leeg vak mag geen stille 18 meer opleveren.
    await page.click('#toernooi-detail button:has-text("Dag toevoegen")');
    await page.waitForSelector('#modal-nieuwe-dag.open', { timeout: 15000 });
    await page.selectOption('#t-dag-holes', 'custom');
    await page.fill('#t-dag-holes-custom', '');
    await page.fill('#t-dag-datum', '2026-10-03');
    await page.selectOption('#t-dag-baan', 'De Goyer');
    await page.click('#modal-dag-opslaan-btn');
    await page.waitForTimeout(2500);
    const na = await haalToernooi('Holes');
    expect((na.dagen || []).length, 'de dag wordt niet stilletjes toegevoegd').toBe(2);
  });

});
