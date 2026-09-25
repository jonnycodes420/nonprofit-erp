# Portal and donor network

Read this when you touch the donor portal, white-label surfaces, /giving, the directory, follows or global donor accounts.

## Rules
- **Hold THE WALL: a donor may see across orgs; an org may never.** No org-side handler reads the
  `donor_account*` tables or `donor_org_follows`. (BUILD-46, BUILD-47)
- **Add every new org-side route that touches donor identity to `tests/org-blindness.test.js` in the same
  commit.** (BUILD-46)
- **Keep `DONOR_ACCOUNTS_ENABLED` and `NETWORK_SIGNUP_ENABLED` off in prod.** Unset, `requireFlag` makes
  those routes 404 exactly like unknown routes. Flipping either needs Jonathan's brand, legal and
  live-drill decisions. (BUILD-46)
- **Link a donor account to org records only by an exact match on a VERIFIED email.** Never by name or
  fuzzy match. Only the donor unlinks, and only an explicit re-add relinks. (BUILD-46, BUILD-47)
- **Make every account and portal token CSPRNG, single-use, hash-at-rest and short-lived.** Supersede it on
  re-request, and give identical responses for known and unknown emails. (BUILD-45, BUILD-46, BUILD-49)
- **Send every account-lifecycle email and portal magic link through the queued `notification_failures`
  path.** Never fire-and-forget. (BUILD-46)
- **Revoke donor sessions on a password change AND an email change.** A new email must verify on its own
  before anything links. (BUILD-46)
- **Keep portal sessions in a separate HttpOnly cookie and table.** Portal and staff credentials never
  cross. Reach them same-origin through the `/portal-api`, `/account-api` and `/network-api` proxies.
  (BUILD-45, BUILD-46)
- **Keep the portal opt-in per org (`portal_settings.enabled` defaults false).** Disabling it kills live
  sessions. Every link request, session and mutation writes `portal_audit_log`. (BUILD-45)
- **Compute every portal and `/account` figure as a live sum over the same `gifts` rows the CRM reads.**
  Store no rollups, and show no streaks, percentages, tiers or badges. (BUILD-45, BUILD-46)
- **Portal recurring changes:** amount is server-repriced minor units with floor `min_recurring_cents`,
  `proration_behavior:none`. Pause is `pause_collection` void, cancel is `cancel_at_period_end`, and a
  card update reuses the setup-Checkout. (BUILD-45)
- **Wire a portal cancel or pause to the officer:** an email via `notifyUserOnce`, a due-today task, and
  the day-view bucket. (BUILD-45)
- **Render the org's name on donor-facing surfaces via `donorFacingOrgName()`**
  (`portal_settings.display_name`), never the staff name. (BUILD-58 W-2)
- **Send white-label colours through `normalizeAccent`, which deepens them and tells the admin.** "Powered
  by Steward" is off by default. `Portal.jsx` is a documented brand-allowlist exclusion. (BUILD-45)
- **Draw every banner with `PortalBanner.jsx` at `PORTAL_HEADER_RATIO`.** The editor preview uses the same
  ratio and style, and the focal point is `header_focal_x/y`. (BUILD-59)
- **Fill the banner with a solid band in the org's primary colour while it loads.** Never a spinner, grey
  or generated art. (BUILD-59)
- **Share the scrim model in `lib/portalScrim.js` between render and test.** Brass and sage are accent-only,
  never body text. (BUILD-59)
- **Serve `/portal-assets/:id?w=` only at the `PORTAL_ASSET_WIDTHS` widths.** Never upscale. (BUILD-59)
- **List only orgs that are enabled AND `network_listed` in the directory.** Return listing-card fields
  only, and never add donor counts, supporter numbers or activity signals. (BUILD-47)
- **Give byte-identical response bodies for all outcomes of adding an org** (linked or followed), so no
  oracle reveals a record. (BUILD-47)
- **Show follows with zero history figures and only org-wide impact updates.** A follow never resurfaces an
  org the donor hid. (BUILD-47)
- **Gate every giving-account entry point on `givingAccountEntry(org)`.** Put PII in the URL fragment,
  never the query string. The year-end PDF footer carries no email. (BUILD-49)
- **Serve `/giving` from the second Vite entry `client/giving.html`, with real meta.** The vercel.json
  rewrite sits before the SPA catch-all. (BUILD-49)
- **Portal tier:** `orgPlanTier` returns `portal` before the trialing shortcut, and CRM routes answer 403
  `portal_tier` through ONE `app.use` gate. (BUILD-46)
- **Keep a network-signup org invisible and un-giftable until three things pass:** the live EIN check
  (`ein_registry`, empty fails safe), Stripe `charges_enabled`, and human approval. The 6h sweep delists.
  (BUILD-46, BUILD-58 W-1)
- **Match impact updates deterministically over gift attribution** (trailing 24 months, targeted first,
  then org-wide). Never use a classifier. (BUILD-45)
- **Hide Donor Portal from CRM navigation through `CRM_HIDDEN_TABS` + `tabAllowed` in App.jsx.** A
  `plan="portal"` org keeps the tab. Nothing was deleted, so re-enable by removing one id. (BUILD-84)
- **Add every new column that points at a portal asset to `collectLiveAssetRefs` and the pointer history.**
  Otherwise the 90-day purge destroys a live image. (BUILD-56, BUILD-95)

## Gotchas
- **The battery boot needs `DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1`.** Without them thirteen
  suites fail on a `/network/signup` 404. (BUILD-87)
- **Rate-limit bursts use an `x-test-*` seam that only works under `DISABLE_RATE_LIMIT=1`.** (BUILD-45)
- **`/portal/:slug/give-default` answers 401 to an anonymous visitor on purpose.** A "no 4xx" browser
  collector must name it. (BUILD-95)
- **A `vite build` preview has no `/portal-assets` proxy.** Set `VITE_ASSET_ORIGIN` for local captures and
  leave it unset in prod. (BUILD-59)
- **A same-path hash change on an open `/giving` does not re-derive auth mode.** Entry links must be fresh
  navigations. (BUILD-49)

## Where the code is
- `client/src/pages/Portal.jsx` (donor portal), `GivingDashboard.jsx` (`/giving`), `JoinNetwork.jsx`
- `client/src/components/PortalBanner.jsx`, `DonorPortalHub.jsx`; `client/src/lib/portalScrim.js`,
  `portalScale.js`, `portalTheme.js`, `portalCrop.js`
- `server.js` `portalThemePayload`, `givingAccountEntry`, `linkOrgJoinsNetwork`, `requireDonorAccount`,
  `requireFlag`, `stripeChargesEnabled`
- `scripts/load-irs-ein-registry.js` — the EIN registry loader (monthly)
- `tests/org-blindness`, `portal`, `donor-accounts`, `donor-linking`, `donor-dashboard`, `network-gate`,
  `network-directory`, `donor-front-door`, `portal-visual`, `portal-contrast`
