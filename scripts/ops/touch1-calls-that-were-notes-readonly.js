#!/usr/bin/env node
// TOUCH-1 · TOUCHES LOGGED AS A CALL THAT SAY THEY WERE SOMETHING ELSE. READ-ONLY.
//
// Before TOUCH-1 the dialog was "Log a call": a handwritten note, a gift sent
// or a text had nowhere to go, so a director logged it as a call ("Sent a
// thank-you card"). Those rows are type `call`. They already count as Last
// contact (a call always did), so no figure is wrong; what is wrong is the
// word on the timeline. TOUCH-1 does not guess them into a new kind.
//
// This lists the calls logged through the Thread whose words read like a
// note, a card, a letter, a gift or a text, per org, so the person who wrote
// them can change each one (the entry's ⋯ → Edit → pick Handwritten note, Gift
// sent or Text). It writes NOTHING and has no --apply: what she did is hers to say.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/touch1-calls-that-were-notes-readonly.js            # every org
//   DATABASE_URL=… node scripts/ops/touch1-calls-that-were-notes-readonly.js --org=org_x
// org_creo (the boot fixture) is never listed.
"use strict";
const { Pool } = require("pg");

const WORDS = "\\m(note|notes|card|cards|letter|letters|wrote|mailed|postcard|handwritten|gift basket|swag|mug|t-shirt|texted|text message|sms)\\M";
const SQL = `
  SELECT i.org_id, i.id, i.donor_id, d.name, LEFT(i.date, 10) AS date, LEFT(i.note, 90) AS words, i.logged_by_name AS who
    FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
   WHERE i.type = 'call' AND i.org_id <> 'org_creo' AND ($1::text IS NULL OR i.org_id = $1)
     AND COALESCE(i.metadata->>'via', '') = 'thread_log' AND (i.metadata->>'touch_kind') IS NULL
     AND d.deleted_at IS NULL AND i.note ~* '${WORDS}'
   ORDER BY i.org_id, i.date DESC NULLS LAST`;

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const org = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const c = await pool.connect();
    try {
      await c.query("BEGIN READ ONLY");
      const { rows } = await c.query(SQL, [org]);
      await c.query("ROLLBACK");
      if (!rows.length) { console.log("No call reads like a note, a card, a gift or a text. Nothing to change."); return; }
      console.log(`${rows.length} ${rows.length === 1 ? "call reads" : "calls read"} like another kind of touch:\n`);
      for (const r of rows) console.log(`  ${r.org_id}  ${r.id}  ${r.date}  ${r.name}: "${r.words}"  (logged by ${r.who || "unknown"})`);
      console.log("\nChange each in the app: the entry's ⋯ → Edit → pick what it was. Last contact does not move.");
    } finally { c.release(); }
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
