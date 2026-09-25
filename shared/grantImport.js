// shared/grantImport.js — BUILD-100 (grants) Part 6. READING SOMEBODY ELSE'S
// GRANT SPREADSHEET.
//
// ── IT IS A PRESET ON THE MAPPER, NEVER A SECOND IMPORTER ──────────────────
// The 89d rule, applied a fourth time (Mailchimp, the statement presets, NPSP,
// and now this): a source-specific file becomes the vocabulary Steward already
// speaks, and ONE write path lands it. A second importer is a second place for
// a column to go missing, and the first three builds that were tempted into one
// each paid for it.
//
// ── A FUNDER IS AN ORGANISATION, AND A NAME MATCH MAY NOT LAND ON A PERSON ──
// Part 1's rule with teeth. An institution's name is often a person's name —
// "The Margaret Chen Trust", "Stern Family Foundation", and plainly "Margaret
// Chen" where a major donor's own record already exists. Matching a grant to
// that person's record would put institutional money on a human being's giving
// history and in the wrong half of every report, permanently and invisibly.
//
// So `matchFunder` will match an ORGANISATION and will never match a PERSON. A
// row whose only candidate is a person is REFUSED BY NAME, and the file's own
// line number is reported, because the fix is a human deciding whether that is
// the same entity — not a guess made at three in the morning by an importer.
//
// ── EIN BEATS NAME ─────────────────────────────────────────────────────────
// Where a file carries the funder's EIN, that is the only identifier in this
// whole domain that is actually unique. Normalised to nine digits and matched
// first; a name match is the fallback, on TOKENS (the BUILD-84 census rule).
//
// AND THE ENTITY TYPE IS PART OF THE NAME, NOT NOISE. The first cut of the name
// key stripped "foundation", "trust" and "fund" along with "Inc." — which made
// the Sunrise Foundation and the Sunrise Trust ONE funder, and every grant from
// either would have landed on whichever record was created first. Only the
// interchangeable corporate form is dropped ("the", "inc", "llc"); an entity-type
// word is KEPT and its abbreviation normalised, so "The Sunrise Fdn., Inc."
// finds "Sunrise Foundation" and "Sunrise Trust" stays a different funder.
//
// ── AN IMPORTED FILE IS HISTORY, AND RAISES NOTHING ────────────────────────
// A deadline column becomes the grant's own deadline and NO MILESTONE IS
// CREATED (BUILD-81's rule, and BUILD-83's): a report due last March is not a
// thread somebody has to close this morning, and an import that opens forty
// follow-ups is an import nobody will run twice. Part 2's milestones are raised
// when a human awards or advances a grant, from that moment forward.
//
// Pure: no DB, no network, no clock, no JSX. Every date is a civil date; every
// amount leaves here as INTEGER CENTS.

import { normalizeHeader, headerTokens } from "./importShape.js";
import { normalizeStatus, STATUS_KEYS, RESTRICTION_KEYS, DECLINE_REASON_KEYS,
         sanitizeProgram, sanitizeCycle, sanitizeNotes } from "./grantShape.js";

const norm = h => normalizeHeader(String(h || ""));
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

// ── THE SOURCES ────────────────────────────────────────────────────────────
// Each is a spreadsheet a real office exports, and each names its own columns.
// `confidence` is stated the way BUILD-89S's adapters state theirs: "documented"
// where the vendor publishes the field, "reported" where the spelling comes from
// a real file somebody described, "unconfirmed" where it is an informed guess.
// A wrong guess is then an edit to ONE table and a suite that fails by column
// name — never a file importing quietly wrong.
export const GRANT_SOURCES = [
  { key: "generic", label: "A grant spreadsheet", confidence: "documented",
    note: "Your own tracker. Steward reads the columns it recognises and names the ones it does not." },
  { key: "npsp", label: "Salesforce NPSP (Opportunities, record type Grant)", confidence: "documented",
    note: "An Opportunity whose record type is Grant. Closed Won is an award; Closed Lost is a decline." },
  { key: "bloomerang", label: "Bloomerang (Grants)", confidence: "reported",
    note: "Bloomerang files grants as a transaction type; the transaction's own status carries the stage." },
  { key: "instrumentl", label: "Instrumentl", confidence: "reported",
    note: "A prospecting and tracking tool, so its files are mostly researching and submitted rows." },
  { key: "submittable", label: "Submittable", confidence: "unconfirmed",
    note: "An application portal. Its export is per-application, and the decision is the status." },
];
export const GRANT_SOURCE_KEYS = GRANT_SOURCES.map(s => s.key);
export function grantSource(key) { return GRANT_SOURCES.find(s => s.key === key) || null; }

// ── THE COLUMNS ────────────────────────────────────────────────────────────
// Candidate spellings per field, most likely first, merged across the sources —
// because which spelling a file carries depends on how somebody exported it, and
// that is not a thing to make a fundraiser answer for. THE KEYS ARE THE GRANT'S
// OWN FIELD NAMES (Part 1's), not a third vocabulary: a translation layer is
// where a column goes missing.
export const GRANT_COLUMNS = {
  funderName: ["funder", "funder name", "foundation", "foundation name", "grantor",
               "account name", "organization name", "organisation name", "company",
               "opportunity account", "grantmaker", "funder organization",
               "constituent", "constituent name", "account", "donor", "payer"],
  funderEin: ["ein", "funder ein", "tax id", "taxid", "federal tax id", "employer identification number"],
  program: ["program", "programme", "project", "purpose", "grant name", "opportunity name",
            "application", "request", "grant title", "project name"],
  amountRequested: ["amount requested", "requested", "request amount", "ask", "ask amount",
                    "amount", "opportunity amount", "grant amount requested", "requested amount"],
  amountAwarded: ["amount awarded", "awarded", "award amount", "amount received", "funded amount",
                  "grant awarded", "amount granted"],
  status: ["status", "stage", "grant status", "opportunity stage", "application status",
           "transaction status", "decision", "award status", "submission status",
           "stagename", "grant stage"],
  deadline: ["deadline", "due date", "application deadline", "submission deadline", "close date",
             "proposal due", "next deadline"],
  submittedOn: ["submitted", "date submitted", "submitted on", "application date", "date applied"],
  decidedOn: ["decision date", "decided", "date decided", "awarded on", "award date", "notified"],
  reportDue: ["report due", "report deadline", "reporting due", "next report"],
  restriction: ["restriction", "restricted", "designation", "fund restriction", "purpose type"],
  fundName: ["fund", "designation fund", "gl fund", "fund name", "restricted to"],
  officerName: ["officer", "owner", "assigned to", "grant writer", "responsible", "opportunity owner"],
  cycleName: ["cycle", "grant cycle", "round", "funding cycle", "fiscal year", "fy"],
  declineReason: ["decline reason", "reason declined", "rejection reason", "loss reason", "why declined"],
  externalId: ["grant id", "id", "record id", "opportunity id", "transaction id", "application id", "reference"],
  notes: ["notes", "note", "description", "comments", "internal notes"],
};
export const GRANT_FIELD_KEYS = Object.keys(GRANT_COLUMNS);

// A header may only claim a field when it matches a candidate spelling WHOLE.
// `headerTokens` normalises to tokens first (the underscore lesson: `\b` does
// not fire at one), so "fiscal_year" reads as the cycle and "ein_verified" does
// not claim the EIN.
export function fieldForHeader(header) {
  const tokens = headerTokens(header).join(" ");
  if (!tokens) return null;
  let best = null;
  for (const [field, spellings] of Object.entries(GRANT_COLUMNS)) {
    for (const s of spellings) {
      const want = headerTokens(s).join(" ");
      if (!want) continue;
      // EXACT token-run equality only. A substring rule would let "amount
      // requested last year" claim the amount, and the longest-spelling
      // preference below is what settles "amount" against "amount awarded".
      if (tokens === want && (!best || want.length > best.len)) best = { field, len: want.length };
    }
  }
  return best ? best.field : null;
}

// The matched spelling's length, so the more SPECIFIC header wins a contested
// field. Returned beside the field because the write path needs to know which
// spelling matched — see `requestedIsExplicit` below.
function headerMatch(header) {
  const tokens = headerTokens(header).join(" ");
  if (!tokens) return null;
  let best = null;
  for (const [field, spellings] of Object.entries(GRANT_COLUMNS)) {
    for (const sp of spellings) {
      const want = headerTokens(sp).join(" ");
      if (want && tokens === want && (!best || want.length > best.len)) best = { field, len: want.length, spelling: want };
    }
  }
  return best;
}

export function grantMapping(headers = []) {
  const mapping = {}, spellings = {}, unrecognised = [];
  const best = {};                       // field → {header, len}
  for (const h of headers) {
    const m = headerMatch(h);
    if (!m) { if (String(h || "").trim()) unrecognised.push({ header: h, why: "Steward does not recognise this column" }); continue; }
    // THE MORE SPECIFIC HEADER WINS, and the other is REPORTED rather than
    // silently dropped. "Amount" and "Amount Requested" in one file is a real
    // shape, and taking whichever came first read the vaguer column — which on
    // an NPSP export is the difference between an award and an ask.
    if (!best[m.field] || m.len > best[m.field].len) {
      if (best[m.field]) unrecognised.push({ header: best[m.field].header, why: `a more specific column is mapped to ${m.field}` });
      best[m.field] = { header: h, len: m.len, spelling: m.spelling };
    } else {
      unrecognised.push({ header: h, why: `a more specific column is mapped to ${m.field}` });
    }
  }
  for (const [f, v] of Object.entries(best)) { mapping[f] = v.header; spellings[f] = v.spelling; }
  return { mapping, spellings, unrecognised, mappedCount: Object.keys(mapping).length };
}

// ── WHAT AN "AMOUNT" COLUMN MEANS ON AN AWARDED ROW ────────────────────────
// A column headed "Amount Requested" does NOT say what a funder awarded, so an
// awarded row with only that column is demoted (see buildGrantRows). But a plain
// "Amount" on a Closed Won opportunity or an Approved Bloomerang transaction IS
// the money — that is what those tools mean by it. The rule is therefore about
// the SPELLING that matched, not about the vendor: evidence in the header row,
// the way every other decision in this module is made.
const REQUESTED_WORDS = new Set(["requested", "request", "ask"]);
export function requestedIsExplicit(spelling) {
  return headerTokens(spelling || "").some(t => REQUESTED_WORDS.has(t));
}

// ── DETECTION ──────────────────────────────────────────────────────────────
// Evidence in the HEADERS, never the filename. Each source is scored on the
// columns only it writes; a tie or no evidence is `generic`, which is the honest
// answer and still reads the file.
const SOURCE_SIGNATURES = {
  npsp: ["opportunity name", "opportunity stage", "opportunity owner", "opportunity amount",
         "stagename", "recordtypeid", "npsp grant", "account name"],
  bloomerang: ["transaction status", "transaction id", "constituent", "constituent id",
               "designation fund", "transaction type"],
  instrumentl: ["funder", "next deadline", "tracker", "saved opportunity", "instrumentl",
                "award status", "grantmaker"],
  submittable: ["submission id", "submission status", "form name", "submittable", "label",
                "application status"],
};
export function detectGrantSource(headers = []) {
  const set = new Set(headers.map(h => headerTokens(h).join(" ")).filter(Boolean));
  const scores = Object.entries(SOURCE_SIGNATURES).map(([key, sig]) => ({
    key, hits: sig.filter(s => set.has(headerTokens(s).join(" "))).length,
  })).sort((a, b) => b.hits - a.hits);
  const top = scores[0];
  // TWO HITS is the floor: one shared column ("Account Name", "Label") is not
  // evidence of a vendor, and a wrong preset is worse than none.
  if (!top || top.hits < 2 || (scores[1] && scores[1].hits === top.hits)) {
    return { source: "generic", hits: top ? top.hits : 0, why: "no vendor's own columns in the header row" };
  }
  return { source: top.key, hits: top.hits,
           why: `${top.hits} columns only ${grantSource(top.key).label} writes` };
}

// ── STATUS ─────────────────────────────────────────────────────────────────
// Each source's vocabulary onto Part 1's six, which are canonical. A word the
// tables do not know falls back to `researching` and is COUNTED — the BUILD-99
// rule, because a default that is silent is a file importing wrong.
export const SOURCE_STATUS = {
  npsp: {
    prospecting: "researching", qualification: "researching", "needs analysis": "researching",
    "value proposition": "loi", "id decision makers": "loi",
    "perception analysis": "submitted", "proposal price quote": "submitted",
    "negotiation review": "submitted", proposal: "submitted", negotiation: "submitted",
    "closed won": "awarded", "closed lost": "declined", pledged: "awarded", promised: "awarded",
  },
  bloomerang: {
    prospect: "researching", applied: "submitted", pending: "submitted", submitted: "submitted",
    approved: "awarded", received: "awarded", paid: "awarded", awarded: "awarded",
    declined: "declined", rejected: "declined", denied: "declined",
    completed: "closed", closed: "closed",
  },
  instrumentl: {
    tracking: "researching", researching: "researching", saved: "researching",
    "loi submitted": "loi", loi: "loi", "in progress": "loi", drafting: "loi",
    applied: "submitted", submitted: "submitted", "awaiting decision": "submitted",
    awarded: "awarded", funded: "awarded", declined: "declined", "not funded": "declined",
    closed: "closed",
  },
  submittable: {
    "in progress": "loi", draft: "loi", submitted: "submitted", "in review": "submitted",
    received: "submitted", accepted: "awarded", approved: "awarded", awarded: "awarded",
    declined: "declined", rejected: "declined", withdrawn: "closed", closed: "closed",
  },
  generic: {},
};
export function statusFromSource(raw, source = "generic") {
  const v = String(raw == null ? "" : raw).trim().toLowerCase().replace(/[\s_/-]+/g, " ");
  if (!v) return { status: "researching", read: false, raw: "" };
  // Steward's OWN vocabulary first, so a file exported FROM Steward round-trips.
  const own = normalizeStatus(v);
  if (own && STATUS_KEYS.includes(own)) return { status: own, read: true, raw: v };
  const table = SOURCE_STATUS[source] || {};
  if (table[v]) return { status: table[v], read: true, raw: v };
  // A source's table is tried, then every other source's — a file exported from
  // one tool by way of another carries both vocabularies, and refusing the row
  // over that would be pedantry rather than care.
  for (const k of Object.keys(SOURCE_STATUS)) {
    if (SOURCE_STATUS[k][v]) return { status: SOURCE_STATUS[k][v], read: true, raw: v, via: k };
  }
  return { status: "researching", read: false, raw: v };
}

// ── THE FUNDER ─────────────────────────────────────────────────────────────
export function normalizeEin(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D+/g, "");
  return digits.length === 9 ? digits : null;
}
// The interchangeable corporate form, dropped so one office's "Inc." is not a
// different funder from another's. NOTHING that names the KIND of institution is
// in here — see the note above.
const CORPORATE_FORM = new Set(["the", "a", "inc", "incorporated", "llc", "llp", "lp",
  "ltd", "limited", "co", "corp", "corporation", "and", "of"]);
// Abbreviations a real file writes, normalised to the word they stand for, so a
// spelling difference is not a second funder.
const FORM_SYNONYM = {
  fdn: "foundation", fdtn: "foundation", found: "foundation", fnd: "fund",
  charities: "charitable", philanthropies: "philanthropy", tr: "trust",
  intl: "international", assoc: "association", assn: "association", univ: "university",
};
export function funderNameKey(raw) {
  const tokens = headerTokens(raw)
    .map(t => FORM_SYNONYM[t] || t)
    .filter(t => !CORPORATE_FORM.has(t));
  // If dropping the corporate form leaves nothing, the name WAS the form ("The
  // Company") — keep it whole rather than matching every such name to each other.
  const use = tokens.length ? tokens : headerTokens(raw).map(t => FORM_SYNONYM[t] || t);
  return use.join(" ");
}

export const FUNDER_IS_A_PERSON =
  "That name is on file as a person, not an organisation. A grant is a request to an institution, "
  + "and putting it on somebody's own record would move institutional money onto their giving history. "
  + "Add the funder as an organisation, or link the person as its programme officer.";

// `candidates` is what Steward looked up: {id, name, kind, funderEin}. The match
// is EIN, then name, and it NEVER returns a person.
export function matchFunder({ name, ein } = {}, candidates = []) {
  const e = normalizeEin(ein);
  const isOrg = d => {
    const k = String(d.kind || "person").toLowerCase();
    return k === "organisation" || k === "organization";
  };
  if (e) {
    const byEin = candidates.filter(d => normalizeEin(d.funderEin) === e);
    const org = byEin.find(isOrg);
    if (org) return { donorId: org.id, how: "ein", ein: e };
    if (byEin.length) return { donorId: null, how: null, refused: "funder_is_a_person", person: byEin[0].name };
  }
  const key = funderNameKey(name);
  if (!key) return { donorId: null, how: null, refused: "funder_not_named" };
  const byName = candidates.filter(d => funderNameKey(d.name) === key);
  const org = byName.find(isOrg);
  if (org) return { donorId: org.id, how: "name", ein: e };
  // A NAME THAT ONLY MATCHES A PERSON IS REFUSED, not resolved and not quietly
  // turned into a second record with the same name — a human decides whether
  // "Margaret Chen" the donor is "The Margaret Chen Trust".
  if (byName.length) return { donorId: null, how: null, refused: "funder_is_a_person", person: byName[0].name };
  return { donorId: null, how: null, create: { name: String(name).trim(), ein: e } };
}

// ── READING A ROW ──────────────────────────────────────────────────────────
// `cell(row, field)` is supplied by the caller so this module never needs to
// know whether a row is an array, an object or a sheet. `money` is the ONE money
// seam (root money.js) passed in, so nothing here parses a currency itself.
export function buildGrantRows(rows = [], { mapping = {}, spellings = {}, source = "generic",
                                            cell, money, today = null } = {}) {
  // Does the file SAY the amount is what was asked for? If it does, an awarded
  // row carrying only that column is demoted rather than reporting money the
  // funder never promised. If it just says "Amount", an awarded row's amount is
  // the award — which is precisely what Closed Won means.
  const askOnly = requestedIsExplicit(spellings.amountRequested);
  const get = (row, field) => {
    const h = mapping[field];
    if (!h) return "";
    const v = typeof cell === "function" ? cell(row, h) : (row && row[h]);
    return v == null ? "" : String(v).trim();
  };
  const out = [], refused = [], counted = {
    statusUnreadable: 0, restrictionUnreadable: 0, declineReasonMissing: 0,
    datesUnreadable: 0, awardedWithoutAmount: 0, awardedFromAmountColumn: 0,
  };
  const date = v => {
    const s = String(v || "").trim();
    if (CIVIL.test(s)) return s;
    // Two other shapes a spreadsheet actually writes, and NOTHING ambiguous:
    // an ISO instant, and YYYY/MM/DD. A bare 03/04/2026 is refused, because
    // Steward cannot know which is the month (the BUILD-80 rule).
    const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const slash = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s);
    if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
    return null;
  };
  const cents = v => {
    const s = String(v || "").trim();
    if (!s) return null;
    const c = money && typeof money.toCents === "function" ? money.toCents(s) : null;
    return Number.isInteger(c) && c > 0 ? c : null;
  };

  rows.forEach((row, i) => {
    const line = i + 2;                         // the header is line 1, as a person counts
    const funderName = get(row, "funderName");
    const program = sanitizeProgram(get(row, "program"));
    const ein = normalizeEin(get(row, "funderEin"));
    if (!funderName && !ein) {
      refused.push({ line, why: "no funder named, and no EIN to identify one" }); return;
    }
    if (!program) {
      // A GRANT WITHOUT A PROGRAMME IS NOT A GRANT — Part 1 refuses it at the
      // route, and an import that invented "General support" would be putting
      // words in an organisation's mouth about what it asked a funder for.
      refused.push({ line, funderName, why: "no programme, project or purpose named" }); return;
    }
    const st = statusFromSource(get(row, "status"), source);
    if (!st.read) counted.statusUnreadable++;

    const requested = cents(get(row, "amountRequested"));
    const awarded = cents(get(row, "amountAwarded"));
    if (!requested && !awarded) {
      refused.push({ line, funderName, program, why: "no amount requested and none awarded" }); return;
    }
    let status = st.status;
    let amountAwardedCents = awarded;
    if (status === "awarded" && !amountAwardedCents) {
      if (!askOnly && requested) {
        // The file's own column just says "Amount", and the status says the
        // funder said yes. That IS the award.
        amountAwardedCents = requested;
        counted.awardedFromAmountColumn++;
      } else {
        // AN AWARD WITH NO AWARDED AMOUNT IS NOT AN AWARD. Falling back to a
        // column that says "requested" would report money the funder never
        // promised, in every total, for ever. It imports as SUBMITTED, counted.
        status = "submitted"; counted.awardedWithoutAmount++;
      }
    }
    const restrictionRaw = String(get(row, "restriction") || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    let restriction = null;
    if (restrictionRaw) {
      restriction = RESTRICTION_KEYS.includes(restrictionRaw) ? restrictionRaw
        : (/^(yes|true|y|restricted)$/.test(restrictionRaw) ? "program_restricted"
          : (/^(no|false|n|unrestricted|general)$/.test(restrictionRaw) ? "unrestricted" : null));
      if (!restriction) counted.restrictionUnreadable++;
    }
    // TIME-RESTRICTED needs its release date, which almost no file carries —
    // Part 1's validateGrant would refuse it, so the import never claims it.
    if (restriction === "time_restricted") { restriction = "program_restricted"; counted.restrictionUnreadable++; }

    let declineReason = null, declineNote = null;
    if (status === "declined") {
      const rr = String(get(row, "declineReason") || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (DECLINE_REASON_KEYS.includes(rr)) declineReason = rr;
      else {
        // A DECLINE WITH NO READABLE REASON DOES NOT GET `no_reason_given` —
        // that key is a claim about what the FUNDER said, and Steward is only
        // able to say the file did not carry it. `other` plus the note is the
        // honest bucket, and it stays countable.
        declineReason = "other";
        declineNote = rr ? `The file gave the decline reason as "${rr}".`
                         : "The file did not carry a decline reason.";
        counted.declineReasonMissing++;
      }
    }

    const dates = {};
    for (const [k, f] of [["deadline", "deadline"], ["submittedOn", "submittedOn"],
                          ["decidedOn", "decidedOn"], ["reportDue", "reportDue"]]) {
      const raw = get(row, f);
      if (!raw) continue;
      const d = date(raw);
      if (d) dates[k] = d; else counted.datesUnreadable++;
    }

    const notes = [sanitizeNotes(get(row, "notes")), declineNote].filter(Boolean).join(" ");
    out.push({
      line, funderName, funderEin: ein, program,
      amountRequestedCents: requested || amountAwardedCents,
      amountAwardedCents: amountAwardedCents || null,
      status, statusRaw: st.raw, statusRead: st.read,
      restriction, fundName: get(row, "fundName") || null,
      officerName: get(row, "officerName") || null,
      cycleName: sanitizeCycle(get(row, "cycleName")) || null,
      declineReason, declinedOn: dates.decidedOn && status === "declined" ? dates.decidedOn : null,
      deadline: dates.deadline || null, submittedOn: dates.submittedOn || null,
      decidedOn: dates.decidedOn || null, reportDue: dates.reportDue || null,
      externalId: get(row, "externalId") || null,
      notes: notes || null,
    });
  });
  return { grants: out, refused, counted, today };
}

// ── THE SAME FILE TWICE ────────────────────────────────────────────────────
// A source's own record id when the file carries one; otherwise the funder, the
// programme and the deadline together — because one funder genuinely runs the
// same programme in two cycles, and the deadline is what separates them.
export function grantDedupeKey(g) {
  if (g.externalId) return "id:" + String(g.externalId).trim().toLowerCase();
  return ["k", funderNameKey(g.funderName), norm(g.program), g.deadline || "no-deadline"].join("|");
}

// ── WHAT THE PERSON IS TOLD ────────────────────────────────────────────────
// The receipt's sentence, in the shape BUILD-87 Part 2 settled: never a template
// with holes, and never a balance it cannot back.
export function importSentence({ grants = 0, funders = 0, created = 0, skipped = 0,
                                 refused = 0, pipelineCents = 0 } = {}, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (c => String(c));
  if (!grants) {
    return refused
      ? `Nothing was imported. ${refused} ${refused === 1 ? "row" : "rows"} could not be read, and each one says why.`
      : "There were no grants in that file.";
  }
  const parts = [`${grants} ${grants === 1 ? "grant" : "grants"} on ${funders} ${funders === 1 ? "funder" : "funders"}`];
  if (created) parts.push(`${created} ${created === 1 ? "funder" : "funders"} added as ${created === 1 ? "an organisation" : "organisations"}`);
  if (skipped) parts.push(`${skipped} already on file`);
  if (refused) parts.push(`${refused} ${refused === 1 ? "row" : "rows"} left out, each with its reason`);
  let s = parts.join(", ") + ".";
  if (pipelineCents > 0) s += ` ${fm(pipelineCents)} of it is still open.`;
  return s;
}
