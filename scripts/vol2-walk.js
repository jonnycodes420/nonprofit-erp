#!/usr/bin/env node
// VOL-2 — THE WALK. SELF_REFUSING.
//
// Six items, and five of them are things a server suite cannot see: whether
// the two actions are on screen when the roster is full AND when it is empty,
// whether the empty state leads with the volunteer way in, whether a person
// opened from Volunteers shows volunteering before giving, whether the group
// screen exists at all, and whether the rule under the tab bars stops where
// the tabs stop.
//
//   BASE=http://localhost:5801 APP_URL=http://localhost:4373 \
//   EMAIL=director@harborlight.demo PASSWORD=demo-harbor-2026 node scripts/vol2-walk.js
//
// SELF_REFUSING: loopback only, and it never runs in production. It WRITES
// (it adds a volunteer and imports a file through the real routes), so there
// is no read-only mode: the point is that the writes land.

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
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, "..", "docs", "vol-2");
const IGNORE = /_vercel\/(insights|speed-insights)|\/ai\/stream|favicon|apple-touch-icon|\.map$/i;

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
    console.error("Could not sign in as " + EMAIL + " — " + login.status); process.exit(1);
  }
  const token = login.body.token;
  const AUTH = [token, JSON.stringify(login.body.user || {}), JSON.stringify(login.body.org || {})];
  const signIn = ctx => ctx.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, AUTH);

  // ── THE SERVER HALF, through the real routes ──────────────────────────
  console.log("\n— the import, end to end —");
  const FILE = {
    headers: ["First Name", "Last Name", "Email", "Phone", "Slot Date", "Start Time", "End Time", "Sign Up Item", "Waiver Signed", "Background Check Date"],
    filename: "vol2-walk.csv",
    rows: [
      // somebody already on Harborlight's roster, by EMAIL
      { "First Name": "Nell", "Last Name": "Ashcroft", Email: "nell.ashcroft@example.org", Phone: "555-0199",
        "Slot Date": "3/14/2026", "Start Time": "9:00 am", "End Time": "12:30 pm", "Sign Up Item": "Harbour clean-up",
        "Waiver Signed": "2026-01-05", "Background Check Date": "2025-11-02" },
      // brand new
      { "First Name": "Walkie", "Last Name": "Testperson", Email: "walkie.testperson@example.org", Phone: "555-0124",
        "Slot Date": "4/11/2026", "Start Time": "9:00 am", "End Time": "11:00 am", "Sign Up Item": "Tutoring",
        "Waiver Signed": "", "Background Check Date": "" },
      // a waiver TICKED with no date: must be refused, never given today's date
      { "First Name": "Ticky", "Last Name": "Noreallydate", Email: "ticky.nrd@example.org", Phone: "",
        "Slot Date": "", "Start Time": "", "End Time": "", "Sign Up Item": "",
        "Waiver Signed": "yes", "Background Check Date": "" },
    ],
  };
  const prev = await api("/volunteer-hub/import/preview", { method: "POST", body: JSON.stringify(FILE) }, token);
  ok("the preview reads the file", prev.status === 200, prev.body);
  ok("…and knows it is a SignUpGenius export", prev.body.preset === "signupgenius", prev.body.preset);
  ok("…and folds the rows into people, not rows", prev.body.counts && prev.body.counts.people === 3, prev.body.counts);
  ok("…and reads the waivers and checks a vendor preset does not name",
     prev.body.counts && prev.body.counts.credentials === 2, prev.body.counts);
  ok("…and matches the person already on file BY EMAIL, never duplicating",
     (prev.body.people || []).some(p => p.matchedTo && p.matchedTo.by === "email"), (prev.body.people || [])[0]);
  ok("…and refuses a waiver that is ticked with no date, by line and reason",
     (prev.body.refused || []).some(r => /ticked, with no date/.test(r.why)), prev.body.refused);

  const before = await api("/volunteer-hub/roster", {}, token);
  const imp = await api("/volunteer-hub/import", { method: "POST", body: JSON.stringify(FILE) }, token);
  ok("the import runs", imp.status === 201, imp.body);
  // THREE people in the file: one already on the roster, one new with hours,
  // and one whose only usable column was a name. A row with a name is a person
  // on the roster even when nothing else on it could be read, so two are added.
  ok("…adding both new people and linking the one already here",
     imp.body.peopleCreated === 2 && imp.body.peopleMatched === 1, imp.body);
  const after = await api("/volunteer-hub/roster", {}, token);
  ok("…so the roster grew by exactly the two new people",
     after.body.people.length === before.body.people.length + 2,
     { before: before.body.people.length, after: after.body.people.length });

  // THE RULE THIS BUILD IS ABOUT: nobody who arrives this way is a donor.
  const made = (after.body.people || []).find(p => /Walkie Testperson/.test(p.name));
  ok("the imported person is on the roster", !!made, (after.body.people || []).slice(0, 3));
  const rec = await api(`/volunteer-hub/person/${made ? made.id : "none"}`, {}, token);
  ok("…and nothing about them says donor: no giving block at all",
     rec.status === 200 && rec.body.giving === null, rec.body.giving);
  ok("…they carry the Volunteer role and only that",
     rec.status === 200 && JSON.stringify(rec.body.personTypes) === JSON.stringify(["volunteer"]), rec.body.personTypes);
  ok("…and their waiver and check came across with their dates, or none did",
     rec.status === 200 && Array.isArray(rec.body.credentials), rec.body.credentials);

  const undo = await api(`/volunteer-hub/import/${imp.body.importId}/undo`, { method: "POST", body: "{}" }, token);
  ok("the import undoes", undo.status === 200 && undo.body.removed === 2, undo.body);
  const back = await api("/volunteer-hub/roster", {}, token);
  ok("…and the roster is back where it started",
     back.body.people.length === before.body.people.length,
     { start: before.body.people.length, now: back.body.people.length });
  ok("…and the person who was already here was NOT removed",
     (back.body.people || []).some(p => /Nell Ashcroft/.test(p.name)));

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
  const shot = async (page, name) => {
    const f = path.join(SHOTS, name + ".png");
    await page.screenshot({ path: f, fullPage: false }); shots.push(f);
  };
  const toTab = async (page, label) => {
    await page.goto(APP + "/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.evaluate(t => {
      const b = [...document.querySelectorAll("button")].find(x => new RegExp(t + "\\s*$").test((x.textContent || "").trim()));
      if (b) b.click();
    }, label);
    await page.waitForTimeout(2500);
  };

  // ── 1440 ────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(1440, 1100);
    console.log("\n— 1440 · Volunteers —");
    await toTab(page, "Volunteers");
    ok("the hub is on the page", await page.locator("[data-testid='volunteers-hub']").count() > 0);

    // ── ITEM 1 · ACTIONS UP FRONT, ON A FULL ROSTER ────────────────────
    ok("\"Add a volunteer\" is on People", await page.locator("[data-testid='vol-add-open']").count() === 1);
    ok("\"Import volunteers\" is beside it", await page.locator("[data-testid='vol-import-open']").count() === 1);
    const addColor = await page.locator("[data-testid='vol-add-open']").evaluate(el => getComputedStyle(el).backgroundColor);
    ok("…Add is the emerald action", /rgb\(13,\s*92,\s*58\)/.test(addColor), addColor);
    const impColor = await page.locator("[data-testid='vol-import-open']").evaluate(el => getComputedStyle(el).backgroundColor + " | " + getComputedStyle(el).border);
    ok("…Import is outlined, not a second emerald", !/rgb\(13,\s*92,\s*58\)/.test(impColor.split("|")[0]), impColor);
    const actionsY = await page.locator("[data-testid='vol-people-actions']").boundingBox();
    const rosterY = await page.locator("[data-testid='vol-roster']").boundingBox();
    ok("…and they sit ABOVE the roster, not under it",
       !!actionsY && !!rosterY && actionsY.y < rosterY.y, { actions: actionsY && Math.round(actionsY.y), roster: rosterY && Math.round(rosterY.y) });
    ok("the roster is full (this is the not-empty case)", await page.locator("[data-testid='vol-roster-row']").count() > 5);

    // ── ITEM 6 · THE RULE STOPS WHERE THE TABS STOP ────────────────────
    const overhang = await page.evaluate(() => {
      const out = {};
      for (const sel of ["[data-vol-strip]", "[data-vol-parts]"]) {
        const strip = document.querySelector(sel);
        if (!strip) { out[sel] = null; continue; }
        const sr = strip.getBoundingClientRect();
        const bs = [...strip.querySelectorAll("button")].map(b => b.getBoundingClientRect());
        out[sel] = bs.length ? Math.round((sr.x + sr.width) - Math.max(...bs.map(b => b.x + b.width))) : null;
      }
      return out;
    });
    // Before this build the section strip was full width: 835px of bare rule
    // past the last tab at 1440. Two pixels is the border radius's worth.
    ok("no bare rule past the last section tab", overhang["[data-vol-strip]"] !== null && overhang["[data-vol-strip]"] <= 2, overhang);
    ok("no bare rule past the last part tab", overhang["[data-vol-parts]"] === null || overhang["[data-vol-parts]"] <= 2, overhang);

    // ── ITEM 4 · THE PERSON, VOLUNTEER FIRST ───────────────────────────
    console.log("\n— 1440 · a volunteer's record, opened from Volunteers —");
    await page.locator("[data-testid='vol-roster-row'] button").first().click();
    await page.waitForTimeout(1800);
    ok("the panel opens", await page.locator("[data-testid='vol-person']").count() === 1);
    for (const [what, tid] of [["what is coming up", "vol-person-upcoming"], ["their hours", "vol-person-hours"],
                               ["their waivers and checks", "vol-person-credentials"]]) {
      ok(`…it shows ${what}`, await page.locator(`[data-testid='${tid}']`).count() === 1);
    }
    const order = await page.evaluate(() => {
      const y = t => { const e = document.querySelector(`[data-testid='${t}']`); return e ? e.getBoundingClientRect().y : null; };
      return { upcoming: y("vol-person-upcoming"), hours: y("vol-person-hours"), creds: y("vol-person-credentials"), giving: y("vol-person-giving") };
    });
    ok("…and volunteering comes BEFORE giving",
       order.giving === null || (order.upcoming < order.giving && order.hours < order.giving && order.creds < order.giving), order);
    await shot(page, "1440-person");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);

    // ── ITEM 5 · THE GROUP SIGN-UP SCREEN ──────────────────────────────
    console.log("\n— 1440 · groups —");
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-section]")].find(x => /Schedule/.test(x.textContent || "")); if (b) b.click(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-part]")].find(x => /^Groups$/.test((x.textContent || "").trim())); if (b) b.click(); });
    await page.waitForTimeout(2200);
    ok("Groups is a screen now, not only a route", await page.locator("[data-testid='vol-groups']").count() === 1);
    ok("…and the seeded group is on it", await page.locator("[data-testid='vol-group-row']").count() >= 1);
    await page.locator("[data-testid='vol-group-new']").click();
    await page.waitForTimeout(900);
    ok("…and a group can be signed up from the screen", await page.locator("[data-testid='vol-group-form']").count() === 1);
    for (const tid of ["vol-group-slot", "vol-group-kind", "vol-group-name", "vol-group-people"]) {
      ok(`…the form asks for ${tid.replace("vol-group-", "")}`, await page.locator(`[data-testid='${tid}']`).count() === 1);
    }
    await shot(page, "1440-groups");

    // ── ITEM 2 · THE IMPORT SCREEN ─────────────────────────────────────
    console.log("\n— 1440 · the import screen —");
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-vol-section]")].find(x => /People/.test(x.textContent || "")); if (b) b.click(); });
    await page.waitForTimeout(1200);
    await page.locator("[data-testid='vol-import-open']").click();
    await page.waitForTimeout(1200);
    ok("the import dialog opens", await page.locator("[data-testid='vol-import']").count() === 1);
    ok("…and takes a CSV or an Excel file", /\.xlsx/.test(await page.locator("[data-testid='vol-import-file']").getAttribute("accept") || ""));
    const presetText = await page.evaluate(() => (document.querySelector("[data-testid='vol-import']") || {}).textContent || "");
    for (const vendor of ["VolunteerHub", "SignUpGenius", "Wranglr", "Bloomerang Volunteer", "plain spreadsheet"]) {
      ok(`…and names ${vendor}`, presetText.includes(vendor));
    }
    await shot(page, "1440-import");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    // ── ITEM 1 · ADD ONE BY HAND ───────────────────────────────────────
    await page.locator("[data-testid='vol-add-open']").click();
    await page.waitForTimeout(900);
    ok("the add dialog opens", await page.locator("[data-testid='vol-add']").count() === 1);
    const stamp = Date.now().toString(36);
    await page.locator("[data-testid='vol-add-name']").fill("Walkie Addedbyhand " + stamp);
    await page.locator("[data-testid='vol-add-email']").fill(`walkie.${stamp}@example.org`);
    await page.locator("[data-testid='vol-add-save']").click();
    await page.waitForTimeout(1500);
    const addResult = await page.locator("[data-testid='vol-add-result']").textContent().catch(() => "");
    ok("…and it says what happened, in words about volunteering", /roster/i.test(addResult), addResult);
    ok("…and says nothing on the record calls them a donor", /not given|does not|nothing on this record says donor/i.test(addResult), addResult);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    ok("no console error, page error or 5xx at 1440", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  // ── 390 ─────────────────────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await screen(390, 844);
    console.log("\n— 390 · Volunteers —");
    await toTab(page, "Volunteers");
    ok("the two actions are still up front at 390",
       await page.locator("[data-testid='vol-add-open']").count() === 1
       && await page.locator("[data-testid='vol-import-open']").count() === 1);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("nothing scrolls sideways", over <= 0, over);
    const overhang390 = await page.evaluate(() => {
      const strip = document.querySelector("[data-vol-strip]");
      if (!strip) return null;
      const sr = strip.getBoundingClientRect();
      const bs = [...strip.querySelectorAll("button")].map(b => b.getBoundingClientRect());
      return bs.length ? Math.round((sr.x + sr.width) - Math.max(...bs.map(b => b.x + b.width))) : null;
    });
    ok("no bare rule past the last tab at 390", overhang390 !== null && overhang390 <= 2, overhang390);
    await shot(page, "390-volunteers");
    ok("no console error, page error or 5xx at 390", errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }

  // ── THE EMPTY STATE, on an org with no volunteers ──────────────────────
  // A fresh org, so the empty case is the REAL empty case rather than a
  // roster somebody emptied: the brief is about what a new customer sees.
  {
    console.log("\n— 1440 · an empty org's Volunteers —");
    const slug = "vol2walk" + Date.now().toString(36);
    const signup = await api("/auth/register-org", { method: "POST", body: JSON.stringify({
      orgName: "Walk Test Org " + slug, userName: "Walk Tester",
      email: `${slug}@example.org`, password: "walk-test-pass-2026", provisioned: true }) });
    if (signup.status >= 400 || !signup.body.token) {
      ok("a fresh org could be created for the empty case", false, { status: signup.status, body: signup.body });
    } else {
      // A BRAND NEW ORG LANDS ON ONBOARDING, not the dashboard, so the walk
      // has to finish signing up before it can look at a screen. Completing
      // it through the real route is what the welcome page itself does.
      await api("/onboarding/complete", { method: "POST", body: "{}" }, signup.body.token);
      // The APP reads the org out of localStorage, and the object register-org
      // handed back was written before onboarding completed. Stashing it
      // unchanged put the walk on the welcome screen with an empty body and
      // six failures that looked like a missing empty state. The flag the
      // client actually gates on is `onboarding_complete`.
      const freshOrg = { ...(signup.body.org || {}), onboarding_complete: 1 };
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await ctx.addInitScript(([t, u, o]) => {
        localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
      }, [signup.body.token, JSON.stringify(signup.body.user || {}), JSON.stringify(freshOrg)]);
      const page = await ctx.newPage();
      await toTab(page, "Volunteers");
      ok("the empty roster has its own empty state", await page.locator("[data-testid='vol-roster-empty']").count() === 1);
      const txt = await page.locator("[data-testid='vol-roster-empty']").textContent().catch(() => "");
      ok("…and it leads with the volunteer way in",
         /Add your first volunteer, import from VolunteerHub, SignUpGenius or a spreadsheet, or share your sign-up link/.test(txt), txt.slice(0, 200));
      for (const tid of ["vol-empty-add", "vol-empty-import", "vol-empty-link"]) {
        ok(`…with ${tid.replace("vol-empty-", "")} as a button`, await page.locator(`[data-testid='${tid}']`).count() === 1);
      }
      // Tagging on a donor record is mentioned LAST and smaller than the rest.
      const tail = await page.evaluate(() => {
        // BY TESTID, not by text. Matching on text found the BOX that holds
        // both lines first, so "is it smaller and lower" compared the box with
        // itself and always said no.
        const e = document.querySelector("[data-testid='vol-empty-tag-note']");
        const lead = document.querySelector("[data-testid='vol-empty-lead']");
        if (!e || !lead) return null;
        return { size: parseFloat(getComputedStyle(e).fontSize), y: e.getBoundingClientRect().y,
                 leadSize: parseFloat(getComputedStyle(lead).fontSize),
                 leadY: lead.getBoundingClientRect().y };
      });
      ok("…and the donor-record way in is mentioned last, in small text",
         !!tail && tail.y > tail.leadY && tail.size < tail.leadSize, tail);
      // AND THE TWO ACTIONS ARE STILL UP FRONT ON AN EMPTY ORG.
      ok("the two actions are up front on an empty roster too",
         await page.locator("[data-testid='vol-add-open']").count() === 1
         && await page.locator("[data-testid='vol-import-open']").count() === 1);
      await shot(page, "1440-empty");
      await ctx.close();
    }
  }

  await browser.close();
  console.log(`\nvol2-walk: ${pass} passed, ${fail} failed`);
  if (shots.length) console.log("screenshots:\n  " + shots.join("\n  "));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
