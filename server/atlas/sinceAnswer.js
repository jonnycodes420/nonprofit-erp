// server/atlas/sinceAnswer.js · FRESH-2 item 4. A FOLLOW-UP SAYS WHEN ITS ROWS ARE OLDER THAN A CHANGE.
//
// "list them" and "tell me more" draw the last answer's own rows again
// (rowsSteps.js prior_rows), stored with that request. A gift saved or a person
// changed between the question and the follow-up is not in those rows, and the
// mega sweep (25 Nov) read that as Atlas answering from old numbers. A question
// asked fresh reads live; a follow-up now says when something it counts moved
// after the answer it is drawing, so she asks again instead of trusting it.
"use strict";

// The tables a list or a why answer is made of (shared/changeTopics.cjs: gift and person).
const MOVES = ["gifts", "donors", "pledges", "soft_credits", "recurring_gifts"];

// The sentence to add, or null when nothing it counts changed after request `requestId`.
async function sinceLine(query, orgId, requestId) {
  if (!requestId) return null;
  const [r] = await query(
    `SELECT EXISTS (SELECT 1 FROM org_changes c, voice_memos m
                     WHERE m.id = ? AND m.org_id = ? AND c.org_key = m.org_id
                       AND c.at > m.created_at AND c.tbl = ANY(?::text[])) AS moved`,
    [String(requestId), orgId, MOVES]).catch(() => [null]);
  return r && r.moved ? "Gifts or people changed after that answer, so these are its rows as they stood then. Ask the question again for today's." : null;
}

module.exports = { sinceLine, MOVES };
