## NAV-2 · a short sidebar to start, and anything else one click away (2026-11-27)

- **Why.** Duet's stress test said a one-to-three-person shop sees too much. Jonathan, 27 Nov: take
  Auctions, Peer-to-peer and Memberships off "until an org turns them on, same with Major Gifts except
  for Allie: keep it inside Fundraising and only added when an org is customizing their sidebar", and
  "really anything they want could be in a customizable section". This reverses NAV-1 menu's "every
  entry on by default" (10 Nov) for those four only.
- **One list.** `DEFAULT_OFF` in `client/src/lib/navGroups.js`. Only the org's layer starts them off
  (`orgNavLayout` passes it to `navLayout`); a person follows the org. An org that saved a layout
  before NAV-2 named every entry, so it keeps everything it had.
- **Add to your sidebar.** Both editors (Settings → Menu, the sidebar's Customize) list what is on the
  sidebar (Take off, move) and everything else with its icon, a sentence (`NAV_PURPOSE`) and Add
  (`client/src/components/NavAddList.jsx`). In Settings the two parts sit side by side, so Add is on
  the first screen. Other people's tabs pick up a change when they come back into view (App.jsx reads
  `/me/nav-layout` again on `visibilitychange`); the admin's own rail follows at once, as before.
- **Major Gifts inside Fundraising.** Off a person's rail, Fundraising → Major gifts shows At a glance,
  Proposals, then the views the org shows (`mgInFundraising`, `frShown`), only with the permission.
  `routeMajorGifts` takes `{ onRail, views }`; off the rail, `/app/majorgifts`, the old `pipeline` tab
  and `?fr=top100|portfolios|pipeline|plans` all open Fundraising on the view (the org's list decides
  which, as `mgViewIn` does on the page). While the menu is unknown the old behaviour holds, and an
  effect moves an open `/app/majorgifts` into Fundraising once it is known to be off. Same components,
  same reads, so the same numbers.
- **Orgs in use keep them.** `scripts/ops/nav2-keep-in-use.js`: dry run by default, ids and counts only,
  `--apply --i-know-this-is-prod` writes through `server/org/navTurnOn.js` (orgNavLayout → setNavVisible
  → the menu route's `changesFrom`) and one audit row per org. "In use": auction items; peer-to-peer
  fundraisers; membership levels or members; the Top 100 on, a portfolio (a person assigned to
  somebody), a move or a plan. Never org_creo or the demo.
- **Seeds.** The demo is inserted with all four on (in its `INSERT INTO orgs`, because seed-demo.js is
  at its size ratchet); the staging walk org turns them on after it is made.
- **Tests.** `tests/nav1-menu.test.js` §1, §2, §7 updated and §9 added; red on main (7 failing), and
  planted defects (routing ignoring the rail, the script ignoring an org's own choice) turned §9 red.
  `tests/smoke-walk.test.js` opens an off-rail entry by its address (`tests/lib/offRailTab.js`).
