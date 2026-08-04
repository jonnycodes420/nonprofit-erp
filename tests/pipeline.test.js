// FIX — the pipeline is a portfolio, not the whole donor list.
// The board shows only donors ASSIGNED to an officer (assignment = membership,
// caller's portfolio by default; bulk-imported donors land in the Directory with
// a stage LABEL and never flood the board. Local scratch server + Postgres.
//
// Covers: board membership = ASSIGNMENT (BUILD-30, not a separate flag); import
// does NOT put donors on the board; add-to-pipeline + assign put them on;
// remove takes them off; scope mine/all; search/value-band/designation/officer
// filters; sort by value/last-gift; per-column counts; Core-graceful locked
// preview; team/write gating; org isolation.
//
// REGRESSION NOTE (client crash, 2026-08-03): Pipeline.jsx once threw "Rendered
// more hooks than during the previous render" in production (Sentry, a team
// officer on Safari) because BUILD-30's drag-and-drop `displayColumns` useMemo
// was placed AFTER the loading/locked early returns — a CONDITIONAL hook. Fixed
// by moving every hook above every early return. A server suite can't exercise a
// client RENDER crash, so the guard for this class is client-side:
// `react-hooks/rules-of-hooks` is now an ERROR in client/eslint.config.js and
// runs in the deploy gate (`eslint src && vite build`), so a conditional hook
// fails the build, not production. Do NOT add a hook below an early return here
// or in any sibling with a locked-preview/plan-gated return.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_pl_team", CORE = "org_pl_core", RO = "org_pl_ro", T2 = "org_pl_t2";
const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function reset() {
  for (const org of [TEAM, CORE, RO, T2]) {
    for (const t of ["moves", "opportunities", "donor_designations", "interactions", "gifts", "fin_transactions", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, sub, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`,
    [o, `PL ${tag}`, `pl-${tag}`, sub, plan]);
}
async function seedUser(o, id, tag, role = "admin") {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, o, `${tag}@pl.local`, bcrypt.hashSync("loadtest1234", 10), `User ${tag}`, role]);
}
// BUILD-30: board membership = ASSIGNMENT. A donor is on the board iff it has an
// owner (assigned_to). There is no separate in_pipeline flag — an owner is the
// one and only "on the board" state.
async function seedDonor(o, id, name, stage, opts = {}) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name)
           VALUES ($1,$2,$3,$4,'mid',$5,$6,1,$7,$8,$9)`,
    [id, o, name, `${id}@pl.local`, stage, opts.total || 0, opts.last || today, opts.owner || null, opts.ownerName || null]);
}
const boardIds = body => Object.values(body.columns).flat().map(c => c.donorId);

(async () => {
  await reset();
  await seedOrg(TEAM, "growth", "active", "team");
  await seedUser(TEAM, "u_pl_a", "a-admin", "admin");
  await seedUser(TEAM, "u_pl_b", "b-off", "staff");
  await seedOrg(CORE, "seed", "active", "core");
  await seedUser(CORE, "u_plc", "c-admin", "admin");
  await seedOrg(RO, "growth", "trial_expired", "ro");
  await seedUser(RO, "u_plro", "ro-admin", "admin");
  await seedOrg(T2, "growth", "active", "t2");
  await seedUser(T2, "u_plt2", "t2-admin", "admin");

  // TEAM donors:
  //  - imported set (unassigned) — must NEVER be on the board (Directory only)
  await seedDonor(TEAM, "pl_imp1", "Imported One",   "cultivate", { total: 500 });
  await seedDonor(TEAM, "pl_imp2", "Imported Two",   "prospect",  { total: 0 });
  await seedDonor(TEAM, "pl_imp3", "Imported Three", "steward",   { total: 9000 });
  //  - portfolio set (assigned = on the board, BUILD-30)
  await seedDonor(TEAM, "pl_a1", "Alice Big",   "cultivate", { total: 25000, last: daysAgo(10),  owner: "u_pl_a", ownerName: "User a-admin" });
  await seedDonor(TEAM, "pl_a2", "Aaron Small", "cultivate", { total: 800,   last: daysAgo(400), owner: "u_pl_a", ownerName: "User a-admin" });
  await seedDonor(TEAM, "pl_b1", "Bella Owned", "solicit",   { total: 12000, last: daysAgo(30),  owner: "u_pl_b", ownerName: "User b-off" });
  await seedDonor(TEAM, "pl_u1", "Uma Assigned","prospect",  { total: 3000,  last: daysAgo(60),  owner: "u_pl_a", ownerName: "User a-admin" }); // A's third
  await seedDonor(CORE, "plc_1", "Core Prospect", "prospect", { total: 0, owner: "u_plc", ownerName: "User c-admin" });
  await seedDonor(RO,   "plr_1", "RO Prospect",   "prospect", { total: 0, owner: "u_plro", ownerName: "User ro-admin" });
  await seedDonor(T2,   "plt2_1","Foreign",       "prospect", { total: 0, owner: "u_plt2", ownerName: "User t2-admin" });
  // A designation for filter test
  await q(`INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES ($1,$2,$3,'planned_confirmed') ON CONFLICT DO NOTHING`, ["dsg_pl", TEAM, "pl_a1"]);

  const A = await login("a-admin@pl.local");
  const B = await login("b-off@pl.local");
  const C = await login("c-admin@pl.local");
  const RUSER = await login("ro-admin@pl.local");
  const T2U = await login("t2-admin@pl.local");

  // ── 1. Board = portfolio, not the whole donor list ───────────────────────
  let r = await api("GET", "/pipeline?scope=all", A);
  ok("board unlocked for team", r.status === 200 && r.body.locked === false, r.body);
  const allBoard = boardIds(r.body);
  ok("board excludes imported (unassigned) donors", !allBoard.includes("pl_imp1") && !allBoard.includes("pl_imp2") && !allBoard.includes("pl_imp3"), allBoard);
  ok("board includes only the 4 curated prospects", allBoard.sort().join() === ["pl_a1", "pl_a2", "pl_b1", "pl_u1"].sort().join(), allBoard);
  ok("board total = 4 (not the 7 donors in the org)", r.body.total === 4, r.body.total);

  // ── 2. Default scope = my portfolio ──────────────────────────────────────
  r = await api("GET", "/pipeline", A);
  const mine = boardIds(r.body);
  ok("default scope = mine", r.body.scope === "mine", r.body.scope);
  ok("my board = donors assigned to me (not b's)", mine.sort().join() === ["pl_a1", "pl_a2", "pl_u1"].sort().join(), mine);
  ok("my board excludes another officer's prospect", !mine.includes("pl_b1"), mine);
  r = await api("GET", "/pipeline", B);
  ok("officer B sees only donors assigned to them", boardIds(r.body).sort().join() === ["pl_b1"].join(), boardIds(r.body));

  // ── 3. Import does NOT flood the board ───────────────────────────────────
  const imp = await api("POST", "/donors/import", A, {
    donors: [
      { name: "Fresh Import 1", email: "fresh1@pl.local", total: 5000, lastGift: daysAgo(20) },
      { name: "Fresh Import 2", email: "fresh2@pl.local", total: 100 },
    ],
  });
  ok("import 200", imp.status === 200 && imp.body.created === 2, imp.body);
  const freshRows = await q(`SELECT id, assigned_to FROM donors WHERE org_id=$1 AND email LIKE 'fresh%@pl.local'`, [TEAM]);
  ok("imported donors are unassigned (no auto-owner) → Directory only, not on the board", freshRows.every(d => d.assigned_to === null), freshRows);
  r = await api("GET", "/pipeline?scope=all", A);
  const afterImport = boardIds(r.body);
  ok("imported donors never appear on any board", !freshRows.some(d => afterImport.includes(d.id)), afterImport);
  ok("board still 4 after import (no flood)", r.body.total === 4, r.body.total);

  // ── 4. Add-to-pipeline is the deliberate act that puts a donor on the board ─
  const fresh1 = freshRows.find(d => d.id && true) && (await q(`SELECT id FROM donors WHERE org_id=$1 AND email='fresh1@pl.local'`, [TEAM]))[0].id;
  r = await api("POST", "/pipeline/add", A, { ids: [fresh1] });
  ok("add-to-pipeline 200", r.status === 200 && r.body.added === 1, r.body);
  const added = await q(`SELECT assigned_to FROM donors WHERE id=$1`, [fresh1]);
  ok("add-to-pipeline assigns the donor to the caller (assignment = membership)", added[0].assigned_to === "u_pl_a", added[0]);
  r = await api("GET", "/pipeline", A);
  ok("added donor appears on my board", boardIds(r.body).includes(fresh1), boardIds(r.body));

  // ── 5. Assign (bulk) also puts a donor on the board ──────────────────────
  r = await api("PATCH", "/donors/bulk-assign", A, { ids: ["pl_imp3"], assignedTo: "u_pl_b" });
  ok("bulk-assign 200", r.status === 200, r.body);
  const assigned = await q(`SELECT assigned_to FROM donors WHERE id='pl_imp3'`);
  ok("assigning an officer puts a formerly-Directory-only donor on the board", assigned[0].assigned_to === "u_pl_b", assigned[0]);
  r = await api("GET", "/pipeline?assignedTo=u_pl_b", A);
  ok("officer filter shows the newly-assigned donor", boardIds(r.body).includes("pl_imp3"), boardIds(r.body));

  // ── 6. Remove takes a donor off the board (stays in Directory) ───────────
  r = await api("POST", "/pipeline/remove", A, { ids: [fresh1] });
  ok("remove 200", r.status === 200 && r.body.removed === 1, r.body);
  const removed = await q(`SELECT assigned_to, deleted_at FROM donors WHERE id=$1`, [fresh1]);
  ok("removed: unassigned (off board), NOT deleted (stays in Directory)", removed[0].assigned_to === null && removed[0].deleted_at === null, removed[0]);
  r = await api("GET", "/pipeline?scope=all", A);
  ok("removed donor gone from board", !boardIds(r.body).includes(fresh1), boardIds(r.body));

  // ── 7. Filters: search / value-band / designation ────────────────────────
  r = await api("GET", "/pipeline?scope=all&search=alice", A);
  ok("search by name", boardIds(r.body).join() === "pl_a1", boardIds(r.body));
  r = await api("GET", "/pipeline?scope=all&minGiving=10000", A);
  const band = boardIds(r.body).sort();
  ok("value band ≥ $10k → only big donors (Alice 25k, Bella 12k)", band.join() === ["pl_a1", "pl_b1"].join(), band);
  r = await api("GET", "/pipeline?scope=all&designation=planned_confirmed", A);
  ok("designation filter", boardIds(r.body).join() === "pl_a1", boardIds(r.body));

  // ── 8. Sort by value / last gift within a column ─────────────────────────
  r = await api("GET", "/pipeline?scope=all&sort=value", A);
  const cultV = (r.body.columns.cultivate || []).map(c => c.donorId);
  ok("sort=value orders cultivate by giving desc (Alice 25k before Aaron 800)", cultV.indexOf("pl_a1") < cultV.indexOf("pl_a2"), cultV);
  r = await api("GET", "/pipeline?scope=all&sort=last_gift", A);
  const cultL = (r.body.columns.cultivate || []).map(c => c.donorId);
  ok("sort=last_gift orders by recency (Alice 10d before Aaron 400d)", cultL.indexOf("pl_a1") < cultL.indexOf("pl_a2"), cultL);

  // ── 9. Per-column counts present ─────────────────────────────────────────
  r = await api("GET", "/pipeline?scope=all", A);
  ok("counts present per stage", r.body.counts && typeof r.body.counts.cultivate === "number", r.body.counts);
  ok("cultivate count matches column length", r.body.counts.cultivate === (r.body.columns.cultivate || []).length, { c: r.body.counts.cultivate });

  // ── 10. Core-graceful locked preview (own portfolio data, still locked) ─
  r = await api("GET", "/pipeline", C);
  ok("core board locked but previews own portfolio", r.status === 200 && r.body.locked === true && boardIds(r.body).includes("plc_1"), r.body);

  // ── 11. Gating on the write routes ───────────────────────────────────────
  r = await api("POST", "/pipeline/add", C, { ids: ["plc_1"] });
  ok("Core add-to-pipeline → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("POST", "/pipeline/add", RUSER, { ids: ["plr_1"] });
  ok("Team read_only add-to-pipeline → 402", r.status === 402, r.body);
  r = await api("POST", "/pipeline/add", A, { ids: [] });
  ok("empty ids → 400", r.status === 400, r.body);

  // ── 12. Org isolation ────────────────────────────────────────────────────
  r = await api("POST", "/pipeline/add", A, { ids: ["plt2_1"] });
  ok("cannot add a foreign org's donor (404)", r.status === 404, r.body);
  const foreign = await q(`SELECT assigned_to FROM donors WHERE id='plt2_1'`);
  ok("foreign donor unchanged (still assigned to its own org's officer)", foreign[0].assigned_to === "u_plt2", foreign[0]);
  r = await api("GET", "/pipeline?scope=all", T2U);
  ok("t2 board only its own donor", boardIds(r.body).join() === "plt2_1", boardIds(r.body));

  // ── 13. Cross-officer visibility is ADMIN-only (BUILD-31 Part 4) ──────────
  // Admin A can see all portfolios; a non-admin officer (B) is scoped to their
  // OWN, server-enforced — scope=all and a foreign assignedTo are downgraded.
  // (By now pl_imp3 was bulk-assigned to B in section 5, so B owns pl_b1 + pl_imp3.)
  r = await api("GET", "/pipeline?scope=all", A);
  ok("admin: canViewAll true", r.body.canViewAll === true, r.body.canViewAll);
  ok("admin scope=all sees every assigned portfolio", boardIds(r.body).sort().join() === ["pl_a1", "pl_a2", "pl_b1", "pl_imp3", "pl_u1"].sort().join(), boardIds(r.body));
  const bOwn = ["pl_b1", "pl_imp3"].sort().join();
  r = await api("GET", "/pipeline?scope=all", B);
  ok("officer (non-admin): canViewAll false", r.body.canViewAll === false, r.body.canViewAll);
  ok("officer scope=all DOWNGRADED to own portfolio (server-enforced, not just hidden)", r.body.scope === "mine" && boardIds(r.body).sort().join() === bOwn, { scope: r.body.scope, ids: boardIds(r.body) });
  ok("officer scope=all excludes A's donors", !boardIds(r.body).includes("pl_a1") && !boardIds(r.body).includes("pl_u1"), boardIds(r.body));
  r = await api("GET", "/pipeline?assignedTo=u_pl_a", B);
  ok("officer cannot peek at another officer's portfolio via assignedTo", boardIds(r.body).sort().join() === bOwn, boardIds(r.body));

  // ── 14. multiOfficer drives hiding the My/All toggle (BUILD-32 Part 4) ─────
  // The toggle is meaningless in a single-officer org. TEAM has 2 officers with
  // assigned pipeline donors (A + B) → multiOfficer true; CORE has 1 → false.
  r = await api("GET", "/pipeline?scope=all", A);
  ok("TEAM board: multiOfficer true (2 officers with assigned donors → toggle shown)", r.body.multiOfficer === true, r.body.multiOfficer);
  const cAdmin = await login("c-admin@pl.local");
  r = await api("GET", "/pipeline", cAdmin);
  ok("CORE board: multiOfficer false (single officer → toggle hidden)", r.body.multiOfficer === false, r.body.multiOfficer);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
