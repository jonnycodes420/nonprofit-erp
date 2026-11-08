// shared/numbers/topDonors.js · TRUTH-4. TOP DONORS, LIFETIME: ONE LIST.
//
// W-1107-Fundraising-11: the Top 50 header read the stored rollup
// (donors.total_giving, sample and erased people in) while its rows read
// Lifetime live (lifetime.js) without them, so the header said $643,654 over
// rows that totalled $636,354. The header is the sum of its own rows: both
// read this statement. A person is live and not erased, has a lifetime above
// $0, and is ranked by it (ties by id). The count beside each is
// donorSummary.js SUMMARY_OF's (the import's count plus counted gifts after it).
"use strict";
const { LIFETIME } = require("./lifetime");

// SQL, one placeholder (org id): id, name, total (dollars, 2dp), gift_count,
// last_gift_date, ordered. Callers add `LIMIT n`.
function topLifetimeSql() {
  const { SUMMARY_OF } = require("../../donorSummary");
  return `SELECT x.id, x.name, x.total, x.gift_count, x.last_gift_date FROM (
         SELECT d.id, d.name, ROUND(${LIFETIME("d")}, 2) AS total,
                (SELECT s.n FROM ${SUMMARY_OF("d")} s) AS gift_count, d.last_gift_date
           FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.erased_at IS NULL
            AND (d.imported_total IS NOT NULL OR EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id))) x
        WHERE x.total > 0
        ORDER BY x.total DESC, x.id`;
}

module.exports = { topLifetimeSql };
