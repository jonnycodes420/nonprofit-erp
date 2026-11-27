#!/usr/bin/env node
// NUMBERS-10 item 1 (W-1122-Finance-F7, fifth night) · A COVERED-FEE GIFT WHOSE LEDGER ROW SAYS THE GIFT BEFORE THE FEE.
//
// The product books a gift at what the donor was charged (shared/giftFooting.js; recordGift's Rule 3
// and Post to the books write the gift's amount). Rows written another way say the gift less the card
// fee the donor covered, so the fund's "transactions in" sits below its gifts on the books by exactly
// those fees. Staging's Harborlight carries four, from the demo seed before NUMBERS-9 ($82.13 on
// General Operating). This lists them by the rule in shared/numbers/fundGap.js (kind "fee": a posted
// gift with cover_fee_amount > 0 whose one income row is the gift less that fee, to the cent, not split),
// and with --apply moves each row to the charge. Nothing else on the row changes.
//
// DRY RUN BY DEFAULT, read only: per org, how many and how much; with --org, every row.
//
//   DATABASE_URL=… node scripts/ops/numbers10-fee-rows.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/numbers10-fee-rows.js --org <org id> --apply [--i-know-this-is-prod]
//   DATABASE_URL=… node scripts/ops/numbers10-fee-rows.js --org org_b72demo --apply --staging --staging-api=<url> --i-know-this-is-prod
//
// --apply writes that one org's rows in one transaction and one audit row as system:numbers10-fee-rows.
// A remote database needs --i-know-this-is-prod (prodGuard's writerDbUrl): Jonathan runs it. Never
// org_creo. The demo (org_b72demo) only on staging: --staging with --staging-api=<url> whose /health says
// env "staging" (as flows10-demo-alts.js); seed-demo.js heals the same rows on its next run. Nothing
// runs at deploy. Nothing sends.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo"];
const DEMO = "org_b72demo";
const ACTOR = { id: "system:numbers10-fee-rows", name: "Covered-fee ledger rows repair (NUMBERS-10)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
// Run as a script only: seed-demo.js requires this file for HEAL_SQL.
if (require.main === module) {
  if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
  if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
  if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
  if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
}

// The rows: a posted, non-split gift whose donor covered the fee, with one income row that is the gift
// less that fee, to the cent. Binds: org id or null.
const FEE_ROWS_SQL = `
  SELECT ft.org_id, ft.id AS row_id, g.id AS gift_id, LEFT(g.date, 10) AS date, ft.fund_id,
         ROUND(g.amount * 100)::bigint AS gift_cents, ROUND(ft.amount * 100)::bigint AS row_cents,
         ROUND(g.cover_fee_amount * 100)::bigint AS fee_cents
    FROM fin_transactions ft JOIN gifts g ON g.id = ft.gift_id AND g.org_id = ft.org_id
   WHERE ft.type = 'income' AND COALESCE(g.cover_fee_amount, 0) > 0
     AND ($1::text IS NULL OR ft.org_id = $1)
     AND ROUND(g.amount * 100) - ROUND(ft.amount * 100) = ROUND(g.cover_fee_amount * 100)
     AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id)
     AND (SELECT COUNT(*) FROM fin_transactions o WHERE o.gift_id = g.id AND o.org_id = g.org_id AND o.type = 'income') = 1
   ORDER BY ft.org_id, g.date, g.id`;

// seed-demo.js heals the demo's own rows with the same rule (binds: org id).
const HEAL_SQL = `
  UPDATE fin_transactions ft SET amount = g.amount
    FROM gifts g
   WHERE g.id = ft.gift_id AND g.org_id = ft.org_id AND ft.org_id = $1 AND ft.type = 'income'
     AND COALESCE(g.cover_fee_amount, 0) > 0
     AND ROUND(g.amount * 100) - ROUND(ft.amount * 100) = ROUND(g.cover_fee_amount * 100)
     AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id)`;

async function stagingOnly() {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL)) return true;
  if (!flag("--staging")) return false;
  const a = argv.find(x => x.startsWith("--staging-api=")), base = a ? a.slice("--staging-api=".length).replace(/\/+$/, "") : "";
  if (!base) return false;
  const h = await fetch(base + "/health", { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  return !!(h && h.env === "staging");
}

const usd = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  if (APPLY && ORG === DEMO && !(await stagingOnly())) refuse(`${DEMO} is written only on staging: add --staging --staging-api=<url> (its /health must say env "staging"), or re-run seed-demo.js.`);
  const { query, withTransaction } = require("../../db");
  const rows = await query(FEE_ROWS_SQL.replace(/\$1/g, "?"), [ORG || null, ORG || null]);
  const byOrg = new Map();
  for (const r of rows) { const o = byOrg.get(r.org_id) || { n: 0, cents: 0 }; o.n++; o.cents += Number(r.fee_cents); byOrg.set(r.org_id, o); }
  console.log(`Covered-fee gifts whose ledger row says the gift before the fee: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, o] of byOrg) console.log(`  ${org.padEnd(28)} ${String(o.n).padStart(4)} rows  ${usd(o.cents).padStart(12)} of fees left out of "transactions in"`);
  if (ORG) for (const r of rows) console.log(`    ${r.date} · gift ${r.gift_id} ${usd(r.gift_cents)} · row ${r.row_id} ${usd(r.row_cents)} → ${usd(r.gift_cents)} (fund ${r.fund_id || "none"}, fee ${usd(r.fee_cents)})`);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (rows.length ? " Add --org <org> --apply to move those rows to the charge." : "")); return; }
  if (!rows.length) { console.log("\nNothing to move."); return; }
  let moved = 0;
  await withTransaction(async client => {
    for (const r of rows) {
      const u = await client.query(`UPDATE fin_transactions SET amount = $1 WHERE id = $2 AND org_id = $3 AND ROUND(amount * 100) = $4`,
        [Number(r.gift_cents) / 100, r.row_id, ORG, Number(r.row_cents)]);
      moved += u.rowCount;
    }
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'numbers10 covered-fee ledger rows','fin_transaction',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/numbers10-fee-rows.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ rows: rows.map(r => ({ id: r.row_id, giftId: r.gift_id, from: Number(r.row_cents), to: Number(r.gift_cents) })) }),
       `Moved ${moved} ledger ${moved === 1 ? "row" : "rows"} of covered-fee gifts from the gift before the fee to what the donor was charged.`,
       moved]);
  });
  console.log(`\nMoved ${moved} ${moved === 1 ? "row" : "rows"} to the charge in one transaction. Audit row as ${ACTOR.id}.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { main, FEE_ROWS_SQL, HEAL_SQL };
