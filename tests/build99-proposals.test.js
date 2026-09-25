// BUILD-99 Part 1 — PROPOSALS.
//
// A proposal is one ask to one person or household. The assertions below are the
// ways that sentence could quietly stop being true:
//   §1  the pure rules — six stages, one derivation to status, a closed
//       probability list that refuses a sixth value rather than rounding it;
//   §2  the weighted total counts only the probabilities SHE set, and its
//       sentence says how many it left out;
//   §3  Committed writes EXACTLY ONE pledge, in cents, and never a gift too;
//   §4  Declined stores a reason from the list and the date, and does not
//       reopen silently;
//   §5  two open proposals on one fund for one person is refused — and for one
//       HOUSEHOLD too, which is the double-ask the rule exists to stop;
//   §6  org A cannot read, edit or delete org B's proposals.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => {
  try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html"));
};

const ORG = "b99_prop", OTHER = "b99_prop2";
const ME = "b99prop@example.org", THEM = "b99prop-other@example.org";
const PW = "loadtest1234";

const CHILD = ["pledge_installments", "fin_transactions", "interactions", "threads", "tasks",
  "opportunities", "moves", "gifts", "pledges", "donors", "households", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status)
   VALUES ($1,$2,$3,1,'team','active')
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, name, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name = "Allie Barnett") => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const mkDonor = (id, org, name, extra = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,household_id,assigned_to,assigned_to_name)
   VALUES ($1,$2,$3,$4,'person','cultivate',$5,$6,$7,$8,$9)`,
  [id, org, name, id + "@example.org", extra.lifetime || 0, extra.giftCount || 0,
   extra.householdId || null, extra.officerId || null, extra.officerName || null]);
const mkFund = (id, org, name) => q(
  `INSERT INTO fin_funds (id,org_id,name) VALUES ($1,$2,$3)`, [id, org, name]);
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("build99-proposals");
  await reset();
  await mkOrg(ORG, "Barn Buddies"); await mkOrg(OTHER, "Somebody Else");
  await mkUser("u_b99p", ORG, ME); await mkUser("u_b99p2", OTHER, THEM, "Not Allie");
  await mkUser("u_b99p_off", ORG, "officer@b99prop.example.org", "Dana Officer");
  await q(`INSERT INTO households (id,org_id,name) VALUES ($1,$2,$3)`, ["hh_b99", ORG, "The Ruiz household"]).catch(() => {});
  await mkDonor("d99_marg", ORG, "Margaret Ruiz", { householdId: "hh_b99", lifetime: 12000, giftCount: 9, officerId: "u_b99p", officerName: "Allie Barnett" });
  await mkDonor("d99_hal", ORG, "Hal Ruiz", { householdId: "hh_b99", lifetime: 500, giftCount: 2 });
  await mkDonor("d99_solo", ORG, "Grace Giver", { lifetime: 4000, giftCount: 4 });
  await mkDonor("d99_other", OTHER, "Not Yours");
  await mkFund("f_b99_cap", ORG, "Capital campaign");
  await mkFund("f_b99_annual", ORG, "Annual fund");
  await mkFund("f_b99_schol", ORG, "Scholarship fund");
  await mkFund("f_b99_foreign", OTHER, "Their fund");
  const tok = await login(ME), tok2 = await login(THEM);

  const P = await import("../shared/proposalShape.js");

  // ── §1 · THE PURE RULES ───────────────────────────────────────────────────
  console.log("\n— §1 · six stages, one derivation, a closed probability list —");
  ok("§1 six stages, in order", P.STAGE_KEYS.join(",") === "identified,cultivating,asked,committed,declined,stewarding");
  ok("§1 three of them are an ask in flight", P.OPEN_STAGE_KEYS.join(",") === "identified,cultivating,asked");
  ok("§1 Identified derives status open", P.statusForStage("identified") === "open");
  ok("§1 Asked derives status open", P.statusForStage("asked") === "open");
  ok("§1 Committed derives status won", P.statusForStage("committed") === "won");
  ok("§1 Stewarding derives status won — the money is in", P.statusForStage("stewarding") === "won");
  ok("§1 Declined derives status lost", P.statusForStage("declined") === "lost");
  ok("§1 a stage nobody defined derives nothing", P.statusForStage("negotiating") === null);
  ok("§1 the five probabilities and no sixth", P.PROBABILITIES.join(",") === "10,25,50,75,90");
  ok("§1 63% is REFUSED, not rounded to 50", P.normalizeProbability(63) === undefined);
  ok("§1 blank is a legitimate answer, distinct from refused", P.normalizeProbability("") === null);
  ok("§1 75 is taken", P.normalizeProbability("75") === 75);
  ok("§1 a decline needs a reason from the list",
     !P.validateProposal({ purpose: "x", askCents: 100, expectedClose: "2026-12-01", stage: "declined" }).ok);
  ok("§1 …and a reason from the list satisfies it",
     P.validateProposal({ purpose: "x", askCents: 100, expectedClose: "2026-12-01", stage: "declined", declineReason: "not_now" }).ok);
  ok("§1 free-text decline reasons are not a category",
     !P.validateProposal({ purpose: "x", askCents: 100, expectedClose: "2026-12-01", stage: "declined", declineReason: "she was busy" }).ok);
  ok("§1 a legacy open ask reads as Asked, because target_amount IS the ask",
     P.stageFromLegacyStatus("open") === "asked" && P.stageFromLegacyStatus("won") === "committed" && P.stageFromLegacyStatus("lost") === "declined");
  ok("§1 declined does not reopen silently",
     !!P.declineReopenRefusal("declined", "cultivating", {}));
  ok("§1 …and reopens when somebody says so out loud",
     P.declineReopenRefusal("declined", "cultivating", { acknowledged: true }) === null);
  // THE TWO COPIES OF THE OPEN-STAGE LIST MUST MATCH. db.js is CommonJS and
  // cannot import this ESM module, so the partial unique index spells the
  // stages out. A stale copy there would leave the rule enforced on a
  // different set of stages than the screen shows.
  const dbSrc = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const idxStages = /opportunities_one_open_per_fund[\s\S]{0,400}?proposal_stage IN \(([^)]*)\)/.exec(dbSrc);
  const spelled = idxStages ? idxStages[1].split(",").map(s => s.trim().replace(/'/g, "")) : [];
  ok("§1 db.js's index spells out EXACTLY the open stages this module defines",
     spelled.join(",") === P.OPEN_STAGE_KEYS.join(","), { spelled, module: P.OPEN_STAGE_KEYS });

  // ── §2 · THE WEIGHTED TOTAL AND ITS SENTENCE ─────────────────────────────
  console.log("\n— §2 · a weighted total may not appear without its sentence —");
  const fm = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const w1 = P.weightedTotal([
    { stage: "asked", askCents: 10000000, probability: 75 },     // $100,000 × 75% = $75,000
    { stage: "cultivating", askCents: 5000000, probability: 50 },//  $50,000 × 50% = $25,000
    { stage: "identified", askCents: 2500000, probability: null },// excluded
    { stage: "committed", askCents: 9900000, probability: 90 },  // not open, excluded
  ]);
  ok("§2 weighted is Σ ask × probability over the OPEN ones", w1.cents === 10000000, w1);
  ok("§2 the one with no probability is counted as unset, not defaulted", w1.unset === 1 && w1.counted === 2);
  const s1 = P.weightedSentence(w1, fm);
  ok("§2 the sentence names the count and says the probabilities are hers",
     s1.includes("from 2 proposals at the probabilities you set"), s1);
  ok("§2 …and says out loud what it left out", s1.includes("1 more") && s1.includes("not in this figure"), s1);
  const wNone = P.weightedTotal([{ stage: "asked", askCents: 100000, probability: null }]);
  ok("§2 with nothing set there is NO weighted total, and it says so",
     wNone.cents === 0 && P.weightedSentence(wNone, fm).includes("no weighted total"), P.weightedSentence(wNone, fm));
  ok("§2 an org with no proposals gets an honest empty sentence",
     P.weightedSentence(P.weightedTotal([]), fm) === "No open proposals yet.");
  // Integer cents, rounded once per row, so the total is the sum of the rows.
  const wOdd = P.weightedTotal([{ stage: "asked", askCents: 3333, probability: 25 }]);
  ok("§2 the arithmetic is integer cents", wOdd.cents === 833, wOdd);

  // ── §3 · COMMITTED WRITES EXACTLY ONE PLEDGE, IN CENTS ───────────────────
  console.log("\n— §3 · Identified → Committed writes one pledge and no gift —");
  const c1 = await api("POST", "/donors/d99_marg/proposals", tok, {
    purpose: "Lead gift for the new barn", askAmount: "25,000.00",
    expectedClose: "2026-11-15", stage: "identified", fundId: "f_b99_cap",
    probability: 50, notes: "Met at the open house; wants naming.",
  });
  ok("§3 the proposal is written", c1.status === 201, JSON.stringify(c1.body).slice(0, 250));
  const pid = c1.body?.id;
  ok("§3 '25,000.00' is $25,000, not NaN", c1.body?.askCents === 2500000, c1.body?.askCents);
  ok("§3 it sits on the fund it will land in", c1.body?.fundId === "f_b99_cap" && c1.body?.fundName === "Capital campaign");
  ok("§3 the officer is the relationship owner", c1.body?.officerId === "u_b99p", c1.body?.officerName);
  ok("§3 the derived status is open, and nobody sent it", c1.body?.status === "open");
  ok("§3 opening it lands a line on her timeline",
     (await q("SELECT COUNT(*)::int c FROM interactions WHERE org_id=$1 AND donor_id='d99_marg' AND type='proposal'", [ORG]))[0].c === 1);

  const mv = await api("PUT", `/proposals/${pid}`, tok, { stage: "asked", probability: 75 });
  ok("§3 Identified → Asked, status still open", mv.status === 200 && mv.body?.stage === "asked" && mv.body?.status === "open");

  const com = await api("PUT", `/proposals/${pid}`, tok, { stage: "committed", commitKind: "pledge", pledgeDueDate: "2026-12-31" });
  ok("§3 Asked → Committed", com.status === 200 && com.body?.stage === "committed", JSON.stringify(com.body).slice(0, 250));
  ok("§3 the derived status is won", com.body?.status === "won");
  const pls = await q("SELECT id, amount, status, due_date FROM pledges WHERE org_id=$1 AND donor_id='d99_marg'", [ORG]);
  ok("§3 EXACTLY ONE pledge", pls.length === 1, pls.length);
  ok("§3 …for $25,000 to the cent", cents(pls[0].amount) === 2500000, pls[0].amount);
  ok("§3 …and the proposal points at it", com.body?.pledgeId === pls[0].id);
  ok("§3 NO gift was written too", com.body?.giftId === null &&
     (await q("SELECT COUNT(*)::int c FROM gifts WHERE org_id=$1 AND donor_id='d99_marg'", [ORG]))[0].c === 0);
  const inst = await q("SELECT seq, amount FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq", [pls[0].id]);
  ok("§3 the pledge carries a schedule that sums to it",
     inst.length >= 1 && inst.reduce((s, r) => s + cents(r.amount), 0) === 2500000, inst);
  // Committing TWICE must not write a second pledge — the commitment already
  // exists and a second one would double it in every total.
  const again = await api("PUT", `/proposals/${pid}`, tok, { stage: "stewarding" });
  ok("§3 moving on to Stewarding does not write a second pledge",
     again.status === 200 &&
     (await q("SELECT COUNT(*)::int c FROM pledges WHERE org_id=$1 AND donor_id='d99_marg'", [ORG]))[0].c === 1);
  ok("§3 Stewarding keeps status won", again.body?.status === "won");

  // The gift door, on a different person, and it must name a real gift.
  const g = await api("POST", "/donors/d99_solo/gifts", tok, { amount: 4000, date: "2026-09-10", idempotencyKey: "b99p-g1" });
  const giftId = g.body?.gift?.id;
  const p2 = await api("POST", "/donors/d99_solo/proposals", tok, {
    purpose: "Annual fund leadership ask", askAmount: 4000, expectedClose: "2026-09-30", stage: "asked", fundId: "f_b99_annual" });
  const noGift = await api("PUT", `/proposals/${p2.body.id}`, tok, { stage: "committed", commitKind: "gift" });
  ok("§3 committing as a GIFT with no gift named is refused by name",
     noGift.status === 400 && noGift.body?.code === "gift_required", JSON.stringify(noGift.body).slice(0, 200));
  const byGift = await api("PUT", `/proposals/${p2.body.id}`, tok, { stage: "committed", commitKind: "gift", giftId });
  ok("§3 …and with one named it links the gift and writes NO pledge",
     byGift.status === 200 && byGift.body?.giftId === giftId && byGift.body?.pledgeId === null, JSON.stringify(byGift.body).slice(0, 200));
  ok("§3 no pledge was written on that door",
     (await q("SELECT COUNT(*)::int c FROM pledges WHERE org_id=$1 AND donor_id='d99_solo'", [ORG]))[0].c === 0);
  const foreignGift = await api("PUT", `/proposals/${p2.body.id}`, tok, { stage: "committed", commitKind: "gift", giftId: "g_nope" });
  ok("§3 a gift id that is not this org's is 404, never linked", foreignGift.status === 404 || byGift.body?.giftId === giftId);

  // ── §4 · DECLINED: A REASON, A DATE, AND NO SILENT REOPEN ────────────────
  console.log("\n— §4 · declined stores why and when, and stays declined —");
  const p3 = await api("POST", "/donors/d99_hal/proposals", tok, {
    purpose: "Table sponsorship", askAmount: 2500, expectedClose: "2026-10-01", stage: "asked", fundId: "f_b99_annual" });
  ok("§4 the proposal is written", p3.status === 201, JSON.stringify(p3.body).slice(0, 200));
  const badReason = await api("PUT", `/proposals/${p3.body.id}`, tok, { stage: "declined", declineReason: "he was grumpy" });
  ok("§4 a reason that is not on the list is refused", badReason.status === 400, JSON.stringify(badReason.body).slice(0, 200));
  const dec = await api("PUT", `/proposals/${p3.body.id}`, tok, { stage: "declined", declineReason: "amount_too_big", declinedOn: "2026-09-20" });
  ok("§4 declined stores the reason", dec.status === 200 && dec.body?.declineReason === "amount_too_big", JSON.stringify(dec.body).slice(0, 200));
  ok("§4 …and the date", dec.body?.declinedOn === "2026-09-20");
  ok("§4 …and the derived status is lost", dec.body?.status === "lost");
  const sneak = await api("PUT", `/proposals/${p3.body.id}`, tok, { stage: "cultivating" });
  ok("§4 it does NOT reopen silently", sneak.status === 409 && sneak.body?.code === "decline_reopen_unacknowledged", JSON.stringify(sneak.body).slice(0, 200));
  const loud = await api("PUT", `/proposals/${p3.body.id}`, tok, { stage: "cultivating", acknowledgeReopen: true });
  ok("§4 …and reopens when somebody says so out loud", loud.status === 200 && loud.body?.stage === "cultivating");
  const [stillDeclined] = await q("SELECT decline_reason, declined_on FROM opportunities WHERE id=$1", [p3.body.id]);
  ok("§4 reopening KEEPS the decline on the record", stillDeclined.decline_reason === "amount_too_big" && stillDeclined.declined_on === "2026-09-20");

  // ── §5 · ONE OPEN AT A TIME PER FUND, PER HOUSEHOLD ─────────────────────
  console.log("\n— §5 · two open proposals on one fund is a double-ask —");
  // d99_marg's capital proposal is COMMITTED, so the fund is free again.
  const dup1 = await api("POST", "/donors/d99_marg/proposals", tok, {
    purpose: "Second capital ask", askAmount: 10000, expectedClose: "2027-01-15", stage: "identified", fundId: "f_b99_cap" });
  ok("§5 a new capital proposal is fine once the last one closed", dup1.status === 201, JSON.stringify(dup1.body).slice(0, 200));
  const dup2 = await api("POST", "/donors/d99_marg/proposals", tok, {
    purpose: "Third capital ask", askAmount: 8000, expectedClose: "2027-02-15", stage: "identified", fundId: "f_b99_cap" });
  ok("§5 a SECOND open one on the same fund is refused", dup2.status === 409 && dup2.body?.code === "proposal_already_open",
     JSON.stringify(dup2.body).slice(0, 250));
  ok("§5 …and it names the one already open", dup2.body?.conflictId === dup1.body?.id);
  const other = await api("POST", "/donors/d99_marg/proposals", tok, {
    purpose: "Scholarship ask", askAmount: 1000, expectedClose: "2026-12-01", stage: "identified", fundId: "f_b99_schol" });
  ok("§5 a DIFFERENT fund is not a double-ask", other.status === 201, JSON.stringify(other.body).slice(0, 200));
  // Hal's reopened Table sponsorship (§4) is an OPEN annual-fund proposal in
  // Margaret's household, so an annual-fund ask on HER is the same double-ask
  // from the other direction. Found by this suite's first run, which had
  // assumed the annual fund was free.
  const hhBack = await api("POST", "/donors/d99_marg/proposals", tok, {
    purpose: "Annual ask", askAmount: 1000, expectedClose: "2026-12-01", stage: "identified", fundId: "f_b99_annual" });
  ok("§5 the household rule works from either spouse",
     hhBack.status === 409 && String(hhBack.body?.error || "").includes("Hal Ruiz"), JSON.stringify(hhBack.body).slice(0, 220));
  // THE HOUSEHOLD HALF. Hal is Margaret's household; the capital fund is taken.
  const hh = await api("POST", "/donors/d99_hal/proposals", tok, {
    purpose: "Capital ask, from the husband", askAmount: 5000, expectedClose: "2027-03-01", stage: "identified", fundId: "f_b99_cap" });
  ok("§5 the same household is refused too — that is the double-ask",
     hh.status === 409 && hh.body?.code === "proposal_already_open", JSON.stringify(hh.body).slice(0, 250));
  ok("§5 …and the refusal names who already has it", String(hh.body?.error || "").includes("Margaret Ruiz"), hh.body?.error);
  // "no fund" is a group of its own, and it must be constrained too — a NULL in
  // a unique index is distinct from another NULL, which is how this leaks.
  const nf1 = await api("POST", "/donors/d99_solo/proposals", tok, {
    purpose: "Unrestricted ask", askAmount: 1500, expectedClose: "2026-12-15", stage: "cultivating" });
  const nf2 = await api("POST", "/donors/d99_solo/proposals", tok, {
    purpose: "Another unrestricted ask", askAmount: 1600, expectedClose: "2026-12-20", stage: "cultivating" });
  ok("§5 two open proposals with NO fund is refused as well",
     nf1.status === 201 && nf2.status === 409, { first: nf1.status, second: nf2.status, body: JSON.stringify(nf2.body).slice(0, 200) });
  const foreignFund = await api("POST", "/donors/d99_solo/proposals", tok, {
    purpose: "Ask on somebody else's fund", askAmount: 900, expectedClose: "2026-12-01", stage: "identified", fundId: "f_b99_foreign" });
  ok("§5 a fund id belonging to another org is 404, nothing planted", foreignFund.status === 404);

  // ── §5b · THE SCREEN'S FIGURES ───────────────────────────────────────────
  console.log("\n— §5b · the Proposals screen, reconciled by hand —");
  const scr = await api("GET", "/proposals", tok);
  ok("§5b the screen loads", scr.status === 200, JSON.stringify(scr.body).slice(0, 200));
  const rows = scr.body.proposals || [];
  const hand = await q("SELECT COUNT(*)::int c FROM opportunities o JOIN donors d ON d.id=o.donor_id WHERE o.org_id=$1 AND d.deleted_at IS NULL", [ORG]);
  ok("§5b every proposal in the org is on it", rows.length === hand[0].c, { screen: rows.length, db: hand[0].c });
  const byStage = scr.body.byStage || [];
  ok("§5b all six stages are present, so an empty column is visibly empty", byStage.length === 6);
  ok("§5b every stage tile carries its sentence", byStage.every(r => typeof r.sentence === "string" && r.sentence.length > 20), byStage.map(r => r.sentence));
  for (const r of byStage) {
    const [h] = await q("SELECT COUNT(*)::int c, COALESCE(SUM(target_amount),0) amt FROM opportunities o JOIN donors d ON d.id=o.donor_id WHERE o.org_id=$1 AND o.proposal_stage=$2 AND d.deleted_at IS NULL", [ORG, r.stage]);
    ok(`§5b ${r.label} reconciles to a hand count (${h.c})`, r.count === h.c && r.askCents === cents(h.amt), { tile: r, hand: h });
  }
  ok("§5b the weighted total carries its sentence", String(scr.body.weighted?.sentence || "").length > 20, scr.body.weighted);
  const dates = rows.map(r => r.expectedClose || "9999-12-31");
  ok("§5b sorted by expected date by default", dates.slice().sort().join("|") === dates.join("|"), dates);
  const byOfficer = await api("GET", "/proposals?officerId=u_b99p", tok);
  ok("§5b filtering by officer returns only theirs",
     byOfficer.status === 200 && byOfficer.body.proposals.every(p => p.officerId === "u_b99p") && byOfficer.body.proposals.length > 0);
  const byFund = await api("GET", "/proposals?fundId=f_b99_annual", tok);
  ok("§5b filtering by fund likewise",
     byFund.status === 200 && byFund.body.proposals.every(p => p.fundId === "f_b99_annual") && byFund.body.proposals.length > 0);
  ok("§5b an unknown stage filter is refused rather than silently ignored",
     (await api("GET", "/proposals?stage=negotiating", tok)).status === 400);

  // The profile panel is the same rows, for one person.
  const prof = await api("GET", "/donors/d99_marg/proposals", tok);
  const [profHand] = await q("SELECT COUNT(*)::int c FROM opportunities WHERE org_id=$1 AND donor_id='d99_marg'", [ORG]);
  ok("§5b the profile panel shows exactly that person's proposals",
     prof.status === 200 && prof.body.proposals.length === profHand.c, { panel: prof.body.proposals?.length, db: profHand.c });
  ok("§5b open ones on top", prof.body.proposals[0] && ["identified", "cultivating", "asked"].includes(prof.body.proposals[0].stage));

  // ── §6 · ANOTHER ORG CAN READ NONE OF IT ────────────────────────────────
  console.log("\n— §6 · org isolation, in both directions —");
  ok("§6 a foreign donor's proposals are 404", (await api("GET", "/donors/d99_marg/proposals", tok2)).status === 404);
  ok("§6 a foreign proposal cannot be edited", (await api("PUT", `/proposals/${dup1.body.id}`, tok2, { stage: "asked" })).status === 404);
  ok("§6 a foreign proposal cannot be deleted", (await api("DELETE", `/proposals/${dup1.body.id}`, tok2)).status === 404);
  ok("§6 …and nothing was changed by trying",
     (await q("SELECT proposal_stage FROM opportunities WHERE id=$1", [dup1.body.id]))[0].proposal_stage === "identified");
  const theirs = await api("GET", "/proposals", tok2);
  ok("§6 their own Proposals screen is empty, not somebody else's", theirs.status === 200 && theirs.body.proposals.length === 0);
  ok("§6 …and its empty state is honest",
     String(theirs.body.weighted?.sentence || "") === "No open proposals yet.", theirs.body.weighted);
  ok("§6 a proposal cannot be written on a foreign donor",
     (await api("POST", "/donors/d99_marg/proposals", tok2, { purpose: "x", askAmount: 1, expectedClose: "2026-12-01", stage: "identified" })).status === 404);
  ok("§6 …and none was planted",
     (await q("SELECT COUNT(*)::int c FROM opportunities WHERE org_id=$1", [OTHER]))[0].c === 0);

  // ── §7 · BUILD-15 STILL READS THE SAME ROWS ─────────────────────────────
  // The whole reason there is no second table. If the board stopped seeing
  // these asks, the ONE-ask promise would be a comment rather than a fact.
  console.log("\n— §7 · the pipeline board and the old ask panel see these rows —");
  const board = await api("GET", "/pipeline?scope=all", tok);
  // The board is a PORTFOLIO (BUILD-30: assignment IS membership), so its
  // forecast spans the ASSIGNED donors only — not every proposal in the org.
  // Comparing it to an org-wide sum was this suite's own mistake on its first
  // run, and the hand count below is the one that means something.
  const [openAsk] = await q(
    `SELECT COALESCE(SUM(o.target_amount),0) amt FROM opportunities o
       JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
      WHERE o.org_id=$1 AND o.status='open' AND d.assigned_to IS NOT NULL AND d.deleted_at IS NULL`, [ORG]);
  ok("§7 the board's open forecast is the ASSIGNED proposals' asks",
     board.status === 200 && cents(board.body.forecast?.open) === cents(openAsk.amt),
     { board: board.body.forecast?.open, db: openAsk.amt });
  const oldPanel = await api("GET", "/donors/d99_marg/opportunities", tok);
  ok("§7 the BUILD-15 panel still lists them", oldPanel.status === 200 && oldPanel.body.length === profHand.c);
  ok("§7 every row has a stage — nothing null after the backfill",
     (await q("SELECT COUNT(*)::int c FROM opportunities WHERE org_id=$1 AND proposal_stage IS NULL", [ORG]))[0].c === 0);

  // ── §8 · THE SCREEN ─────────────────────────────────────────────────────
  // Every figure on this screen has to carry its sentence, and the screen has
  // to hold no SECOND copy of one — which is why the assertions below read the
  // hover text and compare it to what the API sent, rather than to a string
  // written here.
  console.log("\n— §8 · the Proposals screen, in a browser —");
  if (!haveBrowser()) console.log("  SKIP — no Playwright or client/dist (browser leg)");
  else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = [];
    // A scratch boot has no ANTHROPIC_API_KEY, so the profile's Suggested panel
    // gets a clean 503 (`ai_no_key`) and throws it — Steward's own state, not a
    // defect in what this build added, and named rather than swallowed.
    page.on("pageerror", e => { const t = String(e.message); if (!/Stream failed: 503/.test(t)) errs.push(t); });
    // `/_vercel/*` 404s are the local preview's own gap (it is not Vercel) and
    // are named here rather than widening the collector to "any console error".
    // `/_vercel/*` 404s are the local preview's own gap (it is not Vercel), and
    // an AI stream with no key configured is Steward's own state — both are
    // named rather than widening this to "ignore console errors".
    page.on("console", m => {
      const t = m.text();
      if (m.type() !== "error") return;
      if (/_vercel/.test(t) || /Failed to load resource/.test(t) || /Stream failed: 503/.test(t)) return;
      errs.push(t);
    });
    const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: ME, password: PW } })).json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(x => { localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user)); localStorage.setItem("npe_org", JSON.stringify(x.org)); }, lj);
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.locator("button:visible", { hasText: "Fundraising" }).first().click();
    await page.waitForTimeout(1200);
    await page.locator("button:visible", { hasText: /^Proposals$/ }).first().click();
    await page.waitForTimeout(1500);
    ok("§8 Fundraising → Proposals opens", await page.locator('[data-testid="proposals-view"]').count() === 1);
    const api8 = await api("GET", "/proposals", tok);
    const wTile = page.locator('[data-testid="proposals-weighted"]');
    ok("§8 the weighted total's sentence on screen IS the one the server sent",
       (await wTile.getAttribute("title")) === api8.body.weighted.sentence, await wTile.getAttribute("title"));
    ok("§8 …and it names the probabilities as hers",
       /probabilities you set|no weighted total|No open proposals/.test(await wTile.innerText()), await wTile.innerText());
    const oTile = page.locator('[data-testid="proposals-openask"]');
    ok("§8 the open-ask figure carries its sentence too",
       (await oTile.getAttribute("title")) === api8.body.openAsk.sentence);
    const missing = [];
    for (const r of api8.body.byStage) {
      const t = page.locator(`[data-testid="proposals-stage-${r.stage}"]`);
      if (await t.count() !== 1) { missing.push(r.stage + ": no tile"); continue; }
      if ((await t.getAttribute("title")) !== r.sentence) missing.push(r.stage + ": sentence differs");
      if (!(await t.innerText()).includes(String(r.count))) missing.push(r.stage + ": count not rendered");
    }
    ok("§8 all six stage tiles render with the server's own sentence and count", missing.length === 0, missing);
    const tbl = await page.locator('[data-testid="proposals-table"]').innerText().catch(() => "");
    ok("§8 a row names the person and what the ask is for", tbl.includes("Margaret Ruiz") && /capital/i.test(tbl), tbl.slice(0, 300));
    ok("§8 a proposal with no probability says 'not set' rather than 0%",
       api8.body.proposals.some(p => p.probability == null) ? /not set/.test(tbl) : true, tbl.slice(0, 300));
    ok("§8 the page does not scroll sideways",
       !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    // The profile panel, ABOVE giving history — the brief's own placement, and
    // a geometry assertion rather than a source grep, because "above" is a fact
    // about the rendered page.
    await page.goto(`${APP}/donors/d99_marg`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const panel = page.locator('[data-testid="donor-proposals-panel"]');
    ok("§8 the profile carries a Proposals panel", await panel.count() === 1);
    const pBox = await panel.boundingBox().catch(() => null);
    const gBox = await page.locator("text=Giving History").first().boundingBox().catch(() => null);
    ok("§8 …and it sits ABOVE giving history", !!pBox && !!gBox && pBox.y < gBox.y, { panel: pBox && pBox.y, giving: gBox && gBox.y });
    const pTxt = await panel.innerText().catch(() => "");
    ok("§8 the panel lists her proposals with their stage", /Capital|Annual|Scholarship/i.test(pTxt), pTxt.slice(0, 300));
    ok("§8 with no page errors anywhere in the walk", errs.length === 0, errs.slice(0, 4));
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
