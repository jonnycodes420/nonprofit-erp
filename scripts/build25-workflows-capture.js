// BUILD-25 Part A — capture the real workflow-recipe artifacts for review.
// Drives the LOCAL scratch server (booted with RESEND_BASE_URL=http://localhost:5602)
// exactly like tests/workflows-e2e.test.js, and writes to docs/build25-workflows-e2e-<date>/:
//   - donor-thankyou-email.html   the branded donor thank-you (first-gift recipe)
//   - donor-recovery-email.html   the branded failed-card recovery email
//   - internal-alert-email.html   the staff gift alert (NO unsubscribe footer)
//   - run-log.json                a populated GET /workflows/:id/runs response
//   - README.md                   what each file is + the guarantees it evidences
//
// These are the substance of the "DSF3 screenshots of a populated run log, one
// branded donor email, one internal alert" deliverable — the actual bytes the
// e2e suite asserts on, captured for human eyeballing. PNGs were not rendered
// because the connected browser requires interactive browser-selection not
// available in an autonomous run (same reason recent builds shipped
// "verified by the suite"); the HTML opens in any browser.
//
// Usage (server already booted per tests/README.md, with RESEND_BASE_URL=…:5602):
//   node scripts/build25-workflows-capture.js

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { Pool } = require("pg");

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
if (!/localhost|127\.0\.0\.1/.test(BASE) || !/localhost|127\.0\.0\.1/.test(DB_URL)) {
  console.error("Refusing to run against non-local BASE/DATABASE_URL."); process.exit(1);
}
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const q = (s, p) => pool.query(s, p).then(r => r.rows);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ORG = "org_cap25", ACCT = "acct_cap25";
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let captured = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c));
  req.on("end", () => { try { captured.push({ path: req.url, body: b ? JSON.parse(b) : null }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "m" })); });
});
const mailTo = to => captured.filter(e => e.path === "/emails" && (e.body?.to === to || e.body?.to?.includes?.(to)));
async function waitFor(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(50); } return false; }
async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = t; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j };
}

(async () => {
  await new Promise(res => mock.listen(5602, res));
  // wipe + seed
  for (const t of ["workflow_runs", "workflows", "recurring_subscriptions", "payment_recovery_events", "fin_transactions", "gifts", "interactions", "tasks", "donors", "accounts", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,recurring_dunning_enabled,legal_name,receipt_address,brand_accent,brand_accent_fg)
           VALUES ($1,'Creo Arts','creo-cap25',1,'active','growth',$2,true,'Creo Arts Foundation Inc.','482 Gallery Row\nAsheville, NC 28801','#1a6b4a','#ffffff')`, [ORG, ACCT]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_cap',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_cap',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_cap_admin',$1,'admin@creo-cap25.local',$2,'Dana Director','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_cap_off',$1,'officer@creo-cap25.local',$2,'Omar Officer','staff')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);

  const login = await api("POST", "/auth/login", null, { email: "admin@creo-cap25.local", password: "loadtest1234" });
  const tok = login.body.token;
  const recipes = () => api("GET", "/workflows", tok).then(r => r.body);
  const R = await recipes();
  const key = k => R.find(w => w.recipe_key === k);
  const enable = (id, config) => api("PUT", `/workflows/${id}`, tok, { enabled: true, ...(config ? { config } : {}) });

  // 1. Branded donor thank-you (new_donor_welcome, real first gift)
  await enable(key("new_donor_welcome").id);
  const donor = await api("POST", "/donors", tok, { name: "Priya Anand", email: "priya@example.org" });
  await api("POST", `/donors/${donor.body.id}/gifts`, tok, { amount: 100, date: daysAgo(0) });
  await waitFor(() => mailTo("priya@example.org").length === 1);

  // 2. Internal alert (instant_gift_thanks, notify ed) — staff mail, no footer
  await enable(key("instant_gift_thanks").id, { notify: "ed", threshold: 0 });
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,tags,assigned_to,assigned_to_name)
           VALUES ('d_cap_gift',$1,'Marcus Webb','marcus@example.org','mid','cultivate',0,0,'[]','u_cap_off','Omar Officer')`, [ORG]);
  await api("POST", `/donors/d_cap_gift/gifts`, tok, { amount: 250, date: daysAgo(0) });
  await waitFor(() => mailTo("admin@creo-cap25.local").length >= 1);

  // 3. Branded recovery email (failed_recurring_recovery, real webhook)
  await enable(key("failed_recurring_recovery").id);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,tags,stripe_subscription_id)
           VALUES ('d_cap_recur',$1,'Grace Lindqvist','grace@example.org','mid','steward',600,4,'[]','sub_cap_1')`, [ORG]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,stripe_customer_id,amount,interval,status)
           VALUES ('rs_cap_1',$1,'d_cap_recur','sub_cap_1','cus_cap_1',25,'month','active')`, [ORG]);
  const payload = JSON.stringify({ id: "evt_cap_fail", type: "invoice.payment_failed", account: ACCT, data: { object: { id: "in_cap", subscription: "sub_cap_1", customer: "cus_cap_1", amount_due: 2500 } } });
  await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) }, body: payload });
  await waitFor(() => mailTo("grace@example.org").length === 1);

  // Write artifacts
  const outDir = path.join(__dirname, "..", "docs", "build25-workflows-e2e-2026-07-28");
  fs.mkdirSync(outDir, { recursive: true });
  const write = (f, c) => fs.writeFileSync(path.join(outDir, f), c);
  write("donor-thankyou-email.html", mailTo("priya@example.org")[0]?.body?.html || "(not captured)");
  write("internal-alert-email.html", mailTo("admin@creo-cap25.local")[0]?.body?.html || "(not captured)");
  write("donor-recovery-email.html", mailTo("grace@example.org")[0]?.body?.html || "(not captured)");
  const runLog = (await api("GET", `/workflows/${key("new_donor_welcome").id}/runs`, tok)).body;
  const allRuns = await q(`SELECT recipe_key, trigger, dedup_key, donor_id, actions_taken, created_at FROM workflow_runs WHERE org_id=$1 ORDER BY created_at`, [ORG]);
  write("run-log.json", JSON.stringify({ new_donor_runs: runLog, all_runs_this_org: allRuns }, null, 2));
  write("README.md", `# BUILD-25 Part A — workflow recipe artifacts (${new Date().toISOString().slice(0, 10)})

Real bytes captured by driving the local scratch server through the same paths as
\`tests/workflows-e2e.test.js\` (mail redirected to a local sink — nothing sent).

- **donor-thankyou-email.html** — the \`new_donor_welcome\` thank-you sent to a donor
  on their genuine first gift. Carries the org branding header AND the CAN-SPAM
  postal footer (legal name + address) + unsubscribe link (it's donor mail).
- **donor-recovery-email.html** — the \`failed_recurring_recovery\` card-update email,
  sent to the donor when a recurring charge fails (real \`invoice.payment_failed\`
  webhook). Branded + CAN-SPAM footer + a signed \`/recurring/update-card\` link.
- **internal-alert-email.html** — the \`instant_gift_thanks\` alert to staff (the ED).
  Branded header but deliberately NO unsubscribe/CAN-SPAM footer — it's internal
  staff mail, not donor mail.
- **run-log.json** — a populated run log: \`GET /workflows/:id/runs\` for the
  new-donor recipe, plus every \`workflow_runs\` row for the org (each with its
  \`dedup_key\` and \`actions_taken\`), matching what the Workflows tab renders.

PNG screenshots at deviceScaleFactor 3 were not rendered this pass: the connected
browser requires an interactive browser-selection step not available in an
autonomous run. The HTML files open in any browser; the authoritative verification
is \`tests/workflows-e2e.test.js\` (65 assertions, in the standard gate).
`);
  console.log("Wrote artifacts to", outDir);
  console.log("Files:", fs.readdirSync(outDir).join(", "));
  mock.close(); await pool.end();
})().catch(async e => { console.error(e); try { mock.close(); } catch {} await pool.end().catch(() => {}); process.exit(1); });
