// shared/numbers/nextShift.js · FLOWS-10 item 6 (W-1113-Volunteers-13X). NEXT SHIFT COUNTS THE
// WAITING LIST.
//
// Taken off a confirmed shift, a volunteer's Next shift read "None yet" while she was number 1
// on the Saturday clean-up waiting list, which the quick view listed. The list's column counted
// confirmed places only (routes/volunteer.js). One rule now, for both: the next confirmed shift;
// with none, the next shift she is waiting for, said as "Waiting, #1, Sat clean-up".
"use strict";
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // FLOWS-10: tests/flows10.test.js plants defects; never set outside tests

// SQL: person `p`'s next shift on or after the day bound to `?`, as JSON
// { date, status, position, name, start }, or NULL. Confirmed first; otherwise the waiting list.
const NEXT_SHIFT_SQL = (p = "donors") => `(SELECT json_build_object('date', lx.date, 'status', sx.status, 'position', sx.position, 'name', lx.name, 'start', lx.start_time)
    FROM volunteer_signups sx JOIN volunteer_slots lx ON lx.id = sx.slot_id AND lx.cancelled_at IS NULL
   WHERE sx.org_id = ${p}.org_id AND sx.person_id = ${p}.id AND sx.cancelled_at IS NULL
     AND sx.status IN ('confirmed'${PLANT === "nowaitlist" ? "" : ", 'waitlisted'"}) AND lx.date >= ?
   ORDER BY (sx.status <> 'confirmed'), lx.date, lx.start_time NULLS LAST LIMIT 1)`;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayShort = d => { const t = new Date(String(d).slice(0, 10) + "T12:00:00Z"); return Number.isNaN(t.getTime()) ? "" : WEEKDAY[t.getUTCDay()]; };
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => { const s = String(d || "").slice(0, 10); const [y, m, dd] = s.split("-").map(Number); return y ? `${MONTH[m - 1]} ${dd}, ${y}` : ""; };

// The words for the column and the quick view. null → "None yet".
function nextShiftWords(n) {
  if (!n || !n.date) return "None yet";
  if (n.status === "waitlisted") {
    // "Saturday clean-up" on a Saturday reads "Sat clean-up", never "Sat Saturday clean-up" (the walk).
    const day = dayShort(n.date), name = String(n.name || "shift").trim();
    const full = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" }[day] || "";
    const rest = full && name.toLowerCase().startsWith(full.toLowerCase()) ? name.slice(full.length).trim() : name;
    return `Waiting${n.position ? `, #${n.position}` : ""}, ${day} ${rest || "shift"}`.trim();
  }
  return dayWords(n.date);
}

module.exports = { NEXT_SHIFT_SQL, nextShiftWords };
