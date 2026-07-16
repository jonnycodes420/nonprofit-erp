# Steward — Security Review (Multi-Tenant Isolation & Auth)
Generated 2026-07-10 as discovery-only. **Update 2026-07-16: all four CRITICALs
(C1–C4), the RBAC gap (§2), and the file upload gap (§7) were re-verified
against the current codebase and are all already fixed** — each has the
exact protection this report called for. This file was never updated to
reflect that at the time, so treat those sections as historical (what was
found, and where the fix landed) rather than an open punch list. The
remaining §1 org-scoping edge cases (`programs/:id/grants`, `gmail/send`→
`interactions`, `finance/transactions`) have **not** been re-verified and
should still be treated as open until checked.

---

## 🔴 CRITICAL — historical, now fixed (see note above)

### C1. `POST /donors/:id/custom-fields` — no donor-org check; value renders in the wrong org's UI
**RESOLVED** — `server.js:7550-7563` (`POST`) now validates `SELECT id FROM donors WHERE id=? AND org_id=?` before writing (404s otherwise); `server.js:7529-7548` (`GET`) now filters both `cfv.org_id=?` in the JOIN and `cf.org_id=?` in the WHERE. Re-verified 2026-07-16.
**File:** `server.js:4908-4919` (write) + `server.js:4887-4896` (read)

```js
// 4908 — no check that req.params.id (donor) belongs to req.user.orgId
app.post("/donors/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  const { fieldId, value } = req.body;
  await run(
    `INSERT INTO custom_field_values (id,org_id,donor_id,field_id,value,updated_at)
     VALUES (?,?,?,?,?,NOW()) ON CONFLICT (donor_id,field_id) DO UPDATE SET value=EXCLUDED.value`,
    [valId, req.user.orgId, req.params.id, fieldId, value]
  );
```
```js
// 4887 — read joins custom_field_values WITHOUT checking cfv.org_id
SELECT cf.id AS field_id, ..., cfv.value
FROM custom_fields cf
LEFT JOIN custom_field_values cfv ON cfv.field_id=cf.id AND cfv.donor_id=?
WHERE cf.org_id=?
```
Any authenticated user from **any** org can `POST` a `custom_field_values` row against a donor ID (and even a `field_id`) belonging to a completely different org — the write is only scoped by the *attacker's own* `org_id`, never validated against the target donor. Because the read-side JOIN never filters `cfv.org_id`, that planted value **will actually display in the victim org's own donor profile UI** the next time they load that donor. This is both an authorization bypass (write to a record you don't own) and a stored cross-tenant data-poisoning vector — the attacker doesn't even need to view the victim's data to corrupt it. Donor IDs (`d_` + 8 hex chars) aren't trivially guessable, but this is still a hole with no defense in depth: one leaked/observed ID (support ticket, browser history, referrer) is enough.

### C2. `PUT /events/:id` — cross-tenant read of full event + revenue/attendee data
**RESOLVED** — `server.js:8651-8675` now checks `affected.changes` and 404s if the org-scoped `UPDATE` matched zero rows, and the follow-up `SELECT` includes `AND e.org_id=$2`. Re-verified 2026-07-16.

**File (original finding):** `server.js:5642-5665`

```js
await run(`UPDATE events SET ... WHERE id=$12 AND org_id=$13`, [..., req.params.id, orgId]);
// no check on affected row count
const rows = await query(`
  SELECT e.*, COUNT(...) AS attendee_count, ..., COALESCE(SUM(ea.gift_amount),0) AS total_revenue
  FROM events e LEFT JOIN event_attendees ea ON ea.event_id=e.id
  WHERE e.id=$1 GROUP BY e.id           -- ← no org_id here at all
`, [req.params.id]);
res.json(rows[0] || {});
```
The `UPDATE` is correctly org-scoped and silently no-ops for another org's event (0 rows affected) — but the code never checks that, and the follow-up `SELECT` that builds the response has **no `org_id` filter whatsoever**. Any authenticated user of *any* org can call `PUT /events/:id` with an arbitrary/guessed event ID from a different org and receive that org's full event record back — name, date, location, description, capacity, status, cost, notes, plus `attendee_count`, `confirmed_count`, `no_show_count`, and `total_revenue`. This is the one place in the codebase that breaks the "check `affected.changes`, 404 if zero" pattern used correctly everywhere else (e.g. `donors`, `grants`, `volunteers`, `tasks`, `programs`).

### C3. `/billing/webhook` — raw body is destroyed by the global `express.json()`, so Stripe signature verification *always* fails
**RESOLVED** — the route was moved to `server.js:567`, before `app.use(express.json(...))` at `server.js:631`, with a comment documenting the move and why. Re-verified 2026-07-16.

**File (original finding):** `server.js:5029` (route) vs. `server.js:336` (global body parser)

`/stripe/webhook` (line 152) and `/resend/webhook` (line 286) are both registered **before** `app.use(express.json({limit:"5mb"}))` at line 336, so their route-level `express.raw()` sees the untouched byte stream — correct. `/billing/webhook` is registered at **line 5029**, thousands of lines *after* that global `express.json()`. Empirically verified: by the time a request to `/billing/webhook` reaches its own `express.raw()` middleware, Express's global JSON parser has already consumed the stream and set `req.body` to a parsed object, not a Buffer.

`stripe.webhooks.constructEvent(req.body, sig, secret)` (line 5034) explicitly checks for this (`suspectPayloadType`) and throws `StripeSignatureVerificationError` — *every real Stripe billing webhook delivery will hit the `catch` block and get rejected with 400.* This is **not an attacker-exploitable bypass** (it fails closed — nothing forged gets through), but it means `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, and `customer.subscription.deleted` **never actually update `orgs.subscription_status` in production**, silently. Org billing state is currently only as correct as it was at last... whatever manually reconciles it. This is exactly the failure mode the review asked me to check for, and it's real.

### C4. `POST /sequences/:id/enroll` + `GET /sequences/:id/enrollments` — cross-tenant donor name/email leak
**RESOLVED** — `server.js:7129-7135` (`POST /sequences/:id/enroll`) now validates `SELECT id FROM donors WHERE id = ? AND org_id = ?` before enrolling (404s otherwise); `server.js:7114-7127` (`GET /sequences/:id/enrollments`) now joins `d.org_id = ?` in addition to `se.org_id = ?`. Re-verified 2026-07-16.

**File (original finding):** `server.js:4750-4779` (enroll) + `server.js:4735-4748` (read)

```js
// 4750 — sequence ownership checked, donorId is NOT
app.post("/sequences/:id/enroll", requireAuth, wrap(async (req, res) => {
  const { donorId } = req.body;
  const seq = await query("SELECT id FROM sequences WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!seq.length) return res.status(404).json({ error: "Sequence not found" });
  // donorId is inserted straight into sequence_enrollments with no ownership check
```
```js
// 4735 — enrollments read JOINs donors with no d.org_id filter
SELECT se.*, d.name AS donor_name, d.email AS donor_email, ...
FROM sequence_enrollments se
JOIN donors d ON se.donor_id = d.id
WHERE se.sequence_id = ? AND se.org_id = ?
```
An attacker enrolls a guessed/known donor ID from a different org into one of their own sequences (the enrollment's `org_id` is set to the attacker's own org, but `donor_id` points at the victim's donor). `GET /sequences/:id/enrollments` then joins that `donor_id` to the `donors` table with **no org check on the donor side**, returning the victim donor's real name and email to the attacker. (`processSequences()` itself is *not* affected — it separately re-verifies `donor_id AND org_id` before sending — so this doesn't cause a misdirected email, only a read leak of PII via the enrollments list.)

---

## Findings by area

### 1. Org scoping (multi-tenant isolation) — **GAP** (beyond the two CRITICALs above)
The overwhelming majority of the ~90 routes I checked route-by-route are correctly scoped (`donors`, `grants` core CRUD, `volunteers`, `tasks`, `campaigns`, `planned_gifts`, `donor_materials` CRUD itself, `finance/accounts|funds|budgets|transactions` core CRUD, `custom_fields` definitions, `events` core CRUD besides C2, `gmail/thread/:donorId`, `reports/board/:id/pdf`). `calcWealthScore()` (server.js:411-417), specifically called out in CLAUDE.md, is genuinely double-scoped by `donor_id AND org_id` on every query. Beyond C1/C2/C4, two more real gaps:

- **`server.js:3343-3361` `POST /programs/:id/grants`** — `grantId` from the body is never checked against the caller's org before being linked. `GET /programs` (server.js:3288-3297) then `JOIN grants g ON g.id = pg.grant_id` with no `g.org_id` filter — a linked cross-org `grantId` will show that other org's funder/program name in the response. **GAP.**
- **`server.js:3363-3369` `DELETE /programs/:id/grants/:grantId`** — no `org_id` check at all (not even on `program_id`): `DELETE FROM program_grants WHERE program_id = ? AND grant_id = ?`. Any org can delete another org's program↔grant link row if IDs are known/guessed. **GAP.**
- **`server.js:5532-5578` `POST /gmail/send`** — `donorId` from the body is used to insert an `interactions` row (`org_id: req.user.orgId, donor_id: <unverified>`) with no check that the donor belongs to the sender's org. Combined with **`server.js:1235`** — the *only* place in the codebase that reads `interactions` by `donor_id` alone with no `org_id` filter (`GET /donors/:id`'s `d.interactions = await query("SELECT * FROM interactions WHERE donor_id = ? ORDER BY date DESC", [d.id])`) — an attacker can plant an arbitrary-content interaction record that displays inside a *different* org's legitimate donor timeline. This is a stored content-injection vector, not a read leak (the attacker can't view the victim's timeline themselves, only write into it). **GAP.**
- **`server.js:3811-3820` `POST /finance/transactions`** — `accountId`/`fundId` from the body aren't verified to belong to the caller's org before insert; the transaction's own `org_id` is correct, but the immediate response JOIN (server.js:3821-3827) will echo back another org's account/fund *name* if a foreign ID is supplied. Low severity (leaks a label, not balances), still an IDOR. **GAP.**
- Several routes do an unscoped follow-up `SELECT` **after** an already org-scoped `UPDATE`/existence-check has already gated the request (e.g. `donors/:id` PUT at 1638, `grants/:id` GET's `grant_interactions` at 2284, `campaigns/:id/send`, several others) — these are **not exploitable** since the ID was already confirmed org-owned earlier in the same handler, but it's worth calling out as the inconsistent pattern that made C2 possible: most of the codebase does "verify ownership → act", a few spots do "act → read back without re-verifying," and `PUT /events/:id` is the one place that dropped the ownership check entirely.

### 2. RBAC enforcement — **RESOLVED** (re-verified 2026-07-16)
`requireAdmin` is correctly applied to essentially everything that looks admin-sensitive: `POST /auth/invite`, all `custom-fields` mutation routes, `finance/accounts|funds|budgets` mutations + `transactions` delete, `campaigns` delete/send, `sequences` create/update/status/delete, `stripe/connect`, all `/admin/*` super-admin routes (via `requireSuperAdmin`), `donors` delete/assign/bulk-assign/bulk-delete, `grants`... wait, grants PUT/POST are `checkWriteAccess` not `requireAdmin` (grant edits are staff-level, consistent with MGO workflow — not a gap). The three misses originally flagged here are now all fixed:

- **`POST /billing/create-portal`** (`server.js:7998`) — now `requireAuth, requireAdmin`.
- **`POST /billing/create-checkout`** (`server.js:7970`) — now `requireAuth, requireAdmin`.
- **`PATCH /orgs/:id`** (`server.js:1055-1056`) — now `requireAuth, requireAdmin`, plus still checks `req.user.orgId === req.params.id`.

`requireAdmin` itself (server.js:353-356) is correctly implemented — checks `req.user.role !== "admin"` off the verified JWT claim, nothing forgeable.

### 3. Stripe webhook signature verification — **GAP** (see C3)
`/stripe/webhook` itself: **OK** — `express.raw()` registered before the global `express.json()`, `constructEvent` called with the raw buffer and `STRIPE_WEBHOOK_SECRET`, verified correctly (server.js:151-160).
`/billing/webhook`: signature verification code is *written* correctly (same `constructEvent` pattern, correct secret fallback logic) but is **non-functional** due to registration-order body consumption — see C3 above. This is the single biggest "looks right, isn't" finding in the review.

### 4. Resend webhook signature verification — **OK**
`server.js:286-334`. Registered before the global `express.json()` (line 286 < 336) — raw body intact, confirmed empirically. `new SvixWebhook(secret).verify(req.body, {svix-id, svix-timestamp, svix-signature})` — empirically tested (this session) with all three headers `undefined`, with only `svix-signature` missing, and with an empty headers object: **all three cases correctly threw `WebhookVerificationError`** and were caught, returning 400. No bypass via missing headers. Also correctly gated behind `RESEND_WEBHOOK_SECRET` being set (`503` if not configured, never falls through to trusting an unverified payload).

### 5. Auth token handling — **OK**, one hardening recommendation
- **Algorithm confusion:** `auth.js:19` calls `jwt.verify(token, SIGNING_SECRET)` with **no explicit `algorithms` option**. Empirically tested this session with the actual installed `jsonwebtoken@9.0.3`: a forged `alg:"none"` token with no signature is **rejected** ("jwt signature is required") even without an explicit algorithms allowlist — the library defends against this by default in this version. There is also no RS256/asymmetric keypair anywhere in the app, so the classic "leaked public key used as an HMAC secret" confusion attack doesn't apply here (there's no public key exposed for this purpose at all — `SIGNING_SECRET` is a single server-only symmetric secret used for both sign and verify). **Not currently exploitable**, but explicitly pinning `algorithms: ["HS256"]` in the `jwt.verify()` call is still recommended as defense-in-depth against future library/config changes rather than relying on the library's current default behavior.
- **Claim forgery:** checked all 4 `signToken()` call sites (server.js:533, 558, 710, 1181 — login, register, register-org, invite-accept). In every case `orgId`, `role`, and `isSuperAdmin` are derived exclusively from a DB row (`user.org_id`, `user.role`, `user.is_super_admin`, or a freshly-generated ID / hardcoded `"admin"` for a brand-new org, or the `invites` row an admin already created) — **never** taken from `req.body`. No client-side path to forge these claims.

### 6. Public routes exposure — **OK**
Checked every route not behind `requireAuth`: `/auth/login|register|register-org|forgot-password|reset-password`, `/auth/invite/:token`, `/auth/invite/accept`, `/org/public-list`, `/org/:orgSlug/public`, `/donate/:orgSlug`, `/gmail/callback`, `/unsubscribe` (GET/POST), `/stripe/webhook`, `/resend/webhook`, `/billing/webhook`, `/track/:recipientId/open.gif`, `/demo-request`, `/health`.
- **SQL injection:** none found. Searched every template-literal SQL fragment in the file; every `?`-based query uses proper parameterization. The handful of template-literal interpolations into SQL text are all either (a) placeholder-multiplication for bulk inserts (`"(?,?,?,?)".join(",")` — the actual data still goes through the parameterized `params` array, e.g. server.js:1547/1551/1976) or (b) `parseInt(x, 10)`-sanitized integers used in `INTERVAL '${n} days'` (server.js:4574, 4631, 4767, 5228 — matches CLAUDE.md's own documented rationale for this pattern). No raw string concatenation of user input into SQL anywhere.
- **Over-exposure:** `/org/public-list` returns only `id, name, slug` for every org (by design, needed to route `/give/:slug` — arguably this is a public directory of every nonprofit on the platform, worth being aware of but not a data-sensitivity issue). `/org/:orgSlug/public` returns only `name, mission, slug` + fund `id/name/restricted` — no donor data, no financials, no Stripe account IDs. `/donate/:orgSlug` returns only a Stripe Checkout URL. None of the public routes leak donor PII, gift amounts, or financial totals.

### 7. File upload handling (`donor_materials`) — **RESOLVED** (re-verified 2026-07-16)
All three issues are now fixed at `server.js:2548-2591`, with an inline comment explicitly walking through this exact original finding:
- **Size validation:** `MATERIAL_MAX_BYTES = 1024*1024` (server.js:2562), enforced server-side in `POST /donors/:id/materials` via `Buffer.byteLength(file_data,"base64") > MATERIAL_MAX_BYTES` → 400 (server.js:2581-2583). No longer relying on the client's own check or the unrelated 5MB global body cap.
- **Type validation:** `MATERIAL_ALLOWED_MIME_TYPES` allowlist (server.js:2563-2573, pdf/jpeg/png/gif/webp/doc/docx/xls/xlsx/plain-text/csv/octet-stream) — `file_type` is checked against it and rejected with 400 if not present (server.js:2578-2580).
- **Stored XSS via blob URL:** still not reachable — confirmed via a full-file grep that `file_data` is written (`INSERT`) but never appears in any `SELECT`/response anywhere in server.js, so `viewMaterial()`'s blob-from-`file_type` path in the client stays dormant. The MIME allowlist above is now the actual defense-in-depth (closes the gap even if a future change adds `file_data` back to a read response), rather than the previous state where the only thing preventing exploitation was an unrelated accident.

### 8. Admin impersonation — **NOT IMPLEMENTED** (nothing to audit)
Searched the entire codebase (`server.js`, `auth.js`, all of `client/src`, `AdminDashboard.jsx` specifically) for any impersonation/"login as"/"view as org" mechanism — **found none**. `AdminDashboard.jsx` (764 lines) only wires up `GET /admin/orgs`, `GET /admin/metrics`, `GET /admin/orgs/:id`, `POST /admin/orgs/:id/extend-trial`, `POST /admin/orgs/:id/change-plan`, `DELETE /admin/orgs/:id` — all correctly gated `requireAuth, requireSuperAdmin` server-side (server.js:5144-5245), with no client-forgeable path (super-admin status is a JWT claim, covered under area 5). If an impersonation feature is planned for launch, it doesn't exist yet and should be designed with its own audit trail from the start rather than retrofitted.

---

## Summary table

| # | Area | Status |
|---|------|--------|
| — | **C1** `POST/GET /donors/:id/custom-fields` cross-tenant write+read | **FIXED** (verified 2026-07-16) |
| — | **C2** `PUT /events/:id` cross-tenant full-record read | **FIXED** (verified 2026-07-16) |
| — | **C3** `/billing/webhook` raw body destroyed → verification always fails | **FIXED** (verified 2026-07-16) |
| — | **C4** `POST/GET /sequences/:id/enroll|enrollments` donor PII leak | **FIXED** (verified 2026-07-16) |
| 1 | Org scoping — bulk of routes | OK |
| 1 | Org scoping — `programs/:id/grants` (link + delete), `gmail/send`→`interactions`, `finance/transactions` | GAP |
| 2 | RBAC — most admin-sensitive routes | OK |
| 2 | RBAC — `billing/create-portal`, `billing/create-checkout`, `orgs/:id` PATCH | **FIXED** (verified 2026-07-16) |
| 3 | Stripe webhook — `/stripe/webhook` | OK |
| 3 | Stripe webhook — `/billing/webhook` | GAP (= C3) |
| 4 | Resend webhook signature verification | OK |
| 5 | JWT algorithm / claim forgery | OK (algorithm pinning recommended as hardening) |
| 6 | Public routes — SQL injection | OK |
| 6 | Public routes — data over-exposure | OK |
| 7 | File upload validation (size/type) | **FIXED** (verified 2026-07-16) |
| 7 | File upload stored-XSS | **FIXED** (verified 2026-07-16 — allowlist now closes it, not just the accidental `file_data` exclusion) |
| 8 | Admin impersonation | Not implemented |

**Fix priority (as of original 2026-07-10 discovery): C1–C4 first, regardless of what else is in flight** — C1, C2, and C4 are genuine cross-tenant data exposure/corruption in a system whose entire value proposition depends on tenant isolation; C3 means Stripe billing state has silently never been syncing automatically in whatever environment this has been deployed to. **All four, plus the RBAC gap (§2) and file upload gap (§7), are now fixed** (see notes inline above, verified 2026-07-16). The only items in this original report still unverified are the §1 org-scoping edge cases (`programs/:id/grants` link+delete, `gmail/send`→`interactions`, `finance/transactions`) — those should be treated as the current open punch list from this report.

---

# Giving Pages & Peer-to-Peer Fundraising — 2026-07-16

Both features were built this session, after the 2026-07-10 review above, and audited separately here using the same categories. Covers `server.js`'s `giving_pages`/`peer_fundraisers` routes, `db.js`'s table definitions, the extended `/stripe/webhook` handlers, and `Donate.jsx`/`ManageFundraiser.jsx`/`Settings.jsx`'s `GivingPagesManager`.

**No CRITICAL findings.**

### 1. Org scoping — **OK**
Every admin route filters by `org_id = req.user.orgId` (`POST`/`PUT`/`DELETE /giving-pages`, `GET`/`PUT /giving-pages/:id/fundraisers` \| `/peer-fundraisers/:id`). Public routes are scoped by `org_slug` + `page_slug`/`fundraiser_slug` + `status='active'`, never by raw ID — a fundraiser can't be attached to another org's giving page (`POST /org/:orgSlug/giving-page/:pageSlug/fundraisers` derives both `org.id` and `givingPage.id` from the validated slug lookup, never from client input). `POST /donate/:orgSlug` re-derives `givingPageId` from the fundraiser's own row when a `peerFundraiserId` is present (server.js ~5395), closing off a "donate to fundraiser X, tag the gift to page Y" mismatch; foreign-org IDs 400 rather than silently succeeding.

### 2. RBAC — **OK** (one stale comment fixed)
Admin mutations (`POST`/`PUT`/`DELETE /giving-pages`, `PUT /peer-fundraisers/:id` takedown) are all `requireAdmin`(+`checkWriteAccess` where not a DELETE). `GET /giving-pages/:id/fundraisers` is `requireAuth` only — correct and consistent with donor PII being staff-visible app-wide (same as `GET /donors`), not an actual gap; its comment used to say "Admin" which was misleading given the code only required auth — fixed to describe the real (correct) staff-level intent.

### 3. `edit_token` (no-login fundraiser-manage auth) — **OK**
`generateEditToken()` is two concatenated `crypto.randomUUID()`s (~244 bits entropy) — unguessable. Never returned in any API response (the create route deliberately omits it, see inline comment), never logged, excluded via explicit column lists from every admin-facing query (never `SELECT pf.*`). Rate-limited via a dedicated `fundraiserManageLimiter`, separate from `donateLimiter`'s budget. Residual, *inherited* risk: it's a bearer token embedded in a URL path, same shape as `invites.token` and the recovery/card-update link already used elsewhere in this codebase — subject to the same class of exposure (access logs, browser history, and potentially Sentry's browser-tracing breadcrumbs, which weren't verified either way this pass). Not a regression introduced by this feature; if it's worth hardening, it's worth doing for all three token families at once, not just this one.

### 4. SQL injection — **OK**. Every query is parameterized; no string concatenation of request-derived values into SQL text.

### 5. Public route data exposure — **OK**. Checked every public response shape — no fundraiser email, no `edit_token`, no other-org data or donor PII leaks anywhere.

### 6. XSS / stored content injection — **OK**. No `dangerouslySetInnerHTML` anywhere in the new pages; all user text renders as JSX (auto-escaped). The one place raw HTML is built server-side (`sendFundraiserManageEmail`) runs every interpolated field through `escapeHtml()`.

### 7. Input validation — **was a GAP, now fixed**
The public fundraiser-creation route was already well-validated (length caps, email format) from when it was built. The admin `POST`/`PUT /giving-pages` routes and the token-authenticated `PUT /peer-fundraisers/manage/:token` route had no equivalent — no length caps, and `goalAmount`/`personalGoalAmount` were only `parseFloat`'d with no positive/finite check (a negative or `NaN` goal would silently store or throw a raw 500 instead of a clean 400). Fixed 2026-07-16: added the same length caps (title/name ≤200, story ≤5000, imageUrl ≤2000) and a shared `validateGivingPageFields()` helper plus matching goal-amount validation on all four routes that accept these fields.

### Stripe webhook trust boundary — **OK**
`payment_intent.succeeded` reads `giving_page_id`/`peer_fundraiser_id` straight from Stripe metadata with no re-validation against `orgId` — correct, because that metadata is only ever set server-side in `POST /donate/:orgSlug` after the org check already ran, `event.account` (used to resolve `orgId`) is Stripe-controlled not metadata-derived, and there's no client-reachable path to fabricate a webhook event for another org's connected account.

| # | Area | Status |
|---|------|--------|
| 1 | Org scoping — admin + public routes | OK |
| 2 | RBAC — admin mutations gated, stale "Admin" comment on a correctly staff-level read | OK (comment fixed) |
| 3 | `edit_token` — entropy, non-leakage, rate limiting | OK |
| 3 | `edit_token` — bearer-token-in-URL exposure (Sentry/access logs/history) | Inherited pattern, not verified, shared with invites/recovery tokens |
| 4 | SQL injection | OK — none found |
| 5 | Public route data exposure | OK |
| 6 | XSS / stored content injection | OK |
| 7 | Input validation — admin giving-page routes, goal-amount sanity | Fixed 2026-07-16 |
