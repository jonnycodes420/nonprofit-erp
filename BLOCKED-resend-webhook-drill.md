# BLOCKED — the real Resend delivery-event drill (Jonathan, ~10 minutes)

The boundary audit (BUILD-58 Part 3, `docs/build58/boundaries/DIFFERENCES.md`
§6) found the **email-delivery failure surface has never been checked against
real Resend.** The happy path is proven (prod receipts/reset emails land); the
bounce/complaint path — `/resend/webhook` (Svix-verified) →
`email_suppressions` global suppression → sequence-enrollment `bounced` — has
only ever run against locally-inserted suppression rows and a sink that always
200s. This is the same "the mock is the spec" risk BUILD-57 §2a caught with
Stripe.

## Before you start (dashboard only, 3 min)
1. Resend dashboard → Webhooks → add an endpoint at
   `https://nonprofit-erp-production.up.railway.app/resend/webhook`.
2. Subscribe it to `email.bounced` and `email.complained`.
3. Copy the endpoint's **signing secret** and set `RESEND_WEBHOOK_SECRET` on
   the Railway service (the handler 503s until it's set — that's the guard).

## The drill (7 min)
1. Trigger a real send to Resend's **hard-bounce test address**
   `bounce@resend.dev` — e.g. register a throwaway prod org with that address,
   or send it a receipt. Resend accepts the send, then emits `email.bounced`.
2. Watch: within a minute the real `email.bounced` webhook should hit
   `/resend/webhook`, verify its Svix signature, and insert a **global**
   (`org_id IS NULL`) `email_suppressions` row with reason `bounced`.
   - Check: `GET /health` is unaffected; query prod
     `SELECT * FROM email_suppressions WHERE email='bounce@resend.dev'` — one
     global row, reason `bounced`.
3. Repeat with the **complaint** test address `complained@resend.dev` → a
   `complained` global suppression row.
4. Confirm a subsequent MARKETING send to that address is suppressed and a
   TRANSACTIONAL one (a receipt) is NOT (BUILD-58 W-4: a hard bounce blocks
   both — a bounced address can't receive anything — but a complaint/marketing
   suppression only blocks marketing). The `donorMailDecision` policy already
   encodes this; the drill confirms the real bounce actually lands as
   `bounced` (deliverability) vs `unsubscribed` (marketing).

## What to report back
- Did the real Svix signature verify (no 400)?
- Did the bounce/complaint create the expected global suppression rows?
- One-line: does the real Resend payload's `type`/`data.email` shape match
  what `/resend/webhook` reads (`event.type`, `event.data.to`/`.email`)? If it
  diverges, that's a finding — record the real payload into
  `tests/fixtures/external/` (add a `_provenance` block) so it pins the shape.
