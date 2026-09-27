// figureSources.js — FIX-2 A. EVERY NUMBER OPENS: THE ROWS BEHIND A FIGURE.
//
// Jonathan, 27 September: the dashboards were thin tiles with no way to see
// where a number came from. The rule since then: every number Steward shows
// opens, and what it opens is the rows that make it, with a total that foots
// to the number on screen to the cent.
//
// This file is the ONE definition of each figure. A source is a named query
// over the organisation's own rows; the figure's value is an aggregate OVER
// THAT EXACT QUERY (a sum, a count or an average of its rows), and the
// drill-through pages through the same query. The value and the rows cannot
// disagree, because there is only one filter to disagree with.
//
//   figure(orgId, {key, params}, deps, {page, pageSize})
//     → { key, params, measure, label, sentence, value, cents, blank,
//         rows, page, pageSize, totalRows, parts? }
//
// Four shapes of source:
//   · sql        — rows from one SELECT; the value is SUM/COUNT/AVG over it
//   · js         — rows computed in code (Drift, the retention cohorts); the
//                  value is the same aggregate over the same array
//   · ratio      — a percentage: its numerator and its denominator are each a
//                  source, and the value is computed from THEIR values
//   · difference — one source less another (the Board sentence)
//
// Every SQL source is scoped to the caller's org by its first argument, and
// every request is a read: nothing here writes, snapshots or caches.
//
// Row shape, for every source: { id, type, donorId, name, date, dateLabel,
// amount, detail }. `date` stays ISO for a machine; `dateLabel` is what a
// person reads ("Jan 14, 2026", shared/displayDate.js).
"use strict";

const { query } = require("./db");
const orgTime = require("./orgTime");
const money = require("./money");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_.:\-]{1,120}$/;
const WORD_RE = /^[A-Za-z0-9_ \-]{1,60}$/;
const PAGE_MAX = 200;

class FigureParamError extends Error {}

let _dd = null;
async function displayDateMod() { return _dd || (_dd = await import("./shared/displayDate.js")); }

// ── PARAMETERS ─────────────────────────────────────────────────────────────
// A source names the parameters it reads and their shape. Anything else is
// ignored; a malformed value is refused (400), never guessed at.
const T = {
  date: (v, k) => { if (!DATE_RE.test(String(v))) throw new FigureParamError(`${k} must be a date written 2026-01-31.`); return String(v); },
  id: (v, k) => { if (!ID_RE.test(String(v))) throw new FigureParamError(`${k} is not an id.`); return String(v); },
  word: (v, k) => { if (!WORD_RE.test(String(v))) throw new FigureParamError(`${k} is not a word Steward knows.`); return String(v); },
  bool: (v, k) => {
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    throw new FigureParamError(`${k} must be true or false.`);
  },
  measure: (v, k) => { if (!["sum", "count"].includes(String(v))) throw new FigureParamError(`${k} must be sum or count.`); return String(v); },
};
function readParams(def, raw) {
  const out = {};
  for (const [k, spec] of Object.entries(def.params || {})) {
    const [type, required] = spec.split(":");
    const v = raw ? raw[k] : undefined;
    if (v === undefined || v === null || v === "") {
      if (required === "required") throw new FigureParamError(`${k} is required.`);
      continue;
    }
    out[k] = T[type](v, k);
  }
  return out;
}

// ── THE COLUMNS EVERY SQL SOURCE SELECTS ───────────────────────────────────
// id, type, donor_id, name, date (TEXT, ISO), amount (NUMERIC or NULL), detail
const MONTHLY = "ROUND(CASE WHEN s.interval='year' THEN s.amount/12.0 ELSE s.amount END, 2)";
const STATUS_WORD = `CASE s.status WHEN 'active' THEN 'Giving' WHEN 'recovered' THEN 'Giving again after a failed card'
  WHEN 'past_due' THEN 'Card failing' WHEN 'recovering' THEN 'Being recovered' WHEN 'paused' THEN 'Paused'
  WHEN 'canceled' THEN 'Ended' WHEN 'cancelled' THEN 'Ended' ELSE INITCAP(REPLACE(s.status,'_',' ')) END`;
const CONVERSATION_TYPES = ["call", "meeting", "email", "ask", "note", "stewardship"];

function giftsWhere(p, args) {
  let w = "";
  if (p.fund === "none") w += " AND f.id IS NULL";
  else if (p.fund) { w += " AND f.id = ?"; args.push(p.fund); }
  if (p.restricted !== undefined) { w += " AND COALESCE(f.restricted,false) = ?"; args.push(p.restricted); }
  if (p.donor) { w += " AND g.donor_id = ?"; args.push(p.donor); }
  if (p.assigned) { w += " AND d.assigned_to = ?"; args.push(p.assigned); }
  return w;
}

// The ≥90% set: givers in the window, largest first, while the giving before
// each one is still under ninety per cent of the window's total.
function topGiversSql(orgId, p) {
  return {
    sql: `WITH t AS (
            SELECT d.id, d.name, SUM(g.amount)::numeric AS v, MAX(g.date) AS last
              FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
             GROUP BY d.id, d.name),
          r AS (
            SELECT t.*, COALESCE(SUM(v) OVER (ORDER BY v DESC, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before,
                   SUM(v) OVER () AS total FROM t)
          SELECT id, 'person' AS type, id AS donor_id, name, last AS date, ROUND(v, 2) AS amount, NULL::text AS detail
            FROM r WHERE total > 0 AND before < total * 0.9`,
    args: [orgId, p.from, p.to],
    order: "amount DESC, id",
  };
}

const SOURCES = {
  // ── GIFTS ────────────────────────────────────────────────────────────────
  gifts: {
    label: "Gifts",
    measure: p => p.measure || "sum",
    params: { from: "date:required", to: "date:required", fund: "id", restricted: "bool", donor: "id", assigned: "id", measure: "measure" },
    sentence: (p, dd) => `Every gift dated ${dd(p.from)} to ${dd(p.to)}${p.fund === "none" ? " with no fund named" : p.fund ? " to this fund" : ""}${p.restricted === true ? " to a restricted fund" : p.restricted === false ? " that is unrestricted" : ""}${p.donor ? " from this person" : ""}.`,
    sql: (orgId, p) => {
      const args = [orgId, p.from, p.to];
      const where = giftsWhere(p, args);
      return {
        sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                     COALESCE(f.name, 'Unrestricted') AS detail
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
               WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?${where}`,
        args,
      };
    },
  },
  givers: {
    label: "People who gave",
    measure: () => "count",
    params: { from: "date:required", to: "date:required" },
    sentence: (p, dd) => `Each person with at least one gift dated ${dd(p.from)} to ${dd(p.to)}, with what they gave in that time.`,
    sql: (orgId, p) => ({
      sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(g.date) AS date, ROUND(SUM(g.amount)::numeric, 2) AS amount,
                   COUNT(*) || CASE WHEN COUNT(*) = 1 THEN ' gift' ELSE ' gifts' END AS detail
              FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
             GROUP BY d.id, d.name`,
      args: [orgId, p.from, p.to],
      order: "amount DESC, id",
    }),
  },
  "top-givers": {
    label: "The givers who carry ninety per cent",
    measure: p => p.measure || "count",
    params: { from: "date:required", to: "date:required", measure: "measure" },
    sentence: (p, dd) => `The givers, largest first, whose gifts dated ${dd(p.from)} to ${dd(p.to)} make up ninety per cent of that giving.`,
    sql: (orgId, p) => topGiversSql(orgId, p),
  },
  unthanked: {
    label: "Gifts not yet thanked",
    measure: () => "count",
    params: { since: "date:required" },
    sentence: (p, dd) => `Every gift dated on or after ${dd(p.since)}, the day you started with Steward, with no thank-you logged.`,
    sql: (orgId, p) => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, NULL::text AS detail
              FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND COALESCE(g.is_sample,false) = false
               AND g.date >= ? AND COALESCE(g.acknowledgement_sent,false) = false`,
      args: [orgId, p.since],
    }),
  },
  "thanks-marked": {
    label: "Thank-yous marked sent",
    measure: () => "count",
    params: { from: "date:required", to: "date:required", assigned: "id" },
    sentence: (p, dd) => `Every gift marked acknowledged between ${dd(p.from)} and ${dd(p.to)}.`,
    sql: (orgId, p) => {
      const args = [orgId, p.from, p.to];
      const where = p.assigned ? (args.push(p.assigned), " AND d.assigned_to = ?") : "";
      return {
        sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, TO_CHAR(g.acknowledgement_sent_at, 'YYYY-MM-DD') AS date,
                     ROUND(g.amount::numeric, 2) AS amount, NULL::text AS detail
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
               WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.acknowledgement_sent_at IS NOT NULL
                 AND g.acknowledgement_sent_at >= ?::date AND g.acknowledgement_sent_at < (?::date + 1)${where}`,
        args,
      };
    },
  },
  conversations: {
    label: "Conversations logged",
    measure: () => "count",
    params: { from: "date:required", to: "date:required", by: "id" },
    sentence: (p, dd) => `Every call, meeting, email, ask and note somebody logged between ${dd(p.from)} and ${dd(p.to)}.`,
    sql: (orgId, p) => {
      const args = [orgId, p.from, p.to, CONVERSATION_TYPES];
      const where = p.by ? (args.push(p.by), " AND i.created_by = ?") : "";
      return {
        sql: `SELECT i.id, 'interaction' AS type, i.donor_id, d.name, i.date, NULL::numeric AS amount, INITCAP(i.type) AS detail
                FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
               WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.date >= ? AND i.date <= ?
                 AND i.type = ANY(?)${where}`,
        args,
      };
    },
  },
  "threads-closed": {
    label: "Follow-ups closed",
    measure: () => "count",
    params: { from: "date:required", to: "date:required", kind: "word:required", owner: "id" },
    sentence: (p, dd) => `Every follow-up ${p.kind === "dismissed" ? "closed without a conversation, with its reason," : "closed because the conversation happened,"} between ${dd(p.from)} and ${dd(p.to)}.`,
    sql: (orgId, p) => {
      const args = [orgId, p.from, p.to, p.kind];
      const where = p.owner ? (args.push(p.owner), " AND t.owner_id = ?") : "";
      return {
        sql: `SELECT t.id, 'thread' AS type, t.donor_id, d.name, TO_CHAR(t.closed_at, 'YYYY-MM-DD') AS date, NULL::numeric AS amount,
                     COALESCE(t.close_reason, t.next_step_label) AS detail
                FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
               WHERE t.org_id = ? AND d.deleted_at IS NULL AND t.closed_at IS NOT NULL
                 AND t.closed_at >= ?::date AND t.closed_at < (?::date + 1) AND t.close_kind = ?${where}`,
        args,
      };
    },
  },
  milestones: {
    label: "Milestones crossed",
    measure: () => "count",
    params: { since: "date:required" },
    sentence: (p, dd) => `Every milestone Steward noticed on or after ${dd(p.since)}.`,
    sql: (orgId, p) => ({
      sql: `SELECT m.id, 'milestone' AS type, m.donor_id, d.name, TO_CHAR(m.created_at, 'YYYY-MM-DD') AS date,
                   NULL::numeric AS amount, m.subject AS detail
              FROM milestone_drafts m LEFT JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
             WHERE m.org_id = ? AND m.created_at >= ?::date`,
      args: [orgId, p.since],
    }),
  },

  // ── MONTHLY GIVING ───────────────────────────────────────────────────────
  recurring: {
    label: "Monthly gifts",
    measure: () => "count",
    params: { status: "word", endedSince: "date", recoveredSince: "date" },
    sentence: (p, dd) => p.endedSince ? `Every monthly gift that ended on or after ${dd(p.endedSince)}.`
      : p.recoveredSince ? `Every monthly gift whose card failed and then charged again, on or after ${dd(p.recoveredSince)}.`
      : p.status === "giving" ? "Every monthly gift charging successfully today."
      : p.status ? "Every monthly gift in this state today." : "Every monthly gift on file.",
    sql: (orgId, p) => {
      const args = [orgId];
      let w = "";
      if (p.status === "giving") w += " AND s.status IN ('active','recovered')";
      else if (p.status) { w += " AND s.status = ?"; args.push(p.status); }
      if (p.endedSince) { w += " AND s.status = 'canceled' AND s.canceled_at >= ?"; args.push(p.endedSince); }
      if (p.recoveredSince) { w += " AND s.status = 'recovered' AND s.recovered_at >= ?"; args.push(p.recoveredSince); }
      return {
        sql: `SELECT s.id, 'subscription' AS type, s.donor_id, d.name, TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
                     ROUND(s.amount::numeric, 2) AS amount,
                     (CASE WHEN s.interval = 'year' THEN 'Yearly' ELSE 'Monthly' END) || ' · ' || ${STATUS_WORD} AS detail
                FROM recurring_subscriptions s LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
               WHERE s.org_id = ?${w}`,
        args,
      };
    },
  },
  "recurring-monthly": {
    label: "Monthly giving",
    measure: () => "sum",
    params: {},
    sentence: () => "Every monthly gift charging successfully today, at what it brings in each month. A yearly gift counts as a twelfth of its amount.",
    sql: orgId => ({
      sql: `SELECT s.id, 'subscription' AS type, s.donor_id, d.name, TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
                   ${MONTHLY} AS amount, CASE WHEN s.interval = 'year' THEN 'Yearly, counted monthly' ELSE 'Monthly' END AS detail
              FROM recurring_subscriptions s LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
             WHERE s.org_id = ? AND s.status IN ('active','recovered')`,
      args: [orgId],
      order: "amount DESC, id",
    }),
  },
  "recurring-change": {
    label: "Change in monthly giving",
    measure: () => "sum",
    params: { since: "date:required" },
    sentence: (p, dd) => `Monthly gifts started on or after ${dd(p.since)}, at what each adds a month, less those that ended in the same time.`,
    sql: (orgId, p) => ({
      sql: `SELECT s.id || ':started' AS id, 'subscription' AS type, s.donor_id, d.name, TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
                   ${MONTHLY} AS amount, 'Started' AS detail
              FROM recurring_subscriptions s LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
             WHERE s.org_id = ? AND s.created_at >= ?::date
            UNION ALL
            SELECT s.id || ':ended', 'subscription', s.donor_id, d.name, TO_CHAR(s.canceled_at, 'YYYY-MM-DD'),
                   -${MONTHLY}, 'Ended'
              FROM recurring_subscriptions s LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
             WHERE s.org_id = ? AND s.canceled_at >= ?::date`,
      args: [orgId, p.since, orgId, p.since],
    }),
  },
  "recurring-months": {
    label: "Months on file",
    measure: () => "avg",
    amountKind: "months",
    params: {},
    sentence: () => "Every monthly gift charging successfully today, with how many months it has been giving.",
    sql: orgId => ({
      sql: `SELECT s.id, 'subscription' AS type, s.donor_id, d.name, TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
                   (EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 2629800.0)::numeric AS amount, 'Months giving' AS detail
              FROM recurring_subscriptions s LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
             WHERE s.org_id = ? AND s.status IN ('active','recovered')`,
      args: [orgId],
      order: "amount DESC, id",
    }),
  },
  "recovery-events": {
    label: "Failed cards",
    measure: () => "count",
    params: { type: "word:required", since: "date:required" },
    sentence: (p, dd) => p.type === "payment_recovered"
      ? `Every monthly gift that charged again after a failed card, on or after ${dd(p.since)}.`
      : `Every failed monthly charge Steward began working, on or after ${dd(p.since)}.`,
    sql: (orgId, p) => ({
      sql: `SELECT e.id, 'event' AS type, e.donor_id, d.name, TO_CHAR(e.created_at, 'YYYY-MM-DD') AS date, NULL::numeric AS amount,
                   CASE e.type WHEN 'payment_recovered' THEN 'Charged again' ELSE 'Card failed' END AS detail
              FROM payment_recovery_events e LEFT JOIN donors d ON d.id = e.donor_id AND d.org_id = e.org_id
             WHERE e.org_id = ? AND e.type = ? AND e.created_at >= ?`,
      args: [orgId, p.type, p.since],
    }),
  },
  "source-recurring": {
    label: "Monthly through connected sources",
    measure: () => "count",
    params: { unconfirmed: "bool" },
    sentence: p => p.unconfirmed ? "Every schedule Steward saw in a connected source's gifts that nobody has confirmed yet."
      : "Every donor giving on a schedule through a connected source.",
    sql: (orgId, p) => ({
      sql: `SELECT r.id, 'recurring' AS type, r.donor_id, d.name, r.last_gift_on AS date, ROUND(r.amount_cents / 100.0, 2) AS amount,
                   s.display_name || CASE WHEN r.confidence = 'inferred' AND r.confirmed_at IS NULL THEN ' · looks monthly' ELSE '' END AS detail
              FROM giving_recurring r
              JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
              JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id AND d.deleted_at IS NULL
             WHERE r.org_id = ? AND r.status <> 'ended' AND s.status <> 'disconnected'
               ${p.unconfirmed ? "AND r.confidence = 'inferred' AND r.confirmed_at IS NULL" : ""}`,
      args: [orgId],
    }),
  },

  // ── PLEDGES, GOALS, GRANTS, PIPELINE ────────────────────────────────────
  "pledges-open": {
    label: "Pledged, not yet paid",
    measure: () => "sum",
    params: {},
    sentence: () => "Every open pledge, at what is still to come on it. A pledge part-paid counts only the remainder.",
    sql: orgId => ({
      sql: `SELECT p.id, 'pledge' AS type, p.donor_id, d.name, p.due_date AS date,
                   ROUND(GREATEST(p.amount - COALESCE(pp.paid, 0), 0)::numeric, 2) AS amount, 'Due' AS detail
              FROM pledges p
              LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
              LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp
                     ON pp.pledge_id = p.id
             WHERE p.org_id = ? AND p.status = 'open'`,
      args: [orgId, orgId],
      order: "date ASC NULLS LAST, id",
    }),
  },
  "pledge-payments": {
    label: "Pledged and paid",
    measure: () => "sum",
    params: {},
    sentence: () => "Every gift that paid toward a pledge, whether or not that pledge is settled yet.",
    sql: orgId => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, 'Toward a pledge' AS detail
              FROM gifts g JOIN pledges p ON p.id = g.pledge_id AND p.org_id = g.org_id
              LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ?`,
      args: [orgId],
    }),
  },
  "goal-raised": {
    label: "Raised toward the goal",
    measure: () => "sum",
    params: { campaign: "id:required" },
    sentence: () => "Every gift given to this goal, less any processing fee the donor covered, and every grant awarded toward it.",
    sql: (orgId, p) => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date,
                   ROUND((g.amount - COALESCE(g.cover_fee_amount, 0))::numeric, 2) AS amount, 'Gift' AS detail
              FROM campaigns c
              JOIN gifts g ON g.org_id = c.org_id AND (g.campaign_id = c.id OR g.campaign = c.name)
              LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE c.org_id = ? AND c.id = ?
            UNION ALL
            SELECT gr.id, 'grant', gr.funder_donor_id, gr.funder, TO_CHAR(gr.awarded_at, 'YYYY-MM-DD'),
                   ROUND(COALESCE(gr.amount, 0)::numeric, 2), 'Grant awarded'
              FROM grants gr WHERE gr.org_id = ? AND gr.campaign_id = ? AND gr.awarded_at IS NOT NULL`,
      args: [orgId, p.campaign, orgId, p.campaign],
    }),
  },
  grant: {
    label: "The grant",
    measure: () => "sum",
    params: { id: "id:required" },
    sentence: () => "The grant as it stands on its record, at the amount it asks for.",
    sql: (orgId, p) => ({
      sql: `SELECT gr.id, 'grant' AS type, gr.funder_donor_id AS donor_id, gr.funder AS name, gr.deadline AS date,
                   ROUND(COALESCE(gr.amount, 0)::numeric, 2) AS amount, gr.program AS detail
              FROM grants gr WHERE gr.org_id = ? AND gr.id = ?`,
      args: [orgId, p.id],
    }),
  },
  "campaign-goal": {
    label: "The goal",
    measure: () => "sum",
    params: { campaign: "id:required" },
    sentence: () => "The target set on this goal's record.",
    sql: (orgId, p) => ({
      sql: `SELECT c.id, 'goal' AS type, NULL::text AS donor_id, c.name, c.end_date AS date,
                   ROUND(c.goal_amount::numeric, 2) AS amount, 'Target' AS detail
              FROM campaigns c WHERE c.org_id = ? AND c.id = ? AND c.goal_amount IS NOT NULL`,
      args: [orgId, p.campaign],
    }),
  },
  "grants-due": {
    label: "Grant deadlines",
    measure: p => p.measure || "count",
    params: { from: "date:required", to: "date:required", measure: "measure" },
    sentence: (p, dd) => `Every grant still being pursued whose deadline falls ${dd(p.from)} to ${dd(p.to)}. A grant already awarded or closed is not listed.`,
    sql: (orgId, p) => ({
      sql: `SELECT gr.id, 'grant' AS type, gr.funder_donor_id AS donor_id, gr.funder AS name, gr.deadline AS date,
                   ROUND(COALESCE(gr.amount, 0)::numeric, 2) AS amount, gr.program AS detail
              FROM grants gr
             WHERE gr.org_id = ? AND gr.deadline IS NOT NULL AND gr.deadline <> '' AND gr.deadline >= ? AND gr.deadline <= ?
               AND gr.status NOT IN ('awarded','active','closed','rejected')`,
      args: [orgId, p.from, p.to],
      order: "date ASC, id",
    }),
  },
  "goal-progress": {
    label: "Progress toward the goal",
    ratio: "share",
    params: { campaign: "id:required" },
    sentence: () => "What has been raised toward this goal, as a share of its target.",
    parts: p => [
      { role: "numerator", label: "Raised", key: "goal-raised", params: { campaign: p.campaign } },
      { role: "denominator", label: "The goal", key: "campaign-goal", params: { campaign: p.campaign } },
    ],
  },
  "pipeline-stage": {
    label: "Prospects in this stage",
    measure: () => "count",
    params: { stage: "word:required" },
    sentence: () => "Every prospect assigned to an officer who is in this stage today.",
    sql: (orgId, p) => ({
      sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, d.last_gift_date AS date, NULL::numeric AS amount, d.stage AS detail
              FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.assigned_to IS NOT NULL
               AND ${p.stage === "none" ? "d.stage IS NULL" : "d.stage = ?"}`,
      args: p.stage === "none" ? [orgId] : [orgId, p.stage],
      order: "name, id",
    }),
  },
  "other-income": {
    label: "Other income",
    measure: () => "sum",
    params: {},
    sentence: () => "The one figure your organisation typed in Settings for income Steward does not track. It is never added to giving.",
    sql: orgId => ({
      sql: `SELECT 'other-income' AS id, 'record' AS type, NULL::text AS donor_id, 'Typed in Settings' AS name, NULL::text AS date,
                   ROUND(other_income_this_year::numeric, 2) AS amount, 'Other income this year' AS detail
              FROM orgs WHERE id = ? AND other_income_enabled = true AND other_income_this_year IS NOT NULL`,
      args: [orgId],
    }),
  },

  // ── COMPUTED IN CODE ─────────────────────────────────────────────────────
  "drifting-top": {
    label: "Drifting, among the top givers",
    measure: () => "count",
    params: { from: "date:required", to: "date:required" },
    sentence: () => "The top givers who are past their own giving pattern today. Drift measures each person against their own rhythm.",
    js: async (orgId, p, deps) => {
      const { sql, args } = topGiversSql(orgId, p);
      const top = await query(sql, args);
      const drift = await deps.computeDriftForDonors(orgId, {}).catch(() => ({ list: [] }));
      const byId = new Map((drift.list || []).map(x => [x.donorId, x]));
      return top.filter(r => byId.has(r.id)).map(r => ({
        id: r.id, type: "person", donor_id: r.id, name: r.name, date: r.date, amount: r.amount,
        detail: [byId.get(r.id)?.reason, byId.get(r.id)?.sentence, byId.get(r.id)?.headline].find(x => typeof x === "string") || null,
      }));
    },
  },
  "retention-retained": {
    label: "Gave last year and again this year",
    measure: () => "count",
    params: {},
    sentence: () => "Everyone who gave last calendar year and has given again this one.",
    js: async (orgId, p, deps) => {
      const r = await retentionOf(orgId, deps);
      return cohortRows(orgId, [...r.thisYearDonorIds].filter(id => r.prevYearDonorIds.has(id)), `Gave in ${r.prevYear} and ${r.year}`);
    },
  },
  "retention-prior": {
    label: "Gave last year",
    measure: () => "count",
    params: {},
    sentence: () => "Everyone who gave last calendar year: the people retention is measured against.",
    js: async (orgId, p, deps) => {
      const r = await retentionOf(orgId, deps);
      return cohortRows(orgId, [...r.prevYearDonorIds], `Gave in ${r.prevYear}`);
    },
  },

  // ── PERCENTAGES AND DIFFERENCES ─────────────────────────────────────────
  "giving-change": {
    label: "Change on last year",
    ratio: "change",
    params: { from: "date:required", to: "date:required", prevFrom: "date:required", prevTo: "date:required" },
    sentence: (p, dd) => `Giving ${dd(p.from)} to ${dd(p.to)}, against giving ${dd(p.prevFrom)} to ${dd(p.prevTo)}: the difference, as a share of last year's.`,
    parts: p => [
      { role: "numerator", label: "Giving this year", key: "gifts", params: { from: p.from, to: p.to } },
      { role: "denominator", label: "Same point last year", key: "gifts", params: { from: p.prevFrom, to: p.prevTo } },
    ],
    blank: async (orgId, p, deps, [, den], dd) => {
      if (den.value > 0) return null;
      const first = await firstGiftDate(orgId);
      const missing = `There were no gifts between ${dd(p.prevFrom)} and ${dd(p.prevTo)} to compare this year with.`;
      if (!first) return `${missing} The change appears a year after your first gift.`;
      const when = addYears(first, 1);
      return when > p.to
        ? `${missing} The change appears on ${dd(when)}, a year after your first gift, when last year's stretch has a gift in it.`
        : `${missing} It appears once the same stretch of a previous year has a gift in it.`;
    },
  },
  "giving-difference": {
    label: "Ahead of or behind last year",
    difference: true,
    params: { from: "date:required", to: "date:required", prevFrom: "date:required", prevTo: "date:required" },
    sentence: (p, dd) => `Giving ${dd(p.from)} to ${dd(p.to)}, less giving ${dd(p.prevFrom)} to ${dd(p.prevTo)}.`,
    parts: p => [
      { role: "plus", label: "Giving this year", key: "gifts", params: { from: p.from, to: p.to } },
      { role: "minus", label: "Same point last year", key: "gifts", params: { from: p.prevFrom, to: p.prevTo } },
    ],
  },
  retention: {
    label: "Retention",
    ratio: "share",
    params: {},
    sentence: () => "Of the people who gave last calendar year, the share who have given again this one.",
    parts: () => [
      { role: "numerator", label: "Gave again this year", key: "retention-retained", params: {} },
      { role: "denominator", label: "Gave last year", key: "retention-prior", params: {} },
    ],
    blank: async (orgId, p, deps, parts, dd) => {
      const r = await retentionOf(orgId, deps);
      if (!r.thinData && r.retentionRate != null) return null;
      return retentionBlank(orgId, r, dd, deps);
    },
  },
  "concentration-share": {
    label: "Share of givers who carry ninety per cent",
    ratio: "share",
    params: { from: "date:required", to: "date:required" },
    sentence: (p, dd) => `The givers who carry ninety per cent of the giving dated ${dd(p.from)} to ${dd(p.to)}, as a share of everyone who gave in that time.`,
    parts: p => [
      { role: "numerator", label: "Carry ninety per cent", key: "top-givers", params: { from: p.from, to: p.to } },
      { role: "denominator", label: "Everyone who gave", key: "givers", params: { from: p.from, to: p.to } },
    ],
  },
};

// ── HELPERS THE SOURCES SHARE ──────────────────────────────────────────────
// One retention computation per request: the rate, its numerator and its
// denominator are three reads of the SAME cohorts, never three computations.
function retentionOf(orgId, deps) {
  deps.__retention = deps.__retention || {};
  return deps.__retention[orgId] || (deps.__retention[orgId] = deps.computeRetentionRate(orgId));
}

async function cohortRows(orgId, ids, detail) {
  if (!ids.length) return [];
  const found = await query(`SELECT id, name, last_gift_date FROM donors WHERE org_id = ? AND id = ANY(?)`, [orgId, ids]);
  const byId = new Map(found.map(d => [d.id, d]));
  // One row per id in the cohort, found or not: the count is the cohort's
  // size, and a record that has since been deleted still counted in it.
  return ids.map(id => ({
    id, type: "person", donor_id: byId.has(id) ? id : null,
    name: byId.get(id)?.name || "A record that has since been deleted",
    date: byId.get(id)?.last_gift_date ? String(byId.get(id).last_gift_date).slice(0, 10) : null,
    amount: null, detail,
  }));
}

async function firstGiftDate(orgId) {
  const [r] = await query(`SELECT MIN(date) AS d FROM gifts WHERE org_id = ?`, [orgId]);
  return r && r.d ? String(r.d).slice(0, 10) : null;
}

// A year on, on the same civil day (Feb 29 lands on Feb 28).
function addYears(dateStr, n) {
  const c = orgTime.parseCivil(dateStr);
  if (!c) return null;
  const d = c.m === 2 && c.d === 29 ? 28 : c.d;
  return `${c.y + n}-${String(c.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// WHEN RETENTION WILL APPEAR, from the organisation's own data. It needs the
// history floor (eighteen months since the first gift) and a prior calendar
// year with enough givers for a rate to mean anything (RETENTION_FLOOR).
async function retentionBlank(orgId, r, dd) {
  const floor = r.floor || { minPriorYearDonors: 20, minHistoryDays: 548 };
  const first = await firstGiftDate(orgId);
  if (!first) {
    return "Retention compares each year's givers with the year before, and there are no gifts in Steward yet. It appears once a full calendar year of giving is in.";
  }
  const byHistory = orgTime.addDays(first, floor.minHistoryDays);
  const nextJan = `${r.year + 1}-01-01`;
  let when, extra = "";
  if (r.prevYearCount >= floor.minPriorYearDonors) when = byHistory;
  else {
    when = byHistory > nextJan ? byHistory : nextJan;
    if (r.thisYearCount < floor.minPriorYearDonors) {
      extra = ` It also needs at least ${floor.minPriorYearDonors} people who gave in one calendar year; ${r.thisYearCount} ${r.thisYearCount === 1 ? "has" : "have"} given so far this year.`;
    }
  }
  return `Retention compares each year's givers with the year before, and it needs a full year of giving in Steward to mean anything. It appears on ${dd(when)}.${extra}`;
}

// ── THE ENGINE ─────────────────────────────────────────────────────────────
function sourceDef(key) { return Object.prototype.hasOwnProperty.call(SOURCES, key) ? SOURCES[key] : null; }

const num = v => (v === null || v === undefined ? null : Number(v));
function shapeRow(r, dd) {
  const date = r.date ? String(r.date).slice(0, 10) : null;
  return {
    id: String(r.id), type: r.type, donorId: r.donor_id || null, name: r.name || "",
    date, dateLabel: date ? dd(date) : "", amount: num(r.amount), detail: r.detail || null,
  };
}
function valueOf(measure, agg) {
  if (measure === "sum") { const c = money.toCents(String(agg.s ?? "0")) ?? 0; return { value: money.toDollars(c), cents: c }; }
  if (measure === "avg") return { value: agg.n > 0 ? Math.round(Number(agg.a) || 0) : 0, cents: null };
  return { value: Number(agg.n) || 0, cents: null };
}
function orderClause(o) { return o || "date DESC NULLS LAST, id DESC"; }

async function plainFigure(orgId, def, key, p, deps, { page, pageSize, rows: wantRows }) {
  const measure = def.measure(p);
  const DD = await displayDateMod();
  const dd = d => DD.displayDate(d);
  let agg, pageRows;
  if (def.js) {
    const all = await def.js(orgId, p, deps);
    const sum = all.reduce((s, r) => s + (money.toCents(String(r.amount ?? "0")) ?? 0), 0);
    const avg = all.length ? all.reduce((s, r) => s + (Number(r.amount) || 0), 0) / all.length : 0;
    agg = { n: all.length, s: String(money.toDollars(sum)), a: avg };
    pageRows = wantRows ? all.slice((page - 1) * pageSize, page * pageSize) : [];
  } else {
    const { sql, args, order } = def.sql(orgId, p);
    const [a] = await query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS s, AVG(amount) AS a FROM (${sql}) x`, args);
    agg = a;
    pageRows = wantRows
      ? await query(`SELECT * FROM (${sql}) x ORDER BY ${orderClause(order)} LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
      : [];
  }
  const { value, cents } = valueOf(measure, agg);
  return {
    key, params: p, measure, amountKind: def.amountKind || "money", label: def.label, sentence: def.sentence(p, dd),
    value, cents, blank: null,
    rows: pageRows.map(r => shapeRow(r, dd)), page, pageSize, totalRows: Number(agg.n) || 0,
  };
}

async function figure(orgId, source, deps = {}, opts = {}) {
  const key = String(source && source.key || "");
  const def = sourceDef(key);
  if (!def) return null;
  const p = readParams(def, source.params || {});
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(PAGE_MAX, Math.max(1, parseInt(opts.pageSize, 10) || 50));
  const wantRows = opts.rows !== false;
  if (!def.ratio && !def.difference) return plainFigure(orgId, def, key, p, deps, { page, pageSize, rows: wantRows });

  // A PERCENTAGE OPENS BOTH HALVES. Each part is a source of its own; the
  // value is computed from the parts' values, never alongside them.
  const DD = await displayDateMod();
  const dd = d => DD.displayDate(d);
  const partDefs = def.parts(p);
  const parts = [];
  for (const pd of partDefs) {
    const f = await figure(orgId, { key: pd.key, params: pd.params }, deps, { page: 1, pageSize, rows: wantRows });
    parts.push({ ...f, role: pd.role, label: pd.label, source: { key: pd.key, params: pd.params } });
  }
  let value = null, cents = null, blank = null, measure;
  if (def.difference) {
    measure = "difference";
    cents = (parts[0].cents || 0) - (parts[1].cents || 0);
    value = money.toDollars(cents);
  } else {
    measure = "ratio";
    const [a, b] = [parts[0].value, parts[1].value];
    value = b > 0 ? Math.round(def.ratio === "change" ? ((a - b) / b) * 100 : (a / b) * 100) : null;
    if (def.blank) blank = await def.blank(orgId, p, deps, parts, dd);
    if (blank) value = null;
    else if (value === null) blank = "There is nothing yet to measure this against, so there is no percentage to show.";
  }
  return {
    key, params: p, measure, formula: def.ratio || null, label: def.label, sentence: def.sentence(p, dd),
    value, cents, blank, blankShort: blankShortOf(blank), rows: [], page: 1, pageSize, totalRows: 0, parts,
  };
}

// The few words a tile has room for; the whole sentence is in the panel.
function blankShortOf(blank) {
  if (!blank) return null;
  const m = /appears on ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(blank);
  return m ? `Appears on ${m[1]}.` : "Not enough history yet.";
}

// The value alone, for a dashboard computing its figures: the same function,
// without fetching a page of rows.
async function figureValue(orgId, source, deps = {}) {
  const f = await figure(orgId, source, deps, { rows: false });
  if (!f) throw new Error(`figureSources: unknown source "${source && source.key}"`);
  return { value: f.value, cents: f.cents, blank: f.blank || null, blankShort: f.blankShort || null };
}

module.exports = { SOURCES, figure, figureValue, sourceDef, FigureParamError, addYears, CONVERSATION_TYPES };
