// shared/displayDate.js — FIX-2 finding 10. ONE WAY TO SHOW A DATE.
//
// A person never reads "2024-11-15". Every date that reaches a screen or a
// printed page goes through here and reads "Nov 15, 2024", or "Nov 15" when
// the design shows dates within the current year without one. Inputs, CSV and
// exports keep ISO (a machine reads those); nothing else does.
//
// Read from the text, never through a Date in some timezone: a civil date
// (2025-12-31) is the 31st everywhere, and a stamped value from a DATE column
// ("2026-03-02T00:00:00.000Z") keeps its date part — the same rule as
// shared/institutional.js's shortCivilDate, which now reads through here.
// A Date object is a moment, not a civil day, so it is read in local time.
//
// Pure: no clock. "Within the year" needs a today, and the caller passes it.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), mo: value.getMonth() + 1, d: value.getDate() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value == null ? "" : value));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

// "Jan 14, 2026". Nothing reads as nothing: a blank or unreadable value is "".
export function displayDate(value) {
  const p = parts(value);
  return p ? `${MON[p.mo - 1]} ${p.d}, ${p.y}` : "";
}

// FIX-39 — "Dec 2, 2026, 9:00 AM". A moment someone chose (a scheduled send),
// read in local time like any Date. A civil date with no time reads as the day.
export function displayDateTime(value) {
  const at = value instanceof Date ? value : (/T|\s\d{2}:/.test(String(value || "")) ? new Date(value) : null);
  if (!at) return displayDate(value);
  if (isNaN(at.getTime())) return "";
  const h = at.getHours(), mi = at.getMinutes();
  return `${displayDate(at)}, ${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// "Sep 27" when the date falls in today's year, "Sep 27, 2025" otherwise.
// `today` is a civil date string or a Date; without one it is the full form.
export function displayDateShort(value, today) {
  const p = parts(value);
  if (!p) return "";
  const t = today == null ? null : parts(today);
  return t && t.y === p.y ? `${MON[p.mo - 1]} ${p.d}` : `${MON[p.mo - 1]} ${p.d}, ${p.y}`;
}

// "Sep 2026" — a month, for a chart axis or a period heading.
export function displayMonth(value) {
  const p = parts(/^\d{4}-\d{2}$/.test(String(value)) ? value + "-01" : value);
  return p ? `${MON[p.mo - 1]} ${p.y}` : "";
}

// FIX-14 Part 1 — THE CIVIL DAY AN INSTANT FALLS ON, IN A ZONE. The client's
// one way to ask "what day is it for this organisation": the caller passes
// the zone and the instant, so this stays pure. `toISOString().slice(0, 10)`
// is the UTC day, which after 8pm in New York is already tomorrow.
export function civilDateIn(tz, instant) {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(at.getTime())) return "";
  let zone = tz || "America/New_York";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }); } catch { zone = "America/New_York"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// CHECK-2 item 12 · "due Fri, Oct 23", the way a person writes a date in a
// sentence: the weekday, the month and the day, and the year only when it is
// not today's. The weekday is the civil date's own (read in UTC from the
// parts, so no zone can move it a day).
const WDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function displayDay(value, today) {
  const p = parts(value);
  if (!p) return "";
  const w = WDAY[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()];
  return `${w}, ${displayDateShort(value, today)}`;
}

// A sentence Steward wrote with an ISO date in it ("Journey step: Call,
// due 2026-10-23 (New donor).") reads with displayDay instead. A date with a
// time after it ("2026-10-23T09:00") is a moment, not a day, and is left alone.
const ISO_DAY = /\b(\d{4}-\d{2}-\d{2})(?![T\d:])\b/g;
export function humanDates(text, today) {
  if (text == null) return text;
  return String(text).replace(ISO_DAY, (m, d) => displayDay(d, today) || m);
}
