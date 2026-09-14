const runtime = require("./runtime-config");
runtime.prepare();
const puppeteer = require("./browser-client");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TARGET = "https://agatt.sdis14.fr/register/index.php?a=gardeExercice";

(async () => {
  const browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:19222"
  });

  let pages = await browser.pages();
  let page =
    pages.find(p => p.url().includes("agatt.sdis14.fr")) ||
    pages.find(p => p.url().includes("auth.sdis14.fr")) ||
    pages.find(p => p.url().startsWith("http"));

  if (!page) page = await browser.newPage();

  console.log("Ouverture AGATT...");
  await page.goto(TARGET, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  }).catch(() => {});

  await sleep(1500);

  if (page.url().includes("auth.sdis14.fr")) {
    console.log("Page authentification SDIS detectee.");

    let clicked = false;

    for (let i = 0; i < 20 && !clicked; i++) {
      try {
        clicked = await page.evaluate(() => {
          const els = [
            ...document.querySelectorAll(
              'button,a,input[type="submit"],input[type="button"],[role="button"]'
            )
          ];

          const label = el =>
            (
              el.innerText ||
              el.textContent ||
              el.value ||
              el.getAttribute("aria-label") ||
              ""
            ).trim().toLowerCase();

          const btn = els.find(el => label(el).includes("se connecter"));

          if (btn) {
            btn.click();
            return true;
          }

          return false;
        });
      } catch {}

      if (!clicked) await sleep(1000);
    }

    if (clicked) {
      console.log("Connexion AGATT cliquee.");
    } else {
      console.log("Bouton Se connecter non trouve, attente du retour AGATT...");
    }

    let agatt = null;

    for (let i = 0; i < 60; i++) {
      pages = await browser.pages();
      agatt = pages.find(p => p.url().includes("agatt.sdis14.fr"));

      if (agatt) break;
      await sleep(1000);
    }

    if (!agatt) {
      console.error("AGATT non atteint apres authentification. Sync annulee.");
      await browser.disconnect();
      process.exit(2);
    }

    page = agatt;
  }

  if (!page.url().includes("agatt.sdis14.fr")) {
    console.error("La page AGATT n'est pas ouverte. Sync annulee.");
    await browser.disconnect();
    process.exit(3);
  }

  console.log("AGATT detecte :", page.url());
  console.log("Ouverture du planning...");

  await page.goto(TARGET, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  }).catch(err => console.log("Navigation planning :", err.message));

  let cellCount = 0;

  for (let i = 0; i < 30; i++) {
    if (page.url().includes("auth.sdis14.fr")) {
      console.error("Retour vers authentification. Sync annule.");
      await browser.disconnect();
      process.exit(4);
    }

    try {
      cellCount = await page.evaluate(
        () => document.querySelectorAll("div.c").length
      );
    } catch {}

    if (cellCount > 0) break;
    await sleep(1000);
  }

  if (cellCount === 0) {
    console.error("Planning charge mais aucune cellule div.c trouvee. Sync annulee.");
    console.error("URL :", page.url());
    await browser.disconnect();
    process.exit(5);
  }

  pages = await browser.pages();
  for (const p of pages) {
    if (p === page) continue;
    const u = p.url();
    if (u.includes("agatt.sdis14.fr") || u.includes("auth.sdis14.fr")) {
      try { await p.close(); } catch {}
    }
  }

  console.log("Planning AGATT pret :", cellCount, "cellules");
  console.log("URL :", page.url());

  await browser.disconnect();
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});

