# BUILD-45 — Donor Portal (white-label) — FINDINGS

Run 2026-08-10/11 (autonomous overnight build). NB this is the THIRD use of
the "BUILD-45" label; the 2026-08-08 dashboard-defects findings moved to
`audit/BUILD-45-dashboard-FINDINGS.md`. Verification notes (what was read
before building): `audit/BUILD-45-NOTES.md`. Strategic note: this build
deliberately reverses the 2026-07-12 "no donor-facing portal" decision while
keeping its substance (no passwords, no tiers/badges/leaderboards, no streak
claims, no cancel friction) — recorded in NOTES, not accidental.

Evidence keys: `tests/portal.test.js` (67), `tests/gift-idempotency.test.js`
(39), the updated `concurrency2` (16) / `state-diff` (68) / `state-diff2`
(101) / `attribution-completeness` (70) suites, `audit/routes.md` (BUILD-45
section), `audit/portal-data-handling.md`, `docs/build45-portal-demo/`
(7 DSF3 screenshots incl. the day-view drift alert).

## Verdict table

| ID | Check | Verdict | Evidence | Severity |
|---|---|---|---|---|
| F-3 | Gift idempotency at the DB (every non-webhook path; 2× sequential + 50× concurrent → 1 row, 0 side-effect replays) | **FIXED** | gift-idempotency.test.js §F-3; uq_gifts_idem | was HIGH |
| F-4 | Import twin-collapse — (donor,amount,date) never a silent dedup key; external-ID column is the one dedup key (cross-run idempotent); collisions held for human review | **FIXED** | gift-idempotency.test.js §F-4; import UI report | was HIGH (pilot-blocking) |
| F-5 | Pledge partial payments — paid applies against balance; every "pledged" figure reads remaining; reopen/refulfill coherent under delete/edit/refund | **FIXED** | gift-idempotency.test.js §F-5; reviewed manifest edits in state-diff/attribution | was MEDIUM |
| P-1 | Magic link only: 256-bit CSPRNG, 15-min, single-use (atomic), invalidated on re-request; hash-at-rest | PASS | portal.test.js §2 | — |
| P-2 | No enumeration: identical response + async-work timing for known/unknown email | PASS | portal.test.js §2 | — |
| P-3/S-5 | Rate limits per IP + per target email + per mutation route, proven by scripted burst against the REAL limiter | PASS | portal.test.js §7 (x-test-enforce-limits seam, prod-inert) | — |
| P-4/S-3 | Separate cookie+table; portal session × 15 staff routes → 401; staff JWT × every portal route → 401 | PASS | portal.test.js sweeps | — |
| P-5 | Tenancy: path-based `/portal/:orgSlug` + same-origin `/portal-api` proxy (documented decision); custom CNAMEs deferred | DECIDED | BLOCKED-custom-domains.md | — |
| P-6 | One email/many records: all same-email records in-org render; other-org same-email session independent (401 cross-slug); household in a separate labeled section | PASS | portal.test.js §3 | — |
| P-7 | Audit rows on link-request/session-create/every mutation (donor, org, IP, action) | PASS | portal.test.js + portal_audit_log | — |
| §3 | Portal totals == gift-row SUMs == donor summaries (ONE ledger); receipts reuse stored PDFs; thin-data honesty (no streaks/percentages; empty sections hidden) | PASS | portal.test.js §3 | — |
| R-1 | Amount change: server re-priced, integer minor units, org floor, proration none | PASS | portal.test.js §4 (Stripe mock asserts unit_amount + proration) | — |
| R-2/R-3 | Pause (opt auto-resume) → Stripe pause_collection void; dunning over a paused schedule sends NOTHING; resume explicit + webhook auto-resume path | PASS | portal.test.js §4 | — |
| R-4 | Cancel: one confirm, optional skippable reason, no dark patterns; org alerted in minutes | PASS | portal.test.js + Portal.jsx | — |
| R-5 | Card update = existing setup-mode Checkout; PAN/CVC never touch Steward | PASS | portal.test.js (URL reuse) | — |
| R-6 | New gift from portal = link into the EXISTING giving page, email prefilled (page exists per-org → not blocked) | PASS | Portal.jsx give card | — |
| R-7 | Concurrency: pause×amount race coherent; double-cancel → one winner, one alert; 50× gift burst → 1 row | PASS | portal.test.js + gift-idempotency.test.js | — |
| R-8 | Every mutation: donor email (org letterhead) + CRM timeline + notification pipeline (notification_failures retry infra reused, no second path) | PASS | portal.test.js §4 | — |
| §5 | Theme record, CSS vars, upload validation, contrast guard (normalizeAccent — deepens + tells admin), powered-by OFF by default, designed default | PASS | portal.test.js + Settings › Donor Portal | — |
| §6.2 | Deterministic impact matching on existing gift attribution (24-mo), org-wide fallback, no classifier | PASS | portal.test.js §3 | — |
| §6.3 | Drift wire: cancel/pause → officer email (ED fallback) + high-priority due-today task on the day view; recovery email links into the portal; engagement events on timeline, never alerted | PASS | portal.test.js + day-view screenshot | — |
| S-1 | Route inventory updated; every new route classed + isolation-marked | PASS | audit/routes.md §BUILD-45 | — |
| S-2 | Donor A × Donor B objects → 404 (gifts absent, receipt 404, sub 404, impact 404); session × org B slug → 401 | PASS | portal.test.js | — |
| S-4 | Token entropy/expiry/single-use/POST-consumed/fragment (no Referer leak) | PASS | portal.test.js §2 | — |
| S-6 | Stored-XSS pass: org-authored fields stored as data, delivered as JSON; portal client has NO dangerouslySetInnerHTML; email interpolation escaped | PASS | portal.test.js + grep | — |
| S-7 | No PII/tokens/card data in logs or error pipeline on new routes (console.error message-only) | PASS | grep in this build (see NOTES) | — |
| S-8 | Bundle secret grep clean (sk_/whsec_/re_/JWT_SECRET/SUPABASE absent from dist) | PASS | build grep | — |
| S-9 | Receipt/PDF downloads session-scoped, ownership-checked, never guessable | PASS | portal.test.js | — |
| S-10 | D11 card-testing: the portal adds NO new public payment surface (gift = existing giving page with its existing protections; card update = existing signed Checkout flow) | PASS by construction | routes.md | — |

## Out of scope (deliberately NOT built, per §8)

Passwords/social login for donors · custom CNAME domains
(`BLOCKED-custom-domains.md`) · donor-to-donor anything · native apps ·
events/ticketing/P2P · AI-generated impact copy or auto-classification ·
Team-tier changes · proration math · multi-currency. None were improvised.

## Deviations / judgment calls (flagged for morning review)

1. **Stripe test seam** — `STRIPE_API_BASE` env (constructor host override,
   the RESEND_BASE_URL pattern) so the money-mutation suites drive the
   Stripe-first paths against a local mock. Unset in production; documented
   in run-all.sh/README/ci.yml.
2. **Rate-limit test seam** — the portal limiters honor two `x-test-*`
   headers ONLY under `DISABLE_RATE_LIMIT=1` (the scratch stack) so the
   burst suite exercises the real limiter; production ignores them.
3. **Portal client palette** — `pages/Portal.jsx` added to the
   brand-allowlist EXCLUDE list (documented): a white-label surface carries
   the ORG's server-validated theme, deliberately not Steward's palette.
4. **§3's "390px/1440px both money formats" wiring check** — done at the
   API level (portal == DB == CRM equality proven) + DSF3 screenshots at
   both widths; a committed browser-DOM assertion suite in the
   presentation-wiring style was NOT written for the portal this pass.
   Follow-up candidate, not a correctness gap (the client renders via the
   shared `fmtFull`).
5. **Prod demo seeding is a two-step**: `scripts/seed-build45-portal-demo.js`
   runs the API-driven dressing against prod (portal on, theme, impact
   updates) AFTER the Railway deploy lands; the paused/cancel drift pieces
   need real Stripe subscription rows, so they are demonstrated on the local
   stack (`docs/build45-portal-demo/`) — do not hand-insert fake subs in prod.
6. **Time-flake fix in notify-delivery** — the §1 push exposed the
   documented UTC/local daily-reminder boundary flake; fixed by pinning
   {today} (test-only change, committed separately).

## §10 — the app-sec review note (unchanged structural blind spot)

The external app-sec review ($2–4k) was already gated on real donor files.
This build **adds an unauthenticated public surface and donor self-serve
money mutations to its scope** — it is now more necessary, not less, and
should be booked BEFORE pilot orgs' donors get portal links.
`audit/portal-data-handling.md` is the review's source material. The same
intelligence that wrote this portal wrote its tests; that structural blind
spot is unchanged.

## The worry paragraph

If 10,000 donors hit this next month, here is what I would still be nervous
about. First, the Stripe-mutation paths have never touched real Stripe: the
mock proves we SEND the right calls (pause_collection void, unit_amount,
proration none, cancel_at_period_end), not that Stripe's real responses —
partial failures, webhook ordering against `customer.subscription.updated`,
a pause landing mid-invoice — behave the way the local state machine
assumes. One real-money test subscription must be paused, re-priced, and
canceled through the live portal before any pilot donor sees it. Second,
email deliverability is now a security-adjacent dependency: the entire auth
model is "the donor's inbox", and I could not verify real inbox placement of
the magic-link mail (SPF/DKIM are set, but a spam-foldered link IS a login
outage — watch the `link_requested`→`session_created` audit funnel in the
first week). Third, the enumeration guard holds at the HTTP layer, but the
per-email rate limiter keys on attacker-supplied input; a distributed
attacker gets 20 probes per IP per 15 minutes — fine for five pilots,
worth revisiting (per-org daily caps) before the portal URL is on 10,000
receipts. Fourth, `portal_audit_log` grows unboundedly and holds email+IP
with no retention policy — an attorney question before scale, not after.
And the standing one: the same intelligence that built this surface wrote
every test that says it's safe; the external review in §10 is the check on
that, and it should happen before the pilot send, not after.
