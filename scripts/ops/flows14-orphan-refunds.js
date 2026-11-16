#!/usr/bin/env node
// FLOWS-14 item 1 (W-1115-Finance-07X) · REFUND ROWS WHOSE GIFT IS GONE.
//
// Before FLOWS-14, undoing a deposit (or a gift file) removed its gifts and left
// any refund recorded against them standing alone: a negative row nobody could
// remove in the app, and the org's money that much below the truth. The undo
// and the gift delete now take a gift's refunds with it (server/donors/refundPairs.js).
// This lists the rows the old undo left, per org.
//
// DRY RUN BY DEFAULT, read only: per org, how many such rows and what they come
// to. With --org it lists that org's rows (date, amount, the person's id).
//
//   DATABASE_URL=… node scripts/ops/flows14-orphan-refunds.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/flows14-orphan-refunds.js --org <org id> --apply
//
// --apply removes that one org's orphaned refund rows (their ledger line and
// timeline line with them) in one transaction, recomputes each person's stored
// totals with the one writer (shared/numbers/donorTotals.js), and writes one
// audit row as system:flows14-orphan-refunds. It acts on a local database, or
// on STAGING only: the database must hold the staging walk org (org_stagewalk),
// and BASE (the API the same database serves) must answer /health env "staging"
// with --staging. It never acts on production and never on org_creo. Nothing
// runs at deploy.
//   BASE=<staging API> railway run --environment staging --service web -- \
//     node scripts/ops/flows14-orphan-refunds.js --org org_b72demo --apply --staging --i-know-this-is-prod
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const ACTOR = { id: "system:flows14-orphan-refunds", name: "Orphaned refunds repair (FLOWS-14)", kind: "system" };
const usd = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG === "org_creo") refuse("org_creo is the boot fixture and is changed only by the demo-tidy script.");
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
// --apply resolves its database through prodGuard's writerDbUrl (a remote one also needs
// --i-know-this-is-prod), and then must prove it is staging below.
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
const LOCAL = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);

async function main() {
  const db = require("../../db");
  const { query, withTransaction, runTx } = db;
  const { ORPHANS_SQL } = require("../../server/donors/refundPairs");
  const rows = await query(`SELECT * FROM (${ORPHANS_SQL}) x ${ORG ? "WHERE org_id = $1" : ""} ORDER BY org_id, date, id`, ORG ? [ORG] : []);
  const byOrg = new Map();
  for (const r of rows) {
    const o = byOrg.get(r.org_id) || { n: 0, cents: 0 };
    o.n += 1; o.cents += Math.round(Number(r.amount) * 100); byOrg.set(r.org_id, o);
  }
  console.log(`Refund rows whose gift is gone: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, o] of byOrg) console.log(`  ${org.padEnd(28)} ${String(o.n).padStart(4)} rows   ${usd(o.cents)}`);
  if (ORG) for (const r of rows) console.log(`    ${String(r.date || "").slice(0, 10)}  ${usd(Math.round(Number(r.amount) * 100)).padStart(10)}  person ${r.donor_id}  row ${r.id}  (its gift ${r.refund_of} is gone)`);
  if (!APPLY) { console.log("\nNothing was written." + (rows.length ? " Add --org <org> --apply (local, or staging with --staging) to remove them." : "")); return; }
  if (!rows.length) { console.log("\nNothing to remove."); return; }

  // STAGING ONLY, beyond a local database: the walk org is the database's mark,
  // and the API on BASE must say it is staging (prodGuard's --staging rule).
  if (!LOCAL) {
    if (!flag("--staging")) refuse("a remote database is written only on staging, with --staging.");
    const [mark] = await query("SELECT 1 AS ok FROM orgs WHERE id = 'org_stagewalk'");
    if (!mark) refuse("this database holds no org_stagewalk, so it is not staging. Production is never written by this script.");
    if (!process.env.BASE) refuse("set BASE to the staging API, so its /health can say it is staging.");
    const h = require("../lib/prodGuard").assertServerIdentity(process.env.BASE);
    if (h.env !== "staging") refuse(`${process.env.BASE}/health says env "${h.env}", not "staging".`);
  }
  const ids = rows.map(r => r.id), people = [...new Set(rows.map(r => r.donor_id))];
  const total = rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
  await withTransaction(async client => {
    const x = async (sql, args) => (await client.query(sql, args)).rows;
    await x("DELETE FROM fin_transactions WHERE org_id = $1 AND gift_id = ANY($2::text[])", [ORG, ids]);
    await x("DELETE FROM interactions WHERE org_id = $1 AND gift_id = ANY($2::text[])", [ORG, ids]);
    await x("DELETE FROM thank_you_drafts WHERE org_id = $1 AND gift_id = ANY($2::text[])", [ORG, ids]);
    await x("DELETE FROM gifts WHERE org_id = $1 AND id = ANY($2::text[]) AND refund_of IS NOT NULL", [ORG, ids]);
    await require("../../shared/numbers/donorTotals").recomputeStoredTotals((sql, p) => runTx(client, sql, p), ORG, people);
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'flows14 orphaned refunds','gift',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/flows14-orphan-refunds.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ rows: rows.map(r => ({ id: r.id, donorId: r.donor_id, date: r.date, amount: r.amount, refundOf: r.refund_of })) }),
       `Removed ${ids.length} refund ${ids.length === 1 ? "row" : "rows"} (${usd(total)}) whose gift was already gone, left by a deposit undo before FLOWS-14.`,
       ids.length]);
  });
  await require("../../afterChange").afterChange(ORG, people, { door: "repair", recalc: false }).catch(e => console.error("after-change:", e.message));
  console.log(`\nRemoved ${ids.length} rows (${usd(total)}) in one transaction; ${people.length} ${people.length === 1 ? "person's" : "people's"} stored totals recomputed. Audit row as ${ACTOR.id}.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
