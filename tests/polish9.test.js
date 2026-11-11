// tests/polish9.test.js: POLISH-9. WHAT DONORS AND BOARDS SEE READS RIGHT.
// Guards donor-facing words (the charity's public name on Stripe Checkout),
// email (who changed what sends; the no-gift sentence for an audience with
// non-donors) and money on screen (amounts never cut, the first number after
// a save). One made-up org (tests/lib/polish9Fixture.js), one check per fleet
// item, by real clicks on a production build:
//   §1 W-1110-Fundraising-02X  Checkout's line reads the public name, never "(Demo)"
//   §2 W-1107-Fundraising-05   the Board names its periods from periodLabel.js
//   §3 W-1109-Fundraising-03   Board amounts are whole at 390 to 1920 (guard; not reproduced, OPEN)
//   §4 W-1108-Atlas-11X        a draft from an older template says so and takes its timing
//   §5 W-1109-Atlas-13X        a Sep 30 import from before the checks reads so, with Archive
//   §6 W-1107-Fundraising-17   Preview as finds a never-giver; a mixed audience gets the no-gift line
//   §7 W-1107-Fundraising-20   the email line names the latest change, from the audit log
//   §8 W-1107-Finance-04X      after a gift edit the header shows the new number at once
// PLANTED DEFECTS (the brief's): Checkout reads the internal name (§1 red), and
// the finder leaves out people who never gave (§6 red).
// Tests set their own clock (the fixture's days are relative). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");
const F = require("./lib/polish9Fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const BASE = process.env.BASE || "http://localhost:5601";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const STRIPE_PORT = Number(process.env.STRIPE_MOCK_PORT || 5603);
const optional = f => { try { return require(f); } catch { return null; } };
const ROOT = path.join(__dirname, "..");
const ONLY = (process.env.P9_ONLY || "").split(",").filter(Boolean);
const leg = k => !ONLY.length || ONLY.includes(k);

// Stripe's stand-in on this shard's port: it keeps every Checkout session it is asked for.
const sessions = [];
function stripeStandIn() {
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
        sessions.push(Object.fromEntries(new URLSearchParams(b)));
        return res.end(JSON.stringify({ id: "cs_p9_" + sessions.length, object: "checkout.session", url: APP + "/give-checkout-stand-in" }));
      }
      if (req.url.startsWith("/v1/customers")) return res.end(JSON.stringify({ id: "cus_p9", object: "customer" }));
      if (req.url.startsWith("/v1/accounts")) return res.end(JSON.stringify({ id: "acct_p9_test", object: "account", charges_enabled: true, capabilities: { card_payments: "active" } }));
      res.end(JSON.stringify({ object: "list", data: [] }));
    });
  });
  return new Promise(r => srv.listen(STRIPE_PORT, () => r(srv))).catch(() => null);
}

(async () => {
  const fx = await F.build();
  const { tok, lg, D } = fx;

  // ── the rules, read by the screens ────────────────────────────────────────
  const CN = require("../server/give/checkoutName");
  ok("§1 the Checkout line is built from the public name and the fund's public name",
    typeof CN.donationProductName === "function"
    && CN.donationProductName({ orgPublic: F.PUBLIC, fund: { name: "Studio Scholarships", public_name: null } }) === `Donation to ${F.PUBLIC} Studio Scholarships`
    && CN.donationProductName({ orgPublic: F.PUBLIC, fund: { name: "SS-RESTRICTED-07", public_name: "Studio Scholarships" } }) === `Donation to ${F.PUBLIC} Studio Scholarships`);
  const PL = require("../server/shared/periodLabel");
  const yn = PL.yearPairNames ? await PL.yearPairNames({ start: "2026-07-01" }, "2026-11-10") : null;
  ok("§2 periodLabel names the year, the one before, and that one to the same day",
    !!yn && yn.cur === "FY 2026–27" && yn.prev === "FY 2025–26" && yn.samePoint === "FY 2025–26 to Nov 10", yn);
  const board = (await api("GET", "/dashboards/board", tok)).body || {};
  const labels = (board.metrics || []).map(m => m.label);
  ok("§2 the Board's labels are its periods, never \"this year\" or \"same point last year\"",
    labels.some(l => /^Giving, FY \d{4}–\d{2}$/.test(l)) && labels.some(l => /^Giving, FY \d{4}–\d{2} to [A-Z][a-z]{2} \d+$/.test(l))
    && !labels.some(l => /this year|same point last year|last year/i.test(l)), labels);
  const OT = optional("../server/outreach/olderTemplate");
  const J = await import(path.join(ROOT, "shared/journeyShape.js"));
  const [draftRow] = await q(`SELECT * FROM cultivation_templates WHERE id='ct_p9_newdonor'`);
  ok("§4 the draft copied before FIX-4 is \"made from an older version\"; its own sentence is its own steps",
    !!OT && !!OT.olderTemplateOf(draftRow, J.PRESETS) && /7 touches over 7 months/.test(J.touchesSentence(draftRow.steps)) && /7 touches over 12 months/.test(J.touchesSentence(J.PRESETS[0].steps)));
  const imps = ((await api("GET", "/imports", tok)).body || {}).imports || [];
  const sep = imps.find(r => r.id === "imp_p9_sep30") || {};
  ok("§5 the Sep 30 import reads \"Before Steward checked imports (Sep 30)\", not a finding",
    sep.beforeChecks === "Before Steward checked imports (Sep 30)" && sep.reconciled === true && (sep.findings || []).length === 0, sep);
  const pick = (((await api("GET", "/donors/pick?q=jonathan%20a&match=name&limit=5&gave=0", tok)).body) || []).map(r => r.name);
  ok("§6 the finder's never-given half finds Jonathan Ashgrove (a contact, never gave) past nine givers", pick.includes("Jonathan Ashgrove"), pick);
  const GS = await import(path.join(ROOT, "shared/giftSentence.js"));
  const line = "We are asking the people who have given before to go first.";
  ok("§6 a giver in an audience with non-donors reads the no-gift line; alone, the giver's own",
    !/given before/.test(GS.withoutMissingGift(line, { hasGift: true, audienceNoGift: true })) && /given before/.test(GS.withoutMissingGift(line, { hasGift: true })));
  const seg = (await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "everyone" } })).body || {};
  ok("§6 the audience preview says it holds someone who never gave", seg.audienceNoGift === true, { count: seg.count, audienceNoGift: seg.audienceNoGift });

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  const stripe = await stripeStandIn();
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const signedIn = async (viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport, timezoneId: "America/New_York" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    return ctx;
  };
  const ctx = await signedIn();
  const page = await ctx.newPage();
  const open = p => page.goto(APP + p, { waitUntil: "networkidle", timeout: 60000 });
  const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} (browser) ran`, false, String(e && e.message || e).slice(0, 300)); } };
  try {
    if (leg("1")) await step("§1", async () => {
      ok("§1 fixture: Stripe's stand-in is listening", !!stripe);
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const p = await c.newPage();
      await p.goto(`${APP}/give/${F.SLUG}`, { waitUntil: "networkidle", timeout: 60000 });
      await p.getByRole("button", { name: "One-time", exact: true }).click();
      await p.locator("select").first().selectOption(F.FUND);
      await p.getByPlaceholder(/Custom .*amount/).first().fill("40");
      await p.getByPlaceholder("First name").fill("Nell");
      await p.getByPlaceholder("Last name").fill("Ostrowe");
      await p.getByPlaceholder("Email address").fill("nell.ostrowe@polish9.example.org");
      const before = sessions.length;
      await p.locator('button[type="submit"]').first().click();
      for (let i = 0; i < 40 && sessions.length === before; i++) await p.waitForTimeout(250);
      const s = sessions[sessions.length - 1] || {};
      const lineName = s["line_items[0][price_data][product_data][name]"] || "";
      ok("§1 (browser) a donor's Checkout line names the public name and the fund, never \"(Demo)\"",
        lineName === `Donation to ${F.PUBLIC} Studio Scholarships` && !/\(Demo\)/.test(JSON.stringify(s)), { lineName, display: s["branding_settings[display_name]"] });
      ok("§1 (browser) and the Checkout page's name is the public name", s["branding_settings[display_name]"] === F.PUBLIC, s["branding_settings[display_name]"]);
      await c.close();
    });

    if (leg("2")) await step("§2", async () => {
      await open("/app/reports?report=dash:board");
      await page.getByText(/ahead of this time last year|behind this time last year|level with/).first().waitFor({ timeout: 30000 });
      const text = await page.evaluate(() => document.body.innerText);
      ok("§2 (browser) the Board reads \"Giving, FY 2026–27\" and \"Giving, FY 2025–26 to …\", and no other name for the year",
        /Giving, FY \d{4}–\d{2}\n/.test(text) && /Giving, FY \d{4}–\d{2} to [A-Z][a-z]{2} \d+/.test(text)
        && !/Giving this year|Same point last year|Change on last year/.test(text), (text.match(/Giving[^\n]{0,60}/g) || []).slice(0, 8));
    });

    if (leg("3")) await step("§3", async () => {
      const cut = [];
      for (const w of [1920, 1440, 1280, 1024, 768, 390]) {
        const c = await signedIn({ width: w, height: 1000 });
        const p = await c.newPage();
        await p.goto(APP + "/app/reports?report=dash:board", { waitUntil: "networkidle", timeout: 60000 });
        await p.getByText("$30,350.50").first().waitFor({ timeout: 20000 }).catch(() => {});
        const r = await p.evaluate(() => [...document.querySelectorAll("button")].filter(b => /^\$/.test(b.innerText.trim())).map(b => {
          const br = b.getBoundingClientRect(); let clip = false;
          for (let a = b.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX)) { const ar = a.getBoundingClientRect(); if (br.right > ar.right + 0.5 || br.left < ar.left - 0.5) clip = true; } }
          return { t: b.innerText.trim(), clip: clip || b.scrollWidth > b.clientWidth + 1 || /…/.test(b.innerText) };
        }));
        cut.push(...r.filter(x => x.clip).map(x => `${w}: ${x.t}`));
        if (!r.some(x => x.t === "$30,350.50")) cut.push(`${w}: $30,350.50 not on screen`);
        await c.close();
      }
      ok("§3 (browser) every Board amount is whole from 390 to 1920 wide, $30,350.50 included", cut.length === 0, cut);
    });

    if (leg("4")) await step("§4", async () => {
      await open("/app/journeys?journey=ct_p9_newdonor");
      const touches = page.locator('[data-testid="jb-touches"]');
      if (!(await touches.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)))
        await page.locator('[data-testid="journey-open-ct_p9_newdonor"]').click({ timeout: 20000 });
      await touches.waitFor({ timeout: 15000 });
      const note = await page.locator('[data-testid="jb-older-template"]').innerText({ timeout: 8000 }).catch(() => "");
      ok("§4 (browser) the draft says it was made from an older version, and the template's twelve months",
        /7 touches over 7 months/.test(await touches.innerText()) && /older version of "New donor, first year"\. The template is now 7 touches over 12 months/.test(note), { note });
      await page.locator('[data-testid="jb-use-template-timing"]').click({ timeout: 8000 });
      ok("§4 (browser) Use its timing makes it 7 touches over 12 months, and the note goes",
        /7 touches over 12 months/.test(await touches.innerText()) && (await page.locator('[data-testid="jb-older-template"]').count()) === 0);
    });

    if (leg("5")) await step("§5", async () => {
      await open("/app/settings?section=imports");
      const row = page.locator('[data-testid="imports-row"]').filter({ hasText: "harbor-gifts-sept.csv" });
      const t = await row.innerText({ timeout: 20000 });
      ok("§5 (browser) the Sep 30 import reads \"Before Steward checked imports (Sep 30)\", not \"Does not reconcile\"",
        /Before Steward checked imports \(Sep 30\)/.test(t) && !/Does not reconcile/.test(t), t.slice(0, 200));
      await row.locator('[data-testid="imports-open"]').click();
      const rc = await page.locator('[data-testid="import-receipt"]').innerText({ timeout: 10000 });
      ok("§5 (browser) its receipt says so too, and no \"does not reconcile\" or \"= 0\" footing", /Before Steward checked imports \(Sep 30\)/.test(rc) && !/does not reconcile|= 0 /i.test(rc), rc.slice(0, 300));
      await page.keyboard.press("Escape");
      await row.locator('[data-testid="imports-archive"]').click({ timeout: 8000 });
      await page.locator('[data-testid="imports-show-archived"]').waitFor({ timeout: 8000 });
      const [a] = await q(`SELECT archived_at FROM imports WHERE id='imp_p9_sep30'`);
      ok("§5 (browser) Archive takes it off the list (\"Show archived (1)\") and keeps the row",
        (await page.locator('[data-testid="imports-row"]').filter({ hasText: "harbor-gifts-sept.csv" }).count()) === 0
        && /Show archived \(1\)/.test(await page.locator('[data-testid="imports-show-archived"]').innerText()) && !!a.archived_at);
    });

    if (leg("6")) await step("§6", async () => {
      await open("/app/communications");
      await page.getByRole("button", { name: "New campaign" }).first().click();
      await page.locator('[data-testid="campaign-gallery"]').waitFor({ timeout: 15000 });
      await page.locator('[data-testid="campaign-gallery"] :text("General appeal")').first().click();
      await page.locator('[data-testid="preview-as"]').first().click();
      await page.fill('input[aria-label="Find a person to preview as"]', "Jonathan A");
      await page.locator('[data-testid="preview-as-person"]:has-text("Jonathan Ashgrove")').first().waitFor({ timeout: 10000 }).catch(() => {});
      const found = await page.locator('[data-testid="preview-as-person"]').allInnerTexts();
      ok("§6 (browser) Preview as finds Jonathan Ashgrove, a contact who never gave, among nine Jonathan A givers",
        found.some(t => /Jonathan Ashgrove/.test(t)), found);
    });

    if (leg("7")) await step("§7", async () => {
      await open("/app/settings?section=automatic");
      await page.locator('[data-testid="mail-type-switch-gift_receipt"]').click({ timeout: 20000 });
      await page.locator('[data-testid="mail-type-confirm"]').click({ timeout: 8000 });
      await page.waitForTimeout(1500);   // the audit row is written as the answer finishes
      await open("/app/settings?section=automatic");
      const head = await page.locator('[data-testid="mail-types-page"]').first().innerText({ timeout: 20000 });
      const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const today = `${MON[Number(fx.today.slice(5, 7)) - 1]} ${Number(fx.today.slice(8, 10))}, ${fx.today.slice(0, 4)}`;   // the test clock's day (tests/clock.js)
      ok("§7 (browser) the email line names Mike Henderson, who just changed it, never the stored \"Jonathan … Nov 3\"",
        head.includes(`Mike Henderson last changed what sends on ${today}.`) && !/Jonathan turned email on/.test(head), (head.match(/[^\n]*(changed what sends|turned email on)[^\n]*/) || [""])[0]);
    });

    if (leg("8")) await step("§8", async () => {
      const c = await signedIn();
      // prod's reads take about a second; the profile's re-read is held that long, as prod's would be
      await c.route(`${BASE}/donors/${D("ed")}`, async r => { await new Promise(s => setTimeout(s, 1500)); await r.continue(); });
      const p = await c.newPage();
      await p.goto(`${APP}/donors/${D("ed")}`, { waitUntil: "networkidle", timeout: 60000 });
      const life = p.locator('[data-testid="dp-fig-lifetime"]');
      await life.waitFor({ timeout: 20000 });
      await p.locator('[role="tab"], button').filter({ hasText: /^\s*Giving\s*\d*\s*$/ }).first().click();
      ok("§8 fixture: the header reads $400 before the edit", /\$400\b/.test(await life.innerText()), await life.innerText());
      await p.getByRole("button", { name: "Edit", exact: true }).first().click();
      await p.getByPlaceholder("Amount").first().fill("650");
      const put = p.waitForResponse(r => /\/gifts\/[^/]+$/.test(r.url()) && r.request().method() === "PUT", { timeout: 15000 });
      await p.getByRole("button", { name: "Save", exact: true }).first().click();
      await put;
      await p.waitForTimeout(300);
      const after = await life.innerText();
      ok("§8 (browser) 300 ms after the save answers, the header already says $650, not the old $400", /\$650\b/.test(after) && !/\$400\b/.test(after), after);
      await c.close();
    });
  } finally {
    await browser.close();
    if (stripe) stripe.close();
  }
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
