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

const { query, querySetwise } = require("./db");
const orgTime = require("./orgTime");
const money = require("./money");
const meetings = require("./meetings");   // FIX-14 Part 1 — meetings with a person, defined once
const auctionCore = require("./auctionCore");   // PARITY-2 Part 4: the one winner ordering

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_.:\-]{1,120}$/;
const WORD_RE = /^[A-Za-z0-9_ \-]{1,60}$/;
const PAGE_MAX = 200;

class FigureParamError extends Error {}

let _dd = null;
async function displayDateMod() { return _dd || (_dd = await import("./shared/displayDate.js")); }
// PROFILE-1 — what "open" means for a proposal is defined ONCE, in
// shared/proposalShape.js (OPEN_STAGE_KEYS). This module is CommonJS and that
// one is ESM, so it comes in the same way displayDate does: lazily, memoised.
// A source that wants it declares `sql` as an async builder (plainFigure
// awaits it), which is why nothing here has to copy a stage list.
let _ps = null;
async function proposalShapeMod() { return _ps || (_ps = await import("./shared/proposalShape.js")); }

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
// PARITY-4 Part 2 · the one definition of a started gift that is NOT FINISHED.
// The gift that would close it is any gift from a person with the same email,
// recorded after the start and dated no earlier than the day before it (an
// import of old gifts does not close it); read here every time, never stored.
function giftStartFinishedSql(a) {
  return `(SELECT g.id FROM gifts g JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id
            WHERE g.org_id = ${a}.org_id AND LOWER(gd.email) = LOWER(${a}.email) AND g.created_at >= ${a}.started_at
              AND g.date >= TO_CHAR(${a}.started_at - INTERVAL '1 day', 'YYYY-MM-DD')
            ORDER BY g.created_at LIMIT 1)`;
}
function giftStartOpenSql(a) {
  return `${a}.dismissed_at IS NULL AND (${a}.expired_at IS NOT NULL OR ${a}.started_at < NOW() - INTERVAL '60 minutes')
          AND ${giftStartFinishedSql(a)} IS NULL`;
}
const STATUS_WORD = `CASE s.status WHEN 'active' THEN 'Giving' WHEN 'recovered' THEN 'Giving again after a failed card'
  WHEN 'past_due' THEN 'Card failing' WHEN 'recovering' THEN 'Card being retried' WHEN 'paused' THEN 'Paused'
  WHEN 'canceled' THEN 'Ended' WHEN 'cancelled' THEN 'Ended' ELSE INITCAP(REPLACE(s.status,'_',' ')) END`;
const CONVERSATION_TYPES = ["call", "meeting", "email", "ask", "note", "stewardship"];
// PROFILE-1 — how much conversation history the "last contact" figure opens.
// The figure is ONE number (days since the most recent one); the rows are the
// history behind it, and a record with hundreds of them does not need to send
// them all to answer "when did we last speak".
const CONTACT_ROWS_MAX = 50;

// One gift, as a person's own record reads it: the fund it went to is the line
// ("Unrestricted" when none was named, exactly as the `gifts` source says it),
// and how it was paid is the detail. The amount is the gift's own amount and
// nothing else — a refund is a gift with a negative amount and comes off the
// total here, the same as it does in `gifts`.
const DONOR_GIFT_SELECT = `SELECT g.id, 'gift' AS type, g.donor_id, COALESCE(f.name, 'Unrestricted') AS name, g.date,
              ROUND(g.amount::numeric, 2) AS amount,
              COALESCE(NULLIF(g.payment_method, ''), INITCAP(NULLIF(g.type, ''))) AS detail
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
        WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.donor_id = ?`;

function giftsWhere(p, args) {
  let w = "";
  if (p.fund === "none") w += " AND f.id IS NULL";
  else if (p.fund) { w += " AND f.id = ?"; args.push(p.fund); }
  if (p.restricted !== undefined) { w += " AND COALESCE(f.restricted,false) = ?"; args.push(p.restricted); }
  if (p.campaign) { w += " AND g.campaign_id = ?"; args.push(p.campaign); }
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

// PARITY-2 Part 4: one row per item whose bidding has closed with a winner:
// the winning bid, the winner, and whether they have paid.
function auctionWinsSql(orgId, p) {
  return {
    sql: `WITH top AS (${auctionCore.TOP_BIDS_SQL})
          SELECT i.id, 'auction_item' AS type, bd.donor_id, bd.name, TO_CHAR(top.created_at, 'YYYY-MM-DD') AS date,
                 ROUND(top.amount::numeric, 2) AS amount,
                 i.title || CASE WHEN i.paid_gift_id IS NOT NULL THEN ' · paid' ELSE ' · not paid yet' END AS detail
            FROM auction_items i JOIN auctions a ON a.id = i.auction_id AND a.org_id = i.org_id
            JOIN top ON top.item_id = i.id
            JOIN auction_bidders bd ON bd.id = top.bidder_id AND bd.org_id = i.org_id
           WHERE i.org_id = ? AND i.auction_id = ?
             AND LEAST(a.closes_at, COALESCE(i.closed_at, a.closes_at)) <= NOW()`,
    args: [orgId, p.auction, orgId, p.auction],
    order: "amount DESC, id",
  };
}

const SOURCES = {
  // ── GIFTS ────────────────────────────────────────────────────────────────
  gifts: {
    label: "Gifts",
    measure: p => p.measure || "sum",
    // REPORTS-3 — `order` is the ROW ORDER, not a filter: it changes which
    // gifts a page shows first and never which gifts the number counts, so the
    // sentence below does not mention it. It is mapped through a FIXED
    // allowlist two lines down and is never interpolated into the SQL; a word
    // this source does not know falls back to the default order.
    params: { from: "date:required", to: "date:required", fund: "id", campaign: "id", restricted: "bool", donor: "id", assigned: "id", measure: "measure", order: "word", group: "id" },
    sentence: (p, dd) => `Every gift dated ${dd(p.from)} to ${dd(p.to)}${p.fund === "none" ? " with no fund named" : p.fund ? " to this fund" : ""}${p.campaign ? " in this campaign" : ""}${p.restricted === true ? " to a restricted fund" : p.restricted === false ? " that is unrestricted" : ""}${p.donor ? " from this person" : ""}${p.group ? " from the people in this group" : ""}.`,
    sql: async (orgId, p) => {
      const args = [orgId, p.from, p.to];
      let where = giftsWhere(p, args);
      // PARITY-1 Part D — the board pack's group filter: members only.
      if (p.group) {
        const GR = require("./groups");
        const m = await GR.memberSql(orgId, await GR.groupById(orgId, p.group));
        where += ` AND g.donor_id IN (${m.sql})`; args.push(...m.args);
      }
      return {
        sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                     COALESCE(f.name, 'Unrestricted') AS detail
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
               WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?${where}`,
        args,
        order: p.order === "amount" ? "amount DESC NULLS LAST, id DESC" : undefined,
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

  // ── ONE PERSON'S RECORD (PROFILE-1) ─────────────────────────────────────
  // The four numbers at the top of a person's profile. Each is a source like
  // any other, so the number on the record and the rows in its drawer are the
  // same query and cannot disagree. Every one of them is scoped to the org by
  // its first argument AND to one person by a required `donor`.
  // LIFETIME GIVING — THE TRUE LIFETIME, AND THE GAP GETS A ROW.
  //
  // A person's lifetime is not always the gifts you can list. When a
  // nonprofit's history arrives as an imported AGGREGATE TOTAL, the import
  // writes `donors.total_giving` with NO gift rows behind it (BUILD-57 §2c) —
  // so the column is the real lifetime and the itemized gifts are only the
  // part of it Steward can name. Summing the gifts alone under-reports every
  // donor who came in with history, which is worse than the number this
  // replaced.
  //
  // So the difference is a ROW, at the end, in the oldest position — not a
  // footnote. It used to be a sentence under the tiles that only appeared on
  // the Overview tab; as a row it is IN the drawer, it is part of the total
  // that foots, and somebody who clicks the number to check it sees exactly
  // where the difference comes from instead of being told about it somewhere
  // else on the screen.
  //
  // The other direction is NOT symmetrical. When the itemized gifts come to
  // MORE than the column, the column is the stale one: it is a rollup that
  // `recalcDonorSummary` maintains, while the gift rows are the primary
  // record. A negative row would subtract real, visible money from a person's
  // lifetime on the word of a cache — and would read in the drawer as a
  // refund that nobody made. So no row is emitted and the figure is the
  // itemized sum, which is the number every gift on file can be pointed at.
  "donor-lifetime": {
    label: "Lifetime giving",
    measure: () => "sum",
    params: { donor: "id:required" },
    sentence: () => "Every gift this person has ever given, added up to the cent. A refund is a gift with a negative amount and comes off the total, exactly as it does everywhere else in Steward. Giving that arrived as an imported total, with no individual gifts behind it, is one row of its own at the end.",
    js: async (orgId, p) => {
      const rows = await query(`${DONOR_GIFT_SELECT} ORDER BY g.date DESC NULLS LAST, g.id DESC`, [orgId, p.donor]);
      const [d] = await query(
        `SELECT total_giving, first_gift_date FROM donors WHERE org_id = ? AND id = ? AND deleted_at IS NULL`,
        [orgId, p.donor]);
      if (!d) return rows;
      // Both sides in CENTS, by the one conversion, so the comparison is not
      // decided by binary floating point.
      const itemized = rows.reduce((s, r) => s + (money.toCents(String(r.amount ?? "0")) ?? 0), 0);
      const unitemized = (money.toCents(String(d.total_giving ?? "0")) ?? 0) - itemized;
      if (unitemized <= 0) return rows;
      // The date is the person's first known gift date, and only when it is
      // genuinely older than anything itemized — otherwise this row claims a
      // day it has no evidence for, and no date is the honest answer.
      const oldest = rows.length ? String(rows[rows.length - 1].date || "").slice(0, 10) : null;
      const first = d.first_gift_date ? String(d.first_gift_date).slice(0, 10) : null;
      return [...rows, {
        id: `${p.donor}:imported-total`,
        type: "imported_total",
        donor_id: p.donor,
        name: "Giving before Steward",
        date: first && (!oldest || first < oldest) ? first : null,
        amount: money.toDollars(unitemized),
        detail: "Imported as a total, with no individual gifts behind it",
      }];
    },
  },
  // ENGAGE-1 — EACH PART OF A SCORE OPENS THE ROWS IT COUNTED. The rows come
  // from engagement.js's one row builder, the same call the compute made, so
  // what a part counted and what it shows cannot differ. An engagement part
  // adds up POINTS (a touch's points after it fades with age); a generosity
  // part adds up dollars, or counts years and recurring gifts.
  "donor-engagement-part": {
    label: "Engagement",
    measure: () => "sum",
    amountKind: "points",
    params: { donor: "id:required", part: "word:required" },
    sentence: p => `Every touch counted under this part in the last 24 months, with the points it earned. A touch in the last 90 days counts in full; older ones fade to nothing at 24 months.`,
    js: async (orgId, p) => {
      const [o] = await query(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
      const E = require("./engagement");
      return E.partRows(query, orgId, p.donor, require("./orgTime").orgToday(o || {}), "engagement", p.part);
    },
  },
  "donor-generosity-part": {
    label: "Generosity",
    measure: p => (p.part === "consistency" || p.part === "monthly" ? "count" : "sum"),
    params: { donor: "id:required", part: "word:required" },
    sentence: p => ({
      lifetime: "Every gift this person has given, net of refunds.",
      recent: "Every gift in the last 24 months.",
      consistency: "Each of the last five calendar years in which they gave.",
      monthly: "Each recurring gift running now.",
      upgrade: "Their gifts in the last 12 months, minus their gifts in the 12 months before: the growth this part counts.",
    }[p.part] || "The gifts this part counted."),
    js: async (orgId, p) => {
      const [o] = await query(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
      const E = require("./engagement");
      return E.partRows(query, orgId, p.donor, require("./orgTime").orgToday(o || {}), "generosity", p.part);
    },
  },
  "donor-last-gift": {
    label: "Last gift",
    measure: () => "sum",
    params: { donor: "id:required" },
    sentence: () => "The most recent gift this person gave, on its own: what it was, when it came in, what it went to and how it was paid.",
    sql: (orgId, p) => ({
      sql: `${DONOR_GIFT_SELECT} ORDER BY g.date DESC, g.id DESC LIMIT 1`,
      args: [orgId, p.donor],
    }),
  },
  "donor-open-ask": {
    label: "Open ask",
    measure: () => "sum",
    params: { donor: "id:required" },
    sentence: () => "What this person is being asked for right now: every proposal still in flight — identified, cultivating or asked — at the amount it asks for. A proposal they have said yes or no to is no longer open and is not counted.",
    // Async: what counts as open is OPEN_STAGE_KEYS in shared/proposalShape.js,
    // and the stage's words are that file's labels, so neither is retyped here.
    sql: async (orgId, p) => {
      const P = await proposalShapeMod();
      const label = `CASE o.proposal_stage ${P.PROPOSAL_STAGES.map(s => `WHEN '${s.key}' THEN '${s.label}'`).join(" ")}
                       ELSE INITCAP(REPLACE(COALESCE(o.proposal_stage, ''), '_', ' ')) END`;
      return {
        sql: `SELECT o.id, 'proposal' AS type, o.donor_id, COALESCE(NULLIF(o.name, ''), 'A proposal') AS name,
                     TO_CHAR(o.expected_close, 'YYYY-MM-DD') AS date,
                     ROUND(COALESCE(o.target_amount, 0)::numeric, 2) AS amount, ${label} AS detail
                FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
               WHERE o.org_id = ? AND o.donor_id = ? AND d.deleted_at IS NULL
                 AND o.proposal_stage = ANY(?::text[])`,
        args: [orgId, p.donor, P.OPEN_STAGE_KEYS],
        order: "date ASC NULLS LAST, id",
      };
    },
  },
  // LAST CONTACT — a figure whose value is a NUMBER OF DAYS, not money.
  //
  // Two things have to be true at once: the number is the gap since the most
  // recent conversation, and the drawer shows the conversation history. They
  // are reconciled by putting the whole gap on the FIRST row and nothing on
  // the rest, so the sum over the rows IS the gap — the drill-through still
  // foots, and nobody has to invent a second kind of total.
  //
  // `today` is a REQUIRED PARAMETER, never the machine clock. This module has
  // no way to reach orgTz (it lives in server.js, which requires the route
  // file that requires this one), and a figure must be reproducible from its
  // own URL, so the caller — which does know the organisation's timezone —
  // passes the org's civil today in. Same discipline as every dated source
  // here: the window comes from the caller, computed once, in the org's zone.
  "donor-contact-gap": {
    label: "Last contact",
    measure: () => "sum",
    amountKind: "days",
    params: { donor: "id:required", today: "date:required" },
    sentence: (p, dd) => `Every conversation with this person, most recent first: a meeting (logged, or on a connected calendar and held), a call, an email, an ask or a stewardship touch. A note is not a conversation, whoever wrote it, the Agent included, and a newsletter is not one either. The figure is the whole days from the most recent one to ${dd(p.today)}; only that conversation carries the count, so the rows still add to it.`,
    js: async (orgId, p) => {
      // FIX-24 2b: the one rule (meetings.js conversationsWith).
      const rows = await meetings.conversationsWith(orgId, p.donor, { limit: CONTACT_ROWS_MAX });
      return rows.map((r, i) => {
        const date = String(r.date).slice(0, 10);
        const gap = Math.max(0, orgTime.daysBetween(date, p.today) ?? 0);
        const word = r.kind === "calendar" ? "Meeting, from a calendar" : String(r.type || "");
        return {
          id: r.id, type: r.kind === "calendar" ? "meeting" : "interaction", donor_id: r.donor_id, name: r.note || "", date,
          amount: i === 0 ? gap : null,
          detail: [word ? word.charAt(0).toUpperCase() + word.slice(1) : null,
                   r.who ? `logged by ${r.who}` : null].filter(Boolean).join(" · ") || null,
        };
      });
    },
  },

  // INT-BUILD-1 — LAST MET and LAST EMAIL. Same shape as Last contact: the
  // whole gap rides on the most recent row, so the drawer still foots.
  //
  // A MEETING is a calendar meeting with this person that has started, or a
  // meeting somebody logged by hand. A calendar meeting that was logged
  // afterwards wrote its own meeting interaction, so it is counted once, as
  // that interaction, never twice.
  "donor-last-met": {
    label: "Last met",
    measure: () => "sum",
    amountKind: "days",
    params: { donor: "id:required", today: "date:required" },
    sentence: (p, dd) => `Every meeting with this person: the ones on a connected calendar that have happened, and the ones logged by hand, most recent first. The figure is the whole days from the most recent one to ${dd(p.today)}.`,
    js: async (orgId, p) => {
      // FIX-14 Part 1 — the one source (meetings.js): held meetings only, each
      // dated by its org-local day.
      const rows = await meetings.meetingsWith(orgId, p.donor, { held: true, limit: CONTACT_ROWS_MAX });
      return rows.map((r, i) => {
        const date = String(r.date).slice(0, 10);
        const gap = Math.max(0, orgTime.daysBetween(date, p.today) ?? 0);
        return { id: r.id, type: r.kind === "calendar" ? "meeting" : "interaction", donor_id: r.donor_id,
          name: r.kind === "calendar" ? (r.title || "Meeting") : (r.note || "Meeting"), date, amount: i === 0 ? gap : null,
          detail: [r.kind === "calendar" ? "From a calendar" : "Meeting", r.who ? `with ${r.who}` : null].filter(Boolean).join(" · ") };
      });
    },
  },
  "donor-last-email": {
    label: "Last email",
    measure: () => "sum",
    amountKind: "days",
    params: { donor: "id:required", today: "date:required" },
    sentence: (p, dd) => `Every email with this person on the record, from a connected inbox, the BCC address or logged by hand, most recent first. The figure is the whole days from the most recent one to ${dd(p.today)}.`,
    js: async (orgId, p) => {
      const rows = await query(
        `SELECT i.id, i.donor_id, i.note, i.date, i.logged_by_name, i.metadata->>'direction' AS direction
           FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
          WHERE i.org_id = ? AND i.donor_id = ? AND d.deleted_at IS NULL AND i.type = 'email'
            AND i.date IS NOT NULL AND i.date <> ''
          ORDER BY i.date DESC, i.id DESC LIMIT ?`,
        [orgId, p.donor, CONTACT_ROWS_MAX]);
      return rows.map((r, i) => {
        const date = String(r.date).slice(0, 10);
        const gap = Math.max(0, orgTime.daysBetween(date, p.today) ?? 0);
        return { id: r.id, type: "interaction", donor_id: r.donor_id, name: String(r.note || "").split("\n")[0], date,
          amount: i === 0 ? gap : null,
          detail: [r.direction === "inbound" ? "From them" : r.direction === "outbound" ? "To them" : "Email",
                   r.logged_by_name || null].filter(Boolean).join(" · ") };
      });
    },
  },

  // INT-BUILD-1 — MEETINGS. One definition, used by the profile's year, the
  // connect page, the Reports grid and the morning brief: a meeting with
  // somebody on file is a calendar meeting in the range that was not logged
  // afterwards, or a meeting interaction (which is what a logged calendar
  // meeting becomes). `staff` is whose calendar it was on or who logged it.
  meetings: {
    label: "Meetings",
    measure: () => "count",
    params: { from: "date:required", to: "date:required", staff: "id", donor: "id" },
    sentence: (p, dd) => `Every meeting with someone on file from ${dd(p.from)} to ${dd(p.to)}${p.staff ? ", held by this staff member" : ""}${p.donor ? ", with this person" : ""}: meetings on a connected calendar, and meetings logged by hand. A calendar meeting that was logged afterwards is counted once.`,
    sql: (orgId, p) => {
      // FIX-14 Part 1 — the one source (meetings.js), shaped as figure rows.
      const m = meetings.meetingsSql(orgId, { from: p.from, to: p.to, staff: p.staff || null, donor: p.donor || null });
      return {
        sql: `SELECT m.id, CASE m.kind WHEN 'calendar' THEN 'meeting' ELSE 'interaction' END AS type, m.donor_id,
                     CASE m.kind WHEN 'calendar' THEN m.title
                          ELSE d.name || COALESCE(': ' || NULLIF(LEFT(m.note, 80), ''), '') END AS name,
                     m.date, NULL::numeric AS amount,
                     COALESCE(m.who, 'A colleague') || CASE m.kind WHEN 'calendar' THEN ' · from a calendar' ELSE ' · logged' END AS detail
                FROM (${m.sql}) m LEFT JOIN donors d ON d.id = m.donor_id AND d.org_id = ?`,
        args: [...m.args, orgId], order: "date DESC, id",
      };
    },
  },
  // What a connected inbox put on the record, for the connect page.
  "mailbox-emails": {
    label: "Emails logged from your inbox",
    measure: () => "count",
    params: { staff: "id:required", since: "date:required" },
    sentence: (p, dd) => `Every email with someone on file that this person's connected inbox logged, dated ${dd(p.since)} or later. Nothing else in the inbox is counted or kept.`,
    sql: (orgId, p) => ({
      sql: `SELECT i.id, 'interaction' AS type, i.donor_id, d.name, i.date, NULL::numeric AS amount,
                   COALESCE(i.metadata->>'subject', 'Email') AS detail
              FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
             WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.type = 'email'
               AND i.metadata->>'logged_by' = ? AND i.date >= ?`,
      args: [orgId, p.staff, p.since], order: "date DESC, id",
    }),
  },
  "mailbox-people": {
    label: "People who now have a history",
    measure: () => "count",
    params: { staff: "id:required", since: "date:required" },
    sentence: (p, dd) => `Each person on file with at least one email or meeting from this person's connected inbox or calendar, dated ${dd(p.since)} or later.`,
    sql: (orgId, p) => ({
      sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(x.date) AS date, NULL::numeric AS amount,
                   COUNT(*) || ' logged' AS detail
              FROM (SELECT i.donor_id, i.date FROM interactions i
                     WHERE i.org_id = ? AND i.type = 'email' AND i.metadata->>'logged_by' = ? AND i.date >= ?
                    UNION ALL
                    SELECT unnest(c.person_ids), ${meetings.CAL_DATE} FROM calendar_events c
                     WHERE c.org_id = ? AND c.owner_user_id = ? AND ${meetings.CAL_DATE} >= ?) x
              JOIN donors d ON d.id = x.donor_id AND d.org_id = ? AND d.deleted_at IS NULL
             GROUP BY d.id, d.name`,
      args: [orgId, p.staff, p.since, orgId, p.staff, p.since, orgId], order: "date DESC, id",
    }),
  },
  // ENGAGE-1 §4 — APPEAL-WHY. Every number on "How did it do?" opens these
  // rows, built by appealWhy.js's one gift set per campaign.
  "appeal-why": {
    label: "How did it do?",
    measure: p => (/^donors/.test(p.part) ? "count" : /^avg/.test(p.part) ? "avg" : "sum"),
    params: { campaign: "id:required", compare: "id", part: "word:required" },
    sentence: p => ({
      this: "Every gift attributed to this campaign, refunds subtracted.",
      last: "Every gift attributed to the campaign it is compared with.",
      notYet: "Each person who gave to last year's campaign and has not given to this one yet, with what they gave last time. Largest first.",
      less: "Each person who gave to both and gave less this time: this time minus last time.",
      more: "Each person who gave to both and gave more this time: this time minus last time.",
      newcomers: "Each person whose first gift to the organisation came through this campaign, with what they gave.",
      returning: "Each person who gave to both campaigns, with what they gave this time.",
      donorsThis: "Each person who gave to this campaign, once, with what they gave in all.",
      donorsLast: "Each person who gave to the campaign it is compared with, once, with what they gave in all.",
      avgThis: "Every gift to this campaign; the average is their total divided by how many there are, to the dollar.",
      avgLast: "Every gift to the campaign it is compared with; the average is their total divided by how many there are, to the dollar.",
    }[p.part] || "The rows behind this number."),
    js: async (orgId, p) => {
      const out = await require("./appealWhy").parts(orgId, p.campaign, p.compare || null);
      return (out && Array.isArray(out[p.part])) ? out[p.part] : [];
    },
  },
  // WHY-1 — every reason in an Ask why answer opens the rows it was summed
  // from. why.js builds each reason FROM its rows, so the reason's number and
  // these rows are one computation (a part is a reason's key).
  why: {
    label: "Why",
    measure: p => (["retention", "volunteers", "stopped", "more"].includes(p.q) ? "count" : "sum"),
    params: { q: "word:required", part: "word:required", campaign: "id", donor: "id", user: "id" },
    sentence: p => ({
      appeal: "Each person behind this part of the difference between the two campaigns, with the dollars they moved it by.",
      call: "Each person on tomorrow's list for this reason, with the dollars at stake.",
      retention: "Each of last year's donors in this group who has not given this year, with what they gave last year.",
      stopped: "The records on this donor's file behind this reason.",
      lapse: "Each donor past their own usual gap between gifts, with their usual gift.",
      volunteers: "Each volunteer with hours on file and no gift ever.",
      second: "Each first-time donor from the last 90 days with no second gift and no call logged, with their first gift.",
      more: "Each person whose own file, or a screening file, shows room to give more, with what they gave in the last twelve months.",
    }[p.q] || "The rows behind this reason."),
    js: async (orgId, p, deps) => {
      const a = await require("./why").answer(orgId, p.q, { campaign: p.campaign, donor: p.donor, user: p.user }, deps || {});
      const r = a && (a.reasons || []).find(x => x.key === p.part);
      return r ? r.rows : [];
    },
  },
  // ENGAGE-1 — WARM BUT NOT ASKED THIS YEAR. Engagement 34 or more (Warm or
  // Close, the stored score), and no ask since `since` (1 January): no ask or
  // solicitation logged, and no proposal opened or moved since then.
  "warm-not-asked": {
    label: "Warm but not asked this year",
    measure: () => "count",
    params: { since: "date:required", owner: "id" },
    sentence: (p, dd) => `Everyone whose engagement is Warm or Close (34 or more) and who has not been asked since ${dd(p.since)}: no ask logged and no proposal opened or moved since then. Closest first.`,
    sql: (orgId, p) => {
      const args = [orgId, p.since, p.since, p.since];
      let w = "";
      if (p.owner) { w = " AND d.assigned_to = ?"; args.push(p.owner); }
      return {
        sql: `SELECT d.id, 'donor' AS type, d.id AS donor_id, d.name, s.last_touch AS date, NULL::numeric AS amount,
                     'Engagement ' || s.engagement || ' · ' || initcap(s.band) AS detail, s.engagement AS eng
                FROM donor_scores s JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
               WHERE s.org_id = ? AND d.deleted_at IS NULL AND s.engagement >= 34
                 AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id
                                  AND i.type IN ('ask', 'solicitation') AND LEFT(i.date, 10) >= ?)
                 AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.org_id = d.org_id AND o.donor_id = d.id
                                  AND (o.created_at::date >= ?::date OR o.updated_at::date >= ?::date))${w}`,
        args, order: "eng DESC, name ASC, id",
      };
    },
  },
  // SURVEY-1 — every number on a survey's results opens the responses behind
  // it: all of them, the ones that answered a question, or the ones that gave
  // one answer. A named response carries its person (a link on the screen);
  // an anonymous one is "Anonymous" and carries nobody, because it has nobody.
  "survey-answers": {
    label: "Survey responses",
    measure: () => "count",
    params: { survey: "id:required", question: "word", bucket: "word" },
    sentence: p => p.bucket ? "Each response that gave this answer." : p.question ? "Each response that answered this question." : "Every response to this survey.",
    js: async (orgId, p) => {
      const S = await import("./shared/surveyShape.js");
      const [sv] = await query(`SELECT sections FROM surveys WHERE id = ? AND org_id = ?`, [p.survey, orgId]);
      if (!sv) return [];
      const qs = S.allQuestions({ sections: typeof sv.sections === "string" ? JSON.parse(sv.sections) : sv.sections });
      const q = p.question ? qs.find(x => x.id === p.question) : null;
      if (p.question && !q) return [];
      const rows = await query(
        `SELECT r.id, r.anonymous, r.answers, r.submitted_at, r.donor_id, COALESCE(d.name, r.respondent_name) AS person
           FROM survey_responses r LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
          WHERE r.org_id = ? AND r.survey_id = ? ORDER BY r.submitted_at DESC, r.id`, [orgId, p.survey]);
      const out = [];
      for (const r of rows) {
        const a = (typeof r.answers === "string" ? JSON.parse(r.answers) : r.answers) || {};
        if (q) {
          const v = a[q.id];
          const has = v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
          if (!has) continue;
          if (p.bucket && !S.answerHits(q, v, p.bucket)) continue;
        }
        const ans = q ? (Array.isArray(a[q.id]) ? a[q.id].join(", ") : String(a[q.id])) : null;
        out.push({ id: r.id, type: "survey_response", donor_id: r.anonymous ? null : r.donor_id,
          name: r.anonymous ? "Anonymous" : (r.person || "Not matched to a record"),
          date: new Date(r.submitted_at).toISOString().slice(0, 10), amount: null, detail: ans });
      }
      return out;
    },
  },
  // A person's emails in a range, and how many of them she wrote.
  "donor-emails": {
    label: "Emails",
    measure: () => "count",
    params: { donor: "id:required", from: "date:required", to: "date:required", direction: "word" },
    sentence: (p, dd) => `Every email ${p.direction === "inbound" ? "from this person" : "with this person, either way,"} on the record from ${dd(p.from)} to ${dd(p.to)}.`,
    sql: (orgId, p) => {
      const args = [orgId, p.donor, p.from, p.to];
      let w = "";
      if (p.direction) { w = " AND i.metadata->>'direction' = ?"; args.push(p.direction); }
      return {
        sql: `SELECT i.id, 'interaction' AS type, i.donor_id, COALESCE(i.metadata->>'subject', split_part(i.note, E'\n', 1)) AS name,
                     i.date, NULL::numeric AS amount,
                     CASE i.metadata->>'direction' WHEN 'inbound' THEN 'From them' WHEN 'outbound' THEN 'To them' ELSE 'Email' END AS detail
                FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
               WHERE i.org_id = ? AND i.donor_id = ? AND d.deleted_at IS NULL AND i.type = 'email'
                 AND i.date >= ? AND i.date <= ?${w}`,
        args, order: "date DESC, id",
      };
    },
  },
  "donor-gifts-between": {
    label: "Given",
    measure: () => "sum",
    params: { donor: "id:required", from: "date:required", to: "date:required" },
    sentence: (p, dd) => `Every gift this person gave from ${dd(p.from)} to ${dd(p.to)}, added up to the cent. A refund comes off the total.`,
    sql: (orgId, p) => ({
      sql: `${DONOR_GIFT_SELECT} AND g.date >= ? AND g.date <= ?`,
      args: [orgId, p.donor, p.from, p.to], order: "date DESC, id",
    }),
  },
  // PARITY-1 Part 1b · AT A GLANCE. Each figure in the profile's glance block
  // is one of these, so each opens the gift (or gifts) it is.
  "donor-first-gift": {
    label: "First gift",
    measure: () => "sum",
    params: { donor: "id:required" },
    sentence: () => "The first gift this person ever gave, on its own: what it was, when it came in and what it went to.",
    sql: (orgId, p) => ({
      sql: `${DONOR_GIFT_SELECT} AND g.amount > 0 ORDER BY g.date ASC, g.id ASC LIMIT 1`,
      args: [orgId, p.donor],
    }),
  },
  "donor-largest-gift": {
    label: "Largest gift",
    measure: () => "sum",
    params: { donor: "id:required" },
    sentence: () => "The largest single gift this person has given. When two gifts are the same size, the more recent one.",
    sql: (orgId, p) => ({
      sql: `${DONOR_GIFT_SELECT} AND g.amount > 0 ORDER BY g.amount DESC, g.date DESC, g.id DESC LIMIT 1`,
      args: [orgId, p.donor],
    }),
  },
  "donor-average-gift": {
    label: "Average gift",
    measure: () => "mean",
    params: { donor: "id:required" },
    sentence: () => "Every gift this person has given, added up and divided by how many there are, to the cent. A refund is not a gift and is left out.",
    sql: (orgId, p) => ({
      sql: `${DONOR_GIFT_SELECT} AND g.amount > 0`,
      args: [orgId, p.donor], order: "date DESC, id",
    }),
  },
  // PARITY-1 Part 1a · EACH TAG OPENS ITS DONORS. The tag's rule is
  // donorStatus.js statusSql, the same one the profile and the lists use; the
  // amount on each row is what they gave in the last 12 months.
  "donors-by-status": {
    label: "Donors with this tag",
    // PARITY-1 Part C · the giving-level chart asks the same rows for their
    // sum (what the level gave in the last 12 months) as well as their count,
    // and narrows a level to the people who gave in those 12 months (gave12),
    // so a lapsed donor is not counted as General.
    measure: p => p.measure || "count",
    params: { tag: "word:required", today: "date:required", measure: "measure", gave12: "bool" },
    sentence: p => {
      const DS = require("./donorStatus");
      return `Everyone tagged ${DS.tagLabel(p.tag)}${p.gave12 ? " who gave in the last 12 months" : ""}. ${DS.tagSentence(p.tag, DS.DEFAULT_CUTS).replace(/^Giving level is what they gave.*?: /, "Giving level is what they gave in the last 12 months, against your cut points. ")} The amount is what each gave in the last 12 months, refunds taken off.`;
    },
    sql: async (orgId, p) => {
      const DS = require("./donorStatus");
      if (!DS.TAG_KEYS.includes(p.tag)) throw new FigureParamError("tag is not a tag Steward knows.");
      const cuts = await DS.cutsFor(orgId);
      const st = DS.statusSql(orgId, p.today, cuts);
      const col = DS.LEVELS[p.tag] ? "s.level = ?" : DS.LIFECYCLES[p.tag] ? "s.lifecycle = ?" : "s.retained";
      return {
        sql: `SELECT d.id, 'donor' AS type, d.id AS donor_id, d.name, s.last_date AS date, s.last12 AS amount,
                     'Given in the last 12 months' AS detail
                FROM (${st.sql}) s JOIN donors d ON d.id = s.donor_id AND d.org_id = ?
               WHERE ${col}${p.gave12 ? " AND s.lifecycle <> 'lapsed'" : ""}`,
        args: [...st.args, orgId, ...(col.endsWith("?") ? [p.tag] : [])],
        order: "amount DESC NULLS LAST, id",
      };
    },
  },
  // PARITY-1 Part C · ONE GIFT, as the Home panel's amount opens it.
  // PARITY-2 Part 5 · QUICKBOOKS PENDING. The rule is qboSync.js
  // pendingWhere, the one the Pending list itself is drawn from, so the total
  // above the list and the rows behind it are one filter.
  "qbo-pending": {
    label: "Waiting to go to QuickBooks",
    measure: () => "sum",
    params: { since: "date:required" },
    sentence: (p, dd) => `Every gift dated on or after ${dd(p.since)} that has not been sent to QuickBooks or skipped. Real money only: never a sample, a refund, stock or in-kind.`,
    sql: (orgId, p) => {
      const w = require("./qboSync").pendingWhere(orgId, p.since);
      return {
        sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                     COALESCE(f.name, 'Unrestricted') AS detail
                FROM ${w.from} WHERE ${w.where}`,
        args: w.args,
      };
    },
  },
  "one-gift": {
    label: "The gift",
    measure: () => "sum",
    params: { id: "id:required" },
    sentence: () => "This one gift, at its own amount, with the fund it went to.",
    sql: (orgId, p) => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                   COALESCE(f.name, 'Unrestricted') AS detail
              FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
              LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
             WHERE g.org_id = ? AND g.id = ?`,
      args: [orgId, p.id],
    }),
  },
  // PARITY-1 Part C · HOME'S CALLS TO MAKE. The rule is callsToMake.js
  // callsSql, the one the panel lists from. `floor` is the org's call floor in
  // cents, carried so the sentence can say it; the panel passes the org's own.
  "calls-to-make": {
    label: "Calls to make",
    measure: () => "count",
    params: { today: "date:required", floor: "word:required" },
    sentence: p => require("./callsToMake").sentence(Number(p.floor)),
    sql: (orgId, p) => {
      if (!/^\d{1,9}$/.test(p.floor)) throw new FigureParamError("floor must be a whole number of cents.");
      return require("./callsToMake").callsSql(orgId, p.today, Number(p.floor));
    },
  },
  // PARITY-1 Part C · RETENTION OVER ANY TWO WINDOWS. Of the people who gave
  // in the earlier window (from1 to to1), the share who gave again in the
  // later one (from0 to to0). The Fundraising dashboard asks it for the fiscal
  // year and for rolling 12 months; the calendar year stays `retention`.
  // "Gave" is a gift above zero, so a refund never counts as giving.
  "retention-window-prior": {
    label: "Gave in the earlier window",
    measure: () => "count",
    params: { from1: "date:required", to1: "date:required" },
    sentence: (p, dd) => `Everyone with a gift dated ${dd(p.from1)} to ${dd(p.to1)}: the people retention is measured against.`,
    sql: (orgId, p) => ({
      sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(LEFT(g.date,10)) AS date, ROUND(SUM(g.amount)::numeric, 2) AS amount,
                   'Given in the earlier window' AS detail
              FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.amount > 0 AND LEFT(g.date,10) >= ? AND LEFT(g.date,10) <= ?
             GROUP BY d.id, d.name`,
      args: [orgId, p.from1, p.to1],
      order: "amount DESC, id",
    }),
  },
  "retention-window-kept": {
    label: "Gave in both windows",
    measure: () => "count",
    params: { from1: "date:required", to1: "date:required", from0: "date:required", to0: "date:required" },
    sentence: (p, dd) => `Everyone with a gift dated ${dd(p.from1)} to ${dd(p.to1)} who gave again ${dd(p.from0)} to ${dd(p.to0)}. The amount is what they gave in the later window.`,
    sql: (orgId, p) => ({
      sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(LEFT(g.date,10)) AS date, ROUND(SUM(g.amount)::numeric, 2) AS amount,
                   'Given in the later window' AS detail
              FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.amount > 0 AND LEFT(g.date,10) >= ? AND LEFT(g.date,10) <= ?
               AND EXISTS (SELECT 1 FROM gifts g1 WHERE g1.org_id = g.org_id AND g1.donor_id = g.donor_id AND g1.amount > 0
                             AND LEFT(g1.date,10) >= ? AND LEFT(g1.date,10) <= ?)
             GROUP BY d.id, d.name`,
      args: [orgId, p.from0, p.to0, p.from1, p.to1],
      order: "amount DESC, id",
    }),
  },
  // PARITY-1 Part D · A GROUP'S NUMBERS. The members are groups.js memberSql
  // (the live rule, or the hand-kept list), the same set the group's page
  // lists, so every number on it opens rows that foot to it.
  "group-members": {
    label: "People in this group",
    measure: () => "count",
    params: { group: "id:required" },
    sentence: () => "Everyone in this group right now. For a group by rule, that is everyone the rule finds today. The amount on each row is what they have given in total.",
    sql: async (orgId, p) => {
      const GR = require("./groups");
      const m = await GR.memberSql(orgId, await GR.groupById(orgId, p.group));
      return {
        sql: `SELECT d.id, 'donor' AS type, d.id AS donor_id, d.name, d.last_gift_date AS date,
                     ROUND(COALESCE(d.total_giving, 0)::numeric, 2) AS amount, 'Given in total' AS detail
                FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.id IN (${m.sql})`,
        args: [orgId, ...m.args],
        order: "name ASC, id",
      };
    },
  },
  // PARITY-3 Part 5 — the people in a group who have never given a gift: on
  // the Volunteers group, the volunteers to think about asking. Each row is a
  // person, with the volunteer hours they have given as its amount.
  "group-never-gave": {
    label: "Never given",
    measure: () => "count",
    amountKind: "hours",
    params: { group: "id:required" },
    sentence: () => "The people in this group with no gift on their record, refunds aside. The amount on each row is the volunteer hours they have given.",
    sql: async (orgId, p) => {
      const GR = require("./groups");
      const m = await GR.memberSql(orgId, await GR.groupById(orgId, p.group));
      return {
        sql: `SELECT d.id, 'donor' AS type, d.id AS donor_id, d.name,
                     (SELECT MAX(v.date) FROM volunteer_shifts v WHERE v.org_id = d.org_id AND v.person_id = d.id) AS date,
                     ROUND((SELECT COALESCE(SUM(v.hours), 0) FROM volunteer_shifts v WHERE v.org_id = d.org_id AND v.person_id = d.id)::numeric, 2) AS amount,
                     'Volunteer hours' AS detail
                FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.id IN (${m.sql})
                 AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0)`,
        args: [orgId, ...m.args],
        order: "amount DESC NULLS LAST, name ASC, id",
      };
    },
  },
  // `kind` is total (every gift, a refund taken off), count (how many gifts,
  // refunds are not gifts) or average (those gifts, added up and divided by
  // how many there are, to the cent). With no dates it is all time.
  "group-gifts": {
    label: "Gifts from this group",
    measure: p => (p.kind === "count" ? "count" : p.kind === "average" ? "mean" : "sum"),
    params: { group: "id:required", from: "date", to: "date", kind: "word" },
    sentence: (p, dd) => {
      const when = p.from && p.to ? ` dated ${dd(p.from)} to ${dd(p.to)}` : p.from ? ` dated ${dd(p.from)} or later` : p.to ? ` dated up to ${dd(p.to)}` : ", ever";
      if (p.kind === "count") return `How many gifts the people in this group have given${when}. A refund is not a gift and is not counted.`;
      if (p.kind === "average") return `Every gift the people in this group have given${when}, added up and divided by how many there are, to the cent. A refund is left out.`;
      return `Every gift the people in this group have given${when}, added up to the cent, with refunds taken off.`;
    },
    sql: async (orgId, p) => {
      if (p.kind && !["total", "count", "average"].includes(p.kind)) throw new FigureParamError("kind is total, count or average.");
      const GR = require("./groups");
      const m = await GR.memberSql(orgId, await GR.groupById(orgId, p.group));
      const args = [orgId, ...m.args];
      let w = "";
      if (p.from) { w += " AND LEFT(g.date,10) >= ?"; args.push(p.from); }
      if (p.to) { w += " AND LEFT(g.date,10) <= ?"; args.push(p.to); }
      if (p.kind === "count" || p.kind === "average") w += " AND g.amount > 0";
      return {
        sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                     COALESCE(f.name, 'Unrestricted') AS detail
                FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
               WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.donor_id IN (${m.sql})${w}`,
        args,
      };
    },
  },
  // PARITY-1 Part 1e · two of the closeness facts that had no source.
  "donor-membership": {
    label: "Membership",
    measure: () => "count",
    params: { donor: "id:required" },
    sentence: () => "This person's current membership: the level, the day they joined and when it runs to. A member in their grace period still counts.",
    sql: (orgId, p) => ({
      sql: `SELECT m.id, 'membership' AS type, m.donor_id, l.name, m.joined_on AS date, l.price AS amount,
                   CASE WHEN m.expires_on IS NULL THEN 'No end date' ELSE 'Runs to ' || m.expires_on END AS detail
              FROM memberships m JOIN membership_levels l ON l.id = m.level_id AND l.org_id = m.org_id
             WHERE m.org_id = ? AND m.donor_id = ? AND m.status IN ('active','grace')`,
      args: [orgId, p.donor],
    }),
  },
  "donor-fundraising": {
    label: "Raised as a fundraiser",
    measure: () => "sum",
    params: { donor: "id:required" },
    sentence: () => "Every gift given through a peer-to-peer page this person runs, added up to the cent.",
    sql: (orgId, p) => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, COALESCE(gd.name, 'A supporter') AS name, g.date,
                   ROUND(g.amount::numeric, 2) AS amount, 'Peer-to-peer page: ' || pf.name AS detail
              FROM gifts g JOIN peer_fundraisers pf ON pf.id = g.peer_fundraiser_id AND pf.org_id = g.org_id
              LEFT JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id
             WHERE g.org_id = ? AND pf.person_id = ?`,
      args: [orgId, p.donor], order: "date DESC, id",
    }),
  },
  // PARITY-2 Part 2: one peer-to-peer page's gifts: the P2P screen's Raised
  // column for a fundraiser, the same set GET /peer-fundraisers/:id/gifts
  // lists (amount > 0, through this page).
  "fundraiser-gifts": {
    label: "Raised through this page",
    measure: () => "sum",
    params: { fundraiser: "id:required" },
    sentence: () => "Every gift given through this fundraiser's own page, added up to the cent. Hard credit stays with each donor.",
    sql: (orgId, p) => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, COALESCE(gd.name, 'A supporter') AS name, g.date,
                   ROUND(g.amount::numeric, 2) AS amount, 'Peer-to-peer page: ' || pf.name AS detail
              FROM gifts g JOIN peer_fundraisers pf ON pf.id = g.peer_fundraiser_id AND pf.org_id = g.org_id
              LEFT JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id
             WHERE g.org_id = ? AND pf.id = ? AND g.amount > 0`,
      args: [orgId, p.fundraiser], order: "date DESC, id",
    }),
  },
  // MOVES MANAGEMENT — who has not been met. Owner and amount aware.
  "no-recent-meeting": {
    label: "No meeting since",
    measure: () => "count",
    params: { since: "date:required", owner: "id", min: "word" },
    sentence: (p, dd) => `Every person on file${p.min ? ` who has given at least $${Number(p.min).toLocaleString("en-US")} in all` : ""}${p.owner ? ", owned by this staff member," : ""} with no meeting since ${dd(p.since)}, on a calendar or logged by hand. The amount is their lifetime giving.`,
    sql: (orgId, p) => {
      const args = [orgId];
      let w = "";
      if (p.owner) { w += " AND d.assigned_to = ?"; args.push(p.owner); }
      if (p.min && /^\d+$/.test(p.min)) { w += " AND COALESCE(d.total_giving,0) >= ?"; args.push(Number(p.min)); }
      // FIX-14 Part 1 — "met" is the one source (meetings.js), held meetings
      // only: a logged meeting dated ahead has not happened yet.
      const all = meetings.meetingsSql(orgId, { held: true, eachPerson: true });
      const since = meetings.meetingsSql(orgId, { held: true, from: p.since, eachPerson: true });
      args.push(...since.args);
      return {
        sql: `WITH met AS (SELECT m.donor_id, MAX(m.date) AS last_met FROM (${all.sql}) m GROUP BY m.donor_id)
              SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, met.last_met AS date,
                     ROUND(COALESCE(d.total_giving,0)::numeric, 2) AS amount,
                     COALESCE(d.assigned_to_name, 'No owner') AS detail
                FROM donors d LEFT JOIN met ON met.donor_id = d.id
               WHERE d.org_id = ? AND d.deleted_at IS NULL AND COALESCE(d.is_sample,false) = false${w}
                 AND NOT EXISTS (SELECT 1 FROM (${since.sql}) s WHERE s.donor_id = d.id)`,
        args: [...all.args, ...args], order: "amount DESC, id",
      };
    },
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
  // PARITY-4 Part 1 · CARDS THE BANK UPDATED. Stripe's card updater replaces a
  // reissued or expired card at the network and says so with
  // payment_method.automatically_updated (routes/webhooks.js logs each one as a
  // card_auto_updated recovery event). One row per monthly gift still giving
  // whose card was updated on or after `since`, at what it brings in a month:
  // the count is the rows, the money is their sum, from this one filter.
  "cards-auto-updated": {
    label: "Cards updated automatically",
    measure: p => p.measure || "sum",
    params: { since: "date:required", measure: "measure" },
    sentence: (p, dd) => `Monthly gifts still giving whose card the bank updated by itself on or after ${dd(p.since)}, at what each brings in a month. A yearly gift counts as a twelfth of its amount.`,
    sql: (orgId, p) => ({
      sql: `SELECT s.id, 'subscription' AS type, s.donor_id, d.name, TO_CHAR(u.at, 'YYYY-MM-DD') AS date,
                   ${MONTHLY} AS amount,
                   'Card updated by the bank' || COALESCE(', ends ' || u.last4, '') || COALESCE(', exp ' || u.exp, '') AS detail
              FROM recurring_subscriptions s
              JOIN (SELECT pre.subscription_id, MAX(pre.created_at) AS at,
                           (ARRAY_AGG(pre.detail->>'last4' ORDER BY pre.created_at DESC))[1] AS last4,
                           (ARRAY_AGG(pre.detail->>'exp' ORDER BY pre.created_at DESC))[1] AS exp
                      FROM payment_recovery_events pre
                     WHERE pre.org_id = ? AND pre.type = 'card_auto_updated' AND pre.created_at >= ?::date
                     GROUP BY pre.subscription_id) u ON u.subscription_id = s.stripe_subscription_id
              LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
             WHERE s.org_id = ? AND s.status IN ('active','recovered')`,
      args: [orgId, p.since, orgId],
      order: "amount DESC, id",
    }),
  },
  // PARITY-4 Part 2 · GIFTS STARTED AND NOT FINISHED on Steward's own forms,
  // started between `from` and `to`. The one definition of "not finished"
  // (giftStartOpenSql below) is shared with the list on Fundraising.
  "gifts-not-finished": {
    label: "Started and not finished",
    measure: p => p.measure || "sum",
    params: { from: "date:required", to: "date:required", measure: "measure" },
    sentence: (p, dd) => `Gifts somebody started on one of your own giving forms between ${dd(p.from)} and ${dd(p.to)}, gave an email for, and did not finish: no gift from that email since, and an hour gone or the payment page closed. At the amount they chose.`,
    sql: (orgId, p) => ({
      sql: `SELECT s.id, 'gift_start' AS type, dd.id AS donor_id,
                   COALESCE(NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), s.email) AS name,
                   TO_CHAR(s.started_at, 'YYYY-MM-DD') AS date, COALESCE(s.amount, 0) AS amount,
                   COALESCE(s.form_name, 'Giving page') || ' · ' || s.email AS detail
              FROM gift_starts s
              LEFT JOIN LATERAL (SELECT d.id FROM donors d WHERE d.org_id = s.org_id AND LOWER(d.email) = LOWER(s.email) AND d.deleted_at IS NULL ORDER BY d.created_at LIMIT 1) dd ON TRUE
             WHERE s.org_id = ? AND s.started_at >= ?::date AND s.started_at < (?::date + 1) AND ${giftStartOpenSql("s")}`,
      args: [orgId, p.from, p.to],
      order: "date DESC, id",
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
  // ── PARITY-2 Part 4: AN AUCTION ──────────────────────────────────────
  // The winner of an item is auctionCore's one ordering (highest bid, then the
  // earliest), and an item is closed by the database clock, so these rows and
  // the auction screen cannot disagree about who won or what is still open.
  "auction-raised": {
    label: "Raised",
    measure: () => "sum",
    params: { auction: "id:required" },
    sentence: () => "Every payment a winner has made for an item in this auction, at the amount charged: the gift their payment recorded.",
    sql: (orgId, p) => ({
      sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, i.title AS detail
              FROM auction_items i JOIN gifts g ON g.id = i.paid_gift_id AND g.org_id = i.org_id
              LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE i.org_id = ? AND i.auction_id = ?`,
      args: [orgId, p.auction],
    }),
  },
  "auction-committed": {
    label: "Won, paid or not",
    measure: () => "sum",
    params: { auction: "id:required" },
    sentence: () => "The winning bid on every item whose bidding has closed, whether the winner has paid yet or not.",
    sql: (orgId, p) => auctionWinsSql(orgId, p),
  },
  "auction-sold": {
    label: "Items sold",
    measure: () => "count",
    params: { auction: "id:required" },
    sentence: () => "Every item whose bidding has closed with a winning bid, with that bid.",
    sql: (orgId, p) => auctionWinsSql(orgId, p),
  },
  "auction-unsold": {
    label: "Items unsold",
    measure: () => "count",
    params: { auction: "id:required" },
    sentence: () => "Every item whose bidding has closed with no bid at all. An item still open is neither sold nor unsold.",
    sql: (orgId, p) => ({
      sql: `SELECT i.id, 'auction_item' AS type, i.donor_id, i.title AS name, TO_CHAR(LEAST(a.closes_at, COALESCE(i.closed_at, a.closes_at)), 'YYYY-MM-DD') AS date,
                   NULL::numeric AS amount, COALESCE(i.category, 'No category') AS detail
              FROM auction_items i JOIN auctions a ON a.id = i.auction_id AND a.org_id = i.org_id
             WHERE i.org_id = ? AND i.auction_id = ?
               AND LEAST(a.closes_at, COALESCE(i.closed_at, a.closes_at)) <= NOW()
               AND NOT EXISTS (SELECT 1 FROM auction_bids b WHERE b.item_id = i.id AND b.org_id = i.org_id)`,
      args: [orgId, p.auction],
    }),
  },
  "auction-bidders": {
    label: "Bidders",
    measure: () => "count",
    params: { auction: "id:required" },
    sentence: () => "Every registered bidder who placed at least one bid, largest total of winning bids first. Each one's amount is what they won on closed items.",
    sql: (orgId, p) => ({
      sql: `WITH top AS (${auctionCore.TOP_BIDS_SQL}),
                 won AS (SELECT top.bidder_id, SUM(top.amount) AS amt, COUNT(*) AS n
                           FROM top JOIN auction_items i ON i.id = top.item_id AND i.org_id = ?
                           JOIN auctions a ON a.id = i.auction_id AND a.org_id = i.org_id
                          WHERE LEAST(a.closes_at, COALESCE(i.closed_at, a.closes_at)) <= NOW()
                          GROUP BY top.bidder_id)
            SELECT bd.id, 'bidder' AS type, bd.donor_id, bd.name, TO_CHAR(MAX(b.created_at), 'YYYY-MM-DD') AS date,
                   ROUND(COALESCE(MAX(won.amt), 0)::numeric, 2) AS amount,
                   'Bidder #' || bd.bidder_number || ' · ' || COUNT(b.id) || CASE WHEN COUNT(b.id) = 1 THEN ' bid' ELSE ' bids' END
                     || ' · won ' || COALESCE(MAX(won.n), 0) AS detail
              FROM auction_bidders bd JOIN auction_bids b ON b.bidder_id = bd.id AND b.org_id = bd.org_id
              LEFT JOIN won ON won.bidder_id = bd.id
             WHERE bd.org_id = ? AND bd.auction_id = ?
             GROUP BY bd.id, bd.donor_id, bd.name, bd.bidder_number`,
      args: [orgId, p.auction, orgId, orgId, p.auction],
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
  // ── VOLUNTEERS (REPORTS-3) ───────────────────────────────────────────────
  // A board pack asks for volunteer hours, and until now no figure counted
  // them: the only place hours existed was a column on the report builder's
  // people entity, which cannot be opened and cannot be footed. These two are
  // sources like any other, so the hours in the pack open onto the shifts
  // that make them.
  "volunteer-hours": {
    label: "Volunteer hours",
    measure: () => "sum",
    amountKind: "hours",
    // PARITY-3 — and for one opportunity, and each row says which opportunity
    // the hours went to. The profile's totals, its glance line and the
    // Volunteers screen's hour columns all open this one source.
    params: { from: "date:required", to: "date:required", donor: "id", opportunity: "id" },
    sentence: (p, dd) => `Every volunteer shift dated ${dd(p.from)} to ${dd(p.to)}${p.donor ? " by this person" : ""}${p.opportunity ? " for this opportunity" : ""}, with the hours recorded on it.`,
    sql: (orgId, p) => ({
      sql: `SELECT v.id, 'shift' AS type, v.person_id AS donor_id, d.name, v.date,
                   ROUND(v.hours::numeric, 2) AS amount, COALESCE(o.name, NULLIF(v.role, '')) AS detail
              FROM volunteer_shifts v JOIN donors d ON d.id = v.person_id AND d.org_id = v.org_id
              LEFT JOIN volunteer_opportunities o ON o.id = v.opportunity_id AND o.org_id = v.org_id
             WHERE v.org_id = ? AND d.deleted_at IS NULL AND v.date >= ? AND v.date <= ?${p.donor ? " AND v.person_id = ?" : ""}${p.opportunity ? " AND v.opportunity_id = ?" : ""}`,
      args: [orgId, p.from, p.to, ...(p.donor ? [p.donor] : []), ...(p.opportunity ? [p.opportunity] : [])],
      order: "date DESC NULLS LAST, id DESC",
    }),
  },
  "volunteers-served": {
    label: "People who volunteered",
    measure: () => "count",
    params: { from: "date:required", to: "date:required" },
    sentence: (p, dd) => `Each person with at least one volunteer shift dated ${dd(p.from)} to ${dd(p.to)}, with the hours they gave in that time.`,
    sql: (orgId, p) => ({
      sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(v.date) AS date,
                   ROUND(SUM(v.hours)::numeric, 2) AS amount,
                   COUNT(*) || CASE WHEN COUNT(*) = 1 THEN ' shift' ELSE ' shifts' END AS detail
              FROM volunteer_shifts v JOIN donors d ON d.id = v.person_id AND d.org_id = v.org_id
             WHERE v.org_id = ? AND d.deleted_at IS NULL AND v.date >= ? AND v.date <= ?
             GROUP BY d.id, d.name`,
      args: [orgId, p.from, p.to],
      order: "amount DESC NULLS LAST, id",
    }),
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
  "retention-window": {
    label: "Retention",
    ratio: "share",
    params: { from1: "date:required", to1: "date:required", from0: "date:required", to0: "date:required" },
    sentence: (p, dd) => `Of the people who gave ${dd(p.from1)} to ${dd(p.to1)}, the share who gave again ${dd(p.from0)} to ${dd(p.to0)}.`,
    parts: p => [
      { role: "numerator", label: "Gave again", key: "retention-window-kept", params: p },
      { role: "denominator", label: "Gave in the earlier window", key: "retention-window-prior", params: { from1: p.from1, to1: p.to1 } },
    ],
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
  // PARITY-1 — an average of MONEY, to the cent: the rows' own sum in cents
  // divided by their count, so the drawer's total over its count is the figure.
  if (measure === "mean") {
    const c = money.toCents(String(agg.s ?? "0")) ?? 0;
    const m = agg.n > 0 ? Math.round(c / Number(agg.n)) : 0;
    return { value: money.toDollars(m), cents: m };
  }
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
    // `sql` may be an async builder: a source whose SQL needs something only
    // an ESM module knows (the open proposal stages) awaits it here. Awaiting
    // a plain object is a no-op, so every existing source is untouched.
    const { sql, args, order } = await def.sql(orgId, p);
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
  // `totalRows` comes back too: a caller that must tell "nothing there" from
  // "there and it is zero" (a record with no gifts at all, against one whose
  // gift and its refund cancel) needs the count, and the count is already in
  // hand — asking for it separately would be a second computation.
  return { value: f.value, cents: f.cents, blank: f.blank || null, blankShort: f.blankShort || null, totalRows: f.totalRows || 0 };
}

// FIX-21 · A GROUP'S PAGE IN ONE READ. The group page shows five figures and
// twelve months, every one of them a group-members, group-never-gave or
// group-gifts source. Asked one at a time that was 22 aggregates, each
// re-reading the group and re-running its rule: 50 to 100 round trips to the
// database and about six seconds on prod. This is the same arithmetic, over
// the same rows, in one statement: the members are worked out once, their
// gifts are read once, and each source is a FILTER over those rows with the
// conditions its own `sql` builder writes. `m` is groups.js memberSql for the
// group, resolved by the caller. The values come back in the shape
// figureValue returns, and the drawer (figure(), unchanged) still opens rows
// that foot to each one: tests/parity1-groups-journeys.test.js checks every
// figure on the page against its drawer.
const GROUP_KINDS = ["total", "count", "average"];
async function groupFigureValues(orgId, m, sources) {
  const scalars = [], scalarArgs = [], aggs = [], aggArgs = [];
  const plan = sources.map((s, i) => {
    const key = String(s && s.key || "");
    const def = sourceDef(key);
    if (!def || !/^group-/.test(key)) throw new Error(`figureSources: "${key}" is not a group source`);
    const p = readParams(def, s.params || {});
    if (key === "group-members") {
      scalars.push(`(SELECT COUNT(*)::int FROM mem) AS n${i}`);
    } else if (key === "group-never-gave") {
      scalars.push(`(SELECT COUNT(*)::int FROM mem WHERE NOT EXISTS
                      (SELECT 1 FROM gifts ng WHERE ng.org_id = ? AND ng.donor_id = mem.id AND ng.amount > 0)) AS n${i}`);
      scalarArgs.push(orgId);
    } else {
      if (p.kind && !GROUP_KINDS.includes(p.kind)) throw new FigureParamError("kind is total, count or average.");
      const c = ["true"], own = [];
      if (p.from) { c.push("day >= ?"); own.push(p.from); }
      if (p.to) { c.push("day <= ?"); own.push(p.to); }
      if (p.kind === "count" || p.kind === "average") c.push("raw > 0");
      const w = c.join(" AND ");
      // The condition is written twice, once for the count and once for the sum.
      aggs.push(`COUNT(*) FILTER (WHERE ${w})::int AS n${i}, COALESCE(SUM(amount) FILTER (WHERE ${w}), 0)::text AS s${i}`);
      aggArgs.push(...own, ...own);
    }
    return { def, p };
  });
  const sql = `
    WITH m AS MATERIALIZED (${m.sql}),
         mem AS MATERIALIZED (SELECT d.id FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.id IN (SELECT id FROM m)),
         gx AS MATERIALIZED (SELECT LEFT(g.date,10) AS day, g.amount AS raw, ROUND(g.amount::numeric, 2) AS amount
                               FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                              WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.donor_id IN (SELECT id FROM m))
    SELECT ${[...scalars, "a.*"].join(", ")}
      FROM (SELECT ${aggs.length ? aggs.join(", ") : "1 AS none"} FROM gx) a`;
  const [row] = await querySetwise(sql, [...m.args, orgId, orgId, ...scalarArgs, ...aggArgs]);
  return plan.map(({ def, p }, i) => {
    const agg = { n: row[`n${i}`], s: row[`s${i}`] ?? "0" };
    const { value, cents } = valueOf(def.measure(p), agg);
    return { value, cents, blank: null, blankShort: null, totalRows: Number(agg.n) || 0 };
  });
}

// A source's defining sentence, without computing it.
async function figureSentence(source) {
  const def = sourceDef(String(source && source.key || ""));
  if (!def) return null;
  const DD = await displayDateMod();
  return def.sentence(readParams(def, source.params || {}), d => DD.displayDate(d));
}

module.exports = { SOURCES, figure, figureValue, groupFigureValues, figureSentence, sourceDef, FigureParamError, addYears, CONVERSATION_TYPES, giftStartOpenSql, giftStartFinishedSql };
