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
// DEFINE-1: the names, the definitions and the lapsed rule are the population
// registry's (shared/numbers/populations.js), so Atlas says what every other
// screen says. This table only says how Atlas reads each one.
"use strict";

const REG = require("../../shared/numbers/populations");
const said = id => { const p = REG.population(id); return { id, word: p.name, definition: p.sentence }; };
const POPULATIONS = {
  lybunt: { ...said("lybunt"), report: "lybunt" },
  sybunt: { ...said("sybunt"), report: "sybunt" },
  lapsed: { ...said("lapsed"), rules: REG.population("lapsed").rules },
};
// ATLAS-9: any other registry population with a group rule (Lapsing, the askable twins) reads the same way.
const populationOf = key => POPULATIONS[key] || (REG.population(key) && REG.population(key).rules ? { ...said(key), rules: REG.population(key).rules } : null);

// The population her words name, or null. ATLAS-9 item 2: read by the tolerant
// matcher (populationAsk.js, keyed to the registry's words), not one regex per
// sentence shape; "lapsed donors in Lexington" still stays a group ask.
// The first id, for a caller that wants one; populationAsk.readPopulation has them all.
function populationAsked(text) {
  const r = require("./populationAsk").readPopulation(text);
  return r && !r.call ? r.ids[0] : null;
}

const SHOWN = 10;
const usd = cents => require("../../money").formatCentsPlain(Math.round(Number(cents) || 0));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : "");

// { line, answer } with the list answer's shape (AtlasAnswer draws it, Open list opens all of it).
// `get`: GET as her (the very route the screen reads). `query`: for the lapsed rows.
async function populationAnswer(key, { get, query, orgId }) {
  const P = populationOf(key);
  if (!P) return null;
  let people = [], units = null, atStakeCents = null;
  if (P.report) {
    const r = await get(`/reports/${P.report}`);
    if (r.status >= 300 || !r.body || !Array.isArray(r.body.rows)) return { line: `I couldn't read the ${P.word} report just now. Reports > ${P.word} has it. ${P.definition}` };
    people = r.body.rows.map(x => ({ donorId: x.id, name: x.name, cents: Math.round((Number(x.priorYearTotal) || 0) * 100), lifetimeCents: Math.round((Number(x.lifetimeGiving) || 0) * 100) }));
    people.sort((a, b) => b.cents - a.cents || String(a.donorId).localeCompare(String(b.donorId)));
    // ATLAS-11 item 2: the report's own households (buntUnits) and dollars (its atStake figure), never summed here.
    units = Array.isArray(r.body.units) ? r.body.units.length : null;
    const st = r.body.figures && r.body.figures.atStake;
    atStakeCents = st && st.cents != null ? Number(st.cents) : st && st.value != null ? Math.round(Number(st.value) * 100) : null;
  } else {
    const GR = require("../../groups");
    const df = await GR.buildDonorFilter(orgId, P.rules);
    // ATLAS-9: lifetime by the profile's rule (lifetime.js) and the last gift by lastGift.js, never the stored rollups.
    const rows = df.badRole || df.badStatus ? [] : await query(
      `SELECT id, name, LEFT(${require("../../shared/numbers/lastGift").LAST_DATE("donors")}, 10) AS last_gift_date, ROUND((${require("../../shared/numbers/lifetime").LIFETIME("donors")}) * 100)::bigint AS cents
         FROM donors WHERE ${df.whereSql} ORDER BY cents DESC NULLS LAST, id`, df.params);
    people = rows.map(x => ({ donorId: x.id, name: x.name, cents: 0, lifetimeCents: Number(x.cents) || 0, last: x.last_gift_date }));
  }
  const count = people.length;
  // Lifetime by the profile's rule (shared/numbers, periodAmounts.lifetimeCents), never the stored rollup.
  const life = await require("../../shared/numbers/periodAmounts").lifetimeCents(query, orgId, people.slice(0, SHOWN).map(p => p.donorId)).catch(() => new Map());
  for (const p of people.slice(0, SHOWN)) if (life.has(p.donorId)) p.lifetimeCents = life.get(p.donorId);
  if (!count) return { line: `Nobody is ${P.word} right now. ${P.definition}` };
  const shown = people.slice(0, SHOWN).map(p => {
    const lifetime = `Lifetime ${usd(p.lifetimeCents)}`;
    const amount = P.report ? `${usd(p.cents)} ${key === "lybunt" ? "last fiscal year" : "in the last year they gave"}` : (day(p.last) ? `last gift ${day(p.last)}` : "last gift not dated");
    return { donorId: p.donorId, name: p.name, amount, lifetime, reason: `${amount}; ${lifetime}` };
  });
  const are = count === 1 ? "person is" : "people are";
  // ATLAS-11 item 2: count, households and dollars, as Reports > LYBUNT says them.
  const hh = units != null ? `, in ${units.toLocaleString("en-US")} ${units === 1 ? "household" : "households"}` : "";
  const gave = atStakeCents != null ? `. Together they gave ${usd(atStakeCents)} ${key === "lybunt" ? "last fiscal year" : "in the last year each of them gave"}` : "";
  return {
    line: `${count.toLocaleString("en-US")} ${are} ${P.word}${hh}${gave}${P.report ? ". The same list as Reports > " + P.word : ""}. ${P.definition}`,
    answer: { type: "list", question: P.word, count, unit: "people", ids: people.map(p => p.donorId), reason: P.definition.replace(/^[^:]+:\s*/, "").replace(/\.$/, ""),
      more: Math.max(0, count - shown.length), people: shown, countSentence: `${count.toLocaleString("en-US")} ${count === 1 ? "person matches" : "people match"}.`, population: key,
      ...(units != null ? { households: units } : {}), ...(atStakeCents != null ? { totalCents: atStakeCents } : {}) },
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

// ── ATLAS-9 item 3: WHO TO CALL IN A POPULATION ───────────────────────────
// "Who should I call to win back lapsed donors?": only that population's
// people (its askable twin: nobody marked deceased, do not contact or do not
// solicit), ranked by lifetime giving (the profile's Lifetime, lifetime.js),
// top first. Each row is a person; the total is the sum of the rows drawn.
async function populationCallAnswer(key, { query, orgId }) {
  const P = populationOf(key);
  if (!P || !P.rules) return null;
  const GR = require("../../groups");
  const df = await GR.buildDonorFilter(orgId, P.rules);
  if (df.badRole || df.badStatus || df.badFilter) return { line: `I couldn't read ${P.word} just now. ${P.definition}` };
  const LIFE = require("../../shared/numbers/lifetime").LIFETIME("donors");
  const rows = await query(`SELECT id, name, ROUND((${LIFE}) * 100)::bigint AS cents, LEFT(${require("../../shared/numbers/lastGift").LAST_DATE("donors")}, 10) AS last
                              FROM donors WHERE ${df.whereSql} ORDER BY cents DESC NULLS LAST, id`, df.params);
  const all = rows.map(r => ({ donorId: r.id, name: r.name, cents: Math.max(0, Number(r.cents) || 0), last: r.last || null }));
  if (!all.length) return { line: `Nobody is on ${P.word} right now, so there is nobody to call from it. ${P.definition}` };
  const people = all.slice(0, SHOWN).map(p => ({ donorId: p.donorId, name: p.name, cents: p.cents, atStake: usd(p.cents),
    reason: p.last ? `Last gift ${day(p.last)}.` : "No gift date on file." }));
  const totalCents = people.reduce((x, p) => x + p.cents, 0);
  const n = all.length, shown = people.length;
  const lead = `${n.toLocaleString("en-US")} ${n === 1 ? "person is" : "people are"} ${P.word}. Ranked by lifetime giving, start with ${people[0].name} (${people[0].atStake} lifetime).`;
  const foot = n > shown ? ` The top ${shown} shown have given ${usd(totalCents)} in their lifetimes; Open list has all ${n.toLocaleString("en-US")}.` : ` Together they have given ${usd(totalCents)} in their lifetimes.`;
  return {
    line: `${lead}${foot} ${P.definition}`,
    answer: { type: "why", key: `population_call:${key}`, question: P.word, population: key, count: n, more: Math.max(0, n - shown), people, totalCents, total: usd(totalCents),
      ids: all.map(p => p.donorId), stakeWord: "lifetime",
      definition: `${P.definition} Ranked by lifetime giving (the profile's Lifetime: every gift ever, with any total an import stated). The total is the sum of the rows shown.` },
  };
}

module.exports = { POPULATIONS, populationAsked, populationAnswer, populationCallAnswer, populationOf, definitionFor, countDefinition };
