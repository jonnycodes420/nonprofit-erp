// server/admin/sales/importCsv.js · SALES-1. IMPORT A CSV PER OBJECT, EXPORT ANY LIST.
//
//   preview(ctx, { object, csv })                  the headers, the column map
//        HubSpot's standard export columns map themselves (HUBSPOT), the first
//        rows as they would be written, and how many already exist
//   commit(ctx, { object, csv, mapping, mode })    mode: skip | update | create
//        for a row that matches an existing record (an org's domain, a
//        contact's email, a deal's name). Contacts and deals are linked to their
//        organization by its domain, else its name. One transaction; the batch
//        is one sales_imports row, and undo reverses all of it.
//   undo(ctx, importId)                            the records it made are
//        deleted, the records it changed get their old values back, the links
//        it made are removed
//   toCsv(type, rows, columns, props)              any list view, as CSV
//
// Fixtures are made-up HubSpot-shaped files (tests/fixtures/sales1/). Jonathan
// imports his real export himself, on prod.
"use strict";
const { newId } = require("../../shared/newId");
const { withAmbientTransaction } = require("../../db/query");
const M = require("./model");
const REC = require("./records");
const LINKS = require("./links");
const PIPES = require("./pipelines");
const LISTS2 = require("./prospectLists");   // SALES-2: an import can land in a named list

// THE PLANTED DEFECTS (SALES2_PLANT on the server, tests only; tests/sales2-prospecting.test.js):
//   skiplink  a skipped row adds no links again (SALES-FIX-1 item 2)        → §F2 red
//   dupe      an email-less contact is never matched (SALES-FIX-1 item 4)  → §F4 red
const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";

const MAX_ROWS = 5000;

// RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

// HubSpot's standard Companies, Contacts and Deals export columns → our fields.
const HUBSPOT = {
  org: {
    "company name": "name", "name": "name", "company domain name": "domain", "domain": "domain", "website url": "website", "website": "website",
    "phone number": "phone", "phone": "phone", "street address": "address", "address": "address", "city": "city", "state/region": "state", "state": "state",
    "annual revenue": "revenue_raw", "type": "nonprofit_type", "company owner": "owner_name", "current crm": "current_crm",
  },
  contact: {
    "first name": "first_name", "last name": "last_name", "email": "emails", "email address": "emails", "additional email addresses": "emails_more",
    "phone number": "phones", "mobile phone number": "phones_more", "job title": "title", "title": "title", "contact owner": "owner_name", "role": "role",
    "associated company": "assoc_org_name", "company name": "assoc_org_name", "company": "assoc_org_name", "company domain name": "assoc_org_domain",
  },
  deal: {
    "deal name": "name", "name": "name", "deal stage": "stage_name", "stage": "stage_name", "pipeline": "pipeline_name", "amount": "value_dollars",
    "close date": "close_date", "deal owner": "owner_name", "deal source": "source", "source": "source", "original source type": "source",
    "closed lost reason": "lost_reason", "revisit date": "revisit_on", "lost reason": "lost_reason", "next step": "next_step",
    "associated company": "assoc_org_name", "company name": "assoc_org_name", "associated company domain": "assoc_org_domain",
    "associated contact": "assoc_contact", "associated contacts": "assoc_contact", "associated contact email": "assoc_contact",
  },
};
// The stages HubSpot ships with, read onto ours by meaning.
const HUBSPOT_STAGES = { "appointment scheduled": "Meeting booked", "qualified to buy": "Contacted", "presentation scheduled": "Demo done",
  "decision maker bought-in": "Verbal yes", "contract sent": "Verbal yes", "closed won": "Paying", "closed lost": "Lost" };
// A closed stage needs its fact; an import that lacks it says so rather than leaving it empty.
const NO_REASON = "Not given in the import";
const SPECIAL_TARGETS = ["owner_name", "revenue_raw", "emails_more", "phones_more", "assoc_org_name", "assoc_org_domain", "assoc_contact", "stage_name", "pipeline_name", "value_dollars"];

const norm = h => String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
function autoMap(type, headers, props) {
  const map = {};
  for (const h of headers) {
    const n = norm(h);
    const p = props.find(x => norm(x.label) === n || norm(x.key) === n);
    map[h] = HUBSPOT[type][n] || (M.OBJECTS[type].fields.find(f => !f.readOnly && (norm(f.label) === n || f.key === n)) || {}).key || (p ? `props.${p.key}` : "");
  }
  return map;
}
function targetsFor(type, props) {
  const core = M.OBJECTS[type].fields.filter(f => !f.readOnly && f.type !== "pipeline" && f.type !== "stage" && f.key !== "value_cents" && f.key !== "owner_id").map(f => ({ key: f.key, label: f.label }));
  const extra = { org: ["owner_name", "revenue_raw"], contact: ["owner_name", "emails_more", "phones_more", "assoc_org_name", "assoc_org_domain"],
    deal: ["owner_name", "stage_name", "pipeline_name", "value_dollars", "assoc_org_name", "assoc_org_domain", "assoc_contact"] }[type];
  const words = { owner_name: "Owner (name or email)", revenue_raw: "Annual revenue", emails_more: "More emails", phones_more: "More phones",
    assoc_org_name: "Organization (by name)", assoc_org_domain: "Organization (by domain)", assoc_contact: "Contacts (by email or name)",
    stage_name: "Stage", pipeline_name: "Pipeline", value_dollars: "Value in dollars (MRR)" };
  return [...core, ...extra.map(k => ({ key: k, label: words[k] })), ...props.map(p => ({ key: `props.${p.key}`, label: `${p.label} (custom)` }))];
}

// "2026-11-30 00:00", "2026-11-30T05:00:00Z", "11/30/2026" → "2026-11-30".
function dayOf(v) {
  const s = String(v || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  return null;
}
function revenueBand(v) {
  const n = Number(String(v || "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || !String(v || "").trim()) { const s = M.clean(v); return M.OBJECTS.org.fields.find(f => f.key === "revenue_band").options.includes(s) ? s : null; }
  return n < 250000 ? "Under $250K" : n < 1000000 ? "$250K–$1M" : n < 5000000 ? "$1M–$5M" : n < 20000000 ? "$5M–$20M" : "Over $20M";
}

// One CSV row (header → cell) → { body, assoc, problem }.
function rowToBody(type, rec, mapping, { owners, stages, pipes }) {
  const body = { props: {} }, assoc = {};
  const add = (k, v) => { body[k] = body[k] ? [].concat(body[k], v) : v; };
  for (const [h, target] of Object.entries(mapping)) {
    if (!target) continue;
    const v = rec[h] == null ? "" : String(rec[h]).trim();
    if (v === "") continue;
    if (target.startsWith("props.")) body.props[target.slice(6)] = v;
    else if (target === "owner_name") { const o = owners.find(u => norm(u.name) === norm(v) || norm(u.email) === norm(v)); if (o) body.owner_id = o.id; }
    else if (target === "revenue_raw") { body.revenue_band = revenueBand(v); const n = Number(v.replace(/[$,\s]/g, "")); if (Number.isFinite(n) && n > 0) body.revenue = Math.round(n); }
    else if (target === "emails" || target === "emails_more") add("emails", M.listOf(v).map(e => e.toLowerCase()));
    else if (target === "phones" || target === "phones_more") add("phones", M.listOf(v));
    else if (target === "assoc_org_name") assoc.orgName = v;
    else if (target === "assoc_org_domain") assoc.orgDomain = M.domainOf(v);
    else if (target === "assoc_contact") assoc.contacts = M.listOf(v);
    else if (target === "stage_name") assoc.stageName = v;
    else if (target === "pipeline_name") assoc.pipelineName = v;
    else if (target === "value_dollars") { const n = Number(v.replace(/[$,\s]/g, "")); if (Number.isFinite(n)) body.value_cents = Math.round(n * 100); }
    else if (["close_date", "next_step_on", "trial_ends_on", "revisit_on"].includes(target)) body[target] = dayOf(v);
    else body[target] = v;
  }
  if (type === "org" && !body.domain && body.website) body.domain = M.domainOf(body.website);
  if (type === "org" && body.domain) body.domain = M.domainOf(body.domain) || body.domain;
  if (type === "contact" && body.role && !M.ROLES.includes(body.role)) body.role = "Other";
  if (type === "deal") {
    const pipe = (assoc.pipelineName && pipes.find(p => norm(p.name) === norm(assoc.pipelineName))) || pipes[0];
    body.pipeline_id = pipe.id;
    const want = assoc.stageName ? (HUBSPOT_STAGES[norm(assoc.stageName)] || assoc.stageName) : null;
    const st = (want && pipe.stages.find(s => norm(s.name) === norm(want))) || pipe.stages[0];
    body.stage_id = st.id;
    if (st.kind === "lost" && !body.lost_reason) body.lost_reason = NO_REASON;
    if (st.kind === "later" && !body.revisit_on) body.revisit_on = body.close_date || null;
  }
  if (!Object.keys(body.props).length) delete body.props;
  return { body, assoc };
}

async function context(ctx, type, who) {
  if (type === "deal") await PIPES.ensureDefaults(ctx, who);
  const [owners, props, pipes] = await Promise.all([REC.owners(ctx.query), REC.properties(ctx.query, type), PIPES.readAll(ctx.query)]);
  return { owners, props, pipes };
}
function records(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) return { headers: [], recs: [] };
  const headers = rows[0].map(h => String(h).trim());
  return { headers, recs: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? "" : r[i]]))) };
}

// The organization a row names: by its domain, else its name. null when it isn't here.
async function resolveOrg(query, assoc) {
  if (assoc.orgDomain) { const [o] = await query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND domain = ? LIMIT 1`, [assoc.orgDomain]); if (o) return o; }
  if (assoc.orgName) { const [o] = await query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND lower(name) = lower(?) LIMIT 1`, [String(assoc.orgName).trim()]); if (o) return o; }
  return null;
}
const nameKey = v => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
// SALES-FIX-1 item 4: a contact with no email is the same person as a live contact with the
// same first and last name (case and spaces ignored) linked to the same organization.
async function contactByNameAt(query, body, orgId) {
  const first = nameKey(body.first_name), last = nameKey(body.last_name);
  if (!orgId || (!first && !last)) return null;
  const [c] = await query(`SELECT c.id, c.first_name, c.last_name, c.emails FROM sales_contacts c
                             JOIN sales_links l ON l.a_type = 'contact' AND l.a_id = c.id AND l.b_type = 'org' AND l.b_id = ?
                            WHERE c.deleted_at IS NULL AND lower(regexp_replace(trim(COALESCE(c.first_name, '')), '\\s+', ' ', 'g')) = ?
                              AND lower(regexp_replace(trim(COALESCE(c.last_name, '')), '\\s+', ' ', 'g')) = ? ORDER BY c.created_at LIMIT 1`, [orgId, first, last]);
  if (c) return c;
  // The shape that bit on prod (11 Nov): contacts imported before their organizations were
  // never linked. The same name with no organization at all and no email is that person.
  const [orphan] = await query(`SELECT c.id, c.first_name, c.last_name, c.emails FROM sales_contacts c
                                 WHERE c.deleted_at IS NULL AND c.emails = '[]'::jsonb
                                   AND NOT EXISTS (SELECT 1 FROM sales_links l WHERE l.a_type = 'contact' AND l.a_id = c.id AND l.b_type = 'org')
                                   AND lower(regexp_replace(trim(COALESCE(c.first_name, '')), '\\s+', ' ', 'g')) = ?
                                   AND lower(regexp_replace(trim(COALESCE(c.last_name, '')), '\\s+', ' ', 'g')) = ? ORDER BY c.created_at LIMIT 1`, [first, last]);
  return orphan || null;
}

// The record that a row would duplicate, if any.
async function existingFor(query, type, body, assoc = {}) {
  if (type === "org" && body.domain) return (await REC.findDuplicates(query, "org", { domain: body.domain }))[0] || null;
  if (type === "contact" && body.emails && body.emails.length) return (await REC.findDuplicates(query, "contact", { emails: body.emails }))[0] || null;
  if (type === "contact" && PLANT !== "dupe") { const o = await resolveOrg(query, assoc); return o ? contactByNameAt(query, body, o.id) : null; }
  if (type === "deal" && body.name) return (await query(`SELECT id, name FROM sales_deals WHERE deleted_at IS NULL AND lower(name) = lower(?) LIMIT 1`, [body.name]))[0] || null;
  return null;
}

async function preview(ctx, { object, csv, mapping }, who) {
  if (object === "prospect") return require("./prospectImport").preview(ctx, { csv, mapping }, who);
  if (!M.OBJECTS[object]) return { error: "invalid", message: "Import a lead list, organizations, contacts or deals." };
  const { headers, recs } = records(csv);
  if (!headers.length) return { error: "invalid", message: "The file is empty." };
  if (recs.length > MAX_ROWS) return { error: "invalid", message: `The file has ${recs.length} rows; one import takes ${MAX_ROWS} at most.` };
  const c = await context(ctx, object, who);
  const map = mapping && typeof mapping === "object" ? mapping : autoMap(object, headers, c.props);
  let duplicates = 0, namingOrg = 0, orgMissing = 0;
  const sample = [], unlinked = [];
  for (const [i, rec] of recs.entries()) {
    const { body, assoc } = rowToBody(object, rec, map, c);
    const dup = await existingFor(ctx.query, object, body, assoc);
    if (dup) duplicates++;
    const links = object === "org" ? [] : await linksFor(ctx.query, assoc);
    if (assoc.orgName || assoc.orgDomain) { namingOrg++; if (!links.find(l => l.type === "org" && l.ok)) orgMissing++; }
    const misses = links.filter(l => !l.ok);
    if (misses.length && unlinked.length < 50) unlinked.push({ row: i + 2, says: misses.map(l => l.says).join("; ") });
    if (i < 10) sample.push({ body, assoc, links, duplicateOf: dup ? { id: dup.id, name: M.nameOf(object, dup) } : null });
  }
  // SALES-FIX-1 item 3: say before the import what won't link.
  const warning = orgMissing ? `Import organizations first: ${orgMissing} of ${namingOrg} rows name an organization that isn't here.` : null;
  return { ok: true, headers, mapping: map, targets: targetsFor(object, c.props), rows: recs.length, duplicates, sample, unlinked, orgMissing, namingOrg, warning };
}

// What a row's associations resolve to, without writing: [{ type, id?, ok, says }].
async function linksFor(query, assoc) {
  const out = [];
  if (assoc.orgDomain || assoc.orgName) {
    const o = await resolveOrg(query, assoc);
    const named = assoc.orgName || assoc.orgDomain;
    out.push(o ? { type: "org", id: o.id, ok: true, says: `linked to ${o.name}` } : { type: "org", ok: false, says: `organization '${named}' not found` });
  }
  for (const c of assoc.contacts || []) {
    const e = M.emailOf(c);
    const [ct] = e ? await REC.findDuplicates(query, "contact", { emails: [e] })
      : await query(`SELECT id FROM sales_contacts WHERE deleted_at IS NULL AND lower(trim(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) = lower(?) LIMIT 1`, [c]);
    out.push(ct ? { type: "contact", id: ct.id, ok: true, says: `linked to ${c}` } : { type: "contact", ok: false, says: `contact '${c}' not found` });
  }
  return out;
}

// Adds the links a row names that don't exist yet; never removes one.
async function linkTo(ctx, type, id, assoc, who, importId) {
  const links = await linksFor(ctx.query, assoc);
  let made = 0;
  for (const l of links) if (l.ok) { await LINKS.associate(ctx, type, id, l.type, l.id, {}, who, importId); made++; }
  return { made, misses: links.filter(l => !l.ok).map(l => l.says) };
}

async function commit(ctx, { object, csv, mapping, mode = "skip", fileName = null, list: listArg = null }, who) {
  if (object === "prospect") return require("./prospectImport").commit(ctx, { csv, mapping, mode, fileName, list: listArg }, who);
  if (!M.OBJECTS[object]) return { error: "invalid", message: "Import a lead list, organizations, contacts or deals." };
  if (!["skip", "update", "create"].includes(mode)) return { error: "invalid", message: "For a row that already exists: skip it, update it, or create another." };
  const { headers, recs } = records(csv);
  if (!headers.length) return { error: "invalid", message: "The file is empty." };
  if (recs.length > MAX_ROWS) return { error: "invalid", message: `The file has ${recs.length} rows; one import takes ${MAX_ROWS} at most.` };
  return withAmbientTransaction(async () => {
    const c = await context(ctx, object, who);
    const map = mapping && typeof mapping === "object" ? mapping : autoMap(object, headers, c.props);
    const importId = newId("sim");
    const counts = { created: 0, updated: 0, skipped: 0, linked: 0, problems: [], unlinked: [], unlinkedRows: 0 };
    const list = await LISTS2.listFor(ctx, listArg, who);
    if (list && list.error) return list;
    const before = [];
    const def = M.OBJECTS[object];
    for (const [i, rec] of recs.entries()) {
      const { body, assoc } = rowToBody(object, rec, map, c);
      const dup = mode === "create" ? null : await existingFor(ctx.query, object, body, assoc);
      let id;
      // SALES-FIX-1 item 2: a skipped row still adds the links it names (a contact imported
      // before its organization is linked by importing the contacts again).
      if (dup && mode === "skip") { counts.skipped++; id = dup.id; if (PLANT === "skiplink") continue; }
      else if (dup && mode === "update") {
        const was = await REC.readRow(ctx.query, object, dup.id);
        const patch = { ...body };
        delete patch.stage_id; delete patch.pipeline_id;   // an update never moves a deal's stage
        before.push({ id: dup.id, cols: Object.fromEntries(def.fields.filter(f => !f.readOnly && f.key in patch).map(f => [f.col, was[f.col]])), props: was.props || {} });
        const r = await REC.update(ctx, object, dup.id, patch, who, { force: true });
        if (r.error) { counts.problems.push({ row: i + 2, says: r.message || r.error }); continue; }
        id = dup.id; counts.updated++;
      } else {
        const r = await REC.create(ctx, object, body, who, { force: true, importId });
        if (r.error) { counts.problems.push({ row: i + 2, says: r.message || r.error }); continue; }
        id = r.id; counts.created++;
      }
      if (object !== "org") {
        const l = await linkTo(ctx, object, id, assoc, who, importId);
        counts.linked += l.made;
        if (l.misses.length) { counts.unlinkedRows++; if (counts.unlinked.length < 50) counts.unlinked.push({ row: i + 2, says: l.misses.join("; ") }); }
      } else if (list) await LISTS2.addMember(ctx, list.id, id, who, importId);
    }
    counts.problems = counts.problems.slice(0, 50);
    if (list) counts.list = { id: list.id, name: list.name };
    await ctx.run(`INSERT INTO sales_imports (id, object, file_name, mode, counts, updated_before, list_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?)`,
      [importId, object, fileName ? String(fileName).slice(0, 200) : null, mode, JSON.stringify(counts), JSON.stringify(before), list ? list.id : null, who.id, who.name]);
    return { ok: true, importId, counts };
  });
}

async function undo(ctx, importId, who) {
  return withAmbientTransaction(async () => {
    const [imp] = await ctx.query(`SELECT id, object, updated_before, undone_at FROM sales_imports WHERE id = ?`, [importId]);
    if (!imp) return { error: "not_found" };
    if (imp.undone_at) return { error: "already_undone", message: "This import was already undone." };
    // A lead list (prospect) makes organizations and contacts; every other import one object.
    const objects = imp.object === "prospect" ? ["org", "contact"] : [imp.object];
    const made = { changes: 0 };
    for (const o of objects) {
      const r = await ctx.run(`UPDATE ${M.OBJECTS[o].table} SET deleted_at = NOW(), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE import_id = ? AND deleted_at IS NULL`, [who.id, who.name, importId]);
      made.changes += r.changes;
    }
    for (const b of imp.updated_before || []) {
      const def = M.OBJECTS[b.object || imp.object];
      const cols = Object.keys(b.cols || {});
      const vals = cols.map(k => (k === "emails" || k === "phones" ? JSON.stringify(b.cols[k] || []) : b.cols[k]));
      await ctx.run(`UPDATE ${def.table} SET ${[...cols.map(k => `${k} = ?`), "props = ?::jsonb"].join(", ")}, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`,
        [...vals, JSON.stringify(b.props || {}), who.id, who.name, b.id]);
    }
    const links = await ctx.run(`DELETE FROM sales_links WHERE import_id = ?`, [importId]);
    await ctx.run(`DELETE FROM sales_list_members WHERE import_id = ?`, [importId]);
    await ctx.run(`UPDATE sales_imports SET undone_at = NOW(), undone_by = ? WHERE id = ?`, [who.id, importId]);
    return { ok: true, removed: made.changes, restored: (imp.updated_before || []).length, unlinked: links.changes };
  });
}

async function recent(query) {
  return query(`SELECT id, object, file_name, mode, counts, created_at, created_by_name, undone_at FROM sales_imports ORDER BY created_at DESC LIMIT 20`);
}

// A list view as CSV. columns: field keys (core, props.<key>, or the list's own).
const cellOf = v => { const s = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(type, rows, columns, { props = [], owners = [], stages = new Map() } = {}) {
  const def = M.OBJECTS[type];
  const cols = columns && columns.length ? columns : ["name", ...def.defaultColumns.filter(c => c !== "name"), ...props.map(p => `props.${p.key}`)];
  const ownerName = new Map(owners.map(o => [o.id, o.name]));
  const label = k => (k === "name" ? "Name" : k.startsWith("props.") ? ((props.find(p => p.key === k.slice(6)) || {}).label || k) :
    (def.fields.find(f => f.key === k) || {}).label || { primary_org_name: "Organization", last_activity: "Last activity", contact_count: "Contacts", stage_name: "Stage" }[k] || k);
  const val = (r, k) => {
    if (k === "name") return r.displayName;
    if (k === "owner_id") return ownerName.get(r.owner_id) || "";
    if (k === "stage_id") return (stages.get(r.stage_id) || {}).name || r.stage_name || "";
    if (k === "pipeline_id") return (stages.get(r.stage_id) || {}).pipelineName || "";
    if (k === "value_cents") return (Number(r.value_cents || 0) / 100).toFixed(2);
    if (k.startsWith("props.")) return (r.props || {})[k.slice(6)];
    return r[k];
  };
  return [cols.map(label).map(cellOf).join(","), ...rows.map(r => cols.map(k => cellOf(val(r, k))).join(","))].join("\r\n") + "\r\n";
}

module.exports = { HUBSPOT, HUBSPOT_STAGES, parseCsv, autoMap, targetsFor, rowToBody, dayOf, revenueBand, preview, commit, undo, recent, toCsv, SPECIAL_TARGETS,
  MAX_ROWS, records, resolveOrg, contactByNameAt, nameKey, linksFor, linkTo, existingFor, PLANT };
