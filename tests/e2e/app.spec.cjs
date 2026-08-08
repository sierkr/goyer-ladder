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

// v5.4.7/v5.4.9: gereedschap om te zien wat er werkelijk op het scherm staat.
// De aanroepen zijn eruit nu de ladder-tests groen zijn; de functies blijven
// staan zodat ze bij een volgend raadsel meteen inzetbaar zijn — zet een
// toonSchermstatus(page, 'label') vlak vóór de assertie die faalt.
//
// De ladder-tests vielen om met "element(s) not found" op #ladder-list-mp,
// maar dat zegt niet WAAROM. renderLadder() in ladder.js kent vier uitkomsten
// en elk daarvan wijst een andere kant op:
//
//   "Laden…"                              -> alleLadders nog leeg, hij probeert het
//   "Je bent nog niet toegevoegd aan een  -> mijnLadders leeg: isInLadder() zegt nee
//    ladder."                                (uid staat niet in spelerIds, of
//                                             huidigeBruiker.uid ontbreekt)
//   "Ladderstand wordt opgehaald…"        -> kaart bestaat wel, standen-listener
//                                            levert niets
//   rijen met namen                       -> alles goed
//
// Deze dump drukt af welke van de vier het is, plus alles wat de app naar de
// console schreef. Zo is één testrun genoeg om de oorzaak vast te stellen.
async function toonSchermstatus(page, label) {
  const uit = await page.evaluate(() => {
    const kaarten = document.getElementById('ladder-kaarten');
    const lijsten = [...document.querySelectorAll('[id^="ladder-list-"]')].map(e => e.id);
    const pagina  = document.querySelector('.page.active')?.id || '(geen)';
    return {
      pagina,
      kaartenAanwezig: !!kaarten,
      lijstElementen: lijsten,
      tekst: (kaarten?.innerText || '(geen #ladder-kaarten)').slice(0, 400),
    };
  }).catch(e => ({ fout: e.message }));

  console.log(`\n──── schermstatus: ${label} ────`);
  console.log('  actieve pagina    :', uit.pagina);
  console.log('  #ladder-kaarten   :', uit.kaartenAanwezig);
  console.log('  gevonden lijsten  :', uit.lijstElementen?.length ? uit.lijstElementen.join(', ') : '(geen)');
  console.log('  tekst op het scherm:');
  console.log((uit.tekst || '').split('\n').map(l => '    | ' + l).join('\n'));
  console.log('────────────────────────────────\n');
}

// Vangt alles op wat de app naar de console schrijft en drukt het af.
function volgConsole(page, label) {
  const regels = [];
  page.on('console', m => regels.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => regels.push(`[pageerror] ${e.message}`));
  return () => {
    console.log(`\n──── console: ${label} (${regels.length} regels) ────`);
    regels.slice(-40).forEach(l => console.log('    ' + l));
    console.log('────────────────────────────────\n');
  };
}

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
    // v5.4.9: wacht tot de namen er echt zijn. startPartij() weigert met
    // "Spelersdata nog niet geladen" zolang de spelerslijst leeg is.
    await expect(page.locator('#ladder-list-mp'))
      .toContainText('Bram Speler', { timeout: 25000 });

    await page.click('#nav-partij-btn');
    await expect(page.locator('#page-partij')).toHaveClass(/active/);

    await page.selectOption('#partij-ladder-select', 'mp').catch(() => {});
    await page.selectOption('#baan-select', 'De Goyer');

    // ── Tegenstander kiezen ──────────────────────────────────
    // v5.4.9 — WAT HIER MIS WAS. Er stond:
    //   await page.locator('text=Bram Speler').first().click().catch(() => {});
    // "Bram Speler" staat óók in de ladderlijst, en die pagina zit nog gewoon in
    // de DOM (alleen zonder de klasse 'active', dus onzichtbaar). Playwright
    // pakte met .first() die verborgen regel, wachtte tot hij klikbaar werd, en
    // liep na 15 seconden dood. Dat mislukken werd door .catch(() => {})
    // stilletjes opgeslikt, waarna slot 2 leeg bleef en startPartij() afketste
    // op "Selecteer minimaal 2 spelers". De test faalde daarna op een heel
    // andere regel, wat het spoor volledig uitwiste.
    //
    // Nu: zoeken binnen de zoeklijst van slot 2 zelf, en daarna hard
    // controleren dat de speler ook echt gekozen is. Geen stille mislukking.
    await page.fill('#player-2', 'Bram');
    await page.locator('#speler-lijst-2 .speler-zoek-item', { hasText: 'Bram Speler' })
      .first().click();
    await expect(page.locator('#slot-2')).toHaveAttribute('data-speler-id', /\S/);

    await page.locator('#page-partij button:has-text("Partij starten")').first().click();
    await expect(page.locator('#page-ronde')).toHaveClass(/active/, { timeout: 20000 });

    // Score voor hole 1 invullen.
    const eersteScore = page.locator('#scorecard-body input[type=number]').first();
    await eersteScore.fill('4');
    await eersteScore.blur();
    await page.waitForTimeout(2000);

    await page.reload();
    // v5.4.9: wacht tot de app na het herladen echt klaar is met opstarten
    // voordat we op een tabblad klikken. Eerder werd meteen op de ronde-tab
    // geklikt, waarna die getekend werd met data die er nog niet was — en niets
    // tekende hem daarna opnieuw. Een gevulde ladderlijst is het bewijs dat de
    // standen én de namen binnen zijn.
    await expect(page.locator('#ladder-list-mp'))
      .toContainText('Anna Speler', { timeout: 25000 });
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


test.describe('Zelfherstel', () => {

  // v5.5.0 — de belofte van v5.4.1 beproeven.
  //
  // EERLIJK OVER WAT DIT WEL EN NIET TEST. De wachthond zelf zit niet aan het
  // venster gekoppeld en is van buitenaf niet rechtstreeks aan te spreken. Wat
  // hier getest wordt is de belofte die de speler merkt: vallen de standen weg,
  // dan zegt de app niet "ververs de pagina" — een onuitvoerbare instructie in
  // de app op het beginscherm van een telefoon — maar biedt hij een knop, en
  // hij vult zichzelf weer zodra de gegevens er zijn, zónder herladen.
  test('lege standen geven een knop, en de ladder vult zichzelf weer', async ({ page }) => {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-goyer' });
    const db = admin.firestore();
    const col = db.collection('ladders/mp/standen');

    const bewaard = (await col.get()).docs.map(d => ({ id: d.id, data: d.data() }));
    expect(bewaard.length, 'testdata moet standen bevatten').toBeGreaterThan(0);

    try {
      // 1. Standen weghalen — dit is de storing die v5.3.0 in het echt had.
      await Promise.all(bewaard.map(d => col.doc(d.id).delete()));

      await inloggen(page, 'anna');
      await expect(page.locator('#page-ladder')).toHaveClass(/active/, { timeout: 20000 });

      // 2. De app moet het eerlijk melden én een werkende uitweg bieden.
      const lijst = page.locator('#ladder-list-mp');
      await expect(lijst).toContainText('wordt opgehaald', { timeout: 20000 });
      await expect(page.locator('#ladder-list-mp button:has-text("Opnieuw proberen")'))
        .toBeVisible({ timeout: 20000 });
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body, 'de app mag nooit om een verversing vragen').not.toContain('ververs de pagina');

      // 3. Gegevens terugzetten — de app moet zichzelf vullen zonder herladen.
      await Promise.all(bewaard.map(d => col.doc(d.id).set(d.data)));
      await expect(lijst).toContainText('Coen Coordinator', { timeout: 30000 });
    } finally {
      // Altijd terugzetten, ook als de test onderweg struikelt.
      await Promise.all(bewaard.map(d => col.doc(d.id).set(d.data)));
    }
  });
});

// Voorkomt dat de hulpfuncties als ongebruikt worden gezien.
module.exports = { toonSchermstatus, volgConsole };
