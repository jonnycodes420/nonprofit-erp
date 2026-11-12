// shared/eventMatch.js · IMPORT-10 item 5. ONE EVENT, HOWEVER IT IS TYPED.
//
// On 12 Nov a customer typed "Night of The Stars" into the importer's Event
// box; the org already had "NIght of the Stars 2026" and the importer offered
// to create a second event (it matched only LOWER(name) = LOWER(typed)).
//
// THE RULES
//   · The same event: the names agree once case, punctuation and spacing are
//     set aside ("NIght of the  Stars" = "night of the stars"). The import
//     links to it without asking.
//   · A close event: the same once a year is set aside ("… 2026"), or one or
//     two letters apart for a name of any length (a typo). Creating a new
//     event when a close one exists asks "Did you mean …?" first.
//   · Suggestions as she types: the same and close events, plus any whose
//     name starts with or holds what she typed, newest first.
// Pure: no I/O. The browser suggests from it; the server decides from it.
const s = v => (v == null ? "" : String(v));
export const normEvent = v => s(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const noYear = v => normEvent(v).replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// "same" | "close" | "starts" | null
export function eventLikeness(typed, name) {
  const a = normEvent(typed), b = normEvent(name);
  if (!a || !b) return null;
  if (a === b) return "same";
  const ay = noYear(typed), by = noYear(name);
  if (ay && ay === by) return "close";
  const d = lev(ay || a, by || b), len = Math.max((ay || a).length, (by || b).length);
  if (len >= 6 && d <= (len >= 14 ? 2 : 1)) return "close";
  if (a.length >= 3 && (b.startsWith(a) || b.includes(" " + a) || (by && by.startsWith(ay)))) return "starts";
  return null;
}

const newestFirst = (x, y) => s(y.date).localeCompare(s(x.date)) || s(x.name).localeCompare(s(y.name));

// The events to suggest under the box, newest first.
export function suggestEvents(typed, events = [], limit = 5) {
  return events.filter(e => eventLikeness(typed, e.name)).sort(newestFirst).slice(0, limit);
}
// The same event (newest, or the one on `date` when given), or null.
export function sameEvent(typed, events = [], date = null) {
  const same = events.filter(e => eventLikeness(typed, e.name) === "same").sort(newestFirst);
  return (date && same.find(e => s(e.date).slice(0, 10) === date)) || same[0] || null;
}
// The closest event that is not the same one, or null: what "Did you mean …?" names.
export function closeEvent(typed, events = []) {
  return events.filter(e => eventLikeness(typed, e.name) === "close").sort(newestFirst)[0] || null;
}
