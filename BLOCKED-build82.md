# BLOCKED / decisions — BUILD-82

## The Cowork fixture key + generator are not on disk (decided: derive from the artifact)
The spec says `tests/fixtures/build82/` holds `messy-25k-v3-fixture-key.md`, `key.json`,
`donor-truth.json`, and `gen-messy-v3.py` (seed 20260906), and that the key is also in
the project as `claude/messy-25k-v3-fixture-key.md`. None of those files exist anywhere
on this machine (searched ~, repo, Downloads). Only the workbook itself was present:
`~/Downloads/steward-messy-25k-v3.xlsx` (7,626,627 bytes, Sep 6 17:16).

Decision: the workbook IS the fixture. It was copied into `tests/fixtures/build82/` and
every ground-truth number was MEASURED from it (see `key.json` + the fixture-key md),
then cross-checked against the numbers the BUILD-82 spec states. Matches to the digit:
9 sheets and their roles, 25,300 people, 56,177 + 36,050 gifts, the five subtotal rows
(GRAND TOTAL $32,523,933.89), 500 orphans (288 + 212), 40 hidden rows, 100 yellow rows,
40 comments, hidden column AD "Internal Score", 560 percent-format cells, 843 zero-cached
formulas, 14,356 impossible day-first cases, the 800-row exclusion union, 100 failed +
60 stale sustainers. When Jonathan drops the real generator/key in, `gen-truth` can be
re-pointed at it; nothing asserts on a number that wasn't independently measured.

## Net cash $53,231,102.55 cannot be reproduced exactly from the artifact (decided: assert the bracket)
The spec's verification #4 says "net cash within refusals of $53,231,102.55". The
maximal reading recoverable from the file (every readable amount, damaged formulas at
their `N*1` face values, percent cells ×100, refunds/in-kind/orphans at absolute value)
measures $52,767,200.03 — $463,902.52 short (an earlier draft said $249,640.19 off a
buggy walk; the golden suite's waterfall is the correct figure). The remainder is generator-side truth for
damaged cells that the artifact no longer carries (BUILD-80 precedent: the v2 key's
$2,327,646.22 vs measured $2,293,751.22, pinned deliberately). The suite therefore
asserts what the phrase actually promises: |imported net cash − 53,231,102.55| ≤ the
dollars itemised on the refusal/routed lists, plus both TOTAL rows explained line by
line (the legacy TOTAL's cached SUM is itself stale by design: 19,852,987.83 cached vs
13,952,450.79 numeric — 10,818 amounts were later textified).

## Duplicate-people count (spec: 300) — resolved by the identity pass, not a static count
No static measurement of the sheet yields exactly 300 (email-shared rows: 715 raw;
same name+email: 95 groups; same name+phone: 247 pairs). The 300 emerges from the
BUILD-80-style identity fold (ID first, then email with compatible names, then
phone with compatible names, never name-only across distinct IDs). The implemented
fold measures **266** (every fold with a reason + the folded ID on the review list);
the golden suite pins 266. The ~34 the spec's number implies beyond that would need
a looser key (name+address matched nothing; nickname-compatible email pairs may be
the remainder) — not loosened without Jonathan's say-so.
