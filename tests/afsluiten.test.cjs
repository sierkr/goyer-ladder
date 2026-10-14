// ============================================================
//  Dag afsluiten — automatische tests (v6.1.3)
// ============================================================
//  WAAROM DEZE SUITE BESTAAT
//
//  Gemeten 14 oktober 2026: "Dag afsluiten" vlak na het starten van een dag
//  ging 1 van de 3 keer stil verloren. Het scherm zei "Dag 1 afgesloten",
//  maar op de server stond de dag nog open — zonder vastgelegde scores en
//  handicaps.
//
//  De oorzaak: sluitDagAf() wacht op de vraag "Dag x afsluiten?" en daarna op
//  het ophalen van de live-scores. In die tussentijd vervangt de meeluisteraar
//  `toernooiData` door een verse serverkopie. De functie schreef `afgerond` in
//  het OUDE object en sloeg het NIEUWE op. Zelfde fout als startDag() had
//  (v5.15.0).
//
//  Een browserproef kon dat toeval niet betrouwbaar opwekken. Deze suite
//  bestuurt het precies: de test vervangt `toernooiData` op het moment van de
//  vraag en op het moment van het lezen, zoals de meeluisteraar dat doet.
//  sluitDagAf() en slaToernooiOp() zijn ECHT uit de app geknipt.
// ============================================================
const { laadAfsluitKern, maakChecker } = require('./harnas.cjs');
const { staat, check } = maakChecker();

const kopie = (v) => JSON.parse(JSON.stringify(v));
const kaart = (n) => Array.from({ length: 18 }, () => n);

// Een toernooi met één lopende dag (of twee, voor de meerdaagse proef).
function toernooi({ dagen = 1, lopend = 1 } = {}) {
  return {
    id: 't1',
    naam: 'Clubkampioenschap',
    spelers: [
      { uid: 'roy', naam: 'Roy', hcp: 16.4 },
      { uid: 'ton', naam: 'Ton', hcp: 22.1 },
    ],
    dagen: Array.from({ length: dagen }, (_, i) => ({
      dagNr: i + 1,
      gestart: i + 1 <= lopend,
      afgerond: i + 1 < lopend,
      scores: {},
    })),
  };
}

// De live-documenten op de server: Roy en Ton hebben hun kaart ingevuld.
const serverLive = (dagNr = 1) => ({
  roy: { dagen: { [String(dagNr)]: kaart(5) } },
  ton: { dagen: { [String(dagNr)]: kaart(6) } },
});

// Zet een kern klaar en sluit dag af. `meeluisteraar` mag op twee momenten
// toeslaan: 'vraag' (terwijl "Dag x afsluiten?" openstaat) of 'lezen' (terwijl
// de live-scores worden opgehaald).
async function sluitAf({ t = toernooi(), dagNr = 1, moment = null, vervang = null,
                         antwoord = true, leesFout = false, lokaal = {} } = {}) {
  const K = laadAfsluitKern();
  K._zetToernooi(t);
  K._zetServer(serverLive(dagNr));
  K._zetLive(lokaal);
  K._zetAntwoord(antwoord);
  K._zetLeesFout(leesFout);
  // De meeluisteraar: een verse kopie van wat de server heeft, met eventueel
  // een wijziging van een ander toestel erin.
  const slaToe = () => K._zetToernooi(vervang ? vervang(kopie(t)) : kopie(t));
  if (moment === 'vraag') K._zetTijdensVraag(slaToe);
  if (moment === 'lezen') K._zetTijdensLezen(slaToe);
  await K.sluitDagAf();
  return K;
}

const opgeslagenDag = (K, dagNr = 1) =>
  K._opgeslagen.length ? K._opgeslagen[K._opgeslagen.length - 1].dagen.find(d => d.dagNr === dagNr) : null;

module.exports = (async () => {
  // ── Gewoon afsluiten ─────────────────────────────────────
  console.log('\n══ GEWOON AFSLUITEN ══\n');
  {
    const K = await sluitAf();
    const d = opgeslagenDag(K);
    check('één keer opgeslagen', K._opgeslagen.length, 1);
    check('de dag staat op de server als afgesloten', d && d.afgerond, true);
    check('de uitslag is zichtbaar', d && d.uitslagZichtbaar, true);
    check('de scores van Roy zijn vastgelegd', d && d.scores.roy, kaart(5));
    check('de scores van Ton zijn vastgelegd', d && d.scores.ton, kaart(6));
    check('de playing handicap van Roy is vastgelegd', d && d.playingHcp.roy.waarde, 16.4);
    check('… en waar hij vandaan kwam', d && d.playingHcp.roy.door, 'exact');
    check('melding op het scherm', K._meldingen, ['Dag 1 afgesloten']);
    check('geen fout', K._fouten, []);
  }

  // ── De kern van de fout ──────────────────────────────────
  console.log('\n══ DE MEELUISTERAAR SLAAT TOE TIJDENS DE VRAAG ══\n');
  {
    const K = await sluitAf({ moment: 'vraag' });
    const d = opgeslagenDag(K);
    check('de dag staat op de server als afgesloten', d && d.afgerond, true);
    check('de scores zijn vastgelegd', d && d.scores.roy, kaart(5));
    check('de playing handicap is vastgelegd', d && d.playingHcp && d.playingHcp.ton && d.playingHcp.ton.waarde, 22.1);
    check('ook het scherm ziet de dag als afgesloten', K._leesToernooi().dagen[0].afgerond, true);
  }

  console.log('\n══ DE MEELUISTERAAR SLAAT TOE TIJDENS HET LEZEN ══\n');
  {
    const K = await sluitAf({ moment: 'lezen' });
    const d = opgeslagenDag(K);
    check('de dag staat op de server als afgesloten', d && d.afgerond, true);
    check('de scores zijn vastgelegd', d && d.scores.ton, kaart(6));
    check('de playing handicap is vastgelegd', d && d.playingHcp && d.playingHcp.roy && d.playingHcp.roy.waarde, 16.4);
    check('ook het scherm ziet de dag als afgesloten', K._leesToernooi().dagen[0].afgerond, true);
    check('melding op het scherm', K._meldingen, ['Dag 1 afgesloten']);
  }

  // Een wijziging van een ander toestel in de verse kopie mag niet verdwijnen.
  console.log('\n══ EEN WIJZIGING VAN EEN ANDER TOESTEL BLIJFT STAAN ══\n');
  {
    const K = await sluitAf({ moment: 'lezen', vervang: (v) => { v.naam = 'Clubkampioenschap 2026'; return v; } });
    const opgeslagen = K._opgeslagen[0];
    check('de nieuwe naam blijft', opgeslagen && opgeslagen.naam, 'Clubkampioenschap 2026');
    check('en de dag is afgesloten', opgeslagen && opgeslagen.dagen[0].afgerond, true);
  }

  // ── Meerdaags ────────────────────────────────────────────
  console.log('\n══ MEERDAAGS: DAG 2 AFSLUITEN ══\n');
  {
    const t = toernooi({ dagen: 3, lopend: 2 });
    t.dagen[0].scores = { roy: kaart(4) };
    const K = await sluitAf({ t, dagNr: 2, moment: 'lezen' });
    check('dag 2 is afgesloten', opgeslagenDag(K, 2) && opgeslagenDag(K, 2).afgerond, true);
    check('dag 2 kreeg de scores van dag 2', opgeslagenDag(K, 2) && opgeslagenDag(K, 2).scores.roy, kaart(5));
    check('dag 1 bleef zoals hij was', opgeslagenDag(K, 1) && opgeslagenDag(K, 1).scores, { roy: kaart(4) });
    check('dag 3 bleef dicht', opgeslagenDag(K, 3) && opgeslagenDag(K, 3).afgerond, false);
  }

  // ── Wat er NIET mag gebeuren ─────────────────────────────
  console.log('\n══ NIETS OPSLAAN ALS HET NIET KAN ══\n');
  {
    const K = await sluitAf({ antwoord: false });
    check('"Annuleren": niets opgeslagen', K._opgeslagen.length, 0);
    check('"Annuleren": de dag blijft open', K._leesToernooi().dagen[0].afgerond, false);
  }
  {
    const K = await sluitAf({ moment: 'lezen', vervang: (v) => { v.dagen = []; return v; } });
    check('dag ondertussen verdwenen: niets opgeslagen', K._opgeslagen.length, 0);
    check('dag ondertussen verdwenen: een melding', K._meldingen.some(m => m.includes('verdwenen')), true);
    check('dag ondertussen verdwenen: geen fout', K._fouten, []);
  }

  // ── Geen verbinding bij het lezen ────────────────────────
  console.log('\n══ LEZEN MISLUKT: DE LOKALE SCORES ══\n');
  {
    const K = await sluitAf({ leesFout: true, lokaal: { roy: { dagen: { '1': kaart(7) } } } });
    const d = opgeslagenDag(K);
    check('de dag is toch afgesloten', d && d.afgerond, true);
    check('met de scores die dit toestel had', d && d.scores.roy, kaart(7));
  }

  return staat;
})();
