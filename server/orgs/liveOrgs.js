// server/orgs/liveOrgs.js · SCALE-5. THE ORGS BACKGROUND WORK IS FOR.
//
// One answer for every per-org sweep (smart moves, digests, nudges, the
// scorer, drift, the nightly passes): the ids of orgs somebody uses
// (orgKind.isLiveOrg: not archived; customer, prospect trial or demo; CREO
// kept by id). The kind is orgKind.inferKind's, from the same facts the
// console reads (its logins and paid Steward invoices), so a sweep never
// disagrees with /admin about what an org is.
//
// Read once a minute per process at most: the orgs table is small, and a
// sweep that runs every five minutes should not pay four reads for it.
// `liveOrgIds(query)` returns an array of ids; a sweep's own statement takes
// it as `id = ANY(?)` (liveOrgFilter below). What deliberately touches every
// org (billing, deletion, retention) does not use this: see the SCALE-5 report.
"use strict";
const ORG_KIND = require("../../orgKind");

const TTL_MS = () => Math.max(0, Number(process.env.LIVE_ORGS_TTL_MS ?? 60 * 1000));
let cache = null;   // { at, ids }

async function readLive(query) {
  const [orgs, users, pays] = await Promise.all([
    query(`SELECT id, name, org_kind, subscription_status, stripe_subscription_id, archived_at, run_background_work FROM orgs WHERE archived_at IS NULL`, []),
    query(`SELECT org_id, email FROM users WHERE deactivated_at IS NULL`, []),
    query(`SELECT org_id, COUNT(*)::int AS c FROM platform_payments GROUP BY org_id`, []).catch(() => []),
  ]);
  const byOrg = new Map();
  for (const u of users) { if (!byOrg.has(u.org_id)) byOrg.set(u.org_id, []); byOrg.get(u.org_id).push({ email: u.email }); }
  const paid = new Map(pays.map(r => [r.org_id, Number(r.c) || 0]));
  return orgs.filter(o => ORG_KIND.isLiveOrg(o, { users: byOrg.get(o.id) || [], payments: paid.get(o.id) || 0 }))
    .map(o => o.id).sort();
}

async function liveOrgIds(query, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS()) return cache.ids;
  const ids = await readLive(query);
  cache = { at: Date.now(), ids };
  return ids;
}
// A sweep's WHERE: `${f.sql}` with f.args, alias the orgs id column.
async function liveOrgFilter(query, col = "id") {
  return { sql: `${col} = ANY(?::text[])`, args: [await liveOrgIds(query)] };
}
const forget = () => { cache = null; };

module.exports = { liveOrgIds, liveOrgFilter, forget };
