// shared/numbers/gaveOver.js · ATLAS-7. "GAVE OVER $1,000", IN ONE OF FOUR WINDOWS.
//
// "Everyone who gave over $1,000" means four different sets of people, so
// Atlas asks which one, with each set's live count beside it. Each window is
// the Donors list's own filter (groups.js buildDonorFilter, the rules a Group
// keeps), never a second copy of the sum:
//   last12    gaveOver + gaveFrom/gaveTo: more than the amount in all, given
//             from the day after this day last year to today
//   calendar  gaveOver + gaveFrom/gaveTo: Jan 1 of this year to today
//   lifetime  gaveOver alone: more than the amount in all, ever
//   oneGift   giftOver: at least one gift, by itself, of more than the amount
// A window never runs past the org's today (givingBetween.js's rule): a gift
// dated ahead is not money received yet.
"use strict";

const WINDOWS = ["last12", "calendar", "lifetime", "oneGift"];
const LABEL = { last12: "In the last 12 months", calendar: "This calendar year", lifetime: "In their lifetime", oneGift: "In one gift" };

function addDays(day, n) { const d = new Date(String(day) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// The same day a year back (Feb 29 falls to Feb 28), then one day on: twelve months ending today.
function yearBackPlusOne(today) {
  const [y, m, d] = String(today).split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return addDays(`${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`, 1);
}

// { from, to } civil days, or null for a window with no dates.
function bounds(key, today) {
  if (key === "last12") return { from: yearBackPlusOne(today), to: today };
  if (key === "calendar") return { from: `${String(today).slice(0, 4)}-01-01`, to: today };
  return null;
}

// The Donors list's rules (query keys of GET /donors and /donors/ids) for "gave over <dollars>" in a window.
function rulesFor(dollars, key, today) {
  const n = String(Number(dollars));
  if (key === "oneGift") return { giftOver: n };
  const b = bounds(key, today);
  return b ? { gaveOver: n, gaveFrom: b.from, gaveTo: b.to } : { gaveOver: n };
}

// The window her words name, or null when they name none (then Atlas asks).
function windowFromWords(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(in (a|one) (single )?gift|single gift|one gift|at once|in one go)\b/.test(t)) return "oneGift";
  if (/\b(last|past) (12|twelve) months\b|\b(in )?the (last|past) year\b|\bover the (last|past) year\b/.test(t)) return "last12";
  if (/\bthis (calendar )?year\b|\bso far this year\b|\byear to date\b|\bytd\b/.test(t)) return "calendar";
  if (/\b(lifetime|all[- ]time|ever|in total|altogether|over the years)\b/.test(t)) return "lifetime";
  return null;
}

// What the window says, for a sentence: "in the last 12 months (Nov 12, 2025 to Nov 11, 2026)".
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => { const [y, m, dd] = String(d).split("-").map(Number); return `${MON[m - 1]} ${dd}, ${y}`; };
function windowWords(key, today) {
  const b = bounds(key, today);
  if (key === "oneGift") return "in one gift";
  if (key === "lifetime") return "in their lifetime";
  return `${key === "last12" ? "in the last 12 months" : "this calendar year"} (${day(b.from)} to ${day(b.to)})`;
}

module.exports = { WINDOWS, LABEL, bounds, rulesFor, windowFromWords, windowWords };
