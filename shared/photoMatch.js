// shared/photoMatch.js — BUILD-96 Part 5. A FILE NAME IS NOT A PERSON.
//
// A fundraiser arrives with a folder of headshots off the old system. The file
// names are whatever that system exported: `margaret.whitfield@example.org.jpg`,
// `00Q5f000004Xy.png`, `Margaret Whitfield.jpeg`, `IMG_4471.jpg`.
//
// THE RULE THIS MODULE EXISTS TO HOLD:
//
//     A PHOTO IS ATTACHED ONLY WHEN THE FILE NAME IDENTIFIES EXACTLY ONE
//     PERSON. EVERYTHING ELSE IS HANDED BACK BY NAME.
//
// Attaching a face to the wrong record is not a small error that gets tidied
// later. It is a wrong face on a donor's profile, on the Thread row a
// fundraiser reads at 7:40, and beside a gift — and nobody reviews a photo
// that "worked", so it stays. A photo that did not match costs one click. So
// every ambiguity resolves to "you decide", never to a best guess.
//
// ── THE THREE RULES, IN ORDER, AND WHY THAT ORDER ──────────────────────────
//
//   1. EMAIL. `margaret.whitfield@example.org.jpg`. An email address is unique
//      to a person by construction and is the only identifier in this list
//      that cannot legitimately be shared.
//   2. LEGACY ID. `00Q5f000004Xy.png`. Whatever the old system called her —
//      matched against external_donor_id and the external_donor_ids array, so
//      an export from any of her previous systems works.
//   3. EXACT FULL NAME. `Margaret Whitfield.jpeg`. Case- and
//      punctuation-insensitive, whitespace-collapsed, but COMPLETE: every part
//      of the name, in order.
//
// Email before id before name, because that is strongest-first. A file called
// `margaret@example.org.jpg` that also happens to contain a name should be
// decided by the address.
//
// ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
//
// No partial-name matching. No first-name matching. No nicknames, no fuzzy
// distance, no "closest match". `margaret.jpg` in an org with one Margaret is
// exactly the case that feels safe and is not: the second Margaret arrives
// next year and the rule that attached the first one silently attaches her
// face to the wrong record. "Nothing is guessed on a partial name" is the
// requirement, and the absence of that code is how it is kept.
//
// AMBIGUITY IS NOT A MATCH. Two people with the same full name produce
// `ambiguous`, not the first one found. Whichever rule hits, it must hit once.
//
// Pure: no DB, no network, no clock, no JSX. The caller passes the roster.

// The extensions the product accepts, mirroring the single-upload path. A file
// refused here is refused BY NAME so the report can say which one.
export const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

// "Margaret Whitfield.jpeg" -> { stem: "Margaret Whitfield", ext: "jpeg" }
// A folder drop carries paths ("headshots/margaret.jpg"); only the last
// segment is the name, and a leading directory must never become part of it.
export function splitFileName(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base, ext: "" };
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() };
}

// Names compare on letters and digits only, so the same person typed by two
// systems compares equal. It is still a WHOLE-name comparison — never a
// prefix, a length or a distance — just one that survives punctuation.
//
// THE APOSTROPHE AND THE HYPHEN ARE NOT THE SAME PUNCTUATION, and treating
// them alike is why "Robert OBrien Smith.png" failed to find "Robert
// O'Brien-Smith" the first time this ran:
//
//   · an apostrophe is INSIDE a word — O'Brien is one name part, and a system
//     that strips it exports "OBrien", not "O Brien". So it is removed.
//   · a hyphen SEPARATES parts — O'Brien-Smith is two, and a system that
//     strips it exports "OBrien Smith". So it becomes a space.
//
// Collapsing both to a space gives "o brien smith" from one export and
// "obrien smith" from the other, and they never meet.
export function normalizeName(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // drop accents, keep the letter
    .replace(/['\u2019\u02bc]/g, "")    // apostrophes are intra-word: O'Brien -> obrien
    .replace(/[^a-z0-9]+/g, " ")        // everything else separates
    .trim();
}

const normalizeId = s => String(s || "").trim().toLowerCase();

// An email inside a file name. Exported file names often replace `@` with `_at_`
// or strip it; only a real, complete address counts, because a half-address is
// a partial match wearing a costume.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// buildIndex(people) — people: [{ id, name, email, externalIds: [] }]
//
// Every index maps a key to an ARRAY, never to a person, so "exactly one" is a
// question that can be asked rather than assumed. A roster with two rows
// sharing an email is a data problem, and it must produce `ambiguous` rather
// than whichever row the loop saw last.
export function buildIndex(people) {
  const byEmail = new Map(), byExternalId = new Map(), byName = new Map();
  const push = (map, key, person) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(person); else map.set(key, [person]);
  };
  for (const p of people || []) {
    push(byEmail, normalizeId(p.email), p);
    push(byName, normalizeName(p.name), p);
    for (const x of [p.externalId, ...(Array.isArray(p.externalIds) ? p.externalIds : [])]) {
      push(byExternalId, normalizeId(x), p);
    }
  }
  return { byEmail, byExternalId, byName };
}

// matchOne(fileName, index) -> one of:
//   { status: "matched",     rule, person }
//   { status: "ambiguous",   rule, candidates }   — the rule hit more than once
//   { status: "unmatched"  }                      — no rule hit
//   { status: "bad_type", ext }                   — not a photo we accept
//
// A non-match is never an error. It is a row in "needs you" with a picker
// beside it, which is a click — and the whole design trades clicks for never
// putting a face on the wrong person.
export function matchOne(fileName, index) {
  const { stem, ext } = splitFileName(fileName);
  if (!PHOTO_EXTENSIONS.includes(ext)) return { status: "bad_type", ext };

  const trimmed = stem.trim();

  // 1 · email
  if (EMAIL_RE.test(trimmed)) {
    const hits = index.byEmail.get(normalizeId(trimmed)) || [];
    if (hits.length === 1) return { status: "matched", rule: "email", person: hits[0] };
    if (hits.length > 1)  return { status: "ambiguous", rule: "email", candidates: hits };
    return { status: "unmatched" };   // a complete address that is nobody's is NOT then tried as a name
  }

  // 2 · legacy id
  const byId = index.byExternalId.get(normalizeId(trimmed)) || [];
  if (byId.length === 1) return { status: "matched", rule: "legacyId", person: byId[0] };
  if (byId.length > 1)  return { status: "ambiguous", rule: "legacyId", candidates: byId };

  // 3 · exact full name
  const byName = index.byName.get(normalizeName(trimmed)) || [];
  if (byName.length === 1) return { status: "matched", rule: "fullName", person: byName[0] };
  if (byName.length > 1)  return { status: "ambiguous", rule: "fullName", candidates: byName };

  return { status: "unmatched" };
}

// The sentence the screen shows. "41 photos attached, 6 need you." — and when
// nothing needs her, it does NOT say "and 0 need you", because a count of zero
// is a sentence with a hole in it (the BUILD-86 C.2 rule).
export function photoReport({ attached, needsYou }) {
  const a = attached || 0, n = needsYou || 0;
  const photos = `${a} photo${a === 1 ? "" : "s"} attached`;
  return n > 0 ? `${photos}, ${n} need${n === 1 ? "s" : ""} you.` : `${photos}.`;
}
