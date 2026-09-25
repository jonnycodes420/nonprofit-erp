// shared/grantShape.js — BUILD-100 (grants) Part 1. A FUNDER IS A RECORD, AND
// A GRANT IS ONE REQUEST TO ONE OF THEM.
//
// ── WHY THERE IS NO SECOND STATUS COLUMN ──────────────────────────────────
// `grants.status` already exists and already has a vocabulary that twenty
// places read: `statusToCol` on the Kanban, `GRANT_ACTIONABLE` behind the
// honest-overdue rule, the award→ledger stamp, the reports. The brief names six
// statuses. Rather than add `grant_stage` beside `status` — which is the shape
// BUILD-99 had to accept for `opportunities` and would be gratuitous here — this
// module makes the six CANONICAL and treats the older spellings as ALIASES of
// them. `normalizeStatus` is the one place that mapping lives, so a legacy
// `prospecting` row and a new `researching` one are the same thing everywhere,
// and nothing has to be rewritten to find that out.
//
// ── AND THE RULE THAT CANNOT BEND ─────────────────────────────────────────
// A PERSON IS NEVER A FUNDER. A grant is an institutional relationship; a
// cheque from a private individual is a GIFT, and the two are counted, reported
// and acknowledged differently. `funderProblem` refuses a person by name, and
// the route refuses with it — not because a person cannot give, but because
// calling their gift a grant puts it in the wrong half of every report an
// auditor reads.
//
// Pure: no DB, no network, no clock, no JSX.

// ── THE SIX STATUSES ───────────────────────────────────────────────────────
// `kind`: `open` is live in the pipeline, `won` is money promised, `lost` is a
// no, `done` is finished and out of the way.
export const GRANT_STATUSES = [
  { key: "researching", label: "Researching", kind: "open", blurb: "we are working out whether to ask" },
  { key: "loi",         label: "LOI",         kind: "open", blurb: "a letter of inquiry is with them" },
  { key: "submitted",   label: "Submitted",   kind: "open", blurb: "the proposal is in and we are waiting" },
  { key: "awarded",     label: "Awarded",     kind: "won",  blurb: "they said yes" },
  { key: "declined",    label: "Declined",    kind: "lost", blurb: "they said no, and we wrote down why" },
  { key: "closed",      label: "Closed",      kind: "done", blurb: "reported on and finished" },
];
export const STATUS_KEYS = GRANT_STATUSES.map(s => s.key);
export const OPEN_STATUS_KEYS = GRANT_STATUSES.filter(s => s.kind === "open").map(s => s.key);

// The older spellings this table has carried. Each maps to the canonical status
// that means the same thing — never to a guess.
export const STATUS_ALIASES = {
  prospecting: "researching",
  research: "researching",
  applied: "submitted",
  draft: "submitted",
  pending: "submitted",
  rejected: "declined",
  lost: "declined",
  active: "awarded",        // an awarded grant being delivered is still awarded
  complete: "closed",
  completed: "closed",
};

export function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (STATUS_KEYS.includes(s)) return s;
  return STATUS_ALIASES[s] || null;
}
export function statusFor(key) {
  const k = normalizeStatus(key);
  return k ? GRANT_STATUSES.find(s => s.key === k) : null;
}
export function statusLabel(key) { const s = statusFor(key); return s ? s.label : ""; }
export function isOpenStatus(key) { const s = statusFor(key); return !!s && s.kind === "open"; }
export function isAwarded(key) { return normalizeStatus(key) === "awarded"; }

// ── WHO A FUNDER MAY BE ────────────────────────────────────────────────────
export const FUNDER_TYPES = [
  { key: "private_foundation",   label: "Private foundation" },
  { key: "community_foundation", label: "Community foundation" },
  { key: "corporate",            label: "Corporate" },
  { key: "government",           label: "Government" },
  { key: "church",               label: "Church" },
  { key: "daf_sponsor",          label: "DAF sponsor" },
];
export const FUNDER_TYPE_KEYS = FUNDER_TYPES.map(t => t.key);
export function funderTypeLabel(key) {
  const t = FUNDER_TYPES.find(x => x.key === key);
  return t ? t.label : "";
}

// THE REFUSAL, BY NAME. `donor` is `{id, name, kind}` as the row holds it.
// BUILD-80 made `kind` explicit and NULL-tolerant (a legacy row reads as a
// person), and that default is the safe one here: an unmigrated row is refused
// rather than quietly accepted as an institution.
export function funderProblem(donor) {
  if (!donor) return { code: "funder_not_found", message: "That funder is not on file." };
  const kind = String(donor.kind || "person").toLowerCase();
  if (kind !== "organisation" && kind !== "organization") {
    return {
      code: "funder_must_be_an_organisation",
      message: `${donor.name || "That record"} is a person. A grant is a request to an institution — a cheque from an individual is a gift, and counting it as a grant puts it in the wrong half of every report. Add the foundation as an organisation and link them as its program officer.`,
    };
  }
  return null;
}

// ── RESTRICTION ────────────────────────────────────────────────────────────
// What the money is allowed to be spent on. Time-restricted is the one that
// carries dates, and it is the one an auditor asks about.
export const RESTRICTIONS = [
  { key: "unrestricted",       label: "Unrestricted",        dated: false, restricted: false,
    blurb: "the organisation decides where it goes" },
  { key: "program_restricted", label: "Program-restricted",  dated: false, restricted: true,
    blurb: "it must be spent on the programme named in the proposal" },
  { key: "capital",            label: "Capital",             dated: false, restricted: true,
    blurb: "it must be spent on the building or the equipment it was given for" },
  { key: "time_restricted",    label: "Time-restricted",     dated: true,  restricted: true,
    blurb: "it may not be spent before the release date" },
];
export const RESTRICTION_KEYS = RESTRICTIONS.map(r => r.key);
export function restrictionFor(key) {
  return RESTRICTIONS.find(r => r.key === String(key || "").trim().toLowerCase()) || null;
}
export function restrictionLabel(key) { const r = restrictionFor(key); return r ? r.label : ""; }
export function isRestricted(key) { const r = restrictionFor(key); return !!r && r.restricted; }

// ── DECLINE REASONS ────────────────────────────────────────────────────────
// A closed list, for the same reason BUILD-99's is: "why do we lose grants" is
// the question this screen exists to answer, and free text cannot be counted.
// "Something else" carries the note rather than pretending to be a category.
export const DECLINE_REASONS = [
  { key: "not_a_fit",        label: "Not a fit for their priorities" },
  { key: "too_many_asks",    label: "More requests than money" },
  { key: "already_funded",   label: "They funded something similar" },
  { key: "geography",        label: "Outside their geography" },
  { key: "capacity_concern", label: "They had concerns about our capacity" },
  { key: "late_or_ineligible", label: "Late or ineligible" },
  { key: "no_reason_given",  label: "They gave no reason" },
  { key: "other",            label: "Something else (see the note)" },
];
export const DECLINE_REASON_KEYS = DECLINE_REASONS.map(r => r.key);
export function declineReasonLabel(key) {
  const r = DECLINE_REASONS.find(x => x.key === key);
  return r ? r.label : "";
}

export const PROGRAM_MAX = 120;
export const CYCLE_MAX = 80;
export const NOTES_MAX = 4000;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeProgram(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, PROGRAM_MAX);
}
export function sanitizeCycle(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, CYCLE_MAX);
}
export function sanitizeNotes(raw) {
  return String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim().slice(0, NOTES_MAX);
}

// ── VALIDATION ─────────────────────────────────────────────────────────────
// `mode: "create"` requires what a new grant cannot do without; `"patch"`
// validates only what is present.
export function validateGrant(input = {}, { mode = "create" } = {}) {
  const errors = [];
  const has = k => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const need = k => mode === "create" || has(k);

  if (need("program")) {
    if (!sanitizeProgram(input.program)) {
      errors.push({ field: "program", message: "Say what the grant is for — the programme, in your own words." });
    }
  }
  if (need("amountRequestedCents")) {
    const c = Number(input.amountRequestedCents);
    if (!Number.isInteger(c) || c <= 0) {
      errors.push({ field: "amountRequestedCents", message: "A positive amount requested is required." });
    }
  }
  if (need("status")) {
    if (!statusFor(input.status)) {
      errors.push({ field: "status", message: `Status must be one of: ${GRANT_STATUSES.map(s => s.label).join(", ")}.` });
    }
  }
  if (has("restriction") && input.restriction !== null && String(input.restriction).trim() !== "") {
    const r = restrictionFor(input.restriction);
    if (!r) {
      errors.push({ field: "restriction", message: `Restriction must be one of: ${RESTRICTIONS.map(x => x.label).join(", ")}.` });
    } else if (r.dated) {
      // TIME-RESTRICTED MONEY WITHOUT ITS DATES IS THE ONE THAT MATTERS. The
      // whole point of the restriction is the day the money is released; a row
      // that claims it without one cannot answer the question it exists for.
      if (!CIVIL.test(String(input.restrictedUntil || ""))) {
        errors.push({ field: "restrictedUntil",
          message: "Time-restricted money needs the date it is released, as YYYY-MM-DD. That date is the whole restriction." });
      }
      if (input.restrictedFrom !== undefined && input.restrictedFrom !== null && String(input.restrictedFrom).trim() !== ""
          && !CIVIL.test(String(input.restrictedFrom))) {
        errors.push({ field: "restrictedFrom", message: "The start of the restricted period must be YYYY-MM-DD." });
      }
      if (CIVIL.test(String(input.restrictedFrom || "")) && CIVIL.test(String(input.restrictedUntil || ""))
          && String(input.restrictedUntil) < String(input.restrictedFrom)) {
        errors.push({ field: "restrictedUntil", message: "The release date cannot be before the period starts." });
      }
    }
  }
  const status = has("status") ? normalizeStatus(input.status) : null;
  if (status === "awarded") {
    const c = Number(input.amountAwardedCents);
    if (input.amountAwardedCents !== undefined && (!Number.isInteger(c) || c <= 0)) {
      errors.push({ field: "amountAwardedCents", message: "An awarded grant needs the amount they actually awarded." });
    }
  }
  if (status === "declined") {
    if (!DECLINE_REASON_KEYS.includes(String(input.declineReason || ""))) {
      errors.push({ field: "declineReason", message: "A declined grant needs a reason from the list." });
    }
    if (input.declinedOn !== undefined && input.declinedOn !== null && String(input.declinedOn).trim() !== ""
        && !CIVIL.test(String(input.declinedOn))) {
      errors.push({ field: "declinedOn", message: "The declined date must be YYYY-MM-DD." });
    }
    if (input.reapply !== undefined && input.reapply !== null && typeof input.reapply !== "boolean") {
      errors.push({ field: "reapply", message: "Whether to reapply is yes or no." });
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── THE PIPELINE ───────────────────────────────────────────────────────────
// By status, in dollars and count, every status present so an empty column is
// visibly empty rather than missing. An OPEN row is counted at what was
// REQUESTED; an awarded one at what was AWARDED, because that is the number
// that is real once they have said yes.
export function pipelineByStatus(grants = []) {
  const rows = GRANT_STATUSES.map(s => ({ status: s.key, label: s.label, kind: s.kind, count: 0, cents: 0 }));
  const byKey = new Map(rows.map(r => [r.status, r]));
  for (const g of grants) {
    const k = normalizeStatus(g.status);
    const r = k ? byKey.get(k) : null;
    if (!r) continue;
    r.count++;
    r.cents += pipelineCentsFor(g);
  }
  return rows;
}

export function pipelineCentsFor(g) {
  const k = normalizeStatus(g && g.status);
  const awarded = Number((g && g.amountAwardedCents) || 0);
  const requested = Number((g && g.amountRequestedCents) || 0);
  if (k === "awarded" || k === "closed") return awarded || requested;
  if (k === "declined") return requested;
  return requested;
}

export function statusTileSentence(row, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  if (!row) return "";
  const s = statusFor(row.status);
  if (row.count === 0) return `No grants at ${row.label} — ${s ? s.blurb : ""}.`;
  const money = row.kind === "won" ? "awarded" : "requested";
  return `${fm(row.cents)} ${money} across ${row.count} ${row.count === 1 ? "grant" : "grants"} at ${row.label}: ${s ? s.blurb : ""}.`;
}

// The open pipeline is what has been ASKED FOR and not yet answered. It is
// deliberately NOT called a forecast: nobody here has put a probability on a
// foundation's decision, and a weighted grant pipeline would be the product
// inventing one.
export function openPipelineSentence({ cents, count }, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  const n = Number(count) || 0;
  if (n === 0) return "Nothing is with a funder right now.";
  return `${fm(cents)} requested across ${n} open ${n === 1 ? "grant" : "grants"} — what you have asked for, not what anybody expects to land.`;
}

// ── SORTING ────────────────────────────────────────────────────────────────
// By next deadline is the default, because the question the screen answers is
// "what is due". A grant with no dated deadline sorts LAST, never as the epoch.
export function sortGrants(rows = [], key = "deadline") {
  const out = rows.slice();
  const dl = g => (CIVIL.test(String(g.nextDeadline || "")) ? String(g.nextDeadline) : "9999-12-31");
  if (key === "amount") out.sort((a, b) => pipelineCentsFor(b) - pipelineCentsFor(a) || dl(a).localeCompare(dl(b)));
  else if (key === "funder") out.sort((a, b) => String(a.funderName || "").localeCompare(String(b.funderName || "")) || dl(a).localeCompare(dl(b)));
  else if (key === "status") out.sort((a, b) => STATUS_KEYS.indexOf(normalizeStatus(a.status)) - STATUS_KEYS.indexOf(normalizeStatus(b.status)) || dl(a).localeCompare(dl(b)));
  else out.sort((a, b) => dl(a).localeCompare(dl(b)) || pipelineCentsFor(b) - pipelineCentsFor(a));
  return out;
}
