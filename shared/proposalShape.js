// shared/proposalShape.js — BUILD-99 Part 1. A PROPOSAL IS ONE ASK TO ONE
// PERSON, AND NOTHING HERE DECIDES WHAT SHE IS WORTH.
//
// ── THE TABLE THIS SITS ON IS THE ONE THAT WAS ALREADY THERE ───────────────
// BUILD-15 shipped `opportunities`: an ask amount, an expected close, an
// officer, and won/lost/open. That IS a proposal with fewer columns. Forking a
// second `proposals` table would have put two ask amounts on one prospect —
// one on the donor profile's "moves & asks" panel, one on a new Proposals
// screen — and the way those two numbers drift is a board report that is
// wrong. (Home read "Portfolio: 16" while the board rendered 3 for exactly
// this reason; BUILD-30 is the write-up.) So `opportunities` gains the columns
// a proposal needs and the product's word for it becomes "proposal". The table
// keeps its name, the way retired `donors.in_pipeline` kept its column:
// renaming a live table is a destructive migration that buys nothing.
//
// ── WHY `status` STAYS BESIDE `proposal_stage` ─────────────────────────────
// Six stages, three statuses. Every BUILD-15 read — the pipeline board's ask
// totals, `wonThisPeriod`, officer activity, the Home cards, the four
// dashboards — filters on `status`. Rather than rewrite twenty call sites into
// a stage set (and get one of them wrong), the stage is the truth a person sets
// and `statusForStage` is the ONE function that derives the status from it, so
// the two cannot disagree: there is no code path that writes one without the
// other. The suite asserts the derivation on every stage.
//
// ── WHAT THIS MODULE REFUSES TO DO ────────────────────────────────────────
// It never produces a probability, an ask amount, or a capacity. `PROBABILITIES`
// is a closed list she picks from by hand; a value not in it is refused rather
// than rounded to the nearest one, because a rounded probability is a number
// the product invented about a person. The weighted total therefore counts only
// the proposals that carry a probability SHE set, and its sentence says how
// many that was — a weighted figure that quietly treated a blank as 50% would
// be the product guessing at a gift.
//
// Pure: no DB, no network, no clock, no JSX.

// ── THE SIX STAGES ─────────────────────────────────────────────────────────
// In order. `kind` is what the stage means for the money: `open` is an ask in
// flight, `won` is a commitment on the books, `lost` is a no.
export const PROPOSAL_STAGES = [
  { key: "identified",  label: "Identified",  kind: "open", blurb: "somebody we think could give at this level" },
  { key: "cultivating", label: "Cultivating", kind: "open", blurb: "we are building the relationship" },
  { key: "asked",       label: "Asked",       kind: "open", blurb: "the ask is made and we are waiting" },
  { key: "committed",   label: "Committed",   kind: "won",  blurb: "they said yes" },
  { key: "declined",    label: "Declined",    kind: "lost", blurb: "they said no, and we wrote down why" },
  { key: "stewarding",  label: "Stewarding",  kind: "won",  blurb: "the gift is in and we are thanking and reporting" },
];
export const STAGE_KEYS = PROPOSAL_STAGES.map(s => s.key);
export const OPEN_STAGE_KEYS = PROPOSAL_STAGES.filter(s => s.kind === "open").map(s => s.key);

export const STATUS_OPEN = "open";
export const STATUS_WON = "won";
export const STATUS_LOST = "lost";

export function stageFor(key) {
  return PROPOSAL_STAGES.find(s => s.key === String(key || "").trim().toLowerCase()) || null;
}
export function stageLabel(key) {
  const s = stageFor(key);
  return s ? s.label : "";
}
export function isOpenStage(key) {
  const s = stageFor(key);
  return !!s && s.kind === "open";
}
// THE ONE DERIVATION. `status` is never written by hand anywhere.
export function statusForStage(key) {
  const s = stageFor(key);
  if (!s) return null;
  return s.kind === "open" ? STATUS_OPEN : s.kind === "won" ? STATUS_WON : STATUS_LOST;
}

// ── A ROW THAT PREDATES THIS BUILD ────────────────────────────────────────
// A BUILD-15 opportunity has a status and no stage. The reading is not a guess:
// BUILD-15's own column comment calls `target_amount` "the ASK", and its UI is
// "ask → gift" with Won/Lost buttons. An open one is therefore an ask that has
// been made — `asked` — and a won one is `committed`. This is applied ONCE, by
// the migration, so nothing downstream has to cope with a null stage, and it is
// written down here rather than inferred at twenty read sites.
export function stageFromLegacyStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === STATUS_WON) return "committed";
  if (s === STATUS_LOST) return "declined";
  return "asked";
}

// ── PROBABILITY: A CLOSED LIST SHE PICKS FROM ─────────────────────────────
// Five values, and no sixth. A free-decimal field invites 63%, which is a
// number nobody can defend in a board meeting; five steps are a judgement.
export const PROBABILITIES = [10, 25, 50, 75, 90];
export function normalizeProbability(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;          // undefined = refused
  return PROBABILITIES.includes(n) ? n : undefined;
}

// ── DECLINE REASONS: A CLOSED LIST TOO ────────────────────────────────────
// Free text here means the reason cannot be counted, and "why do we lose asks"
// is the one question a development director asks of this screen. "Something
// else" carries the note, so nothing is lost — it is just not pretending to be
// a category.
export const DECLINE_REASONS = [
  { key: "not_now",        label: "Not now — timing" },
  { key: "amount_too_big", label: "The amount was too much" },
  { key: "other_priority", label: "Giving elsewhere this year" },
  { key: "no_capacity",    label: "They told us they cannot" },
  { key: "no_response",    label: "We never heard back" },
  { key: "relationship",   label: "The relationship was not ready" },
  { key: "other",          label: "Something else (see the note)" },
];
export const DECLINE_REASON_KEYS = DECLINE_REASONS.map(r => r.key);
export function declineReasonLabel(key) {
  const r = DECLINE_REASONS.find(x => x.key === key);
  return r ? r.label : "";
}

// ── COMMITTING: A PLEDGE OR A GIFT, NEVER BOTH ────────────────────────────
// A commitment either arrived as money or it is a promise of money. Writing
// both would double it in every total, which is the BUILD-98 rule ("a gift is
// counted once") wearing a different hat.
export const COMMIT_PLEDGE = "pledge";
export const COMMIT_GIFT = "gift";
export const COMMIT_KINDS = [COMMIT_PLEDGE, COMMIT_GIFT];

export const PURPOSE_MAX = 120;
export const NOTES_MAX = 4000;

export function sanitizePurpose(raw) {
  const s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  return s.slice(0, PURPOSE_MAX);
}
export function sanitizeNotes(raw) {
  const s = String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
  return s.slice(0, NOTES_MAX);
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

// ── VALIDATION ────────────────────────────────────────────────────────────
// Returns `{ ok, errors: [{field, message}] }`. Called by the route before
// anything is written, and by the screen so the same refusal reads the same
// both sides. `mode: "create"` requires what a new proposal cannot do without;
// `mode: "patch"` validates only the fields present.
export function validateProposal(input = {}, { mode = "create" } = {}) {
  const errors = [];
  const has = k => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const need = k => mode === "create" || has(k);

  if (need("purpose")) {
    if (!sanitizePurpose(input.purpose)) errors.push({ field: "purpose", message: "Say what the ask is for." });
  }
  if (need("askCents")) {
    const c = Number(input.askCents);
    if (!Number.isInteger(c) || c <= 0) errors.push({ field: "askCents", message: "A positive ask amount is required." });
  }
  if (need("expectedClose")) {
    if (!CIVIL.test(String(input.expectedClose || ""))) {
      errors.push({ field: "expectedClose", message: "An expected close date is required, as YYYY-MM-DD." });
    }
  }
  if (need("stage")) {
    if (!stageFor(input.stage)) {
      errors.push({ field: "stage", message: `Stage must be one of: ${PROPOSAL_STAGES.map(s => s.label).join(", ")}.` });
    }
  }
  if (has("probability")) {
    if (normalizeProbability(input.probability) === undefined) {
      errors.push({ field: "probability", message: `Probability must be one of ${PROBABILITIES.join(", ")} — or left blank.` });
    }
  }
  // A declined proposal owes a reason and a date. The stage is not a feeling;
  // it is the row a "why do we lose asks" report reads.
  const stage = has("stage") ? String(input.stage || "").toLowerCase() : null;
  if (stage === "declined") {
    if (!DECLINE_REASON_KEYS.includes(String(input.declineReason || ""))) {
      errors.push({ field: "declineReason", message: "A declined proposal needs a reason from the list." });
    }
    if (input.declinedOn !== undefined && input.declinedOn !== null && String(input.declinedOn).trim() !== ""
        && !CIVIL.test(String(input.declinedOn))) {
      errors.push({ field: "declinedOn", message: "The declined date must be YYYY-MM-DD." });
    }
  }
  if (stage === "committed" || stage === "stewarding") {
    if (has("commitKind") && !COMMIT_KINDS.includes(String(input.commitKind))) {
      errors.push({ field: "commitKind", message: "A commitment is recorded as a pledge or as a gift." });
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── REOPENING A DECLINE ───────────────────────────────────────────────────
// "Declined … never reopens silently" — so it reopens LOUDLY, or not at all.
// The route asks this, and a caller who did not say so gets a refusal naming
// the field, never a quiet stage change.
export function declineReopenRefusal(fromStage, toStage, { acknowledged } = {}) {
  if (String(fromStage) !== "declined") return null;
  if (!isOpenStage(toStage)) return null;
  if (acknowledged === true) return null;
  return {
    code: "decline_reopen_unacknowledged",
    message: "This proposal was declined. Reopening it keeps the decline on the record — confirm to go ahead.",
  };
}

// ── THE WEIGHTED TOTAL, AND THE SENTENCE IT MAY NOT APPEAR WITHOUT ────────
// Σ ask × probability, over the OPEN proposals that carry a probability she
// set. A proposal with no probability is counted in `unset` and excluded from
// the money — never defaulted, never averaged.
export function weightedTotal(proposals = []) {
  let cents = 0, counted = 0, unset = 0, askCents = 0;
  for (const p of proposals) {
    if (!isOpenStage(p.stage)) continue;
    const ask = Number(p.askCents) || 0;
    askCents += ask;
    const prob = normalizeProbability(p.probability);
    if (prob === null || prob === undefined) { unset++; continue; }
    // Integer cents throughout: round half up once, at the end of each row,
    // so the total is the sum of what each row shows.
    cents += Math.round((ask * prob) / 100);
    counted++;
  }
  return { cents, counted, unset, openCount: counted + unset, askCents };
}

// The sentence is part of the number. `formatMoney` is injected because the
// money formatter is CommonJS at the repo root and this module is ESM — the
// same seam every other shared module uses.
export function weightedSentence(w, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  if (!w || w.openCount === 0) return "No open proposals yet.";
  if (w.counted === 0) {
    return `${w.openCount} open ${w.openCount === 1 ? "proposal" : "proposals"}, none with a probability set yet — so there is no weighted total.`;
  }
  const head = `${fm(w.cents)} weighted, from ${w.counted} ${w.counted === 1 ? "proposal" : "proposals"} at the probabilities you set.`;
  if (w.unset === 0) return head;
  return `${head} ${w.unset} more ${w.unset === 1 ? "has" : "have"} no probability yet and ${w.unset === 1 ? "is" : "are"} not in this figure.`;
}

// ── THE PIPELINE, BY STAGE ────────────────────────────────────────────────
// Dollars and count per stage, in stage order, every stage present so an empty
// column is visibly empty rather than missing.
export function pipelineByStage(proposals = []) {
  const rows = PROPOSAL_STAGES.map(s => ({ stage: s.key, label: s.label, kind: s.kind, count: 0, askCents: 0 }));
  const byKey = new Map(rows.map(r => [r.stage, r]));
  for (const p of proposals) {
    const r = byKey.get(String(p.stage || "").toLowerCase());
    if (!r) continue;
    r.count++;
    r.askCents += Number(p.askCents) || 0;
  }
  return rows;
}

export function stageTileSentence(row, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  if (!row) return "";
  const n = row.count;
  if (n === 0) return `No proposals at ${row.label} — ${stageFor(row.stage)?.blurb || ""}.`;
  return `${fm(row.askCents)} asked for across ${n} ${n === 1 ? "proposal" : "proposals"} at ${row.label}: ${stageFor(row.stage)?.blurb || ""}.`;
}

// ── "ONE OPEN AT A TIME PER FUND" ─────────────────────────────────────────
// The rule exists to stop two officers asking the same household for the same
// thing. So the test is at the HOUSEHOLD, not the person: asking a husband and
// a wife separately for the capital campaign is exactly the double-ask this
// prevents. `groupKey` is the household id when there is one and the donor id
// when there is not; the caller supplies it, because only the server knows the
// household.
export function conflictRefusal(existing = [], { groupKey, fundId, excludeId } = {}) {
  const fund = fundId || "";
  const hit = existing.find(p =>
    p.id !== excludeId && isOpenStage(p.stage) &&
    String(p.groupKey || "") === String(groupKey || "") &&
    String(p.fundId || "") === String(fund));
  if (!hit) return null;
  return {
    code: "proposal_already_open",
    message: hit.sameHousehold
      ? `${hit.donorName || "Somebody in this household"} already has an open proposal for this ${hit.fundLabel || "fund"}. Close or move that one first.`
      : `There is already an open proposal for this ${hit.fundLabel || "fund"}. Close or move that one first.`,
    conflictId: hit.id,
  };
}

// ── SORTING THE LIST ──────────────────────────────────────────────────────
// Expected date first is the default because the question the screen answers is
// "what is landing when". A missing date sorts LAST, never as the epoch.
export function sortProposals(rows = [], key = "expected") {
  const out = rows.slice();
  const dateKey = p => (CIVIL.test(String(p.expectedClose || "")) ? String(p.expectedClose) : "9999-12-31");
  if (key === "amount") out.sort((a, b) => (Number(b.askCents) || 0) - (Number(a.askCents) || 0) || dateKey(a).localeCompare(dateKey(b)));
  else if (key === "stage") out.sort((a, b) => STAGE_KEYS.indexOf(a.stage) - STAGE_KEYS.indexOf(b.stage) || dateKey(a).localeCompare(dateKey(b)));
  else out.sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || (Number(b.askCents) || 0) - (Number(a.askCents) || 0));
  return out;
}
