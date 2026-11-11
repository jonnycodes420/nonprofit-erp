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

// ── ATLAS-6 · THE PERIOD A QUESTION NAMES ─────────────────────────────────
// W-1109-Atlas-01: "how much did Wendell give between Jan 1 and Mar 31, 2026"
// was answered with his lifetime: nothing read the period. periodOf reads it,
// in code, so every amount for a period is that period's (shared/numbers).
//   a range      "between Jan 1 and Mar 31, 2026", "from 1/1/2026 to 3/31/2026"
//   a month      "in March", "in March 2026", "last month", "this month"
//   a quarter    "in Q1 2026", "first quarter of 2026", "last quarter", "this quarter"
//   a fiscal yr  "in FY 2026", "fiscal year 2026", "this fiscal year", "last fiscal year"
//   a year       "in 2025", "this year", "last year", "year to date"
// A fiscal year is labeled by the year it ends in (FY 2026 = Jul 2025 to Jun
// 2026 with a July start), as Reports label it. "Lifetime", "ever", "in total"
// and no period at all → null: the caller says Lifetime, labeled.
// → { from, to, words } (civil days, inclusive) or null.
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIdx = w => MONTH_NAMES.findIndex(m => m.startsWith(String(w || "").toLowerCase().slice(0, 3))) + 1;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthSpan = (y, m) => ({ from: civil(y, m, 1), to: civil(y, m, lastDay(y, m)) });
const words2 = (from, to) => {
  const a = ymd(from), b = ymd(to);
  const md = p => `${SHORT_MON[p[1] - 1]} ${p[2]}`;
  return a[0] === b[0] ? `between ${md(a)} and ${md(b)}, ${b[0]}` : `between ${md(a)}, ${a[0]} and ${md(b)}, ${b[0]}`;
};
// One date in words: "Jan 1", "January 1st, 2026", "1/1/2026", "2026-01-01". { y|null, m, d } or null.
function oneDate(t) {
  const s = String(t || "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (m) return { y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, m: +m[1], d: +m[2] };
  m = new RegExp(`^${MON}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$`).exec(s);
  if (m) return { y: m[3] ? +m[3] : null, m: monthIdx(m[1]), d: +m[2] };
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MON}(?: (\\d{4}))?$`).exec(s);
  if (m) return { y: m[3] ? +m[3] : null, m: monthIdx(m[2]), d: +m[1] };
  return null;
}
const okDay = x => x && x.m >= 1 && x.m <= 12 && x.d >= 1 && x.d <= lastDay(x.y || 2000, x.m);
export function periodOf(words, today, { fiscalStartMonth = 7 } = {}) {
  const t = String(words || "").toLowerCase().replace(/[?!]/g, " ").replace(/\s+/g, " ");
  const T = ymd(today); if (!T) return null;
  const [ty, tm] = T;
  if (/\b(lifetime|ever|all[- ]time|in total|altogether|so far)\b/.test(t) && !/\b(this|last) (fiscal )?year\b/.test(t)) return null;
  const MNC = MON.replace(/^\(/, "(?:");   // the month, not captured, so the range has exactly two groups
  const DATE = `(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|${MNC}\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{1,2}(?:st|nd|rd|th)? (?:of )?${MNC}(?:,? \\d{4})?)`;
  // A range of two dates.
  let m = new RegExp(`\\b(?:between|from) ${DATE} (?:and|to|through|thru|until|till|-) ${DATE}`).exec(t);
  if (m) {
    const a = oneDate(m[1]), end = oneDate(m[2]);
    if (a && end) {
      let by = end.y || a.y || ty, ay = a.y || by;
      if (!a.y && (ay * 10000 + a.m * 100 + a.d) > (by * 10000 + end.m * 100 + end.d)) ay -= 1;
      if (!end.y && !a.y && civil(by, end.m, end.d) > today) { by -= 1; ay -= 1; }
      const A = { ...a, y: ay }, B = { ...end, y: by };
      if (okDay(A) && okDay(B)) {
        const from = civil(A.y, A.m, A.d), to = civil(B.y, B.m, B.d);
        if (from <= to) return { from, to, words: words2(from, to) };
      }
    }
  }
  // A quarter.
  const Q = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };
  m = /\bq([1-4])(?:,? (?:of )?(\d{4}))?\b/.exec(t) || /\b(first|1st|second|2nd|third|3rd|fourth|4th) quarter(?: of)?(?: (\d{4}))?\b/.exec(t);
  if (m) {
    const q = Number(m[1]) || Q[m[1]]; const y = m[2] ? +m[2] : ty;
    const from = civil(y, 3 * q - 2, 1), to = civil(y, 3 * q, lastDay(y, 3 * q));
    return { from, to, words: `in Q${q} ${y} (${SHORT_MON[3 * q - 3]} 1 to ${SHORT_MON[3 * q - 1]} ${lastDay(y, 3 * q)})` };
  }
  if (/\b(this|last) quarter\b/.test(t)) {
    let q = Math.floor((tm - 1) / 3) + 1, y = ty;
    if (/\blast quarter\b/.test(t)) { q -= 1; if (q === 0) { q = 4; y -= 1; } }
    const from = civil(y, 3 * q - 2, 1), to = civil(y, 3 * q, lastDay(y, 3 * q));
    return { from, to, words: `in Q${q} ${y} (${SHORT_MON[3 * q - 3]} 1 to ${SHORT_MON[3 * q - 1]} ${lastDay(y, 3 * q)})` };
  }
  // A fiscal year, labeled by the year it ends in.
  const fyEnd = (y, mo) => (fiscalStartMonth === 1 ? y : (mo >= fiscalStartMonth ? y + 1 : y));
  const fySpan = label => {
    const from = fiscalStartMonth === 1 ? civil(label, 1, 1) : civil(label - 1, fiscalStartMonth, 1);
    const to = addDays(fiscalStartMonth === 1 ? civil(label + 1, 1, 1) : civil(label, fiscalStartMonth, 1), -1);
    const lbl = fiscalStartMonth === 1 ? `FY ${label}` : `FY ${label - 1}–${String(label).slice(2)}`;
    return { from, to, label: lbl };
  };
  m = /\b(?:fy|fiscal year)\s?'?(\d{4}|\d{2})\b/.exec(t);
  if (m) { const y = m[1].length === 2 ? 2000 + +m[1] : +m[1]; const f = fySpan(y); return { from: f.from, to: f.to, words: `in ${f.label}` }; }
  m = /\b(this|last|previous|prior) fiscal year\b|\b(this|last) fy\b/.exec(t);
  if (m) { const now = fyEnd(ty, tm); const y = /this/.test(m[0]) ? now : now - 1; const f = fySpan(y); return { from: f.from, to: f.to, words: `in ${f.label}${/this/.test(m[0]) ? " so far" : ""}` }; }
  // A month.
  if (/\bthis month\b/.test(t)) { const s2 = monthSpan(ty, tm); return { ...s2, words: `in ${MONTH_NAMES[tm - 1][0].toUpperCase() + MONTH_NAMES[tm - 1].slice(1)} ${ty} so far` }; }
  if (/\blast month\b/.test(t)) { const y = tm === 1 ? ty - 1 : ty, mo = tm === 1 ? 12 : tm - 1; return { ...monthSpan(y, mo), words: `in ${SHORT_MON[mo - 1]} ${y}` }; }
  m = new RegExp(`\\b(?:in|during|for|last|this) ${MON}(?:,? (\\d{4}))?\\b`).exec(t);
  if (m && !/\bmay (?:i|you|we|he|she|they)\b/.test(m[0])) {
    const mo = monthIdx(m[1]);
    let y = m[2] ? +m[2] : ty;
    if (!m[2] && (mo > tm || (/^last /.test(m[0]) && mo >= tm))) y -= 1;
    return { ...monthSpan(y, mo), words: `in ${SHORT_MON[mo - 1]} ${y}` };
  }
  // A calendar year.
  if (/\b(year to date|ytd)\b/.test(t)) return { from: civil(ty, 1, 1), to: today, words: `in ${ty} so far` };
  if (/\bthis (calendar )?year\b/.test(t)) return { from: civil(ty, 1, 1), to: civil(ty, 12, 31), words: `in ${ty} so far` };
  if (/\blast (calendar )?year\b/.test(t)) return { from: civil(ty - 1, 1, 1), to: civil(ty - 1, 12, 31), words: `in ${ty - 1}` };
  m = /\b(?:in|during|for) (\d{4})\b/.exec(t);
  if (m && +m[1] > 1900 && +m[1] < 2200) return { from: civil(+m[1], 1, 1), to: civil(+m[1], 12, 31), words: `in ${m[1]}` };
  return null;
}

export default { WEEKDAYS, todayIn, addDays, weekdayOf, dayWithWeekday, weekdayWhen, inDays, endOfMonth, periodOf };
