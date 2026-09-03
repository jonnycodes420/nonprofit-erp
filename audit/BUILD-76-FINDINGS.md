# BUILD-76 FINDINGS — make drift real, and prove it

Working record. Updated as each part lands.

---

## PART 1 — THE DRIFT ENGINE

### The definition, and where every number came from

`drift.js` (repo root, beside `orgTime.js`/`money.js`) is the ONE module.
Pure functions: every input — the gift history and TODAY — is a parameter.
The module never reads a clock, so the BUILD-74/75 date-seam audit scans it
(added to `scripts/build72-date-audit.js` FILES) and it contributes zero
unrouted sites by construction. All thresholds live in one `DRIFT` constants
object, each overridable via `DRIFT_<NAME>` env vars — which is also how the
one-computation proof works (boot a child server with a different threshold;
the list AND the badge must both move).

| Constant | Default | Reasoning |
|---|---|---|
| `DRIFT_THRESHOLD` | 1.25 | brief default. Below it a slightly-late regular giver ("quarterly, a few weeks over") is NOT drifting — flagging at 1.0× would teach officers the list cries wolf |
| `LAPSE_RATIO` | 2.5 | brief default — past 2.5× their own cadence the window where a call still works has closed; different state, different list, different language |
| `LAPSE_MAX_DAYS` | 730 | the 24-month cap, whichever comes first. Nobody is "drifting" after two silent years regardless of a long personal cadence |
| `MIN_OVERDUE_DAYS` | 30 | absolute floor on top of the ratio: a monthly-cash giver at 1.25× is 8 days late, which is noise, not drift. Nobody is flagged less than 30 days past their own expected date |
| `SEASONAL_MIN_YEARS` | 3 | a calendar-month cluster needs 3+ distinct years before it is a pattern rather than a coincidence (brief §1.2) |
| `SEASONAL_SHARE` | 0.8 | ≥80% of giving events must fall in the cluster month (or calendar quarter) — this is what stops a quarterly giver (whose January recurs 3 years too) from being misread as seasonal |
| `SEASONAL_GRACE_DAYS` | 30 | the seasonal window "closes" at month end; one month of grace before drift. March-giver Margaret: NOT drifting on March 20 or April 20, drifting by June 20 — the brief's own pinned example |
| `HIGH_CONFIDENCE_MAX_CV` | 0.25 | ROBUST interval variability: median-absolute-deviation ÷ median interval, NOT a mean-based CV. Deliberate — the declining donor (steady quarterly, then the blowout interval that IS the drift) still has a crystal-clear cadence, and a mean-based CV let the drift itself destroy the confidence in flagging it (caught by the suite's DECLINING case on first run). The genuinely erratic donor is additionally caught by the cadence cap below |
| `MAX_CADENCE_FOR_HIGH` | 450 | a median interval past ~15 months with NO seasonal cluster is not a "clear cadence" — confidence caps at medium. High confidence on the erratic case is a bug (brief §3.1) |
| `HOME_LIST_CAP` | 11 | brief §1.5 |
| `HANDLED_SNOOZE_DAYS` | 30 | a drifting donor with a meaningful contact (call/meeting/stewardship — the existing MEANINGFUL_CONTACT_TYPES minus email opens) logged in the last 30 days is HANDLED: still drifting (badge stays), but the list stops resurfacing them (Part 4's payback) |

- **"N intervals late" in the brief's fixture table** maps to overdue ratios:
  "one interval late" is built at ~1.1× (inside threshold — not drifting);
  "three intervals late" is built at ~2.0× (drifting). A literal 3.0× for a
  quarterly giver is past the 2.5× lapse boundary — the table's intent
  (slightly late ≠ drifting; clearly past ⇒ drifting; far past ⇒ lapsed) is
  what the fixtures pin.
- **Value at risk = trailing 24-month giving.** For a drifting donor this is
  always > 0 by construction (their last gift is inside the ≤24-month lapse
  boundary), so it is the basis the data always supports; annualised cadence
  value was not needed as a fallback. Stated per brief §1.1.
- **Same-day gifts collapse into one giving event** before cadence math — two
  receipts on one occasion are one act of giving, and zero-length intervals
  would poison the median.
- **Seasonal detection**: calendar-month cluster first (≥3 distinct years,
  ≥80% of events), else calendar-quarter cluster (same thresholds). Drift is
  measured from the WINDOW CLOSING (end of the expected month/quarter +
  grace), not from an elapsed interval. Seasonal donors in the demo file:
  recorded below after the demo walk.
- **Confidence**: high = 3+ events AND (seasonal cluster OR (CV ≤ 0.25 AND
  median cadence ≤ 450d)). Medium = 2 events, or 3+ with high
  variance/unclear cadence. 1 event = not eligible (no cadence exists).
  Medium is behind `includeMedium` and labelled — never presented as high.
- **Exclusions** (asserted as a family in tests/drift.test.js): deceased ·
  do-not-contact · active recurring (status active/past_due/recovering — a
  failed card routes to the failed-payment path, not drift) · open-pledge
  payers (their cadence is contractual) · single-gift donors · anyone inside
  their own threshold.

### Recompute timing (Part 3.4 decision)

**Drift is computed on READ, never stored.** No cache, no schedule, no
write-path hook. A gift that lands via webhook or manual entry is reflected
the next time any drift surface is read, because every surface calls
`computeDriftForDonors()` fresh. The math is cheap (one aggregate query per
read: `array_agg` of gift dates+amounts per donor), and the page-scoped
surfaces (donor list, pipeline) compute only for the rows on screen. The
"officer calls someone who gave yesterday" failure cannot happen by
construction. If a very large file ever makes the org-wide read slow, the fix
is a short-TTL cache with write-path invalidation — deliberately NOT built
now (it is the only way this feature can lie).

Dates: `today` enters through BUILD-75's seam (`orgToday(orgTz(orgId))`) at
every call site; drift.js itself does pure civil-date arithmetic on
`YYYY-MM-DD` strings via orgTime helpers.

## PART 2 — SURFACE (decisions)

- The Drifting section renders ABOVE Needs Your Attention, only when at
  least one high-confidence donor is drifting — a fresh org gets no empty
  ceremonial section (the lapsed-counter-reading-zero mistake, not repeated).
- The headline stat: dollars at risk from drift replaces Retention Rate as
  the hero of the metrics card when > 0; Retention is demoted to the second
  block (kept, smaller). At $0 drift the card keeps Retention as hero — an
  honest zero is not a headline.
- Funnel: Drifting is the featured out-flow row (gold/brass, count+dollars);
  Lapsed stays below it, smaller. The drifting row renders only when
  count > 0 (same honest-zero rule).
- The badge is brass (`T.gold600` tone), small, quiet; title/hover = the
  reason sentence. Sites: donor record header, Directory rows, ⌘K search
  results, Pipeline cards — all read the SAME `drift` field their existing
  data payloads now carry, computed by the same function as the list.
- The Drifting section is org-wide (not officer-scoped): the headline is the
  same sentence the landing page makes about the whole file. Officer scoping
  can ride the existing scope toggle later if a pilot asks.
- The Drifting section requires VISIBLE rows, not just a nonzero count —
  when every drifting donor is handled the card disappears rather than
  rendering an empty header (found on the first visual smoke; the hero and
  funnel row stay, because the money is still at risk until a gift lands).
- The section lives INSIDE the work column, above Needs Your Attention —
  deliberately not a new homeLayout row: the layout merge appends unknown
  ids at the END for users with saved configs, which would have put the
  thesis section last on every existing account.
- The older "quiet donors" figures (goal-banner AT RISK chip, ImpactLine —
  both ≥180-day QUIET_DAYS, BUILD-73) are KEPT with their own labels: they
  measure the size of the whole problem; the drift headline is the
  high-confidence, pattern-based subset an officer can act on today. Both
  say "at risk", neither says recovered.
- Two drift-era funnel rows: "◉ Drifting — Still Reachable" (featured, gold,
  count+dollars, renders only when count > 0 — a featured row proudly
  reading zero is the exact mistake the old lapsed row made) and "↘ Lapsed —
  Window Closed" (kept, smaller, demoted whenever the drift row leads).

### Part 1 results

- `tests/drift.test.js` (72, in run-all): every named case from the brief's
  table through the REAL import path, the exclusion family, badge==list on
  every fixture donor, the threshold-child proof, manual/webhook/refund
  clearing, the Part 4 loop, the cap, the sentence scan.
- Known corner, accepted: a donor whose own cadence exceeds ~584 days (24
  months ÷ 2.5) can never be "drifting" — the 24-month cap classifies them
  lapsed before their ratio crosses 1.25×. Per the brief's letter ("24
  months, whichever comes first"); such donors always carry medium
  confidence anyway (cadence > 450d without a seasonal cluster).
- The webhook PI handler resolves the fixture donor by receipt_email and the
  full-refund path DELETES the gift row — so clearing and re-flagging both
  fall out of compute-on-read with no drift-specific wiring in either
  handler. Nothing on the write path knows drift exists.
- Scale: on the 1,530-donor / 5,738-gift `org_wap` fixture, `GET /drift?all=1`
  = ~80ms and the file yields 72 high-confidence drifting (4.7% of donors,
  capped to 11 on screen), 183 medium (hidden by default), 885 lapsed —
  realistic proportions, not a 400-row wall.
- The fixture "CSV" is constructed at run time RELATIVE TO TODAY (drift is a
  function of today; a committed static file would rot into different states
  as the calendar moves) and posted through `/donors/import-combined` after
  the client's own `groupTransactions` — the same path a parsed spreadsheet
  takes in production. The BUILD-72 reconciliation invariant is asserted on
  the same import.
- Route inventory regenerated (352 routes); the tenant matrix auto-covered
  `GET /drift` and `POST /drift/:donorId/done` (foreign donor id → 404).
- date-seam BASELINE lowered 85 → 68: the standing count was already 68 (the
  suite had been printing the lock-it-in NOTE); drift.js joined the audit's
  FILES at zero sites.

## PART 3 — PROOF (record kept as parts land)

- **3.1 / 3.3** — tests/drift.test.js (72, in run-all): every named case
  through the real import path; the BUILD-72 invariant balanced on the
  drift fixture file; manual entry clears with double-tap-safe idempotency.
- **3.2 — the LIVE drill**: `scripts/build76-drift-drill.js` (SELF_REFUSING,
  classified in script-guards) against REAL Stripe test mode with
  `stripe listen` — **21/21** (docs/drift/stripe-drill-2026-09-03.log).
  Live-proven: a real charge clears list+badge and drops the headline by
  exactly the donor's value at risk; the FIRST charge of a new subscription
  through REAL Checkout (Playwright completes the 4242 card) lands as sub
  row + gift; a failed first recurring charge (real invoice.payment_failed)
  creates the past_due sub row and the donor is EXCLUDED from drift; a real
  refund puts the flag straight back. Drill gotchas recorded in
  docs/drift/README.md (3-arg stripeAccount retrieve; a reused test
  connected account must be released from earlier drill orgs or
  event.account resolves into the first run's org).
  The exclusion status set was widened during the drill: 'recovered' and
  'paused' subscriptions also exclude (billing again / deliberately paused —
  neither is quiet drift); only canceled/lost return a donor to voluntary
  cadence.
- **3.4** — computed on read, recorded above; the drill proved the property
  live in both directions (webhook in, refund out).
- **3.5 — the walk**: docs/drift/WALK.md + walk-*.png (1440/390, after 8pm
  in the walked org's own timezone). All ten reasons pass the
  say-it-out-loud test. One tension noted for BUILD-77: the fixed-365 stage
  pill (`Lapsed`) and the drift badge can appear together on a record —
  both true, deliberately separate vocabularies (D.3 keeps LAPSE_DAYS
  untouched), but worth a label softening later.

## PART 4 — LOGGING AS A BYPRODUCT (decisions)

- Marking a drift row done expands ONE inline line ("What happened?") in the
  row itself — Enter saves, Skip is one click/keypress. Both record an
  interaction (the call happened either way — that is what makes the donor
  record read "you called her three weeks ago" and stops the list
  resurfacing them via HANDLED_SNOOZE_DAYS); a skip is recorded as
  `metadata.skipped=true`, never as nothing.
- Actor comes from BUILD-75 C.1 stamping, automatically.
- `log_capture_rate` (share of drift-done completions that carried a line,
  trailing 30 days) snapshots into `metric_snapshots` so BUILD-77 can see
  whether the loop works on the pilot.

## LANGUAGE

- BUILD-73's outcome-claim ban already covers app copy + emails + PDFs
  (server.js is where emails/PDFs render; it is in the scan set).
- "AI-drafted re-engagement email ready for review" is DELIBERATELY ALLOWED:
  the ban is drawn at past-tense outcomes (`re-engaged`), and forward-looking
  process nouns (`re-engagement`) name a workflow, not a result. Now
  asserted explicitly in reserved-recovered.test.js rather than passing by
  accident.
- Drift copy throughout is money AT RISK; no drift surface says recovered.

## SLIPPED TO BUILD-77

(recorded at the end of the build)
