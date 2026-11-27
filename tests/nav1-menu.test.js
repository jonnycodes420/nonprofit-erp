// tests/nav1-menu.test.js · NAV-1 (menu, 10 Nov). THE ORG'S MENU AND ITS MAJOR GIFTS TABS.
//
//   §1  the defaults: GET /org/menu has no saved layout, all four Major Gifts
//       tabs, and the merged rail (navGroups.js) shows every entry, Auctions
//       and Peer-to-peer included (Jonathan's final call, 10 Nov)
//   §2  an admin hides and shows an entry and reorders a group (PUT /org/menu);
//       it persists; a staff member cannot change it; a person's own hide
//       (/me/nav-layout) hides it for them only, and never shows what the org hid
//   §3  Major Gifts: Top 100 only is stored, and the page logic shows one view
//       with no strip; none is refused; all four is stored as the default (NULL)
//   §4  super-admin sets another org's menu; it lands in THAT org's audit log as
//       Steward support; a plain admin is refused
//   §5  hasP2p is false with no peer-to-peer page and true with one; Fundraising's
//       strip keeps Auctions and drops Peer-to-peer without a page
//   §6  links: Auctions and Peer-to-peer still open their Fundraising parts
//   §7  the browser, on the built client: Auctions and Peer-to-peer on the rail
//       by default, Fundraising still has Auctions, the event page has its
//       Auction panel, Events → Auctions lists every auction, an org that hides
//       Auctions loses it from the rail without a reload, and Major Gifts set to
//       Top 100 has no strip
//   §8  no org id in the code: the org-specific baseline is unchanged
//   §9  NAV-2 (27 Nov): an org with no saved layout has Auctions, Peer-to-peer,
//       Memberships and Major Gifts off; an org that saved one as visible keeps
//       it; Add puts it back for everybody who never took it off; Major Gifts
//       off the rail opens inside Fundraising (same views, the org's list), and
//       not for someone without the permission; the keep-in-use script turns on
//       only orgs with data, dry run writes nothing, --apply writes one audit row
//
// NAV-2 HOW IT GOES RED: on main navGroups has no DEFAULT_OFF (§1/§9 "four off" red),
//   routeMajorGifts ignores the rail (§9 "opens inside Fundraising" red), and
//   scripts/ops/nav2-keep-in-use.js does not exist (§9 script red); §7's Add click finds no button.
//
// HOW IT GOES RED (each watched red before trusting the green):
//   - on main: GET /org/menu is a 404 and navGroups has no personNavLayout
//   - planted: orgNavLayout hiding Auctions by default → §1 and §7 red; personNavLayout ORs
//     instead of ANDs the org's hide → §2 "never shows what the org hid" red
//
// Standard scratch stack (tests/README.md). Made-up org and people; sends nothing.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { execFileSync } = require("child_process");
const { BASE, ok, summary, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const ORG = "org_nav1menu";
const OTHER = "org_nav1other";
const EVENT = "ev_nav1_gala";
const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const esm = rel => import(path.join(ROOT, rel));

async function reset() {
  for (const org of [ORG, OTHER]) {
    await q(`DELETE FROM auctions WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM giving_pages WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM events WHERE org_id=$1`, [org]).catch(() => {});
    // The super-admin sits in a made-up org of kind demo, where two-step sign-in is not asked (twoFactor.js isDemoOrg).
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind)
             VALUES ($1,$2,$3,1,'active','team',$4) ON CONFLICT (id) DO UPDATE SET nav_layout=NULL, mg_views=NULL, org_kind=EXCLUDED.org_kind`,
      [org, org === ORG ? "Lantern Menu Test" : "Quill Other Test", org.replace(/_/g, "-"), org === ORG ? "customer" : "demo"]);
    // POLISH-12: the Top 100 is off unless an org turns it on; these orgs use it.
    await q(`UPDATE orgs SET nav_layout=NULL, mg_views=NULL, top100_enabled=true WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 4);
  for (const [id, role, sa] of [["admin", "admin", false], ["staff", "member", false], ["super", "admin", true]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts,is_super_admin,nav_layout) VALUES ($1,$2,$3,$4,$5,$6,true,$7,NULL)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, is_super_admin=EXCLUDED.is_super_admin, nav_layout=NULL`,
      [`u_${ORG}_${id}`, id === "super" ? OTHER : ORG, `${id}@${ORG}.test`, hash, { admin: "Wren Admin", staff: "Tamsin Staff", super: "Odo Support" }[id], role, sa]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Lantern Gala','gala','2026-12-05')`, [EVENT, ORG]);
  await q(`INSERT INTO auctions (id,org_id,event_id,title,public_slug,opens_at,closes_at,created_by,created_by_name)
           VALUES ('auc_nav1',$1,$2,'Lantern silent auction','nav1-lantern-auction','2026-12-05T18:00:00Z','2026-12-05T21:00:00Z',$3,'Wren Admin')`,
    [ORG, EVENT, `u_${ORG}_admin`]);
}
async function token(who) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${who}@${ORG}.test`, password: "loadtest1234" }) });
  return r.json();
}
const call = async (tok, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, body: json };
};

(async () => {
  console.log("nav1-menu (NAV-1, the menu)");
  await reset();
  const N = await esm("client/src/lib/navGroups.js");
  const MG = await esm("client/src/lib/majorGiftsTab.js");
  const MV = await esm("client/src/lib/navMoves.js");
  const FS = await esm("client/src/lib/fundraisingSections.js");
  const shownIds = groups => groups.flatMap(g => g.items.filter(i => i.visible).map(i => i.id));
  const admin = (await token("admin")).token, staff = (await token("staff")).token;

  console.log("\n§1 · the defaults");
  const d = await call(admin, "GET", "/org/menu");
  ok("§1 GET /org/menu answers", d.status === 200, d);
  ok("§1 no saved layout and all four Major Gifts tabs", d.body && d.body.layout === null && JSON.stringify(d.body.mgViews) === JSON.stringify(["top100", "portfolios", "pipeline", "plans"]), d.body);
  const def = shownIds(N.personNavLayout(null, null));
  // NAV-2: the four that start off are off an org that never saved a layout (it was every entry on, NAV-1)
  ok("§1 the default rail has no Auctions, Peer-to-peer, Memberships or Major Gifts", ["auctions", "p2p", "memberships", "majorgifts"].every(i => !def.includes(i)), def);
  ok("§1 …and every other entry", ["dashboard", "donors", "fundraising", "events", "grants", "finance", "settings"].every(i => def.includes(i)), def);
  const me = await call(admin, "GET", "/me/nav-layout");
  ok("§1 /me/nav-layout carries the org's menu, so the shell reads both in one request", me.body && me.body.org && Array.isArray(me.body.org.mgViews), me.body);

  console.log("\n§2 · hide, show, reorder; a person's hide is theirs");
  const orgRail = N.orgNavLayout(null);
  let next = N.setNavVisible(orgRail, "p2p", true);
  next = N.setNavVisible(next, "grants", false);
  next = N.moveNavItem(next, "raise", "events", -2);
  const put = await call(admin, "PUT", "/org/menu", { layout: N.flattenNav(next) });
  ok("§2 an admin saves the org's menu", put.status === 200, put);
  const back = (await call(admin, "GET", "/org/menu")).body;
  const merged = N.personNavLayout(null, back.layout);
  const shown = shownIds(merged);
  ok("§2 Auctions, never added, is not on the menu", !shown.includes("auctions"), shown);
  ok("§2 Grants turned off is gone from the menu", !shown.includes("grants"), shown);
  ok("§2 Peer-to-peer, added, is there", shown.includes("p2p"), shown);
  const raise = merged.find(g => g.id === "raise").items.map(i => i.id);
  ok("§2 the reorder persisted: Events moved up two within Raise, to the top", raise.indexOf("events") === 0 && raise.indexOf("fundraising") === 1, raise);
  const staffPut = await call(staff, "PUT", "/org/menu", { layout: N.flattenNav(orgRail) });
  ok("§2 a staff member cannot change the org's menu", staffPut.status === 403, staffPut.status);
  const bad = await call(admin, "PUT", "/org/menu", { layout: [{ id: "x", visible: "yes" }] });
  ok("§2 a malformed layout is refused", bad.status === 400, bad.status);
  // A person's own layer.
  const myHide = await call(staff, "PUT", "/me/nav-layout", { layout: [{ id: "events", visible: false }, { id: "grants", visible: true }] });
  ok("§2 a person saves their own sidebar", myHide.status === 200, myHide);
  const staffView = shownIds(N.personNavLayout(myHide.body.layout, back.layout));
  const adminView = shownIds(N.personNavLayout(null, back.layout));
  ok("§2 a person's own hide hides Events for them", !staffView.includes("events"), staffView);
  ok("§2 …and only for them", adminView.includes("events"), adminView);
  ok("§2 a person's 'show' never shows what the org hid (Grants)", !staffView.includes("grants"), staffView);
  // Saving a person's layout keeps their own choice for what the org hid.
  const forSave = N.personNavLayout(null, back.layout).flatMap(g => g.items).find(i => i.id === "grants");
  ok("§2 the person's layer remembers their own choice apart from the org's hide", forSave.orgHidden === true && forSave.mine === true, forSave);
  const reset1 = await call(admin, "PUT", "/org/menu", { layout: null });
  ok("§2 back to the defaults", reset1.status === 200 && reset1.body.layout === null, reset1.body);

  console.log("\n§3 · Major Gifts shows");
  const top = await call(admin, "PUT", "/org/menu", { mgViews: ["top100"] });
  ok("§3 Top 100 only is stored", top.status === 200 && JSON.stringify(top.body.mgViews) === '["top100"]', top.body);
  const [row] = await q(`SELECT mg_views FROM orgs WHERE id=$1`, [ORG]);
  ok("§3 …as the org's setting", row.mg_views === '["top100"]', row);
  const one = MG.mgShownViews(top.body.mgViews);
  ok("§3 one view shown, so the page draws no strip (MajorGiftsPage: shown.length > 1)", one.length === 1 && one[0].id === "top100", one);
  ok("§3 a link asking for Pipeline lands on Top 100", MG.mgViewIn("pipeline", one) === "top100");
  ok("§3 the default shows all four", MG.mgShownViews(undefined).length === 4 && MG.mgShownViews(["top100", "portfolios", "pipeline", "plans"]).length === 4);
  const none = await call(admin, "PUT", "/org/menu", { mgViews: [] });
  ok("§3 none at all is refused", none.status === 400, none.status);
  const all = await call(admin, "PUT", "/org/menu", { mgViews: ["plans", "top100", "pipeline", "portfolios"] });
  const [row2] = await q(`SELECT mg_views FROM orgs WHERE id=$1`, [ORG]);
  ok("§3 all four is stored as the default (NULL), in the canonical order", all.status === 200 && row2.mg_views === null && all.body.mgViews.join() === "top100,portfolios,pipeline,plans", { row2, b: all.body });
  ok("§3 the page source hides the strip with one view", /shown\.length > 1 && <SectionTabs/.test(fs.readFileSync(path.join(ROOT, "client/src/components/MajorGiftsPage.jsx"), "utf8")));

  console.log("\n§4 · super-admin, for any org");
  const sup = (await token("super")).token;
  const sa = await call(sup, "POST", `/admin/orgs/${ORG}/menu`, { mgViews: ["top100"] });
  ok("§4 super-admin sets another org's Major Gifts tabs", sa.status === 200 && sa.body.mgViews.join() === "top100", sa);
  const [audit] = await q(`SELECT user_name FROM fin_audit_log WHERE org_id=$1 AND entity_label='Menu' ORDER BY created_at DESC LIMIT 1`, [ORG]).catch(() => [null]);
  ok("§4 it is in THAT org's audit log, as Steward support", audit && audit.user_name === "Steward support", audit);
  const notSa = await call(admin, "POST", `/admin/orgs/${OTHER}/menu`, { mgViews: ["top100"] });
  ok("§4 a plain admin cannot set another org's menu", notSa.status === 403 || notSa.status === 401, notSa.status);

  console.log("\n§5 · Peer-to-peer appears with a peer-to-peer page");
  ok("§5 no peer-to-peer page: hasP2p is false", (await call(admin, "GET", "/org/menu")).body.hasP2p === false);
  const camp = FS.FR_SECTIONS.find(s => s.id === "campaigns");
  const noP2p = MV.frShown(camp, { hasP2p: false }).parts.map(p => p.id);
  ok("§5 Fundraising's strip keeps Auctions, and has no Peer-to-peer without a page", noP2p.includes("auctions") && !noP2p.includes("p2p"), noP2p);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,p2p_enabled,created_by,created_by_name) VALUES ('gp_nav1',$1,'nav1-walk','Lantern Walk','active',true,$2,'Wren Admin')`, [ORG, `u_${ORG}_admin`]);
  ok("§5 one peer-to-peer page: hasP2p is true", (await call(admin, "GET", "/org/menu")).body.hasP2p === true);
  ok("§5 …and Peer-to-peer is in Fundraising's strip", MV.frShown(camp, { hasP2p: true }).parts.some(p => p.id === "p2p"));

  console.log("\n§6 · links still land where they did");
  const U = await esm("client/src/lib/appUrls.js");
  ok("§6 Auctions still opens its Fundraising part", U.tabHref("auctions") === "/app/fundraising?fr=auctions", U.tabHref("auctions"));
  ok("§6 Peer-to-peer still opens its Fundraising part", U.tabHref("p2p") === "/app/fundraising?fr=p2p", U.tabHref("p2p"));

  console.log("\n§7 · the browser");
  // The app's own server must be up as well as built (a hook run starts none; CI's REQUIRE_BROWSER makes a skip red).
  const appUp = await fetch(APP + "/").then(r => r.ok).catch(() => false);
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    if (!appUp) return "no app server at " + APP;
    const apiHost = BASE.replace(/^https?:\/\//, "");
    if (!fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js")).some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    await call(admin, "PUT", "/org/menu", { layout: null, mgViews: ["top100"] });
    await q(`UPDATE users SET nav_layout=NULL WHERE id=$1`, [`u_${ORG}_admin`]);
    const lg = await token("admin");
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    // NAV1_SHOTS=<dir>: the build's walk keeps a picture of each step (nothing is written otherwise)
    const shot = async name => { if (process.env.NAV1_SHOTS) await page.screenshot({ path: path.join(process.env.NAV1_SHOTS, name + ".png"), fullPage: false }).catch(() => {}); };
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
    page.on("pageerror", e => errors.push("threw: " + e.message));
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.token, JSON.stringify(lg.user), JSON.stringify(lg.org)]);
    await page.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator(".side-nav-btn").first().waitFor({ timeout: 30000 });
    const rail = (await page.$$eval(".side-nav-btn", bs => bs.map(b => (b.innerText || "").split("\n").map(s => s.trim()).filter(Boolean).join(" ")))).join(" | ");
    await shot("1-rail-default");
    ok("§7 NAV-2: the rail has no Auctions, Peer-to-peer, Memberships or Major Gifts by default", !/Auctions|Peer-to-peer|Memberships|Major Gifts/.test(rail), rail);
    ok("§7 …and has Events and Grants", /Events/.test(rail) && /Grants/.test(rail), rail);
    // NAV-2 item 3: Major Gifts off the rail lives inside Fundraising; an old address lands there
    await page.goto(`${APP}/app/majorgifts?subtab=pipeline`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-fr-view="top100"]').waitFor({ timeout: 20000 }).catch(() => {});
    await shot("1b-majorgifts-in-fundraising");
    ok("§7 NAV-2: /app/majorgifts off the rail opens Fundraising → Major gifts, on the one view the org shows (Top 100)", /\/app\/fundraising\?fr=top100/.test(page.url()) && await page.locator('[data-fr-view="top100"]').count() === 1, page.url());
    const mgParts = await page.$$eval("[data-fr-part]", els => els.map(e => e.getAttribute("data-fr-part"))).catch(() => []);
    ok("§7 …with the views the org shows (Top 100 only, as set) after At a glance and Proposals", mgParts.join() === "majorgifts,proposals,top100", mgParts);
    // NAV-2 item 2: Settings → Menu → Add to your sidebar, one click, no reload
    await page.goto(`${APP}/app/settings?section=menu`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="org-menu-add"]').waitFor({ timeout: 20000 }).catch(() => {});
    const addRows = await page.$$eval('[data-testid="org-menu-add"] [data-nav-add-row]', els => els.map(e => e.getAttribute("data-nav-add-row"))).catch(() => []);
    ok("§7 NAV-2: Add to your sidebar lists the four that start off", ["auctions", "p2p", "memberships", "majorgifts"].every(i => addRows.includes(i)), addRows);
    await shot("1c-settings-menu-add");
    await page.locator('[data-testid="org-menu-add"] [data-nav-add="auctions"]').click().catch(() => {});
    await page.locator('[data-testid="org-menu-msg"]').waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    const afterAdd = (await page.$$eval(".side-nav-btn", bs => bs.map(b => b.innerText))).join(" | ");
    ok("§7 NAV-2: one click on Add puts Auctions on the rail without a reload", /Auctions/.test(afterAdd), afterAdd);
    await page.locator('[data-testid="org-menu-add"] [data-nav-add="majorgifts"]').click().catch(() => {});
    await page.waitForTimeout(600);
    await page.locator('[data-testid="org-menu-list"] [data-nav-toggle="grants"]').click().catch(() => {});
    await page.waitForTimeout(600);
    const afterGrants = (await page.$$eval(".side-nav-btn", bs => bs.map(b => b.innerText))).join(" | ");
    await shot("1d-settings-menu-grants-off");
    ok("§7 NAV-2: Take off on Grants takes it off the rail the same way", !/Grants/.test(afterGrants) && /Major Gifts/.test(afterGrants), afterGrants);
    const [lay] = await q(`SELECT nav_layout FROM orgs WHERE id=$1`, [ORG]);
    ok("§7 …and the org's saved menu names Auctions on and Grants off", /"id":"auctions","visible":true/.test(lay.nav_layout || "") && /"id":"grants","visible":false/.test(lay.nav_layout || ""), lay);
    await page.goto(`${APP}/app/fundraising?fr=campaigns`, { waitUntil: "networkidle", timeout: 60000 });
    const parts = await page.$$eval("[data-fr-part], [data-key]", els => els.map(e => e.textContent.trim())).catch(() => []);
    ok("§7 Fundraising → Campaigns & pages still has its Auctions part", parts.some(t => /^Auctions$/.test(t)), parts.slice(0, 20));
    await page.goto(`${APP}/app/fundraising?fr=auctions`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-fr-view="auctions"]').waitFor({ timeout: 20000 }).catch(() => {});
    ok("§7 /app/fundraising?fr=auctions still opens Fundraising's Auctions", /\/app\/fundraising\?fr=auctions/.test(page.url()) && await page.locator('[data-fr-view="auctions"]').count() === 1, page.url());
    await page.goto(`${APP}/app/events?list=auctions`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="events-auctions"]').waitFor({ timeout: 20000 }).catch(() => {});
    await shot("2-events-auctions");
    ok("§7 Events → Auctions is there too, as an addition", await page.locator('[data-testid="events-auctions"]').count() === 1, page.url());
    await page.locator('[data-auction-row="auc_nav1"]').waitFor({ timeout: 15000 }).catch(() => {});
    ok("§7 …listing the gala's auction", await page.locator('[data-auction-row="auc_nav1"]').count() === 1);
    await page.goto(`${APP}/app/events?event=${EVENT}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="ev-auction"]').waitFor({ timeout: 20000 }).catch(() => {});
    await page.locator('[data-testid="ev-auction"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot("3-event-auction-panel");
    ok("§7 the event page has its Auction panel", await page.locator('[data-testid="ev-auction"]').count() === 1);
    await page.locator('[data-testid="ev-auction"] [data-auction-row="auc_nav1"]').waitFor({ timeout: 15000 }).catch(() => {});
    ok("§7 …showing this event's auction", await page.locator('[data-testid="ev-auction"] [data-auction-row="auc_nav1"]').count() === 1);
    // EVENTS-4 item 5: /app/events/<id>, the address people paste, opens that event (it went to Home; the router's
    // catch-all sent it to / before App could read it) and settles on the canonical /app/events?event=<id>.
    await page.goto(`${APP}/app/events/${EVENT}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="ev-auction"]').waitFor({ timeout: 20000 }).catch(() => {});
    ok("§7 /app/events/<id> opens the event page", await page.locator('[data-testid="ev-auction"]').count() === 1 && /\/app\/events\?event=/.test(page.url()), page.url());
    await page.goto(`${APP}/app/majorgifts?subtab=pipeline`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="major-gifts-page"]').waitFor({ timeout: 20000 }).catch(() => {});
    await shot("4-majorgifts-top100-only");
    ok("§7 Major Gifts set to Top 100 draws no tab strip", await page.locator('[data-testid="major-gifts-page"] [aria-label="Major gifts"]').count() === 0);
    ok("§7 …and opens on Top 100 even when a link asked for Pipeline", await page.locator('[data-mg-view="top100"]').count() === 1);
    await call(admin, "PUT", "/org/menu", { mgViews: null });
    await page.goto(`${APP}/app/majorgifts`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="major-gifts-page"]').waitFor({ timeout: 20000 }).catch(() => {});
    const tabs = await page.locator('[data-testid="major-gifts-page"] [aria-label="Major gifts"]').innerText().catch(() => "");
    await shot("5-majorgifts-all-four");
    ok("§7 the default shows all four tabs", ["Top 100", "Portfolios", "Pipeline", "Plans"].every(t => tabs.includes(t)), tabs);
    await page.goto(`${APP}/app/settings?section=menu`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="org-menu-list"]').waitFor({ timeout: 20000 }).catch(() => {});
    await page.locator('[data-testid="org-menu-list"] [data-nav-toggle="auctions"]').click().catch(() => {});
    await page.locator('[data-testid="org-menu-msg"]').waitFor({ timeout: 10000 }).catch(() => {});
    const afterHide = (await page.$$eval(".side-nav-btn", bs => bs.map(b => b.innerText))).join(" | ");
    await shot("6-settings-menu-auctions-off");
    ok("§7 Settings → Menu: Take off on Auctions takes it off the rail without a reload", !/Auctions/.test(afterHide) && /Major Gifts/.test(afterHide), afterHide);
    await call(admin, "PUT", "/org/menu", { layout: null });
    ok("§7 no console error or page error on the walk", errors.length === 0, errors.slice(0, 5));
    await browser.close();
  }

  console.log("\n§9 · NAV-2: four start off, added in one click, Major Gifts inside Fundraising, orgs in use keep them");
  const FOUR = ["auctions", "p2p", "memberships", "majorgifts"];
  ok("§9 one list names the four that start off", N.DEFAULT_OFF && FOUR.every(i => N.DEFAULT_OFF.has(i)) && N.DEFAULT_OFF.size === 4, N.DEFAULT_OFF && [...N.DEFAULT_OFF]);
  const vis = (lay, id) => lay.flatMap(g => g.items).find(i => i.id === id).visible;
  ok("§9 an org with no saved layout has the four off", FOUR.every(i => vis(N.orgNavLayout(null), i) === false));
  const savedOn = [{ id: "auctions", visible: true }, { id: "majorgifts", visible: true }];
  ok("§9 an org whose saved layout names one as visible keeps it", vis(N.orgNavLayout(savedOn), "auctions") && vis(N.orgNavLayout(savedOn), "majorgifts"));
  ok("§9 …and the ones it does not name stay off", !vis(N.orgNavLayout(savedOn), "p2p") && !vis(N.orgNavLayout(savedOn), "memberships"));
  ok("§9 an entry added next month (not in the list) is still on for an org that saved last month", vis(N.orgNavLayout(savedOn), "grants") && vis(N.orgNavLayout(savedOn), "events"));
  // a person who saved their own layout before NAV-2 (every entry named on) sees the org's add, and not before it
  const personOld = N.flattenNav(N.navLayout(null));
  ok("§9 a person follows the org: off until the org adds it", !shownIds(N.personNavLayout(personOld, null)).includes("auctions"));
  ok("§9 …and on once it does, unless they took it off", shownIds(N.personNavLayout(personOld, savedOn)).includes("auctions")
    && !shownIds(N.personNavLayout(personOld.map(r => r.id === "auctions" ? { ...r, visible: false } : r), savedOn)).includes("auctions"));
  ok("§9 every entry has its sentence for Add to your sidebar", N.ALL_NAV_IDS.every(i => typeof N.NAV_PURPOSE[i] === "string" && N.NAV_PURPOSE[i].length > 10));
  // Major Gifts placement
  const off = { onRail: false, views: ["portfolios", "pipeline", "plans"] };
  const r1 = MG.routeMajorGifts("majorgifts", { subtab: "pipeline", scope: "mine" }, true, off);
  ok("§9 Major Gifts off the rail: /app/majorgifts opens Fundraising on the same view", r1.tab === "fundraising" && r1.opts.frSection === "pipeline" && r1.opts.scope === "mine", r1);
  const r2 = MG.routeMajorGifts("fundraising", { frSection: "top100" }, true, off);
  ok("§9 …an old link to a view the org does not show opens the first it shows (Pipeline, the Top 100 being off)", r2.tab === "fundraising" && r2.opts.frSection === "pipeline", r2);
  const r3 = MG.routeMajorGifts("pipeline", {}, true, off);
  ok("§9 …the old Pipeline tab lands there too", r3.tab === "fundraising" && r3.opts.frSection === "pipeline", r3);
  const r4 = MG.routeMajorGifts("fundraising", { frSection: "plans" }, true, { onRail: true, views: off.views });
  ok("§9 on the rail, it opens its own page as before (ASKS-1)", r4.tab === "majorgifts" && r4.opts.subtab === "plans", r4);
  ok("§9 without the permission, neither: Home", MG.routeMajorGifts("majorgifts", {}, false, off).tab === "dashboard" && MG.routeMajorGifts("fundraising", { frSection: "pipeline" }, false, off).tab === "dashboard");
  ok("§9 Fundraising adds the views only off the rail and only with the permission", MG.mgInFundraising(true, false, off.views).map(v => v.id).join() === "portfolios,pipeline,plans"
    && MG.mgInFundraising(false, false, off.views) === null && MG.mgInFundraising(null, false, off.views) === null && MG.mgInFundraising(true, true, off.views) === null && MG.mgInFundraising(true, null, off.views) === null);
  const mgSec = FS.FR_SECTIONS.find(x => x.id === "majorgifts");
  ok("§9 Fundraising's Major gifts section: At a glance, Proposals, then the org's views", MV.frShown(mgSec, { mgViews: MG.mgInFundraising(true, false, off.views) }).parts.map(x => x.id).join() === "majorgifts,proposals,portfolios,pipeline,plans");
  ok("§9 …and just At a glance and Proposals with Major Gifts on the rail", MV.frShown(mgSec, { mgViews: null }).parts.map(x => x.id).join() === "majorgifts,proposals");
  ok("§9 both ways draw the same components (Fundraising renders Top100View, PortfolioView, Pipeline, PlansView for those parts)",
    ["top100\" && <Top100View", "portfolios\" && (", "pipeline\" && (", "plans\" && ("].every(k => fs.readFileSync(path.join(ROOT, "client/src/components/Fundraising.jsx"), "utf8").includes(`subtab === "${k}`)));
  // The keep-in-use script, on made-up orgs
  const KO = ["org_nav2_auc", "org_nav2_t100", "org_nav2_none", "org_nav2_chose", "org_nav2_mem"];
  const wipe = async () => { for (const o of KO) {
    for (const t of ["auction_items", "auctions", "membership_levels"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    // the audit log is append-only, so a made-up org that has one stays, reset
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => q(`UPDATE orgs SET nav_layout=NULL, top100_enabled=false WHERE id=$1`, [o])); } };
  await wipe();
  for (const o of KO) await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team') ON CONFLICT (id) DO NOTHING`, [o, "Made-up " + o.slice(9), o.replace(/_/g, "-")]);
  await q(`UPDATE orgs SET top100_enabled=true WHERE id='org_nav2_t100'`);
  await q(`UPDATE orgs SET nav_layout=$1 WHERE id='org_nav2_chose'`, [JSON.stringify([{ id: "auctions", visible: false }])]);
  for (const o of ["org_nav2_auc", "org_nav2_chose"]) {
    await q(`INSERT INTO auctions (id,org_id,title,public_slug,opens_at,closes_at,created_by,created_by_name) VALUES ($1,$2,'Made-up auction',$3,'2026-12-05T18:00:00Z','2026-12-05T21:00:00Z','system:test','Test')`, ["auc_" + o, o, o.replace(/_/g, "-") + "-auc"]);
    await q(`INSERT INTO auction_items (id,org_id,auction_id,title,starting_bid,bid_increment,created_by,created_by_name) VALUES ($1,$2,$3,'Made-up quilt',50,5,'system:test','Test')`, ["ai_" + o, o, "auc_" + o]);
  }
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term,created_by,created_by_name) VALUES ('ml_nav2','org_nav2_mem','Friend',25,'12_months','system:test','Test')`).catch(e => console.log("  (membership level fixture: " + e.message + ")"));
  const KS = require(path.join(ROOT, "scripts/ops/nav2-keep-in-use.js"));
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" });
  const lines = [];
  const dry = (await KS.main({ pool, apply: false, log: l => lines.push(l) })).filter(f => KO.includes(f.id));
  const byId = Object.fromEntries(dry.map(f => [f.id, f.turn]));
  ok("§9 script: the org with auction items gets Auctions", (byId.org_nav2_auc || []).join() === "auctions", byId);
  ok("§9 script: the org on the Top 100 gets Major Gifts", (byId.org_nav2_t100 || []).join() === "majorgifts", byId);
  ok("§9 script: the org with a membership level gets Memberships", (byId.org_nav2_mem || []).join() === "memberships", byId);
  ok("§9 script: an org with no data, and an org that chose Auctions off, are left alone", !byId.org_nav2_none && !byId.org_nav2_chose, byId);
  ok("§9 script: it prints org ids and counts, never a name", lines.some(l => /org_nav2_auc: turn on auctions/.test(l)) && lines.some(l => /auction items 1/.test(l)) && !lines.some(l => /Made-up/.test(l)), lines.filter(l => /nav2/.test(l)));
  const [dryRow] = await q(`SELECT nav_layout FROM orgs WHERE id='org_nav2_auc'`);
  ok("§9 script: the dry run writes nothing", dryRow.nav_layout === null, dryRow);
  const appliedAt = (await q(`SELECT NOW() AS t`))[0].t;
  await KS.main({ pool, apply: true, log: () => {} });
  const after = Object.fromEntries((await q(`SELECT id, nav_layout FROM orgs WHERE id = ANY($1)`, [KO])).map(r => [r.id, r.nav_layout ? JSON.parse(r.nav_layout) : null]));
  ok("§9 --apply: Auctions on for the org using it, nothing else of the four, nothing moved", N.orgNavLayout(after.org_nav2_auc).flatMap(g => g.items).filter(i => FOUR.includes(i.id) && i.visible).map(i => i.id).join() === "auctions"
    && N.flattenNav(N.orgNavLayout(after.org_nav2_auc)).map(r => r.id).join() === N.ALL_NAV_IDS.join(), after.org_nav2_auc);
  ok("§9 --apply: the Top 100 org comes out with Major Gifts on", shownIds(N.orgNavLayout(after.org_nav2_t100)).includes("majorgifts"), after.org_nav2_t100);
  ok("§9 --apply: the org that chose Auctions off still has it off; the empty org is untouched", after.org_nav2_none === null && !shownIds(N.orgNavLayout(after.org_nav2_chose)).includes("auctions"), after);
  const aud = await q(`SELECT org_id, entity_label, user_id FROM fin_audit_log WHERE org_id = ANY($1) AND action='nav2 keep in use' AND created_at >= $2`, [KO, appliedAt]);
  ok("§9 --apply: one audit row per org changed, in that org's log", aud.length === 3 && aud.every(a => a.entity_label === "Menu" && /^system:/.test(a.user_id)), aud);
  ok("§9 a second run finds nothing more to do", (await KS.findInUse(pool)).filter(f => KO.includes(f.id)).length === 0);
  await pool.end();
  await wipe();

  console.log("\n§8 · no org id in the code");
  let archOk = true, archOut = "";
  try { archOut = execFileSync("node", ["scripts/ci/arch-check.js"], { cwd: ROOT, encoding: "utf8" }); } catch (e) { archOk = false; archOut = String(e.stdout || e.message); }
  ok("§8 the org-specific ratchet is green", archOk && /org-specific: (none|.*within the baseline)/.test(archOut), archOut.split("\n").filter(l => /org-specific/.test(l)));
  const base = fs.readFileSync(path.join(ROOT, "docs/architecture/baseline/org-specific.json"), "utf8");
  // The baseline is a ratchet: no file this build added or changed is in it (CI's checkout has no origin/main to diff against).
  const counted = Object.keys((JSON.parse(base).counts) || {});
  const mine = ["server/org/menu.js", "server/db/ddl/nav1menu.js", "client/src/lib/navGroups.js", "client/src/lib/navMoves.js", "client/src/lib/majorGiftsTab.js",
    "client/src/components/settings/OrgMenuEditor.jsx", "client/src/components/admin/OrgMenuPanel.jsx", "client/src/components/events/EventAuction.jsx", "client/src/components/MajorGiftsPage.jsx"];
  ok("§8 the org-specific baseline counts none of this build's files", mine.every(f => !counted.includes(f)), counted.filter(f => mine.includes(f)));
  for (const f of ["server/org/menu.js", "client/src/lib/navGroups.js", "client/src/lib/majorGiftsTab.js", "client/src/components/settings/OrgMenuEditor.jsx"])
    ok(`§8 ${f} names no org`, !/org_[a-z0-9]{4,}|[Jj]ustin/.test(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^\/\/.*$/gm, "")), f);

  await reset();
  await q(`DELETE FROM giving_pages WHERE org_id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, String(e && e.stack || e)); await closeDb().catch(() => {}); summary(); });
