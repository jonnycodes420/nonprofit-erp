#!/usr/bin/env node
// BUILD-55: defaults to the LOCAL scratch stack. Running against prod now requires
// BOTH an explicit BASE= AND --i-know-this-is-prod (see scripts/lib/prodGuard.js).
// BUILD-51 — migrate existing portal themes to asset storage, API-ONLY:
// log in as each org's admin, read /portal-settings, and re-PUT any legacy
// base64 image fields — the BUILD-51 write route stores them through
// assetStore and nulls the row columns. Idempotent: a migrated org has no
// *_data left, so a re-run is a no-op. Never touches the DB directly.
//
// Defaults to the two PROD demo orgs (org_creo + Harbor Music School). For
// any other org: BASE=… ORGS='email:password,email2:password2' node scripts/…
const guard = require("./lib/prodGuard");
const BASE = guard.writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const ORGS = (process.env.ORGS
  || "admin@creoarts.org:demo1234,xjca2006+b50demo@gmail.com:harbor-demo-2026")
  .split(",").map(s => { const i = s.indexOf(":"); return { email: s.slice(0, i), password: s.slice(i + 1) }; });

const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: parsed };
};

(async () => {
  console.log(`BUILD-51 theme-asset migration → ${BASE}\n`);
  let failed = 0;
  for (const { email, password } of ORGS) {
    const login = await j("POST", "/auth/login", { email, password });
    if (!login.body?.token) { console.log(`  FAIL login ${email}:`, login.status); failed++; continue; }
    const ps = await j("GET", "/portal-settings", null, login.body.token);
    const body = {};
    if (ps.body.header_image_data) body.headerImageData = ps.body.header_image_data;
    if (ps.body.logo_data) body.logoData = ps.body.logo_data;
    if (!Object.keys(body).length) {
      console.log(`  ${email}: already migrated (header_image_url=${ps.body.header_image_url || "none"}, logo_url=${ps.body.logo_url || "none"})`);
      continue;
    }
    guard.logOverwrite(`portal-settings-${email}`, ps.body);
    const put = await j("PUT", "/portal-settings", body, login.body.token);
    const okd = put.status === 200 && !put.body.header_image_data && !put.body.logo_data;
    console.log(`  ${okd ? "OK  " : "FAIL"} ${email}: header_image_url=${put.body.header_image_url || "none"} logo_url=${put.body.logo_url || "none"}`);
    if (!okd) failed++;
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
