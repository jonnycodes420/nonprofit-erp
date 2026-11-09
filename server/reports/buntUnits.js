// server/reports/buntUnits.js · INTEGRITY-1 (W-1107-Fundraising-06X). A
// HOUSEHOLD IS REPORTED ONCE IN A RETENTION REPORT.
//
// LYBUNT and SYBUNT listed "Prudence Ashford" and "Henry and Prudence Ashford"
// as two rows with the same amounts. The rule (Bloomerang, NPSP household
// accounts, LGL): a household is one call to make and is reported once, under
// the household. The report keeps `rows` (one per person: the truth check
// foots them) and adds `units`, one per giving unit, which the screen lists. A
// unit's money is its people's, added once each, so the units foot to the same
// total as the rows.
//
// TRUTH-5 (W-1108-Fundraising-07): a person who GIVES THROUGH an organisation
// (an Owner or Works at link) is not in its unit. INTEGRITY-1 folded Louisa
// Eastbrook into Marlowe Charitable Trust's row ($3,846 against her profile's
// $2,659): an affiliation is not a household. The unit is the household
// (donors.household_id, or the household whose primary record they are), else
// a spouse, partner or "same household" link (shared/numbers/households.js
// UNIT_LINK_TYPES). An Owner / Works at link is said beside the row, "also
// connected", with that person's own amount, on their own row.
"use strict";
const { UNIT_LINK_TYPES, CONNECTED_LINK_TYPES, CONNECTED_WORD } = require("../../shared/numbers/households");

async function buntUnits(query, orgId, rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [people, links] = await Promise.all([
    query(`SELECT d.id, COALESCE(d.household_id, hp.id) AS household_id, COALESCE(h.name, hp.name) AS household_name FROM donors d
             LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
             LEFT JOIN households hp ON d.household_id IS NULL AND hp.primary_donor_id = d.id AND hp.org_id = d.org_id
            WHERE d.org_id = ? AND d.id = ANY(?)`, [orgId, ids]),
    query(`SELECT r.donor_id_a AS a, r.donor_id_b AS b, r.relationship_type AS type FROM donor_relationships r
            WHERE r.org_id = ? AND r.relationship_type = ANY(?) AND (r.donor_id_a = ANY(?) OR r.donor_id_b = ANY(?))`,
      [orgId, [...UNIT_LINK_TYPES, ...CONNECTED_LINK_TYPES], ids, ids]),
  ]);
  const hh = new Map(people.map(p => [p.id, p]));
  // union-find over the rows: household first, then the links that make one unit
  const parent = new Map(ids.map(id => [id, id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const join = (x, y) => { if (!parent.has(x) || !parent.has(y)) return; const a = find(x), b = find(y); if (a !== b) parent.set(a < b ? b : a, a < b ? a : b); };
  const byHousehold = new Map();
  for (const id of ids) { const p = hh.get(id); if (p && p.household_id) { if (byHousehold.has(p.household_id)) join(byHousehold.get(p.household_id), id); else byHousehold.set(p.household_id, id); } }
  for (const l of links) if (UNIT_LINK_TYPES.includes(l.type)) join(l.a, l.b);
  const byId = new Map(rows.map(r => [r.id, r]));
  const units = new Map();
  for (const r of rows) {
    const root = find(r.id);
    if (!units.has(root)) units.set(root, []);
    units.get(root).push(r);
  }
  const out = [];
  for (const [, members] of units) {
    const hhName = members.map(m => hh.get(m.id)).find(x => x && x.household_name);
    const lead = [...members].sort((a, b) => b.priorYearTotal - a.priorYearTotal || String(a.id).localeCompare(String(b.id)))[0];
    const name = members.length === 1 ? lead.name : hhName ? hhName.household_name : members.map(m => m.name).join(" and ");
    const mine = new Set(members.map(m => m.id));
    // Also connected: an Owner / Works at link to someone else on this list, their own amount, on their own row.
    const connected = [];
    for (const l of links) {
      if (!CONNECTED_LINK_TYPES.includes(l.type)) continue;
      const other = mine.has(l.a) && !mine.has(l.b) ? l.b : mine.has(l.b) && !mine.has(l.a) ? l.a : null;
      const o = other && byId.get(other);
      if (o && !connected.some(c => c.id === o.id)) connected.push({ id: o.id, name: o.name, how: CONNECTED_WORD[l.type], priorYearTotal: o.priorYearTotal });
    }
    out.push({
      id: lead.id, name, unit: members.length === 1 ? null : "household", members: members.length > 1 ? members.map(m => ({ id: m.id, name: m.name })) : null,
      connected: connected.length ? connected : null,
      email: lead.email, assignedTo: lead.assignedTo,
      priorYearTotal: Math.round(members.reduce((s, m) => s + Math.round(m.priorYearTotal * 100), 0)) / 100,
      lifetimeGiving: Math.round(members.reduce((s, m) => s + Math.round(m.lifetimeGiving * 100), 0)) / 100,
      lastGiftDate: members.map(m => m.lastGiftDate).filter(Boolean).sort().pop() || null,
      lastGiftAmount: lead.lastGiftAmount, lastYear: lead.lastYear,
    });
  }
  return out.sort((a, b) => b.lifetimeGiving - a.lifetimeGiving || String(a.id).localeCompare(String(b.id)));
}

module.exports = { buntUnits };
