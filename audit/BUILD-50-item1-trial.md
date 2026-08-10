# BUILD-50 Item 1 — "Free through December 31, 2026" honored in code

**Date:** 2026-08-10

## The fix (backend, not copy)

The public promise ("Free through December 31, 2026 — then $149/month", printed on
`/pricing`, the founding-partner agreement, and the leave-behind) was contradicted
by a 30-day trial. Fixed:

- **`trialEnd.js`** (new, pure/Node-testable) — `computeTrialEnd(now)` is the ONE
  definition: created **on or before 2026-12-31** → trial ends **EOD 2026-12-31**;
  created **2027-01-01+** → **30 days**. "End of day 2026-12-31" is computed in the
  org timezone **falling back to UTC**; Steward has **no per-org timezone column**,
  so every org uses the UTC fallback today (`2026-12-31T23:59:59.999Z`).
- **`server.js` `/auth/register-org`** (the signup path) → uses `computeTrialEnd`.
  Verified live: a new org now returns `trial_ends_at: 2026-12-31T23:59:59.999Z`.
- **`server.js` `/auth/register`** (legacy route) previously set **no**
  `trial_ends_at` (→ NULL → never expired). Now sets the same free-through trial,
  so every self-serve path is consistent.
- **`server.js` `/billing/create-checkout`** → sets the Stripe subscription's
  `subscription_data.trial_end` to the org's `trial_ends_at` when it's still in the
  future, so an org that picks a plan **early** (during the free period) is not
  charged until the free period ends. **This matches "what the app shows."**
- **Pinning test** `tests/trial-end.test.js` (13 assertions, in `run-all.sh`):
  2026 timestamps → ends 2026-12-31; 2027 timestamps → +30 days; boundary at the
  exact FREE_THROUGH instant; ms/Date/ISO inputs.

## Stripe money-configuration decision (the STOP check)

**No STOP.** Honoring this required **no** change to any Stripe **product or price**
object — the $149 / $299 Price objects are untouched. The only Stripe change is
setting `trial_end` on the **subscription** created at checkout, which is a code
change, not money configuration. (Signup itself creates only a Stripe *customer*,
no subscription/trial, so there is nothing to reconcile at signup time.)

## Existing orgs — extension (report the count, never shorten)

Script: **`scripts/extend-trials-free-through-2026.js`** — idempotent, **dry-run by
default**, `--apply` to write. It extends to `2026-12-31T23:59:59.999Z` only orgs
that are **currently `trialing`** with a **non-null** `trial_ends_at` **sooner** than
that date. It deliberately **leaves untouched**: NULL-trial orgs (a null end is
effectively unlimited — moving it to a finite date would *shorten* it) and any org
already ending on/after 2026-12-31.

- **Local scratch DB count (dry run): 14 orgs** — all test-fixture orgs
  (`D1 Gate B`, `Merge Fixture Org`, …) with ~30-day trials ending in September;
  each would be extended to 2026-12-31.
- **PROD count: not run from here** — the production DB URL lives on
  Railway/Supabase and is not in this environment. Run against prod to get the real
  count and apply:
  ```
  DATABASE_URL=<prod> node scripts/extend-trials-free-through-2026.js          # report
  DATABASE_URL=<prod> node scripts/extend-trials-free-through-2026.js --apply  # extend
  ```
  Prod is pre-launch, so this is expected to touch few real orgs. The code fix above
  already makes every **new** org correct; this script cleans up **existing** ones.

## Trial-length copy sweep — every hit (app · emails · onboarding)

| File:line | Copy | Action |
|---|---|---|
| `client/src/pages/SignupPage.jsx` | "Start your free / 30-day trial." + "No credit card required to start" | **Rewritten** → "Free through December 31, 2026." + "then $149/month. No card required." (exactly matches /pricing) |
| `client/src/pages/TermsPage.jsx:58` | "New accounts receive a 30-day free trial" | **Rewritten** → free through 2026-12-31 for accounts created ≤2026-12-31, else 30 days. (Legal copy; still needs the outstanding attorney pass noted elsewhere.) |
| `server.js` onboarding drip, `delay_days: 28` | subject "Your trial ends in 2 days"; body "Your 30-day Steward trial ends in 2 days"; "Plans start at **$99/month**"; "a fraction of what **Bloomerang or Salesforce** charge" | **Rewritten** → "A month in with Steward"; states free through Dec 31 2026 then **$149/month**, no-fee framing, **competitor names removed** (per the no-competitor-names decision). NB: existing enrollments already have the old body stored in `sequence_steps`; only new enrollments get the new copy (pre-launch, low volume — not migrated). |
| `client/src/App.jsx:381` | trial banner "**{trialDaysLeft} days** left in your trial" (shown only when ≤14 days) | **No change** — it reads `trialDaysLeft` from `trial_ends_at`, so it's automatically accurate (a 2026 org shows ~144 days and the banner stays hidden until ≤14). |
| `client/src/pages/Pricing.jsx` "Continue with your free trial" | authed-trial CTA, no length claim | **No change** — generic and accurate. |

Not trial length (left alone): the "30 days" **data-retention/grace** windows in
`TermsPage`/`PrivacyPage` (§ cancellation & deletion) and the "next 30 days"
grant-deadline windows — these are unrelated to trial length.
