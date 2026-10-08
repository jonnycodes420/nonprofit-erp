// docs/import-2/walk.js: IMPORT-2 · the walk, in a real browser, at 1440 and 390.
//
// On a fresh local org: the 1,000-donor file goes in through the real import
// route, then in the browser: a profile with no history yet; Donors, Import &
// tools, Bring your notes and history; the notes file; the preview with its
// preferences, unmatched and day-first lists; confirm; bring it in; undo all of
// it; bring it in again; three donors' history; an imported open task on the
// Calendar; Ask "what did we talk about with …". Screenshots to docs/import-2/.
//
//   API=http://localhost:5761 APP=http://localhost:5764 DATABASE_URL=… DB_SSL=disable \
//   PLAYWRIGHT_DIR=$HOME/steward-qa node docs/import-2/walk.js
const fs = require("fs");
const path = require("path");
const bcrypt = require(path.join(__dirname, "..", "..", "node_modules", "bcryptjs"));
const { Client } = require(path.join(__dirname, "..", "..", "node_modules", "pg"));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const API = process.env.API || "http://localhost:5761";
const APP = process.env.APP || "http://localhost:5764";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("This walk is loopback only.");
const OUT = __dirname;
const FX = path.join(__dirname, "..", "..", "tests", "fixtures", "import2");
const RUN = Date.now().toString(36);
const ORG = "org_i2walk_" + RUN, EMAIL = `walk-${RUN}@import2.local`, PW = "loadtest1234";
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

function parseCsv(t) {
  const rows = []; let row = [], cell = "", qd = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (qd) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else qd = false; } else cell += c; }
    else if (c === '"') qd = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c; }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await db.connect();
  const q = (s, a) => db.query(s, a).then(r => r.rows);
  for (const t of ["interaction_attachments", "tasks", "interactions", "gifts", "donor_scores", "donor_relationships", "imports", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Riverside Arts Collective','riverside-walk-' || $2,1,'active','team')`, [ORG, RUN]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_i2walk_' || $4,$1,$2,$3,'Sarah Mitchell','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 10), RUN]);
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) }).then(r => r.json());
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const org = (await api("GET", "/org")).body;

  // The donor file, through the real import route.
  const lib = await import(path.join(__dirname, "..", "..", "shared", "importShape.js"));
  const raw = parseCsv(fs.readFileSync(path.join(FX, "steward-test-1000-donors-messy.csv"), "utf8").replace(/^﻿/, "")).slice(1);
  const headers = raw[0].map(h => h.trim());
  const rows = raw.slice(1).filter(r => r.some(c => String(c).trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  const built = lib.buildTransactionRows({ rows }, lib.autoDetectTxMapping(headers, rows.slice(0, 10)), { today: new Date().toISOString().slice(0, 10) });
  const byDonor = new Map(); for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  for (let s = 0; s < built.donors.length; s += 500) {
    const slice = built.donors.slice(s, s + 500); const cg = [];
    slice.forEach((_, li) => (byDonor.get(s + li) || []).forEach(g => { const { donorIndex, ...rest } = g; cg.push({ ...rest, donorIndex: li }); }));
    const r = await api("POST", "/donors/import-combined", { donors: slice, gifts: cg, importId: "imp_walk_donors_" + s });
    if (r.status !== 200) throw new Error("donor import " + r.status);
  }
  const [plain] = await q(`SELECT d.id, d.name FROM donors d WHERE d.org_id=$1 AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.donor_id=d.id AND i.type <> 'gift') ORDER BY d.name LIMIT 1`, [ORG]);

  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel|\/ai\/stream/.test(m.location()?.url || "") && !/\[SW\]|status of 503/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    // /ai/stream answers 503 on a local stack with no model key (the AI switch
    // has nothing to call). That is the environment, not this build.
    page.on("response", r => { if (r.status() >= 500 && !/\/ai\/stream$/.test(r.url())) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = name => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: false });
    const settle = (ms = 700) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));

    // A profile with no history yet: never "0, Distant".
    if (w === 1440 || !(await q(`SELECT 1 FROM imports WHERE org_id=$1 AND shape='history' AND reversed_at IS NULL`, [ORG])).length) {
      await page.goto(APP + "/donors/" + plain.id, { waitUntil: "domcontentloaded" });
      const card = await page.waitForSelector('[data-testid="dp-scores"]', { timeout: 30000 }).catch(() => null);
      await settle();
      if (card) await card.scrollIntoViewIfNeeded();
      ok("a profile with only gifts reads No history yet", card && await card.getAttribute("data-no-history") === "true", null);
      await shot("01-no-history-yet");
    }

    // Donors, Import & tools, Bring your notes and history.
    await page.goto(APP + "/app/donors", { waitUntil: "domcontentloaded" });
    await page.getByText("Import & tools").first().click({ timeout: 30000 });
    await page.getByText("Bring your notes and history").first().click();
    await page.waitForSelector('[data-testid="history-import"]');
    await page.setInputFiles('[data-testid="history-file"]', path.join(FX, "steward-test-notes-messy.csv"));
    await page.waitForSelector('[data-testid="history-summary"]', { timeout: 60000 });
    await settle();
    const summary = await page.textContent('[data-testid="history-summary"]');
    ok("the preview counts 2,420 rows and the three ways they matched", /2,420 rows/.test(summary) && /id 1,910/.test(summary) && /email 239/.test(summary) && /name 251/.test(summary), summary.slice(0, 300));
    await shot("02-preview");
    await page.locator('[data-testid="history-sample"]').scrollIntoViewIfNeeded(); await shot("03-preview-ten-rows");
    await page.locator('[data-testid="history-prefs"]').scrollIntoViewIfNeeded(); await shot("04-preferences-to-confirm");
    await page.locator('[data-testid="history-unmatched"]').scrollIntoViewIfNeeded(); await shot("05-unmatched");
    await page.locator('[data-testid="history-refused"]').scrollIntoViewIfNeeded(); await shot("06-refused-and-day-first");

    if (w === 1440) {
      // Confirm only the DO NOT SOLICIT preferences, create the first unmatched person, bring it in.
      const boxes = page.locator('[data-testid="history-prefs"] input[data-pref="do_not_solicit"]:not([disabled])');
      const n = await boxes.count();
      for (let i = 0; i < n; i++) await boxes.nth(i).check();
      ok("every DO NOT SOLICIT found was ticked by hand", n > 100, n);
      const create = page.locator('[data-testid="history-unmatched"] input[type=checkbox]:not([disabled])').first();
      await create.check();
      await page.click('[data-testid="history-commit"]');
      await page.waitForSelector('[data-testid="history-result"]', { timeout: 120000 });
      await settle();
      ok("it comes in and says what it did", /Brought in/.test(await page.textContent('[data-testid="history-result"]')), null);
      await shot("07-result");
      await page.click('[data-testid="history-undo"]');
      await page.waitForFunction(() => /Undone/.test(document.querySelector('[data-testid="history-result"]')?.textContent || ""), null, { timeout: 60000 });
      await shot("08-undone");
      const [left] = await q(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND metadata->>'source'='history-import')::int ix,
                                     (SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND import_id IS NOT NULL)::int tk`, [ORG]);
      ok("undo leaves no history line and no task behind", left.ix === 0 && left.tk === 0, left);
      // Again, to keep it, so the rest of the walk has history to read.
      await page.keyboard.press("Escape").catch(() => {});
      await page.goto(APP + "/app/donors", { waitUntil: "domcontentloaded" });
      await page.getByText("Import & tools").first().click({ timeout: 30000 });
      await page.getByText("Bring your notes and history").first().click();
      await page.setInputFiles('[data-testid="history-file"]', path.join(FX, "steward-test-notes-messy.csv"));
      await page.waitForSelector('[data-testid="history-summary"]', { timeout: 60000 });
      const b2 = page.locator('[data-testid="history-prefs"] input[data-pref="do_not_solicit"]:not([disabled])');
      for (let i = 0, m = await b2.count(); i < m; i++) await b2.nth(i).check();
      await page.click('[data-testid="history-commit"]');
      await page.waitForSelector('[data-testid="history-result"]', { timeout: 120000 });
      await settle();
    }

    // Three donors' history.
    const three = await q(`SELECT d.id, d.name, COUNT(*)::int n FROM interactions i JOIN donors d ON d.id=i.donor_id
                             WHERE i.org_id=$1 AND i.metadata->>'source'='history-import' GROUP BY d.id, d.name ORDER BY n DESC, d.name LIMIT 3`, [ORG]);
    for (const [i, d] of three.entries()) {
      await page.goto(APP + "/donors/" + d.id, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="dp-scores"]', { timeout: 30000 }).catch(() => {});
      await settle(1200);
      const body = await page.textContent("body");
      ok(`${d.name}'s profile shows their imported history`, !/No history yet/.test(await page.textContent('[data-testid="dp-scores"]').catch(() => "")), null);
      await shot(`09-profile-${i + 1}`);
      if (i === 0) { await page.mouse.wheel(0, 900); await settle(); await shot("10-profile-timeline"); }
      void body;
    }

    // An imported open task on the Calendar.
    const [task] = await q(`SELECT t.id, t.title, t.due FROM tasks t WHERE t.org_id=$1 AND t.import_id IS NOT NULL AND t.due >= to_char(now(),'YYYY-MM-DD') ORDER BY t.due LIMIT 1`, [ORG]);
    await page.goto(APP + "/app/calendar", { waitUntil: "domcontentloaded" });
    await settle(2000);
    if (w < 700 && task) {
      // At phone width the agenda shows one day; tap the task's day.
      const d = new Date(task.due + "T12:00:00Z");
      const dow = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      await page.locator("button", { hasText: new RegExp(`^\\s*${dow}\\s*${d.getUTCDate()}\\s*$`) }).first().click().catch(() => {});
      await settle(800);
    }
    const calText = await page.textContent("body");
    ok("an imported open task is on the Calendar", task && calText.includes(task.title.slice(0, 20)), task);
    await shot("11-calendar-task");

    // Ask.
    const who = three[0];
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    const bar = await page.waitForSelector('[data-testid="ask-hero-input"]', { timeout: 30000 }).catch(() => null);
    if (bar) {
      await page.fill('[data-testid="ask-hero-input"]', `What did we talk about with ${who.name}?`);
      await page.click('[data-testid="ask-hero-go"]');
      await page.waitForFunction(n => document.body.innerText.includes("you had") && document.body.innerText.includes(n), who.name, { timeout: 60000 }).catch(() => {});
      await settle();
      ok(`Ask answers what was talked about with ${who.name}`, /conversations? with/.test(await page.textContent("body")), null);
      await shot("12-ask-what-did-we-talk-about");
    } else ok("the Ask box is on Home", false, null);
    ok(`no console errors or 5xx at ${w}`, errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  await db.end();
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
