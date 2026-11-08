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
//   · NUMBERS-3: the first and last gift are gifts: money above zero, so a
//     refund or a credit row is never either one.
// `$1` is the org; `scope` narrows it (e.g. "AND d.id = ANY($2)").
// FIX-49: soft and matching credit rows are not money, so they are in neither
// the total nor the count (creditTypes.js).
// Only creditTypes.js and shared/numbers (no database) are required, so server.js, afterChange.js and the seed all load it.
const { NOT_CREDIT } = require("./creditTypes");
// NUMBERS-3: the first and last gift are GIFTS (shared/numbers/money.js GIFT:
// money above zero). A refund dated after the last gift moved the stored last
// gift (and made its amount negative) while the tags' last gift did not
// (MAP-1 §2.3); a credit row could be someone's last gift. One rule now,
// shared/numbers/lastGift.js and firstGift.js, and the profile's Last gift
// opens the same row.
const { GIFT } = require("./shared/numbers/money");
const { LAST_GIFT_ORDER } = require("./shared/numbers/lastGift");

// FIX-49 · THE OLD SYSTEM'S FIRST GIFT, and the first gift on file: one rule,
// shared/numbers/firstGift.js ("Donor since", the tags and first_gift_date).
const { IMPORTED_FIRST, FIRST_ON_FILE_AGG } = require("./shared/numbers/firstGift");

// A gift on file that the imported total does not already cover.
// IMPORT-4: an undated gift (date IS NULL) is never inside the old system's
// period, because nobody knows its day: it is always counted.
// FEEL-1: an undated gift is after the import, unless it came in with the very
// import that stated the total (imported_import_id): that file's own gifts are
// inside the total it stated, dated or not, so dating them later moves nothing.
const AFTER_IMPORT = (dd = "dd") => `(${dd}.imported_through IS NULL OR (g.date IS NULL AND (${dd}.imported_import_id IS NULL OR g.import_id IS DISTINCT FROM ${dd}.imported_import_id)) OR g.date > ${dd}.imported_through)`;

// One person's figures, read beside them (`dd` is their row): the imported
// columns plus one pass over their own gifts, through the (org, person) index.
// NUMBERS-4: always per person, never a join over the org's gifts. Joined, a
// fresh org's people (not yet in the planner's statistics) read every gift in
// the org once per person, and a 25,000-person import never finished (PERF-2).
const PERSON_X = (dd = "dd") => `(SELECT ${dd}.id AS donor_id, ${dd}.imported_total AS imp_total, ${dd}.imported_gift_count AS imp_n,
                       ${IMPORTED_FIRST(dd)} AS imp_first, ${dd}.imported_last_gift_date AS imp_last,
                       ${dd}.imported_last_gift_amount AS imp_last_amt, ga.*
                  FROM (SELECT
                       SUM(g.amount) FILTER (WHERE ${AFTER_IMPORT(dd)} AND ${NOT_CREDIT("g")}) AS after_total,
                       COUNT(g.id) FILTER (WHERE g.amount > 0 AND ${AFTER_IMPORT(dd)} AND ${NOT_CREDIT("g")}) AS after_n,
                       COUNT(g.id) FILTER (WHERE g.amount > 0 AND NOT ${AFTER_IMPORT(dd)} AND ${NOT_CREDIT("g")}) AS before_n,
                       ${FIRST_ON_FILE_AGG("g")} AS row_first,
                       MAX(g.date) FILTER (WHERE ${GIFT("g")}) AS row_last,
                       (ARRAY_AGG(g.amount ORDER BY ${LAST_GIFT_ORDER}) FILTER (WHERE g.date IS NOT NULL AND ${GIFT("g")}))[1] AS row_last_amt
                     FROM gifts g WHERE g.org_id = ${dd}.org_id AND g.donor_id = ${dd}.id) ga)`;
// The rollup a person should carry, from PERSON_X's columns.
const SUMMARY_COLS = `x.donor_id,
               (COALESCE(x.imp_total, 0) + COALESCE(x.after_total, 0))::numeric(12,2) AS total,
               (COALESCE(x.imp_n, CASE WHEN x.imp_total IS NOT NULL THEN x.before_n END, 0) + x.after_n)::int AS n,
               NULLIF(LEAST(COALESCE(NULLIF(x.imp_first, ''), '9999-12-31'), COALESCE(x.row_first, '9999-12-31')), '9999-12-31') AS first_date,
               CASE WHEN x.row_last IS NOT NULL AND x.row_last >= COALESCE(NULLIF(x.imp_last, ''), '0000') THEN x.row_last ELSE NULLIF(x.imp_last, '') END AS last_date,
               (CASE WHEN x.row_last IS NOT NULL AND x.row_last >= COALESCE(NULLIF(x.imp_last, ''), '0000') THEN x.row_last_amt
                     WHEN NULLIF(x.imp_last, '') IS NOT NULL THEN COALESCE(x.imp_last_amt, 0) ELSE 0 END)::numeric(12,2) AS last_amt`;
// One row per person in scope (for the read-only diff).
const SUMMARY_ROWS = (scope = "") => `(SELECT ${SUMMARY_COLS}
          FROM donors dd CROSS JOIN LATERAL ${PERSON_X("dd")} x
         WHERE dd.org_id = $1 ${scope.replace(/\bd\./g, "dd.")})`;
// Person `d`'s rollup, as one row.
const SUMMARY_OF = (d = "d") => `(SELECT ${SUMMARY_COLS} FROM ${PERSON_X(d)} x)`;

// NUMBERS-4: no join. Each person in scope is read once and their figures
// computed beside them, so the time grows with the people whatever the
// planner's statistics say (the old UPDATE ... FROM joined donors to itself).
const DONOR_SUMMARY_UPDATE = (scope = "") => `
  UPDATE donors d SET
    (total_giving, gift_count, first_gift_date, last_gift_date, last_gift_amount)
      = (SELECT s.total, s.n, s.first_date, s.last_date, s.last_amt FROM ${SUMMARY_OF("d")} s),
    updated_at = NOW()
  WHERE d.org_id = $1 ${scope}
    -- A person whose totals already agree is not written (an undone merge must
    -- leave the row exactly as it was, updated_at included).
    AND NOT EXISTS (SELECT 1 FROM ${SUMMARY_OF("d")} s
                     WHERE (d.total_giving, d.gift_count, d.first_gift_date, d.last_gift_date, d.last_gift_amount)
                           IS NOT DISTINCT FROM (s.total, s.n, s.first_date, s.last_date, s.last_amt))`;

// NUMBERS-3: the people whose stored rollup differs from what it should be,
// read only (scripts/once/numbers3-recompute-totals.js counts these first).
const DONOR_SUMMARY_DIFF = (scope = "") => `
  SELECT d.id, d.total_giving AS stored_total, s.total, d.last_gift_date AS stored_last, s.last_date,
         d.last_gift_amount AS stored_last_amt, s.last_amt, d.first_gift_date AS stored_first, s.first_date, d.gift_count AS stored_n, s.n
    FROM donors d JOIN ${SUMMARY_ROWS(scope)} s ON s.donor_id = d.id
   WHERE d.org_id = $1
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
// NUMBERS-4: no join. The old form joined donors to itself and filtered both
// sides with `= ANY($2)`; inside the import's transaction a fresh org's new
// rows are not in the planner's statistics, so it looped over every donor for
// every donor, and a 25,000-person workbook ran for over 15 minutes (PERF-2).
// Now each person is read once and their gifts are one index lookup, so the
// time grows with the people, whatever the statistics say. Callers with many
// people go through keepImportedTotals below, in batches.
const GIFTS_ON_FILE = what => `(SELECT ${what} FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND ${NOT_CREDIT("g")})`;
const KEEP_IMPORTED_TOTAL = `
  UPDATE donors d SET
    imported_total = d.total_giving,
    imported_gift_count = NULLIF(GREATEST(COALESCE(d.gift_count, 0), ${GIFTS_ON_FILE("COUNT(*) FILTER (WHERE g.amount > 0)")}), 0),
    imported_first_gift_date = NULLIF(d.first_gift_date, ''),
    imported_last_gift_date = NULLIF(d.last_gift_date, ''),
    imported_last_gift_amount = CASE WHEN NULLIF(d.last_gift_date, '') IS NOT NULL THEN d.last_gift_amount END,
    imported_through = COALESCE(NULLIF(d.last_gift_date, ''), $4),
    imported_source = $3,
    imported_on = $4,
    imported_import_id = $5::text
  WHERE d.org_id = $1 AND d.id = ANY($2)
    AND d.imported_total IS NULL AND d.total_giving > COALESCE(${GIFTS_ON_FILE("SUM(g.amount)")}, 0)`;

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

// NUMBERS-4 · MANY PEOPLE, IN BATCHES. The scoped recompute and the kept
// total are read for a set of people. Right after an import that set is a
// fresh org's new rows, which the planner's statistics have not seen, and a
// join over 25,000 people it thinks are one row is a loop of 25,000 by 25,000.
// Run over BATCH people at a time, the worst plan is BATCH by BATCH, so the
// time grows with the people (PERF-2: a 25,000-person workbook never finished).
// `run(sql, params)` is the caller's query (inside its transaction or not).
const BATCH = 500;
async function inBatches(ids, fn) {
  const all = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < all.length; i += BATCH) await fn(all.slice(i, i + BATCH));
}
const recomputeSummaries = (run, orgId, ids) => inBatches(ids, part => run(DONOR_SUMMARY_UPDATE("AND d.id = ANY($2)"), [orgId, part]));
const keepImportedTotalsFor = (run, orgId, ids, words, today, importId = null) => inBatches(ids, part => run(KEEP_IMPORTED_TOTAL, [orgId, part, words, today, importId || null]));

module.exports = { SUMMARY_OF, BATCH, recomputeSummaries, keepImportedTotalsFor, DONOR_SUMMARY_UPDATE, DONOR_SUMMARY_DIFF, KEEP_IMPORTED_TOTAL, LAST_GIFT_ORDER, SOFT_CREDIT_RESIZE, IMPORTED_FIRST };
