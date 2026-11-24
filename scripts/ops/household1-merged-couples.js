#!/usr/bin/env node
// HOUSEHOLD-1 item 5 · COUPLES ALREADY MERGED.
//
// Before HOUSEHOLD-1 the only way to see a couple as one line on the Top 100
// was to merge them, which kept one email, one phone and one photo. Since
// HOUSEHOLD-1 a merged person's profile says "This record was merged from two
// people. Split them back into a household?" for 30 days (Data health's merge
// Undo, then the household, in one step: server/donors/householdSplit.js).
// This lists the merges already made that look like a couple (two names with
// the same last name), so Jonathan can tell the customer which ones still
// split on a click and which are past 30 days and can't be split automatically.
//
// READ ONLY. It writes nothing and has no --apply: a split is her decision, on
// the profile, one couple at a time.
//
//   DATABASE_URL=… node scripts/ops/household1-merged-couples.js [--org <org id>]
"use strict";
const argv = process.argv.slice(2);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
if (!process.env.DATABASE_URL) { console.error("\nREFUSED: set DATABASE_URL first.\n"); process.exit(2); }

const lastWord = n => String(n || "").trim().split(/\s+/).pop().toLowerCase();

async function main() {
  const { query } = require("../../db");
  const rows = await query(
    `SELECT m.org_id, m.id, m.kept_id, m.kept_name, m.merged_name, m.created_at,
            (m.created_at > NOW() - INTERVAL '30 days') AS can_split
       FROM donor_merges m
      WHERE m.undone_at IS NULL${ORG ? " AND m.org_id = ?" : ""}
      ORDER BY m.org_id, m.created_at DESC`, ORG ? [ORG] : []);
  const couples = rows.filter(r => lastWord(r.kept_name) && lastWord(r.kept_name) === lastWord(r.merged_name) && String(r.kept_name).trim().toLowerCase() !== String(r.merged_name).trim().toLowerCase());
  const byOrg = new Map();
  for (const r of couples) (byOrg.get(r.org_id) || byOrg.set(r.org_id, []).get(r.org_id)).push(r);
  console.log(`HOUSEHOLD-1 · merges that look like a couple (same last name, two names), not undone. DRY RUN: nothing is written.\n`);
  if (!byOrg.size) console.log("None.");
  for (const [org, list] of byOrg) {
    const now = list.filter(r => r.can_split), old = list.filter(r => !r.can_split);
    console.log(`${org}: ${list.length} (${now.length} can be split from the profile, ${old.length} older than 30 days)`);
    if (ORG) for (const r of list) console.log(`  ${r.can_split ? "split on the profile" : "older than 30 days"} · ${r.kept_name} ← ${r.merged_name} · ${new Date(r.created_at).toISOString().slice(0, 10)} · person ${r.kept_id}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
