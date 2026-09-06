// BUILD-80 Part 1 — THE CLOSED MONEY GRAMMAR, every shape pinned individually.
//
// The reproduction this replaces (measured 2026-09-05, pre-fix):
//   "2 000,00"  → 200000     (the hundredfold parse: a $2,000 gift became
//                             $200,000, 9% of everything imported, and led
//                             the thank-you queue)
//   "1.250,00"  → 1.25       (a $1,250 gift became a dollar twenty-five)
//   "$1,5000"   → 15000      · "1e3" → 1000 · "500 (pledge)" → 500
//   "1,000.00." → 1000       · "100..00" → 100 · "$25O.00" → 25
//   "500.00-"   → +500       (an SAP refund imported as a POSITIVE gift)
//   "CR 500.00" → refused    (a credit refused instead of negative)
//   "2.5k"      → 2.5        ($2,500 became $2.50)
//
// The grammar is CLOSED: every accepted shape is listed here, tested
// individually; everything else refuses with the raw cell in the warning.
const { ok, summary } = require("./helpers");

(async () => {
  const lib = await import("../shared/importShape.js");
  const { normalizeMoney, inferAmountConvention } = lib;

  console.log("\n— accepted shapes, one by one —");
  const accepted = [
    ["$1,000.00", 1000], ["1,000", 1000], ["1000", 1000], ["1000.5", 1000.5],
    ["$ 250", 250], ["USD 750.00", 750], ["'1000.00", 1000],
    ["(500.00)", -500], ["(1,000)", -1000], ["-$500.00", -500],
    ["500.00-", -500], ["1,000.00-", -1000],
    ["CR 500.00", -500], ["CR 1,000.00", -1000],
    ["2.5k", 2500], ["5k", 5000], ["1.5k", 1500],
    ["250 dollars", 250], ["1 dollar", 1],
    ["1000.00\t", 1000], ["  1000  ", 1000],
    ["1.250,00", 1250],                        // European: dot thousands, comma decimal
    ["12.345.678,90", 12345678.9],
    ["2\u00A0000,00", 2000],              // NBSP thousands (French-Canadian Excel)
    ["2 000,00", 2000], ["1 500,00", 1500],    // space thousands
    ["1 234 567,89", 1234567.89],
    ["2 000.50", 2000.5],                      // space thousands, dot decimal
    ["2000,00", 2000],                         // bare comma decimal
  ];
  for (const [raw, want] of accepted) {
    const r = normalizeMoney(raw);
    ok(`${JSON.stringify(raw)} → ${want}`, r.value === want && !r.warn, r);
  }

  console.log("\n— the eight planted traps, each refused —");
  const traps = ["$1,5000", "1e3", "500 (pledge)", "1,000.00.", "$", "one hundred", "100..00", "$25O.00"];
  for (const raw of traps) {
    const r = normalizeMoney(raw);
    ok(`${JSON.stringify(raw)} refuses`, r.value === null && !r.blank && /couldn't parse amount/.test(r.warn || ""), r);
  }
  ok("1e3 refuses BY DESIGN — scientific notation in a donor file is a spreadsheet accident, not a gift",
    normalizeMoney("1e3").value === null, normalizeMoney("1e3"));

  console.log("\n— other refusals the closed grammar implies —");
  for (const raw of ["12,34,56", "1,00,000.00", "$-", "--500", "(500.00)-", "1.2.3", "£500"]) {
    const r = normalizeMoney(raw);
    ok(`${JSON.stringify(raw)} refuses`, r.value === null && !r.blank, r);
  }

  console.log("\n— deliberate blanks stay blanks (skipped, never errored) —");
  for (const raw of ["", "n/a", "NA", "TBD", "-", "—", "unknown"]) {
    const r = normalizeMoney(raw);
    ok(`${JSON.stringify(raw)} is blank`, r.blank === true && r.value === null && !r.warn, r);
  }

  console.log("\n— ambiguity resolves by COLUMN evidence, never per cell —");
  ok("'1.250' (no decimals) REFUSES under US — 1.25 vs 1250 is not a guess",
    normalizeMoney("1.250").value === null, normalizeMoney("1.250"));
  ok("'1.250' reads 1250 when the column's evidence says European",
    normalizeMoney("1.250", { convention: "eu" }).value === 1250, normalizeMoney("1.250", { convention: "eu" }));
  ok("'1,000' reads 1000 under US (default)", normalizeMoney("1,000").value === 1000);
  ok("'1,000' reads 1.0 when the column is European",
    normalizeMoney("1,000", { convention: "eu" }).value === 1, normalizeMoney("1,000", { convention: "eu" }));

  console.log("\n— convention tagging + inference —");
  ok("EU cell tags comma-decimal", normalizeMoney("1.250,00").convention === "comma-decimal");
  ok("NBSP cell tags space-thousands", normalizeMoney("2 000,00").convention === "space-thousands");
  ok("US cell tags nothing", normalizeMoney("$1,000.00").convention === undefined);
  const inf = inferAmountConvention(["$100.00", "250.00", "1.250,00", "2 000,00", "1,000"]);
  ok("inference tallies: 1 comma-decimal, 1 space-thousands, 2 US-decimal",
    inf.commaDecimal === 1 && inf.spaceThousands === 1 && inf.usDecimal === 2, inf);
  ok("a column with a US-decimal cell is NEVER read European (mixed → per-cell shapes only)",
    inf.columnConvention === "us", inf.columnConvention);
  const infEu = inferAmountConvention(["1.250,00", "2.500,00", "1.250"]);
  ok("an uncontradicted comma-decimal column IS European", infEu.columnConvention === "eu", infEu);

  summary();
})();
