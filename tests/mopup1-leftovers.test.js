// tests/mopup1-leftovers.test.js · MOPUP-1. THE LEFTOVERS FROM 5 NOV'S BUILDS.
//
//   §1 money: an old whole-award income row (source='grant', no gift_id, as
//      the edit path wrote it before GRANTS-FIX) plus a $10,000 payment on
//      the award reads $25,000 of Finance income. The dry run of
//      scripts/ops/mopup1-award-stamps.js lists the org's count and total and
//      changes nothing; --apply takes the row off (one audit row per org), so
//      income is $10,000; a second apply changes nothing; --undo puts it back.
//      A source='grant' row WITH a gift_id is never touched.
//   §2 at 9 PM Eastern, the dates Insights (a move's "Show again on"),
//      Finance (Add transaction) and the Deposit sheet fill in are the org's
//      day, not the UTC day after it.
//   §3 the Home move card has no "Ask" label over "Ask $…"; a $250 fund in a
//      $30,250 lifetime reads "under 1% of lifetime" (0% only for $0); a past
//      event left "upcoming" says Past, one today says Today, a canceled one
//      Canceled.
//
// What makes it fail: the script touching a row with a gift_id (§1 red); a
// date field back on toISOString().slice(0, 10) (§2 red after 8 PM Eastern);
// the label, the rounded "0%", or the stored status back on screen (§3 red).
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip, BASE } = require("./helpers");
const { civilDay, testNow } = require("./clock");

const APP = process.env.APP_URL || "http://localhost:4173";
const { DIST } = require("./lib/dist");
const { pinBrowserClockAt } = require("./lib/browserClock");
const ORG = "org_mopup1money", DECOY = "org_mopup1decoy";
const SEED = { id: "org_mopup1walk", slug: "mopup1walk", name: "Fernhollow Reading Circle (test)", tier: "small", n: 1, donors: 500, gifts: 2500, interactions: 300, tasks: 10, subs: 2, users: 1 };
const PASSWORD = "loadtest1234";
const C = v => Math.round(Number(v || 0) * 100);
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";

async function wipe(id) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  await q("SET session_replication_role = replica").catch(() => {});
  for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q("SET session_replication_role = origin").catch(() => {});
}
async function freshOrg(id, name) {
  await wipe(id);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
async function person(orgId, name, kind = "individual") {
  const id = "d_mop1_" + Math.random().toString(16).slice(2, 12);
  await q(`INSERT INTO donors (id,org_id,name,kind,created_by,created_by_name) VALUES ($1,$2,$3,$4,'system:test','Test')`, [id, orgId, name, kind]);
  return id;
}
// The row the old edit path wrote (stampGrantAward, server/grants/routes.js
// before LEDGER-2): the whole award as income, source='grant', grant_id set, no gift_id.
async function oldAwardStamp(orgId, grantId, amount, funder) {
  const [acct] = await q(`SELECT id FROM accounts WHERE org_id=$1 ORDER BY id LIMIT 1`, [orgId]);
  const id = "ft_mop1_" + Math.random().toString(16).slice(2, 12);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,grant_id,source,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,'income',$7,NULL,$8,'grant','u_test','Old edit path')`,
    [id, orgId, civilDay(), `Grant awarded: ${funder} · Reading Year (test)`, funder, amount, acct ? acct.id : null, grantId]);
  return id;
}

async function money() {
  let S = null;
  try { S = require("../scripts/ops/mopup1-award-stamps.js"); } catch (e) { /* main: no script */ }
  ok("§1 scripts/ops/mopup1-award-stamps.js exists", !!S);
  const tok = await freshOrg(ORG, "Ledger leftovers (test)");
  const funderName = "Kestrel Bay Foundation (test)";
  const funder = await person(ORG, funderName, "organization");
  const cg = await api("POST", "/grants", tok, { funder: funderName, program: "Reading Year (test)", amount: 15000, status: "applied" });
  const gid = cg.body && (cg.body.id || (cg.body.grant && cg.body.grant.id));
  await q(`UPDATE grants SET funder_donor_id=$1 WHERE id=$2 AND org_id=$3`, [funder, gid, ORG]);
  const income = async () => C(((await api("GET", "/finance/summary?yearMode=fiscal", tok)).body || {}).ytdRevenue);
  const i0 = await income();
  const aw = await api("PUT", `/grants/${gid}/award`, tok, { amountAwarded: "15000.00" });
  await oldAwardStamp(ORG, gid, 15000, funderName);
  const plan = (await api("GET", `/grants/${gid}/award-plan`, tok)).body || {};
  const pay = await api("POST", `/donors/${funder}/gifts`, tok, { amount: "10000.00", date: civilDay(), payment_method: "ACH / bank transfer", pledgeId: plan.pledge && plan.pledge.id });
  const i1 = await income();
  ok("§1 fixture: an old award stamp plus a $10,000 payment reads $25,000 of income (the double count)",
     aw.status === 200 && pay.status < 300 && i1 - i0 === 2500000, JSON.stringify({ aw: aw.status, pay: pay.status, grew: i1 - i0 }));

  // A gift's own booking that happens to say source='grant': never the script's.
  await wipe(DECOY);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Decoy (test)','mopup1-decoy',1,'active','team','America/New_York')`, [DECOY]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,grant_id,gift_id,source,created_by,created_by_name)
           VALUES ('ft_mop1_decoy',$1,$2,'A payment booked by its gift','Decoy funder',4000,'income','gr_mop1_decoy','g_mop1_decoy','grant','u_test','test')`, [DECOY, civilDay()]);
  if (!S) { ok("§1 the dry run, apply, second apply and undo (no script on this tree)", false); return; }

  const client = new Client({ connectionString: DB_URL, ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  await client.connect();
  const quiet = () => {};
  const audits = async () => (await q(`SELECT id, record_count, before_fields FROM fin_audit_log WHERE org_id=$1 AND request_path='scripts/ops/mopup1-award-stamps.js' ORDER BY created_at, id`, [ORG]));
  try {
    const lines = [];
    const dry = await S.run({ client, apply: false, orgId: ORG, log: l => lines.push(l) });
    const mine = dry.orgs.find(o => o.orgId === ORG) || {};
    ok("§1 the dry run lists the org's id, count and total, and changes nothing",
       mine.count === 1 && mine.cents === 1500000 && (await income()) === i1 && (await audits()).length === 0 && lines.some(l => l.includes(ORG) && l.includes("$15,000.00")),
       JSON.stringify({ mine, lines }));
    ok("§1 the dry run prints no names", !lines.some(l => /Kestrel|Decoy funder/.test(l)), lines);

    const a1 = await S.run({ client, apply: true, orgId: ORG, log: quiet });
    const au = await audits();
    ok("§1 --apply takes the stamp off: Finance income is the $10,000 that came in, not $25,000",
       a1.removed === 1 && (await income()) - i0 === 1000000, JSON.stringify({ removed: a1.removed, grew: (await income()) - i0 }));
    ok("§1 one audit row for the org, holding the row it removed",
       au.length === 1 && au[0].record_count === 1 && (au[0].before_fields.rows || []).length === 1 && au[0].before_fields.rows[0].source === "grant",
       JSON.stringify(au.map(a => a.record_count)));
    const plan2 = (await api("GET", `/grants/${gid}/award-plan`, tok)).body || {};
    ok("§1 the grant still reads $10,000 received of $15,000", plan2.receivedCents === 1000000 && plan2.outstandingCents === 500000,
       JSON.stringify({ rec: plan2.receivedCents, out: plan2.outstandingCents }));

    const a2 = await S.run({ client, apply: true, orgId: ORG, log: quiet });
    ok("§1 a second --apply changes nothing (no row, no audit row, same income)",
       a2.removed === 0 && (await audits()).length === 1 && (await income()) - i0 === 1000000, JSON.stringify({ removed: a2.removed }));

    const d = await S.run({ client, apply: true, orgId: DECOY, log: quiet });
    const decoy = await q(`SELECT id FROM fin_transactions WHERE id='ft_mop1_decoy'`);
    ok("§1 a source='grant' row with a gift_id is never touched", d.removed === 0 && decoy.length === 1, JSON.stringify({ removed: d.removed, left: decoy.length }));

    const u = await S.undo({ client, auditId: au[0].id, log: quiet });
    ok("§1 --undo puts the removed row back exactly ($25,000 again)", u.restored === 1 && (await income()) - i0 === 2500000, JSON.stringify({ u, grew: (await income()) - i0 }));
    await S.run({ client, apply: true, orgId: ORG, log: quiet });
    ok("§1 and --apply takes it off again", (await income()) - i0 === 1000000);
  } finally { await client.end(); }
}

// ── §3 the shared rules ───────────────────────────────────────────────────
async function rules() {
  let LS = null, ES = null;
  try { LS = await import("../shared/lifetimeShare.js"); } catch { /* main */ }
  try { ES = await import("../shared/eventStatus.js"); } catch { /* main */ }
  ok("§3 a $250 fund in a $30,250 lifetime reads \"under 1% of lifetime\"; $0 reads 0%; 40% reads 40%",
     !!LS && LS.lifetimeShareWords(25000, 3025000, 0) === "under 1% of lifetime" && LS.lifetimeShareWords(0, 3025000, 0) === "0% of lifetime"
       && LS.lifetimeShareWords(1210000, 3025000, 40) === "40% of lifetime",
     LS ? [LS.lifetimeShareWords(25000, 3025000, 0), LS.lifetimeShareWords(0, 3025000, 0)] : "no shared/lifetimeShare.js");
  const T = "2026-11-04";
  const st = ev => ES ? ES.eventStatus(ev, T).label : null;
  ok("§3 an event's status is its date: Past, Today, Upcoming; Canceled whatever the date",
     st({ status: "upcoming", date: "2026-10-01" }) === "Past" && st({ status: "upcoming", date: T }) === "Today"
       && st({ status: "upcoming", date: "2026-12-01" }) === "Upcoming" && st({ status: "cancelled", date: "2026-10-01" }) === "Canceled",
     ES ? ["2026-10-01", T, "2026-12-01"].map(date => st({ status: "upcoming", date })) : "no shared/eventStatus.js");
}

// 9 PM Eastern on the run's day: the UTC day is already tomorrow.
function ninePmEastern() {
  const day = civilDay(testNow(), "America/New_York");
  for (const h of [1, 2]) {   // 9 PM EDT = 01:00Z next day, EST = 02:00Z
    const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1, h);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(t));
    if (Number(parts) === 21) return { at: t, day };
  }
  throw new Error("no 9 PM Eastern");
}
const plusDays = (day, n) => { const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)); return d.toISOString().slice(0, 10); };

async function walk(chromium) {
  await wipe(SEED.id);
  const seedMany = require("../scripts/load/seed-many.js");
  await seedMany.seedOrg(SEED, bcrypt.hashSync(PASSWORD, 4));
  await seedMany.pool.query("ANALYZE donors; ANALYZE gifts");
  await seedMany.pool.end();
  await q(`UPDATE orgs SET giving_level_mid_cents = 50000, giving_level_major_cents = 150000 WHERE id = $1`, [SEED.id]);
  const auth = (await api("POST", "/auth/login", null, { email: `admin@${SEED.slug}.load`, password: PASSWORD })).body || {};
  const tok = auth.token;
  const { at, day } = ninePmEastern();

  // A person with $250 on one fund and $30,000 on another.
  const pid = await person(SEED.id, "Odalys Brightwater (test)");
  const fund = "fd_mop1_" + Math.random().toString(16).slice(2, 10);
  await q(`INSERT INTO fin_funds (id, org_id, name, restricted) VALUES ($1,$2,'Library Corner (test)',true)`, [fund, SEED.id]);
  const g1 = await api("POST", `/donors/${pid}/gifts`, tok, { amount: "250.00", date: plusDays(day, -40), type: "cash", payment_method: "check", fund_id: fund });
  const g2 = await api("POST", `/donors/${pid}/gifts`, tok, { amount: "30000.00", date: plusDays(day, -30), type: "cash", payment_method: "check" });
  // Three events left "upcoming": last month, today, and one canceled.
  const ev = {};
  for (const [k, date] of [["past", plusDays(day, -20)], ["today", day], ["canceled", plusDays(day, -10)]]) {
    const r = await api("POST", "/events", tok, { name: `Fernhollow ${k} night (test)`, eventType: "gala", date });
    ev[k] = r.body && (r.body.id || (r.body.event && r.body.event.id));
  }
  await q(`UPDATE events SET status='cancelled' WHERE id=$1 AND org_id=$2`, [ev.canceled, SEED.id]);
  await q(`UPDATE events SET status='upcoming' WHERE org_id=$1 AND id = ANY($2::text[])`, [SEED.id, [ev.past, ev.today]]);
  ok("walk fixture: two gifts and three events", g1.status < 300 && g2.status < 300 && ev.past && ev.today && ev.canceled, JSON.stringify({ g1: g1.status, g2: g2.status, ev }));
  await fetch(BASE + "/insights?view=deck", { headers: { Authorization: "Bearer " + tok } }).then(r => r.json()).catch(() => null);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  // The page's clock: 9 PM Eastern on the run's day, ticking.
  await pinBrowserClockAt(ctx, at, testNow());
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [tok, JSON.stringify(auth.user), JSON.stringify(auth.org || {})]);
  const page = await ctx.newPage();
  try {
    // §2 Finance: Add transaction, then the Deposit sheet.
    await page.goto(APP + "/app/finance", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const clock = await page.evaluate(() => Date().toString()).catch(() => null);
    await page.getByText("Transactions", { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
    await page.getByRole("button", { name: /\+ Add transaction/ }).first().click({ timeout: 15000 }).catch(() => {});
    const fin = await page.locator('input[type="date"]').first().inputValue({ timeout: 8000 }).catch(() => null);
    ok(`§2 Finance's Add transaction fills in the org's day at 9 PM Eastern (${day})`, fin === day, JSON.stringify({ fin, day, clock }));
    await page.keyboard.press("Escape").catch(() => {});
    await page.goto(APP + "/app/finance", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.getByText("Deposits and payouts", { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
    await page.locator('[data-fin-part="deposits"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.locator('[data-testid="fin-open-deposit-sheet"]').first().click({ timeout: 15000 }).catch(() => {});
    const dep = await page.locator('input[aria-label="Deposit date"]').first().inputValue({ timeout: 8000 }).catch(() => null);
    ok(`§2 the Deposit sheet fills in the org's day at 9 PM Eastern (${day})`, dep === day, JSON.stringify({ dep, day }));

    // §2 + §3 Home's move card: "Show again on" is two weeks from the org's day; no "Ask" over "Ask $…".
    await page.goto(APP + "/dashboard", { waitUntil: "load", timeout: 30000 }).catch(() => {});
    await page.waitForSelector('[data-testid="move-card"]', { timeout: 30000 }).catch(() => {});
    const cards = await page.locator('[data-testid="move-card"]').count();
    let askChecked = 0; const doubled = [];
    for (let i = 0; i < Math.min(cards, 12); i++) {
      const card = page.locator('[data-testid="move-card"]').nth(i);
      const ask = card.locator('[data-testid="move-ask"]');
      if (!(await ask.count())) continue;
      const box = await ask.first().evaluate(b => ({ words: b.textContent, above: (b.parentElement && b.parentElement.textContent || "").slice(0, (b.parentElement.textContent || "").indexOf(b.textContent)) })).catch(() => null);
      if (!box) continue;
      askChecked++;
      if (/^Ask\b/.test(box.words) && /Ask/.test(box.above)) doubled.push(box.above + "|" + box.words);
    }
    ok(`§3 no move card shows an "Ask" label over "Ask $…" (${askChecked} asks read)`, askChecked > 0 && doubled.length === 0, doubled.slice(0, 3));
    await page.locator('[data-testid="move-not-now"]').first().click({ timeout: 8000 }).catch(() => {});
    const until = await page.locator("#move-until").first().evaluate(i => ({ value: i.value, min: i.min })).catch(() => null);
    ok(`§2 Insights' "Show again on" is two weeks from the org's day, and no earlier than it, at 9 PM Eastern (${day})`,
       !!until && until.value === plusDays(day, 14) && until.min === day, JSON.stringify({ until, want: [plusDays(day, 14), day] }));

    // §3 the profile's "What they support".
    await page.goto(APP + `/donors/${pid}?tab=giving`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.locator('[role="tab"][data-tab="giving"]').first().click({ timeout: 15000 }).catch(() => {});
    await page.waitForSelector('text=What they support', { timeout: 20000 }).catch(() => {});
    const shares = await page.locator("text=/of lifetime/").allTextContents().catch(() => []);
    ok("§3 $250 of a $30,250 lifetime reads \"under 1% of lifetime\", never \"0% of lifetime\"",
       shares.some(s => /under 1% of lifetime/.test(s)) && !shares.some(s => /^\s*0% of lifetime/.test(s)), shares);

    // §3 the event list and an event's own page.
    await page.goto(APP + "/app/events", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.getByRole("button", { name: /^All$/ }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const badge = async name => page.locator(`text=${name}`).first().evaluate(el => {
      let n = el; for (let i = 0; i < 8 && n; i++, n = n.parentElement) { const b = n.querySelector && n.querySelector("span[style*='border-radius: 99px'], span[style*='border-radius:99px'], [data-testid='event-status']"); if (b) return b.textContent.trim(); }
      return null;
    }).catch(() => null);
    const seen = { past: await badge("Fernhollow past night (test)"), today: await badge("Fernhollow today night (test)"), canceled: await badge("Fernhollow canceled night (test)") };
    ok("§3 the event list: last month's event left \"upcoming\" says Past, today's says Today, the canceled one Canceled",
       /^past$/i.test(seen.past || "") && /^today$/i.test(seen.today || "") && /^cancel+ed$/i.test(seen.canceled || ""), JSON.stringify(seen));
  } finally { await browser.close(); }
}

async function main() {
  await money();
  await rules();
  let chromium = null;
  const distOk = fs.existsSync(path.join(DIST, "index.html"));
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); } catch { /* none */ }
  if (!chromium || !distOk) browserLegOrSkip(!chromium ? "Playwright not found" : "client/dist not built");
  else await walk(chromium);
  summary();
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());
