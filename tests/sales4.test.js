// tests/sales4.test.js · SALES-4: the sales CRM says what's next, logs itself, and fills itself
// with leads. One section per guard; the screens (Now, the board, the deal header) are walked by eye.
//
// THE PLANTED DEFECTS (set SALES4_PLANT on the SERVER and on THIS process, with TEST_MODE=1; each
// turns its section red):
//   rankdue      Now ranks due rows by score, so a cold lead sits above a due follow-up    → §1
//   outlookcase  an Outlook email from a sales contact (mixed-case address) is not logged  → §2
//   nomove       a new calendar meeting with a sales contact leaves the deal's stage       → §2
//   noundo       a board drag answers with no Undo                                         → §3
//   dupe         a ProPublica result is added twice (no EIN match)                         → §5
//   send         accepting a next step emails the prospect                                  → §6
//
// Made-up fixtures only. Nothing is sent: §6 watches every outbound request this process makes
// while the sales modules run. The suite sets its own clock (tests/clock.js).
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const { testNow } = require("./clock");
const TODAY = require("../server/admin/sales/today");
const REC = require("../server/admin/sales/records");
const LINKS = require("../server/admin/sales/links");
const ACT = require("../server/admin/sales/activities");
const MAIL = require("../server/admin/sales/email");
const CAL = require("../server/admin/sales/calendar");
const NOW = require("../server/admin/sales/now");

const PASS = "loadtest1234";
const HOME = "org_sales4home";
const SUPER = "sales4-super@example.org";
const OWN = "seller@sales4.example.org";
const TZ = "America/New_York";
const DAY = 86400000;
const qq = (sql, p = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), p); };
// run() reports the rows an UPDATE changed, as the server's own does.
let _pool = null;
function rawPool() { if (!_pool) { const { Pool } = require("pg"); _pool = new Pool({ connectionString: DB_URL, ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } }); } return _pool; }
const ctx = { query: qq, run: async (sql, p = []) => { let i = 0; const r = await rawPool().query(sql.replace(/\?/g, () => "$" + (++i)), p); return { changes: r.rowCount }; } };
const WHO = { id: "u_sales4_super", name: "Sales4 Super" };
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);

async function wipeOrg(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function wipeSales() {
  const t = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  for (const x of t) await q(`DELETE FROM "${x}"`);
}
const stageId = async name => (await q(`SELECT id FROM sales_stages WHERE name = $1 LIMIT 1`, [name]))[0].id;
const stageOf = async dealId => (await q(`SELECT s.name FROM sales_deals d JOIN sales_stages s ON s.id = d.stage_id WHERE d.id = $1`, [dealId]))[0].name;

// One prospect: an org, its ED, an open deal in `stage` worth `mrr` a month, made `ageDays` ago.
async function prospect(name, { stage = "Lead", mrr = 299, ageDays = 1, email = null, phone = "(502) 555-0100" } = {}) {
  const now = testNow();
  const org = await REC.create(ctx, "org", { name, city: "Louisville", state: "KY", phone }, WHO, { force: true });
  const first = name.split(" ")[0];
  const c = await REC.create(ctx, "contact", { first_name: first, last_name: "Director", role: "ED", emails: email ? [email] : [], phones: [phone] }, WHO, { force: true });
  await LINKS.associate(ctx, "contact", c.id, "org", org.id, { primary: true }, WHO);
  const d = await REC.create(ctx, "deal", { name: `${name} deal`, stage_id: await stageId(stage), value_cents: mrr * 100 }, WHO, { force: true });
  await LINKS.associate(ctx, "deal", d.id, "org", org.id, { primary: true }, WHO);
  await LINKS.associate(ctx, "deal", d.id, "contact", c.id, {}, WHO);
  await q(`UPDATE sales_deals SET created_at = $2, stage_entered_at = $2 WHERE id = $1`, [d.id, new Date(now - ageDays * DAY).toISOString()]);
  return { orgId: org.id, contactId: c.id, dealId: d.id };
}

(async () => {
  await wipeSales();
  await wipeOrg(HOME);
  await q(`DELETE FROM users WHERE id = 'u_sales4_super'`);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales4 Home','sales4-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales4_super',$1,$2,$3,'Sales4 Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  const sup = await login(SUPER);
  const now = testNow();
  const today = TODAY.civil(now, TZ);
  await require("../server/admin/sales/pipelines").ensureDefaults(ctx, WHO);

  // ── §1 Now: due first, then value × probability × days since the last touch ──
  // A cold lead: $5,000 a month, Lead (5%), made 60 days ago, never touched: score 15,000.
  const cold = await prospect("Quillmere Food Pantry", { stage: "Lead", mrr: 5000, ageDays: 60 });
  // A due follow-up: $299 a month, Contacted (10%), a task "Email Ottoline" due today.
  const due = await prospect("Ottoline Riding Center", { stage: "Contacted", mrr: 299, ageDays: 3, email: "ottoline.director@ottoline.sales4.example.org" });
  await ACT.create(ctx, { kind: "task", body: "Email Ottoline the pricing sheet", due_on: today, records: [{ type: "deal", id: due.dealId }, { type: "org", id: due.orgId }] }, WHO);
  // Interested 6 days ago, no next step.
  const warm = await prospect("Brackenridge Youth Arts", { stage: "Contacted", mrr: 299, ageDays: 20 });
  await ACT.create(ctx, { kind: "call", at: new Date(now - 6 * DAY).toISOString(), body: "Connected – interested", records: [{ type: "deal", id: warm.dealId }, { type: "contact", id: warm.contactId }] }, WHO);
  await q(`UPDATE sales_activities SET outcome = 'interested' WHERE body = 'Connected – interested'`);

  const n1 = await S(sup, "GET", "/now");
  const rows = (n1.body && n1.body.rows) || [];
  const rDue = rows.find(r => r.dealId === due.dealId), rCold = rows.find(r => r.dealId === cold.dealId), rWarm = rows.find(r => r.dealId === warm.dealId);
  // HOW IT GOES RED (SALES4_PLANT=rankdue): the cold lead's 15,000 outranks the due task.
  ok("§1 a due follow-up ranks above a cold lead with a bigger score", rDue && rCold && rDue.rank < rCold.rank && rDue.rank === 1,
    JSON.stringify(rows.map(r => [r.rank, r.kind, r.says, r.score && r.score.n])));
  ok("§1 the cold lead's score is computed and shown: value × probability × days", rCold && rCold.score.n === 15000 && rCold.score.says === "$5,000 × 5% × 60 days = 15,000", rCold && rCold.score.says);
  ok("§1 the reason says what happened and what's missing", rWarm && rWarm.reason === "Interested 6 days ago, no next step", rWarm && rWarm.reason);
  ok("§1 a ranked row carries a proposed next step from the call rule", rWarm && rWarm.propose && /^Call Brackenridge again$/.test(rWarm.propose.body), JSON.stringify(rWarm && rWarm.propose));
  ok("§1 the week's scoreboard bar is on top, against 50, 8 and 3", n1.body.week && n1.body.week.goals.dials === 50 && n1.body.week.goals.connects === 8 && n1.body.week.goals.meetingsBooked === 3);
  // Start drops into call mode on Now's own call rows, in Now's order.
  const qn = await S(sup, "GET", "/call/queue?now=1");
  const firstCall = rows.find(r => r.action === "call");
  ok("§1 Start opens call mode on Now's first call row", qn.status === 200 && firstCall && qn.body.current && qn.body.current.orgId === firstCall.orgId, JSON.stringify(qn.body && qn.body.current && qn.body.current.org));

  // ── §4 One click accepts the proposed next step ──
  const acc = await S(sup, "POST", `/deals/${warm.dealId}/next-step`, rWarm.propose);
  const [wd] = await q(`SELECT next_step, next_step_on::text AS on FROM sales_deals WHERE id = $1`, [warm.dealId]);
  ok("§4 Accept sets the deal's next step and its day", acc.status === 200 && wd.next_step === rWarm.propose.body && wd.on === rWarm.propose.due_on, JSON.stringify(wd));
  const n2 = await S(sup, "GET", "/now");
  ok("§4 a deal with a next step not yet due leaves Now", !n2.body.rows.some(r => r.dealId === warm.dealId && r.kind === "call") || rWarm.propose.due_on <= today);

  // ── §2 Logging happens by itself: Outlook mail and calendar ──
  const { sealBag } = await import("../shared/secretBox.js");
  await q(`INSERT INTO sales_mailboxes (id,provider,address,user_id,status,credentials_sealed,token_expires_at,created_by,created_by_name) VALUES ('smb_s4','microsoft',$1,'u_sales4_super','active',$2,$3,'system:test','test')`,
    [OWN, sealBag({ accessToken: "tok-fixture", refreshToken: "r" }, { aad: "sales" }), new Date(now + 3600000).toISOString()]);
  const [mb] = await q(`SELECT id, provider, address, user_id, credentials_sealed, token_expires_at FROM sales_mailboxes WHERE id = 'smb_s4'`);
  // Outlook hands back the address as the person typed it.
  const outlook = async (provider, token, terms) => ({ messages: provider === "microsoft" && token === "tok-fixture" && terms.includes("ottoline.director@ottoline.sales4.example.org") ? [
    { id: "AAMk-outlook-1", from: "Ottoline Director <Ottoline.Director@Ottoline.Sales4.Example.org>", to: [OWN], subject: "Re: pricing", bodyText: "Thanks — can we talk Thursday?", at: new Date(now - 3600000).toISOString() },
    { id: "AAMk-outlook-2", from: "someone@unrelated.example.org", to: [OWN], subject: "Lunch?", bodyText: "Not a prospect.", at: new Date(now - 7200000).toISOString() },
  ] : [] });
  const read = await MAIL.readNow(ctx, mb, { fetcher: outlook });
  const linked = await q(`SELECT l.record_type, l.record_id FROM sales_emails e JOIN sales_email_links l ON l.email_id = e.id WHERE e.provider_message_id = 'AAMk-outlook-1'`);
  // HOW IT GOES RED (SALES4_PLANT=outlookcase): the mixed-case address misses the contact; nothing is stored.
  ok("§2 an Outlook reply from a sales contact lands on the contact, org and deal", read.ok && ["contact", "org", "deal"].every(t => linked.some(l => l.record_type === t && l.record_id === due[`${t === "org" ? "org" : t}Id`])), JSON.stringify({ read, linked }));
  ok("§2 mail with nobody in sales is never stored", (await q(`SELECT 1 FROM sales_emails WHERE provider_message_id = 'AAMk-outlook-2'`)).length === 0);

  // A meeting on the calendar with the Contacted deal's ED moves the deal to Meeting booked.
  const events = [
    { id: "evt-1", status: "confirmed", title: "Steward demo", location: "Zoom", startsAt: new Date(now + 2 * DAY).toISOString(), endsAt: new Date(now + 2 * DAY + 3600000).toISOString(), attendees: [OWN, "OTTOLINE.DIRECTOR@ottoline.sales4.example.org"] },
    { id: "evt-2", status: "confirmed", title: "Dentist", location: "Main St", startsAt: new Date(now + DAY).toISOString(), endsAt: new Date(now + DAY + 1800000).toISOString(), attendees: [OWN] },
  ];
  const calFetch = async (provider, token, from, to) => (provider === "microsoft" && token === "tok-fixture" && from < to ? events : []);
  const cal = await CAL.readNow(ctx, mb, { fetcher: calFetch, now });
  const meet = await q(`SELECT a.id, a.body, a.source FROM sales_activities a WHERE a.provider_event_id = $1`, [`smb_s4:evt-1`]);
  ok("§2 a calendar meeting with a sales contact is logged on the timeline", meet.length === 1 && meet[0].source === "calendar" && /Steward demo/.test(meet[0].body), JSON.stringify({ cal, meet }));
  ok("§2 a calendar event with nobody in sales leaves nothing", (await q(`SELECT 1 FROM sales_activities WHERE provider_event_id = 'smb_s4:evt-2' OR body LIKE 'Dentist%'`)).length === 0);
  // HOW IT GOES RED (SALES4_PLANT=nomove): the deal stays in Contacted.
  ok("§2 the new meeting moves the deal to Meeting booked", (await stageOf(due.dealId)) === "Meeting booked", await stageOf(due.dealId));
  await CAL.readNow(ctx, mb, { fetcher: calFetch, now });
  ok("§2 a second read logs the meeting once", (await q(`SELECT 1 FROM sales_activities WHERE provider_event_id = 'smb_s4:evt-1'`)).length === 1);
  const n3 = await S(sup, "GET", "/now");
  const mv = (n3.body.moved || []).find(m => m.dealId === due.dealId);
  ok("§2 Now offers Undo on the move", !!mv, JSON.stringify(n3.body.moved));
  const un = mv ? await S(sup, "POST", `/auto-moves/${mv.id}/undo`, {}) : { status: 0 };
  ok("§2 Undo puts the deal back in Contacted", un.status === 200 && (await stageOf(due.dealId)) === "Contacted", await stageOf(due.dealId));

  // ── §3 A drag between stages answers with its Undo ──
  const drag = await S(sup, "POST", `/deals/${cold.dealId}/stage`, { stage_id: await stageId("Demo done") });
  // HOW IT GOES RED (SALES4_PLANT=noundo): no undo in the answer.
  ok("§3 a drag answers with the stage to go back to", drag.status === 200 && drag.body.undo && drag.body.undo.name === "Lead", JSON.stringify(drag.body));
  const back = drag.body.undo ? await S(sup, "POST", `/deals/${cold.dealId}/stage`, { stage_id: drag.body.undo.stage_id }) : { status: 0 };
  ok("§3 Undo puts the deal back in Lead", back.status === 200 && (await stageOf(cold.dealId)) === "Lead");

  // ── §6 Nothing is sent to a prospect ──
  const realFetch = global.fetch;
  const out = [];
  global.fetch = async (url, opts = {}) => { out.push({ url: String(url), method: (opts.method || "GET").toUpperCase() }); return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const n4 = await require("../server/admin/sales/routesE").nowFor(qq, now);
    for (const r of n4.rows.filter(x => x.propose)) await NOW.acceptNext(ctx, r.dealId, r.propose, WHO);
    await NOW.acceptNext(ctx, due.dealId, { body: "Reply to Ottoline", due_on: today }, WHO);
    await MAIL.capture(ctx, mb, [{ id: "AAMk-outlook-3", from: "ottoline.director@ottoline.sales4.example.org", to: [OWN], subject: "One more", bodyText: "Hi", at: new Date(now).toISOString() }]);
    await CAL.capture(ctx, mb, [{ id: "evt-3", status: "confirmed", title: "Follow-up", startsAt: new Date(now + 3 * DAY).toISOString(), attendees: ["ottoline.director@ottoline.sales4.example.org"] }], now);
  } finally { global.fetch = realFetch; }
  // HOW IT GOES RED (SALES4_PLANT=send): accepting a next step posts to the mail provider.
  ok("§6 Now, Accept, mail capture and calendar capture make no outbound request", out.length === 0, JSON.stringify(out));
  const src = require("fs").readdirSync(require("path").join(__dirname, "../server/admin/sales")).map(f => require("fs").readFileSync(require("path").join(__dirname, "../server/admin/sales", f), "utf8")).join("\n");
  ok("§6 no sales module can send: no mailer, no Graph sendMail, no Gmail send, no calendar write",
    !/require\([^)]*(resend|mailer|nodemailer|sendEmail|emailSender)[^)]*\)|\/sendMail|messages\/send|calendars?\/[^"'`]*\/events["'`][^)]*method:\s*["']POST/i.test(src));

  // ── §5 Add prospects: ProPublica's rows, de-duplicated by EIN, then name and city ──
  const PP = require("../server/admin/sales/propublica");
  const ADD = require("../server/admin/sales/prospectAdd");
  // A made-up ProPublica: one search page, two organizations, their details.
  const ppFetch = async url => {
    const u = String(url);
    const json = b => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (/\/search\.json\?/.test(u)) return json({ total_results: 2, num_pages: 1, cur_page: 0, organizations: [
      { ein: 611234567, name: "Wyndmoor County Food Pantry Inc", city: "Nicholasville", state: "KY", ntee_code: "K31" },
      { ein: 619876543, name: "Tallowbrook Hunger Network", city: "Lexington", state: "KY", ntee_code: "K31" }] });
    if (/organizations\/611234567\.json/.test(u)) return json({ organization: { address: "12 Elm St", zipcode: "40356", revenue_amount: 410000 }, filings_with_data: [{ tax_prd_yr: 2024, totrevenue: 452000 }] });
    if (/organizations\/619876543\.json/.test(u)) return json({ organization: { address: "9 Oak Ave", zipcode: "40502", revenue_amount: 3900000 }, filings_with_data: [{ tax_prd_yr: 2024, totrevenue: 4100000 }] });
    return new Response("<html>Security Check</html>", { status: 403, headers: { "Content-Type": "text/html" } });
  };
  const found = await PP.lookup({ state: "KY", category: "food" }, { fetcher: ppFetch });
  const wy = found.rows && found.rows.find(r => r.ein === "611234567");
  ok("§5 a ProPublica row carries EIN, city, revenue, year and its ProPublica link", wy && wy.city === "Nicholasville" && wy.revenue === 452000 && wy.year === 2024 && /organizations\/611234567$/.test(wy.sourceUrl), JSON.stringify(wy));
  ok("§5 the revenue range ($100K to $2M by default) keeps one and drops the $4.1M", found.rows.filter(r => PP.inRange(r)).map(r => r.ein).join() === "611234567");
  const down = await PP.lookup({ state: "KY", category: "food" }, { fetcher: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  ok("§5 ProPublica unreachable says so plainly and offers the CSV", down.error === "unreachable" && /CSV/.test(down.message), JSON.stringify(down));
  const add1 = await S(sup, "POST", "/prospects/add", { list: { name: "KY food pantries (sales4)" }, rows: [wy] });
  const add2 = await S(sup, "POST", "/prospects/add", { list: { name: "KY food pantries (sales4)" }, rows: [wy] });
  const byEin = await q(`SELECT id, name, ein, source_url, zip FROM sales_orgs WHERE ein = '611234567' AND deleted_at IS NULL`);
  // HOW IT GOES RED (SALES4_PLANT=dupe on the server): the second add makes a second organization.
  ok("§5 adding the same ProPublica result twice makes one organization", add1.status === 201 && add2.status === 201 && byEin.length === 1, JSON.stringify({ byEin, a2: add2.body }));
  ok("§5 the second add says it was already there, by EIN", add2.body && add2.body.added.length === 0 && /by EIN/.test(add2.body.says), add2.body && add2.body.says);
  ok("§5 the organization keeps its EIN and source link", byEin[0] && /propublica\.org\/nonprofits\/organizations\/611234567$/.test(byEin[0].source_url) && byEin[0].zip === "40356");
  // No EIN in a CSV row: the name and city match instead.
  const csv = PP.fromCsv(`Name,City,State,Revenue,Year,Phone,Executive director\n"Wyndmoor County Food Pantry, Inc.",Nicholasville,KY,"$452,000",2024,(859) 555-0142,Henrietta Vale\n`);
  const add3 = await S(sup, "POST", "/prospects/add", { list: { name: "KY food pantries (sales4)" }, rows: csv.rows });
  ok("§5 a CSV row with no EIN matches by name and city", add3.status === 201 && add3.body.added.length === 0 && /name and city/.test(add3.body.says), add3.body && add3.body.says);

  // ── §5b Enough to call: Find contact, and call mode lists who needs a number ──
  const nophone = await S(sup, "POST", "/prospects/add", { list: { name: "KY food pantries (sales4)" }, rows: [{ ein: "617770001", name: "Corriebrook Pantry", city: "Paris", state: "KY", revenue: 300000, year: 2024 }] });
  const listId = nophone.body.listId;
  const qq2 = await S(sup, "GET", `/call/queue?list=${listId}`);
  ok("§5b call mode skips an organization with no phone and lists it as needing a number", qq2.status === 200 && !(qq2.body.current && /Corriebrook/.test(qq2.body.current.org.name))
    && (qq2.body.needsNumber || []).some(n => n.name === "Corriebrook Pantry"), JSON.stringify(qq2.body.needsNumber));
  const rec = await S(sup, "GET", `/rec/org/${nophone.body.added[0].id}`);
  ok("§5b the organization's page links Find contact to a Google search, nothing fetched", rec.status === 200 && /^https:\/\/www\.google\.com\/search\?q=/.test(rec.body.findContact || "") && /Corriebrook/.test(decodeURIComponent(rec.body.findContact || "")), rec.body && rec.body.findContact);

  // ── §7 Misfiled notes: the dry run lists Steward's own notes on a prospect, by title ──
  const jess = await prospect("Jessamine County Food Pantry", { stage: "Contacted", mrr: 299, ageDays: 30 });
  const on = [{ type: "deal", id: jess.dealId }];
  for (const body of ["December campaign\nGoal: 20 demos by Dec 20.", "Weekly scoreboard\nDials 41, conversations 6.", "Open question for Jonathan\nDo we discount for food banks?",
    "December campaign: Jessamine County Food Pantry wants to start in January", "Call back after their board meets"])
    await ACT.create(ctx, { kind: "note", body, records: on }, WHO);
  const MIS = require("../scripts/ops/sales-misfiled-notes");
  const mis = await MIS.find(qq);
  const titles = mis.map(m => m.title).sort();
  ok("§7 the dry run lists Steward's three notes on the prospect, by title, and nothing about the prospect",
    titles.join("|") === ["December campaign", "Open question for Jonathan", "Weekly scoreboard"].sort().join("|"), JSON.stringify(titles));

  // ── The door ──
  const anon = await api("GET", "/ops/sales/now", null);
  ok("§0 Now is behind the /ops door", anon.status === 404, anon.status);

  if (_pool) await _pool.end();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); if (_pool) await _pool.end().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
