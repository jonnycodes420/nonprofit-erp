#!/usr/bin/env node
// scripts/ops/flows9-old-rows.js · FLOWS-9. DRY RUN ONLY: it reads and writes nothing.
//
// Two kinds of row that FLOWS-9's fixes stop making but do not mend:
//
//  1. W-1112-Fundraising-19 · drafts waiting in Drafts to review that claim a
//     video that is not there: a /v/<token> link to no playable video of that
//     org (no row, a row whose recording is gone, or a cut token), or words
//     about a video for a person with no playable video thank-you on file.
//     FLOWS-9's link check now marks each one in brass and keeps it out of
//     "Send all reviewed"; the row itself still says what it says. The fix is a
//     person's: edit or dismiss the draft (or REPAIR-1 dismisses it).
//  2. W-1113-Fundraising-01 · gifts whose "refunded in full" mark disagrees with
//     their refund rows (marked but not netted to $0, or netted to $0 or less and
//     not marked): a refund row deleted or an amount edited after the refund.
//     Every count reads the mark (shared/numbers/giftCount.js). REPAIR-1 sets
//     `refunded_in_full = (net <= 0)` on each, with an audit row.
//
//   DATABASE_URL=… node scripts/ops/flows9-old-rows.js
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js); it only reads.
"use strict";
const { Pool } = require("pg");

const VIDEO_WORDS = "(video|videos|recorded a|filmed)";

(async () => {
  const pool = new Pool({ connectionString: require("../lib/prodGuard").writerDbUrl() });
  try {
    const drafts = (await pool.query(
      `WITH pending AS (
         SELECT md.id, md.org_id, md.donor_id, md.created_at, md.subject, md.body,
                (regexp_match(md.body, '/v/([A-Za-z0-9_-]*)'))[1] AS token
           FROM milestone_drafts md WHERE md.status = 'pending_review')
       SELECT p.org_id, p.id, p.donor_id, d.name AS donor_name, LEFT(p.created_at::text, 10) AS made, p.token,
              CASE WHEN p.token IS NOT NULL AND length(p.token) < 16 THEN 'the link is cut short'
                   WHEN p.token IS NOT NULL AND NOT EXISTS (SELECT 1 FROM video_thanks v JOIN portal_assets pa ON pa.id = v.asset_id AND pa.deleted_at IS NULL
                         WHERE v.org_id = p.org_id AND v.token = p.token) THEN 'the link names no playable video of this org'
                   ELSE 'it speaks of a video and none is on file for them' END AS why
         FROM pending p LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
        WHERE (p.token IS NOT NULL AND (length(p.token) < 16 OR NOT EXISTS (SELECT 1 FROM video_thanks v JOIN portal_assets pa ON pa.id = v.asset_id AND pa.deleted_at IS NULL
                 WHERE v.org_id = p.org_id AND v.token = p.token)))
           OR ((p.subject || ' ' || p.body) ~* '\\m${VIDEO_WORDS}\\M' AND NOT EXISTS (SELECT 1 FROM video_thanks v JOIN portal_assets pa ON pa.id = v.asset_id AND pa.deleted_at IS NULL
                 WHERE v.org_id = p.org_id AND v.donor_id = p.donor_id))
        ORDER BY p.org_id, p.created_at`)).rows;
    console.log(`1. Drafts to review that claim a video that is not there: ${drafts.length}`);
    for (const r of drafts) console.log(`   ${r.org_id} · draft ${r.id} · to ${r.donor_name || r.donor_id} · made ${r.made} · ${r.why}`);

    const gifts = (await pool.query(
      `SELECT g.org_id, g.id, g.donor_id, g.amount::text AS amount, COALESCE(g.refunded_in_full, false) AS marked,
              (g.amount + COALESCE((SELECT SUM(rf.amount) FROM gifts rf WHERE rf.org_id = g.org_id AND rf.refund_of = g.id), 0))::text AS net
         FROM gifts g
        WHERE g.amount > 0 AND (g.refunded_in_full IS TRUE OR EXISTS (SELECT 1 FROM gifts rf WHERE rf.org_id = g.org_id AND rf.refund_of = g.id))
          AND (g.refunded_in_full IS TRUE) <> ((g.amount + COALESCE((SELECT SUM(rf.amount) FROM gifts rf WHERE rf.org_id = g.org_id AND rf.refund_of = g.id), 0)) <= 0)
        ORDER BY g.org_id, g.id`)).rows;
    console.log(`\n2. Gifts whose "refunded in full" mark disagrees with their refunds: ${gifts.length}`);
    for (const r of gifts) console.log(`   ${r.org_id} · gift ${r.id} · amount ${r.amount} · net ${r.net} · marked ${r.marked} · would set ${Number(r.net) <= 0}`);
    console.log("\nDry run: nothing written. Hand this to REPAIR-1.");
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
