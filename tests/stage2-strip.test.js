// stage2-strip — STAGE-2 item 1. STAGING SAYS IT'S STAGING; PROD NEVER DOES.
//
// Staging and prod looked identical. Now every page on staging (the app, the
// landing page and the public pages) carries "Staging · not what customers
// see" pinned above everything, and the tab title starts "[Staging] ".
// Guards security: a person must be able to tell the copy that reaches
// customers from the one that doesn't.
//
//   §1 a prod-shaped build with a prod-shaped /health: no strip, no prefix,
//      on the landing page, the app and a public page.
//   §2 the same build with a staging /health (the runtime fallback): the strip
//      on all three, first in <body> (above the demo banner and the app), and
//      the title prefix kept after a page sets its own title, and the site's
//      pinned header below the strip, not under it.
//   §3 a staging BUILD (VITE_STEWARD_ENV=staging), with /health unreachable:
//      the strip still shows. The module is bundled with the client's own
//      esbuild, once with the var and once without.
//
// HOW IT GOES RED: show the strip unconditionally (or read the build var as
// truthy on prod) and §1 fails; drop the /health fallback and §2 fails; drop
// the build-var path and §3 fails.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs cleanly without Playwright.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ok, summary, browserLegOrSkip } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const skip = why => { browserLegOrSkip(why); console.log("\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
let chromium, esbuild;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }
try { esbuild = require(path.join(ROOT, "client", "node_modules", "esbuild")); }
catch { skip("esbuild not found (npm ci --prefix client)"); }

const TEXT = "Staging · not what customers see";
const PAGES = [
  ["the landing page", "/"],
  ["the app (sign-in)", "/login"],
  ["a public giving page", "/give/stage2-no-such-org/no-such-page"],
];

async function look(page, url) {
  await page.goto(APP + url, { waitUntil: "load" });
  await page.waitForTimeout(800);   // the /health fallback runs after load
  return page.evaluate(() => {
    const s = document.getElementById("steward-staging-strip");
    return { strip: s ? s.textContent : null, first: document.body.firstElementChild === s,
      pos: s ? getComputedStyle(s).position : null, title: document.title };
  });
}

(async () => {
  const browser = await chromium.launch();
  try {
    console.log("\n§1 · prod build, prod /health: no strip anywhere");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      for (const [name, url] of PAGES) {
        const r = await look(page, url);
        ok(`§1 ${name}: no strip and no [Staging] in the title`, r.strip === null && !/\[Staging\]/.test(r.title), r);
      }
      await ctx.close();
    }

    console.log("\n§2 · prod build, staging /health (the fallback): the strip on every page");
    {
      const ctx = await browser.newContext();
      await ctx.route(/\/health(\?|$)/, route => route.fulfill({ status: 200, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ product: "steward", env: "staging", status: "ok" }) }));
      const page = await ctx.newPage();
      for (const [name, url] of PAGES) {
        const r = await look(page, url);
        ok(`§2 ${name}: the strip, first in <body>, pinned`, r.strip === TEXT && r.first && r.pos === "sticky", r);
        ok(`§2 ${name}: the tab title starts "[Staging] "`, /^\[Staging\] /.test(r.title) && !/^\[Staging\] \[Staging\]/.test(r.title), r.title);
      }
      await page.goto(APP + "/", { waitUntil: "load" });
      await page.waitForSelector("#steward-staging-strip");
      await page.mouse.wheel(0, 1500); await page.waitForTimeout(300);
      const cover = await page.evaluate(() => { const h = document.querySelector(".mk .hdr"); const s = document.getElementById("steward-staging-strip"); return h && { hdrTop: Math.round(h.getBoundingClientRect().top), stripBottom: Math.round(s.getBoundingClientRect().bottom) }; });
      ok("§2 scrolled, the site's header sits below the strip, not under it", cover && cover.hdrTop >= cover.stripBottom && cover.stripBottom === 24, cover);
      await page.evaluate(() => { document.title = "A page's own title"; });
      await page.waitForTimeout(50);
      ok("§2 a page that sets its own title keeps the prefix", await page.title() === "[Staging] A page's own title", await page.title());
      ok("§2 the strip can't be dismissed (no button, no pointer events)",
        await page.evaluate(() => { const s = document.getElementById("steward-staging-strip"); return !s.querySelector("button,a") && getComputedStyle(s).pointerEvents === "none"; }));
      await ctx.close();
    }

    console.log("\n§3 · a staging build shows the strip with /health unreachable; a prod build doesn't");
    {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-strip-"));
      const bundle = async (envValue, file) => {
        await esbuild.build({
          stdin: { contents: `import { installStagingStrip } from ${JSON.stringify(path.join(ROOT, "client/src/lib/stagingStrip.js"))}; installStagingStrip({ api: "http://stage2-api.test" });`, resolveDir: ROOT, loader: "js" },
          bundle: true, format: "iife", outfile: path.join(out, file), logLevel: "silent",
          define: { "import.meta.env.VITE_STEWARD_ENV": JSON.stringify(envValue) },
        });
        return fs.readFileSync(path.join(out, file), "utf8");
      };
      const staging = await bundle("staging", "staging.js"), prod = await bundle("", "prod.js");
      for (const [label, js, want] of [["staging build", staging, true], ["prod build", prod, false]]) {
        const ctx = await browser.newContext();
        let asked = 0;
        await ctx.route("http://stage2-api.test/**", route => { asked++; return route.abort(); });
        await ctx.route("http://stage2-page.test/", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Give</title><body><div id="root">page</div><script>${js}</script></body>` }));
        const page = await ctx.newPage();
        await page.goto("http://stage2-page.test/", { waitUntil: "load" });
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => { const s = document.getElementById("steward-staging-strip"); return { strip: s && s.textContent, title: document.title }; });
        if (want) ok("§3 staging build: the strip and the prefix, without asking /health", r.strip === TEXT && r.title === "[Staging] Give" && asked === 0, { r, asked });
        else ok("§3 prod build, /health unreachable: no strip", r.strip === null && r.title === "Give", r);
        await ctx.close();
      }
      fs.rmSync(out, { recursive: true, force: true });
    }
  } finally { await browser.close(); }
  summary();
})().catch(e => { console.error(e); process.exit(1); });
