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

const { CAMPAIGN_GIFT_MATCH, PUBLIC_BAR_GRANTS, inWindow, campaignWindowRefusal } = require("./campaignMatch");

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
  // NUMBERS-2: the imported total, its source and the last day it covers.
  const [imp] = await query(
    `SELECT imported_total::text AS t, imported_through, imported_source, imported_on FROM donors
      WHERE org_id = ? AND id = ? AND imported_total IS NOT NULL`, [orgId, donorId]);
  const out = Object.fromEntries(figs);
  const lifetimeCents = lifetime.totalRows ? lifetime.cents : null;
  Object.assign(out.average, {
    refunds: r.refunds,
    refundCents: -(money.toCents(String(r.refunded)) ?? 0),
    importedCents: imp ? (money.toCents(imp.t) ?? 0) : 0,
  });
  out.imported = imp ? { cents: money.toCents(imp.t) ?? 0, through: imp.imported_through, source: imp.imported_source || "your old system",
                         on: imp.imported_on || null, words: importedWords(imp) } : null;
  return out;
}

// "Includes $50,000 from your old system (before Mar 2025)": the line under
// Lifetime. "Before <month>" when the covered days end on a month's last day,
// "up to <day>" otherwise, so it never claims days it does not cover.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function importedWords(imp) {
  const cents = money.toCents(String(imp.t ?? imp.cents ?? "0")) ?? 0;
  const t = String(imp.imported_through || imp.through || "").slice(0, 10);
  let when = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    when = d === last ? ` (before ${MON[m % 12]} ${m === 12 ? y + 1 : y})` : ` (up to ${d} ${MON[m - 1]} ${y})`;
  }
  return `Includes ${money.formatCentsPlain(cents)} from your old system${when}`;
}

// Raised and donors per goal'd campaign: gift payments at the full amount the
// donor paid (FIX-49: a covered fee is part of the gift), counted by CAMPAIGN_GIFT_MATCH. Fundraising's cards, the overview's
// roll-up and the checker all read this one query. Rows: { cid, raised, donor_count }.
function campaignGiftTotals(query, orgId) {
  return query(
    `SELECT c.id AS cid,
            COALESCE(SUM(g.amount), 0) AS raised,
            COUNT(DISTINCT g.donor_id) AS donor_count
       FROM campaigns c
       LEFT JOIN gifts g ON g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
      WHERE c.org_id = ? AND c.goal_amount IS NOT NULL AND c.goal_amount > 0
      GROUP BY c.id`, [orgId]);
}

// FIX-49 · A PARENT GOAL'S RAISED: the gifts given to it directly plus the
// gifts given to its child goals, each gift once however many of those
// campaigns it matches (Jonathan, 25 Oct). Rows: { pid, raised } for every
// goal'd campaign that has a goal'd child. Grants are added by the caller:
// each grant names one campaign, so they cannot overlap.
// Each gift is matched to its campaigns ONCE, then paired with that campaign
// and with the campaign's parent; UNION keeps one (parent, gift) pair, so a
// gift matching the parent and a child counts once. (The first version asked
// "is this gift in the set?" per gift per parent, and took 74 seconds on the
// demo; this takes as long as campaignGiftTotals.)
function goalRollupGiftTotals(query, orgId) {
  return query(
    `WITH matched AS MATERIALIZED (
            SELECT c.id AS cid, c.parent_goal_id AS parent, g.id AS gid, g.amount
              FROM campaigns c JOIN gifts g ON g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
             WHERE c.org_id = ? AND c.goal_amount > 0),
          pairs AS (
            SELECT cid AS pid, gid, amount FROM matched
            UNION
            SELECT parent AS pid, gid, amount FROM matched WHERE parent IS NOT NULL)
     SELECT p.id AS pid, COALESCE(SUM(x.amount), 0) AS raised
       FROM campaigns p
       LEFT JOIN pairs x ON x.pid = p.id
      WHERE p.org_id = ? AND p.goal_amount > 0
        AND EXISTS (SELECT 1 FROM campaigns k WHERE k.org_id = p.org_id AND k.parent_goal_id = p.id AND k.goal_amount > 0)
      GROUP BY p.id`, [orgId, orgId]);
}

// FIX-49 · WHAT A CAMPAIGN'S PUBLIC BAR SAYS: its gifts (CAMPAIGN_GIFT_MATCH)
// plus its awarded grants, unless "Leave grants off the public bar" is on.
// The giving page's bar and the checker read this one function.
async function publicBarRaised(query, orgId, campaignId) {
  const [r] = await query(
    `SELECT COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}), 0)
            + ${PUBLIC_BAR_GRANTS("c")} AS raised
       FROM campaigns c WHERE c.org_id = ? AND c.id = ?`, [orgId, campaignId]);
  return r ? Number(r.raised) || 0 : null;
}

// The screens that live inside a route file register here when the server
// mounts them, so the checker running in the server reads the very function a
// screen draws (scripts/check-numbers.js). Empty in a bare script.
const screens = {};

module.exports = { importedWords, CAMPAIGN_GIFT_MATCH, inWindow, campaignWindowRefusal, donorGlance, campaignGiftTotals, goalRollupGiftTotals, publicBarRaised, screens };
