// shared/threadRank.js — BUILD-85. WHICH THREAD FIRST, AND WHY.
//
// BUILD-81 gave the Thread a spine: one donor, one open next step, closed
// honestly. What it never had was an ORDER. `composeThreads` sorted overdue
// first and then by due date, so a $75 donor's thank-you outranked a
// $40,000 open ask that happened to be one day newer, and the list had no
// cap — 150 open threads rendered 150 rows. A wall is not a queue.
//
// This module is the ordering, and it is PURE: no clock, no imports, no DB.
// The caller passes the signals it has already read; this decides the score
// and — the part that matters — the SENTENCE that says why.
//
// THREE RULES THIS FILE IS BUILT ON
//
//  1. EVERY POINT IS NAMED. The score is a sum of bounded, individually
//     labelled components, never an opaque weight. A row can always answer
//     "why am I looking at this?" in the user's own vocabulary, because the
//     answer is assembled from the same parts the arithmetic used. An
//     unexplainable ranking is one nobody trusts twice.
//
//  2. MONEY IS RELATIVE TO THE ORG, NEVER ABSOLUTE. A $5,000 ask is the
//     year for one organization and a rounding error for another. Every
//     money signal here is scored against `majorThreshold` — the org's own
//     p90 of lifetime giving — so the engine ranks by what is big FOR YOU.
//     Absolute-dollar ranking is how a CRM starts telling a food pantry its
//     work is small.
//
//  3. THE SCORE NEVER REACHES THE SCREEN. It orders the list and then stops.
//     A number on a row invites gaming and reads as invented precision; this
//     product does not put an unsourced figure in front of a fundraiser. The
//     UI shows the ORDER and the REASON. (`score` is returned for tests and
//     for the API's own sort — not for rendering.)
//
// BANDS ARE FACTS, NOT THRESHOLDS. Grouping is `overdue` / `today` / `ahead`,
// read straight off the due date. There is deliberately no "high priority"
// band, because that would require inventing the line where high begins.

// ── The signal table ───────────────────────────────────────────────────────
// `points` is either a number or a function of the thread's own values, and
// every one is BOUNDED — no single signal can run away with the list. `why`
// is the sentence the row shows; it takes the thread so it can name real
// figures ("$40,000 ask open") rather than a category.
//
// Ordering of this array is presentation only; scoring sums all that apply.

export const OVERDUE_CAP_DAYS = 21;      // past three weeks, more lateness adds nothing
export const THANK_DECAY_CAP_DAYS = 14;  // a thank-you is already cold by then
export const STALE_DAYS = 30;

// A step whose value decays fast enough that lateness costs more than usual.
// A thank-you sent three weeks after the gift is worse than awkward: it tells
// the donor exactly how much attention they got. Nothing else on the list
// spoils this way, so nothing else gets this signal.
//
// IT READS THE LABEL, NOT ONLY THE TYPE. `nextStepTypeForLabel` derives the
// type from the label's FIRST verb, so a step a human typed as "Send
// thank-you note" is stored as type `send` and would have missed this
// entirely. The step's type is a convenience; what the step IS is in the
// words. Found by scripts/build85-capture.js, where a deliberately-seeded
// late thank-you ranked as an ordinary overdue follow-up.
const DECAYING_STEP_TYPES = new Set(["thank", "thank_you_note"]);
const DECAYING_LABEL = /thank[- ]?you|thanks/i;
const isDecaying = t => DECAYING_STEP_TYPES.has(t.stepType) || DECAYING_LABEL.test(t.stepLabel || "");

export const RANK_SIGNALS = [
  {
    key: "recurring_risk",
    points: () => 34,
    applies: t => !!t.recurringAtRisk,
    why: () => "Monthly gift is failing",
  },
  {
    key: "overdue",
    points: t => Math.min(t.overdueDays || 0, OVERDUE_CAP_DAYS) * 3,
    applies: t => (t.overdueDays || 0) > 0,
    why: t => `Overdue ${t.overdueDays} day${t.overdueDays === 1 ? "" : "s"}`,
  },
  {
    key: "ask_open",
    points: () => 26,
    applies: t => (t.openAskAmount || 0) > 0,
    why: t => `${money(t.openAskAmount)} ask open`,
  },
  {
    key: "ask_size",
    // Bounded at the org's own p90: an ask at or above that scores the full
    // 14, one a tenth of it scores 1.4. Relative, never absolute.
    points: t => Math.round(ratio(t.openAskAmount, t.majorThreshold) * 14),
    applies: t => (t.openAskAmount || 0) > 0 && (t.majorThreshold || 0) > 0,
    why: () => null,   // folded into ask_open's sentence; no second row for it
  },
  {
    key: "thank_decay",
    points: t => Math.min(t.overdueDays || 0, THANK_DECAY_CAP_DAYS) * 2,
    applies: t => isDecaying(t) && (t.overdueDays || 0) > 0,
    // SUPERSEDES the generic overdue sentence rather than competing with it.
    // Both signals still score; but "Overdue 3 days" always outscores a decay
    // bonus derived from the same three days, so without this the decay line
    // could never once reach a screen — dead copy pretending to be a feature.
    // For a thank-you the lateness IS the whole story, so it tells it.
    supersedes: ["overdue"],
    // LEADS, regardless of points. A major donor's five-day-late thank-you
    // scored "Top tenth of your donors" as its headline, because major_donor
    // contributes more points than a decay bonus does. True, and the less
    // useful of the two sentences: "top tenth" is CONTEXT, while the decay is
    // the fact with a clock on it. A `lead` signal is one whose value is
    // expiring; it takes the headline and the rest stay available underneath.
    lead: true,
    why: t => `Thank-you ${t.overdueDays} day${t.overdueDays === 1 ? "" : "s"} late. This is the one that goes cold.`,
  },
  {
    key: "first_gift",
    points: () => 22,
    applies: t => !!t.isFirstGift,
    why: () => "Their first gift. This decides whether there is a second.",
  },
  {
    key: "major_donor",
    // STRICTLY ABOVE the p90, and the strictness is the whole point. With `>=`
    // a donor base of uniform giving (every donor at $100 — a young org, or a
    // membership) has p90 == $100, so EVERY donor reads as top-decile and the
    // signal fires on the entire list. A signal that fires on everything is
    // noise wearing a signal's clothes. Strictly-greater degrades correctly:
    // no spread, no claim. Found by tests/build85.test.js §5, which produced
    // exactly that donor base by accident.
    points: () => 18,
    applies: t => (t.majorThreshold || 0) > 0 && (t.lifetimeGiving || 0) > t.majorThreshold,
    why: () => "Top tenth of your donors by lifetime giving",
  },
  {
    key: "due_today",
    points: () => 8,
    applies: t => (t.overdueDays || 0) === 0 && t.dueToday === true,
    why: () => "Due today",
  },
  {
    key: "stale",
    points: () => 10,
    applies: t => (t.daysOpen || 0) >= STALE_DAYS,
    why: t => `Open ${t.daysOpen} days`,
  },
];

function ratio(n, d) {
  const a = Number(n) || 0, b = Number(d) || 0;
  if (b <= 0) return 0;
  return Math.max(0, Math.min(1, a / b));
}

// Whole dollars, grouped. A rank reason is a phrase in a row, not a ledger
// line — cents in it would be noise.
function money(n) {
  const v = Math.round(Number(n) || 0);
  return "$" + v.toLocaleString("en-US");
}

// ── The band: a fact off the due date, not an invented threshold ──────────
export const BANDS = [
  { key: "overdue", label: "Overdue" },
  { key: "today",   label: "Today" },
  { key: "ahead",   label: "Coming up" },
];

export function bandFor(thread, today) {
  const due = String(thread.dueDate || thread.due_date || "");
  if (!due || !today) return "ahead";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "ahead";
}

// ── The ranking ────────────────────────────────────────────────────────────
// Returns { score, reasons, why, band }. `reasons` is every signal that
// applied, highest first, each with the sentence it contributes. `why` is the
// one line a row shows — the strongest reason that has something to say.
//
// A thread with NO signal at all (not overdue, not due today, no money, no
// age) scores 0 and still ranks, by due date, behind everything that does.
// That is correct: nothing about it is urgent yet.
export function rankThread(thread, today) {
  const t = normalize(thread, today);
  let score = 0;
  const reasons = [];
  for (const sig of RANK_SIGNALS) {
    if (!sig.applies(t)) continue;
    const pts = Math.max(0, Math.round(sig.points(t)));
    if (pts <= 0) continue;
    score += pts;
    const why = sig.why(t);
    if (why) reasons.push({ key: sig.key, points: pts, why });
  }
  reasons.sort((a, b) => b.points - a.points || a.key.localeCompare(b.key));
  // A signal that SUPERSEDES another tells the story for both: drop the
  // superseded sentence from the display (its points are already counted).
  const superseded = new Set();
  for (const r of reasons) {
    const sig = RANK_SIGNALS.find(x => x.key === r.key);
    for (const k of sig?.supersedes || []) superseded.add(k);
  }
  const shown = reasons.filter(r => !superseded.has(r.key));
  const leader = shown.find(r => RANK_SIGNALS.find(x => x.key === r.key)?.lead);
  const ordered = leader ? [leader, ...shown.filter(r => r !== leader)] : shown;
  return { score, reasons: ordered, why: ordered[0]?.why || null, band: bandFor(thread, today) };
}

// The caller may hand us snake_case straight off a row or camelCase from an
// API shape; normalize once so the signal table can be written one way.
function normalize(t, today) {
  const due = String(t.dueDate || t.due_date || "");
  const overdueDays = due && today && due < today ? daysBetweenCivil(due, today) : 0;
  return {
    stepType: t.stepType || t.next_step_type || null,
    stepLabel: t.stepLabel || t.next_step_label || t.nextStep?.label || null,
    dueToday: !!(due && today && due === today),
    overdueDays,
    daysOpen: Number(t.daysOpen ?? t.days_open ?? 0) || 0,
    openAskAmount: Number(t.openAskAmount ?? t.open_ask_amount ?? 0) || 0,
    recurringAtRisk: !!(t.recurringAtRisk ?? t.recurring_at_risk),
    isFirstGift: !!(t.isFirstGift ?? t.is_first_gift),
    lifetimeGiving: Number(t.lifetimeGiving ?? t.lifetime_giving ?? 0) || 0,
    majorThreshold: Number(t.majorThreshold ?? t.major_threshold ?? 0) || 0,
  };
}

// Civil-date difference in whole days. Date-only arithmetic in UTC cannot
// cross a civil boundary (the orgTime discipline) — this file never asks what
// day it is, it is told.
export function daysBetweenCivil(from, to) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const a = p(from), b = p(to);
  if (a == null || b == null) return 0;
  return Math.round((b - a) / 86400000);
}

// ── The queue ──────────────────────────────────────────────────────────────
// THE CAP IS THE FEATURE. Drift caps at 11 because a list you cannot finish
// is a list you stop opening; the Thread had no cap at all. Twelve rows is a
// morning, and the remainder is stated as a number rather than hidden.
export const QUEUE_CAP = 12;
export const EMAIL_CAP = 10;   // an email is read on a phone; ten is the fold

const BAND_ORDER = { overdue: 0, today: 1, ahead: 2 };

// Rank, order and cap in one pass. Band first (a fact), score inside it, then
// due date, then donor name so the order is STABLE — an unstable queue
// reshuffles under the user's cursor between refreshes and reads as broken.
export function buildQueue(threads, today, { cap = QUEUE_CAP } = {}) {
  const ranked = threads.map(t => {
    const r = rankThread(t, today);
    return { ...t, rank: { score: r.score, reasons: r.reasons, why: r.why }, band: r.band };
  });
  ranked.sort((a, b) =>
    (BAND_ORDER[a.band] - BAND_ORDER[b.band]) ||
    (b.rank.score - a.rank.score) ||
    String(a.nextStep?.due || "").localeCompare(String(b.nextStep?.due || "")) ||
    String(a.donorName || "").localeCompare(String(b.donorName || "")));
  const shown = cap > 0 ? ranked.slice(0, cap) : ranked;
  return {
    list: shown,
    total: ranked.length,
    more: Math.max(0, ranked.length - shown.length),
    bands: BANDS.map(b => ({ ...b, count: ranked.filter(r => r.band === b.key).length })).filter(b => b.count > 0),
  };
}
