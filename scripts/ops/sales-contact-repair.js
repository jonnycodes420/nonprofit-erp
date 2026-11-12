#!/usr/bin/env node
// scripts/ops/sales-contact-repair.js · SALES-FIX-1 items 2 and 4. THE ROWS THE OLD IMPORT LEFT.
//
// Before SALES-FIX-1, a contacts file imported before its organizations left its people
// unlinked (Skip never linked them later), and re-importing an email-less file with Update
// made a second copy of everyone. The fix stops new bad rows; this finds the old ones.
//
//   node scripts/ops/sales-contact-repair.js            DRY RUN: prints what it would do, writes nothing
//   node scripts/ops/sales-contact-repair.js --apply    merges each duplicate into the oldest copy
//                                                       (SALES-1's merge: links, activities and email
//                                                       move, the merge is recorded), through
//                                                       prodGuard.writerDbUrl (a remote database also
//                                                       needs --i-know-this-is-prod). Jonathan runs it.
//
// A DUPLICATE here is two or more live contacts with no email, the same first and last name
// (case and spaces ignored), and either the same organization or no organization at all.
// UNLINKED contacts are only listed: the fix for them is to import the same contacts file
// again with Skip, now that the organizations exist (Skip adds the links it names).
// Never runs at deploy. Made-up fixtures only in tests; this reads whatever DATABASE_URL names.
"use strict";

const apply = process.argv.includes("--apply");
if (apply) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const WHO = { id: "system:sales-contact-repair", name: "SALES-FIX-1 contact repair" };

async function findDuplicates(query) {
  const rows = await query(`SELECT c.id, c.first_name, c.last_name, c.created_at,
                                   COALESCE((SELECT string_agg(l.b_id, ',' ORDER BY l.b_id) FROM sales_links l WHERE l.a_type = 'contact' AND l.a_id = c.id AND l.b_type = 'org'), '') AS orgs
                              FROM sales_contacts c WHERE c.deleted_at IS NULL AND c.emails = '[]'::jsonb ORDER BY c.created_at, c.id`);
  const key = r => `${String(r.first_name || "").trim().toLowerCase().replace(/\s+/g, " ")}|${String(r.last_name || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
  const byName = new Map();
  for (const r of rows) { if (key(r) === "|") continue; if (!byName.has(key(r))) byName.set(key(r), []); byName.get(key(r)).push(r); }
  const groups = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    // Linked copies group by their organizations; an unlinked copy joins the oldest linked group (or forms its own).
    const linked = new Map();
    for (const r of list.filter(x => x.orgs)) { if (!linked.has(r.orgs)) linked.set(r.orgs, []); linked.get(r.orgs).push(r); }
    const orphans = list.filter(x => !x.orgs);
    const first = [...linked.values()][0];
    if (first) first.push(...orphans); else if (orphans.length) linked.set("", orphans);
    for (const g of linked.values()) if (g.length > 1) groups.push(g.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
  }
  return groups;
}

async function main() {
  const { query, run } = require("../../db");
  const groups = await findDuplicates(query);
  const unlinked = await query(`SELECT COUNT(*)::int AS n FROM sales_contacts c WHERE c.deleted_at IS NULL
                                  AND NOT EXISTS (SELECT 1 FROM sales_links l WHERE l.a_type = 'contact' AND l.a_id = c.id AND l.b_type = 'org')`);
  const extra = groups.reduce((n, g) => n + g.length - 1, 0);
  console.log(`[sales-contact-repair] ${apply ? "APPLY" : "DRY RUN"} · ${plural(groups.length, "person", "people")} with duplicate email-less copies (${plural(extra, "extra copy", "extra copies")})`);
  for (const g of groups.slice(0, 50)) console.log(`  ${g[0].first_name || ""} ${g[0].last_name || ""}: keep ${g[0].id}, merge ${g.slice(1).map(x => x.id).join(", ")}`);
  if (groups.length > 50) console.log(`  … and ${groups.length - 50} more`);
  console.log(`  ${plural(unlinked[0].n, "contact has", "contacts have")} no organization. Import the same contacts file again with Skip to link them.`);
  if (!apply) { console.log("  Nothing written. Run with --apply to merge."); return; }
  const MERGE = require("../../server/admin/sales/merge");
  let done = 0;
  for (const g of groups) for (const gone of g.slice(1)) {
    const r = await MERGE.merge({ query, run }, "contact", g[0].id, gone.id, WHO);
    if (r.ok) done++; else console.log(`  not merged ${gone.id}: ${r.message || r.error}`);
  }
  console.log(`  Merged ${plural(done, "copy", "copies")}.`);
}

if (require.main === module) main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
module.exports = { findDuplicates };
