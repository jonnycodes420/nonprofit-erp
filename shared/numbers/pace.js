// shared/numbers/pace.js · FLOWS-7 (W-1112-Fundraising-04). ONE PACE RULE.
//
// The first staging night read "On pace" on three cards that were behind:
// Year-end 2026 at 19% raised with 28% of its time gone, Harbor Run 2027 at 8%
// with 17% gone, and the Annual Fund at 85% committed with 87% gone, whose own
// projection ($1,971,315) sat under its $2,015,000 goal on the same card. The
// rule then (FIX-7, shared/pace.js) let a card be ten points behind and still
// say On pace. A card that says On pace and projects a miss says two things.
//
// THE RULE, and every card reads it (campaigns, the org goal, Home):
//   share raised = raised ÷ goal           (or committed ÷ goal; the caller says which)
//   share of time = days gone ÷ days in the window (start to deadline)
//   projection    = raised carried at the same daily rate to the last day
//
//   met       raised ≥ goal
//   on pace   share raised ≥ share of time, AND the projection ≥ goal
//   ahead     on pace, and more than PACE_BAND_PTS points ahead of the time
//   behind    anything else, with the gap in dollars: what it would take today
//             for both halves of "on pace" to hold
//
// No band below the line. Ten points ahead is worth saying ("Ahead"); one
// point behind is behind, said plainly ("Behind pace · $2,400 short of pace").
//
// WHAT IT REFUSES TO SAY. No start, no deadline or no goal: no window, so no
// pace. The caller shows raised against goal and nothing else (null).
//
// Pure: no DB, no network, no clock of its own. `today` is passed in.
"use strict";

const PACE_BAND_PTS = 10;
const PACE_STATES = ["ahead", "on_pace", "behind", "met", "ended"];
const LABELS = { met: "Goal reached", ahead: "Ahead", on_pace: "On pace", behind: "Behind pace", ended: "Ended" };

const pts = x => Math.round(x * 100);
const civil = d => {
  if (!d) return null;
  // DEFINE-1: a DATE column's Date is local midnight; its own calendar day, never the UTC one.
  if (d instanceof Date) return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const days = (a, b) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000;
const dollars = n => "$" + Math.round(n).toLocaleString("en-US");
const longDay = ymd => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// DEFINE-1 item 5 · ONE DAY COUNT. Jarvis (22 Nov): "campaign pace uses two day
// counts". The badge's share of time read days gone (today not counted) over
// the window's span (its last day not counted), while the projection beside it
// read "day N of M" with both counted, and the org goal's `expected` read the
// server's millisecond clock. Every pace figure now reads this one count:
//   days     the days in the window, first and last both counted
//   day      which of them today is (0 before it starts, `days` once it ends)
//   daysLeft whole civil days from today to the last day (endsOn.js's count:
//            the last day itself reads 0, "Last day")
//   share    day ÷ days, the share of the time gone
//   state    upcoming | open | ended
function windowDays({ start, end, today }) {
  const s = civil(start), e = civil(end), t = civil(today);
  if (!s || !e || !t) return null;
  const total = days(s, e) + 1;
  if (!(total > 0)) return null;
  const day = Math.max(0, Math.min(total, days(s, t) + 1));
  const state = t < s ? "upcoming" : t > e ? "ended" : "open";
  return { days: total, day, daysLeft: Math.max(0, days(t, e)), share: day / total, state, end: e };
}

// THE PROJECTION IS ITS OWN ARITHMETIC (LEDGER-2). Raised × (days in the
// window) ÷ (days gone, today counted). The hover states every input, so a
// reader can redo it: "$225,151 raised by day 128 of 365, on pace for $642,032".
function paceMath({ raised, start, end, today, word = "raised" }) {
  const w = windowDays({ start, end, today });
  if (!w || !(w.day > 0)) return null;
  const { day, days: total } = w;
  const r = Number(raised) || 0;
  const projected = Math.round(r * total / day);
  return { day, days: total, raised: r, projected,
           sentence: `${dollars(r)} ${word} by day ${day} of ${total}, on pace for ${dollars(projected)}` };
}

/**
 * @param {object} p
 * @param {number} p.raised      money raised (or committed), same unit as goal
 * @param {number} p.goal        the target
 * @param {string|Date} p.start  the window's own start
 * @param {string|Date} p.end    the window's own deadline
 * @param {string|Date} p.today  the org's civil today
 * @param {"raised"|"committed"} [p.basis] which money the share is of; it is
 *        named in every sentence, so a card never leaves it to be guessed
 * @returns {null|{state,label,met,raisedPct,elapsedPct,deltaPts,gap,basis,sentence,math}}
 */
function paceOf({ raised, goal, start, end, today, basis = "raised" }) {
  const g = Number(goal) || 0;
  const r = Number(raised) || 0;
  const w = windowDays({ start, end, today });
  if (g <= 0 || !w || !(w.days > 1)) return null;
  const word = basis === "committed" ? "committed" : "raised";
  const raisedShare = r / g;
  // DEFINE-1: an ENDED window has no pace. It has a result, said as one:
  // "Raised 87% of goal" (Jarvis: "ended campaigns say Behind pace").
  if (w.state === "ended" && r < g) {
    const pct = pts(raisedShare);
    return { state: "ended", label: `Raised ${pct}% of goal`, met: false, raisedPct: pct, elapsedPct: 100, deltaPts: pct - 100, gap: 0, basis: "raised",
             sentence: `${dollars(r)} of ${dollars(g)}, ended ${longDay(w.end)}`, math: null, window: w };
  }
  const timeShare = w.share;
  const math = paceMath({ raised: r, start, end, today, word });
  const projectionShare = math ? math.day / math.days : timeShare;   // what the projection needs raised to be

  const met = r >= g;
  const onPace = met || (raisedShare >= timeShare && (!math || math.projected >= g));
  const raisedPct = pts(raisedShare), elapsedPct = pts(timeShare);
  const deltaPts = raisedPct - elapsedPct;
  const state = met ? "met" : !onPace ? "behind" : deltaPts > PACE_BAND_PTS ? "ahead" : "on_pace";
  // The gap: the money that would make both halves true today.
  const gap = state === "behind" ? Math.max(1, Math.ceil(g * Math.max(timeShare, projectionShare) - r)) : 0;

  return {
    state, label: LABELS[state], met, raisedPct, elapsedPct, deltaPts, gap, basis: word,
    // The reason, in the badge, every time: the two shares it compared, and the gap.
    sentence: `${raisedPct}% ${word}, ${elapsedPct}% of the time gone` + (gap ? `, ${dollars(gap)} short of pace` : ""),
    math, window: w,
  };
}

// FLOWS-15 item 2 (W-1116-Fundraising-04). WHAT IT TAKES EACH WEEK, FROM THE
// DAYS LEFT THE CARD SHOWS. The card read "$314,327 to go, 45 days left: about
// $44,904 a week", which is 49 days' worth: the week count was rounded UP to
// whole weeks (45 days → 7 weeks) before dividing. The weekly figure is now the
// money left over the very days-left number printed beside it, as weeks
// (daysLeft ÷ 7), so a reader can redo it: $314,327 × 7 ÷ 45 = $48,895.
// Fewer than seven days left: what is left is what this week takes.
function weeklyPace({ left, daysLeft }) {
  const l = Math.max(0, Number(left) || 0);
  const dl = Number(daysLeft);
  if (!(l > 0) || !Number.isFinite(dl) || dl <= 0) return { perWeek: 0, weeks: null, daysLeft: Number.isFinite(dl) ? dl : null };
  const weeks = dl / 7;
  return { perWeek: Math.round(weeks < 1 ? l : l / weeks), weeks, daysLeft: dl };
}

module.exports = { paceOf, paceMath, windowDays, weeklyPace, PACE_BAND_PTS, PACE_STATES, PACE_LABELS: LABELS };
