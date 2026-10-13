// docs/live-1/walk.js · LIVE-1 · the Muse walk, in a real browser, at 1440 and 390.
//
// On a fresh local org at each width: import steward-test-1000-donors-messy.csv
// through Import + History; read the readout; open What changed and take two of
// its actions; import a second month's file with the same headers and see it
// map itself; the Thread row on Home; What changed again; Ask "who came back
// this month?"; then undo the second import. Screenshots to docs/live-1/.
//
//   API=http://localhost:6461 APP=http://localhost:6463 DATABASE_URL=… \
//   MESSY=~/Downloads/steward-test-1000-donors-messy.csv SECOND=/path/second-month.csv \
//   PLAYWRIGHT_DIR=$HOME/steward-qa node docs/live-1/walk.js
const path = require("path");
const bcrypt = require(path.join(__dirname, "..", "..", "node_modules", "bcryptjs"));
const { Client } = require(path.join(__dirname, "..", "..", "node_modules", "pg"));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const API = process.env.API || "http://localhost:6461";
const APP = process.env.APP || "http://localhost:6463";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("This walk is loopback only.");
const OUT = __dirname;
const MESSY = process.env.MESSY, SECOND = process.env.SECOND;
let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : ": " + String(JSON.stringify(detail) ?? "").slice(0, 300))); if (!cond) failures++; };

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await db.connect();
  const q = (s, a) => db.query(s, a).then(r => r.rows);
  const browser = await chromium.launch();
  for (const [w, h] of [[1440, 980], [390, 844]]) {
    console.log(`\n── ${w} ──`);
    const RUN = Date.now().toString(36);
    const ORG = "org_l1walk_" + RUN, EMAIL = `walk-${RUN}@live1.local`, PW = "loadtest1234";
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Riverbend Music School','riverbend-' || $2,1,'active','team')`, [ORG, RUN]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_l1walk_' || $4,$1,$2,$3,'Maya Ortiz','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 10), RUN]);
    const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) }).then(r => r.json());
    const auth = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const org = (await api("GET", "/org")).body;

    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel|\/ai\/stream/.test(m.location()?.url || "") && !/\[SW\]|status of 503/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() >= 500 && !/\/ai\/stream$/.test(r.url())) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "")}`); });
    const shot = (name, full = false) => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: full });
    const settle = (ms = 700) => page.waitForLoadState("networkidle").catch(() => {}).then(() => page.waitForTimeout(ms));
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", JSON.stringify(u)); localStorage.setItem("npe_org", JSON.stringify(o)); }, [login.token, login.user, org]);
    const open = async url => { await page.goto(APP + url, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".app-root", { timeout: 25000 }); await settle(900);
      const later = page.locator("button").filter({ hasText: /I'll finish later/ }).first(); if (await later.count()) { await later.click().catch(() => {}); await settle(300); } };

    // ── an import through the real screen ──────────────────────────────
    const importFile = async (file, tag) => {
      await open("/donors");
      const menu = page.locator('button[aria-haspopup="menu"]').filter({ hasText: /Import/ }).first();
      await menu.click(); await settle(300);
      await page.locator('[role="menu"] [role="menuitem"]').filter({ hasText: /Import \+ History/ }).first().click(); await settle(800);
      const skip = page.locator('[data-testid="move-skip"]'); if (await skip.count()) { await skip.click(); await settle(500); }
      await page.locator('input[type="file"]').first().setInputFiles(file);
      const go = page.locator('[role="dialog"] button').filter({ hasText: /^Import [\d,]+ donor/ }).first();
      await go.waitFor({ timeout: 30000 });
      await settle(1500);
      // A date column that mixes conventions is a question, never a guess:
      // this file is a US export, month first.
      const mdy = page.locator('[role="dialog"] button').filter({ hasText: /^Month \/ Day \/ Year$/ }).first();
      if (await mdy.count()) { await mdy.click(); await settle(400); }
      // Decisions the file needs before Import is allowed (a column Steward
      // has no home for): keep each as a note on the person, the safe answer.
      for (let i = 0; i < 40 && await go.isDisabled(); i++) {
        const keep = page.locator('[role="dialog"] button').filter({ hasText: /^Store it$/ }).first();
        if (!(await keep.count())) break;
        await keep.click(); await settle(200);
      }
      if (await go.isDisabled()) console.log("    still disabled: " + (await page.locator('[role="dialog"]').innerText()).replace(/\s+/g, " ").slice(0, 1500));
      return go;
    };

    const go1 = await importFile(MESSY, "first");
    const ty1 = page.locator('[data-testid="import-thankyou-preview"]');
    ok("1 the preview says how many thank-yous the file will draft, before saving", await ty1.count() > 0, await ty1.innerText().catch(() => ""));
    if (await ty1.count()) await ty1.scrollIntoViewIfNeeded();
    await shot("1-preview");
    await go1.click();
    const ro1 = page.locator('[data-testid="import-readout"]');
    await ro1.waitFor({ timeout: 180000 }).catch(() => {});
    ok("1 the result screen says what the file told us", await ro1.count() > 0, await page.locator('[role="dialog"]').innerText().catch(() => "").then(t => t.slice(0, 300)));
    if (await ro1.count()) await ro1.scrollIntoViewIfNeeded();
    await shot("2-readout-on-result");
    console.log("    readout: " + (await ro1.innerText().catch(() => "")).replace(/\s+/g, " "));

    // ── What changed, and two actions ─────────────────────────────────
    await open("/app/agent?view=changed");
    const lines = page.locator('[data-testid^="readout-line-"]');
    ok("2 What changed shows the readout's lines", await lines.count() > 0, await lines.count());
    await shot("3-what-changed");
    const acts = page.locator('[data-testid^="readout-act-"]');
    let took = 0;
    for (let i = 0; i < await acts.count() && took < 2; i++) {
      const b = acts.nth(i); const id = await b.getAttribute("data-testid");
      if (/crossed_group|data_problems/.test(id)) continue;
      await b.click(); await settle(1200); took++;
    }
    const said = page.locator('[data-testid^="readout-said-"]');
    ok("2 two actions taken, each saying what it made", took === 2 && await said.count() >= 2, { took, said: await said.allInnerTexts().catch(() => []) });
    const why = page.locator('[data-testid^="readout-why-"]').first();
    if (await why.count()) { await why.click(); await settle(300); }
    await shot("4-two-actions");
    const tasks = await q(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1`, [ORG]);
    const drafts = await q(`SELECT COUNT(*)::int n FROM thank_you_drafts WHERE org_id=$1`, [ORG]);
    console.log(`    after the actions: ${tasks[0].n} tasks, ${drafts[0].n} thank-you drafts`);

    // ── the second month's file maps itself ─────────────────────────────
    const go2 = await importFile(SECOND, "second");
    const mem = page.locator('[data-testid="import-shape-memory"]');
    ok("3 the second file with the same headers maps itself", await mem.count() > 0, await page.locator('[role="dialog"]').innerText().catch(() => "").then(t => t.slice(0, 300)));
    if (await mem.count()) await mem.scrollIntoViewIfNeeded();
    await shot("5-maps-itself");
    const vals = page.locator('[data-testid="import-value-answers"]');
    if (await vals.count()) {
      const box = vals.locator("input").first(); await box.fill("Check"); await settle(200);
      await vals.scrollIntoViewIfNeeded(); await shot("5b-value-answer");
    }
    await go2.click();
    const ro2 = page.locator('[data-testid="import-readout"]');
    await ro2.waitFor({ timeout: 120000 }).catch(() => {});
    ok("3 the second file's readout", await ro2.count() > 0);
    const ro2Text = (await ro2.innerText().catch(() => "")).replace(/\s+/g, " ");
    console.log("    readout: " + ro2Text);
    ok("3 it found the lapsed donors who came back and the biggest gifts", /came back/.test(ro2Text) && /biggest gift ever/.test(ro2Text), ro2Text);
    if (await ro2.count()) await ro2.scrollIntoViewIfNeeded();
    await shot("6-second-readout");
    const undoBtn = page.locator('[data-testid="import-undo"]');
    ok("3 the result offers Undo this import", await undoBtn.count() > 0);

    // ── the Thread row on Home, What changed, Ask ───────────────────────
    await open("/dashboard");
    const row = page.locator('[data-testid="home-readout-row"]');
    ok("4 the readout is one row on the Thread", await row.count() === 1, await row.count());
    await shot("7-home-thread-row");
    await open("/app/agent?view=changed");
    ok("4 What changed keeps both readouts by date", await page.locator('[data-testid="readout"]').count() === 2, await page.locator('[data-testid="readout"]').count());
    await shot("8-what-changed-both");
    await open("/dashboard");
    const ask = page.locator('[data-testid="ask-hero-input"]').first();
    if (await ask.count()) {
      await ask.fill("who came back this month?"); await ask.press("Enter"); await settle(2500);
      const body = await page.locator("body").innerText();
      ok("4 Ask answers 'who came back this month?' from the readout", /lapsed donors? came back in/.test(body), body.slice(0, 200));
      await shot("9-ask-came-back");
    } else ok("4 the Ask box is on Home", false);

    // ── undo the second import ───────────────────────────────────────────
    const imps = (await api("GET", "/imports")).body;
    const list = Array.isArray(imps) ? imps : (imps.imports || []);
    const second = list.find(x => x.source_filename && /second-month/.test(x.source_filename)) || list[0];
    const u = await api("POST", `/imports/${second.id}/reverse`, {});
    ok("5 the second import undoes in one step", u.status === 200 && u.body.reversed === true, u.body);
    console.log("    " + (u.body.sentence || ""));
    await open("/app/agent?view=changed");
    ok("5 its readout is gone from What changed", await page.locator('[data-testid="readout"]').count() === 1);
    await shot("10-after-undo");

    ok(`no console errors or 5xx at ${w}`, errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
  await browser.close();
  await db.end();
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
