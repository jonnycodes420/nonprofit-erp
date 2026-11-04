# SCORES-1 · One gift rewrites one person's score, not the whole org's (2026-11-04)

On 4 Nov prod was down ~2.5 hours: an autovacuum ANALYZE on donor_scores held the pool until the database was
restarted. The table churned because `recomputeOrgScores` deleted the org's rows and reinserted them all. It did
this after every gift, merge, link and import chunk, and whenever someone opened a profile whose person had no
score row (inline, in the GET). In the 1,032-person test file, one gift wrote 2,064 tuples.

- A change now rescores only the people it touched, plus their household and spouse/household links. They are
  scored against the **stored population**: each live person's raw values as donor_scores last wrote them, with
  the changed person's own old value swapped for the new one. Their own score is then exactly what a full pass
  would give them if nobody else had changed. Anyone else whose percentile would move waits for the full pass.
  That's the cut-point rule, written above `storedPopulation` in engagement.js. No new table: donor_scores is
  the population.
- Every write is an upsert that changes a row only when a value changed (`IS DISTINCT FROM`). The reason's
  "the most recent touch N days ago" tail is excluded from the comparison, because `reasonFor` re-says it on
  read. A row is also rewritten when the person's donor_rhythm row is newer, because lapse.js ON_TIME_THROUGH
  reads the newer of the two.
- The only delete left is a gone person's own row, by donor_id. The arch-check `score-deletes` hard rule fails
  on any other.
- handler:scores folds. A waiting job takes in a new ask's people (or "full"), and a running one leaves one
  waiting job: "run again once". A full ask (an import's chunks) is a trailing 20 s debounce, capped at
  10 min, so an import gets one full pass at its end.
- On main, ten quick gifts were already one job: the queue keeps one waiting row per key. The cost was that
  each job rewrote the whole org. Removing the fold now loses the folded people, and the test catches that.
- GET /donors (Jonathan's 6,395-person prod data point) never recomputed. It reads donor_scores per row (three
  PK lookups, the closeness band, and lapse.js ON_TIME_THROUGH, which looks up donor_scores and donor_rhythm by
  donor_id with no org_id, so no index serves it). Locally it stayed at 57–230 ms before and after, even at 70k
  dead tuples, because Postgres evaluates those subqueries only for the 50 rows returned. The 146 s wasn't
  reproduced. The churn behind the ANALYZE timeout is gone (6,395 tuples and 0 dead for that import, against
  19,185 and 6,395 on main).
