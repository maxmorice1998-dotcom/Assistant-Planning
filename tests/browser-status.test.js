"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function manager({missing=false,failed=false,body="[]",type="application/json",responseUrl="https://formation.pompiers-14.org/formateurs/1/events",loginFirst=false,networkError=false,lockActive=false}={}){
 const state={dendreo:{connected:true}};
 const runtime={root:__dirname,ports:{dendreo:19223},initialize(){},profile:()=>"profile",browserExe:()=>"chrome.exe",config:()=>({dendreoUrl:"https://formation.pompiers-14.org/formateurs/1/agenda"}),verifyBrowser(){if(missing)throw Error("closed");},readJson:()=>state,writeJson:(name,value)=>Object.assign(state,value),dataPath:name=>name};
 const page={url:()=>"https://formation.pompiers-14.org/formateurs/1/agenda",evaluate:async fn=>fn()};
 const loginPage={url:()=>"https://formation.pompiers-14.org/login/formateur",evaluate:async()=>{throw Error("Stale login tab selected");}};
 const browser={pages:async()=>loginFirst?[loginPage,page]:[page],disconnect:async()=>{}};
 const module={exports:{}};
 const {EventEmitter}=require("node:events");
 const modules={"./runtime-config":runtime,fs:{appendFileSync(){},mkdirSync(){}},net:{connect(){const sock=new EventEmitter();sock.setTimeout=()=>{};sock.destroy=()=>{};queueMicrotask(()=>sock.emit(missing?"error":"connect"));return sock;}},child_process:{spawn(){missing=false;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit("spawn"));return child;}},"./operation-lock":{ensureAvailable(){if(lockActive)throw Error("locked");}},puppeteer:{connect:async()=>{if(failed)throw Error("offline");return browser;}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","browser-manager.js"),"utf8"),{
  module,require:name=>modules[name],URL,URLSearchParams,AbortSignal,setTimeout,process:{env:{}},
  location:{href:page.url(),origin:"https://formation.pompiers-14.org",pathname:"/formateurs/1/agenda"},
  document:{querySelector:()=>null,body:{innerText:"Agenda"}},window:{config_agenda:{events_url:"/formateurs/1/events"}},
  fetch:async()=>{if(networkError)throw Error("network unavailable");return {ok:true,url:responseUrl,headers:{get:()=>type},text:async()=>body};}
 });return module.exports;
}
test("closed browser cannot turn a remembered Dendreo session green",async()=>{
 const status=await manager({missing:true}).status("dendreo");assert.equal(status.connected,false);assert.equal(status.temporary,true);
});
test("temporary verification error cannot reuse a remembered connected status",async()=>{
 const status=await manager({failed:true}).status("dendreo");assert.equal(status.connected,false);assert.equal(status.temporary,true);
});
for(const options of [{body:'{"error":"login_required"}'},{body:"<html>Login</html>",type:"text/html"},{body:"not json"},{responseUrl:"https://formation.pompiers-14.org/login/formateur"}])test(`reject unauthenticated agenda response ${JSON.stringify(options)}`,async()=>{
 const status=await manager(options).status("dendreo");assert.equal(status.connected,false);assert.equal(status.reconnect,true);
});
test("a verified empty agenda still confirms a valid Dendreo session",async()=>{
 const status=await manager().status("dendreo");assert.equal(status.connected,true);assert.equal(status.temporary,false);
});
test("an old login tab cannot hide an authenticated Dendreo agenda",async()=>{
 assert.equal((await manager({loginFirst:true}).status("dendreo")).connected,true);
});
test("network interruption needs another verification rather than a new login",async()=>{
 const status=await manager({networkError:true}).status("dendreo");assert.equal(status.connected,false);assert.equal(status.temporary,true);assert.equal(status.reconnect,false);
});
test("an old AGATT authentication tab does not hide a loaded planning",async()=>{
 const module={exports:{}};
 const pages=[{url:()=>"https://auth.sdis14.fr/login"},{url:()=>"https://agatt.sdis14.fr/register/index.php",evaluate:async()=>({url:"https://agatt.sdis14.fr/register/index.php",login:false,cells:28})}];
 const modules={"./runtime-config":{ports:{agatt:19222},verifyBrowser(){},initialize(){},readJson:()=>({}),writeJson(){},dataPath:n=>n},fs:{appendFileSync(){}},net:{},child_process:{},"./agatt-session":{observe:async()=>{},save:async()=>{}},puppeteer:{connect:async()=>({pages:async()=>pages,disconnect:async()=>{}})}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","browser-manager.js"),"utf8"),{module,require:n=>modules[n],URL,setTimeout,process:{env:{}}});
 assert.equal((await module.exports.status("agatt")).connected,true);
});
