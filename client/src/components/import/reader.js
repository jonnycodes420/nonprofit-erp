import { extractWorkbookFromSheetJS, analyzeWorkbookSheet, classifyWorkbookSheets, decodeSpreadsheetBytesDetailed, analyzeCsvText } from "../../../../shared/importShape";
import { wantsAdaptiveReading, gridsFromWorkbook, gridFromText } from "../../../../shared/sheetRead";
import { isProgrammerError, errorMessage } from "../../lib/domainError";

// cp1252RowNames(report, parsed) — which donors' NAMES the per-line encoding
// repair touched: map each repaired physical line onto the body row that spans
// it (rowLines is each row's starting line), then pull the best name cell.
export function cp1252RowNames(report, parsed) {
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
export const IMPORT_REASON_LABELS = {
  already_in_steward: "already in Steward before this import",
  already_on_file: "already in Steward before this import", // legacy key from older servers
  duplicate_within_this_import: "duplicate rows within this file (collapsed)",
  // BUILD-80 Part 5 — rows that are not gifts, routed to their own surfaces
  soft_credit: "soft credits, a link to the real gift, never money",
  pledge_commitment: "pledge commitments, on the record, never in totals",
  pledge_scheduled: "future pledge installments, the schedule, not failed rows",
  in_kind: "in-kind gifts, recorded at fair market value, never cash",
  positive_reversal: "reversals with a POSITIVE amount, a human must decide",
  unrecognized_exclusion_value: "unrecognised value in an exclusion column",
  // BUILD-84 P0-2 — the set-aside vocabulary, matching NAMEABILITY_REASON so
  // the receipt, the pre-write line and the downloadable file all say the
  // same sentence (the promise-field rule).
  no_donor_identity: "no name, email, or organization",
};

// The slice of an analyzeSheetRows result the importers carry as the parse
// report (chrome banner, record count, the file's own TOTAL row for Part 3.2).
export function reportFromAnalysis(a) {
  return { records: a.records, rowLines: a.rowLines, chromeAbove: a.chromeAbove,
           chromeRows: a.chromeRows, totalRow: a.totalRow, headerLine: a.headerLine };
}

// ── Shared file-parsing helper ────────────────────────────────────────────
// Replaces the identical ~45-line xlsx/CSV block duplicated in each importer.
// IMPORT-3: `onAdaptive(file)`: a file the column mapper would dead-end on
// (no date column, a paid or pledge column, several tables, an unclear sheet)
// is handed to the reader that adapts to any spreadsheet instead.
// `preferAdaptive` sends every file there (an org with nobody to attach to).
export async function parseFileToSheets(file, { onSingle, onMulti, onWorkbook, onError, onAdaptive, preferAdaptive = false }) {
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
      if (onAdaptive && (preferAdaptive || wantsAdaptiveReading(gridsFromWorkbook(XLSX.read(new Uint8Array(buf), { type:"array", cellDates:true }), XLSX), roled))) { onAdaptive(file); return; }
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
      if (onAdaptive && (preferAdaptive || wantsAdaptiveReading([{ name:"Sheet1", grid:gridFromText(dec.text) }]))) { onAdaptive(file); return; }
      const analysis = analyzeCsvText(dec.text);
      if (!analysis.rows.length) { onError("No rows found."); return; }
      onSingle(analysis.headers, analysis.rows, analysis.physical, { ...reportFromAnalysis(analysis), cp1252Lines: dec.cp1252Lines, mojibakeRepaired: dec.mojibakeRepaired || 0, mojibakeRepairs: dec.mojibakeRepairs || [] });
    } catch (ex) { onError(isProgrammerError(ex) ? errorMessage(ex) : "Could not read file: " + ex.message); }
  }
}
