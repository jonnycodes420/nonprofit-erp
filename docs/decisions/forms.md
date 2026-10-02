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

### EVENTS-2 — the public event page takes a card
- **`POST /e/:slug/checkout` is the donation checkout.** It calls the same named
  `donateHandler` in `routes/give.js` through a small response shim that turns `{url}` into a
  303. There is exactly one place a ticket is priced and one place a gift is written.
  (EVENTS-2)
- **It is a plain form POST**, so the public page takes a card with no JavaScript at all.
  (EVENTS-2)
- **A seat is HELD for 15 minutes while somebody pays (`event_seat_holds`), and capacity is
  registrations PLUS live holds**, computed by `eventSeatsLeft` so the page, the checkout and
  `registerForEvent` cannot disagree. A hold is not a registration and never becomes one on its
  own. (EVENTS-2)
- **A registration is confirmed ONLY by the payment webhook.** A checkout that is never
  completed reaches nothing; its hold runs out and the seats are on sale again. (EVENTS-2)
- **The member price is decided by the SERVER**, from the email, against a current membership in
  that org, matched on exact email. A client claiming to be a member changes nothing, and the
  metadata records which price was applied. A member price is never above the price and never
  below the FMV, by validator and by CHECK. (EVENTS-2)
- **`registerForEvent` stamps `gifts.event_id` on EVERY path, including one where the webhook
  wrote the gift.** It used to stamp only gifts it wrote itself, so every ticket bought online
  left its money uncounted against the event. (EVENTS-2)
- **One QR for every door: `shared/passCode.js`.** `POST /events/:id/scan` reads a ticket or a
  member card. A member card is not a ticket, so it never invents a registration — it names the
  person and says whether they are on the list. `/ticket/:code.png` renders the image for an
  email, because no client renders a `data:` URI. (EVENTS-2, MEMBERS-2)
- **A waiting-list place is offered by a PERSON pressing a button, never by a sweep.** Nothing
  is held and nothing is charged: the offer is the event's link, in order. (EVENTS-2)
- **A renamed public slug keeps the old one in `events.previous_slug` and `/e/:slug` 301s.** A
  link on a poster is not the org's to take back. (EVENTS-2)
- **Money is formatted `en-US`, named, never `toLocaleString(undefined, …)`.** A browser in half
  of Europe flips the separator, and `$25.000` beside a dollar sign reads as twenty-five dollars.
  (EVENTS-2)
- **`/e/*` and `/ticket/*` are `vercel.json` rewrites.** EVENTS-1 shipped the public event page
  without one, so it was unreachable from www.stewardapp.dev until EVENTS-2. (EVENTS-2)

### BUILD-103 — peer-to-peer
- **A peer-to-peer campaign is a giving page with `p2p_enabled`.** There is no second kind of
  page and no second campaign attribution: the thermometer is the one Fundraising already shows.
  A page that already had fundraisers had the switch turned on by the migration. (BUILD-103)
- **A team is a `p2p_teams` row under that page, and its total is a live SUM over the same gift
  rows.** Never a stored counter, so page = teams + solo fundraisers + direct gifts, in cents, by
  construction. The P2P screen prints that identity rather than assuming it. Archiving a team
  leaves its gifts counted on the page: the money did arrive. (BUILD-103)
- **`gifts.show_name_to_fundraiser` is FALSE by default, and the default IS the decision.** A gift
  through a friend's page is still a gift to the organisation, and the friend is not entitled to a
  list of who gave unless each person chose it. `donorLine` in `shared/p2p.js` is the ONE function
  that turns a gift row into something a fundraiser reads: a first name and an amount, or neither.
  (BUILD-103)
- **A fundraiser never sees a donor's email or a gift the donor made elsewhere.** The dashboard's
  SELECT has no email column and there is not going to be one. (BUILD-103)
- **The manage link is hashed at rest (`peer_fundraisers.edit_token_hash`).** A row from before
  this build is migrated on first use, so every link already in an inbox keeps working and stops
  being readable in the database afterwards. `fundraiserByToken` is the one exchange. (BUILD-103)
- **A fundraiser is matched to the CRM by EXACT EMAIL on sign-up, never by name
  (`peer_fundraisers.person_id`).** Somebody nobody has heard of becomes a person typed
  **Volunteer**, never a donor: they are not a donor until they give. (BUILD-103)
- **Every gift through a fundraiser page writes a `gift_soft_credits` row at 100%, role
  `peer_fundraiser`, inside `recordGift`.** Hard credit stays on the donor and no giving total
  anywhere moves. `tests/build103-soft-credit.test.js` plants the three ways that could break.
  (BUILD-103)
- **Steward emails none of a fundraiser's contacts.** The three drafts in `shared/p2p.js` are
  words the fundraiser copies or opens in their own mail client through a `mailto:`. Merge fields
  are the FUNDRAISER'S; the function takes no donor argument, which is why it cannot leak one.
  (BUILD-103)
- **Every share link carries UTM tags** through the same columns every other gift is attributed
  by. The medium is the channel; the campaign is the fundraiser's slug. (BUILD-103)
- **A waiting list of a different kind: a team a supporter starts at sign-up is created by the
  same `p2p_teams` shape the staff screen creates**, so there is one row shape, not two.
  (BUILD-103)
- **Every new Fundraising part id goes in `FR_LEGACY`**, or a link to it silently opens the
  Overview. (BUILD-103)

### GIVE-2 — the form that raises more
- **Never pin Checkout to `payment_method_types`.** Omitting it is what turns on Stripe's dynamic
  payment methods, and it is the ONLY way to be certain nothing is offered that the org's account
  cannot take: the account itself decides. `GET /give-settings/payment-methods` reads the account's
  capabilities so an org can SEE the answer, and it is a report, never a gate. (GIVE-2 §2)
- **Venmo is not offered and that is a fact, not an omission.** Steward takes payments on the org's
  own Stripe account, Stripe does not offer Venmo, and Steward's PayPal connection reads a statement
  rather than taking a payment. The settings card says so rather than showing a row that never
  lights up. (GIVE-2 §2)
- **A suggested amount comes from the org's own gifts or the donor's own history, never from
  anything bought from anybody.** `shared/smartAmounts.js` holds the arithmetic and the sentence;
  the switch is `form_config.smartAmounts`, OFF by default, because a fundraiser who typed four
  numbers is not overruled by a median. Fewer than eight gifts is not a distribution and the typed
  amounts stand. (GIVE-2 §3)
- **`withSmartAmounts` wraps EVERY public form payload.** There are two — `/forms/:id/public` and
  the giving-page payload in crm.js — and the first cut wired only one, so the page a donor actually
  opens still showed Steward's $25/$50/$100/$250 guess. The browser walk caught it. (GIVE-2 §3)
- **A ladder rung missing from `FRIENDLY_CENTS` is a 150% jump.** The first cut skipped $2,000 and
  $3,000, so a donor whose largest gift was $2,000 was asked for $5,000. The list is 1/1.5/2/2.5/3.5
  /5/7.5 in every decade. (GIVE-2 §3)
- **A returning donor's first button is their OWN number, unrounded.** "That, a step up, and a
  bigger step" means the $120 they gave, not the $100 nearest it. (GIVE-2 §3)
- **"Remember me" is opt-in, one-time gifts only, and saves nothing to Steward.** The card lives on
  the org's own Stripe customer; `donors.stripe_customer_id` / `express_pm_id` / `express_pm_brand`
  / `express_pm_last4` are an id and the four digits a person recognises. No card number, no expiry,
  no CVC, ever. (GIVE-2 §4)
- **An express link and a portal link are the same table and must never be the same link.**
  `portal_magic_links.purpose` is load-bearing and BOTH consumers filter on it in SQL: an express
  link may not open the portal and a portal link may not charge a card. (GIVE-2 §4)
- **The express link is consumed by a POST.** A GET never changes state, and a single-use token is
  state. The email's link opens the APP, which then posts. (GIVE-2 §4)
- **The matching-employer list is the org's own typed rows.** `shared/employerMatch.js` has the
  adapter shape for a paid lookup partner and names none, behind `MATCHING_LOOKUP_ENABLED` with no
  provider registered. Resolution order: the org's list, then the curated snapshot in
  `matchingGifts.js` at the root, then a flagged provider. A `form_url` is https or it is refused at
  write time rather than dropped. (GIVE-2 §8)
- **The org may name the monthly suggestion (`orgs.form_upsell_monthly_cents`).** NULL keeps a third
  of the gift, which is every org today. (GIVE-2 §6)

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
- `tests/page-widgets`, `giving-page-builder`, `cover-fees`, `giving-flow-brand`, `build103-soft-credit`
- `shared/p2p.js` — the words, the arithmetic and `donorLine`; `client/src/components/PeerToPeer.jsx`
  (the org's campaign screen), `client/src/pages/ManageFundraiser.jsx` (the fundraiser's dashboard)

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
