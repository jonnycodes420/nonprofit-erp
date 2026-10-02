// shared/employerMatch.js — GIVE-2 §8. DOES YOUR EMPLOYER MATCH?
//
// ── WHAT IS AND IS NOT BUILT ───────────────────────────────────────────────
// A matching-gift LOOKUP SERVICE is a commercial database of employer matching
// programmes. There are two or three worth having and each wants a contract.
// Steward has none, so:
//
//   · THE ADAPTER SHAPE IS BUILT. One interface, one place a provider plugs in,
//     one place the answer is normalised. Behind `MATCHING_LOOKUP_ENABLED`,
//     which is off everywhere and has no provider registered.
//   · NO PARTNER IS NAMED. Not in the code, not in a comment, not on the site,
//     not in a settings screen. Naming a vendor Steward has not signed is a
//     claim about a relationship that does not exist, and the standing rule is
//     that nothing on the site is a claim that is not true on prod the day it
//     ships.
//   · WHAT SHIPS TODAY is the org's OWN list: employers it already knows match,
//     with the company's own form link. Typed by staff, shown to the donor on
//     the page they land on after giving. No contract, no vendor, no guessing.
//   · AND THE CURATED SNAPSHOT THAT WAS ALREADY HERE. `matchingGifts.js` at the
//     repo root is Steward's own hand-curated list of well-known employers with
//     public matching programmes, already shown on the donor profile. It has no
//     form links and says plainly that it will drift, so it ranks BELOW the
//     org's own typed row and above nothing.
//
// Resolution order, and it is the whole of the policy: the org's own list, then
// the curated snapshot, then a flagged provider (there is none). First answer
// wins, and every answer carries where it came from.
//
// ── WHY THE ORG'S OWN LIST IS NOT A POOR SUBSTITUTE ────────────────────────
// A small nonprofit's matching money comes overwhelmingly from a handful of
// large local employers — the hospital, the university, the bank with the
// branch on the square. An org that has ever received a match knows which they
// are, and a donor who works at one needs the link, not a database. The list is
// the 80% and it is the part that needs no signature.
//
// Pure: no DB, no network, no clock. The lookup adapter is an interface
// declaration and a registry; the caller supplies the rows.

// ── THE FLAG ───────────────────────────────────────────────────────────────
// Read by the caller from the environment. Named here so there is one spelling.
export const LOOKUP_FLAG_ENV = "MATCHING_LOOKUP_ENABLED";

// ── THE ADAPTER INTERFACE ──────────────────────────────────────────────────
// A provider is an object with a name and ONE method. It is given a plain
// employer name and an optional email domain, and answers with a normalised
// record or null. It is never given a donor id, a gift amount, a donor's name
// or a donor's email address: an employer-matching lookup needs the employer,
// and a provider that is handed a donor is a provider that has been handed a
// donor list.
//
//   {
//     key: "some_provider",                     // never shown to a donor
//     async lookup({ employerName, emailDomain }) → MatchingProgramme | null
//   }
//
// MatchingProgramme, the ONE shape every answer is normalised to:
//
//   {
//     employerName: string,       // as the provider spells it
//     matches: true | false | null, // null = the provider does not know
//     ratio: string | null,       // "1:1", "2:1" — words, not arithmetic
//     minCents: integer | null,
//     maxCents: integer | null,
//     formUrl: string | null,     // https only
//     note: string | null,
//     source: "org_list" | "provider:<key>",
//   }
const providers = new Map();

export function registerLookupProvider(provider) {
  if (!provider || typeof provider.lookup !== "function" || !provider.key) {
    throw new Error("A matching-gift provider needs a key and a lookup function.");
  }
  providers.set(String(provider.key), provider);
  return provider.key;
}

export function lookupProviderKeys() { return [...providers.keys()]; }

// THE ONE CALL. With no provider registered, or with the flag off, it answers
// null — which is the state Steward ships in, and the reason every caller has
// to handle null anyway.
export async function lookupMatchingProgramme({ employerName, emailDomain } = {}, { enabled = false, providerKey = null } = {}) {
  if (!enabled) return null;
  const keys = providerKey ? [String(providerKey)] : [...providers.keys()];
  for (const k of keys) {
    const p = providers.get(k);
    if (!p) continue;
    try {
      const raw = await p.lookup({ employerName: String(employerName || ""), emailDomain: String(emailDomain || "") || null });
      const norm = normaliseProgramme(raw, `provider:${k}`);
      if (norm) return norm;
    } catch {
      // A LOOKUP THAT FAILS COSTS THE DONOR NOTHING. It is a nicety on a
      // thank-you page; an outage in somebody else's service may not turn a
      // completed gift into an error screen.
      continue;
    }
  }
  return null;
}

// ── NORMALISING ────────────────────────────────────────────────────────────
// Everything a donor is shown goes through here, whether it came from a
// provider or from the org's own typed row. A `formUrl` is https or it is
// dropped: a donor is about to be sent to it from a page their gift just
// landed on.
export function normaliseProgramme(raw, source) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.employerName || raw.name || "").trim().slice(0, 200);
  if (!name) return null;
  let formUrl = null;
  const u = String(raw.formUrl || raw.form_url || "").trim();
  if (u) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) formUrl = parsed.toString();
    } catch { formUrl = null; }
  }
  const cents = v => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  return {
    employerName: name,
    matches: raw.matches === true ? true : raw.matches === false ? false : null,
    ratio: String(raw.ratio || "").trim().slice(0, 20) || null,
    minCents: cents(raw.minCents != null ? raw.minCents : raw.min_cents),
    maxCents: cents(raw.maxCents != null ? raw.maxCents : raw.max_cents),
    formUrl,
    note: String(raw.note || "").trim().slice(0, 300) || null,
    source: String(source || "org_list"),
  };
}

// ── MATCHING A TYPED EMPLOYER TO THE ORG'S OWN LIST ────────────────────────
// Case and punctuation folded, and the common company suffixes dropped, because
// a donor types "Acme" and the org typed "Acme Corporation" and they are the
// same employer. Deliberately NOT fuzzy beyond that: a wrong match sends a
// donor to the wrong company's form, which wastes the match and reads as
// carelessness.
const SUFFIXES = ["inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation",
                  "co", "company", "plc", "gmbh", "sa", "nv", "ag", "holdings", "group", "the"];

export function foldEmployer(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !SUFFIXES.includes(w));
  return words.join(" ");
}

// `rows` are the org's own `matching_employers`, shaped { name, form_url, ratio,
// min_cents, max_cents, note }. Returns a normalised programme or null.
export function matchEmployerInList(employerName, rows) {
  const want = foldEmployer(employerName);
  if (!want) return null;
  const list = (rows || []).map(r => ({ r, folded: foldEmployer(r.name) })).filter(x => x.folded);
  // Exact on the folded name first. Then a whole-word containment either way,
  // so "Acme Health" finds "Acme Health System" and vice versa, but "Acme" does
  // NOT find "Acme Bank" — one word in common is not an employer.
  const exact = list.find(x => x.folded === want);
  const hit = exact || list.find(x => {
    const a = x.folded.split(" "), b = want.split(" ");
    if (a.length < 2 && b.length < 2) return false;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length < 2) return false;
    return long.join(" ").includes(short.join(" "));
  });
  if (!hit) return null;
  return normaliseProgramme({
    employerName: hit.r.name,
    matches: true,
    ratio: hit.r.ratio,
    minCents: hit.r.min_cents,
    maxCents: hit.r.max_cents,
    formUrl: hit.r.form_url,
    note: hit.r.note,
  }, "org_list");
}

// ── THE ONE RESOLVER ───────────────────────────────────────────────────────
// Every surface that wants to know whether a donor's employer matches calls
// THIS, and it answers from the org's own list, then the curated snapshot, then
// a flagged provider. The caller hands in the curated answer already looked up,
// because `matchingGifts.js` at the root is CommonJS and synchronous and this
// module is neither — and because the ownership question ("is this row this
// org's") is a fact about the database that a pure module may not guess at.
//
// `curated` is the shape `lookupMatchingGift` returns:
//   { matched, companyName, ratio, sourceNote, lastVerified }
export async function resolveEmployerMatch(employerName, {
  orgRows = [], curated = null, lookupEnabled = false, providerKey = null, emailDomain = null,
} = {}) {
  const name = String(employerName || "").trim();
  if (!name) return null;

  const own = matchEmployerInList(name, orgRows);
  if (own) return own;

  if (curated && curated.matched) {
    // THE SNAPSHOT'S OWN CAVEAT TRAVELS WITH IT. A donor is about to be told
    // their employer matches; the sentence that says to confirm the terms is
    // part of the answer, not a footnote somebody might drop.
    return normaliseProgramme({
      employerName: curated.companyName,
      matches: true,
      ratio: curated.ratio,
      note: curated.sourceNote,
      formUrl: null,
    }, "curated");
  }

  const viaProvider = await lookupMatchingProgramme({ employerName: name, emailDomain },
    { enabled: !!lookupEnabled, providerKey });
  return viaProvider;
}

// ── THE WORDS ON THE PAGE ──────────────────────────────────────────────────
// Written here rather than in the page so the receipt page, the embedded form's
// thank-you and any later surface read one set. `fmtCents` is the caller's
// formatter (`en-US`, named).
export function matchSentence(programme, { giftCents = 0, orgName = "", fmtCents = c => `$${(c / 100).toFixed(2)}` } = {}) {
  if (!programme) return null;
  const bits = [];
  bits.push(`${programme.employerName} matches gifts to organisations like ${orgName || "this one"}.`);
  if (programme.ratio) bits.push(`They match ${programme.ratio}.`);
  if (giftCents > 0 && programme.ratio === "1:1") {
    const eligible = programme.minCents && giftCents < programme.minCents ? false : true;
    if (eligible) bits.push(`That would turn your ${fmtCents(giftCents)} into ${fmtCents(giftCents * 2)}.`);
  }
  if (programme.minCents && giftCents > 0 && giftCents < programme.minCents) {
    bits.push(`Their programme starts at ${fmtCents(programme.minCents)}.`);
  }
  if (programme.note) bits.push(programme.note);
  return bits.join(" ");
}

// The heading and the call to action, for the same reason.
export const MATCH_HEADING = "Your gift could be worth twice as much";
export const MATCH_CTA = "Open your employer's matching form";
export const MATCH_UNKNOWN = "Many employers match their staff's charitable gifts. It is worth asking yours.";
