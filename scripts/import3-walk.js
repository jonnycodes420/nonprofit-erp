// scripts/import3-walk.js · IMPORT-3. Allie's event sheet, dropped into an empty org.
//
// At 1440 then 390, on the local stack: Donors → Import & tools → Import +
// History, the event sheet (fake names, the real shape) as "Finding Joy Dinner
// Gifts.xlsx" dated Oct 22, then what Steward understood, the two questions
// answered, the review screen, Import, the result, Undo. Then Import Giving
// History on the same empty org. MODE=before runs the same clicks against a
// main build and photographs what it said. Screenshots: docs/import-3/<mode>-*.png.
//   MODE=after API=http://localhost:5741 APP=http://localhost:5745 \
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_import3 PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/import3-walk.js
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa"), "node_modules", "playwright"));
const API = process.env.API || "http://localhost:5741";
const APP = process.env.APP || "http://localhost:5745";
const DB = process.env.DATABASE_URL || "";
const MODE = process.env.MODE === "before" ? "before" : "after";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", "import-3");
// It creates its own org and imports into it, so it runs only against a local stack.
if (!/^http:\/\/localhost:\d+$/.test(APP) || !/^http:\/\/localhost:\d+$/.test(API) || !/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(DB)
    || process.env.NODE_ENV === "production") { console.error("REFUSED: loopback only."); process.exit(1); }
const ORG = "org_import3walk", EMAIL = "allie@import3walk.test";
const TABLES = ["pledge_installments", "pledges", "thank_you_drafts", "interactions", "gifts", "events", "fin_transactions", "imports",
  "donor_scores", "readouts", "tasks", "donors", "households"];
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { Client } = require("pg");
  const bcrypt = require("bcryptjs");
  const pg = new Client({ connectionString: DB }); await pg.connect();
  const reset = async () => { for (const t of TABLES) await pg.query(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {}); };
  const [have] = (await pg.query("SELECT id FROM orgs WHERE id=$1", [ORG])).rows;
  if (!have) {
    await pg.query(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Justin''s Place (walk)','import3-walk',1,'active','team')`, [ORG]);
    await pg.query(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_import3walk',$1,$2,$3,'Allie Walker','admin')`, [ORG, EMAIL, bcrypt.hashSync("loadtest1234", 4)]);
  }
  // the file as Allie sent it: her file name, modified the night of the dinner
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "import3-walk-"));
  const file = path.join(tmp, "Finding Joy Dinner Gifts.xlsx");
  fs.copyFileSync(path.join(__dirname, "..", "tests", "fixtures", "import", "event-gifts-sheet-scrubbed.xlsx"), file);
  const night = new Date(2026, 9, 22, 21, 30); fs.utimesSync(file, night, night);

  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) }).then(r => r.json());
  if (!login.token) throw new Error("login failed");
  const org = await fetch(API + "/org", { headers: { Authorization: "Bearer " + login.token } }).then(r => r.json());
  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await reset();
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", hasTouch: w < 500, isMobile: w < 500 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource|\[SW\] registration failed/.test(m.text())) errors.push(m.text()); });
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const shot = (name, full) => page.screenshot({ path: path.join(OUT, `${MODE}-${name}-${w}.png`), fullPage: !!full });
    const settle = ms => page.waitForTimeout(ms);
    await page.goto(APP + "/donors", { waitUntil: "domcontentloaded" }); await settle(2500);
    await page.getByRole("button", { name: /Import & tools/ }).click({ timeout: 8000 });
    await page.getByRole("menuitem", { name: /Import \+ History/ }).click({ timeout: 5000 });
    await settle(800);
    const skip = page.locator('[data-testid="move-skip"]');
    if (await skip.count()) { await skip.click(); await settle(500); }
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await settle(3000);
    await shot("1-dropped", true);
    if (MODE === "before") {
      const txt = await page.locator("body").innerText();
      ok(`${w}: before, what the old import said`, true, txt.match(/shape unclear[^\n]*|Continue[^\n]*/g));
      console.log("   said:", JSON.stringify((txt.match(/shape unclear[^\n]*|Continue[^\n]*gift rows[^\n]*/g) || []).slice(0, 3)));
      await ctx.close(); continue;
    }
    const root = page.locator('[data-testid="sheet-import"]');
    ok(`${w}: the event sheet opens the spreadsheet import, not "shape unclear"`, await root.count() === 1 && !/shape unclear/i.test(await page.locator("body").innerText()));
    const understood = await page.locator('[data-testid="sheet-understood"]').innerText().catch(() => "");
    ok(`${w}: it says what it understood`, /A gifts file: Sheet1, 106 rows from row 1/.test(understood), understood);
    ok(`${w}: the total row is checked in words`, /Your total row says \$124,290/.test(understood), understood);
    await page.locator('[data-testid="sheet-question-date"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot("2-understood");
    const eventBtn = page.locator('[data-testid="sheet-date-event"]');
    ok(`${w}: it offers the event by the file's name and date`, /Finding Joy Dinner, Oct 22, 2026/.test(await eventBtn.innerText().catch(() => "")), await eventBtn.innerText().catch(() => ""));
    await eventBtn.click(); await settle(1500);
    await page.getByRole("button", { name: "Paid, a gift" }).click(); await settle(1800);
    const review = await page.locator('[data-testid="sheet-review"]').innerText();
    ok(`${w}: the review shows people, gifts, pledges and the event before anything is written`, /135 people/.test(review) && /\$45,340/.test(review) && /\$104,050/.test(review) && /Finding Joy Dinner/.test(review), review.slice(0, 400));
    await page.locator('[data-testid="sheet-review"]').scrollIntoViewIfNeeded();
    await shot("3-review");
    await shot("3-review-full", true);
    const go = page.locator('[data-testid="sheet-import-go"]');
    ok(`${w}: one Import button, enabled once both questions are answered`, await go.isEnabled());
    await go.click();
    await page.locator('[data-testid="sheet-result"]').waitFor({ timeout: 30000 });
    const result = await page.locator('[data-testid="sheet-result"]').innerText();
    ok(`${w}: imported 63 gifts and 43 pledges for 135 people`, /63 gifts \(\$45,340\), 43 pledges \(\$104,050\), 135 new people/.test(result), result);
    await shot("4-imported");
    const n = (await pg.query("SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS p", [ORG])).rows[0];
    ok(`${w}: the database agrees`, n.g === 63 && n.p === 43, n);
    await page.getByRole("button", { name: "Undo this import" }).click();
    await page.waitForFunction(() => /Undone/.test(document.querySelector('[data-testid="sheet-result"]')?.innerText || ""), null, { timeout: 30000 });
    await shot("5-undone");
    const m = (await pg.query("SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS p, (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS d", [ORG])).rows[0];
    ok(`${w}: Undo removes the whole import`, m.g === 0 && m.p === 0 && m.d === 0, m);
    await page.locator('[data-testid="sheet-done"]').click(); await settle(1000);
    // Import Giving History on an org with nobody to attach to
    await page.getByRole("button", { name: /Import & tools/ }).click({ timeout: 8000 });
    await page.getByRole("menuitem", { name: /Add giving history/ }).click({ timeout: 5000 });
    await settle(1500);
    const plain = page.locator('[data-testid="gi-no-donors"]');
    ok(`${w}: Import Giving History says plainly there is nobody to attach to`, await plain.count() === 1, await page.locator("body").innerText().then(t => t.slice(0, 300)));
    await shot("6-giving-history-empty-org");
    await page.locator('input[type="file"]').first().setInputFiles(file); await settle(3000);
    ok(`${w}: and the file goes to the import that creates the people`, await page.locator('[data-testid="sheet-import"]').count() === 1 && !/0 donors \+ 0 gift rows/.test(await page.locator("body").innerText()));
    await shot("7-giving-history-file");
    ok(`${w}: no page errors`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close(); await pg.end();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
