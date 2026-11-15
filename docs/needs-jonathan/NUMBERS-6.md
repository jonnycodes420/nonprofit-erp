# NUMBERS-6 · what waits on Jonathan

Order matters: **Ship this build to prod first.** Before it, every deploy re-ran `keepEarlierTotals` on every org and froze any stale stored total into a permanent "imported total"; recomputing before the Ship would be undone by the next boot.

1. **Recompute the real orgs, one at a time.** Dry run first (counts only, by field, plus rows pointing at a removed gift), then apply. Run from a checkout of main with prod's `DATABASE_URL`:
   - CKRH: `node scripts/ops/numbers6-recompute.js --org org_64cbb5ef` then `node scripts/ops/numbers6-recompute.js --org org_64cbb5ef --apply --i-know-this-is-prod`
   - Justin's Place: `node scripts/ops/numbers6-recompute.js --org org_a69dbc4f` then `node scripts/ops/numbers6-recompute.js --org org_a69dbc4f --apply --i-know-this-is-prod`
   - CREO Arts (Demo): its id is on /ops → Machine → "The nightly number check" (the org list). `node scripts/ops/numbers6-recompute.js --org <its id>` then `… --org <its id> --apply --i-know-this-is-prod --remove-orphan-stamps` (it has the one ledger line pointing at a removed gift; the flag removes that line, as deleting the gift would have). Never org_creo: the script refuses it.
   - Apply prints the nightly check's counts before and after. Stored totals and the removed-gift row should read 0 after. First/Largest/Last and the lapsed-tag and segment counts are not stored totals, so they may stay until FLOWS-11's refund rule ships.
2. **Mark the test orgs.** /ops → Machine → "The nightly number check" → "Mark as test" on "atkinson", "Test1" and the rest. One flag; no data changes. The digest line then reads "real orgs: N problems in M orgs; test orgs: …".
3. **Which CKRH and which Justin's Place is real.** The same card's "Orgs that share a name" lists each with users, last sign-in, people, gifts and the day it was made. Merging or deleting an org is yours to decide; nothing in Steward does it.
