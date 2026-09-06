// BUILD-82 Part 0 — REPRODUCE. Fresh org, open steward-messy-25k-v3.xlsx in the
// real importer, capture the three failing screens BEFORE any fix:
//   01 the sheet picker (roles wrong: decoy/chrome offered as data, one gift
//      sheet left behind, inflated row counts)
//   02 the "import both" pre-write summary (1,433 donors from a 25,300-row
//      sheet, 53,900 skipped)
//   03 the legacy gift sheet alone → "Import 0 donors" (no Donor ID target)
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build82-repro.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = process.env.B82_FIXTURE || path.join(process.env.HOME, "Downloads", "steward-messy-25k-v3.xlsx");
const OUT = path.join(__dirname, "..", "docs", "build82", "repro");
fs.mkdirSync(OUT, { recursive: true });

const log = [];
const say = s => { console.log(s); log.push(s); };

(async () => {
  const stamp = Date.now().toString(36);
  const EMAIL = `b82repro_${stamp}@test.local`;
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B82 Repro " + stamp, userName: "B82 Repro", email: EMAIL, password: "loadtest1234" }) }).then(r => r.json());
  if (!r.token) { console.error("register failed", r); process.exit(1); }
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  page.on("pageerror", e => say("  [pageerror] " + e.message));
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(r.user), JSON.stringify(r.org)]);

  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(800);
  say("uploading " + FIXTURE + " …");
  const t0 = Date.now();
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForFunction(() => /sheets with data|Could not read/.test(document.body.innerText), null, { timeout: 240000 });
  say("sheet picker rendered after " + ((Date.now() - t0) / 1000).toFixed(1) + "s");

  // ── SCREEN 1: the sheet picker ──
  let body = await page.innerText("body");
  fs.writeFileSync(OUT + "/01-sheet-picker.txt", body);
  await page.screenshot({ path: OUT + "/01-sheet-picker-1440.png", fullPage: true });
  say("— screen 1 (sheet picker) —");
  say("  sheets offered: " + (body.match(/This workbook has (\d+) sheets/) || [])[1]);
  for (const line of body.split("\n")) if (/rows ·/.test(line) || /sheets with data|Import both|do not use/i.test(line)) say("  | " + line.trim());

  // ── SCREEN 2: the import-both pre-write summary ──
  const t1 = Date.now();
  await page.click('button:has-text("Import both")');
  await page.waitForFunction(() => /gifts →/.test(document.body.innerText), null, { timeout: 300000 });
  await page.waitForTimeout(1000);
  say("import-both summary rendered after " + ((Date.now() - t1) / 1000).toFixed(1) + "s");
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/02-import-both.txt", body);
  await page.screenshot({ path: OUT + "/02-import-both-1440.png", fullPage: true });
  say("— screen 2 (import both pre-write) —");
  for (const line of body.split("\n")) if (/gifts →|skipped|Unmatched|Import [\d,]+ donors|warnings/.test(line)) say("  | " + line.trim());

  // ── SCREEN 3: legacy sheet alone → Import 0 donors ──
  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(600);
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForFunction(() => /sheets with data/.test(document.body.innerText), null, { timeout: 240000 });
  // pick the legacy gift sheet row
  const rows = await page.$$('div:has(> div > button)');
  await page.click('div:has-text("Gifts 2019-2022") >> button:has-text("Select")').catch(async () => {
    // fallback: find button next to the sheet name
    for (const b of await page.$$("button")) {
      const t = await b.evaluate(el => el.parentElement?.previousElementSibling?.textContent || "");
      if (/Gifts 2019-2022/.test(t)) { await b.click(); break; }
    }
  });
  await page.waitForTimeout(4000);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/03-legacy-mapper.txt", body);
  await page.screenshot({ path: OUT + "/03-legacy-mapper-1440.png", fullPage: true });
  say("— screen 3 (legacy sheet alone) —");
  for (const line of body.split("\n")) if (/No rows ready|Import \d+ donors|day\/month|Donor ID|custom|ID/.test(line)) say("  | " + line.trim().slice(0, 160));

  fs.writeFileSync(OUT + "/repro-log.txt", log.join("\n"));
  await browser.close();
  console.log("done — screens in docs/build82/repro/");
})();
