"use strict";
// Interactive integration test. Never output credentials, cookies or page content.
const path=require("path"),net=require("net");
const root=path.join(process.env.LOCALAPPDATA,"Assistant Planning");
const rt=require(path.join(root,"runtime-config"));
const manager=require(path.join(root,"browser-manager"));
const session=require(path.join(root,"agatt-session"));
const puppeteer=require(path.join(root,"node_modules","puppeteer"));
const target="https://agatt.sdis14.fr/register/index.php?a=gardeExercice";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function portClosed(){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  const open=await new Promise(resolve=>{const socket=net.connect({host:"127.0.0.1",port:rt.ports.agatt});socket.setTimeout(500);socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",()=>resolve(false));socket.once("timeout",()=>{socket.destroy();resolve(false);});});
  if(!open)return;await sleep(250);
 }
 throw new Error("browser_not_closed");
}
async function connect(){rt.verifyBrowser("agatt");return puppeteer.connect({browserURL:"http://127.0.0.1:"+rt.ports.agatt});}
async function main(){
 if(!rt.hasSecret("agatt-login")){
  await manager.open("agatt");
  const browser=await connect();let finish;
  try{
   finish=await session.watchManual(browser);
   const cookies=(await browser.cookies()).filter(session.allowedCookie);
   if(cookies.length)await browser.deleteCookie(...cookies);
   const page=(await browser.pages()).find(p=>session.trusted(p.url()));
   if(!page)throw new Error("agatt_page_missing");
   await page.goto(target,{waitUntil:"domcontentloaded",timeout:30000});
   console.log(JSON.stringify({phase:"manual_login_required",loginSaved:false}));
   const deadline=Date.now()+5*60*1000;
   let loaded=false;
   while(Date.now()<deadline){
    if(await session.planningLoaded(page)){loaded=true;break;}
    await sleep(250);
   }
   if(!loaded)throw new Error("manual_login_pending");
   await finish(true);finish=null;
   if(!rt.hasSecret("agatt-login"))throw new Error("manual_credentials_not_captured");
   console.log(JSON.stringify({phase:"manual_login_success",loginSaved:true,connected:true,reason:"planning_loaded"}));
  }finally{if(finish)await finish(false);await browser.disconnect();}
 }
 await manager.closeDedicated("agatt");await portClosed();
 await manager.open("agatt",{background:true});
 if(!await manager.reconnectAgatt())throw new Error("automatic_reconnect_failed");
 const result=await manager.status("agatt");
 if(result.connected!==true||result.reason!=="planning_loaded")throw new Error("planning_not_loaded");
 console.log(JSON.stringify({phase:"reopen_success",sessionSaved:rt.hasSecret("agatt-session"),loginSaved:rt.hasSecret("agatt-login"),connected:true,reason:"planning_loaded"}));
 await manager.closeDedicated("agatt");await portClosed();
 // Remove only AGATT cookies from the live browser, keeping the saved DPAPI session.
 // Exercise the password fallback with expired/absent cookies as well.
 await manager.open("agatt",{background:true});
 const browser=await connect();
 try{
  const cookies=(await browser.cookies()).filter(session.allowedCookie);
  if(cookies.length)await browser.deleteCookie(...cookies);
  const page=(await browser.pages()).find(p=>session.trusted(p.url()));
  await page.goto(target,{waitUntil:"domcontentloaded",timeout:30000});
  if(!await session.planningLoaded(page)){
   if(!await session.signIn(page))throw new Error("extra_validation_or_login_unavailable");
   const deadline=Date.now()+15000;let loaded=false;
   while(Date.now()<deadline){if(await session.planningLoaded(page)){loaded=true;break;}await sleep(250);}
   if(!loaded)throw new Error("password_reconnect_failed_or_extra_validation");
   await session.save(browser);
   console.log(JSON.stringify({phase:"password_fallback_success",loginSaved:true,connected:true,reason:"planning_loaded"}));
  }else console.log(JSON.stringify({phase:"password_fallback_not_exercised",reason:"existing_sso_session"}));
 }finally{await browser.disconnect();await manager.closeDedicated("agatt");}
}
main().catch(error=>{
 const known=new Set(["browser_not_closed","agatt_page_missing","manual_login_pending","manual_credentials_not_captured","automatic_reconnect_failed","planning_not_loaded","extra_validation_or_login_unavailable","password_reconnect_failed_or_extra_validation"]);
 console.log(JSON.stringify({phase:"test_incomplete",reason:known.has(error.message)?error.message:"test_unavailable",loginSaved:rt.hasSecret("agatt-login")}));
 process.exitCode=1;
});
