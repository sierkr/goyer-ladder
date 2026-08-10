// ============================================================
//  Partijverwerking (ladder) — automatische tests
// ============================================================
const { maakChecker } = require('./harnas.cjs');
const { staat, check } = maakChecker();

// Partijverwerking exact zoals in verwerkPartijUitslag (v5.1.0), incl. begrenzing.
function maakVerwerker(cfg,N,spelers){
  return function(rank,winnaar,verliezer){
    let werk=spelers.map(u=>({uid:u,rank:rank[u]}));
    werk.sort((a,b)=>a.rank-b.rank); werk.forEach((s,i)=>{s.rank=i+1;});
    const sw=werk.find(s=>s.uid===winnaar), sv=werk.find(s=>s.uid===verliezer);
    const swR=sw.rank, svR=sv.rank; const n=werk.length; let nw,nv;
    if(swR>svR){ nw=Math.max(1,swR-cfg.laagStijg);
      nv=(cfg.verliezerNaarWinnaar && swR-svR<=cfg.drempel)?swR:svR+cfg.laagZak; }
    else { nw=Math.max(1,swR-cfg.hoogStijg); nv=svR+cfg.hoogZak; }
    nw=Math.min(n,Math.max(1,nw)); nv=Math.min(n,Math.max(1,nv));
    if(nw===nv){ if(nv<n) nv+=1; else if(nw>1) nw-=1; }
    const res=new Set([nw,nv]); const besch=[];
    for(let r=1;r<=n;r++) if(!res.has(r)) besch.push(r);
    werk.filter(s=>s!==sw&&s!==sv).sort((a,b)=>a.rank-b.rank).forEach((s,i)=>{s.rank=besch[i];});
    sw.rank=nw; sv.rank=nv;
    const uit={}; werk.forEach(s=>{uit[s.uid]=s.rank;}); return uit;
  };
}

function geldig(rank,N,label){
  const r=Object.values(rank).sort((a,b)=>a-b);
  const verwacht=Array.from({length:N},(_,i)=>i+1);
  check(label+' posities 1..'+N, r, verwacht);
}

const cfg={laagStijg:4,laagZak:2,hoogStijg:1,hoogZak:1,verliezerNaarWinnaar:false,drempel:4};

// ── Scenario van de melding ──────────────────────────────────
const N=50, spelers=Array.from({length:N},(_,i)=>'u'+(i+1));
const verwerk=maakVerwerker(cfg,N,spelers);
let rank={}; spelers.forEach((u,i)=>{rank[u]=i+1;});
console.log('Ewout (1e) wint 6x van Sierk (48e):');
let vorig=rank['u48'];
for(let p=1;p<=6;p++){
  rank=verwerk(rank,'u1','u48');
  const na=rank['u48'];
  check(`partij ${p}: verliezer stijgt niet`, na>=vorig, true);
  console.log(`  partij ${p}: ${vorig} -> ${na}`);
  geldig(rank,N,`partij ${p}`);
  vorig=na;
}
check('verliezer blijft binnen de ladder', rank['u48']<=N, true);

// ── Winnen levert exact laagStijg op ─────────────────────────
let r2={}; spelers.forEach((u,i)=>{r2[u]=i+1;});
const tegen=Object.entries(r2).find(([u,r])=>r===44)[0];
r2=verwerk(r2,'u48',tegen);
check('lager wint van hoger: stijgt laagStijg', 48-r2['u48'], cfg.laagStijg);
check('verliezer zakt laagZak', r2[tegen]-44, cfg.laagZak);

// ── Randgevallen ─────────────────────────────────────────────
const kl=['a','b']; const vk=maakVerwerker(cfg,2,kl);
let r3={a:1,b:2};
r3=vk(r3,'b','a'); check('ladder van 2: b wint', [r3.b,r3.a], [1,2]); geldig(r3,2,'ladder van 2');
r3=vk(r3,'a','b'); check('ladder van 2: a wint terug', [r3.a,r3.b], [1,2]);

const nul={...cfg,hoogStijg:0,hoogZak:0};
const vn=maakVerwerker(nul,3,['x','y','z']);
let r4={x:1,y:2,z:3};
r4=vn(r4,'x','y'); geldig(r4,3,'nul-stijging');
check('nul-stijging: winnaar boven verliezer', r4.x<r4.y, true);

// Laatste speler wint van eerste
let r5={}; spelers.forEach((u,i)=>{r5[u]=i+1;});
r5=verwerk(r5,'u50','u1');
geldig(r5,N,'laatste wint van eerste');
check('laatste stijgt laagStijg', 50-r5['u50'], cfg.laagStijg);

module.exports = staat;

// ============================================================
//  v5.7.0 — AMERIKAANTJE EN HIGH-LOW
// ============================================================
//  De echte functies uit functions/index.js, niet een namaakversie.
const fs_ = require('fs'), path_ = require('path');
const _fnBron = fs_.readFileSync(path_.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
function _knipFn(naam) {
  const re = new RegExp('^function ' + naam + '\\([\\s\\S]*?\\n\\}', 'm');
  const m = _fnBron.match(re);
  if (!m) throw new Error("Functie '" + naam + "' niet gevonden in functions/index.js");
  return m[0];
}
const _kern = new Function(
  _knipFn('verschuivingAmerikaantje') + _knipFn('winstAmerikaantje') +
  _knipFn('verschuivingHighlow') + _knipFn('verschuifAllemaal') +
  'return { verschuivingAmerikaantje, winstAmerikaantje, verschuivingHighlow, verschuifAllemaal };'
)();

console.log('\n══ AMERIKAANTJE — VERSCHUIVING ══');
check('1e/2e/3e',            _kern.verschuivingAmerikaantje([1,2,3]), [2,0,-2]);
check('gedeeld eerste',      _kern.verschuivingAmerikaantje([1,1,3]), [1,1,-2]);
check('gedeeld tweede',      _kern.verschuivingAmerikaantje([1,2,2]), [2,-1,-1]);
check('alle drie gelijk',    _kern.verschuivingAmerikaantje([1,1,1]), [0,0,0]);
check('volgorde maakt niet uit', _kern.verschuivingAmerikaantje([3,1,2]), [-2,2,0]);
check('ongeldige stand geweigerd', _kern.verschuivingAmerikaantje([1,1,2]), null);
check('te weinig spelers geweigerd', _kern.verschuivingAmerikaantje([1,2]), null);
check('elke rij telt op tot nul', [[1,2,3],[1,1,3],[1,2,2],[1,1,1]]
  .map(p => _kern.verschuivingAmerikaantje(p).reduce((a,b)=>a+b,0)), [0,0,0,0]);

console.log('\n══ AMERIKAANTJE — WINST ══');
check('eerste plek is winst',      _kern.winstAmerikaantje([1,2,3]), [true,false,false]);
check('gedeeld eerste: twee winst',_kern.winstAmerikaantje([1,1,3]), [true,true,false]);
check('alle drie gelijk: drie winst', _kern.winstAmerikaantje([1,1,1]), [true,true,true]);

console.log('\n══ HIGH-LOW ══');
check('team 0 wint',   _kern.verschuivingHighlow([0,0,1,1], 0), [1,1,-1,-1]);
check('team 1 wint',   _kern.verschuivingHighlow([0,0,1,1], 1), [-1,-1,1,1]);
check('gelijkspel',    _kern.verschuivingHighlow([0,0,1,1], null), [0,0,0,0]);
check('scheve teams geweigerd', _kern.verschuivingHighlow([0,0,0,1], 0), null);

console.log('\n══ VERSCHUIVEN — VOLGORDE MAG NIET UITMAKEN ══');
const _ladder = () => Array.from({length:12},(_,i)=>({uid:'p'+(i+1), rank:i+1}));
const _stand = l => [...l].sort((a,b)=>a.rank-b.rank).map(s=>s.uid).join(',');
const _a = _kern.verschuifAllemaal(_ladder(), [{uid:'p10',delta:1},{uid:'p11',delta:1}]);
const _b = _kern.verschuifAllemaal(_ladder(), [{uid:'p11',delta:1},{uid:'p10',delta:1}]);
check('gedeeld eerste: zelfde uitkomst ongeacht volgorde', _stand(_a), _stand(_b));
check('beide winnaars stijgen echt een plek',
  [_a.find(s=>s.uid==='p10').rank, _a.find(s=>s.uid==='p11').rank], [9,10]);
const _c = _kern.verschuifAllemaal(_ladder(), [{uid:'p5',delta:2},{uid:'p8',delta:-2}]);
check('winnaar exact +2', _c.find(s=>s.uid==='p5').rank, 3);
check('verliezer exact -2', _c.find(s=>s.uid==='p8').rank, 10);
check('niemand raakt zoek', _c.length, 12);
check('posities blijven 1..12 zonder gaten',
  [...new Set(_c.map(s=>s.rank))].sort((a,b)=>a-b), Array.from({length:12},(_,i)=>i+1));
const _d = _kern.verschuifAllemaal(_ladder(), [{uid:'p1',delta:2},{uid:'p12',delta:-2}]);
check('bovenaan begrensd op 1', _d.find(s=>s.uid==='p1').rank, 1);
check('onderaan begrensd op N', _d.find(s=>s.uid==='p12').rank, 12);
check('onbekende speler wordt overgeslagen',
  _kern.verschuifAllemaal(_ladder(), [{uid:'bestaat_niet',delta:2}]).length, 12);

console.log('\n══ HIGH-LOW — TEAMS EN DOCUMENTVORM (v5.7.1) ══');
const _teamsVan = new Function(
  require('fs').readFileSync(require('path').join(__dirname,'..','js','ronde.js'),'utf8')
    .match(/^function teamsVan[\s\S]*?\n\}/m)[0] + 'return teamsVan;')();
const _vier = { speltype:'highlow', spelers:[{uid:'a'},{uid:'b'},{uid:'c'},{uid:'d'}] };
check('slot 1+2 tegen 3+4', _teamsVan(_vier), [['a','b'],['c','d']]);
check('drie spelers geeft geen teams', _teamsVan({speltype:'highlow',spelers:[{uid:'a'},{uid:'b'},{uid:'c'}]}), null);
check('matchplay geeft geen teams', _teamsVan({speltype:'matchplay',spelers:_vier.spelers}), null);

const _zoek = new Function(
  require('fs').readFileSync(require('path').join(__dirname,'..','js','scores.js'),'utf8')
    .match(/^export function zoekGenesteLijsten[\s\S]*?\n\}/m)[0].replace('export ','') + 'return zoekGenesteLijsten;')();
check('lijst in lijst wordt gevonden', _zoek({teams:[['a','b'],['c','d']]}), ['teams[0]','teams[1]']);
check('lijst van objecten is prima', _zoek({spelers:[{uid:'a'},{uid:'b'}], holes:[{par:4}]}), []);
check('partij zonder teams is schoon',
  _zoek({ partijId:'p1', spelers:[{uid:'a'}], holes:[{par:4,si:1}],
          matchups:[{spelerA:{uid:'a'},spelerB:{uid:'b'}}], scores:{} }), []);

