// tests/flows17.test.js · FLOWS-17 (Justin's Place, a paying customer). The build's one new suite:
// it guards donor data (a second thank-you task for one gift) and a task a person ticks.
//
// §1 One gift makes exactly one thank-you task, whichever paths are on. The org is made the way a
//    customer's is (register-org, so "Gift received → notify the team" is on), a gift is entered
//    by hand the way she does, and the open thank-you tasks for the person are counted:
//      a. no journey, receipts off; b. a second gift while the first's thank-you is open;
//      c. the "New donor, first year" journey running and receipts on.
//    The source half: every writer of a gift's thank-you task comes through thankYouOnce.js.
//    The repair half: server/tasks/dupThanks.js finds the old pair and voids the extra only.
// §2 A task's box ticks it, wherever it is shown, through the one complete call, with Undo:
//    the profile's Activity (timeline and Coming up), its Tasks tab, Home and the Tasks page; and
//    the change is on the other surfaces with no reload.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · the workflow's notify_gift writing its own task again (helpers-6.js, the INSERT FLOWS-17
//     replaced) → §1a/§1c count 2, and §1 "every writer" names helpers-6.js.
//   · TaskTick's click not calling the complete call (an empty handler) → §2 Activity and the
//     Tasks tab stay open; a "Mark done" back on PUT /tasks/:id → §2 "one complete call" fails.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip, civilToday, waitFor, drainQueue } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const PASSWORD = "loadtest1234";
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

(async () => {
  console.log("flows17 (FLOWS-17)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const EMAIL = `owner-${run}@flows17.local`;
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Flows Seventeen Kestrel House ${run}`, userName: "Odile Prentiss", email: EMAIL, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const wf = await q(`SELECT recipe_key FROM workflows WHERE org_id=$1 AND enabled`, [ORG]);
  ok("a new org has \"Gift received → notify the team\" on, as Justin's Place does", wf.some(w => w.recipe_key === "instant_gift_thanks"), wf);

  const person = async (name) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@flows17.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status}`);
    return r.body.id;
  };
  // A gift by hand, then everything that follows it: the queue and the workflow (which runs beside the request).
  const giveByHand = async (id, amount) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { amount, date: today, type: "cash", paymentMethod: "Check" });
    const gid = g.body && (g.body.gift ? g.body.gift.id : g.body.id);
    await drainQueue(q, { orgId: ORG });
    await waitFor(async () => (await q(`SELECT 1 FROM workflow_runs WHERE org_id=$1 AND dedup_key=$2 AND actions_taken::text <> '[]'`, [ORG, `gift:${gid}`])).length > 0, { timeout: 15000 });
    await drainQueue(q, { orgId: ORG });
    return gid;
  };
  const openThanks = async id => q(
    `SELECT t.id, t.title, t.thread_id FROM tasks t WHERE t.org_id=$1 AND t.donor_id=$2 AND t.voided_at IS NULL AND COALESCE(t.done,0)=0
        AND (t.title ~* 'thank' OR t.thanks_gift_id IS NOT NULL)`, [ORG, id]);

  // ── §1 one gift, one thank-you ───────────────────────────────────────────
  await q(`UPDATE orgs SET receipts_enabled=false WHERE id=$1`, [ORG]);
  const ada = await person("Adaeze Winterbourne");
  const g1 = await giveByHand(ada, 100);
  const a1 = await openThanks(ada);
  ok("§1a a gift entered by hand makes ONE thank-you task (no journey, receipts off; main: \"Send thank-you note\" and \"Thank … just came in\")",
    a1.length === 1, a1.map(t => t.title));
  const w1 = await q(`SELECT voided_reason, thanks_gift_id, source_gift_id FROM tasks WHERE org_id=$1 AND created_by='system:workflow:instant_gift_thanks' AND source_gift_id=$2`, [ORG, g1]);
  ok("§1a the workflow's task, if one was written before the step opened, is voided (never deleted) and stamped with its gift",
    w1.every(r => r.voided_reason === "one_thank_you" && r.thanks_gift_id === g1 && r.source_gift_id === g1), w1);
  await giveByHand(ada, 40);
  const a2 = await openThanks(ada);
  ok("§1b a second gift while the first's thank-you is still open adds no second thank-you task", a2.length === 1, a2.map(t => t.title));

  await q(`UPDATE orgs SET receipts_enabled=true WHERE id=$1`, [ORG]);
  const jr = await api("POST", "/journeys", tok, { presetKey: "new_donor_first_year", enabled: true });
  ok("§1c the \"New donor, first year\" journey is running", jr.status < 300 && jr.body && jr.body.enabled === true, { status: jr.status });
  const bex = await person("Bexley Marchetti");
  await giveByHand(bex, 250);
  const b1 = await openThanks(bex);
  ok("§1c with the journey running and receipts on, the gift still makes ONE thank-you task (the journey's step)",
    b1.length === 1 && b1[0].thread_id, b1.map(t => t.title));

  // Every writer of a gift's thank-you task goes through the one function.
  const files = [];
  const walk = d => { for (const f of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|client|tests|scripts|\.generated/.test(f.name)) walk(p); }
    else if (p.endsWith(".js")) files.push(p);
  } };
  walk("server"); walk("routes"); files.push("server.js");
  // A gift's thank-you task is an insert that stamps a gift (source_gift_id / thanks_gift_id) with
  // thank-you words beside it. Kept, read: the Thread's own task (the trigger: the step IS the
  // thank-you) and the one writer itself.
  const KEPT = [/steward_thread_task_sync|NEW\.opening_gift_id/];
  const writers = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/INSERT INTO tasks\b/g)) {
      const cols = src.slice(m.index, m.index + 260), win = src.slice(Math.max(0, m.index - 400), m.index + 600);
      if (/(source|thanks)_gift_id/.test(cols) && /[Tt]hank/.test(win) && !/shared[/\\]thankYouOnce\.js$/.test(f) && !KEPT.some(a => a.test(win)))
        writers.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  ok("§1 every writer of a gift's thank-you task goes through thankYouOnce.js (no INSERT of its own)", writers.length === 0, writers);
  ok("§1 the gift workflow's \"just came in\" task is written by thankYouTaskOnce",
    /case "notify_gift"[\s\S]{0,3500}thankYouTaskOnce\(/.test(read("server/boot/helpers-6.js")));

  // The repair: the old pair (written the old way, straight into tasks) is found, and only the extra goes.
  const cal = await person("Calloway Nkemelu");
  await giveByHand(cal, 75);
  const [step] = await openThanks(cal);
  const gCal = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, cal]))[0].id;
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,updated_at,created_by,created_by_name,source_gift_id)
           VALUES ($1,$2,'Thank Calloway Nkemelu · $75 just came in',$3,'high','donor',0,$4,NOW(),'system:workflow:instant_gift_thanks','Steward (workflow)',$5)`,
    [`t_f17old_${run}`, ORG, today, cal, gCal]);
  const DT = require(path.join(ROOT, "server/tasks/dupThanks.js"));
  const found = await q(DT.DUP_THANKS_SQL, [DT.THANK_TYPES, ORG, ["org_creo", "org_b72demo"]]);
  ok("§1 repair: the dry run lists the old second task, and keeps the person's Thread step",
    found.length === 1 && found[0].id === `t_f17old_${run}` && found[0].why === "step" && found[0].kept_id === (step && step.id), found);
  await q(DT.VOID_SQL, [ORG, found.map(r => r.id)]);
  const left = await openThanks(cal);
  ok("§1 repair: after the apply's void, one thank-you is open, and it is the step", left.length === 1 && left[0].id === (step && step.id), left);

  // ── §2 a task's box ticks it, everywhere ─────────────────────────────────
  const src = read("client/src/lib/completeTask.js");
  ok("§2 one complete call: lib/completeTask.js posts /tasks/:id/complete, and the Tasks page and the profile use it",
    /\/tasks\/\$\{encodeURIComponent\(id\)\}\/complete/.test(src) && /completeTask/.test(read("client/src/components/Tasks.jsx"))
      && /completeTask\(t\)/.test(read("client/src/components/profile/profileShared.jsx")) && /TaskTick/.test(read("client/src/components/MeetingPanels.jsx"))
      && !/method:"PUT"[^\n]*done:/.test(read("client/src/components/Donors.jsx")));

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
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const calls = [];
    page.on("request", r => { if (/\/tasks\//.test(r.url()) && r.method() !== "GET") calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    const step2 = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };
    const doneOf = async id => Number(((await q(`SELECT done FROM tasks WHERE id=$1`, [id]))[0] || {}).done);
    const until = (fn, timeout = 8000) => waitFor(fn, { timeout, interval: 150 });
    const dee = await person("Delphine Okonkwo-Hart");
    const task = async title => (await api("POST", "/tasks", tok, { title, due: today, donorId: dee })).body.id;
    const profile = async () => { await page.goto(`${APP}/donors/${dee}`, { waitUntil: "networkidle", timeout: 60000 }); };

    await step2("§2 Activity", async () => {
      const t1 = await task("Send calendar and ask for a visit");
      await profile();
      const box = page.locator(`[data-task-tick="${t1}"]`).first();
      await box.waitFor({ timeout: 20000 });
      calls.length = 0;
      await box.click();
      ok("§2 Activity: one click on the task's box marks it done (main: the square was a picture; the click opened the card)",
        await until(async () => (await doneOf(t1)) === 1), { done: await doneOf(t1) });
      ok("§2 ...through the one complete call", calls.includes(`POST /tasks/${t1}/complete`), calls);
      ok("§2 ...and Coming up drops it with no reload", await until(async () => (await page.locator('[data-testid="dp-coming-task"]', { hasText: "Send calendar and ask for a visit" }).count()) === 0), null);
      const undo = page.getByRole("button", { name: /^Undo$/ }).first();
      await undo.click({ timeout: 5000 });
      ok("§2 Undo puts it back open", await until(async () => (await doneOf(t1)) === 0), { done: await doneOf(t1) });
      ok("§2 ...and the box reads open again", await until(async () => (await box.getAttribute("aria-checked")) === "false"), null);
    });

    await step2("§2 Coming up", async () => {
      const t2 = await task("Drop off the spring calendar");
      await profile();
      const btn = page.locator('[data-testid="dp-coming-task"]', { hasText: "Drop off the spring calendar" }).locator('[data-testid="dp-task-done"]');
      await btn.waitFor({ timeout: 20000 });
      calls.length = 0;
      await btn.click();
      ok("§2 Coming up's Mark done marks it done through the one complete call (main: PUT /tasks/:id, no Undo)",
        await until(async () => (await doneOf(t2)) === 1) && calls.includes(`POST /tasks/${t2}/complete`) && !calls.some(c => c.startsWith("PUT")), calls);
      ok("§2 ...with Undo offered", await page.getByRole("button", { name: /^Undo$/ }).count() > 0);
      ok("§2 ...and the timeline's box beside it reads done, no reload",
        await until(async () => (await page.locator(`[data-task-tick="${t2}"]`).first().getAttribute("aria-checked")) === "true"), null);
    });

    await step2("§2 Tasks tab", async () => {
      const t3 = await task("Mail the year-end card");
      await profile();
      await page.locator('[role="tab"][data-tab="tasks"]').click();
      const box = page.locator(`[data-task-tick="${t3}"]`).first();
      await box.waitFor({ timeout: 20000 });
      await box.click();
      ok("§2 the profile's Tasks tab: one click on the box marks it done (main: nothing happened)", await until(async () => (await doneOf(t3)) === 1), { done: await doneOf(t3) });
    });

    await step2("§2 Home", async () => {
      // Its own person: Home shows one open task per person as "Next", so Delphine's others would hide it.
      const ezra = await person("Ezra Lindgren-Oduya");
      const t4 = (await api("POST", "/tasks", tok, { title: "Drop the open house flyers off", due: today, donorId: ezra })).body.id;
      await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
      const row = page.locator("li", { hasText: "Ezra Lindgren-Oduya" }).filter({ hasText: /open house flyers/i }).first();
      await row.waitFor({ timeout: 20000 });
      await row.getByRole("button", { name: /^(Mark done|Done)$/ }).click();
      ok("§2 Home: Mark done marks the task done in one click", await until(async () => (await doneOf(t4)) === 1), { done: await doneOf(t4) });
      ok("§2 ...with Undo offered", await page.getByRole("button", { name: /^Undo$/ }).count() > 0);
    });

    await step2("§2 Tasks page", async () => {
      const t5 = await task("Send the thank-you photos");
      await page.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
      const row = page.locator("div", { has: page.getByRole("button", { name: "Send the thank-you photos" }) }).filter({ has: page.locator('[data-testid="task-tick"]') }).last();
      await row.waitFor({ timeout: 20000 });
      calls.length = 0;
      await row.locator('[data-testid="task-tick"]').first().click();
      ok("§2 the Tasks page: the tick marks it done through the same call", await until(async () => (await doneOf(t5)) === 1) && calls.includes(`POST /tasks/${t5}/complete`), calls);
      await profile();
      ok("§2 ...and the profile shows it done (the box is checked)",
        await until(async () => (await page.locator(`[data-task-tick="${t5}"]`).first().getAttribute("aria-checked")) === "true"), null);
    });
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
