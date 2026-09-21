#!/usr/bin/env node
// BUILD-88a — THE WALK. Log a conversation on the demo org with a gift and a
// next step, in a real browser, then ask every reader what it holds.
//
// The brief's own list: "log a conversation on the demo org with a gift and a
// next step; confirm the gift on the header, Board dashboard and ledger, and
// the step on the profile, Home and the morning email."
//
// Loopback only. Reads the app at :4173 and the API at :5601 (BASE).
//   PLAYWRIGHT_DIR=~/steward-qa node scripts/build88a-walk.js

const path = require("path");
const fs = require("fs");
require("./lib/prodGuard").writerDbUrl();

const API = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const APP = process.env.APP || "http://localhost:4173";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API) || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(APP)) {
  console.error("REFUSED: this walk is loopback only."); process.exit(1);
}
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
};
const cents = n => Math.round(Number(n) * 100);
const api = async (method, p, tok, body) => {
  const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

(async () => {
  console.log("BUILD-88a walk — the demo org, a conversation, a gift and a next step\n");
  const ORG = "org_creo";
  // Env-overridable so rotating the demo password cannot silently break this
  // walk (BUILD-93 Part 2 — every other script already honoured an override;
  // this one hardcoded it).
  const login = await api("POST", "/auth/login", null, {
    email: process.env.DEMO_EMAIL || "admin@creoarts.org",
    password: process.env.DEMO_PASSWORD || "demo1234",
  });
  if (login.status !== 200) { console.error("could not sign in to the demo org:", login.status); process.exit(1); }
  const tok = login.body.token;

  // A donor with nothing open, so the walk's own thread is unambiguous.
  const [donor] = await q(
    `SELECT d.id, d.name, d.total_giving::float AS total FROM donors d
       WHERE d.org_id=$1 AND d.deleted_at IS NULL AND d.email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.donor_id=d.id AND t.closed_at IS NULL)
       ORDER BY d.created_at LIMIT 1`, [ORG]);
  if (!donor) { console.error("no demo donor without an open thread"); process.exit(1); }
  console.log(`  walking on: ${donor.name} (${donor.id}), lifetime ${donor.total}\n`);

  const beforeGifts = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  const beforeBoard = ((await api("GET", "/dashboards/board", tok)).body.metrics || []).find(m => m.key === "revenueThisYear")?.value || 0;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 200)));
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [tok, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);

  // ── the conversation, with a gift and a next step ─────────────────────────
  await page.goto(`${APP}/donors/${donor.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  ok("the profile opens", /Log a conversation/.test(await page.innerText("body")));
  await page.click('button:has-text("Log a conversation")');
  await page.waitForTimeout(700);
  await page.click('button:has-text("Gift received")');
  await page.fill('input[placeholder^="One line"]', "She brought the cheque to the office.");
  await page.fill('[data-testid="conv-gift-amount"]', "1250.75");
  await page.waitForTimeout(400);
  ok("typing an amount reveals the fund and the method, inline",
    await page.$('[data-testid="conv-gift-detail"]') !== null);
  const fundOptions = await page.$eval('[aria-label="Fund"]', el => [...el.options].map(o => o.textContent));
  const offeredDefault = fundOptions[0];
  await page.selectOption('[aria-label="Payment method"]', "Check");
  await page.fill('[aria-label="Next step"]', "Send the impact report");
  await page.waitForTimeout(300);
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(2000);

  // ── the gift, through every reader ────────────────────────────────────────
  console.log("\n— the gift —");
  const [g] = await q(
    `SELECT g.id, g.amount::float AS amount, g.fund_id, g.payment_method, f.name AS fund_name
       FROM gifts g LEFT JOIN fin_funds f ON f.id=g.fund_id
      WHERE g.org_id=$1 AND g.donor_id=$2 ORDER BY g.created_at DESC LIMIT 1`, [ORG, donor.id]);
  ok("ONE gift row was written", cents(g?.amount) === cents(1250.75), g);
  ok("…with a fund", !!g?.fund_id, g?.fund_name);
  // The defect this walk found the first time it ran: the form named one fund
  // and the write used another.
  ok("…and it is the SAME fund the form said it would use",
    g?.fund_name === offeredDefault, { offered: offeredDefault, written: g?.fund_name });
  ok("…and the payment method the form said", g?.payment_method === "Check", g?.payment_method);
  const afterGifts = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  ok("exactly one gift was added to the org, not two", afterGifts === beforeGifts + 1, { before: beforeGifts, after: afterGifts });

  const ints = await q(`SELECT id, type, note, gift_id FROM interactions WHERE org_id=$1 AND donor_id=$2 AND gift_id=$3`, [ORG, donor.id, g.id]);
  ok("ONE timeline entry links to it", ints.length === 1, ints);
  ok("…typed `gift`, never `other`", ints[0]?.type === "gift", ints[0]?.type);
  ok("…carrying her words and NO copy of the amount",
    /brought the cheque/.test(ints[0]?.note || "") && !/\$\s*[\d,]/.test(ints[0]?.note || ""), ints[0]?.note);

  const [dRow] = await q(`SELECT total_giving::float AS t FROM donors WHERE id=$1`, [donor.id]);
  ok("the header lifetime total moved by exactly the gift",
    cents(dRow.t) === cents(donor.total) + cents(1250.75), { before: donor.total, after: dRow.t });
  const afterBoard = ((await api("GET", "/dashboards/board", tok)).body.metrics || []).find(m => m.key === "revenueThisYear")?.value || 0;
  ok("Giving this year on the Board dashboard moved by the same amount, to the cent",
    cents(afterBoard) === cents(beforeBoard) + cents(1250.75), { before: beforeBoard, after: afterBoard });
  const txns = await q(`SELECT id, amount::float AS amount, fund_id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, g.id]);
  ok("the Finance ledger holds it ONCE, in the same fund",
    txns.length === 1 && cents(txns[0].amount) === cents(1250.75) && txns[0].fund_id === g.fund_id, txns);

  // ── the step, through every reader ────────────────────────────────────────
  console.log("\n— the next step —");
  const prof = await api("GET", `/threads?donorId=${donor.id}`, tok);
  ok("the profile shows the step", (prof.body.list || []).some(x => x.nextStep.label === "Send the impact report"),
    (prof.body.list || []).map(x => x.nextStep.label));
  ok("…with a count of what is open on this donor", prof.body.stat?.open >= 1, prof.body.stat);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  ok("…and it is on the rendered record", /Send the impact report/.test(await page.innerText("body")));

  const home = await api("GET", "/threads?scope=mine", tok);
  ok("Home carries it too", (home.body.list || []).some(x => x.nextStep.label === "Send the impact report"),
    (home.body.list || []).slice(0, 4).map(x => x.nextStep.label));

  // The morning email, dry-run so the walk sends nothing.
  const [thread] = await q(`SELECT due_date FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, donor.id]);
  const brief = await api("POST", "/nudges/run", tok, { today: thread?.due_date, force: true, dryRun: true });
  ok("the morning brief would carry it on its due date",
    brief.status === 200 && (brief.body.sent || []).some(s => s.threads > 0),
    { status: brief.status, sent: (brief.body.sent || []).map(s => ({ threads: s.threads, tasks: s.tasks })) });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
