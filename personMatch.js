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
    const m = q.snapshot ? q.snapshot.byEmail(e, 1) : await q(
      `SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(TRIM(email))=?
        ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [orgId, e]);
    if (m.length) return m[0].id;
  }
  const n = String(name || "").trim();
  if (n) {
    const m = q.snapshot ? q.snapshot.byExactName(n, 2) : await q(
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

// QBO-IN · THE SAME ORDER, WITH THE ANSWER "I CANNOT TELL". A read from the
// books has nobody standing at the door to ask, so where findPersonId says
// null for two people of one name, this says which two, and a person picks.
// Email first (the oldest record wins, as above). Then the name, keeping only
// people whose email does not disagree; if more than one is left, the street
// line or postcode decides; if it still cannot, the answer is "ambiguous" with
// the candidates. Nothing is guessed.
const lc = s => String(s || "").trim().toLowerCase();
async function matchPerson(orgId, { email, name, line1, postal } = {}, q = query) {
  const e = lc(email);
  if (e) {
    const m = await q(
      `SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(TRIM(email))=?
        ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [orgId, e]);
    if (m.length) return { status: "matched", id: m[0].id, by: "email", candidates: [] };
  }
  const n = String(name || "").trim();
  if (!n) return { status: "none", id: null, by: null, candidates: [] };
  const rows = await q(
    `SELECT id, name, email, address, zip FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND LOWER(TRIM(name))=LOWER(?) ORDER BY created_at ASC NULLS LAST, id LIMIT 10`, [orgId, n]);
  const same = rows.filter(r => !e || !lc(r.email) || lc(r.email) === e);
  if (!same.length) return { status: "none", id: null, by: null, candidates: [] };
  if (same.length === 1) return { status: "matched", id: same[0].id, by: "name", candidates: [] };
  const street = lc(line1), zip = lc(postal).slice(0, 5);
  const byAddress = (street || zip) ? same.filter(r =>
    (street && lc(r.address).includes(street)) || (zip && lc(r.zip).slice(0, 5) === zip)) : [];
  if (byAddress.length === 1) return { status: "matched", id: byAddress[0].id, by: "name and address", candidates: [] };
  return { status: "ambiguous", id: null, by: null,
    candidates: same.map(r => ({ id: r.id, name: r.name, email: r.email || null, address: r.address || null })) };
}

module.exports = { findPersonId, findOrCreateGuest, matchPerson };
