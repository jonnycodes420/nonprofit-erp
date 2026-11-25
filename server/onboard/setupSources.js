// server/onboard/setupSources.js · ONBOARD-5. THE PEOPLE BEHIND "YOU'RE SET".
// Registered into figureSources.js's SOURCES, so the last setup page's "people in"
// and "lifetime giving" open their rows: everyone in Steward (not sample data, not
// deleted), each with their lifetime giving (donors.total_giving, shared/numbers/
// lifetime.js's figure, kept on the person). Count is the people; sum is the giving.
"use strict";

module.exports = function setupSources() {
  return {
    "setup-everyone": {
      label: "Everyone in Steward",
      measure: p => p.measure || "count",
      params: { measure: "measure" },
      sentence: p => p.measure === "sum"
        ? "Everyone's lifetime giving added: their imported total plus every gift since, refunds taken off."
        : "Everyone in Steward, not counting sample data.",
      sql: orgId => ({
        sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, d.last_gift_date AS date, COALESCE(d.total_giving, 0) AS amount,
                     COALESCE(d.gift_count, 0) || CASE WHEN COALESCE(d.gift_count, 0) = 1 THEN ' gift' ELSE ' gifts' END AS detail
                FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND COALESCE(d.is_sample, false) = false`,
        args: [orgId],
        order: "amount DESC, id",
      }),
    },
  };
};
