// tests/sales2-inbound.test.js · SALES-2 Part B: inbound, partner referral links, cadences,
// customer asks and the scoreboard. One section per numbered item (§7–§11); §12 (390 px) is a
// screen, walked by eye.
//
// THE PLANTED DEFECTS (set SALES2_PLANT on the SERVER and on THIS process, with TEST_MODE=1 so this
// process reads it when no clock is pinned; each turns its section red):
//   demoresp      the demo request's response changes                              → §7
//   refleak       a referral link's page shows the partner's other deals            → §8
//   cadencereply  a captured reply leaves the cadence's later tasks open            → §9 (capture runs here)
//   scoreweek     the scoreboard counts a call from last Sunday night as this week  → §11
//
// Made-up fixtures only. Nothing is emailed by the sales CRM; the public forms' own mail goes to
// the local sink as it always has. The suite sets its own clock (tests/clock.js).
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
const bcrypt = require("bcryptjs");
const http = require("http");
const { ok, summary, login, api, q, closeDb, BASE, BILLING_MOCK_PORT } = require("./helpers");
const { testNow } = require("./clock");
const TODAY = require("../server/admin/sales/today");
const MAIL = require("../server/admin/sales/email");
const SB = require("../server/admin/sales/scoreboard");
const { nyInstant } = require("../server/admin/sales/meetings");

const PASS = "loadtest1234";
const HOME = "org_sales2bhome", CUST = "org_sales2bcust";
const SUPER = "sales2b-super@example.org", ADMIN = "sales2b-admin@example.org";
const TZ = "America/New_York";
const qq = (sql, p = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), p); };
const ctx = { query: qq, run: (sql, p) => qq(sql, p).then(() => ({ changes: 1 })) };
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);
const raw = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, text: await r.text() }; };
const until = async (fn, ms = 8000) => { const t0 = performance.now(); for (;;) { const v = await fn(); if (v || performance.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 150)); } };

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
const dealBySource = src => q(`SELECT d.id, d.name, d.source, d.stage_id, d.referral_link_id, d.referred_by_sales_org_id FROM sales_deals d WHERE d.source = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`, [src]);
const tasksOn = (type, id) => q(`SELECT a.id, a.body, a.due_on::text AS due_on, a.done_at, a.outcome, a.step_action FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id
                                  WHERE l.record_type = $1 AND l.record_id = $2 AND a.kind = 'task' AND a.deleted_at IS NULL ORDER BY a.due_on, a.created_at`, [type, id]);

// Platform billing's prices, which the signup reads before it looks at the address. The address
// here already has an account, so no checkout is ever made.
function priceMock() {
  const srv = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const pm = req.url.match(/^\/v1\/prices\/price_test_r(\d+)([mys])/);
    if (req.method === "GET" && pm) {
      const t = require("../pricing.json").tiers.find(x => x.id === "r" + pm[1]);
      const usd = pm[2] === "m" ? t.monthlyUsd : pm[2] === "y" ? t.yearlyUsd : t.setupUsd;
      return res.end(JSON.stringify({ id: req.url.split("/")[3], object: "price", unit_amount: usd * 100, currency: "usd",
        ...(pm[2] === "s" ? { recurring: null } : { recurring: { interval: pm[2] === "y" ? "year" : "month", interval_count: 1 } }) }));
    }
    if (req.method === "GET" && /^\/v1\/prices\//.test(req.url))
      return res.end(JSON.stringify({ id: "price_test_t1000m", object: "price", unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } }));
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.method + " " + req.url } }));
  });
  return new Promise(r => srv.listen(BILLING_MOCK_PORT, () => r(srv)));
}

(async () => {
  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await q(`DELETE FROM users WHERE id IN ('u_sales2b_super','u_sales2b_admin')`);
  await q(`DELETE FROM demo_requests WHERE email LIKE '%@sales2b.example.org'`).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales2b Home','sales2b-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales2b Customer','sales2b-cust',1,'active','team')`, [CUST]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales2b_super',$1,$2,$3,'Inbound Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales2b_admin',$1,$2,$3,'Cust Admin','admin',false)`, [CUST, ADMIN, bcrypt.hashSync(PASS, 10)]);
  const sup = await login(SUPER);
  const adm = await login(ADMIN);
  const today = TODAY.civil(testNow(), TZ);

  // ── §7 · INBOUND LANDS IN THE CRM; THE PUBLIC ANSWERS DON'T CHANGE ─────────────────
  // HOW IT GOES RED (SALES2_PLANT=demoresp): the demo request answers {"success":true,"crm":true}.
  const demo = await raw("POST", "/demo-request", { name: "Imogen Fairleigh", email: "imogen@thornbury-arts.sales2b.example.org", orgName: "Thornbury Arts Trust", orgSize: "10-50", challenge: "Lapsed donors" });
  ok("§7 the demo request's answer is byte-for-byte what it was", demo.status === 200 && demo.text === '{"success":true}', demo.text);
  const demoDeal = await until(async () => (await dealBySource("Website demo request"))[0]);
  ok("§7 …and it lands as a deal in Lead, source 'Website demo request'", demoDeal && /Thornbury Arts Trust/.test(demoDeal.name), demoDeal);
  const demoTasks = demoDeal ? await tasksOn("deal", demoDeal.id) : [];
  ok("§7 …with a task due today: New inbound, call within the hour", demoTasks.some(t => /^New inbound: call within the hour/.test(t.body) && t.due_on === today), demoTasks);
  const [demoContact] = await q(`SELECT c.id FROM sales_contacts c WHERE c.emails ? 'imogen@thornbury-arts.sales2b.example.org'`);
  const [demoOrg] = await q(`SELECT id, domain FROM sales_orgs WHERE name = 'Thornbury Arts Trust'`);
  ok("§7 …with the contact (by email) and the organization (by the email's domain)", demoContact && demoOrg && demoOrg.domain === "thornbury-arts.sales2b.example.org");
  // The same person again: matched, not duplicated.
  await raw("POST", "/demo-request", { name: "Imogen Fairleigh", email: "imogen@thornbury-arts.sales2b.example.org", orgName: "Thornbury Arts Trust" });
  await until(async () => (await dealBySource("Website demo request")).length === 2);
  const nC = await q(`SELECT COUNT(*)::int AS n FROM sales_contacts WHERE emails ? 'imogen@thornbury-arts.sales2b.example.org' AND deleted_at IS NULL`);
  const nO = await q(`SELECT COUNT(*)::int AS n FROM sales_orgs WHERE name = 'Thornbury Arts Trust' AND deleted_at IS NULL`);
  ok("§7 a second request from the same person matches by email and domain (one contact, one org)", nC[0].n === 1 && nO[0].n === 1, [nC[0].n, nO[0].n]);
  const lf = await raw("POST", "/lost-and-found/lead", { name: "Osric Pellow", email: "osric@pellow-food.sales2b.example.org", organization: "Pellow Food Share" });
  const lfBody = JSON.parse(lf.text || "{}");
  ok("§7 the Lost & Found answer is byte-for-byte what it was", lf.status === 201 && lf.text === JSON.stringify({ ok: true, id: lfBody.id, message: "Thank you. Your report is downloading, and nothing about your donors left your computer." }), lf.text);
  ok("§7 …and it lands, source 'Lost & Found'", !!(await until(async () => (await dealBySource("Lost & Found"))[0])));
  const mock = await priceMock();
  const agr = (await api("GET", "/public/agreement", null)).body;
  const su = await raw("POST", "/public/signup", { orgName: "Wexcombe Choir", contactName: "Inbound Super", contactEmail: SUPER, estimatedRecords: 300, interval: "monthly", acceptTerms: true, termsVersion: agr.version });
  const suBody = JSON.parse(su.text || "{}");
  ok("§7 the signup answer keeps its exact shape (the address already has an account: the same answer as a new one)", su.status === 202
    && Object.keys(suBody).join() === "sent,message,tier,band,interval,amountUsd,setupUsd,firstChargeAt,agreementVersion" && suBody.sent === true, su.text);
  ok("§7 …and it lands, source 'Signup'", !!(await until(async () => (await dealBySource("Signup"))[0])));
  await new Promise(r => mock.close(r));

  // ── §8 · PARTNER REFERRAL LINKS ────────────────────────────────────────────────────
  const pA = (await S(sup, "POST", "/partners", { name: "Brian Greenfeld (made-up)", terms: [{ kind: "finder", percent: 10, recurring: true, months: 12 }] })).body.id;
  const pB = (await S(sup, "POST", "/partners", { name: "Other Partner (made-up)", terms: [{ kind: "closer", percent: 20, recurring: false }] })).body.id;
  // Partner B already has a deal Partner A must never see.
  const secret = (await S(sup, "POST", "/rec/deal", { name: "Secret Deal of Partner B" })).body.id;
  const termB = (await S(sup, "GET", `/partners/${pB}`)).body.terms[0].id;
  await S(sup, "POST", `/deals/${secret}/partners`, { term_id: termB });
  const mine = (await S(sup, "POST", "/rec/deal", { name: "Partner A's Own Earlier Deal" })).body.id;
  await S(sup, "POST", `/deals/${mine}/partners`, { term_id: (await S(sup, "GET", `/partners/${pA}`)).body.terms[0].id });
  const link = await S(sup, "POST", `/partners/${pA}/referral-link`, {});
  const token = link.body.token;
  ok("§8 a partner gets a long random private link; only its fingerprint is kept", link.status === 201 && /^[A-Za-z0-9_-]{40,}$/.test(token) && link.body.path === `/refer/${token}`
    && (await q(`SELECT COUNT(*)::int AS n FROM sales_referral_links WHERE token_hash = $1`, [require("crypto").createHash("sha256").update(token).digest("hex")]))[0].n === 1
    && !JSON.stringify(await q(`SELECT * FROM sales_referral_links`)).includes(token));
  // HOW IT GOES RED (SALES2_PLANT=refleak): the page lists the partner's deals.
  const page = await raw("GET", `/public/referral/${token}`);
  const pageBody = JSON.parse(page.text || "{}");
  ok("§8 the page shows the partner's name and nothing else: no deal, theirs or anyone's", page.status === 200 && Object.keys(pageBody).join() === "ok,partner,says"
    && pageBody.says === "Referred by Brian Greenfeld (made-up)" && !/Secret Deal|Earlier Deal/.test(page.text), page.text);
  const sent = await raw("POST", `/public/referral/${token}`, { orgName: "Lindqvist Youth Rowing", contactName: "Saskia Lindqvist", email: "saskia@lindqvist-row.sales2b.example.org", phone: "502-555-0190", note: "They outgrew spreadsheets (made-up)" });
  ok("§8 the form's answer says thanks and nothing more", sent.status === 201 && !/Secret|Earlier|deal/i.test(sent.text), sent.text);
  const [refDeal] = await dealBySource("Partner referral");
  const attached = refDeal ? await q(`SELECT dp.partner_id, t.kind FROM sales_deal_partners dp JOIN sales_partner_terms t ON t.id = dp.term_id WHERE dp.deal_id = $1`, [refDeal.id]) : [];
  ok("§8 it makes the org, the contact and a deal in Lead with the partner and their default term attached", refDeal && /Lindqvist Youth Rowing/.test(refDeal.name)
    && attached.length === 1 && attached[0].partner_id === pA && attached[0].kind === "finder" && refDeal.referral_link_id === link.body.id, [refDeal, attached]);
  const home8 = (await S(sup, "GET", "/home")).body.today;
  ok("§8 …and a Today line", home8.lines.due.some(r => /New inbound: call within the hour\. Saskia Lindqvist/.test(r.says)), home8.lines.due.map(r => r.says));
  const before = (await q(`SELECT COUNT(*)::int AS n FROM sales_deals`))[0].n;
  const bot = await raw("POST", `/public/referral/${token}`, { orgName: "Bot Org", contactName: "Bot", email: "bot@bot.example.org", website: "http://spam.example.org" });
  ok("§8 a filled honeypot gets the same thanks and writes nothing", bot.status === 201 && (await q(`SELECT COUNT(*)::int AS n FROM sales_deals`))[0].n === before);
  const stats = (await S(sup, "GET", `/partners/${pA}/referrals`)).body;
  ok("§8 the partner's record: referrals in, meetings, won, MRR, owed", stats.referralsIn === 1 && stats.meetings === 0 && stats.won === 0 && typeof stats.owedCents === "number" && typeof stats.sentences.referralsIn === "string", stats);
  await S(sup, "POST", `/partners/${pA}/referral-link/revoke`, {});
  const gone = await raw("GET", `/public/referral/${token}`);
  const garbage = await raw("GET", "/public/referral/zz-nonexistent");
  ok("§8 a revoked link, and a made-up one, are a plain 404", gone.status === 404 && garbage.status === 404 && !/Brian/.test(gone.text));

  // ── §9 · CADENCES ──────────────────────────────────────────────────────────────────
  const c1 = (await S(sup, "POST", "/rec/contact", { first_name: "Thaddea", last_name: "Morrow", emails: "thaddea@cadence-one.sales2b.example.org", phones: "859-555-0161" })).body.id;
  const c2 = (await S(sup, "POST", "/rec/contact", { first_name: "Quillon", last_name: "Ashby", emails: "quillon@cadence-two.sales2b.example.org", phones: "859-555-0162" })).body.id;
  const c3 = (await S(sup, "POST", "/rec/contact", { first_name: "Peregrine", last_name: "Hale", emails: "peregrine@cadence-three.sales2b.example.org", phones: "859-555-0163" })).body.id;
  const o9 = (await S(sup, "POST", "/rec/org", { name: "Cadence Test Org", domain: "cadence-one.sales2b.example.org" })).body.id;
  for (const c of [c1, c2, c3]) await S(sup, "POST", "/link", { from: { type: "contact", id: c }, to: { type: "org", id: o9 } });
  const cads = (await S(sup, "GET", "/cadences")).body;
  const np = cads.cadences.find(c => c.name === "New prospect (14 days)");
  ok("§9 the default cadence is 'New prospect (14 days)': day 0 call + email, 2 call, 5 call + voicemail, 8 email, 14 call + breakup email",
    np && np.steps.map(s => `${s.day}:${s.action}`).join() === "0:call,0:email,2:call,5:call,8:email,14:call,14:email", np && np.steps);
  ok("§9 reading the cadences wrote nothing", (await q(`SELECT COUNT(*)::int AS n FROM sales_cadences`))[0].n === 0);
  const en = await S(sup, "POST", `/cadences/${np.id}/enroll`, { contactIds: [c1, c2, c3] });
  const t1 = await tasksOn("contact", c1);
  ok("§9 a bulk enroll makes each step a task on its day", en.status === 201 && en.body.enrolled === 3 && t1.length === 7
    && t1.map(t => t.due_on).join() === [0, 0, 2, 5, 8, 14, 14].map(d => TODAY.addDays(today, d)).join(), t1.map(t => t.due_on));
  const again = await S(sup, "POST", `/cadences/${np.id}/enroll`, { contactIds: [c1] });
  ok("§9 the same contact isn't enrolled twice in one cadence", again.body.enrolled === 0 && /already in it/.test(again.body.skipped[0].says));
  const cq = await S(sup, "GET", "/call/queue?cadence=1");
  ok("§9 call mode runs today's cadence calls as its queue", cq.status === 200 && cq.body.current && [c1, c2, c3].includes(cq.body.current.contactId), cq.body.current);
  // A captured reply ends the cadence and closes the later steps. HOW IT GOES RED (SALES2_PLANT=cadencereply): they stay open.
  await q(`INSERT INTO sales_mailboxes (id,provider,address,user_id,status,created_by,created_by_name) VALUES ('smb_s2b','microsoft','seller@stewardapp.sales2b.example.org','u_sales2b_super','active','system:test','test')`);
  await MAIL.capture(ctx, { id: "smb_s2b", address: "seller@stewardapp.sales2b.example.org" }, [{ id: "m-reply-1", sent: false, from: "thaddea@cadence-one.sales2b.example.org",
    to: ["seller@stewardapp.sales2b.example.org"], cc: [], subject: "Re: Steward", bodyText: "Yes, let's talk (made-up).", at: new Date(testNow()).toISOString() }]);
  const after = await tasksOn("contact", c1);
  const [e1] = await q(`SELECT ended_at, end_reason FROM sales_cadence_enrollments WHERE contact_id = $1`, [c1]);
  ok("§9 a captured reply ends the cadence and closes every remaining step", e1.ended_at && e1.end_reason === "reply" && after.filter(t => t.step_action).every(t => t.done_at && t.outcome === "cadence_ended"),
    after.map(t => [t.due_on, !!t.done_at, t.outcome]));
  await S(sup, "POST", "/call/outcome", { orgId: o9, contactId: c2, outcome: "interested", phone: "859-555-0162" });
  const [e2] = await q(`SELECT end_reason FROM sales_cadence_enrollments WHERE contact_id = $1`, [c2]);
  ok("§9 a Connected outcome ends it", e2.end_reason === "connected" && (await tasksOn("contact", c2)).filter(t => t.step_action).every(t => t.done_at));
  await S(sup, "POST", `/rec/contact/${c3}/dnc`, { reason: "Asked to stop (made-up)" });
  const [e3] = await q(`SELECT end_reason FROM sales_cadence_enrollments WHERE contact_id = $1`, [c3]);
  ok("§9 Do not contact ends it", e3.end_reason === "dnc");
  const c4 = (await S(sup, "POST", "/rec/contact", { first_name: "Liesl", last_name: "Brandt", emails: "liesl@cadence-four.sales2b.example.org" })).body.id;
  await S(sup, "POST", `/cadences/${np.id}/enroll`, { contactIds: [c4] });
  await S(sup, "POST", "/meetings", { orgId: o9, contactIds: [c4], date: TODAY.addDays(today, 2), time: "11:00", place: "Their office (made-up)" });
  ok("§9 a booked meeting ends it", (await q(`SELECT end_reason FROM sales_cadence_enrollments WHERE contact_id = $1`, [c4]))[0].end_reason === "meeting");
  const dncEnroll = await S(sup, "POST", `/cadences/${np.id}/enroll`, { contactIds: [c3] });
  ok("§9 a Do not contact person can't be enrolled", dncEnroll.body.enrolled === 0 && /Do not contact/.test(dncEnroll.body.skipped[0].says));

  // ── §10 · CUSTOMER ASKS, CUSTOMER REFERRALS ──────────────────────────────────────────
  const meta = (await S(sup, "GET", "/meta")).body;
  const ST = Object.fromEntries(meta.pipelines[0].stages.map(s => [s.name, s.id]));
  const cust = (await S(sup, "POST", "/rec/deal", { name: "Wexcombe – Core", stage_id: ST["Verbal yes"], value_cents: 35000 })).body.id;
  await S(sup, "POST", "/link", { from: { type: "deal", id: cust }, to: { type: "contact", id: c1 } });
  await S(sup, "POST", "/link", { from: { type: "deal", id: cust }, to: { type: "org", id: o9 } });
  const paying = await S(sup, "POST", `/deals/${cust}/stage`, { stage_id: ST.Paying });
  const asks = (await tasksOn("contact", c1)).filter(t => !t.done_at);
  ok("§10 a deal reaching Paying starts Customer asks: day 30 testimonial, day 45 two referrals, day 90 check-in call", paying.status === 200
    && asks.map(t => `${t.due_on}|${t.body.split(" · ")[0]}`).join() === [[30, "Ask for a testimonial"], [45, "Ask for two referrals"], [90, "Check-in call"]].map(([d, w]) => `${TODAY.addDays(today, d)}|${w}`).join(), asks.map(t => [t.due_on, t.body]));
  await S(sup, "POST", `/deals/${cust}/stage`, { stage_id: ST.Trial });
  await S(sup, "POST", `/deals/${cust}/stage`, { stage_id: ST.Paying });
  ok("§10 …once per deal", (await q(`SELECT COUNT(*)::int AS n FROM sales_cadence_enrollments WHERE deal_id = $1`, [cust]))[0].n === 1);
  const cr = await S(sup, "POST", "/referrals", { fromOrgId: o9, orgName: "Ravensworth Literacy", contactName: "Odile Ravensworth", email: "odile@ravensworth.sales2b.example.org" });
  const [crDeal] = await dealBySource("Customer referral");
  ok("§10 a customer's referral is a deal with source 'Customer referral', the customer linked", cr.status === 201 && crDeal && crDeal.referred_by_sales_org_id === o9, crDeal);

  // ── §11 · THE SCOREBOARD ───────────────────────────────────────────────────────────
  // HOW IT GOES RED (SALES2_PLANT=scoreweek): a call at 9 PM last Sunday, New York, is 2 AM Monday UTC.
  const monday = SB.weekStart(today);
  const lastSunday9pm = nyInstant(TODAY.addDays(monday, -1), "21:00").toISOString();
  const late = await S(sup, "POST", "/activities", { kind: "call", body: "Late Sunday call (made-up)", at: lastSunday9pm, records: [{ type: "contact", id: c2 }] });
  const sb = (await S(sup, "GET", "/scoreboard")).body;
  const thisWk = sb.weeks[0], lastWk = sb.weeks[1];
  ok("§11 nine weeks, this one first, Monday to Sunday in New York", sb.weeks.length === 9 && thisWk.week === monday && lastWk.week === TODAY.addDays(monday, -7));
  const rowsLast = (await S(sup, "GET", `/scoreboard/rows?metric=dials&week=${lastWk.week}`)).body.rows;
  const rowsThis = (await S(sup, "GET", `/scoreboard/rows?metric=dials&week=${thisWk.week}`)).body.rows;
  ok("§11 a call at 9 PM last Sunday counts last week, not this week", late.status === 201 && rowsLast.some(r => r.says === "Late Sunday call (made-up)") && !rowsThis.some(r => r.says === "Late Sunday call (made-up)"),
    [thisWk.dials, lastWk.dials, rowsThis.map(r => r.says)]);
  ok("§11 this week: the dials and connects logged today, each number opening its rows", thisWk.dials === rowsThis.length && thisWk.dials >= 1 && thisWk.connects >= 1, [thisWk.dials, thisWk.connects]);
  ok("§11 meetings booked this week (one, booked today) and deals won (one, $350/mo)", thisWk.meetingsBooked === 1 && thisWk.dealsWon === 1 && thisWk.mrrAdded === 35000, thisWk);
  ok("§11 the default goals: 50 dials, 8 conversations, 3 meetings a week", sb.goals.dials === 50 && sb.goals.connects === 8 && sb.goals.meetingsBooked === 3);
  await S(sup, "PUT", "/scoreboard/goals", { goals: { dials: 60, connects: 10, meetingsBooked: 4 } });
  ok("§11 the goals are Jonathan's to set", (await S(sup, "GET", "/scoreboard")).body.goals.dials === 60);
  const src = sb.bySource.find(s => s.key === "Partner referral");
  const srcRows = (await S(sup, "GET", `/scoreboard/rows?group=source&key=${encodeURIComponent("Partner referral")}&metric=deals`)).body.rows;
  ok("§11 by source, and the number opens its deals", src && src.deals === 1 && srcRows.length === 1 && /Lindqvist/.test(srcRows[0].name), [src, srcRows]);
  ok("§11 conversion runs step to step, each with its sentence", sb.conversion.length === 4 && sb.conversion[0].from === "dials" && typeof sb.sentences.conversion === "string");

  // ── §0 · THE NEW ROUTES ARE BEHIND THE DOOR ───────────────────────────────────────
  const probes = [["GET", "/cadences"], ["POST", "/cadences", { name: "x", steps: [] }], ["POST", `/cadences/${np.id}/enroll`, { contactIds: [c1] }], ["POST", "/cadences/end", { contactId: c1 }],
    ["POST", `/partners/${pA}/referral-link`, {}], ["GET", `/partners/${pA}/referrals`], ["POST", "/referrals", {}], ["GET", "/scoreboard"], ["GET", "/scoreboard/rows?metric=dials"], ["PUT", "/scoreboard/goals", {}]];
  const leaks = [];
  for (const [m, p, b] of probes) { const r = await S(adm, m, p, b); if (r.status !== 404) leaks.push(`${m} ${p} → ${r.status}`); }
  ok("§0 an org admin gets 404 on every new sales route", leaks.length === 0, leaks);

  await wipeSales();
  await q(`DELETE FROM demo_requests WHERE email LIKE '%@%sales2b.example.org'`).catch(() => {});
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* */ } process.exit(1); });
