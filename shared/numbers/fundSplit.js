// shared/numbers/fundSplit.js · LEDGER-2. WHAT A PERSON SUPPORTS, AND THE
// RESTRICTED / UNRESTRICTED SPLIT OF THEIR LIFETIME.
//
// The same money as Lifetime (lifetime.js), cut by fund: the imported total
// plus every gift on file it does not already cover, refunds taken off, credit
// rows out. Each piece is in exactly one bucket, by its fund's restriction:
// a gift on a restricted fund is Restricted; a gift on an unrestricted fund
// (General Operating, a board-designated reserve), a gift with no fund, a gift
// whose fund is gone, and the imported total (the old system gave no fund) are
// Unrestricted. So Restricted + Unrestricted = Lifetime, to the cent.
//
// Before this file the profile counted a gift on an unrestricted fund in
// neither bucket: Unrestricted was only the gifts with no fund at all, so a
// person who gave to General Operating read "Unrestricted $0", and a $5,000
// Gala Reserve gift fell out of a $36,750 lifetime ($3,000 + $28,750).
"use strict";
const { MONEY } = require("./money");
const { AFTER_IMPORT } = require("./lifetime");
// GIFTS-2: a gift split across funds is cut by its lines, each in its own fund's bucket.
const { GIFT_FUND_ROWS } = require("./fundLines");

const NO_FUND = "No fund named";
const IMPORTED = "From your old system";

// One person's lifetime by fund, in cents. Rows: { fundId, fundName, restricted,
// cents, giftCount, lastDate }; the imported total is its own row (fundId null).
async function fundSplit(query, orgId, donorId) {
  const [d] = await query(`SELECT id, org_id, imported_total, imported_through FROM donors WHERE org_id = ? AND id = ?`, [orgId, donorId]);
  if (!d) return null;
  const rows = await query(
    `SELECT NULLIF(gf.fund_id, '') AS fund_id, f.name AS fund_name, COALESCE(f.restricted, false) AS restricted,
            COUNT(*)::int AS gift_count, ROUND(SUM(gf.amount) * 100)::bigint AS cents, MAX(LEFT(g.date, 10)) AS last_date
       FROM gifts g
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id
       LEFT JOIN fin_funds f ON f.id = gf.fund_id AND f.org_id = g.org_id
      WHERE g.org_id = ? AND g.donor_id = ? AND ${MONEY("g")} AND ${AFTER_IMPORT("g", "d")}
      GROUP BY 1, 2, 3`, [orgId, donorId]);
  const funds = rows.map(r => ({
    fundId: r.fund_id && r.fund_name ? r.fund_id : null,
    fundName: r.fund_name || NO_FUND,
    restricted: !!r.fund_name && !!r.restricted,
    cents: Number(r.cents) || 0, giftCount: Number(r.gift_count) || 0, lastDate: r.last_date || null,
  }));
  // A gift whose fund is gone and a gift with no fund are one line.
  const merged = [];
  for (const f of funds) {
    const same = !f.fundId && merged.find(m => !m.fundId && m.fundName === NO_FUND);
    if (same) { same.cents += f.cents; same.giftCount += f.giftCount; same.lastDate = [same.lastDate, f.lastDate].filter(Boolean).sort().pop() || null; }
    else merged.push({ ...f });
  }
  const importedCents = Math.round(Number(d.imported_total || 0) * 100);
  if (importedCents) merged.push({ fundId: null, fundName: IMPORTED, restricted: false, cents: importedCents, giftCount: 0, lastDate: d.imported_through || null, imported: true });
  merged.sort((a, b) => b.cents - a.cents || String(a.fundName).localeCompare(String(b.fundName)));
  return split(merged);
}

// The buckets and percents over rows already read. Percents are whole numbers
// that add to 100 (largest remainder), so a screen never shows 101%.
function split(funds) {
  const lifetimeCents = funds.reduce((s, f) => s + f.cents, 0);
  const restrictedCents = funds.filter(f => f.restricted).reduce((s, f) => s + f.cents, 0);
  const unrestrictedCents = lifetimeCents - restrictedCents;
  const pcts = wholePercents(funds.map(f => f.cents));
  const [rPct, uPct] = lifetimeCents > 0 ? wholePercents([restrictedCents, unrestrictedCents]) : [0, 0];
  return { funds: funds.map((f, i) => ({ ...f, pct: pcts[i] })), lifetimeCents, restrictedCents, unrestrictedCents, restrictedPct: rPct, unrestrictedPct: uPct };
}

function wholePercents(parts) {
  const total = parts.reduce((s, x) => s + Math.max(0, x), 0);
  if (!(total > 0)) return parts.map(() => 0);
  const raw = parts.map(x => Math.max(0, x) / total * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, x) => s + x, 0);
  raw.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

module.exports = { fundSplit, split, wholePercents, NO_FUND, IMPORTED };
