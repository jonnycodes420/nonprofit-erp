// server/admin/sales/prospectRows.js · SALES-2. WHAT A LIST ROW KNOWS FOR PROSPECTING.
//
// lists.rowsFor reads every live record once; for organizations and contacts this adds,
// in a fixed number of statements (never one per row):
//   org      has_ed, has_dd, has_phone, has_email (from its linked contacts and its own
//            phone), list_ids, the fit answer (fit_met, fit_total, fit_line, fit_misses),
//            dnc (Do not contact)
//   contact  list_ids (its organizations' lists), dnc: its own flag, or its
//            organization's (an org marked Do not contact takes its people with it)
"use strict";
const FIT = require("./fit");

const phonesLeft = (phones, bad) => {
  const b = new Set((bad || []).map(x => String(x).replace(/\D/g, "")));
  return (phones || []).filter(p => String(p).replace(/\D/g, "") && !b.has(String(p).replace(/\D/g, "")));
};

async function fitRule(query) {
  const [r] = await query(`SELECT value FROM sales_settings WHERE key = 'fit'`);
  return r ? FIT.cleanRule(r.value) : FIT.DEFAULT_FIT;
}

async function extrasFor(query, type) {
  const [members, orgDnc] = await Promise.all([
    query(`SELECT m.list_id, m.org_id FROM sales_list_members m JOIN sales_lists l ON l.id = m.list_id AND l.deleted_at IS NULL`),
    query(`SELECT id FROM sales_orgs WHERE deleted_at IS NULL AND dnc_at IS NOT NULL`),
  ]);
  const listsOf = new Map();
  for (const m of members) { if (!listsOf.has(m.org_id)) listsOf.set(m.org_id, []); listsOf.get(m.org_id).push(m.list_id); }
  const out = { listsOf, dncOrgs: new Set(orgDnc.map(r => r.id)) };
  if (type === "org") {
    const [people, rule, props] = await Promise.all([
      query(`SELECT l.b_id AS org_id, c.role, c.phones, c.emails, c.bad_phones, c.dnc_at FROM sales_links l
               JOIN sales_contacts c ON c.id = l.a_id AND c.deleted_at IS NULL WHERE l.a_type = 'contact' AND l.b_type = 'org'`),
      fitRule(query),
      query(`SELECT key, label FROM sales_properties WHERE object = 'org'`),
    ]);
    const facts = new Map();
    for (const p of people) {
      const f = facts.get(p.org_id) || { ed: false, dd: false, phone: false, email: false };
      if (p.role === "ED") f.ed = true;
      if (p.role === "Development Director") f.dd = true;
      if (!p.dnc_at && phonesLeft(p.phones, p.bad_phones).length) f.phone = true;
      if ((p.emails || []).length) f.email = true;
      facts.set(p.org_id, f);
    }
    Object.assign(out, { facts, rule, props });
  }
  return out;
}

function addExtras(type, row, extra, orgIds) {
  if (type === "org") {
    const f = extra.facts.get(row.id) || {};
    Object.assign(row, { has_ed: !!f.ed, has_dd: !!f.dd, has_email: !!f.email,
      has_phone: !!f.phone || phonesLeft(row.phone ? [row.phone] : [], row.bad_phones).length > 0,
      list_ids: extra.listsOf.get(row.id) || [], dnc: !!row.dnc_at });
    const fit = FIT.fitOf(row, extra.rule, extra.props);
    Object.assign(row, { fit_met: fit.met, fit_total: fit.total, fit_line: fit.line, fit_misses: fit.misses });
  } else if (type === "contact") {
    const lists = new Set();
    for (const id of orgIds) for (const l of extra.listsOf.get(id) || []) lists.add(l);
    const viaOrg = orgIds.some(id => extra.dncOrgs.has(id));
    Object.assign(row, { list_ids: [...lists], dnc: !!row.dnc_at || viaOrg, dnc_via_org: !row.dnc_at && viaOrg });
  }
}

module.exports = { extrasFor, addExtras, fitRule, phonesLeft };
