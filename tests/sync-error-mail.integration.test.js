"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("fs"),path=require("path"),{spawn}=require("child_process");
const root=path.resolve(__dirname,".."),preload=path.join(__dirname,"fixtures","sync-mail-preload.cjs");
test("real processes: three triggers, same failure at +5 min, success, then a new alert",async()=>{
 const dir=fs.mkdtempSync(path.join(root,".mail-integration-"));
 function launch(mode="error",error){
  const child=spawn(process.execPath,["--require",preload,path.join(root,"background-sync.js")],{cwd:root,windowsHide:true,env:{...process.env,SDIS_COLLEAGUES_TEST_DIR:dir,SDIS_DIAGNOSTIC_NO_WORKER:"1",SDIS_FIXTURE_MODE:mode,...(error?{SDIS_FIXTURE_ERROR:error}:{})},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",b=>output+=b);child.stderr.on("data",b=>output+=b);
  const done=new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",code=>resolve({code,output}));});return {child,done};
 }
 function errorCount(){try{return fs.readFileSync(path.join(dir,"captured-mails.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter(m=>m.error).length;}catch(e){if(e.code==="ENOENT")return 0;throw e;}}
 try{
  const first=launch();
  const deadline=Date.now()+10000;
  while(!fs.existsSync(path.join(dir,"failure-active"))){assert.ok(Date.now()<deadline,"runner did not enter preflight");await new Promise(r=>setTimeout(r,25));}
  const others=await Promise.all([launch().done,launch().done]);
  assert.deepEqual(others.map(r=>r.code),[0,0],JSON.stringify(others));
  assert.equal((await first.done).code,1);assert.equal(errorCount(),1);
  assert.equal(fs.existsSync(path.join(dir,"sync.lock")),false);
  const statePath=path.join(dir,"sync-error-mail.json"),state=JSON.parse(fs.readFileSync(statePath,"utf8"));
  state.sentAt=new Date(Date.now()-5*60*1000).toISOString();fs.writeFileSync(statePath,JSON.stringify(state));
  assert.equal((await launch().done).code,1);assert.equal(errorCount(),1);
  const success=await launch("success").done;assert.equal(success.code,0,success.output+fs.readFileSync(path.join(dir,"assistant-planning.log"),"utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath,"utf8")),{});
  assert.equal((await launch().done).code,1);assert.equal(errorCount(),2);
  assert.equal(fs.existsSync(path.join(dir,"unexpected-diagnostics")),false);
  // Changed errors and the end of the fixed 30-minute window allow a new alert.
  assert.equal((await launch("error","AGATT : HTTP 403").done).code,1);assert.equal(errorCount(),3);
  const expired=JSON.parse(fs.readFileSync(statePath,"utf8"));expired.sentAt=new Date(Date.now()-31*60*1000).toISOString();fs.writeFileSync(statePath,JSON.stringify(expired));
  assert.equal((await launch("error","AGATT : HTTP 403").done).code,1);assert.equal(errorCount(),4);
 }finally{assert.equal(path.dirname(path.resolve(dir)),root);fs.rmSync(dir,{recursive:true,force:true});}
});
