// shared/numbers/everyone.js · INTEGRITY-1 (W-1107-Prod-04). WHO "EVERYONE" IS.
//
// Everyone = the active people records in the org: donors and contacts. A
// row in `donors` (organisations and non-donor people are rows there too,
// CLAUDE.md "One person record") that is not in the trash, not an erased
// shell (TRUTH-2) and not archived (THREAD-3). Users are never in it: a user
// is a row in `users`, and a staff or board person is in it only as a person
// record of their own. Donors + Contacts = Everyone, by construction
// (groups.directoryRoles counts contacts as everyone who is not a donor).
//
// The Directory's tabs, its list and the people total on /donors/summaries
// read this one fragment. Money surfaces keep archived people (THREAD-3) and
// read shared/numbers/households.js PERSON, which is a different question.
"use strict";

// SQL: `d` (an alias or the bare table name) is one of Everyone.
const EVERYONE = (d = "donors") => `(${d}.deleted_at IS NULL AND ${d}.erased_at IS NULL AND ${d}.archived_at IS NULL)`;

const SENTENCE = "Everyone: every active person record here, donors and contacts, not counting anyone in the trash, archived, or erased, and never a user's login.";

// JS, over donors rows already read: the same rule. TRUTH-4: Communications'
// "people in it" counts read this, so "with email" can never exceed Everyone.
const isEveryone = d => !!d && !d.deleted_at && !d.erased_at && !d.archived_at;
const hasEmail = d => !!(d && d.email && String(d.email).trim());

// ACCESS-2: `visible` (server/auth/portfolio.js visibleSql) narrows Everyone to
// a portfolio user's people; omitted, it is the whole org.
async function everyoneCount(query, orgId, visible) {
  const v = visible && visible.sql ? visible : { sql: "", args: [] };
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM donors WHERE donors.org_id = ? AND ${EVERYONE("donors")}${v.sql}`, [orgId, ...v.args]);
  return r ? Number(r.n) : 0;
}

module.exports = { EVERYONE, SENTENCE, everyoneCount, isEveryone, hasEmail };
