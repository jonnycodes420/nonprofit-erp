// tests/polish6.test.js: POLISH-6. ONE NAME FOR EACH PERIOD, SENTENCES THAT
// FINISH, DATES THAT TYPE RIGHT.
// Guards donor data (the brief a person reads before an ask, the audit log, the
// dates on gifts). One fresh org (made-up names), then:
//   §1 W-1107-Fundraising-05: the period labels a page shows come from
//      shared/fiscalPeriod.js: the Fundraising pledges tile says "due in FY …",
//      a calendar-year org's portfolio says "FY 2026", never "FY 2026–27".
//   §2 W-1107-Donors-26: Brief me's validator rejects a line ending on "as (…)",
//      a preposition, a conjunction or a bare "cannot."; the footer finishes.
//      W-1107-Atlas-07: a refusal is one plain sentence. W-1107-Atlas-10X: "1
//      touch over 1 week". W-1107-Atlas-26X: the audit log's action text.
//      W-1107-Atlas-19X: the glued-text check catches a colon glued to a word.
//   §3 W-1107-Finance-02X: same-day gifts newest entered first. W-1107-Finance-19X:
//      every date-entry case. W-1107-Fundraising-07X: a custom range runs the
//      Giving summary for exactly those dates. (browser) The gift form takes a
//      typed date and refuses a garbled one; Cancel throws the draft away.
// HOW IT GOES RED ON MAIN: hand-built labels and "this fiscal year" (§1); no
// unfinishedWhy, the footer ends "cannot.", CANT_LINE quotes a cut fragment,
// "1 weeks", "Deleted a event" / "Undone the atla" (§2); same-day gifts by id,
// no shared/dateEntry.js, no DateInput (§3).
// Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { DIST } = require("./lib/dist");

const ORG = "org_polish6";
const ORG_CAL = "org_polish6cal";
const PASSWORD = "loadtest1234";
const TODAY = civilDay(undefined, "America/New_York");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const src = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const has = f => fs.existsSync(path.join(__dirname, "..", f));

async function freshOrg(id, name, startMonth) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',$4)`, [id, name, id.replace(/_/g, "-"), JSON.stringify({ fiscal_year_start_month: startMonth })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ysolde Marrick','admin')`, ["u_" + id, id, `${id}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return login(`${id}@test.local`, PASSWORD);
}
async function person(org, id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,'system:test/polish6','POLISH-6 test')`,
    [id, org, name, `${id}@polish6.example.org`]);
  return id;
}

(async () => {
  const tok = await freshOrg(ORG, "Polish Six Lamplighters", 7);
  const calTok = await freshOrg(ORG_CAL, "Polish Six Calendar Choir", 1);
  const FP = await import(path.join(__dirname, "..", "shared/fiscalPeriod.js"));
  const y = Number(TODAY.slice(0, 4)), m = Number(TODAY.slice(5, 7));
  const fyStart = m >= 7 ? y : y - 1;

  // ── §1 · ONE NAME FOR EACH PERIOD ─────────────────────────────────────────
  console.log("\n— §1 · period labels —");
  const ov = (await api("GET", "/fundraising/overview", tok)).body || {};
  ok("the Fundraising pledges tile carries the year's label from fiscalPeriod", ov.pledges && ov.pledges.yearLabel === FP.fyLabelFromStart(fyStart, 7), ov.pledges && ov.pledges.yearLabel);
  ok("the page's period label is the same form", ov.periodLabel === FP.fyLabelFromStart(fyStart, 7), ov.periodLabel);
  const tile = src("client/src/components/Fundraising.jsx").match(/function PledgeTile[\s\S]*?\n}\n/);
  ok("the tile says \"due in\" the year's label, not \"due this fiscal year\"", !!tile && /due in \$\{p\.yearLabel/.test(tile[0]) && !/\} due this fiscal year/.test(tile[0]));
  const port = (await api("GET", `/portfolio/u_${ORG_CAL}`, calTok)).body || {};
  const label = port.target && port.target.fiscalLabel || (port.progress && port.progress.fiscalLabel) || JSON.stringify(port).match(/FY [0-9–-]+/)?.[0];
  ok("a calendar-year org's portfolio says \"FY " + y + "\", never a split year", label === `FY ${y}`, label);
  const handBuilt = ["server/majorGifts/routes.js", "server/reports/fundraising.js"].filter(f => /`FY \$\{|`FY\$\{|FY\$\{fyLabel\}/.test(src(f)));
  ok("no server file builds an FY label by hand", handBuilt.length === 0, handBuilt);

  // ── §2 · SENTENCES THAT FINISH ────────────────────────────────────────────
  console.log("\n— §2 · sentences —");
  const BC = require("../server/donors/briefComplete");
  ok("the Brief me validator exists", typeof BC.unfinishedWhy === "function");
  const bad = ["Last met in March, logged by Mike Henderson as (from a conversation).", "Steward has not estimated this person's means and cannot.",
    "They asked about the gala and", "A gift from"];
  ok("it rejects a line ending on a preposition, a conjunction, \"as (…)\" or \"cannot.\"", typeof BC.unfinishedWhy === "function" && bad.every(s => !!BC.unfinishedWhy(s)),
     typeof BC.unfinishedWhy === "function" ? bad.map(s => [s, BC.unfinishedWhy(s)]) : null);
  const good = ["She gave $500 to the Food Pantry.", "Gave as a member.", "Met twice this year, both times at the gala."];
  ok("and keeps finished ones", typeof BC.unfinishedWhy === "function" && good.every(s => !BC.unfinishedWhy(s)));
  const completed = BC.completeBrief({ headline: "Abel Corvane, steady giver", sections: [{ key: "history", sentences: [{ text: bad[0], cites: [] }, { text: good[0], cites: [] }] }] }, { quotes: new Map() });
  const lines = BC.briefLines(completed);
  ok("completeBrief leaves the unfinished line out and keeps the finished one", !lines.includes(bad[0]) && lines.includes(good[0]), lines);
  const BS = await import(path.join(__dirname, "..", "shared/briefShape.js"));
  ok("the brief's footer finishes its sentences", BC.briefProblems([BS.BRIEF_FOOTER]).length === 0 && !/cannot\.$/.test(BS.BRIEF_FOOTER), BS.BRIEF_FOOTER);
  const AT = await import(path.join(__dirname, "..", "shared/atlas.js"));
  ok("a refusal about a fact Steward does not keep is one plain sentence", AT.CANT_LINE("What is Renee's favorite color?") === "I don't have Renee's favorite color in Steward.", AT.CANT_LINE("What is Renee's favorite color?"));
  const long = AT.CANT_LINE("schedule a lunch with the whole board every quarter and invite everyone from the gala committee as well please");
  ok("any other refusal quotes no fragment and cuts no word", !/["“”]/.test(long) && /\.$/.test(long), long);
  const JS = await import(path.join(__dirname, "..", "shared/journeyShape.js"));
  ok("one same-day touch is \"1 touch over 1 week\"", /^1 touch over 1 week\./.test(JS.touchesSentence([{ offsetDays: 0 }])), JS.touchesSentence([{ offsetDays: 0 }]));
  ok("the journey builder says its span through countWords (no \"1 weeks\")", !/plural\(Math\.round\(maxOffset \/ 7\)/.test(src("client/src/components/JourneyBuilder.jsx")));
  const A = require("../auditTrail");
  const row = (action, entity_type, extra = {}) => A.describeAuditRow({ action, entity_type, before: null, after: null, changes: {}, ...extra });
  // a timeline entry of type "event" deleted ("Deleted a event" on main) and a logged email
  const evDel = row("deleted", "interaction", { before: { type: "event", date: TODAY } });
  ok("audit text: \"Deleted an event\", never \"a event\"", /^Deleted an event\b/.test(evDel), evDel);
  const emLog = row("created", "interaction", { after: { type: "email" } });
  ok("audit text: \"Logged an email\"", /^Logged an email\b/.test(emLog), emLog);
  ok("audit text: an Atlas undo says \"Atlas\" whole", !/\batla\b/.test(row("undone", A.prettify("atlas"))) && /^Undid\b/.test(row("undone", A.prettify("atlas"))), row("undone", A.prettify("atlas")));
  ok("audit text: a noun said once (\"Dismissed a draft\")", typeof A.actionText === "function" && A.actionText("Dismissed a draft the draft a draft") === "Dismissed a draft", typeof A.actionText === "function" ? A.actionText("Dismissed a draft the draft a draft") : null);
  const changed = A.describeAuditRow({ action: "updated", entity_type: "campaign", before: { name: "Spring lantern walk for the river trail" }, after: { name: "Spring lantern walk for the river trail and the old mill" }, changes: {} });
  ok("audit text never cuts a value mid-word", !/[a-z]\.\.\."|[a-z]…"/.test(changed.replace(/(trail|mill|the|and|old|for|river|walk|lantern|Spring)…"/g, "")), changed);
  const { glued } = require("./lib/glued");
  ok("the glued-text check catches \"Not sent:pledge reminders\"", glued("Not sent:pledge reminders · Nov 7").length > 0 && glued("Not sent: pledge reminders · 10:30 AM").length === 0);

  // ── §3 · ORDER AND DATES ──────────────────────────────────────────────────
  console.log("\n— §3 · order and dates —");
  const IRIS = await person(ORG, "d_p6_iris", "Iris Wendle");
  // Two gifts on one day: the one entered later has the smaller id.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name,created_at) VALUES
           ('g_p6_zz_first',$1,$2,40,$3,'cash','system:test','Test',NOW() - INTERVAL '2 hours'),
           ('g_p6_aa_second',$1,$2,60,$3,'cash','system:test','Test',NOW() - INTERVAL '1 hour')`, [ORG, IRIS, TODAY]);
  const prof = (await api("GET", `/donors/${IRIS}`, tok)).body || {};
  const ids = (prof.gifts || []).map(g => g.id);
  ok("same-day gifts list the one entered last first", ids[0] === "g_p6_aa_second" && ids[1] === "g_p6_zz_first", ids);
  ok("the browser sorts gifts the same way (shared/giftOrder.js)", has("shared/giftOrder.js") && /compareGifts/.test(src("client/src/components/profile/GivingTab.jsx")));
  ok("the date entry rule exists", has("shared/dateEntry.js"));
  if (has("shared/dateEntry.js")) {
    const DE = await import(path.join(__dirname, "..", "shared/dateEntry.js"));
    const cases = [["11/07/2026", "2026-11-07"], ["1/2/26", "2026-01-02"], ["11072026", "2026-11-07"], ["2026-11-07", "2026-11-07"], [" 2026-11-07T00:00:00Z ", "2026-11-07"], ["", ""]];
    for (const [inp, want] of cases) { const r = DE.parseDateEntry(inp); ok(`a typed "${inp}" is ${want || "empty"}`, r.ok && r.iso === want, r); }
    for (const inp of ["72026", "02/30/2026", "13/01/2026", "11/07/12026", "hello"]) { const r = DE.parseDateEntry(inp); ok(`"${inp}" is refused with a sentence`, !r.ok && /MM\/DD\/YYYY/.test(r.error || ""), r); }
  }
  const nativeLeft = (() => { const out = []; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.jsx$/.test(f.name) && !/inputs\/DateInput\.jsx$/.test(p) && /type="date"/.test(fs.readFileSync(p, "utf8"))) out.push(path.relative(path.join(__dirname, ".."), p)); } }; walk(path.join(__dirname, "..", "client/src")); return out; })();
  ok("every date box is the one shared DateInput (no native type=\"date\" left)", nativeLeft.length === 0, nativeLeft);
  // A custom range: exactly those dates.
  await api("POST", `/donors/${IRIS}/gifts`, tok, { amount: 25, date: dayOffset(-40), idempotencyKey: crypto.randomUUID() });
  const from = dayOffset(-3), to = TODAY;
  const gs = (await api("GET", `/reports/giving-summary?from=${from}&to=${to}`, tok)).body || {};
  const gsTotal = JSON.stringify(gs).match(/"(?:total|totalRaised|raised|grandTotal)":\s*"?([\d.]+)/);
  ok("a custom range runs the Giving summary for those dates only ($100 of the day's gifts, not the $25 forty days back)", gsTotal && Math.round(Number(gsTotal[1]) * 100) === 10000, gsTotal && gsTotal[1]);
  ok("the period picker offers \"Custom range\"", /label: "Custom range"/.test(src("client/src/components/Reports.jsx")));

  // ── §3 (browser) · THE DATE BOX IN THE GIFT FORM ──────────────────────────
  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  const JUNO = await person(ORG, "d_p6_juno", "Juno Pellworth");
  const lg = await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  try {
    await page.goto(`${APP}/donors/${JUNO}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-tab="giving"]').first().click({ timeout: 20000 });
    await page.getByRole("button", { name: /Add Gift|Record a gift|\+ Gift/i }).first().click({ timeout: 15000 });
    const form = page.locator('[data-testid="dp-add-gift-form"]');
    await form.waitFor({ timeout: 10000 });
    const box = form.locator("[data-date-input]").first();
    await box.fill("72026"); await box.blur();
    const err = await form.locator('[data-testid="date-input-error"]').first().textContent({ timeout: 4000 }).catch(() => "");
    ok("§3 a garbled date shows the error", /MM\/DD\/YYYY/.test(err || ""), err);
    await form.getByPlaceholder("Amount ($)").fill("35");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(1200);
    const n0 = Number((await q(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1`, [JUNO]))[0].n);
    ok("§3 and nothing is saved with it", n0 === 0, n0);
    await box.fill("11072026"); await box.blur();
    ok("§3 eight typed digits read as 11/07/2026", (await box.inputValue()) === "11/07/2026", await box.inputValue());
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(1500);
    const saved = await q(`SELECT LEFT(date::text,10) AS d FROM gifts WHERE donor_id=$1`, [JUNO]);
    ok("§3 the gift is saved on 2026-11-07", saved.length === 1 && saved[0].d === "2026-11-07", saved);
  } catch (e) { ok("§3 browser leg ran to the end", false, String(e && e.message || e).split("\n")[0]); }
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });
