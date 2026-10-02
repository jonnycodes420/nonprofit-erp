// appealWhy.js — ENGAGE-1 §4, APPEAL-WHY. "How did it do?" for a campaign,
// against the comparable campaign a year earlier.
//
// ONE GIFT SET PER CAMPAIGN. A campaign's gifts are the gifts attributed to it
// by id, or (for older rows with no id) by its name: the same rule the goal
// bar's "raised" uses (figureSources.js goal-raised). Every number on the view
// and every row it opens is computed from `campaignGifts` below, so a number
// cannot disagree with its rows.

const { query } = require("./db");

const cents = v => Math.round(Number(v || 0) * 100);

async function campaignRow(orgId, id) {
  const [c] = await query(
    `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, goal_amount, compare_campaign_id
       FROM campaigns WHERE org_id = ? AND id = ?`, [orgId, id]);
  return c || null;
}

// Every gift of one campaign, positive or negative (a refund comes off).
async function campaignGifts(orgId, c) {
  const rows = await query(
    `SELECT g.id, g.donor_id, d.name, LEFT(g.date, 10) AS date, g.amount::text AS amount
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL
        AND (g.campaign_id = ? OR (g.campaign_id IS NULL AND g.campaign = ?))
      ORDER BY g.date DESC, g.id`, [orgId, c.id, c.name]);
  return rows.map(r => ({ ...r, cents: cents(r.amount) }));
}

// The campaign a year earlier. The user's choice wins; otherwise the same name
// with its year one lower ("Spring Appeal 2026" -> "Spring Appeal 2025"), or
// the same name without a year that started about a year earlier.
const stripYear = n => String(n || "").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();
async function comparableFor(orgId, c) {
  const all = await query(
    `SELECT id, name, start_date::text AS start_date FROM campaigns WHERE org_id = ? AND id <> ? ORDER BY start_date DESC NULLS LAST, name`,
    [orgId, c.id]);
  let chosen = null, how = null;
  if (c.compare_campaign_id) { chosen = all.find(x => x.id === c.compare_campaign_id) || null; how = chosen ? "chosen" : null; }
  if (!chosen) {
    const want = String(c.name || "").replace(/\b((?:19|20)\d{2})\b/, y => String(Number(y) - 1)).toLowerCase();
    chosen = want !== String(c.name || "").toLowerCase() ? all.find(x => String(x.name).toLowerCase() === want) || null : null;
    if (chosen) how = "name";
  }
  if (!chosen && c.start_date) {
    const target = Date.parse(c.start_date) - 365 * 86400000;
    chosen = all.find(x => stripYear(x.name) === stripYear(c.name) && x.start_date
      && Math.abs(Date.parse(x.start_date) - target) < 120 * 86400000) || null;
    if (chosen) how = "name";
  }
  return { compare: chosen, how, candidates: all.map(x => ({ id: x.id, name: x.name, startDate: x.start_date })) };
}

function byDonor(gifts) {
  const m = new Map();
  for (const g of gifts) {
    const x = m.get(g.donor_id) || { donorId: g.donor_id, name: g.name, cents: 0, gifts: 0, lastDate: null };
    x.cents += g.cents; x.gifts++; if (!x.lastDate || g.date > x.lastDate) x.lastDate = g.date;
    m.set(g.donor_id, x);
  }
  return m;
}

// The rows behind each part, as figure rows (id, type, donor_id, name, date,
// amount in dollars, detail). `this`/`last` are gifts; the four reasons are
// one row per person.
async function parts(orgId, campaignId, compareId) {
  const c = await campaignRow(orgId, campaignId), p = compareId ? await campaignRow(orgId, compareId) : null;
  if (!c) return null;
  const tg = await campaignGifts(orgId, c), lg = p ? await campaignGifts(orgId, p) : [];
  const T = byDonor(tg), L = byDonor(lg);
  const scores = new Map((await query(`SELECT donor_id, engagement, last_touch FROM donor_scores WHERE org_id = ?`, [orgId]))
    .map(r => [r.donor_id, r]));
  // NEW means new to the ORGANISATION through this campaign: no gift to the
  // org before their first gift here.
  const firstHere = new Map();
  for (const g of tg) if (!firstHere.has(g.donor_id) || g.date < firstHere.get(g.donor_id)) firstHere.set(g.donor_id, g.date);
  const ids = [...firstHere.keys()];
  const earlier = ids.length ? new Set((await query(
    `SELECT DISTINCT g.donor_id FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?)
        AND NOT (COALESCE(g.campaign_id, '') = ? OR (g.campaign_id IS NULL AND COALESCE(g.campaign, '') = ?))
        AND LEFT(g.date, 10) < (SELECT MIN(LEFT(h.date, 10)) FROM gifts h WHERE h.org_id = g.org_id AND h.donor_id = g.donor_id
                                  AND (h.campaign_id = ? OR (h.campaign_id IS NULL AND h.campaign = ?)))`,
    [orgId, ids, c.id, c.name, c.id, c.name])).map(r => r.donor_id)) : new Set();

  const giftRow = (g, detail) => ({ id: g.id, type: "gift", donor_id: g.donor_id, name: g.name, date: g.date, amount: g.cents / 100, detail });
  const person = (x, amountCents, detail) => ({ id: x.donorId, type: "donor", donor_id: x.donorId, name: x.name,
    date: (scores.get(x.donorId) || {}).last_touch || x.lastDate, amount: amountCents / 100, detail });

  const notYet = [...L.values()].filter(x => !T.has(x.donorId)).map(x => {
    const s = scores.get(x.donorId) || {};
    return { ...person(x, x.cents, `Gave ${fmt(x.cents)} last time${s.last_touch ? `, last touch ${s.last_touch}` : ", no touch on file"}`), engagement: s.engagement || 0, lastCents: x.cents };
  });
  const both = [...T.values()].filter(x => L.has(x.donorId));
  const less = both.filter(x => x.cents < L.get(x.donorId).cents)
    .map(x => person(x, x.cents - L.get(x.donorId).cents, `${fmt(x.cents)} this time, ${fmt(L.get(x.donorId).cents)} last time`));
  const more = both.filter(x => x.cents > L.get(x.donorId).cents)
    .map(x => person(x, x.cents - L.get(x.donorId).cents, `${fmt(x.cents)} this time, ${fmt(L.get(x.donorId).cents)} last time`));
  const newcomers = [...T.values()].filter(x => !L.has(x.donorId) && !earlier.has(x.donorId))
    .map(x => person(x, x.cents, "Their first gift to the organisation"));
  const returning = both.map(x => person(x, x.cents, `Gave last time too`));
  return {
    c, p,
    this: tg.map(g => giftRow(g, c.name)), last: lg.map(g => giftRow(g, p ? p.name : "")),
    notYet: notYet.sort((a, b) => b.lastCents - a.lastCents || b.engagement - a.engagement),
    less: less.sort((a, b) => a.amount - b.amount), more: more.sort((a, b) => b.amount - a.amount),
    newcomers: newcomers.sort((a, b) => b.amount - a.amount), returning,
    donorsThis: [...T.values()].map(x => person(x, x.cents, `${x.gifts} gift${x.gifts === 1 ? "" : "s"}`)),
    donorsLast: [...L.values()].map(x => person(x, x.cents, `${x.gifts} gift${x.gifts === 1 ? "" : "s"}`)),
    avgThis: tg.map(g => giftRow(g, c.name)), avgLast: lg.map(g => giftRow(g, p ? p.name : "")),
  };
}
function fmt(c) { return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); }

const sumC = rows => rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
function summary(gifts) {
  const donors = new Set(gifts.map(g => g.donor_id)).size;
  const total = sumC(gifts);
  // Whole dollars, as the figure engine's average is.
  return { totalCents: total, donors, gifts: gifts.length, averageCents: gifts.length ? Math.round(total / gifts.length / 100) * 100 : 0 };
}

module.exports = { campaignRow, campaignGifts, comparableFor, parts, summary, sumC };
