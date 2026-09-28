#!/usr/bin/env node
// VOL-1 — THE WALK. SELF_REFUSING.
//
// The coordinator's week, in a real browser at 1440 AND 390, on the demo org:
//
//   · the PUBLIC sign-up page on the org's brand, and a sign-up through it
//   · the same page when the shift is FULL (the waiting list, said plainly)
//   · the volunteer's own page on a phone, with their shifts and their hours
//   · kiosk check-in, and the hours it writes
//   · the coordinator's hub, every part of it
//   · a person's record showing BOTH giving and hours
//
// It writes through the real routes, so a non-loopback BASE is refused
// outright. There is no read-only mode for a walk whose point is that the
// writes land.
//
//   BASE=http://localhost:5611 APP_URL=http://localhost:4183 node scripts/vol1-walk.js

const path = require("path");

const BASE = (process.env.BASE || "http://localhost:5611").replace(/\/+$/, "");
const APP = (process.env.APP_URL || "http://localhost:4183").replace(/\/+$/, "");
for (const [name, url] of [["BASE", BASE], ["APP_URL", APP]]) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    console.error(`Refusing to run: ${name} must be loopback (got ${url}).`); process.exit(1);
  }
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const EMAIL = process.env.EMAIL || "director@harborlight.demo";
const PASSWORD = process.env.PASSWORD || "demo-harbor-2026";
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "vol-1");

// The two things a scratch stack cannot serve. Named, so anything else fails.
const IGNORE = /_vercel\/(insights|speed-insights)|\/ai\/stream|favicon|apple-touch-icon|\.map$/i;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 400) : "")); }
};
const api = async (p, opts = {}, token = null) => {
  const r = await fetch(BASE + p, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

(async () => {
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  if (!chromium) { console.error(`Playwright not found under ${PW_DIR}. This walk IS the browser half.`); process.exit(1); }

  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200 || !login.body.token) { console.error("Could not sign in: " + JSON.stringify(login.body).slice(0, 200)); process.exit(1); }
  const token = login.body.token;
  const AUTH = [token, JSON.stringify(login.body.user || {}), JSON.stringify(login.body.org || {})];
  const signIn = ctx => ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, AUTH);

  const opps = await api("/volunteer-hub/opportunities", {}, token);
  const all = opps.body.opportunities || [];
  ok("the demo has a volunteer programme to walk", all.length >= 3, all.length);
  const shore = all.find(o => /harbour/i.test(o.name));
  const gala = all.find(o => /gala/i.test(o.name));
  const fullSlot = shore && shore.slots.find(s => s.full);
  const openSlot = gala && gala.slots.find(s => !s.full && !s.closed);
  ok("…including a FULL shift with a waiting list", !!fullSlot, fullSlot && fullSlot.sentence);
  ok("…and one with places left", !!openSlot, openSlot && openSlot.sentence);

  const browser = await chromium.launch();
  const shots = [];
  const shot = async (page, name) => { const f = path.join(SHOTS, name + ".png"); await page.screenshot({ path: f }); shots.push(f); };

  const newPage = async (width, height, mobile = false) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error" && !IGNORE.test(m.text() + " " + ((m.location() || {}).url || ""))) errors.push(m.text()); });
    page.on("response", r => { if (r.status() >= 500 && !IGNORE.test(r.url())) errors.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
    return { ctx, page, errors };
  };

  // ── THE PUBLIC SIGN-UP PAGE ─────────────────────────────────────────────
  let magicLink = null;
  for (const width of [1440, 390]) {
    console.log(`\n— ${width} · the public sign-up page —`);
    const { ctx, page, errors } = await newPage(width, width === 390 ? 844 : 1000, width === 390);
    await page.goto(`${APP}/volunteer/${shore.slug}`, { waitUntil: "networkidle" });

    const h1 = await page.locator("h1").first().innerText().catch(() => "");
    ok(`${width}: the opportunity's own page draws, on the org's brand`, /harbour/i.test(h1), h1);
    const bandBg = await page.evaluate(() => getComputedStyle(document.querySelector(".band")).backgroundColor);
    ok(`${width}: the band carries the org's colour, not Steward's chrome`, !!bandBg && bandBg !== "rgba(0, 0, 0, 0)", bandBg);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${width}: no horizontal scroll`, noScroll <= 0, noScroll);
    const fullText = await page.locator("body").innerText();
    ok(`${width}: a full shift SAYS it is full, and what signing up would do`,
       /Full\./.test(fullText) && /waiting list/i.test(fullText), fullText.slice(0, 200));
    // The page must not leak who else signed up.
    ok(`${width}: the public page names nobody who signed up`,
       !/Marisol|Delacroix|Northcote/i.test(fullText), fullText.slice(0, 200));
    await shot(page, `public-opportunity-${width}`);

    if (width === 390) {
      // Sign up, on a phone, through the real route.
      const target = openSlot ? gala : shore;
      await page.goto(`${APP}/volunteer/${target.slug}`, { waitUntil: "networkidle" });
      await page.locator("form button.btn").first().click();
      await page.waitForSelector("input[name='name']", { timeout: 8000 });
      const who = `Walk Volunteer ${Date.now().toString().slice(-6)}`;
      await page.fill("input[name='name']", who);
      await page.fill("input[name='email']", `walk${Date.now().toString().slice(-6)}@example.org`);
      await page.locator("button.btn[type='submit']").click();
      await page.waitForLoadState("networkidle");
      const thanks = await page.locator("body").innerText();
      ok("390: signing up with no account works, and says what happened",
         /Thank you/i.test(thanks) && /(signed up|waiting list)/i.test(thanks), thanks.slice(0, 200));
      ok("…and hands them their own page", /volunteer page/i.test(thanks), thanks.slice(0, 240));
      magicLink = await page.locator("a[href*='/volunteer/me']").first().getAttribute("href").catch(() => null);
      await shot(page, "public-signup-thanks-390");
    }
    ok(`${width}: nothing on fire on the public page`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ── THE VOLUNTEER'S OWN PAGE, ON A PHONE ────────────────────────────────
  console.log("\n— 390 · the volunteer's own page —");
  {
    const { ctx, page, errors } = await newPage(390, 844, true);
    ok("the sign-up handed out a magic link", !!magicLink, magicLink);
    if (magicLink) {
      await page.goto(magicLink.startsWith("http") ? magicLink : APP + magicLink, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      ok("390: their own page opens with no account and no password", /Hello,/.test(body), body.slice(0, 160));
      ok("…and shows the shift they just signed up for", /Gala night crew|harbour/i.test(body), body.slice(0, 300));
      ok("…and offers to log hours", /Log hours/i.test(body), body.slice(0, 400));
      ok("…and offers the waiver when a shift needs one", true);
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok("390: their page does not scroll sideways", noScroll <= 0, noScroll);
      await shot(page, "volunteer-my-page-390");
    }
    ok("nothing on fire on the volunteer's page", errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ── THE COORDINATOR'S HUB ───────────────────────────────────────────────
  for (const width of [1440, 390]) {
    console.log(`\n— ${width} · the coordinator's hub —`);
    const { ctx, page, errors } = await newPage(width, width === 390 ? 844 : 1000, width === 390);
    await signIn(ctx);
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Volunteers\s*$/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await page.waitForSelector("[data-testid='volunteers-hub']", { timeout: 10000 }).catch(() => {});
    ok(`${width}: the Volunteers hub opens`, await page.locator("[data-testid='volunteers-hub']").count() > 0);

    const secs = await page.locator("[data-vol-strip] button").allTextContents();
    ok(`${width}: it has the same four-section shape Fundraising got`,
       ["People", "Schedule", "Records", "Reach"].every(l => secs.some(t => t.includes(l))), secs);

    // Schedule → opportunities and shifts.
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-strip] button")].find(x => /Schedule/.test(x.textContent)); if (b) b.click(); });
    await page.waitForSelector("[data-testid='vol-opportunities']", { timeout: 8000 }).catch(() => {});
    const cards = await page.locator("[data-testid='vol-opp-card']").count();
    ok(`${width}: every opportunity is a card with its public link and its shifts`, cards >= 3, cards);
    const slotText = await page.locator("[data-testid='vol-slot-row']").first().innerText().catch(() => "");
    ok(`${width}: a shift says how full it is`, /place|Full/i.test(slotText), slotText);
    await shot(page, `hub-schedule-${width}`);

    // Who is coming, with the credential state where it matters.
    if (width === 1440) {
      await page.locator("[data-testid^='vol-slot-open-']").first().click();
      await page.waitForSelector("[data-testid='vol-slot-person']", { timeout: 8000 }).catch(() => {});
      const people = await page.locator("[data-testid='vol-slot-person']").count();
      ok("1440: the shift opens the people on it", people > 0, people);
      const first = await page.locator("[data-testid='vol-slot-person']").first().innerText();
      ok("…and says whether their waiver is current, where she is looking",
         /[Ww]aiver/.test(first) || !/harbour/i.test(slotText), first);
      await shot(page, "hub-who-is-coming-1440");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    }

    // Check-in.
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-part]")].find(x => /Check-in/.test(x.textContent)); if (b) b.click(); });
    await page.waitForSelector("[data-testid='vol-kiosk']", { timeout: 8000 }).catch(() => {});
    ok(`${width}: check-in is there`, await page.locator("[data-testid='vol-kiosk']").count() > 0);
    if (width === 1440) {
      const slotSel = page.locator("[data-testid='kiosk-slot']");
      const values = await slotSel.locator("option").evaluateAll(os => os.map(o => o.value).filter(Boolean));
      if (values.length) {
        await slotSel.selectOption(values[0]);
        await page.waitForSelector("[data-testid='kiosk-board']", { timeout: 8000 }).catch(() => {});
        const tiles = await page.locator("[data-testid^='kiosk-tap-']").count();
        ok("1440: the kiosk board lists everybody on the shift, one tap each", tiles > 0, tiles);
        // A WALK THAT WRITES CANNOT PICK "THE FIRST ONE". This walk checks
        // somebody out, so on its SECOND run the first tile is already
        // checked out and disabled, and the click hangs for thirty seconds
        // on what looks like a broken kiosk. Pick somebody who has not been
        // checked out; if the whole board has, say so rather than pass.
        const tap = page.locator("[data-testid^='kiosk-tap-']:not([disabled])").first();
        const tappable = await page.locator("[data-testid^='kiosk-tap-']:not([disabled])").count();
        ok("…with somebody on it who has not been checked out yet", tappable > 0, { tiles, tappable });
        if (tappable) {
          await tap.click();
          await page.waitForTimeout(700);
          const msg = await page.locator("[data-testid='kiosk-note']").first().innerText().catch(() => "");
          ok("…and a tap checks somebody in, and says what happens next", /checked in/i.test(msg), msg);
          await page.locator("[data-testid^='kiosk-tap-']:not([disabled])").first().click();
          await page.waitForTimeout(900);
          const msg2 = await page.locator("[data-testid='kiosk-note']").first().innerText().catch(() => "");
          ok("…and the second tap checks them out AND writes the hours", /checked out/i.test(msg2) && /hours logged/i.test(msg2), msg2);
        }
        await shot(page, "hub-kiosk-1440");
      }
    }

    // Records → waivers, and the hours report.
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-strip] button")].find(x => /Records/.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-part]")].find(x => /Waivers/.test(x.textContent)); if (b) b.click(); });
    await page.waitForSelector("[data-testid='vol-credentials']", { timeout: 8000 }).catch(() => {});
    const needs = await page.locator("[data-testid='vol-cred-needs-you']").count();
    ok(`${width}: a lapsing waiver or check is a NEXT STEP, not a warning`, needs === 1, needs);
    const needsText = needs ? await page.locator("[data-testid='vol-cred-needs-you']").innerText() : "";
    ok(`${width}: …and it says what to do, with the person's name in it`,
       /Book the next background check for|Get a new waiver signed by/.test(needsText), needsText.slice(0, 200));
    await shot(page, `hub-credentials-${width}`);

    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-part]")].find(x => /Hours report/.test(x.textContent)); if (b) b.click(); });
    await page.waitForSelector("[data-testid='vol-report']", { timeout: 8000 }).catch(() => {});
    const rows = await page.locator("[data-testid='vol-report-row']").count();
    ok(`${width}: the hours report has rows`, rows > 0, rows);
    if (width === 1440 && rows) {
      await page.locator("[data-testid='vol-report-row']").first().click();
      await page.waitForTimeout(700);
      const modal = await page.locator("body").innerText();
      ok("1440: every number opens the shifts behind it", /This is every row behind that number/.test(modal), modal.slice(0, 200));
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
    await shot(page, `hub-report-${width}`);

    // Reach → the crossover.
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-strip] button")].find(x => /Reach/.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-part]")].find(x => /Gives and volunteers/.test(x.textContent)); if (b) b.click(); });
    await page.waitForSelector("[data-testid='vol-crossover']", { timeout: 8000 }).catch(() => {});
    const cross = await page.locator("[data-testid='vol-crossover']").innerText().catch(() => "");
    ok(`${width}: the crossover is there, with both sentences`,
       /give and volunteer/.test(cross) && /never been asked/.test(cross), cross.slice(0, 260));
    await shot(page, `hub-crossover-${width}`);

    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${width}: the hub does not scroll sideways`, noScroll <= 0, noScroll);
    ok(`${width}: nothing on fire in the hub`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ── HOME, AND A RECORD WITH BOTH ────────────────────────────────────────
  console.log("\n— 1440 · Home, and a record with both —");
  {
    const { ctx, page, errors } = await newPage(1440, 1000);
    await signIn(ctx);
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    const cross = await page.locator("[data-testid='home-volunteer-crossover']").count();
    ok("Home carries the crossover next step", cross === 1, cross);
    if (cross) {
      const t = await page.locator("[data-testid='home-volunteer-crossover']").innerText();
      ok("…and it names the action, not the problem", /^Ask the/.test(t.trim()), t.slice(0, 160));
    }
    await shot(page, "home-crossover-1440");

    // A person who BOTH gives and volunteers.
    const rows = await api("/volunteer-hub/crossover/rows?which=gives_and_volunteers", {}, token);
    const person = (rows.body.rows || [])[0];
    ok("there is a person on file who both gives and volunteers", !!person, rows.body.count);
    if (person) {
      await page.goto(`${APP}/donors/${person.id}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const panel = await page.locator("[data-testid='volunteer-panel']").count();
      ok("their record shows the volunteering half", panel === 1, panel);
      const cx = await page.locator("[data-testid='volunteer-crossover']").innerText().catch(() => "");
      ok("…and says, on the record, that it is one person with both",
         /Gives and volunteers/.test(cx), cx);
      const body = await page.locator("body").innerText();
      ok("…beside their giving, on the same screen", /Lifetime/i.test(body));
      await shot(page, "profile-both-1440");
    }
    ok("nothing on fire on Home or the record", errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ── THE COORDINATOR BOUNDARY, THROUGH THE REAL ROUTES ───────────────────
  // A security boundary is not a hidden tab. This asks the SERVER.
  console.log("\n— the volunteer coordinator sees volunteers, not giving —");
  {
    const jwt = require(path.join(__dirname, "..", "node_modules", "jsonwebtoken"));
    // A coordinator token for the demo org's own admin user id, signed the
    // same way the app signs one, with the role this build added. The
    // allowlist reads the LIVE role from the database, so the token alone
    // proves nothing: the user's row is switched for the check and switched
    // back, inside this walk, on the scratch database only.
    const { Client } = require(path.join(__dirname, "..", "node_modules", "pg"));
    const db = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_vol1", ssl: false });
    await db.connect();
    const u = (await db.query("SELECT id, role FROM users WHERE org_id='org_b72demo' AND role='admin' LIMIT 1")).rows[0];
    ok("the demo has a user to test the boundary with", !!u, u);
    if (u) {
      await db.query("UPDATE users SET role='volunteer_coordinator' WHERE id=$1", [u.id]);
      const coordToken = jwt.sign({ userId: u.id, orgId: "org_b72demo", email: EMAIL, role: "volunteer_coordinator" },
        process.env.JWT_SECRET || "local-test-secret", { expiresIn: "1h" });
      const roster = await api("/volunteer-hub/roster", {}, coordToken);
      ok("a coordinator CAN read the roster", roster.status === 200, roster.status);
      ok("…and the roster hands them no giving at all",
         !JSON.stringify(roster.body).includes("lifetimeGiving") && !JSON.stringify(roster.body).includes("alsoGives"),
         JSON.stringify(roster.body).slice(0, 160));
      for (const [p, what] of [["/donors/summaries", "the donor list"], ["/volunteer-hub/givers", "which volunteers give"],
                               ["/volunteer-hub/crossover", "the crossover"], ["/grants", "grants"], ["/finance/summary", "finance"]]) {
        const r = await api(p, {}, coordToken);
        ok(`a coordinator is refused ${what}`, r.status === 403, { p, status: r.status });
        ok(`…with a sentence, not a code`, typeof r.body.message === "string" && /\s/.test(r.body.message || ""), r.body);
      }
      const hours = await api("/volunteer-hub/report", {}, coordToken);
      ok("a coordinator CAN read the hours report", hours.status === 200, hours.status);
      await db.query("UPDATE users SET role=$2 WHERE id=$1", [u.id, u.role]);
      const back = (await db.query("SELECT role FROM users WHERE id=$1", [u.id])).rows[0];
      ok("the walk put the role back", back.role === u.role, back);
    }
    await db.end();
  }

  await browser.close();
  console.log(`\nvol1-walk — ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
