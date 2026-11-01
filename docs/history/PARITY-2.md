## PARITY-2 · Match the leader's public pages and books sync (2026-10-02)

Jonathan walked the leading platform's tours of membership signup, books sync, peer-to-peer, event and
auction pages; the call, as in PARITY-1, was to be just as good at a better price. Five parts built in
parallel worktrees, merged one PR each (#111 to #115), every battery green before its merge.

- **Peer-to-peer (#111):** the thermometer gained a donor count and a countdown; Individuals and Teams
  leaderboards (top 10, See all, one query per board); fundraiser pages with recent donors (first name
  only when the donor chose it), a team badge and UTM share links; a public team page (`?team=`) with
  captain, members, goal and total; an optional approval step; staff edits; each fundraiser's gifts as
  a Figure; four coaching drafts per fundraiser that Steward never sends.
- **Event page (#112):** hero image or video (YouTube or Vimeo, rebuilt from the id), start and end
  times in the org's zone, sponsor cards with benefits, a Donate button for people who can't come
  through the same `donateHandler`, a share row, a gallery shown after the event, a timed .ics, and
  staff can finally publish the page and edit its address. EVENTS-2's phone check-in was already
  built; it is now reachable from the guest list.
- **Membership page and Give hub (#113):** `/give/:slug?memberships` lists every level as a card with
  Join straight to that level's checkout; a signed-in member sees their level, expiry and Renew; a
  monthly term with no renewal thread; edit, hide and reorder on the Members screen. The org's give
  page now ends with "More ways to give" from one helper (`waysToGive.js`).
- **Auctions (#114):** items, bidders, bids, closing to the second on the database clock, ties to the
  earliest bid, winners, pay links through the org's own Stripe Checkout, the deductible part on the
  receipt as winning bid minus FMV, the donated item as an in-kind gift on a staff press, drafts for
  the closing note and the winners' emails, and five report Figures. Test 1 is
  `tests/parity2-auction.test.js`.
- **QuickBooks Online (#115):** per-org flag, mapping from the company's real accounts and classes,
  Pending with Sync, Sync all and Skip, one sales receipt per gift (or a deposit per payout), sent once
  by a unique row plus a RequestId, plain-word errors with Retry, disconnect revokes and keeps the
  history. Test 2 is `tests/parity2-qbo-sync.test.js`. The assessment answers are in
  `docs/integrations/quickbooks.md`.

What the build learned:
- The brief said "the existing Payment Element". There is none: every online payment is a Stripe
  Checkout Session on the org's connected account, and every part reused that one path.
- Nothing in the product could mint an event's public address before this build; only the seed did.
- A rebased branch carries the client bundle built before the rebase. Rebuild `client/dist` before the
  battery, or smoke-walk walks the old screens and passes.
- The Xero "send" from INT-2 posts to an endpoint Xero does not have and nothing calls it. QuickBooks
  now has a real per-gift path; Xero's is for a later build.
