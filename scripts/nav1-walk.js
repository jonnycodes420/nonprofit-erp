// NAV-1 verification walk — A SIDEBAR YOU CAN SCAN.
//
// Everything in this build is a screen, so the walk reads the real rail rather
// than the source: a group that is right in navGroups.js and wrong on the page
// is exactly the defect this is for. At 1440 and at 390.
//
//   §1 the groups, in order, with their labels — and no "More" fold
//   §2 every item opens its page; the old /dashboards URL lands on Reports
//   §3 thirteen literal icons, one per item, no two alike, one size
//   §4 Customize: hide one, move one, reset — and it survives a reload
//   §5 collapsed: icons only, names as tooltips, labels become dividers
//   §6 the phone at 390: the same groups in the More drawer
//   §7 the volunteer coordinator starts with Finance hidden
//
//   APP=http://localhost:4193 API=http://localhost:5631 \
//     PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/nav1-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = process.env.APP || "http://localhost:4173";
const API = process.env.API || "http://localhost:5601";
const OUT = process.env.OUT_DIR || path.join(__dirname, "..", "docs", "nav1");

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 400)));
  if (!cond) failures++;
};

const EXPECT = [
  { group: "start", label: null, items: ["Home", "Tasks"] },
  { group: "relationships", label: "RELATIONSHIPS", items: ["Donors", "Journeys", "Communications"] },
  { group: "raise", label: "RAISE", items: ["Fundraising", "Events", "Grants"] },
  { group: "volunteers", label: "VOLUNTEERS", items: ["Volunteers"] },
  { group: "money", label: "MONEY", items: ["Finance", "Reports"] },
];
const BOTTOM = ["Agent", "Settings"];

// The rail, read off the page: one entry per group, in document order.
const readRail = page => page.$$eval(".app-sidebar [data-nav-group]", gs => gs.map(g => ({
  group: g.getAttribute("data-nav-group"),
  // The label is the group's first child when it is not a button.
  label: (() => {
    const first = g.firstElementChild;
    if (!first || first.tagName === "BUTTON") return null;
    // innerText applies text-transform, textContent does not — and the labels
    // are uppercased in CSS, which is what the reader actually sees.
    const t = (first.innerText || "").trim();
    return t || (first.getAttribute("aria-hidden") === "true" ? "DIVIDER" : null);
  })(),
  items: [...g.querySelectorAll("button[data-nav-id]")].map(b => ({
    id: b.getAttribute("data-nav-id"),
    text: (b.innerText || "").split("\n").map(s => s.trim()).filter(Boolean)[0] || "",
    icons: b.querySelectorAll("svg").length,
  })),
})));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = Date.now().toString(36);
  const reg = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Harbour Light " + stamp, userName: "Mike Henderson", email: `nav1_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  const token = reg.token;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  await api("POST", "/onboarding/complete", {});
  // The org row the app stores must say onboarding is done, or WelcomePage
  // sends every page load to /welcome and the rail is never drawn.
  const org = (await api("GET", "/org")).body;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error" && !/_vercel|fonts\.googleapis|favicon/.test(m.location()?.url || "")) consoleErrors.push(m.text().slice(0, 160)); });

  const signIn = async p => {
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.evaluate(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [token, reg.user, org && org.id ? org : { ...reg.org, onboarding_complete: 1 }]);
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    // At 390 the sidebar is display:none, so wait for the shell and then for
    // whichever nav that viewport actually draws.
    await p.waitForSelector(".app-root", { timeout: 25000 });
    await p.waitForFunction(() => document.querySelector(".app-sidebar [data-nav-group]") || document.querySelector(".mobile-bottom-bar button"), null, { timeout: 25000 });
    // The once-per-org greeting is a full-screen takeover; it intercepts every
    // click until it is dismissed.
    const go = await p.$("[data-testid=\"first-run-go\"]");
    if (go) { await go.click(); await p.waitForTimeout(800); }
    await p.waitForTimeout(900);
  };
  await signIn(page);

  // ── §1 the groups, in order ──────────────────────────────────────────────
  console.log("\n— §1 · the groups, in order, with their labels —");
  let rail = await readRail(page);
  const work = rail.filter(g => g.group !== "bottom");
  ok("the rail is five groups then the pinned pair", rail.length === 6 && rail[5].group === "bottom",
     rail.map(g => g.group));
  EXPECT.forEach((e, i) => {
    const got = work[i] || { items: [] };
    ok(`group ${i + 1} is ${e.group} with ${e.items.join(", ")}`,
       got.group === e.group && JSON.stringify(got.items.map(x => x.text)) === JSON.stringify(e.items),
       { want: e, got });
    ok(`group ${e.group} is labelled ${e.label === null ? "(nothing)" : e.label}`,
       (got.label || null) === e.label, { want: e.label, got: got.label });
  });
  const bottom = rail.find(g => g.group === "bottom") || { items: [] };
  ok("the bottom of the rail is Agent then Settings",
     JSON.stringify(bottom.items.map(x => x.text)) === JSON.stringify(BOTTOM), bottom.items);
  const moreFold = await page.$$eval(".app-sidebar .side-nav-btn", bs => bs.filter(b => /^MORE$/i.test((b.innerText || "").trim())).length);
  ok("there is no \"More\" fold any more", moreFold === 0, moreFold);
  const flatCount = rail.reduce((n, g) => n + g.items.length, 0);
  ok("every nav item sits inside a group (none loose)",
     flatCount === await page.$$eval(".app-sidebar button[data-nav-id]", b => b.length), flatCount);

  // ── §3 the icons ─────────────────────────────────────────────────────────
  console.log("\n— §3 · thirteen literal icons, one size, no two alike —");
  const icons = await page.$$eval(".app-sidebar button[data-nav-id] svg", ss => ss.map(s => ({
    w: s.getAttribute("width"), h: s.getAttribute("height"),
    stroke: s.getAttribute("stroke-width"),
    d: [...s.querySelectorAll("path,circle,rect,line,polyline")].map(n => n.getAttribute("d") || n.outerHTML).join("|"),
    id: s.closest("button").getAttribute("data-nav-id"),
  })));
  ok("every nav item draws exactly one icon",
     rail.every(g => g.items.every(i => i.icons === 1)), rail.map(g => g.items.map(i => [i.id, i.icons])));
  ok("every icon is 20px with the same stroke width",
     icons.length > 0 && icons.every(i => i.w === "20" && i.h === "20" && i.stroke === icons[0].stroke),
     icons.map(i => [i.id, i.w, i.stroke]));
  const shapes = new Map();
  icons.forEach(i => shapes.set(i.d, [...(shapes.get(i.d) || []), i.id]));
  const dupes = [...shapes.values()].filter(v => v.length > 1);
  ok("no two nav items share an icon", dupes.length === 0, dupes);

  // ── §2 every item opens its page ─────────────────────────────────────────
  console.log("\n— §2 · every item opens its page —");
  const ids = rail.flatMap(g => g.items.map(i => i.id));
  const seen = [];
  for (const id of ids) {
    consoleErrors.length = 0;
    await page.click(`.app-sidebar button[data-nav-id="${id}"]`);
    await page.waitForTimeout(1000);
    const current = await page.$eval(".app-sidebar button[data-nav-id][aria-current]", b => b.getAttribute("data-nav-id")).catch(() => null);
    const body = (await page.innerText(".app-content").catch(() => "")).trim();
    const boundary = /Something went wrong|This screen hit an error/i.test(body);
    ok(`${id} opens, the rail moves to it, and the screen is not blank`,
       current === id && body.length > 40 && !boundary && consoleErrors.length === 0,
       { current, len: body.length, boundary, consoleErrors });
    seen.push(body.slice(0, 60));
  }
  ok("the walk saw a different screen each time", new Set(seen).size === seen.length, seen.length - new Set(seen).size);

  // the old /dashboards URL
  await page.goto(APP + "/dashboards", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-sidebar [data-nav-group]", { timeout: 25000 });
  await page.waitForTimeout(1600);
  const afterOld = await page.$eval(".app-sidebar button[data-nav-id][aria-current]", b => b.getAttribute("data-nav-id")).catch(() => null);
  const railItem = await page.$eval("[data-testid=\"reports-rail\"] [data-report-id][aria-current]", b => b.getAttribute("data-report-id")).catch(() => null);
  const dashAnswer = await page.$$eval("[data-dash-answer]", n => n.length);
  ok("the old /dashboards URL lands on Reports, on a dashboard", afterOld === "reports" && railItem === "dash:board" && dashAnswer === 1,
     { afterOld, railItem, dashAnswer, url: page.url() });
  const dashGroup = await page.$eval("[data-testid=\"rail-list\"] [data-group-id]", g => g.getAttribute("data-group-id")).catch(() => null);
  ok("Dashboards is the FIRST group of the Reports rail", dashGroup === "dashboards", dashGroup);
  const nestedRails = await page.$$eval(".dash-rail", n => n.length);
  ok("there is no second rail inside Reports", nestedRails === 0, nestedRails);
  await page.screenshot({ path: path.join(OUT, "reports-dashboards-1440.png"), fullPage: false });

  // ── §4 Customize ─────────────────────────────────────────────────────────
  console.log("\n— §4 · Customize: hide, move, reset —");
  await page.click(".app-sidebar button[data-nav-id=\"dashboard\"]");
  await page.waitForTimeout(600);
  await page.click("[data-testid=\"nav-customize\"]");
  await page.waitForSelector("[data-testid=\"customize-nav\"]", { timeout: 8000 });
  await page.screenshot({ path: path.join(OUT, "customize-1440.png") });
  const pinned = await page.$$eval("[data-nav-row=\"dashboard\"] button, [data-nav-row=\"settings\"] button", bs => bs.map(b => b.getAttribute("data-nav-toggle")).filter(Boolean));
  ok("Home and Settings have no Hide button", pinned.length === 0, pinned);
  await page.click("[data-nav-toggle=\"grants\"]");
  await page.waitForTimeout(500);
  await page.click("[data-nav-row=\"events\"] button[aria-label^=\"Move Events up\"]");
  await page.waitForTimeout(700);
  rail = await readRail(page);
  const raise = rail.find(g => g.group === "raise");
  ok("hiding Grants takes it off the rail", !raise.items.some(i => i.id === "grants"), raise.items.map(i => i.id));
  ok("moving Events up reorders RAISE", JSON.stringify(raise.items.map(i => i.id)) === JSON.stringify(["events", "fundraising"]), raise.items.map(i => i.id));
  const saved = (await api("GET", "/me/nav-layout")).body.layout || [];
  ok("the choice is stored per user on the server",
     saved.find(r => r.id === "grants")?.visible === false, saved.filter(r => ["grants", "events", "fundraising"].includes(r.id)));
  // and it survives a reload, in a NEW browser context (so not localStorage)
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page2 = await ctx2.newPage();
  await signIn(page2);
  const rail2 = await readRail(page2);
  const raise2 = rail2.find(g => g.group === "raise");
  ok("another browser shows the same customized rail",
     JSON.stringify(raise2.items.map(i => i.id)) === JSON.stringify(["events", "fundraising"]), raise2.items.map(i => i.id));
  await ctx2.close();
  // reset
  await page.click("[data-testid=\"nav-reset\"]");
  await page.waitForTimeout(800);
  rail = await readRail(page);
  ok("Reset to default puts the groups back",
     JSON.stringify(rail.filter(g => g.group !== "bottom").map(g => g.items.map(i => i.text))) ===
     JSON.stringify(EXPECT.map(e => e.items)), rail.map(g => g.items.map(i => i.id)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ── §5 collapsed ─────────────────────────────────────────────────────────
  console.log("\n— §5 · collapsed: icons only, names as tooltips —");
  await page.click("[data-testid=\"sidebar-toggle\"]");
  await page.waitForTimeout(700);
  const collapsed = await page.$$eval(".app-sidebar button[data-nav-id]", bs => bs.map(b => ({
    id: b.getAttribute("data-nav-id"), text: (b.innerText || "").trim(),
    title: b.getAttribute("title"), label: b.getAttribute("aria-label"), icons: b.querySelectorAll("svg").length,
  })));
  ok("collapsed, every item is its icon with the name as a tooltip",
     collapsed.length === ids.length && collapsed.every(c => c.text === "" && c.icons === 1 && c.title && c.label),
     collapsed.filter(c => c.text !== "" || !c.title));
  const labelsNow = await page.$$eval(".app-sidebar [data-nav-group] > div:first-child", ds => ds.map(d => ({ txt: (d.textContent || "").trim(), h: Math.round(d.getBoundingClientRect().height) })).filter(d => d.h <= 2 || d.txt));
  ok("a group label is a thin divider, never truncated text",
     labelsNow.every(d => d.txt === ""), labelsNow);
  await page.screenshot({ path: path.join(OUT, "collapsed-1440.png") });
  await page.click("[data-testid=\"sidebar-toggle\"]");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "rail-1440.png") });

  // ── §6 the phone ─────────────────────────────────────────────────────────
  console.log("\n— §6 · the phone at 390 —");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await signIn(pp);
  await pp.click(".mobile-bottom-bar button:last-child");
  await pp.waitForTimeout(700);
  const drawer = await pp.$$eval(".mobile-more-drawer [data-nav-group]", gs => gs.map(g => ({
    group: g.getAttribute("data-nav-group"),
    label: (g.firstElementChild && g.firstElementChild.tagName !== "BUTTON") ? (g.firstElementChild.innerText || "").trim() : null,
    items: [...g.querySelectorAll("button[data-nav-id]")].map(b => b.getAttribute("data-nav-id")),
    icons: [...g.querySelectorAll("button[data-nav-id] svg")].length,
  })));
  ok("the phone's More menu is the rail's groups, labelled",
     drawer.length >= 4 && drawer.some(g => g.label === "RELATIONSHIPS") && drawer.every(g => g.icons === g.items.length),
     drawer);
  const drawerIds = drawer.flatMap(g => g.items);
  ok("nothing on the rail is missing from the phone",
     ids.filter(id => !["dashboard", "donors", "fundraising", "agent"].includes(id)).every(id => drawerIds.includes(id)),
     { drawerIds, ids });
  await pp.screenshot({ path: path.join(OUT, "phone-more-390.png") });
  await pp.keyboard.press("Escape").catch(() => {});
  await pp.click(".mobile-more-overlay", { position: { x: 10, y: 10 } }).catch(() => {});
  await pp.waitForTimeout(500);
  await pp.screenshot({ path: path.join(OUT, "phone-home-390.png") });
  await phone.close();

  // ── §7 the volunteer coordinator ─────────────────────────────────────────
  console.log("\n— §7 · a volunteer coordinator starts with Finance hidden —");
  const invite = await api("POST", "/auth/invite", { email: `coord_${stamp}@test.local`, role: "volunteer_coordinator" });
  let coordToken = null;
  const inviteTok = String(invite.body?.inviteLink || "").split("/invite/")[1] || null;
  if (inviteTok) {
    const acc = await fetch(API + "/auth/invite/accept", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteTok, name: "Dana Coordinator", password: "loadtest1234" }) }).then(r => r.json()).catch(() => ({}));
    coordToken = acc.token || null;
    var coordUser = acc.user || null, coordOrg = acc.org || org;
  }
  if (!coordToken) {
    ok("a volunteer coordinator account was created for the walk", false, invite.body);
  } else {
    const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const p3 = await ctx3.newPage();
    await p3.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p3.evaluate(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [coordToken, coordUser, coordOrg]);
    await p3.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p3.waitForSelector(".app-sidebar [data-nav-group]", { timeout: 25000 });
    const go3 = await p3.$("[data-testid=\"first-run-go\"]");
    if (go3) { await go3.click(); await p3.waitForTimeout(700); }
    await p3.waitForTimeout(1200);
    const coordIds = await p3.$$eval(".app-sidebar button[data-nav-id]", bs => bs.map(b => b.getAttribute("data-nav-id")));
    ok("Finance is not on the coordinator's rail, and Volunteers is",
       !coordIds.includes("finance") && coordIds.includes("volunteers"), coordIds);
    await p3.screenshot({ path: path.join(OUT, "coordinator-1440.png") });
    await ctx3.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s). Shots in ${OUT}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error("WALK CRASHED", e); process.exit(2); });
