// tests/lib/fresh4Walk.js · FRESH-4 item 5. A GUARD THAT DOES WHAT THE FLEET DOES.
//
// Every earlier guard checked wiring (does write X reach surface Y in a list). The fleet checks the
// screen. This walk does each write the fleet named (W-1112-Volunteers-01X, Fri 27 Nov) with real
// clicks on a seeded fixture, and asserts that the visible number or line changes within 1.5 s with
// no reload. tests/stale2.test.js runs it (§K) in CI's browser shard.
//
// THE CENSUS. Each family below is the writes of one thing the fleet saved (a gift, a pledge, a
// recurring plan, hours, a shift, a meeting, a journey, a template, the org's name, Can give). Every
// write route of the live router in a family must name a step here: the one walked, or the walked
// step whose screen it shares. A new route in a family with no entry fails, so it can't skip the walk.
"use strict";

const SEEN_MS = 1500;

// family -> the step that walks it, and every write route of the family by name.
const FAMILIES = {
  gift:      { re: /^\/donors\/:[a-zA-Z]+\/gifts$|^\/gifts\/(:[a-zA-Z]+|new-person)(\/|$)/,
               routes: ["POST /donors/:id/gifts", "PUT /gifts/:id", "DELETE /gifts/:id", "POST /gifts/:id/receipt", "POST /gifts/:id/restore",
                 "PUT /gifts/:id/extras", "POST /gifts/:id/cheque", "POST /gifts/:id/refund", "POST /gifts/new-person", "PUT /gifts/:id/custom-fields",
                 "POST /gifts/:id/thank-call", "POST /gifts/:id/call-snooze"] },
  pledge:    { re: /^\/donors\/:[a-zA-Z]+\/pledges$|^\/pledges\//,
               routes: ["POST /pledges/run-reminders", "POST /donors/:id/pledges", "PUT /pledges/:id/installments", "PUT /pledges/:id", "DELETE /pledges/:id",
                 "POST /pledges/process-reminders", "POST /pledges/:id/resend"] },
  recurring: { re: /offline-plans/,
               routes: ["POST /donors/:id/offline-plans", "POST /offline-plans/:id/payments", "POST /offline-plans/:id/convert", "POST /offline-plans/:id/cancel"] },
  hours:     { re: /volunteer-hours/, routes: ["POST /donors/:id/volunteer-hours", "POST /volunteer-hours/import"] },
  shift:     { re: /^\/volunteer-shifts\//, routes: ["PATCH /volunteer-shifts/:id", "DELETE /volunteer-shifts/:id"] },
  meeting:   { re: /^\/donors\/:[a-zA-Z]+\/conversations$|^\/calendar\/events\//,
               routes: ["POST /donors/:id/conversations", "POST /calendar/events/:id/suggest", "POST /calendar/events/:id/log", "PUT /calendar/events/:id",
                 "POST /calendar/events/:id/dismiss", "POST /calendar/events/:id/move", "POST /calendar/events/:id/cancel", "POST /calendar/events/:id/people"] },
  journey:   { re: /^\/journeys\/:[a-zA-Z]+\/apply/, routes: ["POST /journeys/:id/apply", "POST /journeys/:id/apply/undo"] },
  template:  { re: /^\/email-templates(\/|$)/,
               routes: ["POST /email-templates/:id/rename", "POST /email-templates", "PUT /email-templates/:id", "POST /email-templates/:id/publish",
                 "POST /email-templates/:id/discard-draft", "POST /email-templates/:id/archive", "POST /email-templates/:id/restore",
                 "POST /email-templates/:id/preview", "POST /email-templates/:id/test", "POST /email-templates/:id/draft-ai", "POST /email-templates/:id/presence",
                 "POST /email-templates/:id/presence/leave", "POST /email-templates/:id/comments", "POST /email-templates/:id/share"] },
  org:       { re: /^\/orgs\/:[a-zA-Z]+$/, routes: ["PATCH /orgs/:id"] },
  canGive:   { re: /volunteer-record/, routes: ["PATCH /donors/:id/volunteer-record"] },
};

// The live router's write routes in a family that name no step. `routes` is the inventory.
function census(routes, families = FAMILIES) {
  const named = new Set(Object.values(families).flatMap(f => f.routes));
  const out = [];
  for (const r of routes) {
    if (r.method === "GET" || r.method === "HEAD" || r.method === "OPTIONS") continue;
    const k = `${r.method} ${String(r.path).replace(/:[a-zA-Z]+/g, ":id")}`;
    if (Object.values(families).some(f => f.re.test(r.path)) && !named.has(k)) out.push(k);
  }
  return [...new Set(out)];
}

// ── ITEM 3 · A READ AFTER A WRITE NEVER GETS AN ANSWER OLDER THAN THE WRITE ──
// Each answer a screen reads that is stored or computed off the request (a person's scores, the
// stored per-org answers: counts, Fundraising's overview, Annual), read in the same tick as the
// write's response, is the answer read again once the queue has finished.
const SAME_TICK = [
  // The person's own facts in the scores (each part's raw value): generosity's points are a percentile of
  // the whole org, which a full pass moves for everyone, so they are not the person's change.
  ["a person's scores (the queue rewrites the row 3 s later)", d => `/donors/${d}/scores`,
    b => b && b.parts && ["engagement", "generosity"].map(k => (b.parts[k] || []).map(x => `${x.key}:${x.raw ?? x.count ?? ""}`).join(","))],
  ["the person's record (Lifetime, Last gift)", d => `/donors/${d}`,
    b => b && Object.entries(b).filter(([k]) => /lifetime|total_?given|last_?gift/i.test(k)).sort()],
  ["the Directory's counts (a stored answer)", () => "/donors/counts", b => b],
  ["Fundraising's overview (a stored answer)", () => "/fundraising/overview", b => b && [b.raised ?? b.totals, b.thisYear ?? null, JSON.stringify(b).length]],
];

// `post` sends the gift and answers its status WITHOUT waiting for anything after it (the suites'
// api() drains the queue after a write, which is exactly the window this checks).
async function sameTick({ api, tok, donorId, drain, gift, post }) {
  const rows = [];
  await drain();   // the person's stored row is on file first: a person with no row is scored on the fly anyway
  const w = { status: await post(`/donors/${donorId}/gifts`, gift) };
  const now = await Promise.all(SAME_TICK.map(([, p]) => api("GET", p(donorId), tok)));
  await drain();
  const later = await Promise.all(SAME_TICK.map(([, p]) => api("GET", p(donorId), tok)));
  SAME_TICK.forEach(([what, , pick], i) => rows.push({ what, same: JSON.stringify(pick(now[i].body)) === JSON.stringify(pick(later[i].body)), status: now[i].status,
    now: JSON.stringify(pick(now[i].body)).slice(0, 160), later: JSON.stringify(pick(later[i].body)).slice(0, 160) }));
  return { write: w.status, rows };
}

// ── THE WALK ─────────────────────────────────────────────────────────────────
// page: a signed-in Playwright page on the fixture org. fx: { app, people: { gift, pledge, vol }, journeyName, newOrgName }.
// Each step: the clicks, then the text that must be on screen within SEEN_MS of the write's answer, no reload.
async function walk(page, fx) {
  const results = [];
  let loads = 0;
  page.on("load", () => { loads++; });
  const open = async url => { await page.goto(fx.app + url, { waitUntil: "networkidle", timeout: 60000 }); };
  // The write's answer, then the line: { ok, ms, why }.
  const seen = async (label, method, pathRe, clicks, test) => {
    const l0 = loads;
    let at = 0;
    const answered = page.waitForResponse(r => r.request().method() === method && pathRe.test(new URL(r.url()).pathname), { timeout: 20000 })
      .then(r => { at = performance.now(); return r.status(); }).catch(() => null);
    try { await clicks(); } catch (e) { results.push({ label, ok: false, why: "clicks: " + e.message.split("\n")[0].slice(0, 160) }); return; }
    const status = await answered;
    if (!status || status >= 300) { results.push({ label, ok: false, why: `the write answered ${status}` }); return; }
    const hit = await page.waitForFunction(test, null, { timeout: SEEN_MS + 2500, polling: 50 }).then(() => performance.now() - at).catch(() => null);
    const shown = hit == null ? await page.evaluate(n => { const t = document.body.innerText; const i = t.indexOf(n); return i < 0 ? t.slice(0, 300) : t.slice(Math.max(0, i - 150), i + 250); }, fx.people.giftName).catch(() => "") : "";
    results.push({ label, ok: hit != null && hit <= SEEN_MS && loads === l0, ms: hit, reloaded: loads !== l0, why: hit == null ? "not on screen within 4 s" : hit > SEEN_MS ? `on screen after ${hit} ms` : "", shown });
  };
  const has = s => new Function(`return document.body.innerText.includes(${JSON.stringify(s)})`);

  // 1 · a gift, from Donors → Record a gift: the Donors list row's Lifetime moves.
  await open("/donors");
  await seen("gift: Donors → Record a gift → the list's Lifetime moves", "POST", /\/donors\/[^/]+\/gifts$/, async () => {
    await page.click('[data-testid="donors-record-gift"]');
    await page.fill('[data-testid="record-gift-who"]', fx.people.giftName);
    await page.click(`[data-testid="record-gift-match"][data-person="${fx.people.gift}"]`, { timeout: 8000 });
    await page.fill('[data-testid="record-gift-amount"]', "4321");
    await page.click('[data-testid="record-gift-save-another"]');   // the dialog stays open: the list behind it must move on its own
  }, new Function(`const t = document.body.innerText, n = ${JSON.stringify(fx.people.giftName)};
    for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) { const j = t.indexOf("$4,321", i); if (j >= 0 && j - i < 160) return true; }
    return false;`));   // the list's row (name, then Lifetime); the dialog says "Saved $4,321 from …", amount first
  await page.keyboard.press("Escape").catch(() => {});

  // 2 · a pledge, on the profile: More → Record a pledge → Save. The Giving tab lists it.
  await open(`/donors/${fx.people.pledge}`);
  await seen("pledge: profile → More → Record a pledge → the Giving tab lists it", "POST", /\/donors\/[^/]+\/pledges$/, async () => {
    await page.click('button:has-text("More")');
    await page.click("text=Record a pledge");
    await page.fill('input[placeholder="Pledged amount ($)"]', "2750");
    await page.click('button:has-text("Save") >> nth=0');
  }, has("$2,750"));

  // 3 · a recurring plan, on the Giving tab: the plan's line shows.
  await seen("recurring: Giving → a recurring plan → its line shows", "POST", /\/offline-plans$/, async () => {
    await page.click('[data-tab="giving"]');
    await page.click('[data-testid="offline-plan-new"]');
    await page.fill('[data-testid="offline-plan-form"] input[aria-label="Amount"]', "35");
    await page.click('[data-testid="offline-plan-save"]');
  }, has("$35"));

  // 4 · hours, on a volunteer's profile: Hours in all moves.
  await open(`/donors/${fx.people.vol}`);
  await page.click('[data-tab="volunteer"]');
  await seen("hours: Volunteer tab → Add hours → Hours in all moves", "POST", /\/volunteer-hours$/, async () => {
    await page.click('[data-testid="volunteer-add-hours"]');
    await page.fill('input[aria-label="Date"]', fx.todayUs); await page.keyboard.press("Tab");
    await page.fill('input[aria-label="Hours"]', "7");
    await page.click('[data-testid="volunteer-log"]');
  }, () => /Hours in all\s*7\b/.test(document.body.innerText));

  // 5 · Can give, the same tab: the line says the new hours a week (it said "Nothing said yet").
  await seen("Can give: Edit → 4 hours a week → Save → the line says so", "PATCH", /\/volunteer-record$/, async () => {
    await page.click('[data-testid="volunteer-record-edit"]');
    await page.fill('input[aria-label="Hours a week"]', "4");
    await page.click('[data-testid="volunteer-record-save"]');
  }, () => /4 hours a week/.test((document.querySelector('[data-testid="volunteer-record-line"]') || {}).innerText || ""));

  // 6 · a shift, on Volunteers → Records: its hours change.
  await open("/app/volunteers");
  await page.click('[role=tab]:has-text("Records"), button:has-text("Records")');
  await page.waitForSelector('[data-testid="vol-shift-edit"]', { timeout: 10000 }).catch(() => {});
  await seen("shift: Volunteers → Records → Edit → 13 hours → the row moves", "PATCH", /\/volunteer-shifts\/[^/]+$/, async () => {
    await page.click('[data-testid="vol-shift-edit"] >> nth=0');
    await page.fill('[data-testid="vol-shift-editing"] input[aria-label="Hours"]', "13");
    await page.click('[data-testid="vol-shift-save"]');
  }, () => [...document.querySelectorAll('[data-testid="vol-shift-row"]')].some(r => /(^|\s)13(\s|$)/.test(r.innerText)));

  // 7 · a meeting, on the profile: Log a touch → Meeting → Log. Last contact says today.
  await open(`/donors/${fx.people.pledge}`);
  await seen("meeting: Log a touch → Meeting → Last contact moves", "POST", /\/donors\/[^/]+\/conversations$/, async () => {
    await page.click('button:has-text("Log a touch")');
    await page.click('[role=dialog] button:has-text("Meeting")');
    await page.click('[role=dialog] button:has-text("Log the")');
  }, () => { const t = document.body.innerText; const i = t.indexOf("Last contact"); return i >= 0 && /Last contact\s*(Today|today|0 days)/.test(t.slice(i, i + 40)); });

  // 8 · a journey, on the profile's rail: it shows as running.
  await seen("journey: rail → Start a journey → it shows as running", "POST", /\/journeys\/[^/]+\/apply$/, async () => {
    const v = await page.$eval('[data-testid="dp-journey-pick"]', (s, name) => ([...s.options].find(o => o.textContent.includes(name)) || {}).value, fx.journeyName);
    await page.selectOption('[data-testid="dp-journey-pick"]', v);
    await page.click('[data-testid="dp-journey-add-confirm"]');
  }, () => !!document.querySelector('[data-testid="dp-journey-progress"]'));

  // 9 · the org's name, in Settings, then Home: the greeting's org line says the new name (no reload).
  await open("/app/settings");
  await seen("org rename: Settings → name → Save", "PATCH", /\/orgs\/[^/]+$/, async () => {
    await page.click('[data-testid="settings-org-name-edit"]');
    await page.fill('[data-testid="settings-org-name-input"]', fx.newOrgName);
    await page.click('[data-testid="settings-org-name-save"]');
  }, has(fx.newOrgName));
  {
    const t0 = performance.now();
    await page.click("text=Home >> nth=0");
    const hit = await page.waitForFunction(n => { const el = document.querySelector(".home-head-wide, .home-head-narrow"); return !!el && el.innerText.includes(n); }, fx.newOrgName, { timeout: 4000, polling: 50 })
      .then(() => performance.now() - t0).catch(() => null);
    results.push({ label: "org rename → Home's greeting says the new name", ok: hit != null && hit <= SEEN_MS, ms: hit, why: hit == null ? "Home still says the old name" : "" });
  }
  return results;
}

// ── THE TEMPLATE'S EVENT INVITE (item 4, Area 2) ─────────────────────────────
// Start from a starter, add the Event invite (four parts), Save, take it out with ✕, Save:
// none of its parts is left in the saved template.
async function templateInvite(page, fx, { api, tok }) {
  const out = { steps: [] };
  let id = null;
  page.on("response", async r => { if (r.request().method() === "POST" && /\/email-templates$/.test(new URL(r.url()).pathname)) { try { const b = await r.json(); id = (b.template && b.template.id) || id; } catch { /* not json */ } } });
  const step = async (name, fn) => { try { await fn(); out.steps.push(name); } catch (e) { out.steps.push(name + ": " + e.message.split("\n")[0].slice(0, 120)); } };
  const blocks = async () => { const l = await api("GET", "/email-templates", tok); const t = ((l.body && l.body.templates) || l.body || []).find(x => x.id === id) || {}; const d = t.draft && Array.isArray(t.draft.blocks) ? t.draft : t; return (d.blocks || []).map(b => b.type); };
  await page.goto(fx.app + "/app/communications", { waitUntil: "networkidle", timeout: 60000 });
  await step("Templates", () => page.click("text=Templates >> nth=0"));
  await step("Start from this", () => page.locator("text=First gift welcome").first().locator('xpath=ancestor::div[.//*[contains(text(),"Start from this")]][1]').locator("text=Start from this").first().click({ timeout: 10000 }));
  await page.waitForSelector('iframe[title="The email"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  out.before = await blocks();
  await step("Blocks", () => page.click('[role=tab]:has-text("Blocks"), button:has-text("Blocks")', { timeout: 8000 }));
  await step("Event invite", () => page.click('[data-testid="ready-block-use-event_invite"]', { timeout: 8000 }));
  await page.waitForTimeout(600);
  await step("Save", () => page.click('[data-testid="email-save"]', { timeout: 8000 }));
  await page.waitForResponse(r => r.request().method() === "PUT" && /\/email-templates\//.test(r.url()), { timeout: 10000 }).catch(() => {});
  out.saved1 = await blocks();
  await step("✕", () => page.frameLocator('iframe[title="The email"]').locator('[data-act="remove"]').first().click({ force: true, timeout: 8000 }));
  await page.waitForTimeout(500);
  await step("Save again", () => page.click('[data-testid="email-save"]', { timeout: 8000 }));
  await page.waitForResponse(r => r.request().method() === "PUT" && /\/email-templates\//.test(r.url()), { timeout: 10000 }).catch(() => {});
  out.saved2 = await blocks();
  out.id = id;
  return out;
}

module.exports = { FAMILIES, census, sameTick, walk, templateInvite, SEEN_MS };
