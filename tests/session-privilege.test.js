// BUILD-37 §A5/§C4/§B10 — privilege is revalidated against the DB, never trusted
// from the (stateless, 7-day) JWT.
//
// Pre-fix behavior (proven exploitable, audit/a5-stale-jwt-evidence.txt): a user
// demoted from admin, or an org's super-admin revoked, kept the elevated power
// baked into their token for up to a week — requireAdmin/requireSuperAdmin read
// `role`/`isSuperAdmin` straight from the JWT. The fix re-reads the live users
// row in both guards. Every assertion below marked "(fails pre-fix)" returned
// the elevated 200 before the fix.
//
// Runs against the LOCAL scratch server + Postgres only (tests/README.md).
const { BASE, ok, summary, api, q, closeDb } = require("./helpers.js");

async function registerOrg(label) {
  const email = `sesspriv_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
  const r = await fetch(BASE + "/auth/register-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `SessPriv ${label}`, userName: "Prober", email, password: "probe1234" }),
  });
  const j = await r.json();
  if (!j.token) throw new Error("register failed: " + JSON.stringify(j));
  return { token: j.token, userId: j.user.id, orgId: j.org.id, email };
}
async function cleanup(orgId) {
  await q("DELETE FROM invites WHERE org_id=$1", [orgId]).catch(() => {});
  await q("DELETE FROM workflows WHERE org_id=$1", [orgId]).catch(() => {});
  await q("DELETE FROM users WHERE org_id=$1", [orgId]).catch(() => {});
  await q("DELETE FROM orgs WHERE id=$1", [orgId]).catch(() => {});
}

(async () => {
  // ── requireAdmin: role revocation takes effect on the next request ──────────
  {
    const a = await registerOrg("admin");
    const invite = (n) => api("POST", "/auth/invite", a.token, { email: `inv_${n}_${Date.now()}@ex.com`, role: "staff" });

    const before = await invite("before");
    ok("fresh admin token can hit a requireAdmin route", before.status === 200, before.status);

    // Demote the user in the DB — simulates an owner revoking admin.
    await q("UPDATE users SET role='staff' WHERE id=$1", [a.userId]);
    const after = await invite("after");
    ok("(fails pre-fix) demoted admin's SAME token is now rejected", after.status === 403, after);

    // Removing the account entirely also revokes admin power immediately.
    await q("UPDATE users SET role='admin' WHERE id=$1", [a.userId]); // restore then delete for a clean 'removed' signal
    await q("DELETE FROM users WHERE id=$1", [a.userId]);
    const removed = await invite("removed");
    ok("removed user's token cannot hit a requireAdmin route", removed.status === 401 || removed.status === 403, removed.status);

    await cleanup(a.orgId);
  }

  // ── requireSuperAdmin: super-admin revocation takes effect on next request ──
  {
    const s = await registerOrg("super");
    // Grant super-admin in the DB, then LOG IN so the flag lands in the JWT
    // (login is the only path that reads is_super_admin into the token).
    await q("UPDATE users SET is_super_admin=true WHERE id=$1", [s.userId]);
    const loginRes = await fetch(BASE + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: s.email, password: "probe1234" }),
    });
    const lj = await loginRes.json();
    ok("super-admin JWT issued at login", !!lj.token && lj.user.isSuperAdmin === true, lj.user?.isSuperAdmin);
    const saToken = lj.token;

    const before = await api("GET", "/admin/orgs", saToken);
    ok("super-admin token can hit an /admin route", before.status === 200, before.status);

    // Revoke super-admin in the DB — token still SAYS isSuperAdmin:true.
    await q("UPDATE users SET is_super_admin=false WHERE id=$1", [s.userId]);
    const after = await api("GET", "/admin/orgs", saToken);
    ok("(fails pre-fix) revoked super-admin's SAME token is now 403", after.status === 403, after.status);

    await cleanup(s.orgId);
  }

  // A valid, unchanged admin keeps working (no false-positive lockout).
  {
    const a = await registerOrg("valid");
    const r = await api("POST", "/auth/invite", a.token, { email: `ok_${Date.now()}@ex.com`, role: "staff" });
    ok("an unchanged admin is NOT locked out by the revalidation", r.status === 200, r.status);
    await cleanup(a.orgId);
  }

  await closeDb();
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
