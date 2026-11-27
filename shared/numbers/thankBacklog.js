// shared/numbers/thankBacklog.js · NUMBERS-9 item 6 (W-1125-Finance-T7, third night). WAITING TO BE THANKED.
//
// The fleet read four answers to one question: the Report builder's Thanked = No (107 rows), Home's
// "gifts not yet thanked", the Acknowledgments backlog, and Home's thank-you card ("4 thank-yous
// ready", with no count of the gifts behind them). Each read thanks.js AWAITING, but each chose its own
// gifts and its own window: sample gifts in or out, a deleted person in or out, from the day the org
// started with Steward or the last 90 or 730 days. One definition now:
//
//   A gift is WAITING TO BE THANKED when it is a gift (above $0, not refunded in full, not a credit)
//   with no thank-you logged (thanks.js AWAITING), it is real (not sample data, from a person who is
//   not sample data and not deleted), it has a date, and that date is on or after the day the org
//   started with Steward (`since`, reportHooks.thanksSince: the first import, else the org's start;
//   anything older is history an import brought in).
//
// A draft does not take a gift out: a drafted thank-you still waits until it is marked sent. `drafted`
// says how many of the waiting gifts have a draft ready, so a screen that lists drafts can say how
// many of the gifts it is not showing.
//
// Screens that show part of the backlog say which part in their sentence: Acknowledgments' backlog is
// the waiting gifts older than her N days; Home's dashboard list is the largest five of the last 90
// days. The Report builder's Thanked = No is this rule over whatever dates the report picks.
"use strict";
const { AWAITING } = require("./thanks");
// IMPORT-11: a gift dated after today (TRUTH-6, scheduled.js) waits for no thanks until its day:
// the rail read "No draft yet" for a gift that had not come in.
// NUMBERS-10: a gift dated after today with no scheduled_on (an older row, or one written straight to the
// table) waits for no thanks either, so Home's tile and the backlog report, which ends today, give one count.
const { DUE, ORG_TODAY } = require("./scheduled");

// SQL: gift `g` of person `d` waits to be thanked; `since` is a bound placeholder for the start day.
const WAITING = (g = "g", d = "d", since = "?") =>
  `(${AWAITING(g)} AND ${g}.is_sample IS NOT TRUE AND ${d}.is_sample IS NOT TRUE AND ${d}.deleted_at IS NULL
    AND ${g}.date IS NOT NULL AND ${g}.date >= ${since} AND ${g}.date <= ${ORG_TODAY(g)} AND ${DUE(g)})`;

// SQL: gift `g` has a thank-you draft ready (not sent, not skipped).
const DRAFTED = (g = "g") =>
  `EXISTS (SELECT 1 FROM thank_you_drafts td WHERE td.org_id = ${g}.org_id AND (td.gift_id = ${g}.id OR ${g}.id = ANY(td.also_gift_ids)) AND td.sent_at IS NULL AND td.skipped_at IS NULL)`;   // ONE-MOVE-1: a gift folded into its day's draft is drafted

// { n, cents, drafted, since } for one org.
async function backlog(query, orgId, since) {
  const [r] = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents,
            COUNT(*) FILTER (WHERE ${DRAFTED("g")})::int AS drafted
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${WAITING("g", "d")}`, [orgId, since]);
  return { n: Number(r && r.n) || 0, cents: Number(r && r.cents) || 0, drafted: Number(r && r.drafted) || 0, since };
}

// Acknowledgments' backlog: the waiting gifts dated on or before `cutoff` (her N days), oldest first,
// the first 500 listed, and how many there are in all.
async function waitingOlderThan(query, orgId, since, cutoff) {
  const rows = await query(
    `SELECT g.id, g.amount, g.date, g.donor_id, d.name, d.address, d.city, d.state, d.zip, d.deceased, f.name AS fund
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id
      WHERE g.org_id = ? AND ${WAITING("g", "d")} AND g.date <= ?
      ORDER BY g.date ASC, d.name LIMIT 500`, [orgId, since, cutoff]);
  const older = rows.length < 500 ? rows.length : (await query(
    `SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${WAITING("g", "d")} AND g.date <= ?`, [orgId, since, cutoff]))[0].n;
  return { rows, older };
}

// POLISH-14 item 6: the Acknowledgment backlog report's page: the waiting gifts dated from..to,
// oldest first, `limit` of them from `offset` (no limit: the whole range, for its CSV and PDF).
async function waitingBetween(query, orgId, from, to, { limit = null, offset = 0 } = {}) {
  return query(
    `SELECT g.id, g.amount, g.date, g.donor_id, d.name, f.name AS fund
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.org_id = ? AND ${WAITING("g", "d")} AND g.date <= ?
      ORDER BY g.date ASC, d.name, g.id${limit ? ` LIMIT ${Number(limit) | 0} OFFSET ${Math.max(0, Number(offset) | 0)}` : ""}`, [orgId, from, to]);
}

// NUMBERS-10 item 2: the earliest day WAITING's `since` can take, for "older than the window" (figureSources
// `unthanked-before`): a waiting gift of any date, before the window's first day.
const EVER = "0001-01-01";

// NUMBERS-10 item 2: the rows of "Older than the window" (figure source `unthanked-before`,
// server/outreach/thanksSources.js): waiting gifts of any date before the window's first day.
const OLDER_ROWS = (orgId, before) => ({
  sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, NULL::text AS detail
          FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         WHERE g.org_id = ? AND ${WAITING("g", "d")} AND g.date < ?`,
  args: [orgId, EVER, before],
});

const SENTENCE = "Waiting to be thanked: every gift dated on or after the day you started with Steward with no thank-you logged. A refund, a gift refunded in full, sample data and a deleted person's gifts wait for no thanks. A drafted thank-you still waits until it is marked sent.";

const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const gifts = n => `${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"}`;
// "7 gifts ($32,000) are waiting to be thanked since Oct 27, 2026; 3 have no draft yet."
function backlogWords(b, sinceWords) {
  if (!b || !b.n) return `No gift is waiting to be thanked since ${sinceWords}.`;
  const undrafted = b.n - b.drafted;
  const tail = !undrafted ? (b.n === 1 ? "it has a draft ready" : "each has a draft ready")
    : undrafted === b.n ? (b.n === 1 ? "it has no draft yet" : "none has a draft yet")
    : `${undrafted.toLocaleString("en-US")} ${undrafted === 1 ? "has" : "have"} no draft yet`;
  return `${gifts(b.n)} (${usd(b.cents)}) ${b.n === 1 ? "is" : "are"} waiting to be thanked since ${sinceWords}; ${tail}.`;
}

module.exports = { EVER, OLDER_ROWS, waitingOlderThan, waitingBetween, WAITING, DRAFTED, backlog, backlogWords, SENTENCE };
