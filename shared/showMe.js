// shared/showMe.js · PARITY-4 Part 3. SHOW ME, IN PLAIN WORDS.
//
// A "show me" or "who" question becomes a LIST, not a sentence. The question
// is turned into a filter spec, and the spec may hold only the Donors list's
// own filters (groups.js buildDonorFilter, the same rules a Group keeps), from
// SHOW_KEYS below. Anything the question asks that no filter covers is
// REFUSED with "Steward can't filter by that yet"; it is never guessed and
// never quietly dropped, because a dropped condition is a longer list that
// still claims to answer the question.
//
// Two ways in, one check:
//   templateSpec   AI off (or the model unavailable): a small set of phrase
//                  recognisers. A word left over that no recogniser used and
//                  that is not a plain connecting word is a refusal.
//   modelSpec      AI on: the model fills a strict tool schema whose fields
//                  are SHOW_KEYS and nothing else, plus `unsupported`. The
//                  model never writes SQL and never sees a row.
// Both go through checkSpec, which refuses an unknown key, a bad value, an
// event that is not the org's, or a non-empty `unsupported`.
//
// House style for the words: no colons, no em dashes.

export const SHOW_KEYS = [
  "role", "level", "lifecycle", "retained", "given", "volunteer", "volActive", "household",
  "gaveFrom", "gaveTo", "notGaveFrom", "notGaveTo", "notDeceased", "monthly", "city", "gaveEvent", "gaveOver",
  // FIX-27: a campaign (and the year of the gift), and no ask this year.
  "gaveCampaign", "gaveCampaignYear", "notGaveCampaign", "notGaveCampaignYear", "noAsk",
];
export const CANT_FILTER = "Steward can't filter by that yet";

// A typed question is a "show me" question when it asks for a list.
const SHOW_PREFIX = /^\s*(show( me)?|list|find|pull( up)?|give me|get me)\b/i;
const LIST_START = /^\s*(all |our |the )?(monthly |major |mid[- ]level |new |lapsed |recurring )?(donors?|people|volunteers?|givers?|supporters?|members?|everyone|everybody|anyone)\b/i;
// listFirst: the question is plainly a list ("show me…", "donors who…"), so
// it is a list before the eight why questions are tried. isShowMe: a "who"
// question none of the eight took ("who stopped giving" stays retention).
export function listFirst(text) {
  const s = norm(text);
  return SHOW_PREFIX.test(s) || LIST_START.test(s);
}
export function isShowMe(text) {
  return listFirst(text) || /^\s*who\b.*\b(gave|give|gives|giving|given|donated|volunteer)/i.test(norm(text))
    // FIX-27: "which major donors haven't been asked" is a list, once none of
    // the why questions has taken it.
    || /^\s*(which|what)( of (my|our))?( \w+){0,2} (donors?|people|givers?|supporters?|volunteers?)\b/i.test(norm(text));
}

function norm(text) {
  return String(text || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function yearRange(y) { return [ymd(y, 1, 1), ymd(y, 12, 31)]; }

// The words that may be left over without meaning anything.
const FILLER = new Set(("show me list find pull up give get all our the a an of who whom that which have has had " +
  "and but or with to at for in on from were was are is be been who've who'd they them their people donors donor " +
  "everyone everybody anyone givers giver supporters supporter members member someone ones any please also just " +
  "did do does yet so far still which what my i we been").split(" "));

// ── AI OFF: THE TEMPLATES ─────────────────────────────────────────────────
// ctx: { today: "YYYY-MM-DD" (the org's), events: [{ id, name, date }] }
export function templateSpec(text, ctx = {}) {
  let s = " " + norm(text).toLowerCase().replace(/[?.!]+$/g, "") + " ";
  const rules = {};
  const thisYear = Number(String(ctx.today || "").slice(0, 4)) || new Date().getUTCFullYear();
  const yearOf = w => (w === "this year" ? thisYear : w === "last year" ? thisYear - 1 : Number(w));
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(...m); return " "; }); };
  const YEAR = "(this year|last year|(?:19|20)\\d{2})";

  // FIX-27 · NO ASK THIS YEAR, and "what should I ask them" (the list then
  // carries each person's suggested ask; it is not a filter).
  take(/\b(who )?(have|has|haven't|hasn't|have not|has not)? ?(not )?(been asked|asked)( for (a|anything|money|a gift))?( (yet|this year|in the last (12|twelve) months))?\b(?! (them|for|about))/g, (m, w, h, n) => {
    if (/haven't|hasn't|\bnot\b/.test(m)) rules.noAsk = "1"; else rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + "asked";
  });
  take(/\b(with )?no ask( this year)?\b/g, () => { rules.noAsk = "1"; });
  take(/\b(we|i) (haven't|have not|didn't|did not) asked?( this year| yet)?\b/g, () => { rules.noAsk = "1"; });
  take(/\b(and )?(what|how much) (should|do|would|could|can) (i|we) ask( them| each of them| for)?( for)?\b/g, () => { rules.__withAsk = true; });
  // FIX-27 · A CAMPAIGN, by name: "gave to last year's spring appeal but not
  // this year's". Each side names its campaign through the year, so it is the
  // campaign that is found, never a guess at gift dates.
  const CY = "(last year's|this year's|(?:19|20)\\d{2}'?s?|the|our)";
  const yearWord = w => (!w ? null : /last year/.test(w) ? thisYear - 1 : /this year/.test(w) ? thisYear : /^(19|20)\d{2}/.test(w) ? Number(w.slice(0, 4)) : null);
  take(new RegExp(`\\b(?:(?:gave|given|donated|give)\\s+)?to ${CY} ([a-z0-9' -]{3,60}?),? but (?:not|haven't|hasn't|didn't)(?: (?:given|gave|give|donated))?(?: to)? ${CY}( one)?(?= |$)`, "g"),
    (m, y1, name, y2) => {
      const a = matchCampaign(name, yearWord(y1), ctx.campaigns || []), b = matchCampaign(name, yearWord(y2), ctx.campaigns || []);
      if (a && b && a.id !== b.id) { rules.gaveCampaign = a.id; rules.notGaveCampaign = b.id; }
      else rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + `to ${name.trim()}`;
    });
  take(new RegExp(`\\b(?:(?:gave|given|donated|give)\\s+)?to (last year's|this year's|(?:19|20)\\d{2}'?s?) ([a-z0-9' -]{3,60}?)(?= (?:in|and|but|who|with|over|more)\\b| $)`, "g"),
    (m, y1, name) => {
      const a = matchCampaign(name, yearWord(y1), ctx.campaigns || []);
      if (a) rules.gaveCampaign = a.id; else rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + `to ${name.trim()}`;
    });

  // "last year's spring givers": the campaign by its givers.
  take(new RegExp(`\\b(last year's|this year's|(?:19|20)\\d{2}'?s?) ([a-z0-9' -]{3,40}?) (givers|donors|supporters)\\b`, "g"),
    (m, y1, name) => {
      const a = matchCampaign(name, yearWord(y1), ctx.campaigns || []);
      if (a) rules.gaveCampaign = a.id; else rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + `${name.trim()} givers`;
    });

  // "never given" first, so "given" in it is not read as a gift window.
  take(/\b(who'?ve|who have|have|has|who has)? ?(never|not ever) (given|gave|donated)( anything)?( a gift)?\b/g, () => { rules.given = "never"; });
  take(/\b(who'?ve|who have|have|has)? ?given before\b/g, () => { rules.given = "ever"; });
  // Nothing in a year: "but not this year", "nothing this year", "haven't given this year".
  take(new RegExp(`\\b(but )?(not|nothing|no gift|no gifts|(hasn't|haven't|has not|have not|didn't|did not) (given|gave|give|donated))( yet)? (in )?${YEAR}( yet)?\\b`, "g"),
    (m, a, b, c, d, e, f, y) => { const r = yearRange(yearOf(y)); rules.notGaveFrom = r[0]; rules.notGaveTo = r[1]; });
  // Gave over an amount, to an event: "gave over $1,000 to the gala".
  take(/\b(gave|given|give|donated)? ?(over|more than|above) \$?([\d,]+(?:\.\d{1,2})?)( dollars)?\b/g,
    (m, g, o, n) => { rules.gaveOver = String(Number(String(n).replace(/,/g, ""))); });
  // To or at an event the org has: "to the gala", "at the Harbor Lights Gala".
  take(/\b(?:(?:gave|given|donated)\s+)?(?:to|at) (?:the |our )?([a-z0-9' -]{3,60}?)(?= (?:in|this|last|and|but|who|with|over|more)\b| $)/g, (m, name) => {
    const n = name.trim();
    const ev = matchEvent(n, ctx.events || []);
    const cp = ev ? null : matchCampaign(n, null, ctx.campaigns || []);
    if (ev) rules.gaveEvent = ev.id;
    else if (cp) rules.gaveCampaign = cp.id;
    else rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + `to ${n}`;
  });
  // Gave in a year: "gave last year", "gave in 2025", "donated this year".
  take(new RegExp(`\\b(gave|given|donated|giving|gift|gifts)( to us)? (in |during )?${YEAR}\\b`, "g"),
    (...m) => { const r = yearRange(yearOf(m[4])); rules.gaveFrom = r[0]; rules.gaveTo = r[1]; });
  take(/\b(monthly|every month|recurring monthly)( donors?| givers?| gifts?| giving)?\b/g, () => { rules.monthly = "1"; });
  take(/\b(gives?|giving) monthly\b/g, () => { rules.monthly = "1"; });
  take(/\bvolunteers?\b/g, () => { rules.role = "volunteer"; });
  take(/\blapsed\b/g, () => { rules.lifecycle = "lapsed"; });
  take(/\b(new donors?|first[- ]time donors?)\b/g, () => { rules.lifecycle = "new"; });
  take(/\brecaptured\b/g, () => { rules.lifecycle = "recaptured"; });
  take(/\bmajor( donors?| givers?)?\b/g, () => { rules.level = "major"; });
  take(/\bmid[- ]level( donors?)?\b/g, () => { rules.level = "mid"; });
  take(/\bretained\b/g, () => { rules.retained = "1"; });
  take(/\bnot in a household\b/g, () => { rules.household = "none"; });
  take(/\bin a household\b/g, () => { rules.household = "any"; });
  take(/\b(?:who )?(?:live|living|based|are|is)? ?(?:in|from) ([a-z][a-z.'-]*(?: [a-z][a-z.'-]*){0,2}?)(?= (?:who|and|but|that|with|over|more|gave)\b| $)/g, (m, city) => {
    const c = city.trim();
    if (/^(this|last|the|a|an|our|19\d\d|20\d\d)\b/.test(c)) { rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + `in ${c}`; return; }
    rules.city = c.replace(/\b[a-z]/g, ch => ch.toUpperCase());
  });

  const left = s.split(/[\s,]+/).map(w => w.replace(/[^a-z0-9'$]/g, "")).filter(w => w && !FILLER.has(w));
  const unsupported = [rules.__unsupported, left.length ? left.join(" ") : null].filter(Boolean).join(", ") || null;
  const withAsk = !!rules.__withAsk;
  delete rules.__unsupported; delete rules.__withAsk;
  return { rules, unsupported, withAsk };
}

// An event named in the question: every word the person typed is in the
// event's name ("gala" finds "Harbor Lights Gala"); the most recent wins.
export function matchEvent(name, events) {
  const words = String(name || "").toLowerCase().replace(/\b(the|our|event|night|dinner party)\b/g, " ").split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return null;
  const hits = (events || []).filter(e => { const n = String(e.name || "").toLowerCase(); return words.every(w => n.includes(w)); });
  hits.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return hits[0] || null;
}

// A campaign named in the question, the same way: every word typed is in the
// campaign's name. A year, when said ("last year's"), picks the campaign whose
// name or start date carries it; otherwise the most recent wins.
export function matchCampaign(name, year, campaigns) {
  const words = String(name || "").toLowerCase().replace(/\b(the|our|campaign|one)\b/g, " ").split(/\s+/).filter(w => w.length > 1 && !/^(19|20)\d{2}$/.test(w));
  if (!words.length) return null;
  let hits = (campaigns || []).filter(c => { const n = String(c.name || "").toLowerCase(); return words.every(w => n.includes(w)); });
  if (year) hits = hits.filter(c => String(c.name || "").includes(String(year)) || String(c.startDate || "").slice(0, 4) === String(year));
  hits.sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));
  return hits[0] || null;
}

// ── AI ON: THE MODEL FILLS A FORM ─────────────────────────────────────────
const KEY_HELP = {
  role: "donor, volunteer or staff_board: the kind of person",
  level: "general, mid or major: giving level on the last 12 months",
  lifecycle: "new, current, recaptured or lapsed",
  retained: "1: gave last calendar year and again this one",
  given: "never or ever: whether they have ever given a gift",
  volunteer: "1: has volunteered",
  volActive: "1: an hour volunteered in the last twelve months, or a shift to come",
  household: "any or none: in a household or not",
  gaveFrom: "YYYY-MM-DD: gave on or after this date (with gaveTo)",
  gaveTo: "YYYY-MM-DD: gave on or before this date (with gaveFrom)",
  notGaveFrom: "YYYY-MM-DD: gave nothing on or after this date (with notGaveTo)",
  notGaveTo: "YYYY-MM-DD: gave nothing on or before this date (with notGaveFrom)",
  notDeceased: "1: leave out people marked deceased",
  monthly: "1: has a monthly recurring gift running",
  city: "a city name, exactly as written in the question",
  gaveEvent: "the id of one of the org's events listed below: gave to that event",
  gaveOver: "a number of dollars: gave more than this in all (to the event and in the dates above, when given)",
  gaveCampaign: "the id of one of the org's campaigns listed below: gave to that campaign",
  gaveCampaignYear: "YYYY: only gifts to gaveCampaign dated in this calendar year (only with gaveCampaign)",
  notGaveCampaign: "the id of one of the org's campaigns listed below: has NOT given to that campaign",
  notGaveCampaignYear: "YYYY: only gifts to notGaveCampaign dated in this calendar year (only with notGaveCampaign)",
  noAsk: "1: no ask this year (no proposal open, and nothing asked of them in the last twelve months)",
};
export function specTool() {
  const props = {};
  for (const k of SHOW_KEYS) props[k] = { type: ["string", "null"], description: KEY_HELP[k] };
  props.suggestAsk = { type: ["string", "null"], description: "1 when the question asks what to ask them for (each person then shows their suggested ask). Not a filter." };
  props.unsupported = { type: ["string", "null"], description: "Anything the question asks for that none of these filters can express, in a few words. Null when every part is covered." };
  return {
    name: "filter_spec",
    description: "The donor list filters that answer the question. Use only these fields. Never guess a filter for something they cannot express; name it in unsupported.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, properties: props, required: [...SHOW_KEYS, "suggestAsk", "unsupported"] },
  };
}
export function specPrompt(question, ctx = {}) {
  const ev = (ctx.events || []).slice(0, 40).map(e => `${e.id}: ${e.name}${e.date ? ` (${String(e.date).slice(0, 10)})` : ""}`).join("\n") || "(none)";
  return `Turn this question about a nonprofit's supporters into donor list filters, using the filter_spec tool.\n` +
    `Today is ${ctx.today}. "This year" and "last year" are calendar years.\n` +
    `The org's events (id: name):\n${ev}\n` +
    `The org's campaigns (id: name):\n${(ctx.campaigns || []).slice(0, 60).map(c => `${c.id}: ${c.name}`).join("\n") || "(none)"}\n\nQuestion: ${question}`;
}
// The model's form, as a plain object: the tool call's input, or null.
export function readToolSpec(content) {
  const b = (content || []).find(x => x && x.type === "tool_use" && x.name === "filter_spec");
  if (!b || !b.input || typeof b.input !== "object") return null;
  const rules = {}; let unsupported = null, withAsk = false;
  for (const [k, v] of Object.entries(b.input)) {
    if (k === "unsupported") { unsupported = v ? String(v) : null; continue; }
    if (k === "suggestAsk") { withAsk = String(v || "") === "1" || v === true; continue; }
    if (v === null || v === undefined || v === "") continue;
    rules[k] = String(v);
  }
  return { rules, unsupported, withAsk };
}

// ── THE ONE CHECK ─────────────────────────────────────────────────────────
// `normalizeRules` is groups.js's (passed in, so this module reads no table).
export function checkSpec(spec, { normalizeRules, ruleKeys, events = [], campaigns = [] }) {
  if (!spec) return { ok: false, refused: "unread" };
  if (spec.unsupported) return { ok: false, refused: spec.unsupported };
  const raw = spec.rules || {};
  for (const k of Object.keys(raw)) {
    if (!SHOW_KEYS.includes(k) || !(ruleKeys || []).includes(k)) return { ok: false, refused: k };
  }
  if (raw.gaveEvent && !events.some(e => e.id === raw.gaveEvent)) return { ok: false, refused: "an event Steward does not have" };
  for (const k of ["gaveCampaign", "notGaveCampaign"])
    if (raw[k] && !campaigns.some(c => c.id === raw[k])) return { ok: false, refused: "a campaign Steward does not have" };
  const meaningful = Object.keys(raw).filter(k => k !== "notDeceased");
  if (!meaningful.length && spec.withAsk) return { ok: false, refused: "who to ask" };
  if (!meaningful.length) return { ok: false, refused: "nothing Steward recognised" };
  const n = normalizeRules({ ...raw, notDeceased: "1" });
  if (!n.ok) return { ok: false, refused: n.errors[0] };
  // A value normalizeRules dropped (a "monthly" of "yes") is a filter that
  // would be missing from the list: refuse it rather than widen the list.
  for (const k of Object.keys(raw)) if (n.rules[k] === undefined) return { ok: false, refused: k };
  return { ok: true, rules: n.rules };
}

// ── THE FILTERS IN WORDS ──────────────────────────────────────────────────
// "Gave in 2025 · nothing in 2026 · not deceased"
const WHOLE_YEAR = (from, to) => from && to && from.slice(0, 4) === to.slice(0, 4) && from.slice(5) === "01-01" && to.slice(5) === "12-31";
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export function filterWords(rules = {}, ctx = {}) {
  const w = [];
  const evName = id => ((ctx.events || []).find(e => e.id === id) || {}).name || "one event";
  const span = (f, t) => (WHOLE_YEAR(f, t) ? `in ${f.slice(0, 4)}` : `${f || "any time"} to ${t || "today"}`);
  if (rules.role) w.push({ donor: "donors", volunteer: "volunteers", staff_board: "staff and board" }[rules.role] || rules.role);
  if (rules.level) w.push(`${rules.level} donors`);
  if (rules.lifecycle) w.push(`tagged ${rules.lifecycle}`);
  if (rules.retained) w.push("tagged retained");
  if (rules.monthly) w.push("gives monthly");
  if (rules.volunteer) w.push("has volunteered");
  if (rules.volActive) w.push("an active volunteer");
  if (rules.given === "never") w.push("never given");
  if (rules.given === "ever") w.push("has given");
  const amt = rules.gaveOver !== undefined ? `more than $${Number(rules.gaveOver).toLocaleString("en-US")}` : "";
  if (rules.gaveEvent) w.push(`gave ${amt ? amt + " " : ""}to ${evName(rules.gaveEvent)}`);
  if (rules.gaveFrom || rules.gaveTo) w.push(`gave ${!rules.gaveEvent && amt ? amt + " " : ""}${span(rules.gaveFrom, rules.gaveTo)}`);
  if (amt && !rules.gaveEvent && !(rules.gaveFrom || rules.gaveTo)) w.push(`gave ${amt} in all`);
  if (rules.notGaveFrom || rules.notGaveTo) w.push(`nothing ${span(rules.notGaveFrom, rules.notGaveTo)}`);
  const cName = id => ((ctx.campaigns || []).find(c => c.id === id) || {}).name || "one campaign";
  if (rules.gaveCampaign) w.push(`gave to ${cName(rules.gaveCampaign)}${rules.gaveCampaignYear ? ` in ${rules.gaveCampaignYear}` : ""}`);
  if (rules.notGaveCampaign) w.push(`nothing to ${cName(rules.notGaveCampaign)}${rules.notGaveCampaignYear ? ` in ${rules.notGaveCampaignYear}` : ""}`);
  if (rules.noAsk) w.push("no ask this year");
  if (rules.city) w.push(`in ${rules.city}`);
  if (rules.household) w.push(rules.household === "none" ? "not in a household" : "in a household");
  if (rules.notDeceased) w.push("not deceased");
  return w.map((x, i) => (i === 0 ? cap(x) : x));
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
export function listSentence(count) {
  const n = count < 10 ? WORDS[count] : Number(count).toLocaleString("en-US");
  if (!count) return "Nobody on file matches these filters today.";
  return count === 1 ? "One person matches." : `${n} people match.`;
}
export function refusalSentence(what) {
  return `${CANT_FILTER}${what && what !== "unread" ? ` (${String(what).slice(0, 80)})` : ""}. Nothing was changed, and we've noted the question.`;
}

// The questions Home and Reports offer as examples.
export const EXAMPLES = [
  "Donors who gave last year but not this year",
  "Monthly donors in Lexington",
  "Everyone who gave over $1,000 to the gala",
  "Volunteers who've never given",
];
