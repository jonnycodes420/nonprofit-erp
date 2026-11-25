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

// o: { priceCents, interval: "month"|"year", setupFeeCents (null|0 = waived), freeDays }
// signedAtMs: the instant she signs (or "now" for the page before she does).
function orderFigures(o, signedAtMs) {
  const priceCents = Math.round(Number(o.priceCents) || 0);
  const setupCents = o.setupFeeCents == null ? 0 : Math.round(Number(o.setupFeeCents) || 0);
  const freeDays = Math.round(Number(o.freeDays));
  const firstChargeAt = new Date(signedAtMs + freeDays * DAY_MS);
  return {
    priceCents,
    interval: o.interval === "year" ? "year" : "month",
    setupCents,
    setupWaived: setupCents === 0,
    freeDays,
    firstChargeAt,
    firstChargeCents: priceCents + setupCents,
    todayCents: 0,
  };
}

module.exports = { orderFigures, usd, DAY_MS };
