# BUILD-25 Part A — workflow recipe artifacts (2026-07-29)

Real bytes captured by driving the local scratch server through the same paths as
`tests/workflows-e2e.test.js` (mail redirected to a local sink — nothing sent).

- **donor-thankyou-email.html** — the `new_donor_welcome` thank-you sent to a donor
  on their genuine first gift. Carries the org branding header AND the CAN-SPAM
  postal footer (legal name + address) + unsubscribe link (it's donor mail).
- **donor-recovery-email.html** — the `failed_recurring_recovery` card-update email,
  sent to the donor when a recurring charge fails (real `invoice.payment_failed`
  webhook). Branded + CAN-SPAM footer + a signed `/recurring/update-card` link.
- **internal-alert-email.html** — the `instant_gift_thanks` alert to staff (the ED).
  Branded header but deliberately NO unsubscribe/CAN-SPAM footer — it's internal
  staff mail, not donor mail.
- **run-log.json** — a populated run log: `GET /workflows/:id/runs` for the
  new-donor recipe, plus every `workflow_runs` row for the org (each with its
  `dedup_key` and `actions_taken`), matching what the Workflows tab renders.

PNG screenshots at deviceScaleFactor 3 were not rendered this pass: the connected
browser requires an interactive browser-selection step not available in an
autonomous run. The HTML files open in any browser; the authoritative verification
is `tests/workflows-e2e.test.js` (65 assertions, in the standard gate).
