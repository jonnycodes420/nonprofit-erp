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
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

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
  const countSrc = { key: "unthanked", params: { since: from, to } };
  const sumSrc = { key: "unthanked", params: { since: from, to, measure: "sum" } };
  const [count, total, countWords, sumWords, rows] = await Promise.all([
    figureSources.figureValue(orgId, countSrc),
    figureSources.figureValue(orgId, sumSrc),
    figureSources.figureSentence(countSrc),
    figureSources.figureSentence(sumSrc),
    TB.waitingBetween(query, orgId, from, to, opts.all ? {} : { limit: PAGE, offset: (page - 1) * PAGE }),
  ]);
  const n = Number(count.value) || 0, c = cents(total.value);
  // NUMBERS-10 item 2 (W-1125-Finance-T7): the fleet read this report at 846 gifts back to Oct 2024 beside
  // Home's 118 since Apr 22, 2025. The backlog is Home's window; what waits from before the window is its
  // own labelled figure, "Older than the window", never added to the backlog.
  const olderSrc = { key: "unthanked-before", params: { before: since } };
  const [olderN, olderSum, olderWords] = await Promise.all([
    figureSources.figureValue(orgId, olderSrc),
    figureSources.figureValue(orgId, { key: "unthanked-before", params: { before: since, measure: "sum" } }),
    figureSources.figureSentence(olderSrc),
  ]);
  const older = { value: Number(olderN.value) || 0, cents: cents(olderSum.value), source: olderSrc, definition: olderWords };
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
      older,
    },
    paging: { page: Math.min(page, pages), pages, pageSize: PAGE, from, to, homeFrom: since, today, all: !!opts.all },
    summary: TB.backlogWords({ n, cents: c, drafted: 0 }, fromWords).replace(/;[^;]*$/, "").replace(/\.$/, "") + (to < today ? `, to ${toWords}.` : "."),
    olderWords: older.value ? `Older than the window: ${older.value.toLocaleString("en-US")} ${older.value === 1 ? "gift" : "gifts"} (${usd(older.cents)}) dated before ${DD.displayDate(since)} ${older.value === 1 ? "has" : "have"} no thank-you logged. ${older.value === 1 ? "It is" : "They are"} not in the backlog; pick an earlier From date to list ${older.value === 1 ? "it" : "them"}.` : null,
    definition: `${TB.SENTENCE} It opens on the same window as Home (${fromWords === DD.displayDate(since) ? `from ${fromWords}` : `Home's starts ${DD.displayDate(since)}`}); pick other dates to see more.`,
  };
}

module.exports = { ackBacklogReport, PAGE };
