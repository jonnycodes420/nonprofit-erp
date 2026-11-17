#!/usr/bin/env node
// FLOWS-18 item 2 (W-1116-Fundraising-15X) · SAVED EMAILS WITH A FIELD NOTHING FILLS.
//
// Before FLOWS-18 the campaign starters were written for the older merge engine and opened in the
// block editor, which does not know three of their fields: {{gift_amount}} (Thank-you),
// {{year}} and {{total_giving}} (Year-end). The starters now use the block editor's own fields.
// A draft saved from the old starter keeps what it was saved with:
//   · {{gift_amount}} now reads as {{last_gift_amount}} (shared/emailBlocks.js), so it shows an
//     amount; nothing to repair.
//   · {{year}} and {{total_giving}} still show as typed, and the editor flags them, so a send to
//     donors refuses the email until somebody edits it. Steward does not rewrite her words.
// This lists those emails so the team can be told which to open. It never writes.
//
// READ ONLY, always: per org, how many; with --org, each email by name.
//
//   DATABASE_URL=… node scripts/ops/flows18-starter-tags.js [--org <org id>]
"use strict";

const argv = process.argv.slice(2);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
if (!process.env.DATABASE_URL) { console.error("\nREFUSED: set DATABASE_URL first.\n"); process.exit(2); }

async function main() {
  const { query, pool } = require("../../db");
  const EB = await import("../../shared/emailBlocks.js");
  const known = new Set([...EB.EMAIL_MERGE_FIELDS.map(f => f.key), "first", "org", "gift_amount"]);
  const unknownIn = v => [...new Set([...JSON.stringify(v || "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]).filter(k => !known.has(k)))];
  const where = ORG ? "AND org_id = $1" : "";
  const args = ORG ? [ORG] : [];
  const camps = await query(`SELECT org_id, id, name, status, subject, email_blocks FROM campaigns
                              WHERE email_blocks IS NOT NULL AND COALESCE(status, 'draft') NOT IN ('sent', 'sending') ${where}`, args);
  const tpls = await query(`SELECT org_id, id, name, subject, blocks, draft FROM email_templates WHERE archived_at IS NULL ${where}`, args).catch(() => []);
  const hits = [];
  for (const c of camps) { const u = unknownIn([c.subject, c.email_blocks]); if (u.length) hits.push({ org: c.org_id, kind: "campaign", id: c.id, name: c.name, tags: u }); }
  for (const t of tpls) { const u = unknownIn([t.subject, t.blocks, t.draft]); if (u.length) hits.push({ org: t.org_id, kind: "template", id: t.id, name: t.name, tags: u }); }
  const byOrg = new Map();
  for (const h of hits) byOrg.set(h.org, (byOrg.get(h.org) || 0) + 1);
  console.log(`\nFLOWS-18 · saved emails that name a field Steward can't fill (read only)\n`);
  if (!hits.length) console.log("  none.");
  else if (!ORG) for (const [o, n] of byOrg) console.log(`  ${o}: ${n} ${n === 1 ? "email" : "emails"}  (--org ${o} lists them)`);
  else for (const h of hits) console.log(`  ${h.kind} ${h.id} "${h.name}": ${h.tags.map(k => `{{${k}}}`).join(", ")}`);
  console.log("");
  if (pool && pool.end) await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
