// shared/threadFigures.js — FIX-1 §9. EVERY THREAD FIGURE IS ONE COMPUTATION.
//
// The walk (26 September): the Thread's header said "oldest 17 days" (the
// largest daysOpen), Ada Petrossian's row said 23 days overdue, and the Home
// sentence said "three weeks" (the largest overdueDays). One fact, three
// numbers, one screen. The header, the row badges and the Home sentence now
// all read this, and nothing else decides how long a row has been waiting.
//
// A ROW'S FIGURE is how long it has been on her plate: the days since it was
// opened, or the days since it fell due if that is longer (a thread opened
// with a step already past due has been owed since the due date, not since
// the day somebody wrote it down). "Oldest" is the row with the largest
// figure, so it can never be smaller than a badge on the same screen.
//
// Pure: no clock, no fetch. The server computes overdueDays and daysOpen on
// the org's civil calendar; this only decides what they add up to.

const days = n => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
};

export function rowFigure(t) {
  return Math.max(days(t?.overdue ? t.overdueDays : 0), days(t?.daysOpen));
}

// rows → { rowDays: { [id]: days }, oldest: { id, donorName, days, overdue, index } | null },
// where index is the oldest row's place in `rows`.
// A row without an id still counts toward "oldest"; it just has no badge key.
export function threadFigures(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const rowDays = {};
  let oldest = null;
  list.forEach((t, i) => {
    const d = rowFigure(t);
    if (t && t.id != null) rowDays[t.id] = d;
    if (!oldest || d > oldest.days) oldest = { id: t?.id ?? null, donorName: t?.donorName ?? null, days: d, overdue: !!t?.overdue, index: i };
  });
  return { rowDays, oldest };
}
