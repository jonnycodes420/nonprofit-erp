#!/usr/bin/env node
// STAGE-1 · THE STAGING WALK: six steps a customer takes, on staging, after every merge.
//
//   1. sign in         POST /auth/login as the walk account, then the app opens signed in
//   2. Home            /dashboard draws, with no console error and no API 4xx/5xx
//   3. a profile       a person from the list opens at /donors/:id the same way
//   4. record a gift   POST /donors/:id/gifts (the gift form's call), then the gift is on the person
//   5. an import       a one-person file through /donors/import-combined, its run
//                      recorded, then Undo (/imports/:id/reverse), and the person is gone
//   6. a report        /app/reports draws, and GET /reports/giving-summary answers
//
// It writes only to the walk org (made-up people, seeded by scripts/ops/staging-seed.js),
// never to the demo org Muse walks. It REFUSES to walk anything whose /health
// does not say env "staging": this script writes, and prod is never written.
//
// usage:  STAGING_API_URL=… STAGING_APP_URL=… STAGING_WALK_EMAIL=… STAGING_WALK_PASSWORD=… \
//         node scripts/ci/staging-walk.js [--out walk.json]
// exit 0 when every step passed, 1 when any failed (the summary line says which and why).
// PLAYWRIGHT_DIR names the folder holding the playwright package (CI: .playwright).
"use strict";
const fs = require("fs");
const path = require("path");

const API = (process.env.STAGING_API_URL || "").replace(/\/+$/, "");
const APP = (process.env.STAGING_APP_URL || "").replace(/\/+$/, "");
const EMAIL = process.env.STAGING_WALK_EMAIL || "walker@walk.staging.invalid";
const PASSWORD = process.env.STAGING_WALK_PASSWORD || "";
const SHA = (process.env.WALK_SHA || process.env.GITHUB_SHA || "local").slice(0, 7);
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1] : null;

const steps = [];
const step = (name, ok, why = "") => { steps.push({ name, ok: !!ok, why: ok ? "" : String(why).slice(0, 200) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` · ${why}`}`); return !!ok; };

async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = null; try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, path.join(process.env.HOME || "", "steward-qa")].filter(Boolean);
  for (const d of dirs) { try { return require(path.join(d, "node_modules", "playwright")); } catch { /* next */ } }
  try { return require("playwright"); } catch { return null; }
}

// One screen in the browser: it draws, with no page error, console error or API 4xx/5xx.
async function screen(page, trouble, url) {
  trouble.length = 0;
  await page.goto(APP + url, { waitUntil: "networkidle", timeout: 60000 }).catch(e => trouble.push("goto: " + e.message.slice(0, 80)));
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
  if (/Something went wrong|This part of Steward hit a problem/i.test(text)) trouble.push("an error boundary showed");
  if (text.trim().length < 40) trouble.push("the screen is blank");
  return trouble.slice();
}

async function main() {
  if (!API || !APP) { step("the walk knows where staging is", false, "STAGING_API_URL and STAGING_APP_URL are required"); return; }
  // Identity first: never walk (and write to) anything but staging.
  let health = null;
  try { health = await (await fetch(API + "/health", { signal: AbortSignal.timeout(15000) })).json(); } catch (e) { health = { error: e.message }; }
  if (!step("staging answers and says it is staging", health && health.env === "staging",
    health && health.error ? `no answer from ${API}/health` : `/health says env ${JSON.stringify(health && health.env)}; the walk writes, so it walks staging only`)) return;

  // 1. sign in
  const login = await call("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const token = login.body && login.body.token;
  if (!step("1 sign in", login.status === 200 && token, `the walk account could not sign in (${login.status})`)) return;
  const { user, org } = login.body;

  const pw = loadPlaywright();
  let browser = null, page = null; const trouble = [];
  if (pw) {
    try {
      browser = await pw.chromium.launch();
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
      await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
        [token, JSON.stringify(user || {}), JSON.stringify(org || {})]);
      page = await ctx.newPage();
      page.on("pageerror", e => trouble.push("threw: " + e.message.slice(0, 140)));
      page.on("console", m => { if (m.type() === "error" && !/React DevTools|\[SW\]/.test(m.text()) && !/\/ai\/stream|fonts\.googleapis|\/favicon/.test((m.location() || {}).url || "")) trouble.push("console: " + m.text().slice(0, 140)); });
      // /ai/stream answers 503 when the AI switch is off, as smoke-walk allows (EXPECTED_5XX there).
      page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(API) && !/\/ai\/stream/.test(r.url())) trouble.push(`${r.status()} ${r.url().replace(API, "").slice(0, 90)}`); });
    } catch (e) { browser = null; page = null; step("the browser starts", false, e.message.slice(0, 120)); }
  } else step("the browser starts", false, "playwright is not installed (PLAYWRIGHT_DIR)");

  try {
    // 2. Home
    if (page) { const t = await screen(page, trouble, "/dashboard"); step("2 Home", t.length === 0, t.slice(0, 3).join("; ")); }
    else { const h = await call("GET", "/dashboard/home", token); step("2 Home", false, `no browser; the API answered ${h.status}`); }

    // 3. a profile
    const list = await call("GET", "/donors?limit=5", token);
    const rows = Array.isArray(list.body) ? list.body : (list.body && (list.body.donors || list.body.rows)) || [];
    const person = rows.find(d => d && d.id);
    if (step("3 a profile: the list has a person", list.status === 200 && person, `GET /donors answered ${list.status} with ${rows.length} people`) && page) {
      const t = await screen(page, trouble, `/donors/${encodeURIComponent(person.id)}`);
      step("3 a profile opens", t.length === 0, t.slice(0, 3).join("; "));
    }

    // 4. record a gift
    if (person) {
      const today = new Date().toISOString().slice(0, 10);
      const g = await call("POST", `/donors/${encodeURIComponent(person.id)}/gifts`, token, { amount: 25, date: today, type: "one-time", payment_method: "check", notes: `staging walk ${SHA}` });
      const gid = g.body && (g.body.id || (g.body.gift && g.body.gift.id));
      if (step("4 record a gift", (g.status === 200 || g.status === 201) && gid, `POST /donors/:id/gifts answered ${g.status} ${JSON.stringify(g.body).slice(0, 120)}`)) {
        const back = await call("GET", `/donors/${encodeURIComponent(person.id)}`, token);
        const giftRows = (back.body && back.body.gifts) || [];
        step("4 the gift is on the person", giftRows.some(x => x.id === gid), `GET /donors/:id answered ${back.status}; the new gift is not on it`);
      }
    }

    // 5. an import, then its undo
    const runId = `imp_walk_${SHA}_${Date.now().toString(36)}`.slice(0, 44);
    const who = `Walk Person ${SHA} ${Date.now().toString(36)}`;
    const email = `walk.${Date.now().toString(36)}@walk.staging.invalid`;
    const imp = await call("POST", "/donors/import-combined", token, { donors: [{ name: who, email }],
      gifts: [{ donorIndex: 0, amount: 40, date: "2026-01-15", type: "cash", paymentMethod: "check", externalId: runId }], importId: runId });
    if (step("5 an import goes in", imp.status === 200, `import-combined answered ${imp.status} ${JSON.stringify(imp.body).slice(0, 120)}`)) {
      const rec = await call("POST", "/imports", token, { id: runId, name: "staging-walk.csv", sourceFilename: "staging-walk.csv", shape: "gift_file_with_donors", rowsIn: 1, donorsCreated: 1, giftsCreated: 1, dollars: 40 });
      step("5 the import's run is recorded", rec.status === 200 || rec.status === 201, `POST /imports answered ${rec.status}`);
      const undo = await call("POST", `/imports/${runId}/reverse`, token);
      step("5 Undo takes it back out", undo.status === 200 || undo.status === 202, `reverse answered ${undo.status} ${JSON.stringify(undo.body).slice(0, 120)}`);
      let gone = false;
      for (let i = 0; i < 20 && !gone; i++) {
        const s = await call("GET", `/donors?search=${encodeURIComponent(email)}`, token);
        const r = Array.isArray(s.body) ? s.body : (s.body && (s.body.donors || s.body.rows)) || [];
        gone = s.status === 200 && !r.some(d => d.email === email);
        if (!gone) await new Promise(r2 => setTimeout(r2, 1500));
      }
      step("5 and the imported person is gone", gone, "the person the import made is still on the list 30 s after Undo");
    }

    // 6. a report
    const rep = await call("GET", "/reports/giving-summary", token);
    step("6 the giving report answers", rep.status === 200, `GET /reports/giving-summary answered ${rep.status}`);
    if (page) { const t = await screen(page, trouble, "/app/reports"); step("6 Reports draws", t.length === 0, t.slice(0, 3).join("; ")); }
  } finally { if (browser) await browser.close().catch(() => {}); }
}

// The one line a commit status carries (GitHub keeps 140 characters).
function summaryLine(list) {
  const failed = list.filter(s => !s.ok);
  if (!list.length) return "The walk did not run.";
  if (!failed.length) return `All ${list.length} checks passed: sign in, Home, a profile, a gift, an import and its undo, a report.`;
  return `${failed.length} of ${list.length} failed. First: ${failed[0].name}: ${failed[0].why}`.slice(0, 140);
}

if (require.main === module) {
  main().catch(e => step("the walk ran to the end", false, e.message))
    .finally(() => {
      const line = summaryLine(steps);
      const ok = steps.length > 0 && steps.every(s => s.ok);
      console.log(`\n${ok ? "STAGING WALK PASSED" : "STAGING WALK FAILED"}: ${line}`);
      if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ok, sha: SHA, line, steps }, null, 2));
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Staging walk: ${ok ? "passed" : "FAILED"}\n\n${steps.map(s => `- ${s.ok ? "✅" : "❌"} ${s.name}${s.ok ? "" : ` · ${s.why}`}`).join("\n")}\n`);
      process.exit(ok ? 0 : 1);
    });
}
module.exports = { summaryLine };
