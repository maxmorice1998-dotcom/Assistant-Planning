"use strict";
const runtime=require('./runtime-config');runtime.prepare();
const state=require('./dendreo-state');
const {getGuardDates}=require('./sync-dendreo');
const puppeteer=require('./browser-client');
async function main(){
 const dryRun=!process.argv.includes('--real') || process.argv.includes('--dry-run');
 const cfg=runtime.readJson('dendreo-config.json',{});
 if(cfg.marker!==state.MARKER)throw new Error('Marqueur requis : [SDIS-BOT].');
 const data=await getGuardDates(cfg);
 const guards=new Set(data.guards.map(g=>g.date));
 if(!guards.size && !data.nights.length){console.log('SECURITE : aucune garde fiable, aucune suppression.');return;}
 const today=new Date();
 const local=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 const from=local(today),to=local(new Date(today.getFullYear(),today.getMonth()+Number(cfg.monthsAhead||6),today.getDate()));
 const release=dryRun?()=>{}:state.acquireWriteLock();let browser;
 try{
  browser=await puppeteer.connect({browserURL:'http://127.0.0.1:19223'});
  const page=(await browser.pages()).find(p=>p.url().includes('formation.pompiers-14.org') && p.url().includes('/agenda'));
  if(!page)throw new Error('Agenda Dendreo absent.');
  const events=await state.readEvents(page,from,to);
  const dates=[...new Set(events.filter(e=>e.botOwned && e.indispo).flatMap(e=>e.dates))].sort();
  for(const date of dates){
   const day=state.dayState(await state.readEvents(page,date,date),date);
   const bots=day.bots.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
   // Sans garde de jour, le nettoyage conserve le comportement de retrait des anciennes gardes,
   // mais seulement apr?s verification de l'identite, du marqueur et du formulaire non recurrent.
   const actions=guards.has(date)?bots.slice(1):bots;
   const decision=actions.length?(guards.has(date)?'DELETE DUPLICATE':'DELETE BOT (ancienne garde ou nuit seule)'):'NOTHING';
   state.logDay(date,day,decision);
   for(const item of actions){
    if(dryRun){await state.verifyBotDeletion(page,item,guards.has(date));console.log('VERIFIE en lecture seule : id='+item.id+' marqueur/date/non-recurrent');}
    else await state.deleteBot(page,item,guards.has(date));
   }
  }
  console.log(dryRun?'DRY RUN : 0 suppression reelle.':'Nettoyage verifie sur le serveur.');
 }finally{if(browser)await browser.disconnect();release();}
}
if(require.main===module)main().catch(e=>{console.error('Erreur nettoyage Dendreo :',e.message);process.exitCode=1;});
module.exports={main};
