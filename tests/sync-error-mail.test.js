"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"sync-error-mail.js"),"utf8");
function setup(){
 const dir=fs.mkdtempSync(path.join(root,".mail-state-test-")),module={exports:{}};
 const rt={dataPath:name=>path.join(dir,name),readJson(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}},writeJson(name,value){fs.writeFileSync(path.join(dir,name),JSON.stringify(value));}};
 const modules={crypto,fs,"./runtime-config":rt,"./operation-lock":require("../operation-lock")};
 vm.runInNewContext(source,{module,require:name=>modules[name],Date});
 return {gate:module.exports,rt,cleanup(){assert.equal(path.dirname(path.resolve(dir)),root);fs.rmSync(dir,{recursive:true,force:true});}};
}
test("an uncertain network failure cannot send the same alert again",async()=>{
 const {gate,rt,cleanup}=setup();const error={errorStage:"Google",errorMessage:"HTTP 503"};let calls=0;
 try{
  await assert.rejects(gate.once(error,async reserve=>{calls++;reserve();throw new Error("Timeout after possible acceptance");}));
  assert.equal((await gate.once(error,async reserve=>{calls++;reserve();return true;})).duplicate,true);
  assert.equal(calls,1);assert.equal(rt.readJson("sync-error-mail.json",{}).status,"sending");
 }finally{cleanup();}
});
test("no reservation when no mail request can be made",async()=>{
 const {gate,rt,cleanup}=setup();try{
  await gate.once({errorMessage:"failure"},async()=>false);
  assert.equal(rt.readJson("sync-error-mail.json",null),null);
 }finally{cleanup();}
});
test("signature ignores stack locations but preserves genuinely different HTTP codes",()=>{
 const {gate,cleanup}=setup();try{
  const signature=message=>gate.signature({errorStage:"AGATT",errorMessage:message});
  assert.equal(signature("Error: HTTP 401 | at main (C:/a.js:1:2)"),signature("HTTP 401 | at main (C:/b.js:8:9)"));
  assert.notEqual(signature("HTTP 401"),signature("HTTP 403"));
 }finally{cleanup();}
});
