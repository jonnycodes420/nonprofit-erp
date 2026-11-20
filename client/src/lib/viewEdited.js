// client/src/lib/viewEdited.js · FLOWS-20 (W-1120-Donors-16). IS THE LIST STILL THE SAVED VIEW?
//
// Donors → Saved views kept "QA A1 Major Dana" selected after its filters and sort were changed,
// and picking it again did nothing: a <select> fires no change for the value it already holds. The
// menu now asks this: when the list's filters or sort are no longer the view's, the view reads
// "(edited)" and picking it is a real change that applies it again.
const norm = v => (v == null ? "" : String(v));
const CHIP_KEYS = ["search", "stage", "owner", "designation", "status", "household", "people"];

const whereOf = f => (f && Array.isArray(f.conditions) ? { join: f.join === "or" ? "or" : "and", conditions: f.conditions } : { join: "and", conditions: [] });
const sameWhere = (a, b) => {
  const x = whereOf(a), y = whereOf(b);
  if (!x.conditions.length && !y.conditions.length) return true;
  return x.join === y.join && JSON.stringify(x.conditions) === JSON.stringify(y.conditions);
};

// `now` is the list as it stands: { where, sort, sortDir, chips: { search, stage, owner, … } }.
export function viewMatches(view, now) {
  if (!view || !now) return true;
  if (!sameWhere(view.filters, now.where)) return false;
  const sort = norm(view.sort), dir = view.sort ? norm(view.sortDir) : "";
  if (sort !== norm(now.sort) || dir !== (now.sort ? norm(now.sortDir) : "")) return false;
  const c = view.chips || {}, n = now.chips || {};
  return CHIP_KEYS.every(k => norm(c[k]).trim() === norm(n[k]).trim());
}
