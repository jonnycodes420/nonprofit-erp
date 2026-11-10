// shared/careShape.js · TOP100-1. THE RULES OF A PLAN OF CARE, ONCE.
//
// A plan of care is the goal, the ask and a list of planned touches. Each
// touch is a real task (tasks.care_plan_id), so it shows in Tasks and on Home
// and completes from anywhere. This module holds what a touch can be, the
// built-in template, how a template becomes dated touches, and the one rule
// for a row's plan health. Pure: the server and the browser both read it.

// What a touch can be, and the task kind each one is. A visit, a tour and an
// ask are meetings and a call is a call, so finishing one asks "How did it
// go?" the way any meeting or call does (shared/taskShape.js NEEDS_OUTCOME).
export const TOUCH_TYPES = [
  { key: "visit",        label: "Visit",            kind: "meeting" },
  { key: "call",         label: "Call",             kind: "call" },
  { key: "tour",         label: "Tour",             kind: "meeting" },
  { key: "event_invite", label: "Event invite",     kind: "other" },
  { key: "impact_update", label: "Impact update",   kind: "email" },
  { key: "note",         label: "Handwritten note", kind: "write" },
  { key: "ask",          label: "Ask",              kind: "meeting" },
];
const BY_KEY = new Map(TOUCH_TYPES.map(t => [t.key, t]));
export const isTouchType = k => BY_KEY.has(String(k || ""));
export const touchLabel = k => (BY_KEY.get(String(k || "")) || { label: "Touch" }).label;
export const touchKind = k => (BY_KEY.get(String(k || "")) || { kind: "other" }).kind;

// The built-in template: a touch every 3 months over 12 months.
export const QUARTERLY = {
  id: "builtin:quarterly", name: "Quarterly touches", builtIn: true,
  touches: [
    { type: "visit", offsetDays: 0 },
    { type: "impact_update", offsetDays: 91 },
    { type: "call", offsetDays: 182 },
    { type: "note", offsetDays: 273 },
    { type: "visit", offsetDays: 364 },
  ],
};
export const BUILT_IN_TEMPLATES = [QUARTERLY];

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = s => CIVIL.test(String(s || ""));
export function addDays(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  if (!isDay(a) || !isDay(b)) return null;
  const ta = Date.UTC(...a.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  const tb = Date.UTC(...b.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  return Math.round((tb - ta) / 86400000);
}

// A template's touches, as a list she can save: each a known type and a day
// offset from the plan's start, at most 24, never back in time.
export function cleanTemplateTouches(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const t of list.slice(0, 24)) {
    if (!t || !isTouchType(t.type)) return null;
    const off = Number(t.offsetDays);
    if (!Number.isInteger(off) || off < 0 || off > 3660) return null;
    out.push({ type: t.type, offsetDays: off });
  }
  return out.sort((a, b) => a.offsetDays - b.offsetDays);
}

// A plan's dated touches as a template: the offsets from its first touch.
export function templateFromTouches(touches) {
  const dated = (touches || []).filter(t => isDay(t.due) && isTouchType(t.type)).sort((a, b) => a.due.localeCompare(b.due));
  if (!dated.length) return [];
  const first = dated[0].due;
  return dated.map(t => ({ type: t.type, offsetDays: daysBetween(first, t.due) }));
}

// A template applied from a start day: the touches to create.
export function touchesFromTemplate(template, startDay) {
  const list = cleanTemplateTouches(template && template.touches) || [];
  return list.map(t => ({ type: t.type, due: addDays(startDay, t.offsetDays), label: touchLabel(t.type), kind: touchKind(t.type) }));
}

// THE ONE RULE FOR PLAN HEALTH. `touches` are the plan's tasks: { due, done }.
//   Behind      a touch not done whose day has passed
//   On track    nothing overdue and the next touch is today or later
//   No plan     no touches at all
//   No next touch  every touch is done and nothing is planned
export const HEALTH = {
  behind: { key: "behind", label: "Behind", sentence: "A planned touch is past its day and not done." },
  on_track: { key: "on_track", label: "On track", sentence: "The next planned touch is today or later, and none is overdue." },
  no_plan: { key: "no_plan", label: "No plan", sentence: "No touches are planned for this person." },
  no_next: { key: "no_next", label: "No next touch", sentence: "Every planned touch is done, and nothing else is planned." },
};
export function planHealth(touches, today) {
  const list = Array.isArray(touches) ? touches : [];
  if (!list.length) return HEALTH.no_plan;
  const open = list.filter(t => !t.done && !t.voided);
  if (open.some(t => isDay(t.due) && t.due < today)) return HEALTH.behind;
  if (open.length) return HEALTH.on_track;
  return HEALTH.no_next;
}

// "#3 Hollis Brandt: visit, due Thu". `dayWords` turns a day into words.
export function touchLine({ rank, name, type, label, due }, dayWords = d => d) {
  const what = String(label || touchLabel(type)).toLowerCase();
  return `${rank ? `#${rank} ` : ""}${name}: ${what}${due ? `, due ${dayWords(due)}` : ""}`;
}
