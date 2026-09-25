// shared/planShape.js — BUILD-99 (major gifts) Part 3. A PLAN IS A SEQUENCE OF
// THREADS, AND IT SENDS NOTHING.
//
// The officer writes it: visit, invite to the barn, send the annual report, ask.
// Each step, when its turn comes, IS a BUILD-81 thread — the same row, the same
// close discipline, the same one-open-per-donor rule. A plan is the thing that
// knows what comes next; it is not a second follow-up engine.
//
// ── WHAT A PLAN IS NOT ALLOWED TO DO ──────────────────────────────────────
// It does not send anything. There is no email field, no template, no schedule
// that fires. Every step is a human action that ends in a logged line, which is
// the only way a thread has ever closed. That is why this module can describe a
// four-step cultivation of a major donor and still not be a sequence: a sequence
// sends (BUILD-94 Part 3, and she had to turn it on); a plan reminds.
//
// ── AND WHY EXACTLY ONE STEP IS OPEN ──────────────────────────────────────
// `threads_one_open` is a partial unique index: one open thread per donor. Four
// threads would break it on the second step. So the plan holds the sequence and
// exactly one step is OPEN, carrying the thread; the rest are PENDING. The
// brief's own words for the property — "one open Thread and three pending" — are
// the structure, not a summary of it.
//
// Pure: no DB, no network, no clock, no JSX.

export const STATUS_PENDING = "pending";
export const STATUS_OPEN = "open";
export const STATUS_DONE = "done";
export const STATUS_SKIPPED = "skipped";
export const STEP_STATUSES = [STATUS_PENDING, STATUS_OPEN, STATUS_DONE, STATUS_SKIPPED];

export const PLAN_ACTIVE = "active";
export const PLAN_DONE = "done";
export const PLAN_ABANDONED = "abandoned";

export const NAME_MAX = 80;
export const LABEL_MAX = 120;
export const MAX_STEPS = 12;
export const MAX_OFFSET_DAYS = 730;   // two years out; beyond that it is not a plan

// ── THE STEP TYPES ─────────────────────────────────────────────────────────
// Every one of these is a NEXT_STEP_TYPE the Thread engine already knows, so a
// template cannot hold a step the engine would refuse when its turn came. The
// mapping is declared here and asserted against shared/threadShape.js by the
// suite, rather than being remembered.
export const PLAN_STEP_TYPES = [
  { type: "follow_up", label: "Visit or meet", suggests: "Visit" },
  { type: "follow_up", label: "Invite them to something", suggests: "Invite to the barn" },
  { type: "send", label: "Send something", suggests: "Send the annual report" },
  { type: "check_in_ask", label: "Make the ask", suggests: "Ask" },
  { type: "thank", label: "Thank them", suggests: "Thank" },
  { type: "follow_up_no_reply", label: "Follow up if no reply", suggests: "Follow up if no reply" },
];
export const PLAN_TYPE_KEYS = [...new Set(PLAN_STEP_TYPES.map(s => s.type))];

export function sanitizeName(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}
export function sanitizeLabel(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

// ── VALIDATION ─────────────────────────────────────────────────────────────
// Returns `{ ok, steps, errors }`. The returned `steps` are the CLEAN ones, so a
// caller never has to sanitize a second time — the shape that reaches the
// database is the shape this function produced.
export function validateTemplate({ name, steps } = {}) {
  const errors = [];
  const clean = [];
  const n = sanitizeName(name);
  if (!n) errors.push({ field: "name", message: "Give the plan a name — this is a template the organisation keeps." });
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) errors.push({ field: "steps", message: "A plan needs at least one step." });
  if (list.length > MAX_STEPS) errors.push({ field: "steps", message: `A plan holds at most ${MAX_STEPS} steps.` });

  list.slice(0, MAX_STEPS).forEach((s, i) => {
    const label = sanitizeLabel(s && s.label);
    const type = String((s && s.type) || "").trim();
    const off = Number(s && (s.offsetDays !== undefined ? s.offsetDays : s.offset_days));
    if (!label) errors.push({ field: `steps.${i}.label`, message: `Step ${i + 1} needs a label — it is what the officer will read.` });
    if (!PLAN_TYPE_KEYS.includes(type)) {
      errors.push({ field: `steps.${i}.type`, message: `Step ${i + 1}'s type must be one the follow-up engine knows: ${PLAN_TYPE_KEYS.join(", ")}.` });
    }
    if (!Number.isInteger(off) || off < 0 || off > MAX_OFFSET_DAYS) {
      errors.push({ field: `steps.${i}.offsetDays`, message: `Step ${i + 1}'s offset must be a whole number of days from 0 to ${MAX_OFFSET_DAYS}.` });
    }
    if (label && PLAN_TYPE_KEYS.includes(type) && Number.isInteger(off) && off >= 0 && off <= MAX_OFFSET_DAYS) {
      clean.push({ type, label, offsetDays: off });
    }
  });

  // STEPS RUN IN ORDER, so their offsets must not go backwards — a step due
  // before the one it follows is a template that will always look overdue on
  // the day it is applied, and the officer has no way to tell that from a
  // genuine lateness. Refused at SAVE, the BUILD-94 merge-field discipline.
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].offsetDays < clean[i - 1].offsetDays) {
      errors.push({ field: `steps.${i}.offsetDays`,
        message: `Step ${i + 1} is due before step ${i}. Steps run in order, so each one's offset has to be the same or later.` });
      break;
    }
  }
  return { ok: errors.length === 0, name: n, steps: clean, errors };
}

// ── APPLYING ───────────────────────────────────────────────────────────────
// Dates are offset from TODAY, which is the org's civil today passed in — never
// a clock read here. `addDays` is injected for the same reason every other pure
// module in this repo injects it: civil-date arithmetic lives in orgTime.js and
// there must not be a second copy of it.
export function planFromTemplate({ steps, today }, addDays) {
  const add = typeof addDays === "function" ? addDays : ((d) => d);
  return (steps || []).map((s, i) => ({
    seq: i + 1, type: s.type, label: s.label,
    dueDate: add(today, Number(s.offsetDays) || 0),
    status: STATUS_PENDING,
  }));
}

// ── THE STATE OF A PLAN, IN ONE PLACE ─────────────────────────────────────
// `nextPendingSeq` is what the chaining reads: the lowest-numbered step still
// waiting. A skipped step is NOT waiting, which is what makes skipping advance
// the plan rather than stall it.
export function nextPendingSeq(steps = []) {
  const p = steps.filter(s => s.status === STATUS_PENDING).map(s => Number(s.seq)).sort((a, b) => a - b);
  return p.length ? p[0] : null;
}
export function openStep(steps = []) {
  return steps.find(s => s.status === STATUS_OPEN) || null;
}
export function planIsFinished(steps = []) {
  return steps.length > 0 && steps.every(s => s.status === STATUS_DONE || s.status === STATUS_SKIPPED);
}

export function planProgress(steps = []) {
  const total = steps.length;
  const done = steps.filter(s => s.status === STATUS_DONE).length;
  const skipped = steps.filter(s => s.status === STATUS_SKIPPED).length;
  const open = steps.filter(s => s.status === STATUS_OPEN).length;
  const pending = steps.filter(s => s.status === STATUS_PENDING).length;
  return { total, done, skipped, open, pending };
}

// The sentence beside the progress. It says what is TRUE, including the case the
// brief's own structure makes possible and a template sentence would hide: the
// donor already had an open thread of their own, so the plan's first step is
// waiting rather than open, and nothing is wrong.
export function planSentence(p, templateName) {
  const name = templateName || "This plan";
  if (!p || !p.total) return `${name} has no steps.`;
  if (p.done + p.skipped === p.total) {
    const tail = p.skipped ? `, ${p.skipped} of them skipped` : "";
    return `${name} is finished — all ${p.total} steps${tail}.`;
  }
  const pos = p.done + p.skipped + 1;
  if (p.open === 0) {
    return `${name}: step ${pos} of ${p.total} is waiting for this person's current follow-up to close. Nothing is stuck.`;
  }
  return `${name}: step ${pos} of ${p.total} is open, ${p.pending} still to come.`;
}
