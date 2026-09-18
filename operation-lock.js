"use strict";
const fs=require("fs"),path=require("path");
function read(file){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){return e.code==="ENOENT"?null:null;}}
function alive(pid){const n=Number(pid);if(!Number.isInteger(n)||n<=0)return false;try{process.kill(n,0);return true;}catch(error){return error.code==="EPERM";}}
function removeIfOrphaned(file){const meta=read(file);if(!meta)return false;if(!alive(meta.pid)){try{fs.unlinkSync(file);}catch{}return true;}return false;}
function create(file,type,options={}){fs.mkdirSync(path.dirname(file),{recursive:true});removeIfOrphaned(file);let fd;try{fd=fs.openSync(file,"wx");}catch(error){if(error.code==="EEXIST")error.code="LOCK_ACTIVE";throw error;}const meta={pid:process.pid,date:new Date().toISOString(),type};fs.writeFileSync(fd,JSON.stringify(meta),"utf8");return {fd,meta};}
function ensureAvailable(file,type){if(!fs.existsSync(file))return true;if(removeIfOrphaned(file))return true;throw new Error(type==="update"?"Mise à jour déjà en cours.":"Une synchronisation est déjà en cours.");}
function release(file){try{fs.unlinkSync(file);return true;}catch(e){return e.code==="ENOENT";}}
module.exports={read,alive,removeIfOrphaned,create,ensureAvailable,release};
