# PERF-5 · Home's first download stops growing with every build, and import Undo is fast again

Three items from ATLAS-9's CI run (24 Nov, PR #503). One PR. No new suite: perf-app and import7 are extended.

## What happened

- **What's new was not in Home's first download.** The brief's cause (TopBar imports `lib/changelog.js`, so every
  entry ships in the first JavaScript) did not match the code: since SWEEP-6/PERF-1 TopBar has loaded the changelog
  with a dynamic `import()`, and it builds as its own chunk (`changelog-*.js`, 58,539 bytes gzipped on bd4d2e8).
  Measured by building main twice, with and without one extra entry of a normal entry's length: the entry adds 113
  bytes to the changelog chunk and 3 to 5 bytes to `main`/`App` (the changelog chunk's new hash in the import map, the
  same length every build). So a What's new entry does not grow the first look; ATLAS-9's 161 bytes were its own code.
  What the changelog did cost: TopBar fetched all 58 KB four seconds after Home drew, on every visit, for the unread
  dot. Now the dot reads one build-time constant (`__WN_LATEST__`, the newest entry's id, from
  `client/scripts/changelogLatest.mjs` through `vite.config.js` `define`), and the panel moved into its own lazy
  chunk with the entries (`components/WhatsNewPanel.jsx`), loaded when What's new is clicked. Five ids instead of one
  cost Home 76 bytes gzipped, so it is one id; when a super-admin hid the newest entry, no dot shows until a newer
  build. Against main's own build (bd4d2e8, same command): `App` 87,574 -> 87,239 bytes gzipped (-335), `main`
  16,769 -> 16,767; Home's first look is about 338 bytes smaller. `JS_FIRST_KB` stays 248.
- **Import Undo was not made slow by TRASH-1 or UNDO-1.** CI's own shard artifacts, perf-app's 25k workbook Undo
  ("messy-25k undone in"): before TRASH-1 (ledger-3, define-1, receipts-1) 108, 117, 117 s; TRASH-1 and the builds
  after it 67 to 82 s; UNDO-1 73 s; THANKS-1 70 s; RULES-1 (main) 80 s. import7 (25k people) took 32 to 40 s in all
  of them. Only ATLAS-9's 14:36 run was slow: import7's Undo 706 s on shard 3 (both tries, stuck on "removing the rest
  of the file"), perf-app's 121 to 134 s on shard 1. ATLAS-9's next run read import7 59 s, perf-app 500 s. ATLAS-9's
  diff touches nothing on the import, Undo, trash or job path. Locally (Postgres 16, no JIT: this laptop's Homebrew
  build has no LLVM), Undo of 2,500 people took 0.4 s at eb38547, a7ee497, 5c922c6 and bd4d2e8 alike; of 25,000
  people 4.4, 5.9, 4.9 and 5.2 s. A JIT-on timing at four commits needs a Postgres with LLVM, which only CI has here;
  CI's numbers above are that measurement.
- **The one shape worth hardening later** (not changed here, no failure shows it): the Undo's orphan query probes
  `tasks` by `donor_id` alone, and the only index is `(org_id, donor_id)`. Forced into nested loops with 200,000 tasks
  on the database it takes 2.55 s; with `t.org_id = d.org_id` on the probe, 12 ms. Not the 706 s.
- **A slow Undo now fails as slow.** import7's §4 asserts "import Undo took N s (budget 120 s)"; past the budget it
  stops and its last line, which is the shard's FAIL line, says `import Undo took over 120 s (budget 120 s), last seen:
  <the step>` instead of "the suite passed its 360 s deadline". Planted a 6 ms query per created person in the Undo
  loop: red with exactly that line on both tries; removed: green, Undo 5 s.
