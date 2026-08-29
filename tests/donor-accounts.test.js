// BUILD-46 §1.1 — global donor accounts: signup/verify/login/reset lifecycle,
// the full BUILD-37 §1 checklist (no enumeration, single-use short-lived
// tokens, session invalidation on password AND email change, email-change
// confirmed at the OLD address), S-11 scripted rate-limit bursts, and the
// queued failure-visible path for every account-lifecycle email.
//
// Also proves the FEATURE FLAGS (mid-run rule): a child server booted WITHOUT
// DONOR_ACCOUNTS_ENABLED/NETWORK_SIGNUP_ENABLED serves 404s for every account/
// signup surface — prod (flags unset) is byte-identical to BUILD-45.
//
// Local scratch server + Postgres, booted with the standard run-all env PLUS
// DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1. Starts its own mail sink
// on :5602.

const bcrypt = require("bcryptjs");
const http = require("http");
const { spawn } = require("child_process");
const { BASE, ok, summary, api, q, closeDb, SINK_PORT, STRIPE_MOCK_PORT } = require("./helpers");

const ORG_A = "org_da_a", SLUG_A = "donacct-a";
const ORG_B = "org_da_b", SLUG_B = "donacct-b";
const EMAIL = "casey@giver.test";
const THIS_YEAR = String(new Date().getFullYear());

let mail = [];
let sinkServer = null;
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
const tokenFrom = (m, kind) => {
  const rx = new RegExp(`${kind}#token=([A-Za-z0-9_-]+)`);
  const hit = rx.exec(m?.html || "");
  return hit ? hit[1] : null;
};

function cookieOf(res) {
  const sc = res.headers?.get ? res.headers.get("set-cookie") : null;
  if (!sc) return null;
  const m = sc.match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function raw(method, path, { cookie, body, headers, base } = {}) {
  const r = await fetch((base || BASE) + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { }
  return { status: r.status, body: parsed, headers: r.headers };
}

async function fixture() {
  await q(`DELETE FROM donor_account_audit WHERE email LIKE '%@giver.test' OR email LIKE '%@da46.test' OR account_id IN (SELECT id FROM donor_accounts WHERE email LIKE '%giver.test' OR email LIKE '%da46.test')`).catch(() => {});
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@giver.test' OR email LIKE '%@da46.test'`);
  await q(`DELETE FROM notification_failures WHERE recipient_email LIKE '%@giver.test' OR recipient_email LIKE '%@da46.test'`);
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["portal_audit_log", "portal_sessions", "portal_magic_links", "gifts", "interactions", "recurring_subscriptions", "receipts"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Acct Org A','${SLUG_A}',1,'active','core')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Acct Org B','${SLUG_B}',1,'active','core')`, [ORG_B]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORG_A]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,true)`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_da_a',$1,'da-admin@test.local',$2,'A Admin','admin')`, [ORG_A, hash]);
  // Casey gives at BOTH orgs (case-varied email in B — folding must match it).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_daA_c',$1,'Casey Giver',$2,'mid','steward',300,2)`, [ORG_A, EMAIL]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_daB_c',$1,'Casey Giver','CASEY@GIVER.TEST','new','cultivate',50,1)`, [ORG_B]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_daA_1',$1,'d_daA_c',300,'${THIS_YEAR}-03-01','cash','')`, [ORG_A]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_daB_1',$1,'d_daB_c',50,'${THIS_YEAR}-04-01','cash','')`, [ORG_B]);
}

(async () => {
  sinkServer = await startSink();

  await fixture();

  // ── signup: identical response, queued email, verification ───────────────
  mail = [];
  ok("signup without consent → 400 consent_required (go-live legal posture)",
    (await raw("POST", "/account/signup", { body: { email: EMAIL, password: "firstpass99" } })).body?.error === "consent_required");
  const s1 = await raw("POST", "/account/signup", { body: { email: EMAIL, password: "firstpass99", consent: true } });
  await settle();
  ok("signup 200 with a neutral body", s1.status === 200 && s1.body.received === true, s1.body);
  // The signup send rides the fire-and-forget queued path behind a cost-12
  // bcrypt hash — on a contended CI runner it can outlast one settle() (hit
  // twice on 2026-08-16). Poll up to ~8s instead of racing a fixed wait.
  for (let i = 0; i < 16 && mailTo(EMAIL).length === 0; i++) await settle();
  ok("verification email sent to the address", mailTo(EMAIL).length === 1, mailTo(EMAIL).length);
  const s2 = await raw("POST", "/account/signup", { body: { email: EMAIL, password: "differentpw1", consent: true } });
  await settle();
  ok("second signup for the SAME email: byte-identical response (no enumeration)",
    JSON.stringify(s2.body) === JSON.stringify(s1.body) && s2.status === s1.status);
  ok("…but the email says 'you already have an account', not a second verify link",
    mailTo(EMAIL).length === 2 && /already have one/i.test(mailTo(EMAIL)[1].html), mailTo(EMAIL)[1]?.subject);

  ok("verify with a garbage token → 400", (await raw("POST", "/account/verify", { body: { token: "nope" } })).status === 400);
  const vTok = tokenFrom(mailTo(EMAIL)[0], "verify");
  const v1 = await raw("POST", "/account/verify", { body: { token: vTok } });
  ok("verify consumes the token and LINKS both orgs' donor records (exact email, case-folded)",
    v1.status === 200 && v1.body.linkedOrgs === 2, v1.body);
  const sc = v1.headers.get("set-cookie") || "";
  ok("verify mints a session: HttpOnly + Secure + SameSite=Lax", /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Lax/i.test(sc), sc.slice(0, 80));
  ok("verify token is single-use", (await raw("POST", "/account/verify", { body: { token: vTok } })).status === 400);
  const cookie1 = cookieOf(v1);
  const me1 = await raw("GET", "/account/me", { cookie: cookie1 });
  ok("/account/me shows both links, verified, password set",
    me1.status === 200 && me1.body.verified === true && me1.body.hasPassword === true && me1.body.links.length === 2, me1.body.links);

  // ── login: one generic failure for every wrong case (no enumeration) ─────
  const wrongPw = await raw("POST", "/account/login", { body: { email: EMAIL, password: "WRONG" } });
  const unknown = await raw("POST", "/account/login", { body: { email: "ghost@giver.test", password: "whatever9" } });
  ok("wrong-password and unknown-email failures are byte-identical",
    wrongPw.status === 401 && unknown.status === 401 && JSON.stringify(wrongPw.body) === JSON.stringify(unknown.body));
  // unverified account failure is byte-identical too
  mail = [];
  await raw("POST", "/account/signup", { body: { email: "unverified@da46.test", password: "meantwell99", consent: true } });
  await settle();
  const unverified = await raw("POST", "/account/login", { body: { email: "unverified@da46.test", password: "meantwell99" } });
  ok("unverified-email login failure is byte-identical to the others",
    unverified.status === 401 && JSON.stringify(unverified.body) === JSON.stringify(wrongPw.body));
  await settle();
  ok("…and it quietly re-sent the verification email", mailTo("unverified@da46.test").length === 2, mailTo("unverified@da46.test").length);

  const login1 = await raw("POST", "/account/login", { body: { email: "CASEY@giver.test  ", password: "firstpass99" } });
  ok("login folds the email and mints a session", login1.status === 200 && !!cookieOf(login1));

  // ── password change invalidates every OTHER session ──────────────────────
  const loginA = await raw("POST", "/account/login", { body: { email: EMAIL, password: "firstpass99" } });
  const loginB = await raw("POST", "/account/login", { body: { email: EMAIL, password: "firstpass99" } });
  const cA = cookieOf(loginA), cB = cookieOf(loginB);
  const chg = await raw("POST", "/account/change-password", { cookie: cA, body: { current: "firstpass99", next: "secondpass99" } });
  ok("change-password 200 (correct current)", chg.status === 200, chg.body);
  ok("the changing session survives", (await raw("GET", "/account/me", { cookie: cA })).status === 200);
  ok("every OTHER session is dead", (await raw("GET", "/account/me", { cookie: cB })).status === 401);
  ok("change-password requires the current password",
    (await raw("POST", "/account/change-password", { cookie: cA, body: { current: "WRONG", next: "xxxxxxxxx" } })).status === 401);

  // ── reset: no enumeration, single-use, ≤60min, supersede, all sessions die ─
  mail = [];
  const rr1 = await raw("POST", "/account/request-reset", { body: { email: EMAIL } });
  const rr2 = await raw("POST", "/account/request-reset", { body: { email: "ghost@giver.test" } });
  await settle();
  ok("reset request: identical response for known and unknown email",
    JSON.stringify(rr1.body) === JSON.stringify(rr2.body) && rr1.status === rr2.status);
  ok("…and only the real account got an email", mailTo(EMAIL).length === 1 && mailTo("ghost@giver.test").length === 0);
  const rTok1 = tokenFrom(mailTo(EMAIL)[0], "reset");
  await raw("POST", "/account/request-reset", { body: { email: EMAIL } });
  await settle();
  const rTok2 = tokenFrom(mailTo(EMAIL)[1], "reset");
  ok("a re-request SUPERSEDES the prior token", (await raw("POST", "/account/reset", { body: { token: rTok1, password: "should-not-work1" } })).status === 400);
  const rs = await raw("POST", "/account/reset", { body: { token: rTok2, password: "thirdpass999" } });
  ok("the live token resets the password", rs.status === 200, rs.body);
  ok("reset token is single-use", (await raw("POST", "/account/reset", { body: { token: rTok2, password: "again12345" } })).status === 400);
  ok("password change via reset killed the pre-reset sessions", (await raw("GET", "/account/me", { cookie: cA })).status === 401);
  ok("old password no longer works", (await raw("POST", "/account/login", { body: { email: EMAIL, password: "secondpass99" } })).status === 401);
  const login3 = await raw("POST", "/account/login", { body: { email: EMAIL, password: "thirdpass999" } });
  ok("new password works", login3.status === 200);
  const c3 = cookieOf(login3);

  // ── email change: confirmed at the OLD address; new address must verify ──
  mail = [];
  await raw("POST", "/account/change-email", { cookie: c3, body: { email: "casey-new@da46.test" } });
  await settle();
  ok("the change-confirmation goes to the OLD address", mailTo(EMAIL).length === 1 && mailTo("casey-new@da46.test").length === 0, mail.map(m => m.to));
  const ecTok = tokenFrom(mailTo(EMAIL)[0], "confirm-email");
  const ec = await raw("POST", "/account/change-email/confirm", { body: { token: ecTok } });
  await settle();
  ok("confirm at old address flips the email", ec.status === 200, ec.body);
  ok("…kills every session", (await raw("GET", "/account/me", { cookie: c3 })).status === 401);
  ok("…and the NEW address must verify from its own inbox before anything links",
    mailTo("casey-new@da46.test").length === 1 && /verify#token=/.test(mailTo("casey-new@da46.test")[0].html));
  const nvTok = tokenFrom(mailTo("casey-new@da46.test")[0], "verify");
  const nv = await raw("POST", "/account/verify", { body: { token: nvTok } });
  ok("new email verifies (its own proof of control) and links nothing extra (no donors under it)",
    nv.status === 200 && nv.body.linkedOrgs === 0, nv.body);
  const meAfter = await raw("GET", "/account/me", { cookie: cookieOf(nv) });
  ok("original links survive the email change (they were made under proof at the time)",
    meAfter.status === 200 && meAfter.body.links.length === 2 && meAfter.body.email === "casey-new@da46.test", meAfter.body.email);

  // ── magic link and password mint the SAME session (account-stamped) ──────
  mail = [];
  await raw("POST", `/portal/${SLUG_A}/request-link`, { body: { email: EMAIL } });
  await settle();
  const mlTok = /verify#token=([A-Za-z0-9_-]+)/.exec(mailTo(EMAIL)[0]?.html || "")?.[1];
  ok("magic link still sends for the org portal (BUILD-45 unchanged)", !!mlTok);
  const mlv = await raw("POST", `/portal/${SLUG_A}/verify`, { body: { token: mlTok } });
  const mlCookie = cookieOf(mlv);
  ok("magic-link session works on the org portal", (await raw("GET", `/portal/${SLUG_A}/me`, { cookie: mlCookie })).status === 200);
  // ── the discovery on-ramp gate: /me.account only for LISTED orgs ─────────
  // (network_listed is the org's opt-in; an unlisted org's portal must never
  // mention a cross-org account — its page stays entirely its own.)
  {
    const meListed = await raw("GET", `/portal/${SLUG_A}/me`, { cookie: mlCookie });
    ok("listed org + flag on → /me.account present and carries the session email (signup prefill)",
      !!meListed.body.account && meListed.body.account.email === EMAIL && meListed.body.account.exists === false,
      meListed.body.account);
    await q(`UPDATE portal_settings SET network_listed=false WHERE org_id=$1`, [ORG_A]);
    const meUnlisted = await raw("GET", `/portal/${SLUG_A}/me`, { cookie: mlCookie });
    ok("listing OFF → /me.account is null even with the flag on (portal stays the org's own page)",
      meUnlisted.status === 200 && meUnlisted.body.account === null, meUnlisted.body.account);
    await q(`UPDATE portal_settings SET network_listed=true WHERE org_id=$1`, [ORG_A]);
  }
  // EMAIL still belongs to the account? No — the account's email CHANGED to
  // casey-new. A magic-link by the OLD address must NOT open the account.
  ok("a magic-link session for an email the account no longer holds does NOT open the dashboard",
    (await raw("GET", "/account/dashboard", { cookie: mlCookie })).status === 401);
  // …but one for a CURRENT account email does (same-session rule).
  await q(`UPDATE donors SET email='casey-new@da46.test' WHERE id='d_daA_c'`);
  mail = [];
  await raw("POST", `/portal/${SLUG_A}/request-link`, { body: { email: "casey-new@da46.test" } });
  await settle();
  const mlTok2 = /verify#token=([A-Za-z0-9_-]+)/.exec(mailTo("casey-new@da46.test")[0]?.html || "")?.[1];
  const mlv2 = await raw("POST", `/portal/${SLUG_A}/verify`, { body: { token: mlTok2 } });
  const mlCookie2 = cookieOf(mlv2);
  ok("a magic-link session for a verified account email opens BOTH the org portal and the dashboard",
    (await raw("GET", `/portal/${SLUG_A}/me`, { cookie: mlCookie2 })).status === 200 &&
    (await raw("GET", "/account/dashboard", { cookie: mlCookie2 })).status === 200);

  // ── queued lifecycle emails: failure is visible, retried, delivered ──────
  sinkServer.close(); await settle(300); // provider down
  const [{ c: failsBefore }] = await q(`SELECT COUNT(*)::int c FROM notification_failures WHERE org_id='donor-network'`);
  await raw("POST", "/account/request-reset", { body: { email: "casey-new@da46.test" } });
  await settle(800);
  const [{ c: failsAfter }] = await q(`SELECT COUNT(*)::int c FROM notification_failures WHERE org_id='donor-network'`);
  ok("a failed reset email is QUEUED, not lost (notification_failures row)", failsAfter === failsBefore + 1, { failsBefore, failsAfter });
  const health = await raw("GET", "/health");
  ok("…and surfaced on /health.notifications.failedPending", health.body.notifications.failedPending >= 1, health.body.notifications);
  mail = []; sinkServer = await startSink(); // provider back
  const adminTok = (await api("POST", "/auth/login", null, { email: "da-admin@test.local", password: "loadtest1234" })).body.token;
  const retry = await api("POST", "/admin/notifications/retry", adminTok, { force: true });
  await settle(500);
  ok("the retry sweep delivers the once-failed reset email", retry.status === 200 && mailTo("casey-new@da46.test").length >= 1, mail.map(m => m.subject));
  const [{ c: failsFinal }] = await q(`SELECT COUNT(*)::int c FROM notification_failures WHERE org_id='donor-network'`);
  ok("…and clears the failure row", failsFinal === failsBefore, { failsFinal, failsBefore });
  const rescueTok = tokenFrom(mailTo("casey-new@da46.test")[0], "reset");
  ok("the retried email's token WORKS (the donor is never locked out)",
    (await raw("POST", "/account/reset", { body: { token: rescueTok, password: "fourthpass99" } })).status === 200);

  // ── S-11 scripted bursts against the REAL limiters ───────────────────────
  const burst = async (path, bodyFn, n) => {
    let limited = 0;
    for (let i = 0; i < n; i++) {
      const r = await raw("POST", path, { body: bodyFn(i), headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": "s11-" + path } });
      if (r.status === 429) limited++;
    }
    return limited;
  };
  ok("S-11: login burst rate-limits by IP bucket", (await burst("/account/login", i => ({ email: `b${i}@giver.test`, password: "xxxxxxxxx" }), 40)) > 0);
  ok("S-11: signup burst rate-limits", (await burst("/account/signup", i => ({ email: `burst${i}@giver.test`, password: "xxxxxxxxx", consent: true }), 40)) > 0);
  ok("S-11: per-EMAIL reset burst rate-limits (account-keyed, not just IP)",
    (await (async () => {
      let limited = 0;
      for (let i = 0; i < 12; i++) {
        const r = await raw("POST", "/account/request-reset", { body: { email: "casey-new@da46.test" }, headers: { "x-test-enforce-limits": "1", "x-test-limit-bucket": "s11-em-" + i } });
        if (r.status === 429) limited++;
      }
      return limited;
    })()) > 0);

  // ── feature flags: a no-flag server is BUILD-45, byte for byte ───────────
  const child = spawn("node", ["server.js"], {
    cwd: __dirname + "/..",
    env: {
      ...process.env, PORT: "5611",
      // Same default as tests/helpers.js — the parent battery may not export
      // DATABASE_URL (each suite defaults it internally), but the child needs
      // it in env or pg falls back to a nonexistent local socket and /health
      // never goes ok ("flag-off child server boots" flake).
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest",
      DB_SSL: "disable",
      // The child lives ~20s inside this suite; with ticks on, its 5s
      // dunning/pledge sweeps could mail into our :5602 sink mid-assertions.
      DISABLE_BACKGROUND_TICKS: "1",
      JWT_SECRET: "local-test-secret", DISABLE_RATE_LIMIT: "1", SESSION_CACHE_TTL_MS: "0",
      RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: `http://localhost:${SINK_PORT}`,
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_localtest",
      STRIPE_API_BASE: `http://localhost:${STRIPE_MOCK_PORT}`,
      DONOR_ACCOUNTS_ENABLED: "", NETWORK_SIGNUP_ENABLED: "",
    },
    stdio: "ignore",
  });
  let childUp = false;
  for (let i = 0; i < 40; i++) {
    await settle(500);
    try { const h = await fetch("http://localhost:5611/health"); if (h.ok) { childUp = true; break; } } catch { }
  }
  ok("flag-off child server boots", childUp);
  if (childUp) {
    const off1 = await raw("POST", "/account/signup", { base: "http://localhost:5611", body: { email: "x@y.test", password: "xxxxxxxxx" } });
    const off404 = await raw("GET", "/definitely-not-a-route", { base: "http://localhost:5611" });
    ok("flags off: /account/* is INVISIBLE (byte-identical to an unknown route)",
      off1.status === 404 && JSON.stringify(off1.body) === JSON.stringify(off404.body), off1.body);
    ok("flags off: /network/signup is invisible",
      (await raw("POST", "/network/signup", { base: "http://localhost:5611", body: {} })).status === 404);
    const cfg = await raw("GET", "/network/config", { base: "http://localhost:5611" });
    ok("flags off: /network/config reports both surfaces off", cfg.body.donorAccounts === false && cfg.body.networkSignup === false, cfg.body);
    // magic-link session on the flag-off server carries NO account stamp
    mail = [];
    await raw("POST", `/portal/${SLUG_A}/request-link`, { base: "http://localhost:5611", body: { email: "casey-new@da46.test" } });
    await settle(700);
    const offTok = /verify#token=([A-Za-z0-9_-]+)/.exec(mailTo("casey-new@da46.test")[0]?.html || "")?.[1];
    const offV = await raw("POST", `/portal/${SLUG_A}/verify`, { base: "http://localhost:5611", body: { token: offTok } });
    ok("flags off: magic-link verify still works (BUILD-45 path untouched)", offV.status === 200, offV.status);
    const [sess] = await q(`SELECT donor_account_id FROM portal_sessions WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [ORG_A]);
    ok("flags off: the minted session carries NO donor_account_id", sess && sess.donor_account_id === null, sess);
  }
  child.kill();

  if (sinkServer) sinkServer.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
