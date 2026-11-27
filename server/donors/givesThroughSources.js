// server/donors/givesThroughSources.js · NUMBERS-8 item 2. The figure source behind Gives through
// and Given through it (shared/numbers/softThrough.js), in its own module so figureSources.js does not grow.
"use strict";

module.exports = () => ({
  // NUMBERS-8 item 2, NUMBERS-9 item 5: what a person holds through one organisation (shared/numbers/softThrough.js
  // CREDITED_THROUGH): its own gifts, at the soft credit's amount or whole through an Owner or program officer link (NUMBERS-10). The rail's Gives through line
  // and the organisation's row for the person both open these rows.
  "gives-through": {
    label: "Given through",
    measure: () => "sum",
    params: { donor: "id:required", through: "id:required" },
    sentence: () => "The organization's own gifts credited to this person, softly: at the soft credit's amount, or the whole gift when they are linked as its Owner or its program officer (gives through it). Recognition, never added to their own lifetime. A refund and a credit row are not money given.",
    // NUMBERS-9 item 5: the one table the rail's Gives through and the organization's Given through it read.
    sql: (orgId, p) => {
      const ST = require("../../shared/numbers/softThrough");
      return {
        sql: `SELECT ct.gift_id || ':' || ct.how AS id, ct.how AS type, ct.through_id AS donor_id, o.name, ct.date, ROUND(ct.cents / 100.0, 2) AS amount,
                     CASE ct.how WHEN 'gives_through_link' THEN 'Their gift, credited through the Owner link (soft credit)' WHEN 'officer_link' THEN 'Their gift, credited through the program officer link (soft credit)' ELSE 'Soft credit on their gift' END AS detail
                FROM ${ST.CREDITED_THROUGH()} ct
                JOIN donors o ON o.id = ct.through_id AND o.org_id = ?
               WHERE ct.person_id = ? AND ct.through_id = ?`,
        args: [orgId, orgId, orgId, p.donor, p.through],
        order: "date DESC NULLS LAST, id",
      };
    },
  },
});
