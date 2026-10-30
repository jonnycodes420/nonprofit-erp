// GIVE-3 — THE ONE TEST. The giving page a donor opens is the page the editor
// showed, it takes a real (test-mode) gift through the one gift path in every
// layout, and the two numbers a stranger reads on it are true: the goal bar
// is the campaign's own total, and the trust panel states only what the org's
// record holds.
//
// It earns its place under CLAUDE.md's one-test rule because this page is
// money and donor trust at once: a preview that drifted from the live page is
// how half-typed words and amounts reach somebody holding a card (21 Oct: the
// preview drew a stand-in, not the page), a goal bar that does not foot is a
// public number nobody can check, and a trust line the org cannot back
// ("tax-deductible" with no EIN) is a claim made in its name.
//
// ── WHAT WOULD MAKE IT FAIL (the guard-must-be-able-to-fail rule) ──────────
//   1. Draw the editor preview from anything but the page's own component and
//      payload (the old FormPreview) → §5 markup comparison goes red.
//   2. Let the draft reach the public payload before Publish → §1 goes red.
//   3. Count the page's gifts, or ignore the campaign's dates → §3 goes red.
//   4. Show a trust line the record does not hold, or ignore "hide" → §2 red.
//   5. Drop giving_page_id on the way to recordGift → §4 goes red.
//   6. Crop the logo (object-fit cover) in the editor or on the page → §6 red.
//   7. POLISH-3: the org's own Donation form (/give/<org>, `?form=org` in the
//      editor) drew a stand-in (logo, name, amount buttons) and the Design
//      header image reached neither the preview nor a giving page. Now the
//      org form is the same page in the Story layout (no layout chosen: Story),
//      the header image shows with its focus and crop, and the preview's
//      markup equals the live page's → §7. Red on main: no preview route, no
//      real page in the org form, no header image.
//   8. EDITOR-1: the editor is the one shell with ONE preview at a time; the
//      headline is typed in the page and saves as the draft. Its editing
//      affordances are marked data-editor-*, and with them out the preview is
//      still the live page byte for byte → §5/§7. Planted: an editor-only
//      element left unmarked turns §5's markup comparison red.
// On main the whole suite is red: the preview route, the design field and the
// layouts do not exist. 1, 3 and 6 were planted and watched go red.
//
// Runs against the scratch server + scratch Postgres, never production.
const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");
const { BASE, ok, summary, api, q, closeDb, browserLegOrSkip, STRIPE_MOCK_PORT, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_give3", SLUG = "give3-harbor-test", ACCT = "acct_give3test";
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");
const PAGES = { story: "gp_give3story", simple: "gp_give3simple", campaign: "gp_give3camp" };
const cents = v => Math.round((Number(v) || 0) * 100);

// The Stripe mock: what the server ASKED Stripe for is the honest record of
// the metadata the gift will carry back.
const seen = [];
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/\/v1\/checkout\/sessions/.test(req.url) && req.method === "POST") {
          const p = new URLSearchParams(b);
          const id = "cs_test_" + Math.random().toString(36).slice(2, 12);
          const md = {};
          for (const [k, v] of p.entries()) { const m = /^payment_intent_data\[metadata\]\[(.+)\]$/.exec(k); if (m) md[m[1]] = v; }
          seen.push({ id, metadata: md, amount: Number(p.get("line_items[0][price_data][unit_amount]")) });
          res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}

async function reset() {
  const CHILD = ["giving_page_versions", "gift_starts", "gift_soft_credits", "p2p_teams", "peer_fundraisers", "form_events", "giving_pages",
    "receipts", "fin_audit_log", "fin_transactions", "gifts", "interactions", "tasks", "threads", "portal_settings", "asset_pointer_history", "portal_assets"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  // A legal name but NO EIN, and no contact email: the trust panel may say who
  // the org is and that Stripe takes the card, and must not say "tax-deductible".
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id,stripe_connected,
                             cover_fees_enabled,legal_name,receipt_address)
           VALUES ($1,'Give3 Harbor Trust',$2,1,'active','growth','America/New_York',$3,true,false,'Give3 Harbor Trust, Inc.','4 Pier Road, Salem, MA 01970')`, [ORG, SLUG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_give3',$1,'give3@example.org',$2,'Give Admin','admin')`,
    [ORG, bcrypt.hashSync("demo1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype) VALUES ('acc_give3',$1,'4010','Individual Contributions','revenue','contributions')`, [ORG]);
  const today = civilToday();
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,start_date,end_date,created_by,created_by_name)
           VALUES ('camp_give3',$1,'Give3 Boathouse',10000,$2::date,$3::date,'system:test','Test')`, [ORG, civilPlusDays(-30), civilPlusDays(20)]);
  await q(`INSERT INTO donors (id,org_id,name,email,status) VALUES ('d_give3a',$1,'Ada Shore','ada@give3.test','active'),('d_give3b',$1,'Ben Shore','ben@give3.test','active')`, [ORG]);
  // Two gifts inside the campaign's dates and one before it began: the bar is
  // $750 from two people, never $1,750.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,campaign_id,type,created_by,created_by_name) VALUES
           ('g_give3_in1',$1,'d_give3a',500,$2,'camp_give3','one-time','system:test','Test'),
           ('g_give3_in2',$1,'d_give3b',250,$3,'camp_give3','one-time','system:test','Test'),
           ('g_give3_out',$1,'d_give3b',1000,$4,'camp_give3','one-time','system:test','Test')`,
    [ORG, civilPlusDays(-10), civilPlusDays(-2), civilPlusDays(-60)]);
  const page = (id, slug, title, story, extra = "") => q(
    `INSERT INTO giving_pages (id,org_id,slug,title,story,status,created_by,created_by_name${extra ? "," + extra.split("=")[0] : ""})
     VALUES ($1,$2,$3,$4,$5,'active','system:test','Test'${extra ? ",'" + extra.split("=")[1] + "'" : ""})`, [id, ORG, slug, title, story]);
  await page(PAGES.story, "story-page", "Paddle with us", "One.\n\nTwo.\n\nThree, the part behind Read more.");
  await page(PAGES.simple, "simple-page", "Give today", "");
  await page(PAGES.campaign, "campaign-page", "Build the boathouse", "A new home for the boats.", "campaign_id=camp_give3");
}

(async () => {
  const mock = await startStripeMock();
  await reset();
  const D = await import("../shared/givingPageDesign.js");
  const login = await api("POST", "/auth/login", null, { email: "give3@example.org", password: "demo1234" });
  const TOK = login.body && login.body.token;
  ok("§0 the fixture admin signs in", !!TOK, login.status);
  const pub = slug => api("GET", `/org/${SLUG}/giving-page/${slug}/public`, null);
  const prev = id => api("GET", `/giving-pages/${id}/page/preview`, TOK);
  const setDraft = (id, settings) => api("PUT", `/giving-pages/${id}/page/settings`, TOK, { settings });
  const publish = id => api("POST", `/giving-pages/${id}/page/publish`, TOK, {});

  // ── §1 · the preview is the page's own payload, and a draft stays a draft ──
  console.log("\n— §1 · one payload for the page and its preview —");
  let p0 = await pub("story-page"), v0 = await prev(PAGES.story);
  ok("§1 with no draft, preview and public payload are identical", v0.status === 200 && JSON.stringify(v0.body) === JSON.stringify(p0.body), { status: v0.status });
  const d1 = await setDraft(PAGES.story, { title: "A promise kept", design: { layout: "story", impact: { 5000: "buys a week of paddles." } } });
  ok("§1 a draft saves", d1.status === 200, d1.body);
  const p1 = await pub("story-page"), v1 = await prev(PAGES.story);
  ok("§1 the public page does not show the draft headline", p1.body.givingPage.title === "Paddle with us");
  ok("§1 the preview does", v1.body.givingPage.title === "A promise kept" && v1.body.givingPage.design.layout === "story");
  await publish(PAGES.story);
  const p2 = await pub("story-page"), v2 = await prev(PAGES.story);
  ok("§1 after Publish the public payload is exactly what the preview drew", JSON.stringify(p2.body) === JSON.stringify(v1.body)
    && JSON.stringify(p2.body) === JSON.stringify(v2.body));
  ok("§1 the impact line went live", D.impactFor(p2.body.givingPage.design, 5000) === "buys a week of paddles.");
  for (const [k, id] of Object.entries({ simple: PAGES.simple, campaign: PAGES.campaign })) {
    await setDraft(id, { design: { layout: k } }); await publish(id);
  }

  // ── §2 · the trust panel states only what the record holds ──────────────
  console.log("\n— §2 · the trust panel —");
  const facts = p2.body.org.facts;
  ok("§2 the page carries the org's own facts", facts && facts.legalName === "Give3 Harbor Trust, Inc." && facts.ein === "" && facts.stripe === true, facts);
  const keys = D.trustLines(facts, p2.body.givingPage.design).map(l => l.key);
  ok("§2 no EIN: no tax-deductible line and no EIN; no email: no contact line", JSON.stringify(keys) === JSON.stringify(["stripe", "legal", "privacy"]), keys);
  ok("§2 the legal line is the legal name alone", D.trustLines(facts, {}).find(l => l.key === "legal").text === "Give3 Harbor Trust, Inc.");
  await setDraft(PAGES.simple, { design: { hide: ["legal"], ways: { check: true, daf: true } } }); await publish(PAGES.simple);
  const ps = await pub("simple-page");
  ok("§2 a hidden line is gone", JSON.stringify(D.trustLines(ps.body.org.facts, ps.body.givingPage.design).map(l => l.key)) === JSON.stringify(["stripe", "privacy"]));
  const ways = D.waysLines(ps.body.org.facts, ps.body.givingPage.design).map(w => w.key);
  ok("§2 a donor-advised fund line needs an EIN; the check line has its address", JSON.stringify(ways) === JSON.stringify(["check"]), ways);

  // ── §3 · the campaign page's goal bar is the campaign's total ───────────
  console.log("\n— §3 · the goal bar foots —");
  const pc = await pub("campaign-page");
  const camps = await api("GET", "/fundraising/campaigns", TOK);
  const fr = (Array.isArray(camps.body) ? camps.body : []).find(c => c.id === "camp_give3");
  const totals = (await require("../numbers").campaignGiftTotals((sql, params) => q(sql.replace(/\?/g, (() => { let i = 0; return () => "$" + (++i); })()), params), ORG)).find(r => r.cid === "camp_give3");
  ok("§3 the bar shows $750: the two gifts inside the campaign's dates", cents(pc.body.givingPage.campaignRaised) === 75000, pc.body.givingPage.campaignRaised);
  ok("§3 it equals NUMBERS-1's campaign total", totals && cents(totals.raised) === cents(pc.body.givingPage.campaignRaised), totals);
  ok("§3 and the Fundraising screen's raised", fr && cents(fr.raised) === cents(pc.body.givingPage.campaignRaised), fr && fr.raised);
  ok("§3 two donors, and days left counted to the end date", pc.body.givingPage.campaignDonors === 2 && pc.body.givingPage.campaignDaysLeft === 20, pc.body.givingPage);

  // ── §4 · each layout takes a test-mode gift that lands through recordGift ─
  console.log("\n— §4 · a gift through every layout —");
  ok("§4 the Stripe mock is listening", !!mock);
  let n = 0;
  for (const [layout, slug] of [["story", "story-page"], ["simple", "simple-page"], ["campaign", "campaign-page"]]) {
    const page = (await pub(slug)).body.givingPage;
    ok(`§4 ${layout}: the page opens in its layout`, D.layoutFor(page.design, page) === layout);
    const before = seen.length;
    const r = await fetch(`${BASE}/donate/${SLUG}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 40, frequency: "one-time", firstName: "Cora", lastName: "Layout" + layout, email: `cora.${layout}@give3.test`, givingPageId: page.id }) });
    const body = await r.json().catch(() => ({}));
    const asked = seen[before];
    ok(`§4 ${layout}: the form sends the donor to Stripe on the org's own account`, r.ok && /checkout\.stripe\.test/.test(body.url || "") && asked && asked.metadata.giving_page_id === page.id, { status: r.status, body, asked });
    const pi = "pi_give3_" + layout + "_" + Math.random().toString(36).slice(2, 10);
    const st = await fire({ id: "evt_" + pi, type: "payment_intent.succeeded", account: ACCT,
      data: { object: { id: pi, amount_received: 4000, receipt_email: `cora.${layout}@give3.test`, metadata: { ...(asked ? asked.metadata : {}), donor_name: "Cora Layout" + layout } } } });
    await new Promise(res => setTimeout(res, 400));
    const [g] = await q(`SELECT id, amount::float AS amount, giving_page_id, campaign_id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG, pi]);
    const [tl] = g ? await q(`SELECT id FROM interactions WHERE org_id=$1 AND gift_id=$2`, [ORG, g.id]) : [null];
    ok(`§4 ${layout}: one gift on this page, with its timeline line (recordGift)`, st === 200 && g && g.amount === 40 && g.giving_page_id === page.id && !!tl, { st, g });
    if (layout === "campaign") {
      const after = (await pub("campaign-page")).body.givingPage;
      ok("§4 the campaign gift moves the bar by its amount", cents(after.campaignRaised) === 75000 + 4000, after.campaignRaised);
    }
    n++;
  }

  // ── §5/§6 · the browser: the editor draws the page itself ───────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    // A wide logo (4:1). Cropped to a square it would lose three quarters.
    const sharp = require("sharp");
    const png = await sharp({ create: { width: 800, height: 200, channels: 3, background: { r: 31, g: 78, b: 95 } } }).png().toBuffer();
    const lg = await api("PUT", "/portal-settings", TOK, { logoData: "data:image/png;base64," + png.toString("base64"), primaryColor: "#1F4E5F" });
    ok("§6 the wide logo saves", lg.status === 200, lg.status);

    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [TOK, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);
    const page = await ctx.newPage();
    // EDITOR-1: the editor shows ONE preview at a time (Phone or Desktop), and
    // the page in it carries the editing affordances (the headline and story
    // typed in place, the photo's tools, a block's handles). Those are marked
    // data-editor-only / data-editor-wrap / data-inline; with them taken out,
    // and the typed-in-place headline and story compared by their words, the
    // rest of the preview is the live page byte for byte.
    const norm = (sel, editor) => page.evaluate(([s, ed]) => {
      const el = document.querySelector(s); if (!el) return null;
      const c = el.cloneNode(true);
      c.querySelectorAll("[data-editor-only]").forEach(n => n.remove());
      c.querySelectorAll("[data-editor-wrap]").forEach(w => { const inner = w.querySelector("[data-editor-node]"); w.replaceWith(...(inner ? [...inner.childNodes] : [])); });
      c.querySelectorAll(ed ? "[data-inline]" : "h1.g3-h1, .g3-story").forEach(n => n.remove());
      c.querySelectorAll('[data-edit="photo"][style]').forEach(n => { if (/^position: relative;?$/.test(n.getAttribute("style"))) n.removeAttribute("style"); });
      return c.innerHTML;
    }, [sel, editor]);
    const liveNorm = (pg) => pg.evaluate(() => { const el = document.querySelector('[data-testid="giving-page"]'); if (!el) return null;
      const c = el.cloneNode(true); c.querySelectorAll("h1.g3-h1, .g3-story").forEach(n => n.remove()); return c.innerHTML; });
    const PREV_DESK = '[data-testid="scaled-desktop"] [data-testid="giving-page"]';
    const PREV_PHONE = '[data-testid="real-preview"] [data-testid="giving-page"]';

    // §5 the same markup, desktop and phone, against the live page.
    await page.goto(`${APP}/portal-editor?page=${PAGES.story}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(PREV_DESK, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const shell = await page.evaluate(() => ({ rail: !!document.querySelector('[data-testid="editor-left-rail"]'), previews: document.querySelectorAll('[data-testid="giving-page"]').length,
      sideBySide: !!document.querySelector('[data-testid="preview-side-by-side"],[data-testid="editor-device-both"]') }));
    ok("§5 EDITOR-1: the shell, with one preview at a time and no Side by side", shell.rail && shell.previews === 1 && !shell.sideBySide, shell);
    const desk = await norm(PREV_DESK, true);
    const deskH1 = await page.evaluate(s => { const h = document.querySelector(s + " [data-inline=headline]"); return h ? h.innerText : null; }, PREV_DESK);
    await page.click('[data-testid="editor-device-phone"]');
    await page.waitForTimeout(600);
    const phone = await norm(PREV_PHONE, true);
    const live = await ctx.newPage();
    const liveHtml = async (w, h) => { await live.setViewportSize({ width: w, height: h }); await live.goto(`${APP}/give/${SLUG}/story-page`, { waitUntil: "networkidle" });
      await live.waitForSelector('[data-testid="giving-page"]', { timeout: 15000 }).catch(() => {});
      return { html: await liveNorm(live), h1: await live.evaluate(() => { const h = document.querySelector("h1.g3-h1"); return h ? h.textContent : null; }) }; };
    const l1440 = await liveHtml(1440, 900), l390 = await liveHtml(390, 844);
    ok("§5 the editor draws the real page (desktop, then phone)", !!desk && !!phone, { desk: !!desk, phone: !!phone });
    ok("§5 desktop preview markup = the live page at 1440", !!desk && desk === l1440.html, { d: desk && desk.length, l: l1440.html && l1440.html.length });
    ok("§5 phone preview markup = the live page at 390", !!phone && phone === l390.html, { p: phone && phone.length, l: l390.html && l390.html.length });
    ok("§5 the headline typed in place is the live page's headline", deskH1 === l1440.h1, { deskH1, live: l1440.h1 });
    const layoutAt = async (w) => { await live.setViewportSize({ width: w, height: 900 }); await live.waitForTimeout(150);
      return live.evaluate(() => { const g = document.querySelector(".g3-grid"); return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0; }); };
    ok("§5 two columns at 1440, one at 390", (await layoutAt(1440)) === 2 && (await layoutAt(390)) === 1);

    // §5 the headline, typed in the page itself, shows with no reload and saves as the draft.
    await page.evaluate(() => { window.__give3NoReload = true; });
    await page.click(`${PREV_PHONE} [data-inline=headline]`);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Typed just now");
    await page.waitForTimeout(200);
    const h1s = await page.evaluate(() => [...document.querySelectorAll('[data-testid="real-preview"] h1')].map(h => h.innerText));
    ok("§5 typing the headline in the preview changes it there", h1s.length >= 1 && h1s.every(t => t === "Typed just now"), h1s);
    ok("§5 without a reload", await page.evaluate(() => window.__give3NoReload === true));
    await page.waitForTimeout(1800);
    const drafted = await api("GET", `/giving-pages/${PAGES.story}/page`, TOK);
    ok("§5 and it saves as the draft", ((drafted.body.draftSettings || {}).title || "") === "Typed just now", drafted.body.draftSettings && drafted.body.draftSettings.title);
    // Clicking the amounts in the preview opens the rail section that sets them.
    await page.click(`${PREV_PHONE} [data-edit="amounts"]`);
    await page.waitForTimeout(400);
    ok("§5 clicking the preview's amounts opens The gift", await page.evaluate(() => !!document.querySelector('[data-rail-section="gift"] [data-testid="details-amounts"]')));

    // §6 the logo, whole, in the Design thumbnail and on the page.
    await page.click('[data-testid="editor-device-desktop"]');
    await page.click('[data-rail-section="design"] > button');
    await page.waitForTimeout(400);
    const thumb = await page.evaluate(() => { const i = [...document.querySelectorAll("img")].find(x => /portal-assets|data:image/.test(x.src) && x.closest('[style*="1 / 1"],[style*="aspect-ratio: 1"]'));
      return i ? getComputedStyle(i).objectFit : null; });
    ok("§6 the Design tab's logo thumbnail fits, never crops", thumb === "contain", thumb);
    await live.setViewportSize({ width: 1440, height: 900 });
    await live.goto(`${APP}/give/${SLUG}/simple-page`, { waitUntil: "networkidle" });
    const bar = await live.evaluate(() => { const i = document.querySelector(".g3-band img, .g3-bar img"); if (!i) return null;
      const r = i.getBoundingClientRect(); return { fit: getComputedStyle(i).objectFit, box: r.width / r.height, natural: i.naturalWidth / i.naturalHeight }; });
    ok("§6 the page's logo is whole: fit, and drawn at its own shape", bar && bar.fit === "contain" && Math.abs(bar.box - bar.natural) < 0.1, bar);

    // §6 each layout renders, and its trust panel shows only the filled lines.
    for (const [layout, slug] of [["story", "story-page"], ["simple", "simple-page"], ["campaign", "campaign-page"]]) {
      await live.goto(`${APP}/give/${SLUG}/${slug}`, { waitUntil: "networkidle" });
      const r = await live.evaluate(() => ({ layout: document.querySelector('[data-testid="giving-page"]')?.getAttribute("data-layout"),
        form: !!document.querySelector("#give-form"), trust: [...document.querySelectorAll("[data-trust]")].map(e => e.getAttribute("data-trust")),
        goal: document.querySelector('[data-testid="goal-donors"]')?.textContent || null }));
      ok(`§6 ${layout}: renders in its layout with the form`, r.layout === layout && r.form, r);
      const want = layout === "simple" ? ["stripe", "privacy"] : ["stripe", "legal", "privacy"];
      ok(`§6 ${layout}: the trust panel shows only the lines the org filled in`, JSON.stringify(r.trust) === JSON.stringify(want), r.trust);
      if (layout === "campaign") ok("§6 the campaign page shows its donors", /^3 donors$/.test(String(r.goal || "").trim()), r.goal);
    }

    // ── §7 · POLISH-3: the org's Donation form is the page, header image and all ──
    console.log("\n— §7 · the org's own donation form, with its header image —");
    const pubOrg = await api("GET", `/org/${SLUG}/public`, null);
    const pvOrg = await api("GET", "/org-form/page/preview", TOK);
    ok("§7 the org form's preview is the public page's own payload", pvOrg.status === 200 && JSON.stringify(pvOrg.body) === JSON.stringify(pubOrg.body), { status: pvOrg.status });
    const banner = await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 160, g: 110, b: 80 } } }).png().toBuffer();
    const hd = await api("PUT", "/portal-settings", TOK, { headerImageData: "data:image/png;base64," + banner.toString("base64"), headerFocalX: 0.2, headerFocalY: 0.8 });
    ok("§7 a header image saves (no layout was ever chosen)", hd.status === 200, hd.status);
    await page.goto(`${APP}/portal-editor?form=org`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(PREV_DESK, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const oDesk = await norm(PREV_DESK, true);
    const shown = await page.evaluate(sel => { const g = document.querySelector(sel); const i = g && g.querySelector('[data-testid="page-header-image"] img');
      return g ? { layout: g.getAttribute("data-layout"), header: !!i, pos: i ? getComputedStyle(i).objectPosition : null, form: !!g.querySelector("#give-form") } : null; }, PREV_DESK);
    ok("§7 the editor draws the real page in Story, with the header image and the form", !!shown && shown.layout === "story" && shown.header && shown.form, shown);
    ok("§7 at the focus she set", !!shown && shown.pos === "20% 80%", shown && shown.pos);
    const oLive = async (w, h) => { await live.setViewportSize({ width: w, height: h }); await live.goto(`${APP}/give/${SLUG}`, { waitUntil: "networkidle" });
      await live.waitForSelector('[data-testid="giving-page"]', { timeout: 15000 }).catch(() => {});
      return live.evaluate(() => { const el = document.querySelector('[data-testid="giving-page"]'); return el ? el.innerHTML : null; }); };
    const o1440 = await oLive(1440, 900), o390 = await oLive(390, 844);
    ok("§7 the public donation page shows the header image", /data-testid="page-header-image"/.test(o1440 || ""), !!o1440);
    ok("§7 desktop preview markup = the live donation page at 1440", !!oDesk && oDesk === o1440, { d: oDesk && oDesk.length, l: o1440 && o1440.length });
    await page.click('[data-testid="editor-device-phone"]');
    await page.waitForTimeout(600);
    const oPhone = await norm(PREV_PHONE, true);
    ok("§7 phone preview markup = the live donation page at 390", !!oPhone && oPhone === o390, { p: oPhone && oPhone.length, l: o390 && o390.length });
    // A new header image shows the moment it is dropped, before any save.
    await page.click('[data-testid="editor-device-desktop"]');
    await page.click('[data-rail-section="design"] > button');
    await page.waitForTimeout(300);
    const headerInput = page.locator('[data-field="header-image"] + * input[type="file"]');
    const hi = await headerInput.count();
    const next = await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 40, g: 90, b: 70 } } }).png().toBuffer();
    if (hi > 0) await headerInput.first().setInputFiles({ name: "clay.png", mimeType: "image/png", buffer: next });
    await page.waitForTimeout(500);
    const now = await page.evaluate(sel => { const i = document.querySelector(sel + ' [data-testid="page-header-image"] img'); return i ? i.getAttribute("src").slice(0, 22) : null; }, PREV_DESK);
    ok("§7 a new header image is in the preview at once, before the save", hi > 0 && now === "data:image/png;base64,", { hi, now });
    // A giving page with no photo of its own carries the header image too.
    await live.goto(`${APP}/give/${SLUG}/story-page`, { waitUntil: "networkidle" });
    ok("§7 a giving page with no photo shows the org's header image", await live.evaluate(() => !!document.querySelector('[data-testid="giving-page"] [data-testid="page-header-image"] img')));

    // ── §8 · FIX-57: an anonymous visit asks nothing that can only say 401 ──
    // The giving page asked the donor portal's give-default on every visit,
    // and a stranger with no donor session took a 401 into the console. With
    // the portal on (the case where it was asked), a fresh browser with no
    // session loads the org form, a giving page and the membership page with
    // no 4xx response and no console error. Red on main: give-default, 401.
    console.log("\n— §8 · an anonymous visit has no 4xx —");
    await q(`UPDATE portal_settings SET enabled=true WHERE org_id=$1`, [ORG]);
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const stranger = await anon.newPage();
    const bad = [], errs = [];
    // /_vercel/* (analytics) exists only on Vercel; the local preview 404s it.
    const vercelOnly = u => /\/_vercel\//.test(String(u || ""));
    stranger.on("response", r => { if (r.status() >= 400 && !vercelOnly(r.url())) bad.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
    stranger.on("console", m => { if (m.type() === "error" && !vercelOnly(m.location() && m.location().url)) errs.push(`${m.text().slice(0, 120)} ${(m.location() && m.location().url) || ""}`); });
    for (const u of [`/give/${SLUG}`, `/give/${SLUG}/story-page`, `/give/${SLUG}?memberships`]) {
      await stranger.goto(`${APP}${u}`, { waitUntil: "networkidle" });
      await stranger.waitForTimeout(300);
    }
    ok("§8 an anonymous giving page load has no 4xx response", bad.length === 0, bad);
    ok("§8 and no console error", errs.length === 0, errs);
    await anon.close();
    await browser.close();
  }

  if (mock) mock.close();
  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); summary(); await closeDb(); process.exit(1); });
