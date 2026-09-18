"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),{EventEmitter}=require("node:events");
for(const kind of ["agatt","dendreo"])test(`${kind} connection button launches a visible browser when no browser is running`,async()=>{
 let running=false;const launched=[];
 const runtime={ports:{agatt:19222,dendreo:19223},initialize(){},profile:()=>"profile",browserExe:()=>"chrome.exe",verifyBrowser(){},dataPath:name=>name};
 const modules={
  "./runtime-config":runtime,
  fs:{mkdirSync(){}},
  net:{connect(){const socket=new EventEmitter();socket.setTimeout=()=>{};socket.destroy=()=>{};queueMicrotask(()=>socket.emit(running?"connect":"error"));return socket;}},
  child_process:{spawn(exe,args,options){launched.push({exe,args,options});running=true;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit("spawn"));return child;},spawnSync:()=>({status:0})},
  "./operation-lock":{ensureAvailable(){}}
 };
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","browser-manager.js"),"utf8"),{module,require:name=>{assert.ok(name in modules,name);return modules[name];},process:{env:{}},setTimeout,URL});
 await module.exports.open(kind);
 assert.equal(launched.length,1);assert.equal(launched[0].exe,"chrome.exe");assert.equal(launched[0].options.windowsHide,false);
 assert.ok(!launched[0].args.some(arg=>arg.startsWith("--headless")));
 const target=kind==="agatt"?"https://agatt.sdis14.fr/":"https://formation.pompiers-14.org/login/formateur";
 assert.ok(launched[0].args.some(arg=>arg.startsWith("--app="+target)));
});
