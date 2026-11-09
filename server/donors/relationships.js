// server/donors/relationships.js — households, relationships, volunteer hours and materials.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// FIX-11 Part 1 — the audit log's own vocabulary (the sentence a row reads as).
// The WRITING of a row happens in middleware/auditTrail.js and nowhere else.
const auditTrailMod = require("../../auditTrail");
const TL = require("../../timelineLine");

const routers = {
  r1: express.Router(),
};
// PEOPLE-1: Mark as deceased (server/donors/deceased.js) sits beside the person's links.
routers.r1.use(require("./deceased").routers.r1);
// PLEDGES-2: a recurring plan staff record by hand (server/donors/offlinePlans.js).
routers.r1.use(require("./offlinePlans").routers.r1);

function mount(ctx) {
require("./deceased").mount(ctx);
require("./offlinePlans").mount(ctx);
const {
  NOT_YOURS, PERSON_ONLY_SENTENCE, UNDO_SECONDS, VH_READY, actor, auditShape, checkWriteAccess, crypto,
  donorPhotoUrl, editStamp, figureSources, insertShift, lastName, mayEditLogged, orgOwns, orgToday, orgTz,
  publicAppUrl, query, requireAuth, run, runTx, staffWho, trashRow, uuid, volunteerSummary, withTransaction,
  wrap,
} = ctx;
let VH = null;
VH_READY.then(m => { VH = m; });
let app = routers.r1;

app.get("/donors/:id/materials", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  // PROSPECT-1 — a prospect brief is for admins and major gifts staff only.
  const mg = await require("../../prospect").canSee(req.user.userId, req.user.orgId);
  const rows = await query(`SELECT id,org_id,donor_id,file_name,file_type,file_url,notes,uploaded_by,uploaded_at,major_gifts_only FROM donor_materials
      WHERE donor_id=? AND org_id=?${mg ? "" : " AND COALESCE(major_gifts_only,false) = false"} ORDER BY uploaded_at DESC`, [req.params.id, req.user.orgId]);
  // FIX-45: the photograph of a check is this person's file too. It lives on
  // the gift (gifts.cheque_asset_id, written by To confirm and by "attach the
  // check"), so it is listed here beside the uploads, read-only: it is the
  // gift's evidence and is removed with the gift, never from this list.
  const checks = await query(`SELECT id, amount, date, cheque_asset_id, created_by_name, created_at FROM gifts
      WHERE donor_id=? AND org_id=? AND cheque_asset_id IS NOT NULL`, [req.params.id, req.user.orgId]);
  const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; };
  const files = rows.concat(checks.map(g => ({
    id: "check:" + g.id, kind: "check_image", gift_id: g.id, donor_id: req.params.id,
    file_name: `Check for the $${Number(g.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gift on ${day(g.date)}`,
    file_type: "image/webp", file_url: donorPhotoUrl(req.user.orgId, g.cheque_asset_id),
    notes: "Attached to the gift.", uploaded_by: g.created_by_name || null, uploaded_at: g.created_at,
  })));
  files.sort((x, y) => new Date(y.uploaded_at) - new Date(x.uploaded_at));
  res.json(files);
}));

// Server-side backstop for donor material uploads. The client only checks
// file.size<1MB before base64-encoding — trivially bypassed by calling the
// API directly, so it's not a real limit on its own. The MIME allowlist is
// the actual fix for the stored-XSS risk: file_type is attacker/uploader-
// controlled and the frontend's viewMaterial() trusts it verbatim to build a
// Blob it opens via window.open(URL.createObjectURL(...)) — if file_type
// were ever "text/html" or "image/svg+xml", that blob would execute as
// script in the browser. That path isn't reachable today only because
// GET /donors/:id/materials happens to exclude file_data from its SELECT
// (an apparently unrelated bug that also makes the "View" button do nothing
// for base64 uploads) — an accident, not a real control. Constraining
// file_type to genuinely inert formats at write time closes the actual gap,
// so it stays closed even if that unrelated bug gets "fixed" later by
// someone adding file_data back to a read response.
const MATERIAL_MAX_BYTES = 1024 * 1024; // 1MB, matches the documented convention
const MATERIAL_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/octet-stream",
]);

app.post("/donors/:id/materials", requireAuth, wrap(async (req, res) => {
  const { file_name, file_type, file_url, file_data, notes } = req.body;
  if (!file_name) return res.status(400).json({ error: "file_name required" });
  // REDTEAM-1: a material's link is opened with window.open on the profile, so
  // a "javascript:" link ran as Steward for whoever clicked it. A web address
  // or nothing (webAddress.js, SECURE-1 §10's rule for websites).
  const fileUrl = file_url ? require("../../webAddress").webAddress(String(file_url), 2000) : null;
  if (file_url && !fileUrl) return res.status(400).json({ error: "A file link must be a web address (https://…)." });
  if (file_type && !MATERIAL_ALLOWED_MIME_TYPES.has(file_type)) {
    return res.status(400).json({ error: `Unsupported file type: ${file_type}` });
  }
  if (file_data && Buffer.byteLength(file_data, "base64") > MATERIAL_MAX_BYTES) {
    return res.status(400).json({ error: "File too large. Maximum size is 1MB." });
  }
  const donorCheck = await query("SELECT id FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const id = newId("mat");
  await run(
    "INSERT INTO donor_materials (id,org_id,donor_id,file_name,file_type,file_url,file_data,notes,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, file_name, file_type||"", fileUrl||null, file_data||null, notes||"", userRow[0]?.name||""]
  );
  const rows = await query("SELECT id,org_id,donor_id,file_name,file_type,file_url,notes,uploaded_by,uploaded_at FROM donor_materials WHERE id=?", [id]);
  // Log interaction
  try {
    const ext = file_type ? file_type.split("/").pop() : "file";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      [newId("int"), req.user.orgId, req.params.id, "material",
       `Material added: ${file_name} (${ext})`,
       orgToday(await orgTz(req.user.orgId)), req.user.userId, userRow[0]?.name||""]   // ORG_TZ_SEAM_OK FIX-14 Part 1 — was the UTC day
    );
  } catch(e) { console.error("Material log:", e.message); }
  res.status(201).json(rows[0]);
}));

app.delete("/materials/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM donor_materials WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  if (existing[0].major_gifts_only && !(await require("../../prospect").canSee(req.user.userId, req.user.orgId))) return res.status(404).json({ error: "Not found" });
  const undoId = await trashRow("donor_materials", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// Full derived view of a household: members (with per-member hard credit +
// primary flag), combined giving, member count. Combined = SUM(members'
// hard credit) — a pure aggregation over the same gift rows.
async function householdView(householdId, orgId) {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [householdId, orgId]);
  if (!hh.length) return null;
  const members = await query(
    `SELECT id, name, email, phone, total_giving, gift_count, last_gift_date, last_gift_amount,
            stage, status, assigned_to, assigned_to_name, deceased, deceased_date
     FROM donors WHERE household_id=? AND org_id=? AND deleted_at IS NULL
     ORDER BY total_giving DESC, id`, [householdId, orgId]);
  // REPORTS-4: combined giving is the `household-giving` source's value (the
  // same members, added in cents), so it opens onto them and foots exactly.
  const combinedSource = { key: "household-giving", params: { household: householdId } };
  const combinedGiving = (await figureSources.figureValue(orgId, combinedSource)).value;
  const combinedGiftCount = members.reduce((s, m) => s + (parseInt(m.gift_count, 10) || 0), 0);
  return {
    ...hh[0],
    members: members.map(m => ({
      ...m,
      total_giving: parseFloat(m.total_giving) || 0,
      last_gift_amount: parseFloat(m.last_gift_amount) || 0,
      gift_count: parseInt(m.gift_count, 10) || 0,
      is_primary: m.id === hh[0].primary_donor_id,
      // PEOPLE-1: the household stays; someone in it who has died reads "(died March 2026)"
      deceased: m.deceased === true, died_words: m.deceased === true ? (require("./deceased").diedWords(m.deceased_date) || "") : null,
      // per-member soft credit = combined − own hard credit = other members' gifts
      soft_credit: (Math.round(combinedGiving * 100) - Math.round((parseFloat(m.total_giving) || 0) * 100)) / 100,
      source: { key: "household-giving", params: { household: householdId, only: m.id } },
    })),
    member_count: members.length,
    combined_giving: combinedGiving,
    combined_source: combinedSource,
    combined_gift_count: combinedGiftCount,
  };
}

app.get("/households", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT h.id, h.name, h.primary_donor_id, h.joint_acknowledgment, h.created_at,
            COUNT(d.id)::int AS member_count, COALESCE(SUM(d.total_giving),0) AS combined_giving
     FROM households h
     LEFT JOIN donors d ON d.household_id = h.id AND d.org_id = h.org_id AND d.deleted_at IS NULL
     WHERE h.org_id=?
     GROUP BY h.id
     ORDER BY combined_giving DESC, h.name`, [req.user.orgId]);
  res.json(rows.map(r => ({ ...r, member_count: parseInt(r.member_count, 10) || 0, combined_giving: parseFloat(r.combined_giving) || 0 })));
}));

app.get("/households/:id", requireAuth, wrap(async (req, res) => {
  const view = await householdView(req.params.id, req.user.orgId);
  if (!view) return res.status(404).json({ error: "Household not found" });
  // Combined giving history — all members' gifts merged, newest first
  const gifts = await query(
    `SELECT g.id, g.donor_id, d.name AS donor_name, g.amount, g.date, g.type, g.campaign
     FROM gifts g JOIN donors d ON d.id = g.donor_id
     WHERE d.household_id=? AND g.org_id=? AND d.deleted_at IS NULL
     ORDER BY g.date DESC NULLS LAST, g.created_at DESC NULLS LAST, g.id DESC LIMIT 200`, [req.params.id, req.user.orgId]);
  view.giving_history = gifts.map(g => ({ ...g, amount: parseFloat(g.amount) || 0 }));
  res.json(view);
}));

async function validateHouseholdMembers(memberIds, primaryDonorId, orgId, allowHouseholdId) {
  const ids = Array.isArray(memberIds) ? [...new Set(memberIds.filter(Boolean))] : [];
  if (ids.length < 2) return { status: 400, error: "A household needs at least two members." };
  const members = await query(
    "SELECT id, name, kind, household_id FROM donors WHERE id = ANY(?) AND org_id=? AND deleted_at IS NULL",
    [ids, orgId]);
  if (members.length !== ids.length) return { status: 404, error: "One or more donors not found in this organization." };
  const foreign = members.find(m => m.household_id && m.household_id !== allowHouseholdId);
  if (foreign) return { status: 400, error: "A donor is already in another household." };
  // BUILD-97 Part 2 — a household is people. Checked on the MEMBER LIST rather
  // than at either route, so the create path and the edit path cannot disagree.
  const orgMember = members.find(m => m.kind === "organisation" || m.kind === "anonymous");
  if (orgMember) return { status: 400, error: PERSON_ONLY_SENTENCE("be part of a household", orgMember.name) };
  const primary = primaryDonorId && ids.includes(primaryDonorId) ? primaryDonorId : ids[0];
  return { ids, primary };
}

app.post("/households", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, memberIds, primaryDonorId, jointAcknowledgment } = req.body;
  const v = await validateHouseholdMembers(memberIds, primaryDonorId, req.user.orgId, null);
  if (v.error) return res.status(v.status).json({ error: v.error });
  // Default name: "The {primary's last name} Household"
  let hhName = (name && String(name).trim()) || "";
  if (!hhName) {
    const primaryRow = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [v.primary, req.user.orgId]);
    const ln = lastName(primaryRow[0]?.name);
    hhName = ln ? `The ${ln} Household` : "Household";
  }
  const id = newId("hh");
  await withTransaction(async (client) => {
    await runTx(client, "INSERT INTO households (id,org_id,name,primary_donor_id,joint_acknowledgment,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)",
      [id, req.user.orgId, hhName, v.primary, jointAcknowledgment !== false, actor(req).id, actor(req).name]);
    await runTx(client, "UPDATE donors SET household_id=? WHERE id = ANY(?) AND org_id=?", [id, v.ids, req.user.orgId]);
  });
  await householdLines(req, hhName, id, v.ids, []);   // WIRE-1
  res.status(201).json(await householdView(id, req.user.orgId));
}));

app.put("/households/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!hh.length) return res.status(404).json({ error: "Household not found" });
  // FIX-14 Part 2b: whoever made the household, or an admin. The audit row
  // carries the members before and after, so it can say who was removed.
  if (!(await mayEditLogged(req, hh[0]))) return res.status(403).json(NOT_YOURS);
  const hhBefore = await auditShape("households", hh[0], req.user.orgId);
  const { name, memberIds, primaryDonorId, jointAcknowledgment } = req.body;
  let ids = null, primary = hh[0].primary_donor_id;
  if (memberIds !== undefined) {
    const v = await validateHouseholdMembers(memberIds, primaryDonorId, req.user.orgId, req.params.id);
    if (v.error) return res.status(v.status).json({ error: v.error });
    ids = v.ids; primary = v.primary;
  } else if (primaryDonorId) {
    // primary change without member change — must be an existing member
    const m = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND household_id=?", [primaryDonorId, req.user.orgId, req.params.id]);
    if (!m.length) return res.status(400).json({ error: "New primary must be a member of the household." });
    primary = primaryDonorId;
  }
  const membersBefore = ids ? (await query("SELECT id FROM donors WHERE household_id=? AND org_id=?", [req.params.id, req.user.orgId])).map(r => r.id) : [];
  await withTransaction(async (client) => {
    if (ids) {
      // drop members no longer in the set, then (re)attach the set
      await runTx(client, "UPDATE donors SET household_id=NULL WHERE household_id=? AND org_id=? AND NOT (id = ANY(?))", [req.params.id, req.user.orgId, ids]);
      await runTx(client, "UPDATE donors SET household_id=? WHERE id = ANY(?) AND org_id=?", [req.params.id, ids, req.user.orgId]);
    }
    await runTx(client,
      "UPDATE households SET name=COALESCE(?,name), primary_donor_id=?, joint_acknowledgment=COALESCE(?,joint_acknowledgment), updated_at=NOW() WHERE id=? AND org_id=?",
      [name && String(name).trim() ? String(name).trim() : null, primary,
       jointAcknowledgment === undefined ? null : (jointAcknowledgment !== false), req.params.id, req.user.orgId]);
  });
  const [hhRow] = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (ids) await householdLines(req, hhRow?.name || "the household", req.params.id,
    ids.filter(x => !membersBefore.includes(x)), membersBefore.filter(x => !ids.includes(x)));   // WIRE-1
  const hhAfter = await auditShape("households", hhRow, req.user.orgId);
  if (auditTrailMod.diffFields(hhBefore, hhAfter)) {
    await run("UPDATE households SET edited_at=NOW(), edited_by=?, edited_by_name=? WHERE id=? AND org_id=?",
      [...(await editStamp(req)), req.params.id, req.user.orgId]);
  }
  if (req.audit) { req.audit.before(hhBefore); req.audit.after(hhAfter); }
  res.json(await householdView(req.params.id, req.user.orgId));
}));

// WIRE-1 · joining or leaving a household is a line on the person.
async function householdLines(req, hhName, householdId, joined, left) {
  const who = await staffWho(req);
  for (const [list, word] of [[joined, "Joined"], [left, "Left"]]) {
    for (const donorId of list || []) {
      await TL.timelineLine({ orgId: req.user.orgId, donorId, note: `${word} ${hhName}.`,
        actorId: who.id, actorName: who.name, metadata: { via: "household", household_id: householdId, change: word.toLowerCase() } });
    }
  }
}

// FIX-14 Part 2b: the household goes to the trash with its member list, and
// Undo re-links every member who has not joined another household since.
app.delete("/households/:id", requireAuth, wrap(async (req, res) => {
  const hh = await query("SELECT * FROM households WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!hh.length) return res.status(404).json({ error: "Household not found" });
  if (!(await mayEditLogged(req, hh[0]))) return res.status(403).json(NOT_YOURS);
  if (req.audit) req.audit.before(await auditShape("households", hh[0], req.user.orgId));
  const undoId = await trashRow("households", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Household not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// ── Donor-to-donor relationships (household/spouse/family/employer_match) ──
// Manual linking only — no auto-detection (matching last name, address,
// etc.) in this pass, see CLAUDE.md. One row per pair regardless of which
// donor is A vs B; both directions are queried here so either donor's
// profile shows the same link.
// POLISH-4: and a person to an organization: Owner (owns it, gives through it)
// and Works at. These two are stored person first (donor_id_a) and make one
// giving unit for the lapse rule (shared/numbers/lapse.js UNIT_LINK_TYPES).
const DONOR_RELATIONSHIP_TYPES = ["spouse", "partner", "household", "family", "employer_match", "owner", "works_at"];
const PERSON_TO_ORG = new Set(["owner", "works_at"]);
const isOrgRow = d => !!d && (["organisation", "organization"].includes(String(d.kind || "").toLowerCase())
  || (Array.isArray(d.person_types) && d.person_types.includes("organization")));
// Only these two types pool into a shared "household total" — family and
// employer_match are relationship context, not a shared giving pool.
const HOUSEHOLD_RELATIONSHIP_TYPES = ["spouse", "partner", "household"];   // PEOPLE-1: a partner pools exactly as a spouse does

app.get("/donors/:id/relationships", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const { orgId } = req.user;
  const donorId = req.params.id;
  const rows = await query(
    `SELECT dr.id, dr.relationship_type, dr.notes, dr.created_at, (dr.donor_id_a = ?) AS mine_first,
            CASE WHEN dr.donor_id_a = ? THEN dr.donor_id_b ELSE dr.donor_id_a END AS related_donor_id
     FROM donor_relationships dr
     WHERE dr.org_id = ? AND (dr.donor_id_a = ? OR dr.donor_id_b = ?)
       -- INTEGRITY-2 (W-1108-Donors-45X): a link to someone in the trash is not shown ("Owner: … $0");
       -- deletes since take the link with them (personLinks.js), and this hides the ones left from before
       AND NOT EXISTS (SELECT 1 FROM donors o WHERE o.org_id = dr.org_id AND o.deleted_at IS NOT NULL
                         AND o.id = CASE WHEN dr.donor_id_a = ? THEN dr.donor_id_b ELSE dr.donor_id_a END)
     ORDER BY dr.created_at ASC`,
    [donorId, donorId, orgId, donorId, donorId, donorId]
  );
  if (!rows.length) return res.json({ relationships: [], householdTotal: null });

  const relatedIds = rows.map(r => r.related_donor_id);
  const relatedDonors = await query(
    `SELECT id, name, total_giving, deceased, deceased_date FROM donors WHERE org_id = ? AND id = ANY(?)`,
    [orgId, relatedIds]
  );
  const donorMap = Object.fromEntries(relatedDonors.map(d => [d.id, d]));

  const relationships = rows.map(r => ({
    id: r.id,
    relationshipType: r.relationship_type,
    notes: r.notes,
    relatedDonorId: r.related_donor_id,
    // PEOPLE-1: someone who has died reads "Harold Lee (died March 2026)"; the link and the household stay.
    relatedDonorName: (n => { const x = donorMap[r.related_donor_id]; if (!x || !x.deceased) return n; const w = require("./deceased").diedWords(x.deceased_date); return `${n} (${w ? `died ${w}` : "died"})`; })(donorMap[r.related_donor_id]?.name || "(deleted donor)"),
    relatedDonorDeceased: donorMap[r.related_donor_id]?.deceased === true,
    relatedDonorTotalGiving: Number(donorMap[r.related_donor_id]?.total_giving) || 0,
    // POLISH-4: which end of a person-to-organization link this record is
    // ("person": Gives through X; "organization": Owner: Y).
    side: PERSON_TO_ORG.has(r.relationship_type) ? (r.mine_first ? "person" : "organization") : null,
  }));

  // TRUTH-5 (W-1109-Finance-37X): on an organisation, the people linked to it
  // read what they gave THROUGH it (soft credit on its gifts), never their lifetime.
  const orgSide = relationships.filter(r => r.side === "organization");
  let through = null;
  if (relationships.some(r => r.side)) {
    const ST = require("../../shared/numbers/softThrough");
    if (orgSide.length) {
      const [per, sum] = await Promise.all([ST.throughByPerson(query, orgId, donorId, orgSide.map(r => r.relatedDonorId)), ST.throughSummary(query, orgId, donorId)]);
      through = { cents: sum.cents, people: sum.people, sentence: ST.summaryWords(sum, "this organization"), definition: ST.SENTENCE };
      for (const r of orgSide) { r.throughCents = per.get(r.relatedDonorId) || 0; r.throughSummary = through; }
    }
    // On the person: what they hold through the organisation they give through.
    for (const r of relationships.filter(x => x.side === "person")) r.throughCents = (await ST.throughByPerson(query, orgId, r.relatedDonorId, [donorId])).get(donorId) || 0;
  }

  // FIX-49 decision 8: the household record is the only grouping. The total
  // is the household's combined giving (`household-giving`, the household
  // panel's own figure), never a second sum over spouse links.
  let householdTotal = null, householdTotalSource = null;
  const [me] = await query("SELECT household_id FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]);
  if (me && me.household_id) {
    householdTotalSource = { key: "household-giving", params: { household: me.household_id } };
    householdTotal = (await figureSources.figureValue(orgId, householdTotalSource)).value;
  }

  res.json({ relationships, householdTotal, householdTotalSource, through });
}));

app.post("/donors/:id/relationships", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const donorId = req.params.id;
  const { relatedDonorId, relationshipType, notes } = req.body;
  if (!relatedDonorId || !DONOR_RELATIONSHIP_TYPES.includes(relationshipType)) {
    return res.status(400).json({ error: "relatedDonorId and a valid relationshipType are required" });
  }
  if (relatedDonorId === donorId) return res.status(400).json({ error: "A donor can't be linked to themselves" });

  const bothRows = await query(
    "SELECT id, kind, person_types FROM donors WHERE org_id = ? AND id IN (?, ?) AND deleted_at IS NULL",
    [orgId, donorId, relatedDonorId]
  );
  if (bothRows.length < 2) return res.status(404).json({ error: "Donor not found" });
  // POLISH-4: a person-to-organization link is stored person first, from
  // whichever profile it was made.
  let [idA, idB] = [donorId, relatedDonorId];
  if (PERSON_TO_ORG.has(relationshipType) && isOrgRow(bothRows.find(d => d.id === donorId)) && !isOrgRow(bothRows.find(d => d.id === relatedDonorId))) [idA, idB] = [relatedDonorId, donorId];

  // Order-agnostic dedup — a link already stored as (B,A) shouldn't allow a
  // second (A,B) row for the same pair.
  const existing = await query(
    `SELECT id FROM donor_relationships WHERE org_id = ?
       AND ((donor_id_a = ? AND donor_id_b = ?) OR (donor_id_a = ? AND donor_id_b = ?))`,
    [orgId, donorId, relatedDonorId, relatedDonorId, donorId]
  );
  if (existing.length) return res.status(409).json({ error: "These donors are already linked" });

  const id = newId("drel");
  await run(
    "INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, notes, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)",
    [id, orgId, idA, idB, relationshipType, notes || null, actor(req).id, actor(req).name]
  );
  if (req.audit) {
    const [r] = await query("SELECT * FROM donor_relationships WHERE id = ?", [id]);
    req.audit.after(await auditShape("donor_relationships", r, orgId));
  }
  // FIX-49 decision 8: a spouse or household link puts the two in one
  // household record, the one grouping (db.js householdsFromLinks).
  if (HOUSEHOLD_RELATIONSHIP_TYPES.includes(relationshipType)) await require("../../db").householdsFromLinks(orgId).catch(e => console.error("[fix-49] household:", e.message));
  // POLISH-4: one giving unit now; an automatic Lapsed either one outlived goes.
  if (PERSON_TO_ORG.has(relationshipType) || HOUSEHOLD_RELATIONSHIP_TYPES.includes(relationshipType)) await require("../../afterChange").afterChange(orgId, [idA, idB], { door: "relationship", recalc: false }).catch(e => console.error("[polish-4] link:", e.message));
  res.status(201).json({ id });
}));

// FIX-15 Part 4 — a relationship from BEFORE FIX-14, or one an import or the
// system made, has no person who "linked them" to defer to. Those belong to
// whoever can edit the donor (the same gate as PUT /donors/:id: signed in, with
// write access). One made since FIX-14 by a person stays theirs, or an admin's.
const FIX14_SHIPPED = "2026-10-02T05:09:42Z";
async function mayEditRelationship(req, r) {
  const humanMade = r.created_by && !String(r.created_by).startsWith("system:");
  const legacy = !humanMade || (r.created_at && new Date(r.created_at) < new Date(FIX14_SHIPPED));
  if (legacy) return true;
  return mayEditLogged(req, r);
}

// FIX-14 Part 2b — edit a relationship's kind and its note. Whoever linked
// the two, or an admin (FIX-15: or anyone who can edit the donor, for a legacy one).
app.put("/donor-relationships/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const [r] = await query("SELECT * FROM donor_relationships WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (!(await mayEditRelationship(req, r))) return res.status(403).json(NOT_YOURS);
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.relationshipType !== undefined && b.relationshipType !== r.relationship_type) {
    if (!DONOR_RELATIONSHIP_TYPES.includes(b.relationshipType)) return res.status(400).json({ error: "A valid relationshipType is required" });
    sets.push("relationship_type=?"); vals.push(b.relationshipType);
  }
  if (b.notes !== undefined && String(b.notes || "") !== String(r.notes || "")) {
    sets.push("notes=?"); vals.push(String(b.notes || "").slice(0, 2000) || null);
  }
  if (!sets.length) return res.json({ ...r, unchanged: true });
  sets.push("edited_at=NOW()", "edited_by=?", "edited_by_name=?");
  vals.push(...(await editStamp(req)));
  await run(`UPDATE donor_relationships SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, [...vals, req.params.id, orgId]);
  const [out] = await query("SELECT * FROM donor_relationships WHERE id = ?", [req.params.id]);
  if (req.audit) { req.audit.before(await auditShape("donor_relationships", r, orgId)); req.audit.after(await auditShape("donor_relationships", out, orgId)); }
  res.json(out);
}));

// FIX-14 Part 2b: whoever linked them, or an admin; to the trash, so Undo works.
app.delete("/donor-relationships/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [r] = await query("SELECT * FROM donor_relationships WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  if (!(await mayEditRelationship(req, r))) return res.status(403).json(NOT_YOURS);
  if (req.audit) req.audit.before(await auditShape("donor_relationships", r, req.user.orgId));
  const undoId = await trashRow("donor_relationships", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// The volunteer's own link — signed, expiring, and it names ONE person in ONE
// org. The signature covers both, so a token cannot be pointed at somebody
// else. It is a link staff hand over; Steward never emails it on its own.
function signVolunteerToken(orgId, personId, exp) {
  const body = `${orgId}.${personId}.${exp}`;
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update("volunteer-log:" + body).digest("base64url");
  return Buffer.from(body).toString("base64url") + "." + sig;
}

// ── PARITY-3 Part 1 · THE VOLUNTEER RECORD ON THE PROFILE ─────────────────
// The hours log, filtered by date range and opportunity; this year and
// lifetime, each opening its rows through the one `volunteer-hours` figure
// source; the opportunities to log against; and the plain glance line
// ("44 hours since 2023, last served May 22"). Hours are read from
// volunteer_shifts and nowhere else.
const VOL_LOG_MAX = 1000;
async function volunteerLog(orgId, personId, q = {}) {
  const where = ["v.org_id=?", "v.person_id=?"], args = [orgId, personId];
  const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  if (ok(q.from)) { where.push("v.date >= ?"); args.push(String(q.from)); }
  if (ok(q.to)) { where.push("v.date <= ?"); args.push(String(q.to)); }
  if (q.opportunityId) { where.push("v.opportunity_id = ?"); args.push(String(q.opportunityId)); }
  return query(
    `SELECT v.id, v.date, v.hours, v.role, v.note, v.via, v.created_at, v.updated_at,
            COALESCE(u.name, v.created_by_name) AS created_by_name,
            v.opportunity_id, v.slot_id, v.start_time, v.end_time, o.name AS opportunity_name
       FROM volunteer_shifts v LEFT JOIN volunteer_opportunities o ON o.id=v.opportunity_id AND o.org_id=v.org_id
       LEFT JOIN users u ON u.id = v.created_by AND u.org_id = v.org_id
      WHERE ${where.join(" AND ")} ORDER BY v.date DESC NULLS LAST, v.created_at DESC LIMIT ${VOL_LOG_MAX}`, args);
}
const VIA_WORD = { staff: "Staff", self: "The volunteer, from their own link", import: "An import" };

app.get("/donors/:id/volunteer-hours", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const shifts = await volunteerLog(orgId, d.id, req.query || {});
  // VOL-1 — the shifts they are SIGNED UP FOR, beside the hours they have
  // already given. The record answers both questions a person opening it
  // asks: what have they done, and when will I see them next.
  const upcoming = await query(
    `SELECT s.date, s.start_time, s.end_time, COALESCE(s.name, o.name) AS opp_name, su.status
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id
       JOIN volunteer_opportunities o ON o.id = s.opportunity_id
      WHERE su.org_id=? AND su.person_id=? AND su.status IN ('confirmed','waitlisted')
        AND s.cancelled_at IS NULL AND s.date >= ?
      ORDER BY s.date, s.start_time LIMIT 6`, [orgId, d.id, today]).catch(() => []);
  // STALE-2 (W-1107-Volunteers-24): the shifts they were scheduled on that are
  // behind them, beside Coming up; done, or marked as not coming.
  const pastScheduled = await query(
    `SELECT s.date, s.start_time, s.end_time, COALESCE(s.name, o.name) AS opp_name, su.status
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id AND s.org_id = su.org_id
       JOIN volunteer_opportunities o ON o.id = s.opportunity_id AND o.org_id = s.org_id
      WHERE su.org_id=? AND su.person_id=? AND su.status IN ('confirmed','completed','no_show')
        AND s.cancelled_at IS NULL AND s.date < ?
      ORDER BY s.date DESC, s.start_time DESC LIMIT 10`, [orgId, d.id, today]).catch(() => []);
  const sum = await volunteerSummary(orgId, d.id);
  const [yr] = await query(`SELECT COALESCE(SUM(ROUND(hours*100)),0)::bigint AS h FROM volunteer_shifts WHERE org_id=? AND person_id=? AND date >= ? AND date <= ?`,
    [orgId, d.id, today.slice(0, 4) + "-01-01", today]);
  const opps = await query(`SELECT id, name FROM volunteer_opportunities WHERE org_id=? AND archived_at IS NULL ORDER BY name`, [orgId]);
  const lifeFrom = "1900-01-01", lifeTo = "2999-12-31";
  const first = sum.firstShift ? String(sum.firstShift).slice(0, 10) : null, last = sum.lastShift ? String(sum.lastShift).slice(0, 10) : null;
  const dd = iso => { const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))); return t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + (iso.slice(0, 4) !== today.slice(0, 4) ? `, ${iso.slice(0, 4)}` : ""); };
  res.json({ ...sum,
    sentence: "Every shift logged for this person, by staff at check-in or by hand, by the volunteer from their link, or from an import.",
    thisYear: { hours: Number(yr.h || 0) / 100, label: `Hours in ${today.slice(0, 4)}`,
      sentence: `Every volunteer shift dated January 1 to today, ${today.slice(0, 4)}, added up.`,
      source: { key: "volunteer-hours", params: { from: today.slice(0, 4) + "-01-01", to: today, donor: d.id } } },
    lifetime: { hours: sum.totalHours, label: "Hours in all",
      sentence: "Every volunteer shift ever logged for this person, added up.",
      source: { key: "volunteer-hours", params: { from: lifeFrom, to: lifeTo, donor: d.id } } },
    glanceLine: sum.shiftCount ? `${sum.totalHours} ${sum.totalHours === 1 ? "hour" : "hours"} since ${first.slice(0, 4)}, last served ${dd(last)}` : null,
    opportunities: opps,
    upcoming: upcoming.map(u => ({
      when: `${u.opp_name}, ${u.date}${u.status === "waitlisted" ? " (waiting list)" : ""}`,
      date: u.date, status: u.status })),
    pastShifts: pastScheduled.map(u => ({
      when: `${u.opp_name}, ${u.date}${u.status === "no_show" ? " (did not come)" : ""}`, date: u.date, status: u.status })),
    filtered: !!(req.query.from || req.query.to || req.query.opportunityId),
    shifts: shifts.map(s => ({ id: s.id, date: s.date, hours: Number(s.hours), role: s.role, note: s.note,
      opportunityId: s.opportunity_id || null, opportunityName: s.opportunity_name || null, slotId: s.slot_id || null,
      startTime: s.start_time || null, endTime: s.end_time || null,
      enteredAt: s.created_at, enteredBy: s.created_by_name || VIA_WORD[s.via] || "", via: s.via, editedAt: s.updated_at || null })) });
}));

// The same filtered log, as a file.
app.get("/donors/:id/volunteer-hours.csv", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const rows = await volunteerLog(orgId, d.id, req.query || {});
  const cell = require("../shared/csvCell").csvCell;   // REDTEAM-1: one guard
  const lines = [["Person", "Opportunity", "Date", "Hours", "Start", "End", "Entered", "Entered by", "Notes"].join(",")];
  for (const r of rows) lines.push([d.name, r.opportunity_name || r.role || "", r.date, Number(r.hours), r.start_time || "", r.end_time || "",
    r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ") : "", r.created_by_name || VIA_WORD[r.via] || "", r.note || ""].map(cell).join(","));
  const total = rows.reduce((a, r) => a + Math.round(Number(r.hours) * 100), 0) / 100;
  lines.push(["Total", "", "", total, "", "", "", "", ""].map(cell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="volunteer-hours.csv"`);
  res.send(lines.join("\r\n") + "\r\n");
}));

app.post("/donors/:id/volunteer-hours", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const b = req.body || {};
  let opp = null;
  if (b.opportunityId) {
    [opp] = await query("SELECT id, name FROM volunteer_opportunities WHERE id=? AND org_id=?", [String(b.opportunityId), orgId]);
    if (!opp) return res.status(404).json({ error: "That opportunity is not one of yours." });
  }
  const v = VH.validateShift({ ...b, role: b.role || (opp && opp.name) || null });
  if (!v.ok) return res.status(400).json({ error: `A shift needs ${v.errors.join("; ")}.` });
  const id = await insertShift(orgId, d.id, { ...v.shift, opportunityId: opp ? opp.id : null }, { via: "staff", who: actor(req) });
  res.status(201).json({ id, ...(await volunteerSummary(orgId, d.id)) });
}));

// What a volunteer is qualified for and what they told you: tags, skills and
// certifications; the background check and waiver with their state and
// expiry; the answers on their application; and the coordinator's notes,
// internal and the ones the volunteer can see, kept apart.
app.get("/donors/:id/volunteer-profile", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const VS = await import("../../shared/volunteerShifts.js");
  const quals = await query(`SELECT id, kind, name, expires_on, created_by_name, created_at FROM volunteer_qualifications
                              WHERE org_id=? AND person_id=? ORDER BY kind, lower(name)`, [orgId, d.id]);
  const creds = await query(`SELECT DISTINCT ON (kind) kind, signed_on, expires_on, reference FROM volunteer_credentials
                              WHERE org_id=? AND person_id=? AND superseded_at IS NULL ORDER BY kind, signed_on DESC`, [orgId, d.id]);
  const apps = await query(`SELECT id, status, answers, availability, submitted_at, decided_at, decided_by_name, hours_per_week, roles, via FROM volunteer_applications
                             WHERE org_id=? AND person_id=? ORDER BY submitted_at DESC LIMIT 5`, [orgId, d.id]).catch(() => []);
  const notes = await query(`SELECT id, kind, body, note_date, visibility, created_by_name, created_at FROM volunteer_notes
                              WHERE org_id=? AND person_id=? ORDER BY created_at DESC LIMIT 100`, [orgId, d.id]);
  const parse = v => { try { return typeof v === "string" ? JSON.parse(v) : (v || null); } catch { return null; } };
  res.json({
    qualifications: quals.map(q => ({ id: q.id, kind: q.kind, name: q.name, expiresOn: q.expires_on || null,
      expired: !!(q.expires_on && q.expires_on < today), addedBy: q.created_by_name || "" })),
    credentials: creds.map(c => ({ kind: c.kind, signedOn: c.signed_on, expiresOn: c.expires_on || null, reference: c.reference || null,
      ...VS.credentialState({ kind: c.kind, signedOn: c.signed_on, expiresOn: c.expires_on }, today) })),
    applications: apps.map(a => ({ id: a.id, status: a.status, answers: parse(a.answers) || [], availability: parse(a.availability) || [],
      submittedAt: a.submitted_at, decidedAt: a.decided_at, decidedBy: a.decided_by_name || "",
      hoursPerWeek: a.hours_per_week != null ? Number(a.hours_per_week) : null, roles: parse(a.roles) || [], via: a.via || "page" })),
    // FIX-24 Part 1: their volunteer record (makeVolunteer): the approved
    // application, or null when they have none and are not on Volunteers yet.
    record: (() => { const a = apps.find(x => x.status === "approved"); return a ? { id: a.id,
      hoursPerWeek: a.hours_per_week != null ? Number(a.hours_per_week) : null, availability: parse(a.availability) || [],
      roles: parse(a.roles) || [], via: a.via || "page", since: a.decided_at } : null; })(),
    notes: notes.map(n => ({ id: n.id, kind: n.kind, body: n.body, date: n.note_date, visibility: n.visibility || "internal",
      by: n.created_by_name || "", at: n.created_at })),
    sentences: {
      qualifications: "Skills, certifications and tags you keep for this volunteer. A certification can carry the date it runs out.",
      notes: "Internal notes are for staff only. A note marked for the volunteer shows on their own page.",
    },
  });
}));

app.post("/donors/:id/volunteer-qualifications", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const kind = String(req.body?.kind || ""), name = String(req.body?.name || "").trim().slice(0, 80);
  const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.expiresOn || "")) ? String(req.body.expiresOn) : null;
  if (!["skill", "certification", "tag"].includes(kind)) return res.status(400).json({ error: "That is a skill, a certification or a tag." });
  if (!name) return res.status(400).json({ error: "Give it a name." });
  const id = newId("vq");
  const r = await query(`INSERT INTO volunteer_qualifications (id,org_id,person_id,kind,name,expires_on,created_by,created_by_name)
                         VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`, [id, orgId, d.id, kind, name, kind === "certification" ? expiresOn : null, who.id, who.name]);
  if (!r.length) return res.status(409).json({ error: `They already have ${name}.` });
  res.status(201).json({ id });
}));
app.delete("/volunteer-qualifications/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM volunteer_qualifications WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// The link staff hand to a volunteer so they can log their own hours.
app.post("/donors/:id/volunteer-link", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const exp = Date.now() + VH.SELF_LOG_DAYS * 86400000;
  res.json({ url: `${publicAppUrl()}/volunteer/log?token=${signVolunteerToken(req.user.orgId, d.id, exp)}`,
    expiresInDays: VH.SELF_LOG_DAYS,
    sentence: `Anyone with this link can log hours for this person for the next ${VH.SELF_LOG_DAYS} days. Steward does not send it; you do.` });
}));
}

module.exports = { routers, mount };
