// shared/lostAndFoundRescue.js · AUDIT-2. LOST & FOUND BECOMES A RESCUE PLAN.
//
// A list of lapsed donors is what the visitor's own system already tells
// them. Steward's promise is who to call and why, so the free audit judges
// each donor against THEIR OWN history with the same rhythm Steward uses
// (drift.js, BUILD-76): the median gap between their gifts, month-aware for
// a donor who gives every December, drifting past 1.25 times that gap,
// lapsed with no gift in the last 12 months (FIX-49, lapseRule.js). This module only sorts what Drift
// says into three calls; it never changes how Drift decides.
//
// THE SAME RULE AS shared/lostAndFound.js: this runs in the visitor's
// browser, inside the worker. No fetch, no clock (`today` is passed in), no
// DOM. drift.js and orgTime.js are pure in the same way; the worker supplies
// the empty `process.env` drift reads its tuning seam from.
//
// THREE GROUPS, each ranked by a year of the donor's giving:
//   week   drifting, and no further than FURTHER_PAST times their usual gap
//   month  drifting further than that, or a recurring gift that stopped
//          within the last year
//   gone   past Drift's lapse line. Shown, with its dollars, not as calls.
// A donor with one gift has no usual time to be past. They are counted and
// named as not judged, never guessed into a group.

import drift from "../drift.js";
import { groupDonors, money } from "./lostAndFound.js";

const { assessDrift, rhythmOf, median } = drift;

// Past Drift's drifting line (1.25): up to 1.75 times their gap is "just
// late", beyond it "well late", until the lapse rule says lapsed.
export const FURTHER_PAST = 1.75;
// A recurring gift that stopped is a call this month while the last gift is
// inside a year. Older than that, Drift's lapse line has the final word.
export const RECURRING_STOP_DAYS = 365;

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const monthOf = d => MONTHS_LONG[Number(String(d).slice(5, 7)) - 1];
const yearOf = d => Number(String(d).slice(0, 4));

function daysBetween(a, b) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const x = p(a), y = p(b);
  return x === null || y === null ? null : Math.round((y - x) / 86400000);
}

// A YEAR OF THEIR GIVING: everything in the 365 days ending with their last
// gift. The figure a group is ranked and totalled by, because it is what a
// year of this person is worth, whether they give monthly or every December.
function lastYearCents(d) {
  return d.gifts.filter(g => { const n = daysBetween(g.date, d.last.date); return n !== null && n < 365; })
    .reduce((a, g) => a + g.cents, 0);
}

// ONE FACT, read off the file. A recurring gift that stopped is said as the
// gift it was; everybody else gets Drift's own reason, the sentence Steward
// shows on the donor's record ("$1,200 every December since 2022. Nothing
// for 14 months.").
function factLine(d, a, today, stoppedRecurring) {
  if (stoppedRecurring && a.cadenceDays && (a.cadenceDays < 45 || (a.cadenceDays >= 70 && a.cadenceDays < 135))) {
    const amounts = d.gifts.map(g => g.cents);
    const usual = median(amounts);
    const steady = amounts.every(c => usual > 0 && Math.abs(c - usual) / usual < 0.25);
    const every = a.cadenceDays < 45 ? "Monthly" : "Every three months";
    const amount = steady ? money(usual) : `usually ${money(usual)}`;
    const since = `${monthOf(d.first.date)} ${yearOf(d.first.date)}`;
    const stopped = monthOf(d.last.date) + (yearOf(d.last.date) === yearOf(today) ? "" : ` ${yearOf(d.last.date)}`);
    return `${every} ${amount} since ${since}. Stopped in ${stopped}.`;
  }
  return a.reason;
}

const plural = (n, one, many) => (n === 1 ? one : many);

export function rescuePlan(gifts, { today }) {
  const donors = groupDonors(gifts);
  const groups = { week: [], month: [], gone: [] };
  const notJudged = [];

  for (const d of donors) {
    const a = assessDrift(d.gifts.map(g => ({ date: g.date, amount: g.cents / 100 })), today);
    if (a.state === "not_eligible") { notJudged.push(d); continue; }
    // A RECURRING GIFT is one the file marks recurring, or a steady monthly
    // rhythm (nobody writes a cheque on the 5th of every month by hand). A
    // quarterly rhythm with no mark is a habit, judged by Drift like any other.
    const recurring = !!d.recurring || rhythmOf(a) === "monthly";
    const stoppedRecurring = recurring && (a.state === "drifting" || a.state === "lapsed")
      && a.daysSinceLast <= RECURRING_STOP_DAYS;
    let key = null;
    if (stoppedRecurring) key = "month";
    else if (a.state === "drifting") key = a.overdueRatio <= FURTHER_PAST ? "week" : "month";
    else if (a.state === "lapsed") key = "gone";
    if (!key) continue;
    const yearCents = lastYearCents(d);
    groups[key].push({
      name: d.name || d.email, email: d.email || null,
      fact: factLine(d, a, today, stoppedRecurring),
      yearCents, amount: money(yearCents),
      lastGift: d.last.date, gifts: d.gifts.length,
      why: stoppedRecurring ? "recurring_stopped" : a.state,
    });
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((x, y) => y.yearCents - x.yearCents || String(x.name).localeCompare(String(y.name)));
  }

  const total = rows => rows.reduce((a, r) => a + r.yearCents, 0);
  const who = (n, cents) => `${n} ${plural(n, "donor who", "donors who")} gave ${money(cents)} in their last year of giving`;
  const week = groups.week, month = groups.month, gone = groups.gone;
  const out = [
    { key: "week", label: "Call this week", count: week.length, cents: total(week), rows: week,
      sentence: week.length
        ? `${who(week.length, total(week))} ${plural(week.length, "is", "are")} past their usual time. Call ${plural(week.length, "this one", "these")} this week.`
        : "Nobody is just past their usual time.",
      definition: `Past ${drift.DRIFT.DRIFT_THRESHOLD} times their own usual gap between gifts, and no more than ${FURTHER_PAST} times it. A donor who gives every December is judged by December, not by a count of days. Ranked by what they gave in the year up to their last gift.` },
    { key: "month", label: "Call this month", count: month.length, cents: total(month), rows: month,
      sentence: month.length
        ? `${who(month.length, total(month))} ${plural(month.length, "is", "are")} further past their usual time, or stopped a recurring gift. Call ${plural(month.length, "this one", "these")} this month.`
        : "Nobody is further past their usual time, and no recurring gift has stopped.",
      definition: `More than ${FURTHER_PAST} times their own usual gap and not yet past the lapse line, or a recurring gift (marked recurring in the file, or a steady monthly rhythm) whose last payment was within the last year and has not come since.` },
    { key: "gone", label: "Probably gone", count: gone.length, cents: total(gone), rows: gone,
      sentence: gone.length
        ? `${who(gone.length, total(gone))} ${plural(gone.length, "is", "are")} past the lapse line. ${plural(gone.length, "This one is", "They are")} here so you know, not as a call list.`
        : "Nobody on this file is past the lapse line.",
      definition: "Lapsed: they have given before, but not in the last 12 months. The same rule Steward uses everywhere." },
  ];
  const atRiskCents = out.reduce((a, g) => a + g.cents, 0);
  const atRiskCount = out.reduce((a, g) => a + g.count, 0);
  return {
    today,
    groups: out,
    atRiskCents, atRisk: money(atRiskCents), atRiskCount,
    atRiskSentence: atRiskCount
      ? `${atRiskCount} ${plural(atRiskCount, "donor who", "donors who")} gave ${money(atRiskCents)} in their last year of giving ${plural(atRiskCount, "is", "are")} past their own usual time.`
      : "Nobody on this file is past their own usual time.",
    notJudged: notJudged.length,
    notJudgedSentence: notJudged.length
      ? `${notJudged.length} ${plural(notJudged.length, "donor has", "donors have")} one gift on file, so there is no usual time to be past. They are not in these groups.`
      : "",
  };
}

export const REPORT_CLOSE = "Want this checked every week, with the call planned and the note drafted? That's Steward.";
