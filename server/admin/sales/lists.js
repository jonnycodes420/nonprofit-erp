// server/admin/sales/lists.js · SALES-1. THE LIST OF EACH OBJECT: COLUMNS, FILTERS, SORT, VIEWS.
//
// rowsFor(query, type) reads every live record of one object once, with what a
// filter on an association needs (its orgs, its open deals' stages, its last
// activity), in a fixed number of statements, never one per row. The sales CRM
// is one seller's book (hundreds of records, not a donor file), so the filter
// and the sort run in applyView, which is pure: the route, the export and the
// test read one answer.
//
// A filter is { field, op, value }. `field` is a core field key, `props.<key>`
// for a custom property, or one of the association fields in ASSOC_FIELDS.
"use strict";
const M = require("./model");

const ASSOC_FIELDS = {
  org: [
    { key: "open_deal_stage", label: "Has an open deal in stage", type: "stage" },
    { key: "last_activity", label: "Last activity", type: "date" },
    { key: "contact_count", label: "Contacts", type: "number" },
    { key: "steward_org_id", label: "Linked Steward org", type: "text" },
  ],
  contact: [
    { key: "org_ids", label: "Organization", type: "org" },
    { key: "org_name", label: "Primary organization", type: "text" },
    { key: "open_deal_stage", label: "Has an open deal in stage", type: "stage" },
    { key: "last_activity", label: "Last activity", type: "date" },
  ],
  deal: [
    { key: "org_ids", label: "Organization", type: "org" },
    { key: "org_name", label: "Primary organization", type: "text" },
    { key: "last_activity", label: "Last activity", type: "date" },
    { key: "has_open_task", label: "Has an open task", type: "checkbox" },
    { key: "stage_kind", label: "Open, won, later or lost", type: "text" },
    { key: "contact_count", label: "Contacts", type: "number" },
  ],
};
const OPS = ["eq", "neq", "contains", "empty", "notempty", "gt", "lt", "before", "after", "in", "is_true", "is_false", "none_since"];

const iso = t => (t ? new Date(t).toISOString() : null);
const day = t => (t ? (t instanceof Date ? t.toISOString() : String(t)).slice(0, 10) : null);

async function rowsFor(query, type) {
  const def = M.OBJECTS[type];
  const cols = [...new Set(["id", ...def.fields.map(f => f.col), "props", ...(type === "org" ? ["steward_org_id"] : []), ...(type === "deal" ? ["stage_entered_at", "won_at", "lost_at"] : [])])];
  const [rows, links, lastAct, deals, openTasks] = await Promise.all([
    query(`SELECT ${cols.map(M.sel).join(", ")} FROM ${def.table} WHERE deleted_at IS NULL ORDER BY created_at`),
    query(`SELECT a_type, a_id, b_type, b_id, label, is_primary FROM sales_links WHERE a_type = ? OR b_type = ?`, [type, type]),
    query(`SELECT l.record_id, MAX(a.at) AS t FROM sales_activity_links l JOIN sales_activities a ON a.id = l.activity_id AND a.deleted_at IS NULL
            WHERE l.record_type = ? GROUP BY l.record_id`, [type]),
    query(`SELECT d.id, d.stage_id, s.kind FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id WHERE d.deleted_at IS NULL`),
    type === "deal" ? query(`SELECT l.record_id FROM sales_activity_links l JOIN sales_activities a ON a.id = l.activity_id
                              WHERE l.record_type = 'deal' AND a.kind = 'task' AND a.done_at IS NULL AND a.deleted_at IS NULL GROUP BY l.record_id`) : [],
  ]);
  const [orgNames, stages] = await Promise.all([
    query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL`),
    query(`SELECT id, name, kind, probability FROM sales_stages`),
  ]);
  const orgName = new Map(orgNames.map(o => [o.id, o.name]));
  const stageOf = new Map(stages.map(s => [s.id, s]));
  const dealOf = new Map(deals.map(d => [d.id, d]));
  const last = new Map(lastAct.map(r => [r.record_id, iso(r.t)]));
  const tasksOpen = new Set(openTasks.map(r => r.record_id));
  return rows.map(r => {
    const mine = links.filter(l => (l.a_type === type && l.a_id === r.id) || (l.b_type === type && l.b_id === r.id))
      .map(l => (l.a_type === type && l.a_id === r.id ? { t: l.b_type, id: l.b_id, primary: l.is_primary } : { t: l.a_type, id: l.a_id, primary: l.is_primary }));
    const orgIds = mine.filter(m => m.t === "org" && orgName.has(m.id));
    const primaryOrg = orgIds.find(m => m.primary) || orgIds[0];
    const myDeals = mine.filter(m => m.t === "deal" && dealOf.has(m.id)).map(m => dealOf.get(m.id));
    const out = { ...r, props: r.props || {}, displayName: M.nameOf(type, r), last_activity: last.get(r.id) || null,
      created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
    if (type === "deal") {
      const st = stageOf.get(r.stage_id) || {};
      Object.assign(out, { value_cents: Number(r.value_cents || 0), close_date: day(r.close_date), next_step_on: day(r.next_step_on), trial_ends_on: day(r.trial_ends_on), revisit_on: day(r.revisit_on),
        stage_name: st.name || null, stage_kind: st.kind || "open", probability: Number(st.probability || 0), has_open_task: tasksOpen.has(r.id),
        stage_entered_at: iso(r.stage_entered_at), won_at: iso(r.won_at), lost_at: iso(r.lost_at),
        org_ids: orgIds.map(m => m.id), org_id: primaryOrg ? primaryOrg.id : null, org_name: primaryOrg ? orgName.get(primaryOrg.id) : null,
        contact_count: mine.filter(m => m.t === "contact").length });
    } else {
      out.open_deal_stage = myDeals.filter(d => (d.kind || "open") === "open").map(d => d.stage_id);
      if (type === "org") out.contact_count = mine.filter(m => m.t === "contact").length;
      if (type === "contact") Object.assign(out, { org_ids: orgIds.map(m => m.id), org_id: primaryOrg ? primaryOrg.id : null, org_name: primaryOrg ? orgName.get(primaryOrg.id) : null });
    }
    return out;
  });
}

// The value a filter or a sort reads off a row.
function valueOf(row, key) {
  if (key.startsWith("props.")) return row.props ? row.props[key.slice(6)] : undefined;
  if (key === "name" && row.displayName !== undefined) return row.displayName;
  return row[key];
}
const isEmpty = v => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const text = v => (Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v)).toLowerCase();
const num = v => (v === "" || v == null ? NaN : Number(v));

function matches(row, f) {
  const v = valueOf(row, f.field);
  const want = f.value;
  switch (f.op) {
    case "empty": return isEmpty(v);
    case "notempty": return !isEmpty(v);
    case "eq": return Array.isArray(v) ? v.map(String).includes(String(want)) : text(v) === text(want);
    case "neq": return Array.isArray(v) ? !v.map(String).includes(String(want)) : text(v) !== text(want);
    case "contains": return text(v).includes(text(want));
    case "gt": return num(v) > num(want);
    case "lt": return num(v) < num(want);
    case "before": return !isEmpty(v) && String(v).slice(0, 10) < String(want).slice(0, 10);
    case "after": return !isEmpty(v) && String(v).slice(0, 10) > String(want).slice(0, 10);
    // "Contacts with no activity since…": none at all, or the last one before the day.
    case "none_since": return isEmpty(v) || String(v).slice(0, 10) < String(want).slice(0, 10);
    case "in": { const set = new Set((Array.isArray(want) ? want : [want]).map(String)); return Array.isArray(v) ? v.some(x => set.has(String(x))) : set.has(String(v)); }
    case "is_true": return v === true;
    case "is_false": return v !== true;
    default: return true;
  }
}

// rows → the rows a view shows: { filters, sort: { key, dir }, q }.
function applyView(rows, view = {}) {
  const filters = (view.filters || []).filter(f => f && f.field && OPS.includes(f.op));
  const q = String(view.q || "").trim().toLowerCase();
  let out = rows.filter(r => filters.every(f => matches(r, f)));
  if (q) out = out.filter(r => [r.displayName, r.domain, r.website, ...(r.emails || []), r.org_name, r.city].some(x => x && String(x).toLowerCase().includes(q)));
  const s = view.sort && view.sort.key ? view.sort : { key: "name", dir: "asc" };
  const dir = s.dir === "desc" ? -1 : 1;
  return out.slice().sort((a, b) => {
    const x = valueOf(a, s.key), y = valueOf(b, s.key);
    if (isEmpty(x) && isEmpty(y)) return 0;
    if (isEmpty(x)) return 1;   // empties last, whichever way
    if (isEmpty(y)) return -1;
    const nx = num(x), ny = num(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) && typeof x !== "string" ? nx - ny : text(x).localeCompare(text(y));
    return c * dir;
  });
}

// One search box across all three objects.
async function search(query, q) {
  const s = `%${String(q || "").trim().toLowerCase().replace(/[%_\\]/g, m => "\\" + m)}%`;
  if (s === "%%") return [];
  const [orgs, contacts, deals] = await Promise.all([
    query(`SELECT id, name, domain FROM sales_orgs WHERE deleted_at IS NULL AND (lower(name) LIKE ? OR lower(COALESCE(domain,'')) LIKE ?) ORDER BY name LIMIT 20`, [s, s]),
    query(`SELECT id, first_name, last_name, emails FROM sales_contacts WHERE deleted_at IS NULL
             AND (lower(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? OR lower(emails::text) LIKE ?) ORDER BY last_name, first_name LIMIT 20`, [s, s]),
    query(`SELECT id, name FROM sales_deals WHERE deleted_at IS NULL AND lower(name) LIKE ? ORDER BY name LIMIT 20`, [s]),
  ]);
  return [...orgs.map(r => ({ type: "org", id: r.id, name: r.name, hint: r.domain })),
    ...contacts.map(r => ({ type: "contact", id: r.id, name: M.nameOf("contact", r), hint: (r.emails || [])[0] || null })),
    ...deals.map(r => ({ type: "deal", id: r.id, name: r.name, hint: null }))];
}

module.exports = { ASSOC_FIELDS, OPS, rowsFor, applyView, matches, valueOf, search };
