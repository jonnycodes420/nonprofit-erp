// shared/grantDeadline.js · TRUTH-3 item 7. ONE RULE FOR A GRANT'S DEADLINE WORD.
//
// The fleet (W-1107-Finance-31) read "Passed" for a Dec 16 deadline 39 days
// away: the grant was Awarded, and a grant past the pursuing stages said
// "Passed" whatever the date. The word is the DATE's, against the org's
// today (never the browser clock): days ahead is "39d", today is "Today",
// a day gone is "Overdue" while the grant is still pursued and "Passed"
// once it is not. `today` is the org's civil date (YYYY-MM-DD).
import { daysBetween, isCivilDate } from "./grantMilestones.js";

export function deadlineWord(deadline, today, { pursuing = true } = {}) {
  const d = String(deadline || "").slice(0, 10);
  if (!isCivilDate(d)) return { word: "Not set", days: null, band: "none" };
  if (!isCivilDate(today)) return { word: d, days: null, band: "unknown" };
  const days = daysBetween(today, d);
  if (days > 0) return { word: `${days}d`, days, band: "ahead" };
  if (days === 0) return { word: "Today", days, band: "today" };
  return { word: pursuing ? "Overdue" : "Passed", days, band: pursuing ? "overdue" : "passed" };
}
