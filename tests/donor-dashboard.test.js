// BUILD-46 §2 — the cross-org donor dashboard is a VIEW: every figure equals
// the per-org portal ledgers it aggregates, computed at read time for the
// donor's eyes only. Unified recurring/receipts/tax-summary equal the per-org
// lists; the listing toggle (network_listed) hides an org from every
// dashboard surface while its standalone portal keeps working; the org
// drill-down through an account session is the SAME portal a magic-link
// session sees (wrapped, not forked); mutations remain the org-scoped paths.
//
// Standard scratch stack + DONOR_ACCOUNTS_ENABLED=1. Sink :5602, Stripe mock :5603.

const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const ORG_M = "org_dd_m", SLUG_M = "dondash-m";
const ORG_N = "org_dd_n", SLUG_N = "dondash-n";
const EMAIL = "harper@dd46.test";
const THIS_YEAR = String(new Date().getFullYear());
const LAST_YEAR = String(Number(THIS_YEAR) - 1);

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
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const m = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (m) res.end(JSON.stringify({ id: m[1], object: "subscription", status: "active", pause_collection: null, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 12, items: { data: [{ id: "si_1", price: { currency: "usd" } }] }, default_payment_method: { card: { last4: "4242" } } }));
        else res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const mailTo = (to) => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));
const tokenFrom = (m, kind) => (new RegExp(`${kind}#token=([A-Za-z0-9_-]+)`).exec(m?.html || "") || [])[1] || null;
function cookieOf(res) {
  const m = (res.headers?.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function raw(method, path, { cookie, body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { }
  return { status: r.status, body: parsed, headers: r.headers };
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@dd46.test'`);
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@dd46.test'`).catch(() => {});
  for (const org of [ORG_M, ORG_N]) {
    for (const t of ["portal_audit_log", "portal_sessions", "portal_magic_links", "impact_updates", "receipts", "recurring_subscriptions", "gifts", "interactions", "tasks"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "fin_funds", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'Meadow Arts','${SLUG_M}',1,'active','core','acct_dd_m')`, [ORG_M]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'North Shelter','${SLUG_N}',1,'active','core','acct_dd_n')`, [ORG_N]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,accent_color) VALUES ($1,true,true,'Meadow Arts','#846e32')`, [ORG_M]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,'North Shelter')`, [ORG_N]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_dd_m',$1,'dd-m@test.local',$2,'M Admin','admin')`, [ORG_M, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_ddM_h',$1,'Harper Hill',$2,'mid','steward')`.replace("VALUES ('d_ddM_h',$1,'Harper Hill',$2,'mid','steward')", "VALUES ('d_ddM_h',$1,'Harper Hill',$2,410,3,'mid','steward')"), [ORG_M, EMAIL]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_ddN_h',$1,'Harper Hill',$2,275,2,'mid','steward')`, [ORG_N, EMAIL]);
  const gifts = [
    ["g_ddM_1", ORG_M, "d_ddM_h", 100, `${THIS_YEAR}-01-15`],
    ["g_ddM_2", ORG_M, "d_ddM_h", 60, `${THIS_YEAR}-04-02`],
    ["g_ddM_3", ORG_M, "d_ddM_h", 250, `${LAST_YEAR}-11-01`],
    ["g_ddN_1", ORG_N, "d_ddN_h", 25, `${THIS_YEAR}-02-20`],
    ["g_ddN_2", ORG_N, "d_ddN_h", 250, `${LAST_YEAR}-12-24`],
  ];
  for (const [id, org, donor, amt, date] of gifts)
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ($1,$2,$3,$4,$5,'cash','')`, [id, org, donor, amt, date]);
  const pdf = Buffer.from("%PDF-1.4 dd-receipt").toString("base64");
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data) VALUES ('r_ddM_1',$1,'d_ddM_h','g_ddM_1','gift','2026-00101',100,100,'{}',$2)`, [ORG_M, pdf]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data) VALUES ('r_ddN_1',$1,'d_ddN_h','g_ddN_2','gift','2025-00042',250,250,'{}',$2)`, [ORG_N, pdf]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_ddM',$1,'d_ddM_h','sub_ddM',20,'month','active')`, [ORG_M]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_ddN',$1,'d_ddN_h','sub_ddN',15,'month','active')`, [ORG_N]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ('imp_ddM',$1,'New kiln installed','Clay wing live.','[]',true,'published')`, [ORG_M]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,targets,org_wide,status) VALUES ('imp_ddN',$1,'Winter beds funded','80 warm nights.','[]',true,'published')`, [ORG_N]);
}

(async () => {
  const sink = await startSink();
  const stripeMock = await startStripeMock();
  await fixture();

  // account: signup + verify → links both orgs
  mail = [];
  await raw("POST", "/account/signup", { body: { email: EMAIL, password: "harperpw999" } });
  await settle();
  const v = await raw("POST", "/account/verify", { body: { token: tokenFrom(mailTo(EMAIL)[0], "verify") } });
  const cookie = cookieOf(v);
  ok("account links both orgs on verify", v.body.linkedOrgs === 2, v.body);

  // ── §2.1 home == Σ per-org portals (read-time, no rollup table) ──────────
  const dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  const meM = (await raw("GET", `/portal/${SLUG_M}/me`, { cookie })).body;
  const meN = (await raw("GET", `/portal/${SLUG_N}/me`, { cookie })).body;
  ok("dashboard total YTD == Org M portal YTD + Org N portal YTD",
    dash.totals.ytd === meM.giving.ytd + meN.giving.ytd, { dash: dash.totals.ytd, m: meM.giving.ytd, n: meN.giving.ytd });
  ok("dashboard lifetime == the two portals' lifetimes", dash.totals.lifetime === meM.giving.lifetime + meN.giving.lifetime);
  const cardM = dash.orgs.find(o => o.orgSlug === SLUG_M);
  const cardN = dash.orgs.find(o => o.orgSlug === SLUG_N);
  ok("Org M card mirrors its own portal exactly", cardM.ytd === meM.giving.ytd && cardM.lifetime === meM.giving.lifetime, cardM);
  ok("Org N card mirrors its own portal exactly", cardN.ytd === meN.giving.ytd && cardN.lifetime === meN.giving.lifetime, cardN);
  ok("cards carry each org's white-label identity (theme accent rides along)", cardM.accent === "#846e32" && cardM.orgName === "Meadow Arts", cardM);
  ok("recurring status on the card", cardM.recurringCount === 1 && cardN.recurringCount === 1);

  // ── §2.3 impact feed: both orgs, newest-first, org-labeled ───────────────
  ok("impact feed merges both orgs' updates with org labels",
    dash.impact.some(u => u.title === "New kiln installed" && u.orgName === "Meadow Arts") &&
    dash.impact.some(u => u.title === "Winter beds funded" && u.orgName === "North Shelter"), dash.impact.map(u => u.title));
  const dates = dash.impact.map(u => String(u.date));
  ok("impact feed is newest-first (deterministic, no ranking)", dates.every((d, i) => i === 0 || dates[i - 1] >= d));

  // ── §2.1 unified recurring == per-org lists ──────────────────────────────
  const rec = (await raw("GET", "/account/recurring", { cookie })).body.recurring;
  ok("unified recurring is exactly the two org lists", rec.length === 2 &&
    rec.some(r => r.id === "rs_ddM" && r.orgSlug === SLUG_M && r.amount === 20) &&
    rec.some(r => r.id === "rs_ddN" && r.orgSlug === SLUG_N && r.amount === 15), rec);

  // ── §2.1 tax summary == the receipts/ledger ──────────────────────────────
  const tax = (await raw("GET", "/account/tax-summary", { cookie })).body;
  const yM = tax.years.find(y => y.year === THIS_YEAR && y.orgSlug === SLUG_M);
  const yN2 = tax.years.find(y => y.year === LAST_YEAR && y.orgSlug === SLUG_N);
  ok("tax summary per-year-per-org totals equal the ledger", yM?.total === 160 && yN2?.total === 250, tax.years);
  ok("receipts span both orgs with numbers intact", tax.receipts.length === 2 &&
    tax.receipts.some(r => r.number === "2026-00101") && tax.receipts.some(r => r.number === "2025-00042"));
  ok("the tax note says records-only, consult your preparer", /consult your tax preparer/i.test(tax.note));

  // ── §2.2 drill-down: the WRAPPED portal, not a fork ──────────────────────
  mail = [];
  await raw("POST", `/portal/${SLUG_M}/request-link`, { body: { email: EMAIL } });
  await settle();
  const mlv = await raw("POST", `/portal/${SLUG_M}/verify`, { body: { token: tokenFrom(mailTo(EMAIL)[0], "verify") } });
  const mlMe = (await raw("GET", `/portal/${SLUG_M}/me`, { cookie: cookieOf(mlv) })).body;
  const acctMe = (await raw("GET", `/portal/${SLUG_M}/me`, { cookie })).body;
  ok("account-session drill-down and magic-link session see the SAME org portal payload",
    JSON.stringify(mlMe.giving) === JSON.stringify(acctMe.giving) &&
    JSON.stringify(mlMe.gifts) === JSON.stringify(acctMe.gifts) &&
    JSON.stringify(mlMe.theme) === JSON.stringify(acctMe.theme));
  // a mutation through the account session is the same org-scoped path:
  const pause = await raw("POST", `/portal/${SLUG_M}/recurring/rs_ddM/pause`, { cookie, body: {} });
  ok("recurring mutation works through the account session (org-scoped, Stripe-first)", pause.status === 200, pause.body);
  const [audit] = await q(`SELECT action FROM portal_audit_log WHERE org_id=$1 AND action LIKE '%pause%' ORDER BY created_at DESC LIMIT 1`, [ORG_M]);
  ok("…and audits into the ORG's audit log like any portal mutation", !!audit, audit);
  const receiptPdf = await fetch(BASE + `/portal/${SLUG_M}/receipts/r_ddM_1/pdf`, { headers: { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } });
  ok("receipt PDF streams through the account session", receiptPdf.status === 200 && (receiptPdf.headers.get("content-type") || "").includes("pdf"));

  // ── §2.2 the listing toggle hides an org from EVERY dashboard surface ────
  await q(`UPDATE portal_settings SET network_listed=false WHERE org_id=$1`, [ORG_N]);
  const dash2 = (await raw("GET", "/account/dashboard", { cookie })).body;
  const rec2 = (await raw("GET", "/account/recurring", { cookie })).body.recurring;
  const tax2 = (await raw("GET", "/account/tax-summary", { cookie })).body;
  ok("unlisted org disappears from home", !dash2.orgs.some(o => o.orgSlug === SLUG_N) && dash2.totals.ytd === meM.giving.ytd);
  ok("unlisted org disappears from unified recurring", !rec2.some(r => r.orgSlug === SLUG_N));
  ok("unlisted org disappears from the tax summary", !tax2.years.some(y => y.orgSlug === SLUG_N) && !tax2.receipts.some(r => r.orgSlug === SLUG_N));
  ok("unlisted org's drill-down closes for ACCOUNT sessions", (await raw("GET", `/portal/${SLUG_N}/me`, { cookie })).status === 401);
  // …but the standalone portal keeps working (magic link, BUILD-45 unchanged):
  mail = [];
  await raw("POST", `/portal/${SLUG_N}/request-link`, { body: { email: EMAIL } });
  await settle();
  const nTok = tokenFrom(mailTo(EMAIL)[0], "verify");
  const nv = await raw("POST", `/portal/${SLUG_N}/verify`, { body: { token: nTok } });
  ok("the unlisted org's STANDALONE portal still works by magic link",
    (await raw("GET", `/portal/${SLUG_N}/me`, { cookie: cookieOf(nv) })).status === 200);
  await q(`UPDATE portal_settings SET network_listed=true WHERE org_id=$1`, [ORG_N]);

  sink.close(); stripeMock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
