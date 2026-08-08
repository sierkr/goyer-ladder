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

module.exports = staat;
