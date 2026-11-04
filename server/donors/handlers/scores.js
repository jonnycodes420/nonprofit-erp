// JOBS-1 · THE TWO SCORES (ENGAGE-1), RECOMPUTED ON THE QUEUE.
//
// SCORES-1. A change asks for the people it touched to be rescored
// (`schedule(orgId, donorIds)`), against the org's stored population
// (engagement.js "THE STORED POPULATION"): one to three rows, never the org. A
// request with no people (`donorIds` null: an import's end, a door that cannot
// name who changed) asks for the full pass, which writes only changed rows.
//
// THE FOLD. One job per org, key `scores:<org>`. While one waits, a new request
// is folded into it (its people added, or "full" set) instead of adding a job;
// while one runs, the request makes the one waiting job, which is "run again
// once". Ten gifts in a minute are one or two runs, never ten. A full request
// waits SCORE_IMPORT_DEBOUNCE_MS after the latest one (an import's chunks keep
// pushing it back), at most SCORE_FULL_MAX_WAIT_MS after the first, so an
// import queues one full pass at its end, not one per chunk.
//
// Idempotent: both runs upsert, and only rows that changed.
"use strict";
const JQ = require("../../../jobQueue");
const OUTBOX = require("../../shared/outbox");
const { query } = require("../../../db");

const DEBOUNCE_MS = () => Number(process.env.SCORE_DEBOUNCE_MS || 3000);
const FULL_DEBOUNCE_MS = () => Number(process.env.SCORE_IMPORT_DEBOUNCE_MS || 20000);
const FULL_MAX_WAIT_MS = () => Number(process.env.SCORE_FULL_MAX_WAIT_MS || 10 * 60 * 1000);
const MAX_PEOPLE = 2000;   // more people than this in one wait is a full pass

// A change rescores the people it touched, against the stored population. No
// lock: it writes only their rows, by upsert.
async function recomputePeople(orgId, donorIds) {
  const [o] = await query("SELECT id, timezone FROM orgs WHERE id=?", [orgId]);
  if (!o) return null;
  return require("../../../engagement").recomputePeopleScores(query, orgId, require("../../../orgTime").orgToday(o), donorIds);
}

JQ.handle("handler:scores", async (p) => {
  const ids = Array.isArray(p && p.donorIds) ? p.donorIds : [];
  if (p.full || !ids.length) return OUTBOX.dep("recomputeScoresForOrg")(p.orgId, { wait: false });
  return recomputePeople(p.orgId, ids);
});

// The people a write names: the person in its path (/donors/:id/...), and the
// ids in its body. A write that names nobody is left to the after-change step
// its route calls, and to the six-hour pass.
const BODY_IDS = ["donor_id", "donorId", "person_id", "personId", "relatedDonorId", "primaryId", "secondaryId"];
function idsOfRequest(req) {
  const ids = [];
  const m = /^\/donors\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(req.path || "");
  if (m && !/^(import|merge|bulk|export)/.test(m[1])) ids.push(m[1]);
  const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  for (const k of BODY_IDS) if (typeof b[k] === "string" && b[k]) ids.push(b[k]);
  for (const k of ["donorIds", "donor_ids"]) if (Array.isArray(b[k])) ids.push(...b[k].filter(x => typeof x === "string").slice(0, MAX_PEOPLE));
  return ids;
}

// Fold into the waiting job, if there is one. Returns its id, or null.
async function fold(orgId, ids, full, laterMs) {
  const all = `(SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(payload->'donorIds', '[]'::jsonb) || ?::jsonb) x)`;
  const rows = await query(
    `UPDATE job_queue SET
        payload = jsonb_build_object('orgId', ?::text,
          'full', COALESCE((payload->>'full')::boolean, false) OR ?::boolean OR jsonb_array_length(${all}) > ?,
          'donorIds', ${all}),
        run_after = CASE WHEN ?::boolean
          THEN GREATEST(run_after, LEAST(NOW() + (?::int * INTERVAL '1 millisecond'), created_at + (?::int * INTERVAL '1 millisecond')))
          ELSE run_after END
      WHERE key = ? AND status = 'waiting' RETURNING id`,
    [orgId, full, JSON.stringify(ids), MAX_PEOPLE, JSON.stringify(ids), full, laterMs, FULL_MAX_WAIT_MS(), `scores:${orgId}`]);
  return rows.length ? rows[0].id : null;
}

// Ask for a recompute. `donorIds` null (or empty) asks for the full pass.
// Resolves when the ask is on the queue; never throws.
async function schedule(orgId, donorIds = null, { laterMs = null } = {}) {
  if (!orgId) return null;
  const ids = [...new Set((donorIds || []).filter(x => typeof x === "string" && x))];
  const full = !ids.length;
  const wait = laterMs != null ? laterMs : full ? FULL_DEBOUNCE_MS() : DEBOUNCE_MS();
  try {
    for (let i = 0; i < 3; i++) {
      const folded = await fold(orgId, ids, full, wait);
      if (folded) return folded;
      const id = await JQ.enqueue({ name: "handler:scores", orgId, key: `scores:${orgId}`,
        payload: { orgId, full: full || ids.length > MAX_PEOPLE, donorIds: ids.slice(0, MAX_PEOPLE) }, runAfterMs: wait });
      if (id) return id;   // null: another ask made the waiting job a moment ago; fold into it
    }
  } catch (e) { console.error("[scores] enqueue:", e.message); }
  return null;
}

module.exports = { schedule, idsOfRequest, recomputePeople };
