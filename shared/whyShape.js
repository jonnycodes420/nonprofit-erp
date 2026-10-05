// shared/whyShape.js — WHY-1. Ask Steward why, and who to call tomorrow.
//
// The pure half of the answer: which of the seven questions a sentence asks,
// the TEMPLATE sentence each answer reads in when AI is off (or when the
// model's sentence fails the number check), and the number check itself.
// The facts are computed in why.js on the server; nothing here reads a table.
//
// THE ANSWER SHAPE (one for every question, rendered by WhyAnswer.jsx):
//   sentence   the answer in one sentence
//   reasons    ranked by dollars, each { key, label, cents, count, sentence, source }
//   who        the people it is about, ranked, each { donorId, name, reason, cents }
//   step       one recommended action; it plans, drafts or opens. It never sends.
//   cantSee    one honest line when the evidence is thin, or null
//
// House style for every sentence here: spell numbers under ten, no colons, no
// em dashes, time in words.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export function spell(n) { return n >= 0 && n < WORDS.length ? WORDS[n] : String(n); }
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export function dollars(cents) {
  const c = Math.abs(Math.round(Number(cents) || 0));
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
const plural = (n, one, many) => `${spell(n)} ${n === 1 ? one : many}`;

// ── The seven questions ────────────────────────────────────────────────────
// `needs` says what the question is about: a campaign, a donor, or nothing.
export const QUESTIONS = [
  { key: "appeal", needs: "campaign", ask: c => `Why did ${c || "this campaign"} come in where it did?` },
  { key: "call", needs: null, ask: () => "Who should I call tomorrow?" },
  { key: "retention", needs: null, ask: () => "Why is retention down this year?" },
  { key: "stopped", needs: "donor", ask: d => `Why did ${d || "this donor"} stop giving?` },
  { key: "lapse", needs: null, ask: () => "Who is about to lapse, and why?" },
  { key: "volunteers", needs: null, ask: () => "Which volunteers should we ask to give?" },
  { key: "second", needs: null, ask: () => "Which first-time donors need a second ask?" },
  // PROSPECT-1 — admins and major gifts staff only (routes/why.js).
  { key: "more", needs: null, ask: () => "Who could give more?", restricted: true },
];
export const QUESTION_KEYS = QUESTIONS.map(q => q.key);

export const CANT_ANSWER = "Steward can't answer that one yet. We've noted it.";

// Typed questions are matched to the seven by their words. Order matters: the
// narrower questions are tried first, so "which volunteers haven't given" is
// the volunteer question and not the lapse one.
// FIX-25: plain rewordings of the same eight questions find them too ("why
// are donors leaving", "who stopped giving", "why is giving down"). This only
// widens the words for a question that exists; it never adds a question.
const DONORS = "(donors?|givers?|supporters?|people|members)";
const MATCHERS = [
  ["more", /\b(could|can|might|able to)\b.*\bgive more\b|\broom to give\b|\b(capacity|upgrade|major (gift|donor) prospects?)\b|\b(ask|asked) for more\b|\bbiggest prospects?\b|\bgive (a )?(bigger|larger) gifts?\b/i],
  ["volunteers", /\bvolunteer/i],
  ["second", /\b(first[- ]time|first gift|new donors?|second (ask|gift))\b|\bgave (just |only )?once\b|\bone[- ]time (donors?|givers?)\b.*\b(again|second|back)\b/i],
  ["call", /\b(who|whom)\b.*\b(call|ring|phone|reach out|contact|follow up with|get in touch)\b|\b(call|ring)\b.*\b(tomorrow|today|this morning|next|this week|first)\b/i],
  ["retention", new RegExp("\\bretention\\b|\\bretain|\\b(keep|kept|keeping) (our |my )?" + DONORS + "\\b|\\b" + DONORS + "\\b.*\\b(did we|do we) keep\\b"
    + "|\\b(losing|lose|lost|leaving|churn(ing)?)\\b.*\\b" + DONORS + "\\b|\\b" + DONORS + "\\b.*\\b(leaving|leave|left|churn(ing)?|lost|dropp(ed|ing) off)\\b"
    + "|^(?!.*\\b(appeal|campaign|drive|mailing)\\b).*\\b(giving|donations?|revenue|income)\\b.*\\b(down|drop(ped|ping|s)?|fall(en|ing)?|fell|declin(ed|ing)|lower)\\b"
    + "|^\\s*(who|which " + DONORS + "|how many " + DONORS + ")\\b.*\\b((stopped|quit|stop) (giving|donating)|(haven't|have not|havent) (given|donated))\\b", "i")],
  // ASK-2: "what should I do about the donors who stopped giving" asks the
  // retention question for everyone, not the one-donor question.
  ["retention", /\bwhat (should|do|can|could) (i|we) do about\b.*\b(stopped|stop|quit|lapsed|leaving|left)\b/i],
  ["lapse", /\b(about to|going to|at risk of|likely to|might|could|close to|will)\b.*\blapse|\bdrift|\bslipping\b|\bwho\b.*\blaps|\bat risk\b|\bgoing quiet\b|\boverdue (for|to) give\b/i],
  ["stopped", /\b(stop(ped)?|quit) (giving|donating|supporting)\b|\bwhy did .+ (stop|leave|lapse)\b|\b(hasn't|has not|hasnt)\b.*\b(given|donated)\b|\bno longer (gives?|giving|donat)/i],
  ["appeal", /\b(appeal|campaign|drive|mailing)\b|\bcome in (under|over|short|below|above)\b|\b(under|over|short of) last year\b|\b(underperform|fell short|fall short|miss(ed)? (its|the|our) goal)/i],
];
export function matchQuestion(text) {
  // A phone types a curly apostrophe; the words are the same.
  const s = String(text || "").replace(/[\u2018\u2019]/g, "'").trim();
  if (!s) return null;
  for (const [key, re] of MATCHERS) if (re.test(s)) return key;
  return null;
}

// ── Template sentences ─────────────────────────────────────────────────────
// Each takes the computed facts for its question and returns one sentence.
// A fact the facts object does not carry is a fact the sentence does not say.
// ASK-3: one part of an appeal's breakdown, in a sentence. The dollars are
// the part's own sum (negative for money that did not come back).
export function partSentence(part, f) {
  const n = f.count, d = dollars(Math.abs(f.cents || 0));
  const who = cap(plural(n, "donor", "donors"));
  switch (part) {
    case "lapsed": return `${cap(spell(n))} of ${f.compareName}'s donors ${n === 1 ? "hasn't" : "haven't"} given to ${f.campaignName} yet; they gave ${d} last time.`;
    case "more": return `${who} gave more to ${f.campaignName} than to ${f.compareName}, ${d} more between them.`;
    case "less": return `${who} gave less to ${f.campaignName} than to ${f.compareName}, ${d} less between them.`;
    case "timing": return `${who} gave later in ${f.compareName} than ${f.campaignName} has run so far; they gave ${d} last time.`;
    case "new": return `${who} gave to ${f.campaignName} for the first time, ${d} between them.`;
    case "back": return `${who} came back to ${f.campaignName} after skipping ${f.compareName}, ${d} between them.`;
    default: return `${who}, ${d} between them.`;
  }
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayWords = d => (d ? `${MONTH_NAMES[Number(String(d).slice(5, 7)) - 1]} ${Number(String(d).slice(8, 10))}` : "a day not yet set");
const article = t => (/^[aeiou]/i.test(String(t || "")) ? `an ${t}` : `a ${t}`);

export function templateSentence(key, f) {
  f = f || {};
  switch (key) {
    case "appeal": {
      if (!f.compareName) return `There is no campaign from a year earlier to compare ${f.campaignName || "this campaign"} with yet.`;
      const diff = f.thisCents - f.lastCents;
      const dir = diff < 0 ? "under" : diff > 0 ? "over" : "level with";
      const head = diff === 0 ? `${f.campaignName} came in level with ${f.compareName}`
        : `${f.campaignName} came in ${dollars(diff)} ${dir} ${f.compareName}`;
      const top = f.topReason;
      if (!top || !top.cents) return `${head}.`;
      return `${head}, mostly because ${top.phrase}.`;
    }
    case "call": {
      if (!f.count) return "Nobody stands out for a call tomorrow morning; the Thread has what is already planned.";
      const first = f.first;
      const rest = f.count > 1 ? ` ${cap(plural(f.count - 1, "more name follows", "more names follow"))}; ${dollars(f.atStakeCents)} is at stake across all ${spell(f.count)}.` : "";
      return `Start with ${first.name}. ${first.reason}${rest}`;
    }
    case "retention": {
      if (f.lastYearDonors == null || f.lastYearDonors === 0) return "There were no donors last year to measure retention against.";
      const rate = f.rate == null ? null : `${f.rate}%`;
      const prev = f.prevRate == null ? null : `${f.prevRate}%`;
      const head = rate && prev ? `Retention is ${rate} this year against ${prev} last year`
        : rate ? `Retention is ${rate} this year` : "Retention this year";
      const top = f.topReason;
      if (!top || !top.count) return `${head}, and no group of donors stands out.`;
      return `${head}; the most donors were lost among ${top.phrase}.`;
    }
    case "person": {
      // ASK-3: one person. Where they stand, then the one thing to do.
      if (!f.name) return "That person isn't on file.";
      if (!f.lastGift) return `${f.name} hasn't given yet, so there is no giving to read.`;
      const st = f.stand;
      const where = st && st.thenCents > 0 && !st.nowCents
        ? `${f.name} gave ${dollars(st.thenCents)} to ${st.compareName} and nothing yet to ${st.campaignName}`
        : st && st.thenCents > st.nowCents
          ? `${f.name} gave ${dollars(st.nowCents)} to ${st.campaignName} against ${dollars(st.thenCents)} to ${st.compareName}`
          : `${f.name} last gave ${f.lastGiftPhrase}, ${dollars(f.lifetimeCents)} across ${plural(f.giftCount, "gift", "gifts")} since ${f.firstYear}`;
      const askLine = f.askCents ? ` Steward suggests asking for ${dollars(f.askCents)}.` : "";
      if (f.intent === "changed") {
        const a = f.lastYearToDateCents, b = f.thisYearCents;
        if (a === b) return `${f.name} has given ${dollars(b)} so far this year, the same as by this date last year.`;
        return `${f.name} gave ${a ? dollars(a) : "nothing"} by this date last year and ${b ? dollars(b) : "nothing"} so far this year.`;
      }
      if (f.intent === "next") {
        if (f.openStep) return `${f.name} has a step planned for ${dayWords(f.openStep.due)}, which reads "${String(f.openStep.label).trim().replace(/[.!?\s]+$/, "")}".${askLine}`;
        const talk = f.lastContact ? `the last conversation logged was ${article(f.lastContact.type)} ${f.lastContact.phrase}` : "no conversation with them is logged";
        return `Nothing is planned with ${f.name}, and ${talk}.${askLine || " A call is the next step."}`;
      }
      return `${where}.${askLine}`;
    }
    case "stopped": {
      if (!f.name) return "That donor isn't on file.";
      if (!f.lastGift) return `${f.name} hasn't given yet, so there is nothing to have stopped.`;
      if (!f.reasons || !f.reasons.length) return `${f.name} last gave ${f.lastGiftPhrase}, and nothing on their record changed before they stopped.`;
      // Facts on the record, not a cause: Steward says what is there.
      return `${f.name} last gave ${f.lastGiftPhrase}. On their record, ${f.reasons[0].phrase}.`;
    }
    case "lapse": {
      if (!f.count) return "Nobody is past their own usual gap between gifts right now.";
      return `${cap(plural(f.count, "donor is", "donors are"))} past their own usual gap between gifts, with ${dollars(f.atRiskCents)} of usual gifts between them; ${f.first.name} has gone longest.`;
    }
    case "volunteers": {
      if (!f.count) return "Every volunteer on file has given, or there are no volunteers yet.";
      return `${cap(plural(f.count, "volunteer has", "volunteers have"))} served and never given; ${f.first.name} leads with ${f.first.hours} hours this year.`;
    }
    case "second": {
      if (!f.count) return "Every first-time donor from the last 90 days has a second gift or a thank-you call on file.";
      return `${cap(plural(f.count, "first-time donor", "first-time donors"))} from the last 90 days ${f.count === 1 ? "has" : "have"} no second gift and no thank-you call, ${dollars(f.firstCents)} in first gifts; ${f.first.name} gave the most.`;
    }
    case "more": {
      if (!f.count) return "Nobody's own file shows room to give more yet; a screening file can add what the file can't see.";
      return `${cap(plural(f.count, "person shows", "people show"))} room to give more, ${spell(f.strong)} of them strong; start with ${f.first.name}.`;
    }
    default: return CANT_ANSWER;
  }
}

// ── The number check ───────────────────────────────────────────────────────
// The model writes the sentence; it never writes a fact. Every number in its
// sentence (a numeral, a dollar amount, a percentage, or a number word) must
// be one Steward computed, or the template sentence is shown instead. The
// allowed set is every number found anywhere in the facts, in dollars when a
// key ends in "Cents", plus the counts of every list.
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

export function allowedNumbers(facts) {
  const out = new Set();
  const add = v => { const n = Number(v); if (Number.isFinite(n)) { out.add(round2(n)); out.add(round2(Math.abs(n))); } };
  const walk = (v, k) => {
    if (v == null) return;
    if (Array.isArray(v)) { add(v.length); v.forEach(x => walk(x, k)); return; }
    if (typeof v === "object") { for (const [kk, vv] of Object.entries(v)) walk(vv, kk); return; }
    if (typeof v === "number") {
      if (/cents$/i.test(k || "")) add(v / 100); else add(v);
      return;
    }
    if (typeof v === "string") for (const n of numbersIn(v)) add(n);
  };
  walk(facts, "");
  return out;
}
const round2 = n => Math.round(n * 100) / 100;

// Every number a sentence states. Years inside a name ("Spring Appeal 2026")
// are numbers too, and they pass because the name is in the facts.
export function numbersIn(text) {
  const s = String(text || "");
  const found = [];
  const re = /\$?\d[\d,]*(?:\.\d+)?\s*(k\b|thousand\b|million\b)?/gi;
  let m;
  while ((m = re.exec(s))) {
    let n = Number(m[0].replace(/[$,\s]|k|thousand|million/gi, ""));
    if (/k\b|thousand/i.test(m[1] || "")) n *= 1000;
    if (/million/i.test(m[1] || "")) n *= 1e6;
    if (Number.isFinite(n)) found.push(n);
  }
  for (const w of s.toLowerCase().match(/[a-z]+/g) || []) if (NUMBER_WORDS[w] != null) found.push(NUMBER_WORDS[w]);
  return found;
}

// True when every number in `sentence` is one of the facts' numbers, and the
// sentence keeps the house rules a template keeps (no em dash, one sentence-ish).
export function sentencePasses(sentence, facts) {
  const s = String(sentence || "").trim();
  if (!s || s.length > 400 || /[—]/.test(s)) return false;
  const allowed = allowedNumbers(facts);
  return numbersIn(s).every(n => allowed.has(round2(n)));
}

// The prompt the model is given: the facts, and the job. Nothing else.
export function sentencePrompt(question, facts) {
  return [
    "You write one plain sentence for a nonprofit fundraiser that answers their question from the facts given.",
    "Use only numbers that appear in the facts. Do not round, estimate or add any number. Do not guess at causes the facts do not state.",
    "No em dashes, no colons, no lists. Spell numbers under ten as words. At most 40 words. Reply with the sentence only.",
    "",
    `Question: ${question}`,
    `Facts (JSON): ${JSON.stringify(facts)}`,
  ].join("\n");
}
