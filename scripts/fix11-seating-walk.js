// FIX-11 Part 2 verification walk — TABLES YOU CAN ACTUALLY ADD.
//
// Part 2 is almost entirely a screen, so this walk is the verification that
// matters. It covers the three states the card can be in (no guests, guests
// and no tables, a real chart), seating by tap on a phone, and the two Print
// buttons saying why they are off.
//
//   APP=http://localhost:4283 API=http://localhost:5811 node scripts/fix11-seating-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const { chromium } = require(path.join(process.env.HOME, "steward-qa", "node_modules", "playwright"));
const APP = process.env.APP || "http://localhost:4283";
const API = process.env.API || "http://localhost:5811";
let failures = 0;
const ok = (l, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + l + (c ? "" : " — " + String(JSON.stringify(d) ?? "").slice(0, 320))); if (!c) failures++; };

(async () => {
  const EMAIL = `seatwalk${Date.now()}@example.org`;
  const api = async (p, o = {}, tok) => {
    const r = await fetch(API + p, { ...o, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(o.headers || {}) } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
    return { status: r.status, body: b };
  };
  const reg = await api("/auth/register", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "Testpass123!", orgName: "Seating Walk", name: "Dana Reyes" }) });
  const tok = reg.body.token;
  await api("/onboarding/complete", { method: "POST", body: "{}" }, tok);
  const org = (await api("/org", {}, tok)).body;
  const ev = await api("/events", { method: "POST", body: JSON.stringify({ name: "Harbor Lights Gala", eventType: "gala", date: "2026-11-14" }) }, tok);
  const eventId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  ok("an event was created for the walk", !!eventId, { status: ev.status, body: JSON.stringify(ev.body).slice(0, 200) });
  if (!eventId) return process.exit(1);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.googleapis|_vercel|ai\/stream/.test(m.location()?.url || "")) errs.push(m.text().slice(0, 120)); });
  page.on("response", r => { if (r.status() >= 500 && !/ai\/stream/.test(r.url())) errs.push(r.status() + " " + r.url()); });

  const signIn = async p => {
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.evaluate(([t, u, o]) => {
      localStorage.setItem("npe_token", t);
      localStorage.setItem("npe_user", JSON.stringify(u));
      localStorage.setItem("npe_org", JSON.stringify(o));
    }, [tok, reg.body.user, org && org.id ? org : { ...reg.body.org, onboarding_complete: 1 }]);
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".app-root", { timeout: 25000 });
    const go = await p.$('[data-testid="first-run-go"]');
    if (go) { await go.click(); await p.waitForTimeout(700); }
    const later = p.locator('button').filter({ hasText: /I'll finish later/ }).first();
    if (await later.count()) { await later.click().catch(() => {}); await p.waitForTimeout(500); }
    await p.waitForTimeout(900);
  };
  await signIn(page);

  // NAVIGATE THE WAY A PERSON DOES. Going to /events by URL lands on Home —
  // the shell routes in-app from the rail (and from the More drawer at 390),
  // which is older than this build and is why nav1-walk does the same.
  const goToEvents = async p => {
    const side = p.locator('.app-sidebar [data-nav-id="events"]').first();
    if (await side.count() && await side.isVisible()) { await side.click(); await p.waitForTimeout(1600); return; }
    const more = p.locator(".mobile-bottom-bar button:last-child");
    if (await more.count()) { await more.click(); await p.waitForTimeout(800); }
    const item = p.locator('.mobile-more-drawer [data-nav-id="events"]').first();
    if (await item.count()) { await item.click(); await p.waitForTimeout(1600); }
  };
  const openEvent = async p => {
    // Reload the shell first: the event detail is an overlay, so a second
    // visit has to get out of the one already open before the rail is
    // clickable again.
    await p.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".app-root", { timeout: 25000 });
    const go2 = await p.$('[data-testid="first-run-go"]');
    if (go2) { await go2.click(); await p.waitForTimeout(500); }
    const later2 = p.locator('button').filter({ hasText: /I'll finish later/ }).first();
    if (await later2.count()) { await later2.click().catch(() => {}); await p.waitForTimeout(400); }
    await goToEvents(p);
    await p.waitForTimeout(1200);
    // The card opens from its "Manage" button, not from the title.
    const manage = p.locator('button, a').filter({ hasText: /^Manage/ }).first();
    if (await manage.count()) { await manage.click(); await p.waitForTimeout(600); }
    try { await p.waitForSelector('[data-testid="ev-seating"]', { timeout: 15000 }); } catch { /* reported below */ }
    await p.waitForTimeout(800);
    return (await p.locator('[data-testid="ev-seating"]').count()) > 0;
  };
  ok("the event detail opens with the seating card on it", await openEvent(page));

  // ── STATE 1 · no guests ────────────────────────────────────────────────
  const s = page.locator('[data-testid="ev-seating"]');
  let txt = await s.innerText();
  ok("with no guests it says so, and what guests come from",
    /No guests yet/.test(txt) && /register or you add them/.test(txt), { txt: txt.slice(0, 240) });
  ok("…and offers Add a guest", await page.locator('[data-testid="ev-add-guest"]').count() > 0);
  ok("…and does not talk about dragging a name onto a table there is none of",
    !/Drag a name onto a table/.test(txt), { txt: txt.slice(0, 200) });

  // ── STATE 2 · guests, no tables ────────────────────────────────────────
  const names = ["Jon Halloran", "Ada Petrossian", "Ben Okafor", "Cho Lin", "Dee Marchetti",
                 "Esi Mensah", "Finn Doyle", "Gita Rao", "Hal Byrne", "Iris Nakamura",
                 "Jo Fenwick", "Kai Oduya"];
  for (const n of names) {
    await api(`/events/${eventId}/attendees`, { method: "POST", body: JSON.stringify({ name: n }) }, tok);
  }
  const listed = (await api(`/events/${eventId}/guests`, {}, tok)).body.guests || [];
  const byName = new Map(listed.map(g => [g.name, g.id]));
  ok("twelve guests were added through the API", listed.length === 12, { got: listed.length });
  // Jon brings three, so there is a real party of four on the screen.
  for (const n of ["Ada Petrossian", "Ben Okafor", "Cho Lin"]) {
    const r = await api(`/events/${eventId}/attendees/${byName.get(n)}`, { method: "PATCH", body: JSON.stringify({ guestOf: byName.get("Jon Halloran") }) }, tok);
    if (r.status >= 300) ok(`${n} joined Jon's party`, false, { status: r.status, body: r.body });
  }
  await openEvent(page);
  txt = await page.locator('[data-testid="ev-seating"]').innerText();
  ok("with guests and no tables it counts the guests and says there are no tables",
    /12 guests and no tables yet/.test(txt), { txt: txt.slice(0, 240) });
  ok("…and offers Add tables, how many and seats each",
    await page.locator('[data-testid="ev-tables-count"]').count() > 0
    && await page.locator('[data-testid="ev-tables-seats"]').count() > 0
    && await page.locator('[data-testid="ev-tables-add"]').count() > 0);
  const defCount = await page.locator('[data-testid="ev-tables-count"]').inputValue();
  const defSeats = await page.locator('[data-testid="ev-tables-seats"]').inputValue();
  ok("…defaulting to ten tables of eight", defCount === "10" && defSeats === "8", { defCount, defSeats });

  // ── Add tables, in the browser ─────────────────────────────────────────
  await page.locator('[data-testid="ev-tables-count"]').fill("3");
  await page.locator('[data-testid="ev-tables-seats"]').fill("4");
  await page.locator('[data-testid="ev-tables-add"]').click();
  await page.waitForTimeout(2000);
  const tableCards = await page.locator('[data-testid="ev-table"]').count();
  ok("three tables appear on the chart", tableCards === 3, { tableCards });
  const heads = await page.locator('[data-testid="ev-table-head"]').allInnerTexts();
  ok("…each reading 'Table n · 0 of 4'", heads.every(h => /· 0 of 4$/.test(h.trim())), { heads });

  // ── STATE 3 · seat by tap ──────────────────────────────────────────────
  const chip = page.locator('[data-testid="ev-guest"]').filter({ hasText: "Jon Halloran" }).first();
  ok("every guest is a tappable control, not only a draggable one", await chip.count() > 0);
  await chip.click();
  await page.waitForTimeout(700);
  const bar = await page.locator('[data-testid="ev-seat-bar"]').innerText().catch(() => "");
  ok("picking Jon picks his whole party", /4 guests picked/.test(bar) && /party moves together/.test(bar), { bar });
  await page.locator('[data-testid="ev-seat-at"]').click();
  await page.waitForTimeout(600);
  const menu = await page.locator('[data-testid="ev-seat-menu"]').innerText();
  ok("…and Seat at lists the tables with room, with how many seats are open",
    /Table 1 · 4 open/.test(menu), { menu });
  await page.locator('[data-testid="ev-seat-menu"] [role="menuitem"]').first().click();
  await page.waitForTimeout(2000);
  const heads2 = await page.locator('[data-testid="ev-table-head"]').allInnerTexts();
  ok("the party is seated together and the table reads 4 of 4",
    heads2.some(h => /· 4 of 4$/.test(h.trim())), { heads2 });
  const fullMark = await page.locator('[data-testid="ev-table"][data-table-full="1"]').count();
  ok("…and the full table is marked", fullMark === 1, { fullMark });

  // a party that does not fit
  const chip2 = page.locator('[data-testid="ev-guest"]').filter({ hasText: "Dee Marchetti" }).first();
  await chip2.click(); await page.waitForTimeout(500);
  const chip3 = page.locator('[data-testid="ev-guest"]').filter({ hasText: "Esi Mensah" }).first();
  await chip3.click(); await page.waitForTimeout(500);
  await page.locator('[data-testid="ev-seat-at"]').click(); await page.waitForTimeout(500);
  const menu2 = await page.locator('[data-testid="ev-seat-menu"]').innerText();
  ok("a full table is not offered as a place to sit", !/Table 1 ·/.test(menu2), { menu2 });
  await page.locator('[data-testid="ev-seat-menu"] [role="menuitem"]').first().click();
  await page.waitForTimeout(1800);

  // ── Seat everyone, as a plan ───────────────────────────────────────────
  await page.locator('[data-testid="ev-seat-everyone"]').click();
  await page.waitForTimeout(1800);
  const planTxt = await page.locator('[data-testid="ev-plan"]').innerText().catch(() => "");
  ok("Seat everyone shows a plan before it touches anything",
    /would be seated/.test(planTxt), { planTxt: planTxt.slice(0, 260) });
  ok("…naming who goes where", / to Table /.test(planTxt), { planTxt: planTxt.slice(0, 200) });
  const beforeApply = await page.locator('[data-testid="ev-seating-sentence"]').innerText();
  await page.locator('[data-testid="ev-plan-apply"]').click();
  await page.waitForTimeout(2200);
  const afterApply = await page.locator('[data-testid="ev-seating-sentence"]').innerText();
  ok("…and applying it changes the chart", beforeApply !== afterApply, { beforeApply, afterApply });
  const undoBtn = page.locator('[data-testid="ev-undo"]');
  ok("…with an undo offered", await undoBtn.count() > 0);
  if (await undoBtn.count()) {
    await undoBtn.click(); await page.waitForTimeout(2200);
    const back = await page.locator('[data-testid="ev-seating-sentence"]').innerText();
    ok("…and the undo puts the chart back", back === beforeApply, { back, beforeApply });
  }

  // ── Editing a table in place ───────────────────────────────────────────
  await page.locator('[aria-label^="Edit Table 1"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('input[aria-label="Table name"]').first().fill("Sponsor table, Smith Co.");
  await page.locator('[data-testid="ev-table"] button').filter({ hasText: /^Save$/ }).first().click();
  await page.waitForTimeout(1800);
  const heads3 = await page.locator('[data-testid="ev-table-head"]').allInnerTexts();
  ok("a table can be renamed in place", heads3.some(h => /^Sponsor table, Smith Co\. ·/.test(h.trim())), { heads3 });

  // ── The Print buttons ──────────────────────────────────────────────────
  const chartBtn = page.locator('[data-testid="ev-print-chart"]');
  ok("with a real chart, Print the chart is enabled", !(await chartBtn.isDisabled()));
  // Strip the chart back to nothing seated and check the reason is shown.
  const all = await api(`/events/${eventId}/guests`, {}, tok);
  await api(`/events/${eventId}/seat`, { method: "POST", body: JSON.stringify({ moves: (all.body.guests || []).map(g => ({ attendeeId: g.id, table: "" })), withParty: false }) }, tok);
  await openEvent(page);
  await page.waitForTimeout(1200);
  const chartBtn2 = page.locator('[data-testid="ev-print-chart"]');
  ok("with nobody seated, Print the chart is off", await chartBtn2.isDisabled());
  const why = await page.locator('[data-testid="ev-print-why"]').innerText().catch(() => "");
  ok("…and it says why rather than printing a blank page",
    /Nobody has a seat yet/.test(why), { why });
  ok("…while Print name tags stays on, because there are guests to label",
    !(await page.locator('[data-testid="ev-print-tags"]').isDisabled()));

  ok("no console errors or 5xx on the seating screen", errs.length === 0, { errs: errs.slice(0, 4) });

  // ── 390 ────────────────────────────────────────────────────────────────
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await signIn(phone);
  await openEvent(phone);
  await phone.waitForTimeout(1200);
  const pChip = phone.locator('[data-testid="ev-guest"]').first();
  ok("at 390 a guest is still tappable", await pChip.count() > 0);
  if (await pChip.count()) {
    await pChip.click(); await phone.waitForTimeout(700);
    ok("…and Seat at is reachable with no drag anywhere in it",
      await phone.locator('[data-testid="ev-seat-at"]').count() > 0);
    await phone.locator('[data-testid="ev-seat-at"]').click(); await phone.waitForTimeout(600);
    const m = await phone.locator('[data-testid="ev-seat-menu"]').innerText().catch(() => "");
    ok("…listing tables with room", /open/.test(m), { m: m.slice(0, 160) });
    await phone.locator('[data-testid="ev-seat-menu"] [role="menuitem"]').first().click();
    await phone.waitForTimeout(1800);
    const ph = await phone.locator('[data-testid="ev-table-head"]').allInnerTexts();
    ok("…and the guest is seated from the phone", ph.some(h => /· [1-9]\d* of /.test(h.trim())), { ph });
  }
  const hScroll = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok("no horizontal scroll at 390", !hScroll);

  await browser.close();
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
