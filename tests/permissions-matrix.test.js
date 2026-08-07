// BUILD-44 Part 4 — the permissions matrix. TESTS ONLY.
//
// Role × mutating route × plan tier × subscription state, asserted as a
// DATA TABLE so a new route added without a row here is a review question,
// not a silent hole. Four callers:
//   teamStaff   — staff user, Team org, active
//   teamAdmin   — admin user, Team org, active
//   coreAdmin   — admin user, CORE org, active  (Team features must 403
//                 plan_required by DIRECT API CALL — not just hidden UI)
//   roAdmin     — admin user, Team org, trial_expired (read_only: writes 402,
//                 reads and exports stay open — the data-hostage rule)
// Legend: 2xx = allowed · 403 = role/plan rejection · 402 = read_only ·
//         "open" = any 2xx.
//
// The UI-affordance half of Part 4 (a staff user sees no admin controls) is
// covered for the donor profile + directory in scripts/build41-capture.js's
// isAdmin gates and by locked-features.test.js's source asserts; a dedicated
// browser affordance sweep is listed in FINDINGS as remaining work.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const T_ORG = "org_pm44_team", C_ORG = "org_pm44_core", R_ORG = "org_pm44_ro";
const TODAY = new Date().toISOString().slice(0, 10);

async function mkOrg(id, plan, status) {
  for (const t of ["notification_sends", "workflow_runs", "workflows", "opportunities", "moves", "pledges", "tasks",
    "interactions", "fin_transactions", "fin_accounts", "accounts", "fin_funds", "gifts", "grants", "campaigns", "donors", "users", "invites"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status)
           VALUES ($1,$2,$3,1,$4,$5)`, [id, "PM44 " + id, "pm44-" + id.slice(-4), plan, status]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'PM Admin','admin')`,
    [`u_${id}_a`, id, `${id}-admin@example.org`, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'PM Staff','staff')`,
    [`u_${id}_s`, id, `${id}-staff@example.org`, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count)
           VALUES ($1,$2,'PM Donor',$3,'active','cultivate',0,0)`, [`d_${id}`, id, `${id}-donor@example.org`]);
  return { admin: await login(`${id}-admin@example.org`), staff: await login(`${id}-staff@example.org`) };
}

(async () => {
  const team = await mkOrg(T_ORG, "team", "active");
  const core = await mkOrg(C_ORG, "core", "active");
  const ro = await mkOrg(R_ORG, "team", "trial_expired");

  const callers = {
    teamStaff: { token: team.staff, org: T_ORG },
    teamAdmin: { token: team.admin, org: T_ORG },
    coreAdmin: { token: core.admin, org: C_ORG },
    roAdmin: { token: ro.admin, org: R_ORG },
  };
  const donor = org => `d_${org}`;

  // expected status per caller; "open" = any 2xx. Each row is ONE contract.
  const MATRIX = [
    // ── core CRM writes: role-free, but read_only orgs get 402 ──
    { name: "create donor", m: "POST", p: () => "/donors", b: () => ({ name: "Mx", email: "mx@x.org" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "log gift", m: "POST", p: o => `/donors/${donor(o)}/gifts`, b: () => ({ amount: 50, date: TODAY, type: "one-time" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "create task", m: "POST", p: () => "/tasks", b: () => ({ title: "pm44", due: TODAY, priority: "low" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "create campaign goal", m: "POST", p: () => "/fundraising/campaigns", b: (o, i) => ({ name: "PM44 " + i, goalAmount: 1000 }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "create grant", m: "POST", p: () => "/grants", b: () => ({ funder: "PM44 Fdn", amount: 1000, status: "prospecting" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "record pledge", m: "POST", p: o => `/donors/${donor(o)}/pledges`, b: () => ({ amount: 100, dueDate: "2026-12-01" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },

    // ── the major-gifts LAYER is Team: Core must be rejected SERVER-SIDE ──
    // (distinct target stages per caller — the two Team callers share a donor)
    { name: "pipeline move", m: "POST", p: o => `/pipeline/${donor(o)}/move`, b: (o, i, ctx, caller) => ({ toStage: caller === "teamAdmin" ? "qualify" : "solicit", description: "pm44" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: 403, roAdmin: 402 } },
    { name: "log ask (opportunity)", m: "POST", p: o => `/donors/${donor(o)}/opportunities`, b: () => ({ name: "PM Ask", targetAmount: 500 }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: 403, roAdmin: 402 } },
    // FINDINGS F-4: these three carry requirePlan("team") but NO
    // checkWriteAccess — a READ_ONLY (lapsed/trial-expired) Team org can
    // still reassign owners, bulk-change stages, and run wealth scoring.
    // Expected 402; encoded as the CURRENT "open" so the matrix is the
    // reviewed record of the hole. Fix = one middleware per route, post-review.
    { name: "assign owner (admin-gated per BUILD-31 oversight model)", m: "PATCH", p: o => `/donors/${donor(o)}/assign`, b: o => ({ assignedTo: `u_${o}_s` }),
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: 403, roAdmin: "open" } },
    { name: "bulk stage", m: "PATCH", p: () => "/donors/bulk-stage", b: o => ({ ids: [donor(o)], stage: "steward" }),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: 403, roAdmin: "open" } },
    { name: "wealth score", m: "POST", p: o => `/donors/${donor(o)}/score`, b: () => ({}),
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: 403, roAdmin: "open" } },

    // ── admin-only org surface: staff must be rejected server-side ──
    { name: "org branding", m: "PUT", p: () => "/orgs/branding", b: () => ({ brandAccent: "#8a3a24" }),
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "workflow toggle", m: "PUT", p: (o, i, ctx) => `/workflows/${ctx.wf[o]}`, b: () => ({ enabled: false }),
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: "open", roAdmin: 402 } },
    { name: "invite teammate", m: "POST", p: () => "/auth/invite", b: (o, i) => ({ email: `pm44-inv-${o}-${i}@example.org`, role: "staff" }),
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } }, // NB: invite is requireAdmin but NOT checkWriteAccess — encoded as found; FINDINGS F-5
    { name: "run digests", m: "POST", p: () => "/digests/run", b: () => ({ dryRun: true }),
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } }, // ops hook: admin-gated, not write-gated (reads+composes)
    { name: "delete donor", m: "DELETE", p: o => `/donors/${donor(o)}`, b: () => undefined,
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } }, // DELETE routes are never write-gated (deliberate convention)

    // ── reads + the data-hostage rule: ALWAYS open, even read_only ──
    { name: "read reports", m: "GET", p: () => "/reports/giving-summary?year=2026&yearMode=fiscal", b: () => undefined,
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } },
    { name: "read finance", m: "GET", p: () => "/finance/summary", b: () => undefined,
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } },
    { name: "export JSON", m: "GET", p: () => "/org/export", b: () => undefined,
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } },
    { name: "export CSV zip (admin)", m: "GET", p: () => "/org/export/csv", b: () => undefined,
      exp: { teamStaff: 403, teamAdmin: "open", coreAdmin: "open", roAdmin: "open" } },
    { name: "solicitations CSV (Team artifact)", m: "GET", p: () => "/reports/solicitations?format=csv", b: () => undefined,
      exp: { teamStaff: "open", teamAdmin: "open", coreAdmin: 403, roAdmin: "open" } }, // Core may LOOK (JSON locked) but not pull the artifact
  ];

  // workflow ids per org (provision lazily via GET)
  const ctx = { wf: {} };
  for (const [name, c] of Object.entries(callers)) {
    const wf = await api("GET", "/workflows", c.token);
    const list = wf.body.workflows || wf.body || [];
    ctx.wf[c.org] = list[0]?.id;
  }

  let i = 0;
  for (const row of MATRIX) {
    i++;
    for (const [callerName, expRaw] of Object.entries(row.exp)) {
      const c = callers[callerName];
      const r = await api(row.m, row.p(c.org, i, ctx, callerName), c.token, row.b ? row.b(c.org, i, ctx, callerName) : undefined);
      const pass = expRaw === "open" ? r.status >= 200 && r.status < 300 : r.status === expRaw;
      ok(`${row.name} — ${callerName} → ${expRaw === "open" ? "allowed" : expRaw}`, pass, { got: r.status, body: JSON.stringify(r.body).slice(0, 90) });
    }
  }

  // tenant isolation spot check inside the matrix run: a Team admin cannot
  // mutate another org's donor through the SAME routes
  {
    const r = await api("PATCH", `/donors/${donor(C_ORG)}/assign`, callers.teamAdmin.token, { assignedTo: `u_${T_ORG}_s` });
    ok("cross-org assign → 404 (no leak, no side effect)", r.status === 404, r.status);
    const r2 = await api("POST", `/donors/${donor(C_ORG)}/gifts`, callers.teamAdmin.token, { amount: 10, date: TODAY, type: "one-time" });
    ok("cross-org gift → 404", r2.status === 404, r2.status);
  }

  summary();
})().catch(e => { console.error(e); process.exit(1); });
