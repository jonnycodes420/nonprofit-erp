#!/usr/bin/env node
// scripts/ops/sales-misfiled-notes.js · SALES-4 item 6. MOVE STEWARD'S OWN NOTES OFF A PROSPECT.
//
// The first import put Jonathan's own planning notes ("December campaign", "Weekly scoreboard",
// "Open question for Jonathan") on a prospect's deal (Jessamine County Food Pantry's). This finds
// every note and task on a prospect's deal, organization or contact that is about Steward rather
// than about that prospect, and moves it to the built-in "Steward (us)" record.
//
//   node scripts/ops/sales-misfiled-notes.js            DRY RUN: lists each one by title, writes nothing
//   node scripts/ops/sales-misfiled-notes.js --apply    makes "Steward (us)" if it isn't there (marked Do
//                                                       not contact, so no queue or export offers it),
//                                                       then moves each listed note or task: its links to
//                                                       the prospect go, one link to "Steward (us)" comes.
//                                                       Through prodGuard.writerDbUrl (a remote database
//                                                       also needs --i-know-this-is-prod). Jonathan runs it.
//
// ABOUT STEWARD, NOT THE PROSPECT: the title (its first line) matches one of STEWARD_TITLES, and
// the text never names the prospect it sits on (the organization's or deal's name, or one of its
// people's full names). A note that names the prospect stays, whatever else it says.
// Never runs at deploy. Made-up fixtures only in tests; this reads whatever DATABASE_URL names.
"use strict";

const apply = process.argv.includes("--apply");
if (apply) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
const WHO = { id: "system:sales-misfiled-notes", name: "SALES-4 misfiled notes" };
const US_ID = "sor_steward_us", US_NAME = "Steward (us)";
const STEWARD_TITLES = [
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|year[- ]end|q[1-4])\s+campaign\b/i,
  /\bweekly\s+scoreboard\b/i, /\bscoreboard\b/i,
  /\bopen\s+questions?\s+for\s+jonathan\b/i, /\bquestions?\s+for\s+jonathan\b/i,
  /\b(weekly|monthly|sales)\s+goals?\b/i, /\b\d+\s+demos?\s+(booked\s+)?by\b/i,
  /\bsteward\s*\(us\)/i, /\b(our|my)\s+(pipeline|campaign|goals?|targets?)\b/i,
];
const norm = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const titleOf = body => String(body || "").split(/\r?\n/).map(s => s.trim()).find(Boolean) || "(empty)";

// Pure: is this text about Steward rather than about the named prospect?
function misfiled(body, names) {
  const title = titleOf(body);
  if (!STEWARD_TITLES.some(re => re.test(title))) return false;
  const text = ` ${norm(body)} `;
  return !names.map(norm).filter(n => n.length >= 4).some(n => text.includes(` ${n} `));
}

async function find(query) {
  const acts = await query(`SELECT a.id, a.kind, a.body, a.at, l.record_type, l.record_id
                              FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id
                             WHERE a.deleted_at IS NULL AND a.kind IN ('note', 'task') AND l.record_id <> ?
                             ORDER BY a.at, a.id`, [US_ID]);
  const [orgs, deals, contacts, links] = await Promise.all([
    query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL`),
    query(`SELECT id, name FROM sales_deals WHERE deleted_at IS NULL`),
    query(`SELECT id, first_name, last_name FROM sales_contacts WHERE deleted_at IS NULL`),
    query(`SELECT a_type, a_id, b_type, b_id FROM sales_links`),
  ]);
  const name = new Map([...orgs.map(o => [`org:${o.id}`, o.name]), ...deals.map(d => [`deal:${d.id}`, d.name]),
    ...contacts.map(c => [`contact:${c.id}`, [c.first_name, c.last_name].filter(Boolean).join(" ")])]);
  // Every name that belongs with a record: its own, and its linked organizations', deals' and people's.
  const namesFor = (type, id) => {
    const out = [name.get(`${type}:${id}`)];
    for (const l of links) {
      if (l.a_type === type && l.a_id === id) out.push(name.get(`${l.b_type}:${l.b_id}`));
      if (l.b_type === type && l.b_id === id) out.push(name.get(`${l.a_type}:${l.a_id}`));
    }
    return out.filter(Boolean);
  };
  const byAct = new Map();
  for (const a of acts) {
    if (!byAct.has(a.id)) byAct.set(a.id, { id: a.id, kind: a.kind, body: a.body, at: a.at, on: [] });
    byAct.get(a.id).on.push({ type: a.record_type, id: a.record_id, name: name.get(`${a.record_type}:${a.record_id}`) || "(deleted)" });
  }
  const out = [];
  for (const a of byAct.values()) {
    const names = a.on.flatMap(r => namesFor(r.type, r.id));
    if (misfiled(a.body, names)) out.push({ ...a, title: titleOf(a.body) });
  }
  return out;
}

async function main() {
  const { query, run } = require("../../db");
  const found = await find(query);
  console.log(`[sales-misfiled-notes] ${apply ? "APPLY" : "DRY RUN"} · ${found.length} ${found.length === 1 ? "note or task is about Steward, not the prospect it sits on" : "notes and tasks are about Steward, not the prospects they sit on"}`);
  for (const f of found) console.log(`  ${f.kind === "task" ? "Task" : "Note"} "${f.title}" · on ${f.on.map(r => `${r.type} ${r.name}`).join(", ")} → ${US_NAME}`);
  if (!apply) { console.log("  Nothing written. Run with --apply to move them."); return; }
  const [us] = await query(`SELECT id FROM sales_orgs WHERE id = ?`, [US_ID]);
  if (!us) {
    await run(`INSERT INTO sales_orgs (id, name, dnc_at, dnc_reason, dnc_by_name, created_by, created_by_name, updated_by, updated_by_name)
               VALUES (?, ?, NOW(), 'Steward''s own record: campaign, goal and scoreboard notes. Never called.', ?, ?, ?, ?, ?)`, [US_ID, US_NAME, WHO.name, WHO.id, WHO.name, WHO.id, WHO.name]);
    console.log(`  Made "${US_NAME}" (${US_ID}).`);
  }
  for (const f of found) {
    await run(`DELETE FROM sales_activity_links WHERE activity_id = ?`, [f.id]);
    await run(`INSERT INTO sales_activity_links (activity_id, record_type, record_id, created_by, created_by_name) VALUES (?, 'org', ?, ?, ?) ON CONFLICT DO NOTHING`, [f.id, US_ID, WHO.id, WHO.name]);
    await run(`UPDATE sales_activities SET updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [WHO.id, WHO.name, f.id]);
  }
  console.log(`  Moved ${found.length} to "${US_NAME}".`);
}

if (require.main === module) main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
module.exports = { find, misfiled, titleOf, STEWARD_TITLES, US_ID, US_NAME };
