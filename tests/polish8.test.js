// tests/polish8.test.js: POLISH-8. DEAD BUTTONS, MISSING CONTROLS AND WORDS
// THAT MATCH THE STATE. Guards email (what the settings say sends on its own),
// donor data (erased people, files, tasks to the trash) and money (a giving
// page that stops taking gifts). One made-up org (tests/lib/polish8Fixture.js),
// then one check per fleet item, by real clicks on a production build:
//   §1  W-1107-Fundraising-20  the email header is derived from the switches
//   §2  W-1109-Donors-06       "13 people with a next step" opens those 13
//   §3  W-1109-Donors-49X      "+ Link someone" opens the picker, in view
//   §4  W-1109-Donors-42X      a done task has Delete (to the trash) and Reopen
//   §5  giving page            Live → Unpublish → the link isn't taking gifts
//   §6  W-1109-Fundraising-03  board names are whole at 1920; erased = "Former donor (erased)"
//   §7  W-1109-Donors-02       1:01 AM in the org's zone is "Hi Mike"
//   §8  W-1107-Donors-31       the Files header counts uploads only
//   §9  W-1109-Fundraising-16X two "General appeal"s are told apart, Rename in place
//   §10 W-1107-Fundraising-16X the Sent chip never counts GALA (reached nobody)
//   §11 W-1107-Fundraising-05  a goal tile names its period
//   §12 W-1107-Finance-04X / W-1108-Donors-02X  Not now drops Keep at once, never the old count
// PLANTED DEFECT (the brief's): put the static email header back and §1 goes red.
// Tests set their own clock (the browser's, §7). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");
const F = require("./lib/polish8Fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const BASE = process.env.BASE || "http://localhost:5601";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const ROOT = path.join(__dirname, "..");
const imp = f => import(path.join(ROOT, f)).catch(() => null);
const ONLY = (process.env.P8_ONLY || "").split(",").filter(Boolean);
const leg = k => !ONLY.length || ONLY.includes(k);

(async () => {
  const { tok, lg, D, ORG, TASK } = await F.build();

  // ── pure rules, read by the screens ───────────────────────────────────────
  const MH = await imp("shared/mailHeader.js");
  ok("§1 the header is derived: on with journey steps",
    !!MH && MH.mailHeader({ mailOn: true, types: [{ name: "Journey and sequence steps", on: true }, { name: "Gift receipts", on: false }] }) === "Email is on. These send on their own: journey and sequence steps.");
  ok("§1 the header is derived: off", !!MH && MH.mailHeader({ mailOn: false, types: [{ name: "Gift receipts", on: true }] }) === "Email is off. Nothing sends on its own.");
  const GR = await import(path.join(ROOT, "client/src/lib/greeting.js"));
  ok("§7 the windows: 5 morning, 12 afternoon, 17 evening, 22 and 1 just Hi",
    GR.greetingLine && GR.greetingLine(5, "Mike") === "Good morning, Mike" && GR.greetingLine(12, "Mike") === "Good afternoon, Mike"
    && GR.greetingLine(17, "Mike") === "Good evening, Mike" && GR.greetingLine(22, "Mike") === "Hi Mike" && GR.greetingLine(1, "Mike") === "Hi Mike");
  const CK = await import(path.join(ROOT, "shared/campaignKind.js"));
  ok("§10 the Sent chip reads reachedAnyone", CK.filterCampaigns([{ status: "sent", recipient_count: 0 }, { status: "sent", recipient_count: 3 }], "sent").length === 1);
  const DN = await imp("shared/dupeNames.js");
  const camps = (await api("GET", "/campaigns", tok)).body || [];
  const ga = (Array.isArray(camps) ? camps : []).filter(c => c.name === "General appeal");
  const labels = DN ? ga.map(c => DN.optionLabel(c, camps)) : [];
  ok("§9 the Reports filter tells the two General appeals apart", labels.length === 2 && labels[0] !== labels[1] && labels.every(l => /^General appeal \(made [A-Z][a-z]{2} \d+, \d{4} · draft\)$/.test(l)), labels);
  const PWd = await imp("shared/periodWords.js");
  ok("§11 a period reads \"Mar 1, 2026 to May 31, 2026\"", !!PWd && PWd.periodWords("2026-03-01", "2026-05-31") === "Mar 1, 2026 to May 31, 2026");
  const EL = await imp("shared/erasedLabel.js");
  const pipe = (await api("GET", "/pipeline?scope=all", tok)).body || {};
  const cards = Object.values(pipe.columns || {}).flat();
  const erased = cards.find(c => c.donorId === D("gone"));
  ok("§6 the board's erased card says \"Former donor (erased)\" with its amount kept", !!EL && !!erased && erased.name === "Former donor (erased)" && Number(erased.totalGiving) === 1200, erased && { name: erased.name, t: erased.totalGiving });

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "America/New_York" });
  await ctx.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const page = await ctx.newPage();
  const open = p => page.goto(APP + p, { waitUntil: "networkidle", timeout: 60000 });
  const text = (sel, t = 15000) => page.locator(sel).first().innerText({ timeout: t }).catch(() => "");
  const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} (browser) ran`, false, String(e && e.message || e).slice(0, 300)); } };
  try {
    if (leg("1")) await step("§1", async () => {
      await open("/app/settings?section=automatic");
      const head = await page.locator('[data-testid="mail-types-page"]').first().innerText({ timeout: 20000 });
      ok("§1 (browser) Settings says what the switches say: \"Email is on. These send on their own: journey and sequence steps.\"",
        head.includes("Email is on. These send on their own: journey and sequence steps.") && !/sends nothing on its own until you turn it on/.test(head), head.slice(0, 260));
    });

    if (leg("2")) await step("§2", async () => {
      await open("/dashboard");
      const b = page.locator('[data-testid="home-today-followups"]');
      const label = await b.innerText({ timeout: 30000 });
      await b.click();
      // the list reads past the Thread's first 12 ("Reading the rest…"); it settles on every one it counts
      await page.waitForFunction(() => (document.querySelector('[data-testid="rail-list"]') || {}).getAttribute && document.querySelector('[data-testid="rail-list"]').getAttribute("data-rows") === "13", null, { timeout: 8000 }).catch(() => {});
      const rows = await page.locator('[data-testid="rail-list"]').getAttribute("data-rows", { timeout: 8000 }).catch(() => null);
      const names = await page.locator('[data-testid="rail-list"]').innerText({ timeout: 3000 }).catch(() => "");
      ok("§2 (browser) \"13 people with a next step\" opens the 13 it counts", /^13 people with a next step$/.test(label.trim()) && rows === "13" && /Ines Calloway/.test(names), { label, rows, names: names.slice(0, 120) });
    });

    if (leg("3")) await step("§3", async () => {
      await open(`/donors/${D("hal")}`);
      await page.locator('[data-testid="dp-about-link"]').first().click({ timeout: 20000 });
      await page.locator('[data-testid="dp-related"]').waitFor({ timeout: 8000 });
      await page.getByRole("button", { name: "+ Link someone" }).first().click({ timeout: 8000 });
      const search = page.getByPlaceholder("Search people and organizations by name…");
      const seen = await search.isVisible().catch(() => false);
      const inView = seen && await search.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }).catch(() => false);
      ok("§3 (browser) \"+ Link someone\" in the Household dialog opens the picker, in view", seen && inView, { seen, inView });
      if (seen) {
        await search.fill("Ines");
        await page.getByRole("button", { name: /Ines Calloway/ }).first().click({ timeout: 8000 });
        await page.waitForTimeout(800);
        const [r] = await q(`SELECT count(*)::int AS n FROM donor_relationships WHERE org_id=$1 AND ($2 IN (donor_id_a,donor_id_b)) AND ($3 IN (donor_id_a,donor_id_b))`, [ORG, D("hal"), D("ines")]);
        ok("§3 (browser) and picking Ines links her", r.n === 1, r);
      }
    });

    if (leg("4")) await step("§4", async () => {
      await open("/app/tasks");
      await page.locator('[data-testid="tasks-view-done"]').click({ timeout: 20000 });
      const row = page.locator(`[data-task-id="${TASK}"]`);
      await row.waitFor({ timeout: 10000 });
      const del = row.getByRole("button", { name: "Delete", exact: true });
      const has = await del.count();
      ok("§4 (browser) a done task has Delete and Reopen on its row", has === 1 && (await row.getByRole("button", { name: "Reopen", exact: true }).count()) === 1, { has });
      if (has) {
        await del.click();
        await row.waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
        const [t] = await q(`SELECT count(*)::int AS n FROM tasks WHERE id=$1`, [TASK]);
        const [tr] = await q(`SELECT count(*)::int AS n FROM deleted_records WHERE org_id=$1 AND record_id=$2`, [ORG, TASK]).catch(() => [{ n: -1 }]);
        ok("§4 (browser) and it goes to the trash", t.n === 0 && tr.n === 1, { tasks: t.n, trash: tr.n });
      }
    });

    if (leg("5")) await step("§5", async () => {
      await open("/app/fundraising?fr=pages");
      const card = page.locator('[data-testid="page-card"]').filter({ hasText: "Year-end 2026" });
      await card.locator('[data-testid="row-more"]').click({ timeout: 20000 });
      const un = card.getByRole("menuitem", { name: "Unpublish" });
      const has = await un.count();
      ok("§5 (browser) a live page's menu offers Unpublish, not only Remove", has === 1, { has });
      if (has) {
        await un.click();
        await card.locator('[data-testid="page-draft"]').waitFor({ timeout: 8000 }).catch(() => {});
        const [p] = await q(`SELECT status FROM giving_pages WHERE id='gp_p8'`);
        const pub = await fetch(`${BASE}/org/org-polish8/giving-page/year-end-2026/public`).then(r => r.json().then(j => ({ s: r.status, j })));
        ok("§5 (browser) Unpublish puts it back to Draft and its link says it isn't taking gifts",
          p.status === "draft" && pub.s === 404 && pub.j.error === "This page isn't taking gifts right now." && (await card.locator('[data-testid="page-draft"]').count()) === 1, { status: p.status, pub });
      }
      await card.locator('[data-testid="row-more"]').click({ timeout: 8000 });
      await card.locator('[data-testid="row-remove"]').click({ timeout: 8000 });
      const asked = await page.locator('[data-testid="confirm-no"]').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      ok("§5 (browser) Remove asks first", asked);
      if (asked) await page.locator('[data-testid="confirm-no"]').first().click();
      const [still] = await q(`SELECT count(*)::int AS n FROM giving_pages WHERE id='gp_p8'`);
      ok("§5 (browser) and saying no removes nothing", still.n === 1, still);
    });

    if (leg("6")) await step("§6", async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await open("/app/fundraising?fr=pipeline");
      await page.getByText("Erased", { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {});
      const names = await page.evaluate(() => [...document.querySelectorAll('[data-donor-link]')].filter(a => a.closest('[draggable]') || a.closest('[style*="grab"]') || true)
        .map(a => ({ t: a.textContent.trim(), cut: a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1, title: a.getAttribute("title") })));
      const board = names.filter(n => /Owen|Nathaniel|Erased|Former donor/.test(n.t));
      ok("§6 (browser) at 1920 every board name is whole, with a tooltip", board.length >= 2 && board.every(n => !n.cut && n.title === n.t), board);
      ok("§6 (browser) the erased card says \"Former donor (erased)\", never \"Erased person\"", board.some(n => n.t === "Former donor (erased)") && !board.some(n => n.t === "Erased person"), board.map(n => n.t));
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    if (leg("7")) await step("§7", async () => {
      const p2 = await ctx.newPage();
      // 1:01 AM in New York, the org's zone (the browser is there too, as the fleet's was).
      await p2.clock.setFixedTime(new Date("2026-11-10T06:01:00Z"));
      await p2.goto(APP + "/dashboard", { waitUntil: "networkidle", timeout: 60000 });
      const g = await p2.locator('[data-testid="home-greeting"]').first().innerText({ timeout: 20000 }).catch(() => "");
      ok("§7 (browser) at 1:01 AM the greeting is \"Hi Mike\", never \"Good evening\"", /Hi Mike$/.test(g.trim()) && !/Good/.test(g), g);
      await p2.close();
    });

    if (leg("8")) await step("§8", async () => {
      await open(`/donors/${D("pell")}`);
      await page.locator('[data-tab="files"]').first().click({ timeout: 20000 });
      await page.waitForFunction(() => /·/.test((document.querySelector('[data-testid="dp-files-head"]') || {}).textContent || ""), null, { timeout: 15000 });
      const head = await text('[data-testid="dp-files-head"]');
      const line = await text('[data-testid="dp-files-attached"]', 3000);
      ok("§8 (browser) the Files header counts the 1 upload, and the 2 attachments are their own line",
        head.trim() === "Files · 1" && /2 attached to conversations and notes/.test(line), { head, line });
    });

    if (leg("9")) await step("§9", async () => {
      await open("/app/communications?subtab=campaigns");
      const rows = page.locator('[data-testid="camp-row"]').filter({ hasText: "General appeal" });
      await rows.first().waitFor({ timeout: 20000 });
      const words = await rows.locator('[data-testid="dupe-name-words"]').allInnerTexts();
      ok("§9 (browser) the two General appeal drafts each say when they were made", words.length === 2 && words[0] !== words[1] && words.every(w => /^made [A-Z][a-z]{2} \d+, \d{4} · draft$/.test(w)), words);
      if (words.length === 2) {
        await rows.nth(1).locator('[data-testid="dupe-rename"]').click();
        await page.locator('[data-testid="dupe-rename-input"]').fill("General appeal (autumn)");
        await page.locator('[data-testid="dupe-rename-save"]').click();
        await page.waitForTimeout(1200);
        const [n] = await q(`SELECT count(*)::int AS n FROM campaigns WHERE org_id=$1 AND name='General appeal (autumn)'`, [ORG]);
        ok("§9 (browser) Rename in place renames one", n.n === 1, n);
      }
      await open("/app/communications?subtab=templates");
      await page.getByText("General appeal", { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {});
      const tw = await page.locator('[data-template-card] [data-testid="dupe-name-words"]').allInnerTexts();
      ok("§9 (browser) the two General appeal templates are told apart", tw.filter(w => /yours/.test(w)).length === 2 && new Set(tw).size === tw.length, tw);

      // §10 the Sent chip on the same screen
      await open("/app/communications?subtab=campaigns");
      const chip = await text('[data-testid="camp-filter-sent"]', 20000);
      ok("§10 (browser) Campaigns' Sent chip does not count GALA, which reached nobody", chip.trim() === "Sent 0", chip);
    });

    if (leg("11")) await step("§11", async () => {
      await open("/app/fundraising?fr=campaigns");
      await page.getByText("Spring 2026", { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {});
      const per = await page.locator('[data-testid="campaign-goal-period"]').allInnerTexts();
      ok("§11 (browser) Spring 2026's $15,000 goal names its period", per.some(p => /Mar 1, 2026 to May 31, 2026/.test(p)), per);
    });

    if (leg("12")) await step("§12", async () => {
      // the worker builds the deck; wait for a fresh one with Keep moves
      let deck = null;
      for (let i = 0; i < 60; i++) { const b = (await api("GET", "/insights?view=deck", tok)).body || {}; if (!b.stale && !b.preparing && b.deck && (b.deck.tabs || []).some(t => t.key === "keep" && t.count > 0)) { deck = b.deck; break; } await new Promise(r => setTimeout(r, 1000)); }
      const keep = deck && deck.tabs.find(t => t.key === "keep");
      ok("§12 fixture: the deck has Keep moves", !!keep, deck && deck.tabs.map(t => [t.key, t.count]));
      if (!keep) return;
      await open("/dashboard");
      const tab = page.locator('[data-testid="moves-tab-keep"]');
      await tab.click({ timeout: 20000 });
      const n0 = Number(await tab.getAttribute("data-count"));
      await page.locator('[data-testid="move-not-now"]').click({ timeout: 8000 });
      await page.locator('[data-testid="move-card"]').getByRole("button", { name: "Snooze", exact: true }).click({ timeout: 8000 });
      const seen = [];
      const t0 = performance.now();   // a stopwatch, not the clock
      while (performance.now() - t0 < 9000) {
        seen.push(await page.evaluate(() => { const t = document.querySelector('[data-testid="moves-tab-keep"]'); return t ? (t.querySelector('[data-testid="moves-updating"]') ? "Updating" : t.getAttribute("data-count")) : "gone"; }));
        await page.waitForTimeout(150);
      }
      const old = seen.filter(s => s === String(n0));
      ok("§12 (browser) after Not now, Keep drops at once and never shows the old count again", seen[0] !== String(n0) && old.length === 0, { n0, first: seen.slice(0, 6), last: seen.slice(-4), old: old.length });
    });
  } finally { await browser.close(); }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
