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
    const [live] = await query("SELECT status FROM pledges WHERE id=? AND org_id=?", [move.item.pledgeId, orgId]);
    if (!live || live.status !== "open") move = null;
  }
  // THANKS-1 item 4: with no move, the step the rules still give (thank the newest gift), or why none.
  const unit = r.units.find(u => u.ids.includes(d.id)) || null;
  const after = !move && d.deceased !== true ? await require("./afterMove").afterMove(query, orgId, unit ? unit.ids : [d.id]) : null;
  return { got, result: r, move, after, unit, deceased: d.deceased === true };
}

module.exports = { nextMoveOf };
