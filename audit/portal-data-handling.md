# BUILD-45 — Donor portal data handling

What the donor-facing surface exposes, to whom, under what auth — matched
against `audit/data-handling.md` (the staff-side inventory). Source material
for the attorney review and the external app-sec review (see FINDINGS §10
note: this build ADDS an unauthenticated public surface + donor self-serve
money mutations to that review's scope).

## Identity model

- A portal identity is **(org, email)** — never a donor id, never a password.
  Sessions come only from a magic link sent to an address that exact-matches
  a live donor record in THAT org. Multiple donor records with one email all
  belong to the session (P-6); records in other orgs never do (a session is
  org-pinned; the same email in two orgs = two entirely independent sessions).
- Tokens at rest are SHA-256 hashes only (`portal_magic_links.token_hash`,
  `portal_sessions.token_hash`). A database leak does not leak a live link
  or session. Magic links: 256-bit CSPRNG, 15-minute expiry, single-use
  (atomic consume), invalidated by re-request. Sessions: 30-day expiry,
  revocable (logout, or org disabling the portal kills all access — tested).

## What a signed-in donor can READ (their own records only)

| Data | Source | Notes |
|---|---|---|
| Own gift history (date, amount, type, campaign/fund NAME) | `gifts` + name joins | Only rows whose donor_id matches an exact-email donor record in the session org. Campaign/fund names are org-authored public-ish labels. |
| Giving totals (YTD, per-year, lifetime, first/largest) | live SUM over the same rows | No parallel computation — same ledger the CRM reads (tested equal). |
| Own tax receipts (list + stored PDF bytes) | `receipts` | Streams the EXISTING `pdf_data`; never regenerated, never a guessable URL — session + donor-ownership checked (S-9 tested). The PDF contains the org's legal name/EIN/address + the donor's own name/gift facts. |
| Own recurring schedules (amount, interval, status, next charge, card LAST-4) | `recurring_subscriptions` + Stripe retrieve | Last-4 is display-only, fetched from Stripe at read time, never stored by Steward. |
| Own open pledges with paid/balance | `pledges` + linked gifts | Honest partial balances (F-5). |
| Household combined total | derived SUM | A SEPARATE labeled section; never mixed into own totals; no other member's name or itemized gifts are exposed — only the household name + combined figure. |
| Impact updates | `impact_updates` | Org-authored content targeted at funds/campaigns the donor gave to in 24 months, or org-wide. Contains no donor data. |

## What a signed-in donor can WRITE

| Action | Guard rails |
|---|---|
| Pause / resume / cancel / change amount on OWN recurring gift | ownership by email-match → foreign id 404; Stripe-first (failure = mutation fails); per-sub advisory lock; server-authoritative amounts (integer minor units, org minimum); rate-limited |
| Update payment method | redirects into the EXISTING setup-mode Stripe Checkout — card data (PAN/CVC) never touches Steward, unchanged from the recovery flow |
| "Viewed impact update" signal | writes a low-priority timeline interaction only |
| New gift (R-6) | the portal LINKS to the existing public giving page with email prefilled — no new payment surface; D11 protections are the giving page's existing ones |

## What flows OUT of the portal into the CRM

- `portal_audit_log`: every link request (incl. unmatched-email attempts,
  flagged `matched:false`), session create, dashboard view, receipt download,
  and money mutation — donor id, org, IP, action, meta. Staff read it via
  `GET /portal-audit` (admin). Retention: append-only, no purge job yet —
  flag for the attorney (IP + email retention policy).
- Donor timeline (`interactions`, type note + metadata.portal_event): sign-in,
  impact views, every recurring mutation. Low-priority; never alerts except:
- Cancel/pause → high-priority officer alert (email via the existing
  notification pipeline + due-today task) with donor name, amount, optional
  donor-entered reason (cap 500 chars — donor free text shown to staff; the
  staff UI renders it as text, not HTML).

## What the portal NEVER exposes

- Another donor's anything (differential sweep: foreign gifts/receipts/subs/
  impact ids → 404; other org's slug → 401 — all tested).
- Staff data, wealth scores, stage, notes, tags, tasks, officer assignments —
  the dashboard payload is built from an explicit field list; `donors.notes`,
  `wealth_score`, `score_rationale`, `stage` etc. are never selected into it.
- Card numbers (only Stripe-held; last-4 display only), bank data, passwords
  (none exist).
- Steward branding (unless the org opts in) — and no gamification: no tiers,
  badges, leaderboards, or streak claims anywhere.

## Org-authored content shown to donors (stored-XSS surface, S-6)

`portal_settings` (display name, footer, EIN line, contact) and
`impact_updates` (title, body, photos) are authenticated-staff input rendered
to donors. Server stores them verbatim (length-capped, images mime/size
validated); the portal client is React with NO `dangerouslySetInnerHTML`
anywhere in `client/src/pages/Portal.jsx` (grep-verified), so org-authored
strings render as text. The magic-link/confirmation EMAILS interpolate org
content HTML-escaped (`escHtmlWf`). Donor-authored free text (cancel reason)
travels the same escaped path into staff email and as plain text into tasks/
timeline.

## Logging discipline (S-7)

Portal server paths log only error `.message` strings — never email
addresses, tokens, or card data (grep-verified over the portal module).
Audit PII (email, IP) lives in the org-scoped `portal_audit_log` table, not
in process logs or the error pipeline.

---

# Network section (BUILD-46, 2026-08-12) — global donor accounts & the giving network

## What the dashboard aggregates (and how)
A donor account (`donor_accounts`, GLOBAL — no org_id) aggregates, at READ
time only, the per-org ledgers of the donor records it is linked to: YTD/
lifetime totals, per-org cards, unified recurring list, per-year tax totals,
merged impact feed. **No cross-org rollup is ever stored** — there is no
table an org-side query could reach that contains another org's figures.
Dashboard reads filter to orgs that are portal-enabled AND `network_listed`.

## The org-blindness wall
An org may never see across orgs. Enforced structurally (account tables are
global and joined only in /account/* handlers; no org-side route reads them)
and tested as BYTE-EQUALITY: `tests/org-blindness.test.js` captures a battery
of Org-A staff responses (profile, lists, search, CSV export, reports, portal
audit, recurring) before any account exists and again after the donor has an
account linked to two orgs and has used every dashboard surface — the bodies
must be identical, and no Org-A body may contain any Org-B marker or any
account-table artifact. The org-side notification pipeline is asserted
untouched. Org A's view of its donor is the same whether or not that donor
has a dashboard account or other linked orgs.

## Identity linking
Links are created ONLY by exact match on a VERIFIED email (signup
verification, verified alias, or magic-link receipt — all proof of control of
that inbox). Never name/address/fuzzy — wrong-linking would show one person
another person's giving. Alias verification tokens are single-use,
hash-at-rest, 60-minute, and a verified email is globally unique across
accounts (partial unique index) — one email can never be claimed twice.

## Unlink semantics
Donor-initiated, immediate, audit-rowed (`donor_account_audit`, global —
never surfaced to any org). Unlinking hides the org from every dashboard
surface; it does not delete or alter the org's own donor record, and the
idempotent link job never silently re-links an unlinked row. Relink is an
explicit donor action.

## Deletion
Donor deletes account → the account row, aliases, links, and reset tokens are
deleted (CASCADE) and the audit trail sheds the email (actions retained,
PII gone). **Each organization's own records of its donors are unaffected —
their data about their donor is theirs.** That sentence appears verbatim in
the donor-facing copy.

## The network gate (who becomes donor-visible)
Self-serve orgs (Portal tier) are invisible and un-giftable until: EIN
verified live against the IRS Pub 78 snapshot (`ein_registry`, refreshed
monthly by scripts/load-irs-ein-registry.js) + Stripe Connect onboarding
complete (gifts settle only in the org's own verified account) + a HUMAN
approves in the admin review queue (nothing auto-approves). Approved orgs are
re-checked by a 6-hour sweep and auto-delisted (listing off, new gifts
blocked, portal stays up for existing donors, admin alerted) if their EIN
drops/revokes or Stripe disconnects. Every decision — including refused
approvals and system delistings — is appended to the application's decision
log. A second signup on a claimed EIN becomes a dispute-queue entry that
cannot touch the existing holder's listing.

## Feature flags (launch posture)
`DONOR_ACCOUNTS_ENABLED` and `NETWORK_SIGNUP_ENABLED` are UNSET in prod:
every surface in this section 404s (indistinguishable from nonexistent) and
sessions carry no account stamp — prod behavior is byte-identical to
BUILD-45 until a deliberate launch flips the flags.
