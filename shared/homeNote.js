// shared/homeNote.js — BUILD-86 C.2. THE NOTE AT THE TOP OF HER MORNING.
//
// Part A shipped a sentence and it read like a log line: "Chen is at day 7."
// True, and written by a machine. This is the same facts written the way a
// colleague would leave them on your desk.
//
//   "Margaret Chen asked for the import report a week ago and hasn't heard
//    back. Two sponsors have gone quiet, and two cards failed over the
//    weekend."
//
// THE GRAMMAR, and every rule in it exists because the alternative sounded
// like software:
//
//  1. LEAD WITH THE PERSON when one thing is overdue. A name is what she
//     actually has to do something about; a count of one is a machine
//     counting. Lead with the COUNT when there are several, and still name
//     the one who has waited longest, because "three people" with nobody
//     named is a number she cannot start on.
//  2. NO "DAY 7". Nobody says that. Time is relative and in words:
//     yesterday, a week ago, two weeks ago, last month.
//  3. SPELL NUMBERS UNDER TEN. A sentence read aloud does not open with a
//     numeral.
//  4. NO COLONS AND NO EM DASHES. Both are how a machine punctuates a list.
//     A semicolon is allowed; it is how a person joins two related facts.
//  5. HER WORDS. `t` comes from shared/vocabulary.js, so a shop with sponsors
//     reads about sponsors.
//  6. NOTHING WAITING IS A GOOD MORNING, not an empty state to apologise for.
//
// Pure: no clock, no fetch, no JSX. `today` is a civil date the caller passes.

import { makeT, giverCountWord } from "./vocabulary.js";
import { threadFigures, rowFigure } from "./threadFigures.js";

export const NOTHING_WAITING = "Nothing is waiting on you this morning.";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export function spell(n) { return n >= 0 && n < WORDS.length ? WORDS[n] : String(n); }
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Time, in words ─────────────────────────────────────────────────────────
// A fundraiser says "a week ago", never "7 days ago", and certainly never
// "day 7". Past a month the exact figure stops helping and the phrase becomes
// the point: something has been sitting a long time.
export function agoPhrase(days) {
  const d = Math.max(0, Math.round(Number(days) || 0));
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${durationPhrase(d)} ago`;
}

// The same span WITHOUT "ago", for the sentences that say how long somebody
// has been waiting rather than when something happened. "Chen has waited
// longest, a week and a half ago" is not English; "has been waiting a week and
// a half" is. One function per grammatical job.
export function durationPhrase(days) {
  const d = Math.max(0, Math.round(Number(days) || 0));
  if (d <= 1) return "a day";
  if (d < 6) return `${spell(d)} days`;
  if (d < 9) return "a week";
  if (d < 13) return "a week and a half";
  if (d < 18) return "two weeks";
  if (d < 25) return "three weeks";
  if (d < 45) return "a month";
  if (d < 75) return "two months";
  return "months";
}

// ── What the step actually was ─────────────────────────────────────────────
// The thread carries the step she wrote ("Send the import report", "Call about
// the gala"). The note reads it back from HER side of the conversation: what
// the donor asked for, or what she said she would do. A step whose verb we do
// not recognise falls through to the plain shape rather than being mangled.
// EACH SHAPE WRITES ITS OWN SENTENCE. A shared tail produced "is expecting a
// call about the gala two weeks ago and hasn't heard back" — a tense clash you
// only hear by reading it out, which is why the fixture in docs/build86 exists.
const STEP_SHAPES = [
  { re: /^(?:send|share|email|mail|forward) (?:the |a |an )?(.+)$/i,
    say: (who, o, ago) => `${who} asked for ${withArticle(o)} ${ago} and hasn't heard back.` },
  { re: /^(?:follow up on|check in on|circle back on) (?:the |a |an )?(.+)$/i,
    say: (who, o, ago) => `${who} is still waiting to hear about ${withArticle(o)}, ${ago}.` },
  { re: /^call (?:about|on|re) (?:the |a |an )?(.+)$/i,
    say: (who, o, ago) => `You meant to call ${who} about ${withArticle(o)} ${ago}.` },
  { re: /^(?:call|ring|phone)$/i,
    say: (who, _o, ago) => `You meant to call ${who} ${ago}.` },
];

function withArticle(o) {
  const s = String(o || "").trim();
  if (!s) return s;
  // A proper noun or something already carrying its own determiner keeps it.
  if (/^(the|a|an|his|her|their|your|our|my)\b/i.test(s)) return s;
  if (/^[A-Z]/.test(s)) return s;
  return `the ${s}`;
}

// The clause about ONE person, named, with what they are waiting for and how
// long. Returns null when the step gives us nothing to say, in which case the
// caller uses the plain shape.
function stepSentence(label, who, ago) {
  const s = String(label || "").trim();
  for (const shape of STEP_SHAPES) {
    const m = shape.re.exec(s);
    if (!m) continue;
    const obj = (m[1] || "").replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
    if (m[1] !== undefined && obj.length < 2) continue;
    return shape.say(who, obj, ago);
  }
  return null;
}

// ── The clauses ────────────────────────────────────────────────────────────
const THANK_STEP = /thank/i;

function threadSentence(threads, t) {
  const list = Array.isArray(threads?.list) ? threads.list : [];
  if (list.length === 0) return null;
  const overdue = list.filter(x => x.overdue);

  if (overdue.length === 0) {
    const n = list.length;
    return `${cap(spell(n))} ${n === 1 ? "conversation is" : "conversations are"} waiting to be picked back up.`;
  }

  // FIX-1 §10 — THE COUNT IS THE HEADER'S. The list is capped (threadRank's
  // QUEUE_CAP); the header counts every overdue row. "12 people are waiting on
  // you" beside "24 overdue" was the capped list counted, with nothing saying
  // so. When the server sent its stat, the sentence says the stat's number.
  const statN = Number(threads?.stat?.overdue);
  const n = Number.isFinite(statN) && statN >= overdue.length ? statN : overdue.length;

  // FIX-1 §9 — WHO HAS WAITED LONGEST, by the one figure the header and the
  // badges read (shared/threadFigures.js). The server's stat.oldest covers the
  // whole list, not the capped one; it is used when it is an overdue row.
  const statOldest = threads?.stat?.oldest;
  const useStat = !!(statOldest && statOldest.overdue);
  const worst = useStat
    ? (overdue.find(x => x.id != null && x.id === statOldest.id) || { donorName: statOldest.donorName })
    : overdue[threadFigures(overdue).oldest.index];
  const full = String(worst.donorName || "Someone").trim();
  const late = useStat ? statOldest.days : rowFigure(worst);
  const ago = agoPhrase(late);

  // ONE thing overdue: lead with the person.
  if (n === 1) {
    if (THANK_STEP.test(String(worst.nextStep?.label || ""))) {
      return `${full} gave ${ago} and still hasn't been thanked.`;
    }
    const said = stepSentence(worst.nextStep?.label, full, ago);
    if (said) return said;
    return `${full} has been waiting on you for ${durationPhrase(late)}.`;
  }

  // SEVERAL: lead with the count, still name the one who has waited longest.
  // A semicolon, because these are two halves of one thought; a colon would be
  // a machine introducing a list.
  const who = surname(full);
  return `${cap(spell(n))} people are waiting on you; ${who} has been waiting ${durationPhrase(late)}.`;
}

function driftClause(drift, vocabulary) {
  const list = Array.isArray(drift?.list) ? drift.list : [];
  if (list.length === 0) return null;
  if (list.length === 1) return `${surname(list[0].donorName || list[0].name)} has gone quiet`;
  // FIX-1 §13 — her word is for people; organisations are organisations.
  return `${spell(list.length)} ${giverCountWord(list, vocabulary)} have gone quiet`;
}

// The window is SEVEN DAYS. There is no last-login stamp on this path, and
// wanting one is also wrong: a fundraiser back from a fortnight away would
// meet fourteen days of failures on her calmest screen.
export const RECURRING_WINDOW_DAYS = 7;

function recurringClause(atRisk, todayMs, t) {
  const list = Array.isArray(atRisk) ? atRisk : [];
  const recent = list.filter(r => {
    if (!r.first_failed_at) return true;
    const ms = new Date(r.first_failed_at).getTime();
    return Number.isFinite(ms) && todayMs - ms <= RECURRING_WINDOW_DAYS * 86400000;
  });
  if (recent.length === 0) return null;
  if (recent.length === 1) return `${surname(recent[0].donor_name)}'s card failed`;
  return `${spell(recent.length)} cards failed`;
}

// ── Names ──────────────────────────────────────────────────────────────────
// The FIRST mention is the full name, the way you would introduce somebody.
// Afterwards it is the surname, the way you would keep talking about them. An
// organisation keeps its whole name at every mention: "Foundation" is nobody.
const ORG_WORDS = /\b(foundation|trust|fund|inc|llc|ltd|company|co|corp|church|ministries|society|association|club|group|partners|charities|charity|school|college|university)\b/i;
export function surname(full) {
  const s = String(full || "").trim().replace(/\s+/g, " ");
  if (!s) return "Someone";
  if (ORG_WORDS.test(s)) return s;
  const parts = s.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  if (/^(jr|sr|ii|iii|iv|md|phd|esq)\.?$/i.test(last) && parts.length >= 3) return parts[parts.length - 2];
  // A "surname" that is a bare number or initial is not a name. "Donor 1"
  // became "1 has been waiting a week and a half" — caught by reading the
  // twenty-note fixture in a row, which is the only thing that catches it.
  // When the last word cannot stand alone as a name, the whole name does.
  if (!/[A-Za-z]{2}/.test(last)) return s;
  return last;
}

export function possessivePlural(word) {
  const w = String(word || "");
  return /s$/i.test(w) ? `${w}'` : `${w}'s`;
}

// ── The note ───────────────────────────────────────────────────────────────
// One to three sentences. The Thread gets its own sentence because it is the
// thing she acts on; Drift and the failed cards share the second, joined with
// "and", because they are both things that happened TO her rather than things
// she promised.
// ── BUILD-88b B.2 — LATE PLEDGE INSTALMENTS, IN THE MORNING SENTENCE ──────
// A pledge somebody signed and then stopped paying is the quietest kind of bad
// news: nothing fails, nothing bounces, and the money simply never arrives. It
// belongs in the sentence she reads at twenty to eight.
//
// It is its OWN sentence rather than a clause, because it is a different kind
// of fact from the other two (drift is a pattern, a failing card is an event,
// and this is a promise). The count is spelled under ten, like everything else
// in this voice, and a SHELL pledge — one Steward inferred from payments, with
// no schedule anybody wrote down — is never counted late: it is unfinished.
export function pledgeSentence(latePledgeInstallments) {
  const n = Number(latePledgeInstallments) || 0;
  if (n < 1) return null;
  return n === 1
    ? "One pledge instalment is late."
    : `${cap(spell(n))} pledge instalments are late.`;
}

// ── BUILD-101 Part 2 — memberships expiring this month ───────────────────
// One line, and only when it is not zero. A count, spelled under ten; the
// renewal threads themselves are in the Thread, where she acts on them.
export function membershipSentence(expiringThisMonth) {
  const n = Number(expiringThisMonth) || 0;
  if (n < 1) return null;
  return n === 1 ? "One membership expires this month." : `${cap(spell(n))} memberships expire this month.`;
}

// ── BUILD-100 (grants) Part 7 — grant deadlines coming up ────────────────
// The count is the server's, through grantMilestones' ONE window
// (`deadlinesInWindow`); this only says it in Home's voice. A fortnight is
// said as "the next two weeks", any other window in spelled days. Overdue
// deadlines count, because they are still owed.
export function grantDeadlineSentence(count, windowDays = 14) {
  const n = Number(count) || 0;
  if (n < 1) return null;
  const w = Number(windowDays) === 14 ? "the next two weeks" : `the next ${spell(Number(windowDays) || 14)} days`;
  return n === 1 ? `One grant deadline falls in ${w}.` : `${cap(spell(n))} grant deadlines fall in ${w}.`;
}

export function homeNote({ threads, drift, atRisk, latePledgeInstallments, membershipsExpiringThisMonth,
                           grantDeadlinesSoon, grantDeadlineWindowDays, vocabulary } = {}, todayMs = Date.now()) {
  const t = makeT(vocabulary);
  const sentences = [];

  const thread = threadSentence(threads, t);
  if (thread) sentences.push(thread);

  const second = [driftClause(drift, vocabulary), recurringClause(atRisk, todayMs, t)].filter(Boolean);
  if (second.length === 1) sentences.push(cap(second[0]) + ".");
  if (second.length === 2) sentences.push(`${cap(second[0])}, and ${second[1]}.`);

  const pledge = pledgeSentence(latePledgeInstallments);
  if (pledge) sentences.push(pledge);

  const members = membershipSentence(membershipsExpiringThisMonth);
  if (members) sentences.push(members);

  const grants = grantDeadlineSentence(grantDeadlinesSoon, grantDeadlineWindowDays);
  if (grants) sentences.push(grants);

  if (sentences.length === 0) return NOTHING_WAITING;
  return sentences.join(" ");
}

// The punctuation this voice does not use. Exported so the suite asserts the
// rule rather than a list of strings, and so anyone adding a clause can check
// their own work.
export const BANNED_PUNCTUATION = [
  { name: "a colon", re: /:/ },
  { name: "an em dash", re: /—/ },
  { name: "a day count", re: /\bday \d+/i },
  { name: "a bare numeral under ten", re: /(^|\s)[0-9](\s|\b)/ },
];
