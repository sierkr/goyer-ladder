// Draaien met: node tests/uitslagpagina.check.cjs   (vanuit de projectmap)
// Functionele controle van toernooi-live.html zonder echte database.
// De drie Firebase-modules worden onderschept en vervangen door een nepversie
// die één afgesloten toernooi van 2 dagen teruggeeft.
const { chromium } = require('/home/claude/ladder/tests/node_modules/playwright');
const fs = require('fs');

const HTML = fs.readFileSync('/home/claude/ladder/toernooi-live.html', 'utf8');

const spelers = [
  { uid: 'u1', naam: 'Sierk',   hcp: 10 },
  { uid: 'u2', naam: 'Richard', hcp: 14 },
];
const maakDag = (nr, afgerond) => ({
  dagNr: nr, datum: '2026-09-2' + nr, baan: 'De Haar', afgerond,
  speelwijze: 'strokeplay',
  holes: [{ nr: 1, par: 4, si: 1 }, { nr: 2, par: 4, si: 2 }],
  scores: { u1: [4, 4 + nr], u2: [5, 5] },
});
const TOERNOOI = {
  naam: 'Cie on tour', status: 'afgerond', modus: 'strokeplay', publiek: true,
  actiefDagNr: 2, spelers, ptWin: 2, ptTie: 1, ptLoss: 0,
  dagen: [maakDag(1, true), maakDag(2, true)],
};

const STUB_APP = `export function initializeApp(){return{};}`;
const STUB_CHECK = `export function initializeAppCheck(){return{};}
export class ReCaptchaV3Provider{constructor(){}}`;
const STUB_STORE = `
const T = ${JSON.stringify(TOERNOOI)};
export function getFirestore(){return{};}
export function doc(){return{};}
export function collection(){return{};}
export function query(){return{};}
export function where(){return{};}
export function onSnapshot(){return ()=>{};}
export async function getDocs(){return{empty:true,docs:[]};}
export async function getDoc(){return{exists:()=>true,id:'X1',data:()=>JSON.parse(JSON.stringify(T))};}
`;

const http = require('http');
const path = require('path');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const bestand = path.join('/home/claude/ladder', decodeURIComponent(req.url.split('?')[0]));
  try {
    const data = fs.readFileSync(bestand);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(bestand)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('x'); }
}).listen(8177);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const fouten = [];
  page.on('console', m => { if (m.type() === 'error') fouten.push(m.text()); });
  page.on('pageerror', e => fouten.push('pageerror: ' + e.message));

  await page.route('**/firebasejs/**/firebase-app.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB_APP }));
  await page.route('**/firebasejs/**/firebase-app-check.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB_CHECK }));
  await page.route('**/firebasejs/**/firebase-firestore.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB_STORE }));
  await page.route('**/logo.png', r => r.abort());

  await page.goto('http://127.0.0.1:8177/toernooi-live.html?t=X1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const ok = [];
  const nok = [];
  const zegt = (naam, waarde) => (waarde ? ok : nok).push(naam);

  // 1 — precies één dagbalk
  zegt('precies één dagbalk', (await page.locator('#dag-tab-balk').count()) === 1);

  // 2 — geen tweede rij knoppen binnen de kaart
  await page.click('#tab-ranglijst');
  await page.waitForTimeout(150);
  const knoppenInKaart = await page.locator('#inhoud button').count();
  zegt('geen dagknoppen meer in de ranglijstkaart', knoppenInKaart === 0);

  // 3 — de balk bevat de dagen én Totaal
  const labels = await page.locator('#dag-tab-balk button').allTextContents();
  zegt('balk toont Dag 1, Dag 2 en Totaal',
    labels.length === 3 && labels[2] === 'Totaal' && labels[0].startsWith('Dag 1'));

  // 4 — Dag 1 aanklikken toont de ranglijst van dag 1
  await page.locator('#dag-tab-balk button').first().click();
  await page.waitForTimeout(150);
  zegt('Dag 1 toont Ranglijst · Dag 1', (await page.locator('#inhoud').innerText()).includes('Ranglijst · Dag 1'));

  // 5 — Totaal aanklikken toont de totaalstand
  await page.locator('#dag-tab-balk button').nth(2).click();
  await page.waitForTimeout(150);
  const naTotaal = await page.locator('#inhoud').innerText();
  zegt('Totaal toont Ranglijst · Totaal', naTotaal.includes('Ranglijst · Totaal'));
  zegt('kop meldt Totaal', (await page.locator('#toernooi-meta').innerText()).includes('Totaal'));

  // 6 — vanaf Scores springt Totaal mee naar Ranglijst
  await page.click('#tab-scores');
  await page.waitForTimeout(150);
  zegt('terug naar Scores verlaat Totaal',
    (await page.locator('#tab-scores').getAttribute('class')).includes('actief'));
  await page.locator('#dag-tab-balk button').nth(2).click();
  await page.waitForTimeout(150);
  zegt('Totaal springt naar tabblad Ranglijst',
    (await page.locator('#tab-ranglijst').getAttribute('class')).includes('actief'));

  // 7 — herhaald klikken laat geen rijen aangroeien
  for (let i = 0; i < 5; i++) { await page.locator('#dag-tab-balk button').first().click(); await page.waitForTimeout(60); }
  zegt('geen aangroeiende rijen na 5 klikken', (await page.locator('#dag-tab-balk').count()) === 1);

  console.log('\nGESLAAGD:'); ok.forEach(r => console.log('  ✓ ' + r));
  if (nok.length) { console.log('MISLUKT:'); nok.forEach(r => console.log('  ✗ ' + r)); }
  const echteFouten = fouten.filter(f => !/logo\.png|net::ERR|favicon|recaptcha/i.test(f));
  if (echteFouten.length) { console.log('CONSOLEFOUTEN:'); echteFouten.forEach(f => console.log('  ! ' + f)); }
  await browser.close();
  server.close();
  process.exit(nok.length || echteFouten.length ? 1 : 0);
})();
