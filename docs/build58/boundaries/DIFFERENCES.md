# BUILD-58 Part 3 — the boundary audit

Every boundary between Steward and something it does not control, answered
against the three questions the BUILD-57 §2a Stripe drill established:

1. **Does a mock or fixture currently define the expected behaviour?**
2. **Has that expectation ever been checked against the real service?**
3. **What did the real service actually do?**

Drills this build ran against **real Stripe test mode** via
`scripts/build58-stripe-drill.js` (loopback server :5621 + `stripe listen`
forwarding real signed webhooks). **No real money.** The never-drilled
boundaries are named as such with a `BLOCKED-*.md` where a real drill needs
Jonathan.

The generalized property that came out of this part: every fixture standing
in for an external payload now lives in `tests/fixtures/external/`, carries a
`_provenance` stamp, and is **derived from a recorded real response** — a
hand-authored external fixture cannot enter the suite
(`tests/external-fixture-provenance.test.js`). The BUILD-57 lesson — a mock
that lied for three builds — cannot recur silently.

---

## 1. Stripe Connect onboarding — DRILLED (was never drilled before)

- **Mock defined it?** Yes, and wrongly: `network-gate` mocked Stripe state as
  our own `orgs.stripe_connected` flag.
- **Checked against real Stripe?** Now yes (§A).
- **What real Stripe did:** a `type=custom` account created for the Connect
  link has `charges_enabled=false` until KYC is actually completed —
  `stripe_connected` is set at **link creation**, before any onboarding. This
  is **W-1**: a reviewer could approve an org whose onboarding never finished,
  and its Give page would take gifts Stripe refuses. **Fixed** — the approval
  gate (`/admin/network/applications/:id/decide`) and the auto-delist sweep
  now call `stripeChargesEnabled(accountId)` LIVE (fail-safe: an unreachable
  Stripe refuses an approval but delists nobody). A real bare account is
  refused; the same account passes once real test-KYC (`id_number 000000000`,
  `address_full_match`, `btok_us_verified`) flips `charges_enabled` true.
  Pinned in `network-gate.test.js` (stateful mock) + the live drill §A.

## 2. Stripe one-time gift through the public path — DRILLED

- **Mock defined it?** `finance-reintegration`/`consistency-e2e` sign local
  webhooks with `whsec_localtest`.
- **Checked against real Stripe?** Yes (§B) — a real `pm_card_visa` charge on a
  real connected account, real signed `payment_intent.succeeded` forwarded by
  `stripe listen`.
- **What real Stripe did:** the gift recorded once, and (critically) **stamped
  the ledger exactly once** — confirming **W-3**'s chart-of-accounts fix holds
  on the real webhook path, not just the local one.

## 3. Refunds, disputes & chargebacks — DRILLED; disputes were UNHANDLED

- **Mock defined it?** Refunds: yes (`attribution-completeness` signs a local
  `charge.refunded`). **Disputes: NOTHING anywhere** — no handler, no mock, no
  mention in any build.
- **Checked against real Stripe?** Yes (§B refund, §C dispute with a real
  `pm_card_createDispute` charge).
- **What real Stripe did:**
  - **Refund:** `charge.refunded` reversed the gift row + its ledger stamp —
    correct, unchanged.
  - **Dispute:** the drill confirmed Steward did **nothing** with a real
    dispute — the gift, ledger, and receipt sat untouched and **no staff
    signal existed**. A disputed gift is an ordinary nonprofit event with a
    Stripe response DEADLINE; silence loses the funds by default. **Fixed this
    build:** `charge.dispute.created/updated/closed` now handled —
    - *created* → the gift is FLAGGED (`gifts.disputed_at`/`dispute_status`)
      and a **high-priority staff task with the respond-by deadline** + a donor
      timeline note are created (LOUD, idempotent). NOT reversed — the money is
      only held and the org may win.
    - *closed / won* → flag → `won`, gift kept, funds-reinstated note.
    - *closed / lost* → reversed exactly like a full refund (receipt voided,
      ledger stamp + gift removed, donor total recalced).
  - Pinned by `tests/stripe-disputes.test.js` (driven by the RECORDED real
    dispute payload) + the live drill §C.
  - **Open follow-up (§worry):** the **year-end statement** and the **donor
    portal history** read live over the gift rows, so a lost dispute drops out
    of both automatically — but a statement ALREADY ISSUED for a prior year is
    frozen and won't self-correct if a dispute lands after year-end. Same class
    as the refund-after-statement gap; deferred, noted in FINDINGS.

## 4. Payouts / Connect account state — DRILLED (partial)

- **Mock defined it?** `finance-reintegration` asserts the disconnected shape;
  the connected balance/payout leg was gated on creds and never run.
- **Checked against real Stripe?** Yes (§D) — `/finance/stripe-summary` against
  a real charges-enabled account AND a real restricted (bare) account.
- **What real Stripe did:** the enabled account returned a real balance object;
  the restricted account degraded gracefully (200, the "connect Stripe" prompt
  shape) — **never a 500**. Payout↔gift reconciliation remains deliberately
  unbuilt (documented non-goal since BUILD-09).

## 5. Webhook signature verification, replay, out-of-order — DRILLED

- **Mock defined it?** Local suites self-sign with `whsec_localtest`.
- **Checked against real Stripe?** Yes — every drill event this build was a
  REAL signed webhook through `stripe listen`; BUILD-57 §2a covered the
  subscription family; the dispute suite exercises replay (redelivery →
  idempotent, no second task) and out-of-order (created after a closed shape
  converges on status).
- **What real Stripe did:** `stripe.webhooks.constructEvent` verified every
  real signature; the donation webhook (`/stripe/webhook`), the platform
  billing webhook (`/billing/webhook`, `billingStripe.webhooks.constructEvent`)
  and the Resend webhook (`/resend/webhook`, Svix-verified) all reject an
  unsigned/mis-signed body with 400. **Not re-drilled:** `/billing/webhook`'s
  full subscription lifecycle against real Stripe (see §worry — it still rests
  on mock-era assumptions of the same vintage that produced the §2a bugs).

## 6. Email delivery (Resend) — NOT drilled against real Resend

- **Mock defined it?** Yes — every suite points `RESEND_BASE_URL` at a local
  sink that always 200s; hard-vs-soft bounce and complaint handling are modeled
  only by directly inserting `email_suppressions` rows.
- **Checked against the real service?** **No.** The `/resend/webhook` handler
  (Svix-verified `email.bounced`/`email.complained` → global suppression) has
  never received a real Resend delivery event, and no real send has been
  observed bouncing.
- **What the real service did:** unknown for the bounce/complaint path. The
  happy-path real send IS proven historically (prod receipt/reset emails land),
  but the failure surface — a hard bounce suppressing globally, a provider
  rejection queuing for retry (F-2) — is untested end-to-end against Resend.
  → **`BLOCKED-resend-webhook-drill.md`** (needs a Resend webhook secret + a
  triggered bounce to a `bounce@` seed address; ~10 min).

## 7. Object storage (Tigris SigV4 + DB fallback) — real happy path proven; real FAILURE not drilled

- **Mock defined it?** The DB-fallback path is what every scratch/CI run
  exercises (no S3 creds → `portal_assets` table). The S3 path is real code
  (hand-rolled SigV4 over fetch, `assetStore.js`).
- **Checked against the real service?** The real put/get/delete was verified
  live in BUILD-51 against the Railway `steward-portal-assets` bucket
  (Tigris). **Real FAILURE was not:** the "S3 put fails → fall back to DB +
  Sentry + `/health.dbFallbackRows`" branch has only ever run against a
  *simulated* failure (unbound endpoint / bad creds), never a real Tigris
  outage or a real 5xx mid-write.
- **What the real service did under failure:** unknown. The fallback is
  belt-and-braces and the health surface exists, but a real partial failure
  (e.g. SigV4 clock skew, a real 503) has not been observed.
  → **`BLOCKED-storage-failure-drill.md`** (needs a way to fault-inject the
  real bucket — revoke creds mid-run or point at a real-but-erroring endpoint).

---

## Summary — what is now real vs still mock-backed

| Boundary | Real-drilled this build | Finding | Status |
|---|---|---|---|
| Connect onboarding | ✅ §A | W-1 (approve on half-onboarded) | **fixed + pinned** |
| One-time gift + ledger | ✅ §B | W-3 holds on real path | confirmed |
| Refund | ✅ §B | correct | confirmed |
| Dispute / chargeback | ✅ §C | unhandled everywhere | **fixed + pinned** |
| Payout / account state | ✅ §D | graceful | confirmed |
| Webhook sig / replay / order | ✅ | verified | confirmed |
| Platform billing webhook lifecycle | ❌ | mock-era, undrilled | §worry |
| Email delivery (bounce/complaint) | ❌ | never real | `BLOCKED-resend-webhook-drill.md` |
| Object storage real failure | ❌ (happy path ✅) | never real | `BLOCKED-storage-failure-drill.md` |
| **Live-key** Stripe (real money) | ❌ by design | — | `BLOCKED-stripe-live-drill.md` (no real nonprofit approved until it runs) |
