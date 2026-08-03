// BUILD-30 — assignment = portfolio = pipeline membership, ONE definition.
//
// The bug this locks shut: Home read "Portfolio: 16 donors" while the Pipeline
// board rendered (near) empty, because Home counted `assigned_to` and the board
// counted a separate `in_pipeline` flag. Those two states drifted. BUILD-30
// retired the flag: a donor ASSIGNED to an officer IS in that officer's
// portfolio AND on their pipeline board — one shared server helper
// (`portfolioMembership`) feeds Home's Portfolio card, Home's Pipeline card, the
// board, and the Donors Team views, so they can never disagree again.
//
// Covers, for a seeded officer with N assigned donors:
//   • Home Portfolio count == Home Pipeline total == board membership == the
//     shared definition (assigned + in a pipeline stage), for count AND value;
//   • assigning a donor bumps all four; unassigning drops all four;
//   • an officer with 0 assigned → 0 everywhere + the empty board (empty state);
//   • unassigned (Directory-only) donors NEVER appear on any board (mine/all/by-officer);
//   • a non-pipeline-stage assigned donor is excluded from ALL surfaces identically;
//   • every Home stat card lands on a view showing EXACTLY its number (click-through);
//   • org-scoped throughout.
//
// Local scratch server + Postgres (tests/README.md). Never production.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_ppc_team", T2 = "org_ppc_t2";
const STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
const today = new Date().toISOString().slice(0, 10);
const boardIds = body => Object.values(body.columns || {}).flat().map(c => c.donorId);
const boardVal = body => Object.values(body.columns || {}).flat().reduce((s, c) => s + (parseFloat(c.totalGiving) || 0), 0);

async function reset() {
  for (const org of [TEAM, T2]) {
    for (const t of ["moves", "opportunities", "donor_designations", "interactions", "gifts", "fin_transactions", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
    [o, `PPC ${tag}`, `ppc-${tag}`]);
}
async function seedUser(o, id, tag, role = "admin") {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, o, `${tag}@ppc.local`, bcrypt.hashSync("loadtest1234", 10), `User ${tag}`, role]);
}
// owner=null → unassigned (Directory only, never on a board).
async function seedDonor(o, id, stage, total, owner, ownerName) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name)
           VALUES ($1,$2,$3,$4,'mid',$5,$6,1,$7,$8,$9)`,
    [id, o, id, `${id}@ppc.local`, stage, total, today, owner || null, ownerName || null]);
}

// The ONE definition, computed straight from SQL — what the server helper encodes.
async function sqlPortfolio(org, ownerId) {
  const r = await q(
    `SELECT COUNT(*)::int cnt, COALESCE(SUM(total_giving),0) val
       FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND assigned_to=$2 AND stage = ANY($3)`,
    [org, ownerId, STAGES]);
  return { count: r[0].cnt, value: parseFloat(r[0].val) };
}

// Fetch all four surfaces for an officer's OWN portfolio and return their numbers.
async function surfaces(token, ownerId) {
  const [home, board, officers] = await Promise.all([
    api("GET", "/dashboard/home?scope=mine", token),
    api("GET", "/pipeline?scope=mine", token),
    api("GET", "/portfolio/officers", token),
  ]);
  const off = (officers.body.officers || []).find(o => o.id === ownerId) || {};
  return {
    homePortfolioCount: home.body?.portfolio?.count,
    homePortfolioValue: home.body?.portfolio?.value,
    homePipelineTotal: home.body?.pipeline?.total,
    homePipelineValue: home.body?.pipeline?.value,
    boardTotal: board.body?.total,
    boardIds: boardIds(board.body),
    boardValue: boardVal(board.body),
    officerCount: off.portfolio_count,
  };
}

(async () => {
  await reset();
  await seedOrg(TEAM, "team");
  await seedUser(TEAM, "u_a", "a-admin", "admin");   // officer A (also admin, can assign)
  await seedUser(TEAM, "u_b", "b-off", "staff");     // officer B
  await seedUser(TEAM, "u_c", "c-empty", "staff");   // officer C — zero assigned
  await seedOrg(T2, "t2");
  await seedUser(T2, "u_t2", "t2-admin", "admin");

  // Officer A's portfolio: 4 donors across pipeline stages.
  await seedDonor(TEAM, "a1", "cultivate", 25000, "u_a", "User a-admin");
  await seedDonor(TEAM, "a2", "solicit",   12000, "u_a", "User a-admin");
  await seedDonor(TEAM, "a3", "steward",    3000, "u_a", "User a-admin");
  await seedDonor(TEAM, "a4", "lapsed",      800, "u_a", "User a-admin");
  // Officer B's portfolio: 2 donors.
  await seedDonor(TEAM, "b1", "prospect",   5000, "u_b", "User b-off");
  await seedDonor(TEAM, "b2", "cultivate",  1500, "u_b", "User b-off");
  // Unassigned (imported) donors — Directory only, must NEVER be on any board.
  await seedDonor(TEAM, "imp1", "cultivate", 9000, null, null);
  await seedDonor(TEAM, "imp2", "prospect",     0, null, null);
  // A non-pipeline-stage donor assigned to A — the ONE way the three surfaces
  // could differ; the shared definition must exclude it from ALL of them.
  await seedDonor(TEAM, "aClosed", "closed", 50000, "u_a", "User a-admin");
  // Foreign org donor assigned to a foreign officer — isolation.
  await seedDonor(T2, "t2d", "cultivate", 7777, "u_t2", "User t2-admin");

  const A = await login("a-admin@ppc.local");
  const B = await login("b-off@ppc.local");
  const C = await login("c-empty@ppc.local");
  const T2U = await login("t2-admin@ppc.local");

  // ── 1. The four surfaces == the one definition (count AND value) ──────────
  const sqlA = await sqlPortfolio(TEAM, "u_a");   // 4 donors (aClosed excluded), $40,800
  ok("sanity: SQL definition = 4 assigned pipeline-stage donors / $40,800", sqlA.count === 4 && sqlA.value === 40800, sqlA);
  let s = await surfaces(A, "u_a");
  ok("Home Portfolio count == the definition (4)", s.homePortfolioCount === sqlA.count, s);
  ok("Home Pipeline total == the definition (4)", s.homePipelineTotal === sqlA.count, s);
  ok("board membership count == the definition (4)", s.boardTotal === sqlA.count, s);
  ok("officer-portfolios count == the definition (4)", s.officerCount === sqlA.count, s);
  ok("ALL FOUR counts are one number", s.homePortfolioCount === s.homePipelineTotal && s.homePipelineTotal === s.boardTotal && s.boardTotal === s.officerCount, s);
  ok("Home Portfolio value == the definition ($40,800)", s.homePortfolioValue === sqlA.value, s);
  ok("Home Pipeline value == board value == the definition", s.homePipelineValue === sqlA.value && s.boardValue === sqlA.value, s);
  ok("the non-pipeline-stage donor (aClosed) is on NONE of them", !s.boardIds.includes("aClosed"), s.boardIds);

  // ── 2. Click-through: the Portfolio card lands on a view showing EXACTLY N ─
  // Client routes the Portfolio/Pipeline cards to the board; assert the board it
  // lands on renders exactly the card's number (never "16 → empty board").
  ok("click-through: Portfolio count → board renders exactly that many", s.homePortfolioCount === s.boardIds.length, { count: s.homePortfolioCount, rendered: s.boardIds.length });

  // ── 3. Assigning bumps all four; unassigning drops all four ──────────────
  let r = await api("PATCH", "/donors/imp1/assign", A, { assignedTo: "u_a", assignedToName: "User a-admin" });
  ok("assign imp1 → A", r.status === 200, r.body);
  s = await surfaces(A, "u_a");
  ok("after assign: all four counts == 5", s.homePortfolioCount === 5 && s.homePipelineTotal === 5 && s.boardTotal === 5 && s.officerCount === 5, s);
  ok("after assign: imp1 now appears on A's board", s.boardIds.includes("imp1"), s.boardIds);

  r = await api("PATCH", "/donors/a4/assign", A, { assignedTo: null, assignedToName: null });
  ok("unassign a4 → removes owner", r.status === 200, r.body);
  s = await surfaces(A, "u_a");
  ok("after unassign: all four counts == 4 again", s.homePortfolioCount === 4 && s.homePipelineTotal === 4 && s.boardTotal === 4 && s.officerCount === 4, s);
  ok("after unassign: a4 gone from the board (Directory only now)", !s.boardIds.includes("a4"), s.boardIds);

  // ── 4. An officer with 0 assigned → 0 everywhere + empty board ────────────
  const sc = await surfaces(C, "u_c");
  ok("empty officer: Home Portfolio count == 0", sc.homePortfolioCount === 0, sc);
  ok("empty officer: Home Pipeline total == 0", sc.homePipelineTotal === 0, sc);
  ok("empty officer: board total == 0 (empty-state condition)", sc.boardTotal === 0, sc);
  ok("empty officer: board renders no cards", sc.boardIds.length === 0, sc);
  ok("empty officer: values all 0", sc.homePortfolioValue === 0 && sc.homePipelineValue === 0 && sc.boardValue === 0, sc);

  // ── 5. Unassigned donors never appear on ANY board (mine/all/by-officer) ──
  const allBoard = boardIds((await api("GET", "/pipeline?scope=all", A)).body);
  ok("scope=all board excludes both imported/unassigned donors", !allBoard.includes("imp2") && !allBoard.includes("a4"), allBoard);
  const bBoard = boardIds((await api("GET", "/pipeline?scope=mine", B)).body);
  ok("officer B's board excludes A's donors AND all unassigned", bBoard.sort().join() === ["b1", "b2"].join(), bBoard);
  const byOfficer = boardIds((await api("GET", "/pipeline?assignedTo=u_a", A)).body);
  ok("by-officer filter never surfaces an unassigned donor", !byOfficer.includes("imp2"), byOfficer);

  // ── 6. Whole-shop (scope=all) also agrees across surfaces ────────────────
  const allHome = (await api("GET", "/dashboard/home?scope=all", A)).body;
  const allBoardBody = (await api("GET", "/pipeline?scope=all", A)).body;
  const sqlAll = (await q(
    `SELECT COUNT(*)::int cnt, COALESCE(SUM(total_giving),0) val FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND assigned_to IS NOT NULL AND stage = ANY($2)`,
    [TEAM, STAGES]))[0];
  ok("scope=all: Home pipeline total == board total == Σ(all assigned pipeline donors)",
    allHome.pipeline.total === allBoardBody.total && allBoardBody.total === parseInt(sqlAll.cnt, 10), { home: allHome.pipeline.total, board: allBoardBody.total, sql: sqlAll.cnt });
  ok("scope=all: Home pipeline value == board value", allHome.pipeline.value === boardVal(allBoardBody), { home: allHome.pipeline.value, board: boardVal(allBoardBody) });

  // ── 7. Org isolation ─────────────────────────────────────────────────────
  const st2 = await surfaces(T2U, "u_t2");
  ok("foreign org officer sees only its own portfolio (1 / $7,777)", st2.homePortfolioCount === 1 && st2.boardTotal === 1 && st2.boardValue === 7777, st2);
  ok("foreign org board never contains TEAM donors", !st2.boardIds.some(id => id.startsWith("a") || id.startsWith("b") || id.startsWith("imp")), st2.boardIds);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
