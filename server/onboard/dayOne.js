// server/onboard/dayOne.js · ONBOARD-3 item 3. THE DAY-ONE LIST AND THE DAY-30 READOUT.
//
// At data in ("Looks right"), Steward writes down who was lapsed or lapsing by
// the one lapse rule (shared/numbers/lapse.js stateSql), with their giving in
// the 12 months before (onboard_snapshots; written once, never moved). Thirty
// days later Home (and /ops, per org) reads back what happened since:
//   · calls and notes logged by a person at the org since data in,
//   · thank-yous marked sent since data in,
//   · people ON THE DAY-ONE LIST who have given since data in: a gift dated on
//     or after the data-in day (giftCount.KEPT's gift: above $0, not refunded
//     in full, not a credit), with the amount. Nobody else counts, and a gift
//     dated before data in never does.
// The voice rule (design-system.md): they "gave again since you started";
// Steward never "recovered" anyone. If nobody has, it says what was done and
// names the next three to call, in Home's own order. It never emails anyone.
"use strict";
const N = require("../../shared/numbers/onboardTotals");
const orgTime = require("../../orgTime");
const PLANT = () => String(process.env.ONBOARD3_PLANT || "");

const READOUT_DAYS = 30;
const ACTOR = { id: "system:onboard/day-one", name: "Steward (day-one list)" };
const fmt = c => { const n = Math.abs(Math.round(Number(c) || 0)); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;
const dataInDay = org => orgTime.orgToday(org, new Date(org.data_in_at));

// Written once, at data in. Returns how many people it wrote down.
async function snapshot({ query, run }, org, today) {
  const [has] = await query(`SELECT 1 AS y FROM onboard_snapshots WHERE org_id = ? LIMIT 1`, [org.id]);
  if (has) return 0;
  const rows = await query(...N.dayOneRowsSql(org.id, today));
  for (const r of rows) {
    await run(`INSERT INTO onboard_snapshots (org_id, donor_id, state, last12_cents, taken_on, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?) ON CONFLICT (org_id, donor_id) DO NOTHING`, [org.id, r.id, r.state, Number(r.cents) || 0, today, ACTOR.id, ACTOR.name]);
  }
  return rows.length;
}

// Home's readout is due from day 30 after data in, for an org with a day-one list.
async function readoutDue(query, orgId) {
  const [r] = await query(`SELECT 1 AS y FROM orgs o WHERE o.id = ? AND o.data_in_at IS NOT NULL AND o.data_in_at <= NOW() - INTERVAL '${READOUT_DAYS} days'
      AND EXISTS (SELECT 1 FROM onboard_snapshots s WHERE s.org_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM onboard_first_session f WHERE f.org_id = o.id AND f.readout_dismissed_at IS NOT NULL)`, [orgId]);
  return !!r;
}

// The rows behind each readout figure (figure sources, totalsSources.js).
const SQL = {
  // The gifts themselves live in shared/numbers/onboardTotals.js (the gift-SQL rule); the plants are passed in.
  gaveAgain: (orgId, p) => N.gaveAgainSql(orgId, p, { anyone: PLANT() === "not-on-list", fromOverride: PLANT() === "before-data-in" ? orgTime.addDays(p.from, -400) : null }),
  touches: (orgId, p) => ({
    sql: `SELECT i.id, 'interaction' AS type, i.donor_id, d.name, i.date, NULL::numeric AS amount,
                 CASE WHEN i.type = 'call' THEN 'Call' ELSE 'Note or touch' END || COALESCE(' · ' || i.logged_by_name, '') AS detail
            FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id AND d.deleted_at IS NULL
            JOIN users u ON u.id = i.created_by AND u.org_id = i.org_id
           WHERE i.org_id = ? AND i.type = ANY(?::text[]) AND i.created_at >= (SELECT o.data_in_at FROM orgs o WHERE o.id = i.org_id)${p.kind === "call" ? " AND i.type = 'call'" : p.kind === "note" ? " AND i.type <> 'call'" : ""}`,
    // A conversation (figureSources' CONVERSATION_TYPES), never a gift's own timeline row.
    args: [orgId, require("../../figureSources").CONVERSATION_TYPES], order: "date DESC NULLS LAST, id" }),
};

async function readout({ query }, org, today, { insightsFor } = {}) {
  const day = dataInDay(org);
  const [snap] = await query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE state = 'lapsed')::int AS lapsed, MIN(taken_on)::text AS on_day FROM onboard_snapshots WHERE org_id = ?`, [org.id]);
  const g = SQL.gaveAgain(org.id, { from: day, to: today });
  const gave = await N.byPerson(query, g);
  const sources = {
    gave: { key: "onb-gave-again", params: { from: day, to: today } },
    calls: { key: "onb-touches", params: { kind: "call" } },
    notes: { key: "onb-touches", params: { kind: "note" } },
    thanks: { key: "thanks-marked", params: { from: day, to: today } },
  };
  // Each count is the figure engine's own (figureSources.figureValue), so it foots to the rows it opens.
  const FS = require("../../figureSources");
  const [cV, nV, tV] = await Promise.all([FS.figureValue(org.id, sources.calls), FS.figureValue(org.id, sources.notes), FS.figureValue(org.id, sources.thanks)]);
  const calls = Number(cV.value) || 0, notes = Number(nV.value) || 0, thanks = Number(tV.value) || 0;
  const people = gave.map(r => ({ id: r.donor_id, name: r.name, cents: Number(r.cents), gifts: r.gifts, last: r.last }));
  const totalCents = people.reduce((a, p) => a + p.cents, 0);
  const did = `Since you started on ${day}: ${plural(calls, "call", "calls")} and ${plural(notes, "note or touch", "notes and touches")} logged, ${plural(thanks, "thank-you", "thank-yous")} marked sent.`;
  let headline, next = [];
  if (people.length) {
    headline = `${plural(people.length, "person", "people")} from your day-one list ${people.length === 1 ? "has" : "have"} given again since you started: ${fmt(totalCents)}.`;
  } else {
    headline = `Nobody from your day-one list has given again yet. Here is what you did, and who to call next.`;
    if (insightsFor) {
      const got = await insightsFor(org.id, today);
      if (!got.preparing && got.result && got.result.deck) {
        next = require("./firstSession").movesInHomeOrder(got.result.deck, 3).map(m => ({ id: m.lead, name: m.name, why: m.why || null }));
      }
    }
  }
  if (PLANT() === "recovered") headline = headline.replace("have given again since you started", "were recovered by Steward").replace("has given again since you started", "was recovered by Steward");
  return {
    dataInDay: day, today, days: orgTime.daysBetween(day, today),
    listSize: Number(snap.n) || 0, lapsedOnList: Number(snap.lapsed) || 0,
    headline, did, calls, notes, thanks, people, totalCents, next,
    sentences: {
      list: `Your day-one list: the ${plural(Number(snap.n) || 0, "person", "people")} who were lapsed or lapsing on ${day}, when you said your totals looked right.`,
      gave: "Gave again since you started: a gift dated on or after that day from someone on the day-one list, refunds and credits left out.",
    },
    sources,
  };
}

module.exports = { snapshot, readoutDue, readout, SQL, READOUT_DAYS, dataInDay };
