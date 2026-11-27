// server/insights/nextMoveOf.js · ATLAS-10 item 2. ONE NEXT MOVE FOR A PERSON.
//
// The profile's "Next move" (GET /insights/donor/:id) and Atlas's brief read it here, so Atlas
// never says "There is no next step planned for Priya" while her profile shows "Call Priya, ask
// $5,000". The move is the first card item, by rank, that names the person (insights.js
// nextMoveFor), never for someone marked deceased, and never a pledge collection for a pledge
// that is no longer open (PLEDGES-2).
"use strict";
const I = require("../../insights");
const D = require("../../insightsData");

// { preparing, result, move, after, unit } for `donorId` as of `asOf` (YYYY-MM-DD). `opts` go to insightsFor.
async function nextMoveOf(query, orgId, donorId, asOf, opts = {}) {
  const [d] = await query("SELECT id, deceased FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
  if (!d) return { missing: true };
  const got = await D.insightsFor(orgId, asOf, opts);
  if (got.preparing) return { preparing: true, got, deceased: d.deceased === true };
  const r = got.result;
  let move = d.deceased === true ? null : I.nextMoveFor(r, d.id);
  if (move && move.item && move.item.pledgeId) {
    // ONE-MOVE-1: a pledge whose person is in the trash drives nobody's move (until the stored answer rebuilds)
    const [live] = await query("SELECT p.status FROM pledges p JOIN donors pd ON pd.id = p.donor_id AND pd.org_id = p.org_id WHERE p.id=? AND p.org_id=? AND pd.deleted_at IS NULL", [move.item.pledgeId, orgId]);
    if (!live || live.status !== "open") move = null;
  }
  // ONE-MOVE-1 item 2: a move made from the household's giving says so on each member, and names only the living
  if (move && move.item && (move.item.ids || []).length > 1) {
    const ids = (await query("SELECT id FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL", [orgId, move.item.ids])).map(r => r.id);
    if (!ids.includes(d.id)) move = null;
    else if (ids.length > 1) move = { ...move, household: { ids, sentence: "A household move: it comes from the giving of everyone in the household, not only this person's." } };
  }
  // THANKS-1 item 4: with no move, the step the rules still give (thank the newest gift), or why none.
  const unit = r.units.find(u => u.ids.includes(d.id)) || null;
  const after = !move && d.deceased !== true ? await require("./afterMove").afterMove(query, orgId, unit ? unit.ids : [d.id]) : null;
  return { got, result: r, move, after, unit, deceased: d.deceased === true };
}

module.exports = { nextMoveOf };
