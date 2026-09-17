const runtime = require("./runtime-config");
runtime.prepare();
const { listAllEvents, readFreshSnapshot } = require("./sdis-utils");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const DRY_RUN = !process.argv.includes("--real") || process.argv.includes("--dry-run");
const DIR = runtime.dataDir;
const STATE = path.join(DIR, "agatt-alert-state.json");
const BEFORE = path.join(DIR, "agatt-before-sync.json");

const ALERT = runtime.alert();
const CREDS = runtime.credentials();
const TOKEN = runtime.token();

const { client_secret, client_id, redirect_uris } = CREDS.installed;
const auth = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);
auth.setCredentials(TOKEN);
 runtime.bindGoogleAuth(auth);

const calendar = google.calendar({
  version: "v3",
  auth,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonths(d, n) {
  return new Date(
    d.getFullYear(),
    d.getMonth() + n,
    d.getDate(),
    12,
    0,
    0
  );
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

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;

  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function loadState() {
  const x = loadJson(STATE, {});

  return {
    initialized: !!x.initialized,
    events: Array.isArray(x.events)
      ? x.events
      : [],
  };
}

function saveState(x) {
  if (DRY_RUN) return;
  fs.writeFileSync(
    STATE,
    JSON.stringify(x, null, 2),
    "utf8"
  );
}

let smtpTransporter = null;

function getTransporter() {
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

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
  // SDIS-COMBINED-MAIL-AGATT
  if (process.env.SDIS_COMBINED_MAIL === "1") {
    const queueFile = path.join(DIR, ".combined-mail-queue.jsonl");
    fs.appendFileSync(
      queueFile,
      JSON.stringify({
        source: "AGATT",
        subject: String(subject || ""),
        text: String(text || ""),
        queuedAt: new Date().toISOString()
      }) + "\n",
      "utf8"
    );
    console.log("Mail AGATT mis en attente pour le recapitulatif :", subject);
    return;
  }
  const lockDir = path.join(
    DIR,
    ".agatt-mail-locks"
  );

  fs.mkdirSync(lockDir, {
    recursive: true,
  });

  let lock = null;

  if (dedupe) {
    const sig = crypto
      .createHash("sha256")
      .update(subject + "\n" + text)
      .digest("hex");

    lock = path.join(
      lockDir,
      sig + ".lock"
    );

    const fiveMinutes =
      5 * 60 * 1000;

    if (fs.existsSync(lock)) {
      const age =
        Date.now() -
        fs.statSync(lock).mtimeMs;

      if (age < fiveMinutes) {
        console.log(
          "Mail AGATT identique bloque."
        );
        return;
      }

      try {
        fs.unlinkSync(lock);
      } catch {}
    }

    try {
      const fd = fs.openSync(
        lock,
        "wx"
      );

      fs.writeFileSync(
        fd,
        String(Date.now())
      );

      fs.closeSync(fd);
    } catch (e) {
      if (
        e &&
        e.code === "EEXIST"
      ) {
        return;
      }

      throw e;
    }
  }

  const delays = [
    0,
    4000,
    10000,
    20000,
    35000,
  ];

  let lastError = null;

  for (
    let i = 0;
    i < delays.length;
    i++
  ) {
    if (delays[i] > 0) {
      await sleep(delays[i]);
    }

    try {
      await getTransporter().sendMail({
        from: ALERT.smtpUser,
        to: ALERT.to,
        subject,
        text,
      });

      console.log(
        "Mail AGATT envoye :",
        subject
      );

      return;
    } catch (e) {
      lastError = e;

      if (!temporarySmtpError(e)) {
        break;
      }

      try {
        smtpTransporter?.close();
      } catch {}

      smtpTransporter = null;
    }
  }

  if (lock) {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }

  throw (
    lastError ||
    new Error(
      "Echec SMTP inconnu."
    )
  );
}

async function currentAgattGoogleEvents() {
  const start = new Date();
  start.setDate(
    start.getDate() - 31
  );

  const end = addMonths(
    new Date(),
    18
  );

  const res =
    await listAllEvents(calendar, {
      calendarId: String(runtime.readJson("google-calendar.json",{}).calendarId||"").trim(),
      timeMin:
        `${isoDate(start)}T00:00:00+02:00`,
      timeMax:
        `${isoDate(end)}T23:59:59+02:00`,
      singleEvents: true,
      maxResults: 2500,
      privateExtendedProperty:
        "source=AGATT-SDIS",
    });

  const map = new Map();

  for (
    const ev of res.data.items || []
  ) {
    const agattId =
      ev.extendedProperties
        ?.private
        ?.agattId || "";

    const code =
      ev.extendedProperties
        ?.private
        ?.agattCode || "";

    const agattDateMatch = String(agattId).match(/_(\d{8})(?:_|$)/);
    const date = agattDateMatch
      ? `${agattDateMatch[1].slice(0,4)}-${agattDateMatch[1].slice(4,6)}-${agattDateMatch[1].slice(6,8)}`
      : (ev.start?.date || (ev.start?.dateTime || "").slice(0, 10));

    if (
      !agattId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        date
      )
    ) {
      continue;
    }

    map.set(agattId, {
      agattId,
      code,
      date,
      summary:
        ev.summary || "",
    });
  }

  return [...map.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.agattId.localeCompare(
        b.agattId
      )
  );
}

function same(a, b) {
  return (
    a.agattId === b.agattId &&
    a.code === b.code &&
    a.date === b.date &&
    a.summary === b.summary
  );
}

function diff(oldEvents, newEvents) {
  const start=new Date(); start.setDate(start.getDate()-31);
  const min=isoDate(start), max=isoDate(addMonths(new Date(),18));
  oldEvents=(oldEvents || []).filter(x=>x.date>=min && x.date<=max);
  newEvents=(newEvents || []).filter(x=>x.date>=min && x.date<=max);
  const oldMap = new Map(
    (oldEvents || []).map(
      x => [x.agattId, x]
    )
  );

  const newMap = new Map(
    (newEvents || []).map(
      x => [x.agattId, x]
    )
  );

  const added = [];
  const removed = [];
  const modified = [];

  for (
    const [id, now]
    of newMap
  ) {
    const before =
      oldMap.get(id);

    if (!before) {
      added.push(now);
    } else if (
      !same(before, now)
    ) {
      modified.push({
        before,
        after: now,
      });
    }
  }

  for (
    const [id, before]
    of oldMap
  ) {
    if (!newMap.has(id)) {
      removed.push(before);
    }
  }

  return {
    added,
    removed,
    modified,
  };
}

function countChanges(ch) {
  return (
    ch.added.length +
    ch.removed.length +
    ch.modified.length
  );
}

function label(x) {
  return (
    `${frDate(x.date)} : ` +
    `${x.summary || "Planning SDIS"}` +
    ` [${x.code}]`
  );
}

function formatChanges(ch) {
  const out = [];

  if (ch.modified.length) {
    out.push("MODIFIE :");

    for (
      const x of ch.modified
    ) {
      out.push(
        `- ${label(x.before)} -> ${label(x.after)}`
      );
    }

    out.push("");
  }

  if (ch.added.length) {
    out.push("AJOUTE :");

    for (
      const x of ch.added
    ) {
      out.push(
        `- ${label(x)}`
      );
    }

    out.push("");
  }

  if (ch.removed.length) {
    out.push("SUPPRIME :");

    for (
      const x of ch.removed
    ) {
      out.push(
        `- ${label(x)}`
      );
    }

    out.push("");
  }

  return out.join("\n").trim();
}

async function beforeMode() {
  const state = loadState();
  const before =
    await currentAgattGoogleEvents();

  if (!DRY_RUN) fs.writeFileSync(
    BEFORE,
    JSON.stringify({
      capturedAt:
        new Date().toISOString(),
      previousInitialized:
        state.initialized,
      previous:
        state.events || [],
      before,
    }, null, 2),
    "utf8"
  );

  console.log(
    `AGATT avant synchro : ${before.length} evenement(s).`
  );
}

async function afterMode() {
  const state = loadState();
  const pre = readFreshSnapshot(BEFORE, DRY_RUN);

  const after =
    await currentAgattGoogleEvents();

  let previous =
    state.events || [];

  let before =
    previous;

  if (
    pre &&
    Array.isArray(
      pre.previous
    ) &&
    Array.isArray(
      pre.before
    )
  ) {
    previous =
      pre.previous;

    before =
      pre.before;
  }

  const externalChanges =
    diff(
      previous,
      before
    );

  const botChanges =
    diff(
      before,
      after
    );

  const externalCount =
    countChanges(
      externalChanges
    );

  const botCount =
    countChanges(
      botChanges
    );

  if (
    state.initialized &&
    (
      externalCount > 0 ||
      botCount > 0
    )
  ) {
    const sections = [
      "Le planning AGATT / Google a change.",
      "",
    ];

    if (
      externalCount > 0
    ) {
      sections.push(
        `CHANGEMENT(S) CONSTATE(S) AVANT SYNCHRO : ${externalCount}`,
        formatChanges(
          externalChanges
        ),
        ""
      );
    }

    if (
      botCount > 0
    ) {
      sections.push(
        `ACTION(S) AUTOMATIQUE(S) AGATT : ${botCount}`,
        formatChanges(
          botChanges
        ),
        ""
      );
    }

    sections.push(
      `Controle : ${nowFr()}`
    );

    await sendMail(
      "\u2705 Planning SDIS mis \u00e0 jour",
      sections.join("\n")
    );
  } else if (
    !state.initialized
  ) {
    await sendMail(
      "\u2705 AGATT : contr\u00f4le initialis\u00e9",
      `La r\u00e9f\u00e9rence AGATT a \u00e9t\u00e9 enregistr\u00e9e.\n\n` +
      `\u00c9v\u00e9nements AGATT suivis : ${after.length}\n` +
      `Contr\u00f4le : ${nowFr()}`,
      false
    );
  } else {
    await sendMail(
      "\u2705 AGATT : contr\u00f4le OK",
      `Le contr\u00f4le AGATT s'est termin\u00e9 correctement.\n\n` +
      `\u00c9v\u00e9nements AGATT suivis : ${after.length}\n` +
      `Aucune modification d\u00e9tect\u00e9e.\n\n` +
      `Contr\u00f4le : ${nowFr()}`,
      false
    );
  }

  saveState({
    initialized: true,
    checkedAt:
      new Date().toISOString(),
    events: after,
  });

  try {
    if (!DRY_RUN) fs.unlinkSync(BEFORE);
  } catch {}

  console.log(
    `AGATT : avant=${externalCount}, bot=${botCount}.`
  );
}

async function main() {
  const mode =
    process.argv[2] ||
    "after";

  if (mode === "before") {
    await beforeMode();
  } else {
    await afterMode();
  }
}

main().catch(async e => {
  console.error(
    "Erreur surveillance AGATT :",
    e
  );

  if (
    (process.argv[2] || "after") !==
    "before"
  ) {
    try {
      await sendMail(
        "\u26a0\ufe0f Erreur surveillance AGATT",
        `Le contr\u00f4le AGATT a rencontr\u00e9 une erreur :\n\n${e.message || String(e)}`
      );
    } catch {}
  }

  process.exit(1);
});
