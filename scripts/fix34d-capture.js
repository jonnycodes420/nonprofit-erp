#!/usr/bin/env node
// FIX-34 D — the walk. A fixture org (org_fix34d_shots) with QuickBooks
// connected and one fund unmapped, and PayPal connected; captures the
// QuickBooks panel and the Giving section at 1440 and 390, asserting as it goes.
// Loopback only.
for (const [k, v] of [["BASE", process.env.BASE], ["APP_URL", process.env.APP_URL], ["DATABASE_URL", process.env.DATABASE_URL]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "fix-34");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const ORG = "org_fix34d_shots", EMAIL = "fix34d-shots@example.org";

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 300) : "")); } };

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const q = (s, a) => pool.query(s, a);
  for (const t of ["gift_bookkeeping_syncs", "bookkeeping_connections", "giving_sources", "gifts", "donors", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,qbo_sync_enabled)
           VALUES ($1,'Gulf Coast Friends','fix34d-shots',1,'active','team',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix34d_s',$1,$2,$3,'Jonathan A','admin')`,
    [ORG, EMAIL, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_f34s_gen',$1,'General Operating',false),('fnd_f34s_bld',$1,'Building Fund',true)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_f34s',$1,'Susan La','susan@example.org')`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_f34s_1',$1,'d_f34s',75,CURRENT_DATE,'online','fnd_f34s_gen','card'),
                  ('g_f34s_2',$1,'d_f34s',40,CURRENT_DATE,'online','fnd_f34s_bld','card')`, [ORG]);
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ('bkc_f34s',$1,'quickbooks','active','9341000000000000099',
             '{"qbo":{"mode":"salesreceipt","depositAccount":{"id":"35","name":"Checking"},"funds":{"fnd_f34s_gen":{"accountId":"81","accountName":"Donations"}},"campaigns":{}}}'::jsonb,
             'system:walk','fix34 d walk')`, [ORG]);
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,default_fund_id,created_by,created_by_name)
           VALUES ('gs_f34s_pp',$1,'paypal','PayPal','active','fnd_f34s_gen','system:walk','fix34 d walk')`, [ORG]);

  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) });
  const auth = await r.json();
  if (!auth.token) { console.error("login failed:", JSON.stringify(auth).slice(0, 200)); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();
  for (const [w, tag] of [[1440, "1440"], [390, "390"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: 1300 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const errors = [], bad = [];
    // serviceWorkers:"block" makes the SW registration throw; that one is the harness.
    p.on("console", m => { if (m.type() === "error" && !/^\[SW\]|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    p.on("response", res => { if (res.status() >= 400) bad.push(res.status() + " " + res.url()); });
    await p.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    await p.goto(`${APP}/app/settings?section=connections`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector('[data-testid="conn-card"][data-key="quickbooks"]', { timeout: 30000 });
    await p.waitForTimeout(800);
    await p.locator('[data-testid="conn-card"][data-key="quickbooks"] [data-testid="conn-button"]').click();
    await p.waitForSelector('[data-testid="qbo-sync"]', { timeout: 20000 });
    await p.waitForTimeout(1200);
    const qbo = await p.locator('[data-testid="qbo-sync"]').innerText();
    ok(`@${tag} "Auto-sync is" appears once`, (qbo.match(/Auto-sync is/g) || []).length === 1, qbo.slice(0, 300));
    ok(`@${tag} the panel names the unmapped fund`, /Building Fund/.test(qbo) && await p.locator('[data-testid="qbo-map-gaps"]').count() === 1);
    ok(`@${tag} auto-sync cannot be turned on yet`, await p.locator('[data-testid="qbo-auto"]').isDisabled());
    ok(`@${tag} no "an account not chosen yet"`, !/an account not chosen yet/.test(qbo));
    const cardText = await p.locator('[data-testid="conn-card"][data-key="quickbooks"]').innerText();
    ok(`@${tag} the card says what is sent`, /sales receipt/i.test(cardText) && !/deposit per payout/i.test(cardText), cardText);
    await p.locator('[data-testid="qbo-sync"]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, `d-quickbooks-${tag}.png`), fullPage: true });

    await p.goto(`${APP}/app/settings?section=connections`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector('[data-testid="conn-card"][data-key="paypal"]', { timeout: 30000 });
    await p.locator('[data-testid="conn-card"][data-key="paypal"] [data-testid="conn-button"]').click();
    await p.waitForSelector('[data-testid="gs-fund"]', { timeout: 20000 });
    await p.waitForTimeout(1000);
    const card = await p.locator('[data-testid="conn-card"][data-key="paypal"]').innerText();
    ok(`@${tag} the PayPal card says Connected`, /connected/i.test(card) && !/not connected/i.test(card), card);
    const opts = await p.locator('[data-testid="gs-fund"] option').allInnerTexts();
    ok(`@${tag} the picker offers Ask me each time and the funds`, opts.includes("Ask me each time") && opts.includes("General Operating") && opts.includes("Building Fund"), opts);
    ok(`@${tag} it is set to General Operating`, (await p.locator('[data-testid="gs-fund"]').inputValue()) === "fnd_f34s_gen");
    await p.locator('[data-testid="gs-fund"]').first().scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, `d-giving-paypal-${tag}.png`), fullPage: true });
    ok(`@${tag} no console errors`, errors.length === 0, errors.slice(0, 3));
    ok(`@${tag} no failed API call`, !bad.some(b => b.includes(BASE)), bad.slice(0, 5));
    if (bad.length) console.log("    (non-API 4xx: " + bad.filter(b => !b.includes(BASE)).slice(0, 4).join(", ") + ")");
    await p.close();
  }
  await browser.close();
  for (const t of ["gift_bookkeeping_syncs", "bookkeeping_connections", "giving_sources", "gifts", "donors", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await pool.end();
  console.log(`\nfix34d-capture: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
