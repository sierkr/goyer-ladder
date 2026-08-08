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
const inloggen = async (page, login) => {
  await page.goto('/index.html');
  await page.waitForSelector('#login-scherm', { state: 'visible' });
  await page.fill('#login-email', login);
  await page.fill('#login-pass', WACHTWOORD);
  await page.click('#login-scherm button:has-text("Inloggen")');
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
    await expect(lijst).not.toContainText('wordt geladen', { timeout: 20000 });
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
    await expect(lijst).not.toContainText('wordt geladen', { timeout: 25000 });
    await expect(lijst).toContainText('Coen Coordinator', { timeout: 25000 });

    // Kern van de regressie: er moet een rang groter dan 0 staan.
    const tekst = await lijst.innerText();
    const rangen = [...tekst.matchAll(/(?:^|\n)\s*(\d+)\s/g)].map(m => Number(m[1]));
    expect(rangen.length).toBeGreaterThan(0);
    expect(Math.max(...rangen)).toBeGreaterThan(0);
    expect(rangen.every(r => r === 0)).toBe(false);
  });

  test('verkeerd wachtwoord geeft een foutmelding', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#login-scherm', { state: 'visible' });
    await page.fill('#login-email', 'anna');
    await page.fill('#login-pass', 'fout-wachtwoord');
    await page.click('#login-scherm button:has-text("Inloggen")');
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
    await expect(page.locator('#page-ronde, #page-ladder')).toBeVisible({ timeout: 20000 });
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

  test('coordinator ziet de beheertabbladen, speler niet', async ({ page }) => {
    await inloggen(page, 'anna');
    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
    await expect(page.locator('#nav-admin-btn')).toBeHidden();

    await page.goto('/index.html');
    await page.evaluate(() => window.localStorage.clear());
    await inloggen(page, 'coord');
    await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });
    await expect(page.locator('#nav-toernooi-btn')).toBeVisible({ timeout: 20000 });
  });

  test('watch-scherm vraagt om een zescijferige PIN', async ({ page }) => {
    await page.goto('/watch.html');
    await expect(page.locator('#scherm-pin')).toBeVisible();
    await expect(page.locator('.pin-dot')).toHaveCount(6);
    await expect(page.locator('body')).toContainText('6-cijferige');
  });
});
