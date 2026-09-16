#!/usr/bin/env node
// BUILD-88b B.1 — TEN CHEQUES, BEFORE AND AFTER.
//
// The brief asks for one pair of numbers: how long ten cheques take the way it
// worked before, and the way it works now. Both runs are DRIVEN IN A REAL
// BROWSER on the same ten lines, on a fresh org, with the same donors on file.
// The timer starts when the first screen is open and stops when the tenth gift
// is in the database — no thinking time, no typing pauses, which means the
// BEFORE number is generously fast for a human and the gap is the floor.
//
//   BEFORE: the gift form, ten times. Open the donor, open Log a conversation,
//           type the line, type the amount, choose the method, save. Repeat.
//   AFTER:  one deposit. Paste ten lines, read, answer what it asks, record.
//
// Loopback only.
//   PLAYWRIGHT_DIR=~/steward-qa node scripts/build88b-deposit-timing.js
const path = require("path");
require("./lib/prodGuard").writerDbUrl();
const API = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const APP = process.env.APP || "http://localhost:4173";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API) || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(APP)) {
  console.error("REFUSED: loopback only."); process.exit(1);
}
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);
const api = async (method, p, tok, body) => {
  const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const ORG = "org_b88btime";
const LINES = [
  ["Margaret Chen", "250.00", "Xenia trip"], ["William Park", "1000.00", "General Operating"],
  ["Diana Torres", "75.50", "Xenia UMC"], ["Robert Atkinson", "500.00", "building fund"],
  ["Sunrise Foundation", "2500.00", "General Operating"], ["Carlos Mendez", "120.00", "youth"],
  ["Priya Raman", "60.00", "Xenia Mission Trip"], ["Ana Whitfield", "333.33", "general operating"],
  ["Beatrice Vaux", "90.00", "youth"], ["Owen Marchetti", "45.00", "Xenia trip"],
];
const TOTAL = LINES.reduce((s, l) => s + Math.round(Number(l[1]) * 100), 0);

async function reset() {
  for (const t of ["thank_you_drafts", "pledge_installments", "threads", "tasks", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "imports", "donors", "campaigns",
    "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'B88b Timing','b88b-timing',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88btime',$1,'b88btime@t.local',$2,'Ada Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active) VALUES ('acct_b88btime',$1,'4010','Contributions','revenue','contributions',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted,aliases) VALUES
             ('ffgen_t',$1,'General Operating',false,NULL),
             ('ffxen_t',$1,'Xenia Mission Trip',true,$2::jsonb),
             ('ffbld_t',$1,'Building Fund',true,NULL),
             ('ffyth_t',$1,'Youth Ministry',true,$3::jsonb)`,
    [ORG, JSON.stringify(["Xenia", "Xenia UMC"]), JSON.stringify(["youth"])]);
  await q(`UPDATE orgs SET default_fund_id='ffgen_t' WHERE id=$1`, [ORG]);
  let i = 0;
  for (const [name] of LINES) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
             VALUES ($1,$2,$3,$4,'new','steward','u_b88btime','Ada Admin')`,
      [`d_t_${i}`, ORG, name, `t${i}@b88btime.test`]);
    i++;
  }
}

(async () => {
  console.log("BUILD-88b B.1 — ten cheques, before and after\n");
  await reset();
  const login = await api("POST", "/auth/login", null, { email: "b88btime@t.local", password: "loadtest1234" });
  if (login.status !== 200) { console.error("login failed", login.status); process.exit(1); }
  const tok = login.body.token;
  const today = (await api("GET", "/dashboard/home?scope=mine", tok)).body?.today
    || new Date().toISOString().slice(0, 10);

  const browser = await chromium.launch();
  const mkPage = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 160)); });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [tok, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);
    return page;
  };

  // ── BEFORE: the gift form, ten times ─────────────────────────────────────
  const page = await mkPage();
  await page.goto(`${APP}/donors/d_t_0`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);   // the first page load is not timed
  const t0 = Date.now();
  let beforeSteps = 0;
  for (let i = 0; i < LINES.length; i++) {
    const [, amount, memo] = LINES[i];
    if (i > 0) {
      await page.goto(`${APP}/donors/d_t_${i}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2200);
      beforeSteps += 1;                                     // find and open the donor
    }
    await page.click('button:has-text("Log a conversation")'); beforeSteps += 1;
    await page.waitForTimeout(500);
    await page.click('button:has-text("Gift received")'); beforeSteps += 1;
    await page.fill('input[placeholder^="One line"]', memo || "Cheque in the post"); beforeSteps += 1;
    await page.fill('[data-testid="conv-gift-amount"]', amount); beforeSteps += 1;
    await page.waitForTimeout(350);
    await page.selectOption('[aria-label="Payment method"]', "Check"); beforeSteps += 1;
    // The fund: the memo is not read here — she chooses it.
    const wantFund = /xenia/i.test(memo) ? "Xenia Mission Trip" : /youth/i.test(memo) ? "Youth Ministry"
      : /building/i.test(memo) ? "Building Fund" : "General Operating";
    await page.selectOption('[aria-label="Fund"]', { label: wantFund }).catch(() => {}); beforeSteps += 1;
    await page.click('button:has-text("Save")'); beforeSteps += 1;
    await page.waitForTimeout(900);
  }
  const beforeMs = Date.now() - t0;
  const [beforeDb] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float cash FROM gifts WHERE org_id=$1`, [ORG]);
  await page.close();

  // Wipe the gifts, keep the people: the same ten cheques, the other way.
  await q(`DELETE FROM thank_you_drafts WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM interactions WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]);
  await q(`UPDATE donors SET total_giving=0, gift_count=0, last_gift_date=NULL, last_gift_amount=0 WHERE org_id=$1`, [ORG]);

  // ── AFTER: one deposit ───────────────────────────────────────────────────
  const page2 = await mkPage();
  await page2.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page2.waitForTimeout(3000);   // again, not timed
  const t1 = Date.now();
  let afterSteps = 0;
  await page2.click('button:has-text("Fundraising")'); afterSteps += 1;
  await page2.waitForTimeout(1200);
  await page2.click('button:has-text("Deposits")'); afterSteps += 1;
  await page2.waitForTimeout(700);
  await page2.click('[data-testid="add-a-deposit"]'); afterSteps += 1;
  await page2.waitForTimeout(600);
  await page2.fill('[data-testid="deposit-slip-total"]', (TOTAL / 100).toFixed(2)); afterSteps += 1;
  await page2.fill('[data-testid="deposit-paste"]', LINES.map(l => l.join("\t")).join("\n")); afterSteps += 1;
  await page2.click('[data-testid="deposit-read"]'); afterSteps += 1;
  await page2.waitForTimeout(1500);
  await page2.click('[data-testid="deposit-commit"]'); afterSteps += 1;
  await page2.waitForTimeout(2500);
  const afterMs = Date.now() - t1;
  const [afterDb] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float cash FROM gifts WHERE org_id=$1`, [ORG]);
  await page2.close();
  await browser.close();

  const c = n => Math.round(Number(n) * 100);
  const okBoth = beforeDb.n === 10 && afterDb.n === 10 && c(beforeDb.cash) === TOTAL && c(afterDb.cash) === TOTAL;
  const s = ms => (ms / 1000).toFixed(1);
  console.log(`  BEFORE  the gift form, ten times:   ${s(beforeMs)}s   ${beforeSteps} interactions`);
  console.log(`  AFTER   one deposit sheet:          ${s(afterMs)}s   ${afterSteps} interactions`);
  console.log(`  both runs landed the same money:    ${beforeDb.n}/${afterDb.n} gifts, ${(TOTAL / 100).toFixed(2)} each — ${okBoth ? "EQUAL" : "NOT EQUAL"}`);
  console.log(`\n  ${(beforeMs / afterMs).toFixed(1)}× faster, ${beforeSteps} interactions down to ${afterSteps}.`);
  await pool.end();
  process.exit(okBoth ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
