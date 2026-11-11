// tests/touch1-log-a-touch.test.js · TOUCH-1. LOG ANY TOUCH IN HER OWN WORDS,
// FINISH A TASK EARLY, EDIT THE ASK IN THE TOP 100.
//
// A beta director (10 Nov) logged a note she sent under "Log a call", could
// not mark a task done "because it was too far in advance", and could not edit
// the Ask column in her Top 100. This guards the donor record those three
// write: what is logged, what Last contact says, which task is done, and the
// ask on the plan.
//
//   §1  a Handwritten note in her words is a `letter` row, on the timeline in
//       her words, and Last contact is that note (log response and GET agree)
//   §2  a Gift sent dated last week keeps its day; Last contact stays the
//       newer note; a future touch, and Other with no words, are refused
//   §3  an org's own kind: added in Settings, logged, counts as Last contact,
//       archived without losing the touch
//   §4  ANY TASK CAN BE MARKED DONE ANY TIME: a task due next month (plain,
//       and a plan-of-care touch) marks done today with no error, keeps its
//       due day, and records today as the day it was done
//   §5  logging a planned touch's kind offers it and completes it, with one
//       timeline line (not two); a different kind is refused and logs nothing
//   §6  the Ask edits alone (PATCH): the Top 100 row and the plan of care say
//       the same, the goal and ask-by stay, the audit log has the change; a
//       planned touch's day moves; another org gets 404
//   §7  the browser, on the built client: Log a touch → Handwritten note;
//       click the Ask cell in the Top 100, type, Enter, reload; Tasks' tick on
//       a planned note a month out offers to log it, and logging completes it
//
// HOW IT GOES RED (planted, seen red before green, TOUCH-1 report):
//   * put back a "too far in advance" block in POST /tasks/:id/complete
//     (refuse when t.due > today): §4 fails, and §7's offer-and-complete.
//   * drop `OR ${TOUCH_LOGGED}` / the new types from meetings.js: §1 and §3 fail.
//
// Standard scratch stack (tests/README.md). Never sends anything.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb, api, browserLegOrSkip } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { DIST } = require("./lib/dist");

const ORG = "org_touch1";
const OTHER = "org_touch1x";
const PASSWORD = "loadtest1234";
const U = who => `u_${ORG}_${who}`;
const NELL = "d_touch1_nell", OSKAR = "d_touch1_oskar", PIA = "d_touch1_pia", WALK = "d_touch1_walk", FOREIGN = "d_touch1_foreign";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const rows = r => (r && r.rows) || r || [];

async function reset() {
  for (const org of [ORG, OTHER]) {
    for (const t of ["interactions", "tasks", "threads", "portfolio_members", "portfolio_lists", "care_plans", "care_templates", "org_touch_types", "gifts"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [org]);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York') ON CONFLICT (id) DO NOTHING`,
      [org, org === ORG ? "Touch One House" : "Touch One Other", org === ORG ? "touch-one-house" : "touch-one-other"]);
  }
  const hash = bcrypt.hashSync(PASSWORD, 4);
  for (const [id, name, org] of [["dir", "Della Ward", ORG], ["mgo", "Milo Grant", ORG], ["oth", "Olga Other", OTHER]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts) VALUES ($1,$2,$3,$4,$5,'admin',true)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id, deactivated_at=NULL`,
      [`u_${org}_${id}`, org, `${id}@${ORG}.test`, hash, name]);
  for (const [id, name] of [[NELL, "Nell Ashby"], [OSKAR, "Oskar Penrose"], [PIA, "Pia Lindqvist"], [WALK, "Walt Fairbrother"]])
    await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'individual','cultivate',20000,$5,'Della Ward',$5,'Della Ward')`, [id, ORG, name, `${id}@touch1.test`, U("dir")]);
  await q(`INSERT INTO donors (id,org_id,name,kind,created_by,created_by_name) VALUES ($1,$2,'Fenn Foreign','individual',$3,'Olga Other')`, [FOREIGN, OTHER, `u_${OTHER}_oth`]);
}
async function token(who) {
  const r = await api("POST", "/auth/login", null, { email: `${who}@${ORG}.test`, password: PASSWORD });
  return r.body && r.body.token;
}
const log = (tok, id, body) => api("POST", `/donors/${id}/conversations`, tok, { nextStep: { skipped: true }, ...body });

(async () => {
  console.log("TOUCH-1: log any touch in her own words, finish a task early, edit the Ask in the Top 100\n");
  await reset();
  const tok = await token("dir"), oth = await api("POST", "/auth/login", null, { email: `oth@${ORG}.test`, password: PASSWORD }).then(r => r.body && r.body.token);
  ok("both sign in", !!tok && !!oth);
  const today = civilDay(), lastWeek = dayOffset(-7), nextMonth = dayOffset(30);

  // ── §1 a handwritten note, in her words ─────────────────────────────────
  const words = "Sent a handwritten thank-you card with a photo of Rocket.";
  let r = await log(tok, NELL, { touchKind: "letter", line: words, date: today });
  const [n1] = rows(await q(`SELECT type, note, date, metadata FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'touch_kind'='letter'`, [ORG, NELL]));
  ok("§1 a Handwritten note saves as a letter, in her words, today", r.status === 201 && n1 && n1.type === "letter" && n1.note === words && n1.date === today
    && n1.metadata.touch_label === "Handwritten note", { status: r.status, body: r.body, n1 });
  ok("§1 the log's own Last contact is that note, today", r.body.lastContact && r.body.lastContact.date === today && r.body.lastContact.type === "letter", r.body.lastContact);
  const fig = await api("GET", `/figures/donor-contact-gap/rows?donor=${NELL}&today=${today}`, tok);
  const top1 = fig.body && fig.body.rows && fig.body.rows[0];
  ok("§1 the header's Last contact figure opens on that note, 0 days", fig.status === 200 && top1 && top1.name === words && top1.date === today && Number(top1.amount) === 0, top1);
  ok("§1 and its sentence names a handwritten note", /handwritten note/.test(String(fig.body.sentence || "")), fig.body.sentence);

  // ── §2 a gift sent last week; what is refused ───────────────────────────
  r = await log(tok, NELL, { touchKind: "gift_sent", line: "Mailed a Harbor mug and a note.", date: lastWeek });
  const [g1] = rows(await q(`SELECT type, date FROM interactions WHERE org_id=$1 AND donor_id=$2 AND type='gift_sent'`, [ORG, NELL]));
  ok("§2 a Gift sent dated last week keeps last week's day", r.status === 201 && g1 && g1.date === lastWeek, { status: r.status, g1 });
  ok("§2 and Last contact stays the newer note", r.body.lastContact && r.body.lastContact.date === today, r.body.lastContact);
  r = await log(tok, NELL, { touchKind: "text", line: "Texted", date: dayOffset(1) });
  ok("§2 a touch dated tomorrow is refused (a touch is something already done)", r.status === 400 && r.body.error === "future_touch", r.body);
  r = await log(tok, NELL, { touchKind: "other", line: "  " });
  ok("§2 Other with no words is refused", r.status === 400 && r.body.error === "words_required", r.body);
  r = await log(tok, NELL, { touchKind: "letter", line: "", date: lastWeek });
  ok("§2 a Handwritten note with no words is fine, saved as its kind", r.status === 201, r.body);
  const gifts = rows(await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  ok("§2 a Gift sent is not money: no gift row", gifts === 0, gifts);

  // ── §3 her org's own kind ───────────────────────────────────────────────
  r = await api("POST", "/touch-types", tok, { label: "Birthday card" });
  const custom = r.body;
  ok("§3 an admin adds Birthday card", r.status === 201 && /^custom:/.test(custom.key), r.body);
  ok("§3 a kind that is built in is refused", (await api("POST", "/touch-types", tok, { label: "handwritten note" })).status === 409);
  r = await log(tok, OSKAR, { touchKind: custom.key, line: "Signed by the whole team.", date: today });
  ok("§3 a Birthday card logs, and is Oskar's Last contact", r.status === 201 && r.body.lastContact && r.body.lastContact.date === today, r.body);
  r = await log(oth, OSKAR, { touchKind: custom.key, line: "x" });
  ok("§3 another org cannot log on Oskar (404)", r.status === 404, r.status);
  r = await api("DELETE", `/touch-types/${custom.id}`, tok);
  const kinds = (await api("GET", "/touch-types", tok)).body;
  const [kept] = rows(await q(`SELECT note, metadata->>'touch_label' AS label FROM interactions WHERE org_id=$1 AND donor_id=$2`, [ORG, OSKAR]));
  ok("§3 taking it off leaves the list and keeps the touch", r.status === 200 && !kinds.custom.some(c => c.id === custom.id) && kept && kept.label === "Birthday card", { kinds, kept });

  // ── §4 any task, any day ────────────────────────────────────────────────
  const plain = await api("POST", "/tasks", tok, { title: "Send Pia the impact report", due: nextMonth, donorId: PIA });
  r = await api("POST", `/tasks/${plain.body.id}/complete`, tok, { done: true });
  const [pt] = rows(await q(`SELECT done, due, completed_at FROM tasks WHERE id=$1`, [plain.body.id]));
  ok("§4 a task due next month marks done today, with no error", r.status === 200 && pt.done === 1, { status: r.status, body: r.body });
  const doneDay = rows(await q(`SELECT to_char((completed_at AT TIME ZONE 'America/New_York')::date,'YYYY-MM-DD') AS d FROM tasks WHERE id=$1`, [plain.body.id]))[0].d;
  ok("§4 it keeps its due day, and today is the day it was done", String(pt.due).slice(0, 10) === nextMonth && doneDay === civilDay(), { due: pt.due, doneDay });
  const viaPut = await api("POST", "/tasks", tok, { title: "Drop off the annual report", due: dayOffset(60), donorId: PIA });
  r = await api("PUT", `/tasks/${viaPut.body.id}`, tok, { title: "Drop off the annual report", due: dayOffset(60), done: true });
  ok("§4 the full edit's Done on a task two months out saves too", r.status === 200 && Number(r.body.done) === 1, r.body);
  await api("POST", "/top100/members", tok, { donorIds: [PIA, WALK] });
  r = await api("POST", `/donors/${PIA}/care-plan/touches`, tok, { type: "event_invite", due: nextMonth });
  r = await api("POST", `/tasks/${r.body.taskId}/complete`, tok, { done: true });
  ok("§4 a plan-of-care touch a month out ticks done today", r.status === 200 && Number(r.body.done) === 1, r.body);

  // ── §5 a planned touch is fulfilled by logging it ───────────────────────
  r = await api("POST", `/donors/${PIA}/care-plan/touches`, tok, { type: "note", due: nextMonth });
  const noteTask = r.body.taskId;
  r = await api("GET", `/donors/${PIA}/planned-touches`, tok);
  const offer = (r.body.planned || []).find(p => p.taskId === noteTask);
  ok("§5 the planned Handwritten note is offered to a Handwritten note", offer && offer.kinds.includes("letter") && offer.due === nextMonth, r.body);
  r = await log(tok, PIA, { touchKind: "email", line: "Emailed the photos.", completesTaskId: noteTask });
  const noteLines0 = rows(await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note='Emailed the photos.'`, [ORG, PIA]))[0].n;
  ok("§5 an Email cannot complete a planned note (409) and nothing is logged", r.status === 409 && noteLines0 === 0, { status: r.status, body: r.body });
  r = await log(tok, PIA, { touchKind: "letter", line: "Wrote to Pia about the spring show.", completesTaskId: noteTask });
  const [nt] = rows(await q(`SELECT done, due FROM tasks WHERE id=$1`, [noteTask]));
  const lines = rows(await q(`SELECT type, note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND (metadata->>'completes_task'=$3 OR metadata->>'taskId'=$3)`, [ORG, PIA, noteTask]));
  ok("§5 logging the note completes the planned one, a month early, due day kept", r.status === 201 && r.body.completed && nt.done === 1 && String(nt.due).slice(0, 10) === nextMonth, { body: r.body, nt });
  ok("§5 and the timeline has one line for it, in her words (not a second 'plan of care: done')", lines.length === 1 && lines[0].note === "Wrote to Pia about the spring show.", lines);

  // ── §6 the Ask, inline ──────────────────────────────────────────────────
  await api("PUT", `/donors/${WALK}/care-plan`, tok, { goal: "Name the boathouse", askCents: 1000000, askBy: dayOffset(90) });
  r = await api("PATCH", `/donors/${WALK}/care-plan`, tok, { askCents: 2500000 });
  const top = (await api("GET", "/top100", tok)).body;
  const row = (top.rows || []).find(x => x.donorId === WALK);
  const plan = (await api("GET", `/donors/${WALK}/care-plan`, tok)).body;
  ok("§6 the Ask saves alone: the Top 100 row and the plan of care both say $25,000", r.status === 200 && row && row.askCents === 2500000 && plan.plan.askCents === 2500000, { row, plan: plan.plan });
  ok("§6 and the goal and the ask-by day are untouched", plan.plan.goal === "Name the boathouse" && plan.plan.askBy === dayOffset(90), plan.plan);
  const [aud] = rows(await q(`SELECT entity_type, request_method FROM fin_audit_log WHERE org_id=$1 AND request_path=$2 ORDER BY created_at DESC LIMIT 1`, [ORG, `/donors/${WALK}/care-plan`]));
  ok("§6 the edit is in the audit log", aud && aud.request_method === "PATCH", aud);
  ok("§6 a bad amount is refused", (await api("PATCH", `/donors/${WALK}/care-plan`, tok, { askCents: -5 })).status === 400);
  r = await api("POST", `/donors/${WALK}/care-plan/touches`, tok, { type: "visit", due: dayOffset(20) });
  r = await api("PATCH", `/donors/${WALK}/care-plan/touches/${r.body.taskId}`, tok, { due: dayOffset(25), type: "tour" });
  ok("§6 the Next step's kind and day change in place", r.status === 200 && r.body.touches.some(t => t.type === "tour" && t.due === dayOffset(25)), r.body.touches);
  ok("§6 another org's plan is 404", (await api("PATCH", `/donors/${WALK}/care-plan`, oth, { askCents: 1 })).status === 404);

  // ── §7 the browser ──────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const lg = await api("POST", "/auth/login", null, { email: `dir@${ORG}.test`, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    const cut = [];   // which read was cut off, so a "Failed to fetch" says where it came from
    page.on("requestfailed", x => { if (!NOISE.test(x.url())) cut.push(`${x.method()} ${x.url().replace(/^https?:\/\/[^/]+/, "")} (${(x.failure() || {}).errorText})`); });
    await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);

    // Log a touch → Handwritten note, on Walt's profile.
    await page.goto(`${APP}/donors/${WALK}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="dp-primary"]').first().click();
    const dlg = page.locator('[data-testid="log-touch"]');
    await dlg.waitFor({ timeout: 20000 });
    ok("§7 the profile's button opens Log a touch", (await page.locator('[data-testid="dp-primary"]').first().textContent()).trim() === "Log a touch"
      && await dlg.locator('[data-testid="touch-kind-letter"]').count() === 1 && await dlg.locator('[data-testid="touch-kind-gift_sent"]').count() === 1);
    await dlg.locator('[data-testid="touch-kind-letter"]').click();
    await dlg.locator('[data-testid="conv-line"]').fill("Sent a thank-you card with a photo of the boathouse.");
    await dlg.locator('[data-testid="touch-save"]').click();
    await dlg.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const card = page.locator('[data-testid="dp-timeline"] .tl-card', { hasText: "Handwritten note: Sent a thank-you card with a photo of the boathouse" }).first();
    await card.waitFor({ timeout: 15000 }).catch(() => {});
    ok("§7 the timeline says it in her words, with its icon and who", await card.count() === 1 && await card.locator('[data-touch-icon="letter"]').count() === 1
      && /By Della Ward/.test((await card.textContent().catch(() => "")) || ""), (await card.textContent().catch(() => "")) || "");
    await page.waitForFunction(() => /Handwritten note|0 days|Today/i.test((document.querySelector('[data-testid="dp-fig-lastContact"]') || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const lc = (await page.locator('[data-testid="dp-fig-lastContact"]').first().textContent().catch(() => "")) || "";
    ok("§7 the header's Last contact is today", /(^|\D)0 days|Today/i.test(lc), lc);

    // Let the profile's own reads finish before leaving it: a read cut off by
    // the next page.goto logs "Failed to fetch" (smoke-walk's lesson; CI's runner).
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // The Ask cell in the Top 100.
    await page.goto(`${APP}/app/majorgifts?subtab=top100`, { waitUntil: "networkidle", timeout: 60000 });
    const askCell = page.locator('[data-testid="top100-row"]', { hasText: "Walt Fairbrother" }).locator('[data-testid="top100-ask"]');
    await askCell.waitFor({ timeout: 20000 });
    await askCell.hover();
    const pencil = askCell.locator('[data-testid="top100-ask-pencil"]');
    await page.waitForFunction(e => getComputedStyle(e).opacity === "1", await pencil.elementHandle(), { timeout: 5000 }).catch(() => {});
    ok("§7 a pencil shows on hover", await pencil.evaluate(e => getComputedStyle(e).opacity === "1").catch(() => false));
    await askCell.click();
    const ed = page.locator('[data-testid="top100-ask-editor"] input');
    await ed.fill("40000"); await ed.press("Enter");
    await page.waitForFunction(() => /\$40,000/.test([...document.querySelectorAll('[data-testid="top100-ask"]')].map(e => e.textContent).join(" ")), null, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});   // the save's reload of the rows finishes first
    await page.reload({ waitUntil: "networkidle" });
    const after = (await page.locator('[data-testid="top100-row"]', { hasText: "Walt Fairbrother" }).locator('[data-testid="top100-ask"]').textContent({ timeout: 20000 }).catch(() => "")) || "";
    const walt = (await api("GET", `/donors/${WALK}/care-plan`, tok)).body;
    ok("§7 the Ask typed in the cell saves, shows after a reload, and the plan of care matches", /\$40,000/.test(after) && walt.plan.askCents === 4000000, { after, plan: walt.plan });
    await askCell.click(); await page.locator('[data-testid="top100-ask-editor"] input').fill("1"); await page.keyboard.press("Escape");
    ok("§7 Escape cancels: still $40,000", (await api("GET", `/donors/${WALK}/care-plan`, tok)).body.plan.askCents === 4000000);

    // Tasks: a planned note a month out, ticked, offers to log it.
    const pn = await api("POST", `/donors/${WALK}/care-plan/touches`, tok, { type: "note", due: nextMonth });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText(/^Later \d/).first().click().catch(() => {});
    const trow = page.locator("li, [data-testid=task-row], div").filter({ hasText: "Handwritten note" }).filter({ has: page.locator('[data-testid="task-tick"]') }).last();
    await trow.locator('[data-testid="task-tick"]').first().click({ timeout: 20000 });
    await page.locator('[data-testid="planned-touch-offer"]').waitFor({ timeout: 15000 }).catch(() => {});
    ok("§7 ticking a planned note a month out offers to log it (no 'too far in advance')", await page.locator('[data-testid="planned-touch-offer"]').count() === 1);
    await page.locator('[data-testid="offer-log"]').click();
    const d2 = page.locator('[data-testid="log-touch"]');
    await d2.locator('[data-testid="touch-completes"]').waitFor({ timeout: 15000 }).catch(() => {});
    ok("§7 the dialog opens on Handwritten note and says it completes the planned note", await d2.locator('[data-testid="touch-kind-letter"][aria-pressed="true"]').count() === 1
      && /completes the planned handwritten note/.test((await d2.locator('[data-testid="touch-completes"]').textContent().catch(() => "")) || ""));
    await d2.locator('[data-testid="conv-line"]').fill("Card for the new season.");
    await d2.locator('[data-testid="touch-save"]').click();
    await d2.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    const [pnt] = rows(await q(`SELECT done, due FROM tasks WHERE id=$1`, [pn.body.taskId]));
    ok("§7 saving completes the planned note today; its due day is kept", pnt && pnt.done === 1 && String(pnt.due).slice(0, 10) === nextMonth, pnt);
    ok("§7 no console error or 5xx on the walk", errors.length === 0, { errors: errors.slice(0, 4).map(e => e.slice(0, 160)), cut });
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
