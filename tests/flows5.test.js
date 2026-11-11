// tests/flows5.test.js — FLOWS-5. VOLUNTEERS, EVENTS, SHIFTS, HOME CARDS AND GROUPS THAT BEHAVE.
//
// One org shaped like the fleet's findings (tests/lib/flows5Fixture.js), and
// one check per item, on the built client where the item is a screen:
//   §1 hours range: both ends changed twice; the total, the rows and the
//      tooltip follow the last range (W-1109-Volunteers-26)
//   §2 meetings: one still to come is not counted as held (W-1110-Volunteers-06X)
//   §3 draft shifts: never upcoming in Opportunities; a draft with 0 people is
//      deleted; the Calendar says Draft (W-1110-Volunteers-08X)
//   §4 time inputs: "11:00", "11", "11am", "23:00" read as typed (W-1110-Volunteers-09X)
//   §5 one shift dialog from the Schedule and from Opportunities (W-1110-Volunteers-07X)
//   §6 Events this year: each row Past, Upcoming or Archived (W-1110-Volunteers-04X)
//   §7 Save as a group on LYBUNT, SYBUNT and Lost, every load (W-1110-Fundraising-14)
//   §8 one thank-you per gift on the Calendar and the Tasks tab (W-1107-Volunteers-14X)
//   §9 Home: a snoozed card's form never shows on the next; Plan a follow-up stays (Area 1)
//
// HOW IT GOES RED (planted, see the PR): the hours range sending its other
// end's old value turns §1 red; Save as a group drawn only on a first load
// turns §7 red.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip, civilPlusDays } = require("./helpers");
const { buildFlows5Org } = require("./lib/flows5Fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");

(async () => {
  console.log("flows5 (FLOWS-5)");
  const f = await buildFlows5Org();
  const tok = f.token, ids = f.ids;
  const wide = { from: civilPlusDays(-120), to: civilPlusDays(200) };

  // ── §2 meetings held ─────────────────────────────────────────────────────
  const mt = (await api("GET", `/figures/meetings/rows?from=${wide.from}&to=${wide.to}`, tok)).body || {};
  ok("§2 a meeting 3 days out is not counted as held", !!ids.meeting && Number(mt.value || 0) === 0 && !(mt.rows || []).some(r => r.id === ids.meeting), { value: mt.value, rows: (mt.rows || []).map(r => [r.name, r.date]) });

  // ── §3 draft shifts ──────────────────────────────────────────────────────
  const opps = (await api("GET", "/volunteer-hub/opportunities", tok)).body || {};
  const slots = (opps.opportunities || []).flatMap(o => o.slots || []);
  ok("§3 a draft shift is not upcoming in Opportunities; the published one is", !slots.some(s => s.id === ids.draft) && slots.some(s => s.id === ids.published), slots.map(s => s.id));
  const cal = (await api("GET", `/calendar/items?from=${ids.d5}&to=${ids.d5}`, tok)).body || {};
  const calItems = cal.items || cal || [];
  const draftCal = calItems.find(x => x.id === `shift:${ids.draft}`) || {};
  ok("§3 the Calendar says the draft is a draft", /^Draft: /.test(draftCal.title || "") && draftCal.draft === true, draftCal);
  const del = await api("DELETE", `/volunteer-hub/slots/${ids.draft}`, tok);
  ok("§3 a draft whose only sign-up was taken off (0 people) is deleted", del.status === 200 && del.body && del.body.ok === true, del.body);
  const busy = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: ids.opp, date: ids.d5, startTime: "16:00", endTime: "17:00", name: "Draft late", published: false });
  await api("POST", "/volunteer-hub/signups", tok, { slotId: busy.body.id, personId: ids.tam });
  const del2 = await api("DELETE", `/volunteer-hub/slots/${busy.body.id}`, tok);
  ok("§3 \"signed up\" is said only when someone is, with how many", del2.status === 409 && /^1 person is signed up for this shift/.test(del2.body.message || ""), del2.body);

  // ── §6 Events this year ──────────────────────────────────────────────────
  const y0 = `${f.today.slice(0, 4)}-01-01`, y1 = `${f.today.slice(0, 4)}-12-31`;
  const ev = (await api("GET", `/figures/events-year-events/rows?from=${y0}&to=${y1}`, tok)).body || {};
  const lab = id => ((ev.rows || []).find(r => r.id === id) || {}).detail;
  ok("§6 Events this year: the past one says Past, the archived one Archived, the one to come Upcoming",
    lab(ids.events.past) === "Past" && lab(ids.events.archived) === "Archived" && (lab(ids.events.soon) === "Upcoming" || !String(civilPlusDays(12)).startsWith(f.today.slice(0, 4))),
    (ev.rows || []).map(r => [r.name, r.date, r.detail]));

  // ── §8 one thank-you per gift ────────────────────────────────────────────
  const pipTasks = ((await api("GET", `/donors/${ids.pip}/tasks`, tok)).body || []).filter(t => /thank/i.test(t.title) && !Number(t.done));
  const pipCal = ((await api("GET", `/calendar/items?from=${f.today}&to=${civilPlusDays(14)}`, tok)).body.items || []).filter(x => x.donorId === ids.pip && /thank/i.test(x.title));
  ok("§8 Pip's $1 gift: one open thank-you on the Tasks tab", pipTasks.length === 1, pipTasks.map(t => [t.id, t.title]));
  ok("§8 …and the same one, once, on the Calendar", pipCal.length === 1 && pipCal[0].ref && pipCal[0].ref.taskId === pipTasks[0].id, pipCal.map(x => [x.id, x.title]));

  // ── the browser ──────────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: f.email, password: f.password });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const shot = n => process.env.FLOWS5_SHOTS ? page.screenshot({ path: path.join(process.env.FLOWS5_SHOTS, n + ".png"), fullPage: true }) : null;
    const typeInto = async (sel, text) => { const el = page.locator(sel).first(); await el.click({ clickCount: 3 }); await el.fill(""); await el.type(text, { delay: 15 }); await el.press("Tab"); };
    const part = async (section, partLabel) => {
      await page.goto(`${APP}/app/volunteers`, { waitUntil: "networkidle", timeout: 60000 });
      await page.getByRole("button", { name: section, exact: true }).first().click({ timeout: 15000 }).catch(() => page.getByRole("tab", { name: section, exact: true }).first().click({ timeout: 5000 }).catch(() => {}));
      await page.getByRole("button", { name: partLabel, exact: true }).first().click({ timeout: 15000 }).catch(() => page.getByRole("tab", { name: partLabel, exact: true }).first().click({ timeout: 5000 }).catch(() => {}));
    };
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n")[0]); } };
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const us = iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;

    await step("§1", async () => {
    // §1 the hours range, both ends changed twice
    await part("Records", "Hours report");
    await page.locator('[data-testid="vol-report"]').waitFor({ timeout: 20000 }).catch(() => {});
    const ends = [[civilPlusDays(-60), civilPlusDays(-30)], [civilPlusDays(-40), f.D], [f.D, f.D1], [civilPlusDays(-30), f.D]];
    for (const [a, b] of ends) { await typeInto('[data-testid="vol-report"] input >> nth=0', us(a)); await typeInto('[data-testid="vol-report"] input >> nth=1', us(b)); }
    await page.waitForTimeout(1500);
    const months = await page.locator('[data-testid="vol-report-row"]').allInnerTexts();
    const total = months.join(" | ");
    const sentence = await page.locator('[data-testid="vol-report"]').innerText().catch(() => "");
    const lastTo = f.D;
    ok("§1 after both ends changed twice, the report is the last range: Wren's 3 hours on D, never Tam's on D+1", /Wren Halvorsen\s*3 hours/.test(total) && !/Tamsin Okafor/.test(total), total);
    ok("§1 …and the page names the last range, to the last end date", sentence.includes(`and ${lastTo}`) && !sentence.includes(f.D1), { lastTo, sentence: sentence.slice(0, 200) });
    await shot("hours");
    });
    await step("§4 §5", async () => {

    // §4 and §5: Opportunities, a new shift's times, and Who is coming
    await part("Schedule", "Opportunities and shifts");
    await page.locator(`[data-testid="vol-new-slot-${ids.opp}"]`).click({ timeout: 20000 }).catch(() => {});
    const starts = '[aria-label="Starts"]', endsSel = '[aria-label="Ends"]';
    const readTime = async (sel, text) => { await typeInto(sel, text); return page.locator(sel).first().evaluate(el => el.closest("span").parentElement.querySelector("[data-time-input]").getAttribute("data-value")); };
    const r1 = await readTime(starts, "11:00").catch(() => null), r2 = await readTime(starts, "11").catch(() => null), r3 = await readTime(starts, "11am").catch(() => null), r4 = await readTime(endsSel, "23:00").catch(() => null);
    const shown = await page.locator(starts).first().inputValue().catch(() => null);
    ok("§4 a shift's time reads as typed: 11:00, 11, 11am are 11:00 and 23:00 is 23:00, shown \"11:00 AM\"", r1 === "11:00" && r2 === "11:00" && r3 === "11:00" && r4 === "23:00" && shown === "11:00 AM", { r1, r2, r3, r4, shown });
    await page.keyboard.press("Escape").catch(() => {});
    await page.getByRole("button", { name: "Not now" }).first().click({ timeout: 3000 }).catch(() => {});
    await page.getByText("Who is coming", { exact: true }).first().click({ timeout: 20000 }).catch(() => {});
    await page.locator('[data-testid="shift-drawer"]').waitFor({ timeout: 8000 }).catch(() => {});
    const fromOpp = await page.locator('[data-testid="shift-drawer"]').count();
    await shot("opportunities-shift");
    await page.keyboard.press("Escape").catch(() => {});
    await part("Schedule", "Calendar");
    await page.locator("button", { hasText: /^List$/ }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    for (let i = 0; i < 3 && !(await page.getByText("Morning sort", { exact: true }).count()); i++) { await page.locator("button", { hasText: /^›$/ }).first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(800); }
    await page.getByText("Morning sort", { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
    await page.locator('[data-testid="shift-drawer"]').waitFor({ timeout: 8000 }).catch(() => {});
    const fromSched = await page.locator('[data-testid="shift-drawer"]').count();
    await shot("schedule-shift");
    ok("§5 the shift opens the same dialog from Opportunities and from the Schedule", fromOpp === 1 && fromSched === 1, { fromOpp, fromSched });
    });
    await step("§7", async () => {

    // §7 Save as a group on every load of LYBUNT, SYBUNT and Lost
    const saw = [];
    for (const rep of ["lybunt", "sybunt", "std:lapsed-24"]) for (const i of [1, 2]) {
      await page.goto(`${APP}/app/reports?report=${encodeURIComponent(rep)}`, { waitUntil: "networkidle", timeout: 60000 });
      saw.push([rep, i, await page.locator('[data-testid="report-save-group"]').count()]);
    }
    ok("§7 Save as a group is offered on LYBUNT, SYBUNT and Lost, on the first load and every load after", saw.every(([, , n]) => n === 1), saw);
    await page.goto(`${APP}/app/reports?report=lybunt`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="report-save-group"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.locator('[data-testid="report-save-group-done"]').waitFor({ timeout: 8000 }).catch(() => {});
    const [grp] = await q(`SELECT a.id, (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = a.id AND m.org_id = a.org_id) AS n FROM audiences a WHERE a.org_id=$1 AND a.name LIKE 'Gave last year, not yet this year%'`, [f.org]).catch(() => [null]);
    ok("§7 …and it keeps the report's people as a group", !!grp && grp.n > 0, grp);
    await shot("lybunt");
    });
    await step("§9", async () => {

    // §9 Home: snooze, and the next card has no form open
    let deck = null;
    for (let i = 0; i < 45; i++) { const b = (await api("GET", "/insights?view=deck", tok)).body || {}; if (!b.stale && !b.preparing && b.deck && (b.deck.tabs || []).some(t => t.count >= 2)) { deck = b.deck; break; } await new Promise(r => setTimeout(r, 1000)); }
    if (!deck) ok("§9 fixture: Home has at least two moves to snooze", false, "the deck did not build");
    else {
      await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
      const tabKey = deck.tabs.find(t => t.count >= 2).key;
      await page.locator(`[data-testid="moves-tab-${tabKey}"]`).click({ timeout: 20000 }).catch(() => {});
      const first = await page.locator('[data-testid="move-card"]').getAttribute("data-move", { timeout: 10000 }).catch(() => null);
      await page.locator('[data-testid="move-not-now"]').click({ timeout: 8000 });
      await page.locator('[data-testid="move-card"]').getByRole("button", { name: "Snooze", exact: true }).click({ timeout: 8000 });
      await page.waitForTimeout(600);
      const next = await page.locator('[data-testid="move-card"]').getAttribute("data-move").catch(() => null);
      const formOpen = await page.locator('[data-testid="move-card"]').getByRole("button", { name: "Snooze", exact: true }).count();
      ok("§9 after a snooze the next card opens with no snooze form", next && next !== first && formOpen === 0, { first, next, formOpen });
      const plan = await page.locator('[data-testid="home-plan-followup"]').count();
      ok("§9 …and Plan a follow-up is on Home", plan >= 1, plan);
      await shot("home");
    }
    });
    ok("§10 no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
