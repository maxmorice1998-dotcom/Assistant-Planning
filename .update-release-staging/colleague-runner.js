"use strict";
const rt=require("./runtime-config");
const {spawn}=require("child_process");
const path=require("path");
const fs=require("fs");
rt.initialize();
const appInfo=rt.readProgramJson("app-version.json",{});
const appVersion=String(appInfo.version||"1.0.0");
const appBuild=String(appInfo.build||"inconnue");
const appExecutable=String(process.env.SDIS_ASSISTANT_EXE||process.execPath);
let activeMode="TEST";
let executionCachePath="";
function buildLabel(){const d=new Date(appBuild);return Number.isNaN(d.getTime())?appBuild:new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Paris"}).format(d);}
function diagnosticHeader(){return ["Assistant Planning — diagnostic sécurisé",`Mode : ${activeMode}`,`Version : ${appVersion}`,`Build : ${buildLabel()}`,`Exécutable : ${appExecutable}`,new Date().toISOString()];}
function safeMessage(value){
 return String(value||"Erreur inconnue.")
  .replace(/(?:access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|cookie|bearer|authorization code|code_verifier|eyJ[a-z0-9_-]{10,})[^\s]*/ig,"[donnée masquée]")
  .slice(0,500);
}
function safeTail(value){
 return String(value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(-12).map(safeMessage).join(" | ").slice(-2000);
}
async function preflightReal(){
 const googleStatus=await require("./google-oauth-v2").status();
 if(!googleStatus.connected)throw new Error(googleStatus.temporary?"Connexion Google : service temporairement inaccessible.":"Connexion Google : reconnexion nécessaire.");
 const manager=require("./browser-manager");
 let agattStatus=await manager.status("agatt");
 if(!agattStatus.connected){try{await manager.open("agatt");}catch(error){throw new Error("AGATT : reconnexion nécessaire.");}}
 agattStatus=await manager.status("agatt");
 if(!agattStatus.connected)throw new Error("Connexion AGATT : planning non connecté.");
 try{await manager.inspect("agatt");}catch(error){throw new Error("AGATT : reconnexion nécessaire.");}
 let dendreoStatus=await manager.status("dendreo");
 if(!dendreoStatus.connected){try{await manager.open("dendreo");}catch(error){throw new Error("Dendreo : reconnexion nécessaire.");}}
 dendreoStatus=await manager.status("dendreo");
 if(!dendreoStatus.connected)throw new Error("Connexion Dendreo : extranet non authentifié.");
}
async function step(script,args=[],dryRun=true){
 return new Promise(resolve=>{
  const startedAt=Date.now();
  const modeArg=dryRun?"--dry-run":"--real";
  const child=spawn(path.join(rt.root,"runtime","node","node.exe"),
   [path.join(rt.root,script),...args,modeArg],{
    cwd:rt.dataDir,windowsHide:true,stdio:["ignore","pipe","pipe"],
    env:{...process.env,SDIS_COMBINED_MAIL:"1",SDIS_RUN_ID:process.env.SDIS_RUN_ID||"",SDIS_RUN_CACHE:executionCachePath}});
  // Ne pas écrire les sorties des API (potentiellement sensibles) dans les journaux.
  let stdout="",stderr="";child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
  child.stdout.on("data",chunk=>{stdout=(stdout+chunk).slice(-16000);});
  child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-16000);});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},240000);
  child.on("error",error=>{clearTimeout(timer);resolve({ok:false,message:safeMessage(error.message),code:null,durationMs:Date.now()-startedAt,script,args});});
  child.on("close",code=>{clearTimeout(timer);const err=safeTail(stderr),out=safeTail(stdout);resolve({ok:code===0&&!timedOut,message:timedOut?"Délai dépassé.":(code===0?"OK":(err||out||"Le moteur a échoué.")),code,stderr:err,stdout:out,durationMs:Date.now()-startedAt,script,args});});
 });
}
async function run(options={}){
 const dryRun=options.dryRun!==false;
 activeMode=dryRun?"TEST":"SYNCHRONISATION RÉELLE";
 const lock=rt.dataPath("simulation.lock");let fd;
 const results=[];
 try{fd=fs.openSync(lock,"wx");}catch{throw new Error("Une simulation est déjà en cours. Si elle a été interrompue, redémarrez l'application après vérification.");}
 try{
  // Une mise à jour remplace les fichiers programme : aucune synchronisation
  // ne doit démarrer pendant cette courte fenêtre.
  const updateLock=rt.dataPath("update.lock");
  if(fs.existsSync(updateLock))throw new Error("Mise à jour en cours.");
  const runId=`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  executionCachePath=rt.dataPath(`.assistant-planning-run-${runId}.json`);
  process.env.SDIS_RUN_ID=runId;
  process.env.SDIS_RUN_CACHE=executionCachePath;
  try{fs.unlinkSync(executionCachePath);}catch{}
  if(dryRun){rt.verifyBrowser("agatt");rt.verifyBrowser("dendreo");if(!/^p\d+$/.test(rt.config().agentId||""))throw new Error("Identifiant AGATT non confirmé.");}
  if(!rt.oauthConfigured()||!rt.hasSecret("google-token"))throw new Error("Connexion Google à préparer.");
  if(!dryRun)await preflightReal();
  function writeDiagnostic(){
   const lines=[...diagnosticHeader(),...results.map(r=>`${r.name} : ${r.ok?"OK":"ERREUR"}${r.code===null?"":" (code "+r.code+")"}${r.durationMs==null?"":" | durée="+r.durationMs+" ms"}${r.ok?"":" — "+r.message+" | script="+r.script+" | args="+JSON.stringify(r.args||[])+" | stderr="+(r.stderr||"")+" | stdout="+(r.stdout||"")}`)];
   try{fs.writeFileSync(rt.dataPath("assistant-planning.log"),lines.join("\n")+"\n","utf8");}catch{}
  }
  const label=(testName,realName)=>dryRun?testName:realName;
  async function add(name,script,args=[]){const result=await step(script,args,dryRun);const entry={name,...result};results.push(entry);writeDiagnostic();if(!result.ok){throw new Error(`${name} : erreur code ${result.code===null?"inconnu":result.code} — ${result.message}`);}return true;}
  const login=await add("Connexion AGATT","login-agatt.js");
  if(!login)throw new Error("Connexion AGATT à renouveler.");
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
  await add(label("Simulation r\u00E9capitulatif","R\u00E9capitulatif"),"send-combined-alerts.js");
  const report={dryRun,time:new Date().toISOString(),version:appVersion,build:appBuild,executable:appExecutable,results,slowest:results.filter(r=>Number.isFinite(r.durationMs)).sort((a,b)=>b.durationMs-a.durationMs)[0]?.name||"",ok:agatt&&dendreo&&results.every(r=>r.ok)};
  rt.writeJson("simulation-status.json",report);writeDiagnostic();return report;
 }catch(error){
  results.push({name:"Préparation",ok:false,message:safeMessage(error.message),code:error.code||null});
  try{fs.writeFileSync(rt.dataPath("assistant-planning.log"),[...diagnosticHeader(),...results.map(r=>`${r.name} : ${r.ok?"OK":"ERREUR"}${r.code===null?"":" (code "+r.code+")"}${r.durationMs==null?"":" | durée="+r.durationMs+" ms"}${r.ok?"":" — "+r.message+" | script="+r.script+" | args="+JSON.stringify(r.args||[])+" | stderr="+(r.stderr||"")+" | stdout="+(r.stdout||"")}`)].join("\n")+"\n","utf8");}catch{}
  throw error;
 }finally{
  if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(lock);}catch{}
  if(executionCachePath){try{fs.unlinkSync(executionCachePath);}catch{} }
  executionCachePath="";
 }
}
module.exports={run};
if(require.main===module){const dryRun=!process.argv.includes("--real");run({dryRun}).then(r=>{process.stdout.write(JSON.stringify(r));if(!r.ok)process.exitCode=1;}).catch(error=>{console.error(dryRun?"Simulation impossible. Vérifiez les connexions dans l'application.":"Synchronisation impossible : "+safeMessage(error&&error.message));process.exitCode=1;});}
