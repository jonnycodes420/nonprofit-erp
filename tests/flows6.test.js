// tests/flows6.test.js — FLOWS-6. LOGGING, TASKS AND THE DONORS LIST SAY ONE THING AT A TIME.
//
// One org shaped like the fleet's findings (tests/lib/flows6Fixture.js), and
// one check per item, on the built client with real clicks:
//   §1 one log, one follow-up: logging a call that keeps the proposed "Follow
//      up" leaves exactly one open Follow up and no Done twin; the rail's Mark
//      done finishes the step in one click (W-1110-Donors-35X)
//   §2 an empty Next step writes nothing and leaves no "From your note" card (W-1110-Donors-36X)
//   §3 Tasks tab: open rows an empty box, done rows a check and the day done (W-1110-Donors-23X)
//   §4 Re-engage's count follows the list's filters: "0 of 3" (W-1109-Donors-18X)
//   §5 Giving rhythm reads the giving unit: Current through Harborview Fund (W-1110-Donors-33X)
//   §6 the merge compare names teammates, never ids (W-1110-Donors-44X)
//   §7 each Home move's button says why that action (W-1110-Donors-03X)
//   §8 re-check: Home's snooze form never shows on the next card (W-1109-Donors-05)
//   §9 Plan a follow-up on the rail while a step is open: replace it or add another (W-1109-Donors-41)
//
// HOW IT GOES RED (planted, see the PR): writing the follow-up twice (closing
// the open Follow up and opening a new one) turns §1 red.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip, civilPlusDays } = require("./helpers");
const { buildFlows6Org } = require("./lib/flows6Fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = iso => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

(async () => {
  console.log("flows6 (FLOWS-6)");
  const f = await buildFlows6Org();
  const tok = f.token, ids = f.ids;
  const tasksOf = async id => ((await api("GET", `/donors/${id}/tasks`, tok)).body || []);

  // ── §5 the rail's rhythm, from the API ───────────────────────────────────
  const railT = (await api("GET", `/donors/${ids.tobin}/rail`, tok)).body || {};
  const rh = railT.rhythm || {};
  ok("§5 Tobin's Giving rhythm names the unit: his own giving due now, Current through Harborview Fund",
    /Their own giving: (due now|late)/i.test(rh.sentence || "") && /Current through Harborview Fund/.test(rh.sentence || ""), rh);

  // ── §6 the merge compare, from the API ───────────────────────────────────
  const pair = (await api("GET", `/data-health/pair?a=${ids.corinA}&b=${ids.corinB}`, tok)).body || {};
  ok("§6 the compare carries each owner's name", pair.users && pair.users[f.users.bram] === "Bram Ortolan" && pair.users[f.users.me] === "Ines Varro", pair.users);

  // ── §7 each move says why its action ─────────────────────────────────────
  const deck = ((await api("GET", "/insights?view=deck&moves=all", tok)).body || {}).deck || {};
  const moves = (deck.tabs || []).flatMap(t => t.moves || []);
  const nell = moves.find(m => m.lead === ids.nell), ozzie = moves.find(m => m.lead === ids.ozzie);
  ok("§7 a $100 first gift: Drafting a note because…; a $600 one: Adding them to your calls because…",
    !!nell && /^Drafting a note because/.test((nell.action || {}).why || "") && /\$100/.test(nell.action.why)
      && !!ozzie && /^Adding them to your calls because/.test((ozzie.action || {}).why || "") && /\$600/.test(ozzie.action.why),
    { nell: nell && nell.action, ozzie: ozzie && ozzie.action, n: moves.length });

  // ── the browser ──────────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: f.email, password: f.password });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools|Failed to fetch/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const shot = n => process.env.FLOWS6_SHOTS ? page.screenshot({ path: path.join(process.env.FLOWS6_SHOTS, n + ".png"), fullPage: true }) : null;
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n")[0]); } };
    const profile = async id => { await page.goto(`${APP}/donors/${id}`, { waitUntil: "networkidle", timeout: 60000 }); await page.locator('[data-testid="dp-primary"]').first().waitFor({ timeout: 20000 }); };
    const settle = () => page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const dlg = page.locator('[data-testid="log-touch"]');

    await step("§1", async () => {
      // Odile: Log a touch → Call, keeping the proposed "Follow up" while one is open.
      await profile(ids.odile);
      await page.locator('[data-testid="dp-primary"]').first().click();
      await dlg.waitFor({ timeout: 20000 });
      await dlg.locator('[data-testid="touch-kind-call"]').click();
      await dlg.locator('[data-testid="conv-line"]').fill("Talked about the spring tour.");
      const proposed = await dlg.locator('[data-testid="touch-next"]').inputValue();
      if (!proposed.trim()) await dlg.locator('[data-testid="touch-next"]').fill("Follow up");
      await dlg.locator('[data-testid="touch-save"]').click();
      await dlg.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      await settle();
      const ts = await tasksOf(ids.odile);
      const fu = ts.filter(t => /^Follow up/.test(t.title));
      const open = fu.filter(t => !Number(t.done)), done = fu.filter(t => Number(t.done));
      ok("§1 one log with a follow-up: exactly one open Follow up, and no Done Follow up beside it",
        open.length === 1 && done.length === 0, fu.map(t => [t.title, t.due, t.done]));
      const ints = await q(`SELECT type FROM interactions WHERE donor_id=$1 AND type='call'`, [ids.odile]);
      ok("§1 …and the call is on the timeline as a call", ints.length === 2, ints.length);
      await shot("s1-odile");

      // Sable: the rail's Mark done, one click.
      await profile(ids.sable);
      await page.locator('[data-testid="dp-mark-done"]').first().click({ timeout: 15000 });
      await page.waitForTimeout(1200);
      const dialogOpened = await dlg.count();
      await settle();
      const openSteps = await q(`SELECT 1 FROM threads WHERE donor_id=$1 AND closed_at IS NULL`, [ids.sable]);
      const sts = (await tasksOf(ids.sable)).filter(t => /^Follow up/.test(t.title));
      ok("§1 the rail's Mark done finishes the step in one click: no dialog, the step closed, nothing new opened",
        dialogOpened === 0 && openSteps.length === 0 && sts.filter(t => !Number(t.done)).length === 0, { dialogOpened, open: openSteps.length, tasks: sts.map(t => [t.title, t.done]) });
      await shot("s1-sable");
    });

    await step("§2", async () => {
      await profile(ids.pell);
      await page.locator('[data-testid="dp-primary"]').first().click();
      await dlg.waitFor({ timeout: 20000 });
      await dlg.locator('[data-testid="touch-kind-call"]').click();
      await dlg.locator('[data-testid="conv-line"]').fill("Called, chatted about the gala.");
      const nextBox = await dlg.locator('[data-testid="touch-next"]').inputValue();
      await dlg.locator('[data-testid="touch-save"]').click();
      await dlg.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      await settle(); await page.waitForTimeout(800);
      const heard = await page.locator('[data-testid="dp-heard"]').allInnerTexts();
      const stray = heard.filter(t => /From your note/.test(t) && !/Nothing changes until you say yes/.test(t));
      const openNow = await q(`SELECT 1 FROM threads WHERE donor_id=$1 AND closed_at IS NULL`, [ids.pell]);
      const openTasks = (await tasksOf(ids.pell)).filter(t => !Number(t.done));
      ok("§2 an empty Next step writes nothing: no step, no task, and no bare \"From your note\" card",
        nextBox === "" && openNow.length === 0 && openTasks.length === 0 && stray.length === 0, { nextBox, open: openNow.length, tasks: openTasks.map(t => t.title), heard });
      await shot("s2-pell");
    });

    await step("§3", async () => {
      await profile(ids.rhea);
      await page.locator('[data-tab="tasks"], button:has-text("Tasks")').filter({ hasText: /^Tasks/ }).first().click({ timeout: 15000 });
      await page.waitForTimeout(800);
      const rows = page.locator('[data-task-state]');
      await rows.first().waitFor({ timeout: 15000 });
      const read = async id => { const r = page.locator(`[data-task-id="${id}"]`).first(); return { state: await r.getAttribute("data-task-state").catch(() => null), text: (await r.innerText().catch(() => "")).replace(/\s+/g, " ") }; };
      const o = await read(ids.openTask), e = await read(ids.earlyTask);
      ok("§3 the open task is an empty box and says when it is due; the one done early is a check, done today, never \"Done\" on its due day",
        o.state === "open" && /Due /.test(o.text) && !/Done/.test(o.text)
          && e.state === "done" && new RegExp(`Done ${short(f.today)}`).test(e.text) && !e.text.includes(short(civilPlusDays(15))),
        { o, e });
      await shot("s3-tasks");
    });

    await step("§4", async () => {
      await page.goto(`${APP}/donors?view=reengage&owner=${f.users.bram}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(1500);
      const badge = ((await page.locator('[data-testid="reengage-count"]').first().innerText().catch(() => "")) || "").trim();
      const body = await page.locator("main").first().innerText().catch(() => "");
      ok("§4 Re-engage's count follows the list: \"0 of 3\" beside an empty filtered list", badge === "0 of 3", { badge, list: body.slice(0, 300) });
      await shot("s4-reengage");
    });

    await step("§5", async () => {
      await profile(ids.tobin);
      const r = (await page.locator('[data-testid="dp-rail-rhythm"]').first().innerText({ timeout: 15000 }).catch(() => "")).replace(/\s+/g, " ");
      ok("§5 the rail says one verdict: Current through Harborview Fund, never a bare \"Due now · Late\"",
        /Current through Harborview Fund/.test(r) && !/Next gift expected Due now · Late/.test(r), r);
      await shot("s5-tobin");
    });

    await step("§6", async () => {
      await profile(ids.corinA);
      await page.getByRole("button", { name: /^More/ }).first().click();
      await page.getByText("Merge with…", { exact: false }).first().click({ timeout: 10000 });
      await page.locator('[data-testid="mw-search"]').fill("Corin");
      await page.locator('[data-testid="mw-pick"]').first().click({ timeout: 15000 });
      await page.getByText("Assigned to", { exact: true }).first().waitFor({ timeout: 15000 });
      const t = await page.locator('[role="dialog"]').last().innerText();
      ok("§6 the compare shows Bram Ortolan and Ines Varro for Assigned to, and no raw user id", /Bram Ortolan/.test(t) && /Ines Varro/.test(t) && !/u_flows6/.test(t),
        (t.match(/Assigned to[^\n]*\n?[^\n]*\n?[^\n]*/) || [""])[0]);
      await shot("s6-merge");
      await page.keyboard.press("Escape").catch(() => {});
    });

    await step("§7 §8", async () => {
      await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
      const card = page.locator('[data-testid="move-card"]').first();
      await card.waitFor({ timeout: 20000 });
      const tips = [];
      for (let k = 0; k < 6; k++) {
        const b = page.locator('[data-testid="move-action"]').first();
        tips.push([(await b.innerText()).trim(), await b.getAttribute("title")]);
        await page.locator('[data-testid="move-next"]').first().click().catch(() => {});
        await page.waitForTimeout(250);
      }
      ok("§7 every move's button carries its one-line why on hover", tips.length > 0 && tips.every(([, t]) => /because/.test(t || "")), tips);
      // §8 · Not now opens the snooze form; snoozing moves on, and the next card has no form open.
      await page.locator('[data-testid="move-not-now"]').first().click();
      await page.locator("#move-until").waitFor({ timeout: 8000 });
      await page.locator('[data-testid="move-card"] button', { hasText: /^Snooze$/ }).first().click();
      await page.waitForTimeout(1200);
      ok("§8 after Snooze, the next card opens with no snooze form", await page.locator("#move-until").count() === 0);
      await shot("s7-home");
    });

    await step("§9", async () => {
      // Sable's step was finished in §1; give her a new one to have one open.
      const r = await api("POST", `/donors/${ids.sable}/threads`, tok, { label: "Send the tour photos", due: civilPlusDays(6) });
      await profile(ids.sable);
      const plan = page.locator('[data-testid="dp-next-plan"]');
      const shown = await plan.count();
      await plan.first().click({ timeout: 8000 });
      const modal = page.locator('[role="dialog"]').last();
      await modal.getByText("Add another", { exact: false }).first().click({ timeout: 8000 });
      await modal.locator('input[placeholder="Call about the spring appeal"]').fill("Invite to the spring tour");
      await modal.getByRole("button", { name: /^Plan it$/ }).click();
      await page.waitForTimeout(1200); await settle();
      const steps = await q(`SELECT next_step_label FROM threads WHERE donor_id=$1 AND closed_at IS NULL`, [ids.sable]);
      const ts = (await tasksOf(ids.sable)).filter(t => !Number(t.done)).map(t => t.title);
      ok("§9 with a step open, Plan a follow-up is on the rail, and Add another keeps the step and adds the task",
        r.status === 201 && shown === 1 && steps.length === 1 && steps[0].next_step_label === "Send the tour photos" && ts.includes("Invite to the spring tour"), { shown, steps, ts });
      await shot("s9-plan");
    });

    ok("no console errors or 5xx on the walk", errors.length === 0, errors.slice(0, 5));
    await browser.close();
  }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
