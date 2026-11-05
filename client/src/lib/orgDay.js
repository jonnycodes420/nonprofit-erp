// POLISH-5 · A DATE ON A SCREEN IS THE ORGANISATION'S DAY.
//
// shared/displayDate.js reads a date off its own text, which is right for a
// civil date ("2026-11-03", or a DATE column stamped "2026-11-03T00:00:00.000Z")
// and wrong for a moment: an undo at 8 PM Eastern on Nov 3 is stamped
// "2026-11-04T01:00:00Z", and its text says Nov 4. A moment is read in the
// org's time zone (orgToday.js), never in UTC and never in the browser's.
// JSX-free so a suite can import it.
import { civilDayOf } from "./orgToday.js";
import { displayDate, displayDateShort } from "../../../shared/displayDate.js";

// A timestamp with a time of day. Midnight UTC exactly is how a DATE column
// arrives, so it stays the civil date it was stored as.
const MOMENT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const DATE_COLUMN = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/;

// The org's civil day ("2026-11-03") for a civil date, a timestamp or a Date.
export function orgDayOf(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? "" : civilDayOf(value);
  const s = String(value == null ? "" : value);
  if (MOMENT.test(s) && !DATE_COLUMN.test(s)) {
    const at = new Date(s);
    return isNaN(at.getTime()) ? "" : civilDayOf(at);
  }
  const m = /^\d{4}-\d{2}-\d{2}/.exec(s);
  return m ? m[0] : "";
}

// "Nov 3, 2026", on the org's day.
export function displayOrgDate(value) { return displayDate(orgDayOf(value)); }
// "Nov 3" this year, "Nov 3, 2025" otherwise, on the org's day.
export function displayOrgDateShort(value, today) { return displayDateShort(orgDayOf(value), today); }
