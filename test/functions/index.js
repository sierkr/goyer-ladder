// ============================================================
//  Goyer Golf MP Ladder — Cloud Functions
//  v3.0.0-11.2 — fase 11.2: wachtwoord reset via Admin SDK
// ============================================================
//  Deployen vanuit de root folder van je project:
//    firebase deploy --only functions
// ============================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

// v3.0.0-11.63: wachtwoord wordt geladen uit Firestore (ladder/config).
// Geen fallback — gooit een HttpsError als het document of veld ontbreekt.
async function getInitieelWachtwoord() {
  const snap = await admin.firestore().doc('ladder/config').get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'ladder/config ontbreekt in Firestore — stel initieelWachtwoord in via het beheerscherm');
  }
  const w = snap.data().initieelWachtwoord;
  if (typeof w !== 'string' || w.length === 0) {
    throw new HttpsError('failed-precondition', 'initieelWachtwoord is leeg in ladder/config — stel het in via het beheerscherm');
  }
  return w;
}

/**
 * Reset een speler-wachtwoord naar het initiële wachtwoord.
 * Alleen aanroepbaar door een beheerder.
 *
 * Input:  { targetUid: "<uid_van_te_resetten_speler>" }
 * Output: { success: true } of throws HttpsError
 */
exports.resetSpelerWachtwoord = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const { auth, data } = request;

    // Stap 1: ingelogd?
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    }

    // Stap 2: target-uid meegestuurd?
    const targetUid = data?.targetUid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid ontbreekt of ongeldig.');
    }

    // Stap 3: aanroeper is beheerder?
    const caller = await admin.firestore().doc(`spelers/${auth.uid}`).get();
    if (!caller.exists || caller.data().rol !== 'beheerder') {
      throw new HttpsError('permission-denied', 'Alleen een beheerder mag wachtwoorden resetten.');
    }

    // Stap 4: target-account bestaat?
    const target = await admin.firestore().doc(`spelers/${targetUid}`).get();
    if (!target.exists) {
      throw new HttpsError('not-found', 'Speler niet gevonden in database.');
    }

    // Stap 5: wachtwoord ophalen — gooit HttpsError('failed-precondition') als config ontbreekt.
    // Staat buiten de inner try/catch zodat die specifieke fout ongehinderd omhoog bubbelt.
    const initieelWachtwoord = await getInitieelWachtwoord();

    try {
      // Stap 6: Auth wachtwoord overschrijven
      await admin.auth().updateUser(targetUid, { password: initieelWachtwoord });

      // Stap 7: eersteLogin:true zodat speler verplicht profielflow krijgt
      await admin.firestore().doc(`spelers/${targetUid}`).update({
        eersteLogin: true
      });

      return {
        success: true,
        nieuwWachtwoord: initieelWachtwoord,
        message: `Wachtwoord van ${target.data().naam} gereset`
      };
    } catch (err) {
      console.error('resetSpelerWachtwoord fout:', err);
      throw new HttpsError('internal', 'Reset mislukt: ' + err.message);
    }
  }
);

// ============================================================
//  Wekelijkse inactiviteitsval — elke maandag om 06:00 CET
//  Berekent per ladder wie inactief is en past ranks aan.
// ============================================================
exports.wekelijkseDecay = onSchedule(
  { schedule: 'every monday 06:00', timeZone: 'Europe/Amsterdam', region: 'europe-west1' },
  async () => {
    const db = admin.firestore();
    const NOW = Date.now();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    const laddersSnap = await db.collection('ladders').get();

    for (const ladderDoc of laddersSnap.docs) {
      try {
        const ladderId = ladderDoc.id;
        const cfg = ladderDoc.data().config || {};

        if (!cfg.inactiviteitAan) continue;

        const drempelWeken = cfg.inactiviteitDrempelWeken ?? 3;

        const standenSnap = await db.collection('ladders').doc(ladderId).collection('standen').get();
        if (standenSnap.empty) continue;

        const spelers = standenSnap.docs.map(d => ({ uid: d.id, ref: d.ref, ...d.data() }));
        spelers.sort((a, b) => (a.rank || 999) - (b.rank || 999));

        // Bereken inactieve weken en decay per speler
        const metDecay = spelers.map(s => {
          const lastPlayed = s.laatstGespeeld || 0;
          const weeksInactive = lastPlayed > 0
            ? Math.floor((NOW - lastPlayed) / WEEK_MS)
            : 52; // nooit gespeeld = max inactiviteit

          let decay = 0;
          const overschrijding = weeksInactive - drempelWeken;
          if (overschrijding >= 3) decay = 6;
          else if (overschrijding === 2) decay = 4;
          else if (overschrijding === 1) decay = 2;
          else if (overschrijding === 0) decay = 1;

          return { ...s, weeksInactive, decay };
        });

        // Pas ranks aan: hogere rank = lager in de lijst
        // Voeg decay toe aan ranknummer, re-normaliseer daarna
        const nieuweRanks = metDecay.map(s => ({
          uid: s.uid,
          ref: s.ref,
          weeksInactive: s.weeksInactive,
          nieuweRankScore: (s.rank || 999) + s.decay,
        }));

        nieuweRanks.sort((a, b) => a.nieuweRankScore - b.nieuweRankScore);

        const batch = db.batch();
        nieuweRanks.forEach((s, idx) => {
          batch.update(s.ref, {
            rank: idx + 1,
            inactieveWeken: s.weeksInactive,
          });
        });

        // Maandpartijen resetten als het een nieuwe maand is
        const maandKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
        metDecay.forEach(s => {
          if (s.maandKey !== maandKey) {
            batch.update(s.ref, { maandPartijen: 0, maandKey });
          }
        });

        await batch.commit();
        console.log(`[wekelijkseDecay] Ladder ${ladderId}: ${spelers.length} spelers verwerkt`);
      } catch (e) {
        console.error(`[wekelijkseDecay] fout bij ladder ${ladderDoc.id}:`, e.message);
      }
    }

    return null;
  }
);
