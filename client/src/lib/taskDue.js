// Task due-date badge logic — the ONE definition of when a task is "overdue".
// JSX-free + Node-testable (like money.js / greeting.js), so the pinning test
// can import it directly.
//
// THE BUG THIS FIXES (2026-08-08): the donor-profile follow-up badge computed
// overdue as `daysDiff(due) < 0`, where daysDiff = floor((now - due)/day) — i.e.
// *elapsed-since* semantics. A FUTURE due date makes (now - due) negative, so a
// task six days out rendered "Overdue". The comparison was inverted, and the raw
// ms diff also crossed UTC midnight (new Date("2026-08-14") is UTC midnight → the
// previous local day west of UTC), an off-by-one near midnight. Date math that
// used daysUntil (due - now) elsewhere ("412 days left") was always correct.
//
// THE RULE: a task is overdue ONLY when its due date is strictly before today,
// compared as CALENDAR DATES in the local (org) timezone — never as a raw ms
// diff. Today → "Due today"; any future date → "Due <date>", never overdue.

// Parse a stored due value ("2026-08-14" or a full ISO timestamp) to LOCAL
// midnight of its OWN calendar date. A bare YYYY-MM-DD is read digit-by-digit
// so UTC parsing can't shift it a day; a full timestamp is reduced to its local
// calendar date.
export function parseDueLocal(due) {
  if (!due) return null;
  const s = String(due);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole calendar days from today → due (negative = due is in the past, 0 = today).
// Both sides are reduced to local midnight; Math.round tolerates DST-short/long days.
export function daysToDue(due, now = new Date()) {
  const d = parseDueLocal(due);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(due) {
  const d = parseDueLocal(due);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : "";
}

// The badge model. state ∈ 'overdue' | 'today' | 'future' | 'none'. The caller
// maps state → a T color token (colors stay in shared.jsx, per the brand allowlist):
//   overdue → T.terracotta   today → T.gold500 (Brass)   future → T.ink3 (Warm grey)
export function dueBadge(due, now = new Date()) {
  const diff = daysToDue(due, now);
  if (diff == null) return { state: "none", label: "" };
  if (diff < 0) return { state: "overdue", label: `Overdue · was due ${fmtDate(due)}` };
  if (diff === 0) return { state: "today", label: "Due today" };
  return { state: "future", label: `Due ${fmtDate(due)}` };
}
