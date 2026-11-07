// server/shared/csvCell.js — REDTEAM-1: one CSV cell, for every file Steward hands out.
//
// A spreadsheet runs a cell that starts with = + - @, a tab or a carriage
// return as a formula. A donor's name, a survey answer typed by anyone on the
// public page, or an import cell can start that way, and opening the export
// would run it on the reader's machine. So such a cell gets a leading
// apostrophe (the spreadsheet shows the text as typed) and is quoted.
//
// A plain number is not a formula however it was typed: "-8.30" stays a number
// (a fee line in the deposits file), "-2+3" is text.
//
// Ten exports wrote their own cell before this; four had no guard at all
// (the screening file, Going out's sent list, survey results, the audit log)
// and six missed the tab and carriage return. Every export calls this now.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // A JS number is never a formula (String(-1e-7) is "-1e-7"); only text is.
  const formula = typeof v !== "number" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s);
  if (formula) s = "'" + s;
  return formula || /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = { csvCell, FORMULA_START };
