// shared/voiceMeeting.js · VOICE-2. LISTEN TO THE WHOLE MEETING, THEN FILE EVERYTHING.
//
// The pure half of meeting mode (routes/voice.js is the other half, and
// TellSteward.jsx the screen):
//   listenMode       whether this browser can listen, and the one line to say
//                    when it cannot. Detection, not vendors: a browser that
//                    has speech recognition listens, one that has none types.
//   stitch           the browser's recognizer stops on its own every so often;
//                    the page restarts it, and each new session's words are
//                    joined to what came before, once, so an hour comes
//                    through whole.
//   screenTranscript the transcript as kept: every sentence that trips the
//                    sensitive screen is replaced by one neutral line.
//   MEETING_TOOL     one short model call at Stop: who, what was discussed,
//                    what they care about, what was promised, next steps with
//                    her words for when. Its summary is then filed through the
//                    same memo path as a spoken memo (VOICE-1).
// No audio ever reaches any of this: the browser hands the page text.
import { sentences, sensitiveCategory, NEUTRAL } from "./voiceMemo.js";

export const CONSENT_LINE = "Let everyone know you're taking notes.";
export const ROOM_ONLY_LINE = "Steward hears the room through your microphone. It does not hear the other side of a Zoom or Teams call, so use it for in-person meetings and speakerphone calls.";
export const NO_LISTEN_LINE = "Your browser can't listen. Type it, or use your computer's dictation.";
export const NO_LISTEN_PHONE_LINE = "Use your keyboard's microphone to talk instead of typing.";
export const TRANSCRIPT_MAX = 200000;   // about three hours of talk
export const SUMMARY_MAX = 3500;        // the memo path takes 4000

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

// What a recognizer error means for the screen: these three mean it will not
// listen at all, so fall back to typing; anything else ("no-speech",
// "network", "aborted") is a pause the restart rides over.
export function errorStopsListening(code) {
  return code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture";
}

const norm = w => String(w || "").toLowerCase().replace(/[^a-z0-9']+/g, "");
// JOIN ONE SESSION'S WORDS TO THE TRANSCRIPT SO FAR. A restarted recognizer
// sometimes hands back the last few words it already gave; an overlap of up to
// eight words at the seam is dropped once.
export function stitch(sofar, next) {
  const a = String(sofar || "").replace(/\s+/g, " ").trim();
  const b = String(next || "").replace(/\s+/g, " ").trim();
  if (!a) return b;
  if (!b) return a;
  const aw = a.split(" "), bw = b.split(" ");
  for (let k = Math.min(8, aw.length, bw.length); k >= 2; k--) {
    const tail = aw.slice(-k).map(norm).join(" "), head = bw.slice(0, k).map(norm).join(" ");
    if (tail && tail === head) return [...aw, ...bw.slice(k)].join(" ");
  }
  return a + " " + b;
}
// Many segments, in order.
export function stitchAll(segments) {
  return (segments || []).reduce((t, s) => stitch(t, s), "");
}

// THE TRANSCRIPT AS KEPT. Personal details never sit in a saved transcript:
// each such sentence becomes one neutral line, and the count is returned.
export const HELD_LINE = "[A personal detail was held back.]";
// `details` are what was held, for the cards that wait for her yes; they are
// never stored with the transcript.
export function screenTranscript(text) {
  let held = 0;
  const out = [], details = [];
  for (const s of sentences(String(text || "").slice(0, TRANSCRIPT_MAX))) {
    const cat = sensitiveCategory(s);
    if (cat) { held++; details.push({ category: cat, quote: s.slice(0, 300), neutral: NEUTRAL[cat] }); if (out[out.length - 1] !== HELD_LINE) out.push(HELD_LINE); }
    else out.push(s);
  }
  return { text: out.join(" "), held, details };
}

export function minutesBetween(startIso, stopIso) {
  const a = new Date(startIso).getTime(), b = new Date(stopIso || Date.now()).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 60000)) : 0;
}
export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = n => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

// ── THE ONE CALL AT STOP ───────────────────────────────────────────────────
const S = { type: "string" };
const obj = (props) => ({ type: "object", additionalProperties: false, properties: props, required: Object.keys(props) });
export const MEETING_TOOL = {
  name: "meeting_summary",
  description: "Summarize one meeting from its transcript and the fundraiser's own notes. Every item comes from what was said or written.",
  strict: true,
  input_schema: obj({
    how: { type: "string", description: "What the meeting was: lunch, coffee, call, visit, meeting, tour or event. \"\" if it is not clear." },
    who: { type: "array", description: "The names of the people at the meeting besides the fundraiser, as they were said.", items: S },
    discussed: { type: "array", description: "What was discussed, one short plain sentence each, at most six.", items: S },
    cares_about: { type: "array", description: "What the donor cares about, in their words where possible, at most four.", items: S },
    promised: { type: "array", description: "What anyone promised, one sentence each, saying who promised it.", items: S },
    next_steps: { type: "array", items: obj({ step: S, when: { type: "string", description: "The words used for when (\"next Tuesday\", \"in March\"), or \"\"." } }) },
  }),
};
export const MEETING_SYSTEM = [
  "You read the transcript of a meeting between a nonprofit fundraiser and a donor, plus the fundraiser's own notes, and write the short summary she would have written herself.",
  "Her notes come first: where they and the transcript differ, follow her notes.",
  "Use only what was said or written. Never guess at an amount, a date or a feeling nobody stated.",
  "Leave out anything about health, a death or a family crisis, money troubles, or a child. Steward holds those back for her yes.",
  "Plain words, no headings inside items, no em dashes.",
].join("\n");

export function buildMeetingPrompt({ transcript, notes, people = [], today, minutes }) {
  // The middle of a very long transcript is cut, never the start or the end,
  // where the greetings, the promises and the next steps usually are.
  const t = String(transcript || "");
  const body = t.length > 60000 ? t.slice(0, 30000) + "\n[... the middle of the meeting is cut for length ...]\n" + t.slice(-30000) : t;
  const lines = [
    `Today is ${today}.`, minutes ? `The meeting ran about ${minutes} minutes.` : "",
    people.length ? `It was with: ${people.join("; ")}.` : "Who it was with is not set; say who from the transcript.",
    "", "Her notes:", String(notes || "").trim() || "(none)",
    "", "The transcript:", body || "(nothing was heard)",
  ].filter(x => x !== "");
  return { system: MEETING_SYSTEM, messages: [{ role: "user", content: lines.join("\n") }] };
}

const clean = (s, n = 300) => String(s || "").replace(/\s+/g, " ").replace(/\u2014/g, ",").trim().slice(0, n);
// Every item is screened on its own: a personal detail the model kept is
// dropped from the summary on the screen, not only from the memo.
const list = (a, n) => (Array.isArray(a) ? a : []).map(x => clean(x)).filter(x => x && !sensitiveCategory(x)).slice(0, n);
// The model's summary, normalized, plus the memo text the memo path files.
// The memo text names who, says the steps with her words for when, and is
// screened again so a personal detail the model kept never reaches the memo.
export function normalizeMeeting(raw, { people = [] } = {}) {
  const r = raw || {};
  const out = {
    how: clean(r.how, 30).toLowerCase(),
    who: list(r.who, 6),
    discussed: list(r.discussed, 6),
    caresAbout: list(r.cares_about, 4),
    promised: list(r.promised, 6),
    nextSteps: (Array.isArray(r.next_steps) ? r.next_steps : []).map(s => ({ step: clean(s && s.step), when: clean(s && s.when, 60) })).filter(s => s.step && !sensitiveCategory(s.step)).slice(0, 6),
  };
  // Items joined into one sentence start lower case ("talked about the
  // regatta"), unless the word is a name or an acronym.
  const mid = x => x.replace(/\.$/, "").replace(/^([A-Z])(?=[a-z]+\b)/, (c, _m, off, str) => (/^(The|A|An|How|What|Getting|Their|His|Her|More|Some|Our|Its)\b/.test(str) ? c.toLowerCase() : c));
  const names = [...new Set([...people, ...out.who])];
  const how = out.how || "meeting";
  const parts = [`${how[0].toUpperCase()}${how.slice(1)} with ${names.length ? names.join(" and ") : "them"}.`];
  if (out.discussed.length) parts.push(`We talked about ${out.discussed.map(mid).join("; ")}.`);
  if (out.caresAbout.length) parts.push(`They care about ${out.caresAbout.map(mid).join("; ")}.`);
  if (out.promised.length) parts.push(`Promised: ${out.promised.map(x => x.replace(/\.$/, "")).join("; ")}.`);
  for (const s of out.nextSteps) parts.push(`${s.step.replace(/\.$/, "")}${s.when ? ` ${s.when}` : ""}.`);
  const kept = [];
  for (const s of sentences(parts.join(" "))) if (!sensitiveCategory(s)) kept.push(s);
  out.memoText = kept.join(" ").slice(0, SUMMARY_MAX);
  return out;
}

// The summary shown on the screen, as sections.
export function summarySections(m) {
  return [
    ["What was discussed", m.discussed || []],
    ["What they care about", m.caresAbout || []],
    ["What was promised", m.promised || []],
    ["Next steps", (m.nextSteps || []).map(s => s.step + (s.when ? ` (${s.when})` : ""))],
  ].filter(([, items]) => items.length);
}

// ── ASK ABOUT THIS MEETING ─────────────────────────────────────────────────
// One question about ONE meeting, answered from its transcript and notes only,
// with the words that answer it quoted. Not a chat: no history, no other
// records, and nothing is written.
export const ASK_TOOL = {
  name: "meeting_answer",
  description: "Answer one question about this meeting from its transcript and notes only.",
  strict: true,
  input_schema: obj({
    answer: { type: "string", description: "One to three plain sentences. If the transcript does not say, say so." },
    quotes: { type: "array", description: "The exact words from the transcript or notes that answer it, at most three.", items: S },
  }),
};
export function buildAskPrompt({ question, transcript, notes }) {
  const t = String(transcript || "").slice(-60000);
  return { system: "You answer a fundraiser's question about one meeting, using only its transcript and her notes. Quote the exact words. If they do not answer it, say the meeting did not cover it. Never guess. No em dashes.",
    messages: [{ role: "user", content: `Her question: ${clean(question, 400)}\n\nHer notes:\n${String(notes || "").trim() || "(none)"}\n\nThe transcript:\n${t || "(nothing was heard)"}` }] };
}
// A quote counts only if it is really in the transcript or the notes.
export function groundedQuotes(quotes, transcript, notes) {
  const hay = norm(String(transcript || "") + " " + String(notes || "")).length ? (String(transcript || "") + " " + String(notes || "")).toLowerCase().replace(/\s+/g, " ") : "";
  return (Array.isArray(quotes) ? quotes : []).map(q => clean(q, 300)).filter(q => q.length >= 3 && hay.includes(q.toLowerCase().replace(/\s+/g, " "))).slice(0, 3);
}

export default { CONSENT_LINE, ROOM_ONLY_LINE, NO_LISTEN_LINE, listenMode, errorStopsListening, stitch, stitchAll, screenTranscript, HELD_LINE,
  minutesBetween, elapsedLabel, MEETING_TOOL, buildMeetingPrompt, normalizeMeeting, summarySections, ASK_TOOL, buildAskPrompt, groundedQuotes, TRANSCRIPT_MAX };
