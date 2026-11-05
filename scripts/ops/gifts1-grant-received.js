#!/usr/bin/env node
// GIFTS-1 item 3 · A GRANT'S TYPED RECEIVED, RECORDED AS THE PAYMENT IT WAS.
//
// Until GIFTS-1 a grant's Received was a number typed into its Edit form
// (`grants.received`). It was not a gift, it was on no ledger, and it did not
// reduce the award pledge. Received is now the payments recorded on the award
// (shared/numbers/pledges GRANT_RECEIVED), and the typed field is read-only.
//
// This lists every grant whose typed Received does not match its recorded
// payments. With --apply it writes ONE payment gift per grant for the
// difference: from the funder, applied to the grant's award pledge, dated the
// award date (the org's own day), noted "from typed Received". It goes through
// recordGift, the one gift path (ledger, receipt, deposit, the after-change
// step on the queue), with history:true so no thank-you or journey starts for
// money that arrived long ago. It writes no gift for:
//   · a grant with no award recorded, or no funder record: the payment needs
//     the pledge it pays (record the award first), left for a person;
//   · recorded payments already above the typed figure: nothing is taken away.
// Idempotent: each gift carries external_id "gifts1-received:<grant id>", and
// after it the typed figure equals the recorded one, so a second run finds
// nothing to write.
//
// Skips sample rows, org_creo (the boot-seed fixture) and org_b72demo (only
// scripts/ci/seed-demo.js writes the demo). Reads only with no --apply.
//
// Usage:
//   node scripts/ops/gifts1-grant-received.js                         # dry run, every org
//   node scripts/ops/gifts1-grant-received.js --org=<org_id>          # one org
//   node scripts/ops/gifts1-grant-received.js --apply [--i-know-this-is-prod]
//
// --apply loads the app in this process as a web process with no jobs and no
// background ticks (STEWARD_PROCESS=web, DISABLE_BACKGROUND_TICKS=1) on a
// throwaway port, with a mail key that is no key, so recordGift is the app's
// own and nothing it loads can send. What a gift starts (the after-change
// step) waits on the queue for the worker.
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const orgTime = require("../../orgTime");
const { GRANT_RECEIVED } = require("../../shared/numbers/pledges");

const ACTOR = { id: "system:scripts/ops/gifts1-grant-received", name: "Fix: a grant's typed Received, recorded as its payment", kind: "system" };
const SKIP_ORGS = ["org_creo", "org_b72demo"];
const NOTE = "Grant payment, from typed Received";
const extId = grantId => `gifts1-received:${grantId}`;

const pgArgs = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
const qFor = c => async (sql, a) => (await c.query(pgArgs(sql), a)).rows;
const c = v => Math.round((Number(v) || 0) * 100);
const usd = n => "$" + (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Every grant whose typed Received differs from what is recorded on its award.
async function mismatches(q, orgId = null) {
  const rows = await q(
    `SELECT gr.id, gr.org_id, gr.funder, gr.program, gr.funder_donor_id, gr.award_pledge_id, gr.awarded_at,
            gr.received::text AS typed, ${GRANT_RECEIVED("gr")}::text AS recorded, o.timezone,
            d.name AS funder_name, p.id AS pledge_ok
       FROM grants gr JOIN orgs o ON o.id = gr.org_id
       LEFT JOIN donors d ON d.id = gr.funder_donor_id AND d.org_id = gr.org_id AND d.deleted_at IS NULL
       LEFT JOIN pledges p ON p.id = gr.award_pledge_id AND p.org_id = gr.org_id AND p.donor_id = gr.funder_donor_id
      WHERE COALESCE(gr.received, 0) <> 0 AND gr.is_sample IS NOT TRUE AND NOT (gr.org_id = ANY(?::text[]))
        AND (?::text IS NULL OR gr.org_id = ?)
      ORDER BY gr.org_id, gr.id`, [SKIP_ORGS, orgId, orgId]);
  return rows.map(r => ({ ...r, typedCents: c(r.typed), recordedCents: c(r.recorded), diffCents: c(r.typed) - c(r.recorded) }))
    .filter(r => r.diffCents !== 0);
}

// The app's own gift path, loaded once, in this process, only for --apply.
let APP = null;
function appWriters() {
  if (APP) return APP;
  process.env.STEWARD_PROCESS = "web";
  process.env.DISABLE_BACKGROUND_TICKS = "1";
  // Nothing this process does can send: the mail client is given a key that
  // is no key and an address that answers nothing.
  process.env.RESEND_API_KEY = "re_gifts1_script_sends_nothing";
  process.env.RESEND_BASE_URL = "http://127.0.0.1:9";
  process.env.PORT = process.env.GIFTS1_SCRIPT_PORT || "0";
  const app = require("../../server.js");
  APP = { recordGift: app.locals.recordGift, recalcPledgePayment: app.locals.recalcPledgePayment, afterChange: require("../../afterChange").afterChange };
  return APP;
}

async function run({ client, apply = false, orgId = null, log = console.log, writers = null }) {
  const q = qFor(client);
  const out = { written: 0, left: 0, already: 0, rows: [] };
  const list = await mismatches(q, orgId);
  for (const g of list) {
    const name = g.funder_name || g.funder || "(no name)";
    const date = g.awarded_at ? orgTime.orgToday({ timezone: g.timezone }, new Date(g.awarded_at)) : null;
    const label = `  ${g.org_id}  ${g.id}  ${name}${g.program ? " · " + g.program : ""}: typed ${usd(g.typedCents)}, recorded ${usd(g.recordedCents)}`;
    const row = { grantId: g.id, orgId: g.org_id, typedCents: g.typedCents, recordedCents: g.recordedCents, diffCents: g.diffCents, date };
    out.rows.push(row);
    if (g.diffCents < 0) { log(`${label}: recorded payments are above the typed figure, nothing to write`); row.action = "above"; out.left++; continue; }
    if (!g.funder_donor_id || !g.funder_name || !g.pledge_ok || !date) {
      log(`${label}: no award recorded on a funder record, record the award first (left for a person)`); row.action = "left"; out.left++; continue;
    }
    const [had] = await q("SELECT id FROM gifts WHERE org_id=? AND external_id=?", [g.org_id, extId(g.id)]);
    if (had) { log(`${label}: its payment from typed Received was written before (${had.id}), nothing more`); row.action = "already"; out.already++; continue; }
    if (!apply) { log(`${label}: would write a ${usd(g.diffCents)} payment from ${name}, dated ${date}`); row.action = "would_write"; out.written++; continue; }
    const W = writers || appWriters();
    const w = await W.recordGift({
      orgId: g.org_id, donorId: g.funder_donor_id, amount: g.diffCents / 100, date, type: "pledge payment",
      pledgeId: g.award_pledge_id, notes: NOTE, externalId: extId(g.id), conflict: "external",
      history: true, alreadyThanked: true, actorId: ACTOR.id, actorName: ACTOR.name, source: "script",
    });
    if (w.duplicate || !w.gift) { log(`${label}: already written`); row.action = "already"; out.already++; continue; }
    await W.recalcPledgePayment(g.award_pledge_id, g.org_id);
    await W.afterChange(g.org_id, [g.funder_donor_id], { door: "script", recalc: true }).catch(e => log(`    after-change: ${e.message}`));
    await client.query(
      `INSERT INTO fin_audit_log
         (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
          changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'created','gift',$6,$7,$8,$9,$10,1,'SCRIPT','scripts/ops/gifts1-grant-received.js')`,
      ["al_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), g.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, w.gift.id,
       JSON.stringify({ grant_id: { from: null, to: g.id } }), JSON.stringify({}),
       JSON.stringify({ grant_id: g.id, pledge_id: g.award_pledge_id, amount: g.diffCents / 100, date }),
       `Recorded ${usd(g.diffCents)} from ${name} on the ${g.program || "grant"} award, the typed Received less the payments already recorded.`]);
    log(`${label}: wrote a ${usd(g.diffCents)} payment (${w.gift.id})`);
    row.action = "written"; row.giftId = w.gift.id; out.written++;
  }
  log(`\n${out.written} payment(s) ${apply ? "written" : "would be written"}, ${out.already} already written, ${out.left} left for a person.`);
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
    console.log(APPLY ? "MODE: APPLY (one payment gift per grant, through recordGift)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    await run({ client, apply: APPLY, orgId: orgArg });
  } catch (e) { console.error(e); code = 1; }
  finally {
    client.release();
    await pool.end();
  }
  // --apply loaded the app; its pool and port close with the process.
  process.exit(code);
}

if (require.main === module) main();
module.exports = { run, mismatches, SKIP_ORGS, extId };
