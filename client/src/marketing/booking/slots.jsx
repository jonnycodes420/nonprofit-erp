// ONBOARD-4 item 3 · THE ONE ADAPTER BETWEEN /book AND THE TOOL THAT HOLDS JONATHAN'S SLOTS.
//
// The booking page knows nothing about Calendly: it renders <SlotPicker> with the name and email
// she just typed. Which tool and which link live here, and only here, so moving to another
// calendar is one provider below and one value in config.js, not a page rewrite.
//
// Today the provider is Calendly: the "Steward intro call" event (20 minutes, Google Meet), whose
// link is the one value in booking/config.js. The booking tool sends her its own confirmation and
// puts the event on Jonathan's calendar; Steward sends a prospect nothing, and SALES-4's calendar
// read moves her deal to Meeting booked when the event appears.
//
// No script is loaded from the provider (the site's CSP allows only hashed inline scripts): the
// slots are its plain inline iframe, allowed by vercel.json's frame-src.
import { useEffect } from "react";

import { BOOKING_URL } from "./config";

export const BOOKING = Object.freeze({
  provider: "calendly",
  url: BOOKING_URL,
  origin: new URL(BOOKING_URL).origin,
});

// The address the iframe opens, with what she typed filled in so she types it once.
export function slotsUrl({ name, email }, host) {
  const u = new URL(BOOKING.url);
  u.searchParams.set("embed_type", "Inline");
  if (host) u.searchParams.set("embed_domain", host);
  u.searchParams.set("hide_gdpr_banner", "1");
  if (name) u.searchParams.set("name", name);
  if (email) u.searchParams.set("email", email);
  return u.toString();
}

export function SlotPicker({ name, email, onBooked }) {
  // The provider says when a time was picked; the page only thanks her. Nothing is written from it.
  useEffect(() => {
    const on = e => { if (e.origin === BOOKING.origin && e.data && e.data.event === "calendly.event_scheduled" && onBooked) onBooked(); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onBooked]);
  const src = slotsUrl({ name, email }, typeof window !== "undefined" ? window.location.host : "");
  return (
    <div className="slots" data-slot-picker={BOOKING.provider}>
      <iframe title="Pick a time for the call" src={src} style={{ width: "100%", minHeight: 700, border: 0, borderRadius: 10, background: "var(--white)" }} />
      <p className="srcnote" style={{ marginTop: 10 }}>Times not loading? <a href={src} target="_blank" rel="noreferrer">Open the calendar in a new tab</a>, or email jonathan@stewardapp.dev.</p>
    </div>
  );
}
