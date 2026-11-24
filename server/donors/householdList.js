// server/donors/householdList.js · HOUSEHOLD-1 item 2. THE DONORS LIST, HOUSEHOLDS TOGETHER.
//
// "Show households together" (remembered per person, off by default) turns the
// list into giving units: a household is one row, with its people's giving
// added, that opens to its people; anyone not in a household is their own row.
// It is the same list (LIST-6's one engine): the same filter, the same WHERE,
// the same order; only the page is cut by unit instead of by person.
//
//   the order  a household sits where its first matching person would, or,
//              sorted by giving, where its combined Lifetime ranks it
//   the page   `limit` units; every matching person of those units comes back
//              as an ordinary row, so each person's cells, drift and photo are
//              the list's own
//   the counts households and people, separately (NUMBERS-4's words)
"use strict";
const { READS_COLUMN } = require("./listPage");
const HG = require("../../shared/numbers/householdGiving");
const HN = require("../../shared/numbers/households");
const FY = require("../../shared/numbers/fiscalYear");

const GIVING_SORTS = new Set(["", "total_giving", "lifetime"]);

// The units on this page, in order: [{ unit, household_id, matched }].
async function unitPage(query, f, { sort, dir, limit, offset }) {
  const reads = READS_COLUMN.test(f.orderBy) || (f.orderArgs || []).length;
  const inner = reads ? `SELECT donors.*${f.selectCols} FROM donors WHERE ${f.whereSql}` : `SELECT donors.* FROM donors WHERE ${f.whereSql}`;
  const innerArgs = reads ? [...f.selectArgs, ...f.params] : f.params;
  const byGiving = GIVING_SORTS.has(String(sort || ""));
  const d = String(dir || "desc") === "asc" ? "ASC" : "DESC";
  const rows = await query(
    `SELECT u.unit, u.household_id, u.matched FROM (
        SELECT ${HN.UNIT("r")} AS unit, MAX(r.household_id) AS household_id, MIN(r.rn) AS first_rn, COUNT(*)::int AS matched
          FROM (SELECT donors.id, donors.household_id, ROW_NUMBER() OVER (ORDER BY ${f.orderBy}) AS rn FROM (${inner}) donors) r
         GROUP BY 1) u
      ORDER BY ${byGiving ? `${HG.UNIT_LIFETIME("u")} ${d}, u.first_rn` : "u.first_rn"} LIMIT ? OFFSET ?`,
    [...(f.orderArgs || []), ...innerArgs, limit, offset]);
  return rows;
}

// The page's people: every matching person of those units, as list rows.
function memberWhere(f, units) {
  return { whereSql: `${f.whereSql} AND ${HN.UNIT("donors")} = ANY(?::text[])`, params: [...f.params, units.map(u => u.unit)] };
}

// The units as the screen draws them, in order. A household carries its name,
// its people (matching ones first) and its money; a person is just their id.
async function unitsOut(query, orgId, units, donors, photoUrl, org) {
  const hhIds = units.filter(u => u.household_id).map(u => u.household_id);
  const span = FY.fiscalYearToDate(org || {});
  const [money, names] = await Promise.all([
    HG.householdMoney(query, orgId, hhIds, span),
    hhIds.length ? query("SELECT id, name FROM households WHERE org_id = ? AND id = ANY(?::text[])", [orgId, hhIds]) : [],
  ]);
  const nameOf = new Map(names.map(h => [h.id, h.name]));
  const order = new Map(donors.map((d, i) => [d.id, i]));
  return units.map(u => {
    if (!u.household_id) return { key: u.unit, kind: "person", donorId: u.unit };
    const m = money.get(u.household_id) || { people: [], lifetimeCents: 0, spanCents: 0, lastGift: null, capacity: null };
    const matched = donors.filter(d => d.household_id === u.household_id).map(d => d.id).sort((a, b) => order.get(a) - order.get(b));
    return {
      key: u.household_id, kind: "household", householdId: u.household_id, name: nameOf.get(u.household_id) || "Household",
      memberIds: matched, otherPeople: m.people.filter(p => !matched.includes(p.id)).map(p => ({ id: p.id, name: p.name })),
      people: m.people.map(p => ({ id: p.id, name: p.name, photoUrl: photoUrl(p.photo_asset_id) })),
      lifetimeCents: m.lifetimeCents, thisYearCents: m.spanCents, capacity: m.capacity,
      lifetimeSource: { key: "household-giving", params: { household: u.household_id } },
      thisYearSource: { key: "household-span", params: { household: u.household_id, from: span.from, to: span.to } },
      lastGift: m.lastGift,
    };
  });
}

const counts = (query, f) => HN.countsWhere(query, f.whereSql, f.params);

const SENTENCE = "Households together: a household is one row, its people's giving added; open it to see each person with their own details.";

module.exports = { unitPage, memberWhere, unitsOut, counts, SENTENCE };
