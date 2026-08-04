// BUILD-34 DSF3 capture + live drive — customizable Home (edit mode).
// Drives the REAL flow end-to-end, not just screenshots: enter edit mode via
// the quiet "Edit" affordance, hide a section (it lands in the Hidden tray),
// reorder via the KEYBOARD path (handle focused, ArrowUp — the accessibility
// bar), save with Done, then reload and assert the server-persisted layout
// came back (order + hidden section), then Reset restores the default.
//   PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:4173 API=http://localhost:5601 \
//     node scripts/build34-capture.js
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const BASE = process.env.BASE || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
const EMAIL = process.env.EMAIL || "admin@creoarts.org";
const PW = process.env.PW || "demo1234";
const OUT = process.env.OUT || "docs/build34-2026-08-04";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0, bad = 0;
const check = (name, cond, extra) => { checks++; if (cond) console.log("  PASS  " + name); else { bad++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra) : "")); } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 3 });
  const res = await page.request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PW } });
  const j = await res.json();
  if (!j.token) throw new Error("login failed: " + JSON.stringify(j));
  const authed = { headers: { Authorization: "Bearer " + j.token } };
  // Start from a clean slate so the run is repeatable.
  await page.request.delete(`${API}/me/home-layout`, authed);
  await page.goto(BASE + "/login");
  await page.evaluate(({ token, user, org }) => {
    localStorage.setItem("npe_token", token);
    localStorage.setItem("npe_user", JSON.stringify(user));
    localStorage.setItem("npe_org", JSON.stringify(org));
  }, { token: j.token, user: j.user, org: j.org });

  await page.goto(BASE + "/dashboard"); await sleep(3200);
  await page.screenshot({ path: path.join(OUT, "home-default.png"), fullPage: true });
  console.log("  ✓ home-default");

  // ── Enter edit mode ───────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Edit Home layout — reorder or hide sections" }).click();
  await sleep(400);
  const handles = await page.getByRole("button", { name: /^Reorder / }).count();
  check("edit mode shows a drag handle per section", handles >= 5, handles);
  check("hero shows 'Always shown' (unhideable), no Hide button", await page.getByText("Always shown").count() === 1 && await page.getByRole("button", { name: "Hide Fundraising goal" }).count() === 0);
  await page.screenshot({ path: path.join(OUT, "edit-mode-handles.png"), fullPage: true });
  console.log("  ✓ edit-mode-handles");

  // ── Hide a section → it collects in the Hidden tray ───────────────────────
  await page.getByRole("button", { name: "Hide Donor retention & signals" }).click();
  await sleep(300);
  check("hidden tray appears with the section", await page.getByText("Hidden — not shown on your Home").count() === 1 && await page.getByRole("button", { name: "Show Donor retention & signals again" }).count() === 1);
  await page.screenshot({ path: path.join(OUT, "edit-hidden-tray.png"), fullPage: true });
  console.log("  ✓ edit-hidden-tray");

  // ── Keyboard reorder: My Portfolio up two slots via arrow keys ────────────
  const handle = page.getByRole("button", { name: /^Reorder My Portfolio/ });
  await handle.focus();
  await page.keyboard.press("ArrowUp"); await sleep(150);
  await page.keyboard.press("ArrowUp"); await sleep(150);
  check("handle keeps focus + announces its new position", /position 2 of/.test(await page.getByRole("button", { name: /^Reorder My Portfolio/ }).getAttribute("aria-label")));
  await page.screenshot({ path: path.join(OUT, "edit-reordered.png"), fullPage: true });
  console.log("  ✓ edit-reordered");

  // ── Done saves (optimistic → server), reload proves persistence ──────────
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await sleep(800);
  let saved = await (await page.request.get(`${API}/me/home-layout`, authed)).json();
  check("server stored the layout (My Portfolio 2nd, retention hidden)",
    saved.layout?.[1]?.id === "myPortfolio" && saved.layout?.find(r => r.id === "retention")?.visible === false, saved);

  await page.reload(); await sleep(3200);
  const order = await page.evaluate(() => {
    const root = document.querySelector(".dash-root");
    const marks = [];
    for (const el of root.querySelectorAll(":scope > *")) {
      if (el.querySelector(".dash-goal-banner")) marks.push("hero");
      else if (el.classList.contains("dash-goal-banner")) marks.push("hero");
      else if (el.querySelector(".portfolio-grid") || /MY PORTFOLIO/.test(el.textContent)) marks.push("myPortfolio");
      else if (/Donor Retention Rate/.test(el.textContent) && /Stewardship debt/.test(el.textContent)) marks.push("retention");
      else if (el.querySelector(".dash-cmd-grid")) marks.push("commandCenter");
    }
    return marks;
  });
  check("after reload: My Portfolio renders ABOVE the command center", order.indexOf("myPortfolio") >= 0 && (order.indexOf("commandCenter") === -1 || order.indexOf("myPortfolio") < order.indexOf("commandCenter")), order);
  check("after reload: the hidden retention section does not render", !order.includes("retention"), order);
  await page.screenshot({ path: path.join(OUT, "home-reordered-persisted.png"), fullPage: true });
  console.log("  ✓ home-reordered-persisted");

  // ── Reset restores the default (and clears the stored row) ───────────────
  await page.getByRole("button", { name: "Edit Home layout — reorder or hide sections" }).click(); await sleep(300);
  await page.getByRole("button", { name: "Reset to default" }).click(); await sleep(300);
  check("reset brings the hidden section back on screen", await page.getByText("Hidden — not shown on your Home").count() === 0);
  await page.getByRole("button", { name: "Done", exact: true }).click(); await sleep(800);
  saved = await (await page.request.get(`${API}/me/home-layout`, authed)).json();
  check("saving the default clears the stored pref (layout:null)", saved.layout === null, saved);

  // ── "Move to top" (FIX 2026-08-04): mouse + keyboard + hero rail + persist ─
  await page.getByRole("button", { name: "Edit Home layout — reorder or hide sections" }).click(); await sleep(400);
  check("hero offers no Top button (it IS the top)", await page.getByRole("button", { name: "Move Fundraising goal to the top" }).count() === 0);
  check("the section already under the hero offers no Top button (no-op hidden)", await page.getByRole("button", { name: "Move Goal breakdown to the top" }).count() === 0);
  // Mouse path: send a lower section straight to the top.
  await page.getByRole("button", { name: "Move Donor retention & signals to the top" }).click(); await sleep(300);
  check("aria-live announces the landing position", /moved to top — position 2 of/.test(await page.getByRole("status").filter({ hasText: "moved to top" }).textContent().catch(() => "")));
  check("moved section's handle now reads position 2 (directly under the hero)",
    /position 2 of/.test(await page.getByRole("button", { name: /^Reorder Donor retention/ }).getAttribute("aria-label")));
  await page.screenshot({ path: path.join(OUT, "edit-move-to-top.png"), fullPage: true });
  console.log("  ✓ edit-move-to-top");
  // Keyboard path: it's a button — focus + Enter.
  const topBtn = page.getByRole("button", { name: "Move Needs attention & outreach to the top" });
  await topBtn.focus(); await page.keyboard.press("Enter"); await sleep(300);
  check("keyboard Enter on the Top button moves the section under the hero",
    /position 2 of/.test(await page.getByRole("button", { name: /^Reorder Needs attention/ }).getAttribute("aria-label")));
  // Done persists via the same save; reload proves it.
  await page.getByRole("button", { name: "Done", exact: true }).click(); await sleep(800);
  saved = await (await page.request.get(`${API}/me/home-layout`, authed)).json();
  check("server stored the move-to-top order (hero, work, retention, …)",
    saved.layout?.[0]?.id === "hero" && saved.layout?.[1]?.id === "work" && saved.layout?.[2]?.id === "retention", saved);
  await page.reload(); await sleep(3200);
  const order2 = await page.evaluate(() => {
    const root = document.querySelector(".dash-root");
    const marks = [];
    for (const el of root.querySelectorAll(":scope > *")) {
      if (el.querySelector(".dash-goal-banner") || el.classList.contains("dash-goal-banner")) marks.push("hero");
      else if (el.querySelector("#dash-needtodo")) marks.push("work");
      else if (/Donor Retention Rate/.test(el.textContent) && /Stewardship debt/.test(el.textContent)) marks.push("retention");
      else if (el.querySelector(".dash-cmd-grid")) marks.push("commandCenter");
    }
    return marks;
  });
  check("after reload: hero first, moved section directly under it", order2[0] === "hero" && order2[1] === "work", order2);
  await page.screenshot({ path: path.join(OUT, "home-move-to-top-persisted.png"), fullPage: true });
  console.log("  ✓ home-move-to-top-persisted");
  // Leave the demo user on the default layout.
  await page.request.delete(`${API}/me/home-layout`, authed);

  await browser.close();
  console.log(`\n${checks - bad}/${checks} checks passed → ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
