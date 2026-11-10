// server/donors/trashList.js · INTEGRITY-2 (W-1107-Finance-35). THE TRASH YOU
// CAN RESTORE FROM.
//
// Fiona Callahan ($35,000) went to the trash in an import undo, and Settings
// offered only "Empty trash" for 267 people: no list, no way to bring one
// person back. The Trash now works the way Bloomerang, Little Green Light and
// Salesforce do:
//   · GET  /trash/people             a searchable list: who, who deleted them,
//                                    when and why ("Import undo, 8 Nov"), and
//                                    the day they leave on their own.
//   · POST /trash/people/restore     Restore one person or a selection, through
//                                    the one door back (personTrash.bringPeopleBack),
//                                    which also puts back the links their delete took.
//   · the trashAutoEmpty job         people leave on their own 30 days after
//                                    they went in (the same purge as Empty trash).
// Someone merged into another record is not in the trash: the merge's own Undo
// holds them. An erased shell is not a person and is never listed.
//
// The 30 days count from the later of the delete and AUTO_EMPTY_FROM, the day
// this build shipped: nobody already in the trash is deleted for good on the
// day it deploys, and everyone gets a full 30 days with Restore on screen.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const KEEP_DAYS = 30;
const AUTO_EMPTY_FROM = "2026-11-09T00:00:00Z";

// SQL: d is a person in the trash (not merged away, not an erased shell, not
// a staged import's hidden people). INTEGRITY-3: the one definition, which the
// Everyone breakdown and Empty trash read too (shared/numbers/trash.js).
const { IN_TRASH } = require("../../shared/numbers/trash");
// When they leave on their own.
const LEAVES_ON = d => `(GREATEST(${d}.deleted_at, '${AUTO_EMPTY_FROM}'::timestamptz) + INTERVAL '${KEEP_DAYS} days')`;

const dayOf = (iso, tz) => { try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz || "UTC" }); } catch { return ""; } };
// Why they are in the trash, in the words the list shows.
function whySentence(row, tz, files) {
  const data = row.row_data ? (typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data) : {};
  const why = data.__why || (data.__importUndo ? { kind: "import_undo", importId: data.__importUndo } : null);
  const day = dayOf(row.deleted_at, tz);
  const file = why && why.importId && files.get(why.importId);
  const ofFile = file ? ` of ${file}` : "";
  if (why && why.kind === "import_undo") return `Import undo${ofFile}, ${day}`;
  if (why && why.kind === "undo_moved_too") return `Moved with an import undo${ofFile}, ${day}`;
  if (why && why.kind === "bulk_delete") return `Moved to trash from the Donors list, ${day}`;
  if (why && why.kind === "delete") return `Deleted from their record, ${day}`;
  return `Deleted, ${day}`;
}

function mount(ctx) {
const { query, requireAuth, requireAdmin, checkWriteAccess, wrap, orgTzName } = ctx;
const app = routers.r1;

app.get("/trash/people", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const q = String(req.query.q || "").trim().slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const like = q ? `%${q.replace(/[%_\\]/g, m => "\\" + m)}%` : null;
  const where = `d.org_id = ? AND ${IN_TRASH("d")}${like ? " AND (d.name ILIKE ? OR d.email ILIKE ?)" : ""}`;
  const args = like ? [orgId, like, like] : [orgId];
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM donors d WHERE ${where}`, args);
  const all = await require("../../shared/numbers/trash").trashCount(query, orgId);   // INTEGRITY-3: the breakdown reads this too
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.deleted_at, ${LEAVES_ON("d")} AS leaves_on,
            (SELECT COUNT(*) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id)::int AS gifts,
            r.id AS trash_id, r.created_by, r.created_by_name, r.row_data
       FROM donors d
       LEFT JOIN LATERAL (SELECT * FROM deleted_records x WHERE x.org_id = d.org_id AND x.table_name = 'donors' AND x.record_id = d.id
                           ORDER BY (x.restored_at IS NULL) DESC, x.created_at DESC LIMIT 1) r ON true
      WHERE ${where}
      ORDER BY d.deleted_at DESC, d.name, d.id LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const tz = await orgTzName(orgId);
  const importIds = [...new Set(rows.map(r => { const x = r.row_data ? (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data) : {}; return (x.__why && x.__why.importId) || x.__importUndo; }).filter(Boolean))];
  const files = new Map(importIds.length ? (await query(`SELECT id, COALESCE(NULLIF(source_filename, ''), name) AS file_name FROM imports WHERE org_id = ? AND id = ANY(?)`, [orgId, importIds])).filter(f => f.file_name).map(f => [f.id, f.file_name]) : []);
  // who deleted them: the user's name now, by id (a renamed user reads by their new name)
  const userIds = [...new Set(rows.map(r => r.created_by).filter(x => x && !String(x).startsWith("system:")))];
  const users = new Map(userIds.length ? (await query(`SELECT id, name FROM users WHERE org_id = ? AND id = ANY(?)`, [orgId, userIds])).map(u => [u.id, u.name]) : []);
  res.json({
    total: n, inTrash: all, limit, offset, keepDays: KEEP_DAYS,
    sentence: `${all.toLocaleString("en-US")} ${all === 1 ? "person is" : "people are"} in the trash. Each one leaves on their own ${KEEP_DAYS} days after they went in; Restore brings them back with their gifts, notes and links.`,
    people: rows.map(r => ({
      id: r.id, name: r.name, email: r.email || null, gifts: r.gifts, deletedAt: r.deleted_at, leavesOn: r.leaves_on,
      deletedBy: users.get(r.created_by) || r.created_by_name || "Steward",
      why: whySentence(r, tz, files),
    })),
  });
}));

// INTEGRITY-2 (W-1107-Prod-04): "Where does 1,218 come from?" A read.
app.get("/people/everyone-breakdown", requireAuth, wrap(async (req, res) => {
  res.json(await require("../../shared/numbers/everyoneBreakdown").everyoneBreakdown(query, req.user.orgId));
}));

app.post("/trash/people/restore", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 5000) : [];
  if (!ids.length) return res.status(400).json({ error: "ids_required", sentence: "Choose who to restore." });
  const inTrash = (await query(`SELECT d.id, d.name FROM donors d WHERE d.org_id = ? AND d.id = ANY(?) AND ${IN_TRASH("d")}`, [orgId, ids]));
  const back = inTrash.length ? await require("../../personTrash").bringPeopleBack(orgId, inTrash.map(d => d.id), { exceptMerged: true, touch: true }) : [];
  if (back.length) {
    await require("../../afterChange").afterChange(orgId, back, { door: "trash_restore" }).catch(e => console.error("[trash] restore:", e.message));
    require("../../routes/dataHealth").recheckSoon(orgId, "restore");
  }
  if (req.audit) { req.audit.entity("donor", back.length === 1 ? back[0] : null); req.audit.after({ restored: back }); }
  const one = back.length === 1 ? inTrash.find(d => d.id === back[0]) : null;
  res.json({ restored: back.length, ids: back,
    sentence: !back.length ? "Nobody was restored: they are no longer in the trash."
      : one ? `${one.name} is back, with their gifts, notes and links.`
      : `${back.length.toLocaleString("en-US")} people are back, with their gifts, notes and links.` });
}));
}

// INTEGRITY-3: who left Steward for good, one audit row each (their id, from
// the trash to deleted for good), so a person who is gone can always be traced
// to the Empty trash or the clear-out that took them. The first row is the
// purge itself, with its count.
function purgeRows(ids, summary) {
  return [{ entityType: "donors", entityId: null, label: "Trash", summary, action: "delete", recordCount: ids.length },
    ...ids.map(id => ({ entityType: "donor", entityId: id, action: "deleted for good", before: { state: "trash" }, after: { state: "deleted for good" }, summary }))];
}

// The 30-day clear-out. Every org, the people whose day has come, through the
// same purge as Empty trash; one audit row per org, as a system actor.
async function autoEmpty({ now = null } = {}) {
  const { query } = require("../../db");
  const at = now ? "?::timestamptz" : "NOW()";
  const due = await query(`SELECT d.org_id, array_agg(d.id) AS ids FROM donors d
                            WHERE ${IN_TRASH("d")} AND ${LEAVES_ON("d")} <= ${at} GROUP BY d.org_id`, now ? [now] : []);
  const R = require("./records");
  let purged = 0;
  for (const o of due) {
    const out = await R.purgePeople(o.org_id, o.ids);
    purged += out.purged;
    const summary = `The trash cleared ${out.purged} ${out.purged === 1 ? "person" : "people"} deleted more than ${KEEP_DAYS} days ago`;
    // INTEGRITY-3: one row per person, as Empty trash writes
    await require("../../middleware/auditTrail").insertAuditRows(purgeRows(o.ids, summary).map((r, k) => ({
      orgId: o.org_id, actorId: "system:trash/auto-empty", actorName: "Steward (trash)", actorKind: "system",
      action: r.action, entityType: r.entityType, entityId: r.entityId, entityLabel: r.label || null,
      changes: k === 0 ? { count: out.purged } : { state: { before: "trash", after: "deleted for good" } }, before: r.before || null, after: r.after || null,
      summary, recordCount: k === 0 ? out.purged : 1, method: "TICK", path: "trashAutoEmpty", status: 200 }))).catch(e => console.error("[trash] audit:", e.message));
  }
  return { orgs: due.length, purged };
}
if (process.env.DISABLE_BACKGROUND_TICKS !== "1") {
  require("../../jobQueue").define("trashAutoEmpty", { everyMs: 6 * 3600e3, firstMs: 15 * 60e3, run: () => autoEmpty() });
}

module.exports = { routers, mount, autoEmpty, whySentence, purgeRows, KEEP_DAYS, AUTO_EMPTY_FROM, IN_TRASH };
