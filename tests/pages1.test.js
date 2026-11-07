// tests/pages1.test.js · PAGES-1. EVERY DONOR-FACING PAGE, ONE PAGE SYSTEM.
//
// The build's one new test. It earns its place under CLAUDE.md's rule because
// it guards what a donor sees on a page that takes money or a sign-up: a blank
// block never shows a placeholder or an empty box to the public, a template
// never publishes prompt copy, a colour pair a donor cannot read is named in
// the editor, and the pages load and fit a phone.
//
//   §1  the editor: the left rail scrolls on its own to its last section at
//       1280×720; the Cover photo section names the photo the page shows (a
//       page led by its Hero block's photo is not "No photo"); a blank story is
//       a dashed "Add your story" box in the editor and nothing on the public
//       page, never an empty coloured block.
//  §2  volunteer and membership pages add, reorder and remove blocks and save
//       a theme (accent, fonts, buttons, corners, sections), which publishes.
//  §3  every template of every page type publishes with no placeholder text,
//       in the public read and on the rendered page; a blank block renders
//       nothing publicly (planted: the editor's own note shown publicly → red).
//  §4  contrast: a failing accent is named with its ratio (shared/pageTheme.js)
//       and the editor shows the warning.
//  §5  each public page is ready under 2 s at a 150 ms round trip by PERF-4's
//       page-ready mark (now on the public pages too), and has no horizontal
//       scroll at 390 wide.
//
// RED ON MAIN (acea33c/a814f6e): §1 cover (the rail said "No photo" over the
// Hero's photo) and blank story (no dashed box; an empty brand-coloured block
// with no photo and no logo), §2 (no membership kind, no theme, volunteer
// pages refused stats/quote), §3 (no membership templates; an empty FAQ or
// stats block drew a blank card publicly), §4 (no check), §5 for membership
// (no page). §1's rail scroll passed on main in Chromium and WebKit: the
// defect Jonathan saw was not reproduced, so the shell was hardened and this
// check holds it.
//
// Never the demo org. Nothing here sends.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");

const ORG = "org_pages1";
const SLUG = "pages1-lantern";
const { DIST } = require("./lib/dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
// Words that are Steward's prompts or the editor's own notes, never a donor's.
const PLACEHOLDER = /in your own words|Add your story|Empty block|Write something|Add a quote from|Spots filled: shows once|Goal bar: set how many|Membership levels: add a level|Add a cover photo/i;

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}

(async () => {
  const T = await import("../shared/pageTheme.js");
  await wipe(ORG);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,mission,emails_enabled,staff_mail_enabled,stripe_account_id,stripe_connected)
           VALUES ($1,'Lantern Street Arts',$2,1,NOW(),'active','team','America/New_York','After-school art for kids in the river wards.',false,false,'acct_pages1_test',true)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Adebayo','admin')`,
    ["u_" + ORG, ORG, `${ORG}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
  await q(`INSERT INTO portal_settings (org_id, primary_color, display_name, contact_email) VALUES ($1,'#7A4A2A','Lantern Street Arts','hello@lantern.example.org')
           ON CONFLICT (org_id) DO UPDATE SET primary_color=EXCLUDED.primary_color, display_name=EXCLUDED.display_name, contact_email=EXCLUDED.contact_email`, [ORG]);
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term) VALUES ('ml_p1_friend',$1,'Friend',60,'12_months')`, [ORG]).catch(e => ok("seed level", false, e.message));
  const login = (await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: "loadtest1234" })).body;
  const TOK = login.token;
  ok("fixture org signs in", !!TOK, login);

  const make = async (title, kind, template) => (await api("POST", "/giving-pages", TOK, { title, ...(kind ? { page_kind: kind } : {}), ...(template ? { template } : {}) }));
  const page = async id => (await api("GET", `/giving-pages/${id}/page`, TOK)).body;
  const publish = async (id) => api("POST", `/giving-pages/${id}/page/publish`, TOK, {});
  const pubRead = (kind, slug) => api("GET", kind === "membership" ? `/org/${SLUG}/membership-page/${slug}/public`
    : kind === "volunteer" ? `/org/${SLUG}/volunteer-page/${slug}/public` : `/org/${SLUG}/giving-page/${slug}/public`, null);

  // ── §4 · contrast, the arithmetic ─────────────────────────────────────────
  const brand = { primary: "#7A4A2A" };
  ok("§4 black on white is 21:1", T.contrastRatio("#000000", "#FFFFFF") === 21);
  ok("§4 the brand accent passes AA", T.contrastWarnings(brand, {}).length === 0, T.contrastWarnings(brand, {}));
  const pale = T.contrastWarnings(brand, { accent: "#F2E3A0" });
  ok("§4 a pale accent on light sections is named with its ratio", pale.some(w => w.key === "accent" && w.ratio < 4.5 && /4\.5:1/.test(w.sentence)), pale);
  ok("§4 a mid accent under outline buttons on dark sections is named", T.contrastWarnings(brand, { accent: "#2E5E3E", button: "outline", sections: "dark" }).some(w => w.key === "button"));
  ok("§4 a theme outside the curated choices is refused", !T.validateTheme({ fonts: "Comic Sans" }).ok && !T.validateTheme({ accent: "red" }).ok);

  // ── §2 · volunteer and membership pages: blocks and a theme ──────────────
  for (const kind of ["volunteer", "membership"]) {
    const made = await make(kind === "volunteer" ? "Paint the river wall" : "Join Lantern Street", kind, kind === "volunteer" ? "one_day" : "story_first");
    ok(`§2 ${kind}: a page is made from a template`, made.status === 201 && made.body.page_kind === kind, made.body);
    const id = made.body.id;
    const p0 = await page(id);
    ok(`§2 ${kind}: the editor offers the page blocks`, ["pageheader", "hero", "richtext", "stats", "gallery", "quote", "goalbar", "faq", "pagefooter"].every(t => (p0.widgetTypes || []).includes(t))
      && (kind === "membership" ? p0.widgetTypes.includes("memberlevels") : p0.widgetTypes.includes("volsignup")), p0.widgetTypes);
    ok(`§2 ${kind}: three templates`, (p0.starters || []).length === 3, p0.starters);
    const types0 = p0.draft.map(w => w.type);
    // Add a quote and impact numbers, move the quote to the top, remove the footer.
    const added = [...p0.draft, { type: "quote", text: "Our kids painted the whole wall in one Saturday.", attribution: "A parent" }, { type: "stats", items: [{ value: "312", label: "Kids this year" }] }];
    const quoteFirst = [added[added.length - 2], ...added.filter((w, i) => i !== added.length - 2)].filter(w => w.type !== "pagefooter");
    const put = await api("PUT", `/giving-pages/${id}/page/draft`, TOK, { widgets: quoteFirst });
    ok(`§2 ${kind}: blocks added, reordered and removed in one save`, put.status === 200 && put.body.draft[0].type === "quote" && !put.body.draft.some(w => w.type === "pagefooter") && put.body.draft.some(w => w.type === "stats"), put.body);
    const theme = { accent: "#1F4E79", fonts: "editorial", button: "pill", corners: "round", sections: "dark" };
    const st = await api("PUT", `/giving-pages/${id}/page/settings`, TOK, { settings: { design: { theme } } });
    ok(`§2 ${kind}: a theme is drafted`, st.status === 200 && st.body.draftSettings.design.theme.fonts === "editorial" && st.body.draftSettings.design.theme.sections === "dark", st.body);
    const bad = await api("PUT", `/giving-pages/${id}/page/settings`, TOK, { settings: { design: { theme: { fonts: "Papyrus" } } } });
    ok(`§2 ${kind}: a font outside the pairings is refused`, bad.status === 400, bad.body);
    const pub = await publish(id);
    const pr = await pubRead(kind, made.body.slug);
    ok(`§2 ${kind}: published, the public page carries its blocks in order and its theme`, pub.status === 200 && pr.status === 200 && pr.body.widgets[0].type === "quote"
      && pr.body.page.pageTheme.accent === "#1F4E79" && pr.body.page.pageTheme.corners === "round", { pub: pub.body, types: (pr.body.widgets || []).map(w => w.type), theme: pr.body.page && pr.body.page.pageTheme });
    ok(`§2 ${kind}: the template's blocks were there to start with`, types0.includes("pageheader") && types0.includes("pagefooter"), types0);
  }
  const wrong = await make("A volunteer page", "volunteer", "ongoing");
  const stray = await api("PUT", `/giving-pages/${wrong.body.id}/page/draft`, TOK, { widgets: [{ type: "memberlevels", heading: "x" }] });
  ok("§2 a membership form on a volunteer page is refused", stray.status === 400 && stray.body.error === "wrong_surface", stray.body);

  // ── §3 · every template publishes with no placeholder ────────────────────
  const published = [];
  const tmpl = { give: ["story_first", "campaign", "simple"], volunteer: ["one_day", "ongoing", "group_day"], membership: ["story_first", "campaign", "simple"] };
  for (const [kind, keys] of Object.entries(tmpl)) {
    for (const key of keys) {
      const made = await make(`${kind} ${key}`.replace(/_/g, " "), kind === "give" ? null : kind, kind === "give" ? null : key);
      const id = made.body.id;
      if (kind === "give") {
        const s = await api("POST", `/giving-pages/${id}/page/starter`, TOK, { key });
        ok(`§3 give: the ${key} starter applies, with its layout`, s.status === 200 && s.body.draftSettings && s.body.draftSettings.design.layout === key.replace("_first", "").replace("story", "story"), s.body);
        await api("PUT", `/giving-pages/${id}/page/settings`, TOK, { settings: { story: "" } });
      }
      const pub = await publish(id);
      const pr = await pubRead(kind, made.body.slug);
      ok(`§3 ${kind} ${key}: published`, pub.status === 200 && pr.status === 200, { pub: pub.body, read: pr.status });
      ok(`§3 ${kind} ${key}: the public read carries no prompt`, !PLACEHOLDER.test(JSON.stringify(pr.body)), JSON.stringify(pr.body).match(PLACEHOLDER));
      published.push({ kind, key, slug: made.body.slug, id });
    }
  }
  // A blank block, saved on a published page: nothing of it may show publicly.
  const blank = await make("Blank blocks", "membership", "simple");
  const blankDraft = [...(await page(blank.body.id)).draft, { type: "richtext", blocks: [] }, { type: "goalbar", heading: "", target: null }, { type: "quote", text: "", attribution: "" }];
  const bp = await api("PUT", `/giving-pages/${blank.body.id}/page/draft`, TOK, { widgets: blankDraft });
  await publish(blank.body.id);
  ok("§3 blank blocks save", bp.status === 200, bp.body);
  published.push({ kind: "membership", key: "blank", slug: blank.body.slug, id: blank.body.id, blank: true });

  // ── the browser legs ─────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const errors = [];
    const editorCtx = async (w, h) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
      await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
        [TOK, JSON.stringify(login.user), JSON.stringify(login.org)]);
      const pg = await ctx.newPage();
      pg.on("pageerror", e => errors.push(e.message.slice(0, 160)));
      return { ctx, pg };
    };
    const SHOTS = process.env.PAGES1_SHOTS || "";
    const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }).catch(() => {}); };

    // §1 · the giving page editor at 1280×720.
    const give = await make("Spring kiln fund", null, null);
    const gid = give.body.id;
    // No cover of its own, a Hero block with a photo, and a blank story.
    const heroPic = (await q(`SELECT image_url FROM giving_pages WHERE id=$1`, [gid]))[0].image_url;
    await q(`UPDATE giving_pages SET image_url='', image_meta='{}'::jsonb, story='' WHERE id=$1`, [gid]);
    await api("PUT", `/giving-pages/${gid}/page/draft`, TOK, { widgets: [{ type: "hero", heading: "", sub: "", image: heroPic, size: "standard" }] });
    {
      const { ctx, pg } = await editorCtx(1280, 720);
      await pg.goto(`${APP}/portal-editor?page=${gid}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await pg.locator('[data-testid="editor-left-rail"]').waitFor({ timeout: 25000 });
      await pg.locator('[data-testid="real-preview"]').waitFor({ timeout: 20000 }).catch(() => {});
      await pg.waitForTimeout(1200);
      const cover = await pg.evaluate(() => ({ empty: (document.querySelector('[data-testid="editor-cover-photo"]') || {}).getAttribute && document.querySelector('[data-testid="editor-cover-photo"]').getAttribute("data-empty"),
        shown: !!document.querySelector('[data-testid="real-preview"] [data-testid="page-cover"]') }));
      ok("§1 the Cover photo section matches the page: the photo shown is the photo named", cover.shown === true && cover.empty === "false", cover);
      const story = await pg.evaluate(() => { const el = document.querySelector('[data-testid="inline-story"]'); return el ? { cls: el.className, ph: el.getAttribute("data-placeholder"), border: getComputedStyle(el).borderTopStyle } : null; });
      ok("§1 a blank story is a dashed Add your story box in the editor", story && /g3-story-empty/.test(story.cls) && story.border === "dashed" && /^Add your story/.test(story.ph || ""), story);
      await shot(pg, "editor-1280x720");
      // Every section open, then the wheel over the rail to its end.
      await pg.evaluate(() => document.querySelectorAll('[data-testid="editor-left-rail"] section > button[aria-expanded="false"]').forEach(b => b.click()));
      await pg.waitForTimeout(300);
      await pg.mouse.move(150, 400);
      for (let i = 0; i < 40; i++) { await pg.mouse.wheel(0, 400); await pg.waitForTimeout(25); }
      await pg.waitForTimeout(400);
      const rail = await pg.evaluate(() => {
        const a = document.querySelector('[data-testid="editor-left-rail"]');
        const secs = a.querySelectorAll("[data-rail-section]"); const last = secs[secs.length - 1].getBoundingClientRect();
        return { st: a.scrollTop, max: a.scrollHeight - a.clientHeight, lastBottom: Math.round(last.bottom), vh: innerHeight, winScroll: scrollY, n: secs.length, lastId: secs[secs.length - 1].dataset.railSection };
      });
      ok("§1 the left rail scrolls on its own to its last section at 1280×720", rail.max > 0 && rail.st >= rail.max - 2 && rail.lastBottom <= rail.vh && rail.winScroll === 0, rail);
      await shot(pg, "editor-rail-end");
      await ctx.close();
      // The public page: nothing where the blank story is, no empty coloured block.
      await api("PUT", `/giving-pages/${gid}/page/draft`, TOK, { widgets: [] });
      await publish(gid);
      const pub = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await pub.goto(`${APP}/give/${SLUG}/${give.body.slug}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await pub.locator('[data-testid="giving-page"]').waitFor({ timeout: 20000 }).catch(() => {});
      const blankPub = await pub.evaluate(() => ({ story: !!document.querySelector(".g3-story"), fill: [...document.querySelectorAll(".g3-fill")].filter(el => !el.querySelector("img")).length, add: !!document.querySelector('[data-testid="add-cover-photo"]') }));
      ok("§1 a blank story renders no block on the public page, and no empty coloured block", blankPub.story === false && blankPub.fill === 0 && blankPub.add === false, blankPub);
      await pub.close();
    }

    // §2 · in the editor: a membership page picks a theme; §4 the warning.
    {
      const m = published.find(p => p.kind === "membership" && p.key === "story_first");
      const { ctx, pg } = await editorCtx(1440, 900);
      await pg.goto(`${APP}/portal-editor?page=${m.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await pg.locator('[data-testid="rail-page-theme"]').waitFor({ timeout: 25000 });
      await pg.locator('[data-testid="rail-page-theme"] > button').click();
      await pg.locator('[data-testid="theme-accent"]').fill("#F2E3A0");
      await pg.locator('[data-testid="contrast-warning"]').waitFor({ timeout: 5000 }).catch(() => {});
      const warn = await pg.locator('[data-testid="contrast-warning"]').innerText().catch(() => "");
      ok("§4 a failing colour pair shows the contrast warning in the editor", /4\.5:1/.test(warn), warn);
      await shot(pg, "editor-contrast-warning");
      // The same pale accent reads well on dark sections: the warning goes.
      await pg.locator('[data-testid="theme-sections"] [data-value="dark"]').click();
      await pg.waitForTimeout(400);
      const cleared = await pg.locator('[data-testid="contrast-warning"]').count();
      const bg = await pg.evaluate(() => getComputedStyle(document.querySelector('[data-testid="block-page-preview"]')).backgroundColor);
      ok("§2 on dark sections the pale accent reads and the warning clears; the preview turns dark at once", cleared === 0 && /rgb\(15, 26, 18\)/.test(bg), { cleared, bg });
      ok("§2 the membership preview draws its levels", await pg.locator('[data-testid="block-memberlevels"]').count() === 1);
      await pg.waitForTimeout(1500);   // the draft's debounce
      await ctx.close();
      const saved = (await page(m.id)).draftSettings;
      ok("§2 the theme picked in the editor is the page's draft", saved && saved.design && saved.design.theme && saved.design.theme.sections === "dark" && saved.design.theme.accent === "#F2E3A0", saved && saved.design);
    }

    // §3 · each template renders with no placeholder; §5 ready and 390 wide.
    const urlOf = p => p.kind === "membership" ? `${APP}/membership-page/${SLUG}/${p.slug}` : p.kind === "volunteer" ? `${APP}/volunteer-page/${SLUG}/${p.slug}` : `${APP}/give/${SLUG}/${p.slug}`;
    const readySel = p => p.kind === "give" ? '[data-testid="giving-page"]' : '[data-page-ready="1"]';
    for (const p of published) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const pg = await ctx.newPage();
      pg.on("pageerror", e => errors.push(e.message.slice(0, 160)));
      await pg.goto(urlOf(p), { waitUntil: "domcontentloaded", timeout: 45000 });
      await pg.locator(readySel(p)).waitFor({ timeout: 20000 }).catch(() => {});
      await pg.waitForTimeout(400);
      const r = await pg.evaluate(() => ({ text: document.body.innerText, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        notes: document.querySelectorAll('[data-testid="block-editor-note"]').length,
        emptyCards: [...document.querySelectorAll(".pt-widgets > div")].filter(d => d.offsetHeight > 0 && d.innerText.trim() === "" && !d.querySelector("img,iframe,video")).length }));
      ok(`§3 ${p.kind} ${p.key}: renders with no placeholder text`, !PLACEHOLDER.test(r.text) && r.notes === 0, (r.text.match(PLACEHOLDER) || [])[0]);
      if (p.blank) ok("§3 a blank block renders nothing publicly (no empty card, no editor note)", r.emptyCards === 0 && r.notes === 0, r);
      ok(`§5 ${p.kind} ${p.key}: no horizontal scroll at 390 wide`, r.sw <= r.cw, { sw: r.sw, cw: r.cw });
      if (p.key === "story_first" || p.key === "one_day") await shot(pg, `public-${p.kind}-390`);
      await ctx.close();
    }
    // §5 · ready under 2 s at a 150 ms round trip (PERF-4's measure: a fresh
    // browser, its cache off, 150 ms added to every request).
    for (const kind of ["give", "volunteer", "membership"]) {
      const p = published.find(x => x.kind === kind && !x.blank);
      const times = [];
      for (let i = 0; i < 3; i++) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
        const pg = await ctx.newPage();
        const cdp = await ctx.newCDPSession(pg);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 5 * 1024 * 1024 / 8 });
        await pg.goto(urlOf(p), { waitUntil: "commit", timeout: 45000 });
        // PERF-4's mark: drawn, nothing loading, no read in flight, held 150 ms.
        const mark = await pg.waitForFunction(() => window.__stewardReady, null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
        times.push(mark ? mark.ms : 99999);
        if (i === 0 && kind !== "give") await shot(pg, `public-${kind}-1440`);
        await ctx.close();
      }
      const median = times.sort((a, b) => a - b)[1];
      ok(`§5 ${kind}: the public page is ready under 2 s at a 150 ms round trip (median of 3)`, median < 2000, times);
    }
    ok("§1–§5 nothing threw", errors.length === 0, errors.slice(0, 3));
    await browser.close();
  }

  await wipe(ORG);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });
