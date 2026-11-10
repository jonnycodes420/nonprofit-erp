// server/wealth/access.js · WEALTH-1. WHO SEES A WEALTH SCORE.
//
// By default, the people who see Room to give: admins and staff an admin gave
// the major gifts permission (prospect.canSee, read live, never from the JWT).
// An admin may open it to the whole team in Settings ("Everyone on the team
// can see Wealth Scores", orgs.wealth_scores_team). Nothing donor-facing ever
// reads it: no merge field, no giving page, no receipt, no portal.
//
// The SERVER is the boundary. A request that names the field (a filter, a
// sort, a column, a report, an Atlas question) from someone who may not see
// it is refused with 403, never quietly answered without it.
"use strict";
const { query } = require("../../db");

const FIELD = "wealth_score";   // the key the list, reports and Atlas know it by
const REFUSAL = { error: "wealth_score_hidden",
  sentence: "Wealth Scores are for admins and staff with the major gifts permission. An admin can open them to the whole team in Settings." };

async function teamMaySee(orgId) {
  const [o] = await query(`SELECT wealth_scores_team FROM orgs WHERE id = ?`, [orgId]);
  return !!(o && o.wealth_scores_team);
}

async function maySee(userId, orgId) {
  if (!userId || !orgId) return false;
  // ACCESS-2: the Campaign cabinet preset sees no Wealth Score, whatever else is on.
  if (!(await require("../auth/portfolio").accessFor(userId, orgId)).canWealth) return false;
  const P = require("../../prospect");
  if (await P.canSee(userId, orgId)) return true;
  if (!(await teamMaySee(orgId))) return false;
  // The team switch opens it to staff who can open the CRM at all; a live,
  // active member of this org (canSee above already read the row for admins).
  const [u] = await query(`SELECT org_id, role, deactivated_at FROM users WHERE id = ?`, [userId]);
  if (!u || u.deactivated_at) return false;
  if (String(u.org_id) !== String(orgId)) return !!(await require("../auth/access").liveRoleIn(userId, orgId));
  return u.role !== "volunteer_coordinator";
}

// Does this text (a where= filter, a cols= list, a sort key, a saved
// definition) name the Wealth Score? A plain substring of the field key: the
// key appears nowhere else, so a false positive costs a 403 and nothing more.
function names(v) {
  if (v === null || v === undefined) return false;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.includes(FIELD);
}

module.exports = { FIELD, REFUSAL, maySee, teamMaySee, names };
