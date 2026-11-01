## REPORTS-5 · Bring your old reports with you (2026-10-07)

An org switching to Steward brings years of reports, often PDFs. "Import old reports" (top of the Reports rail, and
in the Donors Import menu: one wizard, `OldReportsImport.jsx`) takes CSV, XLSX/XLS and PDF, or a zip of them (JSZip in
the browser), up to 25 MB each and 20 at a time (`oldReports.js` MAX_BYTES with the 40mb parser on `/old-reports/*`:
move both or neither). `oldReports.js` reads a PDF's TEXT with pdfjs-dist (lines rebuilt from x/y positions, a table
from the first worded header row; years count as headings) and calls a text-less PDF a scan: kept, numbers refused,
no OCR. It guesses the kind (giving summary, by fund/campaign, LYBUNT/SYBUNT, retention, top donors, board report,
grant report, other) and the system (Bloomerang, DonorPerfect, Salesforce, Neon, Little Green Light, Zeffy,
QuickBooks by name in the file or by their export column names, else "a spreadsheet"), with one line of why; the
period comes from the file name's year first, then dates in the file, then a year in the text. Every file is kept
(`stored_sheets` kind `old_report`, the asset store as SHEETS-1). Pulling numbers in maps columns (or, for a board
report with years across the top, rows) into `historical_totals`: never gifts, never people; a "Total" line is set
aside and checked against the sum to the cent. `historicalGiving` (figureSources.js) picks ONE file per period (a
giving summary or board-report total before a by-fund breakdown; newest first) and is the only way history reaches a
screen: beside Steward's total on the three-year comparison and the giving summary, standing in for an empty
same-point-last-year on the giving summary, the Board and the board pack, and cited by Ask. A calendar-year import
shows on calendar-year views only: it does not fit inside a fiscal year, and is never split across two. Harborlight
already has 2024 gifts, so its 2024 import shows BESIDE them, labelled. Undo is one batch (`old_report_batches`).
Past reports lists both kinds by year and kind; ⌘K finds them by title, file name (dashes read as spaces) or system.
Test: `reports5-import` (27 checks, three planted defects went red). The seed changed (three files + 2024 totals).
