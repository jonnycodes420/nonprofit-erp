# QA — Fresh-org E2E on production (BUILD-06 Phase D, 2026-07-17)

First-ever cold run of signup→value on production, scripted (Playwright,
1440×900, https://www.stewardapp.dev), as a stranger would experience it.
Test org: "QA Fresh Org 1784262298518" (throwaway plus-address of the founder
email). **No payment was initiated at any point** (live Stripe keys — the
donate page was render-only). Screenshots + raw step timings in the session
records; org ids and cleanup instructions in `BLOCKED-build06-cleanup.md`
(deletion needs super-admin credentials this environment doesn't have).

Note: run against the post-Phase-A/B/C deploy but **before Phase E's layout
changes** — cosmetics here may already be superseded; per the build spec, D is
about flow breakage, not aesthetics.

## Step table

| # | Step | Result | Wall clock |
|---|---|---|---|
| 1 | Landing page renders | PASS | 2.3s |
| 2 | Signup form → account created | PASS | 2.0s |
| 3 | …lands on /pricing, not /welcome | PASS (see finding R1) | — |
| 4 | "Go to dashboard →" header link → /welcome | PASS | 1.1s |
| 5 | Onboarding 1: org basics (mission) | PASS | 1.3s |
| 6 | Onboarding 2: CSV import via real DonorImport (6 donors, all imported) | PASS | 6.8s |
| 7 | Onboarding 3: first goal — pre-filled from imported data ("Win back $1,055 in lapsed giving") | PASS | 1.6s |
| 8 | Onboarding 4: impact metric — pre-filled template | PASS | 2.1s |
| 9 | Finish → Home renders with real data (goal banner, retention hero, queue) | PASS | 4.6s |
| — | **Signup → Home, scripted total** | — | **21s** |
| 10 | Tax settings (legal name, EIN 00-0000000, address) + enable receipts | PASS | 4.1s |
| 11 | Manual $300 gift on an imported donor (Gifts & Pledges → Add Gift) | PASS | 6.1s |
| 12 | One-click "Send receipt" → Receipt ✓ #number visible | PASS | 1.9s |
| 13 | Reports: Giving Summary (correct $300/1 gift; prior-period compare uses imported history) | PASS | 3.1s |
| 14 | Reports: LYBUNT (3 correct donors from imported history, call-list framing) | PASS | 2.6s |
| 15 | Settings → "Export all data (CSV)" zip download (3.4KB) | PASS | 2.7s |
| 16 | Public donate page /give/:slug renders (amounts, frequency, designation, Stripe notice) — **not submitted** | PASS | 3.4s |
| 17 | Delete test org | **BLOCKED** | see BLOCKED-build06-cleanup.md |

**Console errors: 0. Non-2xx responses: 0** (across the entire flow, both
scripted passes).

## Findings (ranked)

### Blocking — none
Zero hard breakage: no dead buttons, no failed steps, no console errors, no
failed requests in the entire cold funnel. Two earlier script-calibration
passes also surfaced no product errors (their aborts were test-script
selector issues; each did leave a throwaway org behind — cleanup file).

### Rough
- **R1 — Post-signup lands on /pricing where every primary CTA starts a Stripe
  checkout.** The actual continue-with-trial path is a small "Go to
  dashboard →" link in the header. The page *says* "30-day free trial, no
  credit card required," but the layout says "pick a plan and enter a card."
  A stranger who just typed their password expects to land in the product;
  this is the most likely drop-off point in the funnel. **FIXED 2026-07-17:**
  signup now lands directly on `/welcome` (onboarding), and `/pricing` shows a
  signed-in trial org a primary "Continue with your free trial →" CTA above
  the plan cards (plans remain the secondary option; the `?plan=` direct-
  checkout signup path is unchanged). Verified with a scripted signup through
  the real UI against a local stack.
- **R2 — Fresh-org retention hero reads as a scolding.** Day-one Home with
  freshly imported history shows "**0%** — 43pt below the 43% sector average —
  worth a closer look at who isn't renewing." Retention on an org created 60
  seconds ago isn't a meaningful number, and "below sector average" framing
  on first login lands as criticism. First-Touch Delay next to it handles the
  same situation gracefully ("No outreach logged yet — that's normal right
  after import"). Retention deserves the same brand-new-org empty state.

### Cosmetic
- **C1 —** LYBUNT defaults to the 17-day-old FY2027 and declares last year's
  giving "at stake" — technically correct call-list logic, slightly alarmist
  two weeks into a fiscal year.
- **C2 —** Onboarding goal suggestion said "Win back **$1,055** in lapsed
  giving" — the precise-to-the-dollar number reads odd as a suggested target
  (a rounded "$1,000" would feel more like a goal). Data-driven prefill
  itself worked exactly as designed.

## Stranger's-eye notes (non-findings)

- The onboarding is genuinely fast and honest — importing a real CSV as step
  2 means Home is alive (goal progress, retention chips naming real donors,
  LYBUNT populated) on the literal first view. This is the strongest part of
  the funnel.
- Receipt flow inspires trust: dummy EIN validated to XX-XXXXXXX, enable-gate
  refused until legal fields were present, receipt number appeared instantly.
- The donate page is clean and credible at every step short of payment.
- Giving Summary's narrative line ("down from $9,150 the prior period")
  correctly picked up imported history — a nice moment where the product
  looks smarter than a fresh org has any right to.

## Residue

Three test orgs remain on production pending super-admin deletion (ids,
verification steps, and the Stripe-customer loose end in
`BLOCKED-build06-cleanup.md`). The onboarding email drip to the test
plus-addresses stops automatically once the orgs are deleted.
