// scripts/import-walk.js · FIX-55 THE WALK. Drives the real app in a browser
// the way a person would, on a fresh org, with the real-shaped files: import
// the gifts, then the dinner (event name and date, the date box ticked), then
// the contacts; open the first look, Home, the Donors list, three profiles,
// Fundraising, Settings, Imports; undo each import. Every step is
// screenshotted at 1440 and 390, and every screen's text is written beside it
// (walk.json) with what the database holds at that moment, so each number and
// sentence on screen can be checked against what happened.
//
//   BASE=http://localhost:5601 APP_URL=http://localhost:4173 DATABASE_URL=… \
//     node scripts/import-walk.js /path/to/screenshots
//
// Scratch servers only. Writes only its own org, org_walk55. Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { api, q, closeDb, BASE } = require("../tests/helpers");

const OUT = path.resolve(process.argv[2] || "walk-out");
const APP = process.env.APP_URL || "http://localhost:4173";
const FX = path.join(__dirname, "..", "tests", "fixtures", "import", "real-shaped");
const PW = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const ORG = "org_walk55";
const log = [];

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address) VALUES ($1,'Walk Harbor (test)','walk-harbor',1,'active','team','1 Test Way, Testville, TS 00000')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_walk55',$1,'walk55@test.local',$2,'Wren Walker','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 4)]);
  const r = await api("POST", "/auth/login", null, { email: "walk55@test.local", password: "loadtest1234" });
  return r.body;
}
async function truth() {
  const one = async (sql) => (await q(sql, [ORG]))[0];
  return {
    people: (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL")).n,
    gifts: await one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS dollars, COUNT(*) FILTER (WHERE date IS NULL)::int AS undated,
                        COALESCE(SUM(amount) FILTER (WHERE date >= '2026-01-01' AND date <= '2026-12-31'),0)::numeric AS this_year FROM gifts WHERE org_id=$1 AND amount > 0`),
    pledges: await one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS dollars FROM pledges WHERE org_id=$1 AND status='open'`),
    installmentsThisYear: (await one(`SELECT COALESCE(SUM(i.amount),0)::numeric AS s FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id
                                        WHERE i.org_id=$1 AND p.status='open' AND i.paid_gift_id IS NULL AND i.due_date <= '2026-12-31'`)).s,
    imports: (await q("SELECT id, source_filename, gifts_created, donors_created, dollars_created FROM imports WHERE org_id=$1 ORDER BY started_at", [ORG])),
  };
}

let n = 0;
async function shot(pages, name, note) {
  n++;
  const base = `${String(n).padStart(2, "0")}-${name}`;
  const entry = { step: base, note, at: new Date().toISOString(), screens: {} };
  for (const [w, page] of Object.entries(pages)) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${base}-${w}.png`), fullPage: true }).catch(e => { entry.screens[w] = "screenshot failed: " + e.message; });
    const text = await page.evaluate(() => {
      const m = document.querySelector('[role="dialog"]');
      return (m ? m.innerText : document.body.innerText).replace(/\n{2,}/g, "\n").slice(0, 6000);
    }).catch(() => "");
    entry.screens[w] = entry.screens[w] || text;
  }
  entry.truth = await truth();
  log.push(entry);
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(log, null, 1));
  console.log(`  ${base}  ${note || ""}`);
}

(async () => {
  if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("scratch servers only");
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "")) throw new Error("Refused: scratch database only (a loopback DATABASE_URL)");
  fs.mkdirSync(OUT, { recursive: true });
  const login = await freshOrg();
  const browser = await PW.chromium.launch();
  const ctxFor = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(([t, u, g]) => { try { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", g); } catch {} },
      [login.token, JSON.stringify(login.user), JSON.stringify(login.org)]);
    await ctx.route(url => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(String(url)), r => r.abort().catch(() => {}));
    return ctx;
  };
  const wide = await (await ctxFor(1440, 1000)).newPage();
  const narrow = await (await ctxFor(390, 844)).newPage();
  const errors = [];
  for (const p of [wide, narrow]) p.on("pageerror", e => errors.push(String(e.message || e)));
  const both = { "1440": wide, "390": narrow };
  const goto = async url => { for (const p of [wide, narrow]) await p.goto(APP + url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {}); await wide.waitForTimeout(2500); };

  // the imports run on the wide page; the narrow page shows the same preview, never imports
  const importFile = async (file, label, answer) => {
    for (const p of [wide, narrow]) {
      await p.goto(APP + "/donors", { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.getByRole("button", { name: /Import & tools/ }).first().click({ timeout: 30000 });
      await p.getByRole("menuitem", { name: /Import a spreadsheet|Any spreadsheet/ }).first().click({ timeout: 10000 });
      await p.waitForSelector('[data-testid="sheet-file"]', { timeout: 15000 });
    }
    await shot(both, `${label}-start`, "the import start screen");
    for (const p of [wide, narrow]) await p.setInputFiles('[data-testid="sheet-file"]', path.join(FX, file));
    for (const p of [wide, narrow]) await p.waitForSelector('[data-testid="sheet-import-go"]', { timeout: 60000 });
    await shot(both, `${label}-preview`, `the preview of ${file}`);
    if (answer) { for (const p of [wide, narrow]) await answer(p); await shot(both, `${label}-answered`, "after the answers"); }
    for (const p of [wide, narrow]) await p.waitForSelector('[data-testid="sheet-import-go"]:not([disabled])', { timeout: 30000 }).catch(() => {});
    await wide.click('[data-testid="sheet-import-go"]');
    if (await wide.locator('[data-testid="sheet-import-go"]').count() && !(await wide.locator('[data-testid="sheet-result"]').count())) {
      await wide.waitForTimeout(500);
      if (await wide.locator('[data-testid="sheet-job"]').count() === 0 && await wide.locator('[data-testid="sheet-result"]').count() === 0) await wide.click('[data-testid="sheet-import-go"]').catch(() => {});
    }
    await wide.waitForSelector('[data-testid="sheet-result"]', { timeout: 180000 });
    await shot({ "1440": wide }, `${label}-receipt`, `the receipt for ${file}`);
    await wide.click('[data-testid="sheet-done"]');
    await narrow.keyboard.press("Escape");
  };

  console.log("[walk] imports");
  await importFile("jp-gift-history-287.xlsx", "gifts");
  await importFile("jp-dinner-gifts-106.xlsx", "dinner", async p => {
    // the dinner sheet has no guest list, so its question is "date them all" and the event
    const name = (await p.locator('[data-testid="sheet-event-name"]').count()) ? '[data-testid="sheet-event-name"]' : '[data-testid="sheet-question-date"] input[type="text"]';
    await p.fill(name, "Finding Joy Dinner");
    const date = (await p.locator('[data-testid="sheet-event-date"]').count()) ? '[data-testid="sheet-event-date"]' : '[data-testid="sheet-date-input"]';
    await p.fill(date, "2026-10-22");
    await p.waitForTimeout(300);
    if (await p.locator('[data-testid="sheet-use-event-date"]').count()) await p.check('[data-testid="sheet-use-event-date"]');
    const link = p.locator('[data-testid="sheet-question-date"] input[type="checkbox"]');
    if (await link.count() && !(await link.first().isChecked())) await link.first().check();
    await p.waitForSelector('[data-testid="sheet-import-go"]:not([disabled])', { timeout: 30000 }).catch(() => {});
  });
  await importFile("jp-contacts-656.xlsx", "contacts");

  console.log("[walk] screens");
  await goto("/welcome"); await shot(both, "first-look", "the first look");
  await goto("/dashboard"); await shot(both, "home", "Home");
  await goto("/donors"); await shot(both, "donors", "the Donors list");
  const picks = await q(`SELECT d.id, d.name FROM donors d WHERE d.org_id=$1 AND d.deleted_at IS NULL AND (
      d.id IN (SELECT donor_id FROM pledges WHERE org_id=$1 AND installment_count > 1 LIMIT 1)
      OR d.id IN (SELECT donor_id FROM gifts WHERE org_id=$1 GROUP BY donor_id ORDER BY SUM(amount) DESC LIMIT 1)
      OR d.id IN (SELECT donor_id FROM gifts WHERE org_id=$1 AND date = '2026-10-22' LIMIT 1)) LIMIT 3`, [ORG]);
  for (const [i, d] of picks.entries()) { await goto(`/donors/${encodeURIComponent(d.id)}`); await shot(both, `profile-${i + 1}`, `profile: ${d.name}`); }
  await goto("/app/fundraising"); await shot(both, "fundraising", "Fundraising");
  await goto("/app/settings?section=imports"); await shot(both, "settings-imports", "Settings, Imports");

  console.log("[walk] undo, newest first");
  const runs = (await truth()).imports.slice().reverse();
  for (const r of runs) {
    await wide.goto(`${APP}/app/settings?section=imports&import=${encodeURIComponent(r.id)}`, { waitUntil: "domcontentloaded" });
    await wide.waitForSelector('[data-testid="import-undo-open"]', { timeout: 30000 });
    await wide.click('[data-testid="import-undo-open"]');
    await wide.waitForSelector('[data-testid="import-undo-yes"]', { timeout: 30000 });
    await shot({ "1440": wide }, `undo-confirm-${r.source_filename.replace(/\.xlsx$/, "")}`, `the undo confirm for ${r.source_filename}`);
    await wide.click('[data-testid="import-undo-yes"]');
    // the receipt either says it is undone, or closes and the list says so
    await wide.waitForFunction(() => document.querySelector('[data-testid="import-undo-done"]') || !document.querySelector('[data-testid="import-undo-yes"]'), null, { timeout: 120000 });
    await shot({ "1440": wide }, `undone-${r.source_filename.replace(/\.xlsx$/, "")}`, `after undoing ${r.source_filename}`);
  }
  await goto("/dashboard"); await shot(both, "home-after-undo", "Home after every undo");
  log.push({ step: "errors", pageErrors: errors });
  fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(log, null, 1));
  await browser.close();
  await closeDb();
  console.log(`[walk] ${n} steps, ${errors.length} page errors, ${OUT}`);
})().catch(async e => { console.error(e); fs.writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(log, null, 1)); await closeDb().catch(() => {}); process.exit(1); });
