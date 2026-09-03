# The walk — BUILD-76 Part 3.5

**When/where:** 2026-09-03, walked in the org's own local evening — the walk
org (`org_b76walk`, "Lantern House Shelter") carries `timezone
Europe/Athens`, where the clock read **~23:00 (after 8pm local)** at capture
time. The list was read at 1440 and at 390. (The US-evening date-boundary
class — local date behind UTC — is pinned separately by the date-seam suite
and drift's own org-timezone entry point; the walked org's evening is
genuinely its own.)

**The fixture:** 13 fictional donors imported through the real import path
(`/donors/import-combined`) with realistic patterns — a March-style seasonal
major donor, steady annuals, a declining quarterly, a healthy quarterly
control. 10 drift high-confidence; the healthy quarterly (Frank DiNapoli)
and a just-inside-threshold annual (Tom Okafor) correctly do not; a
quarterly donor ~2.5× out (Priya Raman) correctly reads lapsed, not
drifting.

## Reading the list out loud, top to bottom

Every row's reason, as captured (`walk-drift-1440.png` / `-390.png`), with
the say-it-out-loud test:

| Donor | Reason on screen | Sayable? |
|---|---|---|
| Dee Fontaine | Gave four times a year, then once, then not at all. Nothing for 7 months. | yes |
| Margaret Chen | $2,000 every June since 2019. Nothing for 15 months. | yes — the landing page's sentence, now inside the app |
| Gus Papadakis | Gave three times a year, then once, then not at all. Nothing for 6 months. | yes |
| The Kim Family | $1,100 every July since 2022. Nothing for a year. | yes |
| Nell Hartley | Gave about twice a year for 2 years — usually around $500. Nothing for 14 months. | yes |
| Walt & June Ellison | $950 every May since 2022. Nothing for 16 months. | yes |
| Leo Brandt | $850 every May since 2023. Nothing for 15 months. | yes |
| Sam Whitfield | $750 every June since 2021. Nothing for 15 months. | yes |
| Ana Sofia Vieira | Gave around $680 in the second quarter each year since 2020. Nothing for 15 months. | yes |
| Opal Greaves | $300 every June since 2021. Nothing for 14 months. | yes |

No ratios, no day counts, no system vocabulary anywhere on the list (also
pinned by tests/drift.test.js §9). The money column is the trailing-24-month
value at risk, descending; the section header carries the same figure the
hero stat shows.

## What the walk noticed

1. **The stage pill and the drift badge can disagree on purpose.** Margaret's
   record reads `Lapsed` (the pipeline's fixed 365-day auto-lapse) beside
   `◉ DRIFTING` (her own 2-year seasonal boundary hasn't closed). Both are
   true in their own vocabulary, and the D.3 spec deliberately keeps the
   fixed-window machinery untouched — but the pairing reads odd on a record.
   Noted for BUILD-77: consider letting the drift state soften the stage
   LABEL (not the stage) on donor-facing-staff surfaces.
2. Exactly-annual givers read as seasonal ("$1,200 every June since…") —
   correct and clearer than "about once a year," since 365-day cadences
   cluster in a calendar month by construction.
3. At 390 the rows stack cleanly (name → reason → money → Done); nothing
   truncates; the one-line input fits with Save/Skip beside it.
