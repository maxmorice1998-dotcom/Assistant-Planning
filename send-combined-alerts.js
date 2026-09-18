"use strict";
const fs=require("fs"),path=require("path"),runtime=require("./runtime-config"),{google}=require("googleapis"),oauth=require("./google-oauth-v2");
runtime.prepare();
const payloadPath=String(process.env.SDIS_RUN_MAIL||"").trim();
function writeStatus(status,message){try{runtime.writeJson("mail-status.json",{status,message,updatedAt:new Date().toISOString()});}catch{}}
function readPayload(){try{if(!payloadPath)return null;return runtime.parseJson(fs.readFileSync(payloadPath,"utf8"));}catch{return null;}}
function cleanup(){try{if(payloadPath)fs.unlinkSync(payloadPath);}catch{}try{fs.unlinkSync(path.join(runtime.dataDir,".combined-mail-queue.jsonl"));}catch{}}
function dateFr(value){const m=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:"";}
function label(operation){return operation==="added"?"ajoutée":operation==="removed"?"supprimée":operation==="updated"?"modifiée":operation==="conflict"?"en conflit":"";}
function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function calendarMail(calendar){
 const first=new Date(calendar.from+"T12:00:00Z"),days=[],text=[],details=[];
 const heading=`Dendreo — 28 prochains jours : du ${dateFr(calendar.from)} au ${dateFr(calendar.to)}`;
 for(let index=0;index<28;index++){
  const day=new Date(first);day.setUTCDate(first.getUTCDate()+index);
  const iso=day.toISOString().slice(0,10);
  const caption=new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit",timeZone:"UTC"}).format(day);
  const events=calendar.events.filter(e=>Array.isArray(e.dates)&&e.dates.includes(iso)).sort((a,b)=>String(a.startTime||"").localeCompare(String(b.startTime||"")));
  const conflict=events.some(e=>e.indispo)&&events.some(e=>!e.indispo);
  const descriptions=events.map(e=>{
   const hours=e.startTime==="00:00"&&e.endTime==="00:00"?"Toute la journée":`${e.startTime||""} – ${e.endTime||""}`;
   const span=e.dates.length>1?`\nSur plusieurs jours : du ${dateFr(e.dates[0])} au ${dateFr(e.dates[e.dates.length-1])}`:"";
   const title=String(e.text||"Événement sans intitulé").replace(/\[SDIS-BOT\]|📅|❌/g,"").trim();
   const short=e.indispo?"Indispo":title;
   return {unavailable:e.indispo,short,text:`${hours}\n${e.text||"Événement sans intitulé"}${span}`};
  });
  text.push(`${caption}${conflict?" — CONFLIT":""}\n${descriptions.length?descriptions.map(e=>e.text).join("\n\n"):"Libre"}`);
  if(descriptions.length)details.push(`<div style="margin-top:16px"><strong>${escapeHtml(caption)}${conflict?" — CONFLIT":""}</strong>${descriptions.map(e=>`<div style="margin-top:4px;padding:8px;background:${e.unavailable?"#fce8e6":"#d2e3fc"}">${escapeHtml(e.text).replace(/\n/g,"<br>")}</div>`).join("")}</div>`);
  const badges=descriptions.map(e=>{
   const color=e.unavailable?"#d93025":"#1a73e8";
   const short=escapeHtml(e.short);
   return `<div class="event" style="margin-top:6px;padding:6px;background:${e.unavailable?"#fce8e6":"#d2e3fc"};border-left:3px solid ${color}"><div class="event-full">${escapeHtml(e.text).replace(/\n/g,"<br>")}</div><div class="event-short" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${short}</div></div>`;
  }).join("");
  days.push(`<td width="14%" valign="top" class="day" style="padding:6px;border:1px solid ${conflict?"#ea8600":"#dadce0"}"><strong class="date" style="font-size:11px">${escapeHtml(caption)}</strong>${conflict?'<div class="conflict" style="color:#a44700;font-weight:bold">CONFLIT</div>':""}${badges||'<div class="free" style="margin-top:6px;color:#666">Libre</div>'}</td>`);
 }
 const rows=[];for(let index=0;index<28;index+=7)rows.push("<tr>"+days.slice(index,index+7).join("")+"</tr>");
 const css='@media only screen and (max-width:600px){.day{padding:3px!important}.date{font-size:9px!important}.event{padding:3px 1px!important;border-left-width:2px!important}.event-full{display:none!important}.event-short{display:block!important;max-height:none!important;font-size:9px!important;line-height:13px!important;overflow:hidden!important;text-overflow:ellipsis;white-space:nowrap}.conflict{font-size:8px!important;overflow:hidden}.free{font-size:9px!important}.heading{font-size:18px!important}}';
 return {subject:"Assistant Planning - calendrier Dendreo",body:`Synchronisation terminée.\n\n${heading}\nIndisponibilités en rouge, événements prévus en bleu.\n\n${text.join("\n\n")}`,html:`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0;padding:8px;font-family:Arial,sans-serif;color:#202124"><div style="max-width:980px;margin:auto"><p>Synchronisation terminée.</p><h2 class="heading">${escapeHtml(heading)}</h2><p>Indisponibilités en rouge, événements prévus en bleu. Les détails complets figurent sous la grille, y compris pour les indisponibilités sur plusieurs jours.</p><table cellpadding="0" cellspacing="0" width="100%" style="table-layout:fixed;font-size:12px;border-collapse:collapse;overflow-wrap:anywhere">${rows.join("")}</table><h3>Détails du calendrier</h3>${details.join("")||"Aucun événement prévu."}</div></body></html>`};
}
function compose(payload){
 const changes=Array.isArray(payload&&payload.changes)?payload.changes.filter(x=>x&&x.date&&label(x.operation)):[];
 if(!payload||payload.ok===false)return {subject:"Assistant Planning - synchronisation incomplète",body:"Synchronisation incomplète. Vérifiez l'application."};
 const guards=changes.filter(x=>x.service==="Google Agenda"&&["added","updated","removed"].includes(x.operation));
 const unavailable=changes.filter(x=>x.service==="Dendreo");
 const order=(a,b)=>a.date.localeCompare(b.date)||a.operation.localeCompare(b.operation);
 const guardLines=[...new Set(guards.sort(order).map(x=>`${dateFr(x.date)} : garde ${label(x.operation)}.`))];
 const sections=[];
 sections.push("GARDES AGATT\n"+(guardLines.join("\n")||"Aucune modification."));
 if(payload.calendar&&payload.calendar.ok===true&&/^\d{4}-\d{2}-\d{2}$/.test(payload.calendar.from)&&Array.isArray(payload.calendar.events)){
  const mail=calendarMail(payload.calendar);
  const events=payload.calendar.events;
  const conflictDates=[...new Set([...unavailable.filter(x=>x.operation==="conflict").map(x=>x.date),...events.filter(e=>e.indispo&&Array.isArray(e.dates)).flatMap(e=>e.dates.filter(date=>events.some(other=>!other.indispo&&Array.isArray(other.dates)&&other.dates.includes(date))))])].sort();
  const warning=conflictDates.length?`ATTENTION : CONFLIT\nDates concernées : ${conflictDates.map(dateFr).join(", ")}.\n\n`:"";
  const recap=warning+sections.join("\n\n");
  mail.body=recap+"\n\n"+mail.body.replace(/^Synchronisation terminée\.\n\n/,"");
  const recapHtml=sections.map(section=>{const [title,...lines]=section.split("\n");return `<h3>${escapeHtml(title)}</h3><p>${lines.map(escapeHtml).join("<br>")}</p>`;}).join("");
  const banner=warning?`<div role="alert" style="padding:18px;border:3px solid #b3261e;background:#fce8e6;color:#b3261e"><strong style="font-size:28px">ATTENTION : CONFLIT</strong><p style="font-size:18px;font-weight:bold">Dates concernées : ${conflictDates.map(dateFr).join(", ")}.</p></div>`:"";
  if(warning)mail.subject="Assistant Planning - ATTENTION : CONFLIT";
  mail.html=mail.html.replace("<p>Synchronisation terminée.</p>",banner+recapHtml);
  return mail;
 }
 if(!sections.length)return {subject:"Assistant Planning - planning à jour",body:"Synchronisation terminée. Aucune modification de garde ou d'indisponibilité."};
 return {subject:"Assistant Planning - changements de planning",body:"Synchronisation terminée.\n\n"+sections.join("\n\n")};
}
function rawMail(mail,email){
 const subject=Buffer.from(mail.subject,"utf8").toString("base64");
 if(mail.html){
  const boundary="AssistantPlanningCalendar";
  const headers=["From: "+email,"To: "+email,"Subject: =?UTF-8?B?"+subject+"?=","MIME-Version: 1.0",`Content-Type: multipart/alternative; boundary="${boundary}"`];
  const parts=[["text/plain",mail.body],["text/html",mail.html]].map(([type,body])=>`--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body,"utf8").toString("base64").match(/.{1,76}/g).join("\r\n")}`);
  return Buffer.from(headers.join("\r\n")+"\r\n\r\n"+parts.join("\r\n")+`\r\n--${boundary}--\r\n`,"utf8").toString("base64url");
 }
 const headers=["From: "+email,"To: "+email,"Subject: =?UTF-8?B?"+subject+"?=","MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8"];
 return Buffer.from(headers.join("\r\n")+"\r\n\r\n"+mail.body,"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function send(mail,beforeSend=()=>{}){
 const {auth}=await oauth.authorizedClient();
 const profile=await google.oauth2({version:"v2",auth}).userinfo.get();
 const email=String(profile.data&&profile.data.email||runtime.config().googleEmail||"").trim();
 if(!/^\S+@\S+\.\S+$/.test(email))return false;
 beforeSend();
 await google.gmail({version:"v1",auth}).users.messages.send({userId:"me",requestBody:{raw:rawMail(mail,email)}});
 return true;
}
async function main(){
 const payload=readPayload();
 if(!payload){writeStatus("skipped","Mail ignoré : aucun résultat.");cleanup();return;}
 if(process.argv.includes("--dry-run")){writeStatus("skipped","Mail ignoré en mode test.");cleanup();return;}
 try{
  const result=payload.ok===false?await require("./sync-error-mail").once(payload,beforeSend=>send(compose(payload),beforeSend)):{sent:await send(compose(payload))};
  writeStatus(result.sent?"sent":"skipped",result.sent?"Mail envoyé via Google.":result.duplicate?"Alerte identique déjà traitée : mail ignoré.":"Mail ignoré : autorisation Google absente.");
 }
 catch(error){writeStatus("error","Mail ignoré : "+String(error&&error.message||"erreur d'envoi").slice(0,300));}
 finally{cleanup();}
}
if(require.main===module)main().catch(()=>{writeStatus("error","Mail ignoré : erreur inattendue.");cleanup();});
else module.exports={compose,send,rawMail};
