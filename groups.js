// groups.js · PARITY-1 Part D. A GROUP IS A LIST WITH A NAME.
//
// Two kinds, one store (the audiences table, BUILD-97):
//   dynamic  a rule: the donor list filters (GET /donors query params), AND-ed,
//            evaluated live through buildDonorFilter below. Nothing about who
//            is in it is stored, so a gift that moves somebody across a rule
//            moves them in or out of the group the moment it is recorded.
//   static   people added and removed by hand, rows in group_members.
//
// buildDonorFilter is the donor list's own filter, moved here from
// routes/crm.js so it can be called with a plain params object: the list, the
// export and every dynamic Group run the same code. A list and a group built
// on the same rule cannot disagree.
const { query } = require("./db");
const DS = require("./donorStatus");

let _pt = null;
async function personTypeMod() { return _pt || (_pt = await import("./shared/personType.js")); }

const PEOPLE_ROLES = ["donor", "volunteer", "staff_board"];

const DONOR_SORTS = {
  total_giving:   "total_giving DESC",
  name:           "lower(name) ASC",
  last_gift_date: "last_gift_date DESC NULLS LAST",
  created_at:     "created_at DESC",
  // ENGAGE-1 — closest first, by the stored score (donor_scores).
  engagement:     "engagement_score DESC NULLS LAST, lower(name) ASC",
  generosity:     "generosity_score DESC NULLS LAST, lower(name) ASC",
};
// ENGAGE-1 — the two scores ride along on every list row, read from the one
// stored compute, so the column and the sort are the same numbers the profile shows.
const DONOR_SCORE_COLS = `,
  (SELECT s.engagement FROM donor_scores s WHERE s.org_id = donors.org_id AND s.donor_id = donors.id) AS engagement_score,
  (SELECT s.generosity FROM donor_scores s WHERE s.org_id = donors.org_id AND s.donor_id = donors.id) AS generosity_score,
  (SELECT s.band FROM donor_scores s WHERE s.org_id = donors.org_id AND s.donor_id = donors.id) AS engagement_band`;

async function buildDonorFilter(orgId, q = {}) {
  const PT = await personTypeMod();
  const where = ["org_id = ?", "deleted_at IS NULL"];
  const params = [orgId];
  const today = await DS.todayFor(orgId);
  const cl = DS.closenessSql(today);
  const { search, stage, status, assignedTo, designation, household, role } = q;
  // FIX-1 D — DONORS SHOWS DONORS. The Directory asks for role=donor; search
  // and every older caller leave it off and still see everyone. An unknown
  // role is refused (400 at the route) rather than quietly ignored, because an
  // ignored filter is a list that says "donors" and holds everybody.
  if (role !== undefined && role !== "") {
    if (!PEOPLE_ROLES.includes(String(role))) return { badRole: true };
    where.push(PT.typeSql(String(role)));
  }
  if (search && String(search).trim()) {
    const s = "%" + String(search).trim().toLowerCase() + "%";
    where.push("(lower(name) LIKE ? OR lower(email) LIKE ?)");
    params.push(s, s);
  }
  if (stage)      { where.push("stage = ?");       params.push(String(stage)); }
  if (status)     { where.push("status = ?");      params.push(String(status)); }
  if (assignedTo) { where.push("assigned_to = ?"); params.push(String(assignedTo)); }
  // Designation filter (BUILD-14) — planned-giving / estate segments are
  // first-class and filterable everywhere the donor list is. EXISTS keeps it
  // a single query; donors.id is safe (both callers use unaliased FROM donors).
  if (designation) {
    where.push("EXISTS (SELECT 1 FROM donor_designations dd WHERE dd.donor_id = donors.id AND dd.kind = ?)");
    params.push(String(designation));
  }
  // Household filter: `household=<id>` scopes to one household's members;
  // `household=any` / `household=none` filter by membership presence.
  if (household === "none")      { where.push("household_id IS NULL"); }
  else if (household === "any")  { where.push("household_id IS NOT NULL"); }
  else if (household)            { where.push("household_id = ?"); params.push(String(household)); }
  const statusTags = [q.level, q.lifecycle, q.retained === "1" ? "retained" : null].filter(Boolean).map(String);
  if (statusTags.length) {
    const cuts = await DS.cutsFor(orgId);
    for (const t of statusTags) {
      const c = DS.tagCondition(t, orgId, today, cuts);
      if (!c) return { badStatus: true };
      where.push(c.sql); params.push(...c.args);
    }
  }
  if (q.closeness) {
    const c = DS.closenessCondition(String(q.closeness), today);
    if (!c) return { badStatus: true };
    where.push(c.sql); params.push(...c.args);
  }
  if (q.given === "never") where.push("NOT EXISTS (SELECT 1 FROM gifts gv WHERE gv.org_id = donors.org_id AND gv.donor_id = donors.id AND gv.amount > 0)");
  else if (q.given === "ever") where.push("EXISTS (SELECT 1 FROM gifts gv WHERE gv.org_id = donors.org_id AND gv.donor_id = donors.id AND gv.amount > 0)");
  // ", id" tiebreak keeps page boundaries stable when many donors share a value
  const orderBy = (DONOR_SORTS[q.sort] || DONOR_SORTS.total_giving) + ", id";
  // The closeness word rides on every row as a column (selectCols), its
  // arguments ahead of the WHERE's.
  return { whereSql: where.join(" AND "), params, orderBy, selectCols: `${DONOR_SCORE_COLS}, ${cl.sql} AS closeness`, selectArgs: cl.args };
}

// ── THE RULE ───────────────────────────────────────────────────────────────
// The keys a dynamic group's rule may hold: exactly the list's own filters.
const RULE_KEYS = ["role", "stage", "status", "assignedTo", "designation", "household", "search",
  "level", "lifecycle", "retained", "closeness", "given"];
const KINDS = ["static", "dynamic"];
const ROLE_WORDS = { donor: "donors", volunteer: "volunteers", staff_board: "staff and board" };

// Keep what is recognised and refuse what is wrong; never guess. A rule that
// names a filter nobody understands must not quietly widen the group.
function normalizeRules(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const rules = {}, errors = [];
  for (const k of RULE_KEYS) {
    const v = src[k];
    if (v === undefined || v === null || v === "" || v === false) continue;
    rules[k] = String(v).trim().slice(0, 120);
  }
  if (rules.role && !PEOPLE_ROLES.includes(rules.role)) errors.push("A role is Donor, Volunteer, or Staff and board.");
  if (rules.level && !DS.LEVELS[rules.level]) errors.push("A giving level is General, Mid or Major.");
  if (rules.lifecycle && !DS.LIFECYCLES[rules.lifecycle]) errors.push("A lifecycle is New, Current, Recaptured or Lapsed.");
  if (rules.closeness && !DS.CLOSENESS[rules.closeness]) errors.push("Closeness is Close, Warm, Cooling or New.");
  if (rules.retained !== undefined) {
    if (rules.retained === "true") rules.retained = "1";
    if (rules.retained !== "1") delete rules.retained;
  }
  if (rules.given && !["never", "ever"].includes(rules.given)) errors.push("Given is never or ever.");
  if (!Object.keys(rules).length) errors.push("A group by rule needs at least one rule, or it is everybody.");
  return { ok: errors.length === 0, rules, errors };
}

// The rule in words, for the group's page and the pickers.
function rulesSentence(rules = {}) {
  const parts = [];
  if (rules.role) parts.push(ROLE_WORDS[rules.role] || rules.role);
  if (rules.level) parts.push(`at giving level ${DS.tagLabel(rules.level)}`);
  if (rules.lifecycle) parts.push(`tagged ${DS.tagLabel(rules.lifecycle)}`);
  if (rules.retained) parts.push("tagged Retained");
  if (rules.closeness) parts.push(`whose closeness is ${DS.CLOSENESS[rules.closeness] ? DS.CLOSENESS[rules.closeness].label : rules.closeness}`);
  if (rules.given === "never") parts.push("who have never given");
  if (rules.given === "ever") parts.push("who have given");
  if (rules.stage) parts.push(`in stage ${rules.stage}`);
  if (rules.status) parts.push(`with status ${rules.status}`);
  if (rules.designation) parts.push(`with a ${rules.designation} designation`);
  if (rules.assignedTo) parts.push("assigned to one person");
  if (rules.household) parts.push(rules.household === "none" ? "not in a household" : "in a household");
  if (rules.search) parts.push(`matching "${rules.search}"`);
  return parts.length ? `Everyone on file: ${parts.join(", ")}. Worked out fresh every time it is read.` : "";
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}
function shapeGroup(r) {
  if (!r) return null;
  const rules = r.kind === "dynamic" ? parseJson(r.rules, {}) : null;
  return {
    id: r.id, name: r.name, description: r.description || "", kind: r.kind, rules,
    sentence: r.kind === "dynamic" ? rulesSentence(rules) : "People added to this group by hand. They stay until someone takes them out.",
    createdByName: r.created_by_name || "", createdAt: r.created_at,
  };
}

// One group of this org, or null. A saved audience with no kind is not a group.
async function groupById(orgId, id) {
  const [r] = await query("SELECT * FROM audiences WHERE id=? AND org_id=? AND kind IS NOT NULL", [String(id || ""), orgId]);
  return shapeGroup(r);
}
async function listGroups(orgId) {
  const rows = await query("SELECT * FROM audiences WHERE org_id=? AND kind IS NOT NULL ORDER BY LOWER(name)", [orgId]);
  return rows.map(shapeGroup);
}

// The SQL "the ids of this group's members", for an IN (...) anywhere: the
// group page, a figure source, a campaign, a journey's audience. A rule the
// filter refuses selects nobody, never everybody.
const NOBODY = { sql: "SELECT NULL::text AS id WHERE false", args: [] };
async function memberSql(orgId, group) {
  if (!group) return NOBODY;
  if (group.kind === "static") {
    return {
      sql: `SELECT gm.donor_id AS id FROM group_members gm
              JOIN donors gd ON gd.id = gm.donor_id AND gd.org_id = gm.org_id
             WHERE gm.org_id = ? AND gm.group_id = ? AND gd.deleted_at IS NULL`,
      args: [orgId, group.id],
    };
  }
  if (group.kind !== "dynamic") return NOBODY;
  const f = await buildDonorFilter(orgId, group.rules || {});
  if (f.badRole || f.badStatus) return NOBODY;
  return { sql: `SELECT donors.id FROM donors WHERE ${f.whereSql}`, args: f.params };
}
async function memberIds(orgId, group) {
  const m = await memberSql(orgId, group);
  return (await query(m.sql, m.args)).map(r => r.id);
}
async function isMember(orgId, group, donorId) {
  const m = await memberSql(orgId, group);
  const rows = await query(`SELECT 1 FROM (${m.sql}) gx WHERE gx.id = ? LIMIT 1`, [...m.args, donorId]);
  return rows.length > 0;
}
// Every group this person is in right now, static and by rule.
async function groupsFor(orgId, donorId) {
  const out = [];
  for (const g of await listGroups(orgId)) if (await isMember(orgId, g, donorId)) out.push(g);
  return out;
}

// ── "JOINS A GROUP" FOR A GROUP BY RULE ─────────────────────────────────────
// A group by rule has no add button to fire from, so joining is noticed by
// comparing today's members with the last look (group_sweep_seen). That table
// is the sweep's memory only; who is in the group is always the live rule.
// A sentinel row marks that a starting line was taken, so the first look at a
// group records who is already in it and fires on nobody.
const BASELINE = "__baseline__";
async function baselineGroup(orgId, group, today = "") {
  const ids = await memberIds(orgId, group);
  await query(`DELETE FROM group_sweep_seen WHERE org_id=? AND group_id=?`, [orgId, group.id]);
  for (const id of [BASELINE, ...ids]) {
    await query(`INSERT INTO group_sweep_seen (org_id, group_id, donor_id, seen_on) VALUES (?,?,?,?)
                 ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, group.id, id, today || ""]);
  }
  return ids.length;
}
// The groups by rule that an armed "joins a group" journey watches.
async function watchedDynamicGroups(orgId) {
  const rows = await query(
    `SELECT DISTINCT trigger_filters->>'groupId' AS gid FROM cultivation_templates
      WHERE org_id=? AND trigger_key='joined_group' AND journey_enabled=true AND archived_at IS NULL
        AND trigger_filters->>'groupId' IS NOT NULL`, [orgId]);
  const out = [];
  for (const r of rows) {
    const g = await groupById(orgId, r.gid);
    if (g && g.kind === "dynamic") out.push(g);
  }
  return out;
}
// Look again. `donorId` narrows it to one person (the gift path, the moment a
// gift lands); without it every member is compared (the morning sweep).
// `fire(donorId, groupId)` is called once for each person who is newly in.
async function dynamicJoins(orgId, { donorId = null, today = "", fire } = {}) {
  let fired = 0;
  for (const g of await watchedDynamicGroups(orgId)) {
    const [base] = await query(`SELECT 1 FROM group_sweep_seen WHERE group_id=? AND donor_id=?`, [g.id, BASELINE]);
    if (!base) { await baselineGroup(orgId, g, today); continue; }
    const seenRows = await query(`SELECT donor_id FROM group_sweep_seen WHERE group_id=?${donorId ? " AND donor_id=?" : ""}`,
      donorId ? [g.id, donorId] : [g.id]);
    const seen = new Set(seenRows.map(r => r.donor_id));
    const now = donorId ? ((await isMember(orgId, g, donorId)) ? [donorId] : []) : await memberIds(orgId, g);
    const nowSet = new Set(now);
    for (const id of now) {
      if (seen.has(id)) continue;
      await query(`INSERT INTO group_sweep_seen (org_id, group_id, donor_id, seen_on) VALUES (?,?,?,?)
                   ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, g.id, id, today || ""]);
      if (typeof fire === "function") { await fire(id, g.id); fired++; }
    }
    // Somebody who left is forgotten, so coming back in is a join again.
    for (const id of seen) {
      if (id !== BASELINE && !nowSet.has(id)) await query(`DELETE FROM group_sweep_seen WHERE group_id=? AND donor_id=?`, [g.id, id]);
    }
  }
  return fired;
}

module.exports = {
  baselineGroup, dynamicJoins, watchedDynamicGroups,
  DONOR_SORTS, DONOR_SCORE_COLS, PEOPLE_ROLES, RULE_KEYS, KINDS,
  buildDonorFilter, normalizeRules, rulesSentence, groupById, listGroups, memberSql, memberIds, isMember, groupsFor, shapeGroup,
};
