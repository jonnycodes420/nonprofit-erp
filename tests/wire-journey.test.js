// tests/wire-journey.test.js — WIRE-1. THE ONE GUARD THIS BUILD EARNED.
//
//     ONE NEW PERSON, NINE THINGS DONE, AND EVERY ONE OF THEM IS EVERYWHERE IT
//     SHOULD BE. THEN A DUPLICATE OF THEM IS MERGED AND NOTHING IS LOST OR
//     COUNTED TWICE. THE SAME FOR A FUNDER.
//
// Steward's promise is one story per person. This follows a new person through
// the routes a team really uses, in the order a year really goes: a gift on a
// giving page (the signed Stripe webhook), a monthly plan (the checkout
// webhook), an event registration by email and a check-in at the door, three
// volunteer hours, a peer-to-peer page by email, an email and a meeting from a
// connected Google account (the real sync against a stand-in), a task, a
// journey and a membership. Then it reads them back from every place they
// belong: the person (one record, not five), the timeline, ⌘K search, the
// calendar, the report totals to the cent, an Ask answer about the person whose
// every line opens rows that foot to it, and a Group built from a filter.
// Then a duplicate of the person, with a gift, a note and a calendar meeting of
// its own, is merged in: the money foots, nothing is doubled, and no row in the
// database still points at the duplicate.
//
//   §1 the person          one record, however they arrived
//   §2 the timeline        every act is on it, newest first
//   §3 search              the person, the event and the page are found
//   §4 the calendar        the event, the task and the membership's end are on it
//   §5 the numbers         report totals foot to the cent
//   §6 Ask                 "what has Wren done with us this year?" opens rows that foot
//   §7 Groups              a filter Group of the event's guests holds them
//   §8 the merge           nothing lost, nothing doubled, no orphans
//   §9 the funder          deadlines, an award paid in instalments, an email, the history
//
// HOW IT WOULD GO RED: a route that creates a second person for an email on
// file (§1); an act that writes no line (§2, e.g. a door check-in); a dated
// kind left off the calendar (§4, memberships); a merge that leaves a pointer
// behind (§8, calendar_events.person_ids); a grant stage change that never
// reaches the funder (§9). Proven able to fail: see the build's report.
//
// Standard scratch stack (tests/README.md); the Stripe mock and the Google
// stand-in run on this shard's ports.
const http = require("http");
const bcrypt = require("bcryptjs");
const Stripe = require("stripe");
const { BASE, ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_wire1p", ACCT = "acct_wire1p", USER = "u_wire1p", DANA = "dana@wire1p.local";
const WREN = "wren.wirefield@wire1.test", FUNDER_MAIL = "grants@lanterntrust.test";
const CAL_PORT = Number(process.env.CALENDAR_MOCK_PORT || 5618);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");
const cents = v => Math.round(Number(v || 0) * 100);
const today = civilToday();
const year = today.slice(0, 4);

// ── the stand-ins: Stripe (customer and subscription reads) and Google ──────
const CUSTOMERS = { cus_wren: WREN };
function startStripeMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const cu = req.url.match(/^\/v1\/customers\/([^/?]+)/);
        if (req.method === "GET" && cu) return res.end(JSON.stringify({ id: cu[1], object: "customer", email: CUSTOMERS[cu[1]] || null, name: "Wren Wirefield" }));
        const su = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (req.method === "GET" && su) return res.end(JSON.stringify({ id: su[1], object: "subscription", status: "active", metadata: {}, items: { data: [{ id: "si_w", price: { currency: "usd", product: "prod_w" } }] }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }));
        const iv = req.url.match(/^\/v1\/invoices\/([^/?]+)/);
        if (req.method === "GET" && iv) return res.end(JSON.stringify({ id: iv[1], object: "invoice", subscription: iv[1] === "in_wire1" ? "sub_wire1" : null,
          parent: { subscription_details: { subscription: iv[1] === "in_wire1" ? "sub_wire1" : null } } }));
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(STRIPE_MOCK_PORT, () => resolve(srv));
  });
}
const b64 = s => Buffer.from(s, "utf8").toString("base64");
const MESSAGES = {
  m_wren: { id: "m_wren", internalDate: String(Date.now() - 3600e3), payload: { mimeType: "text/plain", headers: [
    { name: "From", value: `Wren Wirefield <${WREN}>` }, { name: "To", value: DANA }, { name: "Subject", value: "Saturday tutoring" }], body: { data: b64("Thank you for having me on Saturday.") } } },
  m_fund: { id: "m_fund", internalDate: String(Date.now() - 7200e3), payload: { mimeType: "text/plain", headers: [
    { name: "From", value: DANA }, { name: "To", value: FUNDER_MAIL }, { name: "Subject", value: "Our interim report" }], body: { data: b64("Please find our interim report.") } } },
};
const soon = h => new Date(Date.now() + h * 3600e3).toISOString();
const CAL_EVENTS = [{ id: "ev_wren_coffee", status: "confirmed", summary: "Coffee with Wren", start: { dateTime: soon(30) }, end: { dateTime: soon(31) },
  attendees: [{ email: DANA }, { email: WREN }] }];
const google = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (s, b) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(b)); };
  const m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
  if (m) return MESSAGES[m[1]] ? send(200, MESSAGES[m[1]]) : send(404, {});
  if (u.pathname === "/gmail/v1/users/me/messages") return send(200, { messages: Object.keys(MESSAGES).map(id => ({ id })) });
  send(200, { items: CAL_EVENTS });
});

async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}

const WIPE = ["merge_log", "data_health_merges", "calendar_events", "mailbox_connections", "calendar_pushes", "grant_milestones", "grant_sends", "grant_documents",
  "volunteer_shifts", "event_attendees", "events", "peer_fundraisers", "giving_pages", "memberships", "membership_levels", "cultivation_plan_steps",
  "cultivation_plans", "cultivation_template_steps", "cultivation_templates", "audiences", "group_members", "tasks", "threads", "thank_you_drafts",
  "pledge_installments", "recurring_change_log", "recurring_subscriptions", "receipts", "interactions", "question_log", "grants", "donor_relationships"];
async function wipe() {
  await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of WIPE) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["fin_transactions", "gifts", "pledges", "budgets", "accounts", "fin_funds", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  const stripeMock = await startStripeMock();
  await new Promise(r => google.listen(CAL_PORT, r));
  await wipe();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,stripe_account_id,stripe_connected,ai_enabled)
           VALUES ($1,'Wire One Fixture','wire1p',1,'active','team','America/New_York',NOW(),$2,true,false)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, DANA, pw]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_wire1p',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_wire1p',$1,'General Operating',false)`, [ORG]);
  const dana = await login(DANA);
  await api("POST", "/onboarding/complete", dana, {});
  const { sealBag } = await import("../shared/secretBox.js");
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name)
           VALUES ('mbx_wire1p',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test')`,
    [ORG, USER, DANA, sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG })]);

  // ── the year: nine things one new person does ───────────────────────────
  console.log("\nthe year");
  const page = await api("POST", "/giving-pages", dana, { title: "Wirefield Reading Fund", slug: "wirefield-reading", goalAmount: 5000, p2pEnabled: true });
  const pageId = page.body && (page.body.id || (page.body.page && page.body.page.id));
  ok("a giving page with peer-to-peer on", page.status < 300 && pageId, page.body);
  await q(`UPDATE giving_pages SET p2p_enabled=true, status='active' WHERE id=$1 AND org_id=$2`, [pageId, ORG]);

  // 1. a gift on the giving page, through the signed webhook
  ok("1 a $125.50 gift on the page", await fire({ id: "evt_wire1_pi", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_wire1", amount_received: 12550, receipt_email: WREN, metadata: { donor_name: "Wren Wirefield", giving_page_id: pageId } } } }) === 200);
  const [wren] = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, WREN]);
  const W = wren && wren.id;
  ok("1 …made Wren a person", !!W, wren);

  // 2. a monthly plan, through the checkout webhook, and its first charge
  await fire({ id: "evt_wire1_cs", type: "checkout.session.completed", account: ACCT, data: { object: { mode: "subscription", id: "cs_wire1",
    customer_email: WREN, customer: "cus_wren", subscription: "sub_wire1", amount_total: 2500, metadata: { donor_name: "Wren Wirefield", frequency: "monthly" } } } });
  await fire({ id: "evt_wire1_inv", type: "invoice.payment_succeeded", account: ACCT, data: { object: { id: "in_wire1", amount_paid: 2500, customer: "cus_wren",
    parent: { subscription_details: { subscription: "sub_wire1" } }, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } } });
  // The charge itself is a payment_intent on the invoice, as Stripe sends it.
  await fire({ id: "evt_wire1_pi2", type: "payment_intent.succeeded", account: ACCT, data: { object: { id: "pi_wire1_sub", amount_received: 2500,
    receipt_email: WREN, invoice: "in_wire1", customer: "cus_wren", metadata: {} } } });
  const [plan] = await q(`SELECT donor_id, amount, interval FROM recurring_subscriptions WHERE org_id=$1 AND stripe_subscription_id='sub_wire1'`, [ORG]);
  ok("2 a $25 monthly plan on Wren", plan && plan.donor_id === W && Number(plan.amount) === 25 && plan.interval === "month", plan);

  // 3. an event: registered by email, then checked in at the door
  const eventDate = civilPlusDays(10);
  const ev = await api("POST", "/events", dana, { name: "Lantern Night Wirefield", eventType: "gala", date: eventDate, location: "The Boathouse" });
  const evId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  const reg = await api("POST", `/events/${evId}/attendees`, dana, { name: "Wren Wirefield", email: WREN });
  const [att] = await q(`SELECT id, donor_id FROM event_attendees WHERE org_id=$1 AND event_id=$2`, [ORG, evId]);
  ok("3 registered by email, on Wren's record", reg.status < 300 && att && att.donor_id === W, { reg: reg.body, att });
  const ci = await api("POST", `/events/${evId}/check-in`, dana, { attendeeId: att && att.id });
  ok("3 checked in at the door", ci.status < 300, ci.body);

  // 4. three volunteer hours
  const vh = await api("POST", `/donors/${W}/volunteer-hours`, dana, { date: today, hours: 3, role: "Saturday tutoring" });
  ok("4 three volunteer hours", vh.status === 201, vh.body);

  // 5. a peer-to-peer page, by email
  const pf = await api("POST", `/giving-pages/${pageId}/fundraisers`, dana, { name: "Wren reads for Lantern", email: WREN, personalGoalAmount: 500 });
  const [pfr] = await q(`SELECT person_id FROM peer_fundraisers WHERE org_id=$1 AND giving_page_id=$2`, [ORG, pageId]);
  ok("5 a peer-to-peer page, on Wren's record", pf.status < 300 && pfr && pfr.person_id === W, { pf: pf.body, pfr });

  // 6. an email and a meeting from Dana's connected Google account
  const sm = await api("POST", "/mailbox/google/sync", dana, { what: "mail" });
  const sc = await api("POST", "/mailbox/google/sync", dana, { what: "calendar" });
  const [mail] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND donor_id=$2 AND type='email'`, [ORG, W]);
  const [meet] = await q(`SELECT COUNT(*)::int n FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids)`, [ORG, W]);
  ok("6 Wren's email is on file from the mailbox", sm.status === 200 && mail.n === 1, { sm: sm.body, mail });
  ok("6 …and the coffee from the calendar", sc.status === 200 && meet.n === 1, { sc: sc.body, meet });

  // 7. a task
  const taskDue = civilPlusDays(5);
  const tk = await api("POST", "/tasks", dana, { title: "Thank Wren for Saturday", due: taskDue, donorId: W, assignedTo: USER, assignedToName: "Dana Reyes" });
  ok("7 a task about Wren", tk.status < 300, tk.body);

  // 8. a journey
  await q(`INSERT INTO cultivation_templates (id,org_id,name,trigger_key,steps,created_by,created_by_name) VALUES ('ct_wire1p',$1,'New volunteer welcome','by_hand','[{"type":"thank","draft":null,"label":"Call to say thank you","offsetDays":3}]'::jsonb,'system:test','test')`, [ORG]).catch(e => ok("8 journey fixture", false, e.message));
  const jy = await api("POST", "/journeys/ct_wire1p/apply", dana, { donorIds: [W] });
  const [plan8] = await q(`SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2`, [ORG, W]);
  ok("8 Wren is on a journey", jy.status < 300 && plan8.n === 1, { jy: jy.body, plan8 });

  // 9. a membership
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term,created_by,created_by_name) VALUES ('ml_wire1p',$1,'Friend',60,'12_months','system:test','test')`, [ORG]);
  const mb = await api("POST", `/donors/${W}/memberships`, dana, { levelId: "ml_wire1p", paid: false });
  const [mem] = await q(`SELECT id, LEFT(expires_on::text,10) AS expires FROM memberships WHERE org_id=$1 AND donor_id=$2`, [ORG, W]);
  ok("9 a Friend membership", mb.status < 300 && mem, { mb: mb.body, mem });

  // ── §1 the person ───────────────────────────────────────────────────────
  console.log("\n§1 the person");
  const [ppl] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND (LOWER(email)=$2 OR name ILIKE 'Wren Wirefield')`, [ORG, WREN]);
  ok("§1 one Wren, not five", ppl.n === 1, ppl);
  const [types] = await q(`SELECT person_types::text AS t FROM donors WHERE id=$1`, [W]);
  ok("§1 the record says donor and volunteer", /donor/.test(types.t) && /volunteer/.test(types.t), types);

  // ── §2 the timeline ─────────────────────────────────────────────────────
  console.log("\n§2 the timeline");
  const rec = (await api("GET", `/donors/${W}`, dana)).body;
  const lines = (rec.interactions || []).map(i => `${i.type}: ${i.note || ""}`);
  const has = re => lines.some(l => re.test(l));
  const myGifts = (rec.gifts || []).map(g => cents(g.amount)).sort((a, b) => a - b);
  ok("§2 both gifts are on the timeline", myGifts.join(",") === "2500,12550", myGifts);
  ok("§2 the door check-in wrote a line", has(/came to lantern night wirefield/i), lines);
  ok("§2 the email is a line", has(/^email:/i), lines);
  ok("§2 the peer-to-peer page wrote a line", has(/fundraising page/i), lines);
  ok("§2 the membership wrote a line", has(/friend/i) && has(/member/i), lines);
  ok("§2 the journey wrote a line", has(/new volunteer welcome/i), lines);
  ok("§2 the plan starting wrote a line", has(/month/i) && has(/\$25/), lines);
  const vhr = (await api("GET", `/donors/${W}/volunteer-hours`, dana)).body;
  ok("§2 the hours are on the record", (vhr.shifts || []).reduce((s, x) => s + Number(x.hours), 0) === 3, vhr.shifts);
  const rel = (await api("GET", `/donors/${W}/relationship`, dana)).body;
  ok("§2 the coffee is on the relationship timeline", JSON.stringify(rel).includes("Coffee with Wren"), Object.keys(rel || {}));
  const dates = (rec.interactions || []).map(i => String(i.date || "").slice(0, 10));
  ok("§2 newest first", dates.every((d, i) => i === 0 || dates[i - 1] >= d), dates);

  // ── §3 search ───────────────────────────────────────────────────────────
  console.log("\n§3 search");
  const found = async (term, pred) => { const r = await api("GET", `/search?q=${encodeURIComponent(term)}`, dana); return r.status === 200 && JSON.stringify(r.body).includes(pred); };
  ok("§3 ⌘K finds Wren", await found("Wirefield", W));
  ok("§3 ⌘K finds the event", await found("Lantern Night", evId));
  ok("§3 ⌘K finds the giving page", await found("Reading Fund", pageId));

  // ── §4 the calendar ─────────────────────────────────────────────────────
  console.log("\n§4 the calendar");
  const cal = async (from, to) => ((await api("GET", `/calendar/items?from=${from}&to=${to}`, dana)).body.items || []);
  const near = await cal(today, civilPlusDays(30));
  ok("§4 the event is on the calendar", near.some(i => i.type === "event" && i.ref && i.ref.eventId === evId), near.map(i => i.id));
  ok("§4 the task is on the calendar", near.some(i => i.donorId === W && i.start.slice(0, 10) === taskDue), near.map(i => i.id));
  ok("§4 the coffee is on the calendar", near.some(i => i.type === "meeting" && i.donorId === W), near.map(i => i.id));
  const memEnd = mem && mem.expires;
  const later = memEnd ? await cal(memEnd, memEnd) : [];
  ok("§4 the membership's end is on the calendar", later.some(i => i.type === "membership" && i.donorId === W), { memEnd, items: later.map(i => i.id) });
  const ids = near.map(i => i.id);
  ok("§4 nothing is on it twice", new Set(near.map(i => `${i.type === "journey" || i.type === "step" ? "j" : i.type}|${i.donorId}|${i.start}|${i.title}`)).size === near.length, ids);

  // ── §5 the numbers ──────────────────────────────────────────────────────
  console.log("\n§5 the numbers");
  const gs = (await api("GET", `/reports/giving-summary?from=${year}-01-01&to=${today}`, dana)).body;
  const gsd = gs.d || gs;
  ok("§5 the giving summary is $150.50 from two gifts, to the cent", cents(gsd.total) === 15050 && gsd.giftCount === 2, { total: gsd.total, n: gsd.giftCount });
  const pageRows = (await api("GET", `/figures/gifts/rows?from=${year}-01-01&to=${today}&pageSize=50`, dana)).body;
  ok("§5 …and its rows foot to it", (pageRows.rows || []).reduce((s, r) => s + cents(r.amount), 0) === 15050, pageRows.rows);
  const hrs = (await api("GET", `/figures/volunteer-hours/rows?from=${year}-01-01&to=${today}&donor=${W}`, dana)).body;
  ok("§5 the hours figure is 3", Number(hrs.value) === 3, hrs.value);

  // ── §6 Ask ──────────────────────────────────────────────────────────────
  console.log("\n§6 Ask");
  const a = (await api("POST", "/ask", dana, { text: "what has Wren Wirefield done with us this year?" })).body;
  ok("§6 Ask answers about Wren", a.answered === true && a.donor && a.donor.id === W, { sentence: a.sentence, refused: a.refused });
  const part = k => (a.reasons || []).find(r => r.key === k);
  ok("§6 gave $150.50 in two gifts", part("gifts") && part("gifts").cents === 15050 && part("gifts").count === 2, part("gifts"));
  ok("§6 three hours", part("hours") && part("hours").hours === 3, part("hours"));
  for (const k of ["events", "memberships", "fundraising", "conversations", "journeys"]) ok(`§6 the ${k} line is there`, part(k) && part(k).count >= 1, part(k));
  let footed = 0;
  for (const r of a.reasons || []) {
    const b = (await api("GET", `/figures/${r.source.key}/rows?${new URLSearchParams({ ...r.source.params, page: "1", pageSize: "200" })}`, dana)).body;
    const rows = b.rows || [];
    const val = r.hours != null ? rows.reduce((s, x) => s + Number(x.amount), 0) : r.measure === "count" ? rows.length : rows.reduce((s, x) => s + cents(x.amount), 0);
    const want = r.hours != null ? r.hours : r.measure === "count" ? r.count : r.cents;
    if (val === want && rows.every(x => x.donorId === W)) footed++;
    else ok(`§6 "${r.label}" opens Wren's rows and foots`, false, { want, val, rows: rows.map(x => [x.donorId, x.amount]) });
  }
  ok("§6 every line opens Wren's rows and foots to it", footed > 0 && footed === (a.reasons || []).length, `${footed} of ${(a.reasons || []).length}`);

  // ── §7 Groups ───────────────────────────────────────────────────────────
  console.log("\n§7 Groups");
  const gr = await api("POST", "/groups", dana, { name: "Lantern Night guests", kind: "dynamic", rules: { attendedEvent: evId } });
  const gid = gr.body && (gr.body.id || (gr.body.group && gr.body.group.id));
  const gm = gid ? (await api("GET", `/figures/group-members/rows?group=${gid}`, dana)).body : {};
  ok("§7 a Group from the event's guests holds Wren", gr.status < 300 && (gm.rows || []).some(r => r.donorId === W), { gr: gr.body, rows: gm.rows });

  // ── §8 the merge ────────────────────────────────────────────────────────
  console.log("\n§8 the merge");
  const DUP = "d_wire1p_dup";
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,'Wren Wirefield','active','system:test','test')`, [DUP, ORG]);
  const dg = await api("POST", `/donors/${DUP}/gifts`, dana, { amount: "40.00", date: today, type: "cash", paymentMethod: "Check" });
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by) VALUES ('i_wire1p_dup',$1,$2,'note',$3,'Met at the boathouse','system:test')`, [ORG, DUP, today]);
  await q(`INSERT INTO calendar_events (id,org_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,owner_user_id,created_by,created_by_name)
           VALUES ('ce_wire1p_dup',$1,'google','ev_dup','Walk with Wren',NOW() + INTERVAL '2 days',NOW() + INTERVAL '2 days 1 hour',ARRAY[$2]::text[],$3,'system:test','test')`, [ORG, DUP, USER]);
  ok("§8 the duplicate has its own $40 gift", dg.status === 201, dg.body);
  const before = await q(`SELECT COALESCE(SUM(amount),0)::numeric s, COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]);
  const mg = await api("POST", "/data-health/merge", dana, { keptId: W, mergedId: DUP });
  ok("§8 the merge went through", mg.status < 300, mg.body);
  const after = await q(`SELECT COALESCE(SUM(amount),0)::numeric s, COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]);
  const mine = await q(`SELECT COALESCE(SUM(amount),0)::numeric s, COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, W]);
  ok("§8 no gift lost or doubled: $190.50 in three gifts, all Wren's", cents(after[0].s) === cents(before[0].s) && after[0].n === before[0].n && cents(mine[0].s) === 19050 && mine[0].n === 3, { before, after, mine });
  const [tot] = await q(`SELECT total_giving, gift_count FROM donors WHERE id=$1`, [W]);
  ok("§8 Wren's lifetime is $190.50", cents(tot.total_giving) === 19050 && Number(tot.gift_count) === 3, tot);
  const [walk] = await q(`SELECT COUNT(*)::int n FROM calendar_events WHERE org_id=$1 AND $2 = ANY(person_ids) AND title='Walk with Wren'`, [ORG, W]);
  ok("§8 the duplicate's meeting followed Wren", walk.n === 1, walk);
  const [note] = await q(`SELECT donor_id FROM interactions WHERE id='i_wire1p_dup'`);
  ok("§8 the duplicate's note followed Wren", note && note.donor_id === W, note);
  // No row anywhere still points at the duplicate, except its own soft-deleted
  // donor row and the merge's own record of what it did.
  const cols = await q(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'
                         AND (column_name ~ '(^|_)(donor|person)_id$' OR column_name IN ('person_ids','donor_id_a','donor_id_b','match_employer_id','tribute_donor_id','funder_donor_id'))`);
  const left = [];
  for (const c of cols) {
    if (/^(donor_merges|merge_|data_health|import_merges|deleted_records|fin_audit_log|audit)/.test(c.table_name)) continue;
    const cond = c.data_type === "ARRAY" ? `$1 = ANY(${c.column_name})` : `${c.column_name} = $1`;
    const [r] = await q(`SELECT COUNT(*)::int n FROM ${c.table_name} WHERE ${cond}`, [DUP]).catch(() => [{ n: 0 }]);
    if (r.n) left.push(`${c.table_name}.${c.column_name}`);
  }
  ok("§8 no row anywhere still points at the duplicate", left.length === 0, left);

  // ── §9 the funder ───────────────────────────────────────────────────────
  console.log("\n§9 the funder");
  const fdn = await api("POST", "/grant-funders", dana, { name: "Lantern Trust", funderType: "private_foundation", email: FUNDER_MAIL });
  const F = fdn.body && fdn.body.id;
  ok("§9 the funder is on file", fdn.status === 201 && F, fdn.body);
  await q(`UPDATE donors SET email=$1 WHERE id=$2 AND org_id=$3 AND email IS NULL`, [FUNDER_MAIL, F, ORG]);
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount_requested,officer_id,created_by,created_by_name)
           VALUES ('gr_wire1p',$1,'Lantern Trust',$2,'Saturday tutoring','submitted',2000,$3,'system:test','test')`, [ORG, F, USER]);
  const due = civilPlusDays(20);
  const ms = await api("POST", "/grants/gr_wire1p/milestones", dana, { kind: "report_due", dueDate: due });
  ok("§9 a report deadline", ms.status < 300, ms.body);
  const aw = await api("PUT", "/grants/gr_wire1p/award", dana, { amountAwarded: "2000.00", installmentCount: 2, frequency: "semiannual", firstDue: today });
  ok("§9 awarded in two instalments", aw.status === 200, aw.body);
  let ap = (await api("GET", "/grants/gr_wire1p/award-plan", dana)).body;
  const inst = ap.installments || [];
  const g1 = await api("POST", `/donors/${F}/gifts`, dana, { amount: (inst[0].amountCents / 100).toFixed(2), date: today, type: "cash", paymentMethod: "Check" });
  ap = (await api("GET", "/grants/gr_wire1p/award-plan", dana)).body;
  ok("§9 the first cheque links to the first instalment, to the cent", g1.status === 201 && ap.receivedCents === inst[0].amountCents && ap.installments[0].gift, ap);
  await api("POST", "/mailbox/google/sync", dana, { what: "mail" });
  const frec = (await api("GET", `/donors/${F}`, dana)).body;
  const flines = (frec.interactions || []).map(i => `${i.type}: ${i.note || ""}`);
  ok("§9 the emailed report is on the funder's history", flines.some(l => /^email:/i.test(l)), flines);
  ok("§9 the award is on the funder's history", flines.some(l => /award/i.test(l)), flines);
  ok("§9 the cheque is on the funder's history", (frec.gifts || []).some(g => cents(g.amount) === inst[0].amountCents), frec.gifts);
  const fcal = await cal(today, civilPlusDays(30));
  ok("§9 the report deadline is on the calendar", fcal.some(i => i.type === "deadline" && i.start.slice(0, 10) === due), fcal.map(i => i.id));
  ok("§9 ⌘K finds the funder", await found("Lantern Trust", F));
  const fa = (await api("POST", "/ask", dana, { text: "what has Lantern Trust done with us this year?" })).body;
  const fg = (fa.reasons || []).find(r => r.key === "gifts");
  ok("§9 Ask: the funder gave the first instalment this year", fg && fg.cents === inst[0].amountCents, { sentence: fa.sentence, fg });

  await wipe();
  stripeMock && stripeMock.close(); google.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); google.close(); await closeDb().catch(() => {}); process.exit(1); });
