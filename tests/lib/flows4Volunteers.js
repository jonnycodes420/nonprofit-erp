// tests/lib/flows4Volunteers.js (run by tests/flows4.test.js): FLOWS-4, the volunteer, event and
// meeting half. EACH ITEM IS DRIVEN BY REAL CLICKS ON THE BUILT CLIENT, with the API and the
// rows checked behind it.
// Guards donor data and email: a "Missed you" draft waited for a guest who came and gave, an
// archived event stayed on the Calendar and on a guest's Coming up, one entry of hours counted
// twice in the funder's report, and one drag wrote two notes on a person's timeline.
//
//   §1 one entry of hours is one row: a double click on Log shift writes one shift, and By
//      person, By program and By month each foot to the header, each entry once
//      (W-1109-Volunteers-26)
//   §2 "Missed you" goes to Registered and not Attended, as the list stands: a guest marked
//      No Show and then Attended has no draft waiting, the one who registered and never came
//      has one; archiving the event retires the drafts and the task, "event archived"
//      (W-1109-Volunteers-01X)
//   §3 an archived event leaves the Calendar and its guests' Coming up, and stays in their
//      history (W-1109-Volunteers-06X)
//   §4 one drag of a meeting writes one "Meeting moved" note, and the same drag sent twice
//      still writes one (W-1109-Volunteers-18X)
//
// Planted defect (FLOWS-4 report): the By program grouping summed per sign-up row (the old
// join) turns §1's footing red.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, login, api, q, civilPlusDays, browserLegOrSkip } = require("../helpers");
const { DIST } = require("./dist");

const PASSWORD = "loadtest1234";
const ORG = "org_flows4v";
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
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Flows Four Heron Commons',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ines Varro','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, types = '["donor"]') => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5::jsonb,$6,'Ines Varro','system:test/flows4-volunteers','FLOWS-4 test')`,
  [P(id), ORG, name, `${id}@flows4v.example.org`, types, ME]);
const sum = xs => Math.round((xs || []).reduce((a, r) => a + Number(r.hours) * 100, 0));

module.exports = async function flows4Volunteers() {
  const tok = await freshOrg();
  const today = civilPlusDays(0), yesterday = civilPlusDays(-1), ahead3 = civilPlusDays(3), tomorrow = civilPlusDays(1);
  for (const [id, name, t] of [["wren", "Wren Halvorsen", '["volunteer"]'], ["tam", "Tamsin Okafor", '["volunteer"]'],
    ["renee", "Renee Okonjo", '["donor"]'], ["jona", "Jonathan Avery", '["donor"]'], ["mae", "Mae Ostrander", '["donor"]']]) await person(id, name, t);

  // §1: Wren checked in to a 9-to-12 shift of an opportunity in the Food pantry program: 3 hours.
  const opp = await api("POST", "/volunteer-hub/opportunities", tok, { name: "Pantry sorting", program: "Food pantry", location: "Heron Hall" });
  const slot = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.body.id, date: today, startTime: "09:00", endTime: "12:00", name: "Morning sort", roles: [{ name: "Sorter", needed: 2 }] });
  const su = await api("POST", "/volunteer-hub/signups", tok, { slotId: slot.body.id, personId: P("wren") });
  const ci = await api("POST", "/volunteer-hub/checkin", tok, { signupId: su.body.signupId });
  // A second sign-up row that names the same logged shift: the shape the old By program join
  // counted once per sign-up (a sign-up taken off after its hours were logged keeps its row).
  await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,status,source,created_by,created_by_name,hours_shift_id)
           VALUES ($1,$2,$3,$4,'cancelled','staff','system:test/flows4-volunteers','FLOWS-4 test',$5)`, [P("su2"), ORG, slot.body.id, P("wren"), ci.body && ci.body.shiftId]);
  ok("fixture: Wren's 3 hours from a check-in, and a second sign-up naming the same shift", ci.status === 200 && !!(ci.body && ci.body.shiftId), { ci: ci.status, b: ci.body && ci.body.message });

  // §2: QA A4 Gala, yesterday. Renee and Jonathan registered; Renee gave at it.
  const ev = await api("POST", "/events", tok, { name: "QA A4 Gala", date: yesterday, eventType: "gala", description: "Gala." });
  const EID = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  await api("POST", `/events/${EID}/attendees`, tok, { donorIds: [P("renee"), P("jona")] });
  await api("POST", `/donors/${P("renee")}/gifts`, tok, { amount: 500, date: yesterday, type: "cash", eventId: EID });
  // §3: Lantern Walk, three days ahead, Mae on the list; archived.
  const fut = await api("POST", "/events", tok, { name: "Lantern Walk", date: ahead3, startTime: "18:00", endTime: "20:00", eventType: "community", description: "Walk." });
  const FID = fut.body && (fut.body.id || (fut.body.event && fut.body.event.id));
  await api("POST", `/events/${FID}/attendees`, tok, { donorIds: [P("mae")] });
  const arF = await api("POST", `/events/${FID}/archive`, tok, {});
  // §4: a meeting with Mae tomorrow at 10 AM, kept in Steward.
  const bv = await api("POST", `/donors/${P("mae")}/book-visit`, tok, { startsAt: `${tomorrow}T15:00:00.000Z`, endsAt: `${tomorrow}T16:00:00.000Z`, title: "Coffee with Mae" });
  ok("fixture: an event yesterday, an archived one ahead, a meeting tomorrow", !!EID && !!FID && arF.status === 200 && bv.status === 201, { ev: ev.status, fut: fut.status, ar: arF.status, bv: bv.status });

  // ── §4 API · THE SAME DRAG SENT TWICE ─────────────────────────────────────
  {
    const [cal] = await q(`SELECT id FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids)`, [ORG, P("mae")]);
    const body = { startsAt: `${civilPlusDays(2)}T15:00:00.000Z`, endsAt: `${civilPlusDays(2)}T16:00:00.000Z`, actionKey: "flows4-drag-0001" };
    const [a, b] = await Promise.all([api("POST", `/calendar/events/${cal.id}/move`, tok, body), api("POST", `/calendar/events/${cal.id}/move`, tok, body)]);
    const notes = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Meeting moved%'`, [ORG, P("mae")]);
    ok("§4 one drag that reaches the server twice writes one \"Meeting moved\" note (W-1109-Volunteers-18X)", a.status === 200 && b.status === 200 && notes.length === 1, { a: a.status, b: b.status, notes: notes.map(n => n.note) });
    // and back to tomorrow for the browser leg
    await api("POST", `/calendar/events/${cal.id}/move`, tok, { startsAt: `${tomorrow}T15:00:00.000Z`, endsAt: `${tomorrow}T16:00:00.000Z`, actionKey: "flows4-drag-0002" });
  }

  const why = (() => {
    if (!optional(PW)) return "(playwright not installed)";
    if (!require("fs").existsSync(DIST)) return "(no client dist)";
    return null;
  })();
  if (browserLegOrSkip(why, "(flows4 volunteer browser leg)")) return;

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
  const shot = async n => { if (process.env.FLOWS4_SHOTS) await page.screenshot({ path: path.join(process.env.FLOWS4_SHOTS, n + ".png"), fullPage: true }); };
  const leg = async (label, fn) => { try { await fn(); } catch (e) { ok(label + " ran to the end", false, String(e && e.message || e).split("\n")[0]); await shot("fail-" + label.replace(/\W+/g, "")); } };

  // ── §1 · ONE ENTRY OF HOURS IS ONE ROW, AND EVERY BREAKDOWN FOOTS ─────────
  await leg("§1", async () => {
    await open("/app/volunteers");
    await page.getByText("Records", { exact: true }).first().click({ timeout: 20000 });
    await page.getByText("Shifts and hours", { exact: true }).first().click();
    await page.locator("select").first().selectOption({ label: "Tamsin Okafor" });
    const d = page.getByPlaceholder("MM/DD/YYYY").first();
    await d.click(); await d.type(`${today.slice(5, 7)}/${today.slice(8, 10)}/${today.slice(0, 4)}`); await d.press("Tab");
    await page.getByPlaceholder("Hours").fill("3");
    await page.getByPlaceholder("What they did").fill("Food pantry");
    await page.getByRole("button", { name: "Log shift" }).dblclick();
    await page.waitForTimeout(1500);
    const tam = await q(`SELECT hours FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, P("tam")]);
    ok("§1 a double click on Log shift writes one shift of 3 hours (W-1109-Volunteers-26)", tam.length === 1 && Number(tam[0].hours) === 3, tam);

    const rep = await api("GET", `/volunteer-hub/report?from=${today.slice(0, 8)}01&to=${today}`, tok);
    const r = rep.body || {};
    const total = Math.round(Number(r.totalHours) * 100);
    ok("§1 the header is every entry once: 6 hours (Wren's 3 from her check-in, Tamsin's 3 logged)", total === 600, { total: r.totalHours });
    ok("§1 By person, By program and By month each foot to the header", sum(r.byPerson) === total && sum(r.byProgram) === total && sum(r.byMonth) === total,
      { person: sum(r.byPerson), program: sum(r.byProgram), month: sum(r.byMonth), total, byProgram: r.byProgram });
    const pantry = (r.byProgram || []).filter(x => x.program === "Food pantry");
    ok("§1 Food pantry is one row of 6 hours: Wren's entry counted once, though two sign-ups name it", pantry.length === 1 && pantry[0].hours === 6, r.byProgram);
    const rows = await api("GET", `/volunteer-hub/report/rows?rows=${encodeURIComponent("program:Food pantry")}&from=${r.from}&to=${r.to}`, tok);
    ok("§1 the rows behind Food pantry list each entry once", rows.body && rows.body.count === 2 && rows.body.totalHours === 6, rows.body && { count: rows.body.count, total: rows.body.totalHours });

    await page.getByText("Hours report", { exact: true }).first().click();
    await page.locator('[data-testid="vol-report"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    const t = await body();
    await shot("s1-report");
    const month = (t.match(/By month (\d{4}-\d{2}) ([\d.]+) hours/) || []);
    ok("§1 the screen's By month says 6 hours, the header's number", month[2] === "6" && /6 hours from 2 people/.test(t), { month: month.slice(1), head: (t.match(/[\d.]+ hours from \d+ people?/) || [""])[0] });
    ok("§1 the screen lists Food pantry once under By program", (t.match(/Food pantry \d/g) || []).length === 1, (t.match(/By program.{0,120}/) || [""])[0]);
  });

  // ── §2 · "MISSED YOU" GOES TO WHO MISSED IT, AS THE LIST STANDS ───────────
  await leg("§2", async () => {
    await open("/app/events");
    await page.getByRole("button", { name: "Past", exact: true }).first().click({ timeout: 20000 });
    await page.getByText("QA A4 Gala").first().click();
    await page.waitForTimeout(1200);
    const ST = /^(Invited|Registered|Attended|No Show|Confirmed)$/;
    const setSt = async (name, label) => {
      const row = page.locator("div", { hasText: name }).filter({ has: page.getByRole("button", { name: ST }) }).last();
      await row.getByRole("button", { name: ST }).first().click();
      await row.locator("select").first().selectOption({ label });
      await page.waitForTimeout(1500);
    };
    await setSt("Renee Okonjo", "No Show");
    await setSt("Jonathan Avery", "Registered");
    await setSt("Renee Okonjo", "Attended");
    await shot("s2-guests");
    const drafts = await q(`SELECT donor_id, status, archived_by_name FROM milestone_drafts WHERE org_id=$1 AND milestone_key=$2`, [ORG, "event_missed:" + EID]);
    const waiting = drafts.filter(x => x.status === "pending_review").map(x => x.donor_id);
    ok("§2 Renee, marked No Show and then Attended (and who gave), has no \"Missed you\" waiting (W-1109-Volunteers-01X)", !waiting.includes(P("renee")), drafts);
    ok("§2 Jonathan, registered and not attended, has the \"Missed you\" draft", waiting.length === 1 && waiting[0] === P("jona"), drafts);
    const [task] = await q(`SELECT title, done, voided_at, voided_reason FROM tasks WHERE org_id=$1 AND event_id=$2 AND type='event_no_show'`, [ORG, EID]);
    ok("§2 the task counts the one person who missed it", task && /1 person did not come, 1 draft waiting/.test(task.title) && !task.voided_at, task);
    const fu = await api("GET", `/events/${EID}/follow-up`, tok);
    ok("§2 \"Thank them for coming\" counts the one who came (Renee)", fu.body && fu.body.came === 1, fu.body);

    // Archive it from the page: the draft and the task are retired, "event archived".
    await page.locator('[data-testid="ev-archive"]').click({ timeout: 20000 });
    await page.getByRole("button", { name: "Archive the event" }).click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await shot("s2-archived");
    const after = await q(`SELECT status, archived_by_name FROM milestone_drafts WHERE org_id=$1 AND milestone_key=$2 AND donor_id=$3`, [ORG, "event_missed:" + EID, P("jona")]);
    const [t2] = await q(`SELECT done, voided_at, voided_reason FROM tasks WHERE org_id=$1 AND event_id=$2 AND type='event_no_show'`, [ORG, EID]);
    ok("§2 archiving the event retires its waiting draft, noted \"event archived\"", after.length === 1 && after[0].status === "archived" && after[0].archived_by_name === "event archived", after);
    ok("§2 and closes its task, noted \"event archived\"", t2 && !!t2.voided_at && t2.voided_reason === "event archived", t2);
  });

  // ── §3 · AN ARCHIVED EVENT LEAVES THE CALENDAR AND COMING UP ──────────────
  await leg("§3", async () => {
    const cal = await api("GET", `/calendar/items?from=${ahead3}&to=${ahead3}`, tok);
    const items = (cal.body && cal.body.items) || [];
    await open(`/app/calendar?date=${ahead3}`);
    await page.waitForTimeout(1200);
    const t = await body();
    await shot("s3-calendar");
    ok("§3 the archived Lantern Walk is not on the Calendar (W-1109-Volunteers-06X)", !items.some(i => i.type === "event") && !/Lantern Walk/.test(t), items.map(i => i.title));
    await open(`/donors/${P("mae")}`);
    await page.waitForTimeout(2500);
    const rail = await page.locator('[data-testid="dp-rail-coming-up"]').innerText().catch(() => "");
    await shot("s3-profile");
    ok("§3 nor on Mae's Coming up", !/Lantern Walk/.test(rail) && !/Lantern Walk/.test((await body()).match(/Coming up.{0,300}/) ? (await body()).match(/Coming up.{0,300}/)[0] : ""), rail);
    const hist = await api("GET", `/donors/${P("mae")}/events`, tok);
    ok("§3 and it stays in her history", Array.isArray(hist.body) && hist.body.some(e => e.name === "Lantern Walk"), hist.body);
  });

  // ── §4 · ONE DRAG, ONE NOTE ────────────────────────────────────────────────
  await leg("§4", async () => {
    await q(`DELETE FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Meeting moved%'`, [ORG, P("mae")]);
    await open(`/app/calendar?date=${tomorrow}`);
    await page.waitForTimeout(1200);
    const sent = [];
    page.on("request", r => { if (/\/calendar\/events\/[^/]+\/move$/.test(r.url())) sent.push(r.postData() || ""); });
    const blk = page.locator('[data-testid="cal-item"][data-type="meeting"]').first();
    const bb = await blk.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 8); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 125, bb.y + 8, { steps: 25 });
    await page.mouse.up(); await page.waitForTimeout(2500);
    await shot("s4-moved");
    const notes = await q(`SELECT note, metadata->>'action_key' AS k FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Meeting moved%'`, [ORG, P("mae")]);
    ok("§4 one drag writes one \"Meeting moved\" note (W-1109-Volunteers-18X)", notes.length === 1, notes);
    ok("§4 and the drag carries its one action key", sent.length === 1 && /"actionKey":"[A-Za-z0-9_-]{8,}"/.test(sent[0]) && notes[0] && !!notes[0].k, { sent, notes });
  });

  ok("no page errors on any leg", !errors.length, errors.slice(0, 3));
  await browser.close();
};
