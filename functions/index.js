// ============================================================
//  Goyer Golf MP Ladder — Cloud Functions
//  v3.0.0-11.2 — fase 11.2: wachtwoord reset via Admin SDK
// ============================================================
//  Deployen vanuit de root folder van je project:
//    firebase deploy --only functions
// ============================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

// v3.0.0-11.60: wachtwoord niet meer hardcoded — wordt geladen uit Firestore (ladder/config).
// Fallback naar 'MP2026' als het document of veld ontbreekt.
async function getInitieelWachtwoord() {
  try {
    const snap = await admin.firestore().doc('ladder/config').get();
    const w = snap.exists ? snap.data().initieelWachtwoord : null;
    return (typeof w === 'string' && w.length > 0) ? w : 'MP2026';
  } catch(e) {
    console.warn('getInitieelWachtwoord: Firestore read mislukt, fallback gebruikt:', e);
    return 'MP2026';
  }
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

    try {
      // Stap 5: Auth wachtwoord overschrijven
      const initieelWachtwoord = await getInitieelWachtwoord();
      await admin.auth().updateUser(targetUid, { password: initieelWachtwoord });

      // Stap 6: eersteLogin:true zodat speler verplicht profielflow krijgt
      await admin.firestore().doc(`spelers/${targetUid}`).update({
        eersteLogin: true
      });

      return {
        success: true,
        message: `Wachtwoord van ${target.data().naam} gereset naar ${initieelWachtwoord}`
      };
    } catch (err) {
      console.error('resetSpelerWachtwoord fout:', err);
      throw new HttpsError('internal', 'Reset mislukt: ' + err.message);
    }
  }
);
