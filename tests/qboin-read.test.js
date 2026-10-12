// tests/qboin-read.test.js, QBO-IN. THE ONE GUARD THIS BUILD EARNED.
//
//     A GIFT THE BOOKKEEPER ENTERED IN QUICKBOOKS COMES INTO STEWARD ONCE, ON
//     THE RIGHT PERSON; NOTHING ELSE COMES IN; AND NOTHING GOES BACK.
//
// Money read twice doubles a nonprofit's giving on every screen; money read
// from a program-fee account calls tuition a gift; a gift Steward sent and
// then read back is the same check counted twice. All three are money and all
// three are invisible until somebody reconciles by hand.
//
// QUICKBOOKS IS A LOCAL STAND-IN on BOOKKEEPING_MOCK_PORT (the port the
// server's INTUIT_API_BASE names). It answers Intuit's v3 query endpoint in the
// documented entity shapes (developer.intuit.com API reference: SalesReceipt,
// Payment, Invoice, Deposit with DepositLineDetail and LinkedTxn,
// RefundReceipt, Item with IncomeAccountRef, Customer with PrimaryEmailAddr,
// BillAddr and CompanyName), and it records every request that is not a GET,
// so "nothing is written to QuickBooks" is a count, not a promise.
//
// WHAT IS ASSERTED:
//   §0  the read refuses until a donation account is ticked
//   §1  the first read opens a review and writes no gift
//   §2  checks on the ticked account become gifts on the right people (email,
//       name, a payment against an invoice, a deposit line); an ambiguous name
//       waits for a pick; a business is created as an organisation on request
//   §3  a program-fee line on an unticked account is left out and counted
//   §4  a receipt Steward sent is skipped; a Stripe payout deposit is skipped;
//       a check matching a gift already in Steward is skipped and listed with
//       what it matched; a banked receipt in a deposit is not a second gift
//   §5  the gifts count where gifts count: totals, the ledger, the thank-you
//       queue, and never in QuickBooks' Pending list
//   §6  reading again records nothing new
//   §7  a refund receipt marks its gift refunded; a voided receipt removes its gift
//   §8  QuickBooks received no write at all
//   §9  undo removes everything the read added
//
// HOW IT WOULD GO RED (planted and watched, 2026-10-12): see the PR.
//
// Standard scratch stack (tests/README.md) booted with TEST_MODE=1, plus the
// stand-in this file starts.

const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { ORG, ADMIN, A_CONTRIB, STUB_PORT, day, company, writes, startStub, reset } = require("./qboin/standin");
let stub;
const qboGifts = () => q(`SELECT g.id, g.donor_id, ROUND(g.amount::numeric*100)::int AS cents, g.payment_method, g.check_number, g.fund_id, g.date
                            FROM gifts g WHERE g.org_id=$1 AND g.read_from_vendor='quickbooks' ORDER BY g.date, g.id`, [ORG]);

(async () => {
  console.log("QBO-IN: gifts entered in QuickBooks come into Steward, counted once\n");
  stub = await startStub();
  ok("the QuickBooks stand-in is listening (without it this suite proves nothing)", !!stub, STUB_PORT);
  await reset();
  const tok = await login(ADMIN);

  // ── §0 · NOTHING TICKED, NOTHING READ ──────────────────────────────────
  const refused = await api("POST", "/qbo/read/preview", tok, {});
  ok("§0 the read refuses until a donation account is ticked", refused.status === 409 && refused.body?.error === "no_accounts", refused.body);
  const set = await api("PUT", "/qbo/read/settings", tok, { from: day(-365), accounts: { [A_CONTRIB]: { name: "Contributed income" } } });
  ok("§0 ticking Contributed income saves", set.status === 200 && set.body?.ok, set.body);
  const st = await api("GET", "/qbo/read", tok);
  ok("§0 …and its fund defaults to the fund already mapped to that account for sending",
     st.body?.accounts?.[A_CONTRIB]?.fundId === "fnd_qi_gen", st.body?.accounts);
  const autoEarly = await api("PUT", "/qbo/read/settings", tok, { auto: true });
  ok("§0 reading automatically cannot be turned on before a reviewed first save", autoEarly.status === 409, autoEarly.body);

  // ── §1 · THE FIRST READ IS A REVIEW ─────────────────────────────────────
  const before = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  const p1 = await api("POST", "/qbo/read/preview", tok, {});
  ok("§1 the first read opens a review", p1.status === 200 && p1.body?.status === "review" && !!p1.body?.runId, p1.body);
  const after = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§1 …and writes no gift until somebody saves", after[0].n === before[0].n, { before, after });
  const B = p1.body?.figures || {};
  ok("§1 four lines become gifts as they stand (Ada's check, Ada's payment, Ben's cash, Ben's deposited check)",
     B.gift?.count === 4 && Math.round(B.gift.value * 100) === 45000, B.gift);
  ok("§1 the two Sam Riveras make one line ambiguous, with both as candidates",
     B.ambiguous?.count === 1 && (p1.body?.ambiguous?.[0]?.candidates || []).length === 2, p1.body?.ambiguous);
  ok("§1 Harbor Hardware is unmatched and marked as a business",
     B.unmatched?.count === 1 && p1.body?.unmatched?.[0]?.business === true, p1.body?.unmatched);
  const fsrc = await api("GET", `/figures/qbo-read/rows?run=${p1.body?.runId}&bucket=gift`, tok);
  const figRows = fsrc.body?.rows || [];
  ok("§1 the gift count opens its rows, and they foot to the figure",
     fsrc.status === 200 && figRows.length === 4 && Math.round(figRows.reduce((t, r) => t + Number(r.amount) * 100, 0)) === 45000,
     { status: fsrc.status, body: fsrc.body });

  // ── §3 · ONLY DONATIONS COUNT ──────────────────────────────────────────
  ok("§3 the swim-team registration on Program fees is left out, and said in one line",
     B.other_account?.count === 1 && /^1 transaction on other accounts was left out\.$/.test(p1.body?.leftOut || ""), { o: B.other_account, s: p1.body?.leftOut });
  ok("§3 nothing older than the read-from day is read", !(JSON.stringify(p1.body).includes(":SalesReceipt:107:")), null);

  // ── §4 · NEVER COUNTED TWICE ───────────────────────────────────────────
  const skipped = p1.body?.skipped || [];
  const sk = b => skipped.filter(x => x.bucket === b);
  ok("§4 Susan La's $10 that Steward sent is skipped as Steward's own",
     sk("steward_sent").length === 1 && sk("steward_sent")[0].txnId === "900" && sk("steward_sent")[0].matchedGiftId === "g_qi_susan", sk("steward_sent"));
  ok("§4 the Stripe payout deposit line is skipped as a payout", sk("payout").length === 1 && sk("payout")[0].cents === 48720, sk("payout"));
  ok("§4 Cara's $75 is skipped as already in Steward, and says which gift it matched",
     sk("already_in_steward").length === 1 && sk("already_in_steward")[0].matchedGiftId === "g_qi_cara"
       && /already in Steward/i.test(sk("already_in_steward")[0].reason || ""), sk("already_in_steward"));
  ok("§4 the deposit that banks Ada's receipt is not a second gift", p1.body?.summary?.bankedLines === 1, p1.body?.summary);

  // ── §2 · SAVE: THE RIGHT PEOPLE ─────────────────────────────────────────
  const sam = p1.body.ambiguous[0], harbor = p1.body.unmatched[0];
  const s1 = await api("POST", "/qbo/read/save", tok, { runId: p1.body.runId, picks: { [sam.id]: "d_qi_sam2", [harbor.id]: "create" } });
  ok("§2 saving records the gifts", s1.status === 200 && s1.body?.recorded === 6 && s1.body?.cents === 98000, s1.body);
  const gifts1 = await qboGifts();
  const on = id => gifts1.filter(g => g.donor_id === id);
  ok("§2 Ada has her check (with its number) and her invoice payment, both checks",
     on("d_qi_ada").length === 2 && on("d_qi_ada").every(g => g.payment_method === "Check")
       && on("d_qi_ada").some(g => g.cents === 25000 && g.check_number === "1041") && on("d_qi_ada").some(g => g.cents === 6000), on("d_qi_ada"));
  ok("§2 Ben has his cash gift and his deposited check", on("d_qi_ben").length === 2
     && on("d_qi_ben").some(g => g.payment_method === "Cash") && on("d_qi_ben").some(g => g.check_number === "5521"), on("d_qi_ben"));
  ok("§2 the ambiguous Sam Rivera gift landed on the Sam she picked, not the other",
     on("d_qi_sam2").length === 1 && on("d_qi_sam1").length === 0, { s1: on("d_qi_sam1"), s2: on("d_qi_sam2") });
  const [hh] = await q(`SELECT id, kind, email FROM donors WHERE org_id=$1 AND name='Harbor Hardware LLC'`, [ORG]);
  ok("§2 Harbor Hardware was created as an organisation, with its gift", !!hh && hh.kind === "organisation"
     && gifts1.some(g => g.donor_id === hh.id && g.cents === 50000 && g.payment_method === "Bank transfer"), { hh, gifts1 });
  ok("§2 every gift landed on the fund mapped to Contributed income", gifts1.every(g => g.fund_id === "fnd_qi_gen"), gifts1);
  ok("§2 each gift's date is the transaction's calendar date", on("d_qi_ada").some(g => g.date === day(-5)), on("d_qi_ada"));

  // ── §5 · THEY COUNT WHERE GIFTS COUNT ──────────────────────────────────
  const [ada] = await q(`SELECT total_giving, gift_count FROM donors WHERE id='d_qi_ada'`);
  ok("§5 Ada's lifetime giving counts both", Number(ada.total_giving) === 310 && Number(ada.gift_count) === 2, ada);
  const ledger = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND gift_id = ANY($2)`, [ORG, gifts1.map(g => g.id)]);
  ok("§5 each gift has its line in Finance", ledger[0].n === gifts1.length, ledger);
  const ty = await q(`SELECT gift_id FROM thank_you_drafts WHERE org_id=$1 AND gift_id = ANY($2)`, [ORG, gifts1.map(g => g.id)]);
  const recent = gifts1.filter(g => g.date >= day(-30)).map(g => g.id).sort();
  ok("§5 a new check waits for a thank-you like any other; old history opens none",
     JSON.stringify(ty.map(t => t.gift_id).sort()) === JSON.stringify(recent) && recent.length === 5, { ty, recent });
  const pend = await api("GET", "/qbo/pending", tok);
  ok("§5 a gift read from QuickBooks is never in the send list", pend.status === 200
     && !(pend.body?.rows || []).some(r => gifts1.some(g => g.id === r.giftId)), pend.body?.rows);

  // ── §6 · READING TWICE RECORDS NOTHING NEW ─────────────────────────────
  const p2 = await api("POST", "/qbo/read/preview", tok, {});
  ok("§6 a second read finds nothing new to record", p2.status === 200 && p2.body?.figures?.gift?.count === 0
     && p2.body?.figures?.already_read?.count === 6, p2.body?.figures);
  const s2 = await api("POST", "/qbo/read/save", tok, { runId: p2.body.runId, picks: { [sam.id]: "d_qi_sam2" } });
  const gifts2 = await qboGifts();
  ok("§6 …and saving it records nothing", s2.status === 200 && s2.body?.recorded === 0 && gifts2.length === gifts1.length, { s2: s2.body, n: gifts2.length });
  const resave = await api("POST", "/qbo/read/save", tok, { runId: p1.body.runId, picks: {} });
  ok("§6 saving the first read again is refused", resave.status === 409, resave.body);

  // ── §7 · REFUNDS AND VOIDS ─────────────────────────────────────────────
  company.RefundReceipt.push({ Id: "601", TxnDate: day(-1), TotalAmt: 250, CustomerRef: { value: "1", name: "Ada Okafor" },
    Line: [{ Id: "1", Amount: 250, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] });
  const ben = company.SalesReceipt.find(t => t.Id === "103");
  ben.TotalAmt = 0; ben.PrivateNote = "Voided"; ben.Line[0].Amount = 0;
  const p3 = await api("POST", "/qbo/read/preview", tok, {});
  ok("§7 the refund receipt is found against Ada's check", p3.body?.figures?.refund?.count === 1, p3.body?.refunds);
  ok("§7 the voided receipt is found against Ben's gift", p3.body?.figures?.removed?.count === 1, p3.body?.refunds);
  const s3 = await api("POST", "/qbo/read/save", tok, { runId: p3.body.runId, picks: {} });
  ok("§7 saving applies both", s3.status === 200 && s3.body?.refunded === 1 && s3.body?.removed === 1, s3.body);
  const adaCheck = gifts1.find(g => g.donor_id === "d_qi_ada" && g.cents === 25000);
  const benCash = gifts1.find(g => g.donor_id === "d_qi_ben" && g.payment_method === "Cash");
  const [rf] = await q(`SELECT status FROM qbo_read_gifts WHERE org_id=$1 AND gift_id=$2 AND txn_type <> 'RefundReceipt'`, [ORG, adaCheck.id]);
  const gone = await q(`SELECT id FROM gifts WHERE id = ANY($1)`, [[adaCheck.id, benCash.id]]);
  ok("§7 Ada's check is marked refunded and out of her giving", rf?.status === "refunded" && !gone.some(g => g.id === adaCheck.id), { rf, gone });
  const notes = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id IN ('d_qi_ada','d_qi_ben') AND type='note'`, [ORG]);
  ok("§7 …never silently: each person's record says what QuickBooks did",
     notes.some(n => /Refunded in QuickBooks/.test(n.note)) && notes.some(n => /voided in QuickBooks/i.test(n.note)), notes);
  const [ada2] = await q(`SELECT total_giving FROM donors WHERE id='d_qi_ada'`);
  ok("§7 Ada's total is recomputed", Number(ada2.total_giving) === 60, ada2);
  const p4 = await api("POST", "/qbo/read/preview", tok, {});
  ok("§7 reading again does not apply the refund twice", p4.body?.figures?.refund?.count === 0 && p4.body?.figures?.removed?.count === 0, p4.body?.figures);

  // ── §8 · NOTHING WAS WRITTEN TO QUICKBOOKS ─────────────────────────────
  ok("§8 QuickBooks received no write at all, across four reads and three saves", writes.length === 0, writes);

  // ── §9 · UNDO TAKES THE WHOLE READ BACK ────────────────────────────────
  const u = await api("POST", "/qbo/read/undo", tok, { runId: p1.body.runId });
  ok("§9 undo answers", u.status === 200 && u.body?.ok, u.body);
  const left = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=(SELECT import_id FROM qbo_read_runs WHERE id=$2)`, [ORG, p1.body.runId]);
  const keys = await q(`SELECT COUNT(*)::int AS n FROM qbo_read_gifts WHERE org_id=$1 AND run_id=$2 AND status='recorded'`, [ORG, p1.body.runId]);
  const hh2 = await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Harbor Hardware LLC'`, [ORG]);
  const drafts = await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1`, [ORG]);
  const ledger2 = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND gift_id = ANY($2)`, [ORG, gifts1.map(g => g.id)]);
  ok("§9 every gift the read added is gone, with its ledger lines and thank-you drafts",
     left[0].n === 0 && ledger2[0].n === 0 && drafts[0].n === 0, { left, ledger2, drafts });
  ok("§9 the person it created is gone", hh2.length === 0, hh2);
  ok("§9 its once-only keys are gone, so a later read can bring the lines in again", keys[0].n === 0, keys);
  const [ada3] = await q(`SELECT total_giving, gift_count FROM donors WHERE id='d_qi_ada'`);
  const [cara] = await q(`SELECT total_giving FROM donors WHERE id='d_qi_cara'`);
  ok("§9 totals are recomputed from what remains, and nobody else's are touched",
     Number(ada3.total_giving) === 0 && Number(cara.total_giving) === 75, { ada3, cara });
  ok("§9 undo still wrote nothing to QuickBooks", writes.length === 0, writes);

  await reset().catch(() => {});
  for (const t of ["fin_funds", "bookkeeping_connections", "donors", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await closeDb();
  if (stub) stub.close();
  summary();
})().catch(async e => { console.error(e); if (stub) stub.close(); await closeDb().catch(() => {}); process.exit(1); });
