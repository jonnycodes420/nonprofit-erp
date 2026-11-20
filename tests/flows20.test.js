// tests/flows20.test.js · FLOWS-20. The build's one new suite: it guards donor data (a task finished
// and a next step kept, a bulk touch that can be taken back, one person's giving read in the right
// org) and the numbers a journey shows.
//
// §1 W-1120-Donors-T11 · a call task ticked on a profile opens the Tasks page's own finish dialog
//    (FinishSheet), and saving it completes THAT task, closes no other step, makes no Follow up.
// §2 W-1120-Donors-T20 · a bulk touch is one line in Recent changes, whose Undo is the toast's.
// §3 W-1120-Fundraising-32 · the Journeys list header and How it is going read one count
//    (shared/numbers/journeyCounts.js), checked by assertSurfacesAgree (tests/lib/flows20Checks.js).
// §4 W-1120-Fundraising-13 · a lapsed donor with only old gifts: By year and the fund breakdown load
//    with no error text; a tab still painted for one org never reads another's "Donor not found".
// §5 W-1120-Donors-16 · a saved view picked again after its filter changed applies again.
// §6 W-1119-Donors-T8 · an empty "Touch titled" says what to type and offers the recent titles.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back; the PR says so):
//   · DonorProfile's onTaskOutcome back on setConvoOpen (Log a touch) → §1 "finish dialog" red.
//   · routes/removal.js without the batch rows → §2 "one line in Recent changes" red.
//   · the list header back on every run (no person filter) → §3 header vs panel red.
//   · ByYear erroring on a lapsed donor (the by-year route answering 404 with no gift this year)
//     → §4 "By year loads" red.
//   · ViewsMenu ignoring `edited` → §5 "picked again, it applies again" red.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip, civilToday, civilPlusDays, waitFor } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const PASSWORD = "loadtest1234";

(async () => {
  console.log("flows20 (FLOWS-20)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const reg = async (name, email) => {
    const r = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: `${name} ${run}`, userName: "Philippa Marchbanks", email, password: PASSWORD, provisioned: true, demoData: false }) });
    const b = await r.json();
    if (r.status !== 201 || !b.token) throw new Error(`register-org: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
    await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [b.org.id]);
    await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [b.org.id]);
    return b;
  };
  const EMAIL = `owner-${run}@flows20.local`;
  const A = await reg("Flows Twenty Larkspur Trust", EMAIL);
  const B = await reg("Flows Twenty Other House", `other-${run}@flows20.local`);
  const tok = A.token, ORG = A.org.id, today = civilToday();
  const person = async (name, t = tok) => {
    const r = await api("POST", "/donors", t, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@flows20.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status}`);
    return r.body.id;
  };
  const openSteps = async id => q(`SELECT id, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, id]);
  const openTasks = async id => q(`SELECT id, title FROM tasks WHERE org_id=$1 AND donor_id=$2 AND COALESCE(done,0)=0 AND voided_at IS NULL`, [ORG, id]);

  // ── fixtures shared by the API and browser halves ───────────────────────
  // §1: a person with a next step already open, and a quick-added "Call …" task (no kind of its own).
  const quen = await person("Quentin Harrowgate");
  const stepLog = await api("POST", `/donors/${quen}/conversations`, tok, { touch: "email", line: "Sent the spring program.",
    nextStep: { type: "follow_up", label: "Send the spring photos", due: civilPlusDays(10) } });
  ok("§1 fixture: Quentin has one open next step", stepLog.status === 201 && (await openSteps(quen)).length === 1, stepLog.status);
  const callTask = (await api("POST", "/tasks", tok, { title: "Call about the spring visit", due: today, donorId: quen })).body.id;
  const plain = await api("POST", `/tasks/${callTask}/complete`, tok, { done: true });
  ok("§1 a plain tick on a call task asks how it went first (422 needs_outcome), as the Tasks page does",
    plain.status === 422 && plain.body.error === "needs_outcome", [plain.status, plain.body]);

  // §2: three people and one bulk touch.
  const trio = [await person("Ottilie Brackenbury"), await person("Lysander Quayle"), await person("Marisol Penhaligon")];
  const batch = await api("POST", "/touch-batches", tok, { ids: trio, touchKind: "event_invite", title: "Test invite", date: today });
  ok("§2 fixture: the batch logs to 3 people", batch.status === 200 && batch.body.people === 3, [batch.status, batch.body]);
  const rc = await api("GET", "/recent-changes", tok);
  const line = (rc.body.rows || []).find(r => r.sentence === 'Logged "Test invite" to 3 people.');
  ok("§2 a bulk touch is ONE line in Recent changes: Logged \"Test invite\" to 3 people. (main: not listed at all)", !!line,
    (rc.body.rows || []).map(r => r.sentence));
  ok("§2 ...and its Undo is the toast's own call", !!line && line.undo && line.undo.path === batch.body.undo && line.undo.method === "POST", line && line.undo);
  if (line) {
    const u = await api("POST", line.undo.path, tok, line.undo.body || {});
    const left = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND touch_batch_id=$2`, [ORG, batch.body.batchId]);
    ok("§2 Undo from Recent changes, later, takes all three touches back", u.status === 200 && u.body.undone === 3 && left[0].n === 0, [u.status, u.body, left]);
    const rc2 = await api("GET", "/recent-changes", tok);
    ok("§2 ...and the line leaves Recent changes", !(rc2.body.rows || []).some(r => r.id === line.id), null);
    const again = await api("POST", batch.body.undo, tok, {});
    ok("§2 the toast's Undo pressed after that says it was already undone", again.status === 409 && again.body.error === "already_undone", [again.status, again.body]);
  }
  const keep = await api("POST", "/touch-batches", tok, { ids: trio.slice(0, 2), touchKind: "event_invite", title: "Spring awareness night", date: today });
  const other = await api("POST", "/touch-batches", B.token, { ids: [await person("Bartholomew Vane", B.token)], touchKind: "event_invite", title: "Other house gala", date: today });
  const titles = await api("GET", "/touch-batches/titles", tok);
  ok("§6 the org's recent touch titles are offered, newest first, and never another org's",
    keep.status === 200 && other.status === 200 && titles.status === 200 && titles.body.titles[0] === "Spring awareness night"
      && !titles.body.titles.includes("Other house gala"), titles.body);

  // §3: a journey with an entry of each kind, a person who went in twice, and a person since deleted.
  const tpl = `ct_f20_${run}`;
  await q(`INSERT INTO cultivation_templates (id, org_id, name, steps, created_by, created_by_name) VALUES ($1,$2,'Spring welcome',
    '[{"label":"Call to say welcome","days":3,"type":"call"}]'::jsonb, 'system:test', 'flows20')`, [tpl, ORG]);
  const jp = [await person("Ignatius Fairweather"), await person("Rosalind Ashcombe"), await person("Theodora Pengelly"), await person("Cuthbert Moorcroft")];
  const plan = (i, donor, status) => q(`INSERT INTO cultivation_plans (id, org_id, donor_id, template_id, template_name, applied_on, status, created_by, created_by_name, closed_at)
    VALUES ($1,$2,$3,$4,'Spring welcome',$5,$6,'system:test','flows20',CASE WHEN $6 = 'active' THEN NULL ELSE NOW() END)`, [`cp_f20_${run}_${i}`, ORG, donor, tpl, civilPlusDays(-20 + i), status]);
  await plan(1, jp[0], "active"); await plan(2, jp[1], "abandoned"); await plan(3, jp[2], "done");
  await plan(4, jp[1], "active");   // Rosalind went in again
  await plan(5, jp[3], "active");
  const del = await api("DELETE", `/donors/${jp[3]}`, tok);
  ok("§3 fixture: Cuthbert is in the trash", del.status === 200, del.status);
  const list = (await api("GET", "/journeys", tok)).body;
  const head = (list.journeys || []).find(j => j.id === tpl) || {};
  const stats = (await api("GET", `/journeys/${tpl}/stats`, tok)).body;
  const fig = k => Number((stats.figures.find(f => f.key === k) || {}).value);
  ok("§3 the list header and How it is going give one answer (main: header 5 entered · 3 in it, panel 4 · 2)",
    ["entered", "inIt", "exited", "completed"].every(k => Number(head[k]) === fig(k)),
    { header: [head.entered, head.inIt, head.exited, head.completed], panel: ["entered", "inIt", "exited", "completed"].map(fig) });
  ok("§3 ...entries of people on file: 4 entered · 2 in it · 1 exited · 1 completed",
    head.entered === 4 && head.inIt === 2 && head.exited === 1 && head.completed === 1, [head.entered, head.inIt, head.exited, head.completed]);
  ok("§3 ...with one definition, said on both", !!list.countsDefinition && list.countsDefinition === stats.countsDefinition, [list.countsDefinition, stats.countsDefinition]);
  const again = (await api("GET", `/journeys/${tpl}/stats`, tok)).body;
  ok("§3 the panel reads the same on a second read with nothing happening", JSON.stringify(again.figures) === JSON.stringify(stats.figures), null);
  const truth = await assertSurfacesAgree(ORG, { token: tok, only: ["journeyCounts"], soft: true, label: "§3" });
  ok("§3 assertSurfacesAgree: the header, the panel and the rows each figure opens agree with the key", truth.ok, truth.diffs);

  // §4: a lapsed donor whose only gifts are years old.
  const ver = await person("Verena Underwood");
  for (const [amount, date] of [[25000, "2020-04-18"], [25000, "2022-04-18"], [25000, "2024-04-18"]]) {
    const g = await api("POST", `/donors/${ver}/gifts`, tok, { amount, date, type: "cash", paymentMethod: "Check" });
    if (g.status >= 300) throw new Error(`gift fixture: ${g.status} ${JSON.stringify(g.body).slice(0, 160)}`);
  }
  const by = await api("GET", `/donors/${ver}/by-year`, tok);
  const fa = await api("GET", `/donors/${ver}/fund-affinity`, tok);
  ok("§4 By year loads for a lapsed donor with only old gifts", by.status === 200 && Array.isArray(by.body.years) && by.body.years.some(y => y.total > 0), [by.status, by.body && by.body.error]);
  ok("§4 ...and the fund breakdown loads, footing to Lifetime", fa.status === 200 && fa.body.totalGiving === 75000, [fa.status, fa.body && (fa.body.error || fa.body.totalGiving)]);
  const stale = await fetch(`${BASE}/donors/${ver}/by-year`, { headers: { Authorization: "Bearer " + B.token, "X-Steward-Org": ORG } });
  const sb = await stale.json();
  ok("§4 a tab still painted for one org, reading with another org's session, is told the org changed (409), never \"Donor not found\"",
    stale.status === 409 && sb.code === "org_changed" && !/not found/i.test(sb.message || ""), [stale.status, sb]);
  const me = await fetch(`${BASE}/me`, { headers: { Authorization: "Bearer " + B.token, "X-Steward-Org": ORG } });
  ok("§4 ...while /me, how a tab learns where it is, still answers", me.status === 200, me.status);

  // §5: a saved view.
  const view = await api("POST", "/donors/list-views", tok, { name: "Harrowgate only", filters: { join: "and", conditions: [{ field: "name", op: "contains", value: "Harrowgate" }] }, chips: {} });
  ok("§5 fixture: the view is saved", view.status === 200 || view.status === 201, [view.status, view.body]);

  // ── the browser half ─────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(([tk, u, o]) => { if (!sessionStorage.getItem("f20_seeded")) { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); sessionStorage.setItem("f20_seeded", "1"); } },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };
    const until = (fn, timeout = 8000) => waitFor(fn, { timeout, interval: 150 });
    const doneOf = async id => Number(((await q(`SELECT done FROM tasks WHERE id=$1`, [id]))[0] || {}).done);
    const profile = async id => { await page.goto(`${APP}/donors/${id}`, { waitUntil: "networkidle", timeout: 60000 }); };

    await step("§1 profile tick", async () => {
      await profile(quen);
      const box = page.locator(`[data-task-tick="${callTask}"]`).first();
      await box.waitFor({ timeout: 20000 });
      await box.click();
      const finish = page.locator('[data-testid="finish-save"]');
      ok("§1 ticking a call task on the profile opens the finish dialog the Tasks page uses (main: the generic Log a touch)",
        await until(async () => (await finish.count()) > 0), null);
      ok("§1 ...which says the person's next step stays, with No next step ticked",
        await until(async () => /Their next step stays: Send the spring photos/.test(await page.locator('[data-testid="finish-other-step"]').innerText().catch(() => "")))
          && await page.locator('[data-testid="finish-none"]').isChecked(), null);
      await page.locator('[data-testid="finish-line"]').fill("She will come on the 14th with her daughter.");
      await finish.click();
      ok("§1 saving it completes THAT task", await until(async () => (await doneOf(callTask)) === 1), { done: await doneOf(callTask) });
      const steps = await openSteps(quen);
      ok("§1 ...closes no other step: \"Send the spring photos\" is still open", steps.length === 1 && steps[0].next_step_label === "Send the spring photos", steps);
      const tasks = await openTasks(quen);
      ok("§1 ...and makes no extra Follow up task", !tasks.some(t => /^follow up/i.test(t.title)), tasks);
      ok("§1 ...and Coming up drops it with no reload",
        await until(async () => (await page.locator('[data-testid="dp-coming-task"]', { hasText: "Call about the spring visit" }).count()) === 0), null);
      const p = await api("GET", "/tasks?view=done", tok);
      ok("§1 ...and the Tasks page lists it done", ((p.body.tasks || p.body.rows || p.body) || []).some(t => t.id === callTask), null);
    });

    await step("§1 sheet Mark done", async () => {
      const t2 = (await api("POST", "/tasks", tok, { title: "Call to thank for the gala table", due: today, donorId: quen })).body.id;
      await profile(quen);
      const open = page.locator(`[data-task-open="${t2}"]`).first();
      await open.waitFor({ timeout: 20000 });
      await open.click();
      await page.locator('[data-testid="sheet-done"]').click({ timeout: 10000 });
      ok("§1 the task sheet's Mark done opens the same finish dialog", await until(async () => (await page.locator('[data-testid="finish-save"]').count()) > 0), null);
      await page.keyboard.press("Escape");
    });

    await step("§4 Giving tab", async () => {
      await profile(ver);
      await page.locator('[role="tab"][data-tab="giving"]').click();
      await until(async () => (await page.locator('text=Unrestricted').count()) > 0 || (await page.locator('[data-testid="dp-by-year-error"]').count()) > 0, 15000);
      const body = await page.innerText("body");
      ok("§4 a lapsed donor's Giving tab shows By year and the funds with no error text",
        !/could not be read|Could not load fund data|Donor not found/.test(body) && (await page.locator('[data-testid="dp-by-year-error"]').count()) === 0,
        (body.match(/By year could not be read[^\n]*|Could not load fund data/g) || []));
      // Another tab of this browser signs in to the other org: the token under this page changes.
      const lb = await api("POST", "/auth/login", null, { email: `other-${run}@flows20.local`, password: PASSWORD });
      await page.evaluate(t => localStorage.setItem("npe_token", t), lb.body.token);
      await page.locator('[role="tab"][data-tab="activity"]').click();
      await page.locator('[role="tab"][data-tab="giving"]').click();
      await page.waitForTimeout(2500);
      const after = await page.innerText("body");
      ok("§4 that tab never shows another org's \"Donor not found\" (main: By year could not be read: Donor not found)",
        !/Donor not found|Could not load fund data/.test(after), (after.match(/[^\n]*(Donor not found|Could not load fund data)[^\n]*/g) || []));
      await page.evaluate(t => localStorage.setItem("npe_token", t), lg.body.token);
    });

    await step("§5 saved view", async () => {
      await page.goto(`${APP}/app/donors`, { waitUntil: "networkidle", timeout: 60000 });
      const menu = page.locator('[data-testid="dir-views"]');
      await menu.waitFor({ timeout: 20000 });
      await menu.selectOption(view.body.view.id);
      const chips = page.locator('[data-testid="filter-chip"]');
      ok("§5 fixture: picking the view applies its filter", await until(async () => (await chips.count()) === 1), null);
      await page.locator('[data-testid="filter-chip-remove"]').first().click();
      ok("§5 changing a filter marks the view edited", await until(async () => (await menu.inputValue()) === "__edited"), await menu.inputValue());
      await menu.selectOption(view.body.view.id);
      ok("§5 picked again, it applies again (main: \"it already had that value\", nothing happened)",
        await until(async () => (await chips.count()) === 1 && /Harrowgate/.test(await chips.first().innerText())), null);
    });

    await step("§6 touch titled", async () => {
      await page.locator('[data-testid="filter-chip-remove"]').first().click().catch(() => {});
      await page.locator('[data-testid="dir-add-filter"]').click();
      await page.locator('[data-testid="filter-field-touch_titled"]').click();
      ok("§6 an empty title says \"Type the touch's title.\" under it (main: a disabled button and nothing said)",
        await until(async () => /Type the touch's title\./.test(await page.locator('[data-testid="filter-empty-hint"]').innerText().catch(() => ""))), null);
      const sug = page.locator('[data-testid="filter-suggest"]', { hasText: "Spring awareness night" });
      ok("§6 ...and the org's recent titles are offered", await until(async () => (await sug.count()) > 0), null);
      await sug.first().click();
      await page.locator('[data-testid="filter-apply"]').click();
      ok("§6 a suggestion picked is a filter", await until(async () => /Spring awareness night/.test(await page.locator('[data-testid="filter-chip"]').first().innerText().catch(() => ""))), null);
    });
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
