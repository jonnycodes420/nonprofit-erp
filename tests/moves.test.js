// BUILD-15 — Moves management & prospect pipeline (Team plan).
// Local scratch server + Postgres (tests/README.md recipe).
//
// Covers: every pipeline stage change writes a MOVE (date/officer/from→to +
// required description) and updates donors.stage; move-history integrity;
// ask-vs-gift tracking incl. close-to-gift linkage; pipeline forecast math
// (raw + stage-weighted); portfolio + designation + officer-color filters;
// requirePlan('team') gating (Core → 403, Team read_only → 402); single-officer
// grace; officer-activity aggregation; and two-way org isolation.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

// Must mirror server.js STAGE_WEIGHT.
const STAGE_WEIGHT = { prospect: 0.1, qualify: 0.2, cultivate: 0.4, solicit: 0.7, steward: 0.9, lapsed: 0.05 };

const TEAM = "org_mv_team", CORE = "org_mv_core", RO = "org_mv_ro", SOLO = "org_mv_solo", T2 = "org_mv_t2";
const today = new Date().toISOString().slice(0, 10);

async function reset() {
  for (const org of [TEAM, CORE, RO, SOLO, T2]) {
    for (const t of ["moves", "opportunities", "donor_designations", "sequence_enrollments", "sequences", "interactions", "gifts", "tasks", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, subStatus, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`,
    [o, `MV ${tag}`, `mv-${tag}`, subStatus, plan]);
}
async function seedUser(o, id, tag, role = "admin", color = null) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,portfolio_color) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, o, `${tag}@mv.local`, hash, `User ${tag}`, role, color]);
}
async function seedDonor(o, id, name, stage, owner, ownerName, total) {
  // in_pipeline=true: these are deliberately-worked prospects (the pipeline is a
  // curated portfolio now — a donor must be added/assigned to appear on the board).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name,in_pipeline)
           VALUES ($1,$2,$3,$4,'mid',$5,$6,1,$7,$8,$9,true)`,
    [id, o, name, `${id}@mv.local`, stage, total, today, owner, ownerName]);
}
async function seedDesignation(o, donorId, kind) {
  await q(`INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    ["dsg_" + Math.random().toString(36).slice(2, 8), o, donorId, kind]);
}

(async () => {
  await reset();
  // TEAM org: growth/active, two officers (admin coloured), donors across stages.
  await seedOrg(TEAM, "growth", "active", "team");
  await seedUser(TEAM, "u_mv_admin", "admin", "admin", "#1a6b4a");
  await seedUser(TEAM, "u_mv_off2", "off2", "staff", "#c9a84c");
  await seedDonor(TEAM, "mv_d1", "Prospect One", "prospect", "u_mv_admin", "User admin", 0);
  await seedDonor(TEAM, "mv_d2", "Cultivate Two", "cultivate", "u_mv_off2", "User off2", 5000);
  await seedDonor(TEAM, "mv_d3", "Solicit Three", "solicit", "u_mv_admin", "User admin", 20000);
  await seedDesignation(TEAM, "mv_d3", "planned_confirmed");
  // CORE org: seed/active.
  await seedOrg(CORE, "seed", "active", "core");
  await seedUser(CORE, "u_mvc_admin", "coreadmin", "admin");
  await seedDonor(CORE, "mv_c1", "Core Donor", "prospect", "u_mvc_admin", "User coreadmin", 0);
  // RO team org: growth but trial_expired (read_only, still team-tier).
  await seedOrg(RO, "growth", "trial_expired", "ro");
  await seedUser(RO, "u_mvro_admin", "roadmin", "admin");
  await seedDonor(RO, "mv_r1", "RO Donor", "prospect", "u_mvro_admin", "User roadmin", 0);
  // SOLO team org: single user.
  await seedOrg(SOLO, "growth", "active", "solo");
  await seedUser(SOLO, "u_solo", "solo", "admin");
  // TEAM2 org for isolation.
  await seedOrg(T2, "growth", "active", "t2");
  await seedUser(T2, "u_mvt2_admin", "t2admin", "admin");
  await seedDonor(T2, "mv_t2d1", "Foreign Donor", "prospect", "u_mvt2_admin", "User t2admin", 0);

  const admin = await login("admin@mv.local");
  const off2 = await login("off2@mv.local");
  const coreAdmin = await login("coreadmin@mv.local");
  const roAdmin = await login("roadmin@mv.local");
  const solo = await login("solo@mv.local");
  const t2Admin = await login("t2admin@mv.local");

  // ── Board read + gating ────────────────────────────────────────────────
  let r = await api("GET", "/pipeline", admin);
  ok("team board unlocked", r.status === 200 && r.body.tier === "team" && r.body.locked === false, r.body);
  ok("board groups donors by stage", (r.body.columns.prospect || []).some(c => c.donorId === "mv_d1")
    && (r.body.columns.solicit || []).some(c => c.donorId === "mv_d3"), r.body.columns);
  ok("officers carry colour", r.body.officers.find(o => o.id === "u_mv_admin")?.color === "#1a6b4a", r.body.officers);
  ok("single_user false for 2-officer org", r.body.single_user === false, r.body.single_user);

  r = await api("GET", "/pipeline", coreAdmin);
  ok("core board locked (graceful, not 403)", r.status === 200 && r.body.tier === "core" && r.body.locked === true, r.body);
  // BUILD-20 Part 4: the Core board is a READ-only locked preview populated with
  // the org's OWN data (columns present) — writes stay 403-gated below.
  ok("core locked board previews own data (columns populated)", (r.body.columns.prospect || []).some(c => c.donorId === "mv_c1"), r.body.columns);

  r = await api("GET", "/pipeline", solo);
  ok("solo team org single_user grace", r.status === 200 && r.body.single_user === true, r.body.single_user);

  // ── A move writes a move row + updates stage ────────────────────────────
  r = await api("POST", "/pipeline/mv_d1/move", admin, { toStage: "qualify", description: "Great intro call — capacity confirmed." });
  ok("move succeeds", r.status === 201 && r.body.stage === "qualify" && r.body.fromStage === "prospect", r.body);
  r = await api("GET", "/donors/mv_d1/moves", admin);
  ok("move history records one move", Array.isArray(r.body) && r.body.length === 1, r.body);
  const mv = r.body[0];
  ok("move has officer/from/to/description", mv.officer_id === "u_mv_admin" && mv.officer_name === "User admin"
    && mv.from_stage === "prospect" && mv.to_stage === "qualify"
    && mv.description === "Great intro call — capacity confirmed." && !!mv.created_at, mv);
  r = await api("GET", "/pipeline", admin);
  ok("stage change reflected on board", (r.body.columns.qualify || []).some(c => c.donorId === "mv_d1")
    && !(r.body.columns.prospect || []).some(c => c.donorId === "mv_d1"), r.body.columns);
  // stage_change interaction logged for the timeline
  const ints = await q(`SELECT * FROM interactions WHERE donor_id='mv_d1' AND type='stage_change'`);
  ok("move also logs a stage_change interaction", ints.length === 1 && /qualify/.test(ints[0].note), ints);

  // ── Move validation ─────────────────────────────────────────────────────
  r = await api("POST", "/pipeline/mv_d1/move", admin, { toStage: "cultivate", description: "" });
  ok("move requires a description (400)", r.status === 400, r.body);
  r = await api("POST", "/pipeline/mv_d1/move", admin, { toStage: "qualify", description: "no-op" });
  ok("same-stage move rejected (400)", r.status === 400, r.body);
  r = await api("POST", "/pipeline/mv_d1/move", admin, { toStage: "bogus", description: "x" });
  ok("invalid stage rejected (400)", r.status === 400, r.body);

  // ── Plan gating on moves ────────────────────────────────────────────────
  r = await api("POST", "/pipeline/mv_c1/move", coreAdmin, { toStage: "qualify", description: "x" });
  ok("Core org move → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("POST", "/pipeline/mv_r1/move", roAdmin, { toStage: "qualify", description: "x" });
  ok("Team read_only move → 402 (plan passes, write gated)", r.status === 402, r.body);

  // ── Opportunities: ask vs gift ──────────────────────────────────────────
  r = await api("POST", "/donors/mv_d3/opportunities", admin, { name: "2026 Major Ask", targetAmount: 50000, expectedClose: "2026-09-30" });
  ok("create ask on prospect", r.status === 201 && r.body.status === "open" && Number(r.body.target_amount) === 50000, r.body);
  const oppId = r.body.id;
  ok("ask officer = donor owner", r.body.officer_id === "u_mv_admin", r.body);
  r = await api("POST", "/donors/mv_d2/opportunities", off2, { name: "Cultivation Ask", targetAmount: 10000 });
  ok("second officer creates ask", r.status === 201, r.body);
  const opp2 = r.body.id;

  r = await api("POST", "/donors/mv_d3/opportunities", admin, { targetAmount: -5 });
  ok("non-positive ask rejected (400)", r.status === 400, r.body);
  r = await api("POST", "/donors/mv_c1/opportunities", coreAdmin, { targetAmount: 1000 });
  ok("Core ask → 403 plan_required", r.status === 403, r.body);

  // ── Forecast math (raw + stage-weighted, self-consistent with board) ────
  // scope=all: forecast spans BOTH officers' portfolios (the default board is
  // now the caller's own portfolio; the whole-shop view is scope=all).
  r = await api("GET", "/pipeline?scope=all", admin);
  const cards = Object.values(r.body.columns).flat();
  const expectOpen = cards.reduce((s, c) => s + c.askAmount, 0);
  const expectWeighted = Math.round(cards.reduce((s, c) => s + c.askAmount * (STAGE_WEIGHT[c.stage] || 0), 0));
  ok("forecast.open = Σ open asks on board", r.body.forecast.open === Math.round(expectOpen) && expectOpen === 60000, r.body.forecast);
  ok("forecast.weighted = Σ ask × stage weight", r.body.forecast.weighted === expectWeighted, { got: r.body.forecast.weighted, expected: expectWeighted });
  ok("forecast.openCount counts open asks", r.body.forecast.openCount === 2, r.body.forecast);

  // ── Close won: link real gift + record actual gift amount ───────────────
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ($1,$2,$3,$4,$5)`,
    ["g_mv_1", TEAM, "mv_d3", 42500, today]);
  r = await api("PUT", `/opportunities/${oppId}`, admin, { status: "won", giftId: "g_mv_1" });
  ok("close won links gift + records actual amount", r.status === 200 && r.body.status === "won"
    && r.body.gift_id === "g_mv_1" && Number(r.body.gift_amount) === 42500 && !!r.body.closed_at, r.body);
  ok("ask ≠ gift preserved (asked 50k, closed 42.5k)", Number(r.body.target_amount) === 50000 && Number(r.body.gift_amount) === 42500, r.body);
  r = await api("GET", "/pipeline?scope=all", admin);
  ok("won ask leaves open forecast", r.body.forecast.open === 10000 && r.body.forecast.openCount === 1, r.body.forecast);
  ok("won ask counts toward wonThisPeriod", r.body.forecast.wonThisPeriod === 42500 && r.body.forecast.wonCount === 1, r.body.forecast);

  // Close lost + reopen
  r = await api("PUT", `/opportunities/${opp2}`, off2, { status: "lost" });
  ok("close lost", r.status === 200 && r.body.status === "lost" && r.body.gift_id === null, r.body);
  r = await api("GET", "/pipeline?scope=all", admin);
  ok("lost ask drops from forecast", r.body.forecast.open === 0 && r.body.forecast.openCount === 0, r.body.forecast);
  r = await api("PUT", `/opportunities/${opp2}`, off2, { status: "open" });
  ok("reopen restores open ask", r.status === 200 && r.body.status === "open" && r.body.closed_at === null, r.body);

  // won-by-amount (no gift row) path
  r = await api("POST", "/donors/mv_d2/opportunities", off2, { name: "Quick close", targetAmount: 8000 });
  const opp3 = r.body.id;
  r = await api("PUT", `/opportunities/${opp3}`, off2, { status: "won", giftAmount: 7500 });
  ok("close won by amount only (no gift row)", r.status === 200 && Number(r.body.gift_amount) === 7500 && r.body.gift_id === null, r.body);

  // ── Filters: portfolio + designation ────────────────────────────────────
  r = await api("GET", "/pipeline?assignedTo=u_mv_off2", admin);
  const filtered = Object.values(r.body.columns).flat();
  ok("portfolio filter → only that officer's donors", filtered.length > 0 && filtered.every(c => c.assignedTo === "u_mv_off2"), filtered.map(c => c.assignedTo));
  r = await api("GET", "/pipeline?designation=planned_confirmed", admin);
  const desg = Object.values(r.body.columns).flat();
  ok("designation filter → only tagged donors", desg.length === 1 && desg[0].donorId === "mv_d3", desg);

  // ── Officer activity aggregation (feeds BUILD-17) ───────────────────────
  r = await api("GET", "/pipeline/officer-activity", admin);
  const adminAct = r.body.officers.find(o => o.officerId === "u_mv_admin");
  const off2Act = r.body.officers.find(o => o.officerId === "u_mv_off2");
  ok("officer-activity: admin move counted", adminAct.movesMade === 1, adminAct);
  ok("officer-activity: admin ask + won recorded", adminAct.asksMade === 1 && adminAct.giftsClosed === 1 && adminAct.giftsAmount === 42500, adminAct);
  ok("officer-activity: off2 asks + won recorded", off2Act.asksMade >= 2 && off2Act.giftsClosed === 1 && off2Act.giftsAmount === 7500, off2Act);

  // ── DELETE opportunity (ungated) ────────────────────────────────────────
  r = await api("DELETE", `/opportunities/${opp3}`, admin);
  ok("delete opportunity ungated", r.status === 200, r.body);
  r = await api("GET", "/donors/mv_d2/opportunities", admin);
  ok("deleted opp gone", !r.body.some(o => o.id === opp3), r.body);

  // ── Org isolation (two-way) ─────────────────────────────────────────────
  r = await api("POST", "/pipeline/mv_t2d1/move", admin, { toStage: "qualify", description: "cross-org" });
  ok("cannot move a foreign org's donor (404)", r.status === 404, r.body);
  r = await api("GET", "/donors/mv_t2d1/moves", admin);
  ok("cannot read a foreign donor's moves (404)", r.status === 404, r.body);
  r = await api("POST", "/donors/mv_t2d1/opportunities", admin, { targetAmount: 100 });
  ok("cannot add an ask to a foreign donor (404)", r.status === 404, r.body);
  const foreignOppRows = await q(`SELECT id FROM opportunities WHERE donor_id='mv_t2d1'`);
  ok("no foreign ask row planted", foreignOppRows.length === 0, foreignOppRows);
  r = await api("GET", "/pipeline", t2Admin);
  const t2cards = Object.values(r.body.columns).flat();
  ok("team2 board only shows its own donors", t2cards.every(c => c.donorId === "mv_t2d1"), t2cards.map(c => c.donorId));

  // ── Donor-profile Core/Team split (FIX) ─────────────────────────────────
  // The major-gifts LAYER on the donor profile is Team: move stage (single +
  // bulk), reassign owner (single + bulk), wealth score, and sequence enroll
  // all 403 for Core (requirePlan('team')); Team succeeds. The READS that feed
  // the locked previews (moves/opportunities/suggestions) stay visible for Core
  // so it sees its own data behind the frosted glass (BUILD-19/20 guardrail).
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status) VALUES ($1,$2,$3,'manual','active') ON CONFLICT DO NOTHING`, ["seq_mv_team", TEAM, "Team Seq"]);
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status) VALUES ($1,$2,$3,'manual','active') ON CONFLICT DO NOTHING`, ["seq_mv_core", CORE, "Core Seq"]);

  r = await api("PATCH", "/donors/mv_c1/stage", coreAdmin, { stage: "qualify" });
  ok("Core single-stage move → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("PATCH", "/donors/mv_d1/stage", admin, { stage: "qualify" });
  ok("Team single-stage move → 200", r.status === 200, r.body);

  r = await api("PATCH", "/donors/bulk-stage", coreAdmin, { ids: ["mv_c1"], stage: "cultivate" });
  ok("Core bulk-stage → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("PATCH", "/donors/bulk-stage", admin, { ids: ["mv_d1"], stage: "cultivate" });
  ok("Team bulk-stage → 200", r.status === 200, r.body);

  r = await api("PATCH", "/donors/mv_c1/assign", coreAdmin, { assignedTo: "u_mvc_admin", assignedToName: "User coreadmin" });
  ok("Core reassign → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("PATCH", "/donors/mv_d1/assign", admin, { assignedTo: "u_mv_off2", assignedToName: "User off2" });
  ok("Team reassign → 200", r.status === 200, r.body);

  r = await api("PATCH", "/donors/bulk-assign", coreAdmin, { ids: ["mv_c1"], assignedTo: "u_mvc_admin" });
  ok("Core bulk-assign → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("PATCH", "/donors/bulk-assign", admin, { ids: ["mv_d1"], assignedTo: "u_mv_admin" });
  ok("Team bulk-assign → 200", r.status === 200, r.body);

  r = await api("POST", "/donors/mv_c1/score", coreAdmin);
  ok("Core wealth-score compute → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("POST", "/donors/mv_d1/score", admin);
  ok("Team wealth-score compute → 200", r.status === 200 && typeof r.body.wealthScore !== "undefined", r.body);

  r = await api("POST", "/sequences/seq_mv_core/enroll", coreAdmin, { donorId: "mv_c1" });
  ok("Core sequence enroll → 403 plan_required", r.status === 403 && r.body.error === "plan_required", r.body);
  r = await api("POST", "/sequences/seq_mv_team/enroll", admin, { donorId: "mv_d1" });
  ok("Team sequence enroll → 200", r.status === 200, r.body);

  // Reads powering the locked previews stay OPEN for Core (visible behind glass).
  r = await api("GET", "/donors/mv_c1/moves", coreAdmin);
  ok("Core CAN read moves (locked-preview data visible)", r.status === 200 && Array.isArray(r.body), r.body);
  r = await api("GET", "/donors/mv_c1/opportunities", coreAdmin);
  ok("Core CAN read opportunities (locked-preview data visible)", r.status === 200 && Array.isArray(r.body), r.body);
  r = await api("GET", "/donors/mv_c1/move-suggestions", coreAdmin);
  ok("Core CAN read move-suggestions (locked-preview data visible)", r.status === 200, r.body);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
