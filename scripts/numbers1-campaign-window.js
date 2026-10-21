#!/usr/bin/env node
// NUMBERS-1 Part 6 · GIFTS CREDITED TO A CAMPAIGN BEFORE IT STARTED (OR AFTER IT ENDED).
//
// A gift counts toward a campaign only inside the campaign's own start and end
// (campaignMatch.js). Since NUMBERS-1 no total counts a gift dated outside, and
// no write can put one there, but gifts credited that way before the fix still
// carry the campaign (Margaret Chen's $25,000 on GivingTuesday 2026, 21 Oct).
//
// DRY RUN BY DEFAULT: it lists each one, per org, as gift id, date, amount and
// campaign with its dates. --apply moves each to no campaign (campaign_id and
// the legacy name both cleared), inside ONE transaction, and leaves one audit
// row per gift (actor system:scripts/numbers1-campaign-window) with the
// campaign it had, so a person can put one back by hand. Safe to run twice:
// a second run finds nothing, because the first one cleared what it listed.
//
// Usage:
//   DATABASE_URL=… node scripts/numbers1-campaign-window.js             # dry run, every org
//   DATABASE_URL=… node scripts/numbers1-campaign-window.js --apply     # write
//   --org=org_x narrows it to one organisation.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/numbers1-campaign-window", name: "Fix: gift outside its campaign's dates", kind: "system" };

// The gifts that carry a campaign they cannot count toward: attributed by id,
// or by the legacy name when there is no id, and dated outside the window.
const OUTSIDE_SQL = `
  SELECT g.org_id, g.id AS gift_id, g.date, g.amount::text AS amount, c.id AS campaign_id, c.name AS campaign,
         TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date
    FROM gifts g JOIN campaigns c ON c.org_id = g.org_id
         AND (g.campaign_id = c.id OR (g.campaign_id IS NULL AND g.campaign = c.name))
   WHERE ((c.start_date IS NOT NULL AND LEFT(g.date, 10)::date < c.start_date)
       OR (c.end_date IS NOT NULL AND LEFT(g.date, 10)::date > c.end_date))
     AND ($1::text IS NULL OR g.org_id = $1)
   ORDER BY g.org_id, c.name, g.date, g.id`;

async function main() {
  const { writerDbUrl } = require("./lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = process.argv.includes("--apply");
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log(APPLY ? "MODE: APPLY (one transaction)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    if (APPLY) await client.query("BEGIN");
    const { rows } = await client.query(OUTSIDE_SQL, [orgArg]);
    let org = null;
    for (const r of rows) {
      if (r.org_id !== org) { org = r.org_id; console.log(`${org}: ${rows.filter(x => x.org_id === org).length} gift(s)`); }
      console.log(`  ${r.gift_id}  ${String(r.date).slice(0, 10)}  $${r.amount}  on ${r.campaign} (${r.start_date || "no start"} to ${r.end_date || "no end"})`);
      if (!APPLY) continue;
      await client.query(`UPDATE gifts SET campaign_id = NULL, campaign = NULL WHERE id = $1 AND org_id = $2`, [r.gift_id, r.org_id]);
      await client.query(
        `INSERT INTO fin_audit_log
           (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
            changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'move gift to no campaign','gift',$6,$7,$8,$9,$10,1,'SCRIPT','scripts/numbers1-campaign-window.js')`,
        ["al_" + crypto.randomUUID().slice(0, 12), r.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, r.gift_id,
         JSON.stringify({ campaign_id: { from: r.campaign_id, to: null } }),
         JSON.stringify({ campaign_id: r.campaign_id, campaign: r.campaign }), JSON.stringify({ campaign_id: null, campaign: null }),
         `Moved to no campaign: dated ${String(r.date).slice(0, 10)}, outside ${r.campaign} (${r.start_date || "no start"} to ${r.end_date || "no end"})`]);
    }
    if (APPLY) await client.query("COMMIT");
    console.log(`\n${rows.length} gift(s) ${APPLY ? "moved to no campaign" : "would move to no campaign"}.`);
  } catch (e) {
    if (APPLY) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { OUTSIDE_SQL };
