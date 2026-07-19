// BUILD-16 Part 1 — Home command center (GET /dashboard/home).
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// What it proves:
//   - the four headers' data: Portfolio [Team], Tasks [Core], Pipeline [Team]
//     (Need-to-do is the existing /dashboard/today queue, tested elsewhere)
//   - PLAN GRACE: a Core org gets Tasks only — portfolio + pipeline are null,
//     never a broken/empty Team header; a Team org gets all of them
//   - Tasks buckets (overdue / today / upcoming / no-date) classify correctly
//   - Portfolio = the caller's assigned donors + their value + officer color
//   - Pipeline = per-stage counts + value + open-ask forecast
//   - scope=mine vs all scopes tasks + pipeline to the user vs the whole org
//   - org isolation: the endpoint only reflects the caller's org

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_home_team", CORE = "org_home_core";
const iso = d => d.toISOString().slice(0, 10);
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = iso(new Date());

async function reset() {
  for (const org of [TEAM, CORE]) {
    for (const t of ["opportunities", "tasks", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, sub, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`, [o, `Home ${tag}`, `home-${tag}`, sub, plan]);
}
async function seedUser(o, id, tag, role = "admin", color = null) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,portfolio_color) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, o, `${tag}@home.local`, hash, `User ${tag}`, role, color]);
}
async function seedDonor(o, id, owner, stage, total) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name) VALUES ($1,$2,$3,$4,'mid',$5,$6,1,$7,'x')`,
    [id, o, id, `${id}@home.local`, stage, total, owner]);
}
async function seedTask(o, id, owner, due, done = 0) {
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,assigned_to) VALUES ($1,$2,$3,$4,'medium','donor',$5,$6)`, [id, o, id, due, done, owner]);
}

(async () => {
  await reset();

  // ── TEAM org (growth, active) — all four headers ──────────────────────────
  await seedOrg(TEAM, "growth", "active", "team");
  await seedUser(TEAM, "u_admin", "admin", "admin", "#1a6b4a");
  await seedUser(TEAM, "u_staff", "staff", "staff");
  // donors: 4 to admin (3 in pipeline stages + 1 'closed'), 1 to staff
  await seedDonor(TEAM, "hd1", "u_admin", "cultivate", 500);
  await seedDonor(TEAM, "hd2", "u_admin", "solicit", 300);
  await seedDonor(TEAM, "hd4", "u_admin", "lapsed", 200);
  await seedDonor(TEAM, "hd5", "u_admin", "closed", 50);   // NOT a pipeline stage
  await seedDonor(TEAM, "hd3", "u_staff", "prospect", 100);
  // an open ask on an admin donor → forecast
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status) VALUES ('op1',$1,'hd1','Ask',5000,'open')`, [TEAM]);
  // tasks: admin overdue/today/upcoming/no-date + one done + one staff-today
  await seedTask(TEAM, "t_over", "u_admin", dayOffset(-2));
  await seedTask(TEAM, "t_today", "u_admin", TODAY);
  await seedTask(TEAM, "t_up", "u_admin", dayOffset(3));
  await seedTask(TEAM, "t_none", "u_admin", "");
  await seedTask(TEAM, "t_done", "u_admin", dayOffset(-2), 1);   // done → excluded
  await seedTask(TEAM, "t_staff", "u_staff", TODAY);             // other user

  const tok = await login("admin@home.local");
  const mine = (await api("GET", "/dashboard/home?scope=mine", tok)).body;

  ok("team org → tier is team", mine.tier === "team");
  // Portfolio
  ok("portfolio present on team", mine.portfolio !== null);
  ok("portfolio.count = all my assigned donors (4)", mine.portfolio.count === 4, mine.portfolio.count);
  ok("portfolio.value = Σ my donors' giving (1050)", mine.portfolio.value === 1050, mine.portfolio.value);
  ok("portfolio.color = my officer color", mine.portfolio.color === "#1a6b4a");
  // Tasks buckets (mine)
  ok("tasks.overdue = 1", mine.tasks.overdue === 1, mine.tasks);
  ok("tasks.today = 1", mine.tasks.today === 1, mine.tasks);
  ok("tasks.upcoming = 1", mine.tasks.upcoming === 1, mine.tasks);
  ok("tasks.noDate = 1", mine.tasks.noDate === 1, mine.tasks);
  ok("tasks.total = 4 (done excluded, staff excluded)", mine.tasks.total === 4, mine.tasks);
  // Pipeline
  ok("pipeline present on team", mine.pipeline !== null);
  ok("pipeline.total = my pipeline-stage donors (3, 'closed' excluded)", mine.pipeline.total === 3, mine.pipeline.total);
  ok("pipeline.value = Σ my pipeline donors (1000)", mine.pipeline.value === 1000, mine.pipeline.value);
  ok("pipeline stages cover all 6 canonical stages", mine.pipeline.stages.length === 6);
  const cult = mine.pipeline.stages.find(s => s.stage === "cultivate");
  ok("cultivate stage shows my 1 donor / $500", cult.count === 1 && cult.value === 500);
  ok("pipeline.forecastOpen = my open asks (5000)", mine.pipeline.forecastOpen === 5000, mine.pipeline.forecastOpen);

  // scope=all widens tasks + pipeline to the whole org
  const all = (await api("GET", "/dashboard/home?scope=all", tok)).body;
  ok("scope=all tasks.today = 2 (admin + staff)", all.tasks.today === 2, all.tasks);
  ok("scope=all tasks.total = 5", all.tasks.total === 5, all.tasks);
  ok("scope=all pipeline.total = 4 (adds staff's prospect)", all.pipeline.total === 4, all.pipeline.total);

  // ── CORE org (seed plan, active) — plan grace ─────────────────────────────
  await seedOrg(CORE, "seed", "active", "core");
  await seedUser(CORE, "u_core", "core", "admin");
  await seedDonor(CORE, "cd1", "u_core", "cultivate", 400);
  await seedTask(CORE, "ct_over", "u_core", dayOffset(-1));
  await seedTask(CORE, "ct_today", "u_core", TODAY);

  const tokC = await login("core@home.local");
  const core = (await api("GET", "/dashboard/home?scope=mine", tokC)).body;
  ok("core org → tier is core", core.tier === "core");
  ok("PLAN GRACE: portfolio hidden (null) on Core", core.portfolio === null);
  ok("PLAN GRACE: pipeline hidden (null) on Core", core.pipeline === null);
  ok("Core still gets Tasks (overdue 1, today 1, total 2)", core.tasks.overdue === 1 && core.tasks.today === 1 && core.tasks.total === 2, core.tasks);

  // ── Org isolation ─────────────────────────────────────────────────────────
  ok("core org's numbers never include team org's donors", core.tasks.total === 2);
  ok("team admin sees only team org's tasks", all.tasks.total === 5);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
