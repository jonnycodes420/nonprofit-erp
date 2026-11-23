// shared/numbers/populations.js · DEFINE-1 item 1. THE POPULATION REGISTRY.
//
// Every named group of people a screen counts: its id, the name shown and the
// one sentence (shared/populationWords.js, which the browser reads too), and
// WHERE ITS RULE LIVES. The rules are not written here: each entry points at
// the builder that already exists, so the registry cannot drift from them.
//
//   source  the file and function that holds the rule (for a reader)
//   rules   a group rule (groups.js buildDonorFilter) when the population is one
//   count   async ({ query, orgId }) -> n, by that one builder
//
// Atlas (server/atlas/populations.js), Communications' audiences, the Groups
// starters, Fundraising's LYBUNT and Re-engage read names and sentences from
// here; tests/lib/surfacesAgree.js counts each population on two surfaces and
// requires them to agree.
"use strict";
const W = require("../populationWords.js");

const groupCount = rules => async ({ query, orgId }) => {
  const df = await require("../../groups").buildDonorFilter(orgId, rules);
  if (df.badRole || df.badStatus || df.badFilter) throw new Error(`population rules refused: ${JSON.stringify(rules)}`);
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM donors WHERE ${df.whereSql}`, df.params);
  return Number(r.n) || 0;
};
const today = orgId => require("../../donorStatus").todayFor(orgId);

const HOW = {
  donors: { source: "shared/numbers/isDonor.js IS_DONOR, over shared/numbers/everyone.js EVERYONE",
    count: async ({ query, orgId }) => {
      const [r] = await query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = ? AND ${require("./everyone").EVERYONE("donors")} AND ${require("./isDonor").IS_DONOR("donors")}`, [orgId]);
      return Number(r.n) || 0;
    } },
  everyone: { source: "shared/numbers/everyone.js EVERYONE", count: ({ query, orgId }) => require("./everyone").everyoneCount(query, orgId) },
  gave_this_year: { source: "shared/numbers/givingBetween.js over this fiscal year (shared/numbers/fiscalYear.js)" },
  monthly_givers: { source: "shared/numbers/givesMonthly.js", rules: { monthly: "1" } },
  volunteers: { source: "routes/volunteer.js VOLUNTEER_ROLE (the roster), the Role is Volunteer rule", rules: { role: "volunteer" } },
  lapsed: { source: "shared/numbers/lapse.js lapsedSql through donorStatus.statusSql (the Lapsed tag), deceased out", rules: { lifecycle: "lapsed", notDeceased: "1" } },
  lapsing: { source: "shared/numbers/lapse.js lapsingSql through donorStatus.statusSql (the Lapsing tag)", rules: { lifecycle: "lapsing" } },
  lapsing_or_lapsed: { source: "donorStatus.js quietIds (lapse.js lapsingSql or lapsedSql)",
    count: async ({ orgId }) => (await require("../../donorStatus").quietIds(orgId, await today(orgId))).size },
  reengage: { source: "shared/numbers/lapse.js reengageSql (server/donors/peopleCounts.js, the Re-engage badge)",
    count: async ({ orgId }) => (await require("../../server/donors/peopleCounts").peopleCounts(orgId)).reengage },
  lost: { source: "shared/numbers/lapse.js lostSql, within reengageSql" },
  lybunt: { source: "shared/numbers/bunt.js buntSql('lybunt'), fiscal years (GET /reports/lybunt rows)", rules: { bunt: "lybunt" } },
  lybunt_households: { source: "GET /reports/lybunt units: bunt.js's LYBUNT people, each household folded to one line" },
  lybunt_askable: { source: "shared/numbers/bunt.js buntSql('lybunt') and groups.js solicitable", rules: { bunt: "lybunt", solicitable: "1" } },
  sybunt: { source: "shared/numbers/bunt.js buntSql('sybunt'), fiscal years (GET /reports/sybunt rows)" },
  sybunt_askable: { source: "groups.js bunt=sybunt (SYBUNT less last year's givers) and solicitable", rules: { bunt: "sybunt", solicitable: "1" } },
  lapsing_askable: { source: "the Lapsing tag and groups.js solicitable", rules: { lifecycle: "lapsing", solicitable: "1" } },
  lapsed_askable: { source: "the Lapsed tag and groups.js solicitable", rules: { lifecycle: "lapsed", solicitable: "1" } },
};

const REGISTRY = Object.freeze(Object.fromEntries(W.POPULATION_IDS.map(id => {
  const h = HOW[id];
  if (!h || !h.source) throw new Error(`population ${id} names no builder`);
  return [id, Object.freeze({ ...W.POPULATIONS[id], source: h.source, rules: h.rules || null,
    count: h.count || (h.rules ? groupCount(h.rules) : null) })];
})));
for (const id of Object.keys(HOW)) if (!REGISTRY[id]) throw new Error(`population ${id} has a builder and no words`);

const population = id => REGISTRY[id] || null;
// What a JSON answer carries beside a population's count: the screen draws the name and sentence from it.
const describe = (id, n) => {
  const p = population(id);
  if (!p) throw new Error(`not a population: ${id}`);
  return { population: id, name: p.name, unit: p.unit, sentence: p.sentence, count: n == null ? undefined : Number(n) };
};
// The population a group's rules ARE, or null: a Group saved from a registry rule shows that name.
const byRules = rules => {
  const norm = r => JSON.stringify(require("../../groups").normalizeRules(r || {}).rules);
  const k = norm(rules);
  const hit = Object.values(REGISTRY).find(p => p.rules && norm(p.rules) === k);
  return hit ? hit.id : null;
};

module.exports = { POPULATIONS: REGISTRY, POPULATION_IDS: W.POPULATION_IDS, population, describe, byRules, isPopulationId: W.isPopulationId, unitWords: W.unitWords };
