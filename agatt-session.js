"use strict";
const rt=require("./runtime-config");
const target="https://agatt.sdis14.fr/register/index.php?a=gardeExercice";
const hosts=new Set(["agatt.sdis14.fr","auth.sdis14.fr"]);
let pending;
let savedSession="";
let manualCapture=false;
function trusted(value){try{return new URL(value).protocol==="https:"&&hosts.has(new URL(value).hostname);}catch{return false;}}
function allowedCookie(cookie){const domain=String(cookie.domain||"").replace(/^\./,"");return hosts.has(domain)||domain==="sdis14.fr";}
async function observe(pages){
 if(!manualCapture)return;
 for(const page of pages){
  if(!trusted(page.url()))continue;
  const login=await page.evaluate(()=>{
   const password=document.querySelector('input[type="password"]');
   if(!password)return null;
   const form=password.form;
   const username=(form||document).querySelector('input[autocomplete="username"],input[name="username"],input[name="login"],input[type="email"],input[type="text"]');
   return username&&username.value&&password.value?{username:username.value,password:password.value}:null;
  });
  if(login)pending=login;
 }
}
async function watchManual(browser){
 pending=undefined;manualCapture=true;
 let active=true;
 const attached=new Map();
 const binding="assistantPlanningAgattLogin";
 const hook=()=>{
  if(location.protocol!=="https:"||!["agatt.sdis14.fr","auth.sdis14.fr"].includes(location.hostname))return;
  if(window.__assistantPlanningAgattCapture)return;
  const capture=()=>{
   const password=document.querySelector('input[type="password"]');
   const form=password&&password.form;
   const username=(form||document).querySelector('input[autocomplete="username"],input[name="username"],input[name="login"],input[type="email"],input[type="text"]');
   if(username&&password&&username.value&&password.value)
    window.assistantPlanningAgattLogin({username:username.value,password:password.value}).catch(()=>{});
  };
  window.__assistantPlanningAgattCapture=capture;
  document.addEventListener("input",capture,true);
  document.addEventListener("change",capture,true);
  document.addEventListener("submit",capture,true);
  document.addEventListener("click",capture,true);
  capture();
 };
 async function attach(page){
  if(!active||attached.has(page))return;
  attached.set(page,null);
  await page.exposeFunction(binding,login=>{
   if(active&&trusted(page.url())&&login&&typeof login.username==="string"&&typeof login.password==="string"&&login.username&&login.password)
    pending={username:login.username,password:login.password};
  });
  const script=await page.evaluateOnNewDocument(hook);attached.set(page,script.identifier);
  await page.evaluate(hook);
 }
 const onTarget=target=>{if(target.type()==="page")target.page().then(attach).catch(()=>{});};
 browser.on("targetcreated",onTarget);
 try{for(const page of await browser.pages())await attach(page);}
 catch{active=false;manualCapture=false;browser.off("targetcreated",onTarget);throw new Error("AGATT : capture de connexion indisponible.");}
 return async success=>{
  try{if(success)await save(browser);}finally{
   active=false;manualCapture=false;pending=undefined;browser.off("targetcreated",onTarget);
   for(const [page,id] of attached){
    try{await page.evaluate(()=>{
     const capture=window.__assistantPlanningAgattCapture;
     if(capture)for(const type of ["input","change","submit","click"])document.removeEventListener(type,capture,true);
     delete window.__assistantPlanningAgattCapture;
    });}catch{}
    if(id)try{await page.removeScriptToEvaluateOnNewDocument(id);}catch{}
    try{await page.removeExposedFunction(binding);}catch{}
   }
  }
 };
}
async function save(browser){
 const cookies=(await browser.cookies()).filter(allowedCookie);
 const serialized=JSON.stringify(cookies);
 if(cookies.length&&serialized!==savedSession){rt.saveSecret("agatt-session",serialized);savedSession=serialized;}
 if(pending){rt.saveSecret("agatt-login",JSON.stringify(pending));pending=undefined;}
}
async function restore(browser){
 if(!rt.hasSecret("agatt-session"))return false;
 const cookies=rt.parseJson(rt.secret("agatt-session"));
 const valid=Array.isArray(cookies)?cookies.filter(c=>allowedCookie(c)&&(c.expires===undefined||c.expires<0||c.expires>Date.now()/1000)):[];
 if(!valid.length)return false;
 await browser.setCookie(...valid);
 return true;
}
async function signIn(page){
 if(!trusted(page.url())||!rt.hasSecret("agatt-login"))return false;
 const credentials=rt.parseJson(rt.secret("agatt-login"));
 return page.evaluate(({username,password})=>{
  if(document.querySelector('input[autocomplete="one-time-code"],input[name="otp"],input[name="totp"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha'))return false;
  const passwordInput=document.querySelector('input[type="password"]');
  const form=passwordInput&&passwordInput.form;
  if(!form)return false;
  const action=new URL(form.action||location.href,location.href);
  if(action.protocol!=="https:"||!["agatt.sdis14.fr","auth.sdis14.fr"].includes(action.hostname))return false;
  const usernameInput=form.querySelector('input[autocomplete="username"],input[name="username"],input[name="login"],input[type="email"],input[type="text"]');
  if(!usernameInput||!username||!password)return false;
  for(const [input,value] of [[usernameInput,username],[passwordInput,password]]){
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);
   input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
  }
  form.requestSubmit();return true;
 },credentials);
}
async function reconnect(browser){
 const pages=await browser.pages();
 const page=pages.find(p=>trusted(p.url()));
 if(!page)return;
 try{await restore(browser);}catch{/* A damaged saved session must not prevent password recovery. */}
 await page.goto(target,{waitUntil:"domcontentloaded",timeout:30000});
 if(await planningLoaded(page))return true;
 // A saved password is submitted once; MFA and rejected credentials need the user.
 await signIn(page);
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(await planningLoaded(page))return true;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 return false;
}
async function planningLoaded(page){
 if(!trusted(page.url()))return false;
 try{return await page.evaluate(()=>location.hostname==="agatt.sdis14.fr"&&!document.querySelector('input[type="password"],input[autocomplete="one-time-code"]')&&document.querySelectorAll("div.c").length>0);}catch{return false;}
}
module.exports={observe,watchManual,save,restore,signIn,reconnect,planningLoaded,trusted,allowedCookie};
