// tests/lag1.test.js: LAG-1. A CONFIRMED CHANGE SHOWS EVERYWHERE AT ONCE.
// Guards donor data: the 8 Nov fleet measured, on production, confirmed
// writes that took 30 to 60 seconds to reach the totals, a receipted gift's
// Delete that did nothing three times, and a moved meeting whose task stayed
// on the old day. Each leg below is real clicks in a browser on the built
// client, against a server booted the way production is (LAG1_PROD=1 in the
// report: NODE_ENV=production, a separate worker, no Insights wait). Each
// after-write surface must be right within ONE second, with no reload.
//
//   L1 W-1108-Finance-06    a $100 gift edited to $150: the header's Lifetime
//   L2 W-1107-Finance-04X   Delete on a gift with an issued receipt asks
//                           "Void the receipt first?", and Void and delete
//                           takes it off the header
//   L3 W-1107-Volunteers-33 a removed group's card is gone
//   L4 W-1107-Volunteers-15 a snoozed task leaves Today and Done does not move
//   L5 W-1108-Donors-02X    Home's deck after a draft: the tab counts are the
//                           worker's fresh answer or say "Updating…", never an
//                           old count shown as current
//   L6 W-1107-Volunteers-18X a meeting dragged to a new day: its next-step
//                           task's title and due date move with it
//   H  every org GET answers Cache-Control: no-store
//   A  FLAKE-3: a read cut off by leaving the page is not an error. The Donors
//      list's read is held in flight, the page is left, and nothing is logged
//      (lib/leaving.js). The walk's last check counts every console error, so
//      an abort the app logs is red here every time, not one run in a few.
//
// Planted defect (FLAKE-3, by hand): the Donors list's catch without
// isAbort(e) logs the cut-off read again; A goes red on every run.
// Planted defect: LAG1_PLANT_TTL=30000 on the server (server/http/noStore.js)
// keeps every org GET's answer for 30 s per replica; L1, L3, L4 and L6 go red.
"use strict";
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, browserLegOrSkip, drainQueue } = require("./helpers");
const { DIST } = require("./lib/dist");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const ORG = "org_lag1";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const WITHIN = Number(process.env.LAG1_WITHIN_MS || 1000);   // the brief's one second
const SHOTS = process.env.LAG1_SHOTS || "";
// Elapsed time is measured with performance.now() (a stopwatch, not the clock).
// A civil day's weekday, with no clock: 1970-01-01 was a Thursday.
const weekday = ymd => { const [y, m, d] = ymd.split("-").map(Number); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][((Math.floor(Date.UTC(y, m - 1, d) / 86400000) + 4) % 7 + 7) % 7]; };

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Lag Test Quillfield Trust',$2,1,'active','team','America/New_York',NOW())`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Corin Vale','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, f = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,kind,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5,$6::jsonb,$7,'Corin Vale','system:test/lag1','LAG-1 test')`,
  [P(id), ORG, name, `${id}@lag1.example.org`, f.kind || null, JSON.stringify(f.types || ["donor"]), ME]);

(async () => {
  const tok = await freshOrg();
  const today = civilToday();
  await person("ada", "Ada Fenwick");
  await person("bram", "Bram Okoro");
  await person("cleo", "Cleo Marchetti");
  await person("dov", "Dov Haldane");
  // L1: Ada's one $100 gift. L2: Bram's $80 gift with an issued receipt.
  const g1 = await api("POST", `/donors/${P("ada")}/gifts`, tok, { amount: 100, date: civilPlusDays(-20), type: "cash", paymentMethod: "Cash" });
  const g2 = await api("POST", `/donors/${P("bram")}/gifts`, tok, { amount: 80, date: civilPlusDays(-15), type: "check", paymentMethod: "Check" });
  const G2 = g2.body && (g2.body.id || (g2.body.gift && g2.body.gift.id));
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot)
           VALUES ($1,$2,$3,$4,'gift','LAG-0001',80,80,'{}'::jsonb)`, [P("rcpt"), ORG, P("bram"), G2]);
  // L3: a group to remove.
  const grp = await api("POST", "/groups", tok, { name: "Quillfield Lantern Circle", kind: "static" });
  const GRP = grp.body && grp.body.id;
  // L4: two tasks due today; one is snoozed.
  const t1 = await api("POST", "/tasks", tok, { title: "Call Cleo about the spring visit", due: today, type: "donor", donorId: P("cleo"), priority: "medium" });
  await api("POST", "/tasks", tok, { title: "Write the reading-room note", due: today, type: "admin", priority: "medium" });
  const T1 = t1.body && (t1.body.id || (t1.body.task && t1.body.task.id));
  // L6: a meeting with Dov, kept in Steward, two days out at 10:00.
  const day = civilPlusDays(2);
  const startsAt = `${day}T15:00:00.000Z`, endsAt = `${day}T16:00:00.000Z`;   // 10:00 to 11:00 in New York
  const bk = await api("POST", `/donors/${P("dov")}/book-visit`, tok, { title: "Coffee with Dov", startsAt, endsAt, location: "Harbor Cafe" });
  const CAL = bk.body && bk.body.id;
  await drainQueue(q).catch(() => {});
  ok("fixtures: gifts, the receipt, the group, the tasks and the meeting exist", !!G2 && !!GRP && !!T1 && !!CAL, { G2, GRP, T1, CAL, bk: bk.status });

  // ── H · NO ORG READ IS CACHED ON THE WAY ─────────────────────────────────
  for (const p of ["/donors?limit=5", `/donors/${P("ada")}`, "/tasks", "/groups", "/insights?view=deck", "/home/bundle?paths=%2Ftasks"]) {
    const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } });
    ok(`H ${p} answers Cache-Control: no-store`, /no-store/.test(r.headers.get("cache-control") || ""), { status: r.status, cc: r.headers.get("cache-control") });
  }

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const dialogs = [];
  const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
  page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/React DevTools|status of 409/.test(m.text())) errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 500 && !NOISE.test(r.url())) errors.push(r.status() + " " + r.url()); });
  // A browser alert is what the fleet never saw (an automated browser dismisses it): count it as "said nothing".
  page.on("dialog", d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);

  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const go = async url => {
    await page.evaluate(u => { const st = window.history.state || {}; window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: (st.idx || 0) + 1 }, "", u); window.dispatchEvent(new PopStateEvent("popstate")); }, url);
    await page.waitForLoadState("networkidle").catch(() => {});
  };
  const text = async sel => ((await page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  // How long until fn holds, measured from the moment the write's answer
  // arrived (`since`), or null when it did not hold within `max`.
  const timeTo = async (fn, arg, since, max = 90000) => {
    const okd = await page.waitForFunction(fn, arg, { timeout: max, polling: 100 }).then(() => true).catch(() => false);
    return okd ? performance.now() - since : null;
  };
  const answered = (re, method) => page.waitForResponse(r => re.test(r.url()) && r.request().method() === method, { timeout: 20000 }).then(r => ({ at: performance.now(), status: r.status() }));
  const check = async (label, cond, detail) => { ok(label, cond, detail); if (!cond && SHOTS) await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) + ".png") }).catch(() => {}); };
  const within = ms => ms != null && ms <= WITHIN;
  const noReload = async (label, fn) => {
    const before = loads;
    try { await fn(); } catch (e) { await check(label + " ran to the end", false, String(e && e.message || e).split("\n")[0]); return; }
    ok(label + ": no page load happened", loads === before, { loads: loads - before });
  };
  const timings = {};
  const only = String(process.env.LAG1_ONLY || "").split(",").filter(Boolean);
  const leg = k => !only.length || only.includes(k);

  // ── A · A READ CUT OFF BY LEAVING THE PAGE ────────────────────────────────
  // The list's read is held for 3 s at the network, the page is left while it
  // is out, and the page left to must be Tasks with nothing logged on the way.
  // Its own context, with the service worker blocked: a read the worker makes
  // is out of page.route's reach, so it could not be held.
  if (leg("A")) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const pa = await ctx.newPage();
    const errs = [];
    // (the one line blocking the worker causes: its registration failing)
    pa.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/React DevTools|status of 409|^\[SW\] registration failed/.test(m.text())) errs.push(m.text()); });
    await pa.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    let held = 0;
    await pa.route(/\/donors\?/, r => { held++; setTimeout(() => r.continue().catch(() => {}), 3000); });
    await pa.goto(`${APP}/donors`, { waitUntil: "commit", timeout: 60000 });
    for (let i = 0; i < 100 && !held; i++) await pa.waitForTimeout(100);
    await pa.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
    const there = await pa.locator('[data-testid="tasks-view-today"]').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    await pa.waitForTimeout(300);
    ok("A FLAKE-3: the Donors list's read was in flight when the page was left, and Tasks opened", held > 0 && there, { held, there });
    ok("A FLAKE-3: a read cut off by leaving the page logs no error", errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  // ── L1 · A $100 GIFT EDITED TO $150 ────────────────────────────────────────
  if (leg("L1")) {
    await open(`/donors/${P("ada")}`);
    await noReload("L1", async () => {
      await page.waitForFunction(() => /\$100/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""), null, { timeout: 20000 });
      await page.locator('[data-tab="giving"]').first().click();
      const row = page.locator("tr").filter({ hasText: /\$100(\.00)?(?!\d)/ }).filter({ has: page.getByRole("button", { name: "Edit", exact: true }) }).first();
      await row.getByRole("button", { name: "Edit", exact: true }).click({ timeout: 10000 });
      await page.locator('input[placeholder="Amount"]').first().fill("150");
      const put = answered(/\/gifts\/[^/]+$/, "PUT");
      await page.getByRole("button", { name: /^Save$/ }).first().click();
      const a = await put;
      const ms = await timeTo(() => /\$150/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""), null, a.at);
      timings.L1 = ms;
      await check(`L1 W-1108-Finance-06: the header says $150 within ${WITHIN} ms of the save`, within(ms), { ms, now: await text('[data-testid="dp-fig-lifetime"]') });
    });
  }

  // ── L2 · DELETE A GIFT THAT HAS A RECEIPT ─────────────────────────────────
  if (leg("L2")) {
    await open(`/donors/${P("bram")}`);
    await noReload("L2", async () => {
      await page.waitForFunction(() => /\$80/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""), null, { timeout: 20000 });
      await page.locator('[data-tab="giving"]').first().click();
      const row = page.locator("tr").filter({ hasText: /\$80(\.00)?(?!\d)/ }).filter({ has: page.getByRole("button", { name: "Delete", exact: true }) }).first();
      const d0 = dialogs.length;
      await row.getByRole("button", { name: "Delete", exact: true }).click({ timeout: 10000 });
      await page.getByRole("button", { name: "Delete gift" }).click({ timeout: 8000 });
      const asked = await page.getByText(/This gift has a receipt\. Void the receipt first\?/).first().waitFor({ timeout: WITHIN + 2000 }).then(() => true).catch(() => false);
      await check("L2 W-1107-Finance-04X: Delete on a receipted gift asks \"Void the receipt first?\" on the page", asked && dialogs.length === d0, { asked, alerts: dialogs.slice(d0) });
      if (asked) {
        const del = answered(/\/gifts\/[^/]+$/, "DELETE");
        await page.getByRole("button", { name: "Void and delete" }).click({ timeout: 8000 });
        const a = await del;
        const ms = await timeTo(() => !/\$80/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""), null, a.at);
        timings.L2 = ms;
        await check(`L2 Void and delete takes the $80 off the header within ${WITHIN} ms`, within(ms) && a.status === 200, { ms, status: a.status, now: await text('[data-testid="dp-fig-lifetime"]') });
        const [r] = await q(`SELECT voided_at IS NOT NULL AS v FROM receipts WHERE id=$1`, [P("rcpt")]);
        const [g] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE id=$1`, [G2]);
        ok("L2 the receipt is voided and the gift is gone", r && r.v && g.n === 0, { r, g });
      }
    });
  }

  // ── L3 · A GROUP REMOVED ──────────────────────────────────────────────────
  if (leg("L3")) {
    await open(`/app/groups`);
    await noReload("L3", async () => {
      const card = `[data-group-id="${GRP}"]`;
      await page.getByText("Quillfield Lantern Circle").first().waitFor({ timeout: 20000 });
      const more = page.locator(`[data-testid="row-more"][data-kind="group"]`).first();
      await more.click({ timeout: 8000 });
      await page.locator('[data-testid="row-remove"]').first().click({ timeout: 8000 });
      const del = page.waitForResponse(r => /\/(removals|groups)\b/.test(r.url()) && r.request().method() !== "GET", { timeout: 20000 }).then(r => ({ at: performance.now(), status: r.status() }));
      await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click({ timeout: 8000 });
      const a = await del;
      const ms = await timeTo(() => ![...document.querySelectorAll("main *")].some(e => e.children.length === 0 && /^Quillfield Lantern Circle$/.test((e.textContent || "").trim()) && !e.closest('[role="status"],[role="alert"],[role="dialog"]')), null, a.at);
      timings.L3 = ms;
      await check(`L3 W-1107-Volunteers-33: the removed group's card is gone within ${WITHIN} ms`, within(ms), { ms, card });
    });
  }

  // ── L4 · A SNOOZED TASK LEAVES TODAY ──────────────────────────────────────
  if (leg("L4")) {
    await open(`/app/tasks`);
    await noReload("L4", async () => {
      await page.locator('[data-testid="tasks-view-today"]').click({ timeout: 20000 });
      await page.getByText("Call Cleo about the spring visit").first().waitFor({ timeout: 20000 });
      const n = s => Number((/(\d+)\s*$/.exec(s || "") || [0, -1])[1]);
      const today0 = n(await text('[data-testid="tasks-view-today"]')), done0 = await text('[data-testid="tasks-view-done"]');
      const row = page.locator('[data-testid="task-row"]').filter({ hasText: "Call Cleo about the spring visit" }).first();
      await row.locator('[data-testid="task-snooze"]').click({ timeout: 8000 });
      const post = answered(/\/tasks\/[^/]+\/snooze$/, "POST");
      await page.locator('[data-testid="snooze-save"]').click({ timeout: 8000 });
      const a = await post;
      const ms = await timeTo(([t0]) => {
        const rows = [...document.querySelectorAll('[data-testid="task-row"]')].map(r => r.textContent);
        const tab = (document.querySelector('[data-testid="tasks-view-today"]') || {}).textContent || "";
        const m = /(\d+)\s*$/.exec(tab);
        return !rows.some(r => /Call Cleo about the spring visit/.test(r)) && m && Number(m[1]) === t0 - 1;
      }, [today0], a.at);
      timings.L4 = ms;
      await check(`L4 W-1107-Volunteers-15: the snoozed task leaves Today and Today's count falls by one within ${WITHIN} ms`, within(ms), { ms, status: a.status, today0, now: await text('[data-testid="tasks-view-today"]') });
      const done1 = await text('[data-testid="tasks-view-done"]');
      await check("L4 the Done count does not move when nothing was finished", done0 === done1, { before: done0, after: done1 });
    });
  }

  // ── L5 · HOME'S DECK AFTER A CHANGE ───────────────────────────────────────
  // A $500 gift recorded on Ada's profile (clicks), then Home (no reload).
  // The deck is the worker's: until its build lands, the deck must say
  // "Updating…" rather than show its old counts as current, and once the
  // fresh build is there (read from the server here, the way the deck reads
  // it), the screen's counts are the fresh ones within a few seconds.
  if (leg("L5")) {
    await open(`/donors/${P("ada")}`);
    await noReload("L5", async () => {
      await page.waitForFunction(() => /\$1\d0/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""), null, { timeout: 20000 });
      // Home's deck, as the server has it now (the worker has caught up with the fixtures).
      const deckNow = async () => (await api("GET", "/insights?view=deck", tok)).body || {};
      const tabsOf = b => ((b.deck && b.deck.tabs) || []).filter(t => t.count > 0).map(t => `${t.label} · ${t.count}`).sort().join(" | ");
      for (let i = 0; i < 40 && (await deckNow()).stale; i++) await page.waitForTimeout(500);
      const before = tabsOf(await deckNow());
      await page.locator('[data-tab="giving"]').first().click();
      await page.getByRole("button", { name: "+ Add Gift" }).click({ timeout: 8000 });
      await page.locator('[data-testid="dp-add-gift-form"] input[placeholder="Amount ($)"]').first().fill("500");
      const post = answered(/\/donors\/[^/]+\/gifts$/, "POST");
      await page.locator('[data-testid="dp-add-gift-save"]').click({ timeout: 8000 });
      const a = await post;
      await go(`/dashboard`);
      const samples = [];
      const screen = () => page.evaluate(() => {
        const d = document.querySelector('[data-testid="home-moves"]');
        if (!d) return null;
        return { updating: !!d.querySelector('[data-testid="moves-updating"]'),
          tabs: [...d.querySelectorAll('[data-testid^="moves-tab-"]')].map(t => (t.querySelector("span") || t).textContent.replace(/\s+/g, " ").trim()).filter(x => !/· 0$/.test(x)).sort().join(" | ") };
      }).catch(() => null);
      let fresh = null, freshAt = null;
      const end = a.at + 20000;
      while (performance.now() < end) {
        const sc = await screen();
        if (sc) samples.push({ t: performance.now() - a.at, ...sc });
        if (!fresh) { const d = await deckNow(); if (!d.stale && !d.preparing) { fresh = tabsOf(d); freshAt = performance.now() - a.at; } }
        if (fresh && sc && !sc.updating && sc.tabs === fresh && performance.now() - a.at > freshAt) break;
        await page.waitForTimeout(150);
      }
      const last = samples[samples.length - 1] || {};
      const moved = fresh != null && fresh !== before;
      // Before the fresh build: any count shown as current must already be the fresh one.
      const lied = fresh ? samples.filter(x => !x.updating && x.tabs && x.tabs !== fresh) : [];
      const shownAt = (samples.find(x => !x.updating && x.tabs === fresh) || {}).t;
      timings.L5 = shownAt == null ? null : shownAt;
      ok("L5 the gift moved the deck's counts on the server (the check can tell old from new)", moved, { before, fresh, freshAt });
      await check("L5 W-1108-Donors-02X: until the worker's build lands the deck says \"Updating…\", never its old counts as current", lied.length === 0, { lied: lied.slice(0, 2), before, fresh });
      await check("L5 the fresh counts are on screen within 3 s of the worker's build, with no reload", fresh != null && !last.updating && last.tabs === fresh && shownAt != null && shownAt - freshAt <= 3000, { freshAt, shownAt, last, fresh });
    });
  }

  // ── L6 · A MEETING DRAGGED TO A NEW DAY ───────────────────────────────────
  if (leg("L6")) {
    await open(`/app/calendar`);
    await noReload("L6", async () => {
      // The meeting is two days out: the week it is in.
      for (let i = 0; i < 2 && !(await page.locator('[data-testid="cal-col"] >> text=Coffee with Dov').count()); i++) {
        await page.getByRole("button", { name: "Forward", exact: true }).first().click().catch(() => {});
        await page.waitForTimeout(800);
      }
      const block = page.locator('[data-testid="cal-col"] >> text=Coffee with Dov').first();
      await block.waitFor({ timeout: 20000 });
      // One day earlier when the week has a day before it, else one day later:
      // earlier usually pulls the prep task to today, which moves the Tasks badge.
      const cols = await page.locator('[data-testid="cal-col"]').evaluateAll(es => es.map(e => e.getAttribute("data-day")));
      const at = cols.indexOf(day), dir = at > 0 ? -1 : 1, newDay = cols[at + dir];
      const b = await block.boundingBox();
      const col = await page.locator('[data-testid="cal-col"]').first().boundingBox();
      const badge = async () => Number(((await page.locator('[data-testid="tasks-rail-badge"]').first().textContent({ timeout: 1000 }).catch(() => "0")) || "0").replace(/\D/g, "")) || 0;
      const badge0 = await badge();
      const post = answered(/\/calendar\/events\/[^/]+\/move$/, "POST");
      await page.mouse.move(b.x + b.width / 2, b.y + 6);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dir * col.width / 2, b.y + 6, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2 + dir * col.width, b.y + 6, { steps: 4 });
      await page.mouse.up();
      const a = await post;
      const oldDay = day;
      const dayWord = weekday(newDay);
      // On the calendar she dragged it on: the meeting and its follow-up task
      // ("How did it go with Dov?") are on the new day and gone from the old one
      // (the prep task is due the business day before, which may be the old day).
      const ms = await timeTo(([o, n]) => {
        const on = d => [...document.querySelectorAll(`[data-day="${d}"]`)].map(e => e.textContent).join(" ");
        return !/Coffee with Dov|How did it go with Dov/.test(on(o)) && /Coffee with Dov/.test(on(n)) && /How did it go with Dov/.test(on(n));
      }, [oldDay, newDay], a.at);
      timings.L6 = ms;
      // The rail's Tasks badge is the server's count of tasks due now, within the second.
      const truth = async () => { const c = (await api("GET", "/tasks/counts?scope=mine", tok)).body || {}; return (Number(c.today) || 0) + (Number(c.overdue) || 0); };
      const want = await truth();
      const badgeMs = await timeTo(([w]) => Number(((document.querySelector('[data-testid="tasks-rail-badge"]') || {}).textContent || "0").replace(/\D/g, "")) === w, [want], a.at, 5000);
      timings.L6badge = badgeMs;
      ok(`L6 (today the move ${want !== badge0 ? "moves" : "does not move"} the server's due-now count: ${badge0} → ${want})`, true);
      await check(`L6 the rail's Tasks badge says the server's ${want} within ${WITHIN} ms of the move`, within(badgeMs), { badgeMs, badge0, want, now: await badge() });
      // And Tasks › Upcoming (or Today) says the same, with no reload.
      await go(`/app/tasks`);
      await page.locator(`[data-testid="tasks-view-${newDay === today ? "today" : "upcoming"}"]`).click({ timeout: 8000 }).catch(() => {});
      const listed = await page.waitForFunction(([w]) => [...document.querySelectorAll('[data-testid="task-row"]')].some(r => /Coffee with Dov,/.test(r.textContent) && r.textContent.includes(w)), [dayWord], { timeout: 4000 }).then(() => true).catch(() => false);
      await check("L6 Tasks lists the next step with its new day", listed, { dayWord });
      const [t] = await q(`SELECT title, due FROM tasks WHERE org_id=$1 AND link_kind='next_step' AND donor_id=$2`, [ORG, P("dov")]);
      await check(`L6 W-1107-Volunteers-18X: the meeting's next-step task moved to ${newDay} (title and due) on screen within ${WITHIN} ms`, within(ms) && t && t.due === newDay, { ms, status: a.status, row: t, dayWord });
    });
  }

  ok("no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
  console.log("  LAG1 timings (ms from the confirmation to the surface):", JSON.stringify(timings));
  await browser.close(); await closeDb(); summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
