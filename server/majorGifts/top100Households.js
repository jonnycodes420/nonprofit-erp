// server/majorGifts/top100Households.js · HOUSEHOLD-1. A HOUSEHOLD HOLDS A PLACE.
//
// A pilot customer's Top 100 (24 Nov) had a couple in two places, with no way
// to see their combined giving or capacity, so she merged them and lost one
// person's email, phone and photo. Now a place on the list is a person
// (portfolio_members.donor_id) or a household (.household_id), never both.
//
//   The household's row reads as the household's name, with
//     Lifetime    each person's Lifetime added (the `household-giving` source)
//     This year   each person's gifts this fiscal year to date (`household-span`)
//     Last gift   the latest of theirs, and whose
//     Wealth      the higher Wealth Score of the two, labelled "household"
//     Photos      each person's own, side by side
//   Owner, stage, ask and plan of care are the household's lead person's: its
//   primary person while they are live, else its first person. A household
//   keeps one plan, never a second copy (BUILD-30).
//
// The money is shared/numbers/householdGiving.js's, read at the moment the list
// is drawn and never stored.
"use strict";
const HG = require("../../shared/numbers/householdGiving");

// The list's places, top first, each with its household (if any) named.
async function placesOf(query, orgId, listId) {
  return query(
    `SELECT m.rank, m.added_at, m.donor_id, m.household_id, h.name AS household_name, h.primary_donor_id
       FROM portfolio_members m LEFT JOIN households h ON h.id = m.household_id AND h.org_id = m.org_id
      WHERE m.org_id = ? AND m.list_id = ? ORDER BY m.rank`, [orgId, listId]);
}

// Map householdId -> { lead, money } for the household places.
async function householdsOf(query, orgId, places, span) {
  const ids = places.filter(p => p.household_id).map(p => p.household_id);
  const money = await HG.householdMoney(query, orgId, ids, span);
  const out = new Map();
  for (const p of places) {
    if (!p.household_id) continue;
    const m = money.get(p.household_id);
    const live = m ? m.people.map(x => x.id) : [];
    out.set(p.household_id, { lead: live.includes(p.primary_donor_id) ? p.primary_donor_id : live[0] || null, money: m, name: p.household_name });
  }
  return out;
}

// The extra fields a household's row carries over a person's.
function householdFields(place, hh, span, photoUrl) {
  const m = hh.money;
  return {
    key: place.household_id, kind: "household", householdId: place.household_id, name: hh.name || "Household",
    people: m.people.map(p => ({ id: p.id, name: p.name, photoUrl: photoUrl(p.photo_asset_id), wealthScore: p.wealthScore })),
    lifetimeCents: m.lifetimeCents, thisYearCents: m.spanCents,
    lifetimeSource: { key: "household-giving", params: { household: place.household_id } },
    thisYearSource: { key: "household-span", params: { household: place.household_id, from: span.from, to: span.to } },
    lastGift: m.lastGift ? { date: m.lastGift.date, cents: m.lastGift.cents, donorId: m.lastGift.donorId,
      who: (m.people.find(p => p.id === m.lastGift.donorId) || {}).name || "" } : null,
    lastGiftSource: m.lastGift ? { key: "donor-last-gift", params: { donor: m.lastGift.donorId } } : null,
    wealthScore: m.capacity, wealthWord: m.people.length > 1 ? "household" : null,
  };
}

// The households of the people in `donorIds`: Map donorId -> { householdId, name,
// placed } (placed: the household already holds a place on this list).
async function householdPlacesFor(query, orgId, listId, donorIds) {
  if (!donorIds.length) return new Map();
  const rows = await query(
    `SELECT d.id, d.household_id, h.name, (m.id IS NOT NULL) AS placed FROM donors d
       JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
       LEFT JOIN portfolio_members m ON m.org_id = d.org_id AND m.list_id = ? AND m.household_id = d.household_id
      WHERE d.org_id = ? AND d.id = ANY(?::text[]) AND d.deleted_at IS NULL`, [listId, orgId, donorIds]);
  return new Map(rows.map(r => [r.id, { householdId: r.household_id, name: r.name, placed: r.placed === true }]));
}

const { photoUrlFor } = require("../donors/householdDetail");   // a person's signed photo URL

const SENTENCES = Object.freeze({
  household: "A household holds one place: its people's giving added together, each gift still on the person who gave it. Owner, stage, ask and plan are its lead person's.",
  thisYear: "What they gave this fiscal year so far, refunds taken off.",
  wealthHousehold: HG.WORDS.capacity,
});

module.exports = { photoUrlFor, placesOf, householdsOf, householdFields, householdPlacesFor, SENTENCES };
