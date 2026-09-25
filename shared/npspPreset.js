// shared/npspPreset.js — BUILD-97 Part 1. SALESFORCE NPSP.
//
// The Nonprofit Success Pack is what the organisations Steward is being sold
// to are leaving. Their file is not one export: it is a CONTACT export and an
// OPPORTUNITY export, and Steward already knows how to read a donor sheet and
// a gift sheet in one pass (the "Import both" workbook path). So this is NOT a
// second importer — it is a preset on the mapper, the BUILD-89S 89d rule and
// the BUILD-94 Mailchimp rule applied a third time.
//
// ── THE TRAP THIS MODULE EXISTS TO AVOID ───────────────────────────────────
// In NPSP every individual donor belongs to a HOUSEHOLD ACCOUNT, and the
// Contact export carries its name in `Account Name`: "Barnett Household".
// Mapping `Account Name` → organization, which is the obvious reading and the
// one the brief's own sentence invites, turns EVERY PERSON IN THE FILE into an
// organisation called "<Surname> Household" — 400 foundations where there were
// 400 people, every one of them off the person surfaces (BUILD-80 Part 7) and
// out of Drift. An import that quietly reclassifies the whole file is worse
// than one that refuses it.
//
// So `Account Name` becomes the organisation ONLY when the row is an
// ORGANISATION account, and this module decides that from evidence in the row:
// the account record type, NPSP's own `npe01__SYSTEMIsIndividual__c` flag, or
// — when neither column was exported — the household naming convention NPSP
// itself writes. `accountIsHousehold` is that decision, in one place, and the
// suite asserts a Household row never becomes an organisation.
//
// ── STAGE ──────────────────────────────────────────────────────────────────
// Only `Closed Won` is money that arrived. NPSP ships Pledged/Promised stages
// that mean a COMMITMENT, and Steward already has a pledge concept, so those
// are ROUTED (the importSentence `pledges` bucket) rather than counted as
// cash. Everything else — Prospecting, Closed Lost, a proposal — is money that
// did not arrive, refused by name so the reconciliation invariant can state it
// rather than a total quietly being short.
//
// ── CONFIDENCE ─────────────────────────────────────────────────────────────
// No real Justin's Place export was in hand when this was written (see
// NEEDS-JONATHAN.md §6). Every column below is a CANDIDATE SPELLING drawn from
// NPSP's documented object model, in BOTH the spellings a real file arrives
// in: the API names a Data Loader export writes (`npo02__TotalOppAmount__c`)
// and the human labels a Salesforce REPORT export writes ("Total Gifts").
// A preset that turns out wrong is an edit to the tables below and a suite
// that fails by column name — never a file importing quietly wrong.
//
// Pure: no DB, no network, no clock, no JSX.

import { normalizeHeader, classifyGiftStage } from "./importShape.js";

const norm = (h) => normalizeHeader(String(h || ""));

// ── THE COLUMNS ────────────────────────────────────────────────────────────
// Each mapper field lists its candidate spellings, most likely first. The API
// name and the report label are BOTH listed because one file carries one and
// one carries the other, and which you get depends on how the admin exported
// — which is not a thing to make a fundraiser answer for.

// THE KEYS ARE THE MAPPER'S OWN FIELD NAMES, NOT NEW ONES.
// A contact column's target is a key from Donors.jsx's CSV_FIELDS (plus
// `_firstName`/`_lastName`); an opportunity column's target is a key from
// `buildTransactionRows`'s txMap. Inventing a third vocabulary here would mean
// a translation layer, and a translation layer is where a column goes missing.
// A real NPSP column with NO target in either vocabulary is IGNORED BY NAME
// (never silently), which is BUILD-58 Part 2's rule.
export const NPSP_CONTACT_COLUMNS = {
  _firstName:   ["first name", "firstname"],
  _lastName:    ["last name", "lastname"],
  name:         ["full name", "contact name"],
  email:        ["email", "email address", "preferred email", "npe01__homeemail__c", "home email"],
  phone:        ["phone", "home phone", "homephone", "npe01__homephone__c", "mobile", "mobilephone", "mobile phone"],
  address:      ["mailing street", "mailingstreet", "street"],
  city:         ["mailing city", "mailingcity", "city"],
  state:        ["mailing state", "mailingstate", "mailing state/province", "mailingstatecode"],
  zip:          ["mailing zip", "mailingpostalcode", "mailing zip/postal code", "zip", "postal code"],
  organization: ["account name", "account"],
  notes:        ["description", "notes"],
  // ── THE NPSP HOUSEHOLD ROLL-UP FIELDS ────────────────────────────────────
  // These are what make an NPSP contact export a DONOR sheet at all: NPSP
  // keeps the giving summary on the contact, so an aggregate import arrives
  // with real lifetime figures rather than a count of nothing.
  total:        ["npo02__totaloppamount__c", "total gifts", "total gift amount", "lifetime giving"],
  gifts:        ["npo02__numberofclosedopps__c", "number of gifts", "total number of gifts"],
  lastGift:     ["npo02__lastclosedate__c", "last gift date", "date of last gift"],
  lastAmount:   ["npo02__lastoppamount__c", "last gift amount"],
  // ── THE FLAGS. A file that carries these and an import that ignores them is
  // how a deceased donor gets a solicitation.
  deceased:     ["npsp__deceased__c", "deceased", "is deceased"],
  doNotContact: ["npsp__do_not_contact__c", "do not contact", "hasoptedoutofemail", "email opt out", "do not email"],
  owner:        ["owner name", "contact owner", "assigned to"],
};

// Real NPSP contact columns with NO home in Steward's donor vocabulary. Named
// here so the review step can say "we read this file and set these aside",
// rather than leaving a person to notice the absence months later.
export const NPSP_CONTACT_NO_TARGET = {
  "salutation":              "Steward stores one name field; a salutation has nowhere to go",
  "suffix":                  "Steward stores one name field; a suffix has nowhere to go",
  "mailing country":         "Steward's CSV donor import has no country field",
  "mailingcountry":          "Steward's CSV donor import has no country field",
  "npo02__firstclosedate__c":"first-gift date is recomputed from the gifts themselves",
  "first gift date":         "first-gift date is recomputed from the gifts themselves",
  "npo02__largestamount__c": "largest gift is recomputed from the gifts themselves",
  "largest gift":            "largest gift is recomputed from the gifts themselves",
  "donotcall":               "a do-not-call flag blocks the PHONE, and Steward's flag blocks email — folding them would silence people who only asked not to be rung",
  "do not call":             "a do-not-call flag blocks the PHONE, and Steward's flag blocks email — folding them would silence people who only asked not to be rung",
  "account record type":     "read to decide whether the account is a household or an organisation, not imported as a field",
  "contact id":              "kept as the source record id, not a donor field",
  "mobile":                  "Steward's CSV donor import stores ONE phone number, and the home phone took it",
  "mobile phone":            "Steward's CSV donor import stores ONE phone number, and the home phone took it",
  "mobilephone":             "Steward's CSV donor import stores ONE phone number, and the home phone took it",
};

export const NPSP_OPPORTUNITY_COLUMNS = {
  externalId:    ["opportunity id", "opportunity_id", "record id", "id"],
  amount:        ["amount", "opportunity amount"],
  date:          ["close date", "closedate"],
  stage:         ["stage", "stage name", "stagename", "opportunity stage"],
  fund:          ["primary campaign source", "campaign", "campaignid", "campaign name"],
  orgName:       ["account name", "account"],
  donorName:     ["primary contact", "npsp__primary_contact__c", "contact name", "contact"],
  donorEmail:    ["contact email", "primary contact email", "email"],
  paymentMethod: ["npe01__payment_method__c", "payment method"],
  notes:         ["description", "opportunity description", "notes"],
  // NOT `type`: this column's non-blank PRESENCE is the fact, and its value is
  // free text ("Auction item"). Routed through the gift-type vocabulary it
  // reads as an unrecognised type and falls through to cash — a signed print
  // counted as money received.
  inKind:        ["npsp__in_kind_type__c", "in-kind type", "in kind type"],
  // BUILD-98 Part 1 — NPSP's tribute and matching-gift fields on the
  // Opportunity. Candidate spellings from NPSP's documented object model, not
  // walked on a real file (the same confidence as everything above). NPSP
  // keeps SOFT CREDITS on Opportunity Contact Roles, which a plain Opportunity
  // report does not carry; a report that adds the role's contact shows it as
  // "Soft Credit Contact", which is the one spelling listed here.
  tributeType:   ["npsp__tribute_type__c", "tribute type"],
  tributeName:   ["npsp__honoree_name__c", "honoree name", "honoree contact"],
  tributeNotify: ["npsp__notification_recipient_name__c", "notification recipient name", "notification recipient"],
  matchEmployer: ["npsp__matching_gift_account__c", "matching gift account"],
  softCreditName:["soft credit contact", "soft credit contact name"],
};

// The opportunity columns Steward reads for a DECISION but does not import as
// a field, and the ones with no home at all.
export const NPSP_OPPORTUNITY_NO_TARGET = {
  "opportunity name":       "a generated label (\"Barnett Household $500 Donation\"); the gift already carries the amount, the date and the person",
  "account record type":    "read to decide whether the account is a household or an organisation, not imported as a field",
  "opportunity record type":"read for context; the gift TYPE comes from the stage and the in-kind marker",
  "record type":            "read for context; the gift TYPE comes from the stage and the in-kind marker",
  "contact id":             "used to link the gift to its contact, not imported as a gift field",
};

// Columns that are Salesforce plumbing and mean nothing in a CRM the size of
// Steward. Named so the mapper can set them to "ignore" up front rather than
// asking a fundraiser to make forty decisions about system audit fields.
export const NPSP_NOISE = new Set([
  "createddate", "created date", "createdbyid", "created by", "created by id",
  "lastmodifieddate", "last modified date", "lastmodifiedbyid", "last modified by",
  "systemmodstamp", "isdeleted", "deleted", "ownerid", "owner id", "owner name",
  "lastactivitydate", "last activity date", "lastvieweddate", "lastreferenceddate",
  "recordtypeid", "photourl", "jigsaw", "jigsawcontactid", "masterrecordid",
  "connectionreceivedid", "connectionsentid", "isemailbounced", "emailbounceddate",
  "emailbouncedreason", "npe01__systemisindividual__c",
  "currencyisocode", "fiscal quarter", "fiscal year", "fiscal period",
].map(norm));

// ── DETECTION ──────────────────────────────────────────────────────────────
// An `Amount` column alone is every gift export ever written, and `Email` is
// every contact export. The signal is the NPSP NAMESPACE — `npo02__`,
// `npe01__`, `npsp__` — or, for a report export that carries human labels
// only, the COMBINATION of Salesforce-specific spellings that no other CRM
// uses. One is a coincidence; two is Salesforce.

// MATCHED AGAINST THE NORMALISED HEADER, NOT THE RAW ONE.
// `normalizeHeader` turns every underscore into a space (BUILD-84: `\b` does
// not fire at an underscore, so headers are compared as TOKENS), which means
// `npo02__TotalOppAmount__c` arrives here as `npo02 totaloppamount c`. A regex
// written against the raw `__` form matches nothing and the whole namespace
// signal silently disappears — which is exactly what it did until the suite
// asked for a Data Loader export by name.
const NAMESPACE_RE = /^(npo02|npe01|npe03|npe4|npe5|npsp)\s/;

// Report-export labels that are distinctly Salesforce/NPSP. "Amount" and
// "Email" are deliberately NOT here.
const CONTACT_MARKS = ["account name", "mailing street", "mailing zip/postal code",
  "mailing state/province", "total gifts", "first gift date", "last gift date",
  "largest gift", "household account", "contact id"].map(norm);
const OPP_MARKS = ["opportunity id", "opportunity name", "close date", "stage",
  "primary campaign source", "opportunity record type", "primary contact",
  "opportunity owner"].map(norm);

export const NPSP_OBJECT_CONTACT = "contact";
export const NPSP_OBJECT_OPPORTUNITY = "opportunity";

export function detectNpsp(headers) {
  const hs = (headers || []).map(norm).filter(Boolean);
  const namespaced = hs.filter(h => NAMESPACE_RE.test(h));
  const contactMarks = CONTACT_MARKS.filter(m => hs.includes(m));
  const oppMarks = OPP_MARKS.filter(m => hs.includes(m));

  // A namespaced column is unambiguous — nothing but NPSP writes `npo02__`.
  // Without one, two report labels from the SAME object are the evidence.
  const strong = namespaced.length > 0;
  const contactish = contactMarks.length >= 2;
  const oppish = oppMarks.length >= 2;
  const isNpsp = strong ? (contactish || oppish || namespaced.length >= 2) : (contactish || oppish);

  let object = null;
  if (isNpsp) {
    // Close Date + Amount + Stage is a gift ledger whatever else is present;
    // an opportunity export often carries contact columns too (the report
    // joins them), so the OPPORTUNITY evidence wins when both are present.
    const hasGiftSpine = hs.includes(norm("close date")) || hs.includes(norm("closedate"));
    if (oppish || hasGiftSpine) object = NPSP_OBJECT_OPPORTUNITY;
    else if (contactish || namespaced.some(h => h.startsWith("npo02"))) object = NPSP_OBJECT_CONTACT;
  }

  return {
    isNpsp,
    object,
    // Every signal that was actually found, so the banner can SAY why it thinks
    // this is Salesforce rather than asserting it.
    signals: [...new Set(namespaced.concat(contactMarks, oppMarks))],
    namespaced: namespaced.length,
  };
}

// ── THE HOUSEHOLD/ORGANISATION DECISION ────────────────────────────────────
// The trap named at the top of this file, in one function.
//
// Evidence, in order of how much it is worth:
//   1. `npe01__SYSTEMIsIndividual__c` — NPSP's own flag. TRUE means this
//      account is a person's household, not an organisation. Definitive.
//   2. The account RECORD TYPE — "Household Account" vs "Organization".
//      Definitive when exported.
//   3. The NAMING CONVENTION NPSP itself writes: "<Surname> Household".
//      A guess, and the last resort, but the right one: NPSP creates these
//      names, they are not typed by a human, and an organisation genuinely
//      called "Household" does not exist.
//
// Returns TRUE (a household — the account name is NOT an organisation),
// FALSE (an organisation), or NULL (no evidence either way). NULL is not
// "organisation": the caller treats an unknown as a household, because the
// cost of the two mistakes is not symmetric. Calling one foundation a person
// loses an institutional row on a list; calling four hundred people
// organisations empties every person surface in the product.
export function accountIsHousehold(row = {}) {
  const get = (names) => {
    for (const n of names) {
      for (const k of Object.keys(row)) {
        if (norm(k) === norm(n)) {
          const v = row[k];
          if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
        }
      }
    }
    return "";
  };

  const sysIsIndividual = get(["npe01__SYSTEMIsIndividual__c", "system is individual", "is individual"]);
  if (sysIsIndividual) {
    const t = sysIsIndividual.toLowerCase();
    if (t === "true" || t === "1" || t === "yes") return true;
    if (t === "false" || t === "0" || t === "no") return false;
  }

  const recType = get(["account record type", "account record type name", "record type",
                       "account type", "accountrecordtype"]).toLowerCase();
  if (recType) {
    if (/household/.test(recType)) return true;
    if (/organi[sz]ation|company|business|foundation/.test(recType)) return false;
  }

  const acct = get(["account name", "account", "household account", "household name"]);
  if (acct) {
    // NPSP writes "Barnett Household" and "Barnett and Reyes Household".
    if (/\bhouseholds?\b\s*$/i.test(acct)) return true;
    return false;
  }

  return null;
}

// The organisation name for this row, or "" when the row is a person. This is
// the ONE place the Account Name → organization decision is made.
export function npspOrganizationName(row = {}) {
  const isHh = accountIsHousehold(row);
  if (isHh !== false) return "";          // true OR unknown → not an organisation
  for (const k of Object.keys(row)) {
    if (norm(k) === norm("account name") || norm(k) === norm("account")) {
      const v = String(row[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

// ── STAGE ─────────────────────────────────────────────────────────────────
// THE VOCABULARY LIVES IN ONE PLACE, AND IT IS NOT HERE.
// `classifyGiftStage` is in shared/importShape.js, beside `classifyGiftType`,
// because the accounted transaction builder is what ACTS on it: the row that
// never arrived has to be skipped WITH ITS DOLLARS by the same function that
// holds the reconciliation invariant. A second copy of the stage table here
// would be a second truth about whether money arrived, and the way those two
// truths would drift is a board report that is wrong.
//
// What belongs here is only the NPSP-specific reading: which stage words
// Salesforce ships, and the fact that an in-kind marker outranks all of them.
export const NPSP_STAGE_CASH = "cash";
export const NPSP_STAGE_PLEDGE = "pledge";
export const NPSP_STAGE_NOT_RECEIVED = "not_received";

// The stages NPSP ships out of the box — for the help text and the fixture,
// NOT for the decision, which is classifyGiftStage's.
export const NPSP_DEFAULT_STAGES = [
  "Prospecting", "Qualification", "Proposal/Price Quote", "Negotiation/Review",
  "Pledged", "Promised", "Granted", "Closed Won", "Closed Lost",
];

export function npspStageKind(stage) {
  const v = classifyGiftStage(stage);
  const kind = v.kind === "received" ? NPSP_STAGE_CASH
             : v.kind === "pledge"   ? NPSP_STAGE_PLEDGE
             : NPSP_STAGE_NOT_RECEIVED;
  return { kind, label: v.label, known: v.known };
}

// ── THE MAPPING ────────────────────────────────────────────────────────────
// Given the file's headers, the answers the mapper would otherwise ask for.
// Returns the SAME shape the existing presets return: a header→field map, the
// headers deliberately ignored, and what could not be answered.
export function npspMapping(headers, { object } = {}) {
  const hs = (headers || []).filter(h => String(h ?? "").trim() !== "");
  const det = detectNpsp(hs);
  const obj = object || det.object;
  const isOpp = obj === NPSP_OBJECT_OPPORTUNITY;
  const table = isOpp ? NPSP_OPPORTUNITY_COLUMNS : NPSP_CONTACT_COLUMNS;
  const noTarget = isOpp ? NPSP_OPPORTUNITY_NO_TARGET : NPSP_CONTACT_NO_TARGET;

  const mapping = {};
  const ignored = [];     // { header, reason }
  const unrecognized = [];
  const warnings = [];
  const used = new Set();

  // Field order matters: the FIRST candidate spelling present wins, and a
  // header is claimed only once, so `Email` cannot land on both `email` and
  // `donorEmail`.
  for (const [field, candidates] of Object.entries(table)) {
    for (const cand of candidates) {
      const hit = hs.find(h => !used.has(h) && norm(h) === norm(cand));
      if (hit) { mapping[hit] = field; used.add(hit); break; }
    }
  }

  // ── TWO COLUMNS, ONE REFUSAL ──────────────────────────────────────────────
  // NPSP ships BOTH `Do Not Contact` and `Email Opt Out`, and they are
  // different people: one asked the organisation to stop entirely, the other
  // asked it to stop emailing. Steward's donor import has ONE such field, so
  // only the first column is mapped and the second one's people would import
  // as reachable.
  //
  // This does not get to be silent. The collision is reported as a WARNING the
  // review step must show, with both column names in it. The proper fix — a
  // flag field that can be the OR of several columns — is named in
  // NEEDS-JONATHAN.md §6 rather than guessed at here, because deciding which
  // refusal outranks which is a decision about contacting real people.
  const dncCandidates = (NPSP_CONTACT_COLUMNS.doNotContact || []).map(norm);
  const dncPresent = hs.filter(h => dncCandidates.includes(norm(h)));
  if (!isOpp && dncPresent.length > 1) {
    const mappedOne = dncPresent.find(h => mapping[h] === "doNotContact");
    const lost = dncPresent.filter(h => h !== mappedOne);
    warnings.push({
      kind: "flag_collision",
      field: "doNotContact",
      mapped: mappedOne || null,
      unmapped: lost,
      sentence: `This file has ${dncPresent.length} columns that each say "do not contact me": ` +
        `${dncPresent.map(h => `"${h}"`).join(" and ")}. Steward can read one of them. ` +
        `Anyone marked only in ${lost.map(h => `"${h}"`).join(" or ")} will import as reachable — ` +
        `check that column before you send anything.`,
    });
  }

  // A collision loser is a column Steward UNDERSTOOD and could not use. It
  // belongs in `ignored` with that said, never in `unrecognized` — the two
  // lists mean different things to the person reading the review step, and
  // "nobody knows what this is" about a column we just warned about by name
  // would be the product contradicting itself on one screen.
  const collisionLosers = new Map();
  for (const w of warnings) for (const h of (w.unmapped || [])) {
    collisionLosers.set(h, `Steward already read "${w.mapped}" for this; see the warning above`);
  }

  for (const h of hs) {
    if (used.has(h)) continue;
    const collision = collisionLosers.get(h);
    if (collision) { ignored.push({ header: h, reason: collision }); continue; }
    const reason = noTarget[norm(h)];
    if (reason) { ignored.push({ header: h, reason }); continue; }
    if (NPSP_NOISE.has(norm(h)) || NAMESPACE_RE.test(norm(h))) {
      ignored.push({ header: h, reason: "Salesforce system field" });
      continue;
    }
    unrecognized.push(h);
  }

  const wanted = isOpp ? ["amount", "date", "stage"] : ["email"];
  const values = new Set(Object.values(mapping));
  const missing = wanted.filter(f => !values.has(f));
  if (!isOpp && !values.has("name") && !(values.has("_firstName") && values.has("_lastName"))
      && !values.has("organization")) missing.push("name");

  // The arithmetic that makes "every column accounted for" checkable rather
  // than asserted: nothing may fall out of the three buckets.
  const accounted = Object.keys(mapping).length + ignored.length + unrecognized.length;

  return { object: obj, mapping, ignored, unrecognized, missing, warnings, detected: det,
           columnsIn: hs.length, accounted };
}

// ── THE ROW DECISION ───────────────────────────────────────────────────────
// One opportunity row → what the importer does with it, and WHY, in words the
// review step prints. This is the function the reconciliation invariant reads:
// every row lands in exactly one of cash / pledge / refused, so
// rows_in_file = cash + pledge + refused always holds.
export function npspGiftDecision(row = {}, { stageField } = {}) {
  const findVal = (names) => {
    for (const n of names) {
      for (const k of Object.keys(row)) {
        if (norm(k) === norm(n)) {
          const v = row[k];
          if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
        }
      }
    }
    return "";
  };
  const stage = stageField ? String(row[stageField] ?? "").trim()
                           : findVal(NPSP_OPPORTUNITY_COLUMNS.stage);
  // `inKind` is the mapper key NPSP's in-kind MARKER lands in — a column whose
  // non-blank presence is the fact, never a value from the gift-type vocabulary.
  const inKind = findVal(NPSP_OPPORTUNITY_COLUMNS.inKind);
  const verdict = npspStageKind(stage);

  // In-kind is money that never arrived as money, and Steward already has a
  // bucket for it. It outranks the stage: a Closed Won in-kind gift is still
  // not cash.
  if (inKind) {
    return { bucket: "routed", routedAs: "inKind", stage,
             reason: `an in-kind gift (${inKind}), not money received` };
  }
  if (verdict.kind === NPSP_STAGE_CASH)   return { bucket: "cash", stage, reason: verdict.label };
  if (verdict.kind === NPSP_STAGE_PLEDGE) return { bucket: "routed", routedAs: "pledges", stage, reason: verdict.label };
  return { bucket: "refused", stage, reason: verdict.label, knownStage: verdict.known };
}

// The preset entry the mapper's preset picker shows, the same shape
// SOURCE_PRESETS entries take.
export const NPSP_PRESET = {
  key: "salesforce_npsp",
  label: "Salesforce (Nonprofit Success Pack)",
  provider: "salesforce",
  confidence: "documented-not-walked",
  help: "In Salesforce, export the Contacts report and the Opportunities report. " +
        "Steward reads both: the contacts become your donors, the opportunities become their gifts.",
  objects: [NPSP_OBJECT_CONTACT, NPSP_OBJECT_OPPORTUNITY],
  // The one sentence the review step owes a person before they commit.
  cashRule: "Only opportunities at stage Closed Won are counted as money received. " +
            "Pledged and Promised become pledges; everything else is set aside and listed.",
};
