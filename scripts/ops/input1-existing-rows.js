#!/usr/bin/env node
// INPUT-1 · THE ROWS WRITTEN BEFORE THIS BUILD THAT CARRY THE OLD STATE.
//
// INPUT-1 stops new bad rows. These are the ones already there, per org, read only:
//   1. gifts typed on a person's gift form since GIFTS-3 (#501, 23 Nov 2026 18:40 ET), when the
//      form began dropping a typed minus. A flipped gift can't be told from a real one by the data
//      alone, so this only COUNTS the window (staff-typed: an idempotency key, a user as actor, no
//      import, no Stripe, not a refund). Nothing is changed; a person who knows reads the list.
//   2. thank-you drafts still waiting for a gift whose date is after today (written at once,
//      before the gift's day). Listed; a person decides (Discard, or leave it until the day).
//   3. shifts saved with their end before their start and no end date (booked as overnight,
//      e.g. 17:00 to 16:00 as 23 hours). --apply gives each the end date it was booked as (the
//      next day), so the schedule and the conflict count read it as what it was. Hours unchanged.
//   4. hours written by check-in or check-out on a day other than the shift's (dated "today").
//      Listed with both dates; a person moves them on the record if they were early check-ins.
//   5. ledger-only Money in / Money out rows with a negative amount (source manual). Listed.
//
//   DATABASE_URL=… node scripts/ops/input1-existing-rows.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/input1-existing-rows.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply writes ONLY item 3, for one org, in one transaction, with one audit row as
// system:input1-existing-rows. A remote database needs --i-know-this-is-prod (prodGuard's
// writerDbUrl). Never org_creo, never org_b72demo. Nothing sends. Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:input1-existing-rows", name: "Overnight shifts given their end date (INPUT-1)", kind: "system" };
const GIFTS3_AT = "2026-11-23T23:40:07Z";   // a6c9599, GIFTS-3 (#501): the gift form began dropping a typed minus

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

async function main() {
  const { query, withTransaction } = require("../../db");
  const { orgTzSql } = require("../../orgTime");
  const args = [ORG || null, NEVER];
  const scope = a => `($1::text IS NULL OR ${a}.org_id = $1) AND NOT (${a}.org_id = ANY($2))`;
  const today = a => `to_char((NOW() AT TIME ZONE ${orgTzSql(`${a}.org_id`)})::date, 'YYYY-MM-DD')`;

  const window = await query(
    `SELECT g.org_id, COUNT(*)::int AS n FROM gifts g
      WHERE ${scope("g")} AND g.created_at >= $3 AND g.idempotency_key IS NOT NULL AND g.import_id IS NULL
        AND g.stripe_payment_id IS NULL AND g.refund_of IS NULL AND g.created_by NOT LIKE 'system:%'
      GROUP BY g.org_id ORDER BY g.org_id`, [...args, GIFTS3_AT]);
  const early = await query(
    `SELECT t.org_id, t.id, d.name, g.date FROM thank_you_drafts t
       JOIN gifts g ON g.id = t.gift_id AND g.org_id = t.org_id JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE ${scope("t")} AND g.scheduled_on IS NOT NULL AND g.scheduled_on > ${today("t")}
        AND t.sent_at IS NULL AND t.skipped_at IS NULL
      ORDER BY t.org_id, g.date`, args).catch(e => [{ org_id: "(could not read)", id: e.message, name: "", date: "" }]);
  const wrapped = await query(
    `SELECT s.org_id, s.id, s.date, s.start_time, s.end_time FROM volunteer_slots s
      WHERE ${scope("s")} AND s.cancelled_at IS NULL AND s.end_date IS NULL AND s.end_time <= s.start_time
        AND NOT (s.start_time = '00:00' AND s.end_time = '23:59')
      ORDER BY s.org_id, s.date`, args);
  const misdated = await query(
    `SELECT v.org_id, v.id, d.name, v.date AS logged, s.date AS shift FROM volunteer_shifts v
       JOIN volunteer_slots s ON s.id = v.slot_id AND s.org_id = v.org_id JOIN donors d ON d.id = v.person_id AND d.org_id = v.org_id
      WHERE ${scope("v")} AND v.via = 'staff' AND LEFT(v.date::text, 10) <> s.date
      ORDER BY v.org_id, v.date`, args);
  const ledger = await query(
    `SELECT f.org_id, f.id, f.date, f.amount::text AS amount, f.type, f.description FROM fin_transactions f
      WHERE ${scope("f")} AND COALESCE(f.source, 'manual') = 'manual' AND f.amount < 0
      ORDER BY f.org_id, f.date`, args);

  const say = (title, rows, line) => {
    console.log(`\n${title}: ${rows.length}`);
    for (const r of rows.slice(0, ORG ? 500 : 0)) console.log("  " + line(r));
    if (!ORG) { const by = new Map(); for (const r of rows) by.set(r.org_id, (by.get(r.org_id) || 0) + (r.n || 1)); for (const [o, n] of by) console.log(`  ${o}: ${n}`); }
  };
  console.log(`INPUT-1 existing rows${ORG ? ` in ${ORG}` : ", every org"} (read only)`);
  console.log(`\n1 gifts typed on the gift form since GIFTS-3 (${GIFTS3_AT}), when a typed minus was dropped: ${window.reduce((n, r) => n + r.n, 0)}`);
  for (const r of window) console.log(`  ${r.org_id}: ${r.n}`);
  say("2 thank-you drafts waiting for a gift dated after today", early, r => `${r.id}  ${r.name}  gift dated ${r.date}`);
  say("3 shifts with their end before their start and no end date", wrapped, r => `${r.id}  ${r.date} ${r.start_time} to ${r.end_time}`);
  say("4 hours from check-in dated a day other than the shift's", misdated, r => `${r.id}  ${r.name}  logged ${String(r.logged).slice(0, 10)}, shift ${r.shift}`);
  say("5 ledger-only rows with a negative amount", ledger, r => `${r.id}  ${String(r.date).slice(0, 10)} ${r.type} ${r.amount}  ${r.description}`);

  if (!APPLY) { console.log("\nDry run. --org <id> --apply gives that org's item 3 shifts the next day as their end date."); return; }
  const ids = wrapped.map(r => r.id);
  if (!ids.length) { console.log("\nNothing to apply."); return; }
  await withTransaction(async tx => {
    await tx.query(`UPDATE volunteer_slots SET end_date = to_char(date::date + 1, 'YYYY-MM-DD') WHERE org_id = $1 AND id = ANY($2) AND end_date IS NULL`, [ORG, ids]);
    await tx.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'input1 overnight shifts','volunteer_slot',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/input1-existing-rows.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ endDateSet: wrapped.map(r => ({ id: r.id, date: r.date, start: r.start_time, end: r.end_time })) }),
       `Gave ${ids.length} overnight ${ids.length === 1 ? "shift" : "shifts"} the next day as the end date.`, ids.length]);
  });
  console.log(`\nApplied: ${ids.length} ${ids.length === 1 ? "shift" : "shifts"} now end the next day.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
