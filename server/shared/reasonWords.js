// server/shared/reasonWords.js · MONEY-3. WHY THESE PEOPLE, IN PLAIN WORDS.
//
// A list answer (Ask, and Atlas's list of people) is headed by what everyone
// on it has in common. That header read as the query: "any gifts with date
// between December 1, 2025 and December 31, 2025 · no gifts with date on or
// after January 1, 2026". It says it the way a person would: "gave last
// December, nothing since Jan 1".
//
// reasonWords(plan, today) takes a query plan (askQuery.js validateQuery's
// shape) and the org's today, and returns the plain line, or "" when the plan
// carries no condition on its people. A condition this file has no plain
// words for keeps askQuery's own words, so nothing is ever left out.
"use strict";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const isDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1-based
const money = n => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// "Jan 1" this year, "Jan 1, 2024" another year.
function shortDay(d, today) {
  const y = d.slice(0, 4), s = `${MON3[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
  return y === String(today).slice(0, 4) ? s : `${s}, ${y}`;
}
// A whole calendar month, said relative to today: "this December", "last
// December", or "in December 2023". Null when the range is not one month.
function monthWords(a, b, today) {
  if (!isDay(a) || !isDay(b) || a.slice(0, 7) !== b.slice(0, 7)) return null;
  const y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
  if (Number(a.slice(8, 10)) !== 1 || Number(b.slice(8, 10)) !== lastOfMonth(y, m)) return null;
  const ty = Number(String(today).slice(0, 4)), tm = Number(String(today).slice(5, 7));
  if (y === ty && m === tm) return `this ${MONTHS[m - 1]}`;
  if (y === ty && m < tm) return `in ${MONTHS[m - 1]}`;
  // "last December" only when no December has come since: the month is still ahead this year.
  if (y === ty - 1 && m > tm) return `last ${MONTHS[m - 1]}`;
  return `in ${MONTHS[m - 1]} ${y}`;
}
// A date condition on a gift, as a phrase after "gave" (or after "nothing").
function whenWords(c, today) {
  const v = c.value;
  if (c.op === "between" && Array.isArray(v)) return monthWords(v[0], v[1], today) || `between ${shortDay(v[0], today)} and ${shortDay(v[1], today)}`;
  if (c.op === "gte" && isDay(v)) return `since ${shortDay(v, today)}`;
  if (c.op === "gt" && isDay(v)) return `after ${shortDay(v, today)}`;
  if (c.op === "lt" && isDay(v)) return `before ${shortDay(v, today)}`;
  if (c.op === "lte" && isDay(v)) return `on or before ${shortDay(v, today)}`;
  if (c.op === "eq" && isDay(v)) return `on ${shortDay(v, today)}`;
  if (c.op === "last_days") return `in the last ${v} days`;
  return null;
}
// One related-gifts condition: "gave last December", "nothing since Jan 1",
// "gave $1,000 or more since Jan 1", "gave 3 or more times in the last 90 days".
function giftsWords(r, today) {
  const dates = (r.where || []).filter(c => c.field === "date");
  const others = (r.where || []).filter(c => c.field !== "date");
  if (others.length || dates.length > 1) return null;
  const when = dates.length ? whenWords(dates[0], today) : "";
  if (when === null) return null;
  const tail = when ? ` ${when}` : "";
  if (r.none) return `nothing${tail || " on record"}`;
  if (r.minSum != null) return `gave ${money(r.minSum)} or more${tail}`;
  if (r.min > 1) return `gave ${r.min} or more times${tail}`;
  return `gave${tail}`;
}

function reasonWords(plan, today, fallback = null) {
  if (!plan || !Array.isArray(plan.where)) return "";
  const out = [];
  const rest = [];
  for (const r of plan.related || []) {
    const w = r.entity === "gifts" ? giftsWords(r, today) : null;
    if (w) out.push(w); else rest.push(r);
  }
  // Anything else keeps the query layer's own words (askQuery.queryWords),
  // the first part (the entity's name) left off.
  if ((plan.where.length || rest.length) && fallback) {
    const own = String(fallback({ ...plan, related: rest, measure: { fn: "count" }, groupBy: null })).split(" · ").slice(1);
    out.unshift(...own);
  }
  return out.join(", ");
}

module.exports = { reasonWords, monthWords, whenWords, giftsWords, shortDay };
