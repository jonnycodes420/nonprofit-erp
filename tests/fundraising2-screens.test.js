// tests/fundraising2-screens.test.js · FUNDRAISING-2. FUNDRAISING SAYS WHAT
// IS TRUE ABOUT MONEY AND PLEDGES, ONCE. Guards money and donor data: Allie's
// real dinner (63 gifts, 43 pledges, $78,950 due this year, $104,050 over
// three years) is read on Fundraising, Pledges, the event page, Home and each
// profile, and they must say one thing.
//
// Into one fresh org: the real-shaped dinner file linked to its event, the
// scrubbed guest list for who came, and three goals (running, not started,
// ended) with gifts and a pledge.
//   §1 a goal before its start says "Starts <day>", has no pace, and shows
//      what is already pledged to it
//   §2 "Active goals" counts only goals running today, and the cards under it
//      are exactly those goals; an ended goal is under Past
//   §3 "vs last year" is the same days last year, and says which days
//   §4 the dinner: the event page's raised, pledged (first year and all
//      years) and came are the key's, the Overview's pledges are Pledges'
//      totals, and assertSurfacesAgree holds (database, Pledges and its rows,
//      Overview, Home, every profile, the event page)
//   §5 a giving page is not live, and its address is not open, until the org
//      can take money
//   §6 the browser: at 1440 no PROJECT / ANNUAL / Offline / Online tag, no
//      "Everything in Fundraising", the not-started card says Starts with no
//      pace badge, the roll-up's count is the cards' count, and "Gifts this
//      fiscal year" names its period
//
// HOW IT GOES RED ON MAIN: there is no /fundraising/pledges (§4); the
// roll-up counts the goal that has not started (§2); that goal has a pace and
// no startsOn (§1); the event report has no story (§4); a page is live and
// open with no payments connected (§5); the Overview renders PROJECT, Offline
// and "Everything in Fundraising" (§6).
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, browserLegOrSkip, BASE } = require("./helpers");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import");
const KEY = JSON.parse(fs.readFileSync(path.join(FX, "real-shaped", "expected.json"), "utf8"))["jp-dinner-gifts-106.xlsx"];
const ORG = "org_fr2screens", EMAIL = "admin@fr2screens.local", PASSWORD = "loadtest1234";
const DINNER = { linkEvent: true, eventName: "Finding Joy Dinner", eventDate: civilPlusDays(-12), useEventDate: true, pledgeDue: "event" };
const APP = process.env.APP_URL || "http://localhost:4173";
const DIST = path.join(__dirname, "..", "client", "dist");
const cents = v => Math.round(Number(v || 0) * 100);
let assertSurfacesAgree = null;
try { ({ assertSurfacesAgree } = require("./lib/surfacesAgree")); } catch {}

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Fundraising Two','fr2-screens',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fr2screens',$1,$2,$3,'Allie Test','admin')`, [ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function importFile(tok, file, answers) {
  const R = await import("../shared/sheetRead.js");
  const sheets = R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true }), XLSX);
  const r = await api("POST", "/sheet-import/commit", tok, { fileName: path.basename(file), sheets, answers, background: true });
  if (r.status !== 202) return { status: "refused " + r.status };
  for (let i = 0; i < 600; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return j.body;
    await new Promise(res => setTimeout(res, 200));
  }
  return { status: "timeout" };
}

async function main() {
  const tok = await freshOrg();
  const d1 = await importFile(tok, "real-shaped/jp-dinner-gifts-106.xlsx", DINNER);
  const d2 = await importFile(tok, "event-guest-list-scrubbed.xlsx", { eventName: DINNER.eventName, eventDate: DINNER.eventDate });
  ok("the dinner and the guest list import", d1.status === "done" && d2.status === "done", [d1.status, d2.status]);
  const [ev] = await q(`SELECT id FROM events WHERE org_id=$1 AND name=$2`, [ORG, DINNER.eventName]);
  const [giver] = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, [ORG]);

  // three goals: running, not started, ended
  const goal = (id, name, amt, s, e) => q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,goal_category,created_by,created_by_name)
                                           VALUES ($1,$2,$3,'appeal','active',$4,$5,$6,'project','system:test','test')`, [id, ORG, name, amt, s, e]);
  await goal("c_fr2_now", "Spring Now", 10000, civilPlusDays(-30), civilPlusDays(30));
  await goal("c_fr2_soon", "Winter Soon", 5000, civilPlusDays(20), civilPlusDays(60));
  await goal("c_fr2_past", "Last Fall", 3000, civilPlusDays(-200), civilPlusDays(-100));
  // through the one gift path, so every surface sees them the same way
  const gift = async (cid, amt, date) => (await api("POST", `/donors/${giver.id}/gifts`, tok, { amount: amt, date, campaignId: cid, paymentMethod: "Check" })).status;
  const made = [await gift("c_fr2_now", 1500, civilPlusDays(-3)), await gift("c_fr2_soon", 250, civilPlusDays(-2)), await gift("c_fr2_past", 900, civilPlusDays(-150))];
  // a gift dated before its goal starts is refused by the gift path, so a goal
  // that has not started shows early money only from an import
  ok("the goal gifts are recorded, and one dated before its goal starts is refused", made[0] === 201 && made[1] === 400 && made[2] === 201, JSON.stringify(made));
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,campaign_id,created_by,created_by_name)
           VALUES ('p_fr2_soon',$1,$2,400,$3,'open','c_fr2_soon','system:test','test')`, [ORG, giver.id, civilPlusDays(40)]);

  const ov = (await api("GET", "/fundraising/overview", tok)).body || {};
  const g = id => (ov.goals || []).find(x => x.id === id) || {};

  // §1 not started
  const soon = g("c_fr2_soon");
  ok("§1 a goal before its start is upcoming, says the day it starts, and has no pace",
     soon.lifecycle === "upcoming" && soon.startsOn === civilPlusDays(20) && soon.paceState == null && soon.paceSentence == null, JSON.stringify(soon).slice(0, 300));
  ok("§1 it carries what is already pledged to it ($400)", cents(soon.pledged) === 40000 && soon.earlyGiven === 0, [soon.pledged, soon.earlyGiven]);

  // §2 active means running
  const running = (ov.goals || []).filter(x => x.isTopLevel && x.lifecycle === "active");
  ok("§2 Active goals counts only the goal running today (1, not 2)", ov.rollup && ov.rollup.activeGoalCount === 1 && running.length === 1 && running[0].id === "c_fr2_now",
     JSON.stringify([ov.rollup, running.map(x => x.id)]));
  ok("§2 the roll-up's raised is the running goal's alone", ov.rollup && cents(ov.rollup.totalRaised) === cents(g("c_fr2_now").raised) && cents(ov.rollup.totalGoal) === 1000000,
     JSON.stringify(ov.rollup));
  ok("§2 the ended goal is ended", g("c_fr2_past").lifecycle === "ended", g("c_fr2_past").lifecycle);

  // §3 the same days last year
  const cmp = (ov.period || {}).compare;
  const today = civilPlusDays(0);
  const lastYear = d => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  ok("§3 \"vs last year\" is this period so far against the same days last year, and says which",
     !!cmp && cmp.to === today && cmp.lastFrom === lastYear(cmp.from) && (cmp.lastTo === lastYear(today) || (today.slice(5) === "02-29" && cmp.lastTo.slice(5) === "02-28"))
     && /same days last year/.test(cmp.sentence || ""), JSON.stringify(cmp));
  ok("§3 the gifts tile names its period", ov.periodWords === "this fiscal year", ov.periodWords);

  // §4 the dinner
  const rep = (await api("GET", `/events/${ev.id}/report`, tok)).body || {};
  const st = rep.story || {};
  const pledgedAll = Math.round(KEY.not_yet_received.dollars * 100) + 0;   // first year
  ok(`§4 the event page: $${KEY.received.dollars} received, $${KEY.not_yet_received.dollars} pledged for its year`,
     st.receivedCents === Math.round(KEY.received.dollars * 100) && st.pledgedCents === pledgedAll, JSON.stringify([st.receivedCents, st.pledgedCents]));
  ok("§4 the event page: $124,290 raised, $104,050 pledged over all years, 165 came",
     st.raisedCents === 12429000 && st.pledgedAllCents === 10405000 && st.attended === 165, JSON.stringify([st.raisedCents, st.pledgedAllCents, st.attended]));
  ok("§4 gave + came-and-didn't-give never exceeds the people involved; every count opens its people",
     st.cameDidntGive <= st.attended && st.sources && st.sources.attended && st.sources.gave && st.sources.cameDidntGive && st.sources.pledgedAll, JSON.stringify(st.sources || {}).slice(0, 300));
  const pl = (await api("GET", "/fundraising/pledges", tok));
  ok("§4 Pledges answers, with every open pledge and its installments", pl.status === 200 && Array.isArray(pl.body.pledges) && pl.body.pledges.length === KEY.not_yet_received.rows + 1
     && pl.body.pledges.every(p => Array.isArray(p.installments)), [pl.status, pl.body && pl.body.pledges && pl.body.pledges.length]);
  ok("§4 the Overview's pledges are Pledges' totals", ov.pledges && ["open", "dueThisYear", "overdue"].every(k => cents(ov.pledges[k]) === cents(pl.body[k])),
     JSON.stringify([ov.pledges && [ov.pledges.open, ov.pledges.dueThisYear, ov.pledges.overdue], pl.body && [pl.body.open, pl.body.dueThisYear, pl.body.overdue]]));
  ok("§4 the dinner's pledges in Pledges: $104,050 still to come", ((pl.body || {}).pledges || []).filter(p => p.madeAt && p.madeAt.id === ev.id).reduce((n, p) => n + cents(p.balance), 0) === 10405000, "");
  ok("§4 every dinner gift carries the event (63)", (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND event_id=$2`, [ORG, ev.id]))[0].n === KEY.received.rows, "");
  let agreeErr = null;
  if (assertSurfacesAgree) {
    // PLANTED, to prove the pledge check can go red: Fundraising says $1 more is overdue.
    const planted = await assertSurfacesAgree(ORG, { token: tok, soft: true, skip: ["atlas", "ask"], plant: ({ fund }) => { if (fund && fund.pledges) fund.pledges.overdue += 1; } });
    ok("§4 the truth check goes red when Fundraising's overdue differs by a dollar", !planted.ok && planted.diffs.some(x => /pledged, overdue/.test(x)), JSON.stringify(planted.diffs).slice(0, 300));
    try { await assertSurfacesAgree(ORG, { token: tok, skip: ["atlas", "ask"] }); } catch (e) { agreeErr = e.message; }
    ok("§4 the surfaces agree: database, Pledges and its rows, Overview, Home, every profile, the event page", !agreeErr, agreeErr && agreeErr.slice(0, 600));
  } else ok("§4 the truth check is there", false, "tests/lib/surfacesAgree.js did not load");

  // §5 a page is live only once it can take money
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,created_by,created_by_name) VALUES ('gp_fr2',$1,'dinner-gifts','Dinner gifts','active','system:test','test')`, [ORG]);
  await q(`UPDATE orgs SET stripe_connected=false, stripe_account_id=NULL WHERE id=$1`, [ORG]);
  const ov5 = (await api("GET", "/fundraising/overview", tok)).body || {};
  const pub = await api("GET", "/org/fr2-screens/giving-page/dinner-gifts/public", null);
  ok("§5 with no payments connected the page is not live and its address says it is not open yet",
     ov5.givingPages && ov5.givingPages.count === 0 && ov5.givingPages.takesGifts === false && pub.status === 404 && pub.body.notOpen === true && /isn't open yet/.test(pub.body.error || ""),
     JSON.stringify([ov5.givingPages, pub.status, pub.body]).slice(0, 300));
  await q(`UPDATE orgs SET stripe_connected=true, stripe_account_id='acct_fr2screens' WHERE id=$1`, [ORG]);
  const ov5b = (await api("GET", "/fundraising/overview", tok)).body || {};
  const pub2 = await api("GET", "/org/fr2-screens/giving-page/dinner-gifts/public", null);
  ok("§5 once payments are connected it counts as live and its address opens", ov5b.givingPages && ov5b.givingPages.count === 1 && pub2.status === 200 && !pub2.body.notOpen,
     JSON.stringify([ov5b.givingPages && ov5b.givingPages.count, pub2.status]));

  // §6 the browser
  await browserLeg(tok);
}

async function browserLeg(tok) {
  let chromium = null, why = null;
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); } catch { why = "Playwright not found"; }
  const assets = path.join(DIST, "assets");
  const apiOrigin = BASE.replace(/^https?:\/\//, "");
  if (!why && !(fs.existsSync(assets) && fs.readdirSync(assets).some(f => f.endsWith(".js") && fs.readFileSync(path.join(assets, f), "utf8").includes(apiOrigin)))) why = "client/dist not built against the local API";
  if (browserLegOrSkip(why, "§6")) return;
  const auth = (await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD })).body;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
  const page = await ctx.newPage();
  await page.goto(`${APP}/app/fundraising?fr=overview`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector('[data-testid="fr-rollup"]', { timeout: 30000 }).catch(() => {});
  const seen = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const tags = [...main.querySelectorAll("span,div,button")].filter(el => el.children.length === 0 && /^(project|annual|capital|offline|online)$/i.test((el.textContent || "").trim())).map(el => el.textContent.trim());
    const starts = document.querySelector('[data-testid="goal-starts"]');
    const card = starts && starts.closest('[role="link"],[role="button"],div[tabindex]');
    const rollup = document.querySelector('[data-testid="fr-rollup"]');
    return { tags, index: /Everything in Fundraising/i.test(main.innerText), starts: starts ? starts.innerText : null,
             paceInStarts: !!(card && card.querySelector('[data-testid="pace-badge"]')),
             activeCount: rollup ? Number(rollup.getAttribute("data-active-count")) : null,
             activeCards: document.querySelectorAll('[data-testid="fr-goals-active"] [data-record-link="campaign"]').length,
             pastFolded: !!document.querySelector('details[data-testid="fr-goals-past"]:not([open])'),
             giftsLabel: /Gifts this fiscal year/i.test(main.innerText), pledges: !!document.querySelector('[data-testid="fr-pledges"]') };
  });
  ok("§6 no PROJECT, ANNUAL, Offline or Online tag on the Overview", seen.tags.length === 0, JSON.stringify(seen.tags));
  ok("§6 no \"Everything in Fundraising\" under the tabs that already say it", !seen.index, "");
  ok("§6 the goal not started says \"Starts\" and has no pace badge", /^Starts /.test(seen.starts || "") && !seen.paceInStarts, JSON.stringify([seen.starts, seen.paceInStarts]));
  ok("§6 the roll-up's count is the number of running cards, and Past is folded", seen.activeCount === 1 && seen.activeCards === 1 && seen.pastFolded, JSON.stringify(seen));
  ok("§6 \"Gifts this fiscal year\" names its period, and the pledges tile is there", seen.giftsLabel && seen.pledges, JSON.stringify(seen));
  await browser.close();
}

main().catch(e => { ok("the suite ran", false, e.stack || String(e)); }).finally(async () => { await closeDb(); summary(); });
