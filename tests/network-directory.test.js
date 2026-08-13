// BUILD-47 — find your nonprofits: the directory + the add flow + follows.
//
// The invariants under test:
//   1. The directory reveals ONLY listed orgs (enabled + network_listed) —
//      unlisted, pending-application, and delisted orgs never appear, however
//      the query is crafted (name, EIN, LIKE wildcards, SQLi shapes).
//   2. The add flow has exactly three outcomes, decided server-side, with ONE
//      response body — no shape or content oracle for "a record exists under
//      another email". History appears only via the verified-email link
//      machinery.
//   3. A follow shows a card with ZERO history figures; org-wide impact
//      updates only (never fund/campaign-targeted ones).
//   4. Follow → link conversion happens automatically on alias verify.
//   5. Unfollow removes the card, is audit-rowed, and has zero org-side
//      effect. A follow never resurfaces an org the donor explicitly hid.
//   6. Search is rate-limited (the x-test seam, S-11 discipline).
//
// Standard scratch stack booted with DONOR_ACCOUNTS_ENABLED=1. Own mail sink
// on :5602 for the verify/alias emails.

const bcrypt = require("bcryptjs");
const http = require("http");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const THIS_YEAR = String(new Date().getFullYear());
const EMAIL = "nd.donor@nd47.test";
const ALIAS = "nd.other@nd47.test";

// Five orgs spanning every listing state:
const ORGS = {
  lantern: { id: "org_nd_l1", slug: "nd-lantern", name: "Lantern House" },          // listed; donor record under EMAIL from the start
  meadow: { id: "org_nd_l2", slug: "nd-meadow", name: "Meadow Trust" },             // listed; donor record under ALIAS (conversion case); city/state/EIN
  cedar: { id: "org_nd_l3", slug: "nd-cedar", name: "Cedar Chapel" },               // listed; donor record under EMAIL created LATER (add → outcome 1)
  willow: { id: "org_nd_l4", slug: "nd-willow", name: "Willow Fund" },              // listed; never a match (follow + unfollow case)
  umbra: { id: "org_nd_u", slug: "nd-umbra", name: "Umbra Hidden Org" },            // portal ENABLED but NOT listed
  pending: { id: "org_nd_p", slug: "nd-pending", name: "Pending Applicant Org" },   // portal disabled + unlisted (pre-approval state)
  delisted: { id: "org_nd_d", slug: "nd-delist", name: "Delisted Org" },            // enabled, network_listed=false (post-delist state)
};

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
const cookieOf = (res) => {
  const m = (res.headers?.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};
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
  let parsed = null; try { parsed = JSON.parse(text); } catch { }
  return { status: r.status, text, body: parsed, headers: r.headers };
}
const dir = (cookie, query, headers) => raw("GET", `/network/directory?q=${encodeURIComponent(query)}`, { cookie, headers });

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@nd47.test'`);
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@nd47.test'`).catch(() => {});
  for (const o of Object.values(ORGS)) {
    for (const t of ["donor_org_follows", "impact_updates", "portal_audit_log", "portal_sessions", "notification_sends",
      "fin_transactions", "gifts", "interactions", "tasks", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o.id]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [o.id]).catch(() => {});
    for (const t of ["donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o.id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o.id]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const o of Object.values(ORGS)) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [o.id, o.name, o.slug]);
  }
  await q(`UPDATE orgs SET ein='11-1111147' WHERE id=$1`, [ORGS.lantern.id]);
  await q(`UPDATE orgs SET ein='12-3456789' WHERE id=$1`, [ORGS.meadow.id]);
  await q(`UPDATE orgs SET ein='98-7654321' WHERE id=$1`, [ORGS.umbra.id]); // an UNLISTED org's EIN must be unfindable
  // Listing states:
  for (const key of ["lantern", "meadow", "cedar", "willow"])
    await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORGS[key].id]);
  await q(`UPDATE portal_settings SET directory_city='Fairhope', directory_state='AL', directory_description='Land trust for the eastern shore' WHERE org_id=$1`, [ORGS.meadow.id]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,false)`, [ORGS.umbra.id]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,false,false)`, [ORGS.pending.id]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,false)`, [ORGS.delisted.id]);
  // Staff admin at meadow (for the directory-listing settings round-trip) and
  // at willow (for the zero-org-side-effect capture):
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_nd_m',$1,'nd-m@test.local',$2,'M Admin','admin')`, [ORGS.meadow.id, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_nd_w',$1,'nd-w@test.local',$2,'W Admin','admin')`, [ORGS.willow.id, hash]);
  // Donor records: lantern under EMAIL (linked at verify); meadow under ALIAS
  // (linked only after the alias verifies). Cedar's donor is inserted LATER.
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage) VALUES ('d_nd_l',$1,'ND Donor',$2,150,1,'${THIS_YEAR}-04-01','mid','steward')`, [ORGS.lantern.id, EMAIL]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_nd_l1',$1,'d_nd_l',150,'${THIS_YEAR}-04-01','cash','')`, [ORGS.lantern.id]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage) VALUES ('d_nd_m',$1,'ND Donor',$2,275.25,1,'${THIS_YEAR}-02-10','mid','steward')`, [ORGS.meadow.id, ALIAS]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_nd_m1',$1,'d_nd_m',275.25,'${THIS_YEAR}-02-10','cash','')`, [ORGS.meadow.id]);
  // Meadow impact updates: one org-wide (a follower may see it), one
  // fund-targeted (a follower must NOT — no attribution to match).
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_nd_m',$1,'Shore Fund',false)`, [ORGS.meadow.id]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,org_wide,status,targets) VALUES ('imp_nd_wide',$1,'Meadow orgwide update','For everyone.',true,'published','[]')`, [ORGS.meadow.id]);
  await q(`INSERT INTO impact_updates (id,org_id,title,body,org_wide,status,targets) VALUES ('imp_nd_fund',$1,'Meadow fund-target update','Shore Fund only.',false,'published','[{"kind":"fund","id":"fund_nd_m"}]')`, [ORGS.meadow.id]);
}

(async () => {
  const sink = await startSink();
  await fixture();

  // ── 0. auth: the directory needs a donor session ──────────────────────────
  const anon = await raw("GET", "/network/directory?q=lantern");
  ok("directory without a session → 401", anon.status === 401, anon.status);
  const anonAdd = await raw("POST", "/account/orgs/add", { body: { orgSlug: ORGS.lantern.slug } });
  ok("add without a session → 401", anonAdd.status === 401, anonAdd.status);

  // ── account: signup + verify (lantern links automatically at verify) ─────
  mail = [];
  await raw("POST", "/account/signup", { body: { email: EMAIL, password: "ndpass99999", consent: true } });
  await settle();
  const v = await raw("POST", "/account/verify", { body: { token: tokenFrom(mailTo(EMAIL)[0], "verify") } });
  ok("verify links the exact-match org (lantern)", v.status === 200 && v.body.linkedOrgs === 1, v.body);
  const cookie = cookieOf(v);

  // ── 1. directory scoping: listed orgs only, however the query is shaped ──
  const byName = await dir(cookie, "Lantern");
  ok("search by name finds a listed org", byName.body?.results?.some(r => r.orgSlug === ORGS.lantern.slug), byName.text);
  const byCity = await dir(cookie, "Fairhope");
  ok("search by city finds the listed org that set it", byCity.body?.results?.some(r => r.orgSlug === ORGS.meadow.slug), byCity.text);
  const byState = await dir(cookie, "AL");
  ok("search by state finds it too", byState.body?.results?.some(r => r.orgSlug === ORGS.meadow.slug), byState.text);
  ok("the org-set description rides the result", byCity.body.results.find(r => r.orgSlug === ORGS.meadow.slug).description === "Land trust for the eastern shore");
  const byEin = await dir(cookie, "12-3456789");
  ok("search by formatted EIN finds the listed org", byEin.body?.results?.some(r => r.orgSlug === ORGS.meadow.slug), byEin.text);
  const byEinBare = await dir(cookie, "123456789");
  ok("search by bare-digit EIN finds it too", byEinBare.body?.results?.some(r => r.orgSlug === ORGS.meadow.slug));

  // The three invisible states — by exact name AND by EIN:
  for (const [label, query] of [
    ["unlisted org by exact name", "Umbra Hidden Org"],
    ["unlisted org by its EIN", "98-7654321"],
    ["pending-application org by exact name", "Pending Applicant Org"],
    ["delisted org by exact name", "Delisted Org"],
  ]) {
    const r = await dir(cookie, query);
    ok(`${label} → never in the directory`, r.status === 200 && r.body.results.length === 0, r.text);
  }
  // Hostile shapes: wildcards and SQLi must neither error nor over-match.
  for (const hostile of ["%", "__", "%%%%", "' OR 1=1 --", "Umbra%", "%Hidden%", "nd-umbra", `" OR ""="`]) {
    const r = await dir(cookie, hostile);
    ok(`hostile query ${JSON.stringify(hostile)} → 200 with zero leakage`,
      r.status === 200 && (r.body.results || []).every(x => [ORGS.lantern.slug, ORGS.meadow.slug, ORGS.cedar.slug, ORGS.willow.slug].includes(x.orgSlug)),
      r.text);
  }
  // Result rows carry ONLY listing-card fields — no donor-adjacent anything.
  const rowKeys = Object.keys(byName.body.results[0]).sort();
  ok("directory rows carry only listing-card fields",
    JSON.stringify(rowKeys) === JSON.stringify(["accent", "city", "description", "followed", "linked", "logo", "name", "orgSlug", "primary", "state"]), rowKeys);
  const short = await dir(cookie, "a");
  ok("sub-2-char query returns nothing (no browse-the-network probe)", short.body.results.length === 0 && short.body.total === 0);

  // ── 2. the add flow: three outcomes, one response ─────────────────────────
  // Outcome 2 first: meadow (no verified email matches its donor record).
  const add2 = await raw("POST", "/account/orgs/add", { cookie, body: { orgSlug: ORGS.meadow.slug } });
  ok("add with no match → 200", add2.status === 200, add2.text);
  let dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  ok("no-match add lands as a FOLLOWED card", dash.followed.some(f => f.orgSlug === ORGS.meadow.slug), dash.followed);
  ok("a followed card is NOT in the history list", !dash.orgs.some(o => o.orgSlug === ORGS.meadow.slug));
  const fCard = dash.followed.find(f => f.orgSlug === ORGS.meadow.slug);
  ok("followed card carries NO history figures (no $0 rows pretending)",
    fCard.ytd === undefined && fCard.lifetime === undefined && fCard.lastGiftDate === undefined, fCard);
  ok("followed card text never leaks the real record's totals", !JSON.stringify(dash.followed).includes("275.25"));
  ok("follower sees the org-wide impact update", dash.impact.some(u => u.id === "imp_nd_wide"), dash.impact.map(u => u.id));
  ok("follower NEVER sees a fund-targeted impact update", !dash.impact.some(u => u.id === "imp_nd_fund"));

  // Outcome 1: cedar gains a donor record under the verified email FIRST,
  // then the donor adds it — the link job runs on demand, full history.
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,last_gift_date,status,stage) VALUES ('d_nd_c',$1,'ND Donor',$2,940,2,'${THIS_YEAR}-06-15','major','steward')`, [ORGS.cedar.id, EMAIL]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_nd_c1',$1,'d_nd_c',640,'${THIS_YEAR}-06-15','cash','')`, [ORGS.cedar.id]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_nd_c2',$1,'d_nd_c',300,'${THIS_YEAR - 1}-03-05','cash','')`, [ORGS.cedar.id]);
  const add1 = await raw("POST", "/account/orgs/add", { cookie, body: { orgSlug: ORGS.cedar.slug } });
  ok("add with a verified-email match → 200", add1.status === 200, add1.text);
  ok("outcomes 1 and 2 return BYTE-IDENTICAL bodies (no match oracle)", add1.text === add2.text, { add1: add1.text, add2: add2.text });
  dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  const cedarCard = dash.orgs.find(o => o.orgSlug === ORGS.cedar.slug);
  ok("matched add appears with FULL history", !!cedarCard && cedarCard.ytd === 640 && cedarCard.lifetime === 940, cedarCard);
  ok("matched add is not doubled as a followed card", !dash.followed.some(f => f.orgSlug === ORGS.cedar.slug));

  // Unaddable states 404 with NO follow row planted:
  for (const slug of [ORGS.umbra.slug, ORGS.pending.slug, ORGS.delisted.slug, "no-such-org"]) {
    const r = await raw("POST", "/account/orgs/add", { cookie, body: { orgSlug: slug } });
    ok(`add ${slug} → 404`, r.status === 404, r.status);
  }
  const planted = await q(`SELECT COUNT(*)::int AS n FROM donor_org_follows WHERE org_id = ANY($1)`, [[ORGS.umbra.id, ORGS.pending.id, ORGS.delisted.id]]);
  ok("no follow row planted for unaddable orgs", planted[0].n === 0);

  // Directory annotation reflects the caller's own state:
  const annotated = await dir(cookie, "nd donor should not match anything"); // sanity: no over-match
  ok("free-text noise query stays empty", annotated.body.results.length === 0);
  const cedarRow = (await dir(cookie, "Cedar")).body.results.find(r => r.orgSlug === ORGS.cedar.slug);
  const meadowRow = (await dir(cookie, "Meadow")).body.results.find(r => r.orgSlug === ORGS.meadow.slug);
  ok("directory marks a linked org as linked", cedarRow.linked === true && cedarRow.followed === false);
  ok("directory marks a followed org as followed", meadowRow.linked === false && meadowRow.followed === true);

  // ── 3. follow → link conversion on alias verify (outcome 3) ──────────────
  mail = [];
  await raw("POST", "/account/aliases", { cookie, body: { email: ALIAS } });
  await settle();
  const av = await raw("POST", "/account/aliases/verify", { body: { token: tokenFrom(mailTo(ALIAS)[0], "confirm-alias") } });
  ok("alias verify links the followed org's record", av.status === 200 && av.body.linkedOrgs === 1, av.body);
  dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  const meadowCard = dash.orgs.find(o => o.orgSlug === ORGS.meadow.slug);
  ok("the follow CONVERTED: meadow now shows full history", !!meadowCard && meadowCard.lifetime === 275.25, meadowCard);
  ok("the followed card is gone after conversion", !dash.followed.some(f => f.orgSlug === ORGS.meadow.slug));
  const me = (await raw("GET", "/account/me", { cookie })).body;
  ok("/me reports the follow as converted", me.follows.find(f => f.orgSlug === ORGS.meadow.slug)?.converted === true, me.follows);

  // ── 4. unfollow: card gone, audit-rowed, ZERO org-side effect ────────────
  const willowBefore = await q(
    `SELECT (SELECT COUNT(*) FROM portal_audit_log WHERE org_id=$1)::int AS audit,
            (SELECT COUNT(*) FROM interactions WHERE org_id=$1)::int AS interactions,
            (SELECT COUNT(*) FROM notification_sends WHERE org_id=$1)::int AS sends,
            (SELECT COUNT(*) FROM tasks WHERE org_id=$1)::int AS tasks`, [ORGS.willow.id]);
  await raw("POST", "/account/orgs/add", { cookie, body: { orgSlug: ORGS.willow.slug } });
  dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  const willowFollow = dash.followed.find(f => f.orgSlug === ORGS.willow.slug);
  ok("willow followed", !!willowFollow);
  const un = await raw("DELETE", `/account/follows/${willowFollow.followId}`, { cookie });
  ok("unfollow → 200", un.status === 200, un.text);
  dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  ok("unfollow removes the card", !dash.followed.some(f => f.orgSlug === ORGS.willow.slug));
  const auditRow = await q(`SELECT COUNT(*)::int AS n FROM donor_account_audit WHERE action='unfollowed' AND email=$1`, [EMAIL]);
  ok("unfollow is audit-rowed", auditRow[0].n >= 1);
  const willowAfter = await q(
    `SELECT (SELECT COUNT(*) FROM portal_audit_log WHERE org_id=$1)::int AS audit,
            (SELECT COUNT(*) FROM interactions WHERE org_id=$1)::int AS interactions,
            (SELECT COUNT(*) FROM notification_sends WHERE org_id=$1)::int AS sends,
            (SELECT COUNT(*) FROM tasks WHERE org_id=$1)::int AS tasks`, [ORGS.willow.id]);
  ok("follow + unfollow left the ORG side byte-untouched", JSON.stringify(willowBefore) === JSON.stringify(willowAfter), { willowBefore, willowAfter });
  const gone = await raw("DELETE", `/account/follows/${willowFollow.followId}`, { cookie });
  ok("double-unfollow → 404", gone.status === 404);

  // ── 5. a follow never resurfaces an org the donor HID ────────────────────
  const cedarLink = me.links.find(l => l.orgSlug === ORGS.cedar.slug);
  await raw("POST", `/account/links/${cedarLink.id}/unlink`, { cookie });
  dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  ok("hidden org is out of the history list", !dash.orgs.some(o => o.orgSlug === ORGS.cedar.slug));
  ok("…and its old follow does NOT resurface it as a followed card", !dash.followed.some(f => f.orgSlug === ORGS.cedar.slug));
  // An explicit directory re-add IS donor intent — it relinks:
  await raw("POST", "/account/orgs/add", { cookie, body: { orgSlug: ORGS.cedar.slug } });
  dash = (await raw("GET", "/account/dashboard", { cookie })).body;
  ok("explicit re-add relinks the hidden org with full history", dash.orgs.find(o => o.orgSlug === ORGS.cedar.slug)?.lifetime === 940);

  // ── 6. the org side can edit its listing card (and only its own) ─────────
  const staffTok = (await api("POST", "/auth/login", null, { email: "nd-m@test.local", password: "loadtest1234" })).body.token;
  const put = await raw("PUT", "/portal-settings", { token: staffTok, body: { directoryDescription: "Updated shore line", directoryCity: "Daphne", directoryState: "AL" } });
  ok("org admin edits its directory card", put.status === 200 && put.body.directory_description === "Updated shore line", put.text);
  const afterEdit = await dir(cookie, "Daphne");
  ok("the edit is live in the directory", afterEdit.body.results.some(r => r.orgSlug === ORGS.meadow.slug && r.description === "Updated shore line"));

  // ── 7. search rate limit (the x-test seam) ───────────────────────────────
  const bucket = "ndburst-" + Date.now();
  let last = null;
  for (let i = 0; i < 121; i++) {
    last = await dir(cookie, "Lantern", { "x-test-enforce-limits": "1", "x-test-limit-bucket": bucket });
    if (last.status === 429) break;
  }
  ok("directory search rate-limits a burst", last.status === 429, last.status);
  const addBucket = "ndaddburst-" + Date.now();
  for (let i = 0; i < 31; i++) {
    last = await raw("POST", "/account/orgs/add", { cookie, body: { orgSlug: ORGS.willow.slug }, headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": addBucket } });
    if (last.status === 429) break;
  }
  ok("the add flow rate-limits a burst", last.status === 429, last.status);

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
