"use strict";
const rt=require("./runtime-config");
const fs=require("fs");
const net=require("net");
const {spawn,spawnSync}=require("child_process");
const urls={agatt:"https://agatt.sdis14.fr/register/index.php?a=gardeExercice",dendreo:"https://formation.pompiers-14.org/"};
const stateFile="connection-status.json";
function readConnectionState(kind){
 try{const value=rt.readJson(stateFile,{});const item=value&&value[kind];return item&&typeof item.connected==="boolean"?item:null;}catch{return null;}
}
function writeConnectionState(kind,connected,reason){
 try{const value=rt.readJson(stateFile,{});value[kind]={connected:Boolean(connected),reason:String(reason||""),at:new Date().toISOString()};rt.writeJson(stateFile,value);}catch{}
}
function reportStatus(kind,status){
 if(status.connected===true||status.reconnect===true&&status.reason!=="browser_unavailable")writeConnectionState(kind,status.connected===true,status.reason);
 const cached=readConnectionState(kind);
 if(status.reason==="browser_unavailable"&&cached&&cached.connected===true){
  status={...status,connected:false,reconnect:false,temporary:true,reason:"saved_session_unverified",lastConfirmed:true};
 }
 if(status.temporary===true&&cached&&cached.connected===true){
  status={...status,connected:false,reconnect:false,lastConfirmed:true};
 }
 try{const label=kind.toUpperCase();const detail=String(status.reason||"");const line=label+" status -> "+(status.connected===true?"connected":(status.reconnect===true?"disconnected":"unknown"))+(detail?" ("+detail+")":"");rt.initialize();fs.appendFileSync(rt.dataPath("assistant-planning.log"),line+"\n","utf8");}catch{}
 return status;
}
async function occupied(port){
 return new Promise(resolve=>{const sock=net.connect({host:"127.0.0.1",port});
 sock.setTimeout(300);sock.on("connect",()=>{sock.destroy();resolve(true);});
 sock.on("error",()=>resolve(false));sock.on("timeout",()=>{sock.destroy();resolve(false);});});
}
async function waitForPort(port,timeoutMs=15000){
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){if(await occupied(port))return true;await new Promise(r=>setTimeout(r,80));}
 return false;
}
async function waitForClosedPort(port,timeoutMs=8000){
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){if(!await occupied(port))return true;await new Promise(resolve=>setTimeout(resolve,80));}
 return false;
}
function psQuote(value){return "'"+String(value).replace(/'/g,"''")+"'";}
function normalizeWindowBounds(value){
 const b=value&&typeof value==='object'?value:{};
 const n=(x,f)=>Number.isFinite(Number(x))?Math.trunc(Number(x)):f;
 return {x:n(b.x,0),y:n(b.y,0),width:Math.max(320,n(b.width,640)),height:Math.max(240,n(b.height,700))};
}
function windowArguments(bounds){const b=normalizeWindowBounds(bounds);return [`--window-position=${b.x},${b.y}`,`--window-size=${b.width},${b.height}`];}
function focusDedicatedWindow(kind,bounds){
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
$windowBounds=ConvertFrom-Json '${JSON.stringify(normalizeWindowBounds(bounds))}'
$boundsX=[int]$windowBounds.x
$boundsY=[int]$windowBounds.y
$boundsW=[int]$windowBounds.width
$boundsH=[int]$windowBounds.height
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AssistantPlanningWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
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
  [AssistantPlanningWindow]::SetWindowPos($handle,[IntPtr]::Zero,$boundsX,$boundsY,$boundsW,$boundsH,0x0040) | Out-Null
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
function focusDedicatedWindowSoon(kind,bounds){
 Promise.resolve().then(()=>focusDedicatedWindow(kind,bounds)).catch(()=>{});
}
 async function open(kind,options={}){
  const background=options&&options.background===true;
 if(!urls[kind])throw new Error("Connexion inconnue.");rt.initialize();
 if(!background){const locks=require('./operation-lock');for(const name of ['sync.lock','update.lock'])locks.ensureAvailable(rt.dataPath(name),name==='update.lock'?'update':'sync');}
 let existingWindow=1;
 let reopening=false;
 if(await occupied(rt.ports[kind])){
  rt.verifyBrowser(kind);
  if(!background)existingWindow=focusDedicatedWindow(kind,options&&options.windowBounds);
  if(!background&&existingWindow===2){
   if(!await closeDedicated(kind))throw new Error("Impossible de fermer la session invisible pour vous reconnecter.");
   if(!await waitForClosedPort(rt.ports[kind],8000))throw new Error("La session précédente se ferme encore. Réessayez dans quelques secondes.");
   reopening=true;
  }else{if(!background&&existingWindow!==0)focusDedicatedWindowSoon(kind,options&&options.windowBounds);return "La fenêtre de connexion est déjà ouverte.";}
 }
 if(!reopening&&(existingWindow===0||existingWindow===2)){
  if(await waitForPort(rt.ports[kind],15000)){rt.verifyBrowser(kind);if(!background)focusDedicatedWindowSoon(kind,options&&options.windowBounds);return "La fenêtre de connexion est déjà ouverte.";}
  throw new Error("Le navigateur ne répond pas.");
 }
 fs.mkdirSync(rt.profile(kind),{recursive:true});
  let target=kind==='dendreo'&&!background?'https://formation.pompiers-14.org/login/formateur':urls[kind];
  if(kind==='dendreo'&&background&&typeof rt.config==='function'){
   try{const saved=new URL(rt.config().dendreoUrl||'');if(saved.protocol==='https:'&&saved.hostname==='formation.pompiers-14.org'&&/\/agenda\/?$/.test(saved.pathname))target=saved.href;}catch{}
  }
  const browserArgs=(background?["--headless=new","--disable-gpu"]:[]).concat(background?[]:windowArguments(options&&options.windowBounds)).concat(["--app="+target,"--remote-debugging-address=127.0.0.1",
   "--remote-debugging-port="+rt.ports[kind],"--user-data-dir="+rt.profile(kind),
   "--no-first-run","--no-default-browser-check","--disable-background-mode","--enable-automation"]);
  const child=spawn(rt.browserExe(),browserArgs,{detached:true,stdio:"ignore",windowsHide:background});
 await new Promise((resolve,reject)=>{child.once("spawn",resolve);child.once("error",()=>reject(new Error("Impossible d'ouvrir le navigateur.")));});
 child.unref();
  if(await waitForPort(rt.ports[kind],15000)){rt.verifyBrowser(kind);if(!background)focusDedicatedWindowSoon(kind,options&&options.windowBounds);return background?"Session persistante ouverte en arriere-plan.":"Connectez-vous dans la fenêtre ouverte, puis cliquez sur Vérifier les connexions.";}
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
async function closeDedicated(kind){
 if(!rt.ports[kind])return false;
 let browser;
 try{
  rt.verifyBrowser(kind);
  browser=await require("puppeteer").connect({browserURL:"http://127.0.0.1:"+rt.ports[kind]});
  // Demande de fermeture immédiate, sans laisser Puppeteer bloquer l'interface.
  await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,900))]);
  if(await occupied(rt.ports[kind]))forceCloseDedicated(kind);
  return true;
 }catch{return false;}
 finally{if(browser)try{await browser.disconnect();}catch{}}
}
function forceCloseDedicated(kind){
 const powershell=process.env.SystemRoot
  ? require("path").join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe")
  : "powershell.exe";
 const portNeedle=psQuote("--remote-debugging-port="+rt.ports[kind]);
 const profileNeedle=psQuote("--user-data-dir="+rt.profile(kind));
 const script=`$ErrorActionPreference='SilentlyContinue'
$portNeedle=${portNeedle}
$profileNeedle=${profileNeedle}
foreach($process in Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"){
  $line=[string]$process.CommandLine
  if($line.IndexOf($portNeedle,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
     $line.IndexOf($profileNeedle,[StringComparison]::OrdinalIgnoreCase) -ge 0){
    Stop-Process -Id ([int]$process.ProcessId) -Force
  }
}`;
 try{spawnSync(powershell,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",script],{windowsHide:true,timeout:3000,stdio:["ignore","ignore","ignore"]});}catch{}
}
 async function status(kind){
  try{rt.verifyBrowser(kind);}catch(error){return reportStatus(kind,{connected:false,reconnect:false,temporary:false,available:false,reason:"browser_unavailable"});}
 let browser;
 try{
  browser=await require("puppeteer").connect({browserURL:"http://127.0.0.1:"+rt.ports[kind]});
  const pages=await browser.pages();
  if(kind==="agatt"){
   await require("./agatt-session").observe(pages);
   const candidates=pages.filter(p=>{try{const u=new URL(p.url());return u.protocol==="https:"&&u.hostname==="agatt.sdis14.fr";}catch{return false;}});
   for(const page of candidates){
    const details=await page.evaluate(()=>({url:location.href,login:!!document.querySelector('input[type="password"],form[action*="login" i]'),cells:document.querySelectorAll("div.c").length}));
    if(!details.login&&new URL(details.url).hostname==="agatt.sdis14.fr"&&details.cells>0){
     await require("./agatt-session").save(browser);
     return reportStatus(kind,{connected:true,reconnect:false,temporary:false,available:true,reason:"planning_loaded"});
    }
   }
   const authPage=pages.some(p=>{try{return new URL(p.url()).hostname==="auth.sdis14.fr";}catch{return false;}});
   return reportStatus(kind,{connected:false,reconnect:true,temporary:false,available:true,reason:authPage?"auth_page":candidates.length?"planning_unavailable":"agatt_page_missing"});
  }
  if(kind==="dendreo"){
   const candidates=pages.filter(p=>{try{const u=new URL(p.url());return u.protocol==="https:"&&u.hostname==="formation.pompiers-14.org";}catch{return false;}});
   const page=candidates.find(p=>/\/agenda\/?$/.test(new URL(p.url()).pathname))||candidates.find(p=>!/^\/login(?:\/|$)/i.test(new URL(p.url()).pathname))||candidates[0];
    if(!page)return reportStatus(kind,{connected:false,reconnect:true,temporary:false,available:true,reason:"dendreo_page_missing"});
   const details=await page.evaluate(()=>({url:location.href,login:!!document.querySelector('input[type="password"],form[action*="login" i],form[action*="connexion" i]'),agenda:/\/agenda(?:[/?#]|$)/i.test(location.pathname),agendaLink:document.querySelector('a[href*="/agenda"]')?.href||"",loginText:/\b(se\s+connecter|identifiant|mot\s+de\s+passe|connexion\s+à\s+votre\s+compte)\b/i.test(document.body&&document.body.innerText||"")}));
    if(/\/login(?:\/|$)/i.test(new URL(details.url).pathname)||details.login||details.loginText)return reportStatus(kind,{connected:false,reconnect:true,temporary:false,available:true,reason:"login_page"});
    if((details.agenda||details.agendaLink)&&!/^\/login(?:\/|$)/i.test(new URL(details.url).pathname)){
     const api=await page.evaluate(async(agendaLink)=>{
      try{
       let url;
       if(window.config_agenda&&window.config_agenda.events_url)url=new URL(window.config_agenda.events_url,location.href);
       else{const agenda=new URL(agendaLink||location.href,location.href);url=new URL(agenda.origin+agenda.pathname.replace(/\/agenda\/?$/,'')+'/events');}
       if(url.origin!==location.origin)return false;
       const now=new Date(),end=new Date(now);end.setDate(end.getDate()+1);
       const iso=d=>d.toISOString().slice(0,10)+'T00:00:00';
       url.search=new URLSearchParams({start:iso(now),end:iso(end),mode:'filter_agenda',agendaType:'agenda_principal',agendaMode:'principal',typeAgendaEvents:'me_or_groups'});
       const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
       if(response.status>=500)return {temporary:true};
       const text=await response.text();
       if(!response.ok||!/json/i.test(String(response.headers.get('content-type')||''))||/^\s*</.test(text))return false;
       if(response.url&&/\/login(?:\/|$)/i.test(new URL(response.url).pathname))return false;
       return Array.isArray(JSON.parse(text));
      }catch(error){return error instanceof SyntaxError?false:{temporary:true};}
     },details.agendaLink);
     if(api&&api.temporary)return reportStatus(kind,{connected:false,reconnect:false,temporary:true,available:true,reason:"api_unavailable"});
     if(api!==true)return reportStatus(kind,{connected:false,reconnect:true,temporary:false,available:true,reason:"api_login_page"});
     return reportStatus(kind,{connected:true,reconnect:false,temporary:false,available:true,reason:"extranet_authenticated"});
    }
    return reportStatus(kind,{connected:false,reconnect:true,temporary:false,available:true,reason:"agenda_missing"});
  }
   return reportStatus(kind,{connected:false,reconnect:false,temporary:false,available:true,reason:"unsupported"});
  }catch(error){return reportStatus(kind,{connected:false,reconnect:false,temporary:true,available:true,reason:"temporary_error"});}
 finally{if(browser)try{await browser.disconnect();}catch{}}
}
async function verifySession(kind){
 let current=await status(kind);
 if(current.available!==false||!current.lastConfirmed)return current;
 try{
  const locks=require("./operation-lock");
  for(const name of ["sync.lock","update.lock"])locks.ensureAvailable(rt.dataPath(name),name==="sync.lock"?"sync":"update");
  await open(kind,{background:true});
  const deadline=Date.now()+15000;let restored=false;
  do{
   current=await status(kind);
   if(current.connected)return current;
   if(kind==="agatt"&&current.reconnect&&!restored){restored=true;await reconnectAgatt();}
   await new Promise(resolve=>setTimeout(resolve,250));
  }while(Date.now()<deadline);
  return current;
 }catch{return {...current,connected:false,reconnect:false,temporary:true,reason:"session_verification_unavailable"};}
}
async function reconnectAgatt(){
 rt.verifyBrowser("agatt");
 const browser=await require("puppeteer").connect({browserURL:"http://127.0.0.1:"+rt.ports.agatt});
 try{return await require("./agatt-session").reconnect(browser);}
 catch{throw new Error("AGATT : reconnexion automatique impossible ou validation supplémentaire requise.");}
 finally{await browser.disconnect();}
}
async function captureManualAgatt(){
 rt.verifyBrowser("agatt");
 const browser=await require("puppeteer").connect({browserURL:"http://127.0.0.1:"+rt.ports.agatt});
 try{
  const finish=await require("./agatt-session").watchManual(browser);
  return async success=>{try{await finish(success);}finally{await browser.disconnect();}};
 }catch(error){await browser.disconnect();throw error;}
}
module.exports={open,inspect,status,verifySession,closeDedicated,reconnectAgatt,captureManualAgatt,normalizeWindowBounds,windowArguments};
