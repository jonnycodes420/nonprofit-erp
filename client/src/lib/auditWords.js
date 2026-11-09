// client/src/lib/auditWords.js · POLISH-7 (W-1107-Atlas-26X). THE AUDIT LOG
// READS AS WORDS, NEVER AS RAW JSON.
// A field holding a list or an object (a segment's rules, a step's details)
// showed as {"rules":[{"field":… cut off mid-brace. Now it is the names and
// values in it, in plain words, and a count uses the one plural.
import { countLabel } from "../../../shared/countWords.js";

const word = k => String(k).replace(/_/g, " ");
function plainOf(v, depth = 0) {
  if (v === null || v === undefined || v === "") return "not set";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "object") {
    const s = String(v);
    if (/^\s*[[{]/.test(s)) { try { return plainOf(JSON.parse(s), depth); } catch { /* plain text */ } }
    return s;
  }
  if (depth > 2) return Array.isArray(v) ? countLabel(v.length, "item") : "details";
  if (Array.isArray(v)) return v.length ? v.map(x => plainOf(x, depth + 1)).join("; ") : "none";
  const parts = Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== "")
    .map(([k, x]) => `${word(k)} ${plainOf(x, depth + 1)}`);
  return parts.length ? parts.join(", ") : "not set";
}
export const auditValue = v => plainOf(v);
export const recordCount = n => countLabel(n, "record");
