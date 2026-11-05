// tests/counts1.test.js: COUNTS-1. EVERY COUNT MATCHES THE LIST IT COUNTS,
// "LAST CONTACT" MEANS THE LAST CONTACT, AND COUNTS ARE FAST.
// Guards donor data: two walks on a demo org (4–5 Nov 2026) found counts that
// disagreed with the lists they label, and a profile that said "Last contact:
// none yet" beside a call logged that day.
//
//   §1 the Tasks badge is her open tasks due today or overdue, the server's
//      count by the list's own rule (GET /tasks/counts = the Today and Overdue
//      lists); adding a task due today moves it by one.
//   §2 a call logged with a follow-up, on a person whose officer is someone
//      else: Last contact is today in the log's own response, the header's
//      figure, Engagement's sentence and About's sentence; the follow-up is in
//      HER Tasks (Upcoming), her Thread, the rail and the profile's Tasks list.
//   §3 the Last contact rule: a plain note does not move it; an event they came
//      to does; a note marked as a conversation does.
//   §4 a note saved on the profile is in the list the Notes tab reads.
//   §5 events, volunteers, sequences, campaign audience, SYBUNT, lapsed
//      (tests/lib/counts1Item3.js) and GET /donors/counts speed and numbers
//      (tests/lib/counts1Perf.js), when present.
//   §6 TRUTH-1's key agrees, with the counts pass (surfacesAgree `counts`).
//   §7 the browser: the rail badge says the API's number and moves by one when
//      a call with a follow-up due today is logged on a profile, with no
//      reload; the header's Last contact and the Tasks tab move with it.
//
// Planted defects (each turned this suite red, then was taken back out):
//   · the badge computed from the boot-time copy of the task list (cached)
//     → §7 "the badge moves by one" red;
//   · Last contact from calls only (conversationsWith CONVERSATION_TYPES =
//     ["call"]) → §3 event/marked note red.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_counts1";
const EMAIL = `${ORG}@test.local`;
const OFFICER = `u_${ORG}_officer`;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Counts Test Trust',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rhea Ward','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Owen Pike','officer')`, [OFFICER, ORG, `${ORG}-officer@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, f = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,assigned_to,assigned_to_name,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5,$6,'system:test/counts1','COUNTS-1 test')`,
  [P(id), ORG, name, `${id}@counts1.example.org`, f.officer ? OFFICER : null, f.officer ? "Owen Pike" : null]);
const DUE_NOW = c => (Number(c.today) || 0) + (Number(c.overdue) || 0);

(async () => {
  const tok = await freshOrg();
  ok("§0 signed in", !!tok);
  const today = civilPlusDays(0);

  // ── §1 the badge is the count of the list it opens ──────────────────────
  for (const [t, due] of [["Send the board pack", civilPlusDays(-3)], ["Call the printer", today], ["Book the hall", civilPlusDays(3)], ["Plan the spring walk", null]])
    await api("POST", "/tasks", tok, { title: t, due, priority: "medium", type: "admin", assignedTo: "u_" + ORG, assignedToName: "Rhea Ward" });
  const c1 = (await api("GET", "/tasks/counts?scope=mine", tok)).body;
  const [lt, lo] = await Promise.all(["today", "overdue"].map(v => api("GET", `/tasks?view=${v}&scope=mine`, tok).then(r => r.body)));
  ok("§1 the badge's number (today + overdue) is the length of the Today and Overdue lists", DUE_NOW(c1) === lt.length + lo.length && DUE_NOW(c1) === 2, { c1, today: lt.length, overdue: lo.length });
  await api("POST", "/tasks", tok, { title: "Ring the caterer", due: today, priority: "medium", type: "admin", assignedTo: "u_" + ORG, assignedToName: "Rhea Ward" });
  const c1b = (await api("GET", "/tasks/counts?scope=mine", tok)).body;
  ok("§1 adding a task due today moves it by one", DUE_NOW(c1b) === DUE_NOW(c1) + 1, { before: DUE_NOW(c1), after: DUE_NOW(c1b) });
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "App.jsx"), "utf8");
  ok("§1 the rail badge reads the server's count, not a copy of the list in the browser", /useTaskBadge\(/.test(appSrc) && !/data\.tasks\.filter\([^)]*due/.test(appSrc));

  // ── §2 a call with a follow-up, on someone else's donor ─────────────────
  await person("tam", "Tamsin Okafor", { officer: true });
  const due = civilPlusDays(4);
  const conv = await api("POST", `/donors/${P("tam")}/conversations`, tok, { touch: "call_reached", line: "Talked about the spring visit", date: today,
    nextStep: { type: "follow_up", label: "Follow up", due } });
  ok("§2 the call is logged", conv.status === 201, conv.body);
  ok("§2 Last contact is today, in the log's own response", conv.body.lastContact && conv.body.lastContact.date === today && conv.body.lastContact.type === "call", conv.body.lastContact);
  const rec = (await api("GET", `/donors/${P("tam")}`, tok)).body;
  const cf = rec.figures && rec.figures.contact;
  ok("§2 the header's Last contact is today, and says it was a call", cf && Number(cf.value) === 0 && cf.under && cf.under.what === "Call" && cf.under.date === today, cf);
  const sc = (await api("GET", `/donors/${P("tam")}/scores`, tok)).body;
  ok("§2 Engagement's sentence ends on the same Last contact", /the last contact today\.$/.test(String(sc.reason || "")), sc.reason);
  const st = (await api("GET", `/donors/${P("tam")}/status`, tok)).body;
  const fact = ((st.closeness || {}).facts || []).find(f => /last contact/.test(f.text));
  ok("§2 About's sentence reads the same Last contact, from the same source", fact && fact.source.key === "donor-contact-gap" && /today/.test(fact.text), (st.closeness || {}).facts);
  const up = (await api("GET", "/tasks?view=upcoming&scope=mine", tok)).body;
  ok("§2 the follow-up is in HER Tasks > Upcoming (she set it)", up.some(t => t.donor_id === P("tam") && t.title === "Follow up" && String(t.due).slice(0, 10) === due), up.map(t => [t.title, t.due, t.assigned_to]));
  const th = (await api("GET", "/threads?scope=mine", tok)).body;
  const thList = (th && th.list) || [];
  ok("§2 …and on her Thread (Home's), with its day", thList.some(x => x.donorId === P("tam") && x.nextStep && x.nextStep.due === due), thList.map(x => [x.donorName, x.nextStep && x.nextStep.due]));
  const rail = (await api("GET", `/threads?donorId=${P("tam")}`, tok)).body;
  ok("§2 …and the rail's next step", JSON.stringify(rail).includes(due), rail);
  const ptasks = (await api("GET", `/donors/${P("tam")}/tasks`, tok)).body;
  ok("§2 …and the profile's Tasks list", ptasks.some(t => t.title === "Follow up" && String(t.due).slice(0, 10) === due), ptasks.map(t => t.title));

  // ── §3 the Last contact rule ────────────────────────────────────────────
  await person("idr", "Idris Calloway");
  const gap = async () => { const r = (await api("GET", `/donors/${P("idr")}`, tok)).body; return r.figures && r.figures.contact && r.figures.contact.value; };
  await api("POST", `/donors/${P("idr")}/conversations`, tok, { touch: "call_reached", line: "Left a message about the gala", date: civilPlusDays(-20), nextStep: { skipped: true } });
  ok("§3 a call 20 days ago: Last contact is 20 days", Number(await gap()) === 20, await gap());
  await api("POST", `/donors/${P("idr")}/conversations`, tok, { touch: "note_only", line: "Prefers letters to email", date: civilPlusDays(-3), nextStep: { skipped: true } });
  ok("§3 a plain note does not move it", Number(await gap()) === 20, await gap());
  await q(`INSERT INTO events (id,org_id,name,event_type,date,created_by,created_by_name) VALUES ($1,$2,'Harbour Supper','gala',$3,'system:test/counts1','COUNTS-1 test')`, [P("ev"), ORG, civilPlusDays(-8)]);
  await q(`INSERT INTO event_attendees (id,org_id,event_id,donor_id,name,status) VALUES ($1,$2,$3,$4,'Idris Calloway','attended')`, [P("ea"), ORG, P("ev"), P("idr")]);
  ok("§3 an event they came to 8 days ago moves it to 8", Number(await gap()) === 8, await gap());
  await api("POST", `/donors/${P("idr")}/conversations`, tok, { touch: "note_only", line: "Caught him at the market, he asked about the boat fund", date: civilPlusDays(-2), conversation: true, nextStep: { skipped: true } });
  ok("§3 a note marked as a conversation moves it to 2", Number(await gap()) === 2, await gap());

  // ── §4 a note is in the list the Notes tab reads ────────────────────────
  const ints = (await api("GET", `/donors/${P("idr")}`, tok)).body.interactions || [];
  ok("§4 both notes are on the record, as notes (the Notes tab's rows)", ints.filter(i => i.type === "note").length === 2, ints.map(i => i.type));

  // ── §5 the other counts, and /donors/counts ─────────────────────────────
  const item3 = optional("./lib/counts1Item3");
  if (item3) { const fails = await item3.checkItem3({ token: tok, orgId: ORG, q }); ok("§5 events, volunteers, sequences, campaign audience, SYBUNT and lapsed agree", fails.length === 0, fails); }
  const perf = optional("./lib/counts1Perf");
  if (perf) { const fails = await perf.checkCountsSpeed({ token: tok, orgId: ORG, q }); ok("§5 GET /donors/counts is fast and its numbers are the rows'", fails.length === 0, fails); }

  // ── §6 TRUTH-1's key, with the counts pass ──────────────────────────────
  const { assertSurfacesAgree } = require("./lib/surfacesAgree");
  const agree = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "COUNTS-1", skip: ["ask", "atlas"] });
  ok("§6 every surface agrees with the key, the counts pass included", agree.ok, agree.diffs);

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
    await person("wal", "Walter Brine", { officer: true });
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", msg => { if (msg.type() === "error" && !NOISE.test((msg.location() || {}).url || "") && !/Download the React DevTools/.test(msg.text())) errors.push(msg.text()); });
    page.on("response", r => { if (r.status() >= 500 && !NOISE.test(r.url())) errors.push(r.status() + " " + r.url()); });
    await page.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    await page.goto(`${APP}/donors/${P("wal")}`, { waitUntil: "networkidle", timeout: 60000 });
    const badge = page.locator('[data-testid="tasks-rail-badge"]').first();
    await badge.waitFor({ timeout: 20000 }).catch(() => {});
    const apiDue = DUE_NOW((await api("GET", "/tasks/counts?scope=mine", tok)).body);
    const b0 = Number((await badge.textContent().catch(() => "")) || NaN);
    ok("§7 the rail badge says the API's number", b0 === apiDue, { badge: b0, api: apiDue });
    ok("§7 …and says what it counts", /due today or overdue/.test((await badge.getAttribute("title").catch(() => "")) || ""), await badge.getAttribute("title").catch(() => null));
    const tasksTab = page.locator('[data-tab="tasks"] [data-tab-count="tasks"]');
    const t0 = Number((await tasksTab.textContent().catch(() => "0")) || 0);
    await page.locator('[data-testid="dp-primary"]').first().click();
    await page.locator('[data-testid="conv-line"]').fill("Called about the walk, he will bring two friends");
    await page.getByLabel("Next step due date").fill(today);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator('[data-testid="conv-line"]').waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await page.waitForFunction(([n]) => { const el = document.querySelector('[data-testid="tasks-rail-badge"]'); return el && Number(el.textContent) === n; }, [b0 + 1], { timeout: 15000 }).catch(() => {});
    const b1 = Number((await badge.textContent().catch(() => "")) || NaN);
    ok("§7 logging a call with a follow-up due today moves the badge by one, with no reload", b1 === b0 + 1, { before: b0, after: b1 });
    await page.waitForFunction(() => /Call/.test((document.querySelector('[data-testid="dp-fig-lastContact"]') || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const lc = (await page.locator('[data-testid="dp-fig-lastContact"]').first().textContent().catch(() => "")) || "";
    ok("§7 the header's Last contact says the call, today", /Call/.test(lc) && /(^|\D)0 days/.test(lc), lc);
    await page.waitForFunction(([n]) => Number((document.querySelector('[data-tab="tasks"] [data-tab-count="tasks"]') || {}).textContent || 0) === n, [t0 + 1], { timeout: 15000 }).catch(() => {});
    const t1 = Number((await tasksTab.textContent().catch(() => "0")) || 0);
    ok("§7 the profile's Tasks tab count moves by one", t1 === t0 + 1, { before: t0, after: t1 });
    await page.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
    const dn = (await page.locator('[data-testid="tasks-due-now"]').textContent({ timeout: 15000 }).catch(() => "")) || "";
    ok("§7 the Tasks page says the badge's number and what it counts", new RegExp(`^${b1} tasks? due today or overdue`).test(dn), dn);
    ok("§7 no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
