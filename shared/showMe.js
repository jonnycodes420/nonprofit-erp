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

import { US_STATES, stateCode } from "./usStates.js";

export const SHOW_KEYS = [
  "role", "level", "lifecycle", "retained", "given", "volunteer", "volActive", "household",
  "gaveFrom", "gaveTo", "notGaveFrom", "notGaveTo", "notDeceased", "monthly", "city", "gaveEvent", "gaveOver",
  // FIX-27: a campaign (and the year of the gift), and no ask this year.
  "gaveCampaign", "gaveCampaignYear", "notGaveCampaign", "notGaveCampaignYear", "noAsk",
  // ASK-2: a gift not yet thanked.
  "unthankedOver",
  // AI-FIX: the state on their address; nobody in touch since a date.
  "state", "noContactSince",
  // WIRE-1: every list can become a Group, and Show me reads the same rules.
  "attendedEvent", "registeredEvent", "member", "hasPledge", "recurring", "fundraiser", "funder", "openTask", "kind",
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
    || /^\s*(which|what)( of (my|our))?( \w+){0,2} (donors?|people|givers?|supporters?|volunteers?)\b/i.test(norm(text))
    // ASK-2: "who are our donors in Marblehead", "who should I thank".
    || /^\s*who are (our|my|the)\b/i.test(norm(text)) || /^\s*who (should|do|must) (i|we) thank\b/i.test(norm(text));
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
  "did do does yet so far still which what my i we been steward hey every each").split(" "));
// AI-FIX: "a while" is six months, and the words say the date it means.
const SPAN_DAYS = { "a while": 180, "awhile": 180, "a long time": 365, "ages": 365, "a year": 365, "this year": null };
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
function minusDays(ymdStr, n) { const d = new Date(ymdStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }
const STATE_NAMES = Object.values(US_STATES).map(n => n.toLowerCase()).sort((a, b) => b.length - a.length);

// ── AI OFF: THE TEMPLATES ─────────────────────────────────────────────────
// ctx: { today: "YYYY-MM-DD" (the org's), events: [{ id, name, date }] }
export function templateSpec(text, ctx = {}) {
  let s = " " + norm(text).toLowerCase().replace(/[?.!]+$/g, "") + " ";
  const rules = {};
  const thisYear = Number(String(ctx.today || "").slice(0, 4)) || new Date().getUTCFullYear();
  const yearOf = w => (w === "this year" ? thisYear : w === "last year" ? thisYear - 1 : Number(w));
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(...m); return " "; }); };
  const YEAR = "(this year|last year|(?:19|20)\\d{2})";

  // AI-FIX · NOBODY IN TOUCH: "donors I haven't reached out to in a while",
  // "haven't been contacted in six months", "no contact this year".
  const today = String(ctx.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const sinceFor = (span, n, unit) => {
    if (span && span in SPAN_DAYS) return SPAN_DAYS[span] == null ? `${today.slice(0, 4)}-01-01` : minusDays(today, SPAN_DAYS[span]);
    const k = Number(n) || NUM_WORDS[n] || 0; const per = /^day/.test(unit) ? 1 : /^week/.test(unit) ? 7 : /^month/.test(unit) ? 30 : 365;
    return k ? minusDays(today, k * per) : null;
  };
  take(/\b(?:that |who |whom )?(?:(?:i|we|nobody|no one|anyone) )?(?:haven't|have not|hasn't|has not|didn't|did not|not|never)(?: yet| been)? (?:reached out to|reached out|reached|contacted|called|talked to|talked with|spoken to|spoken with|been in touch with|in touch with|heard from|connected with|followed up with)(?: them| him| her)?(?: (?:in|for|since|over))? (?:the )?(?:last |past )?(a while|awhile|a long time|ages|a year|this year|(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (days?|weeks?|months?|years?))\b/g,
    (m, span, n, unit) => { const d = sinceFor(span && !n ? span : null, n, unit); if (d) rules.noContactSince = d; });
  take(/\bno (?:contact|outreach|calls?|conversations?)(?: logged)?(?: (?:in|for|since))? (?:the )?(?:last |past )?(a while|awhile|a long time|ages|a year|this year|(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (days?|weeks?|months?|years?))\b/g,
    (m, span, n, unit) => { const d = sinceFor(span && !n ? span : null, n, unit); if (d) rules.noContactSince = d; });
  // AI-FIX · A STATE: "in North Carolina", "in the state of Maine", "in NC"
  // (a two-letter code only as she typed it, in capitals, so "in me" is not Maine).
  const raw = norm(text);
  for (const m of raw.matchAll(/\b(?:in|from) ([A-Z]{2})\b/g)) if (US_STATES[m[1]]) { rules.state = m[1]; s = s.replace(new RegExp(`\\b(?:in|from) ${m[1].toLowerCase()}\\b`), " "); }
  take(new RegExp(`\\b(?:who )?(?:live |living |based |are |is )?(?:in|from) (?:the )?(?:state of )?(${STATE_NAMES.join("|")})\\b`, "g"),
    (m, name) => { rules.state = stateCode(name); });

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

  // ASK-2 · a gift not yet thanked: "gave over $500 but hasn't been thanked",
  // "who should I thank". It is any gift not yet marked thanked.
  take(/\b(who )?(gave|given|give) (over|more than|above) \$?([\d,]+(?:\.\d{1,2})?)( dollars)?,? (but |and )?(hasn't|haven't|has not|have not|wasn't|weren't|not)( yet)? (been )?thanked\b/g,
    (...m) => { rules.unthankedOver = String(Number(String(m[4]).replace(/,/g, ""))); });
  take(/\b(not|never|hasn't|haven't|has not|have not)( yet)? (been )?thanked\b|\bwho (should|do|must) (i|we) thank( this week| today| now)?\b|\bunthanked\b/g, () => { if (rules.unthankedOver === undefined) rules.unthankedOver = "0"; });

  // "never given" first, so "given" in it is not read as a gift window.
  take(/\b(who'?ve|who have|have|has|who has)? ?(never|not ever) (given|gave|donated)( anything)?( a gift)?\b/g, () => { rules.given = "never"; });
  take(/\b(who'?ve|who have|have|has)? ?given before\b/g, () => { rules.given = "ever"; });
  // Nothing in a year: "but not this year", "nothing this year", "haven't given this year".
  take(new RegExp(`\\b(but )?(not|nothing|no gift|no gifts|(hasn't|haven't|has not|have not|didn't|did not) (given|gave|give|donated))( yet)? (in )?${YEAR}( yet)?\\b`, "g"),
    (m, a, b, c, d, e, f, y) => { const r = yearRange(yearOf(y)); rules.notGaveFrom = r[0]; rules.notGaveTo = r[1]; });
  // Gave over an amount, to an event: "gave over $1,000 to the gala".
  take(/\b(gave|given|give|donated)? ?(over|more than|above) \$?([\d,]+(?:\.\d{1,2})?)( dollars)?\b/g,
    (m, g, o, n) => { rules.gaveOver = String(Number(String(n).replace(/,/g, ""))); });
  // "gave more than $10,000 this year": the year the amount is counted in.
  // HARDEN-1: the words BEFORE the year are kept. This used `take`, whose
  // replace overwrote the `s = pre` inside it, so "every donor in Marblehead
  // who gave more than $5,000 this year" lost "in Marblehead" without a word
  // and the Agent planned for 76 people instead of 9.
  if (rules.gaveOver !== undefined) s = s.replace(new RegExp(`^(.*?)\\b(in |during )?${YEAR}\\b`), (m, pre, i, y) => { const r = yearRange(yearOf(y)); rules.gaveFrom = r[0]; rules.gaveTo = r[1]; return pre + " "; });
  take(/\b(?:who )?(?:came to|attended|were at|went to) (?:an|any) event\b/g, () => { rules.attendedEvent = "any"; });
  take(/\b(?:who )?(?:came to|attended|were at|went to) (?:the |our )?([a-z0-9' -]{3,60}?)(?= (?:in|this|last|and|but|who|with|over|more)\b| $)/g, (m, name) => {
    const ev = matchEvent(name.trim(), ctx.events || []);
    if (ev) rules.attendedEvent = ev.id; else rules.__unsupported = (rules.__unsupported ? rules.__unsupported + ", " : "") + `came to ${name.trim()}`;
  });
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
  // WIRE-1: the list rules a plain question can name.
  take(/\b(?:with |who have |who made |who've made )?(?:an )?open pledges?\b|\bwith a pledge\b/g, () => { rules.hasPledge = "1"; });
  take(/\b(recurring|sustaining)( donors?| givers?| gifts?| giving)?\b/g, () => { rules.recurring = "1"; });
  take(/\b(?:peer[- ]to[- ]peer )?fundraisers\b/g, () => { rules.fundraiser = "1"; });
  take(/\bfunders\b/g, () => { rules.funder = "1"; });
  take(/\b(organizations|organisations)\b/g, () => { rules.kind = "organization"; });
  take(/\bwith (?:an )?open tasks?\b/g, () => { rules.openTask = "1"; });
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
  state: "a US state's two-letter postal code (NC for North Carolina): the state on their address",
  attendedEvent: "any, or the id of one of the org's events listed below: came to that event (attended or checked in)",
  registeredEvent: "any, or the id of one of the org's events listed below: registered for that event",
  member: "current, active, grace, lapsed or any: holds a membership in that state (current is active or in grace)",
  hasPledge: "1: has an open pledge",
  recurring: "1: has a recurring gift running at any interval",
  fundraiser: "1: runs a peer-to-peer fundraising page",
  funder: "1: funds a grant",
  openTask: "1: has an open task",
  kind: "person or organization: the kind of record",
  noContactSince: "YYYY-MM-DD: nobody has logged a call, meeting, email or stewardship with them on or after this date ('a while' is six months before today)",
};
// FIX-29: ONE LIST OF CONDITIONS, NOT ONE FIELD PER FILTER. A strict tool may
// carry at most 16 union-typed parameters ("string or null") and 24 optional
// ones; past either the API refuses the whole request (400), and the catch
// that should have fallen back to the templates hid it. One nullable field per
// filter was 18 the day PARITY-4 wrote it and 36 by WIRE-1. Now every filter
// is a { field, value } pair whose `field` is an enum of SHOW_KEYS: the same
// filters, no unions, nothing optional. tests/fix29-tool-schemas.test.js holds
// every strict tool to both limits.
export function specTool() {
  const help = SHOW_KEYS.map(k => `${k}: ${KEY_HELP[k]}`).join("\n");
  return {
    name: "filter_spec",
    description: "The donor list filters that answer the question. Use only these fields. Never guess a filter for something they cannot express; name it in unsupported.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        filters: { type: "array", description: `One entry per filter the question asks for, each field at most once. The fields and their values:\n${help}`,
          items: { type: "object", additionalProperties: false,
            properties: { field: { type: "string", enum: [...SHOW_KEYS] }, value: { type: "string" } }, required: ["field", "value"] } },
        suggestAsk: { type: "boolean", description: "true when the question asks what to ask them for (each person then shows their suggested ask). Not a filter." },
        unsupported: { type: "string", description: "Anything the question asks for that none of these filters can express, in a few words. Empty when every part is covered." },
      },
      required: ["filters", "suggestAsk", "unsupported"],
    },
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
  const rules = {};
  let unsupported = b.input.unsupported ? String(b.input.unsupported) : null;
  const withAsk = b.input.suggestAsk === true || String(b.input.suggestAsk || "") === "1";
  for (const f of Array.isArray(b.input.filters) ? b.input.filters : []) {
    if (!f || typeof f !== "object" || !f.field) continue;
    const k = String(f.field), v = f.value;
    if (v === null || v === undefined || v === "") continue;
    // One field said twice with two values ("in NC or SC") is a filter the
    // list cannot hold; refused, never the last one quietly kept.
    if (rules[k] !== undefined && rules[k] !== String(v)) { unsupported = unsupported || `two values for one filter (${k})`; continue; }
    rules[k] = String(v);
  }
  // A state the model wrote out ("North Carolina") is filed by its code.
  if (rules.state) { const c = stateCode(rules.state); if (c) rules.state = c; }
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
  for (const k of ["gaveEvent", "attendedEvent", "registeredEvent"]) {
    if (!raw[k] || (k !== "gaveEvent" && raw[k] === "any")) continue;
    if (!events.some(e => e.id === raw[k])) return { ok: false, refused: "an event Steward does not have" };
  }
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
  if (rules.unthankedOver !== undefined) w.push(Number(rules.unthankedOver) > 0 ? `a gift over $${Number(rules.unthankedOver).toLocaleString("en-US")} not yet thanked` : "a gift not yet thanked");
  if (rules.city) w.push(`in ${rules.city}`);
  if (rules.state) w.push(`in ${US_STATES[rules.state] || rules.state}`);
  if (rules.noContactSince) w.push(`no contact logged since ${dayWords(rules.noContactSince)}`);
  if (rules.household) w.push(rules.household === "none" ? "not in a household" : "in a household");
  if (rules.kind) w.push(rules.kind === "organization" ? "organizations" : "people, not organizations");
  if (rules.attendedEvent) w.push(rules.attendedEvent === "any" ? "came to an event" : `came to ${evName(rules.attendedEvent)}`);
  if (rules.registeredEvent) w.push(rules.registeredEvent === "any" ? "registered for an event" : `registered for ${evName(rules.registeredEvent)}`);
  if (rules.member) w.push({ current: "a member now", active: "an active member", grace: "a member in grace", lapsed: "a lapsed member", any: "a member, now or before" }[rules.member] || "a member");
  if (rules.hasPledge) w.push("an open pledge");
  if (rules.recurring) w.push("a recurring gift running");
  if (rules.fundraiser) w.push("runs a peer-to-peer page");
  if (rules.funder) w.push("funds a grant");
  if (rules.openTask) w.push("an open task");
  if (rules.notDeceased) w.push("not deceased");
  return w.map((x, i) => (i === 0 ? cap(x) : x));
}

function dayWords(d) {
  const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${M[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : String(d);
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
