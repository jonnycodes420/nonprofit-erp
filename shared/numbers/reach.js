// shared/numbers/reach.js · COMMS-3 item 3. WHO YOU CAN REACH, AND HOW.
//
// Communications → Audience opens with every donor split three ways, and each
// count opens its people (figure source "reach-part", server/outreach/audienceSources.js):
//   email  has an email address on the record (the same test the email
//          audiences use: email present and not blank).
//   mail   no email, and a postal address good enough to post to: a street, a
//          city, and a state or a ZIP (shared/ackLetter.js addressLines, the
//          rule Printed letters uses to print a letter at all).
//   none   neither.
// The people are DEFINE-1's Donors population (populations.js "donors":
// Everyone's rule and IS_DONOR), so the three always add to Donors' own count.
// "Given" beside a part is each person's Lifetime (lifetime.js LIFETIME), summed.
"use strict";
const { EVERYONE } = require("./everyone");
const { IS_DONOR } = require("./isDonor");
const { LIFETIME } = require("./lifetime");

const filled = c => `NULLIF(TRIM(COALESCE(${c}::text, '')), '') IS NOT NULL`;
const HAS_EMAIL = (d = "d") => `(${d}.email IS NOT NULL AND ${d}.email <> '')`;
const HAS_POSTAL = (d = "d") => `(${filled(`${d}.address`)} AND ${filled(`${d}.city`)} AND (${filled(`${d}.state`)} OR ${filled(`${d}.zip`)}))`;
const PART_SQL = (d = "d") => `(CASE WHEN ${HAS_EMAIL(d)} THEN 'email' WHEN ${HAS_POSTAL(d)} THEN 'mail' ELSE 'none' END)`;
const PARTS = ["email", "mail", "none"];

const SENTENCES = {
  email: "Donors with an email address on their record. Some may still be unsubscribed or bounced; a campaign says who before it sends.",
  mail: "Donors with no email address and a postal address Steward can print a letter to: a street, a city, and a state or a ZIP.",
  none: "Donors with neither an email address nor a full postal address. Add one on their record to reach them.",
};
const ALL_SENTENCE = "Donors: everyone who has given at least once (a gift on file, or a lifetime total from the old system).";
const GIVEN_SENTENCE = "Given is each person's Lifetime giving, added up: every gift on file, refunds off, plus a total brought in from an old system.";

// One row per donor: id, name, part, life (dollars, 2dp), last gift date.
function reachRowsSql(orgId, part = null) {
  return {
    sql: `SELECT d.id, d.name, ${PART_SQL("d")} AS part, ROUND(${LIFETIME("d")}, 2) AS life, d.last_gift_date
            FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")} AND ${IS_DONOR("d")}${part ? ` AND ${PART_SQL("d")} = ?` : ""}`,
    args: part ? [orgId, part] : [orgId],
  };
}

// { total, parts: { email: { count, cents }, mail: {...}, none: {...} } }
async function reachCounts(query, orgId) {
  const q = reachRowsSql(orgId);
  const rows = await query(`SELECT part, COUNT(*)::int AS n, COALESCE(SUM(ROUND(life * 100)), 0)::bigint AS cents FROM (${q.sql}) r GROUP BY part`, q.args);
  const parts = Object.fromEntries(PARTS.map(p => [p, { count: 0, cents: 0 }]));
  for (const r of rows) parts[r.part] = { count: Number(r.n) || 0, cents: Number(r.cents) || 0 };
  return { total: PARTS.reduce((n, p) => n + parts[p].count, 0), parts };
}

module.exports = { HAS_EMAIL, HAS_POSTAL, PART_SQL, PARTS, SENTENCES, ALL_SENTENCE, GIVEN_SENTENCE, reachRowsSql, reachCounts };
