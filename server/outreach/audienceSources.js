// server/outreach/audienceSources.js · COMMS-3 items 3 and 4. EVERY AUDIENCE NUMBER OPENS.
// Registered into figureSources.js's SOURCES:
//   reach-part        Audience's reach bar: the donors with an email, mail only, or no way to
//                     reach (shared/numbers/reach.js), each with their Lifetime. Its count is the
//                     bar's count; its sum is "given" (the biggest gap is part=mail, measure=sum).
//   audience-segment  a card's people (audienceView.js segmentPeople, the same call the card made),
//                     each with their Lifetime: the count on the card, and its "given".
"use strict";
const R = require("../../shared/numbers/reach");

module.exports = function audienceSources({ FigureParamError, query }) {
  return {
    "reach-part": {
      label: "Who you can reach",
      measure: p => p.measure || "count",
      params: { part: "word:required", measure: "measure" },
      sentence: p => `${R.SENTENCES[p.part] || ""} ${p.measure === "sum" ? R.GIVEN_SENTENCE : ""}`.trim(),
      sql: (orgId, p) => {
        if (!R.PARTS.includes(p.part)) throw new FigureParamError("part is email, mail or none.");
        const q = R.reachRowsSql(orgId, p.part);
        return { sql: `SELECT r.id, 'donor' AS type, r.id AS donor_id, r.name, r.last_gift_date AS date, r.life AS amount, 'Lifetime giving' AS detail FROM (${q.sql}) r`,
          args: q.args, order: "amount DESC NULLS LAST, id" };
      },
    },
    "audience-segment": {
      label: "Audience",
      measure: p => p.measure || "count",
      params: { seg: "word:required", measure: "measure" },
      sentence: p => `The donors with an email address in this audience, each with their Lifetime giving. ${p.measure === "sum" ? R.GIVEN_SENTENCE : ""}`.trim(),
      js: async (orgId, p) => {
        const V = require("./audienceView");
        const P = await V.segmentPeople({ query }, orgId);
        if (!P.ids[p.seg]) throw new FigureParamError("seg is not an audience Steward knows.");
        const by = new Map(P.all.map(d => [d.id, d]));
        return P.ids[p.seg].map(id => { const d = by.get(id); return { id, type: "donor", donor_id: id, name: d.name, date: d.last_gift_date || null, amount: d.life, detail: "Lifetime giving" }; })
          .sort((a, b) => Number(b.amount) - Number(a.amount) || String(a.id).localeCompare(String(b.id)));
      },
    },
  };
};
