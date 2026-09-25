// BUILD-98 (switch) Part 8 — TWO-STEP SIGN-IN FOR ADMINS, AND EVERYTHING IN ONE FILE.
//
//   §1  the code is RFC 6238's code: the RFC's own test vectors;
//   §2  in an org that requires it, an admin with no two-step gets a session
//       that opens the setup routes and NOTHING else; finishing setup is the
//       one door to a real session;
//   §3  with two-step on, the password alone is not enough, a wrong code is
//       refused, and a code works ONCE;
//   §4  staff are not swept in by a rule written for administrators;
//   §5  nobody can lock themselves out: the rule cannot be switched on by an
//       admin without two-step, nor by staff, and an admin cannot switch
//       two-step off while the org requires it;
//   §6  the secret is stored sealed, never readable;
//   §7  THE FULL EXPORT: every table carrying the org's id is in it, nothing
//       from another org is, no password/secret/token column is, staff cannot
//       pull it, and a LAPSED org still can.
//
// Standard scratch stack (tests/README.md). STEWARD_CREDENTIAL_KEY must be set
// on the server (the boot recipe sets it).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");
const TOTP = require("../totp");

const A = "org_b98s", B = "org_b98s2";
const PW = "loadtest1234";
const post = (path, body, tok) => fetch(BASE + path, { method: "POST",
  headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) },
  body: JSON.stringify(body || {}) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function reset() {
  for (const o of [A, B]) {
    for (const t of ["api_keys", "gifts", "fin_transactions", "interactions", "threads", "tasks", "thank_you_drafts", "workflow_runs",
                     "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("build98-security");

  // ── §1 · RFC 6238 Appendix B (SHA-1, 8 digits) ─────────────────────────────
  const rfc = TOTP.base32Encode(Buffer.from("12345678901234567890"));
  for (const [t, want] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [2000000000, "69279037"]])
    ok(`§1 T=${t} gives ${want}`, TOTP.hotp(rfc, Math.floor(t / 30), 8) === want, TOTP.hotp(rfc, Math.floor(t / 30), 8));
  ok("§1 a code that is not six digits is refused before any arithmetic", TOTP.verify(rfc, "12ab56") === null);

  await reset();
  for (const [id, name] of [[A, "Keyholders"], [B, "Other Org"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,$2,$3,1,'team','active')`, [id, name, id.replace(/_/g, "-")]);
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98s',$1,'b98s-admin@example.org',$2,'Ada Admin','admin')`, [A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98s_st',$1,'b98s-staff@example.org',$2,'Sam Staff','staff')`, [A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98s2',$1,'b98s-other@example.org',$2,'Otto','admin')`, [B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('s98_a',$1,'Anna Keyholder','anna@example.org','prospect')`, [A]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('s98_b_marker',$1,'Bartholomew Otherorg','bart@example.org','prospect')`, [B]);

  // ── §5 (first half) · the rule cannot be switched on by someone without it ──
  const adminPlain = (await post("/auth/login", { email: "b98s-admin@example.org", password: PW })).body.token;
  const staffTok = (await post("/auth/login", { email: "b98s-staff@example.org", password: PW })).body.token;
  ok("§5 an admin WITHOUT two-step cannot require it (no self-lockout)",
     (await api("PUT", "/org/security", adminPlain, { requireAdminMfa: true })).status === 409);
  ok("§5 staff cannot set the rule at all", (await api("PUT", "/org/security", staffTok, { requireAdminMfa: true })).status === 403);

  // Require it for the org directly, to drive the enforcement path.
  await q(`UPDATE orgs SET require_admin_mfa=true WHERE id=$1`, [A]);

  // ── §2 · a setup-only session ──────────────────────────────────────────────
  const first = await post("/auth/login", { email: "b98s-admin@example.org", password: PW });
  ok("§2 the admin is told to set up two-step, with a setup-only session",
     first.status === 200 && first.body.mfaSetupRequired === true && !!first.body.token && !first.body.user, first.body);
  const setupTok = first.body.token;
  ok("§2 that session does NOT open the donor list", (await api("GET", "/donors?limit=1", setupTok)).status === 403);
  ok("§2 …or the export", (await api("GET", "/org/export/full", setupTok)).status === 403);
  const s = await post("/me/mfa/setup", {}, setupTok);
  ok("§2 …but it opens setup", s.status === 200 && /^[A-Z2-7]{32}$/.test(s.body.secret || "") && /^otpauth:\/\/totp\//.test(s.body.otpauthUrl || ""), s.body);
  const secret = s.body.secret;
  ok("§2 a wrong setup code is refused", (await post("/me/mfa/enable", { code: "000000" }, setupTok)).status === 400);
  const en = await post("/me/mfa/enable", { code: TOTP.hotp(secret, TOTP.counterAt()) }, setupTok);
  ok("§2 the right code turns it on and returns a REAL session", en.status === 200 && en.body.enabled && en.body.user && en.body.org, en.body);
  ok("§2 …which opens the donor list", (await api("GET", "/donors?limit=1", en.body.token)).status === 200);

  // ── §6 · sealed at rest ────────────────────────────────────────────────────
  const [row] = await q(`SELECT mfa_secret_sealed, mfa_pending_sealed, mfa_enabled_at FROM users WHERE id='u_b98s'`);
  ok("§6 the stored secret is sealed and does not contain the secret", !!row.mfa_secret_sealed && !row.mfa_secret_sealed.includes(secret));
  ok("§6 …the pending copy is cleared once it is on", row.mfa_pending_sealed === null && !!row.mfa_enabled_at);

  // ── §3 · the password is not enough; a code works once ─────────────────────
  const noCode = await post("/auth/login", { email: "b98s-admin@example.org", password: PW });
  ok("§3 with two-step on, the password alone is asked for a code", noCode.status === 401 && noCode.body.error === "mfa_required");
  const bad = await post("/auth/login", { email: "b98s-admin@example.org", password: PW, code: "000000" });
  ok("§3 a wrong code is refused", bad.status === 401 && bad.body.error === "mfa_invalid");
  const next = TOTP.hotp(secret, TOTP.counterAt() + 1);
  const good = await post("/auth/login", { email: "b98s-admin@example.org", password: PW, code: next });
  ok("§3 the next code signs in", good.status === 200 && !!good.body.token && good.body.user.mfaEnabled === true, good.body);
  const again = await post("/auth/login", { email: "b98s-admin@example.org", password: PW, code: next });
  ok("§3 the SAME code a second time is refused (single use)", again.status === 401 && again.body.error === "mfa_invalid");
  const adminTok = good.body.token;

  // ── §4 · staff are not swept in ────────────────────────────────────────────
  const st = await post("/auth/login", { email: "b98s-staff@example.org", password: PW });
  ok("§4 staff still sign in with a password alone", st.status === 200 && !st.body.mfaSetupRequired && !!st.body.user);

  // ── §5 (second half) ───────────────────────────────────────────────────────
  ok("§5 an admin cannot switch two-step OFF while the org requires it",
     (await post("/me/mfa/disable", { code: TOTP.hotp(secret, TOTP.counterAt() + 1) }, adminTok)).status === 409);
  ok("§5 an admin WITH two-step can set the rule", (await api("PUT", "/org/security", adminTok, { requireAdminMfa: true })).status === 200);

  // ── §7 · the full export ───────────────────────────────────────────────────
  await api("POST", "/api-keys", adminTok, { name: "Export check" });
  const r = await fetch(BASE + "/org/export/full", { headers: { Authorization: "Bearer " + adminTok } });
  const text = await r.text();
  let ex = null; try { ex = JSON.parse(text); } catch { /* reported below */ }
  ok("§7 the export is one valid JSON file", r.status === 200 && ex && ex.tables && ex.organization, text.slice(0, 120));
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' GROUP BY table_name`)).map(x => x.table_name);
  const missingTables = orgTables.filter(t => !(t in ex.tables));
  ok(`§7 every one of the ${orgTables.length} tables carrying an org id is in it`, missingTables.length === 0, missingTables);
  ok("§7 the org's own rows are there", ex.tables.donors.some(d => d.id === "s98_a") && ex.organization.id === A);
  // Walk EVERY leaf (never a stringified search — the BUILD-84 rule).
  const leaves = []; (function walk(x, k) { if (x && typeof x === "object") for (const [kk, v] of Object.entries(x)) walk(v, kk); else leaves.push([k, String(x)]); })(ex);
  ok("§7 nothing from the other org is anywhere in it",
     !leaves.some(([, v]) => v === B || v === "s98_b_marker" || v === "u_b98s2" || v === "bart@example.org"),
     leaves.filter(([, v]) => v === B || v === "s98_b_marker").slice(0, 3));
  const badKeys = [...new Set(leaves.map(([k]) => k).filter(k => /password|secret|sealed|token|(^|_)hash($|_)/i.test(k)))];
  ok("§7 no password, secret, sealed, token or hash column is in it", badKeys.length === 0, badKeys);
  ok("§7 staff cannot pull it", (await api("GET", "/org/export/full", staffTok)).status === 403);
  await q(`UPDATE orgs SET subscription_status='trial_expired', plan='trial', trial_ends_at=NOW()-INTERVAL '10 days' WHERE id=$1`, [A]);
  ok("§7 a LAPSED org can still leave with everything",
     (await fetch(BASE + "/org/export/full", { headers: { Authorization: "Bearer " + adminTok } })).status === 200);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
