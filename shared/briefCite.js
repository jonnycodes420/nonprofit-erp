// shared/briefCite.js · ATLAS-3. A BRIEF CITES ITS ROWS IN WORDS.
//
// Brief me showed "(1 row)" after every sentence: true, and no help. A
// sentence now says what it rests on: "from 3 gifts", "from a conversation
// and the About note". The references are the same kind:id ones the
// validator checks (shared/briefShape.js); only the words changed.
const NOUN = {
  gift: ["gift", "gifts"], pledge: ["pledge", "pledges"], conversation: ["conversation", "conversations"],
  proposal: ["open ask", "open asks"], plan: ["plan", "plans"], household: ["household", "households"],
  softcredit: ["soft credit", "soft credits"], note: ["their notes", "their notes"], person: ["their record", "their record"],
};
const ORDER = ["gift", "pledge", "softcredit", "conversation", "proposal", "plan", "household", "note", "person"];
const count = (n, [one, many]) => (one === many ? one : n === 1 ? (/^[aeiou]/.test(one) ? "an " : "a ") + one : `${n} ${many}`);
const and = xs => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function citeWords(cites) {
  const by = new Map();
  for (const c of Array.isArray(cites) ? cites : []) {
    const kind = String(c).split(":")[0];
    if (!NOUN[kind]) continue;
    by.set(kind, new Set([...(by.get(kind) || []), c]));
  }
  // Their record is said only when nothing more particular is.
  if (by.size > 1) by.delete("person");
  const parts = ORDER.filter(k => by.has(k)).map(k => count(by.get(k).size, NOUN[k]));
  return parts.length ? `from ${and(parts)}` : "";
}
export default { citeWords };
