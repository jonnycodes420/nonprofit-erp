// shared/suggestionGuard.js — FIX-1. A SUGGESTION MAY ONLY SAY WHAT THE RECORD SAYS.
//
// The walk (25 September) opened the Sunrise Foundation's profile and the
// Suggested panel told her to "reach out to Angela Wu", to mention "68%
// participant retention" and "three youth advancing to paid apprenticeships".
// None of it is on the record. It also rendered raw **markdown**.
//
// A prompt that says "use only the data" is a request. This is a VALIDATOR,
// on the BUILD-99 brief rule: every sentence that reaches the screen cites a
// row Steward actually holds, and a sentence that names a person, states a
// number or makes a claim the record does not carry is REFUSED before it
// reaches the screen — and COUNTED, because "Steward left three lines out"
// said out loud is honest and silence is not.
//
// What counts as a fact, and how it is checked:
//   · A NUMBER (money, a percent, a bare figure, a number word) must equal a
//     value on the record: an amount, a count, a year, a day of a month.
//   · A NAME (a capitalised word that is not the first word of the sentence)
//     must be one the record carries: the donor, a contact on the record, the
//     organisation itself, a fund or campaign on a row, a month or a day.
//   · CAPACITY LANGUAGE ("net worth", "good for a lead gift") is refused
//     outright — it is a claim about a person's money with no row behind it.
//
// Pure: no DB, no network, no clock, no JSX.

// ── PLAIN TEXT ─────────────────────────────────────────────────────────────
// No raw markdown ever reaches a screen. Emphasis, headings, bullets, code and
// links become the words they wrapped.
export function plainText(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?|```/g, ""))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, "$1$2")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ── SENTENCES ──────────────────────────────────────────────────────────────
export function sentencesOf(text) {
  return plainText(text)
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'(“$])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul",
  "aug", "sep", "sept", "oct", "nov", "dec"];
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
// Words a sentence may capitalise that are not names of anybody.
const ALWAYS_OK = new Set([...MONTHS, ...DAYS, "i", "steward", "mr", "mrs", "ms", "dr",
  "thank", "thanks", "dear", "ok", "usd"]);

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, hundred: 100, dozen: 12, dozens: 12 };

export const CAPACITY_PHRASES = [
  /\bnet worth\b/i, /\bcapacity\b/i, /\bwealth(y)?\b/i, /\blead gift\b/i, /\bgood for\b/i,
  /\bcould (give|afford)\b/i, /\bcan afford\b/i, /\bdeep pockets\b/i, /\bassets?\b/i,
];

const lc = s => String(s ?? "").toLowerCase();
const tokens = s => lc(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

// Every number on the record, and every word of every name on it.
function groundOf(record) {
  const values = new Set();
  const years = new Set(), days = new Set();
  const words = new Set();
  const addNum = v => { const n = Number(v); if (Number.isFinite(n)) { values.add(n); values.add(Math.round(n * 100) / 100); } };
  const addDate = d => {
    const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    // A date grounds a YEAR and a DAY OF A MONTH, and only when the sentence
    // uses them as such — its month number never grounds "three youth".
    if (m) { years.add(+m[1]); days.add(+m[3]); }
  };
  const addWords = s => tokens(s).forEach(w => words.add(w));
  const d = (record && record.donor) || {};
  for (const k of ["total_giving", "gift_count", "last_gift_amount", "first_gift_amount", "largest_gift",
                   "total", "gifts", "lastAmount"]) if (d[k] != null) addNum(d[k]);
  for (const k of ["last_gift_date", "first_gift_date", "lastGift"]) addDate(d[k]);
  for (const k of ["name", "contact_name", "email"]) if (d[k]) addWords(d[k]);
  if (record && record.orgName) addWords(record.orgName);
  for (const n of (record && record.names) || []) addWords(n);
  for (const r of (record && record.rows) || []) {
    for (const k of ["amount", "count", "value"]) if (r[k] != null) addNum(r[k]);
    addDate(r.date);
    for (const k of ["fund", "campaign", "name", "label", "stage", "type"]) if (r[k]) addWords(r[k]);
  }
  return { values, years, days, words };
}

// The facts one sentence states.
export function factsIn(sentence) {
  const s = String(sentence || "");
  const numbers = [];
  let rest = s;
  const MON = "(?:" + MONTHS.join("|") + ")";
  rest = rest.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b|\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"), (m, a, b) => {
    numbers.push({ raw: m.trim(), value: Number(a || b), kind: "day" }); return " ";
  });
  rest = rest.replace(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|m)?\b/gi, (m, a, c, u) => {
    let v = Number(a.replace(/,/g, "")) + (c ? Number(c.padEnd(2, "0")) / 100 : 0);
    if (u && /k/i.test(u)) v *= 1000;
    if (u && /m/i.test(u)) v *= 1000000;
    numbers.push({ raw: m.trim(), value: v, kind: "money" });
    return " ";
  });
  rest = rest.replace(/(\d+(?:\.\d+)?)\s*(%|per ?cent)/gi, (m, a) => {
    numbers.push({ raw: m.trim(), value: Number(a), kind: "percent" }); return " ";
  });
  rest = rest.replace(/\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(st|nd|rd|th)?\b/g, (m, a) => {
    numbers.push({ raw: m.trim(), value: Number(a.replace(/,/g, "")), kind: "number" }); return " ";
  });
  for (const w of tokens(rest)) if (w in NUMBER_WORDS) numbers.push({ raw: w, value: NUMBER_WORDS[w], kind: "word" });

  // Capitalised words that are not the first word of the sentence, grouped
  // into runs: "Angela Wu" is one name.
  const words = s.replace(/[^A-Za-z'’\- ]+/g, " | ").split(/\s+/).filter(Boolean);
  const names = [];
  let run = [];
  let first = true;
  const flush = () => { if (run.length) names.push(run.join(" ")); run = []; };
  for (const w of words) {
    if (w === "|") { flush(); first = false; continue; }
    const clean = w.replace(/^['’\-]+|['’\-]+$/g, "");
    const isCap = /^[A-Z][a-zA-Z'’\-]*$/.test(clean) && !/^[A-Z]{2,}$/.test(clean);
    if (isCap && !first) run.push(clean);
    else flush();
    first = false;
  }
  flush();
  const capacity = CAPACITY_PHRASES.filter(re => re.test(s)).map(re => (s.match(re) || [""])[0]);
  return { numbers, names, capacity };
}

// Which rows stand behind a sentence: the rows whose number or name it states.
function supportingRows(sentence, record, facts) {
  const cites = new Set();
  const rows = (record && record.rows) || [];
  const d = (record && record.donor) || {};
  for (const r of rows) {
    const rv = [r.amount, r.count, r.value].map(Number).filter(Number.isFinite);
    if (facts.numbers.some(n => rv.includes(n.value))) cites.add(r.id);
    const rw = [r.fund, r.campaign, r.name, r.label].filter(Boolean);
    if (rw.some(x => facts.names.some(n => lc(n) === lc(x)))) cites.add(r.id);
  }
  // Every sentence is ABOUT this donor; a sentence with no row of its own
  // cites the person row, which is the record it was written from.
  if (!cites.size && d.id) cites.add(d.id);
  return [...cites];
}

// guardSuggestion(text | [{text, cites}], record)
//   → { kept: [{ text, cites }], dropped, reasons: [string] }
export function guardSuggestion(input, record = {}) {
  const ground = groundOf(record);
  const known = new Set([...((record && record.rows) || []).map(r => String(r.id)),
                         ...(record && record.donor && record.donor.id ? [String(record.donor.id)] : [])]);
  const items = Array.isArray(input)
    ? input.flatMap(it => sentencesOf(it && (it.text != null ? it.text : it)).map(t => ({ text: t, cites: (it && it.cites) || [] })))
    : sentencesOf(input).map(t => ({ text: t, cites: [] }));

  const kept = [];
  const reasons = [];
  let dropped = 0;
  for (const it of items) {
    const f = factsIn(it.text);
    const why = [];
    for (const n of f.numbers) {
      const ok = n.kind === "day" ? ground.days.has(n.value)
        : ground.values.has(n.value) || ground.values.has(Math.round(n.value * 100) / 100)
          || (n.kind === "number" && n.value >= 1900 && n.value <= 2100 && ground.years.has(n.value));
      if (!ok) why.push(`${n.raw} is not on the record`);
    }
    for (const name of f.names) {
      const ts = tokens(name);
      if (!ts.every(t => ground.words.has(t) || ALWAYS_OK.has(t))) why.push(`${name} is not on the record`);
    }
    for (const c of f.capacity) why.push(`"${c}" is a claim about money nobody recorded`);
    // A citation the model offers must be a row Steward handed over — a
    // reference that looks checkable and is not is worse than none.
    const offered = (it.cites || []).map(String);
    const invented = offered.filter(c => !known.has(c));
    if (invented.length) why.push(`cites a row Steward never read (${invented[0]})`);
    if (why.length) { dropped++; reasons.push(why[0]); continue; }
    const cites = [...new Set([...offered, ...supportingRows(it.text, record, f)])];
    if (!cites.length) { dropped++; reasons.push("cites no row"); continue; }
    kept.push({ text: it.text, cites });
  }
  return { kept, dropped, reasons };
}

// The line the panel says about what it left out. Never silent.
export function droppedLine(dropped) {
  if (!dropped) return "";
  return `${dropped} ${dropped === 1 ? "line was" : "lines were"} left out because ${dropped === 1 ? "it" : "they"} said something that is not on this record.`;
}
