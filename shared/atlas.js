// shared/atlas.js · AGENT-5. ATLAS: ONE HELPER, NAMED ONCE, THAT DOES THE WHOLE JOB.
//
// A director says one messy thing ("Undine went to the Harbor Run event. She
// gave $10,000. Let's start the major giving journey, then draft an email
// thanking her and requesting a meeting in the new year.") and Atlas:
//   1. READS it into steps, each with HER words for who, what and when. The
//      model reads when AI is on (ATLAS_TOOL, strict); with AI off, readInCode
//      reads the plain shapes (log, find, add to a journey by its exact name).
//      Neither ever supplies a fact: no id, no amount it computed, no date.
//   2. RESOLVES every word to a row in code (routes/atlas.js): people through
//      donorMatch.js, events, journeys and groups through matchName, amounts
//      and dates through amountFromWords and whenFromWords below.
//   3. ASKS every question at once, one click each, or RUNS: low-stakes steps
//      at once with Undo, money and sends as one tap each.
// The browser imports this file too: the checklist with spinners it draws
// the moment she presses Enter comes from previewLines, before the server has
// answered.

// The name is one value. The server reads ATLAS_NAME from its environment and
// every screen reads it from /atlas/status, so a new name is a variable
// change and a restart, never a build.
export const ATLAS_DEFAULT_NAME = "Atlas";

// ── WHAT A STEP CAN BE ─────────────────────────────────────────────────────
// The two speeds. RUNS: done at once, with Undo. TAP: waits for one tap.
// REFUSED: a guardrail, said in one line. ASKED: answered by Ask, nothing written.
export const STEP_KINDS = [
  "came_to_event", "register_for_event", "gift", "pledge", "add_to_journey", "remove_from_journey",
  "add_to_group", "remove_from_group", "draft_email", "reminder", "log_conversation", "note",
  "send_receipt", "send_now", "merge", "recurring_change", "personal_detail", "question", "find", "undo", "other",
];
export const RUNS = new Set(["came_to_event", "register_for_event", "add_to_journey", "remove_from_journey", "add_to_group",
  "remove_from_group", "draft_email", "reminder", "log_conversation", "note"]);
export const TAPS = new Set(["gift", "pledge", "send_receipt", "personal_detail"]);

// The guardrails the six old personas carried, as rules on what Atlas does.
// Settings > Atlas shows these sentences; the route enforces each one.
export const ATLAS_RULES = [
  { key: "drafts_only", line: "I draft emails and letters. I never send one without your yes." },
  { key: "money_waits", line: "A gift, pledge or receipt waits for your tap. I never record money on my own." },
  { key: "no_recurring", line: "I never change a recurring gift. That stays on the donor's profile, for you." },
  { key: "no_merge", line: "I never merge two people. I can put them in Data health for you to decide." },
  { key: "held_back", line: "A health, family or money detail about someone is held back until you say to keep it." },
  { key: "clients", line: "When privacy mode is on, I write nothing about a client." },
  { key: "do_not_contact", line: "I do nothing for someone marked deceased or do not contact." },
  { key: "facts", line: "Every name, amount and date I use comes from Steward's records or your words." },
];

// ── THE MODEL'S READ ───────────────────────────────────────────────────────
// Strict: every field is required, nothing else may appear. Each field is HER
// words, copied; the code resolves them.
const STEP_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kind", "who", "target", "amount_words", "when_words", "how", "words", "draft_subject", "draft_body"],
  properties: {
    kind: { type: "string", enum: STEP_KINDS },
    who: { type: "string", description: "The person's name exactly as she said it (\"Undine\", \"Peggy\", \"the Halvorsens\"). For her, him or them, the name it refers to. \"\" when nobody." },
    target: { type: "string", description: "The event, journey or group as she named it, her words (\"Harbor Run\", \"major giving\"). For merge, the second person's name. For a question or find, her question. \"\" otherwise." },
    amount_words: { type: "string", description: "The amount exactly as she said it (\"$10,000\", \"five grand\"). \"\" when none." },
    when_words: { type: "string", description: "When, exactly as she said it (\"in the new year\", \"after Thanksgiving\", \"yesterday\"). \"\" when she named no time." },
    how: { type: "string", description: "For log_conversation: lunch, coffee, call, meeting, visit, email. \"\" otherwise." },
    words: { type: "string", description: "Her own words for this step, copied." },
    draft_subject: { type: "string", description: "For draft_email only: a short subject. \"\" otherwise." },
    draft_body: { type: "string", description: "For draft_email only: the email, warm and brief, signed with no name. Use no amount, date or fact she did not say. \"\" otherwise." },
  },
};
export const ATLAS_TOOL = {
  name: "atlas_read",
  description: "Read what a nonprofit director asked for into steps, in the order she said them, with her own words for each part.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["steps"],
    properties: { steps: { type: "array", items: STEP_SCHEMA } },
  },
};
export const ATLAS_SYSTEM = [
  "You read what a nonprofit fundraiser told Steward, her donor database, into steps. You never act and never invent.",
  "One step per thing she wants done or tells you happened, in her order. Copy her words; never add a name, amount or date she did not say.",
  "Kinds: came_to_event (someone went to or attended an event), register_for_event (put on a guest list for one coming up), gift (someone gave money), pledge (promised money later),",
  "add_to_journey / remove_from_journey, add_to_group / remove_from_group, draft_email (write an email or thank-you for her to review),",
  "reminder (remind her, follow up, a task with a time), log_conversation (a lunch, call, coffee, meeting that happened), note (a fact to keep on a record),",
  "send_receipt (send the receipt or thank-you for a gift she just told you about), send_now (send an email right now without her reviewing it),",
  "merge (two records are the same person), recurring_change (change, pause or cancel a monthly or recurring gift),",
  "personal_detail (health, illness, a death, divorce, a child, money trouble: put the whole sentence in words), question (she asks something), find (show or open someone),",
  "undo (undo that, take that back), other (anything else; put her words in words).",
  "\"Scratch that\", \"no wait\", \"actually\": they take back only the words just before them, and only when she says something in their place. A conversation she says happened (\"lunch with Margaret went well\") is still a log_conversation when \"scratch that\" follows it. Filler (\"OK yeah\", \"um\") is not a step.",
  "Someone who came by, stopped in, visited, called, emailed or met her is a log_conversation (how: visit, call, email, meeting), even in the same breath as a gift.",
  "What was said or liked in a conversation (\"he loved the tour\") belongs in that log_conversation's words, never a separate note.",
  "\"Send it\", \"just send it\", \"don't show me\": one send_now step with the email in draft_subject and draft_body, and no draft_email beside it.",
  "A meeting she wants to ask for in the email is part of draft_email (when_words is when the meeting would be). A reminder to book it is its own reminder step only if she asked for one.",
  "\"Thank her\" with nothing else is draft_email. \"Log that\" after a gift is the same gift, not a second step. \"Send her the receipt\" is send_receipt.",
  "who: a family (\"the Halvorsens\") stays as she said it. A nickname stays as she said it. A pronoun becomes the name it refers to.",
  "No em dashes.",
].join("\n");
export function buildAtlasPrompt(text, { today, onPage = null } = {}) {
  const lines = [`Today is ${today}.`];
  if (onPage) lines.push(`She is looking at ${onPage}'s record, so "her", "him" or "them" with no other name is ${onPage}.`);
  lines.push(`What she said: ${text}`);
  return { system: ATLAS_SYSTEM, messages: [{ role: "user", content: lines.join("\n") }] };
}

// The model's steps, checked: unknown kinds become other, fields are strings,
// at most twelve steps, and a step whose words are not in what she said is
// dropped when it carries a name, amount or event (it would be a fact the
// model supplied).
const s = v => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
// Two rules held in code, whatever the model returned: a note about the
// person she just logged a conversation with is part of that conversation,
// and "send it now" is the one draft for that person (never a second).
export function tidySteps(steps) {
  const key = x => String(x.who || "").toLowerCase();
  const logs = new Map(steps.filter(x => x.kind === "log_conversation").map(x => [key(x), x]));
  const sends = new Set(steps.filter(x => x.kind === "send_now").map(key));
  return steps.filter(x => {
    if (x.kind === "note" && logs.has(key(x))) { const l = logs.get(key(x)); if (!l.words.includes(x.words)) l.words = `${l.words.replace(/[.\s]+$/, "")}. ${x.words}`; return false; }
    if (x.kind === "draft_email" && sends.has(key(x))) return false;
    return true;
  });
}
export function normalizeRead(raw, text) {
  const said = String(text || "").toLowerCase();
  const out = [];
  for (const st of (raw && Array.isArray(raw.steps) ? raw.steps : []).slice(0, 12)) {
    const kind = STEP_KINDS.includes(st && st.kind) ? st.kind : "other";
    const step = { kind, who: s(st.who), target: s(st.target), amountWords: s(st.amount_words), whenWords: s(st.when_words),
      how: s(st.how).toLowerCase(), words: s(st.words), draftSubject: s(st.draft_subject), draftBody: String((st && st.draft_body) || "").trim() };
    // An amount must be one she said.
    if (step.amountWords && !said.includes(step.amountWords.toLowerCase())) {
      const c = amountFromWords(step.amountWords);
      if (c == null || amountFromWords(text) !== c) step.amountWords = "";
    }
    out.push(step);
  }
  return tidySteps(out);
}

// ── AMOUNTS IN WORDS ───────────────────────────────────────────────────────
const UNITS = { zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1000, grand: 1000, k: 1000, million: 1e6, m: 1e6 };
// "$10,000", "10k", "five grand", "twenty-five thousand dollars", "$2.5 million" -> cents, or null.
export function amountFromWords(text) {
  const t = String(text || "").toLowerCase().replace(/[–—]/g, "-");
  let m = t.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|grand|m|million)?\b/);
  if (!m) m = t.match(/\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|grand|million)\b/);
  if (!m) { const d = t.match(/\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s+(?:dollars|bucks)\b/); if (d) m = [d[0], d[1], ""]; }
  if (m) {
    const n = Number(m[1].replace(/,/g, "")) * (m[2] ? SCALE[m[2]] : 1);
    return n > 0 ? Math.round(n * 100) : null;
  }
  // Number words: "five grand", "twenty five thousand dollars", "a thousand dollars".
  const w = t.match(/\b((?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)[\s-]+)+)(thousand|grand|million|dollars|bucks)\b/);
  if (!w) return null;
  let total = 0, cur = 0;
  for (const tok of w[1].split(/[\s-]+/).filter(x => x && x !== "and")) {
    if (tok === "hundred") cur = (cur || 1) * 100;
    else if (UNITS[tok] != null) cur += UNITS[tok];
  }
  const scale = SCALE[w[2]] || 1;
  total = (cur || 1) * scale;
  if (w[2] === "dollars" || w[2] === "bucks") total = cur;
  return total > 0 ? Math.round(total * 100) : null;
}
export const usd = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });

// ── DATES IN WORDS ─────────────────────────────────────────────────────────
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const civil = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const ymd = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "")); return m ? [+m[1], +m[2], +m[3]] : null; };
export function addDays(day, n) { const p = ymd(day); const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return civil(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
const dow = day => { const p = ymd(day); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
// A working day: Saturday and Sunday move to Monday.
const workday = day => (dow(day) === 6 ? addDays(day, 2) : dow(day) === 0 ? addDays(day, 1) : day);
function thanksgiving(y) { const nov1 = civil(y, 11, 1); return addDays(nov1, ((4 - dow(nov1) + 7) % 7) + 21); }
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2, few: 3 };
// The next time it will be that month: this year if it is still ahead, else next.
function monthDay(mi, d, today) {
  const [y, mo, td] = ymd(today);
  const year = mi + 1 < mo || (mi + 1 === mo && d <= td) ? y + 1 : y;
  return civil(year, mi + 1, d);
}
// when words -> { date, words } (the civil date, and how to say it), or null
// when she named no time. "the new year" and "first week of January" are the
// first working day on or after January 5: the week people are back.
export function whenFromWords(words, today) {
  const t = String(words || "").toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || !ymd(today)) return null;
  const [y] = ymd(today);
  if (/\btoday\b|\btonight\b/.test(t)) return { date: today };
  if (/\btomorrow\b/.test(t)) return { date: addDays(today, 1) };
  if (/\b(the )?new year\b|\bafter the holidays\b|\bnext year\b/.test(t)) return { date: workday(civil(y + 1, 1, 5)) };
  if (/\bafter thanksgiving\b/.test(t)) { let tg = thanksgiving(y); if (tg < today) tg = thanksgiving(y + 1); return { date: addDays(tg, 4) }; }
  if (/\bthanksgiving\b/.test(t)) { let tg = thanksgiving(y); if (tg < today) tg = thanksgiving(y + 1); return { date: tg }; }
  let m = t.match(/\bin (a|an|one|two|three|four|five|six|couple of|few|\d+) (day|week|month)s?\b/);
  if (m) { const n = NUM[m[1].replace(" of", "")] || Number(m[1]) || 1; return { date: m[2] === "day" ? addDays(today, n) : m[2] === "week" ? addDays(today, 7 * n) : workday(addDays(today, 30 * n)) }; }
  if (/\bnext week\b/.test(t)) return { date: addDays(today, ((1 - dow(today) + 7) % 7) || 7) };
  if (/\bnext month\b/.test(t)) { const [yy, mo] = ymd(today); return { date: workday(mo === 12 ? civil(yy + 1, 1, 1) : civil(yy, mo + 1, 1)) }; }
  if (/\bend of (the )?month\b/.test(t)) { const [yy, mo] = ymd(today); return { date: addDays(mo === 12 ? civil(yy + 1, 1, 1) : civil(yy, mo + 1, 1), -1) }; }
  // "January 12", "Jan 12th", "12 January"
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
  m = t.match(new RegExp(`\\b${mon} (\\d{1,2})(st|nd|rd|th)?\\b`)) || null;
  if (m) { const mi = MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3))); return { date: monthDay(mi, Math.min(+m[2], 31), today) }; }
  m = t.match(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)? (of )?${mon}\\b`));
  if (m) { const mi = MONTHS.findIndex(x => x.startsWith(m[4].slice(0, 3))); return { date: monthDay(mi, Math.min(+m[1], 31), today) }; }
  // "first week of January", "early January", "mid March", "end of February", "January"
  m = t.match(new RegExp(`\\b(first week of|early|beginning of|start of|mid|middle of|late|end of|the end of|last week of)? ?${mon}\\b`));
  if (m && !(m[2] === "may" && !/\b(in|by|early|mid|late|end of|start of)\s+may\b/.test(t))) {
    const mi = MONTHS.findIndex(x => x.startsWith(m[2].slice(0, 3)));
    const q = m[1] || "";
    const d = /mid|middle/.test(q) ? 15 : /late|end|last/.test(q) ? 25 : 5;
    return { date: workday(monthDay(mi, d, today)) };
  }
  m = t.match(/\b(next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) { let n = (WEEKDAYS.indexOf(m[2]) - dow(today) + 7) % 7 || 7; if (m[1] === "next " && n < 3) n += 7; return { date: addDays(today, n) }; }
  if (/\bsoon\b|\bshortly\b/.test(t)) return { date: addDays(today, 7) };
  if (/\byesterday\b/.test(t)) return { date: addDays(today, -1), past: true };
  m = t.match(/\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) return { date: addDays(today, -(((dow(today) - WEEKDAYS.indexOf(m[1]) + 7) % 7) || 7)), past: true };
  return null;
}
// "Jan 5" (and the year when it is not this one).
export function dayWords(date, today) {
  const p = ymd(date); if (!p) return "";
  const s0 = new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return ymd(today) && ymd(today)[0] !== p[0] && Math.abs(Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(...[ymd(today)[0], ymd(today)[1] - 1, ymd(today)[2]])) > 300 * 864e5 ? `${s0}, ${p[0]}` : s0;
}
// "January", for "asking to meet in January".
export function monthWord(date) { const p = ymd(date); return p ? MONTHS[p[1] - 1][0].toUpperCase() + MONTHS[p[1] - 1].slice(1) : ""; }

// ── READING IN CODE (AI OFF, AND THE FIRST SPINNERS) ───────────────────────
// What she took back comes off first: "lunch went well... scratch that... she
// gave $5000" keeps both, since what "that" is is unclear; "add him to the gala
// list, scratch that, the auction list" keeps the auction list.
export function tidyTalk(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:(?:no|ok|okay|yeah|yes|um+|uh+|so|right|hey atlas|atlas)[,.!\s]+)+/i, "");
  t = t.replace(/\b(?:um+|uh+)\b[,]?\s*/gi, "");
  // "X, scratch that, Y" where X and Y are the same kind of thing: keep Y.
  t = t.replace(/([^.]*?)\s*(?:\.\.\.|,|\.)?\s*\b(?:scratch that|no wait|i mean)\b\s*(?:\.\.\.|,|\.)?\s*/gi, (all, before) => {
    const prior = before.trim();
    return /\b(the |a )?[\w\s]+(list|group|journey|event)\b$/i.test(prior) ? "" : prior + ". ";
  });
  return t.replace(/\.\.\./g, ". ").replace(/\s+([.,])/g, "$1").replace(/\.\s*\./g, ".").replace(/\s+/g, " ").trim();
}
const clauses = text => tidyTalk(text).split(/(?<=[.!?;])\s+|,?\s+\b(?:then|and then|also|plus)\b\s+/i).map(x => x.trim().replace(/[.!?;,]+$/, "")).filter(Boolean);
const NAME = "([A-Z][a-zA-Z'’-]+(?:\\s+[A-Z][a-zA-Z'’-]+)*)";
// One clause -> one step, in the plain shapes code can read for certain.
export function readClause(c) {
  const t = c.trim();
  const blank = { who: "", target: "", amountWords: "", whenWords: "", how: "", words: t, draftSubject: "", draftBody: "" };
  if (/^(undo|take back|reverse)\b.*\b(that|it|last)\b|^undo$/i.test(t)) return { ...blank, kind: "undo" };
  if (/\bmerge\b/i.test(t)) { const m = t.match(new RegExp(`merge\\s+${NAME}\\s+(?:and|with|into)\\s+${NAME}`)); return { ...blank, kind: "merge", who: m ? m[1] : "", target: m ? m[2] : "" }; }
  if (/\b(monthly|recurring|subscription)\b/i.test(t) && /\b(change|cancel|pause|stop|raise|lower|bump|increase|decrease|move)\b/i.test(t)) {
    const m = t.match(new RegExp(NAME)); return { ...blank, kind: "recurring_change", who: m ? m[1].replace(/'s$/, "") : "" };
  }
  if (/\?$/.test(c.trim()) || /^(who|what|how many|how much|when|where|why|which|did|does|is|are|has|have)\b/i.test(t)) return { ...blank, kind: "question", target: t };
  let m = t.match(new RegExp(`^(?:find|show me|open|pull up|look up)\\s+${NAME}`, "i"));
  if (m) return { ...blank, kind: "find", who: m[1] };
  m = t.match(new RegExp(`^${NAME}\\s+(?:went to|came to|attended|was at|showed up (?:at|to))\\s+(?:the\\s+)?(.+?)(?:\\s+event)?$`));
  if (m) return { ...blank, kind: "came_to_event", who: m[1], target: m[2] };
  m = t.match(new RegExp(`^(?:add|put|enroll|enrol|start)\\s+${NAME}\\s+(?:in|into|on|to)\\s+(?:the\\s+)?(.+?)\\s+journey$`, "i"));
  if (m) return { ...blank, kind: "add_to_journey", who: m[1], target: m[2] };
  m = t.match(new RegExp(`^(?:add|put)\\s+${NAME}\\s+(?:in|into|on|to)\\s+(?:the\\s+)?(.+?)\\s+(?:group|list)$`, "i"));
  if (m) return { ...blank, kind: "add_to_group", who: m[1], target: m[2] };
  m = t.match(new RegExp(`^(?:take|remove)\\s+${NAME}\\s+(?:out of|off|from)\\s+(?:the\\s+)?(.+?)\\s+journey$`, "i"));
  if (m) return { ...blank, kind: "remove_from_journey", who: m[1], target: m[2] };
  m = t.match(new RegExp(`^${NAME}\\s+(?:gave|donated|sent(?: us)?|wrote a check for)\\s+(.+)$`));
  if (m && amountFromWords(m[2]) != null) return { ...blank, kind: "gift", who: m[1], amountWords: m[2] };
  m = t.match(new RegExp(`^(?:log|note)?\\s*(?:a |an )?(lunch|coffee|call|meeting|visit|breakfast|dinner|tour)\\s+with\\s+${NAME}(.*)$`, "i"))
    || t.match(new RegExp(`^(?:had|i had)\\s+(?:a |an )?(lunch|coffee|call|meeting|visit|breakfast|dinner|tour)\\s+with\\s+${NAME}(.*)$`, "i"));
  if (m) return { ...blank, kind: "log_conversation", how: m[1].toLowerCase(), who: m[2], whenWords: m[3] || "" };
  m = t.match(/^remind me (?:to\s+)?(.+)$/i);
  if (m) return { ...blank, kind: "reminder", whenWords: m[1], words: m[1] };
  return { ...blank, kind: "other" };
}
export function readInCode(text) { return tidySteps(clauses(text).map(readClause)); }

// The first lines she sees, before the server answers: one spinner per clause.
const PREVIEW = { came_to_event: "Marking attendance", register_for_event: "Adding to the guest list", gift: "Getting the gift ready for your tap",
  pledge: "Getting the pledge ready for your tap", add_to_journey: "Adding to the journey", remove_from_journey: "Taking out of the journey",
  add_to_group: "Adding to the group", remove_from_group: "Taking out of the group", draft_email: "Drafting the email", reminder: "Setting the reminder",
  log_conversation: "Logging the conversation", note: "Saving the note", send_receipt: "Getting the receipt ready", question: "Looking it up",
  find: "Finding them", undo: "Undoing", merge: "Checking", recurring_change: "Checking", send_now: "Drafting", personal_detail: "Holding a detail back", other: "Working on it" };
export function previewLines(text) {
  const out = [];
  for (const c of clauses(text)) {
    const st = readClause(c);
    let line = PREVIEW[st.kind];
    if (st.kind === "other") {
      if (/\b(draft|email|write|thank)\b/i.test(c)) line = PREVIEW.draft_email;
      else if (/\bjourney\b/i.test(c)) line = PREVIEW.add_to_journey;
      else if (/\b(gave|donat|\$|grand|thousand)\b/i.test(c)) line = PREVIEW.gift;
      else if (/\b(went to|came to|attended)\b/i.test(c)) line = PREVIEW.came_to_event;
      else if (/\b(remind|follow up)\b/i.test(c)) line = PREVIEW.reminder;
    }
    if (!out.includes(line)) out.push(line);
  }
  return out.length ? out : [PREVIEW.other];
}

// ── WHAT ATLAS SAYS ────────────────────────────────────────────────────────
// Brief, first person, one line per thing. Each line carries where it lives.
export const AI_OFF_LINE = "My reading is off for this organization, so I can log a conversation, find someone, and add someone to a journey by its exact name. Say it plainly and I'll do that.";
export const CANT_LINE = words => `I can't do "${String(words).slice(0, 80)}" yet. I did the rest.`;
export const REFUSE = {
  send_now: "I don't send without your yes. The draft is waiting for you.",
  merge: "I never merge people. I put them in Data health for you to decide.",
  merge_one: "I never merge people. Open Data health to merge them yourself.",
  recurring_change: name => `I never change a recurring gift. Open ${name ? name + "'s" : "the"} recurring gift on their profile to change it.`,
  client: name => `${name || "That person"} is a client, and privacy mode is on, so I wrote nothing about them.`,
  not_found: name => `I couldn't find ${name} in Steward. Add them first, then ask me again.`,
  no_who: "I couldn't tell who that was about. Say their name.",
};
export const SPOKE = {
  done: "Done.",
  waiting: n => (n === 1 ? "One thing waits for your tap." : `${n} things wait for your tap.`),
};

export default { ATLAS_DEFAULT_NAME, STEP_KINDS, RUNS, TAPS, ATLAS_RULES, ATLAS_TOOL, ATLAS_SYSTEM, buildAtlasPrompt, normalizeRead, tidySteps,
  amountFromWords, usd, whenFromWords, dayWords, monthWord, addDays, tidyTalk, readClause, readInCode, previewLines, AI_OFF_LINE, CANT_LINE, REFUSE, SPOKE };
