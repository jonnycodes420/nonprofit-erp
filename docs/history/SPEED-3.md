# SPEED-3 · Atlas answers fast and says what it's doing, and the load test goes green

Muse's walks: an Atlas draft took about 20 s with only a spinner. The nightly load test
(LOAD-1, ten orgs, twenty people, a 2-CPU-class runner) failed on /reports/retention
(2,056 ms p95), /donors/counts (1,582 ms) and /donors (1,581 ms), and also on the profile's
bundle and LYBUNT. SPEED-2 could not reproduce the slow Settings pages or the giving page
editor, and /ops did not time either.

**Atlas.** Measured with a stand-in model (700 ms to the first token, 15 ms a token) and
prod's 17 ms per statement: Steward's own time is 0.2–0.6 s a request; the rest is the
model. The draft call now streams (`server/atlas/draftStream.js`, the same call, prompt,
tool and budget), so its first words show on the status line as they are written (2.5 s
with the stand-in); the step line says what it is doing, ending in "…"
(`server/atlas/progress.js`); the reads before the model, the people a name can match,
each draft's reads and each person's unrecorded-amount check go at once instead of in
turn. A list answer still waits on Ask's own plan (a second model call), so its first
words come at about 3.9 s; its step line ("Looking up: …") shows under 3 s. Sending a
plain question straight to Ask would change behaviour, so it was left.

**Why the three routes were slow.** Not a missing index. On a laptop each was 130–370 ms
alone; under the load test the runner's CPUs were the queue, and three reads spent
far more of them than their answers needed:
- **/donors.** The list's row carries columns worked out per person (scores, closeness,
  pledge hold, Re-engage). As one flat `SELECT … ORDER BY … LIMIT 50` the planner planned
  them for every person in the org, and closeness's "a gift in the last twelve months"
  became a hashed, parallel scan of every org's gifts on each read. Now the page's ids are
  chosen first and the columns are worked out for those 50 rows only, in the same
  statement (`server/donors/listPage.js`); an order that reads one of those columns keeps
  the flat form. 106 → 17 ms for the page on 25,000 people; same rows, same values.
- **/reports/retention.** It ran the INSIGHTS-2 figures pass (one statement over the gifts
  for all three years) and then, per year, its own statement with three more passes, only
  for two columns. Those two (retained dollars, first-year retained) now come from the
  figures pass too, through their sources (`retention-window-kept` with `measure: sum` and
  `firstYear`), and the pass tests each gift's money and gift rules once instead of nine
  times. One pass on one core instead of four on three. First-year retained now uses the
  same first gift date as first-year donors and the rate beside it (FIRST_DATE, which counts
  an imported first gift); the old per-year statement read only gifts on file, so the
  two columns could disagree for an imported history.
- **/donors/counts.** A whole-org pass on every Donors and Home visit. It now sits in the
  per-org store (orgSummary.js, SCALE-2): kept until any write to the org's rows (a
  statement trigger), for the org's day, and compared byte for byte with a fresh pass
  nightly.
- **The profile's status read** (the bundle the load test also missed on): closeness asked
  ten figures in turn, three of which each re-read the person's touches. They are asked at
  once and put in the same order. 46 → 24 ms median.

**Page timing.** The page-ready mark now names the Settings section (`part`, a fixed list)
and treats a move between sections as a move between pages; the giving page editor
(/portal-editor) is a page of its own, timed against the app's root since it draws outside
the content column. /ops shows Settings section by section under Settings.

**Not done.** LYBUNT (~300 ms on 25,000 people) is unchanged. Retention and LYBUNT were not
put in the store: the store's refresher recomputes after every write, and the load mix
writes more often than it reads reports.

**LYBUNT, for the next build.** Its "gave in the prior year" test is a semi-join that reads
the whole org's prior-year gifts, and Postgres builds that hash once in each of three
parallel workers (about 210 ms each on 25,000 people). It passed the nightly at 959 ms p95
once the other reads stopped crowding the CPU, against main's 2,048 ms the same hour:
thin margin. The fix is a set-wise form of shared/numbers/bunt.js (one pass over the
two years' gifts per person), proven equal to the current rule.

**On CI's own runner** (the nightly workflow, dispatched the same hour): main failed
(LYBUNT 2,048, /donors 1,798, retention 1,772, counts 1,764, bundle 1,637, profile open
2,085 ms p95); this branch passed every bar (retention 685, counts 389, /donors 468,
bundle 432, LYBUNT 959, profile open 635).
