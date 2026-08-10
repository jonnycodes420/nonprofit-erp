# BUILD-49 — Public-signup exposure (report, not a fix)

**Date:** 2026-08-09
**Decision owner:** Jonathan (this is being reopened knowingly; this file exists so it is written down).

BUILD-49 reopens public self-serve signup (BUILD-39 had de-linked it; the route
and backend were never removed). With signup live again, **any stranger can
create an organization and immediately begin loading donor PII** — no invite, no
email verification, no payment, no manual approval. This file enumerates every
place a new org can be created and what data that org can then hold.

## 1. Every path that creates a new org

| Path | Auth | Gate | Notes |
|---|---|---|---|
| `POST /auth/register-org` (`server.js:1758`) | **public** | `registerLimiter` (rate limit only) | The signup form's target (`SignupPage.jsx`). Creates a `trial` org + an `admin` user, 30-day trial, starts the onboarding email drip, provisions workflows. **No email verification.** |
| `POST /auth/register` (`server.js:1621`) | **public** | `registerLimiter` only | Older self-serve route, still mounted. Also inserts an `orgs` row + admin user. No Stripe customer, no email verification. |

Both routes accept an arbitrary `email` (regex-validated for shape only, never
confirmed to be reachable/owned) and an 8+ char password, and return a live JWT
immediately. There is **no CAPTCHA, no email-confirmation step, and no human
approval** between "stranger submits the form" and "org exists with an admin
session." `registerLimiter` throttles volume; it does not establish identity.

Related (does **not** create a new org, listed for completeness):
`POST /auth/invite/accept` creates a *user inside an existing* org.

## 2. What data a brand-new org can hold

Once an org exists, its admin can immediately create/import the following. This
is the donor-PII surface a stranger gains a container for:

- **Donors** (`donors`) — full name, email, mailing address (`city/state/zip`),
  giving tier/stage, lifetime giving, last-gift date/amount, free-form `notes`,
  `tags`, wealth score + capacity tier + score rationale, relationship-owner
  assignment, planned-giving flags. Bulk CSV import (`/donors/import`,
  `/donors/import-combined`, `/gifts/import-history`) can load **thousands of
  donor records in one pass** (tested to 25,000 donors / 200,000 gifts per org).
- **Custom fields** (`custom_fields` / `custom_field_values`) — arbitrary
  additional PII columns the org defines (e.g. "Board Connection", "Alma Mater").
- **Gifts** (`gifts`) — amounts, dates, campaign/fund attribution, payment method.
- **Interactions** (`interactions`) — call/meeting/email notes; **Gmail sync
  (`gmail_connections`) stores the org's OAuth access + refresh tokens and syncs
  real email subjects/snippets/bodies** into `interactions.metadata`.
- **Receipts / tax settings** (`receipts`, `orgs.legal_name/ein/receipt_address`)
  — the org's EIN, legal name, and address, plus generated PDF receipts.
- **Payments config** (`orgs.stripe_account_id`) — a Stripe Connect account can
  be linked, at which point real donor card charges flow through the org.
- **Recurring donor card data health** (`recurring_subscriptions`,
  `donors.stripe_customer_id`) — subscription state used for failed-card recovery.
- **Peer-to-peer supporters** (`peer_fundraisers`) — supporter names/emails.

Net: **a stranger can stand up an org and load an entire nonprofit's donor
database, including addresses, giving history, wealth scoring, and synced Gmail
content, with a single unverified email address.**

## 3. Known, still-open risk factors (unchanged by this build)

These are pre-existing and were explicitly called out in the BUILD-49 brief as
"report, do not fix":

1. **No `DELETE /users/:id` route exists.** A user (and therefore the person
   behind a self-created org) cannot be removed through the product. Manual
   Supabase row deletion has previously caused dangling-FK incidents
   (see `BLOCKED-demo-org-officers.md`). There is a `DELETE /admin/orgs/:id`
   super-admin cascade for whole orgs, but no per-user deletion and no
   self-service account/data deletion.
2. **The outside application-security review is still pending** (see
   `SECURITY_REPORT.md`; several §1 org-scoping edge cases and the JWT
   algorithm-pinning hardening remain unverified/open).
3. **No email verification** on either register route — an org can be created
   under an address the creator does not control.
4. **ToS / Privacy have had no attorney pass.** `/terms` and `/privacy` are
   linked from signup ("By signing up you agree to our Terms…") but the legal
   copy has not been reviewed by counsel. Same caveat applies to receipt/tax
   legal copy (already flagged in the tax-receipting section of CLAUDE.md).

## 4. Not changed by BUILD-49

No hardening was added here — this build is the copy/funnel reopening, not a
security pass. The mitigations that would reduce this exposure (email
verification, a `DELETE /users/:id` + self-service data deletion, the pending
app-sec review, an attorney pass on ToS/privacy) are each their own deliberate
follow-up. This file is the written record that reopening signup was a knowing
decision made with these gaps open.
