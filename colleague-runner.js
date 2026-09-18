"use strict";
const rt=require("./runtime-config");
const {spawn}=require("child_process");
const path=require("path");
const fs=require("fs");
const operationLock=require("./operation-lock");
const diagnostic=require("./diagnostic-report");
rt.initialize();
const appInfo=rt.readProgramJson("app-version.json",{});
const appVersion=String(appInfo.version||"1.0.0");
const appBuild=String(appInfo.build||"inconnue");
const appExecutable=String(process.env.SDIS_ASSISTANT_EXE||process.execPath);
let activeMode="TEST";
let executionCachePath="";
let mailResultPath="";
let progressPath="";
let progressMode="test";
let diagnosticHandling=false;
let automaticRun=false;
const automaticBrowsers=new Set();
function reportUnhandled(error,phase="node"){
 if(automaticRun)return; // Le mail de synchronisation existant signale déjà cet échec.
 if(diagnosticHandling)return;diagnosticHandling=true;try{diagnostic.reportError({module:"node",phase,action:activeMode,error,errorName:error&&error.name,type:error&&error.name});}catch{}finally{diagnosticHandling=false;}
}
process.on("uncaughtException",error=>{reportUnhandled(error,"uncaughtException");process.exitCode=1;});
process.on("unhandledRejection",error=>{reportUnhandled(error,"unhandledRejection");process.exitCode=1;});
function emitProgress(phase,percent,message,detail="",counters={}){
 const value={mode:progressMode,phase,percent:Math.max(0,Math.min(100,Math.round(percent))),message,detail,counters,at:new Date().toISOString()};
 if(progressPath)try{fs.writeFileSync(progressPath,JSON.stringify(value),"utf8");}catch{}
}
function summarize(results){
 const text=results.map(r=>String(r.stdout||"")).join("\n");
 const m=text.match(/\((\d+)\s+dans la[^)]*active\)/i);
 const totals=results.reduce((acc,r)=>{
  const metric=r.ok===false?{created:0,removed:0,unchanged:0}:(r.metrics||extractStepMetrics(r.stdout));
  const script=String(r.script||"");
  const dendreoStep=!script || /(?:sync-dendreo|cleanup-dendreo-stale)\.js$/i.test(script);
  const unchangedStep=!script || /sync-dendreo\.js$/i.test(script);
  if(dendreoStep)acc.added+=Number(metric.created)||0;
  if(dendreoStep)acc.removed+=Number(metric.removed)||0;
  if(unchangedStep)acc.alreadyUpToDate+=Number(metric.unchanged)||0;
  return acc;
 },{added:0,removed:0,alreadyUpToDate:0});
 return {guardsAnalyzed:m?Number(m[1]):0,...totals};
}
// Success counters come only from server confirmations.
// Normalize accents before safeTail(), which keeps only displayed tail lines.
function extractStepMetrics(value){
 const text=String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
 return {
  created:(text.match(/\bVERIFIE\s+CREATE\b/g)||[]).length,
  removed:(text.match(/\bVERIFIE\s+DELETE\b/g)||[]).length,
  unchanged:(text.match(/\bNOTHING\b/g)||[]).length
 };
}
function extractConfirmedChanges(value,script,dryRun=false){
 if(dryRun)return [];
 const name=String(script||"");const lines=String(value||"").split(/\r?\n/);const changes=[];
 const norm=line=>String(line||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
for(const raw of lines){const line=norm(raw);let m;
   if(/(?:^|[\\/])sync\-dendreo\.js$/i.test(name)){m=line.match(/\bVERIFIE\s+(CREATE|DELETE)\b.*?DATE=(\d{4})-(\d{2})-(\d{2})/);if(m)changes.push({service:"Dendreo",operation:m[1]==='CREATE'?"added":"removed",date:m[2]+"-"+m[3]+"-"+m[4]});m=line.match(/\bCONFLIT\s+DENDREO\b.*?DATE=(\d{4})-(\d{2})-(\d{2})/);if(m)changes.push({service:"Dendreo",operation:"conflict",date:m[1]+"-"+m[2]+"-"+m[3]});}
  else if(/(?:^|[\\/])cleanup\-dendreo\-stale\.js$/i.test(name)){m=line.match(/\bVERIFIE\s+DELETE\b.*?DATE=(\d{4})-(\d{2})-(\d{2})/);if(m)changes.push({service:"Dendreo",operation:"removed",date:m[1]+"-"+m[2]+"-"+m[3]});}
  else if(/(?:^|[\\/])sync\.js$/i.test(name)){m=line.match(/^CREE\s*:\s*(\S+)(?:\s+(.*))?$/);if(m)changes.push({service:"Google Agenda",operation:"added",id:m[1],date:dateFromAgattId(m[1]),label:String(m[2]||"").trim()});m=line.match(/^MIS\s+A\s+JOUR\s*:\s*(\S+)(?:\s+(.*))?$/);if(m)changes.push({service:"Google Agenda",operation:"updated",id:m[1],date:dateFromAgattId(m[1]),label:String(m[2]||"").trim()});m=line.match(/^SUPPRIME\s*:\s*(\S+)/);if(m)changes.push({service:"Google Agenda",operation:"removed",id:m[1],date:dateFromAgattId(m[1])});}
 }
 return changes.filter(x=>x.date);
}
function dateFromAgattId(id){const m=String(id||"").match(/_(\d{4})(\d{2})(\d{2})$/);return m?m[1]+"-"+m[2]+"-"+m[3]:"";}
function buildLabel(){const d=new Date(appBuild);return Number.isNaN(d.getTime())?appBuild:new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Paris"}).format(d);}
function diagnosticHeader(){return ["Assistant Planning — diagnostic sécurisé",`Mode : ${activeMode}`,`Version : ${appVersion}`,`Build : ${buildLabel()}`,`Exécutable : ${appExecutable}`,new Date().toISOString()];}
function safeMessage(value){
 const raw=String(value||"Erreur inconnue.");
 if(raw.includes("DENDREO_LOGIN_REQUIRED"))return "Connexion Dendreo requise.";
 return raw
  .replace(/(?:access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|cookie|bearer|authorization code|code_verifier|eyJ[a-z0-9_-]{10,})[^\s]*/ig,"[donnée masquée]")
  .slice(0,500);
}
function acquireSimulationLock(lock){
 const created=operationLock.create(lock,"sync");
 return created.fd;
}
function releaseSimulationLock(lock,fd){
 try{if(fd!==undefined)fs.closeSync(fd);}catch{}
 operationLock.release(lock);
}
function safeTail(value){
 return String(value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(-12).map(safeMessage).join(" | ").slice(-2000);
}
async function preflightReal(){
 const googleStatus=await require("./google-oauth-v2").status();
 if(!googleStatus.connected)throw new Error(googleStatus.temporary?"Connexion Google : service temporairement inaccessible.":"Connexion Google : reconnexion nécessaire.");
 const manager=require("./browser-manager");
 let agattStatus=await manager.status("agatt");
 if(!agattStatus.connected||agattStatus.available===false){try{if(automaticRun&&agattStatus.available===false)automaticBrowsers.add("agatt");await manager.open("agatt",{background:true});}catch(error){throw new Error("AGATT : reconnexion nécessaire.");}}
 agattStatus=await manager.status("agatt");
 if(!agattStatus.connected)throw new Error("Connexion AGATT : planning non connecté.");
 try{await manager.inspect("agatt");}catch(error){throw new Error("AGATT : reconnexion nécessaire.");}
 let dendreoStatus=await manager.status("dendreo");
 if(!dendreoStatus.connected||dendreoStatus.available===false){try{if(automaticRun&&dendreoStatus.available===false)automaticBrowsers.add("dendreo");await manager.open("dendreo",{background:true});}catch(error){throw new Error("Dendreo : reconnexion nécessaire.");}}
 dendreoStatus=await manager.status("dendreo");
 if(!dendreoStatus.connected)throw new Error("Connexion Dendreo : extranet non authentifié.");
}
async function step(script,args=[],dryRun=true,onChunk=null){
 return new Promise(resolve=>{
  const startedAt=Date.now();
  const modeArg=dryRun?"--dry-run":"--real";
  const child=spawn(path.join(rt.root,"runtime","node","node.exe"),
   [path.join(rt.root,script),...args,modeArg],{
    cwd:rt.dataDir,windowsHide:true,stdio:["ignore","pipe","pipe"],
    env:{...process.env,SDIS_COMBINED_MAIL:"1",SDIS_RUN_ID:process.env.SDIS_RUN_ID||"",SDIS_RUN_CACHE:executionCachePath,SDIS_RUN_MAIL:mailResultPath}});
  // Ne pas écrire les sorties des API (potentiellement sensibles) dans les journaux.
  let stdout="",stderr="",metricBuffer="",changeBuffer="",metrics={created:0,removed:0,unchanged:0},changes=[];child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
  child.stdout.on("data",chunk=>{const value=String(chunk);metricBuffer+=value;const lines=metricBuffer.split(/\r?\n/);metricBuffer=lines.pop()||"";const part=extractStepMetrics(lines.join("\n"));metrics.created+=part.created;metrics.removed+=part.removed;metrics.unchanged+=part.unchanged;changeBuffer+=value;const changeLines=changeBuffer.split(/\r?\n/);changeBuffer=changeLines.pop()||"";changes.push(...extractConfirmedChanges(changeLines.join("\n"),script,dryRun));stdout=(stdout+value).slice(-16000);if(onChunk)try{onChunk(value);}catch{}});
  child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-16000);});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},240000);
  child.on("error",error=>{clearTimeout(timer);resolve({ok:false,message:safeMessage(error.message),code:null,durationMs:Date.now()-startedAt,script,args});});
  child.on("close",code=>{clearTimeout(timer);const tailMetrics=extractStepMetrics(metricBuffer);metrics.created+=tailMetrics.created;metrics.removed+=tailMetrics.removed;metrics.unchanged+=tailMetrics.unchanged;changes.push(...extractConfirmedChanges(changeBuffer,script,dryRun));const err=safeTail(stderr),out=safeTail(stdout);resolve({ok:code===0&&!timedOut,message:timedOut?"D\u00E9lai d\u00E9pass\u00E9.":(code===0?"OK":(err||out||"Le moteur a \u00E9chou\u00E9.")),code,stderr:err,stdout:out,metrics,changes,durationMs:Date.now()-startedAt,script,args});});
 });
}
function calendarFromSnapshot(snapshot, today=new Date()){
 const date=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
 const from=iso(date),source=snapshot?.calendarAfter;
 if(!source||source.from!==from||!Array.isArray(source.events))return null;
 date.setDate(date.getDate()+27);const to=iso(date);
 const events=source.events.map(e=>({...e,dates:Array.isArray(e.dates)?e.dates.filter(d=>d>=from&&d<=to):[]})).filter(e=>e.dates.length);
 return {ok:true,from,to,events:events.map(e=>({id:e.id,dates:e.dates,text:e.text,startTime:e.startTime,endTime:e.endTime,indispo:e.indispo,botOwned:e.botOwned}))};
}
async function run(options={}){
 const dryRun=options.dryRun!==false;
 activeMode=dryRun?"TEST":"SYNCHRONISATION RÉELLE";
 progressMode=dryRun?"test":"sync";
 const lock=rt.dataPath("sync.lock");let fd;
 const results=[];
  fd=acquireSimulationLock(lock);
 automaticRun=options.background===true;
 try{
  // Une mise à jour remplace les fichiers programme : aucune synchronisation
  // ne doit démarrer pendant cette courte fenêtre.
   const updateLock=rt.dataPath("update.lock");
   try{operationLock.ensureAvailable(updateLock,"update",{logFile:rt.dataPath("assistant-planning.log")});}catch(e){throw new Error("Mise à jour en cours.");}
  const runId=`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  executionCachePath=rt.dataPath(`.assistant-planning-run-${runId}.json`);
  mailResultPath=rt.dataPath(`.assistant-planning-mail-${runId}.json`);
  progressPath=rt.dataPath("sync-progress.json");
  emitProgress("preparation",0,"Préparation de la synchronisation","Vérification des connexions…");
  process.env.SDIS_RUN_ID=runId;
  process.env.SDIS_RUN_CACHE=executionCachePath;
  try{fs.unlinkSync(executionCachePath);}catch{}
  if(dryRun){rt.verifyBrowser("agatt");rt.verifyBrowser("dendreo");if(!/^p\d+$/.test(rt.config().agentId||""))throw new Error("Identifiant AGATT non confirmé.");}
  if(!rt.oauthConfigured()||!rt.hasSecret("google-token"))throw new Error("Connexion Google à préparer.");
  if(!dryRun)await preflightReal();
  function writeDiagnostic(){
   try{for(const r of results){const module=String(r.name||"SYNC").replace(/[^A-Za-z0-9À-ÿ _-]/g,"").slice(0,40);const result=r.ok?"OK":"ERREUR";const message=safeMessage(r.ok?(r.message||"étape terminée"):(r.message||"étape échouée"));fs.appendFileSync(rt.dataPath("assistant-planning.log"),`[${new Date().toLocaleTimeString("fr-FR")}] [${module.toUpperCase()}] ${result} - ${message}\n`,"utf8");}}
   catch{}
  }
  const label=(testName,realName)=>dryRun?testName:realName;
   const progressByName={"Connexion AGATT":5,"Lecture avant AGATT":22,"Simulation Google":40,"Synchronisation Google":40,"Contrôle AGATT":46,"Connexion Dendreo":52,"Lecture avant Dendreo":60,"Simulation nettoyage":68,"Nettoyage Dendreo":68,"Simulation Dendreo":88,"Synchronisation Dendreo":88,"Contrôle Dendreo":95,"Simulation récapitulatif":99,"Récapitulatif":99};let dendreoGuards=0;
   async function add(name,script,args=[]){const start=progressByName[name]??0;emitProgress(name.toLowerCase().includes("google")?"google":name.toLowerCase().includes("dendreo")?"dendreo":"agatt",start,name);const result=await step(script,args,dryRun,chunk=>{for(const line of String(chunk).split(/\r?\n/)){if(/BOUCLE DENDREO date AGATT=/.test(line)){dendreoGuards++;emitProgress("dendreo",Math.min(92,68+dendreoGuards*2),"Dendreo — traitement des gardes",line.trim(),{dendreoGuards});}}});const entry={name,...result};results.push(entry);writeDiagnostic();if(!result.ok){emitProgress("error",start,name,"Erreur : "+safeMessage(result.message));throw new Error(`${name} : erreur code ${result.code===null?"inconnu":result.code} — ${result.message}`);}emitProgress(name.toLowerCase().includes("dendreo")?"dendreo":name.toLowerCase().includes("google")?"google":"agatt",start,name,"Etape terminee");return true;}
  await add("Lecture avant AGATT","check-agatt-alerts.js",["before"]);
  const agatt=await add(label("Simulation Google","Synchronisation Google"),"sync.js");
  if(agatt)await add("Contrôle AGATT","check-agatt-alerts.js",["after"]);
  const dendreo=await add("Connexion Dendreo","ensure-dendreo-browser.js");
  if(agatt&&dendreo){
   await add("Lecture avant Dendreo","check-dendreo-alerts.js",["before"]);
   await add(label("Simulation nettoyage","Nettoyage Dendreo"),"cleanup-dendreo-stale.js");
   await add(label("Simulation Dendreo","Synchronisation Dendreo"),"sync-dendreo.js");
   await add("Contrôle Dendreo","check-dendreo-alerts.js",["after"]);
  }
  const calendar=dryRun?null:calendarFromSnapshot(require("./sdis-utils").readExecutionSnapshot());
  const mailPayload={ok:true,calendar,durationMs:results.reduce((n,r)=>n+(Number(r.durationMs)||0),0),changes:results.flatMap(r=>r.changes||[]),summary:summarize(results)};try{fs.writeFileSync(mailResultPath,JSON.stringify(mailPayload),"utf8");}catch{}
   await add(label("Simulation r\u00E9capitulatif","R\u00E9capitulatif"),"send-combined-alerts.js",["--sync-mail"]);
   let mailStatus={status:"unknown",message:"Mail non envoyé."};try{mailStatus=rt.readJson("mail-status.json",mailStatus);}catch{}
   const mailResult=results[results.length-1];if(mailResult&&mailResult.name===label("Simulation r\u00E9capitulatif","R\u00E9capitulatif")){mailResult.mailStatus=mailStatus.status;mailResult.message=mailStatus.message||mailResult.message;}
   writeDiagnostic();
   const report={dryRun,time:new Date().toISOString(),version:appVersion,build:appBuild,executable:appExecutable,results,mailStatus,slowest:results.filter(r=>Number.isFinite(r.durationMs)).sort((a,b)=>b.durationMs-a.durationMs)[0]?.name||"",ok:agatt&&dendreo&&results.every(r=>r.ok),durationMs:results.reduce((n,r)=>n+(Number(r.durationMs)||0),0),summary:summarize(results)};
   emitProgress("complete",100,"Synchronisation terminée",`${(report.durationMs/1000).toFixed(1)} s`,{steps:results.length});
   rt.writeJson("simulation-status.json",report);writeDiagnostic();
   return {...report,calendar};
 }catch(error){
  reportUnhandled(error,"synchronisation");
  results.push({name:"Préparation",ok:false,message:safeMessage(error.message),code:error.code||null});
  const failed=results.find(r=>r.ok===false)||results[results.length-1]||{};
  let lastProgress=null;try{lastProgress=progressPath?rt.readJson("sync-progress.json",null):null;}catch{}
  const percent=lastProgress&&Number.isFinite(Number(lastProgress.percent))?Number(lastProgress.percent):0;
  try{emitProgress("error",percent,"Synchronisation interrompue",safeMessage(failed.message||error.message),{error:true});}catch{}
  try{rt.writeJson("simulation-status.json",{dryRun,time:new Date().toISOString(),version:appVersion,build:appBuild,executable:appExecutable,ok:false,status:"error",error:{stage:String(failed.name||"Préparation"),message:safeMessage(failed.message||error.message),code:failed.code??null,date:new Date().toISOString(),percent},results,mailStatus:null,durationMs:results.reduce((n,r)=>n+(Number(r.durationMs)||0),0)});}catch{}
  if(mailResultPath){try{fs.writeFileSync(mailResultPath,JSON.stringify({ok:false,errorStage:String(failed.name||"Preparation"),errorMessage:safeMessage(failed.message||error.message),changes:[],durationMs:results.reduce((n,r)=>n+(Number(r.durationMs)||0),0)}),"utf8");await step("send-combined-alerts.js",["--sync-mail","--error"],false);}catch{}}
  try{fs.appendFileSync(rt.dataPath("assistant-planning.log"),[...diagnosticHeader(),...results.map(r=>`${r.name} : ${r.ok?"OK":"ERREUR"}${r.code===null?"":" (code "+r.code+")"}${r.durationMs==null?"":" | durée="+r.durationMs+" ms"}${r.ok?"":" — "+r.message+" | script="+r.script+" | args="+JSON.stringify(r.args||[])+" | stderr="+(r.stderr||"")+" | stdout="+(r.stdout||"")}`)].join("\n")+"\n","utf8");}catch{}
  throw error;
 }finally{
  for(const kind of automaticBrowsers){try{await require("./browser-manager").closeDedicated(kind);}catch{}}
  automaticBrowsers.clear();automaticRun=false;
   releaseSimulationLock(lock,fd);
  if(executionCachePath){try{fs.unlinkSync(executionCachePath);}catch{} }
  executionCachePath="";mailResultPath="";progressPath="";
   progressMode="test";
   if(!process.env.SDIS_DIAGNOSTIC_NO_WORKER)diagnostic.flushPending();
 }
}
module.exports={run,calendarFromSnapshot,summarize,extractStepMetrics,extractConfirmedChanges,acquireSimulationLock,releaseSimulationLock};
if(require.main===module){const dryRun=!process.argv.includes("--real");run({dryRun}).then(r=>{process.stdout.write(JSON.stringify(r));if(!r.ok)process.exitCode=1;}).catch(error=>{console.error(dryRun?"Simulation impossible. Vérifiez les connexions dans l'application.":"Synchronisation impossible : "+safeMessage(error&&error.message));process.exitCode=1;});}
