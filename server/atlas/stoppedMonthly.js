// server/atlas/stoppedMonthly.js · ATLAS-12 item 5. WHO STOPPED GIVING MONTHLY, AS HOME SEES IT.
//
// Jarvis (26 Nov, prod): "'stopped monthly' found only 1 canceled gift while
// Home Drifting shows monthly donors Atlas does not list." Atlas read only
// Home's Recurring card (a failing card, a file sustainer gone quiet), so a
// monthly giver whose plan was canceled, or who simply stopped, was missing.
//
// Stopped monthly is any of these, each person once, the first reason kept:
//   failed     a monthly card that failed and has not recovered (GET
//              /recurring/exceptions failedCards, Home's Recurring card)
//   canceled   a recurring plan canceled or lost in the last 12 months, with
//              no plan still running (recurring_subscriptions)
//   overdue    a plan still marked active whose paid period ended over a
//              week ago with no charge since
//   from file  a monthly giver from an import with nothing in 60 days
//              (stoppedFromFileList, the same card)
//   drifting   on Home's Drifting list (GET /drift, less what she has acted
//              on: insight_outcomes, the deck's own rule, driftPeople.js) and
//              giving about every month by the profile's rhythm (drift.js
//              assessDrift and rhythmOf over their gifts), or ever on a plan
// What is at stake is a year of their usual gift.
"use strict";

const usd = c => require("../../money").formatCentsPlain(Math.round(Number(c) || 0));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };
const RUNNING = ["active", "recovering", "recovered", "paused", "past_due"];
const ENDED = ["canceled", "cancelled", "lost", "incomplete_expired", "unpaid", "ended"];
const perYear = (cents, interval) => cents * (interval === "year" ? 1 : interval === "week" ? 52 : interval === "quarter" ? 4 : 12);
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const DEFINITION = "Stopped monthly: a monthly card that failed and has not recovered, a recurring plan canceled in the last 12 months with none still running, a plan whose paid month ended over a week ago with no charge, a monthly giver from your file with nothing in 60 days, or a monthly giver on Home's Drifting list. At stake: a year of their usual gift. The same people Home's Recurring card and Drifting list show.";

async function stoppedMonthly({ get, query, orgId, today, orgDay }) {
  const [exc, drift, plans, outs] = await Promise.all([
    get("/recurring/exceptions"),
    get("/drift?all=1&includeMedium=1"),
    query(`SELECT s.donor_id, d.name, s.status, s.interval, ROUND(COALESCE(s.amount, 0) * 100)::bigint AS cents,
                  LEFT(s.canceled_at::text, 10) AS canceled, LEFT(s.current_period_end::text, 10) AS period_end
             FROM recurring_subscriptions s JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
            WHERE s.org_id = ? AND d.deleted_at IS NULL AND COALESCE(d.deceased, false) = false`, [orgId]).catch(() => []),
    query(`SELECT DISTINCT ON (item_key) item_key, state, until::text AS until FROM insight_outcomes
            WHERE org_id = ? AND kind = 'drift' ORDER BY item_key, created_at DESC`, [orgId]).catch(() => []),
  ]);
  if (exc.status >= 300 || !exc.body) return { line: "I couldn't read the stopped monthly gifts just now. Home's Recurring card has them." };
  const who = new Map();
  const add = (donorId, name, cents, reason, kind) => { if (donorId && !who.has(donorId)) who.set(donorId, { donorId, name, cents: Math.max(0, Math.round(cents) || 0), reason, kind }); };
  for (const s of exc.body.failedCards || []) {
    const each = Math.round((Number(s.amount) || 0) * 100), when = s.lastFailedAt || s.firstFailedAt;
    add(s.donorId, s.donorName, perYear(each, s.interval), `Their ${usd(each)} monthly card failed${when ? ` on ${day(orgDay ? orgDay(when) : String(when).slice(0, 10))}` : ""} and has not recovered.`, "failed");
  }
  const byDonor = new Map();
  for (const p of plans) (byDonor.get(p.donor_id) || byDonor.set(p.donor_id, []).get(p.donor_id)).push(p);
  const yearAgo = addDays(today, -365), weekAgo = addDays(today, -7);
  for (const [id, ps] of byDonor) {
    const live = ps.filter(p => RUNNING.includes(String(p.status)));
    const ended = ps.filter(p => ENDED.includes(String(p.status)) && (!p.canceled || p.canceled >= yearAgo)).sort((a, b) => String(b.canceled || "").localeCompare(String(a.canceled || "")));
    if (!live.length && ended.length) {
      const p = ended[0];
      add(id, p.name, perYear(Number(p.cents), p.interval), `Their ${usd(Number(p.cents))} ${p.interval === "year" ? "yearly" : "monthly"} gift was ${p.status === "lost" ? "lost after failed charges" : "canceled"}${p.canceled ? ` on ${day(p.canceled)}` : ""}, and no plan is running.`, "canceled");
    }
    const late = ps.find(p => p.status === "active" && p.period_end && p.period_end < weekAgo);
    if (late) add(id, late.name, perYear(Number(late.cents), late.interval), `Their ${usd(Number(late.cents))} monthly gift is overdue: the month paid for ended ${day(late.period_end)} and nothing has come since.`, "overdue");
  }
  for (const s of exc.body.stoppedFromFileList || []) add(s.donorId, s.donorName, 0, `Stopped giving monthly in your file (${s.detail}).`, "file");
  // Home's Drifting list, less what she has acted on (the deck's rule), kept to those who give monthly.
  if (drift.status < 300 && drift.body && Array.isArray(drift.body.list)) {
    const gone = new Set(outs.filter(o => o.state !== "snoozed" || (o.until && o.until > today)).map(o => o.item_key));
    const home = require("../insights/driftPeople").driftPeople(drift.body.list, { gone, asOf: today });
    const ids = home.map(h => h.id).filter(id => !who.has(id));
    const monthly = new Set(ids.filter(id => byDonor.has(id)));
    if (ids.length) {
      const DR = require("../../drift");
      const gifts = await query(`SELECT g.donor_id, LEFT(g.date, 10) AS date, g.amount::text AS amount FROM gifts g
                                  WHERE g.org_id = ? AND g.donor_id = ANY(?) AND ${require("../../shared/numbers/giftCount").KEPT("g")} AND LEFT(g.date, 10) <= ? AND ${require("../../shared/numbers/money").MONEY("g")}`, [orgId, ids, today]);
      const per = new Map();
      for (const g of gifts) (per.get(g.donor_id) || per.set(g.donor_id, []).get(g.donor_id)).push({ date: g.date, amount: Number(g.amount) });
      for (const [id, gs] of per) { const a = DR.assessDrift(gs, today); if (a && a.basis && DR.rhythmOf(a) === "monthly") monthly.add(id); }
      const [imp] = [await query(`SELECT id FROM donors WHERE org_id = ? AND id = ANY(?) AND imported_sustainer IS TRUE`, [orgId, ids]).catch(() => [])];
      for (const r of imp) monthly.add(r.id);
    }
    for (const h of home) if (monthly.has(h.id))
      add(h.id, h.name, h.stakeCents * 12, `Gave about every month, usually ${usd(h.stakeCents)}${h.lastDate ? `; last gift ${day(h.lastDate)}` : ""}, and nothing since. On Home's Drifting list.`, "drifting");
  }
  const list = [...who.values()];
  if (!list.length) return { line: "Nobody has stopped giving monthly: no card is failing, no plan was canceled or is overdue, and nobody on Home's Drifting list gives monthly. " + DEFINITION };
  const n = list.length;
  const counts = ["failed", "canceled", "overdue", "file", "drifting"].map(k => [k, list.filter(p => p.kind === k).length]).filter(([, c]) => c);
  const WORD = { failed: "a failed card", canceled: "a canceled plan", overdue: "an overdue plan", file: "a file sustainer gone quiet", drifting: "on Home's Drifting list" };
  const how = counts.map(([k, c]) => `${c} ${k === "drifting" ? "" : "with "}${WORD[k]}`.replace(/\s+/g, " ")).join(", ");
  const WR = require("./whyRows");
  const ans = WR.whyAnswer({ who: list }, { question: "Who stopped giving monthly?" });
  ans.key = "stopped_monthly";
  ans.definition = DEFINITION;
  return { line: `${n} ${n === 1 ? "person has" : "people have"} stopped giving monthly (${how}). ${ans.more ? `The first ${ans.people.length} carry` : "Together that is"} ${usd(ans.totalCents)} a year at stake. ${DEFINITION}`,
    answer: ans, link: { tab: "fundraising", section: "recurring" } };
}

module.exports = { stoppedMonthly, DEFINITION };
