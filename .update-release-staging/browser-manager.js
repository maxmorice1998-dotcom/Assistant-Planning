"use strict";
const rt=require("./runtime-config");
const fs=require("fs");
const net=require("net");
const {spawn,spawnSync}=require("child_process");
const urls={agatt:"https://agatt.sdis14.fr/register/index.php?a=gardeExercice",dendreo:"https://formation.pompiers-14.org/"};
async function occupied(port){
 return new Promise(resolve=>{const sock=net.connect({host:"127.0.0.1",port});
 sock.setTimeout(1000);sock.on("connect",()=>{sock.destroy();resolve(true);});
 sock.on("error",()=>resolve(false));sock.on("timeout",()=>{sock.destroy();resolve(false);});});
}
function psQuote(value){return "'"+String(value).replace(/'/g,"''")+"'";}
function focusDedicatedWindow(kind){
 const port=rt.ports[kind];
 const profile=rt.profile(kind);
 const powershell=process.env.SystemRoot
  ? require("path").join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe")
  : "powershell.exe";
 const script=`$ErrorActionPreference='SilentlyContinue'
$port=${Number(port)}
$profile=${psQuote(profile)}
$portNeedle='--remote-debugging-port='+$port
$profileNeedle='--user-data-dir='+$profile
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AssistantPlanningWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$owners=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
$found=$false
foreach($owner in $owners){
  $commandLine=[string]$owner.CommandLine
  if($commandLine.IndexOf($portNeedle,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or
     $commandLine.IndexOf($profileNeedle,[StringComparison]::OrdinalIgnoreCase) -lt 0){continue}
  $found=$true
  $process=Get-Process -Id ([int]$owner.ProcessId) -ErrorAction SilentlyContinue
  if($null -eq $process){continue}
  $handle=[IntPtr]$process.MainWindowHandle
  if($handle -eq [IntPtr]::Zero){continue}
  [AssistantPlanningWindow]::ShowWindowAsync($handle,9) | Out-Null
  [AssistantPlanningWindow]::BringWindowToTop($handle) | Out-Null
  [AssistantPlanningWindow]::SetForegroundWindow($handle) | Out-Null
  exit 0
}
if($found){exit 2}
exit 1`;
 try{
  const result=spawnSync(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",script],
   {encoding:"utf8",windowsHide:true,timeout:5000,stdio:["ignore","ignore","ignore"]});
  if(result.error)return 1;
  return result.status===0?0:(result.status===2?2:1);
 }catch{return 1;}
}
async function open(kind){
 if(!urls[kind])throw new Error("Connexion inconnue.");rt.initialize();
 const existingWindow=focusDedicatedWindow(kind);
 if(await occupied(rt.ports[kind])){rt.verifyBrowser(kind);if(existingWindow!==0)focusDedicatedWindow(kind);return "La fenêtre de connexion est déjà ouverte.";}
 if(existingWindow===0||existingWindow===2){
  for(let i=0;i<40;i++){if(await occupied(rt.ports[kind])){rt.verifyBrowser(kind);focusDedicatedWindow(kind);return "La fenêtre de connexion est déjà ouverte.";}await new Promise(r=>setTimeout(r,500));}
  throw new Error("Le navigateur ne répond pas.");
 }
 fs.mkdirSync(rt.profile(kind),{recursive:true});
 const child=spawn(rt.browserExe(),["--app="+urls[kind],"--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port="+rt.ports[kind],"--user-data-dir="+rt.profile(kind),
  "--no-first-run","--no-default-browser-check","--disable-background-mode","--enable-automation",urls[kind]],
  {detached:true,stdio:"ignore",windowsHide:false});
 await new Promise((resolve,reject)=>{child.once("spawn",resolve);child.once("error",()=>reject(new Error("Impossible d'ouvrir le navigateur.")));});
 child.unref();
 for(let i=0;i<40;i++){if(await occupied(rt.ports[kind])){rt.verifyBrowser(kind);focusDedicatedWindow(kind);return "Connectez-vous dans la fenêtre ouverte, puis cliquez sur Vérifier les connexions.";}await new Promise(r=>setTimeout(r,500));}
 throw new Error("Le navigateur ne répond pas.");
}
async function inspect(kind){
 rt.verifyBrowser(kind);
 const browser=await require("puppeteer").connect({browserURL:"http://127.0.0.1:"+rt.ports[kind]});
 try{
  const pages=await browser.pages();
  if(kind==="agatt"){
   const page=pages.find(p=>new URL(p.url()).hostname==="agatt.sdis14.fr");
   if(!page)throw new Error("Terminez votre connexion AGATT.");
   const ids=await page.evaluate(()=>[...new Set([...document.querySelectorAll("div.c[id]")].map(e=>(e.id.match(/^(p\d+)_\d{8}$/)||[])[1]).filter(Boolean))]);
   if(ids.length!==1)throw new Error("Affichez uniquement votre planning personnel dans AGATT, puis réessayez.");
   const cfg=rt.config();rt.writeJson("colleague-config.json",{...cfg,agentId:ids[0]});
   return true;
  }
  const page=pages.find(p=>{try{const u=new URL(p.url());return u.hostname==="formation.pompiers-14.org"&&/\/agenda\/?$/.test(u.pathname);}catch{return false;}});
  if(!page)throw new Error("Dans Dendreo, ouvrez votre agenda puis réessayez.");
  const cfg=rt.config();rt.writeJson("colleague-config.json",{...cfg,dendreoUrl:page.url()});return true;
 }finally{await browser.disconnect();}
}
async function status(kind){
 try{rt.verifyBrowser(kind);}catch(error){return {connected:false,reconnect:false,temporary:false,available:false,reason:"browser_unavailable"};}
 let browser;
 try{
  browser=await require("puppeteer").connect({browserURL:"http://127.0.0.1:"+rt.ports[kind]});
  const pages=await browser.pages();
  if(kind==="agatt"){
   const authPage=pages.find(p=>{try{const u=new URL(p.url());return u.hostname==="auth.sdis14.fr";}catch{return false;}});
   if(authPage)return {connected:false,reconnect:true,temporary:false,available:true,reason:"auth_page"};
   const page=pages.find(p=>{try{return new URL(p.url()).hostname==="agatt.sdis14.fr";}catch{return false;}});
   if(!page)return {connected:false,reconnect:true,temporary:false,available:true,reason:"agatt_page_missing"};
   const details=await page.evaluate(()=>({url:location.href,login:!!document.querySelector('input[type="password"],form[action*="login" i],button[type="submit"]'),cells:document.querySelectorAll("div.c").length}));
   if(details.login||details.url.includes("auth.sdis14.fr"))return {connected:false,reconnect:true,temporary:false,available:true,reason:"login_form"};
   if(details.cells<=0)return {connected:false,reconnect:true,temporary:false,available:true,reason:"planning_unavailable"};
   return {connected:true,reconnect:false,temporary:false,available:true,reason:"planning_loaded"};
  }
  if(kind==="dendreo"){
   const page=pages.find(p=>{try{return new URL(p.url()).hostname==="formation.pompiers-14.org";}catch{return false;}});
   if(!page)return {connected:false,reconnect:true,temporary:false,available:true,reason:"dendreo_page_missing"};
   const details=await page.evaluate(()=>({url:location.href,login:!!document.querySelector('input[type="password"],form[action*="login" i],form[action*="connexion" i]'),agenda:/\/agenda(?:[/?#]|$)/i.test(location.pathname),agendaLink:!!document.querySelector('a[href*="/agenda"]'),loginText:/\b(se\s+connecter|identifiant|mot\s+de\s+passe|connexion\s+à\s+votre\s+compte)\b/i.test(document.body&&document.body.innerText||"")}));
   if(details.login||details.loginText)return {connected:false,reconnect:true,temporary:false,available:true,reason:"login_page"};
   if(details.agenda||details.agendaLink)return {connected:true,reconnect:false,temporary:false,available:true,reason:"extranet_authenticated"};
   return {connected:false,reconnect:true,temporary:false,available:true,reason:"agenda_missing"};
  }
  return {connected:false,reconnect:false,temporary:false,available:true,reason:"unsupported"};
 }catch(error){return {connected:false,reconnect:false,temporary:true,available:true,reason:"temporary_error"};}
 finally{if(browser)try{await browser.disconnect();}catch{}}
}
module.exports={open,inspect,status};
