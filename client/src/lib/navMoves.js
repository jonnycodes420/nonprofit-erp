// client/src/lib/navMoves.js · NAV-1 (menu, 10 Nov). FUNDRAISING'S STRIP.
//
// Peer-to-peer is a part of Fundraising shown in its strip only when the org
// has a peer-to-peer page. Auctions stays where it was (Fundraising, and its
// own menu entry); Events adds an Auction panel on each event and an Auctions
// list (/app/events?list=auctions) beside it. Nothing moved, nothing deleted.
//
// JSX-free, so Node reads it (tests/nav1-menu.test.js).
export const EVENTS_AUCTIONS = "auctions";   // the Events list that is every auction

// A Fundraising section's parts as its strip shows them: Peer-to-peer only for
// an org with a peer-to-peer page. `hasP2p` unknown (undefined) shows it, so
// nothing flickers away while loading.
// NAV-2: `mgViews` (lib/majorGiftsTab.js mgInFundraising) is the Major Gifts
// views shown inside Fundraising while Major Gifts is off the rail; they follow
// At a glance and Proposals in the Major gifts section, in the org's order.
export function frShown(sec, { hasP2p, mgViews } = {}) {
  if (!sec) return sec;
  let parts = sec.parts.filter(p => !(p.id === "p2p" && hasP2p === false));
  if (sec.id === "majorgifts" && Array.isArray(mgViews) && mgViews.length) parts = [...parts, ...mgViews.map(v => ({ id: v.id, label: v.label }))];
  return parts.length === sec.parts.length ? sec : { ...sec, parts };
}
