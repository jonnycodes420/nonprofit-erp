// INPUT-1 item 6 · CHECK-IN HAPPENS ON THE DAY.
// Check-in a few days early used to write the hours (and the attendance)
// dated today, for a shift that had not happened (Jarvis's sweep, 25 Nov).
// Before the shift's or event's day, check-in answers 409 with this question;
// her second choice ("record hours for that date") sends it again with
// `forShiftDate: true` and the record carries the shift's date. Whatever day
// it happens, the hours and attendance carry the shift's or event's date.
"use strict";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayWords(iso) {
  const d = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return `${DAYS[t.getUTCDay()]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

// The 409 body when it is too early, or null.
function tooEarly(kind, onDate, today, body) {
  const d = String(onDate || "").slice(0, 10);
  if (!d || !today || d <= today || (body && body.forShiftDate === true)) return null;
  const sentence = kind === "event"
    ? `This event is on ${dayWords(d)}. Check in then, or record attendance for that date.`
    : `This shift is on ${dayWords(d)}. Check in then, or record hours for that date.`;
  return { error: sentence, code: "not_the_day", sentence, date: d,
    choices: { later: "Check in then", record: kind === "event" ? "Record attendance for that date" : "Record hours for that date" } };
}

module.exports = { tooEarly, dayWords };
