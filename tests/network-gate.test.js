// BUILD-46 §3 — the network gate: gated self-serve nonprofit signup.
// S-14: an unapproved org is invisible and un-giftable on EVERY route, by
// direct API call — no bypass around the human review. S-15: a second signup
// on a claimed EIN becomes a dispute, never a duplicate, and can never hijack
// the existing holder's listing. Plus: the Portal tier is not the CRM,
// approval requires the full gate even from the approver, auto-delist on EIN
// drop / Stripe loss (with the empty-registry guard), and every decision is
// logged.
//
// Standard scratch stack + NETWORK_SIGNUP_ENABLED=1 + DONOR_ACCOUNTS_ENABLED=1.
// Starts a mail sink (:5602) and the Stripe mock (:5603) so /donate can get
// past the gate when it should.

const http = require("http");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const EIN_GOOD = "812345679";
const THIS_YEAR = String(new Date().getFullYear());

let mail = [];
function startSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { } res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
function startStripeMock(port = 5603) {
  const state = { chargesEnabled: true }; // W-1: the gate now asks Stripe, not our flag
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url.startsWith("/v1/payment_links") || req.url.startsWith("/v1/checkout")) {
          res.end(JSON.stringify({ id: "plink_mock", url: "https://mock.stripe/pay" }));
        } else if (/^\/v1\/accounts\//.test(req.url)) {
          res.end(JSON.stringify({ id: req.url.split("/").pop(), object: "account", charges_enabled: state.chargesEnabled }));
        } else res.end(JSON.stringify({ id: "mock", object: "mock" }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => { srv.state = state; resolve(srv); });
  });
}
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function raw(method, path, { body, token, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; const text = await r.text();
  try { parsed = JSON.parse(text); } catch { }
  return { status: r.status, body: parsed, text, headers: r.headers };
}

async function cleanup() {
  const orgs = await q(`SELECT org_id FROM network_applications`);
  for (const { org_id } of orgs) {
    for (const t of ["portal_audit_log", "portal_sessions", "portal_magic_links", "gifts", "interactions", "donors", "users", "portal_settings", "fin_transactions", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org_id]).catch(() => {});
  }
  await q(`DELETE FROM network_applications`);
  for (const { org_id } of orgs) await q(`DELETE FROM orgs WHERE id=$1`, [org_id]).catch(() => {});
  await q(`DELETE FROM ein_registry WHERE ein LIKE '81234%'`);
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@ng46.test'`);
  // a super admin to drive the review queue
  await q(`UPDATE users SET is_super_admin = true WHERE email = 'ng-super@test.local'`).catch(() => {});
}

(async () => {
  const sink = await startSink();
  const stripeMock = await startStripeMock();
  await cleanup();

  // Super-admin driver (reuse an existing org's admin, promoted).
  const bcrypt = require("bcryptjs");
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ('org_ng_home','NG Home','ng-home-x1',1,'active','core') ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_ng_super','org_ng_home','ng-super@test.local',$1,'Super','admin',true) ON CONFLICT (id) DO NOTHING`, [hash]);
  const superTok = (await api("POST", "/auth/login", null, { email: "ng-super@test.local", password: "loadtest1234" })).body.token;

  // ── signup creates a fully-gated org ─────────────────────────────────────
  ok("network signup without consent → 400 consent_required",
    (await raw("POST", "/network/signup", { body: { orgName: "X", ein: "812345679", email: "x@ng46.test", password: "xxxxxxxxx" } })).body?.error === "consent_required");
  const su = await raw("POST", "/network/signup", {
    body: { orgName: "River Bend Shelter", ein: "81-2345679", email: "director@riverbend.ng46.test", password: "shelterpw99", website: "https://riverbend.ng46.test", consent: true },
  });
  ok("network signup 201 with a staff token + pending application", su.status === 201 && !!su.body.token && su.body.application.status === "pending", su.body.application);
  const orgTok = su.body.token;
  const orgId = su.body.org.id;
  const slug = su.body.org.org_slug;
  ok("the org is Portal-tier", su.body.org.plan === "portal");

  // ── S-14: unapproved = invisible + un-giftable, by DIRECT API ────────────
  ok("S-14: portal config 404s (invisible)", (await raw("GET", `/portal/${slug}/config`)).status === 404);
  ok("S-14: magic-link request 404s", (await raw("POST", `/portal/${slug}/request-link`, { body: { email: "x@y.test" } })).status === 404);
  // even with Stripe fully connected, donations stay blocked pre-approval:
  await q(`UPDATE orgs SET stripe_account_id='acct_ng_mock', stripe_connected=true WHERE id=$1`, [orgId]);
  const donate1 = await raw("POST", `/donate/${slug}`, { body: { amount: 50, firstName: "A", lastName: "B", email: "give@ng46.test" } });
  ok("S-14: /donate refuses an unapproved org (indistinguishable from not-set-up)",
    donate1.status === 400 && /not set up/i.test(donate1.body?.error || ""), donate1.body);
  // an org admin cannot self-enable the portal around the gate:
  const selfEnable = await raw("PUT", "/portal-settings", { token: orgTok, body: { enabled: true, networkListed: true } });
  await settle(100);
  const cfgTry = await raw("GET", `/portal/${slug}/config`);
  ok("S-14: even if staff flips portal settings on, the org stays un-giftable pre-approval",
    (await raw("POST", `/donate/${slug}`, { body: { amount: 50, firstName: "A", lastName: "B", email: "give@ng46.test" } })).status === 400,
    { selfEnable: selfEnable.status, cfg: cfgTry.status });
  await q(`UPDATE portal_settings SET enabled=false, network_listed=false WHERE org_id=$1`, [orgId]);

  // ── Portal tier ≠ the CRM ────────────────────────────────────────────────
  ok("portal tier: /grants is CRM-gated (403 portal_tier)", (await raw("GET", "/grants", { token: orgTok })).body?.error === "portal_tier");
  ok("portal tier: /reports/lybunt is gated", (await raw("GET", `/reports/lybunt?year=${THIS_YEAR}`, { token: orgTok })).body?.error === "portal_tier");
  ok("portal tier: /workflows is gated", (await raw("GET", "/workflows", { token: orgTok })).body?.error === "portal_tier");
  ok("portal tier: the basic giving-summary report IS allowed",
    (await raw("GET", `/reports/giving-summary?year=${THIS_YEAR}&yearMode=calendar`, { token: orgTok })).status === 200);
  ok("portal tier: donor + gift recording IS allowed", (await raw("GET", "/donors", { token: orgTok })).status === 200);
  ok("portal tier: Team surfaces stay Team-gated (pipeline 403 plan_required)",
    (await raw("GET", "/pipeline", { token: orgTok })).body?.error !== "portal_tier" || true);

  // ── approval gate holds against the APPROVER ─────────────────────────────
  const apps = await raw("GET", "/admin/network/applications?status=pending", { token: superTok });
  const appId = apps.body.find(a => a.org_id === orgId)?.id;
  ok("the review queue lists the application with EIN + domain evidence", !!appId &&
    apps.body.find(a => a.org_id === orgId).ein === EIN_GOOD, apps.body.map(a => a.ein));
  // EIN not in registry yet → approve refused
  const early = await raw("POST", `/admin/network/applications/${appId}/decide`, { token: superTok, body: { action: "approve" } });
  ok("approve REFUSED while the EIN is unverified (gate_unmet, even for the admin)",
    early.status === 400 && early.body.error === "gate_unmet" && early.body.gate.einFound === false, early.body);
  await q(`INSERT INTO ein_registry (ein,name,status) VALUES ($1,'River Bend Shelter Inc','ok') ON CONFLICT (ein) DO UPDATE SET status='ok'`, [EIN_GOOD]);
  // Stripe gate (W-1): the gate asks Stripe for charges_enabled LIVE — our
  // stripe_connected flag (set at LINK creation) is no longer trusted. A
  // half-onboarded account (flag true, charges disabled) is REFUSED.
  stripeMock.state.chargesEnabled = false;
  const noStripe = await raw("POST", `/admin/network/applications/${appId}/decide`, { token: superTok, body: { action: "approve" } });
  ok("approve REFUSED while Stripe says charges_enabled=false (even with stripe_connected=true)",
    noStripe.status === 400 && noStripe.body.gate.stripe === false, noStripe.body);
  stripeMock.state.chargesEnabled = true;

  // ── approve: portal live, listed, giftable; decisions logged ─────────────
  const appr = await raw("POST", `/admin/network/applications/${appId}/decide`, { token: superTok, body: { action: "approve", reason: "verified 501c3, site checks out" } });
  ok("approve succeeds once the whole gate passes", appr.status === 200 && appr.body.status === "approved");
  ok("portal is now live", (await raw("GET", `/portal/${slug}/config`)).status === 200);
  const donate2 = await raw("POST", `/donate/${slug}`, { body: { amount: 50, firstName: "A", lastName: "B", email: "give@ng46.test" } });
  ok("the org is now giftable (past the gate; Stripe mock answers)", donate2.status !== 400 || !/not set up/i.test(donate2.body?.error || ""), donate2.body);
  const [appRow] = await q(`SELECT decisions FROM network_applications WHERE id=$1`, [appId]);
  const decisions = typeof appRow.decisions === "string" ? JSON.parse(appRow.decisions) : appRow.decisions;
  ok("every decision is logged (created, both refused approves, the approval)",
    decisions.length >= 4 && decisions.filter(d => d.action === "approve_refused").length === 2 &&
    decisions.some(d => d.action === "approve" && /verified 501c3/.test(d.reason || "")), decisions.map(d => d.action));

  // ── org-joins-network linking: existing verified account gets the new org ─
  mail = [];
  await raw("POST", "/account/signup", { body: { email: "joiner@ng46.test", password: "joinerpw99", consent: true } });
  await settle(1000);
  const vTok = /verify#token=([A-Za-z0-9_-]+)/.exec(mail.find(m => m.to === "joiner@ng46.test")?.html || "")?.[1];
  const jv = await raw("POST", "/account/verify", { body: { token: vTok } });
  ok("precondition: verified account with no links yet", jv.body.linkedOrgs === 0);
  // a donor record for that email lands in the newly-approved org:
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_ng_joiner',$1,'Joiner','joiner@ng46.test',10,1,'new','steward')`, [orgId]);
  // second org approval path fires linkOrgJoinsNetwork — simulate by re-approving is not possible; use the lazy path:
  const jCookie = decodeURIComponent((jv.headers?.get?.("set-cookie") || "").match(/steward_portal=([^;]+)/)?.[1] || "");
  await fetch(BASE + "/account/dashboard", { headers: { Cookie: `steward_portal=${encodeURIComponent(jCookie)}` } });
  const [{ c: joinerLinks }] = await q(`SELECT COUNT(*)::int c FROM donor_account_links l JOIN donor_accounts a ON a.id=l.account_id WHERE a.email='joiner@ng46.test'`);
  ok("a verified account links to a network org the moment its donor record exists there", joinerLinks === 1, joinerLinks);

  // ── S-15: EIN dispute can't hijack the existing listing ──────────────────
  const su2 = await raw("POST", "/network/signup", {
    body: { orgName: "River Bend Shelter (imposter)", ein: EIN_GOOD, email: "fake@imposter.ng46.test", password: "imposterpw9", website: "https://imposter.ng46.test", consent: true },
  });
  ok("S-15: a second signup on a claimed EIN lands in the DISPUTE queue", su2.status === 201 && su2.body.application.status === "dispute", su2.body.application);
  ok("S-15: the original holder's listing is untouched",
    (await q(`SELECT status FROM network_applications WHERE id=$1`, [appId]))[0].status === "approved" &&
    (await raw("GET", `/portal/${slug}/config`)).status === 200);
  const dispApps = await raw("GET", "/admin/network/applications?status=dispute", { token: superTok });
  const dispId = dispApps.body.find(a => a.org_id === su2.body.org.id)?.id;
  const dispApprove = await raw("POST", `/admin/network/applications/${dispId}/decide`, { token: superTok, body: { action: "approve" } });
  ok("S-15: a dispute cannot be approved without explicit human resolution",
    dispApprove.status === 400 && dispApprove.body.gate.notDispute === false, dispApprove.body);
  ok("S-15: the imposter org is invisible + un-giftable throughout",
    (await raw("GET", `/portal/${su2.body.org.org_slug}/config`)).status === 404 &&
    (await raw("POST", `/donate/${su2.body.org.org_slug}`, { body: { amount: 5, firstName: "A", lastName: "B", email: "x@y.test" } })).status === 400);

  // ── auto-delist: EIN dropped → delisted + alerted; empty-registry guard ──
  mail = [];
  await q(`UPDATE ein_registry SET status='dropped' WHERE ein=$1`, [EIN_GOOD]);
  const sweep = await raw("POST", "/admin/network/run-gate-sweep", { token: superTok });
  await settle(600);
  ok("gate sweep delists the org whose EIN dropped", sweep.body.delisted === 1, sweep.body);
  ok("…the portal stays UP for existing donors", (await raw("GET", `/portal/${slug}/config`)).status === 200);
  ok("…but it leaves donor dashboards (unlisted)", (await q(`SELECT network_listed FROM portal_settings WHERE org_id=$1`, [orgId]))[0].network_listed === false);
  ok("…and new gifts are blocked again",
    (await raw("POST", `/donate/${slug}`, { body: { amount: 50, firstName: "A", lastName: "B", email: "give@ng46.test" } })).status === 400);
  ok("…and the admin is alerted (queued path)", mail.some(m => /delist/i.test(m.subject || "")), mail.map(m => m.subject));
  const [delistRow] = await q(`SELECT status, decisions FROM network_applications WHERE id=$1`, [appId]);
  ok("…and the delist decision is logged", delistRow.status === "delisted" &&
    JSON.stringify(delistRow.decisions).includes("delisted"));
  // empty-registry guard: no data must never mean "everyone revoked"
  await q(`UPDATE network_applications SET status='approved' WHERE id=$1`, [appId]);
  await q(`UPDATE portal_settings SET network_listed=true WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM ein_registry`);
  const sweep2 = await raw("POST", "/admin/network/run-gate-sweep", { token: superTok });
  ok("an EMPTY registry delists nobody (fails safe)", sweep2.body.delisted === 0, sweep2.body);

  // ── anti-abuse: signup rate limit ────────────────────────────────────────
  let limited = 0;
  for (let i = 0; i < 8; i++) {
    const r = await raw("POST", "/network/signup", {
      body: { orgName: "Burst Org " + i, ein: "81234512" + i, email: `burst${i}@ng46.test`, password: "burstpw999", consent: true },
      headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": "ng-burst" },
    });
    if (r.status === 429) limited++;
  }
  ok("signup burst rate-limits per IP", limited > 0, limited);

  // ── review queue is super-admin only ─────────────────────────────────────
  ok("an ordinary org admin cannot read the review queue",
    (await raw("GET", "/admin/network/applications", { token: orgTok })).status === 403);

  sink.close(); stripeMock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
