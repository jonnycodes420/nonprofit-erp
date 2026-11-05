// server/grants/funderLink.js · GRANTS-FIX. HOW A GRANT FINDS ITS FUNDER.
//
// A grant's `funder` is the name somebody typed; `funder_donor_id` is the
// organization record the award's pledge belongs to. Grants from older paths
// (the Pipeline's New grant form, the general PUT, the boot seed) carried only
// the typed name, so Steward refused to award them and offered no way to link.
//
// THE ONE RESOLVER. Every path that writes a grant without a funder id asks
// `resolveGrantFunder`: the organization whose name is exactly the typed name
// (case and spacing aside), else a new organization with that name. It never
// guesses past that:
//   · two organizations with that exact name — left unlinked for a person;
//   · the name belongs only to a person — left unlinked for a person (a gift
//     from Margaret Chen is not a grant from the Margaret Chen Trust).
// It NEVER renames an existing record and never merges two. Linking keeps the
// typed name on the grant.
//
// `db` is { q, r }: query and run, either the pool's or a transaction's.
"use strict";
const { newId } = require("../shared/newId");   // IDS-1

const ORG_SQL = "LOWER(COALESCE(kind,'person')) IN ('organisation','organization')";
const normName = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
const isOrg = d => /^organi[sz]ation$/.test(String((d && d.kind) || "person").toLowerCase());

// Every live record in the org whose name is exactly `name`.
async function sameName(db, orgId, name) {
  const n = normName(name);
  if (!n) return [];
  return db.q(
    `SELECT id, name, kind FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND LOWER(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ?
      ORDER BY created_at NULLS LAST, id`, [orgId, n]);
}

// What resolving `name` would do, without writing: the plan the dry run prints.
//   { action: "link", donorId, donorName } | { action: "create", name }
//   | { action: "leave", why: "ambiguous" | "person" | "no_name", matches }
async function planFunder(db, orgId, name) {
  const typed = String(name == null ? "" : name).trim().replace(/\s+/g, " ");
  if (!typed) return { action: "leave", why: "no_name", matches: [] };
  const rows = await sameName(db, orgId, typed);
  const orgs = rows.filter(isOrg);
  if (orgs.length === 1) return { action: "link", donorId: orgs[0].id, donorName: orgs[0].name };
  if (orgs.length > 1) return { action: "leave", why: "ambiguous", matches: orgs.map(o => ({ id: o.id, name: o.name })) };
  if (rows.length) return { action: "leave", why: "person", matches: rows.map(o => ({ id: o.id, name: o.name })) };
  return { action: "create", name: typed };
}

// A new organization record for a funder: kind organisation, funder type
// unset. The caller's actor is stamped (a user, or a system:<path> identity).
async function createFunderOrg(db, orgId, name, who) {
  const id = newId("d");
  await db.r(
    `INSERT INTO donors (id,org_id,name,kind,person_types,stage,status,tags,created_by,created_by_name)
     VALUES (?,?,?,'organisation','["other"]'::jsonb,'prospect','active','[]',?,?)`,
    [id, orgId, String(name).trim().replace(/\s+/g, " ").slice(0, 200), who.id, who.name]);
  return id;
}

// Resolve, creating when nothing matches. Returns
//   { donorId, how: "existing" | "created" | null, why?, matches? }
async function resolveGrantFunder(db, orgId, name, who) {
  const p = await planFunder(db, orgId, name);
  if (p.action === "link") return { donorId: p.donorId, how: "existing" };
  if (p.action === "create") return { donorId: await createFunderOrg(db, orgId, p.name, who), how: "created" };
  return { donorId: null, how: null, why: p.why, matches: p.matches };
}

// The picker: the org's organizations matching what was typed, by name then
// by EIN, the exact-name match first.
async function searchFunderOrgs(db, orgId, text, limit = 12) {
  const t = String(text || "").trim();
  const digits = t.replace(/\D/g, "");
  const like = "%" + t.toLowerCase().replace(/[%_\\]/g, m => "\\" + m) + "%";
  const rows = await db.q(
    `SELECT id, name, funder_type, funder_ein, city, state FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND ${ORG_SQL}
        AND (? = '' OR LOWER(name) LIKE ? OR (? <> '' AND regexp_replace(COALESCE(funder_ein,''), '\\D', '', 'g') LIKE ?))
      ORDER BY (LOWER(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ?) DESC,
               (LOWER(name) LIKE ?) DESC, name
      LIMIT ?`,
    [orgId, t, like, digits.length >= 3 ? digits : "", digits.length >= 3 ? digits + "%" : "", normName(t), like, limit]);
  const n = normName(t);
  return rows.map(d => ({ id: d.id, name: d.name, funderType: d.funder_type || null, ein: d.funder_ein || null,
    city: d.city || null, state: d.state || null, exact: !!n && normName(d.name) === n }));
}

// Point a grant at an organization record. The typed name stays as it is.
async function linkGrant(db, orgId, grantId, donorId) {
  return db.r(`UPDATE grants SET funder_donor_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [donorId, grantId, orgId]);
}

module.exports = { normName, isOrg, planFunder, createFunderOrg, resolveGrantFunder, searchFunderOrgs, linkGrant };
