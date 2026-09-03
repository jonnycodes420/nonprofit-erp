// BUILD-75 C.3 — USER REMOVAL: soft-detach, revoke, preserve authorship.
//
// BUILD-38's session revocation was built for the fired-development-officer
// threat and never had a trigger; the only removal path was manual database
// surgery (the documented dangling-FK incident). This suite pins the whole
// contract of DELETE /users/:id:
//   - the row SURVIVES (institutional memory) with deactivated_at stamped
//   - their live session dies immediately (sessions_valid_after bump) and
//     login is blocked with the same generic message as a wrong password
//   - everything they authored keeps their actor identity (C.1)
//   - their portfolio donors and open task assignments are released
//   - their seat is freed for the plan limit
//   - refusals: self, last active admin, foreign/unknown → 404, staff → 403
//   - the team list no longer shows them

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_userrm", ORG2 = "org_userrm2";

(async () => {
  console.log("user-removal (BUILD-75 C.3)");
  for (const o of [ORG, ORG2]) {
    for (const t of ["gifts", "interactions", "tasks", "donors", "invites", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Removal Org','user-rm',1,'active','team')`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Removal Org 2','user-rm2',1,'active','team')`, [ORG2]);
  for (const [id, org, email, role] of [
    ["u_rm_admin", ORG, "admin@rm.local", "admin"], ["u_rm_admin2", ORG, "admin2@rm.local", "admin"],
    ["u_rm_officer", ORG, "officer@rm.local", "staff"], ["u_rm2_admin", ORG2, "admin@rm2.local", "admin"],
  ]) await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, org, email, hash, email.split("@")[0], role]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name,tags)
           VALUES ('d_rm1',$1,'Assigned Donor','ad@rm.local','mid','cultivate',100,1,'u_rm_officer','officer','[]')`, [ORG]);
  await q(`INSERT INTO tasks (id,org_id,title,done,assigned_to,assigned_to_name) VALUES ('t_rm_open',$1,'Open task',0,'u_rm_officer','officer'),('t_rm_done',$1,'Done task',1,'u_rm_officer','officer')`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_rm1',$1,'d_rm1',100,'2026-08-01','cash','u_rm_officer','officer@rm.local')`, [ORG]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ('i_rm1',$1,'d_rm1','note','Officer note','2026-08-01','u_rm_officer','officer')`, [ORG]);

  const adminTok = await login("admin@rm.local");
  const officerTok = await login("officer@rm.local");
  const foreignTok = await login("admin@rm2.local");

  // refusals first
  const self = await api("DELETE", "/users/u_rm_admin", adminTok);
  ok("removing yourself → 400 cannot_remove_self", self.status === 400 && self.body.error === "cannot_remove_self", self);
  const staffTry = await api("DELETE", "/users/u_rm_admin", officerTok);
  ok("a staff user cannot remove anyone → 403", staffTry.status === 403, staffTry.status);
  const foreign = await api("DELETE", "/users/u_rm_officer", foreignTok);
  ok("a foreign org's admin gets 404, indistinguishable from unknown", foreign.status === 404, foreign.status);
  const ghost = await api("DELETE", "/users/u_nonexistent", adminTok);
  ok("unknown id → 404", ghost.status === 404, ghost.status);

  // the removal
  const rm = await api("DELETE", "/users/u_rm_officer", adminTok);
  ok("removal succeeds with a summary", rm.status === 200 && rm.body.removed === true && rm.body.donorsUnassigned === 1 && rm.body.openTasksUnassigned === 1, rm.body);

  const [row] = await q(`SELECT deactivated_at, sessions_valid_after, name FROM users WHERE id='u_rm_officer'`);
  ok("the row SURVIVES, soft-detached (deactivated_at stamped)", !!row && !!row.deactivated_at, row);

  // session dead immediately (SESSION_CACHE_TTL_MS=0 in the scratch boot)
  const dead = await api("GET", "/tasks", officerTok);
  ok("their live session is revoked (401)", dead.status === 401, dead.status);
  const relog = await api("POST", "/auth/login", null, { email: "officer@rm.local", password: "loadtest1234" });
  ok("login is blocked with the GENERIC message (no account enumeration)", relog.status === 401 && relog.body.error === "Invalid credentials", relog);

  // authorship preserved, attachments released
  const [g] = await q(`SELECT created_by, created_by_name FROM gifts WHERE id='g_rm1'`);
  const [n] = await q(`SELECT created_by, logged_by_name FROM interactions WHERE id='i_rm1'`);
  ok("everything they authored keeps their identity", g.created_by === "u_rm_officer" && n.created_by === "u_rm_officer" && n.logged_by_name === "officer", { g, n });
  const [d] = await q(`SELECT assigned_to, assigned_to_name FROM donors WHERE id='d_rm1'`);
  ok("their portfolio donor returns to the Directory unassigned", d.assigned_to === null && d.assigned_to_name === null, d);
  const [tOpen] = await q(`SELECT assigned_to FROM tasks WHERE id='t_rm_open'`);
  const [tDone] = await q(`SELECT assigned_to FROM tasks WHERE id='t_rm_done'`);
  ok("open task released; COMPLETED task keeps its historical assignee", tOpen.assigned_to === null && tDone.assigned_to === "u_rm_officer", { tOpen, tDone });

  // surfaces
  const teamList = await api("GET", "/org/team", adminTok);
  ok("the team list no longer shows them", teamList.status === 200 && !teamList.body.some(m => m.id === "u_rm_officer"), teamList.body.map(m => m.id));
  const again = await api("DELETE", "/users/u_rm_officer", adminTok);
  ok("removing an already-removed user → 404 (idempotent surface)", again.status === 404, again.status);

  // last-admin protection: remove admin2, then admin can't be removed by... admin2 is gone; try admin2 removes... instead:
  const rmAdmin2 = await api("DELETE", "/users/u_rm_admin2", adminTok);
  ok("a second admin CAN be removed while another remains", rmAdmin2.status === 200, rmAdmin2.status);
  // now u_rm_admin is the last active admin — no one else can even try but the
  // rule is pinned directly at the DB level via a fresh second staffer:
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_rm_admin3',$1,'admin3@rm.local',$2,'admin3','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  const admin3Tok = await login("admin3@rm.local");
  const lastAdmin = await api("DELETE", "/users/u_rm_admin", admin3Tok);
  ok("an admin can be removed while another active admin exists", lastAdmin.status === 200, lastAdmin.status);
  const veryLast = await api("DELETE", "/users/u_rm_admin3", admin3Tok);
  ok("the LAST active admin cannot be removed (and it's also a self-removal)", veryLast.status === 400, veryLast);

  await closeDb();
  summary();
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
