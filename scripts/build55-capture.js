// BUILD-55 — screenshot + assertion pass: the portal-editor layout rework
// (real desktop render, centered phone frame, collapsible library, options
// beside the canvas) and the funds-widget designation/order fixes, against
// the LOCAL stack (tests/README.md recipe).
//
// Prereqs:
//   1. scratch stack up; client built with the localhost overrides:
//        VITE_API_URL=http://localhost:5601 VITE_PORTAL_API=http://localhost:5601/portal \
//        VITE_ACCOUNT_API=http://localhost:5601/account VITE_NETWORK_API=http://localhost:5601/network \
//        npx vite build   →  npx vite preview --port 4173
//      server booted with CORS_ORIGIN=http://localhost:4173
//   2. PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build55-capture.js
//      (self-seeding: registers its own fixture org)
//
// Output: docs/build55/ — editor phone + desktop at 1440/2560, options panel,
// library panel, and the fixed funds widget on the public portal at 390/1440/2560.
const path = require("path");
const fs = require("fs");
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PLAYWRIGHT_DIR, "node_modules", "playwright"));

const APP = process.env.APP || "http://localhost:4173";
const guard = require("./lib/prodGuard");
const API = guard.writerBase("http://localhost:5601");
const OUT = path.join(__dirname, "..", "docs", "build55");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 200) : "")); } };

const EMAIL = "b55cap@test.local", PASS = "loadtest1234";
const j = async (method, p, token, body) => {
  const r = await fetch(API + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

async function seedFixture() {
  let auth = (await j("POST", "/auth/login", null, { email: EMAIL, password: PASS })).body;
  if (!auth.token) {
    auth = (await j("POST", "/auth/register-org", null, { orgName: "B55 Capture Org", userName: "Cap Admin", email: EMAIL, password: PASS })).body;
  }
  const tok = auth.token;
  if (!tok) throw new Error("fixture login/register failed");
  await j("POST", "/onboarding/complete", tok, {});
  // Funds named so alphabetical (Gala first) ≠ the manual order we publish.
  const wanted = ["Gala Reserve", "General Operating", "Youth Arts Access"];
  const have = (await j("GET", "/finance/funds", tok)).body || [];
  for (const name of wanted) {
    if (!have.some?.(f => f.name === name)) await j("POST", "/finance/funds", tok, { name, restricted: name !== "General Operating" });
  }
  const funds = (await j("GET", "/finance/funds", tok)).body;
  const byName = n => funds.find(f => f.name === n)?.id;
  const MANUAL = [byName("General Operating"), byName("Youth Arts Access"), byName("Gala Reserve")].filter(Boolean);
  // Two REAL published updates (fix 12 — the editor must show these, not the sample).
  const ups = (await j("GET", "/impact-updates", tok)).body || [];
  if (!ups.some?.(u => u.title === "Forty students, one stage")) {
    await j("POST", "/impact-updates", tok, { title: "Forty students, one stage", body: "The spring showcase filled every seat.", photos: [], targets: [], orgWide: true, status: "published" });
    await j("POST", "/impact-updates", tok, { title: "New studio lights", body: "Your giving re-lit the main studio.", photos: [], targets: [], orgWide: true, status: "published" });
  }
  await j("PUT", "/portal-page/draft", tok, {
    widgets: [
      { type: "hero", heading: "Every gift builds the season", sub: "A capture-fixture portal page.", image: null, size: "standard" },
      { type: "funds", heading: "Where you can give", fundIds: MANUAL },
      { type: "impact", heading: "What your giving made possible" },
      { type: "quote", text: "This place taught my daughter that her voice matters.", attribution: "A parent" },
      { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
    ],
  });
  await j("POST", "/portal-page/publish", tok, {});
  await j("PUT", "/portal-settings", tok, { enabled: true, displayName: "B55 Capture Org" });
  const slug = auth.org?.org_slug || (await j("GET", "/portal-settings", tok)).body.org_slug;
  return { auth, tok, slug, MANUAL };
}

(async () => {
  const { auth, slug, MANUAL } = await seedFixture();
  ok("fixture seeded (org, funds, updates, published page)", !!auth.token && !!slug && MANUAL.length === 3, { slug, MANUAL });
  const browser = await chromium.launch();

  const editorCtx = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [auth.token, auth.user, auth.org]);
    const p = await ctx.newPage();
    p.on("dialog", d => d.accept());
    await p.goto(APP + "/portal-editor", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Portal editor", { timeout: 15000 });
    await p.waitForTimeout(700);
    return { ctx, p };
  };

  // ── 1. phone mode at 1440: a real phone frame, centered, no permanent rails ──
  {
    const { ctx, p } = await editorCtx(1440, 1000);
    ok("phone: sample-donor banner", await p.isVisible("text=SAMPLE DONOR DATA"));
    ok("phone: widget library is NOT a permanent rail", !(await p.isVisible("text=Add a widget")));
    const frame = p.locator("text=Phone · 390px — how donors arriving from email see it");
    ok("phone: labeled phone frame present", await frame.isVisible());
    const box = await p.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find(d => d.style.width === "390px");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height };
    });
    ok("phone: 390px frame centered horizontally", box && Math.abs(box.cx - 720) < 60, box);
    ok("phone: frame fills most of the vertical space (not a top-left card)", box && box.h > 700, box);
    // fix 12 — the impact widget shows the REAL published update, not the sample
    ok("phone: impact feed shows the org's real update", await p.isVisible("text=Forty students, one stage"));
    ok("phone: sample placeholder gone", !(await p.isVisible("text=Sample impact update")));
    await p.screenshot({ path: path.join(OUT, "editor-phone-1440.png") });
    await ctx.close();
  }

  // ── 2. desktop mode at 1440: the REAL full-width render (grid + ladder) ──
  {
    const { ctx, p } = await editorCtx(1440, 1000);
    await p.click("button:has-text('Desktop')");
    await p.waitForTimeout(500);
    const grid = await p.evaluate(() => {
      const el = document.querySelector(".pe-desktop .pt-widgets");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const wrap = document.querySelector(".pe-desktop .pe-wrap");
      return { display: cs.display, cols: cs.gridTemplateColumns.split(" ").length, wrapW: wrap ? wrap.getBoundingClientRect().width : 0 };
    });
    ok("desktop: .pt-widgets is a real two-track grid (not a phone column)", grid && grid.display === "grid" && grid.cols === 2, grid);
    ok("desktop: canvas column is the published 1140px ladder step", grid && Math.abs(grid.wrapW - 1140) < 8, grid);
    await p.screenshot({ path: path.join(OUT, "editor-desktop-1440.png") });

    // options panel beside the canvas — click the funds widget (the widget
    // body is pointerEvents:none; the decorate wrapper takes the click, so
    // force past Playwright's interception check)
    await p.locator("text=Where you can give").first().click({ force: true });
    await p.waitForTimeout(300);
    ok("options: panel opens beside the canvas on select", await p.isVisible("text=Funds — in display order"));
    ok("options: reorder controls present", await p.isVisible("button[aria-label='Move General Operating down']"));
    ok("options: canvas still visible beside the panel", await p.isVisible("text=Every gift builds the season"));
    await p.screenshot({ path: path.join(OUT, "editor-options-panel-1440.png") });
    // done → panel goes away, canvas reclaims the space
    await p.click("text=Done ✕");
    await p.waitForTimeout(200);
    ok("options: panel closes on Done", !(await p.isVisible("text=Funds — in display order")));

    // library opens from "+ Add widget", closes again
    await p.click("button:has-text('+ Add widget')");
    await p.waitForTimeout(200);
    ok("library: opens on demand", await p.isVisible("text=Add a widget"));
    await p.screenshot({ path: path.join(OUT, "editor-library-open-1440.png") });
    await p.click("[aria-label='Close widget library']");
    await p.waitForTimeout(200);
    ok("library: closes again", !(await p.isVisible("text=Add a widget")));
    await ctx.close();
  }

  // ── 3. desktop at 2560: the canvas SCALES UP (1360 ladder step) ──
  {
    const { ctx, p } = await editorCtx(2560, 1200);
    await p.click("button:has-text('Desktop')");
    await p.waitForTimeout(500);
    const wrapW = await p.evaluate(() => document.querySelector(".pe-desktop .pe-wrap")?.getBoundingClientRect().width || 0);
    ok("desktop@2560: canvas grows to the 1360px ladder step (not pinned)", Math.abs(wrapW - 1360) < 8, wrapW);
    await p.screenshot({ path: path.join(OUT, "editor-desktop-2560.png") });
    await ctx.close();
  }

  // ── 4. the fixed funds widget on the PUBLIC portal at 390/1440/2560 ──
  for (const w of [390, 1440, 2560]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1100 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(`${APP}/portal/${slug}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    const hrefs = await p.evaluate(() =>
      [...document.querySelectorAll("a")].filter(a => a.textContent.trim() === "Give" && a.getAttribute("href")?.includes("/give/"))
        .map(a => a.getAttribute("href")));
    const fundHrefs = hrefs.filter(h => h.includes("?fund="));
    ok(`portal@${w}: every funds card carries its own designation`, fundHrefs.length === 3 && new Set(fundHrefs).size === 3, hrefs);
    const names = await p.evaluate(() => {
      const give = [...document.querySelectorAll("a")].filter(a => a.getAttribute("href")?.includes("?fund="));
      return give.map(a => a.closest("div")?.parentElement?.textContent?.slice(0, 40) || "");
    });
    ok(`portal@${w}: General Operating leads (manual order beats alphabetical)`,
      names.length === 3 && names[0].includes("General Operating"), names);
    await p.screenshot({ path: path.join(OUT, `portal-funds-${w}.png`), fullPage: w !== 390 });
    await ctx.close();
  }

  await browser.close();
  console.log(`\nbuild55-capture: ${pass} passed, ${fail} failed → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
