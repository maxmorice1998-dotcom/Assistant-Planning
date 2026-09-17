"use strict";
const fs=require("fs"),path=require("path"),runtime=require("./runtime-config"),{google}=require("googleapis"),oauth=require("./google-oauth-v2");
runtime.prepare();
const payloadPath=String(process.env.SDIS_RUN_MAIL||"").trim();
function writeStatus(status,message){try{runtime.writeJson("mail-status.json",{status,message,updatedAt:new Date().toISOString()});}catch{}}
function readPayload(){try{if(!payloadPath)return null;return runtime.parseJson(fs.readFileSync(payloadPath,"utf8"));}catch{return null;}}
function cleanup(){try{if(payloadPath)fs.unlinkSync(payloadPath);}catch{}try{fs.unlinkSync(path.join(runtime.dataDir,".combined-mail-queue.jsonl"));}catch{}}
function dateFr(value){const m=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:"";}
function label(operation){return operation==="added"?"ajoutée":operation==="removed"?"supprimée":operation==="updated"?"modifiée":operation==="conflict"?"en conflit":"";}
function compose(payload){
 const changes=Array.isArray(payload&&payload.changes)?payload.changes.filter(x=>x&&x.date&&label(x.operation)):[];
 if(!payload||payload.ok===false)return {subject:"Assistant Planning - synchronisation incomplète",body:"Synchronisation incomplète. Vérifiez l'application."};
 const guards=changes.filter(x=>x.service==="Google Agenda"&&["added","updated"].includes(x.operation));
 const unavailable=changes.filter(x=>x.service==="Dendreo");
 const guardLines=[...new Set(guards.map(x=>`${dateFr(x.date)} : garde ${x.operation==="updated"?"modifiée":"ajoutée"}.`))];
 const unavailableLines=[...new Set(unavailable.map(x=>`${dateFr(x.date)} : indisponibilité ${x.operation==="removed"?"supprimée":x.operation==="conflict"?"en conflit":"créée"}.`))];
 const sections=[];
 if(guardLines.length)sections.push("GARDES AGATT\n"+guardLines.join("\n"));
 if(unavailableLines.length)sections.push("INDISPONIBILITÉS DENDREO\n"+unavailableLines.join("\n"));
 if(!sections.length)return {subject:"Assistant Planning - planning à jour",body:"Synchronisation terminée. Aucune modification de garde ou d'indisponibilité."};
 return {subject:"Assistant Planning - changements de planning",body:"Synchronisation terminée.\n\n"+sections.join("\n\n")};
}
function rawMail(mail,email){
 const subject=Buffer.from(mail.subject,"utf8").toString("base64");
 const headers=["From: "+email,"To: "+email,"Subject: =?UTF-8?B?"+subject+"?=","MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8"];
 return Buffer.from(headers.join("\r\n")+"\r\n\r\n"+mail.body,"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function send(mail){
 const {auth}=await oauth.authorizedClient();
 const profile=await google.oauth2({version:"v2",auth}).userinfo.get();
 const email=String(profile.data&&profile.data.email||runtime.config().googleEmail||"").trim();
 if(!/^\S+@\S+\.\S+$/.test(email))return false;
 await google.gmail({version:"v1",auth}).users.messages.send({userId:"me",requestBody:{raw:rawMail(mail,email)}});
 return true;
}
async function main(){
 const payload=readPayload();
 if(!payload){writeStatus("skipped","Mail ignoré : aucun résultat.");cleanup();return;}
 if(process.argv.includes("--dry-run")){writeStatus("skipped","Mail ignoré en mode test.");cleanup();return;}
 try{const sent=await send(compose(payload));writeStatus(sent?"sent":"skipped",sent?"Mail envoyé via Google.":"Mail ignoré : autorisation Google absente.");}
 catch(error){writeStatus("error","Mail ignoré : "+String(error&&error.message||"erreur d'envoi").slice(0,300));}
 finally{cleanup();}
}
if(require.main===module)main().catch(()=>{writeStatus("error","Mail ignoré : erreur inattendue.");cleanup();});
else module.exports={compose,send};
