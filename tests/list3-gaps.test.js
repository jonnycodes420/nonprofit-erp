#!/usr/bin/env node
// LIST-3 · THE LAST LIST, SEARCH, SETTINGS AND DEMO GAPS FROM THE WALK.
//
// Guards donor data and what a donor reads: search must find the person she
// is typing, a saved view must come back as she saved it, an appeal must not
// tell someone who never gave that they gave before, the giving page must
// carry the logo she uploaded, and the demo must hold the recurring donors the
// recurring checks run on. Each section failed on main:
//
//   §1 Cmd+K on a slow connection (each search answered 0.9 s late): the
//      person shows in the dropdown while she is still typing, before Enter
//   §2 a saved view restores its sort (column and direction), not only its
//      columns and filters
//   §3 an appeal previewed for someone with no gift has no "given before"
//      line; for a donor it is unchanged
//   §4 a logo saved in Settings → Branding is the giving page's logo, even
//      where the giving page had an older one; a colour-only save keeps it
//   §5 the seeded demo org (scripts/ci/seed-demo.js, read only) has two or
//      more active monthly donors with 6+ monthly gifts and a next date, and
//      a canceled one
//   §6 /app on a phone lands on Home with layout shift (CLS) under 0.05
//
// Against a booted server at $BASE and the client dist at $APP_URL. Made-up
// people only; nothing sends.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip, civilToday } = require("./helpers");
const { DIST } = require("./lib/dist");
const { PHONE, SLOW_4G } = require("./lib/phone");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const ORG = "org_list3", SLUG = "list3-test";
const A = { id: "u_list3a", email: "list3-admin@example.org", name: "Ada Gapwell" };
const sys = "'system:test','test'";
// Two 1×1 PNGs: the giving page's older logo and the one saved in Branding.
const OLD_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const NEW_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function reset(org) {
  const first = ["gifts", "donor_list_views", "donor_list_layouts", "portal_settings", "donors", "user_sessions", "users"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}

(async () => {
  console.log("list3-gaps (LIST-3)");
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  await reset(ORG);
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,onboarded_at,vocabulary_json,stripe_account_id,stripe_connected)
           VALUES ($1,'List Three Harbor',$2,1,'active','team','America/New_York',NOW(),NOW(),'{"fiscal_year_start_month":1}','acct_list3_test',true)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [A.id, ORG, A.email, pw, A.name]);
  // The giving page was set up first, with an older logo.
  await q(`INSERT INTO portal_settings (org_id, enabled, display_name, logo_data) VALUES ($1, true, 'List Three Harbor', $2)`, [ORG, OLD_LOGO]);

  // ── §0 The fixture: 240 made-up people, three of them Marlowes ──
  // Person i gives one gift of 10 × (i + 1) dollars, dated i days back for the
  // even ones and 540 - i days back for the odd ones, so the last gift's order
  // and the lifetime's order differ.
  const people = [];
  for (let i = 0; i < 240; i++) {
    const name = i === 17 ? "Ines Marlowe" : i === 93 ? "Teodor Marlowe" : i === 181 ? "Philippa Marlowe-Hart" : `Fennick${i} Quayle${i}`;
    people.push({ id: `d_l3_${i}`, i, name, email: `l3.person${i}@example.org`, amount: 10 * (i + 1), date: plus(-(i % 2 ? 540 - i : i + 1)) });
  }
  await q(`INSERT INTO donors (id,org_id,name,email,person_types,created_by,created_by_name)
           SELECT u.id, $1, u.name, u.email, '["donor"]'::jsonb, 'system:test', 'test'
             FROM unnest($2::text[], $3::text[], $4::text[]) AS u(id, name, email)`,
  [ORG, people.map(p => p.id), people.map(p => p.name), people.map(p => p.email)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           SELECT 'g_' || u.id, $1, u.id, u.amount, u.date, 'check', 'system:test', 'test'
             FROM unnest($2::text[], $3::numeric[], $4::text[]) AS u(id, amount, date)`,
  [ORG, people.map(p => p.id), people.map(p => p.amount), people.map(p => p.date)]);
  const { query: dbq } = require("../db");
  await require("../afterChange").recalcDonorSummaryBatch(dbq, people.map(p => p.id), ORG);
  const tok = await login(A.email);
  ok("the admin signs in", !!tok);

  // ── §2 (API half) a saved view keeps its sort ──
  await api("PUT", "/donors/list-layout", tok, { columns: ["name", "lifetime", "last_gift_date"], pageSize: 50 });
  const sv = await api("POST", "/donors/list-views", tok, { name: "Oldest last gift first", columns: ["name", "lifetime", "last_gift_date"], pageSize: 50,
    filters: null, sort: "last_gift_date", sortDir: "asc" });
  const setup = await api("GET", "/donors/list-setup", tok);
  const back = ((setup.body && setup.body.views) || []).find(v => v.id === (sv.body.view || {}).id) || {};
  ok("§2 a saved view comes back with its sort column", back.sort === "last_gift_date", back);
  ok("§2 and its direction", back.sortDir === "asc", back);

  // ── §3 no-gift preview ──
  const ET = await import("../shared/emailTemplates.js");
  const appeal = ET.emailTemplates({ orgName: "List Three Harbor" }).find(t => t.key === "appeal");
  const noGift = ET.renderMergeFields(appeal.body, { first_name: "Ines", donor_name: "Ines Marlowe", gift_amount: "", total_giving: "", org_name: "List Three Harbor" });
  const donor = ET.renderMergeFields(appeal.body, { first_name: "Ines", donor_name: "Ines Marlowe", gift_amount: "$170", total_giving: "$170", org_name: "List Three Harbor" });
  ok("§3 the appeal for someone with no gift has no \"given before\" line", !/given before/i.test(noGift), noGift);
  ok("§3 it asks friends of the org to join instead", /we're asking friends of List Three Harbor to join us/.test(noGift), noGift);
  ok("§3 for a donor the line is unchanged", /asking the people who have given before to go first/.test(donor), donor);
  const GS = await import("../shared/giftSentence.js");
  ok("§3 the same rule as TRUST-1's giftSentence (the block renderer and the send read it)",
    !/given before/.test(GS.withoutMissingGift(appeal.body, { hasGift: false })) && /given before/.test(GS.withoutMissingGift(appeal.body, { hasGift: true })));

  // ── §4 the logo everywhere ──
  const pub0 = await api("GET", `/org/${SLUG}/public`, null);
  const logoOf = r => (r.body && ((r.body.theme && r.body.theme.logo) || (r.body.org && r.body.org.theme && r.body.org.theme.logo))) || null;
  ok("§4 the fixture's giving page opens with its older logo", logoOf(pub0) === OLD_LOGO, { status: pub0.status, logo: String(logoOf(pub0)).slice(0, 40) });
  const br = await api("PUT", "/orgs/branding", tok, { brandAccent: "", logoData: NEW_LOGO });
  ok("§4 Branding saves", br.status === 200, br.status);
  const pub1 = await api("GET", `/org/${SLUG}/public`, null);
  ok("§4 the giving page shows the logo saved in Branding", logoOf(pub1) === NEW_LOGO, String(logoOf(pub1)).slice(0, 60));
  // Receipts and emails (server.js resolveOrgBrandTheme) read the giving page's logo first, then Branding's.
  const [ps1] = await q(`SELECT logo_data, logo_url FROM portal_settings WHERE org_id=$1`, [ORG]);
  ok("§4 receipts and emails read the same logo (the giving page's logo is Branding's now)", ps1 && ps1.logo_data === NEW_LOGO && !ps1.logo_url, ps1 && String(ps1.logo_data).slice(0, 40));
  await api("PUT", "/orgs/branding", tok, { brandAccent: "#8a3a24" });
  ok("§4 a colour-only save keeps the logo", logoOf(await api("GET", `/org/${SLUG}/public`, null)) === NEW_LOGO);
  await q(`DELETE FROM portal_settings WHERE org_id=$1`, [ORG]);
  ok("§4 with no giving-page settings at all, the giving page still reads Branding's logo", logoOf(await api("GET", `/org/${SLUG}/public`, null)) === NEW_LOGO);

  // ── §5 the demo seed (read only: this suite never signs in to it) ──
  const DEMO = require("../scripts/ci/seed-demo.js").ORG;
  const subs = await q(`SELECT r.status, r.current_period_end IS NOT NULL AS has_next,
                               (SELECT COUNT(*)::int FROM gifts g WHERE g.org_id = r.org_id AND g.recurring_subscription_id = r.id AND g.amount > 0) AS gifts
                          FROM recurring_subscriptions r WHERE r.org_id = $1 AND r.interval = 'month'`, [DEMO]);
  const steady = subs.filter(s => s.status === "active" && s.has_next && s.gifts >= 6).length;
  ok("§5 the demo has at least two active monthly donors with 6+ gifts and a next date", steady >= 2, { steady, subs: subs.length });
  ok("§5 and a canceled one", subs.some(s => s.status === "canceled" && s.gifts >= 1), subs.filter(s => s.status !== "active"));

  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await reset(ORG); await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: A.email, password: "loadtest1234" });
  const seedAuth = ([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); };
  const authArgs = [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)];
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  // The service worker is off so the slow answers below are the page's own.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(seedAuth, authArgs);
  const page = await ctx.newPage();
  const settle = async () => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(400); };

  // ── §1 Cmd+K on a slow connection ──
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await page.route(u => /\/search\?q=/.test(String(u)), async r => { await new Promise(res => setTimeout(res, 900)); await r.continue(); });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  let seenWhileTyping = false, typedWhenSeen = "";
  for (const ch of "Marlowe") {
    await page.keyboard.type(ch);
    await page.waitForTimeout(300);
    // Read without waiting: a locator's innerText waits for the dropdown to
    // appear, which would hold the typing until the answer landed.
    const drop = await page.evaluate(() => (document.querySelector('[data-testid="search-dropdown"]') || {}).innerText || "");
    if (!seenWhileTyping && drop.includes("Ines Marlowe")) { seenWhileTyping = true; typedWhenSeen = await page.locator('[data-testid="global-search"]').inputValue(); }
  }
  ok("§1 Cmd+K shows the person in the dropdown while she is still typing", seenWhileTyping && typedWhenSeen.length < "Marlowe".length, { seenWhileTyping, typedWhenSeen });
  await page.waitForTimeout(1500);
  const drop1 = await page.locator('[data-testid="search-dropdown"]').innerText().catch(() => "");
  ok("§1 the finished word's answer lists every Marlowe", ["Ines Marlowe", "Teodor Marlowe", "Philippa Marlowe-Hart"].every(n => drop1.includes(n)), drop1.slice(0, 200));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/donors\/d_l3_/, { timeout: 8000 }).catch(() => {});
  ok("§1 the arrow keys move through the results and Enter opens the highlighted one", /\/donors\/d_l3_(17|93|181)$/.test(new URL(page.url()).pathname), page.url());
  await page.unroute(u => /\/search\?q=/.test(String(u))).catch(() => {});

  // ── §2 (screen half) picking the view puts its sort back ──
  await page.goto(`${APP}/donors`, { waitUntil: "networkidle" });
  await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
  await settle();
  const sortBefore = await page.locator('[data-testid="dir-sort"]').inputValue().catch(() => null);
  await page.locator('[data-testid="dir-views"]').selectOption(back.id || (sv.body.view || {}).id || "");
  await settle();
  const sortAfter = await page.locator('[data-testid="dir-sort"]').inputValue().catch(() => null);
  const u2 = new URL(page.url());
  ok("§2 the list opened on its own order", sortBefore === "", sortBefore);
  ok("§2 picking the saved view sorts by last gift, oldest first", sortAfter === "last_gift_date" && u2.searchParams.get("sort") === "last_gift_date" && u2.searchParams.get("dir") === "asc",
    { sortAfter, url: page.url() });
  const firstRow = await page.locator(".dir-donor-row").first().innerText().catch(() => "");
  const oldest = people.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  ok("§2 and the first row is the person whose last gift is oldest", firstRow.includes(oldest.name), { want: oldest.name, got: firstRow.slice(0, 60) });
  // Save one from the screen, sorted by last gift newest first, and open it again.
  await page.goto(`${APP}/donors?sort=last_gift_date&dir=desc`, { waitUntil: "networkidle" });
  await settle();
  await page.locator('[data-testid="dir-views"]').selectOption("__save");
  await page.locator('[data-testid="dir-view-name"]').fill("Newest last gift first");
  await page.locator('[data-testid="dir-view-save"]').click();
  await settle();
  const [saved] = await q(`SELECT sort_by, sort_dir FROM donor_list_views WHERE org_id=$1 AND name='Newest last gift first'`, [ORG]).catch(() => [null]);
  ok("§2 a view saved from the screen stores the sort on screen", saved && saved.sort_by === "last_gift_date" && saved.sort_dir === "desc", saved);
  await ctx.close();

  // ── §4 (screen half) the giving page draws the logo, not the initial badge ──
  const gctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const gp = await gctx.newPage();
  await gp.goto(`${APP}/give/${SLUG}`, { waitUntil: "networkidle", timeout: 60000 });
  await gp.waitForTimeout(500);
  const srcs = await gp.locator("img").evaluateAll(xs => xs.map(x => x.getAttribute("src") || ""));
  ok("§4 the public giving page draws the uploaded logo", srcs.includes(NEW_LOGO), srcs.map(s => s.slice(0, 40)));
  await gctx.close();

  // ── §6 /app on a phone: no jump ──
  // The phone the perf check uses (tests/lib/phone.js), slow 4G, the CPU slowed, cold.
  const pctx = await browser.newContext({ ...PHONE, serviceWorkers: "block" });
  await pctx.addInitScript(seedAuth, authArgs);
  await pctx.addInitScript(() => {
    window.__cls = 0; window.__shifts = [];
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) {
        window.__cls += e.value;
        window.__shifts.push(`${Math.round(e.startTime)} ms ${e.value.toFixed(3)} ` + (e.sources || []).map(s => s.node && (s.node.getAttribute && (s.node.getAttribute("data-testid") || s.node.className))).join("|"));
      } }).observe({ type: "layout-shift", buffered: true });
    } catch { /* nothing to observe */ }
  });
  const pp = await pctx.newPage();
  const cdp = await pctx.newCDPSession(pp);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await pp.goto(`${APP}/app`, { waitUntil: "load", timeout: 90000 });
  await pp.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await pp.waitForTimeout(1000);
  const ph = await pp.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts, at: location.pathname }));
  ok("§6 /app lands on Home", ph.at === "/dashboard", ph.at);
  ok("§6 with layout shift under 0.05 on a phone", ph.cls < 0.05, { cls: Math.round(ph.cls * 1000) / 1000, shifts: ph.shifts.slice(0, 4) });
  await pctx.close();

  await browser.close();
  if (process.env.LIST3_KEEP !== "1") await reset(ORG);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, String(e && e.stack || e).slice(0, 300)); await closeDb().catch(() => {}); summary(); });
