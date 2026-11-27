#!/usr/bin/env node
// NUMBERS-10 item 4 · OPEN THANK-YOU DRAFTS THAT SAY A DAY'S GIFTS AS ONE GIFT.
//
// W-1127-Finance-01: ONE-MOVE-1 folds one person's gifts on one day into one draft (also_gift_ids)
// and wrote it for the day's total, "Thank you for your gift of $1,025" for a $1,000 gift and a $25
// one. New drafts name each gift ("your gifts of $1,000 and $25", shared/draftNote.js). A draft
// written before that still says the sum. This lists every open draft (not sent, not skipped) that
// covers two or more gifts and whose text says "gift of <the sum>" while no gift is that amount.
//
// It prints org id, draft id, how many gifts, the sum it says and the gifts' amounts. No names, no
// text. The fix for each is hers before she sends it (open the draft, the queue line now names each
// gift); REPAIR-1 may rewrite untouched ones.
//
// READ ONLY: one READ ONLY session, no --apply, it writes nothing.
//
//   DATABASE_URL=… node scripts/ops/numbers10-merged-drafts.js org_x     # one org
//   DATABASE_URL=… node scripts/ops/numbers10-merged-drafts.js           # every org
"use strict";
const { Pool } = require("pg");

const words = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const only = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const pool = new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await pool.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const { rows } = await pool.query(
      `SELECT t.org_id, t.id, t.body,
              (SELECT array_agg(ROUND(g.amount * 100)::bigint ORDER BY g.created_at, g.id) FROM gifts g
                WHERE g.org_id = t.org_id AND (g.id = t.gift_id OR g.id = ANY(t.also_gift_ids))) AS cents
         FROM thank_you_drafts t
        WHERE t.sent_at IS NULL AND t.skipped_at IS NULL AND cardinality(COALESCE(t.also_gift_ids, '{}')) > 0
          AND ($1::text IS NULL OR t.org_id = $1)
        ORDER BY t.org_id, t.created_at`, [only]);
    let listed = 0;
    console.log("org_id\tdraft_id\tgifts\tsays\tgift_amounts");
    for (const r of rows) {
      const each = (r.cents || []).map(Number);
      const sum = each.reduce((n, c) => n + c, 0);
      if (each.includes(sum) || !String(r.body || "").includes(`gift of ${words(sum)}`)) continue;
      listed++;
      console.log(`${r.org_id}\t${r.id}\t${each.length}\t${words(sum)}\t${each.map(words).join(" + ")}`);
    }
    console.log(`\n${listed} open ${listed === 1 ? "draft says" : "drafts say"} a day's gifts as one gift, of ${rows.length} open ${rows.length === 1 ? "draft" : "drafts"} that cover more than one gift.`);
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
