// server/admin/sales/forecast.js · SALES-1. THE FORECAST CARD.
//
// forecast(input, now, tz) is pure:
//   weighted   the open deals' value × their stage's probability
//   mrrNow     ONBOARD-2's MRR billing now (the Onboarding tab's own figure,
//              passed in, never recomputed here)
//   goal       Jonathan's goal (default $10,000 MRR by Jun 30 2027)
//   months     month by month to the goal's month, by close date: the weighted
//              value closing that month, MRR now plus everything weighted to
//              date, and where a straight line to the goal would be
//   bySource / byStage   win rate and average days to close over the last 90 days
// Every figure carries the one sentence that defines it.
"use strict";

const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const civil = (t, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const monthKey = d => String(d).slice(0, 7);
const nextMonth = k => { const [y, m] = k.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const monthWords = k => { const [y, m] = k.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const weightOf = d => Math.round(Number(d.value_cents || 0) * Number(d.probability || 0) / 100);

function rates(groups) {
  return [...groups.entries()].map(([key, g]) => ({
    key, won: g.won, lost: g.lost, closed: g.won + g.lost,
    winRate: g.won + g.lost ? Math.round((g.won / (g.won + g.lost)) * 1000) / 10 : null,
    avgDaysToClose: g.days.length ? Math.round(g.days.reduce((a, b) => a + b, 0) / g.days.length) : null,
  })).sort((a, b) => b.closed - a.closed || String(a.key).localeCompare(String(b.key)));
}

// input: { deals (list rows), history: [{ deal_id, to_stage_id, to_name, at }], stages (Map), mrrNowCents, goal }
function forecast(input, now, tz = "America/New_York") {
  const today = civil(now, tz);
  const open = input.deals.filter(d => d.stage_kind === "open");
  const weightedCents = open.reduce((n, d) => n + weightOf(d), 0);
  const goal = input.goal;
  const mrrNowCents = Number(input.mrrNowCents || 0);

  // Month by month, from this month to the goal's month (at least this month).
  const first = monthKey(today), last = monthKey(goal.by) < first ? first : monthKey(goal.by);
  const keys = [];
  for (let k = first; k <= last && keys.length < 60; k = nextMonth(k)) keys.push(k);
  const closing = new Map(keys.map(k => [k, 0]));
  let undated = 0;
  for (const d of open) {
    if (!d.close_date) { undated += weightOf(d); continue; }
    const k = monthKey(d.close_date) < first ? first : monthKey(d.close_date);   // a close date gone by counts this month
    if (closing.has(k)) closing.set(k, closing.get(k) + weightOf(d));
  }
  let run = mrrNowCents;
  const months = keys.map((k, i) => {
    run += closing.get(k);
    const path = keys.length === 1 ? goal.cents : Math.round(mrrNowCents + (goal.cents - mrrNowCents) * ((i + 1) / keys.length));
    return { month: k, label: monthWords(k), weightedClosingCents: closing.get(k), projectedCents: run, goalPathCents: path, behind: run < path };
  });

  // The last 90 days: deals won or lost then.
  const since = now - 90 * DAY;
  const closed = input.deals.filter(d => { const t = d.won_at || d.lost_at; return t && new Date(t).getTime() >= since && new Date(t).getTime() <= now; });
  const daysTo = (from, to) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY));
  const bySource = new Map();
  for (const d of closed) {
    const key = d.source || "(no source)";
    if (!bySource.has(key)) bySource.set(key, { won: 0, lost: 0, days: [] });
    const g = bySource.get(key);
    if (d.won_at) { g.won++; g.days.push(daysTo(d.created_at, d.won_at)); } else g.lost++;
  }
  // By stage: of the deals closed in the window that passed through a stage, how many were won,
  // and the average days from entering that stage to a win.
  const byStageMap = new Map();
  const closedIds = new Set(closed.map(d => d.id));
  const firstEntry = new Map();
  for (const h of input.history || []) {
    if (!closedIds.has(h.deal_id)) continue;
    const st = input.stages.get(h.to_stage_id);
    if (!st || st.kind !== "open") continue;
    const k = `${h.deal_id}|${h.to_stage_id}`;
    if (!firstEntry.has(k) || new Date(h.at) < new Date(firstEntry.get(k).at)) firstEntry.set(k, h);
  }
  for (const h of firstEntry.values()) {
    const d = closed.find(x => x.id === h.deal_id);
    const st = input.stages.get(h.to_stage_id);
    const key = st.name;
    if (!byStageMap.has(key)) byStageMap.set(key, { won: 0, lost: 0, days: [], position: st.position });
    const g = byStageMap.get(key);
    if (d.won_at) { g.won++; g.days.push(daysTo(h.at, d.won_at)); } else g.lost++;
  }
  const byStage = rates(byStageMap).map(r => ({ ...r, position: byStageMap.get(r.key).position })).sort((a, b) => a.position - b.position);

  return {
    weightedCents, mrrNowCents, goal, undatedWeightedCents: undated,
    mrrPctOfGoal: goal.cents ? Math.round((mrrNowCents / goal.cents) * 1000) / 10 : null,
    projectedPctOfGoal: goal.cents ? Math.round(((mrrNowCents + weightedCents) / goal.cents) * 1000) / 10 : null,
    months, bySource: rates(bySource), byStage, closedIn90: closed.length,
    sentences: {
      weighted: "Each open deal's monthly value times its stage's probability, added up.",
      mrrNow: "What the live Steward subscriptions bill each month now: the Onboarding tab's own figure.",
      goal: `The goal you set: ${goal.says}.`,
      months: "Each month to the goal: the weighted value of open deals closing that month (a close date gone by counts this month), MRR now plus everything weighted up to that month, and a straight line from MRR now to the goal.",
      undated: "Weighted value of open deals with no close date; it is in the weighted total but in no month.",
      winRate: "Of the deals won or lost in the last 90 days: won ÷ (won + lost). A deal parked in Later is not a loss and is not counted.",
      daysToClose: "For deals won in the last 90 days: days from the deal's creation (by source) or from entering the stage (by stage) to the win.",
    },
  };
}

module.exports = { forecast, weightOf, monthWords };
