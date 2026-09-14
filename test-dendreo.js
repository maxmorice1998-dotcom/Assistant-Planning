"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const s=require('./dendreo-state');
const row=(id,title='[SDIS-BOT] Garde',start='2026-10-06T00:00:00',end='2026-10-07T00:00:00')=>({id,title,start,end,isIndispo:true});
test('dates compactes du producteur, validation stricte et fin exclusive',()=>{
 assert.equal(s.normalizeDate('20261002'),'2026-10-02');
 assert.throws(()=>s.normalizeDate('20260230'));
 assert.equal(s.nextDate('2026-10-31'),'2026-11-01');
 assert.deepEqual(s.normalizeEvents([row('1')],'2026-10-01','2026-10-31')[0].dates,['2026-10-06']);
});
test('jour et nuit de la même date : un seul jour, indépendamment de l’ordre',()=>{
 const rows=[{date:'20261002',shift:'12h_jour'},{date:'2026-10-02',shift:'12h_nuit'},{date:'20261003',shift:'12h_nuit'}];
 for(const list of [rows,[...rows].reverse()]){
  const actual=s.normalizeGuards(list);
  assert.equal(actual.guards.length,1);assert.equal(actual.guards[0].date,'2026-10-02');assert.equal(actual.nights.length,1);
 }
});
test('deux identifiants distincts ne fusionnent pas, manuel conservé',()=>{
 const rows=[row('1000000001'),row('1000000002'),row('3','Garde manuelle'),row('1000000001')];
 const events=s.normalizeEvents(rows,'2026-10-06','2026-10-06');
 const day=s.dayState(events,'2026-10-06');
 assert.equal(day.bots.length,2);assert.equal(day.manual.length,1);assert.equal(events.length,3);
});
test('un marqueur approximatif ne donne aucun droit de suppression',async()=>{
 const item=s.normalizeEvents([row('1000000001','SDIS-BOT sans crochets')],'2026-10-06','2026-10-06')[0];
 await assert.rejects(()=>s.deleteBot({},item),/interdite/);
});
test('échec de lecture ne signifie jamais journée vide',async()=>{
 await assert.rejects(()=>s.readEvents({waitForFunction:async()=>{},evaluate:async()=>{throw Error('HTTP 500');}},'2026-10-02','2026-10-02'),/HTTP 500/);
 assert.throws(()=>s.normalizeEvents({error:'login'},'2026-10-02','2026-10-02'));
});
test('une écriture tentée invalide le snapshot, un no-op ultérieur ne le réactive pas',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dendreo-test-'));
 const old=process.env.SDIS_RUN_CACHE;process.env.SDIS_RUN_CACHE=path.join(dir,'run.json');
 try{
  const u=require('./sdis-utils');
  u.writeExecutionSnapshot({dendreo:{events:[]},guards:[{date:'20261002'}]});
  u.writeExecutionSnapshot({dendreoWrites:true});
  u.writeExecutionSnapshot({dendreoWrites:false});
  assert.equal(u.readExecutionSnapshot().dendreoWrites,true);
  assert.equal(u.readExecutionSnapshot().dendreo,null);
  assert.equal(u.readExecutionSnapshot().guards[0].date,'20261002');
 }finally{if(old===undefined)delete process.env.SDIS_RUN_CACHE;else process.env.SDIS_RUN_CACHE=old;fs.unlinkSync(path.join(dir,'run.json'));fs.rmdirSync(dir);}
});
test('création : clic envoyé ne suffit pas ; confirmation serveur obligatoire',async()=>{
 const vm=require('vm');
 const source=fs.readFileSync(path.join(__dirname,'sync-dendreo.js'),'utf8');
 const code=source.slice(source.indexOf('async function createUnavailability'),source.indexOf('async function main()'));
 for(const success of [false,true]){
  let reads=0,clicks=0,invalidated=false;
  const ctx={console:{log(){}},writeExecutionSnapshot:patch=>{invalidated=patch.dendreoWrites===true && patch.dendreo===null;},
    state:{...s,readEvents:async()=>++reads===1?[]:success?s.normalizeEvents([row('10000000099','[SDIS-BOT] Garde','2026-10-02T00:00:00','2026-10-03T00:00:00')],'2026-10-02','2026-10-02'):[]}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const page={evaluate:async()=> 'https://example.invalid/events',waitForFunction:async()=>{},waitForResponse:async()=>({ok:()=>true}),click:async()=>{assert.equal(invalidated,true);clicks++;}};
  const action=ctx.createUnavailability(page,'2026-10-02',{label:'Garde'});
  if(success)await action;else await assert.rejects(()=>action,/non confirme/);
  assert.equal(clicks,1);assert.equal(reads,2);
 }
});
