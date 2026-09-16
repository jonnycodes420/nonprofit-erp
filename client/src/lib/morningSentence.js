// BUILD-86 — THE SENTENCE AT THE TOP OF HER MORNING.
//
// Assembled from what is actually waiting, never generic. Three sources, each
// of which already exists and is already capped: the Thread queue (BUILD-85),
// Drift, and the monthly gifts that are failing. A source with nothing to say
// contributes no clause — the sentence is short because her morning is, not
// because a template had blanks.
//
// THE RULES THIS FILE IS BUILT ON
//
//  1. NEVER A TEMPLATE WITH HOLES. "You have 0 people to thank and 0 donors
//     drifting" is worse than silence: it is the product filling a screen with
//     its own scaffolding. A clause appears only when its source has content.
//  2. A NAME BEATS A COUNT. Where there is one thing, it is named ("Harmon is
//     at day 24"). Where there are several, the count leads and the most
//     urgent one is still named. A number with nobody attached tells her
//     nothing she can act on.
//  3. NOTHING WAITING IS AN ANSWER. "Nothing is waiting on you this morning."
//     is allowed to be the whole screen, and it is a good morning, not an
//     empty state to apologise for.
//
// Pure: no clock, no fetch, no JSX. The caller passes what it already has.

// COMMA-SEPARATED, NO "AND". The brief's own example is
// "Three people to thank, Harmon is at day 24, two sponsors lapsed over the
// weekend" — a list of facts, evenly weighted, read out loud. An "and" before
// the last one makes the third fact sound like a conclusion, and it also
// collided with the comma inside the Thread's own clause. Each fact is its own
// clause instead, which is why threadClauses returns an array.
function joinClauses(parts) {
  return parts.join(", ");
}

// SMALL NUMBERS ARE SPELLED, the way the brief's own example writes them:
// "Three people to thank, Harmon is at day 24, two sponsors lapsed over the
// weekend." A sentence read aloud does not open with a numeral. Past twelve
// the digit is easier to take in than the word, which is also why the DAY
// COUNT stays a numeral throughout — "day 24" is a reading, not a count of
// things, and "day twenty-four" would be worse.
const WORDS = ["zero", "one", "two", "three", "four", "five", "six",
               "seven", "eight", "nine", "ten", "eleven", "twelve"];
function spell(n, { capitalize = false } = {}) {
  const w = n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
  return capitalize && /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}
const plural = (n, one, many) => `${spell(n)} ${n === 1 ? one : many}`;

// The Thread clause. Overdue is the fact worth leading with; where nothing is
// overdue the clause is about what is due, and where neither, the queue says
// nothing at all rather than reporting its own emptiness.
function threadClauses(threads) {
  const list = Array.isArray(threads?.list) ? threads.list : [];
  if (list.length === 0) return [];
  const overdue = list.filter(t => t.overdue);
  if (overdue.length === 0) {
    return [`${plural(list.length, "conversation", "conversations")} to pick back up`];
  }
  // The oldest overdue is the one that has been waiting longest on her, and it
  // is the clause people quote back. It gets its OWN clause, named, with its
  // day count — the brief's "Harmon is at day 24".
  const worst = overdue.reduce((m, t) => (t.daysOpen > m.daysOpen ? t : m), overdue[0]);
  const who = lastName(worst.donorName);
  // "DAY 0" MUST NEVER REACH THE SCREEN. A thread PLANNED today against a date
  // already past is genuinely overdue and genuinely zero days open, and "day 0"
  // is not a thing anybody says. Where the thread has no age yet, the honest
  // measure is how late it is — which is also the fact she can act on. Found by
  // the walk on a fresh org, where every thread is opened the same morning.
  const phrase = worst.daysOpen >= 1
    ? `${who} is at day ${worst.daysOpen}`
    : `${who} is ${plural(Math.max(1, overdueDaysOf(worst)), "day", "days")} overdue`;
  if (overdue.length === 1) return [phrase];
  return [`${plural(overdue.length, "conversation", "conversations")} overdue`, phrase];
}

// How late a thread is. The SERVER computes this, on the org's civil calendar,
// and ships it on the row — this only reads it. Deriving it here from the
// browser clock put "24 days overdue" in the sentence directly above a row
// reading "Overdue 23 days": two numbers for one fact, on one screen, which is
// the class of defect this product treats as a bug rather than a rounding.
function overdueDaysOf(t) {
  const n = Number(t.overdueDays);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function driftClause(drift) {
  const list = Array.isArray(drift?.list) ? drift.list : [];
  if (list.length === 0) return null;
  if (list.length === 1) return `${lastName(list[0].donorName || list[0].name)} has gone quiet`;
  return `${plural(list.length, "donor has", "donors have")} gone quiet`;
}

// The window is SEVEN DAYS, not "since her last login". There is no
// last-login stamp on this path, and wanting one is also wrong: a fundraiser
// back from two weeks away would meet fourteen days of failures on her calmest
// screen. Seven days is stable morning to morning and is a length a person can
// hold. (audit/BUILD-86-FINDINGS.md A1.)
export const RECURRING_WINDOW_DAYS = 7;

function recurringClause(atRisk, nowMs, windowDays = RECURRING_WINDOW_DAYS) {
  const list = Array.isArray(atRisk) ? atRisk : [];
  if (list.length === 0) return null;
  const recent = list.filter(r => {
    if (!r.first_failed_at) return true;          // no stamp: it is still failing now
    const t = new Date(r.first_failed_at).getTime();
    return Number.isFinite(t) && nowMs - t <= windowDays * 86400000;
  });
  if (recent.length === 0) return null;
  if (recent.length === 1) return `${lastName(recent[0].donor_name)}'s monthly gift stopped`;
  return `${plural(recent.length, "monthly gift", "monthly gifts")} stopped`;
}

// "Margaret Chen" → "Chen". A surname is how a fundraiser refers to a donor
// out loud, and the sentence is read out loud. A single-word name stays whole,
// and an organisation keeps its full name — "Sunrise Foundation" must not
// become "Foundation".
const ORG_WORDS = /\b(foundation|trust|fund|inc|llc|ltd|company|co|corp|church|ministries|society|association|club|group|partners|charities|charity)\b/i;
export function lastName(full) {
  const s = String(full || "").trim().replace(/\s+/g, " ");
  if (!s) return "Someone";
  if (ORG_WORDS.test(s)) return s;
  const parts = s.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  // A suffix is not a surname.
  if (/^(jr|sr|ii|iii|iv|md|phd|esq)\.?$/i.test(last) && parts.length >= 3) return parts[parts.length - 2];
  return last;
}

export const NOTHING_WAITING = "Nothing is waiting on you this morning.";

// The sentence. `nowMs` is passed rather than read, so a test pins it instead
// of racing it (the BUILD-84 rule: never write a guard that measures the
// calendar).
export function morningSentence({ threads, drift, atRisk } = {}, nowMs = Date.now()) {
  const clauses = [...threadClauses(threads), driftClause(drift), recurringClause(atRisk, nowMs)].filter(Boolean);
  if (clauses.length === 0) return NOTHING_WAITING;
  const sentence = joinClauses(clauses);
  // A leading numeral is left alone (nothing to capitalise); a leading word is
  // capitalised. Either way the sentence ends in a full stop.
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}
