"use strict";
const fs=require("fs"),path=require("path"),os=require("os"),https=require("https"),crypto=require("crypto");
const {spawn}=require("child_process");
const rt=require("./runtime-config");
function log(result,message){try{fs.mkdirSync(rt.dataDir,{recursive:true});fs.appendFileSync(rt.dataPath("assistant-planning.log"),`[${new Date().toLocaleTimeString("fr-FR")}] [UPDATE] ${result} - ${String(message||"").replace(/[\r\n]+/g," ").slice(0,500)}\n`,"utf8");}catch{}}
function report(options,event){try{options&&options.progress&&options.progress(event);}catch{}}
function version(){try{return String(rt.readProgramJson("app-version.json",{}).version||"0.0.0");}catch{return "0.0.0";}}
function compare(a,b){const x=String(a).split(".").map(Number),y=String(b).split(".").map(Number);for(let i=0;i<3;i++)if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)?1:-1;return 0;}
function config(){return rt.readProgramJson("update-config.json",{});}
function response(url,timeout,redirects=0){return new Promise((resolve,reject)=>{
 let address;try{address=new URL(url);if(address.protocol!=="https:")throw new Error("Lien de mise à jour non sécurisé.");}catch(e){reject(e);return;}
 const req=https.get(address,{timeout,headers:{"User-Agent":"Assistant-Planning-Updater"}},res=>{
  if([301,302,303,307,308].includes(res.statusCode)){
   res.resume();
   if(!res.headers.location||redirects>=8){reject(new Error("Redirection de mise à jour invalide."));return;}
   let target;try{target=new URL(res.headers.location,address).href;}catch(e){reject(e);return;}
   response(target,timeout,redirects+1).then(resolve,reject);return;
  }
  if(res.statusCode!==200){res.resume();reject(new Error("HTTP "+res.statusCode));return;}
  resolve(res);
 });
 req.on("timeout",()=>req.destroy(new Error("Délai de mise à jour dépassé."))).on("error",reject);
});}
async function fetchJson(url){const res=await response(url,10000);let body="";for await(const chunk of res){body+=chunk.toString("utf8");if(Buffer.byteLength(body,"utf8")>1048576)throw new Error("Manifest trop volumineux.");}return rt.parseJson(body);}
async function check(){const current=version(),url=String(config().manifestUrl||"").trim();if(!/^https:\/\//i.test(url))return {available:false,currentVersion:current};try{const m=await fetchJson(url),app=m.app||{},target=String(m.version||app.version||""),downloadUrl=String(app.url||""),sha256=String(app.sha256||"").toLowerCase(),size=Number(app.size||0)||null;const available=compare(target,current)>0&&/^https:\/\//i.test(downloadUrl)&&/^[a-f0-9]{64}$/.test(sha256);return {available,currentVersion:current,version:available?target:current,downloadUrl:available?downloadUrl:"",sha256:available?sha256:"",size:available?size:null};}catch(e){log("ERREUR",e.message);return {available:false,currentVersion:current,temporary:true};}}
function sha256(file){return new Promise((resolve,reject)=>{const h=crypto.createHash("sha256");fs.createReadStream(file).on("data",x=>h.update(x)).on("error",reject).on("end",()=>resolve(h.digest("hex")));});}
async function download(url,target,options={}){
 const res=await response(url,60000);let n=0,total=Number(res.headers["content-length"]||0)||null;
 res.on("data",chunk=>{n+=chunk.length;report(options,{stage:"Téléchargement du package complet",downloaded:n,total});});
 try{await require("stream/promises").pipeline(res,fs.createWriteStream(target));if(total!==null&&n!==total)throw new Error("Téléchargement incomplet.");}
 catch(error){try{fs.unlinkSync(target);}catch{}throw error;}
}
function acquireLock(file){fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file)){try{const age=Date.now()-fs.statSync(file).mtimeMs;if(age<10*60*1000)throw new Error("Mise à jour déjà en cours.");fs.unlinkSync(file);}catch(e){if(e.message.includes("déjà"))throw e;}}const fd=fs.openSync(file,"wx");fs.writeFileSync(fd,JSON.stringify({pid:process.pid,date:new Date().toISOString(),type:"update"}),"utf8");return fd;}
function launchUpdater(packageFile,lockFile,expected){const temp=fs.mkdtempSync(path.join(os.tmpdir(),"assistant-planning-updater-")),script=path.join(temp,"updater.ps1");fs.copyFileSync(path.join(__dirname,"update-helper.ps1"),script);const ps=path.join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");const args=["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-Package",packageFile,"-InstallRoot",__dirname,"-Exe",path.join(__dirname,"SDIS-Collegues.exe"),"-UpdateLock",lockFile,"-ExpectedVersion",expected,"-TempRoot",temp];spawn(ps,args,{detached:true,windowsHide:true,stdio:"ignore"}).unref();}
async function install(info,options={}){if(!info)info=await check();if(!info.available)throw new Error(info.temporary?"Mise à jour indisponible":"Aucune mise à jour disponible.");const lock=rt.dataPath("update.lock");let fd,temp="";try{fd=acquireLock(lock);temp=fs.mkdtempSync(path.join(os.tmpdir(),"assistant-planning-download-"));const pkg=path.join(temp,"AssistantPlanning-app.zip");report(options,{stage:"Nouvelle version détectée",version:info.version,currentVersion:info.currentVersion});await download(info.downloadUrl,pkg,options);const actual=(await sha256(pkg)).toLowerCase();if(actual!==info.sha256)throw new Error("SHA-256 du package invalide.");log("OK","SHA-256 valide pour "+info.version);report(options,{stage:"SHA-256 valide",percent:100});launchUpdater(pkg,lock,info.version);log("OK","updater temporaire lancé");setTimeout(()=>process.exit(0),250);return {ok:true,started:true,usedDelta:false};}catch(e){log("ERREUR",e.message);throw e;}finally{try{if(fd!==undefined)fs.closeSync(fd);}catch{}if(temp){try{setTimeout(()=>fs.rmSync(temp,{recursive:true,force:true}),30000);}catch{}}}}
module.exports={version,check,install,compare,sha256,fetchJson,download};
