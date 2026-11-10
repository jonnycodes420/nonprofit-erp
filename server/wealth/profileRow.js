// server/wealth/profileRow.js · WEALTH-1. ONE PERSON'S WEALTH SCORE, AS THE PROFILE SHOWS IT.
//
// The shape GET /donors/:id/wealth-score answers, and the same object riding
// on GET /donors/:id/rail (already in the profile's first bundle, so opening a
// profile asks for nothing more). `forViewer` answers null for anyone who may
// not see it (server/wealth/access.js), and the profile then draws no row.
"use strict";
const { query } = require("../../db");
const WS = require("../../shared/numbers/wealthScore");
const WA = require("./access");

// Steward's suggestion, from Room to give's own facts; shown, never stored.
async function suggestionFor(orgId, donorId) {
  const P = require("../../prospect");
  const facts = (await P.loadFacts(orgId, [donorId])).get(donorId);
  return facts ? WS.suggest(facts) : null;
}
const shape = (d, suggestion) => ({
  id: d.id, score: d.wealth_rating == null ? null : Number(d.wealth_rating),
  setAt: d.wealth_rating_set_at || null, setByName: d.wealth_rating_set_by_name || null,
  // A suggestion only beside an empty score, and never counted as set.
  suggestion: d.wealth_rating == null ? suggestion : null,
  label: WS.LABEL, definition: WS.SENTENCE,
});
async function rowFor(orgId, donorId) {
  const [d] = await query(`SELECT id, wealth_rating, wealth_rating_set_at, wealth_rating_set_by_name FROM donors
                            WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return null;
  return shape(d, d.wealth_rating == null ? await suggestionFor(orgId, d.id) : null);
}
async function forViewer(req, donorId) {
  if (!(await WA.maySee(req.user && req.user.userId, req.user && req.user.orgId))) return null;
  return rowFor(req.user.orgId, donorId);
}

module.exports = { suggestionFor, shape, rowFor, forViewer };
