// tests/keys/fromDb.js: TRUTH-1. AN ORG'S ROWS, AS THEY ARE, FOR THE KEY.
// Plain SELECTs of one org's rows, shaped for tests/keys/truthKey.js. The SQL
// here holds no definition (no credit list, no lapse rule, no fiscal year):
// it only says "this org's rows", and the key decides what they mean. No app
// code is imported. The org's fiscal year start month is its setting
// (vocabulary_json.fiscal_year_start_month, July when unset) and its today is
// the civil date in its time zone, read here with Intl.
"use strict";
const { testNow } = require("../clock");

function civilToday(tz) {
  const zone = tz && String(tz).trim() ? String(tz).trim() : "America/New_York";
  let parts;
  try { parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(testNow())); }
  catch { parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(testNow())); }
  const v = t => parts.find(p => p.type === t).value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}
function startMonth(vocab) {
  let v = vocab;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  const n = v && typeof v === "object" ? parseInt(v.fiscal_year_start_month, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 7;
}

// q: (sql, params) => rows. Returns { rows, opts } for computeKey.
async function orgRows(q, orgId, { today } = {}) {
  const [[org], people, gifts, soft, pledges, inst, att, links] = await Promise.all([
    q(`SELECT timezone, vocabulary_json FROM orgs WHERE id = $1`, [orgId]),
    q(`SELECT id, household_id, deleted_at IS NOT NULL AS deleted, COALESCE(is_sample, false) AS sample,
              erased_at IS NOT NULL AS erased, imported_last_gift_date, imported_first_gift_date,
              (imported_total IS NOT NULL OR imported_gift_count IS NOT NULL) AS imported FROM donors WHERE org_id = $1`, [orgId]),
    q(`SELECT g.id, g.donor_id, ROUND(g.amount * 100)::bigint AS cents, g.date, g.type, g.payment_method, g.event_id, g.campaign_id, g.giving_page_id,
              g.deposited_on, g.deposit_ref, COALESCE(g.is_sample, false) AS sample,
              (im.id IS NOT NULL) AS on_run
         FROM gifts g LEFT JOIN imports im ON im.id = g.import_id AND im.org_id = g.org_id AND im.shape = 'deposit' AND im.reversed_at IS NULL
        WHERE g.org_id = $1`, [orgId]),
    q(`SELECT gift_id, donor_id, ROUND(amount * 100)::bigint AS cents FROM gift_soft_credits WHERE org_id = $1`, [orgId]).catch(() => []),
    q(`SELECT id, donor_id, ROUND(amount * 100)::bigint AS cents, status, due_date, event_id, to_char(created_at, 'YYYY-MM-DD') AS made
         FROM pledges WHERE org_id = $1`, [orgId]),
    q(`SELECT pledge_id, due_date, ROUND(amount * 100)::bigint AS cents, paid_gift_id FROM pledge_installments WHERE org_id = $1`, [orgId]),
    q(`SELECT id, event_id, donor_id, status, checked_in_at IS NOT NULL AS checked_in FROM event_attendees WHERE org_id = $1`, [orgId]),
    // POLISH-4: a person and their business are one giving unit for lapse.
    q(`SELECT donor_id_a, donor_id_b FROM donor_relationships WHERE org_id = $1 AND relationship_type IN ('owner','works_at','spouse','partner')`, [orgId]),   // PEOPLE-1: spouse and partner too
  ]);
  const byPledge = new Map();
  for (const i of inst) (byPledge.get(i.pledge_id) || byPledge.set(i.pledge_id, []).get(i.pledge_id))
    .push({ due: i.due_date, cents: Number(i.cents), paid: !!i.paid_gift_id });
  const rows = {
    people: people.map(p => ({ id: p.id, household: p.household_id || null, deleted: p.deleted, sample: p.sample, erased: p.erased,
      importedLastGift: p.imported_last_gift_date || null, importedFirstGift: p.imported_first_gift_date || null, imported: p.imported })),
    gifts: gifts.map(g => ({ id: g.id, person: g.donor_id, cents: Number(g.cents), date: g.date, type: g.type, method: g.payment_method,
      event: g.event_id, campaign: g.campaign_id, page: g.giving_page_id, sample: g.sample, depositRun: g.on_run, depositedOn: g.deposited_on, depositRef: g.deposit_ref })),
    softCredits: soft.map(s => ({ gift: s.gift_id, person: s.donor_id, cents: Number(s.cents) })),
    pledges: pledges.map(p => ({ id: p.id, person: p.donor_id, cents: Number(p.cents), status: p.status, due: p.due_date,
      event: p.event_id, made: p.made, installments: byPledge.get(p.id) || [] })),
    attendance: att.map(a => ({ id: a.id, event: a.event_id, person: a.donor_id, status: a.status, checkedIn: a.checked_in })),
    links: links.map(l => [l.donor_id_a, l.donor_id_b]),
  };
  return { rows, opts: { today: today || civilToday(org && org.timezone), fiscalStartMonth: startMonth(org && org.vocabulary_json) } };
}

module.exports = { orgRows, civilToday };
