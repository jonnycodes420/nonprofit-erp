// BUILD-85 — THE FOLLOW-UP ENGINE. Run: node tests/build85.test.js
//
// BUILD-81 built a careful RECORD of commitments and half an engine. The five
// things that made it half are each pinned here, and each is asserted in the
// direction that would actually break:
//
//   §1  THE RANKING IS PURE, BOUNDED AND EXPLAINABLE. Every signal fires,
//       every signal is capped, money is scored RELATIVE to the org's own
//       scale, and a superseded reason never reaches a screen.
//   §2  IT IS ONE PERSON'S LIST. Officer A cannot see officer B's threads,
//       and cannot get them by editing a query param — the server downgrades
//       `scope=all` for a non-admin rather than trusting the client.
//   §3  THE CAP IS REAL and the remainder is STATED.
//   §4  PLANNING FORWARD, without a touch — including for a selection, where
//       a donor who already has an open thread is SKIPPED, never overwritten.
//   §5  ONE MORNING EMAIL. Threads and tasks in a single brief, proven
//       against REAL captured bytes, with both idempotency ledgers intact and
//       both preferences still meaning something.
//   §6  THE ENGINE IS MEASURED. Continuation — the rate at which closing a
//       thread opens the next — is the number the product's whole claim rests
//       on, and nothing counted it until now.
//   §7  ORG ISOLATION on every new route.
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const ORG = "org_b85", ORG2 = "org_b85two";
const iso = d => new Date(d).toISOString().slice(0, 10);

// THE FIXTURES ARE ANCHORED TO A PINNED DAY, NOT TO THE CALENDAR.
// The BUILD-84 rule, learned the expensive way: a suite that dates its
// fixtures from real today and then drives a job with a pinned date is
// measuring the calendar, and it fails on whichever morning the two disagree.
// Everything below is relative to WEDNESDAY, which is also the day the brief
// is run — so the relationship between a fixture and the job that reads it is
// fixed forever. SATURDAY sits three days after it, for the weekend rule.
const WEDNESDAY = "2026-09-09", SATURDAY = "2026-09-12";
const W_MS = Date.parse(WEDNESDAY + "T12:00:00Z");
const daysAgo = n => iso(W_MS - n * 86400000);
const daysAhead = n => iso(W_MS + n * 86400000);
// Real today, for the one assertion that is genuinely about now: nothing.
void civilToday;

let captured = [];
const sink = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* non-JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails");
const mailTo = addr => mails().filter(m => (m.body?.to || "") === addr || (Array.isArray(m.body?.to) && m.body.to.includes(addr)));

const TABLES = ["threads", "digest_sends", "notification_sends", "notification_failures", "tasks", "opportunities",
  "recurring_subscriptions", "interactions", "gifts", "donors", "users",
  "fin_transactions", "budgets", "accounts", "fin_funds", "metric_snapshots"];

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address,legal_name)
           VALUES ($1,'B85 Engine Org','b85-engine',1,'active','growth','9 Harbour Row, Fairhope, AL 36532','B85 Engine Inc.')`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B85 Other Org','b85-other',1,'active','growth')`, [ORG2]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  const user = (id, org, email, name, role, extra = "") =>
    q(`INSERT INTO users (id,org_id,email,password_hash,name,role${extra ? "," + extra.split("=")[0] : ""})
       VALUES ($1,$2,$3,$4,$5,$6${extra ? ",TRUE" : ""})`.replace(",TRUE", extra ? "," + extra.split("=")[1] : ""),
      [id, org, email, hash, name, role]);
  await user("u_b85_admin", ORG, "b85admin@test.local", "Ada Admin", "admin");
  await user("u_b85_a", ORG, "b85a@test.local", "Officer Aisha", "staff");
  await user("u_b85_b", ORG, "b85b@test.local", "Officer Ben", "staff");
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b85_o2',$1,'b85o2@test.local',$2,'Other Admin','admin')`, [ORG2, hash]);
}

const mkDonor = (id, org, name, total = 0, gifts = 0, owner = null, ownerName = null) =>
  q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,stage,assigned_to,assigned_to_name,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,'steward',$7,$8,'u_b85_admin','Ada Admin')`,
    [id, org, name, id + "@t.local", total, gifts, owner, ownerName]);

const mkThread = (id, org, donor, label, due, opened, { type = "follow_up", owner = null, ownerName = null, snooze = null, giftId = null } = {}) =>
  q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,snoozed_until,opening_gift_id,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'u_b85_admin','Ada Admin')`,
    [id, org, donor, type, label, due, opened, owner, ownerName, snooze, giftId]);

(async () => {
  await new Promise((res, rej) => { sink.on("error", rej); sink.listen(SINK_PORT, res); });
  await reset();

  // ── §1 · the ranking is pure, bounded and explainable ────────────────────
  console.log("\n— §1 · which thread first, and why —");
  const R = await import("../shared/threadRank.js");
  const T0 = "2026-09-15";
  const base = { dueDate: "2026-09-15", daysOpen: 1, majorThreshold: 50000 };

  const plain = R.rankThread({ ...base, dueDate: "2026-09-10" }, T0);
  ok("an overdue thread scores on lateness and says so",
     plain.score === 15 && plain.why === "Overdue 5 days", plain);
  ok("…and the band is a FACT off the due date, not an invented threshold",
     plain.band === "overdue" && R.rankThread(base, T0).band === "today"
       && R.rankThread({ ...base, dueDate: "2026-09-20" }, T0).band === "ahead");

  // BOUNDED: past the cap, more lateness adds nothing. A single runaway
  // signal is how a ranking stops being a ranking.
  const at21 = R.rankThread({ ...base, dueDate: "2026-08-25" }, T0).score;
  const at60 = R.rankThread({ ...base, dueDate: "2026-07-17" }, T0).score;
  ok("overdue is CAPPED — a 60-day-late thread cannot outrank everything forever",
     at21 === at60 && at21 === R.OVERDUE_CAP_DAYS * 3, { at21, at60 });

  // MONEY IS RELATIVE TO THE ORG. The same ask scores differently against a
  // different house scale — the rule that stops a CRM telling a food pantry
  // its work is small.
  const smallHouse = R.rankThread({ ...base, openAskAmount: 50000, majorThreshold: 50000 }, T0).score;
  const bigHouse   = R.rankThread({ ...base, openAskAmount: 50000, majorThreshold: 5000000 }, T0).score;
  ok("the SAME ask scores higher at a small shop than at a large one (relative, never absolute)",
     smallHouse > bigHouse, { smallHouse, bigHouse });
  ok("…and the ask reason names the real figure",
     R.rankThread({ ...base, openAskAmount: 40000 }, T0).why === "$40,000 ask open");

  ok("a failing monthly gift outranks a same-day ordinary follow-up",
     R.rankThread({ ...base, recurringAtRisk: true }, T0).score > R.rankThread(base, T0).score);
  ok("a first gift says what is actually at stake",
     R.rankThread({ ...base, isFirstGift: true }, T0).why === "Their first gift. This decides whether there is a second.");
  ok("a major donor is judged against the org's OWN p90",
     R.rankThread({ ...base, lifetimeGiving: 60000 }, T0).score === 26
       && R.rankThread({ ...base, lifetimeGiving: 10 }, T0).score === 8, {
         major: R.rankThread({ ...base, lifetimeGiving: 60000 }, T0).score });

  // SUPERSEDES — the reason that would otherwise be dead copy.
  const thanks = R.rankThread({ ...base, dueDate: "2026-09-10", stepType: "thank_you_note" }, T0);
  ok("a late thank-you tells its OWN story, not the generic overdue one",
     thanks.why.startsWith("Thank-you 5 days late"), thanks.why);
  ok("…and the superseded reason is gone from the display while its points still count",
     !thanks.reasons.some(r => r.key === "overdue") && thanks.score === 25, thanks);

  // A thread with nothing urgent about it scores zero and still ranks.
  ok("a thread with no signal at all scores 0 and has no reason to give",
     R.rankThread({ dueDate: "2026-09-20", daysOpen: 1 }, T0).score === 0
       && R.rankThread({ dueDate: "2026-09-20", daysOpen: 1 }, T0).why === null);

  // The queue: band first, score inside it, STABLE.
  const qIn = [
    { id: "a", donorName: "Zed", nextStep: { due: "2026-09-20" }, dueDate: "2026-09-20", daysOpen: 1 },
    { id: "b", donorName: "Amy", nextStep: { due: "2026-09-10" }, dueDate: "2026-09-10", daysOpen: 1 },
    { id: "c", donorName: "Bob", nextStep: { due: "2026-09-10" }, dueDate: "2026-09-10", daysOpen: 1, recurringAtRisk: true },
  ];
  const built = R.buildQueue(qIn, T0);
  ok("the queue puts overdue first and ranks by consequence inside the band",
     built.list.map(t => t.id).join("") === "cba", built.list.map(t => t.id));
  const twice = R.buildQueue(qIn, T0).list.map(t => t.id).join("");
  ok("…and the order is STABLE across identical calls (a queue that reshuffles reads as broken)",
     twice === "cba");
  const many = Array.from({ length: 20 }, (_, i) => ({ id: "t" + i, donorName: "D" + i, nextStep: { due: "2026-09-10" }, dueDate: "2026-09-10", daysOpen: 1 }));
  const capped = R.buildQueue(many, T0);
  ok("the cap holds and the remainder is STATED, never hidden",
     capped.list.length === R.QUEUE_CAP && capped.more === 20 - R.QUEUE_CAP && capped.total === 20, capped.more);

  // ── §2 · it is ONE PERSON'S list ─────────────────────────────────────────
  console.log("\n— §2 · ownership: not everyone's list —");
  await mkDonor("d_b85_a1", ORG, "Aisha Donor One", 100, 2, "u_b85_a", "Officer Aisha");
  await mkDonor("d_b85_b1", ORG, "Ben Donor One", 100, 2, "u_b85_b", "Officer Ben");
  await mkDonor("d_b85_un", ORG, "Unowned Donor", 100, 2);
  await mkThread("th_b85_a1", ORG, "d_b85_a1", "Call Aisha's donor", daysAgo(2), daysAgo(4), { owner: "u_b85_a", ownerName: "Officer Aisha" });
  await mkThread("th_b85_b1", ORG, "d_b85_b1", "Call Ben's donor", daysAgo(2), daysAgo(4), { owner: "u_b85_b", ownerName: "Officer Ben" });
  await mkThread("th_b85_un", ORG, "d_b85_un", "Nobody owns this", daysAgo(2), daysAgo(4));

  const tokA = await login("b85a@test.local"), tokB = await login("b85b@test.local"), tokAdmin = await login("b85admin@test.local");
  const aMine = (await api("GET", "/threads?scope=mine", tokA)).body;
  ok("officer A's queue is officer A's threads only",
     aMine.list.map(t => t.id).join() === "th_b85_a1", aMine.list.map(t => t.id));
  ok("…and an unowned thread is NOT silently handed to a staff member", !aMine.list.some(t => t.id === "th_b85_un"));

  // THE GATE IS THE SERVER'S, not the client's. A staff member editing the
  // query param gets their own list back, not everyone's.
  const aAll = (await api("GET", "/threads?scope=all", tokA)).body;
  ok("a non-admin asking for scope=all is DOWNGRADED server-side, not obeyed",
     aAll.scope === "mine" && !aAll.list.some(t => t.id === "th_b85_b1"), { scope: aAll.scope, ids: aAll.list.map(t => t.id) });
  ok("…and the client is told it may not view across officers", aAll.canViewAll === false);

  const admAll = (await api("GET", "/threads?scope=all", tokAdmin)).body;
  ok("an admin asking for scope=all gets the whole shop",
     ["th_b85_a1", "th_b85_b1", "th_b85_un"].every(id => admAll.list.some(t => t.id === id)), admAll.list.map(t => t.id));
  const admMine = (await api("GET", "/threads?scope=mine", tokAdmin)).body;
  ok("an admin's OWN list carries the unowned threads as a backstop — nothing is orphaned",
     admMine.list.some(t => t.id === "th_b85_un") && !admMine.list.some(t => t.id === "th_b85_a1"), admMine.list.map(t => t.id));
  ok("…and the unowned count is reported so it can be fixed rather than tolerated", admMine.stat.unowned >= 1, admMine.stat);

  // A donor's own record shows its thread whoever owns it.
  const onDonor = (await api("GET", "/threads?donorId=d_b85_b1", tokA)).body;
  ok("a donor's record shows that donor's thread regardless of who owns it",
     onDonor.list.length === 1 && onDonor.list[0].id === "th_b85_b1", onDonor.list.map(t => t.id));

  // ── §3 · the cap is real, live ───────────────────────────────────────────
  console.log("\n— §3 · a queue, not a wall —");
  for (let i = 0; i < 20; i++) {
    await mkDonor("d_b85_c" + i, ORG, "Cap Donor " + i, 100, 1, "u_b85_a", "Officer Aisha");
    await mkThread("th_b85_c" + i, ORG, "d_b85_c" + i, "Call " + i, daysAgo(1), daysAgo(2), { owner: "u_b85_a", ownerName: "Officer Aisha" });
  }
  const capped2 = (await api("GET", "/threads?scope=mine", tokA)).body;
  ok("the live queue is capped at twelve", capped2.list.length === R.QUEUE_CAP, capped2.list.length);
  ok("…the open count still tells the truth about the whole pile", capped2.stat.open === 21, capped2.stat);
  ok("…and the remainder is stated", capped2.more === 21 - R.QUEUE_CAP, capped2.more);
  ok("every row carries the reason its order was built from",
     capped2.list.every(t => t.rank && typeof t.rank.score === "number"), capped2.list[0]?.rank);
  ok("the bands are reported with their counts", Array.isArray(capped2.bands) && capped2.bands.length >= 1, capped2.bands);

  // ── §4 · planning forward ────────────────────────────────────────────────
  console.log("\n— §4 · you can look forward, not only back —");
  await mkDonor("d_b85_p1", ORG, "Planned One", 100, 1, "u_b85_a", "Officer Aisha");
  await mkDonor("d_b85_p2", ORG, "Planned Two", 100, 1, "u_b85_a", "Officer Aisha");
  const planned = await api("POST", "/donors/d_b85_p1/threads", tokA, { label: "Call about the spring appeal", due: daysAhead(7) });
  ok("a thread opens with NOTHING having happened first", planned.status === 201 && !!planned.body.thread?.id, planned.body);
  const p1 = (await api("GET", "/threads?donorId=d_b85_p1", tokA)).body.list[0];
  ok("…and it reads honestly as planned, with no touch behind it",
     p1?.lastTouch?.kind === "none" && p1.nextStep.label === "Call about the spring appeal", p1?.lastTouch);

  const dup = await api("POST", "/donors/d_b85_p1/threads", tokA, { label: "Something else", due: daysAhead(3) });
  ok("a second open thread is REFUSED — one open step per donor is the model",
     dup.status === 409 && dup.body.error === "thread_open", dup.body);
  ok("…and the refusal names the commitment that is already there",
     String(dup.body.message || "").includes("Call about the spring appeal"), dup.body.message);

  const badDate = await api("POST", "/donors/d_b85_p2/threads", tokA, { label: "x", due: "next tuesday" });
  ok("a plan without a real date is refused", badDate.status === 400, badDate.body);
  const noLabel = await api("POST", "/donors/d_b85_p2/threads", tokA, { label: "   ", due: daysAhead(3) });
  ok("a plan without a step is refused", noLabel.status === 400, noLabel.body);

  // The bulk path: the one that makes "call these twenty" real.
  const bulkIds = ["d_b85_p1", "d_b85_p2", "d_b85_a1"];
  const bulk = await api("POST", "/threads/plan", tokA, { donorIds: bulkIds, label: "Year-end call", due: daysAhead(10) });
  ok("a selection can be planned in one act", bulk.status === 201, bulk.body);
  ok("…donors who already had an open step are SKIPPED, never overwritten",
     bulk.body.planned === 1 && bulk.body.skipped === 2, bulk.body);
  ok("…and the skip says which and why",
     bulk.body.details.skipped.every(s => s.reason === "already_open"), bulk.body.details.skipped);
  const stillThere = (await api("GET", "/threads?donorId=d_b85_p1", tokA)).body.list[0];
  ok("the commitment already made is untouched by the plan that skipped it",
     stillThere.nextStep.label === "Call about the spring appeal", stillThere.nextStep);

  // ── §5 · ONE morning email ───────────────────────────────────────────────
  console.log("\n— §5 · one morning, one email —");
  await q(`DELETE FROM digest_sends WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,done,assigned_to,assigned_to_name)
           VALUES ('tk_b85_1',$1,'File the Q3 grant report',$2,'high',0,'u_b85_a','Officer Aisha')`, [ORG, daysAgo(1)]);
  captured = [];
  const run1 = await api("POST", "/nudges/run", tokAdmin, { today: WEDNESDAY, force: true });
  ok("the brief runs", run1.status === 200, run1.body);
  const aisha = mailTo("b85a@test.local");
  ok("officer Aisha gets EXACTLY ONE email, not one for threads and one for tasks",
     aisha.length === 1, aisha.map(m => m.body?.subject));
  const briefHtml = aisha[0]?.body?.html || "";
  ok("…and the one email carries BOTH her threads and her tasks",
     briefHtml.includes("Aisha Donor One") && briefHtml.includes("File the Q3 grant report"), briefHtml.slice(0, 200));
  // Every thread row prints the sentence its ORDER was built from — whichever
  // signal happened to win. Pinning one phrasing here would pin the fixture's
  // accident rather than the property.
  const REASON_SHAPES = /(Overdue \d+ day|Due today|Top tenth of your donors|\$[\d,]+ ask open|Monthly gift is failing|Their first gift|Thank-you \d+ day|Open \d+ days)/;
  ok("…with the reason each thread is on the list, printed on the row",
     REASON_SHAPES.test(briefHtml), briefHtml.slice(600, 1400));
  ok("…capped, with the remainder stated",
     briefHtml.includes("more open"), briefHtml.slice(-600));
  ok("the subject counts everything waiting and names the escalation",
     /waiting on you · .+, day \d+/.test(aisha[0]?.body?.subject || ""), aisha[0]?.body?.subject);
  ok("Aisha's email does NOT contain Ben's donor — the list is hers",
     !briefHtml.includes("Ben Donor One"), briefHtml.slice(0, 300));
  const adminMail = mailTo("b85admin@test.local");
  ok("the admin gets a team roll-up — counts per officer, never everyone's rows",
     (adminMail[0]?.body?.html || "").includes("Across the team"), (adminMail[0]?.body?.html || "").slice(-900));

  // Idempotent across BOTH ticks: whichever arrives first sends, the other
  // finds the reservations taken.
  captured = [];
  await api("POST", "/nudges/run", tokAdmin, { today: WEDNESDAY, force: true });
  await api("POST", "/digests/run-daily", tokAdmin, { today: WEDNESDAY });
  ok("re-running EITHER morning tick sends nothing more", mailTo("b85a@test.local").length === 0, mails().length);

  // Preferences still each mean something.
  await q(`DELETE FROM digest_sends WHERE org_id=$1`, [ORG]);
  await q(`UPDATE users SET notify_daily_tasks=FALSE WHERE id='u_b85_a'`);
  captured = [];
  await api("POST", "/nudges/run", tokAdmin, { today: WEDNESDAY, force: true });
  const noTasks = mailTo("b85a@test.local")[0]?.body?.html || "";
  ok("opting out of tasks leaves the threads and drops the task section",
     noTasks.includes("Aisha Donor One") && !noTasks.includes("File the Q3 grant report"), noTasks.slice(0, 200));
  await q(`UPDATE users SET notify_thread_nudge=FALSE WHERE id='u_b85_a'`);
  await q(`DELETE FROM digest_sends WHERE org_id=$1`, [ORG]);
  captured = [];
  await api("POST", "/nudges/run", tokAdmin, { today: WEDNESDAY, force: true });
  ok("opting out of BOTH sends no email at all", mailTo("b85a@test.local").length === 0);
  const reserved = await q(`SELECT COUNT(*)::int n FROM digest_sends WHERE org_id=$1 AND recipient_user_id='u_b85_a'`, [ORG]);
  ok("…and reserves nothing, so turning it back on tomorrow still works", reserved[0].n === 0, reserved[0]);
  await q(`UPDATE users SET notify_thread_nudge=NULL, notify_daily_tasks=NULL WHERE id='u_b85_a'`);

  // The weekend rule belongs to the THREAD section, not the email.
  await q(`DELETE FROM digest_sends WHERE org_id=$1`, [ORG]);
  captured = [];
  await api("POST", "/digests/run-daily", tokAdmin, { today: SATURDAY });
  const sat = mailTo("b85a@test.local")[0]?.body?.html || "";
  ok("on a Saturday the thread section is absent (an intrusion nobody asked for)",
     !sat.includes("Aisha Donor One"), sat.slice(0, 200));
  ok("…but a task the user themself dated Saturday still arrives",
     sat.includes("File the Q3 grant report"), sat.slice(0, 200));

  // ── §6 · does the engine run? ────────────────────────────────────────────
  console.log("\n— §6 · the number the whole claim rests on —");
  await mkDonor("d_b85_h1", ORG, "Chain Donor", 100, 1, "u_b85_a", "Officer Aisha");
  await mkThread("th_b85_h1", ORG, "d_b85_h1", "Follow up", daysAgo(1), daysAgo(3), { owner: "u_b85_a", ownerName: "Officer Aisha" });
  // Close it the way the product intends: a conversation that opens the next step.
  const cont = await api("POST", "/donors/d_b85_h1/conversations", tokA, {
    touch: "call_reached", line: "Caught her at home, good talk", nextStep: { type: "follow_up", due: daysAhead(5) } });
  ok("logging a conversation closes the open thread and opens the next", cont.status === 201 && !!cont.body.thread, cont.body);
  await mkDonor("d_b85_h2", ORG, "Dead End Donor", 100, 1, "u_b85_a", "Officer Aisha");
  await mkThread("th_b85_h2", ORG, "d_b85_h2", "Follow up", daysAgo(1), daysAgo(3), { owner: "u_b85_a", ownerName: "Officer Aisha" });
  await api("POST", "/donors/d_b85_h2/conversations", tokA, {
    touch: "call_no_answer", line: "No answer, leaving it", nextStep: { skipped: true } });

  const health = (await api("GET", "/threads/health", tokAdmin)).body;
  ok("the chain is counted: a close that opened the next step is a continuation",
     health.continued === 1, health);
  ok("…and a close that ended the chain is not", health.outcome === 2 && health.continued === 1, health);
  ok("THIN DATA IS SAID, NOT SMOOTHED — a rate over two closes is returned null with the count beside it",
     health.continuationRate === null && health.thinData === true, health);
  ok("the open count and time-to-close are reported alongside it",
     typeof health.open === "number" && health.medianDaysToClose !== undefined, health);

  // ── §7 · org isolation on every new route ────────────────────────────────
  console.log("\n— §7 · nothing crosses an org boundary —");
  const tok2 = await login("b85o2@test.local");
  const foreignPlan = await api("POST", "/donors/d_b85_p2/threads", tok2, { label: "Reach across", due: daysAhead(3) });
  ok("planning on another org's donor is NOT FOUND", foreignPlan.status === 404, foreignPlan.body);
  const foreignBulk = await api("POST", "/threads/plan", tok2, { donorIds: ["d_b85_a1", "d_b85_b1"], label: "Reach across", due: daysAhead(3) });
  ok("a bulk plan naming another org's donors plants nothing",
     foreignBulk.body.planned === 0 && foreignBulk.body.details.skipped.every(s => s.reason === "not_found"), foreignBulk.body);
  const leaked = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1`, [ORG2]);
  ok("…and org two still has no threads of its own", leaked[0].n === 0, leaked[0]);
  const otherQueue = (await api("GET", "/threads?scope=all", tok2)).body;
  ok("org two's queue is empty, not org one's", otherQueue.list.length === 0, otherQueue.list.length);
  const otherHealth = (await api("GET", "/threads/health", tok2)).body;
  ok("…and so is its health", otherHealth.open === 0 && otherHealth.closed === 0, otherHealth);

  // A lapsed org may read but not plan (the checkWriteAccess convention).
  await q(`UPDATE orgs SET subscription_status='trial_expired' WHERE id=$1`, [ORG]);
  const ro = await api("POST", "/donors/d_b85_p2/threads", tokA, { label: "x", due: daysAhead(3) });
  ok("a read_only org cannot plan (402), and can still read its queue",
     ro.status === 402 && (await api("GET", "/threads", tokA)).status === 200, ro.status);
  await q(`UPDATE orgs SET subscription_status='active' WHERE id=$1`, [ORG]);

  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  sink.close(); await closeDb();
  summary();
})().catch(e => { console.error(e); sink.close(); process.exit(1); });
