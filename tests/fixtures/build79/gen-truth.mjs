// BUILD-80 — derive the machine-readable truth files from the fixture key.
// Source of truth: claude/messy-2500-v2-fixture-key.md (Cowork-side, golden).
// Run: node tests/fixtures/build79/gen-truth.mjs
// Emits key.json (file-level truth) and donor-truth.json (per-donor truth).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(here, "../../../claude/messy-2500-v2-fixture-key.md"), "utf8");

// ── file-level truth, stated numbers from the key ──────────────────────────
const key = {
  source: "claude/messy-2500-v2-fixture-key.md",
  seed: 20260905,
  anchorDate: "2026-09-05",
  bytes: 438319,
  physicalLines: 2853,
  dataRecords: 2500,
  headerLine: 4,
  totalRowAmount: 2035978.52,          // source system NET CASH (its own TOTAL row)
  fileAmountCellSum: 2327646.22,       // every amount cell, convention-correct
  expectedNetCash: 2005092.16,         // TOTAL minus the 33 refusable cash rows
  refusableCashRows: { rows: 33, dollars: 30886.36 },
  refunds: { rows: 7, dollars: -7850.00 },
  positiveReversalRows: 3,             // type says money left, sign says it arrived — human
  exactDuplicates: { rows: 15, dollars: 16030.60 },
  softCredits: { rows: 60, dollars: 35016.60 },
  pledgeCommitments: { rows: 12, dollars: 184000.00 },
  pledgePayments: { dollars: 147625.00 },
  inKind: { rows: 25, dollars: 38900.00, blankAmountRows: 7 },
  matchingGifts: { rows: 30, dollars: 18346.61 },
  sameDayTwins: { rows: 10 },
  legacyMigrationTwins: { rows: 6 },
  slashDates: { total: 1581, dayFirstUnambiguous: 828, ambiguous: 753, silentlyWrongUnderUS: 688 },
  isoZDates: 96,
  cp1252: { lines: [1541, 1542, 1545, 1913], donors: ["Christian García", "Stephanie Müller"] },
  embeddedNewlineCells: 336,
  columnShiftRows: ["G-6514", "G-4210", "G-8053", "G-7877", "G-4747"],
  extraColumnRows: ["G-5204", "G-7692", "G-5041", "G-5654"],
  shortRows: ["G-5318", "G-6515", "G-6678"],
  anonymousRows: 15,
  organisations: 20,
  plantedDates: [],
  plantedAmounts: [],
  knownArtifacts: [
    "fl_mi donors rotate middle initials per row (Jennifer E./A./J./K. Sowande) — a generator artifact, PINNED as a same-person merge case; the file is golden, do not regenerate",
  ],
};

// planted dates: "- `X` on gift `G-nnnn` (Name), true date YYYY-MM-DD: reason"
for (const m of md.matchAll(/^- `([^`]*)` on gift `([^`]+)` \(([^)]+)\), true date (\d{4}-\d{2}-\d{2}): (.+)$/gm)) {
  key.plantedDates.push({ raw: m[1], giftId: m[2], donor: m[3], trueDate: m[4], reason: m[5].trim() });
}
// planted amounts: "- `X` on gift `G-nnnn` (Name), true amount $n: reason"
for (const m of md.matchAll(/^- `([^`]*)` on gift `([^`]+)` \(([^)]+)\), true amount \$([\d,.]+): (.+)$/gm)) {
  key.plantedAmounts.push({ raw: m[1], giftId: m[2], donor: m[3], trueAmount: Number(m[4].replace(/,/g, "")), reason: m[5].trim() });
}

// ── per-donor truth: every "- LABEL ...: **Name**" line ────────────────────
// The label prefix decides the category; the same donor can carry several.
const CAT_RULES = [
  [/^DECEASED via Notes only/, { deceased: true, deceasedVia: "notes" }],
  [/^DECEASED via Solicit Code/, { deceased: true, deceasedVia: "solicit_code" }],
  [/^DECEASED via Status column/, { deceased: true, deceasedVia: "status" }],
  [/^DECEASED \(Status column\)\. Estate/, { deceased: true, deceasedVia: "status", hasEstate: true }],
  [/^CONTRADICTION/, { deceased: true, deceasedVia: "notes", contradiction: true }],
  [/^DO-NOT-SOLICIT-ish via Notes/, { doNotSolicit: true, dnsVia: "notes" }],
  [/^DO-NOT-SOLICIT via Solicit Code '([^']+)'/, (m) => ({ doNotSolicit: true, dnsVia: "solicit_code", dnsCode: m[1] })],
  [/^DO-NOT-MAIL\/EMAIL via Solicit Code '([^']+)'/, (m) => {
    const code = m[1].toUpperCase();
    const out = { dnChannelVia: "solicit_code", dnCode: m[1] };
    if (/DNE/.test(code)) out.doNotEmail = true;
    if (/DNM|NO MAIL/.test(code)) out.doNotMail = true;
    return out;
  }],
  [/^INCONSISTENT: Solicit Code blank on most rows, 'DNS' on one row/, { doNotSolicit: true, dnsVia: "solicit_code", inconsistentRows: true }],
  [/^NEWSLETTER ONLY/, { doNotSolicit: true, newsletterOnly: true }],
  [/^SUSTAINER, CARD STOPPED/, { sustainer: true, sustainerState: "card_stopped", neverDrift: true, neverLapsed: true }],
  [/^SUSTAINER, healthy/, { sustainer: true, sustainerState: "healthy", neverDrift: true }],
  [/^STALE FLAG: Frequency column says Monthly/, { staleMonthlyFlag: true, trueCadence: "annual" }],
  [/^UNFLAGGED SUSTAINER/, { sustainer: true, sustainerState: "unflagged", fromPattern: true }],
  [/^SEASONAL DRIFT \(high conf/, { drift: "high", driftKind: "seasonal" }],
  [/^DRIFTING \(quarterly/, { drift: "high", driftKind: "quarterly" }],
  [/^DRIFTING\/declining/, { drift: "high", driftKind: "declining" }],
  [/^NOT DRIFTING \(quarterly/, { drift: "none", driftKind: "quarterly_ok" }],
  [/^NOT DRIFTING/, { drift: "none", driftKind: "seasonal_open" }],
  [/^LAPSED, not drifting/, { drift: "none", lapsed: true }],
  [/^MEDIUM AT MOST/, { drift: "medium_at_most", driftKind: "erratic" }],
  [/^CONSTITUENT ID (\d+) SHARED/, (m) => ({ sharedConstituentId: m[1] })],
  [/^NAME CONFLICT: Name column says ([^,]+), First Name column says '([^']+)'/, (m) => ({ nameConflict: { nameCol: m[1], firstNameCol: m[2] } })],
  [/^PLEDGE \$([\d,]+) FULLY PAID \((\d+) payments\)/, (m) => ({ pledge: { amount: Number(m[1].replace(/,/g, "")), state: "fully_paid", payments: Number(m[2]) } })],
  [/^PLEDGE \$([\d,]+) OVERPAID \((\d+) of (\d+)/, (m) => ({ pledge: { amount: Number(m[1].replace(/,/g, "")), state: "overpaid", payments: Number(m[2]), scheduled: Number(m[3]) } })],
  [/^PLEDGE \$([\d,]+) WITH ZERO PAYMENTS/, (m) => ({ pledge: { amount: Number(m[1].replace(/,/g, "")), state: "zero_payments", payments: 0 } })],
  [/^ACTIVE PLEDGE \$([\d,]+), (\d+) of (\d+) paid/, (m) => ({ pledge: { amount: Number(m[1].replace(/,/g, "")), state: "active", payments: Number(m[2]), scheduled: Number(m[3]) }, contractualCadence: true, neverDrift: true })],
  [/^DAF DONOR: gifts arrive from ([^ ]+(?: [^ ]+)*?) with this person named in Notes/, (m) => ({ dafSponsor: m[1] })],
  [/^ESTATE of a deceased donor\. Not the same record as ([^.]+)\./, (m) => ({ estate: true, estateOf: m[1].trim(), organisation: true, deceased: true, doNotSolicit: true })],
];

const donors = {};
const addFacts = (name, facts) => {
  if (!donors[name]) donors[name] = { name };
  Object.assign(donors[name], facts);
};
for (const line of md.split("\n")) {
  const m = line.match(/^- (.+): \*\*(.+)\*\*\s*$/);
  if (!m) continue;
  const [, label, name] = m;
  let matched = false;
  for (const [re, facts] of CAT_RULES) {
    const mm = label.match(re);
    if (mm) { addFacts(name, typeof facts === "function" ? facts(mm) : facts); matched = true; break; }
  }
  if (!matched) addFacts(name, { unclassifiedLabel: label });
}

fs.writeFileSync(path.join(here, "key.json"), JSON.stringify(key, null, 2) + "\n");
fs.writeFileSync(path.join(here, "donor-truth.json"), JSON.stringify(donors, null, 2) + "\n");
console.log(`key.json: ${key.plantedDates.length} planted dates, ${key.plantedAmounts.length} planted amounts`);
console.log(`donor-truth.json: ${Object.keys(donors).length} donors`);
const unclass = Object.values(donors).filter(d => d.unclassifiedLabel);
if (unclass.length) { console.log("UNCLASSIFIED:", unclass.map(d => `${d.name}: ${d.unclassifiedLabel}`)); process.exit(1); }
