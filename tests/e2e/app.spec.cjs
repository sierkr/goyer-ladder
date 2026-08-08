// ============================================================
//  Laag 4 — Browsertests met een echte browser en echte database
// ============================================================
//  Deze tests dekken wat de rekentests per definitie niet kunnen zien: de
//  opstartvolgorde van listeners, de renderlaag, en twee gebruikers die
//  tegelijk werken. De eerste test is letterlijk de fout van v5.3.0 — een
//  speler die voor het eerst inlogde zag alle spelers op rang 0.
// ============================================================
const { test, expect } = require('@playwright/test');

const WACHTWOORD = 'test1234';
// v5.4.3: de inlogknop op EEN plek. Niet op tekst zoeken: in #login-scherm
// staan twee knoppen met het woord Inloggen erin ('Inloggen met Google',
// verborgen, en 'Inloggen ->'). Playwright werkt in strict mode en weigert
// dan te klikken ('resolved to 2 elements'), waardoor elke test die inlogt
// omvalt nog voordat er iets getest is. btn-primary komt precies een keer
// voor in het loginscherm.
const klikInloggen = (page) => page.click('#login-scherm button.btn-primary');

const inloggen = async (page, login) => {
  await page.goto('/index.html');
  await page.waitForSelector('#login-scherm', { state: 'visible' });
  await page.fill('#login-email', login);
  await page.fill('#login-pass', WACHTWOORD);
  await klikInloggen(page);
};

// Wacht tot de ladderlijst gevuld is met echte rangen.
const ladderRijen = (page) => page.locator('#ladder-list-mp .ladder-rij, #ladder-list-mp > div');

test.describe('Inloggen en ladderstand', () => {

  test('bestaande speler ziet de echte ladderstand', async ({ page }) => {
    await inloggen(page, 'anna');
    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
    const lijst = page.locator('#ladder-list-mp');
    await expect(lijst).toBeVisible();
    // De stand mag niet blijven hangen op "wordt geladen".
    await expect(lijst).not.toContainText('wordt opgehaald', { timeout: 20000 });
    // En zeker niet iedereen op rang 0.
    await expect(lijst).toContainText('Coen Coordinator');
    const tekst = await lijst.innerText();
    expect(tekst).not.toMatch(/^0\s/m);
  });

  test('EERSTE LOGIN toont de ladderstand (regressie v5.3.1)', async ({ page }) => {
    // Nina heeft eersteLogin:true. In v5.3.0 startte de standen-listener bij
    // dit scenario niet, waardoor iedereen op rang 0 verscheen.
    await inloggen(page, 'nieuw');

    // De verplichte profielflow: handicap en nieuw wachtwoord kiezen.
    const hcpVeld = page.locator('#eerste-login-hcp, #profiel-hcp, input[type=number]').first();
    if (await hcpVeld.isVisible().catch(() => false)) {
      await hcpVeld.fill('18');
      const wwVelden = page.locator('input[type=password]:visible');
      const aantal = await wwVelden.count();
      for (let i = 0; i < aantal; i++) await wwVelden.nth(i).fill('nieuw12345');
      await page.locator('button:has-text("Opslaan"), button:has-text("Bevestig"), button:has-text("Voltooi")')
        .first().click();
    }

    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 25000 });
    const lijst = page.locator('#ladder-list-mp');
    await expect(lijst).not.toContainText('wordt opgehaald', { timeout: 25000 });
    await expect(lijst).toContainText('Coen Coordinator', { timeout: 25000 });

    // Kern van de regressie: er moet een rang groter dan 0 staan.
    const tekst = await lijst.innerText();
    const rangen = [...tekst.matchAll(/(?:^|\n)\s*(\d+)\s/g)].map(m => Number(m[1]));
    expect(rangen.length).toBeGreaterThan(0);
    expect(Math.max(...rangen)).toBeGreaterThan(0);
    expect(rangen.every(r => r === 0)).toBe(false);
  });

  test('lege ladderstand biedt een werkende knop, geen "ververs de pagina"', async ({ page }) => {
    // In de app op het beginscherm van een telefoon is er geen adresbalk en
    // dus geen verversknop. De app moet het zelf kunnen oplossen.
    await inloggen(page, 'anna');
    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
    const body = await page.locator('body').innerText();
    expect(body.toLowerCase()).not.toContain('ververs de pagina');
    expect(body.toLowerCase()).not.toContain('herlaad de pagina');
  });

  test('verkeerd wachtwoord geeft een foutmelding', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#login-scherm', { state: 'visible' });
    await page.fill('#login-email', 'anna');
    await page.fill('#login-pass', 'fout-wachtwoord');
    await klikInloggen(page);
    await expect(page.locator('#login-fout')).not.toBeEmpty({ timeout: 15000 });
    await expect(page.locator('#login-scherm')).toBeVisible();
  });

  test('geen JavaScript-fouten tijdens het laden', async ({ page }) => {
    const fouten = [];
    page.on('pageerror', e => fouten.push(e.message));
    page.on('console', m => { if (m.type() === 'error') fouten.push(m.text()); });
    await inloggen(page, 'anna');
    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
    await page.waitForTimeout(3000);
    // reCAPTCHA/App Check meldingen horen er niet te zijn op localhost.
    const echt = fouten.filter(f => !/favicon|net::ERR_/i.test(f));
    expect(echt, `Fouten in de console:\n${echt.join('\n')}`).toHaveLength(0);
  });
});

test.describe('Partij en scores', () => {

  test('partij starten en scores invoeren blijft bewaard na herladen', async ({ page }) => {
    await inloggen(page, 'anna');
    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });

    await page.click('#nav-partij-btn');
    await expect(page.locator('#page-partij')).toHaveClass(/active/);

    // Tegenstander kiezen in het eerste vrije slot en de partij starten.
    await page.selectOption('#partij-ladder-select', 'mp').catch(() => {});
    await page.selectOption('#baan-select', { index: 1 }).catch(() => {});
    const slot = page.locator('#player-slots #slot-2 input, #player-slots #slot-2 select').first();
    if (await slot.isVisible().catch(() => false)) {
      await slot.click();
      await page.keyboard.type('Bram');
      await page.locator('text=Bram Speler').first().click().catch(() => {});
    }
    await page.locator('button:has-text("Partij starten")').first().click();

    await expect(page.locator('#page-ronde')).toHaveClass(/active/, { timeout: 20000 });

    // Score voor hole 1 invullen.
    const eersteScore = page.locator('#scorecard-body input[type=number]').first();
    await eersteScore.fill('4');
    await eersteScore.blur();
    await page.waitForTimeout(2000);

    await page.reload();
    // v5.4.3: .first() erbij - deze selector past op twee elementen en dat is
    // in strict mode ook een fout. Het gaat er hier alleen om dat de app na
    // het herladen weer een pagina toont.
    await expect(page.locator('#page-ronde, #page-ladder').first())
      .toBeVisible({ timeout: 20000 });
    await page.click('#nav-ronde-btn');
    const naHerladen = page.locator('#scorecard-body input[type=number]').first();
    await expect(naHerladen).toHaveValue('4', { timeout: 20000 });
  });

  test('twee spelers scoren tegelijk zonder elkaar te overschrijven', async ({ browser }) => {
    // Dit is de kern van de omzetting in v5.0.0: scores staan per speler in
    // een eigen document, dus gelijktijdig invoeren mag niets wissen.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const paginaA = await ctxA.newPage();
    const paginaB = await ctxB.newPage();

    await inloggen(paginaA, 'anna');
    await inloggen(paginaB, 'bram');
    await expect(paginaA.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
    await expect(paginaB.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });

    await paginaA.click('#nav-ronde-btn');
    await paginaB.click('#nav-ronde-btn');

    const invoerA = paginaA.locator('#scorecard-body input[type=number]');
    const invoerB = paginaB.locator('#scorecard-body input[type=number]');

    if (await invoerA.count() > 0 && await invoerB.count() > 0) {
      await invoerA.nth(0).fill('4');
      await invoerB.nth(1).fill('5');
      await paginaA.waitForTimeout(2500);
      await paginaB.waitForTimeout(2500);

      await paginaA.reload();
      await paginaA.click('#nav-ronde-btn');
      const naA = paginaA.locator('#scorecard-body input[type=number]');
      await expect(naA.nth(0)).toHaveValue('4', { timeout: 20000 });
      await expect(naA.nth(1)).toHaveValue('5', { timeout: 20000 });
    }

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('Beheer', () => {

  test('coordinator ziet de beheertabbladen, speler niet', async ({ browser }) => {
    // v5.4.4: twee gescheiden browsersessies in plaats van uitloggen halverwege.
    //
    // WAT ER MIS WAS: de test logde in als Anna, laadde de pagina opnieuw en
    // wiste localStorage. Maar de app bewaart de inlogsessie bewust in
    // IndexedDB (zie setPersistence in config.js, zodat de PWA op een telefoon
    // ingelogd blijft). localStorage wissen raakt die dus niet: Anna bleef
    // ingelogd, het inlogscherm verscheen nooit meer en de test wachtte zich
    // dood op een scherm dat niet meer kwam — vandaar de 32 seconden.
    //
    // Een verse context heeft een eigen, lege opslag. Dat is meteen eerlijker:
    // zo test dit ook echt twee verschillende gebruikers.
    const ctxSpeler = await browser.newContext();
    const ctxCoord  = await browser.newContext();
    try {
      const speler = await ctxSpeler.newPage();
      await inloggen(speler, 'anna');
      await expect(speler.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
      await expect(speler.locator('#nav-admin-btn')).toBeHidden();

      const coord = await ctxCoord.newPage();
      await inloggen(coord, 'coord');
      await expect(coord.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
      await expect(coord.locator('#nav-toernooi-btn')).toBeVisible({ timeout: 20000 });
    } finally {
      await ctxSpeler.close();
      await ctxCoord.close();
    }
  });

  test('watch-scherm vraagt om een zescijferige PIN', async ({ page }) => {
    await page.goto('/watch.html');
    await expect(page.locator('#scherm-pin')).toBeVisible();
    await expect(page.locator('.pin-dot')).toHaveCount(6);
    await expect(page.locator('body')).toContainText('6-cijferige');
  });
});

test.describe('Opstarten blijft overeind', () => {

  // v5.4.4 — regressietest voor de fout die de browsertests zelf blootlegden.
  //
  // Het opstarten laadde een reeks documenten achter elkaar in één blok. Ging er
  // één mis, dan werd alles daarna overgeslagen: de UI-stijl, het archief, de
  // uitdagingen, DE BANEN en de ladders. `ladder/config` was daarbij de meest
  // waarschijnlijke struikelaar, want dat document mag volgens de
  // beveiligingsregels alleen een beheerder lezen.
  //
  // Deze test haalt dat document expliciet weg en controleert dat de app het
  // gewoon uitzingt. Het document wordt daarna altijd teruggezet.
  test('ontbrekende ladder/config sloopt ladder en banen niet', async ({ page }) => {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-goyer' });
    const ref = admin.firestore().doc('ladder/config');
    const origineel = (await ref.get()).data();

    await ref.delete();
    try {
      await inloggen(page, 'anna');
      await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });

      // De ladder moet er staan, ook zonder ladder/config.
      await expect(page.locator('#ladder-list-mp'))
        .toContainText('Coen Coordinator', { timeout: 25000 });

      // En de banenlijst moet gevuld zijn — dit is de klacht uit de praktijk:
      // een leeg uitklapmenu bij het aanmaken van een nieuwe partij.
      await page.click('#nav-partij-btn');
      await expect(page.locator('#page-partij')).toHaveClass(/active/);
      await expect(page.locator('#baan-select'))
        .toContainText('De Goyer', { timeout: 20000 });
    } finally {
      await ref.set(origineel || { initieelWachtwoord: WACHTWOORD });
    }
  });
});

