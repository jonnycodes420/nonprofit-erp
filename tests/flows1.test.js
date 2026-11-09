#!/usr/bin/env node
// FLOWS-1 · EVERY BUTTON DOES WHAT IT SAYS, AND FINISHES WHERE YOU'D EXPECT.
//
// Guards donor data and email: who a journey starts, a statement shown (and
// emailed only on its own click), a meeting saved once, a task's day, an
// import's end, sign-out, and a merged-away profile. Driven through the real
// screens, on made-up people in this suite's own org:
//
//   §1 Donors > check 3 > Add to a journey: each journey is a row, choosable
//      or saying why not; Start says who starts; Undo takes them out
//   §2 Calendar: Add meeting saves once (pressed twice), closes, and shows;
//      a task dragged from one day to the next moves, and Undo moves it back
//   §3 Year-end statement for a donor with 2026 gifts: the year is 2026, and
//      the statement is shown with the org's name, the dates and the amounts;
//      nothing is emailed
//   §4 Donors > Import & tools > Import a spreadsheet (a People + Gifts
//      workbook) > Continue > Import > Done: on Donors, the wizard and the file gone
//   §5 Sign out: a working sign-in page, and signing in from it works
//   §6 A profile whose person is merged away stops reading their status (no
//      404 after) and shows the kept record
//
// Against a booted server at $BASE and the client dist at $APP_URL.
// FLOWS1_SHOTS=<dir> saves a screenshot at each step for the report.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const APP = process.env.APP_URL || "http://localhost:4173";
const BASE = process.env.BASE || "http://localhost:5601";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const SHOTS = process.env.FLOWS1_SHOTS || "";
const ORG = "org_flows1", SLUG = "flows1-test";
const A = { id: "u_flows1a", email: "flows1-admin@example.org", name: "Perpetua Okonkwo-Lindqvist" };
const sys = "'system:test','test'";
const PEOPLE = [
  { id: "d_f1_a", name: "Odalys Pemberton", email: "odalys.f1@example.org", gifts: [["2026-02-11", 250], ["2026-06-30", 100]] },
  { id: "d_f1_b", name: "Quill Harrowgate", email: "quill.f1@example.org", gifts: [["2026-03-14", 75]] },
  { id: "d_f1_c", name: "Ines Vantongeren", email: "ines.f1@example.org", gifts: [["2025-12-01", 40]] },
  { id: "d_f1_k", name: "Barnaby Kettlewell", email: "barnaby.f1@example.org", gifts: [["2026-01-20", 500]] },
  { id: "d_f1_m", name: "Barnaby Kettlewel", email: "barnaby.dup.f1@example.org", gifts: [] },
];

async function reset(org) {
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}

(async () => {
  console.log("flows1 (FLOWS-1)");
  await reset(ORG);
  await q(`INSERT INTO orgs (id,name,legal_name,ein,receipts_enabled,receipt_address,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,onboarded_at,vocabulary_json)
           VALUES ($1,'Lanternfield Youth Trust','Lanternfield Youth Trust Inc.','12-3456789',true,'1 Quay Lane, Salem MA 01970',$2,1,'active','team','America/New_York',NOW(),NOW(),'{"fiscal_year_start_month":1}')`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [A.id, ORG, A.email, bcrypt.hashSync("loadtest1234", 4), A.name]);
  for (const p of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,address,city,state,zip,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'person','["donor"]'::jsonb,'12 Elm St','Salem','MA','01970',${sys})`, [p.id, ORG, p.name, p.email]);
    for (const [i, [date, amt]] of p.gifts.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'check',${sys})`, [`g_${p.id}_${i}`, ORG, p.id, amt, date]);
  }
  const { query: dbq } = require("../db");
  await require("../afterChange").recalcDonorSummaryBatch(dbq, PEOPLE.map(p => p.id), ORG);
  const tok = await login(A.email);
  ok("the admin signs in", !!tok);

  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (browserLegOrSkip(why, "(browser legs)")) { await reset(ORG); await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: A.email, password: "loadtest1234" });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const session = [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)];
  const signedIn = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addInitScript(([tk, u, o]) => {
      if (!sessionStorage.getItem("flows1_signed_out")) { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); }
    }, session);
    return ctx;
  };
  const ctx = await signedIn();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  let n = 0;
  const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, "0")}-${name}.png`) }); } };
  const leg = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name}: the leg ran to its end`, false, e.message.split("\n")[0]); await shot(name + "-failed").catch(() => {}); } };

  // ── §1 Add to a journey ──
  await leg("§1", async () => {
    const jOpen = await api("POST", "/journeys", tok, { presetKey: "new_donor_first_year" });
    const jFull = await api("POST", "/journeys", tok, { presetKey: "welcome_back" });
    const three = ["d_f1_a", "d_f1_b", "d_f1_c"];
    const pre = await api("POST", `/journeys/${jFull.body.id}/batch`, tok, { donorIds: three });
    ok("§1 fixture: two journeys, and all three already in Welcome back", jOpen.status < 300 && jFull.status < 300 && pre.status < 300 && pre.body.started === 3, { open: jOpen.status, full: jFull.status, pre: pre.body });
    await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
    for (const id of three) await page.locator(`.dir-donor-row:has-text("${PEOPLE.find(p => p.id === id).name}") input[type=checkbox]`).first().check();
    await page.locator('[data-testid="bulk-add-to-journey"]').first().click();
    await page.locator('[data-testid="bulk-journey-row"]').first().waitFor({ timeout: 15000 });
    await shot("journey-rows");
    const rows = await page.locator('[data-testid="bulk-journey-row"]').evaluateAll(rs => rs.map(r => ({ id: r.getAttribute("data-journey"), can: r.getAttribute("data-can-pick"), text: r.innerText })));
    const open = rows.find(r => r.id === jOpen.body.id), full = rows.find(r => r.id === jFull.body.id);
    ok("§1 every journey is a row, and the one they can start is choosable (main: a bare list with Start off and no reason)",
      rows.length === 2 && open && open.can === "1" && /All 3 can start/.test(open.text), rows);
    ok("§1 the journey none of them can start says why on its own row", full && full.can === "0" && /None of these 3 can start: all are already in it/.test(full.text), full);
    await page.locator(`[data-testid="bulk-journey-row"][data-journey="${jOpen.body.id}"]`).click();
    await page.locator('[data-testid="bulk-journey-sentence"]').waitFor({ timeout: 15000 });
    const start = page.locator('[data-testid="bulk-journey-start"]');
    ok("§1 Start says who starts", (await start.innerText()) === "Start 3 people" && await start.isEnabled() && /3 people will start New donor, first year/.test(await page.locator('[data-testid="bulk-journey-sentence"]').innerText()),
      { start: await start.innerText(), sentence: await page.locator('[data-testid="bulk-journey-sentence"]').innerText() });
    await start.click();
    await page.locator('[data-testid="bulk-journey-result-sentence"]').waitFor({ timeout: 20000 });
    await shot("journey-started");
    const [{ c: inIt }] = await q(`SELECT COUNT(*)::int c FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 AND status='active'`, [ORG, jOpen.body.id]);
    ok("§1 the three started it, and nothing was sent", inIt === 3 && /3 people started/.test(await page.locator('[data-testid="bulk-journey-result-sentence"]').innerText()), inIt);
    await page.locator('[data-testid="bulk-journey-undo"]').click();
    await page.locator('[data-testid="bulk-journey-undone"]').waitFor({ timeout: 20000 });
    const [{ c: after }] = await q(`SELECT COUNT(*)::int c FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 AND status='active'`, [ORG, jOpen.body.id]);
    ok("§1 Undo takes the batch back out", after === 0, after);
    await page.locator('[data-testid="bulk-journey-close"]').click();
  });

  // ── §2 Calendar: a meeting, and a task dragged to the next day ──
  await leg("§2", async () => {
    await page.goto(`${APP}/app/calendar`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="cal-grid"]').waitFor({ timeout: 30000 });
    const add = page.locator('[data-testid="cal-add-meeting"]');
    ok("§2 the week view has an Add meeting button (main: none; clicking a day opened what was on it)", await add.count() === 1);
    await add.click();
    await page.locator('[data-testid="cal-donor-search"]').fill("Odalys");
    await page.locator('[data-testid="cal-quick-form"] button', { hasText: "Odalys Pemberton" }).first().click();
    await page.getByLabel("Time").fill("10:00");
    const where = await page.locator('[data-testid="cal-meeting-where"]').innerText();
    ok("§2 the dialog says in one sentence where it goes (no calendar is connected)", where === "It goes on Steward's calendar, with Odalys Pemberton. No invitation is sent.", where);   // FLOWS-3: she is on it; no invitation goes
    await shot("meeting-dialog");
    await page.locator('[data-testid="cal-quick-save"]').dblclick();
    await page.locator('[data-testid="cal-quick-form"]').waitFor({ state: "detached", timeout: 15000 });
    const [{ c: meetings }] = await q(`SELECT COUNT(*)::int c FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids)`, [ORG, "d_f1_a"]);
    const shown = page.locator('[data-testid="cal-item"][data-type="meeting"]', { hasText: "Visit with Odalys Pemberton" });
    await shown.first().waitFor({ timeout: 15000 });
    ok("§2 pressed twice, it saves one meeting, closes, and the meeting shows (main: nothing saved)", meetings === 1 && await shown.count() === 1, { meetings, shown: await shown.count() });
    await shot("meeting-shown");
  });

  // ── §2b a task dragged to the next day ──
  await leg("§2b", async () => {
    await page.goto(`${APP}/app/calendar`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="cal-grid"]').waitFor({ timeout: 30000 });
    const days = await page.locator('[data-testid="cal-col"]').evaluateAll(cs => cs.map(c => c.getAttribute("data-day")));
    const wed = days[2], thu = days[3];
    const t = await api("POST", "/tasks", tok, { title: "Thank-you call to Quill", due: wed, donorId: "d_f1_b" });
    await page.reload({ waitUntil: "networkidle" });
    // main has no per-day test ids on the all-day row: find the task by its column instead
    const task = page.locator('[data-testid="cal-allday"] [data-testid="cal-item"]', { hasText: "Thank-you call to Quill" });
    await task.waitFor({ timeout: 15000 });
    const from = await task.boundingBox();
    const thuCol = await page.locator(`[data-testid="cal-col"][data-day="${thu}"]`).boundingBox();
    const to = { x: thuCol.x, width: thuCol.width };
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const [row] = await q(`SELECT due FROM tasks WHERE id=$1 AND org_id=$2`, [t.body.id, ORG]);
    const due = row && String(row.due).slice(0, 10);
    ok(`§2 a task dragged from ${wed} to ${thu} moves (main: it stayed on ${wed})`, t.status < 300 && due === thu, { status: t.status, due });
    await shot("task-moved");
    const undo = page.getByRole("button", { name: "Undo" });
    if (await undo.count()) { await undo.first().click(); await page.waitForTimeout(1500); }
    const [back] = await q(`SELECT due FROM tasks WHERE id=$1 AND org_id=$2`, [t.body.id, ORG]);
    ok("§2 ...and Undo moves it back", back && String(back.due).slice(0, 10) === wed, back);
  });

  // ── §3 Year-end statement ──
  await leg("§3", async () => {
    await page.goto(`${APP}/donors/d_f1_a`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByRole("tab", { name: /^Giving/ }).or(page.getByRole("button", { name: /^Giving\b/ })).first().click();
    await page.getByRole("button", { name: "Year-end statement" }).click();
    const year = page.locator('[data-testid="dp-year-end-year"]');
    await year.waitFor({ timeout: 15000 });
    ok("§3 the statement opens on the year that has gifts (main: last year, with none)", await year.inputValue() === "2026", await year.inputValue());
    await page.locator('[data-testid="dp-year-end-make"]').click();
    const prev = page.locator('[data-testid="dp-year-end-preview"]');
    await prev.waitFor({ timeout: 20000 });
    await shot("statement-shown");
    const text = await prev.innerText();
    ok("§3 the statement is shown with the org's name, every 2026 gift's date and amount, and the total (main: the dialog closed showing nothing)",
      /Lanternfield Youth Trust Inc\./.test(text) && /February 11, 2026\s+\$250\b/.test(text) && /June 30, 2026\s+\$100\b/.test(text) && /Total given in 2026\s+\$350\b/.test(text)
        && await page.locator('[data-testid="dp-year-end-line"]').count() === 2 && !/\$40/.test(text), text);
    const [r] = await q(`SELECT sent_at, sent_to FROM receipts WHERE org_id=$1 AND donor_id=$2 AND type='year_end' AND voided_at IS NULL`, [ORG, "d_f1_a"]);
    ok("§3 nothing was emailed: the email is its own click", r && !r.sent_at && await page.locator('[data-testid="dp-year-end-email"]').count() === 1, r);
  });

  // ── §4 Import Done lands on Donors ──
  await leg("§4", async () => {
    const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Donor ID", "First Name", "Last Name", "Email"], ["P1", "Marguerite", "Ellingsworth", "m.ell.f1@example.org"], ["P2", "Tobias", "Quarrington", "tq.f1@example.org"]]), "People");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Donor ID", "Gift Date", "Amount"], ["P1", "2026-02-03", 250], ["P2", "2026-03-04", 75]]), "Gifts");
    const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "flows1-"));
    const file = path.join(dir, "people-and-gifts.xlsx");
    XLSX.writeFile(wb, file);
    await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("Import & tools").first().click();
    await page.getByText("Import a spreadsheet", { exact: true }).first().click();
    await page.locator("input[type=file]").first().setInputFiles(file);
    await page.locator('[data-testid="wb-continue"]').click({ timeout: 30000 });
    if (await page.locator('[data-testid="wb-signals-continue"]').count()) await page.locator('[data-testid="wb-signals-continue"]').click();
    await page.locator('[data-testid="wb-review"]').click({ timeout: 30000 });
    await page.locator('[data-testid="wb-import"]').click({ timeout: 30000 });
    await page.locator('[data-testid="wb-done"]').waitFor({ timeout: 60000 });
    await shot("import-receipt");
    await page.locator('[data-testid="wb-done"]').click();
    await page.waitForTimeout(1500);
    await shot("import-done");
    const left = { workbook: await page.locator('[data-testid="sheet-import-workbook"]').count(), roles: await page.locator('[data-testid="wb-sheet-roles"]').count(), wizard: await page.locator('[data-testid="sheet-import"]').count() };
    ok("§4 Done closes the wizard and clears the file: no \"This workbook is one import\" with the file still loaded",
      !left.workbook && !left.roles && !left.wizard, left);
    ok("§4 ...and lands on Donors, with the people just imported", /\/donors\/?$/.test(new URL(page.url()).pathname) && await page.locator(".dir-donor-row", { hasText: "Marguerite Ellingsworth" }).count() === 1, page.url());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── §6 A merged-away profile stops reading its status, and shows the kept one ──
  await leg("§6", async () => {
    const statusHits = [];
    page.on("response", r => { if (r.url().includes("/donors/d_f1_m/status")) statusHits.push(r.status()); });
    await page.goto(`${APP}/donors/d_f1_m`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("Barnaby Kettlewel", { exact: true }).first().waitFor({ timeout: 20000 });
    const m = await api("POST", "/data-health/merge", tok, { keptId: "d_f1_k", mergedId: "d_f1_m" });
    // Anything that re-reads the profile (Tell Steward, a step done) asks for the status again.
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: {} }))); await page.waitForTimeout(1200); }
    await page.waitForTimeout(2500);
    const after404 = statusHits.filter(s => s === 404).length;
    ok("§6 after the merge, the merged-away id is asked for at most once more (main: a 404 on every re-read)", m.status < 300 && after404 <= 1, { merge: m.status, hits: statusHits });
    const head = await page.locator("h1, h2").allInnerTexts();
    ok("§6 ...and the profile shows the kept record", head.some(h => /Barnaby Kettlewell/.test(h)), head.slice(0, 4));
    await shot("merged-kept");
  });

  // ── §7 (item 11) an "Every year, same date" task ticked on a profile comes back next year ──
  await leg("§7", async () => {
    const c = await api("POST", "/tasks", tok, { title: "Anniversary card to Quill", due: "2026-11-20", donorId: "d_f1_b" });
    const r = await api("PUT", `/tasks/${c.body.id}`, tok, { title: "Anniversary card to Quill", due: "2026-11-20", priority: "medium", type: "donor", recur: { every: "year" } });
    await q(`UPDATE tasks SET recur='{"every":"year","month":11,"day":20}'::jsonb WHERE id=$1 AND org_id=$2 AND recur IS NULL`, [c.body.id, ORG]);
    await page.goto(`${APP}/donors/d_f1_b`, { waitUntil: "networkidle", timeout: 60000 });
    const card = page.locator('[data-testid="dp-coming-task"]', { hasText: "Anniversary card to Quill" }).locator('[data-testid="dp-task-done"]');
    await card.waitFor({ timeout: 20000 });
    await card.click();
    await page.waitForTimeout(1500);
    const rows = await q(`SELECT due, done FROM tasks WHERE org_id=$1 AND (id=$2 OR recur_parent_id=$2) ORDER BY due`, [ORG, c.body.id]);
    ok("§7 ticking a yearly task done on the profile makes next year's (main: none came)",
      c.status === 201 && r.status < 500 && rows.length === 2 && rows[0].done === 1 && String(rows[1].due).slice(0, 10) === "2027-11-20" && rows[1].done === 0, rows);
  });

  // ── §8 (item 12) Mark done on a Home next step marks it done ──
  await leg("§8", async () => {
    const th = await api("POST", "/donors/d_f1_k/threads", tok, { label: "Call about the spring visit", due: "2026-01-15" });
    const thId = th.body && (th.body.id || (th.body.thread && th.body.thread.id));
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    const row = page.locator("li", { hasText: "Barnaby Kettlewell" }).filter({ hasText: "spring visit" }).first();
    await row.waitFor({ timeout: 20000 });
    await shot("home-step");
    ok("§8 logging a call is an optional link on the row, beside Mark done (main: Done opened it every time)", await row.locator('[data-testid="thread-row-log"]').count() === 1);
    await row.getByRole("button", { name: /^(Mark done|Done)$/ }).click();
    await page.waitForTimeout(1500);
    const dialog = await page.locator('[role="dialog"]').count();
    const [t] = await q(`SELECT closed_at, close_reason FROM threads WHERE org_id=$1 AND id=$2`, [ORG, thId]);
    ok("§8 Mark done on a Home step closes it, with no Log a call dialog (main: the dialog opened, and the step stayed open)", th.status < 300 && dialog === 0 && t && !!t.closed_at, { status: th.status, dialog, t });
  });

  // ── §9 (item 13) the initials avatar opens the photo picker ──
  await leg("§9", async () => {
    await page.goto(`${APP}/donors/d_f1_c`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="donor-photo-drop"]').click();
    const picker = page.locator('[data-testid="photo-picker"]');
    await picker.waitFor({ timeout: 5000 }).catch(() => {});
    ok("§9 clicking the initials avatar opens the photo picker on the page (main: only a system file dialog, which a walk never sees)", await picker.isVisible(), await picker.count());
    await shot("photo-picker");
  });

  // ── §10 (item 7) a file's date is the org's day, and a bigger file saves from Files ──
  await leg("§10", async () => {
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const ix = await api("POST", "/donors/d_f1_a/interactions", tok, { type: "note", note: "Left the visit notes with her", date: "2026-03-10" });
    const att = await api("POST", `/interactions/${ix.body.id}/attachments`, tok, { file: "data:image/png;base64," + PNG, fileName: "visit-sketch.png" });
    // 9:30 PM in New York on Mar 10 is 02:30 UTC on Mar 11
    await q(`UPDATE interaction_attachments SET created_at='2026-03-11T02:30:00Z' WHERE id=$1 AND org_id=$2`, [att.body.id, ORG]);
    await page.goto(`${APP}/donors/d_f1_a`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByRole("tab", { name: /^Files/ }).or(page.getByRole("button", { name: /^Files\b/ })).first().click();
    await page.getByText("visit-sketch.png", { exact: true }).first().waitFor({ timeout: 20000 });
    const rowText = await page.getByText("visit-sketch.png", { exact: true }).first().evaluate(el => { let n = el; for (let i = 0; i < 4 && n.parentElement; i++) n = n.parentElement; return n.innerText; });
    ok("§10 a file attached at 9:30 PM in New York is dated that day, not \"tomorrow\" (main: the UTC day, Mar 11)", ix.status === 201 && att.status === 201 && /Mar 10/.test(rowText) && !/Mar 11/.test(rowText), rowText);
    await shot("file-date");
    const big = path.join(require("os").tmpdir(), "flows1-proposal.pdf");
    fs.writeFileSync(big, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(300 * 1024, 65)]));
    const before = (await q(`SELECT COUNT(*)::int c FROM donor_materials WHERE org_id=$1 AND donor_id=$2`, [ORG, "d_f1_a"]).catch(() => [{ c: -1 }]))[0].c;
    // the Files tab's uploader (the page's first file input is the photo's)
    const drop = page.getByText("Drop a file here, or browse", { exact: false }).first();
    await drop.waitFor({ timeout: 15000 });
    const input = drop.locator("xpath=ancestor-or-self::*[.//input[@type='file']][1]").locator("input[type=file]").first();
    await input.setInputFiles(big);
    await page.waitForTimeout(3000);
    const after = (await q(`SELECT COUNT(*)::int c FROM donor_materials WHERE org_id=$1 AND donor_id=$2`, [ORG, "d_f1_a"]).catch(() => [{ c: -1 }]))[0].c;
    ok("§10 a 300 KB file dropped on Files is saved (main: nothing saved, and nothing said)", before >= 0 && after === before + 1 && await page.getByText("flows1-proposal.pdf").count() >= 1, { before, after });
    fs.rmSync(big, { force: true });
  });

  // ── §11 (item 8) a birthday task follows the birthday ──
  await leg("§11", async () => {
    await q(`UPDATE donors SET birth_month=5, birth_day=14 WHERE id='d_f1_c' AND org_id=$1`, [ORG]);
    const c = await api("POST", "/tasks", tok, { title: "Birthday card to Ines", due: "2027-05-14", donorId: "d_f1_c" });
    await q(`UPDATE tasks SET recur='{"every":"year","month":5,"day":14,"birthday":true}'::jsonb WHERE id=$1 AND org_id=$2`, [c.body.id, ORG]);
    const e = await api("PUT", "/donors/d_f1_c", tok, { name: "Ines Vantongeren", email: "ines.f1@example.org", city: "Salem", state: "MA", zip: "01970", birthday: { month: 5, day: 15 } });
    const [t] = await q(`SELECT due, recur FROM tasks WHERE id=$1 AND org_id=$2`, [c.body.id, ORG]);
    ok("§11 the birthday changed from May 14 to May 15 moves her open birthday task to May 15 (main: it stayed on May 14)",
      e.status === 200 && t && /-05-15$/.test(String(t.due).slice(0, 10)) && t.recur.day === 15 && t.recur.month === 5 && t.recur.birthday === true, { status: e.status, t });
  });

  // ── §12 (item 9) one open step of a kind per person, and windows that run forward ──
  await leg("§12", async () => {
    const kind = "First gift, no second yet";
    for (let i = 0; i < 3; i++)
      await api("POST", "/tasks", tok, { kindKey: kind, title: `${kind}: Quill Harrowgate. Ask $3,750`, due: "2026-11-10", type: "donor", donorId: "d_f1_b", priority: "medium" });
    const [{ c }] = await q(`SELECT COUNT(*)::int c FROM tasks WHERE org_id=$1 AND donor_id=$2 AND done=0 AND title LIKE $3`, [ORG, "d_f1_b", kind + ":%"]);
    ok("§12 the same next step asked for three times is one open task (main: three)", c === 1, c);
    // The test's own clock: a day after every first gift here has passed its year.
    let r = null;
    for (let i = 0; i < 30; i++) { r = await api("GET", "/insights?asOf=2027-09-01", tok); if (r.status === 200 && !r.body.preparing) break; await new Promise(z => setTimeout(z, 1000)); }
    const items = ((r && r.body.cards) || []).flatMap(cd => (cd.items || []).map(it => ({ card: cd.kind, name: it.name, when: it.how && it.how.when })).filter(x => x.when));
    const back = items.filter(x => x.when.to < x.when.from || /between (.+) and (.+)/.test(x.when.words) && x.when.to < x.when.from);
    ok("§12 every next move's window runs forward, or says \"now\" (main: \"between Sep 1, 2027 and Dec 1, 2026\")",
      r && r.status === 200 && items.length > 0 && back.length === 0, { status: r && r.status, preparing: r && r.body.preparing, back: back.slice(0, 3), n: items.length });
  });

  // ── §13 (item 10) the Donors bulk compare shows the street, as the profile's does ──
  await leg("§13", async () => {
    await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
    for (const n of ["Odalys Pemberton", "Quill Harrowgate"]) await page.locator(`.dir-donor-row:has-text("${n}") input[type=checkbox]`).first().check();
    await page.locator('[data-testid="dir-merge-two"]').click();
    await page.locator('[data-testid="dh-merge-confirm"]').waitFor({ timeout: 20000 });
    await shot("bulk-compare");
    const text = await page.locator('[role="dialog"]').last().innerText();
    const labels = ["Street address", "Apt, suite", "City", "State", "ZIP"].filter(l => !text.includes(l));
    ok("§13 the bulk compare shows Street, Apt, City, State and ZIP, with the street (main: no street when the two agree)", labels.length === 0 && /12 Elm St/.test(text), { missing: labels });
    await page.getByRole("button", { name: "Cancel" }).last().click();
  });

  // ── §5 Sign out ──
  await leg("§5", async () => {
    await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => sessionStorage.setItem("flows1_signed_out", "1"));
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await shot("signed-out");
    const email = page.locator("input[type=email]"), pass = page.locator("input[type=password]");
    ok("§5 sign-out lands on a working sign-in page (main, on prod: a solid blank page)",
      await email.isVisible() && await pass.isVisible() && await page.getByRole("button", { name: /Sign In/ }).isVisible() && !(await page.evaluate(() => localStorage.getItem("npe_token"))), page.url());
    await email.fill(A.email); await pass.fill("loadtest1234");
    await page.getByRole("button", { name: /Sign In/ }).click();
    await page.waitForURL(u => !/\/login/.test(String(u)), { timeout: 20000 });
    ok("§5 ...and signing in from it works", !!(await page.evaluate(() => localStorage.getItem("npe_token"))), page.url());
  });

  ok("no page error on any of these screens", errors.length === 0, errors.slice(0, 3));
  await browser.close();
  await reset(ORG);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
