"use strict";
const runtime=require('./runtime-config');runtime.prepare();
const state=require('./dendreo-state');
const {getGuardDates,expectedCoverage}=require('./sync-dendreo');
const puppeteer=require('./browser-client');
function findDendreoPage(browser) {
 return Promise.resolve(browser.pages()).then(pages=>{
  const found=pages.find(p=>p.url().includes('formation.pompiers-14.org')&&p.url().includes('/agenda'));
  if(found)return found;
  const root=pages.find(p=>p.url().includes('formation.pompiers-14.org'));
  if(!root)return null;
  return Promise.resolve(root.evaluate(()=>[...document.querySelectorAll('a[href]')].find(a=>/\/agenda(?:[?#]|$)/i.test(a.href))?.href)).then(agendaUrl=>{
   if(!agendaUrl)throw new Error('Lien agenda Dendreo absent.');
   return Promise.resolve(root.goto(agendaUrl,{waitUntil:'domcontentloaded',timeout:30000})).then(()=>root);
  });
 });
}
async function main(){
 const dryRun=!process.argv.includes('--real') || process.argv.includes('--dry-run');
 const cfg=runtime.readJson('dendreo-config.json',{});
 if(cfg.marker!==state.MARKER)throw new Error('Marqueur requis : [SDIS-BOT].');
 const repos=runtime.config().reposCompensatoire===true;
 console.log('Repos compensatoire courant : '+(repos?'ACTIVE':'DESACTIVE')+' — les repos bot non attendus seront supprimés.');
 const data=await getGuardDates(cfg);
 const expectedByRoot=new Map();
 for(const g of data.guards){const s=expectedCoverage(g,repos);if(s.length)expectedByRoot.set(s[0],s);}
 for(const n of data.nights){const s=expectedCoverage(n,repos);if(s.length)expectedByRoot.set(s[0],s);}
 if(!data.guards.length && !data.nights.length){console.log('SECURITE : aucune garde fiable, aucune suppression.');return;}
 const today=new Date();
 const local=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 const from=local(today),to=local(new Date(today.getFullYear(),today.getMonth()+Number(cfg.monthsAhead||6)+1,today.getDate()));
 const release=dryRun?()=>{}:state.acquireWriteLock();let browser;
 try{
  browser=await puppeteer.connect({browserURL:'http://127.0.0.1:19223'});
  const page=await findDendreoPage(browser);
  if(!page)throw new Error('Agenda Dendreo absent.');
  const events=await state.readEvents(page,from,to);
  const bots=events.filter(e=>e.botOwned&&e.indispo);
  const roots=[...new Set(bots.map(e=>state.coverageStart(e)))].sort();
  for(const root of roots){
   const group=bots.filter(e=>state.coverageStart(e)===root);
   const expected=expectedByRoot.get(root);
   let exact=null,actions=[],decision;
   if(!expected){
    actions=group;decision='DELETE BOT (repos désactivé ou ancienne garde)';
   }else{
    exact=group.find(e=>state.sameCoverage(e,expected));
    if(exact)actions=group.filter(e=>e!==exact);else actions=group;
    decision=actions.length?(exact?'DELETE DUPLICATE':'DELETE OBSOLETE (bloc a reconstruire)'):'NOTHING';
   }
   const day=state.dayState(await state.readEvents(page,root,root),root);
   state.logDay(root,day,decision+(expected?' attendu='+JSON.stringify(expected):''));
   for(const item of actions){
    if(dryRun){await state.verifyBotDeletion(page,item,!!exact);console.log('VERIFIE en lecture seule : id='+item.id+' marqueur/date/non-recurrent');}
    else await state.deleteBot(page,item,!!exact);
   }
  }
  console.log(dryRun?'DRY RUN : 0 suppression reelle.':'Nettoyage verifie sur le serveur.');
 }finally{if(browser)await browser.disconnect();release();}
}
if(require.main===module)main().catch(e=>{console.error('Erreur nettoyage Dendreo :',e.message);process.exitCode=1;});
module.exports={main};
