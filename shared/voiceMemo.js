// shared/voiceMemo.js · VOICE-1. TELL STEWARD WHAT HAPPENED.
//
// She talks for thirty seconds after a donor lunch. The model reads the words
// once (MEMO_TOOL) and says what it heard; THIS FILE decides what any of it is
// allowed to become. The model never supplies a fact the record keeps:
//   · a date is counted here from her own words ("circle back in March"),
//   · an amount is read here from her own words and must be in the quote,
//   · a fund is matched here by whole words against the org's own funds,
//   · a person is matched by the route, in code, never by the model,
//   · a sensitive detail is screened here as well as by the model, and a
//     sentence that trips the screen is held back from everything filed.
// Every item quotes the memo; an item whose quote is not in the memo is
// dropped (FIX-12's chip rule, shared/meetingNote.js).
//
// Pure: no DB, no network, no clock (today is passed in), no JSX.

import { dueFromText, parseAmount } from "./meetingNote.js";

// ── WHAT THE MODEL RETURNS ─────────────────────────────────────────────────
// Strict tool: every field a string ("" when absent), every object closed, no
// unions (FIX-29's limits).
const S = { type: "string" };
const obj = (props) => ({ type: "object", additionalProperties: false, properties: props, required: Object.keys(props) });
export const MEMO_TOOL = {
  name: "memo_actions",
  description: "Say what this memo says happened and what should follow. Every item quotes the memo.",
  strict: true,
  input_schema: obj({
    how: { type: "string", description: "What the conversation was: lunch, coffee, call, visit, meeting, event or email. \"\" if the memo does not say." },
    when: { type: "string", description: "Her words for when it happened (\"yesterday\", \"this morning\"), or \"\"." },
    summary: { type: "string", description: "One or two plain sentences saying what happened, in her words where possible. No health, family-crisis, money-trouble or child details." },
    people: { type: "array", description: "The names of the people she met or talked with, as she said them. Not people only mentioned.", items: S },
    follow_ups: { type: "array", items: obj({ label: S, when: S, quote: S }) },
    interests: { type: "array", items: obj({ words: S, quote: S }) },
    email: obj({ subject: S, body: S }),
    money: { type: "array", items: obj({ kind: { type: "string", description: "gift (already given), pledge (promised) or interest (thinking about giving)" }, fund_words: S, quote: S }) },
    contact: { type: "array", items: obj({ field: { type: "string", description: "email, phone or address" }, value: S, quote: S }) },
    sensitive: { type: "array", items: obj({ category: { type: "string", description: "health, family, money_trouble or child" }, neutral: S, quote: S }) },
  }),
};

export const MEMO_SYSTEM = [
  "You read a short memo a fundraiser spoke or typed straight after talking with a donor, and say what it records.",
  "Use only what the memo says. Quote the memo's exact words for every follow-up, interest, amount, contact change and sensitive detail.",
  "follow_ups: each thing she said to do next, with her words for when (\"in March\", \"next week\") in `when`.",
  "interests: a fund, project or programme the donor is interested in, in the donor's or her words.",
  "email: a short, warm draft from her to the donor, thanking them for the time and mentioning what they talked about. Subject and body \"\" if a note would be odd. Never promise anything, never mention an amount.",
  "money: every dollar amount, with whether it was given, promised, or is an interest. Leave it out if there is no amount.",
  "contact: only a new email, phone or address she said out loud.",
  "sensitive: anything about health, a death or a family crisis, money troubles, or a child. `neutral` says it in a few discreet words (\"Mentioned a family health matter\"), with no diagnosis, no names and no detail. These must NOT appear in summary, follow_ups, interests or email.",
  "You never send anything and never record money: a person reads every item before it counts.",
].join("\n");

export function buildMemoPrompt(transcript, { people = [], today, funds = [] } = {}) {
  const lines = [
    `Today is ${today}.`,
    people.length ? `People on file this memo names: ${people.map(p => p.name).join("; ")}.` : "Nobody on file is named yet.",
    funds.length ? `The organization's funds and campaigns: ${funds.map(f => f.name).join("; ")}.` : "",
    "", "The memo:", String(transcript || "").slice(0, 4000),
  ].filter(x => x !== "");
  return { system: MEMO_SYSTEM, messages: [{ role: "user", content: lines.join("\n") }] };
}

// ── THE SENSITIVE SCREEN ───────────────────────────────────────────────────
// The model is asked to flag these; this screen does not trust it to. A
// sentence of the memo that trips it is held back from the summary, the
// steps, the email and the memo as filed, whatever the model did with it.
const SENSITIVE = [
  ["health", /\b(cancer|chemo\w*|tumou?r|diagnos\w+|surgery|hospital\w*|hospice|illness|sick|dementia|alzheimer\w*|stroke|heart attack|pregnan\w+|miscarr\w+|therapy|depress\w+|anxiety|rehab|disease|disabilit\w+|recovering)\b/i],
  ["family", /\b(divorc\w+|separated|passed away|died|death|funeral|widow\w*|grie\w+|bereave\w+|custody|affair|estranged)\b/i],
  ["money_trouble", /\b(laid off|lost (?:his|her|their) job|unemploy\w+|bankrupt\w*|foreclos\w+|in debt|debts?|struggling financially|money troubles?|can'?t afford|cannot afford|evict\w+)\b/i],
  ["child", /\b(?:(?:her|his|their|my|our)\s+(?:son|daughter|child|children|kids?|baby|toddler|teenager|boy|girl)s?|grandsons?|granddaughters?|grandchild\w*|stepsons?|stepdaughters?)\b/i],
];
export const SENSITIVE_CATEGORIES = SENSITIVE.map(([k]) => k);
const NEUTRAL = {
  health: "Mentioned a health matter.",
  family: "Mentioned a family matter.",
  money_trouble: "Mentioned a personal money matter.",
  child: "Mentioned something about a child in the family.",
};
export function sensitiveCategory(text) {
  const t = String(text || "");
  for (const [k, re] of SENSITIVE) if (re.test(t)) return k;
  return null;
}
// Sentences, split where she paused. A memo with no full stops is one sentence.
export function sentences(text) {
  return String(text || "").split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}
// The text with every sensitive sentence taken out, and what was taken.
export function stripSensitive(text) {
  const kept = [], held = [];
  for (const s of sentences(text)) (sensitiveCategory(s) ? held : kept).push(s);
  return { text: kept.join(" "), held };
}
export const HELD_MARK = "[A personal detail is held back for your yes.]";

// ── DATES FROM HER WORDS ───────────────────────────────────────────────────
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = MONTHS.map(m => m.slice(0, 3) + (m.length > 3 ? `(?:${m.slice(3)})?` : "")).join("|");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const civil = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function parts(ymd) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "")); return m ? [+m[1], +m[2], +m[3]] : null; }
function addDays(ymd, n) { const p = parts(ymd); if (!p) return null; const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return civil(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
function weekday(ymd) { const p = parts(ymd); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }

// A follow-up's date: the next day she named, never today or before it.
// Returns { due, exact }: exact false means she named no time and Steward
// proposes two weeks, and says so.
export function dueFromMemo(words, today) {
  const t = String(words || "").toLowerCase();
  if (!parts(today)) return { due: null, exact: false };
  const rel = dueFromText(t, today);
  if (rel) return { due: rel, exact: true };
  const m = t.match(new RegExp(`\\b(early|mid|middle of|late|end of|the end of|beginning of|start of)?\\s*(?:-\\s*)?(${MON_RE})\\b`));
  if (m) {
    const mi = MONTHS.findIndex(x => m[2].startsWith(x.slice(0, 3)));
    // "may" is also a verb: only as a month when it is plainly one.
    if (mi === 4 && !/\b(in|by|early|mid|late|end of|start of|beginning of|until)\s+may\b/.test(t)) { /* not a month */ }
    else {
      const q = m[1] || "";
      const day = /mid|middle/.test(q) ? 15 : /late|end/.test(q) ? 25 : 1;
      const [y, mo] = parts(today);
      let year = y;
      if (mi + 1 < mo || (mi + 1 === mo && day <= parts(today)[2])) year = y + 1;
      return { due: civil(year, mi + 1, day), exact: true };
    }
  }
  const w = t.match(/\b(next|on|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (w) {
    const want = WEEKDAYS.indexOf(w[2]);
    let n = (want - weekday(today) + 7) % 7 || 7;
    if (w[1] === "next" && n < 7) n += 0;
    return { due: addDays(today, n), exact: true };
  }
  if (/\b(soon|shortly)\b/.test(t)) return { due: addDays(today, 7), exact: true };
  return { due: addDays(today, 14), exact: false };
}

// When the conversation happened: today unless she said otherwise. Never in
// the future: a conversation that has not happened is a next step.
export function conversationDate(words, today) {
  const t = String(words || "").toLowerCase();
  if (/\byesterday\b/.test(t)) return addDays(today, -1);
  const m = t.match(/\b(?:on|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) { const back = (weekday(today) - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7; return addDays(today, -back); }
  const d = t.match(/\b(\d+|two|three|four|five|six)\s+days?\s+ago\b/);
  if (d) { const n = Number(d[1]) || { two: 2, three: 3, four: 4, five: 5, six: 6 }[d[1]]; return addDays(today, -n); }
  if (/\blast week\b/.test(t)) return addDays(today, -7);
  return today;
}

// ── WHAT KIND OF CONVERSATION ──────────────────────────────────────────────
// The timeline keeps three kinds (call, meeting, email); a lunch is a meeting
// whose line says "Lunch".
const HOW = { lunch: "meeting", dinner: "meeting", breakfast: "meeting", coffee: "meeting", visit: "meeting", tour: "meeting",
  meeting: "meeting", event: "meeting", call: "call", phone: "call", email: "email" };
export function conversationKind(how, transcript) {
  const said = String(how || "").toLowerCase().trim();
  const fromModel = Object.keys(HOW).find(k => said.includes(k));
  const fromWords = Object.keys(HOW).find(k => new RegExp(`\\b${k}\\b`, "i").test(String(transcript || "")));
  const key = fromModel || fromWords || "meeting";
  return { kind: HOW[key], how: ["phone"].includes(key) ? "call" : key };
}
export const HOW_LABEL = { lunch: "Lunch", dinner: "Dinner", breakfast: "Breakfast", coffee: "Coffee", visit: "Visit", tour: "Tour",
  meeting: "Meeting", event: "Event", call: "Call", email: "Email" };

// ── FUNDS, BY WHOLE WORDS ──────────────────────────────────────────────────
const FUND_STOP = new Set(["the", "a", "an", "new", "fund", "funds", "campaign", "our", "for", "of", "to", "and", "project", "program", "programme", "appeal", "give", "giving", "wants", "want"]);
const words = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w && !FUND_STOP.has(w));
export function matchFund(phrase, funds = []) {
  const said = new Set(words(phrase));
  if (!said.size) return null;
  let best = null, bestScore = 0;
  for (const f of funds) {
    const fw = words(f.name);
    if (!fw.length) continue;
    const hit = fw.filter(w => said.has(w)).length;
    // Every distinctive word of the fund's name must be in her words.
    if (hit === fw.length && hit > bestScore) { best = f; bestScore = hit; }
  }
  return best;
}

// ── AMOUNTS, FROM HER WORDS ────────────────────────────────────────────────
const AMOUNT_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|K|thousand|m|M|million)?\b/;
const WORD_AMOUNT_RE = /\b(\d{1,3}(?:,\d{3})+|\d+)\s*(thousand|k)\s*(dollars)?\b|\b(\d{1,3}(?:,\d{3})+|\d+)\s+dollars\b/i;
export function amountCentsIn(text) {
  const t = String(text || "");
  let m = t.match(AMOUNT_RE);
  if (m) { const a = parseAmount(m[1], m[2]); return a > 0 ? Math.round(a * 100) : null; }
  m = t.match(WORD_AMOUNT_RE);
  if (m) { const a = m[1] ? parseAmount(m[1], m[2]) : parseAmount(m[4], ""); return a > 0 ? Math.round(a * 100) : null; }
  return null;
}
export const cents$ = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });

// ── THE WHOLE READ, CHECKED ────────────────────────────────────────────────
// raw: the model's tool input. Returns the memo as Steward will act on it.
export function normalizeMemo(raw, transcript, { today, funds = [] } = {}) {
  const memo = String(transcript || "");
  const lower = memo.toLowerCase();
  const inMemo = q => { const s = String(q || "").trim().replace(/^["']|["']$/g, ""); return s.length >= 2 && lower.includes(s.toLowerCase()) ? s : null; };
  const r = raw && typeof raw === "object" ? raw : {};
  const arr = v => (Array.isArray(v) ? v : []).slice(0, 10);

  // Sensitive: what the model flagged, plus every sentence the screen catches.
  const sensitive = [];
  const heldSentences = new Set();
  for (const s of arr(r.sensitive)) {
    const quote = inMemo(s && s.quote);
    if (!quote) continue;
    const cat = SENSITIVE_CATEGORIES.includes(s.category) ? s.category : sensitiveCategory(quote) || "family";
    const sent = sentences(memo).find(x => x.toLowerCase().includes(quote.toLowerCase())) || quote;
    heldSentences.add(sent);
    const neutral = String(s.neutral || "").trim();
    sensitive.push({ category: cat, quote: sent, neutral: neutral && !sensitiveCategory(neutral) && neutral.length <= 120 ? neutral.replace(/([^.])$/, "$1.") : NEUTRAL[cat] });
  }
  for (const sent of sentences(memo)) {
    const cat = sensitiveCategory(sent);
    if (cat && !heldSentences.has(sent)) { heldSentences.add(sent); sensitive.push({ category: cat, quote: sent, neutral: NEUTRAL[cat] }); }
  }
  const clean = t => {
    let out = String(t || "");
    for (const h of heldSentences) out = out.split(h).join("");
    return stripSensitive(out).text.replace(/\s+/g, " ").trim();
  };
  const filedMemo = sentences(memo).map(s => (heldSentences.has(s) ? null : s)).filter(Boolean).join(" ")
    + (heldSentences.size ? (sentences(memo).some(s => !heldSentences.has(s)) ? " " : "") + HELD_MARK : "");

  const { kind, how } = conversationKind(r.how, memo);
  const date = conversationDate(r.when, today);
  const summary = clean(r.summary) || clean(memo).slice(0, 600) || `${HOW_LABEL[how] || "Conversation"}, from a memo.`;

  const followUps = [];
  for (const f of arr(r.follow_ups)) {
    const quote = inMemo(f && f.quote);
    const label = clean(f && f.label).slice(0, 160);
    if (!quote || !label || sensitiveCategory(quote)) continue;
    const d = dueFromMemo(`${f.when || ""} ${quote}`, today);
    followUps.push({ label: label.replace(/\.$/, ""), due: d.due, exact: d.exact, quote });
  }

  const interests = [];
  for (const it of arr(r.interests)) {
    const quote = inMemo(it && it.quote);
    if (!quote || sensitiveCategory(quote)) continue;
    const said = String(it.words || quote).trim().slice(0, 120);
    const fund = matchFund(`${said} ${quote}`, funds);
    if (interests.some(x => (fund && x.fundId === fund.id) || x.words.toLowerCase() === said.toLowerCase())) continue;
    interests.push({ words: said, quote, fundId: fund ? fund.id : null, fundName: fund ? fund.name : null });
  }

  const money = [];
  for (const m of arr(r.money)) {
    const quote = inMemo(m && m.quote);
    const cents = quote ? amountCentsIn(quote) : null;
    if (!quote || !cents) continue;   // an amount not in her words is no amount
    const kindM = ["gift", "pledge", "interest"].includes(m.kind) ? m.kind : "interest";
    const fund = matchFund(`${m.fund_words || ""} ${quote}`, funds) || (interests.find(i => i.fundId) ? funds.find(f => f.id === interests.find(i => i.fundId).fundId) : null);
    if (money.some(x => x.cents === cents && x.kind === kindM)) continue;
    money.push({ kind: kindM, cents, fundId: fund ? fund.id : null, fundName: fund ? fund.name : null, quote });
  }

  const contact = [];
  for (const c of arr(r.contact)) {
    const quote = inMemo(c && c.quote);
    const field = ["email", "phone", "address"].includes(c && c.field) ? c.field : null;
    const value = String(c && c.value || "").trim().slice(0, 200);
    if (!quote || !field || !value) continue;
    // The value has to be what she said, not the model's tidy version of something else.
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9@.]/g, "");
    if (!norm(memo).includes(norm(value))) continue;
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    contact.push({ field, value, quote });
  }

  let email = null;
  const subj = clean(r.email && r.email.subject).slice(0, 200), body = clean(r.email && r.email.body).slice(0, 4000);
  if (subj && body && !amountCentsIn(body)) email = { subject: subj, body };

  const people = arr(r.people).map(n => String(n || "").trim()).filter(n => n && inMemo(n.split(/\s+/)[0])).slice(0, 6);

  return { kind, how, date, summary, followUps: followUps.slice(0, 4), interests: interests.slice(0, 4), email,
           money: money.slice(0, 4), contact: contact.slice(0, 3), sensitive: sensitive.slice(0, 4), people, filedMemo };
}

// With AI off there is no read: the memo is a note on the person she picks,
// held back the same way if it carries a sensitive sentence.
export function memoAsNote(transcript) {
  const held = stripSensitive(transcript);
  return { note: held.held.length ? (held.text ? held.text + " " : "") + HELD_MARK : held.text,
           sensitive: held.held.map(q => ({ category: sensitiveCategory(q), quote: q, neutral: NEUTRAL[sensitiveCategory(q)] })) };
}

// A heard name is somebody on file when one of its words is one of theirs.
export function heardIsMatched(heard, people = []) {
  const hw = words(heard).filter(w => w.length > 1);
  return people.some(p => { const pw = new Set(String(p.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")); return hw.some(w => pw.has(w)); });
}

export default { MEMO_TOOL, MEMO_SYSTEM, buildMemoPrompt, normalizeMemo, dueFromMemo, conversationDate, conversationKind,
  matchFund, amountCentsIn, sensitiveCategory, stripSensitive, sentences, memoAsNote, heardIsMatched, HELD_MARK, HOW_LABEL, cents$ };
