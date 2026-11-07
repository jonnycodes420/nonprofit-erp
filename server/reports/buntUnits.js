// server/reports/buntUnits.js · INTEGRITY-1 (W-1107-Fundraising-06X). A
// HOUSEHOLD IS REPORTED ONCE IN A RETENTION REPORT.
//
// LYBUNT and SYBUNT listed "Prudence Ashford" and "Henry and Prudence Ashford"
// as two rows with the same amounts. The rule (Bloomerang, NPSP household
// accounts, LGL): a household, or a person who gives through an organisation,
// is one call to make and is reported once, under the household (or the
// organisation). The report keeps `rows` (one per person: its header counts
// people, and the truth check foots them) and adds `units`, one per giving
// unit, which the screen lists. A unit's money is its people's, added once
// each, so the units foot to the same total as the rows.
//
// The unit: the person's household (donors.household_id), else the
// organisation they give through (an `owner` link), else a spouse or partner
// link (the two as one, shared/numbers/lapse.js's giving unit).
"use strict";

async function buntUnits(query, orgId, rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [people, links] = await Promise.all([
    query(`SELECT d.id, d.household_id, h.name AS household_name FROM donors d
             LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
            WHERE d.org_id = ? AND d.id = ANY(?)`, [orgId, ids]),
    query(`SELECT r.donor_id_a AS a, r.donor_id_b AS b, r.relationship_type AS type, oa.name AS a_name, ob.name AS b_name
             FROM donor_relationships r
             JOIN donors oa ON oa.id = r.donor_id_a AND oa.org_id = r.org_id
             JOIN donors ob ON ob.id = r.donor_id_b AND ob.org_id = r.org_id
            WHERE r.org_id = ? AND r.relationship_type IN ('owner','spouse','partner') AND (r.donor_id_a = ANY(?) OR r.donor_id_b = ANY(?))`, [orgId, ids, ids]),
  ]);
  const hh = new Map(people.map(p => [p.id, p]));
  // union-find over the rows: household first, then gives-through and spouse links
  const parent = new Map(ids.map(id => [id, id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const join = (x, y) => { if (!parent.has(x) || !parent.has(y)) return; const a = find(x), b = find(y); if (a !== b) parent.set(a < b ? b : a, a < b ? a : b); };
  const byHousehold = new Map();
  for (const id of ids) { const p = hh.get(id); if (p && p.household_id) { if (byHousehold.has(p.household_id)) join(byHousehold.get(p.household_id), id); else byHousehold.set(p.household_id, id); } }
  for (const l of links) {
    if (parent.has(l.a) && parent.has(l.b)) join(l.a, l.b);
  }
  // an `owner` link names the organisation: the person gives through it (person = a, organisation = b)
  const throughOrg = new Map();
  for (const l of links) if (l.type === "owner") throughOrg.set(l.a, { id: l.b, name: l.b_name });
  const units = new Map();
  for (const r of rows) {
    const root = find(r.id);
    if (!units.has(root)) units.set(root, []);
    units.get(root).push(r);
  }
  const out = [];
  for (const [root, members] of units) {
    const org = members.map(m => throughOrg.get(m.id)).find(Boolean);
    const orgRow = org && members.find(m => m.id === org.id);
    const hhName = members.map(m => hh.get(m.id)).find(x => x && x.household_name);
    const lead = orgRow || [...members].sort((a, b) => b.priorYearTotal - a.priorYearTotal || String(a.id).localeCompare(String(b.id)))[0];
    const name = members.length === 1 ? lead.name : hhName ? hhName.household_name : org ? org.name : members.map(m => m.name).join(" and ");
    const how = members.length === 1 ? null : hhName ? "household" : org ? "gives through" : "household";
    out.push({
      id: lead.id, name, unit: how, members: members.length > 1 ? members.map(m => ({ id: m.id, name: m.name })) : null,
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
