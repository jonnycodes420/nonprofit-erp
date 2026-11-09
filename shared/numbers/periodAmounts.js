// shared/numbers/periodAmounts.js · TRUTH-5. A PERIOD QUESTION GETS PERIOD AMOUNTS.
//
// The fleet (9 Nov, W-1109-Atlas-01) asked "who gave last December but not
// this year?" and read Sterling at $8,929: his lifetime, printed beside his
// name as if it were his December. The 22 people added to $49,850, more than
// all of December's giving ($48,774). The Ask answer's people carried
// `donors.total_giving` (askQuery.js's row amount for a person), unlabeled.
//
// The rule, for every list of people an answer names:
//   · when the question holds a window of days on gifts (the first gift
//     condition that is not a "nothing since"), each person's amount is what
//     they gave in that window, by givingBetween's rule (hard credit, refunds
//     off, credit rows out, cut at today). The rows can never add to more
//     than the window's whole, because each is a part of it.
//   · lifetime, when shown, is the profile's Lifetime (lifetime.js) and is
//     labeled "Lifetime".
//   · with no window, the one amount is Lifetime, labeled so.
//   · the words under "How Steward read this" are made from the plan that ran
//     and the window read from it (readWords), never written by hand.
"use strict";
const { IN_SPAN, capped, givingBetween } = require("./givingBetween");
const { LIFETIME } = require("./lifetime");
const { LIVE } = require("./money");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const day = d => (isDay(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : "");
const mon = d => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

// The window of days a query plan (askQuery.js) asks about, or null:
// { from, to, words } where words reads "in Dec 2025", "since Mar 1, 2026"…
function windowOf(plan, today) {
  if (!plan) return null;
  const conds = [];
  for (const r of plan.related || []) if (r && r.entity === "gifts" && !r.none) conds.push(...(r.where || []).filter(c => c.field === "date"));
  if (plan.entity === "gifts") conds.push(...(plan.where || []).filter(c => c.field === "date"));
  const c = conds[0];
  if (!c) return null;
  const v = c.value;
  if (c.op === "between" && Array.isArray(v) && isDay(v[0]) && isDay(v[1])) {
    const whole = v[0].slice(0, 7) === v[1].slice(0, 7) && v[0].endsWith("-01") && Number(v[1].slice(8)) === new Date(Date.UTC(+v[1].slice(0, 4), +v[1].slice(5, 7), 0)).getUTCDate();
    return { from: v[0], to: v[1], words: whole ? `in ${mon(v[0])}` : `between ${day(v[0])} and ${day(v[1])}` };
  }
  if ((c.op === "gte" || c.op === "gt") && isDay(v)) return { from: v, to: today, words: `since ${day(v)}` };
  if (c.op === "eq" && isDay(v)) return { from: v, to: v, words: `on ${day(v)}` };
  if (c.op === "last_days" && Number(v) > 0) {
    const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - Number(v));
    return { from: t.toISOString().slice(0, 10), to: today, words: `in the last ${Number(v)} days` };
  }
  return null;
}

// Each person's money in the window, in cents: Map id -> cents (0 for none).
async function periodCents(query, orgId, ids, w, today) {
  const out = new Map((ids || []).map(id => [id, 0]));
  if (!w || !out.size) return out;
  const s = capped({ from: w.from, to: w.to }, today);
  if (!s.from || !s.to || s.to < s.from) return out;
  const rows = await query(
    `SELECT g.donor_id, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${LIVE("d")} AND ${IN_SPAN("g")} AND g.donor_id = ANY(?::text[])
      GROUP BY g.donor_id`, [orgId, s.from, s.to, [...out.keys()]]);
  for (const r of rows) out.set(r.donor_id, Number(r.cents) || 0);
  return out;
}
// Each person's Lifetime (the profile's figure), in cents: Map id -> cents.
async function lifetimeCents(query, orgId, ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(`SELECT d.id, ROUND(${LIFETIME("d")} * 100)::bigint AS cents FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])`, [orgId, ids]);
  return new Map(rows.map(r => [r.id, Number(r.cents) || 0]));
}
// The window's whole: everyone's money in it (the most the rows can add to).
async function wholeCents(query, orgId, w, today) {
  if (!w) return null;
  return (await givingBetween(query, orgId, { from: w.from, to: w.to, today })).cents;
}

// The people of an answer ([{ donorId, name, ... }]), each with the amount the
// question asked about: { people, window, wholeCents }. Each person gets
// `cents` (the window's money, or Lifetime with no window), `amountWords`
// ("in Dec 2025" | "lifetime") and `lifetimeCents`.
async function periodPeople(query, orgId, { plan, people, today }) {
  const list = (people || []).filter(p => p && p.donorId);
  const w = windowOf(plan, today);
  const ids = [...new Set(list.map(p => p.donorId))];
  const [inWindow, life, whole] = await Promise.all([periodCents(query, orgId, ids, w, today), lifetimeCents(query, orgId, ids), wholeCents(query, orgId, w, today)]);
  return {
    window: w, wholeCents: whole,
    people: list.map(p => ({ ...p, cents: w ? inWindow.get(p.donorId) || 0 : life.get(p.donorId) || 0,
      amountWords: w ? w.words : "lifetime", lifetimeCents: life.get(p.donorId) || 0 })),
  };
}

// "How Steward read this", from what ran: the plan's own words and the amount's basis.
function readWords(planWords, w) {
  const basis = w ? `each amount is what they gave ${w.words}, refunds taken off; Lifetime is labeled Lifetime` : "each amount is their Lifetime giving";
  return `${planWords} · ${basis}`;
}

const SENTENCE = "A list answering a question about a period shows what each person gave in that period; their lifetime, when shown, is labeled Lifetime.";

module.exports = { windowOf, periodCents, lifetimeCents, wholeCents, periodPeople, readWords, SENTENCE };
