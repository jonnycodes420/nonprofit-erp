# Steward — Security Review (Multi-Tenant Isolation & Auth)
Generated 2026-07-10 as discovery-only. **Update 2026-07-16: all four CRITICALs
below (C1–C4) were re-verified against the current codebase and are already
fixed** — each has org-scoping/signature-verification checks in place that
weren't there on 2026-07-10. This file was never updated to reflect that at
the time, so treat the CRITICAL section as historical (what was found, and
where the fix landed) rather than an open punch list. The GAP items further
down (org scoping edge cases, RBAC gaps, file upload validation) have **not**
been re-verified and should still be treated as open until checked.

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

### 2. RBAC enforcement — **GAP**
`requireAdmin` is correctly applied to essentially everything that looks admin-sensitive: `POST /auth/invite`, all `custom-fields` mutation routes, `finance/accounts|funds|budgets` mutations + `transactions` delete, `campaigns` delete/send, `sequences` create/update/status/delete, `stripe/connect`, all `/admin/*` super-admin routes (via `requireSuperAdmin`), `donors` delete/assign/bulk-assign/bulk-delete, `grants`... wait, grants PUT/POST are `checkWriteAccess` not `requireAdmin` (grant edits are staff-level, consistent with MGO workflow — not a gap). Two real misses:

- **`server.js:5017-5026` `POST /billing/create-portal`** — `requireAuth` only. Opens the Stripe Customer Portal for the org, where the user can change payment method and (depending on portal config) cancel the subscription. Any non-admin staff account can hit this.
- **`server.js:4989-5015` `POST /billing/create-checkout`** — `requireAuth` only. Any staff member can initiate a new subscription checkout for the org. Lower severity than the portal route (requires actually completing Stripe checkout), but still a billing action gated only by "is logged in," not "is admin."
- **`server.js:745-754` `PATCH /orgs/:id`** — `requireAuth` only (checks `req.user.orgId === req.params.id`, not role). Any staff member can edit org mission/focus area/annual budget/founded year/website. Lower severity (no financial/PII exposure), but org profile settings are the kind of thing the audit explicitly asked about.

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

### 7. File upload handling (`donor_materials`) — **GAP** (currently low practical risk, but latent)
- **Size validation:** the 1MB limit (server.js — n/a; enforced client-side only, `client/src/components/Donors.jsx:2203` `if(file.size<1024*1024)`) is **not enforced server-side at all**. `POST /donors/:id/materials` (server.js:2109-2119) accepts `file_data` with zero size check; the only backstop is the *global* `express.json({limit:"5mb"})` body cap — 5x larger than the documented/intended limit, and shared across every route, not a purpose-built file-size guard.
- **Type validation:** `file_type` is accepted verbatim from the client (`file.type` in the browser, fully attacker-controlled if calling the API directly) with **no server-side allowlist**.
- **Stored XSS via blob URL:** `viewMaterial()` (`client/src/components/Donors.jsx:2217-2224`) builds `new Blob([byteArray], {type: m.file_type})` from attacker-controlled `file_type` and opens it via `URL.createObjectURL` + `window.open(url, "_blank")` — if `file_type` were `text/html` (or `image/svg+xml`) and `file_data` contained a script payload, opening that blob would execute it. **This is not currently reachable end-to-end**: `GET /donors/:id/materials` (server.js:2105) and the `POST` response (server.js:2120) both explicitly exclude `file_data` from their `SELECT` — the column is written but never read back by any route. In the current code this actually looks like an unrelated functional bug (the "View" button does nothing for base64-uploaded files once the page reloads, since `m.file_data` is always `undefined` from any server response). **The moment someone "fixes" that and adds `file_data` back to a GET response — a very plausible near-term change given CLAUDE.md documents a "view/delete grid" as the intended feature — this becomes a live, cross-session stored XSS**, because nothing in the chain validates or sanitizes `file_type`/`file_data` today.

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
| 2 | RBAC — `billing/create-portal`, `billing/create-checkout`, `orgs/:id` PATCH | GAP |
| 3 | Stripe webhook — `/stripe/webhook` | OK |
| 3 | Stripe webhook — `/billing/webhook` | GAP (= C3) |
| 4 | Resend webhook signature verification | OK |
| 5 | JWT algorithm / claim forgery | OK (algorithm pinning recommended as hardening) |
| 6 | Public routes — SQL injection | OK |
| 6 | Public routes — data over-exposure | OK |
| 7 | File upload validation (size/type) | GAP |
| 7 | File upload stored-XSS | GAP (latent, not currently reachable) |
| 8 | Admin impersonation | Not implemented |

**Fix priority (as of original 2026-07-10 discovery): C1–C4 first, regardless of what else is in flight** — C1, C2, and C4 are genuine cross-tenant data exposure/corruption in a system whose entire value proposition depends on tenant isolation; C3 means Stripe billing state has silently never been syncing automatically in whatever environment this has been deployed to. **All four are now fixed** (see notes inline above, verified 2026-07-16). The GAP items below (org scoping edge cases §1, RBAC gaps §2, file upload validation §7) have not been re-verified and should be treated as the current open punch list. Everything else in this report is real but lower blast-radius.
