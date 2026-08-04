// Finance entity-routing FIX (2026-08-04) — pure name-matching helpers for the
// manual-transaction Vendor/Donor field. JSX-free and Node-testable (same
// pattern as campaignMatch.js / importShape.js).
//
// The rule these serve: money from a person, foundation, or grant enters
// through the gift/grant paths (which stamp the ledger exactly once) — the
// manual money-in form routes a recognized name to the right flow instead of
// silently booking a donor's money as an anonymous ledger row. Matching is
// deliberately conservative: an ambiguous name matches NOTHING (never
// mis-assign — the same rule as import owner-matching and campaign matching).

// A grant still being pursued — the only statuses where a money-in plausibly
// IS that grant arriving. Mirrors GRANT_ACTIONABLE in Grants.jsx.
export const OPEN_GRANT_STATUSES = new Set([
  "prospecting", "loi", "applied", "submitted", "draft", "pending",
]);

// Generic org/legal noise that shouldn't decide a match ("Mellon Foundation"
// typed as "The Mellon Fdn Inc" is the same funder). If stripping stopwords
// leaves nothing (e.g. a donor literally named "The Foundation"), fall back to
// the full token list rather than matching everything.
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and",
  "inc", "llc", "co", "corp", "company",
  "fund", "trust", "charitable", "foundation", "fdn",
]);

export function nameTokens(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function coreTokens(raw) {
  const all = nameTokens(raw);
  const core = all.filter(w => !STOPWORDS.has(w));
  return core.length ? core : all;
}

// True when every core token of the shorter name appears in the longer one
// ("Mellon" ⊂ "Mellon Foundation"). A single very short token (< 3 chars)
// never matches — too broad to trust.
export function namesMatch(a, b) {
  const sa = new Set(coreTokens(a));
  const sb = new Set(coreTokens(b));
  if (!sa.size || !sb.size) return false;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const w of small) if (!big.has(w)) return false;
  if (small.size === 1 && [...small][0].length < 3) return false;
  return true;
}

// The typed name against a list of grants (raw server rows). Returns ONE open
// grant or null: no match → null; matches spanning DIFFERENT funders → null
// (ambiguous — never guess); several open asks from the SAME funder → the
// largest ask (the prompt names one, the human confirms).
export function findOpenGrantMatch(typed, grants) {
  if (!String(typed || "").trim()) return null;
  const open = (grants || []).filter(g => OPEN_GRANT_STATUSES.has(g.status));
  const hits = open.filter(g => namesMatch(typed, g.funder));
  if (!hits.length) return null;
  const funders = new Set(hits.map(g => coreTokens(g.funder).join(" ")));
  if (funders.size > 1) return null;
  return hits.sort((x, y) => (parseFloat(y.amount) || 0) - (parseFloat(x.amount) || 0))[0];
}

// The typed name against a list of donors. Exactly ONE match or null —
// two donors matching the same typed name is ambiguity, not a link.
export function findDonorMatch(typed, donors) {
  if (!String(typed || "").trim()) return null;
  const hits = (donors || []).filter(d => namesMatch(typed, d.name));
  return hits.length === 1 ? hits[0] : null;
}
