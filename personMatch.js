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

module.exports = { findPersonId };
