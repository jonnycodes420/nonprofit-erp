// shared/numbers/orderFigures · ORDER-1. THE FIGURES ON AN ORDER, COMPUTED ONCE.
//
// The order page, the signed snapshot, the PDF, the signed-copy email and the
// Stripe Checkout all read these numbers from here, so they cannot disagree:
//   · the recurring price, per month or per year, as Jonathan typed it;
//   · the setup fee, or Waived (null or 0);
//   · the free days, counted from the moment she signs;
//   · the first charge: its instant and its amount (the price, plus the setup
//     fee when there is one: the setup fee waits for the first charge, so
//     nothing is charged the day she signs).
// Money is integer cents throughout; words are made by usd() below.
"use strict";

const DAY_MS = 86400000;

const usd = cents => {
  const c = Math.round(Number(cents) || 0);
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
};

// SALES-6: an order made from a quote starts billing on the quote's day (startOn, "2027-01-01"),
// not N days after signing. The first charge is noon that day in the org's own zone, the rule
// ONBOARD-1's fixed date and SALES-3's quote already keep ("Jan 1" must read as Jan 1 in Kentucky).
function noonIn(day, tz) {
  const guess = new Date(`${day}T12:00:00Z`);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/New_York", hour: "numeric", hour12: false }).formatToParts(guess);
    const h = Number((parts.find(p => p.type === "hour") || {}).value);
    return new Date(guess.getTime() + (12 - (h % 24)) * 3600000);
  } catch { return guess; }
}

// o: { priceCents, interval: "month"|"year", setupFeeCents (null|0 = waived), freeDays, startOn? }
// signedAtMs: the instant she signs (or "now" for the page before she does). tz: the org's zone.
function orderFigures(o, signedAtMs, tz) {
  const priceCents = Math.round(Number(o.priceCents) || 0);
  const setupCents = o.setupFeeCents == null ? 0 : Math.round(Number(o.setupFeeCents) || 0);
  const fixed = typeof o.startOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.startOn);
  // A fixed day has no count of free days (it would change at midnight and stale the page's hash).
  const freeDays = fixed ? null : Math.round(Number(o.freeDays));
  const firstChargeAt = fixed ? noonIn(o.startOn, tz) : new Date(signedAtMs + freeDays * DAY_MS);
  return {
    priceCents,
    interval: o.interval === "year" ? "year" : "month",
    setupCents,
    setupWaived: setupCents === 0,
    freeDays, startOn: fixed ? o.startOn : null,
    firstChargeAt,
    firstChargeCents: priceCents + setupCents,
    todayCents: 0,
  };
}

module.exports = { orderFigures, usd, DAY_MS, noonIn };
