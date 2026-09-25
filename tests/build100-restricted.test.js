// BUILD-100 (grants) Part 4 — WHERE RESTRICTED MONEY ACTUALLY IS.
//
// The brief's own test is §3: a $10,000 program-restricted award received in
// two payments shows $10,000 awarded, $10,000 received, $0 spent, $10,000
// remaining, and posts restricted revenue TWICE in cents; an unrestricted
// award posts as unrestricted.
//
//   §1  the four figures and their definitions — and why `remaining` excludes
//       what the funder still owes;
//   §2  the wire: a payment against a restricted award posts to the GRANT's
//       fund, never the unrestricted one;
//   §3  the brief's scenario, in integer cents, reconciled by hand;
//   §4  spend is entered by hand, says so, and an undescribed line is refused;
//   §5  overspending is said out loud, never clamped to zero;
//   §6  time-restricted money knows its release date;
//   §7  the org total foots to its rows, and can disagree;
//   §8  a report-due milestone carries the balance; other kinds do not;
//   §9  org A sees, spends against, and reconciles none of org B's.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b100_res", OTHER = "b100_res2";
const ME = "b100res@example.org", THEM = "b100res-other@example.org";
const PW = "loadtest1234";

const CHILD = ["grant_spend", "grant_milestones", "grant_documents", "grant_interactions",
  "program_grants", "grants", "pledge_installments", "fin_transactions", "interactions",
  "threads", "tasks", "opportunities", "moves", "gifts", "pledges", "donors", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = id => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const mkFunder = (id, org, name) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count)
   VALUES ($1,$2,$3,$4,'organisation','cultivate',0,0)`, [id, org, name, id + "@example.org"]);
const cents = v => Math.round(Number(v) * 100);
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

(async () => {
  console.log("build100-restricted");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b100res", ORG, ME, "Allie Barnett");
  await mkUser("u_b100res2", OTHER, THEM, "Not Allie");
  await mkFunder("fd_sun4", ORG, "The Sunrise Foundation");
  await mkFunder("fd_acme4", ORG, "Acme Corporate Giving");
  await mkFunder("fd_other4", OTHER, "Somebody Else Trust");
  // A RESTRICTED fund and the org's unrestricted one, so "posted to the right
  // fund" is a question with two possible answers.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_youth4','${ORG}','Youth programme',true)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const R = await import("../shared/restrictedMoney.js");

  // ── §1 · THE FOUR FIGURES ───────────────────────────────────────────────
  console.log("\n— §1 · and why remaining excludes what is still owed —");
  ok("§1 every figure has a definition", R.definitionProblems().length === 0, R.definitionProblems());
  ok("§1 five figures, each named", R.RESTRICTED_METRIC_KEYS.join(",")
     === "awarded,received,outstanding,spent,remaining", R.RESTRICTED_METRIC_KEYS);
  // THE DECISION, asserted rather than left to the reader: remaining is
  // received − spent, so promised-but-unpaid money is NOT spendable.
  const half = R.grantBalance({ awardedCents: cents(10000), receivedCents: cents(4000), spentCents: cents(1000),
                                restriction: "program_restricted" });
  ok("§1 remaining is RECEIVED minus spent, not awarded minus spent",
     half.remainingCents === cents(3000), half.remainingCents);
  ok("§1 …and what the funder still owes is its OWN figure",
     half.outstandingCents === cents(6000), half.outstandingCents);
  ok("§1 the definition says why, in words a treasurer can check",
     /cannot spend that/.test(R.metricDefinition("remaining") || ""), R.metricDefinition("remaining"));
  ok("§1 an unrestricted award has no restricted balance to report",
     R.grantBalance({ awardedCents: cents(5000), restriction: "unrestricted" }).restricted === false);
  ok("§1 …and says so rather than showing a zero",
     /unrestricted — the organisation decides/.test(
       R.balanceSentence(R.grantBalance({ awardedCents: cents(5000), restriction: "unrestricted" }), c => "$" + c / 100)),
     R.balanceSentence(R.grantBalance({ awardedCents: cents(5000), restriction: "unrestricted" }), c => "$" + c / 100));

  // ── §2 · THE WIRE ───────────────────────────────────────────────────────
  console.log("\n— §2 · a restricted payment may not land in General Operating —");
  await api("PUT", "/funders/fd_sun4", tok, { funderType: "private_foundation" });
  const g1 = await api("POST", "/funders/fd_sun4/grants", tok, {
    program: "Youth programme", amountRequested: 10000, status: "submitted",
    restriction: "program_restricted", fundId: "f_youth4" });
  ok("§2 a program-restricted grant on a restricted fund",
     g1.status === 201 && g1.body.restriction === "program_restricted" && g1.body.fundId === "f_youth4", g1.body);
  const aw = await api("PUT", `/grants/${g1.body.id}/award`, tok,
    { amountAwarded: 10000, frequency: "quarterly", installmentCount: 2, firstDue: plusDays(-30) });
  ok("§2 awarding writes the pledge", aw.status === 200 && !!aw.body.pledgeId, aw.body);

  // A payment with NO fund named — the case the wire exists for.
  const pay1 = await api("POST", "/donors/fd_sun4/gifts", tok,
    { amount: 5000, date: plusDays(-20), pledgeId: aw.body.pledgeId, idempotencyKey: "b100res-p1" });
  ok("§2 the first payment records", (pay1.status === 201 || pay1.status === 200) && !!(pay1.body.gift && pay1.body.gift.id),
     JSON.stringify(pay1.body).slice(0, 180));
  const [led1] = await q(
    `SELECT fund_id, amount FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, pay1.body.gift.id]);
  ok("§2 it posted to the GRANT's restricted fund, not the unrestricted one",
     led1 && led1.fund_id === "f_youth4", led1 && led1.fund_id);
  const [unres] = await q(`SELECT id FROM fin_funds WHERE org_id=$1 AND restricted IS NOT TRUE LIMIT 1`, [ORG]);
  ok("§2 …and the org DOES have an unrestricted fund it could wrongly have used",
     !!unres && unres.id !== "f_youth4", unres && unres.id);

  // ── §3 · THE BRIEF'S OWN SCENARIO ───────────────────────────────────────
  console.log("\n— §3 · $10,000 in two payments, reconciled by hand —");
  const pay2 = await api("POST", "/donors/fd_sun4/gifts", tok,
    { amount: 5000, date: plusDays(-5), pledgeId: aw.body.pledgeId, idempotencyKey: "b100res-p2" });
  ok("§3 the second payment records", pay2.status === 201 || pay2.status === 200);
  const rest = await api("GET", `/grants/${g1.body.id}/restricted`, tok);
  ok("§3 the restricted view loads", rest.status === 200, JSON.stringify(rest.body).slice(0, 180));
  const b = rest.body.balance;
  // HAND-COMPUTED LITERALS, in cents — never read back off the API.
  ok("§3 $10,000 awarded", b.awardedCents === cents(10000), b.awardedCents);
  ok("§3 $10,000 received", b.receivedCents === cents(10000), b.receivedCents);
  ok("§3 $0 spent", b.spentCents === 0, b.spentCents);
  ok("§3 $10,000 remaining", b.remainingCents === cents(10000), b.remainingCents);
  ok("§3 nothing still owed", b.outstandingCents === 0, b.outstandingCents);
  ok("§3 …and it is restricted", b.restricted === true && b.restriction === "program_restricted");
  // POSTS RESTRICTED REVENUE TWICE, IN CENTS.
  const posts = await q(
    `SELECT amount, fund_id FROM fin_transactions
      WHERE org_id=$1 AND fund_id='f_youth4' AND type='income' ORDER BY date`, [ORG]);
  ok("§3 restricted revenue posted TWICE, once per payment", posts.length === 2, posts.length);
  ok("§3 …and the two posts sum to the award, to the cent",
     posts.reduce((s, p) => s + cents(p.amount), 0) === cents(10000), posts.map(p => p.amount));
  ok("§3 the two payments are listed behind the figure, so it can be taken apart",
     rest.body.payments.length === 2
     && rest.body.payments.reduce((s, p) => s + p.amountCents, 0) === cents(10000),
     rest.body.payments.map(p => p.amount));
  ok("§3 every figure on the view carries its definition",
     R.RESTRICTED_METRIC_KEYS.every(k => (rest.body.definitions[k] || "").length > 25),
     Object.keys(rest.body.definitions || {}));
  ok("§3 …and the definition IS the registry's string, not a copy",
     rest.body.definitions.remaining === R.metricDefinition("remaining"));

  console.log("\n— §3b · an unrestricted award posts as unrestricted —");
  const g2 = await api("POST", "/funders/fd_acme4/grants", tok, {
    program: "General support", amountRequested: 4000, status: "submitted", restriction: "unrestricted" });
  const aw2 = await api("PUT", `/grants/${g2.body.id}/award`, tok, { amountAwarded: 4000 });
  const pay3 = await api("POST", "/donors/fd_acme4/gifts", tok,
    { amount: 4000, date: plusDays(-2), pledgeId: aw2.body.pledgeId, idempotencyKey: "b100res-p3" });
  const [led3] = await q(`SELECT fund_id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, pay3.body.gift.id]);
  ok("§3b an unrestricted award's payment does NOT land in the restricted fund",
     led3 && led3.fund_id !== "f_youth4", led3 && led3.fund_id);
  const r2 = await api("GET", `/grants/${g2.body.id}/restricted`, tok);
  ok("§3b …and it reports no restricted balance", r2.body.balance.restricted === false, r2.body.balance);

  // ── §4 · SPEND IS ENTERED BY HAND, AND SAYS SO ──────────────────────────
  console.log("\n— §4 · spending is typed, not read from a bank —");
  const sp1 = await api("POST", `/grants/${g1.body.id}/spend`, tok,
    { amount: 2500, spentOn: plusDays(-3), description: "Two teaching artists, March sessions" });
  ok("§4 a spend line records", sp1.status === 201, JSON.stringify(sp1.body).slice(0, 200));
  ok("§4 …and the balance moves with it",
     sp1.body.balance.spentCents === cents(2500) && sp1.body.balance.remainingCents === cents(7500),
     sp1.body.balance);
  ok("§4 the screen says the spending is typed, not a bank feed",
     /entered by hand/.test(sp1.body.note || ""), sp1.body.note);
  ok("§4 an undescribed spend line is REFUSED — it cannot be defended in an audit",
     (await api("POST", `/grants/${g1.body.id}/spend`, tok, { amount: 100, spentOn: plusDays(-1) })).status === 400);
  ok("§4 a zero or negative amount is refused",
     (await api("POST", `/grants/${g1.body.id}/spend`, tok, { amount: 0, spentOn: plusDays(-1), description: "x" })).status === 400);
  ok("§4 a date that is not a civil date is refused",
     (await api("POST", `/grants/${g1.body.id}/spend`, tok, { amount: 10, spentOn: "last week", description: "x" })).status === 400);
  ok("§4 nothing refused was stored",
     (await q("SELECT COUNT(*)::int c FROM grant_spend WHERE org_id=$1", [ORG]))[0].c === 1);
  const withSpend = await api("GET", `/grants/${g1.body.id}/restricted`, tok);
  ok("§4 the spend lines are listed behind the figure",
     withSpend.body.spend.length === 1 && withSpend.body.spend[0].amountCents === cents(2500),
     withSpend.body.spend);
  ok("§4 …with who entered it", withSpend.body.spend[0].byName === "Allie Barnett", withSpend.body.spend[0].byName);
  const delSp = await api("DELETE", `/grants/spend/${sp1.body.id}`, tok);
  ok("§4 a spend line can be removed", delSp.status === 200);
  ok("§4 …and the balance goes back",
     (await api("GET", `/grants/${g1.body.id}/restricted`, tok)).body.balance.remainingCents === cents(10000));

  // ── §5 · OVERSPENT IS SAID OUT LOUD ─────────────────────────────────────
  console.log("\n— §5 · spending more than the funder paid is a finding —");
  await api("POST", `/grants/${g1.body.id}/spend`, tok,
    { amount: 12000, spentOn: plusDays(-1), description: "Everything, and then some" });
  const over = await api("GET", `/grants/${g1.body.id}/restricted`, tok);
  ok("§5 remaining goes NEGATIVE rather than being clamped to zero",
     over.body.balance.remainingCents === cents(-2000), over.body.balance.remainingCents);
  ok("§5 …and it is flagged", over.body.balance.overspent === true);
  ok("§5 …and the sentence names the gap and what to check",
     /more has been spent against this award than the funder has paid/.test(over.body.balance.sentence),
     over.body.balance.sentence);
  // Clean up so later totals are hand-computable.
  await q("DELETE FROM grant_spend WHERE org_id=$1", [ORG]);

  // ── §6 · TIME-RESTRICTED MONEY KNOWS ITS RELEASE DATE ───────────────────
  console.log("\n— §6 · not spendable until the date the restriction names —");
  const g3 = await api("POST", "/funders/fd_acme4/grants", tok, {
    program: "Endowed chair", amountRequested: 20000, status: "submitted",
    restriction: "time_restricted", restrictedUntil: plusDays(120), fundId: "f_youth4" });
  ok("§6 a time-restricted grant needs its release date", g3.status === 201, JSON.stringify(g3.body).slice(0, 180));
  const aw3 = await api("PUT", `/grants/${g3.body.id}/award`, tok, { amountAwarded: 20000 });
  await api("POST", "/donors/fd_acme4/gifts", tok,
    { amount: 20000, date: plusDays(-1), pledgeId: aw3.body.pledgeId, idempotencyKey: "b100res-p4" });
  const tr = await api("GET", `/grants/${g3.body.id}/restricted`, tok);
  ok("§6 the release date is on the balance", tr.body.balance.releaseDate === plusDays(120), tr.body.balance.releaseDate);
  ok("§6 …and it is not yet released", tr.body.balance.released === false);
  ok("§6 …which the sentence says in words",
     /not spendable until/.test(tr.body.balance.sentence), tr.body.balance.sentence);
  const past = R.grantBalance({ awardedCents: cents(100), receivedCents: cents(100),
    restriction: "time_restricted", restrictedUntil: plusDays(-1), today: plusDays(0) });
  ok("§6 a release date already passed reads as released", past.released === true, past);

  // ── §7 · THE ORG TOTAL FOOTS TO ITS ROWS ────────────────────────────────
  console.log("\n— §7 · a total that can disagree with its rows —");
  const fin = await api("GET", "/finance/restricted", tok);
  ok("§7 the restricted position loads", fin.status === 200, JSON.stringify(fin.body).slice(0, 180));
  const sumRows = fin.body.grants.reduce((s, g) => s + g.remainingCents, 0);
  ok("§7 the total is the sum of its rows, in cents",
     fin.body.totals.remainingCents === sumRows, { total: fin.body.totals.remainingCents, rows: sumRows });
  // Hand-computed: $10,000 restricted (fully received, nothing spent) +
  // $20,000 time-restricted (fully received) = $30,000. The unrestricted
  // $4,000 award must NOT be in it.
  ok("§7 …and equals the hand count of $30,000", fin.body.totals.remainingCents === cents(30000),
     fin.body.totals.remainingCents);
  ok("§7 the unrestricted award is listed SEPARATELY, not folded in",
     fin.body.unrestricted.length === 1 && fin.body.unrestricted[0].awardedCents === cents(4000),
     fin.body.unrestricted);
  ok("§7 …and is excluded from the restricted grant list",
     !fin.body.grants.some(g => g.program === "General support"), fin.body.grants.map(g => g.program));
  ok("§7 the sentence names the money and the count",
     /restricted money across 2 grants/.test(fin.body.sentence), fin.body.sentence);
  ok("§7 a submitted grant's restriction is a proposal, not a balance",
     !fin.body.grants.some(g => g.grantStatus === "submitted"), fin.body.grants.map(g => g.grantStatus));

  // ── §8 · THE BALANCE BESIDE THE REPORT ──────────────────────────────────
  console.log("\n— §8 · the report is about the money —");
  const msR = await api("POST", `/grants/${g1.body.id}/milestones`, tok,
    { kind: "report_due", dueDate: plusDays(10) });
  const msL = await api("POST", `/grants/${g1.body.id}/milestones`, tok,
    { kind: "renewal_opens", dueDate: plusDays(20) });
  ok("§8 both milestones exist", msR.status === 201 && msL.status === 201);
  const dl = await api("GET", "/grants/deadlines", tok);
  const reportRow = dl.body.milestones.find(m => m.id === msR.body.id);
  const otherRow = dl.body.milestones.find(m => m.id === msL.body.id);
  ok("§8 a report-due deadline carries the grant's balance",
     !!reportRow && !!reportRow.balance && reportRow.balance.remainingCents === cents(10000),
     reportRow && reportRow.balance);
  ok("§8 …and its sentence", /restricted money still to spend/.test((reportRow.balance || {}).sentence || ""),
     reportRow.balance && reportRow.balance.sentence);
  // A number on a row that does not need it is a number somebody has to decide
  // to ignore.
  ok("§8 a renewal deadline carries NO balance — it is not what that one is about",
     !!otherRow && otherRow.balance === undefined, otherRow && otherRow.balance);

  // ── §9 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §9 · another org reconciles none of it —");
  ok("§9 a foreign grant's restricted view is 404",
     (await api("GET", `/grants/${g1.body.id}/restricted`, tok2)).status === 404);
  ok("§9 a foreign grant cannot be spent against",
     (await api("POST", `/grants/${g1.body.id}/spend`, tok2, { amount: 100, spentOn: plusDays(-1), description: "x" })).status === 404);
  ok("§9 …and nothing was recorded",
     (await q("SELECT COUNT(*)::int c FROM grant_spend WHERE org_id=$1", [OTHER]))[0].c === 0);
  const theirs = await api("GET", "/finance/restricted", tok2);
  ok("§9 their restricted position is empty, not somebody else's",
     theirs.body.grants.length === 0 && theirs.body.totals.remainingCents === 0, theirs.body.totals);
  ok("§9 …with an honest sentence rather than a wall of zeros",
     /No restricted grant money on the books/.test(theirs.body.sentence), theirs.body.sentence);
  ok("§9 a foreign spend line cannot be deleted",
     (await api("DELETE", "/grants/spend/gsp_nope", tok2)).status === 404);

  // KEEP=1 leaves the fixtures behind for inspection — the DISCOVER=1
  // convention from state-diff. It changes no assertion; it exists because
  // both defects this suite found were only visible in the rows afterwards.
  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
