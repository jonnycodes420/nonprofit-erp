// server/dataHealth/integrity.js · INTEGRITY-1. TWO DATA HEALTH CHECKS AND
// THE ONE EMAIL RULE.
//
//   W-1107-Fundraising-15X · AN EMAIL BELONGS TO ONE ACTIVE PERSON PER ORG.
//     One address sat on two different people, silently. Now adding or
//     editing a person with an address another active person already has
//     answers with a warning naming them (emailOwners, read on save), and
//     Data health lists every address on more than one active person
//     (sharedEmailRows). It is never silently allowed; it is not refused
//     either, because a family inbox is real and a person decides.
//   W-1107-Fundraising-06X · A PERSON AND THEIR HOUSEHOLD WITH THE SAME GIFTS.
//     "Prudence Ashford" and "Henry and Prudence Ashford" each held the same
//     gifts. identicalGiftRows lists two people in one giving unit (one
//     household, or linked as spouse, partner or gives-through) whose gifts,
//     date and amount, are exactly the same: one set was entered twice.
// Placeholder addresses ("n/a", "no@email.com") are not an address
// (realValues.realEmail), so they are never "shared".
"use strict";

const { realEmail } = require("./realValues");
const { EVERYONE } = require("../../shared/numbers/everyone");
const { MONEY } = require("../../shared/numbers/money");

// The other active people who already have this address (lower-cased), or [].
async function emailOwners(query, orgId, email, exceptId = null) {
  const e = realEmail(email);
  if (!e) return [];
  return query(`SELECT d.id, d.name FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")} AND LOWER(TRIM(d.email)) = ? AND d.id IS DISTINCT FROM ?
                 ORDER BY d.name, d.id LIMIT 5`, [orgId, e, exceptId]);
}
// The warning a save answers with, or null.
async function emailWarning(query, orgId, email, exceptId = null) {
  const others = await emailOwners(query, orgId, email, exceptId);
  if (!others.length) return null;
  const names = others.map(o => o.name || "a person with no name");
  return { kind: "email_shared", email: realEmail(email), others: others.map(o => ({ id: o.id, name: o.name })),
    sentence: `${realEmail(email)} is also on ${names.join(", ")}. An email belongs to one person; Data health lists it until one of them changes.` };
}

async function sharedEmailRows(query, orgId) {
  const rows = await query(
    `SELECT LOWER(TRIM(d.email)) AS email, json_agg(json_build_object('id', d.id, 'name', d.name) ORDER BY d.name, d.id) AS people
       FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")} AND COALESCE(TRIM(d.email), '') <> ''
      GROUP BY LOWER(TRIM(d.email)) HAVING COUNT(*) > 1 ORDER BY 1`, [orgId]);
  return rows.filter(r => realEmail(r.email)).map(r => ({ email: r.email, people: typeof r.people === "string" ? JSON.parse(r.people) : r.people }));
}

async function identicalGiftRows(query, orgId) {
  return query(
    `WITH sig AS (
       SELECT g.donor_id, string_agg(LEFT(g.date, 10) || ':' || g.amount::text, ',' ORDER BY LEFT(g.date, 10), g.amount) AS s,
              COUNT(*)::int AS n, SUM(g.amount) AS total
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND ${EVERYONE("d")}
        WHERE g.org_id = ? AND g.amount > 0 AND ${MONEY("g")}
        GROUP BY g.donor_id),
     pairs AS (
       SELECT a.id AS a, b.id AS b, 'household' AS how FROM donors a JOIN donors b ON b.org_id = a.org_id AND b.household_id = a.household_id AND a.id < b.id
        WHERE a.org_id = ? AND a.household_id IS NOT NULL AND ${EVERYONE("a")} AND ${EVERYONE("b")}
       UNION
       SELECT LEAST(r.donor_id_a, r.donor_id_b), GREATEST(r.donor_id_a, r.donor_id_b), CASE WHEN r.relationship_type = 'owner' THEN 'gives through' ELSE 'household' END
         FROM donor_relationships r WHERE r.org_id = ? AND r.relationship_type IN ('owner','spouse','partner'))
     SELECT p.a, da.name AS a_name, p.b, db.name AS b_name, MIN(p.how) AS how, sa.n AS gifts, sa.total
       FROM pairs p JOIN sig sa ON sa.donor_id = p.a JOIN sig sb ON sb.donor_id = p.b AND sb.s = sa.s
       JOIN donors da ON da.id = p.a JOIN donors db ON db.id = p.b
      GROUP BY p.a, da.name, p.b, db.name, sa.n, sa.total
      ORDER BY sa.total DESC, p.a`, [orgId, orgId, orgId]);
}

module.exports = { emailOwners, emailWarning, sharedEmailRows, identicalGiftRows };
