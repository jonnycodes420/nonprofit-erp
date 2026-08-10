# BUILD-49 — Part 6 unverified-claims audit (report only)

**Date:** 2026-08-09. Nothing changed by this file. Jonathan decides what goes.

Scope: every quantified performance / scale / uptime / customer-count / outcome
claim across the landing page, pricing page, emails, onboarding, the invitation
flow, PDF receipts, and the board-report generator. Each row: the exact claim,
its file, and whether anything in the repo substantiates it. A claim with **no**
substantiating test/benchmark/measurement is a **FINDING**.

> Note: BUILD-49 Part 5 **deletes** the landing "Where Steward is today" candor
> section and the "A letter from the founder" section. Claims that live only in
> those sections are marked **(removed by Part 5)** — they will no longer ship,
> but are recorded here because they were live when this audit ran.

## Quantified / scale / outcome claims

| # | Claim (verbatim) | File:line | Substantiated? |
|---|---|---|---|
| 1 | "Load-tested to 25,000 donors and 200,000 gifts per organization." | `client/src/pages/Landing.jsx:1120` **(removed by Part 5)** | **YES.** Contrary to the BUILD-49 brief's premise, load testing **is** in the repo: `LOADTEST_REPORT.md` (BUILD-05, 2026-07-16) documents a real run at exactly 25,000 donors / 200,000 gifts / 150,000 interactions via `scripts/seed-loadtest.js` + `scripts/loadtest.js` against real Postgres + `server.js`. CLAUDE.md's "Scale (BUILD-05 load test)" section corroborates. **Not a finding** — the number matches a committed benchmark. (It was a synthetic single-org local test, not production traffic; if precision matters the wording could say "in load testing" — but it is substantiated.) |
| 2 | "The average nonprofit keeps 43% of its donors…" + "43.3% is the full-year 2025 donor retention rate published by the Fundraising Effectiveness Project (AFP Foundation for Philanthropy)." | `client/src/pages/Landing.jsx:900,908` | **YES** — external primary source cited by name. Not independently verifiable from the repo, but properly attributed (and to the primary source, not a competitor). Not a finding. |
| 3 | Recurring-loss calculator: annual loss = monthly × 12 × **29%**; "71% retention"; cites "M+R Benchmarks 2026." | `client/src/pages/Landing.jsx` (RecoveryCalculator) | **YES** — assumption and source stated inline; math guarded by `scripts/landing-funnel-verify.js`. Not a finding. |
| 4 | "20–30% of recurring giving is lost to nothing more dramatic than an expired card." | `client/src/pages/Landing.jsx:978` **(removed by Part 5? — NO: this is in product-moment 2, which Part 5 does NOT delete)** | **WEAK / FINDING (minor).** Uncited on the line. Line 71's own comment says the "widely-cited 20–30%" was **replaced** by the primary-sourced 29% (M+R) — yet the 20–30% prose survives here. Internal inconsistency: the calculator says 29%, the moment-2 body says 20–30%. Recommend aligning moment 2 to the 29% M+R figure it already cites elsewhere. |
| 5 | "Steward … takes no percentage — 0%, on every gift." + "Stripe's standard card-processing fee still applies — that goes to Stripe, not to us." | `client/src/pages/Landing.jsx:1089-1099` | **YES** — factual by construction (own-Stripe Connect; Steward takes 0% platform fee) and honestly qualifies Stripe's own fee. Not a finding. |
| 6 | Pricing bands: "Up to 5,000 active donors · 3 users" (Core); "Up to 25,000 active donors · 10 users" (Team). | `client/src/pages/Pricing.jsx` (rewritten this build) | **PARTIAL.** These are **commercial band limits**, currently **soft** (display-only, not hard-enforced — CLAUDE.md BUILD-24 §5 `SOFT_BAND_PLANS`). The 25,000 figure aligns with the tested ceiling (claim #1). The "active donors" wording is forward positioning; active-donor counting is **not yet implemented** (all counting is all-records today). Not a false claim, but the "active" qualifier is aspirational — flagged. |
| 7 | "he's raised tens of millions of dollars" (the founder's father). | `client/src/pages/Landing.jsx:1165` **(removed by Part 5)** | **NO / FINDING** — unverifiable personal claim. Removed by Part 5 regardless. |
| 8 | "cheaper than the real CRMs" (pricing quote block). | `client/src/pages/Pricing.jsx:365` **(removed by Part 2)** | **NO / FINDING** — comparative claim, no benchmark. Removed by the pricing rewrite (the whole quote block is deleted). |

## Flagged (report only) — not quantified, but risky

- **Unbounded commitments** — founder letter: "If something breaks, I'll fix it
  this weekend. If you need something Steward doesn't do yet, **I'll build it
  this week**." (`client/src/pages/Landing.jsx:1190-1191`). A promise no solo
  operator can guarantee. **Removed by Part 5** (founder-letter deletion).
- **"never" in a fee promise** — founder letter: "it will **never** charge you to
  reach your own donors, or take a cut of a dollar meant for your mission."
  (`client/src/pages/Landing.jsx:1185`). Absolute fee promise. **Removed by
  Part 5.** (No other "never"-in-a-fee-promise found in shipped copy; the money
  strip and pricing use bounded "0% platform fee / no donor tip" phrasing.)
- **P2P denial** — none found in shipped copy (see `BUILD-49-copy-sweep.md` §C).
  The product ships P2P; the only "deferred" framing is a stale internal note in
  `CLAUDE.md:880`, not user-facing.

## Not applicable / clean

- **Emails, onboarding, PDF receipts, board-report generator** — swept for
  quantified performance/scale/uptime/customer-count/outcome claims: **none
  found.** Receipts state factual per-gift figures + legal/EIN text (flagged
  separately as needing an attorney pass, not a quantified marketing claim).
  Onboarding copy ("import your donors in minutes", "under two minutes") is
  effort-descriptive, not a measured performance guarantee.
- **No customer-count / uptime / SLA / "X% faster" claims** appear anywhere in
  shipped copy (grep for uptime/99.9/SLA/benchmark/faster returned only CSS
  transforms).

## Summary of findings (claims with no substantiation)

1. **#4** — "20–30%" recurring-loss stat is uncited and inconsistent with the
   page's own primary-sourced 29% (minor; alignment recommended).
2. **#7** — "tens of millions raised" (removed by Part 5).
3. **#8** — "cheaper than the real CRMs" (removed by Part 2).
4. Two risky absolutes in the founder letter (unbounded "I'll build it this
   week"; "never" fee promise) — both removed by Part 5.

The headline claim the brief expected to be unsubstantiated — "load-tested to
25,000/200,000" (#1) — **is in fact substantiated** by `LOADTEST_REPORT.md`.
