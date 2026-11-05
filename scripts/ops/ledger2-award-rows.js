#!/usr/bin/env node
// LEDGER-2 item 4 · BOOK THE INCOME OF AWARDS RECORDED WITHOUT IT.
//
// From GRANTS-FIX (#329) until LEDGER-2, recording an award (PUT
// /grants/:id/award) wrote the pledge on the funder and no ledger income row,
// so Fundraising showed the promise and Finance showed nothing. This lists
// every award recorded through that route (a grant with an award pledge and an
// awarded date) that has no ledger row, and with --apply writes the row the
// award route writes now (server/grants/awardLedger.js): the awarded amount,
// the fund named for the funder or program else the first unrestricted fund,
// the grants revenue account (contributions when none), dated the day the
// award was recorded in the org's own time zone. One audit row each.
// Idempotent: uq_fin_txns_grant holds one row per grant, and a second run
// finds nothing to book. An org with no chart of accounts or no unrestricted
// fund is listed and left for a person.
//
// Skips sample rows, org_creo (the boot-seed fixture) and org_b72demo (only
// scripts/ci/seed-demo.js writes the demo).
//
// Usage:
//   node scripts/ops/ledger2-award-rows.js                        # dry run, every org
//   node scripts/ops/ledger2-award-rows.js --org=<org_id>         # one org
//   node scripts/ops/ledger2-award-rows.js --apply [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const AL = require("../../server/grants/awardLedger");
const orgTime = require("../../orgTime");

const ACTOR = { id: "system:scripts/ops/ledger2-award-rows", name: "Fix: book a grant award's income", kind: "system" };
const SKIP_ORGS = ["org_creo", "org_b72demo"];

const pgArgs = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
const qFor = c => async (sql, a) => (await c.query(pgArgs(sql), a)).rows;

// ensureOrgLedger's probe (server.js), read only: the script never provisions a chart.
async function ledgerOf(q, orgId) {
  const [contrib] = await q("SELECT id FROM accounts WHERE org_id = ? AND code = '4010' LIMIT 1", [orgId]);
  const [grant] = await q("SELECT id FROM accounts WHERE org_id = ? AND type = 'revenue' AND subtype = 'grants' ORDER BY code ASC LIMIT 1", [orgId]);
  const [fund] = await q("SELECT id FROM fin_funds WHERE org_id = ? AND restricted = false ORDER BY created_at ASC LIMIT 1", [orgId]);
  return { grantAcctId: (grant && grant.id) || (contrib && contrib.id) || null, genFundId: (fund && fund.id) || null };
}

async function run({ client, apply = false, orgId = null, log = console.log }) {
  const q = qFor(client);
  const out = { booked: 0, left: 0, orgs: {} };
  const all = (await AL.awardsWithoutIncome(q, orgId)).filter(g => !SKIP_ORGS.includes(g.org_id));
  const sample = new Set((await q(`SELECT id FROM grants WHERE is_sample IS TRUE AND id = ANY(?::text[])`, [all.map(g => g.id)])).map(r => r.id));
  const awards = all.filter(g => !sample.has(g.id));
  for (const org of [...new Set(awards.map(g => g.org_id))].sort()) {
    const o = out.orgs[org] = { booked: [], left: [] };
    log(`${org}:`);
    const [orgRow] = await q("SELECT id, timezone, vocabulary_json FROM orgs WHERE id = ?", [org]);
    const ledger = await ledgerOf(q, org);
    if (apply) await client.query("BEGIN");
    try {
      for (const g of awards.filter(r => r.org_id === org)) {
        const [funder] = g.award_pledge_id ? await q(`SELECT d.name FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id WHERE p.id = ? AND p.org_id = ?`, [g.award_pledge_id, org]) : [];
        const name = (funder && funder.name) || g.funder || "(no name)";
        const date = orgTime.orgToday(orgRow || {}, new Date(g.awarded_at));
        const label = `  ${g.id}  ${name}${g.program ? " · " + g.program : ""}  $${Number(g.amount_awarded).toFixed(2)}  awarded ${date}`;
        if (!ledger.grantAcctId || !ledger.genFundId) { log(`${label}: the org has no ledger yet: left for a person`); o.left.push(g.id); out.left++; continue; }
        if (!apply) { log(`${label}: would book the income`); o.booked.push(g.id); out.booked++; continue; }
        const r = await AL.bookAwardIncome(q, { orgId: org, grantId: g.id, funder: name, program: g.program, amount: g.amount_awarded, date, ledger, by: ACTOR });
        if (!r.created) { log(`${label}: already booked`); continue; }
        log(`${label}: booked (${r.id})`);
        o.booked.push(g.id); out.booked++;
        await client.query(
          `INSERT INTO fin_audit_log
             (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
              changes, before_fields, after_fields, summary, record_count, request_method, request_path)
           VALUES ($1,$2,$3,$4,$5,'created','transaction',$6,$7,$8,$9,$10,1,'SCRIPT','scripts/ops/ledger2-award-rows.js')`,
          ["al_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), org, ACTOR.id, ACTOR.name, ACTOR.kind, r.id,
           JSON.stringify({ grant_id: { from: null, to: g.id } }), JSON.stringify({}), JSON.stringify({ grant_id: g.id, amount: Number(g.amount_awarded), date }),
           `Booked the income of the ${name} grant award, recorded ${date} without its ledger row.`]);
      }
      if (apply) await client.query("COMMIT");
    } catch (e) {
      if (apply) await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }
  log(`\n${out.booked} award(s) ${apply ? "booked" : "would be booked"}, ${out.left} left for a person.`);
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
  try {
    console.log(APPLY ? "MODE: APPLY (ledger rows only, one transaction per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    await run({ client, apply: APPLY, orgId: orgArg });
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { run, SKIP_ORGS };
