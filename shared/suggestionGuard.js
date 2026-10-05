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
// reaches the screen.
//
// HOTFIX-1 — A REFUSAL IS OURS, NOT HERS. FIX-1 printed "3 lines were left
// out because they said something that is not on this record" under the
// panel, on the reasoning that silence is not honest. On the screen it read
// as Steward telling her about its own plumbing: she cannot see the lines,
// cannot judge them and cannot act on the count. The refusals go to the
// CONSOLE, where the person who can act on them works. What she sees is what
// survived — and when nothing survives, nothing.
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

// FIX-3 finding 11 — CLAIMS. The walk's Sunrise suggestion spoke of
// "underserved NYC youth" and "the cycle deadline approaching". Neither is a
// name (one is lowercase, "NYC" is all capitals) nor a number, so neither was
// ever checked. A claim about WHO the work serves, or a DATE THE WORLD SET
// (a deadline, a cycle, a match, a gala), must be on the record like a name:
// every word of the term appears somewhere Steward handed over, or the line
// is refused and counted. An acronym is a name ("NYC" must be on the record).
export const CLAIM_TERMS = [
  // who is served
  "youth", "young", "kids", "children", "child", "students", "teens", "teenagers", "families",
  "seniors", "elderly", "veterans", "underserved", "under-served", "low-income", "disadvantaged",
  "at-risk", "homeless", "refugees", "immigrants", "patients", "girls", "boys", "orphans",
  // a date the world set
  "deadline", "deadlines", "cycle", "anniversary", "gala", "match", "matching", "expires",
  "expiring", "closes", "closing",
];

const lc = s => String(s ?? "").toLowerCase();
const tokens = s => lc(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

// ── TIMING IS AHEAD, NEVER BEHIND ──────────────────────────────────────────
// HOTFIX-1. On 27 September the Sunrise panel said "mid-August". Every word
// of it was on the record — August is a month, and a month is always allowed
// — so the validator kept it, and she was told to do something five weeks
// ago. A suggestion is an instruction about what to do NEXT: a date it names
// has to still be ahead of today.
//
// Only a sentence in the FORWARD voice is checked. A sentence reporting the
// past ("Their last gift was in March") is history, and its facts are already
// checked against the record above. `today` comes from the caller — this
// module still has no clock of its own.
// "last week" is deliberately NOT here: as history it always arrives with a
// past-tense verb ("their last gift was last week"), and on its own in an
// instruction it is exactly the fault this rule exists to catch.
const PAST_VOICE = /\b(was|were|had|gave|given|giving|received|since|ago|lapsed|renewed|has not|have not|hasn't|haven't|last gift)\b/i;
const PART_OF_MONTH = { early: 5, mid: 15, late: 25 };
const MONTH_NUMBER = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3,
  apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const BEHIND_WORDS = /\b(yesterday|last\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const lastDayOf = (mo, y) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
  31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];

// pastTiming(sentence, today) → the reason it is behind, or null.
// A month with no day is read as its LAST day, so "September" on the 27th of
// September is still ahead; "mid-August" is the 15th and is not.
export function pastTiming(sentence, today) {
  const s = String(sentence || "");
  const t = parts(today);
  if (!t) return null;                                 // no clock, no rule
  if (PAST_VOICE.test(s)) return null;
  const behind = s.match(BEHIND_WORDS);
  if (behind) return `"${behind[0]}" is in the past`;
  const MON = "(?:" + MONTHS.join("|") + ")";
  const re = new RegExp(`(?:\\b(early|mid|late)[\\s-]+)?\\b(${MON})\\.?\\s*(\\d{1,2})?(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "gi");
  let m;
  while ((m = re.exec(s))) {
    if (/\bnext\s+$/i.test(s.slice(0, m.index))) continue;   // "next March" is ahead
    const mo = MONTH_NUMBER[m[2].toLowerCase()];
    const year = m[4] ? Number(m[4]) : t.y;
    const day = m[3] ? Number(m[3])
      : (m[1] ? PART_OF_MONTH[m[1].toLowerCase()] : lastDayOf(mo, year));
    if (!(day >= 1 && day <= lastDayOf(mo, year))) continue;
    if (year * 10000 + mo * 100 + day < t.y * 10000 + t.mo * 100 + t.d)
      return `"${m[0].trim()}" is in the past`;
  }
  return null;
}

function parts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value == null ? "" : value));
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

// ── A SUGGESTION MAY NOT SAY NOTHING IS OPEN WHEN SOMETHING IS ─────────────
// HOTFIX-1. The record knows what is open; the model is guessing. When the
// caller hands over open work, a sentence claiming there is none is refused
// like any other statement the record contradicts.
const NOTHING_OPEN = /\b(nothing (?:is )?open|no open (?:step|steps|item|items|proposal|proposals|follow[- ]?ups?|threads?)|nothing (?:is )?outstanding|nothing to follow up|no follow[- ]?up is open|there is nothing (?:to do|pending))\b/i;

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
  // Her own notes on the person are the record too (FIX-3 finding 11): a
  // claim they carry is grounded; a claim they do not is refused.
  if (d.notes) addWords(d.notes);
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
  // Acronyms (two or more capitals): the capitalised-word pass above skips
  // them, so a place like "NYC" was never looked at.
  const acronyms = [...new Set((s.match(/\b[A-Z]{2,}\b/g) || []).filter(a => !ALWAYS_OK.has(a.toLowerCase())))];
  const claims = CLAIM_TERMS.filter(t => new RegExp(`(^|[^a-z-])${t.replace(/-/g, "[- ]")}($|[^a-z-])`, "i").test(s));
  return { numbers, names, capacity, acronyms, claims };
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

// A claim term is grounded when every word of it (or its singular/plural)
// is a word on the record.
const variants = w => [w, w + "s", w.replace(/s$/, ""), w === "child" ? "children" : w === "children" ? "child" : w];
function claimGrounded(term, ground) {
  return tokens(term).every(w => variants(w).some(v => ground.words.has(v)));
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
    for (const a of f.acronyms) if (!ground.words.has(a.toLowerCase())) why.push(`${a} is not on the record`);
    for (const c of f.claims) if (!claimGrounded(c, ground)) why.push(`"${c}" is not on the record`);
    for (const c of f.capacity) why.push(`"${c}" is a claim about money nobody recorded`);
    const late = pastTiming(it.text, record && record.today);
    if (late) why.push(late);
    if (((record && record.openItems) || []).length && NOTHING_OPEN.test(it.text))
      why.push("says nothing is open while the record holds open work");
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

// What a refusal says — to the LOG, never to the screen (HOTFIX-1). The
// caller writes this line to the console so a refused suggestion can still be
// read back by whoever is fixing the prompt.
export function dropLog(dropped, reasons = []) {
  if (!dropped) return "";
  return `[suggestion] ${dropped} ${dropped === 1 ? "line" : "lines"} left out: ${reasons.filter(Boolean).join(" · ")}`;
}

// ── FIX-27 Part 7 · A DRAFT MAY ONLY CLAIM WHAT THE RECORD HOLDS ───────────
// The walk (3 Oct): an AI-drafted thank-you in Communications said "I
// recorded a short video" with a watch link, for a video nobody recorded. Sent,
// the donor gets a bad link. A drafted message is checked as a whole before
// anyone sees it, and a claim the record does not carry fails it:
//   · A VIDEO is mentioned only when one exists for that person and is ready,
//     and then only with its own link.
//   · A LINK is one Steward handed over (the video's, the org's own pages).
//   · A GIFT AMOUNT is one of their own amounts. A merge tag is not a claim.
//   · A DATE (a day of a month) is one on their record.
//   · A MEETING or a conversation ("when we met", "our call") is one that is
//     logged for them.
//   · An EVENT the draft names is one of the organisation's events.
// The caller swaps a failed draft for its template sentence: guardDraft never
// edits the model's words into something else.
//
// record: { donor, rows, video: { ready, url } | null, links: [url],
//           meetings: [{ date, type }], events: [name], orgName, today }
const VIDEO_WORDS = /\b(video|videos|recorded|recording|filmed|film|clip|vlog)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const MEETING_WORDS = /\b(when we met|we met|our meeting|our conversation|our call|our chat|when we spoke|we spoke|spoke with you|talking with you|talked with you|our visit|your visit|visiting you|over coffee|over lunch|at lunch)\b/i;
const EVENT_WORDS = /\b(gala|dinner|reception|luncheon|breakfast|auction|tournament|5k|fun run|open house|tour|concert|festival|ceremony|celebration|fundraiser|event)\b/i;
const MERGE_TAG = /\{\{\s*[a-z_]+\s*\}\}/gi;
// A sum is a claim about THEIR money when the sentence is about giving.
const GIFT_WORDS = /\b(gift|gifts|gave|give|given|giving|donat\w*|contribut\w*|pledg\w*|support(ed)? us with)\b/i;

export function guardDraft(text, record = {}) {
  const raw = String(text == null ? "" : text);
  const bare = plainText(raw.replace(/<[^>]+>/g, " ")).replace(MERGE_TAG, " ");
  const reasons = [];
  const video = record.video && record.video.ready && record.video.url ? record.video : null;
  const links = new Set([...(record.links || []), ...(video ? [video.url] : [])].map(u => String(u).replace(/[.,;:!?]+$/, "")));
  const urls = (raw.match(URL_RE) || []).map(u => u.replace(/[.,;:!?]+$/, ""));
  if (VIDEO_WORDS.test(bare) && !video) reasons.push("mentions a video, and no video thank-you is ready for them");
  if (VIDEO_WORDS.test(bare) && video && !urls.includes(video.url)) reasons.push("mentions their video without its own link");
  for (const u of urls) if (!links.has(u)) { reasons.push(`a link Steward did not give it (${u.slice(0, 60)})`); break; }
  if (/\b(watch|view|see) (it|the video|this|here|below)\b|\bclick here\b/i.test(bare) && !urls.length && !video) reasons.push("points at a link that is not there");
  const ground = groundOf(record);
  for (const s of sentencesOf(bare)) {
    for (const n of factsIn(s).numbers) {
      if (n.kind === "money" && GIFT_WORDS.test(s) && !(ground.values.has(n.value) || ground.values.has(Math.round(n.value * 100) / 100))) reasons.push(`${n.raw} is not one of their amounts`);
      if (n.kind === "day" && !ground.days.has(n.value)) reasons.push(`${n.raw} is not a date on their record`);
    }
  }
  if (MEETING_WORDS.test(bare) && !((record.meetings || []).length)) reasons.push("speaks of a meeting or a conversation nobody logged");
  const ev = bare.match(EVENT_WORDS);
  if (ev) {
    const known = (record.events || []).map(e => tokens(e));
    const word = ev[0].toLowerCase();
    const named = known.some(ts => ts.includes(word) || ts.some(t => variants(word).includes(t)));
    if (!named && !(record.orgName && tokens(record.orgName).includes(word))) reasons.push(`speaks of a ${word} that is not one of the organisation's events`);
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}
