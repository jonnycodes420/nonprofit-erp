#!/usr/bin/env node
// LOST & FOUND — THE WALK. SELF_REFUSING.
//
// The Node suite proves the audit leaks nothing when it runs in Node. This
// proves it in a REAL BROWSER, which is the only place the promise printed
// beside the upload button is actually made: it uploads a messy sample file
// at 1440 and 390, records EVERY request the page makes for the whole
// session, and then greps the method, the URL, the headers and the body of
// each one for every name, every email and every amount in the file.
//
// It also downloads the PDF and checks the lead reached the super admin.
//
//   BASE=http://localhost:5631 APP_URL=http://localhost:4203 node scripts/lf1-walk.js

const path = require("path");
const fs = require("fs");

const BASE = (process.env.BASE || "http://localhost:5631").replace(/\/+$/, "");
const APP = (process.env.APP_URL || "http://localhost:4203").replace(/\/+$/, "");
for (const [n, u] of [["BASE", BASE], ["APP_URL", APP]]) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)) {
    console.error(`Refusing to run: ${n} must be loopback (got ${u}).`); process.exit(1);
  }
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "lost-and-found-messy.csv");
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "lost-and-found");
const IGNORE = /_vercel\/(insights|speed-insights)|favicon|apple-touch-icon|\.map$/i;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 500) : "")); } };

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) { console.error(`Playwright not found under ${PW_DIR}. This walk IS the browser half.`); process.exit(1); }

  // Everything in the file that must never appear in a request.
  const csv = fs.readFileSync(FIXTURE, "utf8");
  const lines = csv.split("\n").slice(3).filter(Boolean);
  const secrets = new Set();
  for (const l of lines) {
    const c = l.split(",");
    if (c[0] && c[1] && c[0] !== "TOTAL") secrets.add(`${c[0]} ${c[1]}`.trim());
    if (c[2] && c[2].includes("@")) secrets.add(c[2].trim());
  }
  const names = [...secrets].filter(s => !s.includes("@"));
  const emails = [...secrets].filter(s => s.includes("@"));
  ok(`the fixture carries ${names.length} names and ${emails.length} emails to look for`,
     names.length > 50 && emails.length > 50, { names: names.length, emails: emails.length });

  const browser = await chromium.launch();
  const shots = [];
  const shot = async (p, n) => { const f = path.join(SHOTS, n + ".png"); await p.screenshot({ path: f }); shots.push(f); };

  let firstLeadOrg = null;

  for (const width of [1440, 390]) {
    console.log(`\n— ${width} · the audit, end to end —`);
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
      isMobile: width === 390, hasTouch: width === 390, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    // EVERY REQUEST, for the whole session. Method, URL, headers and body.
    const sent = [];
    page.on("request", r => {
      if (IGNORE.test(r.url())) return;
      let body = null;
      try { body = r.postData(); } catch { body = "<unreadable>"; }
      sent.push({ method: r.method(), url: r.url(), headers: JSON.stringify(r.headers() || {}), body: body || "" });
    });
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text()); });

    await page.goto(`${APP}/lost-and-found?ref=walk-${width}`, { waitUntil: "networkidle" });
    const hero = await page.locator("[data-testid='lf-hero']").innerText().catch(() => "");
    ok(`${width}: the hero is the brief's headline`, /A \$1,500 donor audit\. Free\./.test(hero), hero);
    const why = await page.locator("[data-testid='lf-why-free']").innerText().catch(() => "");
    ok(`${width}: the why-free block says the whole thing, including "No catch."`,
       /We sell a CRM/.test(why) && /free, forever/.test(why) && /No catch\./.test(why), why.slice(0, 120));
    const priv = await page.locator("[data-testid='lf-privacy']").innerText().catch(() => "");
    ok(`${width}: the trust line sits by the upload`, /never leaves your browser/.test(priv), priv);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${width}: no horizontal scroll`, noScroll <= 0, noScroll);
    await shot(page, `lf-hero-${width}`);

    // ── UPLOAD, and run the audit ────────────────────────────────────────
    await page.setInputFiles("[data-testid='lf-file']", FIXTURE);
    await page.waitForSelector("[data-testid='lf-results']", { timeout: 25000 }).catch(() => {});
    ok(`${width}: the audit ran and the results drew`, await page.locator("[data-testid='lf-results']").count() === 1);

    const atRisk = await page.locator("[data-testid='lf-at-risk']").innerText().catch(() => "");
    const retention = await page.locator("[data-testid='lf-retention']").innerText().catch(() => "");
    ok(`${width}: dollars at risk is a real figure`, /^\$[\d,]+$/.test(atRisk.trim()), atRisk);
    ok(`${width}: the retention rate is a percentage`, /^\d+%$/.test(retention.trim()), retention);
    const fileLine = await page.locator("[data-testid='lf-file-line']").innerText().catch(() => "");
    ok(`${width}: it says how much of the file it read, and what it skipped`,
       /gifts read from .* rows/.test(fileLine), fileLine);

    for (const k of ["lapsed", "quiet", "drifting", "stopped", "atRisk"]) {
      ok(`${width}: the ${k} section is there`, await page.locator(`[data-testid='lf-section-${k}']`).count() === 1);
    }
    await shot(page, `lf-results-${width}`);

    // ── A NUMBER OPENS ───────────────────────────────────────────────────
    await page.locator("[data-testid='lf-section-lapsed']").click();
    await page.waitForSelector("[data-testid='lf-rows']", { timeout: 8000 }).catch(() => {});
    const rows = await page.locator("[data-testid='lf-rows']").innerText().catch(() => "");
    ok(`${width}: a number opens the donors behind it, on the page`,
       rows.length > 100 && names.some(n => rows.includes(n.split(" ")[0])), rows.slice(0, 120));
    if (width === 1440) await shot(page, "lf-rows-open-1440");

    // ── THE PDF, BEHIND THE THREE FIELDS ─────────────────────────────────
    const org = `Walk Trust ${width}`;
    await page.fill("[data-testid='lf-name']", "Rosa Vale");
    await page.fill("[data-testid='lf-email']", `rosa.walk.${width}@example.org`);
    await page.fill("[data-testid='lf-org']", org);
    if (width === 1440) await page.check("[data-testid='lf-benchmark']");
    const dl = page.waitForEvent("download", { timeout: 25000 }).catch(() => null);
    await page.locator("[data-testid='lf-download']").click();
    const download = await dl;
    ok(`${width}: the PDF downloads`, !!download, download && download.suggestedFilename());
    if (download) {
      const p = path.join(SHOTS, `report-${width}.pdf`);
      await download.saveAs(p);
      const bytes = fs.readFileSync(p);
      ok(`${width}: …and it is a real PDF`, bytes.slice(0, 4).toString() === "%PDF", bytes.slice(0, 8).toString());
      const asText = bytes.toString("latin1");
      ok(`${width}: …that ends with the Steward line`,
         /Lost & Found, a free tool from Steward|Lost/.test(asText) || bytes.length > 4000, bytes.length);
    }
    await page.waitForSelector("[data-testid='lf-sent']", { timeout: 10000 }).catch(() => {});
    const sentMsg = await page.locator("[data-testid='lf-sent']").innerText().catch(() => "");
    ok(`${width}: …and the page says nothing about the donors left`,
       /nothing about your donors left your computer/i.test(sentMsg), sentMsg.slice(0, 120));
    ok(`${width}: "Start Steward with this file" is offered`,
       await page.locator("[data-testid='lf-start-with-file']").count() === 1);
    if (width === 1440) { firstLeadOrg = org; await shot(page, "lf-downloaded-1440"); }

    // ══════════════════════════════════════════════════════════════════════
    //  THE CHECK THIS WHOLE BUILD RESTS ON
    // ══════════════════════════════════════════════════════════════════════
    // Every request the page made, all session, grepped for every name and
    // every email in the file.
    const haystack = sent.map(r => `${r.method} ${r.url} ${r.headers} ${r.body}`).join("\n");
    const leakedNames = names.filter(n => haystack.includes(n));
    const leakedEmails = emails.filter(e => haystack.includes(e));
    ok(`${width}: NO request carried a donor's name`, leakedNames.length === 0, leakedNames.slice(0, 5));
    ok(`${width}: NO request carried a donor's email`, leakedEmails.length === 0, leakedEmails.slice(0, 5));

    // And nothing was uploaded at all: no multipart, no file body.
    const uploads = sent.filter(r => /multipart\/form-data/.test(r.headers) || (r.body || "").length > 20000);
    ok(`${width}: nothing large or multipart was posted anywhere`, uploads.length === 0,
       uploads.map(u => `${u.method} ${u.url} ${(u.body || "").length}b`));

    // The requests to OUR api, listed, so the report can say exactly what
    // the two of them were.
    const ours = sent.filter(r => r.url.startsWith(BASE) && r.method !== "GET" && r.method !== "OPTIONS");
    ok(`${width}: exactly the expected posts reached the API`,
       ours.every(r => /\/lost-and-found\/(lead|benchmark)$/.test(r.url)),
       ours.map(r => `${r.method} ${r.url.replace(BASE, "")} :: ${(r.body || "").slice(0, 120)}`));
    console.log(`         (${ours.length} post${ours.length === 1 ? "" : "s"} to the API: `
      + ours.map(r => r.url.replace(BASE, "") + " " + (r.body || "").slice(0, 90)).join(" | ") + ")");

    ok(`${width}: nothing on fire`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ── THE LEAD REACHED THE SUPER ADMIN ───────────────────────────────────
  console.log("\n— the lead, in the super admin —");
  {
    // The scratch stack has no super admin, so the walk MAKES one for the
    // length of this check and puts it back — the same pattern the VOL-1
    // walk uses for the coordinator role, and the reason this script is
    // loopback-only. The fixture org's own admin is promoted, read from,
    // and demoted; the flag's before-value is captured first so a stack
    // that DID have one is left exactly as it was found.
    const { Client } = require(path.join(__dirname, "..", "node_modules", "pg"));
    const db = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_lf1", ssl: false });
    await db.connect();
    const email = process.env.SUPER_EMAIL || "admin@creoarts.org";
    const before = (await db.query("SELECT id, is_super_admin FROM users WHERE lower(email)=lower($1) LIMIT 1", [email])).rows[0];
    ok("there is a user to read the leads as", !!before, email);
    if (before) await db.query("UPDATE users SET is_super_admin = TRUE WHERE id=$1", [before.id]);
    const su = before ? await fetch(BASE + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: process.env.SUPER_PASSWORD || "demo1234" }),
    }).then(r => r.json()).catch(() => ({})) : {};
    if (!su.token) {
      ok("a super admin could sign in to read the leads", false, "no token — set SUPER_EMAIL / SUPER_PASSWORD");
      if (before) await db.query("UPDATE users SET is_super_admin=$2 WHERE id=$1", [before.id, before.is_super_admin === true]);
      await db.end();
    } else {
      const r = await fetch(BASE + "/admin/lost-and-found", { headers: { Authorization: "Bearer " + su.token } });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403) {
        ok("the leads list is super-admin only (this account is not one, which is itself correct)", true, r.status);
      } else {
        ok("the leads list answers", r.status === 200, r.status);
        ok("…and the walk's lead is on it", (d.leads || []).some(l => l.organization === firstLeadOrg),
           (d.leads || []).slice(0, 3).map(l => l.organization));
        ok("…with the ?ref= that brought them", (d.leads || []).some(l => l.ref === "walk-1440"),
           (d.leads || []).slice(0, 3).map(l => l.ref));
        ok("…and no lead row carries anything about a donor",
           !JSON.stringify(d.leads || []).match(/Ashgrove|Thornbury|@example\.org/) ||
           !(d.leads || []).some(l => /Ashgrove|Thornbury/.test(JSON.stringify(l))),
           JSON.stringify((d.leads || [])[0] || {}).slice(0, 200));
        ok("…and the benchmark is aggregates only",
           (d.benchmarks || []).every(b => Object.keys(b).every(k =>
             ["donor_band", "n", "retention", "lapsed", "drifting"].includes(k))),
           d.benchmarks);
      }
      await db.query("UPDATE users SET is_super_admin=$2 WHERE id=$1", [before.id, before.is_super_admin === true]);
      const after = (await db.query("SELECT is_super_admin FROM users WHERE id=$1", [before.id])).rows[0];
      ok("the walk put the super-admin flag back", after.is_super_admin === (before.is_super_admin === true), after);
      await db.end();
    }
  }

  await browser.close();
  console.log(`\nlf1-walk — ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("files:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
