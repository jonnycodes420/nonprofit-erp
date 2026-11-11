// shared/touchKinds.js · TOUCH-1. WHAT SHE DID, IN HER OWN WORDS.
//
// "Log a touch" replaces "Log a call". She picks what she did from this list
// (or one her org added in Settings) and writes exactly what it was. Pure: the
// server and the browser both read it, so the dialog's chips, the timeline's
// words and the server's rules are one list.
//
// `interactionType` is the row's interactions.type. A visit is a meeting (the
// meeting rules, the "Meeting at ..." title and Last met count it), as it was.
// `legacy` is the BUILD-81 touch key (shared/threadShape.js TOUCH_TYPES) the
// Thread's defaults table already knows, so a logged touch proposes the same
// next step it always did. `care` is the plan-of-care touch types
// (shared/careShape.js) this kind fulfils: logging a handwritten note offers
// to complete a planned "Handwritten note".
export const TOUCH_KINDS = [
  { key: "call",         label: "Call",             interactionType: "call",         legacy: "call_reached", care: ["call"] },
  { key: "letter",       label: "Handwritten note", interactionType: "letter",       legacy: null,           care: ["note"] },
  { key: "email",        label: "Email",            interactionType: "email",        legacy: "email",        care: ["impact_update"] },
  { key: "visit",        label: "Visit",            interactionType: "meeting",      legacy: "visit",        care: ["visit", "tour"] },
  { key: "meeting",      label: "Meeting",          interactionType: "meeting",      legacy: "meeting",      care: ["visit", "tour", "ask"] },
  { key: "gift_sent",    label: "Gift sent",        interactionType: "gift_sent",    legacy: null,           care: [] },
  { key: "event_invite", label: "Event invite",     interactionType: "event_invite", legacy: null,           care: ["event_invite"] },
  { key: "text",         label: "Text",             interactionType: "text",         legacy: null,           care: [] },
  { key: "other",        label: "Other",            interactionType: "other",        legacy: null,           care: [] },
];
const BY_KEY = new Map(TOUCH_KINDS.map(k => [k.key, k]));

// A call's result. "Voicemail" and "No answer" are calls that did not reach
// them, so the next step they propose is the Thread's "Try again".
export const CALL_RESULTS = [
  { key: "reached",   label: "Reached" },
  { key: "voicemail", label: "Voicemail" },
  { key: "no_answer", label: "No answer" },
];
export const isCallResult = k => CALL_RESULTS.some(r => r.key === k);

// An org's own kind ("Board tour", "Birthday card") is key `custom:<id>`, an
// interactions row of type `other` that carries its label.
export const CUSTOM_PREFIX = "custom:";
export const isCustomKey = k => String(k || "").startsWith(CUSTOM_PREFIX) && String(k).length > CUSTOM_PREFIX.length;
export const LABEL_MAX = 40;
export function cleanLabel(s) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return t || null;
}

// The kind for a key: a built-in, or an org's own from `custom` ([{id,label}]).
export function touchKindFor(key, custom = []) {
  const k = String(key || "");
  if (BY_KEY.has(k)) return BY_KEY.get(k);
  if (isCustomKey(k)) {
    const id = k.slice(CUSTOM_PREFIX.length);
    const c = (custom || []).find(x => x && String(x.id) === id);
    return c ? { key: k, label: c.label, interactionType: "other", legacy: null, care: [], custom: true } : null;
  }
  return null;
}
export const isTouchKind = k => BY_KEY.has(String(k || ""));

// "In your words" is required for Other (an org's own kind names itself) and
// optional otherwise: a handwritten note logged with no words still says what she did.
export const wordsRequired = key => String(key || "") === "other";

// The Thread's touch key for the next-step defaults (call · no answer → Try again).
export function legacyKeyFor(key, callResult) {
  const k = touchKindFor(key) || null;
  if (!k) return null;
  if (k.key === "call") return callResult && callResult !== "reached" ? "call_no_answer" : "call_reached";
  return k.legacy;
}

// The line on the timeline: her words after the kind, or the kind alone.
export function touchLine(label, words) {
  const w = String(words || "").trim();
  return w ? `${label}: ${w}` : String(label || "Touch");
}

// The words saved as the interaction's note. A touch logged with no words is
// saved as its kind ("Handwritten note."), never as an empty note.
export function noteFor(label, words) {
  const w = String(words || "").trim();
  return w || `${label}.`;
}

// Which interactions types are a touch somebody made (Last contact counts
// them). The Thread's older types (ask, stewardship) are touches too.
export const TOUCH_INTERACTION_TYPES = ["call", "email", "ask", "stewardship", "letter", "text", "gift_sent", "event_invite"];
