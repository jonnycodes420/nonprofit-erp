// shared/numbers/broughtIn.js · CONNECT-1. WHAT THE PEOPLE SOMEONE BROUGHT IN HAVE GIVEN.
//
// Two links say how a person came in (server/donors/connections.js), each
// stored newcomer first (donor_id_a) and the connector second (donor_id_b):
//   introduced_by   "Introduced by Dana" on the newcomer, "Introduced Sam" on Dana
//   guest_of        "Guest of Dana" on the guest, "Brought Sam as a guest" on Dana,
//                   with the event they came to when one is named.
// They are context, never a giving unit: no total, household or lapse rule
// reads them (lapse.js UNIT_LINK_TYPES, households.js UNIT_LINK_TYPES).
//
// The connector's line reads "Brought in 4 people · $12,400 given since":
//   people   the live people (households.js PERSON) linked to them by either
//            type, each person once however many links they have.
//   given    every gift those people gave dated on or after the day of their
//            link: the event's day for a Guest of link that names one, else the
//            day the link was made, in the org's time zone. The earliest link
//            counts when there are several. Money is money.js's rule (hard
//            credit, a refund comes off, a scheduled gift not before its day);
//            a gift with no date cannot be shown to be after, so it is out. A
//            total brought in from an old system is not a gift row and is out.
// Each gift stays credited to whoever gave it; this is recognition only.
// The figure sources "brought-in-people" and "brought-in-gifts"
// (server/donors/broughtInSources.js) read the SQL below, so the line and
// the rows it opens are one list.
"use strict";
const { MONEY } = require("./money");
const { PERSON } = require("./households");
const orgTime = require("../../orgTime");

const CONNECT_TYPES = Object.freeze(["introduced_by", "guest_of"]);
const TYPES_SQL = "('introduced_by','guest_of')";

// The civil day a link `r` starts from (`ev` is its event, LEFT JOINed).
const LINK_DAY = (r = "r", ev = "ev") =>
  `COALESCE(NULLIF(LEFT(${ev}.date::text, 10), ''), to_char(${r}.created_at AT TIME ZONE ${orgTime.orgTzSql(`${r}.org_id`)}, 'YYYY-MM-DD'))`;

// The people connector `?` brought in, with the day each one's first link
// starts. Args: [orgId, connectorId].
const BROUGHT_SQL = `
  SELECT r.donor_id_a AS person_id, MIN(${LINK_DAY("r", "ev")}) AS since,
         BOOL_OR(r.relationship_type = 'introduced_by') AS introduced,
         STRING_AGG(DISTINCT ev.name, ', ') AS events
    FROM donor_relationships r
    JOIN donors p ON p.id = r.donor_id_a AND p.org_id = r.org_id AND ${PERSON("p")}
    LEFT JOIN events ev ON ev.id = r.event_id AND ev.org_id = r.org_id
   WHERE r.org_id = ? AND r.donor_id_b = ? AND r.relationship_type IN ${TYPES_SQL} AND r.donor_id_a <> r.donor_id_b
   GROUP BY r.donor_id_a`;

// Rows for the figure drawer: one per person brought in.
function peopleRowsSql(orgId, connectorId) {
  return {
    sql: `SELECT b.person_id AS id, 'person' AS type, b.person_id AS donor_id, p.name, b.since AS date, NULL::numeric AS amount,
                 CASE WHEN b.introduced THEN 'Introduced by them' ELSE 'Their guest' END
                   || CASE WHEN b.events IS NOT NULL THEN ' · ' || b.events ELSE '' END AS detail
            FROM (${BROUGHT_SQL}) b JOIN donors p ON p.id = b.person_id AND p.org_id = ?`,
    args: [orgId, connectorId, orgId],
    order: "date, name, id",
  };
}

// Rows for the figure drawer: every gift that counts, refunds as negative rows.
function giftRowsSql(orgId, connectorId) {
  return {
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, p.name, LEFT(g.date, 10) AS date, ROUND(g.amount::numeric, 2) AS amount,
                 'Given on or after ' || b.since || ', when they came in' AS detail
            FROM (${BROUGHT_SQL}) b
            JOIN gifts g ON g.org_id = ? AND g.donor_id = b.person_id
            JOIN donors p ON p.id = b.person_id AND p.org_id = g.org_id
           WHERE ${MONEY("g")} AND g.amount <> 0 AND g.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(g.date, 10) >= b.since`,
    args: [orgId, connectorId, orgId],
    order: "date DESC, id",
  };
}

// SQL: donor `d` brought at least one live person in.
const BROUGHT_ANY = (d = "donors") => `EXISTS (SELECT 1 FROM donor_relationships rb
    JOIN donors pb ON pb.id = rb.donor_id_a AND pb.org_id = rb.org_id AND ${PERSON("pb")}
   WHERE rb.org_id = ${d}.org_id AND rb.donor_id_b = ${d}.id AND rb.relationship_type IN ${TYPES_SQL} AND rb.donor_id_a <> rb.donor_id_b)`;

const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
// "Brought in 4 people · $12,400 given since"
const words = ({ people, cents }) => `Brought in ${people} ${people === 1 ? "person" : "people"} · ${usd(cents)} given since`;

const PEOPLE_SENTENCE = "The people this person introduced, or brought as a guest, each counted once. Someone deleted is not counted.";
const GIFTS_SENTENCE = "Every gift from the people this person introduced or brought as a guest, dated on or after the day they came in (a guest's event day, or the day the link was made), with refunds taken off. Soft and matching credits are not gifts, and a total brought in from an old system is not counted. Each gift stays credited to whoever gave it.";

module.exports = { CONNECT_TYPES, LINK_DAY, BROUGHT_SQL, BROUGHT_ANY, peopleRowsSql, giftRowsSql, words, PEOPLE_SENTENCE, GIFTS_SENTENCE };
