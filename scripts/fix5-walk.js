#!/usr/bin/env node
// FIX-5 — THE WALK. SELF_REFUSING.
//
// Five of the six items in this build are things a server suite physically
// cannot see: whether ONE line passes through the node centres, whether the
// timing labels and the dates each sit on a shared baseline, whether a long
// name pushes its own date down, whether the dark preview panel rides up into
// the chain, and whether choosing Major donor prints a red error. So this
// opens the real screens in a real browser at 1440 AND 390 and MEASURES them.
//
//   BASE=http://localhost:5701 APP_URL=http://localhost:4273 \
//   EMAIL=director@harborlight.demo PASSWORD=demo-harbor-2026 node scripts/fix5-walk.js
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
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "fix-5");
const IGNORE = /_vercel\/(insights|speed-insights)|\/ai\/stream|favicon|apple-touch-icon|\.map$/i;
// THE FOUR COLOURS. Terracotta is the one this build is about: it may appear on
// a destructive confirm and nowhere else on this screen.
const TERRACOTTA = /rgb\(184,\s*89,\s*63\)|rgb\(138,\s*58,\s*36\)/;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 500) : "")); }
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
    console.error(`Playwright not found under ${PW_DIR}. This walk is the browser half; there is no server-only mode.`);
    process.exit(1);
  }
  require("fs").mkdirSync(SHOTS, { recursive: true });

  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200 || !login.body.token) {
    console.error("Could not sign in as " + EMAIL + " — " + login.status + " " + JSON.stringify(login.body).slice(0, 200));
    process.exit(1);
  }
  const token = login.body.token;
  // The app reads THREE keys, not one: a token alone leaves it with no user and
  // no org and it bounces to /login, which looks exactly like a broken tab.
  const AUTH = [token, JSON.stringify(login.body.user || {}), JSON.stringify(login.body.org || {})];
  const signIn = ctx => ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, AUTH);

  const browser = await chromium.launch();
  const shots = [];

  async function screen(width, height) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await signIn(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text() + " <" + ((m.location() || {}).url || "?") + ">"); });
    page.on("response", r => { if (r.status() >= 500 && !IGNORE.test(r.url())) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
    return { ctx, page, errors };
  }
  const shot = async (page, name) => {
    const file = path.join(SHOTS, name + ".png");
    await page.screenshot({ path: file, fullPage: false });
    shots.push(file);
  };
  const toJourneys = async page => {
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Journeys\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-testid='journey-builder']", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  // ── 1440 ────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(1440, 1100);
    console.log("\n— 1440 · Journeys —");
    await toJourneys(page);
    ok("the builder is on the page", await page.locator("[data-testid='journey-builder']").count() > 0);

    // ── ITEM 1 · CREATE YOUR OWN, AT THE TOP ─────────────────────────────
    const createBtn = page.locator("[data-testid='jb-create-open']");
    ok("\"Create a journey\" is at the top of the page", await createBtn.count() === 1);
    const createBox = await createBtn.boundingBox().catch(() => null);
    const firstRow = await page.locator("[data-testid='journey-row']").first().boundingBox().catch(() => null);
    ok("…above the journeys, not below them", !!createBox && !!firstRow && createBox.y < firstRow.y,
       { create: createBox && Math.round(createBox.y), row: firstRow && Math.round(firstRow.y) });
    const createColor = await createBtn.evaluate(el => getComputedStyle(el).backgroundColor).catch(() => "");
    ok("…and it is the emerald action", /rgb\(13,\s*92,\s*58\)/.test(createColor), createColor);

    // ── ITEM 2 · IT OPENS ON ARRIVAL ─────────────────────────────────────
    ok("landing on Journeys has already opened a card (the chain is drawn, unclicked)",
       await page.locator("[data-testid='jb-spine']").count() === 1);

    // ── ITEM 3 · THE CHAIN, MEASURED ─────────────────────────────────────
    // ON THE SEVEN-STEP JOURNEY, DELIBERATELY. What opens on arrival is
    // whatever was edited last, which after one run of this walk is the
    // one-step journey the walk created — and a one-node chain passes every
    // question below without answering any of them.
    // Clicking the header TOGGLES, so an already-open card must be left alone:
    // on a freshly seeded demo this journey is the one that opened on arrival,
    // and clicking it shut is how this leg first measured a chain of nothing.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("[data-testid='journey-row']")]
        .find(r => /New donor, first year/.test(r.textContent || ""));
      if (row && !row.querySelector(".jb-chain-wrap")) row.querySelector("button").click();
    });
    await page.waitForTimeout(1600);
    const nodes = await page.locator("[data-testid^='jb-node-']:not([data-testid*='label'])").count();
    ok("every step is a node on the chain", nodes >= 5, nodes);
    const geom = await page.evaluate(() => {
      const line = document.querySelector("[data-testid='jb-chain']");
      const lr = line ? line.getBoundingClientRect() : null;
      const ns = [...document.querySelectorAll("[data-testid^='jb-node-']")]
        .filter(n => /^jb-node-\d+$/.test(n.dataset.testid))
        .map(n => { const r = n.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, state: n.dataset.state }; });
      const labels = [...document.querySelectorAll("[data-testid^='jb-node-label-']")].map(n => n.getBoundingClientRect());
      const wrap = document.querySelector(".jb-chain-wrap").getBoundingClientRect();
      const grid = document.querySelector(".jb-grid").getBoundingClientRect();
      // the timing captions (grid row 1) and the dates (grid row 4)
      const caps = [...document.querySelectorAll(".jb-chain-wrap > div > div")]
        .filter(d => d.getBoundingClientRect().height > 0);
      return {
        line: lr && { y: lr.y + lr.height / 2, x0: lr.x, x1: lr.x + lr.width, h: lr.height },
        nodes: ns, labels: labels.map(r => ({ top: r.y, bottom: r.y + r.height, x: r.x, w: r.width })),
        wrap: { x: wrap.x, y: wrap.y, bottom: wrap.y + wrap.height, w: wrap.width },
        grid: { y: grid.y },
        capCount: caps.length,
      };
    });
    ok("there is exactly ONE line", !!geom.line && geom.line.h <= 3, geom.line);
    // THE SELECTED NODE IS DELIBERATELY RAISED, so it is measured separately:
    // every other node's centre is ON the line, and the selected one is lifted
    // off it by a few pixels, which is the whole point of "clearly raised".
    const resting = geom.nodes.filter(n => n.state !== "selected");
    // Math.max() of nothing is -Infinity, and -Infinity <= 1 is a PASS. That is
    // how this guard first went green against a one-node chain with its only
    // node selected. It now refuses to answer when there is nothing to measure.
    const offCentre = geom.line && resting.length >= 2
      ? Math.max(...resting.map(n => Math.abs(n.cy - geom.line.y))) : 99;
    ok("the line passes through the node centres (within 1px)", offCentre <= 1,
       { offCentre, resting: resting.length });
    const lifted = geom.line ? (geom.nodes.find(n => n.state === "selected") || {}).cy : null;
    ok("…and the selected node is visibly raised off it",
       lifted !== null && geom.line.y - lifted >= 2, { lift: lifted !== null && Math.round(geom.line.y - lifted) });
    // Edge to edge: the line reaches both edges of the card, not just the padded area.
    const card = await page.evaluate(() => {
      const r = document.querySelector(".jb-chain-wrap").closest("[data-testid='journey-row']").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    ok("the line runs edge to edge across the card",
       !!geom.line && geom.line.x0 <= card.x + 1 && geom.line.x1 >= card.x + card.width - 1,
       { line: geom.line && [Math.round(geom.line.x0), Math.round(geom.line.x1)], card: [Math.round(card.x), Math.round(card.x + card.width)] });
    // Shared baselines: every name starts at the same y, and so does every date.
    const nameTops = geom.labels.map(l => Math.round(l.top));
    ok("every step name sits on one shared baseline", new Set(nameTops).size === 1, nameTops);
    const dateTops = await page.evaluate(() => {
      const g = document.querySelector(".jb-chain-wrap > div");
      return [...g.children].filter(c => getComputedStyle(c).gridRow.startsWith("4"))
        .map(c => Math.round(c.getBoundingClientRect().y));
    });
    ok("every date sits on one shared baseline", dateTops.length > 1 && new Set(dateTops).size === 1, dateTops);
    // Nodes do not collide: adjacent centres are at least a node's width apart.
    const gaps = geom.nodes.slice(1).map((n, i) => n.cx - geom.nodes[i].cx);
    ok("no two nodes collide", gaps.every(g => g >= 24), gaps.map(Math.round));
    ok("…and no gap is a chasm beside a cramped one (widest is under 2.5x the narrowest)",
       gaps.length < 2 || Math.max(...gaps) / Math.min(...gaps) <= 2.5,
       { min: Math.round(Math.min(...gaps)), max: Math.round(Math.max(...gaps)) });
    // The states read at a glance.
    const states = geom.nodes.map(n => n.state);
    ok("the nodes carry a state each (selected / done / today / upcoming)",
       states.every(s => ["selected", "done", "today", "past", "upcoming"].includes(s)), states);
    ok("…and exactly one of them is the selected step", states.filter(s => s === "selected").length === 1, states);

    // ── ITEM 4 · NOTHING BLEEDS ──────────────────────────────────────────
    ok("the chain sits entirely above the two columns under it", geom.wrap.bottom <= geom.grid.y + 1,
       { chainBottom: Math.round(geom.wrap.bottom), gridTop: Math.round(geom.grid.y) });
    const rail = await page.evaluate(() => {
      const wrap = document.querySelector(".jb-chain-wrap").getBoundingClientRect();
      const dark = [...document.querySelectorAll(".jb-grid > div")]
        .find(d => getComputedStyle(d).backgroundColor === "rgb(15, 26, 18)");
      const r = dark ? dark.getBoundingClientRect() : null;
      return r ? { top: r.y, chainBottom: wrap.y + wrap.height } : null;
    });
    ok("the dark live-preview panel does not ride up into the chain",
       !!rail && rail.top >= rail.chainBottom - 1,
       rail && { previewTop: Math.round(rail.top), chainBottom: Math.round(rail.chainBottom) });
    const rows = await page.evaluate(() => {
      // THE OPEN CARD, not the first row: the card that opens on arrival is
      // whichever one was edited last, and it is not always row one.
      const card = document.querySelector(".jb-chain-wrap").closest("[data-testid='journey-row']");
      const body = card.children[1];
      return [...body.children].map(c => { const r = c.getBoundingClientRect(); return { top: Math.round(r.y), bottom: Math.round(r.y + r.height) }; });
    });
    let overlap = null;
    for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) overlap = [rows[i - 1], rows[i]];
    ok("the card's rows never overlap each other", !overlap, overlap);

    // A LONG NAME WRAPS AND DOES NOT PUSH ITS DATE DOWN.
    await page.locator("[data-testid='jb-node-0']").click();
    await page.waitForTimeout(250);
    await page.locator("[data-testid='jb-label']").fill("Call to say thank you and ask how they first heard about the harbour programme");
    await page.waitForTimeout(500);
    const wrapped = await page.evaluate(() => {
      const g = document.querySelector(".jb-chain-wrap > div");
      const names = [...g.children].filter(c => getComputedStyle(c).gridRow.startsWith("3")).map(c => c.getBoundingClientRect());
      const dates = [...g.children].filter(c => getComputedStyle(c).gridRow.startsWith("4")).map(c => Math.round(c.getBoundingClientRect().y));
      const scrollW = document.documentElement.scrollWidth, clientW = document.documentElement.clientWidth;
      return { firstNameLines: Math.round(names[0].height), dateTops: [...new Set(dates)], overflow: scrollW - clientW,
               firstNameRight: Math.round(names[0].x + names[0].width), secondNameLeft: Math.round(names[1].x) };
    });
    ok("a long name WRAPS rather than widening its column", wrapped.firstNameRight <= wrapped.secondNameLeft + 1, wrapped);
    ok("…and every date is still on one shared baseline", wrapped.dateTops.length === 1, wrapped.dateTops);
    ok("…and the card still does not scroll sideways", wrapped.overflow <= 0, wrapped.overflow);
    await shot(page, "1440-chain");

    // ── ITEM 5 · HIGHLY CUSTOMIZABLE ─────────────────────────────────────
    for (const [label, tid] of [["its name", "jb-name"], ["its one line", "jb-description"],
                                ["the trigger", "jb-trigger"], ["its priority", "jb-priority"],
                                ["the step's timing value", "jb-timing-value"], ["the unit", "jb-timing-unit"],
                                ["what it counts from", "jb-timing-from"], ["the owner", "jb-owner"],
                                ["the draft", "jb-draft"], ["the note", "jb-note"]]) {
      ok(`${label} is editable in place`, await page.locator(`[data-testid='${tid}']`).count() === 1);
    }
    ok("a step can be duplicated", await page.locator("[data-testid='jb-duplicate-step']").count() === 1);
    ok("the whole journey can be duplicated", await page.locator("[data-testid='jb-duplicate']").count() === 1);
    ok("it can be removed", await page.locator("[data-testid='jb-delete']").count() === 1);
    // The first step cannot count from a step that does not exist.
    ok("the first step's \"counted from\" is locked to the trigger",
       await page.locator("[data-testid='jb-timing-from']").isDisabled());

    // RETIMING IN WEEKS MOVES THE NODE.
    await page.locator("[data-testid='jb-node-1']").click();
    await page.waitForTimeout(200);
    await page.locator("[data-testid='jb-timing-from']").selectOption("previous");
    await page.locator("[data-testid='jb-timing-unit']").selectOption("weeks");
    // Read what is there and MOVE it, so this walk says the same thing on a
    // database it has already edited once. A hardcoded "3" passed the first run
    // and then compared 3 against the 3 it had saved itself.
    const wasValue = Number(await page.locator("[data-testid='jb-timing-value']").inputValue()) || 0;
    const nowValue = (wasValue % 6) + 2;
    await page.locator("[data-testid='jb-timing-value']").fill(String(nowValue));
    await page.waitForTimeout(500);
    const afterWord = (await page.locator("[data-testid='jb-node-1']").getAttribute("aria-label")) || "";
    ok("retiming a step relabels its node from the timing she typed",
       afterWord.includes(`+${nowValue} week`), { wasValue, nowValue, afterWord });

    // CHANGES TO AN ON JOURNEY SHOW WHO THEY AFFECT BEFORE SAVING.
    const isOn = await page.evaluate(() => {
      const card = document.querySelector(".jb-chain-wrap").closest("[data-testid='journey-row']");
      return [...card.querySelectorAll("span")].some(sp => (sp.textContent || "").trim() === "On");
    });
    ok("the journey being walked is On", isOn);
    await page.locator("[data-testid='jb-save']").click();
    await page.waitForTimeout(900);
    const moveLine = await page.locator("[data-testid='jb-affects-move']").textContent().catch(() => "");
    ok("saving an On journey says who the change reaches, with a count",
       /moves \d+ (person's|people's) next step/.test(moveLine), moveLine);
    ok("…and the people behind that count open", await page.locator("[data-testid='jb-affects-rows']").count() === 1);
    // NO RED ON A CHANGE THAT DESTROYS NOTHING.
    const redOnConfirm = await page.evaluate(t => {
      const m = [...document.querySelectorAll("[role='dialog'], [data-testid]")].find(d => /Before you save/.test(d.textContent || ""));
      const scope = m || document.body;
      return [...scope.querySelectorAll("*")].some(el => {
        const s = getComputedStyle(el);
        return new RegExp(t).test(s.color) || new RegExp(t).test(s.backgroundColor);
      });
    }, TERRACOTTA.source);
    ok("nothing on that confirm is red (it destroys nothing)", !redOnConfirm);
    await shot(page, "1440-affects");
    await page.locator("[data-testid='jb-save-only-new']").click();
    await page.waitForTimeout(1200);
    ok("…and it saves", await page.locator("[data-testid='jb-affects-move']").count() === 0);

    // ── ITEM 6 · MAJOR DONOR, NO RED ERROR ───────────────────────────────
    console.log("\n— 1440 · Major donor asks for the number —");
    await page.locator("[data-testid='jb-preset-major_donor']").click();
    await page.waitForTimeout(1400);
    const amount = page.locator("[data-testid='jb-new-amount']");
    ok("choosing Major donor asks what a big gift is here", await amount.count() === 1);
    const prefill = await amount.inputValue().catch(() => "");
    ok("…prefilled with a suggestion from their own data", Number(prefill) > 0, prefill);
    const suggestionLine = await page.evaluate(() =>
      (document.body.textContent.match(/The top tenth of your [\d,]+ gifts start at about \$[\d,]+\./) || [""])[0]);
    ok("…and it says where the number came from", /top tenth/.test(suggestionLine), suggestionLine);
    ok("…with the gifts behind it one click away", await page.locator("[data-testid='jb-new-amount-rows']").count() === 1);
    const redOnMajor = await page.evaluate(t => {
      const roots = [...document.querySelectorAll("[data-testid='journey-builder'], [role='dialog']")];
      return roots.flatMap(root => [...root.querySelectorAll("*")]).filter(el => {
      const s = getComputedStyle(el);
        return (new RegExp(t).test(s.color) || new RegExp(t).test(s.backgroundColor)) && el.children.length === 0
               && (el.textContent || "").trim().length > 0;
      }).map(el => ({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 90) }));
    }, TERRACOTTA.source);
    ok("NOTHING IS RED: it is a question, not an error", redOnMajor.length === 0, redOnMajor);
    await shot(page, "1440-major-donor");
    // The rows behind the suggestion really open.
    await page.locator("[data-testid='jb-new-amount-rows']").click();
    await page.waitForTimeout(600);
    const rowsOpened = await page.evaluate(() => /Gifts that size or larger/.test(document.body.textContent || ""));
    ok("…and clicking it opens the gifts", rowsOpened);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // CREATE ONE FROM SCRATCH, THROUGH THE SCREEN.
    console.log("\n— 1440 · create one from scratch —");
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await toJourneys(page);
    await page.locator("[data-testid='jb-create-open']").click();
    await page.waitForTimeout(500);
    await page.locator("[data-testid='jb-new-name']").fill("Volunteer who gave, first month");
    await page.locator("[data-testid='jb-new-description']").fill("They give and they show up. Say both.");
    await page.locator("[data-testid='jb-new-trigger']").selectOption("new_volunteer");
    await page.waitForTimeout(400);
    await page.locator("[data-testid='jb-new-cond-volunteers']").click();
    await page.waitForTimeout(300);
    await page.locator("[data-testid='jb-new-create']").click();
    await page.waitForTimeout(1800);
    const madeIt = await page.evaluate(() => /Volunteer who gave, first month/.test(document.body.textContent || ""));
    ok("a journey created from scratch appears, opened, with its chain", madeIt);
    ok("…and its chain is drawn", await page.locator("[data-testid='jb-spine']").count() === 1);
    const savedName = await page.locator("[data-testid='jb-name']").inputValue().catch(() => "");
    ok("…and the card opened is the new one", savedName === "Volunteer who gave, first month", savedName);
    await shot(page, "1440-created");

    // PRESSING A PRESET THAT IS ALREADY HERE ASKS, NEVER DUPLICATES SILENTLY.
    const before = await page.locator("[data-testid='journey-row']").count();
    await page.locator("[data-testid='jb-preset-new_donor_first_year']").click();
    await page.waitForTimeout(900);
    const asked = await page.evaluate(() => /You already have .*Open it, or make a copy\?/s.test(document.body.textContent || ""));
    ok("a preset you already have asks \"Open it, or make a copy?\"", asked);
    ok("…and offers both doors", await page.locator("[data-testid='jb-preset-open-existing']").count() === 1
                                && await page.locator("[data-testid='jb-preset-copy']").count() === 1);
    await shot(page, "1440-already-have");
    await page.locator("[data-testid='jb-preset-open-existing']").click();
    await page.waitForTimeout(1200);
    const after = await page.locator("[data-testid='journey-row']").count();
    ok("…and nothing was duplicated silently", after === before, { before, after });

    ok("no console error, page error or 5xx at 1440", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  // ── 390 ─────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(390, 844);
    console.log("\n— 390 · Journeys —");
    await toJourneys(page);
    ok("the builder is on the page at 390", await page.locator("[data-testid='journey-builder']").count() > 0);
    ok("\"Create a journey\" is still there", await page.locator("[data-testid='jb-create-open']").count() === 1);
    const stacked = await page.evaluate(() => {
      const chain = document.querySelector(".jb-chain-wrap");
      const list = document.querySelector(".jb-list");
      const grid = document.querySelector(".jb-grid");
      return {
        chainHidden: !chain || getComputedStyle(chain).display === "none",
        listShown: !!list && getComputedStyle(list).display !== "none",
        cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok("the chain becomes a vertical list", stacked.chainHidden && stacked.listShown, stacked);
    ok("the two columns become one", stacked.cols === 1, stacked.cols);
    ok("nothing scrolls sideways", stacked.overflow <= 0, stacked.overflow);
    // Open the SEVEN-STEP one deliberately: what opens on arrival is whatever
    // was edited last, and a one-step journey proves nothing about a list.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("[data-testid='journey-row']")]
        .find(r => /New donor, first year/.test(r.textContent || ""));
      if (row && !row.querySelector(".jb-list")) row.querySelector("button").click();
    });
    await page.waitForTimeout(1400);
    const itemCount = await page.locator("[data-testid^='jb-item-']").count();
    ok("every step is in the list", itemCount >= 5, itemCount);
    ok("the step editor is still there", await page.locator("[data-testid='jb-step-editor']").count() === 1);
    await shot(page, "390-journeys");
    ok("no console error, page error or 5xx at 390", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  await browser.close();
  console.log(`\nfix5-walk: ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
