// server/atlas/populations.js · ATLAS-8 item 2. ONE POPULATION PER WORD, AND ATLAS READS IT.
//
// Jarvis (22 Nov, prod): "LYBUNT" came back "173 people", the real number 520.
// Atlas sent the word to Ask, whose catalog has no LYBUNT; the model's query
// form named the nearest metric it knew, `lapsed_count` (people tagged Lapsed:
// twelve rolling months, pledge-held and deceased out), a different population
// under the same word. With AI off (staging) the same question was "I can't
// answer that".
//
// Each word here names one population and the one function that counts it:
//   LYBUNT  Reports > LYBUNT itself (GET /reports/lybunt: shared/numbers/bunt.js,
//           this fiscal year against the last), so the two can never differ.
//   SYBUNT  Reports > SYBUNT, the same way.
//   Lapsed  the Donors list's Lapsed filter (shared/numbers/lapse.js, through
//           donorStatus), the people Ask's "lapsed donors" counts.
// Every answer ends with the population's one-line definition, and draws the
// people (the first ten, with Open list holding every one of them).
// When DEFINE-1 lands, these read from its registry instead of this table.
"use strict";

const POPULATIONS = {
  lybunt: { word: "LYBUNT", definition: "LYBUNT: gave last fiscal year, nothing yet this one.", report: "lybunt" },
  sybunt: { word: "SYBUNT", definition: "SYBUNT: gave in some fiscal year before this one, nothing yet this one.", report: "sybunt" },
  lapsed: { word: "lapsed", definition: "Lapsed: gave before, nothing in the last twelve months, and no pledge holding them (the Donors list's Lapsed).", rules: { lifecycle: "lapsed", notDeceased: "1" } },
};

// The population her words name, or null. LYBUNT and SYBUNT wherever they are
// said; "lapsed" only as the whole question ("how many lapsed donors", "who
// are my lapsed donors"), so "lapsed donors in Lexington" stays a group ask.
const LAPSED_ONLY = /^(?:how many|who are|who's|whos|which|show me|list|count)(?: (?:are|of))?(?: (?:my|our|the|all))?(?: (?:currently|now))? lapsed(?: (?:donors?|people|givers?|supporters?))?(?: (?:do we have|are there|have we got|right now|now|today))?\s*\??$/i;
function populationAsked(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (/\blybunts?\b/i.test(t)) return "lybunt";
  if (/\bsybunts?\b/i.test(t)) return "sybunt";
  if (LAPSED_ONLY.test(t)) return "lapsed";
  return null;
}

const SHOWN = 10;
const usd = cents => require("../../money").formatCentsPlain(Math.round(Number(cents) || 0));

// { line, answer } with the list answer's shape (AtlasAnswer draws it, Open list opens all of it).
// `get`: GET as her (the very route the screen reads). `query`: for the lapsed rows.
async function populationAnswer(key, { get, query, orgId }) {
  const P = POPULATIONS[key];
  if (!P) return null;
  let people = [];
  if (P.report) {
    const r = await get(`/reports/${P.report}`);
    if (r.status >= 300 || !r.body || !Array.isArray(r.body.rows)) return { line: `I couldn't read the ${P.word} report just now. Reports > ${P.word} has it. ${P.definition}` };
    people = r.body.rows.map(x => ({ donorId: x.id, name: x.name, cents: Math.round((Number(x.priorYearTotal) || 0) * 100), lifetimeCents: Math.round((Number(x.lifetimeGiving) || 0) * 100) }));
    people.sort((a, b) => b.cents - a.cents || String(a.donorId).localeCompare(String(b.donorId)));
  } else {
    const GR = require("../../groups");
    const df = await GR.buildDonorFilter(orgId, P.rules);
    const rows = df.badRole || df.badStatus ? [] : await query(
      `SELECT id, name, last_gift_date, ROUND(COALESCE(total_giving,0)::numeric,2)::text AS total FROM donors WHERE ${df.whereSql} ORDER BY total_giving DESC NULLS LAST, id`, df.params);
    people = rows.map(x => ({ donorId: x.id, name: x.name, cents: 0, lifetimeCents: Math.round((Number(x.total) || 0) * 100), last: x.last_gift_date }));
  }
  const count = people.length;
  // Lifetime by the profile's rule (shared/numbers, periodAmounts.lifetimeCents), never the stored rollup.
  const life = await require("../../shared/numbers/periodAmounts").lifetimeCents(query, orgId, people.slice(0, SHOWN).map(p => p.donorId)).catch(() => new Map());
  for (const p of people.slice(0, SHOWN)) if (life.has(p.donorId)) p.lifetimeCents = life.get(p.donorId);
  if (!count) return { line: `Nobody is ${P.word} right now. ${P.definition}` };
  const shown = people.slice(0, SHOWN).map(p => {
    const lifetime = `Lifetime ${usd(p.lifetimeCents)}`;
    const amount = P.report ? `${usd(p.cents)} ${key === "lybunt" ? "last fiscal year" : "in the last year they gave"}` : `last gift ${String(p.last || "").slice(0, 10) || "not dated"}`;
    return { donorId: p.donorId, name: p.name, amount, lifetime, reason: `${amount}; ${lifetime}` };
  });
  const are = count === 1 ? "person is" : "people are";
  return {
    line: `${count.toLocaleString("en-US")} ${are} ${P.word}${P.report ? ", the same list as Reports > " + P.word : ""}. ${P.definition}`,
    answer: { type: "list", question: P.word, count, unit: "people", ids: people.map(p => p.donorId), reason: P.definition.replace(/\.$/, ""),
      more: Math.max(0, count - shown.length), people: shown, countSentence: `${count.toLocaleString("en-US")} ${count === 1 ? "person matches" : "people match"}.`, population: key },
  };
}

// The definition a count answer from Ask ends with, when its metric is one of these.
const METRIC_POPULATION = { lapsed_count: "lapsed" };
const definitionFor = metric => (POPULATIONS[METRIC_POPULATION[metric]] || {}).definition || null;
// The one line an Ask count answer ends with ("New donors: each person whose first gift
// ever is dated in the period."), from the figure's own definition; null for any other answer.
function countDefinition(ask) {
  const v = ask && ask.figures && ask.figures.value;
  if (!v || v.kind !== "count") return null;
  const metric = ((ask.qplan || ask.plan) || {}).metric;
  const own = definitionFor(metric);
  if (own) return own;
  if (!v.definition) return null;
  const label = String(v.label || "").split(" · ")[0].trim();
  const d = String(v.definition).trim();
  return label ? `${label}: ${d.charAt(0).toLowerCase()}${d.slice(1)}${/[.!?]$/.test(d) ? "" : "."}` : d;
}

module.exports = { POPULATIONS, populationAsked, populationAnswer, definitionFor, countDefinition };
