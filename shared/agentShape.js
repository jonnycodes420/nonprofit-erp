// shared/agentShape.js — BUILD-97 Part 3. THE AGENT YOU CAN TELL WHAT TO DO.
//
// BUILD-75 C.2 drew the line and it has not moved:
//
//     AGENTS READ, DRAFT AND PROPOSE. A HUMAN COMMITS ANYTHING THAT MOVES
//     MONEY OR REACHES A DONOR.
//
// What was missing was the other half — she could not TELL it anything. The
// product had three canned automations somebody else wrote and a Suggested
// panel that invented rules. This is the half that was missing: she types an
// instruction in her own words, the agent turns it into a PLAN over her own
// data, shows her the plan, runs it, and reports.
//
// ── WHAT MOVED, AND HOW FAR ────────────────────────────────────────────────
// BUILD-94 Part 3 relaxed BUILD-88c's rule exactly once, for sequences:
//
//     SHE WROTE EVERY WORD, SHE TURNED IT ON, AND EACH SEND IS HERS.
//
// This build applies that same relaxation to instructions, and NO FURTHER. An
// instruction defaults to "draft it and I'll send". She may flip ONE
// instruction to "send it and tell me", which is her signing that instruction
// once, the way she turns a sequence on once — and the agent then sends under
// her name with her instruction quoted in the log.
//
// MONEY NEVER GETS THAT FLIP. There is no configuration, no plan, no
// instruction text and no authorization level under which this module lets a
// model decide a dollar. That is not a policy in a prompt; it is the absence of
// a tool, asserted by the suite on the tool table itself.
//
// Pure: no DB, no network, no clock, no JSX.

// ── THE TWO KINDS OF INSTRUCTION ───────────────────────────────────────────
export const KIND_TASK = "task";          // once: "draft a note to everyone who…"
export const KIND_STANDING = "standing";  // ongoing: "when a first-time donor gives…"
export const KINDS = [KIND_TASK, KIND_STANDING];

// ── THE TWO AUTHORIZATION LEVELS ───────────────────────────────────────────
// `AUTH_DRAFT` is the default on every instruction, always. `AUTH_SEND` is the
// flip she makes per instruction — her signature, once, on that instruction.
export const AUTH_DRAFT = "draft";
export const AUTH_SEND = "send";
export const AUTHORIZATIONS = [AUTH_DRAFT, AUTH_SEND];

export const STATUS_PLANNED = "planned";  // a plan exists, she has not confirmed
export const STATUS_ACTIVE = "active";    // confirmed; a task runs once, a standing one keeps running
export const STATUS_PAUSED = "paused";
export const STATUS_DONE = "done";
export const STATUSES = [STATUS_PLANNED, STATUS_ACTIVE, STATUS_PAUSED, STATUS_DONE];

// ── THE TOOLS, WHICH ARE A CLOSED SET ──────────────────────────────────────
// The model gets the instruction, the organisation's vocabulary, and the rows
// Steward selected. It returns a plan and drafts in a strict schema. It calls
// THESE functions and nothing else — no SQL, no HTTP, no shell, no route.
//
// `needsHuman` is the whole safety model, in one column:
//   · "never"      — the agent does it on its own. Logged, reversible, visible.
//   · "signature"  — leaves the building. Needs AUTH_SEND on the instruction,
//                    or it becomes a draft in her queue.
//   · "always"     — touches money. There is no authorization level that
//                    permits it. It is here so the REFUSAL has a name.
export const AGENT_TOOLS = [
  // ── READ ─────────────────────────────────────────────────────────────────
  { name: "find_people", needsHuman: "never", writes: false,
    what: "Find donors and people in this organisation by their own giving, dates, stage, fund, tags or type.",
    why: "Reading is the whole point. Every row it can reach belongs to this organisation." },
  { name: "count", needsHuman: "never", writes: false,
    what: "Count or total the rows a find returned.",
    why: "Arithmetic over rows it already has." },

  // ── WRITE, ON ITS OWN ────────────────────────────────────────────────────
  // Each of these is logged with the agent as actor and her instruction as the
  // reason, is undoable for thirty days, and appears on one Activity screen.
  { name: "draft_note", needsHuman: "never", writes: true, undoable: true,
    entity: "agent_drafts",
    what: "Write a draft in the organisation's own words and put it in her queue.",
    why: "A draft is not a send. It sits in her queue until she presses send." },
  { name: "create_task", needsHuman: "never", writes: true, undoable: true,
    entity: "tasks",
    what: "Create a task for somebody here.",
    why: "A task is work for a person in this office, not a message to a donor." },
  { name: "open_thread", needsHuman: "never", writes: true, undoable: true,
    entity: "threads",
    what: "Open a follow-up thread on a donor with a next step and a date.",
    why: "A thread is a commitment this office makes to itself." },
  { name: "log_note", needsHuman: "never", writes: true, undoable: true,
    entity: "interactions",
    what: "Log a note on a donor's record.",
    why: "A note on a record reaches nobody outside this office." },
  { name: "set_stage", needsHuman: "never", writes: true, undoable: true,
    entity: "donors",
    what: "Move a donor to a different pipeline stage.",
    why: "A stage is this office's own view of where a relationship stands, and the previous stage is kept so it can be put back." },
  { name: "add_tag", needsHuman: "never", writes: true, undoable: true,
    entity: "donors",
    what: "Add a tag to a donor.",
    why: "A tag is a label this office uses on its own records." },
  // FIX-3 B — a person becoming a volunteer. The role is BUILD-94's
  // person_types on the ONE record; the note is the coordinator's own
  // (volunteer_notes), which never reaches the giving record or a draft.
  { name: "mark_volunteer", needsHuman: "never", writes: true, undoable: true,
    entity: "donors",
    what: "Give somebody the Volunteer role on their own record.",
    why: "A role is this office's own label on one person record, and the roles it had before are kept so they can be put back." },
  { name: "note_volunteer", needsHuman: "never", writes: true, undoable: true,
    entity: "volunteer_notes",
    what: "Write an internal note in the Volunteers hub, such as when somebody can help.",
    why: "A volunteer note stays with the coordinator: it never appears on the giving record, in Drift, or in anything drafted." },
  // ── AGENT-2 · REAL ACTIONS ───────────────────────────────────────────────
  // Each one is the route a person's click calls (agentCall.js), checked after
  // it runs, logged with the Agent as actor and undoable for thirty days.
  { name: "update_contact", needsHuman: "never", writes: true, undoable: true, entity: "donors",
    what: "Change somebody's email, phone or address (only the fields given; the rest stay).",
    why: "How this office reaches somebody, on their one record; the old values are kept so it can be put back." },
  { name: "set_owner", needsHuman: "never", writes: true, undoable: true, entity: "donors",
    what: "Make a staff member (ownerUserId, from STAFF) the owner of somebody.",
    why: "Who in this office looks after a relationship." },
  { name: "add_to_group", needsHuman: "never", writes: true, undoable: true, entity: "group_members",
    what: "Add somebody to a group kept by hand (groupId, from GROUPS).",
    why: "A group is a list this office keeps." },
  { name: "remove_from_group", needsHuman: "never", writes: true, undoable: true, entity: "group_members",
    what: "Take somebody out of a group kept by hand (groupId, from GROUPS).",
    why: "A group is a list this office keeps." },
  { name: "add_to_household", needsHuman: "never", writes: true, undoable: true, entity: "donors",
    what: "Put somebody in a household (householdId, from HOUSEHOLDS).",
    why: "A household links records; it never moves a gift." },
  { name: "log_conversation", needsHuman: "never", writes: true, undoable: true, entity: "interactions",
    what: "Log a call, meeting or email that already happened (kind: call, meeting or email; date YYYY-MM-DD; note says what was said). It updates last contact everywhere.",
    why: "A record of a conversation a person in this office had." },
  { name: "set_next_step", needsHuman: "never", writes: true, undoable: true, entity: "threads",
    what: "Set somebody's next step (label) with a due date (due, YYYY-MM-DD). It replaces the open one if there is one.",
    why: "A commitment this office makes to itself." },
  { name: "make_volunteer", needsHuman: "never", writes: true, undoable: true, entity: "volunteer_applications",
    what: "Make somebody a volunteer on their own record, with hoursPerWeek, availability (from DAYS) and roles. Use it for anyone who becomes or is a volunteer.",
    why: "The volunteer record on one person; it puts them in the Volunteers group." },
  { name: "sign_up_shift", needsHuman: "never", writes: true, undoable: true, entity: "volunteer_signups",
    what: "Sign somebody up for a shift (slotId, and roleId when the shift has roles, from SHIFTS).",
    why: "A place on a shift; capacity and the waiting list are decided as on the schedule." },
  { name: "log_hours", needsHuman: "never", writes: true, undoable: true, entity: "volunteer_shifts",
    what: "Log volunteer hours somebody already gave (hours, date YYYY-MM-DD, opportunityId from SHIFTS when named).",
    why: "Hours given, on their record." },
  { name: "start_journey", needsHuman: "never", writes: true, undoable: true, entity: "cultivation_plans",
    what: "Start a journey (journeyId, from JOURNEYS) for somebody.",
    why: "A journey drafts and reminds; it sends nothing on its own." },
  { name: "stop_journey", needsHuman: "never", writes: true, undoable: true, entity: "cultivation_plans",
    what: "Stop the journey somebody is in (journeyId, from JOURNEYS).",
    why: "Taking somebody out of a plan this office made." },
  { name: "register_event", needsHuman: "never", writes: true, undoable: true, entity: "event_attendees",
    what: "Register somebody for a free event, or put them on its guest list (eventId, from EVENTS). Never a paid ticket.",
    why: "A name on a guest list; no money moves." },
  { name: "mark_gift_thanked", needsHuman: "never", writes: true, undoable: true, entity: "gifts",
    what: "Mark a gift as thanked (giftId, from GIFTS). It records nothing new about the money.",
    why: "Whether the thank-you happened is this office's own note on a gift." },
  { name: "propose_merge", needsHuman: "never", writes: true, undoable: true, entity: "merge_proposals",
    what: "Propose that two records are one person (donorId and otherDonorId). A person merges them in Data health.",
    why: "A proposal in the duplicate queue; nothing is merged by the Agent." },
  { name: "prepare_gift", needsHuman: "never", writes: false,
    what: "Prepare a gift she told you about (donorId, amount in dollars, date, method) as one card she records with one click. Never recorded by you.",
    why: "Becomes a gift card the person confirms; the Agent itself records nothing." },
  { name: "enrol_sequence", needsHuman: "never", writes: true, undoable: true,
    entity: "sequence_enrollments",
    what: "Enrol somebody in a sequence SHE wrote and SHE turned on.",
    why: "BUILD-94's rule already holds here: she wrote every word and she turned it on. Enrolment does not add a word she did not write." },

  // ── WRITE, ONLY WITH HER SIGNATURE ───────────────────────────────────────
  { name: "queue_for_send", needsHuman: "never", writes: true, undoable: true,
    entity: "agent_drafts",
    what: "Put a finished message in her send queue.",
    why: "Still a draft. The queue is where she reads it." },
  { name: "send_email", needsHuman: "signature", writes: true, undoable: false,
    entity: "agent_drafts",
    what: "Send a message to a donor.",
    why: "It leaves the building and cannot be taken back. Needs her signature on the instruction, and every send quotes that instruction in the log." },

  // ── NEVER ────────────────────────────────────────────────────────────────
  // These exist so the refusal has a NAME. There is no code path that executes
  // one, and the suite asserts every one of them has no executor at all.
  { name: "record_gift", needsHuman: "always", writes: true, undoable: false,
    what: "Record money as received.",
    why: "A model never decides that money arrived." },
  { name: "refund", needsHuman: "always", writes: true, undoable: false,
    what: "Refund a gift.",
    why: "Moving money back to somebody is a decision a person makes with a reason." },
  { name: "create_pledge", needsHuman: "always", writes: true, undoable: false,
    what: "Create or change a pledge.",
    why: "A pledge is a commitment somebody made. Nobody may invent one on their behalf." },
  { name: "change_subscription", needsHuman: "always", writes: true, undoable: false,
    what: "Change, pause or cancel a recurring gift.",
    why: "It is the donor's money and the donor's decision; BUILD-57 already makes a staff-side change an INVITATION the donor completes." },
  { name: "issue_receipt", needsHuman: "always", writes: true, undoable: false,
    what: "Issue a tax receipt.",
    why: "A receipt is a legal acknowledgment of a specific gift. It is issued by the money path that saw the money." },
];

export const TOOLS_BY_NAME = Object.fromEntries(AGENT_TOOLS.map(t => [t.name, t]));
export const TOOL_NAMES = AGENT_TOOLS.map(t => t.name);

// The tools that may appear in a plan at all. A money tool is never planned —
// it is refused at the instruction, before a plan exists.
export const PLANNABLE = AGENT_TOOLS.filter(t => t.needsHuman !== "always").map(t => t.name);
export const MONEY_TOOLS = AGENT_TOOLS.filter(t => t.needsHuman === "always").map(t => t.name);
export const UNDOABLE = AGENT_TOOLS.filter(t => t.undoable).map(t => t.name);

// ── THE REFUSAL, WHICH IS A SENTENCE AND NOT A ROUTE ───────────────────────
// "Refund Margaret" is refused with the reason, never quietly turned into a
// task for somebody else to do — a silent reroute teaches her the instruction
// worked, and she finds out it did not when Margaret rings up.
export const MONEY_PATTERNS = [
  // The verbs, however they are conjugated.
  /\brefund(s|ed|ing)?\b/,
  /\brecharg(e|es|ed|ing)\b/,
  /\bcharg(e|es|ed|ing)\b.{0,24}\b(card|again|them|her|him|it)\b/,
  /\bwrite[- ]off\b/,
  /\b(adjust|change|correct|fix)\b.{0,20}\b(amount|total|figure)\b/,
  // The nouns that ARE money, with anything at all between the verb and them.
  /\bpledge(s|d)?\b/,
  /\breceipt(s)?\b/,
  /\binvoice(s|d)?\b/,
  /\bsubscription(s)?\b/,
  /\b(monthly|recurring|sustain(er|ing))\b.{0,16}\b(gift|gifts|giving|donation|donations|payment|payments)\b/,
  /\b(cancel|pause|stop|resume|restart)\b.{0,24}\b(monthly|recurring|subscription|sustainer)\b/,
  // FIX-1: RECORDING a gift she tells it about is no longer refused here. It
  // is PREPARED for a person to confirm (preparedGiftFromInstruction below),
  // and the person who presses confirm records it through recordGift. The
  // agent itself still never records money: there is no record_gift executor.
];

// Kept as words too, because the refusal names WHAT it matched and a regex
// source is not a thing to show somebody.
export const MONEY_WORDS = MONEY_PATTERNS.map(r => r.source);

export function moneyRefusal(instructionText) {
  const t = String(instructionText || "").toLowerCase();
  const re = MONEY_PATTERNS.find(r => r.test(t));
  if (!re) return null;
  const hit = (t.match(re) || [""])[0].trim();
  return {
    refused: true,
    matched: hit,
    // ONE sentence, naming what it will not do and what it will.
    sentence: "Steward will not do that. Anything that moves money — a refund, a charge, " +
      "a pledge, a receipt, a recurring gift — is yours to do, not something to instruct. " +
      "Steward can find the people and draft what to say; the money itself stays with you.",
  };
}

// ── THE PLAN ───────────────────────────────────────────────────────────────
// Every instruction produces a plan she reads BEFORE anything runs.
//
// FIX-1 (the walk, 25 September): told "Just got a gift from the Sunrise
// Foundation, 5,000 dollars", the plan's headline said it would record the gift
// and open a follow-up. The run recorded no gift, opened no thread, and did two
// other things. The headline was free text the model wrote BEFORE any step
// existed, and the run asked the model a second time for different actions.
//
// So the model no longer writes a headline at all. It returns STEPS, each one a
// concrete action on a named row with the rows it came from, and Steward
// COMPILES the headline from those steps (compilePlan below). The run then
// executes exactly the steps the plan showed and nothing else: no second model
// call, no new actions.
export const PLAN_STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "donorId", "citesRows", "subject", "body", "title", "note", "stage", "tag", "label", "due", "dueDays", "priority",
    "email", "phone", "address", "city", "state", "zip", "ownerUserId", "groupId", "householdId", "otherDonorId", "kind", "date",
    "hoursPerWeek", "hours", "availability", "roles", "slotId", "roleId", "opportunityId", "journeyId", "eventId", "giftId", "amount", "method"],
  properties: {
    tool: { type: "string", description: "One of Steward's own tools." },
    donorId: { type: ["string", "null"], description: "The id of the person this step is about, from the rows given." },
    citesRows: { type: "array", items: { type: "string" }, description: "The ids of the rows this step came from." },
    subject: { type: ["string", "null"] }, body: { type: ["string", "null"] },
    title: { type: ["string", "null"] }, note: { type: ["string", "null"] },
    stage: { type: ["string", "null"] }, tag: { type: ["string", "null"] },
    label: { type: ["string", "null"] }, due: { type: ["string", "null"] },
    // PARITY-1 Part F: a task's due date as whole days from today; Steward
    // resolves it to a civil date in the org's calendar.
    dueDays: { type: ["integer", "null"] },
    priority: { type: ["string", "null"] },
    // AGENT-2: what the real actions need. Every id comes from the lists in
    // the prompt. Plain types, because a strict schema allows only 16
    // nullable fields: "" or 0 or [] when the step does not use it.
    email: { type: "string" }, phone: { type: "string" },
    address: { type: "string", description: "The street line only." },
    city: { type: "string" }, state: { type: "string" }, zip: { type: "string" },
    ownerUserId: { type: "string" }, groupId: { type: "string" },
    householdId: { type: "string" }, otherDonorId: { type: "string" },
    kind: { type: "string", description: "call, meeting or email, for log_conversation." },
    date: { type: "string", description: "YYYY-MM-DD." },
    hoursPerWeek: { type: "number" }, hours: { type: "number" },
    availability: { type: "array", items: { type: "string" } },
    roles: { type: "array", items: { type: "string" } },
    slotId: { type: "string" }, roleId: { type: "string" },
    opportunityId: { type: "string" }, journeyId: { type: "string" },
    eventId: { type: "string" }, giftId: { type: "string" },
    amount: { type: "number" }, method: { type: "string" },
  },
};
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps", "sends", "headline", "cannot"],
  properties: {
    steps: { type: "array", description: "Every action Steward will take, one per person, in order.", items: PLAN_STEP_SCHEMA },
    headline: { type: "string", description: "One short sentence saying what the plan does, like \"Make Ada a volunteer at 15 hours a week and draft a welcome\". No more than 90 characters." },
    cannot: { type: "string", description: "If part of her instruction has no tool, say so in one sentence (\"Steward can't schedule shifts by text yet\"). Empty when everything is covered." },
    sends: { type: "integer", description: "How many messages leave the building. Zero unless she has signed this instruction." },
  },
};
// A plan larger than this is not a plan a person reads before saying yes.
export const MAX_PLAN_STEPS = 200;

// A plan is REFUSED, not trimmed, when it names a tool that is not hers to
// call. Trimming would run a plan she did not read.
export function validatePlan(plan, { authorization = AUTH_DRAFT } = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object") return { ok: false, errors: ["no plan"] };
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (!steps.length) errors.push("a plan with no steps does nothing");
  if (steps.length > MAX_PLAN_STEPS) errors.push(`a plan of ${steps.length} steps is too long to read before saying yes`);
  for (const s of steps) {
    const tool = TOOLS_BY_NAME[s && s.tool];
    if (!tool) { errors.push(`unknown tool: ${s && s.tool}`); continue; }
    // A money step is never PLANNED BY THE MODEL. The one exception is a gift
    // Steward prepared itself from her words (preparedGiftFromInstruction): it
    // waits for a person to confirm, and that person records it.
    if (tool.needsHuman === "always" && !(s.state === STEP_CONFIRM && s.preparedBy === "steward"))
      errors.push(`${s.tool} moves money and is never planned`);
    if (tool.needsHuman === "signature" && authorization !== AUTH_SEND)
      errors.push(`${s.tool} leaves the building and this instruction is not signed for sending`);
    if (!s.describes || String(s.describes).trim().length < 4)
      errors.push(`${s.tool} does not say what it does`);
  }
  const sends = Number(plan.sends) || 0;
  if (sends > 0 && authorization !== AUTH_SEND)
    errors.push("the plan sends, and this instruction is not signed for sending");
  if (!plan.summary || String(plan.summary).trim().length < 10)
    errors.push("a plan a person cannot read is not a plan");
  return { ok: errors.length === 0, errors };
}

// ── THE STEP STATES ────────────────────────────────────────────────────────
//   runs     — Steward does it when she says yes.
//   confirm  — Steward may not do it alone (it records money). It is PREPARED
//              and waits for a person to press confirm, who is then the actor.
//   waits    — runs after the step it depends on (a gift's thank-you follow-up
//              waits for the gift to exist).
export const STEP_RUNS = "runs";
export const STEP_CONFIRM = "confirm";
export const STEP_WAITS = "waits";

// Outcomes, per step, after a run: what the Plans view shows beside each one.
export const OUTCOME_DONE = "done";
export const OUTCOME_WAITING = "waiting";      // waiting for you
export const OUTCOME_NOT_DONE = "not_done";    // not done, with a reason
// AGENT-2: the step ran and its result is not there when Steward looks. Never Done.
export const OUTCOME_FAILED = "failed";

const money = cents => {
  const d = Math.round(Number(cents) || 0) / 100;
  return "$" + d.toLocaleString("en-US", Number.isInteger(d) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// How a person is named inside a sentence: an organisation takes "the" ("the
// Sunrise Foundation"), a person does not.
export function nameInSentence(p) {
  if (!p || !p.name) return "someone";
  const n = String(p.name).trim();
  if (p.kind === "organisation" && !/^the\s/i.test(n)) return "the " + n;
  return n;
}

function whoList(ids, byId) {
  const names = [...new Set(ids)].map(id => nameInSentence(byId.get(id)));
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return `${names.length} people`;
}

// FIX-3 B — THE HEADLINE IS ONE SHORT SENTENCE. The walk's headline ran every
// step into one sentence ("Steward will log a note…, tag…, create a task…, open
// a follow-up… and then draft a note…"). Now each kind of step is ONE short
// clause, a person is named once (in the first clause about them), at most
// three clauses are said, and the steps list under it carries the detail.
// `nameIt` is false once the clause's people have been named.
function clauseFor(tool, group, byId, nameIt) {
  const ids = [...new Set(group.map(s => s.donorId).filter(Boolean))];
  const who = ids.length ? whoList(ids, byId) : null;
  const w = nameIt ? who : null;
  const n = group.length;
  const s0 = group[0] || {};
  switch (tool) {
    case "record_gift": return n === 1 ? `record a ${money(s0.amountCents)} gift${w ? ` from ${w}` : ""}` : `record ${n} gifts once you confirm each one`;
    case "open_thread": return n === 1 ? `open a follow-up${w ? ` with ${w}` : ""}` : (w ? `open follow-ups with ${w}` : `open ${n} follow-ups`);
    case "draft_note":
      if (s0.purpose === "welcome" && n === 1) return `draft a welcome${w ? ` to ${w}` : ""}`;
      return n === 1 ? `draft a note${w ? ` to ${w}` : ""}` : (w ? `draft notes to ${w}` : `draft ${n} notes`);
    case "create_task": return n === 1 ? `create a task${w ? ` about ${w}` : ""}` : `create ${n} tasks`;
    case "log_note": return n === 1 ? (w ? `log a note on ${w}'s record` : "log a note") : (w ? `log notes on ${w}` : `log ${n} notes`);
    case "set_stage": return n === 1 ? `move ${who || "them"} to ${s0.stage || "a new stage"}` : `move ${w || "them"} to a new stage`;
    case "add_tag": return w ? `tag ${w} "${s0.tag || ""}"` : `add the tag "${s0.tag || ""}"`;
    case "enrol_sequence": return `enrol ${w || "them"} in a sequence you wrote`;
    case "queue_for_send": return `put ${n === 1 ? "a message" : n + " messages"} in your send queue`;
    case "send_email": return `send ${n === 1 ? "a message" : n + " messages"} you signed for`;
    case "mark_volunteer": return n === 1 ? `make ${who || "them"} a volunteer` : `make ${who || n + " people"} volunteers`;
    case "make_volunteer": return n === 1 ? `make ${who || "them"} a volunteer${s0.hoursPerWeek ? ` at ${s0.hoursPerWeek} hours a week` : ""}` : `make ${who || n + " people"} volunteers`;
    case "update_contact": return `update ${w ? w + "'s" : "the"} contact details`;
    case "set_owner": return `make ${s0.ownerName || "a colleague"} ${w ? w + "'s" : "the"} owner`;
    case "add_to_group": return `add ${who || n + " people"} to ${s0.groupName || "the group"}`;
    case "remove_from_group": return `take ${who || n + " people"} out of ${s0.groupName || "the group"}`;
    case "add_to_household": return `put ${who || "them"} in ${s0.householdName || "the household"}`;
    case "log_conversation": return `log ${n === 1 ? `a ${s0.kind || "conversation"}` : n + " conversations"}${w ? ` with ${w}` : ""}`;
    case "set_next_step": return `set ${w ? w + "'s" : "the"} next step`;
    case "sign_up_shift": return `sign ${who || "them"} up for ${s0.shiftName || "the shift"}`;
    case "log_hours": return `log ${s0.hours || ""} hours for ${who || "them"}`.replace("log  hours", "log hours");
    case "start_journey": return `start ${s0.journeyName || "the journey"} for ${who || n + " people"}`;
    case "stop_journey": return `stop ${s0.journeyName || "the journey"} for ${who || n + " people"}`;
    case "register_event": return `register ${who || n + " people"} for ${s0.eventName || "the event"}`;
    case "mark_gift_thanked": return `mark ${n === 1 ? "the gift" : n + " gifts"} thanked`;
    case "propose_merge": return `propose merging two records called ${(byId.get(s0.donorId) || {}).name || "the same name"}`;
    case "note_volunteer": return n === 1 ? `note ${w ? w + "'s " : ""}${s0.availability || "availability"}` : `note ${n} volunteers' availability`;
    default: return `${tool} (${n})`;
  }
}

// What one step does, in one clause, for the list under the headline.
export function describeStep(step, byId = new Map()) {
  const p = byId.get(step.donorId);
  const who = nameInSentence(p);
  switch (step.tool) {
    case "record_gift": return `Record a gift of ${money(step.amountCents)} from ${p ? who : "a giver you name"}`;
    case "open_thread": return step.label
      ? `Open a follow-up: ${String(step.label).charAt(0).toLowerCase()}${String(step.label).slice(1)}`
      : `Open a follow-up with ${who}`;
    case "draft_note": return step.purpose === "welcome"
      ? `Draft a welcome to ${who}, for you to read and send.`
      : `Draft a note to ${who}${step.subject ? ` ("${step.subject}")` : ""}.`;
    // A title that already names the person (a task per gift) is not prefixed twice.
    case "create_task": return `Create a task${p && !(step.title && p.name && String(step.title).includes(p.name)) ? ` about ${who}` : ""}${step.title ? `: ${step.title}` : ""}.`;
    case "log_note": return `Log a note on ${who}'s record.`;
    case "set_stage": return `Move ${who} to ${step.stage || "a new stage"}.`;
    case "add_tag": return `Tag ${who} "${step.tag || ""}".`;
    case "enrol_sequence": return `Enrol ${who} in a sequence you wrote.`;
    case "queue_for_send": return `Put a message to ${who} in your send queue.`;
    case "send_email": return `Send a message to ${who}.`;
    case "mark_volunteer": return `Tag ${who} Volunteer, on the same record.`;
    case "make_volunteer": return `Make ${who} a volunteer${step.hoursPerWeek ? `, ${step.hoursPerWeek} hours a week` : ""}${(step.availability || []).length ? `, ${step.availability.join(", ")}` : ""}${(step.roles || []).length ? `, as ${step.roles.join(", ")}` : ""}.`;
    case "update_contact": return `Change ${who}'s ${[step.email && `email to ${step.email}`, step.phone && `phone to ${step.phone}`, (step.address || step.city || step.zip) && `address to ${[step.address, step.city, step.state, step.zip].filter(Boolean).join(", ")}`].filter(Boolean).join(" and ") || "contact details"}.`;
    case "set_owner": return `Make ${step.ownerName || "a colleague"} ${who}'s owner.`;
    case "add_to_group": return `Add ${who} to ${step.groupName || "the group"}.`;
    case "remove_from_group": return `Take ${who} out of ${step.groupName || "the group"}.`;
    case "add_to_household": return `Put ${who} in ${step.householdName || "the household"}.`;
    case "log_conversation": return `Log a ${step.kind || "conversation"} with ${who} on ${step.date || "today"}${step.note ? `: ${String(step.note).slice(0, 120)}` : ""}.`;
    case "set_next_step": return `Set ${who}'s next step: ${step.label || "a follow-up"}${step.due ? `, due ${step.due}` : ""}.`;
    case "sign_up_shift": return `Sign ${who} up for ${step.shiftName || "the shift"}.`;
    case "log_hours": return `Log ${step.hours || "the"} hours for ${who}${step.date ? ` on ${step.date}` : ""}.`;
    case "start_journey": return `Start ${step.journeyName || "the journey"} for ${who}.`;
    case "stop_journey": return `Stop ${step.journeyName || "the journey"} for ${who}.`;
    case "register_event": return `Register ${who} for ${step.eventName || "the event"}.`;
    case "mark_gift_thanked": return `Mark ${who}'s gift${step.giftWords ? ` (${step.giftWords})` : ""} thanked.`;
    case "propose_merge": return `Propose that ${who} and ${nameInSentence(byId.get(step.otherDonorId))} are one person, for you to merge in Data health.`;
    case "note_volunteer": return `Note ${who}'s availability in Volunteers: ${step.availability || "as you said"}.`;
    default: return `${step.tool}.`;
  }
}

// The longest headline a person reads at a glance; past it, names give way to
// counts, then the tail folds into "and N more steps".
export const HEADLINE_MAX = 100;
function joinClauses(cs) {
  if (cs.length === 1) return cs[0];
  if (cs.length === 2) return `${cs[0]} and ${cs[1]}`;
  return `${cs.slice(0, -1).join(", ")}, and ${cs[cs.length - 1]}`;
}
function headline(order, groups, byId, { names = true } = {}) {
  const named = new Set();
  const clauses = order.map(t => {
    const g = groups.get(t);
    const key = [...new Set(g.map(s => s.donorId).filter(Boolean))].sort().join("|");
    const nameIt = names && !!key && !named.has(key);
    if (key) named.add(key);
    return clauseFor(t, g, byId, nameIt);
  });
  const said = clauses.length > 3
    ? [...clauses.slice(0, 2), `take ${clauses.length - 2} more steps`]
    : clauses;
  const s = joinClauses(said);
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

// compilePlan(steps, { people, reads, withheld })
// The headline is BUILT FROM THE STEPS. A plan with no gift step cannot say it
// records a gift; a plan with no thread step cannot say it opens a follow-up,
// because there is no clause to say it with. What was left out is counted on
// the plan (`withheld`) and said on its own line, never in the headline.
export function compilePlan(steps, { people = [], reads = null, withheld = 0, headline: said = null, cannot = null } = {}) {
  const byId = new Map((people || []).map(p => [p.id, p]));
  const out = (Array.isArray(steps) ? steps : []).map(s => {
    const tool = TOOLS_BY_NAME[s.tool];
    const state = tool && tool.needsHuman === "always" ? STEP_CONFIRM : (s.after ? STEP_WAITS : STEP_RUNS);
    return { ...s, state, describes: describeStep(s, byId) };
  });
  const order = [];
  const groups = new Map();
  for (const s of out) {
    if (!groups.has(s.tool)) { groups.set(s.tool, []); order.push(s.tool); }
    groups.get(s.tool).push(s);
  }
  let summary;
  if (!order.length) summary = "Steward found nothing to do for this instruction.";
  else {
    summary = headline(order, groups, byId);
    if (summary.length > HEADLINE_MAX) summary = headline(order, groups, byId, { names: false });
  }
  // AGENT-2: the model's one short sentence, when it gave one that fits; the
  // steps under it carry the detail. Never a headline for a plan with no steps.
  const h = String(said || "").trim().replace(/\s+/g, " ").replace(/[.!]*$/, "");
  if (order.length && h.length >= 8 && h.length <= 90 && !/\u2014/.test(h)) summary = h.charAt(0).toUpperCase() + h.slice(1) + ".";
  const cant = String(cannot || "").trim().replace(/\s+/g, " ").slice(0, 200);
  const people_ = new Set(out.map(s => s.donorId).filter(Boolean));
  return {
    steps: out,
    summary,
    reads: reads || null,
    expectedCount: people_.size,
    sends: out.filter(s => s.tool === "send_email").length,
    confirms: out.filter(s => s.state === STEP_CONFIRM).length,
    withheld,
    cannot: cant ? (cant.endsWith(".") ? cant : cant + ".") : null,
  };
}

// ── READS ARE SCOPED TO WHAT THE INSTRUCTION NAMES ──────────────────────────
// "The run said 'read 400 people' for an instruction about one named
// organisation." An instruction that names somebody reads that somebody.
// Matching is by WHOLE TOKENS (shared/textMatch.js's rule, re-stated here so
// this module stays dependency-free): "Ann Lee" is not inside "Joann Leewood".
const tok = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim().split(" ").filter(Boolean);
// A name that is one ordinary word ("Bob") would match any instruction that
// says "bob"; a PERSON's whole name is two tokens. An organisation may be one
// word ("Acme") but it has to be a real word, not "a" or "the".
const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "inc", "llc", "co",
  "at", "by", "or", "as", "is", "be", "we", "us", "me", "he", "it", "so", "do", "go", "no", "up", "my", "our", "her", "his"]);

// FIX-3 B — A FIRST NAME NAMES SOMEBODY. The walk typed "ada just became a
// volunteer…": one lower-case first name. The rule above needed a person's
// whole name, so "ada" named nobody and the plan read all 398 people. The
// class is a person called by their first name, in any case: that names every
// record whose first name it is (one → that record; several → Steward asks
// which, before planning). Three guards keep a first name from naming the
// wrong people:
//   · whole tokens only ("Adam" is not "Ada");
//   · a first name that is also an ordinary word ("will", "grace", "mark")
//     names somebody only when she wrote it as a name, capitalised;
//   · a first name followed by a capitalised word that is not this person's
//     surname ("Ada Smith" when the record is Ada Lovelace) is somebody else.
// A token inside a whole name she wrote ("Ada Lovelace") belongs to that name
// and does not also call up every other Ada.
const WORD_NAMES = new Set([
  "will", "may", "june", "april", "august", "grace", "hope", "joy", "faith", "mark", "bill", "sue", "pat", "art",
  "rose", "dawn", "summer", "rich", "frank", "jack", "ray", "sky", "chase", "hunter", "don", "guy", "iris", "ivy",
  "lily", "max", "jean", "norm", "rob", "sandy", "penny", "ruby", "jade", "amber", "crystal", "destiny", "honor",
  "honour", "justice", "king", "lane", "page", "reed", "sunny", "star", "storm", "violet", "wade", "carol", "robin",
  "glen", "dean", "drew", "earl", "grant", "heath", "holly", "jay", "buck", "cliff", "clay", "dale", "dash", "gale",
  "hazel", "heather", "jewel", "lark", "laurel", "olive", "pearl", "poppy", "rain", "river", "sage", "sterling",
  "stone", "constance", "prudence", "patience", "mercy", "felicity", "harmony", "melody", "liberty", "bonnie",
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "person", "people", "donor",
  "donors", "member", "members", "friend", "friends", "volunteer", "volunteers", "staff", "board", "new", "just",
  "young", "little", "major", "general", "bishop", "pastor", "doctor", "dr", "mr", "mrs", "ms", "miss", "sir",
  "dame", "father", "mother", "sister", "brother", "uncle", "aunt", "family", "trust", "foundation", "church",
  "fund", "team", "group", "office", "gift", "gifts", "note", "notes", "thank", "thanks", "call", "email", "text",
  "anonymous", "unknown", "guest", "test", "sample", "happy", "early", "late", "last", "first", "next", "best",
]);
const rawTok = s => String(s ?? "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const capitalised = w => /^[A-Z]/.test(w || "");
function runsAt(H, N) {
  const at = [];
  if (!N.length || N.length > H.length) return at;
  for (let i = 0; i + N.length <= H.length; i++) {
    let hit = true;
    for (let j = 0; j < N.length; j++) if (H[i + j] !== N[j]) { hit = false; break; }
    if (hit) at.push(i);
  }
  return at;
}
const nameTokens = p => { const all = tok(p && p.name); return all.filter(t => !(t === "the" && all[0] === "the")); };

// → { ids, ambiguous: [{ said, ids }], groups: [{ said, ids }] }. A group is one
// name as she said it; it is ambiguous when it names more than one record.
export function namedIn(text, people = []) {
  const R = rawTok(text), H = R.map(w => w.toLowerCase());
  const none = { ids: [], ambiguous: [], groups: [] };
  if (!H.length) return none;
  const full = [];
  for (const p of people || []) {
    const N = nameTokens(p);
    if (!N.filter(t => !STOP.has(t)).length) continue;
    const isOrg = p.kind === "organisation";
    if (!isOrg && N.length < 2) continue;
    if (isOrg && N.length === 1 && N[0].length < 4) continue;
    const at = runsAt(H, N);
    if (at.length) full.push({ id: p.id, N, len: N.length, at });
  }
  // Keep the longest: "Sunrise Foundation Trust" beats "Sunrise Foundation"
  // when the instruction says the longer one.
  const kept = full.filter(h => !full.some(o => o !== h && o.len > h.len && runsAt(o.N, h.N).length));
  const covered = new Set();
  const groups = new Map();
  const add = (key, said, id) => { if (!groups.has(key)) groups.set(key, { said, ids: [] }); const g = groups.get(key); if (!g.ids.includes(id)) g.ids.push(id); };
  for (const h of kept) {
    for (const i of h.at) for (let j = 0; j < h.len; j++) covered.add(i + j);
    add("full:" + h.N.join(" "), R.slice(h.at[0], h.at[0] + h.len).join(" "), h.id);
  }
  for (const p of people || []) {
    if (!p || p.kind === "organisation") continue;
    const N = nameTokens(p);
    if (N.length < 2) continue;
    const F = N[0];
    if (F.length < 2 || STOP.has(F) || /^\d+$/.test(F)) continue;
    for (let i = 0; i < H.length; i++) {
      if (H[i] !== F || covered.has(i)) continue;
      if (WORD_NAMES.has(F) && !capitalised(R[i])) continue;
      if (i + 1 < H.length && capitalised(R[i + 1]) && H[i + 1] !== N[1] && !WORD_NAMES.has(H[i + 1])) continue;
      add("first:" + F, F.charAt(0).toUpperCase() + F.slice(1), p.id);
    }
  }
  const list = [...groups.values()];
  const ids = [...new Set(list.flatMap(g => g.ids))];
  return { ids, ambiguous: list.filter(g => g.ids.length > 1), groups: list };
}

export function scopeFromInstruction(text, people = []) {
  const { ids } = namedIn(text, people);
  return ids.length ? ids : null;
}

// The words of an instruction a first name could be, for the one query that
// fetches the candidate records (routes/agent.js agentNamedIn).
export function nameWords(text) {
  return [...new Set(tok(text).filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)))].slice(0, 60);
}

// ── A GIFT SHE TELLS IT ABOUT IS PREPARED, NEVER RECORDED ──────────────────
// "Just got a gift from the Sunrise Foundation, 5,000 dollars" is not an
// instruction to refuse — it is news she wants on the record. The agent may
// not decide that money arrived, so it PREPARES the gift: amount and giver
// parsed here, deterministically (never by the model), and a person confirms.
// News, not a segment: "just got a gift from X" reports money that arrived;
// "draft a note to everyone who gave $100" names a group of people and is an
// ordinary instruction. Both halves are needed, or the second would be
// mistaken for the first.
const GIFT_NEWS = [
  /\b(got|received|came in|arrived|dropped off|turned up)\b/,
  /\b(mailed|sent|gave|donated|wired|paid)\s+(us|in)\b/,
  /\b(record|log|enter|add|post)\b.{0,24}\b(gift|donation|cheque|check|payment)\b/,
  /\b(a|an|another)\s+\$?[\d,.]+\s*(k|thousand|dollars?)?\s*(gift|donation|cheque|check)\s+from\b/,
];
const SEGMENT = /\b(everyone|everybody|anyone|all|each|every|who gave|who have|who has|donors who|people who)\b/;
const AMOUNT_RES = [
  /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|thousand)?\b/i,
  /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|thousand)?\s*(dollars|bucks|usd)\b/i,
];
export function parseAmountCents(text) {
  const t = String(text || "");
  for (const re of AMOUNT_RES) {
    const m = t.match(re);
    if (!m) continue;
    let dollars = Number(m[1].replace(/,/g, ""));
    const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    if (m[3]) dollars *= 1000;
    const total = dollars * 100 + (m[3] ? 0 : cents);
    if (Number.isFinite(total) && total > 0) return total;
  }
  return null;
}
export function isGiftNews(text) {
  const t = String(text || "").toLowerCase();
  return GIFT_NEWS.some(re => re.test(t)) && !SEGMENT.test(t);
}
export function preparedGiftFromInstruction(text, people = []) {
  const t = String(text || "");
  if (!isGiftNews(t)) return null;
  const amountCents = parseAmountCents(t);
  if (!amountCents) return null;
  const scope = scopeFromInstruction(t, people);
  const donorId = scope && scope.length === 1 ? scope[0] : null;
  const p = donorId ? (people || []).find(x => x.id === donorId) : null;
  return { tool: "record_gift", amountCents, donorId, donorName: p ? p.name : null,
           ambiguous: !!(scope && scope.length > 1) };
}

// How it was paid, when her words say so; null when they do not, and the
// gift then says "Needs you" (recordGift's honest unknown), never a guess.
export function methodFromInstruction(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(cheque|check)\b/.test(t)) return "check";
  if (/\bcash\b/.test(t)) return "cash";
  if (/\b(wire|wired|bank transfer|transfer|ach)\b/.test(t)) return "bank transfer";
  if (/\b(card|credit card|debit card)\b/.test(t)) return "card";
  return null;
}

// ── WHAT A STEP SAYS BESIDE IT─────────────────────────────────────────────
// Before the run: its STATE. After the run: its OUTCOME. One wording, here, so
// the Plans view, the sheet and the queue cannot say it three ways.
export function stateLabel(state) {
  if (state === STEP_CONFIRM) return "Prepared for you to confirm";
  if (state === STEP_WAITS) return "After you confirm";
  return "Runs when you say yes";
}
export function outcomeLabel(step) {
  if (!step || !step.outcome) return stateLabel(step && step.state);
  if (step.outcome === OUTCOME_DONE) return "Done";
  if (step.outcome === OUTCOME_WAITING) return "Waiting for you";
  if (step.outcome === OUTCOME_FAILED) return "Failed" + (step.reason ? ": " + step.reason : "");
  return "Not done" + (step.reason ? ": " + step.reason : "");
}
// The one yes. When the plan holds money she is recording it, and the button
// says the amount, because "Do it" over a gift hides what she is signing.
export function confirmLabel(plan) {
  const gift = ((plan && plan.steps) || []).find(s => s.state === STEP_CONFIRM && s.tool === "record_gift");
  return gift ? `Record ${money(gift.amountCents)} and run` : "Run the plan";
}
// Whole dollars as "$5,000", cents only when there are some: the agent's one
// money format, so a plan, a step and a button never disagree.
export function formatCents(cents) { return money(cents); }

// ── THE RUN STATE IS THE SERVER'S ──────────────────────────────────────────
// The button reads THIS, off the server's row. A run with a finish time is not
// running, whatever status string it carries and whatever the client believed.
export function runIsLive(run) {
  if (!run) return false;
  if (run.finished_at || run.finishedAt) return false;
  return run.status === "running";
}

// ── A DRAFT THAT CANNOT CITE A ROW IS NOT PRODUCED ─────────────────────────
// Every draft and every action carries the rows it came from. A draft with no
// citation is WITHHELD and COUNTED — the count is shown, because "Steward
// produced 28 of 31" with nothing said about the other three is the product
// hiding its own uncertainty.
export function citationProblems(item, { knownRowIds = [] } = {}) {
  const problems = [];
  const cites = Array.isArray(item && item.citesRows) ? item.citesRows : [];
  if (!cites.length) problems.push("cites no row");
  const known = new Set(knownRowIds.map(String));
  // A citation to a row that was never handed over is worse than none: it is a
  // reference that looks checkable and is not.
  const invented = cites.map(String).filter(id => !known.has(id));
  if (invented.length) problems.push(`cites rows Steward never read: ${invented.slice(0, 3).join(", ")}`);
  return problems;
}

export function withheldSentence(withheld, produced) {
  if (!withheld) return "";
  return `${withheld} of ${withheld + produced} withheld — Steward could not point at the rows ` +
    `${withheld === 1 ? "that draft" : "those drafts"} came from, so ${withheld === 1 ? "it was" : "they were"} not written.`;
}

// ── STANDING INSTRUCTIONS FIRE ON THE TICK, NEVER RETROACTIVELY ────────────
// BUILD-94's enrolment rule, applied to instructions: the only way in is the
// event itself. A standing instruction turned on today does not reach back over
// last year — and the screen SAYS SO with the count it would have caught, so
// she can decide to do those by hand rather than find the gap in March.
export const TRIGGERS = [
  { key: "first_gift", label: "When someone gives for the first time" },
  { key: "gift_received", label: "When any gift arrives" },
  { key: "recurring_failed", label: "When a monthly gift fails" },
  { key: "donor_drifting", label: "When a donor goes quiet past their own pattern" },
  { key: "weekly", label: "Every week" },
  { key: "monthly", label: "Every month" },
];
export const TRIGGER_KEYS = TRIGGERS.map(t => t.key);

// A standing instruction shows its plan the first time, and again any time the
// shape of the result changes by more than half — because an instruction that
// quietly starts touching three times as many people is a different
// instruction.
export const RESHOW_PLAN_RATIO = 0.5;
export function planNeedsReshowing(lastCount, thisCount) {
  const a = Number(lastCount), b = Number(thisCount);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (a === 0) return b > 0;
  return Math.abs(b - a) / a > RESHOW_PLAN_RATIO;
}

// ── THE DAILY LINE ─────────────────────────────────────────────────────────
// One sentence in the morning email and on Home. It follows the morning
// sentence's rules (shared/homeNote.js): never a template with holes, and a
// clause only when there is something to put in it.
//
// FIX-3 (finding 3) — a ZERO CLAUSE IS A HOLE. "Steward did 0 things for you
// yesterday, sent 0, 1 draft waiting." said two nothings to reach the one fact
// she can act on. Each clause appears only when its count is above zero, the
// verb agrees with the count, and all zeros say nothing at all:
//   waiting only        "1 draft is waiting for you."
//   did (and sent)      "Steward did 14 things for you yesterday and sent 2 messages."
//   did and waiting     "Steward did 14 things for you yesterday, and 6 drafts are waiting for you."
export function dailyLine({ did = 0, sent = 0, waiting = 0 } = {}) {
  const n = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  did = n(did); sent = n(sent); waiting = n(waiting);
  if (!did && !sent && !waiting) return "";
  const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  let done = "";
  if (did) done = `Steward did ${plural(did, "thing")} for you yesterday` + (sent ? ` and sent ${plural(sent, "message")}` : "");
  else if (sent) done = `Steward sent ${plural(sent, "message")} for you yesterday`;
  const wait = waiting ? `${plural(waiting, "draft")} ${waiting === 1 ? "is" : "are"} waiting for you` : "";
  if (done && wait) return `${done}, and ${wait}.`;
  return `${done || wait}.`;
}

// The undo window, in one place.
export const UNDO_DAYS = 30;
// How long a prompt and its response are kept, per org.
export const PROMPT_RETENTION_DAYS = 30;

// ── FIX-2 D · A READ NEEDS NO DRAFTING ─────────────────────────────────────
// Opening a report, finding a person, counting and explaining a number touch
// no donor and move no money, so they need no model and no drafting switch.
// The 27 September walk typed "build a report for my donors that gave last
// year but not this year" and was told drafting was off. These are routed
// HERE, deterministically: no model is needed to send "last year but not this
// year" to LYBUNT. A read writes nothing (the route inserts no instruction).
//
// A sentence that asks Steward to DO something to people (draft, send, email,
// call, tag, thank…) is never a read, even when it names the LYBUNT people:
// "draft a note to everyone who gave last year but not this year" is a plan.
const DO_WORDS = /\b(draft|drafts|write|send|sends|email|e-mail|mail|call|phone|text|thank|thanks|note|notes|letter|letters|tag|assign|remind|follow[- ]?up|record|log|enter|add|task|tasks|delete|remove|merge|update|change|pause|cancel|refund|enrol|enroll|invite|schedule)\b/;
const READ_START = /^\s*(please\s+)?(find|show|list|who|whom|which|what|how many|how much|open|build|create|make|give me|pull|run|get|see|report|count|explain|where)\b/;
// Each report the room can open, by the id Reports already deep-links
// (navigateTo("reports", { report })), with its name and the one sentence that
// defines it. The saved-report id is the everyday copy in Your reports.
export const READ_REPORTS = [
  { report: "lybunt", name: "LYBUNT", savedReport: "std:lybunt",
    test: t => /\blybunt\b/.test(t) || /\blast (fiscal )?year\b[^.?!]{0,60}\b(not|n't|never|no)\b[^.?!]{0,40}\bthis (fiscal )?year\b/.test(t),
    sentence: "LYBUNT is everyone who gave last year and has not yet given this year: the people to ask first." },
  { report: "sybunt", name: "SYBUNT", savedReport: "std:sybunt",
    test: t => /\bsybunt\b/.test(t) || /\b(some|an|any) (earlier|previous|past|prior) year\b[^.?!]{0,60}\bnot\b[^.?!]{0,40}\bthis year\b/.test(t),
    sentence: "SYBUNT is everyone who gave in some earlier year, but not last year and not yet this year." },
  { report: "retention", name: "Retention", savedReport: "std:retention",
    test: t => /\bretention\b|\bretained\b|\bgave again\b/.test(t),
    sentence: "Retention is the share of one year's donors who gave again the next year." },
  { report: "top-donors", name: "Top Donors", savedReport: "std:top-50",
    test: t => /\btop (\d+ )?(donors|givers|supporters)\b|\bbiggest (donors|givers)\b|\b(gave|given|give) the most\b/.test(t),
    sentence: "Top Donors lists the people who gave the most in the period, largest first." },
  { report: "giving-summary", name: "Giving Summary", savedReport: null,
    test: t => /\bgiving summary\b|\bhow much\b[^.?!]{0,30}\brais(e|ed)\b/.test(t),
    sentence: "The Giving Summary is every gift in the period: how much, how many, and from how many people." },
  { report: "three-year", name: "3-Year Comparison", savedReport: null,
    test: t => /\b(three|3)[- ]year\b/.test(t),
    sentence: "The 3-Year Comparison sets this year's giving beside the two years before it." },
  { report: "annual", name: "Annual Report", savedReport: null,
    test: t => /\bannual report\b/.test(t),
    sentence: "The Annual Report is the year's giving, as a board reads it." },
  { report: "by-group", name: "Gifts by Fund", savedReport: "std:by-fund",
    test: t => /\bgifts by fund\b|\bby (fund|designation)\b/.test(t),
    sentence: "Gifts by Fund is the period's giving, split by the fund each gift was given to." },
];
const EXPLAIN = /^\s*(please\s+)?(what('s| is| are| does| do)|explain|define|meaning of)\b/;

// → null (not a read), or { kind: "report"|"count"|"explain"|"find", … }.
export function readIntent(text) {
  const t = String(text || "").toLowerCase().replace(/[’']/g, "'").trim();
  if (!t || DO_WORDS.test(t) || isGiftNews(t)) return null;
  const rep = READ_REPORTS.find(r => r.test(t)) || null;
  const pick = r => ({ report: r.report, name: r.name, savedReport: r.savedReport, sentence: r.sentence });
  if (rep && EXPLAIN.test(t) && /\b(mean|means|meaning|explain|define|is|are)\b/.test(t) && !/\bwho\b/.test(t))
    return { kind: "explain", ...pick(rep) };
  if (rep && /\bhow many\b|\bcount\b|\bnumber of\b/.test(t)) return { kind: "count", ...pick(rep) };
  if (rep) return { kind: "report", ...pick(rep) };
  if (/^\s*(please\s+)?(find|show( me)?|open|look up|pull up|where is|go to)\b/.test(t)) return { kind: "find" };
  return null;
}
// A sentence that reads like a question but that Steward cannot route without
// a model ("which donors live near the river"). Used only to word the answer
// when drafting is off; it never decides what runs.
export function looksLikeRead(text) {
  const t = String(text || "").toLowerCase();
  return !DO_WORDS.test(t) && READ_START.test(t);
}

// ── FIX-3 B · SOMEBODY BECAME A VOLUNTEER ──────────────────────────────────
// "ada just became a volunteer and wants to do 15 hours a week" is news about
// one person, like a gift she tells it about, and it is recognised HERE, by
// Steward, never by a model: the model may be absent (it is, locally, and on a
// server without a key) and the plan must still fit. The walk's plan was a
// donor note, a task "Confirm which Ada", a follow-up and a draft. The right
// plan is three steps on her one record:
//   (a) the Volunteer role (person_types — one record, never a second one);
//   (b) her availability as a volunteer INTERNAL note (volunteer_notes, which
//       never reaches the giving record, Drift or a draft);
//   (c) one welcome, as a DRAFT she reads and sends herself.
const VOL_NEWS = [
  /\b(became|become|becomes|becoming|is now|now|has become|joined|joins|joining|signed up|signs up|signing up|started|starts|starting|agreed|agrees|wants|want|would like|will be|is going|offered|offers|is keen)\b[^.?!]{0,40}\bvolunteer(s|ing)?\b/,
  /\b(make|mark|tag|add|set)\b[^.?!]{0,40}\bas (a |an |our )?(new )?volunteer\b/,
  /\bnew volunteer\b/,
];
// A question about volunteers is a read, not news about one of them.
const VOL_ASKS = /^\s*(please\s+)?(find|show|list|who|whom|which|what|how many|how much|count)\b/;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40 };
const HOURS_RE = /\b(\d{1,3}(?:\.\d{1,2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty)\s*(?:hours?|hrs?)\b(?:\s+(?:a|an|per|each|every)\s+(week|month|day|fortnight))?/i;
const DAYS_RE = /\b((?:mon|tues|wednes|thurs|fri|satur|sun)days?|weekends?|weekdays?)(\s+(?:mornings?|afternoons?|evenings?))?\b/i;
export function volunteerNews(text) {
  const raw = String(text || "");
  const t = raw.toLowerCase().replace(/[’']/g, "'");
  if (!VOL_NEWS.some(re => re.test(t))) return null;
  if (SEGMENT.test(t) || VOL_ASKS.test(t)) return null;
  // AGENT-2: a shift or hours already given is work for the planner's tools.
  if (/\bshifts?\b|\blog(ged)?\b[^.]{0,20}\bhours?\b/.test(t)) return null;
  const parts = [];
  const h = raw.match(HOURS_RE);
  if (h) {
    const n = NUMBER_WORDS[h[1].toLowerCase()] || Number(h[1]);
    parts.push(`${n} ${n === 1 ? "hour" : "hours"}${h[2] ? ` a ${h[2].toLowerCase()}` : ""}`);
  }
  const d = raw.match(DAYS_RE);
  if (d) parts.push((d[1].charAt(0).toUpperCase() + d[1].slice(1).toLowerCase()) + (d[2] ? d[2].toLowerCase() : ""));
  // AGENT-2: the same words, as the volunteer record's fields.
  const hoursPerWeek = h && (!h[2] || /week/i.test(h[2])) ? (NUMBER_WORDS[h[1].toLowerCase()] || Number(h[1])) : null;
  const days = [];
  if (/saturdays?|weekends?/i.test(raw)) days.push("Saturdays");
  if (/sundays?|weekends?/i.test(raw)) days.push("Sundays");
  if (/weekday|(mon|tues|wednes|thurs|fri)days?/i.test(raw)) {
    if (/mornings?/i.test(raw)) days.push("Weekday mornings");
    if (/afternoons?/i.test(raw)) days.push("Weekday afternoons");
    if (/evenings?/i.test(raw)) days.push("Weekday evenings");
  }
  const role = raw.match(/\bas an? ([a-z][a-z -]{2,40}?)(?:[,.]|\s+(?:on|and|at|for)\b|$)/i);
  return { availability: parts.length ? parts.join(", ") : null, hoursPerWeek, days, roles: role ? [role[1].trim().replace(/^./, c => c.toUpperCase())] : [] };
}

const typesOf = p => {
  const v = p && p.person_types;
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || "null"); return Array.isArray(a) ? a : []; } catch { return []; }
};
// The steps, from the one record and her words. `welcome` is the draft's
// subject and body, written by shared/draftNote.js (her greeting and sign-off
// when she has taught Steward her voice).
export function volunteerSteps(person, news, { instruction = "", welcome = null } = {}) {
  if (!person || !person.id) return [];
  const cites = [person.id];
  const steps = [];
  // AGENT-2: the volunteer RECORD (makeVolunteer), not a tag and a note: the
  // role, hours a week, days and roles, and they are in the Volunteers group.
  const already = typesOf(person).includes("volunteer");
  const fields = news && (news.hoursPerWeek || (news.days || []).length || (news.roles || []).length);
  if (!already || fields)
    steps.push({ tool: "make_volunteer", donorId: person.id, citesRows: cites,
      hoursPerWeek: (news && news.hoursPerWeek) || null, availability: (news && news.days) || [], roles: (news && news.roles) || [],
      detail: "On the same record · in the Volunteers group" });
  if (welcome && !person.deceased && !person.do_not_contact && !person.is_sample)
    steps.push({ tool: "draft_note", donorId: person.id, citesRows: cites, purpose: "welcome",
      subject: welcome.subject, body: welcome.body, detail: "A draft under Waiting for you · you send it" });
  return steps;
}

// ── FIX-2 D · DRAFTING, AND WHO CAN TURN IT ON ─────────────────────────────
// One place states whether drafting is on, and when it is not, WHY, in the
// order the causes are true: Steward's missing key first (no organisation can
// fix that, so the room must not blame hers), then the organisation's own
// switch, then pause. When it is off the room says what it can still do, what
// drafting would add, and who may turn it on and where.
export const DRAFTING_WHERE = "Agent → Guardrails → Drafting";
export const DRAFTING_CAN_NOW = "Without drafting, Steward still opens and builds reports, finds people, counts, explains a number, and prepares a gift you tell it about for you to confirm.";
export const DRAFTING_ADDS = "Drafting adds plans that draft thank-yous, notes and follow-ups from your records, through Anthropic. Nothing is sent or recorded until you say so.";
// FIX-10 D — this sentence used to name the Railway variable. Nobody reading
// the Agent room can set it, and the room's own job is to say what still works.
export const KEY_MISSING_SENTENCE = "Drafting isn't available yet. We'll let you know when it is. Reports, finding people and gifts you tell it about still work.";
export function namesInSentence(names = []) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return n[0] || "";
  return n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
}
export function draftingState({ configured = false, enabled = true, paused = false, isAdmin = false, admins = [] } = {}) {
  const reason = !configured ? "ai_no_key" : enabled === false ? "ai_disabled" : paused ? "agent_paused" : null;
  const who = namesInSentence(admins);
  const whoCan = who ? `Only an admin can turn drafting on: ${who}.` : "Only an admin can turn drafting on.";
  const sentence = reason === "ai_no_key" ? KEY_MISSING_SENTENCE
    : reason === "ai_disabled" ? "AI is turned off for your organization."
    : reason === "agent_paused" ? "Steward is paused. Turn it back on in Guardrails."
    : "Drafting is on.";
  return { on: reason === null, reason, sentence, canNow: DRAFTING_CAN_NOW, adds: DRAFTING_ADDS,
           where: DRAFTING_WHERE, canTurnOn: reason === "ai_disabled" && !!isAdmin, whoCan };
}

// ── PARITY-1 Part F · A TASK FOR EVERY GIFT IN A WINDOW ────────────────────
// "Create thank-you calls for every gift this week, due in a week." The model
// used to see donor rows only (so "every gift" became "every donor"), had no
// today's date (so "this week" and "due in a week" were guesses, and `due` was
// free text) and saw the top 200 people by giving. This instruction shape is
// now read HERE, by Steward: the window is a civil range from the org's own
// today, the gifts are read from the database inside it, and the plan is one
// task per gift with a civil due date. The model is not asked to enumerate.
//
// Pure civil arithmetic on YYYY-MM-DD strings, pinned to UTC so it cannot move.
const civilParts = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || "")); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
export function civilAddDays(ymd, n) {
  const p = civilParts(ymd);
  if (!p) return null;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(n || 0))).toISOString().slice(0, 10);
}
const civilDow = ymd => { const p = civilParts(ymd); return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : null; };   // 0 Sunday
const NUM_WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, thirty: 30 };
const numOf = w => (w == null ? null : NUM_WORD[String(w).toLowerCase()] ?? (/^\d{1,3}$/.test(w) ? Number(w) : null));
const UNIT_DAYS = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 };

// The window of GIFT DATES an instruction names, from the org's today, or
// null. A week starts on Monday. "This week" is Monday to today.
export function giftWindowFromInstruction(text, today) {
  const t = String(text || "").toLowerCase().replace(/[’']/g, "'");
  if (!civilParts(today)) return null;
  const dow = civilDow(today);
  const monday = civilAddDays(today, -((dow + 6) % 7));
  const p = civilParts(today);
  const firstOfMonth = `${p[0]}-${String(p[1]).padStart(2, "0")}-01`;
  if (/\btoday\b/.test(t) && !/\bdue today\b/.test(t)) return { from: today, to: today, words: "today" };
  if (/\byesterday\b/.test(t)) { const y = civilAddDays(today, -1); return { from: y, to: y, words: "yesterday" }; }
  if (/\bthis week\b/.test(t)) return { from: monday, to: today, words: "this week" };
  if (/\blast week\b(?!s)/.test(t) && !/\bin the last week\b|\bover the last week\b/.test(t))
    return { from: civilAddDays(monday, -7), to: civilAddDays(monday, -1), words: "last week" };
  if (/\bthis month\b/.test(t)) return { from: firstOfMonth, to: today, words: "this month" };
  if (/\blast month\b/.test(t) && !/\b(in|over) the last month\b/.test(t)) {
    const prevLast = civilAddDays(firstOfMonth, -1);
    return { from: prevLast.slice(0, 8) + "01", to: prevLast, words: "last month" };
  }
  const m = t.match(/\b(?:in|over|during|from) the (?:last|past)\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty)?\s*(days?|weeks?|months?)\b/)
    || t.match(/\b(?:the )?(?:last|past)\s+(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty)\s+(days?|weeks?|months?)\b/);
  if (m) {
    const n = m[1] ? numOf(m[1]) : 1;
    if (n && n > 0 && n <= 400) {
      const days = n * UNIT_DAYS[m[2]];
      return { from: civilAddDays(today, -(days - 1)), to: today, words: `in the last ${n === 1 ? m[2].replace(/s$/, "") : `${n} ${m[2]}`}` };
    }
  }
  return null;
}

// "due in a week" → 7, "due in 3 days" → 3, "due tomorrow" → 1, "due today"
// → 0, "due next week" → 7, "due in two weeks" → 14. Null when it says none.
export function dueDaysFromInstruction(text) {
  const t = String(text || "").toLowerCase();
  if (/\bdue (by )?today\b/.test(t)) return 0;
  if (/\bdue (by )?tomorrow\b/.test(t)) return 1;
  if (/\bdue (by )?next week\b/.test(t)) return 7;
  const m = t.match(/\b(?:due|by|within)\s+(?:in\s+)?(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty)\s+(days?|weeks?|months?)\b/);
  if (!m) return null;
  const n = numOf(m[1]);
  return n == null ? null : Math.min(n * UNIT_DAYS[m[2]], 365);
}

// Is this the shape "a task (or call) for every gift in <window>"? Returns
// { window, dueDays, kind } or null. It must say EVERY/EACH/ALL gifts, a task
// word, and a window, and it must not be about drafting or sending.
const TASK_WORD = /\b(tasks?|calls?|call\b|phone|ring|to-?dos?|follow[- ]?ups?|reminders?)\b/;
const PER_GIFT = /\b(every|each|all( the| of the)?|any)\s+(new\s+|one-time\s+)?(gifts?|donations?)\b|\bfor (the )?(gifts?|donations?) (received|made|given|that came in)\b|\bper gift\b/;
const NOT_TASK = /\b(draft|write|email|e-mail|send|letter|note to|message)\b/;
export function giftTaskShape(text, today) {
  const t = String(text || "").toLowerCase().replace(/[’']/g, "'");
  if (!TASK_WORD.test(t) || !PER_GIFT.test(t) || NOT_TASK.test(t)) return null;
  const win = giftWindowFromInstruction(t, today);
  if (!win) return null;
  const kind = /\b(calls?|phone|ring)\b/.test(t) ? (/\bthank/.test(t) ? "Thank-you call" : "Call") : (/\bthank/.test(t) ? "Thank-you" : "Follow up");
  return { window: win, dueDays: dueDaysFromInstruction(t), kind };
}

// The title of one task: "Thank-you call: Ada Lovelace, $250.00 gift on Sep 30".
export function giftTaskTitle(kind, donorName, amountCents, dateShort) {
  return `${kind}: ${donorName}, ${money(amountCents)} gift on ${dateShort}`.slice(0, 300);
}

// A truncated model answer is not a shorter plan; it is a plan cut off at an
// arbitrary person. It is refused, never run in part.
export const TRUNCATED_SENTENCE = "That instruction made a plan too long for Steward to finish writing, so none of it will run. Narrow it (a shorter window, or a smaller group) and try again.";
