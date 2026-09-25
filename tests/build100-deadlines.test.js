// BUILD-100 (grants) Part 2 — DEADLINES THAT COME AND FIND YOU.
//
// A milestone, when its lead time arrives, IS a Thread on the officer. The
// assertions are the ways that could stop being true:
//   §1  the pure rules — five kinds, Jonathan's lead times, a lead that fires
//       ON the boundary and stays fired, and time stated as a FACT;
//   §2  a report-due 21 days out opens a Thread TODAY, owned by the grant's
//       officer, due on the MILESTONE'S date (not today + the lead);
//   §3  THE CONSTRAINT: a second milestone on the same funder WAITS rather
//       than failing, and the next close advances it with no second mechanism;
//   §4  moving the date moves the Thread;
//   §5  a closed grant opens nothing, and missing a milestone does not close it;
//   §6  the calendar has twelve months whether or not they are empty, and the
//       Home line is absent at zero rather than reading "0 deadlines";
//   §7  the org's own lead times, and a nonsense lead refused;
//   §8  org A can read, add, move or complete none of org B's.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b100_dl", OTHER = "b100_dl2";
const ME = "b100d@example.org", THEM = "b100d-other@example.org";
const PW = "loadtest1234";

const CHILD = ["grant_milestones", "grant_interactions", "program_grants", "grants",
  "pledge_installments", "fin_transactions", "interactions", "threads", "tasks",
  "opportunities", "moves", "gifts", "pledges", "donors", "users",
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
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active', grant_lead_days=NULL`,
  [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name, role = "admin") => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
  [id, org, email, bcrypt.hashSync(PW, 4), name, role]);
const mkFunder = (id, org, name) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count)
   VALUES ($1,$2,$3,$4,'organisation','cultivate',0,0)`, [id, org, name, id + "@example.org"]);

// Civil-date arithmetic in the TEST, independent of the module under test —
// a helper that reused the module's own shiftDays could not catch it being
// wrong. Local calendar parts, never toISOString (the BUILD-99 lesson: after
// 8pm Eastern the UTC calendar has already turned over).
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

(async () => {
  console.log("build100-deadlines");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b100d", ORG, ME, "Allie Barnett");
  await mkUser("u_b100d_off", ORG, "b100d-officer@example.org", "Marcus Webb", "staff");
  await mkUser("u_b100d2", OTHER, THEM, "Not Allie");
  await mkFunder("fd_sun2", ORG, "The Sunrise Foundation");
  await mkFunder("fd_acme2", ORG, "Acme Corporate Giving");
  await mkFunder("fd_other2", OTHER, "Somebody Else Trust");
  const tok = await login(ME), tok2 = await login(THEM);
  const M = await import("../shared/grantMilestones.js");
  const TODAY = todayLocal();

  // ── §1 · THE PURE RULES ─────────────────────────────────────────────────
  console.log("\n— §1 · five kinds, and Jonathan's lead times —");
  ok("§1 five milestone kinds, in order",
     M.MILESTONE_KEYS.join(",") === "loi_due,proposal_due,decision,report_due,renewal_opens", M.MILESTONE_KEYS);
  ok("§1 the lead times are 30/30/0/21/45 as Jonathan set them",
     JSON.stringify(M.DEFAULT_LEAD_DAYS) === JSON.stringify({ loi_due: 30, proposal_due: 30, decision: 0, report_due: 21, renewal_opens: 45 }),
     M.DEFAULT_LEAD_DAYS);
  ok("§1 report_due is the only repeatable kind",
     M.MILESTONE_TYPES.filter(t => t.repeatable).map(t => t.key).join(",") === "report_due");
  // THE BOUNDARY, both sides of it.
  ok("§1 a report exactly 21 days out is inside its lead",
     M.dueWithinLead({ kind: "report_due", dueDate: plusDays(21) }, TODAY, {}));
  ok("§1 …and 22 days out is not",
     !M.dueWithinLead({ kind: "report_due", dueDate: plusDays(22) }, TODAY, {}));
  // ONCE TRUE, STAYS TRUE — a sweep that missed a day must not skip forever.
  ok("§1 an OVERDUE milestone is still inside its lead",
     M.dueWithinLead({ kind: "report_due", dueDate: plusDays(-5) }, TODAY, {}));
  ok("§1 a decision has NO lead — it opens on the day itself",
     M.dueWithinLead({ kind: "decision", dueDate: TODAY }, TODAY, {})
     && !M.dueWithinLead({ kind: "decision", dueDate: plusDays(1) }, TODAY, {}));
  const late = M.milestoneTiming({ kind: "report_due", dueDate: plusDays(-7) }, TODAY);
  ok("§1 lateness is a FACT with its day count", late.band === "overdue" && late.overdueDays === 7, late);
  ok("§1 …and reads as a sentence, not a ratio", /was due 7 days ago\./.test(late.sentence), late.sentence);
  ok("§1 due today says so",
     M.milestoneTiming({ kind: "report_due", dueDate: TODAY }, TODAY).band === "today");
  ok("§1 a label carries the funder AND the programme",
     M.milestoneStepLabel({ kind: "report_due", funderName: "The Sunrise Foundation", program: "Youth programme" })
       === "Write the report for The Sunrise Foundation: Youth programme",
     M.milestoneStepLabel({ kind: "report_due", funderName: "The Sunrise Foundation", program: "Youth programme" }));
  ok("§1 a closed or declined grant wants no milestones",
     !M.grantWantsMilestones("closed") && !M.grantWantsMilestones("declined")
     && M.grantWantsMilestones("awarded") && M.grantWantsMilestones("submitted"));

  // ── §2 · A REPORT 21 DAYS OUT OPENS A THREAD TODAY ──────────────────────
  console.log("\n— §2 · the deadline comes and finds you —");
  await api("PUT", "/funders/fd_sun2", tok, { funderType: "private_foundation" });
  const g1 = await api("POST", "/funders/fd_sun2/grants", tok, {
    program: "Youth programme", amountRequested: 25000, status: "awarded",
    officerId: "u_b100d_off", restriction: "program_restricted" });
  ok("§2 a grant on the funder, owned by an officer", g1.status === 201 && g1.body.officerId === "u_b100d_off",
     JSON.stringify(g1.body).slice(0, 200));

  const reportDue = plusDays(21);
  const ms1 = await api("POST", `/grants/${g1.body.id}/milestones`, tok, { kind: "report_due", dueDate: reportDue });
  ok("§2 the milestone is written", ms1.status === 201, JSON.stringify(ms1.body).slice(0, 250));
  ok("§2 a report due 21 days out is RAISED today, not left pending",
     ms1.body.state === "raised" && !!ms1.body.threadId, ms1.body);
  const [th1] = await q("SELECT * FROM threads WHERE id=$1", [ms1.body.threadId]);
  ok("§2 the Thread is on the FUNDER's record", th1 && th1.donor_id === "fd_sun2", th1 && th1.donor_id);
  ok("§2 …owned by the grant's OFFICER", th1.owner_id === "u_b100d_off", { owner: th1.owner_id, name: th1.owner_name });
  // THE DUE DATE IS THE DEADLINE, not today + the lead. Getting this backwards
  // would put every report three weeks early in the officer's queue forever.
  ok("§2 the Thread is due on the MILESTONE's date", th1.due_date === reportDue, { thread: th1.due_date, ms: reportDue });
  ok("§2 …and its label names the funder and the programme",
     /Write the report for The Sunrise Foundation: Youth programme/.test(th1.next_step_label || ""), th1.next_step_label);
  ok("§2 the thread is OPEN", th1.closed_at === null);
  // A report 30 days out is NOT yet owed.
  const far = await api("POST", `/grants/${g1.body.id}/milestones`, tok, { kind: "report_due", dueDate: plusDays(60) });
  ok("§2 a report sixty days out stays pending", far.status === 201 && far.body.state === "pending", far.body);
  ok("§2 …and opened no thread", far.body.threadId === null);

  // ── §3 · THE CONSTRAINT, AND WHY IT IS NOT A BUG ────────────────────────
  console.log("\n— §3 · a second deadline on the same funder waits its turn —");
  // A proposal on a SECOND grant to the SAME funder, inside its lead window.
  const g2 = await api("POST", "/funders/fd_sun2/grants", tok, {
    program: "Capacity building", amountRequested: 12000, status: "submitted", officerId: "u_b100d_off" });
  const ms2 = await api("POST", `/grants/${g2.body.id}/milestones`, tok, { kind: "proposal_due", dueDate: plusDays(10) });
  ok("§3 the second milestone is accepted", ms2.status === 201, JSON.stringify(ms2.body).slice(0, 200));
  ok("§3 …and WAITS rather than failing", ms2.body.state === "waiting" && ms2.body.threadId === null, ms2.body);
  ok("§3 …and says why, so it does not read as a bug",
     /already have one open follow-up/.test(ms2.body.waitingSentence || ""), ms2.body.waitingSentence);
  ok("§3 the funder still holds exactly ONE open thread",
     (await q("SELECT COUNT(*)::int c FROM threads WHERE org_id=$1 AND donor_id='fd_sun2' AND closed_at IS NULL", [ORG]))[0].c === 1);
  // A sweep while the thread is open changes nothing.
  const sweep1 = await api("POST", "/grants/milestones/run", tok, {});
  ok("§3 a sweep raises nothing while the thread is open", sweep1.body.raised === 0, sweep1.body);
  ok("§3 …and the waiting one is still waiting",
     (await q("SELECT state FROM grant_milestones WHERE id=$1", [ms2.body.id]))[0].state === "waiting");
  // THE SELF-HEAL: close the thread honestly, sweep, and the next one opens.
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside'
            WHERE id=$1`, [ms1.body.threadId]);
  const sweep2 = await api("POST", "/grants/milestones/run", tok, {});
  ok("§3 once the thread closes, the next deadline is raised with NO second mechanism",
     sweep2.body.raised === 1, sweep2.body);
  const after = (await q("SELECT state, thread_id FROM grant_milestones WHERE id=$1", [ms2.body.id]))[0];
  ok("§3 …and it now holds its own thread", after.state === "raised" && !!after.thread_id, after);
  ok("§3 the sweep is idempotent — running it again raises nothing",
     (await api("POST", "/grants/milestones/run", tok, {})).body.raised === 0);

  // ── §4 · MOVING THE DATE MOVES THE THREAD ───────────────────────────────
  console.log("\n— §4 · move the date, move the deadline —");
  const moved = plusDays(5);
  const mv = await api("PUT", `/grants/milestones/${ms2.body.id}`, tok, { dueDate: moved });
  ok("§4 the date moves", mv.status === 200 && mv.body.dueDate === moved, mv.body);
  const [th2] = await q("SELECT due_date FROM threads WHERE id=$1", [after.thread_id]);
  ok("§4 …and the Thread's own due date follows it", th2.due_date === moved, { thread: th2.due_date, ms: moved });
  ok("§4 a date that is not a civil date is refused",
     (await api("PUT", `/grants/milestones/${ms2.body.id}`, tok, { dueDate: "next Tuesday" })).status === 400);
  // A waiting milestone pushed out of its window stops queueing.
  const g3 = await api("POST", "/funders/fd_acme2/grants", tok, {
    program: "Equipment", amountRequested: 8000, status: "submitted" });
  const msA = await api("POST", `/grants/${g3.body.id}/milestones`, tok, { kind: "decision", dueDate: TODAY });
  const msB = await api("POST", `/grants/${g3.body.id}/milestones`, tok, { kind: "report_due", dueDate: plusDays(3) });
  ok("§4 a second deadline on the SAME funder waits", msB.body.state === "waiting", msB.body);
  const pushed = await api("PUT", `/grants/milestones/${msB.body.id}`, tok, { dueDate: plusDays(300) });
  ok("§4 pushed out beyond its lead, a WAITING deadline goes back to pending",
     pushed.body.state === "pending", pushed.body);

  // ── §5 · A CLOSED GRANT OPENS NOTHING ───────────────────────────────────
  console.log("\n— §5 · finished work raises nothing; missing it closes nothing —");
  const g4 = await api("POST", "/funders/fd_acme2/grants", tok, {
    program: "Sponsorship", amountRequested: 3000, status: "submitted" });
  await q("UPDATE grants SET status='closed' WHERE id=$1", [g4.body.id]);
  const msClosed = await api("POST", `/grants/${g4.body.id}/milestones`, tok, { kind: "report_due", dueDate: plusDays(2) });
  ok("§5 a closed grant's milestone opens no thread",
     msClosed.status === 201 && msClosed.body.threadId === null, msClosed.body);
  const sweepClosed = await api("POST", "/grants/milestones/run", tok, {});
  ok("§5 …and a sweep will not raise it either",
     (await q("SELECT thread_id FROM grant_milestones WHERE id=$1", [msClosed.body.id]))[0].thread_id === null,
     sweepClosed.body);
  // MISSING A MILESTONE DOES NOT CLOSE IT.
  const g5 = await api("POST", "/funders/fd_acme2/grants", tok, {
    program: "Overdue thing", amountRequested: 4000, status: "submitted" });
  await q(`INSERT INTO grant_milestones (id,org_id,grant_id,kind,due_date,state)
            VALUES ('gms_b100_late',$1,$2,'report_due',$3,'pending')`, [ORG, g5.body.id, plusDays(-30)]);
  const dl = await api("GET", "/grants/deadlines", tok);
  const lateRow = dl.body.milestones.find(m => m.id === "gms_b100_late");
  ok("§5 a milestone thirty days past due is still OPEN, not closed",
     !!lateRow && lateRow.state !== "done", lateRow && lateRow.state);
  ok("§5 …and it says how late, with the day count", lateRow.band === "overdue" && lateRow.overdueDays === 30, lateRow);
  ok("§5 the overdue count is on the payload", dl.body.overdue >= 1, dl.body.overdue);
  // Done is a mark, not a thread close — the Thread engine's close must stay honest.
  const doneMs = await api("POST", `/grants/milestones/${ms1.body.id}/done`, tok, {});
  ok("§5 marking it done records the person who did it",
     doneMs.status === 200
     && (await q("SELECT completed_by_name FROM grant_milestones WHERE id=$1", [ms1.body.id]))[0].completed_by_name === "Allie Barnett",
     doneMs.body);

  // ── §6 · THE CALENDAR AND THE HOME LINE ─────────────────────────────────
  console.log("\n— §6 · twelve months, and a line only when there is one —");
  const dl2 = await api("GET", "/grants/deadlines", tok);
  ok("§6 the calendar is twelve months", dl2.body.calendar.length === 12, dl2.body.calendar.length);
  ok("§6 …every month present, so an empty month is visibly empty",
     dl2.body.calendar.every(m => /^\d{4}-\d{2}$/.test(m.month) && Number.isInteger(m.count)),
     dl2.body.calendar.map(m => `${m.month}:${m.count}`).join(" "));
  ok("§6 it starts in the current month", dl2.body.calendar[0].month === TODAY.slice(0, 7), dl2.body.calendar[0].month);
  const calTotal = dl2.body.calendar.reduce((s, m) => s + m.count, 0);
  const inTwelve = dl2.body.milestones.filter(m => {
    const mm = String(m.dueDate).slice(0, 7);
    return dl2.body.calendar.some(c => c.month === mm);
  }).length;
  ok("§6 the calendar holds exactly the deadlines that fall inside it",
     calTotal === inTwelve, { calendar: calTotal, inWindow: inTwelve });
  ok("§6 the Home line names the count", /grant deadlines? in the next 14 days/.test(dl2.body.homeLine || ""), dl2.body.homeLine);
  // THE RULE: absent at zero, never "0 deadlines".
  ok("§6 an org with nothing due gets NO line rather than a zero",
     (await api("GET", "/grants/deadlines", tok2)).body.homeLine === null,
     (await api("GET", "/grants/deadlines", tok2)).body.homeLine);
  ok("§6 the pure function agrees", M.homeDeadlineLine([], TODAY) === null);

  // ── §7 · THE ORG'S OWN LEAD TIMES ───────────────────────────────────────
  console.log("\n— §7 · a funder in the pipeline says otherwise —");
  const lead = await api("PUT", "/org/grant-lead-days", tok, { leadDays: { report_due: 45, decision: 7 } });
  ok("§7 an org sets its own lead times", lead.status === 200 && lead.body.leadDays.report_due === 45, lead.body);
  ok("§7 …and the ones it did not set keep the defaults", lead.body.leadDays.loi_due === 30, lead.body.leadDays);
  // A REFUSED VALUE LEAVES WHAT THE ORG CHOSE ALONE. Reverting it to the
  // default would be the product overwriting somebody's decision with its own
  // on the strength of one bad keystroke.
  ok("§7 a negative lead is refused — it would open a thread AFTER the deadline",
     (await api("PUT", "/org/grant-lead-days", tok, { leadDays: { report_due: -5 } })).body.leadDays.report_due === 45);
  ok("§7 …and so is a nonsense one",
     (await api("PUT", "/org/grant-lead-days", tok, { leadDays: { report_due: "soon" } })).body.leadDays.report_due === 45);
  // A PARTIAL SAVE MUST NOT RESET THE REST — the defect §7 found. Touching the
  // decision lead used to take report_due back to its 21-day default.
  const partial = await api("PUT", "/org/grant-lead-days", tok, { leadDays: { decision: 3 } });
  ok("§7 setting ONE lead time leaves the others as the org set them",
     partial.body.leadDays.report_due === 45 && partial.body.leadDays.decision === 3, partial.body.leadDays);
  ok("§7 …and an untouched one still reads its default",
     partial.body.leadDays.loi_due === 30 && M.DEFAULT_LEAD_DAYS.report_due === 21, partial.body.leadDays);
  ok("§7 a 60-day report was pending under the 21-day default",
     (await q("SELECT state FROM grant_milestones WHERE id=$1", [far.body.id]))[0].state === "pending");
  const sweepLead = await api("POST", "/grants/milestones/run", tok, {});
  const farAfter = (await q("SELECT state FROM grant_milestones WHERE id=$1", [far.body.id]))[0];
  ok("§7 …and under the org's OWN 45 days it is still pending at 60 out",
     farAfter.state === "pending", { state: farAfter.state, sweep: sweepLead.body });
  await api("PUT", `/grants/milestones/${far.body.id}`, tok, { dueDate: plusDays(40) });
  const farNow = (await q("SELECT state FROM grant_milestones WHERE id=$1", [far.body.id]))[0];
  ok("§7 moved to 40 days out, the org's 45-day lead DOES reach it",
     farNow.state === "raised" || farNow.state === "waiting", farNow);
  ok("§7 a milestone kind nobody ships is refused",
     (await api("POST", `/grants/${g1.body.id}/milestones`, tok, { kind: "vibes_due", dueDate: plusDays(5) })).status === 400);
  ok("§7 a second LOI on one grant is refused, naming the date already there",
     /already has a/.test(
       (await api("POST", `/grants/${g1.body.id}/milestones`, tok, { kind: "decision", dueDate: plusDays(1) }),
        await api("POST", `/grants/${g1.body.id}/milestones`, tok, { kind: "decision", dueDate: plusDays(2) })).body.error || ""),
     "second decision refused");

  // ── §8 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §8 · another org touches none of it —");
  ok("§8 a foreign grant cannot take a milestone",
     (await api("POST", `/grants/${g1.body.id}/milestones`, tok2, { kind: "report_due", dueDate: plusDays(3) })).status === 404);
  ok("§8 a foreign milestone cannot be moved",
     (await api("PUT", `/grants/milestones/${ms2.body.id}`, tok2, { dueDate: plusDays(9) })).status === 404);
  ok("§8 …and its date did not change",
     (await q("SELECT due_date FROM grant_milestones WHERE id=$1", [ms2.body.id]))[0].due_date === moved);
  ok("§8 a foreign milestone cannot be marked done",
     (await api("POST", `/grants/milestones/${ms2.body.id}/done`, tok2, {})).status === 404);
  ok("§8 their deadline list is empty, not somebody else's",
     (await api("GET", "/grants/deadlines", tok2)).body.milestones.length === 0);
  ok("§8 …and their calendar is still twelve honest months",
     (await api("GET", "/grants/deadlines", tok2)).body.calendar.length === 12);
  const theirSweep = await api("POST", "/grants/milestones/run", tok2, {});
  ok("§8 their sweep raises nothing of ours", theirSweep.body.raised === 0 && theirSweep.body.checked === 0, theirSweep.body);
  ok("§8 no thread was planted in their org",
     (await q("SELECT COUNT(*)::int c FROM threads WHERE org_id=$1", [OTHER]))[0].c === 0);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
