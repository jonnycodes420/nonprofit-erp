// server/majorGifts/top100.js · TOP100-1. A TOP 100 LIST WITH A RANK AND A
// PLAN OF CARE FOR EACH PERSON.
//
// A beta customer's CEO (9 Nov) kept her Top 100 in Excel: one row per
// person with rank, wealth score, giving, owner, plan and next step. This is
// that sheet, inside Steward.
//
//   GET    /top100                          the list, its rows, the templates
//   PATCH  /top100                          rename it
//   GET    /top100/export.csv               the same rows, in the order and filter on screen
//   POST   /top100/members                  add people ({ donorIds }), at the bottom
//   POST   /top100/members/:donorId/rank    move one to a rank; the others shift
//   DELETE /top100/members/:donorId         take one off; the gap closes
//   GET    /donors/:id/care-plan            the plan of care, its touches, its health
//   PUT    /donors/:id/care-plan            the goal, the ask and the ask-by day
//   POST   /donors/:id/care-plan/touches    a planned touch, which is a task
//   POST   /donors/:id/care-plan/template   a template's touches, from a start day
//   GET    /care-templates                  Quarterly touches and her own
//   POST   /care-templates                  save one from a person's plan
//
// WHO SEES IT: admins and staff with the major gifts permission, read live
// (prospect.canSee), the same as Room to give. Never donor-facing.
//
// THE RANK. 1 to N with no gaps and no two alike. Every change takes the
// list's row lock (SELECT … FOR UPDATE) and rewrites the ranks it moves in
// one statement; the unique (list_id, rank) key is checked at COMMIT, so a
// reorder may pass through a shared rank inside its transaction and can
// never land with one. Two people reordering at once take turns.
//
// Nothing here sends anything. Every write is recorded by the one audit write.
"use strict";
const express = require("express");
const P = require("../../prospect");
const { newId } = require("../shared/newId");
const { csvCell } = require("../shared/csvCell");

const routers = { r1: express.Router() };
let _shape = null;
const shapeMod = async () => _shape || (_shape = await import("../../shared/careShape.js"));

const SORTS = new Set(["rank", "name", "wealth", "lifetime", "lastGift", "owner", "stage", "ask", "askBy", "next", "lastContact", "health"]);

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, withTransaction, queryTx, runTx, actor, orgToday, orgTz, toCents, OU } = ctx;
const app = routers.r1;
const mg = P.requireMajorGifts(wrap);

async function todayOf(orgId) { return orgToday(await orgTz(orgId)); }   // ORG_TZ_SEAM_OK

// The org's one list, made the first time anyone opens it.
async function listOf(orgId, req) {
  const [l] = await query("SELECT id, name FROM portfolio_lists WHERE org_id=?", [orgId]);
  if (l || !req) return l || null;
  const a = actor(req);
  await run(`INSERT INTO portfolio_lists (id, org_id, name, created_by, created_by_name) VALUES (?,?,?,?,?) ON CONFLICT (org_id) DO NOTHING`,
    [newId("pfl"), orgId, "Top 100", a.id, a.name]);
  const [made] = await query("SELECT id, name FROM portfolio_lists WHERE org_id=?", [orgId]);
  return made;
}

async function donorOf(orgId, id) {
  const [d] = await query("SELECT id, name, assigned_to, assigned_to_name, stage FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(id || ""), orgId]);
  return d || null;
}

// ── The rows: one per person, the columns of her sheet ──────────────────────
async function listRows(orgId, listId, today, visible) {
  const S = await shapeMod();
  const v = visible && visible.sql ? visible : { sql: "", args: [] };   // ACCESS-2: only their assigned rows
  const people = await query(
    `SELECT m.rank, m.added_at, d.id, d.name, d.email, d.wealth_rating, d.total_giving, d.last_gift_date, d.last_gift_amount,
            d.assigned_to, d.assigned_to_name, d.stage, cp.id AS plan_id, cp.goal, cp.ask_cents, cp.ask_by
       FROM portfolio_members m
       JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
       LEFT JOIN care_plans cp ON cp.org_id = m.org_id AND cp.donor_id = m.donor_id
      WHERE m.org_id = ? AND m.list_id = ? AND d.deleted_at IS NULL${v.sql}
      ORDER BY m.rank`, [orgId, listId, ...v.args]);
  const ids = people.map(p => p.id);
  const touches = new Map(), lastConv = new Map(), thread = new Map();
  if (ids.length) {
    for (const t of await query(
      `SELECT t.id, t.donor_id, t.touch_type, t.title, t.due, t.done, t.assigned_to, t.assigned_to_name
         FROM tasks t JOIN care_plans cp ON cp.id = t.care_plan_id AND cp.org_id = t.org_id
        WHERE t.org_id = ? AND t.donor_id = ANY(?::text[]) AND t.voided_at IS NULL
        ORDER BY t.due ASC NULLS LAST, t.id`, [orgId, ids])) {
      if (!touches.has(t.donor_id)) touches.set(t.donor_id, []);
      touches.get(t.donor_id).push({ id: t.id, type: t.touch_type, label: S.touchLabel(t.touch_type), due: String(t.due || "").slice(0, 10), done: t.done === 1,
        owner: t.assigned_to ? { id: t.assigned_to, name: t.assigned_to_name } : null });
    }
    // Last contact: the one Last contact (meetings.js, COUNTS-1), the
    // profile header's own rule, for every row in three reads.
    for (const [id, lc] of await require("../../meetings").lastContactsFor(orgId, ids)) lastConv.set(id, lc);
    for (const r of await query(
      `SELECT donor_id, next_step_label, due_date FROM threads WHERE org_id = ? AND donor_id = ANY(?::text[]) AND closed_at IS NULL`, [orgId, ids]))
      thread.set(r.donor_id, { label: r.next_step_label, due: String(r.due_date || "").slice(0, 10) });
  }
  return people.map(p => {
    const ts = touches.get(p.id) || [];
    const nextTouch = ts.find(t => !t.done) || null;
    const lc = lastConv.get(p.id) || null;
    const days = lc && S.isDay(lc.date) ? Math.max(0, S.daysBetween(lc.date, today)) : null;
    const health = S.planHealth(ts, today);
    return {
      rank: p.rank, donorId: p.id, name: p.name,
      // WEALTH-1: the Wealth Score she sets (1 to 5), never the old automatic wealth_score.
      wealthScore: p.wealth_rating == null ? null : Number(p.wealth_rating),
      lifetimeCents: toCents(p.total_giving) || 0,
      lastGift: p.last_gift_date ? { date: String(p.last_gift_date).slice(0, 10), cents: toCents(p.last_gift_amount) || 0 } : null,
      owner: p.assigned_to ? { id: p.assigned_to, name: p.assigned_to_name || "" } : null,
      stage: p.stage || null,
      planId: p.plan_id || null, goal: p.goal || null,
      askCents: p.ask_cents == null ? null : Number(p.ask_cents), askBy: p.ask_by || null,
      next: nextTouch ? { kind: "touch", taskId: nextTouch.id, type: nextTouch.type, label: nextTouch.label, due: nextTouch.due }
        : (thread.get(p.id) ? { kind: "step", label: thread.get(p.id).label, due: thread.get(p.id).due } : null),
      lastContact: lc ? { ...lc, days } : null,
      health: { key: health.key, label: health.label, sentence: health.sentence },
      touchCount: ts.length, openTouches: ts.filter(t => !t.done).length,
    };
  });
}

// Filter and sort, the same for the screen and the file. Blanks sort last.
function shape(rows, q) {
  let out = rows;
  if (q.owner) out = out.filter(r => q.owner === "none" ? !r.owner : r.owner && r.owner.id === q.owner);
  if (q.minScore && /^[1-9]\d*$/.test(String(q.minScore))) out = out.filter(r => r.wealthScore != null && r.wealthScore >= Number(q.minScore));
  if (q.stage) out = out.filter(r => (r.stage || "none") === q.stage);
  if (q.health) out = out.filter(r => r.health.key === q.health);
  const sort = SORTS.has(q.sort) ? q.sort : "rank";
  const dir = q.dir === "desc" ? -1 : 1;
  const key = {
    rank: r => r.rank, name: r => String(r.name || "").toLowerCase(), wealth: r => r.wealthScore, lifetime: r => r.lifetimeCents,
    lastGift: r => r.lastGift && r.lastGift.date, owner: r => r.owner && r.owner.name.toLowerCase(), stage: r => r.stage,
    ask: r => r.askCents, askBy: r => r.askBy, next: r => r.next && r.next.due, lastContact: r => r.lastContact && r.lastContact.date,
    health: r => r.health.key,
  }[sort];
  return [...out].sort((a, b) => {
    const x = key(a), y = key(b);
    const bx = x == null || x === "", by = y == null || y === "";
    if (bx || by) return bx === by ? a.rank - b.rank : (bx ? 1 : -1);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.rank - b.rank;
  });
}

async function owners(orgId) {
  return query("SELECT id, name FROM users WHERE org_id=? AND deactivated_at IS NULL ORDER BY name", [orgId]);
}
async function templatesOf(orgId) {
  const S = await shapeMod();
  const mine = await query("SELECT id, name, touches FROM care_templates WHERE org_id=? AND archived_at IS NULL ORDER BY created_at", [orgId]);
  return [...S.BUILT_IN_TEMPLATES, ...mine.map(t => ({ id: t.id, name: t.name, builtIn: false, touches: Array.isArray(t.touches) ? t.touches : [] }))];
}

app.get("/top100", requireAuth, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const list = await listOf(orgId, null);
  const today = await todayOf(orgId);
  const rows = list ? await listRows(orgId, list.id, today, require("../auth/portfolio").visibleSql(req, "d")) : [];
  res.json({ list: list || { id: null, name: "Top 100" }, today, count: rows.length,
    rows: shape(rows, req.query || {}), owners: await owners(orgId), templates: await templatesOf(orgId),
    sentences: {
      rank: "Her order of who matters most, 1 at the top. Drag a row or type a number; the others shift.",
      lifetime: "Everything this person has given, refunds taken off (the profile's Lifetime).",
      lastGift: "The latest gift above zero.",
      lastContact: "The last call, meeting, email, note or visit logged on the person.",
      health: "On track when the next touch is ahead, Behind when one is overdue, No plan when none are planned.",
    } });
}));

app.patch("/top100", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const name = String((req.body && req.body.name) || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "name_required", sentence: "Give the list a name." });
  const list = await listOf(req.user.orgId, req);
  await run("UPDATE portfolio_lists SET name=?, updated_at=NOW() WHERE id=? AND org_id=?", [name, list.id, req.user.orgId]);
  res.json({ list: { id: list.id, name } });
}));

app.get("/top100/export.csv", requireAuth, mg, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const list = await listOf(orgId, null);
  const today = await todayOf(orgId);
  const rows = shape(list ? await listRows(orgId, list.id, today, require("../auth/portfolio").visibleSql(req, "d")) : [], req.query || {});
  const money = c => c == null ? "" : (c / 100).toFixed(2);
  const head = ["Rank", "Name", "Wealth Score", "Lifetime", "Last gift date", "Last gift amount", "Owner", "Stage", "Goal", "Ask amount", "Ask by", "Next step", "Next step date", "Last contact", "Plan health"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) lines.push([r.rank, r.name, r.wealthScore ?? "", money(r.lifetimeCents), r.lastGift ? r.lastGift.date : "", r.lastGift ? money(r.lastGift.cents) : "",
    r.owner ? r.owner.name : "", r.stage || "", r.goal || "", money(r.askCents), r.askBy || "", r.next ? r.next.label : "", r.next ? r.next.due : "",
    r.lastContact ? r.lastContact.date : "", r.health.label].map(csvCell).join(","));
  const name = String((list && list.name) || "Top 100").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "Top-100";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-${today}.csv"`);
  res.send(lines.join("\n") + "\n");
}));

// ── The rank ────────────────────────────────────────────────────────────────
// Inside the list's row lock: the members in rank order, then each one's new
// rank written in one statement. `order` is the donor ids top to bottom.
async function writeOrder(client, orgId, listId, order) {
  await runTx(client,
    `UPDATE portfolio_members m SET rank = v.r
       FROM unnest(?::text[], ?::int[]) AS v(donor_id, r)
      WHERE m.org_id = ? AND m.list_id = ? AND m.donor_id = v.donor_id AND m.rank <> v.r`,
    [order, order.map((_, i) => i + 1), orgId, listId]);
}
async function lockedOrder(client, orgId, listId) {
  await queryTx(client, "SELECT id FROM portfolio_lists WHERE id=? AND org_id=? FOR UPDATE", [listId, orgId]);
  return (await queryTx(client, "SELECT donor_id FROM portfolio_members WHERE org_id=? AND list_id=? ORDER BY rank, added_at", [orgId, listId])).map(r => r.donor_id);
}

app.post("/top100/members", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const want = [...new Set((Array.isArray(req.body && req.body.donorIds) ? req.body.donorIds : []).map(String))].slice(0, 500);
  if (!want.length) return res.status(400).json({ error: "no_people", sentence: "Pick at least one person to add." });
  const found = (await query("SELECT id FROM donors WHERE org_id=? AND id = ANY(?::text[]) AND deleted_at IS NULL", [orgId, want])).map(r => r.id);
  const foundSet = new Set(found);
  const ordered = want.filter(id => foundSet.has(id));
  if (!ordered.length) return res.status(404).json({ error: "not_found", sentence: "Those people are not in this organization." });
  const list = await listOf(orgId, req);
  const a = actor(req);
  const out = await withTransaction(async client => {
    const order = await lockedOrder(client, orgId, list.id);
    const on = new Set(order);
    const added = ordered.filter(id => !on.has(id));
    let rank = order.length;
    for (const id of added)
      await runTx(client, `INSERT INTO portfolio_members (id, org_id, list_id, donor_id, rank, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)`,
        [newId("pfm"), orgId, list.id, id, ++rank, a.id, a.name]);
    return { added: added.length, already: ordered.length - added.length, count: rank };
  });
  res.status(201).json({ ...out, skipped: want.length - ordered.length,
    sentence: `Added ${out.added} to ${list.name}${out.already ? `; ${out.already} already on it` : ""}.` });
}));

app.post("/top100/members/:donorId/rank", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const to = Number(req.body && req.body.rank);
  if (!Number.isInteger(to) || to < 1) return res.status(400).json({ error: "bad_rank", sentence: "A rank is a whole number, 1 or more." });
  const list = await listOf(orgId, null);
  if (!list) return res.status(404).json({ error: "not_on_list", sentence: "That person is not on the list." });
  const out = await withTransaction(async client => {
    const order = await lockedOrder(client, orgId, list.id);
    const at = order.indexOf(String(req.params.donorId));
    if (at < 0) return null;
    order.splice(at, 1);
    order.splice(Math.min(to, order.length + 1) - 1, 0, String(req.params.donorId));
    await writeOrder(client, orgId, list.id, order);
    return { rank: order.indexOf(String(req.params.donorId)) + 1, count: order.length };
  });
  if (!out) return res.status(404).json({ error: "not_on_list", sentence: "That person is not on the list." });
  res.json(out);
}));

app.delete("/top100/members/:donorId", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const list = await listOf(orgId, null);
  if (!list) return res.status(404).json({ error: "not_on_list", sentence: "That person is not on the list." });
  const out = await withTransaction(async client => {
    const order = await lockedOrder(client, orgId, list.id);
    const id = String(req.params.donorId);
    if (!order.includes(id)) return null;
    await runTx(client, "DELETE FROM portfolio_members WHERE org_id=? AND list_id=? AND donor_id=?", [orgId, list.id, id]);
    const rest = order.filter(x => x !== id);
    await writeOrder(client, orgId, list.id, rest);
    return { removed: 1, count: rest.length };
  });
  if (!out) return res.status(404).json({ error: "not_on_list", sentence: "That person is not on the list." });
  res.json(out);
}));

// ── Bring in ranks from her spreadsheet ────────────────────────────────────
// POST /top100/ranks {text, apply}. She pastes columns from Excel (tab or
// comma separated, a header row naming Rank and Name, Email or Steward ID).
// Each line is matched to one person: the Steward ID, else the email, else the
// exact name when only one person has it. Without `apply` it changes nothing
// and says who matched. With it, the matched people take their ranks in rank
// order (added if they are not on the list), and everyone else moves below.
function parseSheet(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 1001);
  if (lines.length < 2) return null;
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const cells = l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, "$1").trim());
  const head = cells(lines[0]).map(h => h.toLowerCase());
  const col = re => head.findIndex(h => re.test(h));
  const at = { rank: col(/^(rank|#|top ?100 rank|priority rank)$/), name: col(/^(name|full name|donor|donor name|constituent)$/),
    email: col(/e-?mail/), id: col(/^(steward id|id|donor id)$/) };
  if (at.rank < 0 || (at.name < 0 && at.email < 0 && at.id < 0)) return { bad: true };
  return { rows: lines.slice(1).map((l, i) => { const c = cells(l); return { line: i + 2, rank: Number(c[at.rank]), name: at.name >= 0 ? c[at.name] : "",
    email: at.email >= 0 ? c[at.email] : "", id: at.id >= 0 ? c[at.id] : "" }; }) };
}
app.post("/top100/ranks", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const sheet = parseSheet(req.body && req.body.text);
  if (!sheet || sheet.bad) return res.status(400).json({ error: "bad_sheet", sentence: "Paste a header row with Rank and a Name, Email or Steward ID column, then one row per person." });
  const people = await query("SELECT id, name, LOWER(COALESCE(email,'')) AS email FROM donors WHERE org_id=? AND deleted_at IS NULL", [orgId]);
  const byId = new Map(people.map(p => [p.id, p])), byEmail = new Map(), byName = new Map();
  for (const p of people) {
    if (p.email) byEmail.set(p.email, p);
    const k = String(p.name || "").trim().toLowerCase();
    byName.set(k, byName.has(k) ? null : p);   // null: two people share the name
  }
  const matched = [], unmatched = [];
  for (const r of sheet.rows) {
    if (!Number.isInteger(r.rank) || r.rank < 1) { unmatched.push({ line: r.line, said: r.name || r.email || r.id, why: "no rank" }); continue; }
    const k = String(r.name || "").trim().toLowerCase();
    const p = (r.id && byId.get(r.id)) || (r.email && byEmail.get(r.email.toLowerCase())) || (k && byName.get(k)) || null;
    if (!p) { unmatched.push({ line: r.line, said: r.name || r.email || r.id, why: k && byName.get(k) === null ? "two people have this name" : "not found" }); continue; }
    if (matched.some(m => m.donorId === p.id)) { unmatched.push({ line: r.line, said: r.name || r.email, why: "already on an earlier line" }); continue; }
    matched.push({ line: r.line, rank: r.rank, donorId: p.id, name: p.name });
  }
  matched.sort((a, b) => a.rank - b.rank || a.line - b.line);
  const sentence = `${matched.length} ${matched.length === 1 ? "line matches a person" : "lines match people"}${unmatched.length ? `; ${unmatched.length} did not` : ""}.`;
  if (!(req.body && req.body.apply)) return res.json({ matched, unmatched, sentence, applied: false });
  const list = await listOf(orgId, req);
  const a = actor(req);
  const count = await withTransaction(async client => {
    const order = await lockedOrder(client, orgId, list.id);
    const on = new Set(order);
    for (const m of matched) if (!on.has(m.donorId))
      await runTx(client, `INSERT INTO portfolio_members (id, org_id, list_id, donor_id, rank, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)`,
        [newId("pfm"), orgId, list.id, m.donorId, order.length + 1 + matched.indexOf(m), a.id, a.name]);
    const placed = new Set(matched.map(m => m.donorId));
    const rest = order.filter(id => !placed.has(id));
    // Each sheet person at their rank, in rank order; the rest keep their order around them.
    const next = [...rest];
    for (const m of matched) next.splice(Math.min(m.rank, next.length + 1) - 1, 0, m.donorId);
    await writeOrder(client, orgId, list.id, next);
    return next.length;
  });
  res.json({ matched, unmatched, sentence: `${sentence} The list now has ${count}.`, applied: true, count });
}));

// ── The plan of care ────────────────────────────────────────────────────────
async function planOf(orgId, donorId) {
  const [p] = await query("SELECT id, goal, ask_cents, ask_by, template_name, updated_at FROM care_plans WHERE org_id=? AND donor_id=?", [orgId, donorId]);
  return p || null;
}
async function ensurePlan(orgId, donorId, req) {
  const had = await planOf(orgId, donorId);
  if (had) return had;
  const a = actor(req);
  await run(`INSERT INTO care_plans (id, org_id, donor_id, created_by, created_by_name) VALUES (?,?,?,?,?) ON CONFLICT (org_id, donor_id) DO NOTHING`,
    [newId("cpl"), orgId, donorId, a.id, a.name]);
  return planOf(orgId, donorId);
}
async function planPayload(orgId, d) {
  const S = await shapeMod();
  const today = await todayOf(orgId);
  const plan = await planOf(orgId, d.id);
  const list = await listOf(orgId, null);
  const [m] = list ? await query("SELECT rank FROM portfolio_members WHERE org_id=? AND list_id=? AND donor_id=?", [orgId, list.id, d.id]) : [];
  const touches = plan ? (await query(
    `SELECT id, touch_type, title, due, done, completed_at, completed_by_name, assigned_to, assigned_to_name FROM tasks
      WHERE org_id=? AND care_plan_id=? AND voided_at IS NULL ORDER BY due ASC NULLS LAST, id`, [orgId, plan.id])).map(t => {
    const due = String(t.due || "").slice(0, 10);
    return { taskId: t.id, type: t.touch_type, label: S.touchLabel(t.touch_type), due, done: t.done === 1,
      status: t.done === 1 ? "done" : (S.isDay(due) && due < today ? "overdue" : "planned"),
      owner: t.assigned_to ? { id: t.assigned_to, name: t.assigned_to_name } : null, completedBy: t.completed_by_name || null };
  }) : [];
  const h = S.planHealth(touches, today);
  return {
    donorId: d.id, name: d.name, today, list: list ? { id: list.id, name: list.name } : { id: null, name: "Top 100" },
    rank: m ? m.rank : null, onList: !!m,
    plan: plan ? { id: plan.id, goal: plan.goal || "", askCents: plan.ask_cents == null ? null : Number(plan.ask_cents), askBy: plan.ask_by || null, templateName: plan.template_name || null } : null,
    owner: d.assigned_to ? { id: d.assigned_to, name: d.assigned_to_name } : null, stage: d.stage || null,
    touches, health: { key: h.key, label: h.label, sentence: h.sentence },
    touchTypes: S.TOUCH_TYPES, templates: await templatesOf(orgId), owners: await owners(orgId),
  };
}

app.get("/donors/:id/care-plan", requireAuth, mg, wrap(async (req, res) => {
  const d = await donorOf(req.user.orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  res.json(await planPayload(req.user.orgId, d));
}));

app.put("/donors/:id/care-plan", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const S = await shapeMod();
  const d = await donorOf(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const b = req.body || {};
  const goal = b.goal == null ? null : String(b.goal).trim().slice(0, 500) || null;
  let askCents = null;
  if (b.askCents != null && b.askCents !== "") {
    askCents = Number(b.askCents);
    if (!Number.isInteger(askCents) || askCents < 0) return res.status(400).json({ error: "bad_ask", sentence: "The ask is an amount in dollars." });
  }
  const askBy = b.askBy ? String(b.askBy) : null;
  if (askBy && !S.isDay(askBy)) return res.status(400).json({ error: "bad_date", sentence: "The ask-by date must be a day." });
  const plan = await ensurePlan(orgId, d.id, req);
  await run("UPDATE care_plans SET goal=?, ask_cents=?, ask_by=?, updated_at=NOW() WHERE id=? AND org_id=?", [goal, askCents, askBy, plan.id, orgId]);
  res.json(await planPayload(orgId, d));
}));

// A touch is a task: it shows in Tasks and on Home and finishes from anywhere.
async function addTouch(orgId, d, plan, { type, due, ownerId }, a) {
  const S = await shapeMod();
  const id = newId("t");
  const ownerOk = ownerId ? (await OU.orgUser(orgId, ownerId)).ok : false;
  const [u] = ownerOk ? await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [ownerId, orgId])
    : d.assigned_to ? await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [d.assigned_to, orgId])
    : await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [a.id, orgId]);
  await run(
    `INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, assigned_to, assigned_to_name, updated_at,
                        created_by, created_by_name, kind, care_plan_id, touch_type)
     VALUES (?,?,?,?,'medium','donor',0,?,?,?,NOW(),?,?,?,?,?)`,
    [id, orgId, S.touchLabel(type), due, d.id, u ? u.id : null, u ? u.name : null, a.id, a.name, S.touchKind(type), plan.id, type]);
  return id;
}

app.post("/donors/:id/care-plan/touches", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const S = await shapeMod();
  const d = await donorOf(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const b = req.body || {};
  if (!S.isTouchType(b.type)) return res.status(400).json({ error: "bad_type", sentence: "Pick what kind of touch it is." });
  if (!S.isDay(b.due)) return res.status(400).json({ error: "bad_date", sentence: "A touch needs a day." });
  if (b.ownerId && !(await OU.orgUser(orgId, b.ownerId)).ok) return OU.refuse(res, "ownerId");
  const plan = await ensurePlan(orgId, d.id, req);
  const taskId = await addTouch(orgId, d, plan, { type: b.type, due: b.due, ownerId: b.ownerId || null }, actor(req));
  res.status(201).json({ taskId, ...(await planPayload(orgId, d)) });
}));

app.post("/donors/:id/care-plan/template", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const S = await shapeMod();
  const d = await donorOf(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const b = req.body || {};
  const tpl = (await templatesOf(orgId)).find(t => t.id === String(b.templateId || ""));
  if (!tpl) return res.status(404).json({ error: "template_not_found", sentence: "That template is not one of yours." });
  const start = b.start ? String(b.start) : await todayOf(orgId);
  if (!S.isDay(start)) return res.status(400).json({ error: "bad_date", sentence: "The start must be a day." });
  if (b.ownerId && !(await OU.orgUser(orgId, b.ownerId)).ok) return OU.refuse(res, "ownerId");
  const plan = await ensurePlan(orgId, d.id, req);
  const a = actor(req);
  const made = [];
  for (const t of S.touchesFromTemplate(tpl, start)) made.push(await addTouch(orgId, d, plan, { type: t.type, due: t.due, ownerId: b.ownerId || null }, a));
  await run("UPDATE care_plans SET template_name=?, updated_at=NOW() WHERE id=? AND org_id=?", [tpl.name, plan.id, orgId]);
  res.status(201).json({ added: made.length, taskIds: made, ...(await planPayload(orgId, d)) });
}));

app.get("/care-templates", requireAuth, mg, wrap(async (req, res) => {
  const S = await shapeMod();
  res.json({ templates: await templatesOf(req.user.orgId), touchTypes: S.TOUCH_TYPES });
}));

app.post("/care-templates", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const S = await shapeMod();
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "name_required", sentence: "Name the template." });
  let touches = null;
  if (b.fromDonorId) {
    const d = await donorOf(orgId, b.fromDonorId);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    const plan = await planOf(orgId, d.id);
    const rows = plan ? await query("SELECT touch_type AS type, due FROM tasks WHERE org_id=? AND care_plan_id=? AND voided_at IS NULL", [orgId, plan.id]) : [];
    touches = S.templateFromTouches(rows.map(r => ({ type: r.type, due: String(r.due || "").slice(0, 10) })));
  } else touches = S.cleanTemplateTouches(b.touches);
  if (!touches || !touches.length) return res.status(400).json({ error: "no_touches", sentence: "A template needs at least one dated touch." });
  const a = actor(req);
  const id = newId("ctp");
  await run("INSERT INTO care_templates (id, org_id, name, touches, created_by, created_by_name) VALUES (?,?,?,?::jsonb,?,?)",
    [id, orgId, name, JSON.stringify(touches), a.id, a.name]);
  res.status(201).json({ template: { id, name, builtIn: false, touches } });
}));

// TOUCH-1: one field at a time, for the Top 100's cells and the plan of care.
require("./top100Edit").register(app, { query, run, wrap, requireAuth, checkWriteAccess, mg, donorOf, ensurePlan, planPayload, shapeMod });
rowsFor = async (orgId) => { const l = await listOf(orgId, null); return l ? listRows(orgId, l.id, await todayOf(orgId)) : []; };
return {};
}

// The list's rows for another module (Atlas), once mount has run.
let rowsFor = null;
const top100Rows = orgId => (rowsFor ? rowsFor(orgId) : Promise.resolve([]));

module.exports = { routers, mount, top100Rows };
