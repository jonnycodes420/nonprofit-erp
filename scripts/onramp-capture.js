// Discovery on-ramp + copy-fix capture (2026-08-12 follow-ups).
// Prereqs (the standing local capture recipe, tests/README.md + CLAUDE.md):
//   1. scratch server on :5601 booted with the run-all env + both BUILD-46
//      flags =1 + CORS_ORIGIN=http://localhost:4173
//   2. client built with VITE_API_URL=http://localhost:5601
//      VITE_PORTAL_API=http://localhost:5601/portal
//      VITE_ACCOUNT_API=http://localhost:5601/account
//      VITE_NETWORK_API=http://localhost:5601/network, `vite preview --port 4173`
//   3. PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/onramp-capture.js
// Seeds its own throwaway org + donor via the real API (idempotent by email
// dedup), then captures AND asserts:
//   after-portal-login          — reworded sign-in copy (no "never a password")
//   after-portal-listed         — signed-in view, listing ON → ONE quiet
//                                 discovery line whose href carries the
//                                 donor's verified email in the fragment
//   after-portal-unlisted       — listing OFF → the line is GONE (portal
//                                 stays entirely the org's own page)
//   after-giving-signup-prefill — following the link lands on /giving in
//                                 signup mode with the email prefilled
// Optional: PROD_BEFORE=1 also captures the OLD login copy from prod
// (run before deploying) as before-portal-login-prod.

const path = require("path");
const fs = require("fs");
const http = require("http");
const PW_DIR = process.env.PLAYWRIGHT_DIR || process.env.HOME + "/steward-qa";
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const API = "http://localhost:5601";
const APP = "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "onramp-2026-08-12");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
};

let mail = [];
function startSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { /* */ } res.end(JSON.stringify({ id: "s" })); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));
const j = async (method, url, { token, body } = {}) => {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let out = null; try { out = await r.json(); } catch { /* */ }
  return { status: r.status, body: out };
};

(async () => {
  const sink = await startSink();

  // ── throwaway org with an enabled, LISTED portal + one donor ─────────────
  const slug = "onramp-cap";
  const admin = "admin@onrampcap.test";
  let reg = await j("POST", `${API}/auth/register-org`, { body: { orgName: "Onramp Capture Org", userName: "Cap Admin", email: admin, password: "onramp-cap-pass1" } });
  let token = reg.body?.token;
  if (!token) { // already exists from a prior run — log in
    const login = await j("POST", `${API}/auth/login`, { body: { email: admin, password: "onramp-cap-pass1" } });
    token = login.body?.token;
  }
  ok("org session", !!token, reg.body);
  await j("POST", `${API}/onboarding/complete`, { token });
  const put = await j("PUT", `${API}/portal-settings`, { token, body: { enabled: true, networkListed: true, displayName: "Onramp Arts" } });
  ok("portal enabled + listed", put.status === 200, put.body);
  const org = await j("GET", `${API}/org`, { token });
  const orgSlug = org.body?.org_slug || org.body?.org?.org_slug || slug;
  const donorEmail = "quinn@onrampdonor.test";
  await j("POST", `${API}/donors`, { token, body: { name: "Quinn Onramp", email: donorEmail } });

  // ── portal magic-link session (the real flow, token via the sink) ────────
  mail = [];
  await j("POST", `${API}/portal/${orgSlug}/request-link`, { body: { email: donorEmail } });
  await settle();
  const linkMail = mail.find(m => /#token=/.test(m.html || ""));
  ok("magic link captured", !!linkMail);
  const mlToken = /#token=([A-Za-z0-9_-]+)/.exec(linkMail.html)[1];
  const v = await fetch(`${API}/portal/${orgSlug}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: mlToken }) });
  const cookieVal = /steward_portal=([^;]+)/.exec(v.headers.get("set-cookie"))[1];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
  await ctx.addCookies([{ name: "steward_portal", value: decodeURIComponent(cookieVal), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const snap = async (name, fullPage = false) => { await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage }); console.log("  shot", name); };

  // 1 — reworded login copy (cold page, fresh context has no portal cookie
  //     for the APP origin; the API cookie doesn't sign the page in by itself
  //     — but /me with the cookie would. Use a separate clean page context.)
  const coldCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
  const coldPage = await coldCtx.newPage();
  await coldPage.goto(`${APP}/portal/${orgSlug}`, { waitUntil: "networkidle" });
  const loginText = await coldPage.innerText("body");
  ok("login copy: 'never a password' claim is gone", !/never a password|No password needed — ever/i.test(loginText), loginText.slice(0, 200));
  ok("login copy: email-link truth present", /signs you in by email/i.test(loginText));
  await coldPage.screenshot({ path: path.join(OUT, "after-portal-login.png") });
  console.log("  shot after-portal-login");
  await coldCtx.close();

  // 2 — signed-in, LISTED → the one quiet discovery line, email in fragment
  await page.goto(`${APP}/portal/${orgSlug}`, { waitUntil: "networkidle" });
  await settle(800);
  const listedText = await page.innerText("body");
  ok("listed: discovery line renders", /See all your giving in one place/.test(listedText), listedText.slice(0, 300));
  const href = await page.getAttribute('a[href^="/giving#signup"]', "href");
  ok("listed: link carries the verified email in the FRAGMENT",
    href === `/giving#signup&email=${encodeURIComponent(donorEmail)}`, href);
  await snap("after-portal-listed");

  // 3 — flip listing OFF → nothing appears; the portal stays the org's page
  await j("PUT", `${API}/portal-settings`, { token, body: { networkListed: false } });
  await page.reload({ waitUntil: "networkidle" });
  await settle(800);
  const unlistedText = await page.innerText("body");
  ok("unlisted: NO discovery line, no /giving mention",
    !/all your giving in one place|giving dashboard|free account/i.test(unlistedText), unlistedText.slice(0, 300));
  ok("unlisted: portal still fully works (signed in)", /Your giving/.test(unlistedText));
  await snap("after-portal-unlisted");
  await j("PUT", `${API}/portal-settings`, { token, body: { networkListed: true } });

  // 4 — the link lands on /giving in signup mode with the email prefilled
  await page.goto(`${APP}/giving#signup&email=${encodeURIComponent(donorEmail)}`, { waitUntil: "networkidle" });
  await settle(800);
  const signupText = await page.innerText("body");
  ok("signup mode opens", /Create your giving account/.test(signupText), signupText.slice(0, 200));
  const prefill = await page.inputValue('input[type="email"]');
  ok("email prefilled from the fragment", prefill === donorEmail, prefill);
  ok("fragment stripped from the URL after read", !(await page.url()).includes("#"), await page.url());
  await snap("after-giving-signup-prefill");

  // optional — BEFORE shot from prod (old copy), only while prod predates the fix
  if (process.env.PROD_BEFORE === "1") {
    const prodCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
    const prodPage = await prodCtx.newPage();
    await prodPage.goto("https://www.stewardapp.dev/portal/creo-arts-creo", { waitUntil: "networkidle" });
    await prodPage.screenshot({ path: path.join(OUT, "before-portal-login-prod.png") });
    console.log("  shot before-portal-login-prod");
    await prodCtx.close();
  }

  await browser.close();
  if (sink) sink.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
