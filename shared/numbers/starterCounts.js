// shared/numbers/starterCounts.js · INSIGHTS-2. THE STARTER GROUPS' COUNTS AS
// ONE STATEMENT (server/groups/starterCounts.js runs it).
//
// The org's people once, their gifts aggregated once per person (one scan of
// gifts), the status once (statusSql, handed in), and each starter a
// COUNT(*) FILTER over that one row per person, with the same rule
// buildDonorFilter writes for it (groups.js "THE STARTER RULES" and the rule
// blocks it names). tests/insights2-off-request checks each card against its
// group's own member query.
"use strict";
const { EVERYONE } = require("./everyone");
const M = require("./money");

// The rule each starter is, over one person row `d` and their gift aggregate `ga`.
// `sol` is the asking starters' rule: leave out do not solicit, do not contact, deceased.
const SOL = "d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE AND d.do_not_solicit IS NOT TRUE";
const RULE = {
  // TRUTH-2: shared/numbers/bunt.js's rule, set-wise: "gave" is a gift above
  // zero (money.js GIFT), and an erased or sample person is on neither.
  lybunt: "ga.prior_gift IS TRUE AND ga.cur_gift IS NOT TRUE AND d.erased_at IS NULL AND d.is_sample IS NOT TRUE",
  sybunt: "ga.before_gift IS TRUE AND ga.cur_gift IS NOT TRUE AND ga.prior_gift IS NOT TRUE AND d.erased_at IS NULL AND d.is_sample IS NOT TRUE",
  lapsing: "d.id IN (SELECT st.donor_id FROM st WHERE st.lapsing)",
  lapsed: "d.id IN (SELECT st.donor_id FROM st WHERE st.lifecycle = 'lapsed')",
  first_gift: "ga.cur_any IS TRUE AND ga.first_date >= $CUR_FROM",
  monthly: "d.id IN (SELECT donor_id FROM rx)",
  gave_more: "COALESCE(ga.prior_money, 0) > 0 AND COALESCE(ga.cur_money, 0) > COALESCE(ga.prior_money, 0)",
  top_tenth: "d.id IN (SELECT id FROM tt)",
  awaiting_thanks: "ga.unthanked IS TRUE",
  no_history: "d.id NOT IN (SELECT donor_id FROM ih)",
  // FLOWS-7 (W-1112-Volunteers-31X): a volunteer is a person with the Volunteer
  // type (shared/personType.js typeSql, the rule group's "Role is Volunteer" and
  // the roster's), not only one with a logged shift: 13 against their 40.
  volunteers_never_gave: `ga.gave IS NOT TRUE AND (d.person_types @> '["volunteer"]'::jsonb)`,
  guests_never_gave: "ga.gave IS NOT TRUE AND d.id IN (SELECT donor_id FROM att)",
  board: "d.board_member IS TRUE",
  do_not_solicit: "(d.do_not_solicit IS TRUE OR d.do_not_contact IS TRUE)",
};

// The statement. `o`: { orgId, cur, prior (the fiscal-year windows), since
// (thanksSince), status (statusSql's { sql, args }), monthlyIds (FLOWS-2; was recurringIn, the running
// recurring states, quoted), starters }.
function starterCountsSql(o) {
  // FLOWS-2: monthlyIds is the one gives-monthly rule's people (shared/numbers/givesMonthly.js), worked out before this statement.
  const { orgId, cur, prior, since, status, starters, monthlyIds = [] } = o;
  const args = [];
  const p = (v) => { args.push(v); return "?"; };
  // One per person: the gift facts the starter rules read (each the same
  // predicate as its EXISTS or SUM in buildDonorFilter, any NULL date skipped).
  const gifts = `SELECT g.donor_id,
        BOOL_OR(g.date >= ${p(prior.from)} AND g.date <= ${p(prior.to)}) AS prior_any,
        BOOL_OR(g.date >= ${p(cur.from)} AND g.date <= ${p(cur.to)}) AS cur_any,
        BOOL_OR(g.date < ${p(cur.from)}) AS before_cur,
        BOOL_OR(g.date >= ${p(prior.from)} AND g.date <= ${p(prior.to)} AND ${M.GIFT("g")}) AS prior_gift,
        BOOL_OR(g.date >= ${p(cur.from)} AND g.date <= ${p(cur.to)} AND ${M.GIFT("g")}) AS cur_gift,
        BOOL_OR(g.date < ${p(cur.from)} AND ${M.GIFT("g")}) AS before_gift,
        MIN(g.date) AS first_date,
        COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ${p(prior.from)} AND g.date <= ${p(prior.to)} AND ${M.MONEY("g")}), 0) AS prior_money,
        COALESCE(SUM(g.amount) FILTER (WHERE g.date >= ${p(cur.from)} AND g.date <= ${p(cur.to)} AND ${M.MONEY("g")}), 0) AS cur_money,
        BOOL_OR(${M.GIFT("g")}) AS gave,   -- TRUTH-4: a counted gift, as groups.js given=never reads it
        BOOL_OR(g.date >= ${p(since)} AND COALESCE(g.is_sample,false) = false AND COALESCE(g.acknowledgement_sent,false) = false) AS unthanked
      FROM gifts g WHERE g.org_id = ${p(orgId)} GROUP BY g.donor_id`;
  const st = status.sql; args.push(...status.args);
  const rest = `
    rx AS (SELECT unnest(${p(monthlyIds)}::text[]) AS donor_id),
    tt AS (SELECT t.id FROM (SELECT x.id, ROW_NUMBER() OVER (ORDER BY COALESCE(x.total_giving,0) DESC, x.id) AS rn, COUNT(*) OVER () AS n
                               FROM donors x WHERE x.org_id = ${p(orgId)} AND x.deleted_at IS NULL AND COALESCE(x.total_giving,0) > 0) t
            WHERE t.rn <= CEIL(t.n / 10.0)),
    ih AS (SELECT ih.donor_id FROM interactions ih WHERE ih.org_id = ${p(orgId)} AND ih.donor_id IS NOT NULL),
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
     WHERE d.org_id = ${p(orgId)} AND ${EVERYONE("d")}`;   // TRUTH-4 (W-1108-Volunteers-31X): Everyone's rule, as a group's people (erased out)
  return { sql, args };
}

// The row it returns, per starter: { count, all } (`all`: an asking starter
// without the do-not-solicit rule, so the card can say how many it leaves out).
function countsOf(row, starters) {
  const out = {};
  for (const s of starters) out[s.key] = { count: Number(row[s.key]) || 0, all: s.asking ? Number(row[`${s.key}:all`]) || 0 : null };
  return out;
}

module.exports = { starterCountsSql, countsOf, RULE };
