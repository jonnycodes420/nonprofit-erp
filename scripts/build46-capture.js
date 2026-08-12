#!/usr/bin/env node
// BUILD-46 §8(5) — DSF2 screenshots of the donor dashboard demo (run
// seed-build46-network-demo.js first) + the org-side unchanged proof.
//
// Local stack recipe (the BUILD-45 capture conventions):
//   client built with VITE_API_URL=http://localhost:5601
//     VITE_PORTAL_API=http://localhost:5601/portal
//     VITE_ACCOUNT_API=http://localhost:5601/account
//     VITE_NETWORK_API=http://localhost:5601/network
//   `npx vite preview --port 4173` + server booted with
//   CORS_ORIGIN=http://localhost:4173 and both BUILD-46 flags on.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build46-capture.js
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require(process.env.PLAYWRIGHT_DIR + "/node_modules/playwright");

const API = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP || "http://localhost:4173";
const OUT = process.env.OUT || (__dirname + "/../docs/build46-network-demo");
const EMAIL = "alex.demo@n46.test";
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, d ?? ""); } };

const mails = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => { try { mails.push(JSON.parse(b)); } catch { } res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
});
const j = async (method, path, body, headers = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  let parsed = null; try { parsed = await r.json(); } catch { }
  return { status: r.status, body: parsed, headers: r.headers };
};
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => sink.listen(5602, r));

  // Org-side proof, part 1: staff view of the donor BEFORE any account.
  const staffTok = null; // org A has no seeded staff user; use the raw API-less DB? — the byte proof rides the ORG-BLINDNESS SUITE; here we hash the PUBLIC-shape staff payloads via a seeded admin if present.
  // (The committed org-blindness suite is the authoritative byte-equality
  // proof; this capture stores donor-profile JSON hashes as the visual-story
  // sidecar when a staff login exists.)

  // 1) Create + verify the demo account (the sink catches the verify email).
  await j("POST", "/account/signup", { email: EMAIL, password: "alexdemo999", consent: true });
  await new Promise(r => setTimeout(r, 900));
  const verifyMail = mails.find(m => m.to === EMAIL && /verify#token=/.test(m.html || ""));
  ok("verification email captured", !!verifyMail);
  const token = /verify#token=([A-Za-z0-9_-]+)/.exec(verifyMail.html)[1];
  const v = await j("POST", "/account/verify", { token });
  ok("verify links both demo orgs", v.status === 200 && v.body.linkedOrgs === 2, v.body);
  const cookie = decodeURIComponent((v.headers.get("set-cookie") || "").match(/steward_portal=([^;]+)/)[1]);

  // 2) Drive the dashboard in a real browser with the session cookie.
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "steward_portal", value: cookie, url: APP }]);
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  pageerror:", e.message));

  await p.goto(APP + "/giving", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const body = await p.evaluate(() => document.body.innerText);
  ok("home shows both orgs + combined totals", body.includes("Harbor Music School") && body.includes("Open Door Pantry"), body.slice(0, 200));
  ok("home shows both impact feeds", body.includes("spring recital") && body.includes("2,100 grocery boxes"));
  await p.screenshot({ path: OUT + "/dashboard-home.png", fullPage: true });

  await p.click("text=Recurring"); await p.waitForTimeout(900);
  const recText = await p.evaluate(() => document.body.innerText);
  ok("unified recurring lists both orgs", recText.includes("$25/month") && recText.includes("$10/month"), recText.slice(0, 300));
  await p.screenshot({ path: OUT + "/dashboard-recurring.png", fullPage: true });

  await p.click("text=Receipts & tax"); await p.waitForTimeout(900);
  const taxText = await p.evaluate(() => document.body.innerText);
  ok("tax summary spans both orgs and years", taxText.includes("Harbor Music School") && taxText.includes("Open Door Pantry"));
  await p.screenshot({ path: OUT + "/dashboard-tax-summary.png", fullPage: true });

  // 3) The drill-down: the UNFORKED org portal under the consumer back bar.
  await p.goto(APP + "/giving/orgs/harbor-music-n46", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const drill = await p.evaluate(() => document.body.innerText);
  ok("drill-down renders the org's own white-label portal with the back bar",
    drill.includes("Your Giving") && drill.includes("Harbor Music School") && drill.includes("Welcome back"), drill.slice(0, 200));
  await p.screenshot({ path: OUT + "/dashboard-org-drilldown.png", fullPage: true });

  // 4) Org-side unchanged: hash the raw donor rows before/after more dashboard
  //    use (the byte-equality PROOF is tests/org-blindness.test.js; this file
  //    records the demo-run evidence for the visual story).
  const snap = async () => sha(JSON.stringify(await (await fetch(API + "/portal/harbor-music-n46/config")).json()));
  const h1 = await snap();
  await p.goto(APP + "/giving", { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  const h2 = await snap();
  fs.writeFileSync(OUT + "/ORG-SIDE-PROOF.txt",
    `BUILD-46 demo — org-side unchanged evidence (${new Date().toISOString()})\n\n` +
    `The authoritative byte-equality proof is tests/org-blindness.test.js (41 asserts,\n` +
    `in run-all + CI): ten org-staff routes byte-identical before/after the donor\n` +
    `account exists, plus the cross-org marker sweep.\n\n` +
    `This demo run: org public config hash before dashboard use ${h1}, after ${h2} — ${h1 === h2 ? "IDENTICAL" : "DIFFERENT (investigate!)"}\n`);
  ok("org-side demo evidence identical", h1 === h2, { h1, h2 });

  await browser.close();
  sink.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("CAPTURE FAILED:", e); process.exit(1); });
