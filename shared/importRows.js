// shared/importRows.js · IMPORT-6. EVERY ROW IS ACCOUNTED FOR.
//
// The reader (shared/sheetRead.js) reads each row under a header into a
// person, a gift or a pledge, or sets it aside. On 1 Nov a beta org's list of
// 1,697 people previewed 1,380: the rows holding only a name were read as
// section labels and the preview hid labels, so 317 people vanished without a
// line. This module holds the ledger that makes that impossible to do quietly
// (rows read = written + set aside, and every row set aside has its line and
// its reason), and the small readers the row loop asks about one cell.
// Pure: no I/O, so the browser and the server walk one plan.
const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

// What a lone cell in a name column says when it is a section label or a
// page's chrome, not a person: a date or page number, a heading that ends in a
// colon, an alphabet divider, a month on its own (never April, May, June or
// August, which are first names too), a group's name ("Board members"), a footer.
export const SECTION_LABEL_RE = /\d|:\s*$|^[a-z]\.?$|^(jan(uary)?|feb(ruary)?|mar(ch)?|apr|jul(y)?|aug|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?$|^(the )?(board( of directors| members)?|staff|volunteers?|members|donors|sponsors|guests|families|individuals|businesses|companies|organi[sz]ations|foundations|churches|contacts|prospects|other|misc\.?|miscellaneous|inactive|deceased|confidential|continued|end of (list|report))$/i;
// A sentence typed under the table ("Note: Leonie pledged at the door, see the
// binder.") is a note: a name never holds a colon or runs to six words.
export const noteLine = t => /:/.test(s(t)) || s(t).split(/\s+/).length >= 6;

// A ZIP that lost its leading zero ("2134") in a state whose ZIPs start with 0.
// A ZIP+4 is written 12345-6789, however the file wrote it ("123456789",
// "12345 6789"), and one that lost its zero ("21341234") gets it back.
const ZERO_ZIP_STATES = new Set(["CT", "MA", "ME", "NH", "NJ", "PR", "RI", "VT", "VI", "GU"]);
export function fixZip(z, state) {
  if (!z) return z;
  const t = s(z).replace(/\.0+$/, "");
  const plus4 = t.match(/^(\d{5})[\s-]?(\d{4})$/);
  if (plus4) return `${plus4[1]}-${plus4[2]}`;
  const m = t.match(/^(\d{4})(?:[\s-]?(\d{4}))?$/);
  if (!m) return t;
  const st = s(state).toUpperCase();
  if (st && !ZERO_ZIP_STATES.has(st)) return t;
  return "0" + m[1] + (m[2] ? "-" + m[2] : "");
}

// Each non-blank row under a header is written (a person, a gift or pledge, a
// row merged into a person, a note on one) or set aside, once. A row in
// neither is `missing`, which tests/import6.test.js holds at zero on every
// import fixture. `setAside` is what the preview lists, line by line.
export function rowLedger({ tables, usable, aside, totals, notes, people, gifts, pledges, noteRows, fmt$ }) {
  const key = (sheet, line) => `${sheet}:${line}`;
  const out = new Map();   // key → { sheet, line, reason, who, cents }
  const asideAt = (sheet, line, reason, extra = {}) => { const k = key(sheet, line); if (!out.has(k)) out.set(k, { sheet, line, reason, ...extra }); };
  for (const a of aside) asideAt(a.sheet, a.line, a.reason, { who: a.who || null, cents: a.cents ?? null });
  for (const x of totals) asideAt(x.sheet, x.line, `a ${x.subtotal ? "subtotal" : "total"} row (${fmt$(x.statedCents)}), checked against the rows above it`);
  for (const x of notes) if (x.label) asideAt(x.sheet, x.line, x.noteLine ? `a note ("${x.text.slice(0, 80)}"), not a person or a gift` : `a section label ("${x.text}"), not a person or a gift`);
  const written = new Set();
  for (const p of people.values()) for (const l of p.lines) written.add(l);
  for (const g of [...gifts, ...pledges, ...noteRows]) written.add(key(g.sheet, g.line));
  let read = 0, wrote = 0;
  const missing = [], setAside = [];
  const used = new Set(usable);
  const leftOut = t => t.kind === "notes" ? "notes about people already on the list" : t.kind === "summary" ? "a summary of amounts with no names" : "a table with no names and no amounts";
  for (const t of tables) for (const b of t.body) {
    if (b.blank) continue;
    read++;
    const k = key(t.sheet, b.line);
    if (b.repeatHeader) setAside.push({ sheet: t.sheet, line: b.line, reason: "the header row again (a page break)" });
    else if (!used.has(t)) setAside.push({ sheet: t.sheet, line: b.line, reason: leftOut(t) });
    else if (out.has(k)) setAside.push(out.get(k));
    else if (written.has(k)) wrote++;
    else missing.push({ sheet: t.sheet, line: b.line, text: b.cells.map(s).filter(Boolean).slice(0, 6).join(" · ") });
  }
  return { read, written: wrote, setAside, missing, balanced: !missing.length && read === wrote + setAside.length };
}
