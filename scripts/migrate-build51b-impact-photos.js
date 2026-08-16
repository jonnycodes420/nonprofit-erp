#!/usr/bin/env node
// BUILD-55: defaults to the LOCAL scratch stack. Running against prod now requires
// BOTH an explicit BASE= AND --i-know-this-is-prod (see scripts/lib/prodGuard.js).
// BUILD-51b — migrate existing impact-update photos to asset storage,
// API-ONLY: log in as each org's admin, list /impact-updates, and re-PUT the
// photos array on any update still carrying data-URI photos — the BUILD-51b
// write route stores each through assetStore and the row keeps only
// /portal-assets/<id> paths. Idempotent: migrated updates have no data URIs
// left, so a re-run is a no-op. Never touches the DB directly.
//
// Defaults to the two PROD demo orgs. For others:
//   BASE=… ORGS='email:password,email2:password2' node scripts/…
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
  console.log(`BUILD-51b impact-photo migration → ${BASE}\n`);
  let failed = 0;
  for (const { email, password } of ORGS) {
    const login = await j("POST", "/auth/login", { email, password });
    if (!login.body?.token) { console.log(`  FAIL login ${email}:`, login.status); failed++; continue; }
    const ups = await j("GET", "/impact-updates", null, login.body.token);
    const rows = Array.isArray(ups.body) ? ups.body : [];
    let migrated = 0, clean = 0;
    for (const u of rows) {
      const photos = Array.isArray(u.photos) ? u.photos : [];
      if (!photos.some(p => String(p).startsWith("data:"))) { clean++; continue; }
      guard.logOverwrite(`impact-update-${u.id}`, u);
      const put = await j("PUT", `/impact-updates/${u.id}`, { photos }, login.body.token);
      const okd = put.status === 200 && (put.body.photos || []).every(p => String(p).startsWith("/portal-assets/"));
      console.log(`  ${okd ? "OK  " : "FAIL"} ${email} ${u.id}: ${(put.body.photos || []).join(", ").slice(0, 120)}`);
      if (okd) migrated++; else failed++;
    }
    console.log(`  ${email}: ${migrated} migrated, ${clean} already clean, ${rows.length} total`);
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
