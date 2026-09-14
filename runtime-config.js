"use strict";
const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const root = __dirname;
const testDir = process.env.SDIS_COLLEAGUES_TEST_DIR;
if (testDir && !path.resolve(testDir).startsWith(root + path.sep)) throw new Error("Dossier de test hors programme.");
const dataDir = testDir || path.join(process.env.LOCALAPPDATA || "", "SDIS-Bot-Collegues");
if (!process.env.LOCALAPPDATA && !testDir) throw new Error("Profil Windows indisponible.");
const ports = Object.freeze({agatt:19222, dendreo:19223});
function dataPath(name) {
 if (path.basename(name)!==name) throw new Error("Nom de fichier invalide.");
 return path.join(dataDir,name);
}
function parseJson(text) {
 return JSON.parse(String(text).replace(/^\uFEFF/,""));
}
function writeJson(name,value) {
 const target=dataPath(name), tmp=target+"."+process.pid+".tmp";
 fs.writeFileSync(tmp,JSON.stringify(value,null,2),"utf8"); fs.renameSync(tmp,target);
}
function readJson(name,fallback) {
 try {return parseJson(fs.readFileSync(dataPath(name),"utf8"));}
 catch(e){if(e.code==="ENOENT")return fallback;throw new Error("Configuration illisible : "+name);}
}
function readProgramJson(name,fallback) {
 if(path.basename(name)!==name) throw new Error("Nom de fichier invalide.");
 try {return parseJson(fs.readFileSync(path.join(root,name),"utf8"));}
 catch(e){if(e.code==="ENOENT")return fallback;throw new Error("Configuration programme illisible : "+name);}
}
function initialize(){
 fs.mkdirSync(dataDir,{recursive:true});
 for(const name of ["colleague-config.json","alert.json","dendreo-config.json"]) {
  if(!fs.existsSync(dataPath(name))) writeJson(name,parseJson(fs.readFileSync(path.join(root,name),"utf8")));
 }
 // Le mode d'exécution est choisi explicitement par l'appelant (--dry-run ou --real).
 // Ne jamais modifier ici la configuration persistée pour imposer un mode global.
 fs.mkdirSync(path.join(dataDir,"secrets"),{recursive:true});
}
function config(){initialize();return readJson("colleague-config.json",{});}
function profile(kind){if(!ports[kind])throw new Error("Navigateur inconnu.");return path.join(dataDir,"profiles",kind);}
function secretPath(name){
 if(!["smtp","google-token","google-client-secret"].includes(name))throw new Error("Secret inconnu.");
 return path.join(dataDir,"secrets",name+".dpapi");
}
function bridge(mode,input){
 const result=spawnSync(path.join(root,"SDIS-Collegues-Bridge.exe"),[mode],{
  input,encoding:"utf8",windowsHide:true,timeout:20000,maxBuffer:2*1024*1024
 });
 if(result.error||result.status!==0)throw new Error("Protection Windows indisponible pour ce profil.");
 return result.stdout;
}
function saveSecret(name,value){
 initialize();
 if(name==="google-token")value=JSON.stringify({...parseJson(value),_oauthClientId:readProgramJson("google-oauth-config.json",{}).clientId});
 const encrypted=bridge("--protect",value);
 const target=secretPath(name),tmp=target+"."+process.pid+".tmp";
 fs.writeFileSync(tmp,encrypted,"utf8");fs.renameSync(tmp,target);
}
function secret(name){
 initialize(); const file=secretPath(name);
 if(!fs.existsSync(file))throw new Error("Connexion à configurer dans l'application.");
 return bridge("--unprotect",fs.readFileSync(file,"utf8"));
}
function hasSecret(name){return fs.existsSync(secretPath(name));}
function oauthConfigured(){return Boolean(String(readProgramJson("google-oauth-config.json",{}).clientId||"").trim());}
function credentials(){
 const cfg=readProgramJson("google-oauth-config.json",{});
 if(!cfg.clientId) throw new Error("OAuth Google non configure.");
 // OAuth Desktop application credentials ship with the application; user tokens remain DPAPI protected.
 const clientSecret=String(cfg.clientSecret||"").trim();
 if(!clientSecret)throw new Error("Installation Google incomplète. Contactez votre distributeur.");
 return {installed:{client_id:String(cfg.clientId),client_secret:clientSecret,redirect_uris:["http://127.0.0.1"]}};
}
function token(){
 const saved=parseJson(secret("google-token"));
 if(saved._oauthClientId!==readProgramJson("google-oauth-config.json",{}).clientId)throw new Error("Reconnecter Google.");
 delete saved._oauthClientId;return saved;
}
function calendarId(){
 const id=String(readJson("google-calendar.json",{}).calendarId||"").trim();
 if(!id)throw new Error("Calendrier SDIS-BOT non configure.");
 return id;
}
async function resolveCalendarId(api){
 const current=calendarId();
 const cfg=readProgramJson("google-oauth-config.json",{});
 const marker=String(cfg.calendarMarker||"[SDIS-BOT]");
 try{
  const r=await api.calendars.get({calendarId:current});
  const text=String(r.data?.description||"")+" "+String(r.data?.summary||"");
  if(text.includes(marker))return current;
 }catch(e){
  const status=e?.response?.status;
  if(status!==404&&status!==403)throw e;
 }
 let pageToken;
 do{
  const r=await api.calendarList.list({minAccessRole:"writer",showDeleted:false,maxResults:250,pageToken});
  const found=(r.data.items||[]).find(x=>{
   const text=String(x.description||"")+" "+String(x.summary||"");
   return text.includes(marker)&&String(x.id||"").trim();
  });
  if(found){
   writeJson("google-calendar.json",{calendarId:String(found.id).trim(),summary:String(found.summary||"")});
   return String(found.id).trim();
  }
  pageToken=r.data.nextPageToken;
 }while(pageToken);
 throw new Error("Calendrier SDIS-BOT inaccessible pour ce compte Google.");
}
function alert(){initialize();const value=readJson("alert.json",{});delete value.smtpPass;return value;}
function smtpPassword(){return secret("smtp");}
function bindGoogleAuth(auth){
 auth.on("tokens",fresh=>{const previous=token();saveSecret("google-token",JSON.stringify({...previous,...fresh}));});
 return auth;
}
function browserExe(){
 const bundled=path.join(root,"runtime","browser");
 function find(dir,depth=0){
  if(depth>5||!fs.existsSync(dir))return null;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name);
   if(entry.isFile()&&entry.name==="chrome.exe")return file;
   if(entry.isDirectory()){const found=find(file,depth+1);if(found)return found;}
  }
 }
 const found=find(bundled);if(found)return found;
 throw new Error("Navigateur absent du package. Demandez une version complète au distributeur.");
}
function verifyBrowser(kind) {
 if(!ports[kind])throw new Error("Port non autorisé.");
 const powershell=path.join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe");
 const result=spawnSync(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",
  path.join(root,"verify-browser.ps1"),"-Port",String(ports[kind]),"-Profile",profile(kind)],
  {encoding:"utf8",windowsHide:true,timeout:15000});
 if(result.error||result.status!==0)throw new Error("Navigateur non connecté ou port occupé par une autre application. Ouvrez la connexion depuis l'assistant.");
}
let prepared=false;
function prepare(){
 if(prepared)return;prepared=true;initialize();process.chdir(dataDir);

}
module.exports={root,dataDir,ports,dataPath,parseJson,readJson,readProgramJson,writeJson,initialize,config,profile,saveSecret,secret,
 hasSecret,oauthConfigured,credentials,token,calendarId,resolveCalendarId,alert,smtpPassword,bindGoogleAuth,browserExe,verifyBrowser,prepare};
