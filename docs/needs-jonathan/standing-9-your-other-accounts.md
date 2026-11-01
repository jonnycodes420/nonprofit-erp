## 9 · Your other accounts

- **Resend → Suppressions → Add:** `hello@justinsplaceky.com`. The code already
  refuses it everywhere (`mailBlock.js`); this is the provider-side copy. The
  production sending key is send-only (correctly), so the API refused the
  add with `restricted_api_key` on 2026-09-24.
- **Resend:** confirm inbound parsing is available on the current plan. Resend is
  the chosen inbound provider (already a subprocessor, so the disclosure does not
  grow by a name). Then add MX on a **third** subdomain — `log.stewardapp.dev` —
  touching neither the root Microsoft 365 MX nor `send.stewardapp.dev`, and set
  `INBOUND_EMAIL_ENABLED=1`, `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET`.
- **Resend:** the real delivery-event drill (~10 min) — send one message to a
  seeded bounce address and confirm the webhook records it.
- **UptimeRobot:** add keyword alerts on `reconciliation.unrecordedCharges`,
  `reconciliation.accountsErrored` and `webhookSubscriptions.missingCount` being
  non-zero, beside the existing `themeAssets.dbFallbackRows` watch.
- **Object storage:** the real failure drill (~10 min) — inject one fault and
  confirm the product degrades to the monogram band rather than breaking.
- **Confirm the reconciliation guard can see production.** `/health.reconciliation`
  currently reports every field `null` with `accountsChecked: null`, so it is
  blind and `unrecordedCharges: 0` is not a clean bill. If `accountsErrored > 0`
  once ticks are back on, the donation `STRIPE_SECRET_KEY` is a restricted key
  without connected-account **charge** read, and needs widening.
