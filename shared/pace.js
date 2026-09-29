// shared/pace.js — FIX-7 Part 5. ONE ANSWER TO "ARE WE ON PACE?"
//
// Harbor Run said "On pace" at 8% raised with 68 days left, and nobody reading
// it could tell whether that was true. It was — the campaign had barely
// started — but a badge that cannot show its working is a badge nobody
// believes the third time. There were also two implementations of pace in this
// codebase (the campaign thermometer and the Home goal header), each with its
// own band and its own wording, which is how one screen says Ahead and the
// next says On pace about the same money.
//
// THE DEFINITION, and it is the whole file: pace compares the share of the
// GOAL that has been raised with the share of the campaign's OWN WINDOW that
// has gone. Start to deadline. Not the calendar year, not "the last 90 days".
//
//   raisedPct  = raised / goal
//   elapsedPct = (today - start) / (deadline - start)
//   delta      = raisedPct - elapsedPct, in percentage points
//
//   delta >  +BAND → ahead      delta < -BAND → behind      else on pace
//
// WHAT IT REFUSES TO SAY. No start date: there is no window, so there is no
// pace — the caller shows raised against goal and nothing else. No deadline:
// the same. No goal: the same. A missing input is never a zero here; it is a
// null state, and the badge does not appear at all. That refusal is the point
// of the file, and `paceOf` returning null is not a failure to handle.
//
// Pure: no DB, no network, no clock of its own. `today` is passed in.

// Ten points either way, as the brief set it. A campaign a tenth of the way
// off schedule is on schedule; a fundraiser does not act on eight points.
export const PACE_BAND_PTS = 10;

export const PACE_STATES = ["ahead", "on_pace", "behind", "met"];

// Whole percentage points, never a decimal on a screen.
const pts = x => Math.round(x * 100);

const civil = d => {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d.toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const days = (a, b) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000;

/**
 * @param {object} p
 * @param {number} p.raised     money raised, in the same unit as `goal`
 * @param {number} p.goal       the target, same unit
 * @param {string|Date} p.start the campaign's own start
 * @param {string|Date} p.end   the campaign's own deadline
 * @param {string|Date} p.today the org's civil today
 * @returns {null|{state,label,raisedPct,elapsedPct,deltaPts,sentence,met}}
 *          null when there is no window or no goal — show raised against goal.
 */
export function paceOf({ raised, goal, start, end, today }) {
  const g = Number(goal) || 0;
  const r = Number(raised) || 0;
  const s = civil(start), e = civil(end), t = civil(today) || new Date().toISOString().slice(0, 10);
  if (g <= 0 || !s || !e) return null;
  const total = days(s, e);
  if (!(total > 0)) return null;

  const raisedPct = pts(r / g);
  const elapsedPct = Math.max(0, Math.min(100, pts(days(s, t) / total)));
  const deltaPts = raisedPct - elapsedPct;

  // A goal that is MET is met, whatever the clock says. "Behind pace" on a
  // campaign that has already made its number is the kind of sentence that
  // teaches people to ignore the badge.
  const met = r >= g;
  const state = met ? "met" : deltaPts > PACE_BAND_PTS ? "ahead" : deltaPts < -PACE_BAND_PTS ? "behind" : "on_pace";
  const label = { met: "Goal reached", ahead: "Ahead", on_pace: "On pace", behind: "Behind" }[state];

  return { state, label, met, raisedPct, elapsedPct, deltaPts,
           // The reason, in the badge, every time: the two shares it compared.
           sentence: `${raisedPct}% raised, ${elapsedPct}% of the time gone` };
}

export default { paceOf, PACE_BAND_PTS, PACE_STATES };
