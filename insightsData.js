// insightsData.js · INSIGHTS-1. Reads one org's rows and hands them to the
// pure engine (insights.js). Reads only: a GET that shows cards writes nothing.
//
// The same gift set every surface counts: the org's gifts of people who are
// not deleted and not sample rows. A gift she marked "Not a gift" is no longer
// a gift row (it sits in the trash, insight_reviews says why), so it counts
// nowhere, here included.
//
// INSIGHTS-2: computeFor runs on the worker (server/insights/store.js stores
// its answer with the fingerprint it was built from); insightsFor and
// ladderMap read the stored answer and never compute.
"use strict";
const { query } = require("./db");
const insights = require("./insights");

async function rowsFor(orgId) {
  const [people, households, gifts, pledges, installments, programs, funds, org, reviews, links, outcomes, imports] = await Promise.all([
    query(`SELECT id, name, kind, salutation, contact_name, email, spouse_name, household_id, assigned_to_name, deceased, do_not_contact, do_not_solicit, address, is_sample, deleted_at,
                  ROUND(COALESCE(total_giving, 0) * 100)::bigint AS lifetime_cents,
                  -- MOPUP-2: the total a file stated (FEEL-1's imported_import_id), so a Grow move never calls them new
                  CASE WHEN imported_import_id IS NOT NULL THEN ROUND(COALESCE(imported_total, 0) * 100)::bigint ELSE 0 END AS stated_cents,
                  imported_import_id, imported_through,
                  -- MOPUP-3: the rest of the stated history, the ask's base (shared/numbers/statedAsk.js)
                  CASE WHEN imported_import_id IS NOT NULL THEN imported_gift_count END AS stated_count,
                  CASE WHEN imported_import_id IS NOT NULL THEN ROUND(COALESCE(imported_last_gift_amount, 0) * 100)::bigint ELSE 0 END AS stated_last_cents,
                  CASE WHEN imported_import_id IS NOT NULL THEN LEFT(imported_first_gift_date::text, 10) END AS stated_first,
                  CASE WHEN imported_import_id IS NOT NULL THEN LEFT(imported_last_gift_date::text, 10) END AS stated_last
             FROM donors WHERE org_id=? AND deleted_at IS NULL AND COALESCE(is_sample,false)=false`, [orgId]),
    query(`SELECT id, name FROM households WHERE org_id=?`, [orgId]),
    query(`SELECT g.id, g.donor_id, g.amount, g.date::text AS date, g.memo, g.notes, g.campaign, g.payment_method, g.gift_type, g.type,
                  g.tribute_type, g.tribute_name, g.import_id, g.pledge_id, e.name AS event_name,
                  -- PLEDGES-2: the fund the gift is booked to (fundSplit's rule: restricted is a designation)
                  NULLIF(g.fund_id, '') AS fund_id, rf.name AS restricted_fund,
                  -- FLOWS-3: the gift's own fund, restricted or not, for the words that name it
                  af.name AS own_fund
             FROM gifts g LEFT JOIN events e ON e.id = g.event_id AND e.org_id = g.org_id
             LEFT JOIN fin_funds rf ON rf.id = g.fund_id AND rf.org_id = g.org_id AND rf.restricted = true
             LEFT JOIN fin_funds af ON af.id = g.fund_id AND af.org_id = g.org_id
            WHERE g.org_id=? AND COALESCE(g.is_sample,false)=false`, [orgId]),
    // FIX-60: made_on is the day the pledge was made, as the lapse rule reads it
    // (lapseRule.js), so a pledge made in the last 12 months is giving activity.
    query(`SELECT p.id, p.donor_id, p.amount, p.due_date::text AS due_date, p.status, p.frequency, p.installment_count, p.notes, p.gift_type,
                  LEAST(to_char(p.created_at, 'YYYY-MM-DD'), NULLIF(LEFT(p.due_date::text, 10), ''),
                        (SELECT MIN(NULLIF(LEFT(pi.due_date::text, 10), '')) FROM pledge_installments pi WHERE pi.pledge_id = p.id AND pi.org_id = p.org_id)) AS made_on,
                  COALESCE(${require("./shared/numbers/pledges").PAID_OF("p")}, 0) AS paid
             FROM pledges p WHERE p.org_id=? AND COALESCE(p.is_shell,false)=false`, [orgId]),
    query(`SELECT pledge_id, seq, due_date::text AS due_date, amount, paid_gift_id FROM pledge_installments WHERE org_id=? ORDER BY pledge_id, seq`, [orgId]),
    query(`SELECT name FROM programs WHERE org_id=?`, [orgId]).catch(() => []),
    query(`SELECT name FROM fin_funds WHERE org_id=?`, [orgId]).catch(() => []),
    query(`SELECT name, giving_level_mid_cents, giving_level_major_cents, vocabulary_json FROM orgs WHERE id=?`, [orgId]),
    query(`SELECT gift_id, decision FROM insight_reviews WHERE org_id=?`, [orgId]),
    query(`SELECT network_key, decision FROM insight_links WHERE org_id=?`, [orgId]),
    query(`SELECT DISTINCT ON (kind, item_key) kind, item_key, state, until::text AS until FROM insight_outcomes WHERE org_id=? ORDER BY kind, item_key, created_at DESC`, [orgId]),
    query(`SELECT id, name FROM imports WHERE org_id=?`, [orgId]),
  ]);
  const inst = new Map();
  for (const i of installments) (inst.get(i.pledge_id) || inst.set(i.pledge_id, []).get(i.pledge_id)).push(i);
  return {
    // NUMBERS-4: the ladder's major line is the org's Giving levels cut (shared/numbers/tags.js).
    org: { name: org[0] && org[0].name, cuts: require("./shared/numbers/tags").cutsOf(org[0]), fiscalStartMonth: org[0] ? require("./orgTime").orgFiscalStartMonth(org[0]) : 7 },
    people, households, gifts,
    pledges: pledges.map(p => ({ ...p, installments: inst.get(p.id) || [] })),
    // PLEDGES-2: a fund is named from the fund a gift is booked to, never from its memo
    // (W-1107-Finance-20X: the move credited a fund the money was not in).
    programs: programs.map(r => r.name).filter(n => n && !/^general/i.test(n)),
    fundNames: funds.map(r => r.name).filter(Boolean),
    reviewed: Object.fromEntries(reviews.map(r => [r.gift_id, r.decision])),
    linksDismissed: new Set(links.map(r => r.network_key)),
    outcomes: outcomes.map(o => ({ ...o, item_key: `${o.kind}:${o.item_key}` })),
    imports: Object.fromEntries(imports.map(r => [r.id, r.name])),
  };
}

// NUMBERS-5: whose Room to give is known, for the people an ask could step up
// (their own last three rising, or in a household, whose unit's might): the
// cards hold a rising unit at its level until it is, as the profile does.
async function roomKnownFor(orgId, rows) {
  const ASK = require("./shared/numbers/ask");
  await ASK.ready;
  const own = new Map();
  for (const g of rows.gifts) if (g.date) (own.get(g.donor_id) || own.set(g.donor_id, []).get(g.donor_id)).push(g);
  const ids = rows.people.filter(p => own.has(p.id) && (p.household_id || ASK.rising(own.get(p.id)))).map(p => p.id);
  return ASK.roomKnown(query, orgId, ids);
}

// The org's Insights inputs as one string: any write to a gift, pledge, person
// or an Insights decision changes it. INSIGHTS-2: server/insights/store.js
// stores each build with the fingerprint read before its rows.
async function fingerprint(orgId) {
  const [f] = await query(`SELECT
      (SELECT COUNT(*)::text || ':' || COALESCE(SUM(amount),0)::text || ':' || COALESCE(MAX(created_at)::text,'') FROM gifts WHERE org_id=?) AS g,
      (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text,'') FROM pledges WHERE org_id=?) AS p,
      (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text,'') FROM donors WHERE org_id=?) AS d,
      (SELECT COUNT(*)::text FROM insight_outcomes WHERE org_id=?) || ':' || (SELECT COUNT(*)::text FROM insight_reviews WHERE org_id=?)
        || ':' || (SELECT COUNT(*)::text FROM insight_links WHERE org_id=?) AS i`, [orgId, orgId, orgId, orgId, orgId, orgId]);
  return `${f.g}|${f.p}|${f.d}|${f.i}`;
}

// INSIGHTS-2: the whole-org computation, run by the worker's build
// (server/insights/store.js), never by a request.
async function computeFor(orgId, asOf) {
  const rows = await rowsFor(orgId);
  await insights.ready;   // SWEEP-1: the greeting (shared/greeting.js) and the one ask rounding (shared/smartAmounts.js)
  const roomKnown = await roomKnownFor(orgId, rows);
  return insights.computeInsights({ ...rows, asOf, roomKnown });
}
// INSIGHTS-2: a request reads the stored answer (store.read: { result, stale,
// preparing }). TEST_MODE reads wait for the queued build, so a suite reads
// what it just wrote; a production read never waits.
async function insightsFor(orgId, asOf, { explicitDay = false } = {}) {
  const STORE = require("./server/insights/store");
  const wait = String(process.env.TEST_MODE || "") === "1" ? STORE.TEST_WAIT_MS() : 0;
  return STORE.read(orgId, asOf, { waitMs: wait, explicitDay });
}
// donorId -> { rung, status, planned, signals } for the list and the profile
// (empty while the org's first Insights are being prepared)
async function ladderMap(orgId, asOf) {
  const r = (await insightsFor(orgId, asOf)).result;
  const out = new Map();
  if (r) for (const u of r.units) for (const id of u.ids) out.set(id, u);
  return out;
}

module.exports = { rowsFor, fingerprint, computeFor, insightsFor, ladderMap };
