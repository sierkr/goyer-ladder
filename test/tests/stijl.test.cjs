// ============================================================
//  Weergavestijl — automatische tests  (v5.34.1)
// ============================================================
//  Sierk, 16 september 2026: "in beheer springt het UI continu terug naar
//  helder." Oorzaak: de regel "welke clubstijl is dit" stond op TWEE plekken.
//  In js/config.js klopte hij; de meeluisteraar op ladder/config in js/auth.js
//  had een eigen versie uit v5.6.0 die maar twee stijlen kende:
//
//      (uiStijl === 'club') ? 'club' : 'matchcheck'
//
//  Papier werd daardoor meteen weer Helder. Deze tests leggen de ENE regel vast
//  en worden uit de echte code geknipt, dus ze bewegen mee.
// ============================================================
const { laadStijlKern, maakChecker } = require('./harnas.cjs');
const S = laadStijlKern();
const { staat, check } = maakChecker();

console.log('\n══ WELKE CLUBSTIJL IS DIT ══');

check('club blijft Klassiek',        S.normaliseerClubStijl('club'), 'club');
check('matchcheck blijft Helder',    S.normaliseerClubStijl('matchcheck'), 'matchcheck');
//  ⚠ Dit is de test die de fout van v5.27.0 tot v5.34.0 vangt.
check('papier blijft Papier',        S.normaliseerClubStijl('papier'), 'papier');

check('onzin wordt Helder',          S.normaliseerClubStijl('paars'), 'matchcheck');
check('leeg wordt Helder',           S.normaliseerClubStijl(''), 'matchcheck');
check('niets wordt Helder',          S.normaliseerClubStijl(null), 'matchcheck');
check('ontbrekend wordt Helder',     S.normaliseerClubStijl(undefined), 'matchcheck');
check('een getal wordt Helder',      S.normaliseerClubStijl(3), 'matchcheck');

//  Elke stijl uit de lijst moet zichzelf blijven — zo neemt een vierde stijl
//  deze test vanzelf mee in plaats van stil te blijven staan.
let allemaalZichzelf = true;
S.STIJLEN.forEach(st => { if (S.normaliseerClubStijl(st) !== st) allemaalZichzelf = false; });
check('elke stijl uit de lijst blijft zichzelf', allemaalZichzelf, true);
check('er zijn drie stijlen', S.STIJLEN.length, 3);

module.exports = staat;
