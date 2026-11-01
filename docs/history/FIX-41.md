## FIX-41 · Anything you can add, you can remove, and every page and item can have a picture (2026-10-15)

Before (Harborlight, 14 Oct): ticket types, guests and auction items could be added but not removed, the
waiting list and auction winners had no remove at all, funds and groups had no control, and
`DELETE /giving-pages/:id` hard-deleted a page with gifts, cascading its peer-to-peer pages and volunteer
sign-ups away and leaving gifts pointing at nothing. Auction items had photos but no alt text or focal
point, membership and peer-to-peer pages took no upload (a URL box), and a photo dropped into a page could
throw off its layout. After: `removal.js` is the one retire-or-delete registry and `routes/removal.js` the
one route (`/removals`, and `/volunteer-hub/removals` for a coordinator's volunteer kinds); `RemoveMenu.jsx`
is the one More menu. Money or people attached means retired (`retired_at`), a page with gifts or sign-ups
is archived, a paid guest is removed with no refund, a winner is unassigned (`auction_items.unassigned_at`,
read by auctionCore's TOP_BIDS_SQL) and a paid winner stays. Undo is exact through `deleted_records`.
Pictures: `PhotoField.jsx` on the shared Uploader (15 MB; JPG, PNG, WEBP, HEIC via heic-convert; focal
point; alt text), `Picture.jsx` draws every picture in a fixed ratio box, `pictures.js` stores `{url, alt,
fx, fy}`. A drafted page cover now records who saved it in asset_pointer_history (it wrote nothing before).
The inventory is `docs/fix-41/inventory.md`; `tests/fix41-remove-and-pictures.test.js` reads its last
column. Seed changed (`scripts/seed/fix41-media.js`: auction photos, page covers).
