#!/usr/bin/env node
// DEVBOARD-1 · import a walk report into the board (ops/board.json).
//
//   node scripts/ops/board-import-walk.js <walk-report.md> [--date YYYY-MM-DD] [--write]
//
// Each FAIL becomes an open item (W-<MMDD>-<check>), unless that check is
// already open. A check that now PASSes moves its item to verified. A fixed or
// verified check that FAILs again is reopened. The walk's pass, fail and skip
// counts go into the trend. Dry run by default: it prints what would change and
// writes nothing until --write. Reads a local file only; touches no database.
//
// LEAD-IMPORT-1: it reads both shapes, Muse's single walk report and the QA
// fleet lead's summary (lead-YYYY-MM-DD.md: each fail's ID, tier, area, check,
// NEW/REPEAT, words and evidence). Every line it could not read is listed.
// The same files can be uploaded on /ops (Import a walk report), with no commit.
"use strict";
const fs = require("fs");
const path = require("path");
const B = require("../../server/admin/board");
const LEAD = require("../../server/admin/leadImport");

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--date" && args[i - 1] !== "--board");
if (!file) { console.error("usage: node scripts/ops/board-import-walk.js <walk-report.md> [--date YYYY-MM-DD] [--write]"); process.exit(64); }
const boardFile = flag("--board") || B.BOARD_PATH;
const text = fs.readFileSync(file, "utf8");
const report = LEAD.readReport(text, path.basename(file));
const date = flag("--date") || report.date;
if (!date) { console.error("No date in the file name or its first heading; pass --date YYYY-MM-DD."); process.exit(64); }

if (!report.count) { console.error(`No ${report.shape === "lead" ? "fail IDs (W-MMDD-Area-n) with a tier" : "PASS / FAIL / SKIP lines with a check id"} found in ${file}.`); process.exit(65); }
const { board, changes } = report.apply(B.readBoard(boardFile), date);
const w = board.walks.find(x => x.date === date);
if (report.shape === "lead") console.log(`Lead summary ${date}: ${w.fail} fail (${Object.entries(w.tiers).map(([t, n]) => `tier ${t}: ${n}`).join(" · ")}) · ${w.pass} passing again`);
else console.log(`Walk ${date}: ${w.pass} pass · ${w.fail} fail · ${w.skip} skip`);
console.log(`  new items   ${changes.added.length}${changes.added.length ? "  " + changes.added.join(", ") : ""}`);
console.log(`  verified    ${changes.verified.length}${changes.verified.length ? "  " + changes.verified.join(", ") : ""}`);
console.log(`  reopened    ${changes.reopened.length}${changes.reopened.length ? "  " + changes.reopened.join(", ") : ""}`);
console.log(`  still open  ${changes.stillOpen.length}`);
if (report.unread.length) {
  console.log(`  not read    ${report.unread.length}`);
  for (const u of report.unread) console.log(`    line ${u.line}: ${u.text}  (${u.why})`);
}
if (args.includes("--write")) { B.writeBoard(board, boardFile); console.log(`Wrote ${path.relative(process.cwd(), boardFile)}. Commit it on a branch.`); }
else console.log("Dry run: nothing written. Add --write to save.");
