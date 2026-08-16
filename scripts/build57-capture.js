// BUILD-57 Part 1 — screenshot + assertion pass for the staff recurring
// surface: Fundraising → Recurring Giving (movement summary, at-risk queue,
// roster) and Home → Recurring (the exceptions tab), against the LOCAL stack.
//
// Prereqs (tests/README.md recipe):
//   1. scratch stack up; client built with the localhost overrides:
//        VITE_API_URL=http://localhost:5601 npx vite build → npx vite preview --port 4173
//      server booted with CORS_ORIGIN=http://localhost:4173
//   2. PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build57-capture.js
//      (self-seeding: registers its own fixture org; subscriptions are
//      DB-seeded — there is no API that mints a failing card on demand)
//
// Output: docs/build57/part1/ — dashboard Recurring tab + the full page at
// 1440 and 390.
const path = require("path");
const fs = require("fs");
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PLAYWRIGHT_DIR, "node_modules", "playwright"));

const guard = require("./lib/prodGuard");
const API = guard.writerBase("http://localhost:5601");
const APP = process.env.APP || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "build57", "part1");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 200) : "")); } };

const EMAIL = "b57cap@test.local", PASS = "loadtest1234";
const j = async (method, p, token, body) => {
  const r = await fetch(API + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();

async function seedFixture() {
  let auth = (await j("POST", "/auth/login", null, { email: EMAIL, password: PASS })).body;
  if (!auth.token) {
    auth = (await j("POST", "/auth/register-org", null, { orgName: "B57 Capture Org", userName: "Cap Admin", email: EMAIL, password: PASS })).body;
  }
  const tok = auth.token;
  if (!tok) throw new Error("fixture login/register failed");
  await j("POST", "/onboarding/complete", tok, {});
  const orgId = auth.org?.id || auth.user?.orgId;

  for (const name of ["Youth Arts Access", "Building Reserve"]) {
    const have = (await j("GET", "/finance/funds", tok)).body || [];
    if (!have.some?.(f => f.name === name)) await j("POST", "/finance/funds", tok, { name, restricted: true });
  }
  const funds = (await j("GET", "/finance/funds", tok)).body || [];
  const fund1 = funds.find(f => f.name === "Youth Arts Access")?.id || null;

  const donors = [
    ["Miriam Okafor", "miriam@b57.test"], ["Theo Grant", "theo@b57.test"],
    ["June Park", "june@b57.test"], ["Sal Romero", "sal@b57.test"], ["Priya Nair", "priya@b57.test"],
  ];
  const donorIds = {};
  const existing = (await j("GET", "/donors?limit=50", tok)).body;
  for (const [name, email] of donors) {
    const hit = existing.donors?.find?.(d => d.email === email);
    if (hit) { donorIds[name] = hit.id; continue; }
    const made = (await j("POST", "/donors", tok, { name, email, status: "mid" })).body;
    donorIds[name] = made.id || made.donor?.id;
  }

  // Subscriptions in every roster state + this month's movement, DB-seeded
  // (the states come from Stripe webhooks in real life).
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: guard.writerDbUrl(), ssl: false });
  await pool.query(`DELETE FROM recurring_change_log WHERE org_id=$1`, [orgId]);
  await pool.query(`DELETE FROM recurring_proposals WHERE org_id=$1`, [orgId]);
  await pool.query(`DELETE FROM recurring_subscriptions WHERE org_id=$1`, [orgId]);
  const subs = [
    ["rsb57_1", donorIds["Miriam Okafor"], "sub_b57_1", 100, "month", "active", { created: daysAgo(361), fund: fund1 }],
    ["rsb57_2", donorIds["Theo Grant"], "sub_b57_2", 45, "month", "past_due", { lastFailed: daysAgo(0), step: 1, fails: 2 }],
    ["rsb57_3", donorIds["June Park"], "sub_b57_3", 25, "month", "recovering", { lastFailed: daysAgo(9), step: 4, exhausted: true }],
    ["rsb57_4", donorIds["Sal Romero"], "sub_b57_4", 60, "month", "paused", { paused: daysAgo(3) }],
    ["rsb57_5", donorIds["Priya Nair"], "sub_b57_5", 600, "year", "active", { created: daysAgo(500) }],
  ];
  for (const [id, donor, sid, amount, interval, status, o] of subs) {
    await pool.query(
      `INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,created_at,last_failed_at,first_failed_at,dunning_step,next_dunning_at,failure_count,paused_at,fund_id,current_period_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,NOW()),$9,$9,COALESCE($10,0),$11,COALESCE($12,0),$13,$14,$15)`,
      [id, orgId, donor, sid, amount, interval, status, o.created || null, o.lastFailed || null, o.step || null,
        o.exhausted ? null : (o.lastFailed ? daysAgo(-2) : null), o.fails || null, o.paused || null, o.fund || null,
        status === "active" ? daysAgo(-12) : null]);
  }
  for (const [i, [kind, oldA, newA]] of [["created", null, 45], ["amount_up", 50, 100], ["paused", 60, null], ["canceled_involuntary", 35, null], ["canceled_voluntary", 20, null]].entries()) {
    await pool.query(
      `INSERT INTO recurring_change_log (id,org_id,subscription_id,donor_id,kind,old_amount,new_amount,sub_interval,actor) VALUES ($1,$2,'rsb57_seed',$3,$4,$5,$6,'month','system')`,
      ["rclb57_" + i, orgId, donorIds["Miriam Okafor"], kind, oldA, newA]);
  }
  // Linked renewal gifts → real "total given on this subscription".
  const g = await pool.query(`SELECT COUNT(*)::int c FROM gifts WHERE org_id=$1 AND recurring_subscription_id='rsb57_1'`, [orgId]);
  if (!g.rows[0].c) {
    for (const [gid, date] of [["gb57_1", "2026-06-16"], ["gb57_2", "2026-07-16"]]) {
      await pool.query(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,recurring_subscription_id) VALUES ($1,$2,$3,100,$4,'cash','','rsb57_1')`, [gid, orgId, donorIds["Miriam Okafor"], date]);
    }
  }
  await pool.end();

  // One pending invitation, through the REAL proposal surface.
  await j("POST", "/recurring/proposals", tok, { donorIds: undefined, donorId: donorIds["June Park"], kind: "card_update", subId: "rsb57_3" });

  // §2c — an aggregate-history donor: columns beyond the itemized rows, the
  // shape an imported total leaves behind (Miriam has $200 in rows).
  const pool2 = new Pool({ connectionString: guard.writerDbUrl(), ssl: false });
  await pool2.query(`UPDATE donors SET total_giving=300, gift_count=5 WHERE id=$1 AND org_id=$2`, [donorIds["Miriam Okafor"], orgId]);
  await pool2.end();
  return { auth, miriamId: donorIds["Miriam Okafor"] };
}

(async () => {
  const { auth, miriamId } = await seedFixture();
  const browser = await chromium.launch();

  async function shootAt(width, height, suffix) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [auth.token, auth.user, auth.org]);
    const p = await ctx.newPage();
    p.on("dialog", d => d.accept());

    // Home → Recurring (the exceptions tab)
    await p.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    const recTab = p.locator("button:has-text('Recurring')").first();
    await recTab.click({ timeout: 8000 });
    await p.waitForSelector("text=Cards just failed", { timeout: 8000 });
    ok(`(${suffix}) dashboard Recurring tab shows the failed-cards bucket`, await p.locator("text=Cards just failed").count() > 0);
    ok(`(${suffix}) dashboard Recurring is exceptions, not a roster (no table header)`, await p.locator("th:has-text('Total given')").count() === 0);
    await p.screenshot({ path: path.join(OUT, `dashboard-recurring-${suffix}.png`), fullPage: true });

    // The full page: Open Recurring Giving → Fundraising → Recurring
    await p.locator("button:has-text('Open Recurring Giving')").click();
    await p.waitForSelector("text=Monthly recurring revenue", { timeout: 10000 });
    ok(`(${suffix}) deep link lands on Fundraising → Recurring Giving`, await p.locator("text=Monthly recurring revenue").count() > 0);
    ok(`(${suffix}) at-risk queue renders (the point of the page)`, await p.locator("text=Needs recovery").count() > 0);
    ok(`(${suffix}) involuntary and voluntary churn are separate rows`,
      await p.locator("text=Lost to card failure").count() > 0 && await p.locator("text=Canceled by donor").count() > 0);
    ok(`(${suffix}) the benchmark is cited WITH its source`, (await p.locator("text=M+R Benchmarks 2026").count()) > 0);
    ok(`(${suffix}) pending invitation renders`, (await p.locator("text=Pending donor action").count()) > 0);
    await p.screenshot({ path: path.join(OUT, `recurring-page-${suffix}.png`), fullPage: true });
    await ctx.close();
  }

  await shootAt(1440, 900, "1440");
  await shootAt(390, 844, "390");

  // §2c — the lifetime-vs-itemized gap labels itself on the donor profile.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [auth.token, auth.user, auth.org]);
    const p = await ctx.newPage();
    await p.goto(APP + "/donors/" + miriamId, { waitUntil: "networkidle" });
    await p.waitForSelector(".dp-unitemized-note", { timeout: 10000 });
    const note = await p.locator(".dp-unitemized-note").first().innerText();
    ok("(2c) unitemized-history label renders on the profile with the exact gap", /\$100/.test(note), note);
    await p.screenshot({ path: path.join(OUT, "donor-profile-unitemized-label-1440.png"), fullPage: false });
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
