"use strict";
const rt=require("./runtime-config");
const diagnostic=require("./diagnostic-report");
process.on("uncaughtException",error=>{try{diagnostic.reportError({module:"node",phase:"ui-backend",action:"backend",error,errorName:error&&error.name,type:error&&error.name});}catch{}process.exitCode=1;});
process.on("unhandledRejection",error=>{try{diagnostic.reportError({module:"node",phase:"ui-backend",action:"backend",error,errorName:error&&error.name,type:error&&error.name});}catch{}process.exitCode=1;});
async function waitForBrowserConnection(kind, timeoutMs=240000,windowBounds=null){
 const manager=require("./browser-manager");
 const started=await manager.open(kind,{windowBounds});
 const deadline=Date.now()+timeoutMs;
 let last;
 while(Date.now()<deadline){
  last=await manager.status(kind);
  if(last.connected===true){
   // La session est validée : fermeture immédiate de la fenêtre dédiée.
   Promise.resolve().then(()=>manager.closeDedicated(kind)).catch(()=>{});
   return {ok:true,message:kind==="agatt"?"AGATT connecte":"Dendreo connecte",status:last};
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 return {ok:false,message:kind.toUpperCase()+" : délai dépassé. Terminez la connexion dans le navigateur puis réessayez.",status:last||{connected:false,reconnect:true}};
}
function safeDiagnostic(value){return String(value||"Erreur inconnue.").replace(/(?:access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|cookie|bearer|authorization code|code_verifier|eyJ[a-z0-9_-]{10,})[^\s]*/ig,"[donnée masquée]").slice(0,500);}
function formatDiagnostic(results){
 const google=results.find(r=>r.name==="Simulation Google"),agatt=results.find(r=>r.name==="Connexion AGATT"),dendreo=results.find(r=>r.name==="Connexion Dendreo");
 const duration=r=>r&&Number.isFinite(r.durationMs)?` (${(r.durationMs/1000).toFixed(1)} s)`:"";
 const lines=["Google : "+(google?.ok?"✅ OK":"❌ "+safeDiagnostic(google?.message))+duration(google),"AGATT : "+(agatt?.ok?"✅ OK":"❌ "+safeDiagnostic(agatt?.message))+duration(agatt),"Dendreo : "+(dendreo?.ok?"✅ OK":"❌ "+safeDiagnostic(dendreo?.message))+duration(dendreo)];
 const measured=results.filter(r=>Number.isFinite(r.durationMs)).sort((a,b)=>b.durationMs-a.durationMs);if(measured.length)lines.push("Étape la plus lente : "+measured[0].name+duration(measured[0]));
 const failed=results.find(r=>!r.ok);lines.push(failed?"Test global : ❌ échec à l'étape "+failed.name+" — "+safeDiagnostic(failed.message)+(failed.code===null?"":" (code "+failed.code+")"):"✅ Assistant Planning est prêt.");return lines.join("\n");
}
async function handle(req){
 rt.initialize();
 switch(req.action){
 case "status":{
 const cfg=rt.config(),alerts=rt.alert();
  let browserReady=true;try{rt.browserExe();}catch{browserReady=false;}
  const browserManager=require("./browser-manager");
  let agattStatus=await browserManager.status("agatt");
  // Une session authentifiée suffit pour découvrir/actualiser l'identifiant
  // AGATT depuis les cellules du planning, sans saisie manuelle.
  if(agattStatus.connected===true&&agattStatus.available!==false){try{await browserManager.inspect("agatt");}catch{} }
  const dendreoStatus=await require("./browser-manager").status("dendreo");
  const googleStatus=await require("./google-oauth-v2").status();
  const updateStatus=null;
  return {ok:true,message:"Mode simulation : aucune modification des agendas et aucun mail envoyé.",
   googleEmail:cfg.googleEmail||alerts.smtpUser||"",smtpUser:alerts.smtpUser||"",to:alerts.to||"",smtpSaved:rt.hasSecret("smtp"),
   agatt:agattStatus.connected===true,agattStatus,dendreo:dendreoStatus.connected===true,dendreoStatus,google:rt.hasSecret("google-token"),
   reposCompensatoire:cfg.reposCompensatoire===true,
   browserReady,googleAvailable:googleStatus.configured,googleStatus,updateStatus,dryRun:true};
 }
 case "startup":{
  try{
   const updater=require("./update-client");
   const info=await updater.check();
   if(!info.available)return {ok:true,updated:false,warning:false,message:""};
   const result=await updater.install(info);
   return {ok:true,updated:!!result.started,warning:false,message:"Mise à jour d'Assistant Planning…"};
  }catch(error){
   return {ok:true,updated:false,warning:true,message:"⚠ Mise à jour impossible — version actuelle conservée"};
  }
 }
 case "save-mail":{
  const email=String(rt.config().googleEmail||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Connectez Google avant de configurer les alertes.");
  if(typeof req.password==="string"&&req.password.length)rt.saveSecret("smtp",req.password);
  rt.writeJson("alert.json",{smtpUser:email,to:email});
  return {ok:true,message:"Paramètres enregistrés. Le secret est chiffré par Windows pour votre compte."};
 }
 case "save-google-secret":{
  if(typeof req.clientSecret!=="string"||!req.clientSecret.trim())throw new Error("Saisissez la clé de connexion Google.");
  rt.saveSecret("google-client-secret",req.clientSecret);
  return {ok:true,message:"Configuration Google enregistrée sur ce PC."};
 }
 case "set-repos":{
  const cfg=rt.config();
  cfg.reposCompensatoire=req.value===true;
  rt.writeJson("colleague-config.json",cfg);
  return {ok:true,message:cfg.reposCompensatoire?"Repos compensatoire activé.":"Repos compensatoire désactivé.",reposCompensatoire:cfg.reposCompensatoire};
 }
 case "open-agatt":return await waitForBrowserConnection("agatt",240000,req.windowBounds);
 case "open-dendreo":return await waitForBrowserConnection("dendreo",240000,req.windowBounds);
 case "inspect":{
  const messages=[];let ok=true;
  for(const kind of ["agatt","dendreo"]){try{await require("./browser-manager").inspect(kind);messages.push(kind.toUpperCase()+" : connecté.");}
  catch(e){ok=false;messages.push(e.message);}}
  return {ok,message:messages.join("\n")};
 }
 case "google":{
  try {
   const current=await require("./google-oauth-v2").status();
   if(current.connected)return {ok:true,message:"Google deja connecte",alreadyConnected:true};
   const result=await require("./google-oauth-v2").connectGoogle({windowBounds:req.windowBounds});
   const message="✅ Google connecté";
   return {ok:true,message};
  } catch(e) {
   const message=String(e.message||"");
   const friendly=/^(La connexion Google|Impossible d’ouvrir le navigateur|L’autorisation Google|Connexion Google annulée|Google n’a pas|Autorisation Gmail manquante)/.test(message);
   return {ok:false,message:friendly?message:"La connexion Google n’a pas abouti. Vérifiez votre connexion Internet puis réessayez. Si le problème persiste, contactez votre distributeur."};
  }
 }
 case "simulate":{
  try {
   const result=await require("./colleague-runner").run({dryRun:true});
   const failed=result.results.find(r=>!r.ok);
   return {ok:result.ok,message:formatDiagnostic(result.results),results:result.results};
  } catch(error) {
   return {ok:false,message:"Test global : ❌ échec — "+safeDiagnostic(error&&error.message),results:[]};
  }
 }
 case "synchronize":{
  try {
   const result=await require("./colleague-runner").run({dryRun:false});
   if(result.ok)diagnostic.flushPending();
    const mailMessage=result.mailStatus&&result.mailStatus.message?"\n"+result.mailStatus.message:"";return {ok:result.ok,message:result.ok?"Synchronisation terminee."+mailMessage:"Synchronisation interrompue.",results:result.results,durationMs:result.durationMs,summary:result.summary,mailStatus:result.mailStatus||null};
  } catch(error) {
   return {ok:false,message:"Synchronisation impossible : "+safeDiagnostic(error&&error.message),results:[]};
  }
 }
 case "dendreo-calendar":{
  const manager=require("./browser-manager");
  const status=await manager.status("dendreo");
  if(!status.connected)throw new Error("Dendreo : connexion requise.");
  const puppeteer=require("puppeteer");
  const state=require("./dendreo-state");
  const syncDendreo=require("./sync-dendreo");
  const browser=await puppeteer.connect({browserURL:"http://127.0.0.1:"+rt.ports.dendreo});
  try{
   const page=await syncDendreo.findDendreoPage(browser);
   if(!page)throw new Error("Agenda Dendreo absent.");
   const today=new Date();
   const iso=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`;};
   const from=iso(today),endDate=new Date(today);endDate.setDate(endDate.getDate()+27);
   const events=await state.readEvents(page,from,iso(endDate));
   return {ok:true,from,to:iso(endDate),events:events.map(e=>({id:e.id,dates:e.dates,text:e.text,startTime:e.startTime,endTime:e.endTime,indispo:e.indispo,botOwned:e.botOwned}))};
  }finally{await browser.disconnect();}
 }
 case "update-check":{
  const result=await require("./update-client").check();
  return {...result,ok:true,message:result.temporary?"Vérification des mises à jour indisponible":(result.available?"Une nouvelle version d'Assistant Planning est disponible":"✅ Assistant Planning est à jour")};
 }
 case "update-install":{
  const result=await require("./update-client").install();
  return {...result,ok:true,message:"Mise à jour téléchargée et vérifiée. Assistant Planning va redémarrer."};
 }
 default:throw new Error("Action inconnue.");
 }
}
module.exports={handle};
if(require.main===module){
 let input="";process.stdin.setEncoding("utf8");
 process.stdin.on("data",chunk=>{input+=chunk;if(input.length>65536)process.exit(2);});
 process.stdin.on("end",async()=>{
  try{process.stdout.write(JSON.stringify(await handle(JSON.parse(input))));}
  catch(e){process.stdout.write(JSON.stringify({ok:false,message:e.message||"Action impossible."}));}
 });
}
