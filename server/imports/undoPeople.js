// server/imports/undoPeople.js · INTEGRITY-2. WHO AN IMPORT'S UNDO MAY MOVE,
// AND WHO HAS ACTIVITY SINCE.
//
// The rule (INTEGRITY-1, held here in one place): an undo moves only the
// people its own import created (donors.created_import_id) or restored from
// the trash (restoredPeople.js, a bring-back this run claimed). It finds them
// by those ids alone: never by name or email. A person who existed before the
// import never moves:
//   · a record that holds gifts entered before the import ran (a merge can put
//     an old donor's history on a record the file created) is history, and it
//     stays, named, with no "Move them too";
//   · everyone else the import only matched is not on either list.
//
// W-1107-Finance-17: the 1,000-row undo kept Hugo Kovac ("had activity since")
// and needed a second click. Activity now means something a person did since
// the import (a gift, a note, a call, a task, a timeline line) and not a line
// Steward wrote by itself (created_by system:…), and the people with activity
// are listed in Undo's confirm with the choice up front: keep them, or move
// them to the trash with the rest. One click either way.
"use strict";

// What was added to each person since, by a person. Rows the run itself wrote
// (import_id = this run) never count; the undo removes those first anyway.
async function activityOf(query, orgId, ids, imp) {
  if (!ids.length) return [];
  const since = imp.created_at || imp.committed_at;
  return query(
    `SELECT d.id, d.name, (d.created_import_id = ?) AS created,
            (SELECT COUNT(*) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.import_id IS DISTINCT FROM ?)::int AS gifts,
            (SELECT COUNT(*) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.import_id IS DISTINCT FROM ?
                AND g.created_at < ?::timestamptz)::int AS older_gifts,
            (SELECT COUNT(*) FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id AND i.import_id IS DISTINCT FROM ?
                AND COALESCE(i.created_by, '') NOT LIKE 'system:%' AND i.type = 'note')::int AS notes,
            (SELECT COUNT(*) FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id AND i.import_id IS DISTINCT FROM ?
                AND COALESCE(i.created_by, '') NOT LIKE 'system:%' AND i.type = 'call')::int AS calls,
            (SELECT COUNT(*) FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id AND i.import_id IS DISTINCT FROM ?
                AND COALESCE(i.created_by, '') NOT LIKE 'system:%' AND i.type NOT IN ('note', 'call') AND i.gift_id IS NULL)::int AS other,
            (SELECT COUNT(*) FROM tasks t WHERE t.org_id = d.org_id AND t.donor_id = d.id AND t.import_id IS DISTINCT FROM ?
                AND COALESCE(t.created_by, '') NOT LIKE 'system:%')::int AS tasks
       FROM donors d WHERE d.org_id = ? AND d.id = ANY(?) AND d.deleted_at IS NULL ORDER BY d.name, d.id`,
    [imp.id, imp.id, imp.id, since, imp.id, imp.id, imp.id, imp.id, orgId, ids]);
}

const plural = (k, one, many) => (k === 1 ? one : `${k} ${many}`);
function whyWords(r) {
  if (r.older_gifts) return `holds ${plural(r.older_gifts, "a gift", "gifts")} from before this import, so it was here first`;
  const w = [r.gifts && plural(r.gifts, "a gift", "gifts"), r.notes && plural(r.notes, "a note", "notes"), r.calls && plural(r.calls, "a call", "calls"),
    r.tasks && plural(r.tasks, "a task", "tasks"), r.other && plural(r.other, "a line on their timeline", "lines on their timeline")].filter(Boolean);
  return w.join(", ");
}
const hasActivity = r => !!(r.gifts || r.notes || r.calls || r.tasks || r.other);

// The people this run made or restored who are still live and have activity
// since (or history from before): [{ id, name, why, movable }].
async function peopleWithActivity(query, orgId, imp, restoredIds = []) {
  const made = (await query(`SELECT id FROM donors WHERE org_id = ? AND created_import_id = ? AND deleted_at IS NULL`, [orgId, imp.id])).map(r => r.id);
  const rows = await activityOf(query, orgId, [...new Set([...made, ...restoredIds])], imp);
  return rows.filter(r => hasActivity(r) || r.older_gifts)
    .map(r => ({ id: r.id, name: r.name, why: whyWords(r), movable: !r.older_gifts, ...(r.created ? {} : { restored: true }) }));
}

module.exports = { activityOf, whyWords, hasActivity, peopleWithActivity };
