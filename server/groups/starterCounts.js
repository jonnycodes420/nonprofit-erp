// server/groups/starterCounts.js · INSIGHTS-2 item 2. EVERY STARTER GROUP'S
// COUNT IN ONE PASS OVER THE ORG.
//
// groups.js memberCounts counted each starter as its own subquery: nineteen
// whole-org scans in one statement (fourteen starters, and the five asking
// ones again without the do-not-solicit rule), four of them recomputing the
// whole-org status (statusSql) for Lapsing and Lapsed. 2.1 to 2.3 s on a
// 25,000-person org locally, over the 10 s guard on CI.
//
// Here: the org's people are read once, their gifts are aggregated once per
// person (one scan of gifts), the status is computed once (a MATERIALIZED
// CTE), and each starter is a COUNT(*) FILTER over that one row per person.
// Each FILTER is the same rule buildDonorFilter writes for the starter
// (groups.js "THE STARTER RULES" and the rule blocks it names), read from the
// same windows (reportHooks.yearWindows, thanksSince, donorStatus), so a
// card's count is the group's own People figure. tests/insights2-off-request
// checks that, starter by starter, against the group's member query.
"use strict";
const { querySetwise } = require("../../db");

// The rule each starter is, over one person row `d` and their gift aggregate `ga`.
// `sol` is the asking starters' rule: leave out do not solicit, do not contact, deceased.
const SOL = "d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE AND d.do_not_solicit IS NOT TRUE";
const RULE = {
  lybunt: "ga.prior_any IS TRUE AND ga.cur_any IS NOT TRUE",
  sybunt: "ga.before_cur IS TRUE AND ga.cur_any IS NOT TRUE AND ga.prior_any IS NOT TRUE",
  lapsing: "d.id IN (SELECT st.donor_id FROM st WHERE st.lapsing)",
  lapsed: "d.id IN (SELECT st.donor_id FROM st WHERE st.lifecycle = 'lapsed')",
  first_gift: "ga.cur_any IS TRUE AND ga.first_date >= $CUR_FROM",
  monthly: "d.id IN (SELECT donor_id FROM rx)",
  gave_more: "COALESCE(ga.prior_money, 0) > 0 AND COALESCE(ga.cur_money, 0) > COALESCE(ga.prior_money, 0)",
  top_tenth: "d.id IN (SELECT id FROM tt)",
  awaiting_thanks: "ga.unthanked IS TRUE",
  no_history: "d.id NOT IN (SELECT donor_id FROM ih)",
  volunteers_never_gave: "ga.gave IS NOT TRUE AND d.id IN (SELECT person_id FROM vol)",
  guests_never_gave: "ga.gave IS NOT TRUE AND d.id IN (SELECT donor_id FROM att)",
  board: "d.board_member IS TRUE",
  do_not_solicit: "(d.do_not_solicit IS TRUE OR d.do_not_contact IS TRUE)",
};

// { key: { count, all } } for every starter (`all`: an asking starter without
// the do-not-solicit rule, so the card can say how many it leaves out).
async function starterCounts(orgId, starters) {
  const RH = require("../../routes/crm").reportHooks;
  const DS = require("../../donorStatus");
  const M = require("../../shared/numbers/money");
  const RECURRING_IN = require("../../groups").ACTIVE_RECURRING_STATUSES.map(x => `'${x}'`).join(",");
  const [{ cur, prior }, since, today, cuts] = await Promise.all([RH.yearWindows(orgId), RH.thanksSince(orgId), DS.todayFor(orgId), DS.cutsFor(orgId)]);
  const status = DS.statusSql(orgId, today, cuts);
  const args = [];
  const p = (v) => { args.push(v); return "?"; };
  // One per person: the gift facts the starter rules read (each the same
  // predicate as its EXISTS or SUM in buildDonorFilter, any NULL date skipped).
  const gifts = `SELECT g.donor_id,
        BOOL_OR(g.date >= ${p(prior.from)} AND g.date <= ${p(prior.to)}) AS prior_any,
        BOOL_OR(g.date >= ${p(cur.from)} AND g.date <= ${p(cur.to)}) AS cur_any,
        BOOL_OR(g.date < ${p(cur.from)}) AS before_cur,
        MIN(g.date) AS first_date,
        COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ${p(prior.from)} AND g.date <= ${p(prior.to)} AND ${M.MONEY("g")}), 0) AS prior_money,
        COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ${p(cur.from)} AND g.date <= ${p(cur.to)} AND ${M.MONEY("g")}), 0) AS cur_money,
        BOOL_OR(g.amount > 0) AS gave,
        BOOL_OR(g.date >= ${p(since)} AND COALESCE(g.is_sample,false) = false AND COALESCE(g.acknowledgement_sent,false) = false) AS unthanked
      FROM gifts g WHERE g.org_id = ${p(orgId)} GROUP BY g.donor_id`;
  const st = status.sql; args.push(...status.args);
  const rest = `
    rx AS (SELECT rx.donor_id FROM recurring_subscriptions rx WHERE rx.org_id = ${p(orgId)} AND rx.interval = 'month' AND rx.status IN (${RECURRING_IN}) AND rx.donor_id IS NOT NULL),
    tt AS (SELECT t.id FROM (SELECT x.id, ROW_NUMBER() OVER (ORDER BY COALESCE(x.total_giving,0) DESC, x.id) AS rn, COUNT(*) OVER () AS n
                               FROM donors x WHERE x.org_id = ${p(orgId)} AND x.deleted_at IS NULL AND COALESCE(x.total_giving,0) > 0) t
            WHERE t.rn <= CEIL(t.n / 10.0)),
    ih AS (SELECT ih.donor_id FROM interactions ih WHERE ih.org_id = ${p(orgId)} AND ih.donor_id IS NOT NULL),
    vol AS (SELECT vx.person_id FROM volunteer_shifts vx WHERE vx.org_id = ${p(orgId)} AND vx.person_id IS NOT NULL
            UNION SELECT ax.person_id FROM volunteer_applications ax WHERE ax.org_id = ${p(orgId)} AND ax.status = 'approved' AND ax.person_id IS NOT NULL),
    att AS (SELECT ea.donor_id FROM event_attendees ea WHERE ea.org_id = ${p(orgId)} AND ea.donor_id IS NOT NULL
             AND (lower(COALESCE(ea.status,'')) = 'attended' OR ea.checked_in_at IS NOT NULL))`;
  // Placeholders bind in the order they appear: the CTEs above, the columns, the org.
  const cols = [];
  for (const s of starters) {
    const rule = RULE[s.key];
    if (!rule) throw new Error(`starterCounts: no one-pass rule for starter ${s.key}`);
    const r = () => rule.replace("$CUR_FROM", () => p(cur.from));
    cols.push(`COUNT(*) FILTER (WHERE ${r()}${s.asking ? ` AND ${SOL}` : ""})::int AS "${s.key}"`);
    if (s.asking) cols.push(`COUNT(*) FILTER (WHERE ${r()})::int AS "${s.key}:all"`);
  }
  // Only the two status columns the starters read: Postgres then leaves the
  // rest of statusSql's columns (level, pledge overdue and held, ...) uncomputed.
  const sql = `WITH ga AS (${gifts}), st AS MATERIALIZED (SELECT s.donor_id, s.lapsing, s.lifecycle FROM (${st}) s),${rest}
    SELECT ${cols.join(",\n      ")}
      FROM donors d LEFT JOIN ga ON ga.donor_id = d.id
     WHERE d.org_id = ${p(orgId)} AND d.deleted_at IS NULL AND d.archived_at IS NULL`;
  const [row] = await querySetwise(sql, args);
  const out = {};
  for (const s of starters) out[s.key] = { count: Number(row[s.key]) || 0, all: s.asking ? Number(row[`${s.key}:all`]) || 0 : null };
  return out;
}

module.exports = { starterCounts, RULE };
