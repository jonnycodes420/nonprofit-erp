// tests/stale1.test.js: STALE-1. AFTER ANY CHANGE, EVERY NUMBER ON SCREEN IS
// THE NEW ONE, WITHOUT A RELOAD.
// Guards donor data: Muse's Walk B (5 Nov 2026) found totals that kept the old
// figure until a reload, on every section (an event's Raised at $0 after a
// $100 event gift, the volunteer hours header, a deleted group's card, the
// Tasks badge). One mechanism now (client/src/lib/changes.js): every write
// announces the kinds it touched, every mounted view re-reads the kinds it
// shows. Each check below does the action in the browser, then reads the
// figure on screen with no reload (a page.goto after the action fails it):
//
//   §1 a $100 gift recorded for an event: the event's Raised, the guest row,
//      the Events list's card, and the giver's profile
//   §2 a volunteer shift logged: the header's counts and Recent shifts
//   §3 a group removed: its card is gone
//   §4 a task added on a profile: the rail badge and the profile's Tasks tab
//   §5 a pledge payment: the pledge card, Home's move and Fundraising
//   §6 a grant payment: the grant's Received, the Grants board and the
//      funder's profile
//   §7 an import undone: the Everyone count
//   §8 the cost: opening Home and recording one gift there makes at most
//      MAX_EXTRA requests beyond the gift itself, in the next five seconds
//   §9 the worker: a change only the server made (no browser write) reaches
//      the screen on the bell's next poll, with no request added
//
// Planted defects (each turned this suite red, then was taken back out):
//   · the gift kind dropped from kindsOfWrite's gift rule → §1 and §5 red
//   · run against main's client (scripts in the STALE-1 report) → see the report
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, browserLegOrSkip, drainQueue } = require("./helpers");
const { DIST } = require("./lib/dist");
const { testNow } = require("./clock");
const fs = require("fs");

const PASSWORD = "loadtest1234";
const ORG = "org_stale1";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
// Opening Home and recording one gift there: the gift, then what the screen
// reads again because of it. Named in the STALE-1 report.
const MAX_EXTRA = Number(process.env.STALE1_MAX_EXTRA || 8);
const WAIT = 12000;

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Stale Test Lantern Trust',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Talbot','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, f = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,kind,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5,$6::jsonb,$7,'Wren Talbot','system:test/stale1','STALE-1 test')`,
  [P(id), ORG, name, `${id}@stale1.example.org`, f.kind || null, JSON.stringify(f.types || ["donor"]), ME]);

const money = s => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;

(async () => {
  const tok = await freshOrg();
  const today = civilToday();
  await person("ines", "Ines Calder");
  await person("tomas", "Tomas Reyes", { types: ["volunteer"] });
  await person("pia", "Pia Lindqvist");
  await person("fund", "Harrow Brook Foundation", { kind: "organization" });

  // The event, with Ines on its guest list.
  const ev = await api("POST", "/events", tok, { name: "Lantern Supper", date: civilPlusDays(3), eventType: "gala", description: "A supper." });
  const EV = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  await api("POST", `/events/${EV}/attendees`, tok, { donorIds: [P("ines")] });
  // The group, the pledge, the grant and its award.
  const grp = await api("POST", "/groups", tok, { name: "Stale Walk Circle", kind: "static" });
  const GRP = grp.body && grp.body.id;
  const pl = await api("POST", `/donors/${P("pia")}/pledges`, tok, { amount: "1200", dueDate: civilPlusDays(20), frequency: "monthly", installmentCount: 4 });
  const PL = pl.body && pl.body.id;
  const grp2 = await api("POST", "/groups", tok, { name: "Atlas Removes This Circle", kind: "static" });
  const GRP2 = grp2.body && grp2.body.id;
  const gr = await api("POST", "/grants", tok, { funder: "Harrow Brook Foundation", program: "Reading Rooms", amount: 6000, status: "submitted" });
  const GR = gr.body && (gr.body.id || (gr.body.grant && gr.body.grant.id));
  await api("POST", `/grants/${GR}/funder-link`, tok, { donorId: P("fund") });
  await api("PUT", `/grants/${GR}/award`, tok, { amountAwarded: "6000.00", installmentCount: 2, frequency: "semiannual", firstDue: today });
  // The import that will be undone: three people.
  const IMP = "imp_stale1" + testNow().toString(36);
  await api("POST", "/donors/import-combined", tok, { importId: IMP, gifts: [],
    donors: [1, 2, 3].map(i => ({ name: `Imported Person${i} Okafor`, email: `imp${i}@stale1.example.org` })) });
  await api("POST", "/imports", tok, { id: IMP, name: "stale-walk.csv", sourceFilename: "stale-walk.csv", shape: "gift_file_with_donors", donorsCreated: 3, giftsCreated: 0, dollars: 0 });
  const IMP2 = IMP + "b";
  await api("POST", "/donors/import-combined", tok, { importId: IMP2, gifts: [],
    donors: [1, 2].map(i => ({ name: `Second Person${i} Abara`, email: `imp2${i}@stale1.example.org` })) });
  await api("POST", "/imports", tok, { id: IMP2, name: "stale-walk-2.csv", sourceFilename: "stale-walk-2.csv", shape: "gift_file_with_donors", donorsCreated: 2, giftsCreated: 0, dollars: 0 });
  const AWARD = ((await q(`SELECT award_pledge_id FROM grants WHERE id=$1`, [GR]))[0] || {}).award_pledge_id;
  await drainQueue(q).catch(() => {});
  ok("fixtures: the event, groups, pledge, grant award and imports exist", !!EV && !!GRP && !!GRP2 && !!PL && !!GR && !!AWARD, { EV, GRP, GRP2, PL, GR, AWARD });

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
  const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
  page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/React DevTools/.test(m.text())) errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 500 && !NOISE.test(r.url())) errors.push(r.status() + " " + r.url()); });
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);

  // Open a page once (a load), then move inside the app with no reload.
  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const go = async url => {
    await page.evaluate(u => { const st = window.history.state || {}; window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: (st.idx || 0) + 1 }, "", u); window.dispatchEvent(new PopStateEvent("popstate")); }, url);
    await page.waitForLoadState("networkidle").catch(() => {});
  };
  const text = async sel => ((await page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: WAIT }).then(() => true).catch(() => false);
  const SHOTS = process.env.STALE1_SHOTS || "";
  const check = async (label, cond, detail) => { ok(label, cond, detail); if (!cond && SHOTS) await page.screenshot({ path: path.join(SHOTS, label.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) + ".png") }).catch(() => {}); };
  const noReload = async (label, fn) => {
    const before = loads;
    try { await fn(); } catch (e) {
      await check(label + " ran to the end", false, String(e && e.message || e).split("\n")[0]);
      return;
    }
    ok(label + ": no page load happened", loads === before, { loads: loads - before });
  };

  // ── §1 · A $100 GIFT FOR AN EVENT ──────────────────────────────────────────
  await open(`/app/events`);
  await noReload("§1", async () => {
    const card = page.locator(`[data-testid="ev-card-raised"]`).first();
    await card.waitFor({ timeout: 20000 }).catch(() => {});
    const cardBefore = money(await text('[data-testid="ev-card-raised"]'));
    await page.getByText("Lantern Supper").first().click();
    await page.locator('[data-testid="event-detail"]').waitFor({ timeout: 20000 });
    await page.locator('[data-testid="row-more"][data-kind="guest"]').first().click();
    await page.getByRole("menuitem", { name: "Record a gift" }).click();
    await page.locator('[data-testid="ev-gift-amount"]').fill("100");
    await page.locator('[data-testid="ev-gift-save"]').click();
    const rowMoved = await until(() => /\$100/.test((document.querySelector('[data-testid="ev-att-given"]') || {}).textContent || ""));
    await check("§1 the guest row says the $100", rowMoved, await text('[data-testid="ev-att-given"]'));
    const raisedMoved = await until(([ev]) => [...document.querySelectorAll(`[data-testid="event-raised"][data-event-id="${ev}"]`)].some(e => Number(e.dataset.raisedCents) >= 10000), [EV]);
    await check("§1 the event's Raised says $100", raisedMoved, await page.locator('[data-testid="event-raised"]').first().getAttribute("data-raised-cents").catch(() => null));
    await page.getByRole("button", { name: /Back/ }).first().click();
    const listMoved = await until(([b]) => {
      const el = document.querySelector('[data-testid="ev-card-raised"]');
      return el && Number((el.textContent || "").replace(/[^0-9.]/g, "")) >= b + 100;
    }, [cardBefore]);
    await check("§1 the Events list's card says the $100", listMoved, { before: cardBefore, after: await text('[data-testid="ev-card-raised"]') });
    await go(`/donors/${P("ines")}`);
    const prof = await until(() => /\$100/.test((document.querySelector('[data-testid="dp-header-figures"]') || {}).textContent || ""));
    await check("§1 the giver's profile says the $100", prof, await text('[data-testid="dp-header-figures"]'));
  });

  // ── §2 · A VOLUNTEER SHIFT ─────────────────────────────────────────────────
  await open(`/app/volunteers`);
  await noReload("§2", async () => {
    await page.locator('[data-testid="vol-counts"]').waitFor({ timeout: 20000 }).catch(() => {});
    await page.locator('[data-vol-section="records"]').first().click().catch(() => {});
    await page.locator('[data-vol-part="shifts"]').first().click().catch(() => {});
    await page.locator('[data-testid="vol-log-shift"]').waitFor({ timeout: 15000 });
    const countsBefore = await text('[data-testid="vol-counts"]');
    const rowsBefore = await page.locator('[data-testid="vol-shift-row"]').count();
    const box = page.locator('[data-testid="vol-log-shift"]');
    await box.getByLabel("Volunteer").selectOption({ label: "Tomas Reyes" });
    await box.getByLabel("Date").fill(today);
    await box.getByLabel("Hours").fill("3");
    await box.getByLabel("What they did").fill("Sorting the book drive");
    await box.getByRole("button", { name: "Log shift" }).click();
    const rows = await until(([n]) => document.querySelectorAll('[data-testid="vol-shift-row"]').length === n + 1, [rowsBefore]);
    await check("§2 Recent shifts shows the new shift", rows, { before: rowsBefore, after: await page.locator('[data-testid="vol-shift-row"]').count() });
    const head = await until(([b]) => { const el = document.querySelector('[data-testid="vol-counts"]'); return el && el.textContent.replace(/\s+/g, " ").trim() !== b; }, [countsBefore]);
    await check("§2 the header's counts move", head, { before: countsBefore, after: await text('[data-testid="vol-counts"]') });
  });

  // ── §3 · A GROUP REMOVED ───────────────────────────────────────────────────
  await open(`/app/groups`);
  await noReload("§3", async () => {
    const card = page.locator('[data-testid="group-card"]', { hasText: "Stale Walk Circle" });
    await card.first().waitFor({ timeout: 20000 });
    await card.first().locator('[data-testid="row-more"]').click();
    await page.locator('[data-testid="row-remove"]').click();
    await page.locator('[data-testid="confirm-yes"]').click({ timeout: 10000 }).catch(() => {});
    const gone = await until(() => ![...document.querySelectorAll('[data-testid="group-card"]')].some(c => /Stale Walk Circle/.test(c.textContent)));
    await check("§3 the removed group's card is gone", gone, await card.count());
  });

  // ── §4 · A TASK ADDED ON A PROFILE ─────────────────────────────────────────
  await open(`/donors/${P("ines")}`);
  await noReload("§4", async () => {
    const badge = page.locator('[data-testid="tasks-rail-badge"]').first();
    await page.locator('[data-testid="dp-task"]').first().waitFor({ timeout: 20000 });
    const b0 = Number((await badge.textContent({ timeout: 3000 }).catch(() => "0")) || 0);
    const t0 = Number((await text('[data-tab="tasks"] [data-tab-count="tasks"]')) || 0);
    await page.locator('[data-testid="dp-task"]').first().click();
    await page.getByPlaceholder(/What happens next/).fill("Call Ines about the supper photos");
    await page.locator('input[type="date"]').last().fill(today);
    await page.getByRole("button", { name: "Create Task" }).click();
    const bm = await until(([n]) => Number((document.querySelector('[data-testid="tasks-rail-badge"]') || {}).textContent || 0) === n, [b0 + 1]);
    await check("§4 the Tasks badge moves by one", bm, { before: b0, after: await text('[data-testid="tasks-rail-badge"]') });
    const tm = await until(([n]) => Number((document.querySelector('[data-tab="tasks"] [data-tab-count="tasks"]') || {}).textContent || 0) === n, [t0 + 1]);
    await check("§4 the profile's Tasks tab moves by one", tm, { before: t0, after: await text('[data-tab="tasks"] [data-tab-count="tasks"]') });
  });

  // ── §5 · A PLEDGE PAYMENT ──────────────────────────────────────────────────
  await open(`/dashboard`);
  await noReload("§5", async () => {
    await page.locator('[data-testid="home-moves"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const home0 = await text('[data-testid="home-moves"]');
    await go(`/donors/${P("pia")}`);
    await page.locator('[data-testid="dp-pledge-record"]').first().waitFor({ timeout: 20000 });
    const cardBefore = await text('[data-testid="dp-open-pledge-words"]');
    await page.locator('[data-testid="dp-pledge-record"]').first().click();
    const form = page.locator('[data-testid="dp-add-gift-form"]');
    await form.waitFor({ timeout: 10000 });
    await form.getByPlaceholder("Amount ($)").fill("300");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await drainQueue(q).catch(() => {});
    const cm = await until(([b]) => { const el = document.querySelector('[data-testid="dp-open-pledge-words"]'); return !el || el.textContent.replace(/\s+/g, " ").trim() !== b; }, [cardBefore]);
    await check("§5 the pledge card moves", cm, { before: cardBefore, after: await text('[data-testid="dp-open-pledge-words"]') });
    await go(`/dashboard`);
    const hm = await until(([b]) => { const el = document.querySelector('[data-testid="home-moves"]'); return el && el.textContent.replace(/\s+/g, " ").trim() !== b; }, [home0]);
    await check("§5 Home's moves move with the payment", hm, { before: home0.slice(0, 160), after: (await text('[data-testid="home-moves"]')).slice(0, 160) });
    await go(`/app/fundraising`);
    const fm = await until(() => /\$6,900/.test((document.querySelector('[data-testid="fr-pledges"]') || {}).textContent || ""));
    await check("§5 Fundraising's pledges card moves", fm, await text('[data-testid="fr-pledges"]'));
  });

  // ── §6 · A GRANT PAYMENT ───────────────────────────────────────────────────
  await open(`/app/grants?grant=${GR}`);
  await noReload("§6", async () => {
    await page.locator('[data-testid="grant-record-payment"]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-testid="grant-record-payment"]').first().click();
    await page.locator('[data-testid="grant-payment-amount"]').fill("500");
    await page.locator('[data-testid="grant-payment-save"]').click();
    const rm = await until(() => /\$500/.test((document.querySelector('[data-testid="grant-received"]') || {}).textContent || ""));
    await check("§6 the grant's Received says $500", rm, await text('[data-testid="grant-received"]'));
    const TILE = () => ([...document.querySelectorAll(".grant-stat-grid > div")].find(d => /^Received/.test(d.textContent)) || {}).textContent || "";
    const sm = await until(() => /\$500/.test(([...document.querySelectorAll(".grant-stat-grid > div")].find(d => /^Received/.test(d.textContent)) || {}).textContent || ""));
    await check("§6 the grant's Received tile, above it, says $500", sm, await page.evaluate(TILE));
    await go(`/donors/${P("fund")}`);
    const fp = await until(() => /\$500/.test((document.querySelector('[data-testid="dp-header-figures"]') || {}).textContent || ""));
    await check("§6 the funder's profile says the $500", fp, await text('[data-testid="dp-header-figures"]'));
  });

  // ── §7 · AN IMPORT UNDONE ──────────────────────────────────────────────────
  await open(`/donors?view=directory`);
  await noReload("§7", async () => {
    await page.locator('[data-testid="dir-people-everyone-count"]').waitFor({ timeout: 20000 }).catch(() => {});
    const n0 = money(await text('[data-testid="dir-people-everyone-count"]'));
    await go(`/app/settings?section=imports&import=${IMP}`);
    await page.locator('[data-testid="import-undo-open"]').first().click({ timeout: 20000 });
    await page.locator('[data-testid="import-undo-yes"]').first().click({ timeout: 15000 });
    await page.locator('[data-testid="import-undo-done"], [data-testid="import-undone"]').first().waitFor({ timeout: 30000 }).catch(() => {});
    await drainQueue(q).catch(() => {});
    await go(`/donors?view=directory`);
    const cm = await until(([n]) => Number(((document.querySelector('[data-testid="dir-people-everyone-count"]') || {}).textContent || "").replace(/[^0-9]/g, "")) === n - 3, [n0]);
    await check("§7 the Everyone count drops by the three people the import added", cm, { before: n0, after: await text('[data-testid="dir-people-everyone-count"]') });
  });

  // ── §1a–§7a · THE SAME CHANGES, MADE BY ATLAS ─────────────────────────────
  // Atlas opens over every page (AGENT-5) and does the work on the server; its
  // sheet then says so with told() (VOICE-4). Here the suite is Atlas's server
  // half (the write, through the API) and the page gets the same told() the
  // sheet sends. The figure stays on screen the whole time.
  const atlasDid = async write => { await write(); await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: { memoId: "stale1" } }))); };

  await open(`/app/events?event=${EV}`);
  await noReload("§1a", async () => {
    await page.locator('[data-testid="event-detail"]').waitFor({ timeout: 20000 });
    await atlasDid(() => api("POST", `/donors/${P("ines")}/gifts`, tok, { amount: "50", date: today, type: "cash", eventId: EV }));
    const row = await until(() => /\$150/.test((document.querySelector('[data-testid="ev-att-given"]') || {}).textContent || ""));
    await check("§1a Atlas records $50 for the event: the guest row says $150", row, await text('[data-testid="ev-att-given"]'));
    const raised = await until(([ev]) => [...document.querySelectorAll(`[data-testid="event-raised"][data-event-id="${ev}"]`)].some(e => Number(e.dataset.raisedCents) >= 15000), [EV]);
    await check("§1a …and the event's Raised says $150", raised, await page.locator('[data-testid="event-raised"]').first().getAttribute("data-raised-cents").catch(() => null));
  });

  await open(`/app/volunteers`);
  await noReload("§2a", async () => {
    await page.locator('[data-vol-section="records"]').first().click().catch(() => {});
    await page.locator('[data-vol-part="shifts"]').first().click().catch(() => {});
    await page.locator('[data-testid="vol-log-shift"]').waitFor({ timeout: 15000 });
    const rows0 = await page.locator('[data-testid="vol-shift-row"]').count();
    const HOURS = () => Number(((document.querySelector('[data-testid="volunteers-hub"]') || {}).textContent || "").match(/(\d+(?:\.\d+)?) hours? given/)?.[1] || NaN);
    const h0 = await page.evaluate(HOURS);
    await atlasDid(() => api("POST", `/donors/${P("tomas")}/volunteer-hours`, tok, { date: civilPlusDays(-2), hours: 2, role: "Shelving" }));
    const rows = await until(([n]) => document.querySelectorAll('[data-testid="vol-shift-row"]').length === n + 1, [rows0]);
    await check("§2a Atlas logs hours: Recent shifts shows them", rows, { before: rows0, after: await page.locator('[data-testid="vol-shift-row"]').count() });
    const head = await until(([n]) => Number(((document.querySelector('[data-testid="volunteers-hub"]') || {}).textContent || "").match(/(\d+(?:\.\d+)?) hours? given/)?.[1] || NaN) === n + 2, [h0]);
    await check("§2a …and the header's hours go up by two", head, { before: h0, after: await page.evaluate(HOURS) });
  });

  await open(`/app/groups`);
  await noReload("§3a", async () => {
    await page.locator('[data-testid="group-card"]', { hasText: "Atlas Removes This" }).first().waitFor({ timeout: 20000 });
    await atlasDid(() => api("POST", `/removals/group/${GRP2}`, tok, {}));
    const gone = await until(() => ![...document.querySelectorAll('[data-testid="group-card"]')].some(c => /Atlas Removes This/.test(c.textContent)));
    await check("§3a Atlas removes a group: its card is gone", gone, null);
  });

  await open(`/donors/${P("ines")}`);
  await noReload("§4a", async () => {
    await page.locator('[data-testid="dp-task"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const b0 = Number((await text('[data-testid="tasks-rail-badge"]')) || 0);
    const t0 = Number((await text('[data-tab="tasks"] [data-tab-count="tasks"]')) || 0);
    await atlasDid(() => api("POST", "/tasks", tok, { title: "Atlas: send Ines the supper photos", due: today, priority: "medium", type: "donor", donorId: P("ines"), assignedTo: ME, assignedToName: "Wren Talbot" }));
    const bm = await until(([n]) => Number((document.querySelector('[data-testid="tasks-rail-badge"]') || {}).textContent || 0) === n, [b0 + 1]);
    await check("§4a Atlas adds a task: the badge moves by one", bm, { before: b0, after: await text('[data-testid="tasks-rail-badge"]') });
    const tm = await until(([n]) => Number((document.querySelector('[data-tab="tasks"] [data-tab-count="tasks"]') || {}).textContent || 0) === n, [t0 + 1]);
    await check("§4a …and the profile's Tasks tab", tm, { before: t0, after: await text('[data-tab="tasks"] [data-tab-count="tasks"]') });
  });

  await open(`/app/fundraising`);
  await noReload("§5a", async () => {
    await page.locator('[data-testid="fr-pledges"]').waitFor({ timeout: 20000 });
    const fr0 = await text('[data-testid="fr-pledges"]');
    await atlasDid(() => api("POST", `/donors/${P("pia")}/gifts`, tok, { amount: "300", date: today, type: "cash", pledgeId: PL }));
    const first = t => Number(((String(t).match(/\$[\d,]+/) || ["0"])[0]).replace(/[^0-9]/g, ""));
    const want = first(fr0) - 300;
    const fm = await until(([w]) => Number((((document.querySelector('[data-testid="fr-pledges"]') || {}).textContent || "").match(/\$[\d,]+/) || ["0"])[0].replace(/[^0-9]/g, "")) === w, [want]);
    await check("§5a Atlas records a $300 pledge payment: Fundraising's still-to-come drops by $300", fm, { before: fr0, after: await text('[data-testid="fr-pledges"]') });
  });
  await open(`/dashboard`);
  await noReload("§5b", async () => {
    await page.locator('[data-testid="home-moves"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const home0 = await text('[data-testid="home-moves"]');
    await atlasDid(() => api("POST", `/donors/${P("pia")}/gifts`, tok, { amount: "300", date: today, type: "cash", pledgeId: PL }));
    await drainQueue(q).catch(() => {});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: { memoId: "stale1" } })));
    const hm = await until(([b]) => { const el = document.querySelector('[data-testid="home-moves"]'); return el && el.textContent.replace(/\s+/g, " ").trim() !== b; }, [home0]);
    await check("§5b Atlas records another payment: Home's moves move with it", hm, { before: home0.slice(0, 160), after: (await text('[data-testid="home-moves"]')).slice(0, 160) });
  });

  await open(`/app/grants?grant=${GR}`);
  await noReload("§6a", async () => {
    await page.locator('[data-testid="grant-record-payment"]').first().waitFor({ timeout: 20000 });
    await atlasDid(() => api("POST", `/donors/${P("fund")}/gifts`, tok, { amount: "250", date: today, type: "cash", pledgeId: AWARD }));
    const rm = await until(() => /\$750/.test((document.querySelector('[data-testid="grant-received"]') || {}).textContent || ""));
    await check("§6a Atlas records a grant payment: the award's Received says $750", rm, await text('[data-testid="grant-received"]'));
    const sm = await until(() => /\$750/.test(([...document.querySelectorAll(".grant-stat-grid > div")].find(d => /^Received/.test(d.textContent)) || {}).textContent || ""));
    await check("§6a …and the Received tile above it", sm, null);
  });

  await open(`/donors?view=directory`);
  await noReload("§7a", async () => {
    await page.locator('[data-testid="dir-people-everyone-count"]').waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const n0 = money(await text('[data-testid="dir-people-everyone-count"]'));
    await atlasDid(() => api("POST", `/imports/${IMP2}/reverse`, tok, {}));
    await drainQueue(q).catch(() => {});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: { memoId: "stale1" } })));
    const cm = await until(([n]) => Number(((document.querySelector('[data-testid="dir-people-everyone-count"]') || {}).textContent || "").replace(/[^0-9]/g, "")) === n - 2, [n0]);
    await check("§7a Atlas undoes an import: the Everyone count drops by its two people", cm, { before: n0, after: await text('[data-testid="dir-people-everyone-count"]') });
  });

  // ── §8 · THE COST OF ONE GIFT ──────────────────────────────────────────────
  // Home has no gift form: the page posts the gift with its own token and
  // hands the write to the channel as api.js does (changes.js __stewardWrote,
  // on only when localStorage says steward_test_hooks). What is counted is
  // every request the screen makes in the next five seconds because of it.
  await page.evaluate(() => localStorage.setItem("steward_test_hooks", "1"));
  await open(`/dashboard`);
  await page.waitForTimeout(2500);
  const asked = [];
  const API_HOST = new URL(process.env.BASE || "http://localhost:5601").host;
  const onReq = r => { const u = new URL(r.url()); if (u.host === API_HOST && r.method() !== "OPTIONS") asked.push(r.method() + " " + u.pathname + u.search); };
  page.on("request", onReq);
  const hooked = await page.evaluate(async ([api, donor, day]) => {
    if (!window.__stewardWrote) return false;
    const body = JSON.stringify({ amount: "25", date: day, type: "cash" });
    const r = await fetch(`${api}/donors/${donor}/gifts`, { method: "POST", body, headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("npe_token") } });
    if (r.ok) window.__stewardWrote(`/donors/${donor}/gifts`, "POST", body);
    return r.ok;
  }, [process.env.BASE || "http://localhost:5601", P("pia"), today]);
  await page.waitForTimeout(5000);
  page.off("request", onReq);
  const extra = asked.filter(a => !/^POST \/donors\/[^/]+\/gifts$/.test(a));
  ok("§8 the gift went in through the page", hooked, { hooked });
  ok(`§8 one gift on Home makes at most ${MAX_EXTRA} more requests (it made ${extra.length})`, hooked && extra.length <= MAX_EXTRA, extra);
  const counted = await page.evaluate(() => (window.__stewardChanges || []).slice(-1)[0]);
  ok("§8 …announced as a gift, a person and the totals", !!counted && ["gift", "person", "totals"].every(k => counted.kinds.includes(k)), counted);

  // ── §9 · A CHANGE ONLY THE SERVER MADE ─────────────────────────────────────
  // The worker's after-change step, a webhook, a timed job: no browser request
  // names it. The bell's 60-second read carries the change marks; on its next
  // answer the Tasks page re-reads. The clock is moved on, not waited for.
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page2.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  await page2.clock.install();
  await page2.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
  await page2.waitForTimeout(1500);
  let loads2 = 0; page2.on("load", () => { loads2++; });
  const asked2 = [];
  page2.on("request", r => { const u = new URL(r.url()); if (u.host === API_HOST && r.method() !== "OPTIONS") asked2.push(r.method() + " " + u.pathname); });
  await api("POST", "/tasks", tok, { title: "Server-made task for the lantern list", due: today, priority: "medium", type: "admin", assignedTo: ME, assignedToName: "Wren Talbot" });
  await page2.clock.fastForward("01:05");
  const seen = await page2.waitForFunction(() => /Server-made task for the lantern list/.test(document.body.textContent), null, { timeout: WAIT }).then(() => true).catch(() => false);
  ok("§9 a task the server made shows on the open Tasks page after the bell's next read", seen && loads2 === 0, { seen, loads: loads2 });
  ok("§9 …and the only new kind of request is the bell's own read plus the Tasks re-read", asked2.filter(a => !/\/atlas\/activity|\/tasks/.test(a)).length <= 2, asked2);
  await page2.close();

  ok("no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
