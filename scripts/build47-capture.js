#!/usr/bin/env node
// BUILD-47 — DSF2 screenshots of the Find-Your-Nonprofits directory + the
// /giving design pass, at 390 AND 1440, with DOM assertions. Self-seeding
// against the LOCAL scratch stack (run seed-build46-network-demo.js first for
// the linked-home story).
//
// Local stack recipe (the BUILD-45/46 capture conventions):
//   client built with VITE_API_URL=http://localhost:5601
//     VITE_PORTAL_API=http://localhost:5601/portal
//     VITE_ACCOUNT_API=http://localhost:5601/account
//     VITE_NETWORK_API=http://localhost:5601/network
//   `npx vite preview --port 4173` + server booted with
//   CORS_ORIGIN=http://localhost:4173 and both BUILD-46 flags on.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build47-capture.js
const fs = require("fs");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const { chromium } = require(process.env.PLAYWRIGHT_DIR + "/node_modules/playwright");

const API = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const APP = process.env.APP || "http://localhost:4173";
const OUT = process.env.OUT || (__dirname + "/../docs/build47-directory");
const DB = process.env.DATABASE_URL || "postgres://steward:steward@localhost:5544/steward_loadtest";
if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error("refusing a non-scratch DATABASE_URL"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, d ?? ""); } };

const j = async (method, path, body, headers = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  let parsed = null; try { parsed = await r.json(); } catch { }
  return { status: r.status, body: parsed, headers: r.headers };
};
const cookieOf = (r) => decodeURIComponent(((r.headers.get("set-cookie") || "").match(/steward_portal=([^;]+)/) || [])[1] || "");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const db = new Client({ connectionString: DB });
  await db.connect();

  // ── seed: a fresh empty account + a dressed directory entry ──────────────
  const EMPTY = "b47.capture@b47.test";
  await db.query(`DELETE FROM donor_accounts WHERE email = $1`, [EMPTY]);
  await db.query(
    `INSERT INTO donor_accounts (id,email,password_hash,email_verified_at) VALUES ('da_b47cap',$1,$2,NOW())`,
    [EMPTY, bcrypt.hashSync("b47capture999", 10)]);
  // Dress River Bend Shelter's directory card (seeded listed by the network
  // suites — its slug suffix is re-minted each run, so resolve it live) so
  // search results and the followed card read like the real thing.
  const rb = await db.query(
    `SELECT o.org_slug FROM orgs o
     JOIN portal_settings ps ON ps.org_id = o.id AND ps.enabled = true AND ps.network_listed = true
     WHERE o.org_slug LIKE 'river-bend-shelter-%' ORDER BY o.created_at DESC LIMIT 1`);
  const RIVER_SLUG = rb.rows[0]?.org_slug;
  ok("a listed river-bend org exists (run the network suites/demo seed first)", !!RIVER_SLUG);
  await db.query(
    `UPDATE portal_settings SET directory_description='Emergency housing and warm meals on the river bend',
       directory_city='Fairhope', directory_state='AL'
     WHERE org_id IN (SELECT id FROM orgs WHERE org_slug=$1)`, [RIVER_SLUG]);
  await db.query(`DELETE FROM donor_org_follows WHERE account_id IN ('da_b47cap')`);

  const emptyLogin = await j("POST", "/account/login", { email: EMPTY, password: "b47capture999" });
  ok("empty-account login", emptyLogin.status === 200);
  const emptyCookie = cookieOf(emptyLogin);
  const alexLogin = await j("POST", "/account/login", { email: "alex.demo@n46.test", password: "alexdemo999" });
  ok("linked-demo login (seed-build46-network-demo first if this fails)", alexLogin.status === 200);
  const alexCookie = cookieOf(alexLogin);

  const browser = await chromium.launch();
  const shoot = async (cookie, name, vp, drive) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    if (cookie) await ctx.addCookies([{ name: "steward_portal", value: cookie, url: APP }]);
    const page = await ctx.newPage();
    await page.goto(APP + "/giving", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    if (drive) await drive(page);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    await ctx.close();
    return name;
  };

  // 1) Empty state IS the directory entry — search box inline, both widths.
  for (const [w, vp] of [["1440", { width: 1440, height: 950 }], ["390", { width: 390, height: 844 }]]) {
    await shoot(emptyCookie, `after-empty-${w}`, vp, async (page) => {
      ok(`empty state leads with the directory headline (${w})`,
        await page.locator("text=Find the organizations you give to").count() > 0);
      ok(`empty state carries the search box inline (${w})`,
        await page.locator('input[aria-label="Search organizations"]').count() === 1);
    });
  }

  // 2) Live search results + zero-results honesty (1440).
  await shoot(emptyCookie, "after-directory-results-1440", { width: 1440, height: 950 }, async (page) => {
    await page.fill('input[aria-label="Search organizations"]', "river");
    await page.waitForTimeout(900);
    ok("search shows the dressed listing card", await page.locator("text=Emergency housing and warm meals").count() > 0);
    ok("listed result offers Add", await page.locator('button:has-text("Add")').count() > 0);
  });
  await shoot(emptyCookie, "after-zero-results-1440", { width: 1440, height: 950 }, async (page) => {
    await page.fill('input[aria-label="Search organizations"]', "Nowhere Whatsoever Trust");
    await page.waitForTimeout(900);
    ok("zero results are honest — Not on Steward yet", await page.locator("text=Not on Steward yet").count() > 0);
    const mailto = await page.locator('a[href^="mailto:"]').first().getAttribute("href");
    ok("word-of-mouth mailto has NO recipient (we never collect the org's contact)", mailto && mailto.startsWith("mailto:?"));
  });

  // 3) Followed card — add via the real flow, both widths.
  const add = await j("POST", "/account/orgs/add", { orgSlug: RIVER_SLUG }, { Cookie: `steward_portal=${encodeURIComponent(emptyCookie)}` });
  ok("add (no email match) → follow", add.status === 200);
  for (const [w, vp] of [["1440", { width: 1440, height: 950 }], ["390", { width: 390, height: 844 }]]) {
    await shoot(emptyCookie, `after-followed-${w}`, vp, async (page) => {
      ok(`followed card renders with the honest connect copy (${w})`,
        await page.locator("text=add the email you used").count() > 0);
      ok(`followed-only view shows NO $0 anywhere — not even the summary strip (${w})`,
        await page.locator("text=$0").count() === 0);
      ok(`followed card carries the Give path (${w})`,
        await page.locator('a:has-text("Give")').count() > 0);
    });
  }

  // 4) The design pass on the linked home (alex.demo) — both widths.
  for (const [w, vp] of [["1440", { width: 1440, height: 950 }], ["390", { width: 390, height: 844 }]]) {
    await shoot(alexCookie, `after-home-${w}`, vp, async (page) => {
      ok(`summary strip present (${w})`, await page.locator("text=This year").count() > 0);
      ok(`persistent Add organizations affordance (${w})`,
        await page.locator('button:has-text("+ Add organizations")').count() === 1);
    });
  }

  // cleanup the capture follow so reruns are stable
  await db.query(`DELETE FROM donor_org_follows WHERE account_id = 'da_b47cap'`);
  await db.end();
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed — shots in ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
