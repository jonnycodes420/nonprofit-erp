// shared/sheetGuesses.js · IMPORT-9. A MESSY FILE SAYS WHAT IT GUESSED.
//
// Muse's Walk B (5 Nov): "3/4/25" was read as March 4 without a word, a Date
// column that mixed "2025-03-04", "3/4/25" and "March 4, 2025" was read
// silently, and "$75.5" became $75.50 the same way. The reader
// (shared/sheetRead.js understand) now asks and tells, through this module:
//
//   · dateOrderFor  a date column whose cells could be month-first or
//                   day-first, and nothing in the column decides it, is ONE
//                   question for that column ("3/4/25: March 4 or 3 April?"),
//                   with a few of its cells read both ways. It blocks the
//                   import until it is answered (answers.dateOrder[key]).
//                   A column that decides it (a 13/3/25, or a 3/13/25) is read
//                   that way and says so; one holding both is asked too.
//   · mixedDates    a column that writes its dates more than one way lists the
//                   rows written differently from the rest, with what each
//                   was read as.
//   · amountTidier  every amount cell written in a way Steward had to tidy
//                   ("$75.5", "1,000", "75 USD", "1.5k") is counted, with the
//                   rows, so the preview says "We tidied 6 amounts."
//
// Pure: no I/O. The browser and the server read one plan.

const s = v => (v == null ? "" : String(v).trim());
const stripTime = t => t.replace(/\s+(utc|gmt)$/i, "").replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[APap]\.?[Mm]\.?)?$/, "");
// a cell whose day and month are both numbers, in either order
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// How a date cell is written: the families a person would call "a format".
export function dateShape(v) {
  if (v instanceof Date) return "date";
  if (typeof v === "number") return "serial";
  const t = stripTime(s(v));
  if (!t) return null;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(t) || /^\d{8}$/.test(t)) return "year first (2025-03-04)";
  if (/^\d{5}(\.\d+)?$/.test(t)) return "serial";
  if (NUMERIC.test(t)) return "numbers (3/4/25)";
  if (/[A-Za-z]{3,}/.test(t)) return "words (March 4, 2025)";
  return "other";
}

const longDay = iso => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return { month: `${MONTHS[m - 1]} ${d}, ${y}`, day: `${d} ${MONTHS[m - 1]} ${y}` };
};

// The order of a column's numeric dates: decided by the file, by her answer,
// or a question. `cells` = [{ line, raw }]; `answer` = "month" | "day" | undefined.
// `read(raw, dayFirst)` is the reader's own dateOf, so an example shows exactly
// what would be written.
export function dateOrderFor({ key, sheet, header, cells, answer, read, exportSystem = null }) {
  let firstBig = 0, secondBig = 0;
  const ambiguous = [];
  for (const c of cells) {
    const m = stripTime(s(c.raw)).match(NUMERIC);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) firstBig++;
    else if (b > 12 && a <= 12) secondBig++;
    else if (a <= 12 && b <= 12 && a !== b) ambiguous.push(c);
  }
  const chosen = answer === "day" || answer === "month" ? answer : null;
  if (chosen) {
    return { dayFirst: chosen === "day", by: "you", question: null,
      sentence: `You said the dates in ${header} are ${chosen === "day" ? "day first (3/4/25 is 3 April)" : "month first (3/4/25 is March 4)"}.` };
  }
  // the column decides it, one way only
  if (firstBig && !secondBig) return { dayFirst: true, by: "file", question: null,
    sentence: ambiguous.length ? `${header} is read day first, because ${firstBig === 1 ? "a date in it has" : `${firstBig} dates in it have`} a first number over 12.` : null };
  if (secondBig && !firstBig) return { dayFirst: false, by: "file", question: null,
    sentence: ambiguous.length ? `${header} is read month first, because ${secondBig === 1 ? "a date in it has" : `${secondBig} dates in it have`} a second number over 12.` : null };
  // nothing to decide: every numeric date reads the same either way
  if (!ambiguous.length && !(firstBig && secondBig)) return { dayFirst: false, by: "none", question: null, sentence: null };
  // another system's own export writes its dates one known way (month first), and says so
  if (exportSystem && !(firstBig && secondBig)) return { dayFirst: false, by: "export", question: null,
    sentence: `${header} is read month first (3/4/25 is March 4), the way ${exportSystem} exports write dates.` };
  // a question, never a guess
  const pool = ambiguous.length ? ambiguous : cells;
  const examples = [];
  for (const c of pool) {
    if (examples.length >= 4) break;
    const asMonth = longDay(read(c.raw, false)), asDay = longDay(read(c.raw, true));
    if (!asMonth || !asDay) continue;
    if (examples.some(x => x.raw === s(c.raw))) continue;
    examples.push({ line: c.line, raw: s(c.raw), month: asMonth.month, day: asDay.day });
  }
  const ex = examples[0];
  const both = firstBig && secondBig;
  const text = ex
    ? `${ex.raw}: ${ex.month.replace(/, \d{4}$/, "")} or ${ex.day.replace(/ \d{4}$/, "")}?`
    : `Are the dates in ${header} month first or day first?`;
  return {
    dayFirst: false, by: "question", sentence: null,
    question: {
      id: `dateOrder:${key}`, kind: "dateOrder", key, sheet, header, examples, count: ambiguous.length,
      text,
      hint: (both ? `${header} has dates written both ways (some with a first number over 12, some with a second). ` : "")
        + `${ambiguous.length.toLocaleString("en-US")} ${ambiguous.length === 1 ? "date" : "dates"} in ${header} could be read either way. Nothing is imported until you say which.`,
      options: [{ key: "month", label: ex ? `Month first (${ex.month})` : "Month first (3/4/25 is March 4)" },
                { key: "day", label: ex ? `Day first (${ex.day})` : "Day first (3/4/25 is 3 April)" }],
    },
  };
}

// The rows a column writes differently from the rest. `cells` = [{ line, raw }];
// `read(raw)` is the date as it will be written (ISO) or null.
export function mixedDates({ sheet, header, cells, read }) {
  const byShape = new Map();
  for (const c of cells) {
    const sh = dateShape(c.raw);
    if (!sh) continue;
    if (!byShape.has(sh)) byShape.set(sh, []);
    byShape.get(sh).push(c);
  }
  if (byShape.size < 2) return null;
  const ranked = [...byShape.entries()].sort((a, b) => b[1].length - a[1].length);
  const [mainShape, mainCells] = ranked[0];
  const rows = ranked.slice(1).flatMap(([shape, cs]) => cs.map(c => {
    const iso = read(c.raw);
    const ld = longDay(iso);
    return { sheet, line: c.line, raw: typeof c.raw === "number" ? String(c.raw) : s(c.raw), shape, read: iso || null, readAs: ld ? ld.month : null };
  })).sort((a, b) => a.line - b.line);
  const n = rows.length;
  return {
    sheet, header, mainShape, mainCount: mainCells.length, rows: rows.slice(0, 200), count: n,
    sentence: `${header} writes its dates more than one way: ${mainCells.length.toLocaleString("en-US")} like ${mainShape}, and ${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"} another way. `
      + `${n === 1 ? "That row was" : "Those rows were"} read as shown; check ${n === 1 ? "it" : "them"} before importing.`,
  };
}

// An amount cell Steward had to tidy before it could read it. A number from a
// spreadsheet, "75", "75.50", "$75" and "$75.50" are written plainly; anything
// else (a thousands comma, one decimal, a word, a k, brackets) was tidied.
const PLAIN_AMOUNT = /^-?\$?(\d+(\.\d{2})?|\d{1,3}(,\d{3})+\.\d{2})$/;   // "$1,250.00" is written plainly too
export function amountWasTidied(raw) {
  if (raw == null || typeof raw === "number" || raw instanceof Date) return false;
  const t = s(raw);
  if (!t) return false;
  return !PLAIN_AMOUNT.test(t);
}
const usd = cents => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function amountTidier() {
  const seen = new Map();   // "sheet:line" → { sheet, line, raw, cents }
  return {
    note(sheet, line, raw, value) {
      if (value == null || !amountWasTidied(raw)) return;
      const k = `${sheet}:${line}`;
      if (!seen.has(k)) seen.set(k, { sheet, line, raw: s(raw), cents: Math.round(value * 100), shown: usd(Math.round(value * 100)) });
    },
    // only the rows that became a gift or a pledge count
    result(kept) {
      const rows = [...seen.entries()].filter(([k]) => kept.has(k)).map(([, v]) => v).sort((a, b) => (a.sheet === b.sheet ? a.line - b.line : a.sheet < b.sheet ? -1 : 1));
      if (!rows.length) return null;
      const n = rows.length;
      return { count: n, rows: rows.slice(0, 500),
        sentence: `We tidied ${n.toLocaleString("en-US")} ${n === 1 ? "amount" : "amounts"}` + ` (for example "${rows[0].raw}" is ${rows[0].shown}).` };
    },
  };
}

// One date column, for the reader: the order (and its question) and the rows
// it wrote another way. `dateOf` is the reader's own; `rows` its data rows.
export function guessDates({ t, dateCol, rows, cellOf, dateOf, T, answers = {} }) {
  const header = dateCol.header || "the date column";
  const key = `${t.key}|${dateCol.index}`;
  const cells = rows.map(b => ({ line: b.line, raw: cellOf(t, b, dateCol) })).filter(c => s(c.raw) !== "");
  const year = answers.year || null;
  const order = dateOrderFor({ key, sheet: t.sheet, header, cells, answer: (answers.dateOrder || {})[key], exportSystem: (t.shape && t.shape.system) || null,
    read: (v, dayFirst) => dateOf(v, { serials: true, dayFirst, today: T, year }) });
  const mixed = mixedDates({ sheet: t.sheet, header, cells, read: v => dateOf(v, { serials: true, dayFirst: order.dayFirst, today: T, year }) });
  return { dayFirst: order.dayFirst, question: order.question,
    guess: { key, sheet: t.sheet, header: dateCol.header || null, order: order.question ? null : (order.dayFirst ? "day" : "month"), by: order.by, sentence: order.sentence, mixed } };
}
