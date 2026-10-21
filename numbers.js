// NUMBERS-1 · ONE WAY TO COMPUTE EACH NUMBER.
//
// Jonathan added a $25,000 gift to Margaret Chen on prod (21 Oct). Lifetime,
// This year and Last gift moved; Average still said $14,423.08 "of 13 gifts"
// and Largest $15,000, because the header drew those three from a SECOND read
// (GET /donors/:id/status) that not every door refreshes. And the gift counted
// toward GivingTuesday 2026, a campaign that had not started, because no
// campaign total looked at the campaign's dates.
//
// So the rules live here, once:
//   · donorGlance: First, Largest and Average for one person, the same figure
//     sources the drawers open. GET /donors/:id carries them beside Lifetime,
//     so every tile in the header comes from one read and one refresh.
//   · CAMPAIGN_GIFT_MATCH: which gifts count toward a campaign. Attributed by
//     campaign_id (or the legacy name), from a person who is not deleted, and
//     dated inside the campaign's own start and end. A gift dated outside the
//     window keeps its attribution on the row and counts toward nothing.
//   · campaignWindowRefusal: the sentence a write gets when it tries to credit
//     a campaign with a gift dated outside the window.
const FS = require("./figureSources");
const money = require("./money");

const { CAMPAIGN_GIFT_MATCH, inWindow, campaignWindowRefusal } = require("./campaignMatch");

// First, Largest and Average for one person: each is the figure source its
// drawer opens, so the tile and the rows are one computation. The average also
// says what it leaves out (refunds, an imported total) from the same gifts.
const GLANCE = [
  ["first", "donor-first-gift"],
  ["largest", "donor-largest-gift"],
  ["average", "donor-average-gift"],
];
async function donorGlance(query, orgId, donorId) {
  const src = k => ({ key: k, params: { donor: donorId } });
  const [figs, [r], lifetime] = await Promise.all([
    Promise.all(GLANCE.map(async ([name, key]) => {
      const f = await FS.figure(orgId, src(key), {}, { pageSize: 1 });
      const count = f.measure === "per_gift" ? f.giftCount : f.totalRows;
      return [name, { source: src(key), label: f.label, sentence: f.sentence, value: count ? f.value : null,
        cents: count ? f.cents : null, date: f.rows[0] ? f.rows[0].date : null, count }];
    })),
    query(
      `SELECT (COUNT(*) FILTER (WHERE g.amount < 0))::int AS refunds,
              COALESCE(SUM(g.amount) FILTER (WHERE g.amount < 0), 0)::text AS refunded,
              COALESCE(SUM(g.amount), 0)::text AS itemized
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND g.donor_id = ? AND d.deleted_at IS NULL`, [orgId, donorId]),
    FS.figureValue(orgId, src("donor-lifetime"), {}),
  ]);
  const out = Object.fromEntries(figs);
  const lifetimeCents = lifetime.totalRows ? lifetime.cents : null;
  Object.assign(out.average, {
    refunds: r.refunds,
    refundCents: -(money.toCents(String(r.refunded)) ?? 0),
    importedCents: lifetimeCents != null ? Math.max(0, lifetimeCents - (money.toCents(String(r.itemized)) ?? 0)) : 0,
  });
  return out;
}

// Raised and donors per goal'd campaign: gift payments net of a fee the donor
// covered, counted by CAMPAIGN_GIFT_MATCH. Fundraising's cards, the overview's
// roll-up and the checker all read this one query. Rows: { cid, raised, donor_count }.
function campaignGiftTotals(query, orgId) {
  return query(
    `SELECT c.id AS cid,
            COALESCE(SUM(g.amount - COALESCE(g.cover_fee_amount, 0)), 0) AS raised,
            COUNT(DISTINCT g.donor_id) AS donor_count
       FROM campaigns c
       LEFT JOIN gifts g ON g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
      WHERE c.org_id = ? AND c.goal_amount IS NOT NULL AND c.goal_amount > 0
      GROUP BY c.id`, [orgId]);
}

// The screens that live inside a route file register here when the server
// mounts them, so the checker running in the server reads the very function a
// screen draws (scripts/check-numbers.js). Empty in a bare script.
const screens = {};

module.exports = { CAMPAIGN_GIFT_MATCH, inWindow, campaignWindowRefusal, donorGlance, campaignGiftTotals, screens };
