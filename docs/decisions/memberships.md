# Memberships

Read this when you touch memberships, levels, renewals or member benefits.

## Rules
- **A member is not a donor, even when one person is both, and a membership PAYMENT is a gift and nothing else.**
  Membership money and donation money are the same ledger rows. (BUILD-101)
- **Refuse a level whose FMV exceeds its price, at the route and by the CHECK on `membership_levels`.**
  FMV is the org's number and Steward never estimates it. $0 FMV is stated in a sentence (`fmvSentence`). (BUILD-101)
- **Only admins set level prices.** A level somebody has held can be retired but never deleted
  (409 `level_in_use`). (BUILD-101)
- **One current membership per person is the database's rule: `uq_memberships_current`.**
  `enrollMembership` claims the membership row BEFORE any money is written. If the gift then fails,
  the claim is released. A second enrolment gets 409 `membership_current`. (BUILD-101)
- **Pay through `recordGift` with `quidProQuoValue` set to the level's FMV.** The existing receipt then
  states the deductible split with no new renderer. A retry rides `gifts.idempotency_key`. (BUILD-101)
- **Compute expiry in civil dates (`expiryFor` in shared/membership.js).** 12 months from 15 March runs
  through 14 March. 29 Feb plus 12 months ends 27 Feb. Calendar-year terms end 31 Dec. Lifetime has
  no expiry. (BUILD-101)
- **Status is DERIVED from the dates by `statusOn`: active, then grace for `orgs.membership_grace_days`,
  then lapsed.** The sweep only writes that status down. (BUILD-101)
- **Cancelling is never write-gated and never refunds.** A refund is its own act on the gift. (BUILD-101)
- **`processMembershipRenewals` opens ONE renewal thread per expiry and sends nothing.** It fires inside
  `orgs.membership_renewal_days`, with the note drafted on `threads.draft_note` (`membershipRenewalDraft`).
  (BUILD-101)
- **Key the renewal thread to that expiry (`renewal_thread_for`).** A second sweep or a dismissed thread
  never reopens for the same date. A person already holding an open thread is retried next sweep.
  (BUILD-101)
- **Never open a renewal thread for an expiry already past, or for someone deceased, do-not-contact or
  do-not-solicit.** An imported membership is history. (BUILD-101)
- **`renewMembership` is the one renewal path.** The old row becomes `renewed` and the new row points
  back through `renewed_from`. It starts the day after the old expiry while current or in grace, or today
  once lapsed. It is advisory-locked per person. (BUILD-101)
- **Inside `recordGift`, a gift of EXACTLY the level price from someone due to renew IS the renewal.**
  A near miss is a plain gift. A payment that already states a quid pro quo is never read as a renewal,
  and neither is an instalment or a recurring charge. (BUILD-101)
- **A renewal closes its thread as an OUTCOME on the payment's own timeline line.** (BUILD-101)
- **Home's membership sentence appears only when the count is non-zero (`membershipSentence` in
  shared/homeNote.js).** (BUILD-101)
- **A lapsed member is a PERSON, counted once, through `LAPSED_MEMBER_SQL`.** Their latest membership
  lapsed and they hold none now. That one predicate drives the count, the list and `?status=lapsed`, so
  someone who rejoined is never counted. (BUILD-101)
- **Drift, LYBUNT, SYBUNT and the lapsed-donor lists never read `memberships`.** A lapsed member can be
  a current donor at the same time, and the page shows both. The suite proves the separation byte for
  byte. (BUILD-101)
- **"Still gives" means a gift that was not a membership payment.** (BUILD-101)
- **Online, `/donate` prices from the LEVEL and ignores the page's amount, with no fee gross-up.**
  Auto-renew is a yearly subscription and is offered only on 12-month levels. The page states benefits
  and the deductible part before payment. (BUILD-101 Part 4)
- **The webhook re-reads the level scoped to the org.** It takes the level from
  `metadata.membership_level_id`, or from `recurring_subscriptions.membership_level_id` for a renewal
  charge. Never trust the client for price or level. (BUILD-101 Part 4)
- **`attachOnlineMembership` is the one online step, keyed on the GIFT under a lock.** The first charge
  and the checkout event arrive in either order and still produce exactly one membership. A buyer who
  already holds one is renewed. (BUILD-101 Part 4)
- **A failing membership card rides the existing dunning and card-expiry machinery unchanged.**
  The membership's dates decide its status. (BUILD-101 Part 4)
- **Membership revenue and donation revenue are TWO columns summed in cents, never one "revenue".**
  A membership payment is a gift a membership points at (`MB_GIFT_SQL`). Together the two columns
  cover every gift exactly once. (BUILD-101 Part 5)
- **Membership reports are `REPORT_HANDLERS` keys on the one CSV layer (`reportToCsv` +
  `sendReportCsv`).** The five in `STANDARD_REPORTS` share one computation with the saved report. A
  membership counts in the month of the payment that bought it. (BUILD-101 Part 5)
- **Import memberships as presets on the ONE donor mapper (shared/membershipImport.js), never a second
  importer.** The fields are first-class mapper targets and ride the LAST chunk of
  `/donors/import-combined`, so every person already exists. (BUILD-101 Part 6)
- **An imported membership matches the person by exact email, then by name (oldest record).** It
  matches the level case-insensitively. An unknown level is HELD by line and never created. (BUILD-101 Part 6)
- **An imported membership is history only: no gift and no ledger row.** A re-run adds nothing. A bare
  "Level" header is claimed only beside a membership date column. (BUILD-101 Part 6)

### MEMBERS-2 — the member's own side
- **"Your page" is ONE page per person per org (`/you/:orgSlug`), server-rendered on
  `shared/publicPage.js`.** The volunteer page and the donor portal are sections of it, not
  surfaces of their own. A live `/volunteer/me?t=` link is exchanged for a session here; an
  expired one still falls through to the old page's words. (MEMBERS-2)
- **A section with nothing in it does not render.** Not an empty state, not a "you have no
  tickets" card — nothing. `sectionsFor` in `shared/supporterPage.js` decides. (MEMBERS-2)
- **The emailed link is single-use, hashed at rest and lasts 15 minutes; spending it mints a
  30-day session in its own cookie (`steward_you`, `supporter_sessions`).** The token rides the
  URL FRAGMENT, so it never reaches a server log or a Referer header, and the GET that lands on
  `/you/:slug/enter` writes nothing: the page POSTs the token and the POST consumes it.
  (MEMBERS-2)
- **Every query on the page is scoped by (org_id, person_id) from the SESSION**, never from the
  URL or a form field. `tests/members2-isolation.test.js` plants the three ways that could
  break. (MEMBERS-2)
- **The link comes back in a response ONLY under TEST_MODE.** A staff member who could read a
  token could open somebody else's page, so "Send their page link" returns a sentence and
  nothing else. (MEMBERS-2)
- **Renewing prices from the level through the existing `?membership=` path, and a recurring
  change goes to the donor portal's own routes.** There is no second money path on this page.
  Turning auto-renew off is the existing `cancel_at_period_end`; the term already paid for runs
  to its end. (MEMBERS-2)
- **One QR format for every door (`shared/passCode.js`): `STW1.<kind>.<org>.<id>.<exp>.<sig>`,
  HMAC over `JWT_SECRET`.** A member card and an event ticket are the same string with a
  different `kind`, so there is one scanner. A code from another org is refused by the org
  segment, not only by the signature. (MEMBERS-2)
- **The member card is rendered by `memberCard.js`, required by both the staff route and the
  member's own download.** Two renderers is how the staff copy and the member's copy end up
  disagreeing about one membership. (MEMBERS-2)
- **The installed app is the ORG's, not Steward's:** one manifest per org
  (`/you/:slug/manifest.webmanifest`), `display: standalone`, and ONE icon —
  `/you/:slug/icon.svg`, a tile in the org's band with its logo or its initial, declared
  `sizes: "any"`. Declaring `192x192` for a logo nobody measured is how an installed app gets a
  blurred tile. (MEMBERS-2)

### PARITY-2 Part 1: the membership page
- **The membership page is a MODE of the org's giving page, `/give/:orgSlug?memberships`, never a path
  segment.** A page slug "join" must stay the org's to use (the forms.md mode rule). It lists every level
  that is for sale and not hidden, in `position` order, from `GET /org/:orgSlug/memberships/public`.
  (PARITY-2)
- **Hidden is not retired.** `hidden` takes a level off the page and the hub count; its own
  `?membership=` link still sells it. Retired (`active=false`) cannot be bought at all. (PARITY-2)
- **One public shape for a level (`publicLevelPayload`)**, used by the single-level page and the
  membership page, so the two cannot describe one level differently. Every card states the deductible
  part in a sentence before payment. (PARITY-2)
- **Join is the existing checkout.** The card posts `membershipLevelId` to `/donate/:orgSlug`; the
  server prices it, the webhook writes the membership, gift and receipt through
  `attachOnlineMembership`. A buyer who already holds a membership is renewed onto the level chosen,
  starting the day after the current one ends. (PARITY-2)
- **A signed-in member is known by the portal session only** (`GET /portal/:slug/give-default` now
  also returns `membership` and `prefill`, read through `req.portal`, never the URL). Their card shows
  the level and expiry and offers Renew; an auto-renewing or lifetime holder is offered no button. With
  the org's portal off there is no sign-in, and Join still renews a holder by exact email. (PARITY-2)
- **Words are anybody's with write access; money is an admin's.** `PUT /membership-levels/:id` lets
  any writer change name, description, benefits and hidden, and refuses (403) a change to price, FMV,
  term, scope or `active` from a non-admin. `PUT /membership-levels/order` (admin) takes EVERY level id
  once and writes `position` 1..n in one transaction. (PARITY-2)
- **A one-month term (`1_month`) runs from the start date through the day before the same date next
  month, clamped (31 Jan runs through 27 Feb).** It auto-renews as a MONTHLY subscription on the
  existing recurring path (`autoRenewFrequency`); the donate handler refuses any other frequency for
  it, as it refuses monthly for a 12-month level. (PARITY-2)
- **A monthly level opens no renewal thread and is never matched from a plain gift
  (`NO_RENEWAL_THREAD_TERMS`).** With a 30-day window a monthly member is always "due", so the sweep
  would raise a thread every month and every gift of the price would be read as a renewal. It renews
  by its subscription or by its own Renew button; the sweep still writes grace and lapsed from the
  dates, with the org's one grace period. (PARITY-2)

## Gotchas
- **Generate a renewal-window fixture from today.** The window is a fact about today, so a fixed-date
  file goes stale. (BUILD-101 Part 6)
- **Import extras are not a column ledger.** The import receipt crashed into the error boundary on a
  membership file that had extras and no ledger. Guard each separately. (BUILD-101 Part 6)
- **A swallowed React crash raises no page error.** In browser legs, listen for the error boundary's
  console line. (BUILD-101 Part 6)
- **Compare history rows by id, not object identity.** The profile listed the current membership again
  beneath itself. (BUILD-101)
- **Merge membership settings over the STORED values.** A partial save must not reset the other fields.
  (BUILD-101)
- **`POST /memberships/run-sweep` accepts a pinned `today` only under TEST_MODE.** (BUILD-101)

## Where the code is
- `shared/membership.js` — `validateLevel`, `fmvSentence`, `expiryFor`, `statusOn`, `renewalStart`, `inRenewalWindow`
- `shared/membershipImport.js` — presets, header words, `membershipColumns`, `buildMembershipRows`
- `server.js` `enrollMembership` / `renewMembership` / `attachOnlineMembership` / `importMemberships`
- `server.js` `processMembershipRenewals` (hourly), `LAPSED_MEMBER_SQL`, `MB_GIFT_SQL`
- `GET /memberships/:id/card.pdf` — the one-page member card (ack-letter pdfkit pattern)
- `client/src/components/Memberships.jsx` — `MembershipPanel` (profile) and `MembersView` (Fundraising → Members)
- `client/src/pages/Donate.jsx` `MembershipPage` — `/give/:slug?membership=<levelId>`
- `client/src/pages/MembershipsPage.jsx`: `/give/:slug?memberships`, every level as a card (PARITY-2)
- `waysToGive.js`: the give hub's list of the org's open doors (PARITY-2)
- `routes/supporter.js` — "Your page"; `shared/supporterPage.js` (what shows, and every sentence),
  `shared/passCode.js` (the one QR), `memberCard.js` (the card PDF)
- `tests/members2-isolation.test.js` — a link opens one person's page and nobody else's
