// BUILD-79 Part 0 — the fails-first record. Imports steward-messy-2500-v2.csv
// (a report export: title line, generated-by, blank, header on line 4, repeated
// headers, page lines, TOTAL row) into a FRESH org through the real UI and
// captures what the product does today: header taken from line 1, shape
// "aggregate", $0 imported, green Balanced check, Sep-2026 last gifts, score 35,
// phone numbers in Needs Your Attention, checklist ticked, export.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build79-repro.js
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = process.env.FIXTURE || (process.env.HOME + "/Downloads/steward-messy-2500-v2.csv");
const OUT = process.env.HOME + "/nonprofit-erp/docs/build79/repro";
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const EMAIL = `b79repro_${stamp}@test.local`, PASS = "loadtest1234";

const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

(async () => {
  // fresh org through the API (the walk's subject is the IMPORT UI)
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B79 Repro " + stamp, userName: "B79 Walker", email: EMAIL, password: PASS }) }).then(r => r.json());
  if (!r.token) { console.error("register failed", r); process.exit(1); }
  const token = r.token, org = r.org, user = r.user;
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: "{}" });
  org.onboarding_complete = 1;
  note("fresh org:", org.id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on("pageerror", e => note("  [pageerror]", e.message));
  page.on("dialog", d => d.dismiss().catch(() => {}));
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t);
    localStorage.setItem("npe_user", u);
    localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(user), JSON.stringify(org)]);

  const shot = async name => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); note("shot:", name); };
  const buttons = async () => (await page.$$eval("button", bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0, 60)))).filter(Boolean);

  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('nav button:has-text("Donors"), button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Import & tools")').catch(async e => { note("no Import & tools:", e.message); note("visible buttons:", JSON.stringify(await buttons())); });
  await page.waitForTimeout(600);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(800);
  const fileInput = await page.$('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);
  await page.waitForTimeout(4000);

  note("=== MAPPER STATE ===");
  let body = await page.innerText("body");
  for (const pat of [/we (found|detected)[^.]*/i, /\b[\d,]+ rows?\b[^.]{0,60}/g, /one row per donor[^.]{0,80}/i, /individual gifts[^.]{0,60}/i]) {
    const m = body.match(pat); if (m) note("  mapper text:", JSON.stringify(Array.isArray(m) ? m.slice(0, 6) : m[0]));
  }
  note("  buttons:", JSON.stringify(await buttons()));
  await shot("01-mapper-1440");
  fs.writeFileSync(OUT + "/mapper-body.txt", body);

  // Jonathan clicked Auto-map and took what it gave him
  await page.click('button:has-text("Auto-map")');
  await page.waitForTimeout(2000);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/mapper-automapped-body.txt", body);
  let impBtn = await page.$('button:has-text("Import"):visible');
  note("  after Auto-map, import button reads:", JSON.stringify(impBtn ? (await impBtn.textContent()).trim() : null));
  await shot("02-automapped-1440");

  // Prod's AI auto-map (Sentry-era run) chose: First Name → first name,
  // Spouse → last name, Phone → email, Frequency → last gift. No local API
  // key, so re-apply the same mapping through the same selects the customer
  // saw and accepted. Column order in the file: 0 Constituent ID, 1 Name,
  // 2 First Name, 3 Last Name, 4 Spouse, 5 Email, 6 Phone, ... 18 Frequency.
  const sels = await page.$$(".fullscreen-takeover select, [class*=modal] select, select");
  note("  mapper select count:", sels.length);
  if (sels.length) {
    const opts = await sels[0].$$eval("option", os => os.map(o => o.value));
    note("  select options:", JSON.stringify(opts));
    const setSel = async (i, v) => { if (sels[i]) { await sels[i].selectOption(v).catch(e => note("  setSel fail", i, v, e.message)); } };
    // sels[0] is the shape select; sels[i] is file column i-1.
    await setSel(3, "_firstName");  // col 2  First Name
    await setSel(5, "_lastName");   // col 4  Spouse
    await setSel(7, "email");       // col 6  Phone
    await setSel(19, "lastGift");   // col 18 Frequency
    await page.waitForTimeout(1200);
    impBtn = await page.$('button:has-text("Import"):visible');
    note("  after prod mapping, import button reads:", JSON.stringify(impBtn ? (await impBtn.textContent()).trim() : null));
    await shot("03-prod-mapping-1440");
  }

  // walk forward: accept whatever the product proposes, like a hurried ED would
  const FORWARD = ["Looks right", "Continue", "Next", "Review", "Preview", "Import", "Start import", "Import everything", "Confirm"];
  for (let stepN = 4; stepN <= 8; stepN++) {
    let clicked = null;
    for (const label of FORWARD) {
      const btn = await page.$(`button:has-text("${label}"):visible`);
      if (btn && !(await btn.isDisabled())) { clicked = await btn.textContent(); await btn.click(); break; }
    }
    if (!clicked) { note("no forward button found; visible:", JSON.stringify(await buttons())); break; }
    note(`clicked: ${clicked.trim()}`);
    await page.waitForTimeout(1000);
    // if a checkbox acknowledgement blocks, tick every checkbox and retry once
    const body2 = await page.innerText("body");
    await shot(`0${stepN}-after-${clicked.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}`);
    if (/imported|Balanced|accounted/i.test(body2) && /donors/i.test(body2) && stepN > 2) {
      // maybe we've reached the result screen
      if (await page.$('text=/EVERY ROW|Balanced|imported with warnings/i')) { note("reached result screen"); break; }
    }
    // long import: wait for network to settle
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle").catch(() => {});
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/summary-body.txt", body);
  note("=== SUMMARY STATE ===");
  for (const pat of [/EVERY ROW[^·]*/i, /Balanced[^.]{0,80}/i, /In your file[^.]{0,80}/i, /[\d,]+ imported[^.]{0,60}/gi, /warnings?[^.]{0,60}/i]) {
    const m = body.match(pat); if (m) note("  summary text:", JSON.stringify(Array.isArray(m) ? m.slice(0, 6) : m[0]));
  }
  note("  buttons:", JSON.stringify(await buttons()));
  await shot("07-summary-1440");

  // close modal, donor list
  const close = await page.$('button:has-text("Done"):visible, button:has-text("Close"):visible');
  if (close) await close.click();
  await page.waitForTimeout(2000);
  await shot("08-donorlist-1440");

  // API-side truth for the record
  const j = (p) => fetch(API + p, { headers: { Authorization: "Bearer " + token } }).then(r => r.json());
  note("=== DB TRUTH (psql) ===");
  const { execSync } = require("child_process");
  const sql = q => execSync(`psql -h localhost -p 5544 -U steward steward_loadtest -t -A -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
  note("  donors:", sql(`SELECT count(*) FROM donors WHERE org_id='${org.id}'`));
  note("  gifts:", sql(`SELECT count(*), coalesce(sum(amount),0) FROM gifts WHERE org_id='${org.id}'`));
  note("  sum(donors.total):", sql(`SELECT coalesce(sum(total_giving),0) FROM donors WHERE org_id='${org.id}'`));
  note("  last_gift_date null / sep2026 / other:", sql(`SELECT count(*) FILTER (WHERE last_gift_date IS NULL), count(*) FILTER (WHERE last_gift_date::text LIKE '2026-09%'), count(*) FILTER (WHERE last_gift_date IS NOT NULL AND last_gift_date::text NOT LIKE '2026-09%') FROM donors WHERE org_id='${org.id}'`));
  note("  phone-shaped names:", sql(`SELECT count(*) FROM donors WHERE org_id='${org.id}' AND name ~ '^\\(?[0-9]{3}\\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}$'`));
  note("  sample phone-named:", sql(`SELECT name FROM donors WHERE org_id='${org.id}' AND name ~ '^\\(?[0-9]{3}\\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}$' LIMIT 6`));
  note("  sample names:", sql(`SELECT name FROM donors WHERE org_id='${org.id}' ORDER BY name LIMIT 10`));

  // home: needs attention, drift, checklist
  await page.goto(APP + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/home-body.txt", body);
  for (const pat of [/Needs Your Attention[^]{0,200}/i, /drift[^.]{0,120}/i, /giving patterns checked[^.]{0,40}/i, /Import your donors[^.]{0,60}/i]) {
    const m = body.match(pat); if (m) note("  home text:", JSON.stringify(String(m[0]).replace(/\s+/g, " ").slice(0, 200)));
  }
  await shot("09-home-1440");

  // export through the API exactly as the UI does
  const ex = await fetch(API + "/donors/export/csv", { headers: { Authorization: "Bearer " + token } });
  note("=== EXPORT === status:", ex.status);
  const exBody = await ex.text();
  note("  export bytes:", exBody.length, "first line:", JSON.stringify(exBody.split("\n")[0].slice(0, 120)));
  if (ex.status !== 200) note("  export error body:", exBody.slice(0, 300));

  fs.writeFileSync(OUT + "/repro-log.txt", log.join("\n"));
  note("org for later inspection:", org.id, EMAIL);
  await browser.close();
})();
