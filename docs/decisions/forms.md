# Forms and giving pages

Read this when you touch giving pages, the giving-page builder, widgets, peer-to-peer or form configs.

## Rules
- **Declare a widget only in `shared/pageWidgets.js`.** The server validator, the renderer
  (`PortalWidgets.jsx`) and the editor all read it. `tests/page-widgets.test.js` requires a renderer branch
  for every widget. (BUILD-95 §5B)
- **Make the surface a filter, not a fork.** A widget lists its surfaces, and the server refuses it anywhere
  else. `give` and `mygiving` are portal-only, so a donor's own history can never reach a public giving
  page. (BUILD-95 §5B)
- **Keep one builder and one renderer for both surfaces.** `/portal-editor?page=gp_…` arranges a giving
  page, and `resolveWidgetsPublic` resolves widgets for both. Never write a second builder or resolver.
  (BUILD-95 §5B)
- **Keep the gift form out of the registry and always render it.** `giving_pages.form_position` chooses only
  whether the form leads the page or follows the story. (BUILD-95 §5B)
- **Keep draft and published state on `giving_pages` itself (`draft`/`published` JSONB).** A draft never
  reaches a donor, and an unbuilt page renders byte-for-byte as it always did. (BUILD-95 §5B)
- **Answer the draft route with `draft`, not `widgets`.** It is one contract for one editor. (BUILD-95 §5B)
- **Let a built page replace the record's title, story and image, and lead with its hero.** The thermometer
  follows the ask. Never open a page on a bare `$0`. (BUILD-95 §5B)
- **Put the control that moves the form in the editor chrome, and show the form in the preview.** Never
  badge a giving page with SAMPLE DONOR DATA. (BUILD-95 §5B)
- **Have `pruneWidgetAssets` and `collectLiveAssetRefs` read every page of the org:** `portal_pages` AND
  `giving_pages`. A photo on a live giving page must never be soft-deleted. (BUILD-95 §5B)
- **Let the page's configured campaign win over a client-sent one (`effectiveCampaignId`).** A linked page
  shows the campaign's live raised and goal. Only an unlinked page keeps its own `goal_amount`.
  (attribution FIX 2026-08-04)
- **Count page and campaign goal progress by the gift amount (donor intent).** Receipts, Reports and Finance
  keep the charged total, including a covered fee. (attribution FIX 2026-08-04)
- **Sell tickets and memberships as giving-page modes (`?event=`, `?membership=`), never as path segments
  or widgets.** `/give/:org/:page/:fundraiser` would swallow a path segment. (BUILD-98 P4, BUILD-101)
- **Price tickets and memberships on the server from the level.** Ignore the page's amount, apply no fee
  gross-up, and have the webhook re-read the level org-scoped. (BUILD-98 P4, BUILD-101)
- **Render the org name on the three public give payloads via `donorFacingOrgName()`**
  (`portal_settings.display_name`), never the staff "(Demo)" name. (BUILD-58 W-2)
- **Build every share, QR and embed URL with `publicAppUrl()` (publicUrl.js).** Never use a deployment host
  or a request-derived host. (publicUrl FIX 2026-08-04)
- **Style public pages (`Donate.jsx`, `ManageFundraiser.jsx`) with `publicTheme.js`, not `shared.jsx`'s
  `T`.** `Donate.jsx` is a named exclusion from the modal-shell guard. (BUILD-87 F.1)

## Gotchas
- **A browser assertion on the builder can pass for the wrong reason.** A widget's chrome label carries its
  name, so open the palette and read the palette. (BUILD-95 §5B)
- **A `useCallback` that gains a closed-over value needs it in its deps,** or it goes stale (`apiBase`,
  `formPosition`). (BUILD-95 §5B)
- **"Set up online giving" ticks on EITHER a processor OR a giving source.** "Where giving comes in" lives
  on Integrations, not in the page builder. (BUILD-95 §4)

## Where the code is
- `shared/pageWidgets.js` — the one widget registry (`WIDGETS`, `SURFACES`, `typesForSurface`)
- `client/src/pages/PortalEditor.jsx` — the one builder, portal or `?page=gp_…`
- `client/src/components/PortalWidgets.jsx` — the one renderer
- `server.js` `resolveWidgetsPublic`, `/giving-pages/:id/page/{draft,publish,starter,revert}`
- `client/src/pages/Donate.jsx` — org page, giving page, peer page, `?event=`/`?membership=` modes
- `client/src/components/Settings.jsx` `GivingPagesManager` — list, create, share, fundraisers
- `tests/page-widgets`, `giving-page-builder`, `cover-fees`, `giving-flow-brand`

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Database tables (moved from the old "Database — key tables and columns")

### Giving Pages — 2026-07-15
Campaign-specific donation pages, e.g. `/give/:orgSlug/:pageSlug` — distinct from the one org-wide `/give/:orgSlug` page, and **not** the same concept as the `campaigns` table (email campaigns). A gift can carry neither, either, or both of `gifts.campaign_id` (which *email* got them here) and `gifts.giving_page_id` (which *donation page* they gave through) — two independent questions.

- **`giving_pages`** — id, org_id, slug (unique per org, not globally — the public URL is already namespaced by org_slug), title, goal_amount, story, image_url, fund_id (nullable — a page designated to a fund IS that fund's ask, and `Donate.jsx` hides the fund selector when set), status (`active`\|`archived`), created_at, updated_at.
- **`gifts.giving_page_id`** — nullable, no FK constraint (deleting a page never fails/cascades; existing gifts simply keep an id that no longer resolves — same "tolerated dangling reference" pattern as elsewhere, see "Admin data integrity"). Progress bars are always `SUM(gifts.amount) WHERE giving_page_id = ?`, computed live, never a manually-set counter.
- **Archiving** (`PUT /giving-pages/:id`, `{status:'archived'}`) makes the public view route 404 (indistinguishable from never-existing) and makes `POST /donate/:orgSlug` reject new donations against it with 400 — both enforced by `WHERE status='active'` clauses, not a soft UI-only hide. Hard delete (`DELETE /giving-pages/:id`) is separate and irreversible; gifts already attributed to a deleted page are preserved (dangling reference, as above).
- `Donate.jsx` (`client/src/pages/Donate.jsx`) renders the org-wide page, every Giving Page, and every peer-to-peer fundraiser page (below) from one component — not three forks. It branches on whether `useParams()` has `pageSlug`/`fundraiserSlug`, fetches the matching public data endpoint, and threads `givingPageId`/`peerFundraiserId` into `POST /donate/:orgSlug`'s Stripe Checkout metadata.
- `QrCodeBlock`/`EmbedCodeBlock` (`client/src/components/ShareBlocks.jsx`) — one QR/embed mechanism parameterized by URL, reused for the org-wide page, each Giving Page, and each peer fundraiser's own link. Deliberately doesn't import the admin app's `T` design tokens (see file comment) — it renders on both the authenticated Settings screen and fully public pages, which carry their own separate token sets.
- Settings.jsx's `GivingPagesManager` — list/create/edit/archive/delete UI, each page's row expands into a "Share" panel (QR/embed) and (as of peer-to-peer fundraising below) a "Fundraisers" panel.

### Peer-to-peer fundraising — 2026-07-15
A supporter starts their own personal fundraiser under a live Giving Page — turning one donor-facing page into many supporter-facing ones, each shareable to a network the org itself has no relationship with. The single most-cited differentiator of Givebutter-style tools in this product's competitive research; everything else built this session makes Steward better at managing donors it already has, this is the one growth-loop feature.

- **`peer_fundraisers`** — id, org_id (denormalized from giving_page_id specifically so the codebase's "AND org_id = ?" convention — see "Org_id scoping" below — works directly on this table without every query needing the join), giving_page_id (`ON DELETE CASCADE` — a fundraiser cannot outlive its parent campaign, "no such thing as a fundraiser not tied to a campaign"), name, email, slug (unique per giving_page_id, not globally), personal_goal_amount, story, image_url, status (`active`\|`archived`), edit_token (unique, long random value), created_at, updated_at.
- **`gifts.peer_fundraiser_id`** — nullable, no FK (same tolerated-dangling-reference pattern as giving_page_id). A peer-fundraiser gift always carries **both** `peer_fundraiser_id` and the parent's `giving_page_id` — `POST /donate/:orgSlug` re-derives `giving_page_id` from the fundraiser row server-side rather than trusting the client, so the two can never disagree. This is what makes rollup free: the parent page's own `SUM(amount) WHERE giving_page_id=?` already includes every peer gift with zero extra aggregation, and the fundraiser's personal total is the identical pattern one level down (`SUM(amount) WHERE peer_fundraiser_id=?`).
- **No account system for v1** — `edit_token` (same shape as `invites.token`: two concatenated stripped UUIDs, 64 hex chars, stored and looked up directly) is the entire "manage your fundraiser" auth model. `POST /org/:orgSlug/giving-page/:pageSlug/fundraisers` (public, `donateLimiter`) creates the row and emails the supporter a `/fundraiser/manage/:token` link via `sendFundraiserManageEmail()` — **the token is deliberately never returned in the create response itself**, only via email to the address the caller claims is theirs. (Unlike `invites.token`, which is safely returned to the *authenticated admin's own* response because the caller is already a trusted, accountable staff member — this route is fully public and unauthenticated, so returning the token directly would let anyone submit a stranger's real name+email and get durable control of a page attributed to them.) `GET`/`PUT /peer-fundraisers/manage/:token` (public, own `fundraiserManageLimiter` — a separate budget from `donateLimiter` so a fundraiser owner editing their page can't get rate-limited out by unrelated donor traffic sharing their IP) can edit name/goal/story/image but never status/slug/email — status is admin-only (below), slug/email changes would break the link already shared.
- **Admin takedown** — anyone can spin up a public page under an org's name, so `GET /giving-pages/:id/fundraisers` (requireAuth) lists every fundraiser under a page in Settings.jsx's expandable "Fundraisers" panel, and `PUT /peer-fundraisers/:id` (requireAdmin + checkWriteAccess, status-only — not a general edit route, content edits are the owner's own business via their token) lets staff archive one immediately. Archiving has the exact same effect as archiving a Giving Page: the public fundraiser page 404s and `POST /donate/:orgSlug` rejects new donations against it. Both admin routes explicitly omit `edit_token` from their SELECT column list — the admin UI has no legitimate reason to see a supporter's own credential.
- **Leaderboard** (public Giving Page view, ranked by amount raised, active fundraisers only) — this is a fundraiser-facing leaderboard (people who opted in to solicit on the org's behalf), not the donor-facing tiers/badges/leaderboards the "Strategic pivot" section documents as deliberately rejected. That rejection was about gamifying a *donor's own* giving history in a donor-facing portal; this ranks *fundraisers'* voluntary campaign performance, the same standard mechanic every P2P fundraising product (walk-a-thons, Givebutter teams, GoFundMe teams) ships — a different concept, not a quiet reversal of that decision.
- New routes on `Donate.jsx`: `/give/:orgSlug/:pageSlug/:fundraiserSlug` (fundraiser's own public page, same component as the org-wide/Giving-Page cases) and `/fundraiser/manage/:token` (`ManageFundraiser.jsx` — separate lightweight page, not a `Donate.jsx` branch, since it's an edit form not a donation form).
- `client/src/pages/publicTheme.js` — shared `T`/`fmtMoney` for the app's fully public pages (`Donate.jsx`, `ManageFundraiser.jsx`), which render outside the authenticated app shell and don't use `components/shared.jsx`'s `T` (a different, admin-app palette). Factored out once a second public page needed the exact tokens `Donate.jsx` already had locally, rather than letting a hand-copied second `T` drift from the first.
