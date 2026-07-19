#!/usr/bin/env node
// BUILD-21 DSF3 capture — Home typed/roll-up hero + Funds (negative balance) +
// the error-boundary fallback. Playwright is deliberately NOT a project dep
// (CLAUDE.md) — install it in a scratch dir and pass PLAYWRIGHT_DIR.
//
// Usage (against a local vite dev + local server + the seeded org):
//   PLAYWRIGHT_DIR=/path/to/scratch/pw \
//   BASE=http://localhost:5173 API=http://localhost:5601 \
//   EMAIL=b21@demo.local PASSWORD=demo1234 \
//   node scripts/build21-capture.js
//
// The seed (a local demo org with an overarching Annual goal + Project/Capital
// children + a standalone goal, and funds incl. a negative Gala Reserve) is
// described in the BUILD-21 PROGRESS entry.

const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || ".", "node_modules", "playwright"));

const BASE = process.env.BASE || "http://localhost:5173";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.EMAIL || "b21@demo.local";
const PASSWORD = process.env.PASSWORD || "demo1234";
const OUT = path.join(__dirname, "..", "docs", "build21-2026-07-19");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();

  // Log in against the local API, then seed localStorage exactly like LoginPage.
  await page.goto(BASE + "/login");
  const auth = await page.evaluate(async ({ API, EMAIL, PASSWORD }) => {
    const r = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    const d = await r.json();
    localStorage.setItem("npe_token", d.token);
    localStorage.setItem("npe_user", JSON.stringify(d.user));
    localStorage.setItem("npe_org", JSON.stringify(d.org));
    return { ok: r.status, user: d.user?.name };
  }, { API, EMAIL, PASSWORD });
  if (auth.ok !== 200) throw new Error("login failed: " + JSON.stringify(auth));

  // 1. Home — typed/roll-up hero + Annual/Capital/Project breakdown.
  await page.goto(BASE + "/dashboard");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, "home-rollup-hero.png") });

  // 2. Finance › Funds — negative Gala Reserve balance renders (no crash).
  await page.getByRole("button", { name: /Finance/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByText("Funds", { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, "funds-negative-balance.png") });

  console.log("Saved screenshots to", OUT);
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
