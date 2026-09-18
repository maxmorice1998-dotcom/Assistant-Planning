"use strict";
// Gate around the existing sender; this module never sends mail itself.
const crypto=require("crypto"),fs=require("fs"),rt=require("./runtime-config"),locks=require("./operation-lock");
const WINDOW_MS=30*60*1000;
const stateName="sync-error-mail.json";
function signature(payload){
 const message=String(payload.errorMessage||"").split(/\r?\n|\s+\|\s+at\s/)[0].replace(/^Error:\s*/i,"").normalize("NFC").replace(/\s+/g," ").trim();
 return crypto.createHash("sha256").update(JSON.stringify([String(payload.errorStage||""),message])).digest("hex");
}
async function once(payload,send){
 const file=rt.dataPath("sync-error-mail.lock");let guard;
 try{guard=locks.create(file,"error-mail");}catch(error){if(error.code==="LOCK_ACTIVE")return {sent:false,duplicate:true};throw error;}
 try{
  const hash=signature(payload),now=Date.now(),previous=rt.readJson(stateName,{});
  const at=Date.parse(previous.sentAt||"");
  if(previous.signature===hash&&Number.isFinite(at)&&now-at<WINDOW_MS)return {sent:false,duplicate:true};
  // Reserve before the network call: a timeout may occur after Gmail accepted the mail.
  const record={signature:hash,sentAt:new Date(now).toISOString(),status:"sending"};
  let reserved=false;
  const sent=await send(()=>{rt.writeJson(stateName,record);reserved=true;});
  if(sent&&reserved)rt.writeJson(stateName,{...record,status:"sent"});
  return {sent:Boolean(sent),duplicate:false};
 }finally{fs.closeSync(guard.fd);locks.release(file);}
}
function reset(){rt.writeJson(stateName,{});}
module.exports={once,reset,signature,WINDOW_MS};
