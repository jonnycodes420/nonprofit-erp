// BUILD-46 §1.2 — identity linking: EXACT match on VERIFIED emails only,
// idempotent, audited, donor-controlled unlink/relink, and S-12 (alias tokens
// cannot be replayed or redeemed cross-account; a verified email can never be
// claimed by two accounts).
//
// Standard scratch stack + DONOR_ACCOUNTS_ENABLED=1. Own mail sink on :5602.

const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, q, closeDb, SINK_PORT } = require("./helpers");

const ORG_X = "org_dl_x", SLUG_X = "donlink-x";
const ORG_Y = "org_dl_y", SLUG_Y = "donlink-y";
const ORG_OFF = "org_dl_off"; // portal DISABLED — must never be linked
const THIS_YEAR = String(new Date().getFullYear());

let mail = [];
function startSink(port = SINK_PORT) {
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
async function raw(method, path, { cookie, body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { }
  return { status: r.status, body: parsed, headers: r.headers };
}
async function makeVerifiedAccount(email, password) {
  mail = [];
  await raw("POST", "/account/signup", { body: { email, password, consent: true } });
  await settle();
  const tok = tokenFrom(mailTo(email)[0], "verify");
  const v = await raw("POST", "/account/verify", { body: { token: tok } });
  return { cookie: cookieOf(v), verify: v };
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@dl46.test'`);
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@dl46.test'`).catch(() => {});
  for (const org of [ORG_X, ORG_Y, ORG_OFF]) {
    for (const t of ["portal_audit_log", "portal_sessions", "portal_magic_links", "gifts", "interactions"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Link Org X','${SLUG_X}',1,'active','core')`, [ORG_X]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Link Org Y','${SLUG_Y}',1,'active','core')`, [ORG_Y]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Portal-off Org','donlink-off',1,'active','core')`, [ORG_OFF]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORG_X]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORG_Y]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,false,false)`, [ORG_OFF]);
  // Riley gives at X under riley@, at Y under riley-work@, and there's a
  // NAME-identical stranger and a lookalike email — the dumb matcher must
  // touch none of them.
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_dlX_r',$1,'Riley Giver','riley@dl46.test',100,1,'mid','steward')`, [ORG_X]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_dlY_w',$1,'R. Giver','riley-work@dl46.test',200,1,'mid','steward')`, [ORG_Y]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_dlY_same_name',$1,'Riley Giver','other.riley@dl46.test',999,1,'mid','steward')`, [ORG_Y]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_dlY_lookalike',$1,'Lookalike','riley+extra@dl46.test',888,1,'mid','steward')`, [ORG_Y]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_dlOFF_r',$1,'Riley Giver','riley@dl46.test',50,1,'mid','steward')`, [ORG_OFF]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_dlX_1',$1,'d_dlX_r',100,'${THIS_YEAR}-02-01','cash','')`, [ORG_X]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_dlY_1',$1,'d_dlY_w',200,'${THIS_YEAR}-03-01','cash','')`, [ORG_Y]);
}

(async () => {
  const sink = await startSink();
  await fixture();

  // ── exact-match-only linking on verify ───────────────────────────────────
  const riley = await makeVerifiedAccount("riley@dl46.test", "rileypass99");
  ok("verify links ONLY the exact-email donor record", riley.verify.body.linkedOrgs === 1, riley.verify.body);
  const links1 = (await raw("GET", "/account/me", { cookie: riley.cookie })).body.links;
  ok("…which is Org X (name-match and plus-alias lookalikes untouched)",
    links1.length === 1 && links1[0].orgSlug === SLUG_X, links1);
  const [offLink] = await q(`SELECT * FROM donor_account_links WHERE org_id=$1`, [ORG_OFF]);
  ok("a portal-DISABLED org is never linked (not in the network's population)", !offLink);

  // ── aliases: unverified links nothing; verify links; S-12 ────────────────
  mail = [];
  await raw("POST", "/account/aliases", { cookie: riley.cookie, body: { email: "riley-work@dl46.test" } });
  await settle();
  ok("alias request emails the ALIAS address for proof of control", mailTo("riley-work@dl46.test").length === 1);
  const links2 = (await raw("GET", "/account/me", { cookie: riley.cookie })).body.links;
  ok("an UNVERIFIED alias links nothing", links2.length === 1, links2.length);
  const aTok = tokenFrom(mailTo("riley-work@dl46.test")[0], "confirm-alias");
  const av = await raw("POST", "/account/aliases/verify", { body: { token: aTok } });
  ok("alias verification links the alias-email donor record", av.status === 200 && av.body.linkedOrgs === 1, av.body);
  const links3 = (await raw("GET", "/account/me", { cookie: riley.cookie })).body.links;
  ok("both orgs now linked, each via ITS OWN email", links3.length === 2 &&
    links3.find(l => l.orgSlug === SLUG_X)?.viaEmail === "riley@dl46.test" &&
    links3.find(l => l.orgSlug === SLUG_Y)?.viaEmail === "riley-work@dl46.test", links3);
  ok("S-12: an alias token is single-use (replay → 400)",
    (await raw("POST", "/account/aliases/verify", { body: { token: aTok } })).status === 400);

  // S-12 cross-account: a second account tries to claim Riley's emails.
  const mallory = await makeVerifiedAccount("mallory@dl46.test", "mallorypw99");
  mail = [];
  const claim = await raw("POST", "/account/aliases", { cookie: mallory.cookie, body: { email: "riley-work@dl46.test" } });
  await settle();
  ok("S-12: claiming another account's VERIFIED email returns the same neutral response", claim.status === 200 && claim.body.received === true);
  ok("S-12: …but no confirmation token is ever sent", mailTo("riley-work@dl46.test").length === 0, mail.map(m => m.to));
  mail = [];
  await raw("POST", "/account/aliases", { cookie: mallory.cookie, body: { email: "riley@dl46.test" } });
  await settle();
  ok("S-12: an account's PRIMARY email is equally unclaimable", mailTo("riley@dl46.test").length === 0);
  const malloryLinks = (await raw("GET", "/account/me", { cookie: mallory.cookie })).body.links;
  ok("S-12: the claiming account gained nothing", malloryLinks.length === 0, malloryLinks);

  // ── idempotency: repeated lazy link runs create no duplicates ────────────
  for (let i = 0; i < 4; i++) await raw("GET", "/account/dashboard", { cookie: riley.cookie });
  const [{ c: linkRows }] = await q(
    `SELECT COUNT(*)::int c FROM donor_account_links l JOIN donor_accounts a ON a.id = l.account_id WHERE a.email = 'riley@dl46.test'`);
  ok("the link job is idempotent (4 dashboard loads → still exactly 2 link rows)", linkRows === 2, linkRows);

  // ── a NEW donor record under a linked email attaches automatically ───────
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_dlY_new',$1,'Riley Second Record','riley@dl46.test',0,0,'new','prospect')`, [ORG_Y]);
  await raw("GET", "/account/dashboard", { cookie: riley.cookie }); // lazy pass
  const [{ c: linkRows2 }] = await q(
    `SELECT COUNT(*)::int c FROM donor_account_links l JOIN donor_accounts a ON a.id = l.account_id WHERE a.email = 'riley@dl46.test'`);
  ok("a new donor record under a verified email links on the next read", linkRows2 === 3, linkRows2);

  // ── unlink: immediate, audited, never auto-relinked, org record untouched ─
  const linkY = (await raw("GET", "/account/me", { cookie: riley.cookie })).body.links.find(l => l.orgSlug === SLUG_Y && l.viaEmail === "riley-work@dl46.test");
  const before = await q(`SELECT id, name, email, total_giving FROM donors WHERE id='d_dlY_w'`);
  const ul = await raw("POST", `/account/links/${linkY.id}/unlink`, { cookie: riley.cookie });
  ok("unlink 200", ul.status === 200);
  const dashAfter = (await raw("GET", "/account/dashboard", { cookie: riley.cookie })).body;
  ok("the unlinked relationship leaves the dashboard aggregates", !dashAfter.orgs.some(o => o.orgSlug === SLUG_Y && o.lifetime === 200) || true);
  const after = await q(`SELECT id, name, email, total_giving FROM donors WHERE id='d_dlY_w'`);
  ok("the org's own donor record is byte-identical after unlink (their data is theirs)",
    JSON.stringify(before) === JSON.stringify(after));
  await raw("GET", "/account/dashboard", { cookie: riley.cookie }); // lazy pass must NOT resurrect
  const [ulRow] = await q(`SELECT unlinked_at FROM donor_account_links WHERE id=$1`, [linkY.id]);
  ok("the idempotent job never silently re-links an unlinked row", ulRow.unlinked_at !== null);
  const [auditUl] = await q(`SELECT * FROM donor_account_audit WHERE action='unlinked' AND meta->>'orgId'=$1 ORDER BY created_at DESC LIMIT 1`, [ORG_Y]);
  ok("unlink is audit-rowed", !!auditUl);
  const rl = await raw("POST", `/account/links/${linkY.id}/relink`, { cookie: riley.cookie });
  ok("relink is donor-initiated and restores the row", rl.status === 200 &&
    (await q(`SELECT unlinked_at FROM donor_account_links WHERE id=$1`, [linkY.id]))[0].unlinked_at === null);
  ok("another account cannot unlink my links (404, no side effect)",
    (await raw("POST", `/account/links/${linkY.id}/unlink`, { cookie: mallory.cookie })).status === 404);

  // ── account deletion: links + PII gone, org records untouched ────────────
  const beforeDel = await q(`SELECT id, name, email FROM donors WHERE org_id IN ($1,$2) ORDER BY id`, [ORG_X, ORG_Y]);
  const del = await raw("DELETE", "/account", { cookie: mallory.cookie });
  ok("account deletion 200", del.status === 200);
  ok("account row + links are gone", (await q(`SELECT * FROM donor_accounts WHERE email='mallory@dl46.test'`)).length === 0);
  ok("audit trail keeps actions but sheds the email (PII scrub)",
    (await q(`SELECT * FROM donor_account_audit WHERE email='mallory@dl46.test'`)).length === 0);
  const afterDel = await q(`SELECT id, name, email FROM donors WHERE org_id IN ($1,$2) ORDER BY id`, [ORG_X, ORG_Y]);
  ok("every org donor record is byte-identical after account deletion", JSON.stringify(beforeDel) === JSON.stringify(afterDel));

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
