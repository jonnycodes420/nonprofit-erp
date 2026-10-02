// FIX-14 Part 1 — "TODAY" ON THE CLIENT IS THE ORGANISATION'S TODAY.
//
// Every date a person picks or reads on the log, Thread and profile screens is
// a civil day in the org's timezone (orgTime.js on the server). The defaults
// were `new Date().toISOString().split("T")[0]`, which is the UTC day: after
// 8pm in New York it is already tomorrow, so a meeting logged at 9pm was dated
// the next day and the timeline called it "Tomorrow".
//
// The org's zone is set once, when the app's data loads (api.js adaptData),
// and read here. JSX-free so a suite can import it.
import { civilDateIn } from "../../../shared/displayDate.js";

let ORG_TZ = "";
export function setOrgTimezone(tz) { ORG_TZ = tz || ""; }
export function orgTimezone() { return ORG_TZ || "America/New_York"; }

// The org's civil today, at `at` (default: now).
export function orgTodayCivil(at = new Date()) { return civilDateIn(orgTimezone(), at); }

// Whole days from a civil date to the org's today (positive = in the past).
export function civilDaysAgo(dateStr, at = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(orgTodayCivil(at));
  if (!m || !t) return null;
  return Math.round((Date.UTC(+t[1], +t[2] - 1, +t[3]) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
}

// The org-local civil day of an instant (a calendar meeting's start).
export function civilDayOf(instant) { return civilDateIn(orgTimezone(), instant); }

// The org's today plus n days, as a civil date (calendar arithmetic, never ms).
export function orgTodayPlus(n, at = new Date()) {
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(orgTodayCivil(at));
  if (!t) return "";
  const d = new Date(Date.UTC(+t[1], +t[2] - 1, +t[3] + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
