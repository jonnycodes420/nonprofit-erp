// server/shared/csv.js — a CSV cell and a CSV file.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {

// A NUMBER IS NOT A FORMULA, however it was typed.
//
// The guard's own comment always said numbers pass through untouched, but it
// recognised a number only when the VALUE was a JS number — so a money column
// that formats to two decimals (which is what a money column should do) sent
// "-8.30" as a string, got an apostrophe, and arrived in QuickBooks as text.
// The fee lines in the deposits file are the only negative money Steward
// writes, which is why this surfaced here and not years ago.
//
// "-8.30" is a number. "-2+3" is not, and still gets the apostrophe.
const CSV_PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
function reportCsvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@]/.test(s) && !CSV_PLAIN_NUMBER.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
return { reportCsvCell };
}

module.exports = { mount };
