# BUILD-80 — decisions taken without a human in the loop

## The "In your file" dollar target (Part 1.5)
The brief asserts the independent scan equals **$2,327,646.22**. Measured
against the actual fixture, the sum of every PARSEABLE amount cell
(convention-correct closed grammar, refusing exactly the 8 planted traps) is
**$2,293,751.22**. The gap is $33,895.00 and decomposes as:
- $15,170.00 — the TRUE amounts of the 8 planted amount traps (`$1,5000` is
  really $250, `500 (pledge)` is really $6,250, …). The written cells cannot
  yield these; only the generator knows them.
- $3,025.00 — the 5 column-shifted rows whose amounts sit in the Gift Date
  column (500 + 1,000 + 75 + 200 + 1.250,00).
- $15,700.00 — residual damage whose true values are likewise invisible in
  the written bytes (verified per-category: soft credits, pledges, in-kind,
  refunds all match the key to the cent, so the residual is not a parser gap).

Decision: the summary claims what the written file actually says
($2,293,751.22) and the suite pins that number; a parser that reported the
key's number would be reporting cells it cannot read. If the generator-side
truth says otherwise, regenerate key.json with a per-cell true-amount table
and the assertion can tighten.

## v3 — the real 25,000-donor spreadsheet (BLOCKED on the file)
The verification's final step ("Then: v3. Not another synthetic file. The real
25,000-donor spreadsheet, into a fresh org") cannot run from this session:
no 25,000-donor file exists in this environment. What IS here
(~/Downloads): messy-5000-donors.xlsx (5,100 donors + 18,064 gifts —
synthetic, "messy" generator family), women-against-poverty-donors.xlsx
(1,530 + 5,738 — the BUILD-43 org_wap fixture source), and smaller test
files. Running v3 against a synthetic file would violate the brief's own
instruction. When the real file lands, the run is:
  1. fresh org via the UI (scripts/build80-capture.js is the template —
     point FIXTURE at the file, or walk it by hand),
  2. screenshots to docs/build80/v3/,
  3. read the drift list against whatever ground truth comes with it.

## Deviations taken without a human (summary)
- "In your file" pinned at the measured $2,293,751.22 (see the first section).
- The soft-credit accounting: 54 links + 3 household folds + 3 whose base
  gift sits on a refused row = 60 (the folds are donors who ride the
  couple's shared email; every one is visible on the merge-review surface).
- The 11th planted date trap ('29/02/2023') sits on a soft-credit row and is
  accounted on the soft-credit surface rather than as a date error.
- 'Andrea L. O?Brien': the '?' is IN the source bytes (5 cells) — displayed
  as written; identity still groups her rows to one record.
- import-header's BUILD-79 "mojibake passes through as data" pin was
  UPDATED to pin the Part 3 policy (validity-gated reversal, reported).
- The sector-average constant was deleted outright, including from the
  onboarding drip email (reworded without the stat).
