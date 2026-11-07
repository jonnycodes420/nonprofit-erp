// server/groups/atlasExpiry.js · TIDY-1 item 2. ATLAS'S GROUPS DON'T PILE UP.
//
// "Open list" (ATLAS-3, routes/atlas.js) keeps each answer's people as a
// static group, one per question. They are marked made_by='atlas', the Groups
// page shows them under "From Atlas" rather than with the groups people made,
// and a group Atlas made goes after 30 days unless somebody kept it:
//   · renamed it (audiences.renamed_at, set by PATCH /groups/:id),
//   · pinned it (audiences.pinned_at, POST /groups/:id/pin),
//   · or used it in a campaign (a campaign's segment names its id);
//   · and a journey or survey that points at it keeps it too.
// The people are never touched; only the list goes (group_members cascades).
// Run daily by the expireAtlasGroups job (routes/jobs.js), which records one
// audit row per org it changed (jobAudit.js). `now` is the caller's clock, so
// a test sets it.
"use strict";

const KEEP_DAYS = 30;
// A group Atlas made before TIDY-1 carries no made_by; it is recognised by the
// description Atlas wrote, for the "From Atlas" section only. It is never
// expired: whether somebody renamed it before renamed_at existed is unknown.
const ATLAS_DESC_PREFIX = "The people Atlas found for \"";

function isFromAtlas(row) {
  if (!row) return false;
  return row.made_by === "atlas" || String(row.description || "").startsWith(ATLAS_DESC_PREFIX);
}

// `query(sql, params)` with $n placeholders: the server's pool or a suite's.
async function expireAtlasGroups(query, { orgId = null, now = new Date() } = {}) {
  const rows = await query(
    `DELETE FROM audiences a
      WHERE a.made_by = 'atlas' AND a.pinned_at IS NULL AND a.renamed_at IS NULL
        AND a.created_at < $1::timestamptz - make_interval(days => $3::int)
        AND ($2::text IS NULL OR a.org_id = $2)
        AND NOT EXISTS (SELECT 1 FROM campaigns c
                         WHERE c.org_id = a.org_id AND COALESCE(c.segment, '') LIKE '%' || a.id || '%')
        -- and never one a journey or a survey still points at (it would leave them pointing at nothing)
        AND NOT EXISTS (SELECT 1 FROM workflows w
                         WHERE w.org_id = a.org_id
                           AND (COALESCE(w.trigger, '') || COALESCE(w.config::text, '') || COALESCE(w.conditions::text, '') || COALESCE(w.actions::text, '')) LIKE '%' || a.id || '%')
        AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s.org_id = a.org_id AND COALESCE(s.audience, '') LIKE '%' || a.id || '%')
      RETURNING a.id, a.org_id`,
    [new Date(now).toISOString(), orgId, KEEP_DAYS]);
  const list = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
  const perOrg = {};
  for (const r of list) perOrg[r.org_id] = (perOrg[r.org_id] || 0) + 1;
  const orgs = Object.keys(perOrg);
  return {
    orgs, counts: { groupsRemoved: list.length },
    detail: `${list.length} Atlas ${list.length === 1 ? "group" : "groups"} older than ${KEEP_DAYS} days removed`,
    summary: list.length ? `Removed ${list.length} ${list.length === 1 ? "list" : "lists"} Atlas made over ${KEEP_DAYS} days ago that nobody renamed, pinned or used in a campaign.` : null,
    removed: list.map(r => r.id),
  };
}

module.exports = { KEEP_DAYS, ATLAS_DESC_PREFIX, isFromAtlas, expireAtlasGroups };
