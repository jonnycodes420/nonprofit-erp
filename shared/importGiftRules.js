// shared/importGiftRules.js · IMPORT-13. A MESSY MIGRATION LANDS RIGHT, NOT JUST CLOSE.
//
// From the 27 Nov import gauntlet (a real migration run in order on staging,
// graded against a key built without the import code), the rules the one
// reader (shared/sheetRead.js) asks of each row, beside IMPORT-11's four
// checks (shared/importRowChecks.js):
//
//   · A gift ID is one gift inside a file. "ST-001" twice is one gift; the
//     second row is listed by line and set aside (item 1). Across files the
//     server checks the org's gifts (server/imports/knownGifts.js).
//   · An unreadable date is never silent (item 3). A blank date is an undated
//     gift, as IMPORT-4 decided; a date Steward cannot read ("next Friday",
//     "not a date") is set aside by default, listed with its words, and
//     "Import them undated" is one click (answers.unreadableDates = "undated").
//   · A total line is never a person (item 5). "TOTAL CONTACTS: 3" on a list
//     of people, with no email, phone or address, is set aside as a total.
//   · A row with an email and no name asks once (item 5): "3 people have only
//     an email. Use the email as their name, or set them aside?" Set aside is
//     the default (answers.emailOnly = "name" uses the email).
// Pure, and the same in the browser and on the server.
import { isTotalLabel } from "./totalRows.js";

const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const fmt$ = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const unreadableDateReason = words => `a date Steward couldn't read ("${s(words).slice(0, 40)}")`;
export const EMAIL_ONLY_REASON = email => `only an email (${email}), no name`;
export const REFUND_UNMATCHED = cents => `a refund with no gift to match (${fmt$(cents)})`;

// One per understand() call: the first line each gift ID was on. The same ID on
// the same person, amount and date is the same gift; the same ID with another
// amount or fund is a split designation (Bloomerang writes each fund's part as a
// line under one Transaction Number), so it lands, without the ID ({ split }).
export function giftIdOnce() {
  const seen = new Map();
  return {
    check({ giftId, sheet, line, cents, date, who, fund = "" }) {
      const id = s(giftId);
      if (!id) return null;
      const k = id.toLowerCase();
      const first = seen.get(k);
      if (!first) { seen.set(k, { sheet, line, cents, date, who, fund: s(fund).toLowerCase() }); return null; }
      // a $100 split $50 / $50 across two funds is two lines of one ID with the same amount: the fund tells them apart
      if (first.cents !== cents || String(first.date || "") !== String(date || "") || first.who !== who || first.fund !== s(fund).toLowerCase()) return { split: true };
      const where = first.sheet === sheet ? `row ${first.line}` : `${first.sheet} row ${first.line}`;
      return { reason: `gift ID ${id} is already on ${where} of this file, so it is one gift`, repeatOf: first.line, repeatId: id };
    },
  };
}

// A column that names the gift itself (Gift ID, Transaction Number, Opportunity ID), never a check or receipt
// number, which two people can share: only it makes "one gift per ID", in a file and against the org.
export function isGiftIdHeader(header) {
  const h = s(header).toLowerCase();
  return !!h && !/check|cheque|receipt|\bref|reference|batch|deposit/.test(h) && /\b(id|number|no|#)\b|_id$|^id$/.test(h);
}

// "TOTAL CONTACTS: 3", "Total", "Grand total: 20" in a name's place, with no
// way to reach anyone on the row, is the list's own count, never a person.
export function isTotalPersonRow({ nameText, contact = [] }) {
  const t = s(nameText);
  if (!t || contact.some(v => s(v))) return false;
  return isTotalLabel(t) || (/^(grand\s+)?totals?\b/i.test(t) && /[:\d]/.test(t) && t.split(/\s+/).length <= 4);
}

// The preview's two questions, each asked once for the file.
export function unreadableDateQuestion({ aside, gifts, answers = {} }) {
  const rows = [...aside.filter(a => a.unreadableDate), ...gifts.filter(g => g.unreadableDate)];
  if (!rows.length) return null;
  const distinct = [...new Set(rows.map(r => r.unreadableDate || ""))];
  const words = distinct.slice(0, 4).map(w => `'${w}'`).join(", ");
  const chosen = answers.unreadableDates === "undated" || answers.unreadableDates === "aside";
  return { id: "unreadableDates", kind: "unreadableDates", optional: true, default: "aside", answer: chosen ? answers.unreadableDates : "aside", chosen,
    count: rows.length, cents: rows.reduce((n, r) => n + (r.cents || 0), 0),
    rows: rows.slice(0, 50).map(r => ({ sheet: r.sheet, line: r.line, who: r.who || null, words: r.unreadableDate, cents: r.cents ?? null })),
    text: `${plural(rows.length, "gift has a date", "gifts have dates")} Steward couldn't read: ${words}${distinct.length > 4 ? " …" : ""}`,
    hint: "Set aside, they are listed on the receipt and nothing is written. Imported undated, each is marked No date and counts in no dated figure (this year, last year, LYBUNT) until it has one.",
    options: [{ key: "aside", label: "Set them aside" }, { key: "undated", label: "Import them undated" }] };
}
export function emailOnlyQuestion({ aside, answers = {}, emailOnlyUsed = [] }) {
  const rows = [...aside.filter(a => a.emailOnly), ...emailOnlyUsed];
  if (!rows.length) return null;
  const chosen = answers.emailOnly === "name" || answers.emailOnly === "aside";
  return { id: "emailOnly", kind: "emailOnly", optional: true, default: "aside", answer: chosen ? answers.emailOnly : "aside", chosen, count: rows.length,
    rows: rows.slice(0, 50).map(r => ({ sheet: r.sheet, line: r.line, email: r.emailOnly || r.email, cents: r.cents ?? null })),
    text: `${plural(rows.length, "person has", "people have")} only an email. Use the email as their name, or set them aside?`,
    options: [{ key: "aside", label: "Set them aside" }, { key: "name", label: "Use the email as their name" }] };
}

// The receipt's and the check page's own line for the unreadable dates.
export function unreadableList({ aside, gifts }) {
  const rows = [...aside.filter(a => a.unreadableDate).map(r => ({ ...r, imported: false })), ...gifts.filter(g => g.unreadableDate).map(r => ({ ...r, imported: true }))];
  if (!rows.length) return null;
  const imported = rows.some(r => r.imported);
  return { count: rows.length, imported, cents: rows.reduce((n, r) => n + (r.cents || 0), 0),
    rows: rows.map(r => ({ sheet: r.sheet, line: r.line, who: r.who || null, words: r.unreadableDate, cents: r.cents ?? null, imported: r.imported })),
    sentence: `${plural(rows.length, "gift had a date", "gifts had dates")} Steward couldn't read (${[...new Set(rows.map(r => `'${r.unreadableDate}'`))].slice(0, 4).join(", ")}): ${imported ? "imported undated" : "set aside"}.` };
}

// The workbook screen's two stops (item 2). Before the write: a sheet whose
// equation reads UNBALANCED holds Import, named in the headline. After it:
// what we showed you against what was written, the figure that differs said
// first ("Not finished: we showed you 1 pledge and 0 were written"), never fine print.
export function workbookUnbalanced({ donorsSheet = null, totals = {}, perSheet = [] }) {
  const out = [];
  if (donorsSheet && donorsSheet.rowCount !== (totals.donors || 0) + (totals.folded || 0))
    out.push({ sheet: donorsSheet.name, sentence: `${donorsSheet.name}: ${donorsSheet.rowCount.toLocaleString("en-US")} rows, but ${((totals.donors || 0) + (totals.folded || 0)).toLocaleString("en-US")} people and folds` });
  for (const ps of perSheet) if (!ps.balanced)
    out.push({ sheet: ps.sheet, sentence: `${ps.sheet}: ${ps.rowsInFile.toLocaleString("en-US")} rows, but ${(ps.imported + ps.refused + ps.routed).toLocaleString("en-US")} imported, refused or routed` });
  return out;
}
export function receiptDiffHeadline(mismatches = [], fmtVal = (c, v) => String(v)) {
  if (!mismatches.length) return null;
  return `Not finished: what we showed you and what was written differ. ${mismatches.map(c => `${c.label}: we showed you ${fmtVal(c, c.shown)}, and ${fmtVal(c, c.written)} ${Number(c.written) === 1 ? "was" : "were"} written`).join(". ")}. Undo puts everything back.`;
}

// "Mark them as the notes say" on every path that lists such notes (item 5,
// IMPORT-8's workbook rule). Free text never sets a flag on its own: each
// note's flags are read and listed, and set only when she ticks the box
// (answers.noteFlags = "apply"). The flag then rides the person's own column
// choices (p.comms), so the write and Undo treat it as a column's word.
const NOTE_FLAG_RES = [
  ["deceased", /\b(deceased|passed away|died)\b/i],
  ["doNotContact", /\b(do not|don'?t|no)\s+contact\b/i],
  ["doNotMail", /\b(no (more )?mail|stop (the )?mail|do not mail|don'?t mail)\b/i],
  ["doNotEmail", /\b(no (more )?e-?mails?|do not e-?mail|don'?t e-?mail|unsubscrib\w*)\b/i],
];
export const NOTE_FLAG_WORDS = { deceased: "deceased", doNotContact: "do not contact", doNotMail: "do not mail", doNotEmail: "do not email" };
export function noteFlagsOf(text) { return NOTE_FLAG_RES.filter(([, re]) => re.test(String(text || ""))).map(([k]) => k); }
export function applyNoteFlags(peopleList, answers = {}) {
  const apply = answers.noteFlags === "apply";
  const rows = [];
  for (const p of peopleList) for (const n of p.prefNotes || []) {
    const flags = noteFlagsOf(n.value);
    if (!flags.length) continue;
    rows.push({ name: p.name, note: n.value, header: n.header, line: n.line, sheet: n.sheet, flags });
    if (apply) for (const f of flags) if (!p.comms[f]) p.comms[f] = { header: `${n.header || "Notes"} (the note)`, fromNote: true };
  }
  if (!rows.length) return null;
  return { id: "noteFlags", kind: "noteFlags", optional: true, default: "list", answer: apply ? "apply" : "list", chosen: answers.noteFlags === "apply" || answers.noteFlags === "list",
    count: rows.length, rows: rows.slice(0, 50),
    text: `${plural(rows.length, "note reads", "notes read")} like ${[...new Set(rows.flatMap(r => r.flags))].map(f => NOTE_FLAG_WORDS[f]).join(", ")}: ${rows.slice(0, 3).map(r => `${r.name} ("${r.note.slice(0, 60)}")`).join(", ")}${rows.length > 3 ? " …" : ""}. ${apply ? "You chose to mark them as the notes say." : "Nothing was changed."}`,
    options: [{ key: "list", label: "Leave them as they are" }, { key: "apply", label: "Mark them as the notes say" }] };
}
