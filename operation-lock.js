"use strict";
const fs=require("fs"),path=require("path");
function read(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){return e.code==="ENOENT"?null:null;}}
function alive(pid){try{process.kill(Number(pid),0);return true;}catch{return false;}}
function removeIfOrphaned(file){const meta=read(file);if(!meta)return false;if(!alive(meta.pid)){try{fs.unlinkSync(file);}catch{}return true;}return false;}
function create(file,type,options={}){fs.mkdirSync(path.dirname(file),{recursive:true});removeIfOrphaned(file);const fd=fs.openSync(file,"wx");const meta={pid:process.pid,date:new Date().toISOString(),type};fs.writeFileSync(fd,JSON.stringify(meta),"utf8");return {fd,meta};}
function ensureAvailable(file,type){if(!fs.existsSync(file))return true;if(removeIfOrphaned(file))return true;throw new Error(type==="update"?"Mise à jour déjà en cours.":"Une synchronisation est déjà en cours.");}
function release(file){try{fs.unlinkSync(file);return true;}catch(e){return e.code==="ENOENT";}}
module.exports={read,alive,removeIfOrphaned,create,ensureAvailable,release};
