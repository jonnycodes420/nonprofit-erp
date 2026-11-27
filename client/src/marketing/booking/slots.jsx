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
import { useEffect, useState } from "react";

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

// The provider says when a time was booked; the page only thanks her. Nothing is written from it.
function useBooked(onBooked) {
  useEffect(() => {
    const on = e => { if (e.origin === BOOKING.origin && e.data && e.data.event === "calendly.event_scheduled" && onBooked) onBooked(); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onBooked]);
}

// HONEST-3 item 6 (W-1127-Integrations-05): "the calendar iframe sat on 'Loading available times...' for
// more than 30 seconds". The direct link and the email come first, before the frame; the frame loads
// lazily; and if the calendar hasn't said it is ready within 5 seconds, the page says so and points to
// the link. The provider posts a message when its calendar is drawn; the frame's own load is not that.
export const SLOW_MS = 5000;
export const DIRECT_WORDS = "Open the calendar in a new tab";
export const EMAIL_LINE = "Or email jonathan@stewardapp.dev and he will find a time with you.";
export function DirectLine({ href }) {
  return <p className="srcnote" data-book-direct style={{ margin: "0 0 10px" }}>
    <a href={href} target="_blank" rel="noreferrer" data-book-direct-link>{DIRECT_WORDS}</a>. {EMAIL_LINE}</p>;
}
function Frame({ src, title }) {
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const on = e => { if (e.origin === BOOKING.origin && e.data && typeof e.data.event === "string" && /^calendly\./.test(e.data.event)) setReady(true); };
    window.addEventListener("message", on);
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { window.removeEventListener("message", on); clearTimeout(t); };
  }, [src]);
  return (
    <div className="slots" data-slot-picker={BOOKING.provider} data-ready={ready ? "1" : "0"}>
      <DirectLine href={src} />
      {slow && !ready && <p className="srcnote" role="status" data-book-slow style={{ margin: "0 0 10px", fontWeight: 600 }}>
        The calendar is slow to load. <a href={src} target="_blank" rel="noreferrer">{DIRECT_WORDS}</a> instead, or email jonathan@stewardapp.dev.</p>}
      <iframe title={title} src={src} loading="lazy" style={{ width: "100%", minHeight: 640, border: 0, borderRadius: 10, background: "var(--white)" }} />
    </div>
  );
}

// The provider's whole calendar, for when the card has no times of its own to show.
export function SlotPicker({ name, email, onBooked }) {
  useBooked(onBooked);
  return <Frame title="Pick a time for the call" src={slotsUrl({ name, email }, typeof window !== "undefined" ? window.location.host : "")} />;
}

// BOOK-1: one time she picked on the card, on the provider's own page with her name and email
// filled in (the server builds the address from the provider's own link for that time), for the
// last click. Only the provider's own origin is ever framed.
export function SlotFrame({ src, onBooked }) {
  useBooked(onBooked);
  let u = null;
  try { u = new URL(src); } catch { u = null; }
  if (!u || u.origin !== BOOKING.origin) return <p className="srcnote">Email jonathan@stewardapp.dev and he will confirm your time.</p>;
  u.searchParams.set("embed_type", "Inline");
  if (typeof window !== "undefined") u.searchParams.set("embed_domain", window.location.host);
  u.searchParams.set("hide_gdpr_banner", "1");
  return <Frame title="Confirm your time" src={u.toString()} />;
}
