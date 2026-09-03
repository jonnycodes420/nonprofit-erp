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

## PART 5 — OFFICER vs OFFICER (the decided visibility, asserted)

tenant-matrix §8 (matrix now 43): two officers in one org, each with a
portfolio. **The decision, written down rather than left to the accident:**

- **Donor DATA is org-shared.** Any staff member reads any donor record,
  gifts, notes, moves — that IS the turnover thesis ("everything she knew
  is written down" — for the ORGANIZATION). Officer-level data silos would
  make the pitch false. Asserted deliberately (officer 1 reads officer 2's
  donor and their logged notes, 200).
- **Portfolio VIEWS are officer-scoped and enforced server-side.** The
  pipeline board downgrades a staff scope=all / foreign assignedTo to the
  officer's own portfolio (BUILD-31's rule, now matrix-asserted with real
  second-officer fixtures); the whole my-stats family (count + all five
  breakdowns) never carries another officer's rows. These are the
  performance/compensation-tracking surfaces the brief names as the trust
  question — they stay per-officer. The admin oversight view still sees
  both portfolios (the Team-tier whole-shop forecast, by design).
- **The day view's ?scope=all stays open to staff** — small-shop
  convenience, deliberate.
- **Drift is org-wide, and a colleague may clear a drift item for another
  officer's donor** — the actor stamp records who did it; accountability,
  not a wall.

Self-inflicted incident during this part, worth remembering: editing +
manually running tenant-matrix WHILE a pre-push battery was mid-flight
collided on the suite's fixed in-process port (:5697) and red-lit the
Part 7 push. Nothing was wrong with the code; the rule is one battery at a
time on this machine.

## PART 7 — THREE CANNED AUTOMATIONS (decisions)

- **`quiet_past_pattern`** rides THE drift engine, not a second 1.5×-median
  definition (the D.3 spec predates drift.js; two "past their own pattern"
  computations in one codebase is exactly the two-truths bug this build
  exists to kill). Trigger `donor_drifting`, swept on the existing 5-minute
  tick beside the lapse sweep; fires only for HIGH-confidence drift; task
  goes to the assigned officer (ED fallback, recorded); dedup per
  (donor, last_gift_date) so one drift episode fires once; the BUILD-25
  live-transition guard applies — the drift must have STARTED on/after the
  donor's created_at (an imported already-drifting history is a fact, not an
  event). The task title carries the drift reason — the donor's own pattern.
- **`major_gift_alert`** is TUNING, not building: the workflows payload now
  carries a `suggestedThreshold` (95th percentile of the trailing 12 months'
  gifts, computed from the org's own file, shown beside the config); the
  owner alert title carries context (lifetime, last gift date).
- **`pledge_due_soon`**: trigger `pledge_due`, same sweep; a task for the
  donor's officer `leadDays` (default 14) before an open pledge's due date,
  dedup per (pledge, due_date). Creates a task only — the donor-facing
  pledge reminder machinery (BUILD-57) is separate and untouched.
- C.2 pinned at the source: none of the three recipes carries a send_email
  action (asserted in workflows-e2e).
- **Part 7 results**: workflows-e2e §B76 (84 total in the suite) — the drift
  recipe fires ONCE on a live transition with the reason in the task title,
  fires NOTHING for an imported-already-drifting donor or a
  medium-confidence one, and holds under two concurrent sweeps; the pledge
  recipe carries the OUTSTANDING amount ($600 of a $1,000 pledge with $400
  paid), skips out-of-window and fulfilled pledges, and dedups per
  (pledge, due_date); the suggestion equals the hand-computed
  percentile_cont(0.95) and an org with <20 gifts in the year gets none.
  Suite-hygiene fix along the way: workflows-e2e's WIPE list predated
  pledges — the FK leftover silently kept the org row alive and crashed the
  NEXT run on orgs_pkey.

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

- **Part 6 — custom fields grown up (D.1)**, the whole part. Deliberate:
  the D.1 spec itself sequenced the schema migration LAST because it
  "deserves the most careful verification and benefits from the other two
  being stable" — landing a polymorphic `custom_field_values` migration,
  two new field types, three entity surfaces, server-side filtering, two
  export families and a state-diff round-trip manifest at the tail of an
  already-large shipped build is how schema migrations go wrong. The spec
  is committed (audit/BUILD-76-SPEC.md D.1) and BUILD-77 starts from it.
- The stage-pill/drift-badge label tension (see the walk).
- Officer-vs-officer coverage is breadth via the matrix §8; a deeper
  per-route officer axis (every parameterized route probed with a foreign
  officer's ids) can ride the same generated machinery if a pilot's trust
  question demands it.

## VERIFICATION (the build's own checklist, answered)

1. **Every Part 3 case asserted by name through the real path** —
   tests/drift.test.js §2 (import → named cases), 72/72, in run-all.
2. **A live test-mode Stripe gift clears drift** —
   scripts/build76-drift-drill.js 21/21 against REAL Stripe test mode with
   live signed webhooks (`stripe listen`), no mocks, on the real server
   code. NB the brief's "on the deployed stack" reading: production
   donations run LIVE Stripe keys, so a test-mode charge cannot be fired
   at the deployed backend without a real card; the drill is the no-mock
   leg, and the deployed stack is verified by status.js/landing-prod-verify
   convergence + a prod read-back of GET /drift after deploy (below).
3. **Date audit zero on both axes** — §7 helpers/call-sites 0/0; §5
   expressions 68, baseline LOWERED 85 → 68 and drift.js added to the
   audit's FILES at zero sites.
4. **landing-prod-verify.js 29/29** — run after final convergence (below).
5. **Badge and list from one computation** — tests/drift.test.js §4:
   badge==list per fixture donor, and a child server with
   DRIFT_DRIFT_THRESHOLD=50 + DRIFT_SEASONAL_GRACE_DAYS=99999 empties the
   list AND every badge from one env change.
6. **The walk** — docs/drift/WALK.md + captures, 1440/390, after 8pm in
   the walked org's own timezone.
7. **Full battery green, run once per push** — every push in this build
   went through the pre-push gate (one blocked push: the self-inflicted
   tenant-matrix port collision, § Part 5 note; re-run green).
8. **status.js aligned** — checked after CI deploy (below).
