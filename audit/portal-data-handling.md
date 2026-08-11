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
