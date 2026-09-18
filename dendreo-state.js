"use strict";
const fs = require('fs');
const runtime = require('./runtime-config');
const { writeExecutionSnapshot } = require('./sdis-utils');
const operationLock = require('./operation-lock');
const MARKER = '[SDIS-BOT]';

function normalizeDate(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) throw new Error(`Date AGATT invalide : ${s}`);
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) !== iso) throw new Error(`Date invalide : ${s}`);
  return iso;
}
function nextDate(date) {
  const d = new Date(normalizeDate(date) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function addDaysDate(date, days) {
  const d = new Date(normalizeDate(date) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
function dateRange(date, days) {
  const out = [];
  let x = date;
  for (let i = 0; i < Number(days || 1); i++) { out.push(x); x = nextDate(x); }
  return out;
}
function coverageStart(item) {
  const d = Array.isArray(item && item.dates) ? item.dates : [];
  return d.length ? d[0] : null;
}
function sameCoverage(item, expected) {
  const d = Array.isArray(item && item.dates) ? item.dates : null;
  return Boolean(d && Array.isArray(expected) && d.length === expected.length && d.every((v, i) => v === expected[i]));
}
function sameSlot(item, expected) {
  return Boolean(sameCoverage(item, expected.dates) && item.startTime === expected.startTime && item.endTime === expected.endTime);
}
function normalizeGuards(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = normalizeDate(row.date);
    const shift = row.shift || '24h';
    if (!['24h', '12h_jour', '12h_nuit'].includes(shift)) throw new Error(`Garde ambiguë : ${date} ${shift}`);
    console.log(`AGATT reçue=${row.date} date=${date} shift=${shift}`);
    // Une nuit ne doit jamais écraser une garde de jour de la même date.
    if (!map.has(date) || map.get(date).shift === '12h_nuit') map.set(date, {...row, date, shift});
  }
  const all = [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
  return {guards:all.filter(g=>g.shift !== '12h_nuit'), nights:all.filter(g=>g.shift === '12h_nuit')};
}
function normalizeEvents(rows, from, to) {
  if (!Array.isArray(rows)) throw new Error('Réponse Dendreo invalide : liste attendue.');
  const found = new Map();
  for (const ev of rows) {
    const id = String(ev.id || '');
    const start = String(ev.start || '');
    if (!id || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(start)) throw new Error('Événement Dendreo sans identifiant/date fiable.');
    const first = normalizeDate(start.slice(0,10));
    const end = String(ev.end || '');
    const last = end ? normalizeDate(end.slice(0,10)) : first;
    const exclusive = end && (end.length === 10 || /T00:00(?::00(?:\.000)?)?(?:Z|[+-]\d\d:\d\d)?$/.test(end));
    const dates = [];
    for (let d = first, n=0; d <= last; d=nextDate(d)) {
      if (++n > 3700) throw new Error('Durée Dendreo incohérente.');
      if (exclusive && d === last) break;
      if (d >= from && d <= to) dates.push(d);
    }
    const text = String(ev.title || '');
    const indispo = (ev.extendedProps?.isIndispo ?? ev.isIndispo) === true;
    const startTime = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.test(start) ? start.match(/T(\d{2}:\d{2})/)[1] : '00:00';
    const endTime = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.test(end) ? end.match(/T(\d{2}:\d{2})/)[1] : '00:00';
    const item = {id,eventIds:[id],dates,startTime,endTime,text,indispo,botOwned:text.includes(MARKER),
      singleDay:first === dates[0] && nextDate(first) === last && !!exclusive,
      indispoId:/^100000000\d+$/.test(id) ? id.slice(9) : ''};
    if (found.has(id) && JSON.stringify(found.get(id)) !== JSON.stringify(item)) throw new Error(`Identifiant Dendreo ambigu : ${id}`);
    if (dates.length) found.set(id,item);
  }
  return [...found.values()];
}
async function readEvents(page, from, to) {
  normalizeDate(from); normalizeDate(to);
  await page.waitForFunction(()=>window.calendar&&window.config_agenda?.events_url || document.querySelector('.fc'), {timeout:20000});
  // Lire la même source que FullCalendar, sans cache DOM, navigateur ou snapshot.
  // Ancien extranet : window.config_agenda.events_url. Nouvel extranet : endpoint /events dérivé de l'URL de la page.
  const rows = await page.evaluate(async ({from,end})=>{
    let url;
    if (window.config_agenda && window.config_agenda.events_url) {
      url = new URL(window.config_agenda.events_url, location.href);
    } else {
      const base=location.origin+location.pathname.replace(/\/agenda\/?$/,'')+'/events';
      url=new URL(base);
      url.search=new URLSearchParams({mode:'filter_agenda',agendaType:'agenda_principal',agendaMode:'principal',showAgendaAdfs:'true',hideAgendaElearning:'false',showEntrepriseEvents:'false',showParticipantEvents:'false',showContactEvents:'false',typeAgendaEvents:'me_or_groups'});
    }
    if (url.origin !== location.origin) throw new Error('Source Dendreo hors origine.');
    url.searchParams.set('start',from+'T00:00:00');
    url.searchParams.set('end',end+'T00:00:00');
    const response = await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(25000)});
    const text=await response.text();
    if (!response.ok) throw new Error(`Lecture Dendreo HTTP ${response.status}`);
    if (!/json/i.test(String(response.headers.get('content-type')||'')) || /^\s*</.test(text)) throw new Error('DENDREO_LOGIN_REQUIRED');
    try{return JSON.parse(text);}catch{throw new Error('DENDREO_LOGIN_REQUIRED');}
  },{from,end:nextDate(to)});
  return normalizeEvents(rows,from,to);
}
function dayState(events,date) {
  const all=events.filter(e=>e.dates.includes(date));
  return {all,bots:all.filter(e=>e.botOwned && e.indispo),manual:all.filter(e=>!e.botOwned)};
}
function logDay(date,state,decision) {
  console.log(`DENDREO date=${date} événements=${JSON.stringify(state.all.map(e=>({id:e.id,titre:e.text})))} bot=${state.bots.length} manuel=${state.manual.length} décision=${decision}`);
}
async function verifyBotDeletion(page,item,preserveOne=false) {
  if (!item.botOwned || !item.indispo || !/^\d+$/.test(item.indispoId)) throw new Error('Suppression sans appartenance/identifiant certain interdite.');
  const dates=Array.isArray(item.dates)&&item.dates.length?item.dates:[];
  if(!dates.length||dates.length>7)throw new Error('Suppression : plage Dendreo invalide.');
  const date=dates[0], endDate=dates[dates.length-1];
  const before=await readEvents(page,date,endDate);
  if(preserveOne && dayState(before,date).bots.length<2)throw new Error('Doublon disparu : conserver la dernière indisponibilité.');
  if (!before.some(e=>e.id===item.id && e.botOwned && e.indispo)) throw new Error('Événement à supprimer modifié ou absent.');
  const verification=await page.evaluate(async ({item,marker})=>{
    const start=item.dates[0], end=item.dates[item.dates.length-1];
    const eventsBase=String(window.config_agenda?.events_url || location.origin+location.pathname.replace(/\/agenda\/?$/,'')+'/events').replace(/\/$/,'');
    const r=await fetch(`${eventsBase}/${item.indispoId}/edit`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error(`GET edit HTTP ${r.status}`);
    const doc=new DOMParser().parseFromString(await r.text(),'text/html');
    const val=name=>doc.querySelector(`[name="${name}"]`)?.value;
    const fr=date=>date.split('-').reverse().join('/');
    const rec=String(val('recurrent')??'').trim();
    const formStart=val('date_debut')||val('date');
    const formEnd=val('date_fin');
    const dateOk=formStart===fr(start) && (!formEnd || formEnd===fr(end));
    const mismatch=val('id_event')!==item.indispoId || !String(val('titre')).includes(marker) || !dateOk || (rec!=='' && rec!=='0' && rec.toLowerCase()!=='false');
    if(mismatch)throw new Error(`Suppression bloquée : formulaire id/marqueur/date/récurrence non confirmé (id=${val('id_event')} attendu=${item.indispoId} | titre="${String(val('titre')).slice(0,60)}" marker=${marker} | debut=${formStart}=${fr(start)} | fin=${formEnd||'(non fourni)'}=${fr(end)} | recurrent=${rec}).`);
    const url=new URL(`${eventsBase}/${item.indispoId}`,location.href);
    if(url.origin!==location.origin)throw new Error('Suppression hors origine interdite.');
    return url.href;
  },{item,marker:MARKER});
  return {before, dates, url:verification};
}
async function deleteBot(page,item,preserveOne=false) {
  const {before,dates,url}=await verifyBotDeletion(page,item,preserveOne);
  writeExecutionSnapshot({dendreoWrites:true,dendreo:null});
  await page.evaluate(async url=>new Promise((resolve,reject)=>jQuery.ajax({url,type:'DELETE',timeout:20000,success:()=>resolve(true),error:x=>reject(new Error(`DELETE HTTP ${x.status}`))})),url);
  const after=await readEvents(page,dates[0],dates[dates.length-1]);
  if(after.some(e=>e.id===item.id))throw new Error(`DELETE non confirmé : ${item.id}`);
  for(const e of before.filter(e=>e.id!==item.id))if(!after.some(a=>a.id===e.id && a.text===e.text))throw new Error('État voisin modifié pendant suppression.');
  console.log(`VÉRIFIÉ DELETE date=${item.dates[0]} id=${item.id} absent du serveur`);
}
function acquireWriteLock() {
  const file=runtime.dataPath('.dendreo-write.lock');
  const created=operationLock.create(file,'dendreo-write',{ownerNames:['node.exe'],phase:'dendreo'},{logFile:runtime.dataPath('assistant-planning.log')});
  return ()=>{try{fs.closeSync(created.fd);}catch{}operationLock.release(file);};
}
module.exports={MARKER,normalizeDate,nextDate,addDaysDate,dateRange,coverageStart,sameCoverage,sameSlot,normalizeGuards,normalizeEvents,readEvents,dayState,logDay,verifyBotDeletion,deleteBot,acquireWriteLock};
