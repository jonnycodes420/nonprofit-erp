// server/outreach/audienceView.js · COMMS-3 items 3, 4 and 5. COMMUNICATIONS → AUDIENCE.
//
// GET /communications/audience answers from here (server/outreach/routes.js mounts it):
//   reach     every donor split three ways (shared/numbers/reach.js), each part's count and
//             Lifetime given, and the biggest gap (what the mail-only donors gave);
//   segments  the six audiences as cards: count, Lifetime given between them, the one-line
//             definition, and when a card is 0, WHY, from the data (zeroWhy);
//   rows      for each person in a segment: email, a status pill (the DEFINE-1 lapse rule,
//             donorStatus.statusSql), the last gift (lastGift.js) and Lifetime (lifetime.js).
//
// One statusSql read feeds the Lapsing or lapsed segment (FIX-51: lifecycle lapsed or the
// lapsing flag, exactly quietIds' rule), the Major segment (FIX-49: the Major giving level,
// tagCondition's s.level = 'major') and every row's pill, so the three never disagree.
// The figure sources (audienceSources.js) call segmentPeople() too: a card's count and dollars
// open exactly the people the card counted.
"use strict";
const R = require("../../shared/numbers/reach");
const { EVERYONE } = require("../../shared/numbers/everyone");
const { LIFETIME } = require("../../shared/numbers/lifetime");
const POPS = require("../../shared/numbers/populations");
const { isDonorRow } = require("../../shared/numbers/isDonor");

const SEG_ORDER = ["all", "lapsed", "steward", "major", "prospect", "solicit"];
const STAGE_OF = { prospect: "prospect", steward: "steward", solicit: "solicit" };
const STAGE_WORD = { prospect: "Prospect", steward: "Ongoing care", solicit: "Solicit" };
const TOP_TO_STAGE = 40;

function monthsBetween(from, to) {
  if (!from || !to) return null;
  const [fy, fm, fd] = String(from).slice(0, 10).split("-").map(Number), [ty, tm, td] = String(to).slice(0, 10).split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}
const ago = (m, word) => (m >= 24 ? `${word} ${Math.floor(m / 12)} yrs` : `${word} ${m} mo`);

// The pill a row shows: brass for Lapsed and Lapsing, emerald for current, cream for a first gift.
function pillFor(st, today, cyFrom) {
  if (!st) return { tone: "none", text: "Gave before Steward" };   // imported history only, no gift on file
  const last = st.last_date ? String(st.last_date).slice(0, 10) : null, first = st.first_date ? String(st.first_date).slice(0, 10) : null;
  const m = monthsBetween(last, today);
  if (st.lifecycle === "lapsed") return { tone: "lap", text: ago(m || 0, "Lapsed") };
  if (st.lapsing) return { tone: "lap", text: ago(m || 0, "Lapsing") };
  if (first && first >= cyFrom) return { tone: "new", text: `First gift ${first.slice(0, 4)}` };
  if (last && last >= cyFrom) return { tone: "cur", text: "Gave this year" };
  return { tone: "cur", text: m != null ? `Gave ${m} mo ago` : "Current" };
}

// Everything a card or a figure needs: the people with an email (by segment), and the facts.
async function segmentPeople({ query }, orgId) {
  const DS = require("../../donorStatus");
  const today = await DS.todayFor(orgId);
  const cuts = await DS.cutsFor(orgId);
  const st = DS.statusSql(orgId, today, cuts);
  const [people, status] = await Promise.all([
    query(`SELECT d.*, ROUND(${LIFETIME("d")}, 2) AS life FROM donors d WHERE d.org_id = ? AND ${R.HAS_EMAIL("d")} AND ${EVERYONE("d")}`, [orgId]),   // TRUTH-4: Everyone's rule
    query(st.sql, st.args),
  ]);
  const byId = new Map(status.map(s => [s.donor_id, s]));
  const all = people.filter(isDonorRow);   // FLOWS-18: a giver is a donor (filterBySegment's "donors")
  const quiet = new Set(status.filter(s => s.lifecycle === "lapsed" || s.lapsing).map(s => s.donor_id));
  const major = new Set(status.filter(s => s.level === "major").map(s => s.donor_id));
  const ids = {
    all: all.map(d => d.id),
    lapsed: all.filter(d => quiet.has(d.id)).map(d => d.id),
    major: all.filter(d => major.has(d.id)).map(d => d.id),
    prospect: all.filter(d => d.stage === "prospect").map(d => d.id),
    steward: all.filter(d => d.stage === "steward").map(d => d.id),
    solicit: all.filter(d => d.stage === "solicit").map(d => d.id),
  };
  return { today, cuts, all, byId, ids, quiet, major, windows: DS.windowsFor(today, cuts) };
}

// Why a card is 0, from the data. null when it is not 0.
function zeroWhy(id, n, f) {
  if (n > 0) return null;
  const setStages = { label: `Set stages for your top ${TOP_TO_STAGE}`, to: "stage-top" };
  if (!f.donorTotal) return { text: "No one has given yet. Record a gift or import your giving and they appear here." };
  if (!f.withEmail) return { text: `None of your ${f.donorTotal.toLocaleString("en-US")} donors has an email address on their record.` };
  if (id === "all") return { text: "No donor has an email address on their record." };
  if (id === "lapsed") return f.quietAll
    ? { text: `${f.quietAll.toLocaleString("en-US")} ${f.quietAll === 1 ? "person is" : "people are"} lapsing or lapsed, and none has an email address.` }
    : { text: "No one is lapsing or lapsed: everyone who gave has given in the last 12 months, or a pledge holds them." };
  if (id === "major") {
    if (f.majorAll) return { text: `${f.majorAll.toLocaleString("en-US")} ${f.majorAll === 1 ? "donor is" : "donors are"} at the Major level, and none has an email address.` };
    if (!f.staged) return { text: `No one gave at your Major level in the last 12 months, and no one has a major-gift stage yet. Set stages for your top ${TOP_TO_STAGE}.`, noStages: true, action: setStages };
    return { text: `No one gave at your Major level (${f.majorCut}) in the last 12 months.`, action: { label: "Change the levels", to: "giving-levels" } };
  }
  const word = STAGE_WORD[id];
  if (!f.staged) return id === "solicit"
    ? { text: "Comes from Major Gifts stages, and none are set yet.", noStages: true, action: setStages }
    : { text: `No one has a major-gift stage yet, so no one is at ${word}.`, noStages: true, action: setStages };
  if (f.stageAll[id]) return { text: `${f.stageAll[id].toLocaleString("en-US")} ${f.stageAll[id] === 1 ? "person is" : "people are"} at ${word}, and none has an email address.` };
  return { text: `No one is at the ${word} stage yet.`, action: { label: "Open the pipeline", to: "pipeline" } };
}

async function audienceView(ctx, orgId, { coordinator = false } = {}) {
  const { query } = ctx;
  const P = await segmentPeople(ctx, orgId);
  const reach = await R.reachCounts(query, orgId);
  const [stg] = await query(
    `SELECT COUNT(*) FILTER (WHERE COALESCE(stage, '') <> '')::int AS staged,
            COUNT(*) FILTER (WHERE stage = 'prospect')::int AS prospect, COUNT(*) FILTER (WHERE stage = 'steward')::int AS steward,
            COUNT(*) FILTER (WHERE stage = 'solicit')::int AS solicit
       FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")}`, [orgId]);
  const facts = {
    donorTotal: reach.total, withEmail: reach.parts.email.count, staged: stg.staged,
    stageAll: { prospect: stg.prospect, steward: stg.steward, solicit: stg.solicit },
    quietAll: P.quiet.size, majorAll: P.major.size,
    majorCut: `$${Math.round((P.cuts.majorCents || 0) / 100).toLocaleString("en-US")} or more`,
  };
  const lapsePop = POPS.population("lapsing_or_lapsed");
  const DEF = {
    all: { label: "All donors", short: "Everyone with an email who has given.",
      definition: "Every donor with an email address. People who only volunteer or work here are not in it." },
    lapsed: { label: lapsePop.name, population: "lapsing_or_lapsed", short: "Gave before, nothing in about the last 12 months.",
      definition: `${lapsePop.name}, with an email address: ${P.ids.lapsed.length.toLocaleString("en-US")} of the ${P.quiet.size.toLocaleString("en-US")} ${POPS.unitWords("lapsing_or_lapsed", P.quiet.size)} on it. ${lapsePop.sentence}` },
    steward: { label: "In ongoing care", short: "At the Ongoing care stage in Major Gifts.", definition: "Donors with an email address at the Ongoing care stage." },
    major: { label: "Major donors", short: `Gave ${facts.majorCut} in the last 12 months.`,
      definition: "Donors with an email address at the Major giving level: what they gave in the last 12 months against your cut points in Settings, Giving levels." },
    prospect: { label: "Prospects", short: "At the Prospect stage in Major Gifts.", definition: "Donors with an email address at the Prospect stage." },
    solicit: { label: "Ready to ask", short: "At the Solicit stage in Major Gifts.", definition: "Donors with an email address at the Solicit stage." },
  };
  const person = new Map(P.all.map(d => [d.id, d]));
  const lastGifts = await require("../../shared/numbers/lastGift").lastGifts(query, orgId, P.ids.all);
  const cyFrom = P.windows.cyFrom;
  const rowOf = id => {
    const d = person.get(id), lg = lastGifts.get(id);
    return { id, name: d.name, email: d.email, pill: pillFor(P.byId.get(id), P.today, cyFrom),
      lastGift: lg ? { date: lg.date, amount: lg.cents / 100 } : null,
      ...(coordinator ? {} : { totalGiving: Number(d.life) || 0 }) };
  };
  const cents = ids => ids.reduce((n, id) => n + Math.round((Number(person.get(id).life) || 0) * 100), 0);
  const segments = SEG_ORDER.map(id => {
    const list = P.ids[id].slice().sort((a, b) => (Number(person.get(b).life) || 0) - (Number(person.get(a).life) || 0) || String(a).localeCompare(String(b)));
    return { id, ...DEF[id], count: list.length, ...(coordinator ? {} : { given: cents(list) / 100 }),
      zeroWhy: zeroWhy(id, list.length, facts),
      campaignSeg: id === "all" ? { mode: "donors" } : STAGE_OF[id] ? { mode: "byStage", stages: [STAGE_OF[id]] } : { mode: id },
      rows: list.map(rowOf) };
  });
  const mail = reach.parts.mail;
  return {
    donorTotal: reach.total,
    reach: {
      total: reach.total, sentence: R.ALL_SENTENCE, givenSentence: R.GIVEN_SENTENCE,
      parts: R.PARTS.map(p => ({ id: p, count: reach.parts[p].count, ...(coordinator ? {} : { given: reach.parts[p].cents / 100 }), sentence: R.SENTENCES[p] })),
      gap: coordinator || !mail.count ? null : { part: "mail", count: mail.count, given: mail.cents / 100,
        sentence: `given by the ${mail.count.toLocaleString("en-US")} mail-only ${mail.count === 1 ? "donor" : "donors"}. They hear from you only on paper.` },
    },
    segments,
  };
}

module.exports = { audienceView, segmentPeople, pillFor, zeroWhy, monthsBetween, TOP_TO_STAGE };
