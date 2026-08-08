// ============================================================
//  Testdata klaarzetten voor de browsertests
// ============================================================
//  Maakt echte Auth-accounts en Firestore-documenten in de emulator, zodat de
//  browsertests met een gewoon wachtwoord kunnen inloggen.
// ============================================================
process.env.FIRESTORE_EMULATOR_HOST     = process.env.FIRESTORE_EMULATOR_HOST     || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const admin = require('firebase-admin');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-goyer';
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const WACHTWOORD = 'test1234';
const HOLES = Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 }));

// Let op: `nieuw` heeft eersteLogin:true — dat is het scenario waarin de
// standen-listener in v5.3.0 niet startte en de ladder leeg bleef.
const SPELERS = [
  { sleutel: 'coord',  naam: 'Coen Coordinator', rol: 'coordinator', hcp: 10, eersteLogin: false },
  { sleutel: 'anna',   naam: 'Anna Speler',      rol: 'speler',      hcp: 12, eersteLogin: false },
  { sleutel: 'bram',   naam: 'Bram Speler',      rol: 'speler',      hcp: 14, eersteLogin: false },
  { sleutel: 'cees',   naam: 'Cees Speler',      rol: 'speler',      hcp: 16, eersteLogin: false },
  { sleutel: 'nieuw',  naam: 'Nina Nieuw',       rol: 'speler',      hcp: 18, eersteLogin: true  },
];

async function main() {
  const uids = {};

  for (const s of SPELERS) {
    const email = `${s.sleutel}@MPladder.stb`;
    let user;
    try { user = await admin.auth().getUserByEmail(email); }
    catch { user = await admin.auth().createUser({ email, password: WACHTWOORD, displayName: s.naam }); }
    uids[s.sleutel] = user.uid;
    await db.doc(`spelers/${user.uid}`).set({
      uid: user.uid, naam: s.naam, email, rol: s.rol, hcp: s.hcp, eersteLogin: s.eersteLogin,
    });
  }

  const alle = Object.values(uids);
  await db.doc('ladders/mp').set({
    naam: 'MP',
    spelerIds: alle,
    uitslagen: [],
    actievePartijen: [],
    config: {
      laagStijg: 4, laagZak: 2, hoogStijg: 1, hoogZak: 1, verliezerNaarWinnaar: false, drempel: 4,
      inactiviteitAan: false, frequentieBonusAan: false, diversiteitsBonusAan: false,
      icoonAan: true, activiteitPeriode: 'maand',
    },
  });

  // Standen met duidelijke, herkenbare rangen — zo ziet een test meteen of de
  // echte stand wordt getoond of een lege lijst met rang 0.
  await Promise.all(alle.map((uid, i) =>
    db.doc(`ladders/mp/standen/${uid}`).set({ rank: i + 1, partijen: 4, gewonnen: 2 })
  ));

  await db.doc('ladder/config').set({ initieelWachtwoord: WACHTWOORD });
  await db.doc('ladder/banen').set({
    lijst: [{ naam: 'De Goyer', aangemaakt_door: 'systeem', holes: HOLES }],
  });

  console.log(JSON.stringify({ uids, wachtwoord: WACHTWOORD }, null, 2));
}

main().catch(e => { console.error('Seed mislukt:', e); process.exit(1); });
