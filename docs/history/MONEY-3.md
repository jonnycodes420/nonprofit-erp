# MONEY-3 · One answer for "on track", the pledge on Home matches the pledge, the last flakes

Brief of 5 Nov 2026. Report: `.claude/reports/MONEY-3.md` (main checkout).

## Why
- **Pia January (surfaces-agree, 2 runs in 10).** The profile said On track from her gifts, read live;
  the Lapsing tag and the Directory read the stored on-time date. An import answers before its
  background job (importRecent) writes that date, and the test's queue drain waits only for
  `handler:%` jobs, so a check in that window found no stored date: tagged Lapsing, On track.
  A customer saw the same thing for the seconds after an import. Now On track reads the stored
  date too (engagement.closenessNow), both writers store one calculation (rhythm.js
  `storedThrough`, which was two: a day apart), and the reader takes the rhythm row, with the
  scores row only for someone who has none (lapse.js ON_TIME_THROUGH), never "whichever was
  written last".
- **$20,400 for a $20,000 pledge (fundraising2-screens, run 42110734392).** "Finley & Paige
  Northcott6" are one household. The suite gives a $400 pledge to the donor with the lowest id;
  when that was Paige, Home's deck folded her pledge move into Finley's card and appended her
  facts under the same "still to come" label, and the truth check summed the card. Each move now
  carries its pledge id and still-to-come (pledges.js `balanceCents`), folded-in facts say they
  are the other move's, and the truth check compares Home by pledge.
- **Atlas.** "Done." sat over an answer to a question; `spokeFor` says "Here's what I found."
  when every line is an answer. A list's reason is said in plain words
  (`server/shared/reasonWords.js`: "gave last December, nothing since Jan 1"), exposed on Ask's
  query answers as `reasonWords`.
- **Flakes.** fix52 §5 read the job before the server had claimed the dropped import (now waits
  for the job's row). fix59 §7 and perf-app's phone CLS were already fixed on main (TRUST-1 and
  SHIFT-2 step 2); every CI failure predates those commits.
