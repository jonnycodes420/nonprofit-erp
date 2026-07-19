// BUILD-16 Part 2 — typed, multiple, roll-up fundraising goals.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// What it proves:
//   - goals are TYPED (annual/project/capital) and MULTIPLE run at once; the
//     category persists and validates (bad category → 400)
//   - an overarching goal ROLLS UP its children: parent.rolledRaised =
//     Σ(children raised), a live SUM (add a gift → it moves), never a counter
//   - the Overview roll-up header = Σ(top-level active goals), children are NOT
//     double-counted; percent math is correct
//   - graceful DEGRADATION: 0 goals → rollup null; 1 goal → activeGoalCount 1;
//     many → the full portfolio
//   - pace per goal degrades gracefully (on_track / met / behind / null)
//   - parent validation: foreign parent → 400, self-parent → 400
//   - org isolation: org B never sees org A's goals

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_goals_a";   // many goals + roll-up
const B = "org_goals_b";   // one goal
const C = "org_goals_c";   // zero goals + isolation probe

const iso = d => d.toISOString().slice(0, 10);
const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = iso(new Date());

async function reset() {
  for (const org of [A, B, C]) {
    for (const t of ["gifts", "campaigns", "fundraising_goals", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [o, `Goals ${tag}`, `goals-${tag}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [`u_${o}`, o, `${tag}@goals.local`, hash, `User ${tag}`]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,'Donor','d@goals.local','mid','cultivate',0,0)`, [`d_${o}`, o]);
}
// A goal'd campaign with an optional category / parent / dates.
async function goal(org, id, name, goalAmount, { category = "project", parent = null, start = null, end = null } = {}) {
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,goal_category,parent_goal_id,recipient_count,open_count)
           VALUES ($1,$2,$3,'appeal','draft',$4,$5,$6,$7,$8,0,0)`,
    [id, org, name, goalAmount, start, end, category, parent]);
}
async function gift(org, id, donor, amount, campaignName) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ($1,$2,$3,$4,$5,'cash',$6)`,
    [id, org, donor, amount, TODAY, campaignName]);
}

(async () => {
  await reset();
  await seedOrg(A, "a"); await seedOrg(B, "b"); await seedOrg(C, "c");

  // ── Org A — many typed goals with a roll-up ───────────────────────────────
  // Annual Fund (parent, overarching) rolls up Spring + Gala. Capital stands
  // alone. Spring on_track (half-elapsed), Gala met (no dates, over goal),
  // Capital behind (half-elapsed, barely raised).
  await goal(A, "g_annual", "Annual Fund 2026", 20000, { category: "annual", start: daysFromNow(-60), end: daysFromNow(60) });
  await goal(A, "g_spring", "Spring Appeal", 8000, { category: "project", parent: "g_annual", start: daysFromNow(-30), end: daysFromNow(30) });
  await goal(A, "g_gala", "Gala 2026", 5000, { category: "project", parent: "g_annual" });
  await goal(A, "g_capital", "New Wing Capital", 50000, { category: "capital", start: daysFromNow(-30), end: daysFromNow(30) });
  await gift(A, "gf_s1", `d_${A}`, 4400, "Spring Appeal");  // Spring raised = 4400
  await gift(A, "gf_g1", `d_${A}`, 5500, "Gala 2026");      // Gala raised = 5500 (> 5000 → met)
  await gift(A, "gf_c1", `d_${A}`, 1000, "New Wing Capital"); // Capital raised = 1000 (behind)

  const tokA = await login("a@goals.local");
  const port = (await api("GET", "/fundraising/goals", tokA)).body;
  const byId = Object.fromEntries(port.goals.map(g => [g.id, g]));

  ok("portfolio returns all 4 goals", port.goals.length === 4);
  ok("goals are typed (annual/project/capital persisted)",
    byId.g_annual.goalCategory === "annual" && byId.g_spring.goalCategory === "project" && byId.g_capital.goalCategory === "capital");

  // Pace per goal degrades gracefully
  ok("Spring reads on_track (half-elapsed, on pace)", byId.g_spring.paceState === "on_track", byId.g_spring.paceState);
  ok("Gala reads met (no dates, raised over goal)", byId.g_gala.paceState === "met", byId.g_gala.paceState);
  ok("Capital reads behind (half-elapsed, barely raised)", byId.g_capital.paceState === "behind", byId.g_capital.paceState);

  // Overarching roll-up
  const annual = byId.g_annual;
  ok("Annual Fund is flagged overarching with 2 children", annual.isOverarching && annual.childCount === 2);
  ok("parent.rolledRaised = Σ(children raised) = 9900", annual.rolledRaised === (byId.g_spring.raised + byId.g_gala.raised) && annual.rolledRaised === 9900, annual.rolledRaised);
  ok("children are not top-level (won't double-count in header)", !byId.g_spring.isTopLevel && !byId.g_gala.isTopLevel);
  ok("parent + standalone ARE top-level", annual.isTopLevel && byId.g_capital.isTopLevel);

  // Header roll-up = Σ(top-level active goals), children excluded
  const ru = port.rollup;
  ok("rollup counts 2 active top-level goals (parent + standalone)", ru.activeGoalCount === 2, ru.activeGoalCount);
  ok("rollup.totalGoal = parent + standalone goal (70000), not children", ru.totalGoal === 70000, ru.totalGoal);
  ok("rollup.totalRaised = parent.rolledRaised + standalone.raised (10900), no double-count", ru.totalRaised === 10900, ru.totalRaised);
  ok("rollup.percent = round(10900/70000) = 16", ru.percent === Math.round(10900 / 70000 * 100));

  // Live SUM — add a gift to Spring, roll-up moves (never a stored counter)
  await gift(A, "gf_s2", `d_${A}`, 600, "Spring Appeal");
  const port2 = (await api("GET", "/fundraising/goals", tokA)).body;
  const annual2 = port2.goals.find(g => g.id === "g_annual");
  ok("adding a gift to a child moves the parent roll-up (live SUM)", annual2.rolledRaised === 10500, annual2.rolledRaised);
  ok("adding a child gift moves the header roll-up too", port2.rollup.totalRaised === 11500, port2.rollup.totalRaised);

  // Overview carries the same portfolio + rollup
  const ov = (await api("GET", "/fundraising/overview", tokA)).body;
  ok("overview exposes rollup + goals for the header rework", ov.rollup && Array.isArray(ov.goals) && ov.goals.length === 4);

  // ── Category + parent validation via the API ──────────────────────────────
  ok("POST goal with bad category → falls back to project (still 201)",
    (await api("POST", "/fundraising/campaigns", tokA, { name: "Bad Cat", goalAmount: 100, goalCategory: "nonsense" })).body.goalCategory === "project");
  ok("PUT with bad category → 400",
    (await api("PUT", "/fundraising/campaigns/g_spring", tokA, { goalCategory: "nope" })).status === 400);
  ok("POST with foreign parent → 400",
    (await api("POST", "/fundraising/campaigns", tokA, { name: "Bad Parent", goalAmount: 100, parentGoalId: "does_not_exist" })).status === 400);
  ok("PUT a goal to be its own parent → 400",
    (await api("PUT", "/fundraising/campaigns/g_spring", tokA, { parentGoalId: "g_spring" })).status === 400);
  // A real parent set via API works and rolls up
  ok("POST a child under an existing parent works",
    (await api("POST", "/fundraising/campaigns", tokA, { name: "Fall Drive", goalAmount: 3000, goalCategory: "project", parentGoalId: "g_annual" })).status === 201);

  // ── Org B — exactly one standalone goal (degradation: single) ─────────────
  await goal(B, "g_solo", "Sustainer Fund", 12000, { category: "annual", start: daysFromNow(-10), end: daysFromNow(50) });
  await gift(B, "gf_b1", `d_${B}`, 3000, "Sustainer Fund");
  const tokB = await login("b@goals.local");
  const portB = (await api("GET", "/fundraising/goals", tokB)).body;
  ok("one-goal org → rollup.activeGoalCount === 1", portB.rollup && portB.rollup.activeGoalCount === 1);
  ok("one-goal org → the single goal is present and prominent", portB.goals.length === 1 && portB.goals[0].isTopLevel);

  // ── Org C — zero goals (degradation: none) ────────────────────────────────
  const tokC = await login("c@goals.local");
  const portC = (await api("GET", "/fundraising/goals", tokC)).body;
  ok("zero-goal org → rollup is null (plain totals, no thermometer)", portC.rollup === null && portC.goals.length === 0);
  const ovC = (await api("GET", "/fundraising/overview", tokC)).body;
  ok("zero-goal overview → rollup null, goals []", ovC.rollup === null && ovC.goals.length === 0);

  // ── Org isolation ─────────────────────────────────────────────────────────
  ok("org C never sees org A's goals", !portC.goals.some(g => g.id.startsWith("g_annual")));
  ok("org B's portfolio holds only B's goal", portB.goals.every(g => g.id === "g_solo"));

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
