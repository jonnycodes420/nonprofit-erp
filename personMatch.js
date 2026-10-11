// WIRE-1 rule 1 · ONE RECORD PER PERSON.
//
// Every door a person can come in by (an event registration, a fundraising
// page, a membership, a volunteer sign-up, a mailbox correspondent, a funder
// contact) asks this first, and makes a new record only when it answers null.
//
// The order is the volunteer page's (routes/volunteerScheduling.js
// findOrCreatePerson), with two corrections it taught:
//   1. Email, lower-cased. Two records already sharing an address is a
//      duplicate the Data health screen merges; a third is never made, so the
//      oldest of them is the answer.
//   2. Name, only when exactly one person has it, and only when that person
//      has no email or the same one. A different address under the same name
//      is somebody else: two Maria Lopezes are two people.
const { query } = require("./db");

async function findPersonId(orgId, { email, name } = {}, q = query) {
  const e = String(email || "").trim().toLowerCase();
  if (e) {
    const m = await q(
      `SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(TRIM(email))=?
        ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [orgId, e]);
    if (m.length) return m[0].id;
  }
  const n = String(name || "").trim();
  if (n) {
    const m = await q(
      `SELECT id, email FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(TRIM(name))=LOWER(?) LIMIT 2`, [orgId, n]);
    if (m.length === 1) {
      const theirs = String(m[0].email || "").trim().toLowerCase();
      if (!e || !theirs || theirs === e) return m[0].id;
    }
  }
  return null;
}

// JOURNEYS-4 · A GUEST IS ONE PERSON RECORD. A name on somebody else's
// registration is matched like any other door (a unique name, no email to
// disagree with), and is a new record only when nobody matches. The new one
// is a person, not a donor: they have given nothing yet.
async function findOrCreateGuest(orgId, name, who, q = query) {
  const n = String(name || "").trim().slice(0, 200);
  if (!n) return null;
  const known = await findPersonId(orgId, { name: n }, q);
  if (known) return known;
  const id = "d_" + require("crypto").randomUUID().replace(/-/g, "").slice(0, 10);
  await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,person_types,created_by,created_by_name)
           VALUES (?,?,?,'prospect','active','[]','["other"]'::jsonb,?,?)`,
    [id, orgId, n, who.id, who.name]);
  return id;
}

module.exports = { findPersonId, findOrCreateGuest };
