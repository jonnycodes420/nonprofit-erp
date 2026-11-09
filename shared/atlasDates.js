// shared/atlasDates.js · ATLAS-5. ATLAS READS DATES IN CODE, IN THE ORG'S OWN DAY.
//
// W-1108-Atlas-20: on Sunday Nov 8, "Remind me next Tuesday" came back as
// Tuesday Nov 17; said on Saturday Nov 7 it was Nov 10. The weekday rule
// pushed "next" a further week whenever the day was fewer than three days off.
//
// The rules, one place, no model:
//   today            the civil date in the org's timezone at this instant
//                    (todayIn). Never UTC: at 9 PM on a Sunday in New York it
//                    is already Monday in UTC.
//   "this Tuesday"   today when today is Tuesday, else the coming Tuesday.
//   "next Tuesday",  the first Tuesday after today: said on a Sunday, the
//   "on Tuesday",    Tuesday two days later; said on a Tuesday, a week on.
//   "Tuesday"
//   "in N days"      today plus N ("in a week", "in 2 weeks" likewise).
//   "end of month"   the last day of this month.
//   "last Tuesday"   the Tuesday before today.
// Every date Atlas proposes is shown with its weekday ("Tue, Nov 10"), so a
// wrong one shows itself before Save. Pure, for the server and the browser.

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const civil = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const ymd = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "")); return m ? [+m[1], +m[2], +m[3]] : null; };

// The civil date it is for the org at this instant.
export function todayIn(tz, now = new Date()) {
  let zone = String(tz || "") || "America/New_York";
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "America/New_York"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now instanceof Date ? now : new Date(now)).map(x => [x.type, x.value]));
  return civil(+p.year, +p.month, +p.day);
}

export function addDays(day, n) { const p = ymd(day); const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return civil(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
export function weekdayOf(day) { const p = ymd(day); return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : null; }
// "Tue, Nov 10" (and the year when it is a far one).
export function dayWithWeekday(day, today = null) {
  const p = ymd(day); if (!p) return "";
  const t = ymd(today);
  // The year only when it is not this one and the date is far off (as dayWords says it).
  const far = t && t[0] !== p[0] && Math.abs(Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(t[0], t[1] - 1, t[2])) > 300 * 864e5;
  return `${SHORT_DAY[weekdayOf(day)]}, ${SHORT_MON[p[1] - 1]} ${p[2]}${far ? `, ${p[0]}` : ""}`;
}

// The weekday phrases. null when the words name no weekday.
// { date, said } where `said` is the words that named it, so a label can drop them.
export function weekdayWhen(words, today) {
  const t = String(words || "").toLowerCase();
  if (!ymd(today)) return null;
  const m = t.match(/\b(next |this |on |by |coming |this coming |last )?(sunday|monday|tuesday|tues|wednesday|thursday|thurs|friday|saturday)\b/);
  if (!m) return null;
  const w = WEEKDAYS.findIndex(d => d.startsWith(m[2].slice(0, 3)));
  if (w < 0) return null;
  const q = (m[1] || "").trim();
  const ahead = (w - weekdayOf(today) + 7) % 7;
  if (q === "last") return { date: addDays(today, -(((weekdayOf(today) - w + 7) % 7) || 7)), said: m[0], past: true };
  if (q === "this" && ahead === 0) return { date: today, said: m[0] };
  return { date: addDays(today, ahead || 7), said: m[0] };
}

export function inDays(words, today) {
  const t = String(words || "").toLowerCase();
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, "couple of": 2, few: 3 };
  const m = t.match(/\bin (a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple of|couple|few|\d+) (day|week)s?\b/);
  if (!m) return null;
  const n = NUM[m[1]] || Number(m[1]) || 1;
  return { date: addDays(today, m[2] === "week" ? 7 * n : n), said: m[0] };
}

export function endOfMonth(words, today) {
  if (!/\b(by |at )?(the )?end of (the |this )?month\b/i.test(String(words || ""))) return null;
  const [y, mo] = ymd(today);
  return { date: addDays(mo === 12 ? civil(y + 1, 1, 1) : civil(y, mo + 1, 1), -1), said: String(words).match(/\b(by |at )?(the )?end of (the |this )?month\b/i)[0] };
}

export default { WEEKDAYS, todayIn, addDays, weekdayOf, dayWithWeekday, weekdayWhen, inDays, endOfMonth };
