// BUILD-88b B.2 — PLEDGES THAT KEEP THEMSELVES.
// Run: node tests/build88b-pledges.test.js
//
// A pledge was ONE amount and ONE due date. "The March instalment arrived" had
// nowhere to land, a twelve-month pledge could only ever be all or nothing, and
// a donor who signed and then stopped paying was the quietest kind of bad news:
// nothing fails, nothing bounces, and the money simply never arrives.
//
//   §1  a pledge stores instalments, generated from a cadence if that is all
//       there is, and the schedule SUMS to the pledge
//   §2  a payment matching an instalment applies by itself, from every door,
//       and moves the balance
//   §3  the last payment closes the pledge, and that is the moment a
//       thank-you is queued
//   §4  thirty days past due opens EXACTLY ONE thread, with the step and a
//       drafted note in her voice — and not a second one
//   §5  deceased, do-not-contact and do-not-solicit donors get none
//   §6  a SHELL pledge (88a A.7, inferred from payments) never goes late; it
//       says which part is missing
//   §7  the morning sentence gains "Two pledge instalments are late."
//   §8  Steward sends none of it
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const ORG = "org_b88bp";
const c = n => Math.round(Number(n) * 100);
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const daysAgo = n => { const [y, m, d] = civilToday().split("-").map(Number); return iso(Date.UTC(y, m - 1, d) - n * 86400000); };

let captured = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", x => (b += x));
  req.on("end", () => { try { captured.push({ path: req.url, body: b ? JSON.parse(b) : null }); } catch { }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"mock"}'); });
});
const mails = () => captured.filter(e => e.path === "/emails");

const CHILD = ["thank_you_drafts", "pledge_installments", "threads", "digest_sends", "notification_sends",
  "workflow_runs", "workflows", "moves", "opportunities", "tasks", "receipts", "pledges", "fin_audit_log",
  "metric_snapshots", "imports", "donor_relationships", "recurring_subscriptions", "fundraising_goals",
  "fin_transactions", "gifts", "interactions", "donors", "campaigns", "budgets", "accounts", "fin_funds", "users"];

(async () => {
  await new Promise((r, j) => { sink.on("error", j); sink.listen(SINK_PORT, r); });
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,receipt_address)
           VALUES ($1,'B88b Pledges','b88b-pledges',1,'active','team','America/New_York','1 Main St')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88bp',$1,'b88bp@t.local',$2,'Ada Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active) VALUES ('acct_b88bp',$1,'4010','Contributions','revenue','contributions',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88bp',$1,'General Operating',false)`, [ORG]);
  await q(`UPDATE orgs SET default_fund_id='ff_b88bp' WHERE id=$1`, [ORG]);
  // Her voice, so the draft is in it.
  const SAMPLES = [
    "Dear Anna,\n\nThank you so much for the gift. It means a lot to the families here, and to me.\n\nWith gratitude,\nAda",
    "Dear Bill,\n\nYour cheque arrived this morning, thank you. The roof is nearly finished now.\n\nWith gratitude,\nAda",
    "Dear Sara,\n\nThank you for standing with us again this year. It matters more than you probably know.\n\nWith gratitude,\nAda",
  ];
  const tok = await login("b88bp@t.local");
  const TODAY = civilToday();
  await api("PUT", "/org/voice-samples", tok, { samples: SAMPLES });

  const people = [["keeper", "Hannah Keeper", {}], ["late", "Silas Overdue", {}],
                  ["dnc", "Nora Nocontact", { do_not_contact: true }],
                  ["dec", "Elias Gone", { deceased: true }],
                  ["dns", "Marta Noask", { do_not_solicit: true }],
                  ["shell", "Adam Yeardley", {}]];
  for (const [key, name, flags] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name,deceased,do_not_contact,do_not_solicit)
             VALUES ($1,$2,$3,$4,'new','steward','u_b88bp','Ada Admin',$5,$6,$7)`,
      [`d_${key}`, ORG, name, `${key}@b88bp.test`, !!flags.deceased, !!flags.do_not_contact, !!flags.do_not_solicit]);
  }

  // ── §1 · a pledge stores its instalments ─────────────────────────────────
  console.log("\n— §1 · a pledge stores its instalments —");
  const pl = await api("POST", "/donors/d_keeper/pledges", tok,
    { amount: "1,000.00", dueDate: daysAgo(90), frequency: "monthly", installmentCount: 3, notes: "Capital campaign" });
  ok("a pledge with a cadence generates a schedule", pl.status === 201 && (pl.body.installments || []).length === 3, { status: pl.status, body: JSON.stringify(pl.body).slice(0, 300) });
  ok("THE SCHEDULE SUMS TO THE PLEDGE, to the cent (the remainder rides the first)",
    (pl.body.installments || []).reduce((s, i) => s + c(i.amount), 0) === c(1000), (pl.body.installments || []).map(i => i.amount));
  const sched = (await api("GET", `/pledges/${pl.body.id}/installments`, tok)).body;
  ok("the schedule reads back with its due dates a month apart",
    sched.installments.length === 3 && sched.installments[1].due_date > sched.installments[0].due_date, sched.installments.map(i => i.due_date));
  const badSched = await api("PUT", `/pledges/${pl.body.id}/installments`, tok,
    { installments: [{ dueDate: TODAY, amount: 100 }, { dueDate: TODAY, amount: 100 }] });
  ok("a hand-typed schedule that does NOT sum to the pledge is refused, with both figures",
    badSched.status === 400 && badSched.body.error === "schedule_does_not_sum" && /1,000\.00/.test(badSched.body.message), badSched.body);

  // ── §2 · a payment applies by itself ─────────────────────────────────────
  console.log("\n— §2 · a payment that matches an instalment applies by itself —");
  const g1 = await api("POST", "/donors/d_keeper/gifts", tok,
    { amount: 333.34, date: TODAY, type: "cash", paymentMethod: "Check" });
  ok("a gift through the ordinary form records", g1.status === 201 || g1.status === 200, g1.status);
  const s2 = (await api("GET", `/pledges/${pl.body.id}/installments`, tok)).body;
  ok("…and the matching instalment is marked paid, with no one asked",
    s2.installments.filter(i => i.paid_gift_id).length === 1, s2.installments.map(i => [i.amount, !!i.paid_gift_id]));
  const [afterOne] = await q(`SELECT status FROM pledges WHERE id=$1`, [pl.body.id]);
  ok("the pledge is still OPEN with a balance", afterOne.status === "open", afterOne.status);
  const pledgeRows = (await api("GET", "/donors/d_keeper/pledges", tok)).body;
  ok("…and the balance has MOVED by the instalment",
    c(pledgeRows[0].balance) === c(1000) - c(333.34), { balance: pledgeRows[0].balance });
  const [giftType] = await q(`SELECT type, pledge_id FROM gifts WHERE org_id=$1 AND amount=333.34`, [ORG]);
  ok("the gift is typed a pledge payment and linked to the pledge",
    giftType.type === "pledge payment" && giftType.pledge_id === pl.body.id, giftType);
  // A near miss is NOT matched by a background path: there is nobody to ask.
  const nearGift = await api("POST", "/donors/d_keeper/gifts", tok, { amount: 320, date: TODAY, type: "cash", paymentMethod: "Cash" });
  const [nearRow] = await q(`SELECT type, pledge_id FROM gifts WHERE org_id=$1 AND amount=320`, [ORG]);
  ok("an amount NEARLY an instalment is left as a plain gift, not guessed onto the pledge",
    nearGift.status !== 500 && nearRow.pledge_id === null && nearRow.type === "cash", nearRow);

  // ── §3 · the last payment closes it, and queues a thank-you ──────────────
  console.log("\n— §3 · the last payment closes the pledge —");
  await api("POST", "/donors/d_keeper/gifts", tok, { amount: 333.33, date: TODAY, type: "cash", paymentMethod: "Check" });
  await api("POST", "/donors/d_keeper/gifts", tok, { amount: 333.33, date: TODAY, type: "cash", paymentMethod: "Check" });
  const [closed] = await q(`SELECT status, fulfilled_at FROM pledges WHERE id=$1`, [pl.body.id]);
  ok("A REMAINING-BALANCE MATCH CLOSES IT, by itself", closed.status === "fulfilled" && !!closed.fulfilled_at, closed);
  const [allPaid] = await q(`SELECT COUNT(*)::int n FROM pledge_installments WHERE pledge_id=$1 AND paid_gift_id IS NOT NULL`, [pl.body.id]);
  ok("…with all three instalments accounted for", allPaid.n === 3, allPaid.n);
  const tys = (await api("GET", "/thank-yous", tok)).body;
  ok("finishing a pledge queues a thank-you — the single best moment to say it",
    tys.drafts.some(d => d.donorName === "Hannah Keeper" && /finishing your pledge/i.test(d.body)),
    tys.drafts.map(d => [d.donorName, d.body.slice(0, 48)]));
  ok("…in HER voice, not Steward's",
    tys.drafts.some(d => /^Dear Hannah,/m.test(d.body) && /With gratitude,\nAda/.test(d.body) && d.voiceUsed === "org_samples"),
    tys.drafts.find(d => d.donorName === "Hannah Keeper")?.body);

  // ── §4 · thirty days past due ────────────────────────────────────────────
  console.log("\n— §4 · thirty days past due opens exactly one thread —");
  const late = await api("POST", "/donors/d_late/pledges", tok,
    { amount: 1200, dueDate: daysAgo(120), frequency: "monthly", installmentCount: 4 });
  ok("a four-instalment pledge, all of them old", (late.body.installments || []).length === 4, (late.body.installments || []).length);
  const [lateCount] = await q(
    `SELECT COUNT(*)::int n FROM pledge_installments WHERE pledge_id=$1 AND due_date <= $2`, [late.body.id, daysAgo(30)]);
  ok("…and at least two of them more than thirty days past due", lateCount.n >= 2, lateCount.n);

  const sweep1 = await api("POST", "/pledges/run-reminders", tok, { today: TODAY });
  ok("the sweep runs", sweep1.status === 200, sweep1.status);
  const thr = await q(`SELECT id, donor_id, next_step_type, next_step_label, draft_note FROM threads
                        WHERE org_id=$1 AND closed_at IS NULL AND next_step_type='pledge_reminder'`, [ORG]);
  ok("EXACTLY ONE thread, on the one donor — two late instalments are one conversation",
    thr.length === 1 && thr[0].donor_id === "d_late", thr.map(t => t.donor_id));
  ok("…with the step it promises", thr[0].next_step_label === "Pledge instalment reminder", thr[0].next_step_label);
  ok("…and a note already written, in her voice",
    /^Dear Silas,/m.test(thr[0].draft_note || "") && /instalment/.test(thr[0].draft_note) && /With gratitude,\nAda/.test(thr[0].draft_note),
    (thr[0].draft_note || "").slice(0, 160));
  ok("…which asks nothing twice and offers to move the date",
    /please ignore this/.test(thr[0].draft_note) && /move the date/.test(thr[0].draft_note), null);
  const sweep2 = await api("POST", "/pledges/run-reminders", tok, { today: TODAY });
  const [thrAgain] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND closed_at IS NULL AND next_step_type='pledge_reminder'`, [ORG]);
  ok("RUNNING IT AGAIN OPENS NO SECOND THREAD", thrAgain.n === 1 && sweep2.body.opened === 0, { n: thrAgain.n, opened: sweep2.body.opened });
  const [stamped] = await q(`SELECT COUNT(*)::int n FROM pledge_installments WHERE pledge_id=$1 AND reminder_thread_id IS NOT NULL`, [late.body.id]);
  ok("…and the instalment that opened it is stamped, so it cannot open another", stamped.n === 1, stamped.n);
  // Not yet thirty days is not late.
  const fresh = await api("POST", "/donors/d_keeper/pledges", tok,
    { amount: 400, dueDate: daysAgo(10), frequency: "monthly", installmentCount: 2 });
  await api("POST", "/pledges/run-reminders", tok, { today: TODAY });
  const [freshThr] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND donor_id='d_keeper' AND closed_at IS NULL AND next_step_type='pledge_reminder'`, [ORG]);
  ok("ten days past due is not late — thirty is the point", freshThr.n === 0, freshThr.n);

  // ── §5 · the no-ask family ───────────────────────────────────────────────
  console.log("\n— §5 · deceased, do-not-contact and do-not-solicit get none —");
  for (const key of ["dnc", "dec", "dns"]) {
    await api("POST", `/donors/d_${key}/pledges`, tok, { amount: 600, dueDate: daysAgo(120), frequency: "monthly", installmentCount: 2 });
  }
  const sweep3 = await api("POST", "/pledges/run-reminders", tok, { today: TODAY });
  const flagged = await q(`SELECT donor_id FROM threads WHERE org_id=$1 AND closed_at IS NULL AND next_step_type='pledge_reminder' AND donor_id = ANY($2)`,
    [ORG, ["d_dnc", "d_dec", "d_dns"]]);
  ok("A DO-NOT-CONTACT DONOR OPENS NONE", !flagged.some(f => f.donor_id === "d_dnc"), flagged);
  ok("…nor a deceased one", !flagged.some(f => f.donor_id === "d_dec"), flagged);
  ok("…nor one who asked not to be solicited (a reminder is an ask)", !flagged.some(f => f.donor_id === "d_dns"), flagged);
  ok("…and the sweep opened nothing at all on that pass", sweep3.body.opened === 0, sweep3.body);

  // ── §6 · a shell pledge never goes late ──────────────────────────────────
  console.log("\n— §6 · a shell pledge is unfinished, not overdue —");
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,is_shell,notes)
           VALUES ('pl_shell',$1,'d_shell',12000,$2,'open',true,'Pledge of 12 instalments, recorded from 7 payments in the imported file.')`,
    [ORG, daysAgo(200)]);
  const sweep4 = await api("POST", "/pledges/run-reminders", tok, { today: TODAY });
  const [shellThr] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND donor_id='d_shell' AND closed_at IS NULL`, [ORG]);
  ok("a shell pledge two hundred days old opens NOTHING", shellThr.n === 0 && sweep4.body.opened === 0, { n: shellThr.n, opened: sweep4.body.opened });
  const shellRead = (await api("GET", "/pledges/pl_shell/installments", tok)).body;
  ok("…and it says which part is missing rather than chasing anybody",
    shellRead.needsSchedule === true && shellRead.installments.length === 0, shellRead);
  const home = (await api("GET", "/dashboard/home?scope=mine", tok)).body;
  ok("Home counts it as needing a schedule, separately from anything late",
    home.pledgesNeedingSchedule >= 1, home.pledgesNeedingSchedule);
  // Giving it a schedule stops it being a shell.
  const fixed = await api("PUT", "/pledges/pl_shell/installments", tok, { frequency: "monthly", installmentCount: 12, firstDue: daysAgo(200) });
  ok("giving it a schedule makes it an ordinary pledge", fixed.status === 200 && fixed.body.installments.length === 12, fixed.body.installments?.length);
  const [noLongerShell] = await q(`SELECT is_shell FROM pledges WHERE id='pl_shell'`);
  ok("…and it is no longer a shell", noLongerShell.is_shell === false, noLongerShell);

  // ── §7 · the morning sentence ────────────────────────────────────────────
  console.log("\n— §7 · the morning sentence says it —");
  const home2 = (await api("GET", "/dashboard/home?scope=mine", tok)).body;
  ok("Home counts the late instalments", home2.latePledgeInstallments >= 2, home2.latePledgeInstallments);
  const note = await import("../shared/homeNote.js");
  ok("one late instalment reads as one sentence", note.pledgeSentence(1) === "One pledge instalment is late.", note.pledgeSentence(1));
  ok("TWO READS \"Two pledge instalments are late.\"", note.pledgeSentence(2) === "Two pledge instalments are late.", note.pledgeSentence(2));
  ok("…and none says nothing at all", note.pledgeSentence(0) === null, note.pledgeSentence(0));
  const full = note.homeNote({ threads: null, drift: null, atRisk: null, latePledgeInstallments: 2 });
  ok("it reaches the note she reads at twenty to eight", /Two pledge instalments are late\./.test(full), full);
  for (const rule of note.BANNED_PUNCTUATION) {
    ok(`the sentence keeps the voice: no ${rule.name}`, !rule.re.test(note.pledgeSentence(2)), note.pledgeSentence(2));
  }

  // ── §8 · Steward sends none of it ────────────────────────────────────────
  console.log("\n— §8 · Steward sends none of it —");
  ok("not one email left Steward across every sweep in this suite", mails().length === 0, mails().map(m => m.body?.subject));

  summary("build88b-pledges");
  sink.close();
  await closeDb();
})();
