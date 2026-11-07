// BUILD-72 Part 3 — PLEDGE PAYMENT MATH.
//
// Part 0 verdict on F-5 was DIFFERENT FROM DESCRIBED: partial payments were
// already correct (BUILD-45 derived `paid` from linked gifts), but three of the
// brief's four decisions were violated. This suite pins all four.
//
//   §1  Payment ladders reaching the amount in 1, 2, 3 and 7 steps.
//   §2  A payment of exactly the full amount.
//   §3  OVERPAYMENT — PLEDGES-2: the form asks (an extra gift, or reduce to
//       the balance); the money always appears, never swallowed.
//   §4  A payment on an already-fulfilled pledge.
//   §5  Status is DERIVED, never an independent flag that can drift — both
//       drift vectors Part 0 found are refused or recomputed.
//   §6  Currency edges asserted in INTEGER CENTS, never floats.
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay } = require("./clock");

const ORG = "org_plmath";
const TODAY = civilDay();
// Money is compared in integer cents. Floats are never asserted on directly.
const cents = v => Math.round((Number(v) || 0) * 100);

async function reset() {
  await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["fin_transactions","interactions","receipts","gifts","pledges","donors","accounts","fin_funds","budgets","users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Pledge Math','pledge-math',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_plmath',$1,'plmath@test.local',$2,'Pledge Math','admin')`,
          [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count)
           VALUES ('d_plmath',$1,'Paula Ledger','paula@plmath.test','mid','cultivate',0,0)`, [ORG]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_plmath',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_plmath',$1,'General',false)`, [ORG]);
}

let tok;
const newPledge = async amount => {
  const r = await api("POST", "/donors/d_plmath/pledges", tok, {
    amount, dueDate: TODAY, idempotencyKey: crypto.randomUUID(),
  });
  return r.body.id;
};
const pay = (pledgeId, amount) => api("POST", "/donors/d_plmath/gifts", tok, {
  amount, date: TODAY, pledgeId, idempotencyKey: crypto.randomUUID(),
});
const readPledge = async pledgeId => {
  const r = await api("GET", "/donors/d_plmath/pledges", tok);
  return (r.body || []).find(p => p.id === pledgeId);
};
const storedStatus = async pledgeId =>
  (await q(`SELECT status, surplus_amount::float AS surplus FROM pledges WHERE id=$1`, [pledgeId]))[0];

(async () => {
  await reset();
  tok = await login("plmath@test.local");

  // ── §1 · ladders: 1, 2, 3 and 7 steps to the same $1,000 ─────────────────
  console.log("\n— §1 · payment ladders —");
  for (const steps of [1, 2, 3, 7]) {
    const amount = 1000;
    const pid = await newPledge(amount);
    // Split 1000 into `steps` whole-dollar parts that sum EXACTLY to 1000.
    const base = Math.floor(amount / steps);
    const parts = Array.from({ length: steps }, (_, i) => i === steps - 1 ? amount - base * (steps - 1) : base);
    ok(`ladder/${steps}: the parts sum to the pledge exactly`,
       parts.reduce((a, b) => a + b, 0) === amount, parts);

    let running = 0;
    for (let i = 0; i < parts.length; i++) {
      await pay(pid, parts[i]);
      running += parts[i];
      const p = await readPledge(pid);
      const last = i === parts.length - 1;
      ok(`ladder/${steps}: after step ${i + 1}, paid = $${running}`, cents(p.paid) === cents(running), p);
      ok(`ladder/${steps}: after step ${i + 1}, balance = $${amount - running}`,
         cents(p.balance) === cents(amount - running), p);
      ok(`ladder/${steps}: after step ${i + 1}, status is ${last ? "fulfilled" : (running ? "partially_fulfilled" : "open")}`,
         p.displayStatus === (last ? "fulfilled" : "partially_fulfilled"), p.displayStatus);
      ok(`ladder/${steps}: step ${i + 1} records no surplus`, cents(p.surplus) === 0, p.surplus);
    }
    const st = await storedStatus(pid);
    ok(`ladder/${steps}: stored status agrees with the payment total`, st.status === "fulfilled", st);
  }

  // ── §2 · a payment of exactly the full amount ────────────────────────────
  console.log("\n— §2 · exact payment —");
  const exactId = await newPledge(750);
  await pay(exactId, 750);
  const exact = await readPledge(exactId);
  ok("exact payment fulfills", exact.displayStatus === "fulfilled", exact.displayStatus);
  ok("exact payment leaves balance 0", cents(exact.balance) === 0, exact.balance);
  ok("exact payment records NO surplus", cents(exact.surplus) === 0, exact.surplus);

  // ── §3 · OVERPAYMENT — PLEDGES-2: the form asks, and every dollar lands ─
  // BUILD-72 took an overpayment silently as surplus. PLEDGES-2 (W-1107-Finance-25X)
  // makes it a question: what is over the balance is recorded as an extra gift,
  // or the payment is reduced to the balance. Never swallowed either way.
  console.log("\n— §3 · overpayment asks —");
  const overId = await newPledge(1000);
  await pay(overId, 400);
  const asked = await pay(overId, 900);   // $1,300 against a $1,000 pledge
  ok("the over-balance payment ASKS first (409), writing nothing", asked.status === 409 && asked.body.code === "over_balance", asked.status);
  ok("the question names the balance and what is over", cents(asked.body.balance) === cents(600) && cents(asked.body.extra) === cents(300), asked.body);
  const over1 = await api("POST", "/donors/d_plmath/gifts", tok, { amount: 900, date: TODAY, pledgeId: overId, overBalance: "extra_gift", idempotencyKey: crypto.randomUUID() });
  ok("as an extra gift: accepted", over1.status === 201, over1.status);
  ok("the extra $300 is its own gift, not on the pledge", over1.body.extraGift && cents(over1.body.extraGift.amount) === cents(300) && !over1.body.extraGift.pledge_id, over1.body.extraGift);
  const over = await readPledge(overId);
  ok("the pledge is fulfilled", over.displayStatus === "fulfilled", over.displayStatus);
  ok("the pledge shows $1,000 applied", cents(over.paid) === cents(1000), over.paid);
  ok("balance is 0 (not negative)", cents(over.balance) === 0, over.balance);
  ok("no surplus is left on the pledge", cents(over.surplus) === 0, over.surplus);
  const overGifts = await q(`SELECT COALESCE(SUM(amount),0)::float s FROM gifts WHERE donor_id='d_plmath' AND org_id=$1 AND (pledge_id=$2 OR notes='Given over the pledge balance.')`, [ORG, overId]);
  ok("every dollar the donor gave still exists as gifts", cents(overGifts[0].s) === cents(1300), overGifts[0]);

  // ── §4 · a payment on an ALREADY-fulfilled pledge ────────────────────────
  console.log("\n— §4 · payment on a fulfilled pledge —");
  const fulId = await newPledge(500);
  await pay(fulId, 500);
  const beforeExtra = await readPledge(fulId);
  ok("pledge is fulfilled before the extra payment", beforeExtra.displayStatus === "fulfilled", beforeExtra.displayStatus);
  const ask2 = await pay(fulId, 125);
  ok("a payment on a fulfilled pledge asks, offering only an extra gift", ask2.status === 409 && JSON.stringify(ask2.body.choices) === '["extra_gift"]', ask2.body);
  const extra = await api("POST", "/donors/d_plmath/gifts", tok, { amount: 125, date: TODAY, pledgeId: fulId, overBalance: "extra_gift", idempotencyKey: crypto.randomUUID() });
  ok("as an extra gift it is accepted", extra.status === 201 && cents(extra.body.gift.amount) === cents(125) && !extra.body.gift.pledge_id, extra.body.gift);
  const afterExtra = await readPledge(fulId);
  ok("it stays fulfilled", afterExtra.displayStatus === "fulfilled", afterExtra.displayStatus);
  ok("paid stays $500", cents(afterExtra.paid) === cents(500), afterExtra.paid);

  // ── §5 · status is DERIVED — both Part 0 drift vectors are closed ────────
  console.log("\n— §5 · status cannot drift from the money —");
  // Drift vector 1: raising the amount used to leave 'fulfilled' standing.
  const driftId = await newPledge(1000);
  await pay(driftId, 1000);
  ok("drift-1: fulfilled at $1,000", (await readPledge(driftId)).displayStatus === "fulfilled");
  const raised = await api("PUT", `/pledges/${driftId}`, tok, { amount: 5000, dueDate: TODAY });
  ok("drift-1: raising the amount is allowed", raised.status === 200, raised.body);
  const afterRaise = await readPledge(driftId);
  ok("drift-1: raising $1,000 → $5,000 REOPENS it (status recomputed)",
     afterRaise.displayStatus === "partially_fulfilled", afterRaise.displayStatus);
  ok("drift-1: and shows the real $4,000 outstanding", cents(afterRaise.balance) === cents(4000), afterRaise.balance);
  const raisedStored = await storedStatus(driftId);
  ok("drift-1: the STORED status agrees too (no second place to hide)",
     raisedStored.status === "open", raisedStored);

  // Drift vector 2: status was directly settable, independent of the money.
  const flagId = await newPledge(2000);
  const byHand = await api("PUT", `/pledges/${flagId}`, tok, { status: "fulfilled" });
  ok("drift-2: marking a pledge fulfilled BY HAND is refused", byHand.status === 400, byHand.body);
  ok("drift-2: the refusal explains what to do instead",
     byHand.body.error === "status_derived" && /payment/i.test(byHand.body.message || ""), byHand.body);
  const stillOpen = await storedStatus(flagId);
  ok("drift-2: the pledge is still open, with $0 paid", stillOpen.status === "open", stillOpen);

  // write_off IS a human decision, and remains settable.
  const woId = await newPledge(300);
  const woAsk = await api("PUT", `/pledges/${woId}`, tok, { status: "written_off" });   // PLEDGES-2: asks first
  ok("an unconfirmed write-off asks, naming the amount", woAsk.status === 409 && woAsk.body.code === "confirm_write_off" && /\$/.test(woAsk.body.sentence), woAsk.body);
  const wo = await api("PUT", `/pledges/${woId}`, tok, { status: "written_off", confirmed: true });
  ok("a write-off IS still a human decision", wo.status === 200, wo.body);
  ok("and it sticks", (await storedStatus(woId)).status === "written_off", await storedStatus(woId));
  await pay(woId, 300);
  ok("arithmetic never resurrects a written-off pledge",
     (await storedStatus(woId)).status === "written_off", await storedStatus(woId));

  // ── §6 · currency edges, in INTEGER CENTS ────────────────────────────────
  console.log("\n— §6 · currency edges (integer cents) —");
  const typeRows = await q(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name='gifts' AND column_name='amount')
         OR (table_name='pledges' AND column_name IN ('amount','surplus_amount'))`);
  ok("no money column on this path is a FLOAT",
     typeRows.every(r => /numeric|integer/.test(r.data_type)), typeRows);
  ok("all three money columns exist and are numeric", typeRows.length === 3, typeRows);

  // A pledge that does not divide evenly: 1000 / 3.
  const thirdsId = await newPledge(1000);
  await pay(thirdsId, 333);
  await pay(thirdsId, 333);
  let thirds = await readPledge(thirdsId);
  ok("uneven split: $666 of $1,000 paid", cents(thirds.paid) === cents(666), thirds.paid);
  ok("uneven split: $334 remains — no rounding drift", cents(thirds.balance) === cents(334), thirds.balance);
  ok("uneven split: still partially fulfilled", thirds.displayStatus === "partially_fulfilled", thirds.displayStatus);
  await pay(thirdsId, 334);
  thirds = await readPledge(thirdsId);
  ok("uneven split: the final $334 fulfills exactly", thirds.displayStatus === "fulfilled", thirds.displayStatus);
  ok("uneven split: balance lands exactly on 0", cents(thirds.balance) === 0, thirds.balance);
  ok("uneven split: no phantom surplus from float drift", cents(thirds.surplus) === 0, thirds.surplus);

  // BUILD-73 Part 2 — FIXED. BUILD-72 pinned this as a DOCUMENTED DEFECT: the
  // manual gift route rounded to whole dollars, so a $33.33 payment stored as
  // $33 and the pledge's balance was wrong by 33c from the moment it was paid.
  // The note there said "a future cents fix has to come here and change it
  // deliberately rather than by accident." This is that change, made
  // deliberately: the assertion is inverted, and it now pins the CORRECT
  // behaviour. See money.js and tests/money-cents.test.js.
  const centsId = await newPledge(100);
  await pay(centsId, 33.33);
  const centsRow = await q(`SELECT amount::text AS a FROM gifts WHERE pledge_id=$1`, [centsId]);
  ok("a $33.33 payment stores 3333 CENTS — the BUILD-72 defect is fixed",
     cents(centsRow[0].a) === 3333, centsRow[0]);
  const centsPledge = await readPledge(centsId);
  ok("...and the pledge balance is exact to the cent: $33.33 paid, $66.67 left",
     cents(centsPledge.paid) === 3333 && cents(centsPledge.balance) === 6667, centsPledge);

  // The three thirds of $100 that motivated the whole build: they must sum
  // back to exactly $100.00, with no phantom surplus and no missing cent.
  const thirdId = await newPledge(100);
  await pay(thirdId, 33.33);
  await pay(thirdId, 33.33);
  await pay(thirdId, 33.34);
  const thirdRow = await readPledge(thirdId);
  ok("$33.33 + $33.33 + $33.34 fulfills a $100 pledge EXACTLY",
     cents(thirdRow.paid) === 10000 && cents(thirdRow.balance) === 0
     && cents(thirdRow.surplus) === 0 && thirdRow.displayStatus === "fulfilled", thirdRow);

  await closeDb();
  summary();
})();
