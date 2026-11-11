#!/usr/bin/env node
// scripts/ops/journey-older-template.js · POLISH-9 (W-1108-Atlas-11X). JONATHAN RUNS IT.
//
// A journey draft made from a template before the template changed (FIX-4 moved
// "New donor, first year" from seven months to twelve) keeps the old steps, so
// it reads "7 touches over 7 months" beside a template that reads 12. New
// copies are fixed in the app (server/outreach/olderTemplate.js); this finds
// the rows that already carry an old copy: journeys made from a preset, never
// turned on (journey_enabled and ever_enabled both false), whose steps differ
// from the preset's.
//
// SAFE BY DEFAULT: a dry run lists org id, journey id, name and the two
// sentences. --apply sets each one's steps to the template's, in one
// transaction per org with one audit row naming the ids and the old steps.
// A journey that has ever been on is never touched, and org_creo never is.
//
//   node scripts/ops/journey-older-template.js                 # dry run
//   node scripts/ops/journey-older-template.js --org=org_x     # one org
//   node scripts/ops/journey-older-template.js --apply         # write
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const crypto = require("crypto");
const { Pool } = require("pg");
const { olderTemplateOf } = require("../../server/outreach/olderTemplate");

const ACTOR = { id: "system:scripts/ops/journey-older-template", name: "Repair: journey drafts from an older template" };

async function main(argv = process.argv) {
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const APPLY = argv.includes("--apply");
  const orgArg = (argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  if (orgArg === "org_creo") throw new Error("org_creo is never touched.");
  const J = await import("../../shared/journeyShape.js");
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, org_id, name, steps, preset_key, journey_enabled, ever_enabled FROM cultivation_templates
        WHERE preset_key IS NOT NULL AND archived_at IS NULL AND journey_enabled = FALSE AND ever_enabled = FALSE
          AND org_id <> 'org_creo' AND ($1::text IS NULL OR org_id = $1::text)
        ORDER BY org_id, id`, [orgArg]);
    const hits = rows.map(r => ({ r, p: olderTemplateOf(r, J.PRESETS) })).filter(x => x.p);
    if (!hits.length) { console.log("No journey draft carries an older template's steps."); return { found: 0, updated: 0 }; }
    for (const { r, p } of hits)
      console.log(`${r.org_id}  ${r.id}  "${r.name}": ${J.touchesSentence(r.steps)}  →  template: ${J.touchesSentence(p.steps)}`);
    if (!APPLY) { console.log(`\n${hits.length} found. Dry run: nothing changed. Run with --apply to give each its template's steps.`); return { found: hits.length, updated: 0 }; }
    const byOrg = new Map();
    for (const h of hits) byOrg.set(h.r.org_id, [...(byOrg.get(h.r.org_id) || []), h]);
    let updated = 0;
    for (const [orgId, list] of byOrg) {
      await client.query("BEGIN");
      try {
        for (const { r, p } of list) {
          const u = await client.query(
            `UPDATE cultivation_templates SET steps = $1::jsonb, updated_at = NOW()
              WHERE id = $2 AND org_id = $3 AND journey_enabled = FALSE AND ever_enabled = FALSE`, [JSON.stringify(p.steps), r.id, orgId]);
          updated += u.rowCount;
        }
        await client.query(
          `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                      before_fields, summary, record_count, request_method, request_path)
           VALUES ($1,$2,$3,$4,'system','gave journey drafts their template''s current steps','journey',$5,$6::jsonb,$7,$8,'SCRIPT',$9)`,
          ["al_" + crypto.randomBytes(8).toString("hex"), orgId, ACTOR.id, ACTOR.name, list.map(x => x.r.id).join(","),
           JSON.stringify(Object.fromEntries(list.map(x => [x.r.id, x.r.steps]))),
           `${list.length} journey draft${list.length === 1 ? "" : "s"} made from an older template now use${list.length === 1 ? "s" : ""} the template's steps.`,
           list.length, "scripts/ops/journey-older-template.js"]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
    console.log(`\n${updated} updated.`);
    return { found: hits.length, updated };
  } finally { client.release(); await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { main };
