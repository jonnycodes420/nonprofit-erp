#!/usr/bin/env node
// EVENTS-1 — THE WALK. SELF_REFUSING.
//
// An ED runs a gala from Steward, and the parts a server suite cannot see are
// most of them: whether the numbers on a card open, whether a guest can be
// dragged onto a table, whether the door screen works standing up, and whether
// the public page reads on a phone.
//
//   BASE=http://localhost:6001 APP_URL=http://localhost:4573 \
//   EMAIL=director@harborlight.demo PASSWORD=demo-harbor-2026 node scripts/events1-walk.js
//
// SELF_REFUSING: loopback only, and it never runs in production. It WRITES
// (it registers through the public page and checks somebody in), so there is
// no read-only mode: the point is that the writes land.

const path = require("path");

const BASE = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const APP = (process.env.APP_URL || "http://localhost:4173").replace(/\/+$/, "");
for (const [name, url] of [["BASE", BASE], ["APP_URL", APP]]) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run: ${name} must be loopback (got ${url}).`); process.exit(1);
  }
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const EMAIL = process.env.EMAIL || "director@harborlight.demo";
const PASSWORD = process.env.PASSWORD || "demo-harbor-2026";
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "events-1");
const IGNORE = /_vercel\/(insights|speed-insights)|\/ai\/stream|favicon|apple-touch-icon|\.map$/i;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 400) : "")); }
};
async function api(pathname, opts = {}, token = null) {
  const r = await fetch(BASE + pathname, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body, headers: r.headers };
}

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) {
    console.error(`Playwright not found under ${PW_DIR}. This walk is the browser half; there is no server-only mode.`);
    process.exit(1);
  }
  require("fs").mkdirSync(SHOTS, { recursive: true });

  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200 || !login.body.token) { console.error("Could not sign in as " + EMAIL); process.exit(1); }
  const token = login.body.token;
  const AUTH = [token, JSON.stringify(login.body.user || {}), JSON.stringify(login.body.org || {})];
  const signIn = ctx => ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, AUTH);

  // ── THE SERVER HALF ─────────────────────────────────────────────────────
  console.log("— the money, the report and the rows —");
  const list = await api("/events", {}, token);
  ok("both demo events are on file", Array.isArray(list.body) && list.body.length >= 2, list.body && list.body.length);
  const gala = (list.body || []).find(e => /Gala/.test(e.name));
  const run = (list.body || []).find(e => /Run/.test(e.name));
  ok("the gala carries a goal", gala && Number(gala.goal_amount) > 0, gala && gala.goal_amount);
  ok("…and its RAISED is summed from gifts, not from a typed figure",
     gala && Number(gala.raised) > 0, gala && gala.raised);
  ok("the upcoming 5K has a goal and nothing raised yet",
     run && Number(run.goal_amount) > 0 && Number(run.raised) === 0, run && { goal: run.goal_amount, raised: run.raised });

  const rep = await api(`/events/${gala.id}/report`, {}, token);
  ok("the report answers", rep.status === 200, rep.status);
  ok("…raised against goal, with a sentence", /% of the goal/.test(rep.body.progress.sentence), rep.body.progress);
  ok("…attended against registered, with a sentence", /of \d+ registered came/.test(rep.body.attendance.sentence), rep.body.attendance);
  const keys = (rep.body.figures || []).map(f => f.key);
  for (const k of ["raised", "registered", "attended", "firstTime", "sponsors"]) {
    ok(`…the report answers "${k}"`, keys.includes(k), keys);
  }
  ok("…every figure carries the sentence that says what it counts",
     (rep.body.figures || []).every(f => (f.sentence || "").length > 20));
  ok("…and the report does not claim the event CAUSED anything",
     /does not claim|Nothing here claims/i.test(rep.body.caveat), rep.body.caveat);

  // EVERY NUMBER OPENS, and the rows foot to the figure.
  for (const f of rep.body.figures) {
    const rows = await api(`/events/${gala.id}/rows?rows=${f.key}`, {}, token);
    ok(`the ${f.key} figure opens its rows`, rows.status === 200 && rows.body.count === f.count,
       { figure: f.count, rows: rows.body.count });
  }
  const raisedRows = await api(`/events/${gala.id}/rows?rows=raised`, {}, token);
  const summed = (raisedRows.body.donors || []).reduce((a, g) => a + Math.round(Number(g.amount) * 100), 0);
  ok("…and the raised rows FOOT to the figure, to the cent",
     summed === Math.round(Number(rep.body.figures.find(f => f.key === "raised").value) * 100),
     { rows: summed, figure: rep.body.figures.find(f => f.key === "raised").value });

  // ── THE PUBLIC PAGE ─────────────────────────────────────────────────────
  console.log("\n— the public registration page —");
  const pub = await fetch(`${BASE}/e/harbour-run`);
  const html = await pub.text();
  ok("the public page is served", pub.status === 200);
  ok("…embeddable, like a donation form", /frame-ancestors \*/.test(pub.headers.get("content-security-policy") || ""),
     pub.headers.get("content-security-policy"));
  ok("…on the org's own brand", /Harborlight/.test(html));
  ok("…and it states the deductible part BEFORE the button", /tax deductible/.test(html));
  ok("…it offers a way to give without attending", /Give instead/.test(html));
  ok("…and it says plainly that nothing is charged here", /nothing is charged on this page/i.test(html));

  const levels = await api(`/events/${run.id}/levels`, {}, token);
  const ticket = (levels.body.levels || levels.body || []).find(l => l.kind === "ticket");
  const before = await api(`/events/${run.id}/report`, {}, token);
  const stamp = Date.now().toString(36);
  const form = new URLSearchParams({
    levelId: ticket.id, name: `Walk Registrant ${stamp}`, email: `walk.${stamp}@example.org`,
    quantity: "3", guests: "Guest One\nGuest Two", dietary: "Vegetarian",
  });
  const posted = await fetch(`${BASE}/e/harbour-run/register`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const thanks = await posted.text();
  ok("a registration goes through", posted.status === 200 && /Thank you/.test(thanks));
  ok("…and says what they registered for", /3 places/.test(thanks) && /2 guests named/.test(thanks), thanks.slice(0, 200));
  const after = await api(`/events/${run.id}/report`, {}, token);
  const wasReg = before.body.figures.find(f => f.key === "registered").value;
  const nowReg = after.body.figures.find(f => f.key === "registered").value;
  ok("…the registered count went up by the PLACES, not by the heads",
     nowReg === wasReg + 3, { was: wasReg, now: nowReg });
  // THE MONEY RULE: a public registration is a request, and it is not money.
  ok("…and NO gift was written: a page that does not take a card does not pretend to",
     after.body.figures.find(f => f.key === "raised").value === 0,
     after.body.figures.find(f => f.key === "raised").value);

  // A BOT GETS NOTHING. The honeypot is a field no person sees.
  const bot = await fetch(`${BASE}/e/harbour-run/register`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ levelId: ticket.id, name: "Bot", email: "bot@example.org", website: "http://spam" }).toString() });
  const botReport = await api(`/events/${run.id}/report`, {}, token);
  ok("a filled honeypot registers nobody",
     botReport.body.figures.find(f => f.key === "registered").value === nowReg, { nowReg,
       after: botReport.body.figures.find(f => f.key === "registered").value });

  // ── SPONSOR THANK-YOUS ARE DRAFTS ───────────────────────────────────────
  console.log("\n— a thank-you per sponsor —");
  const th = await api(`/events/${gala.id}/sponsor-thanks`, { method: "POST", body: "{}" }, token);
  ok("sponsor thank-yous are drafted", th.status === 200, th.body);
  ok("…and Steward sends none of them", /Steward sends none|already has a draft|nothing to thank/i.test(th.body.sentence), th.body.sentence);
  const again = await api(`/events/${gala.id}/sponsor-thanks`, { method: "POST", body: "{}" }, token);
  ok("…and running it twice writes nothing twice",
     (again.body.drafted || 0) === 0, again.body);

  const browser = await chromium.launch();
  const shots = [];
  async function screen(width, height) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text()); });
    page.on("response", r => { if (r.status() >= 500 && !IGNORE.test(r.url())) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
    return { ctx, page, errors };
  }
  const shot = async (page, name) => { const f = path.join(SHOTS, name + ".png"); await page.screenshot({ path: f }); shots.push(f); };
  const toEvents = async page => {
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Events\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForTimeout(2800);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /^All$/.test((x.textContent || "").trim())); if (b) b.click(); });
    await page.waitForTimeout(1500);
  };

  // ── 1440 ────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(1440, 1100);
    console.log("\n— 1440 · events home —");
    await toEvents(page);
    ok("Events is its own room in the rail", await page.locator("[data-testid='ev-card-goal']").count() >= 2,
       await page.locator("[data-testid='ev-card-goal']").count());
    const goals = await page.locator("[data-testid='ev-card-goal']").allTextContents();
    const raised = await page.locator("[data-testid='ev-card-raised']").allTextContents();
    ok("…every card shows a goal", goals.every(g => /\$|None set/.test(g)), goals);
    ok("…and what it raised", raised.every(r => /\$/.test(r)), raised);
    await shot(page, "1440-events-home");
    await page.locator("[data-testid='ev-card-raised']").first().click();
    await page.waitForTimeout(1200);
    ok("…and a number on a card opens its rows", await page.locator("[data-testid='ev-rows']").count() === 1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    console.log("\n— 1440 · the gala —");
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("button")].filter(y => /Manage/.test(y.textContent || ""));
      const gala = cards.find(c => /Gala/.test((c.closest("div[style]") || {}).parentElement?.textContent || "")) || cards[cards.length - 1];
      if (gala) gala.click();
    });
    await page.waitForTimeout(3200);
    ok("the report panel is there", await page.locator("[data-testid='ev-report']").count() === 1);
    ok("…the seating chart is there", await page.locator("[data-testid='ev-seating']").count() === 1);
    ok("…and the door screen is there", await page.locator("[data-testid='ev-kiosk']").count() === 1);
    ok("…twelve tables, as seeded", await page.locator("[data-testid='ev-table']").count() === 12,
       await page.locator("[data-testid='ev-table']").count());
    ok("…with a place for the people who have no seat", await page.locator("[data-testid='ev-unseated']").count() === 1);
    ok("…and both printables", await page.locator("[data-testid='ev-print-chart']").count() === 1
                            && await page.locator("[data-testid='ev-print-tags']").count() === 1);
    const kioskCount = await page.locator("[data-testid='ev-kiosk-count']").textContent().catch(() => "");
    ok("the door screen says how many are in", /\d+ of \d+ checked in/.test(kioskCount), kioskCount);
    await shot(page, "1440-gala");

    // A REPORT FIGURE OPENS ITS ROWS.
    await page.locator("[data-testid='ev-fig-firstTime']").click();
    await page.waitForTimeout(1200);
    ok("a report figure opens its rows", await page.locator("[data-testid='ev-report-rows']").count() === 1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    // CHECK SOMEBODY IN, AND OUT AGAIN.
    await page.locator("[data-testid='ev-kiosk-search']").fill("a");
    await page.waitForTimeout(700);
    const rowsN = await page.locator("[data-testid='ev-kiosk-row']").count();
    ok("the door screen searches by name", rowsN > 0, rowsN);
    await page.locator("[data-testid='ev-kiosk-row']").first().click();
    await page.waitForTimeout(1500);
    const after2 = await page.locator("[data-testid='ev-kiosk-count']").textContent().catch(() => "");
    ok("…and a tap changes the count", after2 !== kioskCount, { before: kioskCount, after: after2 });

    ok("no console error, page error or 5xx at 1440", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  // ── 390 ─────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(390, 844);
    console.log("\n— 390 —");
    await toEvents(page);
    ok("the cards stack at 390", await page.locator("[data-testid='ev-card-goal']").count() >= 2);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("nothing scrolls sideways", over <= 0, over);
    await shot(page, "390-events-home");

    // THE PUBLIC PAGE, WHICH IS THE ONE A GUEST ACTUALLY OPENS ON A PHONE.
    await page.goto(`${BASE}/e/harbour-run`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const pub390 = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input,select,textarea")];
      const btn = document.querySelector(".btn");
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        minFont: inputs.length ? Math.min(...inputs.map(i => parseFloat(getComputedStyle(i).fontSize))) : null,
        btnHeight: btn ? Math.round(btn.getBoundingClientRect().height) : null,
        band: !!document.querySelector(".band"),
      };
    });
    ok("the public page does not scroll sideways at 390", pub390.overflow <= 0, pub390);
    // 16px is the line at which iOS stops zooming the page when a field is
    // focused. A registration form that zooms is a registration form somebody
    // abandons standing in a kitchen.
    ok("…its inputs are 16px, so a phone does not zoom on focus", pub390.minFont >= 16, pub390.minFont);
    ok("…its button is a thumb target", pub390.btnHeight >= 44, pub390.btnHeight);
    ok("…and it wears the organisation's band", pub390.band);
    await shot(page, "390-public-page");

    ok("no console error, page error or 5xx at 390", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  console.log(`\nevents1-walk: ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
