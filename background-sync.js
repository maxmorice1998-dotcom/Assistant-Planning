"use strict";
const rt=require("./runtime-config");
const fs=require("fs");
function log(message){try{fs.mkdirSync(rt.dataDir,{recursive:true});fs.appendFileSync(rt.dataPath("assistant-planning.log"),`${new Date().toISOString()} [AUTO] ${message}\n`,"utf8");}catch{}}
async function main(){
 log("Démarrage de la synchronisation automatique.");
 try{
  const result=await require("./colleague-runner").run({dryRun:false,background:true});
  log(result.ok?"SUCCÈS : synchronisation terminée.":"ERREUR : synchronisation interrompue.");
  if(!result.ok)process.exitCode=1;
 }catch(error){
  log("ERREUR : "+require("./diagnostic-report").safeMessage(error));
  // Le moteur possède déjà la gestion des mails d'erreur : aucun second envoi ici.
  process.exitCode=1;
 }
}
main();
