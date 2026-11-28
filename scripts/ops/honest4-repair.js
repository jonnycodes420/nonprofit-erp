#!/usr/bin/env node
// scripts/ops/honest4-repair.js · HONEST-4 items 1 and 6. FOR JONATHAN; NOTHING RUNS AT DEPLOY.
//
// HONEST-4 stops new bad rows. Two kinds of row that already exist still carry the old state:
//   1. open quiet-connection tasks (opened by system:giving-source) whose title counts days
//      ("Givebutter hasn't sent a gift in 67 days."), which is wrong the next day. Each would be
//      retitled to the day it went quiet ("… since Sep 20, 2026."), from its source's last gift,
//      by the same function the sweep now uses (server/connections/status.js quietSentence).
//   2. the public status page's stored checks for "Stripe gift sync" and "Other connection syncs"
//      that read "up" while no real (non-demo) org held that connection. Each would read "unknown"
//      (the page shows no status word and leaves it out of the percentage).
// It changes NOTHING without --apply. --apply writes through scripts/lib/prodGuard's writerDbUrl (a
// remote database needs --i-know-this-is-prod) and one audit row per org for the tasks. org_creo is
// never touched.
//
//   DATABASE_URL=… node scripts/ops/honest4-repair.js [--org=<id>]
//   DATABASE_URL=… node scripts/ops/honest4-repair.js --apply [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const SKIP = new Set(["org_creo"]);
const ACTOR = { id: "system:scripts/honest4-repair", name: "HONEST-4 repair (Jonathan ran it)" };
const COUNTED = /^(.+) hasn't sent a (gift|sale) in \d+ days\.(.*)$/;

async function main() {
  const apply = process.argv.includes("--apply");
  const one = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const url = apply ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const q = async (sql, args = []) => (await pool.query(sql.replace(/\?/g, (() => { let i = 0; return () => "$" + (++i); })()), args)).rows;
  const { quietSentence } = require("../../server/connections/status");
  const PF = require("../../server/connections/proof");
  const totals = { tasks: 0, checks: 0 };
  try {
    // 1 · task titles that count days
    const tasks = await q(
      `SELECT t.id, t.org_id, t.title FROM tasks t
        WHERE t.created_by = 'system:giving-source' AND t.voided_at IS NULL
          AND COALESCE(t.done::text, '0') NOT IN ('1','true') AND t.title ~ ' in [0-9]+ days\\.'
          AND (?::text IS NULL OR t.org_id = ?) ORDER BY t.org_id, t.id`, [one, one]);
    const byOrg = new Map();
    for (const t of tasks) {
      if (SKIP.has(t.org_id)) continue;
      const m = COUNTED.exec(t.title || "");
      if (!m) continue;
      const [src] = await q(
        `SELECT MAX(g.date)::text AS last FROM gifts g JOIN giving_sources s ON s.id = g.giving_source_id AND s.org_id = g.org_id
          WHERE g.org_id = ? AND g.amount > 0 AND (s.display_name = ? OR s.provider = LOWER(REPLACE(?, ' ', '')))`, [t.org_id, m[1], m[1], m[1]]);
      if (!src || !src.last) continue;
      const title = `${quietSentence({ label: m[1], noun: m[2], lastDate: src.last, stored: true, rhythm: null })}${m[3] || ""}`.replace(/\s+$/, "");
      (byOrg.get(t.org_id) || byOrg.set(t.org_id, []).get(t.org_id)).push({ id: t.id, from: t.title, to: title });
    }
    for (const [org, list] of byOrg) {
      console.log(org);
      for (const x of list) console.log(`  task ${x.id}: "${x.from}" → "${x.to}"`);
      totals.tasks += list.length;
      if (!apply) continue;
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        for (const x of list) await c.query(`UPDATE tasks SET title = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`, [org, x.id, x.to]);
        await c.query(`INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id, changes, summary, record_count, request_method, request_path)
                       VALUES ($1,$2,$3,$4,'system','honest4 quiet task titles','org',NULL,$5,$6,$7,'SCRIPT','scripts/ops/honest4-repair.js')`,
          ["al_" + require("crypto").randomBytes(10).toString("hex"), org, ACTOR.id, ACTOR.name,
           JSON.stringify({ tasks: list.map(x => ({ id: x.id, from: x.from })) }), `Retitled ${list.length} quiet-connection task(s) to the day they went quiet`, list.length]);
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    }
    // 2 · the status page's history, where nothing real was being measured
    if (!one) {
      const act = await PF.platformActivity(q);
      for (const [service, a] of [["stripe", act.stripe], ["connections", act.sources]]) {
        if (a.held > 0) { console.log(`status page · ${service}: ${a.held} real connection(s) held; history left as it is.`); continue; }
        const [n] = await q(`SELECT COUNT(*)::int AS n FROM status_checks WHERE service = ? AND state = 'up'`, [service]);
        console.log(`status page · ${service}: no real connection is held; ${n.n} stored "up" check(s) would read "unknown".`);
        totals.checks += n.n;
        if (apply && n.n) await q(`UPDATE status_checks SET state = 'unknown', detail = ? WHERE service = ? AND state = 'up'`,
          [`No live ${service === "stripe" ? "Stripe" : "giving-source"} connection to measure (HONEST-4 repair).`, service]);
      }
    }
    console.log(`\n${apply ? "Applied" : "Dry run, nothing written"}: ${totals.tasks} task title(s), ${totals.checks} status check(s).${apply ? "" : " Add --apply to change them."}`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
