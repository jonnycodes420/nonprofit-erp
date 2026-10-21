// shared/voiceTalk.js · VOICE-3. ONE PLACE TO TALK TO STEWARD.
//
// The floating mic takes three kinds of talk, and this file tells them apart
// (routes/voice.js POST /voice/talk acts on what it says; TellSteward.jsx is
// the screen):
//   LOG  what happened ("Lunch with Margaret, wants to give to the arena,
//        circle back in March"), filed by the memo path as before.
//   DO   something to do ("Remind me to call Tobias Friday"), planned by the
//        Agent and run only when she presses Confirm.
//   ASK  a question ("Who should I call tomorrow?"), answered by Ask.
// One memo can hold more than one ("Coffee with Margaret went great, remind
// me to send her the boat photos Friday"): each part goes its own way.
//
// Decided in code first (splitTalk). When the words carry no sign of which it
// is, one short model call decides (INTENT_TOOL); when that cannot help, the
// screen asks her: "Did you mean to log this, or have Steward do it?"
//
// Also here, kept from VOICE-2: whether this browser can listen at all.
// No audio ever reaches any of this: the browser hands the page text.

export const NO_LISTEN_LINE = "Your browser can't listen. Type it, or use your computer's dictation.";
export const NO_LISTEN_PHONE_LINE = "Use your keyboard's microphone to talk instead of typing.";
export const UNSURE_LINE = "Did you mean to log this, or have Steward do it?";

// THE DETECTION. `win` is the window (or a stand-in for one in a test).
// Chrome and Edge expose webkitSpeechRecognition; Safari on a Mac does too,
// and it works when Dictation is on (when it is off, the first start errors
// with "service-not-allowed" and the screen falls back to the text box, which
// the error handler in TellSteward.jsx does). Firefox has none.
export function listenMode(win) {
  const w = win || {};
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition || null;
  const phone = !!(w.matchMedia && w.matchMedia("(max-width: 768px)").matches);
  if (SR) return { mode: "speech", phone, line: null };
  return { mode: "text", phone, line: phone ? NO_LISTEN_PHONE_LINE : NO_LISTEN_LINE };
}
// These three mean the recognizer will not listen at all, so the screen falls
// back to typing; anything else ("no-speech", "network") is a pause.
export function errorStopsListening(code) {
  return code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture";
}

// ── WHICH KIND OF TALK ──────────────────────────────────────────────────────
// A question: it ends in "?", or opens with a question word (speech rarely
// brings the question mark with it).
const ASK_START = /^(who|whom|whose|what|what's|whats|when|where|which|why|how|tell me|show me|list|give me the|can you tell me|could you tell me)\b/i;
const ASK_AUX = /^(did|does|do|has|have|is|are|was|were|will|should)\b/i;   // a question only with its "?"
// Something to do: an instruction opens the clause.
const DO_START = /^(please\s+)?(remind me|remind|draft|write|send|email|e-mail|text|schedule|book|set up|create|make sure|make a|put|add|tag|plan|invite|thank|call|phone|ring|follow up with|assign|enrol|enroll|mark|move|cancel|change|update|record|can you|could you|would you)\b/i;
// Mid-sentence, only the unmistakable ones start a new part; "circle back in
// March" inside a memo stays part of what happened.
const DO_MID = /^(please\s+)?(remind me|remind|draft|send|email|schedule|book|add|put|invite|tag|plan|create|make sure|can you|could you)\b/i;
// What happened: a meeting word first, or the past tense.
const LOG_START = /^(lunch|coffee|breakfast|dinner|drinks|visit|tour|meeting|met|call with|phone call|talked|spoke|chatted|caught up|ran into|saw|had|just|great|good|quick)\b/i;
const LOG_WORD = /\b(went|had|met|spoke|said|told|gave|saw|got|was|were|loved|liked|wants|wanted|thinks|mentioned|asked|agreed|promised|is going to|brought|came|showed)\b|\b[a-z]{3,}ed\b/i;

const ADDRESS = /^(hey\s+|ok(ay)?\s+)?steward[,:]?\s+/i;
const tidy = s => String(s || "").replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "").trim();

function kindOf(piece) {
  const p = tidy(piece).replace(ADDRESS, "");
  if (!p) return null;
  if (/\?\s*$/.test(piece) || ASK_START.test(p) || (ASK_AUX.test(p) && /\?/.test(piece))) {
    // "Can you tell me ..." is a question; "Can you draft ..." is not.
    if (/^(can|could|would) you\b/i.test(p) && !/^(can|could) you tell me\b/i.test(p)) return "do";
    return "ask";
  }
  if (/^(phone )?call with\b/i.test(p)) return "log";   // "Call with Tobias went well" happened
  if (DO_START.test(p)) return "do";
  if (LOG_START.test(p) || LOG_WORD.test(p)) return "log";
  return null;
}

// SPLIT ONE MEMO INTO ITS PARTS. Returns { kind, log, do, ask } where kind is
// "log" | "do" | "ask" | "mixed" | null (null: the words alone do not say).
export function splitTalk(text) {
  const all = String(text || "").replace(/\s+/g, " ").trim().replace(ADDRESS, "");
  const pieces = [];
  for (const sentence of all.split(/(?<=[.!?;])\s+/)) {
    // Within a sentence, a new part starts only where an instruction or a
    // question starts after a comma, "and", "then", "also" or "so".
    const bits = sentence.split(/(,\s+|\s+(?:and|then|also|so|but)\s+)/i);
    let cur = bits[0];
    for (let i = 1; i < bits.length; i += 2) {
      const next = bits[i + 1] || "";
      const n = tidy(next);
      if (DO_MID.test(n) || ASK_START.test(n)) { pieces.push(cur); cur = next; }
      else cur += bits[i] + next;
    }
    pieces.push(cur);
  }
  const kinds = pieces.map(kindOf);
  // A piece with no sign of its own belongs with the one before it (or, the
  // first, with the one after).
  for (let i = 0; i < kinds.length; i++) if (!kinds[i]) kinds[i] = kinds[i - 1] || null;
  for (let i = kinds.length - 1; i >= 0; i--) if (!kinds[i]) kinds[i] = kinds[i + 1] || null;
  const out = { log: "", do: "", ask: "" };
  pieces.forEach((p, i) => {
    const k = kinds[i]; if (!k) return;
    const t = tidy(p).replace(ADDRESS, "");
    if (!t) return;
    const joined = out[k] ? out[k].replace(/[.!?]?$/, ".") + " " : "";
    out[k] = joined + t[0].toUpperCase() + t.slice(1);
  });
  for (const k of ["log", "do", "ask"]) if (out[k] && !/[.!?]$/.test(out[k])) out[k] += k === "ask" ? "?" : ".";
  const present = ["log", "do", "ask"].filter(k => out[k]);
  return { kind: present.length === 0 ? null : present.length === 1 ? present[0] : "mixed", ...out };
}

// "Remind me to send her the boat photos Friday", after a memo about Margaret
// Chen: the instruction names her, so the Agent plans it on her record.
export function namePronouns(text, name) {
  if (!name) return text;
  let done = false;
  return String(text || "").replace(/\b(her|him|them|she|he|they)\b/gi, m => { if (done) return m; done = true; return name; });
}

// ── THE FALLBACK: ONE SHORT CALL ─────────────────────────────────────────────
const S = { type: "string" };
export const INTENT_TOOL = {
  name: "talk_intent",
  description: "Split what a fundraiser said to Steward into what happened, what to do, and what she is asking. Copy her words; never add any.",
  strict: true,
  input_schema: { type: "object", additionalProperties: false, required: ["happened", "to_do", "question"], properties: {
    happened: { ...S, description: "Her words about something that already happened (a meeting, a call, news about a person), or \"\"." },
    to_do: { ...S, description: "Her words asking Steward to do something (a reminder, a draft, adding someone to a list), or \"\"." },
    question: { ...S, description: "Her words asking a question about her records, or \"\"." },
  } },
};
export const INTENT_SYSTEM = "A nonprofit fundraiser spoke to Steward, her donor database. Sort her words into what happened, what she wants done, and what she is asking. Copy her own words into each; leave a part \"\" when she said nothing of that kind. If you cannot tell, leave all three \"\". No em dashes.";

// The model's split, kept only where every part is her own words.
export function readIntent(raw, text) {
  const hay = String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  const own = s => { const w = String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(x => x.length > 2);
    return w.length > 0 && w.filter(x => hay.includes(x)).length / w.length >= 0.8; };
  const r = raw || {};
  const out = { log: own(r.happened) ? tidy(r.happened) : "", do: own(r.to_do) ? tidy(r.to_do) : "", ask: own(r.question) ? tidy(r.question) : "" };
  const present = ["log", "do", "ask"].filter(k => out[k]);
  return { kind: present.length === 0 ? null : present.length === 1 ? present[0] : "mixed", ...out };
}

export default { listenMode, errorStopsListening, NO_LISTEN_LINE, NO_LISTEN_PHONE_LINE, UNSURE_LINE, splitTalk, namePronouns, INTENT_TOOL, INTENT_SYSTEM, readIntent };
