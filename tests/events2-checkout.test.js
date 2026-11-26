// tests/events2-checkout.test.js — EVENTS-2. THE ONE GUARD THIS BUILD EARNED.
//
// EVENTS-1 refused to take a card on the public event page, and said why in
// the code: "a page that takes a card and does not reliably finish the
// registration charges somebody for a seat they do not get". This build takes
// the card. So the two things that would make that refusal right are the two
// things pinned here:
//
//   1. A CHECKOUT THAT NEVER COMPLETES CONFIRMS NO REGISTRATION and gives its
//      seats back. No attendee, no gift, and the places are on sale again once
//      the hold runs out.
//   2. A TAMPERED PRICE STILL CHARGES THE EVENT'S PRICE. The page may post any
//      amount it likes; the server prices from the level, and the member price
//      is applied only when the server itself finds a current membership.
//
// HOW IT WOULD GO RED. Move the registration out of the webhook and into the
// checkout route; drop the hold from the capacity sum; read `amount` from the
// body for an event ticket; or trust a client-sent "I am a member". Each one
// turns a different assertion below red. (Verified by planting the first and
// the third.)
//
// It runs against the scratch server + scratch Postgres, never production.
const http = require("http");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, STRIPE_MOCK_PORT, civilPlusDays } = require("./helpers");

const ORG = "org_ev2", ACCT = "acct_ev2", EVENT = "ev_ev2", SLUG = "ev2-shore-run-test";
const LEVEL = "evl_ev2_adult";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");

// What the mock was ASKED to charge. The tamper assertion reads this, because
// the only honest place to check the price is the request that reaches Stripe.
const seen = [];
let mock;
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/\/v1\/checkout\/sessions/.test(req.url) && req.method === "POST") {
          const p = new URLSearchParams(b);
          const id = "cs_test_" + Math.random().toString(36).slice(2, 12);
          seen.push({ id, unitAmount: Number(p.get("line_items[0][price_data][unit_amount]")),
                      name: p.get("line_items[0][price_data][product_data][name]"),
                      metadata: Object.fromEntries([...p.entries()]
                        .filter(([k]) => k.startsWith("metadata["))
                        .map(([k, v]) => [k.slice(9, -1), v])) });
          res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const settle = (ms = 900) => new Promise(r => setTimeout(r, ms));

async function reset() {
  const CHILD = ["event_seat_holds", "event_waitlist", "event_attendees", "event_levels", "events",
    "memberships", "membership_levels", "receipts", "fin_audit_log", "fin_transactions", "gifts",
    "interactions", "notification_sends", "recurring_subscriptions", "tasks", "threads"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,
                             stripe_account_id,stripe_connected)
           VALUES ($1,'Shore Run Trust','ev2-shore',1,'active','growth',$2,true)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_ev2',$1,'ev2@test.local',$2,'Ev2 Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acc_ev2',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_ev2',$1,'General',false)`, [ORG]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug,location,created_by,created_by_name)
           VALUES ($1,$2,'Shore Run','other', CURRENT_DATE + 30, 'upcoming', $3, 'The shore', 'u_ev2','Ev2 Admin')`,
    [EVENT, ORG, SLUG]);
  // $40 a place, $10 of it is what they get on the day, $30 for a member,
  // and there are exactly THREE places — so a hold is visible in the count.
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,member_price,capacity,position,created_by,created_by_name)
           VALUES ($1,$2,$3,'ticket','Adult entry',40,10,30,3,0,'u_ev2','Ev2 Admin')`, [LEVEL, ORG, EVENT]);
}

const form = body => fetch(`${BASE}/e/${SLUG}/checkout`, {
  method: "POST", redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
});

const holds = () => q(
  `SELECT id, qty, confirmed_at, expires_at FROM event_seat_holds WHERE org_id=$1 ORDER BY created_at`, [ORG]);
const attendees = () => q(
  `SELECT id, name, email, quantity, registration_gift_id, dietary FROM event_attendees WHERE org_id=$1 AND quantity > 0`, [ORG]);
const gifts = () => q(`SELECT id, amount::float AS amount, quid_pro_quo_value::float AS qpq, event_id FROM gifts WHERE org_id=$1`, [ORG]);

// ── EVENTS-4 · AN ORG WITH NO PAYMENTS ────────────────────────────────────
// "$0 tickets cannot be created", "Delete event opens an Archive dialog",
// "check-in search cannot find invited-only guests" (fleet, 22-23 Nov).
// Its own org, with NO Stripe: a free ticket is made, registered on the public
// page and checked in, and writes no gift; a paid ticket is made and saved but
// is not on sale; the event with a guest is archived, not deleted, and says
// so; the door finds an invited-only guest; a published shift with a sign-up
// is removed through removal.js, its sign-up cancelled, and Undo restores it.
// HOW IT GOES RED on main: the $0 level is refused (400), the page is "Not open
// yet" (404), the kiosk has no `others`, the removal plan has no `line`, and a
// shift's sign-up is not cancelled. Each is its own assertion below.
const O4 = "org_ev4", E4 = "ev_ev4", SLUG4 = "ev4-free-supper-test";
async function reset4() {
  for (const t of ["volunteer_signups", "volunteer_slot_roles", "volunteer_slots", "volunteer_opportunities", "deleted_records",
    "event_seat_holds", "event_waitlist", "event_attendees", "event_levels", "events", "gifts", "pledges", "receipts", "fin_transactions",
    "fin_audit_log", "interactions", "notification_sends", "tasks", "threads", "write_effects"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [O4]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [O4]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [O4]).catch(() => {});
}
async function events4FreeNoStripe() {
  await reset4();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_connected)
           VALUES ($1,'Free Supper Club','ev4-free',1,'active','growth',false)`, [O4]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ev4',$1,'ev4@test.local',$2,'Ev4 Admin','admin')`,
    [O4, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug,created_by,created_by_name)
           VALUES ($1,$2,'Free Supper','other', $4::date, 'upcoming', $3, 'u_ev4','Ev4 Admin')`, [E4, O4, SLUG4, civilPlusDays(20)]);
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ev4@test.local", password: "loadtest1234" }) });
  const tok = (await r.json()).token;
  ok("§EVENTS-4 signed in to the org with no payments", !!tok);

  // 1. Ticket types with no Stripe.
  const free = await api("POST", `/events/${E4}/levels`, tok, { kind: "ticket", name: "Supper place", price: 0, capacity: 5 });
  ok("§EVENTS-4 a $0 ticket is created with no payments connected", free.status === 201 && !!free.body?.id, free);
  const paid = await api("POST", `/events/${E4}/levels`, tok, { kind: "ticket", name: "Patron place", price: 60, fmv: 20 });
  ok("§EVENTS-4 a paid ticket is created and saved with no payments connected", paid.status === 201, paid);
  const blank = await api("POST", `/events/${E4}/levels`, tok, { kind: "ticket", name: "No price", price: "" });
  ok("§EVENTS-4 an empty price is not a free ticket", blank.status === 400, blank);
  const freeSponsor = await api("POST", `/events/${E4}/levels`, tok, { kind: "sponsor", name: "Free sponsor", price: 0 });
  ok("§EVENTS-4 a sponsorship is still more than $0", freeSponsor.status === 400, freeSponsor);
  const edit = await api("PUT", `/event-levels/${free.body?.id}`, tok, { name: "Supper seat", price: 0 });
  ok("§EVENTS-4 a $0 ticket can be edited", edit.status === 200, edit);

  // 2. The public page opens for the free ticket; the paid one says it is not on sale.
  const pageRes = await fetch(`${BASE}/e/${SLUG4}`);
  const html = await pageRes.text();
  ok("§EVENTS-4 the public page opens with a free ticket and no payments", pageRes.status === 200 && !/Opens soon|Not open yet/.test(html), pageRes.status);
  ok("§EVENTS-4 the paid ticket alone says it goes on sale once payments are connected",
    (html.match(/Tickets go on sale once payments are connected\./g) || []).length === 1 && /Supper seat/.test(html), html.length);
  const reg = await fetch(`${BASE}/e/${SLUG4}/register`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ levelId: free.body?.id, name: "Ida Free", email: "ida.free@example.test", quantity: "2" }).toString() });
  const regHtml = await reg.text();
  ok("§EVENTS-4 a $0 registration from the public page goes through", reg.status === 200 && /You are registered for Free Supper/.test(regHtml), reg.status);
  const [att] = await q(`SELECT id, status, quantity, registration_gift_id FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND email='ida.free@example.test'`, [O4, E4]);
  ok("§EVENTS-4 …as a registered guest holding two places", att && att.status === "registered" && Number(att.quantity) === 2 && !att.registration_gift_id, att);
  const [g] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [O4]);
  ok("§EVENTS-4 …and a $0 registration makes no gift row", g.n === 0, g);
  const paidReg = await fetch(`${BASE}/e/${SLUG4}/register`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ levelId: paid.body?.id, name: "Pat Paid", email: "pat.paid@example.test" }).toString() });
  ok("§EVENTS-4 a paid ticket is not sold with no payments", paidReg.status === 400 && /Tickets go on sale once payments are connected/.test(await paidReg.text()), paidReg.status);
  const staffFree = await api("POST", `/events/${E4}/register`, tok, { name: "Sam Staff", email: "sam.staff@example.test", levelId: free.body?.id, quantity: 1 });
  const [g2] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [O4]);
  ok("§EVENTS-4 the staff Register on a free ticket makes no gift either", staffFree.status === 201 && g2.n === 0, staffFree);

  // 3. Check-in and counts; the door finds an invited-only guest.
  const kiosk = await api("GET", `/events/${E4}/kiosk`, tok);
  const ida = (kiosk.body?.guests || []).find(x => x.email === "ida.free@example.test");
  ok("§EVENTS-4 the free guest is expected at the door", !!ida && kiosk.body.expected === 2, kiosk.body?.expected);
  const inRes = await api("POST", `/events/${E4}/check-in`, tok, { attendeeId: ida && ida.id, forShiftDate: true });
  ok("§EVENTS-4 …and checks in", inRes.body?.ok === true, inRes.body);
  await api("POST", `/events/${E4}/attendees`, tok, { name: "Ina Invited", email: "ina.invited@example.test" });
  const kiosk2 = await api("GET", `/events/${E4}/kiosk`, tok);
  ok("§EVENTS-4 check-in search finds an invited-only guest (not in the expected count)",
    (kiosk2.body?.others?.invited || []).some(x => x.email === "ina.invited@example.test") && kiosk2.body.expected === 2 && kiosk2.body.checkedIn === 1,
    JSON.stringify(kiosk2.body?.others || null).slice(0, 300));
  const before = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND LOWER(email)='ina.invited@example.test'`, [O4]);
  const walk = await api("POST", `/events/${E4}/attendees`, tok, { name: "Ina I.", email: "INA.INVITED@example.test" });
  const after = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND LOWER(email)='ina.invited@example.test'`, [O4]);
  ok("§EVENTS-4 Add at the door matches the person by email first, no duplicate", walk.status === 200 && before[0].n === 1 && after[0].n === 1 && (walk.body?.ids || []).length === 1, walk.body);

  // 4. The event with a guest says Archive, with one line, and Delete refuses.
  const rm = await api("GET", `/events/${E4}/removal`, tok);
  ok("§EVENTS-4 the event with guests offers Archive, and says what it holds", rm.body?.canDelete === false && /^Has .*guest.*, so it's archived, not deleted\.$/.test(rm.body?.line || ""), rm.body);
  const del = await api("DELETE", `/events/${E4}`, tok);
  ok("§EVENTS-4 …and DELETE refuses it", del.status === 409, del.status);

  // 5. A published shift with a sign-up: the plan names them; removing cancels it; Undo restores it.
  const opp = await api("POST", "/volunteer-hub/opportunities", tok, { name: "Supper crew" });
  const oppId = opp.body?.id || opp.body?.opportunity?.id;
  const day = civilPlusDays(20);
  const sl = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: oppId, eventId: E4, date: day, startTime: "17:00", endTime: "19:00", name: "Washing up" });
  const sl2 = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: oppId, date: day, startTime: "19:00", endTime: "20:00", name: "Empty shift" });
  const [vol] = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(email)='ida.free@example.test'`, [O4]);
  await api("POST", "/volunteer-hub/signups", tok, { slotId: sl.body?.id, personId: vol && vol.id });
  const emptyGo = await api("POST", `/volunteer-hub/removals/shift/${sl2.body?.id}`, tok, {});
  ok("§EVENTS-4 a published shift with no sign-ups deletes in one step", emptyGo.status === 200 && emptyGo.body?.mode === "delete", emptyGo.body);
  const plan = await api("GET", `/volunteer-hub/removals/shift/${sl.body?.id}`, tok);
  ok("§EVENTS-4 a shift with sign-ups asks first, naming them", plan.body?.mode === "retire" && /Ida Free is signed up/.test(plan.body?.body || ""), plan.body);
  const go = await api("POST", `/volunteer-hub/removals/shift/${sl.body?.id}`, tok, {});
  const [su] = await q(`SELECT status FROM volunteer_signups WHERE org_id=$1 AND slot_id=$2`, [O4, sl.body?.id]);
  ok("§EVENTS-4 …removing it cancels their sign-up", go.status === 200 && su && su.status === "cancelled", su);
  const undo = await api("POST", "/volunteer-hub/removals/undo", tok, { undoIds: go.body?.undoIds });
  const [su2] = await q(`SELECT status FROM volunteer_signups WHERE org_id=$1 AND slot_id=$2`, [O4, sl.body?.id]);
  const [slot] = await q(`SELECT cancelled_at FROM volunteer_slots WHERE id=$1`, [sl.body?.id]);
  ok("§EVENTS-4 …and Undo puts the shift and the sign-up back", undo.status === 200 && su2 && su2.status === "confirmed" && slot && !slot.cancelled_at, { su2, slot });
  await reset4();
}

(async () => {
  console.log("EVENTS-2 — a seat is confirmed by the payment, and the server sets the price\n");
  mock = await startStripeMock();
  ok("the Stripe mock is listening (without it this suite proves nothing)", !!mock);
  await reset();

  // ── 1. A CHECKOUT THAT NEVER COMPLETES ──────────────────────────────────
  const r1 = await form({ levelId: LEVEL, name: "Ada Quillfeather", email: "ada@ev2.test", quantity: "1" });
  ok("the page sends the buyer to Stripe", r1.status === 303 && /checkout\.stripe\.test/.test(r1.headers.get("location") || ""),
    { status: r1.status, loc: r1.headers.get("location") });
  const h1 = await holds();
  ok("a seat is held while they pay", h1.length === 1 && h1[0].qty === 1, h1);
  ok("…and nobody is registered yet", (await attendees()).length === 0);
  ok("…and no gift was written", (await gifts()).length === 0);

  // The seat is really gone from the count: two more people cannot take all
  // three places while one is held.
  const r2 = await form({ levelId: LEVEL, name: "Bo Marchbanks", email: "bo@ev2.test", quantity: "3" });
  ok("a held seat counts against capacity", r2.status === 303 && /problem=/.test(r2.headers.get("location") || ""),
    r2.headers.get("location"));

  // ── 2. AND THE SEATS COME BACK ──────────────────────────────────────────
  await q(`UPDATE event_seat_holds SET expires_at = NOW() - INTERVAL '1 minute' WHERE org_id=$1`, [ORG]);
  const r3 = await form({ levelId: LEVEL, name: "Bo Marchbanks", email: "bo@ev2.test", quantity: "3" });
  ok("an expired hold gives its seat back", r3.status === 303 && /checkout\.stripe\.test/.test(r3.headers.get("location") || ""),
    r3.headers.get("location"));
  ok("an abandoned checkout still registered nobody", (await attendees()).length === 0);
  await q(`UPDATE event_seat_holds SET released_at = NOW() WHERE org_id=$1 AND confirmed_at IS NULL`, [ORG]);

  // ── 3. A TAMPERED PRICE STILL CHARGES THE EVENT'S PRICE ─────────────────
  seen.length = 0;
  await form({ levelId: LEVEL, name: "Cleo Ravensmere", email: "cleo@ev2.test", quantity: "2",
               amount: "1", coverFees: "true", frequency: "monthly" });
  const tampered = seen[seen.length - 1];
  ok("a posted amount of $1 still charges 2 × $40", tampered && tampered.unitAmount === 8000, tampered);
  ok("…and it is a one-off, not the monthly the form asked for",
    tampered && !/recurring/.test(JSON.stringify(tampered)), tampered && tampered.name);
  ok("…and the level and quantity ride the metadata for the webhook to re-read",
    tampered && tampered.metadata.event_level_id === LEVEL && tampered.metadata.event_qty === "2", tampered && tampered.metadata);

  // A client claiming to be a member changes nothing: the server looks. This
  // one goes STRAIGHT at /donate, the JSON route, because that is the actual
  // attack surface — the event page's own form cannot carry a field the shim
  // does not build, so posting through it would prove nothing.
  seen.length = 0;
  const claim = await fetch(`${BASE}/donate/ev2-shore`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Dov", lastName: "Ashgrove", email: "dov@ev2.test",
      amount: "1", eventLevelId: LEVEL, quantity: 1,
      memberPrice: true, member: true, eventMemberPriced: "1", isMember: true, memberPriceCents: 1 }),
  });
  ok("a direct post is accepted", claim.status === 200, claim.status);
  ok("saying you are a member does not make you one", seen[0] && seen[0].unitAmount === 4000, seen[0]);
  ok("…and the server says the member price was NOT applied", seen[0] && !seen[0].metadata.event_member_price, seen[0] && seen[0].metadata);

  // …but a real, current membership on that email does.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name)
           VALUES ('d_ev2_mem',$1,'Elspeth Northcote','elspeth@ev2.test','steward','active','[]','system:test','ev2 suite')`, [ORG]);
  await q(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term,created_by,created_by_name)
           VALUES ('mbl_ev2',$1,'Friend',50,0,'12_months','u_ev2','Ev2 Admin')`, [ORG]);
  await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status,source,created_by,created_by_name)
           VALUES ('mb_ev2',$1,'d_ev2_mem','mbl_ev2', CURRENT_DATE - 30, CURRENT_DATE - 30, CURRENT_DATE + 300,'active','staff','u_ev2','Ev2 Admin')`, [ORG]);
  // Give the seats back first: the holds from the tamper checks above are
  // real holds, and three of three places are spoken for.
  await q(`UPDATE event_seat_holds SET released_at = NOW() WHERE org_id=$1 AND confirmed_at IS NULL`, [ORG]);
  seen.length = 0;
  await form({ levelId: LEVEL, name: "Elspeth Northcote", email: "ELSPETH@ev2.test", quantity: "1" });
  ok("a real current membership on that email gets the member price", seen[0] && seen[0].unitAmount === 3000, seen[0]);
  ok("…and the server says so in the metadata, not the page", seen[0] && seen[0].metadata.event_member_price === "1", seen[0] && seen[0].metadata);
  await q(`UPDATE event_seat_holds SET released_at = NOW() WHERE org_id=$1 AND confirmed_at IS NULL`, [ORG]);

  // ── 4. THE PAYMENT IS WHAT CONFIRMS ─────────────────────────────────────
  seen.length = 0;
  await form({ levelId: LEVEL, name: "Fen Underhill", email: "fen@ev2.test", quantity: "2",
               guests: "Fen Underhill\nGus Underhill", dietary: "One vegetarian" });
  const live = seen[0];
  ok("the buyer reached Stripe at 2 × $40", live && live.unitAmount === 8000, live);
  const before = (await attendees()).length;
  ok("still nobody registered on the strength of a Checkout session", before === 0, before);

  await fire({
    id: "evt_ev2_1", type: "payment_intent.succeeded",
    account: ACCT,
    data: { object: { id: "pi_ev2_1", object: "payment_intent", amount: 8000, amount_received: 8000, currency: "usd",
      metadata: { ...live.metadata, org_id: ORG } } },
  });
  await settle();
  const att = await attendees();
  const gs = await gifts();
  ok("the payment is what puts them on the list", att.length === 1 && /Fen/.test(att[0].name), att);
  ok("…with the second name on the ticket beside them",
    (await q(`SELECT name FROM event_attendees WHERE org_id=$1 AND quantity=0`, [ORG])).some(r => /Gus/.test(r.name)));
  ok("…and what they said about food", att.length === 1 && /vegetarian/i.test(att[0].dietary || ""), att[0] && att[0].dietary);
  ok("the money is one gift of $80, stamped with the event", gs.length === 1 && gs[0].amount === 80 && gs[0].event_id === EVENT, gs);
  ok("…carrying the fair-market split, so the receipt states the deductible part",
    gs.length === 1 && gs[0].qpq === 20, gs[0] && gs[0].qpq);
  const confirmedHold = (await holds()).find(h => h.confirmed_at);
  ok("the hold became a seat rather than expiring", !!confirmedHold, await holds());

  // A redelivered webhook writes no second registration and no second gift.
  await fire({
    id: "evt_ev2_1", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_ev2_1", object: "payment_intent", amount: 8000, amount_received: 8000, currency: "usd",
      metadata: { ...live.metadata, org_id: ORG } } },
  });
  await settle();
  ok("a redelivered payment adds no second gift", (await gifts()).length === 1);
  ok("…and no second place", (await attendees()).length === 1);

  // ── 5. THE DOOR READS THE TICKET, AND NOT SOMEBODY ELSE'S ───────────────
  const tok = await (async () => {
    const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ev2@test.local", password: "loadtest1234" }) });
    return (await r.json()).token;
  })();
  const PASS = await import("../shared/passCode.js");
  const secret = process.env.JWT_SECRET || "local-test-secret";
  const good = PASS.makePassCode({ kind: "ticket", orgId: ORG, id: att[0].id, expiresOn: null, secret });
  const scan1 = await api("POST", `/events/${EVENT}/scan`, tok, { code: good, forShiftDate: true });
  ok("a real ticket checks the person in", scan1.body?.ok === true && /Fen/.test(scan1.body.sentence || ""), scan1.body);
  const bad = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
  const scan2 = await api("POST", `/events/${EVENT}/scan`, tok, { code: bad, forShiftDate: true });
  ok("an edited code is refused", scan2.body?.ok === false && scan2.body.reason === "tampered", scan2.body);
  const other = PASS.makePassCode({ kind: "ticket", orgId: "org_somebody_else", id: att[0].id, expiresOn: null, secret });
  const scan3 = await api("POST", `/events/${EVENT}/scan`, tok, { code: other, forShiftDate: true });
  ok("a code signed for another org is refused here", scan3.body?.ok === false, scan3.body);

  await events4FreeNoStripe();

  // Tidy up.
  await reset();
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); if (mock) mock.close(); process.exit(1); });
