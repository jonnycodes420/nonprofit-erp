// NUMBERS-6 · THE TOTALS KEPT ON A PERSON CAN'T GO STALE.
//
// The one test this build earns (it guards money). Every write that touches a
// gift or a person's totals is driven here, through the same doors a person
// uses, and after EACH one the nightly check (scripts/ci/check-numbers.js
// checkOrg) is run on the org. A path that leaves `donor-stored`,
// First/Largest/Last or a row pointing at a removed gift red is named in the
// table this prints, and fails the suite.
//
// The paths: the gift form (recordGift), an edit of amount, date, fund and
// split, a delete, a refund (full and partial) and its undo, a merge and its
// undo, an erase, the donors file with stated totals, the combined file (a
// recent gift and one older than 30 days, with and without a stated total)
// and its undo, the gift-history file and its undo, sample data in and out, a
// deposit and its undo, Stripe (a gift, a partial and a full refund, a lost
// dispute), a recurring charge, and emptying the trash.
//
// WHAT WOULD MAKE THIS FAIL (each planted and seen red, NUMBERS-6 report):
//   · sample data writes its people with stated totals and no recompute (main
//     before this build: donor-stored on every sample person with gifts);
//   · emptying the trash takes a person's gifts and leaves their ledger line
//     pointing at a gift that is gone (main: `removed`);
//   · an import undo that deletes gifts without unlinking a pledge's
//     fulfilled gift (planted: the FK refuses, the undo fails);
//   · scripts/ops/numbers6-recompute.js run without --org (it must refuse).
//
//   BASE=http://localhost:5601 node tests/numbers6-stored.test.js
"use strict";
const bcrypt = require("bcryptjs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ok, summary, q, closeDb, login, api, BASE, civilToday, civilPlusDays, importWorkSettled } = require("./helpers");

const ORG = "org_n6stored";
const ADMIN = "director@n6stored.local";
const ACCT = "acct_n6stored";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const RULES = ["donor-stored", "donor-first-largest-last", "removed"];
const P = s => `d_n6_${s}`;
const SAMPLE = "org_n6sample", SAMPLE_ADMIN = "director@n6sample.local";
let stok;

async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}

async function fixture() {
  await clear(ORG);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id)
           VALUES ($1,'Stored Totals Harbour','n6stored',1,'active','team','America/New_York',$2)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_n6_admin',$1,$2,$3,'Wren Tallis','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acct4010_n6',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_n6_gen',$1,'General',false), ('ff_n6_bld',$1,'Building',true)`, [ORG]);
  for (const [id, name] of [["ada", "Ada Quillon"], ["ben", "Ben Marrow"], ["cy", "Cy Fennick"], ["cy2", "Cy Fennick"], ["dot", "Dot Ashby"], ["eli", "Eli Brank"]])
    await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','cultivate','system:test','test')`,
      [P(id), ORG, name, `${id}@n6.test`]);
}

let checkOrg;
async function counts(org = ORG) {
  const r = await checkOrg(org, {});
  const by = Object.fromEntries(r.problems.map(p => [p.rule, p.count]));
  return { by, examples: r.problems.filter(p => RULES.includes(p.rule)).map(p => ({ rule: p.rule, e: p.examples.slice(0, 2) })) };
}

const table = [];
async function step(name, fn, org = ORG) {
  let note = "";
  try { note = (await fn()) || ""; }
  catch (e) { note = `threw: ${e.message}`; }
  await importWorkSettled(org, { timeout: 20000 }).catch(() => {});
  const c = await counts(org);
  const bad = RULES.filter(r => c.by[r]);
  table.push({ name, stored: c.by["donor-stored"] || 0, fll: c.by["donor-first-largest-last"] || 0, removed: c.by.removed || 0, note });
  ok(`${name}: no stored total, First/Largest/Last or removed-gift row is left wrong`, !bad.length && !/^threw/.test(note), { note, ...c });
  return c;
}

async function stripeEvent(evt) {
  const stripe = require("stripe")("sk_test_dummy");
  const payload = JSON.stringify({ account: ACCT, ...evt });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const must = (r, what, codes = [200, 201]) => { if (!codes.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body; };

(async () => {
  console.log("numbers6-stored (NUMBERS-6)");
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
  const cwd = process.cwd();
  ({ checkOrg } = require("../scripts/ci/check-numbers"));
  process.chdir(cwd);
  await fixture();
  const tok = await login(ADMIN);
  const T = civilToday(), D = n => civilPlusDays(-n);
  let g1, g2, g3, refundId;

  await step("gift form (recordGift)", async () => {
    g1 = must(await api("POST", `/donors/${P("ada")}/gifts`, tok, { amount: 120, date: D(40), type: "cash", fund_id: "ff_n6_gen" }), "gift").gift.id;
    g2 = must(await api("POST", `/donors/${P("ada")}/gifts`, tok, { amount: 80, date: D(10), type: "cash", fund_id: "ff_n6_gen" }), "gift").gift.id;
    g3 = must(await api("POST", `/donors/${P("ada")}/gifts`, tok, { amount: 300, date: D(5), type: "cash", fund_id: "ff_n6_gen" }), "gift").gift.id;
  });
  await step("gift edit: amount", async () => { must(await api("PUT", `/gifts/${g2}`, tok, { amount: 95 }), "edit"); });
  await step("gift edit: date (to the latest)", async () => { must(await api("PUT", `/gifts/${g1}`, tok, { date: D(1) }), "edit"); });
  await step("gift edit: fund", async () => { must(await api("PUT", `/gifts/${g1}`, tok, { fund_id: "ff_n6_bld" }), "edit"); });
  await step("gift edit: split", async () => {
    must(await api("PUT", `/gifts/${g3}`, tok, { fundLines: [{ fundId: "ff_n6_gen", amount: 200 }, { fundId: "ff_n6_bld", amount: 100 }] }), "split");
  });
  await step("refund: partial", async () => {
    refundId = must(await api("POST", `/gifts/${g3}/refund`, tok, { amount: 50, reason: "asked back" }), "refund").refundId;
  });
  await step("refund: undo (the refund row deleted)", async () => { must(await api("DELETE", `/gifts/${refundId}`, tok), "undo refund"); });
  await step("refund: full", async () => {
    refundId = must(await api("POST", `/gifts/${g1}/refund`, tok, { amount: 120, reason: "duplicate card" }), "refund").refundId;
  });
  await step("refund: undo of the full refund", async () => { must(await api("DELETE", `/gifts/${refundId}`, tok), "undo refund"); });
  await step("gift delete (the latest gift)", async () => { must(await api("DELETE", `/gifts/${g1}`, tok), "delete"); });

  // A merge, and its undo.
  let mergeId;
  await step("merge", async () => {
    must(await api("POST", `/donors/${P("cy")}/gifts`, tok, { amount: 40, date: D(30), type: "cash", fund_id: "ff_n6_gen" }), "gift");
    must(await api("POST", `/donors/${P("cy2")}/gifts`, tok, { amount: 60, date: D(3), type: "cash", fund_id: "ff_n6_gen" }), "gift");
    const pair = must(await api("GET", `/data-health/pair?a=${P("cy")}&b=${P("cy2")}&keep=${P("cy")}`, tok), "pair");
    mergeId = must(await api("POST", "/data-health/merge", tok, { keptId: P("cy"), mergedId: P("cy2"), choices: pair.choices || {} }), "merge").mergeId;
  });
  await step("merge undo", async () => { must(await api("POST", `/data-health/merges/${mergeId}/undo`, tok, {}), "merge undo"); });
  await step("erase", async () => {
    must(await api("POST", `/donors/${P("dot")}/gifts`, tok, { amount: 25, date: D(2), type: "cash", fund_id: "ff_n6_gen" }), "gift");
    must(await api("POST", `/donors/${P("dot")}/erase`, tok, { confirm: "ERASE" }), "erase");
  });

  // The files.
  let donorsRun;
  await step("donors file with stated totals", async () => {
    donorsRun = must(await api("POST", "/donors/import", tok, { sourceName: "Old CRM (test)", donors: [
      { name: "Fay Orrin", email: "fay@n6.test", total: "1,250.00", gifts: "5", lastGift: D(400), lastAmount: "250" },
      { name: "Gus Pell", email: "gus@n6.test", total: "75" },
    ] }), "donors file");
  });
  let combined;
  await step("combined file: a recent gift and one older than 30 days, a stated total and none", async () => {
    combined = "imp_n6comb" + require("crypto").randomBytes(4).toString("hex");
    must(await api("POST", "/donors/import-combined", tok, {
      importId: combined, sourceName: "Combined (test)",
      donors: [{ name: "Hal Winsor", email: "hal@n6.test", total: "900" }, { name: "Ivy Strand", email: "ivy@n6.test" }],
      gifts: [{ donorIndex: 0, amount: 100, date: D(200), type: "cash", externalId: "N6-1" },
              { donorIndex: 1, amount: 45, date: D(5), type: "cash", externalId: "N6-2" },
              { donorIndex: 1, amount: 70, date: D(90), type: "cash", externalId: "N6-3" }],
    }), "combined");
    must(await api("POST", "/imports", tok, { id: combined, name: "combined.csv", shape: "transaction", rowsIn: 3, giftsCreated: 3, donorsCreated: 2, summary: {} }), "record run");
  });
  let history;
  await step("gift-history file: gifts for people already here (recent and old)", async () => {
    history = "imp_n6hist" + require("crypto").randomBytes(4).toString("hex");
    must(await api("POST", "/gifts/import-history", tok, { importId: history, gifts: [
      { donorId: P("ben"), amount: 300, date: D(400), type: "cash" },
      { donorId: P("ben"), amount: 30, date: D(4), type: "cash" },
      { donorId: P("eli"), amount: 500, date: D(60), type: "cash" },
    ] }), "history");
    must(await api("POST", "/imports", tok, { id: history, name: "history.csv", shape: "gifts", rowsIn: 3, giftsCreated: 3, summary: {} }), "record run");
  });
  const runOf = id => id;
  await step("gift-history file undo", async () => { must(await api("POST", `/imports/${runOf(history)}/reverse`, tok, {}), "history undo", [200, 201, 202]); });
  await step("combined file undo", async () => { must(await api("POST", `/imports/${runOf(combined)}/reverse`, tok, {}), "combined undo", [200, 201, 202]); });

  // Sample data, in and out.
  // Sample data loads only into an org with no data: its own org.
  await step("sample data loaded (its own org)", async () => {
    await clear(SAMPLE);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Stored Totals Sample','n6sample',1,'active','team','America/New_York')`, [SAMPLE]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_n6_sample',$1,$2,$3,'Moss Ferrel','admin')`, [SAMPLE, SAMPLE_ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
    stok = await login(SAMPLE_ADMIN);
    must(await api("POST", "/org/load-sample-data", stok, {}), "sample");
  }, SAMPLE);
  await step("sample data cleared", async () => { must(await api("POST", "/org/clear-sample-data", stok, {}), "clear sample"); }, SAMPLE);

  // A deposit, and its undo.
  let dep;
  await step("deposit", async () => {
    dep = must(await api("POST", "/deposits/commit", tok, { paste: `Ben Marrow\t100.00\t1042\nEli Brank\t50.00\t1043`, depositDate: T, slipTotal: 150,
      resolutions: { 1: { fundId: "ff_n6_gen" }, 2: { fundId: "ff_n6_gen" } }, lines: [] }), "deposit");
  });
  await step("deposit undo", async () => { must(await api("POST", `/imports/${dep.id}/reverse`, tok, {}), "deposit undo", [200, 201, 202]); });

  // Stripe: a gift, a partial refund, a full refund, a lost dispute; a recurring charge.
  const pi = n => ({ id: `evt_n6_pi_${n}`, type: "payment_intent.succeeded", data: { object: { id: `pi_n6_${n}`, amount_received: 5000 * n, receipt_email: "web@n6.test", metadata: { donor_name: "Web Giver" } } } });
  await step("Stripe: a gift", async () => { for (const n of [1, 2, 3]) must(await stripeEvent(pi(n)), "stripe gift"); });
  await step("Stripe: a partial refund", async () => {
    must(await stripeEvent({ id: "evt_n6_rf1", type: "charge.refunded", data: { object: { id: "ch_n6_1", payment_intent: "pi_n6_2", amount: 10000, amount_refunded: 2500 } } }), "partial refund");
  });
  await step("Stripe: a full refund", async () => {
    must(await stripeEvent({ id: "evt_n6_rf2", type: "charge.refunded", data: { object: { id: "ch_n6_2", payment_intent: "pi_n6_3", amount: 15000, amount_refunded: 15000 } } }), "full refund");
  });
  await step("Stripe: a lost dispute", async () => {
    must(await stripeEvent({ id: "evt_n6_dp1", type: "charge.dispute.closed", data: { object: { id: "dp_n6_1", payment_intent: "pi_n6_1", amount: 5000, status: "lost" } } }), "dispute");
  });
  await step("Stripe: a recurring charge", async () => {
    await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_n6',$1,$2,'sub_n6_test',25,'month','active')`, [ORG, P("eli")]);
    must(await stripeEvent({ id: "evt_n6_inv1", type: "invoice.paid", data: { object: { id: "in_n6_1", subscription: "sub_n6_test", payment_intent: "pi_n6_rec1", amount_paid: 2500, customer_email: "eli@n6.test", billing_reason: "subscription_cycle" } } }), "recurring");
  });

  // A scheduled gift's day comes (the clock is moved by moving the gift: dated
  // and scheduled for yesterday, as it reads the morning after its day).
  let sched;
  await step("a scheduled gift is recorded", async () => {
    sched = must(await api("POST", `/donors/${P("eli")}/gifts`, tok, { amount: 410, date: civilPlusDays(2), type: "cash", fund_id: "ff_n6_gen" }), "scheduled").gift.id;
  });
  await step("its day comes, then the hourly tick (server/numbers/cameDue.js)", async () => {
    await q(`UPDATE gifts SET date=$1, scheduled_on=$1 WHERE id=$2 AND org_id=$3`, [D(1), sched, ORG]);
    const before = (await counts()).by["donor-stored"] || 0;
    ok("without the tick, the stored totals are short the gift whose day came (the leak it closes)", before > 0, before);
    const r = await require("../server/numbers/cameDue").recomputeCameDue(require("../db").query, { orgId: ORG });
    return `tick recomputed ${r.people}`;
  });

  // Every boot ran keepEarlierTotals on every org (server/db/ddl/part1.js). Its
  // first-gift statement counted a soft credit row as someone's first gift.
  await step("boot: keepEarlierTotals (narrowed to this org)", async () => {
    must(await api("POST", `/donors/${P("eli")}/gifts`, tok, { amount: 90, date: D(700), type: "soft credit", fund_id: "ff_n6_gen" }), "credit row");
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
    try { await require("../server/db/seed").keepEarlierTotals(pool, ORG); } finally { await pool.end(); }
  });

  // The trash: a person with a gift on the ledger, deleted, then the trash emptied.
  await step("delete a person, then empty the trash", async () => {
    must(await api("POST", `/donors/${P("ben")}/gifts`, tok, { amount: 65, date: D(6), type: "cash", fund_id: "ff_n6_gen" }), "gift");
    must(await api("DELETE", `/donors/${P("ben")}`, tok), "delete person");
    must(await api("POST", "/donors/purge-trash", tok, { confirm: "empty" }), "purge");
  });

  // ── item 2: one function writes the stored totals ──────────────────────
  const guard = require("../scripts/ci/stored-totals-guard");
  const hits = guard.scan();
  ok("no file writes total_giving, gift_count or the dates in its own SQL (scripts/ci/stored-totals-guard.js)", hits.length === 0, hits);
  ok("the guard can fail: a recompute restored to its own SQL is named",
    guard.scanText("await query(`UPDATE donors d SET total_giving = (SELECT SUM(amount) FROM gifts g WHERE g.donor_id = d.id) WHERE d.org_id = $1`, [orgId]);").length === 1
    && guard.scanText("UPDATE donors SET stage = CASE WHEN total_giving = 0 THEN 'prospect' END WHERE org_id = ?").length === 0);

  // ── item 3: the after-battery check fails on a stale stored total ───────
  const others = (await q(`SELECT id FROM orgs WHERE id <> $1`, [ORG])).map(r => r.id);
  const beforeFile = path.join(require("os").tmpdir(), `n6-before-${process.pid}.txt`);
  require("fs").writeFileSync(beforeFile, others.join("\n"));
  const after = () => { try { return { rc: 0, out: execFileSync("node", ["scripts/ci/after-battery-numbers.js", "--before", beforeFile], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8" }) }; }
    catch (e) { return { rc: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; } };
  const clean = after();
  ok("after the battery, this org adds up", clean.rc === 0, clean.out.slice(-300));
  await q(`UPDATE donors SET total_giving = total_giving + 1 WHERE id=$1 AND org_id=$2`, [P("ada"), ORG]);
  const red = after();
  ok("…and a stale stored total left in it fails the check", red.rc === 1 && /FAIL\s+org_n6stored: 1 donor-stored/.test(red.out), red.out.slice(-300));
  await q(`UPDATE donors SET total_giving = total_giving - 1 WHERE id=$1 AND org_id=$2`, [P("ada"), ORG]);

  // ── item 4: the recompute refuses without --org ─────────────────────────
  let refused = null;
  try { execFileSync("node", ["scripts/ops/numbers6-recompute.js"], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8", stdio: "pipe" }); refused = { rc: 0 }; }
  catch (e) { refused = { rc: e.status, out: String(e.stderr || "") }; }
  ok("scripts/ops/numbers6-recompute.js refuses to run without --org", refused.rc === 2 && /REFUSED: name one org/.test(refused.out || ""), refused);
  await q(`UPDATE donors SET last_gift_date = '2001-01-01' WHERE id=$1 AND org_id=$2`, [P("ada"), ORG]);
  const dry = execFileSync("node", ["scripts/ops/numbers6-recompute.js", "--org", ORG], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8" });
  ok("its dry run counts by field and names no one", /people whose stored totals would change: 1/.test(dry) && /last_gift_date\s+1/.test(dry) && !/d_n6_|Ada|\$/.test(dry), dry);
  const applied = execFileSync("node", ["scripts/ops/numbers6-recompute.js", "--org", ORG, "--apply"], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8" });
  const [auditRow] = await q(`SELECT user_id, record_count FROM fin_audit_log WHERE org_id=$1 AND action='numbers6 recompute' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("…and --apply recomputes it, writes its audit row as system:numbers6-recompute, and the check reads 0 after", (await counts()).by["donor-stored"] === undefined
    && auditRow && auditRow.user_id === "system:numbers6-recompute" && /stored totals that disagree\s+1\s+0/.test(applied), { applied: applied.slice(-400), auditRow });

  console.log("\n  path                                                          stored  F/L/L  removed");
  for (const r of table) console.log(`  ${r.name.padEnd(62)} ${String(r.stored).padStart(6)} ${String(r.fll).padStart(6)} ${String(r.removed).padStart(8)}${r.note ? "   " + r.note : ""}`);
  summary();
  await closeDb();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
