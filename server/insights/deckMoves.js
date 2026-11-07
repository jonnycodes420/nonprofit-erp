// server/insights/deckMoves.js · MOPUP-3 item 4. THE DECK'S SIZE BEFORE THE DECK.
//
// On a phone, Home's moves deck stands in as a box the deck's height
// (client/src/lib/movesGate.js): the last height this browser saw, or 1,200 px.
// A new org's deck is short (no moves, or "being prepared"), so the stand-in
// was taller than the deck and what sat under it jumped up once when it landed.
//
// The stored Insights answer is up to ~26 MB of JSON, far too much to read on
// the boot path, so the build keeps the deck's move count beside it
// (stored_insights.deck_moves) and GET /org (a boot read) carries it:
//   0     no moves, or nothing built yet (the deck says "being prepared")
//   n     n moves across the deck's tabs
//   null  built before this column existed: not known, the stand-in keeps its old size
"use strict";
const { query, withClient } = require("../../db");

// The column, added once if missing (looked up first, so a boot that finds it
// takes no lock; added with a short lock_timeout so it never queues ahead of reads).
async function ensureColumn() {
  const [has] = await query(`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'stored_insights' AND column_name = 'deck_moves'`, []);
  if (has) return;
  await withClient(async c => {
    await c.query(`SET lock_timeout = '1s'`);
    try { await c.query(`ALTER TABLE stored_insights ADD COLUMN IF NOT EXISTS deck_moves INTEGER`); }
    finally { await c.query(`RESET lock_timeout`).catch(() => {}); }
  });
}

// The moves in a computed answer (insights.computeInsights's deck: each tab's count).
function countOf(result) {
  const tabs = (result && result.deck && Array.isArray(result.deck.tabs)) ? result.deck.tabs : [];
  return tabs.reduce((n, t) => n + (Number(t && t.count) || 0), 0);
}

// The org's latest stored count: 0 when nothing is stored yet, null when unknown.
async function forOrg(orgId) {
  try {
    const [r] = await query(`SELECT deck_moves FROM stored_insights WHERE org_id = ? ORDER BY as_of DESC LIMIT 1`, [orgId]);
    if (!r) return 0;
    return r.deck_moves == null ? null : Number(r.deck_moves);
  } catch { return null; }   // the table or column is not there yet: not known
}

module.exports = { ensureColumn, countOf, forOrg };
