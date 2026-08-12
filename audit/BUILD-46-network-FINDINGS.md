# BUILD-46 (network) — Donor Accounts & the Giving Network — FINDINGS

*(Filename is `BUILD-46-network-FINDINGS.md`, not `BUILD-46-FINDINGS.md`: the
BUILD-46 label was already used by the 2026-08-08 demo-bugs/brand build whose
audit files live beside this one — per the one-build-one-uniquely-named-
findings-file rule, this build gets a distinct name.)*

**⚠️ BOLD, PER §4: the live-Stripe recurring drill is STILL UNDONE.** One real
test subscription must be paused → re-priced → canceled through the live
portal (real Stripe, real webhooks) before any pilot donor — and now before
any dashboard donor — gets a link. Flagged in BUILD-45, still outstanding.

## Launch posture — FEATURE FLAGS (mid-run rule, complied)
Everything donor-visible or signup-visible ships OFF in prod:

| Flag (env) | Gates | Prod default |
|---|---|---|
| `DONOR_ACCOUNTS_ENABLED` | all `/account/*` routes; account-stamping of portal sessions; account-session org access; the §1.3 portal nudge; `/giving` client page (via `/network/config`) | **unset = OFF** |
| `NETWORK_SIGNUP_ENABLED` | `POST /network/signup`; the `/join` client page (via `/network/config`) | **unset = OFF** |

Off = the routes return the SAME body as an unknown route (404, no oracle),
sessions carry no `donor_account_id`, and prod behavior is byte-identical to
BUILD-45 — proven by the flag-off child-server leg of
`tests/donor-accounts.test.js`. `/network/config` (public, non-secret
booleans) is the client's flag probe. The admin review queue stays reachable
to the super admin regardless (read-only visibility pre-launch, deliberate).
Ordering rule complied: §1 + the §2.4 sweep landed and proved in the same
commit series that introduces §3, and §3 is unreachable in prod by flag.

## Verdicts

### §1 Global donor accounts — BUILT, PROVEN (49 asserts, `donor-accounts.test.js`)
- `donor_accounts` global (email unique case-folded), bcryptjs cost 12
  (matches staff auth; argon2id rejected ONLY because it adds a native dep to
  a zero-native-dep deploy — the documented §1.1 choice).
- Full BUILD-37 §1 checklist proven: 256-bit CSPRNG tokens, hash-at-rest,
  single-use (atomic UPDATE…RETURNING), 60-min expiry, supersede-on-re-request
  and on password change; byte-identical failure responses across
  unknown-email / wrong-password / passwordless / unverified (no enumeration
  anywhere, incl. signup and reset); sessions invalidated on password change
  (all but the changing session) and on email change (all); email change
  confirmed at the OLD address, and the NEW address must then independently
  verify before anything links.
- Every account-lifecycle email (verify, reset, alias, email-change, magic
  link — folded in per the brief) rides the queued, retried,
  `/health.failedPending`-surfaced path; the suite kills the provider,
  watches the reset email queue, revives the provider, and proves the
  retried token WORKS — a donor is never silently locked out.
- Both auth paths mint the same session: a magic link for a verified account
  email opens org portal AND dashboard; a password login opens the dashboard
  and every linked+listed org drill-down.
- S-11 bursts against the real limiters (IP + per-email buckets) via the
  x-test seam: 429s proven on login, signup, reset.
- MFA (TOTP): NOT built — `BLOCKED-donor-mfa.md` (schema stubs in place, flow
  + recovery codes + policy question specced).

### §1.2 Linking — BUILT, PROVEN (25 asserts, `donor-linking.test.js`)
Exact verified-email match only (case-folded); name-identical strangers and
plus-alias lookalikes untouched; unverified aliases link nothing; idempotent
by unique-constraint; unlink immediate/audited/never-auto-relinked, org
record byte-identical after; relink explicit; account deletion removes links
+ PII with org records byte-identical; S-12 (replay + cross-account claim)
holds — a verified email is globally unique across accounts by partial-unique
index. Link triggers: signup-verify, alias-verify, reset-verify, org-approval
(`linkOrgJoinsNetwork`), the Stripe-webhook donor-resolve hook, and a lazy
idempotent pass on every dashboard read (the freshness backstop).

### §2 Dashboard — BUILT, PROVEN (22 asserts, `donor-dashboard.test.js`)
Read-time aggregation equals the per-org portal ledgers to the dollar; org
cards carry each org's white-label identity; unified recurring == the per-org
lists; tax summary == receipts/ledger with the "consult your tax preparer"
framing; impact feed = the BUILD-45 matcher per org, merged newest-first,
org-labeled, no ranking. The org drill-down is the UNFORKED BUILD-45 Portal
(same component, same payload byte-for-byte vs a magic-link session — proven);
mutations through an account session run the same org-scoped Stripe-first
paths and audit into the org's log. `network_listed` hides an org from every
dashboard surface while its standalone portal keeps working. Consumer brand
placeholder + locations: `BLOCKED-consumer-brand.md`.

### §2.4 THE WALL — PROVEN AS BYTE-EQUALITY (41 asserts, `org-blindness.test.js`)
A 10-route battery of Org-A staff views (profile, summaries, search incl.
searching the OTHER org's email, paginated list, CSV export, giving-summary +
top-donors reports, portal audit, recurring record) is captured before any
account exists and re-captured after the donor holds an account linked to
both orgs and has used every dashboard surface: **byte-identical, all ten.**
Marker sweep: no Org-A body contains the other org's id/slug/name/donor-id/
amount/fund or any account artifact. Org-side notification pipeline counts
unchanged. Symmetric spot-check org-B→org-A. Drill-down parity: an
account-session portal visit is indistinguishable in org-A's audit from a
magic-link visit and references nothing cross-org.

### §3 The gate — BUILT, PROVEN (34 asserts, `network-gate.test.js`)
Signup mints a Portal-tier org that is invisible (portal 404, magic link 404)
and un-giftable (`/donate` refuses, indistinguishable from not-set-up) until
approval — even with Stripe fully connected, even if staff flip the portal
settings on by direct API (S-14). The Portal tier is not the CRM
(`portal_tier` 403 on grants/reports-beyond-giving-summary/workflows/comms
route families; giving-summary + donors/gifts allowed; Team gates unchanged).
Approval re-checks the EIN LIVE and requires Stripe onboarding — the gate
refuses the approver too, and refusals are logged as decisions. EIN dupes go
to the dispute queue and cannot touch or be approved over the existing holder
(S-15). Auto-delist on EIN drop/revoke or Stripe loss: listing off, gifts
blocked, portal up, admin alerted via the queued path, decision logged;
an EMPTY registry delists nobody (fails safe). Signup rate-limited; queue is
super-admin only. `scripts/load-irs-ein-registry.js` loads IRS Pub 78 data
(monthly cadence documented in the script header). Pricing:
`BLOCKED-portal-tier-price.md` with the cost floor.

### §4 Money paths — NOTHING NEW, verified
All mutations remain the BUILD-45 org-scoped, Stripe-first, serialized,
idempotent, audited paths (exercised through an account session in the
dashboard suite). The dashboard adds views only. **The live-Stripe drill flag
at the top of this file stands.**

### §5 Privacy/consent/legal — documented
`audit/portal-data-handling.md` gained the network section (aggregation
model, the wall, alias verification, unlink, deletion — with the exact
donor-facing sentence). The one-paragraph honest privacy copy is live at
signup and in the dashboard footer. Attorney items: `BLOCKED-legal-network.md`.

### §6 Security sweep
S-11/S-12/S-13/S-14/S-15 are committed permanent suites (see above), all in
`tests/run-all.sh` + CI (flags ON in CI so the suites always run). The
BUILD-45 §7 suites (portal, gift-idempotency, differential staff/portal
sweeps) remain in the run and stayed green alongside.

## §7 Out of scope — named, none built
Donor-to-donor social features · public donor profiles/leaderboards · org
discovery/search beyond "orgs I already give to" · DAF mechanics or pooled
funds · payments routed through Steward itself · cross-org giving
recommendations ("donors like you also gave to…" — monetizes exactly the data
the wall promises never to share; trust-destroying, not growth) · AI anything.

## Migration notes (BUILD-45 portal users)
Nothing breaks, nothing is forced. A magic-link donor keeps signing in by
magic link forever. When accounts launch (flag on): the org portal shows a
one-line nudge — "create a free account" if none exists, "add a password
(use Reset password)" if a magic-link sign-in matched an account — and the
reset flow doubles as the password-setter for account-holders who never chose
one (reset-by-email is itself proof of control and also verifies the
account). Magic-link sessions for verified account emails open the dashboard
automatically (same-session rule).

## Worry paragraph (mandatory)
Three things worry me, in order. **(1) The wall's future erosion, not its
present state.** Today the byte-equality suite passes because no org-side
code touches the account tables — but the dangerous commit is the future
"helpful" feature (a staff-facing "this donor is portal-active" badge, a
support tool that looks up an account by email) that reads global tables from
an org context for a good reason and leaks a boolean. The suite will catch
body leaks on its ten routes; it cannot catch a NEW route added outside the
battery, a timing side-channel, or a log line. Rule going forward: any new
org-side route that mentions donor identity gets added to the battery in the
same commit, and no org-side handler may import the account helpers — I'd
like that made a grep-guard next build. **(2) The gate's human bottleneck and
its data dependency.** The whole trust product is Jonathan reading a queue:
at 10 orgs/week that's fine; at 100 it will rot into rubber-stamping, and the
EIN registry is only as fresh as the monthly load someone must remember to
run (an empty/stale registry fails safe against delisting but also means new
approvals check against old data — put the load script on a calendar or a
cron). Stripe "restricted" detection is currently the stored
connected/account-present state, not a live account-capability probe — good
enough for disconnection, blind to a Stripe-side restriction until the org
touches Stripe again. **(3) The link job at 10,000 orgs.** Linking is
per-email exact-match over `LOWER(d.email)` joined to portal-enabled orgs —
fine at hundreds of orgs, but `LOWER(email)` has no expression index, so
every verify/alias/lazy-dashboard pass is a scan whose cost grows with total
donor rows across ALL portal orgs; at 10k orgs × thousands of donors this
becomes a visible per-login cost and the lazy-on-read backstop becomes the
hot path. The fix is cheap and should land before scale: a functional index
`ON donors (LOWER(email)) WHERE deleted_at IS NULL`, and move the
org-joins-network bulk pass to a background job with progress logging. None
of these block the flag-off deploy; all three should be revisited before the
flags go on.

## Route inventory delta
New public: `POST /account/{signup,verify,login,logout,request-reset,reset,
change-email/confirm,aliases/verify}`, `GET /network/config`,
`POST /network/signup` (flag). New account-session: `GET /account/{me,
dashboard,recurring,tax-summary}`, `POST /account/{change-password,
change-email,aliases,links/:id/unlink,links/:id/relink}`,
`DELETE /account{,/aliases/:id}`. New staff: `GET /network/application`.
New super-admin: `GET /admin/network/applications`,
`POST /admin/network/applications/:id/decide`,
`POST /admin/network/run-gate-sweep`. Changed: `PUT /portal-settings`
(+networkListed), `GET /portal/:slug/me` (+account nudge field, flag-gated),
`POST /donate/:orgSlug` (portal-tier approval check), portal verify
(+account stamp), `requirePortalSession` (+account-session path).
`audit/routes.md` appended.

## Suites added to run-all + CI (permanent)
`donor-accounts` (49) · `donor-linking` (25) · `org-blindness` (41) ·
`network-gate` (34) · `donor-dashboard` (22) — 171 asserts. CI env gained the
two flags (ON in CI, OFF in prod).
