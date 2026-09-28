// tests/build103-soft-credit.test.js — BUILD-103. THE ONE GUARD THIS BUILD EARNED.
//
// Peer-to-peer is the one feature in Steward where a person who is not the
// donor gets credit for the donor's money. That is exactly the shape of the
// bug that double-counts a nonprofit's year, so the thing worth pinning is:
//
//   a $100 gift through a fundraiser writes $100 HARD on the donor and $100
//   SOFT on the fundraiser, and no giving total anywhere moves by more than
//   $100.
//
// And the two ways the credit could land on the wrong person:
//
//   a fundraiser matched by NAME but not by email is not credited at all;
//   a new fundraiser is a person typed VOLUNTEER, never a donor.
//
// HOW IT WOULD GO RED. Match the fundraiser by name; write the soft credit
// as a second gift instead of a gift_soft_credits row; type a new fundraiser
// as a donor; or have any lifetime/total/report read the soft-credit table.
// Each one turns a different assertion below red. (Verified by planting the
// name match and the donor typing.)
//
// It runs against the scratch server + scratch Postgres, never production.
const http = require("http");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");
const ACCT = "acct_p2p1";

// The gift is written the way a real one is: through the giving page's own
// checkout and the payment webhook. Anything else would pin a path nobody
// uses, and the soft credit is written inside recordGift.
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
            metadata: Object.fromEntries([...p.entries()].filter(([k]) => k.startsWith("metadata["))
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

const ORG = "org_p2p1", PAGE = "gp_p2p1", SLUG = "p2p1-shore";
const rand = () => Math.random().toString(36).slice(2, 9);

async function reset() {
  const CHILD = ["gift_soft_credits", "p2p_teams", "peer_fundraisers", "giving_pages", "receipts",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "notification_sends", "tasks", "threads"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected)
           VALUES ($1,'P2P Shore Trust',$2,1,'active','growth',$3,true)`, [ORG, SLUG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_p2p1',$1,'p2p1@test.local',$2,'P2P Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acc_p2p1',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_p2p1',$1,'General',false)`, [ORG]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,goal_amount,status,p2p_enabled)
           VALUES ($1,$2,'shore-run','Shore Run',10000,'active',true)`, [PAGE, ORG]);
}

const signUp = (body) => fetch(`${BASE}/org/${SLUG}/giving-page/shore-run/fundraisers`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const totals = async donorId => {
  const [d] = await q(`SELECT total_giving::float AS total, gift_count FROM donors WHERE id=$1`, [donorId]);
  const [g] = await q(`SELECT COALESCE(SUM(amount),0)::float AS s, COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]);
  const [sc] = await q(`SELECT COALESCE(SUM(amount),0)::float AS s, COUNT(*)::int AS n FROM gift_soft_credits WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]);
  return { rollup: Number(d?.total || 0), giftCount: Number(d?.gift_count || 0),
           hard: Number(g?.s || 0), hardN: g?.n || 0, soft: Number(sc?.s || 0), softN: sc?.n || 0 };
};
const orgTotal = async () => {
  const [r] = await q(`SELECT COALESCE(SUM(amount),0)::float AS s FROM gifts WHERE org_id=$1`, [ORG]);
  return Number(r?.s || 0);
};

(async () => {
  console.log("BUILD-103 — a soft credit records who brought it in, and moves no total\n");
  mock = await startStripeMock();
  ok("the Stripe mock is listening (without it this suite proves nothing)", !!mock);
  await reset();
  const tok = await (async () => {
    const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "p2p1@test.local", password: "loadtest1234" }) });
    return (await r.json()).token;
  })();

  const suffix = rand();
  // ── A NEW FUNDRAISER IS A VOLUNTEER, NOT A DONOR ────────────────────────
  const newEmail = `wren.larkspur.${suffix}@p2p1.test`;
  const s1 = await signUp({ name: "Wren Larkspur", email: newEmail, personalGoalAmount: 500 });
  ok("a stranger can start a fundraiser", s1.status === 201, s1.body);
  const [wren] = await q(`SELECT id, name, person_types, total_giving::float AS total FROM donors WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, newEmail]);
  ok("…and becomes a person record", !!wren, wren);
  const types = Array.isArray(wren?.person_types) ? wren.person_types
    : (() => { try { return JSON.parse(wren?.person_types || "[]"); } catch { return []; } })();
  ok("…typed VOLUNTEER", types.includes("volunteer"), types);
  ok("…and NOT a donor: they have not given a penny", !types.includes("donor") && Number(wren.total) === 0, { types, total: wren.total });
  const [pfWren] = await q(`SELECT id, person_id, edit_token, edit_token_hash, team_id FROM peer_fundraisers WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, newEmail]);
  ok("the fundraiser points at that person record", pfWren?.person_id === wren.id, pfWren);
  ok("the manage token is stored hashed, never in the clear",
    /^[0-9a-f]{64}$/.test(pfWren?.edit_token_hash || "") && !String(pfWren?.edit_token || "").trim(),
    { hash: (pfWren?.edit_token_hash || "").slice(0, 12), plain: pfWren?.edit_token });
  ok("the manage link is never returned in the response", !JSON.stringify(s1.body).includes("manage"), s1.body);

  // ── A FUNDRAISER MATCHED BY NAME BUT NOT EMAIL IS NOT CREDITED ──────────
  // Somebody with the same name is already in the CRM, under a different
  // address. The match is EXACT EMAIL, so this is a different person.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,total_giving,created_by,created_by_name)
           VALUES ('d_p2p_namesake',$1,'Otto Beaumaris',$2,'steward','active','[]',4000,'system:test','p2p suite')`,
    [ORG, `otto.beaumaris.OTHER.${suffix}@p2p1.test`]);
  const s2 = await signUp({ name: "Otto Beaumaris", email: `otto.b.${suffix}@p2p1.test` });
  ok("a namesake can sign up", s2.status === 201, s2.body);
  const [pfOtto] = await q(`SELECT id, person_id FROM peer_fundraisers WHERE org_id=$1 AND slug=$2`, [ORG, s2.body.slug]);
  ok("…and is NOT matched to the person with the same name",
    pfOtto?.person_id && pfOtto.person_id !== "d_p2p_namesake", pfOtto);

  // ── THE $100 GIFT ───────────────────────────────────────────────────────
  const beforeOrg = await orgTotal();
  const beforeWren = await totals(wren.id);
  const beforeNamesake = await totals("d_p2p_namesake");

  // Through the real path: the giving page's checkout, then the payment
  // webhook that writes the gift. The donor does NOT tick the name box.
  seen.length = 0;
  const checkout = await fetch(`${BASE}/donate/${SLUG}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Ines", lastName: "Northcote", email: `ines.${suffix}@p2p1.test`,
      amount: "100", frequency: "once", peerFundraiserId: pfWren.id }),
  });
  ok("the giving page takes the gift to checkout", checkout.status === 200, await checkout.text().catch(() => ""));
  const sess = seen[0];
  ok("…priced at $100", sess && sess.unitAmount === 10000, sess);
  ok("…and the fundraiser rides the metadata", sess && sess.metadata.peer_fundraiser_id === pfWren.id, sess && sess.metadata);
  ok("…with the name NOT shared, because nobody ticked anything",
    sess && !sess.metadata.show_name_to_fundraiser, sess && sess.metadata);
  await fire({ id: "evt_p2p_1", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_p2p_1", object: "payment_intent", amount: 10000, amount_received: 10000,
      currency: "usd", metadata: { ...sess.metadata, org_id: ORG } } } });
  await settle();
  const [writtenGift] = await q(`SELECT id, donor_id, peer_fundraiser_id, giving_page_id, show_name_to_fundraiser FROM gifts WHERE org_id=$1`, [ORG]);
  ok("the payment wrote the gift", !!writtenGift, writtenGift);
  ok("…carrying BOTH the fundraiser and the parent page, so rollup is free",
    writtenGift?.peer_fundraiser_id === pfWren.id && writtenGift?.giving_page_id === PAGE, writtenGift);
  const giverId = writtenGift?.donor_id;

  const giver = await totals(giverId);
  const wrenAfter = await totals(wren.id);
  const afterOrg = await orgTotal();

  ok("$100 HARD on the donor", giver.hard === 100 && giver.hardN === 1, giver);
  ok("…and the donor's own rollup is $100", giver.rollup === 100, giver);
  ok("$100 SOFT on the fundraiser", wrenAfter.soft === 100 && wrenAfter.softN === 1, wrenAfter);
  ok("…and the fundraiser has NO gift of their own", wrenAfter.hard === 0 && wrenAfter.hardN === 0, wrenAfter);
  ok("…and the fundraiser's own giving total did not move",
    wrenAfter.rollup === beforeWren.rollup && wrenAfter.giftCount === beforeWren.giftCount, { before: beforeWren, after: wrenAfter });
  ok("the ORG's total moved by exactly $100, not $200",
    Math.round((afterOrg - beforeOrg) * 100) === 10000, { before: beforeOrg, after: afterOrg });
  ok("the namesake was credited nothing at all",
    JSON.stringify(await totals("d_p2p_namesake")) === JSON.stringify(beforeNamesake), await totals("d_p2p_namesake"));

  // The soft credit is a ROW POINTING AT THE GIFT, not a second gift.
  const [rowCount] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("there is ONE gift row in the org, not two", rowCount.n === 1, rowCount);
  const [sc] = await q(`SELECT gift_id, role, pct FROM gift_soft_credits WHERE org_id=$1 AND donor_id=$2`, [ORG, wren.id]);
  ok("the soft credit points at that same gift, at 100%", sc && sc.pct === "100.00" && sc.role === "peer_fundraiser", sc);

  // And the figure a person actually reads: the fundraiser's profile. The
  // page that tells somebody how much they have given must not have moved.
  const prof = await api("GET", `/donors/${wren.id}`, tok);
  const shownTotal = Number(prof.body?.donor?.total_giving ?? prof.body?.total_giving ?? 0);
  ok("the fundraiser's profile still shows $0 given", shownTotal === 0, shownTotal);

  // ── WHAT THE FUNDRAISER MAY READ OF THAT GIFT ───────────────────────────
  // This donor did not tick the box, so the dashboard says "Someone".
  const P2P = await import("../shared/p2p.js");
  const anon = P2P.donorLine({ donorName: "Ines Northcote", amountCents: 10000, showName: false, date: "2026-09-28" });
  ok("a donor who said nothing is 'Someone' on the dashboard", anon.who === "Someone" && anon.amount === "$100", anon);
  const named = P2P.donorLine({ donorName: "Ines Northcote", amountCents: 10000, showName: true, date: "2026-09-28" });
  ok("a donor who chose to be seen is a FIRST NAME and nothing more",
    named.who === "Ines" && !JSON.stringify(named).includes("Northcote"), named);
  ok("no donor line ever carries an email", !Object.keys(named).some(k => /mail/i.test(k)), Object.keys(named));

  // Tidy up.
  await reset();
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); if (mock) mock.close(); process.exit(1); });
