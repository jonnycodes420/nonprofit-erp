#!/usr/bin/env node
// BUILD-49 — DSF2 screenshots + DOM assertions for the DONOR FRONT DOOR, at
// 390 AND 1440:
//   • the signed-out /giving landing page (hero + auth card + value trio +
//     the org-blindness promise band), password primary with the emailed
//     sign-in link offered as the alternate;
//   • the from=<slug> courtesy theming on the signup card;
//   • the post-donation thank-you screen entry point — present for a LISTED
//     org, absent for an unlisted one;
//   • Settings › Donor Portal "Put it on your website" snippet + preview.
//
// Local stack recipe (the BUILD-45/46/47/48 capture conventions):
//   client built with VITE_API_URL=http://localhost:5601
//     VITE_PORTAL_API=http://localhost:5601/portal
//     VITE_ACCOUNT_API=http://localhost:5601/account
//     VITE_NETWORK_API=http://localhost:5601/network
//   `npx vite preview --port 4173` + server booted with
//   CORS_ORIGIN=http://localhost:4173 and DONOR_ACCOUNTS_ENABLED=1.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build49-capture.js
//
// Reuses the donor-front-door suite's fixture orgs (dfd-listed/dfd-unlisted);
// run `DB_SSL=disable node tests/donor-front-door.test.js` first if absent.
const fs = require("fs");
const { chromium } = require(process.env.PLAYWRIGHT_DIR + "/node_modules/playwright");

const API = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP || "http://localhost:4173";
const OUT = process.env.OUT || (__dirname + "/../docs/build49-front-door");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n, d ?? ""); } };

const LISTED = "dfd-listed", UNLISTED = "dfd-unlisted";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const health = await fetch(API + "/health").then(r => r.json()).catch(() => null);
  if (!health || health.status !== "ok") { console.error("server not up on " + API); process.exit(1); }
  const pubL = await fetch(`${API}/org/${LISTED}/public`).then(r => r.json()).catch(() => null);
  if (!pubL || !pubL.org) { console.error("fixture missing — run tests/donor-front-door.test.js first"); process.exit(1); }

  const browser = await chromium.launch();
  const shoot = async (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

  for (const [label, vw] of [["1440", { width: 1440, height: 960 }], ["390", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vw, deviceScaleFactor: 2 });
    const page = await ctx.newPage();

    // ── the landing (signed out) ──────────────────────────────────────────
    await page.goto(APP + "/giving", { waitUntil: "networkidle" });
    ok(`[${label}] landing headline renders`, await page.locator("h1", { hasText: "All of your giving" }).count() === 1);
    ok(`[${label}] auth card present with password primary`, await page.locator("input[type=password]").count() >= 1);
    ok(`[${label}] sign-in-link alternate offered`,
      await page.locator("button", { hasText: "Email me a sign-in link" }).count() >= 1);
    ok(`[${label}] value trio renders`, await page.locator("text=Recurring gifts, under control").count() === 1);
    ok(`[${label}] org-blindness promise stated`,
      (await page.locator("text=never share").first().innerText().catch(() => "")).length > 0);
    ok(`[${label}] no horizontal page scroll`,
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok(`[${label}] tab title set`, (await page.title()).includes("Your Giving"));
    await shoot(page, `giving-landing-${label}`);

    // ── signup mode via an entry link with from=<slug> ────────────────────
    // (fresh document load — an entry link is always a fresh navigation; a
    // same-path hash change on an already-open /giving deliberately doesn't
    // re-derive auth mode)
    await page.goto("about:blank");
    await page.goto(APP + `/giving#signup&from=${LISTED}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    ok(`[${label}] entry link lands in signup mode`,
      await page.locator("h2", { hasText: "Create your giving account" }).count() === 1);
    ok(`[${label}] from=<slug> courtesy line renders`,
      (await page.locator("text=You're connecting with").count()) === 1);
    await shoot(page, `giving-signup-from-${label}`);

    // ── thank-you screen: listed shows the offer, unlisted never does ─────
    await page.goto(APP + `/give/${LISTED}?donated=true`, { waitUntil: "networkidle" });
    ok(`[${label}] listed thank-you offers the giving account`,
      await page.locator("a", { hasText: "Create your free giving account" }).count() === 1);
    ok(`[${label}] thank-you link carries from=<slug> in the fragment`,
      (await page.locator("a", { hasText: "Create your free giving account" }).getAttribute("href")) === `/giving#signup&from=${LISTED}`);
    await shoot(page, `thankyou-listed-${label}`);
    await page.goto(APP + `/give/${UNLISTED}?donated=true`, { waitUntil: "networkidle" });
    ok(`[${label}] unlisted thank-you has NO giving-account offer`,
      await page.locator("a", { hasText: "Create your free giving account" }).count() === 0);
    if (label === "390") await shoot(page, `thankyou-unlisted-${label}`);

    await ctx.close();
  }

  // ── Settings › Donor Portal snippet (desktop only) ──────────────────────
  const login = await fetch(API + "/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `admin@${LISTED}.test.local`, password: "loadtest1234" }),
  }).then(r => r.json());
  if (login.token) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [login.token, login.user, login.org]);
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.locator("button", { hasText: "Settings" }).first().click({ timeout: 5000 }).catch(() => {});
    await page.locator("text=Donor Portal").first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const snippet = page.locator("text=Put it on your website");
    ok("Settings snippet section renders for the listed org", await snippet.count() === 1);
    ok("snippet contains the from=<slug> giving link",
      (await page.locator("text=/giving#from=" + LISTED).count()) >= 1);
    if (await snippet.count()) await snippet.first().scrollIntoViewIfNeeded();
    await shoot(page, "settings-website-snippet-1440");
    await ctx.close();
  } else {
    ok("Settings snippet capture (admin login)", false, login);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
