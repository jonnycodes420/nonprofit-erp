// shared/migrationPresets.js — BUILD-98 (switch) Part 7. THE FILE PEOPLE STAY FOR.
//
// The reason an organisation stays on Bloomerang is its file. These are
// PRESETS ON THE MAPPER, never second importers (the BUILD-89S 89d rule, the
// BUILD-94 Mailchimp rule and BUILD-97's NPSP preset, applied again): each one
// is the answer the mapper would otherwise ask a fundraiser for, given the
// headers a vendor's gift export carries. Every row still goes through the one
// accounted builder, so the reconciliation sentence stays the proof.
//
// ── WHAT EACH PRESET IS ────────────────────────────────────────────────────
//   columns    mapper field (the txMap vocabulary buildTransactionRows reads)
//              → candidate spellings, most likely first. A header is claimed
//              once; the first candidate present wins.
//   signals    headers only that vendor writes. TWO must be present — an
//              "Amount" column is every export ever written.
//   noTarget   real columns with no home, named with the reason, so the review
//              step says "we read this and set it aside" (BUILD-58 Part 2).
//   checklist  which report to run, and in what order.
//   loses      what does not come across, said before the file does.
//
// ── CONFIDENCE ─────────────────────────────────────────────────────────────
// Every spelling is drawn from the vendor's published export documentation,
// NOT from a real customer file. Each preset says so (`documented-not-walked`)
// and the fixtures in tests/fixtures/build98-migration are hand-built to the
// same documentation. A wrong spelling is an edit to a table and a suite that
// fails by column name, never a file importing quietly wrong.
//
// Salesforce NPSP lives in shared/npspPreset.js: it is two objects and a
// household trap, and needed a module of its own.
//
// Pure: no DB, no network, no clock, no JSX.

import { normalizeHeader } from "./importShape.js";

const norm = (h) => normalizeHeader(String(h || ""));

export const MIGRATION_PRESETS = {
  bloomerang: {
    label: "Bloomerang",
    confidence: "documented-not-walked",
    signals: ["account number", "transaction number", "appeal"],
    columns: {
      firstName: ["first name"], lastName: ["last name"], donorName: ["name", "full name"],
      donorEmail: ["email address", "email", "primary email"],
      externalId: ["transaction number"],
      date: ["date", "transaction date"], amount: ["amount"],
      fund: ["fund"], campaign: ["campaign"], paymentMethod: ["method", "payment method"], type: ["type"],
    },
    noTarget: {
      "account number": "Bloomerang's constituent number; people are matched by email and name",
      "appeal": "Steward has one campaign field, and Campaign took it",
    },
    checklist: [
      "In Bloomerang, open Reports → Transactions and export every transaction (all dates, all types).",
      "Import that one file here. People come with their gifts; there is no separate constituent export to run.",
      "Compare the total this screen shows against Bloomerang's own transaction total for the same dates.",
    ],
    loses: ["Appeals (Steward keeps the Campaign)", "Interactions and notes, which are a separate Bloomerang export"],
  },
  littlegreenlight: {
    label: "Little Green Light",
    confidence: "documented-not-walked",
    signals: ["lgl constituent id", "lgl gift id", "constituent name"],
    columns: {
      donorName: ["constituent name", "name"], firstName: ["first name"], lastName: ["last name"],
      donorEmail: ["email", "email address"], externalId: ["lgl gift id"],
      date: ["gift date", "date"], amount: ["gift amount", "amount"], type: ["gift type"],
      fund: ["fund"], campaign: ["campaign"], paymentMethod: ["payment type"],
    },
    noTarget: {
      "lgl constituent id": "LGL's constituent id; people are matched by email and name",
      "appeal": "Steward has one campaign field, and Campaign took it",
    },
    checklist: [
      "In Little Green Light, run a Gifts query with every gift and export it as CSV.",
      "Import that file here; each gift carries its constituent.",
      "Compare the total against LGL's gift total for the same dates.",
    ],
    loses: ["Appeals (Steward keeps the Campaign)", "Notes and contact reports, a separate LGL export"],
  },
  donorperfect: {
    label: "DonorPerfect",
    confidence: "documented-not-walked",
    signals: ["donor id", "gl code", "solicit code"],
    columns: {
      firstName: ["first name"], lastName: ["last name"], donorName: ["name"],
      donorEmail: ["email"], externalId: ["gift id"],
      date: ["gift date"], amount: ["amount"],
      fund: ["gl code"], campaign: ["solicit code", "campaign"],
      // DonorPerfect's gift_type is HOW it was paid (CC, CK, CASH), not what it was.
      paymentMethod: ["gift type"],
    },
    noTarget: {
      "donor id": "DonorPerfect's donor id; people are matched by email and name",
      "record type": "DonorPerfect marks pledges as record type P; filter the report to G (gifts) before exporting",
      "sub solicit code": "Steward has one campaign field, and Solicit Code took it",
    },
    checklist: [
      "In DonorPerfect, build a gift report filtered to Record Type = G (gifts only), all dates, and export it.",
      "Pledges (Record Type P) are left out on purpose: import them as pledges on each donor, or they would count as money received.",
      "Import the gift file here and compare its total against DonorPerfect's for the same dates.",
    ],
    loses: ["Pledges (see step 2)", "Sub-solicitation codes", "Contact history, a separate export"],
  },
  neon: {
    label: "Neon CRM",
    confidence: "documented-not-walked",
    signals: ["account id", "email 1", "tender type"],
    columns: {
      firstName: ["first name"], lastName: ["last name"], donorName: ["full name", "account name"],
      donorEmail: ["email 1", "email"], externalId: ["donation id"],
      date: ["donation date"], amount: ["donation amount"],
      fund: ["fund"], campaign: ["campaign name", "campaign"], paymentMethod: ["tender type", "payment method"],
    },
    noTarget: {
      "account id": "Neon's account id; people are matched by email and name",
      "purpose": "Steward reads the Fund as the designation; Purpose has no second home",
    },
    checklist: [
      "In Neon, search Donations with no date limit and export the results with the account columns included.",
      "Import that file here.",
      "Compare the total against Neon's donation total for the same dates.",
    ],
    loses: ["Purpose", "Soft credits, which Neon exports separately"],
  },
  kindful: {
    label: "Kindful",
    confidence: "documented-not-walked",
    signals: ["contact id", "transaction type"],
    columns: {
      firstName: ["first name"], lastName: ["last name"], donorName: ["name"],
      donorEmail: ["email"], externalId: ["transaction id"],
      date: ["transaction date", "date"], amount: ["amount"],
      fund: ["fund"], campaign: ["campaign"], paymentMethod: ["payment type"], type: ["transaction type"],
    },
    noTarget: { "contact id": "Kindful's contact id; people are matched by email and name" },
    checklist: [
      "In Kindful, export Transactions for all dates.",
      "Import that file here.",
      "Compare the total against Kindful's transaction total for the same dates.",
    ],
    loses: ["Notes and tasks, a separate export"],
  },
  networkforgood: {
    label: "Network for Good",
    confidence: "documented-not-walked",
    signals: ["donor first name", "donor last name", "designation"],
    columns: {
      firstName: ["donor first name"], lastName: ["donor last name"], donorEmail: ["donor email"],
      externalId: ["donation id", "transaction id"],
      date: ["donation date"], amount: ["donation amount"],
      fund: ["designation"], campaign: ["campaign"], paymentMethod: ["payment method"], stage: ["status"],
    },
    noTarget: {},
    checklist: [
      "In Network for Good, run the Donations report for all dates and export it.",
      "Import that file here. Refunded and failed donations are set aside and listed, never counted.",
      "Compare the total against the report's own total of completed donations.",
    ],
    loses: ["Fees (Steward records the gift, not the processor's cut)"],
  },
  givebutter: {
    label: "Givebutter",
    confidence: "documented-not-walked",
    signals: ["campaign title", "fund code", "status"],
    columns: {
      firstName: ["first name"], lastName: ["last name"], donorName: ["name"],
      donorEmail: ["email"], externalId: ["transaction id"],
      date: ["transaction date", "date"], amount: ["amount"],
      campaign: ["campaign title"], fund: ["fund code", "fund"], paymentMethod: ["method", "payment method"],
      stage: ["status"],
    },
    noTarget: {
      "fee": "Steward records the gift, not the processor's cut",
      "fee covered": "Steward records the gift, not the processor's cut",
    },
    checklist: [
      "In Givebutter, open Transactions and export all of them.",
      "Import that file here. Refunded and failed transactions are set aside and listed, never counted.",
      "If Givebutter is staying, connect it under Settings → Integrations instead, so new gifts arrive on their own.",
    ],
    loses: ["Fees", "Teams and peer fundraiser pages"],
  },
  zeffy: {
    label: "Zeffy",
    confidence: "documented-not-walked",
    signals: ["form name", "payment status", "payment id"],
    columns: {
      firstName: ["first name"], lastName: ["last name"], donorName: ["name"],
      donorEmail: ["email"], externalId: ["payment id"],
      date: ["payment date", "date"], amount: ["amount"],
      campaign: ["form name"], paymentMethod: ["payment method"], stage: ["payment status"],
    },
    noTarget: {},
    checklist: [
      "In Zeffy, open Payments and export all of them.",
      "Import that file here. Refunded payments are set aside and listed, never counted.",
      "If Zeffy is staying, connect it under Settings → Integrations instead, so new gifts arrive on their own.",
    ],
    loses: ["Zeffy's tip line, which is Zeffy's revenue, not the organisation's"],
  },
};

export const MIGRATION_PRESET_KEYS = Object.keys(MIGRATION_PRESETS);

// Which vendor wrote this file? Two of the vendor's own signals must be
// present, and a TIE is no answer: two presets that both fit is a file the
// person should choose for, not one Steward should guess.
export function detectMigrationPreset(headers = []) {
  const hs = new Set((headers || []).map(norm).filter(Boolean));
  const scored = MIGRATION_PRESET_KEYS
    .map(key => ({ key, score: MIGRATION_PRESETS[key].signals.filter(s => hs.has(norm(s))).length }))
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored[1] && scored[1].score === scored[0].score) return { key: null, ambiguous: scored.map(s => s.key) };
  return { key: scored[0].key, label: MIGRATION_PRESETS[scored[0].key].label, score: scored[0].score };
}

// The answers the mapper would otherwise ask for, in the SAME shape the NPSP
// preset returns: header→field, plus every other column accounted for.
export function migrationMapping(headers = [], key) {
  const p = MIGRATION_PRESETS[key];
  if (!p) return null;
  const hs = (headers || []).filter(h => String(h ?? "").trim() !== "");
  const mapping = {}, used = new Set(), ignored = [], unrecognized = [];
  for (const [field, candidates] of Object.entries(p.columns)) {
    for (const cand of candidates) {
      const hit = hs.find(h => !used.has(h) && norm(h) === norm(cand));
      if (hit) { mapping[hit] = field; used.add(hit); break; }
    }
  }
  // A person's name arrives as first+last OR as one field; never both.
  const vals = new Set(Object.values(mapping));
  if (vals.has("firstName") && vals.has("lastName")) {
    for (const [h, f] of Object.entries(mapping)) if (f === "donorName") { delete mapping[h]; used.delete(h); }
  }
  const noTarget = Object.fromEntries(Object.entries(p.noTarget || {}).map(([h, r]) => [norm(h), r]));
  for (const h of hs) {
    if (used.has(h)) continue;
    const reason = noTarget[norm(h)];
    if (reason) ignored.push({ header: h, reason }); else unrecognized.push(h);
  }
  const txMap = {};
  for (const [h, f] of Object.entries(mapping)) txMap[f] = h;
  const missing = ["amount", "date"].filter(f => !txMap[f]);
  if (!txMap.donorEmail && !txMap.donorName && !(txMap.firstName && txMap.lastName)) missing.push("a name or email");
  return { key, label: p.label, confidence: p.confidence, mapping, txMap, ignored, unrecognized, missing,
           columnsIn: hs.length, accounted: Object.keys(mapping).length + ignored.length + unrecognized.length };
}
