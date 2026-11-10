#!/usr/bin/env node
// MONEY-4 (W-1107-Finance-31, W-1109-Finance-33) · AWARDED GRANTS WITH NO AWARD ROW.
//
// A grant at an award stage (awarded, reporting, closed) with no award row
// (grants.award_pledge_id) read "payments not set up" (Wexford, $120,000) or
// "Received $35,000, award not recorded" beside Awarded "Not set" (NEA). The
// stage now requires the award; this finds the grants that predate that rule.
//
// For each it says what it would do:
//   · record the award: a pledge on the funder for the award amount, one
//     installment (the app's one pledge writer), the amount being the grant's
//     awarded amount, else its requested amount (what Moving to Awarded
//     prefills), else its typed Received;
//   · then turn a typed Received into the award's first payment, through
//     GIFTS-1's path (recordGift, server/grants/awardFirstPayment.js).
// It leaves for a person: a grant with no funder record (the pledge has to
// belong to somebody), or with no amount anywhere.
//
// Skips sample rows, org_creo (the boot-seed fixture) and org_b72demo (only
// scripts/ci/seed-demo.js writes the demo). Reads only with no --apply.
// Idempotent: a grant with an award row is not listed, and the first payment
// carries GIFTS-1's external id.
//
// Usage:
//   node scripts/ops/money4-grant-awards.js                      # dry run, every org
//   node scripts/ops/money4-grant-awards.js --org=<org_id>       # one org
//   node scripts/ops/money4-grant-awards.js --apply [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const orgTime = require("../../orgTime");

const ACTOR = { id: "system:scripts/ops/money4-grant-awards", name: "Fix: an awarded grant's award, recorded" };
const SKIP_ORGS = ["org_creo", "org_b72demo"];
const AWARD_STAGES = ["awarded", "active", "reporting", "closed", "complete", "completed", "report"];

const pgArgs = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
const qFor = c => async (sql, a) => (await c.query(pgArgs(sql), a)).rows;
const c = v => Math.round((Number(v) || 0) * 100);
const usd = n => "$" + (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function unawarded(q, orgId = null) {
  const rows = await q(
    `SELECT gr.id, gr.org_id, gr.funder, gr.program, gr.status, gr.funder_donor_id, gr.awarded_at,
            gr.amount_awarded::text AS awarded, gr.amount_requested::text AS requested, gr.amount::text AS ask,
            gr.received::text AS typed, o.timezone, d.name AS funder_name
       FROM grants gr JOIN orgs o ON o.id = gr.org_id
       LEFT JOIN donors d ON d.id = gr.funder_donor_id AND d.org_id = gr.org_id AND d.deleted_at IS NULL
      WHERE gr.award_pledge_id IS NULL AND lower(COALESCE(gr.status, '')) = ANY(?::text[])
        AND gr.is_sample IS NOT TRUE AND NOT (gr.org_id = ANY(?::text[]))
        AND (?::text IS NULL OR gr.org_id = ?)
      ORDER BY gr.org_id, gr.id`, [AWARD_STAGES, SKIP_ORGS, orgId, orgId]);
  return rows.map(r => {
    const amountCents = c(r.awarded) || c(r.requested) || c(r.ask) || c(r.typed);
    const from = c(r.awarded) ? "the awarded amount" : c(r.requested) ? "the requested amount" : c(r.ask) ? "the ask" : c(r.typed) ? "the typed Received" : null;
    return { ...r, amountCents, from, typedCents: c(r.typed) };
  });
}

let APP = null;
function appWriters() {
  if (APP) return APP;
  process.env.STEWARD_PROCESS = "web";
  process.env.DISABLE_BACKGROUND_TICKS = "1";
  process.env.RESEND_API_KEY = "re_money4_script_sends_nothing";   // nothing this process does can send
  process.env.RESEND_BASE_URL = "http://127.0.0.1:9";
  process.env.PORT = process.env.MONEY4_SCRIPT_PORT || "0";
  const app = require("../../server.js");
  const { query } = require("../../db");
  APP = { query, recordGift: app.locals.recordGift, recalcPledgePayment: app.locals.recalcPledgePayment,
          writePledge: require("../../pledgeWrite").writePledge, afterChange: require("../../afterChange").afterChange,
          firstPayment: require("../../server/grants/awardFirstPayment").typedReceivedToFirstPayment };
  return APP;
}

async function run({ client, apply = false, orgId = null, log = console.log, writers = null }) {
  const q = qFor(client);
  const out = { recorded: 0, left: 0, rows: [] };
  for (const g of await unawarded(q, orgId)) {
    const name = g.funder_name || g.funder || "(no name)";
    const label = `  ${g.org_id}  ${g.id}  ${name}${g.program ? " · " + g.program : ""} (${g.status})`;
    const day = orgTime.orgToday({ timezone: g.timezone }, g.awarded_at ? new Date(g.awarded_at) : undefined);
    const row = { grantId: g.id, orgId: g.org_id, amountCents: g.amountCents, typedCents: g.typedCents, date: day };
    out.rows.push(row);
    if (!g.funder_donor_id || !g.funder_name) { log(`${label}: no funder record, link the funder first (left for a person)`); row.action = "left"; out.left++; continue; }
    if (!g.amountCents) { log(`${label}: no amount anywhere, record the award by hand (left for a person)`); row.action = "left"; out.left++; continue; }
    const pay = g.typedCents > 0 ? `, then ${usd(g.typedCents)} typed Received becomes its first payment` : "";
    if (!apply) { log(`${label}: would record a ${usd(g.amountCents)} award from ${g.from}, dated ${day}${pay}`); row.action = "would_record"; out.recorded++; continue; }
    const W = writers || appWriters();
    const { id: pledgeId } = await W.writePledge({ orgId: g.org_id, donorId: g.funder_donor_id, amountCents: g.amountCents, dueDate: day,
      notes: `Grant award: ${g.program || "grant"}`, createdBy: ACTOR.id, createdByName: ACTOR.name }, { door: "pledge" });
    await q(`UPDATE grants SET amount_awarded=?, award_pledge_id=?, awarded_at=COALESCE(awarded_at, NOW()), updated_at=NOW()
              WHERE id=? AND org_id=? AND award_pledge_id IS NULL`, [g.amountCents / 100, pledgeId, g.id, g.org_id]);
    const first = await W.firstPayment(W, { orgId: g.org_id, grantId: g.id, date: day, actorId: ACTOR.id, actorName: ACTOR.name });
    await W.afterChange(g.org_id, [g.funder_donor_id], { door: "script", recalc: true }).catch(e => log(`    after-change: ${e.message}`));
    log(`${label}: recorded a ${usd(g.amountCents)} award (${pledgeId})${first ? `, first payment ${usd(first.cents)} (${first.giftId})` : ""}`);
    row.action = "recorded"; row.pledgeId = pledgeId; row.firstPayment = first; out.recorded++;
  }
  log(`\n${out.recorded} award(s) ${apply ? "recorded" : "would be recorded"}, ${out.left} left for a person.`);
  return out;
}

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const APPLY = process.argv.includes("--apply");
  const DB_URL = APPLY ? writerDbUrl() : (process.env.DATABASE_URL || writerDbUrl());
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  let code = 0;
  try {
    console.log(APPLY ? "MODE: APPLY (an award per grant, and its first payment, through the app's writers)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    await run({ client, apply: APPLY, orgId: orgArg });
  } catch (e) { console.error(e); code = 1; }
  finally { client.release(); await pool.end(); }
  process.exit(code);
}

if (require.main === module) main();
module.exports = { run, unawarded, SKIP_ORGS };
