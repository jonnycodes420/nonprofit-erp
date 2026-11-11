// server/dataHealth/pairOwners.js · FLOWS-6 (W-1110-Donors-44X). NAMES, NOT IDS.
//
// The merge compare showed "user_jonathan" and "user_admin" for Assigned to:
// the field's raw value. The compare now carries each owner's name, read from
// the people on this org (or a member of it), so the screen never shows an id.
"use strict";

async function ownersByName(query, orgId, ids) {
  const want = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!want.length) return {};
  const rows = await query(
    `SELECT u.id, u.name FROM users u WHERE u.id = ANY(?::text[])
       AND (u.org_id = ? OR EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = u.id AND m.org_id = ?))`,
    [want, orgId, orgId]).catch(() => []);
  return Object.fromEntries(rows.filter(u => u.name).map(u => [u.id, u.name]));
}

module.exports = { ownersByName };
