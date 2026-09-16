// BUILD-88a A.1 — ONE GIFT, ONE PATH. Run: node tests/build88a-one-gift.test.js
//
// Before this part there were five places that wrote a gift row and they did
// not agree about what a gift is. Two wrote no fund. Four wrote no payment
// method. Three bumped the donor's lifetime total with their own UPDATE. One —
// the event attendee row — used `ON CONFLICT DO NOTHING` with no conflict
// TARGET, so every re-save minted another gift and bumped the total again. And
// every one of them wrote its own timeline sentence with the AMOUNT COPIED INTO
// THE TEXT, which is why the Renee Castillo demo record showed one $5,000 gift
// twice: the profile drew it once from the gift row as a milestone and once
// from the sentence beside it.
//
//   §1  every door writes ONE gift row and ONE timeline entry, and the entry
//       LINKS to the gift instead of carrying a copy of its amount
//   §2  every gift carries a fund and a payment method, always
//   §3  the readers agree IN CENTS: the donor header total, Giving this year on
//       the Board dashboard, and the Finance ledger under the BUILD-83 posting
//       rule (imported history never posts; live gifts do)
//   §4  "Log a conversation" with an amount is a gift, and never a touchpoint
//       of type Other
//   §5  the event door is idempotent now — the duplicate factory is closed —
//       and the de-duplication script clears what it already made
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const stripe = require("stripe")("sk_test_dummy");
const { execFileSync } = require("child_process");
const path = require("path");
const { BASE, ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_b88a1";
const ACCT = "acct_b88a1";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const c = n => Math.round(Number(n) * 100);

async function reset() {
  for (const t of ["event_attendees", "events", "donor_relationships", "workflow_runs", "workflows", "threads",
    "digest_sends", "moves", "opportunities", "tasks", "recurring_subscriptions", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "milestone_drafts", "note_reminders",
    "fundraising_goals", "metric_snapshots", "donors", "campaigns", "fin_funds", "accounts", "budgets", "imports", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,'B88a One Gift','b88a-one-gift',1,'active','team',$2)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a1',$1,'b88a1@test.local',$2,'Fresh Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acct4010_b88a1',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88a1',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88a1r',$1,'Building Fund',true)`, [ORG]);
}

async function fireWebhook(evtId, piId, amountCents, email, name) {
  const payload = JSON.stringify({
    id: evtId, type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: amountCents, receipt_email: email, metadata: { donor_name: name } } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const giftsOf = id => q(`SELECT id, amount::float AS amount, fund_id, payment_method, type, date FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY date, id`, [ORG, id]);
const timelineOf = id => q(`SELECT id, type, note, gift_id FROM interactions WHERE org_id=$1 AND donor_id=$2 ORDER BY id`, [ORG, id]);

(async () => {
  await reset();
  const tok = await login("b88a1@test.local");
  const TODAY = civilToday();

  // Four donors, one per door, so a count is never ambiguous.
  const donors = {};
  for (const [key, name] of [["form", "Form Donor"], ["conv", "Conversation Donor"],
    ["stripe", "Stripe Donor"], ["import", "Import Donor"], ["event", "Event Donor"]]) {
    const id = `d_b88a1_${key}`;
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
             VALUES ($1,$2,$3,$4,'new','cultivate','u_b88a1','Fresh Admin')`,
      [id, ORG, name, `${key}@b88a1.test`]);
    donors[key] = id;
  }

  // ── §1 + §2 · every door ─────────────────────────────────────────────────
  console.log("\n— §1 · one gift row, one timeline entry, linked not copied —");

  // DOOR 1 — the gift form.
  const formRes = await api("POST", `/donors/${donors.form}/gifts`, tok,
    { amount: 250.55, date: TODAY, type: "cash", paymentMethod: "Check", fundId: "ff_b88a1r", notes: "Spring ask" });
  ok("the gift form records a gift", formRes.status === 201 || formRes.status === 200, { status: formRes.status, body: JSON.stringify(formRes.body).slice(0, 200) });

  // DOOR 2 — Log a conversation, with an amount.
  const convRes = await api("POST", `/donors/${donors.conv}/conversations`, tok, {
    touch: "gift", line: "She handed me the cheque at the gala.", date: TODAY,
    gift: { amount: "1,000.00", paymentMethod: "Check" },
    nextStep: { type: "thank_you_note", label: "Send thank-you note", due: TODAY },
  });
  ok("Log a conversation records a gift", convRes.status === 201, { status: convRes.status, body: JSON.stringify(convRes.body).slice(0, 200) });
  ok("…and says what it recorded, with the fund and the method it used",
    convRes.body?.gift?.id && convRes.body.gift.amount === 1000 && !!convRes.body.gift.fundId && convRes.body.gift.paymentMethod === "Check",
    convRes.body?.gift);

  // DOOR 3 — Stripe.
  const wh = await fireWebhook("evt_b88a1_1", "pi_b88a1_1", 7500, "stripe@b88a1.test", "Stripe Donor");
  ok("a Stripe charge records a gift", wh.status === 200 && !wh.body.duplicate, wh.body);

  // DOOR 4 — import.
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Import Donor", email: "import@b88a1.test" }],
    gifts: [{ donorIndex: 0, amount: 400, date: TODAY, type: "cash", fund: "Building Fund", paymentMethod: "ACH", externalId: "B88A1-1" }],
  });
  ok("an import records a gift", imp.status === 200 && imp.body.giftsInserted === 1, { status: imp.status, inserted: imp.body?.giftsInserted });

  // DOOR 5 — an event attendee.
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_b88a1',$1,'Spring Gala','gala',$2)`, [ORG, TODAY]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status)
           VALUES ('ea_b88a1','ev_b88a1',$1,$2,'Event Donor','invited')`, [ORG, donors.event]);
  const ev1 = await api("PATCH", `/events/ev_b88a1/attendees/ea_b88a1`, tok, { status: "attended", giftAmount: 120 });
  ok("an event attendee's gift records a gift", ev1.status === 200, ev1.status);

  for (const [key, expected] of [["form", 250.55], ["conv", 1000], ["stripe", 75], ["import", 400], ["event", 120]]) {
    const gs = await giftsOf(donors[key]);
    ok(`${key}: exactly ONE gift row, for $${expected}`,
      gs.length === 1 && c(gs[0].amount) === c(expected), gs);
    if (!gs.length) continue;
    const ints = await timelineOf(donors[key]);
    const linked = ints.filter(i => i.gift_id === gs[0].id);
    ok(`${key}: exactly ONE timeline entry links to that gift`, linked.length === 1, ints);
    ok(`${key}: the entry carries NO copy of the amount`,
      linked.length === 1 && !/\$\s*[\d,]/.test(String(linked[0].note || "")), linked[0]?.note);
    // §2 — a fund and a method, always.
    ok(`${key}: the gift carries a fund`, !!gs[0].fund_id, gs[0]);
    ok(`${key}: the gift carries a payment method`, String(gs[0].payment_method || "").trim() !== "", gs[0]);
  }
  console.log("\n— §2 · the defaults are NAMED, not blank —");
  const convGift = (await giftsOf(donors.conv))[0];
  ok("a conversation gift with no fund chosen takes the org's unrestricted fund",
    convGift && convGift.fund_id === "ff_b88a1", convGift);
  const formGift = (await giftsOf(donors.form))[0];
  ok("a fund the officer DID choose is honoured", formGift && formGift.fund_id === "ff_b88a1r", formGift);
  // The method a door cannot know says so rather than leaving a blank nobody can tell from "not looked at yet".
  const noMethod = await api("POST", `/donors/${donors.form}/conversations`, tok, {
    touch: "gift", line: "Cash in an envelope, no idea how.", date: TODAY,
    gift: { amount: 5 }, nextStep: { skipped: true },
  });
  ok("a gift whose method nobody stated reads \"Needs you\", never blank",
    noMethod.status === 201 && noMethod.body.gift.paymentMethod === "Needs you", noMethod.body?.gift);
  const importGift = (await giftsOf(donors.import))[0];
  ok("an imported gift keeps the fund and method its FILE named (A.7), not the default",
    importGift && importGift.payment_method === "ACH", importGift);

  // ── §3 · the readers agree, in cents ─────────────────────────────────────
  console.log("\n— §3 · header total, Board giving and the ledger agree in cents —");
  const allGifts = await q(`SELECT donor_id, amount::float AS amount, date FROM gifts WHERE org_id=$1`, [ORG]);
  const giftCents = allGifts.reduce((s, g) => s + c(g.amount), 0);

  const headerRows = await q(`SELECT COALESCE(SUM(total_giving),0)::float AS t FROM donors WHERE org_id=$1`, [ORG]);
  ok(`the donor header totals sum to every gift row, to the cent ($${(giftCents / 100).toFixed(2)})`,
    c(headerRows[0].t) === giftCents, { header: headerRows[0].t, gifts: giftCents / 100 });

  const board = await api("GET", "/dashboards/board", tok);
  ok("the Board dashboard reads", board.status === 200, board.status);
  const boardGiving = (board.body?.metrics || []).find(m => m.key === "revenueThisYear")?.value;
  ok(`Giving this year on the Board dashboard is the same figure, to the cent`,
    c(boardGiving) === giftCents, { board: boardGiving, gifts: giftCents / 100 });

  // The ledger, under the BUILD-83 posting rule: imported history NEVER posts.
  const txns = await q(`SELECT gift_id, amount::float AS amount FROM fin_transactions WHERE org_id=$1 AND source IN ('gift','online')`, [ORG]);
  const importedGiftIds = new Set((await q(`SELECT id FROM gifts WHERE org_id=$1 AND external_id IS NOT NULL`, [ORG])).map(r => r.id));
  const liveCents = allGifts.reduce((s, g) => s, 0) + (await q(
    `SELECT COALESCE(SUM(amount),0)::float AS t FROM gifts WHERE org_id=$1 AND external_id IS NULL`, [ORG]))
    .reduce((s, r) => s + c(r.t), 0);
  ok(`the ledger holds every LIVE gift and no imported one ($${(liveCents / 100).toFixed(2)})`,
    txns.reduce((s, t) => s + c(t.amount), 0) === liveCents
    && !txns.some(t => importedGiftIds.has(t.gift_id)),
    { ledger: txns.reduce((s, t) => s + c(t.amount), 0) / 100, live: liveCents / 100, txns: txns.length });
  ok("every ledger row points at exactly one gift — no gift stamped twice",
    new Set(txns.map(t => t.gift_id)).size === txns.length, txns.map(t => t.gift_id));

  // ── §4 · a conversation with an amount is a gift ─────────────────────────
  console.log("\n— §4 · \"Gift received\" is a gift, not a touchpoint of type Other —");
  const convInts = await timelineOf(donors.conv);
  ok("logging a conversation with an amount never creates a touchpoint of type Other",
    convInts.length && convInts.every(i => i.type !== "other"), convInts.map(i => i.type));
  ok("…it is typed `gift`, and it is the SAME row that links to the gift",
    convInts.filter(i => i.type === "gift" && i.gift_id).length === 1, convInts);
  ok("the conversation's own words survive on it — the line the user wrote, not a generated sentence",
    convInts.some(i => i.gift_id && /handed me the cheque/i.test(i.note || "")), convInts.map(i => i.note));

  // ── §5 · the duplicate factory, closed ───────────────────────────────────
  console.log("\n— §5 · the event door cannot mint a second gift, and the script clears what it made —");
  await api("PATCH", `/events/ev_b88a1/attendees/ea_b88a1`, tok, { status: "attended", giftAmount: 120 });
  await api("PATCH", `/events/ev_b88a1/attendees/ea_b88a1`, tok, { status: "attended", giftAmount: 120 });
  const evGifts = await giftsOf(donors.event);
  ok("three saves of the same attended attendee are still ONE gift (it was one per save)",
    evGifts.length === 1, evGifts);
  const [evDonor] = await q(`SELECT total_giving::float AS t, gift_count FROM donors WHERE id=$1`, [donors.event]);
  ok("…and the donor's lifetime total was bumped once, not three times",
    c(evDonor.t) === c(120) && evDonor.gift_count === 1, evDonor);

  // The rows an earlier build already made: two unkeyed twins, and the script.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_b88a1_dupe1',$1,$2,500,$3,'cash','ff_b88a1','Check'),
                  ('g_b88a1_dupe2',$1,$2,500,$3,'cash','ff_b88a1','Check')`,
    [ORG, donors.form, TODAY]);
  await q(`UPDATE donors SET total_giving = total_giving + 1000, gift_count = gift_count + 2 WHERE id=$1`, [donors.form]);
  const script = path.join(__dirname, "..", "scripts", "build88a-dedupe-gifts.js");
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" };
  const dry = execFileSync("node", [script, "--org", ORG], { env, encoding: "utf8" });
  ok("the de-duplication script finds the twins and, by default, only SAYS so",
    /DRY RUN/.test(dry) && /1 gift row/.test(dry), dry.split("\n").filter(Boolean).slice(-3).join(" | "));
  const stillTwo = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND id LIKE 'g_b88a1_dupe%'`, [ORG]);
  ok("…and a dry run deletes nothing", stillTwo[0].n === 2, stillTwo[0].n);
  const applied = execFileSync("node", [script, "--org", ORG, "--apply"], { env, encoding: "utf8" });
  ok("--apply removes the later row and keeps the earlier one", /1 rows deleted|1 gift row/.test(applied), applied.split("\n").filter(Boolean).slice(-1)[0]);
  const leftOver = await q(`SELECT id FROM gifts WHERE org_id=$1 AND id LIKE 'g_b88a1_dupe%'`, [ORG]);
  ok("exactly one of the twins survives", leftOver.length === 1, leftOver);
  const [formDonorAfter] = await q(`SELECT total_giving::float AS t, gift_count FROM donors WHERE id=$1`, [donors.form]);
  const formGiftsAfter = await giftsOf(donors.form);
  ok("the donor's total is RECOMPUTED from the gifts that remain, never decremented",
    c(formDonorAfter.t) === formGiftsAfter.reduce((s, g) => s + c(g.amount), 0)
    && formDonorAfter.gift_count === formGiftsAfter.length,
    { donor: formDonorAfter, gifts: formGiftsAfter.map(g => g.amount) });
  const orphanTxn = await q(
    `SELECT COUNT(*)::int n FROM fin_transactions f LEFT JOIN gifts g ON g.id=f.gift_id
      WHERE f.org_id=$1 AND f.gift_id IS NOT NULL AND g.id IS NULL`, [ORG]);
  ok("no ledger row is left pointing at a gift that no longer exists", orphanTxn[0].n === 0, orphanTxn[0].n);

  summary("build88a-one-gift");
  await closeDb();
})();
