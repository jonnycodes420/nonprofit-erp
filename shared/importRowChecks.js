// shared/importRowChecks.js · IMPORT-11. WHAT A ROW MUST CLEAR BEFORE IT IS A GIFT.
//
// From the 27 Nov stress test, each one asked of every gift row the one reader
// (shared/sheetRead.js) reads, and listed on the preview under its own heading:
//
//   · Over the cap. "$1,000,000,000.00" was accepted with no warning and took
//     over every report. A gift over $100,000,000 (money.js MAX_CENTS, the most
//     toCents reads) is set aside with its line and this file's one sentence.
//   · Exact copies. Ten rows that were exact copies of other rows (same ID,
//     name, amount, date, fund, note: every cell) were written as ten more
//     gifts. A copy is set aside by default ("skip the copies"); "import them
//     anyway" (answers.copies = "import") writes them, and either way they
//     are counted. The default needs a dated sheet: on a sheet with no date
//     column (an event night's cash gifts, the real-shaped dinner file's two
//     $25 rows) two identical rows can be two gifts, so they are listed and
//     imported unless she says "skip the copies" (answers.copies = "skip").
//   · Future-dated. A gift dated after the org's today is a scheduled gift
//     (TRUTH-6); the preview lists each one with its date.
//   · Far outside the pattern (item 3). The server knows the org's gifts and
//     lists those rows (server/imports/outliers.js); her "set them aside"
//     (answers.outliers = "skip") is honoured here, by row key.
// Pure, and the same in the browser and on the server.

// Kept equal to money.js MAX_CENTS (tests/import11.test.js checks it).
export const MAX_GIFT_CENTS = 100_000_000_00;
export const OVER_CAP_WORDS = "over $100,000,000, the most one gift can be in Steward";

const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

// One check per understand() call: it remembers the rows it has seen.
export function rowChecks(answers = {}) {
  const firstSeen = new Map();   // table + every cell → the line it was first on
  const outlierSkip = answers.outliers === "skip" ? new Set((answers.outlierRows || []).map(String)) : null;
  const copiesChoice = answers.copies === "import" || answers.copies === "skip" ? answers.copies : null;
  return {
    // Returns { aside: {reason,…} } to set the row aside, or { mark } for the gift.
    check({ t, b, cents, rowKey }) {
      if (Math.abs(cents) > MAX_GIFT_CENTS) return { aside: { reason: OVER_CAP_WORDS, overCap: true } };
      if (outlierSkip && outlierSkip.has(rowKey)) return { aside: { reason: "far above this person's giving and your org's largest gift: you set it aside", outlier: true } };
      const key = `${t.key}\u0001${(b.raw || b.cells).map(s).join("\u0001")}`;
      const first = firstSeen.get(key);
      if (first == null) { firstSeen.set(key, b.line); return { mark: {} }; }
      const skip = copiesChoice ? copiesChoice === "skip" : t.cols.some(c => c.role === "date");
      if (skip) return { aside: { reason: `an exact copy of row ${first}`, copyOf: first } };
      return { mark: { copyOf: first } };
    },
  };
}

// The preview's lists, read off what the reader decided. Every count comes
// from these rows, so the preview, the receipt and the check page agree.
export function rowCheckLists({ gifts = [], aside = [], today }) {
  const where = r => `${r.sheet === "Sheet1" ? "" : `${r.sheet} `}row ${r.line}`;
  const copiesAside = aside.filter(a => a.copyOf != null);
  const copiesIn = gifts.filter(g => g.copyOf != null);
  const copyRows = [...copiesAside, ...copiesIn].map(r => ({ sheet: r.sheet, line: r.line, copyOf: r.copyOf, cents: r.cents ?? null, imported: copiesIn.includes(r) }));
  const n = copyRows.length;
  const overCap = aside.filter(a => a.overCap).map(a => ({ sheet: a.sheet, line: a.line, who: a.who || null, cents: a.cents ?? null }));
  const future = gifts.filter(g => g.date && today && g.date > today).map(g => ({ sheet: g.sheet, line: g.line, who: g.who, date: g.date, cents: g.cents }));
  const outAside = aside.filter(a => a.outlier).length;
  return {
    outliersSetAside: outAside || null,
    copies: n ? {
      count: n, rows: copyRows, imported: copiesIn.length > 0,
      sentence: `${n === 1 ? "1 row is an exact copy" : `${n.toLocaleString("en-US")} rows are exact copies`} of another row: ${copyRows.slice(0, 12).map(r => `${where(r)} (copy of row ${r.copyOf})`).join(", ")}${n > 12 ? `, and ${n - 12} more` : ""}.`,
    } : null,
    overCap: overCap.length ? {
      count: overCap.length, rows: overCap,
      sentence: `${overCap.map(where).join(", ")}: ${OVER_CAP_WORDS}. Set aside.`,
    } : null,
    future: future.length ? {
      count: future.length, rows: future, from: future.reduce((a, g) => (a < g.date ? a : g.date), future[0].date),
      to: future.reduce((a, g) => (a > g.date ? a : g.date), future[0].date),
    } : null,
  };
}
