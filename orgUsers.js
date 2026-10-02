// orgUsers.js · FIX-19. A user id that came from the request belongs to the org.
//
// Any route that takes a user id from the body or the query (ownerId,
// assignedTo, officerId, a journey step's owner, and the like) asks this module
// before it writes. An id that is not a user of the caller's org, or is a user
// who has been deactivated, is refused with a plain 400 and nothing is written.
// Before this, POST /donors/:id/threads stored whatever ownerId it was handed,
// so a user from another org could be named the owner of a thread here.
//
// A read filter (GET ?assignedTo=) passes { allowInactive: true }: looking at a
// former officer's old portfolio is fine, being handed new work is not.

const { query } = require("./db");

const REFUSED = "That person is not an active user in your organisation.";

// Resolve one id. null/"" means "none given" and resolves to { ok: true, user: null }.
async function orgUser(orgId, id, { allowInactive = false } = {}) {
  if (id === undefined || id === null || id === "") return { ok: true, user: null };
  if (typeof id !== "string" && typeof id !== "number") return { ok: false };
  const [u] = await query(
    `SELECT id, name FROM users WHERE id=? AND org_id=?${allowInactive ? "" : " AND deactivated_at IS NULL"}`,
    [String(id), orgId]);
  return u ? { ok: true, user: u } : { ok: false };
}

// Resolve several at once (journey steps). ok only when every given id resolves.
async function orgUsers(orgId, ids, opts = {}) {
  const want = [...new Set((ids || []).filter(v => v !== undefined && v !== null && v !== "").map(String))];
  if (!want.length) return { ok: true, users: new Map() };
  const rows = await query(
    `SELECT id, name FROM users WHERE id = ANY(?) AND org_id=?${opts.allowInactive ? "" : " AND deactivated_at IS NULL"}`,
    [want, orgId]);
  const users = new Map(rows.map(r => [r.id, r]));
  return { ok: want.every(id => users.has(id)), users };
}

// The one refusal every route sends.
function refuse(res, field) {
  return res.status(400).json({ error: "user_not_in_org", field, message: REFUSED });
}

module.exports = { orgUser, orgUsers, refuse, REFUSED };
