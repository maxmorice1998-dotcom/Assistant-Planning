"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
function setup(){
 const secrets=new Map(),module={exports:{}};
 const rt={hasSecret:name=>secrets.has(name),secret:name=>secrets.get(name),saveSecret:(name,value)=>secrets.set(name,value),parseJson:JSON.parse};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","agatt-session.js"),"utf8"),{module,require:name=>{assert.equal(name,"./runtime-config");return rt;},URL,setTimeout});
 return {session:module.exports,secrets};
}
test("save session cookies and credentials only after confirmed login",async()=>{
 const {session,secrets}=setup();
 const listeners=new Map(),window={};
 const username={value:""},password={value:"",form:{querySelector:()=>username}};
 const document={querySelector:()=>password,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const page={url:()=>"https://auth.sdis14.fr/login",exposeFunction:async(name,fn)=>{window[name]=async login=>fn(login);},evaluateOnNewDocument:async()=>({identifier:"hook"}),evaluate:async fn=>vm.runInNewContext(`(${fn.toString()})()`,{window,document,location:{protocol:"https:",hostname:"auth.sdis14.fr"}}),removeScriptToEvaluateOnNewDocument:async()=>{},removeExposedFunction:async name=>{delete window[name];}};
 const browser={on(){},off(){},pages:async()=>[page],cookies:async()=>[{domain:"auth.sdis14.fr",name:"session",value:"test",expires:-1},{domain:"other.example",name:"secret",value:"excluded"}]};
 const finish=await session.watchManual(browser);
 // Submit can navigate away before the next status poll.
 username.value="test-agent";password.value="test-password";
 listeners.get("submit")();password.value="";username.value="";
 assert.equal(secrets.size,0);
 await finish(true);
 assert.equal(JSON.parse(secrets.get("agatt-session")).length,1);
 assert.equal(JSON.parse(secrets.get("agatt-login")).username,"test-agent");
 assert.equal(JSON.parse(secrets.get("agatt-login")).password,"test-password");
 assert.equal(listeners.size,0);
});
test("failed manual login discards captured credentials",async()=>{
 const {session,secrets}=setup();let capture;
 const page={url:()=>"https://auth.sdis14.fr/login",exposeFunction:async(name,fn)=>{capture=fn;},evaluateOnNewDocument:async()=>({identifier:"hook"}),evaluate:async()=>{},removeScriptToEvaluateOnNewDocument:async()=>{},removeExposedFunction:async()=>{}};
 const finish=await session.watchManual({on(){},off(){},pages:async()=>[page]});
 capture({username:"test",password:"incorrect"});await finish(false);
 await session.save({cookies:async()=>[]});assert.equal(secrets.has("agatt-login"),false);
});
test("restored authenticated planning never submits saved credentials",async()=>{
 const {session,secrets}=setup();const order=[];
 secrets.set("agatt-session",JSON.stringify([{domain:"agatt.sdis14.fr",name:"session",value:"test",expires:-1}]));
 secrets.set("agatt-login",JSON.stringify({username:"test",password:"test"}));
 const page={url:()=>"https://agatt.sdis14.fr/register/index.php",goto:async()=>order.push("navigate"),evaluate:async(fn,arg)=>{assert.equal(arg,undefined);order.push("planning");return true;}};
 assert.equal(await session.reconnect({pages:async()=>[page],setCookie:async()=>order.push("restore")}),true);
 assert.deepEqual(order,["restore","navigate","planning"]);
});
test("restore excludes expired and unrelated cookies without changing their expiry",async()=>{
 const {session,secrets}=setup();let restored;
 secrets.set("agatt-session",JSON.stringify([{domain:"auth.sdis14.fr",name:"session",value:"test",expires:-1},{domain:"agatt.sdis14.fr",expires:1},{domain:"other.example",expires:-1}]));
 assert.equal(await session.restore({setCookie:async(...cookies)=>{restored=cookies;}}),true);
 assert.equal(restored.length,1);assert.equal(restored[0].expires,-1);
});
test("never read or send saved credentials on another site",async()=>{
 const {session,secrets}=setup();secrets.set("agatt-login",JSON.stringify({username:"test",password:"test"}));
 const page={url:()=>"https://other.example/login",evaluate:async()=>{throw new Error("Untrusted page evaluated");}};
 await session.observe([page]);assert.equal(await session.signIn(page),false);
 assert.equal(session.trusted("http://auth.sdis14.fr/login"),false);
 assert.equal(session.trusted("https://auth.sdis14.fr.other.example/login"),false);
 assert.equal(session.allowedCookie({domain:".sdis14.fr"}),true);
 assert.equal(session.allowedCookie({domain:".sdis14.fr.other.example"}),false);
});
