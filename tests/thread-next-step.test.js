// FIX (2026-09-09) — the Thread's next step reads the NOTE, and the
// touch-type table stops defaulting everything to a thank-you.
//
//   §1  the note extractor, pure: the shapes people actually write, what is
//       captured, and what is deliberately NOT a match
//   §2  precedence — the note outranks the touch type; nothing in the note
//       falls through to the touch default; the surface says which it used
//   §3  the server stores the user's own sentence as the step label, records
//       which rule proposed it, and gives a note-derived step no follow-on
//   §4  the rewritten touch-type table: one of EVERY type logged through the
//       real route, each checked for the step it proposes and the day it is
//       due — thank-you belongs to the gift row and nowhere else
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_fix3ns";

async function reset() {
  const CHILD = ["threads", "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "recurring_subscriptions", "receipts", "pledges", "fin_audit_log",
    "fin_transactions", "gifts", "interactions", "notification_sends", "metric_snapshots"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Next Step Org','fix3-nextstep',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_fix3',$1,'fix3@test.local',$2,'Step Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_fix3',$1,'4010','Contributions','revenue')`, [ORG]);
  for (const [id, name] of [["d_fix3_a", "Ana Reyes"], ["d_fix3_b", "Ben Kohl"], ["d_fix3_c", "Cass Mundy"],
                            ["d_fix3_d", "Dev Oyelaran"], ["d_fix3_e", "Elin Vargas"], ["d_fix3_f", "Fay Turnbull"],
                            ["d_fix3_g", "Gus Ivanov"]])
    await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'steward','u_fix3','Step Admin')`,
      [id, ORG, name, id + "@fix3.test"]);
}

(async () => {
  await reset();
  const tok = await login("fix3@test.local");
  const shape = await import("../shared/threadShape.js");
  const TODAY = (await api("GET", "/threads", tok)).body.today;
  const plus = (n) => shape.addCivilDays(TODAY, n);

  // ── §1 · the note extractor ──────────────────────────────────────────────
  console.log("\n— §1 · what a note asks for —");
  const MATCHES = [
    ["She asked for the import report.",            "Send the import report",              "asked_for"],
    ["I said I'd send the board packet",            "Send the board packet",               "promised"],
    ["Told Ana I'd draft the LOI",                  "Draft the LOI",                       "promised"],
    ["promised to call her Tuesday",                "Call her Tuesday",                    "promised"],
    ["He wants a copy of the budget",               "Send a copy of the budget",           "wants"],
    ["She needs the 990 before the board meeting",  "Send the 990 before the board meeting", "needs"],
    ["Following up with the finance committee",     "Follow up on the finance committee",  "following_up"],
    ["asked about the naming policy",               "Follow up on the naming policy",      "asked_about"],
  ];
  for (const [note, label, rule] of MATCHES) {
    const r = shape.stepFromNote(note);
    ok(`"${note}" → ${label}`, r && r.label === label && r.rule === rule, r);
  }
  ok("the matched phrase rides along, so a wrong read is visible",
     shape.stepFromNote("She asked for the import report.").matched === "asked for the import report",
     shape.stepFromNote("She asked for the import report."));

  const NON_MATCHES = [
    "Good conversation about the gala",
    "Left a voicemail",
    "I promised it",                       // no real object
    "She wants it",                        // stop-word object
    "",
  ];
  for (const note of NON_MATCHES)
    ok(`no ask in "${note}" → no note step`, shape.stepFromNote(note) === null, shape.stepFromNote(note));

  const twoAsks = shape.stepFromNote("She asked for the annual report and then said I'd send the budget");
  ok("two asks in one note → the FIRST one, not a run-on",
     twoAsks.label === "Send the annual report", twoAsks);
  const longAsk = shape.stepFromNote("She asked for " + "the very detailed reconciliation spreadsheet ".repeat(6));
  ok("a runaway object is capped at a line", longAsk.label.length <= 90, longAsk.label.length);

  // ── §2 · the note outranks the touch type ────────────────────────────────
  console.log("\n— §2 · precedence, and saying which rule was used —");
  const meetingAsk = shape.nextStepSuggestion("meeting", TODAY, "She asked for the import report.");
  ok("THE REPORTED DEFECT: Meeting + an ask no longer proposes a thank-you note",
     meetingAsk.label === "Send the import report", meetingAsk);
  ok("the note-derived step says it came from the note",
     meetingAsk.source.from === "note" && /note/i.test(meetingAsk.source.why), meetingAsk.source);
  const meetingPlain = shape.nextStepSuggestion("meeting", TODAY, "Good conversation about the gala");
  ok("no ASK in the note → the touch-type default (completed by the subject, §4)",
     meetingPlain.source.from === "touch" &&
     meetingPlain.label.startsWith(shape.NEXT_STEP_DEFAULTS.meeting.label), meetingPlain);
  ok("an empty note is not an ask", shape.nextStepSuggestion("meeting", TODAY, "").source.from === "touch");
  ok("the note decides WHAT, the touch still decides WHEN",
     meetingAsk.due === plus(shape.NEXT_STEP_DEFAULTS.meeting.plusDays), meetingAsk.due);
  // MANIFEST EDIT (item 2): the BUILD-81 meeting/visit chain — thank-you +2
  // walked to a Follow up +14 — is retired, because the meeting row IS the
  // follow-up now. Neither kind of step opens one.
  ok("no step opens a template follow-on chain any more",
     !meetingAsk.followon && !meetingPlain.followon, { a: meetingAsk.followon, b: meetingPlain.followon });
  ok("the type is read from the label's own verb",
     shape.nextStepTypeForLabel("Send the import report") === "send" &&
     shape.nextStepTypeForLabel("Call her Tuesday") === "follow_up", null);

  // ── §3 · the server keeps the user's own sentence ────────────────────────
  console.log("\n— §3 · what the database stores —");
  const r1 = await api("POST", "/donors/d_fix3_a/conversations", tok, {
    touch: "meeting", line: "She asked for the import report.",
    nextStep: { type: "send", label: "Send the import report", due: plus(2), source: "note" },
  });
  ok("logging with a note-derived step is accepted", r1.status === 201, r1.body);
  const [th1] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_fix3_a'`, [ORG]);
  ok("the thread holds the sentence the user saw, not a template",
     th1.next_step_label === "Send the import report", th1.next_step_label);
  ok("the note-derived thread opens no follow-on chain",
     !th1.followon_type && !th1.followon_due, { t: th1.followon_type, d: th1.followon_due });
  const [i1] = await q(`SELECT metadata FROM interactions WHERE org_id=$1 AND donor_id='d_fix3_a'`, [ORG]);
  const meta1 = typeof i1.metadata === "string" ? JSON.parse(i1.metadata) : i1.metadata;
  ok("which rule proposed the step is recorded with the conversation",
     meta1.next_step_source === "note" && meta1.next_step_label === "Send the import report", meta1);

  const r2 = await api("POST", "/donors/d_fix3_b/conversations", tok, {
    touch: "meeting", line: "Good conversation about the gala.",
    nextStep: { type: shape.NEXT_STEP_DEFAULTS.meeting.type, due: plus(2), source: "touch" },
  });
  ok("a step with no label still falls back to the type's own label", r2.status === 201, r2.body);
  const [th2] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_fix3_b'`, [ORG]);
  ok("the template step keeps its own label, and opens no chain",
     th2.next_step_label.startsWith(shape.NEXT_STEP_DEFAULTS.meeting.label) && !th2.followon_type, th2.next_step_label);

  const r3 = await api("POST", "/donors/d_fix3_c/conversations", tok, {
    touch: "call_reached", line: "Caught her between meetings.",
    nextStep: { type: "follow_up", label: "   ", due: plus(7) },
  });
  const [th3] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_fix3_c'`, [ORG]);
  ok("a blank label is not stored as a blank step", r3.status === 201 && th3.next_step_label.trim().length > 0, th3.next_step_label);
  const r4 = await api("POST", "/donors/d_fix3_d/conversations", tok, {
    touch: "call_reached", line: "Long one.",
    nextStep: { type: "follow_up", label: "x".repeat(400), due: plus(7) },
  });
  const [th4] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id='d_fix3_d'`, [ORG]);
  ok("an oversized label is bounded, not refused",
     r4.status === 201 && th4.next_step_label.length === shape.NEXT_STEP_LABEL_MAX, th4.next_step_label.length);
  const r5 = await api("POST", "/donors/d_fix3_e/conversations", tok, {
    touch: "call_reached", line: "No decision.", nextStep: { label: "Send the thing", due: plus(7) },
  });
  ok("a label without a known type is still refused (the vocabulary holds)", r5.status === 400, r5.body);

  // ── §4 · the touch-type table, one of each ──────────────────────────────
  console.log("\n— §4 · every touch type, its step and its due date —");
  // The spec's table. Each row: touch → the step proposed, and how many days
  // out it is due. A change here is a change to what the product promises.
  const TABLE = [
    ["gift",           "Send thank-you note",   2],
    ["meeting",        "Follow up",             5],
    ["visit",          "Follow up",             5],
    ["call_reached",   "Follow up",             5],
    ["call_no_answer", "Try again",             2],
    ["email",          "Follow up if no reply", 4],
    ["ask",            "Check in on the ask",  14],
  ];
  for (const [key, label, days] of TABLE) {
    const s = shape.nextStepSuggestion(key, TODAY);
    ok(`${key} → "${label}", due +${days}`, s && s.label === label && s.due === plus(days), s);
  }
  ok("a note with no touch gets NO automatic step",
     shape.nextStepSuggestion("note_only", TODAY) === null, shape.nextStepSuggestion("note_only", TODAY));
  ok("thank-you belongs to the gift row and nowhere else",
     Object.entries(shape.NEXT_STEP_DEFAULTS).filter(([, d]) => /thank/i.test(d.label)).map(([k]) => k).join() === "gift",
     Object.entries(shape.NEXT_STEP_DEFAULTS).filter(([, d]) => /thank/i.test(d.label)).map(([k]) => k));
  ok("no default opens a follow-on chain any more",
     Object.values(shape.NEXT_STEP_DEFAULTS).every(d => !d.followon), shape.NEXT_STEP_DEFAULTS);
  ok("every touch type the flow offers is a real one",
     shape.TOUCH_TYPES.every(t => t.key && t.label && t.interactionType), shape.TOUCH_TYPES);
  ok("every default's type is in the offered vocabulary",
     Object.values(shape.NEXT_STEP_DEFAULTS).every(d => !!shape.nextStepLabelFor(d.type)), null);

  // The meeting row completes itself from the note, and never renders a
  // placeholder when there is no subject to find.
  const mSub = shape.nextStepSuggestion("meeting", TODAY, "Long conversation about the capital campaign");
  ok("meeting → \"Follow up on <subject>\" when the note names one",
     mSub.label === "Follow up on the capital campaign" && mSub.due === plus(5), mSub);
  const mBare = shape.nextStepSuggestion("meeting", TODAY, "Ran long. Good energy.");
  ok("no subject in the note → the bare verb, never a literal placeholder",
     mBare.label === "Follow up" && !/[<>]|subject/i.test(mBare.label), mBare);
  ok("an ask in the note still outranks the meeting subject",
     shape.nextStepSuggestion("meeting", TODAY, "Talked about the gala. She asked for the import report.").label
       === "Send the import report", null);

  // Through the real route: each touch type lands, and what the thread holds
  // is what the table said.
  console.log("\n— §4b · the same table through the real route —");
  const donorsFor = ["d_fix3_a", "d_fix3_b", "d_fix3_c", "d_fix3_d", "d_fix3_e", "d_fix3_f", "d_fix3_g"];
  await q(`DELETE FROM threads WHERE org_id=$1`, [ORG]);
  for (let i = 0; i < TABLE.length; i++) {
    const [key, label, days] = TABLE[i];
    const donorId = donorsFor[i];
    const s = shape.nextStepSuggestion(key, TODAY);
    const r = await api("POST", `/donors/${donorId}/conversations`, tok, {
      touch: key, line: `Logged a ${key}.`,
      nextStep: { type: s.type, label: s.label, due: s.due, source: "touch" },
    });
    const [th] = await q(`SELECT * FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, donorId]);
    ok(`${key} logs and opens a thread holding "${label}" due +${days}`,
       r.status === 201 && th && th.next_step_label === label && th.due_date === plus(days),
       { status: r.status, label: th && th.next_step_label, due: th && th.due_date });
  }
  const noteOnly = await api("POST", "/donors/d_fix3_a/conversations", tok, {
    touch: "note_only", line: "Ran into her at the market.", nextStep: { skipped: true },
  });
  ok("a note with no touch logs, and skipping it is recorded as skipped", noteOnly.status === 201, noteOnly.body);
  const [noteInt] = await q(
    `SELECT type, metadata FROM interactions WHERE org_id=$1 AND donor_id='d_fix3_a' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  const nMeta = typeof noteInt.metadata === "string" ? JSON.parse(noteInt.metadata) : noteInt.metadata;
  ok("the note lands on the timeline as a note, marked skipped",
     noteInt.type === "note" && nMeta.next_step === "skipped", { t: noteInt.type, m: nMeta });

  summary("thread-next-step");
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
