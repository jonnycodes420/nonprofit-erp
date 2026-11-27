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

// The open draft for the same person's same day is found by queueThankYouDraft's own gift read
// (server/boot/helpers-2.js), so a gift costs no extra statement (capture1-zero-day's budget).

module.exports = { giftIdsOf, COVERS, COVERS_ANY };
