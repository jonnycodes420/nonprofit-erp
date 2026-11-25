#!/usr/bin/env node
// ATLAS-10 item 5 — drafts waiting for review that claim something Steward can't show.
//
// A thank-you may say "I recorded a short video", "when I called" or "my visit" only when the
// record has it: a ready video thank-you for that person, or a logged call, meeting or visit
// (shared/suggestionGuard.js guardDraft, the check every new draft passes). Drafts written before
// that check, or before a recording was removed, may still carry such a line. This LISTS them.
// It never edits a draft: she reads each one and fills or cuts the line herself.
//
// READ ONLY. Usage:
//   DATABASE_URL=… node scripts/ops/atlas10-draft-claims.js [--org=org_x]
"use strict";

const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;

async function main() {
  const { query } = require("../../db");
  const { draftRecord, checkDraft } = require("../../draftCheck");
  const rows = await query(
    `SELECT id, org_id, donor_id, subject, body, source, created_at FROM milestone_drafts
      WHERE status = 'pending_review' ${orgArg ? "AND org_id = ?" : ""} ORDER BY org_id, created_at`, orgArg ? [orgArg] : []);
  let n = 0;
  for (const d of rows) {
    const rec = await draftRecord(d.org_id, d.donor_id);
    const r = await checkDraft(`${d.subject || ""}\n${d.body || ""}`, rec);
    // A claim she made (a video, a call, a visit), never a link question: a survey or page link is Steward's own.
    const claims = (r.reasons || []).filter(x => /video|meeting or a conversation/.test(x));
    if (!claims.length) continue;
    n++;
    console.log(`  ${d.org_id}  ${d.id}  (${d.source || "draft"}, ${String(d.created_at).slice(0, 10)}): ${claims.join("; ")}`);
  }
  console.log(`\n${n} draft(s) waiting for review claim something the record can't show (of ${rows.length} waiting).`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
