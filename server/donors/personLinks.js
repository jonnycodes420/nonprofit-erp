// server/donors/personLinks.js · INTEGRITY-2 (W-1108-Donors-45X). A PERSON'S
// LINKS GO TO THE TRASH WITH THEM AND COME BACK WITH RESTORE.
//
// Deleting a donor was soft (donors.deleted_at) and touched nothing else, so
// every link to them stayed: an organization went on reading "Owner: QA A1
// Marlowe Dup · $0" and a household kept a member nobody could open. Now the
// one door out (trashPeople in personTrash.js) takes, in the delete's own
// transaction:
//   · every donor_relationships row that names them (spouse, partner,
//     household, family, owner, works at, employer match),
//   · their household membership (donors.household_id), and
//   · any household that names them as its primary person,
// and keeps each in their trash row (row_data.__links). The one door back
// (bringPeopleBack) puts them back: a relationship returns once both ends
// are live, a membership only while the household still exists and they
// have not joined another, a primary only while nobody else took the place.
"use strict";

// Inside the delete's transaction (c). Returns Map(personId -> links).
async function takeLinks(db, c, orgId, ids) {
  const list = [...new Set((ids || []).map(String))];
  const out = new Map(list.map(id => [id, { relationships: [], household: null, primaryOf: [] }]));
  if (!list.length) return out;
  const rels = await db.queryTx(c, `SELECT * FROM donor_relationships WHERE org_id = ? AND (donor_id_a = ANY(?) OR donor_id_b = ANY(?))`, [orgId, list, list]);
  for (const r of rels) {
    for (const end of [r.donor_id_a, r.donor_id_b]) if (out.has(end)) out.get(end).relationships.push(r);
  }
  if (rels.length) await db.runTx(c, `DELETE FROM donor_relationships WHERE org_id = ? AND id = ANY(?)`, [orgId, rels.map(r => r.id)]);
  const members = await db.queryTx(c, `SELECT id, household_id FROM donors WHERE org_id = ? AND id = ANY(?) AND household_id IS NOT NULL`, [orgId, list]);
  for (const m of members) out.get(m.id).household = m.household_id;
  if (members.length) await db.runTx(c, `UPDATE donors SET household_id = NULL WHERE org_id = ? AND id = ANY(?)`, [orgId, members.map(m => m.id)]);
  const heads = await db.queryTx(c, `SELECT id, primary_donor_id FROM households WHERE org_id = ? AND primary_donor_id = ANY(?)`, [orgId, list]);
  for (const h of heads) out.get(h.primary_donor_id).primaryOf.push(h.id);
  if (heads.length) await db.runTx(c, `UPDATE households SET primary_donor_id = NULL, updated_at = NOW() WHERE org_id = ? AND id = ANY(?)`, [orgId, heads.map(h => h.id)]);
  return out;
}

const hasLinks = l => !!l && (l.relationships.length || l.household || l.primaryOf.length);

// Inside the restore's transaction. `links` are the __links of the trash rows
// being closed, for people who are live again. Returns how many came back.
async function giveLinks(db, c, orgId, linksList) {
  let n = 0;
  for (const { personId, links } of linksList) {
    if (!links) continue;
    for (const r of links.relationships || []) {
      // both ends live (the other may still be in the trash: their own Restore brings it)
      const [ok] = await db.queryTx(c, `SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, [r.donor_id_a, r.donor_id_b]]);
      if (!ok || ok.n < 2) continue;
      const got = await db.queryTx(c, `INSERT INTO donor_relationships SELECT * FROM jsonb_populate_record(NULL::donor_relationships, ?::jsonb)
                                       ON CONFLICT DO NOTHING RETURNING id`, [JSON.stringify(r)]).catch(() => []);
      n += got.length;
    }
    if (links.household) {
      const got = await db.queryTx(c, `UPDATE donors SET household_id = ? WHERE org_id = ? AND id = ? AND household_id IS NULL
                                         AND EXISTS (SELECT 1 FROM households h WHERE h.id = ? AND h.org_id = ?) RETURNING id`,
        [links.household, orgId, personId, links.household, orgId]);
      n += got.length;
    }
    for (const h of links.primaryOf || []) {
      const got = await db.queryTx(c, `UPDATE households SET primary_donor_id = ?, updated_at = NOW() WHERE org_id = ? AND id = ? AND primary_donor_id IS NULL RETURNING id`,
        [personId, orgId, h]);
      n += got.length;
    }
  }
  return n;
}

// What goes with them, for the delete's confirm. Read only.
async function whatGoesWith(query, orgId, ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return { gifts: 0, links: 0, households: 0, openTasks: 0 };
  const [r] = await query(
    `SELECT (SELECT COUNT(*) FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?))::int AS gifts,
            (SELECT COUNT(*) FROM donor_relationships dr WHERE dr.org_id = ? AND (dr.donor_id_a = ANY(?) OR dr.donor_id_b = ANY(?)))::int AS links,
            (SELECT COUNT(*) FROM donors d WHERE d.org_id = ? AND d.id = ANY(?) AND d.household_id IS NOT NULL)::int AS households,
            (SELECT COUNT(*) FROM tasks t WHERE t.org_id = ? AND t.donor_id = ANY(?) AND COALESCE(t.done, 0)::int = 0 AND t.voided_at IS NULL)::int AS open_tasks`,
    [orgId, list, orgId, list, list, orgId, list, orgId, list]);
  // the gifts stay rows and stay in every total that counts the trash; the person's lifetime is on the screen already
  return { gifts: r.gifts, links: r.links, households: r.households, openTasks: r.open_tasks };
}

module.exports = { takeLinks, giveLinks, hasLinks, whatGoesWith };
