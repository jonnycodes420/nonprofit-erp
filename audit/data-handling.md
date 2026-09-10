# BUILD-37 — Data handling / PII statement (§10.5, §F6)

Honest inventory of what PII Steward stores, where, how it's protected, and who it's shared with. Source material for the privacy policy and Gmail-verification review — not legal advice.

## What PII is stored

| Data | Table(s) | Notes |
|------|----------|-------|
| Donor name, email, phone, address (city/state/zip) | `donors` | The core PII. Address used for the Donor Map + tax receipts. |
| Donor coordinates (latitude/longitude) | `donors` | Derived from the address by the geocoding provider below. Stored so the map never re-sends an address it has already resolved. |
| Contact person on an organization's record | `donors.contact_name` | A named human at a foundation, church, business or fund. |
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
| **Geocoding provider** (see below) | a donor's postal address — street, city, state/province, ZIP, country. **Never** the donor's name, email, phone, giving history, or any Steward identifier | turning an address into map coordinates |

## Geocoding — what is sent, and what is retained (BUILD-84, 2026-09-10)

The Donors → Map tab plots donors geographically. Turning a postal address into
coordinates requires a geocoding service; that is the one place a donor's
address leaves Steward's own infrastructure.

**What used to happen, and why it was replaced.** Until this build the map
geocoded **in the staff member's browser, at render time, on every page view**,
against the **public Nominatim instance** operated by the OpenStreetMap
Foundation — one HTTP request per donor, nothing cached, nothing stored. That
meant a donor's home address was transmitted to a third party every time
anyone opened the map, and it did not honour that instance's usage policy
(which requires an identifying User-Agent, requires results be cached by the
caller, and forbids systematic bulk queries). It has been removed.

**What happens now.**

- Geocoding runs **once, at write time, on Steward's own server** — when an
  import completes and when a donor's address is edited. It never runs on a
  read, and the map itself makes **zero** requests to any geocoder.
- **What is sent:** the address fields only — street, second address line,
  city, state/province, postal code, country. The request carries no donor
  name, no email, no phone number, no giving history and no Steward record id.
- **What is retained by Steward:** the returned latitude and longitude, the
  time of the lookup, the provider's name, the outcome (`ok`, `not_found`,
  `failed`, `no_address`), and a normalised copy of the address the
  coordinates belong to.
- **How often an address is sent:** once per distinct address. A record whose
  address has not changed is never looked up again — the stored address key is
  compared before any request is made — and donors sharing an address are one
  lookup, not many. This is the caching requirement satisfied by construction.
- **Identification:** every request carries an identifying User-Agent naming
  Steward and a contact address.
- **Retention by the provider:** governed by the provider's own terms; see
  below. Steward does not ask any provider to store anything on its behalf.

**Provider: Geocodio** (geocod.io), chosen 10 September 2026. US and Canada
only, which matches the customer base. Addresses are sent in batches of up to
1,000 per request.

The provider is selected by environment variable and there is a deliberate
third state — **not configured** — in which the job does not run, no address
leaves the server at all, and the map says so in a sentence rather than
degrading silently.

| Setting | Provider | Notes |
|---|---|---|
| `GEOCODIO_API_KEY` set | **Geocodio** — the production configuration | US and Canada only. Batched: one request per 1,000 addresses. |
| `GEOCODE_NOMINATIM_BASE` set | **A self-hosted Nominatim instance** | The address never leaves infrastructure the operator controls. Available, not in use. |
| neither set | **none** | No address is transmitted anywhere. The map renders and states that geocoding is not set up. |

The **public** Nominatim instance is refused by hostname in code
(`geocode.js`), not by convention: it is not an option for a commercial
product at this shape, and leaving the door open would put the terms problem
one environment variable away.

**What it costs, and in what unit.** The billable unit is a distinct *address*,
not a donor, and only a new or changed one — the queue de-duplicates before
spending anything and never re-resolves an address it already holds. Geocodio
gives 2,500 lookups free every day and charges $1.00 per 1,000 above that
(1 February 2026 pricing). A measured 444-donor import resolved 408 distinct
addresses and cost nothing; a 25,000-address first import is $22.50 in a single
day, or nothing if the backfill is allowed to spread across ten. A
steady-state organization spends nothing at all.

**Geocodio's own retention** is governed by their terms and privacy policy, not
by Steward. Steward does not ask them to store anything on its behalf.

## Recommendations (stated, not yet done)

1. Encrypt the **Gmail OAuth tokens** at rest (application-level) — highest-value plaintext secret in the DB.
2. Confirm **Sentry PII scrubbing** is configured (§F3) before relying on it in prod with real donor data.
3. State the "provider-disk-encryption-only, no column encryption" position explicitly in the privacy policy.
4. Verify the DB TLS cert (`rejectUnauthorized:true`).
