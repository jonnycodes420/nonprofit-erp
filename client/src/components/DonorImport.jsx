// DonorImport.jsx — every way a file comes into Donors: the one-file import,
// gift history, and merging duplicates.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { apiFetch } from "../api";
import { rethrowProgrammerError, errorMessage, isProgrammerError } from "../lib/domainError";
import { useAuth } from "../main";
import UpgradeModal from "./UpgradeModal";
import Uploader from "./Uploader";
import { detectMailchimpAudience, typeSuggestionForTags, rowIsUnsubscribed, fileStatusFromName } from "../../../shared/mailchimpPreset.js";
import { detectNpsp, npspMapping, NPSP_PRESET, NPSP_OBJECT_OPPORTUNITY } from "../../../shared/npspPreset.js";
import { detectMigrationPreset, migrationMapping, MIGRATION_PRESETS } from "../../../shared/migrationPresets.js";
import { membershipColumns, detectMembershipPreset, buildMembershipRows, MEMBERSHIP_FIELDS, MEMBERSHIP_FIELD_LABELS, MEMBERSHIP_PRESETS } from "../../../shared/membershipImport.js";
import { coerceCustomValue, parseBoolValue, parseExclusionValue, buildMapperPlan, buildColumnLedger, summarizeColumnLedger, proposalEvidenceText, proposeCustomField, generateFieldKey, CF_TYPES } from "../../../shared/customFieldShape";
import { T, fmt, fmtFull, Spin, Modal } from "./shared";
import { detectImportShape, shapeLabel, YEAR_HDR_PAT, detectWorkbookRoles, pickMatchKey, linkGiftsToDonors, detectOwnerColumn, matchOwnersToUsers, applyOwnerAssignment, groupOwnerMatches, normalizeName, normalizeDate, normalizeMoney, normalizeEmail, detectFlagColumns, parseBoolFlag, classifyColumns, decodeSpreadsheetBytesDetailed, analyzeCsvText, assessAggregateCollapse, scanAmountShapedColumns, headerMatchesLabel, eitherContainsTokenRun, containsTokenRun, normalizeHeader, localCivilToday, resolveDonorIdentity, NAMEABILITY_REASON, stageAssignmentBasis, validateMappingChoice, buildGiftItemsFromLedger, buildTransactionRows, buildProposalRows, autoDetectTxMapping, inferDateConvention, extractWorkbookFromSheetJS, analyzeWorkbookSheet, classifyWorkbookSheets } from "../../../shared/importShape";
import { WorkbookImport } from "./WorkbookImport";
import { ColumnTargetSelect } from "./ColumnTargetSelect";
import { NEGATOR_PHRASES, STAGE_COLORS, inferStage, normalizeStage } from "./donorShared";

// ── CSV Import helpers ─────────────────────────────────────────────────────
// ── Import field registry ──────────────────────────────────────────────────
const CSV_FIELDS = [
  { key:"name",      labels:["name","full name","donor name","contact","display name"] },
  { key:"email",     labels:["email","email address","e-mail","e mail"] },
  { key:"phone",     labels:["phone","phone number","mobile","cell","telephone"] },
  { key:"total",     labels:["total","total giving","lifetime","lifetime giving","total donated","cumulative giving"] },
  { key:"lastAmount",labels:["last gift amount","last amount","last donation amount","recent gift","most recent gift"] },
  { key:"lastGift",  labels:["last gift date","last donation date","most recent date","last gift"] },
  { key:"gifts",     labels:["gifts","gift count","# gifts","number of gifts","donations","gift #","# donations"] },
  { key:"status",    labels:["status","donor status","type"] },
  // BUILD-84 P0-2 — an organization is a donor. Mapped on its own, never
  // folded into `name`: when a row carries both, the organization IS the
  // donor and the person in `name` becomes the contact on it.
  { key:"organization", labels:["organization","organisation","org","org name","organization name","organisation name","company","company name","business","business name","institution","employer name"] },
  { key:"city",      labels:["city","town"] },
  { key:"state",     labels:["state","province","region"] },
  // BUILD-84 P0-4 — the map geocodes from the stored address, so the CSV path
  // has to be able to carry one.
  { key:"address",   labels:["address","street","street address","address 1","address line 1","mailing address"] },
  { key:"zip",       labels:["zip","zip code","postal","postal code","postcode","zipcode"] },
  { key:"notes",     labels:["notes","note","comments","memo"] },
  // owner = the gift officer this donor is assigned to (Team import routing). The
  // raw cell value is matched to an org user (email→name) before submit; on Core
  // it's ignored server-side. Labels mirror importShape.js's OWNER_HDR_PAT.
  { key:"owner",     labels:["assigned officer","assigned to","owner","solicitor","gift officer","relationship manager","account manager","managed by","assigned fundraiser"] },
  // BUILD-58 Part 2 — safety flags, never silently discarded again. Values
  // parse through parseBoolFlag; deceased blocks ALL outbound mail,
  // doNotContact blocks marketing (donorMailDecision, server-side).
  // BUILD-94 Part 1 — a column holding an image URL. Equal Force, Bloomerang
  // and Little Green Light all export one, each under a different name. The
  // URL is FETCHED at import time under the BUILD-37 G5 rules (https only, no
  // private ranges, no metadata endpoints, 10s timeout) and a failure costs
  // that row its photo and nothing else.
  { key:"photo",     labels:["photo","photo url","photo_url","photourl","image","image url","image_url","picture","picture url","headshot","avatar","profile photo","profile image","constituent photo","photo link"] },
  { key:"deceased",     labels:["deceased","is deceased"] },
  { key:"doNotContact", labels:["do not contact","do not solicit","do not mail","do not email","dnc","dns","no contact"] },
  // BUILD-101 Part 6 — memberships. No label matching here: a bare "Level" or
  // "Expires" is claimed only when shared/membershipImport.js recognises the
  // whole file as a membership file (a level AND a membership date).
  ...MEMBERSHIP_FIELDS.map(key => ({ key, labels: [] })),
];
const VALID_IMPORT_KEYS = new Set([...CSV_FIELDS.map(f => f.key), "_firstName", "_lastName"]);
// FIX (2026-09-09) — the CSV donor shape's standard vocabulary in the shape the
// ONE column-target dropdown takes. Labels are what a person reads, not the
// internal key: "lastAmount" was rendered raw in the old flat list.
const CSV_FIELD_LABELS = {
  name: "Full name", email: "Email", phone: "Phone", total: "Lifetime giving",
  lastAmount: "Last gift amount", lastGift: "Last gift date", gifts: "Gift count",
  status: "Status", organization: "Organization", city: "City", state: "State",
  address: "Address", zip: "ZIP", notes: "Notes", owner: "Owner",
  deceased: "Deceased", doNotContact: "Do not contact", photo: "Photo",
  ...MEMBERSHIP_FIELD_LABELS,
};
const CSV_STANDARD_FIELDS = [
  { key: "_firstName", label: "First name" },
  { key: "_lastName", label: "Last name" },
  ...CSV_FIELDS.map(f => ({ key: f.key, label: CSV_FIELD_LABELS[f.key] || f.key,
                            flag: f.key === "deceased" || f.key === "doNotContact" })),
  { key: "deceased", label: "Deceased" },
  { key: "doNotContact", label: "Do not contact" },
].filter((f, i, arr) => arr.findIndex(x => x.key === f.key) === i)
 .map(f => ({ ...f, flag: false }));

// FIX (2026-09-09) item 3 — WHOLE-HEADER MATCHING, never substring. The old
// rule was `h.includes(label)`, which is how a 30-column prospect-research
// export mapped `contact_confidence` to NAME (it contains "contact"),
// `capacity_estimate` to CITY (it contains "capacity"→"city") and `region_code`
// to STATE. This is the same defect BUILD-82 fixed for the workbook mapper
// ("Unnamed: 31" became the name column and threw away 23,867 donors); the CSV
// path still had it. A label now matches only as the WHOLE normalised header or
// a whole word-run inside it — "last gift date" still matches "Last Gift Date",
// "contact" no longer matches "contact_confidence".
// BUILD-84 census — the normaliser, the qualifier list and the whole-token
// matcher moved to shared/importShape.js (normalizeHeader / MEASUREMENT_QUALIFIERS
// / headerMatchesLabel) so the CSV mapper, the workbook mapper and the value
// scanner all read ONE definition of what a column header means. The copy that
// lived here is why P0-1 could ship: the mapper knew "min" was a measurement
// and the scanner did not.
const _headerMatchesLabel = headerMatchesLabel;
function guessField(header) {
  if (!header || !String(header).trim()) return "";
  const h = String(header).toLowerCase().trim();
  // BUILD-58 Part 2 — the flag columns come FIRST: "Do Not Contact" used to
  // hit the negator list below and be silently dropped from the mapping.
  const flags = detectFlagColumns([header]);
  if (flags.deceasedCol) return "deceased";
  if (flags.doNotContactCol) return "doNotContact";
  // Reject headers that signal a negation/flag ("do not email", "opt out of email", etc.)
  // BUILD-84 census — a negator phrase matches as a whole token run, not as
  // letters: `h.includes("no mail")` refused "Casino Mailing List", and
  // `h.includes("do not")` would refuse any header containing "…do notes".
  if (NEGATOR_PHRASES.some(n => containsTokenRun(header, n))) return "";
  // Separate first/last name columns → internal keys combined into name on build
  if (h === "first" || h === "first name" || h === "firstname" || h === "given name") return "_firstName";
  if (h === "last"  || h === "last name"  || h === "lastname"  || h === "surname" || h === "family name") return "_lastName";
  for (const f of CSV_FIELDS) {
    if (f.labels.some(l => _headerMatchesLabel(header, l))) return f.key;
  }
  return "";
}

// cp1252RowNames(report, parsed) — which donors' NAMES the per-line encoding
// repair touched: map each repaired physical line onto the body row that spans
// it (rowLines is each row's starting line), then pull the best name cell.
function cp1252RowNames(report, parsed) {
  if (!report?.cp1252Lines?.length || !report.rowLines?.length || !parsed?.rows) return [];
  const names = new Set();
  for (const line of report.cp1252Lines) {
    // last row whose starting line ≤ the repaired line
    let idx = -1;
    for (let i = 0; i < report.rowLines.length; i++) {
      if (report.rowLines[i] <= line) idx = i; else break;
    }
    const row = idx >= 0 ? parsed.rows[idx] : null;
    if (!row) continue;
    const name = row.Name || row.name || [row["First Name"], row["Last Name"]].filter(Boolean).join(" ");
    if (name) names.add(String(name).trim());
  }
  return [...names];
}

// BUILD-79 Part 2.3 — reason keys the reconciliation panel renders with real
// language. "already on file" used to cover BOTH a record that pre-dated the
// import AND another row of the same file — in a fresh org that read as 1,327
// phantom pre-existing records.
const IMPORT_REASON_LABELS = {
  already_in_steward: "already in Steward before this import",
  already_on_file: "already in Steward before this import", // legacy key from older servers
  duplicate_within_this_import: "duplicate rows within this file (collapsed)",
  // BUILD-80 Part 5 — rows that are not gifts, routed to their own surfaces
  soft_credit: "soft credits — a link to the real gift, never money",
  pledge_commitment: "pledge commitments — on the record, never in totals",
  pledge_scheduled: "future pledge installments — the schedule, not failed rows",
  in_kind: "in-kind gifts — recorded at fair market value, never cash",
  positive_reversal: "reversals with a POSITIVE amount — a human must decide",
  unrecognized_exclusion_value: "unrecognised value in an exclusion column",
  // BUILD-84 P0-2 — the set-aside vocabulary, matching NAMEABILITY_REASON so
  // the receipt, the pre-write line and the downloadable file all say the
  // same sentence (the promise-field rule).
  no_donor_identity: "no name, email, or organization",
};

// The slice of an analyzeSheetRows result the importers carry as the parse
// report (chrome banner, record count, the file's own TOTAL row for Part 3.2).
function reportFromAnalysis(a) {
  return { records: a.records, rowLines: a.rowLines, chromeAbove: a.chromeAbove,
           chromeRows: a.chromeRows, totalRow: a.totalRow, headerLine: a.headerLine };
}

// ── Shared file-parsing helper ────────────────────────────────────────────
// Replaces the identical ~45-line xlsx/CSV block duplicated in each importer.
async function parseFileToSheets(file, { onSingle, onMulti, onWorkbook, onError }) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    try {
      // BUILD-54 §1 — xlsx is ~450KB minified and only needed the moment a
      // spreadsheet is actually dropped; loading it lazily keeps it out of
      // the Donors route chunk every CRM session pays to parse.
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      // BUILD-82 — A WORKBOOK IS ONE IMPORT. The file is read ONCE, typed
      // (number formats, formulas, hidden rows/cols, fills, comments ride
      // along), every sheet gets a role with evidence, and the whole thing
      // goes to the workbook flow — including a single-sheet xlsx, so a
      // legacy gift sheet with only an ID column still imports by Donor ID.
      const wb = XLSX.read(new Uint8Array(buf), { type:"array", cellNF:true, cellFormula:true, cellStyles:true });
      const raw = extractWorkbookFromSheetJS(wb, XLSX);
      const sheets = raw.map(s => {
        if (!s.records.length) return { name:s.name, headers:[], rows:[], typedRows:[], rowCount:0, chromeRows:[], chromeAbove:[], meta:s.meta, formulaCellRatio:s.formulaCellRatio };
        const a = analyzeWorkbookSheet(s.records);
        return { name:s.name, ...a, rowCount:a.records, meta:s.meta, formulaCellRatio:s.formulaCellRatio };
      });
      const roled = classifyWorkbookSheets(sheets);
      if (!roled.some(s => s.rowCount > 0)) { onError("No data rows found in this file."); return; }
      onWorkbook({ roled });
    } catch(ex) { onError(isProgrammerError(ex) ? errorMessage(ex) : "Could not read Excel file: " + ex.message); }
  } else {
    // BUILD-79 Part 1 — the report-export layer. Decode strictly (per-LINE
    // windows-1252 repair, never whole-file — a mixed file must not have its
    // valid UTF-8 names corrupted), then find the header by EVIDENCE instead
    // of assuming line 1, classify the chrome (title/generated lines, repeated
    // headers, Page N of M, TOTAL, End of report) by line number, and count
    // records ONCE. "Rows in your file" is analysis.records everywhere.
    try {
      const buf = await file.arrayBuffer();
      const dec = decodeSpreadsheetBytesDetailed(new Uint8Array(buf));
      const analysis = analyzeCsvText(dec.text);
      if (!analysis.rows.length) { onError("No rows found."); return; }
      onSingle(analysis.headers, analysis.rows, analysis.physical, { ...reportFromAnalysis(analysis), cp1252Lines: dec.cp1252Lines, mojibakeRepaired: dec.mojibakeRepaired || 0, mojibakeRepairs: dec.mojibakeRepairs || [] });
    } catch (ex) { onError(isProgrammerError(ex) ? errorMessage(ex) : "Could not read file: " + ex.message); }
  }
}

// ── Module-level column auto-mapper ──────────────────────────────────────
// Extracted from DonorImport so CombinedImport can reuse it.
function buildAutoMapping(headers, rows = []) {
  const guesses = headers.map(h => ({ h, g: guessField(h) }));
  const hasSingleName = guesses.some(x => x.g === "name");
  const auto = {};
  // FIX (2026-09-09) item 3 — a guess that duplicates a target another column
  // already took is DROPPED, not made. Two columns cannot become one field, and
  // an automatic mapping is the last place that should be discovered: the
  // 30-column export put contact_name and contact_confidence on `name` and the
  // second silently won. First header wins; the rest are left for a human.
  const taken = new Set();
  guesses.forEach(({ h, g }) => {
    if (!g) return;
    if (hasSingleName && (g === "_firstName" || g === "_lastName")) return;
    if (taken.has(g)) return;
    // BUILD-79 Part 5 — every guess passes its own type check over the FULL
    // values (a 10-row sample once let phone-shaped columns map to email).
    if (!validateMappingChoice(headers, rows, h, g).ok) return;
    auto[h] = g;
    taken.add(g);
  });
  return auto;
}

// ── Module-level donor row normalization ──────────────────────────────────
// Extracted from DonorImport's built useMemo so CombinedImport can share it.
// BUILD-94 Part 2 — `people` carries the Mailchimp preset's answers:
//   { fileStatus, statusHeader, tagsHeader, applyTagTypes, defaultType }
// Absent (every other file) ⇒ every row is a Donor and reachable, which is
// byte-identical to what this function did before the argument existed.
function buildDonorRows(parsed, mapping, rowLines, basis, people) {
  if (!parsed) return { ready:[], warned:[], skipped:[] };
  // BUILD-84 P0-3 — a stage may only be inferred from an input this import
  // actually has. With no amount and no date mapped there is nothing to infer
  // from, and everyone lands in ONE stage rather than a fabricated split.
  const stageBasis = basis || stageAssignmentBasis({
    total: Object.values(mapping).includes("total"),
    lastAmount: Object.values(mapping).includes("lastAmount"),
    lastGift: Object.values(mapping).includes("lastGift"),
  });
  const ready = [], warned = [], skipped = [];
  parsed.rows.forEach((row, idx) => {
    const d = {};
    const warnings = [];
    const rowLabel = `Row ${idx + 2}`;
    Object.entries(mapping).forEach(([h, field]) => {
      if (!field) return;
      const raw = row[h];
      if (raw instanceof Date) { d[field] = isNaN(raw) ? "" : raw.toISOString().split("T")[0]; }
      else { d[field] = raw === null || raw === undefined ? "" : String(raw); }
    });
    if (d._firstName || d._lastName) {
      const combined = [String(d._firstName??"").trim(), String(d._lastName??"").trim()].filter(Boolean).join(" ");
      if (!d.name || !String(d.name).trim()) d.name = combined;
    }
    delete d._firstName; delete d._lastName;
    // BUILD-84 P0-2 — nameability is decided by ONE function (shared with the
    // transaction path and the workbook): a person name, an email, OR an
    // organization. An organization row is a first-class donor, and a contact
    // person on the same row rides as the contact, not as the donor's name.
    const ident = resolveDonorIdentity({ name: d.name, organization: d.organization, email: d.email });
    delete d.organization;
    if (!ident.nameable) { skipped.push({ row:idx+2, reason: NAMEABILITY_REASON }); return; }
    if (!ident.hasName) {
      // BUILD-79 Part 5 — a display name never falls back to email/phone.
      d.name = `Unnamed donor (line ${rowLines?.[idx] ?? idx + 2})`;
      d.tags = ["needs-name"];
      warnings.push(`${rowLabel}: no name — flagged as unnamed for review`);
    } else {
      d.name = normalizeName(ident.displayName); // B2 — tidy Last,First / ALL-CAPS in the preview (editable)
      if (ident.contactName) d.contactName = normalizeName(ident.contactName);
      if (ident.kind && ident.kind !== "person") d.kind = ident.kind;
      else d.kind = "person";
    }
    if (d.email !== undefined) { const {value,warn} = normalizeEmail(d.email); d.email=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.phone) d.phone = String(d.phone).trim() || null;
    if (d.total !== undefined && d.total !== "") { const {value,warn} = normalizeMoney(d.total); d.total=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.lastAmount !== undefined && d.lastAmount !== "") {
      const s = String(d.lastAmount||"");
      if (/^\d{4}[-/]\d{2}/.test(s)) { d.lastAmount=null; }
      else { const {value,warn} = normalizeMoney(d.lastAmount); d.lastAmount=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    }
    if (d.lastGift !== undefined && d.lastGift !== "") { const {value,warn} = normalizeDate(d.lastGift); d.lastGift=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.gifts !== undefined && d.gifts !== "") d.gifts = parseInt(d.gifts) || null;
    // Initial pipeline stage: an explicit stage column always wins; otherwise
    // infer from giving history (this donor-only flow's history IS the aggregate
    // total/last-gift columns). `_stageExplicit` tells the server not to
    // re-infer over it in the combined/history import paths.
    const _explicitStage = normalizeStage(d.stage);
    d.stage = _explicitStage
      || (stageBasis.hasGivingData
            ? inferStage(d.total, d.lastGift, !!(d.email || d.phone))
            : stageBasis.fallbackStage);
    d._stageExplicit = !!_explicitStage;
    if (d.city)  d.city  = String(d.city).trim()  || null;
    if (d.state) d.state = String(d.state).trim()  || null;
    if (d.deceased !== undefined) d.deceased = parseBoolFlag(d.deceased);
    if (d.doNotContact !== undefined) d.doNotContact = parseBoolFlag(d.doNotContact);
    // BUILD-94 Part 2 — what this person is, and whether they are reachable.
    if (people) {
      const sug = people.applyTagTypes && people.tagsHeader
        ? typeSuggestionForTags(row[people.tagsHeader]) : null;
      d.personTypes = [sug || people.defaultType || "other"];
      // AN UNSUBSCRIBED CONTACT IMPORTS AS UNSUBSCRIBED. Never as reachable.
      if (rowIsUnsubscribed(row, { fileStatus: people.fileStatus, statusHeader: people.statusHeader })) {
        d.unsubscribed = true;
      }
    }
    if (warnings.length) warned.push({ ...d, _warnings:warnings, _rowIndex:idx+2 });
    else ready.push(d);
  });
  return { ready, warned, skipped };
}

// ── Combined-row builder (donor + year-column gifts in one pass) ──────────
// Used only by CombinedImport. Preserves rowIdx so gift attachments are exact.
function buildCombinedRows(parsed, donorMapping, yearCols, rowLines) {
  if (!parsed) return [];
  const activeCols = yearCols.filter(yc => yc.enabled && yc.date);
  const results = [];
  parsed.rows.forEach((row, idx) => {
    const d = {};
    const warnings = [];
    const rowLabel = `Row ${idx + 2}`;
    Object.entries(donorMapping).forEach(([h, field]) => {
      if (!field) return;
      const raw = row[h];
      if (raw instanceof Date) { d[field] = isNaN(raw) ? "" : raw.toISOString().split("T")[0]; }
      else { d[field] = raw === null || raw === undefined ? "" : String(raw); }
    });
    if (d._firstName || d._lastName) {
      const combined = [String(d._firstName??"").trim(), String(d._lastName??"").trim()].filter(Boolean).join(" ");
      if (!d.name || !String(d.name).trim()) d.name = combined;
    }
    delete d._firstName; delete d._lastName;
    // BUILD-84 P0-2 — same one nameability test as the aggregate path.
    const ident = resolveDonorIdentity({ name: d.name, organization: d.organization, email: d.email });
    delete d.organization;
    if (!ident.nameable) { results.push({ rowIdx:idx, donor:null, gifts:[], warnings:[], skipped:true, skipReason: NAMEABILITY_REASON }); return; }
    if (!ident.hasName) { d.name = `Unnamed donor (line ${rowLines?.[idx] ?? idx + 2})`; d.tags = ["needs-name"]; warnings.push(`${rowLabel}: no name — flagged as unnamed for review`); }
    else {
      d.name = normalizeName(ident.displayName); // B2 — tidy Last,First / ALL-CAPS in the preview (editable)
      if (ident.contactName) d.contactName = normalizeName(ident.contactName);
      d.kind = ident.kind && ident.kind !== "person" ? ident.kind : "person";
    }
    if (d.email !== undefined) { const {value,warn} = normalizeEmail(d.email); d.email=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.phone) d.phone = String(d.phone).trim() || null;
    if (d.total !== undefined && d.total !== "") { const {value,warn} = normalizeMoney(d.total); d.total=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.lastAmount !== undefined && d.lastAmount !== "") {
      const s = String(d.lastAmount||"");
      if (/^\d{4}[-/]\d{2}/.test(s)) { d.lastAmount=null; }
      else { const {value,warn} = normalizeMoney(d.lastAmount); d.lastAmount=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    }
    if (d.lastGift !== undefined && d.lastGift !== "") { const {value,warn} = normalizeDate(d.lastGift); d.lastGift=value; if(warn) warnings.push(`${rowLabel}: ${warn}`); }
    if (d.gifts !== undefined && d.gifts !== "") d.gifts = parseInt(d.gifts) || null;
    if (d.city)  d.city  = String(d.city).trim()  || null;
    if (d.state) d.state = String(d.state).trim()  || null;
    if (d.deceased !== undefined) d.deceased = parseBoolFlag(d.deceased);
    if (d.doNotContact !== undefined) d.doNotContact = parseBoolFlag(d.doNotContact);
    // Derive the year-column gifts BEFORE inferring stage, so stage reflects the
    // real giving history (sum + latest gift date) — not the mapped total/
    // last-gift columns, which a wide year-column file usually doesn't have.
    // The server re-infers from the recalculated gift rows on import too; doing
    // it here keeps the preview honest and matching what actually gets saved.
    const gifts = activeCols.map(yc => {
      const {value:amtVal} = normalizeMoney(row[yc.col]);
      const amt = Math.round(amtVal || 0);
      return amt > 0 ? { amount:amt, date:yc.date, type:"cash", campaign:"" } : null;
    }).filter(Boolean);
    const _giftTotal = gifts.reduce((s,g) => s + g.amount, 0);
    // Gift dates are ISO YYYY-MM-DD, so lexicographic max === chronological max.
    const _lastGiftDate = gifts.length ? gifts.reduce((m,g) => g.date > m ? g.date : m, gifts[0].date) : null;
    const _explicitStage = normalizeStage(d.stage);
    d.stage = _explicitStage || inferStage(_giftTotal || d.total, _lastGiftDate || d.lastGift, !!(d.email || d.phone));
    d._stageExplicit = !!_explicitStage;
    results.push({ rowIdx:idx, donor:d, gifts, warnings, skipped:false });
  });
  return results;
}

// FIX (2026-09-10) — the ORG's civil today, for the import's future-date test.
// BUILD-72's rule is that every date boundary is computed in the ORGANIZATION's
// timezone: not the server's, not the browser's, and above all not UTC. Intl is
// the only correct way to ask what day it is somewhere (it knows the offset for
// this instant, DST and half-hour zones included). Falls back to the browser's
// own calendar when the org has no zone on file — still right far more often
// than UTC, which is a different day for a third of every day in the Americas.
function orgCivilToday(timezone) {
  try {
    if (timezone) return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch { /* an invalid zone falls through to the local calendar */ }
  return localCivilToday();
}

// ── Shape-aware payload builders ───────────────────────────────────────────
// All three return a common { donors, gifts, warnedCount, skippedCount }.
// `gifts` carry a `donorIndex` into `donors` — the exact { donors, gifts } shape
// /donors/import-combined consumes (server dedupes, attaches, recalcs, re-infers
// stage). This is what makes one uploaded file → donors + their giving history.

// AGGREGATE: one row per donor. `seedHistory` derives one real gift from the
// imported total + last-gift date so a brand-new org gets queryable gifts rows
// (not just aggregate donor fields) — same rationale as DonorImport's old
// `withHistory` flag, now the default for the magical one-file path.
function buildAggregatePayload(parsed, mapping, seedHistory, rowLines, stageBasis, people) {
  const { ready, warned, skipped } = buildDonorRows(parsed, mapping, rowLines, stageBasis, people);
  const donors = [...ready, ...warned].map(({ _warnings, _rowIndex, ...d }) => d);
  const gifts = [];
  if (seedHistory) {
    donors.forEach((d, idx) => {
      const amount = Math.round(parseFloat(d.total) || 0);
      if (amount > 0 && d.lastGift) gifts.push({ donorIndex: idx, amount, date: d.lastGift, type: "cash", campaign: "" });
    });
  }
  // BUILD-79 Part 3.4 — "N imported with warnings" with no warning visible is a
  // number, not information. The warnings ride out with their row index (the
  // caller maps index → physical line via the parse report) and download as CSV.
  const warnedRows = warned.map(w => ({ idx: (w._rowIndex ?? 2) - 2, reasons: w._warnings || [] }));
  const skippedRows = skipped.map(k => ({ idx: (k.row ?? 2) - 2, reason: k.reason }));
  return { donors, gifts, warnedCount: warned.length, skippedCount: skipped.length, warnedRows, skippedRows };
}

// TRANSACTION: one row per GIFT, donor repeated. Delegates to importShape's
// buildTransactionRows — the ONE accounted builder (BUILD-77 Parts 2+3):
// every physical row leaves with a disposition, no date ever defaults to
// today, refunds import as negative gifts, and the file-level counts are
// taken at parse entry and carried through unchanged.
function buildTransactionPayload(parsed, txMap, cfInputs, rowLines, dateConvention, today) {
  if (!parsed) return { donors: [], gifts: [], warnedCount: 0, skippedCount: 0, dispositions: [], flaggedRows: [], file: { rows: 0, dollars: 0, imported: 0, donorOnly: 0, skipped: 0, errored: 0 } };
  const built = buildTransactionRows(parsed, txMap, {
    rowLines,
    // The ORG's calendar decides what "future-dated" means — see orgCivilToday.
    today,
    // BUILD-80 Part 2.2 — a human's answer to a mixed-convention date column;
    // otherwise the builder infers from the column's own evidence.
    dateConvention: dateConvention || undefined,
    // BUILD-78 — exclusion-shaped columns route to the flag family; custom
    // columns coerce per type and a failed value refuses the row pre-write.
    flagColumns: cfInputs ? cfInputs.flagColumns : {},
    cfColumns: cfInputs ? cfInputs.cfColumns : [],
    exclusionColumns: cfInputs ? (cfInputs.exclusionColumns || []) : [],
    coerceCustomValue, parseBoolValue, parseExclusionValue,
  });
  return { ...built,
    warnedCount: 0,
    skippedCount: built.file.skipped + built.file.errored };
}

// WIDE: one row per donor, year columns → one gift per funded year.
function buildWidePayload(parsed, donorMapping, yearCols, rowLines) {
  const rows = buildCombinedRows(parsed, donorMapping, yearCols, rowLines);
  const valid = rows.filter(r => !r.skipped);
  const donors = valid.map(({ donor }) => { const { _warnings, _rowIndex, ...d } = donor; return d; });
  const gifts = [];
  valid.forEach(({ gifts: rg }, idx) => rg.forEach(g => gifts.push({ ...g, donorIndex: idx })));
  return { donors, gifts, warnedCount: valid.filter(r => r.warnings.length).length, skippedCount: rows.filter(r => r.skipped).length };
}

// Chunked submit with progress — the other half of the hang fix. Donors are
// sent 500 at a time so each request returns fast (real progress, and no single
// request long enough to hit a platform timeout). Each chunk is self-contained:
// its gifts are re-indexed to the chunk's local donor positions. Cross-chunk
// email dedup is handled server-side (chunk N sees chunk N-1's committed rows).
async function submitImportChunked(donorsIn, gifts, onProgress, extras) {
  let donors = donorsIn;
  const CHUNK = 500;
  // BUILD-99 Part 6 — the open asks ride the same chunked submit and are
  // RE-INDEXED to each chunk's local donor positions exactly as the gifts are.
  // A proposal whose donorIndex still pointed at the whole file's numbering would
  // land on whoever happened to sit at that position in chunk two.
  const proposals = (extras && Array.isArray(extras.proposals)) ? extras.proposals : [];
  const hasGifts = gifts.length > 0;
  // BUILD-101 Part 6 — memberships ride the LAST chunk, when every person in
  // the file already exists to put them on. The membership columns never
  // reach a donor row.
  const memberships = (extras && Array.isArray(extras.memberships)) ? extras.memberships : [];
  donors = donors.map(d => { const o = { ...d }; for (const f of MEMBERSHIP_FIELDS) delete o[f]; return o; });
  const giftsByDonor = new Map();
  for (const g of gifts) {
    if (!giftsByDonor.has(g.donorIndex)) giftsByDonor.set(g.donorIndex, []);
    giftsByDonor.get(g.donorIndex).push(g);
  }
  const propsByDonor = new Map();
  for (const p of proposals) {
    if (p.donorIndex == null) continue;
    if (!propsByDonor.has(p.donorIndex)) propsByDonor.set(p.donorIndex, []);
    propsByDonor.get(p.donorIndex).push(p);
  }
  const totals = { created: 0, giftsInserted: 0, duplicates: 0, duplicatesOnFile: 0, duplicatesInFile: 0, donorsUpdated: 0, financeSynced: 0, batchErrors: [], twinCandidates: 0,
    // BUILD-72 Part 1 — the file-level reconciliation, summed across chunks.
    // The server asserts it per request; this is what the user is shown.
    donorsMatched: 0, matchesExistingCount: 0, roundingAdjustment: 0, fundsCreated: 0,
    reconciliation: { rows: { inFile: 0, created: 0, skipped: 0, errored: 0 },
                      dollars: { inFile: 0, created: 0, skipped: 0, errored: 0 },
                      skippedReasons: {}, erroredReasons: {}, balanced: true },
    // BUILD-99 Part 6 — the open asks, counted like everything else so the
    // receipt can say what became of them.
    proposals: { written: 0, skippedDuplicate: 0, stageDefaulted: 0, probabilityDropped: 0, unresolved: [] },
    // BUILD-101 Part 6 — what became of every membership row: written, already
    // on file, or held with its line and reason (the file's own set-asides first).
    memberships: { rows: memberships.length + ((extras && extras.membershipsSetAside) || []).length, written: 0, skippedDuplicate: 0,
                   held: [...((extras && extras.membershipsSetAside) || [])] },
    duplicateGroups: [] };
  const total = donors.length;
  if (!total) return totals;
  for (let start = 0; start < total; start += CHUNK) {
    const slice = donors.slice(start, start + CHUNK);
    let res;
    const chunkProposals = [];
    slice.forEach((_, localIdx) => {
      const pp = propsByDonor.get(start + localIdx);
      if (pp) pp.forEach(p => { const { donorIndex, ...rest } = p; chunkProposals.push({ ...rest, donorIndex: localIdx }); });
    });
    const isLast = start + CHUNK >= total;
    const chunkMemberships = isLast ? memberships : [];
    if (hasGifts || chunkProposals.length || chunkMemberships.length) {
      const chunkGifts = [];
      slice.forEach((_, localIdx) => {
        const gg = giftsByDonor.get(start + localIdx);
        if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: localIdx }); });
      });
      res = await apiFetch("/donors/import-combined", { method: "POST", body: JSON.stringify({ donors: slice, gifts: chunkGifts,
        ...(chunkProposals.length ? { proposals: chunkProposals } : {}),
        ...(chunkMemberships.length ? { memberships: chunkMemberships } : {}),
        // BUILD-78 — the column ledger + saved mappings ride every chunk
        // (idempotent server-side); the ledger is validated per request.
        ...(extras ? { columns: extras.columns, fieldMappings: extras.fieldMappings, customFieldDelimiters: extras.customFieldDelimiters,
                       identityResolved: extras.identityResolved === true } : {}) }) });
    } else {
      res = await apiFetch("/donors/import", { method: "POST", body: JSON.stringify({ donors: slice }) });
    }
    totals.created       += res.created       || 0;
    totals.giftsInserted += res.giftsInserted || 0;
    totals.duplicates    += res.duplicates    || 0;
    totals.duplicatesOnFile += res.duplicatesOnFile || 0;
    totals.duplicatesInFile += res.duplicatesInFile || 0;
    totals.twinCandidates += (res.duplicateCandidates && res.duplicateCandidates.withinFile) || 0;
    totals.donorsUpdated += res.donorsUpdated || 0;
    totals.financeSynced += res.financeSynced || 0;
    totals.donorsMatched += res.donorsMatched || 0;
    totals.matchesExistingCount += res.matchesExistingCount || 0;
    totals.roundingAdjustment += res.roundingAdjustment || 0;
    totals.fundsCreated  += res.fundsCreated  || 0;   // BUILD-88a A.7
    if (res.proposals) {                              // BUILD-99 Part 6
      totals.proposals.written += res.proposals.written || 0;
      totals.proposals.skippedDuplicate += res.proposals.skippedDuplicate || 0;
      totals.proposals.stageDefaulted += res.proposals.stageDefaulted || 0;
      totals.proposals.probabilityDropped += res.proposals.probabilityDropped || 0;
      if (res.proposals.unresolved?.length) totals.proposals.unresolved.push(...res.proposals.unresolved);
    }
    if (res.memberships) {                            // BUILD-101 Part 6
      totals.memberships.written += res.memberships.written || 0;
      totals.memberships.skippedDuplicate += res.memberships.skippedDuplicate || 0;
      if (res.memberships.held?.length) totals.memberships.held.push(...res.memberships.held);
      if (res.memberships.error) totals.memberships.held.push({ line: null, why: "the memberships could not be written: " + res.memberships.error });
    }
    if (res.duplicateGroups?.length) totals.duplicateGroups.push(...res.duplicateGroups);
    // Sum the per-request equations into one file-level equation. If ANY chunk
    // failed to balance the whole file is reported unbalanced — a file is only
    // reconciled if every part of it was.
    const rr = res.reconciliation;
    if (rr) {
      for (const axis of ["rows", "dollars"])
        for (const k of ["inFile", "created", "skipped", "errored"])
          totals.reconciliation[axis][k] += rr[axis][k] || 0;
      for (const [reason, v] of Object.entries(rr.skippedReasons || {})) {
        const e = totals.reconciliation.skippedReasons[reason] || (totals.reconciliation.skippedReasons[reason] = { rows: 0, dollars: 0 });
        e.rows += v.rows; e.dollars += v.dollars;
      }
      for (const [reason, v] of Object.entries(rr.erroredReasons || {})) {
        const e = totals.reconciliation.erroredReasons[reason] || (totals.reconciliation.erroredReasons[reason] = { rows: 0, dollars: 0 });
        e.rows += v.rows; e.dollars += v.dollars;
      }
      if (rr.balanced === false) totals.reconciliation.balanced = false;
    }
    if (res.batchErrors?.length) totals.batchErrors.push(...res.batchErrors);
    if (onProgress) onProgress(Math.min(start + CHUNK, total), total);
  }
  return totals;
}

// ── "Import both" payload builder ──────────────────────────────────────────
// A multi-sheet workbook that carries a Donors sheet AND a Gift History sheet:
// build donor rows from the donor sheet, one gift item per gift-ledger row, then
// link the gifts to the donors by the chosen match column (email/name/donor-id).
// Returns the common { donors, gifts:[{donorIndex}] } shape the chunked submit +
// /donors/import-combined already consume, plus the counts the preview shows.
function buildBothPayload(donorSheet, giftSheet, matchInfo, matchKey) {
  // Donor rows from the donor sheet. Year columns (if any) stay out of the donor
  // grid; the real history comes from the gift sheet, so we do NOT seed history
  // from the donor sheet's totals here (that would double-count).
  const donorHeaders = (donorSheet.headers || []).filter(h => !YEAR_HDR_PAT.test(String(h)));
  const donorMapping = buildAutoMapping(donorHeaders, donorSheet.rows);
  if (matchInfo.donorIdCol) donorMapping[matchInfo.donorIdCol] = "_donorId";
  const { ready, warned, skipped } = buildDonorRows({ headers: donorSheet.headers, rows: donorSheet.rows }, donorMapping);
  // Keep _stageExplicit (server honors it) + _donorId (linkGiftsToDonors strips it).
  const donors = [...ready, ...warned].map(({ _warnings, _rowIndex, ...d }) => d);

  // One gift item per gift-ledger row — through the ONE accounted builder
  // (BUILD-58 Part 2): externalId rides each gift (the F-4 idempotency key
  // this surface used to DROP), and every skipped row gets a stated reason.
  const tx = autoDetectTxMapping(giftSheet.headers, giftSheet.rows);
  const idCol = matchInfo.giftIdCol;
  const { items, report } = buildGiftItemsFromLedger(giftSheet.rows || [], tx, idCol);

  // Column accounting for BOTH sheets (the class fix): mapped / deliberately
  // ignored (year columns — history comes from the gift sheet) / unrecognized.
  const yearIgnored = (donorSheet.headers || []).filter(h => YEAR_HDR_PAT.test(String(h)));
  const donorColumns = classifyColumns(donorSheet.headers || [], donorMapping, yearIgnored);
  const giftMapping = {};
  Object.entries(tx).forEach(([role, h]) => { if (h) giftMapping[h] = role; });
  if (idCol) giftMapping[idCol] = giftMapping[idCol] || "donor id (match key)";
  const giftColumns = classifyColumns(giftSheet.headers || [], giftMapping, []);

  const linked = linkGiftsToDonors(donors, items, matchKey);
  return {
    ...linked,                                   // donors, gifts, matchedGifts, unmatchedGifts, newDonors, skippedGifts
    donorSheetRows: donors.length,               // donors that came from the donor sheet
    donorWarned: warned.length,
    donorSkipped: skipped.length,
    giftRows: (giftSheet.rows || []).length,
    rowReport: report,                           // negative/unparsable/zero rows, by count + reason
    columnReports: { donorSheet: donorColumns, giftSheet: giftColumns },
  };
}

// ── DonorImport component ──────────────────────────────────────────────────
// Exported so WelcomePage's onboarding flow can reuse it directly as the
// centerpiece "Import your donors" step, rather than forking/rebuilding it.
// `withHistory` (used only by onboarding — the regular Donors tab's "Import
// Donors" button always omits it, so its behavior is unchanged): when true,
// also derives one real `gifts` row per donor from their imported total/
// last-gift-date and posts through /donors/import-combined instead of the
// plain /donors/import. Without this, a brand-new org's donor records only
// ever get aggregate fields — no queryable gifts/interactions rows — which
// is why Retention Rate, Stewardship Debt, and Gifts YTD render blank
// immediately after onboarding for every org that isn't shown the OTHER
// import button, buried in the regular Donors tab, after the fact.
export function DonorImport({ onClose, onImported, withHistory = false, org = null, onOpenHome = null }) {
  // The org's civil today, for the future-date test (BUILD-72's rule).
  const orgToday = orgCivilToday(org?.timezone);
  const [csvText,    setCsvText]    = useState("");
  const [srcFile,    setSrcFile]    = useState(null);       // the uploaded File (name/size for the file tile)
  const [parsed,     setParsed]     = useState(null);       // { headers:[], rows:[] }
  const [xlsxSheets, setXlsxSheets]= useState(null);       // [{name, rowCount, headers, rows}] | null (legacy multi-sheet path — CSV only now)
  const [workbook,   setWorkbook]   = useState(null);       // BUILD-82 — the one-import workbook flow ({roled})
  const [mapping,    setMapping]    = useState({});         // aggregate + wide donor-field mapping
  const [txMap,      setTxMap]      = useState({ donorName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"",phone:"",city:"",state:"",owner:"",externalId:"" });
  const [yearCols,   setYearCols]   = useState([]);         // wide year columns
  const [yearConvention, setYearConvention] = useState("dec31");
  const [shape,      setShape]      = useState("aggregate");// auto-detected file shape
  const [shapeDetail, setShapeDetail] = useState(null);      // BUILD-79 Part 2 — the detection's evidence { reason, recognized, … }
  const [shapeOverride, setShapeOverride] = useState(null); // user override, if any
  const [bothMode,   setBothMode]   = useState(null);       // { donorSheet, giftSheet, matchInfo } when "Import both" is chosen
  const [matchKey,   setMatchKey]   = useState("email");    // gift→donor link column in both-mode
  const [loading,    setLoading]    = useState(false);
  const [ackUnmapped, setAckUnmapped] = useState(false);    // BUILD-77 Part 3d — homeless columns require an explicit acknowledgement (aggregate/wide shapes)
  // ── BUILD-78 — the column mapper (transaction shape) ──
  const [physicalCols, setPhysicalCols] = useState(null);   // { headerCells, orphanColumns, overflowRows, total } — parse entry, never derived from the mapping
  const [parseReport, setParseReport] = useState(null);
  const [mapRefusal, setMapRefusal] = useState(null);       // BUILD-79 Part 5 — last refused mapping choice + its evidence
  // FIX (2026-09-09) — a CSV donor column can now land in a custom field too,
  // so the donor mapper carries the same two-axis decision the workbook does:
  // `mapping` for standard targets, `donorCfChoices` for custom ones.
  const [donorCfChoices, setDonorCfChoices] = useState({});  // header → {fieldId,key,entity,label}
  const [dateConventionChoice, setDateConventionChoice] = useState(null); // BUILD-80 Part 2.2 — a human's answer for a MIXED date column     // BUILD-79 Part 1 — { records, chromeAbove, chromeRows, totalRow, headerLine, cp1252Lines } from parse entry
  const [cfDefs, setCfDefs] = useState({ donor: [], gift: [] });
  const [savedCfMappings, setSavedCfMappings] = useState([]);
  const [cfDecisions, setCfDecisions] = useState({});       // columnIndex → { action, entity?, type?, label?, options?, role? }
  const [progress,   setProgress]   = useState(null);       // { done, total } during chunked submit
  const [flaggedPage,setFlaggedPage]= useState(1);          // A.7 — the flagged list pages at 50 DONORS
  const [aiLoading,  setAiLoading]  = useState(false);
  const [result,     setResult]     = useState(null);       // {created,giftsInserted,duplicates,warned,skipped,batchErrors}
  const [err,        setErr]        = useState("");
  const [upgradeInfo,setUpgradeInfo]= useState(null);

  // ── Officer routing (Team) — map an owner/officer column to org users so each
  // donor lands in the right officer's portfolio on import (pairs with the
  // pipeline-portfolio model). Core orgs never see this (isTeam=false → the
  // panel is hidden and the server ignores any assignment). ────────────────────
  const { auth } = useAuth();
  const [orgUsers,   setOrgUsers]   = useState([]);   // [{id,name,email,role}]
  const [isTeam,     setIsTeam]     = useState(false);
  const [ownerMap,   setOwnerMap]   = useState({});   // rawOwnerValue → userId | "" (unassigned)
  const [bulkAssign, setBulkAssign] = useState("");   // no-owner-column case: "" | "__me__" | userId
  const [inviteFor,  setInviteFor]  = useState(null); // owner value being invited
  const [inviteEmail,setInviteEmail]= useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr,  setInviteErr]  = useState("");
  const [invitedValues,setInvitedValues]= useState({}); // owner value → true once invited
  const myId = auth?.user?.id || "";
  const myName = auth?.user?.name || auth?.user?.email || "";

  const loadOfficers = () => apiFetch("/portfolio/officers").then(r => {
    setIsTeam(r?.tier === "team");
    // Active users AND pending invitees, so an owner value can match/assign to
    // someone who's only been invited. A pending invitee's synthetic id is
    // "invite:<id>" — the server resolver holds the assignment until they accept.
    const active = (r?.officers || []).map(o => ({ id:o.id, name:o.name, email:o.email, role:o.role, pending:false }));
    const pending = (r?.invites || []).map(i => ({ id:"invite:"+i.id, name:i.name, email:i.email, pending:true }));
    setOrgUsers([...active, ...pending]);
    return { active, pending };
  }).catch(()=>({ active:[], pending:[] }));

  useEffect(() => { loadOfficers(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    apiFetch("/custom-fields?entity=donor").then(r=>setCfDefs(p=>({...p,donor:Array.isArray(r)?r:[]}))).catch(()=>{});
    apiFetch("/custom-fields?entity=gift").then(r=>setCfDefs(p=>({...p,gift:Array.isArray(r)?r:[]}))).catch(()=>{});
    apiFetch("/import-field-mappings").then(r=>setSavedCfMappings(Array.isArray(r)?r:[])).catch(()=>{});
  }, []);

  // FIX (2026-09-09) item 2 — TWO COLUMNS CANNOT BECOME ONE FIELD. A standard
  // target another column already claims is disabled in the dropdown, and the
  // Import button refuses by name if one slips through (an AI/auto guess, a
  // stale mapping). No standard donor field legitimately takes two sources:
  // first/last name are two DIFFERENT fields, and a second email is `email2`
  // on the workbook side — a shape that grows one gets an exception here, with
  // its reason, not a silent overwrite.
  const MULTI_SOURCE_DONOR_FIELDS = new Set();
  const takenDonorTargets = (exceptHeader) => {
    const taken = new Set();
    for (const [h, f] of Object.entries(mapping)) {
      if (!f || h === exceptHeader || MULTI_SOURCE_DONOR_FIELDS.has(f)) continue;
      taken.add(f);
    }
    return taken;
  };
  const duplicateDonorTargets = useMemo(() => {
    const byField = {};
    for (const [h, f] of Object.entries(mapping)) {
      if (!f || MULTI_SOURCE_DONOR_FIELDS.has(f)) continue;
      (byField[f] = byField[f] || []).push(h);
    }
    return Object.entries(byField).filter(([, hs]) => hs.length > 1)
      .map(([f, hs]) => ({ field: f, headers: hs }));
  }, [mapping]);

  const effectiveShape = shapeOverride || shape;
  // BUILD-79 Part 2.2 — totals mode refuses when >1/3 of keyed rows collapse
  // onto a key already seen in THIS file: that is a per-gift file. The rows
  // are all scanned (not a sample) against the columns the mapping actually
  // sends as email/name.
  const aggregateCollapse = useMemo(() => {
    if (effectiveShape !== "aggregate" || !parsed) return null;
    const emailCol = Object.keys(mapping).find(h => mapping[h] === "email") || "";
    const nameCol = Object.keys(mapping).find(h => mapping[h] === "name") || "";
    if (!emailCol && !nameCol) return null;
    return assessAggregateCollapse(parsed.rows, emailCol, nameCol);
  }, [effectiveShape, parsed, mapping]);
  const shapeBlocked = effectiveShape === "unknown" || (aggregateCollapse && aggregateCollapse.refuse);
  // BUILD-79 Part 5 — when most headers are unrecognised, one-click Auto-map
  // is demoted to an explicit contents-based guess with a warning.
  const headersUnrecognized = useMemo(() => {
    if (!parsed) return false;
    const hs = parsed.headers.filter(h => h && !/^_\d+$/.test(h));
    if (!hs.length) return true;
    const memberCols = new Set(Object.values(membershipColumns(hs)));   // BUILD-101 Part 6
    const recognized = hs.filter(h => guessField(h) || memberCols.has(h)).length;
    return recognized / parsed.headers.length < 0.5;
  }, [parsed]);

  // Multi-sheet workbook: detect a "Donors + Gift History" pair so we can offer
  // "Import both" above the per-sheet options. Runs detectImportShape per sheet.
  const workbookRoles = useMemo(
    () => (xlsxSheets && xlsxSheets.length >= 2 ? detectWorkbookRoles(xlsxSheets) : null),
    [xlsxSheets]
  );

  // Enter "Import both": pick the default link column (email → name → donor-id).
  const startImportBoth = () => {
    if (!workbookRoles?.isBoth) return;
    const matchInfo = pickMatchKey(workbookRoles.donorSheet, workbookRoles.giftSheet);
    setMatchKey(matchInfo.key);
    setBothMode({ donorSheet: workbookRoles.donorSheet, giftSheet: workbookRoles.giftSheet, matchInfo });
    setErr("");
  };

  const applyParsed = (headers, rows, physical, report) => {
    // BUILD-79 Part 3.1 — the independent dollar scan happens ONCE, at parse
    // entry, before any mapping exists to bias it.
    const amountScan = scanAmountShapedColumns(headers, rows);
    setParseReport(report ? { ...report, amountScan } : { amountScan });
    const det = detectImportShape(headers, rows);
    setShape(det.shape); setShapeOverride(null); setShapeDetail(det);
    // Donor-field mapping is over the non-year columns (year columns are gifts,
    // configured separately) so a wide file's donor grid stays clean.
    // ── BUILD-97 Part 1 — A RECOGNISED EXPORT'S PRESET OUTRANKS THE GUESS ───
    // `buildAutoMapping` reads one header at a time and knows nothing about
    // which system wrote the file. The NPSP preset knows both, so where it has
    // an answer it wins: `Account Name` is `organization` on a contact sheet
    // and `orgName` on a gift sheet, `Primary Campaign Source` is the FUND
    // (which no generic guess would reach), and `Stage` is a column the
    // generic mapper has no target for at all — unmapped, it would let a
    // Closed Lost row import as cash.
    //
    // Every header the preset does NOT name keeps whatever the generic guess
    // made of it, and the person can still change any of it: this is a
    // pre-filled answer, not a locked one.
    const npspAuto = detectNpsp(headers);
    const autoDonor = buildAutoMapping(headers.filter(h => !YEAR_HDR_PAT.test(String(h))), rows);
    // BUILD-101 Part 6 — a membership file's level and dates are MAPPED, not
    // left for a custom-field decision.
    for (const [field, header] of Object.entries(membershipColumns(headers))) autoDonor[header] = field;
    const autoTx = autoDetectTxMapping(headers, rows);
    if (npspAuto.isNpsp) {
      const pre = npspMapping(headers, { object: npspAuto.object });
      if (npspAuto.object === NPSP_OBJECT_OPPORTUNITY) {
        // txMap is field -> header (the inverse of the donor mapping's shape).
        const inv = {};
        for (const [header, field] of Object.entries(pre.mapping)) inv[field] = header;
        setMapping(autoDonor);
        setTxMap({ ...autoTx, ...inv });
      } else {
        setMapping({ ...autoDonor, ...pre.mapping });
        setTxMap(autoTx);
      }
    } else {
      // BUILD-98 (switch) Part 7 — another CRM's gift export. Same rule as
      // NPSP: the preset's answers win where it has one, the generic guess
      // keeps the rest, and the person can change any of it.
      const mig = detectMigrationPreset(headers);
      const migMap = mig && mig.key ? migrationMapping(headers, mig.key) : null;
      setMapping(autoDonor);
      setTxMap(migMap ? { ...autoTx, ...migMap.txMap } : autoTx);
    }
    const cfg = autoDetectWideConfig(headers, rows);
    setYearCols(cfg.yearCols.map(col => ({ col, date: yearColToDate(col, "dec31"), enabled: true })));
    setParsed({ headers, rows });
    // BUILD-78 Part 3.1 — left side of the column equation, from parse entry.
    setPhysicalCols(physical || { headerCells: headers, headerCount: headers.length, orphanColumns: 0, overflowRows: 0, total: headers.length });
    setCfDecisions({});
    setXlsxSheets(null);
    setErr("");
  };

  // ── File handler ──
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onWorkbook:w=>{ setWorkbook(w); setParsed(null); setXlsxSheets(null); }, onError:msg=>setErr(msg) });
  };

  // ── Paste flow ──
  const doParse = () => {
    if (!csvText.trim()) return;
    try {
      const analysis = analyzeCsvText(csvText);
      if (!analysis.rows.length) { setErr("No rows found. Check CSV format."); return; }
      applyParsed(analysis.headers, analysis.rows, analysis.physical, { ...reportFromAnalysis(analysis), cp1252Lines: [] });
    } catch (ex) { setErr(isProgrammerError(ex) ? errorMessage(ex) : "Parse error: " + ex.message); }
  };

  // ── AI column mapping (aggregate/wide donor fields only) ──
  const doAiMap = async () => {
    if (!parsed) return;
    setAiLoading(true);
    try {
      const sample = parsed.rows[0] || {};
      const res = await apiFetch("/ai/column-map", { method:"POST", body:JSON.stringify({ headers:parsed.headers, sample }) });
      if (res.mapping) {
        // FIX (2026-09-09) item 3 — a CONTENTS-based guess is low confidence by
        // construction: it is reading values, not a header anyone wrote. So it
        // may only FILL a target nothing else claims — it never overwrites a
        // mapping already made, and never duplicates a target another column
        // took. Anything it cannot place safely defaults to skip, which is the
        // honest outcome for a guess nobody can check.
        const merged = { ...mapping };
        const taken = new Set(Object.values(merged).filter(Boolean));
        const dropped = [];
        Object.entries(res.mapping).forEach(([h, f]) => {
          if (!f || !VALID_IMPORT_KEYS.has(f)) return;
          if (merged[h]) return;                                   // a human/auto choice stands
          if (taken.has(f)) { dropped.push([h, f]); return; }      // never two columns → one field
          // BUILD-79 Part 5 — the model's guesses pass the same type checks a
          // human's choices do. Spouse→lastName and phone→email died here.
          if (!validateMappingChoice(parsed.headers, parsed.rows, h, f).ok) { dropped.push([h, f]); return; }
          merged[h] = f;
          taken.add(f);
        });
        setMapping(merged);
        if (dropped.length) {
          setMapRefusal({ header: dropped[0][0], field: dropped[0][1],
            summary: `a contents guess can't take a field another column already has — ${dropped.length} guess${dropped.length === 1 ? "" : "es"} left for you to place` });
        }
      }
    } catch { /* keep existing mapping on AI failure */ }
    setAiLoading(false);
  };

  const onConventionChange = (val) => {
    setYearConvention(val);
    setYearCols(cols => cols.map(yc => ({ ...yc, date: yearColToDate(yc.col, val) })));
  };

  // ── BUILD-78 — the mapper plan: one entry per PHYSICAL column ──
  const mapperPlan = useMemo(() => {
    if (!parsed || effectiveShape !== "transaction" || !physicalCols) return null;
    try {
      return buildMapperPlan({
        headers: physicalCols.headerCells, fields: parsed.headers, rows: parsed.rows, txMap,
        existingDefs: cfDefs, savedMappings: savedCfMappings,
        orphanColumns: physicalCols.orphanColumns, overflowRows: physicalCols.overflowRows,
      });
    } catch (e) {
      // Worse than the payload case: a null plan takes `cfUndecided` to 0, so a
      // swallowed bug here would let an import run with columns nobody decided.
      rethrowProgrammerError(e);
      console.error("[import] mapper plan failed:", e); return null;
    }
  }, [parsed, effectiveShape, physicalCols, txMap, cfDefs, savedCfMappings]);

  // The columns that flow into the accounted builder, from plan + decisions.
  // Preview keys for not-yet-created fields are provisional; doImport swaps in
  // the real ones after the explicit accepts create the fields.
  const cfBuildInputs = useMemo(() => {
    if (!mapperPlan) return { flagColumns: {}, cfColumns: [], exclusionColumns: [], undecided: 0, ledger: null };
    const flagColumns = {}, cfColumns = [], exclusionColumns = [];
    let undecided = 0;
    for (const c of mapperPlan.columns) {
      const d = cfDecisions[c.index] || {};
      const action = d.action || (c.status === "flag" ? "flag" : c.status === "custom-existing" ? "existing" : null);
      // BUILD-80 Part 4 — a VALUE-routed exclusion column (Solicit Code /
      // Status): each cell parses through the family, several flags per
      // column. Never storable as a custom field.
      if (c.status === "flag" && action === "flag" && c.flag === "exclusion") { exclusionColumns.push(c.field); continue; }
      // BUILD-80 Part 8 — Frequency maps to the recurring surface; the
      // builder reads the column itself (a cadence claim the pattern can
      // override), so nothing to collect here.
      if (c.status === "flag" && c.flag === "frequency") continue;
      if (c.status === "flag" && action === "flag") { flagColumns[c.flag] = c.field; continue; }
      if (action === "existing" && (c.def || d.fieldId)) {
        const def = c.def || [...cfDefs.donor, ...cfDefs.gift].find(x => x.id === d.fieldId);
        if (def) cfColumns.push({ field: c.field, entity: def.entity, key: def.key, def, delimiter: d.delimiter });
        continue;
      }
      if (action === "accept") {
        const type = d.type || c.proposal.type;
        const label = d.label || c.proposal.label;
        const entity = d.entity || c.entity;
        const options = d.options || c.proposal.options || [];
        cfColumns.push({ field: c.field, entity, key: generateFieldKey(label), provisional: { label, type, options }, def: { type, options }, delimiter: d.delimiter });
        continue;
      }
      if (c.status === "custom-proposed" && !d.action) undecided++;
    }
    const ledger = buildColumnLedger(mapperPlan, cfDecisions);
    return { flagColumns, cfColumns, exclusionColumns, undecided, ledger };
  }, [mapperPlan, cfDecisions, cfDefs]);

  // BUILD-80 Part 2.2 — the date column's convention, inferred at the column
  // level (impossible-month evidence). Shown on the mapper; a MIXED column
  // blocks the import until a human chooses, with examples of both readings.
  const dateConvEvidence = useMemo(() => {
    if (!parsed || effectiveShape !== "transaction" || !txMap.date) return null;
    // A null here removes the mixed-date-convention block, so a swallowed bug
    // would let an ambiguous date column import unasked.
    try { return inferDateConvention(parsed.rows.map(r => r[txMap.date])); }
    catch (e) { rethrowProgrammerError(e); return null; }
  }, [parsed, effectiveShape, txMap.date]);

  // BUILD-84 P0-3 — the basis this import actually has, declared once and read
  // by both the preview split and the sentence under it.
  const stageBasis = useMemo(() => stageAssignmentBasis(
    effectiveShape === "transaction" ? { amount: txMap.amount, date: txMap.date }
    : effectiveShape === "wide" ? { yearColumns: yearCols.some(y => y.enabled) }
    : { total: Object.values(mapping).includes("total"),
        lastAmount: Object.values(mapping).includes("lastAmount"),
        lastGift: Object.values(mapping).includes("lastGift") }
  ), [effectiveShape, mapping, txMap.amount, txMap.date, yearCols]);

  // ── BUILD-94 Part 2 — the Mailchimp audience preset ──────────────────────
  // NOT a second importer (the BUILD-89S 89d rule): a preset is a pre-filled
  // answer to the questions this mapper already asks. Two questions are left
  // for the person, because neither can be read off the file with certainty:
  //   • IS THIS THE UNSUBSCRIBED FILE? Mailchimp exports one CSV per status,
  //     so the unsubscribed half arrives as a SECOND file with identical
  //     headers. Import only the first and every unsubscribe Mailchimp was
  //     honouring is silently lost. The file NAME preselects the answer.
  //   • DO THE TAGS SAY WHAT SOMEONE IS? "Board Game Night 2024" contains the
  //     word board and is not a board member, so tag→type is OFFERED, never
  //     applied silently (the BUILD-78 ask gate).
  const mcDetect = useMemo(
    () => (parsed?.headers ? detectMailchimpAudience(parsed.headers) : { isMailchimp:false, hasTags:false }),
    [parsed]);
  const mcTagsHeader = useMemo(
    () => (parsed?.headers || []).find(h => String(h).trim().toLowerCase() === "tags") || null,
    [parsed]);
  const mcStatusHeader = useMemo(
    () => (parsed?.headers || []).find(h => /^(member )?status$/i.test(String(h).trim())) || null,
    [parsed]);
  // ── BUILD-97 Part 1 — SALESFORCE NPSP ─────────────────────────────────────
  // The same shape as the Mailchimp preset above, and for the same reason: a
  // migration off the Nonprofit Success Pack is two exports Steward already
  // knows how to read, so this is a PRE-FILLED ANSWER to the questions this
  // mapper already asks — never a second importer.
  //
  // The one question left for the person is the one that cannot be read off a
  // file: a stage this organisation invented. Everything else — which column
  // is the close date, which is the amount, whether `Account Name` is an
  // organisation or somebody's household — is decided by the preset and shown.
  const npsp = useMemo(
    () => (parsed?.headers ? npspMapping(parsed.headers) : null),
    [parsed]);
  const npspIs = !!(npsp && npsp.detected && npsp.detected.isNpsp);
  // BUILD-98 (switch) Part 7 — the other CRMs' gift exports.
  const migDetected = useMemo(
    () => (parsed?.headers && !npspIs ? detectMigrationPreset(parsed.headers) : null),
    [parsed, npspIs]);
  const mig = migDetected && migDetected.key ? migrationMapping(parsed.headers, migDetected.key) : null;
  const [mcFileStatus, setMcFileStatus] = useState(null);
  const [mcApplyTagTypes, setMcApplyTagTypes] = useState(false);
  useEffect(() => {
    if (!mcDetect.isMailchimp) { setMcFileStatus(null); setMcApplyTagTypes(false); return; }
    setMcFileStatus(fileStatusFromName(srcFile?.name) || "subscribed");
  }, [mcDetect.isMailchimp, srcFile]);
  const mcPeople = useMemo(() => mcDetect.isMailchimp ? {
    fileStatus: mcFileStatus, statusHeader: mcStatusHeader, tagsHeader: mcTagsHeader,
    applyTagTypes: mcApplyTagTypes,
    // A Mailchimp contact is NOT a donor. Calling one a donor is how a giving
    // total goes wrong; "Other" is the honest answer until a gift says otherwise.
    defaultType: "other",
  } : null, [mcDetect.isMailchimp, mcFileStatus, mcStatusHeader, mcTagsHeader, mcApplyTagTypes]);

  // ── Shape-aware payload build (memoized) ──
  // aggregate → donors (+ one seeded gift/donor from total+lastGift when
  // withHistory, so onboarding gets real gifts rows); transaction → group the
  // gift ledger into donors + a gift per row; wide → donors + a gift per year.
  const payload = useMemo(() => {
    if (!parsed) return { donors:[], gifts:[], warnedCount:0, skippedCount:0 };
    try {
      if (effectiveShape === "transaction") return buildTransactionPayload(parsed, txMap, cfBuildInputs, parseReport?.rowLines, dateConventionChoice, orgToday);
      if (effectiveShape === "wide")        return buildWidePayload(parsed, mapping, yearCols, parseReport?.rowLines);
      return buildAggregatePayload(parsed, mapping, withHistory, parseReport?.rowLines, stageBasis, mcPeople);
    } catch (e) {
      // FIX (2026-09-10) — a bug is RE-THROWN, never rendered as a sentence
      // about the user's file. Returning an empty payload here is how a
      // ReferenceError became "No rows ready — map at least one column to name
      // or email". See client/src/lib/domainError.js.
      rethrowProgrammerError(e);
      console.error("[import] payload build failed:", e);
      return { donors:[], gifts:[], warnedCount:0, skippedCount:0, error:e.message };
    }
  }, [parsed, effectiveShape, mapping, txMap, yearCols, withHistory, cfBuildInputs, parseReport, dateConventionChoice, orgToday, mcPeople]);

  // Stage-count preview from the built payload (aggregate donors carry a client
  // stage; transaction/wide donors are re-staged server-side from their gifts,
  // so preview those from the grouped gift totals).
  const stagePreview = useMemo(() => {
    const counts = {};
    if (effectiveShape === "aggregate") {
      payload.donors.forEach(d => { const s = d.stage || "prospect"; counts[s] = (counts[s]||0)+1; });
    } else {
      const giftsByDonor = {};
      payload.gifts.forEach(g => { (giftsByDonor[g.donorIndex] ||= []).push(g); });
      payload.donors.forEach((d, idx) => {
        const gg = giftsByDonor[idx] || [];
        const total = gg.reduce((s,g)=>s+g.amount,0);
        const last = gg.length ? gg.reduce((m,g)=>g.date>m?g.date:m, gg[0].date) : null;
        // BUILD-84 P0-3 — with no giving input mapped there is nothing to
        // infer from; one stage, never a fabricated distribution.
        const s = !stageBasis.hasGivingData ? stageBasis.fallbackStage
                : last ? inferStage(total, last, !!(d.email||d.phone))
                : inferStage(0, null, !!(d.email||d.phone));
        counts[s] = (counts[s]||0)+1;
      });
    }
    return counts;
  }, [payload, effectiveShape, stageBasis]);

  // BUILD-78 — the plan supersedes BUILD-77's bulk acknowledgement: every
  // unmapped column now takes an explicit per-column decision (store as
  // custom / map to core / discard), and the import is gated on zero
  // undecided columns rather than one checkbox.
  const cfUndecided = cfBuildInputs.undecided;

  // ── Submit import (chunked, with progress — the hang fix) ──
  const doImport = async () => {
    // BUILD-79 Part 2 — shape is a decision with evidence, or a question.
    if (effectiveShape === "unknown") { setErr("Choose how this file is shaped before importing — we couldn't tell from the columns."); return; }
    // FIX (2026-09-09) item 2 — two columns mapped to one field is a refusal by
    // name, never a silent last-one-wins. (Auto-mapping put contact_name AND
    // contact_confidence on `name` and nothing objected.)
    if (duplicateDonorTargets.length) {
      const d = duplicateDonorTargets[0];
      const label = (CSV_STANDARD_FIELDS.find(f => f.key === d.field) || {}).label || d.field;
      setErr(`Two columns are mapped to ${label.toLowerCase()} — “${d.headers.join("” and “")}”. Pick one, or send the other somewhere else.`);
      return;
    }
    if (aggregateCollapse?.refuse) { setErr(`${aggregateCollapse.collapsed.toLocaleString()} of ${aggregateCollapse.keyedRows.toLocaleString()} rows collapse onto the same donors — this file is one row per gift. Switch the shape to individual gifts.`); return; }
    // BUILD-80 Part 2.2 — a MIXED date column is a question, never a guess.
    if (dateConvEvidence?.convention === "mixed" && !dateConventionChoice) {
      setErr("This file's date column mixes day-first and month-first dates — choose which convention to apply (above the mapping) before importing.");
      return;
    }
    let activePayload = payload;
    let importExtras = null;
    setLoading(true); setErr("");
    try {
      if (effectiveShape === "transaction" && mapperPlan) {
        // BUILD-78 4.3/4.5 — the ONLY point where accepted proposals become
        // fields: an explicit accept, a POST per field with the import as its
        // source, and the real keys swapped into the build. Existing fields
        // are resolved, never re-created — prevention, not cleanup.
        const ledger = buildColumnLedger(mapperPlan, cfDecisions);
        const colSummary = summarizeColumnLedger(physicalCols.total, ledger);
        if (!colSummary.balanced) { setErr("Some columns still need a decision before the import can run."); setLoading(false); return; }
        const finalCfColumns = [];
        const fieldMappings = [];
        for (const entry of ledger) {
          const col = mapperPlan.columns.find(c => c.index === entry.index);
          if (entry.disposition === "custom-existing") {
            const def = col.def || [...cfDefs.donor, ...cfDefs.gift].find(x => x.id === entry.fieldId);
            finalCfColumns.push({ field: col.field, entity: def.entity, key: def.key, def, delimiter: entry.delimiter });
            fieldMappings.push({ entity: def.entity, header: String(entry.header).trim(), fieldId: def.id });
          } else if (entry.disposition === "custom-new") {
            const created = await apiFetch("/custom-fields", { method: "POST", body: JSON.stringify({
              entity: entry.entity, label: entry.label, type: entry.type,
              options: (entry.type === "select" || entry.type === "multi_select") ? entry.options : [],
              source: `import of ${srcFile?.name || "pasted data"}`,
            })});
            finalCfColumns.push({ field: col.field, entity: created.entity, key: created.key, def: created, delimiter: entry.delimiter });
            fieldMappings.push({ entity: created.entity, header: String(entry.header).trim(), fieldId: created.id });
          }
        }
        activePayload = buildTransactionPayload(parsed, txMap, { flagColumns: cfBuildInputs.flagColumns, cfColumns: finalCfColumns, exclusionColumns: cfBuildInputs.exclusionColumns }, parseReport?.rowLines, dateConventionChoice);
        importExtras = {
          columns: { inFile: physicalCols.total, ledger: ledger.map(({ index, header, disposition, flag, role, fieldId, entity, reason }) => ({ index, header, disposition, flag, role, fieldId, entity, reason })) },
          fieldMappings,
          customFieldDelimiters: Object.fromEntries(finalCfColumns.filter(c => c.delimiter).map(c => [c.key, c.delimiter])),
          columnLedgerFull: ledger,
          // BUILD-88a A.7 — this path runs the FULL BUILD-80 Part 6 identity
          // pass (id → email-with-a-compatible-name → name) before it submits,
          // exactly as the workbook path does. Without this flag the server's
          // blunt within-file email fold undid it and put "Mr. and Mrs. Gerald
          // Kane" and "Marilyn Kane" back on one record — a household of two
          // arriving as one merged person.
          identityResolved: true,
          // BUILD-99 (major gifts) Part 6 — THE OPEN ASKS ON THE SAME ROWS. Read
          // as a second pass over the same rows rather than a branch inside the
          // gift builder: a file can legitimately carry a gift last year and an
          // open ask this year for the same person, and folding the two into one
          // pass would make one of them win.
          //
          // THE CLIENT SENDS A NAME, NOT AN INDEX, AND THAT IS A DECISION. The
          // gift builder's row→donor resolution is internal to it (BUILD-80's
          // identity pass runs inside `buildTransactionRows` and its key→index
          // map does not leave), so threading an index out would mean widening
          // that builder's contract for this one caller. A name resolves
          // server-side to the oldest matching record — the SAME rule
          // `importGiftExtras` already uses for an imported soft credit
          // (BUILD-98 Part 1), so this carries a decision that was already made
          // and reviewed rather than inventing a second one. The index path stays
          // available to the API (tests/build99-import.test.js drives it) for a
          // caller that genuinely has one.
          proposals: txMap.proposalAmount
            ? buildProposalRows(parsed, txMap, { dateConvention: dateConventionChoice || undefined }).proposals
            : [],
        };
      }
    } catch (e) {
      rethrowProgrammerError(e);
      console.error("IMPORT FIELD SETUP FAILED:", e);
      setErr(errorMessage(e, "Could not create the custom fields. Nothing was imported."));
      setLoading(false); return;
    }
    // FIX (2026-09-09) — a CSV donor column mapped to a custom field carries its
    // raw value on the row; the server validates it through the ONE seam
    // (BUILD-78) exactly as the workbook path does.
    if (Object.keys(donorCfChoices).length && activePayload && Array.isArray(activePayload.donors)) {
      const entries = Object.entries(donorCfChoices);
      activePayload = {
        ...activePayload,
        donors: activePayload.donors.map((d, i) => {
          const row = parsed.rows[d._rowIndex != null ? d._rowIndex - 2 : i];
          if (!row) return d;
          const cf = {};
          for (const [h, choice] of entries) {
            const v = String(row[h] ?? "").trim();
            if (v && choice.entity === "donor") cf[choice.key] = v;
          }
          return Object.keys(cf).length ? { ...d, customFields: { ...(d.customFields || {}), ...cf } } : d;
        }),
      };
    }
    const { donors: rawDonors, gifts, warnedCount, skippedCount, error } = activePayload;
    if (error) { setErr("Failed to prepare import data — " + error + ". Check the browser console."); setLoading(false); return; }
    if (!rawDonors.length) {
      setErr(skippedCount ? `All ${skippedCount} rows skipped — no usable name or email.` : "Nothing to import — map a name or email column.");
      setLoading(false); return;
    }
    // BUILD-101 Part 6 — memberships named on these rows, read from what the
    // person finally mapped (the preset's guess, or her correction).
    {
      const memCols = {}, colFor = f => Object.keys(mapping).find(h => mapping[h] === f) || null;
      for (const f of MEMBERSHIP_FIELDS) { const h = colFor(f); if (h) memCols[f] = h; }
      if (memCols.membershipLevel) {
        const mem = buildMembershipRows(parsed, memCols, { nameCol: colFor("name"), emailCol: colFor("email"),
          firstCol: colFor("_firstName"), lastCol: colFor("_lastName"), dayFirst: dateConventionChoice === "dmy" });
        if (mem.memberships.length || mem.setAside.length)
          importExtras = { ...(importExtras || {}), memberships: mem.memberships, membershipsSetAside: mem.setAside };
      }
    }
    const payloadForSummary = activePayload;
    const donors = assignPayloadDonors(rawDonors); // stamp assignedTo from the owner mapping (Team)
    setProgress({ done:0, total:donors.length });
    try {
      const totals = await submitImportChunked(donors, gifts, (done,total) => setProgress({ done, total }), importExtras);
      // ── BUILD-77 Part 3a — the file-level equation, from PARSE ENTRY ──
      // "In your file" is the physical non-blank row count taken once when
      // the file was parsed, never the count of what survived the client's
      // own builders. The client's refused rows (unparseable amount/date,
      // future-dated, refunds are NOT refused) join the buckets with their
      // reasons, and balance is recomputed against the FILE. The old code
      // summed only the server's payload-scoped equation, which is how 74
      // rows and ~$154,806 of a real file hid behind "Balanced".
      if (payloadForSummary.file && payloadForSummary.dispositions) {
        const R = totals.reconciliation;
        R.rows.inFile = payloadForSummary.file.rows;
        R.dollars.inFile = payloadForSummary.file.dollars;
        const bump = (bucket, reason, rows, dollars) => {
          R.rows[bucket] += rows; R.dollars[bucket] += dollars;
          const box = bucket === "skipped" ? R.skippedReasons : R.erroredReasons;
          const e = box[reason] || (box[reason] = { rows: 0, dollars: 0 });
          e.rows += rows; e.dollars += dollars;
        };
        const byReason = {};
        for (const d of payloadForSummary.dispositions) {
          if (d.disposition === "gift") continue;   // sent to the server; its ledger owns them
          const key = d.disposition + "|" + (d.reason || "donor_info_only");
          const e = byReason[key] || (byReason[key] = { rows: 0, dollars: 0 });
          e.rows += 1; e.dollars += d.dollars || 0;
        }
        for (const [key, v] of Object.entries(byReason)) {
          const [disp, reason] = key.split("|");
          if (disp === "errored") bump("errored", reason, v.rows, v.dollars);
          else bump("skipped", reason, v.rows, v.dollars);   // skipped + donor_only both surface as skipped-with-reason
        }
        const accounted = R.rows.created + R.rows.skipped + R.rows.errored;
        R.rows.accounted = accounted;
        R.rows.balanced = accounted === R.rows.inFile;
        const dAccounted = R.dollars.created + R.dollars.skipped + R.dollars.errored;
        R.dollars.accounted = Math.round(dAccounted * 100) / 100;
        R.dollars.balanced = Math.abs(R.dollars.inFile - dAccounted) < 0.005;
        R.balanced = R.rows.balanced && R.dollars.balanced;
        totals.refusedRows = payloadForSummary.dispositions.filter(d => d.disposition === "skipped" || d.disposition === "errored");
        totals.flaggedRows = payloadForSummary.flaggedRows || [];
        // BUILD-80 Part 1 — the largest-gifts panel + the convention lines
        // ride the same accounted builder output.
        totals.largestGifts = payloadForSummary.largestGifts || [];
        totals.amountConventions = payloadForSummary.amountConventions || null;
        totals.dateConvention = payloadForSummary.dateConvention || null;
        totals.exclusionConflicts = payloadForSummary.exclusionConflicts || [];
        totals.frequencyConflicts = payloadForSummary.frequencyConflicts || [];
        totals.semantics = payloadForSummary.semantics || null;
        totals.identity = payloadForSummary.identity || null;
        // BUILD-80 Part 5/7 — the semantic rows land in ONE follow-up call:
        // pledges to the pledges table, in-kind as FMV records, soft credits
        // and matching/DAF attributions as relationship links.
        if (payloadForSummary.semantics && (payloadForSummary.semantics.pledges.length || payloadForSummary.semantics.inKind.length || payloadForSummary.semantics.links.length || payloadForSummary.semantics.reviewTwins.length)) {
          try {
            const semRes = await apiFetch("/donors/import-semantics", { method: "POST", body: JSON.stringify({
              pledges: payloadForSummary.semantics.pledges.map(p => ({ ...p, dueDate: p.dueDate })),
              inKind: payloadForSummary.semantics.inKind,
              links: payloadForSummary.semantics.links,
              reviewTwins: payloadForSummary.semantics.reviewTwins,
              merges: payloadForSummary.identity?.mergeReview || [],
              // BUILD-80 Part 9 — the import's health rides with it, so every
              // headline stat can carry the caveat while refusals are high.
              fileStats: {
                rows: payloadForSummary.file?.rows || 0,
                refused: (payloadForSummary.dispositions || []).filter(d2 => d2.disposition === "errored" || (d2.disposition === "skipped" && ["no_amount", "zero_amount"].includes(d2.reason))).length,
                refusedDollars: (payloadForSummary.dispositions || []).filter(d2 => d2.disposition === "errored").reduce((s2, d2) => s2 + (d2.dollars || 0), 0),
                largestGifts: payloadForSummary.largestGifts || [],
              },
            }) });
            totals.semanticsApplied = semRes?.counts || null;
            totals.mergeRows = semRes?.merges || [];
          } catch (e) {
            console.error("[import] semantics call failed:", e);
            totals.semanticsError = errorMessage(e, "the pledge/in-kind/link rows could not be recorded");
          }
        }
      }
      // ── BUILD-79 Part 3 — the file-level equation exists on EVERY path.
      // The aggregate/wide paths used to show only the server's payload-scoped
      // ledger: both sides derived from what the client chose to send, so a
      // 2,500-record report import could read "Balanced · 2,438 · $0". Rows
      // come from parse entry; DOLLARS come from the independent raw-file scan
      // (Part 3.1) — never from the mapping.
      else if (parseReport?.records) {
        const R = totals.reconciliation;
        R.rows.inFile = parseReport.records;
        const bump = (bucket, reason, rows, dollars) => {
          R.rows[bucket] += rows; R.dollars[bucket] += dollars;
          const box = bucket === "skipped" ? R.skippedReasons : R.erroredReasons;
          const e = box[reason] || (box[reason] = { rows: 0, dollars: 0 });
          e.rows += rows; e.dollars += dollars;
        };
        for (const k of (payloadForSummary.skippedRows || [])) bump("skipped", k.reason || "skipped_before_submit", 1, 0);
        if (payloadForSummary.warnedRows) {
          totals.warnedRows = payloadForSummary.warnedRows.map(w => ({
            line: parseReport.rowLines?.[w.idx] ?? (w.idx + 2), reasons: w.reasons,
            raw: parsed?.rows?.[w.idx] || {},
          }));
        }
        // server buckets (created + its skipped/errored reasons, incl. the
        // duplicate split) were already merged per chunk; the client-side
        // pre-submit skips just joined them above. One partition, one sum.
        R.rows.accounted = R.rows.created + R.rows.skipped + R.rows.errored;
        R.rows.balanced = R.rows.accounted === R.rows.inFile;
        // BUILD-84 P0-1 — the file's dollars are ONE column's own subtotal or
        // they are unknown. The scan now returns every column that qualifies
        // as currency; a figure may only anchor the equation when there is no
        // ambiguity about which column it came from:
        //   · the import mapped an amount column → that column's subtotal,
        //   · exactly one column in the file qualifies → that one,
        //   · otherwise → null, and the panel names each candidate instead of
        //     adding several unrelated money columns into one number nobody
        //     can check. (Two money columns summed is not a reconcilable
        //     figure; picking the biggest is picking the best of a bad set.)
        const scan = parseReport.amountScan;
        const mappedAmountHdr = Object.keys(mapping).find(h => mapping[h] === "total" || mapping[h] === "lastAmount") || null;
        const anchor = scan && (
          (mappedAmountHdr && scan.columns.find(c => c.header === mappedAmountHdr))
          || (scan.unambiguous ? scan.columns[0] : null));
        R.dollars.inFile = anchor ? anchor.sum : null;
        R.dollars.accounted = Math.round((R.dollars.created + R.dollars.skipped + R.dollars.errored) * 100) / 100;
        R.dollars.balanced = R.dollars.inFile == null ? false : Math.abs(R.dollars.inFile - R.dollars.accounted) < 0.005;
        R.dollars.scanColumn = anchor ? anchor.header : null;
        R.dollars.currencyColumns = scan ? scan.columns.map(c => ({ header: c.header, sum: c.sum, why: c.why })) : [];
        R.balanced = R.rows.balanced && R.dollars.balanced;
      }
      // BUILD-79 Part 3.3 — GREEN IS EARNED. The check mark and "every row and
      // every dollar accounted for" require: an amount column mapped, a date
      // column mapped, non-zero imported dollars, and both axes balanced.
      // Anything less is amber, and the panel says what is missing.
      {
        const R = totals.reconciliation;
        const amountMapped = effectiveShape === "transaction" ? !!txMap.amount
          : effectiveShape === "wide" ? yearCols.some(y => y.enabled)
          : Object.values(mapping).some(f => f === "total" || f === "lastAmount");
        const dateMapped = effectiveShape === "transaction" ? !!txMap.date
          : effectiveShape === "wide" ? true /* year columns carry their own dates */
          : Object.values(mapping).some(f => f === "lastGift");
        const dollarsIn = Number(R.dollars.created || 0);
        const missing = [];
        // BUILD-84 P0-1 — every currency column is named with its own subtotal,
        // and a column that was never mapped as a gift amount is never
        // described as money that went missing.
        const cur = R.dollars.currencyColumns || [];
        const money$ = n => "$" + Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
        // FIX (2026-09-10) — a DISPLAY cap, not a logic one. Every qualifying
        // column is still scanned, still counted, and still carried on
        // `reconciliation.dollars.currencyColumns` for anything that reads the
        // receipt. But five subtotals headed by a $386,923,121 figure reads as
        // confusion on a receipt even when every number in it is correct, so
        // the sentence names the LARGEST THREE and puts the rest behind a
        // count. The count is what keeps it honest: "and 2 more" is a fact the
        // reader can act on, an elided list is not.
        const CURRENCY_COLS_SHOWN = 3;
        const curRanked = [...cur].sort((a, b) => b.sum - a.sum);
        const curShown = curRanked.slice(0, CURRENCY_COLS_SHOWN);
        const curRest = curRanked.length - curShown.length;
        const curList = curShown.map(c => `“${c.header}” ${money$(c.sum)}`).join(" · ")
          + (curRest > 0 ? ` · and ${curRest} more` : "");
        if (!amountMapped) missing.push("no amount column was mapped");
        if (!dateMapped) missing.push("no gift-date column was mapped");
        if (dollarsIn <= 0 && R.dollars.scanColumn && R.dollars.inFile > 0)
          missing.push(`$0 was imported, but the file's “${R.dollars.scanColumn}” column carries ${money$(R.dollars.inFile)} of currency-shaped values`);
        else if (dollarsIn <= 0 && cur.length)
          missing.push(`${cur.length} column${cur.length===1?"":"s"} in this file read${cur.length===1?"s":""} as currency — ${curList} — and none was mapped as a gift amount, so there is nothing to reconcile against`);
        else if (dollarsIn <= 0)
          missing.push("no unmapped column reads as currency either, so there is nothing to reconcile against");
        if (!R.rows.balanced) missing.push("the row equation does not balance");
        // The list is printed ONCE. Repeating it here read as two findings
        // where there is one, which is its own small dishonesty on a panel
        // whose whole job is to be countable.
        if (!R.dollars.balanced) missing.push(
          R.dollars.inFile == null
            ? (cur.length
                 ? "so the dollar equation has no left-hand side to check — that is why it does not balance, not a lost figure"
                 : "the file's dollars are unknown (no column in it reads as currency)")
            : "the dollar equation does not balance");
        totals.summaryHealth = {
          greenEarned: amountMapped && dateMapped && dollarsIn > 0 && R.rows.balanced && R.dollars.balanced,
          missing,
        };
        // Part 3.2 — the file's own TOTAL row is the first outside number the
        // product has ever reconciled against.
        if (parseReport?.totalRow) {
          const diff = Math.round((parseReport.totalRow.amount - dollarsIn) * 100) / 100;
          totals.fileTotalRow = { stated: parseReport.totalRow.amount, line: parseReport.totalRow.line,
            imported: dollarsIn, difference: diff,
            explained: { skipped: R.dollars.skipped || 0, errored: R.dollars.errored || 0 } };
        }
      }
      // Don't call onImported() here — the result screen must render first; its
      // Done button calls onImported() so the modal stays until dismissed.
      // BUILD-58 Part 2 — the class fix: every column accounted for, by name.
      const colReport = (() => {
        const headers = parsed?.headers || [];
        if (effectiveShape === "transaction") {
          const m = {};
          Object.entries(txMap).forEach(([role, h]) => { if (h) m[h] = role; });
          return classifyColumns(headers, m, []);
        }
        const m = { ...mapping };
        const ignored = [];
        if (effectiveShape === "wide") yearCols.forEach(yc => { if (yc.enabled) m[yc.col] = "gift (" + yc.col + ")"; else ignored.push(yc.col); });
        return classifyColumns(headers, m, ignored);
      })();
      // The column axis exists only where the transaction mapper built a
      // ledger. BUILD-101 Part 6 found that "extras exist" was standing in for
      // "a ledger exists": membership extras ride a donor-shaped file with no
      // ledger, and the receipt crashed reading one that was not there.
      if (importExtras && Array.isArray(importExtras.columnLedgerFull)) {
        totals.columnAxis = {
          inFile: physicalCols.total,
          summary: summarizeColumnLedger(physicalCols.total, importExtras.columnLedgerFull),
          ledger: importExtras.columnLedgerFull,
        };
      }
      setResult({ ...totals, warned:warnedCount, skipped:skippedCount, shape:effectiveShape, columnReport: colReport });
    } catch (e) {
      // A refusal from a route is a domain error and its message is real. A
      // TypeError in this function is not, and must not be shown as one.
      rethrowProgrammerError(e);
      console.error("IMPORT FAILED:", e);
      if (e.error === "record_limit") { setUpgradeInfo(e); }
      else { setErr(errorMessage(e, "Import failed. See browser console.")); }
    }
    setLoading(false); setProgress(null);
  };

  // ── "Import both" — donor sheet + gift-history sheet linked in one pass ──
  const bothPayload = useMemo(() => {
    if (!bothMode) return null;
    try {
      return buildBothPayload(bothMode.donorSheet, bothMode.giftSheet, bothMode.matchInfo, matchKey);
    } catch (e) {
      rethrowProgrammerError(e);   // a bug is a crash, not "0 gifts → 0 donors"
      console.error("[import-both] payload build failed:", e);
      return { donors:[], gifts:[], matchedGifts:0, unmatchedGifts:0, newDonors:0, skippedGifts:0, error:e.message };
    }
  }, [bothMode, matchKey]);

  // Smart-stage preview over the linked history (donors are re-staged server-side
  // from their attached gifts, so preview from the grouped gift totals).
  const bothStagePreview = useMemo(() => {
    const counts = {};
    if (!bothPayload) return counts;
    const giftsByDonor = {};
    bothPayload.gifts.forEach(g => { (giftsByDonor[g.donorIndex] ||= []).push(g); });
    bothPayload.donors.forEach((d, idx) => {
      const gg = giftsByDonor[idx] || [];
      const total = gg.reduce((s,g)=>s+g.amount,0);
      const last = gg.length ? gg.reduce((m,g)=>g.date>m?g.date:m, gg[0].date) : null;
      const s = last ? inferStage(total, last, !!(d.email||d.phone)) : inferStage(0, null, !!(d.email||d.phone));
      counts[s] = (counts[s]||0)+1;
    });
    return counts;
  }, [bothPayload]);

  const doImportBoth = async () => {
    if (!bothPayload) return;
    const { donors: rawDonors, gifts, error } = bothPayload;
    if (error) { setErr("Failed to prepare import data — " + error + ". Check the browser console."); return; }
    if (!rawDonors.length) { setErr("Nothing to import — no usable donor rows."); return; }
    const donors = assignPayloadDonors(rawDonors); // stamp assignedTo from the owner mapping (Team)
    setLoading(true); setErr(""); setProgress({ done:0, total:donors.length });
    try {
      const totals = await submitImportChunked(donors, gifts, (done,total) => setProgress({ done, total }));
      // ── BUILD-77 Part 3a — the file-level equation, from PARSE ENTRY ──
      // "In your file" is the physical non-blank row count taken once when
      // the file was parsed, never the count of what survived the client's
      // own builders. The client's refused rows (unparseable amount/date,
      // future-dated, refunds are NOT refused) join the buckets with their
      // reasons, and balance is recomputed against the FILE. The old code
      // summed only the server's payload-scoped equation, which is how 74
      // rows and ~$154,806 of a real file hid behind "Balanced".
      if (payload.file && payload.dispositions) {
        const R = totals.reconciliation;
        R.rows.inFile = payload.file.rows;
        R.dollars.inFile = payload.file.dollars;
        const bump = (bucket, reason, rows, dollars) => {
          R.rows[bucket] += rows; R.dollars[bucket] += dollars;
          const box = bucket === "skipped" ? R.skippedReasons : R.erroredReasons;
          const e = box[reason] || (box[reason] = { rows: 0, dollars: 0 });
          e.rows += rows; e.dollars += dollars;
        };
        const byReason = {};
        for (const d of payload.dispositions) {
          if (d.disposition === "gift") continue;   // sent to the server; its ledger owns them
          const key = d.disposition + "|" + (d.reason || "donor_info_only");
          const e = byReason[key] || (byReason[key] = { rows: 0, dollars: 0 });
          e.rows += 1; e.dollars += d.dollars || 0;
        }
        for (const [key, v] of Object.entries(byReason)) {
          const [disp, reason] = key.split("|");
          if (disp === "errored") bump("errored", reason, v.rows, v.dollars);
          else bump("skipped", reason, v.rows, v.dollars);   // skipped + donor_only both surface as skipped-with-reason
        }
        const accounted = R.rows.created + R.rows.skipped + R.rows.errored;
        R.rows.accounted = accounted;
        R.rows.balanced = accounted === R.rows.inFile;
        const dAccounted = R.dollars.created + R.dollars.skipped + R.dollars.errored;
        R.dollars.accounted = Math.round(dAccounted * 100) / 100;
        R.dollars.balanced = Math.abs(R.dollars.inFile - dAccounted) < 0.005;
        R.balanced = R.rows.balanced && R.dollars.balanced;
        totals.refusedRows = payload.dispositions.filter(d => d.disposition === "skipped" || d.disposition === "errored");
        totals.flaggedRows = payload.flaggedRows || [];
      }
      setResult({
        ...totals,
        warned: bothPayload.donorWarned,
        skipped: bothPayload.donorSkipped + bothPayload.skippedGifts,
        shape: "both",
        unmatched: bothPayload.unmatchedGifts,
        newDonors: bothPayload.newDonors,
        columnReports: bothPayload.columnReports,
        rowReport: bothPayload.rowReport,
      });
    } catch (e) {
      rethrowProgrammerError(e);
      console.error("IMPORT-BOTH FAILED:", e);
      if (e.error === "record_limit") { setUpgradeInfo(e); }
      else { setErr(errorMessage(e, "Import failed. See browser console.")); }
    }
    setLoading(false); setProgress(null);
  };

  // ── Officer routing: which column carries the owner, and its distinct values ─
  const effectiveOwnerCol = useMemo(() => {
    if (bothMode) return detectOwnerColumn(bothMode.donorSheet.headers || []);
    if (!parsed) return "";
    if (effectiveShape === "transaction") return txMap.owner || detectOwnerColumn(parsed.headers);
    const mapped = Object.keys(mapping).find(h => mapping[h] === "owner");
    return mapped || detectOwnerColumn(parsed.headers);
  }, [bothMode, parsed, effectiveShape, txMap.owner, mapping]);

  const ownerMatches = useMemo(() => {
    if (!isTeam || !effectiveOwnerCol || !orgUsers.length) return [];
    const rows = bothMode ? (bothMode.donorSheet.rows || []) : (parsed?.rows || []);
    const values = rows.map(r => r[effectiveOwnerCol]);
    return matchOwnersToUsers(values, orgUsers); // [{value,count,userId,userName,matchType}]
  }, [isTeam, effectiveOwnerCol, orgUsers, bothMode, parsed]);

  // Seed ownerMap from the auto-match whenever the set of owner values changes.
  const ownerValuesKey = ownerMatches.map(m => m.value).join("|");
  useEffect(() => {
    if (!ownerMatches.length) return;
    const init = {};
    ownerMatches.forEach(m => { init[m.value] = m.userId || ""; });
    setOwnerMap(init);
  }, [ownerValuesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply the confirmed routing to a payload's donors (strips the raw `owner`
  // field either way). Core (isTeam=false) → always unassigned.
  const assignPayloadDonors = (donors) => {
    if (!isTeam) return donors.map(({ owner, ...d }) => d);
    if (effectiveOwnerCol && ownerMatches.length) {
      const resolved = {};
      for (const m of ownerMatches) {
        const uid = ownerMap[m.value];
        if (uid) { const u = orgUsers.find(x => x.id === uid); resolved[String(m.value).toLowerCase().trim()] = { userId: uid, userName: u?.name || null }; }
      }
      return applyOwnerAssignment(donors, resolved);
    }
    if (bulkAssign === "__me__" && myId) return donors.map(({ owner, ...d }) => ({ ...d, assignedTo: myId, assignedToName: myName || null }));
    if (bulkAssign && bulkAssign !== "__me__") { const u = orgUsers.find(x => x.id === bulkAssign); return donors.map(({ owner, ...d }) => ({ ...d, assignedTo: bulkAssign, assignedToName: u?.name || null })); }
    return donors.map(({ owner, ...d }) => d);
  };

  async function sendOfficerInvite() {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true); setInviteErr("");
    try {
      const r = await apiFetch("/auth/invite", { method:"POST", body: JSON.stringify({ email: inviteEmail.trim(), role: "staff" }) });
      const val = inviteFor;
      setInvitedValues(p => ({ ...p, [val]: true }));
      // Make the just-invited officer immediately selectable AND assigned to
      // this owner value as PENDING — no re-import needed (task #4). The invite
      // resolves into their portfolio when they accept.
      if (r?.id) {
        const pseudo = { id:"invite:"+r.id, name:r.name || r.email, email:r.email, pending:true };
        setOrgUsers(prev => prev.some(u=>u.id===pseudo.id) ? prev : [...prev, pseudo]);
        setOwnerMap(p => ({ ...p, [val]: pseudo.id }));
      }
      loadOfficers();  // refresh from server (pending list + counts)
      setInviteFor(null); setInviteEmail("");
    } catch (e) {
      setInviteErr(e.error === "seat_limit" ? (errorMessage(e, "You've reached your seat limit.")) : (errorMessage(e, "Could not send invite.")));
    }
    setInviteBusy(false);
  }

  // Label for an officer <option> — pending invitees are clearly marked so an
  // admin knows the assignment is held until acceptance.
  const officerOptionLabel = (u) => u.pending ? `${u.name} (invited — pending)` : `${u.name}${u.email?` (${u.email})`:""}`;
  // Re-point every spelling in a collapsed group at once (still overridable).
  const setGroupOwner = (g, id) => setOwnerMap(p => { const n={...p}; g.values.forEach(v => { n[v.value] = id; }); return n; });

  // The Team officer-routing panel (an owner-column map, or bulk options when
  // there's no owner column). A plain function (not a nested component) so the
  // invite input never remounts on keystroke.
  function ownerRoutingUI() {
    if (!isTeam) return null;
    const panel = { background:T.bg, borderRadius:10, padding:"12px 14px", marginBottom:12, border:`1px solid ${T.bg3}` };
    const eyebrow = { fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:T.ink3, marginBottom:6 };
    if (effectiveOwnerCol && ownerMatches.length) {
      // Collapse the messy spellings onto the people they resolve to
      // ("Jonathan — 2,190 donors, from 4 spellings") — always overridable.
      const { groups, unmatched } = groupOwnerMatches(ownerMatches);
      return (
        <div style={panel}>
          <div style={eyebrow}>Route donors to officers</div>
          <div style={{fontSize:12,color:T.ink3,marginBottom:10}}>
            We found an <strong style={{color:T.ink}}>{effectiveOwnerCol}</strong> column — confirm who each value is. Spelling variants are grouped onto one person; matched donors land in that officer's portfolio.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {groups.map(g => {
              const cur = ownerMap[g.values[0].value] ?? "";
              const groupPending = String(g.userId).startsWith("invite:");
              const badge = g.matchType === "email" ? "matched by email" : "matched by name";
              return (
                <div key={g.userId} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12.5,color:T.ink,fontWeight:700,whiteSpace:"nowrap"}}>{g.userName}{groupPending&&<span style={{color:T.gold600||"#a97f22",fontWeight:600}}> · pending</span>}</span>
                  <span style={{fontSize:10.5,color:T.green600,fontWeight:600}}>{g.totalCount} donor{g.totalCount===1?"":"s"} · {badge}{g.spellingCount>1?` · from ${g.spellingCount} spellings`:""}</span>
                  {g.spellingCount>1 && (
                    <span style={{fontSize:10.5,color:T.ink3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:230}} title={g.values.map(v=>v.value).join(", ")}>
                      ({g.values.map(v=>v.value).join(", ")})
                    </span>
                  )}
                  <span style={{flex:1}}/>
                  <select value={cur} onChange={e=>setGroupOwner(g, e.target.value)}
                    style={{background:T.white,border:`1px solid ${cur?T.green600:T.bg3}`,borderRadius:7,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer",maxWidth:230}}>
                    <option value="">Leave unassigned</option>
                    {orgUsers.map(u => <option key={u.id} value={u.id}>{officerOptionLabel(u)}</option>)}
                  </select>
                </div>
              );
            })}
            {unmatched.map(mm => {
              const invited = invitedValues[mm.value];
              return (
                <div key={mm.value} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12.5,color:T.ink,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}} title={mm.value}>{mm.value}</span>
                  <span style={{fontSize:10.5,color:(T.gold600||"#a97f22"),fontWeight:600}}>no match · ×{mm.count}</span>
                  <span style={{flex:1}}/>
                  <select value={ownerMap[mm.value] ?? ""} onChange={e=>setOwnerMap(p=>({...p,[mm.value]:e.target.value}))}
                    style={{background:T.white,border:`1px solid ${ownerMap[mm.value]?T.green600:T.bg3}`,borderRadius:7,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer",maxWidth:230}}>
                    <option value="">Leave unassigned</option>
                    {orgUsers.map(u => <option key={u.id} value={u.id}>{officerOptionLabel(u)}</option>)}
                  </select>
                  {!ownerMap[mm.value] && !invited && (
                    <button onClick={()=>{ setInviteFor(mm.value); setInviteEmail(mm.value.includes("@")?mm.value:""); setInviteErr(""); }}
                      style={{background:"transparent",border:`1px solid ${T.gold500}`,borderRadius:7,padding:"4px 10px",color:T.gold600||"#a97f22",fontSize:11,fontWeight:700,cursor:"pointer"}}>Invite</button>
                  )}
                  {invited && <span style={{fontSize:11,color:T.green600,fontWeight:700}}>✓ invited</span>}
                </div>
              );
            })}
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:8}}>Unmatched officers → invite them (they become assignable as pending; donors resolve to their portfolio when they accept) or leave unassigned. Never silently mis-assigned.</div>
          {inviteFor && (
            <div style={{marginTop:10,background:T.white,border:`1px solid ${T.bg3}`,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:12,color:T.ink,marginBottom:6}}>Invite <strong>{inviteFor}</strong> as a gift officer</div>
              <div style={{display:"flex",gap:6}}>
                <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="officer@email.org" style={{...inp,flex:1}}/>
                <button onClick={sendOfficerInvite} disabled={!inviteEmail.trim()||inviteBusy}
                  style={{background:inviteEmail.trim()?T.green600:T.bg2,border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:inviteEmail.trim()?"pointer":"not-allowed"}}>{inviteBusy?"Sending…":"Send invite"}</button>
                <button onClick={()=>{setInviteFor(null);setInviteEmail("");setInviteErr("");}} style={{background:"transparent",border:`1px solid ${T.bg3}`,borderRadius:8,padding:"8px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
              </div>
              {inviteErr && <div style={{color:T.terracotta,fontSize:11,marginTop:6}}>{inviteErr}</div>}
            </div>
          )}
        </div>
      );
    }
    // No owner column → bulk options.
    return (
      <div style={panel}>
        <div style={eyebrow}>Assign these donors to an officer</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:10}}>No owner/officer column detected. Route them all now, or leave unassigned and split them from the Directory later.</div>
        <select value={bulkAssign} onChange={e=>setBulkAssign(e.target.value)}
          style={{background:T.white,border:`1px solid ${bulkAssign?T.green600:T.bg3}`,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer",width:"100%"}}>
          <option value="">Leave unassigned (assign later from the Directory)</option>
          {myId && <option value="__me__">Assign all to me</option>}
          {orgUsers.filter(u=>u.id!==myId).map(u => <option key={u.id} value={u.id}>Assign all to {u.name}{u.pending?" (invited — pending)":""}</option>)}
        </select>
      </div>
    );
  }

  // ── Shared styles ──
  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  // ── Result screen ──
  if (result !== null) {
    const hasBatchErrors = result.batchErrors?.length > 0;
    return (
      <Modal onClose={onClose} width={700} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
        padding={28} ariaLabel={"Import result"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
        <div style={{textAlign:"center"}}>
          {/* BUILD-79 Part 3.3 — the check mark is EARNED: amount + date
              mapped, non-zero dollars, both axes balanced. Anything less is
              amber and names what is missing. */}
          <div style={{fontSize:36,marginBottom:12,color:hasBatchErrors?T.terracotta:(result.summaryHealth&&!result.summaryHealth.greenEarned)?(T.gold600||"#a97f22"):T.ink}}>
            {hasBatchErrors?"✕":(result.summaryHealth&&!result.summaryHealth.greenEarned)?"◑":"✓"}
          </div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>
            {hasBatchErrors ? "Import finished with errors." : (result.summaryHealth&&!result.summaryHealth.greenEarned) ? "Imported — with gaps you should read." : "Import complete."}
          </div>
          {result.summaryHealth && !result.summaryHealth.greenEarned && result.summaryHealth.missing.length > 0 && (
            <div style={{textAlign:"left",background:T.gold100||"#f6eccf",border:`1px solid ${T.gold300||"#e7cf91"}`,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12.5,color:T.ink,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.gold700||"#8a6d1f",marginBottom:4}}>What's missing before this counts as fully accounted for</div>
              {result.summaryHealth.missing.map((m,i)=><div key={i}>· {m}</div>)}
            </div>
          )}
          <div style={{fontSize:14,color:T.ink3,marginBottom:hasBatchErrors?12:28,lineHeight:1.8}}>
            <strong style={{color:T.ink}}>{result.created}</strong> donors added
            {result.giftsInserted > 0 && <> · <strong>{result.giftsInserted}</strong> gifts attached</>}
            {result.duplicatesInFile > 0 && <> · <strong>{result.duplicatesInFile}</strong> duplicate row{result.duplicatesInFile===1?"":"s"} within this file collapsed</>}
            {result.duplicatesOnFile > 0 && <> · <strong>{result.duplicatesOnFile}</strong> matched record{result.duplicatesOnFile===1?"":"s"} already in Steward</>}
            {result.duplicates > 0 && !result.duplicatesInFile && !result.duplicatesOnFile && <> · <strong>{result.duplicates}</strong> duplicates skipped</>}
            {result.twinCandidates > 0 && <> · <strong>{result.twinCandidates}</strong> same-day/same-amount twins imported (reviewable)</>}
            {result.newDonors > 0 && <> · <strong>{result.newDonors}</strong> created from unmatched gifts</>}
            {result.warned > 0    && <> · <strong>{result.warned}</strong> imported with warnings</>}
            {result.skipped > 0   && <> · <strong>{result.skipped.toLocaleString()}</strong> {result.refusedRows?.length ? "refused with line-numbered reasons" : "skipped (no name, email, or organization)"}</>}
          </div>
          {/* BUILD-101 Part 6 — the memberships, and every row held, by line. */}
          {result.memberships?.rows > 0 && (
            <div data-testid="import-memberships" style={{textAlign:"left",fontSize:13,color:T.ink,lineHeight:1.7,marginBottom:16}}>
              <strong>{result.memberships.written}</strong> membership{result.memberships.written===1?"":"s"} imported as history (no payments posted)
              {result.memberships.skippedDuplicate > 0 && <> · <strong>{result.memberships.skippedDuplicate}</strong> already on file</>}
              {result.memberships.held.length > 0 && <> · <strong>{result.memberships.held.length}</strong> held for you:</>}
              {result.memberships.held.slice(0, 20).map((h, i) => (
                <div key={i} style={{color:T.ink3}}>{h.line ? `Line ${h.line}` : "A row"}{h.name ? ` (${h.name})` : ""}: {h.why}</div>))}
              {result.memberships.held.length > 20 && <div style={{color:T.ink3}}>and {result.memberships.held.length - 20} more.</div>}
            </div>)}
          {/* BUILD-72 Part 1 — THE RECONCILIATION, on the user's screen.
              rows_in_file = created + skipped + errored, and the same for
              dollars. The user sees the arithmetic, not a reassurance that it
              worked. If it does not balance the server has already refused the
              import (409) and nothing was written — this panel only ever
              renders a balanced file or the shape of what went where. */}
          {result.reconciliation && result.reconciliation.rows.inFile > 0 && (() => {
            const R = result.reconciliation;
            const money = n => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
            const line = (label, rows, dollars, tone) => (
              <div style={{display:"flex",justifyContent:"space-between",gap:12,color:tone||T.ink2}}>
                <span>{label}</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>{rows.toLocaleString()} · {money(dollars)}</span>
              </div>
            );
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:(result.summaryHealth&&!result.summaryHealth.greenEarned)?(T.gold700||"#8a6d1f"):T.ink3,marginBottom:6}}>
                {(result.summaryHealth&&!result.summaryHealth.greenEarned) ? "The arithmetic — read the gaps above before trusting it" : "Every row and every dollar accounted for"}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink}}>
                <span>In your file</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>
                  {/* BUILD-84 P0-1 — "no amount-shaped column found" was false
                      whenever currency columns existed and none was MAPPED, which
                      is the common case for a file that carries no gifts. */}
                  {R.rows.inFile.toLocaleString()} · {R.dollars.inFile == null
                    ? ((R.dollars.currencyColumns || []).length ? "unknown — no column is mapped as the gift amount" : "unknown — no column in this file reads as currency")
                    : money(R.dollars.inFile)}
                </span>
              </div>
              {R.dollars.scanColumn && R.dollars.inFile != null && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>dollars scanned independently from your “{R.dollars.scanColumn}” column — not from the mapping</div>
              )}
              {/* BUILD-80 Part 1.2 — the number-format conventions the parser
                  actually applied, shown so a $2,000 gift can never silently
                  become $200,000 again without this line saying why. */}
              {result.amountConventions?.commaDecimal > 0 && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{result.amountConventions.commaDecimal.toLocaleString()} amount{result.amountConventions.commaDecimal===1?"":"s"} used a comma decimal (European format) and {result.amountConventions.commaDecimal===1?"was":"were"} read as such</div>
              )}
              {result.dateConvention?.applied === "dmy" && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{result.dateConvention.slashCells.toLocaleString()} dates use day/month/year — {result.dateConvention.dayFirstEvidence.toLocaleString()} would have been impossible the other way</div>
              )}
              {result.amountConventions?.spaceThousands > 0 && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{result.amountConventions.spaceThousands.toLocaleString()} amount{result.amountConventions.spaceThousands===1?"":"s"} used a space between thousands and {result.amountConventions.spaceThousands===1?"was":"were"} read as such</div>
              )}
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              {line("Imported", R.rows.created, R.dollars.created)}
              {R.rows.skipped > 0 && line("Skipped", R.rows.skipped, R.dollars.skipped)}
              {Object.entries(R.skippedReasons || {}).map(([reason, v]) =>
                <div key={reason} style={{paddingLeft:12,color:T.ink3,fontSize:11}}>
                  {IMPORT_REASON_LABELS[reason] || reason.replace(/_/g," ")}: {v.rows.toLocaleString()} · {money(v.dollars)}
                </div>)}
              {R.rows.errored > 0 && line("Errored", R.rows.errored, R.dollars.errored, T.terracotta)}
              {Object.entries(R.erroredReasons || {}).map(([reason, v]) =>
                <div key={reason} style={{paddingLeft:12,color:T.terracotta,fontSize:11}}>
                  {IMPORT_REASON_LABELS[reason] || reason.replace(/_/g," ")}: {v.rows.toLocaleString()} · {money(v.dollars)}
                </div>)}
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              <div style={{display:"flex",justifyContent:"space-between",gap:12,fontWeight:700,
                           color: R.balanced ? T.ink : T.terracotta}}>
                <span>{R.balanced ? "Balanced" : "DOES NOT BALANCE"}</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>
                  {(R.rows.created + R.rows.skipped + R.rows.errored).toLocaleString()} · {money(R.dollars.created + R.dollars.skipped + R.dollars.errored)}
                </span>
              </div>
              {/* BUILD-77 Part 3b — if an org cannot get back what Steward
                  refused, Steward ate it. Exactly the skipped+errored rows,
                  with line number and reason, as a CSV. */}
              {result.refusedRows?.length > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`}}>
                  <button onClick={()=>{
                    const esc=v=>{const t=String(v??"");return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
                    const rawHeaders=Object.keys(result.refusedRows[0].raw||{});
                    const lines=[["Line","Disposition","Reason",...rawHeaders].map(esc).join(",")];
                    for(const r of result.refusedRows) lines.push([r.line,r.disposition,r.reason||"",...rawHeaders.map(h=>r.raw?.[h]??"")].map(esc).join(","));
                    const blob=new Blob([lines.join("\n")],{type:"text/csv"});
                    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
                    a.download="not-imported-rows.csv";a.click();URL.revokeObjectURL(a.href);
                  }} style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    {(()=>{
                      // BUILD-80 Part 10 — the download keeps EVERYTHING that
                      // isn't a gift row, but the label separates true
                      // refusals from rows routed to their own surfaces.
                      const refusedN = result.refusedRows.filter(r2=>r2.disposition==="errored"||["no_amount","zero_amount"].includes(r2.reason)).length;
                      const routedN = result.refusedRows.length - refusedN;
                      return <>↓ Download the {result.refusedRows.length} rows that are not gift rows ({refusedN} refused · {routedN} routed to pledge/soft-credit/in-kind surfaces) — line numbers + reasons</>;
                    })()}
                  </button>
                </div>
              )}
              {result.fileTotalRow && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`,color:T.ink2}}>
                  <div style={{fontWeight:700,color:T.ink}}>Your file's own total row (line {result.fileTotalRow.line}) says {money(result.fileTotalRow.stated)}.</div>
                  <div>Steward imported {money(result.fileTotalRow.imported)} · difference {money(Math.abs(result.fileTotalRow.difference))}{result.fileTotalRow.difference < 0 ? " (Steward imported MORE than the report's total)" : ""}</div>
                  {/* BUILD-80 Part 1.5 — when Steward imported MORE than the
                      report's own total, skipped and errored rows cannot be
                      the reason (refusing rows only ever lowers the import).
                      The line says what it can't explain instead of
                      manufacturing a cause. */}
                  {result.fileTotalRow.difference < 0 && (
                    <div style={{color:T.terracotta,fontSize:11}}>
                      We cannot explain importing more than the report's own total — that usually means an amount was misread
                      (a European decimal, a shifted column) or the report's total excludes rows we counted. Check the largest
                      gifts below before trusting these numbers.
                    </div>
                  )}
                  {result.fileTotalRow.difference > 0 && (
                    <div style={{color:T.ink3,fontSize:11}}>
                      of which: skipped rows {money(result.fileTotalRow.explained.skipped)} · errored rows {money(result.fileTotalRow.explained.errored)}
                      {Math.abs(result.fileTotalRow.difference) - result.fileTotalRow.explained.skipped - result.fileTotalRow.explained.errored > 0.005 &&
                        <> · the rest is how the report itself counted (its total may exclude soft credits, pledges or duplicates — compare before trusting either number)</>}
                    </div>
                  )}
                </div>
              )}
              {result.warnedRows?.length > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`}}>
                  <button onClick={()=>{
                    const esc=v=>{const t=String(v??"");return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
                    const rawHeaders=Object.keys(result.warnedRows[0].raw||{});
                    const lines=[["Line","Warnings",...rawHeaders].map(esc).join(",")];
                    for(const r of result.warnedRows) lines.push([r.line,(r.reasons||[]).join(" | "),...rawHeaders.map(h=>r.raw?.[h]??"")].map(esc).join(","));
                    const blob=new Blob([lines.join("\n")],{type:"text/csv"});
                    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
                    a.download="imported-with-warnings.csv";a.click();URL.revokeObjectURL(a.href);
                  }} style={{background:"transparent",border:"none",padding:0,color:T.gold700||"#8a6d1f",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    ↓ Download the {result.warnedRows.length} rows imported with warnings (line numbers + reasons)
                  </button>
                </div>
              )}
              {result.matchesExistingCount > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`,color:T.ink2}}>
                  <strong style={{color:T.ink}}>{result.matchesExistingCount}</strong>{" "}
                  {result.matchesExistingCount === 1 ? "gift matches one" : "gifts match ones"} already on file
                  (same donor, date and amount). {result.matchesExistingCount === 1 ? "It was" : "They were"} imported —
                  review and delete any that are genuine duplicates.
                </div>
              )}
              {/* BUILD-73 Part 2 — this used to read "Amounts are stored in whole
                  dollars; $X of cents was rounded off." It is no longer true:
                  the money seam (money.js) stores what the file said, to the
                  cent. BUILD-72 P3-4 asked that a future cents fix come to this
                  line and change it deliberately — this is that change.
                  roundingAdjustment is still reported by the API and is now
                  always 0; if it ever isn't, a rounding path has come back and
                  the user should be told, so the surfacing stays. */}
              {Math.abs(result.roundingAdjustment || 0) >= 0.005 && (
                <div style={{marginTop:6,color:T.terra700,fontSize:11}}>
                  {money(Math.abs(result.roundingAdjustment))} of cents could not be stored — please report this.
                </div>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 8 — stale Frequency flags: the pattern wins, and
              the flag is SHOWN rather than silently overridden. */}
          {result.frequencyConflicts?.length > 0 && (
            <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>
                Frequency flags the gifts contradict
              </div>
              {result.frequencyConflicts.slice(0,10).map((c,i)=>(
                <div key={i} style={{color:T.ink2}}><strong style={{color:T.ink}}>{c.name}</strong> — {c.message}. The pattern wins; no monthly expectations were set.</div>
              ))}
            </div>
          )}
          {/* BUILD-80 Part 6.2 — every merge the importer made, reviewable and
              reversible: the surviving record, the folded variants, the
              reason. Undo splits them back with their gifts. */}
          {(result.mergeRows?.length > 0 || result.identity?.mergeReview?.length > 0) && (() => {
            const merges = result.mergeRows?.length ? result.mergeRows : (result.identity.mergeReview || []).map(m => ({ ...m, id: null }));
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>
                Rows we merged into one donor — review these
              </div>
              {merges.slice(0,25).map((m,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"baseline"}}>
                  <span style={{minWidth:0,color:T.ink2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <strong style={{color:T.ink}}>{m.surviving}</strong>
                    {" ← "}{m.folded.map(f=>`${f.label} (${f.via})`).join(" · ")}
                  </span>
                  {m.id && (
                    <button onClick={async()=>{
                      try { await apiFetch(`/import-merges/${m.id}/undo`, { method:"POST", body: JSON.stringify({}) });
                        setResult(r=>({ ...r, mergeRows: r.mergeRows.map(x=>x.id===m.id?{...x, undone:true}:x) }));
                      } catch(e){ alert(errorMessage(e, "Undo failed")); }
                    }} disabled={m.undone}
                      style={{background:"transparent",border:`1px solid ${T.bg3}`,borderRadius:6,padding:"2px 8px",color:m.undone?T.ink3:T.ink,fontSize:11,cursor:m.undone?"default":"pointer",flexShrink:0}}>
                      {m.undone ? "Split back" : "Undo"}
                    </button>
                  )}
                </div>
              ))}
              {merges.length > 25 && <div style={{color:T.ink3}}>+{merges.length-25} more merges recorded — every one is undoable.</div>}
              {result.identity?.householdCandidates?.length > 0 && (
                <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${T.bg3}`,color:T.ink3,fontSize:11}}>
                  {result.identity.householdCandidates.length} email{result.identity.householdCandidates.length===1?"":"s"} sit behind more than one person (e.g. {result.identity.householdCandidates[0].names.join(" + ")}) — kept as separate people, household candidates for you to join.
                </div>
              )}
              {result.identity?.conflictedIds?.length > 0 && (
                <div style={{marginTop:4,color:T.ink3,fontSize:11}}>
                  {result.identity.conflictedIds.length} donor ID{result.identity.conflictedIds.length===1?"":"s"} shared by different people (legacy merge damage) — never merged on, both sides flagged.
                </div>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 5.2 — the rows that are NOT gifts, each on its own
              line with rows and dollars, outside net cash. */}
          {result.semantics?.tally && (() => {
            const t = result.semantics.tally;
            const money = n => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
            const rows = [
              ["Soft credits", t.softCredits, "a link to the real gift — no money on the credited person"],
              ["Pledge commitments", t.pledges, "on the donor's record, never in totals"],
              ["Future pledge installments", t.pledgeScheduled, "the schedule — money that hasn't arrived yet"],
              ["In-kind gifts", t.inKind, "recorded at fair market value, never cash"],
              ["Corporate matching gifts", t.matching, "counted as cash on the CORPORATION; the person gets the relationship"],
              ["Anonymous gifts", t.anonymous, "one holding record — different people, never a cadence, never on a list"],
            ].filter(([, v]) => v && v.rows > 0);
            if (!rows.length) return null;
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>
                Rows that are not gifts — tracked on their own surfaces
              </div>
              {rows.map(([label, v, hint]) => (
                <div key={label}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink}}>
                    <span>{label}</span>
                    <span style={{fontVariantNumeric:"tabular-nums"}}>{v.rows.toLocaleString()} · {money(v.dollars)}</span>
                  </div>
                  <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{hint}</div>
                </div>
              ))}
              {result.semanticsApplied && (
                <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${T.bg3}`,color:T.ink3,fontSize:11}}>
                  Recorded: {result.semanticsApplied.pledges} pledge{result.semanticsApplied.pledges===1?"":"s"} · {result.semanticsApplied.inKind} in-kind · {result.semanticsApplied.links} relationship link{result.semanticsApplied.links===1?"":"s"}{result.semanticsApplied.personsCreated ? ` · ${result.semanticsApplied.personsCreated} people created from links` : ""}{result.semanticsApplied.twinsFlagged ? ` · ${result.semanticsApplied.twinsFlagged} possible duplicates flagged for review` : ""}
                </div>
              )}
              {result.semanticsError && (
                <div style={{marginTop:6,color:T.terracotta,fontSize:11}}>These rows could not be recorded: {result.semanticsError}</div>
              )}
              {result.semantics.reviewTwins?.length > 0 && (
                <div style={{marginTop:4,color:T.ink3,fontSize:11}}>{result.semantics.reviewTwins.length} rows say "migrated from legacy ID … may duplicate" — imported and flagged for a human, never decided by the machine.</div>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 1.4 — THE LARGEST GIFTS, before anything trusts
              them. A number that is 10% of the file in one row is a parse
              error until a human says otherwise; a $200,000 row next to
              $2,500 rows is a question a human answers in one second. */}
          {result.largestGifts?.length > 0 && (
            <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>
                The five largest gifts we imported — check these first
              </div>
              {result.largestGifts.map((g,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,color:T.ink2}}>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <strong style={{color:T.ink}}>{g.name}</strong>{g.date ? ` — ${g.date}` : ""}
                  </span>
                  <span style={{color:T.ink,flexShrink:0,fontVariantNumeric:"tabular-nums"}}>
                    {"$" + Number(g.dollars).toLocaleString(undefined,{maximumFractionDigits:2})}<span style={{color:T.ink3}}> · line {g.line}</span>
                  </span>
                </div>
              ))}
              <div style={{marginTop:4,color:T.ink3,fontSize:11}}>If one of these is far larger than the others, open the row before it leads a thank-you queue or sets a goal.</div>
            </div>
          )}
          {/* BUILD-77 Part 1c — WE FLAGGED THESE. Every row where a free-text
              safety marker was detected, with the matched phrase, so a human
              confirms now rather than discovering after an ask goes out. */}
          {result.flaggedRows?.length > 0 && (() => {
            // BUILD-88a A.7 — ONE LINE PER DONOR, WITH A COUNT. This list is
            // built from FILE ROWS, and a donor with forty gifts and one
            // "deceased" note in their notes column filled forty lines of it
            // with the same sentence. It is a list of PEOPLE to confirm, so it
            // collapses onto the person: their flags, the phrase we matched,
            // the line it first appeared on, and how many rows said it. Paged
            // at fifty, because a page of names nobody can finish reading is
            // the same failure a second time.
            const byDonor = [];
            const seen = new Map();
            for (const f of result.flaggedRows) {
              const key = String(f.name || "").toLowerCase();
              if (!seen.has(key)) { seen.set(key, { ...f, rows: 0 }); byDonor.push(seen.get(key)); }
              const e = seen.get(key);
              e.rows++;
              e.flags = { deceased: e.flags.deceased||f.flags.deceased, doNotSolicit: e.flags.doNotSolicit||f.flags.doNotSolicit,
                          doNotContact: e.flags.doNotContact||f.flags.doNotContact, doNotMail: e.flags.doNotMail||f.flags.doNotMail,
                          doNotEmail: e.flags.doNotEmail||f.flags.doNotEmail };
            }
            const shown = byDonor.slice(0, flaggedPage * 50);
            return <div style={{textAlign:"left",background:T.gold100||"#f6eccf",border:`1px solid ${(T.gold500||"#c9a84c")}55`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.gold600||"#a97f22",marginBottom:6}}>
                We flagged these — {byDonor.length.toLocaleString()} {byDonor.length===1?"person":"people"} from the notes column, please confirm
              </div>
              {shown.map((f,i)=>(
                <div key={i} data-flagged-donor={f.name} style={{display:"flex",justifyContent:"space-between",gap:10,color:T.ink2}}>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <strong style={{color:T.ink}}>{f.name}</strong>{" — "}
                    {[f.flags.deceased&&"deceased",f.flags.doNotSolicit&&"do-not-solicit",f.flags.doNotContact&&"do-not-contact",f.flags.doNotMail&&"do-not-mail",f.flags.doNotEmail&&"do-not-email"].filter(Boolean).join(", ")}
                    {f.rows>1 && <span style={{color:T.ink3}}>{` (${f.rows.toLocaleString()} rows)`}</span>}
                  </span>
                  <span style={{color:T.ink3,flexShrink:0}}>line {f.line} · "{String(f.matched[0]||"").slice(0,32)}"</span>
                </div>
              ))}
              {byDonor.length > shown.length && (
                <button onClick={()=>setFlaggedPage(p2=>p2+1)}
                  style={{background:"none",border:"none",padding:0,marginTop:6,color:T.greenDk,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>
                  Show {Math.min(50, byDonor.length - shown.length).toLocaleString()} more of {byDonor.length.toLocaleString()} — every one is on the donor's record with its flag set
                </button>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 4.3 — the CONFLICTS, shown: most restrictive won,
              and the human is told which homes disagreed before an ask can
              go out on a column's say-so. */}
          {result.exclusionConflicts?.length > 0 && (
            <div style={{textAlign:"left",background:T.gold100||"#f6eccf",border:`1px solid ${(T.gold500||"#c9a84c")}55`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.gold600||"#a97f22",marginBottom:6}}>
                Columns that disagree — we kept the most restrictive
              </div>
              {result.exclusionConflicts.slice(0,20).map((c,i)=>(
                <div key={i} style={{color:T.ink2}}>
                  <strong style={{color:T.ink}}>{c.name}</strong> — {c.message}
                </div>
              ))}
              {result.exclusionConflicts.length > 20 && <div style={{color:T.ink3}}>+{result.exclusionConflicts.length-20} more, each set on the donor's record.</div>}
            </div>
          )}
          {/* BUILD-78 Part 3.3 — the COLUMN axis of the invariant. Left side
              from the physical header parse at parse entry; right side summed
              independently from the disposition ledger. The server refused
              the write if they disagreed, so what renders here balanced. */}
          {result.columnAxis && (() => {
            const CA = result.columnAxis; const c = CA.summary.counts;
            const custom = c["custom-existing"] + c["custom-new"];
            const parts = [
              [c.core, "mapped"],
              [custom, `stored as custom${c["custom-new"] ? ` (${c["custom-new"]} new)` : ""}`],
              [c.flag, "flagged"],
              [c.discarded, "discarded"],
              [c.refused, "refused"],
            ].filter(([n]) => n > 0);
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>Every column accounted for</div>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink}}>
                <span>Columns in your file</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>{CA.inFile}</span>
              </div>
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              {parts.map(([n, label]) => (
                <div key={label} style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink2}}>
                  <span>{label[0].toUpperCase()+label.slice(1)}</span>
                  <span style={{fontVariantNumeric:"tabular-nums"}}>{n}</span>
                </div>
              ))}
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              <div style={{display:"flex",justifyContent:"space-between",gap:12,fontWeight:700,color:CA.summary.balanced?T.ink:T.terracotta}}>
                <span>{CA.summary.balanced?"Balanced":"DOES NOT BALANCE"}</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>{CA.summary.accounted}</span>
              </div>
              <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`,color:T.ink3,fontSize:11,lineHeight:1.6}}>
                {CA.ledger.map(e => {
                  const what = e.disposition === "core" ? `→ ${e.role}`
                    : e.disposition === "custom-new" ? `→ new custom field "${e.label}"`
                    : e.disposition === "custom-existing" ? "→ existing custom field"
                    : e.disposition === "flag" ? `→ ${String(e.flag||"").replace(/([A-Z])/g," $1").toLowerCase()} flag`
                    : e.disposition === "discarded" ? "discarded (acknowledged)"
                    : `not importable — ${e.reason || "refused"}`;
                  return <div key={e.index}>{String(e.header).trim() || `(column ${e.index+1}, no header)`} {what}</div>;
                })}
              </div>
            </div>;
          })()}
          {/* BUILD-58 Part 2 — nothing in the file vanishes silently: every
              column is mapped, deliberately ignored, or called out as
              unrecognized; every skipped ROW has a stated reason. */}
          {!result.columnAxis && (result.columnReport || result.columnReports) && (() => {
            const sections = result.columnReports
              ? [["Donor sheet", result.columnReports.donorSheet], ["Gift sheet", result.columnReports.giftSheet]]
              : [["Your file", result.columnReport]];
            const rr = result.rowReport;
            const rowNotes = rr ? [
              rr.negativeRows > 0 && `${rr.negativeRows} negative-amount row${rr.negativeRows === 1 ? "" : "s"} not imported (refunds/adjustments — Steward has no negative-gift model)`,
              rr.unparsableAmountRows > 0 && `${rr.unparsableAmountRows} row${rr.unparsableAmountRows === 1 ? "" : "s"} with unreadable amounts not imported`,
              rr.zeroAmountRows > 0 && `${rr.zeroAmountRows} zero-amount row${rr.zeroAmountRows === 1 ? "" : "s"} not imported`,
            ].filter(Boolean) : [];
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:24,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>Every column accounted for</div>
              {sections.map(([label, c]) => c && <div key={label} style={{marginBottom:6}}>
                <strong style={{color:T.ink}}>{label}:</strong>{" "}
                <span style={{color:T.ink2}}>{c.mapped.map(m => `${m.header} → ${m.field}`).join(" · ") || "no columns mapped"}</span>
                {c.ignored.length > 0 && <div style={{color:T.ink3}}>Not imported (by design): {c.ignored.join(" · ")}</div>}
                {c.unrecognized.length > 0 && <div style={{color:T.terracotta,fontWeight:600}}>Not imported — unrecognized: {c.unrecognized.join(" · ")}</div>}
              </div>)}
              {rowNotes.length > 0 && <div style={{borderTop:`1px solid ${T.bg3}`,paddingTop:6,marginTop:6,color:T.ink2}}>{rowNotes.map((n,i) => <div key={i}>{n}</div>)}</div>}
            </div>;
          })()}
          {hasBatchErrors && (
            <div style={{background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:10,padding:"10px 14px",marginBottom:24,textAlign:"left",fontSize:12,color:"#8a3a24"}}>
              <strong>Batch errors — some rows may not have been inserted:</strong>
              {result.batchErrors.map((e,i) => <div key={i} style={{marginTop:4}}>Rows {e.rows}: {e.error}</div>)}
            </div>
          )}
          <button onClick={onImported} style={{background:"#0d5c3a",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </Modal>
    );
  }

  const donorCount = payload.donors.length;
  const giftCount  = payload.gifts.length;
  const donorHeaders = parsed ? parsed.headers.filter(h => !YEAR_HDR_PAT.test(String(h))) : [];
  const TX_ROLES = [
    ["donorName","Donor name"],["donorEmail","Email"],["amount","Gift amount"],["date","Gift date"],
    ["type","Type"],["campaign","Campaign / fund"],["notes","Notes"],["externalId","Gift / transaction ID"],["phone","Phone"],["city","City"],["state","State"],
    ["softCreditName","Soft credit to"],["softCreditAmount","Soft credit amount"],
    ["tributeName","In honour or memory of"],["tributeType","Tribute type"],["tributeNotify","Tribute: who to tell"],
    ["matchEmployer","Matching employer"],
    ["wealthRating","Wealth screen rating"],["wealthCapacity","Wealth screen capacity"],["wealthDate","Wealth screen date"],
    // BUILD-99 (major gifts) Part 6 — A PROPOSAL IS NOT A GIFT, so the mapper has
    // to be able to say which one a column is. Team only, because the whole
    // major-gifts layer is (the 2026-07-19 split); a Core org importing a file
    // with an ask column maps it to a custom field as before rather than being
    // shown a target it cannot use. `owner` is BUILD-36's existing target and is
    // relabelled, not duplicated — BUILD-98 Part 6's line for it is the one this
    // replaces, so there is still exactly one.
    ...(isTeam ? [
      ["owner","Assigned officer (portfolio owner)"],
      ["proposalPurpose","Proposal: what the ask is for"],
      ["proposalAmount","Proposal: ask amount (NOT a gift)"],
      ["proposalStage","Proposal: stage"],
      ["proposalCloseDate","Proposal: expected close date"],
      ["proposalProbability","Proposal: probability"],
    ] : []),
  ];

  return (
    <Modal onClose={onClose} width={700} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel={"Import donors"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Donors</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>One file — donors and their giving history · shape auto-detected · stages auto-assigned</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {/* The uploaded file as a tile — name, size, detected shape/row count.
            Still a drop target: dropping a new file re-parses. */}
        {srcFile && (parsed || xlsxSheets || bothMode || workbook) && (
          <div style={{marginBottom:16}}>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Replace file"
              fileMeta={srcFile ? {
                name: srcFile.name, size: srcFile.size,
                detail: parsed ? `${parsed.rows.length.toLocaleString()} rows · ${shapeLabel(effectiveShape)}`
                  : bothMode ? "donors + gift history workbook"
                  : workbook ? `${workbook.roled.length} sheets · one import`
                  : `${(xlsxSheets || []).length} sheets`,
              } : null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}
              onRemove={()=>{setSrcFile(null);setParsed(null);setXlsxSheets(null);setBothMode(null);setWorkbook(null);setErr("");}}/>
          </div>
        )}

        {/* ── BUILD-82: a workbook is ONE import (all xlsx land here) ── */}
        {workbook && (
          <WorkbookImport workbook={workbook} fileName={srcFile?.name}
            vocabulary={org?.vocabulary} onOpenHome={onOpenHome}
            onClose={()=>{setWorkbook(null);setSrcFile(null);setErr("");}}
            onImported={onImported} />
        )}

        {/* ── Step 1a: Upload / Paste ── */}
        {!parsed && !xlsxSheets && !workbook && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload file</div>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Drop your spreadsheet here, or browse"
              fileMeta={null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>Drop a donor list OR a raw gift export — we detect the shape and build donors + their giving history. .csv, .tsv, .xlsx, .xls.</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={6}
            placeholder={"Name,Email,Total Giving,Last Gift Date\nJane Smith,jane@example.com,5000,2024-11-01"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err && <div style={{color:"#b8593f",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doParse} disabled={!csvText.trim()}
            style={{background:csvText.trim()?T.green600:T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse →
          </button>
        </>)}

        {/* ── Step 1b: Multi-sheet picker (xlsx with 2+ data sheets) ── */}
        {!parsed && xlsxSheets && !bothMode && (<>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>This workbook has {xlsxSheets.length} sheets with data.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:16}}>Pick the sheet to import. You can import the others separately afterward.</div>

          {/* Primary CTA — a Donors + Gift History workbook: import both, linked */}
          {workbookRoles?.isBoth && (
            <div style={{background:`linear-gradient(180deg, ${T.green100||"#edf3ee"}, ${T.white})`,border:`1.5px solid ${T.green600||"#1e6b45"}`,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.green600||"#1e6b45",marginBottom:4}}>Donors + gift history detected</div>
              <div style={{fontSize:13.5,color:T.ink,lineHeight:1.5,marginBottom:10}}>
                <strong>{workbookRoles.donorSheet.name}</strong> ({workbookRoles.donorSheet.rowCount.toLocaleString()} donors) and{" "}
                <strong>{workbookRoles.giftSheet.name}</strong> ({workbookRoles.giftSheet.rowCount.toLocaleString()} gifts) — we can link the gifts to their donors in one pass.
              </div>
              <button onClick={startImportBoth}
                style={{width:"100%",background:T.green600||"#1e6b45",border:"none",borderRadius:10,padding:"12px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Import both — donors + their gift history →
              </button>
            </div>
          )}

          {workbookRoles?.isBoth && (
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Or import one sheet at a time</div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {xlsxSheets.map((s,i) => (
              <div key={s.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 16px"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{s.rowCount.toLocaleString()} rows · {s.headers.filter(Boolean).length} columns</div>
                </div>
                <button onClick={()=>applyParsed(s.headers,s.rows,s.physical,s.report)}
                  style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {i===0?"Use this ←":"Select"}
                </button>
              </div>
            ))}
          </div>
          <button onClick={()=>setXlsxSheets(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
        </>)}

        {/* ── Import-both preview: two linked sheets, match column, counts ── */}
        {bothMode && bothPayload && (<>
          <div style={{background:T.gold100||"#f6eccf",border:`1px solid ${T.gold300||"#e7cf91"}`,borderRadius:10,padding:"11px 14px",marginBottom:14}}>
            <div style={{fontSize:12.5,color:T.ink,lineHeight:1.5}}>
              <span style={{fontWeight:700}}>Importing both sheets:</span> donors from <strong>{bothMode.donorSheet.name}</strong>, giving history from <strong>{bothMode.giftSheet.name}</strong> — each gift attached to its donor.
            </div>
          </div>

          {/* Match column selector — which shared field links a gift to its donor */}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>Link gifts to donors by</div>
              <select value={matchKey} onChange={e=>setMatchKey(e.target.value)}
                style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"}}>
                {(bothMode.matchInfo.available.length ? bothMode.matchInfo.available : ["name"]).map(k => (
                  <option key={k} value={k}>{k === "email" ? "Email" : k === "donorId" ? "Donor ID column" : "Donor name"}</option>
                ))}
              </select>
            </div>
            <div style={{fontSize:11,color:T.ink3,marginTop:6}}>
              Matched on{" "}
              <strong>{matchKey === "email" ? (bothMode.matchInfo.giftEmailCol || "email") : matchKey === "donorId" ? (bothMode.matchInfo.giftIdCol || "donor id") : (bothMode.matchInfo.giftNameCol || "name")}</strong>.
              {" "}Unmatched gifts become new donor records — never dropped.
            </div>
          </div>

          {/* Counts */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink,lineHeight:1.7}}>
              <span style={{color:T.green600}}>{(bothPayload.matchedGifts + bothPayload.unmatchedGifts).toLocaleString()}</span> gifts →{" "}
              <span style={{color:T.green600}}>{bothPayload.donors.length.toLocaleString()}</span> donors
              {bothPayload.unmatchedGifts > 0 && <> · <span style={{color:T.gold600||"#a97f22"}}>{bothPayload.unmatchedGifts.toLocaleString()}</span> unmatched → {bothPayload.newDonors.toLocaleString()} new donor{bothPayload.newDonors!==1?"s":""}</>}
              {bothPayload.donorWarned > 0 && <> · <span style={{color:T.gold600||"#a97f22"}}>{bothPayload.donorWarned.toLocaleString()}</span> warnings</>}
              {bothPayload.skippedGifts > 0 && <> · <span style={{color:T.ink3}}>{bothPayload.skippedGifts.toLocaleString()}</span> gift rows skipped (no amount / no donor)</>}
            </div>
          </div>

          {/* Smart stage preview over the real linked history */}
          {Object.keys(bothStagePreview).length > 0 && (
            <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:6}}>Smart Stage Assignment Preview</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(bothStagePreview).map(([s,n]) => (
                  <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                    {s} × {n}
                  </span>
                ))}
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:6}}>Based on the linked giving history. Override after import by dragging in the Kanban.</div>
            </div>
          )}

          {/* Officer routing (Team) — owner column on the donor sheet → teammates */}
          {ownerRoutingUI()}

          {/* Progress bar — see A.7: only while the import is running. */}
          {progress && loading && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:T.ink,fontWeight:600,marginBottom:6}}>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</div>
              <div style={{height:8,background:T.bg3,borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${progress.total?Math.round(progress.done/progress.total*100):0}%`,background:T.green600,transition:"width 0.2s"}}/>
              </div>
            </div>
          )}

          {err && <div style={{color:"#b8593f",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setBothMode(null);setErr("");}} disabled={loading}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:loading?"not-allowed":"pointer",opacity:loading?0.5:1}}>← Back</button>
            <button onClick={doImportBoth} disabled={loading||bothPayload.donors.length===0}
              style={{flex:1,background:loading||bothPayload.donors.length===0?T.bg2:T.green600,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading||bothPayload.donors.length===0?"not-allowed":"pointer",opacity:loading||bothPayload.donors.length===0?0.6:1}}>
              {loading?"Importing…":`Import ${bothPayload.donors.length.toLocaleString()} donors + ${(bothPayload.matchedGifts+bothPayload.unmatchedGifts).toLocaleString()} gifts →`}
            </button>
          </div>
        </>)}

        {/* ── Step 2: Detection + shape-specific mapping + preview ── */}
        {parsed && (<>

          {/* BUILD-79 Part 1.2/1.3/1.4 — report chrome is SHOWN, never imported,
              never counted. Everything above the detected header, every repeated
              header / page line / TOTAL / end marker by line number, and any
              windows-1252 repair. */}
          {parseReport && (parseReport.chromeAbove?.length > 0 || parseReport.chromeRows?.length > 0 || parseReport.cp1252Lines?.length > 0) && (
            <div style={{background:T.bg,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"11px 14px",marginBottom:10,fontSize:12.5,color:T.ink,lineHeight:1.6}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:T.ink3,marginBottom:4}}>This looks like a report export — here's what we set aside</div>
              {parseReport.chromeAbove?.length > 0 && (
                <div>We skipped {parseReport.chromeAbove.length} line{parseReport.chromeAbove.length===1?"":"s"} above your column headers (found on line {parseReport.headerLine?.line}):{" "}
                  {parseReport.chromeAbove.map(c => c.text ? `“${c.text}”` : "(blank)").join(", ")}.</div>
              )}
              {parseReport.chromeRows?.length > 0 && (
                <div>Not imported, not counted: {parseReport.chromeRows.map(c => {
                  const label = c.kind === "repeated_header" ? "repeated header" : c.kind === "page_marker" ? "page marker"
                    : c.kind === "total_row" ? "the report's own TOTAL row" : c.kind === "subtotal_row" ? "subtotal"
                    : c.kind === "end_marker" ? "end-of-report marker" : c.kind === "currency_only" ? "a bare total figure" : c.kind;
                  return `${label} (line ${c.line})`;
                }).join(" · ")}.</div>
              )}
              {parseReport.totalRow && (
                <div>Your file's own total row says <strong>{fmtFull(parseReport.totalRow.amount)}</strong> — we'll reconcile against it after the import.</div>
              )}
              {parseReport.cp1252Lines?.length > 0 && (() => {
                const affected = cp1252RowNames(parseReport, parsed);
                return <div>{affected.length || parseReport.cp1252Lines.length} name{(affected.length||parseReport.cp1252Lines.length)===1?"":"s"} contained Windows-1252 characters and were converted{affected.length ? `: ${affected.map(n=>`“${n}”`).join(" · ")}` : ""}.</div>;
              })()}
              {/* BUILD-80 Part 3 — the source system double-encoded some
                  characters ("æ\u009D\u008E" was 李); each reversal is a
                  byte-exact repair, counted and shown, never silent. */}
              {parseReport.mojibakeRepaired > 0 && (
                <div>{parseReport.mojibakeRepaired} character sequence{parseReport.mojibakeRepaired===1?"":"s"} arrived double-encoded from the source system and {parseReport.mojibakeRepaired===1?"was":"were"} repaired ({parseReport.mojibakeRepairs.slice(0,5).map(r=>r.sequence).join(" · ")}).</div>
              )}
            </div>
          )}

          {/* Detection banner + override — BUILD-79 Part 2: the decision shows
              its evidence, and with too little evidence it becomes a QUESTION. */}
          <div style={{background:effectiveShape==="unknown"?(T.terra100||"#f6e3dd"):(T.gold100||"#f6eccf"),border:`1px solid ${effectiveShape==="unknown"?(T.terra200||"#eac6b8"):(T.gold300||"#e7cf91")}`,borderRadius:10,padding:"11px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div style={{fontSize:12.5,color:T.ink,lineHeight:1.5}}>
              <span style={{fontWeight:700}}>{effectiveShape==="unknown"?"We can't tell:":"We detected:"}</span> {shapeLabel(effectiveShape)}.
              {shapeDetail?.reason && <span style={{color:T.ink3}}> ({shapeDetail.reason})</span>}
            </div>
            <select value={effectiveShape} onChange={e=>setShapeOverride(e.target.value)}
              style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"}}>
              {effectiveShape==="unknown" && <option value="unknown">— choose the file's shape —</option>}
              <option value="aggregate">One row per donor (totals)</option>
              <option value="transaction">One row per gift (build history)</option>
              <option value="wide">Year columns (build history)</option>
            </select>
          </div>

          {/* BUILD-79 Part 2.2 — totals mode REFUSES a per-gift file. */}
          {aggregateCollapse?.refuse && (
            <div style={{background:T.terra100||"#f6e3dd",border:`1px solid ${T.terra200||"#eac6b8"}`,borderRadius:10,padding:"11px 14px",marginBottom:14,fontSize:12.5,color:T.terra700||"#8a3a24",lineHeight:1.6}}>
              <strong>{aggregateCollapse.collapsed.toLocaleString()} of {aggregateCollapse.keyedRows.toLocaleString()} rows collapse onto a donor already in this file.</strong>{" "}
              One row per donor would silently merge them — this file looks like one row per <em>gift</em>. Import as totals is disabled.
              <button onClick={()=>setShapeOverride("transaction")}
                style={{display:"block",marginTop:8,background:T.green600,border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                Treat as individual gifts →
              </button>
            </div>
          )}

          {/* Column mapper — aggregate/wide use the donor-field grid; transaction uses gift roles */}
          {effectiveShape === "transaction" ? (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:10}}>
                Map gift columns <span style={{fontSize:11,color:T.ink3,fontWeight:400}}>({parsed.headers.length} columns · {parsed.rows.length.toLocaleString()} rows)</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {TX_ROLES.map(([role,label]) => (
                  <div key={role} style={{display:"flex",alignItems:"center",gap:6,background:txMap[role]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${txMap[role]?T.bg3:"transparent"}`}}>
                    <span style={{fontSize:12,color:txMap[role]?T.ink:T.ink3,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
                    <select value={txMap[role]||""} onChange={e=>setTxMap(p=>({...p,[role]:e.target.value}))}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 6px",color:T.ink,fontSize:11,outline:"none",flexShrink:0,maxWidth:150}}>
                      <option value="">— none —</option>
                      {parsed.headers.map(h=><option key={h} value={h}>{h||"(blank)"}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:8}}>Rows are grouped by donor (email, else name); each row becomes one gift.</div>
              {/* BUILD-80 Part 2.2 — the date column has a convention, decided
                  at the column level and SAID here before the write. */}
              {dateConvEvidence && dateConvEvidence.slashCells > 0 && dateConvEvidence.convention === "dmy" && (
                <div style={{background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:8,padding:"8px 12px",marginTop:8,fontSize:12,color:T.ink,lineHeight:1.5}}>
                  {dateConvEvidence.slashCells.toLocaleString()} dates use <strong>day/month/year</strong>. {dateConvEvidence.dayFirstEvidence.toLocaleString()} would have been impossible the other way (e.g. {dateConvEvidence.dayFirstExamples.join(", ")}) — every slash date in this column will be read day-first.
                </div>
              )}
              {dateConvEvidence && dateConvEvidence.slashCells > 0 && (dateConvEvidence.convention === "mdy" || dateConvEvidence.convention === "default-mdy") && (
                <div style={{fontSize:11,color:T.ink3,marginTop:8}}>
                  {dateConvEvidence.convention === "mdy"
                    ? `${dateConvEvidence.slashCells.toLocaleString()} dates use month/day/year — ${dateConvEvidence.monthFirstEvidence.toLocaleString()} would have been impossible the other way.`
                    : `${dateConvEvidence.slashCells.toLocaleString()} slash dates are all ambiguous — read as US month/day/year by default.`}
                </div>
              )}
              {/* BUILD-80 Part 5 — unrecognised gift types, shown before the
                  write with count and examples. */}
              {payload?.semantics?.unrecognizedTypes?.length > 0 && (
                <div style={{background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:8,padding:"8px 12px",marginTop:8,fontSize:12,color:T.ink,lineHeight:1.5}}>
                  <strong>Gift types we don't recognise:</strong>{" "}
                  {payload.semantics.unrecognizedTypes.map(u => `“${u.type}” (${u.count}${u.examples?.[0] ? `, e.g. line ${u.examples[0].line}` : ""})`).join(" · ")}
                  {" — "}these rows import as ordinary gifts with the type kept as written.
                </div>
              )}
              {dateConvEvidence?.convention === "mixed" && (
                <div style={{background:T.gold100||"#f6eccf",border:`1px solid ${(T.gold500||"#c9a84c")}55`,borderRadius:8,padding:"10px 12px",marginTop:8,fontSize:12,color:T.ink,lineHeight:1.6}}>
                  <div style={{fontWeight:700,marginBottom:4}}>This date column mixes conventions — we won't guess.</div>
                  <div style={{color:T.ink2}}>
                    {dateConvEvidence.dayFirstEvidence.toLocaleString()} dates only work day-first (e.g. {dateConvEvidence.dayFirstExamples.join(", ")}) and {dateConvEvidence.monthFirstEvidence.toLocaleString()} only work month-first (e.g. {dateConvEvidence.monthFirstExamples.join(", ")}). Choose which to apply; impossible dates under your choice will be refused with their line numbers.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    {[["dmy","Day / Month / Year"],["mdy","Month / Day / Year"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setDateConventionChoice(v)}
                        style={{background:dateConventionChoice===v?T.green600:"transparent",border:`1px solid ${dateConventionChoice===v?T.green600:T.bg3}`,borderRadius:7,padding:"6px 12px",color:dateConventionChoice===v?"#fff":T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>
                  Map columns <span style={{fontSize:11,color:T.ink3,fontWeight:400}}>({donorHeaders.length} donor columns{effectiveShape==="wide"?` · ${yearCols.length} year columns`:""} · {parsed.rows.length.toLocaleString()} rows)</span>
                </div>
                <button onClick={doAiMap} disabled={aiLoading}
                  style={{background:aiLoading?"#14352a":(headersUnrecognized?T.bg2:T.green600),border:headersUnrecognized?`1px solid ${T.gold500||"#c9a84c"}`:"none",borderRadius:8,padding:"6px 14px",color:headersUnrecognized?(T.gold700||"#8a6d1f"):"#fff",fontSize:12,fontWeight:700,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:aiLoading?0.7:1}}>
                  {aiLoading?<><Spin/>Mapping…</>:headersUnrecognized?<>✦ Guess from contents</>:<>✦ Auto-map</>}
                </button>
              </div>
              {headersUnrecognized && (
                <div style={{background:T.gold100||"#f6eccf",border:`1px solid ${T.gold300||"#e7cf91"}`,borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12,color:T.ink,lineHeight:1.5}}>
                  Most of these column headers aren't ones Steward recognises — one-click mapping is off. “Guess from contents” reads the values instead, and every guess still has to pass its type check. Review each column before importing.
                </div>
              )}
              {/* BUILD-101 Part 6 — a membership file, and whose. */}
              {(() => {
                const mk = parsed?.headers ? detectMembershipPreset(parsed.headers) : null;
                if (!mk) return null;
                const pz = MEMBERSHIP_PRESETS[mk];
                return (
                  <div data-testid="membership-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                    <div style={{fontWeight:800,marginBottom:5}}>This file carries memberships{mk==="plain"?"":` (${pz.label})`}.</div>
                    <div style={{color:T.ink2}}>
                      Each level is matched to your own levels; a level you do not have is held and listed by line, never created.
                      These are imported as history: no payment is posted, and a date already past opens no renewal.
                      {pz.confidence==="documented-not-walked"?` Mapped from ${pz.label}'s documented export, not yet from a real file — check the columns below.`:""}
                      {pz.note?` ${pz.note}`:""}
                    </div>
                  </div>);
              })()}
              {/* BUILD-98 (switch) Part 7 — another CRM's gift export. */}
              {mig && (
                <div data-testid="migration-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                  <div style={{fontWeight:800,marginBottom:5}}>This looks like a {mig.label} gift export.</div>
                  <div style={{color:T.ink2,marginBottom:6}}>
                    The columns are mapped from {mig.label}'s documented export; check them below before you import.
                    {mig.txMap.stage?" A refunded or failed payment is set aside and listed, never counted.":""}
                  </div>
                  <details data-testid="migration-checklist">
                    <summary style={{cursor:"pointer",color:T.ink3,fontSize:12}}>Moving from {mig.label}: what to run, and what does not come across</summary>
                    <ol style={{margin:"6px 0 4px 0",paddingLeft:18,color:T.ink2}}>
                      {MIGRATION_PRESETS[mig.key].checklist.map((c,i)=><li key={i} style={{marginBottom:3}}>{c}</li>)}
                    </ol>
                    <div style={{color:T.ink2}}>Does not come across: {MIGRATION_PRESETS[mig.key].loses.join("; ")}.</div>
                  </details>
                  {mig.ignored.length>0 && (
                    <div style={{color:T.ink3,fontSize:12,marginTop:4}}>
                      Set aside: {mig.ignored.map(ig=>`${ig.header} (${ig.reason})`).join("; ")}.
                    </div>
                  )}
                </div>
              )}
              {/* BUILD-97 Part 1 — this file looks like a Salesforce NPSP export. */}
              {npspIs && (
                <div data-testid="npsp-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                  <div style={{fontWeight:800,marginBottom:5}}>
                    This looks like a Salesforce export{npsp.object===NPSP_OBJECT_OPPORTUNITY?" — the gift report":" — the contact report"}.
                  </div>
                  <div style={{marginBottom:npsp.warnings.length||npsp.ignored.length?8:0,color:T.ink2}}>
                    The columns are mapped.{" "}
                    {npsp.object===NPSP_OBJECT_OPPORTUNITY
                      ? NPSP_PRESET.cashRule
                      : "An account named like a household is a PERSON; only an organisation account becomes an organisation."}
                  </div>
                  {/* A refusal Steward understood and could not use is said out
                      loud, with both column names in it. Silence here is how
                      somebody who asked to be left alone gets emailed. */}
                  {npsp.warnings.map((w,i)=>(
                    <div key={i} data-testid="npsp-warning" style={{background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:8,padding:"7px 10px",marginBottom:6,color:T.ink}}>
                      {w.sentence}
                    </div>
                  ))}
                  {npsp.ignored.length>0 && (
                    <details data-testid="npsp-ignored">
                      <summary style={{cursor:"pointer",color:T.ink3,fontSize:12}}>
                        {npsp.ignored.length} column{npsp.ignored.length===1?"":"s"} read and set aside
                      </summary>
                      <ul style={{margin:"6px 0 0 0",paddingLeft:18,color:T.ink2}}>
                        {npsp.ignored.map(ig=>(
                          <li key={ig.header} style={{marginBottom:3}}>
                            <strong>{ig.header}</strong> — {ig.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              {/* BUILD-94 Part 2 — this file looks like a Mailchimp audience. */}
              {mcDetect.isMailchimp && (
                <div data-testid="mailchimp-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                  <div style={{fontWeight:800,marginBottom:5}}>This looks like a Mailchimp audience export.</div>
                  <div style={{marginBottom:8,color:T.ink2}}>
                    The columns are mapped. Everyone on it comes in as <strong>Other</strong> — a Mailchimp
                    contact is not a donor, and nothing they do here touches a giving total until they give.
                  </div>
                  <label style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6,cursor:"pointer"}}>
                    <input type="checkbox" data-testid="mc-unsub-file"
                      checked={mcFileStatus==="unsubscribed"}
                      onChange={e=>setMcFileStatus(e.target.checked?"unsubscribed":"subscribed")}
                      style={{accentColor:T.greenDk,marginTop:2}}/>
                    <span>
                      <strong>This is the unsubscribed file.</strong> Mailchimp exports one file per status —
                      everyone in this one comes in unreachable, and no campaign or sequence will ever mail them.
                    </span>
                  </label>
                  {mcDetect.hasTags && (
                    <label style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer"}}>
                      <input type="checkbox" data-testid="mc-tag-types" checked={mcApplyTagTypes}
                        onChange={e=>setMcApplyTagTypes(e.target.checked)}
                        style={{accentColor:T.greenDk,marginTop:2}}/>
                      <span>
                        <strong>Use the Tags column to set volunteers and board.</strong> A tag that is exactly
                        “Volunteer” or “Board” types that person; every other tag is left as a tag.
                      </span>
                    </label>
                  )}
                </div>
              )}
              {mapRefusal && (
                <div style={{background:T.terra100||"#f6e3dd",border:`1px solid ${T.terra200||"#eac6b8"}`,borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12,color:T.terra700||"#8a3a24",lineHeight:1.5}}>
                  <strong>“{mapRefusal.header}” can't map to {mapRefusal.field.replace(/^_/,"")}:</strong> {mapRefusal.summary}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {donorHeaders.map(h => (
                  <div key={h} style={{display:"flex",alignItems:"center",gap:6,background:mapping[h]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${mapping[h]?T.bg3:"transparent"}`}}>
                    <span style={{fontSize:12,color:mapping[h]?T.ink:T.ink3,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}} title={h||"(blank)"}>{h||"(blank)"}</span>
                    {/* FIX (2026-09-09) — the ONE column-target dropdown: standard
                        fields, the org's existing custom fields, and a new one
                        created right here. This screen used to show a flat list
                        of 17 internal keys and no way to make a home for a column
                        it didn't recognise. */}
                    <ColumnTargetSelect
                      testId={`donor-map-${h}`}
                      header={h} entity="donor" compact
                      standardFields={CSV_STANDARD_FIELDS}
                      cfDefs={cfDefs}
                      proposal={proposeCustomField(h, parsed.rows.map(r=>r[h]))}
                      value={mapping[h] ? `std:${mapping[h]}` : (donorCfChoices[h] ? `cf:${donorCfChoices[h].fieldId}` : "ignore")}
                      takenStd={takenDonorTargets(h)}
                      onChange={v=>{
                        if (v.startsWith("std:")) {
                          const field=v.slice(4);
                          // BUILD-79 Part 5 — a column that fails its own type
                          // check cannot be mapped to that type, by anyone.
                          const chk=validateMappingChoice(parsed.headers,parsed.rows,h,field);
                          if(!chk.ok){setMapRefusal({header:h,field,summary:chk.summary});return;}
                          setMapRefusal(null);
                          setDonorCfChoices(p=>{const n={...p};delete n[h];return n;});
                          setMapping(p=>({...p,[h]:field}));
                        } else if (v.startsWith("cf:")) {
                          const def=[...cfDefs.donor,...cfDefs.gift].find(d=>d.id===v.slice(3));
                          setMapRefusal(null);
                          setMapping(p=>{const n={...p};delete n[h];return n;});
                          if(def) setDonorCfChoices(p=>({...p,[h]:{fieldId:def.id,key:def.key,entity:def.entity,label:def.label}}));
                        } else {
                          setMapRefusal(null);
                          setMapping(p=>{const n={...p};delete n[h];return n;});
                          setDonorCfChoices(p=>{const n={...p};delete n[h];return n;});
                        }
                      }}
                      onCreateField={async d=>{
                        const created=await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({
                          entity:d.entity,label:d.label,type:d.type,options:d.options||[],
                          source:`import of ${srcFile?.name||"pasted data"}`})});
                        setCfDefs(p=>({...p,[created.entity]:[...p[created.entity],created]}));
                        setMapping(p=>{const n={...p};delete n[h];return n;});
                        setDonorCfChoices(p=>({...p,[h]:{fieldId:created.id,key:created.key,entity:created.entity,label:created.label}}));
                        return created;
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Wide: year → gift-date convention */}
              {effectiveShape === "wide" && yearCols.length > 0 && (
                <div style={{marginTop:10,background:T.bg,borderRadius:10,padding:"10px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em"}}>Gift date per year column</div>
                    <select value={yearConvention} onChange={e=>onConventionChange(e.target.value)}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:11,outline:"none"}}>
                      <option value="dec31">End of year (Dec 31)</option>
                      <option value="first">Start of year (Jan 1)</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                    {yearCols.map((yc,i)=>(
                      <span key={yc.col} onClick={()=>setYearCols(cols=>cols.map((c,j)=>j===i?{...c,enabled:!c.enabled}:c))}
                        style={{fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:99,cursor:"pointer",background:yc.enabled?T.green600+"22":"transparent",color:yc.enabled?T.green600:T.ink3,border:`1px solid ${yc.enabled?T.green600+"55":T.bg3}`}}>
                        {yc.col} {yc.enabled?`→ ${yc.date}`:"(off)"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Officer routing (Team) — owner column → teammates, or bulk options */}
          {ownerRoutingUI()}

          {/* Validation summary */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink}}>
              {donorCount>0
                ? <>{" "}<span style={{color:T.green600}}>{donorCount.toLocaleString()}</span>{" donors ready"}
                    {giftCount>0&&<>{" · "}<span style={{color:T.green600}}>{giftCount.toLocaleString()}</span>{" gifts"}</>}
                    {payload.warnedCount>0&&<>{" · "}<span style={{color:T.gold600||"#a97f22"}}>{payload.warnedCount}</span>{" with warnings"}</>}
                    {(()=>{
                      if (effectiveShape !== "transaction") return payload.skippedCount>0&&<>{" · "}<span style={{color:T.ink3}}>{payload.skippedCount.toLocaleString()}</span>{" skipped (no name, email, or organization)"}</>;
                      // BUILD-80 Part 10 — the refusal line shows DOLLARS, not
                      // only rows, before the write — and routed semantic rows
                      // (soft credits, pledges, in-kind) are not "refused".
                      const disp = payload.dispositions || [];
                      const refused = disp.filter(d=>d.disposition==="errored"||(d.disposition==="skipped"&&["no_amount","zero_amount"].includes(d.reason)));
                      const refusedDollars = refused.reduce((s2,d)=>s2+(d.dollars||0),0);
                      const routed = disp.filter(d=>d.disposition==="skipped"&&!["no_amount","zero_amount"].includes(d.reason)).length;
                      return <>
                        {refused.length>0&&<>{" · "}<span style={{color:T.terracotta}}>{refused.length.toLocaleString()}</span>{" rows will be refused ("}<span style={{color:T.terracotta}}>{"$"+refusedDollars.toLocaleString(undefined,{maximumFractionDigits:2})}</span>{"), each with its line and reason"}</>}
                        {routed>0&&<>{" · "}<span style={{color:T.ink3}}>{routed.toLocaleString()}</span>{" rows route to their own surfaces (soft credits, pledges, in-kind)"}</>}
                      </>;
                    })()}</>
                : payload.error
                  ? <span style={{color:T.terracotta}}>Steward could not read this file — {payload.error}. Nothing has been imported, and this is not a problem with your spreadsheet.</span>
                  : <span style={{color:T.ink3}}>No rows ready — map at least one column to <em>name</em>, <em>email</em>, or <em>organization</em>.</span>}
            </div>
          </div>

          {/* Smart stage assignment preview — BUILD-88a A.7: behind the Team
              flag, with the officer routing above it. A stage is a position in
              a pipeline somebody moves people through, and a Core org has no
              pipeline and no Kanban to override it in; showing the split there
              is a promise about a screen they do not have. */}
          {isTeam && Object.keys(stagePreview).length>0 && (
            <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:6}}>{stageBasis.hasGivingData ? "Smart Stage Assignment Preview" : "Starting stage"}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(stagePreview).map(([s,n])=>(
                  <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                    {s} × {n}
                  </span>
                ))}
              </div>
              {/* BUILD-84 P0-3 — the sentence is DERIVED from the declared basis
                  fields, never written by hand. A basis that cannot be read back
                  off the mapping is not claimed. */}
              <div style={{fontSize:11,color:T.ink3,marginTop:6}}>{stageBasis.sentence}{stageBasis.hasGivingData ? " Override after import by dragging in the Kanban." : ""}</div>
            </div>
          )}

          {/* Progress bar during a chunked import. BUILD-88a A.7 — it renders
              only while the import is RUNNING, and the mapper below is made
              non-interactive for the same span: "Importing 0 of 2,500…" above a
              live dropdown invites a change that can no longer reach the write. */}
          {progress && loading && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:T.ink,fontWeight:600,marginBottom:6}}>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</div>
              <div style={{height:8,background:T.bg3,borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${progress.total?Math.round(progress.done/progress.total*100):0}%`,background:T.green600,transition:"width 0.2s"}}/>
              </div>
            </div>
          )}

          {/* BUILD-78 Parts 2+4 — every column gets a decision BEFORE the
              write. Exclusion-shaped columns route to the flag family and are
              never offered as custom destinations; unmapped columns PROPOSE a
              custom field with the guess's evidence, and nothing is created
              without an explicit accept. */}
          {mapperPlan && (() => {
            const FLAG_LABEL = { deceased:"deceased", deceasedDate:"deceased date", doNotSolicit:"do-not-solicit", doNotContact:"do-not-contact", doNotMail:"do-not-mail", doNotEmail:"do-not-email" };
            const flagCols = mapperPlan.columns.filter(c=>c.status==="flag");
            const existingCols = mapperPlan.columns.filter(c=>c.status==="custom-existing");
            const proposedCols = mapperPlan.columns.filter(c=>c.status==="custom-proposed");
            const refusedCols = mapperPlan.columns.filter(c=>c.status==="refused");
            const setDecision = (idx, d) => setCfDecisions(p=>({ ...p, [idx]: d }));
            const clearDecision = idx => setCfDecisions(p=>{ const n={...p}; delete n[idx]; return n; });
            const openRoles = Object.entries(txMap).filter(([,h])=>!h).map(([role])=>role);
            if (!flagCols.length && !existingCols.length && !proposedCols.length && !refusedCols.length) return null;
            // A.7 — once the write is under way the decisions are made. The
            // mapper stops taking input rather than accepting edits that
            // silently do not apply.
            return <div aria-disabled={loading?"true":undefined} data-mapper-editable={loading?"0":"1"}
              style={{textAlign:"left",marginBottom:12,...(loading?{pointerEvents:"none",opacity:0.55}:null)}}>
              {flagCols.length>0 && (
                <div style={{background:T.gold100||"#f6eccf",border:`1px solid ${(T.gold500||"#c9a84c")}55`,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,lineHeight:1.6}}>
                  <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.gold600||"#a97f22",marginBottom:4}}>These columns set safety flags</div>
                  {flagCols.map(c=>{
                    const discarded = cfDecisions[c.index]?.action==="discard";
                    return <div key={c.index} style={{marginBottom:6}}>
                      <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>{" looks like "}<strong>{FLAG_LABEL[c.flag]||c.flag}</strong>{" state — it will set the flag, never a custom field. "}
                      {c.matchedValues?.length>0 && <span style={{color:T.ink3}}>Values we matched: {c.matchedValues.join(", ")} ({c.matchedCount} of {c.nonblankCount}).</span>}
                      <div>
                        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",color:T.ink2}}>
                          <input type="checkbox" checked={!discarded} onChange={e=>e.target.checked?clearDecision(c.index):setDecision(c.index,{action:"discard"})}/>
                          Set these flags{discarded?" (currently OFF — this column will be dropped, acknowledged)":""}
                        </label>
                      </div>
                    </div>;
                  })}
                </div>
              )}
              {(existingCols.length>0||proposedCols.length>0) && (
                <div style={{background:T.bg,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,lineHeight:1.6}}>
                  <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>
                    Columns without a standard home{cfUndecided>0?` — ${cfUndecided} still need${cfUndecided===1?"s":""} a decision`:""}
                  </div>
                  {existingCols.map(c=>{
                    const discarded = cfDecisions[c.index]?.action==="discard";
                    return <div key={c.index} style={{marginBottom:6,color:T.ink2}}>
                      <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>{" → your existing "}{c.entity}{" field "}<strong>{c.def.label}</strong>
                      {c.via==="saved-mapping"?" (remembered from your last import)":""}.{" "}
                      <button onClick={()=>discarded?clearDecision(c.index):setDecision(c.index,{action:"discard"})}
                        style={{background:"none",border:"none",padding:0,color:discarded?T.greenDk:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>
                        {discarded?"Un-discard":"Discard instead"}
                      </button>
                    </div>;
                  })}
                  {proposedCols.map(c=>{
                    const d = cfDecisions[c.index]||{};
                    const type = d.type||c.proposal.type;
                    const entity = d.entity||c.entity;
                    const label = d.label!==undefined?d.label:c.proposal.label;
                    const failed = (type===c.proposal.type?c.proposal.evidence.failed:null);
                    const decided = d.action==="accept"||d.action==="discard"||d.action==="core";
                    return <div key={c.index} data-cf-col={String(c.header).trim()} data-cf-decided={decided?"1":"0"} style={{borderTop:`1px solid ${T.bg3}`,paddingTop:8,marginTop:8}}>
                      <div style={{marginBottom:4}}>
                        <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>
                        {" → "}<strong style={{color:T.greenDk}}>{({text:"Text",long_text:"Long text",number:"Number",money:"Money",date:"Date",select:"Select",multi_select:"Multi-select",checkbox:"Yes/No"})[type]||type}</strong>
                        {" ("}{entity}{" field). "}
                        <span style={{color:T.ink3}}>{proposalEvidenceText(c.proposal.type, c.proposal.evidence)}</span>
                        {failed>0 && d.action==="accept" && <span style={{color:"#b8593f"}}>{" "}{failed.toLocaleString()} row{failed===1?"":"s"} will be refused with line numbers.</span>}
                      </div>
                      {/* FIX (2026-09-09) — the ONE column-target dropdown, on this
                          card too. The rival "…or map to a standard field" select
                          below it is gone: one control answers "what does this
                          column become?", on every screen that asks. */}
                      <div style={{marginBottom:6}}>
                        <ColumnTargetSelect
                          testId={`tx-map-${String(c.header).trim()}`}
                          header={c.header} entity={entity} compact
                          standardFields={openRoles.map(r=>({key:r,label:r}))
                            .concat(d.action==="core"&&d.role?[{key:d.role,label:d.role}]:[])
                            .filter((f,i,arr)=>arr.findIndex(x=>x.key===f.key)===i)}
                          cfDefs={cfDefs}
                          proposal={c.proposal}
                          value={d.action==="core"&&d.role?`std:${d.role}`
                            : d.action==="existing"&&d.fieldId?`cf:${d.fieldId}`
                            : d.action==="accept"?"ignore":"ignore"}
                          onChange={v=>{
                            if(v.startsWith("std:")){const role=v.slice(4);setDecision(c.index,{action:"core",role});setTxMap(m=>({...m,[role]:c.field}));}
                            else if(v.startsWith("cf:")){const def=[...cfDefs.donor,...cfDefs.gift].find(x=>x.id===v.slice(3));if(def)setDecision(c.index,{action:"existing",fieldId:def.id,entity:def.entity});}
                            else setDecision(c.index,{action:"discard"});
                          }}
                          onCreateField={async draft=>{
                            const created=await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({
                              entity:draft.entity,label:draft.label,type:draft.type,options:draft.options||[],
                              source:`import of ${srcFile?.name||"pasted data"}`})});
                            setCfDefs(p=>({...p,[created.entity]:[...p[created.entity],created]}));
                            setDecision(c.index,{action:"existing",fieldId:created.id,entity:created.entity});
                            return created;
                          }}
                        />
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        {d.action!=="accept"&&d.action!=="discard"&&(
                          <button onClick={()=>setDecision(c.index,{...d,action:"accept"})}
                            style={{background:T.green600,border:"none",borderRadius:7,padding:"4px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Store it</button>
                        )}
                        {d.action==="accept"&&<span style={{color:T.greenDk,fontWeight:700}}>Will be stored ✓</span>}
                        {d.action==="discard"&&<span style={{color:T.ink3,fontWeight:600}}>Discarded (acknowledged)</span>}
                        {/* BUILD-88a A.7 — ONE DROPDOWN PER COLUMN answers "what
                            does this column become?" (the ColumnTargetSelect
                            above). Type, entity and label are the SHAPE of a new
                            custom field, so they appear only once the answer is
                            "a new custom field" — beside a column already headed
                            for a standard field or the bin they were three more
                            controls competing with the one that decides. */}
                        {d.action==="accept"&&(<>
                        <select value={type} onChange={e=>setDecision(c.index,{...d,type:e.target.value})}
                          style={{background:T.white,border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 6px",fontSize:11,color:T.ink2}}>
                          {CF_TYPES.map(t=><option key={t} value={t}>{({text:"Text",long_text:"Long text",number:"Number",money:"Money",date:"Date",select:"Select",multi_select:"Multi-select",checkbox:"Yes/No"})[t]}</option>)}
                        </select>
                        <select value={entity} onChange={e=>setDecision(c.index,{...d,entity:e.target.value})}
                          style={{background:T.white,border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 6px",fontSize:11,color:T.ink2}}>
                          <option value="donor">on the donor</option>
                          <option value="gift">on the gift</option>
                        </select>
                        <input value={label} onChange={e=>setDecision(c.index,{...d,label:e.target.value})}
                          style={{background:T.white,border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 8px",fontSize:11,color:T.ink,width:140}}/>
                        </>)}
                        {/* the rival standard-field select lived here — see the
                            ColumnTargetSelect above, which is the one control */}
                        {d.action!=="discard"&&(
                          <button onClick={()=>setDecision(c.index,{action:"discard"})}
                            style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Discard</button>
                        )}
                        {d.action==="discard"&&(
                          <button onClick={()=>clearDecision(c.index)}
                            style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Un-discard</button>
                        )}
                      </div>
                    </div>;
                  })}
                </div>
              )}
              {refusedCols.length>0 && (
                <div style={{fontSize:11.5,color:T.ink3,marginBottom:4}}>
                  {refusedCols.map(c=><div key={c.index}>Column {c.index+1}: not importable — {c.reason}.</div>)}
                </div>
              )}
            </div>;
          })()}
          {err&&<div style={{color:"#b8593f",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setErr("");}} disabled={loading}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:loading?"not-allowed":"pointer",opacity:loading?0.5:1}}>← Back</button>
            <button onClick={doImport} disabled={loading||donorCount===0||cfUndecided>0||shapeBlocked}
              style={{flex:1,background:loading||donorCount===0||cfUndecided>0||shapeBlocked?T.bg2:T.green600,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading||donorCount===0||cfUndecided>0||shapeBlocked?"not-allowed":"pointer",opacity:loading||donorCount===0||cfUndecided>0||shapeBlocked?0.6:1}}>
              {loading?"Importing…":`Import ${donorCount.toLocaleString()} donor${donorCount!==1?"s":""}${giftCount>0?` + ${giftCount.toLocaleString()} gifts`:""} →`}
            </button>
          </div>
        </>)}
      </div>
      {upgradeInfo&&<UpgradeModal open={true} onClose={()=>{setUpgradeInfo(null);onClose();}} reason={upgradeInfo.error} current={upgradeInfo.current} limit={upgradeInfo.limit} plan={upgradeInfo.plan}/>}
    </Modal>
  );
}

// ── Gift History Import helpers ────────────────────────────────────────────
function detectGiftFormat(headers) {
  const yearCols = headers.filter(h => YEAR_HDR_PAT.test(String(h)));
  const hasDateCol = headers.some(h => /\bdate\b|\bwhen\b/i.test(String(h)));
  if (yearCols.length >= 2 && !hasDateCol) return "wide";
  const hasAmtCol = headers.some(h => /^(amount|gift|giving|donation)\b/i.test(String(h).trim()) && !/\b(19|20)\d{2}\b/.test(String(h)));
  if (hasAmtCol && hasDateCol) return "transactional";
  if (yearCols.length >= 2) return "wide";
  return "transactional";
}

function yearColToDate(header, convention) {
  // BUILD-84 census — `\b` DOES NOT FIRE AT AN UNDERSCORE (`_` is a word
  // character), so `\b(20\d{2})\b` read nothing out of `fund_2023` and
  // `fy[\s_-]?(\d{2,4})\b` read nothing out of `fy2024_total` — while
  // YEAR_HDR_PAT, which is unanchored, called both year columns. Two rules,
  // one header, opposite answers. Normalising the header to tokens first
  // (separators become spaces) makes every \b below mean what it says.
  const h = normalizeHeader(header);
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const monYear = h.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s\-]+(\d{4})/i);
  if (monYear) {
    const m = MON[monYear[1].slice(0,3).toLowerCase()];
    const y = parseInt(monYear[2]);
    if (convention === "first") return `${y}-${String(m).padStart(2,"0")}-01`;
    const last = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
  }
  const yr = h.match(/\b(20\d{2}|19\d{2})\b/);
  if (yr) return convention === "first" ? `${yr[1]}-01-01` : `${yr[1]}-12-31`;
  const fy = h.match(/fy[\s_-]?(\d{2,4})\b/i);
  if (fy) {
    let y = parseInt(fy[1]);
    if (y < 100) y = y < 50 ? 2000 + y : 1900 + y;
    return convention === "first" ? `${y}-01-01` : `${y}-12-31`;
  }
  return null;
}

function normalizeNameForDonorMatch(name) {
  if (!name) return "";
  let s = String(name).trim().toLowerCase().replace(/\s+/g, " ");
  const ci = s.indexOf(",");
  if (ci > 0) s = `${s.slice(ci+1).trim()} ${s.slice(0,ci).trim()}`;
  return s;
}

function matchDonorForGift(rawName, rawEmail, donors) {
  const em   = (rawEmail || "").toLowerCase().trim();
  const name = (rawName  || "").trim();
  if (em && em.includes("@")) {
    const m = donors.find(d => (d.email||"").toLowerCase().trim() === em);
    if (m) return { confidence:"high", suggestedDonor:m, ambiguousDonors:null };
  }
  if (name) {
    const norm  = normalizeNameForDonorMatch(name);
    const exact = donors.filter(d => normalizeNameForDonorMatch(d.name) === norm);
    if (exact.length === 1) return { confidence:"medium", suggestedDonor:exact[0],    ambiguousDonors:null };
    if (exact.length > 1)   return { confidence:"low",    suggestedDonor:null,         ambiguousDonors:exact };
    // BUILD-84 census — a partial NAME match respects token boundaries.
    // `dn.includes(norm)` matched "Ann Lee" inside "Joann Leewood" and offered
    // it as the donor for a gift; a name is a sequence of tokens, not letters.
    const partial = donors.filter(d => {
      const dn = normalizeNameForDonorMatch(d.name);
      return dn.length > 3 && eitherContainsTokenRun(dn, norm);
    });
    if (partial.length === 1) return { confidence:"low", suggestedDonor:partial[0],   ambiguousDonors:null };
    if (partial.length > 1)   return { confidence:"low", suggestedDonor:null,          ambiguousDonors:partial.slice(0,5) };
  }
  return { confidence:"unmatched", suggestedDonor:null, ambiguousDonors:null };
}

function autoDetectWideConfig(headers, rows) {
  const yearCols = headers.filter(h => YEAR_HDR_PAT.test(String(h)));
  let donorNameCol = "", donorEmailCol = "";
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    if (!donorNameCol  && /^(name|full.?name|donor.?name|donor|contact)$/.test(hl))  donorNameCol  = h;
    if (!donorEmailCol && /^(email|email.?address|e-?mail)$/.test(hl))               donorEmailCol = h;
  }
  const sample = rows.slice(0,10);
  const validYearCols = yearCols.filter(col =>
    sample.some(r => {
      const v = r[col];
      return v !== null && v !== undefined && v !== "" && !isNaN(parseFloat(String(v).replace(/[$,]/g,"")));
    })
  );
  return { yearCols: validYearCols, donorNameCol, donorEmailCol };
}

// autoDetectTxMapping moved to (now shared/importShape.js) (BUILD-77) so the golden
// fixture suite drives the REAL auto-mapping, not a copy.

// ── GiftHistoryImport ──────────────────────────────────────────────────────
function GiftHistoryImport({ donors, onClose, onImported, org = null, onOpenHome = null }) {
  const [step, setStep]             = useState("upload");
  const [csvText, setCsvText]       = useState("");
  const [srcFile, setSrcFile]       = useState(null); // the uploaded File (name/size for the file tile)
  const [xlsxSheets, setXlsxSheets] = useState(null);
  const [workbook, setWorkbook]     = useState(null); // BUILD-82 — xlsx goes through the workbook flow (gift-alone links by Donor ID)
  const [parsed, setParsed]         = useState(null);
  const [err, setErr]               = useState("");

  const [detectedFormat, setDetectedFormat] = useState("transactional");
  const [formatOverride, setFormatOverride] = useState(null);
  const effectiveFormat = formatOverride || detectedFormat;

  const [yearCols, setYearCols]             = useState([]);
  const [yearConvention, setYearConvention] = useState("dec31");
  const [wideDonorNameCol, setWideDonorNameCol]   = useState("");
  const [wideDonorEmailCol, setWideDonorEmailCol] = useState("");

  const [txMap, setTxMap] = useState({ donorName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"",externalId:"" });

  const [matchedGifts, setMatchedGifts] = useState([]);
  const [dateRefused, setDateRefused] = useState([]);   // BUILD-79 Part 4 — rows refused for unparseable dates (never dated today)
  const [overrides, setOverrides]       = useState({});
  const [pickingIdx, setPickingIdx]     = useState(null);
  const [pickSearch, setPickSearch]     = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const inp     = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setErr("");
    await parseFileToSheets(file, { onSingle:applyParsed, onMulti:s=>setXlsxSheets(s), onWorkbook:w=>{ setWorkbook(w); setParsed(null); setXlsxSheets(null); }, onError:msg=>setErr(msg) });
  };

  const doPaste = () => {
    if (!csvText.trim()) return;
    Papa.parse(csvText, {
      header:true, skipEmptyLines:true, transformHeader: h => h.trim(),
      complete: res => {
        if (!res.data?.length) { setErr("No rows found."); return; }
        applyParsed(res.meta.fields || [], res.data);
      },
      error: ex => setErr("Parse error: " + ex.message),
    });
  };

  const applyParsed = (headers, rows) => {
    const fmt = detectGiftFormat(headers);
    setDetectedFormat(fmt); setFormatOverride(null);
    setParsed({ headers, rows }); setXlsxSheets(null); setErr("");
    if (fmt === "wide") {
      const cfg = autoDetectWideConfig(headers, rows);
      setWideDonorNameCol(cfg.donorNameCol); setWideDonorEmailCol(cfg.donorEmailCol);
      setYearCols(cfg.yearCols.map(col => ({ col, date: yearColToDate(col,"dec31"), enabled:true })));
    } else {
      setTxMap(autoDetectTxMapping(headers, rows));
    }
    setStep("configure");
  };

  const onConventionChange = (val) => {
    setYearConvention(val);
    setYearCols(cols => cols.map(yc => ({ ...yc, date: yearColToDate(yc.col, val) })));
  };

  const buildPreview = () => {
    setErr("");
    const gifts = [];
    const refusedDates = [];
    if (effectiveFormat === "wide") {
      if (!wideDonorNameCol && !wideDonorEmailCol) {
        setErr("Select at least one donor identifier column (name or email)."); return;
      }
      const activeCols = yearCols.filter(yc => yc.enabled && yc.date);
      if (!activeCols.length) { setErr("Enable at least one gift year column."); return; }
      for (const row of parsed.rows) {
        const rawName  = wideDonorNameCol  ? String(row[wideDonorNameCol]  || "").trim() : "";
        const rawEmail = wideDonorEmailCol ? String(row[wideDonorEmailCol] || "").trim() : "";
        if (!rawName && !rawEmail) continue;
        for (const yc of activeCols) {
          const { value: amtVal } = normalizeMoney(row[yc.col]);
          const amt = Math.round(amtVal || 0);
          if (amt <= 0) continue;
          const match = matchDonorForGift(rawName, rawEmail, donors);
          gifts.push({ amount:amt, date:yc.date, type:"cash", campaign:"", notes:"", rawName, rawEmail, rawSource:yc.col, ...match });
        }
      }
    } else {
      if (!txMap.amount) { setErr("Map an amount column."); return; }
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        const rawName  = txMap.donorName  ? String(row[txMap.donorName]  || "").trim() : "";
        const rawEmail = txMap.donorEmail ? String(row[txMap.donorEmail] || "").trim() : "";
        if (!rawName && !rawEmail) continue;
        const { value: amtVal } = normalizeMoney(row[txMap.amount]);
        const amt = Math.round(amtVal || 0);
        if (amt <= 0) continue;
        const rawDate = txMap.date ? row[txMap.date] : null;
        const { value: parsedDate } = normalizeDate(rawDate || "");
        // BUILD-79 Part 4 — a gift whose date does not parse is REFUSED with
        // its row and reason, never stamped with today (the || today here was
        // the last write-path survivor of the BUILD-77 sweep).
        if (!parsedDate) { refusedDates.push({ row: i + 2, rawDate: String(rawDate ?? ""), rawName, rawEmail, amount: amt }); continue; }
        const match = matchDonorForGift(rawName, rawEmail, donors);
        gifts.push({
          amount:amt, date:parsedDate,
          type:     txMap.type     ? (String(row[txMap.type]    ||"").toLowerCase() || "cash") : "cash",
          campaign: txMap.campaign ? String(row[txMap.campaign] ||"") : "",
          notes:    txMap.notes    ? String(row[txMap.notes]    ||"") : "",
          externalId: txMap.externalId ? (String(row[txMap.externalId]||"").trim() || undefined) : undefined,
          rawName, rawEmail, rawSource:`row ${i+2}`, ...match,
        });
      }
    }
    setDateRefused(refusedDates);
    if (!gifts.length) { setErr(refusedDates.length ? `All ${refusedDates.length} gift rows had unparseable dates — nothing was stamped with today. Fix the date column and re-upload.` : "No valid gift rows found. Check your column mapping."); return; }
    setMatchedGifts(gifts); setOverrides({}); setPickingIdx(null);
    setStep("preview");
  };

  const stats = useMemo(() => {
    let high=0, medium=0, low=0, lowPending=0, unmatched=0, toImportCount=0;
    const donorSet = new Set();
    for (let i = 0; i < matchedGifts.length; i++) {
      const g = matchedGifts[i];
      const ov = overrides[i];
      let willImport = false;
      if      (g.confidence === "high")      { high++;    willImport = ov?.action !== "skip"; }
      else if (g.confidence === "medium")    { medium++;  willImport = ov?.action !== "skip"; }
      else if (g.confidence === "low")       { low++;     if (!ov) lowPending++; else willImport = ov.action !== "skip"; }
      else                                   { unmatched++; }
      if (willImport) {
        const did = ov?.donorId || g.suggestedDonor?.id;
        if (did) { toImportCount++; donorSet.add(did); }
      }
    }
    return { high, medium, low, lowPending, unmatched, toImportCount, donorCount: donorSet.size };
  }, [matchedGifts, overrides]);

  const skipAllPending = () => {
    const newOv = { ...overrides };
    matchedGifts.forEach((g,i) => { if (g.confidence === "low" && !newOv[i]) newOv[i] = { action:"skip" }; });
    setOverrides(newOv);
  };

  const doImport = async () => {
    const toSend = matchedGifts.map((g,i) => {
      const ov = overrides[i];
      if (ov?.action === "skip")              return null;
      if (g.confidence === "unmatched")       return null;
      if (g.confidence === "low" && !ov)      return null;
      const donorId = ov?.donorId || g.suggestedDonor?.id;
      if (!donorId)                           return null;
      return { donorId, amount:g.amount, date:g.date, type:g.type, campaign:g.campaign, notes:g.notes, externalId:g.externalId };
    }).filter(Boolean);
    if (!toSend.length) { setErr("No gifts to import."); return; }
    setLoading(true); setErr("");
    try {
      const res = await apiFetch("/gifts/import-history", { method:"POST", body:JSON.stringify({ gifts:toSend }) });
      setResult(res); setStep("result");
    } catch(e) { setErr(errorMessage(e, "Import failed.")); }
    setLoading(false);
  };

  // §1.2 F-4 — the human decided: import the rows held as possible duplicates.
  const importHeld = async () => {
    if (!result || !Array.isArray(result.heldForReview) || !result.heldForReview.length) return;
    setLoading(true);
    try {
      const res = await apiFetch("/gifts/import-history", { method:"POST",
        body:JSON.stringify({ includeDuplicates:true, gifts:result.heldForReview }) });
      setResult(r => ({ ...r, inserted:(r.inserted||0)+(res.inserted||0), heldForReview:[] }));
    } catch(e) { setErr(errorMessage(e, "Import failed.")); }
    setLoading(false);
  };

  if (step === "result" && result) {
    return (
      <Modal onClose={onClose} width={720} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
        padding={28} ariaLabel={"Import result"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12}}>✓</div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>
            Import complete.
          </div>
          <div style={{fontSize:14,color:T.ink3,marginBottom:16,lineHeight:1.8}}>
            <strong style={{color:T.ink}}>{result.inserted}</strong> gifts imported across{" "}
            <strong style={{color:T.ink}}>{result.donorsUpdated}</strong> donors
            {result.externalIdDupes > 0 && <> · <strong>{result.externalIdDupes}</strong> already imported (matched by transaction ID)</>}
          </div>
          {Array.isArray(result.heldForReview) && result.heldForReview.length > 0 && (
            <div style={{fontSize:13,color:T.ink,background:T.gold100,border:"1px solid "+T.gold300,borderRadius:10,padding:"12px 16px",marginBottom:16,textAlign:"left",lineHeight:1.6}}>
              <strong>{result.heldForReview.length}</strong> row{result.heldForReview.length===1?"":"s"} matched a gift already on file
              (same donor, amount, and date) and {result.heldForReview.length===1?"was":"were"} held for your review — nothing was
              silently dropped. If these are genuinely separate gifts (e.g. two identical checks the same day), import them.
              <div style={{marginTop:10}}>
                <button disabled={loading} onClick={importHeld}
                  style={{background:T.gold500,border:"none",borderRadius:8,padding:"8px 16px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {loading?"Importing…":`Import ${result.heldForReview.length} held row${result.heldForReview.length===1?"":"s"}`}
                </button>
              </div>
            </div>
          )}
          {result.duplicateCandidates && result.duplicateCandidates.withinFile > 0 && (
            <div style={{fontSize:12,color:T.ink3,marginBottom:12}}>
              {result.duplicateCandidates.withinFile} same-day/same-amount twin{result.duplicateCandidates.withinFile===1?" was":"s were"} imported
              from within this file (they are treated as real, separate gifts — map a Gift/Transaction ID column for exact dedup).
            </div>
          )}
          <div style={{fontSize:12,color:T.ink3,marginBottom:28}}>Donor giving totals have been recalculated from the gifts table.</div>
          <button onClick={onImported} style={{background:"#0d5c3a",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} width={720} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel={"Import gift history"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Giving History</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>Attach historical gifts to existing donors · CSV, TSV, or Excel</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {/* The uploaded file as a tile — still a drop target for a replacement */}
        {srcFile && (parsed || xlsxSheets || workbook) && (
          <div style={{marginBottom:16}}>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Replace file"
              fileMeta={srcFile ? {
                name: srcFile.name, size: srcFile.size,
                detail: parsed ? `${parsed.rows.length.toLocaleString()} rows · ${effectiveFormat === "wide" ? "wide year columns" : "transaction ledger"}`
                  : workbook ? `${workbook.roled.length} sheets · one import`
                  : `${(xlsxSheets || []).length} sheets`,
              } : null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}
              onRemove={()=>{setSrcFile(null);setParsed(null);setXlsxSheets(null);setWorkbook(null);setStep("upload");setErr("");}}/>
          </div>
        )}

        {/* BUILD-82: xlsx routes through the workbook flow — a gift sheet with
            only an ID column links to existing donors by Donor ID */}
        {workbook && (
          <WorkbookImport workbook={workbook} fileName={srcFile?.name}
            vocabulary={org?.vocabulary} onOpenHome={onOpenHome}
            onClose={()=>{setWorkbook(null);setSrcFile(null);setErr("");}}
            onImported={onImported} />
        )}

        {/* Upload */}
        {step === "upload" && !xlsxSheets && !workbook && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload file</div>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Drop your spreadsheet here, or browse"
              fileMeta={null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>Wide format (one row/donor, year columns) or transactional (one row/gift) — auto-detected.</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={5}
            placeholder={"Donor,Email,2021 Gift,2022 Gift,2023 Gift\nJane Smith,jane@example.com,500,750,1000"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:"#b8593f",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doPaste} disabled={!csvText.trim()}
            style={{background:csvText.trim()?T.gold500:T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:csvText.trim()?T.ink:T.ink3,fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse →
          </button>
        </>)}

        {/* Sheet picker */}
        {step === "upload" && xlsxSheets && (<>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>This workbook has {xlsxSheets.length} sheets with data.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:16}}>Pick the sheet to import.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {xlsxSheets.map((s,i)=>(
              <div key={s.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 16px"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{s.rowCount.toLocaleString()} rows · {s.headers.filter(Boolean).length} columns</div>
                </div>
                <button onClick={()=>applyParsed(s.headers,s.rows,s.physical,s.report)}
                  style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {i===0?"Use this ←":"Select"}
                </button>
              </div>
            ))}
          </div>
          <button onClick={()=>setXlsxSheets(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
        </>)}

        {/* Configure */}
        {step === "configure" && parsed && (<>

          {/* Format toggle */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:T.ink}}>
                Detected: <span style={{color:effectiveFormat==="wide"?T.gold600:T.green600}}>
                  {effectiveFormat==="wide"?"Wide format (one row/donor, year columns)":"Transactional format (one row/gift)"}
                </span>
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{parsed.rows.length.toLocaleString()} rows · {parsed.headers.length} columns</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {["wide","transactional"].map(f=>(
                <button key={f} onClick={()=>setFormatOverride(effectiveFormat===f?null:f)}
                  style={{background:effectiveFormat===f?T.bg2:"transparent",border:`1px solid ${effectiveFormat===f?T.greenDk:T.bg3}`,borderRadius:7,padding:"5px 12px",color:effectiveFormat===f?T.greenDk:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                  {f==="wide"?"Wide":"Transactional"}
                  {f===detectedFormat&&<span style={{fontSize:10,color:T.ink3,marginLeft:4,fontWeight:400}}>(auto)</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Wide config */}
          {effectiveFormat === "wide" && (<>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Year Date Convention</div>
              <div style={{display:"flex",gap:8}}>
                {[["dec31","Dec 31 (end of year)"],["first","Jan 1 (start of year)"]].map(([v,l])=>(
                  <button key={v} onClick={()=>onConventionChange(v)}
                    style={{flex:1,background:yearConvention===v?T.bg2:"transparent",border:`1px solid ${yearConvention===v?T.greenDk:T.bg3}`,borderRadius:8,padding:"8px 12px",color:yearConvention===v?T.greenDk:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left"}}>
                    {l}
                    {v==="dec31"&&<span style={{fontSize:10,color:T.ink3,display:"block",fontWeight:400,marginTop:1}}>Default — treats each gift as end-of-year</span>}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[["Donor Name Column",wideDonorNameCol,setWideDonorNameCol],["Donor Email Column",wideDonorEmailCol,setWideDonorEmailCol]].map(([label,val,setter])=>(
                <div key={label}>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>{label}</div>
                  <select value={val} onChange={e=>setter(e.target.value)} style={{...inp,cursor:"pointer"}}>
                    <option value="">— not in file —</option>
                    {parsed.headers.filter(h=>!YEAR_HDR_PAT.test(h)).map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
                Gift Year Columns — {yearCols.filter(yc=>yc.enabled).length}/{yearCols.length} enabled
              </div>
              {yearCols.length===0&&(
                <div style={{color:"#a97f22",fontSize:13,background:"#f6eccf",borderRadius:8,padding:"10px 12px"}}>
                  No year-like columns detected. Switch to Transactional format.
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {yearCols.map((yc,i)=>(
                  <div key={yc.col} style={{display:"flex",alignItems:"center",gap:10,background:yc.enabled?T.bg:"transparent",border:`1px solid ${yc.enabled?T.bg3:"transparent"}`,borderRadius:8,padding:"8px 10px"}}>
                    <input type="checkbox" checked={yc.enabled} onChange={e=>setYearCols(c=>c.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x))} style={{cursor:"pointer"}}/>
                    <span style={{flex:1,fontSize:13,color:yc.enabled?T.ink:T.ink3}}>{yc.col}</span>
                    <span style={{fontSize:12,color:T.ink3}}>→</span>
                    <input type="date" value={yc.date||""} onChange={e=>setYearCols(c=>c.map((x,j)=>j===i?{...x,date:e.target.value}:x))}
                      style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                  </div>
                ))}
              </div>
            </div>
          </>)}

          {/* Transactional config */}
          {effectiveFormat === "transactional" && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Map Columns</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Donor Name","donorName","for matching"],
                  ["Donor Email","donorEmail","email match = highest confidence"],
                  ["Amount *","amount","required"],
                  ["Gift Date","date","ISO, M/D/YYYY, Excel serial"],
                  ["Gift Type","type","cash, check, online…"],
                  ["Campaign / Fund","campaign",""],
                  ["Notes","notes",""],
                  ["Gift / Transaction ID","externalId","dedupes re-imports safely"],
                ].map(([label,key,hint])=>(
                  <div key={key}>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>
                      {label}{hint&&<span style={{fontSize:10,fontWeight:400,marginLeft:4,textTransform:"none",color:T.ink3}}>· {hint}</span>}
                    </div>
                    <select value={txMap[key]||""} onChange={e=>setTxMap(m=>({...m,[key]:e.target.value}))}
                      style={{...inp,cursor:"pointer",fontSize:12}}>
                      <option value="">— skip —</option>
                      {parsed.headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err&&<div style={{color:"#b8593f",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setParsed(null);setStep("upload");setErr("");}}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={buildPreview}
              style={{flex:1,background:T.gold500,border:"none",borderRadius:10,padding:"11px 20px",color:T.ink,fontSize:14,fontWeight:700,cursor:"pointer"}}>
              Match Donors & Preview →
            </button>
          </div>
        </>)}

        {/* Preview */}
        {step === "preview" && (<>

          {/* BUILD-79 Part 4 — refused dates are named, never today-stamped */}
          {dateRefused.length > 0 && (
            <div style={{background:T.terra100||"#f6e3dd",border:`1px solid ${T.terra200||"#eac6b8"}`,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12.5,color:T.terra700||"#8a3a24",lineHeight:1.6}}>
              <strong>{dateRefused.length} gift row{dateRefused.length===1?"":"s"} refused — the gift date could not be read.</strong>{" "}
              Nothing is ever stamped with today's date. Examples:{" "}
              {dateRefused.slice(0,3).map(r=>`row ${r.row} (“${r.rawDate||"blank"}”)`).join(" · ")}{dateRefused.length>3?" · …":""}
            </div>
          )}

          {/* Summary card */}
          <div style={{background:T.bg,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:8}}>
              <span style={{color:"#0d5c3a"}}>{stats.toImportCount}</span> gifts ready to import, attaching to{" "}
              <span style={{color:T.ink}}>{stats.donorCount}</span> donors
              {stats.lowPending>0&&<> · <span style={{color:"#a97f22"}}>{stats.lowPending} need review</span></>}
              {stats.unmatched>0&&<> · <span style={{color:T.ink3}}>{stats.unmatched} unmatched (will skip)</span></>}
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[[stats.high,T.greenMid,"high confidence (email)"],[stats.medium,T.green500,"medium (name match)"],[stats.low,T.gold600,"low (review)"],[stats.unmatched,T.ink3,"unmatched"]].filter(([n])=>n>0).map(([n,color,label])=>(
                <span key={label} style={{fontSize:12}}><span style={{color,fontWeight:700}}>{n}</span> <span style={{color:T.ink3}}>{label}</span></span>
              ))}
            </div>
          </div>

          {/* Low confidence review list */}
          {stats.low > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:"#8a6d1f",textTransform:"uppercase",letterSpacing:"0.08em"}}>
                  Low Confidence — {stats.lowPending} pending review
                </div>
                {stats.lowPending>0&&(
                  <button onClick={skipAllPending} style={{fontSize:11,color:T.ink3,background:"none",border:"1px solid "+T.bg3,borderRadius:6,padding:"3px 10px",cursor:"pointer"}}>
                    Skip all {stats.lowPending}
                  </button>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto",paddingRight:2}}>
                {matchedGifts.map((g,i)=>{
                  if (g.confidence !== "low") return null;
                  const ov = overrides[i];
                  return (
                    <div key={i} style={{background:ov?.action==="skip"?T.bg:"#fdfaf2",border:`1px solid ${ov?.action==="skip"?T.bg3:"#e7cf91"}`,borderRadius:10,padding:"10px 12px",opacity:ov?.action==="skip"?0.55:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:700,color:T.ink}}>${g.amount.toLocaleString()}</span>
                        <span style={{fontSize:12,color:T.ink3}}>{g.date}</span>
                        <span style={{fontSize:12,color:T.ink}}>· {g.rawName||g.rawEmail}</span>
                        <span style={{fontSize:11,color:T.ink3}}>({g.rawSource})</span>
                      </div>
                      {!ov&&g.ambiguousDonors&&(
                        <div style={{marginBottom:6}}>
                          <div style={{fontSize:11,color:"#8a6d1f",marginBottom:4}}>Multiple donors with this name — select one:</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {g.ambiguousDonors.map(d=>(
                              <button key={d.id} onClick={()=>setOverrides(p=>({...p,[i]:{action:"pick",donorId:d.id,donorName:d.name}}))}
                                style={{fontSize:11,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 10px",cursor:"pointer",color:T.ink}}>
                                {d.name}{d.email?` (${d.email})`:""}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!ov&&g.suggestedDonor&&!g.ambiguousDonors&&(
                        <div style={{fontSize:12,color:T.ink3,marginBottom:5}}>
                          Suggested: <strong style={{color:T.ink}}>{g.suggestedDonor.name}</strong>
                          {g.suggestedDonor.email&&<span> ({g.suggestedDonor.email})</span>}
                          <span style={{color:"#a97f22",marginLeft:4}}>— partial match</span>
                        </div>
                      )}
                      {(ov?.action==="confirm"||ov?.action==="pick")&&(
                        <div style={{fontSize:12,color:"#0d5c3a",marginBottom:5}}>✓ Will attach to: <strong>{ov.donorName}</strong></div>
                      )}
                      {ov?.action==="skip"&&(
                        <div style={{fontSize:12,color:T.ink3,marginBottom:5}}>✗ Skipped</div>
                      )}
                      {pickingIdx===i&&(
                        <div style={{marginBottom:8}}>
                          <input value={pickSearch} onChange={e=>setPickSearch(e.target.value)}
                            placeholder="Search donors by name or email…" autoFocus
                            style={{...inp,marginBottom:5,fontSize:12}}/>
                          {pickSearch.length>=2&&(
                            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,maxHeight:160,overflowY:"auto"}}>
                              {(()=>{
                                const q = pickSearch.toLowerCase();
                                const hits = donors.filter(d=>d.name.toLowerCase().includes(q)||(d.email||"").toLowerCase().includes(q)).slice(0,8);
                                return hits.length ? hits.map(d=>(
                                  <div key={d.id} onClick={()=>{setOverrides(p=>({...p,[i]:{action:"pick",donorId:d.id,donorName:d.name}}));setPickingIdx(null);setPickSearch("");}}
                                    style={{padding:"7px 12px",cursor:"pointer",fontSize:12,color:T.ink,borderBottom:"1px solid "+T.bg2}}>
                                    <strong>{d.name}</strong>{d.email?` — ${d.email}`:""}
                                  </div>
                                )) : <div style={{padding:"10px 12px",fontSize:12,color:T.ink3}}>No donors found</div>;
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {!ov&&g.suggestedDonor&&(
                          <button onClick={()=>setOverrides(p=>({...p,[i]:{action:"confirm",donorId:g.suggestedDonor.id,donorName:g.suggestedDonor.name}}))}
                            style={{background:"#0d5c3a",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                            ✓ Confirm
                          </button>
                        )}
                        {!ov&&(
                          <button onClick={()=>{setPickingIdx(pickingIdx===i?null:i);setPickSearch("");}}
                            style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink,fontSize:12,cursor:"pointer"}}>
                            {pickingIdx===i?"Cancel":"Pick donor →"}
                          </button>
                        )}
                        {!ov&&(
                          <button onClick={()=>{setOverrides(p=>({...p,[i]:{action:"skip"}}));setPickingIdx(null);}}
                            style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>
                            Skip
                          </button>
                        )}
                        {ov&&(
                          <button onClick={()=>{setOverrides(p=>{const n={...p};delete n[i];return n;});setPickingIdx(null);}}
                            style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:6,padding:"3px 8px",color:T.ink3,fontSize:11,cursor:"pointer"}}>
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unmatched */}
          {stats.unmatched > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>
                ✗ {stats.unmatched} Unmatched — Will Be Skipped
              </div>
              <div style={{fontSize:11,color:T.ink3,marginBottom:6}}>
                These donors don't exist yet — import them first via donor import, or use combined mode later.
              </div>
              <div style={{background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:8,padding:"8px 12px"}}>
                {matchedGifts.filter(g=>g.confidence==="unmatched").slice(0,8).map((g,i)=>(
                  <div key={i} style={{fontSize:12,color:"#8a3a24",padding:"2px 0"}}>
                    · {g.rawName||g.rawEmail} — ${g.amount.toLocaleString()} on {g.date}
                  </div>
                ))}
                {stats.unmatched>8&&<div style={{fontSize:12,color:"#8a3a24",marginTop:4}}>…and {stats.unmatched-8} more</div>}
              </div>
            </div>
          )}

          {err&&<div style={{color:"#b8593f",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={()=>setStep("configure")}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading||stats.toImportCount===0}
              style={{flex:1,background:loading||stats.toImportCount===0?T.bg2:T.gold500,border:"none",borderRadius:10,padding:"11px 20px",color:loading||stats.toImportCount===0?T.ink3:T.ink,fontSize:14,fontWeight:700,cursor:loading||stats.toImportCount===0?"not-allowed":"pointer",opacity:loading||stats.toImportCount===0?0.6:1}}>
              {loading?"Importing…":`Import ${stats.toImportCount} Gifts →`}
            </button>
          </div>
          {stats.lowPending>0&&<div style={{fontSize:11,color:T.ink3,marginTop:8,textAlign:"center"}}>{stats.lowPending} low-confidence gifts need review before they'll be included in the import.</div>}
        </>)}

      </div>
    </Modal>
  );
}

// ── Merge duplicates (BUILD-08 Phase C) ────────────────────────────────────
// Staff-level data-hygiene tool: GET /donors/duplicates lists candidate
// groups (same email; same/near name), the officer picks which record to
// keep, and POST /donors/merge folds each other record into it — children
// reassigned, blanks filled, secondary soft-deleted with a merge note.
function MergeDuplicatesModal({onClose,onMerged,isReadOnly}){
  const[groups,setGroups]=useState(null); // null = loading
  const[open,setOpen]=useState(null);     // group index expanded
  const[primaryId,setPrimaryId]=useState(null);
  const[busy,setBusy]=useState(false);
  const[done,setDone]=useState("");
  const[err,setErr]=useState("");

  const load=()=>{
    setGroups(null);setOpen(null);setPrimaryId(null);setErr("");
    apiFetch("/donors/duplicates").then(r=>setGroups(r.groups||[])).catch(e=>{setGroups([]);setErr(errorMessage(e, "Could not check for duplicates."));});
  };
  useEffect(load,[]);

  async function doMerge(group){
    if(!primaryId||busy)return;
    const others=group.donors.filter(d=>d.id!==primaryId);
    const keep=group.donors.find(d=>d.id===primaryId);
    if(!window.confirm(`Merge ${others.length} record${others.length!==1?"s":""} into "${keep.name}"? Their gifts, notes, and history move to the kept record; the duplicate${others.length!==1?"s go":" goes"} to trash.`))return;
    setBusy(true);setErr("");
    try{
      for(const o of others){
        await apiFetch("/donors/merge",{method:"POST",body:JSON.stringify({primaryId,secondaryId:o.id})});
      }
      setDone(`Merged ${others.length} duplicate${others.length!==1?"s":""} into ${keep.name}.`);
      onMerged();
      load();
    }catch(e){setErr(errorMessage(e, "Merge failed."));}
    setBusy(false);
  }

  const fmtMoney=n=>"$"+(parseFloat(n)||0).toLocaleString();
  const ROWS=[
    ["Email",d=>d.email||"—"],["Phone",d=>d.phone||"—"],
    ["Total giving",d=>fmtMoney(d.total_giving)],["Gifts",d=>d.gift_count||0],
    ["Last gift",d=>d.last_gift_date||"—"],["Stage",d=>d.stage||"—"],
    ["Location",d=>[d.city,d.state].filter(Boolean).join(", ")||"—"],
    ["Added",d=>(d.created_at||"").split("T")[0]||"—"],
  ];

  return(
    <Modal onClose={onClose} width={760} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel={"Merge duplicates"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Merge Duplicates</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>Same email, or names close enough to be the same person — pick the record to keep.</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {done&&<div style={{background:"#edf3ee",border:"1px solid #dce7df",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#0d5c3a",fontWeight:600,margin:"10px 0"}}>✓ {done}</div>}
        {err&&<div style={{background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#8a3a24",margin:"10px 0"}}>{err}</div>}

        {groups===null&&<div style={{display:"flex",alignItems:"center",gap:8,color:T.ink3,fontSize:13,padding:"24px 0"}}><Spin/>Checking your donor list…</div>}

        {groups&&groups.length===0&&!err&&(
          <div style={{textAlign:"center",padding:"36px 0",color:T.ink3}}>
            <div style={{fontSize:26,marginBottom:10,opacity:0.35}}>✓</div>
            <div style={{fontSize:14,fontWeight:600,color:T.ink2,marginBottom:4}}>Your donor list looks clean.</div>
            <div style={{fontSize:13}}>No shared emails, no near-identical names — nothing that needs merging today.</div>
          </div>
        )}

        {groups&&groups.map((g,gi)=>{
          const isOpen=open===gi;
          return(
            <div key={gi} style={{border:"1px solid "+T.bg3,borderRadius:12,marginTop:12,overflow:"hidden"}}>
              <button onClick={()=>{setOpen(isOpen?null:gi);setPrimaryId(null);}}
                style={{width:"100%",background:isOpen?T.bg:T.white,border:"none",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10}}>
                <span style={{fontSize:13,fontWeight:700,color:T.ink,textAlign:"left"}}>
                  <span style={{display:"inline-block",background:g.tier==="email"?T.greenDk:T.gold,color:g.tier==="email"?"#fff":T.ink,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:800,marginRight:8,verticalAlign:"middle"}}>{g.tier==="email"?"SAME EMAIL":"SIMILAR NAME"}</span>
                  {g.donors.map(d=>d.name).join("  ·  ")}
                </span>
                <span style={{fontSize:12,color:T.ink3,flexShrink:0}}>{isOpen?"▲":"▼"}</span>
              </button>
              {isOpen&&(
                <div style={{padding:"14px 16px",borderTop:"1px solid "+T.bg3}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead><tr>
                        <td style={{padding:"6px 10px"}}/>
                        {g.donors.map(d=>(
                          <td key={d.id} style={{padding:"6px 10px",verticalAlign:"top"}}>
                            <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontWeight:800,color:T.ink,whiteSpace:"nowrap"}}>
                              <input type="radio" name={"mergeprimary"+gi} checked={primaryId===d.id} onChange={()=>setPrimaryId(d.id)} style={{accentColor:T.greenDk}}/>
                              {d.name}
                            </label>
                            <div style={{fontSize:10,color:T.ink3,marginLeft:22,marginTop:1}}>{primaryId===d.id?"keeping this record":"keep this one?"}</div>
                          </td>
                        ))}
                      </tr></thead>
                      <tbody>
                        {ROWS.map(([label,fn])=>(
                          <tr key={label} style={{borderTop:"1px solid "+T.bg2}}>
                            <td style={{padding:"6px 10px",color:T.ink3,fontWeight:600,whiteSpace:"nowrap"}}>{label}</td>
                            {g.donors.map(d=>{
                              const v=fn(d);
                              return <td key={d.id} style={{padding:"6px 10px",color:T.ink2}}>{v}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10,marginTop:12}}>
                    <span style={{fontSize:12,color:T.ink3}}>Nothing is lost — gifts, notes, and history all move to the kept record.</span>
                    <button onClick={()=>doMerge(g)} disabled={!primaryId||busy||isReadOnly}
                      title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:(!primaryId||busy||isReadOnly)?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"9px 18px",color:(!primaryId||busy||isReadOnly)?T.ink3:"#fff",fontSize:13,fontWeight:700,cursor:(!primaryId||busy||isReadOnly)?"not-allowed":"pointer"}}>
                      {busy?"Merging…":"Merge into kept record"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export { GiftHistoryImport, MergeDuplicatesModal, parseFileToSheets };
