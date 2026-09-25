// ============================================================
//  Laag 4 — Browsertests met een echte browser en echte database
// ============================================================
//  Deze tests dekken wat de rekentests per definitie niet kunnen zien: de
//  opstartvolgorde van listeners, de renderlaag, en twee gebruikers die
//  tegelijk werken. De eerste test is letterlijk de fout van v5.3.0 — een
//  speler die voor het eerst inlogde zag alle spelers op rang 0.
// ============================================================
const { test, expect } = require('./hulp-browser.cjs');

// v5.40.3: een directe ingang naast de app, om gastprofielen klaar te zetten
// zonder er eerst een heel toernooi of een hele ronde voor te spelen.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-goyer' });
const beheerDb = admin.firestore();

const WACHTWOORD = 'test1234';
// v5.4.3: de inlogknop op EEN plek. Niet op tekst zoeken: in #login-scherm
// staan twee knoppen met het woord Inloggen erin ('Inloggen met Google',
// verborgen, en 'Inloggen ->'). Playwright werkt in strict mode en weigert
// dan te klikken ('resolved to 2 elements'), waardoor elke test die inlogt
// omvalt nog voordat er iets getest is. btn-primary komt precies een keer
// voor in het loginscherm.
const klikInloggen = (page) => page.click('#login-knop');   // v5.38.0: eigen id

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

// ⚠ v5.11.9: SERIE. De tweede test hier scoort in de partij die de EERSTE
// start; ze delen één database. Los draaien van de tweede test kan dus niet, en
// `.serial` zegt dat hardop — bovendien slaat Playwright de rest over zodra de
// eerste omvalt, in plaats van een tweede, verwarrende fout te tonen.
test.describe.serial('Partij en scores', () => {

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

  // ============================================================
  //  v5.40.0 — DE QR-CODE VAN EEN RONDE, VAN BEGIN TOT EIND
  // ------------------------------------------------------------
  //  Sierk: "een unieke QR per ronde en scan je die dan zit je in die ronde."
  //  Deze proef loopt precies dat: een speler start een partij en opent de QR,
  //  een tweede venster gaat naar het adres uit die code (dat is wat scannen
  //  doet) en komt zonder inloggen in dezelfde ronde uit — en kan scoren.
  //
  //  ⚠ De rekentests en de regeltests kunnen dit niet zien: dit is bedrading
  //  tussen de app, een serverfunctie, het inlogtoken en de databaseregels.
  // ============================================================
  test('RONDE-QR: een gast scant en staat in dezelfde ronde', async ({ browser }) => {
    test.setTimeout(240000);
    const ctxLid = await browser.newContext();
    const lid = await ctxLid.newPage();
    try {
      // ⚠ Cees en Nina, niet Anna en Bram. Die twee zitten in de volle reeks al
      // in een partij van een eerdere proef, en dan weigert "Partij starten"
      // met "zit al in een actieve partij" — de proef viel daar eerst op om.
      await inloggen(lid, 'cees');
      await expect(lid.locator('#ladder-list-mp')).toContainText('Nina Nieuw', { timeout: 25000 });

      await lid.click('#nav-partij-btn');
      await lid.selectOption('#partij-ladder-select', 'mp').catch(() => {});
      await lid.selectOption('#baan-select', 'De Goyer');
      await lid.fill('#player-2', 'Nina');
      await lid.locator('#speler-lijst-2 .speler-zoek-item', { hasText: 'Nina Nieuw' })
        .first().click();
      await expect(lid.locator('#slot-2')).toHaveAttribute('data-speler-id', /\S/);
      await lid.locator('#page-partij button:has-text("Partij starten")').first().click();
      await expect(lid.locator('#page-ronde')).toHaveClass(/active/, { timeout: 20000 });

      // ── De QR opvragen en het adres eruit lezen ──────────────
      await lid.click('#ronde-qr-btn');
      await expect(lid.locator('#modal-ronde-qr')).toHaveClass(/open/, { timeout: 15000 });
      await expect(lid.locator('#ronde-qr-vak svg'), 'er staat een getekende code')
        .toBeVisible({ timeout: 25000 });
      const adres = (await lid.locator('#ronde-qr-adres').textContent() || '').trim();
      expect(adres, 'het adres wijst naar deze ronde').toMatch(/[?&]r=/);
      expect(adres, 'en draagt een sleutel').toMatch(/[?&]k=.{10,}/);

      // ── Het tweede venster doet wat scannen doet ─────────────
      const ctxGast = await browser.newContext();
      const gast = await ctxGast.newPage();
      await gast.goto(adres);

      // ⚠ v5.40.1 — DE ANDERE TABBLADEN MOGEN GEEN MOMENT IN BEELD KOMEN.
      //  Sierk zag ze eerst een seconde of tien staan. Gemeten voor de
      //  reparatie: het laddertabblad stond van 971 ms tot 4321 ms in beeld.
      //  Hieronder wordt dat vier seconden lang tien keer per seconde
      //  nagekeken, dwars door het inloggen heen. Eén waarneming is genoeg om
      //  deze proef te laten vallen.
      const gezien = [];
      for (let i = 0; i < 40; i++) {
        if (await gast.locator('#nav-ladder-btn').isVisible().catch(() => false)) {
          gezien.push(i * 100);
        }
        await gast.waitForTimeout(100);
      }
      expect(gezien, `het laddertabblad was zichtbaar op ${gezien.join(', ')} ms na het scannen`)
        .toEqual([]);

      // Geen inlogscherm: hij hoort meteen in de ronde te staan.
      await expect(gast.locator('#page-ronde'), 'de gast staat in de ronde')
        .toHaveClass(/active/, { timeout: 30000 });
      await expect(gast.locator('#login-scherm'), 'en heeft niets hoeven intikken')
        .not.toHaveClass(/actief/);
      await expect(gast.locator('#scorecard-body input[type=number]').first())
        .toBeVisible({ timeout: 20000 });

      // ⚠ De sleutel hoort uit de adresbalk te zijn gepoetst. Anders staat hij
      // in de geschiedenis van de telefoon en op elke schermafdruk.
      expect(gast.url(), 'de sleutel staat niet meer in de adresbalk').not.toMatch(/[?&]k=/);

      // Alleen de ronde: de rest van de app is niet van hem.
      await expect(gast.locator('#nav-ladder-btn')).toBeHidden();
      await expect(gast.locator('#nav-partij-btn')).toBeHidden();
      await expect(gast.locator('#nav-toernooi-btn')).toBeHidden();
      await expect(gast.locator('#nav-ronde-btn')).toBeVisible();
      // ⚠ v5.40.2 — WAT EEN GAST NIET HOORT TE ZIEN.
      //  Deze drie waren voor hem doodlopend: de server weigert zijn sessie bij
      //  het verwerken van een uitslag en bij de horloge-pincode, en de regels
      //  laten hem de partij niet wijzigen. Een knop die alleen een foutmelding
      //  kan geven hoort er niet te staan.
      await expect(gast.locator('#ronde-qr-btn'), 'de QR hoeft hij niet door te geven')
        .toBeHidden();
      await expect(gast.locator('#ronde-instellingen-btn'), 'geen partij-instellingen')
        .toBeHidden();
      await expect(gast.locator('#ronde-afsluiten-btn'), 'hij sluit de partij niet af')
        .toBeHidden();
      await expect(gast.locator('#ronde-watch-pin'), 'en koppelt geen horloge')
        .toBeHidden();

      // ⚠ En de andere kant, in hetzelfde venster: bij het CLUBLID staan ze er
      // wél. Zonder deze regel zou ik ze voor iedereen kunnen verbergen en zou
      // niemand het merken tot de eerste partij niet meer af te sluiten is.
      await expect(lid.locator('#ronde-instellingen-btn'), 'het lid houdt zijn instellingen')
        .toBeVisible();
      await expect(lid.locator('#ronde-afsluiten-btn'), 'en kan de partij afsluiten')
        .toBeVisible();
      await expect(lid.locator('#ronde-qr-btn'), 'en de QR-knop')
        .toBeVisible();

      // ── En hij kan scoren; dat komt bij de ander binnen ──────
      const vak = gast.locator('#scorecard-body input[type=number]').first();
      await vak.fill('6');
      await vak.blur();
      await expect(lid.locator('#scorecard-body input[type=number]').first(),
        'de score van de gast komt bij het clublid binnen').toHaveValue('6', { timeout: 25000 });

      // ⚠ HET TIJDELIJKE GASTPROFIEL MAG NERGENS OPDUIKEN.
      //  Daar gaat zoiets mis: een profiel dat in de spelerslijst belandt en
      //  daarna in het klassement staat. Het lid kijkt nu naar de ladder en
      //  naar de spelerskeuzelijst van het partijformulier.
      // Eerst het QR-venster dicht: zolang dat openstaat vangt het elke klik op.
      await lid.click('#modal-ronde-qr button:has-text("Sluiten")');
      await expect(lid.locator('#modal-ronde-qr')).not.toHaveClass(/open/, { timeout: 10000 });
      await lid.click('#nav-ladder-btn');
      await expect(lid.locator('#ladder-list-mp')).toContainText('Cees Speler', { timeout: 20000 });
      await expect(lid.locator('#ladder-list-mp'), 'geen gastprofiel in de ladderstand')
        .not.toContainText('Gast');
      await lid.click('#nav-partij-btn');
      await lid.fill('#player-2', 'Gast');
      await expect(lid.locator('#speler-lijst-2'), 'en niet in de spelerskeuzelijst')
        .not.toContainText('Gast');

      await ctxGast.close();
    } finally {
      await ctxLid.close();
    }
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

    // v5.11.9 — ⚠ TWEE DINGEN DIE DEZE TEST WISSELVALLIG MAAKTEN.
    //
    // 1. Hier stond `if (await invoerA.count() > 0 && ...)`. Stond de
    //    scorekaart nog niet op het scherm, dan deed de test NIETS en werd hij
    //    toch groen. Een test die stiekem niets meet is erger dan geen test.
    //    Nu wacht hij tot de kaart er echt is en valt hij om als dat niet zo is.
    //
    // 2. Er werd 2500 ms gewacht en daarna hard herladen. De app wacht 800 ms
    //    voordat hij een score wegschrijft, plus de tijd van het netwerk — bij
    //    een trage ronde was dat niet genoeg en verscheen er een lege kaart.
    //    Nu wordt er gewacht tot het resultaat er IS, met een paar pogingen.
    //
    // En het is bovendien realistischer geworden: speler en medespeler tikken niet
    // in dezelfde milliseconde in maar vlak na elkaar, zoals op de baan.
    await expect(invoerA.first(),
      'de partij uit de vorige test in deze serie moet lopen').toBeVisible({ timeout: 20000 });
    await expect(invoerB.first()).toBeVisible({ timeout: 20000 });
    expect(await invoerA.count(), 'de scorekaart staat er echt').toBeGreaterThan(1);

    await invoerA.nth(0).fill('4');
    await paginaA.waitForTimeout(400);      // vlak na elkaar, niet tegelijk
    await invoerB.nth(1).fill('5');

    await expect.poll(async () => {
      await paginaA.waitForTimeout(1500);   // de opslag wacht zelf 800 ms
      await paginaA.reload();
      await paginaA.click('#nav-ronde-btn');
      const n = paginaA.locator('#scorecard-body input[type=number]');
      await expect(n.first()).toBeVisible({ timeout: 20000 });
      return [await n.nth(0).inputValue(), await n.nth(1).inputValue()];
    }, { timeout: 60000, message: 'beide scores staan er na herladen nog' })
      .toEqual(['4', '5']);

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('Informatiebalk', () => {
  // ============================================================
  //  v5.11.2 — EEN MELDING DIE JE NIET KUNT LEZEN IS GEEN MELDING
  // ------------------------------------------------------------
  //  De balk stond op `white-space: nowrap` zonder maximale breedte. Korte
  //  bevestigingen pasten, maar sinds v5.9.0 noemen foutmeldingen de echte
  //  oorzaak — en die lopen dan aan beide kanten het scherm uit. Sierk zag een
  //  toernooi niet starten en kon de reden niet lezen.
  //
  //  Deze test meet het op telefoonformaat: de melding moet HOGER zijn dan één
  //  regel en helemaal BINNEN het scherm vallen.
  // ============================================================
  test('een lange foutmelding loopt door en blijft binnen het scherm', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });   // iPhone-formaat
    await inloggen(page, 'coord@MPladder.stb');

    const LANG = 'Er is iets misgegaan bij het starten van het toernooi: '
               + 'de database weigerde de schrijfactie omdat je geen coordinator bent (permission-denied).';
    await page.evaluate((m) => window.toast(m, 9000), LANG);

    const balk = page.locator('#toast');
    await expect(balk).toBeVisible();
    await expect(balk).toContainText('permission-denied');

    const maat = await balk.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { links: r.left, rechts: r.right, hoogte: r.height, breedte: window.innerWidth };
    });
    expect(maat.links, 'linkerkant valt binnen het scherm').toBeGreaterThanOrEqual(0);
    expect(maat.rechts, 'rechterkant valt binnen het scherm').toBeLessThanOrEqual(maat.breedte);
    expect(maat.hoogte, 'de tekst loopt door over meerdere regels').toBeGreaterThan(40);

    // En je hoeft de negen seconden niet uit te zitten.
    // Let op: de balk blijft in de pagina staan en wordt alleen doorzichtig
    // (klasse `show` eraf). `toBeVisible` kijkt niet naar doorzichtigheid, dus
    // dat zou hier altijd slagen — meet de klasse, en dat hij geen klikken meer
    // onderschept.
    await balk.click();
    await expect(balk).not.toHaveClass(/show/, { timeout: 5000 });
    const klikbaar = await balk.evaluate(el => getComputedStyle(el).pointerEvents);
    expect(klikbaar, 'een weggetikte balk vangt geen klikken meer af').toBe('none');
  });

  test('een korte bevestiging blijft één regel', async ({ page }) => {
    await inloggen(page, 'coord@MPladder.stb');
    await page.evaluate(() => window.toast('Opgeslagen ✓'));
    const hoogte = await page.locator('#toast').evaluate(el => el.getBoundingClientRect().height);
    expect(hoogte, 'korte meldingen zien er hetzelfde uit als altijd').toBeLessThan(45);
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

  // ============================================================
  //  v5.40.3 — GASTEN HOREN NIET IN DE LEDENLIJST
  // ------------------------------------------------------------
  //  Sierk: "Spelers die zijn aangemaakt zijn te zien in beheer, spelers. Dat
  //  is niet de bedoeling." De lijst toonde elk document uit `spelers/`.
  //
  //  ⚠ Deze proef toetst BEIDE kanten. Alleen "de gast is weg" zou ook slagen
  //  met een filter die per ongeluk halve ledenlijst opslokt, en dat merkt
  //  niemand tot er iemand gezocht wordt.
  // ============================================================
  test('BEHEER: gastaccounts staan apart en zijn op te ruimen', async ({ page }) => {
    test.setTimeout(180000);
    page.on('dialog', d => d.accept());

    // ⚠ De kaart "Spelers" in Beheer is alleen voor een BEHEERDER, en de
    // proefdatabase heeft er geen. Coen wordt hier tijdelijk verhoogd en aan
    // het eind weer teruggezet — anders erven de volgende proeven een
    // coordinator met te veel rechten.
    const coordRef = beheerDb.collection('spelers')
      .where('naam', '==', 'Coen Coordinator');
    const coordDocs = await coordRef.get();
    const coordId = coordDocs.docs[0]?.id;
    expect(coordId, 'Coen staat in de proefdatabase').toBeTruthy();
    await beheerDb.doc(`spelers/${coordId}`).update({ rol: 'beheerder' });

    try {
    await beheerDb.doc('spelers/gast_test_beheer').set({
      uid: 'gast_test_beheer', naam: 'Gerrit Gast', rol: 'speler', hcp: 0,
      email: 'gerrit.gast.proef@MPladder.stb', eersteLogin: false,
      toernooiSpeler: true, toernooiGast: true, toernooiNaam: 'Proeftoernooi',
    });
    await beheerDb.doc('spelers/rondegast_proef').set({
      uid: 'rondegast_proef', naam: 'Gast', rol: 'speler', hcp: 0,
      eersteLogin: false, rondeGast: true, partijId: 'proefpartij', ladderId: 'mp',
    });

    await inloggen(page, 'coord');
    await page.click('#nav-admin-btn');
    const kop = page.locator('#admin-sectie-spelers .card-header').first();
    await kop.click();
    const lijst = page.locator('#admin-player-list');
    await expect(lijst).toContainText('Coen Coordinator', { timeout: 25000 });

    // ── De ledenlijst zelf ───────────────────────────────────
    const ledenLijst = lijst.locator('> .admin-row');
    await expect(ledenLijst.filter({ hasText: 'Gerrit Gast' }),
      'de toernooigast staat niet tussen de leden').toHaveCount(0);
    await expect(ledenLijst.filter({ hasText: 'Anna Speler' }),
      'en een gewoon clublid staat er nog gewoon in').toHaveCount(1);

    // ── Maar ze zijn wél te vinden ───────────────────────────
    const blok = page.locator('#admin-gasten-blok');
    await expect(blok, 'er is een regel met de tijdelijke gastaccounts').toBeVisible();
    // ⚠ Niet op een exact aantal toetsen. In de volle reeks laten eerdere
    // proeven ook gastprofielen achter; dan staat er (5) in plaats van (2) en
    // valt deze proef om op iets dat niets met het beheerscherm te maken heeft.
    await expect(blok).toContainText(/Tijdelijke gastaccounts \(\d+\)/);
    await blok.locator('.card-header').click();
    await expect(blok).toContainText('Gerrit Gast');
    await expect(blok).toContainText('Proeftoernooi');
    await expect(blok.locator('button[data-gast-weg="rondegast_proef"]'),
      'de rondegast staat er ook in').toHaveCount(1);

    // ── En op te ruimen ──────────────────────────────────────
    await blok.locator('button[data-gast-weg="gast_test_beheer"]').click();
    await expect.poll(async () =>
      (await beheerDb.doc('spelers/gast_test_beheer').get()).exists,
      { timeout: 25000, message: 'het gastprofiel is opgeruimd' }).toBe(false);
    await expect.poll(async () =>
      (await beheerDb.doc('spelers/uid_speler_a_00000000000').get()).exists ||
      (await beheerDb.collection('spelers').get()).size > 3,
      { timeout: 10000, message: 'de clubleden staan er nog' }).toBe(true);

    // De rij van die ene gast is weg; de rondegast staat er nog.
    await expect(blok.locator('button[data-gast-weg="gast_test_beheer"]'),
      'de opgeruimde gast staat niet meer in de lijst').toHaveCount(0, { timeout: 25000 });
    await expect(blok.locator('button[data-gast-weg="rondegast_proef"]'),
      'en de andere gast is niet meegegaan').toHaveCount(1);
    } finally {
      await beheerDb.doc('spelers/rondegast_proef').delete().catch(() => {});
      await beheerDb.doc('spelers/gast_test_beheer').delete().catch(() => {});
      await beheerDb.doc(`spelers/${coordId}`).update({ rol: 'coordinator' });
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

// ============================================================
//  v5.35.0 — TWEE HANDLEIDINGEN EN EEN ? OP DE SCOREKAART
// ------------------------------------------------------------
//  Sierk, 16 september 2026: "help file voor beheerders en coordinatoren en
//  beknopt voor deelnemers toernooi. Dat laatste mag met een ? Op de
//  scorekaart."
//
//  Deze test controleert dat het WERKT — dat de handleidingen laden en het
//  venster opengaat. Of de TEKST klopt kan geen test; dat leest Sierk.
// ============================================================
test.describe('Handleidingen', () => {

  test('de HELP-tab heeft twee handleidingen en ze laden allebei', async ({ page }) => {
    await inloggen(page, 'coord@MPladder.stb');
    await page.click('nav button:has-text("Help")');

    const frame = page.locator('#help-frame');
    await expect(frame, 'het handleidingvenster staat er').toBeVisible({ timeout: 15000 });
    await expect(frame).toHaveAttribute('src', /handleiding-partij-ronde\.html/);
    await expect(page.frameLocator('#help-frame').locator('h1'),
      'de partijhandleiding laadt').toContainText('Partij', { timeout: 15000 });

    await page.click('#help-knop-toernooi');
    await expect(frame).toHaveAttribute('src', /handleiding-toernooi\.html/);
    await expect(page.frameLocator('#help-frame').locator('h1'),
      'de toernooihandleiding laadt').toContainText('Toernooi', { timeout: 15000 });

    // En weer terug.
    await page.click('#help-knop-partij');
    await expect(frame).toHaveAttribute('src', /handleiding-partij-ronde\.html/);
  });

});
