// shared/numbers/draftFigures.js · TRUTH-2. THE FIGURES A DRAFT TO A DONOR STATES.
//
// A draft (a milestone thank-you, a note's talking points, a quiet check-in,
// a merge field) states a person's money in words a donor reads. Every such
// figure is read HERE, from the one rule for it, when the draft is made:
//   lifetime   lifetime.js LIFETIME (the imported total plus every money row
//              after it), never the stored donors.total_giving, which an old
//              seed, an import or a missed recompute can leave behind
//   lastGift   lastGift.js lastGifts (the latest dated gift above zero)
//   thisYear   givingBetween.js over the org's fiscal year to date
// The Walk A evening run (5 Nov) read "$12,500" in a draft for a person whose
// lifetime was $21,000: the figure came from a stored column and literal text.
"use strict";
const { LIFETIME } = require("./lifetime");
const { lastGifts } = require("./lastGift");
const { givingBetween } = require("./givingBetween");
const { GIFT } = require("./money");

// { lifetimeCents, lifetime, lastGift: { date, cents, amount } | null,
//   thisYearCents, thisYear, giftCount } for one person, or null when the
// person is not in the org. `fy` ({ from, to, today }) is the fiscal year to
// date; without it, thisYear is not read (0).
async function draftFigures(query, orgId, donorId, fy = null) {
  if (!donorId) return null;
  const [r] = await query(
    `SELECT ROUND(${LIFETIME("d")} * 100)::bigint AS cents,
            (SELECT COUNT(*)::int FROM gifts lg WHERE lg.org_id = d.org_id AND lg.donor_id = d.id AND ${GIFT("lg")}) AS n
       FROM donors d WHERE d.org_id = ? AND d.id = ?`, [orgId, donorId]);
  if (!r) return null;
  const last = (await lastGifts(query, orgId, [donorId])).get(donorId) || null;
  const year = fy && fy.from ? await givingBetween(query, orgId, { ...fy, donorId }) : { cents: 0 };
  const lifetimeCents = Number(r.cents) || 0;
  return {
    lifetimeCents, lifetime: lifetimeCents / 100,
    lastGift: last ? { ...last, amount: last.cents / 100 } : null,
    thisYearCents: year.cents, thisYear: year.cents / 100,
    giftCount: Number(r.n) || 0,
  };
}

// "$21,000" / "$1,050.50": the way a draft writes a figure.
const dollars = v => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });

module.exports = { draftFigures, dollars };
