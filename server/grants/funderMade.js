// server/grants/funderMade.js · POLISH-13 item 1 (W-1126-Donors-09). A GRANT'S
// DELETE TAKES THE FUNDER IT MADE.
//
// Staging, 25 Nov: "New grant" with a funder name nobody had made an
// organization record (funderLink.createFunderOrg); the grant was deleted 43
// seconds later and the organization stayed, a live Contact nobody had typed
// in. Everyone read 1,233 against the locked 1,232 ever after.
//
// UNDO-1's effects rule: what the write MADE goes with it. The funder is the
// grant's own when everything below holds; then the grant's delete moves it to
// the trash too (personTrash.trashPeople, the one door out) and the grant's
// Undo brings it back (personTrash.bringPeopleBack). A funder someone has used
// since (a gift, a pledge, a note, another grant, an edit) is theirs, and stays.
//   · kind organisation, created by the same person within a minute of the grant,
//     its name the grant's funder as typed (funderLink.normName)
//   · never edited (updated_at is its created_at), no other grant names it
//   · nothing of its own: no gift, pledge, conversation (but this grant's own stage lines), task, relationship or household
"use strict";
const FL = require("./funderLink");

// A timeline line THIS grant wrote on its funder (a stage change, metadata.grant_id) is the grant's
// own, so it does not make the funder anyone's; any other line does.
const OWN_LINE = "COALESCE(metadata->>'grant_id', '') = ?";
const TOUCHED = [
  ["gifts", "donor_id"], ["pledges", "donor_id"], ["tasks", "donor_id"],
  ["threads", "donor_id"], ["donor_relationships", "donor_id_a"], ["donor_relationships", "donor_id_b"],
];

// The funder record this grant made and nobody has used since, or null. `q` is (sql, args) => rows.
async function funderMadeBy(q, orgId, grant) {
  if (!grant || !grant.funder_donor_id) return null;
  const [d] = await q(
    `SELECT id, name, kind, created_by, created_at, updated_at, household_id, deleted_at FROM donors WHERE id = ? AND org_id = ?`,
    [grant.funder_donor_id, orgId]);
  if (!d || d.deleted_at || !FL.isOrg(d) || d.household_id) return null;
  if (String(d.created_by || "") !== String(grant.created_by || "")) return null;
  const made = new Date(d.created_at).getTime(), gr = new Date(grant.created_at).getTime();
  if (!(Math.abs(gr - made) <= 60 * 1000)) return null;
  if (d.updated_at && Math.abs(new Date(d.updated_at).getTime() - made) > 1000) return null;
  if (FL.normName(d.name) !== FL.normName(grant.funder)) return null;
  const [others] = await q(`SELECT COUNT(*)::int AS n FROM grants WHERE org_id = ? AND funder_donor_id = ? AND id <> ?`, [orgId, d.id, grant.id]);
  if (Number(others && others.n) > 0) return null;
  const [lines] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id = ? AND donor_id = ? AND NOT (${OWN_LINE})`, [orgId, d.id, String(grant.id)]).catch(() => [{ n: 1 }]);
  if (Number(lines && lines.n) > 0) return null;
  for (const [t, col] of TOUCHED) {
    const [r] = await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id = ? AND ${col} = ?`, [orgId, d.id]).catch(() => [{ n: 0 }]);
    if (Number(r && r.n) > 0) return null;
  }
  return d;
}

module.exports = { funderMadeBy };
