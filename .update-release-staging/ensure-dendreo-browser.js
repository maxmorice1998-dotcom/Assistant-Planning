const runtime = require("./runtime-config");
runtime.prepare();
const puppeteer = require("./browser-client");
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");

const DEBUG_PORT = 19223;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const BASE_URL = "https://formation.pompiers-14.org/";
const CHROME = runtime.browserExe();
const PROFILE = runtime.profile("dendreo");

const sleep = ms => new Promise(r => setTimeout(r, ms));

function portAlive() {
  return new Promise(resolve => {
    const req = http.get(`${DEBUG_URL}/json/version`, { timeout: 1500 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(seconds = 25) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await portAlive()) return true;
    await sleep(750);
  }
  return false;
}

function launchChrome() { throw new Error("Ouvrez la connexion Dendreo dans l assistant."); }

function isDendreo(url) {
  return String(url || "").includes("formation.pompiers-14.org");
}

async function findAgendaLink(page) {
  return page.evaluate(() => {
    const links = [...document.querySelectorAll("a[href]")];
    const agenda = links.find(a => {
      const h = a.href || a.getAttribute("href") || "";
      return /\/agenda(?:[?#]|$)/i.test(h);
    });
    return agenda ? agenda.href : null;
  });
}

async function main() {
  console.log("=== Verification navigateur Dendreo ===");

  if (!(await portAlive())) {
    console.log("Port 19223 absent : lancement de Chrome Dendreo...");
    launchChrome();

    if (!(await waitForPort())) {
      throw new Error("Chrome Dendreo lance mais port 19223 toujours inaccessible.");
    }
  } else {
    console.log("Port 19223 : OK");
  }

  const browser = await puppeteer.connect({ browserURL: DEBUG_URL });

  try {
    let pages = await browser.pages();

    let agenda = pages.find(p =>
      isDendreo(p.url()) && p.url().includes("/agenda")
    );

    if (agenda) {
      console.log("Agenda Dendreo deja ouvert : OK");
      return;
    }

    let page = pages.find(p => isDendreo(p.url()));

    if (!page) {
      console.log("Aucun onglet Dendreo : ouverture automatique...");
      page = await browser.newPage();
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await sleep(1500);
    } else {
      console.log("Onglet Dendreo trouve, recherche de l'agenda...");
      if (page.url() === "about:blank") {
        await page.goto(BASE_URL, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
        await sleep(1500);
      }
    }

    // A login/session redirect can take a moment.
    for (let i = 0; i < 5; i++) {
      if (page.url().includes("/agenda")) {
        console.log("Agenda Dendreo ouvert : OK");
        return;
      }

      const href = await findAgendaLink(page).catch(() => null);

      if (href) {
        await page.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
        await sleep(1000);

        if (page.url().includes("/agenda")) {
          console.log("Agenda Dendreo ouvert automatiquement : OK");
          return;
        }
      }

      await sleep(1000);
    }

    // Final attempt from the home page, useful if the existing tab was stale.
    if (!page.url().includes("/agenda")) {
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await sleep(1500);

      const href = await findAgendaLink(page).catch(() => null);

      if (href) {
        await page.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
        await sleep(1000);
      }
    }

    if (!page.url().includes("/agenda")) {
      throw new Error(
        "Session Dendreo non reconnue ou lien Agenda introuvable. Chrome a ete ouvert pour permettre une reconnexion."
      );
    }

    console.log("Agenda Dendreo ouvert automatiquement : OK");
  } finally {
    await browser.disconnect();
  }
}

main().catch(err => {
  console.error("Erreur navigateur Dendreo :", err.message || err);
  process.exit(1);
});
