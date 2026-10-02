// COMMS-2 — THE ONE TEST: a year-end statement's gift total equals the sum of
// that donor's receipted gifts for the year to the cent, and excludes
// non-deductible amounts the way receipts already do.
//
// The donor's year is built from the gifts that break arithmetic and receipts:
//   $100.10 · $0.10 + $0.20 (0.1 + 0.2 in floating point is not 0.3) ·
//   a $150 event ticket of which $50 bought the dinner (deductible $100) ·
//   a gift partially refunded from $100 to $80 whose stored deductible still
//   says $100 · a $10.01 refund · and three that must not count: a sample gift,
//   a gift from the year before, and a gift whose dispute the org lost.
// Then:
//   1. the statement's total deductible is exactly $270.39 (27039 cents), and the
//      total given is $320.39;
//   2. it equals, to the cent, the sum of each gift's own receipt (POST
//      /gifts/:id/receipt) for the gifts on the statement: one rule, two documents;
//   3. no line on it says more is deductible than was given.
//
// How it fails, planted and watched: add the dollars as floats (1 goes red at
// the cent), or trust the stored deductible after a refund (1 and 3 go red).
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_cm2t", DONOR = "d_cm2t";
const PW = bcrypt.hashSync("loadtest1234", 10);

async function clear() {
  for (const t of ["receipts", "gifts", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  await clear();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,legal_name,ein,receipts_enabled)
           VALUES ($1,'Statement test org','cm2t',1,'active','team','America/New_York','Statement Test Org Inc.','12-3456789',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`, [`u_${ORG}`, ORG, `dana@${ORG}.local`, PW]);
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,'Perpetua Wexley','active','system:test','test')`, [DONOR, ORG]);
  const Y = 2025;
  const gift = (id, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,deductible_amount,is_sample,dispute_status,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,'cash',$6,$7,$8,'system:test','test')`,
    [id, ORG, DONOR, amount, date, extra.deductible ?? null, extra.sample || false, extra.dispute || null]);
  await gift("g_cm2_a", 100.10, `${Y}-02-03`);
  await gift("g_cm2_b", 0.10, `${Y}-03-01`);
  await gift("g_cm2_c", 0.20, `${Y}-03-02`);
  await gift("g_cm2_ticket", 150, `${Y}-05-10`, { deductible: 100 });
  await gift("g_cm2_partial", 80, `${Y}-06-01`, { deductible: 100 });   // refunded from $100; the stored deductible was never lowered
  await gift("g_cm2_refund", -10.01, `${Y}-07-01`);
  await gift("g_cm2_sample", 999, `${Y}-08-01`, { sample: true });
  await gift("g_cm2_lastyear", 500, `${Y - 1}-12-31`);
  await gift("g_cm2_lost", 40, `${Y}-09-01`, { dispute: "lost" });

  const tok = await login(`dana@${ORG}.local`);
  const st = await api("POST", `/donors/${DONOR}/year-end-statement`, tok, { year: Y, send: false });
  ok("the statement was issued", st.status === 200 || st.status === 201, st.text.slice(0, 300));
  const [rc] = await q(`SELECT amount::text AS amount, deductible_amount::text AS ded, snapshot FROM receipts WHERE org_id=$1 AND donor_id=$2 AND type='year_end' AND voided_at IS NULL`, [ORG, DONOR]);
  const snap = rc && (typeof rc.snapshot === "string" ? JSON.parse(rc.snapshot) : rc.snapshot);
  const c = v => Math.round(Number(v) * 100);
  ok("total deductible is $270.39 to the cent", rc && c(rc.ded) === 27039 && c(snap.totalDeductible) === 27039, { stored: rc && rc.ded, snapshot: snap && snap.totalDeductible });
  ok("total given is $320.39 to the cent", rc && c(rc.amount) === 32039 && c(snap.totalAmount) === 32039, { stored: rc && rc.amount, snapshot: snap && snap.totalAmount });
  ok("the sample gift, last year's gift and the lost dispute are not on it", snap && snap.lineItems.length === 6, snap && snap.lineItems.length);
  ok("no line claims more deductible than was given", snap && snap.lineItems.every(l => l.amount <= 0 || c(l.deductibleAmount) <= c(l.amount)), snap && snap.lineItems);

  // The same gifts, each receipted on its own: one rule, two documents.
  let receiptedCents = 0;
  for (const id of ["g_cm2_a", "g_cm2_b", "g_cm2_c", "g_cm2_ticket", "g_cm2_partial"]) {
    const r = await api("POST", `/gifts/${id}/receipt`, tok, {});
    const [g] = await q(`SELECT deductible_amount::text AS d FROM receipts WHERE org_id=$1 AND gift_id=$2 AND voided_at IS NULL`, [ORG, id]);
    ok(`${id}: its receipt was issued`, (r.status === 200 || r.status === 201) && !!g, r.text.slice(0, 200));
    receiptedCents += g ? c(g.d) : 0;
  }
  receiptedCents += -1001;   // the refund is a negative gift on the statement and has no receipt of its own
  ok("the statement equals the sum of the gifts' own receipts, to the cent", rc && c(rc.ded) === receiptedCents, { statement: rc && rc.ded, receipts: receiptedCents / 100 });

  await clear();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await clear(); await closeDb(); } catch {} process.exit(1); });
