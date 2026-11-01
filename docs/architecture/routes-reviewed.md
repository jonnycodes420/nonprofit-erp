# Routes reviewed for ARCH-1 (MAP-1 recommendation #9)

MAP-1 listed 21 routes "called by nothing" and 24 "called by tests only", from a text search.
Each was re-checked by hand on main at 1ef9b5f: client/, server code (including server-rendered
pages, `AC.call`, ctx wiring and schedulers), email bodies, vercel.json rewrites, scripts/,
.github/ and tests/. Line numbers are as of the ARCH-1 branch.

The rule from here on: a route is deleted only when a person-readable search finds no caller in
the client, the server, emails, templates, schedulers, scripts or an outside service (Stripe,
Resend, Mailchimp, PayPal, QBO, Google, Microsoft), and only if its path carries no token,
webhook, public, pay, unsubscribe, callback or run. Anything else needs Jonathan's yes.

## The 21 "called by nothing"

| Route | Who calls it | Decision |
|---|---|---|
| `POST /help/tickets` (routes/agent.js:1907) | Nobody found; searched client/, server, scripts/, .github/, tests/ | Kept (amendment A1) |
| `POST /auctions/run-unpaid-sweep` (routes/auctions.js:82) | Nobody in the repo: a manual ops door (curl). The same sweep runs hourly from routes/jobs.js:252 | Kept (`run` in path) |
| `GET /auction/pay/:token` (routes/auctions.js:633) | The winner email's pay link, routes/auctions.js:313 and :587; vercel.json `/auction/:path*` | Kept |
| `POST /auction/pay/:token` (routes/give.js:4046) | The form on the pay page, routes/auctions.js:663; give.js:3604 and :4050 | Kept |
| `POST /data-health/run` (routes/dataHealth.js:483) | Nobody in the repo: a manual ops door. The nightly job is routes/dataHealth.js:472 | Kept (`run` in path) |
| `POST /data-health/proposals` (routes/dataHealth.js:533) | routes/agent.js:936 (`AC.call`, the Agent's merge proposal) | Kept |
| `GET /emails/journey/:draftId/as-sent` (routes/emailsSent.js:169) | Nobody found; searched client/, server, scripts/, tests/ (the profile reads the same draft through `/donors/:id/emails-received/journey/:ref`) | Kept (amendment A1) |
| `POST /qbo/read/auto/run` (routes/finance.js:3843) | Nobody in the repo: a manual ops door. The hourly job is routes/jobs.js:100-101 | Kept (`run` in path) |
| `GET /pos/attendance-drift` (routes/give.js:309) | Nobody found; searched client/, server, scripts/, tests/ (scripts/seed-demo.js:2631 seeds a fixture for it) | Kept (amendment A1: any other route MAP-1 listed is kept) |
| `POST /connections/sweep` (routes/give.js:1494) | Nobody in the repo, and **no scheduler either**: `sweepQuietConnections` (server.js:2259) is reached only through this route, so it runs only by hand | Kept. A question for Jonathan: should a tick run it? |
| `POST ${base}/undo` = `/removals/undo`, `/volunteer-hub/removals/undo` (routes/removal.js:251) | client/src/components/RemoveMenu.jsx:23 and :40 (built from `base(kind)`); routes/removal.js:222 | Kept |
| `GET /stock-photos/thumb/:id` (routes/stockPhotos.js:112) | The `thumb` URL that `/stock-photos` returns, routes/stockPhotos.js:105 | Kept |
| `POST /volunteer/me/cancel` (routes/volunteerScheduling.js:987) | Forms on the `GET /volunteer/me` page, routes/volunteerScheduling.js:893 and :943, which the emailed volunteer link opens when the org has no slug yet; vercel.json `/volunteer/me/:path*` | Kept |
| `POST /volunteer/me/hours` (routes/volunteerScheduling.js:996) | The form on `GET /volunteer/me`, routes/volunteerScheduling.js:977 | Kept |
| `GET /volunteer/me/waiver` (routes/volunteerScheduling.js:1017) | The link on `GET /volunteer/me`, routes/volunteerScheduling.js:970 | Kept |
| `POST /volunteer/me/waiver` (routes/volunteerScheduling.js:1039) | The form on `GET /volunteer/me/waiver`, routes/volunteerScheduling.js:1030 | Kept |
| `GET /volunteer-hub/settings` | Nobody found; searched client/ (no `volunteer-hub/settings`, no built `volunteer-hub/${…}` that could form it), server, email templates, vercel.json, scripts/, .github/, tests/ | **Deleted** |
| `PATCH /volunteer-hub/settings` | Nobody found; same search | **Deleted** |
| `POST /volunteer-hub/drafts/miss-you` | Nobody found; same search. The hourly reminder sweep still drafts "we miss you" notes (`draftMissYouFor`, routes/volunteerScheduling.js:1524) | **Deleted** |
| `POST /admin/number-checks/run` (server.js:3239) | Nobody in the repo: a super-admin ops door. The nightly tick is server.js:3234 | Kept (`run` in path) |
| `POST /admin/status/run-checks` (server.js:3325) | Nobody in the repo: a super-admin ops door. The ticks are server.js:3225-3226 | Kept (`run` in path) |

## The 24 "called by tests only" (all kept)

| Route | Test caller | Decision |
|---|---|---|
| `GET /agent/runs/:id` (routes/agent.js:2361) | tests/tenant-matrix.test.js:610 | Kept |
| `GET /agent/plans` (routes/agent.js:2374) | tests/agent3-catalog.test.js:308 | Kept |
| `POST /mailbox/run-replies` (routes/auctions.js:88) | tests/fix33-sync-proof.test.js:229 | Kept |
| `POST /billing/band/apply-now` (routes/billing.js:1327) | tests/pricing1-bands.test.js:237 | Kept |
| `POST /board-pack/schedule/run` (routes/crm.js:3140) | tests/reports3-board-pack.test.js:362 | Kept |
| `POST /journey-sends/run` (routes/crm.js:13457) | tests/auto1-send.test.js:156 | Kept |
| `POST /journeys/run-sweep` (routes/crm.js:13853) | tests/fix49/one-rule.js:107 | Kept |
| `POST /scores/recompute` (routes/crm.js:15832) | tests/engage1-score-breakdown.test.js:12 | Kept |
| `POST /webhooks/deliveries/:id/resend` (routes/crm.js:18484) | tests/tenant-matrix.test.js:449 | Kept |
| `POST /qbo/auto-sync/run` (routes/finance.js:3851) | tests/fix34/d-books-paypal.js:116 | Kept |
| `POST /xero/auto-sync/run` (routes/finance.js:4013) | tests/connect2/xero.js:99 | Kept |
| `POST /pos/sales` (routes/give.js:271) | tests/intpos-sale-is-not-a-gift.test.js:94 | Kept |
| `GET /pos/buys-never-given` (routes/give.js:283) | tests/intpos-sale-is-not-a-gift.test.js:166 | Kept |
| `GET /pos/event/:id/revenue` (routes/give.js:329) | tests/intpos-sale-is-not-a-gift.test.js:115 | Kept |
| `PUT /org-form/page/settings` (routes/give.js:2654) | tests/giveedit1-pages.test.js:155 | Kept |
| `GET /org-form/page/history` (routes/give.js:2674) | tests/giveedit1-pages.test.js:162 | Kept |
| `POST /org-form/page/history/:vid/restore` (routes/give.js:2677) | tests/giveedit1-pages.test.js | Kept |
| `POST /org-summary/check` (routes/homeBundle.js:77) | tests/scale2-same-numbers.test.js:280 | Kept |
| `GET /prospects/room-to-give` (routes/prospect.js:53) | tests/prospect1-who-sees.test.js:117 | Kept |
| `POST /volunteer-hub/magic-link` (routes/volunteerScheduling.js:1066) | tests/mail-suppression.test.js:322 | Kept |
| `POST /volunteer-hub/run-reminders` (routes/volunteerScheduling.js:1501) | tests/mail-suppression.test.js:304 | Kept |
| `GET /mailchimp/webhook/:secret` (routes/webhooks.js:1734) | Mailchimp (its webhook check); tests/int3-optout.test.js:103 | Kept |
| `POST /mailchimp/webhook/:secret` (routes/webhooks.js:1736) | Mailchimp (unsubscribe events); tests/int3-optout.test.js | Kept |
| `GET /why/questions` (routes/why.js:121) | tests/prospect1-who-sees.test.js:128 | Kept |
