// routes/groups.js · PARITY-1 Part D. GROUPS: SAVED LISTS THAT WORK EVERYWHERE.
//
//   GET    /groups                      every group, with its member count
//   POST   /groups                      make one: static (by hand) or dynamic (by rule)
//   PATCH  /groups/:id                  rename, describe, change the rule
//   DELETE /groups/:id                  remove it (the people stay; only the list goes)
//   GET    /groups/:id                  the group's page: its figures, its months, its people
//   POST   /groups/:id/members          add people by hand (static groups only)
//   POST   /groups/:id/members/remove   take people out by hand (static groups only)
//   GET    /donors/:id/groups           the groups this person is in, and the ones they could join
//
// A group is an audiences row with a kind (groups.js), so a campaign, the
// email-tool tags, a journey and a survey can all name it. Membership of a
// group by rule is never stored: it is the donor list's own filter, run now.
// Every number on the page is a figure with a source (figureSources.js
// group-members and group-gifts), so each one opens rows that foot to it.
const express = require("express");
const GR = require("../groups");
const DS = require("../donorStatus");

const routers = { r0: express.Router() };
const NAME_MAX = 60, DESC_MAX = 200;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function mount(ctx) {
const { actor, checkWriteAccess, maybeStartJourneyFromServer, orgTime, orgTz, query, requireAuth, run, uuid, wrap } = ctx;
const app = routers.r0;

function validate(b, { partial = false, kind = null } = {}) {
  const errors = [];
  const out = {};
  if (!partial || b.name !== undefined) {
    out.name = String(b.name || "").trim();
    if (!out.name) errors.push("A group needs a name. It is how you will find it again.");
    else if (out.name.length > NAME_MAX) errors.push(`Keep the name under ${NAME_MAX} characters.`);
  }
  if (!partial || b.description !== undefined) {
    out.description = String(b.description || "").trim();
    if (out.description.length > DESC_MAX) errors.push(`Keep the description under ${DESC_MAX} characters.`);
  }
  const k = kind || String(b.kind || "");
  if (!GR.KINDS.includes(k)) errors.push("A group is kept by hand (static) or by a rule (dynamic).");
  out.kind = k;
  if (k === "dynamic" && (!partial || b.rules !== undefined)) {
    const r = GR.normalizeRules(b.rules);
    errors.push(...r.errors);
    out.rules = r.rules;
  }
  return { ok: errors.length === 0, errors, value: out };
}

async function orgOf(orgId) {
  const [o] = await query("SELECT timezone, vocabulary_json FROM orgs WHERE id=?", [orgId]);
  return o || {};
}

// GET /groups — the list. Counts are the live members, one read per group.
app.get("/groups", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const groups = await GR.listGroups(orgId);
  const out = [];
  for (const g of groups) {
    out.push({ ...g, count: (await GR.memberIds(orgId, g)).length,
      countSource: { key: "group-members", params: { group: g.id } } });
  }
  res.json({
    groups: out,
    ruleKeys: GR.RULE_KEYS,
    countSentence: "Everyone in the group right now. For a group by rule, that is everyone the rule finds today.",
  });
}));

app.post("/groups", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const v = validate(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  const id = "grp_" + uuid().slice(0, 10);
  const a = actor(req);
  try {
    await run(`INSERT INTO audiences (id, org_id, name, description, segment, kind, rules, created_by, created_by_name)
               VALUES (?,?,?,?,?::jsonb,?,?::jsonb,?,?)`,
      [id, req.user.orgId, v.value.name, v.value.description || null, JSON.stringify({ mode: "group" }),
       v.value.kind, v.value.kind === "dynamic" ? JSON.stringify(v.value.rules) : null, a.id, a.name]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already have a group or an audience called that." });
    throw err;
  }
  res.status(201).json(await GR.groupById(req.user.orgId, id));
}));

app.patch("/groups/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const g = await GR.groupById(req.user.orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Not found" });
  const v = validate(req.body || {}, { partial: true, kind: g.kind });
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  const name = v.value.name !== undefined ? v.value.name : g.name;
  const description = v.value.description !== undefined ? v.value.description : g.description;
  const rules = g.kind === "dynamic" ? (v.value.rules !== undefined ? v.value.rules : g.rules) : null;
  try {
    await run(`UPDATE audiences SET name=?, description=?, rules=?::jsonb, updated_at=NOW() WHERE id=? AND org_id=?`,
      [name, description || null, rules ? JSON.stringify(rules) : null, g.id, req.user.orgId]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already have a group or an audience called that." });
    throw err;
  }
  res.json(await GR.groupById(req.user.orgId, g.id));
}));

app.delete("/groups/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const g = await GR.groupById(req.user.orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Not found" });
  // The people are not touched. A draft campaign that named this group now
  // resolves to nobody (resolveSegmentSpec), never to everybody.
  await run("DELETE FROM audiences WHERE id=? AND org_id=?", [g.id, req.user.orgId]);
  res.json({ deleted: true });
}));

// GET /groups/:id — the page. A GET, and it writes nothing.
app.get("/groups/:id", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await GR.groupById(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Not found" });
  const org = await orgOf(orgId);
  const today = orgTime.orgToday(org);   // ORG_TZ_SEAM_OK
  const fy = orgTime.orgPeriodBounds(org, "fiscal_year", 0);
  const FS = require("../figureSources");
  const fig = async (source, label) => ({ label, source, ...(await FS.figureValue(orgId, source)),
    sentence: (await FS.figure(orgId, source, {}, { rows: false })).sentence });
  const gp = { group: g.id };
  const figures = [
    await fig({ key: "group-members", params: gp }, "People"),
    await fig({ key: "group-gifts", params: { ...gp, kind: "average" } }, "Average gift"),
    await fig({ key: "group-gifts", params: { ...gp, kind: "total", from: fy.start, to: fy.end } }, "This fiscal year"),
    await fig({ key: "group-gifts", params: { ...gp, kind: "total" } }, "Lifetime"),
    await fig({ key: "group-gifts", params: { ...gp, kind: "count" } }, "Gifts"),
  ];
  figures[0].kind = "count"; figures[1].kind = "money"; figures[2].kind = "money"; figures[3].kind = "money"; figures[4].kind = "count";

  // The last twelve months, one figure per month, each opening its gifts.
  const t = orgTime.parseCivil(today);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    let y = t.y, m = t.m - i;
    while (m <= 0) { m += 12; y -= 1; }
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    const source = { key: "group-gifts", params: { ...gp, kind: "total", from, to } };
    const v = await FS.figureValue(orgId, source);
    months.push({ month: from.slice(0, 7), label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, value: v.value, source });
  }

  // The people, with their giving level so the page can show Mid and Major.
  const m = await GR.memberSql(orgId, g);
  const cuts = await DS.cutsFor(orgId);
  const st = DS.statusSql(orgId, today, cuts);
  const people = await query(
    `SELECT d.id, d.name, d.email, d.total_giving, d.last_gift_date, s.level, s.last12
       FROM donors d LEFT JOIN (${st.sql}) s ON s.donor_id = d.id
      WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.id IN (${m.sql})
      ORDER BY lower(d.name), d.id LIMIT 1000`,
    [...st.args, orgId, ...m.args]);
  res.json({
    group: g, figures, months,
    monthsSentence: "What the people in this group gave each month, refunds taken off. Each month opens its gifts.",
    members: people.map(p => ({ id: p.id, name: p.name, email: p.email || "", totalGiving: Number(p.total_giving) || 0,
      lastGiftDate: p.last_gift_date || null, level: p.level || null, last12: p.last12 == null ? 0 : Number(p.last12) })),
    levelSentence: DS.levelSentence(cuts),
  });
}));

// The people a request names, kept to this org's own. Anybody else is not
// found, never confirmed.
async function ownDonorIds(orgId, raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String).filter(Boolean))].slice(0, 2000);
  if (!ids.length) return { ids: [], missing: 0 };
  const rows = await query(`SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND id = ANY(?::text[])`, [orgId, ids]);
  return { ids: rows.map(r => r.id), missing: ids.length - rows.length };
}

app.post("/groups/:id/members", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await GR.groupById(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Not found" });
  if (g.kind !== "static") return res.status(409).json({ error: "not_static",
    sentence: "This group is worked out by its rule, so people cannot be added by hand. Change the rule instead." });
  const { ids, missing } = await ownDonorIds(orgId, (req.body || {}).donorIds);
  if (missing) return res.status(404).json({ error: "Donor not found" });
  const a = actor(req);
  const org = await orgTz(orgId);
  const today = orgTime.orgToday(org);   // ORG_TZ_SEAM_OK
  let added = 0;
  for (const id of ids) {
    const ins = await query(
      `INSERT INTO group_members (org_id, group_id, donor_id, added_by, added_by_name) VALUES (?,?,?,?,?)
       ON CONFLICT (group_id, donor_id) DO NOTHING RETURNING donor_id`, [orgId, g.id, id, a.id, a.name]);
    if (ins.length) {
      added++;
      // Joining a group can start a journey. Only a real join fires it.
      await maybeStartJourneyFromServer(orgId, id, "joined_group", { groupId: g.id, today });
    }
  }
  res.json({ added, already: ids.length - added,
    sentence: `${added} ${added === 1 ? "person" : "people"} added to ${g.name}.` });
}));

app.post("/groups/:id/members/remove", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await GR.groupById(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Not found" });
  if (g.kind !== "static") return res.status(409).json({ error: "not_static",
    sentence: "This group is worked out by its rule, so people cannot be taken out by hand. Change the rule instead." });
  const { ids } = await ownDonorIds(orgId, (req.body || {}).donorIds);
  let removed = 0;
  for (const id of ids) {
    const r = await run(`DELETE FROM group_members WHERE org_id=? AND group_id=? AND donor_id=?`, [orgId, g.id, id]);
    removed += r.changes || 0;
  }
  res.json({ removed, sentence: `${removed} ${removed === 1 ? "person" : "people"} taken out of ${g.name}.` });
}));

// GET /donors/:id/groups — for the small Groups control on the profile.
app.get("/donors/:id/groups", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const all = await GR.listGroups(orgId);
  const inIds = new Set();
  for (const g of all) if (await GR.isMember(orgId, g, d.id)) inIds.add(g.id);
  res.json({
    groups: all.filter(g => inIds.has(g.id)),
    canJoin: all.filter(g => g.kind === "static" && !inIds.has(g.id)).map(g => ({ id: g.id, name: g.name })),
  });
}));
}

module.exports = { routers, mount };
