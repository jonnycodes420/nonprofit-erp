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
