#!/usr/bin/env node
// FLOWS-6 (W-1110-Donors-35X, -36X) · ROWS THE OLD LOGGING LEFT. A DRY RUN; IT WRITES NOTHING.
//
// Two shapes, written before FLOWS-6:
//   1. A Done twin. Logging a touch whose next step was the step already open
//      ("Follow up" while "Follow up" was open) closed that step, so its task
//      went Done, and opened an identical one. The pair reads as one follow-up
//      written twice. Listed: each Done step task whose closing touch opened a
//      new step with the same title. A person leaves it (it is history), or
//      Jonathan voids the Done twin after reading the list.
//   2. A "From your note" step on a log whose Next step was left empty. The
//      card offered a next step from the note after she had said none; a yes
//      opened a step. Listed: open steps opened by a log saved with
//      next_step "skipped". She keeps or deletes each from the profile.
// The bare "From your note" card itself was never a row: it is gone from the
// screen with the fix and needs no repair.
//
// Reads every org except org_b72demo (seed-demo.js owns it). org_creo is
// listed, never written (nothing here writes).
//
// Usage:
//   node scripts/ops/flows6-log-twins.js                 # every org
//   node scripts/ops/flows6-log-twins.js --org=<org_id>  # one org
"use strict";
const { Pool } = require("pg");

const SKIP_ORGS = ["org_b72demo"];
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply."); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  const args = one ? [SKIP_ORGS, one] : [SKIP_ORGS];
  const orgOnly = a => `NOT (${a}.org_id = ANY($1)) ${one ? `AND ${a}.org_id = $2` : ""}`;
  try {
    const twins = (await pool.query(
      `SELECT o.org_id, d.name, t.id AS done_task, t.title, t.due, n.id AS open_thread, n.due_date AS open_due
         FROM threads o
         JOIN threads n ON n.org_id = o.org_id AND n.donor_id = o.donor_id AND n.opening_interaction_id = o.closing_interaction_id
                       AND lower(trim(n.next_step_label)) = lower(trim(o.next_step_label)) AND n.id <> o.id
         JOIN tasks t ON t.thread_id = o.id AND t.org_id = o.org_id AND t.voided_at IS NULL
         LEFT JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
        WHERE o.close_kind = 'outcome' AND o.closing_interaction_id IS NOT NULL AND ${orgOnly("o")}
        ORDER BY o.org_id, d.name, t.due`, args)).rows;
    for (const r of twins) console.log(`twin · ${r.org_id} · ${r.name || "(no person)"} · Done ${r.done_task} "${r.title}" due ${String(r.due || "").slice(0, 10)} beside open step ${r.open_thread} due ${String(r.open_due || "").slice(0, 10)}`);
    const fromNote = (await pool.query(
      `SELECT th.org_id, d.name, th.id, th.next_step_label, th.due_date
         FROM threads th JOIN interactions i ON i.id = th.opening_interaction_id AND i.org_id = th.org_id
         LEFT JOIN donors d ON d.id = th.donor_id AND d.org_id = th.org_id
        WHERE th.closed_at IS NULL AND i.metadata->>'next_step' = 'skipped' AND ${orgOnly("th")}
        ORDER BY th.org_id, d.name`, args)).rows;
    for (const r of fromNote) console.log(`from-note · ${r.org_id} · ${r.name || "(no person)"} · open step ${r.id} "${r.next_step_label}" due ${String(r.due_date || "").slice(0, 10)}, on a log saved with no next step`);
    console.log(`\n${twins.length} Done twin(s) beside an identical open step; ${fromNote.length} open step(s) opened on a log saved with no next step.`);
    console.log("Dry run: nothing was written.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
