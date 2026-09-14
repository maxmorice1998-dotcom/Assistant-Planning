'use strict';
// Validation explicite en lecture seule, jamais incluse dans le paquet utilisateur.
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(process.argv[2]||__dirname);
const state=require(path.join(root,'dendreo-state'));
const browserClient=require(path.join(root,'browser-client'));
async function child(script,args){
  await new Promise((resolve,reject)=>{
    const p=spawn(path.join(root,'runtime/node/node.exe'),[path.join(root,script),...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    p.stdout.on('data',d=>process.stdout.write(d));p.stderr.on('data',d=>process.stderr.write(d));
    p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(`${script}: ${code}`)));
  });
}
async function main(){
 const b=await browserClient.connect({browserURL:'http://127.0.0.1:19223'});
 const page=(await b.pages()).find(p=>p.url().includes('/agenda'));
 if(!page)throw Error('Agenda absent');
 const requests={GET:0,blocked:[]};
 const handler=r=>{if(['GET','HEAD','OPTIONS'].includes(r.method())){requests.GET++;r.continue();}else{requests.blocked.push({method:r.method(),url:r.url().split('?')[0]});r.abort();}};
 try{
  await page.setRequestInterception(true);page.on('request',handler);
  const from='2026-09-14',to='2027-03-14';
  const canonical=events=>JSON.stringify(events.sort((a,b)=>a.id.localeCompare(b.id)));
  const before=canonical(await state.readEvents(page,from,to));
  for(const script of ['sync-dendreo.js','cleanup-dendreo-stale.js','check-dendreo-alerts.js'])await child(script,script.startsWith('check')?['after','--dry-run']:['--dry-run']);
  const after=canonical(await state.readEvents(page,from,to));
  if(before!==after)throw Error('Etat Dendreo different apres validation');
  if(requests.blocked.length)throw Error('Tentative de mutation bloquee : '+JSON.stringify(requests.blocked));
  console.log('VALIDATION RELEASE : etat serveur identique ; '+requests.GET+' lectures ; 0 POST/PUT/PATCH/DELETE.');
 }finally{await page.setRequestInterception(false);page.off('request',handler);await b.disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
