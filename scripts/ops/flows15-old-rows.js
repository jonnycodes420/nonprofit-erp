#!/usr/bin/env node
// FLOWS-15 · ROWS STILL CARRYING THE OLD STATE. READ ONLY: there is no --apply; it writes nothing.
//
//   item 3 (W-1116-Atlas-01X): Atlas answers saved before this build as a list whose count is a
//     money value, not people ("Lifetime $6,523 / 6,523 people"). A saved list answer keeps its
//     count in voice_memos.read.answers; these are the ones whose count is more than the people
//     behind them and that name one person. New answers carry unit "people" and are not listed.
//   item 1 (W-1114-Fundraising-17): campaigns not yet sent whose letter thanks the reader for giving
//     with a block that has no first-gift version, and how many never-givers the send now leaves out
//     (it used to send them the donor version). Nothing to repair: the send reads the rule; listed so
//     the org can write a version or tick them in.
// Items 2, 4, 5 and 6 store nothing; they are computed on every read.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/flows15-old-rows.js            # every org
//   DATABASE_URL=… node scripts/ops/flows15-old-rows.js org_x      # one org
"use strict";
const { Pool } = require("pg");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const org = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const pool = new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const PG = await import("../../shared/pastGiving.js");
  try {
    await pool.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const memos = await pool.query(
      `SELECT org_id, id, created_at, read FROM voice_memos
        WHERE source LIKE 'atlas%' AND read IS NOT NULL AND read::text LIKE '%"type":"list"%' AND ($1::text IS NULL OR org_id = $1)
        ORDER BY org_id, created_at`, [org]);
    let bad = 0;
    for (const m of memos.rows) {
      let read; try { read = typeof m.read === "string" ? JSON.parse(m.read) : m.read; } catch { continue; }
      for (const [aid, a] of Object.entries((read && read.answers) || {})) {
        if (!a || a.type !== "list" || a.unit === "people") continue;
        const ids = Array.isArray(a.ids) ? a.ids.length : 0;
        if (ids <= 1 && Number(a.count) > ids) { bad++; console.log(`item 3 · ${m.org_id} · memo ${m.id} answer ${aid} · ${String(m.created_at).slice(0, 10)} · count ${a.count}, ${ids} person · "${String(a.question || "").slice(0, 60)}"`); }
      }
    }
    console.log(`item 3 · ${bad} saved Atlas answer(s) whose count is not people.`);
    const camps = await pool.query(
      `SELECT org_id, id, name, status, segment, email_blocks FROM campaigns
        WHERE email_blocks IS NOT NULL AND COALESCE(status,'draft') NOT IN ('sent','sending') AND ($1::text IS NULL OR org_id = $1)
        ORDER BY org_id, id`, [org]);
    let waiting = 0;
    for (const c of camps.rows) {
      const blocks = Array.isArray(c.email_blocks) ? c.email_blocks : [];
      let seg = {}; try { seg = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {}); } catch { /* unreadable */ }
      if (PG.neverGiverOutcome({ blocks, includeNeverGiven: seg.includeNeverGiven === true }) !== "left_out") continue;
      const { rows: [n] } = await pool.query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND erased_at IS NULL AND archived_at IS NULL
                                                AND email IS NOT NULL AND email <> '' AND COALESCE(total_giving,0) <= 0`, [c.org_id]);
      waiting++;
      console.log(`item 1 · ${c.org_id} · ${c.id} "${c.name}" (${c.status}) · donor-only copy with no first-gift version · up to ${n.n} never-givers with an email are now left out`);
    }
    console.log(`item 1 · ${waiting} unsent campaign(s) that now leave never-givers out.`);
  } finally { await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
