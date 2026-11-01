## SHEETS-1 · Bring in old spreadsheets (2026-10-06)

Directors keep years of grant trackers, board reports and budgets in Excel. One "Bring in a spreadsheet"
on Grants and on Reports: the browser reads the file (parseFileToSheets), `POST /sheets/read` says
whether it is grants, a table of numbers or neither, and nothing saves until the person confirms. A
grant tracker imports through the one grant importer and keeps the file with every unplaced column;
a board report is kept under Reports (Past board reports) with its table and original file. Undo on
both. Also fixed: the grant import screen printed "[object Object]" for unread columns. Test:
`tests/sheets1-import.test.js`, proven red two ways.
