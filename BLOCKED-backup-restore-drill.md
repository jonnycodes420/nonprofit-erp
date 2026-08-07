# BLOCKED — backup restore drill (BUILD-37 §E6)

## Why blocked

§E6 requires restoring a **real production backup** into a scratch DB, running the reporting golden-fixture suite against it, and recording the measured RTO/RPO. This cannot be done in this environment, for a more fundamental reason than missing credentials:

**There is no production backup to restore.** CLAUDE.md states plainly, in the Landing honesty gates: *"Note Supabase backups still don't exist (don't claim them)."* An untested backup is not a backup — and a nonexistent one is worse.

So the drill can't run, and this is itself the finding: **the product has no backup/restore story.** For a system about to hold real donor giving records, that is a serious operational gap (arguably P1 for the business, though outside the exploit-severity scale this audit uses).

## What's needed to proceed

1. **Enable backups.** Supabase paid tiers offer daily backups + PITR (point-in-time recovery). Turn one on and record the retention window (that's the RPO ceiling).
2. Once backups exist, run the drill:
   - Restore the latest backup into a scratch Postgres.
   - Point a server at it and run the reporting golden-fixture suite (`tests/report-truth.test.js` is the natural fixture — 84 hand-computed assertions).
   - Time the whole restore-to-green wall clock → that's the measured **RTO**.
   - Record backup frequency → that's the **RPO**.
   - Write the numbers into `audit/restore-drill.md`.

## Recommendation

Do not onboard a paying org holding real donor data until (a) backups are enabled and (b) one restore has been drilled end-to-end. The landing page already, correctly, does not claim backups exist — keep it that way until the drill passes.
