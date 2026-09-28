// client/src/lib/lostAndFoundWorker.js — LOST & FOUND, IN A WEB WORKER.
//
// THE DONOR FILE NEVER LEAVES THE COMPUTER, and this file is where that is
// true or not. It runs in a Worker, it is handed BYTES, and it hands back an
// audit. It has no `fetch`, no `XMLHttpRequest`, no `navigator.sendBeacon`
// and no import of anything that has one — and that is checked by a test
// rather than promised in a comment (tests/lf1-no-donor-data-leaves.test.js
// reads this file and refuses any of those tokens).
//
// WHY A WORKER AND NOT THE MAIN THREAD. A twenty-five thousand row XLSX
// takes several seconds to parse, and a page that freezes while it does is a
// page people close. It is also a second, physical guarantee: the worker has
// no DOM, so nothing it computes can be put in a form field or a link by
// accident.
//
// The parsing half is Steward's own import logic (`shared/importShape.js`),
// which already solves the three things every real donor export gets wrong:
// where the header row actually is, whether 03/04 is March or April, and
// whether "1.234,56" is a thousand or a decimal. The audit half is
// `shared/lostAndFound.js`. Both are pure; this file is the seam.

import * as XLSX from "xlsx";
import {
  parseCsvRecords, detectHeaderRow, decodeSpreadsheetBytes,
  inferDateConvention, inferAmountConvention,
} from "../../../shared/importShape.js";
import { mapColumns, fileReadiness, giftFromRow, audit } from "../../../shared/lostAndFound.js";

// XLSX first, CSV otherwise, decided by the BYTES rather than by the file
// name: a .csv that is really an xlsx is a thing people send, and so is the
// reverse.
function readRecords(bytes, name) {
  const head = new Uint8Array(bytes.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;            // PK — xlsx
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;            // old .xls
  if (isZip || isOle || /\.xlsx?$/i.test(name || "")) {
    const wb = XLSX.read(bytes, { type: "array", cellDates: false, raw: false });
    // THE BIGGEST SHEET, not the first. A workbook's first tab is very often
    // a cover page or a pivot, and the donors are on tab three.
    let best = null, bestRows = -1;
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: "" });
      if (rows.length > bestRows) { bestRows = rows.length; best = { sheetName, rows }; }
    }
    // ONE SHAPE FOR BOTH PATHS. `parseCsvRecords` returns
    // `[{ cells, line }]` and `detectHeaderRow` reads `.cells`, so the XLSX
    // rows are wrapped the same way rather than left as bare arrays — which
    // threw inside detectHeaderRow the first time this ran.
    return best
      ? { records: best.rows.map((r, i) => ({ cells: r.map(c => (c == null ? "" : String(c))), line: i + 1 })),
          sheet: best.sheetName }
      : { records: [] };
  }
  const text = decodeSpreadsheetBytes(bytes);
  return { records: parseCsvRecords(text), sheet: null };
}

function run({ bytes, name, today }) {
  const { records, sheet } = readRecords(bytes, name);
  if (!records.length) {
    return { error: "empty", message: "Steward could not find any rows in that file." };
  }
  const hdr = detectHeaderRow(records);
  const headerIdx = hdr && Number.isInteger(hdr.index) ? hdr.index : 0;
  const headers = ((records[headerIdx] || {}).cells || []).map(h => String(h || "").trim());
  const body = records.slice(headerIdx + 1)
    .map(r => r.cells || [])
    .filter(r => r.some(c => String(c || "").trim() !== ""));
  if (!body.length) {
    return { error: "no_rows", message: "That file has a header row and nothing under it." };
  }

  const map = mapColumns(headers);
  const readiness = fileReadiness(map);
  if (!readiness.ok) return { error: "unreadable", readiness, headers, rowCount: body.length };

  // The conventions are inferred from the WHOLE column, once, so every row
  // reads 03/04 the same way. Inferring per row is how a file ends up with
  // March and April in it.
  const col = h => { const i = headers.indexOf(h); return i < 0 ? [] : body.map(r => r[i]); };
  const dateConvention = inferDateConvention(col(map.date));
  // `inferAmountConvention` names its answer `columnConvention`, not
  // `convention` — the two helpers disagree, and reading the wrong key
  // silently falls back to the default rather than erroring.
  const amountConvention = inferAmountConvention(col(map.amount));

  const asObj = r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; };
  const gifts = [];
  let skipped = 0;
  for (const r of body) {
    const g = giftFromRow(asObj(r), map, {
      dateConvention: dateConvention && dateConvention.convention,
      amountConvention: amountConvention && amountConvention.columnConvention,
    });
    if (g) gifts.push(g); else skipped++;
  }
  if (!gifts.length) {
    return { error: "no_gifts", message: "Steward read the file and could not make a single gift out of it. "
      + "Check that the amount column holds numbers and the date column holds dates." };
  }

  const result = audit(gifts, { today });
  return {
    ...result,
    file: { name: name || "your file", sheet, headers, rowCount: body.length, skipped,
      dateConvention: dateConvention && dateConvention.convention,
      sentence: `${gifts.length.toLocaleString()} gifts read from ${body.length.toLocaleString()} rows`
        + (skipped ? `, ${skipped.toLocaleString()} skipped because they had no readable amount, date or donor.` : ".") },
  };
}

self.onmessage = (e) => {
  const { bytes, name, today } = e.data || {};
  try {
    self.postMessage({ ok: true, result: run({ bytes, name, today }) });
  } catch (err) {
    // The MESSAGE only. Never the row, never the value: an error carrying a
    // donor's name is donor data leaving this worker, and the page renders
    // whatever comes back.
    self.postMessage({ ok: false, message: String((err && err.message) || "Steward could not read that file.") });
  }
};
