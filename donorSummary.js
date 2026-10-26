// NUMBERS-1 · THE TOTALS KEPT ON A PERSON, said once.
//
// donors.total_giving, gift_count, first_gift_date, last_gift_date and
// last_gift_amount are a rollup that the donor list, groups, households,
// portfolios, exports and the staff emails read without touching gifts. They
// are recomputed on every write that could change them, by this one statement,
// and never added to or subtracted from:
//   · NUMBERS-2: an IMPORTED TOTAL is its own figure (donors.imported_*: the
//     total, count, first and last gift dates the old system stated, its
//     source, the day it came in, and `imported_through`, the last day it
//     covers). No recompute touches it. Lifetime is the imported total plus
//     the gifts in Steward dated AFTER imported_through. A gift dated on or
//     before imported_through is inside the old system's total already, so it
//     is never added again (that is how overlap is decided);
//   · total_giving is that, refunds taken off;
//   · gift_count is the imported count (or, when the old system gave none,
//     the gifts above zero on file for its period) plus the gifts above zero
//     after it (a refund is not a gift);
//   · first_gift_date is the earliest of the imported first gift and the
//     first gift above zero on file; the last gift is the latest by date (the
//     imported last gift when nothing on file is as recent), and on one day
//     the one recorded last, the same gift the profile's Last gift opens;
//   · a person with no gifts and no imported total has a zero total and no
//     first or last gift.
// `$1` is the org; `scope` narrows it (e.g. "AND d.id = ANY($2)").
// No requires, so server.js, afterChange.js and the seed all load it.
const LAST_GIFT_ORDER = "g.date DESC, g.created_at DESC, g.id DESC";

// FIX-49 · THE OLD SYSTEM'S FIRST GIFT. The file's first gift date when it
// gave one; when it gave only a last gift date, that date, because the person
// was already a donor on it (a file that gave no dates at all says nothing,
// and the day of the import is not a gift, so imported_through is never used
// here). "Donor since", the lifecycle tags and first_gift_date all read this.
const IMPORTED_FIRST = (a = "d") => `COALESCE(NULLIF(${a}.imported_first_gift_date, ''), NULLIF(${a}.imported_last_gift_date, ''))`;

// A gift on file that the imported total does not already cover.
const AFTER_IMPORT = "(dd.imported_through IS NULL OR g.date > dd.imported_through)";

const DONOR_SUMMARY_UPDATE = (scope = "") => `
  UPDATE donors d SET
    total_giving = s.total,
    gift_count = s.n,
    first_gift_date = s.first_date,
    last_gift_date = s.last_date,
    last_gift_amount = s.last_amt,
    updated_at = NOW()
  FROM (SELECT x.donor_id,
               (COALESCE(x.imp_total, 0) + COALESCE(x.after_total, 0))::numeric(12,2) AS total,
               (COALESCE(x.imp_n, CASE WHEN x.imp_total IS NOT NULL THEN x.before_n END, 0) + x.after_n)::int AS n,
               NULLIF(LEAST(COALESCE(NULLIF(x.imp_first, ''), '9999-12-31'), COALESCE(x.row_first, '9999-12-31')), '9999-12-31') AS first_date,
               CASE WHEN x.row_last IS NOT NULL AND x.row_last >= COALESCE(NULLIF(x.imp_last, ''), '0000') THEN x.row_last ELSE NULLIF(x.imp_last, '') END AS last_date,
               (CASE WHEN x.row_last IS NOT NULL AND x.row_last >= COALESCE(NULLIF(x.imp_last, ''), '0000') THEN x.row_last_amt
                     WHEN NULLIF(x.imp_last, '') IS NOT NULL THEN COALESCE(x.imp_last_amt, 0) ELSE 0 END)::numeric(12,2) AS last_amt
          FROM (SELECT dd.id AS donor_id, dd.imported_total AS imp_total, dd.imported_gift_count AS imp_n,
                       ${IMPORTED_FIRST("dd")} AS imp_first, dd.imported_last_gift_date AS imp_last,
                       dd.imported_last_gift_amount AS imp_last_amt,
                       SUM(g.amount) FILTER (WHERE ${AFTER_IMPORT}) AS after_total,
                       COUNT(g.id) FILTER (WHERE g.amount > 0 AND ${AFTER_IMPORT}) AS after_n,
                       COUNT(g.id) FILTER (WHERE g.amount > 0 AND NOT ${AFTER_IMPORT}) AS before_n,
                       MIN(g.date) FILTER (WHERE g.amount > 0) AS row_first,
                       MAX(g.date) AS row_last,
                       (ARRAY_AGG(g.amount ORDER BY ${LAST_GIFT_ORDER}))[1] AS row_last_amt
                  FROM donors dd LEFT JOIN gifts g ON g.donor_id = dd.id AND g.org_id = dd.org_id
                 WHERE dd.org_id = $1 ${scope.replace(/\bd\./g, "dd.")}
                 GROUP BY dd.id) x) s
  WHERE d.id = s.donor_id AND d.org_id = $1
    -- A person whose totals already agree is not written (an undone merge must
    -- leave the row exactly as it was, updated_at included).
    AND (d.total_giving, d.gift_count, d.first_gift_date, d.last_gift_date, d.last_gift_amount)
        IS DISTINCT FROM (s.total, s.n, s.first_date, s.last_date, s.last_amt)`;

// NUMBERS-2 · AN IMPORTED TOTAL, KEPT AS ITS OWN FIGURE. A person who arrives
// with a total the file stated and no gifts (or fewer gifts than the total)
// behind it has that total copied into donors.imported_*, once, at the import,
// so the recompute above keeps it. The covered period ends on the file's last
// gift date, or the day of the import when the file gave none; the file's own
// gift rows for that period are inside the stated total, so they are not
// added to it. Run it after the import's gifts are in and before the recompute. `$1` org,
// `$2` the people, `$3` the source's words, `$4` the org's today. Only a person
// whose stated total stands above the gifts on file for them is touched, and
// never one who already has an imported total.
const KEEP_IMPORTED_TOTAL = `
  UPDATE donors d SET
    imported_total = d.total_giving,
    imported_gift_count = NULLIF(GREATEST(COALESCE(d.gift_count, 0), COALESCE(gs.n, 0)), 0),
    imported_first_gift_date = NULLIF(d.first_gift_date, ''),
    imported_last_gift_date = NULLIF(d.last_gift_date, ''),
    imported_last_gift_amount = CASE WHEN NULLIF(d.last_gift_date, '') IS NOT NULL THEN d.last_gift_amount END,
    imported_through = COALESCE(NULLIF(d.last_gift_date, ''), $4),
    imported_source = $3,
    imported_on = $4
  FROM donors dd LEFT JOIN (SELECT donor_id, SUM(amount) AS t, COUNT(*) FILTER (WHERE amount > 0) AS n
                              FROM gifts WHERE org_id = $1 AND donor_id = ANY($2) GROUP BY donor_id) gs ON gs.donor_id = dd.id
  WHERE d.id = dd.id AND d.org_id = $1 AND dd.org_id = $1 AND d.id = ANY($2)
    AND d.imported_total IS NULL AND d.total_giving > COALESCE(gs.t, 0)`;

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

module.exports = { DONOR_SUMMARY_UPDATE, KEEP_IMPORTED_TOTAL, LAST_GIFT_ORDER, SOFT_CREDIT_RESIZE, IMPORTED_FIRST };
