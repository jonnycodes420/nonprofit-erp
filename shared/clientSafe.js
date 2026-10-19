// shared/clientSafe.js · CLIENT-SAFE-1. PEOPLE WHO ARE NEVER BROUGHT IN, AND
// HEALTH DETAILS THAT ARE HELD BACK.
//
// An equine therapy center's riders' families can also be its donors, and an
// email about a rider's diagnosis is not something a donor CRM should hold.
// With the org's setting on:
//   · a person marked as a client is never fetched from Gmail or Outlook, never
//     logged from the BCC address, never a capture card and never a memo;
//   · every other email Steward keeps has its health sentences replaced with
//     one neutral line before it is stored;
//   · with AI off Steward cannot check, so new email keeps only its date, its
//     direction, who it was between and its subject.
// With the setting off nothing here runs, and capture is exactly as before.
//
// Steward is not HIPAA compliant and has no business associate agreements, so
// no sentence here, or anywhere this feeds, says otherwise.
//
// Pure: no DB, no network, no clock, no JSX.

import { sentences, sensitiveCategory } from "./voiceMemo.js";

export const SETTING_LABEL = "We serve clients whose details are private";
export const SETTING_DESCRIPTION =
  "Steward will never bring in email, documents or notes about people you mark as clients, and holds back health details it finds in anyone's email until you choose to keep them.";
export const FLAG_LABEL = "Client (never capture)";
export const HELD_LINE = "Mentioned a health matter. Open it in your mailbox.";
export const AI_OFF_SENTENCE =
  "Steward's AI is off, so it can't check email for health details. New email keeps only its date, who it was between and its subject.";
export const MEMO_REFUSED = name =>
  `${name || "This person"} is marked as a client, so Steward won't log a memo about them.`;
export const SUPPORT_ACTOR = "Steward support";

// ── THE HEALTH SCREEN ──────────────────────────────────────────────────────
// VOICE-1's personal-detail detector, its health half, plus the words an
// email about care uses that a spoken memo rarely does (medication, a dose, a
// therapist). An org whose WORK is therapy writes "our therapy program" in
// every thank-you, so the program's own words are taken out before the test:
// a sentence is held because it is about somebody's health, not because it
// names what the org does.
const MEDICAL = /\b(medicat\w*|medicine|meds|prescri\w+|dosage|doses?|mg\b|seizures?|epilep\w+|autis\w+|adhd|cerebral palsy|down syndrome|diabet\w+|asthma|injur\w+|concussion|physio\w*|therapist|counsel(?:l)?ing|psychiatr\w+|psycholog\w+|diagnos\w+|symptoms?|treatment|appointment with dr|doctor|neurolog\w+|occupational therapy|speech therapy|physical therapy|in therapy|(?:her|his|their|my|our) therapy)\b/i;
const PROGRAM_WORDS = /\b(?:equine|horse|riding|animal|hippo|art|music)[- ]?(?:assisted )?therap(?:y|ies|eutic)\b|\btherapeutic riding\b|\btherapy (?:program|programs|programme|center|centre|horses?|barn|arena|team|staff)\b|\bour therapy\b/gi;

export function healthIn(sentence) {
  const s = String(sentence || "").replace(PROGRAM_WORDS, " ");
  return sensitiveCategory(s) === "health" || MEDICAL.test(s);
}

/**
 * The text with every health sentence replaced by HELD_LINE (once, where the
 * first one was), and how many sentences were held. `extra` are quotes a
 * model flagged: a sentence containing one is held too, whatever the screen
 * thought. What was held is NOT returned: nothing downstream can store it.
 */
export function holdHealth(text, extra = []) {
  const quotes = (extra || []).map(q => String(q || "").trim().toLowerCase()).filter(q => q.length >= 3);
  const parts = sentences(text);
  let held = 0, placed = false;
  const out = [];
  for (const s of parts) {
    const low = s.toLowerCase();
    if (healthIn(s) || quotes.some(q => low.includes(q))) {
      held++;
      if (!placed) { out.push(HELD_LINE); placed = true; }
      continue;
    }
    out.push(s);
  }
  return { text: held ? out.join(" ") : String(text || ""), held };
}

// ── WHO IS A CLIENT ON A MESSAGE ───────────────────────────────────────────
const norm = e => String(e || "").trim().toLowerCase();
export function clientSet(emails) { return new Set((emails || []).map(norm).filter(Boolean)); }
/** Does any address on this message belong to a person marked as a client? */
export function involvesClient(addresses, clients) {
  if (!clients || !clients.size) return false;
  return (addresses || []).some(a => clients.has(norm(a)));
}

// ── THE MODEL'S HALF (AI on) ───────────────────────────────────────────────
// One short read per email: quote every sentence about a person's health.
// Strict tool, strings only (FIX-29's limits). A quote that is not in the
// email is ignored, and the screen above runs whatever the model said.
export const HEALTH_TOOL = {
  name: "health_details",
  description: "Quote every sentence in this email about a person's health, therapy, diagnosis or medication.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false, required: ["quotes"],
    properties: { quotes: { type: "array", items: { type: "string" } } },
  },
};
export const HEALTH_SYSTEM = [
  "You read one email a nonprofit's staff member sent or received, before it is filed on a donor's record.",
  "Quote, word for word, every sentence that says something about a specific person's health: an illness, an injury, a diagnosis, therapy they receive, a medication, a hospital stay, a disability or a mental health matter.",
  "Do not quote sentences that only name the organization's own programs or services. Quote nothing if there is nothing.",
].join("\n");

// ── WHAT THE CONNECTIONS CARD SAYS ─────────────────────────────────────────
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// The same sentence in pieces, so a screen can make each number open its list.
export function privacyLineParts({ clients = 0, heldThisMonth = 0 } = {}) {
  return [
    { text: "Privacy mode is on. " },
    { open: "clients", text: plural(clients, "person marked as a client", "people marked as clients") },
    { text: ` ${clients === 1 ? "is" : "are"} never brought in. ` },
    { open: "held", text: plural(heldThisMonth, "health detail", "health details") },
    { text: " held back this month." },
  ];
}
export function privacyLine(counts) {
  return privacyLineParts(counts).map(p => p.text).join("");
}

export default {
  SETTING_LABEL, SETTING_DESCRIPTION, FLAG_LABEL, HELD_LINE, AI_OFF_SENTENCE, MEMO_REFUSED, SUPPORT_ACTOR,
  healthIn, holdHealth, clientSet, involvesClient, HEALTH_TOOL, HEALTH_SYSTEM, privacyLine, privacyLineParts,
};
