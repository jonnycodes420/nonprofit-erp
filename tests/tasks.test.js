// BUILD-13 Part 1 — Tasks tab backend suite.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// Covers: create / list / one-click complete / bucket classification
// (overdue / today / upcoming), donor link with orgOwns guard (foreign donorId
// → 404, no task planted — the §1 resurfacing IDOR case), checkWriteAccess
// gating (a read_only org gets 402 on writes, reads still 200, DELETE ungated),
// per-donor open-tasks read, and two-way org isolation.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_task_a", B = "org_task_b", RO = "org_task_ro";
const iso = d => d.toISOString().slice(0, 10);
const dayOffset = n => iso(new Date(Date.now() + n * 86400000));

async function reset() {
  for (const org of [A, B, RO]) {
    for (const t of ["tasks", "interactions", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}

async function seedOrg(o, tag, subStatus = "active") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,'growth')`,
    [o, `Task ${tag}`, `task-${tag}`, subStatus]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [`u_${o}`, o, `${tag}@task.local`, hash, `Admin ${tag}`]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'mid','cultivate',0,0)`,
    [`d_${o}`, o, `Donor ${tag}`, `donor-${tag}@task.local`]);
}

(async () => {
  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  await seedOrg(RO, "ro", "trial_expired");

  // A second officer in org A — for the scope=mine test (BUILD-30 class audit).
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'staff')`,
    [`u2_${A}`, A, `a2@task.local`, bcrypt.hashSync("loadtest1234", 10), "Officer a2"]);

  const tokenA = await login("a@task.local");
  const tokenA2 = await login("a2@task.local");
  const tokenB = await login("b@task.local");
  const tokenRO = await login("ro@task.local");

  const taskExists = async id => (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE id=$1`, [id]))[0].n === 1;

  // ── Create + owner defaulting ─────────────────────────────────────────────
  const c1 = await api("POST", "/tasks", tokenA, { title: "Call Jane about spring gala", due: dayOffset(3), donorId: `d_${A}` });
  ok("POST /tasks (with own donor) → 201", c1.status === 201, c1.status);
  ok("created task carries donor_name (rendered, joined)", c1.body.donor_name === "Donor a", c1.body.donor_name);
  ok("owner defaults to creator name", c1.body.assigned_to_name === "Admin a", c1.body.assigned_to_name);
  ok("owner defaults to creator id", c1.body.assigned_to === `u_${A}`, c1.body.assigned_to);
  const upcomingId = c1.body.id;

  const overdue = await api("POST", "/tasks", tokenA, { title: "Overdue thank-you", due: dayOffset(-5), priority: "high" });
  const todayT = await api("POST", "/tasks", tokenA, { title: "Due today follow-up", due: dayOffset(0) });
  const noDue = await api("POST", "/tasks", tokenA, { title: "Someday: research foundation" });
  ok("POST /tasks (no donor) → 201", noDue.status === 201, noDue.status);

  ok("POST /tasks missing title → 400", (await api("POST", "/tasks", tokenA, { title: "  " })).status === 400);

  // ── List + bucket classification ──────────────────────────────────────────
  const list = (await api("GET", "/tasks", tokenA)).body || [];
  ok("GET /tasks returns all 4 created", list.length === 4, list.length);
  const bucket = t => { if (!t.due) return "nodue"; const d = Math.floor((new Date(t.due) - new Date(iso(new Date()))) / 86400000); return d < 0 ? "overdue" : d === 0 ? "today" : "upcoming"; };
  const byBucket = list.reduce((m, t) => { (m[bucket(t)] ??= []).push(t); return m; }, {});
  ok("bucket: exactly 1 overdue", (byBucket.overdue || []).length === 1);
  ok("bucket: exactly 1 due today", (byBucket.today || []).length === 1);
  ok("bucket: exactly 1 upcoming", (byBucket.upcoming || []).length === 1);
  ok("bucket: exactly 1 no-due", (byBucket.nodue || []).length === 1);

  // ── One-click complete / reopen ───────────────────────────────────────────
  const done1 = await api("POST", `/tasks/${overdue.body.id}/complete`, tokenA, {});
  ok("POST /tasks/:id/complete → done=1", done1.status === 200 && !!done1.body.done, done1.body.done);
  const reopen = await api("POST", `/tasks/${overdue.body.id}/complete`, tokenA, { done: false });
  ok("POST /tasks/:id/complete {done:false} → reopened", reopen.status === 200 && !reopen.body.done);
  ok("complete unknown id → 404", (await api("POST", "/tasks/nope/complete", tokenA, {})).status === 404);

  // ── PUT edit ──────────────────────────────────────────────────────────────
  const put = await api("PUT", `/tasks/${upcomingId}`, tokenA, { title: "Call Jane (rescheduled)", due: dayOffset(6), priority: "high", done: false });
  ok("PUT /tasks/:id edits title/priority → 200", put.status === 200 && put.body.title.includes("rescheduled") && put.body.priority === "high");
  ok("PUT missing title → 400", (await api("PUT", `/tasks/${upcomingId}`, tokenA, { title: "" })).status === 400);

  // ── Per-donor open tasks ──────────────────────────────────────────────────
  const dTasks = (await api("GET", `/donors/d_${A}/tasks`, tokenA)).body || [];
  ok("GET /donors/:id/tasks returns the donor's task", dTasks.some(t => t.id === upcomingId));
  ok("GET /donors/:id/tasks for foreign donor → 404",
    (await api("GET", `/donors/d_${B}/tasks`, tokenA)).status === 404);

  // ── §1 resurfacing IDOR: foreign donorId on create ────────────────────────
  const idor = await api("POST", "/tasks", tokenA, { title: "leak attempt", donorId: `d_${B}` });
  ok("POST /tasks with B's donorId → 404 (orgOwns guard)", idor.status === 404, idor.status);
  ok("no task planted by the foreign-donor create",
    (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND title='leak attempt'`, [A]))[0].n === 0);
  const idorPut = await api("PUT", `/tasks/${upcomingId}`, tokenA, { title: "x", donorId: `d_${B}` });
  ok("PUT /tasks with B's donorId → 404 (orgOwns guard)", idorPut.status === 404, idorPut.status);

  // assignee to a foreign user → 404
  ok("POST /tasks assignedTo foreign user → 404",
    (await api("POST", "/tasks", tokenA, { title: "x", assignedTo: `u_${B}` })).status === 404);

  // ── Org isolation ─────────────────────────────────────────────────────────
  ok("A's tasks never appear in B's list",
    !((await api("GET", "/tasks", tokenB)).body || []).some(t => t.id === upcomingId));
  ok("B cannot complete A's task (404)", (await api("POST", `/tasks/${upcomingId}/complete`, tokenB, {})).status === 404);
  ok("B cannot PUT A's task (404)", (await api("PUT", `/tasks/${upcomingId}`, tokenB, { title: "hax" })).status === 404);
  await api("DELETE", `/tasks/${upcomingId}`, tokenB);
  ok("B's DELETE does not remove A's task (org-scoped)", await taskExists(upcomingId));

  // ── checkWriteAccess gating (read_only org) ───────────────────────────────
  ok("read_only org POST /tasks → 402", (await api("POST", "/tasks", tokenRO, { title: "x" })).status === 402);
  const roTask = await q(`INSERT INTO tasks (id,org_id,title,priority,done) VALUES ('t_ro1',$1,'ro task','medium',0) RETURNING id`, [RO]);
  ok("read_only org GET /tasks still 200 (reads never gated)",
    (await api("GET", "/tasks", tokenRO)).status === 200);
  ok("read_only org POST complete → 402", (await api("POST", "/tasks/t_ro1/complete", tokenRO, {})).status === 402);
  ok("read_only org DELETE still allowed (ungated)", (await api("DELETE", "/tasks/t_ro1", tokenRO)).status === 200);
  ok("DELETE actually removed it", !(await taskExists("t_ro1")));

  // ── scope=mine vs all (BUILD-30 class audit: the Tasks card lands on its N) ──
  // A2 owns one task; A owns several. GET /tasks?scope=mine is per-caller. Runs
  // before the end-of-suite reset() below (org A must still exist here).
  const a2Task = await api("POST", "/tasks", tokenA2, { title: "A2's own task" });
  ok("A2 creates a task → 201", a2Task.status === 201, a2Task.status);
  const allA = (await api("GET", "/tasks", tokenA)).body || [];
  const mineA = (await api("GET", "/tasks?scope=mine", tokenA)).body || [];
  const mineA2 = (await api("GET", "/tasks?scope=mine", tokenA2)).body || [];
  ok("scope=all (default) returns the whole org's tasks incl. A2's", allA.some(t => t.id === a2Task.body.id), allA.length);
  ok("A's scope=mine excludes A2's task", !mineA.some(t => t.id === a2Task.body.id), mineA.map(t => t.assigned_to));
  ok("A's scope=mine = only tasks assigned to A", mineA.every(t => t.assigned_to === `u_${A}`), mineA.map(t => t.assigned_to));
  ok("A2's scope=mine = exactly A2's one task", mineA2.length === 1 && mineA2[0].id === a2Task.body.id, mineA2.length);
  ok("scope=mine is a strict subset of all", mineA.length < allA.length, { mine: mineA.length, all: allA.length });
  ok("scope=mine stays org-scoped (B never sees A's tasks)", ((await api("GET", "/tasks?scope=mine", tokenB)).body || []).every(t => t.org_id === B), true);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
