## NUMBERS-6 · Stored totals that can't go stale (2026-11-15)

Prod's nightly check said 1,252 of 1,277 problems were `donor-stored`, flat since Nov 10. Every write that
touches a gift or a person's totals was driven over HTTP on a fixture with `checkOrg` after each
(`tests/numbers6-stored.test.js`, 31 paths). Gift form, edit (amount, date, fund, split), delete, partial
refund and its undo, merge and undo, erase, the donors file, the combined file and gift-history file and
their undos, deposits and undo, every Stripe branch and the recurring charge were already clean: they all
ran donorSummary.js's one statement. Four leaks were not, and the check itself was behind the app twice.
Sample data inserted people with a stated total and count (12 gifts) over one to three gift rows and never
recomputed: 58 wrong per load. Every boot ran `keepEarlierTotals` on every org but org_creo: its second
statement rewrote first_gift_date counting credit rows, gifts refunded in full and scheduled gifts, and its
first froze any stored total above the gifts into a permanent imported total (a row change at every
deploy). Emptying the trash (and the 30-day clear-out) deleted a person's gifts and kept their ledger
stamps, pointing at nothing: CREO's "row pointing at a removed gift". A scheduled gift's day came and
nothing recomputed its person. The check counted a gift refunded in full (FLOWS-9) and a scheduled gift
(TRUTH-6) where the app no longer does. After: `shared/numbers/donorTotals.js` is the one writer
(recomputeStoredTotals, recomputeOrgStoredTotals, storedTotalsDiff); `scripts/ci/stored-totals-guard.js`
names any other SQL writing the five columns; each CI shard runs `scripts/ci/after-battery-numbers.js`
on the orgs its suites made; `scripts/ops/numbers6-recompute.js` repairs one org; /ops shows the nightly
check by rule with test orgs below real ones and same-name orgs side by side.
