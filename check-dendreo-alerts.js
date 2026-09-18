const runtime = require("./runtime-config");
runtime.prepare();
const { listAllEvents, readFreshSnapshot, readExecutionSnapshot, writeExecutionSnapshot } = require("./sdis-utils");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("./browser-client");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const dendreoState = require('./dendreo-state');
const DRY_RUN = !process.argv.includes("--real") || process.argv.includes("--dry-run");
const DIR = runtime.dataDir;
const STATE = path.join(DIR, "dendreo-alert-state.json");
const BEFORE = path.join(DIR, "dendreo-before-sync.json");
const ALERT = runtime.alert();
const CREDS = runtime.credentials();
const TOKEN = runtime.token();

let cfg = {};
try {
  cfg = JSON.parse(
    fs.readFileSync(path.join(DIR, "dendreo-config.json"), "utf8").replace(/^\uFEFF/, "")
  );
} catch {}

const monthsAhead = Number(cfg.monthsAhead || 6);
const marker = String(cfg.marker || "[SDIS-BOT]");

const { client_secret, client_id, redirect_uris } = CREDS.installed;
const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
auth.setCredentials(TOKEN);
 runtime.bindGoogleAuth(auth);
const calendar = google.calendar({ version: "v3", auth });
let CALENDAR_ID = runtime.calendarId();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 12, 0, 0);
}

function frDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function nowFr() {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(new Date());
}

function cleanText(s) {
  return String(s || "")
    .replace(/\u274c/g, "")
    .replace(/\ud83d\udcc5/g, "")
    .replace(/\ufe0f/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*MORICE\s+Maxime\s*$/i, "")
    .trim();
}

function displayText(ev) {
  if (!ev.botOwned) return ev.text;
  return `[AUTO SDIS] ${cleanText(String(ev.text || "").replace(marker, ""))}`;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadState() {
  const x = loadJson(STATE, {});
  return {
    readerVersion: x.readerVersion || 1,
    initialized: !!x.initialized,
    events: Array.isArray(x.events)
      ? x.events
      : Array.isArray(x.dendreo)
        ? x.dendreo
        : [],
    conflicts: Array.isArray(x.conflicts) ? x.conflicts : [],
  };
}

function saveState(x) {
  if (DRY_RUN) return;
  fs.writeFileSync(STATE, JSON.stringify(x, null, 2), "utf8");
}

let smtpTransporter = null;

function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      service: "gmail",
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      pool: false,
      maxConnections: 1,
      maxMessages: 20,
      rateDelta: 1500,
      rateLimit: 1,
      auth: {
        user: ALERT.smtpUser,
        pass: runtime.smtpPassword(),
      },
    });
  }
  return smtpTransporter;
}

function temporarySmtpError(err) {
  const t = [
    err?.message,
    err?.response,
    err?.responseCode,
    err?.code,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    t.includes("421") ||
    t.includes("4.4.5") ||
    t.includes("450") ||
    t.includes("451") ||
    t.includes("452") ||
    t.includes("server busy") ||
    t.includes("try again later") ||
    t.includes("etimedout") ||
    t.includes("econnreset") ||
    t.includes("esocket")
  );
}

async function sendMail(subject, text, dedupe = true) {
  // Un seul mail est envoyé à la fin par send-combined-alerts.js.
  return;
  if (DRY_RUN) { console.log("TEST mail :", subject); return; }
  // SDIS-COMBINED-MAIL-DENDREO
  if (process.env.SDIS_COMBINED_MAIL === "1") {
    const queueFile = path.join(DIR, ".combined-mail-queue.jsonl");
    fs.appendFileSync(
      queueFile,
      JSON.stringify({
        source: "DENDREO",
        subject: String(subject || ""),
        text: String(text || ""),
        queuedAt: new Date().toISOString()
      }) + "\n",
      "utf8"
    );
    console.log("Mail DENDREO mis en attente pour le recapitulatif :", subject);
    return;
  }
  const lockDir = path.join(DIR, ".dendreo-mail-locks");
  fs.mkdirSync(lockDir, { recursive: true });

  let lock = null;

  if (dedupe) {
    const sig = crypto
      .createHash("sha256")
      .update(subject + "\n" + text)
      .digest("hex");

    lock = path.join(lockDir, sig + ".lock");
    const fiveMinutes = 5 * 60 * 1000;

    if (fs.existsSync(lock)) {
      const age = Date.now() - fs.statSync(lock).mtimeMs;
      if (age < fiveMinutes) {
        console.log("Mail Dendreo identique bloque.");
        return;
      }
      try { fs.unlinkSync(lock); } catch {}
    }

    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, String(Date.now()));
      fs.closeSync(fd);
    } catch (e) {
      if (e && e.code === "EEXIST") return;
      throw e;
    }
  }

  const delays = [0, 4000, 10000, 20000, 35000];
  let lastError = null;

  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);

    try {
      await getSmtpTransporter().sendMail({
        from: ALERT.smtpUser,
        to: ALERT.to,
        subject,
        text,
      });

      console.log("Mail Dendreo envoye :", subject);
      return;
    } catch (e) {
      lastError = e;
      if (!temporarySmtpError(e)) break;

      try { smtpTransporter?.close(); } catch {}
      smtpTransporter = null;
    }
  }

  if (lock) {
    try { fs.unlinkSync(lock); } catch {}
  }

  throw lastError || new Error("Echec SMTP inconnu.");
}

async function agendaPage(browser) {
  const pages = await browser.pages();

  let page = pages.find(
    p =>
      p.url().includes("formation.pompiers-14.org") &&
      p.url().includes("/agenda")
  );

  if (page) return page;

  page = pages.find(p => p.url().includes("formation.pompiers-14.org"));
  if (!page) throw new Error("Aucun onglet Dendreo trouve.");

  const u = await page.evaluate(() => [...document.querySelectorAll("a[href]")].find(a => /\/agenda(?:[?#]|$)/i.test(a.href))?.href);
  if (!u) throw new Error("Lien agenda Dendreo absent.");

  await page.goto(u, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  return page;
}

async function readDendreo(page) {
  const end = new Date();
  end.setMonth(end.getMonth()+monthsAhead);
  return dendreoState.readEvents(page,isoDate(),isoDate(end));
}
async function guards() {
  const data=await require('./sync-dendreo').getGuardDates(cfg);
  return data.guards.map(g=>g.date);
}

function normalizeEvent(x) {
  const dates = [...new Set(
    Array.isArray(x?.dates)
      ? x.dates
      : x?.date
        ? [x.date]
        : []
  )].filter(Boolean).sort();

  return {
    ...x,
    dates,
    text: cleanText(x?.text || ""),
    indispo: !!x?.indispo,
    botOwned: String(x?.text || '').includes(dendreoState.MARKER),
  };
}

function stableKey(x) {
  const n = normalizeEvent(x);

  return [
    (n.eventIds || [n.id]).join(","),
    n.dates.join(","),
    n.text,
    n.indispo ? "I" : "E",
    n.botOwned ? "B" : "N",
  ].join("|");
}

function modificationBucket(x) {
  const n = normalizeEvent(x);

  return [
    n.dates.join(","),
    n.indispo ? "I" : "E",
    n.botOwned ? "B" : "N",
  ].join("|");
}

function normalizeEvents(events) {
  const map = new Map();

  for (const raw of events || []) {
    const ids = raw.eventIds?.length ? raw.eventIds : [raw.id];
    for (const id of ids) {
    const x = normalizeEvent({...raw,id,eventIds:[String(id)]});

    if (!x.dates.length || !x.text) continue;

    const key = stableKey(x);

    if (!map.has(key)) {
      map.set(key, {
        ...x,
        id: key,
      });
    }
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      (a.dates[0] || "").localeCompare(b.dates[0] || "") ||
      a.text.localeCompare(b.text)
  );
}

function diff(oldEvents, newEvents) {
  const today = isoDate();
  const inWindow = events => (events || []).map(x => ({...x, dates: normalizeEvent(x).dates.filter(d => d >= today)}));
  const oldNorm = normalizeEvents(inWindow(oldEvents));
  const newNorm = normalizeEvents(inWindow(newEvents));

  const oldMap = new Map(
    oldNorm.map(x => [stableKey(x), x])
  );

  const newMap = new Map(
    newNorm.map(x => [stableKey(x), x])
  );

  let added = [...newMap.entries()]
    .filter(([key]) => !oldMap.has(key))
    .map(([, value]) => value);

  let removed = [...oldMap.entries()]
    .filter(([key]) => !newMap.has(key))
    .map(([, value]) => value);

  const modified = [];
  const usedAdded = new Set();
  const usedRemoved = new Set();

  for (let ri = 0; ri < removed.length; ri++) {
    const before = removed[ri];
    const bucket = modificationBucket(before);

    const ai = added.findIndex(
      (after, index) =>
        !usedAdded.has(index) &&
        modificationBucket(after) === bucket
    );

    if (ai >= 0) {
      usedRemoved.add(ri);
      usedAdded.add(ai);
      modified.push({
        before,
        after: added[ai],
      });
    }
  }

  removed = removed.filter(
    (_, index) => !usedRemoved.has(index)
  );

  added = added.filter(
    (_, index) => !usedAdded.has(index)
  );

  return { added, removed, modified };
}

function countChanges(ch) {
  return (
    ch.added.length +
    ch.removed.length +
    ch.modified.length
  );
}

function datesLabel(x) {
  return x.dates.map(frDate).join(", ");
}

function formatChanges(ch) {
  const out = [];

  if (ch.modified.length) {
    out.push("MODIFIE :");

    for (const x of ch.modified) {
      out.push(
        `- ${datesLabel(x.after)} : ${displayText(x.before)} -> ${displayText(x.after)}`
      );
    }

    out.push("");
  }

  if (ch.added.length) {
    out.push("AJOUTE :");

    for (const x of ch.added) {
      out.push(
        `- ${datesLabel(x)} : ${displayText(x)}`
      );
    }

    out.push("");
  }

  if (ch.removed.length) {
    out.push("SUPPRIME :");

    for (const x of ch.removed) {
      out.push(
        `- ${datesLabel(x)} : ${displayText(x)}`
      );
    }

    out.push("");
  }

  return out.join("\n").trim();
}

function conflictKey(x) {
  return `${x.date}|${x.formation}`;
}

async function makeSnapshot() {
  const browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:19223",
  });

  try {
    const page = await agendaPage(browser);
    return await readDendreo(page);
  } finally {
    await browser.disconnect();
  }
}

async function beforeMode() {
  const state = loadState();
  const currentBefore = normalizeEvents(await makeSnapshot());

  writeExecutionSnapshot({
    dendreo: {
      capturedAt: new Date().toISOString(),
      events: currentBefore,
    },
  });

  if (!DRY_RUN) fs.writeFileSync(
    BEFORE,
    JSON.stringify({
      capturedAt: new Date().toISOString(),
      readerVersion: 2,
      previousInitialized: state.initialized,
      previous: state.events,
      before: currentBefore,
    }, null, 2),
    "utf8"
  );

  console.log(
    `Dendreo avant synchro : ${currentBefore.length} evenement(s).`
  );
}

async function afterMode() {
  const state = loadState();
  const pre = readFreshSnapshot(BEFORE, DRY_RUN);
  const shared = readExecutionSnapshot();
  const rawAfter = await makeSnapshot();
  const currentAfter = normalizeEvents(rawAfter);
  writeExecutionSnapshot({calendarAfter:{from:isoDate(),events:rawAfter}});

  let previous = normalizeEvents(state.events || []);
  let currentBefore = previous;

  if (
    pre &&
    Array.isArray(pre.previous) &&
    Array.isArray(pre.before)
  ) {
    previous = normalizeEvents(pre.previous);
    currentBefore = normalizeEvents(pre.before);
  }
  // Les anciens états associaient les dates par pixels et fusionnaient des IDs.
  // Ils ne constituent pas une référence fiable pour annoncer des changements.
  if(state.readerVersion !== 2) {
    console.log('Migration lecture Dendreo : ancienne référence géométrique ignorée pour les différences.');
    previous = pre?.readerVersion === 2 ? currentBefore : currentAfter;
    if(pre?.readerVersion !== 2) currentBefore = currentAfter;
  }

  const externalChanges = diff(
    previous,
    currentBefore
  );

  const botChanges = diff(
    currentBefore,
    currentAfter
  );

  const externalCount = countChanges(externalChanges);
  const botCount = countChanges(botChanges);

  const guardSet = new Set(await guards());
  const missing = [];
  const duplicates = [];
  const conflictDates = new Set(Array.isArray(shared?.dendreoConflicts) ? shared.dendreoConflicts.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d||''))).map(String) : []);
  for(const date of guardSet) {
    const day = dendreoState.dayState(currentAfter,date);
    if(conflictDates.has(date)) {
      // Le serveur Dendreo a refusé la création (créneau existant) : ce n'est pas une absence à corriger.
      dendreoState.logDay(date,day,'CONFLIT (créneau existant, aucune indisponibilité créée)');
      continue;
    }
    if(!day.bots.length) missing.push(date);
    if(day.bots.length>1) duplicates.push(date);
    dendreoState.logDay(date,day,day.bots.length>1?'DELETE DUPLICATE':day.bots.length?'NOTHING':'CREATE');
  }

  const conflicts = [];

  for (
    const ev of currentAfter.filter(
      x => !x.indispo && !x.botOwned
    )
  ) {
    for (const date of ev.dates) {
      if (guardSet.has(date)) {
        conflicts.push({
          date,
          formation: ev.text,
        });
      }
    }
  }

  const uniq = [];
  const seen = new Set();

  for (const c of conflicts) {
    const k = conflictKey(c);

    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(c);
    }
  }

  const oldKeys = new Set(
    (state.conflicts || []).map(conflictKey)
  );

  const newKeys = new Set(
    uniq.map(conflictKey)
  );

  const newConflicts = uniq.filter(
    x => !oldKeys.has(conflictKey(x))
  );

  const resolved = (state.conflicts || []).filter(
    x => !newKeys.has(conflictKey(x))
  );

  if (missing.length || duplicates.length) {
    await sendMail('Dendreo : indisponibilités à corriger',
      `Manquantes : ${missing.join(', ') || 'aucune'}\nDoublons : ${duplicates.join(', ') || 'aucun'}`);
    if(!DRY_RUN) process.exitCode=1;
  } else if (
    state.initialized &&
    (externalCount > 0 || botCount > 0)
  ) {
    const sections = [
      "Ton agenda Dendreo a chang\u00e9.",
      "",
    ];

    if (externalCount > 0) {
      sections.push(
        `CHANGEMENT(S) CONSTAT\u00c9(S) AVANT SYNCHRO : ${externalCount}`,
        formatChanges(externalChanges),
        ""
      );
    }

    if (botCount > 0) {
      sections.push(
        `ACTION(S) AUTOMATIQUE(S) DU BOT : ${botCount}`,
        formatChanges(botChanges),
        ""
      );
    }

    sections.push(
      `Contr\u00f4le : ${nowFr()}`
    );

    await sendMail(
      "\ud83d\udd14 Changement dans Dendreo",
      sections.join("\n")
    );
  } else if (!state.initialized) {
    await sendMail(
      "\u2705 SDIS-BOT : controle initialise",
      `La reference Dendreo a ete creee correctement.\n\n` +
      `Gardes AGATT detectees : ${guardSet.size}\n` +
      `Evenements Dendreo suivis : ${currentAfter.length}\n` +
      `Conflits garde / formation : ${uniq.length}\n\n` +
      `Contr\u00f4le : ${nowFr()}`,
      false
    );
  } else {
    await sendMail(
      "\u2705 SDIS-BOT : controle OK",
      `Le controle automatique s'est termine correctement.\n\n` +
      `Gardes AGATT detectees : ${guardSet.size}\n` +
      `Evenements Dendreo suivis : ${currentAfter.length}\n` +
      `Conflits garde / formation : ${uniq.length}\n\n` +
      `Contr\u00f4le : ${nowFr()}`,
      false
    );
  }

  if (newConflicts.length) {
    await sendMail(
      "\u26a0\ufe0f Conflit GARDE / FORMATION",
      `Une garde AGATT tombe le meme jour qu'une formation Dendreo.\n\n` +
      newConflicts
        .map(
          x => `- ${frDate(x.date)} : ${x.formation}`
        )
        .join("\n")
    );
  }

  if (state.initialized && resolved.length) {
    await sendMail(
      "\u2705 Conflit GARDE / FORMATION resolu",
      `Le ou les conflits suivants ne sont plus presents :\n\n` +
      resolved
        .map(
          x => `- ${frDate(x.date)} : ${x.formation}`
        )
        .join("\n")
    );
  }

  saveState({
    readerVersion: 2,
    initialized: true,
    checkedAt: new Date().toISOString(),
    events: currentAfter,
    conflicts: uniq,
  });

  try {
    if (!DRY_RUN) fs.unlinkSync(BEFORE);
  } catch {}

  console.log(
    `Dendreo : changements avant=${externalCount}, changements bot=${botCount}, evenements presents=${currentAfter.length}, indisponibilites [SDIS-BOT]=${currentAfter.filter(e=>e.botOwned && e.indispo).length}, manquantes=${missing.length}, dates en doublon=${duplicates.length}, conflits=${uniq.length}.`
  );
}

async function main() {
  const mode = process.argv[2] || "after";

  if (mode === "before") {
    await beforeMode();
  } else {
    await afterMode();
  }
}

main().catch(async e => {
  console.error("Erreur surveillance Dendreo :", e);

  if ((process.argv[2] || "after") !== "before") {
    try {
      await sendMail(
        "\u26a0\ufe0f Erreur surveillance Dendreo",
        `Le controle Dendreo a rencontre une erreur :\n\n${e.message || String(e)}`
      );
    } catch {}
  }

  process.exit(1);
});
