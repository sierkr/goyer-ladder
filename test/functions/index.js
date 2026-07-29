// ============================================================
//  Goyer Golf MP Ladder — Cloud Functions
//  v3.0.0-11.108 — scorekaart-scan via Claude Vision
// ============================================================
//  Deployen vanuit de root folder van je project:
//    firebase deploy --only functions
//
//  Anthropic API key instellen (eenmalig):
//    firebase functions:secrets:set ANTHROPIC_API_KEY
// ============================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

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

/**
 * Voltooi de eerste-login. Zet het door de speler zelf gekozen wachtwoord en
 * handicap en markeert eersteLogin:false. Server-side via de Admin SDK, zodat er
 * GEEN auth/requires-recent-login kan optreden en er geen client-side reauth of
 * store.initieelWachtwoord nodig is (v3.0.4).
 *
 * Input:  { nieuwWachtwoord: string (>=6), hcp: number }
 * Output: { success: true } of throws HttpsError
 */
exports.voltooiEersteLogin = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const { auth, data } = request;

    // Stap 1: ingelogd?
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    }

    // Stap 2: invoer valideren
    const nieuwWachtwoord = data?.nieuwWachtwoord;
    if (typeof nieuwWachtwoord !== 'string' || nieuwWachtwoord.length < 6) {
      throw new HttpsError('invalid-argument', 'Wachtwoord moet minimaal 6 tekens zijn.');
    }
    const hcp = Math.round(Number(data?.hcp));
    if (!Number.isFinite(hcp) || hcp < -10 || hcp > 54) {
      throw new HttpsError('invalid-argument', 'Ongeldige handicap.');
    }

    // Stap 3: profiel bestaat en is daadwerkelijk een eerste-login?
    const spelerRef  = admin.firestore().doc(`spelers/${auth.uid}`);
    const spelerSnap = await spelerRef.get();
    if (!spelerSnap.exists) {
      throw new HttpsError('not-found', 'Speler niet gevonden in database.');
    }
    if (spelerSnap.data().eersteLogin !== true) {
      // Idempotent: al voltooid. Geen fout — voorkomt vastlopen bij dubbele tik
      // of een herhaalde aanroep na een netwerk-hapering.
      return { success: true, alVoltooid: true };
    }

    try {
      // Stap 4: Auth-wachtwoord zetten (Admin SDK — geen recentheidseis)
      await admin.auth().updateUser(auth.uid, { password: nieuwWachtwoord });

      // Stap 5: profiel bijwerken — hcp + eersteLogin:false
      await spelerRef.update({ hcp, eersteLogin: false });

      return { success: true };
    } catch (err) {
      console.error('voltooiEersteLogin fout:', err);
      throw new HttpsError('internal', 'Voltooien mislukt: ' + err.message);
    }
  }
);

// ============================================================
//  Wekelijkse inactiviteitsval — UITGESCHAKELD (v3.0.0-11.102)
//  Het activiteitssysteem wordt nu volledig client-side en
//  deterministisch berekend uit de partijhistorie (zie ladder.js,
//  verrijkMetActiviteit). De inactiviteit is een tijdelijke
//  weergave-demotie en muteert de opgeslagen competitierank niet,
//  dus deze scheduled functie is overbodig en zou conflicteren.
//  Als deze functie nog in de cloud draait: verwijder hem met
//    firebase deploy --only functions
//  (een ontbrekende export wordt bij deploy automatisch opgeruimd).
// ============================================================

// ============================================================
//  Scorekaart scannen — v3.0.0-11.108
//  Analyseert een foto van een golfscorekaart en extraheert
//  par en stroke index (SI) per hole via Claude Vision.
//
//  Setup (eenmalig):
//    firebase functions:secrets:set ANTHROPIC_API_KEY
//    → plak je Anthropic API key
//
//  Input:  { imageBase64: "...", mediaType: "image/jpeg" }
//  Output: { holes: [{ hole: 1, par: 4, si: 10 }, ...] }
// ============================================================
exports.scanScorekaart = onCall(
  { region: 'europe-west1', secrets: [anthropicKey], timeoutSeconds: 30 },
  async (request) => {
    const { auth, data } = request;

    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Je moet ingelogd zijn.');
    }

    const { imageBase64, mediaType } = data || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'imageBase64 ontbreekt.');
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const mType = validTypes.includes(mediaType) ? mediaType : 'image/jpeg';

    // Max 4MB base64 (~3MB afbeelding)
    if (imageBase64.length > 4 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Afbeelding te groot (max ~3MB).');
    }

    const apiKey = anthropicKey.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition',
        'ANTHROPIC_API_KEY is niet ingesteld. Draai: firebase functions:secrets:set ANTHROPIC_API_KEY');
    }

    const prompt = `Analyseer deze foto van een golf-scorekaart. Lees de PAR en Stroke Index (SI) voor elke hole.

Belangrijke instructies:
- Zoek de rij met "PAR" en de rij met "SI" of "HCP" of "Stroke Index"
- Geef het resultaat als een JSON array
- Gebruik ALLEEN de getallen die je op de kaart ziet, verzin niets
- Als je 9 holes ziet, geef 9 objecten. Als je 18 holes ziet, geef 18 objecten.
- Als je een waarde niet kunt lezen, gebruik null

Antwoord ALLEEN met de JSON array, geen uitleg, geen markdown:
[{"hole":1,"par":4,"si":10},{"hole":2,"par":3,"si":18}]`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mType, data: imageBase64 } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error('Anthropic API fout:', response.status, errBody);
        throw new HttpsError('internal', `API fout (${response.status})`);
      }

      const result = await response.json();
      const text = result.content?.[0]?.text || '';

      // Parse JSON uit het antwoord
      let holes;
      try {
        // Strip eventuele markdown code fences
        const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        holes = JSON.parse(clean);
      } catch(e) {
        console.error('JSON parse mislukt:', text);
        throw new HttpsError('internal', 'Kon de scorekaart niet lezen. Probeer een duidelijkere foto.');
      }

      // Validatie
      if (!Array.isArray(holes) || holes.length === 0) {
        throw new HttpsError('internal', 'Geen holes herkend. Probeer een duidelijkere foto.');
      }

      return { holes };
    } catch(e) {
      if (e instanceof HttpsError) throw e;
      console.error('scanScorekaart fout:', e);
      throw new HttpsError('internal', 'Scan mislukt: ' + e.message);
    }
  }
);
