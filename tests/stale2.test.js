// tests/stale2.test.js: STALE-2. NO FIGURE ON SCREEN IS OLDER THAN THE LAST
// ACTION, AND AN EVENT'S GUEST LEAVES NOTHING BEHIND ON A PROFILE.
// Guards donor data: the QA fleet (7 Nov 2026, W-1107-*) found figures that
// waited for a reload after STALE-1, and a guest's "Came to" left on a
// profile after the guest was marked No Show, removed, or the event deleted.
//
// API leg:
//   §A the attendance line follows the guest row: Attended → No Show rewrites
//      it, back to Registered removes it, the attendance list does the same,
//      removing a guest takes their lines (and Undo brings them back), the
//      bulk Remove takes them, deleting the event leaves none (W-1107-Volunteers-21)
//   §B the orphan script: a dry run counts, --apply removes with an audit
//      row, a second run finds none, --undo puts them back
//   §C the channel's rules: a Thread write is a task change, an event's guest
//      write is an event change
// Browser leg (the action, then the figure, with no page load in between):
//   §1 the event page: guests added and marked come move Invited, Came and
//      Attendees (W-1107-Volunteers-01)
//   §2 Fundraising: attendance saved on the Tickets & sponsors desk moves
//      the lead event card's Came (W-1107-Volunteers-01)
//   §3 a next step snoozed to revisit later, on the profile's Thread, leaves
//      the Tasks badge
//      (W-1107-Volunteers-15)
//   §4 hours logged elsewhere move an open profile's volunteer panel
//      (W-1107-Volunteers-08)
//
// Planted defects (each turned this suite red, then was taken back out; the
// STALE-2 report names them):
//   · "event" dropped from changes.js's event rule → §C and §1 red
//   · run against main's code → §A, §2 and §3 red
"use strict";
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { ok, summary, login, api, q, closeDb, civilToday, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_stale2";
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
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Stale Two Heron Society',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odile Marsh','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active','["donor"]'::jsonb,$5,'Odile Marsh','system:test/stale2','STALE-2 test')`,
  [P(id), ORG, name, `${id}@stale2.example.org`, ME]);
// The event lines on one person's timeline, as the profile reads them.
const lines = async (donorId, eventId) => (await q(
  `SELECT note, metadata->>'via' AS via FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'event_id'=$3
     AND metadata->>'via' IN ('event_registration','event_attendance') ORDER BY note`, [ORG, donorId, eventId]));
const notes = async (d, e) => (await lines(d, e)).map(l => l.note);
// Only the attendance line (adding a guest from the directory also writes "Registered for X.").
const came = async (d, e) => (await lines(d, e)).filter(l => l.via === "event_attendance").map(l => l.note);
const attId = async (eventId, donorId) => ((await q(`SELECT id FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND donor_id=$3`, [ORG, eventId, donorId]))[0] || {}).id;

(async () => {
  const tok = await freshOrg();
  const today = civilToday();
  for (const [id, name] of [["ada", "Ada Quill"], ["bram", "Bram Oduya"], ["cleo", "Cleo Varga"], ["dev", "Devi Halloran"], ["eli", "Eli Strand"], ["fay", "Fay Morrow"], ["gus", "Gus Penhale"], ["hal", "Hal Wexford"]]) await person(id, name);

  // ── §A · THE ATTENDANCE LINE FOLLOWS THE GUEST ROW ─────────────────────────
  const evA = await api("POST", "/events", tok, { name: "Heron Lantern Walk", date: today, eventType: "community", description: "A walk." });
  const EA = evA.body && (evA.body.id || (evA.body.event && evA.body.event.id));
  await api("POST", `/events/${EA}/attendees`, tok, { donorIds: [P("ada"), P("bram"), P("cleo")] });
  const [a1, a2, a3] = [await attId(EA, P("ada")), await attId(EA, P("bram")), await attId(EA, P("cleo"))];
  ok("§A fixtures: the event and three guests", !!EA && !!a1 && !!a2 && !!a3, { EA, a1, a2, a3 });
  const CAME = "Came to Heron Lantern Walk.", MISSED = "Registered for Heron Lantern Walk and did not come.";

  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "attended" });
  ok("§A marked Attended: one \"Came to\" line", JSON.stringify(await came(P("ada"), EA)) === JSON.stringify([CAME]), await notes(P("ada"), EA));
  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "no_show" });
  const ns = await came(P("ada"), EA);
  ok("§A Attended → No Show: no \"Came to\" line stays (W-1107-Volunteers-21)", !ns.includes(CAME), ns);
  ok("§A …and the line says what is true now", JSON.stringify(ns) === JSON.stringify([MISSED]), ns);
  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "registered" });
  ok("§A back to Registered: no attendance line at all", (await lines(P("ada"), EA)).filter(l => l.via === "event_attendance").length === 0, await notes(P("ada"), EA));
  await api("PATCH", `/events/${EA}/attendees/${a1}`, tok, { status: "attended" });
  ok("§A marked Attended again: exactly one \"Came to\" line", JSON.stringify(await came(P("ada"), EA)) === JSON.stringify([CAME]), await notes(P("ada"), EA));

  await api("POST", `/events/${EA}/attendance`, tok, { attended: [a2], noShow: [] });
  await api("POST", `/events/${EA}/attendance`, tok, { attended: [], noShow: [a2] });
  ok("§A the attendance list, saved again the other way, rewrites the line", JSON.stringify(await came(P("bram"), EA)) === JSON.stringify([MISSED]), await notes(P("bram"), EA));

  const adaBefore = JSON.stringify(await notes(P("ada"), EA));
  const del = await api("DELETE", `/events/${EA}/attendees/${a1}`, tok);
  ok("§A a guest removed takes their lines with them", del.status === 200 && (await lines(P("ada"), EA)).length === 0, { status: del.status, left: await notes(P("ada"), EA) });
  const back = await api("POST", `/deleted-records/${del.body && del.body.undoId}/restore`, tok);
  ok("§A …and the guest's Undo brings them back", back.status === 200 && JSON.stringify(await notes(P("ada"), EA)) === adaBefore, { status: back.status, lines: await notes(P("ada"), EA) });

  await api("PATCH", `/events/${EA}/attendees/${a3}`, tok, { status: "attended" });
  const cleoBefore = (await lines(P("cleo"), EA)).length;
  const bulk = await api("POST", "/removals/guest", tok, { ids: [a1, a2, a3] });
  const leftB = (await lines(P("ada"), EA)).length + (await lines(P("bram"), EA)).length + (await lines(P("cleo"), EA)).length;
  ok("§A the bulk Remove takes every removed guest's lines", bulk.status === 200 && leftB === 0, { status: bulk.status, left: leftB });
  const und = await api("POST", "/removals/undo", tok, { undoIds: (bulk.body && bulk.body.undoIds) || [] });
  ok("§A …and its Undo brings them back", und.status === 200 && cleoBefore >= 2 && (await lines(P("cleo"), EA)).length === cleoBefore, { status: und.status, cleo: await notes(P("cleo"), EA) });
  await api("POST", "/removals/guest", tok, { ids: [a1, a2, a3] });
  const gone = await api("DELETE", `/events/${EA}`, tok);
  const anyLeft = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND metadata->>'event_id'=$2`, [ORG, EA]);
  ok("§A every guest removed, then the event deleted: no line names it on any profile", gone.status === 200 && anyLeft[0].n === 0, { status: gone.status, left: anyLeft[0].n });

  // ── §B · THE ORPHAN SCRIPT ─────────────────────────────────────────────────
  // A line left behind before STALE-2: its guest row is gone and not in the trash.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
           VALUES ('int_stale2_orphan',$1,$2,'event','Came to The Old Supper.',$3,'system:test/stale2','STALE-2 test',$4::jsonb)`,
    [ORG, P("dev"), today, JSON.stringify({ via: "event_attendance", event_id: "ev_stale2_gone", attendee_id: "att_stale2_gone", status: "attended" })]);
  const S = require("../scripts/ops/stale2-event-line-orphans");
  const db = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", ssl: false });
  await db.connect();
  try {
    const dry = (await S.list(db, ORG)).find(r => r.org_id === ORG);
    ok("§B the dry run counts the orphaned line (org id and a count, no names)", !!dry && dry.n === 1 && Object.keys(dry).sort().join() === "n,org_id", dry);
    const r = await S.apply(db, ORG);
    const audit = await q(`SELECT record_count FROM fin_audit_log WHERE id=$1`, [r.auditId]);
    ok("§B --apply removes it, with one audit row", r.count === 1 && audit.length === 1 && audit[0].record_count === 1, r);
    ok("§B a second run finds none", (await S.list(db, ORG)).length === 0);
    const u = await S.undo(db, r.auditId);
    ok("§B --undo puts it back exactly", u.count === 1 && (await q(`SELECT 1 FROM interactions WHERE id='int_stale2_orphan'`)).length === 1, u);
  } finally { await db.end(); }

  // ── §C · THE CHANNEL'S RULES ───────────────────────────────────────────────
  const CH = await import(path.join(__dirname, "../client/src/lib/changes.js"));
  const kinds = (p, m = "POST") => [...CH.kindsOfWrite(p, m, null).kinds];
  ok("§C a Thread write is a task change (a next step IS a task)", kinds("/threads/th_1/dismiss").includes("task"), kinds("/threads/th_1/dismiss"));
  ok("§C a guest's write is an event change, for that event", kinds(`/events/ev_1/attendees/a_1`, "PATCH").includes("event")
    && [...(CH.kindsOfWrite("/events/ev_1/attendees", "POST", null).ids.event || [])].includes("ev_1"), kinds(`/events/ev_1/attendees/a_1`, "PATCH"));
  ok("§C a grant's write is a task change too (its deadlines are tasks)", kinds("/grants/g_1/milestones").includes("task"), kinds("/grants/g_1/milestones"));

  // ── THE BROWSER LEG ────────────────────────────────────────────────────────
  const ev1 = await api("POST", "/events", tok, { name: "Heron Supper Club", date: today, eventType: "gala", description: "A supper." });
  const E1 = ev1.body && (ev1.body.id || (ev1.body.event && ev1.body.event.id));
  const ev2 = await api("POST", "/events", tok, { name: "Heron Spring Gala", date: today, eventType: "gala", description: "The gala." });
  const E2 = ev2.body && (ev2.body.id || (ev2.body.event && ev2.body.event.id));
  await api("POST", `/events/${E2}/attendees`, tok, { donorIds: [P("eli")] });
  await api("POST", `/donors/${P("fay")}/gifts`, tok, { amount: 400, date: today, type: "cash", eventId: E2 });
  const th = await api("POST", `/donors/${P("gus")}/threads`, tok, { label: "Call Gus about the gala", due: today, ownerId: ME });
  await api("POST", `/donors/${P("hal")}/volunteer-hours`, tok, { date: today, hours: 2, role: "Shelving" });
  ok("browser fixtures: two events, a guest, an event gift and a next step due today", !!E1 && !!E2 && th.status < 300, { E1, E2, thread: th.status });

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const text = async sel => ((await page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: WAIT }).then(() => true).catch(() => false);
  const noReload = async (label, fn) => {
    const before = loads;
    try { await fn(); } catch (e) { ok(label + " ran to the end", false, String(e && e.message || e).split("\n")[0]); return; }
    ok(label + ": no page load happened", loads === before, { loads: loads - before });
  };
  // A figure tile's number, by its label, inside a region.
  const tile = (sel, label) => page.evaluate(([s, l]) => {
    const root = document.querySelector(s); if (!root) return null;
    const el = [...root.querySelectorAll("*")].find(e => e.children.length === 0 && e.textContent.trim() === l);
    const box = el && el.closest("div[class], div[style]") && el.parentElement && el.parentElement.parentElement;
    const m = box && box.textContent.replace(l, "").match(/\d+/);
    return m ? Number(m[0]) : null;
  }, [sel, label]);

  // ── §1 · THE EVENT PAGE: GUESTS ADDED AND MARKED COME ─────────────────────
  await open(`/app/events`);
  await noReload("§1", async () => {
    await page.getByText("Heron Supper Club").first().click();
    await page.locator('[data-testid="event-detail"]').waitFor({ timeout: 20000 });
    const s = page.getByPlaceholder("Search donors…");
    for (const n of ["Ada Quill", "Bram Oduya"]) { await s.fill(n.split(" ")[0]); await page.getByRole("button", { name: new RegExp(n) }).first().click({ timeout: 10000 }); }
    await page.getByRole("button", { name: /^Add \d+ donor/ }).first().click();
    const added = await until(() => /Attendees \(2\)/.test(document.body.innerText));
    ok("§1 Attendees says 2 after the add", added, (await page.locator("body").innerText()).match(/Attendees \(\d+\)/));
    const inv = await until(() => { const r = document.querySelector('[data-testid="ev-report"]'); return r && /2 invited/.test(r.innerText); });
    ok("§1 After the event says 2 invited", inv, await text('[data-testid="ev-report"]').then(t => t.slice(0, 160)));
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-testid="event-detail"] button:has-text("Invited")').last().click();
      await page.locator('[data-testid="event-detail"] select').first().selectOption("attended");
      await page.waitForTimeout(400);
    }
    const came = await until(() => { const r = document.querySelector('[data-testid="ev-report"]'); return r && /2 came/.test(r.innerText); });
    ok("§1 After the event says 2 came (W-1107-Volunteers-01)", came, await text('[data-testid="ev-report"]').then(t => t.slice(0, 200)));
  });

  // ── §2 · FUNDRAISING: THE DESK'S ATTENDANCE MOVES THE LEAD CARD ───────────
  await open(`/app/fundraising`);
  await noReload("§2", async () => {
    const lead = page.locator('[data-testid="fr-lead-event"]');
    await lead.waitFor({ timeout: 20000 });
    const before = await text('[data-testid="fr-lead-event"]');
    ok("§2 the lead card is the gala, nobody came yet", /Heron Spring Gala/.test(before) && /Came\s*0/.test(before), before.slice(0, 160));
    await page.locator('[data-fr-section="campaigns"]').first().click();
    await page.getByRole("button", { name: "Tickets & sponsors" }).first().click();
    await page.getByText("Heron Spring Gala").first().click();
    const row = page.locator('[data-testid="event-guest-row"]', { hasText: "Eli Strand" });
    await row.getByRole("button", { name: "Came" }).click({ timeout: 15000 });
    await page.locator('[data-testid="event-save-attendance"]').click();
    await page.getByText("Attendance saved").first().waitFor({ timeout: 10000 });
    await page.locator('[data-fr-section="overview"]').first().click();
    const moved = await until(() => /\bCame\s*1\b/.test((document.querySelector('[data-testid="fr-lead-event"]') || {}).innerText || ""));
    ok("§2 the lead card says 1 came, with no reload (W-1107-Volunteers-01)", moved, (await text('[data-testid="fr-lead-event"]')).slice(0, 200));
  });

  // ── §3 · A NEXT STEP SNOOZED TO LATER LEAVES THE BADGE ────────────────────
  // From the profile's Thread (Home's Thread rows carry the same menu).
  await open(`/donors/${P("gus")}`);
  await noReload("§3", async () => {
    const badge = '[data-testid="tasks-rail-badge"]';
    await page.locator(badge).first().waitFor({ timeout: 20000 });
    const b0 = Number(await text(badge)) || 0;
    ok("§3 the Tasks badge counts the next step due today", b0 >= 1, b0);
    if (process.env.STALE2_SHOTS) await page.screenshot({ path: path.join(process.env.STALE2_SHOTS, "home.png"), fullPage: true });
    await page.getByRole("button", { name: /More actions for Gus Penhale/ }).first().click({ timeout: 15000 });
    await page.getByRole("button", { name: /revisit on a date/ }).click();
    await page.locator('[role="menu"]').getByRole("button", { name: "Snooze", exact: true }).click();
    const moved = await until(([n]) => { const el = document.querySelector('[data-testid="tasks-rail-badge"]'); return !el || Number(el.textContent || 0) === n - 1; }, [b0]);
    ok("§3 the badge drops by one, with no reload (W-1107-Volunteers-15)", moved, { before: b0, after: await text(badge) });
  });

  // ── §4 · HOURS LOGGED ELSEWHERE MOVE THE OPEN VOLUNTEER PANEL ─────────────
  // The kiosk, the Volunteers page or Atlas log hours while this profile is
  // open; Atlas's told() announces it on the one channel (the bell's worker
  // marks do the same for the kiosk), and the panel's total re-reads.
  await open(`/donors/${P("hal")}`);
  await noReload("§4", async () => {
    const tot = '[data-testid="volunteer-total"]';
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 });   // the panel sits on Giving
    await page.locator(tot).first().waitFor({ timeout: 20000 });
    const before = await text(tot);
    const logged = await api("POST", `/donors/${P("hal")}/volunteer-hours`, tok, { date: today, hours: 3, role: "Sorting" });
    ok("§4 three more hours are logged elsewhere", logged.status === 201, { status: logged.status, body: logged.body && (logged.body.error || "") });
    // Atlas or Tell Steward logged it: VOICE-4's told(), which may have changed anything.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: {} })));
    const moved = await until(([b]) => { const el = document.querySelector('[data-testid="volunteer-total"]'); return el && el.textContent.replace(/\s+/g, " ").trim() !== b; }, [before]);
    ok("§4 the panel's hours move, with no reload (W-1107-Volunteers-08)", moved, { before, after: await text(tot) });
  });

  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
