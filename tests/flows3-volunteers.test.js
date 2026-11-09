// tests/flows3-volunteers.test.js: FLOWS-3, the volunteer, event, group and
// meeting half. EVERY ITEM IS DRIVEN BY REAL CLICKS ON THE BUILT CLIENT.
// Guards donor data: a guest typed onto an event was a name with no record,
// and screens told staff things about their people that were not so.
//
//   §1 a volunteer's profile lists every scheduled shift, past and coming,
//      from the Schedule's own rows (W-1107-Volunteers-24)
//   §2 a guest typed onto an event is a person: Search finds them and
//      Everyone moves by one (W-1108-Volunteers-20)
//   §3 an empty group offers no email: "Nobody in this group yet"
//      (W-1108-Volunteers-34X)
//   §4 the Calendar's clash marker is the Schedule's conflict rule
//      (W-1108-Volunteers-10X)
//   §5 a date filter on the volunteer list reads exactly the dates set (W-1108-Volunteers-26X)
//   §6 saying no to an over-capacity add leaves nobody checked
//      (W-1108-Volunteers-23X)
//   §7 a meeting saved with someone never says they were not invited
//      (W-1108-Volunteers-19X)
//
// Red on main: each § was run against origin/main's client and server first
// (the FLOWS-3 report lists what each said there).
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_flows3v";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const WAIT = 12000;

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Flows Three Kestrel Commons',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ines Varro','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, types = '["donor"]') => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5::jsonb,$6,'Ines Varro','system:test/flows3-volunteers','FLOWS-3 test')`,
  [P(id), ORG, name, `${id}@flows3v.example.org`, types, ME]);

(async () => {
  const tok = await freshOrg();
  const today = civilToday();
  const back4 = civilPlusDays(-4), ahead3 = civilPlusDays(3), ahead5 = civilPlusDays(5);
  for (const [id, name, t] of [["wren", "Wren Halvorsen", '["volunteer"]'], ["oren", "Oren Tallis", '["donor"]'], ["pia", "Pia Lindqvist", '["donor"]'],
    ["tam", "Tamsin Okafor", '["volunteer"]'], ["rena", "Renata Calloway", '["donor"]'], ["uli", "Ulla Brennick", '["volunteer"]']]) await person(id, name, t);

  // Volunteers: one opportunity; Wren has one logged shift and two shifts scheduled four days back (the fleet's Nov 4), and one ahead.
  const opp = await api("POST", "/volunteer-hub/opportunities", tok, { name: "Pantry sorting", location: "Kestrel Hall" });
  const OPP = opp.body && opp.body.id;
  const slot = async (date, startTime, endTime, name) => {
    const r = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: OPP, date, startTime, endTime, name });
    return r.body && r.body.id;
  };
  const S1 = await slot(back4, "09:00", "12:00", "Morning sort");
  const S2 = await slot(back4, "13:00", "16:00", "Afternoon sort");
  const S3 = await slot(ahead3, "10:00", "12:00", "Saturday sort");
  for (const s of [S1, S2, S3]) await api("POST", "/volunteer-hub/signups", tok, { slotId: s, personId: P("wren") });
  await api("POST", `/donors/${P("wren")}/volunteer-hours`, tok, { date: civilPlusDays(-30), hours: 2, role: "Pantry sorting" });
  // §4: a shift and an event at the same time, with nobody on both. The Schedule says 0 conflicts.
  const S4 = await slot(ahead5, "18:00", "20:00", "Evening sort");
  await api("POST", "/volunteer-hub/signups", tok, { slotId: S4, personId: P("tam") });
  await api("POST", "/events", tok, { name: "Kestrel Lantern Supper", date: ahead5, startTime: "18:30", endTime: "20:30", eventType: "community", description: "Supper." });
  // §5: hours logged today and earlier in the year.
  await api("POST", `/donors/${P("uli")}/volunteer-hours`, tok, { date: today, hours: 3, role: "Pantry sorting" });
  await api("POST", `/donors/${P("uli")}/volunteer-hours`, tok, { date: civilPlusDays(-60), hours: 5, role: "Pantry sorting" });
  // §3: a group nobody is in yet.
  const grp = await api("POST", "/groups", tok, { name: "Kestrel Winter Helpers", kind: "static" });
  const GRP = grp.body && grp.body.id;
  ok("fixture: opportunity, four shifts, a group", !!OPP && !!S1 && !!S2 && !!S3 && !!S4 && !!GRP, { opp: opp.status, grp: grp.status, g: grp.body && grp.body.error });
  // §2 and §6: events for typed guests and for capacity.
  const evG = await api("POST", "/events", tok, { name: "Kestrel Open House", date: ahead3, eventType: "community", description: "Open house." });
  const EG = evG.body && (evG.body.id || (evG.body.event && evG.body.event.id));
  const evC = await api("POST", "/events", tok, { name: "Kestrel Small Table", date: ahead3, eventType: "community", description: "Six seats.", capacity: 1 });
  const EC = evC.body && (evC.body.id || (evC.body.event && evC.body.event.id));
  await q(`UPDATE events SET capacity=1 WHERE id=$1 AND org_id=$2`, [EC, ORG]);
  await api("POST", `/events/${EC}/attendees`, tok, { donorIds: [P("oren")] });

  // ── API: the meeting sentence, the Everyone count before ──────────────────
  const everyone = async () => {
    const r = await api("GET", "/people/everyone-breakdown", tok);
    return r.body && typeof r.body.everyone === "number" ? r.body.everyone : null;
  };

  const why = (() => {
    if (!optional(PW)) return "(playwright not installed)";
    if (!require("fs").existsSync(DIST)) return "(no client dist)";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: WAIT }).then(() => true).catch(() => false);
  const shot = async n => { if (process.env.FLOWS3_SHOTS) await page.screenshot({ path: path.join(process.env.FLOWS3_SHOTS, n + ".png"), fullPage: true }); };
  const leg = async (label, fn) => { try { await fn(); } catch (e) { ok(label + " ran to the end", false, String(e && e.message || e).split("\n")[0]); await shot("fail-" + label.replace(/\W+/g, "")); } };

  // ── §1 · THE PROFILE LISTS THE SHIFTS THE SCHEDULE HAS ─────────────────────
  await leg("§1", async () => {
    await open(`/donors/${P("wren")}`);
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 });
    await page.locator('[data-testid="volunteer-upcoming"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const t = await body();
    await shot("s1-profile");
    ok("§1 the profile's Coming up names the shift ahead", /Coming up:[^.]*Saturday sort/.test(t), (t.match(/Coming up:.{0,120}/) || [""])[0]);
    const past = ((t.match(/Past shifts:.{0,200}/) || [""])[0]);
    ok("§1 the profile lists both shifts four days back, as the Schedule does (W-1107-Volunteers-24)", /Morning sort/.test(past) && /Afternoon sort/.test(past), past || (t.match(/Coming up:.{0,200}/) || [""])[0]);
  });

  // The Volunteers page's own drawer: the screen the fleet read ("1 shift, Coming up: Nothing").
  await leg("§1b", async () => {
    await open(`/app/volunteers`);
    await page.getByText("Wren Halvorsen").first().click({ timeout: 20000 });
    await page.locator('[data-testid="vol-person-upcoming"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const t = await body();
    await shot("s1b-drawer");
    ok("§1b the Volunteers drawer lists both shifts four days back (W-1107-Volunteers-24)", /Morning sort/.test(t) && /Afternoon sort/.test(t),
      (t.match(/Coming up.{0,200}/) || [""])[0]);
    ok("§1b and the shift ahead", /Saturday sort|Pantry sorting/.test((t.match(/Coming up.{0,200}/) || [""])[0]), (t.match(/Coming up.{0,200}/) || [""])[0]);
    await page.keyboard.press("Escape");
  });

  // ── §2 · A TYPED GUEST IS A PERSON ─────────────────────────────────────────
  await leg("§2", async () => {
    const before = await everyone();
    await open(`/app/events`);
    await page.getByText("Kestrel Open House").first().click();
    await page.locator('[data-testid="event-detail"]').waitFor({ timeout: 20000 });
    await shot("s2-event");
    await page.getByRole("button", { name: "Add Guest", exact: true }).first().click();
    await page.getByPlaceholder("Guest name *").fill("Yusra Penhallow");
    await page.getByPlaceholder("Email (optional)").first().fill("yusra.penhallow@flows3v.example.org");
    await page.getByRole("button", { name: /^Add Guest →/ }).first().click();
    await until(() => /Yusra Penhallow/.test(document.body.innerText));
    const [row] = await q(`SELECT d.id, d.person_types FROM donors d WHERE d.org_id=$1 AND d.name='Yusra Penhallow' AND d.deleted_at IS NULL`, [ORG]);
    const [att] = await q(`SELECT donor_id FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND name='Yusra Penhallow'`, [ORG, EG]);
    ok("§2 the typed guest is a person record of type guest, and the guest row points at it (W-1108-Volunteers-20)",
      !!row && JSON.stringify(row.person_types).includes("guest") && att && att.donor_id === row.id, { row, att });
    const after = await everyone();
    ok("§2 Everyone moves by one", before !== null && after === before + 1, { before, after });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.keyboard.type("Penhallow");
    const found = await until(() => /Yusra Penhallow\s*Guest/.test(document.body.innerText) && !/No matches for/.test(document.body.innerText));
    await shot("s2-search");
    ok("§2 search finds the guest", found, (await body()).slice(0, 200));
    await page.keyboard.press("Escape");
  });

  // ── §3 · AN EMPTY GROUP OFFERS NO EMAIL ────────────────────────────────────
  await leg("§3", async () => {
    await open(`/app/groups`);
    await page.getByText("Kestrel Winter Helpers").first().click({ timeout: 20000 });
    await page.locator('[data-testid="group-page"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const btn = page.locator('[data-testid="group-email"]');
    const disabled = (await btn.count()) ? await btn.isDisabled() : true;
    const t = await body();
    await shot("s3-group");
    ok("§3 Email this group is disabled on a group of 0 (W-1108-Volunteers-34X)", disabled, { count: await btn.count() });
    ok("§3 and it says why: Nobody in this group yet", /Nobody in this group yet/.test(t), (t.match(/Email this group.{0,80}/) || [""])[0]);
  });

  // ── §4 · ONE CONFLICT RULE ─────────────────────────────────────────────────
  await leg("§4", async () => {
    const sch = await api("GET", `/volunteer-hub/schedule?from=${ahead5}&to=${ahead5}`, tok);
    const schedConflicts = sch.body && sch.body.conflicts;
    const cal = await api("GET", `/calendar/items?from=${ahead5}&to=${ahead5}`, tok);
    const items = (cal.body && (cal.body.items || cal.body)) || [];
    const clashing = (Array.isArray(items) ? items : []).filter(i => /clash/i.test(i.conflict || ""));
    ok("§4 the Schedule says 0 conflicts on that day", schedConflicts === 0, { schedConflicts, status: sch.status });
    await open(`/app/calendar?date=${ahead5}`);
    await page.waitForTimeout(800);
    const t = await body();
    await shot("s4-calendar");
    ok("§4 the Calendar says no clash where the Schedule counts none (W-1108-Volunteers-10X)", clashing.length === 0 && !/Clashes with/i.test(t),
      { api: clashing.map(i => i.title + ": " + i.conflict), screen: (t.match(/Clashes with.{0,60}/i) || [""])[0], calStatus: cal.status });
  });

  await leg("§4b", async () => {
    // A real clash: Tamsin also on a shift that overlaps hers. The Schedule counts it; the Calendar marks it.
    const S5 = (await api("POST", "/volunteer-hub/slots", tok, { opportunityId: OPP, date: ahead5, startTime: "19:00", endTime: "21:00", name: "Late sort" })).body.id;
    await api("POST", "/volunteer-hub/signups", tok, { slotId: S5, personId: P("tam"), overlapOk: true });
    const sch = await api("GET", `/volunteer-hub/schedule?from=${ahead5}&to=${ahead5}`, tok);
    const cal = await api("GET", `/calendar/items?from=${ahead5}&to=${ahead5}`, tok);
    const items = (cal.body && (cal.body.items || cal.body)) || [];
    const marked = (Array.isArray(items) ? items : []).filter(i => i.type === "shift" && /another shift at the same time/.test(i.conflict || ""));
    ok("§4b where the Schedule counts a conflict, the Calendar marks both shifts", sch.body.conflicts === 1 && marked.length === 2, { sched: sch.body.conflicts, marked: marked.map(i => i.title + ": " + i.conflict) });
  });

  // ── §5 · A DATE FILTER READS EXACTLY THE DATES SET ─────────────────────────
  // The volunteer list: "On a shift from today to today". Ulla served 3 hours
  // today, logged by hand (no sign-up). Main found nobody, and the Hours in
  // range column said January 1 to today.
  await leg("§5", async () => {
    await open(`/app/volunteers`);
    await page.locator('input[aria-label="On a shift from"]').waitFor({ timeout: 20000 });
    const md = `${today.slice(5, 7)}/${today.slice(8, 10)}/${today.slice(0, 4)}`;
    for (const l of ["On a shift from", "On a shift to"]) { const x = page.locator(`input[aria-label="${l}"]`); await x.click(); await x.type(md); await x.press("Tab"); await page.waitForTimeout(500); }
    await page.waitForTimeout(1200);
    const t = await body();
    const defs = await page.evaluate(() => [...document.querySelectorAll("[title]")].map(e => e.title).filter(x => /^Hours from shifts dated/.test(x)));
    await shot("s5-list");
    ok("§5 On a shift today to today finds Ulla, who served today (W-1108-Volunteers-26X)", /1 volunteer matches/.test(t) && /Ulla Brennick 3 8/.test(t), (t.match(/\d+ volunteers? match.{0,200}/) || [""])[0]);
    ok("§5 and the Hours in range column says exactly the dates set", defs.length > 0 && defs.every(d => d === `Hours from shifts dated ${today} to ${today}.`), defs);
  });

  // ── §6 · SAYING NO TO AN OVER-CAPACITY ADD LEAVES NOBODY CHECKED ───────────
  await leg("§6", async () => {
    await open(`/app/events`);
    await page.getByText("Kestrel Small Table").first().click();
    await page.locator('[data-testid="event-detail"]').waitFor({ timeout: 20000 });
    const s = page.getByPlaceholder("Search donors…");
    await s.fill("Pia");
    await page.getByRole("button", { name: /Pia Lindqvist/ }).first().click({ timeout: 10000 });
    await page.getByRole("button", { name: /^Add \d+ donor/ }).first().click();
    await page.getByText(/Over capacity/).first().waitFor({ timeout: 10000 });
    await shot("s6-ask");
    await page.locator('[data-testid="confirm-no"]').click();
    await page.waitForTimeout(500);
    const still = await page.getByRole("button", { name: /^Add \d+ donor/ }).count();
    await s.fill("Pia");
    await page.waitForTimeout(600);
    const checked = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /Pia Lindqvist/.test(b.textContent || ""))
      .some(b => b.getAttribute("aria-pressed") === "true" || /✓/.test(b.textContent || "") || !!b.querySelector('input[type="checkbox"]:checked')));
    await shot("s6-after");
    ok("§6 after No, Pia is not left checked and nothing waits to be added (W-1108-Volunteers-23X)", !still && !checked, { addButton: still, checked });
    const [n] = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1 AND event_id=$2`, [ORG, EC]);
    ok("§6 and nobody was added", n.n === 1, n);
  });

  // ── §7 · A MEETING SAVED WITH SOMEONE ──────────────────────────────────────
  await leg("§7", async () => {
    await open(`/app/calendar`);
    await page.locator('[data-testid="cal-add-meeting"]').click({ timeout: 20000 });
    await page.locator('[data-testid="cal-donor-search"]').fill("Renata");
    await page.locator('[data-testid="cal-quick-form"]').getByRole("button", { name: "Renata Calloway" }).click({ timeout: 10000 });
    const where = await page.locator('[data-testid="cal-meeting-where"]').innerText();
    await shot("s7-form");
    ok("§7 the form never says nobody is invited while Renata is on it", !/nobody is invited/i.test(where), where);
    await page.locator('[data-testid="cal-quick-save"]').click();
    await page.locator('[data-testid="cal-note"]').waitFor({ timeout: 10000 });
    const t = await page.locator('[data-testid="cal-note"]').innerText();
    await shot("s7-after");
    ok("§7 the meeting is saved with Renata on it", (await q(`SELECT 1 FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids)`, [ORG, P("rena")])).length === 1);
    ok("§7 it never says Renata was not invited (W-1108-Volunteers-19X)", !/was not invited/i.test(t) && /Renata Calloway/.test(t), t);
  });

  ok("no page errors on any leg", !errors.length, errors.slice(0, 3));
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, String(e && e.message || e)); await closeDb().catch(() => {}); summary(); });
