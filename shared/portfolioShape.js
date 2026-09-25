// shared/portfolioShape.js — BUILD-99 (major gifts) Part 2. WHAT AN OFFICER
// PUTS AROUND A LIST SHE ALREADY HAS.
//
// A portfolio is NOT a new membership concept. BUILD-30 settled that, and it
// cost a build to settle: "assigned to an officer" IS "in that officer's
// portfolio" IS "on that officer's board" — one state, no second flag, because
// Home once read "Portfolio: 16 donors" while the board rendered 3. Nothing here
// re-opens that. `portfolioMembership` in server.js stays the one definition of
// who is in a portfolio; this module is only about the ORDER she reads them in,
// the target she typed, and the sentences those numbers may not appear without.
//
// ── THE ORDER IS THE WHOLE PRODUCT ────────────────────────────────────────
// The brief's rule: her people ranked by open proposal amount, then by days
// since last contact. That second clause is the one that matters — at equal
// proposal size, the person nobody has spoken to in three months comes first,
// because a portfolio screen exists to surface the relationship going quiet, not
// to re-rank the money she already knows about.
//
// ── AND THE NUMBER THIS MODULE REFUSES TO INVENT ──────────────────────────
// There is no suggested target, no suggested cap, and no "recommended portfolio
// size". Those are the numbers a CRM invents and a development director then has
// to argue with. A target she did not type is ABSENT, and the screen says so
// rather than showing a percentage of nothing.
//
// Pure: no DB, no network, no clock, no JSX.

// A day count is a reading off a date, never a threshold claim — so the one
// number this module names out loud is the org's own, passed in.
export const QUIET_DAYS = 90;   // the label boundary only: "quiet" vs "recent"

// ── RANKING ───────────────────────────────────────────────────────────────
// Rows carry: { donorId, name, openAskCents, daysSinceContact (null = never),
//               lastConversation, nextStep }
// `daysSinceContact === null` means NOBODY HAS EVER LOGGED ONE, which is worse
// than a long gap and sorts as such — not as zero, which is what a bare
// `Number(null)` would have made it.
export function rankPortfolio(rows = []) {
  const days = r => (r.daysSinceContact == null ? Number.POSITIVE_INFINITY : Number(r.daysSinceContact) || 0);
  return rows.slice().sort((a, b) =>
    (Number(b.openAskCents) || 0) - (Number(a.openAskCents) || 0)
    || days(b) - days(a)
    || String(a.name || "").localeCompare(String(b.name || "")));
}

export function contactPhrase(daysSinceContact) {
  if (daysSinceContact == null) return "No conversation logged yet";
  const d = Number(daysSinceContact) || 0;
  if (d === 0) return "Spoke today";
  if (d === 1) return "Spoke yesterday";
  if (d < 14) return `Spoke ${d} days ago`;
  if (d < 60) return `Spoke ${Math.round(d / 7)} weeks ago`;
  if (d < 730) return `Spoke ${Math.round(d / 30)} months ago`;
  return `Spoke ${Math.round(d / 365)} years ago`;
}

export function isQuiet(daysSinceContact) {
  return daysSinceContact == null || Number(daysSinceContact) >= QUIET_DAYS;
}

// ── THE TARGET, AND WHAT IT MAY SAY ───────────────────────────────────────
// `targetCents` null means she has not typed one. The sentence then says that
// and stops; it does not fall back to a goal from somewhere else, because a
// figure labelled "her target" that she did not set is the product putting words
// in her mouth.
export function targetProgress({ targetCents, committedCents, fiscalLabel }) {
  const t = targetCents == null ? null : Number(targetCents) || 0;
  const c = Number(committedCents) || 0;
  if (t === null || t <= 0) {
    return { targetCents: null, committedCents: c, percent: null, overCents: 0,
             set: false, fiscalLabel: fiscalLabel || null };
  }
  const rawPercent = Math.round((c / t) * 100);
  return {
    targetCents: t, committedCents: c,
    percent: Math.min(rawPercent, 100), rawPercent,
    overCents: Math.max(c - t, 0), set: true, fiscalLabel: fiscalLabel || null,
  };
}

export function targetSentence(p, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (v => String(v));
  if (!p || !p.set) {
    return `No target set for ${p && p.fiscalLabel ? p.fiscalLabel : "this year"} — type one and this figure starts meaning something.`;
  }
  const head = `${fm(p.committedCents)} committed of a ${fm(p.targetCents)} target for ${p.fiscalLabel || "this year"}`;
  if (p.overCents > 0) return `${head} — ${fm(p.overCents)} over.`;
  return `${head}, which is ${p.rawPercent}% of it. The target is the one you typed.`;
}

// ── THE COUNT CAP ─────────────────────────────────────────────────────────
// A cap is not a limit the software enforces — assigning a 151st person is a
// judgement she is allowed to make. It is a number she chose so the screen can
// tell her she has passed it.
export function capState({ capCount, actualCount }) {
  const cap = capCount == null ? null : Number(capCount) || 0;
  const n = Number(actualCount) || 0;
  if (cap === null || cap <= 0) return { cap: null, count: n, over: 0, set: false };
  return { cap, count: n, over: Math.max(n - cap, 0), set: true };
}

export function capSentence(c) {
  if (!c) return "";
  if (!c.set) return `${c.count} ${c.count === 1 ? "person" : "people"} assigned. No cap set.`;
  if (c.over > 0) {
    return `${c.count} ${c.count === 1 ? "person" : "people"} assigned, ${c.over} over the ${c.cap} you set. Nothing is blocked; the number is yours to act on.`;
  }
  return `${c.count} of the ${c.cap} you set for yourself.`;
}

// ── UNASSIGNED MAJOR PROSPECTS ────────────────────────────────────────────
// "Major" is the ORG's own number, passed in, never a constant here — the
// BUILD-85 rule (money is relative to the organisation) applied to a setting
// rather than a score. The sentence quotes the threshold so nobody has to guess
// where the list came from.
export function unassignedSentence({ count, thresholdCents }, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (v => String(v));
  const n = Number(count) || 0;
  if (n === 0) return `Everybody who has given ${fm(thresholdCents)} or more is on somebody's list.`;
  return `${n} ${n === 1 ? "person has" : "people have"} given ${fm(thresholdCents)} or more in total and nobody owns the relationship. ${fm(thresholdCents)} is the figure this organisation set.`;
}

export function portfolioCountSentence(count, officerName) {
  const n = Number(count) || 0;
  if (n === 0) return `${officerName || "This officer"} has nobody assigned yet.`;
  return `${n} ${n === 1 ? "person is" : "people are"} assigned to ${officerName || "this officer"} — which is what puts them on ${officerName ? "their" : "the"} board.`;
}
