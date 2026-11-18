// shared/nextStep.js · EDIT-2. A PERSON'S NEXT STEP, AND THE ORDER OF THEIR TASKS.
//
// One rule, read everywhere a person's next step is shown (Major gifts, the
// Top 100, the profile header and rail, Home's Thread) and everywhere a
// profile lists tasks (Coming up, the Tasks tab, the timeline's open tasks).
//
// THE NEXT STEP is the soonest open step due today or later. When every dated
// step is past, it is the most overdue one, and it says so (overdue: true).
// An undated step is the next step only when nothing is dated.
// A customer's May task stood as the next step over a December one on Nov 18:
// Home and the Top 100 took the earliest date (an overdue May 2026), and
// Major gifts took the person's one Thread step, whatever else was open.
//
// THE TASK ORDER: open before done; open by due day, soonest first, undated
// last; done newest first (the day it was done, else the day it was made).
const DAY = /^\d{4}-\d{2}-\d{2}/;

export const NEXT_STEP_SENTENCE = "The next step is the soonest open step due today or later; when every one is past, the most overdue.";

export const dayOf = v => (DAY.test(String(v || "")) ? String(v).slice(0, 10) : "");

// items: anything with `due` (YYYY-MM-DD or a timestamp). today: the org's day.
// Returns the chosen item with `overdue` set, or null.
export function pickNextStep(items, today) {
  const t = dayOf(today);
  let ahead = null, late = null, undated = null;
  for (const it of items || []) {
    if (!it) continue;
    const d = dayOf(it.due);
    if (!d) { if (!undated) undated = it; continue; }
    if (d >= t) { if (!ahead || d < dayOf(ahead.due)) ahead = it; }
    else if (!late || d < dayOf(late.due)) late = it;
  }
  const pick = ahead || late || undated;
  return pick ? { ...pick, overdue: !!(pick === late) } : null;
}

const isDone = k => Number(k && k.done) === 1 || (k && k.done === true);
const doneDay = k => dayOf(k.completed_at || k.completedAt || k.updated_at || k.updatedAt) || dayOf(k.created_at || k.createdAt);

export function compareTasks(a, b) {
  const da = isDone(a), db = isDone(b);
  if (da !== db) return da ? 1 : -1;
  if (!da) {
    const x = dayOf(a.due), y = dayOf(b.due);
    if (x !== y) return !x ? 1 : !y ? -1 : x < y ? -1 : 1;
  } else {
    const x = doneDay(a), y = doneDay(b);
    if (x !== y) return x < y ? 1 : -1;
  }
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export function sortTasks(tasks) {
  return [...(tasks || [])].sort(compareTasks);
}
