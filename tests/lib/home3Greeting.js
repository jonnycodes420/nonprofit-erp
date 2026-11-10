// tests/lib/home3Greeting.js: HOTFIX-GREETING. Moved VERBATIM out of
// tests/smoke-walk.test.js (which was at its big-files cap), with the page
// clock pinned and the 1 AM case added. smoke-walk calls it in the same place:
// greetingFirst(browser, auth, { ok, api, APP }).
"use strict";

// HOME-3 · THE GREETING IS ALWAYS FIRST. "The greeting should always be on
// top, always" (Jonathan, 27 Oct). For an org with data (the demo), an empty
// org and an org mid-setup (people in, setup not done), the first words on
// Home are the greeting (org and "Good …"), the date is its heading, and the
// moves deck, the setup line and the rail all come after it. Red on main: the
// INSIGHTS-1 ladder box rendered above the greeting.
async function greetingFirst(browser, demoAuth, { ok, api, APP }) {
  const bcrypt = require("bcryptjs");
  const { q } = require("../helpers");
  const make = async (org, people) => {
    const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "Home3 " + org.slice(10), org.replace(/_/g, "-")]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Robin Home','admin')`, ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
    for (let i = 1; i <= people; i++) {
      await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,$3,'system:test','test')`, [`d_${org}_${i}`, org, `Home Person ${i}`]);
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
        [`g_${org}_${i}`, org, `d_${org}_${i}`, 100 * i, i % 2 ? "2025-12-10" : "2026-03-02"]);
    }
    return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
  };
  const cases = [["with data (the demo)", demoAuth], ["empty", await make("org_home3_empty", 0)], ["mid-setup", await make("org_home3_setup", 6)]];
  // HOTFIX-GREETING: the greeting is the org's hour (POLISH-8, lib/greeting.js),
  // read from the page's clock, so each page is pinned to 2 PM in the org's
  // zone (America/New_York, the fixtures' timezone) on the run's day. Unpinned,
  // §home-3 went red on every branch from 10 PM to 5 AM ET ("Hi Robin").
  const CLK = require("../clock");
  const { pinBrowserClockAt } = require("./browserClock");
  const AFTERNOON = CLK.nyNoon(CLK.civilDay()) + 2 * 3600e3;
  for (const [what, a] of cases) for (const vp of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
    await pinBrowserClockAt(ctx, AFTERNOON, CLK.testNow());
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('[data-testid="home-moves"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const root = document.querySelector(".dash-root");
      if (!root) return { root: false };
      const day = root.querySelector(".home-day");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim() && n.parentElement.offsetParent !== null ? 1 : 3 });
      const firstText = walker.nextNode();
      const head = day && day.closest(".home-head-wide, .home-head-narrow");
      const after = sel => [...root.querySelectorAll(sel)].every(el => day && (day.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { root: true, day: !!day && day.tagName, first: firstText ? firstText.textContent.trim().slice(0, 60) : null,
        firstInHead: !!(firstText && head && head.contains(firstText.parentElement)),
        greet: /Good (morning|afternoon|evening)/.test(head ? head.textContent : ""), behind: day ? /behind/i.test(day.parentElement.innerText) : null, paceEl: root.querySelectorAll('[data-testid="home-pace"]').length,
        afterIt: after('[data-testid="home-moves"], [data-testid="home-setup-line"], [data-testid="ladder-strip"], .home-rail, .home-block') };
    });
    ok(`§home-3 Home ${what} at ${vp.width}: the greeting is first, the date is its heading, everything else follows`,
       r.root && r.firstInHead && r.greet && r.day === "H1" && r.afterIt, r);
    // HOME-4: the rail draws whole (Today with no zeros, at most three calls,
    // To confirm in one line), the deck's extras are chips hidden at zero, no
    // Drift section and no empty Thread, setup where the org is, and an org
    // with no donors gets one friendly card and no pace sentence.
    await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 20000 }).catch(() => {});
    const h = await page.evaluate(() => {
      const t = s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, " ").trim() : null; };
      const n = s => document.querySelectorAll(s).length;
      return { rail: n('[data-testid="home-rail"][data-ready="1"]'), today: t('[data-testid="home-today"]'), calls: n('[data-testid="home-call-row"]'),
        callsAll: t('[data-testid="calls-see-all"]'), confirm: t('[data-testid="home-to-confirm"]'), oldTiles: n('[data-testid^="rail-tile-"]'),
        chips: [...document.querySelectorAll('[data-testid^="moves-chip-"]')].map(e => e.innerText.trim()), oldLinks: n('[data-testid="moves-quiet"]'),
        drift: n("#dash-drifting"), thread: n("#dash-thread"), threadEmpty: n('[data-testid="thread-empty-state"]'),
        first: n('[data-testid="home-setup-first"]'), railSetup: n('[data-testid="home-setup-rail"]'), setupLine: n('[data-testid="home-setup-line"]'),
        noDonors: t('[data-testid="moves-no-donors"]'), tabs: n('[data-testid^="moves-tab-"]'), pace: n('[data-testid="home-pace"]'),
        zeroTabs: [...document.querySelectorAll('[data-testid^="moves-tab-"]')].filter(e => e.dataset.count === "0" && e.getAttribute("aria-selected") !== "true").length,
        never: n('[data-testid="moves-never"]'), say: n('[data-testid="move-card"] blockquote') };
    });
    ok(`§home-4 Home ${what} at ${vp.width}: the rail draws whole, Today says no zero, at most three calls, To confirm is one line`,
       h.rail === 1 && h.oldTiles === 0 && !!h.today && !/(^|\s)0\s/.test(h.today) && h.calls <= 3 && (!h.callsAll || /^See all [\d,]+$/.test(h.callsAll))
       && !!h.confirm && !/\n/.test(h.confirm) && h.confirm.length < 80, h);
    ok(`§home-4 Home ${what} at ${vp.width}: chips hide at zero, no Drift section, no empty Thread, no loose links, no zero tabs`,
       h.chips.every(c => !/(^|\s)0\s/.test(c)) && h.oldLinks === 0 && h.drift === 0 && h.threadEmpty === 0 && h.zeroTabs === 0 && h.setupLine === 0 && (h.never === 0 || h.say > 0), h);
    if (what === "empty") ok(`§home-4 the empty org at ${vp.width}: Set up Steward under Ask, one friendly card pointing to the first step (POLISH-4: never Import a third time), with sample data, no tabs, no pace`,
       h.first === 1 && h.railSetup === 0 && /the first step above/.test(h.noDonors || "") && !/Import a spreadsheet/.test(h.noDonors || "") && /sample data/.test(h.noDonors || "")
       && h.tabs === 0 && h.pace === 0 && h.thread === 0, h);
    // HOME-5: Home doesn't open with a comparison: no pace sentence in the header, and "behind" nowhere on Home, on any tab of the deck (every match, so one can't hide another).
    const seen = () => page.evaluate(() => [...document.body.innerText.matchAll(/.{0,60}\bbehind\b.{0,60}/gi)].map(m => m[0].replace(/\s+/g, " ")));
    const behindAt = new Set(await seen());
    for (const tab of await page.$$('[data-testid^="moves-tab-"]')) { await tab.click().catch(() => {}); await page.waitForTimeout(300); (await seen()).forEach(b => behindAt.add(b)); }
    ok(`§home-5 Home ${what} at ${vp.width}: the header has no pace sentence and never says "behind"`, r.root && r.behind === false && r.paceEl === 0, r);
    ok(`§home-5 Home ${what} at ${vp.width}: the word "behind" appears nowhere on the page, on any tab of the deck`, behindAt.size === 0, [...behindAt]);
    if (what === "mid-setup") ok(`§home-4 mid-setup at ${vp.width} (one step done): still the full setup card above Your moves`, h.first === 1 && h.railSetup === 0, h);
    await ctx.close();
  }
  // HOME-4: three steps done moves setup to the top of the rail, and "I'll
  // finish later" on a new org's card does the same, for good.
  const { q: q2 } = require("../helpers");
  await q2(`UPDATE orgs SET receipt_address='1 Test Way, Testville, TS 00000', stripe_account_id='acct_test_home4' WHERE id='org_home3_setup'`);
  for (const [org, later] of [[cases[2][1], false], [cases[1][1], true]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [org.token, JSON.stringify(org.user), JSON.stringify(org.org)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 }).catch(() => {});
    if (later) {
      await page.click('[data-testid="setup-later"]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 }).catch(() => {});
    }
    const s2 = await page.evaluate(() => ({ first: document.querySelectorAll('[data-testid="home-setup-first"]').length,
      rail: (document.querySelector('[data-testid="home-setup-rail"]') || {}).innerText || null,
      top: !!document.querySelector('[data-testid="home-rail"] > [data-testid="home-setup-rail"]:first-child') }));
    ok(later ? "§home-4 \"I'll finish later\" moves the new org's setup card to the top of the rail, and it stays there"
             : "§home-4 three steps done: setup is the rail's first card, with the count, the next step and its steps folded (Show the steps, HOME-6)",
       s2.first === 0 && s2.top && /Set up Steward · \d+ of \d+/.test(s2.rail || "") && /Show the steps/.test(s2.rail || "") && (later || /Next:/.test(s2.rail || "")), s2);
    await ctx.close();
  }
  // HOTFIX-GREETING: at 1 AM in the org's zone there is no "Good ___": Home says "Hi Robin".
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await pinBrowserClockAt(ctx, CLK.startOfDay() + 3600e3, CLK.testNow());
    const a = cases[1][1];
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [a.token, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('[data-testid="home-greeting-line"]', { timeout: 30000 }).catch(() => {});
    const line = await page.locator('[data-testid="home-greeting-line"]').first().textContent().catch(() => null);
    ok("§home-3 at 1 AM in the org's zone the greeting is \"Hi Robin\", never \"Good ___\"", line === "Hi Robin", line);
    await ctx.close();
  }
}

module.exports = { greetingFirst };
