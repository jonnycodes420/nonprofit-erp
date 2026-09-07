# BUILD-83 findings — close the import, then make Home tell the truth

## Part 0 — the reproduction (Sept 7 run, replayed locally before any fix)

Fresh org, v3, Jonathan's exact answers (legend on hidden, legend on yellow,
flag-the-40 on comments, Import-as-normal on the bogus blue prompt). Screens
+ DB truth in `docs/build83/repro/`.

**The clobber, confirmed and localized.** The signals screen shows TWO
"highlighted rows" prompts: the yellow 100 on Donors, and a second one for the
gift sheet — its 5 shaded rows are the four year-subtotals and the GRAND TOTAL
(fill #DDEBF7), i.e. chrome that should never have prompted at all. Both
prompts share ONE state key (`filled_rows`), so answering the blue one
Import-as-normal silently overwrote the yellow per-legend choice. The
pre-write summary already showed the damage — "700 rows carry an exclusion …
0 highlighted" — and the DB after commit reads `do_not_contact = 0`. 100
people Cheryl marked do-not-contact were on every ask surface. Two defects:
chrome rows counted in the fill pass (1.1) and shared prompt state (1.3).

**DB truth after commit** (org_41aa58b3): 25,034 donors · 88,967 gifts ·
$50,979,808.17 · 693 exclusion records (deceased 348 / dnc 0 / dns 296 /
dnm 72; 700 on the summary — 7 flagged rows folded as duplicates) ·
600 sustainers (100 card-failed, 60 stale) · 60 pledges ·
**3,107 ledger rows, $1,010,106.39 of FY income posted by the import** (the
Part 6 defect, verbatim) · 0 goals rows on this org (the prod auto-goal came
from a path this replay skipped — hunted in Part 3.2).

**Timing** (missing from the Sept 7 record): click-to-summary **13.4s**,
import write 125.9s on a cold fresh-boot DB (the Sept 6 run measured 15.2s on
a warm one; the delta is first-boot index builds, not a regression — re-timed
after the build in the verification walk).

**The contradiction pairs on one screen** (the Part 3.4 enumeration, from the
Sept 7 screenshots + this replay):
1. PIPELINE tile "0 prospects · $0 lifetime" beside a funnel with thousands
   staged (Cultivate 3,143 / Solicit 926 / Steward 2,719 on Sept 7).
2. PORTFOLIO "0 donors · $0 lifetime giving" the screen after importing 25,034.
3. Drift card "$3,808,039.71 · 1,605 donors past their own pattern" vs the
   footer "$38.7M at risk across 19,855 quiet donors" — same word, 10× apart.
4. The goal "Win back $29,955,207 in lapsed giving" vs the funnel "Lapsed,
   window closed · $30M" — the same cohort as both a target and a write-off.
5. Recurring: "Nothing needs you" one line above "160 whose giving stopped",
   and "0 giving" for a file whose Recurring sheet shows 440 giving.
6. The footer stapling "$38.7M at risk" to "No platform fee, no donor tip."
