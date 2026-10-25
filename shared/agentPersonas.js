// shared/agentPersonas.js — AGENTS-1. SIX NAMES ON ONE ENGINE.
//
// The landing page has named six agents since GTM-1a: Steward Data,
// Researcher, Writer, Analyst, Recurring, Onboarding. There was one generic
// agent behind them and no way to pick. This file is the difference: six
// personas, each with its own words, its own subset of the one closed tool
// table, and its own suggested triggers, all of them running through the plan-
// then-confirm pipeline that already exists in routes/agent.js.
//
// WHAT A PERSONA IS NOT. It is not a second engine, a second safety model or a
// second set of tools. `tools` here is a SUBSET of what shared/agentShape.js
// already allows, and a subset can only ever narrow. Nothing in this file can
// widen what an agent may do: a persona naming a tool the engine does not have
// an executor for still gets nothing, and a persona naming a money tool is
// rejected by this file's own guard at load, not at run.
//
// ADDING THE SEVENTH. One entry below and nothing else. The routes read
// `getPersona`, the screens read `PERSONAS`, and neither knows any id by name.
//
// THE FALLBACK IS THE OLD BEHAVIOUR. An instruction with no persona — every
// instruction written before this build, and every one written from a screen
// that does not offer the choice — resolves to GENERAL: the full executable
// tool set and the generic prompt, which is exactly what the engine did
// before. `persona` being null in the database means precisely that.
//
// Pure: no DB, no network, no clock, no JSX.

// The executable tools, named here so a typo in a persona's list is a
// load-time failure rather than a step that silently never runs. This list is
// the EXECUTABLE half of shared/agentShape.js's table: every tool that has an
// executor and does not leave the building. It deliberately excludes
// send_email, queue_for_send and enrol_sequence (a persona never reaches a
// donor) and every money tool (nothing ever does).
import { HELP_SYSTEM } from "./helpSearch.js";   // HELP-1

export const PERSONA_TOOLS = [
  "find_people", "count",
  "draft_note", "create_task", "open_thread", "log_note",
  "set_stage", "add_tag", "mark_volunteer", "note_volunteer",
  // AGENT-2: real actions, each the route a person's click calls.
  "update_contact", "set_owner", "add_to_group", "remove_from_group", "add_to_household",
  "log_conversation", "set_next_step", "make_volunteer", "sign_up_shift", "log_hours",
  "start_journey", "stop_journey", "register_event", "mark_attended", "mark_gift_thanked", "propose_merge", "prepare_gift",
];

// Named so the guard below can say WHY, rather than just refusing.
export const PERSONA_FORBIDDEN_TOOLS = [
  "send_email", "queue_for_send", "enrol_sequence",
  "record_gift", "refund", "create_pledge", "change_subscription", "issue_receipt",
];

// The safety rules, restated for the model in each persona's own voice. Every
// persona repeats them, because a persona prompt REPLACES nothing: the engine's
// own system prompt still carries the hard rules and validatePlan still refuses
// a plan that breaks them. This paragraph exists so the model is not working
// against the grain of its own instructions.
const SAFETY = [
  "A draft is never a send: everything you write waits in her queue until she reads it and presses send.",
  "You never touch money. No gift, refund, pledge, receipt or recurring change, under any instruction, in any words.",
  "You never act on somebody the record says not to contact, and never on somebody who has died.",
].join(" ");

const P = (id, name, tagline, description, voice, tools, suggestedTriggers, guardrailNote) => ({
  id, name, tagline, description,
  systemPrompt: `${voice} ${SAFETY}`,
  tools, suggestedTriggers, guardrailNote,
});

export const PERSONAS = [
  P("data", "Steward Data",
    "Finds what is wrong in the file and tidies it.",
    "It looks for duplicate records, missing fields and tags nobody meant to keep, and does the tidy-up: it corrects an email, phone or address you give it, adds people to groups and households, and proposes merges for you to commit in Data health. It never writes to a donor, and never merges two people itself.",
    "You are the person who keeps a nonprofit's donor file clean. You look for duplicates, missing fields and tags that have drifted, and you make the tidy-up in plain words. You never merge two records on your own: you propose the merge, and a person commits it.",
    ["find_people", "count", "add_tag", "log_note", "draft_note", "create_task", "update_contact", "propose_merge", "add_to_group", "remove_from_group", "add_to_household"],
    ["weekly"],
    "It can correct contact details, group people and propose merges. It never merges two people itself, and never writes to a donor."),

  P("researcher", "Researcher",
    "Writes a brief on a donor, from your own records.",
    "It reads one person's giving, notes and history, and for major gifts staff the screening results and the public filing, and writes the one-page brief you would want before a meeting. Every line names its source; what none of them holds it says is not known. It looks nothing up on the open web, invents no number, saves the brief to their files and never sends it.",
    "You write prospect briefs for a fundraiser about to walk into a meeting. Everything you write comes from the rows in front of you and nowhere else. You never state a figure, a date or a fact that is not on a row you can point at, and you say plainly when something is not on file.",
    ["find_people", "count", "draft_note", "log_note", "create_task"],
    [],
    "Read-only on the donor record. It drafts a brief; it changes nothing."),

  P("writer", "Writer",
    "Drafts thank-yous, appeals and notes in your words.",
    "It writes the draft and stops. Nothing it writes is ever sent: every draft waits in your queue with the record it came from, and the send is yours.",
    "You draft donor correspondence in the organization's own voice: thank-yous, appeals, notes. You write the draft and you stop. You never send, never queue for sending, and never say anything a row does not support.",
    ["find_people", "count", "draft_note"],
    ["first_gift"],
    "Drafts only. It has no way to send, and no way to change a record."),

  P("analyst", "Analyst",
    "Answers questions about your giving.",
    "It counts, totals and compares what is already in Steward, and tells you the answer with the rows behind it. It writes nothing at all, to a record or to a donor.",
    "You answer questions about a nonprofit's own giving by reading and counting rows. You write nothing. Every answer names the rows it came from, and you say 'not on file' rather than estimate.",
    ["find_people", "count"],
    ["weekly"],
    "Read-only. It can never change a donor record."),

  P("recurring", "Recurring",
    "Watches failed cards, drift and the about-to-lapse.",
    "It notices a monthly gift that stopped, a card about to expire and a donor going quiet past their own pattern, and it opens the next step with the reason. It never changes a recurring gift: that is the donor's, and it stays theirs.",
    "You watch a nonprofit's recurring giving: failed cards, donors about to lapse, and people going quiet past their own pattern. You open a next step with the reason written out. You never change, pause or cancel a recurring gift, because it is the donor's money and the donor's decision.",
    ["find_people", "count", "create_task", "open_thread", "log_note", "draft_note", "set_next_step", "log_conversation"],
    ["donor_drifting", "weekly"],
    "It opens next steps. It can never change or cancel a recurring gift."),

  P("onboarding", "Onboarding",
    "Looks after somebody's first thirty days.",
    "When a new donor arrives it drafts the welcome, opens the follow-up and puts the next step on the thread, so a first gift is not the last one anybody thought about.",
    "You look after a donor's first thirty days. When somebody gives for the first time you draft the welcome in the organization's voice, open a follow-up thread with a date, and create the task that makes sure somebody picks it up. You draft; she sends.",
    ["find_people", "count", "draft_note", "create_task", "log_note", "open_thread", "start_journey", "stop_journey", "set_next_step", "mark_gift_thanked"],
    ["first_gift"],
    "It drafts, starts journeys and opens next steps. Every word waits in your queue: nothing ever goes straight to a donor."),
];

// THE FALLBACK, and the old behaviour exactly. Not in PERSONAS: it is not a
// card, it is what an instruction without one already was.
export const GENERAL = P("general", "Steward",
  "The agent, as it was.",
  "No persona chosen: the full set of things Steward can do on its own, and the same plan-then-confirm it always had.",
  "You are planning work inside a nonprofit's own CRM, for the person who runs it.",
  PERSONA_TOOLS,
  [],
  "Plan, then confirm. Every write is logged and undoable for thirty days.");

// HELP-1 — ASK STEWARD. The engine's help-only persona: NO tools, so it can
// plan nothing and call nothing, and a voice that answers only from the help
// articles shared/helpSearch.js puts in front of it. Not in PERSONAS, for the
// same reason as GENERAL: it is not a card anyone picks to plan work with.
export const HELP = P("help", "Ask Steward",
  "Answers how-to questions from the help center.",
  "Reads only the help articles and the question. It never sees your organization's data and never takes an action.",
  HELP_SYSTEM,
  [],
  [],
  "No tools. It reads help articles and writes an answer; nothing else.");

// FIX-12 Part 7b — AFTER THE MEETING. The engine reads her note for the chips
// the record has a place for. NO tools: it returns suggestions, and every chip
// must quote her own words (shared/meetingNote.js validateNoteChips refuses
// one that does not). Not in PERSONAS: it is not a card anyone plans with.
export const MEETING_NOTE = P("meeting_note", "After the meeting",
  "Reads a meeting note for a pledge, a gift, a fund and a next step.",
  "Reads only the note she typed, the names of the organization's funds and the open ask. It suggests chips; she confirms each one.",
  "You read a short note a fundraiser typed after meeting a donor, and pick out only what the note itself says: a pledge (an amount promised, and how many payments), a gift (an amount given), which of the listed funds it is for, and the next step she wrote down. For every item, quote the exact words from the note it comes from. If the note does not say it, leave it out. Never guess an amount, a fund or a step.",
  [],
  [],
  "No tools. Suggestions only; nothing is recorded until she presses save.");

// ONBOARD-1 — SET UP STEWARD FOR ME. The seventh persona, and like HELP it is
// not a card: it is reached from the Setup screen, never picked to plan
// free-form work, so it plans with NO engine tools. What it does instead is
// a fixed list of setup steps (setup.js STEPS), each one a call to the route
// a person's click already uses. That list is checked here, at load, against
// the same forbidden words as every persona: it may never send and never
// record money, and a step named here that setup.js does not run is a
// load-time failure in that module's suite.
export const SETUP_STEPS = ["read_site", "profile", "import", "funds", "groups", "templates", "journeys", "invites", "connections", "finish"];
export const SETUP = { ...P("setup", "Setup",
  "Sets Steward up from your files and your website.",
  "It reads your donor files and your website, shows you its plan, and after your one Start it imports and checks to the cent, fills in your profile and branding, creates your funds and starter groups, drafts thank-yous in your words and builds three journeys, all paused. Invitations and connections are prepared for your click.",
  "You set up a nonprofit's Steward from its own files and website. Every count, total and match is computed in code; you only phrase sentences. You never send, never turn a journey on and never record money a person has not seen.",
  [],
  [],
  "It never emails anybody, never turns a journey or receipt on, and every change it makes is undone by one button."),
  steps: SETUP_STEPS };
for (const s of SETUP.steps) {
  if (/send|refund|pledge|receipt|record_gift|subscription/.test(s))
    throw new Error(`agentPersonas: setup step ${s} names something no persona may ever do`);
}

export const PERSONA_IDS = PERSONAS.map(p => p.id);

export function isValidPersona(id) {
  return typeof id === "string" && PERSONA_IDS.includes(id);
}

// Unknown or missing resolves to GENERAL, so every instruction ever written
// keeps working and no caller has to special-case null.
export function getPersona(id) {
  return PERSONAS.find(p => p.id === id) || GENERAL;
}

// The tools a persona may plan with, as a Set for the plan-time filter.
export function personaToolSet(id) {
  return new Set(getPersona(id).tools);
}

// ── THE FILTER, AND IT IS THE WHOLE MECHANISM ──────────────────────────────
// A model asked to plan as the Analyst can still return a step that moves
// somebody's stage: a prompt is a request, not a wall. This is the wall, and
// it runs at PLAN time — before she reads the plan — not at confirm time.
// Dropping it later would mean she reads a plan saying the Analyst will retag
// forty people and then watches that step quietly not happen, which teaches
// her the plan is decoration.
//
// It is pure and it is here rather than in the route so it can be fed a
// model-shaped answer and checked directly.
export function dropOutOfScope(personaId, steps) {
  const allowed = personaToolSet(personaId);
  const kept = [], dropped = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s && s.tool && !allowed.has(s.tool)) dropped.push(s);
    else kept.push(s);
  }
  return { steps: kept, dropped, droppedCount: dropped.length };
}

// ── THE GUARD ON THIS FILE ITSELF ──────────────────────────────────────────
// Run at load, in every process that imports it, because a persona is data and
// a typo in data is a tool that silently never runs, or worse, a forbidden one
// that quietly appears in a list. Both are caught here, once, at boot.
import { TRIGGER_KEYS } from "./agentShape.js";

for (const p of [...PERSONAS, GENERAL]) {
  for (const k of p.suggestedTriggers) {
    if (!TRIGGER_KEYS.includes(k))
      throw new Error(`agentPersonas: "${p.id}" suggests trigger ${k}, which is not a trigger this product has`);
  }
  for (const t of p.tools) {
    if (PERSONA_FORBIDDEN_TOOLS.includes(t))
      throw new Error(`agentPersonas: "${p.id}" names ${t}, which no persona may ever have`);
    if (!PERSONA_TOOLS.includes(t))
      throw new Error(`agentPersonas: "${p.id}" names ${t}, which is not an executable tool`);
  }
}

export default { PERSONAS, GENERAL, SETUP, SETUP_STEPS, PERSONA_IDS, PERSONA_TOOLS, PERSONA_FORBIDDEN_TOOLS,
                 getPersona, isValidPersona, personaToolSet, dropOutOfScope };

// VOICE-1 — TELL STEWARD. The memo persona: she talks for thirty seconds after
// a donor lunch and the paperwork lands where it belongs. Like HELP and SETUP
// it is not a card anyone picks; it is reached from the Tell Steward button.
// Its tools are the record-keeping half of the engine and nothing that leaves
// the building: a draft waits in her queue, and money is a card she confirms
// (prepare_gift), never a write. Checked here by the same guard as the rest.
export const NOTES = P("notes", "Notes",
  "Turns what you tell it after a meeting into the record.",
  "It reads your memo and logs the conversation, puts the follow-up on the Thread with its date, notes what they are interested in and drafts the email. Money, contact changes and anything personal wait for your yes.",
  "You read a memo a fundraiser spoke straight after talking with a donor, and say what it records. You quote her words for every item. You never send, never record money, and never file a personal detail about health, family, money troubles or a child without her yes.",
  ["log_conversation", "set_next_step", "create_task", "log_note", "add_tag", "draft_note", "update_contact", "prepare_gift"],
  [],
  "It logs, schedules and drafts. Nothing is sent, and money and personal details wait for your yes.");
for (const t of NOTES.tools) {
  if (PERSONA_FORBIDDEN_TOOLS.includes(t) || !PERSONA_TOOLS.includes(t))
    throw new Error(`agentPersonas: "notes" names ${t}, which it may not have`);
}
