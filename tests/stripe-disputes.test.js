// BUILD-58 Part 3 — dispute / chargeback handling, driven by the REAL Stripe
// dispute payload recorded by scripts/build58-stripe-drill.js §C
// (tests/fixtures/external/stripe-charge.dispute.created.json). The whole
// point of the fixture-provenance property: this suite runs the deterministic
// created → (won | lost) lifecycle against the recorded shape, so the
// behavior stays pinned without a live Stripe on every CI run.
//
// Contract (the boundary drill found NONE of this existed before):
//   • charge.dispute.created — the gift is FLAGGED (disputed_at, dispute_status)
//     and a LOUD high-priority staff task is created. NOT reversed (the money
//     is only held; the org may win). Idempotent.
//   • charge.dispute.closed / won — flag → won, gift kept, funds reinstated note.
//   • charge.dispute.closed / lost — reversed exactly like a full refund
//     (receipt voided, ledger stamp + gift removed, donor total recalced).

const { ok, summary, q, closeDb, BASE } = require("./helpers");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const uniq = () => Math.random().toString(36).slice(2, 8);
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));

function signAndSend(type, object, account) {
  const payload = JSON.stringify({ id: "evt_" + uniq(), type, account, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  return fetch(BASE + "/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
    body: payload,
  }).then(r => r.json().catch(() => ({})));
}

async function seedGift(orgId, donorId, piId, amount) {
  const giftId = "g_" + uniq();
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, stripe_payment_id) VALUES ($1,$2,$3,$4,$5,'cash',$6)`,
    [giftId, orgId, donorId, amount, new Date().toISOString().slice(0, 10), piId]);
  // one ledger stamp + one active receipt, the shape a real online gift leaves
  const [acct] = await q(`SELECT id FROM accounts WHERE org_id=$1 AND code='4010' LIMIT 1`, [orgId]);
  const [fund] = await q(`SELECT id FROM fin_funds WHERE org_id=$1 AND restricted=false LIMIT 1`, [orgId]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id) VALUES ($1,$2,$3,'Online gift','D',$4,'income',$5,$6,$7,'online',$8)`,
    ["ft_" + uniq(), orgId, new Date().toISOString().slice(0, 10), amount, acct.id, fund.id, donorId, giftId]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,pdf_data) VALUES ($1,$2,$3,$4,'gift',$5,$6,$6,'{}','')`,
    ["rcpt_" + uniq(), orgId, donorId, giftId, "2026-" + uniq(), amount]);
  await q(`UPDATE donors SET total_giving=total_giving+$1, gift_count=gift_count+1 WHERE id=$2`, [amount, donorId]);
  return giftId;
}

(async () => {
  console.log("stripe-disputes (BUILD-58 Part 3)");

  // ── the recorded real dispute payload is the fixture ─────────────────────
  const fixPath = path.join(__dirname, "fixtures", "external", "stripe-charge.dispute.created.json");
  ok("recorded real dispute fixture exists", fs.existsSync(fixPath), fixPath);
  const fixture = JSON.parse(fs.readFileSync(fixPath, "utf8"));
  ok("fixture carries provenance (real Stripe, test mode)", fixture._provenance?.service === "stripe" && fixture._provenance?.mode === "test", fixture._provenance);
  const disputeShape = fixture.event.data.object;
  ok("fixture is a charge.dispute.created payload", fixture.event.type === "charge.dispute.created" && disputeShape.object === "dispute", fixture.event.type);

  // ── fixture org (chart of accounts provisioned by ensureOrgLedger) ───────
  const acctId = "acct_disp_" + uniq();
  const orgId = "org_disp_" + uniq();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,stripe_account_id) VALUES ($1,'Dispute Org',$2,1,'trial','trialing',$3)`,
    [orgId, "disp-" + uniq(), acctId]);
  // provision the ledger the way a real org gets it (register calls ensureOrgLedger)
  const [a] = await q(`SELECT id FROM accounts WHERE org_id=$1 AND code='4010'`, [orgId]);
  if (!a) {
    await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype) VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions')`, ["acc_" + uniq(), orgId]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, ["ff_" + uniq(), orgId]);
  }
  const donorId = "d_disp_" + uniq();
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count) VALUES ($1,$2,'Dispute Donor','dd@x.org',0,0)`, [donorId, orgId]);

  const useShape = (piId, over = {}) => ({ ...disputeShape, id: "dp_" + uniq(), payment_intent: piId, charge: "ch_" + uniq(), ...over });

  // ── §1 created → flag + LOUD task, no reversal ───────────────────────────
  console.log("\n§1 dispute.created flags loudly, reverses nothing");
  const pi1 = "pi_disp_" + uniq();
  const gift1 = await seedGift(orgId, donorId, pi1, 95);
  await signAndSend("charge.dispute.created", useShape(pi1, { status: "needs_response", reason: "fraudulent" }), acctId);
  await settle();
  {
    const [g] = await q(`SELECT disputed_at, dispute_status FROM gifts WHERE id=$1`, [gift1]);
    ok("gift flagged disputed_at + status=needs_response", g?.disputed_at != null && g.dispute_status === "needs_response", g);
    const stamps = await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gift1]);
    ok("ledger stamp NOT removed (money only held)", stamps.length === 1, stamps.length);
    const tasks = await q(`SELECT title, priority, due FROM tasks WHERE org_id=$1 AND title ILIKE '%disput%'`, [orgId]);
    ok("a high-priority staff task was created with a respond-by deadline", tasks.length === 1 && tasks[0].priority === "high" && !!tasks[0].due, tasks);
    const notes = await q(`SELECT id FROM interactions WHERE donor_id=$1 AND note ILIKE '%dispute opened%'`, [donorId]);
    ok("a donor timeline note records the dispute", notes.length === 1, notes.length);
  }

  // ── §2 created is idempotent (redelivery / update) ───────────────────────
  console.log("\n§2 idempotent under redelivery");
  await signAndSend("charge.dispute.created", useShape(pi1, { status: "needs_response" }), acctId);
  await signAndSend("charge.dispute.updated", useShape(pi1, { status: "under_review" }), acctId);
  await settle();
  {
    const tasks = await q(`SELECT id FROM tasks WHERE org_id=$1 AND title ILIKE '%disput%'`, [orgId]);
    ok("redelivery did NOT create a second task", tasks.length === 1, tasks.length);
    const [g] = await q(`SELECT id FROM gifts WHERE id=$1`, [gift1]);
    ok("gift still present (update didn't reverse it)", !!g, null);
  }

  // ── §3 closed / won → flag cleared to won, gift kept ─────────────────────
  console.log("\n§3 dispute won keeps the gift");
  await signAndSend("charge.dispute.closed", useShape(pi1, { status: "won" }), acctId);
  await settle();
  {
    const [g] = await q(`SELECT dispute_status FROM gifts WHERE id=$1`, [gift1]);
    ok("won: gift kept, dispute_status=won", g?.dispute_status === "won", g);
    const notes = await q(`SELECT id FROM interactions WHERE donor_id=$1 AND note ILIKE '%dispute won%'`, [donorId]);
    ok("a funds-reinstated note recorded", notes.length === 1, notes.length);
  }

  // ── §4 closed / lost → reversed like a full refund ───────────────────────
  console.log("\n§4 dispute lost reverses the gift");
  const pi2 = "pi_disp_" + uniq();
  const gift2 = await seedGift(orgId, donorId, pi2, 120);
  const [{ total_giving: beforeTotal }] = await q(`SELECT total_giving FROM donors WHERE id=$1`, [donorId]);
  await signAndSend("charge.dispute.created", useShape(pi2, { status: "needs_response" }), acctId);
  await settle();
  await signAndSend("charge.dispute.closed", useShape(pi2, { status: "lost" }), acctId);
  await settle();
  {
    const g = await q(`SELECT id FROM gifts WHERE id=$1`, [gift2]);
    ok("lost: the gift row is deleted (reversed)", g.length === 0, g.length);
    const stamps = await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gift2]);
    ok("lost: its ledger stamp is removed", stamps.length === 0, stamps.length);
    const rcpt = await q(`SELECT voided_at, void_reason FROM receipts WHERE org_id=$1 AND void_reason ILIKE '%dispute%'`, [orgId]);
    ok("lost: the receipt was voided (chargeback reason)", rcpt.length === 1 && rcpt[0].voided_at != null, rcpt);
    const [{ total_giving: afterTotal }] = await q(`SELECT total_giving FROM donors WHERE id=$1`, [donorId]);
    ok("lost: donor total recalced down by the lost gift", Number(afterTotal) === Number(beforeTotal) - 120, { beforeTotal, afterTotal });
    const notes = await q(`SELECT id FROM interactions WHERE donor_id=$1 AND note ILIKE '%dispute lost%'`, [donorId]);
    ok("a reversal note recorded", notes.length === 1, notes.length);
  }

  // cleanup
  for (const t of ["fin_transactions", "receipts", "tasks", "interactions", "gifts", "budgets", "accounts", "fin_funds", "donors"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
