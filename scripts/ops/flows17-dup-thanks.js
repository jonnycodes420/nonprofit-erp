#!/usr/bin/env node
// FLOWS-17 item 1 (Justin's Place) · A SECOND THANK-YOU TASK BESIDE A GIFT'S OWN.
//
// Before FLOWS-17 the "Gift received → notify the team" workflow (on for every new org) wrote
// "Thank <name> · $<amount> just came in" straight into tasks, beside the gift's own "Send
// thank-you note" step (or a journey's "Call to say thank you"): two tasks to thank one gift.
// It now writes through thankYouOnce.js, which writes no second one. This lists the rows the old
// writer left, by the rule in server/tasks/dupThanks.js: the step (or the first task for the
// gift) is kept, the extra task is listed. FLOWS-5's script (flows5-dup-thanks.js) found only
// pairs that both carried the gift's id, and a journey's step carries none.
//
// DRY RUN BY DEFAULT, read only: per org, how many; with --org, every row and the one kept.
//
//   DATABASE_URL=… node scripts/ops/flows17-dup-thanks.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/flows17-dup-thanks.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply voids that one org's listed tasks (voided_reason 'one_thank_you': voided, never
// deleted, and the kept step stays open) in one transaction and writes one audit row as
// system:flows17-dup-thanks. A remote database needs --i-know-this-is-prod (prodGuard's
// writerDbUrl): Jonathan runs it, for one org he names. Never org_creo, never org_b72demo
// (seed-demo.js owns it). Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:flows17-dup-thanks", name: "Second thank-you tasks repair (FLOWS-17)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

async function main() {
  const { query, withTransaction } = require("../../db");
  const { DUP_THANKS_SQL, VOID_SQL, THANK_TYPES } = require("../../server/tasks/dupThanks");
  const rows = await query(DUP_THANKS_SQL, [THANK_TYPES, ORG || null, NEVER]);
  const byOrg = new Map();
  for (const r of rows) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
  console.log(`Open thank-you tasks beside another thank-you for the same gift or person: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, n] of byOrg) console.log(`  ${org.padEnd(28)} ${String(n).padStart(4)}`);
  if (ORG) for (const r of rows) console.log(`    ${r.donor_name || "(no person)"} · "${r.title}" (${r.id}, written ${new Date(r.created_at).toISOString().slice(0, 10)})`
    + `\n        keeps ${r.why === "step" ? "the Thread step" : "the first task"} "${r.kept_title}" (${r.kept_id || "its step"})`);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (rows.length ? " Add --org <org> --apply to void them." : "")); return; }
  if (!rows.length) { console.log("\nNothing to void."); return; }
  const ids = rows.map(r => r.id);
  let voided = [];
  await withTransaction(async client => {
    voided = (await client.query(VOID_SQL, [ORG, ids])).rows.map(r => r.id);
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'flows17 second thank-you tasks','task',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/flows17-dup-thanks.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ voided: rows.filter(r => voided.includes(r.id)).map(r => ({ id: r.id, title: r.title, donorId: r.donor_id, giftId: r.gift_id, kept: r.kept_id })) }),
       `Voided ${voided.length} thank-you ${voided.length === 1 ? "task" : "tasks"} that sat beside the gift's own thank-you, left by the gift workflow before FLOWS-17.`,
       voided.length]);
  });
  console.log(`\nVoided ${voided.length} ${voided.length === 1 ? "task" : "tasks"} in one transaction (reason one_thank_you); each kept thank-you is still open. Audit row as ${ACTOR.id}.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { main };
