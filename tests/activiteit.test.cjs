// ============================================================
//  Activiteitssysteem — automatische tests
// ============================================================
const { laadLadderKern, maakChecker } = require('./harnas.cjs');
const F = laadLadderKern();
const { staat, check } = maakChecker();

const cfg={laagStijg:4,laagZak:2,hoogStijg:1,hoogZak:1,verliezerNaarWinnaar:false,drempel:4,
  inactiviteitAan:true,inactiviteitReferentiedatum:'2020-01-01',inactiviteitDrempelWeken:4,
  inactiviteitModel:'zacht',frequentieBonusAan:true,frequentieBonusPartijen:3,frequentieBonusPlekken:1,
  diversiteitsBonusAan:true,diversiteitsBonusDrempel:6,diversiteitsBonusPlekken:2,activiteitPeriode:'maand'};
const nu=Date.now(), week=7*24*3600*1000;
const leeg={laatst:null,maand:0,opp:new Set()};
const S=(o)=>({u:{...leeg,...o}});

// ── Doelverschuiving: maxima blijven werken ──────────────────
check('actief, geen bonus -> 0', F.doelVerschuivingVoorSpeler('u',S({laatst:nu}),cfg,null,5,50,nu), 0);
check('4 wk stil -> -1',  F.doelVerschuivingVoorSpeler('u',S({laatst:nu-4*week}),cfg,null,5,50,nu), -1);
check('8 wk stil -> -5',  F.doelVerschuivingVoorSpeler('u',S({laatst:nu-8*week}),cfg,null,5,50,nu), -5);
check('12 wk stil -> -6 (max)', F.doelVerschuivingVoorSpeler('u',S({laatst:nu-12*week}),cfg,null,5,50,nu), -6);
check('52 wk stil -> -6 (max blijft)', F.doelVerschuivingVoorSpeler('u',S({laatst:nu-52*week}),cfg,null,5,50,nu), -6);
const mid={...cfg,inactiviteitModel:'middel'};
check('middel 20 wk -> -14 (max)', F.doelVerschuivingVoorSpeler('u',S({laatst:nu-20*week}),mid,null,5,50,nu), -14);

// ── Bonussen ─────────────────────────────────────────────────
check('frequentiebonus +1', F.doelVerschuivingVoorSpeler('u',S({laatst:nu,maand:5}),cfg,null,5,50,nu), 1);
check('diversiteitsbonus +2', F.doelVerschuivingVoorSpeler('u',S({laatst:nu,opp:new Set(['a','b','c','d','e','f','g'])}),cfg,null,5,50,nu), 2);
check('beide bonussen +3', F.doelVerschuivingVoorSpeler('u',S({laatst:nu,maand:5,opp:new Set(['a','b','c','d','e','f','g'])}),cfg,null,5,50,nu), 3);
check('bonus uitgezet -> 0', F.doelVerschuivingVoorSpeler('u',S({laatst:nu,maand:9}),{...cfg,frequentieBonusAan:false},null,5,50,nu), 0);
check('inactiviteit uitgezet -> geen straf', F.doelVerschuivingVoorSpeler('u',S({laatst:nu-52*week}),{...cfg,inactiviteitAan:false},null,5,50,nu), 0);

// ── Model 'fors': naar onderaan, en exact terugklimmen ───────
const fors={...cfg,inactiviteitModel:'fors'};
check('fors inactief op plek 10 van 50 -> -40',
  F.doelVerschuivingVoorSpeler('u',S({laatst:null}),fors,null,10,50,nu), -40);
check('fors al onderaan -> 0', F.doelVerschuivingVoorSpeler('u',S({laatst:null}),fors,null,50,50,nu), 0);
check('fors actief -> alleen bonus', F.doelVerschuivingVoorSpeler('u',S({laatst:nu,maand:5}),fors,null,50,50,nu), 1);

// ── Kern: opstapelen mag NIET meer gebeuren ──────────────────
// Maandelijkse runs, speler blijft stil. Alleen het verschil wordt toegepast.
let verschoven=0, totaalToegepast=0;
for(let run=1;run<=12;run++){
  const doel=F.doelVerschuivingVoorSpeler('u',S({laatst:nu-run*4*week}),cfg,null,5,50,nu);
  const stap=doel-verschoven; verschoven=doel; totaalToegepast+=stap;
}
check('12 maanden stil: totaal verschoven = -6, niet -70', totaalToegepast, -6);
check('boekhouding staat op -6', verschoven, -6);

// Speelt weer -> klimt in een keer terug plus bonus
const doelTerug=F.doelVerschuivingVoorSpeler('u',S({laatst:nu,maand:5,opp:new Set(['a','b','c','d','e','f','g'])}),cfg,null,5,50,nu);
check('terugkeer: doel = +3', doelTerug, 3);
check('terugkeer: stap = +9 (van -6 naar +3)', doelTerug-verschoven, 9);

// ── Diversiteit telt nu per maand ────────────────────────────
const d=new Date(nu);
const dezeMaand=new Date(d.getFullYear(),d.getMonth(),15).getTime();
const vorigJaar =new Date(d.getFullYear()-1,d.getMonth(),15).getTime();
const mk=(ts,opp)=>({scoreTs:ts,spelerUids:['u1'],matchupUids:opp.map(o=>({a:'u1',b:o}))});
const statNieuw=F.berekenActiviteitsStats(
  [mk(dezeMaand,['a','b','c']), mk(vorigJaar,['d','e','f','g','h','i','j'])],[],cfg,nu,{});
check('oude tegenstanders tellen niet meer mee', statNieuw['u1'].opp.size, 3);

// ── v5.41.0: een spelvorm die niet meetelt, telt ook hier niet ──
// Anders verschuift zo'n partij de speler alsnog, via de bonus.
const statMee = F.berekenActiviteitsStats(
  [mk(dezeMaand,['a','b','c']), { ...mk(dezeMaand,['d','e']), teltMee:false }],[],cfg,nu,{});
check('teltMee:false geeft geen tegenstanders', statMee['u1'].opp.size, 3);
check('teltMee:false telt niet als partij',     statMee['u1'].maand, 1);

// ── v6.2.0: spelers zonder partijen onderaan ─────────────────
// Sierk, 30 okt 2026: "iedereen met 0 partijen onder de groep die wel gespeeld heeft".
{
  const Z = F.zonderPartijenOnderaan;
  const L = [{uid:'a',partijen:0},{uid:'b',partijen:3},{uid:'c',partijen:0},{uid:'d',partijen:1},{uid:'e'}];
  const ids = l => l.map(x => x.uid).join('');
  check('onderaan: uit -> volgorde ongewijzigd', ids(Z(L,false)), 'abcde');
  check('onderaan: aan -> spelers met partijen boven', ids(Z(L,true)), 'bdace');
  check('onderaan: niemand verdwijnt of staat dubbel', Z(L,true).length === 5 && new Set(Z(L,true)).size === 5, true);
  check('onderaan: invoer niet aangepast', ids(L), 'abcde');
  check('onderaan: iedereen 0 (begin seizoen) -> niets verandert', ids(Z([{uid:'x',partijen:0},{uid:'y',partijen:0}],true)), 'xy');
  check('onderaan: iedereen gespeeld -> niets verandert', ids(Z([{uid:'x',partijen:2},{uid:'y',partijen:1}],true)), 'xy');
  check('onderaan: verliezer met 1e partij komt boven alle nullen', ids(Z([{uid:'p',partijen:0},{uid:'q',partijen:0},{uid:'v',partijen:1}],true)), 'vpq');
  check('onderaan: twee keer toepassen = één keer', ids(Z(Z(L,true),true)), 'bdace');

  // Bedrading: de regel moet op alle vier de plekken staan die posities
  // wegschrijven, en de schakelaar in Beheer moet worden gelezen én bewaard.
  const fsx = require('fs'), px = require('path');
  const lees = f => fsx.readFileSync(px.join(__dirname, '..', f), 'utf8');
  const srv = lees('functions/index.js');
  check('onderaan: server past de regel op 4 plekken toe',
    (srv.match(/cfg\.zonderPartijenOnderaan === true/g) || []).length, 4);
  check('onderaan: server-standaard staat uit', /zonderPartijenOnderaan: false,/.test(srv), true);
  check('onderaan: app-standaard staat uit', /zonderPartijenOnderaan: false,/.test(lees('js/store.js')), true);
  check('onderaan: schakelaar staat in het scherm', /id="cfg-zonder-partijen-onderaan"/.test(lees('index.html')), true);
  const bh = lees('js/beheer.js');
  check('onderaan: Beheer leest én bewaart de schakelaar',
    (bh.match(/cfg-zonder-partijen-onderaan/g) || []).length, 2);
}

module.exports = staat;
