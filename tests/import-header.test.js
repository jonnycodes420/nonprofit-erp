// BUILD-79 Part 1 — FIND THE HEADER, DON'T ASSUME IT.
//
// Pure suite over shared/importShape.js's report-export layer: evidence-scored
// header detection, chrome classification (title/generated lines, repeated
// headers, Page N of M, TOTAL, End of report), line-aware CSV records, the
// per-LINE windows-1252 repair, and "rows in your file" counted ONCE.
// Fixtures: build79/steward-messy-2500-v2.csv (a report export — title line,
// generated-by, blank, header on LINE 4, 3 page breaks re-printing the header,
// a TOTAL row, an End-of-report line, 4 CP1252-byte lines inside otherwise
// valid UTF-8) and build77/steward-messy-2500.csv (header on line 1, one stray
// header row echoed mid-file).

const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
const ok = (cond, label, detail) => {
  if (cond) { passed++; } else { failed++; console.log("  FAIL  " + label + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
};

(async () => {
  const lib = await import("../shared/importShape.js");
  const V2 = fs.readFileSync(path.join(__dirname, "fixtures/build79/steward-messy-2500-v2.csv"));
  const V1 = fs.readFileSync(path.join(__dirname, "fixtures/build77/steward-messy-2500.csv"), "utf8");

  console.log("— §1 · encoding: strict, per-line repair, never U+FFFD, never whole-file corruption —");
  const dec = lib.decodeSpreadsheetBytesDetailed(V2);
  ok(!dec.text.includes("﻿"), "BOM stripped before anything sees the text");
  ok(!dec.text.includes("�"), "no U+FFFD ever written");
  ok(dec.cp1252Lines.length === 4 && dec.cp1252Lines.join(",") === "1541,1542,1545,1913",
    "the four CP1252-byte lines are reported by physical line number", dec.cp1252Lines);
  ok(dec.text.includes("García, Christian") && dec.text.includes("Müller, Stephanie"),
    "CP1252 bytes decode to the real characters");
  // the old whole-file fallback would have corrupted the file's VALID UTF-8 —
  // and line 1541 mixes encodings WITHIN one line (CP1252 Name cell beside a
  // valid-UTF-8 Last Name cell), so even line-level repair corrupts it. Assert
  // the byte-run repair leaves both cells right. (Lines like 1546's
  // "GarcÃ­a" are mojibake ALREADY IN the source bytes — valid UTF-8 of
  // double-encoded text. BUILD-79 passed it through as data; BUILD-80 Part 3
  // reverses it, but ONLY when the run re-assembles into valid UTF-8, with
  // every repair counted and reported — never a guess, never silent.)
  const l1541 = dec.text.split("\n")[1540];
  ok(l1541.includes('"García, Christian"') && !l1541.includes("Ã"),
    "a mixed-encoding line: the CP1252 cell repaired AND the valid-UTF-8 cell untouched", l1541.slice(0, 60));
  const l1546 = dec.text.split("\n")[1545];
  ok(l1546.includes("García") && !l1546.includes("GarcÃ­a"),
    "source-borne double-encoding is REVERSED (BUILD-80 Part 3): 'GarcÃ­a' reads García, validity-gated and reported",
    { line: l1546.slice(0, 40), repaired: dec.mojibakeRepaired });
  ok(dec.mojibakeRepaired > 0 && Array.isArray(dec.mojibakeRepairs),
    "every double-encoding reversal is counted and itemised — never silent", dec.mojibakeRepaired);
  const pure1252 = new Uint8Array([0x4A, 0x6F, 0x73, 0xE9]); // "José" in cp1252
  ok(lib.decodeSpreadsheetBytes(pure1252) === "José", "a pure windows-1252 file still decodes (back-compat)");

  console.log("— §2 · line-aware CSV records —");
  const recs = lib.parseCsvRecords(dec.text);
  ok(recs.length === 2517, "quoted embedded newlines collapse 2,853 physical lines into 2,517 records", recs.length);
  ok(recs[0].line === 1 && recs[3].line === 4, "records carry their starting physical line");
  const quoted = lib.parseCsvRecords('a,"b\nc",d\ne,f,g');
  ok(quoted.length === 2 && quoted[0].cells[1] === "b\nc" && quoted[1].line === 3,
    "a quoted embedded newline stays in the cell and the NEXT record knows its true line", quoted);
  const escaped = lib.parseCsvRecords('a,"say ""hi""",c');
  ok(escaped[0].cells[1] === 'say "hi"', "escaped quotes");

  console.log("— §3 · header by EVIDENCE, position never the tiebreaker on its own —");
  const a = lib.analyzeCsvText(dec.text);
  ok(a.headerLine.line === 4, "v2: header found on line 4, not line 1", a.headerLine);
  ok(a.headerLine.evidence.some(e => /vocabulary/.test(e)), "the decision shows its evidence", a.headerLine.evidence);
  ok(a.headers[0] === "Constituent ID" && a.headers[4] === "Spouse" && a.headers[18] === "Frequency",
    "the real columns come out under their real names", a.headers.slice(0, 8));
  const b = lib.analyzeCsvText(V1);
  ok(b.headerLine.line === 1, "v1: a file whose header IS line 1 still detects line 1", b.headerLine);
  // a title line with zero vocabulary can never win however early it sits
  const title = lib.scoreHeaderRow(["Donor Giving History Report", "", "", ""], 22);
  const real = lib.scoreHeaderRow(["Name", "Email", "Phone", "Gift Date", "Amount"], 5);
  ok(real.score > title.score, "a vocabulary-rich row outscores a title line", { title: title.score, real: real.score });

  console.log("— §4 · chrome is shown, not imported, by line number —");
  ok(a.chromeAbove.length === 3, "v2: 3 lines above the header are chrome", a.chromeAbove);
  ok(/Donor Giving History Report/.test(a.chromeAbove[0].text) && a.chromeAbove[0].line === 1, "the title line, named");
  ok(/Generated 05\/09\/2026/.test(a.chromeAbove[1].text), "the generated-by line, named");
  ok(a.chromeAbove[2].text === "", "the blank line is shown as blank, not dropped silently");
  const kinds = a.chromeRows.map(c => `${c.kind}:${c.line}`).join(",");
  ok(kinds === "page_marker:743,repeated_header:744,page_marker:1473,repeated_header:1474,page_marker:2195,repeated_header:2196,total_row:2852,end_marker:2853",
    "every chrome row below the header classified by kind and line", kinds);
  ok(a.totalRow && a.totalRow.line === 2852 && a.totalRow.amount === 2035978.52,
    "the TOTAL row's amount is captured for Part 3's outside-number reconciliation", a.totalRow);

  console.log("— §5 · rows, not lines: counted once —");
  ok(a.records === 2500, "v2: 2,500 records — not 2,853 lines, not 2,510 papa rows, not 2,438", a.records);
  ok(a.rows.length === a.records && a.rowLines.length === a.records, "rows/records/rowLines agree by construction");
  ok(b.records === 2501, "v1: 2,501 (2,502 physical rows minus the mid-file stray header, now chrome)", b.records);
  ok(b.chromeRows.length === 1 && b.chromeRows[0].kind === "repeated_header" && b.chromeRows[0].line === 1206,
    "v1's stray header row is chrome with its line number", b.chromeRows);

  console.log("— §6 · header naming: blanks and duplicates stay position-stable —");
  const dd = lib.dedupeHeaderCells(["Name", "", "Notes", "Notes", ""]);
  ok(dd.join("|") === "Name|_1|Notes|Notes_1|_2", "blank → _N, duplicate → name_N", dd);

  console.log("— §7 · a totals-and-labels row can't sneak in as data —");
  const hc = ["Name", "Amount"];
  ok(lib.classifyBodyRow(["Subtotal", "$1,200.00"], hc)?.kind === "subtotal_row", "Subtotal is chrome");
  ok(lib.classifyBodyRow(["Grand Total", "$9,999.99"], hc)?.kind === "total_row", "Grand Total is chrome");
  ok(lib.classifyBodyRow(["", "$2,035,978.52"], hc)?.kind === "currency_only", "a lone currency cell is chrome");
  ok(lib.classifyBodyRow(["Page 3 of 4", ""], hc)?.kind === "page_marker", "Page N of M is chrome");
  ok(lib.classifyBodyRow(["Total Insurance Co", "$150.00"], hc) === null,
    "a donor NAMED 'Total …' with an amount is DATA, not chrome");
  ok(lib.classifyBodyRow(["Dylan Hollingsworth", "$750.00"], hc) === null, "an ordinary row is data");

  console.log("— §8 · shape is a decision with evidence, or a question (Part 2) —");
  // correct headers on the v2 fixture → transaction, with the reason stated
  const detGood = lib.detectImportShape(a.headers, a.rows);
  ok(detGood.shape === "transaction", "v2 with the real header detects individual gifts", detGood.shape);
  ok(/amount.*date/i.test(detGood.reason || ""), "the decision names its evidence", detGood.reason);
  // the Part-0 garbage headers (line 1 as header → _1.._21) → UNKNOWN, never a default
  const garbageHeaders = ["Donor Giving History Report", ..."_".repeat(21).split("").map((_, i) => `_${i + 1}`)];
  const garbageRows = a.rows.slice(0, 60).map(r => {
    const o = {};
    garbageHeaders.forEach((h, i) => { o[h] = r[a.headers[i]] || ""; });
    return o;
  });
  const detBad = lib.detectImportShape(garbageHeaders, garbageRows);
  ok(detBad.shape === "unknown", "unrecognisable headers yield shape UNKNOWN — the mapper asks, it does not pick", detBad.shape);
  ok(/recognised/.test(detBad.reason || ""), "the refusal says why", detBad.reason);
  ok((detBad.recognized || []).length < 3, "fewer than three recognised columns is the trigger", detBad.recognized);

  console.log("— §9 · totals mode refuses a per-gift file (Part 2.2) —");
  // keyed the way the Part-0 run was (Phone as the identity column):
  const clPhone = lib.assessAggregateCollapse(a.rows, "Phone", "");
  ok(clPhone.refuse === true, "aggregate on v2 keyed by phone REFUSES to proceed", clPhone);
  ok(clPhone.collapsed > clPhone.keyedRows / 3, `the evidence: ${clPhone.collapsed} of ${clPhone.keyedRows} rows collapse`, clPhone);
  // keyed by email (the file's real email column) — still a per-gift file:
  const clEmail = lib.assessAggregateCollapse(a.rows, "Email", "Name");
  ok(clEmail.refuse === true, "aggregate on v2 keyed by email refuses too", clEmail);
  // a genuinely-aggregate file (one row per donor) sails through:
  const uniqRows = [...new Map(a.rows.map(r => [r.Phone || r.Name, r])).values()];
  const clUniq = lib.assessAggregateCollapse(uniqRows, "Phone", "Name");
  ok(clUniq.refuse === false, "a genuinely one-row-per-donor set is not refused", { collapsed: clUniq.collapsed, keyed: clUniq.keyedRows });
  // small files never trip the guard (30-row floor)
  const clSmall = lib.assessAggregateCollapse(a.rows.slice(0, 10), "Phone", "");
  ok(clSmall.refuse === false, "under 30 keyed rows the guard stays quiet (tiny files collapse legitimately)");

  console.log("— §10 · the independent dollar scan (Part 3.1) —");
  const scan2 = lib.scanAmountShapedColumns(a.headers, a.rows);
  ok(scan2 && scan2.header === "Amount", "v2: the raw scan finds the Amount column with no mapping's help", scan2);
  ok(scan2.sum > 2000000, `the scanned sum (${scan2 && scan2.sum}) is in the file's own TOTAL row's neighbourhood — never $0`, scan2 && scan2.sum);
  const scan1 = lib.scanAmountShapedColumns(b.headers, b.rows);
  ok(scan1 && scan1.header === "Amount", "v1: same", scan1 && scan1.header);
  const noMoney = lib.scanAmountShapedColumns(["Name", "Email", "ZIP"], a.rows.slice(0, 50).map(r => ({ Name: r.Name, Email: r.Email, ZIP: r.ZIP })));
  ok(noMoney === null || noMoney.header !== "ZIP", "ZIP codes never scan as money", noMoney);

  console.log("— §11 · a name is a name (Part 5) —");
  // phone-shaped cannot map to email, with the evidence sentence
  const phoneVals = a.rows.map(r => ({ Phone: r.Phone }));
  const vPhone = lib.validateMappingChoice(["Phone"], phoneVals, "Phone", "email");
  ok(vPhone.ok === false && /contain @/.test(vPhone.summary) && /phone/.test(vPhone.summary),
    "phone-shaped → email refused with counted evidence", vPhone);
  // a real email column passes
  const vEmail = lib.validateMappingChoice(["Email"], a.rows, "Email", "email");
  ok(vEmail.ok === true, "the real email column passes its check", vEmail);
  // Spouse cannot take last name while the file has a Last Name column
  const vSpouse = lib.validateMappingChoice(a.headers, a.rows, "Spouse", "_lastName");
  ok(vSpouse.ok === false && /spouse/i.test(vSpouse.summary),
    "Spouse → last name refused while a real Last Name column exists (Nicole Peter is not a person)", vSpouse);
  // unnamed donors: a ledger keyed by email only yields flagged Unnamed donors, never email-as-name
  const txm = { donorEmail: "E", amount: "A", date: "D" };
  const built = lib.buildTransactionRows({ rows: [
    { E: "x@y.org", A: "$50", D: "2024-01-05" },
    { E: "x@y.org", A: "$60", D: "2024-02-05" },
    { E: "z@w.org", A: "$10", D: "2024-01-09" },
  ] }, txm, { today: "2026-09-05", rowLines: [5, 6, 7] });
  ok(built.donors.every(d => !d.name.includes("@")),
    "no donor's display name is an email address", built.donors.map(d => d.name));
  ok(built.donors.every(d => /^Unnamed donor \(line \d+\)$/.test(d.name)),
    "nameless donors are 'Unnamed donor (line N)' with their first line", built.donors.map(d => d.name));
  ok(built.donors.every(d => (d.tags || []).includes("needs-name")),
    "each carries the needs-name flag for review", built.donors.map(d => d.tags));
  // and a later row's real name fills the blank instead of the sentinel
  const built2 = lib.buildTransactionRows({ rows: [
    { E: "x@y.org", N: "", A: "$50", D: "2024-01-05" },
    { E: "x@y.org", N: "Jane Doe", A: "$60", D: "2024-02-05" },
  ] }, { ...txm, donorName: "N" }, { today: "2026-09-05" });
  ok(built2.donors.length === 1 && built2.donors[0].name === "Jane Doe",
    "a later row's real name names the donor — the sentinel only survives when NO row has a name", built2.donors[0]);
  // real physical lines ride the dispositions when the caller passes rowLines
  const withLines = lib.buildTransactionRows({ rows: [{ E: "", N: "", A: "$5", D: "x" }] }, { ...txm, donorName: "N" }, { rowLines: [412] });
  ok(withLines.dispositions[0].line === 412, "dispositions carry REAL physical lines after chrome removal", withLines.dispositions[0]);

  console.log(`import-header: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
