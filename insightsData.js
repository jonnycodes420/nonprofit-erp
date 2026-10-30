// insightsData.js · INSIGHTS-1. Reads one org's rows and hands them to the
// pure engine (insights.js). Reads only: a GET that shows cards writes nothing.
//
// The same gift set every surface counts: the org's gifts of people who are
// not deleted and not sample rows. A gift she marked "Not a gift" is no longer
// a gift row (it sits in the trash, insight_reviews says why), so it counts
// nowhere, here included.
//
// A short in-process memo keeps the Donors list's rung column and filter from
// re-reading the org on every page: it is keyed by the org's gift and pledge
// fingerprint, so any write that changes them changes the key.
"use strict";
const { query } = require("./db");
const insights = require("./insights");

async function rowsFor(orgId) {
  const [people, households, gifts, pledges, installments, programs, funds, org, reviews, links, outcomes, imports] = await Promise.all([
    query(`SELECT id, name, kind, household_id, assigned_to_name, deceased, do_not_contact, do_not_solicit, address, is_sample, deleted_at
             FROM donors WHERE org_id=? AND deleted_at IS NULL AND COALESCE(is_sample,false)=false`, [orgId]),
    query(`SELECT id, name FROM households WHERE org_id=?`, [orgId]),
    query(`SELECT g.id, g.donor_id, g.amount, g.date::text AS date, g.memo, g.notes, g.campaign, g.payment_method, g.gift_type, g.type,
                  g.tribute_type, g.tribute_name, g.import_id, g.pledge_id, e.name AS event_name
             FROM gifts g LEFT JOIN events e ON e.id = g.event_id AND e.org_id = g.org_id
            WHERE g.org_id=? AND COALESCE(g.is_sample,false)=false`, [orgId]),
    // FIX-60: made_on is the day the pledge was made, as the lapse rule reads it
    // (lapseRule.js), so a pledge made in the last 12 months is giving activity.
    query(`SELECT p.id, p.donor_id, p.amount, p.due_date::text AS due_date, p.status, p.frequency, p.installment_count, p.notes, p.gift_type,
                  LEAST(to_char(p.created_at, 'YYYY-MM-DD'), NULLIF(LEFT(p.due_date::text, 10), ''),
                        (SELECT MIN(NULLIF(LEFT(pi.due_date::text, 10), '')) FROM pledge_installments pi WHERE pi.pledge_id = p.id AND pi.org_id = p.org_id)) AS made_on,
                  COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.pledge_id = p.id AND g.org_id = p.org_id), 0) AS paid
             FROM pledges p WHERE p.org_id=? AND COALESCE(p.is_shell,false)=false`, [orgId]),
    query(`SELECT pledge_id, seq, due_date::text AS due_date, amount, paid_gift_id FROM pledge_installments WHERE org_id=? ORDER BY pledge_id, seq`, [orgId]),
    query(`SELECT name FROM programs WHERE org_id=?`, [orgId]).catch(() => []),
    query(`SELECT name FROM fin_funds WHERE org_id=? AND restricted = true`, [orgId]).catch(() => []),
    query(`SELECT name, ladder_major_line_cents FROM orgs WHERE id=?`, [orgId]),
    query(`SELECT gift_id, decision FROM insight_reviews WHERE org_id=?`, [orgId]),
    query(`SELECT network_key, decision FROM insight_links WHERE org_id=?`, [orgId]),
    query(`SELECT DISTINCT ON (kind, item_key) kind, item_key, state, until::text AS until FROM insight_outcomes WHERE org_id=? ORDER BY kind, item_key, created_at DESC`, [orgId]),
    query(`SELECT id, name FROM imports WHERE org_id=?`, [orgId]),
  ]);
  const inst = new Map();
  for (const i of installments) (inst.get(i.pledge_id) || inst.set(i.pledge_id, []).get(i.pledge_id)).push(i);
  return {
    org: { name: org[0] && org[0].name, majorLineCents: org[0] && org[0].ladder_major_line_cents },
    people, households, gifts,
    pledges: pledges.map(p => ({ ...p, installments: inst.get(p.id) || [] })),
    programs: [...programs, ...funds].map(r => r.name).filter(n => n && !/^general/i.test(n)),
    reviewed: Object.fromEntries(reviews.map(r => [r.gift_id, r.decision])),
    linksDismissed: new Set(links.map(r => r.network_key)),
    outcomes: outcomes.map(o => ({ ...o, item_key: `${o.kind}:${o.item_key}` })),
    imports: Object.fromEntries(imports.map(r => [r.id, r.name])),
  };
}

const MEMO = new Map();   // orgId -> { key, asOf, result, at }
const MEMO_MS = 60 * 1000;
async function fingerprint(orgId) {
  const [f] = await query(`SELECT
      (SELECT COUNT(*)::text || ':' || COALESCE(SUM(amount),0)::text || ':' || COALESCE(MAX(created_at)::text,'') FROM gifts WHERE org_id=?) AS g,
      (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text,'') FROM pledges WHERE org_id=?) AS p,
      (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text,'') FROM donors WHERE org_id=?) AS d,
      (SELECT COUNT(*)::text FROM insight_outcomes WHERE org_id=?) || ':' || (SELECT COUNT(*)::text FROM insight_reviews WHERE org_id=?)
        || ':' || (SELECT COUNT(*)::text FROM insight_links WHERE org_id=?) AS i`, [orgId, orgId, orgId, orgId, orgId, orgId]);
  return `${f.g}|${f.p}|${f.d}|${f.i}`;
}
async function insightsFor(orgId, asOf) {
  const key = await fingerprint(orgId);
  const m = MEMO.get(orgId);
  if (m && m.key === key && m.asOf === asOf && Date.now() - m.at < MEMO_MS) return m.result;
  const rows = await rowsFor(orgId);
  const result = insights.computeInsights({ ...rows, asOf });
  MEMO.set(orgId, { key, asOf, result, at: Date.now() });
  return result;
}
// donorId -> { rung, status, planned, signals } for the list and the profile
async function ladderMap(orgId, asOf) {
  const r = await insightsFor(orgId, asOf);
  const out = new Map();
  for (const u of r.units) for (const id of u.ids) out.set(id, u);
  return out;
}

module.exports = { rowsFor, insightsFor, ladderMap };
