// server/donors/offlineRoster.js · MONEY-4 (W-1107-Finance-24). EVERY ACTIVE PLAN ON RECURRING GIVING.
//
// A staff-recorded offline monthly plan (PLEDGES-2, offline_recurring_plans)
// never appeared in Recurring giving, which listed card subscriptions only.
// The list now carries every active plan, card and offline, with a Source,
// and MRR includes the offline plans, labeled: "$1,250 a month: $1,000 by
// card, $250 offline". An offline plan's monthly equivalent is its amount
// per period over the months in that period (weekly × 52 / 12).
//   OFFLINE_MRR_SQL   the offline monthly equivalent, in dollars, one row
//   offlineRosterRows(query, orgId, today)  roster rows shaped like a card plan's
"use strict";
const { planState, LABEL } = require("./offlinePlans");

const { OFFLINE_MRR_SQL, OFFLINE_ACTIVE, MONTHLY_OF } = require("../../shared/numbers/offlineMrr");
const INTERVAL = { weekly: "week", monthly: "month", quarterly: "quarter", annually: "year" };

async function offlineRosterRows(query, orgId, today) {
  const plans = await query(
    `SELECT pl.id, pl.donor_id, pl.amount::float AS amount, pl.frequency, pl.start_date, pl.end_date, pl.status, pl.fund_id, pl.method,
            pl.created_at, d.name AS donor_name, d.email AS donor_email, f.name AS fund_name
       FROM offline_recurring_plans pl
       JOIN donors d ON d.id = pl.donor_id AND d.org_id = pl.org_id AND d.deleted_at IS NULL
       LEFT JOIN fin_funds f ON f.id = pl.fund_id AND f.org_id = pl.org_id
      WHERE pl.org_id = ? AND ${OFFLINE_ACTIVE("pl")}
      ORDER BY pl.created_at DESC`, [orgId, today]);
  if (!plans.length) return [];
  const { MONEY_SUM, GIFT } = require("../../shared/numbers/money");
  const pays = await query(
    `SELECT g.offline_plan_id AS id, ${MONEY_SUM("g")} AS total, COUNT(*) FILTER (WHERE ${GIFT("g")})::int AS cnt,
            json_agg(json_build_object('amount', g.amount) ) FILTER (WHERE ${GIFT("g")}) AS paid
       FROM gifts g WHERE g.org_id = ? AND g.offline_plan_id = ANY(?::text[]) GROUP BY g.offline_plan_id`, [orgId, plans.map(p => p.id)]);
  const by = new Map(pays.map(p => [p.id, p]));
  return plans.map(p => {
    const pay = by.get(p.id) || {};
    const st = planState(p, (pay.paid || []).map(x => ({ amount: Number(x.amount) })), today);
    return {
      id: p.id, source: "offline", sourceLabel: LABEL, donorId: p.donor_id, donorName: p.donor_name, donorEmail: p.donor_email,
      amount: p.amount, interval: INTERVAL[p.frequency] || p.frequency, frequency: p.frequency,
      status: st.status === "behind" ? "behind" : "active", displayStatus: st.status === "behind" ? "behind" : "active",
      fundId: p.fund_id || null, fundName: p.fund_name || null, method: p.method || null,
      nextChargeAt: st.nextExpected, startedAt: p.start_date, totalGiven: Number(pay.total) || 0, linkedGiftCount: Number(pay.cnt) || 0,
      stateSentence: st.sentence, pendingProposal: null,
    };
  });
}

// The roster: the card plans marked as such, then every active offline plan.
async function withOffline(query, orgId, today, cardRows) {
  for (const r of cardRows) { r.source = "card"; r.sourceLabel = "Card on file · Stripe"; }
  return [...cardRows, ...(await offlineRosterRows(query, orgId, today))];
}
// MRR: the card plans' monthly sum (computed by the route) plus the offline plans', and the sentence that says so.
async function mrrWithOffline(query, orgId, today, cardMrr) {
  const r2 = v => Math.round(v * 100) / 100;
  const [off] = await query(OFFLINE_MRR_SQL, [orgId, today]);
  const mrrCard = r2(cardMrr), mrrOffline = r2(parseFloat(off && off.mrr) || 0), n = (off && off.n) || 0;
  const $m = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const plans = n === 1 ? "one offline plan" : `${n} offline plans`;
  return { mrr: r2(mrrCard + mrrOffline), mrrCard, mrrOffline, offlineCount: n,
    mrrWords: mrrOffline > 0 ? (mrrCard > 0 ? `${$m(r2(mrrCard + mrrOffline))} a month: ${$m(mrrCard)} by card, ${$m(mrrOffline)} from ${plans} recorded by staff.`
      : `${$m(mrrOffline)} a month, all from ${plans} recorded by staff.`) : null };
}

module.exports = { offlineRosterRows, withOffline, mrrWithOffline, OFFLINE_MRR_SQL, OFFLINE_ACTIVE, MONTHLY_OF };
