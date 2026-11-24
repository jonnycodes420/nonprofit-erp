// shared/numbers/stewardStart.js · ATLAS-9. THE DAY THE ORG STARTED WITH STEWARD, AS ONE FUNCTION.
//
// The rule and its reasons are written at server/shared/crmCommon.js
// orgStewardStart (the first donor this org created, else the org's own row,
// formatted in the org's zone). It lived inside that route factory, so the
// Atlas brief (server/atlas/briefOpen.js), which reads the profile's "not yet
// thanked" from the same day, could not reach it. The SQL is here now and
// crmCommon calls it, so the two read one rule.
"use strict";

async function stewardStart(query, orgId, tz) {
  const [row] = await query(
    `SELECT TO_CHAR(COALESCE(
        (SELECT MIN(created_at) FROM donors WHERE org_id = ?),
        (SELECT created_at FROM orgs WHERE id = ?),
        NOW()
      ) AT TIME ZONE ?, 'YYYY-MM-DD') AS d`, [orgId, orgId, tz]);
  return row && row.d ? String(row.d) : null;
}

module.exports = { stewardStart };
