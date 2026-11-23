#!/usr/bin/env node
// GIFTS-3 item 1 · GIFTS WHOSE METHOD IS THE WORD "Needs you".
//
// Before GIFTS-3 recordGift stored a method nobody gave as the word "Needs you", and a gift's
// Edit saved it back as if somebody had typed it. Since GIFTS-3 a blank method is stored as
// nothing and every screen reads it "Not set" (shared/giftMethods.js), and every screen already
// reads an old "Needs you" row as "Not set" too, so nothing here is needed for correctness. This
// lists the old rows and, on --apply for one org, stores them as nothing like a new gift.
//
// DRY RUN BY DEFAULT, read only: per org, how many gifts carry the word.
//
//   DATABASE_URL=… node scripts/ops/gifts3-needs-you-method.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/gifts3-needs-you-method.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply sets payment_method to NULL on that one org's listed gifts (no amount, date, fund or
// ledger row changes) in one transaction and writes one audit row as system:gifts3-needs-you.
// A second run finds nothing. A remote database needs --i-know-this-is-prod (prodGuard's
// writerDbUrl). Never org_creo, never org_b72demo. Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:gifts3-needs-you", name: "Gift method stored as nothing (GIFTS-3)", kind: "system" };
const WORD = "lower(trim(COALESCE(g.payment_method, ''))) IN ('needs you', 'unknown')";

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

async function main() {
  const { query, withTransaction } = require("../../db");
  const rows = await query(
    `SELECT g.org_id, COUNT(*)::int AS n FROM gifts g
      WHERE ${WORD} AND ($1::text IS NULL OR g.org_id = $1) AND NOT (g.org_id = ANY($2))
      GROUP BY g.org_id ORDER BY n DESC`, [ORG || null, NEVER]);
  const total = rows.reduce((a, r) => a + r.n, 0);
  console.log(`Gifts whose method is the word "Needs you" (read "Not set" on every screen already): ${total}${ORG ? ` in ${ORG}` : ` in ${rows.length} ${rows.length === 1 ? "org" : "orgs"}`}.`);
  for (const r of rows) console.log(`  ${r.org_id.padEnd(28)} ${String(r.n).padStart(6)}`);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (total ? " Add --org <org> --apply to store them as nothing." : "")); return; }
  if (!total) { console.log("\nNothing to change."); return; }
  let ids = [];
  await withTransaction(async client => {
    ids = (await client.query(`UPDATE gifts g SET payment_method = NULL WHERE g.org_id = $1 AND ${WORD} RETURNING g.id`, [ORG])).rows.map(r => r.id);
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'gifts3 method stored as nothing','gift',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/gifts3-needs-you-method.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ gifts: ids, was: "Needs you" }),
       `Stored the method of ${ids.length} gift${ids.length === 1 ? "" : "s"} as nothing (it read "Needs you")`, ids.length]);
  });
  console.log(`\nChanged ${ids.length}. Amounts, dates, funds and the ledger are untouched.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
