// shared/totalRows.js · IMPORT-10. A LOT NAMED "TOTAL WINE" IS A GIFT, NOT A TOTAL ROW.
//
// On 11 Nov a customer's 251-row silent-auction winners file previewed 249
// rows. Two winners, each with a first name, last name, email and address,
// had lot names holding the word "Total" (a supplement brand "Total …" and a
// class at "Total Wine & More"). The reader treated any non-money cell with a
// total word as a total row, so both were left out ($280 paid, $1,010 of value)
// and said only in a warning that read like a bookkeeping note.
//
// THE RULES
//   1. The total word counts only in a label's place: a name column (name,
//      first, last, last-first, organization) or the row's first non-blank
//      cell, and only in a short cell ("Total", "Grand total", "Subtotal -
//      October", "October total", "Total for <customer>"). A total word in a
//      lot name, item, description, note or memo never makes a row a total.
//   2. A row with a person on it is never a total: a name in a name column
//      that is not the label itself, or an email.
//   3. A total-looking row that foots (its amount is the sum of the rows above
//      it, or since the last subtotal) is a total, checked and set aside. One
//      that does not foot is never dropped quietly: it is listed under "Not
//      read, check these" with an Include button, and counted in the headline.
//      Include (answers.includeRows, "sheet:line") reads it as an ordinary row.
//   4. A row with no name and no label that foots is a total, as before.
//
// Pure: no I/O. shared/sheetRead.js calls it from its row loop; the browser and
// the server walk one plan.
const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const words = t => (s(t).match(/[a-z0-9]+/gi) || []).length;

const LABEL_RE = /^(grand\s+|sub-?\s?)?totals?\b|^sum\b|\b(grand\s+|sub-?\s?)?totals?\s*:?$/i;
const TOTAL_FOR_RE = /^(sub-?\s?)?total\s+for\b/i;   // QuickBooks: "Total for Aldous Penhale"

// A cell that reads as a total row's label.
export function isTotalLabel(v) {
  const t = s(v);
  if (!t) return false;
  if (TOTAL_FOR_RE.test(t)) return true;
  return LABEL_RE.test(t) && words(t) <= 4;
}

// The label of a total-looking row, or null. `labelIdx` are the name columns' indexes.
export function totalLabelOf(cells, labelIdx, moneyIdx) {
  const firstIdx = cells.findIndex((c, i) => s(c) && !moneyIdx.includes(i));
  for (const i of [...labelIdx, firstIdx]) if (i >= 0 && !moneyIdx.includes(i) && isTotalLabel(cells[i])) return { index: i, text: s(cells[i]) };
  return null;
}

// Rule 2: a name in a name column other than the label, or an email.
export function hasPerson(cells, labelIdx, emailIdx, label) {
  if (emailIdx != null && /@/.test(s(cells[emailIdx]))) return true;
  return labelIdx.some(i => (!label || i !== label.index) && s(cells[i]) && !isTotalLabel(cells[i]));
}

// One row of the body loop. Returns "total" (pushed to totals), "check"
// (pushed to checks) or null (an ordinary row: read it).
export function readTotalRow(x) {
  const { t, b, cells, moneyHere, amtCol, nameText, sums, totals, checks, answers, cellOf, moneyOf, cents, fmt$ } = x;
  if (!moneyHere.length) return null;
  const role = r => t.cols.find(c => c.role === r);
  const labelIdx = ["name", "first", "last", "lastFirst", "org"].map(role).filter(Boolean).map(c => c.index);
  const emailCol = role("email");
  const moneyIdx = t.cols.filter(c => c.role === "amount" || c.role === "pledgeTotal").map(c => c.index);
  const label = totalLabelOf(cells, labelIdx, moneyIdx);
  if (hasPerson(cells, labelIdx, emailCol ? emailCol.index : null, label)) return null;
  const footCol = amtCol && moneyHere.includes(amtCol) ? amtCol : moneyHere[0];
  const v = cents(moneyOf(cellOf(t, b, footCol)));
  const foots = v !== 0 && (v === sums.table[footCol.index] || v === sums.since[footCol.index]);
  if (!label && !(foots && !nameText && t.kind === "gifts")) return null;
  const rowKey = `${t.sheet}:${b.line}`;
  if (label && !foots) {
    if (((answers && answers.includeRows) || []).includes(rowKey)) return null;
    checks.push({ key: rowKey, sheet: t.sheet, line: b.line, label: label.text, column: t.header[footCol.index], statedCents: v,
                  sumCents: sums.table[footCol.index], cells: cells.map(s).filter(Boolean).slice(0, 6),
                  reason: `"${label.text}" looks like a total row, but the rows above it come to ${fmt$(sums.table[footCol.index])}, not this row's amount` });
    return "check";
  }
  const lbl = label ? label.text : "Total";
  const isSub = /sub-?\s?total|total for|total\s+[a-z]\w*/i.test(lbl) && !/grand total/i.test(lbl);
  for (const m of moneyHere) {
    const stated = cents(moneyOf(cellOf(t, b, m)));
    const against = isSub && sums.since[m.index] ? sums.since[m.index] : sums.table[m.index];
    totals.push({ sheet: t.sheet, line: b.line, column: t.header[m.index], role: m.role, statedCents: stated, sumCents: against, rowsAbove: t.readCount,
                  matches: stated === against, subtotal: isSub && !!sums.since[m.index], label: lbl });
    sums.since[m.index] = 0;
  }
  return "total";
}

// The headline when rows need a look: "251 rows: 249 read, 2 need a look".
export function checkHeadline(rowsRead, checks) {
  if (!checks.length) return null;
  const all = rowsRead + checks.length, N = x => x.toLocaleString("en-US");
  return `${N(all)} ${all === 1 ? "row" : "rows"}: ${N(rowsRead)} read, ${N(checks.length)} ${checks.length === 1 ? "needs" : "need"} a look`;
}
