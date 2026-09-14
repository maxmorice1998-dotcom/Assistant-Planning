const runtime = require("./runtime-config");
runtime.prepare();
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const DIR = runtime.dataDir;
const QUEUE = path.join(DIR, ".combined-mail-queue.jsonl");
const ALERT = runtime.alert();

function nowFr() {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(new Date());
}

function readQueue() {
  if (!fs.existsSync(QUEUE)) return [];

  return fs.readFileSync(QUEUE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); }
      catch { throw new Error("File de mails invalide : conservee pour diagnostic."); }
    })
    .filter(Boolean);
}

async function main() {
  const items = readQueue();

  if (!items.length) {
    console.log("MAIL-UNIQUE : aucun message a envoyer.");
    return;
  }

  if (!runtime.hasSecret("smtp") || !/^\S+@\S+\.\S+$/.test(String(ALERT.smtpUser || "")) || !/^\S+@\S+\.\S+$/.test(String(ALERT.to || ""))) {
    console.log("Mail récapitulatif : non configuré — ignoré");
    return;
  }

  const agatt = items.filter(x => x.source === "AGATT");
  const dendreo = items.filter(x => x.source === "DENDREO");

  const alertWords = /erreur|conflit|attention|changement|mis à jour|mis a jour/i;
  const important = process.env.SDIS_RUN_FAILED === "1" || !agatt.length || !dendreo.length || items.some(
    x => alertWords.test(String(x.subject || "")) ||
         false
  );

  const subject = important
    ? "🔔 SDIS-BOT : compte rendu AGATT + Dendreo"
    : "✅ SDIS-BOT : AGATT + Dendreo OK";

  const sections = [
    "Compte rendu du contrôle automatique SDIS-BOT.",
    "",
  ];

  function addSection(title, arr) {
    sections.push(`===== ${title} =====`);

    if (!arr.length) {
      sections.push("Aucun compte rendu disponible pour cette partie.", "");
      return;
    }

    arr.forEach((x, i) => {
      if (arr.length > 1) sections.push(`--- Information ${i + 1} ---`);
      if (x.subject) sections.push(x.subject);
      if (x.text) sections.push(x.text);
      sections.push("");
    });
  }

  if (process.env.SDIS_RUN_FAILED === "1") sections.push("ATTENTION : controle partiel ou en echec. Consulter planning-status.txt.", "");
  addSection("AGATT", agatt);
  addSection("DENDREO", dendreo);

  sections.push(`Contrôle global : ${nowFr()}`);

  if (process.argv.includes("--dry-run")) { console.log("TEST MAIL-UNIQUE :", subject, "messages=" + items.length); return; }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    pool: false,
    auth: {
      user: ALERT.smtpUser,
      pass: runtime.smtpPassword(),
    },
  });

  try {
    await transporter.sendMail({
      from: ALERT.smtpUser,
      to: ALERT.to,
      subject,
      text: sections.join("\n"),
    });

    console.log("MAIL-UNIQUE envoye :", subject);

    try { fs.unlinkSync(QUEUE); } catch {}
  } catch (error) {
    console.error("⚠ Synchronisation terminée, mais l'envoi du récapitulatif a échoué.");
  } finally {
    try { transporter.close(); } catch {}
  }
}

main().catch(err => {
  console.error("Erreur MAIL-UNIQUE :", err);
  process.exit(1);
});
