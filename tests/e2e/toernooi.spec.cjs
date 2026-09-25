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
// v5.15.0: `klaar` is een optionele voorwaarde. Zonder die voorwaarde nam deze
// functie het EERSTE document met de juiste naam, hoe oud ook — en dan lees je
// de database op een moment dat de schrijfactie van de app er nog niet in staat.
// De schermcontroles hierboven wachten wel (toContainText polt tot 15 seconden);
// deze deed dat niet, en viel daardoor in de volle reeks om terwijl hij los
// slaagde. De app had gelijk, de test nam iets aan.
//
// ⚠ Dit verbergt niets: is de voorwaarde na alle pogingen niet waar, dan valt
// de test alsnog om — met de laatst gelezen inhoud erbij.
// v5.21.0: alle toernooien tegelijk — sinds er meerdere naast elkaar mogen
// staan (één gestart, de rest wachtend) is dat een zinvolle vraag.
async function haalAlleToernooien() {
  const snap = await beheerDb.collection('toernooien').get();
  return snap.docs.map(d => d.data());
}

async function haalToernooi(naam, pogingen = 20, klaar = null) {
  let laatste = null;
  for (let i = 0; i < pogingen; i++) {
    const snap = await beheerDb.collection('toernooien').get();
    const gevonden = snap.docs.map(d => d.data()).find(d => d.naam === naam);
    if (gevonden) {
      laatste = gevonden;
      if (!klaar || klaar(gevonden)) return gevonden;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (laatste) {
    throw new Error(`Toernooi "${naam}" bereikte de verwachte toestand niet. ` +
                    `Laatst gelezen dagen: ${JSON.stringify((laatste.dagen || []).map(d => ({ dagNr: d.dagNr, gestart: d.gestart, afgerond: d.afgerond })))}`);
  }
  const alle = (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().naam);
  throw new Error(`Toernooi "${naam}" niet in de database. Wel gevonden: ${JSON.stringify(alle)}`);
}

test.beforeEach(async () => {
  const snap = await beheerDb.collection('toernooien').get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
});

const WACHTWOORD = 'test1234';
const klikInloggen = (page) => page.click('#login-knop');   // v5.38.0: eigen id

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
  await naarSetupTab(page, 'spelers');   // v5.21.0
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
// ============================================================
//  v5.21.0 — OPSLAAN EN STARTEN ZIJN TWEE MOMENTEN
// ------------------------------------------------------------
//  Tot v5.20.0 startte dag 1 mee op het moment dat je het toernooi aanmaakte.
//  Nu wordt een toernooi opgeslagen en staat het te WACHTEN; starten doe je
//  later met ▶ Dag 1 starten. Een test die daarna wil scoren moet die knop dus
//  indrukken — net als een coordinator op de dag zelf.
async function slaToernooiOp(page) {
  await page.click('#flight-modal-start-btn');
}

async function slaOpEnStart(page, dagNr = 1) {
  await slaToernooiOp(page);
  // v5.33.1: de knop "Dag N starten" staat op het DAGtabblad. Bleef het scherm
  // op Toernooi staan — bijvoorbeeld omdat een vorige stap daarheen ging om te
  // annuleren — dan bestond die knop niet en liep de test vast.
  await naarDagTab(page, dagNr);
  const knop = page.locator(`#toernooi-detail button:has-text("Dag ${dagNr} starten")`);
  await knop.waitFor({ state: 'visible', timeout: 20000 });
  await knop.click();
  await expect(page.locator('#t-scorecard-wrap')).toBeVisible({ timeout: 20000 });
}

// v5.39.0: de balk onderaan springt niet meer vanaf élk tabblad rechtstreeks
// naar de flightindeling — hij wijst naar de VOLGENDE stap
// (Toernooi → Spelers → Dag 1 → Flight indeling). Deze helper doet wat een mens
// nu ook doet: doorklikken tot de balk op de indeling staat.
async function naarFlightIndeling(page) {
  const balk = page.locator('#t-setup-volgende');
  for (let i = 0; i < 4; i++) {
    const tekst = (await balk.textContent().catch(() => '')) || '';
    if (tekst.includes('Flight indeling')) break;
    await balk.click();
  }
  await balk.click();
  await page.waitForSelector('#modal-flight-indeling.open', { timeout: 10000 });
}

// De kaart "Nieuw Toernooi" staat standaard dichtgeklapt. Een mens klikt hem
// open; zolang dat niet gebeurt onderschept de kop alle klikken eronder.
// v5.24.0: het tabblad TOERNOOI opent op een STARTSCHERM (Nieuw toernooi ·
// Loopt nu · Concept · Oud). Het aanmaakscherm zit achter "➕ Nieuw toernooi" —
// precies zoals een coordinator het doet.
// ⚠ v5.33.1 — WAT HIER MIS WAS, en waarom de browsertests twee dagen rood
// stonden. Sinds v5.24.0 zijn er DRIE schermen (start · nieuw · detail). Staat
// er een toernooi open, dan is `#toernooi-start-wrap` verborgen en dus ook de
// knop "➕ Nieuw toernooi". Deze functie klikte die knop dan niet — `count()`
// telt ook verborgen elementen, maar de klik ging naar iets onzichtbaars — en
// wachtte daarna op een kop die per definitie verborgen bleef, want het
// aanmaakscherm stond op display:none. Vijf tests liepen daarop vast.
//
// Nu eerst terug naar het startscherm, precies zoals een coordinator doet:
// "← Toernooien" en dan "➕ Nieuw toernooi".
async function naarToernooiStart(page) {
  // v5.34.0: "← Toernooien" staat op TWEE schermen — in het lopende toernooi en
  // (sinds deze versie) ook op het aanmaakscherm. Zoek de knop die op dit moment
  // zichtbaar is, in plaats van er één plek voor aan te wijzen.
  //
  // ⚠ En hij moet tegen een hertekening kunnen. Vlak na het opslaan bouwt de app
  // het scherm opnieuw op; de knop die Playwright net gevonden had is dan weg
  // halverwege de klik ("element is not visible"). Daarom drie pogingen, en pas
  // daarna hard falen — dat verbergt niets, want het startscherm moet er komen.
  const start = page.locator('#toernooi-start-wrap');
  for (let poging = 0; poging < 3; poging++) {
    if (await start.isVisible().catch(() => false)) return;
    const terug = page.locator('button:has-text("← Toernooien"):visible').first();
    if (await terug.count()) await terug.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await expect(start, 'het startscherm van de toernooitab').toBeVisible({ timeout: 15000 });
}

async function openAanmaakscherm(page) {
  // Staat er een toernooi open? Dan eerst terug naar het overzicht.
  const setupZichtbaar = await page.locator('#toernooi-setup-wrap').isVisible().catch(() => false);
  if (!setupZichtbaar) {
    await naarToernooiStart(page);
    await page.click('#toernooi-start-wrap button:has-text("Nieuw toernooi")');
  }
  await expect(page.locator('#toernooi-setup-wrap'),
    'het aanmaakscherm').toBeVisible({ timeout: 15000 });

  // De kop is sinds v5.21.0 niet meer de ingang — de tabbladen zijn dat — maar
  // hij kan nog ingeklapt staan en vangt dan klikken af.
  const kop = page.locator('#toernooi-setup-wrap .card-header.inklapbaar').first();
  if (await kop.isVisible().catch(() => false)) {
    if (await kop.evaluate(el => el.classList.contains('ingeklapt'))) await kop.click();
    await expect(kop).not.toHaveClass(/ingeklapt/);
  }
  await naarSetupTab(page, 'toernooi');
}

// Vult het aanmaakformulier voor een toernooi van `dagen` dagen.
// v5.13.0: elke dag heeft een eigen tabblad en alleen het gekozen tabblad is
// zichtbaar. Alle dagblokken blijven wel in het scherm staan — daar rekent
// startToernooi() op — maar invullen kan pas nadat je het tabblad kiest, net
// als een coordinator dat doet.
// v5.21.0: de dagtabbladen stonden in een eigen rij binnen #t-dag-blokken.
// Ze zitten nu in de ENE rij bovenaan het aanmaakscherm (#t-setup-tabs), naast
// Toernooi en Spelers.
async function kiesSetupDag(page, dagNr) {
  const tab = page.locator(`#t-setup-tabs button[onclick="selecteerSetupDag(${dagNr})"]`);
  if (await tab.count()) await tab.click();
  await expect(page.locator(`#t-dag-blokken .dag-blok[data-dagnr="${dagNr}"]`)).toBeVisible();
}

// v5.21.0: het aanmaakscherm heeft tabbladen. Spelers kiezen kan pas als dat
// tabblad openstaat — net als bij een coordinator.
async function naarSetupTab(page, tab) {
  const knop = page.locator(`#t-setup-tabs button[onclick="selecteerSetupTab('${tab}')"]`);
  if (await knop.count()) await knop.click();
}

// ============================================================
//  v5.38.0 — INLOGGEN MET NAAM UIT DE LIJST EN EEN PINCODE
// ------------------------------------------------------------
//  Dit is sinds v5.38.0 de weg naar binnen voor een deelnemer. Het blok staat
//  er alleen als er een toernooi LOOPT, dus het wachten erop is meteen de
//  proef dat die voorwaarde klopt.
// ============================================================
async function pinInloggen(pagina, naam, pin) {
  await pagina.goto('/index.html');
  await pagina.waitForSelector('#login-scherm', { state: 'visible' });
  await pagina.waitForSelector('#toernooi-inlog', { state: 'visible', timeout: 25000 });
  await pagina.selectOption('#toernooi-inlog-speler', { label: naam });
  await pagina.fill('#toernooi-inlog-pin', pin);
  await pagina.click('#toernooi-inlog button.btn-primary');
}

// v5.13.1: de toernooibrede knoppen en schakelaars staan nu op het tabblad
// "Toernooi", naast de dagtabbladen. Een coordinator klikt daar eerst heen; de
// tests doen dat nu ook. Het tabblad is te herkennen aan selecteerDag(0).
async function naarToernooiTab(p) {
  const tab = p.locator('#toernooi-detail button[onclick="selecteerDag(0)"]');
  if (await tab.count()) await tab.click();
}

// En weer terug naar een dag: de scorekaart, de onderlinge stand en de
// dagknoppen staan daar. Een schakelaar omzetten doe je op het Toernooi-tabblad
// en daarna kijk je op de dag wat het deed — precies wat deze tests nabootsen.
async function naarDagTab(p, dagNr = 1) {
  const tab = p.locator(`#toernooi-detail button[onclick="selecteerDag(${dagNr})"]`);
  if (await tab.count()) await tab.click();
}

// v5.17.0: het venster "Spelers beheren" zat achter een knop in de kop van de
// scorekaart. Die knop is weg; het venster gaat nu open vanaf het tabblad
// Spelers. Twee klikken in plaats van één — precies wat een coordinator nu ook
// doet.
//
// ⚠ Niet zoeken op tekst: sinds dit tabblad bestaat staat het woord "Spelers"
// op DRIE knoppen (het tabblad, de knop naar het venster, en de kop van de
// kaart). Playwright weigert dan te klikken. Daarom op `onclick`, net als
// naarToernooiTab() en naarDagTab() hierboven.
// v5.34.0: na een herlaad komt een COORDINATOR sinds v5.24.0 op het startscherm
// uit — niet meer meteen in het toernooi. Een deelnemer wel. Deze helper opent
// het lopende toernooi weer, precies zoals de coordinator dat zelf doet.
async function openLopendToernooi(p) {
  const start = p.locator('#toernooi-start-wrap');
  if (!(await start.isVisible().catch(() => false))) return;
  const openen = start.locator('button:has-text("Openen")').first();
  if (await openen.isVisible().catch(() => false)) await openen.click();
  await expect(p.locator('#toernooi-detail')).toBeVisible({ timeout: 15000 });
}

async function naarSpelersTab(p) {
  const tab = p.locator('#toernooi-detail button[onclick="selecteerSpelersTab()"]');
  if (await tab.count()) await tab.click();
}

async function openSpelersBeheer(p) {
  await naarSpelersTab(p);
  await p.click('#toernooi-detail button[onclick="openToernooiSpelersBeheer()"]');
}

async function vulAanmaakformulier(page, naam, dagen = 1) {
  await openAanmaakscherm(page);
  await naarSetupTab(page, 'toernooi');   // v5.21.0: de naam staat daar
  await page.fill('#t-naam', naam);
  // v5.21.0: "Aantal dagen" bestaat niet meer. Een dag erbij doe je met
  // + Dag toevoegen, precies zoals bij een opgeslagen toernooi.
  for (let d = 1; d < dagen; d++) {
    await page.click('#t-setup-tabs button[onclick="voegSetupDagToe()"]');
  }
  const blokken = page.locator('#t-dag-blokken .dag-blok');
  await expect(blokken).toHaveCount(dagen);
  for (let i = 0; i < dagen; i++) {
    await kiesSetupDag(page, i + 1);
    const blok = page.locator(`#t-dag-blokken .dag-blok[data-dagnr="${i + 1}"]`);
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
    // v5.16.0: de knop heet nu "⇄ Verdelen" — hij verdeelt zoals je in de
    // keuzelijst ernaast kiest, en "gelijk" is daar maar één van.
    await page.click('button:has-text("Verdelen")');

    // GEEN LEGE FLIGHT (fout 1 van 11-9-2026): na verdelen zit in elke flight
    // iemand. Voorheen bleef flight 1 leeg achter en toonde de scorekaart
    // holes zonder spelerskolommen.
    const leegWaarschuwing = page.locator('#flight-lijst >> text=leeg');
    await expect(leegWaarschuwing).toHaveCount(0);

    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
    await expect(page.locator('#modal-flight-indeling')).not.toHaveClass(/open/, { timeout: 15000 });

    // ── 3. Het toernooi draait ───────────────────────────────
    await expect(page.locator('#toernooi-actief-wrap')).toBeVisible();
    await expect(page.locator('#toernooi-detail')).toContainText('Repetitie');
    await expect(page.locator('#toernooi-detail')).toContainText('4 spelers');
    await expect(page.locator('#toernooi-detail')).toContainText('2 flights');

    // AANMAAKFORMULIER OPGEBORGEN (fout 3 van 11-9-2026): naast een lopend
    // toernooi hoort geen leeg aanmaakformulier met "Nog geen deelnemers
    // geselecteerd" — Sierk las dat als een leeg toernooi.
    // v5.24.0: dat is nu een gevolg van de schermindeling: je bent IN een
    // toernooi, en het aanmaakscherm woont achter "➕ Nieuw toernooi" op het
    // startscherm. De drie losse knoppen die dit vroeger regelden bestaan niet
    // meer.
    await expect(page.locator('#toernooi-setup-wrap')).toBeHidden();
    await expect(page.locator('#toernooi-start-wrap')).toBeHidden();
    await naarToernooiStart(page);
    await expect(page.locator('#toernooi-start-wrap'),
      'het startscherm toont het lopende toernooi').toContainText('Loopt nu');

    expect(fouten, 'geen JavaScript-fouten tijdens de hele route').toEqual([]);
  });

  // ============================================================
  //  v5.11.0 / v5.43.0 — DRIE MENSEN TEGELIJK AAN ÉÉN KAART
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
  //
  //  ⚠ v5.43.0 — DE VASTE MARKER IS WEG. Tot v5.42.0 mocht je in precies één
  //  kolom van een medespeler typen, de kolom die de app je had toegewezen.
  //  Sierk, 25 september 2026: in de praktijk pakt iemand de kaart op en vult
  //  hij hem voor de hele flight in. Blok 3 bewaakt dat nu, en blok 7b bewaakt
  //  het gevolg: twee mensen in dezelfde kolom mogen elkaars holes niet wissen.
  // ============================================================
  test('KAARTCONTROLE: speler, medespeler en wedstrijdleiding tegelijk aan één kaart', async ({ browser }) => {
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
    const ctxMede   = await browser.newContext();
    const ctxDerde  = await browser.newContext();
    try {
      // ── 1. De wedstrijdleiding zet een toernooi van één flight op ──
      const coord = await ctxCoord.newPage();
      jaOpAlles(coord);
      await inloggen(coord, 'coord@MPladder.stb');
      await naarToernooi(coord);
      await vulAanmaakformulier(coord, 'Kaartcontrole', 1);
      for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(coord, n);
      await naarFlightIndeling(coord);
      await slaOpEnStart(coord);   // v5.21.0: opslaan én dag 1 starten
      await expect(coord.locator('#toernooi-detail')).toContainText('Kaartcontrole', { timeout: 15000 });

      // ── 2. De flight staat vast, een markerindeling niet meer ──
      const t   = await haalToernooi('Kaartcontrole');
      const ids = t.dagen[0].flights[0].spelerIds;
      expect(ids.length, 'drie spelers in één flight').toBe(3);
      // ⚠ v5.43.0: hier stond de markerkring. Die wordt niet meer geschreven.
      // Staat hij er tóch, dan is er ergens oude logica teruggekropen.
      expect(t.dagen[0].flights[0].markers,
        'er wordt geen markerindeling meer weggeschreven').toBeUndefined();

      // We volgen de tweede speler; de eerste en de derde houden zijn kaart bij.
      const naamVan = (uid) => t.spelers.find(s => s.uid === uid).naam.split(' ')[0].toLowerCase();
      const uidSpeler = ids[1];
      const uidMede   = ids[0];
      const uidDerde  = ids[2];

      const speler = await ctxSpeler.newPage();
      const mede   = await ctxMede.newPage();
      const derde  = await ctxDerde.newPage();
      jaOpAlles(speler); jaOpAlles(mede); jaOpAlles(derde);
      await inloggen(speler, `${naamVan(uidSpeler)}@MPladder.stb`);
      await inloggen(mede,   `${naamVan(uidMede)}@MPladder.stb`);
      await inloggen(derde,  `${naamVan(uidDerde)}@MPladder.stb`);
      await naarToernooi(speler);
      await naarToernooi(mede);
      await naarToernooi(derde);

      // ── 3. Wie mag waar typen ────────────────────────────────
      // ⚠ v5.43.0 — DIT IS DE WIJZIGING. Elk van de drie mag in elk van de drie
      // kolommen van zijn eigen flight typen. Tot v5.42.0 waren dat er twee: je
      // eigen kolom en die van de ene speler die je was toegewezen.
      const magTypen = (pagina, uid) => pagina.locator(`#t-scorecard-wrap input[data-uid="${uid}"]`).count();
      for (const uid of ids) {
        expect(await magTypen(speler, uid),
          `de speler mag in de kolom van ${naamVan(uid)}`).toBeGreaterThan(0);
        expect(await magTypen(mede, uid),
          `de medespeler mag in de kolom van ${naamVan(uid)}`).toBeGreaterThan(0);
        expect(await magTypen(derde, uid),
          `de derde mag in de kolom van ${naamVan(uid)}`).toBeGreaterThan(0);
      }
      expect(await magTypen(coord, uidDerde), 'de wedstrijdleiding mag overal').toBeGreaterThan(0);

      // v5.11.8: en ZIEN doet hij ze ook allemaal. Daar stonden puntjes.
      // Sierk: "de scores van je flightgenoten moet je wel kunnen zien."
      // De wedstrijdleiding stelt hier hole 3 van de derde vast; dat zet die
      // hole op slot, dus hij staat bij de speler als tekst en niet als vakje.
      await coord.evaluate(({ uid }) => window.updateTScore(uid, 2, 7), { uid: uidDerde });
      await expect.poll(() => speler.evaluate(({ uid }) =>
        document.querySelector(`#t-scorecard-wrap [data-uid="${uid}"][data-hole="2"]`)?.textContent?.trim(),
        { uid: uidDerde }), { timeout: 20000, message: 'de score van een flightgenoot is te zien' })
        .toBe('7');
      expect(await speler.locator(`#t-scorecard-wrap [data-uid="${uidDerde}"]`).count(),
        'de hele kolom staat er, niet als puntjes').toBeGreaterThan(1);

      // ── 4. De speler vult in: oranje, want de flight moet nog ──
      await speler.evaluate(({ uid }) => window.updateTScore(uid, 0, 5), { uid: uidSpeler });
      await wachtOpKleur(speler, uidSpeler, 0, 'oranje');
      await wachtOpKleur(coord,  uidSpeler, 0, 'oranje');
      await expect(coord.locator('#t-kaart-waarschuwing')).toContainText('wacht', { timeout: 20000 });

      // ── 5. Een medespeler vult iets ANDERS in: rood, bij alle drie ──
      await mede.evaluate(({ uid }) => window.updateTScore(uid, 0, 6), { uid: uidSpeler });
      await wachtOpKleur(mede, uidSpeler, 0, 'rood');
      await wachtOpKleur(speler, uidSpeler, 0, 'rood');
      await wachtOpKleur(coord,  uidSpeler, 0, 'rood');
      await expect(speler.locator('#t-kaart-waarschuwing')).toContainText('verschil', { timeout: 20000 });

      // Ieder ziet zijn EIGEN getal — niemand dat van de ander.
      const getalIn = (pagina, uid, hole) => pagina.evaluate(({ uid, hole }) =>
        document.querySelector(`#t-scorecard-wrap [data-uid="${uid}"][data-hole="${hole}"]`)?.value,
        { uid, hole });
      expect(await getalIn(speler, uidSpeler, 0), 'de speler ziet zijn eigen 5').toBe('5');
      expect(await getalIn(mede, uidSpeler, 0), 'de medespeler ziet zijn eigen 6').toBe('6');

      // ── 6. Zolang het rood is, gaat de uitslag niet open ──────
      await expect(coord.locator('#t-uitslag-btn')).toContainText('uitpraten', { timeout: 20000 });
      await expect(coord.locator('#t-uitslag-btn')).toBeDisabled();

      // ── 7. Ze praten het uit: de medespeler past aan → zwart ──
      await mede.evaluate(({ uid }) => window.updateTScore(uid, 0, 5), { uid: uidSpeler });
      await wachtOpKleur(speler, uidSpeler, 0, 'zwart');
      await wachtOpKleur(coord,  uidSpeler, 0, 'zwart');
      await expect(coord.locator('#t-uitslag-btn')).not.toContainText('uitpraten', { timeout: 20000 });
      await expect(coord.locator('#t-kaart-waarschuwing')).not.toContainText('verschil', { timeout: 20000 });

      // ── 7b. Een TWEEDE medespeler in dezelfde kolom ───────────
      //  ⚠ v5.43.0 — HET GEVOLG VAN DE WIJZIGING. Nu de hele flight in dezelfde
      //  kolom mag typen, kunnen twee mensen daar tegelijk in zitten. Een kaart
      //  gaat als HELE RIJ naar de server, dus wie een rij wegstuurt waarin de
      //  hole van de ander nog leeg staat, wist die. Hier tikt de derde hole 3
      //  in bij dezelfde speler; hole 1 van de medespeler moet blijven staan.
      await derde.evaluate(({ uid }) => window.updateTScore(uid, 2, 4), { uid: uidSpeler });
      await wachtOpKleur(derde, uidSpeler, 2, 'oranje');
      await wachtOpKleur(speler, uidSpeler, 2, 'oranje');
      await wachtOpKleur(speler, uidSpeler, 0, 'zwart');
      expect(await getalIn(mede, uidSpeler, 0),
        'de 5 van de medespeler staat er nog').toBe('5');
      // En de flight deelt één laag: de derde ziet wat de medespeler intikte.
      await expect.poll(() => getalIn(derde, uidSpeler, 0),
        { timeout: 20000, message: 'de derde ziet de 5 van de medespeler' }).toBe('5');

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
      await ctxCoord.close(); await ctxSpeler.close();
      await ctxMede.close();  await ctxDerde.close();
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
      await naarToernooiTab(coord);
      await coord.uncheck('#t-matrix-zichtbaar-chk');
      await naarDagTab(coord);
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
        await openLopendToernooi(p);   // v5.34.0: coordinator landt op het startscherm
      }

      await expect(klassement(coord), 'de coordinator ziet het klassement')
        .toBeVisible({ timeout: 20000 });
      await expect(klassement(speler), 'de deelnemer niet, want de schakelaar staat uit')
        .toHaveCount(0, { timeout: 20000 });
      await expect(speler.locator('#t-ranglijst'), 'ook de gegevens zelf niet').toHaveCount(0);
      await expect(blok(speler), 'en het namenrooster nog steeds niet').toHaveCount(0);

      // En weer aan: allebei de blokken komen terug.
      await naarToernooiTab(coord);
      await coord.check('#t-matrix-zichtbaar-chk');
      await naarDagTab(coord);
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
    // v5.16.0: de knop heet nu "⇄ Verdelen" — hij verdeelt zoals je in de
    // keuzelijst ernaast kiest, en "gelijk" is daar maar één van.
    await page.click('button:has-text("Verdelen")');
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
    // v5.24.0: je landt op het startscherm; het halfafgemaakte formulier zit
    // achter "➕ Nieuw toernooi", waar je het ook zelf zou zoeken.
    await openAanmaakscherm(page);

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

    await openSpelersBeheer(page);
    const lijst = page.locator('#toernooi-speler-verwijder-lijst');
    await expect(lijst).toBeVisible({ timeout: 10000 });
    await expect(lijst, 'de inlognaam van Anna staat erbij').toContainText('anna');
    await expect(lijst, 'en die van Bram ook').toContainText('bram');
    // Geen lege regel meer voor wie er geen heeft.
    await expect(lijst).not.toContainText('undefined');
  });

  // ============================================================
  //  v5.18.0 — GASTEN PLAKKEN
  // ============================================================
  //  De vervanger van de bulk-import. Die maakte clubaccounts aan; dit zet
  //  gastspelers in het toernooidocument en verder niets. Sierk: "ze hoeven
  //  niet bewaard te blijven buiten het toernooi."
  // ============================================================
  test('GASTEN PLAKKEN: een lijst uit Excel wordt in één keer toegevoegd', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Plaklijst', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Plaklijst', { timeout: 15000 });

    await naarSpelersTab(page);
    await page.click('#toernooi-detail button[onclick="openGastenPlakken()"]');

    // Vier regels, vier vormen: tab, alleen een voornaam, een Nederlandse
    // komma in de handicap, en een naam die al meedoet.
    await page.fill('#gasten-plak-tekst',
      'Karel Jansen\t12\nKarel\nAnna de Wit\t8,4\nAnna Speler\t10');

    // De telling zegt vóór het toevoegen al wat hij ervan maakt.
    await expect(page.locator('#gasten-plak-telling'),
      'drie spelers, en de dubbele naam wordt gemeld').toContainText('3 spelers', { timeout: 10000 });
    await expect(page.locator('#gasten-plak-telling')).toContainText('Anna Speler');

    await page.click('#gasten-plak-knop');

    const t = await haalToernooi('Plaklijst', 20,
      (x) => (x.spelers || []).length === 5);
    const gasten = (t.spelers || []).filter(sp => sp.gast);
    expect(gasten.map(sp => sp.naam).sort(),
      'de drie gasten staan erin, Anna Speler niet dubbel')
      .toEqual(['Anna de Wit', 'Karel', 'Karel Jansen']);
    expect(gasten.find(sp => sp.naam === 'Anna de Wit').hcp,
      'de komma-handicap is goed gelezen').toBe(8.4);
    expect(gasten.find(sp => sp.naam === 'Karel').hcp,
      'zonder handicap wordt 0').toBe(0);

    // ⚠ Geen accounts: dit venster maakt geen inlogs aan.
    expect(gasten.every(sp => !sp.login),
      'niemand heeft een inlog gekregen').toBe(true);

    // ⚠ v5.19.0: en ze staan in GEEN ENKELE flight. Dat is de spelerspool:
    // meedoen en nog niet ingedeeld. Indelen hoort bij de dag.
    const inFlights = (t.dagen[0].flights || []).flatMap(f => f.spelerIds || []);
    expect(gasten.some(sp => inFlights.includes(sp.uid)),
      'niemand is al ingedeeld — ze staan in de pool').toBe(false);

    // ── En dan op de dag: de pool staat in beeld en loopt leeg ──
    await naarDagTab(page, 1);
    await page.click('#t-flights-btn');
    const indeling = page.locator('#flight-lijst');
    await expect(indeling, 'de pool toont de drie gasten').toContainText('Spelerspool (3)', { timeout: 10000 });
    await expect(indeling).toContainText('Karel Jansen');

    await page.click('#flight-lijst button:has-text("Verdelen")');
    await expect(indeling, 'na verdelen is de pool leeg')
      .toContainText('Iedereen is ingedeeld', { timeout: 10000 });   // v5.21.2

    await page.click('#flight-modal-start-btn');
    const na = await haalToernooi('Plaklijst', 20,
      (x) => ((x.dagen?.[0]?.flights) || []).flatMap(f => f.spelerIds || []).length === 5);
    const naFlights = (na.dagen[0].flights || []).flatMap(f => f.spelerIds || []);
    expect(naFlights.length, 'alle vijf staan nu in een flight').toBe(5);
    expect(new Set(naFlights).size, 'en niemand dubbel').toBe(5);
  });

  // ============================================================
  //  v5.11.6 / v5.43.0 — EEN SPELER DIE LATER IN DE FLIGHT KOMT
  // ============================================================
  //  ⚠ WAT ER MIS WAS (v5.11.6). Een speler toevoegen aan een lopend toernooi
  //  raakte de markerindeling niet aan. De nieuwe viel dan terug op de kring
  //  terwijl de anderen hun opgeslagen marker hielden: één speler markeerde er
  //  twee, de nieuwe niemand.
  //
  //  v5.43.0: die indeling bestaat niet meer, dus die fout kan ook niet meer.
  //  Wat overblijft is de vraag waar het eigenlijk om ging — kan iemand die
  //  later in de flight komt meteen meedoen? Deze test loopt daarom dezelfde
  //  route (toevoegen, in de pool, verdelen) en kijkt aan het eind op de ECHTE
  //  scorekaart van een medespeler of de kolom van de nieuwe invulbaar is.
  // ============================================================
  test('SPELER ERBIJ: wie later in de flight komt mag er meteen in typen', async ({ page, browser }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Erbij', 1);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    // ⚠ Dag 1 moet ECHT lopen. Tot v5.42.0 keek deze test alleen in de database
    // en was opslaan genoeg; nu kijkt hij op de scorekaart, en die bestaat pas
    // als de dag gestart is. Het is ook de situatie waar het om gaat: iemand
    // die bij een LOPEND toernooi wordt toegevoegd.
    await slaOpEnStart(page, 1);
    await expect(page.locator('#toernooi-detail')).toContainText('Erbij', { timeout: 15000 });

    // De flight zoals hij begint: drie spelers, en geen markerindeling.
    const flightVan = (t) => t.dagen[0].flights[0] || {};
    const begin = flightVan(await haalToernooi('Erbij'));
    expect((begin.spelerIds || []).length, 'drie spelers in de flight').toBe(3);
    expect(begin.markers, 'er wordt geen markerindeling meer weggeschreven').toBeUndefined();

    // ── Een vierde speler erbij, via Spelers beheren ──────────
    await openSpelersBeheer(page);
    await page.fill('#toernooi-speler-zoek', 'Nina');
    const regel = page.locator('#toernooi-speler-zoek-lijst >> text=Nina Nieuw').first();
    await regel.waitFor({ state: 'visible', timeout: 5000 });
    await regel.evaluate(el => el.click());
    await page.click('#modal-toernooi-spelers button:has-text("+ Toevoegen")');
    await expect(page.locator('#toernooi-detail')).toContainText('4 spelers', { timeout: 15000 });

    // ⚠ v5.19.0: wie je op het tabblad Spelers toevoegt komt in de SPELERSPOOL,
    // nog in geen enkele flight. Indelen hoort bij de dag. Nina moet dus eerst
    // ingedeeld worden — en pas dán hoort ze mee te kunnen doen.
    expect((flightVan(await haalToernooi('Erbij')).spelerIds || []).length,
      'Nina staat nog in de pool, niet in de flight').toBe(3);

    await naarDagTab(page, 1);
    await page.click('#t-flights-btn');
    await expect(page.locator('#flight-lijst'), 'Nina staat in de pool')
      .toContainText('Spelerspool (1)', { timeout: 10000 });
    await page.click('#flight-lijst button:has-text("Verdelen")');
    await page.click('#flight-modal-start-btn');

    const na = await haalToernooi('Erbij', 20,
      (x) => ((x.dagen?.[0]?.flights?.[0]?.spelerIds) || []).length === 4);
    const ids = flightVan(na).spelerIds;
    expect(ids.length, 'alle vier staan in de flight').toBe(4);
    expect(new Set(ids).size, 'en niemand dubbel').toBe(4);
    expect(flightVan(na).markers, 'nog steeds geen markerindeling').toBeUndefined();

    const uidNina = na.spelers.find(sp => sp.naam.startsWith('Nina')).uid;
    expect(ids, 'Nina zit in de flight').toContain(uidNina);

    // ── En nu de echte vraag: mag een medespeler in Nina's kolom? ──
    const ctx = await browser.newContext();
    try {
      const anna = await ctx.newPage();
      jaOpAlles(anna);
      await inloggen(anna, 'anna@MPladder.stb');
      await naarToernooi(anna);
      await expect.poll(() =>
        anna.locator(`#t-scorecard-wrap input[data-uid="${uidNina}"]`).count(),
        { timeout: 20000, message: 'de kolom van de nieuwe speler is invulbaar' })
        .toBeGreaterThan(0);
      // En omgekeerd: Nina's kaart telt ook haar eigen kolom.
      for (const uid of ids) {
        expect(await anna.locator(`#t-scorecard-wrap input[data-uid="${uid}"]`).count(),
          'elke kolom van de flight is invulbaar').toBeGreaterThan(0);
      }
    } finally {
      await ctx.close();
    }
  });

  // ============================================================
  //  v5.23.0 — CONCEPT, BEZIG, AFGESLOTEN — OOK VOOR EEN TOERNOOI
  // ------------------------------------------------------------
  //  Sierk, 14 september 2026: "ik denk aan een mogelijkheid om ze naar concept
  //  te kunnen zetten ipv annuleren. ik vind de huidige opzet onoverzichtelijk."
  //
  //  Een dag kende concept → gestart → afgesloten; een toernooi kende actief,
  //  geannuleerd, afgerond, wacht en bezig. Nu dezelfde drie woorden, met één
  //  harde regel: verwijderen mag alleen zonder scores.
  // ============================================================
  test('TOESTANDEN: een concept verwijder je, een lopend toernooi zet je terug', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Toestand', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await slaToernooiOp(page);
    await expect(page.locator('#toernooi-detail')).toContainText('Toestand', { timeout: 20000 });

    // ── Net opgeslagen: concept, geen scores. Verwijderen mag. ──
    await naarToernooiTab(page);
    await expect(page.locator('#toernooi-detail'), 'de badge zegt Concept').toContainText('Concept');
    await expect(page.locator('#toernooi-detail button:has-text("Toernooi verwijderen")'),
      'een concept zonder scores mag gewoon weg').toBeVisible({ timeout: 10000 });
    await expect(page.locator('#toernooi-detail button:has-text("Toernooi annuleren")'),
      'en hoeft dus niet via annuleren').toHaveCount(0);

    // ── Dag 1 starten: bezig. Nu geen verwijderknop meer. ──
    await naarDagTab(page, 1);
    await page.click('#toernooi-detail button:has-text("Dag 1 starten")');
    await expect(page.locator('#t-scorecard-wrap')).toBeVisible({ timeout: 20000 });
    await naarToernooiTab(page);
    await expect(page.locator('#toernooi-detail button:has-text("Toernooi verwijderen")'),
      'een lopend toernooi verwijder je niet zomaar').toHaveCount(0);
    await expect(page.locator('#toernooi-detail button:has-text("Toernooi annuleren")'),
      'daar is annuleren voor').toBeVisible();

    // ── Terug naar concept: de dag gaat mee terug. ──
    await page.click('#toernooi-detail button:has-text("terug naar concept")');
    await expect.poll(async () => (await haalToernooi('Toestand')).dagen[0].gestart,
      { timeout: 20000, message: 'dag 1 staat weer op concept' }).toBe(false);
    await naarToernooiTab(page);
    await expect(page.locator('#toernooi-detail'), 'en de badge weer op Concept').toContainText('Concept');

    // ── En dan mag het echt weg. ──
    await page.click('#toernooi-detail button:has-text("Toernooi verwijderen")');
    await expect.poll(async () =>
      (await haalAlleToernooien()).filter(t => t.naam === 'Toestand').length,
      { timeout: 25000, message: 'het toernooi is uit de database verdwenen' }).toBe(0);
  });

  // ============================================================
  //  v5.39.0 — DE BALK EN DE HANDMATIGE PRIJZEN
  // ------------------------------------------------------------
  //  Twee dingen die de rekentests niet kunnen zien: of de balk onderaan het
  //  aanmaakscherm echt naar het volgende tabblad springt, en of een ingevulde
  //  prijs de verversing overleeft. Dat laatste is het hele punt — een prijs
  //  die je invult en die bij het sluiten van de kaart verdwijnt, is erger dan
  //  geen prijzenvak.
  // ============================================================
  test('PRIJZEN: de balk wijst naar dag 1 en een handmatige prijs blijft staan', async ({ page }) => {
    test.setTimeout(240000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Prijzen', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);

    // ── De balk onderaan wijst naar de volgende stap ──────────
    await naarSetupTab(page, 'spelers');
    const balk = page.locator('#t-setup-volgende');
    await expect(balk, 'op het tabblad Spelers heet de balk Dag 1').toHaveText(/Dag 1/);
    await balk.click();
    await expect(balk, 'en daarna staat hij op de flightindeling').toHaveText(/Flight indeling/);

    await naarFlightIndeling(page);
    await slaOpEnStart(page);
    await expect(page.locator('#toernooi-detail')).toContainText('Prijzen', { timeout: 25000 });
    await naarDagTab(page, 1);

    // ── De kaart staat er, ingeklapt ──────────────────────────
    const kop = page.locator('#toernooi-detail .card-header:has-text("Handmatige prijzen")');
    await expect(kop, 'de kaart staat boven de uitslagbalk').toBeVisible({ timeout: 20000 });
    await expect(kop, 'en is standaard ingeklapt').toHaveClass(/ingeklapt/);
    await kop.click();
    await expect(kop).not.toHaveClass(/ingeklapt/);

    // ── Een prijs invullen ────────────────────────────────────
    const hole = page.locator('#t-prijzen-vak select[data-prijs="longest"][data-veld="hole"]').first();
    const wie  = page.locator('#t-prijzen-vak select[data-prijs="longest"][data-veld="uid"]').first();
    await expect(hole).toBeVisible();
    await hole.selectOption('7');

    // ⚠ v5.39.1 — DE KAART MOET OPEN BLIJVEN.
    //  Sierk: "iedere keer als ik een selectie doe dan klapt het veld in."
    //  Het opslaan tekent het dagscherm opnieuw, en de kaart kwam terug in zijn
    //  standaardstand. Deze regel is de hele reden dat die vlag bestaat; haal
    //  hem weg en het gebrek sluipt er ongemerkt weer in.
    //  Het wachten is met opzet LANGER dan de opslagvertraging van 600 ms —
    //  anders meet je het moment vóór de hertekening en slaagt de test altijd.
    await page.waitForTimeout(2500);
    const kopNaKeuze = page.locator('#toernooi-detail .card-header:has-text("Handmatige prijzen")');
    await expect(kopNaKeuze, 'na het kiezen van een hole blijft de kaart open')
      .not.toHaveClass(/ingeklapt/);

    await wie.selectOption({ label: 'Anna Speler' });
    await page.waitForTimeout(2500);
    await expect(kopNaKeuze, 'en na het kiezen van een speler ook')
      .not.toHaveClass(/ingeklapt/);

    // Hij hoort in de database te staan, bij DEZE dag.
    await expect.poll(async () => {
      const t = await haalToernooi('Prijzen');
      const r = (t.dagen[0].prijzen || {}).longest || [];
      return r.length === 1 && r[0].hole === '7' && !!r[0].uid;
    }, { timeout: 25000, message: 'de prijs staat bij dag 1 in de database' }).toBe(true);

    // ── En hij overleeft een verversing ───────────────────────
    // Na een verversing begint de app op de ladder, en een coordinator komt
    // daarna op het startscherm uit — niet meteen in het toernooi.
    await page.reload();
    await naarToernooi(page);
    // ⚠ Op NAAM openen, niet "de eerste die loopt". In de volle reeks staan er
    // meer toernooien in de lijst en dan opende deze proef een andere — hij
    // viel om op een kaart die in dát toernooi niet stond.
    const startWrap = page.locator('#toernooi-start-wrap');
    if (await startWrap.isVisible().catch(() => false)) {
      await page.click('#toernooi-start-wrap div:has-text("Prijzen") >> button:has-text("Openen")');
    }
    await expect(page.locator('#toernooi-detail')).toBeVisible({ timeout: 15000 });
    await naarDagTab(page, 1);
    const kopNa = page.locator('#toernooi-detail .card-header:has-text("Handmatige prijzen")');
    await expect(kopNa).toBeVisible({ timeout: 25000 });
    await expect(kopNa, 'na het herladen van de app is hij weer dicht, zoals gevraagd')
      .toHaveClass(/ingeklapt/);
    await kopNa.click();
    await expect(page.locator('#t-prijzen-vak select[data-prijs="longest"][data-veld="hole"]').first(),
      'de hole staat er na het verversen nog').toHaveValue('7');
    await expect(page.locator('#t-prijzen-vak select[data-prijs="longest"][data-veld="uid"]').first(),
      'en de speler ook').not.toHaveValue('');

    // ── Een regel erbij en weer weg ───────────────────────────
    await page.click('#t-prijzen-vak button:has-text("+ regel toevoegen") >> nth=0');
    await expect(page.locator('#t-prijzen-vak select[data-prijs="longest"][data-veld="hole"]'),
      'er staat een tweede regel').toHaveCount(2);
    await page.waitForTimeout(2500);
    await expect(page.locator('#toernooi-detail .card-header:has-text("Handmatige prijzen")'),
      'en ook na een regel erbij blijft de kaart open').not.toHaveClass(/ingeklapt/);
    await page.locator('#t-prijzen-vak button[title="Regel weghalen"]').nth(1).click();
    await expect(page.locator('#t-prijzen-vak select[data-prijs="longest"][data-veld="hole"]'),
      'en hij is er weer af').toHaveCount(1);
  });

  // ============================================================
  //  v5.37.0 — DE QR-CODE STAAT ER EN GAAT OPEN
  // ------------------------------------------------------------
  //  De rekentests controleren het patroon zelf (vierkant, zoekblokken,
  //  liniaal). Wat zij NIET kunnen zien is of de knop er staat en of het
  //  venster opengaat — dat is bedrading tussen drie bestanden, en juist daar
  //  gaat het mis. Deze test klikt hem aan zoals Sierk dat doet.
  //
  //  ⚠ Of een telefoon de code léést blijft buiten bereik: er is geen QR-lezer
  //  op de testmachine en Chromium heeft er ook geen (BarcodeDetector ontbreekt,
  //  nagemeten op 19 september 2026).
  // ============================================================
  test('QR-CODE: de knop staat op het Toernooi-tabblad en het venster gaat open', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'QR', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await slaToernooiOp(page);
    await expect(page.locator('#toernooi-detail')).toContainText('QR', { timeout: 20000 });

    await naarDagTab(page, 1);
    await page.click('#toernooi-detail button:has-text("Dag 1 starten")');
    await expect(page.locator('#t-scorecard-wrap')).toBeVisible({ timeout: 20000 });

    await naarToernooiTab(page);
    const knop = page.locator('#toernooi-detail button:has-text("QR-code tonen")');
    await expect(knop, 'de knop staat naast de meekijklink').toBeVisible({ timeout: 20000 });
    await knop.click();

    const venster = page.locator('#modal-qr-code');
    await expect(venster, 'het venster gaat open').toHaveClass(/open/, { timeout: 10000 });
    await expect(venster.locator('svg'), 'er staat een getekende code in').toBeVisible();

    // Een QR-code van dit adres heeft 29x29 vakjes; ruim 400 daarvan zijn
    // zwart. Is het er één, dan is er iets misgegaan in het tekenen.
    const vakjes = await venster.locator('svg rect').count();
    expect(vakjes, 'de code bestaat uit honderden vakjes').toBeGreaterThan(300);

    // Het adres hoort er in gewone letters onder te staan, zodat je altijd zelf
    // kunt zien waar de code heen wijst. De testwebserver draait niet onder
    // /test/, dus hier hoort het live-adres te staan.
    await expect(venster.locator('#qr-code-adres'))
      .toHaveText('https://sierkr.github.io/goyer-ladder/');

    await venster.locator('button:has-text("Sluiten")').click();
    await expect(venster, 'en weer dicht').not.toHaveClass(/open/, { timeout: 10000 });
  });

  // ============================================================
  //  v5.22.0 — TWEE KEER OPSLAAN MAAKT ÉÉN TOERNOOI
  // ------------------------------------------------------------
  //  Gemeten op LIVE, 14 september 2026: twee toernooien "Cie on tour 2026",
  //  vijf seconden na elkaar aangemaakt, dezelfde acht spelers. Het opslaan
  //  maakt ook alle gastaccounts aan — dat duurt seconden, en zolang bleef de
  //  knop indrukbaar. Sierk: "ik heb maar 1 toernooi aangemaakt met deze naam."
  //
  //  ⚠ Deze test roept startToernooi() TWEE KEER RECHTSTREEKS aan, niet via de
  //  knop. De knop gaat meteen op slot, dus een tweede klik is daarna sowieso
  //  een lege handeling — dat zou de test laten slagen zonder het echte slot te
  //  raken. Het slot zit op de functie; dus test hem daar.
  // ============================================================
  test('DUBBEL OPSLAAN: twee keer drukken levert één toernooi op', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Dubbelop', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);

    await page.evaluate(() => { window.startToernooi(); window.startToernooi(); });

    await expect.poll(async () =>
      (await haalAlleToernooien()).filter(t => t.naam === 'Dubbelop').length,
      { timeout: 25000, message: 'het toernooi is aangemaakt' }).toBe(1);

    // En nog even wachten: een tweede die onderweg was mag alsnog niet landen.
    await page.waitForTimeout(4000);
    expect((await haalAlleToernooien()).filter(t => t.naam === 'Dubbelop').length,
      'en er komt er geen tweede achteraan').toBe(1);
  });

  // ============================================================
  //  v5.20.0 — ✈ FLIGHTS STAAT ER ALTIJD
  // ============================================================
  //  De knop zat in de kop van de scorekaart, en die kop bestaat alleen als de
  //  dag GESTART is. Op een dag die nog concept was kon je dus niet indelen —
  //  precies wanneer je dat wilt. Sierk: "maak het eenduidig."
  //  Eén regel: bij de dagknoppen, op elke dag, behalve een afgesloten dag.
  // ============================================================
  test('FLIGHTKNOP: ✈ Flights staat er op een gestarte én op een conceptdag', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);

    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Flightknop', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await slaToernooiOp(page);
    await expect(page.locator('#toernooi-detail')).toContainText('Flightknop', { timeout: 15000 });

    // v5.21.0: een pas opgeslagen toernooi WACHT — dag 1 is concept. Dat is
    // meteen het geval waar deze test over gaat: de knop moet er ook dan zijn.
    await naarDagTab(page, 1);
    await expect(page.locator('#t-flights-btn'),
      'op een conceptdag').toBeVisible({ timeout: 15000 });

    await page.click('#toernooi-detail button:has-text("Dag 1 starten")');
    await expect(page.locator('#t-scorecard-wrap')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#t-flights-btn'),
      'en op een gestarte dag ook').toBeVisible({ timeout: 15000 });

    // En hij doet het daar ook echt.
    await page.click('#t-flights-btn');
    await expect(page.locator('#flight-lijst')).toContainText('Spelerspool', { timeout: 10000 });
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
    await kiesSetupDag(page, 1);
    await page.locator('#t-dag-blokken .dag-blok[data-dagnr="1"] .t-dag-modus').selectOption('strokeplay');
    await kiesSetupDag(page, 2);
    await page.locator('#t-dag-blokken .dag-blok[data-dagnr="2"] .t-dag-modus').selectOption('matchplay');

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
    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
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

    // v5.20.0: en dit is de énige dag zonder ✈ Flights. De uitslag is
    // gepubliceerd; de indeling omgooien zou die met terugwerkende kracht
    // veranderen.
    await expect(page.locator('#t-flights-btn'),
      'een afgesloten dag heeft geen flightknop').toHaveCount(0);

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

  test('GASTLOGIN: gast kiest zijn naam uit de lijst en tikt de pincode', async ({ page, browser }) => {
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
    await page.fill('#t-toernooi-pin', '1234');   // v5.38.0: pincode i.p.v. wachtwoord

    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Karel Gast');
    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Bep');

    await naarFlightIndeling(page);
    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
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

    // Het geheim staat NIET op het openbare toernooidocument. v5.38.0: dat geldt
    // nu voor de pincode — het openbare document draagt alleen namen.
    expect(JSON.stringify(t)).not.toContain('1234');

    // En de gast zit in geen enkele ladder.
    const ladder = await beheerDb.doc('ladders/mp').get();
    expect((ladder.data().spelerIds || []).includes(gast.uid), 'staat niet in de ladder').toBe(false);

    // ── De gast kiest zijn naam uit de lijst en tikt de pincode ──
    // v5.38.0: hier tikte hij zijn naam plus het toernooiwachtwoord. Dat
    // wachtwoord bestaat niet meer als mensenwachtwoord — het account krijgt
    // een willekeurig getal dat niemand hoeft te kennen.
    const gastPagina = await (await browser.newContext()).newPage();
    await pinInloggen(gastPagina, 'Karel Gast', '1234');
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

    // v5.11.7 / v5.38.0: een gast met ALLEEN een voornaam komt er ook in. Vroeger
    // ging dat mis omdat één woord buiten de naamherkenning viel; met een lijst
    // valt er niets meer te herkennen, maar hij moet er wel in STAAN.
    const eenNaam = await (await browser.newContext()).newPage();
    await pinInloggen(eenNaam, 'Bep', '1234');
    await eenNaam.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(eenNaam.locator('#page-toernooi')).toContainText('Jouw scorekaart', { timeout: 20000 });
    await eenNaam.close();

    // ⚠ En de andere kant: een verkeerde pincode komt er NIET in. Zonder deze
    // proef zou een fout in de foutafhandeling ongemerkt iedereen binnenlaten.
    const fout = await (await browser.newContext()).newPage();
    await pinInloggen(fout, 'Karel Gast', '9999');
    await expect(fout.locator('#login-fout'), 'een verkeerde pincode wordt gemeld')
      .toBeVisible({ timeout: 20000 });
    await expect(fout.locator('#login-scherm'), 'en je blijft buiten').toBeVisible();
    await fout.close();

    // En het beheerscherm toont precies dát: karel.gast, zonder toernooicode.
    await openSpelersBeheer(page);
    const lijst = page.locator('#toernooi-speler-verwijder-lijst');
    await expect(lijst).toBeVisible({ timeout: 10000 });
    await expect(lijst, 'de inlognaam zoals de gast hem intikt').toContainText('karel.gast');
    await expect(lijst, 'zonder de toernooicode erachter').not.toContainText('gastentoernooi');
    await page.click('#modal-toernooi-spelers button:has-text("Sluiten")');
    await expect(page.locator('#modal-toernooi-spelers')).not.toHaveClass(/open/, { timeout: 10000 });

    // v5.11.5: hetzelfde in het lijstje achter "Gastlogins tonen" — dat is het
    // briefje dat je aan je gasten doorgeeft, dus daar mag de code al helemaal
    // niet op staan.
    // v5.17.0: de gastloginknoppen staan op het tabblad Spelers, niet meer op
    // Toernooi — ze gaan over mensen, niet over het toernooi als geheel.
    await naarSpelersTab(page);
    await page.click('#toernooi-detail button:has-text("Gastlogins tonen")');
    const briefje = page.locator('#archief-detail-inhoud');
    await expect(briefje).toBeVisible({ timeout: 10000 });
    await expect(briefje, 'de inlognaam staat erop').toContainText('karel.gast');
    await expect(briefje, 'zonder toernooicode').not.toContainText('karel.gast.gastentoernooi');
    // v5.38.0: hier stond het gastwachtwoord. Dat is nu een willekeurig getal
    // dat niemand hoeft te kennen; op het briefje staat de PINCODE.
    await expect(briefje, 'met de pincode erbij').toContainText('1234');

    // v5.11.5: en de flight draagt geen TIJDELIJKE gast-sleutels meer. Die
    // werden bij het starten overal vervangen behalve in de markerindeling.
    // v5.43.0: die indeling is vervallen, dus `spelerIds` is de enige plek waar
    // een sleutel nog kan blijven hangen — en dat is precies de plek waar
    // zelfdeFlight() naar kijkt om te bepalen wie mag invullen.
    const naStart = await haalToernooi('Gastentoernooi');
    const flightSleutels = (naStart.dagen[0].flights || [])
      .flatMap(f => f.spelerIds || []);
    expect(flightSleutels.length, 'er staan spelers in de flights').toBeGreaterThan(0);
    expect(flightSleutels.filter(k => String(k).startsWith('gast_')),
      'geen tijdelijke sleutels meer in de flights').toEqual([]);
    const echteIds = new Set(naStart.spelers.map(sp => sp.uid));
    expect(flightSleutels.every(k => echteIds.has(k)),
      'elke sleutel in een flight is een speler die echt meedoet').toBe(true);

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

  // ⚠ v5.21.0: deze test controleerde dat je geen TWEEDE toernooi kon AANMAKEN
  //  zolang er één liep. Die grens is verhuisd, want aanmaken en starten zijn
  //  twee momenten geworden. Sierk, 14 september 2026: zoveel wachtende
  //  toernooien als je wilt, maar één tegelijk gestart. De test controleert nu
  //  precies dat — beide helften.
  test('TWEE TOERNOOIEN: klaarzetten mag, tegelijk starten niet', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    await vulAanmaakformulier(page, 'Eerste', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await slaOpEnStart(page);   // deze gaat écht lopen
    await expect(page.locator('#toernooi-detail')).toContainText('Eerste', { timeout: 15000 });

    // Een tweede klaarzetten MAG nu. v5.24.0: via het startscherm.
    await naarToernooiStart(page);
    await vulAanmaakformulier(page, 'Tweede', 1);
    for (const n of ['Cees Speler', 'Nina Nieuw']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await slaToernooiOp(page);

    await expect.poll(async () => (await haalAlleToernooien()).map(t => t.naam).sort(),
      { timeout: 20000, message: 'beide toernooien staan in de database' })
      .toEqual(['Eerste', 'Tweede']);

    // Maar starten gaat niet zolang "Eerste" loopt.
    // v5.24.0: kiezen doe je op het startscherm, niet meer op een naamknop
    // boven het toernooi.
    await naarToernooiStart(page);
    await page.click('#toernooi-start-wrap div:has-text("Tweede") >> button:has-text("Openen")');
    await naarDagTab(page, 1);
    await page.click('#toernooi-detail button:has-text("Dag 1 starten")');
    await expect(page.locator('#toast')).toContainText('loopt nog', { timeout: 10000 });

    const tweede = await haalToernooi('Tweede');
    expect(tweede.dagen[0].gestart, 'en hij is dus niet gestart').toBeFalsy();
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
  //  v5.14.0 — DE LEVENSLOOP VAN EEN DAG
  // ------------------------------------------------------------
  //  Sierk, 14 september 2026: "Totdat de dag gestart is kan ik dan de dag
  //  aanpassen. En dan als de dag gestart is een dag annuleren om aanpassingen
  //  te doen. Ik wil maximale vrijheid."
  //
  //  De grens was tot v5.13.1 een BIJWERKING: zodra er één cijfer stond kon je
  //  niets meer wijzigen. Nu is het een knop, en die kan twee kanten op.
  // ============================================================
  test('LEVENSLOOP: een nieuwe dag begint als concept, start je, en kan terug', async ({ page }) => {
    test.setTimeout(180000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);

    await vulAanmaakformulier(page, 'Levensloop', 1);
    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await slaToernooiOp(page);
    await expect(page.locator('#toernooi-detail')).toContainText('Levensloop', { timeout: 25000 });

    // ⚠ v5.21.0: dag 1 startte tot v5.20.0 MEE met het aanmaken. Nu niet meer —
    // aanmaken en starten zijn twee momenten, en een pas opgeslagen toernooi
    // staat te wachten. Dat maakt dag 1 gelijk aan elke andere dag.
    const detail = page.locator('#toernooi-detail');
    await expect(detail, 'dag 1 wacht nog').toContainText('Dag 1 is nog niet gestart');
    await expect(detail.locator('#t-scorecard-wrap'), 'en heeft dus geen scorekaart').toHaveCount(0);

    await page.click('#toernooi-detail button:has-text("Dag 1 starten")');
    await expect(detail.locator('#t-scorecard-wrap'), 'na starten wel').toBeVisible({ timeout: 20000 });

    // Een dag die je ONDERWEG toevoegt begint als concept.
    await page.click('#toernooi-detail button:has-text("Dag toevoegen")');
    await page.waitForSelector('#modal-nieuwe-dag.open', { timeout: 15000 });
    await page.fill('#t-dag-datum', '2026-10-02');
    await page.selectOption('#t-dag-baan', 'De Goyer');
    await page.click('#modal-dag-opslaan-btn');
    await expect(page.locator('#modal-nieuwe-dag')).not.toHaveClass(/open/, { timeout: 15000 });

    await naarDagTab(page, 2);
    await expect(detail, 'dag 2 begint als concept').toContainText('Dag 2 is nog niet gestart');
    await expect(detail.locator('#t-scorecard-wrap'),
      'een concept-dag heeft geen scorekaart').toHaveCount(0);
    await expect(detail, 'en hij zegt dat hij nog niet is ingedeeld')
      .toContainText('nog niet in flights ingedeeld');
    await expect(detail.locator('button:has-text("Dag 2 wijzigen")'),
      'een concept-dag is te wijzigen').toBeVisible();

    // Starten: de scorekaart gaat open en wijzigen kan niet meer.
    await page.click('#toernooi-detail button:has-text("Dag 2 starten")');
    await expect(detail.locator('#t-scorecard-wrap'),
      'na starten is er een scorekaart').toBeVisible({ timeout: 15000 });
    await expect(detail.locator('button:has-text("Dag 2 wijzigen")'),
      'een gestarte dag is niet meer te wijzigen').toHaveCount(0);
    expect((await haalToernooi('Levensloop', 20, t => t.dagen?.[1]?.gestart === true))
      .dagen[1].gestart, 'gestart staat ook echt in de database').toBe(true);

    // En terug: dat is wat Sierk "dag annuleren" noemt.
    await page.click('#toernooi-detail button:has-text("terugzetten naar concept")');
    await expect(detail, 'terug op concept').toContainText('Dag 2 is nog niet gestart', { timeout: 15000 });
    await expect(detail.locator('button:has-text("Dag 2 wijzigen")'),
      'en dus weer te wijzigen').toBeVisible();
    expect((await haalToernooi('Levensloop', 20, t => t.dagen?.[1]?.gestart === false))
      .dagen[1].gestart, 'ook in de database staat hij weer op concept').toBe(false);
  });

  // ============================================================
  //  v5.15.0 — PUNTEN PER PLAATS BIJ EEN STROKEPLAY-DAG
  // ------------------------------------------------------------
  //  Sierk: "Optie tabel voor strokeplay. Standaard zoals nu met optie om elke
  //  plek in te stellen." Het veld hoort alleen bij strokeplay te staan, en wat
  //  je intikt moet ook echt in de database belanden.
  // ============================================================
  test('PUNTEN PER PLAATS: alleen bij strokeplay, en het komt in de database', async ({ page }) => {
    test.setTimeout(150000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Plaatspunten', 1);

    // v5.33.1: het aanmaakscherm heeft sinds v5.21.0 tabbladen. Het dagblok is
    // pas zichtbaar als je het dagtabblad kiest.
    await kiesSetupDag(page, 1);
    const blok = page.locator('#t-dag-blokken .dag-blok[data-dagnr="1"]');
    const veld = blok.locator('.t-dag-plaatspunten');

    // Matchplay: het veld hoort er niet te staan.
    await expect(blok.locator('.t-dag-strokeplay-blok'),
      'matchplay: geen puntentabel').toBeHidden();

    // Strokeplay: wel, met een voorbeeld eronder dat de 0-regel uitlegt.
    await blok.locator('.t-dag-modus').selectOption('strokeplay');
    await expect(blok.locator('.t-dag-strokeplay-blok'),
      'strokeplay: de puntentabel verschijnt').toBeVisible();
    await veld.fill('10, 7, 5');
    await expect(blok.locator('.t-dag-plaatspunten-voorbeeld'),
      'het voorbeeld zegt wat er voorbij de tabel gebeurt').toContainText('plek 4 en verder → 0');

    for (const n of ['Anna Speler', 'Bram Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);
    await page.click('#flight-modal-start-btn');
    await expect(page.locator('#toernooi-detail')).toContainText('Plaatspunten', { timeout: 25000 });

    const t = await haalToernooi('Plaatspunten');
    expect(t.dagen[0].plaatsPunten, 'de tabel staat in de database').toBe('10, 7, 5');
    expect(t.dagen[0].modus, 'en de dag is strokeplay').toBe('strokeplay');
  });

  // ============================================================
  //  v5.16.0 — VIJF MANIEREN OM IN TE DELEN
  // ------------------------------------------------------------
  //  De vijf rekenregels zelf zijn met 28 rekentests vastgelegd. Deze test doet
  //  het andere stuk: staat de keuzelijst er, en doet de knop wat je kiest?
  // ============================================================
  test('INDELEN: de keuzelijst staat er en de knop volgt de keuze', async ({ page }) => {
    test.setTimeout(150000);
    jaOpAlles(page);
    await inloggen(page, 'coord@MPladder.stb');
    await naarToernooi(page);
    await vulAanmaakformulier(page, 'Indelen', 1);
    for (const n of ['Anna Speler', 'Bram Speler', 'Cees Speler']) await kiesSpeler(page, n);
    await naarFlightIndeling(page);

    const keuze = page.locator('#t-verdeel-soort');
    await expect(keuze, 'de keuzelijst staat naast de knop').toBeVisible();
    await expect(keuze.locator('option'), 'vijf manieren').toHaveCount(5);

    // Twee flights erbij, zodat er iets te verdelen valt.
    await page.click('#modal-flight-indeling button:has-text("Flight toevoegen")');
    await expect(page.locator('#flight-lijst'), 'er zijn nu twee flights')
      .toContainText('2 flight(s)', { timeout: 10000 });

    // Elke keuze moet zonder fout verdelen en dat ook melden.
    for (const [waarde, tekst] of [
      ['hcp', 'op handicap'],
      ['flighthcp', 'even sterk'],
      ['stand', 'willekeurig'],        // dag 1: er is nog geen toernooistand
      ['nieuw', 'willekeurig'],        // en nog geen eerdere dagen
      ['beurt', 'Gelijk verdeeld'],
    ]) {
      await keuze.selectOption(waarde);
      await page.click('#modal-flight-indeling button:has-text("Verdelen")');
      await expect(page.locator('#toast'), `melding bij "${waarde}"`)
        .toContainText(tekst, { timeout: 10000 });
    }

    // En iedereen zit nog steeds precies één keer in een flight.
    const lijst = await page.locator('#flight-lijst').innerText();
    for (const n of ['Anna', 'Bram', 'Cees']) {
      const keer = lijst.split(n).length - 1;
      expect(keer, `${n} staat precies één keer ingedeeld`).toBe(1);
    }
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
    await naarToernooiTab(page);
    await page.click('#toernooi-detail button:has-text("Toernooi annuleren")');
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().status),
      { timeout: 20000, message: 'het toernooi staat op geannuleerd' }).toEqual(['geannuleerd']);
    // v5.24.0: "Eerdere toernooien tonen" is weg — het blok Oud staat vast op
    // het startscherm en vult zichzelf.
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
    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
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
    await page.fill('#t-toernooi-pin', '1234');   // v5.38.0: pincode i.p.v. wachtwoord
    await page.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(page.locator('#t-geselecteerde-spelers')).toContainText('Karel Gast');
    await naarFlightIndeling(page);
    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
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
    await pinInloggen(gast, 'Karel Gast', '1234');   // v5.38.0
    await gast.waitForSelector('#login-scherm', { state: 'hidden', timeout: 25000 });
    await expect(gast.locator('#page-toernooi'), 'de gast komt er na het herstel gewoon weer in')
      .toContainText('Jouw scorekaart', { timeout: 25000 });
    await gast.close();

    // En het opruimen is niet verdwenen, alleen verhuisd: bij DEFINITIEF
    // verwijderen gaat het gastaccount alsnog mee. Dat is de handeling die niet
    // meer terug te draaien is, dus daar hoort het.
    await naarToernooiTab(page);
    await page.click('#toernooi-detail button:has-text("Toernooi annuleren")');
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.map(d => d.data().status),
      { timeout: 20000 }).toEqual(['geannuleerd']);
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

    // ⚠ v5.21.1: de speelwijze-KEUZE staat op het dagtabblad, en wat die keuze
    //  aanstuurt (puntenvelden, uitleg, ranking-ladder) staat op het tabblad
    //  Toernooi. Ze zijn dus nooit tegelijk in beeld: kiezen op de dag, kijken
    //  op Toernooi. Deze test wisselt daarom net als een mens.
    await naarSetupTab(page, 'toernooi');
    await expect(oudeRadio, 'de tweede keuze is weg').toHaveCount(0);
    await expect(punten,  'matchplay: de puntenvelden staan er').toBeVisible();
    await expect(uitleg,  'matchplay: geen strokeplay-uitleg').toBeHidden();
    await expect(ranking, 'matchplay: de ranking-ladder mag').toBeVisible();

    await kiesSetupDag(page, 1);
    await expect(keuzes, 'één speelwijze-keuze bij één dag').toHaveCount(1);

    // Strokeplay: geen punten, wel uitleg, en GEEN ranking-ladder — want een
    // strokeplay-toernooi telt niet mee voor de ladder.
    await keuzes.first().selectOption('strokeplay');
    await naarSetupTab(page, 'toernooi');
    await expect(ranking, 'strokeplay: de ranking-ladder is weg').toBeHidden();
    await expect(punten,  'strokeplay: geen puntenvelden').toBeHidden();
    await expect(uitleg,  'strokeplay: wel de uitleg brutto/netto/stableford').toBeVisible();

    // Twee dagen, gemengd. Dít is wat met de oude keuze niet kon: de
    // puntenvelden horen erbij vanwege dag 2, de uitleg vanwege dag 1, en de
    // ranking-ladder blijft weg vanwege dag 1.
    // v5.21.0: een dag erbij doe je met + Dag toevoegen; "Aantal dagen" is weg.
    await page.click('#t-setup-tabs button[onclick="voegSetupDagToe()"]');
    await expect(keuzes, 'twee dagen, twee keuzes').toHaveCount(2);
    await expect(keuzes.nth(0), 'dag 1 houdt zijn keuze').toHaveValue('strokeplay');
    await kiesSetupDag(page, 2);
    await page.locator('#t-dag-blokken .dag-blok[data-dagnr="2"] .t-dag-modus').selectOption('matchplay');
    await naarSetupTab(page, 'toernooi');
    await expect(punten,  'gemengd: de puntenvelden zijn terug voor dag 2').toBeVisible();
    await expect(uitleg,  'gemengd: de uitleg blijft voor dag 1').toBeVisible();
    await expect(ranking, 'gemengd: nog steeds geen ranking-ladder').toBeHidden();

    // En alles weer matchplay brengt de ranking-ladder terug.
    await kiesSetupDag(page, 1);
    await page.locator('#t-dag-blokken .dag-blok[data-dagnr="1"] .t-dag-modus').selectOption('matchplay');
    await naarSetupTab(page, 'toernooi');
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

      await naarToernooiTab(coord);
      await coord.uncheck('#t-matrix-zichtbaar-chk');
      await naarDagTab(coord);
      await expect(klassement(speler), 'schakelaar uit: weg bij de deelnemer')
        .toHaveCount(0, { timeout: 20000 });
      await expect(klassement(coord), 'en de coordinator houdt hem').toBeVisible();

      await naarToernooiTab(coord);
      await coord.check('#t-matrix-zichtbaar-chk');
      await naarDagTab(coord);
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
    await pagina.fill('#t-toernooi-pin', wachtwoord);   // v5.38.0: dit is nu een pincode
    await pagina.click('#toernooi-setup-wrap button:has-text("Gastspeler toevoegen")');
    await expect(pagina.locator('#t-geselecteerde-spelers')).toContainText(gastnaam.split(' ')[0]);
    await naarFlightIndeling(pagina);
    // v5.23.0: dag 1 ook echt starten. De tests die dit hulpje gebruiken
    // annuleren het toernooi daarna, en annuleren bestaat alleen voor een
    // toernooi waar iets in gebeurd is — een concept zonder scores verwijder je.
    await slaOpEnStart(pagina);
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
    await naarToernooiTab(pagina);
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
    const t1 = await toernooiMetGast(page, 'Clubkampioenschap', 'Harry', '1234');
    const uid1 = t1.spelers.find(sp => sp.gast).uid;
    await annuleerLopend(page);
    const t2 = await toernooiMetGast(page, 'Clubkampioenschap', 'Harry', '1234');
    const gast2 = t2.spelers.find(sp => sp.gast);
    expect(gast2.uid, 'de nieuwe Harry is een ander account').not.toBe(uid1);

    // ⚠ HIER GING HET MIS tot v5.12.2. Het inlogscherm rekende zijn inlognaam
    // uit (`harry.<code>`) in plaats van hem op te zoeken. Die naam was bezet
    // door het OUDE toernooi, dus kwam Harry daar binnen — met het juiste
    // wachtwoord, dus zonder één waarschuwing — en las "Geen actief toernooi".
    // v5.38.0: met een lijst valt er niets meer uit te rekenen — de lijst hoort
    // bij het toernooi dat LOOPT, dus je kunt niet meer in het oude belanden.
    // Deze proef bewaakt nu dat de lijst inderdaad van het lopende toernooi is.
    const harry = await (await browser.newContext()).newPage();
    await pinInloggen(harry, 'Harry', '1234');
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

    const t1 = await toernooiMetGast(page, 'Voorjaarscup', 'Sierk', '1234');
    expect(t1.spelers.find(sp => sp.gast).login, 'de eerste keer gewoon zijn naam')
      .toBe('sierk.voorjaarscup');

    // ⚠ HIER GING HET MIS. "Toernooi opnieuw instellen" gooit het toernooi weg
    // maar liet de gastaccounts staan. Opnieuw starten met dezelfde naam gaf
    // `sierk2`, en nog een keer `sierk3` — terwijl er maar één Sierk meedeed.
    // Sierk, 13 september 2026: "er was maar 1 speler in het toernooi die zo
    // heet."
    await naarToernooiTab(page);
    await page.click('#toernooi-detail button:has-text("Toernooi opnieuw instellen")');
    await expect(page.locator('#toernooi-setup-wrap')).toBeVisible({ timeout: 20000 });
    await expect.poll(async () =>
      (await beheerDb.collection('toernooien').get()).docs.length, { timeout: 25000 }).toBe(0);

    // v5.21.1: het gastwachtwoord staat op het tabblad Spelers, en na "opnieuw
    // instellen" komt het scherm terug op Toernooi.
    await naarSetupTab(page, 'spelers');
    await page.fill('#t-toernooi-pin', '1234');   // v5.38.0: pincode i.p.v. wachtwoord
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
    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
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

  test('GASTWACHTWOORD: starten zonder pincode gaat niet stilletjes', async ({ page }) => {
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

    // v5.38.0: de waarschuwing gaat over de PINCODE; het veld heet zo.
    expect(gevraagd.some(m => /geen pincode ingevuld/i.test(m)),
      'de app waarschuwt dat de gast dan niet kan inloggen').toBe(true);

    // En dan staat de reparatieknop klaar — de enige uitweg was tot v5.12.3 de
    // gast verwijderen en opnieuw toevoegen, en dan raakt hij zijn scores kwijt.
    await naarSpelersTab(page);   // v5.17.0: gastloginknoppen staan op Spelers
    await expect(page.locator('#toernooi-detail button:has-text("Gastlogins aanmaken")'),
      'met de knop om het alsnog te doen').toBeVisible({ timeout: 15000 });
  });

  test('GASTWACHTWOORD: de reparatieknop geeft alsnog een inlog, scores blijven', async ({ page, browser }) => {
    test.setTimeout(300000);
    const antwoorden = ['Karel Gast', '15', '1234'];   // v5.38.0: de derde is nu een pincode
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
    await slaOpEnStart(page);   // v5.21.0: opslaan én dag 1 starten
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

    await naarSpelersTab(page);   // v5.17.0: gastloginknoppen staan op Spelers
    await page.click('#toernooi-detail button:has-text("Gastlogins aanmaken")');
    await expect.poll(async () => {
      const x = await haalToernooi('Reparatie');
      return (x.spelers || []).filter(sp => sp.gast && sp.login).length;
    }, { timeout: 60000, message: 'de gast heeft alsnog een inlog' }).toBe(1);

    const na = await haalToernooi('Reparatie');
    const gastNa = na.spelers.find(sp => sp.gast);
    expect(gastNa.uid, 'hij heeft een echte sleutel gekregen').not.toBe(gastVoor.uid);
    expect(String(gastNa.uid).startsWith('gast_'), 'geen tijdelijke sleutel meer').toBe(false);

    // Zijn oude sleutel mag nergens meer staan — flights en scores moeten
    // allemaal zijn omgeschreven.
    // ⚠ Deze ene regel ving een echte fout: de sleutelwissel gebeurde ONDERWEG,
    // tussen twee netwerkaanroepen door, en de meeluisteraar zette de oude
    // sleutel daarna gewoon weer terug in `dagen[].scores`.
    expect(JSON.stringify(na).includes(gastVoor.uid),
      'de oude sleutel staat nergens meer in het toernooi').toBe(false);
    const flightIds = (na.dagen[0].flights || []).flatMap(f => f.spelerIds || []);
    expect(flightIds.includes(gastNa.uid), 'hij zit nog gewoon in zijn flight').toBe(true);

    // En de gast komt binnen met zijn eigen naam.
    const gast = await (await browser.newContext()).newPage();
    await pinInloggen(gast, 'Karel Gast', '1234');   // v5.38.0
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
