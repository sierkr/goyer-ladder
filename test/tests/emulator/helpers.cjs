// ============================================================
//  Gedeelde hulpmiddelen voor de emulator-tests
// ============================================================
//  Bewust geen testframework (jest/mocha): dat scheelt een grote
//  afhankelijkheid en de uitvoer blijft leesbaar voor wie geen ontwikkelaar is.
// ============================================================

function maakRapport(titel) {
  const staat = { titel, ok: 0, fout: 0, bevindingen: [] };

  // Vergelijkt twee waarden.
  staat.check = (naam, werkelijk, verwacht) => {
    const a = JSON.stringify(werkelijk), b = JSON.stringify(verwacht);
    if (a === b) staat.ok++;
    else { staat.fout++; staat.bevindingen.push(`${naam}\n     kreeg:    ${a}\n     verwacht: ${b}`); }
  };

  // Verwacht dat een actie LUKT.
  staat.magWel = async (naam, actie) => {
    try { await actie(); staat.ok++; }
    catch (e) {
      staat.fout++;
      staat.bevindingen.push(`${naam}\n     werd geweigerd, maar had moeten lukken\n     (${e.code || e.message})`);
    }
  };

  // Verwacht dat een actie WORDT GEWEIGERD.
  staat.magNiet = async (naam, actie) => {
    try {
      await actie();
      staat.fout++;
      staat.bevindingen.push(`${naam}\n     LUKTE, maar had geweigerd moeten worden`);
    } catch (e) { staat.ok++; }
  };

  return staat;
}

function toonRapport(staat) {
  const merk = staat.fout === 0 ? '✓' : '✗';
  console.log(`\n ${merk} ${staat.titel}: ${staat.ok} ok, ${staat.fout} fout`);
  staat.bevindingen.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
  return staat.fout;
}

// Wacht tot een emulator bereikbaar is (CI start hem parallel op).
async function wachtOpPoort(poort, seconden = 60) {
  const net = require('net');
  for (let i = 0; i < seconden * 2; i++) {
    const bereikbaar = await new Promise(res => {
      const s = net.connect({ host: '127.0.0.1', port: poort }, () => { s.end(); res(true); });
      s.on('error', () => res(false));
      s.setTimeout(500, () => { s.destroy(); res(false); });
    });
    if (bereikbaar) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Emulator op poort ${poort} is niet gestart binnen ${seconden} seconden.`);
}

module.exports = { maakRapport, toonRapport, wachtOpPoort };
