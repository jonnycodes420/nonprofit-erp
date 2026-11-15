// server/reports/giftRows.js · FLOWS-11 (W-1113-Fundraising-01). THE ROWS BEHIND A COUNT OF GIFTS
// ARE THE GIFTS.
//
// FLOWS-9 made the answer say how many gifts a figure has (giftCount.js) but left the dialog
// paging every row: a refund row and the gift it refunded in full each took a line, so FY read
// "Showing 1–50 of 653" under a card of 649. The count on the card was fixed and the rows behind
// it were not, because the pager counted rows and the card counted gifts.
//
// Now a source that marks its rows `counted` (and names `refund_of`) is paged by its counted
// gifts only. Each gift carries its own refunds, listed under it. What is left (a gift refunded
// in full with its refund, a refund whose gift is outside the dates) is listed once, apart, under
// "Not counted as gifts", so every row still opens and the foot still adds up to the figure.
"use strict";

const REST_MAX = 200;
const NOT_COUNTED_SENTENCE = n => (n > 0
  ? `Also listed: ${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"} not counted as gifts: a gift refunded in full, and refunds. They are in the total, which nets each refund off.`
  : "");

// `sql`/`args` from a source with countsGifts. Answers { n, rows, rest }:
// n the counted gifts (the pager's total), rows this page of them, each with
// `refunds` (raw rows), rest the not-counted rows (raw), at most REST_MAX.
async function giftRowsPage(query, { sql, args }, { page, pageSize, order, wantRows, restMax = REST_MAX }) {
  const [c] = await query(`WITH x AS (${sql}) SELECT COUNT(*) FILTER (WHERE x.counted)::int AS n,
                                   COUNT(*) FILTER (WHERE NOT x.counted AND NOT EXISTS (SELECT 1 FROM x k WHERE k.counted AND k.id = x.refund_of))::int AS r
                              FROM x`, args);
  if (!wantRows) return { n: Number(c.n) || 0, restCount: Number(c.r) || 0, rows: [], rest: [] };
  const [rows, rest] = await Promise.all([
    query(`WITH x AS (${sql})
           SELECT x.*, (SELECT COALESCE(json_agg(json_build_object('id', r.id, 'type', r.type, 'donor_id', r.donor_id, 'name', r.name,
                                                                  'date', r.date, 'amount', r.amount, 'detail', r.detail) ORDER BY r.date, r.id), '[]'::json)
                          FROM x r WHERE r.refund_of = x.id AND NOT r.counted) AS refunds
             FROM x WHERE x.counted ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize]),
    query(`WITH x AS (${sql})
           SELECT x.* FROM x WHERE NOT x.counted AND NOT EXISTS (SELECT 1 FROM x k WHERE k.counted AND k.id = x.refund_of)
            ORDER BY COALESCE(x.refund_of, x.id), x.amount DESC, x.date LIMIT ?`, [...args, restMax]),
  ]);
  return { n: Number(c.n) || 0, restCount: Number(c.r) || 0, rows, rest };
}

module.exports = { giftRowsPage, NOT_COUNTED_SENTENCE, REST_MAX };
