// server/onboard/verify.js · ONBOARD-1 Stage 2. THE VERIFY PAGE, AS PURE ARITHMETIC.
//
// "Your file: $268,425 · In Steward: $268,425 ✓". Every line is the file's own
// figure (taken at commit by the importer, never recomputed: the file is gone)
// beside what Steward holds for the batch, in cents. Every gap is explained by
// the rows that make it up: set aside (by reason), unreadable, duplicates the
// import folded. A gap the rows do not explain is said plainly, not rounded.
"use strict";

const n = v => Math.trunc(Number(v) || 0);
const cents = d => Math.round((Number(d) || 0) * 100);
const fmt = c => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const REASON_WORDS = {
  future_date: "dated in the future", future_dated: "dated in the future", future: "dated in the future",
  duplicate: "duplicates of a gift already in Steward", duplicate_external_id: "duplicates of a gift already in Steward",
  duplicate_in_file: "duplicates of another row in the file", zero_amount: "$0 rows", no_amount: "no amount",
  bad_amount: "an amount Steward could not read", bad_date: "a date Steward could not read", no_date: "no date",
  donor_info_only: "a person with no gift on the row", refund: "refunds", no_donor: "no name to put the gift on",
};
const reasonWords = r => REASON_WORDS[r] || String(r || "other").replace(/_/g, " ");

// The money equation, from the importer's own reconciliation (BUILD-77 3a):
// what was in the file = what Steward holds + what was set aside + unreadable.
const gapSentence = g => `${g.rows.toLocaleString("en-US")} ${g.rows === 1 ? "row" : "rows"} ${g.bucket}: ${g.words}, ${fmt(g.cents)}`
  + (g.lines && g.lines.length ? ` (line${g.lines.length === 1 ? "" : "s"} ${g.lines.join(", ")}${g.rows > g.lines.length ? ", …" : ""})` : "") + ".";

// The spreadsheet reader's own gaps (sheetVerify.js), already by row.
function moneyFootingFromGaps({ fileCents, gaps = [], heldCents }) {
  return finish(fileCents, gaps.map(g => ({ ...g, sentence: gapSentence(g) })), heldCents);
}

function moneyFooting({ reconciliation, refusedRows = [], heldCents }) {
  const R = reconciliation || {};
  const fileC = R.dollars && R.dollars.inFile != null ? cents(R.dollars.inFile) : null;
  const gaps = [];
  const linesBy = new Map();
  for (const r of refusedRows) {
    const k = String(r.reason || "other");
    if (!linesBy.has(k)) linesBy.set(k, []);
    if (r.line != null) linesBy.get(k).push(r.line);
  }
  for (const [bucket, box] of [["set aside", R.skippedReasons || {}], ["could not be read", R.erroredReasons || {}]]) {
    for (const [reason, v] of Object.entries(box)) {
      const c = cents(v && v.dollars), rows = n(v && v.rows);
      if (!rows && !c) continue;
      const lines = (linesBy.get(reason) || []).slice(0, 50);
      const g = { bucket, reason, words: reasonWords(reason), rows, cents: c, lines };
      gaps.push({ ...g, sentence: gapSentence(g) });
    }
  }
  return finish(fileC, gaps, heldCents);
}

function finish(fileC, gaps, heldCents) {
  const explainedC = gaps.reduce((s, g) => s + g.cents, 0);
  const unexplainedC = fileC == null ? null : fileC - heldCents - explainedC;
  return {
    fileCents: fileC, heldCents, explainedCents: explainedC, unexplainedCents: unexplainedC,
    matches: fileC != null && fileC === heldCents,
    foots: unexplainedC === 0,
    gaps,
    sentence: fileC == null
      ? `In Steward: ${fmt(heldCents)}. The file's own total was not recorded, so there is nothing to compare it with.`
      : fileC === heldCents
        ? `Your file: ${fmt(fileC)} · In Steward: ${fmt(heldCents)} ✓`
        : `Your file: ${fmt(fileC)} · In Steward: ${fmt(heldCents)}. ${unexplainedC === 0
            ? `The ${fmt(fileC - heldCents)} between them is the rows listed below, to the cent.`
            : `${fmt(Math.abs(unexplainedC))} of the difference is not explained by any row. Something is off: say so below.`}`,
  };
}

// File against Steward, line by line: people, gifts, each year, each fund.
function sideBySide(label, sentence, fileVal, heldVal, money = false) {
  const f = fileVal == null ? null : n(fileVal), h = n(heldVal);
  return { label, sentence, money, file: f, held: h, matches: f === h, difference: f == null ? null : h - f };
}
function lines({ file = {}, held = {} }) {
  const out = [
    sideBySide("People", "Every person the file names, counted once each, against the people this import holds.", file.people, held.people),
    sideBySide("Gifts", "Every gift row Steward read from the file, against the gifts this import wrote.", file.gifts, held.gifts),
    sideBySide("Dollars", "The sum of those gifts, to the cent.", file.cents, held.cents, true),
  ];
  const years = [...new Set([...(file.byYear || []), ...(held.byYear || [])].map(y => n(y.year)))].sort((a, b) => b - a);
  const fy = new Map((file.byYear || []).map(y => [n(y.year), n(y.cents)]));
  const hy = new Map((held.byYear || []).map(y => [n(y.year), n(y.cents)]));
  const byYear = years.map(y => sideBySide(String(y), `Every gift dated ${y}, to the cent.`, fy.get(y) || 0, hy.get(y) || 0, true));
  const key = s => String(s || "").trim().toLowerCase();
  const ff = new Map((file.byFund || []).map(f => [key(f.name), f]));
  const hf = new Map((held.byFund || []).map(f => [key(f.name), f]));
  const funds = [...new Set([...ff.keys(), ...hf.keys()])].sort().map(k => {
    const a = ff.get(k), b = hf.get(k);
    return { ...sideBySide((a || b).name || "(no fund named)", "Every gift to this fund, to the cent.", a ? a.cents : 0, b ? b.cents : 0, true),
      fileGifts: a ? n(a.gifts) : 0, heldGifts: b ? n(b.gifts) : 0 };
  });
  return { lines: out, byYear, funds };
}

// The 10-donor spot check: the file's rows for each, beside what Steward holds.
function spotCheck({ fileSpot = [], heldByKey = new Map() }) {
  return fileSpot.slice(0, 10).map(s => {
    const rows = s.rows || [];
    const fileC = rows.reduce((t, r) => t + n(r.cents), 0);
    const fileLast = rows.map(r => r.date).filter(Boolean).sort().pop() || null;
    const h = heldByKey.get(String(s.key || "").toLowerCase()) || null;
    const heldC = h ? n(h.cents) : 0, heldCount = h ? n(h.gifts) : 0, heldLast = h ? h.last || null : null;
    return {
      name: s.name, key: s.key, fileRows: rows,
      file: { cents: fileC, gifts: rows.length, last: fileLast },
      held: h ? { cents: heldC, gifts: heldCount, last: heldLast, donorId: h.id } : null,
      matches: !!h && heldC === fileC && heldCount === rows.length && (heldLast || null) === fileLast,
    };
  });
}

module.exports = { moneyFooting, moneyFootingFromGaps, lines, spotCheck, reasonWords, fmt };
