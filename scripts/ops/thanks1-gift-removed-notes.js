#!/usr/bin/env node
// THANKS-1 item 3 · "GIFT REMOVED, THANK-YOU CANCELLED" NOTES ON THE TIMELINE.
//
// Before THANKS-1, deleting a gift wrote a note on the donor's timeline
// ("Gift removed, thank-you cancelled. …", FIX-10 / FLOWS-11), so the timeline
// never came back to where it was (the fleet: one person carried four). A
// removed gift is a change to the record, not something that happened with the
// donor: since THANKS-1 the delete writes a Recent changes line and the audit
// row, and nothing on the timeline. This finds the notes left from before.
//
// DRY RUN BY DEFAULT, read only: per org, how many; with --org, each person.
//
//   DATABASE_URL=… node scripts/ops/thanks1-gift-removed-notes.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/thanks1-gift-removed-notes.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply, for that one org, in one transaction: ONE audit row as
// system:thanks1-gift-removed-notes keeps every note (person, date, words, who
// wrote it), then the notes leave the timeline. A remote database needs
// --i-know-this-is-prod (prodGuard's writerDbUrl). Never org_b72demo (only the
// seed writes it). Nothing is sent. Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_b72demo"];
const ACTOR = { id: "system:thanks1-gift-removed-notes", name: "Gift-removed notes moved off the timeline (THANKS-1)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

const FIND_SQL = `
  SELECT i.id, i.org_id, i.donor_id, d.name AS donor_name, i.date, i.note, i.created_by, i.logged_by_name, i.created_at
    FROM interactions i LEFT JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
   WHERE i.type = 'note' AND i.note LIKE 'Gift removed, thank-you cancelled.%'
     AND ($1::text IS NULL OR i.org_id = $1) AND NOT (i.org_id = ANY($2))
   ORDER BY i.org_id, d.name, i.created_at`;

async function main() {
  const { query, withTransaction } = require("../../db");
  const rows = await query(FIND_SQL, [ORG || null, NEVER]);
  const byOrg = new Map();
  for (const r of rows) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
  console.log(`"Gift removed" notes on a timeline: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, n] of byOrg) console.log(`  ${org.padEnd(28)} ${String(n).padStart(4)}`);
  if (ORG) {
    const per = new Map();
    for (const r of rows) per.set(r.donor_name || r.donor_id, (per.get(r.donor_name || r.donor_id) || 0) + 1);
    for (const [who, n] of per) console.log(`    ${who} · ${n}`);
  }
  if (!APPLY) { console.log("\nDry run: nothing was written." + (rows.length ? " Add --org <org> --apply to move them off the timeline (kept in the audit)." : "")); return; }
  if (!rows.length) { console.log("\nNothing to move."); return; }
  let moved = 0;
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'thanks1 gift removed notes','interaction',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/thanks1-gift-removed-notes.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ moved: rows.map(r => ({ id: r.id, donor: r.donor_id, name: r.donor_name, date: r.date, note: r.note, by: r.logged_by_name || r.created_by, at: r.created_at })) }),
       `Moved ${rows.length} "Gift removed, thank-you cancelled" note${rows.length === 1 ? "" : "s"} off the timeline; each is kept here`, rows.length]);
    moved = (await client.query(`DELETE FROM interactions WHERE org_id = $1 AND id = ANY($2::text[]) AND type = 'note' AND note LIKE 'Gift removed, thank-you cancelled.%'`,
      [ORG, rows.map(r => r.id)])).rowCount;
  });
  console.log(`\nMoved ${moved} note${moved === 1 ? "" : "s"} off the timeline; one audit row keeps them. Nothing was sent.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
module.exports = { FIND_SQL };
