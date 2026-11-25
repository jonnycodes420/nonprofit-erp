// tests/connect2/honest.js: HONEST-1. A CONNECTION ONLY SAYS CONNECTED WHEN SOMETHING IS
// FLOWING, AND A QUIET FEED RAISES ITS HAND.
//
//   §1  Every card on GET /connections carries one `flow` from server/connections/status.js, and
//       the page's summary is counted from those flows. Stripe with its giving pages off reads
//       "Connected, but giving pages are off, so no one can give yet."; QuickBooks reads what is
//       waiting (count and dollars equal to /qbo/pending) and the fund that holds it back; a
//       Givebutter silent past its own rhythm needs you, in the one quiet sentence.
//   §2  The badge, the Settings line, Home and Finance all READ `flow`: the Settings card's state,
//       the detail's badge and sentence, Home's line and Finance's QuickBooks line draw from it,
//       and none recomputes a status (source checks).
//   §3  A feed past its usual gap creates exactly ONE task for the admin, however often the sweep
//       runs, and no email; the sweep is scheduled, for live orgs.
//   §4  A source's History includes the check its status names (same day as last_synced_at).
//   §5  "Tell us you need it" records one ask per org and provider; a made-up provider is refused.
//
// HOW IT GOES RED (run against main first): main's cards carry no `flow` (§1, §2), nothing
// schedules sweepQuietConnections (§3), History reads only import runs and says "not checked"
// under a status that names a check (§4), and POST /connections/ask does not exist (§5).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { testNow } = require("../clock");

const ORG = "org_c2hon";
const ADMIN = "admin@c2hon-fixture.org";
const ROOT = path.join(__dirname, "..", "..");
const TABLES = ["tasks", "gifts", "giving_sources", "bookkeeping_connections", "gift_bookkeeping_syncs", "donors",
                "fin_funds", "imports", "connection_asks", "users"];
const civil = ms => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;

async function reset(q) {
  for (let i = 0; i < 6; i++) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false);
    if (gone) return;
    await new Promise(r => setTimeout(r, 300));
  }
}

async function run({ ok, login, api, q }) {
  const now = testNow();
  await reset(q);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,qbo_sync_enabled,run_background_work)
           VALUES ($1,'Honest Fixture Trust','honest-fixture-trust',1,'active','team',true,true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_c2hon',$1,$2,$3,'Hon Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_hon_gen',$1,'General',false),('ff_hon_bld',$1,'Building',true)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,created_by,created_by_name)
           VALUES ('d_hon_1',$1,'Wren Talbot','wren@c2hon-fixture.org','active','system:test','honest suite')`, [ORG]);
  // Givebutter: one gift every 7 days, the last one 40 days ago (a rhythm of 7, so quiet after 21).
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,last_synced_at,created_by,created_by_name)
           VALUES ('gs_hon_gb',$1,'givebutter','Givebutter','active',$2,'system:test','honest suite'),
                  ('gs_hon_stripe',$1,'stripe','Stripe','active',$2,'system:test','honest suite')`, [ORG, new Date(now - 2 * DAY)]);
  for (let i = 0; i < 8; i++)
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,giving_source_id,created_by,created_by_name)
             VALUES ($1,$2,'d_hon_1',25,$3,'online','ff_hon_gen','gs_hon_gb','system:test','honest suite')`,
      ["g_hon_gb" + i, ORG, civil(now - (40 + 7 * i) * DAY)]);
  // Stripe's history, read in; the giving pages are NOT set up (no stripe_account_id on the org).
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,giving_source_id,stripe_payment_id,created_by,created_by_name)
           VALUES ('g_hon_st',$1,'d_hon_1',40,$2,'online','ff_hon_gen','gs_hon_stripe','pi_hon_1','system:test','honest suite')`, [ORG, civil(now - 2 * DAY)]);
  // QuickBooks: connected, nothing ever sent, the Building fund has no income account.
  const start = civil(now - 120 * DAY);
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ('bk_hon_qbo',$1,'quickbooks','active','realm_hon',$2::jsonb,'system:test','honest suite')`,
    [ORG, JSON.stringify({ qbo: { mode: "salesreceipt", startDate: start, realmId: "realm_hon",
      depositAccount: { id: "4", name: "Undeposited Funds" }, funds: { ff_hon_gen: { accountId: "79", accountName: "Contributions" } } } })]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,created_by,created_by_name)
           VALUES ('g_hon_bld',$1,'d_hon_1',500.5,$2,'check','ff_hon_bld','system:test','honest suite')`, [ORG, civil(now - 5 * DAY)]);
  const tok = await login(ADMIN);

  // ── §1 · one flow per card ────────────────────────────────────────────────
  const r = await api("GET", "/connections", tok);
  const cards = (r.body && r.body.cards) || [];
  const by = p => cards.find(c => c.provider === p && (c.connected || p === "xero")) || cards.find(c => c.provider === p);
  ok("§1 every card carries one flow with a state, a label and a sentence",
    cards.length > 5 && cards.every(c => c.flow && c.flow.state && c.flow.label && typeof c.flow.sentence === "string"),
    cards.filter(c => !c.flow).map(c => c.id));
  const stripe = cards.find(c => c.kind === "own_stripe");
  ok("§1 Stripe with the giving pages off is not Working: it says no one can give yet, with the step",
    stripe && stripe.flow.state === "waiting" && stripe.flow.sentence === "Connected, but giving pages are off, so no one can give yet."
      && stripe.flow.step && stripe.flow.step.label === "Turn on giving pages", stripe && stripe.flow);
  const gb = by("givebutter");
  ok("§1 Givebutter silent 40 days against a 7-day rhythm needs you, in the one quiet sentence",
    gb && gb.flow.state === "needs_you" && gb.flow.sentence === "Givebutter hasn't sent a gift in 40 days. Usually about 1 a week."
      && gb.flow.step && gb.flow.step.label === "Check it", gb && gb.flow);
  const qb = by("quickbooks");
  const pend = await api("GET", "/qbo/pending", tok);
  ok("§1 QuickBooks says what is waiting and the fund that holds it back, from the Pending definition",
    qb && qb.flow.state === "waiting" && pend.status === 200
      && qb.flow.sentence === `${pend.body.count} gifts ($${(pend.body.total.cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}) are waiting: 1 fund isn't mapped yet (Building).`
      && qb.flow.figure && qb.flow.figure.source && qb.flow.figure.source.key === "qbo-pending", { flow: qb && qb.flow, pending: pend.body && pend.body.count });
  const counts = r.body.flowCounts || {};
  const n = s => cards.filter(c => c.flow.state === s).length;
  ok("§1 the summary is counted from the same flows", counts.working === n("working") && counts.waiting === n("waiting") && counts.needs_you === n("needs_you")
    && /Givebutter/.test(r.body.flowSentence || ""), { counts, flowSentence: r.body.flowSentence });

  // ── §2 · every surface reads flow; none recomputes it ─────────────────────
  const src = f => fs.readFileSync(path.join(ROOT, f), "utf8");
  const conn = src("client/src/components/Connections.jsx");
  const parts = src("client/src/components/connections/flowParts.jsx");
  ok("§2 the Settings card's state is the card's flow", /const statusOf = c => c\.flow \? c\.flow\.state/.test(conn));
  ok("§2 the detail's badge and sentence are the flow's", /c\.flow \? c\.flow\.label/.test(conn) && /c\.flow \? <FlowSentence flow=\{c\.flow\}/.test(conn));
  ok("§2 Home and Finance draw ConnectionLines, which reads the same GET /connections flows",
    /<ConnectionLines onNavigate=\{onNavigate\}\/>/.test(src("client/src/components/home/sectionStack.jsx"))
      && /<ConnectionLines[^>]*providers=\{\["quickbooks"\]\}/.test(src("client/src/components/Finance.jsx"))
      && /apiFetch\("\/connections"\)[\s\S]{0,300}c\.flow && states\.includes\(c\.flow\.state\)/.test(parts));

  // ── §3 · one task, scheduled, no email ────────────────────────────────────
  const s1 = await api("POST", "/connections/sweep", tok, { notify: false });
  const s2 = await api("POST", "/connections/sweep", tok, { notify: false });
  const tasks = await q(`SELECT title FROM tasks WHERE org_id=$1`, [ORG]);
  ok("§3 a feed past its usual gap opens exactly one task, in the one quiet sentence, however often the sweep runs",
    s1.status === 200 && s2.status === 200 && tasks.length === 1 && tasks[0].title === gb.flow.sentence, tasks);
  ok("§3 …and nothing is emailed", s1.body && s1.body.emailed === 0 && s2.body && s2.body.emailed === 0, [s1.body, s2.body]);
  ok("§3 the sweep is scheduled, for live orgs, with no email",
    /every\("sweepQuietConnections"[^\n]*sweepQuietConnections\(\{ live: true, notify: false \}\)/.test(src("routes/jobs.js")));

  // ── §4 · History reads the status's own check ─────────────────────────────
  const log = await api("GET", "/connections/gs_hon_gb/log", tok);
  ok("§4 a source checked with no run kept still shows that check, on the status's day",
    log.status === 200 && log.body.lines.length >= 1 && log.body.lines[0].ok === true && log.body.lines[0].at === civil(now - 2 * DAY), log.body);

  // ── §5 · the ask ──────────────────────────────────────────────────────────
  const a1 = await api("POST", "/connections/ask", tok, { provider: "xero" });
  const a2 = await api("POST", "/connections/ask", tok, { provider: "xero" });
  const bad = await api("POST", "/connections/ask", tok, { provider: "made_up_tool" });
  const asks = await q(`SELECT created_by, created_by_name FROM connection_asks WHERE org_id=$1`, [ORG]);
  ok("§5 the ask is recorded once per org and provider, with its actor, and a made-up provider is refused",
    a1.status === 200 && a1.body.already === false && a2.status === 200 && a2.body.already === true && bad.status === 400
      && asks.length === 1 && asks[0].created_by === "u_c2hon" && asks[0].created_by_name, { a1: a1.body, a2: a2.body, bad: bad.status, rows: asks });

  await reset(q);
}

module.exports = { run };
