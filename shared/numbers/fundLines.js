// shared/numbers/fundLines.js · GIFTS-2. ONE GIFT, SPLIT ACROSS FUNDS.
//
// A $500 gift given "$300 to the food pantry, $200 wherever it's needed" is ONE
// gift: one donor gift, one receipt, one deposit line, one ledger row. Its fund
// lines live in `gift_fund_lines` (one row per fund, amounts in dollars) and
// must add up to the gift, to the cent. A gift with no lines is a gift on its
// own `fund_id`, exactly as before. `gifts.fund_id` on a split gift names the
// largest line, so every reader that never heard of lines still sees a real
// fund; every reader that sums BY FUND goes through the two fragments below.
//
//   GIFT_FUND_ROWS(alias)   a gift's money by fund: its lines, or itself.
//   LEDGER_FUND_ROWS        the ledger by fund: a split gift's one income row
//                           cut by its lines, every other row as it is.
//
// The ledger row is cut in proportion (a partially refunded $500 gift whose row
// now says $400 cuts $240/$160), and the last line takes the remainder so the
// pieces always foot to the row, to the cent.
"use strict";

const MAX_LINES = 12;

// The refusal, or null. `lines` as the form sends them: [{ fundId, amount }].
// Amounts in dollars (numbers or strings); compared in cents.
function linesRefusal(amount, lines) {
  if (!Array.isArray(lines)) return "Fund lines must be a list.";
  if (lines.length < 2) return "A split needs two or more fund lines.";
  if (lines.length > MAX_LINES) return `A split can have at most ${MAX_LINES} fund lines.`;
  const seen = new Set();
  let sum = 0;
  for (const l of lines) {
    const fid = l && String(l.fundId || l.fund_id || "").trim();
    if (!fid) return "Every fund line needs a fund.";
    if (seen.has(fid)) return "Each fund can appear on one line only.";
    seen.add(fid);
    const c = cents(l.amount);
    if (!(c > 0)) return "Every fund line needs an amount above $0.";
    sum += c;
  }
  const want = cents(amount);
  if (sum !== want) return `The fund lines add up to ${dollars(sum)}, and the gift is ${dollars(want)}. They must match before it saves.`;
  return null;
}

function cents(x) {
  const n = Number(String(x == null ? "" : x).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
function dollars(c) {
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The lines normalised for writing: [{ fundId, cents }], largest first.
function normalLines(lines) {
  return lines.map(l => ({ fundId: String(l.fundId || l.fund_id).trim(), cents: cents(l.amount) }))
    .sort((a, b) => b.cents - a.cents || a.fundId.localeCompare(b.fundId));
}

// A derived table with one row per (gift, fund): `gift_id`, `fund_id`,
// `amount`. A gift with lines gives one row per line; any other gift gives
// itself. Use as `FROM gifts g JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id`.
// LATERAL, so it reads only the gifts the outer query already chose.
const GIFT_FUND_ROWS = (g) => `LATERAL (
    SELECT ${g}.id AS gift_id, l.fund_id, l.amount FROM gift_fund_lines l
     WHERE l.gift_id = ${g}.id AND l.org_id = ${g}.org_id
    UNION ALL
    SELECT ${g}.id, ${g}.fund_id, ${g}.amount
     WHERE NOT EXISTS (SELECT 1 FROM gift_fund_lines l2 WHERE l2.gift_id = ${g}.id AND l2.org_id = ${g}.org_id)
  )`;

// fin_transactions with a split gift's row cut by its lines. Same columns as
// fin_transactions (`id` stays the row's own id, so a cut row is still that
// row), `fund_id` and `amount` replaced. `$ORG` is the caller's org param.
const LEDGER_FUND_ROWS = (orgParam = "?") => `(
    SELECT ft.id, ft.org_id, ft.date, ft.type, ft.description, ft.vendor_donor, ft.account_id,
           ft.grant_id, ft.gift_id, ft.donor_id, ft.source, ft.fund_id, ft.amount
      FROM fin_transactions ft
     WHERE ft.org_id = ${orgParam}
       AND NOT (ft.gift_id IS NOT NULL AND EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = ft.gift_id AND l.org_id = ft.org_id))
    UNION ALL
    SELECT ft.id, ft.org_id, ft.date, ft.type, ft.description, ft.vendor_donor, ft.account_id,
           ft.grant_id, ft.gift_id, ft.donor_id, ft.source, c.fund_id,
           (CASE WHEN c.rn = c.n THEN c.row_cents - c.before_cents ELSE c.share_cents END) / 100.0 AS amount
      FROM fin_transactions ft
      JOIN LATERAL (
        SELECT x.*, COALESCE(SUM(x.share_cents) OVER (ORDER BY x.rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before_cents
          FROM (SELECT l.fund_id,
                       ROUND(ft.amount * 100)::bigint AS row_cents,
                       ROUND(ROUND(ft.amount * 100) * ROUND(l.amount * 100) / NULLIF(SUM(ROUND(l.amount * 100)) OVER (), 0))::bigint AS share_cents,
                       ROW_NUMBER() OVER (ORDER BY l.amount DESC, l.fund_id) AS rn,
                       COUNT(*) OVER () AS n
                  FROM gift_fund_lines l WHERE l.gift_id = ft.gift_id AND l.org_id = ft.org_id) x
      ) c ON TRUE
     WHERE ft.org_id = ${orgParam} AND ft.gift_id IS NOT NULL
  )`;

// The cents of the fund rows above, summed (alias of GIFT_FUND_ROWS's table).
const LINES_CENTS = (gf = "gf") => `COALESCE(SUM(ROUND(${gf}.amount * 100)), 0)::bigint`;

// Lines for a set of gifts, for the screens: Map giftId → [{ fundId, fundName, amount }].
async function linesFor(query, orgId, giftIds) {
  const ids = [...new Set((giftIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await query(
    `SELECT l.gift_id, l.fund_id, f.name AS fund_name, f.restricted, l.amount
       FROM gift_fund_lines l LEFT JOIN fin_funds f ON f.id = l.fund_id AND f.org_id = l.org_id
      WHERE l.org_id = ? AND l.gift_id = ANY(?::text[])
      ORDER BY l.gift_id, l.amount DESC, l.fund_id`, [orgId, ids]);
  for (const r of rows) {
    if (!out.has(r.gift_id)) out.set(r.gift_id, []);
    out.get(r.gift_id).push({ fundId: r.fund_id, fundName: r.fund_name || "A fund that is gone", restricted: !!r.restricted, amount: Number(r.amount) });
  }
  return out;
}

module.exports = { linesRefusal, normalLines, GIFT_FUND_ROWS, LINES_CENTS, LEDGER_FUND_ROWS, linesFor, MAX_LINES, cents };
