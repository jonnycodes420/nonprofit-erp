// BUILD-50 item 1 — extend existing mid-trial orgs to the public free-through
// date, honoring "Free through December 31, 2026."
//
// RULE (from the brief):
//   • EXTEND to end of day 2026-12-31 (UTC fallback — no per-org timezone column)
//     any org that is CURRENTLY on trial (subscription_status='trialing') whose
//     trial_ends_at is SOONER than that date.
//   • NEVER shorten anyone's trial. Orgs already ending on/after 2026-12-31 are
//     left alone. Orgs with a NULL trial_ends_at are LEFT ALONE (a null end is
//     effectively unlimited — moving it to a finite date would shorten it).
//   • Report how many orgs this touches BEFORE doing it.
//
// Idempotent (a second run finds 0 to extend). Dry-run by DEFAULT — pass --apply
// to write. Connects via DATABASE_URL directly (same as the seed/loadtest scripts).
//
//   Dry run (report only):   DATABASE_URL=… node scripts/extend-trials-free-through-2026.js
//   Apply:                   DATABASE_URL=… node scripts/extend-trials-free-through-2026.js --apply
//
// PROD note: the production DB URL lives on Railway/Supabase, not in this repo.
// Run this with the prod DATABASE_URL to get the real prod count + apply.

const { Pool } = require("pg");
const { FREE_THROUGH_ISO } = require("../trialEnd");

const APPLY = process.argv.includes("--apply");
const url = require("./lib/prodGuard").writerDbUrl(); // remote DB requires --i-know-this-is-prod (BUILD-55)

// Match the app's DB SSL convention (db.js): default to relaxed SSL unless
// DB_SSL=disable (the scratch stack has no SSL).
const ssl = process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: url, ssl });

(async () => {
  const WHERE = `subscription_status = 'trialing'
                 AND trial_ends_at IS NOT NULL
                 AND trial_ends_at < $1`;
  const { rows: preview } = await pool.query(
    `SELECT id, name, trial_ends_at FROM orgs WHERE ${WHERE} ORDER BY trial_ends_at`,
    [FREE_THROUGH_ISO]
  );

  console.log(`Free-through target: ${FREE_THROUGH_ISO}`);
  console.log(`Orgs currently trialing whose trial ends SOONER (would be extended): ${preview.length}`);
  for (const o of preview.slice(0, 50)) {
    console.log(`  ${o.id}  ${String(o.name).slice(0, 40).padEnd(40)}  ${new Date(o.trial_ends_at).toISOString()} → ${FREE_THROUGH_ISO}`);
  }
  if (preview.length > 50) console.log(`  … and ${preview.length - 50} more`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to extend these ${preview.length} org(s).`);
    console.log(`(NULL-trial and already-≥2026-12-31 orgs are deliberately left untouched — never shortened.)`);
    await pool.end();
    return;
  }

  const { rowCount } = await pool.query(
    `UPDATE orgs SET trial_ends_at = $1 WHERE ${WHERE}`,
    [FREE_THROUGH_ISO]
  );
  console.log(`\nAPPLIED — extended ${rowCount} org(s) to ${FREE_THROUGH_ISO}. Idempotent: a re-run will find 0.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
