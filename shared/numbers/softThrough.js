// shared/numbers/softThrough.js · TRUTH-5. WHAT WAS GIVEN THROUGH A RECORD.
//
// The fleet (W-1109-Finance-37X) opened Marlowe Charitable Trust and read its
// linked people each with their whole lifetime (summing to $105,503) beside
// the trust's own $4,682. A person's lifetime is theirs, not the trust's. What
// went THROUGH the trust is soft credit: the part of the trust's own gifts
// credited to each person (gift_soft_credits on a gift whose donor is the
// trust). The Through list says that, per person, and its line:
//   "$4,682 given through the trust, by 3 people"
// where $4,682 is the trust's money that carries a soft credit (each gift once)
// and 3 is the people credited. A refund or a credit row is not money given
// (money.js MONEY); a deleted person is not listed.
"use strict";
const { MONEY } = require("./money");
// What counts as an organization (NUMBERS-8).
const ORG_SQL = o => `(LOWER(COALESCE(${o}.kind, '')) IN ('organisation', 'organization') OR jsonb_exists(COALESCE(${o}.person_types, '[]'::jsonb), 'organization'))`;   // jsonb_exists: a bare ? is a bind placeholder here

// How a row was credited, in words for the rail.
// NUMBERS-10 item 3: a program officer link credits too (`officer_link`).
const HOW_WORDS = Object.freeze({
  soft_credit: "soft credit on its gifts",
  gives_through_link: "soft credit: linked as Owner, gives through it",
  officer_link: "soft credit: linked as its program officer, gives through it",
  both: "soft credit: linked to it, and credited on its gifts",
});
// The rail's words for one organization's row, from every way it was credited (Postgres array of `how`).
function howWordsOf(hows) {
  const set = new Set((hows || []).filter(Boolean));
  if (set.size <= 1) return HOW_WORDS[[...set][0]] || HOW_WORDS.soft_credit;
  const links = [set.has("gives_through_link") && "as Owner", set.has("officer_link") && "as its program officer"].filter(Boolean);
  return `soft credit: linked ${links.join(" and ")}${set.has("soft_credit") ? ", and credited on its gifts" : ""}`;
}
// The links that credit a person with an organization's gifts, person first: Owner (stored person first,
// POLISH-4) and Program officer (stored organization first, GRANTS: donor_id_a = the funder). One row per
// (person, organization, how). Works at and the other kinds credit nothing.
const CREDIT_LINKS = () => `(
    SELECT dr.org_id, dr.donor_id_a AS person_id, dr.donor_id_b AS through_id, 'gives_through_link'::text AS how
      FROM donor_relationships dr WHERE dr.relationship_type = 'owner'
    UNION
    SELECT dr.org_id, dr.donor_id_b, dr.donor_id_a, 'officer_link'
      FROM donor_relationships dr WHERE dr.relationship_type = 'program_officer'
  )`;

// NUMBERS-9 item 5 (W-1125-Finance-37, repeat). WHAT AN ORGANIZATION'S GIFTS CREDIT TO A PERSON: one
// derived table, read by the person's Gives through, the organization's Given through it, its line and the
// `gives-through` figure source, so all four foot to the cent. A row is (person_id, through_id, gift_id,
// cents, how), over the organization's own gifts that are money above $0 (money.js MONEY), both records live:
//   soft_credit          an explicit soft credit on the gift (gift_soft_credits), at its amount;
//   gives_through_link   the person is linked to the organization as Owner ("gives through", HOUSEHOLD-1 and
//                        POLISH-4: person first, donor_id_a) and holds no explicit soft credit on that gift:
//                        the whole gift is credited to them, softly.
//   officer_link         NUMBERS-10 item 3 (W-1125-Finance-37, third night): the same, for a person linked as the
//                        organization's program officer (stored organization first). The fleet read a foundation's
//                        $25,000 beside its officer's empty record; the gifts came through him, so he is credited.
// Either way it is recognition, never money they gave: it is never added to their own lifetime.
// `$1`-free: binds (org, org) once per use, in that order. Callers narrow it with WHERE on its columns.
const CREDITED_THROUGH = () => `(
    SELECT sc.donor_id AS person_id, g.donor_id AS through_id, g.id AS gift_id, g.date,
           ROUND(sc.amount * 100)::bigint AS cents, 'soft_credit'::text AS how
      FROM gift_soft_credits sc
      JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
      JOIN donors o ON o.id = g.donor_id AND o.org_id = g.org_id AND o.deleted_at IS NULL
      JOIN donors p ON p.id = sc.donor_id AND p.org_id = sc.org_id AND p.deleted_at IS NULL
     WHERE sc.org_id = ? AND g.donor_id <> sc.donor_id AND ${MONEY("g")} AND g.amount > 0
    UNION ALL
    SELECT lk.person_id, g.donor_id, g.id, g.date, ROUND(g.amount * 100)::bigint, lk.how
      FROM (SELECT DISTINCT ON (l.org_id, l.person_id, l.through_id) l.* FROM ${CREDIT_LINKS()} l
             ORDER BY l.org_id, l.person_id, l.through_id, l.how) lk   -- linked twice (Owner and officer): each gift once
      JOIN gifts g ON g.org_id = lk.org_id AND g.donor_id = lk.through_id
      JOIN donors o ON o.id = lk.through_id AND o.org_id = lk.org_id AND o.deleted_at IS NULL
      JOIN donors p ON p.id = lk.person_id AND p.org_id = lk.org_id AND p.deleted_at IS NULL
     WHERE lk.org_id = ? AND lk.person_id <> lk.through_id
       AND ${MONEY("g")} AND g.amount > 0 AND ${ORG_SQL("o")}
       AND NOT EXISTS (SELECT 1 FROM gift_soft_credits x WHERE x.org_id = g.org_id AND x.gift_id = g.id AND x.donor_id = lk.person_id)
  )`;

// Per person: what they hold through `orgDonorId`'s gifts. Map id -> cents.
async function throughByPerson(query, orgId, orgDonorId, personIds = null) {
  const rows = await query(
    `SELECT ct.person_id AS donor_id, COALESCE(SUM(ct.cents), 0)::bigint AS cents
       FROM ${CREDITED_THROUGH()} ct
      WHERE ct.through_id = ?${personIds ? " AND ct.person_id = ANY(?::text[])" : ""}
      GROUP BY ct.person_id`, personIds ? [orgId, orgId, orgDonorId, personIds] : [orgId, orgId, orgDonorId]);
  return new Map(rows.map(r => [r.donor_id, Number(r.cents) || 0]));
}
// The line: the record's own gifts credited to anyone (each gift once), and how many people.
async function throughSummary(query, orgId, orgDonorId) {
  const [r] = await query(
    `WITH ct AS (SELECT * FROM ${CREDITED_THROUGH()} c WHERE c.through_id = ?)
     SELECT COALESCE((SELECT SUM(ROUND(g.amount * 100)) FROM gifts g WHERE g.org_id = ? AND g.id IN (SELECT ct.gift_id FROM ct)), 0)::bigint AS cents,
            (SELECT COUNT(DISTINCT ct.person_id) FROM ct)::int AS people`,
    [orgId, orgId, orgDonorId, orgId]);
  return { cents: Number(r && r.cents) || 0, people: Number(r && r.people) || 0 };
}
// NUMBERS-8 item 2, NUMBERS-9 item 5: the person's side. Every organization whose own gifts credit
// `personId` (an explicit soft credit, or an Owner link), with what they hold through each: the same
// rows as throughByPerson, so the person's line and the organization's row for them are one number.
// `how` says which: "soft_credit", "gives_through_link", "officer_link", or "both".
async function givesThroughOf(query, orgId, personId) {
  const rows = await query(
    `SELECT ct.through_id, o.name, COALESCE(SUM(ct.cents), 0)::bigint AS cents, COUNT(DISTINCT ct.gift_id)::int AS gifts,
            CASE WHEN COUNT(DISTINCT ct.how) > 1 THEN 'both' ELSE MIN(ct.how) END AS how, ARRAY_AGG(DISTINCT ct.how) AS hows
       FROM ${CREDITED_THROUGH()} ct
       JOIN donors o ON o.id = ct.through_id AND o.org_id = ?
      WHERE ct.person_id = ? AND ${ORG_SQL("o")}   -- the person's side lists organizations (NUMBERS-8); a trust's own Through list reads any record
      GROUP BY ct.through_id, o.name
      ORDER BY cents DESC, o.name`, [orgId, orgId, orgId, personId]);
  return rows.map(r => ({ id: r.through_id, name: r.name, cents: Number(r.cents) || 0, gifts: Number(r.gifts) || 0, how: r.how,
    howWords: howWordsOf(r.hows),
    source: { key: "gives-through", params: { donor: personId, through: r.through_id } } }));
}
const GIVEN_THROUGH_SENTENCE = "Given through it: the part of this organization's own gifts credited to each person, softly: a soft credit on a gift, or every gift when the person is linked as Owner or as its program officer (gives through it). Each is the same figure that person's Gives through shows, and none is added to this organization's lifetime.";
const GIVES_THROUGH_SENTENCE = "Gives through: the part of each organization's own gifts credited to this person, softly: a soft credit on a gift, or every gift when they are linked as its Owner or its program officer. It is the same figure the organization shows beside their name, and it is never added to their own lifetime.";

const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const summaryWords = (s, name = "this record") => (s.people
  ? `${usd(s.cents)} given through ${name}, by ${s.people} ${s.people === 1 ? "person" : "people"}`
  : `Nothing given through ${name} is soft-credited to anyone yet`);

const SENTENCE = "Given through: the part of this record's own gifts credited to each person, softly: a soft credit on a gift, or every gift when the person is linked as Owner or as its program officer (gives through it). A person's lifetime giving is theirs, never added in here.";

module.exports = { CREDITED_THROUGH, CREDIT_LINKS, HOW_WORDS, howWordsOf, throughByPerson, throughSummary, summaryWords, SENTENCE, givesThroughOf, GIVES_THROUGH_SENTENCE, GIVEN_THROUGH_SENTENCE };
