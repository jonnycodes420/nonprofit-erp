#!/usr/bin/env node
// ATLAS-5 · THE ROWS WRITTEN BEFORE THIS BUILD THAT STILL CARRY THE OLD STATE. A DRY RUN; IT WRITES NOTHING.
//
// The code fixes stop new bad rows. These were written before them:
//   1. reminders   saved from an Atlas request that said "next <weekday>",
//                  whose due date is not the one the new rule gives for the day
//                  it was said in the org's own timezone (W-1108-Atlas-20:
//                  "next Tuesday" said on a Sunday saved Tuesday a week late).
//                  Each line gives the task, its due date and the right one. A
//                  person moves the date (the task's own Edit); nothing here does.
//   2. notes       saved from an Atlas request whose note is shorter than her
//                  message cut by the new rule (W-1108-Atlas-03X: "… QA A5"
//                  saved without "QA A5"). Each line gives the note and the
//                  words it lost; a person adds them back if they matter.
// Not listed, because the build already covers them: proposals left waiting
// and "Which Walter?" questions left unanswered now have Dismiss in the bell.
//
// Reads every org except org_b72demo (seed-demo.js owns it). org_creo is
// listed, never written (nothing here writes).
//
// Usage:
//   node scripts/ops/atlas5-old-rows.js                 # every org
//   node scripts/ops/atlas5-old-rows.js --org=<org_id>  # one org
"use strict";
const { Pool } = require("pg");

const SKIP_ORGS = ["org_b72demo"];
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const j = v => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply. A person changes each row from its own screen."); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const A = await import("../../shared/atlas.js");
  const AD = await import("../../shared/atlasDates.js");
  const N = await import("../../shared/atlasNote.js");
  const one = arg("org");
  try {
    const memos = (await pool.query(
      `SELECT m.id, m.org_id, m.text, m.read, m.created_at, o.timezone
         FROM voice_memos m JOIN orgs o ON o.id = m.org_id
        WHERE m.source LIKE 'atlas%' AND m.read #>> '{atlas,proposal,savedAt}' IS NOT NULL
          AND NOT (m.org_id = ANY($1)) ${one ? "AND m.org_id = $2" : ""}
        ORDER BY m.created_at`, one ? [SKIP_ORGS, one] : [SKIP_ORGS])).rows;
    let late = 0, cut = 0;
    console.log("1 · reminders saved from \"next <weekday>\" on the wrong day");
    for (const m of memos) {
      if (!/\bnext (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(m.text)) continue;
      const items = ((j(m.read) || {}).atlas || {}).proposal ? j(m.read).atlas.proposal.items || [] : [];
      const said = AD.todayIn(m.timezone, new Date(m.created_at));
      const right = (A.whenFromWords(m.text, said) || {}).date;
      for (const it of items.filter(x => x.kind === "follow_up" && !x.skip && x.due !== right)) {
        const t = (await pool.query(`SELECT a.place_id AS task_id, t.due, t.done FROM atlas_actions a LEFT JOIN tasks t ON t.id = a.place_id AND t.org_id = a.org_id
                                       WHERE a.org_id=$1 AND a.request_id=$2 AND a.kind='reminder' AND a.state='done' LIMIT 1`, [m.org_id, m.id])).rows[0] || {};
        if (t.done) continue;
        late++;
        console.log(`  ${m.org_id} · task ${t.task_id || "(not found)"} · "${String(m.text).slice(0, 70)}" said ${AD.dayWithWeekday(said)} · due ${it.due} · should be ${right} (${AD.dayWithWeekday(right)})`);
      }
    }
    console.log(`  ${late} reminder(s) to move.`);
    console.log("\n2 · notes saved without the end of her message");
    for (const m of memos) {
      const items = (((j(m.read) || {}).atlas || {}).proposal || {}).items || [];
      for (const it of items.filter(x => x.kind === "note" && !x.skip)) {
        const whole = N.noteText(m.text, { kind: "note", who: it.name, words: it.note });
        if (whole.length <= String(it.note).length || String(it.note).includes(whole)) continue;
        cut++;
        console.log(`  ${m.org_id} · ${it.name} · saved "${String(it.note).slice(0, 60)}" · her message also said "${whole.slice(String(it.note).length).trim().slice(0, 60)}"`);
      }
    }
    console.log(`  ${cut} note(s) shorter than her message.`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
