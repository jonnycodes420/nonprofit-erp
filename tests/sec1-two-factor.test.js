// tests/sec1-two-factor.test.js — SEC-1. THE ONE GUARD THIS BUILD EARNED.
//
//     A USER WITH TWO-FACTOR ON GETS NO SESSION FROM A CORRECT PASSWORD ALONE,
//     AND A SESSION SIGNED OUT FROM SETTINGS IS REJECTED ON ITS VERY NEXT
//     REQUEST.
//
// HOW IT WOULD GO RED: mint the token before checking the code; create the
// session row before the code passes; check the session row only on a cache
// miss and forget to drop it on sign-out; let a token without a live session
// row through. Proven able to fail: skipping the sid check in auth.js turns §2
// red; issuing the session before the code check turns §1 red.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const TOTP = require("../totp");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");

const ORG = "org_sec1";
const EMAIL = "sec1-owner@sec1.local";
const PW = "loadtest1234";

async function reset() {
  for (const t of ["user_sessions", "mfa_recovery_codes", "mfa_email_codes", "mfa_trusted_browsers", "users"])
    await q(`DELETE FROM ${t} WHERE ${t === "mfa_email_codes" || t === "mfa_trusted_browsers" ? "user_id='u_sec1'" : "org_id=$1"}`,
      t === "mfa_email_codes" || t === "mfa_trusted_browsers" ? [] : [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sec One','sec-one',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_sec1',$1,$2,$3,'Sec Owner','admin')`,
    [ORG, EMAIL, bcrypt.hashSync(PW, 10)]);
}
const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const sessionsFor = async () => Number((await q(`SELECT COUNT(*)::int n FROM user_sessions WHERE user_id='u_sec1'`))[0].n);

(async () => {
  await reset();
  // Turn two-factor on the way a person does: setup, then one good code.
  const first = await login(EMAIL, PW);
  const setup = await api("POST", "/me/mfa/setup", first, {});
  const secret = setup.body?.secret;
  ok("setup hands over a secret and its QR code", !!secret && /^data:image\/png/.test(setup.body?.qr || ""), setup.status);
  const on = await api("POST", "/me/mfa/enable", first, { code: TOTP.hotp(secret, Math.floor(Date.now() / 30000)) });
  ok("two-factor turns on, with ten recovery codes shown once", on.status === 200 && on.body?.recoveryCodes?.length === 10, on.status);
  const stored = await q(`SELECT code_hash FROM mfa_recovery_codes WHERE user_id='u_sec1'`);
  ok("the recovery codes are stored hashed, never as typed", stored.length === 10 && !stored.some(r => on.body.recoveryCodes.map(c => c.replace("-", "")).includes(r.code_hash)), stored.length);

  // §1 — a correct password alone.
  const before = await sessionsFor();
  const pwOnly = await post("/auth/login", { email: EMAIL, password: PW });
  ok("§1 a correct password alone is answered mfa_required", pwOnly.status === 401 && pwOnly.body?.error === "mfa_required", pwOnly.status);
  ok("§1 …with no token of any kind", !pwOnly.body?.token && !pwOnly.body?.trustToken, JSON.stringify(pwOnly.body).slice(0, 120));
  ok("§1 …and no session row", (await sessionsFor()) === before, `${before} -> ${await sessionsFor()}`);
  const wrong = await post("/auth/login", { email: EMAIL, password: PW, code: "000000" });
  ok("§1 a wrong code gets no token either", wrong.status === 401 && !wrong.body?.token, wrong.status);
  const rc = on.body.recoveryCodes[0];
  const viaRecovery = await post("/auth/login", { email: EMAIL, password: PW, code: rc });
  ok("§1 a recovery code does sign in", viaRecovery.status === 200 && !!viaRecovery.body?.token, viaRecovery.status);
  const again = await post("/auth/login", { email: EMAIL, password: PW, code: rc });
  ok("§1 …once", again.status === 401 && !again.body?.token, again.status);

  // §2 — a session signed out from Settings dies on its very next request.
  const a = viaRecovery.body.token;
  const b = (await post("/auth/login", { email: EMAIL, password: PW, code: on.body.recoveryCodes[1] })).body.token;
  ok("§2 both sessions work", (await api("GET", "/me/sessions", a)).status === 200 && (await api("GET", "/me/sessions", b)).status === 200, "");
  const list = (await api("GET", "/me/sessions", b)).body.sessions || [];
  const target = list.find(s => !s.thisBrowser && s.id === JSON.parse(Buffer.from(a.split(".")[1], "base64url")).sid);
  ok("§2 the other session is listed, and this one says so", !!target && list.some(s => s.thisBrowser), list.length);
  const out = await api("POST", `/me/sessions/${target.id}/sign-out`, b, {});
  ok("§2 Settings signs it out", out.status === 200, out.status);
  const next = await api("GET", "/me/sessions", a);
  ok("§2 its very next request is rejected", next.status === 401 && next.body?.error === "session_revoked", next.status);
  ok("§2 the session that signed it out still works", (await api("GET", "/me/sessions", b)).status === 200, "");

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
