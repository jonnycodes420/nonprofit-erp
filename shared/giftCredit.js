// shared/giftCredit.js — BUILD-98 Part 1. SOFT CREDITS, TRIBUTES, MATCHES.
//
// The first thing a Bloomerang user checks, and the three places a CRM most
// often double-counts money. The rule this module exists to hold:
//
//     A GIFT IS COUNTED ONCE, ON THE PERSON WHOSE MONEY IT WAS.
//
// ── SOFT CREDIT ────────────────────────────────────────────────────────────
// A $1,000 grant from Schwab Charitable that Margaret recommended is Schwab's
// money and Margaret's gift. Hard credit stays on Schwab: the ledger posts
// once, the bookkeeper's export shows it once, the receipt names Schwab.
// Margaret gets a SOFT credit — a row that points at the gift and carries an
// amount, and that no total reads unless it is asked to. Her lifetime is $0
// hard and $1,000 with soft. Nothing here ever writes to gifts.amount, to
// donors.total_giving or to fin_transactions.
//
// A soft credit is at most the gift. Several people may each be credited up to
// the whole gift (a couple, and the board member who asked) — that is what
// soft credit means and why it never sums into anything.
//
// ── TRIBUTE ────────────────────────────────────────────────────────────────
// "In memory of" and "in honour of" are facts about the GIFT, with the person
// honoured as a record when there is one and as a name when there is not. The
// family is told a gift was made; they are NEVER told how much. That is the
// convention every tribute programme follows, and the notice this module
// writes cannot carry an amount because it is never handed one.
//
// ── MATCH ──────────────────────────────────────────────────────────────────
// An employee's gift that the employer will match is a PROMISE from the
// employer. It is written as a pledge on the employer's record with one
// instalment for the expected match, flagged as a match so no pledge reminder
// is ever sent to a company about its matching programme. When the employer's
// cheque arrives through any door, the existing instalment rule applies it and
// the pledge closes in cents. The match is the employer's hard credit; the
// employee gets nothing extra — their gift is already theirs.
//
// Pure: no DB, no network, no clock, no JSX.

export const SOFT_CREDIT_ROLES = ["recommender", "spouse", "solicitor", "household", "other"];
export const SOFT_CREDIT_ROLE_LABELS = {
  recommender: "Recommended the gift",
  spouse: "Spouse or partner",
  solicitor: "Asked for it",
  household: "Household",
  other: "Other",
};

export const TRIBUTE_HONOR = "honor";
export const TRIBUTE_MEMORY = "memory";
export const TRIBUTE_TYPES = [TRIBUTE_HONOR, TRIBUTE_MEMORY];

// The phrases a file or a form carries, read to one of two answers. Anything
// else is not a tribute type, and saying so beats guessing which one it was.
export function normaliseTributeType(raw) {
  const t = String(raw || "").trim().toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/\b(memory|memoriam|memorial|in mem|deceased)\b/.test(t) || t === "imo" || t === "mem") return TRIBUTE_MEMORY;
  if (/\b(honou?r|honoree|honouree|tribute to|celebration)\b/.test(t) || t === "iho" || t === "hon") return TRIBUTE_HONOR;
  return null;
}

export function tributePhrase(type) {
  return type === TRIBUTE_MEMORY ? "in memory of" : type === TRIBUTE_HONOR ? "in honour of" : "";
}

const toCents = v => Math.round(Number(v) * 100);

// One soft credit's amount, in cents, from EITHER an amount OR a percentage of
// the gift. Both given is a contradiction; neither is a missing fact; more than
// the gift is not a soft credit.
export function softCreditCents(giftCents, { amount = null, pct = null } = {}) {
  const hasAmt = amount !== null && amount !== undefined && String(amount).trim() !== "";
  const hasPct = pct !== null && pct !== undefined && String(pct).trim() !== "";
  if (hasAmt && hasPct) return { error: "give an amount or a percentage, not both" };
  if (!hasAmt && !hasPct) return { cents: giftCents };            // the whole gift is the default
  if (hasPct) {
    const p = Number(pct);
    if (!Number.isFinite(p) || p <= 0 || p > 100) return { error: "a percentage between 0 and 100" };
    return { cents: Math.round(giftCents * p / 100), pct: p };
  }
  const c = toCents(amount);
  if (!Number.isFinite(c) || c <= 0) return { error: "an amount greater than zero" };
  if (c > giftCents) return { error: "a soft credit cannot be more than the gift" };
  return { cents: c };
}

// Validate a gift's whole soft-credit list. Returns the rows to write, or the
// reasons nothing may be written. Nobody is soft-credited twice on one gift,
// and the hard donor is never their own soft credit.
export function validateSoftCredits(giftCents, hardDonorId, list) {
  const errors = [];
  const rows = [];
  const seen = new Set();
  for (const [i, raw] of (Array.isArray(list) ? list : []).entries()) {
    const donorId = String(raw?.donorId || "").trim();
    if (!donorId) { errors.push(`soft credit ${i + 1}: who is it for?`); continue; }
    if (donorId === hardDonorId) { errors.push(`soft credit ${i + 1}: the person who gave already has the hard credit`); continue; }
    if (seen.has(donorId)) { errors.push(`soft credit ${i + 1}: that person is already credited on this gift`); continue; }
    seen.add(donorId);
    const c = softCreditCents(giftCents, raw);
    if (c.error) { errors.push(`soft credit ${i + 1}: ${c.error}`); continue; }
    const role = SOFT_CREDIT_ROLES.includes(raw?.role) ? raw.role : "other";
    rows.push({ donorId, cents: c.cents, pct: c.pct ?? null, role });
  }
  return { ok: errors.length === 0, errors, rows };
}

// The notice to the family. It is handed NO amount, so it cannot state one.
export function tributeNoticeBody({ notifyName, donorName, honoureeName, type, orgName, signer }) {
  const greeting = notifyName ? `Dear ${notifyName},` : "Hello,";
  const phrase = tributePhrase(type);
  const who = donorName || "Someone who cares about you";
  const lines = [
    greeting,
    "",
    `${who} has made a gift to ${orgName} ${phrase} ${honoureeName}.`,
    type === TRIBUTE_MEMORY
      ? `We are so sorry for your loss, and we are honoured that ${honoureeName} is remembered this way.`
      : `We wanted you to know that ${honoureeName} is being celebrated this way.`,
    "",
    "With gratitude,",
    signer || orgName,
  ];
  return lines.join("\n");
}

// The expected match, in cents. A ratio (1 = dollar for dollar, 2 = two for
// one) or a stated amount; the stated amount wins because it is what the
// employer's programme actually said.
export function expectedMatchCents(giftCents, { amount = null, ratio = null } = {}) {
  if (amount !== null && amount !== undefined && String(amount).trim() !== "") {
    const c = toCents(amount);
    return Number.isFinite(c) && c > 0 ? { cents: c } : { error: "an expected match greater than zero" };
  }
  const r = ratio === null || ratio === undefined || ratio === "" ? 1 : Number(ratio);
  if (!Number.isFinite(r) || r <= 0 || r > 10) return { error: "a match ratio between 0 and 10" };
  return { cents: Math.round(giftCents * r) };
}

// Hard, and hard plus soft. The second is only ever shown beside the first,
// labelled, and never replaces it.
export function creditTotals(hardCents, softCents) {
  return { hardCents, softCents, hardPlusSoftCents: hardCents + softCents };
}
