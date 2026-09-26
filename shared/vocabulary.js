// shared/vocabulary.js — BUILD-86 Part B. HER WORDS.
//
// Sparrow Missions has sponsors, not recurring donors. GO has trip support,
// not designated gifts. Heart of Africa will have its own. An org sets its
// vocabulary once, in a five-question first run, and the staff-facing surfaces
// read from it.
//
// FOUR RULES, AND THEY ARE THE WHOLE DESIGN
//
//  1. PRESENTATION ONLY. No database column, no API field, no id, no route
//     changes. `donor_id` is `donor_id` at a shop that says "sponsors". The
//     census that sized this build found 2,513 occurrences of "donor" in the
//     client and ~134 of them rendered; the other 2,379 are identifiers and
//     must not move. (audit/BUILD-86-FINDINGS.md 0.3.)
//
//  2. THE DEFAULTS ARE TODAY'S STRINGS. An org that never answers a question
//     sees exactly what it saw before this module existed. That is what makes
//     the whole thing safe to ship: the no-op path is byte-identical.
//
//  3. THE PLURAL IS STORED, NEVER COMPUTED. English plurals are a trap and
//     somebody's word will be "clergy" or "familias". `t(key, count)` picks
//     between two stored strings; it never appends an "s".
//
//  4. NEVER WHAT A DONOR RECEIVES. A receipt, a year-end statement and the
//     donor portal are OUT OF REACH of this module. A §170 acknowledgment is
//     a legal document, and an org calling its people "sponsors" must not
//     change the words on one. The audience there is the donor, not the staff
//     member who chose the word. Asserted, not remembered.

// The keys, fixed. A key that is not here cannot be set, so a hostile or
// mistyped payload cannot invent vocabulary.
export const VOCAB_KEYS = [
  "giver_singular", "giver_plural",
  "monthly_giver_singular", "monthly_giver_plural",
  "fund_singular", "fund_plural",
  "fiscal_year_start_month",
  "season_name", "season_date",
];

// TODAY'S STRINGS. Changing one of these changes what an org that answered
// nothing sees, which is why they are here and not scattered through the UI.
export const VOCAB_DEFAULTS = {
  giver_singular: "donor",
  giver_plural: "donors",
  monthly_giver_singular: "monthly donor",
  monthly_giver_plural: "monthly donors",
  fund_singular: "fund",
  fund_plural: "funds",
  // 1–12, the month a fiscal year opens. SEVEN is today's behaviour (July 1),
  // hardcoded across the product before this; it stays the default so no
  // existing org's "this year" figure moves by a cent.
  fiscal_year_start_month: 7,
  season_name: null,
  season_date: null,
};

const MAX_WORD = 40;

// A word is one short line of plain text. No markup, no newlines, no essay —
// it lands in a sentence and in an email subject.
function cleanWord(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.slice(0, MAX_WORD);
}

function cleanMonth(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

function cleanDate(v) {
  const s = String(v == null ? "" : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Read whatever is stored (a JSON string, an object, null, garbage) and return
// a complete, valid vocabulary. Never throws: a corrupt value degrades to the
// defaults, because a broken settings row must not take down a screen.
export function normalizeVocabulary(raw) {
  let obj = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
  const out = { ...VOCAB_DEFAULTS };
  for (const k of VOCAB_KEYS) {
    if (!(k in obj)) continue;
    if (k === "fiscal_year_start_month") { const m = cleanMonth(obj[k]); if (m) out[k] = m; continue; }
    if (k === "season_date") { const d = cleanDate(obj[k]); if (d) out[k] = d; continue; }
    const w = cleanWord(obj[k]);
    if (w) out[k] = w;
  }
  return out;
}

// Only what differs from the defaults is stored, so an org that answered
// nothing has an empty object rather than a copy of today's strings frozen
// into its row — which is how a later default change would silently fail to
// reach the orgs that never chose anything.
export function vocabularyToStore(raw) {
  const full = normalizeVocabulary(raw);
  const out = {};
  for (const k of VOCAB_KEYS) if (full[k] !== VOCAB_DEFAULTS[k]) out[k] = full[k];
  return out;
}

// ── t(key, count) ──────────────────────────────────────────────────────────
// The one reader. `count` picks singular or plural for the pairs; it is
// ignored for the scalars. An unknown key returns null rather than the key
// name — a screen showing "giver_plurall" is worse than a screen showing
// nothing, and a test can see null.
const PAIRS = {
  giver: ["giver_singular", "giver_plural"],
  monthly_giver: ["monthly_giver_singular", "monthly_giver_plural"],
  fund: ["fund_singular", "fund_plural"],
};

export function makeT(vocabulary) {
  const v = normalizeVocabulary(vocabulary);
  return function t(key, count) {
    const pair = PAIRS[key];
    if (pair) return v[count === 1 ? pair[0] : pair[1]];
    if (VOCAB_KEYS.includes(key)) return v[key];
    return null;
  };
}

// Capitalised for the start of a sentence or a heading. The stored word is
// lower-case by convention ("sponsors"), because most of its uses are mid
// sentence; the few that are not ask for it here.
export function capitalize(s) {
  const str = String(s == null ? "" : s);
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// ── The five questions ─────────────────────────────────────────────────────
// In order, one sentence each. The FIRST-RUN shows the org's own evidence
// beside a question when the import already answered it — nothing is asked
// that her file has already said.
export const VOCAB_QUESTIONS = [
  { id: "giver", keys: ["giver_singular", "giver_plural"],
    question: "What do you call the people who give to you?",
    help: "Used everywhere Steward talks about them to you.",
    suggestions: [["donor", "donors"], ["sponsor", "sponsors"], ["partner", "partners"], ["supporter", "supporters"]] },
  { id: "monthly_giver", keys: ["monthly_giver_singular", "monthly_giver_plural"],
    question: "What do you call someone who gives every month?",
    help: "Steward watches these gifts for failed cards.",
    suggestions: [["monthly donor", "monthly donors"], ["sponsor", "sponsors"], ["partner", "partners"], ["sustainer", "sustainers"]] },
  { id: "fund", keys: ["fund_singular", "fund_plural"], evidence: "funds",
    question: "What do you call your funds or programs?",
    help: "These are the names already in your file.",
    suggestions: [["fund", "funds"], ["designation", "designations"], ["program", "programs"], ["project", "projects"]] },
  { id: "fiscal", keys: ["fiscal_year_start_month"],
    question: "When does your year start?",
    help: "Drives every “this year” figure on your dashboards." },
  { id: "season", keys: ["season_name", "season_date"], optional: true,
    question: "What is your one big event or season?",
    help: "Steward mentions it on your morning screen as the date approaches. Leave it blank if there isn’t one." },
];

// MONTHS, for the fiscal question and for reading a boundary back.
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// Is the org's season close enough to mention on Home? A season is only worth
// a clause while it is ahead and near; a date three months out is noise and a
// date in the past is a different build's problem.
export const SEASON_HORIZON_DAYS = 45;
export function seasonDaysAway(vocabulary, today) {
  const v = normalizeVocabulary(vocabulary);
  if (!v.season_name || !v.season_date || !today) return null;
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const a = p(today), b = p(v.season_date);
  if (a == null || b == null) return null;
  const days = Math.round((b - a) / 86400000);
  return days >= 0 && days <= SEASON_HORIZON_DAYS ? days : null;
}

// ── FIX-1 §13 — A COUNT OF GIVERS SAYS WHAT THEY ARE ───────────────────────
// The walk: "11 sponsors have gone quiet", three of the eleven foundations and
// churches. The org's word describes the PEOPLE who give to it; an
// organisation is not a sponsor. A count of people gets her word, a count of
// organisations says organisations, and a count that mixes them says givers,
// the one word true of both. `pair` picks which of her words people get
// ("giver" or "monthly_giver"). A legacy row with no kind is a person.
export function giverCountWord(rows, vocabulary, { pair = "giver" } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const orgs = list.filter(isOrganisationRow).length;
  if (list.length > 0 && orgs === list.length) return "organisations";
  if (orgs > 0) return "givers";
  return makeT(vocabulary)(pair, 2);
}

// ── FIX-1 §5 — AND ONE GIVER AT A TIME ─────────────────────────────────────
// The walk found the Sunrise Foundation called a "sponsor": the org's word for
// the PEOPLE who give to it, applied to a foundation. giverCountWord (above)
// answers for a count; these answer for one row, on the same test of what an
// organisation is, so a count and a name can never disagree about a row.
//
// An organisation is called what it is: from the funder type first (BUILD-100),
// then the imported donor type, then whole words of its own name. Nothing
// matched: "organisation". A legacy row with no kind is a person.
export function isOrganisationRow(r) { return /^organi[sz]ation$/.test(String(r?.kind || "")); }
const ORG_WORD_BY_FUNDER_TYPE = {
  private_foundation: "foundation", community_foundation: "foundation", family_foundation: "foundation",
  foundation: "foundation", church: "church", corporate: "business", corporation: "business",
  business: "business", government: "government agency", daf_sponsor: "donor-advised fund",
};
// Whole words only, never substrings: "Churchill Ltd" is a business, not a
// church, and it would be one if this read letters instead of words.
const ORG_WORD_BY_TOKEN = [
  [["foundation", "trust", "endowment"], "foundation"],
  [["church", "parish", "ministries", "ministry", "chapel", "congregation", "umc", "diocese", "synagogue", "temple", "mosque"], "church"],
  [["inc", "llc", "ltd", "corp", "corporation", "company", "co", "business", "bank"], "business"],
];
const wordsOf = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

export function orgWordFor(donor) {
  const ft = String((donor && (donor.funder_type || donor.funderType)) || "").toLowerCase();
  if (ORG_WORD_BY_FUNDER_TYPE[ft]) return ORG_WORD_BY_FUNDER_TYPE[ft];
  for (const src of [donor && (donor.donor_type || donor.donorType), donor && donor.name]) {
    const toks = new Set(wordsOf(src));
    for (const [words, label] of ORG_WORD_BY_TOKEN) if (words.some(w => toks.has(w))) return label;
  }
  return "organisation";
}

// giverWordFor(donor, vocabulary) — the word for THIS giver: her word for a
// person, what it is for an organisation.
export function giverWordFor(donor, vocabulary, { plural = false } = {}) {
  if (isOrganisationRow(donor)) {
    const w = orgWordFor(donor);
    const PLURAL = { business: "businesses", church: "churches", "government agency": "government agencies" };
    return plural ? (PLURAL[w] || w + "s") : w;
  }
  return makeT(vocabulary)("giver", plural ? 2 : 1);
}
