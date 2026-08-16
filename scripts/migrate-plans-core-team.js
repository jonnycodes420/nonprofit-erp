#!/usr/bin/env node
// BUILD-55: defaults to the LOCAL scratch stack. Running against prod now requires
// BOTH an explicit BASE= AND --i-know-this-is-prod (see scripts/lib/prodGuard.js).
// BUILD-24 — map any existing orgs off the legacy seed/growth/impact plan enum
// onto the Core/Team commercial model. seed → core; growth/impact → team.
//
// The tier a legacy org gets is UNCHANGED by this (orgPlanTier already treats
// growth/impact as team and seed as core) — this only renames the stored plan
// so the admin dashboard, MRR, and PlanPicker all speak one vocabulary. Pre-
// cutover this is likely just your own/test orgs.
//
// SAFE BY DEFAULT: dry-run unless --apply. Prints (export-first) every org it
// would change before changing anything. Uses the authenticated super-admin API
// (POST /admin/orgs/:id/change-plan) — no direct DB writes. Idempotent (an org
// already on core/team is skipped).
//
// Usage:
//   BASE=… SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… node scripts/migrate-plans-core-team.js
//   … --apply

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const EMAIL = process.env.SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPERADMIN_PASSWORD;
const APPLY = process.argv.includes("--apply");
const MAP = { seed: "core", growth: "team", impact: "team" };

if (!EMAIL || !PASSWORD) { console.error("Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD."); process.exit(1); }

async function j(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let p = t; try { p = JSON.parse(t); } catch {}
  return { status: r.status, body: p };
}

(async () => {
  const login = await j("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  if (!login.body?.token) { console.error("Login failed:", login.body); process.exit(1); }
  if (!login.body.user?.isSuperAdmin) { console.error("This account is not a super admin."); process.exit(1); }
  const token = login.body.token;

  const orgs = await j("GET", "/admin/orgs", token);
  const list = Array.isArray(orgs.body) ? orgs.body : (orgs.body?.orgs || []);
  // Only remap ACTIVE legacy orgs: change-plan forces status=active, so touching
  // a lapsed/past_due org would wrongly reactivate it. A lapsed legacy org keeps
  // resolving to the right tier via orgPlanTier regardless of the stored string,
  // so leaving it is safe. (Trialing orgs are plan='trial' → not in the map.)
  const targets = list.filter(o => MAP[o.plan] && o.subscription_status === "active");

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"} · ${targets.length} org(s) to remap\n`);
  for (const o of targets) console.log(`  ${o.id}  ${o.name}  ${o.plan} → ${MAP[o.plan]}  (status ${o.subscription_status})`);
  if (!targets.length) { console.log("Nothing to migrate."); return; }

  if (!APPLY) { console.log("\nDry run — re-run with --apply to change these."); return; }

  console.log("");
  for (const o of targets) {
    const r = await j("POST", `/admin/orgs/${o.id}/change-plan`, token, { plan: MAP[o.plan] });
    console.log(`  ${r.status === 200 ? "OK  " : "ERR "} ${o.id} → ${MAP[o.plan]}${r.status !== 200 ? " " + JSON.stringify(r.body) : ""}`);
  }
  console.log("\nDone.");
})().catch(e => { console.error("Failed:", e.message); process.exit(1); });
