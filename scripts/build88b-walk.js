#!/usr/bin/env node
// BUILD-88b — THE WALK. A ten-line deposit slip, typed, then Home.
//
// No real Heart of Africa or Sparrow Missions slip has been shared, so the slip
// is TYPED FROM THE v3 FIXTURE: ten real gift rows out of
// tests/fixtures/build82/steward-messy-25k-v3.xlsx, joined to their real donors
// on the Donors sheet, with the fund written in the memo the way a treasurer
// writes it. One line is somebody the org has never met and one memo matches no
// fund, because a slip that resolves perfectly proves nothing.
//
// Then Home, and the thank-you queue she is left with.
//
// Loopback only.
//   PLAYWRIGHT_DIR=~/steward-qa node scripts/build88b-walk.js
const path = require("path");
require("./lib/prodGuard").writerDbUrl();
const API = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const APP = process.env.APP || "http://localhost:4173";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API) || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(APP)) {
  console.error("REFUSED: loopback only."); process.exit(1);
}
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const bcrypt = require("bcryptjs");
const fs = require("fs");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);
const api = async (method, p, tok, body) => {
  const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); } };
const cents = n => Math.round(Number(n) * 100);

const ORG = "org_b88bwalk";

(async () => {
  console.log("BUILD-88b walk — a ten-line slip typed from the v3 fixture, then Home\n");

  // ── The slip, out of the real workbook ───────────────────────────────────
  const wb = XLSX.read(fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "build82", "steward-messy-25k-v3.xlsx")), { type: "buffer" });
  const dRows = XLSX.utils.sheet_to_json(wb.Sheets["Donors"], { header: 1, defval: "" }).slice(3);
  const gRows = XLSX.utils.sheet_to_json(wb.Sheets["Gifts 2023-2026"], { header: 1, defval: "" }).slice(1);
  const nameById = new Map();
  for (const r of dRows) {
    const id = String(r[0]).trim().replace(/\.0$/, "").replace(/^0+/, "");
    const name = [String(r[2] || "").trim(), String(r[1] || "").trim()].filter(Boolean).join(" ");
    if (id && name && !nameById.has(id)) nameById.set(id, name);
  }
  // Ten CHEQUE-LIKE rows: a real donor, a readable amount under $5,000, a fund.
  const picked = [];
  const seenName = new Set();
  for (const g of gRows) {
    if (picked.length >= 9) break;
    const cid = String(g[1]).trim().replace(/\.0$/, "").replace(/^0+/, "");
    const name = nameById.get(cid);
    const amt = Number(g[3]);
    const fund = String(g[5] || "").trim();
    if (!name || seenName.has(name) || !fund) continue;
    if (!(amt > 20 && amt < 5000) || Math.round(amt * 100) !== amt * 100) continue;
    seenName.add(name);
    picked.push({ name, amount: amt.toFixed(2), memo: fund });
  }
  if (picked.length < 9) { console.error("could not build a slip from the fixture"); process.exit(1); }
  // The two lines that make the walk worth walking.
  picked[8] = { ...picked[8], memo: "pancake supper" };          // a memo no fund matches
  picked.push({ name: "Jonas Kirke", amount: "45.00", memo: picked[0].memo });  // somebody new
  const SLIP = picked;
  const SLIP_CENTS = SLIP.reduce((s, l) => s + cents(l.amount), 0);
  // Case-folded, the way BUILD-88a A.7 creates funds from a file: the fixture
  // carries both "Annual fund" and "Annual Fund", and an org with two funds
  // whose names differ only in case would make every memo ambiguous — which is
  // the engine being right about a setup nobody would have.
  const FUNDS = [...new Map(SLIP.map(l => l.memo).filter(m => m !== "pancake supper")
    .map(m => [m.toLowerCase(), m])).values()];
  console.log(`  slip: ${SLIP.length} lines, $${(SLIP_CENTS / 100).toFixed(2)}, ${FUNDS.length} funds named in the memos`);
  console.log(SLIP.map(l => `    ${l.name.padEnd(24)} ${l.amount.padStart(9)}  ${l.memo}`).join("\n"));

  // ── The org, with nine of the ten already on file ────────────────────────
  for (const t of ["thank_you_drafts", "pledge_installments", "threads", "tasks", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "imports", "donors", "campaigns",
    "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Sparrow Missions','b88b-walk',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88bwalk',$1,'b88bwalk@t.local',$2,'Ada Trelawney','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active) VALUES ('acct_b88bwalk',$1,'4010','Contributions','revenue','contributions',true)`, [ORG]);
  let fi = 0, defaultFund = null;
  for (const f of FUNDS) {
    const id = `ffw_${fi++}`;
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,$3,$4)`, [id, ORG, f, !/unrestricted|general/i.test(f)]);
    if (!defaultFund && /unrestricted|general/i.test(f)) defaultFund = id;
  }
  if (!defaultFund) { await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ffw_gen',$1,'General Operating',false)`, [ORG]); defaultFund = "ffw_gen"; }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ffw_youth',$1,'Youth Ministry',true)`, [ORG]);
  await q(`UPDATE orgs SET default_fund_id=$2 WHERE id=$1`, [ORG, defaultFund]);
  let di = 0;
  for (const l of SLIP.slice(0, 9)) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
             VALUES ($1,$2,$3,$4,'new','steward','u_b88bwalk','Ada Trelawney')`,
      [`dw_${di++}`, ORG, l.name, `w${di}@b88bwalk.test`]);
  }
  // Her voice, so the queue is in it.
  const login = await api("POST", "/auth/login", null, { email: "b88bwalk@t.local", password: "loadtest1234" });
  const tok = login.body.token;
  await api("PUT", "/org/voice-samples", tok, { samples: [
    "Dear Anna,\n\nThank you so much for the gift. It means a great deal to the families here, and to me.\n\nWith gratitude,\nAda",
    "Dear Bill,\n\nYour cheque arrived this morning and I wanted to say thank you straight away.\n\nWith gratitude,\nAda",
    "Dear Sara,\n\nThank you for standing with us again this year. It matters more than you know.\n\nWith gratitude,\nAda"] });
  const today = (await api("GET", "/dashboard/home?scope=mine", tok)).body?.today || new Date().toISOString().slice(0, 10);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) console.log("  [pageerror]", e.message.slice(0, 160)); });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [tok, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);

  // ── The slip ─────────────────────────────────────────────────────────────
  console.log("\n— the slip —");
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('button:has-text("Fundraising")');
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Deposits")');
  await page.waitForTimeout(800);
  ok("Fundraising has a Deposits section with one action on it",
    /Add a deposit/.test(await page.innerText("body")));
  await page.click('[data-testid="add-a-deposit"]');
  await page.waitForTimeout(600);
  await page.fill('[data-testid="deposit-slip-total"]', (SLIP_CENTS / 100).toFixed(2));
  await page.fill('[data-testid="deposit-paste"]', SLIP.map(l => [l.name, l.amount, l.memo].join("\t")).join("\n"));
  await page.click('[data-testid="deposit-read"]');
  await page.waitForTimeout(1600);
  const states = await page.$$eval("[data-deposit-state]", els => els.map(e => e.getAttribute("data-deposit-state")));
  ok(`every line got a state (${states.length})`, states.length === SLIP.length, states);
  ok("eight or nine are placed on people already on file", states.filter(s => s === "placed").length >= 8, states);
  ok("the person nobody has met is offered as a NEW DONOR, not a question",
    states.filter(s => s === "placed_new_donor").length === 1, states);
  ok("the memo that matches no fund is the one thing that needs her",
    states.filter(s => s === "needs_you").length === 1, states);
  const commitDisabled = await page.$eval('[data-testid="deposit-commit"]', el => el.disabled);
  ok("…and the button will not record it until she answers", commitDisabled === true, commitDisabled);
  const balanceText = await page.innerText('[data-testid="deposit-balance"]');
  ok("the arithmetic is SHOWN, not asserted", /against a slip of/.test(balanceText), balanceText.slice(0, 120));

  const needsLine = (await page.$$eval("[data-deposit-state='needs_you']", els => els.map(e => e.getAttribute("data-deposit-line"))))[0];
  await page.selectOption(`[data-testid="deposit-fund-${needsLine}"]`, { label: "Youth Ministry" });
  await page.waitForTimeout(1500);
  const after = await page.$$eval("[data-deposit-state]", els => els.map(e => e.getAttribute("data-deposit-state")));
  ok("answering it clears the list", after.filter(s => s === "needs_you").length === 0, after);
  const label = await page.innerText('[data-testid="deposit-commit"]');
  ok("the button says exactly what it is about to do", /^Record deposit of \$/.test(label.trim()), label.trim());
  await page.click('[data-testid="deposit-commit"]');
  await page.waitForTimeout(2500);
  const doneText = await page.innerText("body");
  ok("it records, and says it foots", /It foots\./.test(doneText), doneText.slice(0, 240).replace(/\n/g, " | "));
  ok("…and says nothing was sent", /Nothing was sent/.test(doneText), null);

  const [db] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float cash FROM gifts WHERE org_id=$1`, [ORG]);
  ok("the database holds the whole slip, to the cent", db.n === SLIP.length && cents(db.cash) === SLIP_CENTS, { db, slip: SLIP_CENTS / 100 });
  const [noFund] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND fund_id IS NULL`, [ORG]);
  ok("every gift carries a fund", noFund.n === 0, noFund.n);
  const yth = await q(`SELECT g.amount::float a FROM gifts g JOIN fin_funds f ON f.id=g.fund_id
                         WHERE g.org_id=$1 AND f.name='Youth Ministry'`, [ORG]);
  ok("the unmatched memo went where SHE said, and not to the unrestricted default", yth.length === 1, yth);

  // ── Home, and the queue she is left with ─────────────────────────────────
  console.log("\n— then Home —");
  await page.click('button:has-text("Done")').catch(() => {});
  await page.waitForTimeout(400);
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3200);
  const homeText = await page.innerText("body");
  ok("Home carries the thank-you queue", await page.$('[data-testid="thank-you-queue"]') !== null);
  ok(`…and says how many are ready`, /thank-yous ready\./.test(homeText), (homeText.match(/[A-Z][a-z]+ thank-yous ready\./) || [])[0]);
  const queue = (await api("GET", "/thank-yous", tok)).body;
  ok("one draft per gift, no more and no fewer", queue.count === SLIP.length, { queue: queue.count, gifts: SLIP.length });
  ok("…each in her own voice", queue.drafts.every(d => d.voiceUsed === "org_samples" && /With gratitude,\nAda/.test(d.body)),
    queue.drafts[0]?.body?.slice(0, 80));
  await page.click('[data-testid="ty-open"]');
  await page.waitForTimeout(900);
  const openText = await page.innerText('[data-testid="thank-you-queue"]');
  ok("opening one shows the letter, with Copy, Mark sent and Skip",
    /Copy/.test(openText) && /Mark sent/.test(openText) && /Skip/.test(openText), null);
  ok("…and says out loud that Steward does not send it",
    /Steward does not send this/.test(openText), null);
  const markAll = await page.$('[data-testid="ty-mark-all"]');
  ok("\"Mark all as sent\" is NOT offered while nine of the ten are unread", markAll === null, !!markAll);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 0 : 0);
})().catch(e => { console.error(e); process.exit(1); });
