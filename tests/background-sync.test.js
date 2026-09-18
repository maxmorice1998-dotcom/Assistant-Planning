"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","background-sync.js"),"utf8");
async function execute(failure){
 const logs=[],calls=[],process={};
 const modules={
  "./runtime-config":{dataDir:"data",dataPath:name=>name},
  fs:{mkdirSync(){},appendFileSync(file,line){logs.push(line);}},
  "./colleague-runner":{async run(options){calls.push(options);if(failure)throw new Error("Internet indisponible");return {ok:true};}},
  "./diagnostic-report":{safeMessage:error=>error.message}
 };
 vm.runInNewContext(source,{require:name=>{assert.ok(name in modules);return modules[name];},process});
 await new Promise(resolve=>setImmediate(resolve));
 return {logs,calls,process};
}
test("automatic sync uses the real engine in background and logs success",async()=>{
 const result=await execute(false);
 assert.equal(result.calls.length,1);assert.equal(result.calls[0].dryRun,false);assert.equal(result.calls[0].background,true);
 assert.equal(result.logs.length,2);assert.match(result.logs[0],/Démarrage/);assert.match(result.logs[1],/SUCCÈS/);
 assert.equal(result.process.exitCode,undefined);
});
test("automatic sync logs failure without issuing a second email",async()=>{
 const result=await execute(true);
 assert.equal(result.calls.length,1);assert.equal(result.logs.length,2);assert.match(result.logs[1],/ERREUR.*Internet indisponible/);
 assert.equal(result.process.exitCode,1);
});
