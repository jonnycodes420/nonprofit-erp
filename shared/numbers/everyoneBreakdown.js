// shared/numbers/everyoneBreakdown.js · INTEGRITY-2 (W-1107-Prod-04). WHERE
// DOES EVERYONE COME FROM?
//
// Everyone read 1,218 against a baseline of 1,217 and nobody could say which
// record was the extra one. The count now opens: the same Everyone fragment
// (everyone.js EVERYONE, which never counts the trash) split into the parts
// that add up to it, plus what it leaves out and the newest records, so the
// one that arrived last can be named.
//   · Donors: everyone whose types include Donor (the Donors tab).
//   · Contacts: everyone else (the Contacts tab), split by type: volunteers,
//     staff and board, organizations, other.
//   · Not counted: in the trash, archived, erased.
// Donors + Contacts = Everyone, by construction (the same split as
// groups.directoryRoles). The donor predicate is shared/personType.js's
// (NULL types read as a donor, a legacy row).
"use strict";
const { EVERYONE } = require("./everyone");

const DONOR = d => `(${d}.person_types IS NULL OR ${d}.person_types @> '["donor"]'::jsonb)`;
const HAS = (d, t) => `(${d}.person_types @> '["${t}"]'::jsonb)`;
const ORG = d => `(LOWER(COALESCE(${d}.kind, '')) IN ('organisation', 'organization') OR ${d}.person_types @> '["organization"]'::jsonb)`;

async function everyoneBreakdown(query, orgId, { newest = 5 } = {}) {
  const [r] = await query(
    `SELECT COUNT(*) FILTER (WHERE ${EVERYONE("d")})::int AS everyone,
            COUNT(*) FILTER (WHERE ${EVERYONE("d")} AND ${DONOR("d")})::int AS donors,
            COUNT(*) FILTER (WHERE ${EVERYONE("d")} AND NOT ${DONOR("d")})::int AS contacts,
            COUNT(*) FILTER (WHERE ${EVERYONE("d")} AND NOT ${DONOR("d")} AND ${ORG("d")})::int AS c_orgs,
            COUNT(*) FILTER (WHERE ${EVERYONE("d")} AND NOT ${DONOR("d")} AND NOT ${ORG("d")} AND ${HAS("d", "volunteer")})::int AS c_volunteers,
            COUNT(*) FILTER (WHERE ${EVERYONE("d")} AND NOT ${DONOR("d")} AND NOT ${ORG("d")} AND NOT ${HAS("d", "volunteer")} AND ${HAS("d", "staff_board")})::int AS c_staff,
            COUNT(*) FILTER (WHERE d.deleted_at IS NOT NULL AND d.erased_at IS NULL)::int AS trash,
            COUNT(*) FILTER (WHERE d.deleted_at IS NULL AND d.erased_at IS NULL AND d.archived_at IS NOT NULL)::int AS archived,
            COUNT(*) FILTER (WHERE d.erased_at IS NOT NULL)::int AS erased
       FROM donors d WHERE d.org_id = ?`, [orgId]);
  const recent = await query(
    `SELECT d.id, d.name, d.created_at, d.created_by, d.created_by_name, d.created_import_id, ${DONOR("d")} AS donor
       FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")} ORDER BY d.created_at DESC NULLS LAST, d.id DESC LIMIT ?`, [orgId, newest]);
  const n = k => Number(k) || 0;
  const cOther = n(r.contacts) - n(r.c_orgs) - n(r.c_volunteers) - n(r.c_staff);
  const fmt = k => n(k).toLocaleString("en-US");
  return {
    everyone: n(r.everyone),
    parts: [
      { key: "donors", label: "Donors", n: n(r.donors), sentence: "People and organizations marked as donors (the Donors tab)." },
      { key: "contacts", label: "Contacts", n: n(r.contacts), sentence: "Everyone who is not marked as a donor (the Contacts tab).",
        parts: [
          { key: "organizations", label: "Organizations", n: n(r.c_orgs) },
          { key: "volunteers", label: "Volunteers", n: n(r.c_volunteers) },
          { key: "staff_board", label: "Staff and board", n: n(r.c_staff) },
          { key: "other", label: "Other contacts", n: cOther },
        ] },
    ],
    notCounted: { trash: n(r.trash), archived: n(r.archived), erased: n(r.erased),
      sentence: `Not counted: ${fmt(r.trash)} in the trash, ${fmt(r.archived)} archived, ${fmt(r.erased)} erased. A user's login is never a person here.` },
    newest: recent.map(x => ({ id: x.id, name: x.name, createdAt: x.created_at, donor: !!x.donor,
      how: x.created_import_id ? "from an import" : String(x.created_by || "").startsWith("system:") ? `added by Steward (${x.created_by.slice(7)})` : x.created_by_name ? `added by ${x.created_by_name}` : "added" })),
    sentence: `Everyone is ${fmt(r.everyone)}: ${fmt(r.donors)} donors and ${fmt(r.contacts)} contacts. It never counts the trash, archived or erased records.`,
  };
}

module.exports = { everyoneBreakdown };
