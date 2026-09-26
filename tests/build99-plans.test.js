// BUILD-99 (major gifts) Part 3 — CULTIVATION PLANS.
//
// A plan is a sequence of BUILD-81 threads for one person. The assertions are
// the ways that could stop being true:
//   §1  the pure rules — a step type the Thread engine does not know is refused
//       at SAVE, and so is a template whose steps go backwards in time;
//   §2  applying a four-step template creates ONE OPEN thread and three pending;
//   §3  closing the first opens the second WITH THE RIGHT DUE DATE;
//   §4  skipping is recorded as skipped, never deleted and never marked done;
//   §5  nothing in a plan can send anything — asserted on the source, not
//       remembered;
//   §6  a plan waits rather than stalling when the donor already has an open
//       follow-up of their own, and says so;
//   §7  org A can touch none of org B's plans.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { ok, summary, login, api, q, closeDb, civilPlusDays } = require("./helpers");

const ORG = "b99_pl", OTHER = "b99_pl2";
const ME = "b99pl@example.org", THEM = "b99pl-other@example.org";
const PW = "loadtest1234";

const CHILD = ["cultivation_plan_steps", "cultivation_plans", "cultivation_templates",
  "pledge_installments", "fin_transactions", "interactions", "threads", "tasks",
  "opportunities", "moves", "gifts", "pledges", "donors", "users", "budgets", "accounts", "fin_funds"];
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
const mkDonor = (id, org, name) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,assigned_to,assigned_to_name)
   VALUES ($1,$2,$3,$4,'person','cultivate',5000,4,$5,$6)`,
  [id, org, name, id + "@example.org", org === ORG ? "u_b99pl" : "u_b99pl2", org === ORG ? "Allie Barnett" : "Not Allie"]);

const FOUR = [
  { type: "follow_up", label: "Visit her at the farm", offsetDays: 7 },
  { type: "follow_up", label: "Invite her to the barn", offsetDays: 30 },
  { type: "send", label: "Send the annual report", offsetDays: 60 },
  { type: "check_in_ask", label: "Ask for the lead gift", offsetDays: 90 },
];
// A civil date N days from the ORG's today. `toISOString()` is wrong here and
// wrong in the same way it is wrong everywhere in this repo: after 8pm Eastern
// the UTC calendar has already turned over, so the helper's base day was
// tomorrow's and every expected date was one out while the server was right.
// Local calendar PARTS, never a UTC round-trip. (The fixture org is
// America/New_York, which is this machine's zone.)
// CI #297 — ANCHORED ON THE ORG'S CIVIL TODAY, not the machine's. The previous
// helper read the runner's own calendar parts on the assumption that the runner
// is America/New_York, which is true on a laptop and false on a UTC CI runner:
// at 20:30 EDT the runner's day had already turned over and every expected date
// was one out while the server was right. `civilPlusDays` in tests/helpers.js is
// the one of these now.
const civilPlus = (n) => civilPlusDays(n);

(async () => {
  console.log("build99-plans");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b99pl", ORG, ME, "Allie Barnett");
  await mkUser("u_b99pl2", OTHER, THEM, "Not Allie");
  await mkDonor("dl_marg", ORG, "Margaret Ruiz");
  await mkDonor("dl_busy", ORG, "Busy Bob");
  await mkDonor("dl_other", OTHER, "Not Yours");
  const tok = await login(ME), tok2 = await login(THEM);

  const PL = await import("../shared/planShape.js");
  const TS = await import("../shared/threadShape.js");

  // ── §1 · THE PURE RULES ─────────────────────────────────────────────────
  console.log("\n— §1 · a step the engine cannot run is refused at save —");
  // THE PROPERTY THAT MATTERS: every plan step type is a type the Thread engine
  // already knows, asserted against its table rather than remembered. A step
  // this module offered and the engine refused would fail on the day its turn
  // came, weeks after somebody wrote the template.
  const engineTypes = new Set(TS.NEXT_STEP_TYPES.map(t => t.type));
  ok("§1 every plan step type is one the follow-up engine knows",
     PL.PLAN_TYPE_KEYS.every(t => engineTypes.has(t)), PL.PLAN_TYPE_KEYS.filter(t => !engineTypes.has(t)));
  ok("§1 a four-step template validates", PL.validateTemplate({ name: "Board prospect", steps: FOUR }).ok);
  ok("§1 a nameless template is refused", !PL.validateTemplate({ name: "  ", steps: FOUR }).ok);
  ok("§1 a template with no steps is refused", !PL.validateTemplate({ name: "Empty", steps: [] }).ok);
  ok("§1 an unknown step type is refused by name",
     /follow-up engine knows/.test(PL.validateTemplate({ name: "x", steps: [{ type: "telepathy", label: "Think at them", offsetDays: 1 }] }).errors[0].message));
  ok("§1 a negative offset is refused",
     !PL.validateTemplate({ name: "x", steps: [{ type: "send", label: "y", offsetDays: -1 }] }).ok);
  ok("§1 a fractional offset is refused",
     !PL.validateTemplate({ name: "x", steps: [{ type: "send", label: "y", offsetDays: 1.5 }] }).ok);
  // THE ONE THIS RULE EXISTS FOR: a template whose step 2 is due before step 1
  // looks overdue on the day it is applied, and the officer cannot tell that
  // from real lateness.
  const back = PL.validateTemplate({ name: "Backwards", steps: [
    { type: "send", label: "First", offsetDays: 30 }, { type: "send", label: "Second", offsetDays: 7 }] });
  ok("§1 steps that go BACKWARDS in time are refused at save", !back.ok && /due before step 1/.test(back.errors[0].message), back.errors);
  ok("§1 …and equal offsets are allowed (two things on the same day is a plan, not a mistake)",
     PL.validateTemplate({ name: "Same day", steps: [
       { type: "send", label: "A", offsetDays: 7 }, { type: "send", label: "B", offsetDays: 7 }] }).ok);
  const prog = PL.planProgress([{ status: "done" }, { status: "open" }, { status: "pending" }, { status: "pending" }]);
  ok("§1 progress counts each state", prog.done === 1 && prog.open === 1 && prog.pending === 2);
  ok("§1 the sentence names which step is open", /step 2 of 4 is open/.test(PL.planSentence(prog, "Board prospect")), PL.planSentence(prog, "Board prospect"));
  const waiting = PL.planProgress([{ status: "done" }, { status: "pending" }, { status: "pending" }]);
  ok("§1 …and says NOTHING IS STUCK when the step is waiting on the person's own follow-up",
     /waiting for this person's current follow-up/.test(PL.planSentence(waiting, "P")) && /Nothing is stuck/.test(PL.planSentence(waiting, "P")),
     PL.planSentence(waiting, "P"));
  ok("§1 a skipped step does not stall the plan — it is not pending",
     PL.nextPendingSeq([{ seq: 1, status: "skipped" }, { seq: 2, status: "pending" }]) === 2);
  ok("§1 a plan of done-and-skipped is finished", PL.planIsFinished([{ status: "done" }, { status: "skipped" }]));
  ok("§1 …and the sentence says how many were skipped",
     /1 of them skipped/.test(PL.planSentence(PL.planProgress([{ status: "done" }, { status: "skipped" }]), "P")));

  // ── §2 · APPLYING ───────────────────────────────────────────────────────
  console.log("\n— §2 · one open thread and three pending —");
  const bad = await api("POST", "/cultivation-templates", tok, { name: "Bad", steps: [{ type: "nope", label: "x", offsetDays: 1 }] });
  ok("§2 the route refuses an invalid template", bad.status === 400, JSON.stringify(bad.body).slice(0, 200));
  const tpl = await api("POST", "/cultivation-templates", tok, { name: "First-time $1,000 donor", steps: FOUR });
  ok("§2 the template saves", tpl.status === 201 && tpl.body.steps.length === 4, JSON.stringify(tpl.body).slice(0, 220));
  const applied = await api("POST", "/donors/dl_marg/plan", tok, { templateId: tpl.body.id });
  ok("§2 applying it succeeds", applied.status === 201, JSON.stringify(applied.body).slice(0, 250));
  const steps = applied.body.steps;
  ok("§2 four steps exist", steps.length === 4);
  ok("§2 EXACTLY ONE is open", steps.filter(s => s.status === "open").length === 1, steps.map(s => s.status));
  ok("§2 …and the other three are pending", steps.filter(s => s.status === "pending").length === 3, steps.map(s => s.status));
  ok("§2 the open one is the FIRST", steps.find(s => s.status === "open").seq === 1);
  ok("§2 dates are offset from today, not from the template",
     steps[0].dueDate === civilPlus(7) && steps[3].dueDate === civilPlus(90), steps.map(s => s.dueDate));
  // The open step IS a thread — the same row every other follow-up is.
  const th = await q("SELECT id, next_step_label, due_date, closed_at FROM threads WHERE org_id=$1 AND donor_id='dl_marg' AND closed_at IS NULL", [ORG]);
  ok("§2 there is ONE open thread on the donor", th.length === 1, th.length);
  ok("§2 …it is the plan's step, by id", th[0].id === steps.find(s => s.status === "open").threadId);
  ok("§2 …carrying the step's own label and date", th[0].next_step_label === "Visit her at the farm" && th[0].due_date === civilPlus(7), th[0]);
  ok("§2 the plan carries its sentence", /step 1 of 4 is open/.test(applied.body.sentence), applied.body.sentence);
  ok("§2 applying it leaves a line on her timeline",
     (await q("SELECT COUNT(*)::int c FROM interactions WHERE org_id=$1 AND donor_id='dl_marg' AND note LIKE 'Cultivation plan applied%'", [ORG]))[0].c === 1);
  const twice = await api("POST", "/donors/dl_marg/plan", tok, { templateId: tpl.body.id });
  ok("§2 a SECOND active plan on one person is refused, and names the first",
     twice.status === 409 && twice.body.code === "plan_already_active" && /First-time/.test(twice.body.error),
     JSON.stringify(twice.body).slice(0, 220));

  // ── §3 · THE CHAIN ──────────────────────────────────────────────────────
  console.log("\n— §3 · closing one opens the next, on the right date —");
  // Logging a conversation closes the open thread. The officer SKIPS her own
  // next step here so the plan's step 2 is the only thing wanting the slot.
  const conv = await api("POST", "/donors/dl_marg/conversations", tok, {
    touch: "visit", line: "Drove out to the farm; she showed me the new stalls", nextStep: { skipped: true } });
  ok("§3 the conversation is logged", conv.status === 201, JSON.stringify(conv.body).slice(0, 220));
  const p2 = await api("GET", "/donors/dl_marg/plan", tok);
  const s2 = p2.body.plan.steps;
  ok("§3 step 1 is DONE", s2[0].status === "done", s2.map(x => x.status));
  ok("§3 step 2 is now OPEN", s2[1].status === "open", s2.map(x => x.status));
  ok("§3 …and only step 2", s2.filter(x => x.status === "open").length === 1);
  ok("§3 step 2's thread carries ITS OWN due date, not step 1's",
     (await q("SELECT due_date, next_step_label FROM threads WHERE id=$1", [s2[1].threadId]))[0].due_date === civilPlus(30),
     s2[1].dueDate);
  ok("§3 …and its own label", (await q("SELECT next_step_label FROM threads WHERE id=$1", [s2[1].threadId]))[0].next_step_label === "Invite her to the barn");
  ok("§3 the sentence moved with it", /step 2 of 4 is open/.test(p2.body.plan.sentence), p2.body.plan.sentence);
  ok("§3 who closed it is on the record", !!s2[0].closedAt);

  // Dismissing a thread advances the plan too — deciding not to do something is
  // still deciding.
  const dis = await api("POST", `/threads/${s2[1].threadId}/dismiss`, tok, { reason: "handled_outside" });
  ok("§3 dismissing the open thread succeeds", dis.status === 200, JSON.stringify(dis.body).slice(0, 200));
  const p3 = await api("GET", "/donors/dl_marg/plan", tok);
  ok("§3 a dismissal closes the step and opens the next",
     p3.body.plan.steps[1].status === "done" && p3.body.plan.steps[2].status === "open",
     p3.body.plan.steps.map(x => x.status));

  // ── §4 · SKIPPING ───────────────────────────────────────────────────────
  console.log("\n— §4 · a skip is recorded as a skip —");
  const openNow = p3.body.plan.steps.find(s => s.status === "open");
  const sk = await api("POST", `/plan-steps/${openNow.id}/skip`, tok, {});
  ok("§4 skipping succeeds", sk.status === 200, JSON.stringify(sk.body).slice(0, 200));
  const s4 = sk.body.plan.steps;
  ok("§4 the skipped step says SKIPPED, not done", s4[2].status === "skipped", s4.map(x => x.status));
  ok("§4 …and it still exists", s4.length === 4);
  ok("§4 the next step opened", s4[3].status === "open", s4.map(x => x.status));
  ok("§4 the skipped step's thread was closed WITH A REASON (a thread may not close without one)",
     (await q("SELECT close_kind, close_reason FROM threads WHERE id=$1", [s4[2].threadId]))[0].close_reason === "handled_outside");
  ok("§4 who skipped it is on the record", !!s4[2].closedByName);
  const skAgain = await api("POST", `/plan-steps/${openNow.id}/skip`, tok, {});
  ok("§4 skipping a closed step is refused rather than counted twice", skAgain.status === 409);
  // Finish the last step and the plan finishes itself.
  const last = s4[3];
  await api("POST", `/plan-steps/${last.id}/skip`, tok, {});
  const p5 = await api("GET", "/donors/dl_marg/plan", tok);
  ok("§4 a plan whose every step is closed is FINISHED, with no outcome to record",
     p5.body.plan.status === "done" && /is finished/.test(p5.body.plan.sentence), p5.body.plan.sentence);
  ok("§4 …and the sentence counts the skips", /2 of them skipped/.test(p5.body.plan.sentence), p5.body.plan.sentence);
  ok("§4 a finished plan leaves the donor with no open thread",
     (await q("SELECT COUNT(*)::int c FROM threads WHERE org_id=$1 AND donor_id='dl_marg' AND closed_at IS NULL", [ORG]))[0].c === 0);
  ok("§4 …so a new plan may be applied", (await api("POST", "/donors/dl_marg/plan", tok, { templateId: tpl.body.id })).status === 201);

  // ── §5 · A PLAN CANNOT SEND ANYTHING ────────────────────────────────────
  // Asserted on the SOURCE, because "it does not send" is a property of the code
  // and not of a run. A plan that grew a send would pass every other assertion
  // in this file.
  console.log("\n— §5 · nothing in a plan sends anything —");
  const planSrc = fs.readFileSync(path.join(__dirname, "..", "shared", "planShape.js"), "utf8");
  ok("§5 the pure module names no email, subject, body or send",
     !/\b(sendEmail|resend|subject|emailBody|mailto|send\()/i.test(planSrc.replace(/\/\/[^\n]*/g, "")));
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const planBlock = server.slice(server.indexOf("// ── BUILD-99 (major gifts) Part 3 — CULTIVATION PLANS"),
                                server.indexOf("app.post(\"/plans/:id/stop\""));
  ok("§5 the routes call no mail sender",
     !/sendWorkflowEmail|sendDigestEmail|sendGiftAlertEmail|sendRecurringDonorEmail|resend\.emails|sendDunningEmail/.test(planBlock));
  ok("§5 …and no sequence machinery", !/sequence_sends|enrollInSequence|processSequences/.test(planBlock));

  // ── §6 · IT WAITS, IT DOES NOT STALL ────────────────────────────────────
  console.log("\n— §6 · a plan applied to somebody mid-conversation waits —");
  // Bob already has an open follow-up of his own.
  const own = await api("POST", "/donors/dl_busy/conversations", tok, {
    touch: "meeting", line: "Talked about the spring appeal",
    nextStep: { type: "follow_up", due: civilPlus(5), label: "Follow up on the spring appeal" } });
  ok("§6 Bob has his own open follow-up", own.status === 201);
  const bobPlan = await api("POST", "/donors/dl_busy/plan", tok, { templateId: tpl.body.id });
  ok("§6 a plan can still be applied", bobPlan.status === 201, JSON.stringify(bobPlan.body).slice(0, 200));
  ok("§6 …with NO step open, because his one thread slot is taken",
     bobPlan.body.steps.every(s => s.status === "pending"), bobPlan.body.steps.map(s => s.status));
  ok("§6 …and the sentence says nothing is stuck",
     /Nothing is stuck/.test(bobPlan.body.sentence), bobPlan.body.sentence);
  ok("§6 Bob still has exactly one open thread — his own",
     (await q("SELECT COUNT(*)::int c FROM threads WHERE org_id=$1 AND donor_id='dl_busy' AND closed_at IS NULL", [ORG]))[0].c === 1);
  // Closing HIS thread hands the slot to the plan, with no tick involved.
  await api("POST", "/donors/dl_busy/conversations", tok, {
    touch: "email", line: "Sent him the appeal copy", nextStep: { skipped: true } });
  const bob2 = await api("GET", "/donors/dl_busy/plan", tok);
  ok("§6 closing his own follow-up opens the plan's first step — no sweep required",
     bob2.body.plan.steps[0].status === "open", bob2.body.plan.steps.map(s => s.status));

  // ── §7 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §7 · another org can touch none of it —");
  ok("§7 a foreign donor's plan is 404", (await api("GET", "/donors/dl_marg/plan", tok2)).status === 404);
  ok("§7 a foreign template cannot be applied",
     (await api("POST", "/donors/dl_other/plan", tok2, { templateId: tpl.body.id })).status === 404);
  ok("§7 a foreign template cannot be edited", (await api("PUT", `/cultivation-templates/${tpl.body.id}`, tok2, { name: "Mine now" })).status === 404);
  ok("§7 …and nothing changed by trying",
     (await q("SELECT name FROM cultivation_templates WHERE id=$1", [tpl.body.id]))[0].name === "First-time $1,000 donor");
  ok("§7 a foreign step cannot be skipped",
     (await api("POST", `/plan-steps/${bobPlan.body.steps[1].id}/skip`, tok2, {})).status === 404);
  ok("§7 …and it is still pending", (await q("SELECT status FROM cultivation_plan_steps WHERE id=$1", [bobPlan.body.steps[1].id]))[0].status === "pending");
  ok("§7 their template list is their own, not somebody else's",
     (await api("GET", "/cultivation-templates", tok2)).body.templates.length === 0);
  // Editing a template must NOT rewrite a plan already being worked through.
  await api("PUT", `/cultivation-templates/${tpl.body.id}`, tok, { name: "Renamed", steps: [FOUR[0]] });
  const afterEdit = await api("GET", "/donors/dl_busy/plan", tok);
  ok("§7 editing a template does not rewrite an applied plan",
     afterEdit.body.plan.templateName === "First-time $1,000 donor" && afterEdit.body.plan.steps.length === 4,
     { name: afterEdit.body.plan.templateName, steps: afterEdit.body.plan.steps.length });
  const arch = await api("DELETE", `/cultivation-templates/${tpl.body.id}`, tok);
  ok("§7 deleting a template ARCHIVES it, so an applied plan keeps its origin",
     arch.status === 200 && arch.body.archived === true &&
     (await q("SELECT archived_at FROM cultivation_templates WHERE id=$1", [tpl.body.id]))[0].archived_at !== null);
  ok("§7 …and it drops off the list", (await api("GET", "/cultivation-templates", tok)).body.templates.length === 0);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
