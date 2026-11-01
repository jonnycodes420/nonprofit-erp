## FIX-20 · Leftovers from PARITY-2 and PARITY-3 (2026-10-03)

Ten parts, one PR, built in four worktrees at once (security and deploys; auctions; bookkeeping; memberships).
- Part 0: `/portal-assets/:id` served any asset to anyone with its id, waivers and conversation attachments included. An asset is now private unless an admin placed it on a public page (`portal_assets.is_public`); a private file needs a signed-in user of its org, and the attachment and grant-document doors need the session as well as the signature. Tenant matrix §11.
- Part 1: one auction item, one paid winner. The first payment claims the item; a second records no gift and becomes a refund flag on the staff screen. Test `fix20-auction-double-checkout`.
- Parts 2 to 4: the QuickBooks sent list belongs to a company (realmId); Sync all runs in batches of 100; Xero says plainly that it does not send (its old send posted to a path Xero does not have). Test `fix20-qbo-realm-switch`.
- Parts 5 and 6: auction winner mail is transactional (`auction_winner`), and bidders sign in on a second device (`auction_signin`).
- Parts 7 and 8: membership sign-in returns to the membership page and works with the portal off; the Members screen hides admin controls from non-admins (`isAdmin` had defaulted to true).
- Part 9: the tenant matrix's teardown is discovered from every table with an org_id, so it re-runs on one database.
- Part 10: Railway had no healthcheck and switched traffic the moment a container started; the PARITY-3 deploy returned 503 for 4m45s. `railway.json` now points it at `/ready`, and schema init yields its locks to live reads.
