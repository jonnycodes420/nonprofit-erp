// shared/importSentence.js — BUILD-87 Part 2. THE MOMENT AFTER IMPORT.
//
// The receipt used to open on a table. A person who has just handed over
// twenty-five thousand rows of their own history does not want a table first;
// they want to be told, in their own words, that the thing they decided was
// done. So the receipt leads with ONE sentence, BEFORE any number, and that
// sentence is built from the DECISIONS THE USER MADE IN THE MAPPER — never
// from generic copy.
//
// THREE RULES, carried over from BUILD-86's morning sentence because they are
// the same rules and there is no reason to have two answers:
//
//  1. NEVER A TEMPLATE WITH HOLES. A decision family with nothing in it
//     contributes no clause. "0 rows set aside" is the product filling a
//     screen with its own scaffolding.
//
//  2. HER WORDS. Every noun that has a vocabulary key reads through
//     shared/vocabulary.js's `t` — a shop that says "sponsors" is told about
//     sponsors. Passing no `t` yields today's strings exactly.
//
//  3. NEVER CLAIM A BALANCE YOU CANNOT BACK. The plain sentence ends "all of
//     it accounted for" only when the equation actually balances; when it does
//     not, the sentence says what is missing, in cents.
//
// JSX-free and clock-free, so it is testable without a browser.
// Pinned by tests/import-sentence.test.js, which asserts on the FAMILY of
// decision types, not on one string.

// The decision families this sentence knows how to speak about. A kind that is
// not here contributes nothing rather than guessing at a phrasing — a receipt
// that invents a sentence about a decision it does not understand is worse
// than one that stays quiet about it.
export const DECISION_KINDS = ["exclusion", "gift_type", "date_convention", "duplicates"];

const DEFAULT_WORD = {
  giver: ["donor", "donors"],
  fund: ["fund", "funds"],
};

// Integer-cents money formatting. No float ever holds a money value here, and
// nothing is rounded: the cents are already the truth.
export function formatCents(cents) {
  const n = Math.trunc(Number(cents) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return (neg ? "-$" : "$") + whole.toLocaleString("en-US") + "." + rest;
}

const fmtN = n => Number(n || 0).toLocaleString("en-US");

// "a, b and c" — an Oxford-comma-free list, because this is a sentence a
// person reads aloud, not a specification.
function joinClauses(list) {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const COUNT_WORD = ["", "", "Both", "All three", "All four", "All five", "All six"];

// The tail that says what happened to the things the file marks. "Both" only
// when there are exactly two; a bare "All" when there are more than six.
function setAsideTail(n) {
  if (n === 1) return "That is set aside as you asked.";
  const word = COUNT_WORD[n] || `All ${fmtN(n)}`;
  return `${word} are set aside as you asked.`;
}

// One clause per decision. Returns null for a decision that carries no rows —
// rule 1: nothing to say, so nothing is said.
function clauseFor(d, word) {
  if (!d || typeof d !== "object") return null;
  const label = String(d.label || "").trim();
  switch (d.kind) {
    case "exclusion": {
      const n = Number(d.rows) || 0;
      if (n <= 0 || !label) return null;
      return `${fmtN(n)} row${n === 1 ? "" : "s"} as ${label}`;
    }
    case "gift_type": {
      const n = Number(d.gifts) || 0;
      if (n <= 0 || !label) return null;
      return `${fmtN(n)} gift${n === 1 ? "" : "s"} as ${label}`;
    }
    default:
      return null;
  }
}

// The reading decisions: a date convention the user chose, and duplicate rows
// they reviewed. Neither is a set-aside, so neither may ride the set-aside
// tail — saying "set aside" about a fold would be a lie about where the money
// went.
function readingSentences(decisions, word) {
  const out = [];
  const dc = decisions.find(d => d && d.kind === "date_convention" && d.convention);
  if (dc) {
    const first = String(dc.convention).toLowerCase().startsWith("dd") ? "day first" : "month first";
    const n = Number(dc.rows) || 0;
    out.push(n > 0
      ? `Dates are read ${first}, as you chose, across ${fmtN(n)} row${n === 1 ? "" : "s"}.`
      : `Dates are read ${first}, as you chose.`);
  }
  const dup = decisions.find(d => d && d.kind === "duplicates" && (Number(d.merged) || 0) > 0);
  if (dup) {
    const n = Number(dup.merged);
    out.push(`${fmtN(n)} duplicate row${n === 1 ? "" : "s"} folded into the ${word("giver", 2)} you kept.`);
  }
  return out;
}

// THE PLAINEST TRUE THING — what the sentence is when no decisions were made.
// It is allowed to be the whole lead: a clean file that needed no judgement is
// a real answer, and dressing it up would be the product congratulating itself.
export function plainTotalsSentence(totals = {}, t) {
  const word = (k, n) => (t && t(k, n)) || DEFAULT_WORD[k][n === 1 ? 0 : 1];
  const donors = Number(totals.donors) || 0;
  const gifts = Number(totals.gifts) || 0;
  const cents = Math.trunc(Number(totals.cents) || 0);
  const head = `${fmtN(donors)} ${word("giver", donors)} and ${fmtN(gifts)} gift${gifts === 1 ? "" : "s"}, ${formatCents(cents)}`;
  // Rule 3 — the balance claim is only made when it is true. `unaccountedCents`
  // is the authority; `balanced` is accepted as a shorthand for zero.
  const gap = Math.trunc(Number(totals.unaccountedCents) || 0);
  if (gap !== 0) return `${head}, and ${formatCents(Math.abs(gap))} is not yet accounted for.`;
  if (totals.balanced === false) return `${head}. The file does not yet reconcile.`;
  return `${head}, all of it accounted for.`;
}

// THE LEAD SENTENCE.
//
//   importLeadSentence({ decisions, totals }, t) -> string
//
// `decisions` is the list the mapper produced; `totals` is {donors, gifts,
// cents, unaccountedCents}. `t` is shared/vocabulary.js's reader, or omitted
// for today's strings.
export function importLeadSentence({ decisions = [], totals = {} } = {}, t) {
  const word = (k, n) => (t && t(k, n)) || DEFAULT_WORD[k][n === 1 ? 0 : 1];
  const list = Array.isArray(decisions) ? decisions.filter(Boolean) : [];

  const marked = [];
  for (const d of list) {
    const c = clauseFor(d, word);
    if (c) marked.push(c);
  }
  const sentences = [];
  if (marked.length) {
    sentences.push(`Your file marks ${joinClauses(marked)}.`);
    sentences.push(setAsideTail(marked.length));
  }
  sentences.push(...readingSentences(list, word));

  // Nothing was decided: the plainest true thing IS the sentence.
  if (!sentences.length) return plainTotalsSentence(totals, t);
  return sentences.join(" ");
}

// ── Building the decision list from what the importer already knows ─────────
// The receipt must not re-derive the user's choices from the data; it reads
// the SAME submission the write came from (buildWorkbookSubmission's output).
// This adapter is kept here, not in the component, so it can be tested without
// a browser — and so the shapes it depends on are named in one place.

// The exclusion flags buildWorkbookSubmission counts, with the words a person
// uses for them. A flag that is not here contributes no clause rather than
// rendering a camelCase key onto somebody's screen.
export const EXCLUSION_LABEL = {
  deceased: "deceased",
  doNotContact: "do not contact",
  doNotSolicit: "do not solicit",
  doNotMail: "do not mail",
  doNotEmail: "do not email",
};

// The gift types the importer routes OUT of cash. Routed is the third bucket
// of the workbook equation (imported + refused + routed), so these genuinely
// are set aside and the receipt is allowed to say so.
export const ROUTED_LABEL = {
  pledges: "pledge commitments",
  // BUILD-99 (major gifts) Part 6 — an open ask is money that has NOT arrived,
  // so it is ROUTED off the cash total like a pledge and named in its own words.
  proposals: "open proposals",
  softCredits: "soft credit",
  inKind: "in-kind gifts",
  refunds: "refunds",
  reversals: "reversals",
};

export function decisionsFromSubmission(submission, result) {
  const out = [];
  const s = submission || {};
  const r = result || {};

  // 1. EXCLUSION FLAGS — deceased, do-not-contact and family.
  const ex = s.exclusionSummary;
  if (ex && typeof ex === "object") {
    for (const [key, label] of Object.entries(EXCLUSION_LABEL)) {
      const n = Number(ex[key]) || 0;
      if (n > 0) out.push({ kind: "exclusion", label, rows: n });
    }
  }

  // 2. GIFT TYPE — rows the mapper routed off the cash total.
  const routed = s.routed;
  if (routed && typeof routed === "object") {
    for (const [key, label] of Object.entries(ROUTED_LABEL)) {
      const n = Array.isArray(routed[key]) ? routed[key].length : Number(routed[key]) || 0;
      if (n > 0) out.push({ kind: "gift_type", label, gifts: n });
    }
  }

  // 3. DATE CONVENTION — only when the file's dates actually resolved one way
  // or the other. "default-mdy" is an absence of evidence, not a decision, and
  // saying it out loud would be the product claiming a choice nobody made.
  const convs = Array.isArray(s.conventions) ? s.conventions : [];
  const decided = convs.find(c => c && (c.convention === "dmy" || c.convention === "mdy")
                              && ((Number(c.dayFirstEvidence) || 0) + (Number(c.monthFirstEvidence) || 0)) > 0);
  if (decided) {
    out.push({ kind: "date_convention",
               convention: decided.convention === "dmy" ? "dd/mm" : "mm/dd",
               rows: Number(decided.slashCells) || 0 });
  }

  // 4. DUPLICATES REVIEWED — the folds the write actually stored, else the
  // folds the submission proposed.
  const merged = Number((r.semantics && r.semantics.counts && r.semantics.counts.merges)
    || (r.counts && r.counts.merges)
    || (Array.isArray(s.merges) ? s.merges.length : 0) || 0);
  if (merged > 0) out.push({ kind: "duplicates", merged });

  return out;
}
