#!/usr/bin/env node
// FIX-4 — THE WALK. SELF_REFUSING.
//
// Every part of this build has a green server suite, and three of the six
// items are things a server suite physically cannot see: whether the spine
// fits the card, whether the Agent page is still painted dark, whether
// clicking a chip leaves a green bar under it. So this opens the real
// screens in a real browser at 1440 AND 390 and measures them.
//
//   BASE=http://localhost:5601 APP_URL=http://localhost:4173 \
//   EMAIL=director@harborlight.demo PASSWORD=demo-harbor-2026 node scripts/fix4-walk.js
//
// SELF_REFUSING: loopback only, and it never runs in production.

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
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "fix-4");

// See the note beside the first listener: the two things a scratch stack
// cannot serve, named once.
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
  return { status: r.status, body };
}

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) {
    // A walk that cannot open a browser has proved NOTHING. It fails rather
    // than printing a green line nobody should trust.
    console.error(`Playwright not found under ${PW_DIR}. This walk is the browser half; there is no server-only mode.`);
    process.exit(1);
  }

  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200 || !login.body.token) {
    console.error("Could not sign in as " + EMAIL + " — " + login.status + " " + JSON.stringify(login.body).slice(0, 200));
    process.exit(1);
  }
  const token = login.body.token;
  // The app reads three keys, not one: a token alone leaves it with no user
  // and no org and it bounces to /login (the first thing this walk got
  // wrong, and it looked exactly like a broken Journeys tab).
  const AUTH = [token, JSON.stringify(login.body.user || {}), JSON.stringify(login.body.org || {})];
  const signIn = ctx => ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, AUTH);

  // A journey to look at. The builder is empty on a fresh demo, so this
  // creates the first-year preset through the real route — which is also the
  // one place the retimed offsets reach the database.
  const made = await api("/journeys", { method: "POST", body: JSON.stringify({ presetKey: "new_donor_first_year" }) }, token);
  const journeyId = made.body && made.body.id;
  ok("a journey exists to walk (the first-year preset, through the real route)", !!journeyId, made.body);
  ok("…and its sentence says seven touches over twelve months",
     String(made.body && made.body.touches || "").startsWith("7 touches over 12 months"), made.body && made.body.touches);

  const browser = await chromium.launch();
  const shots = [];

  async function screen(width, height) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    // IGNORED, AND EACH ONE NAMED. Nothing here is a defect this walk could
    // find: `_vercel/insights` is not served by the local preview, and
    // `/ai/stream` answers 503 because ANTHROPIC_API_KEY is deliberately
    // unset on a scratch stack (the Anthropic gate, BUILD-96). Anything else
    // fails the walk.
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text() + " <" + ((m.location() || {}).url || "?") + ">"); });
    page.on("response", r => { if (r.status() >= 500 && !IGNORE.test(r.url())) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    return { ctx, page, errors };
  }

  const shot = async (page, name) => {
    const file = path.join(SHOTS, name + ".png");
    await page.screenshot({ path: file, fullPage: false });
    shots.push(file);
  };

  // ── 1440 ────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(1440, 1000);

    // ── 1b · THE JOURNEY BUILDER ─────────────────────────────────────────
    console.log("\n— 1440 · the journey builder —");
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Journeys\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-testid='journey-builder']", { timeout: 10000 }).catch(() => {});
    ok("Journeys is its own item in the sidebar, and it opens the builder",
       await page.locator("[data-testid='journey-builder']").count() > 0);

    await page.locator("[data-testid='journey-row'] button").first().click();
    await page.waitForSelector("[data-testid='jb-node-6']", { timeout: 10000 }).catch(() => {});

    const nodeCount = await page.locator("[data-testid^='jb-node-']").count();
    ok("all 7 steps are on the spine", nodeCount === 7, nodeCount);

    // EVERY node inside the card's box, and the card not scrolling sideways.
    const geom = await page.evaluate(() => {
      const spine = document.querySelector("[data-testid='jb-spine']");
      if (!spine) return null;
      const card = spine.closest("[data-testid='journey-row']");
      const nodes = [...document.querySelectorAll("[data-testid^='jb-node-']")].map(n => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, label: (n.textContent || "").slice(0, 24) };
      });
      // Anything inside the card whose content is wider than its box.
      const scrollers = [...card.querySelectorAll("*")]
        .filter(el => el.scrollWidth - el.clientWidth > 1)
        .map(el => ({ tag: el.tagName, cls: el.className && String(el.className).slice(0, 40), over: el.scrollWidth - el.clientWidth }));
      const cr = card.getBoundingClientRect();
      const chain = document.querySelector("[data-testid='jb-chain']");
      const chr = chain ? chain.getBoundingClientRect() : null;
      return {
        card: { left: cr.left, right: cr.right, width: cr.width },
        nodes, scrollers,
        chain: chr ? { left: chr.left, right: chr.right, width: chr.width } : null,
        pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok("the spine is on the page at all", !!geom, geom);
    if (geom) {
      const inside = geom.nodes.every(n => n.left >= geom.card.left - 1 && n.right <= geom.card.right + 1);
      ok("every one of the 7 nodes is visible inside the card (nothing off its edge)", inside,
         geom.nodes.map(n => [Math.round(n.left), Math.round(n.right)]));
      ok("NO second scrollbar anywhere in the card", geom.scrollers.length === 0, geom.scrollers);
      ok("no horizontal scroll on the page either", geom.pageScrollX <= 0, geom.pageScrollX);
      // The chain runs the whole top of the card: first node to last, and
      // the full width. Allow the card's 16px padding on each side.
      const spansCard = geom.chain && geom.chain.width >= geom.card.width - 40;
      ok("the chain runs across the entire top of the card, first node to last", !!spansCard,
         { chain: geom.chain && Math.round(geom.chain.width), card: Math.round(geom.card.width) });
      // Labels must not overlap either — a spine that fits but reads as one
      // smudge is the defect this item is actually about.
      let overlap = null;
      for (let i = 1; i < geom.nodes.length; i++) {
        if (geom.nodes[i].left < geom.nodes[i - 1].right - 1) { overlap = [geom.nodes[i - 1], geom.nodes[i]]; break; }
      }
      ok("…and no two nodes overlap", !overlap, overlap);
    }
    await shot(page, "journey-builder-1440");

    // ── 1c · the audience filters ────────────────────────────────────────
    await page.locator("[data-testid='jb-apply-open']").click().catch(() => {});
    await page.waitForSelector("[data-testid='jb-audience']", { timeout: 8000 }).catch(() => {});
    const filterLabels = await page.locator("[data-testid='jb-audience'] button[data-testid^='jb-aud-']").allTextContents();
    ok("the audience filters are on the apply offer (volunteers, event, members, recurring)",
       ["Volunteers", "Attended an event", "Members", "Recurring givers"].every(l => filterLabels.includes(l)), filterLabels);
    ok("…and stage, tag and gift size are there too",
       (await page.locator("[data-testid='jb-aud-stage']").count()) === 1
       && (await page.locator("[data-testid='jb-aud-tag']").count()) === 1
       && (await page.locator("[data-testid='jb-aud-gift-min']").count()) === 1);
    await shot(page, "journey-audience-1440");
    await page.keyboard.press("Escape").catch(() => {});

    // ── 3 · THE AGENT PAGE ───────────────────────────────────────────────
    console.log("\n— 1440 · the Agent page —");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Agent\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-testid='agent-room']", { timeout: 10000 }).catch(() => {});
    const agent = await page.evaluate(() => {
      const room = document.querySelector("[data-testid='agent-room']");
      const desk = document.querySelector("[data-testid='agent-desk']");
      if (!room || !desk) return null;
      const bg = el => getComputedStyle(el).backgroundColor;
      // Walk up from the room: no ancestor inside the content column may be
      // ink. TRANSPARENT IS NOT INK — rgba(…, 0) reads as rgb(0,0,0) to a
      // naive check, which is how the first run of this walk failed a page
      // that was already correct.
      const inkish = s => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(s || "");
        if (!m) return false;
        if (m[4] !== undefined && Number(m[4]) === 0) return false;   // transparent
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        return r < 80 && g < 80 && b < 80;      // near-black / deep pine
      };
      const chain = [];
      let el = room;
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) chain.push({ tag: el.tagName, bg: bg(el), ink: inkish(bg(el)) });
      return { room: bg(room), desk: bg(desk), roomInk: inkish(bg(room)), deskInk: inkish(bg(desk)), chain };
    });
    ok("the Agent page draws", !!agent, agent);
    if (agent) {
      ok("the Agent's ground is NOT dark green / ink", !agent.roomInk, agent.room);
      ok("…and its card is white, like every other screen", /rgb\(255,\s*255,\s*255\)/.test(agent.desk), agent.desk);
      ok("…and nothing above it in the column is ink either",
         agent.chain.every(c => !c.ink), agent.chain);
    }
    await shot(page, "agent-1440");

    // ── 4 · THE PROFILE'S CHIPS, AND 2 · THE JOURNEY RAIL ────────────────
    console.log("\n— 1440 · the donor profile —");
    // A WALK THAT CANNOT BE RUN TWICE IS HALF A WALK. This one PUTS somebody
    // in a journey, so picking "the first donor" tested the add-to-journey
    // rail on run one and the chip on run two. Pick somebody with no active
    // plan, and if the whole org is in journeys, say so rather than pass.
    const donors = await api("/donors?limit=60", {}, token);
    const list = donors.body.donors || donors.body || [];
    let donorId = null;
    for (const d of list) {
      const p = await api(`/donors/${d.id}/plan`, {}, token);
      if (!p.body.plan || p.body.plan.status !== "active") { donorId = d.id; break; }
    }
    ok("there is a donor not yet in a journey to walk the rail on", !!donorId, list.length);
    await page.goto(APP + "/donors/" + donorId, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid='role-chips']", { timeout: 10000 }).catch(() => {});

    const chipBefore = await page.evaluate(() => {
      const c = document.querySelector("[data-testid='role-chip-donor']");
      return c ? { shadow: getComputedStyle(c).boxShadow, border: getComputedStyle(c).borderBottomColor } : null;
    });
    await page.locator("[data-testid='role-chip-donor']").click().catch(() => {});
    await page.waitForTimeout(400);
    const chipAfter = await page.evaluate(() => {
      const out = [];
      for (const c of document.querySelectorAll("[data-testid^='role-chip-']")) {
        const s = getComputedStyle(c);
        out.push({ id: c.dataset.testid, shadow: s.boxShadow, outline: s.outlineStyle, borderB: s.borderBottomWidth });
      }
      return out;
    });
    const greenBar = s => /inset/.test(s || "") && /13,\s*92,\s*58/.test(s || "");
    ok("clicking the stage chip leaves NO green bar under it",
       !!chipAfter.length && !greenBar(chipAfter.find(c => c.id === "role-chip-donor")?.shadow), { chipBefore, chipAfter });
    ok("…and no other chip in the header carries one either",
       chipAfter.every(c => !greenBar(c.shadow)), chipAfter);

    const railJourney = await page.locator("[data-testid='dp-rail-add-journey']").count();
    ok("the rail offers 'Add to a journey' when they are in none", railJourney === 1, railJourney);
    if (railJourney) {
      await page.selectOption("[data-testid='dp-journey-pick']", journeyId).catch(() => {});
      await page.waitForSelector("[data-testid='dp-journey-preview']", { timeout: 8000 }).catch(() => {});
      const previewed = await page.locator("[data-testid='dp-journey-preview-due']").count();
      ok("…and picking one shows their first step AND its date, before anything is written", previewed === 1);
      await page.locator("[data-testid='dp-journey-add-confirm']").click().catch(() => {});
      await page.waitForSelector("[data-testid='dp-journey-chip']", { timeout: 10000 }).catch(() => {});
      const chip = await page.locator("[data-testid='dp-journey-chip']").count();
      ok("…and once they are in it, the chip names the journey", chip === 1);
      const chipText = chip ? (await page.locator("[data-testid='dp-journey-chip']").innerText()) : "";
      ok("…with the journey's own name on it", /New donor, first year/i.test(chipText), chipText);
    }
    await shot(page, "profile-rail-1440");

    ok("nothing on fire at 1440", errors.length === 0, errors.slice(0, 4));
    await ctx.close();
  }

  // ── 390 ─────────────────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text() + " <" + ((m.location() || {}).url || "?") + ">"); });

    console.log("\n— 390 · the journey builder becomes a list —");
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Journeys\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-testid='journey-builder']", { timeout: 10000 }).catch(() => {});
    await page.locator("[data-testid='journey-row'] button").first().click().catch(() => {});
    await page.waitForTimeout(800);
    const mobile = await page.evaluate(() => {
      const spine = document.querySelector("[data-testid='jb-spine']");
      const items = document.querySelectorAll("[data-testid^='jb-item-']");
      return {
        spineShown: spine ? getComputedStyle(spine).display !== "none" : null,
        items: items.length,
        pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok("at 390 the spine is gone and the vertical list is there", mobile.spineShown === false && mobile.items === 7, mobile);
    ok("…and the page does not scroll sideways", mobile.pageScrollX <= 0, mobile.pageScrollX);
    await shot(page, "journey-builder-390");

    console.log("\n— 390 · the Agent page —");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Agent\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-testid='agent-room']", { timeout: 10000 }).catch(() => {});
    const agent390 = await page.evaluate(() => {
      const room = document.querySelector("[data-testid='agent-room']");
      // The room is transparent by design, so this asks what is ACTUALLY
      // painted behind it: the nearest ancestor with an opaque background.
      let el = room, painted = null;
      while (el) {
        const c = getComputedStyle(el).backgroundColor;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || "");
        if (m && (m[4] === undefined || Number(m[4]) > 0)) { painted = { c, r: +m[1], g: +m[2], b: +m[3] }; break; }
        el = el.parentElement;
      }
      return { bg: painted && painted.c, ink: !!painted && painted.r < 80 && painted.g < 80 && painted.b < 80 };
    });
    ok("the Agent's ground is not ink at 390 either", agent390.ink === false, agent390);
    await shot(page, "agent-390");

    ok("nothing on fire at 390", errors.length === 0, errors.slice(0, 4));
    await ctx.close();
  }

  // ── THE PRICING SECTION, BOTH TOGGLE STATES ─────────────────────────────
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text() + " <" + ((m.location() || {}).url || "?") + ">"); });
    console.log(`\n— ${width} · the pricing section —`);
    await page.goto(APP + "/pricing", { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid='pricing-section']", { timeout: 10000 }).catch(() => {});

    const names = await page.locator("[data-testid^='pricing-name-']").allTextContents();
    ok(`${width}: the tiers are Seed, Sapling, Orchard, Forest`,
       ["Seed", "Sapling", "Orchard", "Forest"].every(n => names.includes(n)), names);
    // BOTH grounds: the page's own root AND `body`, because index.html
    // paints body ink and an overscroll on a phone shows it.
    const ground = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      root: getComputedStyle(document.querySelector("[data-testid='pricing-section']").parentElement).backgroundColor,
    }));
    const isInk = c => /rgb\(15,\s*26,\s*18\)/.test(c || "");
    ok(`${width}: the pricing ground is cream, not ink`, !isInk(ground.root) && !isInk(ground.body), ground);

    const monthly = await page.locator("[data-testid='pricing-amount-t5000']").innerText();
    ok(`${width}: monthly shows Sapling at $299`, monthly.trim() === "$299", monthly);
    // The selected tab is ink.
    const tab = await page.evaluate(() => {
      const b = document.querySelector("[data-testid='pricing-interval-monthly']");
      return b && getComputedStyle(b).backgroundColor;
    });
    ok(`${width}: the selected toggle tab is ink`, /rgb\(15,\s*26,\s*18\)/.test(tab || ""), tab);
    await shot(page, `pricing-monthly-${width}`);

    await page.locator("[data-testid='pricing-interval-yearly']").click();
    await page.waitForTimeout(250);
    const yearly = await page.locator("[data-testid='pricing-amount-t5000']").innerText();
    ok(`${width}: yearly shows Sapling at $2,990`, yearly.trim() === "$2,990", yearly);
    const groups = await page.locator("[data-testid='pricing-included'] > div").count();
    ok(`${width}: the four included groups are there`, groups === 4, groups);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${width}: no horizontal scroll`, noScroll <= 0, noScroll);
    await shot(page, `pricing-yearly-${width}`);

    ok(`${width}: nothing on fire on the pricing page`, errors.length === 0, errors.slice(0, 4));
    await ctx.close();
  }

  // The landing header's two buttons.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP + "/", { waitUntil: "networkidle" });
    const book = await page.locator("[data-testid='lp-nav-book']").count();
    ok("Book a call sits beside Start now in the landing header", book === 1, book);
    await ctx.close();
  }

  await browser.close();
  console.log(`\nfix4-walk — ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots: " + shots.join("\n             "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
