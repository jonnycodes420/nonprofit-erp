// tests/auth-revocation.test.js — FIX-AUTH. THE ONE GUARD THIS FIX EARNED.
//
// `sessions_valid_after` is a SECURITY CONTROL: a password change, a role
// change, a removal or a deactivation all bump it, and every token issued
// before that moment stops working. The server has always honoured it.
//
// THE CLIENT DID NOT. It held an ALLOWLIST of three error codes
// (`token_expired`, `invalid_token`, `no_token`) and requireAuth returns SIX.
// A revoked session, a removed account and a deleted user all came back 401
// with a code the client had never heard of, so it never cleared the stale
// token and never sent anybody to /login: the app sat on "Failed to connect"
// with a Retry button that could not possibly work. Found live on 2026-09-28,
// showing requireAuth's own `session_revoked` words on the outage screen.
//
// That is a revocation the product refused to act on, which is why this
// earns a suite rather than a comment.
//
// WHAT IT PINS, and why it cannot rot the same way:
//   1. Every 401 `auth.js` can return is actually reachable and typed.
//   2. A revoked session really is refused, end to end, against a live server.
//   3. The client no longer decides by code at all: any 401 on a request that
//      carried a token clears the session. A SEVENTH code tomorrow is handled
//      the day it ships.
//
// HOW IT WOULD GO RED. Put the allowlist back; stop clearing the token; or
// add a 401 branch to auth.js that the client's one rule cannot cover.
// (Verified: with the pre-fix api.js in place, §3 goes red.)
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const ORG = "org_authrev";
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

(async () => {
  console.log("FIX-AUTH — a revoked session is refused, and the client acts on it\n");

  // ── §1 · every 401 the server can answer with ───────────────────────────
  const authSrc = read("auth.js");
  const codes = [...authSrc.matchAll(/status\(401\)\.json\(\{\s*error:\s*"([a-z_]+)"/g)].map(m => m[1]);
  console.log("— §1 · the codes requireAuth can return —");
  ok("requireAuth answers 401 with a TYPED code, never a bare message", codes.length >= 6, codes);
  for (const want of ["no_token", "token_expired", "invalid_token", "user_not_found",
                      "account_deactivated", "session_revoked"]) {
    ok(`  ${want} is one of them`, codes.includes(want), codes);
  }

  // ── §2 · a revoked session is really refused ────────────────────────────
  console.log("\n— §2 · end to end, against a live server —");
  for (const t of ["fin_audit_log", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Revocation Trust','auth-rev',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_authrev',$1,'authrev@test.local',$2,'Rev Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);

  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "authrev@test.local", password: "loadtest1234" }) });
  const login = await r.json();
  ok("a fresh sign-in gives a token", !!login.token);
  const before = await api("GET", "/org", login.token);
  ok("…and that token works", before.status === 200, before.status);

  // Exactly what a password change, a role change or a removal does.
  await q(`UPDATE users SET sessions_valid_after = NOW() + INTERVAL '1 minute' WHERE id='u_authrev'`);
  const after = await api("GET", "/org", login.token);
  ok("a revoked session is refused with 401", after.status === 401, after.status);
  ok("…and says session_revoked, not a bare 401", after.body?.error === "session_revoked", after.body);

  // A removed account, the same way.
  await q(`UPDATE users SET sessions_valid_after = NOW() - INTERVAL '1 day', deactivated_at = NOW() WHERE id='u_authrev'`);
  const gone = await api("GET", "/org", login.token);
  ok("a removed account is refused too", gone.status === 401 && gone.body?.error === "account_deactivated", gone.body);

  // ── §3 · THE CLIENT ACTS ON ALL OF THEM ─────────────────────────────────
  // The regression was a LIST, so what is pinned is that there is no longer a
  // list to fall behind: the client decides on the 401 and the token it sent.
  console.log("\n— §3 · the client no longer decides by code —");
  const apiSrc = read("client/src/api.js");
  ok("a 401 on a request that carried a token clears the session",
    /res\.status === 401 && token\)\s*\{\s*\n\s*handleAuthFailure/.test(apiSrc),
    (apiSrc.match(/res\.status === 401[^\n]*/g) || []).slice(0, 3));
  ok("there is no allowlist of auth codes left to fall behind",
    !/AUTH_ERROR_CODES/.test(apiSrc) && !/function isAuthError/.test(apiSrc));
  ok("the session is cleared from storage, not merely redirected away from",
    /handleAuthFailure[\s\S]{0,400}removeItem\("npe_token"\)/.test(apiSrc));
  ok("every code the server can send has words a person can act on, or a fallback",
    /AUTH_MESSAGES/.test(apiSrc) && /AUTH_FALLBACK_MESSAGE/.test(apiSrc));
  // And the screen: a sign-out must not be painted as an outage.
  const appSrc = read("client/src/App.jsx");
  // Against the BRANCH, not the string: "Failed to connect" also appears in a
  // comment four hundred lines earlier, and matching that made this assertion
  // red for a reason that had nothing to do with the order of the branches.
  const leavingAt = appSrc.indexOf("if(leavingForLogin())");
  const outageAt = appSrc.indexOf("if(loadErr||!data)");
  ok("a pending sign-out is checked BEFORE the 'Failed to connect' branch",
    leavingAt > 0 && outageAt > 0 && leavingAt < outageAt, { leavingAt, outageAt });
  ok("…and the streaming path follows the same rule",
    /res\.status === 401 && token\)[\s\S]{0,200}handleAuthFailure/.test(apiSrc.slice(apiSrc.indexOf("streamAI"))));

  for (const t of ["fin_audit_log", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
