## NAV-1 (menu) · Auctions and Peer-to-peer off the menu, a menu each org sets, Major Gifts per org (2026-11-10)

(The brief is named NAV-1; `NAV-1.md` here is the 30 Sep sidebar build, so this one is its own file.)

- **Why.** Jonathan, 10 Nov: "Auctions and peer to peer should not be on the side" (the agreement says
  Steward does not do either as a product), "fine as an option but make it customizable", and "I only
  want Top 100 in Major Gifts for Allie's org".
- **The org's menu** (`orgs.nav_layout`, `server/org/menu.js`, Settings → Menu, super-admin →
  Organizations): every entry, Show / Hide, moved within its group. Every org starts with Auctions and
  Peer-to-peer hidden (`navGroups.js ORG_DEFAULT_HIDDEN`). A person's own layout (`users.nav_layout`,
  the 30 Sep build) sits on top: an entry shows only when the org shows it and they have not hidden
  it, so a person can hide more and never show what the org hid; their saved choice is kept apart from
  the org's hide, so an org that turns Auctions on gives it back. Order stays within a group, as before.
  The org layer rides on `/me/nav-layout`, so the shell makes no new request at boot.
- **Auctions live in Events.** An event's page has an Auction panel (its auctions, items and purchases;
  a new auction made there is the event's; the sheet import link). Events has an Auctions list
  (`/app/events?list=auctions`), where `/app/auctions`, `?fr=auctions` and search results now land
  (`lib/navMoves.js`). The page has stacked panels, not tabs, so the "Auction tab" is a panel.
- **Peer-to-peer** stays a part of Fundraising, in its strip only when the org has a peer-to-peer page
  (`hasP2p`). Its links are unchanged.
- **Major Gifts shows** (`orgs.mg_views`, Settings → Major gifts, super-admin): any of the four tabs,
  at least one; one on means that view with no strip. All four is stored as NULL. No org id anywhere;
  the org-specific ratchet is unchanged.
- **Atlas** is not a menu entry (AGENT-5: it opens over every page), so the menu does not list it.
- `tests/nav1-menu.test.js` (56 assertions, a browser leg on the built client); `smoke-walk` skips the
  entries off every org's menu by default and still walks their addresses.
