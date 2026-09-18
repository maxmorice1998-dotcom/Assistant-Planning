"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function manager({missing=false,failed=false,body="[]",type="application/json",responseUrl="https://formation.pompiers-14.org/formateurs/1/events"}={}){
 const state={dendreo:{connected:true}};
 const runtime={root:__dirname,ports:{dendreo:19223},initialize(){},verifyBrowser(){if(missing)throw Error("closed");},readJson:()=>state,writeJson:(name,value)=>Object.assign(state,value),dataPath:name=>name};
 const page={url:()=>"https://formation.pompiers-14.org/formateurs/1/agenda",evaluate:async fn=>fn()};
 const browser={pages:async()=>[page],disconnect:async()=>{}};
 const module={exports:{}};
 const modules={"./runtime-config":runtime,fs:{appendFileSync(){}},net:{},child_process:{},puppeteer:{connect:async()=>{if(failed)throw Error("offline");return browser;}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","browser-manager.js"),"utf8"),{
  module,require:name=>modules[name],URL,URLSearchParams,AbortSignal,setTimeout,process:{env:{}},
  location:{href:page.url(),origin:"https://formation.pompiers-14.org",pathname:"/formateurs/1/agenda"},
  document:{querySelector:()=>null,body:{innerText:"Agenda"}},window:{config_agenda:{events_url:"/formateurs/1/events"}},
  fetch:async()=>({ok:true,url:responseUrl,headers:{get:()=>type},text:async()=>body})
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
