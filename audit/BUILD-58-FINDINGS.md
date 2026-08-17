# BUILD-58 — silent failures and the boundary audit

Run on auto, 2026-08-16→17. Every part landed in order through the full gate.
The through-line: each fix closes an INSTANCE **and** the CLASS behind it, and
each class is pinned by a test that bites (planted violation → red).

Verify-first red committed at `audit/build58-verify-first-red.txt` (57 failing
asserts against the pre-58 server); every one is green at the end with no
assertion loosened.

## Part 1 — the three walk wounds

### W-3 — chart of accounts, and the loud-ledger class
**Instance:** an org born through the REAL signup paths had no chart of
accounts, so every gift→ledger stamp silently no-op'd (`/network/signup` never
ran `seedOrgData`; the others only got a chart when `/onboarding/complete`
happened to run). **Class:** a financial write must never land nowhere and
return success. `ensureOrgLedger(orgId, {heal})` is now the ONE
provisioning + stamp-target helper — advisory-locked, self-heals a chartless
org on the spot, and says so LOUDLY (CRITICAL log + Sentry +
`/health.ledger.chartSelfHeals`). All three org-creation paths provision at
birth; all six stamp sites (webhook, gift route, both imports, grant award,
event attendee) resolve accounts through the helper (the per-site `'4010'`
probes are gone — pinned: the probe lives in exactly one place).
**Prod check (read-only first):** the only chartless prod orgs are five
throwaway test orgs (incl. "Go-Live Test Shelter (DELETE ME)"). No real org
damaged; no prod repair performed. `tests/ledger-provisioning.test.js` (25).

### W-4 — transactional mail, and the log-that-lies class
**Instance:** the failed-card recovery email honored the MARKETING suppression
list (an unsubscribed donor got no card-recovery mail) yet logged
`dunning_sent` anyway. **Class 1 — suppressibility decided in ONE place:**
`DONOR_MAIL_POLICY` classifies every donor-facing mail kind
transactional|marketing; `donorMailDecision` is the only caller of the raw
suppression probe (pinned by source scan). Transactional (dunning, recovery
thank-you, receipts, year-end, recurring changes/proposals) never consults the
marketing list; marketing (campaigns, sequences, workflow recipes, milestones,
pledge reminders, onboarding drip) does. New donor flags: `deceased` blocks
ALL mail, `do_not_contact` blocks marketing (OR'd on merge, mapped on import,
badged on the profile). **Class 2 — no log records an unsent send:**
`dunning_sent` logs only after real delivery (provider failure → retry next
tick, nothing logged; permanent refusal → `dunning_skipped`); the sequence
"Sequence: …" interaction + step advance only after delivery; workflow
`actions_taken` records `sent:true/false`; the proposal timeline note says
FAILED when delivery failed. Receipts + campaign bookkeeping audited —
already honest. W-5 (proposal subject doubled the org name) fixed in passing.
`tests/mail-suppression.test.js` (31). Attorney-line flagged in
`BLOCKED-build58.md`.

### W-2 — dead-end first logins, and the tier×state matrix
**Instance:** an approved portal-tier org's first login was an error-styled
"Failed to connect" with no path to the tier's own capabilities. **Fix:** the
initial load is `allSettled` (portal_tier 403s are expected, never an outage);
a `PORTAL_TIER_TABS` shell (Donors · Donor Portal · Settings) lands on the
portal hub; the network-application status renders as a quiet banner.
**Class:** `tests/first-login-matrix.test.js` (91) is a data table — every
tier × approval × onboarding combination asserted to a live, non-error
surface, and a plan literal in the tier authority without a row FAILS the
suite. **Also:** the give page (and the transactional email family) render the
white-label `portal_settings.display_name`, never the staff-side "(Demo)"
name. Verified live: `docs/build58/w2-portal-first-login.png`.

## Part 2 — import never discards input without saying so

Instance fixes (BUILD-57 hostile-import catalogue, first-week triage):
deceased/do-not-contact columns are first-class (mapped, stored, honored,
badged); "Donor Email" (+ Contact/Primary/Billing Email) is recognized so
Import-both links by EMAIL not the history-splitting name fallback; the
Recommended menu entry opens the magical DonorImport (the legacy one-sheet
CombinedImport is deleted); `externalId` rides every Import-both gift;
windows-1252 CSVs decode correctly (no mojibake); negative/refund + unparsable
+ zero rows are counted with reasons. **The class:** `classifyColumns` — every
column is mapped, deliberately ignored, or unrecognized, and the summary
reports all three BY NAME on the result screen (single-sheet + Import-both).
`tests/import-columns.test.js` (48). Verified live with a hostile 1252 CSV
through the Recommended path: `docs/build58/p2-import-result.png` (11/11).

## Part 3 — the boundary audit

`scripts/build58-stripe-drill.js` drills every Stripe boundary against REAL
test mode (21/21). Full three-question table:
`docs/build58/boundaries/DIFFERENCES.md`.
- **W-1 (Connect onboarding):** the approval gate + auto-delist sweep asked our
  `stripe_connected` flag (set at link creation) instead of Stripe.
  **Fixed** — they call `stripeChargesEnabled()` LIVE (fail-safe on an
  unreachable Stripe). A real bare account is refused; passes once real
  test-KYC enables charges.
- **DISPUTES were unhandled everywhere** — the drill's headline finding.
  **Fixed** — `charge.dispute.created` flags the gift + a LOUD staff task with
  the respond-by deadline (money only held, not reversed); closed/won keeps it;
  closed/lost reverses like a full refund. `gifts.disputed_at/dispute_status`.
- **The property:** `tests/fixtures/external/` holds only RECORDED real
  payloads, each with a `_provenance` stamp; `external-fixture-provenance`
  rejects a hand-authored external fixture. `stripe-disputes.test.js` is driven
  by the recorded real dispute payload (created/won/lost + replay).
- Never-drilled boundaries named as such: `BLOCKED-resend-webhook-drill.md`,
  `BLOCKED-storage-failure-drill.md`; live-key drill stays
  `BLOCKED-stripe-live-drill.md`.

## Coda — project memory

- **`BUILD-53-staff-recurring.md`** — confirmed still non-existent (already
  documented by BUILD-57 / `BLOCKED-build57.md` as never delivered).
- **`BUILD-54-donor-experience.md`** — **does not exist anywhere**, and is
  referenced by nothing except the BUILD-58 brief that named it for this check.
  Same class as BUILD-53: a handoff spec name that was never a committed file.
  The actual BUILD-54 work lives in `audit/BUILD-54-FINDINGS.md` (exists) +
  CLAUDE.md — no content is missing, only the named spec file.
- Every other referenced file resolves: all 14 `BLOCKED-*.md` named in
  CLAUDE.md/audit exist; all 15 `audit/*` refs in CLAUDE.md exist; every
  `scripts/*.js` in run-all exists.

---

## §worry — what I would not bet on

1. **The platform billing webhook (`/billing/webhook`) is still mock-era and
   undrilled.** Part 3 drilled the DONATION Stripe boundary hard, but the
   platform-subscription lifecycle (checkout→active, cancel→downgrade, the
   mode-mismatch classifier) rests on assumptions of the same vintage that
   produced BUILD-57's seven §2a bugs. It has never seen a real subscription
   event. That is the next boundary I'd drill.

2. **Dispute handling is new and lightly seasoned.** The lifecycle is pinned
   against ONE recorded real `charge.dispute.created` payload; the WON/LOST
   *closed* shapes in the suite are that payload with `status` overwritten, not
   independently recorded real closed events. Real closed-dispute payloads may
   carry fields (`funds_reinstated`, `network_reason_code`) the handler
   ignores. And a **dispute that lands AFTER a year-end statement is issued**
   won't retro-correct the frozen statement — same class as the refund-after-
   statement gap, deferred. If disputes are common for a pilot, record the real
   closed events next.

3. **Email delivery failure is entirely untested against real Resend.** The
   whole bounce/complaint → global-suppression path (and the W-4 policy's
   dependence on `bounced` vs `unsubscribed` being set correctly) has only ever
   run against locally-inserted rows. `BLOCKED-resend-webhook-drill.md` is ten
   minutes that converts this from argument to evidence.

4. **Object storage degrades correctly only in theory.** Real put/get/delete
   is proven; the real FAILURE fallback (S3 down → DB + Sentry +
   `dbFallbackRows`) has only met a simulated failure. A real Tigris 5xx or
   SigV4 skew mid-write is unobserved (`BLOCKED-storage-failure-drill.md`).

5. **The `thisWeek` clock flake is real and will bite CI depending on when a
   push lands.** `state-diff`/`state-diff2`/`home` fail their
   `fundraising.thisWeek.*` asserts in the UTC-vs-local week-rollover window
   (documented in CLAUDE.md; hit locally on this Sunday-night run). It is not a
   code bug and none of BUILD-58's changes touch week computation — but it
   means a red CI run on those suites should be checked against the clock
   before it's blamed on a diff.

6. **W-1's live Stripe check adds a real API call to the approval path.** If
   Stripe is slow/unreachable at approval time the gate refuses (correct, but
   the human must retry) — and the auto-delist sweep now makes a Stripe call
   per approved org every 6h. At a handful of orgs this is nothing; it's a
   real per-org network dependency to remember as the network grows.
