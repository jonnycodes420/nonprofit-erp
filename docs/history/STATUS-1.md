# STATUS-1 · One person, one answer to "are they on time?" (2026-11-03)

Seen on prod (demo org, 3 Nov). A once-a-year donor six weeks past their expected gift read "On track: gives
about once a year, latest gift on time" under a Lapsing tag. A twice-a-year donor read "Nothing for 9 months"
beside Current. Three files each worked out when a person's next gift was due: lapse's `usualTimeAhead`
(yearly and year-end rhythms only), drift's cadence (whose "ok" meant "not yet 1.25 times the gap"), and the
nightly `donor_scores.pattern` the lists read. The profile showed two of them side by side.

- Now one function, `shared/numbers/rhythm.js`. "On track" is "the expected date hasn't passed". It is no
  longer "not far enough past to flag": Drift keeps its own threshold for *drifting*.
- FIX-33 ("gave their usual year") now moves the expected date to when that year runs out. It applies only to
  *more* than the usual count: at exactly the usual count, every steady giver would be extended.
- The brief expected case 2 to come out Lapsing. It is 8 months 26 days, under the 9-month line. Jonathan
  decided the sentence was wrong, not the tag: spans count whole months.
- IDS-1's one-off numbers1-foot failure (seed 407634524, sequence 66) didn't reproduce. It was green on the
  real clock at 02:11 UTC and green pinned at 00:00:30 UTC with the database shifted. No UTC day count was
  found in the lapse or rhythm path. Sequence 66's "undated" step wrote through the queue without waiting, so
  the checker could read a half-written rhythm. That step now drains the queue, and sequence 66 is a fixed replay.
