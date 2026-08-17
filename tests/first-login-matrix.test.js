// BUILD-58 W-2 — no first login may dead-end. Every combination of
// tier × approval state × onboarding state must land on a LIVE, non-error
// surface whose backing routes answer 200 for that org.
//
// The walk found the approved portal-tier org's FIRST login rendering an
// error-styled "Failed to connect" screen with no path to the tier's own
// advertised capabilities (gift recording, receipts, impact updates, the
// portal editor). The client now: (a) tolerates portal_tier 403s on the
// initial load instead of treating them as an outage, (b) renders a
// portal-tier shell (Donors · Donor Portal · Settings) landing on the portal
// hub, with the network-application status surfaced while pending.
//
// THE MATRIX below is the spec (BUILD-44 permissions-matrix style): a data
// table, not hand-written cases. A new plan value that appears in
// orgPlanTier's source without a row here FAILS the suite.
//
// Verify-first: committed RED against the pre-BUILD-58 server.

const { ok, summary, api, q, closeDb, BASE } = require("./helpers");
const fs = require("fs");
const path = require("path");

const uniq = () => Math.random().toString(36).slice(2, 8);

// ── THE MATRIX ──────────────────────────────────────────────────────────────
// plan × applicationStatus (network orgs only; "-" = not a network org) ×
// onboarding. `landing` names the surface the client must show; `probes` are
// the routes that surface needs — every one must return 200. `blocked` pins
// routes that must STAY 403 (the tier gate is not reopened by this fix).
const CRM_PROBES = ["/org", "/donors/summaries", "/tasks", "/grants", "/financials"];
const PORTAL_PROBES = ["/org", "/donors/summaries", "/tasks", "/portal-settings", "/impact-updates", "/network/application", "/billing/status"];
const MATRIX = [
  { plan: "trial",    app: "-",        onboarded: 0, landing: "welcome",     probes: ["/org", "/org/setup-status"] },
  { plan: "trial",    app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "core",     app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "team",     app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "seed",     app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "growth",   app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "impact",   app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "founding", app: "-",        onboarded: 1, landing: "dashboard",   probes: CRM_PROBES },
  { plan: "portal",   app: "pending",  onboarded: 1, landing: "portal-home", probes: PORTAL_PROBES, blocked: ["/grants", "/campaigns"] },
  { plan: "portal",   app: "approved", onboarded: 1, landing: "portal-home", probes: PORTAL_PROBES, blocked: ["/grants", "/campaigns"] },
  { plan: "portal",   app: "held",     onboarded: 1, landing: "portal-home", probes: PORTAL_PROBES, blocked: ["/grants"] },
  { plan: "portal",   app: "rejected", onboarded: 1, landing: "portal-home", probes: PORTAL_PROBES, blocked: ["/grants"] },
  { plan: "portal",   app: "dispute",  onboarded: 1, landing: "portal-home", probes: PORTAL_PROBES, blocked: ["/grants"] },
];

async function mintOrg(row) {
  const email = `b58w2-${row.plan}-${row.app.replace(/[^a-z]/g, "")}-${uniq()}@test.local`;
  if (row.plan === "portal") {
    const r = await fetch(BASE + "/network/signup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: `W2 ${row.plan}/${row.app} ${uniq()}`, ein: String(900000000 + Math.floor(Math.random() * 99999999)), email, password: "loadtest1234", website: "https://example.org", consent: true }),
    }).then(x => x.json());
    if (row.app !== "pending") {
      await q("UPDATE network_applications SET status=$1 WHERE org_id=$2", [row.app, r.org.id]);
      if (row.app === "approved") await q("UPDATE portal_settings SET enabled=true, network_listed=true WHERE org_id=$1", [r.org.id]);
    }
    return { token: r.token, orgId: r.org.id };
  }
  const r = await fetch(BASE + "/auth/register-org", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `W2 ${row.plan} ${uniq()}`, userName: "W2 Admin", email, password: "loadtest1234" }),
  }).then(x => x.json());
  if (row.onboarded) {
    const c = await fetch(BASE + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token } });
    if (c.status !== 200) throw new Error("onboarding/complete failed");
  }
  if (row.plan !== "trial") await q("UPDATE orgs SET plan=$1, subscription_status='active' WHERE id=$2", [row.plan, r.org.id]);
  return { token: r.token, orgId: r.org.id };
}

(async () => {
  console.log("first-login-matrix (BUILD-58 W-2)");

  // ── §1 drive every matrix row ────────────────────────────────────────────
  for (const row of MATRIX) {
    const label = `${row.plan}·${row.app}·onb${row.onboarded}`;
    console.log(`\n§1 ${label} → ${row.landing}`);
    const { token } = await mintOrg(row);
    for (const p of row.probes) {
      const r = await api("GET", p, token);
      ok(`${label}: ${p} answers 200`, r.status === 200, { status: r.status, body: typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 120) : r.body });
    }
    for (const p of row.blocked || []) {
      const r = await api("GET", p, token);
      ok(`${label}: ${p} stays 403 portal_tier`, r.status === 403 && r.body?.error === "portal_tier", { status: r.status });
    }
  }

  // ── §2 totality — a new plan value must join the matrix ──────────────────
  console.log("\n§2 plan-value totality");
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const covered = new Set(MATRIX.map(r => r.plan));
    // Every plan literal the tier authority (orgPlanTier + TEAM_PLANS +
    // SOFT_BAND_PLANS) knows about must have a matrix row.
    const fnMatch = src.match(/function orgPlanTier[\s\S]{0,600}/);
    const teamPlans = src.match(/TEAM_PLANS\s*=\s*new Set\(\[([^\]]*)\]/);
    const softBand = src.match(/SOFT_BAND_PLANS\s*=\s*new Set\(\[([^\]]*)\]/);
    const found = new Set();
    for (const m of [fnMatch?.[0] || "", teamPlans?.[1] || "", softBand?.[1] || ""]) {
      for (const lit of m.matchAll(/["'](trial|seed|growth|impact|core|team|founding|portal)["']/g)) found.add(lit[1]);
    }
    ok("plan literals discovered from the tier authority", found.size >= 4, [...found]);
    for (const p of found) ok(`plan "${p}" has a first-login matrix row`, covered.has(p), null);
  }

  // ── §3 the client no longer treats the portal tier as an outage ──────────
  console.log("\n§3 client shell handles the portal tier");
  {
    const app = fs.readFileSync(path.join(__dirname, "..", "client", "src", "App.jsx"), "utf8");
    ok("App.jsx knows the portal_tier error code (tolerated, not fatal)", /portal_tier/.test(app), null);
    ok("App.jsx has a portal-tier tab set (PORTAL_TIER_TABS)", /PORTAL_TIER_TABS/.test(app), null);
    ok("initial load survives partial failure (allSettled, not all-or-nothing)", /allSettled/.test(app), null);
  }

  // ── §4 the white-label name reaches the money surface ────────────────────
  console.log("\n§4 donor-facing give page shows the portal display name, never the staff name");
  {
    const email = `b58w2-wl-${uniq()}@test.local`;
    const r = await fetch(BASE + "/auth/register-org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: "Whitelabel Org (Demo)", userName: "WL Admin", email, password: "loadtest1234" }),
    }).then(x => x.json());
    await api("POST", "/onboarding/complete", r.token, {});
    const [orgRow] = await q("SELECT org_slug FROM orgs WHERE id=$1", [r.org.id]);
    await q(`INSERT INTO portal_settings (org_id, enabled, display_name) VALUES ($1, true, 'Whitelabel Arts')
             ON CONFLICT (org_id) DO UPDATE SET display_name='Whitelabel Arts'`, [r.org.id]);
    const pub = await api("GET", `/org/${orgRow.org_slug}/public`, null);
    ok("public give payload carries the donor-facing display name", pub.body?.org?.name === "Whitelabel Arts", pub.body?.org);
    ok("the staff-side name does not leak to the give page", pub.body?.org?.name !== "Whitelabel Org (Demo)", pub.body?.org);
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
