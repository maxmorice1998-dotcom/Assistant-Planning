const runtime = require("./runtime-config");
runtime.prepare();
const { listAllEvents, readExecutionSnapshot, writeExecutionSnapshot } = require("./sdis-utils");
const fs = require("fs");
const puppeteer = require("./browser-client");
const { google } = require("googleapis");

const state = require('./dendreo-state');
const planningModel = require('./planning-model');
const CONFIG_PATH = "dendreo-config.json";

function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8").replace(/^\uFEFF/,''));
}

function addMonths(d, months) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + Number(months));
  return x;
}

async function getGoogleCalendar() {
  const credentials = runtime.credentials();
  const token = runtime.token();
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  auth.setCredentials(token);
 runtime.bindGoogleAuth(auth);

  return google.calendar({ version: "v3", auth });
}

// Une garde est rattachée à la journée AGATT de son début. Même si l'événement
// Google traverse minuit, sa fin ne crée jamais une seconde journée de garde.
function dutyDate(ev) {
  const id = String(ev.extendedProperties?.private?.agattId || "");
  const match = id.match(/_(\d{8})(?:_|$)/);
  if (match) return `${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}`;
  return ev.start?.date || (ev.start?.dateTime ? ev.start.dateTime.slice(0, 10) : null);
}

async function getGuardDates(config) {
  const shared = readExecutionSnapshot();
  if (shared && shared.planning && Array.isArray(shared.planning.dendreo)) {
    const repos = runtime.config().reposCompensatoire === true;
    const sourceGuards = Array.isArray(shared.planning.guards) ? shared.planning.guards : shared.planning.dendreo;
    const expected = planningModel.expectedDendreoSlots(sourceGuards, repos);
    const guards = expected.map(({guard}) => ({
      googleId: null,
      agattId: guard.id || null,
      date: guard.date,
      shift: guard.shift?.kind || guard.shift || "24h",
      startTime: guard.shift?.start || guard.startTime || "",
      endTime: guard.shift?.end || guard.endTime || "",
      summary: "Garde SDIS",
    }));
    console.log(`Source planning AGATT unique : ${guards.length} garde(s), repos compensatoire=${repos ? "oui" : "non"}`);
    return state.normalizeGuards(guards);
  }
  if (shared && Array.isArray(shared.guards)) {
    const guards = shared.guards
      .map(x => ({
        googleId: null,
        agattId: x.id || null,
        date: x.date,
        shift: x.shift || "24h",
        startTime: x.startTime || "",
        endTime: x.endTime || "",
        summary: "Garde SDIS",
      }));
    console.log('Source gardes : snapshot AGATT de cette execution');
    return state.normalizeGuards(guards);
  }
  const calendar = await getGoogleCalendar();
  console.log('Source gardes : Google Calendar (lecture)');
  const calendarId = await runtime.resolveCalendarId(calendar);

  const now = new Date();
  const max = addMonths(now, config.monthsAhead || 6);

  const res = await listAllEvents(calendar, {
    calendarId,
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    singleEvents: true,
    maxResults: 2500,
    orderBy: "startTime",
    privateExtendedProperty: "source=AGATT-SDIS",
  });

  const events = res.data.items || [];

  const allGuards = events
    .filter(ev => ev.extendedProperties?.private?.agattCode === "G")
    .map(ev => ({
      googleId: ev.id,
      agattId: ev.extendedProperties?.private?.agattId || null,
      date: dutyDate(ev),
      shift: ev.extendedProperties?.private?.agattShift || "24h",
      startTime: ev.extendedProperties?.private?.agattStart || (ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) : ""),
      endTime: ev.extendedProperties?.private?.agattEnd || (ev.end?.dateTime ? ev.end.dateTime.slice(11, 16) : ""),
      summary: ev.summary || "Garde SDIS",
    }));

  return state.normalizeGuards(allGuards);
}

async function findDendreoPage(browser) {
  const pages = await browser.pages();

  let page = pages.find(p => {
    const url = p.url();
    return url.includes("formation.pompiers-14.org") && url.includes("/agenda");
  });

  if (page) return page;

  page = pages.find(p => p.url().includes("formation.pompiers-14.org"));
  if (!page) return null;

  const agendaUrl = await page.evaluate(()=>[...document.querySelectorAll('a[href]')].find(a=>/\/agenda(?:[?#]|$)/i.test(a.href))?.href);
  if(!agendaUrl) throw new Error('Lien agenda Dendreo absent.');

  await page.goto(agendaUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  return page;
}

async function cellContainsMarker(page, date) {
  return state.dayState(await state.readEvents(page,date,date),date).bots.length > 0;
}
async function cellHasAnyEvent(page, date) {
  return state.dayState(await state.readEvents(page,date,date),date).all.length > 0;
}

// Couverture attendue sur l'agenda Dendreo par garde AGATT.
// repos ON : 24h = J et J+1 ; 12h_jour = J ; 12h_nuit = J+1.
// repos OFF : 24h = J ; 12h_jour = J ; 12h_nuit = aucun événement.
function expectedCoverage(guard, repos) {
  return planningModel.dendreoSlot(guard, repos)?.dates || [];
}
function expectedSlot(guard, repos) {
  const slot=planningModel.dendreoSlot(guard,repos);
  return slot ? {...slot,startDate:slot.dates[0],endDate:slot.dates.length>1?slot.dates[slot.dates.length-1]:state.nextDate(slot.dates[0])} : null;
}
// Le nouveau serveur Vue de Dendreo refuse une indisponibilité posée sur un
// créneau déjà existant (HTTP 403 « … ne peut être saisie sur un créneau
// existant »). Ce n'est pas une erreur bloquante : la garde est déjà couverte
// par un événement réel, on signale le conflit et on continue le lot.
function isCreneauConflictError(err) {
  const text = String((err && err.stack) || (err && err.message) || err || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /HTTP 403/.test(text) && /cr[e]neau\s+existant/i.test(text);
}

async function createUnavailability(page, slot, config) {
  const startDate=slot.startDate;
  const span=slot.dates;
  const last=span[span.length-1];
  const before=await state.readEvents(page,startDate,last);
  if (before.some(e=>e.botOwned&&e.indispo)) throw new Error('CREATE annule : indisponibilite deja presente.');
  // Même payload que la modale Vue de Dendreo (transformFormDataToApi), via POST /events.
  const reason=state.MARKER+' '+config.label;
  const end=slot.endDate;
  // Invalider avant l'envoi, y compris si la réponse ou la vérification échoue.
  writeExecutionSnapshot({dendreoWrites:true,dendreo:null});
  const description=`Garde ${startDate}${span.length>1?' - '+last:''} ${config.label}`;
  try {
    await page.evaluate(async ({start,end,reason,description,startTime,endTime})=>{
      const base=location.origin+location.pathname.replace(/\/agenda\/?$/,'')+'/events';
      const fr=date=>date.split('-').reverse().join('/');
      const body=new URLSearchParams();
      body.set('id_event','');
      body.set('type','conge_paye');
      body.set('titre',reason);
      body.set('description',description);
      body.set('date_debut',fr(start));
      body.set('date_fin',fr(end));
      body.set('heure_debut',startTime);
      body.set('heure_fin',endTime);
      body.set('recurrent','0');
      const r=await fetch(base,{method:'POST',credentials:'same-origin',body,signal:AbortSignal.timeout(25000),headers:{'X-Requested-With':'XMLHttpRequest'}});
      if(!r.ok){let msg='';try{msg=JSON.stringify(await r.json());}catch(e){}throw new Error(`POST events HTTP ${r.status} ${String(msg).slice(0,300)}`);}
    },{start:startDate,end,reason,description,startTime:slot.startTime,endTime:slot.endTime});
  } catch (err) {
    if (!isCreneauConflictError(err)) throw err;
    console.log('CONFLIT DENDREO DATE='+startDate+' creneau existant (indisponibilite non creee)');
    return {conflict:true,date:startDate};
  }
  const after=await state.readEvents(page,startDate,last);
  const bots=after.filter(e=>e.botOwned&&e.indispo&&state.coverageStart(e)===startDate);
  if(bots.length!==1 || !state.sameCoverage(bots[0],span) || !bots[0].text.includes(reason) || before.some(e=>e.id===bots[0]?.id))throw new Error('CREATE non confirme par relecture serveur : aucune nouvelle indisponibilite unique. Aucun retry automatique.');
  for(const e of before)if(!after.some(a=>a.id===e.id && a.text===e.text))throw new Error('evenement preexistant modifie pendant creation.');
  console.log('VERIFIE CREATE DATE='+startDate+' couverture='+JSON.stringify(span)+' id='+bots[0].id+' bot=1 (serveur)');
}
async function syncBlock(page, guard, config, repos, conflits) {
  const slot=expectedSlot(guard,repos);
  if(!slot){const day=state.dayState(await state.readEvents(page,guard.date,guard.date),guard.date);state.logDay(guard.date,day,'NOTHING');return;}
  const span=slot.dates;
  const root=span[0],last=span[span.length-1];
  console.log('BOUCLE DENDREO date AGATT='+guard.date+' couverture='+JSON.stringify(span));
  const events=await state.readEvents(page,root,last);
  const bots=events.filter(e=>e.botOwned&&e.indispo);
  const rooted=bots.filter(e=>state.coverageStart(e)===root);
  const hasOtherRoot=bots.some(e=>state.coverageStart(e)!==root);
  let decision;
  if(!bots.length) decision='CREATE';
  else if(!rooted.length && hasOtherRoot) decision='CREATE bloque (chevauchement autre garde)';
  else if(rooted.length>1) decision='DELETE DUPLICATE';
  else if(state.sameSlot(rooted[0],slot)) decision='NOTHING';
  else decision='REPLACE (plage horaire incorrecte)';
  state.logDay(root,state.dayState(events,root),decision);
  if(config.dryRun)return;
  if(decision==='REPLACE'){
    for(const item of rooted)await state.deleteBot(page,item,false);
  }
  if(decision==='CREATE'||decision==='REPLACE'){
    const created=await createUnavailability(page,slot,config);
    if(created&&created.conflict){
      console.log('CONFLIT DENDREO couverture='+JSON.stringify(span)+' DATE='+root+' creneau-existant compte rendu');
      conflits.push(root);
      return;
    }
  }
  else if(decision==='DELETE DUPLICATE'){
    const ordered=rooted.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    for(const item of ordered.slice(1))await state.deleteBot(page,item,true);
  }
  if(decision==='CREATE'||decision==='DELETE DUPLICATE'){
    const finalEvents=await state.readEvents(page,root,last);
    const final=finalEvents.filter(e=>e.botOwned&&e.indispo&&state.coverageStart(e)===root);
    if(final.length!==1||!state.sameSlot(final[0],slot))throw new Error('Etat final non valide : '+root);
    console.log('VERIFIE FINAL racine='+root+' bot=1 couverture='+JSON.stringify(span));
  }
}
async function main() {
  const config=loadJson(CONFIG_PATH);
  config.dryRun=!process.argv.includes('--real') || process.argv.includes('--dry-run');
  if(config.marker!==state.MARKER || !config.label?.trim())throw new Error('Marqueur requis : [SDIS-BOT].');
  const repos=runtime.config().reposCompensatoire===true;
  const conflits=[];
  console.log('=== Dendreo '+(config.dryRun?'LECTURE SEULE / DRY RUN':'APPLICATION')+' ===');
  console.log('Repos compensatoire : '+(repos?'ACTIVE (24h=J et J+1 ; nuit=J+1)':'desactive (jour de garde uniquement)'));
  const data=await getGuardDates(config);
  console.log('Gardes de jour/24h='+data.guards.length+' ; nuits seules='+data.nights.length);
  const release=config.dryRun?()=>{}:state.acquireWriteLock();
  let browser;
  try {
    browser=await puppeteer.connect({browserURL:'http://127.0.0.1:19223'});
    const page=await findDendreoPage(browser);
    if(!page)throw new Error('Agenda Dendreo absent.');
    for(const night of data.nights) {
      if(!repos){const day=state.dayState(await state.readEvents(page,night.date,night.date),night.date);state.logDay(night.date,day,'NOTHING (nuit seule, aucune creation)');continue;}
      await syncBlock(page,night,config,repos,conflits);
    }
    for(const guard of data.guards) {
      await syncBlock(page,guard,config,repos,conflits);
    }
    if(config.dryRun)console.log('Aucune ecriture Dendreo. Etat lu directement sur le serveur, sans snapshot.');
  } finally {
    if(browser)await browser.disconnect();
    release();
  }
  if(conflits.length){
    writeExecutionSnapshot({dendreoConflicts:conflits});
    console.log('CONFLITS DENDREO ('+conflits.length+'): '+conflits.join(', '));
  }
}
module.exports={getGuardDates,cellContainsMarker,cellHasAnyEvent,expectedCoverage,expectedSlot,createUnavailability,findDendreoPage,main};
if(require.main===module)main().catch(err=>{console.error('Erreur Dendreo :',err.message);process.exitCode=1;});
