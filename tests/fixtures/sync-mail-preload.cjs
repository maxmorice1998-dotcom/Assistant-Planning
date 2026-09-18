"use strict";
// Real automatic entry point, runner, file locks and mail sender; external services are isolated.
const fs=require("fs"),path=require("path"),Module=require("module"),{EventEmitter}=require("events");
const root=path.resolve(__dirname,"../.."),rt=require(path.join(root,"runtime-config"));
const originalLoad=Module._load,childProcess=require("child_process"),spawn=childProcess.spawn;
rt.oauthConfigured=()=>true;rt.hasSecret=()=>true;rt.verifyBrowser=()=>{};
const google={oauth2:()=>({userinfo:{get:async()=>({data:{email:"integration@example.test"}})}}),gmail:()=>({users:{messages:{send:async({requestBody})=>{
 const raw=Buffer.from(requestBody.raw,"base64url").toString("utf8");
 fs.appendFileSync(rt.dataPath("captured-mails.jsonl"),JSON.stringify({error:raw.includes(Buffer.from("Assistant Planning - synchronisation incomplète").toString("base64"))})+"\n");
 return {data:{id:"local-test"}};
}}}})};
const oauth={authorizedClient:async()=>({auth:{}}),status:async()=>{
 if(process.env.SDIS_FIXTURE_MODE!=="success"){
  fs.writeFileSync(rt.dataPath("failure-active"),"active");
  await new Promise(r=>setTimeout(r,1500));throw new Error(process.env.SDIS_FIXTURE_ERROR||"Connexion AGATT : planning non connecté.");
 }
 return {connected:true};
}};
const browser={status:async()=>({connected:true,available:true}),inspect:async()=>{},closeDedicated:async()=>true};
Module._load=function(request,parent,isMain){
 if(request==="googleapis")return {google};
 if(request==="./google-oauth-v2")return oauth;
 if(request==="./browser-manager")return browser;
 if(request==="./sdis-utils")return {readExecutionSnapshot:()=>null};
 if(request==="./diagnostic-report")return {safeMessage:e=>String(e.message||e),reportError:()=>{fs.appendFileSync(rt.dataPath("unexpected-diagnostics"),"unexpected\n");}};
 return originalLoad.call(this,request,parent,isMain);
};
childProcess.spawn=function(exe,args,options){
 if(path.basename(args[0]||"")==="send-combined-alerts.js"){
  return spawn.call(this,exe,["--require",__filename,...args],options);
 }
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr.setEncoding=()=>{};child.kill=()=>{};
 queueMicrotask(()=>child.emit("close",0));return child;
};
