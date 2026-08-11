# BUILD-37 — Route inventory (machine-generated)

Extracted from `server.js` — **283 routes**. Auth = strongest guard on the route line. `:id` routes carry an org-ownership check in the handler body (verified: 0 of 114 authed param-routes lacked an org-scope reference — see FINDINGS B1/B2).

| Class | Count |
|---|---|
| PUBLIC | 25 |
| AUTH | 188 |
| ADMIN | 61 |
| SUPERADMIN | 9 |

## PUBLIC (25) — intentional public surface (donation pages, token flows, webhooks, tracking pixel, OAuth callback). Token/slug-scoped; webhooks signature-verified.

| Method | Path | Middleware (beyond requireAuth) | Param |
|---|---|---|---|
| POST | `/auth/forgot-password` | passwordResetLimiter |  |
| GET | `/auth/invite/:token` | - | yes |
| POST | `/auth/invite/accept` | - |  |
| POST | `/auth/login` | loginIpLimiter+loginAccountLimiter |  |
| POST | `/auth/register` | registerLimiter |  |
| POST | `/auth/register-org` | registerLimiter |  |
| POST | `/auth/reset-password` | passwordResetLimiter |  |
| POST | `/billing/webhook` | express.raw |  |
| POST | `/demo-request` | - |  |
| POST | `/donate/:orgSlug` | donateLimiter | yes |
| GET | `/gmail/callback` | - |  |
| GET | `/health` | - |  |
| GET | `/org/:orgSlug/giving-page/:pageSlug/fundraiser/:fundraiserSlug/public` | - | yes |
| POST | `/org/:orgSlug/giving-page/:pageSlug/fundraisers` | donateLimiter | yes |
| GET | `/org/:orgSlug/giving-page/:pageSlug/public` | - | yes |
| GET | `/org/:orgSlug/public` | - | yes |
| GET | `/org/public-list` | - |  |
| GET | `/peer-fundraisers/manage/:token` | fundraiserManageLimiter | yes |
| PUT | `/peer-fundraisers/manage/:token` | fundraiserManageLimiter | yes |
| GET | `/recurring/update-card` | - |  |
| POST | `/resend/webhook` | express.raw |  |
| POST | `/stripe/webhook` | express.raw |  |
| GET | `/track/:recipientId/open.gif` | - | yes |
| GET | `/unsubscribe` | - |  |
| POST | `/unsubscribe` | - |  |

## AUTH (188) — org-scoped by `WHERE org_id = ?` (app-layer; no RLS — see FINDINGS B4/B5).

| Method | Path | Middleware (beyond requireAuth) | Param |
|---|---|---|---|
| POST | `/ai/column-map` | - |  |
| GET | `/ai/donor-score` | - |  |
| POST | `/ai/stream` | - |  |
| GET | `/annual-fund` | - |  |
| GET | `/billing/status` | - |  |
| GET | `/board` | - |  |
| POST | `/board` | checkWriteAccess |  |
| GET | `/campaigns` | - |  |
| POST | `/campaigns` | checkWriteAccess |  |
| GET | `/campaigns/:id` | - | yes |
| PUT | `/campaigns/:id` | checkWriteAccess | yes |
| PUT | `/campaigns/:id/briefing` | checkWriteAccess | yes |
| GET | `/campaigns/:id/progress` | - | yes |
| GET | `/custom-fields` | - |  |
| GET | `/dashboard` | - |  |
| GET | `/dashboard/home` | - |  |
| GET | `/dashboard/my-stats` | - |  |
| GET | `/dashboard/my-stats/gifts/breakdown` | - |  |
| GET | `/dashboard/my-stats/lapsed/breakdown` | - |  |
| GET | `/dashboard/my-stats/moves/breakdown` | - |  |
| GET | `/dashboard/my-stats/pipeline/breakdown` | - |  |
| GET | `/dashboard/my-stats/visits/breakdown` | - |  |
| GET | `/dashboard/recent-activity` | - |  |
| GET | `/dashboard/retention/breakdown` | - |  |
| GET | `/dashboard/stewardship-debt/breakdown` | - |  |
| GET | `/dashboard/today` | - |  |
| GET | `/digests/preview` | - |  |
| DELETE | `/donor-relationships/:id` | - | yes |
| GET | `/donors` | - |  |
| POST | `/donors` | checkWriteAccess |  |
| GET | `/donors/:id` | - | yes |
| PUT | `/donors/:id` | checkWriteAccess | yes |
| GET | `/donors/:id/custom-fields` | - | yes |
| POST | `/donors/:id/custom-fields` | - | yes |
| GET | `/donors/:id/designations` | - | yes |
| POST | `/donors/:id/designations` | checkWriteAccess | yes |
| DELETE | `/donors/:id/designations/:kind` | - | yes |
| GET | `/donors/:id/events` | - | yes |
| GET | `/donors/:id/fund-affinity` | - | yes |
| POST | `/donors/:id/gifts` | checkWriteAccess | yes |
| GET | `/donors/:id/impact-summary/pdf` | - | yes |
| POST | `/donors/:id/interactions` | - | yes |
| GET | `/donors/:id/materials` | - | yes |
| POST | `/donors/:id/materials` | - | yes |
| GET | `/donors/:id/move-suggestions` | - | yes |
| GET | `/donors/:id/moves` | - | yes |
| GET | `/donors/:id/opportunities` | - | yes |
| POST | `/donors/:id/opportunities` | checkWriteAccess+requirePlan | yes |
| GET | `/donors/:id/planned-gifts` | - | yes |
| POST | `/donors/:id/planned-gifts` | - | yes |
| GET | `/donors/:id/pledges` | - | yes |
| POST | `/donors/:id/pledges` | checkWriteAccess | yes |
| GET | `/donors/:id/receipts` | - | yes |
| GET | `/donors/:id/recurring-subscription` | - | yes |
| GET | `/donors/:id/relationships` | - | yes |
| POST | `/donors/:id/relationships` | checkWriteAccess | yes |
| POST | `/donors/:id/score` | requirePlan | yes |
| GET | `/donors/:id/soft-credit` | - | yes |
| PATCH | `/donors/:id/stage` | requirePlan | yes |
| GET | `/donors/:id/tasks` | - | yes |
| POST | `/donors/:id/year-end-statement` | checkWriteAccess | yes |
| PATCH | `/donors/bulk-stage` | requirePlan |  |
| GET | `/donors/custom-field-values/all` | - |  |
| GET | `/donors/duplicates` | - |  |
| GET | `/donors/export/csv` | - |  |
| POST | `/donors/import` | - |  |
| POST | `/donors/import-combined` | checkWriteAccess |  |
| POST | `/donors/merge` | checkWriteAccess |  |
| GET | `/donors/my` | - |  |
| GET | `/donors/stage-counts` | - |  |
| GET | `/donors/summaries` | - |  |
| GET | `/events` | - |  |
| POST | `/events` | checkWriteAccess |  |
| PUT | `/events/:id` | checkWriteAccess | yes |
| DELETE | `/events/:id` | - | yes |
| GET | `/events/:id` | - | yes |
| POST | `/events/:id/attendees` | checkWriteAccess | yes |
| PATCH | `/events/:id/attendees/:attendeeId` | checkWriteAccess | yes |
| DELETE | `/events/:id/attendees/:attendeeId` | - | yes |
| POST | `/events/:id/follow-up` | checkWriteAccess | yes |
| GET | `/finance/accounts` | - |  |
| GET | `/finance/audit-log` | - |  |
| GET | `/finance/budgets` | - |  |
| GET | `/finance/funds` | - |  |
| GET | `/finance/stripe-summary` | - |  |
| GET | `/finance/summary` | - |  |
| GET | `/finance/transactions` | - |  |
| POST | `/finance/transactions` | checkWriteAccess |  |
| GET | `/financials` | - |  |
| GET | `/fundraising/campaigns` | - |  |
| POST | `/fundraising/campaigns` | checkWriteAccess |  |
| PUT | `/fundraising/campaigns/:id` | checkWriteAccess | yes |
| GET | `/fundraising/goals` | - |  |
| GET | `/fundraising/overview` | - |  |
| PUT | `/gifts/:id` | - | yes |
| DELETE | `/gifts/:id` | - | yes |
| POST | `/gifts/:id/receipt` | checkWriteAccess | yes |
| POST | `/gifts/import-history` | checkWriteAccess |  |
| GET | `/giving-pages` | - |  |
| GET | `/giving-pages/:id/fundraisers` | - | yes |
| POST | `/gmail/auth-url` | - |  |
| DELETE | `/gmail/disconnect` | - |  |
| POST | `/gmail/send` | - |  |
| GET | `/gmail/status` | - |  |
| POST | `/gmail/sync` | - |  |
| GET | `/gmail/thread/:donorId` | - | yes |
| GET | `/goals/active` | - |  |
| GET | `/grants` | - |  |
| POST | `/grants` | checkWriteAccess |  |
| PUT | `/grants/:id` | checkWriteAccess | yes |
| DELETE | `/grants/:id` | - | yes |
| GET | `/grants/:id` | - | yes |
| POST | `/grants/:id/interactions` | - | yes |
| GET | `/grants/:id/manual-match` | - | yes |
| GET | `/households` | - |  |
| POST | `/households` | checkWriteAccess |  |
| GET | `/households/:id` | - | yes |
| PUT | `/households/:id` | checkWriteAccess | yes |
| DELETE | `/households/:id` | - | yes |
| GET | `/impact` | - |  |
| GET | `/impact-metrics` | - |  |
| DELETE | `/interactions/:id` | - | yes |
| DELETE | `/materials/:id` | - | yes |
| GET | `/me` | - |  |
| GET | `/me/home-layout` | - |  |
| PUT | `/me/home-layout` | - |  |
| DELETE | `/me/home-layout` | - |  |
| PUT | `/me/notification-prefs` | - |  |
| GET | `/metrics/stewardship-summary` | - |  |
| GET | `/milestone-drafts` | - |  |
| PUT | `/milestone-drafts/:id` | checkWriteAccess | yes |
| POST | `/milestone-drafts/:id/dismiss` | - | yes |
| GET | `/note-reminders` | - |  |
| POST | `/note-reminders/:id/dismiss` | - | yes |
| POST | `/note-reminders/:id/send` | - | yes |
| POST | `/onboarding/complete` | - |  |
| PUT | `/opportunities/:id` | checkWriteAccess+requirePlan | yes |
| DELETE | `/opportunities/:id` | - | yes |
| GET | `/org` | - |  |
| POST | `/org/clear-sample-data` | - |  |
| GET | `/org/export` | - |  |
| POST | `/org/load-sample-data` | - |  |
| GET | `/org/sample-data-status` | - |  |
| GET | `/org/setup-status` | - |  |
| GET | `/org/team` | - |  |
| GET | `/pipeline` | - |  |
| POST | `/pipeline/:donorId/move` | checkWriteAccess+requirePlan | yes |
| POST | `/pipeline/add` | checkWriteAccess+requirePlan |  |
| GET | `/pipeline/officer-activity` | - |  |
| POST | `/pipeline/remove` | checkWriteAccess+requirePlan |  |
| PUT | `/planned-gifts/:id` | - | yes |
| DELETE | `/planned-gifts/:id` | - | yes |
| PUT | `/pledges/:id` | checkWriteAccess | yes |
| DELETE | `/pledges/:id` | - | yes |
| POST | `/pledges/:id/resend` | - | yes |
| GET | `/portfolio/officers` | - |  |
| GET | `/programs` | - |  |
| POST | `/programs` | - |  |
| PUT | `/programs/:id` | - | yes |
| GET | `/receipts/:id/pdf` | - | yes |
| POST | `/recurring/:donorId/resend` | - | yes |
| GET | `/recurring/health` | - |  |
| GET | `/reports/:key` | - | yes |
| GET | `/reports/board` | - |  |
| POST | `/reports/board` | - |  |
| GET | `/reports/board/:id/pdf` | - | yes |
| GET | `/sequences` | - |  |
| POST | `/sequences/:id/enroll` | requirePlan | yes |
| GET | `/sequences/:id/enrollments` | - | yes |
| GET | `/sequences/:id/steps` | - | yes |
| POST | `/sequences/:id/unenroll` | - | yes |
| POST | `/stripe/campaign-link` | - |  |
| POST | `/stripe/donation-page` | - |  |
| GET | `/stripe/online-gifts` | - |  |
| GET | `/stripe/status` | - |  |
| GET | `/tasks` | - |  |
| POST | `/tasks` | checkWriteAccess |  |
| PUT | `/tasks/:id` | checkWriteAccess | yes |
| DELETE | `/tasks/:id` | - | yes |
| POST | `/tasks/:id/complete` | checkWriteAccess | yes |
| POST | `/voice-memos/save` | checkWriteAccess |  |
| POST | `/voice-memos/transcribe` | - |  |
| GET | `/volunteers` | - |  |
| POST | `/volunteers` | checkWriteAccess |  |
| PUT | `/volunteers/:id` | checkWriteAccess | yes |
| GET | `/volunteers/donor-prospects` | - |  |
| GET | `/workflows` | - |  |
| GET | `/workflows/:id/runs` | - | yes |

## ADMIN (61) — requireAdmin — role now revalidated against DB (FINDINGS A5 fix).

| Method | Path | Middleware (beyond requireAuth) | Param |
|---|---|---|---|
| POST | `/admin/debug/sentry-test` | requireAdmin |  |
| POST | `/annual-fund/goal` | requireAdmin |  |
| POST | `/auth/invite` | requireAdmin |  |
| POST | `/billing/create-checkout` | requireAdmin |  |
| POST | `/billing/create-portal` | requireAdmin |  |
| DELETE | `/campaigns/:id` | requireAdmin | yes |
| POST | `/campaigns/:id/send` | requireAdmin+checkWriteAccess | yes |
| POST | `/custom-fields` | requireAdmin+checkWriteAccess |  |
| PUT | `/custom-fields/:id` | requireAdmin+checkWriteAccess | yes |
| DELETE | `/custom-fields/:id` | requireAdmin | yes |
| PUT | `/custom-fields/reorder` | requireAdmin+checkWriteAccess |  |
| POST | `/digests/run` | requireAdmin |  |
| POST | `/digests/run-daily` | requireAdmin |  |
| DELETE | `/donors/:id` | requireAdmin | yes |
| PATCH | `/donors/:id/assign` | requireAdmin+requirePlan | yes |
| PATCH | `/donors/bulk-assign` | requireAdmin+requirePlan |  |
| POST | `/donors/bulk-delete` | requireAdmin |  |
| POST | `/donors/purge-trash` | requireAdmin |  |
| GET | `/email/test-smtp` | requireAdmin |  |
| POST | `/finance/accounts` | requireAdmin+checkWriteAccess |  |
| PUT | `/finance/accounts/:id` | requireAdmin+checkWriteAccess | yes |
| POST | `/finance/budgets` | requireAdmin+checkWriteAccess |  |
| POST | `/finance/funds` | requireAdmin+checkWriteAccess |  |
| PUT | `/finance/funds/:id` | requireAdmin+checkWriteAccess | yes |
| DELETE | `/finance/transactions/:id` | requireAdmin | yes |
| POST | `/financials/month` | requireAdmin |  |
| POST | `/giving-pages` | requireAdmin+checkWriteAccess |  |
| PUT | `/giving-pages/:id` | requireAdmin+checkWriteAccess | yes |
| DELETE | `/giving-pages/:id` | requireAdmin | yes |
| POST | `/goals` | requireAdmin+checkWriteAccess |  |
| POST | `/impact-metrics` | requireAdmin+checkWriteAccess |  |
| PUT | `/impact-metrics/:id` | requireAdmin+checkWriteAccess | yes |
| DELETE | `/impact-metrics/:id` | requireAdmin | yes |
| POST | `/metrics/reset-baselines` | requireAdmin |  |
| POST | `/milestone-drafts/:id/send` | requireAdmin+checkWriteAccess | yes |
| POST | `/org/backfill-gift-touchpoints` | requireAdmin |  |
| GET | `/org/export/csv` | requireAdmin |  |
| PUT | `/org/setup-card` | requireAdmin |  |
| PUT | `/org/smtp` | requireAdmin |  |
| PATCH | `/orgs/:id` | requireAdmin | yes |
| PUT | `/orgs/branding` | requireAdmin+checkWriteAccess |  |
| PUT | `/peer-fundraisers/:id` | requireAdmin+checkWriteAccess | yes |
| POST | `/pipeline/run-auto-lapse` | requireAdmin |  |
| POST | `/pledges/process-reminders` | requireAdmin |  |
| PUT | `/portfolio/officers/:userId/color` | requireAdmin+checkWriteAccess+requirePlan | yes |
| DELETE | `/programs/:id` | requireAdmin | yes |
| POST | `/programs/:id/grants` | requireAdmin | yes |
| DELETE | `/programs/:id/grants/:grantId` | requireAdmin | yes |
| POST | `/receipts/:id/void` | requireAdmin | yes |
| GET | `/receipts/preview` | requireAdmin |  |
| POST | `/receipts/year-end-run` | requireAdmin+checkWriteAccess |  |
| POST | `/recurring/process-dunning` | requireAdmin |  |
| POST | `/sequences` | requireAdmin |  |
| PUT | `/sequences/:id` | requireAdmin | yes |
| DELETE | `/sequences/:id` | requireAdmin | yes |
| PATCH | `/sequences/:id/status` | requireAdmin | yes |
| POST | `/sequences/process` | requireAdmin |  |
| POST | `/stripe/connect` | requireAdmin |  |
| PUT | `/workflows/:id` | requireAdmin+checkWriteAccess | yes |
| POST | `/workflows/run-sweeps` | requireAdmin |  |
| POST | `/workflows/simulate` | requireAdmin |  |

## SUPERADMIN (9) — cross-org; is_super_admin now revalidated against DB (FINDINGS A5 fix). NOT audit-logged (FINDINGS B10).

| Method | Path | Middleware (beyond requireAuth) | Param |
|---|---|---|---|
| GET | `/admin/billing-diagnostic` | requireSuperAdmin |  |
| GET | `/admin/data-integrity` | requireSuperAdmin |  |
| POST | `/admin/data-integrity/fix` | requireSuperAdmin |  |
| GET | `/admin/metrics` | requireSuperAdmin |  |
| GET | `/admin/orgs` | requireSuperAdmin |  |
| GET | `/admin/orgs/:id` | requireSuperAdmin | yes |
| DELETE | `/admin/orgs/:id` | requireSuperAdmin | yes |
| POST | `/admin/orgs/:id/change-plan` | requireSuperAdmin | yes |
| POST | `/admin/orgs/:id/extend-trial` | requireSuperAdmin | yes |

---

## BUILD-45 (2026-08-10) — Donor Portal routes

A NEW auth class exists: **PORTAL** — donor sessions in a separate HttpOnly
SameSite=Lax cookie (`portal_sessions` table, hash-at-rest), read ONLY by
`requirePortalSession`, which ignores `Authorization` entirely; every staff
route ignores the cookie. Proven both directions by `tests/portal.test.js`'s
differential sweep (portal cookie × 15 staff routes → 401; staff JWT × every
portal session route → 401). Tenancy is path-based (`/portal/:orgSlug`);
a session is pinned to ONE org — a valid session against another org's slug
is a 401. In production these routes are reached same-origin through the
vercel.json `/portal-api/*` proxy.

### PUBLIC (portal, 4) — enumeration-safe, rate-limited

| Method | Path | Middleware | Isolation coverage |
|---|---|---|---|
| GET | `/portal/:orgSlug/config` | - | slug→enabled-portal only; theme data is org-authored public content |
| POST | `/portal/:orgSlug/request-link` | portalLinkIpLimiter+portalLinkEmailLimiter | P-2 identical response/timing known-vs-unknown email (tested); S-5 burst-tested per IP AND per target email |
| POST | `/portal/:orgSlug/verify` | portalLinkIpLimiter | S-4: POST-consumed, atomic single-use UPDATE…RETURNING, 15-min expiry, re-request invalidates (all tested) |
| POST | `/portal/:orgSlug/logout` | - | revokes by cookie hash only |

### PORTAL (donor session, 9)

| Method | Path | Middleware | Isolation coverage |
|---|---|---|---|
| GET | `/portal/:orgSlug/session` | requirePortalSession | org-pinned session |
| GET | `/portal/:orgSlug/me` | requirePortalSession | donors = exact-email match in session org only (P-6); Donor B's data proven absent |
| GET | `/portal/:orgSlug/receipts/:id/pdf` | requirePortalSession | S-9: session-scoped, donor-ownership checked; foreign receipt → 404 (tested) |
| POST | `/portal/:orgSlug/impact/:updateId/viewed` | requirePortalSession | org-scoped update lookup → 404 foreign (tested) |
| POST | `/portal/:orgSlug/recurring/:subId/pause` | portalMutationLimiter+requirePortalSession | ownership via donor-email match → foreign 404 (tested); per-sub advisory lock (R-7 tested) |
| POST | `/portal/:orgSlug/recurring/:subId/resume` | portalMutationLimiter+requirePortalSession | same |
| POST | `/portal/:orgSlug/recurring/:subId/amount` | portalMutationLimiter+requirePortalSession | same + server-authoritative repricing |
| POST | `/portal/:orgSlug/recurring/:subId/cancel` | portalMutationLimiter+requirePortalSession | same; double-cancel race → one winner (tested) |
| POST | `/portal/:orgSlug/recurring/:subId/update-card` | portalMutationLimiter+requirePortalSession | foreign sub 404 (tested); returns the EXISTING signed setup-Checkout URL |

### Staff-side portal admin (7)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/portal-settings` | AUTH | org-scoped read |
| PUT | `/portal-settings` | ADMIN+checkWriteAccess | color contrast guard (normalizeAccent), image mime/size validation |
| GET | `/impact-updates` | AUTH | org-scoped |
| POST | `/impact-updates` | ADMIN+checkWriteAccess | targets validated org-owned (fund/campaign) → foreign 404 |
| PUT | `/impact-updates/:id` | ADMIN+checkWriteAccess | org-scoped, same validation |
| DELETE | `/impact-updates/:id` | ADMIN | DELETE convention (ungated by write access) |
| GET | `/portal-audit` | ADMIN | org-scoped audit trail read |
