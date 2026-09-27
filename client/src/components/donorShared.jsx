// donorShared.jsx — what the Donors files share: stage rules and the helpers
// more than one of them uses.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { T, STAGES } from "./shared";
import { containsTokenRun, tokenizeText } from "../../../shared/importShape";

const IMPORT_STAGES = ["prospect","qualify","cultivate","solicit","steward","lapsed"];

// Headers that negate a contact field — never map to that field
const NEGATOR_PHRASES = ["do not", "don't", "opt out", "opt-out", "unsubscribe", "no email", "no phone", "no mail", "do not contact"];

// `days` is `null` (not Infinity) when the last-gift date is missing or
// unparseable — deliberately distinct from "known to be a long time ago" so
// a donor with real giving history but a bad/blank date never reads as a
// confidently-wrong "lapsed" (that was the actual bug: Infinity > 365 is
// true, so any donor with an unparseable date silently became "lapsed").
// `hasContactInfo` (email or phone on file) gives a real, reachable path to
// "qualify" for a donor with no gift history yet but some engagement signal
// — previously "qualify" and "solicit" were structurally unreachable outputs
// of this function regardless of input.
function inferStage(total, lastGiftStr, hasContactInfo) {
  const amount = parseFloat(String(total || "0").replace(/[$,]/g, "")) || 0;
  const d = lastGiftStr ? new Date(lastGiftStr) : null;
  const days = d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : null;
  if (!amount && days === null) return hasContactInfo ? "qualify" : "prospect";
  if (days !== null && days > 365) return "lapsed";
  if (days !== null && days < 90 && amount > 0) return "steward";
  // A substantial gift 90–180 days ago reads as "ready for a follow-up ask"
  // rather than folding into the generic "cultivate" bucket.
  if (days !== null && days >= 90 && days <= 180 && amount >= 1000) return "solicit";
  if (amount > 0) return "cultivate";
  return "prospect";
}

const STAGE_COLORS = Object.fromEntries(STAGES.map(s => [s.id, s.color]));

// ── Normalization helpers (normalizeDate/Money/Email) live in
// (now shared/importShape.js) — BUILD-58 Part 2 moved them so the pure ledger-row
// builder there can use them and the Node suite can test the pipeline. ────
// BUILD-84 census — a stage CELL is a value with word boundaries, and the old
// rule was raw substring: `v.includes("ask")` read "Alaska" as solicit,
// `v.includes("lost")` read "Lost Creek Chapter" as lapsed, `v.includes("warm")`
// read "Warmack" as qualify. Matching is whole-token now — a prefix family
// (qualif→qualified/qualifying, cultivat→cultivated) is expressed as a token
// PREFIX, not as a substring of the whole string — and the multi-word phrases
// match as whole token runs through the same seam the header matcher uses.
const STAGE_TOKEN_RULES = [
  { stage: "prospect",  prefixes: ["prospect", "lead", "potential"] },
  { stage: "qualify",   prefixes: ["qualif", "engaged", "warm"] },
  { stage: "cultivate", prefixes: ["cultivat", "nurtur"] },
  { stage: "solicit",   prefixes: ["solicit", "ask"], phrases: ["pledge pending", "ready to ask"] },
  { stage: "steward",   prefixes: ["steward", "current"], phrases: ["active donor"] },
  { stage: "lapsed",    prefixes: ["lapsed", "inactive", "lost", "former"] },
];
function normalizeStage(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (IMPORT_STAGES.includes(v)) return v;
  const tokens = tokenizeText(v);
  for (const r of STAGE_TOKEN_RULES) {
    if (tokens.some(t => (r.prefixes || []).some(p => t.startsWith(p)))) return r.stage;
    if ((r.phrases || []).some(ph => containsTokenRun(v, ph))) return r.stage;
  }
  return null;
}

// ── Directory View ─────────────────────────────────────────────────────────
// (The old client-side downloadDirectoryCsv/directoryCsvCell were removed in
// BUILD-06 Phase A: with a server-paginated list, "the rows on screen" is
// one page, so Export CSV now hits GET /donors/export/csv with the same
// search/stage/owner query params — every matching row, same injection
// guard, applied server-side by toCsv/reportCsvCell.)
// Server-paginated as of BUILD-06 Phase A: `donors` is the current 50-row
// page (already narrowed by any client-side advanced/custom-field filters —
// see the Donors component), `serverTotal` is the query's full match count,
// and stage/owner/search filtering happens in the GET /donors query itself.
const DESIGNATION_OPTS=[["planned_confirmed","Planned gift confirmed"],["planned_prospect","Planned-giving prospect"],["estate","Estate giving"]];

// ── Donor Segmentation ─────────────────────────────────────────────────────
const TIER_META=[
  {id:"micro",    label:"Micro",     color:T.ink3},
  {id:"small",    label:"Small",     color:T.green500},
  {id:"mid",      label:"Mid",       color:T.greenMid},
  {id:"major",    label:"Major",     color:T.gold600},
  {id:"principal",label:"Principal", color:T.greenDk},
];
const PATTERN_META=[
  {id:"one-time", label:"One-time"},
  {id:"recurring",label:"Recurring (2+ gifts)"},
  {id:"major",    label:"Major gift (>$10k)"},
  {id:"lapsed",   label:"Lapsed (>365d)"},
];

export { DESIGNATION_OPTS, NEGATOR_PHRASES, PATTERN_META, STAGE_COLORS, TIER_META, inferStage, normalizeStage };
