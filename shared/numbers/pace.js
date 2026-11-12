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
const PACE_STATES = ["ahead", "on_pace", "behind", "met"];
const LABELS = { met: "Goal reached", ahead: "Ahead", on_pace: "On pace", behind: "Behind pace" };

const pts = x => Math.round(x * 100);
const civil = d => {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d.toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const days = (a, b) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000;
const dollars = n => "$" + Math.round(n).toLocaleString("en-US");

// THE PROJECTION IS ITS OWN ARITHMETIC (LEDGER-2). Raised × (days in the
// window) ÷ (days gone, today counted). The hover states every input, so a
// reader can redo it: "$225,151 raised by day 128 of 365, on pace for $642,032".
function paceMath({ raised, start, end, today, word = "raised" }) {
  const s = civil(start), e = civil(end), t = civil(today);
  if (!s || !e || !t) return null;
  const total = days(s, e) + 1;
  if (!(total > 0)) return null;
  const day = Math.max(0, Math.min(total, days(s, t) + 1));
  if (!(day > 0)) return null;
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
  const s = civil(start), e = civil(end), t = civil(today);
  if (g <= 0 || !s || !e || !t) return null;
  const total = days(s, e);
  if (!(total > 0)) return null;
  const word = basis === "committed" ? "committed" : "raised";

  const timeShare = Math.max(0, Math.min(1, days(s, t) / total));
  const raisedShare = r / g;
  const math = paceMath({ raised: r, start: s, end: e, today: t, word });
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
    math,
  };
}

module.exports = { paceOf, paceMath, PACE_BAND_PTS, PACE_STATES, PACE_LABELS: LABELS };
