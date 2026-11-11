// lib/linkedPeople.js · STALE-2 (W-1107-Donors-49X). WHO IS LINKED TO THIS
// PERSON, ONE LIST FOR EVERY SURFACE THAT SHOWS IT.
//
// The profile's rail listed the household's members and the relationship rows
// (spouse, family, works at…), while Household and related's "Linked people"
// read the relationship rows alone and said "Nobody linked yet" beside a
// household of three, and "Group into a household" offered a search of the
// whole org with the spouse nowhere in it. All three read this now: the
// household's other members first, then each relationship row whose person is
// not already in the household.
export function linkedPeople({ household = null, relationships = [], donorId = null } = {}) {
  const out = [];
  const inHousehold = new Set();
  for (const m of (household && household.members) || []) {
    if (!m || m.id === donorId) continue;
    inHousehold.add(m.id);
    out.push({ id: m.id, name: m.name, via: "household", member: m });
  }
  for (const r of relationships || []) {
    // CONNECT-1: how someone came in (r.direction) is said even of a household member.
    if (!r || (inHousehold.has(r.relatedDonorId) && !r.direction)) continue;
    out.push({ id: r.relatedDonorId, name: r.relatedDonorName, via: "relationship", rel: r });
  }
  return out;
}
