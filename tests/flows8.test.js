// tests/flows8.test.js — FLOWS-8. THINGS THAT DIDN'T WORK, OR DIDN'T SAY WHY (staging, 12 Nov).
//
// One org shaped like the fleet's findings (tests/lib/flows8Fixture.js), one
// check per item, the screens on the built client with real clicks:
//   §17  Add meeting with the name typed and not picked: it saves, or says what
//        is missing in the dialog; never a dead button (W-1112-Volunteers-17)
//   §21  a guest's status save that never answers stops "Saving…", says so and
//        shows what is saved; Attended → Declined saves and the counts move (W-1112-Volunteers-21)
//   §20  the guest picker finds a never-given contact by the Donors list's
//        person search; Add guest warns on a name already on file (W-1112-Volunteers-20)
//   §35  a page that can't take gifts says why in its editor, with Connect
//        Stripe; its public address stays "not open yet" (W-1112-Fundraising-35)
//   §11X an empty Top 100 offers your top donors by lifetime, added on a press (W-1112-Fundraising-11X)
//   §FR21 no "none" line above a sequence; an empty step is Not ready and
//        the sequence can't be turned on (W-1112-Fundraising-21)
//   §34X a group frozen from LYBUNT says how many have changed since, and
//        refreshes to today's list (W-1112-Volunteers-34X)
//   §01X after marking Attended, After the event never paints the old count (W-1112-Volunteers-01X)
//   §35X the two sample photos' alt text describes them (W-1112-Fundraising-35X)
//
// HOW IT GOES RED (planted, see the PR): the meeting save swallowing its
// refusal (§17), the guest picker searching donors only (§20), a frozen report
// group with no drift line (§34X), and a stale first count after Attended (§01X).
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip, civilPlusDays } = require("./helpers");
const { buildFlows8Org } = require("./lib/flows8Fixture");

const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = iso => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

(async () => {
  console.log("flows8 (FLOWS-8)");
  const f = await buildFlows8Org();
  const tok = f.token, ids = f.ids;

  // ── §20 the picker's person search, from the API ─────────────────────────
  const pick = (await api("GET", `/donors/pick?q=${encodeURIComponent("zoe angstrom")}&match=person&limit=20`, tok)).body || [];
  ok("§20 the guest picker's search finds Zoë Ångström, a contact who never gave, typed without accents",
    Array.isArray(pick) && pick.some(p => p.id === ids.zoe), pick.map(p => p.name));

  // ── §35 a page that can't take gifts says why ────────────────────────────
  const meta = (await api("GET", `/giving-pages/${f.pageId}/page`, tok)).body || {};
  ok("§35 the editor is told the page can't take gifts, and why: Connect Stripe",
    meta.takesGifts === false && /^Connect Stripe to take gifts on this page\./.test(meta.notTakingWhy || ""), { takesGifts: meta.takesGifts, why: meta.notTakingWhy });
  const pub = await api("GET", `/org/${f.org}/giving-page/${f.pageSlug}/public`, null);
  ok("§35 its public address stays the polite not-open-yet page for donors",
    pub.status === 404 && pub.body && pub.body.notOpen === true && /isn't open yet\. Please check back soon\./.test(pub.body.error || ""), pub.body);

  // ── §11X an empty Top 100 offers a start ─────────────────────────────────
  const sug = await api("GET", "/top100/suggested?limit=25", tok);
  const sids = ((sug.body || {}).people || []).map(p => p.id);
  ok("§11X an empty Top 100 offers the top donors by lifetime, in order ($2,400, $1,500, $600), adding nobody",
    sug.status === 200 && sids.slice(0, 3).join() === [ids.wren, ids.odo, ids.ines].join() && !sids.includes(ids.zoe)
      && ((await api("GET", "/top100", tok)).body || {}).count === 0, sug.body);
  const add100 = await api("POST", "/top100/members", tok, { donorIds: sids.slice(0, 2) });
  const after100 = await api("GET", "/top100/suggested?limit=25", tok);
  ok("§11X a press adds them, and the offer then leaves out who is on the list",
    add100.status === 201 && add100.body.added === 2 && !((after100.body || {}).people || []).some(p => sids.slice(0, 2).includes(p.id)), { add: add100.body });

  // ── §FR21 sequences ──────────────────────────────────────────────────────
  const SE = await import(path.join(ROOT, "client/src/lib/sequencesEmpty.js"));
  const seqs = (await api("GET", "/sequences", tok)).body || [];
  const mine = seqs.find(s => s.id === f.seqId) || {};
  const resume = await api("PATCH", `/sequences/${f.seqId}/status`, tok, { status: "active" });
  ok("§FR21 with one sequence, no 'none' line; its empty step reads Not ready, and Resume is refused",
    SE.sequencesEmptyLine([], seqs) === null && SE.sequencesEmptyLine([], []) === "No sequences yet."
      && /step 1 has no words yet/.test(mine.not_ready || "") && resume.status === 409, { line: SE.sequencesEmptyLine([], seqs), notReady: mine.not_ready, resume: resume.status });

  // ── §34X a group frozen from LYBUNT ──────────────────────────────────────
  const lyb = (await api("GET", "/reports/lybunt", tok)).body || {};
  const lybIds = (lyb.rows || []).map(r => r.id);
  const g = await api("POST", "/groups", tok, { name: "LYBUNT frozen", kind: "static", fromReport: "lybunt" });
  await api("POST", `/groups/${g.body.id}/members`, tok, { donorIds: lybIds });
  const today = civilPlusDays(0);
  const d0 = ((await api("GET", `/groups/${g.body.id}`, tok)).body || {}).drift;
  ok("§34X frozen today: 'Saved from LYBUNT on <today> · nobody has changed since'",
    lybIds.length === 3 && !!d0 && d0.changed === 0 && d0.sentence === `Saved from LYBUNT on ${short(today)} · nobody has changed since`, { lybIds, d0 });
  await api("POST", `/donors/${ids.odo}/gifts`, tok, { amount: 50, date: today, payment_method: "check" });
  const d1 = ((await api("GET", `/groups/${g.body.id}`, tok)).body || {}).drift;
  ok("§34X Odo gives this year: '1 person has changed since', and the page offers the refresh",
    !!d1 && d1.changed === 1 && d1.left === 1 && /· 1 person has changed since$/.test(d1.sentence), d1);
  const rf = await api("POST", `/groups/${g.body.id}/refresh-from-report`, tok, {});
  const d2 = ((await api("GET", `/groups/${g.body.id}`, tok)).body || {}).drift;
  ok("§34X the refresh makes it LYBUNT today: Odo out, nobody changed since",
    rf.status === 200 && rf.body.removed === 1 && !!d2 && d2.changed === 0, { rf: rf.body, d2 });
  const kept = await api("POST", "/groups", tok, { name: "LYBUNT kept", kind: "dynamic", rules: { bunt: "lybunt" } });
  const keptPeople = ((await api("GET", `/groups/${kept.body.id}`, tok)).body || {}).members || [];
  ok("§34X Keep updating is LYBUNT's own rule: the same people as the report now, no drift line",
    keptPeople.map(p => p.id).sort().join() === [ids.wren, ids.ines].sort().join(), keptPeople.map(p => p.name));

  // ── §35X the two photos' alt text ────────────────────────────────────────
  const SP = await import(path.join(ROOT, "shared/stockPhotos.js"));
  const alt = id => (SP.STOCK_PHOTOS.find(p => p.id === id) || {}).alt;
  const lic = fs.readFileSync(path.join(ROOT, "assets/stock/LICENSES.md"), "utf8");
  ok("§35X the two kids photos say what they show, in the catalog and in LICENSES.md",
    alt("kids-running-in-spring") === "A child in a lilac coat leaping off a rock onto the grass"
      && alt("kids-friends-in-tall-grass") === "Two small children seen from behind under green trees"
      && !/A child running through a sunny field|Three young children together in tall grass/.test(lic), { a: alt("kids-running-in-spring"), b: alt("kids-friends-in-tall-grass") });

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
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools|Failed to fetch|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const shot = n => process.env.FLOWS8_SHOTS ? page.screenshot({ path: path.join(process.env.FLOWS8_SHOTS, n + ".png"), fullPage: true }) : null;
    const step = async (name, fn) => { try { await fn(); } catch (e) { await shot(name + "-fail"); ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };
    const eventPage = async () => { await page.goto(`${APP}/app/events?eventId=${f.eventId}`, { waitUntil: "networkidle", timeout: 60000 }); await page.locator('[data-testid="ev-report"]').first().waitFor({ timeout: 20000 }); };

    await step("§17", async () => {
      await page.goto(`${APP}/app/calendar`, { waitUntil: "networkidle", timeout: 60000 });
      await page.locator('[data-testid="cal-add-meeting"]').click({ timeout: 15000 });
      const form = page.locator('[data-testid="cal-quick-form"]');
      // A part of a name, nobody picked: Add says what is missing, in the dialog.
      await page.locator('[data-testid="cal-donor-search"]').fill("Ines Qu");
      await page.waitForTimeout(900);
      await form.getByRole("button", { name: "Add", exact: true }).click({ timeout: 8000 });
      const said = (await form.locator('[data-testid="cal-quick-why"]').textContent({ timeout: 4000 }).catch(() => "")) || "";
      // The whole name typed, still not picked: it is that person, and it saves.
      await page.locator('[data-testid="cal-donor-search"]').fill("Ines Quarry");
      await page.waitForTimeout(1200);
      await form.getByRole("button", { name: "Add", exact: true }).click({ timeout: 8000 });
      await page.waitForTimeout(2000);
      const open = await form.count();
      const booked = await q(`SELECT id FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids)`, [f.org, ids.ines]);
      ok("§17 Add with a name half typed says to pick who it is with; with the whole name it saves, closes, and the meeting is on her record",
        /^Pick who the meeting is with/.test(said) && open === 0 && booked.length === 1, { said, open, booked: booked.length });
      await shot("s17");
    });

    await step("§20", async () => {
      await eventPage();
      await page.getByRole("button", { name: "From Directory" }).click();
      await page.locator('[data-testid="ev-dir-search"]').fill("zoe angstrom");
      await page.waitForTimeout(1500);
      const found = await page.locator("button", { hasText: "Zoë Ångström" }).count();
      await page.getByRole("button", { name: "Add Guest" }).click();
      await page.getByPlaceholder("Guest name *").fill("Zoë Ångström");
      await page.getByRole("button", { name: /Add Guest →/ }).click();
      const asked = await page.locator('[data-testid="confirm-yes"]').textContent({ timeout: 5000 }).catch(() => "");
      await page.getByRole("button", { name: "Find them in the directory" }).click().catch(() => {});
      await page.waitForTimeout(600);
      const guests = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND name='Zoë Ångström' AND deleted_at IS NULL`, [f.org]);
      ok("§20 From Directory finds Zoë (never gave) without her accents; Add guest with her exact name asks first and makes no second Zoë",
        found >= 1 && asked === "Add a new person" && guests[0].n === 1, { found, asked, zoes: guests[0].n });
      await shot("s20");
    });

    await step("§01X", async () => {
      await eventPage();
      // Hold every re-read of After the event for 2.5 s once Attended has been pressed.
      let hold = false;
      await page.route(`**/events/${f.eventId}/report`, async r => { if (hold) await new Promise(res => setTimeout(res, 2500)); await r.continue(); });
      const came0 = (await page.locator('[data-testid="ev-report"]').innerText()).replace(/\s+/g, " ");
      await page.getByRole("button", { name: /Confirmed/ }).first().click();
      hold = true;
      const patched = page.waitForResponse(x => x.request().method() === "PATCH" && /\/attendees\//.test(x.url()), { timeout: 15000 });
      await page.locator("select").filter({ has: page.locator("option", { hasText: "Attended" }) }).first().selectOption("attended");
      await patched; await page.waitForTimeout(150);
      const updating = await page.locator('[data-testid="ev-report-updating"]').count();
      const tilesNow = await page.locator('[data-testid="ev-report-tiles"]').count();
      await page.waitForTimeout(3500);
      const landed = await page.locator('[data-testid="ev-report-tiles"]').count();
      await page.unroute(`**/events/${f.eventId}/report`);
      ok("§01X right after Attended, After the event says it is updating instead of painting the count from before; then the new counts land",
        updating === 1 && tilesNow === 0 && landed === 1, { updating, tilesNow, landed, before: came0.slice(0, 120) });
      await shot("s01x");
    });

    await step("§21", async () => {
      await eventPage();
      // The connection drops after the preflight: the PATCH never answers.
      await page.route(/\/attendees\/[^/]+$/, r => (r.request().method() === "PATCH" ? new Promise(() => {}) : r.continue()));
      await page.getByRole("button", { name: /Attended/ }).first().click();
      await page.locator("select").filter({ has: page.locator("option", { hasText: "Declined" }) }).first().selectOption("declined");
      await page.waitForTimeout(21500);
      const saving = await page.getByText("Saving…", { exact: true }).count();
      const said = (await page.locator('[data-testid="ev-action-error"]').textContent().catch(() => "")) || "";
      await page.unroute(/\/attendees\/[^/]+$/);
      ok("§21 a status save that never answers stops saying Saving…, says Steward didn't hear back, and the row shows what is saved",
        saving === 0 && /didn't hear back within 20 seconds/.test(said), { saving, said });
      // And with an answer: Attended → Declined saves, and the counts move.
      await page.getByRole("button", { name: /Attended/ }).first().click();
      await page.locator("select").filter({ has: page.locator("option", { hasText: "Declined" }) }).first().selectOption("declined");
      await page.waitForTimeout(2000);
      const row = await q(`SELECT status FROM event_attendees WHERE id=$1`, [f.attId]);
      const rep = (await api("GET", `/events/${f.eventId}/report`, tok)).body || {};
      const came = (rep.figures || []).find(x => x.key === "attended") || {};
      ok("§21 Attended → Declined saves, and Came goes back to 0", row[0].status === "declined" && Number(came.value) === 0, { status: row[0].status, came: came.value });
    });

    ok("no console errors or 5xx on the walk", errors.length === 0, errors.slice(0, 5));
    await browser.close();
  }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
