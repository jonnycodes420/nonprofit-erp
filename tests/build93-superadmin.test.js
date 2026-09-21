// BUILD-93 Part 2 — A SUPER-ADMIN IS NOT AN ORG ADMIN'S TO REMOVE.
//
// On 2026-09-09 both Jonathan rows in the demo org were deactivated 2.4
// seconds apart. The product permitted it: `DELETE /users/:id` refuses to
// remove the last `role='admin'` of an org and has never looked at
// `is_super_admin`, so the seeded demo admin - whose password is written down
// in this repo - could remove the only super-admin on production, because the
// count of remaining admins was satisfied by the remover itself. Deactivation
// then locks the door behind it: requireAuth refuses a deactivated user, so
// every super-admin surface becomes unreachable by anybody, with no
// in-product way back.
//
// And nothing recorded who did it. `DELETE /users/:id` stamped deactivated_at
// on the row it changed and wrote no actor anywhere, which is why that
// investigation ended in a timestamp and a correlation instead of a name.
//
// Four rules, asserted here:
//   1. Only a super-admin may remove a super-admin at all.
//   2. Not even a super-admin may remove the LAST active one.
//   3. Every removal AND every refusal leaves an actor behind.
//   4. A deactivated account is told so at login, by name.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_sa93", OTHER = "org_sa93b";
const SUPER = "sa93super@example.org";        // the only super-admin
const SUPER2 = "sa93super2@example.org";      // a second, created mid-suite
const ORGADMIN = "sa93admin@example.org";     // an ordinary org admin
const STAFF = "sa93staff@example.org";
const VICTIM = "sa93victim@example.org";      // ordinary user, removable

async function reset() {
  for (const o of [ORG, OTHER]) {
    await q(`DELETE FROM user_admin_audit WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM accounts WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

const mkUser = async (id, org, email, role, isSuper = false) => {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, org, email, hash, email.split("@")[0], role, isSuper]);
};
const audit = (targetId) =>
  q(`SELECT action, actor_user_id, actor_email, target_user_id, target_email, target_role, detail
       FROM user_admin_audit WHERE target_user_id=$1 ORDER BY created_at ASC`, [targetId]);
const isActive = async (id) =>
  ((await q(`SELECT deactivated_at FROM users WHERE id=$1`, [id]))[0] || {}).deactivated_at === null;

(async () => {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Super Admin Org','sa93',1,'active','team')`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Other Org','sa93b',1,'active','team')`, [OTHER]);

  await mkUser("u_sa_super", ORG, SUPER, "admin", true);
  await mkUser("u_sa_admin", ORG, ORGADMIN, "admin", false);
  await mkUser("u_sa_staff", ORG, STAFF, "staff", false);
  await mkUser("u_sa_victim", ORG, VICTIM, "staff", false);

  const superTok = await login(SUPER);
  const adminTok = await login(ORGADMIN);

  // ── §1 · the shape the incident had ─────────────────────────────────────
  console.log("— §1 · an org admin cannot remove a super-admin —");
  const attempt = await api("DELETE", "/users/u_sa_super", adminTok, { });
  ok("the org admin is refused", attempt.status === 403, { status: attempt.status, body: attempt.body });
  ok("...with a code that names what is protected", attempt.body.error === "super_admin_protected", attempt.body);
  ok("...and the super-admin is still active", await isActive("u_sa_super"));

  // The count that used to satisfy the guard: another admin exists, so the
  // last-admin rule was never going to fire. That is exactly why it was not
  // enough on its own.
  const [{ c: otherAdmins }] = await q(
    `SELECT COUNT(*)::int c FROM users WHERE org_id=$1 AND role='admin' AND deactivated_at IS NULL AND id<>'u_sa_super'`, [ORG]);
  ok("...and the old last-admin guard WOULD have allowed it (another admin exists)", otherAdmins >= 1, otherAdmins);

  console.log("\n— §2 · the refusal is recorded, not just returned —");
  const refusals = await audit("u_sa_super");
  ok("the attempt left an audit row", refusals.length === 1, refusals);
  ok("...naming the actor who tried", refusals[0].actor_user_id === "u_sa_admin", refusals[0]);
  ok("...naming it as a refusal", refusals[0].action === "refused", refusals[0]);
  ok("...and saying which rule refused it",
     refusals[0].detail && refusals[0].detail.error === "super_admin_protected", refusals[0].detail);

  // ── §3 · the last-super-admin rule, and why it cannot fire ──────────────
  console.log("\n— §3 · a super-admin may remove another; the LAST one is unreachable —");
  const selfWipe = await api("DELETE", "/users/u_sa_super", superTok, {});
  ok("a super-admin removing THEMSELVES is refused as self-removal",
     selfWipe.status === 400 && selfWipe.body.error === "cannot_remove_self", selfWipe.body);

  // A second super-admin in the same org, so one can act on the other.
  await mkUser("u_sa_super2", ORG, SUPER2, "admin", true);
  const super2Tok = await login(SUPER2);

  const peerRemoval = await api("DELETE", "/users/u_sa_super", super2Tok, {});
  ok("with two super-admins, one may remove the other", peerRemoval.status === 200, peerRemoval.body);
  const removedRows = await audit("u_sa_super");
  const removedRow = removedRows.find(r => r.action === "removed");
  ok("...the removal is audited", !!removedRow, removedRows);
  ok("...naming the actor", removedRow.actor_user_id === "u_sa_super2", removedRow);
  ok("...and recording that the target WAS a super-admin, not merely an admin",
     removedRow.target_role === "super_admin", removedRow);

  // Scoped to THIS org: the scratch database is shared with every other suite,
  // several of which mint their own super-admins.
  const [{ c: liveSupers }] = await q(
    `SELECT COUNT(*)::int c FROM users WHERE org_id=$1 AND is_super_admin=true AND deactivated_at IS NULL`, [ORG]);
  ok("exactly one active super-admin remains in this org", liveSupers === 1, liveSupers);

  // THE HONEST STATEMENT OF RULE 2. `last_super_admin` is defence in depth and
  // is UNREACHABLE while rule 1 stands, which is worth writing down rather than
  // faking a scenario to turn green:
  //
  //   · a NON-super-admin actor is refused by rule 1 (super_admin_protected)
  //     before the count is ever taken - proven in §1;
  //   · a SUPER-ADMIN actor is, by definition, an ACTIVE super-admin, so the
  //     target can never be the only active one; and actor === target is
  //     caught first by the self-removal rule - proven above;
  //   · a cross-org target 404s, because the route is org-scoped.
  //
  // So the branch cannot be exercised through the route. It stays because rule
  // 1 is a policy that could be relaxed (a future "super-admins manage each
  // other" screen), and on that day rule 2 is the thing standing between a
  // tidy-up and a locked console. What IS asserted is that it exists and is
  // reachable in code, so a refactor cannot silently drop it.
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const route = src.slice(src.indexOf('app.delete("/users/:id"'), src.indexOf('app.delete("/users/:id"') + 3000);
  ok("the last-super-admin rule is present in the route", /last_super_admin/.test(route));
  ok("...and counts only ACTIVE super-admins other than the target",
     /is_super_admin=true AND deactivated_at IS NULL AND id<>\?/.test(route), route.match(/SELECT COUNT[^;]*is_super_admin[^;]*/)?.[0]);
  ok("...and rule 1 is checked BEFORE it, which is why it cannot fire",
     route.indexOf("super_admin_protected") < route.indexOf("last_super_admin"));

  // ── §4 · ordinary removals still work, and are audited ──────────────────
  console.log("\n— §4 · an ordinary removal still works, and leaves an actor —");
  const ordinary = await api("DELETE", "/users/u_sa_victim", adminTok, {});
  ok("an ordinary user is removed by an org admin", ordinary.status === 200, ordinary.body);
  const vAudit = await audit("u_sa_victim");
  ok("...and the removal is audited with the actor", vAudit.length === 1 && vAudit[0].action === "removed" && vAudit[0].actor_user_id === "u_sa_admin", vAudit);
  ok("...recording the target's email for a human reading it later", vAudit[0].target_email === VICTIM, vAudit[0]);

  // ── §5 · a deactivated account is TOLD so ───────────────────────────────
  console.log("\n— §5 · a deactivated account is told, by name —");
  const denied = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: VICTIM, password: "loadtest1234" }),
  });
  const deniedBody = await denied.json();
  ok("login is refused", denied.status === 403, denied.status);
  ok("...with the exact sentence",
     deniedBody.message === "This account has been deactivated. Contact your workspace admin.", deniedBody);
  ok("...and a code the client can branch on", deniedBody.error === "account_deactivated", deniedBody);

  const wrongPw = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ORGADMIN, password: "not-the-password" }),
  });
  ok("a WRONG PASSWORD still says nothing about the account (no enumeration)",
     wrongPw.status === 401, wrongPw.status);

  await reset();
  await closeDb();
  summary();
})();
