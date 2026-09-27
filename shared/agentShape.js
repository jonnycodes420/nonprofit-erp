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
  required: ["tool", "donorId", "citesRows", "subject", "body", "title", "note", "stage", "tag", "label", "due", "priority"],
  properties: {
    tool: { type: "string", description: "One of Steward's own tools." },
    donorId: { type: ["string", "null"], description: "The id of the person this step is about, from the rows given." },
    citesRows: { type: "array", items: { type: "string" }, description: "The ids of the rows this step came from." },
    subject: { type: ["string", "null"] }, body: { type: ["string", "null"] },
    title: { type: ["string", "null"] }, note: { type: ["string", "null"] },
    stage: { type: ["string", "null"] }, tag: { type: ["string", "null"] },
    label: { type: ["string", "null"] }, due: { type: ["string", "null"] },
    priority: { type: ["string", "null"] },
  },
};
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps", "sends"],
  properties: {
    steps: { type: "array", description: "Every action Steward will take, one per person, in order.", items: PLAN_STEP_SCHEMA },
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

// ONE clause per tool, written from the steps and nothing else.
function clauseFor(tool, group, byId) {
  const ids = group.map(s => s.donorId).filter(Boolean);
  const who = ids.length ? whoList(ids, byId) : null;
  const n = group.length;
  switch (tool) {
    case "record_gift": {
      if (n === 1) {
        const s = group[0];
        return `record a ${money(s.amountCents)} gift from ${who || "a giver you name"}`;
      }
      return `record ${n} gifts once you confirm each one`;
    }
    case "open_thread": return who ? `open a follow-up with ${who}` : `open ${n} follow-ups`;
    case "draft_note": return n === 1 ? `draft a note to ${who}` : `draft notes to ${who || n + " people"}`;
    case "create_task": return n === 1 ? (who ? `create a task about ${who}` : "create a task") : `create ${n} tasks`;
    case "log_note": return n === 1 ? `log a note on ${who}'s record` : `log notes on ${who || n + " records"}`;
    case "set_stage": return n === 1 ? `move ${who} to ${group[0].stage || "a new stage"}` : `move ${who || n + " people"} to a new stage`;
    case "add_tag": return n === 1 ? `tag ${who} "${group[0].tag || ""}"` : `tag ${who || n + " people"}`;
    case "enrol_sequence": return `enrol ${who || n + " people"} in a sequence you wrote`;
    case "queue_for_send": return `put ${n === 1 ? "a message" : n + " messages"} in your send queue`;
    case "send_email": return `send ${n === 1 ? "a message" : n + " messages"} you signed for`;
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
    case "draft_note": return `Draft a note to ${who}${step.subject ? ` ("${step.subject}")` : ""}.`;
    case "create_task": return `Create a task${p ? ` about ${who}` : ""}${step.title ? `: ${step.title}` : ""}.`;
    case "log_note": return `Log a note on ${who}'s record.`;
    case "set_stage": return `Move ${who} to ${step.stage || "a new stage"}.`;
    case "add_tag": return `Tag ${who} "${step.tag || ""}".`;
    case "enrol_sequence": return `Enrol ${who} in a sequence you wrote.`;
    case "queue_for_send": return `Put a message to ${who} in your send queue.`;
    case "send_email": return `Send a message to ${who}.`;
    default: return `${step.tool}.`;
  }
}

// compilePlan(steps, { people, reads, withheld })
// The headline is BUILT FROM THE STEPS. A plan with no gift step cannot say it
// records a gift; a plan with no thread step cannot say it opens a follow-up,
// because there is no clause to say it with.
export function compilePlan(steps, { people = [], reads = null, withheld = 0 } = {}) {
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
  const clauses = order.map(t => clauseFor(t, groups.get(t), byId));
  let summary;
  if (!clauses.length) summary = "Steward found nothing to do for this instruction.";
  else if (clauses.length === 1) summary = `Steward will ${clauses[0]}.`;
  else if (clauses.length === 2) summary = `Steward will ${clauses[0]}, then ${clauses[1]}.`;
  else summary = `Steward will ${clauses.slice(0, -1).join(", ")} and then ${clauses[clauses.length - 1]}.`;
  if (withheld) summary += ` ${withheld} ${withheld === 1 ? "step was" : "steps were"} left out because Steward could not point at the rows ${withheld === 1 ? "it" : "they"} came from.`;
  const people_ = new Set(out.map(s => s.donorId).filter(Boolean));
  return {
    steps: out,
    summary,
    reads: reads || null,
    expectedCount: people_.size,
    sends: out.filter(s => s.tool === "send_email").length,
    confirms: out.filter(s => s.state === STEP_CONFIRM).length,
    withheld,
  };
}

// ── READS ARE SCOPED TO WHAT THE INSTRUCTION NAMES ──────────────────────────
// "The run said 'read 400 people' for an instruction about one named
// organisation." An instruction that names somebody reads that somebody.
// Matching is by WHOLE TOKENS (shared/textMatch.js's rule, re-stated here so
// this module stays dependency-free): "Ann Lee" is not inside "Joann Leewood".
const tok = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim().split(" ").filter(Boolean);
function runAt(H, N) {
  if (!N.length || N.length > H.length) return false;
  for (let i = 0; i + N.length <= H.length; i++) {
    let hit = true;
    for (let j = 0; j < N.length; j++) if (H[i + j] !== N[j]) { hit = false; break; }
    if (hit) return true;
  }
  return false;
}
// A name that is one ordinary word ("Bob") would match any instruction that
// says "bob"; a PERSON needs two tokens to be named. An organisation may be one
// word ("Acme") but it has to be a real word, not "a" or "the".
const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "on", "inc", "llc", "co"]);
export function scopeFromInstruction(text, people = []) {
  const H = tok(text);
  if (!H.length) return null;
  const hits = [];
  for (const p of people || []) {
    const N = tok(p && p.name).filter(t => !(t === "the" && tok(p.name)[0] === "the"));
    const meaningful = N.filter(t => !STOP.has(t));
    if (!meaningful.length) continue;
    const isOrg = p.kind === "organisation";
    if (!isOrg && N.length < 2) continue;
    if (isOrg && N.length === 1 && N[0].length < 4) continue;
    if (runAt(H, N)) hits.push({ id: p.id, len: N.length, N });
  }
  if (!hits.length) return null;
  // Keep the longest: "Sunrise Foundation Trust" beats "Sunrise Foundation"
  // when the instruction says the longer one.
  const kept = hits.filter(h => !hits.some(o => o !== h && o.len > h.len && runAt(o.N, h.N)));
  return [...new Set(kept.map(h => h.id))];
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
