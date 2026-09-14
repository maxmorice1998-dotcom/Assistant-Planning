const runtime = require("./runtime-config");
runtime.prepare();
const { listAllEvents, readExecutionSnapshot, writeExecutionSnapshot } = require("./sdis-utils");
const fs = require("fs");
const puppeteer = require("./browser-client");
const { google } = require("googleapis");

const state = require('./dendreo-state');
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
async function createUnavailability(page, date, config) {
  const before = await state.readEvents(page,date,date);
  if (state.dayState(before,date).bots.length) throw new Error('CREATE annule : indisponibilite deja presente.');
  // Appeler le mecanisme de selection FullCalendar reellement utilise par Dendreo.
  await page.evaluate(({date,end})=>{
    calendar.changeView('dayGridMonth');calendar.gotoDate(date);
    calendar.select({start:date,end,allDay:true});
  },{date,end:state.nextDate(date)});
  await page.waitForFunction(()=>{
    const form=document.querySelector('#modal_indispo #form_indispo');
    return form && form.getBoundingClientRect().height>0;
  },{timeout:10000});
  const reason = state.MARKER+' '+config.label;
  await page.evaluate(({date,reason})=>{
    const form=document.querySelector('#modal_indispo #form_indispo');
    const val=name=>form.querySelector('[name="'+name+'"]')?.value;
    const fr=date.split('-').reverse().join('/');
    if(val('id_event') || val('date_debut')!==fr || val('date_fin')!==fr || val('recurrent')!=='0')throw new Error('Formulaire de creation id/date/recurrence invalide.');
    const title=form.querySelector('[name="titre"]');
    if(!title)throw new Error('Titre absent.');
    title.value=reason;title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new Event('change',{bubbles:true}));
  },{date,reason});
  // Invalider avant l'envoi, y compris si la reponse ou la verification echoue.
  writeExecutionSnapshot({dendreoWrites:true,dendreo:null});
  const url=await page.evaluate(()=>{
    const url=new URL(jQuery('#modal_indispo').data('url'),location.href);
    if(url.origin!==location.origin)throw new Error('Creation hors origine interdite.');
    return url.href;
  });
  const responsePromise=page.waitForResponse(r=>r.request().method()==='POST' && r.url()===url,{timeout:20000}).catch(e=>({error:e}));
  await page.click('#modal_indispo #submit_indispo');
  const response=await responsePromise;
  const after=await state.readEvents(page,date,date);
  const bots=state.dayState(after,date).bots;
  if(bots.length!==1 || !bots[0].singleDay || !bots[0].text.includes(reason) || before.some(e=>e.id===bots[0]?.id))throw new Error('CREATE non confirme par relecture serveur : aucune nouvelle indisponibilite unique. Aucun retry automatique.');
  for(const e of before)if(!after.some(a=>a.id===e.id && a.text===e.text))throw new Error('evenement preexistant modifie pendant creation.');
  if(response.error || !response.ok())console.log('Reponse POST incertaine ; creation confirmee par lecture serveur.');
  console.log('VERIFIE CREATE date='+date+' id='+bots[0].id+' bot=1 (serveur)');
}

async function main() {
  const config=loadJson(CONFIG_PATH);
  config.dryRun=!process.argv.includes('--real') || process.argv.includes('--dry-run');
  if(config.marker!==state.MARKER || !config.label?.trim())throw new Error('Marqueur requis : [SDIS-BOT].');
  console.log('=== Dendreo '+(config.dryRun?'LECTURE SEULE / DRY RUN':'APPLICATION')+' ===');
  const data=await getGuardDates(config);
  console.log('Gardes de jour/24h='+data.guards.length+' ; nuits seules='+data.nights.length);
  const release=config.dryRun?()=>{}:state.acquireWriteLock();
  let browser;
  try {
    browser=await puppeteer.connect({browserURL:'http://127.0.0.1:19223'});
    const page=await findDendreoPage(browser);
    if(!page)throw new Error('Agenda Dendreo absent.');
    for(const night of data.nights) {
      const day=state.dayState(await state.readEvents(page,night.date,night.date),night.date);
      state.logDay(night.date,day,'NOTHING (nuit seule, aucune creation)');
    }
    for(const guard of data.guards) {
      console.log('BOUCLE DENDREO date AGATT='+guard.date);
      const day=state.dayState(await state.readEvents(page,guard.date,guard.date),guard.date);
      const decision=day.bots.length>1?'DELETE DUPLICATE':day.bots.length?'NOTHING':'CREATE';
      state.logDay(guard.date,day,decision);
      if(config.dryRun)continue;
      if(day.bots.length>1) {
        const bots=day.bots.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
        for(const item of bots.slice(1))await state.deleteBot(page,item,true);
      } else if(!day.bots.length) await createUnavailability(page,guard.date,config);
      const final=state.dayState(await state.readEvents(page,guard.date,guard.date),guard.date);
      if(final.bots.length!==1)throw new Error('Etat final non unique : '+guard.date);
      console.log('VERIFIE FINAL date='+guard.date+' bot=1 manuel='+final.manual.length);
    }
    if(config.dryRun)console.log('Aucune ecriture Dendreo. Etat lu directement sur le serveur, sans snapshot.');
  } finally {if(browser)await browser.disconnect();release();}
}
module.exports={getGuardDates,cellContainsMarker,cellHasAnyEvent,createUnavailability,main};
if(require.main===module)main().catch(err=>{console.error('Erreur Dendreo :',err.message);process.exitCode=1;});
