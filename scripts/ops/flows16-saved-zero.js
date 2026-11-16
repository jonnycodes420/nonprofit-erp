#!/usr/bin/env node
// FLOWS-16 item 3 · ATLAS SAVES THAT SAID "SAVED 0 THINGS." DRY RUN BY DEFAULT.
//
// Before FLOWS-16 a Save that wrote nothing set its proposal line to "Saved 0
// things." and the card read "Saved." FLOWS-16 says "Nothing was saved." for
// new ones; the lines already written still say the old words. This lists them
// (per org, with the request and when), and with --apply rewrites only that
// line's words to "Nothing was saved." and records the count on the proposal
// (savedCount 0, so the card says "Nothing was saved." too). Nothing else
// changes: no task, note or draft is written or removed.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/flows16-saved-zero.js                 # every org, read only
//   DATABASE_URL=… node scripts/ops/flows16-saved-zero.js --org=org_x
//   DATABASE_URL=… node scripts/ops/flows16-saved-zero.js --apply         # rewrite the lines listed
// org_creo (the boot fixture) is never listed or changed. --apply resolves its
// database through prodGuard.writerDbUrl(), so a remote one also needs
// --i-know-this-is-prod, and writes one audit row per org with what it changed.
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
if (process.argv.includes("--apply")) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
const ACTOR = { id: "system:scripts/ops/flows16-saved-zero", name: "Repair: Atlas saves that wrote nothing (FLOWS-16)" };

const OLD = "Saved 0 things.";
const NEW = "Nothing was saved.";

(async () => {
  const apply = process.argv.includes("--apply");
  const org = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false } });
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.org_id, a.request_id, a.created_at FROM atlas_actions a
        WHERE a.kind = 'proposal' AND a.line = $1 AND a.org_id <> 'org_creo' AND ($2::text IS NULL OR a.org_id = $2)
        ORDER BY a.org_id, a.created_at`, [OLD, org]);
    const byOrg = {};
    for (const r of rows) (byOrg[r.org_id] = byOrg[r.org_id] || []).push(r);
    for (const [o, list] of Object.entries(byOrg)) {
      console.log(`${o}: ${list.length} line(s) say "${OLD}"`);
      for (const r of list.slice(0, 20)) console.log(`  ${r.created_at.toISOString().slice(0, 16)}  request ${r.request_id}`);
    }
    if (!rows.length) console.log(`No proposal line says "${OLD}".`);
    if (!apply) { console.log(rows.length ? `\nRead only. Run again with --apply to rewrite these ${rows.length} line(s) to "${NEW}".` : ""); return; }
    let lines = 0, props = 0;
    for (const [o, list] of Object.entries(byOrg)) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const ids = list.map(r => r.id), reqs = [...new Set(list.map(r => r.request_id).filter(Boolean))];
        const a = await c.query(`UPDATE atlas_actions SET line = $1, updated_at = NOW() WHERE org_id = $2 AND id = ANY($3::text[]) AND line = $4`, [NEW, o, ids, OLD]);
        const m = await c.query(`UPDATE voice_memos SET read = jsonb_set(read, '{atlas,proposal,savedCount}', '0'::jsonb)
                                  WHERE org_id = $1 AND id = ANY($2::text[]) AND read #> '{atlas,proposal}' IS NOT NULL AND read #> '{atlas,proposal,savedCount}' IS NULL`, [o, reqs]);
        await c.query(`INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id, changes, summary, record_count, request_method, request_path)
                       VALUES ($1,$2,$3,$4,'system','flows16 saved-zero','org',NULL,$5,$6,$7,'SCRIPT','scripts/ops/flows16-saved-zero.js')`,
          ["al_" + crypto.randomBytes(10).toString("hex"), o, ACTOR.id, ACTOR.name, JSON.stringify({ lines: ids, requests: reqs, from: OLD, to: NEW }),
           `Rewrote ${a.rowCount} Atlas line(s) from "${OLD}" to "${NEW}"`, a.rowCount]);
        await c.query("COMMIT");
        lines += a.rowCount; props += m.rowCount;
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    }
    console.log(`\nRewrote ${lines} line(s) and marked ${props} proposal(s) as saving nothing, one audit row per org.`);
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
