// NUMBERS-1 · THE TOTALS KEPT ON A PERSON, said once.
//
// donors.total_giving, gift_count, last_gift_date and last_gift_amount are a
// rollup that the donor list, groups, households, portfolios, exports and the
// staff emails read without touching gifts. They are recomputed from the gifts
// on every write that could change them, by this one statement, and never
// added to or subtracted from:
//   · total_giving is the sum of the person's gifts, refunds taken off (an
//     imported total with no gifts behind it is not kept by a recompute; that
//     is the next build's, see docs/numbers-1/inventory.md);
//   · gift_count is the gifts above zero (a refund is not a gift);
//   · the last gift is the latest by date, and on one day the one recorded
//     last, the same gift the profile's Last gift opens (figureSources.js);
//   · a person with no gifts left has a zero total and no last gift.
// `$1` is the org; `scope` narrows it (e.g. "AND d.id = ANY($2)").
// No requires, so server.js, afterChange.js and the seed all load it.
const LAST_GIFT_ORDER = "g.date DESC, g.created_at DESC, g.id DESC";

const DONOR_SUMMARY_UPDATE = (scope = "") => `
  UPDATE donors d SET
    total_giving = COALESCE(s.total, 0),
    gift_count = COALESCE(s.n, 0),
    last_gift_date = s.last_date,
    last_gift_amount = COALESCE(s.last_amt, 0),
    updated_at = NOW()
  FROM (SELECT dd.id AS donor_id, SUM(g.amount) AS total, COUNT(g.id) FILTER (WHERE g.amount > 0) AS n,
               MAX(g.date) AS last_date, (ARRAY_AGG(g.amount ORDER BY ${LAST_GIFT_ORDER}))[1] AS last_amt
          FROM donors dd LEFT JOIN gifts g ON g.donor_id = dd.id AND g.org_id = dd.org_id
         WHERE dd.org_id = $1 ${scope.replace(/\bd\./g, "dd.")}
         GROUP BY dd.id) s
  WHERE d.id = s.donor_id AND d.org_id = $1`;

// A soft credit follows its gift when the gift's amount changes (an edit, a
// split, a partial refund): a share stays that share of the new amount, a fixed
// amount is never more than the gift, and a gift at or below zero credits
// nobody. Found by the random test: a 100% credit on a gift split to $16.43
// still said $100.50. `$1` is the gift, `$2` the org. Two statements, in order.
const SOFT_CREDIT_RESIZE = [
  `DELETE FROM gift_soft_credits sc USING gifts g
    WHERE g.id = sc.gift_id AND g.org_id = sc.org_id AND sc.gift_id = $1 AND sc.org_id = $2
      AND (g.amount <= 0 OR (sc.pct IS NOT NULL AND ROUND(g.amount * sc.pct / 100, 2) <= 0))`,
  `UPDATE gift_soft_credits sc
      SET amount = CASE WHEN sc.pct IS NOT NULL THEN ROUND(g.amount * sc.pct / 100, 2) ELSE LEAST(sc.amount, g.amount) END
     FROM gifts g
    WHERE g.id = sc.gift_id AND g.org_id = sc.org_id AND sc.gift_id = $1 AND sc.org_id = $2`,
];

module.exports = { DONOR_SUMMARY_UPDATE, LAST_GIFT_ORDER, SOFT_CREDIT_RESIZE };
