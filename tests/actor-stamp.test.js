// BUILD-75 C.1 — THE ACTOR ON EVERY WRITE.
//
// Every row that represents something someone DID records who did it — an
// IDENTITY (a user id, or a system identity like "system:stripe-webhook"),
// never a boolean. "Who logged this note" / "who imported these four hundred
// rows" are questions a development office asks constantly, and the answer
// exists only at write time. This suite is the class guard:
//
//   §1  SOURCE: every `INSERT INTO <actor-table>` in server.js carries
//       created_by, with a total classification (script-guards style) — an
//       unclassified, unstamped insert FAILS, so a new write path must decide
//       its actor the day it is written.
//   §2  The scanner PROVEN to fail on a source tree where the defect exists
//       (per the CLAUDE.md guard rule: a guard never seen failing is not
//       known to guard).
//   §3  BEHAVIOR: real writes through the running API land with the right
//       actor — a human write carries the user, the Stripe webhook carries
//       system:stripe-webhook, sample-data loading carries the clicking user.
//
// db.js's seedData (org_creo demo fiction) is deliberately out of scope: the
// demo seed is not "something someone did" in any org's history.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");

const ACTOR_TABLES = ["gifts", "donors", "pledges", "tasks", "campaigns", "grants", "events",
  "households", "opportunities", "receipts", "giving_pages", "planned_gifts",
  "volunteers", "board_members", "fin_transactions", "sequences",
  // BUILD-78 Part 9 — schema-shaped writes and custom-value audit events
  // carry an identity like everything else.
  "custom_field_defs", "custom_field_events"];

// Classified exceptions — each insert matched here is allowed WITHOUT a
// literal created_by column, for the stated reason.
const CLASSIFIED = [
  [/INSERT INTO gifts \(\$\{cols\.join\(","\)\}\)/,
   "dispute-reinstatement re-inserts the FROZEN row verbatim — the snapshot already carries the original created_by"],
];

// ── the scanner (pure — usable on a synthetic tree for §2) ──────────────────
function scanActorStamps(src) {
  const missing = [];
  for (const t of ACTOR_TABLES) {
    const re = new RegExp(`INSERT INTO ${t} [^;]{0,2000}?(?=\\)\\s*;|RETURNING|ON CONFLICT|VALUES)`, "g");
    // simpler + robust: examine each INSERT line plus its column list
    let idx = 0;
    while ((idx = src.indexOf(`INSERT INTO ${t} `, idx)) !== -1) {
      const slice = src.slice(idx, idx + 400);
      const colList = slice.slice(0, slice.indexOf(")") + 1);
      const classified = CLASSIFIED.some(([cre]) => cre.test(slice));
      if (!colList.includes("created_by") && !classified) missing.push(`${t} @ char ${idx}: ${slice.slice(0, 90).replace(/\n/g, " ")}`);
      idx += 10;
    }
  }
  return missing;
}

(async () => {
  console.log("actor-stamp (BUILD-75 C.1)");

  // ── §1 · source: total classification ──────────────────────────────────────
  console.log("\n— §1 · every INSERT into an actor table carries created_by —");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const missing = scanActorStamps(src);
  ok(`unstamped, unclassified inserts in server.js: ${missing.length}`, missing.length === 0, missing.slice(0, 8));

  // ── §2 · the scanner proven to fail where the defect exists ────────────────
  console.log("\n— §2 · the guard fails on a defective tree —");
  const badTree = `await run("INSERT INTO gifts (id,org_id,amount) VALUES (?,?,?)", [a,b,c]);`;
  ok("a stamped-less INSERT INTO gifts is flagged", scanActorStamps(badTree).length === 1, scanActorStamps(badTree));
  const okTree = `await run("INSERT INTO gifts (id,org_id,amount,created_by,created_by_name) VALUES (?,?,?,?,?)", [a,b,c,d,e]);`;
  ok("a stamped INSERT passes", scanActorStamps(okTree).length === 0, scanActorStamps(okTree));

  // ── §3 · behavior: real writes carry the right identity ────────────────────
  console.log("\n— §3 · live writes record their actor —");
  const ORG = "org_actorstamp";
  // FK-ordered: children before parents, donors last-but-one, org last —
  // a re-run against a populated scratch DB must reset cleanly.
  const RESET_ORDER = ["campaign_recipients", "receipts", "pledges", "milestone_drafts", "note_reminders", "donor_materials",
    "planned_gifts", "custom_field_values", "custom_fields", "sequence_enrollments", "sequence_steps",
    "payment_recovery_events", "recurring_change_log", "recurring_proposals", "recurring_subscriptions",
    "donor_designations", "donor_relationships", "moves", "opportunities", "event_attendees", "volunteers",
    "tasks", "interactions", "gifts", "households", "donors", "events", "campaigns", "grants",
    "board_members", "giving_pages", "sequences", "workflow_runs", "workflows", "notification_sends",
    "digest_sends", "fin_transactions", "budgets", "accounts", "fin_funds", "board_reports", "users"];
  // FIRST: clear any global smpl_* holder — the sample fixture's ids are
  // GLOBAL (documented BUILD-45 gotcha) and earlier runs can leave a
  // CROSS-ORG tangle (donors held by one org, gifts by another); the org-
  // scoped reset below cannot untangle that, so this global pass runs first.
  for (const t of ["campaign_recipients", "receipts", "pledges", "milestone_drafts", "note_reminders",
    "donor_materials", "planned_gifts", "custom_field_values", "sequence_enrollments",
    "payment_recovery_events", "recurring_subscriptions", "donor_designations", "moves",
    "opportunities", "event_attendees", "volunteers", "tasks", "interactions", "gifts"])
    await q(`DELETE FROM ${t} WHERE donor_id LIKE 'smpl_d%' OR id LIKE 'smpl_%'`).catch(() => {});
  await q(`DELETE FROM donor_relationships WHERE donor_id_a LIKE 'smpl_d%' OR donor_id_b LIKE 'smpl_d%'`).catch(() => {});
  await q(`UPDATE households SET primary_donor_id=NULL WHERE primary_donor_id LIKE 'smpl_d%'`).catch(() => {});
  for (const t of ["fin_transactions", "events", "campaigns", "grants", "board_members", "donors", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE id LIKE 'smpl_%' OR id LIKE 'fund_smpl%'`).catch(() => {});
  for (const t of RESET_ORDER) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,'Actor Stamp Org','actor-stamp',1,'active','team','acct_actorstamp')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_actorstamp',$1,'actor@stamp.local',$2,'Actor Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,tags) VALUES ('d_actorstamp',$1,'Stamp Donor','sd@stamp.local','new','prospect',0,0,'[]')`, [ORG]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acct_as',$1,'4010','Revenue','revenue',TRUE)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_as',$1,'General',FALSE)`, [ORG]);
  const tok = await login("actor@stamp.local");

  // a human logs a gift
  const g = await api("POST", "/donors/d_actorstamp/gifts", tok, { amount: 120.5, date: "2026-09-01", type: "cash" });
  const [grow] = await q(`SELECT created_by, created_by_name FROM gifts WHERE org_id=$1 AND donor_id='d_actorstamp'`, [ORG]);
  ok("a manually-logged gift records the USER as actor", g.status < 300 && grow?.created_by === "u_actorstamp" && grow?.created_by_name === "actor@stamp.local", { status: g.status, grow });
  const [ftrow] = await q(`SELECT created_by FROM fin_transactions WHERE org_id=$1 AND source='gift'`, [ORG]);
  ok("its ledger stamp carries the same actor", ftrow?.created_by === "u_actorstamp", ftrow);

  // a human creates a task
  const t1 = await api("POST", "/tasks", tok, { title: "Stamp check task" });
  const [trow] = await q(`SELECT created_by FROM tasks WHERE org_id=$1 AND title='Stamp check task'`, [ORG]);
  ok("a created task records the USER as actor", t1.status === 200 || t1.status === 201 ? trow?.created_by === "u_actorstamp" : false, { status: t1.status, trow });

  // a human makes a pledge
  const pl = await api("POST", "/donors/d_actorstamp/pledges", tok, { amount: 500, dueDate: "2026-12-01" });
  const [plrow] = await q(`SELECT created_by FROM pledges WHERE org_id=$1`, [ORG]);
  ok("a pledge records the USER as actor", plrow?.created_by === "u_actorstamp", { status: pl.status, plrow });

  // the Stripe webhook — a NON-HUMAN actor with an identity, not a null
  const evt = JSON.stringify({
    id: "evt_actorstamp1", type: "payment_intent.succeeded", account: "acct_actorstamp",
    data: { object: { id: "pi_actorstamp1", amount_received: 7500, receipt_email: "webhookdonor@stamp.local", metadata: { donor_name: "Web Hook Donor" } } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest").update(`${ts}.${evt}`).digest("hex");
  const wh = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` }, body: evt });
  const [wg] = await q(`SELECT created_by, created_by_name FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_actorstamp1'`, [ORG]);
  ok("an online gift records the WEBHOOK as actor (an identity, not null)",
     wh.status === 200 && wg?.created_by === "system:stripe-webhook", { status: wh.status, wg });
  const [wd] = await q(`SELECT created_by FROM donors WHERE org_id=$1 AND email='webhookdonor@stamp.local'`, [ORG]);
  ok("the webhook-created donor records the webhook as actor", wd?.created_by === "system:stripe-webhook", wd);

  // sample data — the actor is the human who clicked Load
  const sd = await api("POST", "/org/load-sample-data", tok, {});
  const [sg] = await q(`SELECT created_by FROM gifts WHERE org_id=$1 AND is_sample=true LIMIT 1`, [ORG]);
  ok("sample-data rows record the CLICKING USER as actor", sd.status === 200 && sg?.created_by === "u_actorstamp", { status: sd.status, sg });

  // import — "who imported these rows"
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Imported Person", email: "imp@stamp.local" }],
    gifts: [{ donorIndex: 0, amount: 55, date: "2026-01-05", type: "cash" }],
  });
  const [ig] = await q(`SELECT g.created_by FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.email='imp@stamp.local'`, [ORG]);
  ok("an imported gift records the IMPORTING USER as actor", imp.status === 200 && ig?.created_by === "u_actorstamp", { status: imp.status, ig });

  // leave NO global smpl_* holder behind — a later suite (presentation-wiring)
  // loads sample data into ITS org and the ids are global (BUILD-45 gotcha)
  for (const t of ["campaign_recipients", "receipts", "pledges", "milestone_drafts", "note_reminders",
    "donor_materials", "planned_gifts", "custom_field_values", "sequence_enrollments",
    "payment_recovery_events", "recurring_subscriptions", "donor_designations", "moves",
    "opportunities", "event_attendees", "volunteers", "tasks", "interactions", "gifts"])
    await q(`DELETE FROM ${t} WHERE donor_id LIKE 'smpl_d%' OR id LIKE 'smpl_%'`).catch(() => {});
  await q(`DELETE FROM donor_relationships WHERE donor_id_a LIKE 'smpl_d%' OR donor_id_b LIKE 'smpl_d%'`).catch(() => {});
  for (const t of ["fin_transactions", "events", "campaigns", "grants", "board_members", "donors", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE id LIKE 'smpl_%' OR id LIKE 'fund_smpl%'`).catch(() => {});
  for (const t of RESET_ORDER) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});

  await closeDb();
  summary();
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
