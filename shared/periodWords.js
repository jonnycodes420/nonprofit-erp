// shared/periodWords.js · POLISH-8 (W-1107-Fundraising-05, rest). A GOAL NAMES ITS PERIOD.
// "On target for $180,000" and "Spring 2026 $15,000" carried no period. Every
// goal or amount tile says the span it is measured over, the one way:
//   "Jul 1, 2026 to Jun 30, 2027" · "through May 31, 2026" · "from Mar 1, 2026" · "no dates set"
import { displayDate } from "./displayDate.js";

export function periodWords(start, end) {
  const s = start ? displayDate(String(start).slice(0, 10)) : "";
  const e = end ? displayDate(String(end).slice(0, 10)) : "";
  if (s && e) return `${s} to ${e}`;
  if (e) return `through ${e}`;
  if (s) return `from ${s}`;
  return "no dates set";
}
