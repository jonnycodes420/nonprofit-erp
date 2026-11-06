// server/donors/giftFundLines.js · GIFTS-2. The schema and the one writer of a
// gift's fund lines (shared/numbers/fundLines.js says what they mean).
//
// The lines are written beside the gift, never instead of it: the gift row, its
// receipt, its deposit line and its one ledger row are unchanged. The gift's
// own `fund_id` and its ledger row's `fund_id` are set to the largest line, so a
// reader that does not cut by lines still sees a real fund.
"use strict";
const { newId } = require("../shared/newId");
const FL = require("../../shared/numbers/fundLines");

async function giftFundLinesSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS gift_fund_lines (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      gift_id TEXT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
      fund_id TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_fund_lines ON gift_fund_lines (gift_id, fund_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gift_fund_lines_org ON gift_fund_lines (org_id, fund_id)`);
}

// Checked before any write: the refusal sentence, or the normalised lines.
// Every fund must be this org's.
async function checkLines(query, orgId, amount, lines) {
  const refusal = FL.linesRefusal(amount, lines);
  if (refusal) return { error: refusal };
  const norm = FL.normalLines(lines);
  const ids = norm.map(l => l.fundId);
  const found = await query("SELECT id FROM fin_funds WHERE org_id = ? AND id = ANY(?::text[])", [orgId, ids]);
  if (found.length !== ids.length) return { error: "Fund not found", notFound: true };
  return { lines: norm };
}

// Replace a gift's lines (an empty list clears them). `lines` already checked.
// `run` may be a transaction's runner. Moves the gift's fund and its ledger
// row's fund to the largest line.
async function writeLines(run, orgId, giftId, lines, by) {
  await run("DELETE FROM gift_fund_lines WHERE org_id = ? AND gift_id = ?", [orgId, giftId]);
  if (!lines || !lines.length) return;
  for (const l of lines) {
    await run(
      `INSERT INTO gift_fund_lines (id, org_id, gift_id, fund_id, amount, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?)`,
      [newId("gfl"), orgId, giftId, l.fundId, (l.cents / 100).toFixed(2), by.id || "system:gift-form", by.name || null]);
  }
  await run("UPDATE gifts SET fund_id = ? WHERE org_id = ? AND id = ?", [lines[0].fundId, orgId, giftId]);
  await run("UPDATE fin_transactions SET fund_id = ? WHERE org_id = ? AND gift_id = ?", [lines[0].fundId, orgId, giftId]);
}

module.exports = { giftFundLinesSchema, checkLines, writeLines };
