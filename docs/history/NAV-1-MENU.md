## NAV-1 (menu) · a menu each org sets, auctions on the event, Major Gifts per org (2026-11-10)

(The brief is named NAV-1; `NAV-1.md` here is the 30 Sep sidebar build, so this one is its own file.)

- **Why.** Jonathan, 10 Nov: Auctions and Peer-to-peer "should not be on the side", then "fine as an
  option but make it customizable", and "I only want Top 100 in Major Gifts for Allie's org". His final
  call: **every menu entry on by default for every org, Auctions and Peer-to-peer included; each org
  customizes from there.** The first push hid those two by default; that default was taken out.
- **The org's menu** (`orgs.nav_layout`, `server/org/menu.js`, Settings → Menu, super-admin →
  Organizations): every entry, Show / Hide, moved within its group. NULL = every entry on. A person's own
  layout (`users.nav_layout`, the 30 Sep build) sits on top: an entry shows only when the org shows it and
  they have not hidden it, so a person can hide more and never show what the org hid; their saved choice is
  kept apart from the org's hide, so an org that turns an entry back on gives it back. Order stays within a
  group. The org layer rides on `/me/nav-layout`, so the shell makes no new request at boot.
- **Auctions, added to Events.** Auctions keeps its place (its menu entry and Fundraising's part, every link
  unchanged). In addition, an event's page has an Auction panel (its auctions, items and purchases; a new
  auction made there is the event's; the sheet import link), and Events has an Auctions list
  (`/app/events?list=auctions`). The page has stacked panels, not tabs, so the "Auction tab" is a panel.
- **Peer-to-peer** is in Fundraising's strip only when the org has a peer-to-peer page (`hasP2p`); its menu
  entry and links are unchanged.
- **Major Gifts shows** (`orgs.mg_views`, Settings → Major gifts, super-admin): any of the four tabs, at
  least one; one on means that view with no strip. All four is stored as NULL. No org id anywhere.
- **Atlas** is not a menu entry (AGENT-5: it opens over every page), so the menu does not list it.
- Home's first-look budget went up 1 KB (`perf-app`), approved by Jonathan.
- `tests/nav1-menu.test.js` (API, merge rules, a browser leg on the built client).
