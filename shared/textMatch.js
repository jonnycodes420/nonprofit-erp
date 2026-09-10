// shared/textMatch.js — BUILD-84 census. A MATCH RESPECTS THE BOUNDARIES OF
// THE UNIT BEING MATCHED.
//
// The class this module exists to close has now surfaced four times, each
// fixed only on the path where it appeared:
//
//   BUILD-82      workbook header path      "Unnamed: 31" contains "name"
//                                           → 23,867 donors discarded
//   Mapper FIX    CSV guessField            `header.includes(label)`:
//   (9 Sep)                                 contact_confidence → name,
//                                           capacity_estimate → city,
//                                           region_code → state
//   FIX-3 (10 Sep) portal-page CI guard     "600" inside the minted id
//                                           imp_6e5600ab → a false red build
//   BUILD-84 P0-1  the value scanner        drive_min_from_wilmore read as
//                                           $12,840 of the file's money
//
// A header, a donor name, a campaign title and a serialized payload all have
// structure. Containment means the whole UNIT appears — a token, a token run,
// a leaf value — never a run of letters that happens to line up.
//
// Pure, dependency-free, and deliberately its own module so the server, the
// shared import layer and the client libraries can all read ONE definition
// without any of them dragging in the others.

// Split any text into comparable tokens: everything that is not a letter or a
// digit is a separator. This is what makes `_` behave — `\b` does NOT fire at
// an underscore, because `_` is a word character, which is how `fiscal_year`
// slipped past `\byear\b` and `zipcode` past `\bzip\b`.
export function tokenizeText(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim().split(" ").filter(Boolean);
}

// containsTokenRun(haystack, needle) — every token of `needle`, in order, as a
// contiguous run of `haystack`'s tokens.
//   containsTokenRun("joann leewood", "ann lee")  → false
//   containsTokenRun("spring gala 2026", "gala")  → true
export function containsTokenRun(haystack, needle) {
  const H = tokenizeText(haystack), N = tokenizeText(needle);
  if (!H.length || !N.length || N.length > H.length) return false;
  for (let i = 0; i + N.length <= H.length; i++) {
    let hit = true;
    for (let j = 0; j < N.length; j++) if (H[i + j] !== N[j]) { hit = false; break; }
    if (hit) return true;
  }
  return false;
}

// Either direction, for the "these two names may be the same thing" test.
export function eitherContainsTokenRun(a, b) {
  return containsTokenRun(a, b) || containsTokenRun(b, a);
}

// ── Structured payloads are WALKED, not serialized and searched ────────────
// `JSON.stringify(payload).includes(x)` is the class in its purest form: it
// throws away every boundary the structure provides and then asks a question
// about letters. Walk the leaves instead, and compare each one with the type
// it actually has — a number as a number, an id as an id.
//
// findLeaf(payload, predicate) → the first { path, value } whose leaf matches,
// or null. `path` is dotted with [i] for array indices, so a hit names WHERE
// it was found rather than "somewhere in the JSON".
export function findLeaf(value, predicate, path = "") {
  if (value === null || value === undefined) return predicate(value, path) ? { path, value } : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findLeaf(value[i], predicate, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const k of Object.keys(value)) {
      const hit = findLeaf(value[k], predicate, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
    return null;
  }
  return predicate(value, path) ? { path, value } : null;
}

// The two questions a leak guard actually wants to ask, with types.
// numericLeafEquals: 600 the NUMBER (or the string "600"), never the digits
// "600" inside `imp_6e5600ab`.
export function numericLeafEquals(payload, n) {
  return findLeaf(payload, v =>
    (typeof v === "number" && v === n) ||
    (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) && Number(v) === n));
}
// textLeafContains: a phrase inside a TEXT leaf, token-aware, so a donor name
// is found in a rendered sentence but never inside an opaque identifier.
export function textLeafContains(payload, phrase) {
  return findLeaf(payload, v => typeof v === "string" && containsTokenRun(v, phrase));
}
