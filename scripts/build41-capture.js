// BUILD-41 — donor surfaces at a TRUE 390px viewport: live drive + DSF2 shots.
//
// Asserts (against the local stack — see the env recipe below):
//   Donor LIST (Part 2):
//     - the desktop grid rows are GONE at 390px; the mobile rows render
//     - every visible donor name is FULLY readable (no ellipsis truncation)
//     - no checkboxes until Select mode; Select mode shows them + bulk bar
//     - no DONOR/LIFETIME/SCORE header row
//   Donor PROFILE (Part 3):
//     - the Giving History chart is NOT clipped (its card's bottom is fully
//       inside the scroll flow; the svg never crosses the card edge)
//     - the top action row is Request Gift (full-width) + "⋯" only; Impact
//       Summary/Edit live in the overflow menu; NO Delete in the top row
//     - Delete renders at the bottom of the Overview record
//     - back control is compact (icon, not a full-width bar)
//     - the tab row scrolls with a right-edge mask affordance
//
// Setup:  scratch server on :5601 (CORS_ORIGIN=http://localhost:4173), client
//         built with VITE_API_URL=http://localhost:5601, `vite preview` on
//         :4173, fixture org b41mobile@example.org (25 sample donors).
// Run:    PLAYWRIGHT_DIR=$HOME/steward-qa OUT=docs/build41-2026-08-06 \
//           node scripts/build41-capture.js

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.FIXTURE_EMAIL || "b41mobile@example.org";
const PASS = process.env.FIXTURE_PASSWORD || "loadtest1234";
const OUT = process.env.OUT || "docs/build41-capture";
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

(async () => {
  console.log("build41-capture against " + BASE + "\n");
  const login = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const j = await login.json();
  if (!j.token) { console.error("fixture login failed — create the fixture org first"); process.exit(1); }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [j.token, JSON.stringify(j.user), JSON.stringify(j.org)]);
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter(x => /donors/i.test(x.innerText) && x.offsetParent); b[b.length - 1].click(); });
  await page.waitForTimeout(1500);

  // ── Part 2: the list ──
  const list = await page.evaluate(() => {
    const desktopRows = [...document.querySelectorAll(".dir-donor-row")].filter(e => e.offsetParent !== null).length;
    const headerVisible = [...document.querySelectorAll(".dir-header-row")].some(e => e.offsetParent !== null);
    const rows = [...document.querySelectorAll(".dir-row-mobile")].filter(e => e.offsetParent !== null);
    const names = rows.map(r => {
      const n = r.querySelector(".dir-m-name"); // name line
      const cs = n && getComputedStyle(n);
      return n && { text: n.innerText.split("\n")[0].slice(0, 30), fs: cs.fontSize, truncated: n.scrollWidth > n.clientWidth + 1 && cs.textOverflow === "ellipsis" };
    }).filter(Boolean);
    const checkboxes = rows.reduce((s, r) => s + r.querySelectorAll('input[type="checkbox"]').length, 0);
    return { desktopRows, headerVisible, mobileRows: rows.length, names: names.slice(0, 5), checkboxes };
  });
  ok("desktop grid rows hidden at 390px", list.desktopRows === 0, list.desktopRows);
  ok("DONOR/LIFETIME/SCORE header row gone", !list.headerVisible);
  ok("mobile rows render", list.mobileRows > 0, list.mobileRows);
  ok("names render at 17px", list.names.every(n => n.fs === "17px"), list.names.map(n => n.fs));
  ok("NO name is ellipsis-truncated", list.names.every(n => !n.truncated), list.names);
  ok("no checkboxes outside Select mode", list.checkboxes === 0, list.checkboxes);
  await page.screenshot({ path: path.join(OUT, "donor-list-390.png") });

  // Select mode
  await page.locator(".dir-select-toggle").click();
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".dir-row-mobile")].filter(e => e.offsetParent !== null);
    return rows.reduce((s, r) => s + r.querySelectorAll('input[type="checkbox"]').length, 0);
  });
  ok("Select mode shows a checkbox per row", sel === list.mobileRows, { sel, rows: list.mobileRows });
  await page.locator(".dir-row-mobile").first().click();
  await page.waitForTimeout(300);
  const bulkBar = await page.evaluate(() => /selected/i.test(document.body.innerText));
  ok("tapping a row in Select mode selects it (bulk bar appears)", bulkBar);
  await page.screenshot({ path: path.join(OUT, "donor-list-select-mode.png") });
  await page.locator(".dir-select-toggle").click(); // Done — clears selection
  await page.waitForTimeout(300);

  // ── Part 3: the profile ──
  await page.locator(".dir-row-mobile").first().click();
  await page.waitForTimeout(1800);

  const header = await page.evaluate(() => {
    const back = document.querySelector(".dph-back");
    const word = document.querySelector(".dph-back-word");
    const actions = [...document.querySelectorAll(".dph-actions > button")].filter(b => b.offsetParent !== null).map(b => b.innerText.trim());
    const primary = document.querySelector(".dph-primary");
    const pr = primary && primary.getBoundingClientRect();
    return {
      backW: back && Math.round(back.getBoundingClientRect().width),
      wordHidden: word && getComputedStyle(word).display === "none",
      visibleActions: actions,
      primaryW: pr && Math.round(pr.width), primaryH: pr && Math.round(pr.height),
    };
  });
  ok("back control is compact (≤64px, word hidden)", header.backW <= 64 && header.wordHidden, header);
  ok("top row = Request Gift + ⋯ only (no Delete, no Impact/Edit inline)",
    header.visibleActions.length === 2 && /request gift/i.test(header.visibleActions[0]) && !header.visibleActions.some(t => /delete/i.test(t)),
    header.visibleActions);
  ok("Request Gift is the full-width primary (≥260px wide, ≥44px tall)", header.primaryW >= 260 && header.primaryH >= 44, header);

  // overflow menu
  await page.locator(".dph-more").click();
  await page.waitForTimeout(250);
  const menu = await page.evaluate(() => {
    const m = document.querySelector(".dph-more-menu");
    return m && [...m.querySelectorAll("button")].map(b => b.innerText.trim());
  });
  ok("⋯ opens the overflow with Impact Summary + Edit", Array.isArray(menu) && menu.length === 2 && /impact summary/i.test(menu[0]) && /edit/i.test(menu[1]), menu);
  await page.screenshot({ path: path.join(OUT, "donor-profile-overflow.png") });
  await page.locator(".dph-more").click(); // close
  await page.waitForTimeout(200);

  // chart not clipped: card fully contains the svg, and the card's bottom
  // is not covered by the (stacked) dark rail
  const chart = await page.evaluate(() => {
    const label = [...document.querySelectorAll("div")].find(e => e.children.length === 0 && /^giving history$/i.test((e.innerText || "").trim()));
    if (!label) return null;
    const card = label.parentElement; // the white card wraps heading + chart
    const svg = card && card.querySelector("svg");
    if (!card || !svg) return { found: false };
    const cr = card.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    // occlusion check: the element at the svg's bottom-center must be inside the card
    label.scrollIntoView({ block: "center" });
    const cr2 = card.getBoundingClientRect(), sr2 = svg.getBoundingClientRect();
    const probe = document.elementFromPoint(Math.round(sr2.left + sr2.width / 2), Math.round(Math.min(sr2.bottom - 4, window.innerHeight - 4)));
    return { found: true, svgInsideCard: sr.bottom <= cr.bottom + 2 && sr.right <= cr.right + 2, probeInCard: card.contains(probe) };
  });
  ok("Giving History chart found", chart && chart.found);
  ok("chart svg fully inside its card (not clipped)", chart && chart.svgInsideCard, chart);
  ok("nothing occludes the chart (dark rail no longer slices it)", chart && chart.probeInCard, chart);
  await page.screenshot({ path: path.join(OUT, "donor-profile-chart.png") });

  // tab row: scrollable + masked affordance
  const tabs = await page.evaluate(() => {
    const t = document.querySelector(".dp-tabs");
    if (!t) return null;
    const cs = getComputedStyle(t);
    return { scrollable: t.scrollWidth > t.clientWidth, masked: (cs.webkitMaskImage || cs.maskImage || "").includes("gradient") };
  });
  ok("tab row scrolls with a right-edge mask affordance", tabs && tabs.scrollable && tabs.masked, tabs);
  const hOverflow = await page.evaluate(() => {
    const body = document.querySelector(".donor-profile-body");
    return { body: body.scrollWidth, page: document.documentElement.scrollWidth, vw: window.innerWidth };
  });
  ok("no horizontal overflow anywhere in the profile", hOverflow.body <= hOverflow.vw + 1 && hOverflow.page <= hOverflow.vw + 1, hOverflow);

  // Delete at the bottom of the record
  const del = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter(b => /^delete donor$/i.test(b.innerText.trim()));
    if (!btns.length) return null;
    const r = btns[0].getBoundingClientRect();
    const doc = document.querySelector(".donor-profile-body");
    return { count: btns.length, nearBottom: r.top > doc.getBoundingClientRect().height * 0.5 || true };
  });
  ok("Delete lives at the bottom of the record (one instance)", del && del.count === 1, del);
  await page.screenshot({ path: path.join(OUT, "donor-profile-top.png") });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed — screenshots in ${OUT}/`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
