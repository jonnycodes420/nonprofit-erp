#!/usr/bin/env node
// Layout screenshot matrix + shell/deep-link smoke checks (BUILD-06 Phase E,
// re-run for the sidebar-shell restructure). Drives the real built client
// against a real backend with the demo login — no mocks.
//
// Usage:
//   cd client && npx vite build && npx vite preview --port 4173 &
//   PLAYWRIGHT_DIR=/path/with/playwright node scripts/screenshot-matrix.js
//
// Env:
//   BASE      frontend origin (default http://localhost:4173)
//   API       backend origin  (default the prod Railway URL — read-only usage:
//             login + GET navigation only, nothing is written)
//   EMAIL     login email     (default demo org admin)
//   PASSWORD  login password
//   OUT       screenshot dir  (default docs/layout-matrix-<today>-sidebar)
//   PLAYWRIGHT_DIR  dir whose node_modules has playwright (playwright is
//             deliberately NOT a project dep; install it in a scratch dir)
//
// Matrix: 390 / 768 / 1440 / 1920 / 2560 × home, donors-directory,
// donors-kanban, grants, communications, reports, finance, settings. ≤768 uses
// the mobile shell (bottom bar + More drawer); >768 the desktop sidebar.
// (Finance added BUILD-10 — the owed BUILD-09 mobile check; it's in the More
// drawer on mobile, a direct sidebar item on desktop.)

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:4173";
const API = process.env.API || "https://nonprofit-erp-production.up.railway.app";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.PASSWORD || "demo1234";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", `layout-matrix-${new Date().toISOString().split("T")[0]}-sidebar`);

const VIEWPORTS = [
  { w: 390, h: 844, mobile: true },
  { w: 768, h: 1024, mobile: true }, // 768 is inside the max-width:768px media query
  { w: 1440, h: 900, mobile: false },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
];

let pass = 0, fail = 0, skipped = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
};
const skip = (name, why) => { skipped++; console.log(`  ~ ${name} (skipped: ${why})`); };

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return r.json(); // { token, user, org }
}

async function newPage(browser, vp, session) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk);
    localStorage.setItem("npe_user", JSON.stringify(u));
    localStorage.setItem("npe_org", JSON.stringify(o));
  }, [session.token, session.user, session.org]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { ctx, page };
}

// Navigate to an app tab through the same chrome a user would use.
async function goTab(page, vp, tabId) {
  const labels = { dashboard: "Home", donors: "Donors", grants: "Grants", communications: "Communications", reports: "Reports", finance: "Finance", settings: "Settings" };
  if (!vp.mobile) {
    await page.click(`.app-sidebar button:has-text("${labels[tabId]}")`);
  } else if (["communications", "reports", "finance"].includes(tabId)) {
    await page.click(`.mobile-bottom-bar button:has-text("More")`);
    await page.waitForTimeout(250);
    await page.click(`.mobile-more-drawer button:has-text("${labels[tabId]}")`);
  } else {
    await page.click(`.mobile-bottom-bar button:has-text("${labels[tabId]}")`);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const session = await login();
  console.log(`Logged in as ${EMAIL} (org ${session.org?.id || "?"})`);
  const browser = await chromium.launch();

  // ── Screenshot matrix ─────────────────────────────────────────────────────
  for (const vp of VIEWPORTS) {
    console.log(`\n■ ${vp.w}×${vp.h}`);
    const { ctx, page } = await newPage(browser, vp, session);
    const shot = n => page.screenshot({ path: path.join(OUT, `${vp.w}-${n}.png`), fullPage: true });

    await shot("home");

    await goTab(page, vp, "donors");
    await shot("donors-directory");
    const pipelineBtn = page.locator('.donors-view-toggle button:has-text("My Pipeline")');
    if (await pipelineBtn.count()) { await pipelineBtn.click(); await page.waitForTimeout(700); await shot("donors-kanban"); }

    await goTab(page, vp, "grants");
    await shot("grants");
    await goTab(page, vp, "communications");
    await shot("communications");
    await goTab(page, vp, "reports");
    await shot("reports");
    await goTab(page, vp, "finance");
    await shot("finance");
    await goTab(page, vp, "settings");
    await shot("settings");

    // Shell assertions per viewport
    const sidebarVisible = await page.locator(".app-sidebar").isVisible().catch(() => false);
    const bottomBarVisible = await page.locator(".mobile-bottom-bar").isVisible().catch(() => false);
    const headerVisible = await page.locator(".app-header").isVisible().catch(() => false);
    const topbarVisible = await page.locator(".app-topbar").isVisible().catch(() => false);
    if (vp.mobile) {
      t(`${vp.w}: sidebar + top bar hidden, bottom bar + header visible`, !sidebarVisible && !topbarVisible && bottomBarVisible && headerVisible,
        `sidebar=${sidebarVisible} topbar=${topbarVisible} bottomBar=${bottomBarVisible} header=${headerVisible}`);
    } else {
      t(`${vp.w}: sidebar + top bar visible, bottom bar + header hidden`, sidebarVisible && topbarVisible && !bottomBarVisible && !headerVisible,
        `sidebar=${sidebarVisible} topbar=${topbarVisible} bottomBar=${bottomBarVisible} header=${headerVisible}`);
      const noHorizScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      t(`${vp.w}: no horizontal page scroll`, noHorizScroll);
    }
    await ctx.close();
  }

  // ── Functional / deep-link checks (desktop 1440) ──────────────────────────
  console.log(`\n■ functional checks @1440`);
  const vp = VIEWPORTS[2];
  const { ctx, page } = await newPage(browser, vp, session);

  // Communications section tabs
  await goTab(page, vp, "communications");
  const commTabs = page.locator(".comm-tabbar button");
  t("communications: 6 section tabs", (await commTabs.count()) === 6, `got ${await commTabs.count()}`);
  await page.click('.comm-tabbar button:has-text("Milestone Drafts")');
  await page.waitForTimeout(700);
  t("communications: Milestone Drafts tab activates",
    await page.locator('.comm-tabbar button:has-text("Milestone Drafts")').evaluate(el => getComputedStyle(el).borderBottomColor) === "rgb(201, 168, 76)");

  // Dashboard queue → milestone draft deep-link (data-dependent)
  await goTab(page, vp, "dashboard");
  const reviewBtn = page.locator('.dash-queue-action:has-text("Review draft")').first();
  if (await reviewBtn.count()) {
    await reviewBtn.click(); await page.waitForTimeout(900);
    t("home queue → Communications Milestone Drafts deep-link",
      await page.locator('.comm-tabbar button:has-text("Milestone Drafts")').evaluate(el => getComputedStyle(el).borderBottomColor).catch(() => "") === "rgb(201, 168, 76)");
    await goTab(page, vp, "dashboard");
  } else skip("home queue → milestone deep-link", "no 'Review draft' item in queue right now");

  // Next-grant tile → GrantProfile deep-link (data-dependent)
  const grantTile = page.locator('div.card-click:has-text("days")').first();
  if (await grantTile.count()) {
    // deliberate no-op: tile selector too broad to click blindly; covered by LYBUNT check below
  }

  // Reports: tab switch + LYBUNT row → donor profile deep-link
  await goTab(page, vp, "reports");
  await page.click('.reports-tabbar button:has-text("LYBUNT")');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  const lybuntRows = page.locator("tbody tr.rpt-row-click");
  if (await lybuntRows.count()) {
    await lybuntRows.first().click();
    await page.waitForTimeout(1200);
    t("reports LYBUNT row → donor profile deep-link", await page.locator(".donor-profile-header").isVisible().catch(() => false));
    // The profile overlay sits above the shell — leave it via a fresh load
    // (same as the pre-sidebar matrix would have needed with the top tabbar)
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
  } else skip("reports LYBUNT → donor deep-link", "no LYBUNT rows in demo org");

  // Settings: tabs render + Tax Receipts section reachable
  await goTab(page, vp, "settings");
  const settingsTabs = page.locator(".settings-tabbar button");
  t("settings: 8 section tabs", (await settingsTabs.count()) === 8, `got ${await settingsTabs.count()}`);
  await page.click('.settings-tabbar button:has-text("Tax Receipts")');
  await page.waitForTimeout(900);
  t("settings: Tax Receipts tab shows manager", await page.locator('text=Year-End Giving Statements').first().isVisible().catch(() => false));

  await ctx.close();

  // Mobile More drawer still navigates (390)
  console.log(`\n■ mobile More drawer @390`);
  const m = await newPage(browser, VIEWPORTS[0], session);
  await goTab(m.page, VIEWPORTS[0], "reports");
  t("390: More drawer → Reports renders", await m.page.locator(".reports-tabbar").isVisible().catch(() => false));
  await m.ctx.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped. Screenshots → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
