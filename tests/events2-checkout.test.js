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
const { BASE, ok, summary, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

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
  const scan1 = await api("POST", `/events/${EVENT}/scan`, tok, { code: good });
  ok("a real ticket checks the person in", scan1.body?.ok === true && /Fen/.test(scan1.body.sentence || ""), scan1.body);
  const bad = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
  const scan2 = await api("POST", `/events/${EVENT}/scan`, tok, { code: bad });
  ok("an edited code is refused", scan2.body?.ok === false && scan2.body.reason === "tampered", scan2.body);
  const other = PASS.makePassCode({ kind: "ticket", orgId: "org_somebody_else", id: att[0].id, expiresOn: null, secret });
  const scan3 = await api("POST", `/events/${EVENT}/scan`, tok, { code: other });
  ok("a code signed for another org is refused here", scan3.body?.ok === false, scan3.body);

  // Tidy up.
  await reset();
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); if (mock) mock.close(); process.exit(1); });
