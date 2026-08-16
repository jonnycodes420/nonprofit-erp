// BUILD-54 §7 — screenshot + assertion pass over the new donor-experience
// surfaces, against the LOCAL stack (tests/README.md recipe).
//
// Prereqs (the fixtures come from the committed suites + the network demo):
//   1. scratch stack up; client built with the localhost overrides:
//        VITE_API_URL=http://localhost:5601 VITE_PORTAL_API=http://localhost:5601/portal \
//        VITE_ACCOUNT_API=http://localhost:5601/account VITE_NETWORK_API=http://localhost:5601/network \
//        npx vite build   →  npx vite preview --port 4173
//      server booted with CORS_ORIGIN=http://localhost:4173
//   2. DB_SSL=disable BASE=http://localhost:5601 node tests/campaign-impact.test.js
//      DB_SSL=disable BASE=http://localhost:5601 node tests/portal-page.test.js
//      DATABASE_URL=…:5544 BASE=http://localhost:5601 node scripts/seed-build46-network-demo.js
//   3. PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build54-capture.js
//
// Output: docs/build54/ at 390, 1440, and 2560.
const path = require("path");
const fs = require("fs");
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME, "steward-qa");
const { chromium } = require(path.join(PLAYWRIGHT_DIR, "node_modules", "playwright"));

const APP = process.env.APP || "http://localhost:4173";
const API = process.env.BASE || "http://localhost:5601";
const OUT = path.join(__dirname, "..", "docs", "build54");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n); } };
const WIDTHS = [390, 1440, 2560];

async function login(email, password) {
  const r = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return r.json();
}
async function donorCookie(email, password) {
  const r = await fetch(API + "/account/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const m = (r.headers.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? m[1] : null;
}

(async () => {
  const browser = await chromium.launch();

  // ── donor dashboard: 1-org (Harper) and 2-org (Alex, n46 demo) ───────────
  for (const [label, email, pw] of [["dashboard-1org", "harper@ci54.test", "loadtest1234"], ["dashboard-2org", "alex.demo@n46.test", "alexdemo999"]]) {
    const cookie = await donorCookie(email, pw);
    ok(`${label}: donor session`, !!cookie);
    if (!cookie) continue;
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 2 });
      await ctx.addCookies([{ name: "steward_portal", value: cookie, url: APP }]);
      const p = await ctx.newPage();
      await p.goto(APP + "/giving", { waitUntil: "networkidle" }).catch(() => {});
      await p.waitForTimeout(600);
      await p.screenshot({ path: path.join(OUT, `${label}-${w}.png`), fullPage: true });
      await ctx.close();
    }
    console.log(`  shot  ${label} @ ${WIDTHS.join("/")}`);
  }

  // ── drill-down + campaign spotlight with a REAL attributed gift ──────────
  {
    const cookie = await donorCookie("harper@ci54.test", "loadtest1234");
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 1100 }, deviceScaleFactor: 2 });
      await ctx.addCookies([{ name: "steward_portal", value: cookie, url: APP }]);
      const p = await ctx.newPage();
      await p.goto(APP + "/giving/orgs/campimpact-a", { waitUntil: "networkidle" }).catch(() => {});
      await p.waitForTimeout(700);
      if (w === 1440) {
        ok("drill-down: full-bleed banner (no boxed column)", await p.evaluate(() =>
          [...document.querySelectorAll("header div")].some(d => Math.abs(d.getBoundingClientRect().width - window.innerWidth) < 2)));
        ok("drill-down: campaign spotlight renders the attributed campaign",
          await p.isVisible("text=Steeples and Studios Campaign"));
        ok("drill-down: thank-you state present", await p.isVisible("text=Thank you"));
        ok("drill-down: nav present without backing out", await p.isVisible("nav[aria-label='Your giving']"));
        ok("drill-down: no duplicate largest-gift stat", !(await p.isVisible("text=Largest gift"))
          || (await p.evaluate(() => {
            const t = document.body.innerText;
            const m = t.match(/This year\s*\$([\d,]+)/); const l = t.match(/Largest gift\s*\$([\d,]+)/);
            return !m || !l || m[1] !== l[1];
          })));
        // 2026-08-15 wide-width pass: the giving-summary stats sit BESIDE the
        // year bars at 1440 (bounding boxes overlap vertically, bars to the
        // right of the stats block — pt-mygiving-grid in Portal.jsx).
        ok("drill-down: stats beside the year bars at 1440", await p.evaluate(() => {
          const s = document.querySelector(".pt-mygiving-stats");
          const b = document.querySelector(".pt-mygiving-bars");
          if (!s || !b) return false;
          const rs = s.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rs.top < rb.bottom && rb.top < rs.bottom && rb.left > rs.right - 10;
        }));
      }
      if (w === 390) {
        // 2026-08-15 wide-width pass: 390 stays a single column — the summary
        // grid is stacked and nothing scrolls horizontally.
        ok("drill-down: summary stacks single-column at 390", await p.evaluate(() => {
          const g = document.querySelector(".pt-mygiving-grid");
          return !!g && getComputedStyle(g).display !== "grid";
        }));
        ok("drill-down: no horizontal scroll at 390", await p.evaluate(() =>
          document.documentElement.scrollWidth <= window.innerWidth + 1));
      }
      await p.screenshot({ path: path.join(OUT, `drilldown-spotlight-${w}.png`), fullPage: true });
      await ctx.close();
    }
    console.log("  shot  drilldown-spotlight @ " + WIDTHS.join("/"));
  }

  // ── published widget page, signed out (public degradation) ───────────────
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1100 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(APP + "/portal/portalpage-a", { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(600);
    if (w === 1440) {
      ok("public page: sign-in path always present", await p.isVisible("text=Email me a sign-in link"));
      // 2026-08-15 wide-width pass: the published-page widget list is a
      // two-track grid at 1440 (.pt-widgets); when the layout carries 2+
      // pairable (non-full-span) widgets, at least one pair shares a row.
      ok("public page: widget grid is two-track at 1440, pairable widgets share a row", await p.evaluate(() => {
        const g = document.querySelector(".pt-widgets");
        if (!g) return false;
        const cs = getComputedStyle(g);
        if (cs.display !== "grid" || cs.gridTemplateColumns.split(" ").filter(Boolean).length !== 2) return false;
        const gw = g.getBoundingClientRect().width;
        const narrow = [...g.children].filter(k => k.getBoundingClientRect().width < gw * 0.7);
        if (narrow.length < 2) return true; // grid live; fixture has <2 pairable widgets
        return narrow.some((a, i) => narrow.slice(i + 1).some(b => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return ra.top < rb.bottom && rb.top < ra.bottom && Math.abs(ra.left - rb.left) > 10;
        }));
      }));
    }
    if (w === 390) {
      ok("public page: single column at 390 (widget grid off)", await p.evaluate(() => {
        const g = document.querySelector(".pt-widgets");
        return !!g && getComputedStyle(g).display !== "grid";
      }));
      ok("public page: no horizontal scroll at 390", await p.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth + 1));
    }
    await p.screenshot({ path: path.join(OUT, `portal-page-public-${w}.png`), fullPage: true });
    await ctx.close();
  }
  console.log("  shot  portal-page-public @ " + WIDTHS.join("/"));

  // ── edit mode: phone default + desktop; each starter layout ──────────────
  {
    const auth = await login("pp54-a@test.local", "loadtest1234");
    ok("editor: admin login", !!auth.token);
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [auth.token, auth.user, auth.org]);
    const p = await ctx.newPage();
    p.on("dialog", d => d.accept());
    await p.goto(APP + "/portal-editor", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Portal editor", { timeout: 15000 });
    ok("editor: sample-donor banner", await p.isVisible("text=SAMPLE DONOR DATA"));
    await p.screenshot({ path: path.join(OUT, "editor-phone.png") });
    await p.click("button:has-text('Desktop')");
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, "editor-desktop.png") });
    // each starter (applied to the draft, shot in the phone frame, then next)
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + auth.token };
    const meta = await (await fetch(API + "/portal-page", { headers: H })).json();
    for (const s of meta.starters) {
      await fetch(API + "/portal-page/starter", { method: "POST", headers: H, body: JSON.stringify({ key: s.key }) });
      await p.click("button:has-text('Phone')");
      await p.reload({ waitUntil: "networkidle" });
      await p.waitForSelector("text=Portal editor", { timeout: 15000 });
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(OUT, `starter-${s.key}.png`) });
    }
    ok("editor: all starters shot", meta.starters.length >= 3);
    await ctx.close();
    console.log("  shot  editor phone/desktop + starters");
  }

  // ── CRM Donor Portal section + uploader states ───────────────────────────
  {
    const auth = await login("ci54-a@test.local", "loadtest1234");
    for (const w of [390, 1440]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 1100 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(([t, u, o]) => {
        localStorage.setItem("npe_token", t);
        localStorage.setItem("npe_user", JSON.stringify(u));
        localStorage.setItem("npe_org", JSON.stringify(o));
      }, [auth.token, auth.user, auth.org]);
      const p = await ctx.newPage();
      await p.goto(APP + "/dashboard", { waitUntil: "networkidle" }).catch(() => {});
      // navigate to the Donor Portal tab via the real nav
      const navBtn = w === 1440 ? "button:has-text('Donor Portal')" : "text=More";
      try {
        if (w === 390) { await p.click("text=More"); await p.waitForTimeout(300); }
        await p.click("button:has-text('Donor Portal')");
        await p.waitForTimeout(900);
      } catch { /* keep the shot anyway */ }
      if (w === 1440) {
        // BUILD-54 follow-up (2026-08-15): the appearance form moved INTO the
        // portal editor (Design mode); the CRM hub is slim — status, buttons,
        // engagement, impact updates, campaign entry. Pin the new contract.
        ok("CRM: Donor Portal hub with edit-mode button", await p.isVisible("text=Edit the portal"));
        ok("CRM: portal links are buttons (open + copy), never raw URL text", (
          await p.isVisible("text=Open the live portal")
          && await p.isVisible("text=Copy link")
          && !(await p.evaluate(() => document.body.innerText.includes("/portal/creo-arts")))
        ));
        ok("CRM: theme editing moved out of the hub (no color pickers)",
          (await p.locator("input[type='color']").count()) === 0);
      }
      await p.screenshot({ path: path.join(OUT, `crm-donor-portal-${w}.png`), fullPage: true });
      await ctx.close();
    }
    console.log("  shot  crm-donor-portal @ 390/1440");
  }

  console.log(`\n${pass} passed, ${fail} failed → ${OUT}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
