// server/donors/records.js — bulk changes, merge, trash and restore, history, erasure and the people export.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const auditMw = require("../../middleware/auditTrail");
const DTAGS = require("../../donorTags");   // FIX-33: internal flags never reach a screen as tags
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
const { sql } = require("../db/sql");   // REDTEAM-2: SQL text only from the code

const routers = {
  r1: express.Router(),
};
// INTEGRITY-2: the Trash list, Restore and the 30-day clear-out (server/donors/trashList.js).
routers.r1.use(require("./trashList").routers.r1);

function mount(ctx) {
require("./trashList").mount(ctx);
const {
  NOT_YOURS, OU, RESTORABLE, UNDO_SECONDS, UNKNOWN_ROLE, UNKNOWN_STATUS, actor, auditDescribe, auditQuery,
  auditShape, buildDonorListFilter, cfShape, checkWriteAccess, inviteeDisplayName, livePlanSentence,
  livePlansFor, loadCfDefs, markDonorsForGeocoding, mayEditLogged, orgOwns, orgToday, orgTz, orgTzName, query,
  queryTx, requireAdmin, requireAuth, requireCrm, run, runTx, toCsv, uuid, withTransaction, wrap,
} = ctx;

// ── Duplicate detection (BUILD-08 Phase C) ─────────────────────────────────
// Staff-level, org-scoped, read-only. Two tiers: same email (case-insensitive)
// is the confident tier; same-or-near name (normalized equality, or edit
// distance ≤2 within a first/last-token bucket) is the "worth a look" tier.
// Declared BEFORE /donors/:id routes (Express order) like /donors/summaries.
function normDonorName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const t = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[a.length];
}
let app = routers.r1;

app.get("/donors/duplicates", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, name, email, phone, stage, status, total_giving, gift_count,
            last_gift_date, address, address2, city, state, zip, created_at
     FROM donors WHERE org_id = ? AND deleted_at IS NULL`,
    [req.user.orgId]
  );
  const donorOut = d => ({ ...d, total_giving: parseFloat(d.total_giving) || 0 });
  const groups = [];

  // Tier 1 — same email.
  const byEmail = new Map();
  for (const d of rows) {
    const e = (d.email || "").toLowerCase().trim();
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(d);
  }
  const inEmailGroup = new Set();
  for (const [e, list] of byEmail) {
    if (list.length < 2) continue;
    list.forEach(d => inEmailGroup.add(d.id));
    groups.push({ tier: "email", reason: `Same email · ${e}`, donors: list.map(donorOut) });
  }

  // Tier 2 — same normalized name, or near-identical name (edit distance ≤2
  // within a cheap first+last-token bucket so this never goes O(n²) on the
  // whole org). Pairs fully covered by an email group aren't repeated.
  const named = rows.filter(d => normDonorName(d.name).length >= 5);
  const byName = new Map();
  for (const d of named) {
    const n = normDonorName(d.name);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(d);
  }
  const inNameGroup = new Set();
  for (const [n, list] of byName) {
    if (list.length < 2) continue;
    if (list.every(d => inEmailGroup.has(d.id))) continue;
    list.forEach(d => inNameGroup.add(d.id));
    groups.push({ tier: "name", reason: `Same name · "${list[0].name}"`, donors: list.map(donorOut) });
  }
  const buckets = new Map();
  for (const d of named) {
    if (inNameGroup.has(d.id)) continue;
    const toks = normDonorName(d.name).split(" ");
    const key = toks[0].slice(0, 2) + "|" + (toks[toks.length - 1] || "").slice(0, 2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 200) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (inEmailGroup.has(a.id) && inEmailGroup.has(b.id)) continue;
      const na = normDonorName(a.name), nb = normDonorName(b.name);
      if (na.length >= 8 && nb.length >= 8 && editDistance(na, nb, 2) <= 2) {
        groups.push({ tier: "name", reason: `Similar names · "${a.name}" / "${b.name}"`, donors: [a, b].map(donorOut) });
      }
    }
  }

  groups.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "email" ? -1 : 1));
  res.json({ groups: groups.slice(0, 50), truncated: groups.length > 50 });
}));

// Directory CSV export — replaces the client-side "export what's on screen"
// now that the screen is one page: honors the same query params as
// GET /donors, exports EVERY matching row. Staff-level (it's data staff
// already see), never checkWriteAccess-gated (export-routes convention).
app.get("/donors/export/csv", requireAuth, wrap(async (req, res) => {
  const filter = await buildDonorListFilter(req);
  if (filter.badFilter) return res.status(400).json({ error: "bad_filter", sentence: filter.badFilter });   // LIST-1
  if (filter.badRole) return res.status(400).json(UNKNOWN_ROLE);
  if (filter.badStatus) return res.status(400).json(UNKNOWN_STATUS);
  if (!(await OU.orgUser(req.user.orgId, req.query.assignedTo, { allowInactive: true })).ok) return OU.refuse(res, "assignedTo");
  const { whereSql, params, orderBy, selectCols, selectArgs } = filter;
  // TRUTH-5: the export's Gift count is the Directory's (giftCount.js), never the stored rollup.
  const donors = (await query(`SELECT donors.*${selectCols}, ${require("../../shared/numbers/giftCount").DONOR_GIFT_COUNT("donors")} AS gift_count_live FROM donors WHERE ${whereSql} ORDER BY ${orderBy}`, [...selectArgs, ...params]))
    .map(({ gift_count_live, ...d }) => ({ ...d, gift_count: Number(gift_count_live) || 0 }));
  if (await require("../../exportGuard").largeExportRefused(req, res, donors.length)) return;   // SECURE-2 item 8
  
  // BUILD-78 6.1 — every non-archived donor custom field is its own column,
  // headed with the CURRENT label, rendered per the type table.
  const cfDonorDefs = await loadCfDefs("donor", req.user.orgId);
  const { renderCustomValue } = await cfShape();
  const life = await require("../../shared/numbers/lifetime").lifetimeCents(query, req.user.orgId, donors.map(d => d.id));
  const columns = [
    ["Name", "name"], ["Email", "email"], ["Phone", "phone"],
    ["Stage", "stage"], ["Status", "status"],
    // FEEL-1: the lifetime is the one rule (shared/numbers/lifetime.js), worked
    // out here, never the stored donors.total_giving a write may not have caught up.
    ["Total giving", d => (life.has(d.id) ? (life.get(d.id) / 100).toFixed(2) : "0.00")], ["Last gift date", "last_gift_date"],
    ["Last gift amount", "last_gift_amount"], ["Gift count", "gift_count"],
    ["Assigned to", d => d.assigned_to_name || ""],
    ["Closeness", d => (d.closeness ? d.closeness.charAt(0).toUpperCase() + d.closeness.slice(1) : "")],
    // ASKS-1: the whole address, as the Donors list and the People report offer it
    ["Street address", d => d.address || ""], ["Address line 2", d => d.address2 || ""],
    ["City", d => d.city || ""], ["State", d => d.state || ""], ["ZIP", d => d.zip || ""],
    ["Full mailing address", d => require("../../shared/mailingAddress").mailingAddress(d)],
    ["Tags", d => DTAGS.visibleTags(d.tags).join("|")],
    ...cfDonorDefs.map(f => [f.label, d => renderCustomValue(f, (d.custom_fields || {})[f.key])]),
  ];
  // WEALTH-1: the score somebody set (blank when nobody has), for those who may see it.
  if (await require("../wealth/access").maySee(req.user.userId, req.user.orgId)) columns.push(["Wealth Score", d => (d.wealth_rating == null ? "" : String(d.wealth_rating))]);
  // PROSPECT-1 — screening results are never in the default export. An admin
  // may add them with the checkbox that says what it adds (includeScreening=1).
  if (String(req.query.includeScreening || "") === "1") {
    const [me] = await query("SELECT role FROM users WHERE id=?", [req.user.userId]);
    if (!me || me.role !== "admin") return res.status(403).json({ error: "Only an admin can include screening results in an export." });
    const PR = require("../../prospect"), RT = await PR.rtg();
    const sc = await PR.latestScreening(req.user.orgId, donors.map(d => d.id));
    const s = d => sc.get(d.id) || {};
    columns.push(["Screening provider", d => s(d).provider || ""], ["Screening date", d => s(d).screenedOn || ""],
      ["Capacity range", d => RT.rangeText(s(d).capacityLowCents ?? null, s(d).capacityHighCents ?? null) || ""],
      ["Real estate range", d => RT.rangeText(s(d).realEstateLowCents ?? null, s(d).realEstateHighCents ?? null) || ""]);
    if (req.audit) req.audit.summary(`Exported donors with screening results (${donors.length})`, { count: donors.length });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="donors-${orgToday(await orgTz(req.user.orgId))}.csv"`); // ORG_TZ_SEAM_OK — an evening export is named for today, not UTC-tomorrow
  res.send(toCsv(columns, donors));
}));

// THREAD-3 · ARCHIVE. The person leaves the Donors list and every Group, and
// nothing else changes: their monthly plan keeps charging, their gifts keep
// counting, and the record opens from search or a link with an Archived mark.
// Unarchive is the Undo.
app.post("/donors/:id/archive", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const r = await query(`UPDATE donors SET archived_at=NOW(), archived_by=?, updated_at=NOW()
                          WHERE id=? AND org_id=? AND deleted_at IS NULL AND archived_at IS NULL RETURNING id, name`,
    [actor(req).id, req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found, or already archived" });
  res.json({ archived: true, sentence: `${r[0].name} is archived. They are off your lists, and anything they give keeps arriving.` });
}));
app.post("/donors/:id/unarchive", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const r = await query(`UPDATE donors SET archived_at=NULL, archived_by=NULL, updated_at=NOW()
                          WHERE id=? AND org_id=? AND deleted_at IS NULL AND archived_at IS NOT NULL RETURNING id, name`,
    [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found, or not archived" });
  res.json({ archived: false, sentence: `${r[0].name} is back on your lists.` });
}));

// ── Bulk donor operations ──────────────────────────────────────────────────
// Future: restore-from-trash view + permanent-purge scheduled job can be
// built on deleted_at — the column is stable and org-scoped.

app.patch("/donors/bulk-stage", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { ids, stage } = req.body;
  const VALID = ["prospect","qualify","cultivate","solicit","steward","lapsed"];
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!VALID.includes(stage)) return res.status(400).json({ error: "Invalid stage" });

  // Verify every id belongs to the caller's org — reject the whole batch on any mismatch
  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });

  const result = await run(
    "UPDATE donors SET stage=?, updated_at=NOW() WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [stage, ids, req.user.orgId]
  );
  res.json({ updated: result.changes });
}));

app.patch("/donors/bulk-assign", requireAuth, requireAdmin, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { ids, assignedTo } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!assignedTo) return res.status(400).json({ error: "assignedTo required" });

  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });

  // BUILD-36 B2: the owner is either a real active user in this org, or a PENDING
  // invite ("invite:<id>") — held until that officer accepts, exactly like the
  // import owner-routing (pending-invitee rules). A pending assignment clears any
  // real owner and does NOT put the donor on a board yet (assigned_to stays NULL);
  // /auth/invite/accept later resolves it to the new user + their board.
  if (String(assignedTo).startsWith("invite:")) {
    const inviteId = String(assignedTo).slice("invite:".length);
    const inv = await query(
      "SELECT id, email FROM invites WHERE id=? AND org_id=? AND accepted_at IS NULL AND expires_at > NOW()",
      [inviteId, req.user.orgId]);
    if (!inv.length) return res.status(400).json({ error: "Invite not found or no longer pending" });
    const pendingName = inviteeDisplayName(inv[0].email);
    const result = await run(
      `UPDATE donors SET assigned_to=NULL, assigned_to_name=NULL,
         pending_assignee_invite_id=?, pending_assignee_name=?, updated_at=NOW()
       WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
      [inviteId, pendingName, ids, req.user.orgId]);
    return res.json({ updated: result.changes, pending: true, assignedToName: pendingName });
  }

  const named = await OU.orgUser(req.user.orgId, assignedTo);
  if (!named.ok) return OU.refuse(res, "assignedTo");
  const assignedToName = named.user.name;
  // BUILD-99 Part 2 — the stamp's NAME is a name; see /donors/:id/assign.
  const bulkByName = (await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]))[0]?.name
    || actor(req).name;

  // Bulk-assigning to an officer puts the batch in that officer's portfolio AND
  // on their board — assignment IS membership (BUILD-30), no separate flag. Any
  // prior pending-invite hold is cleared.
  const result = await run(
    `UPDATE donors SET assigned_to=?, assigned_to_name=?,
       assigned_by=?, assigned_by_name=?, assigned_at=NOW(),
       pending_assignee_invite_id=NULL, pending_assignee_name=NULL, updated_at=NOW()
     WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL`,
    [assignedTo, assignedToName, actor(req).id, bulkByName, ids, req.user.orgId]);
  res.json({ updated: result.changes, assignedToName });
}));

app.post("/donors/bulk-delete", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) return res.status(400).json({ error: "ids array required" });
  // FIX-54 · "Select all N matching", then Delete, deletes exactly N. The
  // screen sends the N it showed in the confirm; a selection that no longer
  // holds that many people is refused whole, so the number she agreed to is
  // the number that goes.
  const ids = [...new Set(req.body.ids.map(String))];
  const expect = req.body.count;
  if (expect !== undefined && Number(expect) !== ids.length) {
    req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
    return res.status(409).json({ error: "count_changed", sentence: `You confirmed ${Number(expect).toLocaleString("en-US")}, and the selection holds ${ids.length.toLocaleString("en-US")}. Nobody was deleted.` });
  }

  const owned = await query(
    "SELECT id FROM donors WHERE id = ANY(?) AND org_id = ? AND deleted_at IS NULL",
    [ids, req.user.orgId]
  );
  if (owned.length !== ids.length) return res.status(403).json({ error: "One or more donors not found in your org" });
  // MOPUP-2 · the Donors list's "Move to trash" says what to do with people who
  // have gifts: "skip" (its default) leaves them, "include" takes them only when
  // the confirm named how many (withGiftsCount). Absent, the route is as before
  // (Undo import's "remove them too" names its own people).
  let skippedWithGifts = 0, trashIds = ids;
  if (req.body.withGifts !== undefined) {
    const mode = String(req.body.withGifts);
    if (mode !== "skip" && mode !== "include") return res.status(400).json({ error: "withGifts must be skip or include" });
    const giving = await peopleWithGifts(req.user.orgId, ids);
    if (mode === "include" && Number(req.body.withGiftsCount) !== giving.size) {
      req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
      return res.status(409).json({ error: "with_gifts_changed", withGifts: giving.size,
        sentence: `You confirmed ${Number(req.body.withGiftsCount || 0).toLocaleString("en-US")} with gifts, and ${giving.size.toLocaleString("en-US")} of these people have gifts. Nobody was moved to trash.` });
    }
    if (mode === "skip") { trashIds = ids.filter(id => !giving.has(id)); skippedWithGifts = ids.length - trashIds.length; }
    if (!trashIds.length) {
      req.audit && req.audit.skip && req.audit.skip("nothing to move");
      return res.json({ deleted: 0, skippedWithGifts, undoIds: [], undoSeconds: UNDO_SECONDS });
    }
  }
  // THREAD-3: nobody with a live plan is deleted, in a batch either. The
  // whole batch is refused so nothing half-happens; the sentence names them.
  const plans = await livePlansFor(req.user.orgId, trashIds);
  if (plans.length) {
    req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
    const people = [...new Set(plans.map(p => p.donor_id))];
    return res.status(409).json({ error: "active_plan", donorIds: people,
      sentence: people.length === 1 ? livePlanSentence(plans[0])
        : `${people.length} of these people have a monthly plan (${livePlanSentence(plans[0]).replace(/\. Cancel.*$/, "")}, and others). Cancel their plans first, or archive them instead.` });
  }

  // WIRE-1: one trash row per person, exactly as DELETE /donors/:id writes,
  // so the shared Undo toast can bring the whole batch back.
  const who = actor(req);
  // INTEGRITY-2: through the one door out, so their links go with them (personTrash.trashPeople).
  const why = req.body.importId ? { kind: "undo_moved_too", importId: String(req.body.importId) } : { kind: "bulk_delete" };
  const gone = await require("../../personTrash").trashPeople(req.user.orgId, trashIds, who, { why });
  const changes = gone.length, undoIds = gone.map(g => g.undoId);
  require("../../routes/dataHealth").recheckSoon(req.user.orgId, "delete");   // FIX-59: Data health is current
  if (req.audit && skippedWithGifts) req.audit.label(`Moved ${changes} ${changes === 1 ? "person" : "people"} to trash; left ${skippedWithGifts} with gifts.`);
  res.json({ deleted: changes, skippedWithGifts, undoIds, undoSeconds: UNDO_SECONDS });
}));

// MOPUP-2 · what the trash confirm says before it asks: of these people, how
// many have gifts. Reads only; a POST because a filter's selection can be
// thousands of ids.
async function peopleWithGifts(orgId, ids) {
  const rows = await query(
    `SELECT DISTINCT g.donor_id FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?)`, [orgId, ids]);
  return new Set(rows.map(r => r.donor_id));
}
app.post("/donors/trash-check", requireAuth, requireAdmin, wrap(async (req, res) => {
  req.audit && req.audit.skip && req.audit.skip("a read: nothing changes");
  if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) return res.status(400).json({ error: "ids array required" });
  const ids = [...new Set(req.body.ids.map(String))];
  const giving = await peopleWithGifts(req.user.orgId, ids);
  // INTEGRITY-2: the delete's confirm names what goes with them
  const withThem = await require("./personLinks").whatGoesWith(query, req.user.orgId, ids);
  res.json({ count: ids.length, withGifts: giving.size, ...withThem });
}));

// The "permanent-purge" the comment above bulk-delete anticipated: hard-
// deletes every trashed (deleted_at IS NOT NULL) donor in the org, plus all
// rows that exist only because those donors did. WIRE-1: it walks EVERY person
// pointer in Data health's MERGE_REFS, so a column added for the merge is
// covered here in the same commit and nothing is left pointing at a person
// who is gone:
//   · the person's own records (gifts, receipts, pledges, notes, tasks,
//     memberships and the rest) are deleted, child rows first in FK-safe order
//   · a money, ledger or history row that is not theirs to take with them
//     (a bookkeeping line, a POS sale, an auction item, another donor's gift
//     in their honour, a household they headed, the portal log) keeps the row
//     and loses the pointer
//   · a meeting drops them from its people, and goes only if nobody is left
// One transaction: a mid-purge failure leaves nothing half-deleted.
// Admin-only; like all DELETE-shaped routes, never checkWriteAccess-gated (a
// lapsed org can still empty its trash).
const PURGE_KEEP_ROW = new Set([
  "fin_transactions.donor_id", "pos_sales.person_id", "households.primary_donor_id", "grants.funder_donor_id",
  "grant_sends.funder_donor_id", "gifts.tribute_donor_id", "gifts.match_employer_id", "auction_items.donor_id",
  "auction_refund_flags.donor_id", "peer_fundraisers.person_id", "recurring_change_log.donor_id",
  "portal_audit_log.donor_id", "custom_field_events.entity_id", "volunteers.donor_id", "event_attendees.donor_id",
  "survey_responses.donor_id", "volunteer_applications.person_id", "volunteer_groups.contact_person_id",
]);
// The person's own rows with a plain FK to donors (or to their gifts), in the
// order they must go: receipts and pledges point at gifts, gifts last.
const PURGE_CHILD_TABLES = [
  "receipts", "pledges", "memberships", "milestone_drafts", "note_reminders", "donor_materials",
  "planned_gifts", "custom_field_values", "sequence_enrollments", "portfolio_members", "care_plans",   // TOP100-1
  "payment_recovery_events", "recurring_subscriptions",
  "tasks", "interaction_attachments", "interactions", "gifts",
];
// FIX-55 · EMPTY TRASH (Settings, Imports). People deleted by hand, older than
// the days she chose (or all), are deleted for good, so they never match an
// import again. Someone merged into another record is not in the trash (the
// merge's Undo needs them). The count comes first (GET .../preview) and the
// write needs a second confirm (`confirm: "empty"`). The audit row says that a
// delete happened and how many, never who.
async function purgeableIds(orgId, olderThanDays) {
  const days = olderThanDays == null || olderThanDays === "" ? null : Math.max(0, Math.floor(Number(olderThanDays)));
  if (days != null && !Number.isFinite(days)) return null;
  // INTEGRITY-3: the Trash page's own definition (shared/numbers/trash.js)
  return (await query(`SELECT d.id FROM donors d WHERE d.org_id=? AND ${require("../../shared/numbers/trash").IN_TRASH("d")}
                         ${days != null ? "AND d.deleted_at < NOW() - make_interval(days => ?)" : ""}`,
    days != null ? [orgId, days] : [orgId])).map(r => r.id);
}
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // FLOWS-10: tests/flows10.test.js plants defects; never set outside tests
const trashSentence = (n, days) => n
  ? `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"} deleted ${days != null && days !== "" ? `more than ${days} ${Number(days) === 1 ? "day" : "days"} ago` : "from Steward"} will be deleted for good. They will never match an import again, and this cannot be undone.`
  // FLOWS-10 item 15: a filter with nobody in it says which filter, never "Nobody matches" beside the rows above it
  : PLANT === "nobodymatches" ? "Nobody in the trash matches that." : days != null && days !== "" ? `Nobody in the trash was deleted more than ${days} ${Number(days) === 1 ? "day" : "days"} ago, so there is nothing to empty for that.` : "The trash is empty.";
// INTEGRITY-2: the purge is one function, so Empty trash and the 30-day
// clear-out (server/donors/trashList.js) delete exactly the same way.
async function purgePeople(orgId, ids) {
  const { MERGE_REFS, REF_SHAPE } = require("../../routes/dataHealth");
  const whereAny = (t, c) => { const w = (REF_SHAPE[`${t}.${c}`] || {}).where; return `${c} = ANY(?)${w ? ` AND ${w}` : ""}`; };
  return withTransaction(async (client) => {
    const children = {}, unlinked = {};
    // 1. Rows that stay, unlinked.
    for (const [t, c] of MERGE_REFS) {
      if (!PURGE_KEEP_ROW.has(`${t}.${c}`)) continue;
      const r = await runTx(client, `UPDATE ${t} SET ${c}=NULL WHERE org_id=? AND ${whereAny(t, c)}`, [orgId, ids]);
      if (r.changes) unlinked[`${t}.${c}`] = r.changes;
    }
    // Another donor's pledge marked paid by one of these gifts stays a pledge.
    await runTx(client, `UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=? AND fulfilled_gift_id IN (SELECT id FROM gifts WHERE org_id=? AND donor_id = ANY(?))`, [orgId, orgId, ids]);
    // 2. Meetings: a meeting only these people were on goes; the rest drop them.
    const gone = await runTx(client, `DELETE FROM calendar_events WHERE org_id=? AND cardinality(person_ids) > 0 AND person_ids <@ ?::text[]`, [orgId, ids]);
    if (gone.changes) children.calendar_events = gone.changes;
    const left = await runTx(client,
      `UPDATE calendar_events SET person_ids = ARRAY(SELECT p FROM unnest(person_ids) WITH ORDINALITY u(p, n) WHERE p <> ALL(?::text[]) ORDER BY n)
        WHERE org_id=? AND person_ids && ?::text[]`, [ids, orgId, ids]);
    if (left.changes) unlinked["calendar_events.person_ids"] = left.changes;
    // 3. The person's own rows, FK-safe order.
    for (const t of PURGE_CHILD_TABLES) {
      const r = await runTx(client, `DELETE FROM ${t} WHERE org_id=? AND donor_id = ANY(?)`, [orgId, ids]);
      if (r.changes) children[t] = r.changes;
    }
    // 4. Every other pointer: a row that exists only because the person did.
    for (const [t, c] of MERGE_REFS) {
      const k = `${t}.${c}`;
      if (PURGE_KEEP_ROW.has(k) || (REF_SHAPE[k] || {}).array || (c === "donor_id" && PURGE_CHILD_TABLES.includes(t))) continue;
      const r = await runTx(client, `DELETE FROM ${t} WHERE org_id=? AND ${whereAny(t, c)}`, [orgId, ids]);
      if (r.changes) children[t] = (children[t] || 0) + r.changes;
    }
    // the trash's own copies go too, so no Undo or Recent change offers them back
    const tr = await runTx(client, "DELETE FROM deleted_records WHERE org_id=? AND table_name='donors' AND record_id = ANY(?)", [orgId, ids]);
    if (tr.changes) children.deleted_records = tr.changes;
    const d = await runTx(client, "DELETE FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, ids]);
    return { purged: d.changes, children, unlinked };
  });
}
module.exports.purgePeople = purgePeople;
module.exports.purgeableIds = purgeableIds;
app.get("/donors/purge-trash/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const ids = await purgeableIds(req.user.orgId, req.query.olderThanDays);
  if (!ids) return res.status(400).json({ error: "bad_days", sentence: "Choose a number of days, or all." });
  res.json({ count: ids.length, sentence: trashSentence(ids.length, req.query.olderThanDays) });
}));
app.post("/donors/purge-trash", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  if (b.confirm !== "empty") return res.status(400).json({ error: "confirm_required", sentence: "Confirm emptying the trash first." });
  const ids = await purgeableIds(orgId, b.olderThanDays);
  if (!ids) return res.status(400).json({ error: "bad_days", sentence: "Choose a number of days, or all." });
  if (req.audit) req.audit.summary(`Emptied the trash: ${ids.length} ${ids.length === 1 ? "person" : "people"} deleted for good`, { count: ids.length, entityType: "donors" });
  if (!ids.length) return res.json({ purged: 0, children: {}, unlinked: {}, sentence: "The trash had nobody to delete." });
  const { purged, children, unlinked } = await purgePeople(orgId, ids);
  // INTEGRITY-3: one audit row per person deleted for good, by id
  if (req.audit) req.audit.perRecord(require("./trashList").purgeRows(ids, `Emptied the trash: ${ids.length} ${ids.length === 1 ? "person" : "people"} deleted for good`));
  res.json({ purged, children, unlinked, sentence: `${purged.toLocaleString("en-US")} ${purged === 1 ? "person was" : "people were"} deleted for good.` });
}));

// ── Duplicate merge (BUILD-08 Phase C) ─────────────────────────────────────
// Staff-level (any staff member can clean duplicates — matches the everyday-
// hygiene bar of POST /note-reminders/:id/send, not the admin bar of purge),
// checkWriteAccess-gated (it's a data edit, and it soft-deletes — the DELETE-
// routes-ungated convention covers routes whose PURPOSE is deletion; this
// one's purpose is consolidation). Reference pattern: Givebutter Data
// Hygiene — merge into the chosen primary, keep the non-primary's data.
// One transaction: reassign every donor-scoped child, fill the primary's
// blank fields from the secondary, soft-delete the secondary, log a merge
// note as an interaction on the primary. Aggregates recalced after commit.
app.post("/donors/merge", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // CLEAN-1: the one merge is Data health's (routes/dataHealth.js): every
  // column in db.js that points at a person, the money footed to the cent, and
  // undo for 30 days. This older entry point keeps its request and response
  // shape and its rule (the primary's values win; its blanks fill from the
  // other record).
  const { primaryId, secondaryId } = req.body || {};
  const orgId = req.user.orgId;
  if (!primaryId || !secondaryId) return res.status(400).json({ error: "primaryId and secondaryId required" });
  if (primaryId === secondaryId) return res.status(400).json({ error: "Cannot merge a donor into itself" });
  const rows = await query("SELECT * FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL", [orgId, [primaryId, secondaryId]]);
  const primary = rows.find(d => d.id === primaryId), secondary = rows.find(d => d.id === secondaryId);
  if (!primary || !secondary) return res.status(404).json({ error: "Donor not found" });
  const DH = require("../../dataHealth");
  const blank = v => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const choices = Object.fromEntries(DH.MERGE_FIELDS.map(([f]) => [f, blank(primary[f]) && !blank(secondary[f]) ? "other" : "kept"]));
  const addrBlank = blank(primary.address) && blank(primary.city) && blank(primary.zip);
  for (const f of DH.ADDRESS_GROUP) choices[f] = addrBlank ? "other" : "kept";
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  let out;
  try {
    out = await require("../../routes/dataHealth").mergePeople(orgId, primaryId, secondaryId,
      { choices, me: { id: req.user.userId, name: (u && u.name) || req.user.email || "" } });
  } catch (e) {
    if (e && e.sentence) return res.status(e.status || 409).json({ error: "merge_refused", sentence: e.sentence });
    throw e;
  }
  try { await markDonorsForGeocoding(orgId, { donorIds: [primaryId] }); }
  catch (e) { console.error("[geocode] mark after merge failed:", e.message); }
  const reassigned = Object.fromEntries(out.moved.map(m => [m.table, m.rows]));
  res.json({ merged: true, primaryId, secondaryId, reassigned, mergeId: out.mergeId });
}));
const RESTORE_WITH = {
  // STALE-2: a guest's timeline lines come back with the guest.
  event_attendees: (client, x) => require("../events/attendanceLines").giveLines(client, x),
  interactions: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.calendar_event_ids) && x.calendar_event_ids.length) {
      await runTx(client, "UPDATE calendar_events SET interaction_id = ?, updated_at = NOW() WHERE id = ANY(?) AND org_id = ? AND interaction_id IS NULL",
        [recordId, x.calendar_event_ids, orgId]);
    }
    if (x && x.meeting) await require("./meetingTrash").giveMeeting(require("../../db"), client, x.meeting, orgId);   // INTEGRITY-2
  },
  pledges: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.installments) && x.installments.length) {
      await runTx(client, "INSERT INTO pledge_installments SELECT * FROM jsonb_populate_recordset(NULL::pledge_installments, ?::jsonb)",
        [JSON.stringify(x.installments)]);
    }
    await require("./pledgePayments").restoreWith(client, x, recordId, orgId);   // PLEDGES-2
  },
  campaigns: async (client, x) => {
    if (x && Array.isArray(x.recipients) && x.recipients.length) {
      await runTx(client, "INSERT INTO campaign_recipients SELECT * FROM jsonb_populate_recordset(NULL::campaign_recipients, ?::jsonb) ON CONFLICT DO NOTHING",
        [JSON.stringify(x.recipients)]);
    }
  },
  saved_dashboards: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.schedule_ids) && x.schedule_ids.length) {
      await runTx(client, "UPDATE board_pack_schedules SET dashboard_id = ? WHERE id = ANY(?) AND org_id = ? AND dashboard_id IS NULL",
        [recordId, x.schedule_ids, orgId]);
    }
  },
  // A member who joined another household since is left where they are.
  households: async (client, x, recordId, orgId) => {
    if (x && Array.isArray(x.member_ids) && x.member_ids.length) {
      await runTx(client, "UPDATE donors SET household_id = ? WHERE id = ANY(?) AND org_id = ? AND household_id IS NULL",
        [recordId, x.member_ids, orgId]);
    }
  },
};
const TRASH_ENTITY = { interactions: "interaction", threads: "next step", tasks: "task", donor_relationships: "relationship",
  pledges: "pledge", opportunities: "proposal", households: "household",
  planned_gifts: "planned_gift", donor_materials: "material", impact_metrics: "impact_metric",
  event_attendees: "event_attendee", saved_dashboards: "saved_dashboard", campaigns: "campaign" };

// HARDEN-1: THE UNDO OF A BULK DELETE IS ONE STEP, like the delete. The toast
// used to put people back ten requests at a time; a dropped network (or a
// closed tab) half way left some back and some not, and pressing Undo again
// hit "already back" on the first ten and stopped, so the rest could never
// come back from the toast. One transaction now: all of them, or none. A
// person already back counts as back, so a second press finishes the job.
app.post("/deleted-records/restore-people", requireAuth, wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
  if (!ids.length || ids.length > 100000) return res.status(400).json({ error: "ids array required" });
  const orgId = req.user.orgId;
  const rows = await query("SELECT id, record_id, restored_at, created_by FROM deleted_records WHERE org_id = ? AND table_name = 'donors' AND id = ANY(?)", [orgId, ids]);
  if (rows.length !== ids.length) return res.status(404).json({ error: "not_found", sentence: "Some of these are no longer in Recent changes. Nobody was put back." });
  if (rows.some(t => t.created_by !== req.user.userId) && !(await mayEditLogged(req, {}))) return res.status(403).json(NOT_YOURS);
  const waiting = rows.filter(t => !t.restored_at);
  await withTransaction(async client => {
    if (!waiting.length) return;
    // HARDEN-2: one door back for a person; it closes every open deletion record of theirs.
    await require("../../personTrash").bringPeopleBack(orgId, waiting.map(t => t.record_id), { client });
    await runTx(client, "UPDATE deleted_records SET restored_at = NOW() WHERE org_id = ? AND id = ANY(?) AND restored_at IS NULL", [orgId, waiting.map(t => t.id)]);
  });
  if (req.audit) req.audit.entity("donor", waiting.length === 1 ? waiting[0].record_id : null);
  res.json({ restored: rows.length, newlyRestored: waiting.length, alreadyBack: rows.length - waiting.length });
}));

// UNDO. Puts the row back exactly as it was. Allowed to whoever deleted it,
// or an admin, and only once.
app.post("/deleted-records/:id/restore", requireAuth, wrap(async (req, res) => {
  const [t] = await query("SELECT * FROM deleted_records WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.restored_at) return res.status(409).json({ error: "already_restored", sentence: "That is already back." });
  if (t.created_by !== req.user.userId && !(await mayEditLogged(req, {}))) return res.status(403).json(NOT_YOURS);
  // A soft-deleted donor comes back by clearing deleted_at (FIX-22).
  if (t.table_name === "donors") {
    // HARDEN-2: one door back for a person; it closes every open deletion record of theirs.
    await withTransaction(async client => {
      await require("../../personTrash").bringPeopleBack(req.user.orgId, [t.record_id], { client });
      await runTx(client, "UPDATE deleted_records SET restored_at = NOW() WHERE id = ? AND restored_at IS NULL", [t.id]);
    });
    const [d] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [t.record_id, req.user.orgId]);
    if (req.audit) { req.audit.entity("donor", t.record_id); req.audit.after(d || null); }
    return res.json({ restored: true, table: "donors", record: d || null });
  }
  if (!RESTORABLE.has(t.table_name)) return res.status(400).json({ error: "Cannot restore this" });
  try {
    await withTransaction(async client => {
      const tbl = sql.id(t.table_name, RESTORABLE);   // REDTEAM-2: a name from the RESTORABLE list, or it throws
      await runTx(client, sql`INSERT INTO ${tbl} SELECT * FROM jsonb_populate_record(NULL::${tbl}, ${JSON.stringify(t.row_data)}::jsonb)`);
      const data = typeof t.row_data === "string" ? JSON.parse(t.row_data) : t.row_data;
      if (RESTORE_WITH[t.table_name]) await RESTORE_WITH[t.table_name](client, data && data.__with, t.record_id, req.user.orgId);
      // FIX-45: any picture the row names comes back out of the retention window with it.
      const assetIds = [...new Set(JSON.stringify(data || {}).match(/pa_[a-f0-9]{24}/g) || [])];
      if (assetIds.length) await runTx(client, "UPDATE portal_assets SET deleted_at = NULL WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NOT NULL", [req.user.orgId, assetIds]);
      await runTx(client, "UPDATE deleted_records SET restored_at = NOW() WHERE id = ?", [t.id]);
    });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "conflict", sentence: "It could not come back, because something now stands in its place (an open next step, most likely)." });
    throw e;
  }
  const [row] = await query(sql`SELECT * FROM ${sql.id(t.table_name, RESTORABLE)} WHERE id = ${t.record_id} AND org_id = ${req.user.orgId}`);
  // The audit row is about the record that came back, not the trash row.
  if (req.audit) {
    req.audit.entity(TRASH_ENTITY[t.table_name], t.record_id);
    req.audit.after(row ? await auditShape(t.table_name, row, req.user.orgId) : null);
  }
  res.json({ restored: true, table: t.table_name, record: row || null });
}));

// THE PREVIOUS VERSIONS of one logged entry: its audit rows, newest first.
// Not admin-only, because "Edited" on a card has to open for whoever can see
// the card; it shows only rows about this one record, never the whole log.
app.get("/records/:id/history", requireAuth, wrap(async (req, res) => {
  // The record must be this organisation's (live, or waiting in the trash);
  // anything else is the same 404, so the route is no oracle for other orgs.
  const [own] = await query(
    `SELECT 1 FROM interactions WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM threads WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM tasks WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM pledges WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM opportunities WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM households WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM donor_relationships WHERE id = ? AND org_id = ?
     UNION ALL SELECT 1 FROM deleted_records WHERE record_id = ? AND org_id = ? LIMIT 1`,
    [req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId,
     req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId, req.params.id, req.user.orgId]);
  if (!own) return res.status(404).json({ error: "Not found" });
  const rows = await auditMw.resolveAuditNames(await query(
    `SELECT id, created_at, user_id, user_name, actor_kind, action, entity_type, entity_id, entity_label, summary,
            record_count, request_method, request_path, changes, before_fields, after_fields
       FROM fin_audit_log WHERE org_id = ? AND entity_id = ? AND (status_code IS NULL OR status_code < 400)
      ORDER BY created_at DESC, id DESC LIMIT 100`, [req.user.orgId, req.params.id]), req.user.orgId);
  const out = await auditDescribe(rows, req.user.orgId);
  res.json({ timezone: await orgTzName(req.user.orgId), rows: out });
}));

// FIX-14 Part 2 — ONE PERSON'S HISTORY, on their profile: every audit row
// about them (their record, and every conversation, step, task and gift that
// carries their id), newest first. Open to anyone who can open the profile,
// because it shows only what happened to this one record.
app.get("/donors/:id/history", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await auditQuery(req, { person: req.params.id, limit: req.query.limit || 200 });
  res.json({ timezone: await orgTzName(req.user.orgId), rows: await auditDescribe(rows, req.user.orgId) });
}));

// ── Data export ────────────────────────────────────────────────────────────
// ═══ TRUST-2 · ONE PERSON'S DATA ════════════════════════════════════════════
// Owners and admins only. The export is a download, so the audit trail logs it
// as a disclosure. The erasure is audited as WHO erased WHOM and WHEN, and the
// row deliberately carries none of the erased details: the before/after the
// trail would otherwise copy off the record is replaced with a marker.
app.get("/donors/:id/export-data", requireAuth, requireAdmin, wrap(async (req, res) => {
  const PD = require("../../personData");
  const data = await PD.exportPerson(req.user.orgId, req.params.id);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="person-${req.params.id}.json"`);
  res.send(JSON.stringify(data, null, 2));
}));
app.post("/donors/:id/erase", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const PD = require("../../personData");
  if (req.body?.confirm !== "ERASE") return res.status(400).json({ error: "confirm_required", message: "Type ERASE to confirm. This cannot be undone." });
  req.audit.before({ erased: true }); req.audit.after({ erased: true });
  req.audit.entity("person", req.params.id, "A person (details erased)");
  req.audit.action("erased a person at their request");
  const out = await PD.erasePerson(req.user.orgId, req.params.id);
  if (!out) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, sentence: "Erased. Their gifts stay as anonymous gifts, so every total still matches. Nothing else about them is left." });
}));
}

module.exports = { routers, mount };
