"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{PassThrough}=require("node:stream"),{EventEmitter}=require("node:events");
function client(routes){
 const calls=[];
 const https={get(url,options,callback){
  const req=new EventEmitter();req.destroy=error=>req.emit("error",error);
  const address=String(url);calls.push(address);
  queueMicrotask(()=>{
   const route=routes[address];if(!route){req.emit("error",new Error("Unexpected URL "+address));return;}
   const res=new PassThrough();res.statusCode=route.status||200;res.headers=route.headers||{};
   callback(res);res.end(route.body||"");
  });return req;
 }};
 const rt={parseJson:JSON.parse,readProgramJson(name){return name==="app-version.json"?{version:"1.0.39"}:{manifestUrl:"https://github.test/latest"};},dataDir:__dirname,dataPath:name=>path.join(__dirname,name)};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","update-client.js"),"utf8"),{module,require:name=>name==="https"?https:name==="./runtime-config"?rt:require(name),URL,Buffer,process,setTimeout,console});
 return {api:module.exports,calls};
}
test("update check follows the GitHub manifest redirects and detects v40",async()=>{
 const {api,calls}=client({
  "https://github.test/latest":{status:302,headers:{location:"/v40/manifest"}},
  "https://github.test/v40/manifest":{status:302,headers:{location:"https://assets.test/manifest"}},
  "https://assets.test/manifest":{body:JSON.stringify({version:"1.0.40",app:{url:"https://github.test/package",sha256:"a".repeat(64),size:4}})}
 });
 const result=await api.check();assert.equal(result.available,true);assert.equal(result.version,"1.0.40");assert.equal(calls.length,3);
});
test("package download follows redirects and writes the actual bytes",async()=>{
 const {api}=client({"https://github.test/package":{status:302,headers:{location:"https://assets.test/package"}},"https://assets.test/package":{body:"PK test payload",headers:{"content-length":"15"}}});
 const dir=fs.mkdtempSync(path.join(__dirname,"..",".installer-test-download-")),file=path.join(dir,"package.zip");
 try{await api.download("https://github.test/package",file);assert.equal(fs.readFileSync(file,"utf8"),"PK test payload");}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("reject insecure redirects and redirect loops",async()=>{
 const insecure=client({"https://github.test/package":{status:302,headers:{location:"http://assets.test/package"}}});
 await assert.rejects(insecure.api.fetchJson("https://github.test/package"),/non sécurisé/);
 const loop=client({"https://github.test/package":{status:302,headers:{location:"/package"}}});
 await assert.rejects(loop.api.fetchJson("https://github.test/package"),/Redirection/);assert.equal(loop.calls.length,9);
});
test("a truncated download fails and removes its incomplete file",async()=>{
 const {api}=client({"https://assets.test/package":{body:"short",headers:{"content-length":"100"}}});
 const dir=fs.mkdtempSync(path.join(__dirname,"..",".installer-test-download-")),file=path.join(dir,"package.zip");
 try{await assert.rejects(api.download("https://assets.test/package",file),/incomplet/);assert.equal(fs.existsSync(file),false);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
