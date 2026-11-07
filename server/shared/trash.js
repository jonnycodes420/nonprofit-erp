// server/shared/trash.js — who may edit a logged row, and the trash with its undo window.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

const { newId } = require("./newId");   // IDS-1: every new row id is prefix + 20 hex

function mount(ctx) {
const {
  actor, query, queryTx, runTx, uuid, withTransaction,
} = ctx;

// ── FIX-14 Part 2 — EDIT WHAT YOU LOGGED, AND UNDO A DELETE ────────────────
// Whoever logged an entry may change it, and so may an admin. A conversation
// is edited through the same fields it was created with; the audit row the
// middleware writes for this request holds the before and after of every
// field that moved, so the previous version is never lost.
async function mayEditLogged(req, row) {
  if (row && row.created_by && row.created_by === req.user.userId) return true;
  const [u] = await query("SELECT role FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]);
  return !!(u && u.role === "admin");
}
const NOT_YOURS = { error: "not_yours", sentence: "Only the person who logged this, or an admin, can change it." };

// Move a row into deleted_records and out of its table, in one transaction.
// Returns the trash id Undo needs, or null when there was no such row.
const RESTORABLE = new Set(["interactions", "threads", "tasks", "donor_relationships",
  "pledges", "opportunities", "households",
  // FIX-22: the deletes that used to sit behind a browser confirm and had no
  // way back. Each is now moved aside and offered for Undo instead.
  "planned_gifts", "donor_materials", "impact_metrics", "event_attendees", "saved_dashboards", "campaigns"]);
// FIX-14 Part 2b — WHAT GOES WITH A ROW. Some rows take other rows with them
// when they are deleted (a pledge's instalments cascade, a household's members
// are unlinked, a calendar meeting points at its logged conversation). The
// hook runs inside the delete's transaction, BEFORE the row goes, and returns
// what Undo needs to put those back; RESTORE_WITH puts them back.
const TRASH_WITH = {
  interactions: async (client, id, orgId) => {
    const ev = await queryTx(client, "SELECT id FROM calendar_events WHERE interaction_id = ? AND org_id = ?", [id, orgId]);
    if (!ev.length) return null;
    await runTx(client, "UPDATE calendar_events SET interaction_id = NULL, updated_at = NOW() WHERE interaction_id = ? AND org_id = ?", [id, orgId]);
    return { calendar_event_ids: ev.map(e => e.id) };
  },
  pledges: async (client, id, orgId) => ({
    installments: await queryTx(client, "SELECT * FROM pledge_installments WHERE pledge_id = ?", [id]),
    // PLEDGES-2: its "Pledged" line and collect tasks go with it (pledgePayments.js).
    ...((await require("../donors/pledgePayments").trashWith(client, id, orgId)) || {}),
  }),
  households: async (client, id, orgId) => ({
    member_ids: (await queryTx(client, "SELECT id FROM donors WHERE household_id = ? AND org_id = ?", [id, orgId])).map(d => d.id),
  }),
  // A campaign's recipient rows cascade with it; a board-pack schedule loses
  // its dashboard (SET NULL). Both come back with Undo.
  campaigns: async (client, id, orgId) => ({
    recipients: await queryTx(client, "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND org_id = ?", [id, orgId]),
  }),
  saved_dashboards: async (client, id, orgId) => ({
    schedule_ids: (await queryTx(client, "SELECT id FROM board_pack_schedules WHERE dashboard_id = ? AND org_id = ?", [id, orgId])).map(r => r.id),
  }),  // STALE-2: a guest's "Registered for" / "Came to" lines go with the guest,
  // and come back with the guest's Undo (server/events/attendanceLines.js).
  event_attendees: (client, id, orgId) => require("../events/attendanceLines").takeLines(client, id, orgId),
};
// Who edited, for the edited_by / edited_by_name stamp.
async function editStamp(req) {
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  return [req.user.userId, u?.name || req.user.email || ""];
}
async function trashRow(table, id, req) {
  if (!RESTORABLE.has(table)) throw new Error("not a restorable table: " + table);
  const who = actor(req);
  return withTransaction(async client => {
    const rows = await queryTx(client, `SELECT * FROM ${table} WHERE id = ? AND org_id = ? FOR UPDATE`, [id, req.user.orgId]);
    if (!rows.length) return null;
    const trashId = newId("del");
    const withRow = TRASH_WITH[table] ? await TRASH_WITH[table](client, id, req.user.orgId) : null;
    // `__with` is not a column, so jsonb_populate_record ignores it on Undo.
    await runTx(client,
      `INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
       SELECT ?, ?, ?, ?, to_jsonb(t) || ?::jsonb, ?, ? FROM ${table} t WHERE t.id = ? AND t.org_id = ?`,
      [trashId, req.user.orgId, table, id, JSON.stringify(withRow ? { __with: withRow } : {}), who.id, who.name, id, req.user.orgId]);
    await runTx(client, `DELETE FROM ${table} WHERE id = ? AND org_id = ?`, [id, req.user.orgId]);
    return trashId;
  });
}
// FIX-45: a minute on the toast; Recent changes lists the trash row after that.
const UNDO_SECONDS = 60;

// Validate a proposed member set: all ids exist in this org, none already in
// a DIFFERENT household. Returns { error } (with status) or { ids, primary }.
// ── BUILD-97 Part 2 — AN ORGANISATION IS NOT A PERSON, AND THE PERSON
// SURFACES ARE WHERE THAT HAS TEETH ────────────────────────────────────────
// BUILD-80 Part 7 gave `donors.kind` three values and used it to keep
// organisations off Drift and the re-engage list, and stopped there. Two person
// surfaces were left open, and both are the kind of wrong that reaches a donor:
//
//   · A HOUSEHOLD is a marriage or a family living at one address, combined for
//     acknowledgment. "The Sunrise Foundation Household" is not a thing, and
//     the combined figure it produces would put a foundation's grants on a
//     person's giving record.
//   · A PLANNED GIFT is a bequest, an estate, an IRA beneficiary designation, a
//     life-insurance policy. Every one of them is a thing that happens because
//     a PERSON died. A foundation does not leave a bequest, and a chip on its
//     record saying it might is the product not knowing what it is looking at.
//
// One helper, one sentence, so the two refusals cannot drift apart. Kind NULL
// is a legacy row and reads as a person (the BUILD-84 rule), so nothing that
// predates the column is refused.
const PERSON_ONLY_SENTENCE = (what, name) =>
  `${name || "That record"} is an organization, not a person, so it cannot ${what}. ` +
  `Organizations have their own list, with grant-cycle language rather than household and estate language.`;
return { NOT_YOURS, PERSON_ONLY_SENTENCE, RESTORABLE, UNDO_SECONDS, editStamp, mayEditLogged, trashRow };
}

module.exports = { mount };
