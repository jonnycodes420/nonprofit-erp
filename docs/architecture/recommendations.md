# What to cut, split or merge first (MAP-1)

These follow from [`map.md`](map.md). They are ranked by value over risk. **None of them has been
done.** Line counts are rough. "Test first" names the guard that must exist, and be proven able
to fail, before the change starts. In most cases that is an existing suite, extended.

| # | Change | Lines removed | Cuts | Risk | Test first |
|---:|---|---:|---|---|---|
| 1 | One fiscal-year boundary and one "last gift" | ~400 | duplicate math | med | Truth-check extension (below) |
| 2 | Stop hand-maintaining the battery list and the generated audit files | ~0 (−3 hot spots) | collisions | low | `combine` pass-count gate |
| 3 | HISTORY as one file per build | 0 | collisions | low | none (docs) |
| 4 | Delete the 151 one-time scripts | ~21,400 | lines | low | `script-guards` list |
| 5 | Fix the truth check's own blind spots, then point it at app functions | +~150 | wrong answers | low | itself, planted red |
| 6 | Split `routes/crm.js` by domain | 0 (moves ~30k) | collisions | med | route inventory + tenant matrix |
| 7 | One donor-facing totals function (portal, account, merge fields) | ~250 | duplicate math | med | real-shaped + surfaces agree |
| 8 | One pledge "paid" model and one remaining join | ~500 | duplicate math | high | pledge truth-check legs |
| 9 | Delete dead files, dead exports and unrouted volunteer routes | ~3,000 | lines | low | smoke-walk |
| 10 | Schema out of `db.js` into ordered files; background jobs out of `server.js` | 0 (moves ~18k) | collisions | high | schema-dump equality |

---

### 1. One fiscal-year boundary, one "last gift" (duplicate math, the highest-value item)

**What.** Four functions decide when a fiscal year starts: `orgTime.orgPeriodBounds`,
`finPeriodBounds`, `donorStatus.windowsFor`, and `fyOf` inside `computeRetentionRate`. Six more places
use the calendar year where the screen says "this year". Keep `orgPeriodBounds` and make the other
three call it. **Last gift** is computed in 14 places. The stored date (`MAX` over all rows) counts
refunds and credit rows, while the tags look only at gifts above zero. That stored date then drives
`stage='lapsed'`, at-risk and journeys. Define it once (gifts above zero, credits out) in
`donorSummary.js` and have `statusSql`, the tags, Insights and Why read it.
Known wrong answers this removes:
- The Fundraising "Raised" tile counts future-dated gifts.
- The AI board report uses calendar YTD.
- `/annual-fund` passes a calendar year as a fiscal start year.

**Rough size.** About 400 lines removed. The bigger gain is that all 14 fiscal-year places (§2.2) and
all 14 last-gift places (§2.3) agree by construction.

**Risk.** Medium. Lapsed counts and journeys will move for orgs with refunds or credit rows. That is
a decision for Jonathan, not a regression.

**Test first.** Extend `assertSurfacesAgree` with a fiscal-year leg for an org whose year starts
mid-year with a future-dated gift, and a last-gift leg with a refund as the newest row. Run it on
main and watch it go red. These are fixes, so they don't count against the one-new-test limit.

### 2. Stop hand-maintaining the battery list and the generated audit files (collisions)

**What.** `tests/run-all.sh` was changed by 148 briefs and collided in 50 merges.
`audit/route-inventory.json` was changed by 139 briefs and collided in 39. `audit/suite-timings.json`
was changed by 83. Three changes:
- Make the battery discover suites by glob, with an explicit skip list instead of an explicit include list.
- Build the route inventory in CI and diff it there, instead of committing it.
- Keep suite timings as a CI artifact (or a cache) rather than a tracked file.

**Rough size.** Lines barely move, but three of the top seven collision files go away.

**Risk.** Low. The `combine` gate already fails when a suite's pass count drops.

**Test first.** Plant a suite that the glob would miss, and check that `combine` goes red before you trust it.

### 3. HISTORY as one file per build (collisions)

**What.** `docs/HISTORY.md` is the most-touched file: 161 briefs, 53 merge collisions and 24
messages that name a conflict. Every build writes at the top of one file. Change it to
`docs/history/YYYY-MM-DD-<brief>.md`, the same way `docs/changelog/` already works, plus a
generated index. CLAUDE.md's pointer and the 200-line test don't change.

**Rough size.** Lines removed: 0. **Risk:** low. **Test first:** none; it is docs. The changelog reader
pattern already exists.

### 4. Delete the 151 one-time scripts (lines)

**What.** 151 of the 221 `scripts/` files ran once for a past build: walks, captures, probes,
drills. Together they are 21,436 lines. Delete them; git keeps them. Before deleting, keep any walk
script a current brief still names. `import-walk.js` from FIX-55 may be reused by "every build ends
with a walk". Also remove the five weak "keeps" the audit flagged, including
`create-billing-products.js`, which its own header says `stripe-live-prices.js` replaced.

**Rough size.** About 21,400 lines, about 6% of all code.

**Risk.** Low. The names must also come out of `tests/script-guards.test.js`, which lists every top-level script.

**Test first.** `script-guards` already fails on a mismatch. Take one name out of the list without deleting
the file and watch it go red.

### 5. Fix the truth check's blind spots first (wrong answers)

**What.** `assertSurfacesAgree` sums `gifts.amount` with no credit-type filter, so soft and matching
credits count as money and the lifetime leg disagrees with the app on any org with a credit row. Its
lapsed and came-and-didn't-give legs compare surface with surface: two places that both call
`statusSql`, so the check can hardly fail. `/donors/counts` counts sample people, and the Donors list
leaves out archived people.
- Filter credits out of the truth's money.
- Give lapsed and came-and-didn't-give a database value to compare against.
- Add a households leg; there is none today.

Do this **before** items 1, 7 and 8, so they have a check that can actually fail.

**Rough size.** Adds about 150 lines to the harness. **Risk:** low (tests only). **Test first:** the change
is itself the guard. Plant a credit row and an archived person on the real-shaped org and see red on
main.

### 6. Split `routes/crm.js` by domain (collisions)

**What.** 30,229 lines and 561 routes across about 95 path prefixes. It had the most merge collisions
of any file (84). Move each domain to its own router, as `map.md` §1 lists: events, grants,
outreach (campaigns, journeys, acknowledgments), imports, tasks/threads, reports, major gifts,
memberships, org/settings. What remains is the person record. Do it the FIX-1 way: move verbatim,
change nothing, one domain per PR.

**Rough size.** 0 lines removed (moved). It cuts the single biggest collision point.

**Risk.** Medium. Route order and mount prefixes can shadow each other.

**Test first.** The route inventory (`scripts/build75-route-inventory.js`) must be byte-identical before
and after, the tenant matrix must stay green, and the smoke-walk must stay green. Prove the inventory diff
goes red by moving one route under a different prefix.

### 7. One donor-facing totals function (duplicate math, donor data)

**What.** The donor portal (`routes/give.js:6153`), the account dashboard (`:7767`) and the merge
fields (`routes/templates.js:105`) each compute lifetime, YTD and last gift with their own SQL. Credits
count, imported totals are missing, and a refund can be the "last gift". That is the number a
**donor** sees, so it should be the stored rollup (`donorSummary.js`) or the `donor-lifetime` source.

**Rough size.** About 250 lines removed. **Risk:** medium. A donor's portal total will change for orgs with
credit rows or imported history.

**Test first.** A real-shaped leg that compares the portal's lifetime with the profile's for a donor
with a soft credit and an imported total. Run it on main and see red.

### 8. One pledge "paid" model (duplicate math, money)

**What.** Pledge balance, received and due are computed in 36 places, about 28 of which rewrote
the math. There are two "paid" models (`gifts.pledge_id` vs `installments.paid_gift_id`).
`/campaigns/:id/progress` and the solicitations report have no `GREATEST(…, 0)`.
`OPEN_PLEDGE_REMAINING_JOIN` (`server.js:3752`) is declared as the shared join and used nowhere.
Choose one model, make `pledgeSummary` and the pledge figure sources the only readers, and either use
the join or delete it.

**Rough size.** About 500 lines removed. **Risk:** high. It touches money, and existing pledge rows
may be paid under either model, so this needs a backfill decision from Jonathan.

**Test first.** Extend the pledge legs of the truth check with an over-paid pledge and a pledge paid
through an installment. Check `real-shaped.test.js` too.

### 9. Delete dead files, dead exports and the unrouted routes (lines)

**What.** This covers:
- the 15 files nothing imports (~1,760 lines: `Board.jsx`, `Programs.jsx`, the old `Volunteers.jsx`, `Pricing.jsx`, two favicon generators, `.b73shot.js` …);
- the 153 exports referenced nowhere (about 1,000 lines by estimate);
- the 20 routes nothing calls, chiefly the half-built `/volunteer/me/*` self-service and `/volunteer-hub/settings`.

Merge `routes/volunteer.js` into `routes/volunteerScheduling.js` at the same time: two route files
for one domain. Ask Jonathan about `shared/publicSources.js`, which is a policy file.

**Rough size.** About 3,000 lines. **Risk:** low. **Test first:** the smoke-walk and the tenant matrix, as
they are. After removing routes, re-run the route inventory.

### 10. Schema out of `db.js`, jobs out of `server.js` (collisions)

**What.** `db.js` is 8,600 lines of inline DDL. 140 briefs changed it, with 47 merge collisions.
`server.js` holds about 200 background-job functions: 135 briefs, 49 collisions.
- Move the DDL to ordered files (`schema/NNN-<brief>.sql`), applied in order with the existing `schemaUnchanged` hash.
- Move the boot seed to its own file.
- Move the jobs to `jobs/<area>.js`, leaving `recordGift`, auth and boot in `server.js`.

**Rough size.** 0 lines removed (about 18,000 moved). It cuts two of the top five collision files.

**Risk.** High. This is boot order and schema. A missed `ALTER` breaks prod at boot. It is
behind the deploy gate, but the blast radius is total.

**Test first.** A schema-dump equality check: `pg_dump --schema-only` of a fresh database built by
old and new code must be byte-identical. Plant one dropped `ALTER` and see red. This counts as the
build's one new test, because it guards every table.

---

**Not ranked, but worth knowing.**
- `docs/` is 573 MB on disk, almost all screenshots kept per build. The pack is 231 MB. Code isn't affected, but clone time and agent worktrees pay for it every time.
- `audit/` is 49k lines of old findings and backups; the only live parts are the two generated JSON files from item 2.
- The client's money-relevant pure logic, the `DonorImport.jsx` payload builders and the `Donate.jsx` fee gross-up, is only covered by the smoke-walk. Moving it to `client/src/lib/` would let the real-shaped suite import it directly.
