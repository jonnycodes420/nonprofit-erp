// tests/sales3-keep.test.js · SALES-3 Part B: the customer-success board, the nurture rhythm,
// and proof (the testimonial and references). One section per numbered item (§5–§7).
//
// THE PLANTED DEFECTS (set SALES3_PLANT on the SERVER and on THIS process, with TEST_MODE=1;
// each turns its section red):
//   donorname  the health line names the customer's newest donor        → §5
//   bugnote    a line tagged bug never reaches the /ops board           → §6
//
// Made-up fixtures only. A donor (name, email, a gift amount) is planted in the customer's org,
// and no answer on the board may carry any of it. Nothing is sent. The suite sets its own clock.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");
const C = require("../server/admin/sales/customers");

const PLANT = process.env.SALES3_PLANT || "";
const PASS = "loadtest1234";
const HOME = "org_sales3khome", CUST = "org_sales3kcust", QUIET = "org_sales3kquiet";
const SUPER = "sales3k-super@example.org", CUST_ADMIN = "sales3k-admin@example.org";
const TZ = "America/New_York";
const DAY = 86400000;
const civil = t => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);
const DONOR = { name: "Philippa Wrenfield-Oddsworth", email: "philippa.wrenfield@donor.sales3k.example.org", cents: 77731 };

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
  await q(`DELETE FROM ops_checks WHERE customer IS NOT NULL`).catch(() => {});
}
const leaks = s => [DONOR.name, "Wrenfield", DONOR.email, "777.31", "77731", "777"].filter(x => s.includes(x));

(async () => {
  await wipeSales();
  for (const o of [HOME, CUST, QUIET]) await wipeOrg(o);
  await q(`DELETE FROM users WHERE id IN ('u_sales3k_super','u_sales3k_admin')`);
  const now = testNow();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales3k Home','sales3k-home',1,'active','team')`, [HOME]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,trial_ends_at) VALUES ($1,'Hollowmere Rescue Farm','sales3k-cust',1,'trialing','r2500_monthly','America/New_York',$2)`,
    [CUST, new Date(now + 20 * DAY).toISOString()]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Stillbrook Pantry','sales3k-quiet',1,'beta','r500_monthly','America/New_York')`, [QUIET]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales3k_super',$1,$2,$3,'Keep Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_sales3k_admin',$1,$2,$3,'Farm Admin','admin',false)`, [CUST, CUST_ADMIN, bcrypt.hashSync(PASS, 10)]);
  // The customer's own data: a donor and a gift (planted, to be looked for), and sign-ins.
  await q(`INSERT INTO donors (id, org_id, name, email, created_at) VALUES ('d_sales3k_1', $1, $2, $3, $4)`, [CUST, DONOR.name, DONOR.email, new Date(now - 3 * DAY).toISOString()]);
  await q(`INSERT INTO donors (id, org_id, name, created_at) VALUES ('d_sales3k_2', $1, 'Second Person', $2)`, [CUST, new Date(now - 3 * DAY).toISOString()]);
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, created_at) VALUES ('g_sales3k_1', $1, 'd_sales3k_1', $2, $3, $4)`, [CUST, DONOR.cents / 100, civil(now - 2 * DAY), new Date(now - 2 * DAY).toISOString()]);
  for (const [i, d] of [[1, 1], [2, 4], [3, 9]]) await q(`INSERT INTO user_sessions (id, user_id, org_id, created_at, last_active_at) VALUES ($1, 'u_sales3k_admin', $2, $3, $3)`,
    [`ses_sales3k_${i}`, CUST, new Date(now - d * DAY).toISOString()]);
  const sup = await login(SUPER);

  const farm = (await S(sup, "POST", "/rec/org", { name: "Hollowmere Rescue Farm" })).body.id;
  await S(sup, "POST", `/orgs/${farm}/steward`, { stewardOrgId: CUST });
  const allie = (await S(sup, "POST", "/rec/contact", { first_name: "Allegra", last_name: "Thornbury", emails: ["allegra@hollowmere.sales3k.example.org"], links: [{ type: "org", id: farm, label: "Champion" }] })).body.id;
  const farmDeal = (await S(sup, "POST", "/rec/deal", { name: "Hollowmere Rescue Farm", links: [{ type: "org", id: farm, primary: true }, { type: "contact", id: allie }] })).body.id;
  const pantry = (await S(sup, "POST", "/rec/org", { name: "Stillbrook Pantry" })).body.id;
  await S(sup, "POST", `/orgs/${pantry}/steward`, { stewardOrgId: QUIET });
  await S(sup, "POST", "/rec/org", { name: "Not A Customer Yet" });

  // ── §5 · THE CUSTOMER-SUCCESS BOARD ────────────────────────────────────────────────
  // HOW IT GOES RED (SALES3_PLANT=donorname): the health line ends with the newest donor's name.
  const b1 = await S(sup, "GET", "/customers");
  const rows = b1.body.rows || [];
  const fr = rows.find(r => r.salesOrgId === farm), pr = rows.find(r => r.salesOrgId === pantry);
  ok("§5 one row per organization linked to a Steward org (and none for one that isn't)", rows.length === 2 && fr && pr, rows.map(r => r.name));
  ok("§5 the row has the plan, the billing start and the days to it", fr.plan === "r2500_monthly" && fr.billing.kind === "start" && fr.billing.on === civil(now + 20 * DAY) && fr.daysToStart === 20, fr);
  ok("§5 the facts are counts and dates: last sign-in, sign-ins in 14 days, people, gifts in 30 days, journeys, data health",
    fr.facts.daysSinceSignIn === 1 && fr.facts.signIns14 === 3 && fr.facts.people === 2 && fr.facts.gifts30 === 1 && fr.facts.journeysOn === 0 && fr.facts.dataHealthOpen === null, fr.facts);
  ok("§5 a customer no one has signed in to reads Needs a call, in words", pr.health.ok === false && /^Needs a call: no one has signed in yet\./.test(pr.health.says) && /No donors in yet: 0 people in Steward/.test(pr.health.says), pr.health.says);
  ok("§5 the active one reads On track, in words, not a score", fr.health.ok === true && fr.health.says === "On track: last sign-in 1 day ago, 3 sign-ins in the last 14 days, 1 gift recorded in the last 30 days.", fr.health.says);
  ok("§5 the board never carries the customer's donor: no name, email or gift amount", leaks(JSON.stringify(b1.body)).length === 0, leaks(JSON.stringify(b1.body)));
  // The rule is Jonathan's: tighten it and the farm needs a call.
  await S(sup, "PUT", "/health", { rules: [{ fact: "daysSinceSignIn", op: ">=", value: 1, says: "Needs a call" }, { fact: "signIns14", op: "<", value: 5, says: "Quiet" }] });
  const fr2 = (await S(sup, "GET", "/customers")).body.rows.find(r => r.salesOrgId === farm);
  ok("§5 the health rule is editable and read as written", fr2.health.ok === false && fr2.health.says === "Needs a call: last sign-in 1 day ago. Quiet: 3 sign-ins in the last 14 days." && fr2.health.facts.join() === "daysSinceSignIn,signIns14", fr2.health);
  // Every fact opens its source: dated counts.
  const si = (await S(sup, "GET", `/customers/${farm}/fact/signIns14`)).body;
  const gi = (await S(sup, "GET", `/customers/${farm}/fact/gifts30`)).body;
  const pe = (await S(sup, "GET", `/customers/${farm}/fact/people`)).body;
  ok("§5 sign-ins open their days, and add up to the count", si.rows.length === 3 && si.rows.every(r => r.says === "1 sign-in") && /Sessions started/.test(si.sentence), si.rows);
  ok("§5 gifts and people open their days too, as counts", gi.rows.length === 1 && gi.rows[0].says === "1 gift recorded" && gi.rows[0].day === civil(now - 2 * DAY) && pe.rows.reduce((n, r) => n + Number(r.says.split(" ")[0]), 0) === 2, [gi.rows, pe.rows]);
  ok("§5 …and none of it names the donor", leaks(JSON.stringify([si, gi, pe])).length === 0);
  const adm = await login(CUST_ADMIN);
  ok("§5 a customer's admin gets 404 on the board", (await S(adm, "GET", "/customers")).status === 404);
  await S(sup, "PUT", "/health", { rules: C.DEFAULT_HEALTH.rules });

  // ── §6 · THE NURTURE RHYTHM ────────────────────────────────────────────────────────
  // HOW IT GOES RED (SALES3_PLANT=bugnote): the bug line is on the timeline but not the board.
  const nu = await S(sup, "POST", `/customers/${farm}/nurture`, {});
  const tasks = await q(`SELECT a.body, a.due_on::text AS due_on FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id
                          WHERE l.record_type = 'deal' AND l.record_id = $1 AND a.kind = 'task' AND a.deleted_at IS NULL ORDER BY a.due_on`, [farmDeal]);
  const weekly = tasks.filter(t => /^Weekly check-in call/.test(t.body));
  ok("§6 the pilot rhythm: a weekly check-in task until billing starts, and a 30-day review", nu.status === 201 && weekly.length === 2 && weekly[0].due_on === civil(now + 7 * DAY) && weekly[1].due_on === civil(now + 14 * DAY)
    && tasks.some(t => /^30-day review/.test(t.body) && t.due_on === civil(now + 30 * DAY)), tasks);
  ok("§6 each check-in carries the question", weekly.every(t => t.body.includes('"What annoyed you this week?"')));
  ok("§6 a second start is refused (one rhythm at a time)", (await S(sup, "POST", `/customers/${farm}/nurture`, {})).status === 400);
  const ci = await S(sup, "POST", `/customers/${farm}/checkin`, { lines: [{ text: "The import preview took a long time" }, { text: "Receipt PDF shows last year's date", bug: true }] });
  const notes = await q(`SELECT a.body FROM sales_activities a JOIN sales_activity_links l ON l.activity_id = a.id WHERE l.record_type = 'deal' AND l.record_id = $1 AND a.kind = 'note'`, [farmDeal]);
  ok("§6 the answers land on the deal's timeline, the bug line tagged", ci.status === 201 && notes.some(n => n.body.includes("- The import preview took a long time") && n.body.includes("- [bug] Receipt PDF shows last year's date")), notes);
  const ops = (await api("GET", "/ops", sup)).body || {};
  const items = ((ops.board || {}).builds || []).flatMap(g => g.items);
  const bug = items.find(i => i.words === "Receipt PDF shows last year's date");
  ok("§6 the bug line is a row on /ops's board, with the customer named", !!bug && bug.source === "customer" && bug.customer === "Hollowmere Rescue Farm" && bug.state === "open", bug || items.slice(0, 3));
  ok("§6 …and only the bug line went there", !items.some(i => i.words === "The import preview took a long time"));
  ok("§6 nothing is sent: a check-in writes tasks and notes only", (await q(`SELECT COUNT(*)::int AS n FROM sales_emails`).catch(() => [{ n: 0 }]))[0].n === 0);

  // ── §7 · PROOF: THE TESTIMONIAL AND REFERENCES ─────────────────────────────────────
  await S(sup, "PUT", `/customers/${farm}/proof`, { testimonial_state: "asked", references_asked: 2 });
  let p = (await S(sup, "GET", "/customers")).body.rows.find(r => r.salesOrgId === farm).proof;
  ok("§7 'Allegra owes a testimonial and two references.' is a line", p.owes === "Allegra owes a testimonial and two references." && p.testimonial.askedOn === civil(now), p);
  const noWords = await S(sup, "PUT", `/customers/${farm}/proof`, { testimonial_state: "received" });
  ok("§7 received needs her words", noWords.status === 400);
  await S(sup, "PUT", `/customers/${farm}/proof`, { testimonial_state: "received", testimonial_text: "Steward told us who to call, and they gave." });
  const ref = await S(sup, "POST", "/referrals", { fromOrgId: farm, orgName: "Kestrel Lane Animal Rescue", contactName: "Odile Fanshawe", email: "odile@kestrel.sales3k.example.org" });
  const [rd] = await q(`SELECT id, source, referred_by_sales_org_id FROM sales_deals WHERE name LIKE 'Kestrel Lane%' AND deleted_at IS NULL`);
  ok("§7 a reference becomes a deal, source Customer referral, linked to the customer", ref.status === 201 && rd && rd.source === "Customer referral" && rd.referred_by_sales_org_id === farm, rd);
  p = (await S(sup, "GET", "/customers")).body.rows.find(r => r.salesOrgId === farm).proof;
  ok("§7 the reference is named; she now owes approval and one reference", p.referrals.length === 1 && p.referrals[0].step === "named" && p.owes === "Allegra owes approval to publish her testimonial and one reference.", p);
  await S(sup, "POST", "/activities", { kind: "meeting", body: "Intro call with Odile", records: [{ type: "deal", id: rd.id }] });
  p = (await S(sup, "GET", "/customers")).body.rows.find(r => r.salesOrgId === farm).proof;
  ok("§7 a meeting on the referral moves it to meeting", p.referrals[0].step === "meeting" && p.counts.named === 1 && p.counts.contacted === 1 && p.counts.meeting === 1 && p.counts.won === 0, p.counts);
  await S(sup, "PUT", `/customers/${farm}/proof`, { testimonial_state: "approved" });
  p = (await S(sup, "GET", "/customers")).body.rows.find(r => r.salesOrgId === farm).proof;
  ok("§7 approved to publish keeps the text and the approval day", p.testimonial.state === "approved" && p.testimonial.text === "Steward told us who to call, and they gave." && p.testimonial.approvedOn === civil(now), p.testimonial);
  ok("§7 the owes line counts what's left", p.owes === "Allegra owes one reference.", p.owes);
  ok("§7 the pure rule: nothing owed is no line", C.owesLine("Allie", { testimonial_state: "approved", references_asked: 1 }, [{}]) === null);

  await wipeSales();
  for (const o of [HOME, CUST, QUIET]) await wipeOrg(o);
  await q(`DELETE FROM users WHERE id IN ('u_sales3k_super','u_sales3k_admin')`);
  await closeDb();
  summary();
  if (PLANT) console.log(`(planted: ${PLANT})`);
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
