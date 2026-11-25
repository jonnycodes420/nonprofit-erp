// server/donors/givesThroughSources.js · NUMBERS-8 item 2. The figure source behind Gives through
// and Given through it (shared/numbers/softThrough.js), in its own module so figureSources.js does not grow.
"use strict";

module.exports = () => ({
  // NUMBERS-8 item 2: what a person holds through one organisation (shared/numbers/softThrough.js):
  // the organisation's own gifts, at the amount each credits to them. The rail's Gives through line
  // and the organisation's row for the person both open these rows.
  "gives-through": {
    label: "Given through",
    measure: () => "sum",
    params: { donor: "id:required", through: "id:required" },
    sentence: () => "The organization's own gifts that credit this person, at the amount credited to them. A refund and a credit row are not money given.",
    sql: (orgId, p) => ({
      sql: `SELECT sc.id, 'soft_credit' AS type, g.donor_id, o.name, g.date, ROUND(sc.amount::numeric, 2) AS amount, 'Soft credit on their gift' AS detail
              FROM gift_soft_credits sc
              JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
              JOIN donors o ON o.id = g.donor_id AND o.org_id = g.org_id AND o.deleted_at IS NULL
              JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id AND d.deleted_at IS NULL
             WHERE sc.org_id = ? AND sc.donor_id = ? AND g.donor_id = ? AND ${require("../../shared/numbers/money").MONEY("g")} AND g.amount > 0`,
      args: [orgId, p.donor, p.through],
      order: "date DESC NULLS LAST, id",
    }),
  },
});
