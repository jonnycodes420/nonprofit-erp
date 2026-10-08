// scripts/fix34e-capture.js · FIX-34 E: the Tasks walk on local Harborlight.
// A Thank-you task opens its draft; Mark sent drops awaiting thanks by one;
// "Select" shows the boxes; at 390 three bulk selections, three times, with
// every row tap target measured (44 x 44 or more). Writes docs/fix-34/e-*.png.
// Usage: PLAYWRIGHT_DIR=$HOME/steward-qa API=http://localhost:6501 BASE=http://localhost:6510 \
//        DATABASE_URL=... BRIEF_HTML=path node scripts/fix34e-capture.js
const path = require("path");
for (const [k, v] of [["API", process.env.API], ["BASE", process.env.BASE], ["DATABASE_URL", process.env.DATABASE_URL]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));
const { Client } = require("pg");
const API = process.env.API || "http://localhost:6501";
const BASE = process.env.BASE || "http://localhost:6510";
const OUT = path.join(__dirname, "..", "docs", "fix-34");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const awaiting = async () => (await db.query("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id='org_b72demo' AND amount > 0 AND acknowledgement_sent IS NOT TRUE")).rows[0].n;
  const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) })).json();
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` };
  const mk = async (title, extra) => (await (await fetch(`${API}/tasks`, { method: "POST", headers: H, body: JSON.stringify({ title, due: today, priority: "medium", ...extra }) })).json());
  const [donor] = (await db.query(`SELECT d.id, d.name FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id='org_b72demo' AND g.acknowledgement_sent IS NOT TRUE AND d.email IS NOT NULL ORDER BY g.amount DESC LIMIT 1`)).rows;
  await mk(`Thank ${donor.name} for her gift`, { donorId: donor.id, kind: "thank_you" });
  await mk(`Email ${donor.name} the spring report`, { donorId: donor.id, kind: "email" });
  for (const t of ["Order the gala programmes", "Confirm the caterer", "Book the hall for June", "Send the board minutes"]) await mk(t, { kind: "other" });

  const browser = await chromium.launch();
  const open = async (w, h, touch) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!touch, isMobile: !!touch, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(BASE + "/login");
    await page.evaluate(({ token, user, org }) => { localStorage.setItem("npe_token", token); localStorage.setItem("npe_user", JSON.stringify(user)); localStorage.setItem("npe_org", JSON.stringify(org)); }, login);
    await page.goto(BASE + "/app/tasks"); await page.waitForSelector('[data-testid="task-row"]', { timeout: 20000 });
    return { ctx, page, errors };
  };
  const result = { awaiting: {}, walks: [], minTap: null, errors: [] };

  // ── 1440: the draft, Mark sent, the count ──────────────────────────────
  {
    const { ctx, page, errors } = await open(1440, 900, false);
    const sel = await page.locator('[data-testid="task-select"]').count();
    result.boxesHiddenBeforeSelect = sel === 0;
    const row = page.locator('[data-testid="task-row"]', { hasText: `Thank ${donor.name}` }).first();
    await row.locator('[data-testid="task-kind-action"]').click();
    await page.waitForSelector('[data-testid="task-draft"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="draft-body"]') || {}).value, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "e-thank-draft-1440.png") });
    result.awaiting.before = await awaiting();
    await page.click('[data-testid="draft-mark-sent"]');
    await page.waitForTimeout(1200);
    result.awaiting.after = await awaiting();
    await page.screenshot({ path: path.join(OUT, "e-thank-marked-1440.png") });
    await page.click('[data-testid="tasks-select"]');
    await page.screenshot({ path: path.join(OUT, "e-select-1440.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    result.escapeHides = (await page.locator('[data-testid="task-select"]').count()) === 0;
    result.errors.push(...errors); await ctx.close();
  }

  // ── 390: three bulk selections, three times ────────────────────────────
  {
    const { ctx, page, errors } = await open(390, 844, true);
    const sizes = await page.$$eval('[data-testid="task-row"] [data-testid="task-tick"], [data-testid="task-row"] [data-testid="task-kind-action"], [data-testid="task-row"] [data-testid="task-snooze"], [data-testid="task-row"] [data-testid="task-open"], [data-testid="task-row"] [data-testid="task-about"]',
      els => els.map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.testid, w: Math.round(r.width), h: Math.round(r.height) }; }));
    for (let n = 1; n <= 3; n++) {
      await page.locator('[data-testid="tasks-select"]').tap();
      const boxes = page.locator('[data-testid="task-select"]');
      await boxes.first().waitFor();
      const s2 = await boxes.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { id: "task-select", w: Math.round(r.width), h: Math.round(r.height) }; }));
      sizes.push(...s2);
      for (const i of [0, 1, 2]) await boxes.nth(i).tap();
      const txt = await page.locator('[data-testid="tasks-bulk"]').innerText();
      const picked = await page.$$eval('[data-testid="task-select"] input', els => els.filter(e => e.checked).length);
      result.walks.push({ n, bar: /3 selected/.test(txt), picked });
      if (n === 3) await page.screenshot({ path: path.join(OUT, "e-select-three-390.png") });
      await page.locator('[data-testid="bulk-cancel"]').tap();
      await page.waitForTimeout(250);
    }
    result.minTap = sizes.reduce((m, s) => ({ w: Math.min(m.w, s.w), h: Math.min(m.h, s.h) }), { w: 1e9, h: 1e9 });
    result.under44 = sizes.filter(s => s.w < 44 || s.h < 44);
    await page.locator('[data-testid="task-row"]', { hasText: "Email " }).first().locator('[data-testid="task-kind-action"]').tap();
    await page.waitForSelector('[data-testid="task-draft"]'); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "e-email-draft-390.png") });
    result.errors.push(...errors); await ctx.close();
  }

  if (process.env.BRIEF_HTML) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.setContent(fs.readFileSync(process.env.BRIEF_HTML, "utf8"));
      await page.screenshot({ path: path.join(OUT, `e-morning-email-${w}.png`), fullPage: true });
      await ctx.close();
    }
  }
  await browser.close(); await db.end();
  console.log(JSON.stringify(result, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
