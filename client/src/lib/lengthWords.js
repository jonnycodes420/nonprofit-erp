// INPUT-1 item 3 · A LIMIT IS SAID BEFORE IT BITES, AND NOTHING IS CUT SILENTLY.
// A name has a hard limit (the server refuses past it, with this reason); a
// subject line has a soft one (inboxes cut it off), which warns and never blocks.
export const NAME_MAX = 100;
export const SUBJECT_SOFT_MAX = 60;

// The counter shows once she is near the limit.
export function nameCounter(v, max = NAME_MAX) {
  const n = String(v || "").length;
  return n >= Math.floor(max * 0.8) ? `${n} of ${max}` : "";
}
export function nameProblem(v, max = NAME_MAX) {
  const s = String(v || "").trim();
  if (!s) return "Type their name. A person needs a name to be saved.";
  if (s.length > max) return `That name is ${s.length} characters. Keep it to ${max} or fewer; nothing was cut.`;
  return "";
}
export function subjectWarning(v, max = SUBJECT_SOFT_MAX) {
  const n = String(v || "").length;
  return n > max ? `This subject is ${n} characters. Most inboxes show about the first ${max}, so the end may be cut off. It will still send.` : "";
}
