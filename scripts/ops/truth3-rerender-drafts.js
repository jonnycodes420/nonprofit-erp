#!/usr/bin/env node
// TRUTH-3 item 1 · EVERY UNSENT DRAFT, STORED WITH FIGURE KEYS.
//
// Since TRUTH-3 a draft stores its words with figure keys ({{total_giving}},
// {{giving_this_year}}, …) and every open, preview and send fills them from
// shared/numbers (shared/numbers/draftRender.js). A draft written before it
// holds rendered numbers, some of them stale ("$12,500" for a person at
// $21,000). The screens already read those true (render() templatizes on the
// way out); this saves the template, so the stored words hold no number.
//
// Reads every unsent draft in every org: milestone_drafts (pending_review),
// agent_drafts (pending) and note_reminders (pending). A draft whose stored
// words change when templatized is counted; nothing else is touched.
// Dry run by default: prints org ids and counts only, never a name or words.
// --apply saves the template, one audit row (fin_audit_log) per org holding
// every draft's words before, and --undo=<audit id> puts them back.
// Skips org_creo (the boot-seed fixture) and org_b72demo (only
// scripts/ci/seed-demo.js writes the demo). A second --apply changes nothing.
//
// Usage:
//   node scripts/ops/truth3-rerender-drafts.js                  # dry run, every org
//   node scripts/ops/truth3-rerender-drafts.js --org=<org_id>   # one org
//   node scripts/ops/truth3-rerender-drafts.js --apply [--i-know-this-is-prod]
//   node scripts/ops/truth3-rerender-drafts.js --undo=<audit id> [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const { templatize } = require("../../shared/numbers/draftRender");

const ACTOR = { id: "system:scripts/ops/truth3-rerender-drafts", name: "Fix: unsent drafts stored with figure keys", kind: "system" };
const SKIP_ORGS = ["org_creo", "org_b72demo"];
const SCRIPT = "scripts/ops/truth3-rerender-drafts.js";

// table, the unsent condition, and the word columns.
const TABLES = [
  { table: "milestone_drafts", unsent: "status = 'pending_review'", cols: ["subject", "body"] },
  { table: "agent_drafts", unsent: "status = 'pending'", cols: ["subject", "body"] },
  { table: "note_reminders", unsent: "status = 'pending'", cols: ["talking_points"] },
];

const asText = v => (v == null ? v : typeof v === "string" ? v : JSON.stringify(v));
function templated(t, row) {
  const out = {};
  for (const c of t.cols) {
    if (c === "talking_points") {
      const raw = row[c];
      const pts = typeof raw === "string" ? JSON.parse(raw) : raw;
      out[c] = Array.isArray(pts) ? JSON.stringify(pts.map(p => (typeof p === "string" ? templatize(p) : p))) : asText(raw);
    } else out[c] = templatize(row[c]);
  }
  return out;
}
const changed = (t, row, next) => t.cols.some(c => asText(row[c]) !== next[c]);

// Per org: { orgId, byTable: { table: n }, count, changes: [{ table, id, before, after }] }.
async function scan(client, orgId = null) {
  const orgs = new Map();
  for (const t of TABLES) {
    const { rows } = await client.query(
      `SELECT id, org_id, ${t.cols.join(", ")} FROM ${t.table}
        WHERE ${t.unsent} AND NOT (org_id = ANY($1::text[])) AND ($2::text IS NULL OR org_id = $2) ORDER BY org_id, id`,
      [SKIP_ORGS, orgId]);
    for (const r of rows) {
      const next = templated(t, r);
      if (!changed(t, r, next)) continue;
      if (!orgs.has(r.org_id)) orgs.set(r.org_id, { orgId: r.org_id, byTable: {}, count: 0, changes: [] });
      const o = orgs.get(r.org_id);
      o.byTable[t.table] = (o.byTable[t.table] || 0) + 1; o.count++;
      o.changes.push({ table: t.table, id: r.id, before: Object.fromEntries(t.cols.map(c => [c, asText(r[c])])), after: next });
    }
  }
  return [...orgs.values()];
}

async function audit(client, orgId, action, ids, before, after, summary) {
  const id = "al_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await client.query(
    `INSERT INTO fin_audit_log
       (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
        changes, before_fields, after_fields, summary, record_count, request_method, request_path)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',NULL,$7,$8,$9,$10,$11,'SCRIPT',$12)`,
    [id, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, JSON.stringify({ ids }),
     JSON.stringify(before), JSON.stringify(after), summary, ids.length, SCRIPT]);
  return id;
}

async function run({ client, apply = false, orgId = null, log = console.log }) {
  const list = await scan(client, orgId);
  const out = { orgs: list.map(o => ({ orgId: o.orgId, count: o.count, byTable: o.byTable })), changed: 0, audits: [] };
  if (!list.length) log("Every unsent draft already stores figure keys. Nothing to change.");
  for (const o of list) {
    log(`  ${o.orgId}: ${o.count} draft(s) ${apply ? "re-rendered" : "would change"} (${Object.entries(o.byTable).map(([t, n]) => `${t} ${n}`).join(", ")})`);
    if (!apply) continue;
    await client.query("BEGIN");
    try {
      let n = 0;
      for (const ch of o.changes) {
        const t = TABLES.find(x => x.table === ch.table);
        const cols = Object.keys(ch.after);
        const r = await client.query(
          `UPDATE ${t.table} SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")} WHERE org_id = $1 AND id = $2 AND ${t.unsent}`,
          [o.orgId, ch.id, ...cols.map(c => ch.after[c])]);
        n += r.rowCount;
      }
      const aid = await audit(client, o.orgId, "updated", o.changes.map(c => c.id),
        { drafts: o.changes.map(c => ({ table: c.table, id: c.id, ...c.before })) },
        { drafts: o.changes.map(c => ({ table: c.table, id: c.id, ...c.after })) },
        `Stored ${n} unsent draft(s) with figure keys, so each open, preview and send states the person's figures today (TRUTH-3). Undo: node ${SCRIPT} --undo=<this audit id>.`);
      await client.query("COMMIT");
      log(`    saved ${n}, audit ${aid}`);
      out.changed += n; out.audits.push(aid);
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  }
  const total = list.reduce((s, o) => s + o.count, 0);
  log(`\n${list.length} org(s), ${total} draft(s) ${apply ? "re-rendered" : "would change"}.`);
  return out;
}

// Puts back the words one --apply audit row replaced (only drafts still unsent).
async function undo({ client, auditId, log = console.log }) {
  const { rows: [a] } = await client.query(
    `SELECT org_id, before_fields FROM fin_audit_log WHERE id = $1 AND request_path = $2 AND action = 'updated'`, [auditId, SCRIPT]);
  if (!a) throw new Error(`No ${SCRIPT} change with audit id ${auditId}`);
  const drafts = (a.before_fields && a.before_fields.drafts) || [];
  await client.query("BEGIN");
  try {
    const ids = [];
    for (const d of drafts) {
      const t = TABLES.find(x => x.table === d.table);
      if (!t) continue;
      const r = await client.query(
        `UPDATE ${t.table} SET ${t.cols.map((c, i) => `${c} = $${i + 3}`).join(", ")} WHERE org_id = $1 AND id = $2 AND ${t.unsent}`,
        [a.org_id, d.id, ...t.cols.map(c => d[c])]);
      if (r.rowCount) ids.push(d.id);
    }
    await audit(client, a.org_id, "restored", ids, {}, { from_audit: auditId },
      `Put back the words of ${ids.length} draft(s) changed by ${SCRIPT} (audit ${auditId}).`);
    await client.query("COMMIT");
    log(`${a.org_id}: put back ${ids.length} of ${drafts.length} draft(s).`);
    return { restored: ids.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const APPLY = process.argv.includes("--apply");
  const undoId = (process.argv.find(a => a.startsWith("--undo=")) || "").slice(7) || null;
  const writes = APPLY || !!undoId;
  const DB_URL = writes ? writerDbUrl() : (process.env.DATABASE_URL || writerDbUrl());
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  let code = 0;
  try {
    if (undoId) { console.log("MODE: UNDO\n"); await undo({ client, auditId: undoId }); }
    else {
      console.log(APPLY ? "MODE: APPLY (saves each unsent draft with figure keys; one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to save)\n");
      await run({ client, apply: APPLY, orgId: orgArg });
    }
  } catch (e) { console.error(e.message); code = 1; }
  finally { client.release(); await pool.end(); }
  process.exit(code);
}

if (require.main === module) main();
module.exports = { run, undo, scan, SKIP_ORGS };
