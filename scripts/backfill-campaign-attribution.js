#!/usr/bin/env node
// BUILD-32 Part 1 (item 5) — backfill campaign_id for historical gifts.
//
// Before BUILD-32, manual/imported gifts could only carry a free-text `campaign`
// string (the "Designation" habit), never a structured `campaign_id`. The
// fundraising read side already matches `campaign_id OR campaign = name`, so a
// gift whose free-text campaign EXACTLY equals a campaign's name already rolls
// up — but the reference is fragile (a campaign rename breaks it) and the gift
// isn't formally attributed. This backfill promotes those exact-name matches to
// a real `campaign_id`, so attribution is robust going forward.
//
// SAFE BY DEFAULT — dry-run unless --apply is passed. It ONLY touches gifts with
// `campaign_id IS NULL` (idempotent: a second run matches 0), and ONLY when the
// gift's free-text campaign matches EXACTLY ONE campaign name in the same org
// (case-insensitive, trimmed). AMBIGUOUS matches (a name shared by >1 campaign)
// are reported and SKIPPED — never guessed. Before applying it writes the full
// matched set to a timestamped JSON in docs/ so the change is recoverable
// (revert = set campaign_id NULL for those gift ids).
//
// Usage:
//   node scripts/backfill-campaign-attribution.js                 # dry run, all orgs
//   node scripts/backfill-campaign-attribution.js --apply         # actually write
//   node scripts/backfill-campaign-attribution.js --org=org_creo  # one org
//   DATABASE_URL=… node scripts/backfill-campaign-attribution.js --apply
//
// Note: only EXACT (normalized) name equality is attributed here — the fuzzy
// "Did you mean…?" matcher (client/src/lib/campaignMatch.js) is a live, human-
// confirmed UI affordance, deliberately NOT used for silent bulk backfill.

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
const DB_URL = require("./lib/prodGuard").writerDbUrl(); // remote DB requires --i-know-this-is-prod (BUILD-55)

const norm = s => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
  console.log(APPLY ? "MODE: APPLY (will write campaign_id)\n" : "MODE: DRY RUN (no writes)\n");

  const orgFilter = orgArg ? "AND org_id = $1" : "";
  const orgParams = orgArg ? [orgArg] : [];

  // Every candidate gift + the campaign-name lookup, per org.
  const gifts = (await pool.query(
    `SELECT id, org_id, campaign FROM gifts
      WHERE campaign_id IS NULL AND campaign IS NOT NULL AND btrim(campaign) <> '' ${orgFilter}`,
    orgParams
  )).rows;
  const campaigns = (await pool.query(
    `SELECT id, org_id, name FROM campaigns WHERE name IS NOT NULL AND btrim(name) <> '' ${orgFilter}`,
    orgParams
  )).rows;

  // org → normalized name → [campaignId, ...]  (a list, so we can detect ambiguity)
  const byOrg = {};
  for (const c of campaigns) {
    (byOrg[c.org_id] = byOrg[c.org_id] || {});
    const key = norm(c.name);
    (byOrg[c.org_id][key] = byOrg[c.org_id][key] || []).push(c.id);
  }

  const toAttribute = [];   // { giftId, orgId, campaignId, campaign }
  const ambiguous = [];     // { giftId, orgId, campaign, campaignIds }
  let unmatched = 0;
  for (const g of gifts) {
    const ids = (byOrg[g.org_id] || {})[norm(g.campaign)];
    if (!ids) { unmatched++; continue; }
    if (ids.length > 1) { ambiguous.push({ giftId: g.id, orgId: g.org_id, campaign: g.campaign, campaignIds: ids }); continue; }
    toAttribute.push({ giftId: g.id, orgId: g.org_id, campaignId: ids[0], campaign: g.campaign });
  }

  console.log(`Candidate gifts (unattributed, non-empty campaign text): ${gifts.length}`);
  console.log(`  → exact-name matches to attribute: ${toAttribute.length}`);
  console.log(`  → ambiguous (name shared by >1 campaign) SKIPPED: ${ambiguous.length}`);
  console.log(`  → no matching campaign name (left as free text): ${unmatched}\n`);

  const byCamp = {};
  for (const t of toAttribute) byCamp[t.campaign] = (byCamp[t.campaign] || 0) + 1;
  Object.entries(byCamp).sort((a, b) => b[1] - a[1]).forEach(([name, n]) => console.log(`   ${String(n).padStart(5)}  "${name}"`));
  if (ambiguous.length) {
    console.log("\nAmbiguous (skipped — resolve by renaming the duplicate campaigns, then re-run):");
    ambiguous.slice(0, 20).forEach(a => console.log(`   gift ${a.giftId} · "${a.campaign}" → ${a.campaignIds.join(", ")}`));
  }

  if (!toAttribute.length) { console.log("\nNothing to attribute. Done."); await pool.end(); return; }

  // Recoverable export before any write.
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `backfill-campaign-attribution-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, toAttribute, ambiguous }, null, 2));
  console.log(`\nWrote recoverable record: ${path.relative(process.cwd(), outFile)}`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to write these campaign_id values."); await pool.end(); return; }

  // Apply. Re-guard `campaign_id IS NULL` in the UPDATE so a concurrent run or a
  // gift attributed since the SELECT is never clobbered (idempotent + racy-safe).
  let written = 0;
  for (const t of toAttribute) {
    const r = await pool.query(
      `UPDATE gifts SET campaign_id=$1 WHERE id=$2 AND org_id=$3 AND campaign_id IS NULL`,
      [t.campaignId, t.giftId, t.orgId]
    );
    written += r.rowCount;
  }
  console.log(`\nAPPLIED: set campaign_id on ${written} gift(s). Re-run to confirm 0 remain (idempotent).`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
