// server/atlas/whyRows.js · ATLAS-8 items 1, 3 and 4. ATLAS NEVER STATES A NUMBER WHOSE ROWS IT WON'T SHOW.
//
// Jarvis's sweep (22 Nov): "Who should I call tomorrow?" named one person and
// "$53,837 at stake" across four names never listed; asked to list them, Atlas
// said it couldn't. The figure was real (why.js `call` sums five reasons), and
// the grounding check passed because the figure was read, but Atlas drew only
// two answer shapes (a person, a list) and a why answer keeps its people in
// `who`, so not one row reached the screen.
//
//   whyAnswer      a why answer's people, each with their reason and what is at
//                  stake, drawn under the line (AtlasAnswer's third shape, `why`).
//   whyLine        the sentence said over them: Ask's, when every dollar in it
//                  foots to the rows drawn; else the same sentence built from the
//                  rows, so a total is always the sum of the rows on screen.
//   misattributed  a dollar figure said next to a name must be that person's own
//                  (item 3); one that belongs to someone else refuses the reply.
//   followUp       "list them" and "tell me more" right after an answer read
//                  THAT answer's rows (kept with the request), never a new lookup.
//   homeAnswer     "how much is left on the goal" and "who stopped their monthly
//                  gift" read the very routes Home's cards read (item 4).
"use strict";
const { claims, factsOf } = require("./grounded");

const SHOWN = 25;   // a why answer has five; an appeal's breakdown may have more
const usd = cents => require("../../money").formatCentsPlain(Math.round(Number(cents) || 0));
const spell = n => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ── 1. A WHY ANSWER'S ROWS ─────────────────────────────────────────────────
// The people a why answer carries (`who`: donorId, name, cents, reason), every
// one of them, with the sum of what is drawn. null when it carries none.
function whyAnswer(ask, { question = "" } = {}) {
  if (!ask || ask.answered === false || !Array.isArray(ask.who)) return null;
  const all = ask.who.filter(w => w && w.donorId && w.name).map(w => ({
    donorId: w.donorId, name: String(w.name), reason: String(w.reason || "").trim(),
    cents: Math.round(Math.abs(Number(w.cents) || 0)), kind: w.kind || null,
  }));
  if (!all.length) return null;
  const people = all.slice(0, SHOWN).map(p => ({ ...p, atStake: usd(p.cents) }));
  const totalCents = people.reduce((s, p) => s + p.cents, 0);
  return {
    type: "why", key: (ask.question && ask.question.key) || ask.key || null, question,
    count: all.length, more: Math.max(0, all.length - people.length), people, totalCents, total: usd(totalCents),
    ids: all.map(p => p.donorId),
    // The reasons, each with its own sum (what Ask's breakdown shows), for the footing.
    reasons: (Array.isArray(ask.reasons) ? ask.reasons : []).map(r => ({ label: String(r.label || ""), cents: Math.round(Number(r.cents) || 0), count: Number(r.count) || 0 })),
    definition: "At stake: each person's own figure for their reason (a gift not yet thanked, an open ask, a year of a failed card, the last twelve months before a meeting, a season's gift, a usual gift). The total is the sum of the rows shown.",
  };
}

// Every dollar the drawn rows can stand behind: each person's figure and any
// amount in their reason, each reason's sum, and the sums of what is drawn.
function rowCents(ans) {
  const ok = new Set();
  for (const p of ans.people || []) { ok.add(p.cents); for (const c of claims(p.reason).cents) ok.add(c); }
  if (!ans.more) ok.add(ans.totalCents);
  const rs = ans.reasons || [];
  for (const r of rs) { ok.add(Math.abs(r.cents)); for (const c of claims(r.label).cents) ok.add(c); }
  if (rs.length) ok.add(Math.abs(rs.reduce((s, r) => s + r.cents, 0)));
  return ok;
}
// { ok, unfooted: ["$53,837"] }: every dollar in `text` is one the drawn rows foot to.
function foots(text, ans) {
  const ok = rowCents(ans);
  const bad = claims(text).cents.filter(c => !ok.has(c));
  return { ok: bad.length === 0, unfooted: bad.map(usd) };
}

// The line over a why answer: the first person, their reason, and the total of
// the rows drawn. Built only from the rows, so it foots by construction.
function rowsSentence(ans) {
  const [first, ...rest] = ans.people;
  if (!first) return "Nobody stands out right now.";
  const n = ans.count;
  const tail = rest.length
    ? ` ${cap(spell(n - 1))} more ${n - 1 === 1 ? "name follows" : "names follow"}; ${ans.more ? `${usd(ans.totalCents)} is at stake across the ${spell(ans.people.length)} shown` : `${usd(ans.totalCents)} is at stake across ${n === 2 ? "both" : `all ${spell(n)}`}`}.`
    : "";
  return `Start with ${first.name}. ${first.reason}${/[.!?]$/.test(first.reason) ? "" : "."}${tail}`;
}
// Ask's sentence when it foots to the rows; the rows' own sentence when it doesn't.
function whyLine(said, ans) {
  if (said && foots(said, ans).ok) return { sentence: String(said), footed: true };
  return { sentence: rowsSentence(ans), footed: false, unfooted: said ? foots(said, ans).unfooted : [] };
}

// ── 3. A FIGURE NEXT TO A NAME IS THAT PERSON'S ────────────────────────────
// Each person the answer read, with every dollar figure on their own rows.
// `sources`: arrays of person-shaped rows (who, people, rows; donorId or donor_id).
function personFacts(...sources) {
  const by = new Map();
  for (const list of sources) for (const r of Array.isArray(list) ? list : []) {
    const id = r && (r.donorId || r.donor_id || r.id);
    const name = r && (r.name || r.donorName);
    if (!id || !name) continue;
    const x = by.get(id) || { id, name: String(name), cents: new Set() };
    for (const c of factsOf(r).cents) x.cents.add(c);
    by.set(id, x);
  }
  return [...by.values()];
}
// The figures in `text` said beside one person's name that are on someone
// else's rows and not on theirs: [{ name, figure, belongsTo }]. A figure in a
// sentence that names nobody, or one that belongs to no person (a total), is
// not judged here (the grounding check reads those).
function misattributed(text, people) {
  const out = [];
  const list = (people || []).filter(p => p && p.name && p.cents && p.cents.size);
  if (list.length < 2) return out;
  // A first name speaks for its person only when it is that person's alone.
  const firsts = new Map();
  for (const p of list) { const f = p.name.split(/\s+/)[0].toLowerCase(); firsts.set(f, firsts.has(f) ? null : p); }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const sentence of String(text || "").split(/(?<=[.!?;])\s+/)) {
    const marks = [];
    for (const p of list) {
      for (const m of sentence.matchAll(new RegExp(`\\b${esc(p.name)}\\b`, "gi"))) marks.push({ at: m.index, p });
      const f = p.name.split(/\s+/)[0];
      if (firsts.get(f.toLowerCase()) === p) for (const m of sentence.matchAll(new RegExp(`\\b${esc(f)}\\b`, "g"))) marks.push({ at: m.index, p });
    }
    if (!marks.length) continue;
    for (const m of sentence.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
      const before = marks.filter(k => k.at < m.index).sort((a, b) => b.at - a.at)[0];
      if (!before) continue;
      const c = claims(m[0]).cents[0];
      if (c == null || before.p.cents.has(c)) continue;
      const owner = list.find(q => q !== before.p && q.cents.has(c));
      if (owner) out.push({ name: before.p.name, figure: usd(c), belongsTo: owner.name });
    }
  }
  return out;
}

// ── 1 and 4. "LIST THEM", "TELL ME MORE" ───────────────────────────────────
// Her words, when they ask for the last answer's rows again: "list" or "more".
const LIST_RE = /^(?:(?:ok(?:ay)?|and|so|please|now|can you)[,\s]+)*(?:list|show|name|give me|tell me|who are|who were|which are)\s+(?:me\s+)?(?:them|those|these|everyone|everybody|all(?: of)? (?:them|those|the \w+|five|four|three|two)|all|the (?:others?|rest|other (?:ones?|names?|people|four|three|two))|the (?:five|four|three|two|names|people))(?:\s+(?:again|please|for me|out|all|too|then))*\s*[?.!]*$|^(?:and )?(?:who|which ones?)(?: are| were)? (?:they|the others?|the rest|the other (?:ones?|names?|people|four|three|two))\s*[?.!]*$|^(?:and )?the (?:others|rest)\s*[?.!]*$/i;
const MORE_RE = /^(?:(?:ok(?:ay)?|and|so|please)[,\s]+)*(?:tell me more|more|go on|keep going|anything else|what else|say more|more detail|more details|expand(?: on)? (?:that|it)?)\b[^a-z]*$/i;
function followUp(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (LIST_RE.test(t)) return "list";
  if (MORE_RE.test(t)) return "more";
  return null;
}
// The last answer a request saved (why, list, person, figure), newest line last.
async function lastAnswer(query, orgId, requestId, parse) {
  if (!requestId) return null;
  const [m] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [String(requestId), orgId]);
  const answers = Object.values(((m && parse(m.read)) || {}).answers || {});
  return answers.length ? answers[answers.length - 1] : null;
}
// The line and the answer to draw again. `prior`: lastAnswer's.
function followUpLine(mode, prior) {
  if (prior && prior.type === "why") {
    const n = prior.count;
    return { line: mode === "list" ? `Here ${n === 1 ? "is the one" : n === 2 ? "are both" : `are all ${spell(n)}`} from that answer, each with their reason and what is at stake.` : `${n === 2 ? "Both of them" : `Each of the ${spell(n)}`}, with their reason and what is at stake. That is everything behind that answer.`, answer: prior };
  }
  if (prior && prior.type === "list") {
    return { line: prior.more > 0 ? `Here are the first ${prior.people.length} of the ${prior.count.toLocaleString("en-US")}. Open list has every one of them.` : `Here ${prior.count === 1 ? "is the one person" : prior.count === 2 ? "are both" : `are all ${prior.count.toLocaleString("en-US")}`} from that answer.`, answer: prior };
  }
  if (prior && prior.type === "person") return { line: `That's everything Steward holds on ${prior.name}; there's nothing more behind that answer. Their record has the full timeline.`, answer: prior, link: { tab: "donor", donorId: prior.donorId, section: "timeline" } };
  return { line: mode === "list" ? "My last answer had no list of people behind it, so there's nothing to list." : "There's nothing more behind my last answer: it had no rows to show." };
}

// ── 4. WHAT HOME ALREADY SHOWS ─────────────────────────────────────────────
const GOAL_RE = /\b(?:how much|what(?:'s| is)?)\b.*\b(?:left|to go|remaining|still need|short|away)\b.*\bgoal\b|\bgoal\b.*\b(?:left|to go|remaining)\b|\bhow (?:close|far) (?:are we|is it) (?:to|from) (?:the |our )?(?:annual )?goal\b/i;
const STOPPED_RE = /\b(?:who|which (?:donors?|people))\b.*\b(?:stopped|cancel(?:l?ed)?|failed|quit|lapsed on)\b.*\b(?:monthly|recurring|sustain\w*|card)\b|\b(?:stopped|failed) (?:monthly|recurring) (?:gifts?|donors?|cards?)\b/i;
function homeAsked(text) {
  const t = String(text || "");
  if (STOPPED_RE.test(t)) return "stopped_monthly";
  if (GOAL_RE.test(t)) return "goal_left";
  return null;
}
const dayWords = d => require("./grounded").dayWords(String(d || "").slice(0, 10));
// { line, answer?, link? } from the same reads Home's cards make. `get`: GET as her.
async function homeAnswer(which, get, tz = null) {
  if (which === "goal_left") {
    const r = await get("/home/annual-goal");
    const g = r.status < 300 && r.body ? r.body.goal : null;
    if (!g) return { line: "There's no annual goal set, so there's nothing left to count. Set one in Fundraising and Home will show it." };
    const target = (g.also || []).find(a => a.key === "goal");
    const raised = Math.round((Number(g.value) || 0) * 100), goal = Math.round((Number(target && target.value) || 0) * 100);
    const left = Math.max(0, goal - raised);
    const line = left > 0 ? `${usd(left)} is left to reach ${g.label}: ${usd(raised)} raised of the ${usd(goal)} goal.` : `${g.label} is met: ${usd(raised)} raised of the ${usd(goal)} goal.`;
    return { line: `${line} Left: the goal less what has been raised toward it, as Home's goal bar counts it.`, link: { tab: "fundraising" },
      answer: { type: "figure", parts: [{ label: "Raised", cents: raised, source: g.source || null }, { label: "The goal", cents: goal, source: (target && target.source) || null }, { label: "Left", cents: left }] } };
  }
  if (which === "stopped_monthly") {
    const r = await get("/recurring/exceptions");
    if (r.status >= 300 || !r.body) return { line: "I couldn't read the stopped monthly gifts just now. Home's Recurring card has them." };
    const cards = (r.body.failedCards || []).map(s => {
      const each = Math.round((Number(s.amount) || 0) * 100);
      const yearly = each * (s.interval === "year" ? 1 : s.interval === "week" ? 52 : 12);
      const when = s.lastFailedAt || s.firstFailedAt;
      return { donorId: s.donorId, name: s.donorName, cents: yearly,
        reason: `Their ${usd(each)} ${s.interval === "year" ? "yearly" : s.interval === "week" ? "weekly" : "monthly"} card failed${when ? ` on ${dayWords(require("../../orgTime").orgToday(tz || {}, new Date(when)))}` : ""}; ${usd(yearly)} a year rides on it.` };   // the org's day, never UTC's
    });
    const file = (r.body.stoppedFromFileList || []).map(s => ({ donorId: s.donorId, name: s.donorName, cents: 0, reason: `Stopped giving monthly in your file (${s.detail}).` }));
    const n = (r.body.counts && r.body.counts.failedCards) || cards.length;
    const nFile = (r.body.counts && r.body.counts.stoppedFromFile) || file.length;
    if (!n && !nFile) return { line: "Nobody's monthly gift has stopped: no card is failing, and no monthly giver from your file has gone quiet." };
    const who = [...cards, ...file];
    const ans = whyAnswer({ who }, { question: "Who stopped their monthly gift?" });
    ans.count = n + nFile; ans.more = Math.max(0, ans.count - ans.people.length);
    ans.definition = "Stopped: a monthly card that failed and has not recovered (at stake, a year of that gift), or a monthly giver from your file with nothing in 60 days. The same list as Home's stopped cards.";
    const parts = [n ? `${n === 1 ? "One monthly card has" : `${cap(spell(n))} monthly cards have`} failed and not recovered` : "", nFile ? `${spell(nFile)} monthly ${nFile === 1 ? "giver" : "givers"} from your file stopped` : ""].filter(Boolean);
    return { line: `${cap(parts.join(", and "))}.${ans.more ? "" : cards.length ? ` ${usd(ans.totalCents)} a year rides on ${cards.length === 1 ? "it" : "them"}.` : ""}`, answer: ans, link: { tab: "fundraising", section: "recurring" } };
  }
  return null;
}

module.exports = { whyAnswer, foots, whyLine, rowsSentence, personFacts, misattributed, followUp, followUpLine, lastAnswer, homeAsked, homeAnswer, SHOWN };
