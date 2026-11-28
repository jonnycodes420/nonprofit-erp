// tests/connect2/honest4.js: HONEST-4. EVERY CONNECTION PROVES ITSELF WITH ITS LAST REAL ACTIVITY.
// A part of connect2-sources (the integrations suite): the build's one new test, guarding what a
// person is told about their donors' money coming in.
//
//   §1  NO EXAMPLE OR STALE CONNECTION SAYS CONNECTED. A source whose every row is a sample, a demo
//       org's source, and a source quiet past its own rhythm can't show Connected on the card, the
//       panel (the same card object) or the public status page, even with a passing check an hour
//       ago. An example is "Example data" and is in no count of connections.
//   §2  THE PROOF. Each card says its last real activity in words ("Last gift read Nov 26, 2:14 PM")
//       and what moved in 30 days; a 30-day count that moved since the last check says why.
//   §3  QUICKBOOKS PAUSES. Three failed tries in a row pause the hourly auto-sync; the card leads with
//       "Needs attention: paused after 3 failed tries on …"; the auto-sync is refused, a person's
//       Try again clears it. The headline is the waiting count and dollars, each reason a link.
//   §4  THE CARD UPDATER SHOWS ITS WORK: each recurring gift's card line says when and by whom.
//   §5  A STORED QUIET SENTENCE (the task) names a date, never a count of days that drifts.
//
// HOW IT GOES RED (planted and seen red on main and on planted defects): on main there is no proof,
// no example badge (a sample-only source with a passing check reads Connected), the status page's
// line is "up" with nothing real behind it, nothing pauses, and the roster has no card line.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { testNow } = require("../clock");

const ORG = "org_c2hon4", DEMO = "org_c2hon4demo";
const ADMIN = "admin@c2hon4-fixture.org", DEMO_ADMIN = "admin@c2hon4demo-fixture.org";
const ROOT = path.join(__dirname, "..", "..");
const TABLES = ["connection_checks", "gifts", "giving_sources", "bookkeeping_connections", "recurring_subscriptions",
  "payment_recovery_events", "donors", "fin_funds", "users"];
const HOUR = 3600000, DAY = 86400000;
const civil = ms => new Date(ms).toISOString().slice(0, 10);

async function reset(q) {
  for (const o of [ORG, DEMO]) for (let i = 0; i < 6; i++) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [o]).then(() => true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 300));
  }
}

async function run({ ok, login, api, q }) {
  const now = testNow();
  await reset(q);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,qbo_sync_enabled)
           VALUES ($1,'Honest Four Rowing','honest-four-rowing',1,'active','team','UTC',true)`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind,timezone)
           VALUES ($1,'Honest Four Demo','honest-four-demo',1,'active','team','demo','UTC')`, [DEMO]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_c2hon4',$1,$2,$3,'Hon Four','admin'),('u_c2hon4d',$4,$5,$3,'Hon Four Demo','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10), DEMO, DEMO_ADMIN]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_h4_gen',$1,'General',false),('ff_h4_bld',$1,'Building',true)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,created_by,created_by_name) VALUES
           ('d_h4_1',$1,'Ivo Brennan','ivo@c2hon4-fixture.org','active','system:test','honest4 suite'),
           ('d_h4_d',$2,'Demo Person','demo@c2hon4demo-fixture.org','active','system:test','honest4 suite')`, [ORG, DEMO]);
  // Three sources, each holding a (made-up) sealed sign-in, each read an hour ago:
  //   PayPal     real gifts, the last read two hours ago       → Connected, with its proof
  //   Zeffy      every row a sample                            → Example data, never Connected
  //   Givebutter real weekly gifts, the last one 40 days ago   → quiet past its rhythm: never Connected
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,credentials_sealed,last_synced_at,created_by,created_by_name) VALUES
           ('gs_h4_pp',$1,'paypal','PayPal','active','v1.sealed-fixture',$2,'system:test','honest4 suite'),
           ('gs_h4_zf',$1,'zeffy','Zeffy','active','v1.sealed-fixture',$2,'system:test','honest4 suite'),
           ('gs_h4_gb',$1,'givebutter','Givebutter','active','v1.sealed-fixture',$2,'system:test','honest4 suite'),
           ('gs_h4_dpp',$3,'paypal','PayPal','active','v1.sealed-fixture',$2,'system:test','honest4 suite')`, [ORG, new Date(now - HOUR), DEMO]);
  const gift = (id, org, src, amt, day, { sample = false, made = now - 2 * HOUR, refundOf = null } = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,giving_source_id,is_sample,refund_of,created_at,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,'online',$6,$7,$8,$9,$10,'system:test','honest4 suite')`,
    [id, org, org === DEMO ? "d_h4_d" : "d_h4_1", amt, day, org === DEMO ? null : "ff_h4_gen", src, sample, refundOf, new Date(made)]);
  for (let i = 0; i < 5; i++) await gift("g_h4_pp" + i, ORG, "gs_h4_pp", 30, civil(now - (1 + 5 * i) * DAY), { made: now - (2 * HOUR) - i * DAY });
  for (let i = 0; i < 3; i++) await gift("g_h4_zf" + i, ORG, "gs_h4_zf", 20, civil(now - (2 + i) * DAY), { sample: true, made: now - 3 * HOUR });
  for (let i = 0; i < 8; i++) await gift("g_h4_gb" + i, ORG, "gs_h4_gb", 25, civil(now - (40 + 7 * i) * DAY), { made: now - (40 + 7 * i) * DAY });
  await gift("g_h4_dpp", DEMO, "gs_h4_dpp", 50, civil(now - DAY), { made: now - 90 * 60000 });
  const pass = (org, id, seen = 5) => q(
    `INSERT INTO connection_checks (org_id,card_key,checked_at,ok,reasons,counts,created_by,created_by_name)
     VALUES ($1,$2,$3,true,'[]'::jsonb,$4::jsonb,'system:test','honest4 suite')`, [org, id, new Date(now - 90 * 60000), JSON.stringify({ seen })]);
  for (const id of ["gs_h4_pp", "gs_h4_zf", "gs_h4_gb"]) await pass(ORG, id);
  await pass(DEMO, "gs_h4_dpp");
  const tok = await login(ADMIN), dtok = await login(DEMO_ADMIN);
  const body = async t => (await api("GET", "/connections", t)).body || {};
  const r = await body(tok), d = await body(dtok);
  const card = (b, id) => (b.cards || []).find(c => c.id === id);
  const pp = card(r, "gs_h4_pp"), zf = card(r, "gs_h4_zf"), gb = card(r, "gs_h4_gb"), dpp = card(d, "gs_h4_dpp");

  // ── §1 · no example or stale connection says Connected ─────────────────────
  ok("§1 a real source with a sign-in, a passing check an hour ago and gifts read today: Connected", pp && pp.badge.state === "connected", pp && pp.badge);
  ok("§1 a source whose every row is a sample can't show Connected: Example data, whatever its check said",
    zf && zf.badge.state === "example" && zf.badge.label === "Example data" && zf.example === true && zf.proof && zf.proof.example === true, zf && { badge: zf.badge, proof: zf.proof });
  ok("§1 a demo org's source can't show Connected: Example data", dpp && dpp.badge.state === "example" && dpp.badge.state !== "connected", dpp && dpp.badge);
  ok("§1 a source quiet past its own rhythm can't show Connected, even with a passing check an hour ago",
    gb && gb.badge.state === "attention" && /^nothing in 40 days/.test(gb.badge.reason || ""), gb && gb.badge);
  const n = (b, s) => (b.cards || []).filter(c => c.flow && c.flow.state === s && !c.example).length;
  ok("§1 an example is in no count of connections: the summary leaves out Zeffy and every demo card",
    r.flowCounts && r.flowCounts.working === n(r, "working") && d.flowCounts && d.flowCounts.working === 0 && d.flowCounts.needs_you === 0, { real: r.flowCounts, demo: d.flowCounts });
  const CK = require(path.join(ROOT, "server", "connections", "checks.js"));
  ok("§1 the badge function itself: example or quiet is never Connected, over a check 1 hour old",
    CK.badgeOf({ connected: true, kind: "source" }, { checks: [{ at: new Date(now - HOUR).toISOString(), ok: true }], now, example: true }).state === "example"
    && CK.badgeOf({ connected: true, kind: "source", status: "quiet", silentDays: 30 }, { checks: [{ at: new Date(now - HOUR).toISOString(), ok: true }], now }).state === "attention"
    && CK.badgeOf({ connected: true, kind: "source" }, { checks: [{ at: new Date(now - HOUR).toISOString(), ok: true }], now }).state === "connected");
  const PF = require(path.join(ROOT, "server", "connections", "proof.js"));
  const up = { state: "up", detail: null };
  ok("§1 the public status page reads the same rule: no real connection, or nothing real in 14 days, is never Working",
    PF.publicLine(up, { held: 0, at: null }, { noun: "Stripe", now }).state === "unknown"
    && PF.publicLine(up, { held: 2, at: new Date(now - 20 * DAY).toISOString() }, { noun: "Stripe", now }).state === "unknown"
    && PF.publicLine(up, { held: 2, at: new Date(now - DAY).toISOString() }, { noun: "Stripe", now }).state === "up"
    && /^Last real gift read /.test(PF.publicLine(up, { held: 2, at: new Date(now - DAY).toISOString() }, { noun: "Stripe", now }).detail));
  const qq = (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), args); };
  const plat = await PF.platformActivity(qq);
  const fake = plat && plat.sources && plat.sources.at ? await q(
    `SELECT 1 FROM gifts g JOIN orgs o ON o.id=g.org_id WHERE g.created_at = $1::timestamptz AND (o.org_kind='demo' OR g.is_sample)`, [plat.sources.at]) : [];
  ok("§1 the platform's real activity never counts a demo org's or a sample row, and finds the real one",
    plat && plat.sources.held >= 3 && !!plat.sources.at && !fake.length, plat);

  // ── §2 · the proof, from the connection's own rows ─────────────────────────
  const stamp = PF.stampWords(new Date(now - 2 * HOUR).toISOString(), "UTC");
  ok("§2 the card says its last real activity in words, and what moved in 30 days",
    pp && pp.proof && pp.proof.lastWords === `Last gift read ${stamp}` && /^\w{3} \d+, \d+:\d\d [AP]M$/.test(stamp)
    && pp.proof.moved30.records === 5 && pp.proof.moved30.words === "5 gifts, $150.00 in the last 30 days", pp && pp.proof);
  ok("§2 an example's proof says it is example data, never a last activity", zf && zf.proof.last === null && zf.proof.lastWords === PF.EXAMPLE_SENTENCE, zf && zf.proof);
  // A refund recorded after the last check (which saw 5): the 30-day count moved, and says why.
  await gift("g_h4_ppr", ORG, "gs_h4_pp", -30, civil(now), { made: now - 10 * 60000, refundOf: "g_h4_pp0" });
  await q(`DELETE FROM gifts WHERE id='g_h4_pp4'`);
  const pp2 = card(await body(tok), "gs_h4_pp");
  ok("§2 a 30-day count that moved since the last check says why", pp2 && /^Down from 5 at the \w{3} \d+ check: .*1 refund recorded/.test(pp2.proof.moved30.why || ""), pp2 && pp2.proof);

  // ── §3 · QuickBooks pauses rather than piles up ────────────────────────────
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ('bk_h4_qbo',$1,'quickbooks','active','realm_h4',$2::jsonb,'system:test','honest4 suite')`,
    [ORG, JSON.stringify({ qbo: { mode: "salesreceipt", startDate: civil(now - 90 * DAY), realmId: "realm_h4",
      depositAccount: { id: "4", name: "Undeposited Funds" }, funds: { ff_h4_gen: { accountId: "79", accountName: "Contributions" } } } })]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,created_by,created_by_name)
           VALUES ('g_h4_bld',$1,'d_h4_1',120,$2,'check','ff_h4_bld','system:test','honest4 suite')`, [ORG, civil(now - 3 * DAY)]);
  const PZ = require(path.join(ROOT, "server", "finance", "qboPause.js"));
  const conn = { id: "bk_h4_qbo" };
  const fail = [{ giftId: "g_h4_bld", status: "failed" }];
  for (let i = 0; i < 2; i++) await PZ.afterRun({ run: qq }, conn, { results: fail });
  const [mid] = await q(`SELECT sync_paused_at, sync_fail_streak FROM bookkeeping_connections WHERE id='bk_h4_qbo'`);
  ok("§3 two failed tries count, and don't pause yet", mid && mid.sync_fail_streak === 2 && mid.sync_paused_at === null, mid);
  await PZ.afterRun({ run: qq }, conn, { results: fail });
  const qb = card(await body(tok), "bk_h4_qbo");
  ok("§3 the third failed try in a row pauses: the card leads with Needs attention: paused after 3 failed tries on …",
    qb && /^Needs attention: paused after 3 failed tries on \w{3} \d+\.$/.test(((qb.flow && qb.flow.fixes) || [])[0] && qb.flow.fixes[0].words) && qb.flow.state === "needs_you"
    && qb.flow.step && qb.flow.step.label === "Try again" && qb.badge.state !== "connected", qb && qb.flow);
  ok("§3 the headline is the waiting count and dollars, then each reason as a link to its fix",
    qb && /^\d+ gifts? \(\$[\d,]+\.\d\d\) waiting\.$/.test(qb.flow.head || "") && qb.flow.fixes.some(f => f.anchor === "qbo-auto" && f.words === "Auto-sync is off.")
    && qb.flow.fixes.some(f => f.anchor === "qbo-map-open" && f.words === "1 fund isn't mapped (Building)."), qb && qb.flow);
  const sys = await PZ.beforeRun({ query: qq, run: qq }, conn, { id: "system:qbo/auto-sync" });
  ok("§3 the hourly auto-sync never runs over a pause", sys.ok === false && /paused after 3 failed tries/.test(sys.paused.sentence), sys);
  const person = await PZ.beforeRun({ query: qq, run: qq }, conn, { id: "u_c2hon4", name: "Hon Four" });
  const [after] = await q(`SELECT sync_paused_at, sync_fail_streak FROM bookkeeping_connections WHERE id='bk_h4_qbo'`);
  ok("§3 a person's Try again clears it", person.ok === true && person.resumed === true && after.sync_paused_at === null && after.sync_fail_streak === 0, after);
  ok("§3 the engine checks the pause before it sends and counts each try after (qboSync.syncGifts)",
    /PAUSE\.beforeRun\(\{ query, run \}, conn, who\)/.test(require("fs").readFileSync(path.join(ROOT, "qboSync.js"), "utf8"))
    && /PAUSE\.afterRun\(\{ run \}, conn, \{ results, threw \}\)/.test(require("fs").readFileSync(path.join(ROOT, "qboSync.js"), "utf8")));

  // ── §4 · the card updater shows its work ───────────────────────────────────
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,card_brand,card_last4)
           VALUES ('rs_h4_1',$1,'d_h4_1','sub_h4_1',25,'month','active','visa','4242'),('rs_h4_2',$1,'d_h4_1','sub_h4_2',10,'month','active','mastercard','0005')`, [ORG]);
  await q(`INSERT INTO payment_recovery_events (id,org_id,donor_id,subscription_id,type,stripe_event_id,detail,created_at) VALUES
           ('pre_h4_1',$1,'d_h4_1','sub_h4_1','card_auto_updated','evt_h4_1','{"last4":"4242"}'::jsonb,$2),
           ('pre_h4_2',$1,'d_h4_1','sub_h4_2','card_updated','evt_h4_2','{}'::jsonb,$3)`, [ORG, new Date(Date.UTC(2026, 10, 3, 15)), new Date(Date.UTC(2026, 9, 2, 15))]);
  const roster = await api("GET", "/recurring/roster", tok);
  const line = id => (((roster.body && roster.body.subs) || []).find(s => s.id === id) || {}).cardLine;
  ok("§4 each recurring gift's card line says when it was last updated and by whom",
    line("rs_h4_1") && line("rs_h4_1").words === "Visa ending 4242 · updated by the bank Nov 3, 2026"
    && line("rs_h4_2") && line("rs_h4_2").words === "Mastercard ending 0005 · updated by the donor Oct 2, 2026", { a: line("rs_h4_1"), b: line("rs_h4_2") });

  // ── §5 · a stored quiet sentence names a date ──────────────────────────────
  const ST = require(path.join(ROOT, "server", "connections", "status.js"));
  ok("§5 the task's sentence names the day it went quiet; the live one counts from today",
    ST.quietSentence({ label: "Givebutter", silentDays: 69, lastDate: "2026-09-20", stored: true }) === "Givebutter hasn't sent a gift since Sep 20, 2026."
    && ST.quietSentence({ label: "Givebutter", silentDays: 69, lastDate: "2026-09-20" }) === "Givebutter hasn't sent a gift in 69 days."
    && /stored: true/.test(require("fs").readFileSync(path.join(ROOT, "server", "boot", "helpers-1.js"), "utf8")));
  await reset(q);
}

module.exports = { run };
