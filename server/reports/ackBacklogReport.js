// server/reports/ackBacklogReport.js · POLISH-14 item 6. THE ACKNOWLEDGMENT BACKLOG, AT REAL SIZE.
//
// Duet (27 Nov): the report put every unthanked gift back to Jan 8, 2021 on one
// page (about 887k characters), with no count, total, paging or date filter,
// while Home said "131 gifts … since October 7, 2026". It was a builder filter
// (Thanked = No, any date). Now it is the one backlog rule (shared/numbers/
// thankBacklog.js WAITING) over a date range that opens on Home's own window
// (reportHooks.thanksSince, the function Home reads), with its count and total
// first, each a figure that opens its rows (the `unthanked` source), and the
// gifts in pages of 50, oldest first. A wider range is hers to pick. CSV and
// PDF carry the whole range.
"use strict";
const { query } = require("../../db");
const TB = require("../../shared/numbers/thankBacklog");

const PAGE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cents = v => Math.round(Number(v || 0) * 100);

async function ackBacklogReport(orgId, opts = {}) {
  const crm = require("../../routes/crm");
  const DS = require("../../donorStatus");
  const figureSources = require("../../figureSources");
  const DD = await import("../../shared/displayDate.js");
  const [since, today] = await Promise.all([crm.reportHooks.thanksSince(orgId), DS.todayFor(orgId)]);
  let from = DAY.test(String(opts.from || "")) ? opts.from : since;
  let to = DAY.test(String(opts.to || "")) ? opts.to : today;
  if (from > to) [from, to] = [to, from];
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const where = `g.org_id = ? AND ${TB.WAITING("g", "d")} AND g.date <= ?`;
  const args = [orgId, from, to];
  const countSrc = { key: "unthanked", params: { since: from, to } };
  const sumSrc = { key: "unthanked", params: { since: from, to, measure: "sum" } };
  const [count, total, countWords, sumWords, rows] = await Promise.all([
    figureSources.figureValue(orgId, countSrc),
    figureSources.figureValue(orgId, sumSrc),
    figureSources.figureSentence(countSrc),
    figureSources.figureSentence(sumSrc),
    query(`SELECT g.id, g.amount, g.date, g.donor_id, d.name, f.name AS fund
             FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
            WHERE ${where}
            ORDER BY g.date ASC, d.name, g.id${opts.all ? "" : ` LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`}`, args),
  ]);
  const n = Number(count.value) || 0, c = cents(total.value);
  const pages = Math.max(1, Math.ceil(n / PAGE));
  const fromWords = DD.displayDate(from), toWords = DD.displayDate(to);
  return {
    columns: [{ key: "c0", label: "Donor", type: "text" }, { key: "c1", label: "Date", type: "date" },
      { key: "c2", label: "Amount", type: "money" }, { key: "c3", label: "Fund", type: "text" }],
    rows: rows.map(r => ({ c0: r.name, c1: String(r.date || "").slice(0, 10), c2: cents(r.amount) / 100, c3: r.fund || "Unrestricted", _pid: r.donor_id })),
    totals: { count: n, sums: [{ key: "amount", label: "Waiting to be thanked", cents: c }] },
    figures: {
      count: { value: n, source: countSrc, definition: countWords || TB.SENTENCE },
      total: { value: c / 100, source: sumSrc, definition: sumWords || TB.SENTENCE },
    },
    paging: { page: Math.min(page, pages), pages, pageSize: PAGE, from, to, homeFrom: since, today, all: !!opts.all },
    summary: TB.backlogWords({ n, cents: c, drafted: 0 }, fromWords).replace(/;[^;]*$/, "").replace(/\.$/, "") + (to < today ? `, to ${toWords}.` : "."),
    definition: `${TB.SENTENCE} It opens on the same window as Home (${fromWords === DD.displayDate(since) ? `from ${fromWords}` : `Home's starts ${DD.displayDate(since)}`}); pick other dates to see more.`,
  };
}

module.exports = { ackBacklogReport, PAGE };
