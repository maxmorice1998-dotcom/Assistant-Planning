"use strict";
const fs = require('fs');
const runtime = require('./runtime-config');
const { writeExecutionSnapshot } = require('./sdis-utils');
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
    const item = {id,eventIds:[id],dates,text,indispo,botOwned:text.includes(MARKER),
      singleDay:first === dates[0] && nextDate(first) === last && !!exclusive,
      indispoId:/^100000000\d+$/.test(id) ? id.slice(9) : ''};
    if (found.has(id) && JSON.stringify(found.get(id)) !== JSON.stringify(item)) throw new Error(`Identifiant Dendreo ambigu : ${id}`);
    if (dates.length) found.set(id,item);
  }
  return [...found.values()];
}
async function readEvents(page, from, to) {
  normalizeDate(from); normalizeDate(to);
  await page.waitForFunction(()=>window.calendar && window.config_agenda?.events_url, {timeout:15000});
  // Lire la même source que FullCalendar, sans cache DOM, navigateur ou snapshot.
  const rows = await page.evaluate(async ({from,end})=>{
    const url = new URL(window.config_agenda.events_url, location.href);
    if (url.origin !== location.origin) throw new Error('Source Dendreo hors origine.');
    url.searchParams.set('start',from+'T00:00:00');
    url.searchParams.set('end',end+'T00:00:00');
    url.searchParams.set('_',String(Date.now()));
    const response = await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Lecture Dendreo HTTP ${response.status}`);
    return response.json();
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
  if (!item.botOwned || !item.indispo || !item.singleDay || !/^\d+$/.test(item.indispoId)) throw new Error('Suppression sans appartenance/date/identifiant certain interdite.');
  const date=item.dates[0];
  const before=await readEvents(page,date,date);
  if(preserveOne && dayState(before,date).bots.length<2)throw new Error('Doublon disparu : conserver la dernière indisponibilité.');
  if (!before.some(e=>e.id===item.id && e.botOwned && e.indispo)) throw new Error('Événement à supprimer modifié ou absent.');
  const verification=await page.evaluate(async ({id,date,marker})=>{
    const base=String(config_agenda.events_url).replace(/\/$/,'');
    const r=await fetch(`${base}/${id}/edit`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error(`GET edit HTTP ${r.status}`);
    const doc=new DOMParser().parseFromString(await r.text(),'text/html');
    const val=name=>doc.querySelector(`[name="${name}"]`)?.value;
    const fr=date.split('-').reverse().join('/');
    if(val('id_event')!==id || !String(val('titre')).includes(marker) || val('date_debut')!==fr || val('date_fin')!==fr || val('recurrent')!=='0')throw new Error('Suppression bloquée : formulaire id/marqueur/date/récurrence non confirmé.');
    const url=new URL(String(jQuery('#modal_indispo').data('url')).replace(/\/$/,'')+'/'+id,location.href);
    if(url.origin!==location.origin)throw new Error('Suppression hors origine interdite.');
    return url.href;
  },{id:item.indispoId,date,marker:MARKER});
  return {before, date, url:verification};
}
async function deleteBot(page,item,preserveOne=false) {
  const {before,date,url}=await verifyBotDeletion(page,item,preserveOne);
  writeExecutionSnapshot({dendreoWrites:true,dendreo:null});
  await page.evaluate(async url=>new Promise((resolve,reject)=>jQuery.ajax({url,type:'DELETE',timeout:20000,success:()=>resolve(true),error:x=>reject(new Error(`DELETE HTTP ${x.status}`))})),url);
  const after=await readEvents(page,date,date);
  if(after.some(e=>e.id===item.id))throw new Error(`DELETE non confirmé : ${item.id}`);
  for(const e of before.filter(e=>e.id!==item.id))if(!after.some(a=>a.id===e.id && a.text===e.text))throw new Error('État voisin modifié pendant suppression.');
  console.log(`VÉRIFIÉ DELETE date=${date} id=${item.id} absent du serveur`);
}
function acquireWriteLock() {
  const file=runtime.dataPath('.dendreo-write.lock');
  let fd;
  try {fd=fs.openSync(file,'wx');}catch{throw new Error('Écriture Dendreo déjà en cours ou verrou à vérifier.');}
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
  return ()=>{fs.closeSync(fd);fs.unlinkSync(file);};
}
module.exports={MARKER,normalizeDate,nextDate,normalizeGuards,normalizeEvents,readEvents,dayState,logDay,verifyBotDeletion,deleteBot,acquireWriteLock};
