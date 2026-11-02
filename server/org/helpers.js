// server/org/helpers.js — what more than one org file reads.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {
const {
  query,
} = ctx;
const meRow = async userId => (await query(`SELECT * FROM users WHERE id=?`, [userId]))[0] || null;
const orgOf = async orgId => (await query(`SELECT id, org_kind, require_mfa, require_admin_mfa, idle_minutes, allow_staff_large_exports FROM orgs WHERE id=?`, [orgId]))[0] || null;
return { meRow, orgOf };
}

module.exports = { mount };
