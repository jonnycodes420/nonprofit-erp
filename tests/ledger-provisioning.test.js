// BUILD-58 W-3 — the chart-of-accounts hole, fixed as an instance AND a class.
//
// Instance: an org born through the REAL signup paths (/auth/register,
// /auth/register-org, /network/signup) had NO chart of accounts until
// /onboarding/complete ran — and /network/signup never runs it at all — so
// every gift→ledger stamp silently no-op'd ("the documented '4010' gotcha,
// structural on the real signup path", BUILD-57 W-3).
//
// Class: a financial write that lands nowhere must be LOUD. The one stamp
// helper (stampGiftLedger / ensureContributionAccount in server.js) now
// self-heals a missing contribution account (provisioning the chart if the
// org has none), alerts (Sentry + CRITICAL log), and surfaces the event at
// /health.ledger — a stamp can never again write nothing and return success.
//
// Verify-first: committed RED against the pre-BUILD-58 server
// (audit/build58-verify-first-red.txt).

const { ok, summary, api, q, closeDb, BASE } = require("./helpers");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
function signStripePayload(payload) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${sig}`;
}
async function fireWebhook(type, object, evtId, account) {
  const payload = JSON.stringify({ id: evtId, type, account, data: { object } });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signStripePayload(payload) },
    body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const uniq = () => Math.random().toString(36).slice(2, 8);

async function register(pathName, body) {
  const r = await fetch(BASE + pathName, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function ledgerReadiness(orgId) {
  const acct = await q("SELECT id FROM accounts WHERE org_id=$1 AND code='4010'", [orgId]);
  const fund = await q("SELECT id FROM fin_funds WHERE org_id=$1 AND restricted=false", [orgId]);
  return { has4010: acct.length >= 1, only4010: acct.length === 1, hasFund: fund.length >= 1 };
}

(async () => {
  console.log("ledger-provisioning (BUILD-58 W-3)");

  // ── §1 every org-creation path provisions a usable ledger ────────────────
  console.log("\n§1 creation paths provision a chart of accounts");

  // register-org
  const u1 = `b58w3a-${uniq()}@test.local`;
  const r1 = await register("/auth/register-org", { orgName: "W3 RegOrg " + uniq(), userName: "W3 Admin", email: u1, password: "loadtest1234" });
  ok("register-org 201", r1.status === 201, r1.body);
  const org1 = r1.body?.org?.id;
  {
    const l = await ledgerReadiness(org1);
    ok("register-org: chart of accounts exists at creation (4010)", l.has4010, l);
    ok("register-org: unrestricted fund exists at creation", l.hasFund, l);
  }
  // onboarding/complete stays idempotent on top (no duplicate 4010)
  {
    const t1 = r1.body.token;
    const c = await api("POST", "/onboarding/complete", t1, {});
    ok("onboarding/complete still 200 on a pre-provisioned org", c.status === 200, c.body);
    const l = await ledgerReadiness(org1);
    ok("onboarding/complete does not duplicate the chart (exactly one 4010)", l.only4010, l);
  }

  // legacy register
  const u2 = `b58w3b-${uniq()}@test.local`;
  const r2 = await register("/auth/register", { orgName: "W3 Legacy " + uniq(), email: u2, password: "loadtest1234", name: "W3 Legacy Admin" });
  ok("legacy register 201", r2.status === 201, r2.body);
  const org2 = r2.body?.org?.id;
  {
    const l = await ledgerReadiness(org2);
    ok("legacy register: chart of accounts exists at creation", l.has4010, l);
    ok("legacy register: unrestricted fund exists at creation", l.hasFund, l);
  }

  // network signup (the W-3 org class from the walk)
  const u3 = `b58w3c-${uniq()}@test.local`;
  const r3 = await register("/network/signup", {
    orgName: "W3 Network Org " + uniq(), ein: "981234567", email: u3,
    password: "loadtest1234", website: "https://example.org", consent: true,
  });
  ok("network signup 201", r3.status === 201, r3.body);
  const org3 = r3.body?.org?.id;
  const tok3 = r3.body?.token;
  {
    const l = await ledgerReadiness(org3);
    ok("network signup: chart of accounts exists at creation (THE W-3 hole)", l.has4010, l);
    ok("network signup: unrestricted fund exists at creation", l.hasFund, l);
  }

  // The network org's gifts stamp the ledger (the walk's exact failure).
  {
    const dRes = await api("POST", "/donors", tok3, { name: "Wren Walker", email: `wren-${uniq()}@test.local` });
    const donorId = dRes.body?.id || dRes.body?.donor?.id;
    ok("portal-tier org can create a donor", !!donorId, dRes.body);
    const gRes = await api("POST", `/donors/${donorId}/gifts`, tok3, { amount: 60, date: new Date().toISOString().slice(0, 10), idempotencyKey: crypto.randomUUID() });
    ok("portal-tier org can record a gift", gRes.status === 200 || gRes.status === 201, gRes.body);
    const giftId = gRes.body?.gift?.id || gRes.body?.id;
    const stamps = await q("SELECT id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2", [org3, giftId]);
    ok("network-signup org: the gift stamped the ledger EXACTLY once", stamps.length === 1, { stamps: stamps.length });
  }

  // ── §2 the class — a stamp that would land nowhere self-heals, loudly ────
  console.log("\n§2 a ledger write can never land nowhere silently");
  const healthBefore = await (await fetch(BASE + "/health")).json();
  {
    // Simulate a damaged/legacy org: rip out its chart of accounts entirely.
    await q("DELETE FROM fin_transactions WHERE org_id=$1", [org1]);
    await q("DELETE FROM accounts WHERE org_id=$1", [org1]);
    await q("DELETE FROM fin_funds WHERE org_id=$1", [org1]);
    const t1 = r1.body.token;
    const dRes = await api("POST", "/donors", t1, { name: "Healed Donor", email: `heal-${uniq()}@test.local` });
    const donorId = dRes.body?.id || dRes.body?.donor?.id;
    const gRes = await api("POST", `/donors/${donorId}/gifts`, t1, { amount: 125, date: new Date().toISOString().slice(0, 10), idempotencyKey: crypto.randomUUID() });
    const giftId = gRes.body?.gift?.id || gRes.body?.id;
    const stamps = await q("SELECT amount FROM fin_transactions WHERE org_id=$1 AND gift_id=$2", [org1, giftId]);
    ok("manual gift on a chartless org: stamp EXISTS (self-healed, not skipped)", stamps.length === 1, { stamps: stamps.length });
    const l = await ledgerReadiness(org1);
    ok("the missing chart was provisioned by the heal", l.has4010 && l.hasFund, l);
  }

  {
    // Webhook path on a chartless org — the walk's actual $60. Make org2 the
    // damaged one, wire a fake connected account, fire a signed PI event.
    await q("DELETE FROM accounts WHERE org_id=$1", [org2]);
    await q("DELETE FROM fin_funds WHERE org_id=$1", [org2]);
    const acctId = "acct_b58w3" + uniq();
    await q("UPDATE orgs SET stripe_account_id=$1, stripe_connected=true WHERE id=$2", [acctId, org2]);
    const piId = "pi_b58w3_" + uniq();
    const evt = await fireWebhook("payment_intent.succeeded", {
      id: piId, amount_received: 5000, currency: "usd",
      receipt_email: `web-${uniq()}@test.local`, metadata: { donor_name: "Web Donor" },
    }, "evt_b58w3_" + uniq(), acctId);
    ok("webhook accepted", evt.status === 200, evt);
    await new Promise(r => setTimeout(r, 600));
    const gifts = await q("SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [org2, piId]);
    ok("webhook gift recorded", gifts.length === 1, { gifts: gifts.length });
    const stamps = await q("SELECT id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2", [org2, gifts[0]?.id || "none"]);
    ok("webhook gift on a chartless org: ledger stamp EXISTS (self-healed)", stamps.length === 1, { stamps: stamps.length });
  }

  {
    // Loudness is pinned: /health surfaces that self-heals happened.
    const health = await (await fetch(BASE + "/health")).json();
    const before = healthBefore?.ledger?.chartSelfHeals ?? null;
    const after = health?.ledger?.chartSelfHeals ?? null;
    ok("/health carries a ledger.chartSelfHeals counter", after !== null, health.ledger);
    ok("self-heals were COUNTED (loud, not silent)", after !== null && (before === null || after > before), { before, after });
  }

  // ── §3 totality — every org-creation site provisions, by construction ────
  console.log("\n§3 org-creation sites are classified (a new path fails until it provisions)");
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const sites = [...src.matchAll(/INSERT INTO orgs/g)].length;
    ok("exactly 3 org-creation sites in server.js (new one → classify it here + provision)", sites === 3, { sites });
    // Each creation site must be followed by ledger provisioning within its
    // handler (ensureOrgLedger — the ONE provisioning helper).
    const chunks = src.split(/INSERT INTO orgs/).slice(1);
    const provisioned = chunks.filter(c => /ensureOrgLedger\s*\(/.test(c.slice(0, 4000))).length;
    ok("every org-creation site calls ensureOrgLedger()", provisioned === sites, { provisioned, sites });
    ok("server.js defines ensureOrgLedger as the one provisioning helper", /async function ensureOrgLedger\s*\(/.test(src), null);
    // The stamp class-fix helper exists and is what the gift paths use: the
    // raw "SELECT … code='4010'" probe pattern must live ONLY inside the
    // helper (one occurrence), not copy-pasted per stamp site.
    const probes = [...src.matchAll(/code\s*=\s*'4010'/g)].length;
    ok("the 4010 probe lives in ONE place (the ensure helper), not per-site", probes === 1, { probes });
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
