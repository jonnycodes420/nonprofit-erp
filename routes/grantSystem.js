// routes/grantSystem.js · GRANTS-1. FUNDERS, THE PIPELINE, A GRANT'S CHECKLIST.
//
//   GET    /grant-funders                       every funder: asks, awards, win rate, next deadline
//   POST   /grant-funders                       a new funder (an organisation row in donors)
//   GET    /grant-funders/:id                   one funder: contacts, interests, cycle, history, win rate
//   PUT    /grant-funders/:id                   what the grants office knows about it
//   POST   /grant-funders/:id/contacts          a program officer or contact (a person row, linked)
//   POST   /grant-funders/contacts/:relId/remove
//   PATCH  /grants/:id/stage                    move a grant to a stage (the board's drag, and Undo)
//   GET    /grants/:id/checklist                its tasks
//   POST   /grants/:id/checklist                add one (a task with an owner and a due date)
//   PUT    /grants/checklist/:taskId            change, tick or untick one
//   GET    /grants/:id/award-plan               the award's instalments, each with the gift that paid it
//
// The funder is a row in `donors` and its people are rows in `donors` too
// (one person record), linked by donor_relationships. A checklist item is an
// ordinary task with a grant_id, so it is on the Calendar and the task list.
// Every write is recorded by the one audit write; nothing here writes one.
"use strict";
const express = require("express");
const TL = require("../timelineLine");   // WIRE-1 rule 2: grant moves land on the funder

const routers = { r0: express.Router() };
const shapeMod = () => import("../shared/grantShape.js");
const CONTACT_ROLES = ["program_officer", "funder_contact"];
const CYCLES = ["annual", "biannual", "quarterly", "rolling", "invitation_only", "unknown"];
const cents = v => (v === null || v === undefined || v === "" ? 0 : Math.round(Number(v) * 100));
const isOrg = d => d && (d.kind === "organisation" || (Array.isArray(d.person_types) && d.person_types.includes("organization")));

function mount(ctx) {
const { actor, checkWriteAccess, query, run, requireAuth, uuid, wrap, orgTz, orgToday } = ctx;
const app = routers.r0;
const newId = p => `${p}_${uuid().replace(/-/g, "").slice(0, 12)}`;

async function funderRow(orgId, id) {
  const [d] = await query(`SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [id, orgId]);
  return d || null;
}

// One funder's grants, summarised: asks, awards, decided, win rate.
function history(G, grants) {
  let asks = 0, awards = 0, declined = 0, awardedCents = 0, requestedCents = 0;
  for (const g of grants) {
    const s = G.normalizeStatus(g.status);
    asks++;
    requestedCents += cents(g.amount_requested != null ? g.amount_requested : g.amount);
    if (G.AWARDED_STATUS_KEYS.includes(s)) { awards++; awardedCents += cents(g.amount_awarded != null ? g.amount_awarded : g.amount); }
    if (s === "declined") declined++;
  }
  const decided = awards + declined;
  const winRate = decided ? Math.round((awards / decided) * 100) : null;
  return { asks, awards, declined, decided, awardedCents, requestedCents, winRate,
    winSentence: decided ? `Won ${awards} of ${decided} decided ${decided === 1 ? "ask" : "asks"} (${winRate}%).` : "No ask has been decided yet, so there is no win rate." };
}

app.get("/grant-funders", requireAuth, wrap(async (req, res) => {
  const G = await shapeMod();
  const orgId = req.user.orgId;
  const funders = await query(
    `SELECT d.id, d.name, d.funder_type, d.funder_cycle, d.funder_due_months, d.email
       FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
        AND (d.funder_type IS NOT NULL OR EXISTS (SELECT 1 FROM grants g WHERE g.org_id=d.org_id AND g.funder_donor_id=d.id AND g.is_sample IS NOT TRUE))
      ORDER BY d.name`, [orgId]);
  const ids = funders.map(f => f.id);
  const grants = ids.length ? await query(
    `SELECT id, funder_donor_id, status, amount, amount_requested, amount_awarded FROM grants
      WHERE org_id=? AND is_sample IS NOT TRUE AND funder_donor_id = ANY(?::text[])`, [orgId, ids]) : [];
  const next = ids.length ? await query(
    `SELECT g.funder_donor_id, MIN(m.due_date) AS due FROM grant_milestones m JOIN grants g ON g.id=m.grant_id AND g.org_id=m.org_id
      WHERE m.org_id=? AND m.state NOT IN ('done','skipped') AND m.due_date >= ? AND g.funder_donor_id = ANY(?::text[])
      GROUP BY g.funder_donor_id`, [orgId, orgToday(await orgTz(orgId)), ids]) : [];   // ORG_TZ_SEAM_OK
  const contacts = ids.length ? await query(
    `SELECT donor_id_a, COUNT(*)::int AS n FROM donor_relationships WHERE org_id=? AND relationship_type = ANY(?::text[]) AND donor_id_a = ANY(?::text[])
      GROUP BY donor_id_a`, [orgId, CONTACT_ROLES, ids]) : [];
  const nextBy = new Map(next.map(r => [r.funder_donor_id, r.due]));
  const contactsBy = new Map(contacts.map(r => [r.donor_id_a, r.n]));
  res.json({
    funderTypes: G.FUNDER_TYPES, cycles: CYCLES,
    funders: funders.map(f => {
      const h = history(G, grants.filter(g => g.funder_donor_id === f.id));
      return { id: f.id, name: f.name, funderType: f.funder_type || null, cycle: f.funder_cycle || null, dueMonths: f.funder_due_months || [],
        contacts: contactsBy.get(f.id) || 0, nextDeadline: nextBy.get(f.id) || null, ...h };
    }),
  });
}));

app.post("/grant-funders", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const G = await shapeMod();
  const orgId = req.user.orgId;
  const name = String(req.body?.name || "").trim().slice(0, 200);
  if (!name) return res.status(400).json({ error: "A funder needs a name." });
  const type = req.body?.funderType ? String(req.body.funderType) : null;
  if (type && !G.FUNDER_TYPES.some(t => t.key === type)) return res.status(400).json({ error: "That is not a kind of funder." });
  const [dupe] = await query(`SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) AND kind='organisation'`, [orgId, name]);
  if (dupe) return res.status(409).json({ error: "funder_exists", id: dupe.id, sentence: `${name} is already on file.` });
  const id = newId("d");
  const who = actor(req);
  await run(`INSERT INTO donors (id,org_id,name,email,kind,person_types,stage,status,tags,funder_type,created_by,created_by_name)
             VALUES (?,?,?,?,'organisation','["other"]'::jsonb,'prospect','active','[]',?,?,?)`,
    [id, orgId, name, String(req.body?.email || "").trim().toLowerCase() || null, type, who.id, who.name]);
  res.status(201).json({ id, name });
}));

app.get("/grant-funders/:id", requireAuth, wrap(async (req, res) => {
  const G = await shapeMod();
  const orgId = req.user.orgId;
  const f = await funderRow(orgId, req.params.id);
  if (!f) return res.status(404).json({ error: "Funder not found" });
  const [grants, contacts, filing] = await Promise.all([
    query(`SELECT g.*, (SELECT MIN(m.due_date) FROM grant_milestones m WHERE m.grant_id=g.id AND m.org_id=g.org_id AND m.state NOT IN ('done','skipped')) AS next_due
             FROM grants g WHERE g.org_id=? AND g.funder_donor_id=? AND g.is_sample IS NOT TRUE ORDER BY g.created_at DESC`, [orgId, f.id]),
    query(`SELECT r.id AS rel_id, r.relationship_type, r.notes, p.id, p.name, p.email, p.phone
             FROM donor_relationships r JOIN donors p ON p.id=r.donor_id_b AND p.org_id=r.org_id AND p.deleted_at IS NULL
            WHERE r.org_id=? AND r.donor_id_a=? AND r.relationship_type = ANY(?::text[]) ORDER BY r.relationship_type DESC, p.name`, [orgId, f.id, CONTACT_ROLES]),
    query(`SELECT * FROM public_filings WHERE org_id=? AND donor_id=?`, [orgId, f.id]).catch(() => []),
  ]);
  const h = history(G, grants);
  res.json({
    id: f.id, name: f.name, email: f.email || null, funderType: f.funder_type || null, ein: f.funder_ein || null,
    interests: f.funder_interests || "", awardMin: f.funder_award_min != null ? Number(f.funder_award_min) : null,
    awardMax: f.funder_award_max != null ? Number(f.funder_award_max) : null,
    cycle: f.funder_cycle || null, dueMonths: f.funder_due_months || [], notes: f.funder_notes || "",
    isOrganisation: isOrg(f),
    contacts: contacts.map(c => ({ relId: c.rel_id, id: c.id, name: c.name, email: c.email || null, phone: c.phone || null,
      role: c.relationship_type, title: c.notes || "" })),
    grants: grants.map(g => ({ id: g.id, program: g.program || "", status: G.normalizeStatus(g.status) || g.status,
      statusLabel: G.statusLabel(g.status) || g.status, requestedCents: cents(g.amount_requested != null ? g.amount_requested : g.amount),
      awardedCents: cents(g.amount_awarded), awardedAt: g.awarded_at || null, declineReason: g.decline_reason || null,
      cycleName: g.cycle_name || null, nextDue: g.next_due || null, createdAt: g.created_at })),
    filing: filing[0] || null,
    funderTypes: G.FUNDER_TYPES, cycles: CYCLES,
    ...h,
  });
}));

app.put("/grant-funders/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const G = await shapeMod();
  const orgId = req.user.orgId;
  const f = await funderRow(orgId, req.params.id);
  if (!f) return res.status(404).json({ error: "Funder not found" });
  const b = req.body || {};
  const has = k => Object.prototype.hasOwnProperty.call(b, k);
  const sets = [], args = [];
  if (has("funderType")) {
    if (b.funderType && !G.FUNDER_TYPES.some(t => t.key === b.funderType)) return res.status(400).json({ error: "That is not a kind of funder." });
    sets.push("funder_type=?"); args.push(b.funderType || null);
  }
  if (has("interests")) { sets.push("funder_interests=?"); args.push(String(b.interests || "").slice(0, 4000)); }
  if (has("notes")) { sets.push("funder_notes=?"); args.push(String(b.notes || "").slice(0, 8000)); }
  for (const [k, col] of [["awardMin", "funder_award_min"], ["awardMax", "funder_award_max"]]) {
    if (!has(k)) continue;
    const v = b[k] === "" || b[k] === null ? null : Number(b[k]);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: "An award size is a dollar amount." });
    sets.push(`${col}=?`); args.push(v);
  }
  if (has("cycle")) {
    if (b.cycle && !CYCLES.includes(b.cycle)) return res.status(400).json({ error: "That is not a grant cycle Steward knows." });
    sets.push("funder_cycle=?"); args.push(b.cycle || null);
  }
  if (has("dueMonths")) {
    const months = [...new Set((Array.isArray(b.dueMonths) ? b.dueMonths : []).map(Number))].filter(m => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, c) => a - c);
    sets.push("funder_due_months=?::int[]"); args.push(months);
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to change." });
  if (has("awardMin") && has("awardMax") && b.awardMin !== "" && b.awardMax !== "" && b.awardMin != null && b.awardMax != null && Number(b.awardMin) > Number(b.awardMax)) {
    return res.status(400).json({ error: "The smallest typical award is bigger than the largest." });
  }
  await run(`UPDATE donors SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...args, f.id, orgId]);
  res.json({ ok: true });
}));

app.post("/grant-funders/:id/contacts", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const f = await funderRow(orgId, req.params.id);
  if (!f) return res.status(404).json({ error: "Funder not found" });
  const role = CONTACT_ROLES.includes(req.body?.role) ? req.body.role : "funder_contact";
  const who = actor(req);
  let personId = req.body?.personId ? String(req.body.personId) : null;
  if (personId) {
    const p = await funderRow(orgId, personId);
    if (!p || isOrg(p)) return res.status(400).json({ error: "That person is not on file." });
  } else {
    const name = String(req.body?.name || "").trim().slice(0, 200);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 320);
    if (!name) return res.status(400).json({ error: "A contact needs a name." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "That email address does not look right." });
    // One person record: the same email in this org is the same person.
    const matched = email ? await query(`SELECT id, kind, person_types FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL ORDER BY created_at LIMIT 2`, [orgId, email]) : [];
    const person = matched.find(m => !isOrg(m));
    if (person) personId = person.id;
    else {
      personId = newId("d");
      await run(`INSERT INTO donors (id,org_id,name,email,kind,person_types,stage,status,tags,employer,created_by,created_by_name)
                 VALUES (?,?,?,?,'person','["other"]'::jsonb,'prospect','active','[]',?,?,?)`,
        [personId, orgId, name, email || null, f.name, who.id, who.name]);
    }
  }
  const [already] = await query(`SELECT id FROM donor_relationships WHERE org_id=? AND donor_id_a=? AND donor_id_b=? AND relationship_type = ANY(?::text[])`,
    [orgId, f.id, personId, CONTACT_ROLES]);
  if (already) {
    await run(`UPDATE donor_relationships SET relationship_type=?, notes=COALESCE(?, notes) WHERE id=? AND org_id=?`,
      [role, req.body?.title ? String(req.body.title).slice(0, 200) : null, already.id, orgId]);
    return res.json({ ok: true, relId: already.id, personId });
  }
  const relId = newId("rel");
  await run(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,notes,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)`,
    [relId, orgId, f.id, personId, role, String(req.body?.title || "").slice(0, 200) || null, who.id, who.name]);
  res.status(201).json({ ok: true, relId, personId });
}));

app.post("/grant-funders/contacts/:relId/remove", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query(`SELECT * FROM donor_relationships WHERE id=? AND org_id=? AND relationship_type = ANY(?::text[])`, [req.params.relId, orgId, CONTACT_ROLES]);
  if (!r) return res.status(404).json({ error: "Contact not found" });
  await run(`DELETE FROM donor_relationships WHERE id=? AND org_id=?`, [r.id, orgId]);
  // What Undo needs to put it back exactly.
  res.json({ ok: true, funderId: r.donor_id_a, personId: r.donor_id_b, role: r.relationship_type, title: r.notes || "" });
}));

// THE BOARD'S DRAG. A stage is the canonical status; nothing else moves.
// Entering a stage that holds an award stamps awarded_at once; going back to
// an open stage or to declined clears it (the un-award). Declined needs its
// reason from the closed list. Closing a grant plans its renewal.
app.patch("/grants/:id/stage", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const G = await shapeMod();
  const orgId = req.user.orgId;
  const [g] = await query(`SELECT * FROM grants WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const status = G.normalizeStatus(req.body?.status);
  if (!status) return res.status(400).json({ error: "bad_stage", sentence: "That is not one of the eight stages." });
  const prev = G.normalizeStatus(g.status) || g.status;
  let declineReason = g.decline_reason || null, declinedOn = g.declined_on || null;
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  if (status === "declined") {
    const reason = req.body?.declineReason || g.decline_reason;
    if (!reason || !G.DECLINE_REASONS.some(r => r.key === reason)) {
      return res.status(400).json({ error: "decline_reason", sentence: "Say why they declined, from the list, so next year's ask can use it.", reasons: G.DECLINE_REASONS });
    }
    declineReason = reason; declinedOn = declinedOn || today;
  } else if (req.body?.restoreDecline === false || prev === "declined") {
    declineReason = req.body?.declineReason === undefined ? null : req.body.declineReason; declinedOn = null;
  }
  let awardedAt = g.awarded_at || null;
  if (G.AWARDED_STATUS_KEYS.includes(status) && !awardedAt) awardedAt = new Date().toISOString();
  if (!G.AWARDED_STATUS_KEYS.includes(status)) awardedAt = null;
  if (req.body?.awardedAt !== undefined && G.AWARDED_STATUS_KEYS.includes(status)) awardedAt = req.body.awardedAt || awardedAt;   // Undo puts the first stamp back
  const closedOn = status === "closed" ? (g.closed_on || today) : null;
  req.audit = { ...(req.audit || {}), before: { status: prev }, after: { status } };
  await run(`UPDATE grants SET status=?, awarded_at=?, decline_reason=?, declined_on=?, closed_on=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [status, awardedAt, declineReason, declinedOn, closedOn, g.id, orgId]);
  // WIRE-1: the move is on the funder's own timeline, when the grant has one.
  if (g.funder_donor_id && status !== prev) {
    const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]).catch(() => []);
    const who = { id: actor(req).id, name: (u && u.name) || actor(req).name };
    const program = g.program || g.funder || "grant";
    const firstAward = G.AWARDED_STATUS_KEYS.includes(status) && !g.awarded_at;
    const amt = Number(g.amount_awarded || g.amount_requested || g.amount || 0);
    await TL.timelineLine({ orgId, donorId: g.funder_donor_id, actorId: who.id, actorName: who.name,
      note: firstAward ? `Awarded ${amt > 0 ? TL.lineMoney(amt) + " " : ""}for ${program}.` : `Grant ${program} moved to ${G.statusLabel(status)}.`,
      key: firstAward ? `grant_awarded:${g.id}` : null,
      metadata: { via: "grant", grant_id: g.id, from: prev, to: status } });
  }
  let renewal = null;
  if (status === "closed" && prev !== "closed" && req.body?.planRenewal !== false) {
    const R = require("./grantReports");
    if (typeof R.planRenewal === "function") renewal = await R.planRenewal(orgId, g.id, actor(req)).catch(e => ({ skipped: true, sentence: `The renewal was not planned: ${e.message}` }));
  }
  res.json({ ok: true, id: g.id, status, previous: { status: prev, awardedAt: g.awarded_at || null, declineReason: g.decline_reason || null },
    label: G.statusLabel(status), renewal,
    sentence: `${g.funder || "The grant"} moved to ${G.statusLabel(status)}.` });
}));

// ── THE CHECKLIST ──────────────────────────────────────────────────────────
async function grantOf(orgId, id) {
  const [g] = await query(`SELECT id, funder, program FROM grants WHERE id=? AND org_id=?`, [id, orgId]);
  return g || null;
}
const taskRow = t => ({ id: t.id, title: t.title, due: t.due || null, assignedTo: t.assigned_to || null, assignedToName: t.assigned_to_name || "",
  done: String(t.done) === "1" || t.done === true, voided: !!t.voided_at });

app.get("/grants/:id/checklist", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantOf(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const [rows, staff] = await Promise.all([
    query(`SELECT * FROM tasks WHERE org_id=? AND grant_id=? AND voided_at IS NULL ORDER BY COALESCE(done,0), due NULLS LAST, created_at`, [orgId, g.id]),
    query(`SELECT id, name FROM users WHERE org_id=? AND deactivated_at IS NULL ORDER BY name`, [orgId]).catch(() => []),
  ]);
  res.json({ items: rows.map(taskRow), staff });
}));

app.post("/grants/:id/checklist", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantOf(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const title = String(req.body?.title || "").trim().slice(0, 300);
  if (!title) return res.status(400).json({ error: "A checklist item needs words." });
  const due = req.body?.due ? String(req.body.due) : null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "The due date must be YYYY-MM-DD." });
  let owner = null;
  if (req.body?.assignedTo) {
    const [u] = await query(`SELECT id, name FROM users WHERE id=? AND org_id=?`, [String(req.body.assignedTo), orgId]);
    if (!u) return res.status(400).json({ error: "That person is not on your team." });
    owner = u;
  }
  const id = newId("tk");
  const who = actor(req);
  await run(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,grant_id,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES (?,?,?,?,'medium','grant',0,?,?,?,?,?)`,
    [id, orgId, title, due, g.id, owner ? owner.id : null, owner ? owner.name : null, who.id, who.name]);
  const [t] = await query(`SELECT * FROM tasks WHERE id=?`, [id]);
  res.status(201).json(taskRow(t));
}));

app.put("/grants/checklist/:taskId", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [t] = await query(`SELECT * FROM tasks WHERE id=? AND org_id=? AND grant_id IS NOT NULL`, [req.params.taskId, orgId]);
  if (!t) return res.status(404).json({ error: "Checklist item not found" });
  const b = req.body || {};
  const has = k => Object.prototype.hasOwnProperty.call(b, k);
  const sets = [], args = [];
  if (has("title")) { const v = String(b.title || "").trim().slice(0, 300); if (!v) return res.status(400).json({ error: "A checklist item needs words." }); sets.push("title=?"); args.push(v); }
  if (has("due")) { if (b.due && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.due))) return res.status(400).json({ error: "The due date must be YYYY-MM-DD." }); sets.push("due=?"); args.push(b.due || null); }
  if (has("done")) { sets.push("done=?"); args.push(b.done ? 1 : 0); }
  if (has("removed")) { sets.push("voided_at=?"); args.push(b.removed ? new Date().toISOString() : null); if (b.removed) { sets.push("voided_reason=?"); args.push("removed from the grant checklist"); } }
  if (has("assignedTo")) {
    if (b.assignedTo) {
      const [u] = await query(`SELECT id, name FROM users WHERE id=? AND org_id=?`, [String(b.assignedTo), orgId]);
      if (!u) return res.status(400).json({ error: "That person is not on your team." });
      sets.push("assigned_to=?", "assigned_to_name=?"); args.push(u.id, u.name);
    } else { sets.push("assigned_to=NULL", "assigned_to_name=NULL"); }
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to change." });
  await run(`UPDATE tasks SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...args, t.id, orgId]);
  const [after] = await query(`SELECT * FROM tasks WHERE id=?`, [t.id]);
  res.json({ ...taskRow(after), previous: taskRow(t) });
}));

// ── THE AWARD, PAID IN INSTALMENTS ──────────────────────────────────────────
// Each instalment of the award pledge, with the gift that paid it when it
// arrived (recordGift applies a matching gift to the oldest unpaid one). The
// received total is the sum of those gifts, the same figure grantMoneyRows
// gives every other screen, so it foots to the cent.
app.get("/grants/:id/award-plan", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query(`SELECT id, funder, funder_donor_id, award_pledge_id, amount_awarded, status FROM grants WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  if (!g.award_pledge_id) return res.json({ pledge: null, installments: [], receivedCents: 0, awardedCents: cents(g.amount_awarded), canRecord: !!g.funder_donor_id,
    sentence: g.funder_donor_id ? "No award is recorded yet. Record it with its instalments and each payment links itself when it arrives." : "Link this grant to its funder on file before recording the award." });
  const [pl] = await query(`SELECT id, amount, status FROM pledges WHERE id=? AND org_id=?`, [g.award_pledge_id, orgId]);
  const inst = await query(
    `SELECT pi.id, pi.seq, pi.due_date, pi.amount, pi.paid_gift_id, pi.paid_at, gf.date AS gift_date, gf.amount AS gift_amount
       FROM pledge_installments pi LEFT JOIN gifts gf ON gf.id=pi.paid_gift_id AND gf.org_id=pi.org_id
      WHERE pi.org_id=? AND pi.pledge_id=? ORDER BY pi.seq`, [orgId, g.award_pledge_id]);
  const [rec] = await query(`SELECT COALESCE(SUM(amount),0) AS s FROM gifts WHERE org_id=? AND pledge_id=?`, [orgId, g.award_pledge_id]);
  const receivedCents = cents(rec.s), awardedCents = cents(g.amount_awarded != null ? g.amount_awarded : (pl && pl.amount));
  const paid = inst.filter(i => i.paid_gift_id).length;
  const fmt = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  res.json({
    pledge: pl ? { id: pl.id, status: pl.status } : null,
    installments: inst.map(i => ({ id: i.id, seq: i.seq, dueDate: i.due_date, amountCents: cents(i.amount),
      gift: i.paid_gift_id ? { id: i.paid_gift_id, date: String(i.gift_date || "").slice(0, 10), amountCents: cents(i.gift_amount) } : null })),
    receivedCents, awardedCents, outstandingCents: Math.max(0, awardedCents - receivedCents),
    sentence: `${fmt(receivedCents)} received of ${fmt(awardedCents)} awarded: ${paid} of ${inst.length} ${inst.length === 1 ? "instalment" : "instalments"} paid, each by the gift shown.`,
  });
}));
}

module.exports = { routers, mount };
