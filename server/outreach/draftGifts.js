// server/outreach/draftGifts.js · ONE-MOVE-1 item 3. THE GIFTS ONE THANK-YOU DRAFT THANKS FOR.
//
// One person's gifts on one day make one draft (the fleet saw six donors with two drafts each
// for one day's giving). The draft keeps its first gift in gift_id and the day's others in
// also_gift_ids; every door that marks a draft sent thanks them all, and Undo puts each back.
"use strict";

// The draft's gifts, first one first.
const giftIdsOf = d => [d.gift_id, ...((d && d.also_gift_ids) || [])].filter(Boolean);

// SQL: thank-you draft `t` thanks gift id placeholder `?` (its own, or one folded into it).
const COVERS = (t = "t") => `(${t}.gift_id = ? OR ? = ANY(${t}.also_gift_ids))`;
// SQL: draft `t` thanks any of the gift ids in array placeholder `?`.
const COVERS_ANY = (t = "t") => `(${t}.gift_id = ANY(?) OR ${t}.also_gift_ids && ?::text[])`;

// The same person's open draft for a gift on `date`, if there is one (never the gift itself).
async function openDraftForDay(query, orgId, donorId, date, giftId) {
  if (!date) return null;
  const [d] = await query(
    `SELECT t.id, t.gift_id, t.also_gift_ids FROM thank_you_drafts t JOIN gifts g ON g.id = t.gift_id AND g.org_id = t.org_id
      WHERE t.org_id = ? AND t.donor_id = ? AND t.sent_at IS NULL AND t.skipped_at IS NULL AND g.date = ? AND t.gift_id <> ?
      ORDER BY t.created_at LIMIT 1`, [orgId, donorId, String(date).slice(0, 10), giftId || ""]);
  return d || null;
}

module.exports = { giftIdsOf, COVERS, COVERS_ANY, openDraftForDay };
