// tests/home6-layout.test.js · HOME-6. HOME IS EVEN, AND EVERY CARD OPENS WHAT IT SAYS.
//
// Jonathan, 5 Nov, on a 6,393-person org: "home needs to look nice, everything
// needs to be symmetrical and right now it's jumbled." The group chips wrapped
// three and one, Home's figures carried cents, the setup checklist outweighed
// the work, "What your history shows" opened the undo panel, a donor's name in
// the Thread opened nothing he could see, and "40 follow-ups" opened twelve.
// A fake org (made-up names, its own id), opened in a browser at 1440, 1280
// and 390 px:
//
//   §grid     the moves tiles are one row of equal widths (two rows of two at
//             390), and the cards of the work column share left and right
//             edges within 1 px
//   §money    no Home figure (tiles, the drifting list, the rail's counts)
//             renders cents
//   §drift    the drifting list shows 5 rows, its amounts in one column; Show
//             all opens every person its count says, in place, and folds again;
//             its count is the deck's own (server/insights/driftPeople.js)
//   §opens    the readout row "What your history shows" opens that readout,
//             not Recent changes; "N follow-ups" opens a list of N; a name in
//             the Thread, the drifting list, the follow-ups list and the calls
//             opens that person's profile
//   §setup    the rail's setup card is one line and folded ("Show the steps")
//   §email    the top bar has no Automatic email pill, and Settings, Automatic
//             email still shows the setting and saves a change to it
//   §shift    Home on a phone moves no more than SHIFT-2's bar (CLS 0.01)
//
// HOW IT GOES RED ON MAIN (1df169b): §grid (Planned wraps onto a second row),
// §money ("$1,018,990.98 at stake"), §drift (no list), §opens (the readout row
// opens Recent changes; 40 follow-ups lists 12; the Thread's name opens the
// rail), §setup (the steps open), §email (the pill is there). Planted on this
// branch: the tiles let wrap (a flex row with a minimum width) is red on
// §grid; the readout row pointed back at openRecentChanges is red on §opens.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs cleanly without Playwright.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, BASE, browserLegOrSkip } = require("./helpers");
const { pinBrowserClock } = require("./lib/browserClock");
const { civilDay } = require("./clock");

const APP = process.env.APP_URL || "http://localhost:4173";
const ORG = { id: "org_home6lay", slug: "home6lay", name: "Quillfeather Reading Circle", tier: "medium", n: 2, donors: 1400, gifts: 7000, interactions: 1000, tasks: 60, subs: 10, users: 1 };
const EMAIL = `admin@${ORG.slug}.load`, PASSWORD = "loadtest1234";
const RO_ID = "ro_home6lay_first";
const WIDTHS = [1440, 1280, 390];
const CENTS = /\$[\d,]+\.\d\d\b/;

let chromium;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { browserLegOrSkip("Playwright not found (set PLAYWRIGHT_DIR)"); console.log("\n0 passed, 0 failed (suite skipped)"); process.exit(0); }

async function seed() {
  const tabs = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  await q("SET session_replication_role = replica");
  for (const t of tabs) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG.id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG.id]);
  await q("SET session_replication_role = origin");
  const seedMany = require("../scripts/load/seed-many.js");
  await seedMany.seedOrg(ORG, bcrypt.hashSync(PASSWORD, 8));
  await seedMany.pool.query("ANALYZE donors; ANALYZE gifts");
  // Giving levels low enough that this small file has major givers, so all four groups have moves.
  await q(`UPDATE orgs SET giving_level_mid_cents = 100000, giving_level_major_cents = 300000 WHERE id = $1`, [ORG.id]);
  await seedMany.pool.end();
  // The first import's readout, as FIX-37 writes it (one line, two people).
  const two = await q(`SELECT id FROM donors WHERE org_id=$1 ORDER BY id LIMIT 2`, [ORG.id]);
  await q(`INSERT INTO readouts (id, org_id, source_kind, title, headline, lines, for_date, created_by, created_by_name)
           VALUES ($1,$2,'import','What your history shows','Your history is in.',$3,$4,'system:test','HOME-6 fixture')`,
    [RO_ID, ORG.id, JSON.stringify([{ kind: "biggest_ever", count: 2, cents: 300000, sentence: "2 people gave their biggest gift ever", why: "Their largest gift on record came in this file.",
      rows: two.map(d => ({ donorId: d.id })) }]), civilDay()]);
  // One automatic email on, so Settings has a switch to turn off (turning one off sends nothing).
  await q(`INSERT INTO org_mail_types (org_id, type_key, is_on, audience, set_at, set_by_name, created_by, created_by_name)
           VALUES ($1, 'pledge_reminder', true, 'chosen', NOW(), 'test fixture', 'system:test', 'test')
           ON CONFLICT (org_id, type_key) DO UPDATE SET is_on = true`, [ORG.id]).catch(e => ok("seed: the pledge_reminder email type exists", false, e.message));
}

(async () => {
  await seed();
  const login = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then(r => r.json());
  const H = { Authorization: "Bearer " + login.token };
  // "I'll finish later", as on Jonathan's org: the setup checklist is the rail's card.
  await fetch(BASE + "/org/setup-card", { method: "PUT", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ state: "collapsed" }) });
  // The deck as Home's first read gets it (TEST_MODE waits for the build), and every move.
  const deck = (await fetch(BASE + "/insights?view=deck", { headers: H }).then(r => r.json())).deck;
  const full = (await fetch(BASE + "/insights?view=deck&moves=all", { headers: H }).then(r => r.json())).deck;
  const threads = await fetch(BASE + "/threads?scope=mine", { headers: H }).then(r => r.json());
  ok("fixture: the deck has four groups, drifting people and open follow-ups",
    deck && deck.tabs.filter(t => t.count > 0).length === 4 && deck.drift && deck.drift.count > 5 && threads.stat.open > 12,
    { tabs: deck && deck.tabs.map(t => [t.key, t.count]), drift: deck && deck.drift && deck.drift.count, open: threads.stat && threads.stat.open });
  const first = (deck.drift && deck.drift.people) || [], all = (full.drift && full.drift.people) || [];
  const drift0 = first[0] || { name: "nobody", id: "none" };
  ok("§drift the deck's first read carries the first 5 drifting people; every move's read carries all of them, sorted by money at stake",
    first.length === 5 && all.length === full.drift.count && all.every((p, i, a) => !i || a[i - 1].stakeCents >= p.stakeCents),
    { first: first.length, all: all.length, count: full.drift && full.drift.count });

  const browser = await chromium.launch();
  const page0 = async (width) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
    await pinBrowserClock(ctx);
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
      window.__cls = 0;
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch { /* no layout-shift API */ }
    }, [login.token, JSON.stringify(login.user), JSON.stringify(login.org || {})]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(APP + "/dashboard", { waitUntil: "load" });   // Home's own address, as perf-app opens it
    await page.waitForSelector('[data-testid="move-card"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  };

  for (const width of WIDTHS) {
    const where = `at ${width}`;
    const { ctx, page, errors } = await page0(width);
    const m = await page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), r: Math.round(r.right), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      const tiles = [...document.querySelectorAll('[data-testid^="moves-tab-"]')].map(box);
      // the work column: the header, the tiles, the move, the drifting list and a Thread row
      const cards = [".home-head", ".moves-tabs", ".moves-card", '[data-testid="drift-list-card"]', ".home-shell .attn-row"]
        .map(sel => document.querySelector(sel)).filter(Boolean).map(box);
      const figures = [...document.querySelectorAll('.moves-tab .moves-stake, [data-testid="drift-amt"], [data-testid="home-today"]')].map(e => e.innerText);
      const rows = [...document.querySelectorAll('[data-testid="drift-row"]')];
      const amts = rows.map(r => box(r.querySelector('[data-testid="drift-amt"]')));
      return { tiles, cards, figures, rows: rows.length, amts, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        pill: !!document.querySelector('[data-testid="topbar-mail-status"]') || /Auto(matic)? email/i.test((document.querySelector(".app-header, header, [data-testid=topbar]") || {}).innerText || ""),
        setup: (document.querySelector('[data-testid="home-setup-rail"]') || {}).innerText || null, stepsOpen: !!document.querySelector('[data-testid="home-setup-rail"] [data-testid="setup-steps"]') };
    });
    const rowsOf = new Set(m.tiles.map(t => t.y)).size;
    const widths = m.tiles.map(t => t.w);
    ok(`§grid ${where}: the four tiles are ${width < 600 ? "two rows of two" : "one row"} of equal widths`,
      m.tiles.length === 4 && rowsOf === (width < 600 ? 2 : 1) && Math.max(...widths) - Math.min(...widths) <= 1 && new Set(m.tiles.map(t => t.h)).size === 1, m.tiles);
    const lefts = m.cards.map(c => c.x), rights = m.cards.map(c => c.r);
    ok(`§grid ${where}: the work column's cards share left and right edges within 1 px`,
      m.cards.length >= 4 && Math.max(...lefts) - Math.min(...lefts) <= 1 && Math.max(...rights) - Math.min(...rights) <= 1, m.cards);
    ok(`§money ${where}: no Home figure renders cents`, m.figures.length > 0 && !m.figures.some(f => CENTS.test(f)), m.figures.filter(f => CENTS.test(f)).slice(0, 4));
    ok(`§drift ${where}: 5 rows, the amounts in one column`, m.rows === 5 && new Set(m.amts.map(a => width < 600 ? a.x : a.r)).size === 1, m.amts);
    ok(`§setup ${where}: the setup card is one line with the next step, its steps folded`, !!m.setup && /Set up Steward · \d+ of \d+/.test(m.setup) && /Show the steps/.test(m.setup) && !m.stepsOpen, m.setup);
    ok(`§email ${where}: the top bar has no Automatic email pill`, !m.pill);
    ok(`§grid ${where}: no sideways scroll`, m.scrollW <= m.innerW, { scrollW: m.scrollW, innerW: m.innerW });
    if (width === 390) {
      const cls = await page.evaluate(() => window.__cls);
      ok(`§shift ${where}: Home moves no more than SHIFT-2's bar (CLS ${cls.toFixed(3)} ≤ 0.01)`, cls <= 0.01, cls);
    }
    ok(`${where}: no page error`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // §drift: Show all opens every person, in place, and folds again.
  {
    const { ctx, page } = await page0(1440);
    const count = Number(await page.locator('[data-testid="drift-list-count"]').innerText({ timeout: 5000 }).catch(() => "0"));
    await page.locator('[data-testid="drift-show-all"]').click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(n => document.querySelectorAll('[data-testid="drift-row"]').length === n, count, { timeout: 20000 }).catch(() => {});
    const shownAll = await page.locator('[data-testid="drift-row"]').count();
    ok(`§drift Show all opens every person its count says (${count}), the deck's own count (${deck.drift && deck.drift.count})`, count > 0 && shownAll === count && count === (deck.drift && deck.drift.count), { shownAll, count });
    await page.locator('[data-testid="drift-show-all"]').click({ timeout: 5000 }).catch(() => {});
    ok("§drift Show fewer folds it back to 5", (await page.locator('[data-testid="drift-row"]').count()) === 5);
    await ctx.close();
  }

  // §opens: every card opens what it names, every name opens the profile.
  const opens = async (label, click, check) => {
    const { ctx, page } = await page0(1440);
    let got;
    try { await click(page); await page.waitForTimeout(900); got = await check(page); }
    catch (e) { got = { failed: e.message.split("\n")[0] }; }
    ok(`§opens ${label}`, got === true, got);
    await ctx.close();
  };
  const onProfile = id => async page => { await page.waitForURL(u => String(u).includes("/donors/" + id), { timeout: 8000 }).catch(() => {}); return page.url().includes("/donors/" + id) || page.url(); };
  await opens('"What your history shows" opens that readout, not Recent changes',
    p => p.locator('[data-testid="home-readout-row"] a').first().click(),
    async p => {
      await p.waitForSelector('[data-testid="readout-panel"] [data-testid="readout"]', { timeout: 8000 }).catch(() => {});
      const panel = await p.locator('[data-testid="readout-panel"]').innerText().catch(() => "");
      const undo = await p.locator('[data-testid="recent-changes"]').count();
      return (/What your history shows/.test(panel) && /biggest gift ever/.test(panel) && undo === 0)
        || { panel: panel.slice(0, 120), recentChanges: undo, dialog: (await p.locator('[role="dialog"]').last().innerText().catch(() => "none")).slice(0, 80) };
    });
  await opens(`"${threads.stat.open} follow-ups" opens a list of ${threads.stat.open}`,
    p => p.locator('[data-testid="home-today-followups"]').click(),
    async p => { await p.waitForFunction(n => Number((document.querySelector('[data-testid="rail-list"]') || {}).dataset?.rows) === n, threads.stat.open, { timeout: 8000 }).catch(() => {});
      const n = Number(await p.locator('[data-testid="rail-list"]').getAttribute("data-rows").catch(() => "0")); return n === threads.stat.open || { rows: n }; });
  const firstThread = threads.list[0];
  await opens(`a name in the Thread (${firstThread.donorName}) opens the profile`, p => p.locator('.home-shell .attn-row .attn-donor-name a').first().click(), onProfile(firstThread.donorId));
  await opens(`a name in the drifting list (${drift0.name}) opens the profile`, p => p.locator('[data-testid="drift-name"]').first().click(), onProfile(drift0.id));
  await opens("a name in the follow-ups list opens the profile",
    async p => { await p.locator('[data-testid="home-today-followups"]').click(); await p.locator('.home-rail .home-rail-row').first().click(); },
    async p => { await p.waitForURL(u => /\/donors\/.+/.test(String(u)), { timeout: 8000 }).catch(() => {}); return /\/donors\/.+/.test(p.url()) || p.url(); });
  await opens("a name in the calls opens the profile",
    p => p.locator('[data-testid="home-rail"] [data-donor-link]').first().click(),
    async p => { await p.waitForURL(u => /\/donors\/.+/.test(String(u)), { timeout: 8000 }).catch(() => {}); return /\/donors\/.+/.test(p.url()) || p.url(); });

  // §email: Settings, Automatic email shows the setting and saves a change.
  {
    const { ctx, page } = await page0(1440);
    await page.goto(APP + "/app/settings?section=automatic", { waitUntil: "load" });
    await page.waitForSelector('[data-testid="mail-types-page"]', { timeout: 20000 }).catch(() => {});
    const says = await page.locator('[data-testid="mail-types-page"]').innerText().catch(() => "");
    ok("§email Settings, Automatic email shows the setting with its explanation", /Steward sends nothing on its own until you turn it on here/.test(says), says.slice(0, 160));
    const sw = page.locator('[data-testid="mail-type-switch-pledge_reminder"]');
    await sw.click().catch(() => {});
    await page.waitForSelector('[data-testid="mail-type-pledge_reminder"][data-on="0"]', { timeout: 8000 }).catch(() => {});
    const [row] = await q(`SELECT is_on FROM org_mail_types WHERE org_id=$1 AND type_key='pledge_reminder'`, [ORG.id]);
    ok("§email turning an email off there saves it (the switch and the row agree)", row && row.is_on === false
      && (await page.locator('[data-testid="mail-type-pledge_reminder"]').getAttribute("data-on")) === "0", row);
    await ctx.close();
  }

  await browser.close();
})().catch(e => ok("suite ran", false, e.stack))
  .finally(async () => { await closeDb().catch(() => {}); summary(); });
