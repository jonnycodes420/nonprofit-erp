// server/shared/auditLog.js — reading the audit log: the query, the people and the sentence for each row.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
// FIX-11 Part 1 — the audit log's own vocabulary (the sentence a row reads as).
// The WRITING of a row happens in middleware/auditTrail.js and nowhere else.
const auditTrailMod = require("../../auditTrail");
const auditMw = require("../../middleware/auditTrail");

function mount(ctx) {
const {
  inOrgDays, query,
} = ctx;

// ── FIX-11 Part 1 — THE AUDIT LOG SCREEN'S ROUTES ─────────────────────────
// One read for the whole organisation's history, newest first, and one CSV of
// the same rows. The old /finance/audit-log stays where it is and keeps the
// Finance tab working; it is the same table, filtered to nothing in
// particular, and this is the screen that covers everything.
//
// OWNERS AND ADMINS ONLY, and that is a boundary rather than a preference: the
// log names who signed in, whose role changed and who downloaded a donor file.
// Showing it to everybody would turn an accountability record into a
// surveillance feed.
const AUDIT_COLS = `id, created_at, user_id, user_name, actor_kind, action, entity_type, entity_id,
  entity_label, summary, record_count, request_method, request_path, status_code, changes,
  before_fields, after_fields`;

async function auditQuery(req, q0 = req.query) {
  const { actor, entityType, action, from, to, q: search } = q0;
  const limit = Math.max(1, Math.min(2000, parseInt(q0.limit, 10) || 200));
  const offset = Math.max(0, parseInt(q0.offset, 10) || 0);
  let sql = `SELECT ${AUDIT_COLS} FROM fin_audit_log WHERE org_id = ?`;
  const params = [req.user.orgId];
  // FIX-12 Part 4: rows from FIX-12 on carry the actor's id, not a name, so a
  // name chosen in the filter also matches the ids of the people it names.
  if (actor) {
    sql += " AND (user_id = ? OR user_name = ? OR user_id IN (SELECT id FROM users WHERE org_id = ? AND (name = ? OR email = ?)))";
    params.push(actor, actor, req.user.orgId, actor, actor);
  }
  if (entityType) { sql += " AND entity_type = ?"; params.push(entityType); }
  if (action) { sql += " AND action = ?"; params.push(action); }
  // FIX-14 Part 2 — BY PERSON OR BY RECORD. A person is everything about
  // them: their own record, and every conversation, step, task and gift that
  // carries their id. A record is one entity id exactly.
  if (q0.person) {
    sql += ` AND (entity_id = ? OR after_fields->>'donor_id' = ? OR before_fields->>'donor_id' = ?
                  OR changes->'record'->>'donor_id' = ?)`;
    const pid = String(q0.person);
    params.push(pid, pid, pid, pid);
  }
  if (q0.record) { sql += " AND entity_id = ?"; params.push(String(q0.record)); }
  if (from) { sql += ` AND ${inOrgDays("created_at", "org_id", "?", null)}`; params.push(from); }
  // `to` is inclusive of the whole day somebody typed, which is what a person
  // filtering "up to the 30th" means. An exclusive bound silently drops that
  // day's rows and reads as a missing record.
  if (to) { sql += ` AND ${inOrgDays("created_at", "org_id", null, "?")}`; params.push(to); }
  // SEARCH BY DONOR NAME is the one a fundraiser actually needs, so it matches
  // the label the row carries (the donor's name) as well as the person who
  // acted and the record id, rather than making her know which field it is in.
  if (search && String(search).trim()) {
    sql += ` AND (entity_label ILIKE ? OR user_name ILIKE ? OR entity_id = ? OR summary ILIKE ?
                  OR after_fields::text ILIKE ? OR before_fields::text ILIKE ?
                  OR entity_id IN (SELECT id FROM donors WHERE org_id = ? AND erased_at IS NULL AND name ILIKE ?)
                  OR user_id IN (SELECT id FROM users WHERE org_id = ? AND (name ILIKE ? OR email ILIKE ?)))`;
    const like = "%" + String(search).trim() + "%";
    params.push(like, like, String(search).trim(), like, like, like, req.user.orgId, like, req.user.orgId, like, like);
  }
  sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return auditMw.resolveAuditNames(await query(sql, params), req.user.orgId);
}

// Which record a row opens. A voided gift and a deleted donor still open,
// read-only, because the row whose history this is may well be the one
// somebody is trying to account for.
function auditRecordLink(r) {
  const t = String(r.entity_type || "");
  const id = r.entity_id;
  if (!id) return null;
  // FIX-14 Part 2: a conversation, next step or task opens the person it is about.
  const donorId = auditTrailMod.auditDonorId({ ...r, changes: auditJson(r.changes, {}),
    before: auditJson(r.before_fields, null), after: auditJson(r.after_fields, null) });
  if (/^(interaction|conversation|touchpoint|thread|next step|task|relationship|donor relationship|pledge|proposal)$/.test(t) && donorId) {
    return { tab: "donors", donorId };
  }
  if (/^user_/.test(String(id))) return { tab: "settings", section: "team" };
  if (/^(donor|person|people|organisation|organization|stage)$/.test(t)) return { tab: "donors", donorId: id };
  if (/^(gift|pledge|receipt|refund|soft credit)$/.test(t)) return { tab: "donors", giftId: id };
  if (/^(user|invite|role)$/.test(t)) return { tab: "settings", section: "team" };
  if (/^(fund|account|transaction|budget)$/.test(t)) return { tab: "finance", recordId: id };
  if (/^(campaign|appeal|giving page|form|widget)$/.test(t)) return { tab: "fundraising", recordId: id };
  if (/^(event|ticket|guest|table|seat)$/.test(t)) return { tab: "events", recordId: id };
  if (/^(volunteer|shift|hour|waiver)$/.test(t)) return { tab: "volunteers", recordId: id };
  if (/^(grant|funder|milestone)$/.test(t)) return { tab: "grants", recordId: id };
  if (/^(import|export)$/.test(t)) return { tab: "settings", section: "imports" };
  if (/^(connection|api key|webhook|mailbox)$/.test(t)) return { tab: "settings", section: "connections" };
  return { tab: "settings", section: "audit", recordId: id };
}

function auditJson(v, dflt) {
  if (typeof v === "string") { try { return JSON.parse(v || "null") ?? dflt; } catch { return dflt; } }
  return v || dflt;
}
const auditRowOut = (r, people) => {
  const o = {
    ...r,
    changes: auditJson(r.changes, {}),
    before: auditJson(r.before_fields, null),
    after: auditJson(r.after_fields, null),
    sentence: auditTrailMod.rowSentence(r),
    link: auditRecordLink(r),
  };
  // FIX-14 Part 2: the Description, in a plain sentence. Never a dash.
  o.description = auditTrailMod.describeAuditRow(o, { people: people || new Map() });
  o.record_name = auditTrailMod.auditRecordName(o, { people: people || new Map() });
  return o;
};
// The names the sentences need, read live (FIX-12: the row holds ids). An
// erased person reads "Erased person", as everywhere else in the log.
async function auditPeople(rows, orgId) {
  const ids = new Set();
  for (const r of rows) {
    // FIX-14 Part 2b: both sides of a relationship and a household's members too.
    for (const id of auditTrailMod.auditPeopleIds({ ...r, changes: auditJson(r.changes, {}),
      before: auditJson(r.before_fields, null), after: auditJson(r.after_fields, null) })) ids.add(String(id));
  }
  const people = new Map();
  if (ids.size) {
    const ds = await query("SELECT id, name, erased_at FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, [...ids]]).catch(() => []);
    for (const d of ds) people.set(d.id, d.erased_at ? "Erased person" : (d.name || "a person with no name"));
  }
  // FIX-14 Part 2b: a household's name, live, or as it was when it was deleted.
  const hhIds = [...new Set(rows.filter(r => r.entity_type === "household" && r.entity_id).map(r => String(r.entity_id)))];
  if (hhIds.length) {
    const hs = await query(
      `SELECT id, name FROM households WHERE org_id=? AND id = ANY(?)
       UNION ALL SELECT record_id, row_data->>'name' FROM deleted_records WHERE org_id=? AND table_name='households' AND record_id = ANY(?)`,
      [orgId, hhIds, orgId, hhIds]).catch(() => []);
    for (const h of hs) if (h.name && !people.has("hh:" + h.id)) people.set("hh:" + h.id, h.name);
  }
  return people;
}
async function auditDescribe(rows, orgId) {
  const people = await auditPeople(rows, orgId);
  return rows.map(r => auditRowOut(r, people));
}
return { AUDIT_COLS, auditDescribe, auditPeople, auditQuery, auditRowOut };
}

module.exports = { mount };
