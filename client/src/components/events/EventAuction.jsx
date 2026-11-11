// client/src/components/events/EventAuction.jsx · NAV-1 (menu, 10 Nov).
// AN EVENT'S AUCTION, ON THE EVENT.
//
// An addition: Auctions keeps its own place (Fundraising, and its menu entry),
// and the auction a gala runs is also on the gala's page. This panel is the
// same AuctionsView, narrowed
// to this event: its auctions, their items and purchases, and a new auction
// made here belongs to this event. An auction sheet (ASKS-1) comes in through
// the one file import, which links its purchases to this event's auction.
//
// EventsAuctions is the Events → Auctions list: every auction, on its own or
// part of an event (/app/events?list=auctions).
import AuctionsView from "../Auctions";
import { T } from "../shared";
import { tabHref } from "../../lib/appUrls";

export function EventAuction({ eventId, isReadOnly }) {
  return (
    // A white card, as The public page above it: the event's left column is dark (walk, 10 Nov).
    <section id={`ev-auction-${eventId}`} data-testid="ev-auction" aria-label="Auction"
      style={{ marginTop: 14, background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", color: T.ink }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h3 style={{ fontSize: 12, fontWeight: 800, color: T.ink, margin: 0 }}>Auction</h3>
        <a href={tabHref("settings", { section: "imports" })} data-testid="ev-auction-import" style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 700 }}>
          Bring in an auction sheet</a>
      </div>
      <AuctionsView eventId={eventId} isReadOnly={isReadOnly} />
    </section>
  );
}

export function EventsAuctions({ isReadOnly }) {
  return (
    <div data-testid="events-auctions" style={{ marginTop: 4 }}>
      <AuctionsView isReadOnly={isReadOnly} />
    </div>
  );
}

export default EventAuction;
