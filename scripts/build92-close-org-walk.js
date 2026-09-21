#!/usr/bin/env node
// BUILD-92 — the walk for "click an organization and close it from there".
//
// The suite proves the ROUTE attaches instead of creating. This proves the
// thing that was actually asked for: that a person looking at an organization
// can start a close from where they are standing, and never meets the
// "That email already has a Steward account." wall that sent them here.
//
// Read-only against the local scratch stack. Refuses anything that is not
// localhost, because it signs a super-admin token to get in.
//
//   BASE=http://localhost:5661 APP_URL=http://localhost:4185 \
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_92close \
//   node scripts/build92-close-org-walk.js

const path = require("path");
const fs = require("fs");
const http = require("http");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// This walk SEEDS ITS OWN FIXTURES straight into the database (an org that
// already exists is the whole premise, and no route creates one), so it is a
// writer and resolves both targets through the one guard rather than its own
// regex - a hand-rolled refusal is exactly what prodGuard exists to replace.
const { writerBase, writerDbUrl } = require("./lib/prodGuard");
const BASE = writerBase("http://localhost:5661");
const DB = writerDbUrl();   // requires DATABASE_URL; loopback without the confirm flag
const APP = process.env.APP_URL || "http://localhost:4185";
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const SECRET = process.env.JWT_SECRET || "local-test-secret";

// APP_URL drives a browser rather than writing, but a walk pointed at a real
// site would still be signing a super-admin token into it. Loopback only.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(APP)) {
  console.error(`Refusing to run: APP_URL must be loopback (got ${APP})`);
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail === undefined ? "" : " — " + JSON.stringify(detail))); }
};

const ORG = "org_walk_hq", CUST = "org_walk_cust";
const SUPER = "walksuper@example.org", CUST_ADMIN = "walkdir@example.org";

// The platform-billing Stripe mock. Without it every price read fails, every
// plan reports ready:false, and the Create button is CORRECTLY disabled - the
// screen refusing to sell a plan whose price it cannot verify. That is the
// product working; a walk that did not start the mock would be reporting its
// own missing environment as a defect.
const BILLING_MOCK_PORT = Number(process.env.BILLING_MOCK_PORT || 5664);
const PRICES = {
  price_test_founding: { unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
  price_test_core:     { unit_amount: 24900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
  price_test_team:     { unit_amount: 49900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
};
let sessionN = 0;
function startBillingMock() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
          const id = "cs_walk_" + (++sessionN);
          return res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
        }
        const price = req.url.match(/^\/v1\/prices\/([^/?]+)/);
        if (req.method === "GET" && price) {
          const p = PRICES[price[1]];
          if (!p) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: "resource_missing" } })); }
          return res.end(JSON.stringify({ id: price[1], object: "price", ...p }));
        }
        if (req.method === "POST" && req.url.startsWith("/v1/customers")) return res.end(JSON.stringify({ id: "cus_walk" }));
        res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.method + " " + req.url } }));
      });
    });
    srv.on("error", reject);
    srv.listen(BILLING_MOCK_PORT, () => resolve(srv));
  });
}

(async () => {
  let mockSrv;
  try { mockSrv = await startBillingMock(); }
  catch { console.log(`  SKIP  billing mock port ${BILLING_MOCK_PORT} already bound`); process.exit(0); }
  const pool = new Pool({ connectionString: DB, ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
  const q = (s, p) => pool.query(s, p).then(r => r.rows);

  // ── fixtures: a super-admin, and a customer org that ALREADY EXISTS ──────
  for (const o of [ORG, CUST]) {
    await q(`DELETE FROM close_links WHERE target_org_id=$1 OR org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM accounts WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Walk HQ','walk-hq',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_walk_super',$1,$2,$3,'Jonathan','admin',true)`, [ORG, SUPER, hash]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Riverbend Arts','walk-riverbend',1,'trialing','trial')`, [CUST]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_walk_dir',$1,$2,$3,'Director','admin')`, [CUST, CUST_ADMIN, hash]);

  const token = jwt.sign(
    { userId: "u_walk_super", orgId: ORG, email: SUPER, role: "admin", isSuperAdmin: true },
    SECRET, { expiresIn: "30m" });
  const auth = { token, user: { id: "u_walk_super", email: SUPER, name: "Jonathan", role: "admin", isSuperAdmin: true }, org: { id: ORG, name: "Walk HQ" } };

  const dist = path.join(__dirname, "..", "client", "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) { console.log("  SKIP  client/dist not built"); await pool.end(); process.exit(0); }
  let chromium;
  try { module.paths.unshift(path.join(PW_DIR, "node_modules")); ({ chromium } = require("playwright")); }
  catch { console.log("  SKIP  Playwright not found (set PLAYWRIGHT_DIR)"); await pool.end(); process.exit(0); }
  try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(2000) }); if (!r.ok) throw new Error(); }
  catch { console.log(`  SKIP  nothing serving ${APP}`); await pool.end(); process.exit(0); }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));

  try {
    await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
    await page.evaluate(a => {
      localStorage.setItem("npe_token", a.token);
      localStorage.setItem("npe_user", JSON.stringify(a.user));
      localStorage.setItem("npe_org", JSON.stringify(a.org));
    }, auth);

    console.log("— the organization is where the close starts —");
    await page.goto(APP + "/admin", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Organizations/ }).click();
    await page.waitForTimeout(700);

    const closeBtn = page.locator(`[data-testid="org-close-${CUST}"]`);
    ok("the org's row offers a Close button", await closeBtn.count() === 1);

    const rowText = await page.locator("tr", { hasText: "Riverbend Arts" }).first().innerText();
    ok("...on the row of the organization it closes", /Riverbend Arts/.test(rowText), rowText.slice(0, 80));

    await closeBtn.click();
    await page.waitForTimeout(900);

    console.log("\n— it lands on the close screen, already knowing who —");
    const target = page.locator('[data-testid="cl-target"]');
    ok("the close screen opens against that organization", await target.count() === 1);
    const targetText = await target.innerText();
    ok("...and names it, without anybody retyping it", /Riverbend Arts/.test(targetText), targetText);
    ok("...and names the person the link will reach",
       (await page.locator('[data-testid="cl-target-email"]').innerText()).trim() === CUST_ADMIN);

    ok("the organization-name field is not asked for again",
       await page.locator("#cl-orgname").isVisible() === false);
    ok("...nor the contact email, which is what used to be refused",
       await page.locator("#cl-email").isVisible() === false);

    const body = await page.locator("body").innerText();
    ok("THE WALL IS GONE: no 'already has a Steward account' on this path",
       !/already has a Steward account/i.test(body));
    ok("the sentence says this org is already in Steward",
       /already in Steward/i.test(body), body.slice(0, 200));

    console.log("\n— and it can actually be closed —");
    await page.locator('[data-testid="cl-plan-core"]').click();
    await page.waitForTimeout(250);
    const createBtn = page.getByRole("button", { name: /Create close link/i });
    ok("the Create button is live", await createBtn.isEnabled());
    await createBtn.click();
    await page.waitForTimeout(1200);

    const after = await page.locator("body").innerText();
    ok("a link comes back", /checkout\.stripe\.test|Copy/i.test(after), after.slice(0, 220));

    const row = await q(`SELECT target_org_id, contact_email, plan FROM close_links WHERE target_org_id=$1`, [CUST]);
    ok("...and the database records it against the EXISTING org",
       row.length === 1 && row[0].target_org_id === CUST, row[0]);
    ok("...addressed to that org's own admin", row.length === 1 && row[0].contact_email === CUST_ADMIN);

    const orgs = await q(`SELECT COUNT(*)::int c FROM orgs WHERE name='Riverbend Arts'`);
    ok("...and no second organization of the same name was conjured", orgs[0].c === 1, orgs[0].c);

    ok("no page errors during the walk", errs.length === 0, errs);
  } finally {
    await browser.close();
    for (const o of [ORG, CUST]) {
      await q(`DELETE FROM close_links WHERE target_org_id=$1 OR org_id=$1`, [o]).catch(() => {});
      await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
      await q(`DELETE FROM accounts WHERE org_id=$1`, [o]).catch(() => {});
      await q(`DELETE FROM fin_funds WHERE org_id=$1`, [o]).catch(() => {});
      await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    }
    await pool.end();
    if (mockSrv) mockSrv.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
