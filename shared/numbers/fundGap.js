// shared/numbers/fundGap.js · NUMBERS-9 item 1. WHY "GIFTS ON THE BOOKS" AND "TRANSACTIONS IN" DIFFER.
//
// The fleet (W-1122-Finance-F7, third night) read General Operating's card at "$720,749 from 654
// transactions ($745,479 in ...)" and its dialog at "649 on the books ($745,561.13)": $82.13 apart,
// with nothing on screen to say why. They are two honest figures about different rows:
//
//   gifts on the books   each posted gift's amount, GROSS: what the donor was charged (giftFooting.js).
//   transactions in      the ledger's income rows on the fund, as they were posted.
//
// They agree to the cent when every posted gift's ledger row carries the gift's amount and every
// income row is a gift's. Where they do not, the difference is one of three things, each its own
// line with the rows that make it (figure source `fund-books-gap`, server/reports/ledgerSources.js):
//
//   fee     the donor covered the card fee and the gift says the charge, but its row was posted
//           at the gift before the fee (gift less row = gifts.cover_fee_amount);
//   other   any other gift whose row differs from it: the gift was changed after it posted, or
//           its row sits on another fund;
//   manual  income rows that are no gift's (entered by hand in Finance): in "transactions in",
//           never in "gifts on the books".
//
//   gifts on the books - transactions in = fee + other - manual, to the cent.
//
// Staging's Harborlight: $82.13 = four gifts whose donors covered the card fee (the demo seed grossed
// the gifts up after their rows were written; scripts/ci/seed-demo.js now moves the row with the gift).
"use strict";
const { MONEY, LIVE } = require("./money");
const { GIFT_FUND_ROWS, LEDGER_FUND_ROWS } = require("./fundLines");
const { POSTED } = require("./ledgerStatus");

// SQL: one row per (fund, gift) whose posted gift and ledger row differ, plus one row per fund for
// the income rows that are no gift's. Columns: fund_id, gift_id (null for manual), kind,
// gift_cents, row_cents, n (rows behind it). Binds, in order: default fund id, org id, org id, org id (LEDGER_FUND_ROWS takes two).
const GAP_ROWS = () => `(
  WITH gl AS (
    SELECT gf.gift_id, COALESCE(gf.fund_id, ?::text) AS fund_id, SUM(ROUND(gf.amount * 100))::bigint AS cents
      FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id
     WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")} AND ${POSTED("g")}
     GROUP BY 1, 2),
  rl AS (
    SELECT ft.gift_id, ft.fund_id, SUM(ROUND(ft.amount * 100))::bigint AS cents, COUNT(*)::int AS n
      FROM ${LEDGER_FUND_ROWS()} ft WHERE ft.type = 'income'
     GROUP BY 1, 2)
  SELECT COALESCE(gl.fund_id, rl.fund_id) AS fund_id, COALESCE(gl.gift_id, rl.gift_id) AS gift_id,
         CASE WHEN gl.gift_id IS NULL AND rl.gift_id IS NULL THEN 'manual'
              WHEN gl.gift_id IS NOT NULL AND rl.gift_id IS NOT NULL AND cg.cover_fee_amount > 0
                   AND gl.cents - rl.cents = ROUND(cg.cover_fee_amount * 100) THEN 'fee'
              ELSE 'other' END AS kind,
         COALESCE(gl.cents, 0) AS gift_cents, COALESCE(rl.cents, 0) AS row_cents,
         CASE WHEN gl.gift_id IS NULL AND rl.gift_id IS NULL THEN rl.n ELSE 1 END AS n
    FROM gl FULL JOIN rl ON rl.gift_id = gl.gift_id AND rl.fund_id = gl.fund_id
    LEFT JOIN gifts cg ON cg.id = COALESCE(gl.gift_id, rl.gift_id)
   WHERE (gl.gift_id IS NULL AND rl.gift_id IS NULL) OR COALESCE(gl.cents, 0) <> COALESCE(rl.cents, 0))`;

const EMPTY = () => ({ fee: { n: 0, cents: 0 }, other: { n: 0, cents: 0 }, manual: { n: 0, cents: 0 } });

// Map fundId -> { fee, other, manual }: each { n, cents }. fee and other are gift less row (what
// the gifts say above their rows); manual is the hand-entered income.
async function fundGap(query, orgId, { defaultId = null, fundId = null } = {}) {
  const rows = await query(
    `SELECT x.fund_id, x.kind, SUM(x.n)::int AS n,
            SUM(CASE WHEN x.kind = 'manual' THEN x.row_cents ELSE x.gift_cents - x.row_cents END)::bigint AS cents
       FROM ${GAP_ROWS()} x ${fundId ? "WHERE x.fund_id = ?" : ""}
      GROUP BY 1, 2`, [defaultId, orgId, orgId, orgId, ...(fundId ? [fundId] : [])]);
  const out = new Map();
  for (const r of rows) {
    if (!r.fund_id) continue;
    if (!out.has(r.fund_id)) out.set(r.fund_id, EMPTY());
    out.get(r.fund_id)[r.kind] = { n: Number(r.n) || 0, cents: Number(r.cents) || 0 };
  }
  return out;
}

const usd = c => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const nn = (k, one, many) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;

// The line that says why the two figures differ, or that they agree. `f` is fundCard's figures
// for one fund (gifts.posted, inCents) with `gap` from fundGap.
function gapWords(f) {
  const gap = f.gap || EMPTY();
  const on = f.gifts.posted.cents, inn = f.inCents;
  if (!f.gifts.posted.n && !inn) return "";
  const head = `Gifts on the books ${usd(on)} (gross: what donors were charged) and transactions in ${usd(inn)} (the ledger's income rows as posted)`;
  if (on === inn && !gap.fee.n && !gap.other.n && !gap.manual.n) return `${head} agree, to the cent.`;
  const parts = [];
  if (gap.fee.n) parts.push(`${usd(gap.fee.cents)} is the card fee donors covered on ${nn(gap.fee.n, "gift", "gifts")}, posted at the gift before the fee`);
  if (gap.other.n) parts.push(`${usd(gap.other.cents)} is ${nn(gap.other.n, "gift whose ledger row differs", "gifts whose ledger rows differ")} from the gift (changed after it posted, or posted to another fund)`);
  if (gap.manual.n) parts.push(`${usd(gap.manual.cents)} in ${nn(gap.manual.n, "income row", "income rows")} entered by hand is in transactions, not in gifts`);
  return `${head} differ by ${usd(Math.abs(on - inn))}: ${parts.join("; ")}.`;
}

// The lines a screen lists under the sentence, each a figure that opens its rows.
function gapLines(f, fundId) {
  const gap = f.gap || EMPTY();
  const L = { fee: "Card fees donors covered", other: "Gifts whose ledger row differs", manual: "Income entered by hand" };
  return ["fee", "other", "manual"].filter(k => gap[k].n).map(k => ({ kind: k, label: L[k], n: gap[k].n, cents: gap[k].cents,
    source: { key: "fund-books-gap", params: { fund: fundId, kind: k } } }));
}

const SENTENCE = "Gifts on the books are each posted gift's gross amount; transactions in are the ledger's income rows. Any difference between them is listed line by line, and each line opens its rows.";

module.exports = { GAP_ROWS, fundGap, gapWords, gapLines, SENTENCE };
