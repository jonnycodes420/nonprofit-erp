// client/src/lib/periodRead.js · FLOWS-13 item 3 (W-1114-Fundraising-07X). THE NEWEST READ, FOR THE PERIOD ON SCREEN.
//
// A page whose figures depend on a period kept in the address (Fundraising's
// This FY / Last FY / custom days) reads it again on every pick and on every
// change heard (lib/changes.js). Two of those reads can be in flight at once,
// and the one that left first can answer last: Last FY, still on its way, lands
// over the custom days just applied, and the address says one period while the
// figures show another until she presses again. The same family as FLOWS-5's
// date range and FLOWS-8's latest-wins read.
//
// start(url) hands each read a ticket; lands(ticket, urlNow) is true only for
// the newest ticket, and only when the address still names the period it read.
export function newPeriodReads() {
  let seq = 0;
  return {
    start(url) { seq += 1; return { n: seq, url }; },
    isNewest(ticket) { return !!ticket && ticket.n === seq; },
    lands(ticket, urlNow) { return !!ticket && ticket.n === seq && ticket.url === urlNow; },
  };
}
