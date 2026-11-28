// shared/sheetReadRoute.js · WHICH SCREEN READS A FILE: the one reader (shared/sheetRead.js) or the
// workbook screen (WorkbookImport.jsx). Moved verbatim from sheetRead.js by IMPORT-13, which needed the room
// there under the size ratchet; sheetRead.js re-exports both, so every caller is unchanged.
// ESM cycle with sheetRead.js on purpose: call-time bindings only (shared/package.json is type module).
import { understand, ENGAGE_ROLES, COMMS_ROLES, ROLE_FLAG_ROLES } from "./sheetRead.js";

// When the file should be read by this reader rather than the column mapper:
// whenever the mapper would dead-end ("shape unclear", "0 donors + 0 gift
// rows") or misread it. A file with no date column, a paid/pledge/frequency
// column, more than one table on a sheet, or nothing it recognises.
export function wantsAdaptiveReading(sheets, roled = null) {
  if (roled && roled.some(s => s.role === "unknown")) return true;
  if (roled && !roled.some(s => ["donors", "gifts", "pledges", "recurring"].includes(s.role))) return true;
  // IMPORT-4: a file that knows who came, who volunteers or who said don't
  // email me, or whose gifts have no date, is read in layers here. The column
  // mapper would set those gifts aside and leave those columns out (26 Oct:
  // "Import 443 donors + 0 gifts" for an event workbook with 106 gifts).
  const u0 = understand({ sheets });
  const LAYER_ROLES = new Set([...ENGAGE_ROLES, ...COMMS_ROLES, ...ROLE_FLAG_ROLES]);
  if (u0.tables.some(tb => tb.isVolunteer || tb.columns.some(c => LAYER_ROLES.has(c.role)))) return true;
  if (u0.counts.undatedGifts > 0) return true;
  if (u0.tables.some(tb => tb.linkedById)) return true;   // IMPORT-11: gifts joined to people by ID, no name on them
  // a workbook the workbook flow already reads (a donors sheet and a gifts
  // sheet, every sheet with a role) stays there
  if (roled && roled.filter(s => s.rowCount > 0 && s.role !== "chrome").length > 1) return false;
  const u = u0;
  if (u.fileKind === "unknown") return true;
  // No date column: an event night's sheet, unless the file is one row per
  // donor with running totals (Total Giving, Last Gift, year columns), which
  // the column mapper reads as an aggregate file.
  const AGG_HDR = /total|lifetime|last gift|ytd|cumulative|\b(19|20)\d\d\b|first gift|largest/i;
  const aggregate = u.tables.some(tb => tb.columns.some(c => c.role !== "pledgeTotal" && AGG_HDR.test(String(c.header || ""))));
  if (u.fileKind === "gifts" && u.needsDate && !aggregate) return true;
  const perSheet = new Map();
  for (const tb of u.tables) if (tb.kind === "gifts" || tb.kind === "people") perSheet.set(tb.sheet, (perSheet.get(tb.sheet) || 0) + 1);
  if ([...perSheet.values()].some(n => n > 1)) return true;
  // what the mapper misreads: a paid/promised column, a multi-year pledge,
  // a pledge list, couples ("Suzanna & Walt"), total and subtotal rows, and
  // dates with no year ("Oct 22")
  if (u.tables.some(tb => tb.columns.some(c => ["paid", "pledgeTotal"].includes(c.role)))) return true;
  if (u.pledges.some(p => p.years > 1) || (u.pledges.length && !u.gifts.length)) return true;
  // couples, when there is no email to tell people apart (an event sheet);
  // subtotals (one TOTAL line the mapper already reads as chrome)
  const hasEmail = u.tables.some(tb => tb.columns.some(c => c.role === "email"));
  if ((u.counts.households > 0 && !hasEmail) || u.totals.filter(x => x.role === "amount").length > 1) return true;
  return u.tables.some(tb => tb.columns.some(c => c.role === "date" && (c.sample || []).some(v => /^[A-Za-z]{3,9}\.?\s+\d{1,2}$/.test(String(v).trim()))));
}

// NUMBERS-5 · A WORKBOOK OF PEOPLE AND THEIR GIFTS IS READ BY THE WORKBOOK
// SCREEN (WorkbookImport.jsx, BUILD-82), which reads every sheet; this reader
// read messy-25k as 1,101 people and no gifts. `roled`: classifyWorkbookSheets'
// answer. wantsAdaptiveReading's question is about shape, so it is asked of
// each sheet's first rows: the same answer under that size, seconds for a big file.
const SHAPE_ROWS = 2000;
export function readsAsWorkbook(sheets, roled) {
  const live = (roled || []).filter(s => s.rowCount > 0);
  if (!live.some(s => s.role === "donors") || !live.some(s => s.role === "gifts")) return false;
  const head = (sheets || []).map(sh => ({ ...sh, grid: (sh.grid || []).slice(0, SHAPE_ROWS) }));
  return !wantsAdaptiveReading(head, roled);
}
