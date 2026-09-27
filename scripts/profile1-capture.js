#!/usr/bin/env node
// PROFILE-1 — the walk. Captures the donor profile at 1440 and 390 beside the
// approved mockup (docs/profile-1/mockup.html), and asserts as it goes so a
// screenshot can never quietly show the wrong thing.
//
// Loopback only: it drives a fixture org, so it refuses any other target.
for (const [k, v] of [["BASE", process.env.BASE], ["APP_URL", process.env.APP_URL]]) {
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "profile-1", "walk");
const DONOR = process.env.DONOR || "d_p1screen";
const EMAIL = process.env.WALK_EMAIL || "p1screen@t.local";
const PWD = process.env.WALK_PW || "loadtest1234";
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 300) : "")); } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
  const browser = await chromium.launch();

  // The mockup, at both widths, as the thing to compare against.
  const mock = path.join(__dirname, "..", "docs", "profile-1", "mockup.html");
  for (const [w, h, tag] of [[1440, 1400, "1440"], [390, 1400, "390"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto("file://" + mock, { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    await p.screenshot({ path: path.join(OUT, `mockup-${tag}.png`), fullPage: true });
    await p.close();
  }
  ok("the mockup was captured at both widths", fs.existsSync(path.join(OUT, "mockup-1440.png")) && fs.existsSync(path.join(OUT, "mockup-390.png")));

  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PWD }) });
  const auth = await r.json();
  if (!auth.token) { console.error("login failed:", JSON.stringify(auth).slice(0, 200)); process.exit(1); }

  for (const [w, h, tag] of [[1440, 1400, "1440"], [390, 1400, "390"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    await p.goto(`${APP}/donors/${DONOR}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector('[data-testid="dp-figures"]', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(2200);

    ok(`@${tag} the rail is on the page`, await p.locator('[data-testid="dp-right-rail"]').count() === 1);
    ok(`@${tag} the rail's ground is ink`,
       (await p.locator('[data-testid="dp-right-rail"]').evaluate(e => getComputedStyle(e).backgroundColor)) === "rgb(15, 26, 18)");
    ok(`@${tag} all four figures are drawn`, await p.locator('[data-testid="dp-figures"] [data-figure-key]').count() === 4);
    ok(`@${tag} the header offers three actions`, await p.locator(".dph-actions > button").count() === 3);
    ok(`@${tag} the six tabs are there`, await p.locator(".dp-tabs button").count() === 6);
    const body = await p.locator("body").innerText();
    ok(`@${tag} nothing says lines were left out`, !/left out/i.test(body));
    ok(`@${tag} nothing says nothing is open while an ask is open`, !/nothing is open/i.test(body));
    await p.screenshot({ path: path.join(OUT, `built-${tag}.png`) });
    await p.screenshot({ path: path.join(OUT, `built-${tag}-full.png`), fullPage: true });
    if (tag === "1440") {
      await p.locator('[data-testid="dp-more"]').click(); await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(OUT, "built-1440-more-open.png") });
      await p.keyboard.press("Escape"); await p.waitForTimeout(250);
      await p.locator('[data-figure-key="profile.lifetime"]').first().click(); await p.waitForTimeout(1600);
      ok("@1440 the Lifetime drawer opens", await p.locator("[data-figure-panel]").count() === 1);
      await p.screenshot({ path: path.join(OUT, "built-1440-lifetime-drawer.png") });
    }
    await p.close();
  }

  await browser.close();
  console.log(`\nprofile1-capture: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
