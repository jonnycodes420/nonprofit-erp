// server/auth/portfolio.js · ACCESS-2. STAFF WHO SEE ONLY THE PEOPLE ASSIGNED TO THEM.
//
// One setting per person per org: "Sees: Everyone / Only people assigned to
// them" (users.sees on the home org, org_memberships.sees on a further one,
// server/db/ddl/access2.js). An admin always sees everyone.
//
// ONE PREDICATE. `visiblePeople(user, orgId)` is the only definition of who a
// portfolio user may see: the people they own (donors.assigned_to), and every
// member of a household whose primary person they own. Every list that
// carries people adds it (`visibleSql`); every route that names one person,
// or a record hanging off one, is checked here before the handler runs.
//
// ONE DOOR. requireAuth (auth.js) calls `gate(req)` for a portfolio user on
// every request, after the route has matched (req.route, req.params), so:
//   - a route this file's declarations (portfolioRoutes.js) do not open is a
//     404, including every route added after today;
//   - a path parameter naming a person, a gift, a note, a task, a pledge, a
//     household or a relationship outside the portfolio is a 404;
//   - a write whose body names such a person (donor_id, ids, household_id…)
//     is a 404.
// 404, never 403: someone outside the portfolio behaves as if they don't
// exist, so asking can't tell you they do.
"use strict";
const { query } = require("../../db");
const R = require("./portfolioRoutes");

const NOT_FOUND = { error: "not_found", message: "Not found." };
const CLOSED = { error: "not_found", scope: "portfolio", message: "This isn't part of what you see in Steward." };
const NOBODY = "portfolio_nobody_0000000000000000";
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

// ── WHO THIS USER IS IN THIS ORG ───────────────────────────────────────────
// The live row, never the token: the home org's on users, a further org's on
// its membership. { sees, canExport, canWealth }.
async function accessFor(userId, orgId) {
  if (!userId) return { sees: "everyone", canExport: true, canWealth: true };
  const [u] = await query(`SELECT org_id, sees, can_export, can_wealth FROM users WHERE id = ?`, [String(userId)]).catch(() => []);
  let row = u;
  if (u && orgId && String(u.org_id) !== String(orgId)) {
    [row] = await query(`SELECT sees, can_export, can_wealth FROM org_memberships
                          WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL`, [String(userId), String(orgId)]).catch(() => []);
  }
  return {
    sees: row && row.sees === "assigned" ? "assigned" : "everyone",
    canExport: !row || row.can_export !== false,
    canWealth: !row || row.can_wealth !== false,
  };
}

// Is this request's user limited to their portfolio? Admins never are.
function isScoped(user) {
  return !!(user && user.portfolio && user.portfolio.sees === "assigned" && user.role !== "admin");
}

// ── THE ONE PREDICATE ──────────────────────────────────────────────────────
// visiblePeople(user, orgId) → null when they see everyone, or
// { sql(alias), args } — a WHERE fragment over a donors row and its arguments.
function visiblePeople(user, orgId) {
  if (!isScoped(user)) return null;
  const uid = String(user.userId || "");
  if (!SAFE_ID.test(uid)) return { sql: () => "FALSE", args: [] };
  return {
    sql: (a = "donors") =>
      `(${a}.assigned_to = ? OR ${a}.household_id IN (SELECT hh.id FROM households hh
          JOIN donors hp ON hp.id = hh.primary_donor_id AND hp.org_id = hh.org_id
         WHERE hh.org_id = ${a}.org_id AND hp.assigned_to = ?))`,
    args: [uid, uid],
    userId: uid, orgId,
  };
}

// The fragment for one query: " AND (…)" and its args, or empty for everyone.
function visibleSql(req, alias = "donors") {
  const v = visiblePeople(req && req.user, req && req.user && req.user.orgId);
  if (!v) return { sql: "", args: [], scoped: false };
  return { sql: ` AND ${v.sql(alias)}`, args: v.args.slice(), scoped: true };
}

// Of these person ids (in this org), the ones the user may NOT see.
async function hiddenOf(user, orgId, ids) {
  const v = visiblePeople(user, orgId);
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!v || !list.length) return [];
  const rows = await query(`SELECT d.id FROM donors d WHERE d.org_id = ? AND d.id = ANY(?) AND NOT ${v.sql("d")}`,
    [orgId, list, ...v.args]);
  return rows.map(r => r.id);
}
async function mayOpen(req, donorId) {
  return !(await hiddenOf(req.user, req.user.orgId, [donorId])).length;
}

// ── RECORDS THAT HANG OFF A PERSON ─────────────────────────────────────────
// kind → the SQL that names the person (or people) a record belongs to, in
// this org. A record that isn't found in the org passes the gate: the route
// answers its own 404, the same as for anyone.
const RECORD_PEOPLE = {
  donor:        `SELECT id AS p FROM donors WHERE id = ? AND org_id = ?`,
  gift:         `SELECT donor_id AS p FROM gifts WHERE id = ? AND org_id = ?`,
  interaction:  `SELECT donor_id AS p FROM interactions WHERE id = ? AND org_id = ?`,
  pledge:       `SELECT donor_id AS p FROM pledges WHERE id = ? AND org_id = ?`,
  task:         `SELECT donor_id AS p FROM tasks WHERE id = ? AND org_id = ?`,
  thread:       `SELECT donor_id AS p FROM threads WHERE id = ? AND org_id = ?`,
  household:    `SELECT id AS p FROM donors WHERE household_id = ? AND org_id = ?
                 UNION ALL SELECT primary_donor_id AS p FROM households WHERE id = ? AND org_id = ?`,
  relationship: `SELECT donor_id_a AS p FROM donor_relationships WHERE id = ? AND org_id = ?
                 UNION ALL SELECT donor_id_b AS p FROM donor_relationships WHERE id = ? AND org_id = ?`,
};
async function peopleOf(kind, id, orgId) {
  const sql = RECORD_PEOPLE[kind];
  if (!sql) return null;
  const args = (sql.match(/\?/g) || []).length === 4 ? [id, orgId, id, orgId] : [id, orgId];
  const rows = await query(sql, args);
  return rows.map(r => r.p).filter(Boolean);
}

// A household is the portfolio's when every one of its people is (its owner
// owns the primary person, so all its members are visible). One hidden member
// and the household is not theirs.
async function recordHidden(user, orgId, kind, id) {
  if (id === undefined || id === null || id === "") return false;
  const people = await peopleOf(kind, String(id), orgId);
  if (!people || !people.length) return false;
  return (await hiddenOf(user, orgId, people)).length > 0;
}

// ── BODY: the people a write names ─────────────────────────────────────────
// Every key that names a person, a household or a record, in any spelling,
// at any depth up to three. `ids` means what the route's declaration says.
const BODY_KEYS = {
  donorid: "donor", donorids: "donor", personid: "donor", personids: "donor", peopleids: "donor",
  primarydonorid: "donor", relateddonorid: "donor", softcreditdonorid: "donor", donorida: "donor",
  donoridb: "donor", memberids: "donor", recipientids: "donor", matcheddonorid: "donor",
  creditdonorid: "donor", targetid: "donor", keepid: "donor", mergeid: "donor", mergeids: "donor",
  primaryid: "donor", secondaryid: "donor", keptid: "donor", mergedid: "donor", attendeeids: "donor",
  householdid: "household", giftid: "gift", giftids: "gift", pledgeid: "pledge",
  interactionid: "interaction", taskid: "task", taskids: "task",
};
function bodyRefs(body, idsKind, out = [], depth = 0) {
  if (!body || typeof body !== "object" || depth > 3) return out;
  for (const [k, v] of Object.entries(body)) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, "");
    const kind = norm === "ids" ? idsKind : BODY_KEYS[norm];
    const vals = Array.isArray(v) ? v : [v];
    if (kind) for (const x of vals) if (typeof x === "string" || typeof x === "number") out.push([kind, String(x)]);
    if (v && typeof v === "object") for (const x of vals) if (x && typeof x === "object") bodyRefs(x, idsKind, out, depth + 1);
  }
  return out;
}

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ── THE GATE ───────────────────────────────────────────────────────────────
// null to go on, or { status, body } to refuse. Called by requireAuth for a
// portfolio user only, after the route matched.
async function gate(req) {
  const routePath = req.route && req.route.path;
  const decl = R.declarationFor(req.method, routePath);
  // A surface closed to them: 404, marked so the app's boot can fall back the
  // way it does for the coordinator (it names a page, never a person).
  if (!decl || decl.cls === "closed") return { status: 404, body: CLOSED, why: "closed" };
  const p = req.user.portfolio || {};
  if (!p.canExport && R.isExport(req.method, routePath)) return { status: 404, body: CLOSED, why: "export" };
  const orgId = req.user.orgId;
  // Path parameters.
  for (const [name, val] of Object.entries(req.params || {})) {
    const kind = R.paramKind(routePath, name, decl);
    if (kind === null) continue;
    if (kind === undefined) return { status: 404, body: NOT_FOUND, why: `undeclared param ${name}` };   // fail closed
    // Someone outside the portfolio is asked about as an id that can't exist,
    // so the ROUTE answers its own not-found, the very answer it gives for
    // nobody at all (and for another org's id, which the tenant matrix holds
    // to 404). Nothing in the answer can tell "hidden" from "not there".
    if (await recordHidden(req.user, orgId, kind, val)) req.params[name] = NOBODY;
  }
  // The body of a write, and a read's query string, naming a person.
  const refs = bodyRefs(req.query, decl.ids || "donor");
  if (WRITE.has(req.method)) bodyRefs(req.body, decl.ids || "donor", refs);
  for (const [kind, id] of refs) {
    if (await recordHidden(req.user, orgId, kind, id)) return { status: 404, body: NOT_FOUND, why: `body ${kind}` };
  }
  return null;
}

// The flag the app keeps (a sign-in answer's user.portfolio): does this
// person see only their own people in this org?
async function flagFor(userId, orgId) {
  if (!userId || !orgId) return false;
  const role = await require("./access").liveRoleIn(userId, orgId);
  return isScoped({ userId, orgId, role, portfolio: await accessFor(userId, orgId) });
}

// ── WHAT THE APP MAY ASK (ACCESS-2B) ───────────────────────────────────────
// Every route open to this portfolio user, as [method, pattern over a real
// path], built from the live router and the declarations, so the app's list
// and the gate are one list. The app asks nothing outside it.
const toPattern = p => "^" + String(p).split("/").map(seg =>
  seg.startsWith(":") ? "[^/]+" : seg === "*" ? ".*" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/") + "/?$";
let ROUTES = null;
function liveRoutes(app) {
  if (ROUTES) return ROUTES;
  const router = (app && app._router) || (app && app.router) || null;
  const flatten = st => st.flatMap(l =>
    !l.route && l.name === "router" && (l.slash === true || (l.regexp && l.regexp.fast_slash)) && l.handle && l.handle.stack
      ? flatten(l.handle.stack) : [l]);
  const out = [];
  for (const layer of flatten((router && router.stack) || [])) {
    if (!layer.route || typeof layer.route.path !== "string") continue;
    // A route behind no sign-in (public) never meets the gate, so it is open.
    const authed = layer.route.stack.some(l => /^requireAuth/.test((l.handle && l.handle.name) || ""));
    for (const m of Object.keys(layer.route.methods).filter(x => x !== "_all")) out.push([m.toUpperCase(), layer.route.path, authed]);
  }
  ROUTES = out;
  return out;
}
// Every route, in the router's own order, with whether it is open to them:
// [method, pattern, open]. A real path is answered by the FIRST route that
// matches it (Express's rule), so /donors/birthdays-near is that route, not
// /donors/:id; the app and isOpenPath both read the list that way.
function openRoutes(app, user) {
  const p = (user && user.portfolio) || {};
  return liveRoutes(app).map(([m, path, authed]) => [m, toPattern(path), !authed || openFor(p, m, path)]);
}
const openFor = (p, m, path) => { const d = R.declarationFor(m, path); return !!(d && d.cls !== "closed" && (p.canExport !== false || !R.isExport(m, path))); };
let PATTERNS = null;
function isOpenPath(app, user, method, realPath) {
  PATTERNS = PATTERNS || liveRoutes(app).map(([m, path, authed]) => [m, path, authed, new RegExp(toPattern(path))]);
  const bare = String(realPath || "").split("?")[0];
  const hit = PATTERNS.find(([m, , , re]) => m === method && re.test(bare));
  if (!hit) return false;
  return !hit[2] || openFor((user && user.portfolio) || {}, method, hit[1]);
}

module.exports = { flagFor, openRoutes, isOpenPath, toPattern, accessFor, isScoped, visiblePeople, visibleSql, hiddenOf, mayOpen, recordHidden, bodyRefs, gate, NOT_FOUND, RECORD_PEOPLE };
