"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
test("connection confirmation waits for the old browser to finish closing",async()=>{
 let finishClose,completed=false,inspected=false;
 const closing=new Promise(resolve=>{finishClose=resolve;});
 const manager={open:async()=>{},status:async()=>({connected:true,temporary:false}),inspect:async()=>{inspected=true;},closeDedicated:async()=>closing};
 const modules={"./runtime-config":{initialize(){}},"./diagnostic-report":{},"./browser-manager":manager};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","ui-backend.js"),"utf8"),{module,require:n=>modules[n],process:{on(){}} ,setTimeout});
 const response=module.exports.handle({action:"open-dendreo"}).then(result=>{completed=true;return result;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(inspected,true);assert.equal(completed,false);
 finishClose();assert.equal((await response).ok,true);
});
