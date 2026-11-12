// server/admin/sales/stewardLink.js · SALES-1. AN ORGANIZATION LINKED TO THE STEWARD ORG IT BECAME.
//
// facts(query, ids) is the plain facts box: the last sign-in day, the people
// imported (a count), the trial or beta end, and MRR once paying. It reads what
// exists and copies nothing: the person count is shared/numbers/households'
// PERSON, MRR is ONBOARD-2's own figure (server/onboard/signals.js, the one the
// Onboarding tab shows), and the gates a deal shows at Verbal yes are
// ONBOARD-2's row (board.one). Counts and dates only, never a donor: no name,
// no email, no amount of a gift (Journey's planted-donor test holds here too).
"use strict";
const { PERSON } = require("../../../shared/numbers/households");
const SIGNALS = require("../../onboard/signals");
const BOARD = require("../../onboard/board");
const { orgToday } = require("../../../orgTime");

const iso = t => (t ? new Date(t).toISOString() : null);

async function facts(query, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};
  const [orgs, logins, people] = await Promise.all([
    query(`SELECT id, name, subscription_status, trial_ends_at, timezone FROM orgs WHERE id = ANY(?)`, [list]),
    query(`SELECT s.org_id, MAX(GREATEST(s.created_at, COALESCE(s.last_active_at, s.created_at))) AS t
             FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
            WHERE s.org_id = ANY(?) AND COALESCE(u.is_super_admin, false) = false GROUP BY s.org_id`, [list]),
    query(`SELECT d.org_id, COUNT(*)::int AS n FROM donors d WHERE d.org_id = ANY(?) AND ${PERSON("d")} GROUP BY d.org_id`, [list]),
  ]);
  const onb = await SIGNALS.readFacts(query, orgs.map(o => o.id)).catch(() => ({}));
  const last = new Map(logins.map(r => [r.org_id, iso(r.t)]));
  const count = new Map(people.map(r => [r.org_id, Number(r.n)]));
  const out = {};
  for (const o of orgs) {
    const st = o.subscription_status || null;
    const paying = st === "active";
    out[o.id] = {
      stewardOrgId: o.id, name: o.name, status: st,
      lastSignInAt: last.get(o.id) || null,
      peopleImported: count.get(o.id) || 0,
      // FLAKE-5: the org's own day of the instant the trial ends (its time zone,
      // New York when unset), never the UTC day: a trial ending at 8 PM Eastern
      // read as UTC showed a day late.
      trialEndsOn: !paying && o.trial_ends_at ? orgToday(o, new Date(o.trial_ends_at)) : null,
      mrrNowCents: paying ? Number((onb[o.id] || {}).mrrNowCents || 0) : null,
      sentences: {
        lastSignIn: "The latest day someone at the org (not Steward's staff) signed in or was active.",
        people: "People in the org's Steward, not counting sample data or deleted people. A count only.",
        trial: "When the org's trial or beta ends; nothing is charged before it.",
        mrr: "What the org's live Steward subscription bills each month: the same figure as the Onboarding tab.",
      },
    };
  }
  return out;
}

// ONBOARD-2's five gates for one Steward org, read-only.
async function gates(query, stewardOrgId) {
  const row = await BOARD.one(query, stewardOrgId).catch(() => null);
  if (!row) return null;
  return { stage: row.stage, title: row.title, daysInStage: row.daysInStage, red: row.red, redWhy: row.redWhy, next: row.next, gates: row.gates };
}

// The Steward orgs a link can point at (name and id), for the picker.
async function candidates(query, q) {
  const s = `%${String(q || "").trim().toLowerCase().replace(/[%_\\]/g, m => "\\" + m)}%`;
  return query(`SELECT id, name FROM orgs WHERE archived_at IS NULL AND COALESCE(is_demo_org, false) = false AND (lower(name) LIKE ? OR lower(id) LIKE ?) ORDER BY name LIMIT 20`, [s, s]);
}

module.exports = { facts, gates, candidates };
