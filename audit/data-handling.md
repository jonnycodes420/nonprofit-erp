# BUILD-37 — Data handling / PII statement (§10.5, §F6)

Honest inventory of what PII Steward stores, where, how it's protected, and who it's shared with. Source material for the privacy policy and Gmail-verification review — not legal advice.

## What PII is stored

| Data | Table(s) | Notes |
|------|----------|-------|
| Donor name, email, phone, address (city/state/zip) | `donors` | The core PII. Address used for the Donor Map + tax receipts. |
| Donor giving history (amounts, dates, campaigns) | `gifts`, `pledges`, `recurring_subscriptions` | Financial PII. |
| Donor interactions / notes / touchpoints | `interactions`, `donor_materials` | Free-text; may contain sensitive relationship notes. Gmail-synced email metadata (subject/from/to) in `interactions.metadata`. |
| Tax receipts (name, address, amount, EIN of org) | `receipts` | Frozen PDF + JSON snapshot per issued receipt. |
| Staff/user accounts | `users` | email, bcrypt(12) password hash, name, role. |
| Org billing identifiers | `orgs` | Stripe customer ids; no card data (Stripe holds that). |
| OAuth tokens (Gmail) | `gmail_connections` | access/refresh tokens **stored in plaintext columns**. |
| Password reset / invite tokens | `password_reset_tokens`, `invites` | short-lived, single-use. |

## How it's protected

- **In transit:** HTTPS to the API (Railway) and frontend (Vercel). **Note:** the app→DB connection sets `ssl.rejectUnauthorized:false` — encrypted but **cert-unverified** (FINDINGS DB-TLS, P3).
- **At rest:** Supabase/Postgres provider disk encryption only. **No application-level column encryption** on donor email/address or on the Gmail OAuth tokens. This is a defensible choice for this stage, but it must be a *stated* one — a customer will ask, and the Gmail tokens in particular are high-value plaintext secrets. (FINDINGS §F6.)
- **Access control:** app-layer `WHERE org_id = ?` on a privileged direct DB connection; **no RLS** (see `service-role.md`, FINDINGS B4/B5).
- **Auth tokens:** JWT in browser `localStorage` (not an HttpOnly cookie) — readable by any XSS on the app origin. 7-day expiry; privileged-route revocation added this pass (FINDINGS A5), but non-admin read sessions and password-reset still don't revoke existing tokens (`BLOCKED-session-revocation.md`).

## Who it's shared with (sub-processors)

| Processor | What it receives | Purpose |
|-----------|------------------|---------|
| **Stripe** (Connect + platform billing) | donor name/email/amount (donations); org billing | payment processing |
| **Resend** | recipient email + rendered email HTML (may contain donor name/amount) | transactional + campaign email |
| **Supabase** | everything (the database) | data store |
| **Railway / Vercel** | request/response data in transit; server logs | hosting |
| **Anthropic** | donor context assembled for AI drafting (names, giving summaries) — capped to top-60 donors by `buildContext` | AI drafting features |
| **OpenAI** | audio only, if voice memos re-enabled (currently shelved) | Whisper transcription |
| **Sentry** (if `SENTRY_DSN` set) | error events — **verify scrubbing**; error context can carry request bodies incl. donor PII (FINDINGS §F3, not deeply audited this pass) |
| **Google (Gmail API)** | OAuth-scoped mailbox access per connected user | email sync/send |

## Recommendations (stated, not yet done)

1. Encrypt the **Gmail OAuth tokens** at rest (application-level) — highest-value plaintext secret in the DB.
2. Confirm **Sentry PII scrubbing** is configured (§F3) before relying on it in prod with real donor data.
3. State the "provider-disk-encryption-only, no column encryption" position explicitly in the privacy policy.
4. Verify the DB TLS cert (`rejectUnauthorized:true`).
