"use strict";
const updater=require("./update-client");
function emit(value){try{process.stdout.write(JSON.stringify(value)+"\n");}catch{}}
(async()=>{
 try{
  emit({type:"stage",stage:"Recherche de mise a jour"});
  const info=await updater.check();
  if(!info.available){emit({type:"result",ok:true,available:false,temporary:!!info.temporary,currentVersion:info.currentVersion||updater.version()});return;}
  emit({type:"stage",stage:"Nouvelle version detectee",version:info.version,currentVersion:info.currentVersion});
  const parentArg=process.argv.indexOf("--parent-pid");
  const parentPid=Number(parentArg>=0?process.argv[parentArg+1]:0)||process.pid;
  const result=await updater.install(info,{parentPid,progress:event=>emit({type:"progress",...event})});
  emit({type:"result",ok:true,available:true,started:!!result.started,version:info.version});
 }catch(error){emit({type:"result",ok:false,error:String(error&&error.message||error)});process.exitCode=1;}
})();
