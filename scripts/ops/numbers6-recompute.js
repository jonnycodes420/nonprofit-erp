#!/usr/bin/env node
// NUMBERS-6 · RECOMPUTE ONE ORG'S STORED TOTALS, WITH THE ONE WRITER.
//
// The totals kept on a person (donors.total_giving, gift_count, first and last
// gift date, last amount) are recomputed on every write now, and every write
// goes through shared/numbers/donorTotals.js. A person nobody has written to
// since the damage still carries it: the nightly check's `donor-stored` and
// First/Largest/Last counts. This brings one org's people up to date with the
// same function. It never touches a gift.
//
// DRY RUN BY DEFAULT, and counts only: how many people's stored totals would
// change, by field, and how many rows point at a gift that is gone. It never
// prints a name, an amount or an id.
//
//   DATABASE_URL=… node scripts/ops/numbers6-recompute.js --org <org id>
//   DATABASE_URL=… node scripts/ops/numbers6-recompute.js --org <org id> --apply --i-know-this-is-prod
//   … --apply --remove-orphan-stamps   also removes ledger lines whose gift is gone
//
// --apply recomputes that org's stored totals in one transaction, writes one
// audit row as system:numbers6-recompute, then runs the nightly check on the
// org and prints its counts before and after. It resolves its database through
// scripts/lib/prodGuard.js (a remote DATABASE_URL needs --i-know-this-is-prod).
// It refuses to run without --org, and never runs on org_creo. Nothing runs at
// deploy; Jonathan runs it (docs/needs-jonathan/NUMBERS-6.md).
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); const eq = argv.find(a => a.startsWith(k + "=")); return eq ? eq.slice(k.length + 1) : i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const STAMPS = flag("--remove-orphan-stamps");
const ACTOR = { id: "system:numbers6-recompute", name: "Stored totals recompute (NUMBERS-6)", kind: "system" };
const RULES = { "donor-stored": "stored totals that disagree", "donor-first-largest-last": "people where First, Largest or Last gift disagrees", removed: "rows pointing at a removed gift" };

function usage(why) {
  console.error(`${why}\nusage: node scripts/ops/numbers6-recompute.js --org <org id> [--apply --i-know-this-is-prod] [--remove-orphan-stamps]`);
  process.exit(2);
}
if (!ORG || ORG.startsWith("--")) usage("REFUSED: name one org with --org. This script never runs on every org at once.");
if (ORG === "org_creo") usage("REFUSED: org_creo is the boot fixture and is changed only by the demo-tidy script.");
if (STAMPS && !APPLY) usage("--remove-orphan-stamps acts only with --apply.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
else if (!process.env.DATABASE_URL) usage("Set DATABASE_URL first.");

// Ledger lines and pledges that point at a gift that is no longer there.
const ORPHANS = `
  SELECT (SELECT COUNT(*) FROM fin_transactions t WHERE t.org_id = $1 AND t.gift_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = t.gift_id AND g.org_id = t.org_id))::int AS ledger,
         (SELECT COUNT(*) FROM pledges p WHERE p.org_id = $1 AND p.fulfilled_gift_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = p.fulfilled_gift_id AND g.org_id = p.org_id))::int AS pledge`;
const ORPHAN_STAMPS_DELETE = `DELETE FROM fin_transactions t WHERE t.org_id = $1 AND t.gift_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = t.gift_id AND g.org_id = t.org_id)`;

// People whose stored totals would change, by field. Counts only.
async function plan(query, orgId) {
  const { storedTotalsDiff } = require("../../shared/numbers/donorTotals");
  const rows = await storedTotalsDiff(query, orgId);
  const differs = (a, b) => String(a ?? "") !== String(b ?? "");
  const num = (a, b) => Math.round(Number(a || 0) * 100) !== Math.round(Number(b || 0) * 100);
  const byField = {
    total_giving: rows.filter(r => num(r.stored_total, r.total)).length,
    gift_count: rows.filter(r => Number(r.stored_n || 0) !== Number(r.n || 0)).length,
    first_gift_date: rows.filter(r => differs(r.stored_first, r.first_date)).length,
    last_gift_date: rows.filter(r => differs(r.stored_last, r.last_date)).length,
    last_gift_amount: rows.filter(r => num(r.stored_last_amt, r.last_amt)).length,
  };
  const [o] = await query(ORPHANS, [orgId]);
  return { people: rows.length, byField, orphans: { ledger: o.ledger, pledge: o.pledge } };
}

async function checkCounts(orgId) {
  const { checkOrg } = require("../ci/check-numbers");
  const r = await checkOrg(orgId, { sample: 300 });
  return Object.fromEntries(Object.keys(RULES).map(k => [k, (r.problems.find(p => p.rule === k) || {}).count || 0]));
}

function printPlan(p) {
  console.log(`  people whose stored totals would change: ${p.people}`);
  for (const [k, n] of Object.entries(p.byField)) console.log(`    ${k.padEnd(18)} ${n}`);
  console.log(`  ledger lines pointing at a removed gift: ${p.orphans.ledger}${p.orphans.ledger && !STAMPS ? " (left as they are; --remove-orphan-stamps takes them out)" : ""}`);
  console.log(`  pledges pointing at a removed gift:      ${p.orphans.pledge}`);
}

async function main() {
  const cwd = process.cwd();
  const db = require("../../db");
  const { query, withTransaction, runTx } = db;
  const [org] = await query(`SELECT id FROM orgs WHERE id = $1`, [ORG]);
  if (!org) usage("No such org.");
  process.chdir(cwd);
  const before = await plan(query, ORG);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} · one org`);
  printPlan(before);
  if (!APPLY) { console.log("\nNothing was written. Add --apply --i-know-this-is-prod to recompute."); return; }

  const checkBefore = await checkCounts(ORG);
  const { recomputeStoredTotals } = require("../../shared/numbers/donorTotals");
  let stampsRemoved = 0;
  await withTransaction(async client => {
    const run = (sql, params) => runTx(client, sql, params);
    const ids = (await client.query(`SELECT id FROM donors WHERE org_id = $1`, [ORG])).rows.map(r => r.id);
    await recomputeStoredTotals(run, ORG, ids);
    if (STAMPS) stampsRemoved = (await client.query(ORPHAN_STAMPS_DELETE, [ORG])).rowCount;
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'numbers6 recompute','donor',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/numbers6-recompute.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ byField: before.byField, orphanStampsRemoved: stampsRemoved }),
       `Recomputed the stored totals of ${before.people} ${before.people === 1 ? "person" : "people"} with the one writer${stampsRemoved ? `, and removed ${stampsRemoved} ledger line${stampsRemoved === 1 ? "" : "s"} whose gift was gone` : ""}. No gift was changed.`,
       before.people]);
  });
  const after = await plan(query, ORG);
  const checkAfter = await checkCounts(ORG);
  console.log(`\nWritten in one transaction, audit row as ${ACTOR.id}.${STAMPS ? ` Ledger lines removed: ${stampsRemoved}.` : ""}`);
  console.log("\n  the nightly check            before   after");
  for (const [k, words] of Object.entries(RULES)) console.log(`    ${words.padEnd(52)} ${String(checkBefore[k]).padStart(5)} ${String(checkAfter[k]).padStart(7)}`);
  console.log(`  people whose stored totals would still change: ${after.people}`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { plan };
