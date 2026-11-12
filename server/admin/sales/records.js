// server/admin/sales/records.js · SALES-1. ONE RECORD: CREATE, EDIT, DELETE, READ.
//
// Every write stamps the actor (a super-admin user id and name). Deleting a
// record marks only that record deleted (deleted_at); what it is linked to is
// never touched, and its links stay so a restore or the merge record can read
// them (the planted defect SALES1_PLANT=cascade deletes a deal's org and
// contacts with it; tests/sales1-crm.test.js §2 goes red).
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");
const PIPES = require("./pipelines");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES1_PLANT || "" : "";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DNC_COLS = ["dnc_at", "dnc_reason", "dnc_by_name"];   // SALES-2: Do not contact

async function owners(query) {
  return query(`SELECT id, name, email FROM users WHERE is_super_admin = true AND deactivated_at IS NULL ORDER BY name`);
}
async function properties(query, object = null) {
  return query(`SELECT id, object, key, label, type, options, position FROM sales_properties ${object ? "WHERE object = ?" : ""} ORDER BY object, position, label`, object ? [object] : []);
}

// A body → the columns and custom properties it sets, or the first reason it can't.
function normalize(type, body, props, { partial }) {
  const def = M.OBJECTS[type];
  const cols = {}, setProps = {};
  for (const f of def.fields) {
    if (f.readOnly || !(f.key in body)) continue;
    let v = body[f.key];
    if (f.type === "list") {
      v = M.listOf(v);
      if (f.key === "emails") { const bad = v.find(x => !M.emailOf(x)); if (bad) return { error: `"${bad}" is not an email address.` }; v = [...new Set(v.map(M.emailOf))]; }
      cols[f.col] = JSON.stringify(v);
    } else if (f.key === "value_cents") {
      const n = Math.round(Number(v || 0));
      if (!Number.isFinite(n) || n < 0) return { error: "The value is a monthly amount of zero or more." };
      cols[f.col] = n;
    } else if (f.type === "number") {   // SALES-2: revenue, in whole dollars
      const t = v == null ? "" : String(v).replace(/[$,\s]/g, "");
      const n = t === "" ? null : Math.round(Number(t));
      if (n != null && !Number.isFinite(n)) return { error: `${f.label} is a number.` };
      cols[f.col] = n;
    } else if (f.type === "date") {
      const s = v ? String(v).slice(0, 10) : null;
      if (s && !DAY_RE.test(s)) return { error: `${f.label} is a day, like 2026-11-03.` };
      cols[f.col] = s;
    } else if (f.type === "picklist") {
      const s = M.clean(v);
      if (s && f.options && !f.options.includes(s)) return { error: `${f.label} is one of ${f.options.join(", ")}.` };
      cols[f.col] = s;
    } else {
      cols[f.col] = f.type === "url" ? (M.clean(v) || null) : M.clean(v);
    }
    if (f.required && !cols[f.col]) return { error: `${f.label} can't be empty.` };
  }
  if (!partial) for (const f of def.fields) if (f.required && !cols[f.col]) return { error: `${f.label} can't be empty.` };
  if (type === "org" && ("domain" in body || "website" in body)) {
    const d = M.domainOf(cols.domain) || (cols.domain === undefined || cols.domain === null ? M.domainOf(cols.website) : null);
    if (cols.domain && !M.domainOf(cols.domain)) return { error: `"${cols.domain}" is not a domain, like harborlight.org.` };
    if (d) cols.domain = d;
  }
  if (body.props && typeof body.props === "object") {
    for (const [k, v] of Object.entries(body.props)) {
      const p = props.find(x => x.key === k);
      if (!p) return { error: `There is no property "${k}" on ${def.plural.toLowerCase()}.` };
      const c = M.coerceProp(p.type, v, p.options || []);
      if (c.error) return { error: `${p.label} must be ${c.error}.` };
      setProps[k] = c.value;
    }
  }
  return { cols, props: setProps };
}

// Another live record with this org's domain or one of this contact's emails.
async function findDuplicates(query, type, { domain, emails }, exceptId = null) {
  if (type === "org" && domain) {
    return query(`SELECT id, name, domain FROM sales_orgs WHERE deleted_at IS NULL AND domain = ? AND id <> ?`, [domain, exceptId || ""]);
  }
  if (type === "contact" && emails && emails.length) {
    return query(`SELECT id, first_name, last_name, emails FROM sales_contacts WHERE deleted_at IS NULL AND jsonb_exists_any(emails, ?::text[]) AND id <> ?`, [emails, exceptId || ""]);
  }
  return [];
}

async function create(ctx, type, body, who, { force = false, importId = null } = {}) {
  const def = M.OBJECTS[type];
  const props = await properties(ctx.query, type);
  const n = normalize(type, body || {}, props, { partial: false });
  if (n.error) return { error: "invalid", message: n.error };
  if (type === "contact" && !n.cols.first_name && !n.cols.last_name && !(JSON.parse(n.cols.emails || "[]")).length)
    return { error: "invalid", message: "A contact needs a name or an email." };
  if (!force) {
    const dupes = await findDuplicates(ctx.query, type, { domain: n.cols.domain, emails: n.cols.emails ? JSON.parse(n.cols.emails) : [] });
    if (dupes.length) return { error: "duplicate", message: `${type === "org" ? "An organization with this domain" : "A contact with this email"} already exists: ${M.nameOf(type, dupes[0])}.`, duplicates: dupes.map(d => ({ id: d.id, name: M.nameOf(type, d) })) };
  }
  if (type === "deal") {
    await PIPES.ensureDefaults(ctx, who);
    const pipes = await PIPES.readAll(ctx.query);
    const pipe = pipes.find(p => p.id === n.cols.pipeline_id) || pipes[0];
    n.cols.pipeline_id = pipe.id;
    if (!pipe.stages.some(s => s.id === n.cols.stage_id)) n.cols.stage_id = pipe.stages[0].id;
    const need = closedNeeds(pipe.stages.find(s => s.id === n.cols.stage_id), { revisitOn: n.cols.revisit_on, lostReason: n.cols.lost_reason });
    if (need) return need;
  }
  const id = newId({ org: "sor", contact: "sco", deal: "sde" }[type]);
  const cols = { ...n.cols, owner_id: n.cols.owner_id || who.id };
  const names = Object.keys(cols);
  await ctx.run(`INSERT INTO ${def.table} (id, ${names.join(", ")}, props, import_id, created_by, created_by_name, updated_by, updated_by_name)
                 VALUES (?, ${names.map(() => "?").join(", ")}, ?::jsonb, ?, ?, ?, ?, ?)`,
    [id, ...names.map(k => cols[k]), JSON.stringify(n.props), importId, who.id, who.name, who.id, who.name]);
  if (type === "deal") {
    const [st] = await ctx.query(`SELECT name, kind FROM sales_stages WHERE id = ?`, [cols.stage_id]);
    await ctx.run(`INSERT INTO sales_stage_history (id, deal_id, from_stage_id, to_stage_id, from_name, to_name, created_by, created_by_name)
                   VALUES (?, ?, NULL, ?, NULL, ?, ?, ?)`, [newId("ssh"), id, cols.stage_id, st ? st.name : null, who.id, who.name]);
    if (st && (st.kind === "won" || st.kind === "lost")) await ctx.run(`UPDATE sales_deals SET ${st.kind === "won" ? "won_at" : "lost_at"} = NOW() WHERE id = ?`, [id]);
  }
  return { ok: true, id };
}

async function update(ctx, type, id, body, who, { force = false } = {}) {
  const def = M.OBJECTS[type];
  const [row] = await ctx.query(`SELECT id, props FROM ${def.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) return { error: "not_found" };
  const b = { ...(body || {}) };
  const stageTo = type === "deal" && "stage_id" in b ? b.stage_id : null;
  delete b.stage_id;   // a stage moves through setStage, so its history is kept
  const props = await properties(ctx.query, type);
  const n = normalize(type, b, props, { partial: true });
  if (n.error) return { error: "invalid", message: n.error };
  if (!force && (n.cols.domain || n.cols.emails)) {
    const dupes = await findDuplicates(ctx.query, type, { domain: n.cols.domain, emails: n.cols.emails ? JSON.parse(n.cols.emails) : [] }, id);
    if (dupes.length) return { error: "duplicate", message: `${type === "org" ? "An organization with this domain" : "A contact with this email"} already exists: ${M.nameOf(type, dupes[0])}.`, duplicates: dupes.map(d => ({ id: d.id, name: M.nameOf(type, d) })) };
  }
  const sets = Object.keys(n.cols).map(k => `${k} = ?`), vals = Object.values(n.cols);
  if (Object.keys(n.props).length) { sets.push(`props = props || ?::jsonb`); vals.push(JSON.stringify(n.props)); }
  if (sets.length) await ctx.run(`UPDATE ${def.table} SET ${sets.join(", ")}, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [...vals, who.id, who.name, id]);
  if (stageTo) { const s = await setStage(ctx, id, stageTo, who, { lostReason: b.lost_reason, revisitOn: b.revisit_on }); if (s.error) return s; }
  return { ok: true, id };
}

// The two closed stages each need their fact: Later a revisit day, Lost a reason.
function closedNeeds(st, { revisitOn, lostReason }) {
  if (!st) return null;
  if (st.kind === "later" && !(revisitOn && DAY_RE.test(String(revisitOn).slice(0, 10))))
    return { error: "invalid", need: "revisit_on", message: `${st.name} needs a revisit date: the day it comes back in Today.` };
  if (st.kind === "lost" && !M.clean(lostReason)) return { error: "invalid", need: "lost_reason", message: `${st.name} needs a reason.` };
  return null;
}

// Move a deal to a stage (the board's drag, the record page, a bulk change).
async function setStage(ctx, dealId, stageId, who, { lostReason, revisitOn } = {}) {
  await PIPES.ensureDefaults(ctx, who);
  const [d] = await ctx.query(`SELECT d.id, d.stage_id, d.pipeline_id, d.lost_reason, d.revisit_on::text AS revisit_on, s.name AS from_name FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id WHERE d.id = ? AND d.deleted_at IS NULL`, [dealId]);
  if (!d) return { error: "not_found" };
  const [st] = await ctx.query(`SELECT id, name, kind, pipeline_id FROM sales_stages WHERE id = ?`, [stageId]);
  if (!st) return { error: "invalid", message: "There is no such stage." };
  if (d.stage_id === st.id) return { ok: true, id: dealId, unchanged: true };
  const reason = M.clean(lostReason) || d.lost_reason, revisit = revisitOn ? String(revisitOn).slice(0, 10) : null;
  const need = closedNeeds(st, { revisitOn: revisit, lostReason: reason });
  if (need) return need;
  // Later sets neither won_at nor lost_at: it is never counted as a loss.
  await ctx.run(`UPDATE sales_deals SET stage_id = ?, pipeline_id = ?, stage_entered_at = NOW(),
                   won_at = CASE WHEN ? = 'won' THEN NOW() ELSE NULL END, lost_at = CASE WHEN ? = 'lost' THEN NOW() ELSE NULL END,
                   lost_reason = CASE WHEN ? = 'lost' THEN ? ELSE lost_reason END,
                   revisit_on = CASE WHEN ? = 'later' THEN ?::date ELSE revisit_on END,
                   updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`,
    [st.id, st.pipeline_id, st.kind, st.kind, st.kind, reason, st.kind, revisit, who.id, who.name, dealId]);
  await ctx.run(`INSERT INTO sales_stage_history (id, deal_id, from_stage_id, to_stage_id, from_name, to_name, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [newId("ssh"), dealId, d.stage_id, st.id, d.from_name, st.name, who.id, who.name]);
  if (st.kind === "won") await require("./cadences").onWon(ctx, dealId, who);   // SALES-2 item 10: Customer asks
  return { ok: true, id: dealId };
}

// Delete ONE record. Its links and everything it links to stay.
async function remove(ctx, type, id, who) {
  const def = M.OBJECTS[type];
  const r = await ctx.run(`UPDATE ${def.table} SET deleted_at = NOW(), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [who.id, who.name, id]);
  if (!r.changes) return { error: "not_found" };
  if (PLANT === "cascade" && type === "deal") {   // THE PLANTED DEFECT (tests only): a deal takes its org and contacts with it
    const linked = await ctx.query(`SELECT b_type, b_id FROM sales_links WHERE a_type = 'deal' AND a_id = ?`, [id]);
    for (const l of linked) await ctx.run(`UPDATE ${M.OBJECTS[l.b_type].table} SET deleted_at = NOW() WHERE id = ?`, [l.b_id]);
  }
  return { ok: true };
}

// One record's row (core fields, props) or null.
async function readRow(query, type, id, { withDeleted = false } = {}) {
  const def = M.OBJECTS[type];
  const cols = ["id", ...def.fields.map(f => f.col), "props", "deleted_at", "created_by_name", "updated_by_name",
    ...(type === "org" ? ["steward_org_id", "merged_into", ...DNC_COLS, "lost_at", "lost_reason", "bad_phones"] : type === "contact" ? ["merged_into", ...DNC_COLS, "bad_phones"] : ["stage_entered_at", "won_at", "lost_at"])];
  const [r] = await query(`SELECT ${[...new Set(cols)].map(M.sel).join(", ")} FROM ${def.table} WHERE id = ? ${withDeleted ? "" : "AND deleted_at IS NULL"}`, [id]);
  return r || null;
}

module.exports = { PLANT, closedNeeds, owners, properties, normalize, findDuplicates, create, update, setStage, remove, readRow };
