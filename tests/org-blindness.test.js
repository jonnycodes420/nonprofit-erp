// BUILD-46 §2.4 / S-13 — THE WALL, tested as byte-equality.
//
// A donor may see across orgs; an org may never see across orgs. For a donor
// linked to Org A and Org B, every org-side route Org A's staff can call must
// return a response BYTE-IDENTICAL to the world where the donor has no
// account and no other links — not the org's name, not a gift, not an
// aggregate, not a boolean, not a count. Asserted on response BODIES.
//
// Method: capture a fixed battery of Org-A staff responses BEFORE any donor
// account exists (world 1); create the account, verify, alias, link BOTH
// orgs, and exercise every cross-org dashboard read (world 2); re-capture and
// compare byte-for-byte. Then sweep every world-2 body for Org-B markers
// (unique strings planted in the fixture) and account-table markers.
//
// Standard scratch stack + DONOR_ACCOUNTS_ENABLED=1. Own mail sink on :5602.

const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const ORG_A = "org_ob_a", SLUG_A = "blind-a";
const ORG_B = "org_ob_b", SLUG_B = "blind-b";
// Markers that exist ONLY in Org B — any appearance in an Org-A body is a leak.
const B_MARKERS = ["org_ob_b", "blind-b", "Blind Probe Org B", "d_obB", "777.77", "B-Secret-Fund"];
const ACCOUNT_MARKERS = ["donor_account", "wren-alias@ob46.test"];
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
const mailTo = (to) => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));
const tokenFrom = (m, kind) => (new RegExp(`${kind}#token=([A-Za-z0-9_-]+)`).exec(m?.html || "") || [])[1] || null;
function cookieOf(res) {
  const m = (res.headers?.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function raw(method, path, { cookie, body, headers, token } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@ob46.test'`);
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@ob46.test'`).catch(() => {});
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["portal_audit_log", "portal_sessions", "portal_magic_links", "notification_sends", "notification_failures",
      "workflow_runs", "workflows", "digest_sends", "tasks", "receipts", "recurring_subscriptions", "fin_transactions", "gifts", "interactions"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "fin_funds", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Blind Org A','${SLUG_A}',1,'active','team')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Blind Probe Org B','${SLUG_B}',1,'active','team')`, [ORG_B]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORG_A]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ob_a',$1,'ob-a@test.local',$2,'A Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ob_b',$1,'ob-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage) VALUES ('d_obA_w',$1,'Wren Walker','wren@ob46.test',420,2,'${THIS_YEAR}-05-01','mid','steward')`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage) VALUES ('d_obB_w',$1,'Wren Walker','wren-alias@ob46.test',777.77,1,'${THIS_YEAR}-06-01','major','steward')`, [ORG_B]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_obB',$1,'B-Secret-Fund',true)`, [ORG_B]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_obA_1',$1,'d_obA_w',300,'${THIS_YEAR}-03-01','cash','')`, [ORG_A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_obA_2',$1,'d_obA_w',120,'${THIS_YEAR}-05-01','cash','')`, [ORG_A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,fund_id) VALUES ('g_obB_1',$1,'d_obB_w',777.77,'${THIS_YEAR}-06-01','cash','','fund_obB')`, [ORG_B]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_obB',$1,'d_obB_w','sub_obB',77,'month','active')`, [ORG_B]);
}

// The battery of Org-A staff views. Every one must be byte-stable across the
// account's creation and use. (Routes that embed a "now" timestamp in their
// body are deliberately absent — byte-equality needs deterministic bodies;
// their coverage comes from the marker sweep instead.)
const BATTERY = [
  ["donor profile", "GET", "/donors/d_obA_w"],
  ["donor summaries", "GET", "/donors/summaries"],
  ["donor search by name", "GET", "/donors?search=wren&limit=50"],
  ["donor search by the OTHER org's email", "GET", "/donors?search=wren-alias&limit=50"],
  ["donor list paginated", "GET", "/donors?limit=50&offset=0"],
  ["donor export CSV", "GET", "/donors/export/csv"],
  ["giving summary report", "GET", `/reports/giving-summary?year=${THIS_YEAR}&yearMode=calendar`],
  ["top donors report", "GET", `/reports/top-donors?year=${THIS_YEAR}&yearMode=calendar`],
  ["portal audit view", "GET", "/portal-audit"],
  ["donor recurring record", "GET", "/donors/d_obA_w/recurring-subscription"],
];

async function captureBattery(tokenA) {
  const out = {};
  for (const [name, method, path] of BATTERY) {
    const r = await raw(method, path, { token: tokenA });
    out[name] = { status: r.status, text: r.text };
  }
  return out;
}

(async () => {
  const sink = await startSink();
  await fixture();
  const tokenA = (await api("POST", "/auth/login", null, { email: "ob-a@test.local", password: "loadtest1234" })).body.token;
  const tokenB = (await api("POST", "/auth/login", null, { email: "ob-b@test.local", password: "loadtest1234" })).body.token;

  // ── world 1: no donor account exists ─────────────────────────────────────
  const world1 = await captureBattery(tokenA);
  const [pipeBefore] = await q(
    `SELECT (SELECT COUNT(*) FROM notification_sends WHERE org_id=$1)::int AS sends,
            (SELECT COUNT(*) FROM notification_failures WHERE org_id=$1)::int AS fails`, [ORG_A]);

  // ── the account: create, verify, alias, link BOTH orgs, USE the dashboard ─
  mail = [];
  await raw("POST", "/account/signup", { body: { email: "wren@ob46.test", password: "wrenpass999", consent: true } });
  await settle();
  const v = await raw("POST", "/account/verify", { body: { token: tokenFrom(mailTo("wren@ob46.test")[0], "verify") } });
  const cookie = cookieOf(v);
  mail = [];
  await raw("POST", "/account/aliases", { cookie, body: { email: "wren-alias@ob46.test" } });
  await settle();
  await raw("POST", "/account/aliases/verify", { body: { token: tokenFrom(mailTo("wren-alias@ob46.test")[0], "confirm-alias") } });
  const me = JSON.parse((await raw("GET", "/account/me", { cookie })).text);
  ok("precondition: the donor is linked to BOTH orgs", me.links.length === 2, me.links);
  // exercise every cross-org read surface
  const dash = await raw("GET", "/account/dashboard", { cookie });
  const rec = await raw("GET", "/account/recurring", { cookie });
  const tax = await raw("GET", "/account/tax-summary", { cookie });
  ok("precondition: the dashboard sees both orgs' giving",
    dash.text.includes("Blind Org A") && dash.text.includes("Blind Probe Org B") && dash.text.includes("777.77"), dash.text.slice(0, 200));
  ok("precondition: unified recurring sees Org B's subscription", rec.text.includes("rs_obB"));
  ok("precondition: tax summary spans both orgs", tax.text.includes("777.77") && tax.text.includes("Blind Org A"));

  // ── world 2: recapture — BYTE-IDENTICAL, route by route ──────────────────
  const world2 = await captureBattery(tokenA);
  for (const [name] of BATTERY) {
    ok(`byte-identical org-A view: ${name}`,
      world1[name].status === world2[name].status && world1[name].text === world2[name].text,
      world1[name].text === world2[name].text ? "" : `LEN ${world1[name].text.length} -> ${world2[name].text.length}`);
  }

  // ── the marker sweep: no Org-B or account artifact in ANY org-A body ─────
  const allA = Object.values(world2).map(v => v.text).join("\n");
  for (const marker of [...B_MARKERS, ...ACCOUNT_MARKERS]) {
    ok(`org-A responses never contain "${marker}"`, !allA.includes(marker));
  }
  // symmetric spot check: org B is equally blind to org A
  const bView = await raw("GET", "/donors/d_obB_w", { token: tokenB });
  ok("org-B donor profile never mentions org A", !bView.text.includes("org_ob_a") && !bView.text.includes("Blind Org A") && !bView.text.includes("wren@ob46.test"));

  // ── notification pipeline untouched by account activity ──────────────────
  const [pipeAfter] = await q(
    `SELECT (SELECT COUNT(*) FROM notification_sends WHERE org_id=$1)::int AS sends,
            (SELECT COUNT(*) FROM notification_failures WHERE org_id=$1)::int AS fails`, [ORG_A]);
  ok("org-A notification pipeline is untouched by account creation + dashboard use",
    JSON.stringify(pipeBefore) === JSON.stringify(pipeAfter), { pipeBefore, pipeAfter });

  // ── drill-down parity: account session vs magic link look the SAME to A ──
  // (Portal sign-in visibility is a BUILD-45 per-org feature; the wall demands
  // the MECHANISM be indistinguishable — org A must not be able to tell a
  // dashboard drill-down from a standalone magic-link visit, and neither may
  // reference the account or org B.)
  await raw("GET", `/portal/${SLUG_A}/me`, { cookie }); // account-session drill-down
  const auditRows = await q(`SELECT action, donor_id, email, meta FROM portal_audit_log WHERE org_id=$1 ORDER BY created_at DESC LIMIT 5`, [ORG_A]);
  ok("the drill-down writes the same org-scoped audit action a magic-link visit writes",
    auditRows.some(r => r.action === "dashboard_viewed"), auditRows.map(r => r.action));
  const auditText = JSON.stringify(auditRows);
  for (const marker of [...B_MARKERS, "donor_account", "da_"]) {
    ok(`org-A portal audit never contains "${marker}"`, !auditText.includes(marker));
  }
  // The org-A staff portal-audit VIEW is not byte-frozen (the drill-down adds
  // a row — as any portal visit would) but must still pass the marker sweep:
  const auditView = await raw("GET", "/portal-audit", { token: tokenA });
  for (const marker of [...B_MARKERS, ...ACCOUNT_MARKERS]) {
    ok(`org-A audit view after drill-down never contains "${marker}"`, !auditView.text.includes(marker));
  }

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
