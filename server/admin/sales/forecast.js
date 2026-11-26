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
//   signed     SALES-3: an open deal with an accepted quote counts in full, at the quote's
//              price, from the month its billing starts (not weighted, not by close date)
// Every figure carries the one sentence that defines it.
"use strict";

const { arrOf } = require("./customerPrice");
const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const civil = (t, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const monthKey = d => String(d).slice(0, 7);
const nextMonth = k => { const [y, m] = k.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const monthWords = k => { const [y, m] = k.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
// SALES-5: a deal row carries its customer's one price (customerPrice.js: price_cents, price_billing,
// price_signed, billing_starts_on). A row without one (the pure tests) falls back to its accepted
// quote, else its own value.
function priceOf(d, accepted) {
  if (d.price_cents != null) return { cents: Number(d.price_cents), billing: !!d.price_billing, signed: !!d.price_signed, startsOn: d.billing_starts_on || null };
  const a = accepted && accepted.get(d.id);
  if (a) return { cents: a.priceCents, billing: false, signed: true, startsOn: a.startOn };
  return { cents: Number(d.value_cents || 0), billing: false, signed: false, startsOn: d.close_date || null };
}
const weightOf = d => Math.round(Number(d.price_cents != null ? d.price_cents : d.value_cents || 0) * Number(d.probability || 0) / 100);

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
  const accepted = input.accepted || new Map();
  const price = new Map(input.deals.map(d => [d.id, priceOf(d, accepted)]));
  // A deal whose customer Stripe already bills is in MRR now, and nowhere else (never twice).
  const billingNow = input.deals.filter(d => (d.stage_kind === "open" || d.stage_kind === "won") && price.get(d.id).billing);
  const signedDeals = input.deals.filter(d => d.stage_kind === "open" && !price.get(d.id).billing && price.get(d.id).signed);
  const open = input.deals.filter(d => d.stage_kind === "open" && !price.get(d.id).billing && !price.get(d.id).signed);
  const weightedCents = open.reduce((n, d) => n + weightOf(d), 0);
  const signedCents = signedDeals.reduce((n, d) => n + price.get(d.id).cents, 0);
  // SALES-5 item 2: a won deal that Stripe does not bill yet counts its price from its first charge month.
  const wonWaiting = input.deals.filter(d => d.stage_kind === "won" && !price.get(d.id).billing);
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
  const starting = new Map(keys.map(k => [k, 0]));
  for (const d of signedDeals) {
    const p = price.get(d.id);
    const k = !p.startsOn || monthKey(p.startsOn) < first ? first : monthKey(p.startsOn);
    if (starting.has(k)) starting.set(k, starting.get(k) + p.cents);
  }
  // Won, billing starts: from the first charge month. A start gone by that Stripe still does not
  // bill, or no start at all, is not counted, and the card says how many and how much.
  const wonStarting = new Map(keys.map(k => [k, 0]));
  let wonStartingCents = 0, wonStartingDeals = 0;
  const wonUncounted = { deals: 0, cents: 0 };
  for (const d of wonWaiting) {
    const p = price.get(d.id);
    const k = p.startsOn ? monthKey(p.startsOn) : null;
    if (!k || k < first || !wonStarting.has(k)) { wonUncounted.deals++; wonUncounted.cents += p.cents; continue; }
    wonStarting.set(k, wonStarting.get(k) + p.cents);
    wonStartingCents += p.cents; wonStartingDeals++;
  }
  let run = mrrNowCents;
  const months = keys.map((k, i) => {
    run += closing.get(k) + starting.get(k) + wonStarting.get(k);
    const path = keys.length === 1 ? goal.cents : Math.round(mrrNowCents + (goal.cents - mrrNowCents) * ((i + 1) / keys.length));
    return { month: k, label: monthWords(k), weightedClosingCents: closing.get(k), signedStartingCents: starting.get(k), wonStartingCents: wonStarting.get(k),
      projectedCents: run, goalPathCents: path, behind: run < path };
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
    weightedCents, signedCents, signedDeals: signedDeals.length, mrrNowCents, mrrNowArrCents: arrOf(mrrNowCents), goal, undatedWeightedCents: undated,
    wonStartingCents, wonStartingDeals, wonUncounted, billingDeals: billingNow.length,
    mrrPctOfGoal: goal.cents ? Math.round((mrrNowCents / goal.cents) * 1000) / 10 : null,
    projectedPctOfGoal: goal.cents ? Math.round(((mrrNowCents + weightedCents + signedCents + wonStartingCents) / goal.cents) * 1000) / 10 : null,
    months, bySource: rates(bySource), byStage, closedIn90: closed.length,
    sentences: {
      weighted: "Each open deal's monthly price times its stage's probability, added up. A deal with a signed order or quote is counted under Signed instead, and one Stripe already bills is in MRR now.",
      signed: "Open deals with a signed order or accepted quote: its monthly price, in full, from the month billing starts.",
      wonStarting: `Won deals Stripe does not bill yet: their monthly price, in full, from the month of the first charge (the order's start, else the org's first charge, else the close date). Once Stripe bills one it moves into MRR now.${wonUncounted.deals ? ` Not counted: ${wonUncounted.deals} won ${wonUncounted.deals === 1 ? "deal" : "deals"} with no first charge date, or one gone by that Stripe still does not bill.` : ""}`,
      arr: "ARR is the monthly figure times 12.",
      mrrNow: "What the live Steward subscriptions bill each month now: the Onboarding tab's own figure.",
      goal: `The goal you set: ${goal.says}.`,
      months: "Each month to the goal: the weighted price of open deals closing that month (a close date gone by counts this month), signed orders and quotes whose billing starts that month, won deals whose first charge is that month, MRR now plus everything up to that month, and a straight line from MRR now to the goal.",
      undated: "Weighted value of open deals with no close date; it is in the weighted total but in no month.",
      winRate: "Of the deals won or lost in the last 90 days: won ÷ (won + lost). A deal parked in Later is not a loss and is not counted.",
      daysToClose: "For deals won in the last 90 days: days from the deal's creation (by source) or from entering the stage (by stage) to the win.",
    },
  };
}

module.exports = { forecast, weightOf, monthWords };
