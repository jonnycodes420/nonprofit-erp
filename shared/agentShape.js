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
  // Recording money is the model deciding that money arrived.
  /\b(record|log|post|enter|add)\b.{0,16}\b(a |the |her |his |their )?(gift|gifts|donation|donations|payment|payments)\b/,
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
// Every instruction produces a plan she reads BEFORE anything runs. The plan is
// the contract: what it will look at, how many it expects to touch, what it
// will do to each, and what will leave the building — which is "nothing" unless
// she has signed the instruction.
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reads", "expectedCount", "steps", "sends", "summary"],
  properties: {
    reads: { type: "string", description: "What Steward will look at, in plain words: 'your 412 donors'." },
    expectedCount: { type: "integer", description: "About how many people this will touch. An estimate, and labelled as one." },
    steps: {
      type: "array",
      description: "What Steward will do to each person, in order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "describes"],
        properties: {
          tool: { type: "string", description: "One of Steward's own tools." },
          describes: { type: "string", description: "What this step does, in one plain clause." },
        },
      },
    },
    sends: { type: "integer", description: "How many messages leave the building. Zero unless she has signed this instruction." },
    summary: { type: "string", description: "The whole plan in one sentence she can agree or disagree with." },
  },
};

// A plan is REFUSED, not trimmed, when it names a tool that is not hers to
// call. Trimming would run a plan she did not read.
export function validatePlan(plan, { authorization = AUTH_DRAFT } = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object") return { ok: false, errors: ["no plan"] };
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (!steps.length) errors.push("a plan with no steps does nothing");
  for (const s of steps) {
    const tool = TOOLS_BY_NAME[s && s.tool];
    if (!tool) { errors.push(`unknown tool: ${s && s.tool}`); continue; }
    if (tool.needsHuman === "always") errors.push(`${s.tool} moves money and is never planned`);
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
export function dailyLine({ did = 0, sent = 0, waiting = 0 } = {}) {
  if (!did && !sent && !waiting) return "";
  const parts = [`Steward did ${did} thing${did === 1 ? "" : "s"} for you yesterday`];
  parts.push(`sent ${sent}`);
  if (waiting) parts.push(`${waiting} draft${waiting === 1 ? "" : "s"} waiting`);
  return parts.join(", ") + ".";
}

// The undo window, in one place.
export const UNDO_DAYS = 30;
// How long a prompt and its response are kept, per org.
export const PROMPT_RETENTION_DAYS = 30;
