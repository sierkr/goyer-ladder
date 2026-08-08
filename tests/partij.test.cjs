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
