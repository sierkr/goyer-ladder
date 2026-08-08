// ============================================================
//  Puntensysteem en matchstand — automatische tests
// ============================================================
const { laadLadderKern, maakChecker } = require('./harnas.cjs');
const F = laadLadderKern();
const { staat, check } = maakChecker();
// Haal de pure functies uit functions/index.js zonder firebase-admin te laden.


// ── 1. HCP-slagen per hole ────────────────────────────────
const holes18=Array.from({length:18},(_,i)=>({par:4,si:i+1}));
check('hcp 0 slagen', F._hcpSlagenOpHole({hcpSlagen:0},holes18,0), 0);
check('hcp 5 slagen op si1', F._hcpSlagenOpHole({hcpSlagen:5},holes18,0), 1);
check('hcp 5 slagen op si6', F._hcpSlagenOpHole({hcpSlagen:5},holes18,5), 0);
check('hcp 20 slagen op si1 (dubbel)', F._hcpSlagenOpHole({hcpSlagen:20},holes18,0), 2);
check('hcp 20 slagen op si3', F._hcpSlagenOpHole({hcpSlagen:20},holes18,2), 1);

// ── 2. Matchstand ─────────────────────────────────────────
const mu={spelerA:{uid:'A'},spelerB:{uid:'B'},hcpOntvanger:'B',hcpSlagen:0};
const leeg=new Array(18).fill(null);
check('geen scores -> 0', F._berekenStand(mu,holes18,leeg,leeg), {standA:0,gespeeld:0});
const sA=[...leeg], sB=[...leeg];
sA[0]=4; sB[0]=5;             // A wint hole 1
check('A 1 up na 1 hole', F._berekenStand(mu,holes18,sA,sB), {standA:1,gespeeld:1});
sA[1]=5; sB[1]=4;             // B wint hole 2 -> all square
check('all square', F._berekenStand(mu,holes18,sA,sB), {standA:0,gespeeld:2});
// Beslist: A wint holes 1..10, B niets -> 10 up met 8 te gaan
const dA=new Array(18).fill(null), dB=new Array(18).fill(null);
for(let i=0;i<10;i++){dA[i]=3;dB[i]=5;}
const beslist=F._berekenStand(mu,holes18,dA,dB);
check('beslist bevroren stand', beslist.standA>0 && beslist.gespeeld===10, true);
// HCP-slag draait de uitslag om
const hA=[...leeg], hB=[...leeg];
hA[0]=4; hB[0]=5;
check('zonder slag wint A', F._berekenStand({...mu,hcpSlagen:0},holes18,hA,hB).standA, 1);
check('met slag voor B is het gelijk', F._berekenStand({...mu,hcpSlagen:18},holes18,hA,hB).standA, 0);

// ── 3. Activiteit op uid vs naam ──────────────────────────
const cfg={inactiviteitReferentiedatum:'2020-01-01',inactiviteitAan:true,inactiviteitDrempelWeken:4,
           inactiviteitModel:'zacht',frequentieBonusAan:true,frequentieBonusPartijen:3,frequentieBonusPlekken:1,
           diversiteitsBonusAan:true,diversiteitsBonusDrempel:6,diversiteitsBonusPlekken:2};
const nu=Date.now();
// Twee spelers met DEZELFDE naam, verschillende uid — dit ging vroeger mis.
const spelersDocs={u1:'Jan de Vries', u2:'Jan de Vries', u3:'Piet Bakker'};
const naamNaarUid=F.bouwNaamNaarUid(spelersDocs);
check('dubbele naam niet vertaald', naamNaarUid['jan de vries'], undefined);
check('unieke naam wel vertaald', naamNaarUid['piet bakker'], 'u3');

const uitslagenNieuw=[{scoreTs:nu-1000, spelerUids:['u1','u3'], matchupUids:[{a:'u1',b:'u3'}]}];
const st=F.berekenActiviteitsStats(uitslagenNieuw,[],cfg,nu,naamNaarUid);
check('u1 heeft activiteit', st['u1'].laatst!==null, true);
check('u2 (zelfde naam) heeft GEEN activiteit', st['u2']===undefined, true);
check('u3 heeft activiteit', st['u3'].laatst!==null, true);

// Legacy-uitslag op naam blijft werken
const uitslagenOud=[{scoreTs:nu-1000, spelers:['Piet Bakker'], matchups:[{a:'Piet Bakker',b:'Jan de Vries'}]}];
const st2=F.berekenActiviteitsStats(uitslagenOud,[],cfg,nu,naamNaarUid);
check('legacy naam vertaald naar uid', st2['u3']!==undefined, true);
check('legacy dubbele naam valt terug op naam', st2['Jan de Vries']!==undefined, true);

// ── 4. Score per positie ──────────────────────────────────
check('positie 1', F.scoreVoorPositie(1), 1000000);
check('positie 5', F.scoreVoorPositie(5), 999600);
check('positie oplopend = score aflopend', F.scoreVoorPositie(2) > F.scoreVoorPositie(3), true);

// ── 5. PIN-hash ───────────────────────────────────────────
check('hash stabiel', F.hashPin('123456')===F.hashPin('123456'), true);
check('hash verschilt', F.hashPin('123456')!==F.hashPin('123457'), true);
check('hash is geen plaintext', F.hashPin('123456').includes('123456'), false);

module.exports = staat;
