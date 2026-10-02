// shared/meetingNote.js — INT-BUILD-1 Part 5. WHAT STEWARD HEARD IN HER NOTE.
//
// After a meeting she types a few lines. This reads them for the things the
// record has a place for (a pledge, a gift, a fund, a next step) and offers
// each as a chip she confirms or removes. NOTHING HERE WRITES. A chip is a
// suggestion until she presses save, and then it goes through the ordinary
// gift and pledge routes like anything she typed into a form.
//
// It is a reader, not a model: it works with AI off, sends her note nowhere,
// and says nothing it cannot point to in her own words. A phrase it does not
// recognise produces no chip, which is the right failure: a missed chip costs
// her one field; an invented pledge would be a false record.
//
// Pure: no DB, no network, no clock.

const AMOUNT = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|K|thousand|m|M|million)?`;

export function parseAmount(num, unit) {
  const n = Number(String(num).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const u = String(unit || "").toLowerCase();
  const mult = u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "million" ? 1e6 : 1;
  return Math.round(n * mult * 100) / 100;
}

const WORDS_TO_N = { two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12 };

/**
 * @param note   her text
 * @param ctx    { funds: [{id, name}], openAsk: {amount, fundId, fundName}|null }
 * @returns [{ kind: "pledge"|"gift"|"fund"|"next", label, amount?, payments?, fundId?, text?, quote }]
 */
// ── FIX-12 Part 7b — THE ENGINE'S CHIPS, HELD TO THE READER'S RULE ─────────
// The Agent engine reads the note now (through aiClient.js, so the org's AI
// switch is asked first), and this reader is the fallback when AI is off or
// the model returns nothing usable. The rule does not change with the reader:
// a chip must point to her own words. validateNoteChips drops any chip whose
// quote is not in the note, whose amount is not in its quote, or whose fund is
// not one of the org's.
export const NOTE_CHIP_TOOL = {
  name: "suggest_chips",
  description: "Return the chips this meeting note supports. Every chip quotes the note.",
  input_schema: {
    type: "object",
    properties: {
      chips: { type: "array", items: { type: "object", properties: {
        kind: { type: "string", enum: ["pledge", "gift", "fund", "next"] },
        quote: { type: "string", description: "The exact words from the note this chip comes from." },
        amount: { type: "number" }, payments: { type: "integer" },
        fundId: { type: "string" }, text: { type: "string" },
      }, required: ["kind", "quote"] } },
    },
    required: ["chips"],
  },
};

export function buildNoteChipPrompt(note, { funds = [], openAsk = null } = {}, systemPrompt = "") {
  return {
    system: systemPrompt,
    messages: [{ role: "user", content:
      `Funds (id: name):\n${funds.map(f => `${f.id}: ${f.name}`).join("\n") || "(none)"}\n`
      + `${openAsk ? `Open ask: $${openAsk.amount}${openAsk.fundName ? " for " + openAsk.fundName : ""}\n` : ""}`
      + `\nHer note:\n"""${String(note || "").slice(0, 4000)}"""` }],
  };
}

export function validateNoteChips(chips, note, { funds = [] } = {}) {
  const text = String(note || "");
  const lower = text.toLowerCase();
  const fundIds = new Map(funds.map(f => [f.id, f]));
  const out = [];
  for (const c of Array.isArray(chips) ? chips : []) {
    const quote = String(c && c.quote || "").trim();
    if (!quote || !lower.includes(quote.toLowerCase())) continue;
    if (c.kind === "pledge" || c.kind === "gift") {
      const m = quote.match(new RegExp(AMOUNT));
      const amt = m ? parseAmount(m[1], m[2]) : null;
      if (!amt || Math.abs(amt - Number(c.amount)) > 0.005) continue;
      const payments = c.kind === "pledge" ? Math.max(1, Math.min(60, parseInt(c.payments, 10) || 1)) : undefined;
      out.push(c.kind === "pledge"
        ? { kind: "pledge", amount: amt, payments, label: `Pledge $${amt.toLocaleString("en-US")}${payments > 1 ? ` in ${payments} payments` : ""}`, quote }
        : { kind: "gift", amount: amt, label: `Gift $${amt.toLocaleString("en-US")}`, quote });
    } else if (c.kind === "fund") {
      const f = fundIds.get(c.fundId);
      if (!f) continue;
      out.push({ kind: "fund", fundId: f.id, label: f.name, quote });
    } else if (c.kind === "next") {
      const t = String(c.text || quote).trim().replace(/\.$/, "").slice(0, 300);
      if (t) out.push({ kind: "next", text: t, label: "Next step from your note", quote });
    }
  }
  // One of each kind, the first the model gave: the form has one of each.
  const seen = new Set();
  return out.filter(c => (seen.has(c.kind) ? false : (seen.add(c.kind), true)));
}

export function suggestFromNote(note, ctx = {}) {
  const text = String(note || "");
  const low = text.toLowerCase();
  const out = [];
  if (!text.trim()) return out;

  // How many payments, if she said ("split", "half now and half in March",
  // "over three years", "in four payments").
  let payments = null;
  if (/\bhalf now\b|\bsplit\b.*\b(two|2)\b|\bsplit\b/.test(low)) payments = 2;
  const m1 = low.match(/\b(?:in|over)\s+(\d+|two|three|four|five|six|twelve)\s+(?:payments|installments|instalments|years|parts)\b/);
  if (m1) payments = Number(m1[1]) || WORDS_TO_N[m1[1]] || payments;

  // A PLEDGE: she committed to an amount, or "she's in" for the ask on file.
  const amounts = [...text.matchAll(new RegExp(AMOUNT, "g"))].map(m => ({ amount: parseAmount(m[1], m[2]), at: m.index, raw: m[0] }));
  const committed = /\b(she's in|he's in|they're in|is in for|are in for|committed|pledged?|will give|agreed to|yes to)\b/i.exec(text);
  const gave = /\b(gave|handed (?:me|us) a (?:check|cheque)|wrote a (?:check|cheque)|donated)\b/i.exec(text);
  const near = (m, list) => list.find(a => Math.abs(a.at - m.index) < 60) || list[0];
  if (committed && (amounts.length || ctx.openAsk?.amount)) {
    const a = amounts.length ? near(committed, amounts) : { amount: Number(ctx.openAsk.amount) };
    if (a && a.amount > 0) out.push({ kind: "pledge", amount: a.amount, payments: payments || 1,
      label: `Pledge $${a.amount.toLocaleString("en-US")}${payments && payments > 1 ? `, ${payments} payments` : ""}`,
      quote: committed[0] });
  } else if (gave && amounts.length) {
    const a = near(gave, amounts);
    out.push({ kind: "gift", amount: a.amount, label: `Gift $${a.amount.toLocaleString("en-US")}`, quote: gave[0] });
  }

  // A FUND: a fund on file named in the note, or the open ask's fund when
  // she committed to the ask.
  const named = (ctx.funds || []).filter(f => f.name && f.name.length > 3 && low.includes(f.name.toLowerCase()));
  const fund = named[0] || (out[0] && ctx.openAsk?.fundId ? { id: ctx.openAsk.fundId, name: ctx.openAsk.fundName } : null);
  if (fund && fund.name) out.push({ kind: "fund", fundId: fund.id, label: fund.name, quote: fund.name });

  // A NEXT STEP: the first sentence that asks for something to happen.
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const ask = sentences.find(s => /\b(follow up|send|invite|call|schedule|introduce|meet|visit|asked if|wants to|next)\b/i.test(s)
    && !/\bshe's in\b/i.test(s));
  if (ask) out.push({ kind: "next", text: ask.replace(/\.$/, ""), label: "Next step from your note", quote: ask });

  return out;
}

// ── FIX-14 Part 1 — A CONVERSATION LOGGED BY HAND ───────────────────────────
// "Log a conversation" (and the touchpoint form) write a note on the record.
// The same reading offers what the record has a place for, each as a chip
// that does nothing until a person says yes:
//   next     "Follow up around Nov 1": sets the profile's next step, a Thread
//            step with that date
//   spouse   "Link Clementine to the household": the person named as a
//            spouse or partner, matched by name or added, in one household
//   planned  "Mark as a planned-giving prospect": the note mentions a planned
//            or estate gift
// `date` is the conversation's own civil day; a relative phrase ("in a
// month", "next week") is counted from it, never from a clock.

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const civil = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function addDaysCivil(date, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return civil(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function addMonthsCivil(date, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  if (!m) return null;
  const idx = +m[1] * 12 + (+m[2] - 1) + n, y = Math.floor(idx / 12), mo = idx % 12 + 1;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return civil(y, mo, Math.min(+m[3], dim));
}
export function shortCivil(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
  return m ? `${MON3[+m[2] - 1]} ${+m[3]}` : "";
}
const N_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };
// "follow up in a month" → the date a month after `date`; null when the text
// names no time at all (the chip then proposes two weeks, and says so).
export function dueFromText(text, date) {
  const t = String(text || "").toLowerCase();
  let m = t.match(/\b(?:in|within|after)\s+(?:a\s+)?(\d+|a|an|one|two|three|four|five|six|couple(?:\s+of)?|few)\s+(day|week|month|year)s?\b/);
  if (m) {
    const n = Number(m[1]) || N_WORDS[m[1].replace(/\s+of$/, "")] || 1;
    if (m[2] === "day") return addDaysCivil(date, n);
    if (m[2] === "week") return addDaysCivil(date, 7 * n);
    if (m[2] === "month") return addMonthsCivil(date, n);
    return addMonthsCivil(date, 12 * n);
  }
  if (/\btomorrow\b/.test(t)) return addDaysCivil(date, 1);
  if (/\bnext week\b/.test(t)) return addDaysCivil(date, 7);
  if (/\bnext month\b/.test(t)) return addMonthsCivil(date, 1);
  if (/\bnext year\b/.test(t)) return addMonthsCivil(date, 12);
  return null;
}

// "Label: value" lines, as the touchpoint form writes them. Shared with the
// timeline, which shows them as labelled rows.
export function noteFields(note) {
  return String(note || "").split(/\r?\n/).map(line => {
    const m = /^\s*([A-Z][A-Za-z0-9 /&'()-]{0,40}?)\s*:\s*(.+)$/.exec(line);
    return m ? { label: m[1].trim(), value: m[2].trim() } : null;
  }).filter(Boolean);
}
const fieldOf = (fields, re) => (fields.find(f => re.test(f.label)) || {}).value || null;

const PLANNED_RE = /\b(planned gift|planned giving|planned-giving|estate gift|estate plan(?:ning)?|bequest|in (?:his|her|their|my) will|legacy gift|leave (?:us|something) in)\b/i;
const NAME = String.raw`([A-Z][a-z'’-]+(?:[ ]+[A-Z][a-z'’-]+)?)`;
const SPOUSE_RES = [
  new RegExp(String.raw`\b(?:[Hh]is|[Hh]er|[Tt]heir)[ ]+(?:wife|husband|spouse|partner)[ ]*,?[ ]+` + NAME),
  new RegExp(String.raw`\b(?:[Ww]ife|[Hh]usband|[Ss]pouse|[Pp]artner)[ ]*,[ ]*` + NAME),
  new RegExp(String.raw`\b` + NAME + String.raw`[ ]*\((?:his|her|their)[ ]+(?:wife|husband|spouse|partner)\)`),
];

export function suggestFromConversation(note, { date = null, funds = [] } = {}) {
  const text = String(note || "");
  const out = [];
  if (!text.trim()) return out;
  const fields = noteFields(text);

  // NEXT: the form's own Next Step field first, then a sentence that asks for
  // something to happen.
  const nextField = fieldOf(fields, /^next steps?$/i);
  let nextText = nextField, quote = nextField;
  if (!nextText) {
    const lines = text.split(/\r?\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const ask = lines.find(s => /\b(follow up|follow-up|send|invite|call|schedule|introduce|meet|visit|check in|next)\b/i.test(s));
    if (ask) { nextText = ask.replace(/^[^:]{1,40}:\s*/, ""); quote = ask; }
  }
  if (nextText) {
    const due = dueFromText(nextText, date);
    const label = /\bfollow[ -]?up\b/i.test(nextText) ? "Follow up" : nextText.replace(/\.$/, "").slice(0, 80);
    if (due) out.push({ kind: "next", text: nextText.replace(/\.$/, "").slice(0, 300), stepLabel: label, due,
      label: `${label.length > 40 ? "Next step" : label} around ${shortCivil(due)}`, quote });
  }

  // SPOUSE: the form's Spouse / Partner field, or "his wife Clementine".
  const spouseField = fieldOf(fields, /^(spouse|partner|spouse \/ partner)$/i);
  let spouse = null, sq = null;
  if (spouseField) { const m = new RegExp("^" + NAME).exec(spouseField.trim()); if (m) { spouse = m[1]; sq = spouseField; } }
  if (!spouse) for (const re of SPOUSE_RES) { const m = re.exec(text); if (m) { spouse = m[1]; sq = m[0]; break; } }
  if (spouse) out.push({ kind: "spouse", name: spouse, label: `Link ${spouse} to the household`, quote: sq });

  // PLANNED: a planned or estate gift is mentioned.
  const pm = PLANNED_RE.exec(text);
  if (pm) out.push({ kind: "planned", label: "Mark as a planned-giving prospect", quote: pm[0] });
  return out;
}

// The engine's version of the same three, held to the reader's rule: every
// chip quotes the note, and a date is counted from the note's own words.
export const CONVERSATION_CHIP_TOOL = {
  name: "suggest_conversation_chips",
  description: "Return the chips this conversation note supports. Every chip quotes the note.",
  input_schema: {
    type: "object",
    properties: {
      chips: { type: "array", items: { type: "object", properties: {
        kind: { type: "string", enum: ["next", "spouse", "planned"] },
        quote: { type: "string", description: "The exact words from the note this chip comes from." },
        text: { type: "string", description: "For next: the step, in the note's words." },
        name: { type: "string", description: "For spouse: the spouse or partner's name as written." },
      }, required: ["kind", "quote"] } },
    },
    required: ["chips"],
  },
};
export const CONVERSATION_CHIP_SYSTEM =
  "You read a note a fundraiser logged after talking with a donor, and pick out only what the note itself says: the next step she wrote down (kind next, with the step's words in text), the donor's spouse or partner if one is named (kind spouse, with the name), and whether a planned gift, an estate gift or a bequest is mentioned (kind planned). For every item, quote the exact words from the note it comes from. If the note does not say it, leave it out. Never guess a name or a step.";

export function validateConversationChips(chips, note, { date = null } = {}) {
  const text = String(note || ""), lower = text.toLowerCase();
  const out = [];
  for (const c of Array.isArray(chips) ? chips : []) {
    const quote = String(c && c.quote || "").trim();
    if (!quote || !lower.includes(quote.toLowerCase())) continue;
    if (c.kind === "next") {
      const t = String(c.text || quote).trim().replace(/\.$/, "").slice(0, 300);
      const due = dueFromText(quote, date) || dueFromText(t, date);
      if (!t || !due) continue;
      const label = /\bfollow[ -]?up\b/i.test(t) ? "Follow up" : t.slice(0, 80);
      out.push({ kind: "next", text: t, stepLabel: label, due, label: `${label.length > 40 ? "Next step" : label} around ${shortCivil(due)}`, quote });
    } else if (c.kind === "spouse") {
      const name = String(c.name || "").trim();
      if (!name || !lower.includes(name.toLowerCase()) || !/^[A-Z]/.test(name) || name.length > 60) continue;
      out.push({ kind: "spouse", name, label: `Link ${name} to the household`, quote });
    } else if (c.kind === "planned") {
      if (!PLANNED_RE.test(quote)) continue;
      out.push({ kind: "planned", label: "Mark as a planned-giving prospect", quote });
    }
  }
  const seen = new Set();
  return out.filter(c => (seen.has(c.kind) ? false : (seen.add(c.kind), true)));
}

export default { suggestFromNote, parseAmount };
