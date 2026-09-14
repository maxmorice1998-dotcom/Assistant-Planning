const runtime = require("./runtime-config");
runtime.prepare();
const fs = require("fs");
const { writeExecutionSnapshot } = require("./sdis-utils");
const puppeteer = require("./browser-client");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const DRY_RUN = !process.argv.includes("--real") || process.argv.includes("--dry-run");
const ALERT_STATE_PATH = "last_alert.txt";

const AGATT_URL = "https://agatt.sdis14.fr/register/index.php?a=gardeExercice";

const credentials = runtime.credentials();
const token = runtime.token();
const alertConfig = runtime.alert();

const { client_secret, client_id, redirect_uris } = credentials.installed;

const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
auth.setCredentials(token);
 runtime.bindGoogleAuth(auth);

const calendar = google.calendar({ version: "v3", auth });

let CALENDAR_ID = runtime.calendarId();
if (!CALENDAR_ID) throw new Error("Calendrier SDIS-BOT non configure.");
const AGENT_ID = runtime.config().agentId;
if (!/^p\d+$/.test(AGENT_ID || "")) throw new Error("Connexion AGATT non configuree.");

async function envoyerMail(sujet, message, force = false) {
  // Mail "Planning SDIS..." handled by the real-state watcher below.
  if (String(sujet || "").toLowerCase().includes("planning sdis")) {
    console.log("Mail de synchro AGATT gere par check-agatt-alerts.js.");
    return;
  }
  if (DRY_RUN) { console.log("TEST mail AGATT :", sujet); return; }
  if (process.env.SDIS_COMBINED_MAIL === "1") {
    fs.appendFileSync(require("path").join(runtime.dataDir, ".combined-mail-queue.jsonl"), JSON.stringify({source:"AGATT",subject:sujet,text:message,queuedAt:new Date().toISOString()}) + "\n"); return;
  }
  const today = new Date().toISOString().slice(0, 10);

  if (!force && fs.existsSync(ALERT_STATE_PATH)) {
    const last = fs.readFileSync(ALERT_STATE_PATH, "utf8").trim();

    if (last === today) {
      console.log("Mail déjà envoyé aujourd’hui.");
      return;
    }
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    auth: {
      user: alertConfig.smtpUser,
      pass: runtime.smtpPassword(),
    },
  });

  await transporter.sendMail({
    from: alertConfig.smtpUser,
    to: alertConfig.to,
    subject: sujet,
    text: message,
  });

  fs.writeFileSync(ALERT_STATE_PATH, today);
  console.log("Mail envoyé :", sujet);
}

function dateFromId(id) {
  const date = id.split("_")[1];

  return {
    raw: date,
    year: date.slice(0, 4),
    month: date.slice(4, 6),
    day: date.slice(6, 8),
  };
}

function formatDateFrFromRaw(raw) {
  if (!raw || raw.length !== 8) return raw;

  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);

  return `${day}/${month}/${year}`;
}

function getRawDateFromAgattId(id) {
  if (!id || !id.includes("_")) return null;
  return id.split("_")[1];
}

function activeDateWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const monthsAhead = Number(runtime.readJson("dendreo-config.json", { monthsAhead: 6 }).monthsAhead);
  const end = new Date(start);
  end.setMonth(end.getMonth() + (Number.isFinite(monthsAhead) && monthsAhead >= 0 ? monthsAhead : 6));
  const raw = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return { start: raw(start), end: raw(end) };
}

function dateInActiveWindow(raw, window) {
  return Boolean(raw && /^\d{8}$/.test(raw) && raw >= window.start && raw <= window.end);
}

function classifyShift(hours) {
  const m = String(hours || "").match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start === end) return { kind: "24h", start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` };
  const duration = (end - start + 1440) % 1440;
  if (duration < 10 * 60 || duration > 14 * 60) return null;
  const night = start >= 16 * 60 || end <= 10 * 60 || end < start;
  return { kind: night ? "12h_nuit" : "12h_jour", start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` };
}

function comparableDescription(value) {
  return String(value || "").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

function typeEvenement(code) {
  if (code === "G") return "Garde SDIS ";
  if (code === "S") return "Stage SDIS ";
  if (code.includes("SHR")) return "Présence SDIS ";
  return null;
}

async function scrollTousLesBlocs(page) {
  console.log("Scroll complet...");

  await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const scrollables = Array.from(document.querySelectorAll("*")).filter(el => {
      const style = window.getComputedStyle(el);

      return (
        el.scrollHeight > el.clientHeight &&
        ["auto", "scroll"].includes(style.overflowY)
      );
    });

    const targets = [document.scrollingElement, ...scrollables].filter(Boolean);

    for (const el of targets) {
      el.scrollTop = 0;
      await sleep(200);

      let lastTop = -1;

      while (el.scrollTop !== lastTop) {
        lastTop = el.scrollTop;
        el.scrollTop += 800;
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
        await sleep(250);
      }
    }

    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1000);
  });

  console.log("Scroll terminé");
}

function comparableDateTime(value) {
  return String(value || "").slice(0, 19);
}

function buildEvent(item) {
  const d = dateFromId(item.id);
  const startDay = `${d.year}-${d.month}-${d.day}`;
  const shift = item.shift || classifyShift(item.hours);
  if (!shift) throw new Error(`Horaires AGATT absents pour ${item.id}.`);
  const endDate = new Date(`${startDay}T12:00:00Z`);
  if (shift.kind === "24h" || shift.kind === "12h_nuit" || shift.end <= shift.start) endDate.setUTCDate(endDate.getUTCDate() + 1);
  const nextDay = endDate.toISOString().slice(0, 10);

  let colorId = "1";

  if (item.text === "G") colorId = "4";
  if (item.text === "S") colorId = "9";
  if (item.text.includes("SHR")) colorId = "10";

  return {
    summary: typeEvenement(item.text),
    colorId,

    description:
      `Import automatique AGATT\n` +
      `Code : ${item.text}\n` +
      `Cellule : ${item.id}`,

    ...(shift.kind === "24h"
      ? { start: { date: startDay }, end: { date: nextDay } }
      : { start: { dateTime: `${startDay}T${shift.start}:00`, timeZone: "Europe/Paris" },
          end: { dateTime: `${nextDay}T${shift.end}:00`, timeZone: "Europe/Paris" } }),

    extendedProperties: {
      private: {
        agattId: item.id,
        agattCode: item.text,
        agattShift: shift.kind,
        agattStart: shift.start,
        agattEnd: shift.end,
        source: "AGATT-SDIS",
      },
    },
  };
}

function eventNeedsUpdate(existing, eventBody, item) {
  const oldPrivate = existing.extendedProperties?.private || {};
  const newPrivate = eventBody.extendedProperties.private;
  return oldPrivate.agattCode !== item.text ||
    existing.summary !== eventBody.summary || existing.colorId !== eventBody.colorId ||
    existing.start?.date !== eventBody.start.date || existing.end?.date !== eventBody.end.date ||
    comparableDateTime(existing.start?.dateTime) !== comparableDateTime(eventBody.start.dateTime) ||
    comparableDateTime(existing.end?.dateTime) !== comparableDateTime(eventBody.end.dateTime) ||
    comparableDescription(existing.description) !== comparableDescription(eventBody.description) ||
    oldPrivate.agattShift !== newPrivate.agattShift || oldPrivate.agattStart !== newPrivate.agattStart ||
    oldPrivate.agattEnd !== newPrivate.agattEnd;
}

async function getExistingEvents(window) {
 const all=[]; let pageToken; do {
  const toUtc = raw => new Date(Date.UTC(
    Number(raw.slice(0,4)), Number(raw.slice(4,6))-1, Number(raw.slice(6,8))
  ));
  const timeMin = toUtc(window.start).toISOString();
  const timeMaxDate = toUtc(window.end); timeMaxDate.setUTCDate(timeMaxDate.getUTCDate()+1);
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    pageToken,
    timeMin,
    timeMax: timeMaxDate.toISOString(),
    singleEvents: true,
    maxResults: 2500,
    privateExtendedProperty: "source=AGATT-SDIS",
  });

 all.push(...(res.data.items || [])); pageToken=res.data.nextPageToken; } while(pageToken); return all;
}

function buildMailResume({
  oldGuardDates,
  newGuardDates,
  addedGuardDates,
  removedGuardDates,
  created,
  updated,
  deleted,
}) {
  const lines = [];

  const oldCount = oldGuardDates.length;
  const newCount = newGuardDates.length;

  if (
    addedGuardDates.length === 0 &&
    removedGuardDates.length === 0 &&
    created === 0 &&
    updated === 0 &&
    deleted === 0
  ) {
    return {
      subject: "✅ Planning SDIS : pas de modification",
      body:
        "Planning SDIS vérifié.\n\n" +
        "Aucune modification détectée sur tes gardes.\n\n" +
        `Nombre de gardes actuel : ${newCount}`,
    };
  }

  lines.push("Planning SDIS mis à jour.");
  lines.push("");

  if (
    oldCount === newCount &&
    addedGuardDates.length > 0 &&
    removedGuardDates.length > 0
  ) {
    lines.push("🔁 Garde(s) modifiée(s) / déplacée(s) :");
    lines.push("");

    const removedSorted = [...removedGuardDates].sort();
    const addedSorted = [...addedGuardDates].sort();

    const max = Math.max(removedSorted.length, addedSorted.length);

    for (let i = 0; i < max; i++) {
      const oldDate = removedSorted[i]
        ? formatDateFrFromRaw(removedSorted[i])
        : "?";

      const newDate = addedSorted[i]
        ? formatDateFrFromRaw(addedSorted[i])
        : "?";

      lines.push(`- ${oldDate} → ${newDate}`);
    }

    lines.push("");
  } else {
    if (addedGuardDates.length > 0) {
      lines.push("➕ Garde(s) ajoutée(s) :");
      lines.push("");

      for (const date of addedGuardDates.sort()) {
        lines.push(`- ${formatDateFrFromRaw(date)}`);
      }

      lines.push("");
    }

    if (removedGuardDates.length > 0) {
      lines.push("➖ Garde(s) retirée(s) :");
      lines.push("");

      for (const date of removedGuardDates.sort()) {
        lines.push(`- ${formatDateFrFromRaw(date)}`);
      }

      lines.push("");
    }
  }

  lines.push("Résumé technique :");
  lines.push(`- Créés : ${created}`);
  lines.push(`- Mis à jour : ${updated}`);
  lines.push(`- Supprimés : ${deleted}`);
  lines.push("");
  lines.push(`Nombre de gardes avant : ${oldCount}`);
  lines.push(`Nombre de gardes maintenant : ${newCount}`);

  return {
    subject: "✅ Planning SDIS : modification détectée",
    body: lines.join("\n"),
  };
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:19222",
  });

  const existingPage = (await browser.pages()).find(p => {
    try { return new URL(p.url()).hostname === "agatt.sdis14.fr"; }
    catch { return false; }
  });
  const page = existingPage || await browser.newPage();
  const ownsPage = !existingPage;

  try {
    console.log(DRY_RUN ? "TEST AGATT sans ecriture ni mail" : "Synchronisation AGATT");
    console.log("Ouverture planning AGATT...");

    const alreadyLoaded = existingPage && await page.evaluate(
      () => document.querySelectorAll("div.c").length > 0
    ).catch(() => false);
    if (!alreadyLoaded) {
      await page.goto(AGATT_URL, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
    }

    const window = activeDateWindow();
    await page.waitForFunction(
      () => document.querySelectorAll("div.c").length > 0,
      { timeout: 15000 }
    ).catch(() => {});

    console.log("Page utilisée :", await page.url());

    await page.waitForSelector("body", { timeout: 10000 });

    const bodyText = await page.evaluate(() => document.body.innerText);

    if (
      bodyText.toLowerCase().includes("connexion") ||
      bodyText.toLowerCase().includes("login") ||
      bodyText.toLowerCase().includes("mot de passe")
    ) {
      await envoyerMail(
        "⚠️ Session SDIS expirée",
        "La session AGATT/SDIS semble expirée. Reconnecte-toi dans Chrome sur le vieux PC."
      );

      if (ownsPage) await page.close();
      await browser.disconnect();
      process.exit(1);
    }

    await scrollTousLesBlocs(page);

    const cellCount = await page.evaluate(() => {
      return document.querySelectorAll("div.c").length;
    });

    if (cellCount === 0) {
      await envoyerMail(
        "⚠️ Bot SDIS : planning introuvable",
        "Le bot ne trouve aucune cellule de planning AGATT. Vérifie que Chrome est bien connecté au SDIS."
      );

      if (ownsPage) await page.close();
      await browser.disconnect();
      process.exit(1);
    }

    const allItems = await page.evaluate((AGENT_ID) => {
      return Array.from(document.querySelectorAll("div.c"))
        .filter(el => el.id && el.id.startsWith(`${AGENT_ID}_`))
        .map(el => ({
          id: el.id,
          text: el.innerText.trim(),
        }))
        .filter(el => {
          const t = el.text;

          return (
            t === "G" ||
            t === "S" ||
            t.includes("SHR")
          );
        });
    }, AGENT_ID);

    const activeCells = allItems.filter(item =>
      dateInActiveWindow(getRawDateFromAgattId(item.id), window)
    );
    const items = await page.evaluate(async (cells) => {
      const details = async item => {
        const parts = item.id.split("_");
        try {
          const response = await fetch("../ajax/index.php", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ a: "infobulleOccupations", idPersonnel: parts[0].replace(/^p/, ""), date: parts[1] }),
          });
          const doc = new DOMParser().parseFromString(await response.text(), "text/html");
          item.occupationType = (doc.querySelector(".type")?.textContent || "").trim();
          item.hours = (doc.querySelector(".horaires")?.textContent || "").trim();
        } catch { item.occupationType = ""; item.hours = ""; }
        return item;
      };
      return Promise.all(cells.map(details));
    }, activeCells);

    for (const item of items) {
      item.shift = classifyShift(item.hours);
      if (!item.shift) throw new Error(`Horaires AGATT absents ou ambigus pour ${getRawDateFromAgattId(item.id)}.`);
    }

    const activeItems = [...new Map(
      items
        .filter(item => dateInActiveWindow(getRawDateFromAgattId(item.id), window))
        .map(item => [item.id, item])
    ).values()];
    console.log(`${items.length} événements AGATT trouvés (${activeItems.length} dans la fenêtre active)`);

    if (allItems.length === 0) {
      await envoyerMail(
        "⚠️ Bot SDIS : aucun événement trouvé",
        "AGATT est ouvert, mais aucune garde/stage/présence n’a été trouvée. Aucune suppression effectuée."
      );

      if (ownsPage) await page.close();
      await browser.disconnect();
      process.exit(1);
    }

    const observedIds = new Set(await page.evaluate(agent => Array.from(document.querySelectorAll("div.c")).map(el => el.id).filter(id => new RegExp("^" + agent + "_\\d{8}$").test(id)), AGENT_ID));
    if (!observedIds.size || items.some(item => !observedIds.has(item.id))) throw new Error("Perimetre AGATT invalide.");
    writeExecutionSnapshot({
      guards: activeItems
        .filter(item => item.text === "G")
        .map(item => ({
          id: item.id,
          date: require('./dendreo-state').normalizeDate(getRawDateFromAgattId(item.id)),
          shift: item.shift?.kind || "24h",
          startTime: item.shift?.start || "",
          endTime: item.shift?.end || "",
        })),
      guardWindow: window,
    });
    CALENDAR_ID = await runtime.resolveCalendarId(calendar);
    const existingEvents = await getExistingEvents(window);

    const oldGuardDates = existingEvents
      .filter(ev => ev.extendedProperties?.private?.agattCode === "G")
      .map(ev => getRawDateFromAgattId(ev.extendedProperties?.private?.agattId))
      .filter(date => dateInActiveWindow(date, window))
      .filter(Boolean)
      .sort();

    const newGuardDates = activeItems
      .filter(item => item.text === "G")
      .map(item => getRawDateFromAgattId(item.id))
      .filter(Boolean)
      .sort();

    const oldGuardSet = new Set(oldGuardDates);
    const newGuardSet = new Set(newGuardDates);

    const addedGuardDates = newGuardDates.filter(date => !oldGuardSet.has(date));
    const removedGuardDates = oldGuardDates.filter(date => !newGuardSet.has(date));

    let created = 0;
    let updated = 0;
    let deleted = 0;

    const existingByAgattId = new Map();
    const duplicateEvents = [];

    for (const ev of existingEvents) {
      const agattId = ev.extendedProperties?.private?.agattId;

      if (agattId && existingByAgattId.has(agattId)) {
        if (dateInActiveWindow(getRawDateFromAgattId(agattId), window) && observedIds.has(agattId)) duplicateEvents.push(ev);
        continue;
      }
      if (agattId) {
        existingByAgattId.set(agattId, ev);
      }
    }

    const currentAgattIds = new Set(activeItems.map(g => g.id));

    // Plan complet journalisé avant toute écriture Google.
    for (const item of activeItems) {
      const existing = existingByAgattId.get(item.id);
      console.log(`PLAN ${existing && eventNeedsUpdate(existing, buildEvent(item), item) ? "UPDATE" : (existing ? "NOTHING" : "CREATE")} Google : ${item.id}`);
    }
    for (const ev of existingEvents) {
      const agattId = ev.extendedProperties?.private?.agattId;
      if (agattId && observedIds.has(agattId) && dateInActiveWindow(getRawDateFromAgattId(agattId), window) && !currentAgattIds.has(agattId)) {
        console.log(`PLAN DELETE Google : ${agattId}`);
      }
    }

    for (const ev of duplicateEvents) {
      const agattId = ev.extendedProperties?.private?.agattId;
      console.log(`PLAN DELETE Google doublon : ${agattId}`);
      if (!DRY_RUN) await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: ev.id });
      deleted++;
      console.log("Doublon supprimé :", agattId);
    }

    for (const item of activeItems) {
      const eventBody = buildEvent(item);
      const existing = existingByAgattId.get(item.id);

      if (existing) {
        const oldCode = existing.extendedProperties?.private?.agattCode;
        const oldSummary = existing.summary;
        const oldColor = existing.colorId;

        const hasChanged = eventNeedsUpdate(existing, eventBody, item);

        if (hasChanged) console.log(`PLAN UPDATE Google : ${item.id}`);
        if (hasChanged && !DRY_RUN) await calendar.events.update({
          calendarId: CALENDAR_ID,
          eventId: existing.id,
          requestBody: {
            ...existing,
            ...eventBody,
          },
        });

        if (hasChanged) {
          updated++;
          console.log("Mis à jour :", item.id, item.text);
        } else {
          console.log(`PLAN NOTHING Google : ${item.id}`);
          console.log("Déjà OK :", item.id, item.text);
        }
      } else {
        console.log(`PLAN CREATE Google : ${item.id}`);
        if (!DRY_RUN) await calendar.events.insert({
          calendarId: CALENDAR_ID,
          requestBody: eventBody,
        });

        created++;
        console.log("Créé :", item.id, item.text);
      }
    }

    for (const ev of existingEvents) {
      const agattId = ev.extendedProperties?.private?.agattId;

      if (agattId && observedIds.has(agattId) && dateInActiveWindow(getRawDateFromAgattId(agattId), window) && !currentAgattIds.has(agattId)) {
        console.log(`PLAN DELETE Google : ${agattId}`);
        if (!DRY_RUN) await calendar.events.delete({
          calendarId: CALENDAR_ID,
          eventId: ev.id,
        });

        deleted++;
        console.log("Supprimé :", agattId);
      }
    }

    const resume = buildMailResume({
      oldGuardDates,
      newGuardDates,
      addedGuardDates,
      removedGuardDates,
      created,
      updated,
      deleted,
    });

    await envoyerMail(
      resume.subject,
      resume.body,
      true
    );

    console.log("Sync terminée sans doublons");

    if (ownsPage) await page.close();
    await browser.disconnect();
    process.exit(0);

  } catch (err) {
    console.error(err);

    try {
      await envoyerMail(
        "⚠️ Erreur bot SDIS",
        "Erreur du bot SDIS :\n\n" + err.message,
        true
      );
    } catch (e) {
      console.error("Impossible d’envoyer l’alerte :", e.message);
    }

    try {
      if (ownsPage) await page.close();
    } catch {}

    await browser.disconnect();
    process.exit(1);
  }
}

main();
