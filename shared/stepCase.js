// A next-step label is written as a heading ("Send the proposal"); inside a
// sentence ("Next: send the proposal.") only its first letter moves, and only
// when the first word is not a name or an acronym.
//
// FIX (2026-09-18) kept acronyms ("Send the LOI"). GIVE-EDIT-1 (from POLISH-2)
// keeps names: "Meridian Foundation report due" read "Next: meridian
// Foundation" because only the first word was looked at. A label that opens
// with a run of capitalised words ending in an organisation word, or with a
// word from the person's own name, keeps its casing.

export const ORG_NAME_RE = /\b(foundation|trust|fund|church|inc|llc|ltd|company|corporation|association|society|club|group|bank|school|university|council|collective|partners|ministries)\b/i;

const isCapitalised = w => /^[A-Z][a-zA-Z'’.&-]*$/.test(w);
// The verbs a step label opens with. "Call Meridian Foundation" is a step, not
// a name, so it still reads "call Meridian Foundation".
const STEP_VERBS = new Set(["ask", "book", "call", "check", "confirm", "draft", "email", "find", "follow", "invite", "log", "mail", "meet", "plan", "prepare", "review", "schedule", "send", "share", "submit", "text", "thank", "update", "visit", "write"]);

export function stepInSentence(label, names = []) {
  const str = String(label || "").trim();
  if (!str) return str;
  const words = str.split(/\s+/);
  const first = words[0];
  if (first.length > 1 && first === first.toUpperCase()) return str;          // an acronym
  // A proper noun phrase: "Meridian Foundation …", "Harbor Bank …".
  let i = STEP_VERBS.has(first.toLowerCase()) ? words.length : 0;
  while (i < words.length && isCapitalised(words[i])) {
    if (i > 0 && ORG_NAME_RE.test(words[i])) return str;
    i++;
  }
  // The person's own name: "Margaret's renewal", "Chen family visit".
  const nameWords = new Set((names || []).flatMap(n => String(n || "").split(/\s+/)).map(w => w.replace(/[^A-Za-z]/g, "").toLowerCase()).filter(w => w.length > 1));
  if (isCapitalised(first) && nameWords.has(first.replace(/['’]s$/i, "").replace(/[^A-Za-z]/g, "").toLowerCase())) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}
