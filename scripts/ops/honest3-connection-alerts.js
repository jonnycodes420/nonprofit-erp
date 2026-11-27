#!/usr/bin/env node
// scripts/ops/honest3-connection-alerts.js · HONEST-3 item 2. FOR JONATHAN; NOTHING RUNS AT DEPLOY.
//
// HONEST-3 turns "A connection stops working" on for the first admin of a NEW org, and writes on each
// new quiet-connection task whether anybody will be emailed about it. Rows that existed before it are
// not changed at deploy. This lists them:
//   1. open quiet-connection tasks (opened by system:giving-source) with no note, and the sentence
//      each would get (server/connections/alertReach.js, the same function the sweep now uses);
//   2. with --prefs, each org's first active admin who has connection alerts off.
// It changes NOTHING without --apply. --apply writes the task notes; --apply --prefs also turns the
// alerts on for those admins (staff mail only, and still nothing goes while the org's staff email is
// off). --apply writes through scripts/lib/prodGuard's writerDbUrl (a remote database needs
// --i-know-this-is-prod) and one audit row per org. org_creo is never touched.
//
//   DATABASE_URL=… node scripts/ops/honest3-connection-alerts.js [--prefs] [--org=<id>]
//   DATABASE_URL=… node scripts/ops/honest3-connection-alerts.js --apply [--prefs] [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const SKIP = new Set(["org_creo"]);
const ACTOR = { id: "system:scripts/honest3-connection-alerts", name: "HONEST-3 connection alerts (Jonathan ran it)" };

async function main() {
  const apply = process.argv.includes("--apply");
  const prefs = process.argv.includes("--prefs");
  const one = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const url = apply ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const q = async (sql, args = []) => (await pool.query(sql.replace(/\?/g, (() => { let i = 0; return () => "$" + (++i); })()), args)).rows;
  const { alertReach } = require("../../server/connections/alertReach");
  const totals = { tasks: 0, admins: 0 };
  try {
    const orgs = await q(`SELECT id, name, org_kind FROM orgs WHERE (?::text IS NULL OR id = ?) ORDER BY id`, [one, one]);
    for (const o of orgs) {
      if (SKIP.has(o.id)) continue;
      const tasks = await q(
        `SELECT id, title FROM tasks WHERE org_id = ? AND created_by = 'system:giving-source' AND voided_at IS NULL
            AND COALESCE(done::text, '0') NOT IN ('1','true') AND COALESCE(notes, '') = ''`, [o.id]);
      const [admin] = await q(
        `SELECT id, notify_connection_alerts FROM users WHERE org_id = ? AND role = 'admin' AND deactivated_at IS NULL
          ORDER BY created_at ASC LIMIT 1`, [o.id]);
      const prefOff = prefs && o.org_kind !== "demo" && admin && admin.notify_connection_alerts !== true;   // a demo never mails
      const sentence = tasks.length ? await alertReach(q, o.id) : null;
      if (!(tasks.length && sentence) && !prefOff) continue;
      console.log(`${o.id}`);
      if (tasks.length && sentence) console.log(`  ${tasks.length} open connection task(s) with no note would say: "${sentence}"`);
      if (prefOff) console.log(`  its first admin has "A connection stops working" off${apply ? "" : " (would be turned on)"}.`);
      totals.tasks += sentence ? tasks.length : 0; totals.admins += prefOff ? 1 : 0;
      if (!apply) continue;
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const ids = sentence ? tasks.map(t => t.id) : [];
        if (ids.length) await c.query(`UPDATE tasks SET notes = $2, updated_at = NOW() WHERE org_id = $1 AND id = ANY($3::text[])`, [o.id, sentence, ids]);
        if (prefOff) await c.query(`UPDATE users SET notify_connection_alerts = true WHERE id = $1 AND org_id = $2`, [admin.id, o.id]);
        await c.query(`INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id, changes, summary, record_count, request_method, request_path)
                       VALUES ($1,$2,$3,$4,'system','honest3 connection alerts','org',NULL,$5,$6,$7,'SCRIPT','scripts/ops/honest3-connection-alerts.js')`,
          ["al_" + require("crypto").randomBytes(10).toString("hex"), o.id, ACTOR.id, ACTOR.name,
           JSON.stringify({ taskNotes: ids, alertsOnFor: prefOff ? admin.id : null }),
           `Noted on ${ids.length} connection task(s) who is emailed${prefOff ? ", and turned connection alerts on for the first admin" : ""}`, ids.length + (prefOff ? 1 : 0)]);
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    }
    console.log(`\n${apply ? "Applied" : "Dry run, nothing written"}: ${totals.tasks} task note(s)${prefs ? `, ${totals.admins} admin(s) with connection alerts off` : ""}.${apply ? "" : " Add --apply to change them."}`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
