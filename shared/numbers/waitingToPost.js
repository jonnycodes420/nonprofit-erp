// shared/numbers/waitingToPost.js · LEDGER-3 item 3. THE WAITING GIFTS, BY DEPOSIT.
//
// What Finance's Post to the books lists (server/finance/ledgerPost.js writes):
// the gifts ledgerStatus.js calls `waiting`, that have a date (recordGift does
// not post an undated gift either), grouped by the deposit they came in with:
// `deposit_ref`, else the day it was deposited, else "no deposit on file". Each
// group says its gifts (giftCount.js: a refund row is money, never a gift), the
// rows that post, and their cents. The undated waiting gifts are counted apart.
"use strict";
const LS = require("./ledgerStatus");
const FY = require("./fiscalYear");
const { MONEY, LIVE, GIFT } = require("./money");

// The deposit a gift posts with: its reference, else its deposited day, else none.
const GROUP_KEY = (g = "g") => `CASE WHEN COALESCE(${g}.deposit_ref, '') <> '' THEN 'ref:' || ${g}.deposit_ref
  WHEN COALESCE(${g}.deposited_on, '') <> '' THEN 'day:' || LEFT(${g}.deposited_on, 10) ELSE 'none' END`;

function day(d) {
  const s = String(d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "no date";
  return new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function groupLabel(key) {
  if (key === "none") return "No deposit on file";
  if (key.startsWith("day:")) return `Deposited ${day(key.slice(4))}`;
  const ref = key.slice(4);
  if (ref.startsWith("sheet:")) return `Deposit sheet, ${day(ref.slice(6))}`;
  if (/^po_/.test(ref)) return `Card payout ${ref}`;
  return `Deposit ${ref}`;
}

async function fyFromOf(query, orgId) {
  const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
  return FY.fiscalYearToDate(org || {}).from;
}

// The waiting gifts that can post, by group. `keys` limits it to those groups.
async function waitingGifts(query, orgId, fyFrom, keys) {
  return query(
    `SELECT g.id, LEFT(g.date, 10) AS date, LEFT(COALESCE(NULLIF(g.deposited_on, ''), g.date), 10) AS dday, g.amount, g.fund_id, g.donor_id, d.name AS donor_name, ${GROUP_KEY("g")} AS gkey, ${GIFT("g")} AS counted
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE ${LS.STATUS("g")} = 'waiting' AND g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}
        AND COALESCE(LEFT(g.date, 10), '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        ${keys ? `AND ${GROUP_KEY("g")} = ANY(?::text[])` : ""}
      ORDER BY g.date, g.id`, keys ? [fyFrom, orgId, keys] : [fyFrom, orgId]);
}

async function groupsFor(query, orgId) {
  const fyFrom = await fyFromOf(query, orgId);
  const rows = await waitingGifts(query, orgId, fyFrom, null);
  const by = new Map();
  for (const g of rows) {
    if (!by.has(g.gkey)) by.set(g.gkey, { key: g.gkey, label: groupLabel(g.gkey), n: 0, rows: 0, cents: 0, from: g.date, to: g.date, day: g.dday });
    const x = by.get(g.gkey);
    // `n` is gifts by the one rule (giftCount.js: a refund row is money, not a gift); `rows` is what posts.
    x.rows++; if (g.counted) x.n++; x.cents += Math.round(Number(g.amount) * 100);
    if (g.date < x.from) x.from = g.date;
    if (g.date > x.to) x.to = g.date;
    if (g.dday > x.day) x.day = g.dday;
  }
  // Newest deposit day first; "no deposit on file" last.
  const groups = [...by.values()].sort((a, b) => (a.key === "none") - (b.key === "none") || (b.day < a.day ? -1 : b.day > a.day ? 1 : a.key.localeCompare(b.key)));
  const [undated] = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE ${LS.STATUS("g")} = 'waiting' AND g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}
        AND COALESCE(LEFT(g.date, 10), '') !~ '^\\d{4}-\\d{2}-\\d{2}$'`, [fyFrom, orgId]);
  return { fyFrom, groups, undated: { n: Number(undated && undated.n) || 0, cents: Number(undated && undated.cents) || 0 } };
}

module.exports = { GROUP_KEY, groupLabel, fyFromOf, waitingGifts, groupsFor };
