// shared/numbers/endsOn.js · FLOWS-18 item 1 (W-1117-Atlas-01X). ONE "DAYS LEFT".
//
// The staging fleet read a Year-end page ending Dec 31, 2026 as "0 days left"
// and "Ended" on Nov 17. Four places counted the days to a page's or a
// campaign's end, three different ways: the campaign card by the server's
// clock against UTC midnight (so a page ending Dec 31 read "Ended" from 7pm
// Eastern on Dec 30), the giving page's payload and the countdown block each by
// their own subtraction. They now read this one function.
//
// THE RULE. Days are civil days in the org's own time zone. The end date is the
// LAST day gifts are asked for, so it is still open all of that day:
//   end after today      open      "N days left" (1 → "1 day left")
//   end is today         last_day  "Last day"   (never "Ended", never "0 days left")
//   end before today     ended     "Ended"
//   no end date          none      nothing is said
// "Not open yet" is a different fact (the org can't take a card yet: Stripe),
// owned by server/give/takesGifts.js. A page is never both: ended wins, because
// a closed page has nothing to open.
const orgTime = require("../../orgTime");

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A DATE column can arrive as a Date at local midnight or as "YYYY-MM-DD…".
function civil(d) {
  if (d == null || d === "") return null;
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const s = String(d).slice(0, 10);
  return DAY_RE.test(s) ? s : null;
}

// endsOn(endDate, { tz, today, at }) → { endsOn, daysLeft, state, words }
//   today: the org's civil day when the caller already has it; otherwise it is
//   taken in `tz` (the org's zone) at `at` (now).
function endsOn(endDate, { tz = null, today = null, at = new Date() } = {}) {
  const end = civil(endDate);
  if (!end) return { endsOn: null, daysLeft: null, state: "none", words: null };
  const t = civil(today) || orgTime.orgToday({ timezone: tz }, at);
  const n = orgTime.daysBetween(t, end);
  if (n == null) return { endsOn: end, daysLeft: null, state: "none", words: null };
  if (n < 0) return { endsOn: end, daysLeft: 0, state: "ended", words: "Ended" };
  if (n === 0) return { endsOn: end, daysLeft: 0, state: "last_day", words: "Last day" };
  return { endsOn: end, daysLeft: n, state: "open", words: n === 1 ? "1 day left" : `${n} days left` };
}

// Has it started? A start date after today is "upcoming", in the same zone.
function startsAfter(startDate, today) {
  const s = civil(startDate), t = civil(today);
  return !!(s && t && s > t);
}

module.exports = { endsOn, startsAfter, civilDay: civil };
