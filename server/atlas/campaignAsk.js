// server/atlas/campaignAsk.js · ATLAS-11 item 1. ATLAS NEVER DENIES SOMETHING HOME SHOWS.
//
// Jarvis (25 Nov): "Asked how the Annual Fund is doing, Atlas said no Annual
// Fund exists, while Home shows it at $1.7M." The question went to Ask, whose
// reader (shared/askCatalog.js) finds a campaign only when its WHOLE name is in
// the question: "annual fund" is not "annual fund 2026", so the words were left
// over and said back as "There's no fund, appeal or event called …".
//
// Here, before any model or Ask:
//   read      her words name a campaign, appeal or fund: "how is the Annual Fund
//             doing", "how's Year-end going", "progress on the Harbor Run",
//             "Annual Fund total". The name is matched against every campaign,
//             appeal and fund by its words: whole, a prefix ("Giving" for
//             GivingTuesday), or one letter off ("Anual"), and the year may be left out.
//   one       answers with Home's own card for that goal (server/reports/helpers.js
//             goalCard, the function /home/annual-goal draws): raised, the goal,
//             the share, pace and days left. A fund answers with its Funds card
//             (GET /finance/funds-detail: fundCard.js).
//   several   "Did you mean Annual Fund 2026 or Annual Fund 2025?", each a button.
//   none      the closest names she has, never "it doesn't exist", but only when
//             she plainly asked about a campaign or fund (a word like fund,
//             appeal or campaign): "how is Margaret doing" is about a person.
"use strict";

const STOP = new Set(["the", "our", "a", "an", "of", "for", "and", "my", "this", "that", "s"]);
// Words of kind: they may be said when the name lacks them ("the Harbor Run campaign").
const GENERIC = new Set(["campaign", "appeal", "drive", "event", "goal", "fund", "fundraiser", "effort"]);
// A thing she plainly called a campaign or a fund, so a miss is said with the closest names.
const KIND_SAID = /\b(?:fund|funds|campaign|appeal|drive|gala|run|5k|auction|giving ?tuesday|year[- ]end|annual|capital|goal)\b/;

// The shapes of "how is <it> doing". Each returns the words that name it.
const SHAPES = [
  /^how(?:'s| is| are| was)\s+(?:the |our )?(.+?)\s+(?:doing|going|coming along|tracking|looking|performing)$/,
  /^how (?:are|were) we doing (?:on|with|for) (?:the |our )?(.+)$/,
  /^(?:what(?:'s| is) )?(?:the )?(?:progress|status|update) (?:on|of|for|with) (?:the |our )?(.+)$/,
  /^where (?:are we|do we stand|are things) (?:on|with) (?:the |our )?(.+)$/,
  /^how (?:close|far) (?:are we )?(?:to|from|on|with) (?:the |our )?(.+?)(?:'s)?(?: goal)?$/,
  /^how much (?:have we|has|did we|did) (?:raised?|brought in|bring in) (?:for|in|toward|towards|on|to) (?:the |our )?(.+)$/,
  /^how much (?:has|did|is in) (?:the |our )?(.+?)(?: (?:raise|raised|bring in|brought in|got|have|hold|holding))?$/,
  /^(?:the |our )?(.+?)(?:'s)? (?:progress|status|total|totals|numbers|raised so far)$/,
];

function norm(s) {
  return String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/'s\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
const tokens = s => norm(s).split(" ").filter(w => w && !STOP.has(w));

// The words of a campaign question, or null.
function readCampaignAsk(text) {
  const t = norm(String(text || "").replace(/[?!.]+\s*$/, "").replace(/\b(how|what|where)['’]s\b/gi, "$1 is")).replace(/^(?:hey |ok |okay )?(?:atlas )?(?:can you tell me |tell me |please tell me )?/, "");
  if (!t || t.length > 120) return null;
  for (const re of SHAPES) {
    const m = t.match(re);
    if (m && m[1] && m[1].trim().length >= 2) return { words: m[1].trim(), kindSaid: KIND_SAID.test(m[1]) || KIND_SAID.test(t) };
  }
  return null;
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// How well one word she said matches one word of the name.
function wordScore(q, n) {
  if (q === n) return 1;
  if (q.length >= 3 && n.startsWith(q)) return 0.9;
  if (n.length >= 3 && q.startsWith(n) && q.length - n.length <= 2) return 0.9;   // "runs" for "Run"
  if (/\d/.test(q) || /\d/.test(n)) return 0;   // a year is the year, never a near miss
  const L = lev(q, n);
  if (q.length >= 4 && L <= 1) return 0.75;
  if (q.length >= 8 && L <= 2) return 0.6;
  return 0;
}
// Her words against one name: { score, exact } or null when a word she said isn't in it.
function nameScore(words, name) {
  const q = tokens(words), n = tokens(name);
  if (!q.length || !n.length) return null;
  if (norm(words) === norm(name)) return { score: 100, exact: true };
  // "givingtuesday" for "Giving Tuesday", "year end" for "Year-end".
  const qj = q.join(""), nj = n.join("");
  if (qj.length >= 4 && nj.includes(qj)) return { score: q.length + 0.5, exact: false };
  let score = 0, matched = 0;
  for (const w of q) {
    const best = Math.max(0, ...n.map(x => wordScore(w, x)));
    if (best > 0) { score += best; matched++; }
    else if (!GENERIC.has(w)) return null;
  }
  return matched ? { score, exact: false } : null;
}

// Every campaign, appeal and fund matched; the best group, best first.
function matchNamed(words, items) {
  const hits = [];
  for (const it of items || []) { const s = nameScore(words, it.name); if (s) hits.push({ ...it, ...s }); }
  if (!hits.length) return [];
  const exact = hits.filter(h => h.exact);
  if (exact.length) return exact;
  const top = Math.max(...hits.map(h => h.score));
  return hits.filter(h => top - h.score < 0.05)
    .sort((a, b) => (b.running ? 1 : 0) - (a.running ? 1 : 0) || String(b.start || "").localeCompare(String(a.start || "")) || a.name.localeCompare(b.name));
}

// The closest names she has (a letter-pair likeness), for a question that matched none.
function closest(words, items, n = 3) {
  const pairs = s => { const x = norm(s).replace(/ /g, ""); const out = new Set(); for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2)); return out; };
  const q = pairs(words);
  return (items || []).map(it => { const p = pairs(it.name); let both = 0; for (const x of q) if (p.has(x)) both++; return { it, like: (2 * both) / ((q.size + p.size) || 1) }; })
    .sort((a, b) => b.like - a.like || (b.it.running ? 1 : 0) - (a.it.running ? 1 : 0)).slice(0, n).map(x => x.it.name);
}

// Every campaign, appeal and fund on file, with whether it is running today.
async function namedThings(query, orgId) {
  const [camps, funds] = await Promise.all([
    query(`SELECT id, name, type, status, LEFT(start_date::text, 10) AS start, LEFT(end_date::text, 10) AS ends, goal_amount
             FROM campaigns WHERE org_id = ? AND retired_at IS NULL AND COALESCE(name, '') <> ''`, [orgId]),
    query(`SELECT id, name FROM fin_funds WHERE org_id = ? AND retired_at IS NULL AND COALESCE(name, '') <> ''`, [orgId]).catch(() => []),
  ]);
  return [
    ...camps.map(c => ({ kind: "campaign", id: c.id, name: c.name, type: c.type || "campaign", start: c.start, running: c.status === "active", hasGoal: Number(c.goal_amount) > 0 })),
    ...funds.map(f => ({ kind: "fund", id: f.id, name: f.name, type: "fund", running: true })),
  ];
}

const join = names => (names.length <= 1 ? names.join("") : names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);
const dollars = c => require("../../money").formatCentsPlain(Math.round(Number(c) || 0));

// The step her words make, or null. Reads names only (no figures): figures come in run().
async function read(text, { query, orgId }) {
  const asked = readCampaignAsk(text);
  if (!asked) return null;
  const items = await namedThings(query, orgId);
  const hits = matchNamed(asked.words, items);
  if (hits.length === 1) return [{ kind: "campaign_ask", id: hits[0].id, of: hits[0].kind, name: hits[0].name, words: text }];
  if (hits.length > 1) return [{ kind: "campaign_ask", choose: hits.slice(0, 4).map(h => ({ id: h.id, of: h.kind, name: h.name })), said: asked.words, words: text }];
  if (!asked.kindSaid) return null;   // "how is Margaret doing": not a campaign, and not ours to answer
  return [{ kind: "campaign_ask", none: closest(asked.words, items), said: asked.words, words: text }];
}

// Runs the step: { line, answer, link }.
async function run(st, { query, orgId, get }) {
  if (st.none) {
    const near = st.none;
    return { line: near.length
      ? `I don't see a campaign, appeal or fund called "${st.said}". The closest names I have are ${join(near)}. Ask about one of those.`
      : "There are no campaigns, appeals or funds in Steward yet. Fundraising is where you start one." };
  }
  if (st.choose) {
    return { line: `Did you mean ${join(st.choose.map(c => c.name))}?`,
      answer: { type: "choices", options: st.choose.map(c => ({ label: c.name, ask: `How is ${c.name} doing?` })) } };
  }
  if (st.of === "fund") {
    const r = await get("/finance/funds-detail");
    const f = r.status < 300 && r.body && (r.body.funds || []).find(x => x.id === st.id);
    if (!f) return { line: `I couldn't read ${st.name}'s card just now. Finance > Funds has it.` };
    return { line: `${f.name} has received ${dollars(f.received.cents)} in ${f.received.count.toLocaleString("en-US")} ${f.received.count === 1 ? "gift" : "gifts"} this fiscal year, and its balance is ${dollars(f.balanceCents)}. ${f.sentence} Received: ${String(r.body.definitions && r.body.definitions.received || "").trim()}`.trim(),
      answer: { type: "figure", parts: [{ label: "Received this fiscal year", cents: f.received.cents }, { label: "Balance", cents: f.balanceCents }] } };
  }
  // A campaign: Home's own card when it has a goal, the same portfolio /home/annual-goal reads.
  const N = require("../../numbers");
  const portfolio = N.screens.fundraisingPortfolio ? await N.screens.fundraisingPortfolio(orgId) : null;
  const g = ((portfolio && portfolio.goals) || []).find(x => x.id === st.id);
  if (g && N.screens.goalCard) {
    const card = await N.screens.goalCard(orgId, g);
    const raised = Math.round(Number(card.value) * 100) || 0;
    const goalP = (card.also || []).find(a => a.key === "goal"), pctP = (card.also || []).find(a => a.key === "percent");
    const goal = Math.round(Number(goalP && goalP.value) * 100) || 0;
    const pct = pctP && pctP.value != null ? `${pctP.value}%` : null;
    const when = card.lifecycle === "upcoming" ? "It hasn't started yet." : card.endsWords === "Ended" ? "It has ended." : card.endsWords ? `${card.endsWords}.` : "It has no end date, so there's no pace.";
    const pace = card.paceSentence ? ` ${card.paceLabel ? card.paceLabel + ": " : ""}${card.paceSentence}.` : "";
    return { line: `${g.name} has raised ${dollars(raised)} of its ${dollars(goal)} goal${pct ? ` (${pct})` : ""}.${pace} ${when} The same figures as Home and Fundraising.`.replace(/\.\./g, "."),
      answer: { type: "figure", parts: [{ label: "Raised", cents: raised }, { label: "Goal", cents: goal }], sources: { raised: card.source, goal: goalP && goalP.source } },
      link: { tab: "fundraising" } };
  }
  // A campaign or appeal with no goal: what it has raised (the goal-raised source, which opens its gifts).
  const f = await require("../../figureSources").figureValue(orgId, { key: "goal-raised", params: { campaign: st.id } }, {}).catch(() => null);
  const cents = f && f.value != null ? Math.round(Number(f.value) * 100) : null;
  return { line: cents == null ? `I couldn't read ${st.name}'s figures just now. Fundraising has it.`
    : `${st.name} has raised ${dollars(cents)}. It has no goal set, so there's no percent or pace to give.`,
    ...(cents == null ? {} : { answer: { type: "figure", parts: [{ label: "Raised", cents }], sources: { raised: { key: "goal-raised", params: { campaign: st.id } } } } }), link: { tab: "fundraising" } };
}

module.exports = { read, run, readCampaignAsk, matchNamed, nameScore, closest, norm };
