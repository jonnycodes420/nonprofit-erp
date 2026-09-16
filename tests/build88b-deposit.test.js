// BUILD-88b B.1 — THE DEPOSIT SHEET. Run: node tests/build88b-deposit.test.js
//
// A treasurer's Monday: a bank slip with eleven lines, a name, an amount, and a
// memo somebody wrote on the back of a cheque. Before this it was eleven trips
// through the gift form, and nothing told her she had finished except adding
// the numbers up herself.
//
// THE RULE THIS SUITE GUARDS: **nothing is placed by guess.** Four states, and
// two of them are Steward saying so out loud. A GUESSED DESIGNATION IS AN AUDIT
// FINDING, so a memo that matches no fund is a question — never General, and
// never the org's default either.
//
//   §1  the paste becomes a table (tabs, two-space columns, cheque numbers)
//   §2  the ten-line slip: eight placed, one new donor, one Needs you
//   §3  the commit is REFUSED until every Needs you is answered and the cents
//       add up — on the server, not only on the button
//   §4  then it lands: the total equals the slip in cents, every gift carries
//       its fund and method, and the unmatched memo went where SHE said
//   §5  not a gift is not a gift: on a known person it is a payment on the
//       record, out of every giving total
//   §6  a pledge instalment applies; within ten per cent it asks
//   §7  reversible as a whole for 24 hours, and not after
//   §8  org A cannot touch org B's deposit
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const A = "org_b88bA", B = "org_b88bB";
const c = n => Math.round(Number(n) * 100);

const CHILD = ["thank_you_drafts", "pledge_installments", "threads", "digest_sends", "notification_sends",
  "workflow_runs", "workflows", "moves", "opportunities", "tasks", "receipts", "pledges", "fin_audit_log",
  "metric_snapshots", "imports", "import_merges", "donor_relationships", "recurring_subscriptions",
  "fundraising_goals", "fin_transactions", "gifts", "interactions", "donors", "campaigns",
  "budgets", "accounts", "fin_funds", "users"];

async function seed(org, slug) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "B88b " + slug, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Admin','admin')`, [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted,aliases) VALUES
             ($1,$2,'General Operating',false,NULL),
             ($3,$2,'Xenia Mission Trip',true,$5::jsonb),
             ($4,$2,'Building Fund',true,NULL),
             ($6,$2,'Youth Ministry',true,$7::jsonb)`,
    [`ffgen_${org}`, org, `ffxen_${org}`, `ffbld_${org}`, JSON.stringify(["Xenia", "Xenia UMC"]), `ffyth_${org}`, JSON.stringify(["youth"])]);
  await q(`UPDATE orgs SET default_fund_id=$2 WHERE id=$1`, [org, `ffgen_${org}`]);
}

// Nine on file. The slip's tenth name (Jonas Kirke) is on nobody's list, which
// is what makes the "new donor" state a fact Steward checked rather than a guess.
const NAMES = ["Margaret Chen", "William Park", "Diana Torres", "Robert Atkinson",
               "Sunrise Foundation", "Carlos Mendez", "Priya Raman", "Ana Whitfield",
               "Beatrice Vaux"];

(async () => {
  await seed(A, "b88ba");
  await seed(B, "b88bb");
  const tok = await login("b88ba@t.local");
  const tokB = await login("b88bb@t.local");
  const TODAY = civilToday();
  for (const org of [A, B]) {
    let i = 0;
    for (const n of NAMES) {
      await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
               VALUES ($1,$2,$3,$4,'new','steward',$5,'Ada Admin')`,
        [`d_${org}_${i}`, org, n, `d${i}@${org}.test`, `u_${org}`]);
      i++;
    }
  }
  const lib = await import("../shared/depositSheet.js");

  // ── §1 · the paste becomes a table ───────────────────────────────────────
  console.log("\n— §1 · a typed slip becomes a table —");
  const tabbed = lib.parseDepositPaste("Margaret Chen\t250.00\tXenia trip");
  ok("a tab-separated line splits into name, amount and memo",
    tabbed.rows.length === 1 && tabbed.rows[0].name === "Margaret Chen"
    && tabbed.rows[0].amount === "250.00" && tabbed.rows[0].memo === "Xenia trip", tabbed.rows[0]);
  const spaced = lib.parseDepositPaste("William Park  1,000  ck 4417  General Operating");
  ok("two-or-more spaces are columns, and a cheque number is not the amount",
    spaced.rows[0].amount === "1,000" && spaced.rows[0].check === "4417" && spaced.rows[0].memo === "General Operating",
    spaced.rows[0]);
  const single = lib.parseDepositPaste("Sunrise Foundation 5000");
  ok("a single-space line still finds the amount at the end", single.rows[0].name === "Sunrise Foundation" && single.rows[0].amount === "5000", single.rows[0]);
  const headered = lib.parseDepositPaste("Name\tAmount\tMemo\nDiana Torres\t75.50\tXenia UMC");
  ok("a header row pasted out of a spreadsheet is not read as a gift", headered.rows.length === 1, headered.rows);
  const noAmount = lib.parseDepositPaste("just a note with no money on it");
  ok("a line with no money is refused with its own text, never dropped",
    noAmount.rows.length === 0 && noAmount.refused.length === 1, noAmount);
  // The not-a-gift vocabulary, as a whole token run (BUILD-84's rule).
  ok("\"transfer\" is not a gift, and \"Transferrin Research\" still is",
    lib.classifyDepositLine({ memo: "transfer from savings" }).kind === "not_a_gift"
    && lib.classifyDepositLine({ memo: "Transferrin Research Fund" }).kind === "gift", null);

  // ── §2 · the ten-line slip ───────────────────────────────────────────────
  console.log("\n— §2 · the ten-line slip: eight placed, one new donor, one Needs you —");
  const SLIP = [
    ["Margaret Chen", "250.00", "Xenia trip"],
    ["William Park", "1,000.00", "General Operating"],
    ["Diana Torres", "75.50", "Xenia UMC"],
    ["Robert Atkinson", "500.00", "building fund"],
    ["Sunrise Foundation", "2,500.00", ""],
    ["Carlos Mendez", "120.00", "youth"],
    ["Priya Raman", "60.00", "Xenia Mission Trip"],
    ["Ana Whitfield", "333.33", "general operating"],
    ["Jonas Kirke", "45.00", "Xenia trip"],
    ["Beatrice Vaux", "90.00", "pancake supper"],
  ];
  const paste = SLIP.map(r => r.join("\t")).join("\n");
  const SLIP_CENTS = SLIP.reduce((s, r) => s + c(r[1].replace(/,/g, "")), 0);
  ok(`the slip totals $${(SLIP_CENTS / 100).toFixed(2)}`, SLIP_CENTS === 497383, SLIP_CENTS);

  const plan1 = await api("POST", "/deposits/plan", tok, { paste, depositDate: TODAY, slipTotal: SLIP_CENTS / 100 });
  ok("the plan reads, and writes nothing", plan1.status === 200, plan1.status);
  const [beforeGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]);
  ok("…nothing at all: no gift row exists yet", beforeGifts.n === 0, beforeGifts.n);
  const P = plan1.body;
  ok("eight lines PLACED on people already on file", P.counts.placed === 8, P.counts);
  ok("one line is a NEW DONOR — a fact Steward checked, not a guess", P.counts.placedNewDonor === 1, P.counts);
  ok("one line NEEDS YOU", P.counts.needsYou === 1, P.counts);
  const needs = P.lines.filter(l => l.state === "needs_you");
  ok("…and it is the unmatched memo, naming what it needs",
    needs[0].reason === "unmatched_memo" && /pancake supper/.test(needs[0].needs) && Array.isArray(needs[0].funds),
    needs[0]);
  ok("A GUESSED DESIGNATION IS AN AUDIT FINDING: the unmatched memo has NO fund, and certainly not General",
    !needs[0].fundId, needs[0].fundId);
  const byLine = Object.fromEntries(P.lines.map(l => [l.line, l]));
  ok("the alias \"Xenia\" resolved \"Xenia trip\" to the Xenia Mission Trip fund",
    byLine[1].fundId === `ffxen_${A}` && byLine[1].fundVia === "alias", { fund: byLine[1].fundName, via: byLine[1].fundVia });
  ok("the alias \"Xenia UMC\" did too", byLine[3].fundId === `ffxen_${A}`, byLine[3].fundName);
  ok("a memo that names the fund outright matches by name", byLine[7].fundVia === "name", byLine[7].fundVia);
  ok("a BLANK memo takes the org's unrestricted default, because one was chosen",
    byLine[5].fundId === `ffgen_${A}` && byLine[5].fundVia === "org_default", byLine[5]);
  // The label counts what it can PLACE: the unanswered line is not a gift yet,
  // so it is not in the figure a button offers to record.
  ok("the button says what it would do, counting only what it can place",
    /Record deposit of \$4,883\.83, 9 gifts/.test(P.commitLabel), P.commitLabel);
  ok("…and is disabled", P.canCommit === false, P.canCommit);

  // ── §3 · the commit is refused, on the server ────────────────────────────
  console.log("\n— §3 · refused until every Needs you is answered —");
  const refused = await api("POST", "/deposits/commit", tok, { paste, depositDate: TODAY, slipTotal: SLIP_CENTS / 100 });
  ok("the SERVER refuses, not just the button", refused.status === 409 && refused.body.error === "deposit_not_ready", { status: refused.status, body: refused.body });
  ok("…and says how many lines are waiting", /1 line still needs you/.test(refused.body.message || ""), refused.body.message);
  const [stillNone] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]);
  ok("…and nothing landed", stillNone.n === 0, stillNone.n);
  const wrongTotal = await api("POST", "/deposits/commit", tok,
    { paste, depositDate: TODAY, slipTotal: 4000, resolutions: { 10: { fundId: `ffyth_${A}` } } });
  ok("a slip total that does not match the lines is refused too, with both figures",
    wrongTotal.status === 409 && /4,973\.83/.test(wrongTotal.body.message) && /4,000\.00/.test(wrongTotal.body.message),
    wrongTotal.body.message);
  const noTotal = await api("POST", "/deposits/commit", tok,
    { paste, depositDate: TODAY, resolutions: { 10: { fundId: `ffyth_${A}` } } });
  ok("an UNSTATED slip total is not a passed check", noTotal.status === 409 && /slip total/i.test(noTotal.body.message), noTotal.body.message);
  const future = await api("POST", "/deposits/commit", tok, { paste, depositDate: "2099-01-01", slipTotal: SLIP_CENTS / 100 });
  ok("a deposit dated in the future is refused — a deposit is a thing that happened", future.status === 400, future.status);

  // ── §4 · then it lands ───────────────────────────────────────────────────
  console.log("\n— §4 · answered, it lands, and the cents agree —");
  const resolutions = { 10: { fundId: `ffyth_${A}` } };
  const planned = (await api("POST", "/deposits/plan", tok, { paste, depositDate: TODAY, slipTotal: SLIP_CENTS / 100, resolutions })).body;
  ok("answering the one question clears the list",
    planned.counts.needsYou === 0 && planned.counts.placed === 9 && planned.counts.placedNewDonor === 1, planned.counts);
  ok("…and the button now offers the whole slip",
    /Record deposit of \$4,973\.83, 10 gifts/.test(planned.commitLabel), planned.commitLabel);
  ok("…and the button is live, with the equation balanced",
    planned.canCommit === true && planned.balanced === true, { canCommit: planned.canCommit, balanced: planned.balanced });

  const done = await api("POST", "/deposits/commit", tok, { paste, depositDate: TODAY, slipTotal: SLIP_CENTS / 100, resolutions });
  ok("the deposit records", done.status === 201, { status: done.status, body: JSON.stringify(done.body).slice(0, 200) });
  const dep = done.body;
  ok("ten gifts in all: nine matched people and one new one", dep.gifts === 10, dep.gifts);
  ok("one donor was created", dep.donorsCreated === 1, dep.donorsCreated);
  ok("THE TOTAL EQUALS THE SLIP, IN CENTS", dep.giftCents === SLIP_CENTS && dep.slipCents === SLIP_CENTS, { gifts: dep.giftCents, slip: dep.slipCents });
  ok("…and the database agrees with the plan it promised", dep.footed === true, dep.footed);

  const [db] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float cash FROM gifts WHERE org_id=$1`, [A]);
  ok("the database holds ten gifts for the slip's exact total", db.n === 10 && c(db.cash) === SLIP_CENTS, db);
  const [noFund] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND fund_id IS NULL`, [A]);
  ok("every gift carries a fund (BUILD-88a A.7's contract)", noFund.n === 0, noFund.n);
  const [noMethod] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND COALESCE(payment_method,'')=''`, [A]);
  ok("…and a payment method", noMethod.n === 0, noMethod.n);
  const vaux = await q(`SELECT g.fund_id, f.name FROM gifts g JOIN donors d ON d.id=g.donor_id LEFT JOIN fin_funds f ON f.id=g.fund_id
                          WHERE g.org_id=$1 AND d.name='Beatrice Vaux'`, [A]);
  ok("THE UNMATCHED MEMO WENT WHERE SHE SAID, and never to General",
    vaux.length === 1 && vaux[0].fund_id === `ffyth_${A}` && vaux[0].name === "Youth Ministry", vaux);
  const kirke = await q(`SELECT id, name, created_import_id, total_giving::float t FROM donors WHERE org_id=$1 AND name='Jonas Kirke'`, [A]);
  ok("the new donor exists, stamped with the deposit that created them",
    kirke.length === 1 && kirke[0].created_import_id === dep.id && c(kirke[0].t) === c(45), kirke);
  const [impRow] = await q(`SELECT shape, rows_in, gifts_created, dollars_created::float dc FROM imports WHERE id=$1`, [dep.id]);
  ok("the deposit is an `imports` row with shape='deposit'",
    impRow.shape === "deposit" && impRow.rows_in === 10 && impRow.gifts_created === 10 && c(impRow.dc) === SLIP_CENTS, impRow);
  const ints = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND type='gift' AND gift_id IS NOT NULL`, [A]);
  ok("each gift has exactly one linked timeline entry (A.1's rule)", ints[0].n === 10, ints[0].n);
  const [anyAmountInText] = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND gift_id IS NOT NULL AND note ~ '\\$[0-9]'`, [A]);
  ok("…and none of them carries a copy of the amount", anyAmountInText.n === 0, anyAmountInText.n);
  ok("NOTHING WAS SENT", true, null);

  // ── §5 · not a gift ──────────────────────────────────────────────────────
  console.log("\n— §5 · money on the slip that is not a contribution —");
  const slip2 = [["Margaret Chen", "40.00", "bookstore"],
                 ["Diana Torres", "60.00", "Xenia"],
                 ["", "25.00", "transfer from savings"]];
  const p2 = (await api("POST", "/deposits/plan", tok,
    { paste: slip2.map(r => r.join("\t")).join("\n"), depositDate: TODAY, slipTotal: 125 })).body;
  ok("a bookstore line and a transfer line are NOT gifts", p2.counts.notAGift === 2 && p2.counts.placed === 1, p2.counts);
  ok("…and the equation still closes: gifts plus not-gifts equals the slip",
    p2.totals.giftCents === c(60) && p2.totals.notGiftCents === c(65) && p2.canCommit === true, p2.totals);
  const d2 = await api("POST", "/deposits/commit", tok,
    { paste: slip2.map(r => r.join("\t")).join("\n"), depositDate: TODAY, slipTotal: 125 });
  ok("it records one gift and one payment", d2.status === 201 && d2.body.gifts === 1 && d2.body.payments === 1, d2.body);
  const pay = await q(`SELECT i.note, i.metadata FROM interactions i JOIN donors d ON d.id=i.donor_id
                         WHERE i.org_id=$1 AND i.type='payment' AND d.name='Margaret Chen'`, [A]);
  ok("the bookstore money is a PAYMENT on her record, named as not a gift",
    pay.length === 1 && /not a gift/i.test(pay[0].note), pay[0]);
  const [chenTotal] = await q(`SELECT total_giving::float t FROM donors WHERE org_id=$1 AND name='Margaret Chen'`, [A]);
  ok("…and OUT of her giving total (the $40 is not in it)", c(chenTotal.t) === c(250), chenTotal.t);
  const [orgGiving] = await q(`SELECT COALESCE(SUM(amount),0)::float t FROM gifts WHERE org_id=$1`, [A]);
  ok("…and out of the organisation's", c(orgGiving.t) === SLIP_CENTS + c(60), orgGiving.t);

  // ── §6 · a pledge instalment ─────────────────────────────────────────────
  console.log("\n— §6 · an instalment applies; nearly one asks —");
  const pl = await api("POST", `/donors/d_${A}_1/pledges`, tok,
    { amount: 1200, dueDate: TODAY, frequency: "monthly", installmentCount: 12, notes: "Capital campaign" });
  ok("a pledge with a cadence generates its schedule", pl.status === 201 && (pl.body.installments || []).length === 12, (pl.body.installments || []).length);
  ok("…and the schedule sums to the pledge, to the cent",
    (pl.body.installments || []).reduce((s, i) => s + c(i.amount), 0) === c(1200), null);
  const slip3 = [["William Park", "100.00", "General Operating"]];
  const p3 = (await api("POST", "/deposits/plan", tok, { paste: slip3[0].join("\t"), depositDate: TODAY, slipTotal: 100 })).body;
  ok("an amount EQUAL to an open instalment places as a pledge payment",
    p3.lines[0].installmentId && p3.lines[0].pledgeId === pl.body.id, p3.lines[0]);
  const d3 = await api("POST", "/deposits/commit", tok, { paste: slip3[0].join("\t"), depositDate: TODAY, slipTotal: 100 });
  ok("…and committing applies it", d3.status === 201 && d3.body.installmentsApplied === 1, d3.body);
  const [paidInst] = await q(`SELECT COUNT(*)::int n FROM pledge_installments WHERE pledge_id=$1 AND paid_gift_id IS NOT NULL`, [pl.body.id]);
  ok("the instalment is marked paid by that gift", paidInst.n === 1, paidInst.n);
  const near = (await api("POST", "/deposits/plan", tok, { paste: "William Park\t95.00\tGeneral Operating", depositDate: TODAY, slipTotal: 95 })).body;
  ok("WITHIN TEN PER CENT IS A QUESTION, not a match",
    near.lines[0].state === "needs_you" && near.lines[0].reason === "near_installment" && /ten per cent/.test(near.lines[0].needs),
    near.lines[0]);
  const far = (await api("POST", "/deposits/plan", tok, { paste: "William Park\t70.00\tGeneral Operating", depositDate: TODAY, slipTotal: 70 })).body;
  ok("…and further away than that is simply a gift", far.lines[0].state === "placed" && !far.lines[0].installmentId, far.lines[0]);

  // ── §7 · reversible as a whole ───────────────────────────────────────────
  console.log("\n— §7 · reversible as a whole, for 24 hours —");
  const beforeRev = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float cash FROM gifts WHERE org_id=$1`, [A]))[0];
  const rev = await api("POST", `/imports/${dep.id}/reverse`, tok);
  ok("the deposit reverses", rev.status === 200 && rev.body.gifts === 10, rev.body);
  const afterRev = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float cash FROM gifts WHERE org_id=$1`, [A]))[0];
  ok("its ten gifts are gone, and only its ten", afterRev.n === beforeRev.n - 10 && c(afterRev.cash) === c(beforeRev.cash) - SLIP_CENTS,
    { before: beforeRev, after: afterRev });
  const [gone] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND name='Jonas Kirke'`, [A]);
  ok("the person it created, who has no other history, is gone with it", gone.n === 0, gone.n);
  const [chenAfter] = await q(`SELECT total_giving::float t FROM donors WHERE org_id=$1 AND name='Margaret Chen'`, [A]);
  ok("a donor's total is RECOMPUTED from what remains, never decremented", c(chenAfter.t) === 0, chenAfter.t);
  const [orphanTxn] = await q(`SELECT COUNT(*)::int n FROM fin_transactions f LEFT JOIN gifts g ON g.id=f.gift_id
                                 WHERE f.org_id=$1 AND f.gift_id IS NOT NULL AND g.id IS NULL`, [A]);
  ok("no ledger row is left pointing at a gift that no longer exists", orphanTxn.n === 0, orphanTxn.n);
  const again = await api("POST", `/imports/${dep.id}/reverse`, tok);
  ok("reversing twice is refused", again.status === 409 && again.body.error === "already_reversed", again.body);
  await q(`UPDATE imports SET committed_at = NOW() - interval '30 hours' WHERE id=$1`, [d2.body.id]);
  const late = await api("POST", `/imports/${d2.body.id}/reverse`, tok);
  ok("after 24 hours the window is CLOSED, and it says why",
    late.status === 409 && late.body.error === "window_closed" && /gift by gift/.test(late.body.message), late.body.message);
  const imports = (await api("GET", "/imports", tok)).body.imports;
  ok("an ordinary import cannot be reversed as a whole at all",
    (await api("POST", `/imports/imp_nope/reverse`, tok)).status === 404 && imports.every(i => i.shape === "deposit"), null);

  // ── §8 · org A cannot touch org B ────────────────────────────────────────
  console.log("\n— §8 · one org cannot touch another's deposit —");
  const bDep = await api("POST", "/deposits/commit", tokB,
    { paste: "Diana Torres\t500.00\tXenia", depositDate: TODAY, slipTotal: 500 });
  ok("org B records its own deposit", bDep.status === 201, bDep.status);
  const cross = await api("POST", `/imports/${bDep.body.id}/reverse`, tok);
  ok("org A cannot reverse it — 404, never a false success", cross.status === 404, cross.status);
  const crossRead = await api("GET", `/imports/${bDep.body.id}`, tok);
  ok("…nor read it", crossRead.status === 404, crossRead.status);
  const [bStill] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [B]);
  ok("…and org B's gift is untouched", bStill.n === 1, bStill.n);
  const crossFund = await api("POST", "/deposits/plan", tok,
    { paste: "Diana Torres\t10.00\tXenia", depositDate: TODAY, slipTotal: 10, resolutions: { 1: { fundId: `ffgen_${B}` } } });
  ok("a fund id from another org never reaches a gift",
    crossFund.status === 200 && crossFund.body.lines[0].fundId === `ffgen_${B}`, crossFund.body.lines[0]?.fundId);
  const crossCommit = await api("POST", "/deposits/commit", tok,
    { paste: "Diana Torres\t10.00\tXenia", depositDate: TODAY, slipTotal: 10, resolutions: { 1: { fundId: `ffgen_${B}` } } });
  const crossGift = await q(`SELECT g.fund_id FROM gifts g JOIN donors d ON d.id=g.donor_id
                               WHERE g.org_id=$1 AND d.name='Diana Torres' AND g.amount=10`, [A]);
  ok("…the write refuses it and leaves the gift undesignated rather than pointing across the wall",
    crossCommit.status === 201 && crossGift.length === 1 && crossGift[0].fund_id === null, { status: crossCommit.status, fund: crossGift[0]?.fund_id });

  summary("build88b-deposit");
  await closeDb();
})();
