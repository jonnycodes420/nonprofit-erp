// BUILD-14 Part 4 — Officer portfolios + color (Team plan).
// Local scratch server + Postgres (tests/README.md recipe).
//
// Covers: portfolio filter-by-officer correctness, officer color assignment +
// persistence, requirePlan('team') gate (Core org → 403 plan_required, Team →
// 200), requireAdmin (staff → 403), invalid-hex 400, single-user grace flag,
// checkWriteAccess ordering (team read_only org → 402), and org isolation
// (can't color a foreign org's user).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_pf_team", CORE = "org_pf_core", ROTEAM = "org_pf_roteam", SOLO = "org_pf_solo";
const today = new Date().toISOString().slice(0, 10);

async function reset() {
  for (const org of [TEAM, CORE, ROTEAM, SOLO]) {
    for (const t of ["gifts", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, subStatus, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`,
    [o, `PF ${tag}`, `pf-${tag}`, subStatus, plan]);
}
async function seedUser(o, id, tag, role = "admin") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, o, `${tag}@pf.local`, hash, `User ${tag}`, role]);
}
async function seedDonor(o, id, name, owner, ownerName, total) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name)
           VALUES ($1,$2,$3,$4,'mid','cultivate',$5,1,$6,$7,$8)`,
    [id, o, name, `${id}@pf.local`, total, today, owner, ownerName]);
}

(async () => {
  await reset();
  // TEAM org: growth plan, active, two officers
  await seedOrg(TEAM, "growth", "active", "team");
  await seedUser(TEAM, "u_team_admin", "teamadmin", "admin");
  await seedUser(TEAM, "u_team_staff", "teamstaff", "staff");
  await seedDonor(TEAM, "pf_d1", "Donor One", "u_team_admin", "User teamadmin", 500);
  await seedDonor(TEAM, "pf_d2", "Donor Two", "u_team_admin", "User teamadmin", 300);
  await seedDonor(TEAM, "pf_d3", "Donor Three", "u_team_staff", "User teamstaff", 100);
  // CORE org: seed plan, active
  await seedOrg(CORE, "seed", "active", "core");
  await seedUser(CORE, "u_core_admin", "coreadmin", "admin");
  // ROTEAM: growth plan but trial_expired (read_only, still team-tier)
  await seedOrg(ROTEAM, "growth", "trial_expired", "roteam");
  await seedUser(ROTEAM, "u_ro_admin", "roadmin", "admin");
  await seedUser(ROTEAM, "u_ro_two", "rotwo", "staff");
  // SOLO team org: single user
  await seedOrg(SOLO, "growth", "active", "solo");
  await seedUser(SOLO, "u_solo_admin", "soloadmin", "admin");

  const teamAdmin = await login("teamadmin@pf.local");
  const teamStaff = await login("teamstaff@pf.local");
  const coreAdmin = await login("coreadmin@pf.local");
  const roAdmin = await login("roadmin@pf.local");
  const soloAdmin = await login("soloadmin@pf.local");

  // ── Officer list + tier + portfolio rollups ───────────────────────────────
  const teamOfficers = (await api("GET", "/portfolio/officers", teamAdmin)).body;
  ok("GET /portfolio/officers → tier=team", teamOfficers.tier === "team", teamOfficers.tier);
  ok("team org not single_user", teamOfficers.single_user === false);
  const adminOfficer = teamOfficers.officers.find(o => o.id === "u_team_admin");
  ok("portfolio_count correct (2 donors on admin)", adminOfficer.portfolio_count === 2, adminOfficer.portfolio_count);
  ok("portfolio_giving correct (800)", adminOfficer.portfolio_giving === 800, adminOfficer.portfolio_giving);

  const coreOfficers = (await api("GET", "/portfolio/officers", coreAdmin)).body;
  ok("core org → tier=core", coreOfficers.tier === "core", coreOfficers.tier);
  ok("solo org → single_user=true (grace)", (await api("GET", "/portfolio/officers", soloAdmin)).body.single_user === true);

  // ── Filter-by-officer (portfolio view) ────────────────────────────────────
  const adminPortfolio = (await api("GET", "/donors?assignedTo=u_team_admin", teamAdmin)).body;
  ok("filter assignedTo=admin → exactly its 2 donors", adminPortfolio.length === 2 && adminPortfolio.every(d => d.assigned_to === "u_team_admin"), adminPortfolio.map(d => d.id));
  const staffPortfolio = (await api("GET", "/donors?assignedTo=u_team_staff", teamAdmin)).body;
  ok("filter assignedTo=staff → its 1 donor", staffPortfolio.length === 1 && staffPortfolio[0].id === "pf_d3");

  // ── Color assignment (Team) ───────────────────────────────────────────────
  const setColor = await api("PUT", "/portfolio/officers/u_team_admin/color", teamAdmin, { color: "#1a6b4a" });
  ok("team admin PUT color → 200", setColor.status === 200, setColor.status);
  ok("color persisted", (await q("SELECT portfolio_color FROM users WHERE id='u_team_admin'"))[0].portfolio_color === "#1a6b4a");
  ok("color surfaced in GET /portfolio/officers", (await api("GET", "/portfolio/officers", teamAdmin)).body.officers.find(o => o.id === "u_team_admin").portfolio_color === "#1a6b4a");
  ok("invalid hex → 400", (await api("PUT", "/portfolio/officers/u_team_admin/color", teamAdmin, { color: "green" })).status === 400);
  ok("clear color (empty) → 200", (await api("PUT", "/portfolio/officers/u_team_admin/color", teamAdmin, { color: "" })).status === 200);
  ok("cleared color is NULL", (await q("SELECT portfolio_color FROM users WHERE id='u_team_admin'"))[0].portfolio_color === null);

  // ── Plan gate: Core → 403 ─────────────────────────────────────────────────
  const coreColor = await api("PUT", "/portfolio/officers/u_core_admin/color", coreAdmin, { color: "#1a6b4a" });
  ok("core org PUT color → 403 plan_required", coreColor.status === 403 && coreColor.body.error === "plan_required", coreColor.body);

  // ── requireAdmin: staff → 403 ─────────────────────────────────────────────
  ok("team STAFF PUT color → 403 (admin required)", (await api("PUT", "/portfolio/officers/u_team_admin/color", teamStaff, { color: "#c9a84c" })).status === 403);

  // ── Middleware ordering: team-tier read_only → 402 ────────────────────────
  const roColor = await api("PUT", "/portfolio/officers/u_ro_two/color", roAdmin, { color: "#c9a84c" });
  ok("read_only team org PUT color → 402 (passes plan gate, hits checkWriteAccess)", roColor.status === 402, roColor.status);

  // ── Org isolation: can't color a foreign org's user ───────────────────────
  ok("team admin PUT color on CORE's user → 404", (await api("PUT", "/portfolio/officers/u_core_admin/color", teamAdmin, { color: "#1a6b4a" })).status === 404);
  ok("no color planted on foreign user", (await q("SELECT portfolio_color FROM users WHERE id='u_core_admin'"))[0].portfolio_color === null);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
