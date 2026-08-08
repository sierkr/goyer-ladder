// ============================================================
//  Piepkleine statische webserver voor de browsertests
// ============================================================
//  Serveert de projectmap op http://127.0.0.1:5000 zodat Playwright de app
//  kan openen. Bewust zonder externe pakketten.
// ============================================================
const http = require('http');
const fs   = require('fs');
const path = require('path');

const WORTEL = path.join(__dirname, '..', '..');
const POORT  = process.env.TEST_POORT ? Number(process.env.TEST_POORT) : 5000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  let pad = decodeURIComponent(req.url.split('?')[0]);
  if (pad === '/' || pad.endsWith('/')) pad += 'index.html';

  // Nooit buiten de projectmap serveren.
  const bestand = path.normalize(path.join(WORTEL, pad));
  if (!bestand.startsWith(WORTEL)) { res.writeHead(403).end('Verboden'); return; }

  fs.readFile(bestand, (err, data) => {
    if (err) { res.writeHead(404).end('Niet gevonden: ' + pad); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(bestand)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(POORT, '127.0.0.1', () => {
  console.log(`Testserver draait op http://127.0.0.1:${POORT}`);
});
