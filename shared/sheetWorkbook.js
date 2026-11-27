// shared/sheetWorkbook.js · IMPORT-11. A WORKBOOK OF PEOPLE AND THEIR GIFTS,
// JOINED ON AN ID, READ BY THE ONE READER.
//
// 27 Nov: a workbook with Read Me, Donors (60 rows, Constituent ID), Gifts (136
// rows keyed by Constituent ID, no name column, a TOTAL row) and a decoy sheet
// read as "A list of people with no gifts: Donors, 60 rows", every gift set
// aside as "a summary of amounts with no names". A sheet of amounts whose ID
// column holds the people sheet's IDs is that list's gifts: each row is its
// person's gift by ID. She can correct what each sheet is (answers.sheetKinds).
"use strict";

// The kinds she may give a sheet.
export const SHEET_KINDS = [
  { key: "people", label: "People" },
  { key: "gifts", label: "Gifts" },
  { key: "skip", label: "Leave this sheet out" },
];

const low = v => String(v == null ? "" : v).trim().toLowerCase();

// Her answer per sheet, applied after Steward's own reading. "skip" sets the
// sheet aside by name; "gifts" needs an amount column (otherwise the answer
// is refused with its reason); "people" reads its amounts as nothing.
export function applySheetKinds(tables, answers, has) {
  const want = (answers && answers.sheetKinds) || {};
  const refused = [];
  for (const t of tables) {
    const k = want[t.sheet];
    if (!k || k === t.kind) continue;
    if (k === "skip") { t.kind = "other"; t.leftOut = true; continue; }
    if (k === "people") { t.kind = "people"; t.chosen = true; continue; }
    if (k === "gifts") {
      if (has(t, "amount")) { t.kind = "gifts"; t.chosen = true; } else refused.push({ sheet: t.sheet, reason: "it has no column of amounts" });
    }
  }
  return refused;
}

// The ID that joins the sheets: the people tables' ID values. A table read as
// a summary (amounts, no names) whose ID column holds them is gifts, linked
// by ID; the join is named by the people sheet's header.
export function linkGiftSheetsById(tables, { roleOf, dataRows, cellOf, isNamed }) {
  const ids = new Set();
  let joinHeader = null;
  for (const t of tables) if (t.kind === "people") {
    const c = roleOf(t, "externalId");
    if (!c) continue;
    joinHeader = joinHeader || c.header;
    for (const b of dataRows(t)) { const v = low(cellOf(t, b, c)); if (v) ids.add(v); }
  }
  if (!ids.size) return { ids, joinHeader: null, linked: [] };
  const linked = [];
  for (const t of tables) {
    if (!(t.kind === "summary" || (t.kind === "gifts" && t.chosen && !isNamed(t)))) continue;
    const c = roleOf(t, "externalId") || roleOf(t, "giftId");
    if (!c) continue;
    const vals = dataRows(t).map(b => low(cellOf(t, b, c))).filter(Boolean);
    if (!vals.length || vals.filter(v => ids.has(v)).length < vals.length * 0.5) continue;
    t.kind = "gifts"; t.linkedById = true;
    c.role = "externalId"; c.by = "rule"; c.links = true;
    c.reason = "the same IDs as your list of people, so each gift attaches to its person by ID";
    linked.push(t);
  }
  return { ids, joinHeader, linked };
}

// The preview's one sentence for a joined workbook: "60 people and 136 gifts
// ($8,005.00) joined on Constituent ID." Counts come from the reader's own
// lists; money from its cents.
const dollars = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function joinSentence({ persons, gifts, giftCents, joinHeader }) {
  if (!joinHeader) return null;
  const n = (k, one, many) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;
  return `${n(persons, "person", "people")} and ${n(gifts, "gift", "gifts")} (${dollars(giftCents)}) joined on ${joinHeader}.`;
}

// Every sheet that is not read as people or gifts, by name and why, so the
// decoy and the Read Me are said out loud, never dropped.
export function sheetsSetAside(sheetNames, tables) {
  const read = new Set(tables.filter(t => t.kind === "people" || t.kind === "gifts").map(t => t.sheet));
  const out = [];
  for (const name of sheetNames) {
    if (read.has(name)) continue;
    const ts = tables.filter(t => t.sheet === name);
    const why = !ts.length ? "no table of names or amounts on it"
      : ts.some(t => t.leftOut) ? "you left it out"
      : ts.some(t => t.kind === "notes") ? "notes about people already on the list"
      : ts.some(t => t.kind === "summary") ? "amounts with no names, so a summary, not gifts"
      : "no names and no amounts";
    out.push({ sheet: name, reason: why, sentence: `Sheet '${name}' is set aside: ${why}.` });
  }
  return out;
}
