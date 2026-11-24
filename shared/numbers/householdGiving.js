// shared/numbers/householdGiving.js · HOUSEHOLD-1. A HOUSEHOLD'S MONEY, ONE ROW.
//
// A pilot customer (24 Nov) merged couples to see them as one line on her Top
// 100, and lost one person's email, phone and photo each time. A household is
// already one giving unit (households.js UNIT); this module is its money as a
// row, derived at read time from each person's own gifts and never stored
// (people-and-records.md: never move hard credit).
//
//   lifetime   each live person's Lifetime (donors.total_giving, the profile's
//              figure), added in cents: the `household-giving` source, the
//              household panel's Combined giving, the same number
//   this year  each live person's gifts in the org's fiscal year to date, the
//              span rule (givingBetween.IN_SPAN): credits off, refunds off
//   last gift  the latest of the people's last gifts (lastGift.js), with whose
//   capacity   the higher Wealth Score of the people (WEALTH-1), "household"
//
// One query per measure over every household asked for: never one per row.
"use strict";
const { IN_SPAN } = require("./givingBetween");
const { lastGifts } = require("./lastGift");
const { PERSON } = require("./households");

// The live people of these households: id, household, name, contact, score.
async function peopleOf(query, orgId, householdIds) {
  if (!householdIds || !householdIds.length) return [];
  return query(
    `SELECT d.id, d.household_id, d.name, d.email, d.phone, d.photo_asset_id, d.wealth_rating,
            ROUND(COALESCE(d.total_giving, 0) * 100)::bigint AS lifetime_cents
       FROM donors d
      WHERE d.org_id = ? AND d.household_id = ANY(?::text[]) AND ${PERSON("d")}
      ORDER BY d.household_id, d.total_giving DESC NULLS LAST, d.id`, [orgId, householdIds]);
}

// Each person's gifts from `from` to `to` in cents (the span rule): Map id -> cents.
async function spanCentsByPerson(query, orgId, ids, { from, to }) {
  if (!ids.length || !from || !to || to < from) return new Map();
  const rows = await query(
    `SELECT g.donor_id, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents
       FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND ${IN_SPAN("g")}
      GROUP BY g.donor_id`, [orgId, ids, from, to]);
  return new Map(rows.map(r => [r.donor_id, Number(r.cents)]));
}

// Every household asked for, as one row's money: Map householdId -> {
//   people: [{ id, name, email, phone, photo_asset_id, wealthScore, lifetimeCents, spanCents }],
//   lifetimeCents, spanCents, lastGift: { date, cents, donorId } | null, capacity: n | null }
async function householdMoney(query, orgId, householdIds, span) {
  const people = await peopleOf(query, orgId, householdIds);
  const ids = people.map(p => p.id);
  const [spans, lasts] = await Promise.all([spanCentsByPerson(query, orgId, ids, span || {}), lastGifts(query, orgId, ids)]);
  const out = new Map((householdIds || []).map(h => [h, { people: [], lifetimeCents: 0, spanCents: 0, lastGift: null, capacity: null }]));
  for (const p of people) {
    const h = out.get(p.household_id);
    if (!h) continue;
    const person = { id: p.id, name: p.name, email: p.email || null, phone: p.phone || null, photo_asset_id: p.photo_asset_id || null,
      wealthScore: p.wealth_rating == null ? null : Number(p.wealth_rating), lifetimeCents: Number(p.lifetime_cents) || 0, spanCents: spans.get(p.id) || 0 };
    h.people.push(person);
    h.lifetimeCents += person.lifetimeCents;
    h.spanCents += person.spanCents;
    const lg = lasts.get(p.id);
    if (lg && (!h.lastGift || lg.date > h.lastGift.date || (lg.date === h.lastGift.date && lg.cents > h.lastGift.cents))) h.lastGift = { ...lg, donorId: p.id };
    if (person.wealthScore != null && (h.capacity == null || person.wealthScore > h.capacity)) h.capacity = person.wealthScore;
  }
  return out;
}

// The rows behind a household's span figure (the `household-span` source):
// each gift by any live person in it, the span rule, so the rows foot to
// householdMoney's spanCents to the cent.
function spanRowsSql(orgId, householdId, from, to) {
  return {
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount,
                 COALESCE(NULLIF(g.payment_method, ''), INITCAP(NULLIF(g.type, ''))) AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
           WHERE g.org_id = ? AND d.household_id = ? AND ${PERSON("d")} AND ${IN_SPAN("g")}`,
    args: [orgId, householdId, from, to],
    order: "date DESC NULLS LAST, id",
  };
}

// HOUSEHOLD-1 item 3 · the household's giving by fiscal year, newest first:
// each live person's dated gifts (the money rule, as the span) put in the year
// that holds their day. Each year is { label, from, to, cents }, and `to` is
// never past the org's today, so each year opens `household-span` and foots.
async function byYear(query, orgId, householdId, org, today) {
  const FY = require("./fiscalYear");
  const { MONEY } = require("./money");
  const rows = await query(
    `SELECT LEFT(g.date::text, 10) AS day, ROUND(g.amount * 100)::bigint AS cents
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.household_id = ? AND ${PERSON("d")} AND ${MONEY("g")} AND g.date IS NOT NULL`, [orgId, householdId]);
  const sm = FY.startMonth(org);
  const years = new Map();
  for (const r of rows) {
    if (!r.day || r.day > today) continue;
    const y = FY.startYearOf(r.day, sm);
    if (y == null) continue;
    years.set(y, (years.get(y) || 0) + Number(r.cents));
  }
  return [...years.entries()].sort((a, b) => b[0] - a[0]).map(([y, c]) => {
    const fy = FY.yearStarting(y, sm);
    return { label: fy.label, from: fy.start, to: fy.end < today ? fy.end : today, cents: c };
  });
}

// "Debbie and Jeff Vogel": the addressee line a mailing prints for a household's
// people (first names joined, one shared last name when they share it).
function addresseeOf(names) {
  const list = (names || []).map(n => String(n || "").trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  const parts = list.map(n => { const w = n.split(/\s+/); return { first: w.length > 1 ? w.slice(0, -1).join(" ") : w[0], last: w.length > 1 ? w[w.length - 1] : "" }; });
  const sameLast = parts.every(p => p.last && p.last.toLowerCase() === parts[0].last.toLowerCase());
  const join = xs => xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  return sameLast ? `${join(parts.map(p => p.first))} ${parts[0].last}` : join(list);
}

// SQL: a giving unit's Lifetime for sorting a list (`u` has household_id and
// unit, the person's id when on their own): the household's people added, or
// the person's own. The same Lifetime householdMoney adds in cents.
const UNIT_LIFETIME = (u = "u") => `CASE WHEN ${u}.household_id IS NULL
    THEN (SELECT COALESCE(x.total_giving, 0) FROM donors x WHERE x.id = ${u}.unit)
    ELSE (SELECT COALESCE(SUM(COALESCE(x.total_giving, 0)), 0) FROM donors x
           WHERE x.household_id = ${u}.household_id AND ${PERSON("x")}) END`;

const WORDS = Object.freeze({
  lifetime: "Everything the people in this household have given, each person's Lifetime added together. Nothing is moved between them; each gift stays on the person who gave it.",
  span: "What the people in this household gave this fiscal year so far, added together. Refunds come off; soft credits are not money.",
  capacity: "The higher Wealth Score of the people in this household.",
});

module.exports = { UNIT_LIFETIME, byYear, peopleOf, spanCentsByPerson, householdMoney, spanRowsSql, addresseeOf, WORDS };
