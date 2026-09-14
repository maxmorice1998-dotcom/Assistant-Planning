"use strict";
// Outil de fabrication : ne touche que les scripts de ce dossier.
const fs=require("fs"),path=require("path");
const names=["sync.js","sync-dendreo.js","cleanup-dendreo-stale.js","check-agatt-alerts.js",
 "check-dendreo-alerts.js","send-combined-alerts.js","login-agatt.js","ensure-dendreo-browser.js"];
for(const name of names){
 const file=path.join(__dirname,name);
 let s=fs.readFileSync(file,"utf8").replace(/\uFEFF/g,"");
 if(s.includes('const runtime = require("./runtime-config");'))continue;
 s='const runtime = require("./runtime-config");\nruntime.prepare();\n'+s;
 s=s.replace(/\b9222\b/g,"19222").replace(/\b9223\b/g,"19223");
 s=s.replace(/const DIR = __dirname;/g,"const DIR = runtime.dataDir;");
 s=s.replace(/const puppeteer = require\("puppeteer"\);/g,'const puppeteer = require("./browser-client");');
 s=s.replace(/require\("path"\)\.join\(__dirname,/g,'require("path").join(runtime.dataDir,');
 s=s.replace('const AGENT_ID = "p3873";','const AGENT_ID = runtime.config().agentId;\nif (!/^p\\d+$/.test(AGENT_ID || "")) throw new Error("Connexion AGATT non configuree.");');
 s=s.replace(/const credentials = JSON\.parse\(fs\.readFileSync\("credentials\.json"\)\);/g,"const credentials = runtime.credentials();");
 s=s.replace(/const token = JSON\.parse\(fs\.readFileSync\(TOKEN_PATH\)\);/g,"const token = runtime.token();");
 s=s.replace(/const alertConfig = JSON\.parse\(fs\.readFileSync\(ALERT_PATH\)\);/g,"const alertConfig = runtime.alert();");
 s=s.replace(/const ALERT = JSON\.parse\(\s*fs\.readFileSync\(path\.join\(DIR, "alert\.json"\), "utf8"\)\s*\);/g,"const ALERT = runtime.alert();");
 s=s.replace(/const CREDS = JSON\.parse\(\s*fs\.readFileSync\(path\.join\(DIR, "credentials\.json"\), "utf8"\)\s*\);/g,"const CREDS = runtime.credentials();");
 s=s.replace(/const TOKEN = JSON\.parse\(\s*fs\.readFileSync\(path\.join\(DIR, "token\.json"\), "utf8"\)\s*\);/g,"const TOKEN = runtime.token();");
 s=s.replace(/const credentials = (loadJson|readJson)\(CREDENTIALS_PATH\);/g,"const credentials = runtime.credentials();");
 s=s.replace(/const token = (loadJson|readJson)\(TOKEN_PATH\);/g,"const token = runtime.token();");
 s=s.replace(/pass: (ALERT|alertConfig)\.smtpPass/g,"pass: runtime.smtpPassword()");
 s=s.replace(/auth\.setCredentials\((TOKEN|token)\);/g,"auth.setCredentials($1);\n runtime.bindGoogleAuth(auth);");
 s=s.replace(/const (TOKEN_PATH|CREDENTIALS_PATH|ALERT_PATH) = .*;\r?\n/g,"");
 if(name==="ensure-dendreo-browser.js"){
  s=s.replace(/const CHROME = .*;/,"const CHROME = runtime.browserExe();");
  s=s.replace(/const PROFILE = .*;/,'const PROFILE = runtime.profile("dendreo");');
  // Seul l'assistant ouvre un profil : aucun lancement implicite sur un port inconnu.
  const start=s.indexOf("function launchChrome() {"),end=s.indexOf("\nfunction isDendreo",start);
  if(start<0||end<0)throw new Error("Structure navigateur inattendue.");
  s=s.slice(0,start)+'function launchChrome() { throw new Error("Ouvrez la connexion Dendreo dans l assistant."); }\n'+s.slice(end);
 }
 if(/p3873|Volej2RejN|C:\\\\?Users\\\\?Accueil|\.smtpPass\b/.test(s))throw new Error("Reference personnelle residuelle : "+name);
 fs.writeFileSync(file,s,"utf8");
}
console.log("Moteur adapte dans la copie uniquement.");
