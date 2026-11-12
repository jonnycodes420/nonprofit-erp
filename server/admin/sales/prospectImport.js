// server/admin/sales/prospectImport.js · SALES-2 item 1. IMPORT A LEAD LIST.
//
// A lead list is one row per organization, in any shape: the mapper knows the usual
// columns (org name, EIN, city, state, revenue, NTEE/type, website, phone, and the
// executive director's and the development director's name, email and phone). A row with
// an ED and a DD makes ONE organization with TWO contacts, roles set, both linked to it.
// The organizations land in a named list. SALES-1's dedupe and undo hold:
//   an organization is the same as a live one with its website's domain, else its EIN,
//   else its name in the same state; a person is the same as a live contact with one of
//   their emails, else the same name at the same organization (SALES-FIX-1 item 4).
//   skip | update | create decides a row that exists; Skip still links and still lists.
//   One transaction; one sales_imports row (object "prospect"); undo removes what it made,
//   restores what it changed, and takes its links and list memberships away.
"use strict";
const { newId } = require("../../shared/newId");
const { withAmbientTransaction } = require("../../db/query");
const M = require("./model");
const REC = require("./records");
const LINKS = require("./links");
const IMP = require("./importCsv");
const LISTS2 = require("./prospectLists");

const ORG_TARGETS = [["name", "Organization name"], ["ein", "EIN"], ["website", "Website"], ["phone", "Main phone"], ["address", "Address"],
  ["city", "City"], ["state", "State"], ["revenue_raw", "Revenue"], ["nonprofit_type", "NTEE code or type"], ["current_crm", "Current CRM"]];
const PEOPLE = [["ed", "ED", "Executive Director"], ["dd", "Development Director", "Development Director"]];
const PERSON_PARTS = [["name", "name"], ["first", "first name"], ["last", "last name"], ["email", "email"], ["phone", "phone"], ["title", "title"]];
const TARGETS = [...ORG_TARGETS.map(([key, label]) => ({ key, label })),
  ...PEOPLE.flatMap(([p, , words]) => PERSON_PARTS.map(([k, w]) => ({ key: `${p}_${k}`, label: `${words}: ${w}` })))];

// Lead-list headers → targets. Read after lower-casing and turning punctuation into spaces.
const SYN = {
  name: ["organization name", "organization", "org name", "org", "nonprofit", "nonprofit name", "name", "company", "company name", "charity name", "legal name"],
  ein: ["ein", "fein", "tax id", "ein number"], website: ["website", "url", "web site", "website url", "web"],
  phone: ["phone", "main phone", "org phone", "organization phone", "phone number", "telephone"], address: ["address", "street", "street address", "address 1"],
  city: ["city", "town"], state: ["state", "st", "state region"], revenue_raw: ["revenue", "total revenue", "annual revenue", "revenue amt", "income", "total income", "budget"],
  nonprofit_type: ["ntee", "ntee code", "ntee cd", "type", "category", "cause", "nonprofit type"], current_crm: ["current crm", "crm"],
};
for (const [p, , words] of PEOPLE) {
  const heads = p === "ed" ? ["ed", "executive director", "exec director", "ceo", "executive"] : ["dd", "development director", "dev director", "director of development", "development"];
  for (const [k, w] of PERSON_PARTS) SYN[`${p}_${k}`] = heads.flatMap(h => [`${h} ${w}`, ...(k === "name" ? [h, `${h} full name`] : []), ...(k === "email" ? [`${h} email address`, `${h} e mail`] : [])]);
  void words;
}
const key = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function autoMap(headers) {
  const map = {}, used = new Set();
  for (const h of headers) {
    const k = key(h);
    const t = Object.keys(SYN).find(x => !used.has(x) && SYN[x].includes(k));
    map[h] = t || "";
    if (t) used.add(t);
  }
  return map;
}

// "Dana R. Whitfield" → first "Dana R.", last "Whitfield".
function splitName(full) {
  const parts = String(full || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts.at(-1) };
}

// One row → { org, people: [{ role, body }] }.
function rowToParts(rec, map) {
  const v = {};
  for (const [h, t] of Object.entries(map || {})) { if (!t) continue; const x = rec[h] == null ? "" : String(rec[h]).trim(); if (x) v[t] = v[t] ? `${v[t]}; ${x}` : x; }
  const org = {};
  for (const [k] of ORG_TARGETS) if (v[k] && k !== "revenue_raw") org[k] = v[k];
  if (v.revenue_raw) { org.revenue_band = IMP.revenueBand(v.revenue_raw); const n = Number(v.revenue_raw.replace(/[$,\s]/g, "")); if (Number.isFinite(n) && n > 0) org.revenue = Math.round(n); }
  if (org.website) org.domain = M.domainOf(org.website) || undefined;
  if (org.state) org.state = org.state.length <= 3 ? org.state.toUpperCase() : org.state;
  if (org.ein) org.ein = org.ein.replace(/[^0-9]/g, "").replace(/^(\d{2})(\d{7})$/, "$1-$2") || org.ein;
  if (!org.domain) delete org.domain;
  const people = [];
  for (const [p, role, title] of PEOPLE) {
    const name = v[`${p}_name`] ? splitName(v[`${p}_name`]) : {};
    const body = { first_name: v[`${p}_first`] || name.first_name, last_name: v[`${p}_last`] || name.last_name,
      emails: M.listOf(v[`${p}_email`] || "").map(e => e.toLowerCase()).filter(e => M.emailOf(e)), phones: M.listOf(v[`${p}_phone`] || ""), role, title: v[`${p}_title`] || title };
    if (!body.first_name) delete body.first_name;
    if (!body.last_name) delete body.last_name;
    if (body.first_name || body.last_name || body.emails.length) people.push({ role, body });
  }
  return { org, people };
}

// The live organization a row is: domain, else EIN, else the name in the same state.
async function orgFor(query, org) {
  if (org.domain) { const [o] = await query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND domain = ? LIMIT 1`, [org.domain]); if (o) return o; }
  if (org.ein) { const [o] = await query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND ein = ? LIMIT 1`, [org.ein]); if (o) return o; }
  if (org.name) {
    const [o] = await query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND lower(name) = lower(?) AND (? = '' OR COALESCE(upper(state), '') IN ('', upper(?))) ORDER BY created_at LIMIT 1`,
      [org.name, org.state || "", org.state || ""]);
    if (o) return o;
  }
  return null;
}
async function personFor(query, body, orgId) {
  if (body.emails && body.emails.length) { const [c] = await REC.findDuplicates(query, "contact", { emails: body.emails }); if (c) return c; }
  return orgId ? IMP.contactByNameAt(query, body, orgId) : null;
}

async function preview(ctx, { csv, mapping }) {
  const { headers, recs } = IMP.records(csv);
  if (!headers.length) return { error: "invalid", message: "The file is empty." };
  if (recs.length > IMP.MAX_ROWS) return { error: "invalid", message: `The file has ${recs.length} rows; one import takes ${IMP.MAX_ROWS} at most.` };
  const map = mapping && typeof mapping === "object" ? mapping : autoMap(headers);
  let duplicates = 0, people = 0, both = 0, noPhone = 0, noName = 0;
  const sample = [];
  for (const [i, rec] of recs.entries()) {
    const { org, people: ps } = rowToParts(rec, map);
    if (!org.name) noName++;
    const dup = org.name ? await orgFor(ctx.query, org) : null;
    if (dup) duplicates++;
    people += ps.length;
    if (ps.length === 2) both++;
    if (!org.phone && !ps.some(p => p.body.phones.length)) noPhone++;
    if (i < 10) sample.push({ body: org, people: ps.map(p => ({ role: p.role, name: [p.body.first_name, p.body.last_name].filter(Boolean).join(" "), email: p.body.emails[0] || null, phone: p.body.phones[0] || null })),
      assoc: {}, links: [], duplicateOf: dup ? { id: dup.id, name: dup.name } : null });
  }
  const says = `${recs.length} organizations and ${people} people (${both} with both an ED and a DD). ${noPhone ? `${noPhone === 1 ? "1 has" : `${noPhone} have`} no phone number at all.` : "Every one has a phone number."}${noName ? ` ${noName === 1 ? "1 row has" : `${noName} rows have`} no organization name and won't be imported.` : ""}`;
  return { ok: true, object: "prospect", headers, mapping: map, targets: TARGETS, rows: recs.length, duplicates, people, both, noPhone, sample, unlinked: [], says };
}

async function commit(ctx, { csv, mapping, mode = "skip", fileName = null, list: listArg = null }, who) {
  if (!["skip", "update", "create"].includes(mode)) return { error: "invalid", message: "For a row that already exists: skip it, update it, or create another." };
  const { headers, recs } = IMP.records(csv);
  if (!headers.length) return { error: "invalid", message: "The file is empty." };
  if (recs.length > IMP.MAX_ROWS) return { error: "invalid", message: `The file has ${recs.length} rows; one import takes ${IMP.MAX_ROWS} at most.` };
  return withAmbientTransaction(async () => {
    const map = mapping && typeof mapping === "object" ? mapping : autoMap(headers);
    const list = await LISTS2.listFor(ctx, listArg, who);
    if (list && list.error) return list;
    const importId = newId("sim");
    const counts = { created: 0, updated: 0, skipped: 0, linked: 0, people: { created: 0, updated: 0, skipped: 0 }, problems: [], unlinked: [], unlinkedRows: 0 };
    const before = [];
    const remember = async (object, id, patch) => {
      const def = M.OBJECTS[object];
      const was = await REC.readRow(ctx.query, object, id);
      before.push({ object, id, cols: Object.fromEntries(def.fields.filter(f => !f.readOnly && f.key in patch).map(f => [f.col, was[f.col]])), props: was.props || {} });
    };
    // One write, by the mode. → { id } or { error }
    const upsert = async (object, dup, body, tally) => {
      if (dup && mode === "skip") { tally.skipped++; return { id: dup.id }; }
      if (dup && mode === "update") {
        await remember(object, dup.id, body);
        const r = await REC.update(ctx, object, dup.id, body, who, { force: true });
        if (r.error) return r;
        tally.updated++; return { id: dup.id };
      }
      const r = await REC.create(ctx, object, body, who, { force: true, importId });
      if (r.error) return r;
      tally.created++; return { id: r.id };
    };
    for (const [i, rec] of recs.entries()) {
      const { org, people } = rowToParts(rec, map);
      if (!org.name) { counts.problems.push({ row: i + 2, says: "No organization name." }); continue; }
      const dupOrg = mode === "create" ? null : await orgFor(ctx.query, org);
      const o = await upsert("org", dupOrg, org, counts);
      if (o.error) { counts.problems.push({ row: i + 2, says: o.message || o.error }); continue; }
      if (list) await LISTS2.addMember(ctx, list.id, o.id, who, importId);
      for (const p of people) {
        const dup = mode === "create" ? null : await personFor(ctx.query, p.body, o.id);
        const c = await upsert("contact", dup, p.body, counts.people);
        if (c.error) { counts.problems.push({ row: i + 2, says: `${p.role}: ${c.message || c.error}` }); continue; }
        await LINKS.associate(ctx, "contact", c.id, "org", o.id, {}, who, importId);
        counts.linked++;
      }
    }
    counts.problems = counts.problems.slice(0, 50);
    if (list) counts.list = { id: list.id, name: list.name };
    await ctx.run(`INSERT INTO sales_imports (id, object, file_name, mode, counts, updated_before, list_id, created_by, created_by_name) VALUES (?, 'prospect', ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?)`,
      [importId, fileName ? String(fileName).slice(0, 200) : null, mode, JSON.stringify(counts), JSON.stringify(before), list ? list.id : null, who.id, who.name]);
    return { ok: true, importId, counts };
  });
}

module.exports = { TARGETS, SYN, autoMap, rowToParts, splitName, preview, commit };
