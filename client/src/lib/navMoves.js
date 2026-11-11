// client/src/lib/navMoves.js · NAV-1 (menu, 10 Nov). WHERE AUCTIONS AND
// PEER-TO-PEER LIVE NOW.
//
// Auctions moved inside Events: an event's page has its Auction panel, and
// Events has an Auctions list (/app/events?list=auctions). Every old way in
// (the rail's `auctions`, /app/fundraising?fr=auctions, a search result) lands
// there; a link that names an event lands on that event. Peer-to-peer stays a
// part of Fundraising, shown in its strip only when the org has a peer-to-peer
// page. Nothing is deleted: the routes, the views and the rows are the same.
//
// JSX-free, so Node reads it (tests/nav1-menu.test.js).
export const EVENTS_AUCTIONS = "auctions";   // the Events list that is every auction

export function routeAuctions(tab, opts) {
  const o = opts || {};
  if (tab === "auctions" || (tab === "fundraising" && o.frSection === "auctions")) {
    const { frSection, ...rest } = o;   // eslint-disable-line no-unused-vars
    return { tab: "events", opts: o.eventId ? { eventId: o.eventId } : { ...rest, eventsList: EVENTS_AUCTIONS } };
  }
  return { tab, opts };
}

// A Fundraising section's parts as its strip shows them: never Auctions (it is
// in Events), and Peer-to-peer only for an org with a peer-to-peer page.
// `hasP2p` unknown (undefined) shows it, so nothing flickers away while loading.
export function frShown(sec, { hasP2p } = {}) {
  if (!sec) return sec;
  const parts = sec.parts.filter(p => p.id !== "auctions" && !(p.id === "p2p" && hasP2p === false));
  return parts.length === sec.parts.length ? sec : { ...sec, parts };
}
